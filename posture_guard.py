"""
거북목 감지 프로토타입 — posture_guard.py

실행:
    pip install mediapipe opencv-python numpy
    python posture_guard.py                # 웹캠 실시간
    python posture_guard.py --replay f.json  # 녹화된 신호로 판정 리플레이 (튜닝용)

사용 순서:
    1. 실행하면 UNCALIBRATED 상태. 평소처럼 바르게 앉은 뒤 'c' → 5초 캘리브레이션
    2. 이후 실시간 점수/상태 표시. 자세 무너뜨리고 20초 유지하면 BAD 전이 확인
    3. 'r' 로 신호 녹화 시작/종료 (JSON) → --replay 로 임계값 튜닝 반복

키: c=캘리브레이션  r=신호 녹화 토글  d=디버그 오버레이  q=종료

설계 요약:
    Pose 랜드마크 → 신호 4개(근접도/피치 프록시/머리하강/어깨말림, 전부 비율 정규화)
    → EMA → 개인 기준(μ,σ) 대비 z-score → 데드존+가중 페널티 → 점수(0~100)
    → 히스테리시스(60/75) + 비대칭 디바운스(진입 20s/복귀 5s) 상태 머신
    → 상태 전이만 SQLite 기록. 프레임은 어디에도 저장/전송되지 않음.
    ※ 피치는 Pose만으로 쓰는 프록시(코-귀 상대 위치). Face Landmarker
       변환 행렬로 업그레이드 가능하나 모델 다운로드가 필요해 프로토타입에선 제외.
"""

import argparse
import json
import sqlite3
import subprocess
import time
from pathlib import Path

import cv2
import numpy as np

# ── 튜닝 파라미터 ──────────────────────────────────────────
EMA_ALPHA = 0.3          # 신호 스무딩
CALIB_SECS = 5.0
SIGMA_FLOOR_FRAC = 0.04  # σ 하한 (기준값의 %) — 너무 미동 없이 캘리브레이션하면 z 폭발 방지
DEADZONE_Z = 1.0         # 이 z-score까지는 페널티 0 (평상시 흔들림 흡수)
WEIGHTS = {"proximity": 0.35, "pitch": 0.30, "head_drop": 0.25, "shoulder_roll": 0.10}
SCORE_K = 1.0            # score = 100·exp(-penalty/K)

BAD_ENTER_SCORE = 60     # 히스테리시스: 이 아래로
BAD_ENTER_SUSTAIN = 5.0  #   이 시간 지속되어야 BAD (실사용 권장 20.0 — 현재 테스트용 단축)
GOOD_ENTER_SCORE = 75    # 이 위로
GOOD_ENTER_SUSTAIN = 3.0 #   이 시간 지속되면 복귀 (실사용 권장 5.0)
AWAY_AFTER = 10.0        # 미검출 지속 → AWAY
ESCALATE_NOTIFY = 20.0   # BAD 지속 시 에스컬레이션(초): 재알림 (실사용 권장 60.0)
ESCALATE_VIGNETTE = 60.0 #                            비네트 (실사용 권장 180.0)

PROFILE_PATH = Path("posture_profile.json")
DB_PATH = Path("posture.db")

# 나쁜 방향: +1 = 값이 커지면 나쁨, -1 = 작아지면 나쁨
BAD_DIRECTION = {"proximity": +1, "pitch": +1, "head_drop": -1, "shoulder_roll": -1}
SIGNAL_KEYS = list(WEIGHTS.keys())

# Pose 랜드마크 인덱스
NOSE, EAR_L, EAR_R, SH_L, SH_R = 0, 7, 8, 11, 12


