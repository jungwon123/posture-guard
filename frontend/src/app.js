// 앱 계층: 카메라 → MediaPipe → 코어(판정) → UI/알림/PiP/보상
// 판정 로직은 core.js, 보상·알림설정 규칙은 reward.js (docs/기능-v2.md 참고).
import {
  TUNING, SIGNAL_KEYS, LM, extractSignals, SignalSmoother, Judge,
  StateMachine, finishCalibration, replay,
} from "./core.js";
import { Rewards, MELODIES, SKINS, THEMES, SHOP, TIERS, computeReport } from "./reward.js";

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
  replayLink: $("replay-link"), replayInput: $("replay-input"),
  setMode: $("set-mode"), setMelody: $("set-melody"), setVolume: $("set-volume"),
  setVibrate: $("set-vibrate"), setCustom: $("set-custom"),
  btnSong: $("btn-song"), songFile: $("song-file"), songName: $("song-name"),
  btnTest: $("btn-test"), shopList: $("shop-list"),
  applySkin: $("apply-skin"), applyTheme: $("apply-theme"),
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
let escFired = false;
let lastDetect = 0;
let lastResult = null;
let events = store.loadEvents();

// ── 눈 깜빡임 (베타) — 주기 샘플링. 얼굴 모델은 켤 때만 로드, 샘플 창에서만 추론 (배터리 절약) ──
const BLINK_WINDOW_SEC = 30;    // 한 번 잴 때 30초 측정
const BLINK_INTERVAL_SEC = 180; // 3분마다 측정
const BLINK_FIRST_DELAY = 15;   // 켠 뒤 15초 후 첫 측정
const BLINK_CLOSE = 0.5;        // 눈 감김 점수 이 이상이면 감긴 것
const BLINK_LOW_RATE = 8;       // 분당 이 미만이면 눈 건조 알림
let blinkEnabled = localStorage.getItem("pg_blink") === "1";
let faceLandmarker = null;
let faceLoading = false;
let blinkSampling = false, blinkWinStart = 0, blinkCount = 0, blinkClosed = false, blinkFaceFrames = 0;
let nextBlinkAt = 0;            // 다음 측정 예정 시각(초)
let blinkRate = null;          // 마지막 추정 분당 횟수

