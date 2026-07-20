// 앱 계층: 카메라 → MediaPipe → 코어(판정) → UI/알림/PiP/보상
// 판정 로직은 core.js, 보상·알림설정 규칙은 reward.js (docs/기능-v2.md 참고).
import {
  TUNING, SIGNAL_KEYS, LM, extractSignals, SignalSmoother, Judge,
  StateMachine, finishCalibration,
} from "./core.js";
// 3D 절대 지표 레이어 — 개인 z-score 위에 "거리에 강한 + 절대 바른자세" 게이트를 얹는다(core 무수정).
import { AbsSmoother, extractAbsolute, finishAbsRef, absPenalty, absWorst, headPoseFromMatrix,
  extractGuidePoints, finishGuide, projectGuide } from "./posture3d.js";
import { Rewards, MELODIES, SKINS, SHOP, TIERS, computeReport } from "./reward.js";

// React 마운트 후 1회 실행 (엔진 계층 — 카메라 루프·판정·알림·PiP)
let __started = false;
export function initApp() {
  if (__started) return; __started = true;

const $ = (id) => document.getElementById(id);
const els = {
  pill: $("state-pill"), score: $("score"), msg: $("msg"), summary: $("summary"),
  fairy: $("fairy"), fairyImg: $("fairy-img"), points: $("points"),
  cam: $("cam"), camPanel: $("cam-panel"), track: $("track"),
  btnStart: $("btn-start"), btnCalib: $("btn-calib"),
  btnNotify: $("btn-notify"), btnPip: $("btn-pip"),
  btnReport: $("btn-report"), reportOverlay: $("report-overlay"),
  btnFace: $("btn-face"), fcImg: $("fc-img"), fcEmoji: $("fc-emoji"),
  reportTable: $("report-table"), reportGrade: $("report-grade"),
  miniCanvas: $("mini-canvas"), miniVideo: $("mini-video"),
  setMode: $("set-mode"), setMelody: $("set-melody"), setVolume: $("set-volume"),
  setVibrate: $("set-vibrate"),
  btnTest: $("btn-test"), shopList: $("shop-list"),
  blink: $("blink"), setBlink: $("set-blink"), blinkStatus: $("blink-status"),
};

const STATE_COLOR = { GOOD: "#5abe5a", BAD: "#e64545", AWAY: "#a0a0a0", UNCALIBRATED: "#e6aa3c" };

// ── 척추요정 스프라이트 (assets/fairy — cheokcheok-manifest.json 의 frame_layout, 9상태) ──
const SPRITE = {
  cell: 256, cols: 4,
  rows: {
    idle: { row: 0, fps: 4 }, alert: { row: 1, fps: 6 }, encourage: { row: 2, fps: 6 },
    praise: { row: 3, fps: 5 }, angry: { row: 4, fps: 8 }, reward: { row: 5, fps: 6 },
    hurt_neck: { row: 6, fps: 3 }, hurt_back: { row: 7, fps: 3 }, hurt_pelvis: { row: 8, fps: 3 },
  },
};
// 현재 장착 스킨의 스프라이트 에셋 (스킨마다 폴더가 다름). 아틀라스는 캐시.
const atlasCache = {};
function currentSkin() { return SKINS[rewards.shop.skin] || SKINS.fairy; }
function skinAtlas() {
  const sk = currentSkin();
  if (!sk.atlas) return null; // 이모지 스킨(고양이·곰)은 아틀라스 없음
  if (!atlasCache[sk.atlas]) { const im = new Image(); im.src = sk.atlas; atlasCache[sk.atlas] = im; }
  return atlasCache[sk.atlas];
}
let praiseUntil = 0; // 복귀 직후 칭찬 모션
let rewardUntil = 0; // 포인트·출석·구매 직후 보상 모션

// 상황 → 모션 (에셋 README의 권장 전이: 방치 alert → angry → hurt / 교정 encourage / 성공 praise / 보상 reward)
function spriteAnim(state, now) {
  if (calibUntil !== null) return "encourage";              // 기준 등록 중 — "곧게 펴볼까요?"
  if (state === "BAD") {
    if (sm.cand?.[0] === "GOOD") return "encourage";        // 고치는 중 — 응원
    const dur = sm.stateSince ? now - sm.stateSince : 0;
    if (dur >= TUNING.ESCALATE_VIGNETTE) return "hurt_neck"; // 오래 방치 — 거북목 아픔
    if (dur >= TUNING.ESCALATE_NOTIFY) return "angry";      // "교정 안 했어?!"
    return "alert";                                         // "자세가 틀어졌어요!"
  }
  if (sm.cand?.[0] === "BAD") return "encourage";           // 무너지는 중 — 다잡기
  if (now < rewardUntil) return "reward";                   // "보상 받았어요!"
  if (now < praiseUntil) return "praise";                   // "정말 잘하고 있어요!"
  return "idle"; // GOOD / AWAY / UNCALIBRATED (뒤 둘은 흐리게 표시)
}
const nowSec = () => Date.now() / 1000;
const dateStr = () => new Date().toISOString().slice(0, 10);
const dayStartSec = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() / 1000; };

// ── 영속 상태 (localStorage — 전부 숫자·설정, 영상 아님) ──
const store = {
  loadProfile: () => JSON.parse(localStorage.getItem("pg_profile") || "null"),
  saveProfile: (p) => localStorage.setItem("pg_profile", JSON.stringify(p)),
  loadEvents: () => JSON.parse(localStorage.getItem("pg_events") || "[]"),
  saveEvents: (e) => localStorage.setItem("pg_events", JSON.stringify(e.slice(-2000))),
};

// ── 런타임 ──
const rewards = new Rewards(localStorage);
let landmarker = null;
let smoother = new SignalSmoother();
let judge = null;
let sm = new StateMachine();
let running = false;
let bgTickSet = false;
let calibUntil = null, calibSamples = [];
let absSmoother = new AbsSmoother(); // 3D 지표 One-Euro
let absRef = null;                   // 유도 캘리브로 잡은 "바른 자세" 절대 기준
let absCalibSamples = [];            // 캘리브 중 절대 지표 수집
let lastAbs = null;                  // 최근 절대 지표(트래킹 수치 표시용)
let guideRef = null;                 // 트래킹 고스트 가이드(바른 머리위치, 어깨프레임)
let guideCalibSamples = [];          // 캘리브 중 가이드 좌표 수집
let escFired = false;
let lastDetect = 0;
let lastActiveSec = +(localStorage.getItem("pg_last_active") || 0); // 마지막 실제 감지 틱 시각(초). 세션 간 유지 → 재로드 시 열린 세그먼트 무한연장 방지.
let lastActivePersist = 0;
const IDLE_GAP_SEC = 5;  // 틱 공백이 이보다 크면 백그라운드/절전 복귀로 보고 직전 세그먼트를 그 시점에 끊음.
let lastResult = null;
let events = store.loadEvents();

// ── 눈 깜빡임 — 주기 샘플링. 얼굴 모델은 머리자세 판정용으로 이미 로드돼 있어 추가 비용 0, 샘플 창에서만 카운트 ──
const BLINK_WINDOW_SEC = 30;    // 한 번 잴 때 30초 측정
const BLINK_INTERVAL_SEC = 180; // 3분마다 측정
const BLINK_FIRST_DELAY = 15;   // 켠 뒤 15초 후 첫 측정
const BLINK_CLOSE = 0.5;        // 눈 감김 점수 이 이상이면 감긴 것
const BLINK_LOW_RATE = 8;       // 분당 이 미만이면 눈 건조 알림
const BLINK_NORMAL_LO = 15, BLINK_NORMAL_HI = 20; // 정상 범위(리포트·차트 표기용)
let blinkEnabled = localStorage.getItem("pg_blink") !== "0"; // 정식 기능 — 기본 켜짐(명시적으로 끈 경우만 off)
// 측정값 로그 적재 — pg_blink_log = [{t(초), rate}]. 리포트·차트에서 '오늘 평균' 계산에 사용.
function logBlink(rate) {
  try {
    const arr = JSON.parse(localStorage.getItem("pg_blink_log") || "[]");
    arr.push({ t: Math.floor(Date.now() / 1000), rate });
    const cutoff = Date.now() / 1000 - 14 * 86400;            // 14일 이전 정리 + 최대 400개
    localStorage.setItem("pg_blink_log", JSON.stringify(arr.filter((x) => x.t >= cutoff).slice(-400)));
  } catch {}
}
// 오늘 측정 요약 — {n(측정횟수), avg(분당 평균), last}
function blinkTodayStats() {
  let arr = [];
  try { arr = JSON.parse(localStorage.getItem("pg_blink_log") || "[]"); } catch {}
  const today = arr.filter((x) => x.t >= dayStartSec());
  if (!today.length) return { n: 0, avg: null, last: null };
  return { n: today.length, avg: Math.round(today.reduce((a, b) => a + b.rate, 0) / today.length), last: today[today.length - 1].rate };
}
let faceLandmarker = null;
let faceLoading = false;
let blinkSampling = false, blinkWinStart = 0, blinkCount = 0, blinkClosed = false, blinkFaceFrames = 0;
let nextBlinkAt = 0;            // 다음 측정 예정 시각(초)
let blinkRate = null;          // 마지막 추정 분당 횟수
// 얼굴 추론 통합(머리자세 + blink) — 틱당 detectForVideo 1회 공유(중복호출 방지)
let faceHead = null;           // {pitch,yaw,roll} 최근 머리 자세(도), 얼굴 없으면 null
let lastFaceFr = null;         // 이번 틱의 얼굴 결과(runFace가 채움, 없으면 null)
let lastFaceDetect = 0;        // 머리자세 스로틀 기준(wallMs)
let faceSeenAt = 0;            // 마지막으로 얼굴이 잡힌 시각(초) — 오래 없으면 pitch 무효화
const FACE_HEAD_GAP = 180;     // 머리자세용 얼굴 추론 최소 간격(ms) ≈ 5.5Hz (폰 부담 완화)

const profile = store.loadProfile();
if (profile) { judge = new Judge(profile); sm.state = "GOOD"; absRef = profile.absRef || null; guideRef = profile.guide || null; }

