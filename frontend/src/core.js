// 판정 코어 — posture_guard.py 와 수치·로직 동일해야 한다 (파이썬이 레퍼런스 구현).
// 변경 시 반드시 test/parity.mjs 로 두 구현의 판정 일치를 확인할 것.

// ── 튜닝 파라미터 (posture_guard.py 상단 튜닝 블록과 동일) ──
export const TUNING = {
  EMA_ALPHA: 0.3,
  CALIB_SECS: 5.0,
  SIGMA_FLOOR_FRAC: 0.04,
  DEADZONE_Z: 1.0,
  // v2 재정의: head_drop(머리 높이, 코 기반) 폐기 — pitch와 이중계산이라 headVertical(절대게이트)로 대체.
  // 남은 3신호를 합=1로 재정규화(기존 0.35/0.30/0.10 ÷ 0.75).
  WEIGHTS: { proximity: 0.47, pitch: 0.40, shoulder_roll: 0.13 },
  SCORE_K: 1.0,
  BAD_ENTER_SCORE: 60,
  BAD_ENTER_SUSTAIN: 5.0,
  GOOD_ENTER_SCORE: 75,
  GOOD_ENTER_SUSTAIN: 3.0,
  AWAY_AFTER: 10.0,
  ESCALATE_NOTIFY: 20.0,
  ESCALATE_VIGNETTE: 60.0,
};

export const BAD_DIRECTION = { proximity: +1, pitch: +1, shoulder_roll: -1 };
export const SIGNAL_KEYS = Object.keys(TUNING.WEIGHTS);

// MediaPipe Pose 랜드마크 인덱스 (tasks-vision 도 동일한 33-포인트 토폴로지)
export const LM = { NOSE: 0, EAR_L: 7, EAR_R: 8, SH_L: 11, SH_R: 12 };

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// ── 신호 계층 ──
export function extractSignals(lms) {
  const need = [LM.NOSE, LM.EAR_L, LM.EAR_R, LM.SH_L, LM.SH_R];
  for (const i of need) {
    if ((lms[i].visibility ?? 1) < 0.5) return null;
  }
  const p = {};
  for (const i of need) p[i] = { x: lms[i].x, y: lms[i].y };
  const earDist = dist(p[LM.EAR_L], p[LM.EAR_R]);
  const shWidth = dist(p[LM.SH_L], p[LM.SH_R]);
  if (earDist < 1e-4 || shWidth < 1e-4) return null;
  const earMidY = (p[LM.EAR_L].y + p[LM.EAR_R].y) / 2;
  const shMidY = (p[LM.SH_L].y + p[LM.SH_R].y) / 2;
  return {
    proximity: earDist,
    pitch: (p[LM.NOSE].y - earMidY) / earDist,
    head_drop: (shMidY - p[LM.NOSE].y) / shWidth,
    shoulder_roll: shWidth / earDist,
  };
}

export class SignalSmoother {
  constructor(alpha = TUNING.EMA_ALPHA) {
    this.alpha = alpha;
    this.v = null;
  }
  update(sig) {
    if (this.v === null) {
      this.v = { ...sig };
    } else {
      for (const k of SIGNAL_KEYS) {
        this.v[k] = this.alpha * sig[k] + (1 - this.alpha) * this.v[k];
      }
    }
    return { ...this.v };
  }
}

// ── 판정 계층 ──
export class Judge {
  constructor(profile) {
    this.mu = profile.mu;
    this.sigma = {};
    for (const k of SIGNAL_KEYS) {
      this.sigma[k] = Math.max(
        profile.sigma[k],
        Math.abs(this.mu[k]) * TUNING.SIGMA_FLOOR_FRAC,
        1e-6,
      );
    }
  }
  score(sig) {
    let penalty = 0;
    const zs = {};
    for (const k of SIGNAL_KEYS) {
      const z = ((sig[k] - this.mu[k]) / this.sigma[k]) * BAD_DIRECTION[k];
      zs[k] = z;
      penalty += TUNING.WEIGHTS[k] * Math.max(0, z - TUNING.DEADZONE_Z);
    }
    return [100 * Math.exp(-penalty / TUNING.SCORE_K), zs];
  }
}

export class StateMachine {
  // GOOD/BAD/AWAY/UNCALIBRATED + 히스테리시스 + 비대칭 디바운스. now(초)는 주입.
  constructor() {
    this.state = "UNCALIBRATED";
    this.cand = null;
    this.stateSince = null;
    this.transitions = [];
  }
  _go(to, now) {
    this.transitions.push([now, this.state, to]);
    this.state = to;
    this.stateSince = now;
    this.cand = null;
  }
  update(score, now) {
    if (this.state === "UNCALIBRATED") return this.state;

    if (score === null || score === undefined) {
      if (this.state !== "AWAY") {
        if (this.cand && this.cand[0] === "AWAY") {
          if (now - this.cand[1] >= TUNING.AWAY_AFTER) this._go("AWAY", now);
        } else {
          this.cand = ["AWAY", now];
        }
      }
      return this.state;
    }

    if (this.state === "AWAY") {
      this._go("GOOD", now);
      return this.state;
    }

    let target = null, sustain = 0;
    if (this.state === "GOOD" && score < TUNING.BAD_ENTER_SCORE) {
      target = "BAD"; sustain = TUNING.BAD_ENTER_SUSTAIN;
    } else if (this.state === "BAD" && score > TUNING.GOOD_ENTER_SCORE) {
      target = "GOOD"; sustain = TUNING.GOOD_ENTER_SUSTAIN;
    }

    if (target === null) {
      this.cand = null;
    } else if (this.cand && this.cand[0] === target) {
      if (now - this.cand[1] >= sustain) this._go(target, now);
    } else {
      this.cand = [target, now];
    }
    return this.state;
  }
}

// ── 캘리브레이션 ──
export function finishCalibration(samples) {
  const mu = {}, sigma = {};
  for (const k of SIGNAL_KEYS) {
    const vals = samples.map((s) => s[k]);
    const m = vals.reduce((a, b) => a + b, 0) / vals.length;
    mu[k] = m;
    sigma[k] = Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / vals.length);
  }
  return { mu, sigma, created_at: Date.now() / 1000 };
}

// ── 리플레이 (posture_rec_*.json — 파이썬 녹화 포맷 그대로) ──
export function replay(data) {
  const judge = new Judge(data.profile);
  const sm = new StateMachine();
  sm.state = "GOOD";
  for (const rec of data.frames) {
    const score = rec.sig ? judge.score(rec.sig)[0] : null;
    sm.update(score, rec.t);
  }
  return sm.transitions;
}