const profile = store.loadProfile();
if (profile) { judge = new Judge(profile); sm.state = "GOOD"; }

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
let customAudio = null;
function playAlert(stage, body) { // stage 1=BAD 진입, 2=에스컬레이션. body는 아이폰 재알림용 배너 문구
  const s = rewards.settings;
  const useSound = s.mode === "sound" || s.mode === "both";
  const useVib = s.mode === "vibrate" || s.mode === "both";
  if (useSound) {
    const custom = s.useCustom && localStorage.getItem("pg_custom_audio");
    if (custom) {
      try {
        customAudio = customAudio || new Audio(custom);
        customAudio.volume = s.volume;
        customAudio.currentTime = 0;
        customAudio.play().catch(() => {});
        if (stage === 1) setTimeout(() => customAudio.pause(), 8000); // 1단계는 8초까지만
      } catch {}
    } else {
      const notes = (MELODIES[s.melody] || MELODIES.dingdong).notes;
      playNotes(stage === 2 ? [...notes, [0, 0.15], ...notes] : notes, s.volume);
    }
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
  if (blinkEnabled) ensureFaceModel(); // 눈 깜빡임 켜져 있으면 얼굴 모델 로드
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
  running = false;
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

// ── 눈 깜빡임: 얼굴 모델 (켤 때만 로드) ──
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
      runningMode: "VIDEO", numFaces: 1, outputFaceBlendshapes: true,
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

// 주기 샘플링: 평소엔 쉬고, 정해진 시각에 30초간 깜빡임을 센다
function processBlink(now, wallMs) {
  if (!blinkEnabled || !faceLandmarker || calibUntil !== null) return;

  if (!blinkSampling) {
    if (now < nextBlinkAt) {
      const left = Math.max(0, Math.round(nextBlinkAt - now));
      els.blink.style.display = "";
      els.blink.textContent = blinkRate === null ? `👁 ${left}s후 측정` : `👁 ${blinkRate}회/분`;
      return;
    }
    blinkSampling = true; blinkWinStart = now; blinkCount = 0; blinkClosed = false; blinkFaceFrames = 0;
  }

  // 샘플 창: 매 프레임 얼굴 추론 → 깜빡임(눈 감김의 상승 에지) 카운트
  els.blink.style.display = "";
  els.blink.textContent = "👁 측정 중…";
  try {
    const fr = faceLandmarker.detectForVideo(els.cam, wallMs);
    const bs = fr.faceBlendshapes?.[0]?.categories;
    if (bs) {
      blinkFaceFrames++;
      const l = bs.find((c) => c.categoryName === "eyeBlinkLeft")?.score || 0;
      const r = bs.find((c) => c.categoryName === "eyeBlinkRight")?.score || 0;
      const closed = (l + r) / 2 > BLINK_CLOSE;
      if (closed && !blinkClosed) blinkCount++; // 감기 시작 = 1회
      blinkClosed = closed;
    }
  } catch {}

  if (now - blinkWinStart >= BLINK_WINDOW_SEC) {
    blinkSampling = false;
    nextBlinkAt = now + BLINK_INTERVAL_SEC;
    if (blinkFaceFrames < 10) { // 얼굴이 거의 안 잡힘 → 추정 불가
      els.blinkStatus.textContent = "얼굴이 잘 안 보여 측정을 건너뛰었어요";
      return;
    }
    blinkRate = Math.round(blinkCount / (BLINK_WINDOW_SEC / 60));
    els.blink.textContent = `👁 ${blinkRate}회/분`;
    els.blinkStatus.textContent = `방금 측정: 분당 ${blinkRate}회 (정상 15~20)`;
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
    let sig = null;
    try {
      lastResult = landmarker.detectForVideo(els.cam, wallMs);
      const lms = lastResult.landmarks?.[0];
      if (lms) {
        const raw = extractSignals(lms);
        if (raw) sig = smoother.update(raw);
      }
    } catch {}

    processBlink(now, wallMs); // 눈 깜빡임 주기 샘플링 (켜져 있을 때만)

    // 캘리브레이션 수집
    if (calibUntil !== null) {
      if (sig) calibSamples.push(sig);
      const remain = calibUntil - now;
      els.msg.textContent = `기준 등록 중… ${Math.max(0, remain).toFixed(1)}s — 바르게 앉아 계세요`;
      if (remain <= 0) {
        if (calibSamples.length >= 5) {
          const p = finishCalibration(calibSamples);
          store.saveProfile(p);
          judge = new Judge(p);
          smoother = new SignalSmoother();
          sm = new StateMachine(); sm.state = "GOOD";
          logTransition(null, "GOOD", now);
          els.msg.textContent = "기준 등록 완료. 척추요정이 깨어났어요!";
          speak("준비 완료! 지켜볼게요 👀");
        } else {
          els.msg.textContent = "몸이 잘 안 잡혔어요. 다시 [기준 등록]을 눌러주세요.";
        }
        calibUntil = null;
      }
    }

    // 판정 + 상태 전이
    let score = null, zs = {};
    if (judge && sig && calibUntil === null) [score, zs] = judge.score(sig);
    const prev = sm.state;
    const state = sm.update(judge ? score : null, now);
    const dur = sm.stateSince ? now - sm.stateSince : 0;
    const badCand = sm.cand?.[0] === "BAD";
    const face = rewards.fairy(state, dur, badCand);

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

function drawTracking(state, zs) {
  const ctx = els.track.getContext("2d");
  const { width: w, height: h } = els.track;
  ctx.fillStyle = "#14181d"; ctx.fillRect(0, 0, w, h);
  const lms = lastResult?.landmarks?.[0];
  if (!lms) {
    ctx.fillStyle = "#8b98a5"; ctx.font = "20px sans-serif"; ctx.textAlign = "center";
    ctx.fillText("NO DETECTION", w / 2, h / 2);
    ctx.textAlign = "left";
    return;
  }
  const px = (i) => [(1 - lms[i].x) * w, lms[i].y * h]; // 거울 반전 일치
  ctx.strokeStyle = "#3a444f"; ctx.lineWidth = 1.5;
  const bones = [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24]];
  for (const [a, b] of bones) {
    if (!lms[a] || !lms[b]) continue;
    ctx.beginPath(); ctx.moveTo(...px(a)); ctx.lineTo(...px(b)); ctx.stroke();
  }
  const mid = (a, b) => [(px(a)[0] + px(b)[0]) / 2, (px(a)[1] + px(b)[1]) / 2];
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = "#e6aa3c";
  ctx.beginPath(); ctx.moveTo(...px(LM.EAR_L)); ctx.lineTo(...px(LM.EAR_R)); ctx.stroke();
  ctx.strokeStyle = "#5abe5a";
  ctx.beginPath(); ctx.moveTo(...px(LM.SH_L)); ctx.lineTo(...px(LM.SH_R)); ctx.stroke();
  ctx.strokeStyle = "#e6763c";
  ctx.beginPath(); ctx.moveTo(...mid(LM.EAR_L, LM.EAR_R)); ctx.lineTo(...px(LM.NOSE)); ctx.stroke();
  ctx.strokeStyle = "#9678c8"; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(...px(LM.NOSE)); ctx.lineTo(...mid(LM.SH_L, LM.SH_R)); ctx.stroke();
  for (const [i, c] of Object.entries(KEYPT)) {
    const [x, y] = px(+i);
    ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, 5, 0, 7); ctx.fill();
    if ((lms[+i].visibility ?? 1) < 0.5) {
      ctx.strokeStyle = "#e64545"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, 9, 0, 7); ctx.stroke();
    }
  }
  if (zs && Object.keys(zs).length) {
    ctx.font = "12px monospace";
    SIGNAL_KEYS.forEach((k, i) => {
      const y = 28 + i * 24, x0 = 170, bw = 160;
      ctx.fillStyle = "#e7ecf1";
      ctx.fillText(`${k.padEnd(13)} z=${zs[k] >= 0 ? "+" : ""}${zs[k].toFixed(2)}`, 12, y + 4);
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
    ctx.fillText("[기준 등록]을 하면 신호가 표시됩니다", 12, 30);
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
  els.reportTable.innerHTML = [
    ["총 감시 시간", fmtMin(rep.watched)],
    ["바른 자세", `${fmtMin(rep.good)}${rep.ratio !== null ? ` (${Math.round(rep.ratio * 100)}%)` : ""}`],
    ["나쁜 자세", `${fmtMin(rep.bad)} · ${rep.badCount}회`],
    ["최장 연속 바른 자세", fmtMin(rep.longestGood)],
    ["오늘 얻은 포인트", `+${todayEarned}P`],
  ].map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("");
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
  els.setCustom.checked = s.useCustom;
  if (!navigator.vibrate) { // 아이폰(WebKit): 진동 API 없음 — 알림 재발송으로 횟수 유도
    const hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent = "※ 아이폰은 알림을 횟수만큼 다시 울려 진동을 만들어요 (1.5초 간격, 설치형 웹앱에서 동작).";
    els.setVibrate.closest("details").appendChild(hint);
  }
  updateSongName();

  const save = () => {
    rewards.settings = {
      mode: els.setMode.value, melody: els.setMelody.value,
      volume: els.setVolume.value / 100, vibrate: els.setVibrate.value,
      useCustom: els.setCustom.checked,
    };
    rewards._save();
    customAudio = null; // 음량 변경 반영
  };
  for (const el of [els.setMode, els.setMelody, els.setVolume, els.setVibrate, els.setCustom]) {
    el.addEventListener("change", save);
  }
  els.setMelody.addEventListener("change", () => playNotes(MELODIES[els.setMelody.value].notes, rewards.settings.volume));
  els.btnTest.onclick = () => {
    const m = `${rewards.fairy("BAD", 0, false)} 알림 테스트예요`;
    notify(m); playAlert(1, m);
  };

  els.btnSong.onclick = () => els.songFile.click();
  els.songFile.onchange = async () => {
    const f = els.songFile.files[0];
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) { els.msg.textContent = "노래 파일은 2MB 이하만 가능해요."; return; }
    const dataUrl = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result); r.onerror = rej;
      r.readAsDataURL(f);
    });
    try {
      localStorage.setItem("pg_custom_audio", dataUrl);
      localStorage.setItem("pg_custom_audio_name", f.name);
      els.setCustom.checked = true;
      save(); customAudio = null;
      updateSongName();
      els.msg.textContent = `"${f.name}" 등록 완료 — 알림 테스트로 확인해보세요.`;
    } catch {
      els.msg.textContent = "저장 공간이 부족해요. 더 작은 파일로 시도해주세요.";
    }
  };
}
function updateSongName() {
  els.songName.textContent = localStorage.getItem("pg_custom_audio_name") || "(선택된 노래 없음)";
}