// ── 알림 (소리·진동·노래는 reward.js 설정을 따름) ──
// 화면 안 배너 — 아이폰(WebKit)처럼 Notification 미지원/미허용일 때의 대체 채널
function showToast(body) {
  let t = document.getElementById("toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "toast";
    t.style.cssText = "position:fixed;top:12px;left:50%;transform:translateX(-50%);" +
      "background:#171c22;border:1px solid #2a323c;color:#e7ecf1;padding:10px 18px;" +
      "border-radius:10px;z-index:99;font-size:14px;box-shadow:0 4px 16px rgba(0,0,0,.5);" +
      "transition:opacity .3s;max-width:90vw";
    document.body.appendChild(t);
  }
  t.textContent = body;
  t.style.opacity = "1";
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { t.style.opacity = "0"; }, 4000);
}
function notify(body) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") {
    showToast(body);
    return;
  }
  // 서비스워커 경유가 표준 경로 — 설치형 PWA(아이폰 홈 화면 추가 포함)에서 시스템 알림으로 뜬다
  if (navigator.serviceWorker) {
    navigator.serviceWorker.ready
      .then((reg) => reg.showNotification("척추요정", { body, tag: "posture-guard" }))
      .catch(() => {
        try { new Notification("척추요정", { body, tag: "posture-guard" }); } catch { showToast(body); }
      });
    return;
  }
  try { new Notification("척추요정", { body, tag: "posture-guard" }); } catch { showToast(body); }
}
let audioCtx = null;
function playNotes(notes, volume) {
  try {
    audioCtx = audioCtx || new AudioContext();
    let t = audioCtx.currentTime;
    for (const [freq, dur] of notes) {
      if (freq > 0) {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.frequency.value = freq;
        g.gain.setValueAtTime(Math.max(volume, 1e-4) * 0.25, t);
        g.gain.exponentialRampToValueAtTime(1e-4, t + dur);
        o.connect(g).connect(audioCtx.destination);
        o.start(t); o.stop(t + dur + 0.02);
      }
      t += dur;
    }
  } catch {}
}
function playAlert(stage, body) { // stage 1=BAD 진입, 2=에스컬레이션. body는 아이폰 재알림용 배너 문구
  const s = rewards.settings;
  const useSound = s.mode === "sound" || s.mode === "both";
  const useVib = s.mode === "vibrate" || s.mode === "both";
  if (useSound) {
    const notes = (MELODIES[s.melody] || MELODIES.dingdong).notes;
    playNotes(stage === 2 ? [...notes, [0, 0.15], ...notes] : notes, s.volume);
  }
  if (useVib) {
    // 세기 제어는 웹에서 불가 → 횟수로 통일. 2단계(에스컬레이션)는 2배, 최대 5회.
    const n = Math.min(Math.max(1, parseInt(s.vibrate, 10) || 2) * (stage === 2 ? 2 : 1), 5);
    if (navigator.vibrate) {
      const pat = [];
      for (let i = 0; i < n; i++) { pat.push(300); if (i < n - 1) pat.push(180); }
      navigator.vibrate(pat);
    } else if (typeof Notification !== "undefined" && Notification.permission === "granted"
               && navigator.serviceWorker && body) {
      // 아이폰: 진동 API가 없어 같은 배너를 재알림(renotify)해 횟수만큼 시스템 진동을 유도
      for (let i = 1; i < n; i++) {
        setTimeout(() => {
          navigator.serviceWorker.ready.then((reg) =>
            reg.showNotification("척추요정", { body, tag: "posture-guard", renotify: true })
          ).catch(() => {});
        }, i * 1500);
      }
    }
  }
}

function logTransition(from, to, t) {
  events.push({ t, from, to });
  store.saveEvents(events);
  renderSummary();
}

function renderSummary() {
  const rep = computeReport(events, dayStartSec(), nowSec());
  if (rep.watched <= 0) { els.summary.textContent = ""; return; }
  els.summary.textContent =
    `오늘: 바른 자세 ${(rep.good / 60).toFixed(1)}분 · 나쁜 자세 ${(rep.bad / 60).toFixed(1)}분` +
    (rep.ratio !== null ? ` · ${Math.round(rep.ratio * 100)}%` : "");
}

function flashPoints() {
  els.points.classList.add("flash");
  setTimeout(() => els.points.classList.remove("flash"), 300);
}

// ── 카메라 + MediaPipe ──
async function start() {
  els.btnStart.disabled = true;
  els.msg.textContent = landmarker ? "카메라 켜는 중…" : "모델 로딩 중…";
  try {
    if (!landmarker) { // 모델은 최초 1회만 로드 (껐다 켜도 재사용)
      const { PoseLandmarker, FilesetResolver } = await import(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm"
      );
      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
      );
      landmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
          delegate: "GPU",
        },
        runningMode: "VIDEO", numPoses: 1,
        minPoseDetectionConfidence: 0.6, minTrackingConfidence: 0.6,
      });
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480 }, audio: false,
    });
    els.cam.srcObject = stream;
    await els.cam.play();
  } catch (e) {
    els.msg.textContent = "시작 실패: " + e.message + " (카메라 권한을 확인하세요)";
    els.btnStart.disabled = false;
    return;
  }
  running = true;
  els.btnStart.textContent = "카메라 끄기";
  els.btnStart.disabled = false;
  els.btnCalib.disabled = false;
  els.btnPip.disabled = false;
  if (rewards.attend(dateStr())) {
    els.msg.textContent = "출석 +10P! " + (judge ? "감지 중 (저장된 기준 사용)." : "바르게 앉은 뒤 [기준 등록]을 누르세요.");
    flashPoints();
    rewardUntil = nowSec() + 3;
  } else {
    els.msg.textContent = judge
      ? "감지 중 (저장된 기준 사용). 기준을 다시 잡으려면 [기준 등록]."
      : "바르게 앉은 뒤 [기준 등록]을 누르세요.";
  }
  if (judge) logTransition(null, sm.state, nowSec());
  ensureFaceModel(); // 머리자세 판정(+눈 깜빡임)용 얼굴 모델 프리로드 — 캘리브 전에 준비되도록
  // PiP 폴백용 스트림 예열 — 클릭 시 await 없이 바로 요청해 user activation 소진을 막는다
  drawMini(sm.state, null, rewards.fairy(sm.state, 0, false), false, nowSec());
  if (!els.miniVideo.srcObject) els.miniVideo.srcObject = els.miniCanvas.captureStream(2);
  els.miniVideo.play().catch(() => {});
  requestAnimationFrame(tick);
  // 백그라운드 탭에서는 rAF가 멈추므로 인터벌이 1Hz 감시를 이어받는다 (최초 1회만 설치)
  if (!bgTickSet) { setInterval(() => { if (running && document.hidden) tick(); }, 1000); bgTickSet = true; }
}

// 카메라 끄기 — 웹캠 트랙을 정지해 카메라 불이 꺼지고 감지가 멈춘다.
function stop() {
  // 열린 GOOD/BAD 세그먼트를 지금 시점에 닫아, 정지 후에도 시간이 계속 누적되지 않게 함.
  if (running && (sm.state === "GOOD" || sm.state === "BAD")) { logTransition(sm.state, "AWAY", nowSec()); sm.state = "AWAY"; }
  running = false;
  uploadStats(); // 세그먼트 닫힌 뒤 최종 집계 1회
  window.__pgLive = { running: false }; // 도우미에게 카메라 꺼짐 알림
  const s = els.cam.srcObject;
  if (s) { s.getTracks().forEach((t) => t.stop()); els.cam.srcObject = null; }
  blinkSampling = false;
  els.btnStart.textContent = "카메라 시작";
  els.btnCalib.disabled = true;
  els.pill.textContent = "꺼짐";
  els.pill.style.background = "#555";
  els.score.textContent = "score --";
  els.msg.textContent = "카메라를 껐어요. 다시 켜려면 [카메라 시작]을 누르세요.";
  const ctx = els.track.getContext("2d"); // TRACKING 지우기
  ctx.clearRect(0, 0, els.track.width, els.track.height);
}

// ── 얼굴 모델 로드 (머리자세 판정 + 눈 깜빡임 공용) ──
async function ensureFaceModel() {
  if (faceLandmarker || faceLoading) return;
  faceLoading = true;
  els.blinkStatus.textContent = "모델 준비 중…";
  try {
    const { FaceLandmarker, FilesetResolver } = await import(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm"
    );
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
    );
    faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
        delegate: "GPU",
      },
      runningMode: "VIDEO", numFaces: 1,
      outputFaceBlendshapes: true,               // 눈 깜빡임(blink)용
      outputFacialTransformationMatrixes: true,  // 머리 자세(pitch/yaw)용
    });
    els.blinkStatus.textContent = "준비됨 · 곧 측정해요";
    nextBlinkAt = nowSec() + BLINK_FIRST_DELAY;
  } catch (e) {
    els.blinkStatus.textContent = "모델 로딩 실패: " + e.message;
    els.setBlink.checked = false;
    blinkEnabled = false;
  } finally {
    faceLoading = false;
  }
}

// 얼굴 추론 통합 — 틱당 detectForVideo 1회로 머리자세 + blink 를 함께 처리(중복호출 방지).
// blink 샘플 창에서는 매 프레임, 그 외엔 머리자세용으로만 ~5.5Hz 스로틀(폰 부담 완화). 결과=lastFaceFr.
function runFace(now, wallMs) {
  lastFaceFr = null;
  if (!faceLandmarker) return;
  const sampling = blinkEnabled && blinkSampling && calibUntil === null; // blink 창은 풀레이트
  const dueHead = wallMs - lastFaceDetect >= FACE_HEAD_GAP;              // 머리자세는 스로틀
  if (!sampling && !dueHead) return;
  try { lastFaceFr = faceLandmarker.detectForVideo(els.cam, wallMs); }
  catch { lastFaceFr = null; return; }
  lastFaceDetect = wallMs;
  const hp = headPoseFromMatrix(lastFaceFr.facialTransformationMatrixes?.[0]?.data);
  if (hp) { faceHead = hp; faceSeenAt = now; }
  else if (now - faceSeenAt > 1.5) faceHead = null; // 얼굴이 오래 사라지면 pitch 무효화
}