# ── 신호 계층 ─────────────────────────────────────────────
def extract_signals(lms):
    """Pose 랜드마크 → 신호 4개. 신뢰도 미달이면 None (판정 건너뜀)."""
    need = [NOSE, EAR_L, EAR_R, SH_L, SH_R]
    if any(lms[i].visibility < 0.5 for i in need):
        return None
    p = {i: np.array([lms[i].x, lms[i].y]) for i in need}
    ear_dist = float(np.linalg.norm(p[EAR_L] - p[EAR_R]))
    sh_width = float(np.linalg.norm(p[SH_L] - p[SH_R]))
    if ear_dist < 1e-4 or sh_width < 1e-4:
        return None
    ear_mid = (p[EAR_L] + p[EAR_R]) / 2
    sh_mid = (p[SH_L] + p[SH_R]) / 2
    return {
        # 1. 근접도: 귀 간 거리. 머리가 카메라로 나오면 커짐 (유일한 절대 신호)
        "proximity": ear_dist,
        # 2. 피치 프록시: 고개 숙이면 코가 귀 대비 아래로 → 값 커짐
        "pitch": float((p[NOSE][1] - ear_mid[1]) / ear_dist),
        # 3. 머리 하강: 코-어깨선 수직거리 / 어깨폭. 목 꺾이면 작아짐
        "head_drop": float((sh_mid[1] - p[NOSE][1]) / sh_width),
        # 4. 어깨 말림: 어깨폭 / 귀거리. 어깨 말리거나 머리만 나오면 작아짐
        "shoulder_roll": float(sh_width / ear_dist),
    }


class SignalSmoother:
    def __init__(self, alpha=EMA_ALPHA):
        self.alpha, self.v = alpha, None

    def update(self, sig):
        if self.v is None:
            self.v = dict(sig)
        else:
            for k in SIGNAL_KEYS:
                self.v[k] = self.alpha * sig[k] + (1 - self.alpha) * self.v[k]
        return dict(self.v)


# ── 판정 계층 ─────────────────────────────────────────────
class Judge:
    def __init__(self, profile):
        self.mu = profile["mu"]
        self.sigma = {k: max(profile["sigma"][k], abs(self.mu[k]) * SIGMA_FLOOR_FRAC, 1e-6)
                      for k in SIGNAL_KEYS}

    def score(self, sig):
        """개인 기준 대비 나쁜 방향 편차만 가중 합산 → 0~100."""
        penalty, zs = 0.0, {}
        for k in SIGNAL_KEYS:
            z = (sig[k] - self.mu[k]) / self.sigma[k] * BAD_DIRECTION[k]
            zs[k] = z
            penalty += WEIGHTS[k] * max(0.0, z - DEADZONE_Z)
        return 100.0 * np.exp(-penalty / SCORE_K), zs


class StateMachine:
    """GOOD/BAD/AWAY/UNCALIBRATED + 히스테리시스 + 비대칭 디바운스.
    now를 인자로 받아 시계 주입 → 리플레이/단위 테스트 가능."""

    def __init__(self):
        self.state = "UNCALIBRATED"
        self.cand = None            # (후보 상태, 조건 충족 시작 시각)
        self.state_since = None
        self.transitions = []       # (t, from, to)

    def _go(self, to, now):
        self.transitions.append((now, self.state, to))
        self.state, self.state_since, self.cand = to, now, None

    def update(self, score, now):
        """score=None 이면 미검출 프레임."""
        if self.state == "UNCALIBRATED":
            return self.state

        # 미검출 → AWAY 카운트
        if score is None:
            if self.state != "AWAY":
                if self.cand and self.cand[0] == "AWAY":
                    if now - self.cand[1] >= AWAY_AFTER:
                        self._go("AWAY", now)
                else:
                    self.cand = ("AWAY", now)
            return self.state

        if self.state == "AWAY":     # 재검출 즉시 복귀 (판정은 다음 프레임부터)
            self._go("GOOD", now)
            return self.state

        # 히스테리시스 + 디바운스
        target = None
        if self.state == "GOOD" and score < BAD_ENTER_SCORE:
            target, sustain = "BAD", BAD_ENTER_SUSTAIN
        elif self.state == "BAD" and score > GOOD_ENTER_SCORE:
            target, sustain = "GOOD", GOOD_ENTER_SUSTAIN

        if target is None:
            self.cand = None
        elif self.cand and self.cand[0] == target:
            if now - self.cand[1] >= sustain:
                self._go(target, now)
        else:
            self.cand = (target, now)
        return self.state