// ── 상점 UI ──
function buyItem(item) {
  const r = rewards.buy(item.id);
  els.msg.textContent = r.msg;
  if (r.ok) {
    renderShop(); applyTheme(); flashPoints();
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
  // 테마 색 (무료)
  const themes = SHOP.filter((i) => i.type === "theme");
  if (themes.length) {
    const sec = document.createElement("div");
    sec.className = "tier tier-theme";
    sec.innerHTML = `<div class="tier-head"><b>테마 색</b><span>무료 · 강조색 바꾸기</span></div>`;
    const grid = document.createElement("div");
    grid.className = "tier-grid";
    for (const item of themes) {
      const owned = rewards.shop.owned.includes(item.id);
      const card = document.createElement("div");
      card.className = "skin-card";
      const color = THEMES[item.key]?.accent || "#5abe5a";
      card.innerHTML = `<div class="theme-swatch" style="background:${color}"></div>` +
        `<div class="skin-name">${item.label}</div>` +
        `<div class="skin-action">${owned ? '<span class="owned-tag">✓ 보유</span>' : '<button class="buy-btn">받기</button>'}</div>`;
      if (!owned) card.querySelector(".buy-btn").onclick = () => buyItem(item);
      grid.appendChild(card);
    }
    sec.appendChild(grid);
    els.shopList.appendChild(sec);
  }
  // 적용 셀렉트
  els.applySkin.innerHTML = "";
  for (const k of rewards.ownedOf("skin")) els.applySkin.add(new Option(SKINS[k].label, k));
  els.applySkin.value = rewards.shop.skin;
  els.applyTheme.innerHTML = "";
  for (const k of rewards.ownedOf("theme")) els.applyTheme.add(new Option(THEMES[k].label, k));
  els.applyTheme.value = rewards.shop.theme;
}
function applyTheme() {
  document.documentElement.style.setProperty("--accent", rewards.accent());
}

// ── 그룹 랭킹 (백엔드 1단계 — 로그인 없음: 익명 기기 ID + 닉네임, docs/백엔드-설계.md) ──
const memberId = (() => {
  let id = localStorage.getItem("pg_member_id");
  if (!id) { id = crypto.randomUUID(); localStorage.setItem("pg_member_id", id); }
  return id;
})();
const myGroup = () => JSON.parse(localStorage.getItem("pg_group") || "null");

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
  let acc = 0;
  for (let i = 0; i < events.length; i++) {
    if (events[i].to !== "GOOD") continue;
    const start = Math.max(events[i].t, t0);
    const end = i + 1 < events.length ? events[i + 1].t : now;
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
  const g = myGroup();
  if (!g) return;
  try { await api("stats", { memberId, week: weekKey(), goodSec: weeklyGoodSec(), points: rewards.points, streak: attendStreak() }); } catch {}
}
async function refreshLeaderboard() {
  const g = myGroup();
  const info = $("group-info"), board = $("leaderboard");
  if (!g) { info.textContent = "그룹을 만들거나 코드를 받아 참여해보세요."; board.innerHTML = ""; return; }
  info.textContent = `${g.name} · 코드 ${g.code} · 나: ${g.nickname}`;
  try {
    const { rows, champions } = await api(`leaderboard?code=${g.code}&week=${weekKey()}`);
    board.innerHTML = renderHallOfFame(rows, champions);
  } catch (e) {
    board.innerHTML = "";
    info.textContent += ` — 랭킹 불러오기 실패 (${e.message})`;
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
function nudgeBtn(r, online) {
  return r.member_id === memberId ? "" :
    `<button class="nudge-btn" data-mid="${r.member_id}" ${online ? "" : "disabled"} title="자세 펴라고 콕!">👉</button>`;
}
function podCard(r, rank) {
  if (!r) return `<div class="pod pod-${rank} empty"><div class="pod-rank">${rank}</div><div class="pod-name">—</div></div>`;
  const me = r.member_id === memberId;
  const s = statusOf(r);
  const online = r.ago_sec != null && r.ago_sec <= 90;
  return `<div class="pod pod-${rank}${me ? " me" : ""}">
    <div class="pod-rank">${rank}</div>
    <div class="pod-ava-wrap"><img class="pod-ava" src="${avatarFor(r)}" onerror="${AVA_FALLBACK}" alt="요정"></div>
    <div class="pod-name">${esc(r.nickname)}${me ? " (나)" : ""}</div>
    <div class="pod-stat ${s.cls}"><span class="dot ${s.dot}"></span>${s.label}</div>
    <div class="pod-score">${(r.good_sec / 60).toFixed(0)}분 · ${r.points}P</div>
    ${nudgeBtn(r, online)}
  </div>`;
}
function renderHallOfFame(rows, champions = []) {
  const podium = `<div class="podium">${podCard(rows[1], 2)}${podCard(rows[0], 1)}${podCard(rows[2], 3)}</div>`;
  const rest = rows.slice(3).map((r, i) => {
    const me = r.member_id === memberId;
    const s = statusOf(r);
    const online = r.ago_sec != null && r.ago_sec <= 90;
    return `<div class="hof-row${me ? " me" : ""}">
      <span class="hof-num">${i + 4}</span>
      <img class="hof-ava" src="${avatarFor(r)}" onerror="${AVA_FALLBACK}" alt="">
      <span class="hof-nick">${esc(r.nickname)}${me ? " (나)" : ""}</span>
      <span class="hof-status ${s.cls}"><span class="dot ${s.dot}"></span>${s.label}</span>
      ${nudgeBtn(r, online)}
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
// 콕 버튼 (이벤트 위임 — 리더보드는 innerHTML로 갱신되므로)
$("leaderboard").addEventListener("click", async (e) => {
  const btn = e.target.closest(".nudge-btn");
  if (!btn) return;
  btn.disabled = true;
  try {
    await api("nudge", { fromId: memberId, toId: btn.dataset.mid });
    showToast("👉 콕 보냈어요! 친구에게 알림이 갑니다");
  } catch (err) {
    showToast("콕 실패: " + err.message);
  }
  setTimeout(() => { btn.disabled = false; }, 60_000); // 분당 1회 제한과 맞춤
});
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
    localStorage.setItem("pg_group", JSON.stringify({ code, name, nickname }));
    els.msg.textContent = `"${name}" 그룹 참여 완료!`;
    await uploadStats();
    refreshLeaderboard();
  } catch (e) { els.msg.textContent = "참여 실패: " + e.message; }
};
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
refreshLeaderboard(); // 그룹 페이지는 기본 열림 — 첫 로드 시 표시
setInterval(() => { if ($("group").open) refreshLeaderboard(); }, 30_000); // 상태 점 주기 갱신

// ── 리플레이 검증 ──
els.replayLink.onclick = () => els.replayInput.click();
els.replayInput.onchange = async () => {
  const f = els.replayInput.files[0];
  if (!f) return;
  const data = JSON.parse(await f.text());
  const t0 = data.frames[0].t;
  const lines = replay(data).map(([t, a, b]) => `t=${(t - t0).toFixed(1)}s ${a}→${b}`);
  els.msg.textContent = `리플레이 ${data.frames.length}프레임: ` +
    (lines.length ? lines.join(" · ") : "(전이 없음)");
};

// ── 버튼 ──
els.btnStart.onclick = () => { if (running) stop(); else start(); };
els.btnCalib.onclick = () => { calibUntil = nowSec() + TUNING.CALIB_SECS; calibSamples = []; };
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
    if (running) ensureFaceModel();
    else els.blinkStatus.textContent = "카메라를 시작하면 측정을 시작해요";
  } else {
    blinkSampling = false;
    els.blink.style.display = "none";
    els.blinkStatus.textContent = "";
  }
};
$("btn-report-close").onclick = () => els.reportOverlay.classList.remove("open");
els.reportOverlay.onclick = (e) => { if (e.target === els.reportOverlay) els.reportOverlay.classList.remove("open"); };
els.applySkin.onchange = () => { rewards.apply("skin", els.applySkin.value); };
els.applyTheme.onchange = () => { rewards.apply("theme", els.applyTheme.value); applyTheme(); };

// ── 초기화 ──
initSettings();
renderShop();
applyTheme();
renderSummary();
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