// 주기 샘플링: 평소엔 쉬고, 정해진 시각에 30초간 깜빡임을 센다.
// detectForVideo 는 runFace 가 이미 호출했고, 여기선 그 결과(lastFaceFr)의 blendshapes 만 소비.
function processBlink(now) {
  if (!blinkEnabled || !faceLandmarker || calibUntil !== null) return;
  if (document.hidden) { blinkSampling = false; return; } // 탭 백그라운드=저FPS라 깜빡임을 놓쳐 오측정 → 측정 창 취소(가짜 낮은 값·건조 알림 방지)

  if (!blinkSampling) {
    if (now < nextBlinkAt) {
      const left = Math.max(0, Math.round(nextBlinkAt - now));
      els.blink.style.display = "";
      els.blink.textContent = blinkRate === null ? `👁 ${left}s후 측정` : `👁 ${blinkRate}회/분`;
      return;
    }
    blinkSampling = true; blinkWinStart = now; blinkCount = 0; blinkClosed = false; blinkFaceFrames = 0;
  }

  // 샘플 창: 이번 틱 얼굴 결과에서 깜빡임(눈 감김의 상승 에지) 카운트
  els.blink.style.display = "";
  els.blink.textContent = "👁 측정 중…";
  const bs = lastFaceFr?.faceBlendshapes?.[0]?.categories;
  if (bs) {
    blinkFaceFrames++;
    const l = bs.find((c) => c.categoryName === "eyeBlinkLeft")?.score || 0;
    const r = bs.find((c) => c.categoryName === "eyeBlinkRight")?.score || 0;
    const closed = (l + r) / 2 > BLINK_CLOSE;
    if (closed && !blinkClosed) blinkCount++; // 감기 시작 = 1회
    blinkClosed = closed;
  }

  if (now - blinkWinStart >= BLINK_WINDOW_SEC) {
    blinkSampling = false;
    nextBlinkAt = now + BLINK_INTERVAL_SEC;
    if (blinkFaceFrames < 10) { // 얼굴이 거의 안 잡힘 → 추정 불가
      els.blinkStatus.textContent = "얼굴이 잘 안 보여 측정을 건너뛰었어요";
      return;
    }
    blinkRate = Math.round(blinkCount / (BLINK_WINDOW_SEC / 60));
    logBlink(blinkRate); // 리포트·차트용 오늘 로그 적재
    els.blink.textContent = `👁 ${blinkRate}회/분`;
    els.blinkStatus.textContent = `방금 측정: 분당 ${blinkRate}회 (정상 ${BLINK_NORMAL_LO}~${BLINK_NORMAL_HI})`;
    if (blinkRate < BLINK_LOW_RATE) {
      notify(`👁 눈이 건조해질 수 있어요 — 잠깐 눈을 깜빡이거나 먼 곳을 봐요 (분당 ${blinkRate}회)`);
    }
  }
}

// 캐릭터 말풍선 — 요정이 잠깐 말한다 (전이·이벤트 시)
let speechTimer = null;
function speak(text, ms = 4000) {
  const el = $("speech");
  if (!el) return;
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(speechTimer);
  speechTimer = setTimeout(() => el.classList.remove("show"), ms);
}

// ── 메인 틱 ──
function tick() {
  if (!running) return;
  const now = nowSec();
  const wallMs = performance.now();
  const minGap = document.hidden ? 950 : 100; // 보일 때 10Hz, 숨김 1Hz
  if (wallMs - lastDetect >= minGap && els.cam.readyState >= 2) {
    lastDetect = wallMs;
    // 감지 공백(백그라운드·절전 복귀 등) → 직전 GOOD/BAD 세그먼트를 공백 시작점에서 끊어 유휴시간을 GOOD로 안 셈
    if (lastActiveSec && now - lastActiveSec > IDLE_GAP_SEC) {
      if (sm.state === "GOOD" || sm.state === "BAD") logTransition(sm.state, "AWAY", lastActiveSec);
      sm.state = "AWAY";
    }
    lastActiveSec = now;
    if (now - lastActivePersist > 3) { try { localStorage.setItem("pg_last_active", String(Math.round(now))); } catch {} lastActivePersist = now; }
    let sig = null, absM = null, guideSample = null;
    lastFaceFr = null; // pose detect가 throw해도 blink가 이전 틱 프레임을 재소비하지 않도록
    try {
      lastResult = landmarker.detectForVideo(els.cam, wallMs);
      const lms = lastResult.landmarks?.[0];
      if (lms) {
        const raw = extractSignals(lms);
        if (raw) sig = smoother.update(raw);
        guideSample = extractGuidePoints(lms); // 트래킹 가이드 캡처용(어깨프레임 머리위치)
      }
      runFace(now, wallMs); // 얼굴 추론 1회(머리자세 + blink 공유) → faceHead 갱신
      // 3D 절대 지표(미터 world 좌표, 추가 추론비용 0) + 얼굴 머리 pitch(있으면). 없으면 null
      const raw3d = extractAbsolute(lastResult.worldLandmarks?.[0]);
      if (raw3d && faceHead) { raw3d.headPitch = faceHead.pitch; raw3d.headRoll = faceHead.roll; }
      absM = absSmoother.update(raw3d, now);
      lastAbs = absM; // 트래킹 각도 수치 표시용
    } catch {}

    processBlink(now); // 눈 깜빡임 — runFace가 채운 lastFaceFr 소비 (켜져 있을 때만)

    // 캘리브레이션 수집
    if (calibUntil !== null) {
      if (sig) calibSamples.push(sig);
      if (absM) absCalibSamples.push(absM);
      if (guideSample) guideCalibSamples.push(guideSample);
      const remain = calibUntil - now;
      els.msg.textContent = `바른자세 기준 등록 중… ${Math.max(0, remain).toFixed(1)}s — 귀·어깨 일직선, 화면은 눈높이, 등 펴기`;
      if (remain <= 0) {
        if (calibSamples.length >= 5) {
          const p = finishCalibration(calibSamples);
          const ref = finishAbsRef(absCalibSamples); // 이 "바른 자세"의 3D 절대 기준
          if (ref) p.absRef = ref;
          const g = finishGuide(guideCalibSamples); // 트래킹 고스트 가이드(바른 머리위치)
          if (g) p.guide = g;
          store.saveProfile(p);
          absRef = ref;
          guideRef = g;
          judge = new Judge(p);
          smoother = new SignalSmoother();
          absSmoother = new AbsSmoother();
          sm = new StateMachine(); sm.state = "GOOD";
          logTransition(null, "GOOD", now);
          els.msg.textContent = "기준 등록 완료. 척추요정이 깨어났어요!";
          speak("준비 완료! 지켜볼게요 👀");
        } else {
          els.msg.textContent = "몸이 잘 안 잡혔어요. 다시 [기준 등록]을 눌러주세요.";
        }
        calibUntil = null;
        absCalibSamples = [];
        guideCalibSamples = [];
      }
    }

    // 판정 + 상태 전이 — 개인 z-score(core)에 3D 절대 게이트를 곱해 결합
    let score = null, zs = {};
    if (judge && sig && calibUntil === null) {
      [score, zs] = judge.score(sig);
      if (absRef && absM) score *= Math.exp(-absPenalty(absM, absRef)); // 절대적으로 나쁘면 추가 감점
    }
    const prev = sm.state;
    const state = sm.update(judge ? score : null, now);
    const dur = sm.stateSince ? now - sm.stateSince : 0;
    const badCand = sm.cand?.[0] === "BAD";
    const face = rewards.fairy(state, dur, badCand);

    // 라이브 자세 노출 — 돌아다니는 요정 도우미(Buddy)가 읽어 문제 부위를 말풍선으로 콕 짚어줌
    let worst = null, worstZ = TUNING.DEADZONE_Z;
    for (const k in zs) if (zs[k] > worstZ) { worstZ = zs[k]; worst = k; }
    if (!worst && absRef && absM) worst = absWorst(absM, absRef); // 2D가 못 짚으면 3D 절대 지표로
    window.__pgLive = { running: true, state, score, worst, dur, ts: now,
      pitch: faceHead ? Math.round(faceHead.pitch) : null, // 실기기 부호 확인·디버그용
      absOn: !!(absRef && absM),                            // 절대 게이트(어깨기울기·거북목·머리각) 작동 여부
      absPen: (absRef && absM) ? +absPenalty(absM, absRef).toFixed(2) : null, // 총 절대 페널티
      // 전방머리(거북목)
      fwd: absM?.headForward != null ? +absM.headForward.toFixed(3) : null,
      fwdRef: absRef?.headForward != null ? +absRef.headForward.toFixed(3) : null,
      fwdDev: (absM?.headForward != null && absRef?.headForward != null) ? +(absM.headForward - absRef.headForward).toFixed(3) : null,
      // 어깨 기울기
      tilt: absM?.shoulderTilt != null ? +absM.shoulderTilt.toFixed(1) : null,
      tiltRef: absRef?.shoulderTilt != null ? +absRef.shoulderTilt.toFixed(1) : null,
      // 어깨 말림(3D span)
      span: absM?.shoulderSpan != null ? +absM.shoulderSpan.toFixed(3) : null,
      spanRef: absRef?.shoulderSpan != null ? +absRef.shoulderSpan.toFixed(3) : null,
      // 좌우 쏠림 · 갸웃 · 턱괴기
      lat: absM?.headLateral != null ? +absM.headLateral.toFixed(3) : null,
      latRef: absRef?.headLateral != null ? +absRef.headLateral.toFixed(3) : null,
      roll: absM?.headRoll != null ? +absM.headRoll.toFixed(1) : null,
      rollRef: absRef?.headRoll != null ? +absRef.headRoll.toFixed(1) : null,
      hand: absM?.handToFace != null ? +absM.handToFace.toFixed(2) : null };

    if (state !== prev) {
      logTransition(prev, state, now);
      escFired = false;
      if (state === "BAD") {
        const m = `${face} 자세가 틀어졌어요! 허리를 펴요`;
        notify(m); playAlert(1, m); speak("허리 펴요! 🔥");
      }
      else if (prev === "BAD" && state === "GOOD") {
        praiseUntil = now + 3; // 칭찬 모션
        speak("잘하고 있어요! 💚");
        notify(`${rewards.fairy("GOOD", 0, false)} 정말 잘하고 있어요! 포인트 다시 적립`);
        if (rewards.settings.mode === "sound" || rewards.settings.mode === "both")
          playNotes(MELODIES.sparkle.notes, rewards.settings.volume * 0.6);
      }
    }
    // 에스컬레이션: 숨김 중에도 알림은 반복 도달 (60초마다)
    if (state === "BAD") {
      const step = Math.floor(dur / TUNING.ESCALATE_NOTIFY);
      if (step >= 1 && !escFired) {
        escFired = true;
        const m2 = `${face} 교정 안 했어?! ${Math.round(dur)}초째 나쁜 자세예요`;
        notify(m2); playAlert(2, m2); speak("아직도?! 😤");
      } else if (step >= 1 && escFired && dur % TUNING.ESCALATE_NOTIFY < 1.2) {
        escFired = false; // 60초마다 재무장
      }
    }
    // 포인트 적립 (GOOD 1분당 +1P)
    if (rewards.tick(state, now, dateStr()) > 0) { flashPoints(); rewardUntil = now + 2.5; speak("+1P! 🪙"); }

    renderUI(state, score, zs, now, face);
  }
  if (!document.hidden) requestAnimationFrame(tick);
}