# ── 기록 계층 ─────────────────────────────────────────────
class EventLog:
    def __init__(self, path=DB_PATH):
        self.db = sqlite3.connect(path)
        self.db.execute("""CREATE TABLE IF NOT EXISTS posture_events (
            id INTEGER PRIMARY KEY, state TEXT NOT NULL,
            started_at REAL NOT NULL, ended_at REAL)""")
        self.open_id = None

    def transition(self, to_state, now):
        if self.open_id is not None:
            self.db.execute("UPDATE posture_events SET ended_at=? WHERE id=?",
                            (now, self.open_id))
        cur = self.db.execute(
            "INSERT INTO posture_events (state, started_at) VALUES (?,?)",
            (to_state, now))
        self.open_id = cur.lastrowid
        self.db.commit()

    def summary_today(self, now):
        day0 = now - (now % 86400)
        rows = self.db.execute(
            "SELECT state, SUM(COALESCE(ended_at,?) - MAX(started_at,?)) "
            "FROM posture_events WHERE COALESCE(ended_at,?) > ? GROUP BY state",
            (now, day0, now, day0)).fetchall()
        return {s: t for s, t in rows if t}

    def close(self, now):
        self.transition("__closed__", now)
        self.db.close()


# ── 캘리브레이션 ──────────────────────────────────────────
def finish_calibration(samples):
    mu = {k: float(np.mean([s[k] for s in samples])) for k in SIGNAL_KEYS}
    sigma = {k: float(np.std([s[k] for s in samples])) for k in SIGNAL_KEYS}
    profile = {"mu": mu, "sigma": sigma, "created_at": time.time()}
    PROFILE_PATH.write_text(json.dumps(profile, indent=2))
    return profile