// ── UI 렌더 ──
function renderUI(state, score, zs, now, face) {
  els.pill.textContent = state;
  els.pill.style.background = STATE_COLOR[state];
  els.score.textContent = score === null ? "score --" : `score ${score.toFixed(1)}`;
  els.points.textContent = `🪙 ${rewards.points}P`;

  const badCand = sm.cand?.[0] === "BAD";
  updateFairyVisual(state, badCand, now, face);
  updateFaceCover(state, now, face);

  const dur = sm.stateSince ? now - sm.stateSince : 0;
  els.camPanel.classList.toggle("bad", state === "BAD");
  els.camPanel.classList.toggle("bad-hard", state === "BAD" && dur >= TUNING.ESCALATE_NOTIFY);
  els.camPanel.classList.toggle("vignette", state === "BAD" && dur >= TUNING.ESCALATE_VIGNETTE);

  drawTracking(state, zs);
  drawMini(state, score, face, badCand, now);
  updateDocPip(state, score, now);
}

// 헤더 요정: 스프라이트 스킨(척추요정·이미지 스킨들)은 GIF, 이모지 스킨(고양이·곰)은 이모지
function updateFairyVisual(state, badCand, now, face) {
  const dir = currentSkin().spriteDir;
  if (dir) {
    els.fairy.style.display = "none";
    els.fairyImg.style.display = "inline-block";
    const src = `${dir}/${spriteAnim(state, now)}.gif`;
    if (!els.fairyImg.src.endsWith(src)) els.fairyImg.src = src; // 같은 GIF 재시작 방지
    els.fairyImg.classList.toggle("dim", state === "AWAY" || state === "UNCALIBRATED");
  } else {
    els.fairyImg.style.display = "none";
    els.fairy.style.display = "";
    els.fairy.textContent = face;
  }
}

// 얼굴 가리기 커버 — 켜져 있을 때만 캐릭터를 상태에 맞게 갱신 (영상은 밑에서 계속 재생 = 감지 유지)
function updateFaceCover(state, now, face) {
  if (!els.camPanel.classList.contains("face-hidden")) return;
  const dir = currentSkin().spriteDir;
  if (dir) {
    els.fcImg.style.display = "";
    els.fcEmoji.style.display = "none";
    const src = `${dir}/${spriteAnim(state, now)}.gif`;
    if (!els.fcImg.src.endsWith(src)) els.fcImg.src = src;
  } else {
    els.fcImg.style.display = "none";
    els.fcEmoji.style.display = "";
    els.fcEmoji.textContent = face;
  }
}

const KEYPT = { [LM.NOSE]: "#e6763c", [LM.EAR_L]: "#e6aa3c", [LM.EAR_R]: "#e6aa3c", [LM.SH_L]: "#5abe5a", [LM.SH_R]: "#5abe5a" };
// 신호 이름 → 쉬운 한국어 (트래킹 막대 라벨)
const SIGNAL_KR = { proximity: "화면 거리", pitch: "고개 숙임", shoulder_roll: "어깨 말림" };

function drawTracking(state, zs) {
  const ctx = els.track.getContext("2d");
  const { width: w, height: h } = els.track;
  ctx.fillStyle = "#14181d"; ctx.fillRect(0, 0, w, h);
  // 옅은 격자 — 각도·정렬을 눈으로 가늠하기 쉽게
  ctx.strokeStyle = "rgba(255,255,255,0.045)"; ctx.lineWidth = 1;
  for (let gx = 40; gx < w; gx += 40) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke(); }
  for (let gy = 40; gy < h; gy += 40) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke(); }

  const calibrating = calibUntil !== null;

  const lms = lastResult?.landmarks?.[0];
  if (!lms) {
    ctx.fillStyle = "#8b98a5"; ctx.font = "18px sans-serif"; ctx.textAlign = "center";
    ctx.fillText(calibrating ? "얼굴과 어깨가 보이게 앉아요" : "사람이 안 보여요", w / 2, h - 26);
    ctx.textAlign = "left";
    return;
  }
  const px = (i) => [(1 - lms[i].x) * w, lms[i].y * h];        // 거울 반전 일치
  const pp = (p) => [(1 - p.x) * w, p.y * h];                   // 정규화 점(가이드)용
  const mid = (a, b) => [(px(a)[0] + px(b)[0]) / 2, (px(a)[1] + px(b)[1]) / 2];
  const stateCol = state === "BAD" ? "#e64545" : state === "GOOD" ? "#5abe5a" : "#8b98a5";

  // ── 바른자세 고스트 가이드 (라이브 스켈레톤 뒤에 먼저 그림). 캘리브 중엔 실루엣 가이드가 대신 뜸 ──
  let aligned = null;
  if (guideRef && !calibrating) {
    const gp = projectGuide(guideRef, lms);
    if (gp && lms[7] && lms[8]) {
      const gEar = pp(gp.ear), gEarL = pp(gp.earL), gEarR = pp(gp.earR);
      const shMid = mid(LM.SH_L, LM.SH_R);
      const liveEar = mid(LM.EAR_L, LM.EAR_R);
      const off = Math.hypot(liveEar[0] - gEar[0], liveEar[1] - gEar[1]);
      const headSpan = Math.hypot(gEarR[0] - gEarL[0], gEarR[1] - gEarL[1]);
      aligned = off < Math.max(24, headSpan * 0.5);
      const gcol = aligned ? "rgba(90,190,90,0.85)" : "rgba(230,170,60,0.9)";
      ctx.save();
      ctx.setLineDash([7, 6]); ctx.lineWidth = 2.5; ctx.strokeStyle = gcol;
      ctx.beginPath(); ctx.moveTo(...gEarL); ctx.lineTo(...gEarR); ctx.stroke();      // 목표 귀선
      const hr = headSpan * 0.62 + 14;
      ctx.beginPath(); ctx.arc(gEar[0], gEar[1], hr, 0, 7); ctx.stroke();             // 목표 머리
      ctx.beginPath(); ctx.moveTo(...gEar); ctx.lineTo(...shMid); ctx.stroke();       // 목표 목선
      ctx.setLineDash([]);
      ctx.fillStyle = gcol; ctx.font = "12px sans-serif"; ctx.textAlign = "center";
      ctx.fillText("🎯 바른자세", gEar[0], gEar[1] - hr - 8);
      ctx.textAlign = "left";
      if (!aligned) { // 라이브 머리 → 목표로 유도선
        ctx.strokeStyle = "rgba(230,170,60,0.55)"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(...liveEar); ctx.lineTo(...gEar); ctx.stroke();
      }
      ctx.restore();
    }
  }

  // ── 라이브 스켈레톤 (상반신 뼈대) ──
  ctx.lineCap = "round";
  ctx.strokeStyle = "#46525f"; ctx.lineWidth = 2.5;
  const bones = [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24]];
  for (const [a, b] of bones) {
    if (!lms[a] || !lms[b]) continue;
    ctx.beginPath(); ctx.moveTo(...px(a)); ctx.lineTo(...px(b)); ctx.stroke();
  }
  // 목선 = 상태색으로 강조 (거북목 판정의 핵심 축)
  ctx.lineWidth = 3.5; ctx.strokeStyle = stateCol;
  ctx.beginPath(); ctx.moveTo(...mid(LM.EAR_L, LM.EAR_R)); ctx.lineTo(...mid(LM.SH_L, LM.SH_R)); ctx.stroke();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = "#5abe5a"; ctx.beginPath(); ctx.moveTo(...px(LM.SH_L)); ctx.lineTo(...px(LM.SH_R)); ctx.stroke();
  ctx.strokeStyle = "#e6aa3c"; ctx.beginPath(); ctx.moveTo(...px(LM.EAR_L)); ctx.lineTo(...px(LM.EAR_R)); ctx.stroke();
  // 얼굴 디테일 — 눈(2,5)·입(9-10)·코 로 머리 방향이 보이게
  ctx.fillStyle = "#cdd6df";
  for (const i of [2, 5]) if (lms[i]) { const [x, y] = px(i); ctx.beginPath(); ctx.arc(x, y, 2.6, 0, 7); ctx.fill(); }
  if (lms[9] && lms[10]) { ctx.strokeStyle = "#cdd6df"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(...px(9)); ctx.lineTo(...px(10)); ctx.stroke(); }
  // 코 → 머리방향 힌트(짧은 선)
  if (lms[0]) { ctx.strokeStyle = "#e6763c"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(...mid(LM.EAR_L, LM.EAR_R)); ctx.lineTo(...px(LM.NOSE)); ctx.stroke(); }
  // 키포인트
  for (const [i, c] of Object.entries(KEYPT)) {
    const [x, y] = px(+i);
    ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, 5, 0, 7); ctx.fill();
    if ((lms[+i].visibility ?? 1) < 0.5) {
      ctx.strokeStyle = "#e64545"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, 9, 0, 7); ctx.stroke();
    }
  }
  // 문제 부위 펄스 링 (BAD일 때 worst 신호 위치)
  const worst = window.__pgLive?.worst;
  if (worst && state === "BAD") {
    const pr = 13 + 4 * Math.sin(performance.now() / 160);
    ctx.strokeStyle = "#e64545"; ctx.lineWidth = 2;
    for (const t of (worst === "shoulder_roll" ? [LM.SH_L, LM.SH_R] : [LM.EAR_L, LM.EAR_R])) {
      const [x, y] = px(t); ctx.beginPath(); ctx.arc(x, y, pr, 0, 7); ctx.stroke();
    }
  }

  // ── 각도·정렬 수치 (좌상단) ──
  const readout = [];
  if (lastAbs?.shoulderTilt != null) readout.push(["어깨 수평도", `${lastAbs.shoulderTilt.toFixed(0)}°`, lastAbs.shoulderTilt > 12]);
  if (lastAbs?.headPitch != null) readout.push(["머리 각도", `${lastAbs.headPitch >= 0 ? "+" : ""}${lastAbs.headPitch.toFixed(0)}°`, false]);
  if (guideRef && aligned != null) readout.push(["머리 정렬", aligned ? "좋음 ✓" : "숙임/거북목", !aligned]);
  ctx.font = "13px sans-serif"; ctx.textAlign = "left";
  readout.forEach(([label, val, warn], i) => {
    const y = 22 + i * 21;
    ctx.fillStyle = "#8b98a5"; ctx.fillText(label, 12, y);
    ctx.fillStyle = warn ? "#e6aa3c" : "#e7ecf1"; ctx.fillText(val, 108, y);
  });

  // ── 자세 신호 막대 (하단) — 쉬운 한국어 라벨 ──
  if (zs && Object.keys(zs).length) {
    ctx.font = "13px sans-serif"; ctx.textAlign = "left";
    SIGNAL_KEYS.forEach((k, i) => {
      const y = h - 92 + i * 22, x0 = 168, bw = 150;
      ctx.fillStyle = "#e7ecf1";
      ctx.fillText(SIGNAL_KR[k] || k, 12, y + 4);
      ctx.fillStyle = "#8b98a5";
      ctx.fillText(`${zs[k] >= 0 ? "+" : ""}${zs[k].toFixed(1)}`, 112, y + 4);
      ctx.strokeStyle = "#3a444f"; ctx.strokeRect(x0, y - 8, bw, 14);
      const dz = x0 + (TUNING.DEADZONE_Z / 5) * bw;
      ctx.strokeStyle = "#8b98a5";
      ctx.beginPath(); ctx.moveTo(dz, y - 8); ctx.lineTo(dz, y + 6); ctx.stroke();
      const bar = Math.min(Math.max(zs[k], 0), 5) / 5 * bw;
      ctx.fillStyle = zs[k] > TUNING.DEADZONE_Z ? "#e64545" : "#5abe5a";
      ctx.fillRect(x0, y - 8, bar, 14);
    });
  } else if (!judge) {
    ctx.fillStyle = "#8b98a5"; ctx.font = "13px sans-serif";
    ctx.fillText("[바른자세 기준 등록]을 하면 신호와 가이드가 표시됩니다", 12, h - 20);
  }
}

// ── 미니 모드 (PiP) ──
function drawMini(state, score, face, badCand, now) {
  const ctx = els.miniCanvas.getContext("2d");
  const { width: w, height: h } = els.miniCanvas;
  ctx.fillStyle = "#171c22"; ctx.fillRect(0, 0, w, h);
  const atlas = skinAtlas();
  const useSprite = atlas && atlas.complete && atlas.naturalWidth > 0;
  if (useSprite) {
    const { row, fps } = SPRITE.rows[spriteAnim(state, now)];
    const frame = Math.floor(now * fps) % SPRITE.cols;
    ctx.globalAlpha = state === "AWAY" || state === "UNCALIBRATED" ? 0.5 : 1;
    ctx.drawImage(atlas, frame * SPRITE.cell, row * SPRITE.cell, SPRITE.cell, SPRITE.cell,
                  8, (h - 72) / 2, 72, 72);
    ctx.globalAlpha = 1;
  } else {
    ctx.font = "40px serif";
    ctx.fillText(face, 14, h / 2 + 15);
  }
  ctx.fillStyle = STATE_COLOR[state];
  ctx.beginPath(); ctx.arc(96, h / 2, 8, 0, 7); ctx.fill();
  ctx.fillStyle = "#e7ecf1"; ctx.font = "bold 24px sans-serif";
  ctx.fillText(score === null ? state : `${state} ${Math.round(score)}`, 112, h / 2 + 9);
}

let docPip = null; // Document PiP (Chrome): HTML 창이라 GIF가 원래 속도로 재생됨

async function togglePip() {
  try {
    if (docPip) { docPip.win.close(); docPip = null; els.msg.textContent = "미니 모드 껐어요."; return; }
    if (document.pictureInPictureElement) { await document.exitPictureInPicture(); return; }
    if (els.miniVideo.webkitPresentationMode === "picture-in-picture") {
      els.miniVideo.webkitSetPresentationMode("inline");
      return;
    }

    // iOS/iPadOS: 웹 미니 창(PiP)을 지원하지 않는다(Document PiP 미지원 + 캔버스 PiP 차단 +
    // 백그라운드 시 웹앱 정지). 헛도는 시도 대신 현실적인 사용법을 안내.
    const ua = navigator.userAgent;
    const isIpad = /ipad/i.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/i.test(ua));
    const isIOSFamily = /iphone|ipod/i.test(ua) || isIpad;
    if (isIOSFamily && !("documentPictureInPicture" in window)) {
      els.msg.textContent = isIpad
        ? "아이패드는 미니 창(PiP)을 지원하지 않아요 — 스플릿 뷰로 공부 앱 옆에 두고 쓰면 됩니다."
        : "아이폰은 미니 창(PiP)을 지원하지 않아요 — 화면을 켜둔 채로 두고 쓰세요 (알림·진동은 그대로 작동).";
      return;
    }

    if ("documentPictureInPicture" in window) {
      try {
        await openDocPip();
        return;
      } catch { /* 환경이 Document PiP를 못 열면 아래 캔버스 방식으로 폴백 */ }
    }

    // 폴백 (Safari·iOS 등): 캔버스 → 비디오 PiP. 예열된 스트림을 쓰고 await를 앞세우지 않아
    // user activation("The request is not triggered by a user activation")이 만료되지 않게 한다.
    drawMini(sm.state, null, rewards.fairy(sm.state, 0, false), false, nowSec()); // 최소 1프레임 보장
    if (!els.miniVideo.srcObject) {
      els.miniVideo.srcObject = els.miniCanvas.captureStream(2);
      els.miniVideo.play().catch(() => {});
    }
    if (typeof els.miniVideo.webkitSetPresentationMode === "function"
        && !els.miniVideo.requestPictureInPicture) {
      els.miniVideo.webkitSetPresentationMode("picture-in-picture"); // iOS WebKit 전용 경로
    } else {
      await els.miniVideo.requestPictureInPicture();
    }
    els.msg.textContent = "미니 모드 켜짐 — 작은 창이 모든 앱 위에 떠 있습니다.";
  } catch (e) {
    els.msg.textContent = "미니 모드 실패: " + e.message;
  }
}

async function openDocPip() {
  const win = await documentPictureInPicture.requestWindow({ width: 300, height: 110 });
      win.document.head.innerHTML = `<style>
        body { margin:0; height:100vh; box-sizing:border-box; padding:10px 14px;
               display:flex; align-items:center; gap:12px; background:#171c22; color:#e7ecf1;
               font-family:-apple-system,"Apple SD Gothic Neo",sans-serif; }
        img { width:72px; height:72px; image-rendering:pixelated; }
        img.dim { filter:grayscale(.8) opacity(.55); }
        .emoji { font-size:44px; display:none; }
        .dot { width:16px; height:16px; border-radius:50%; flex:none; }
        .label { font-size:22px; font-weight:700; white-space:nowrap; }
      </style>`;
      win.document.body.innerHTML =
        `<img alt="척추요정"><span class="emoji"></span><span class="dot"></span><span class="label"></span>`;
      docPip = {
        win,
        img: win.document.querySelector("img"),
        emoji: win.document.querySelector(".emoji"),
        dot: win.document.querySelector(".dot"),
        label: win.document.querySelector(".label"),
      };
      win.addEventListener("pagehide", () => { docPip = null; });
      updateDocPip(sm.state, null, nowSec());
      els.msg.textContent = "미니 모드 켜짐 — 작은 창이 모든 앱 위에 떠 있습니다.";
}

function updateDocPip(state, score, now) {
  if (!docPip) return;
  if (rewards.shop.skin === "fairy") {
    docPip.img.style.display = "";
    docPip.emoji.style.display = "none";
    const src = `assets/fairy/${spriteAnim(state, now)}.gif`;
    if (!docPip.img.src.endsWith(src)) docPip.img.src = new URL(src, location.href).href;
    docPip.img.classList.toggle("dim", state === "AWAY" || state === "UNCALIBRATED");
  } else {
    docPip.img.style.display = "none";
    docPip.emoji.style.display = "";
    docPip.emoji.textContent = rewards.fairy(state, sm.stateSince ? now - sm.stateSince : 0, sm.cand?.[0] === "BAD");
  }
  docPip.dot.style.background = STATE_COLOR[state];
  docPip.label.textContent = score === null ? state : `${state} ${Math.round(score)}`;
}