# ── 개입: OS 알림 ─────────────────────────────────────────
def notify(msg, sound=None):
    """macOS 알림 센터. 창을 숨겨도(미니 모드) 도달하는 유일한 채널."""
    script = f'display notification "{msg}" with title "Posture Guard"'
    if sound:
        script += f' sound name "{sound}"'
    subprocess.Popen(["osascript", "-e", script],
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


# ── 리플레이 모드 (웹캠 없이 판정 튜닝) ────────────────────
def replay(path):
    data = json.loads(Path(path).read_text())
    judge = Judge(data["profile"])
    sm = StateMachine()
    sm.state = "GOOD"
    for rec in data["frames"]:
        t, sig = rec["t"], rec["sig"]
        score = judge.score(sig)[0] if sig else None
        sm.update(score, t)
    print(f"{len(data['frames'])} frames replayed")
    for t, a, b in sm.transitions:
        print(f"  t={t - data['frames'][0]['t']:7.1f}s  {a} -> {b}")
    if not sm.transitions:
        print("  (no transitions)")


# ── 메인 루프 ─────────────────────────────────────────────
STATE_COLOR = {"GOOD": (90, 190, 90), "BAD": (60, 60, 230),
               "AWAY": (160, 160, 160), "UNCALIBRATED": (60, 170, 230)}

LM_COLOR = {NOSE: (60, 170, 230), EAR_L: (200, 160, 60), EAR_R: (200, 160, 60),
            SH_L: (90, 190, 90), SH_R: (90, 190, 90)}

def build_tracking_panel(mp, res, h, w, zs, state, show_bars):
    """오른쪽 분할 화면: 스켈레톤 + 판정에 쓰는 랜드마크·보조선 + 신호 z-score 바."""
    panel = np.full((h, w, 3), 22, np.uint8)
    cv2.putText(panel, "TRACKING", (12, 24), 0, 0.55, (200, 200, 200), 1)

    if not res.pose_landmarks:
        cv2.putText(panel, "NO DETECTION", (w // 2 - 90, h // 2), 0, 0.8,
                    (160, 160, 160), 2)
        return panel

    # 전체 스켈레톤 (회색, 얇게)
    du = mp.solutions.drawing_utils
    du.draw_landmarks(
        panel, res.pose_landmarks, mp.solutions.pose.POSE_CONNECTIONS,
        landmark_drawing_spec=du.DrawingSpec((90, 90, 90), 1, 1),
        connection_drawing_spec=du.DrawingSpec((70, 70, 70), 1))

    # 판정에 쓰는 5개 랜드마크 강조 + 보조선
    lms = res.pose_landmarks.landmark
    px = {i: (int(lms[i].x * w), int(lms[i].y * h)) for i in LM_COLOR}
    ear_mid = ((px[EAR_L][0] + px[EAR_R][0]) // 2, (px[EAR_L][1] + px[EAR_R][1]) // 2)
    sh_mid = ((px[SH_L][0] + px[SH_R][0]) // 2, (px[SH_L][1] + px[SH_R][1]) // 2)
    cv2.line(panel, px[EAR_L], px[EAR_R], (200, 160, 60), 2)     # 귀선 (proximity)
    cv2.line(panel, px[SH_L], px[SH_R], (90, 190, 90), 2)        # 어깨선 (shoulder_roll)
    cv2.line(panel, ear_mid, px[NOSE], (60, 170, 230), 2)        # 귀중점→코 (pitch)
    cv2.line(panel, px[NOSE], sh_mid, (150, 120, 200), 1)        # 코→어깨중점 (head_drop)
    for i, c in LM_COLOR.items():
        cv2.circle(panel, px[i], 5, c, -1)
        vis = lms[i].visibility
        if vis < 0.5:
            cv2.circle(panel, px[i], 9, (60, 60, 230), 1)        # 신뢰도 미달 표시

    # 신호별 z-score 바 (데드존 초과분이 점수를 깎음)
    if show_bars and zs:
        for i, k in enumerate(SIGNAL_KEYS):
            z = zs[k]
            y = 70 + i * 26
            cv2.putText(panel, f"{k:13s} z={z:+.2f}", (12, y), 0, 0.55,
                        (255, 255, 255), 1)
            x0 = 240
            cv2.rectangle(panel, (x0, y - 12), (x0 + 200, y + 2), (70, 70, 70), 1)
            xdz = x0 + int(DEADZONE_Z / 5 * 200)
            cv2.line(panel, (xdz, y - 12), (xdz, y + 2), (120, 120, 120), 1)  # 데드존 경계
            bar = int(np.clip(z, 0, 5) / 5 * 200)
            cv2.rectangle(panel, (x0, y - 12), (x0 + bar, y + 2),
                          (60, 60, 230) if z > DEADZONE_Z else (90, 190, 90), -1)
    elif show_bars:
        cv2.putText(panel, "(calibrate with 'c' to see signals)", (12, 70), 0, 0.5,
                    (140, 140, 140), 1)

    cv2.putText(panel, state, (12, h - 16), 0, 0.8, STATE_COLOR[state], 2)
    return panel

def main():
    import mediapipe as mp
    cap = cv2.VideoCapture(0)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
    pose = mp.solutions.pose.Pose(model_complexity=0,
                                  min_detection_confidence=0.6,
                                  min_tracking_confidence=0.6)

    smoother = SignalSmoother()
    judge = None
    profile = None
    if PROFILE_PATH.exists():
        profile = json.loads(PROFILE_PATH.read_text())
        judge = Judge(profile)
    sm = StateMachine()
    if judge:
        sm.state = "GOOD"
    log = EventLog()
    log.transition(sm.state, time.time())

    calib_until, calib_samples = None, []
    recording, rec_frames = False, []
    debug = True    # 트래킹 패널의 신호 바 표시 (d로 토글)
    hidden = False  # 미니 모드: 작은 상태 표시줄만 (h로 토글)
    esc_fired = False

    while True:
        ok, frame = cap.read()
        if not ok:
            break
        frame = cv2.flip(frame, 1)
        h, w = frame.shape[:2]
        now = time.time()

        res = pose.process(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        sig = None
        if res.pose_landmarks:
            raw = extract_signals(res.pose_landmarks.landmark)
            if raw:
                sig = smoother.update(raw)

        # 캘리브레이션 수집
        if calib_until is not None:
            remain = calib_until - now
            if sig:
                calib_samples.append(sig)
            if remain <= 0:
                if len(calib_samples) >= 5:
                    profile = finish_calibration(calib_samples)
                    judge = Judge(profile)
                    sm.state = "GOOD"
                    log.transition("GOOD", now)
                calib_until = None
            cv2.putText(frame, f"CALIBRATING... {max(0, remain):.1f}s  sit upright",
                        (12, 40), 0, 0.9, (60, 170, 230), 2)

        # 판정
        score, zs = None, {}
        if judge and sig and calib_until is None:
            score, zs = judge.score(sig)
        prev = sm.state
        state = sm.update(score if judge else None, now)
        if state != prev:
            log.transition(state, now)
            print(f"[{time.strftime('%H:%M:%S')}] {prev} -> {state}")
            esc_fired = False
            if state == "BAD":
                notify("자세가 무너졌어요 - 허리를 펴세요", sound="Funk")
            elif prev == "BAD" and state == "GOOD":
                notify("자세 복귀. 좋아요!")

        # 개입 (OS 알림 + 창 내 연출) — 알림은 창을 숨겨도 동작
        if state == "BAD":
            dur = now - sm.state_since
            if dur >= ESCALATE_NOTIFY and not esc_fired:
                esc_fired = True
                print("\a", end="", flush=True)   # 시스템 벨 1회
                notify(f"{int(dur)}초째 나쁜 자세예요", sound="Basso")
            if not hidden:
                thick = 6 if dur < ESCALATE_NOTIFY else 14
                cv2.rectangle(frame, (0, 0), (w - 1, h - 1), (60, 60, 230), thick)
                if dur >= ESCALATE_VIGNETTE:      # 비네트: 가장자리 어둡게
                    vign = np.zeros((h, w), np.float32)
                    cv2.ellipse(vign, (w // 2, h // 2), (int(w * .42), int(h * .42)),
                                0, 0, 360, 1.0, -1)
                    vign = cv2.GaussianBlur(vign, (0, 0), 60)
                    frame = (frame * (0.35 + 0.65 * vign[..., None])).astype(np.uint8)

        # 녹화
        if recording:
            rec_frames.append({"t": now, "sig": sig})

        col = STATE_COLOR[state]
        if hidden:
            # 미니 모드: 작은 상태 표시줄. 이 창을 클릭하고 h로 복원.
            mini = np.full((60, 260, 3), 30, np.uint8)
            cv2.circle(mini, (26, 30), 11, col, -1)
            txt = "CALIBRATING" if calib_until is not None else \
                  (f"{state} {score:.0f}" if score is not None else state)
            cv2.putText(mini, txt, (48, 38), 0, 0.65, (230, 230, 230), 2)
            cv2.imshow("posture guard", mini)
        else:
            # HUD
            cv2.putText(frame, state, (12, h - 52), 0, 1.1, col, 3)
            if score is not None:
                cv2.putText(frame, f"score {score:5.1f}", (12, h - 16), 0, 0.9,
                            (255, 255, 255), 2)
            cv2.putText(frame, ("REC " if recording else "") +
                        "c:calibrate r:record d:signals h:mini q:quit",
                        (12, 24), 0, 0.55, (200, 200, 200), 1)

            # 2분할: 왼쪽 = 내 화면, 오른쪽 = 트래킹 시각화
            track = build_tracking_panel(mp, res, h, w, zs, state, debug)
            cv2.imshow("posture guard", np.hstack([frame, track]))
        key = cv2.waitKey(1) & 0xFF
        if key in (ord('q'), ord('Q')):
            break
        elif key in (ord('c'), ord('C')):
            calib_until, calib_samples = now + CALIB_SECS, []
        elif key in (ord('d'), ord('D')):
            debug = not debug
        elif key in (ord('h'), ord('H')):
            hidden = not hidden
        elif key in (ord('r'), ord('R')):
            if recording and rec_frames and profile:
                out = Path(f"posture_rec_{int(now)}.json")
                out.write_text(json.dumps({"profile": profile, "frames": rec_frames}))
                print(f"saved {out} ({len(rec_frames)} frames)")
            recording, rec_frames = not recording, []

    now = time.time()
    print("\n오늘 요약:", {k: f"{v/60:.1f}min" for k, v in log.summary_today(now).items()})
    log.close(now)
    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--replay", help="녹화된 신호 JSON으로 판정 리플레이")
    args = ap.parse_args()
    if args.replay:
        replay(args.replay)
    else:
        main()