// ── 오늘 리포트 ──
function fmtMin(sec) { return (sec / 60).toFixed(1) + "분"; }
function openReport() {
  const rep = computeReport(events, dayStartSec(), nowSec());
  const todayEarned = rewards.today.date === dateStr() ? rewards.today.earned : 0;
  const bt = blinkTodayStats();
  const rows = [
    ["총 감시 시간", fmtMin(rep.watched)],
    ["바른 자세", `${fmtMin(rep.good)}${rep.ratio !== null ? ` (${Math.round(rep.ratio * 100)}%)` : ""}`],
    ["나쁜 자세", `${fmtMin(rep.bad)} · ${rep.badCount}회`],
    ["최장 연속 바른 자세", fmtMin(rep.longestGood)],
  ];
  if (blinkEnabled || bt.n) // 눈 깜빡임: 오늘 평균(분당). 정상 15~20
    rows.push(["👁 오늘 평균 깜빡임", bt.n ? `분당 ${bt.avg}회 (정상 ${BLINK_NORMAL_LO}~${BLINK_NORMAL_HI})` : "아직 측정 전"]);
  rows.push(["오늘 얻은 포인트", `+${todayEarned}P`]);
  els.reportTable.innerHTML = rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("");
  els.reportGrade.textContent = rep.grade;
  // 등급별 캐릭터: 90%+ 칭찬 / 70%+ 평온 / 그 미만 거북목 아픔 (방치의 결과)
  const gradeAnim = rep.ratio === null ? "idle" :
    rep.ratio >= 0.9 ? "praise" : rep.ratio >= 0.7 ? "idle" : "hurt_neck";
  const rdir = currentSkin().spriteDir || "assets/fairy"; // 이모지 스킨이면 기본 요정 GIF로
  $("report-fairy").src = `${rdir}/${gradeAnim}.gif`;
  els.reportOverlay.classList.add("open");
}

// ── 설정 UI ──
function initSettings() {
  for (const [k, m] of Object.entries(MELODIES)) {
    els.setMelody.add(new Option(m.label, k));
  }
  const s = rewards.settings;
  els.setMode.value = s.mode;
  els.setMelody.value = s.melody;
  els.setVolume.value = Math.round(s.volume * 100);
  const vmap = { weak: "1", mid: "2", strong: "3" }; // 구버전(세기) 설정 마이그레이션
  els.setVibrate.value = vmap[s.vibrate] || s.vibrate;
  if (!navigator.vibrate) { // 아이폰(WebKit): 진동 API 없음 — 알림 재발송으로 횟수 유도
    const hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent = "※ 아이폰은 알림을 횟수만큼 다시 울려 진동을 만들어요 (1.5초 간격, 설치형 웹앱에서 동작).";
    els.setVibrate.closest("details").appendChild(hint);
  }

  const save = () => {
    rewards.settings = {
      mode: els.setMode.value, melody: els.setMelody.value,
      volume: els.setVolume.value / 100, vibrate: els.setVibrate.value,
    };
    rewards._save();
  };
  for (const el of [els.setMode, els.setMelody, els.setVolume, els.setVibrate]) {
    el.addEventListener("change", save);
  }
  els.setMelody.addEventListener("change", () => playNotes(MELODIES[els.setMelody.value].notes, rewards.settings.volume));
  els.btnTest.onclick = () => {
    const m = `${rewards.fairy("BAD", 0, false)} 알림 테스트예요`;
    notify(m); playAlert(1, m);
  };
}

// ── 상점 UI ──
function buyItem(item) {
  const r = rewards.buy(item.id);
  els.msg.textContent = r.msg;
  if (r.ok) {
    renderShop(); flashPoints();
    rewardUntil = nowSec() + 2.5; // "보상 받았어요!" 모션
    updateFairyVisual(sm.state, false, nowSec(), rewards.fairy(sm.state, 0, false));
  }
  els.points.textContent = `🪙 ${rewards.points}P`;
}

function renderShop() {
  els.shopList.innerHTML = "";
  // 등급별 스킨 (레어/에픽/프리미엄)
  for (const tier of TIERS) {
    const items = SHOP.filter((i) => i.type === "skin" && i.tier === tier.id);
    if (!items.length) continue;
    const sec = document.createElement("div");
    sec.className = `tier tier-${tier.id}`;
    sec.innerHTML = `<div class="tier-head"><b>${tier.label}</b><span>${tier.sub}</span></div>`;
    const grid = document.createElement("div");
    grid.className = "tier-grid";
    for (const item of items) {
      const owned = rewards.shop.owned.includes(item.id);
      const sk = SKINS[item.key];
      const card = document.createElement("div");
      card.className = "skin-card";
      const thumb = item.soon
        ? `<div class="skin-thumb lock">🔒</div>`
        : `<img class="skin-thumb" src="${sk.spriteDir}/idle.gif" alt="${item.label}" loading="lazy">`;
      const action = item.soon ? `<span class="soon-tag">준비 중</span>`
        : owned ? `<span class="owned-tag">✓ 보유</span>`
        : `<button class="buy-btn">Ⓟ ${item.price.toLocaleString()}</button>`;
      card.innerHTML = `${thumb}<div class="skin-name">${item.label}</div><div class="skin-action">${action}</div>`;
      if (!item.soon && !owned) card.querySelector(".buy-btn").onclick = () => buyItem(item);
      grid.appendChild(card);
    }
    sec.appendChild(grid);
    els.shopList.appendChild(sec);
  }
  renderEquip(); // 캐릭터 페이지 보유 목록 그리드
}
// 캐릭터 페이지 — 보유한 요정/테마를 그리드로 보여주고 눌러서 바로 장착 (상점 카드처럼)
function renderEquip() {
  const grid = $("equip-grid");
  if (!grid) return;
  const skinCard = (k) => {
    const sk = SKINS[k] || SKINS.fairy;
    const on = rewards.shop.skin === k;
    const thumb = sk.spriteDir
      ? `<img class="equip-thumb" src="${sk.spriteDir}/idle.gif" alt="" loading="lazy">`
      : `<div class="equip-thumb emoji">${sk.good}</div>`;
    return `<button class="equip-card${on ? " on" : ""}" data-type="skin" data-key="${k}">
      ${thumb}<span class="equip-name">${sk.label}</span>
      ${on ? '<span class="equip-badge">장착 중</span>' : ""}</button>`;
  };
  grid.innerHTML =
    `<div class="equip-sec-t">요정 (${rewards.ownedOf("skin").length})</div>` +
    `<div class="equip-cards">${rewards.ownedOf("skin").map(skinCard).join("")}</div>`;
}

// ── 그룹 랭킹 (백엔드 1단계 — 로그인 없음: 익명 기기 ID + 닉네임, docs/백엔드-설계.md) ──
const memberId = (() => {
  let id = localStorage.getItem("pg_member_id");
  if (!id) { id = crypto.randomUUID(); localStorage.setItem("pg_member_id", id); }
  return id;
})();
// ── 다중 그룹 ── 한 기기가 여러 그룹 참여. pg_group=활성 그룹(기존 코드 호환), pg_groups=전체 목록.
const LS_ACTIVE = "pg_group", LS_GROUPS = "pg_groups";
const myGroup = () => { try { return JSON.parse(localStorage.getItem(LS_ACTIVE) || "null"); } catch { return null; } };
const myGroups = () => { try { return JSON.parse(localStorage.getItem(LS_GROUPS) || "[]") || []; } catch { return []; } };
const saveGroups = (list) => localStorage.setItem(LS_GROUPS, JSON.stringify(list));
function setActiveGroup(code) {
  const g = myGroups().find((x) => x.code === code);
  if (g) localStorage.setItem(LS_ACTIVE, JSON.stringify(g));
  else localStorage.removeItem(LS_ACTIVE);
}
function upsertGroup(g) { saveGroups([...myGroups().filter((x) => x.code !== g.code), g]); }
function removeGroup(code) { saveGroups(myGroups().filter((x) => x.code !== code)); }
// 마이그레이션: 예전 단일 pg_group만 있고 목록이 비면 목록으로 승격
(() => { if (!myGroups().length) { const g = myGroup(); if (g && g.code) saveGroups([g]); } })();

function weekStart() { // 이번 주 월요일 00:00
  const d = new Date();
  d.setDate(d.getDate() - (d.getDay() + 6) % 7);
  d.setHours(0, 0, 0, 0);
  return d;
}
const weekKey = () => {
  const d = weekStart();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
function weeklyGoodSec() { // 이번 주 GOOD 누적 (상태 전이 기록에서 계산)
  const t0 = weekStart().getTime() / 1000, now = nowSec();
  // 열린(마지막) 세그먼트는 '마지막 실제 감지 시각'까지만 — 백그라운드로 앱이 멈춰 있던 시간은 안 셈.
  const openEnd = Math.min(now, lastActiveSec || now);
  let acc = 0;
  for (let i = 0; i < events.length; i++) {
    if (events[i].to !== "GOOD") continue;
    const start = Math.max(events[i].t, t0);
    const end = i + 1 < events.length ? events[i + 1].t : openEnd;
    if (end > start) acc += end - start;
  }
  return Math.round(acc);
}
const API_BASE = "https://34-64-158-222.sslip.io"; // GCP VM(Compute Engine) + PostgreSQL, Caddy 자동 HTTPS (docs/백엔드-설계.md)
async function api(path, body) {
  const res = await fetch(`${API_BASE}/api/${path}`, body === undefined ? undefined : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
async function uploadStats() {
  if (!myGroup() || document.hidden) return; // 백그라운드면 부풀려질 수 있는 값 업로드 방지
  try { await api("stats", { memberId, week: weekKey(), goodSec: weeklyGoodSec(), points: rewards.points, streak: attendStreak() }); } catch {}
}
async function refreshLeaderboard() {
  const g = myGroup();
  const info = $("group-info"), board = $("leaderboard");
  if (!g) { info.textContent = ""; board.innerHTML = ""; return; } // 방 목록 빈-상태 안내가 대신함
  info.textContent = ""; // 방 카드에 이미 이름·코드·닉네임 있음 — 중복 제거, 에러일 때만 표시
  try {
    const { rows, champions } = await api(`leaderboard?code=${g.code}&week=${weekKey()}`);
    board.innerHTML = renderHallOfFame(rows, champions);
  } catch (e) {
    board.innerHTML = "";
    info.textContent = `랭킹 불러오기 실패 (${e.message})`;
  }
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const _dkey = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
// 연속 출석일수 — pg_attend_days(YYYY-MM-DD 배열)에서 오늘/어제부터 이어지는 날 수. 오늘 미출석이면 어제부터 카운트(streak 유지).
function attendStreak() {
  let days = [];
  try { days = JSON.parse(localStorage.getItem("pg_attend_days") || "[]"); } catch {}
  const set = new Set(days);
  if (!set.size) return 0;
  const d = new Date(); d.setHours(0, 0, 0, 0);
  if (!set.has(_dkey(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (set.has(_dkey(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
// 리더보드 행 → 장착 스킨의 idle.gif 경로. 내 행은 방금 바꾼 스킨을 즉시 반영. 경로는 하드코딩 SKINS.spriteDir만 사용(주입 안전).
function avatarFor(r) {
  const key = r.member_id === memberId ? rewards.shop.skin : r.skin;
  const sk = SKINS[key];
  const dir = sk && sk.spriteDir ? sk.spriteDir : "assets/fairy";
  return `/${dir}/idle.gif`;
}
const AVA_FALLBACK = "this.onerror=null;this.src='/assets/fairy/idle.gif'"; // 미배포 스킨 폴더 방어
// "2026-07-14" (월요일) → "7/14 주"
const champWeekLabel = (w) => { const [, m, d] = w.split("-"); return `${+m}/${+d} 주`; };
// 상태: 오프라인(무소식 90s+/자리비움) · 집중 이탈(나쁜 자세) · 활동 중(바른 자세)
function statusOf(r) {
  const online = r.ago_sec != null && r.ago_sec <= 90;
  if (!online || r.state === "AWAY") return { cls: "offline", dot: "off", label: "오프라인" };
  if (r.state === "BAD") return { cls: "distracted", dot: "bad", label: "집중 이탈" };
  return { cls: "active", dot: "good", label: "활동 중" };
}
function podCard(r, rank) {
  if (!r) return `<div class="pod pod-${rank} empty"><div class="pod-rank">${rank}</div><div class="pod-name">—</div></div>`;
  const me = r.member_id === memberId;
  const s = statusOf(r);
  return `<div class="pod pod-${rank}${me ? " me" : ""}">
    <div class="pod-rank">${rank}</div>
    <div class="pod-ava-wrap"><img class="pod-ava" src="${avatarFor(r)}" onerror="${AVA_FALLBACK}" alt="요정"></div>
    <div class="pod-name">${esc(r.nickname)}${me ? " (나)" : ""}</div>
    <div class="pod-stat ${s.cls}"><span class="dot ${s.dot}"></span>${s.label}</div>
    <div class="pod-score">${(r.good_sec / 60).toFixed(0)}분 · ${r.points}P</div>
  </div>`;
}
function renderHallOfFame(rows, champions = []) {
  const podium = `<div class="podium">${podCard(rows[1], 2)}${podCard(rows[0], 1)}${podCard(rows[2], 3)}</div>`;
  const rest = rows.slice(3).map((r, i) => {
    const me = r.member_id === memberId;
    const s = statusOf(r);
    return `<div class="hof-row${me ? " me" : ""}">
      <span class="hof-num">${i + 4}</span>
      <img class="hof-ava" src="${avatarFor(r)}" onerror="${AVA_FALLBACK}" alt="">
      <span class="hof-nick">${esc(r.nickname)}${me ? " (나)" : ""}</span>
      <span class="hof-status ${s.cls}"><span class="dot ${s.dot}"></span>${s.label}</span>
    </div>`;
  }).join("");
  return `<div class="hof">
    <div class="hof-head"><div class="hof-title">🏆 명예의 전당</div>
      <div class="hof-sub">바른 자세로 빛나는 우리의 기록!</div></div>
    ${podium}
    <div class="hof-legend"><span><span class="dot good"></span>활동 중</span>
      <span><span class="dot off"></span>오프라인</span>
      <span><span class="dot bad"></span>집중 이탈</span></div>
    ${rest ? `<div class="hof-list">${rest}</div>` : ""}
    ${renderHofCards(rows, champions)}
  </div>`;
}
// 실데이터 배지 — 🔥 최고 연속출석자 · 👑 이번 주 1위 · 역대 챔피언(명예의 전당)
function renderHofCards(rows, champions) {
  const topStreak = rows.filter((r) => (r.streak || 0) >= 2).sort((a, b) => b.streak - a.streak)[0];
  const leader = rows[0] && rows[0].good_sec > 0 ? rows[0] : null;
  const streakCard = topStreak
    ? `<span class="hof-ic">🔥</span><span><b>${esc(topStreak.nickname)}</b> — ${topStreak.streak}일 연속 출석 중!</span>`
    : `<span class="hof-ic">🔥</span><span>연속 출석에 도전! 매일 켜면 <b>연속 배지</b>를 얻어요.</span>`;
  const crownCard = leader
    ? `<span class="hof-ic">👑</span><span>이번 주 1위 <b>${esc(leader.nickname)}</b> · ${(leader.good_sec / 60).toFixed(0)}분</span>`
    : `<span class="hof-ic">👑</span><span>이번 주 1위 자리는 아직 비어있어요!</span>`;
  const champs = (champions && champions.length)
    ? `<div class="hof-champs"><div class="hof-champs-t">👑 역대 챔피언</div>${champions.map((c) =>
        `<div class="champ-row"><span class="champ-week">${champWeekLabel(c.week)}</span>` +
        `<span class="champ-nick">🏅 ${esc(c.nickname)}</span>` +
        `<span class="champ-sec">${(c.good_sec / 60).toFixed(0)}분</span></div>`).join("")}</div>`
    : "";
  return `<div class="hof-cards">
      <div class="hof-card">${streakCard}</div>
      <div class="hof-card">${crownCard}</div>
    </div>${champs}`;
}
// 콕 찌르기는 실시간 그리드(친구 타일)에서만 — 랭킹에선 제거(1·2위 카드 높이 불일치 해소)
$("btn-group-create").onclick = async () => {
  const name = $("group-name").value.trim();
  if (!name) { els.msg.textContent = "그룹 이름을 입력해주세요."; return; }
  try {
    const g = await api("group", { name });
    $("group-code").value = g.code;
    els.msg.textContent = `그룹 "${g.name}" 생성! 코드 ${g.code}를 친구들에게 알려주고, 닉네임 입력 후 [참여하기].`;
  } catch (e) { els.msg.textContent = "그룹 생성 실패: " + e.message; }
};
$("btn-group-join").onclick = async () => {
  const code = $("group-code").value.trim().toUpperCase();
  const nickname = $("group-nick").value.trim();
  if (!code || !nickname) { els.msg.textContent = "코드와 닉네임을 입력해주세요."; return; }
  try {
    const { name } = await api("join", { code, nickname, memberId });
    upsertGroup({ code, name, nickname });  // 목록에 추가(다른 그룹 유지)
    setActiveGroup(code);                    // 방금 들어간 그룹을 활성으로
    renderGroupSwitcher();
    els.msg.textContent = `"${name}" 그룹 참여 완료!`;
    await uploadStats();
    refreshLeaderboard();
    reconcileGroups();                       // 멤버 수 등 서버 목록으로 갱신
  } catch (e) { els.msg.textContent = "참여 실패: " + e.message; }
};
// ── 방(그룹) 목록 렌더 + 전환/나가기 ── 카드 탭=전환, [나가기]=탈퇴
function renderGroupSwitcher() {
  const el = $("group-switcher");
  if (!el) return;
  const list = myGroups(), active = myGroup();
  const add = $("group-add");
  if (add) add.open = !list.length; // 그룹 없으면 추가 폼 펼침, 있으면 접어 단순화
  if (!list.length) {
    el.innerHTML = `<div class="gl-empty">아직 들어간 그룹이 없어요.<br>아래에서 그룹을 만들거나 코드로 참여해요 👇</div>`;
    return;
  }
  const multi = list.length > 1;
  el.innerHTML = `<div class="gl-label">🏠 내 그룹${multi ? ` ${list.length}개 · 탭해서 이동` : ""}</div>` +
    `<div class="gl-list">` + list.map((g) => {
      const on = active && active.code === g.code;
      const cnt = g.members ? `<span class="gl-cnt">· 👥 ${g.members}명</span>` : "";
      const badge = (on && multi) ? `<span class="gl-badge">보는 중</span>` : "";
      return `<div class="gl-room${on ? " active" : ""}" data-code="${g.code}">
        <div class="gl-avatar">${on ? "🟢" : "🏠"}</div>
        <div class="gl-body">
          <div class="gl-top"><span class="gl-name">${esc(g.name)}</span>${badge}</div>
          <div class="gl-meta">코드 ${g.code} · 나: ${esc(g.nickname)} ${cnt}</div>
        </div>
        <button class="gl-leave" data-leave="${g.code}" title="이 그룹에서 나가기">나가기</button>
      </div>`;
    }).join("") + `</div>`;
}
$("group-switcher")?.addEventListener("click", async (e) => {
  const lv = e.target.closest(".gl-leave");
  if (lv) { // 나가기
    e.stopPropagation();
    const code = lv.dataset.leave, g = myGroups().find((v) => v.code === code);
    if (!confirm(`'${g ? g.name : code}' 그룹에서 나갈까요?`)) return;
    try { await api("leave", { memberId, code }); } catch {}
    removeGroup(code);
    if (myGroup()?.code === code) { const rest = myGroups(); setActiveGroup(rest.length ? rest[0].code : null); }
    renderGroupSwitcher();
    refreshLeaderboard();
    return;
  }
  const room = e.target.closest(".gl-room");
  if (!room || myGroup()?.code === room.dataset.code) return; // 이미 보는 중이면 무시
  setActiveGroup(room.dataset.code);
  renderGroupSwitcher();
  await uploadStats();
  refreshLeaderboard();
});
// 서버 진실과 목록 동기화(다른 기기·초기화 대비) — 백엔드 미배포면 조용히 무시
async function reconcileGroups() {
  try {
    const { groups } = await api(`my-groups?memberId=${memberId}`);
    if (!Array.isArray(groups)) return;
    saveGroups(groups);
    const act = myGroup();
    if (groups.length) setActiveGroup(act && groups.find((g) => g.code === act.code) ? act.code : groups[0].code);
    else setActiveGroup(null);
    renderGroupSwitcher();
    refreshLeaderboard();
  } catch {}
}
$("group").addEventListener("toggle", () => { if ($("group").open) { uploadStats().then(refreshLeaderboard); } });
setInterval(uploadStats, 5 * 60 * 1000); // 5분마다 집계 업로드

// 실시간 상태 공유 + 콕 수신 (그룹 소속일 때만, 30초 주기)
async function uploadPresence() {
  if (!running || !myGroup()) return;
  try { await api("presence", { memberId, state: sm.state, skin: rewards.shop.skin }); } catch {}
}
async function pollNudges() {
  if (!myGroup()) return;
  try {
    const { nudges } = await api(`nudges?memberId=${memberId}`);
    for (const n of nudges) {
      const m = `👉 ${n.from_nick}님이 자세 펴라고 콕 찔렀어요!`;
      notify(m); playAlert(1, m);
    }
  } catch {}
}
setInterval(uploadPresence, 30_000);
setInterval(pollNudges, 30_000);
renderGroupSwitcher();  // 로컬 목록으로 즉시 칩 표시
refreshLeaderboard();   // 그룹 페이지는 기본 열림 — 첫 로드 시 표시
reconcileGroups();      // 서버 목록과 동기화(비동기)
setInterval(() => { if ($("group").open) refreshLeaderboard(); }, 30_000); // 상태 점 주기 갱신

// ── 버튼 ──
els.btnStart.onclick = () => { if (running) stop(); else start(); };
els.btnCalib.onclick = () => {
  calibUntil = nowSec() + TUNING.CALIB_SECS;
  calibSamples = []; absCalibSamples = []; guideCalibSamples = []; absSmoother = new AbsSmoother();
  speak("바르게! 귀·어깨 일직선, 화면 눈높이 🧘");
};
els.btnNotify.onclick = async () => {
  playNotes(MELODIES.sparkle.notes, rewards.settings.volume); // 사용자 제스처로 오디오 잠금 해제 (아이폰 필수 — 가장 먼저)
  if (typeof Notification === "undefined") {
    els.msg.textContent = "이 브라우저(아이폰 등)는 배너 알림 미지원 — 화면 안 알림 + 소리로 대신해요. 무음 스위치를 꺼주세요.";
    return;
  }
  const r = await Notification.requestPermission();
  els.msg.textContent = r === "granted" ? "알림 허용됨." : "알림이 거부되어 있어요 (브라우저 설정에서 변경).";
};
els.btnPip.onclick = togglePip;
els.btnReport.onclick = openReport;
els.btnFace.onclick = () => {
  const hidden = els.camPanel.classList.toggle("face-hidden");
  els.btnFace.textContent = hidden ? "얼굴 보이기" : "얼굴 가리기";
  localStorage.setItem("pg_face_hidden", hidden ? "1" : "0");
  updateFaceCover(sm.state, nowSec(), rewards.fairy(sm.state, 0, false));
};
if (localStorage.getItem("pg_face_hidden") === "1") { // 저장된 선호 복원
  els.camPanel.classList.add("face-hidden");
  els.btnFace.textContent = "얼굴 보이기";
  updateFaceCover(sm.state, nowSec(), rewards.fairy(sm.state, 0, false));
}

// 눈 깜빡임 토글
els.setBlink.checked = blinkEnabled;
els.setBlink.onchange = () => {
  blinkEnabled = els.setBlink.checked;
  localStorage.setItem("pg_blink", blinkEnabled ? "1" : "0");
  if (blinkEnabled) {
    if (running) { ensureFaceModel(); nextBlinkAt = nowSec() + BLINK_FIRST_DELAY; } // 모델이 이미 로드돼 있어도 15초 지연 보장
    else els.blinkStatus.textContent = "카메라를 시작하면 측정을 시작해요";
  } else {
    blinkSampling = false;
    els.blink.style.display = "none";
    els.blinkStatus.textContent = "";
  }
};
$("btn-report-close").onclick = () => els.reportOverlay.classList.remove("open");
els.reportOverlay.onclick = (e) => { if (e.target === els.reportOverlay) els.reportOverlay.classList.remove("open"); };
// 보유 목록 그리드 — 카드 클릭으로 즉시 장착 (이벤트 위임: innerHTML 재렌더에도 유지)
$("equip-grid")?.addEventListener("click", (e) => {
  const b = e.target.closest(".equip-card");
  if (!b) return;
  rewards.apply(b.dataset.type, b.dataset.key);
  renderEquip();
});

// ── 초기화 ──
initSettings();
renderShop();
renderSummary();

// 전방머리(headForward) 실기기 검증 오버레이 — URL 에 ?fwd=1 일 때만. 학생 화면엔 안 뜬다.
// 사용법: 바른자세 기준 등록(캘리브) 후, 정자세 vs 거북목에서 Δ(현재-기준)가 유의미하게 갈리는지 관찰.
if (new URLSearchParams(location.search).has("fwd")) {
  const dbg = document.createElement("div");
  dbg.style.cssText = "position:fixed;left:8px;top:8px;z-index:99999;background:rgba(0,0,0,.78);color:#5ec8e0;font:12px/1.55 ui-monospace,monospace;padding:7px 10px;border-radius:9px;white-space:pre;pointer-events:none";
  document.body.appendChild(dbg);
  setInterval(() => {
    const L = window.__pgLive || {};
    const dev = L.fwdDev, fwdBad = dev != null && dev > 0.10;
    const tiltBad = (L.tilt != null && L.tiltRef != null) && (L.tilt > L.tiltRef + 3);
    const spanDrop = (L.span != null && L.spanRef != null) ? (L.spanRef - L.span) / L.spanRef : null;
    const spanBad = spanDrop != null && spanDrop > 0.06;
    dbg.textContent =
      `자세 게이트 진단\n` +
      `게이트: ${L.absOn ? "ON ✅" : "OFF ❌(재캘리브 필요)"}\n` +
      `총 페널티: ${L.absPen ?? "-"}\n` +
      `─ 거북목 fwd: ${L.fwd ?? "-"} / 기준 ${L.fwdRef ?? "-"} · Δ ${dev ?? "-"} ${fwdBad ? "⚠️" : ""}\n` +
      `─ 어깨기울 : ${L.tilt ?? "-"}° / 기준 ${L.tiltRef ?? "-"}° ${tiltBad ? "⚠️감점" : "(기준+3°~)"}\n` +
      `─ 어깨말림 : ${L.span ?? "-"} / 기준 ${L.spanRef ?? "-"} · 축소 ${spanDrop != null ? (spanDrop * 100).toFixed(0) + "%" : "-"} ${spanBad ? "⚠️감점" : "(6%~)"}\n` +
      `─ 좌우쏠림 : ${L.lat ?? "-"} / 기준 ${L.latRef ?? "-"} ${(L.lat != null && L.latRef != null && Math.abs(L.lat - L.latRef) > 0.12) ? "⚠️감점" : "(±0.12~)"}\n` +
      `─ 갸웃 roll: ${L.roll ?? "-"}° / 기준 ${L.rollRef ?? "-"}° ${(L.roll != null && L.rollRef != null && Math.abs(L.roll - L.rollRef) > 10) ? "⚠️감점" : "(±10°~)"}\n` +
      `─ 턱괴기 hand: ${L.hand ?? "-"} ${(L.hand != null && L.hand < 0.65) ? "⚠️감점" : "(<0.65)"}\n` +
      `─ 머리각 pitch: ${L.pitch ?? "-"}°`;
  }, 300);
}
els.points.textContent = `🪙 ${rewards.points}P`;
updateFairyVisual(sm.state, false, nowSec(), rewards.fairy(sm.state, 0, false));

// ── 배경 라이트/다크 토글 ──
const themeBtn = $("theme-toggle");
function applyMode(mode) {
  document.documentElement.setAttribute("data-theme", mode);
  if (themeBtn) themeBtn.textContent = mode === "light" ? "☀️" : "🌙";
  localStorage.setItem("pg_mode", mode);
}
applyMode(localStorage.getItem("pg_mode") || "dark");
if (themeBtn) themeBtn.onclick = () =>
  applyMode(document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light");

// 그룹 그리드에서 친구가 "자세 콕!"을 보내면(LiveKit 데이터) 알림음·진동·요정 반응
window.addEventListener("pg-nudge", (e) => {
  const from = e?.detail?.from || "친구";
  notify(`🔔 ${from}님이 자세 교정하라고 콕! 찔렀어요 — 허리 펴요!`);
  speak("허리 펴라고 콕! 😤");
});

// ── 홈 화면 설치 안내 ──
// 완전 자동 설치는 어떤 브라우저도 불가(악용 방지). 안드로이드/데스크톱은 네이티브 설치 프롬프트,
// 아이폰은 JS 트리거 불가라 안내 배너만 표시. 이미 설치했거나 닫았으면 안 띄운다.
(function installFlow() {
  const banner = $("install-banner"), text = $("install-text"), action = $("install-action"), close = $("install-close");
  const ua = navigator.userAgent;
  const isIOS = /iphone|ipad|ipod/i.test(ua);
  const isIOSChrome = isIOS && /crios|fxios|edgios/i.test(ua);
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const dismissed = localStorage.getItem("pg_install_dismissed") === "1";
  if (standalone || dismissed) return; // 이미 설치했거나 사용자가 닫음

  const dismiss = () => { banner.classList.remove("show"); localStorage.setItem("pg_install_dismissed", "1"); };
  close.onclick = dismiss;

  let deferred = null;
  // 안드로이드/데스크톱 크롬: 네이티브 설치 프롬프트를 잡아뒀다가 버튼으로 발동
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e;
    text.textContent = "홈 화면에 추가하면 알림·진동까지 제대로 쓸 수 있어요.";
    action.textContent = "설치하기";
    action.style.display = "";
    action.onclick = async () => {
      deferred.prompt();
      await deferred.userChoice;
      deferred = null;
      banner.classList.remove("show");
    };
    banner.classList.add("show");
  });
  window.addEventListener("appinstalled", () => { banner.classList.remove("show"); });

  // 아이폰: 설치를 코드로 띄울 수 없음 → 안내만
  if (isIOS) {
    text.textContent = isIOSChrome
      ? "사파리로 열어 공유 → '홈 화면에 추가'하면 알림·진동을 쓸 수 있어요."
      : "공유 버튼 → '홈 화면에 추가'를 누르면 알림·진동을 쓸 수 있어요.";
    action.style.display = "none"; // 아이폰은 실행 버튼 없이 안내만
    banner.classList.add("show");
  }
})();

// ── PWA ──
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

}
