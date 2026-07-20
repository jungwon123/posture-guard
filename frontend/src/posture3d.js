// posture3d.js — 3D "절대" 자세 지표 레이어 (거리에 강함).
//
// 왜 필요한가: core.js 는 2D 정규화 좌표의 "개인 기준 대비 z-score"만 본다. 그래서
//   (1) 화면 거리/줌이 바뀌면 흔들리고,  (2) 사용자가 이미 구부정하게 [기준 등록]하면
//   그 구부정함이 "정상"이 되어 절대적으로 바른지는 판정하지 못한다.
// 이 모듈은 이미 돌아가는 PoseLandmarker 의 worldLandmarks(미터 단위, 골반중심 원점)만
// 사용하므로 추가 추론비용이 0이다. core.js 는 건드리지 않고(=parity 안전) 그 위에 절대
// 기준 페널티를 얹는다. 유도형 캘리브레이션으로 "바른" 기준을 잡으면 절대 게이트가 켜진다.
//
//   headVertical : 어깨너비로 정규화한 귀-어깨 수직거리. 클수록 머리를 높이 든 바른 자세.
//                  미터·정규화라 카메라 거리 변화에 강함. 거북목/고개숙임에서 감소.
//   shoulderTilt : 어깨선이 수평에서 기운 각도(도). 한쪽으로 기운 자세에서 증가.

// worldLandmarks 도 Pose 33-포인트 토폴로지와 동일 인덱스.
const IDX = { NOSE: 0, EAR_L: 7, EAR_R: 8, SH_L: 11, SH_R: 12, WRIST_L: 15, WRIST_R: 16 };
const MIN_VIS = 0.5;

// 절대 페널티 가중치 — core z-score 점수에 exp(-penalty)로 곱해 결합한다(0이면 무영향).
const ABS_W = { head: 1.6, tilt: 1.4, pitch: 1.0, forward: 1.2, span: 1.4, lateral: 1.0, roll: 0.8, prop: 1.1 }; // +좌우쏠림/갸웃/턱괴기
const HEAD_DROP_DEADZONE = 0.15; // 기준 대비 15% 이상 내려가야 페널티 시작
const TILT_MARGIN_DEG = 3;       // 기준 + 3도 초과부터 페널티(더 타이트)
const TILT_FULL_DEG = 14;        // 14도 초과분에서 가중치 최대
const PITCH_MARGIN_DEG = 15;     // 머리 각도가 기준에서 15도 이상 벗어나야 페널티(양방향, 여유 넉넉)
const PITCH_FULL_DEG = 35;       // 35도 초과분에서 가중치 최대
const FORWARD_MARGIN = 0.10;     // 기준 대비 정규화 0.10 이상 '앞으로' 나와야 페널티(Z 노이즈 여유)
const FORWARD_FULL = 0.30;       // +0.30 초과분에서 가중치 최대
const SPAN_DEADZONE = 0.06;      // 어깨너비/귀간격(3D)이 기준보다 6% 이상 줄어야 페널티(말림)
const SPAN_FULL = 0.15;          // 15% 축소분에서 가중치 최대
const LATERAL_MARGIN = 0.12;     // 귀중점이 어깨중점서 어깨너비의 0.12 이상 좌/우로 벗어나야 페널티(양방향)
const LATERAL_FULL = 0.30;       // 0.30 초과분에서 가중치 최대
const ROLL_MARGIN_DEG = 10;      // 고개 갸웃(roll)이 기준서 10도 이상 벗어나야 페널티(양방향)
const ROLL_FULL_DEG = 30;        // 30도 초과분에서 가중치 최대
const PROP_NEAR = 0.65;          // 손목이 코에서 어깨너비의 0.65 이내로 오면 '얼굴 괴기' 시작(고정 임계, 실기기 튜닝)
const PROP_FULL = 0.35;          // 0.35 이내면 가중치 최대

// ── One-Euro 필터 (지터는 줄이고 지연은 최소) ──
class LowPass {
  constructor() { this.y = null; this.s = null; }
  filter(x, a) { this.s = this.y === null ? x : a * x + (1 - a) * this.s; this.y = x; return this.s; }
}
export class OneEuro {
  constructor({ minCutoff = 0.8, beta = 0.01, dCutoff = 1.0 } = {}) {
    this.minCutoff = minCutoff; this.beta = beta; this.dCutoff = dCutoff;
    this.x = new LowPass(); this.dx = new LowPass(); this.tPrev = null; this.xPrev = 0;
  }
  _alpha(cutoff, dt) { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); }
  filter(value, t) {
    if (this.tPrev === null) { this.tPrev = t; this.xPrev = value; return this.x.filter(value, 1); }
    const dt = Math.max(1e-3, t - this.tPrev); this.tPrev = t;
    const dval = (value - this.xPrev) / dt; this.xPrev = value;
    const edx = this.dx.filter(dval, this._alpha(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    return this.x.filter(value, this._alpha(cutoff, dt));
  }
}

// ── 지표 추출 ──
export function extractAbsolute(wlms) {
  if (!wlms) return null;
  for (const i of [IDX.EAR_L, IDX.EAR_R, IDX.SH_L, IDX.SH_R]) {
    const p = wlms[i];
    if (!p || (p.visibility ?? 1) < MIN_VIS) return null;
  }
  const eL = wlms[IDX.EAR_L], eR = wlms[IDX.EAR_R], sL = wlms[IDX.SH_L], sR = wlms[IDX.SH_R];
  const shoulderWidth = Math.hypot(sL.x - sR.x, sL.y - sR.y, sL.z - sR.z);
  const earDist = Math.hypot(eL.x - eR.x, eL.y - eR.y, eL.z - eR.z);
  if (shoulderWidth < 1e-4 || earDist < 1e-4) return null;
  const earMidY = (eL.y + eR.y) / 2, shMidY = (sL.y + sR.y) / 2;
  const earMidZ = (eL.z + eR.z) / 2, shMidZ = (sL.z + sR.z) / 2;
  // world y 는 아래 방향(+). 귀가 어깨보다 위 → shMidY > earMidY → headVertical > 0.
  const headVertical = (shMidY - earMidY) / shoulderWidth;
  const shoulderTilt = Math.atan2(Math.abs(sR.y - sL.y), Math.abs(sR.x - sL.x) + 1e-6) * 180 / Math.PI;
  // headForward(거북목 전방이동): 어깨 대비 귀의 깊이(Z) 오프셋을 어깨너비로 정규화. Z는 단일카메라 추정치라
  // 노이즈가 크므로 강한 One-Euro로 다룬다. 부호/방향(귀가 앞으로 갈 때 증가/감소)은 Phase1 실기기 로그로 확정.
  const headForward = (shMidZ - earMidZ) / shoulderWidth;
  // shoulderSpan(어깨 말림): 3D 어깨너비를 머리크기(귀간격)로 정규화. 어깨를 말면 3D 어깨너비가 줄어
  // 기준보다 작아진다(거리 불변). 정면 2D가 약한 축이라 3D 깊이 포함이 핵심.
  const shoulderSpan = shoulderWidth / earDist;
  // headLateral(머리 좌우 쏠림): 귀중점이 어깨중점 대비 가로(x)로 얼마나 벗어났나(어깨너비 정규화).
  // 정면 카메라가 가장 잘 보는 x축이라 신뢰도 높음. 기준(≈0) 대비 양방향 편차를 감점.
  const earMidX = (eL.x + eR.x) / 2, shMidX = (sL.x + sR.x) / 2;
  const headLateral = (earMidX - shMidX) / shoulderWidth;
  // handToFace(손으로 얼굴 괴기): 손목(15/16) 중 코에 더 가까운 거리를 어깨너비로 정규화(작을수록 얼굴에 근접).
  // 손목 visibility 낮으면 그 손 제외. 둘 다 없으면 null(판정 skip).
  const nose = wlms[IDX.NOSE], wL = wlms[IDX.WRIST_L], wR = wlms[IDX.WRIST_R];
  let handToFace = null;
  if (nose && (nose.visibility ?? 1) >= MIN_VIS) {
    const d = (w) => (w && (w.visibility ?? 1) >= MIN_VIS) ? Math.hypot(w.x - nose.x, w.y - nose.y, w.z - nose.z) : Infinity;
    const dm = Math.min(d(wL), d(wR));
    if (Number.isFinite(dm)) handToFace = dm / shoulderWidth;
  }
  return { headVertical, shoulderTilt, headForward, shoulderSpan, headLateral, handToFace };
}

// FaceLandmarker facialTransformationMatrixes[0].data = 16개 column-major 4x4 (R|t),
// 캐논 얼굴→카메라 좌표 변환. 회전부를 Tait-Bryan(Rz·Ry·Rx)로 분해 → {pitch,yaw,roll} 도.
// 절대각의 관례 오프셋(캐논 얼굴 기준)은 캘리브 기준 pitch와의 '편차'로 상쇄되므로 무관.
// 정면(똑바로) 자세는 짐벌락(sy≈0)에서 멀어 안정적으로 분해됨. 얼굴 없으면 null.
export function headPoseFromMatrix(data) {
  if (!data || data.length < 11) return null;
  // column-major → 논리 R[row][col]: 열 j 는 data[4j .. 4j+3]
  const r00 = data[0], r10 = data[1], r20 = data[2];
  const r11 = data[5], r21 = data[6];
  const r12 = data[9], r22 = data[10];
  const D = 180 / Math.PI;
  const sy = Math.hypot(r00, r10);
  if (sy < 1e-6) { // 짐벌락(고개를 극단적으로 젖힘) — roll 을 0으로
    return { pitch: Math.atan2(-r12, r11) * D, yaw: Math.atan2(-r20, sy) * D, roll: 0 };
  }
  return {
    pitch: Math.atan2(r21, r22) * D, // 고개 끄덕임(위/아래)
    yaw: Math.atan2(-r20, sy) * D,   // 좌우 돌림
    roll: Math.atan2(r10, r00) * D,  // 갸웃
  };
}

// 매 프레임 raw 지표에 One-Euro 를 적용해 부드럽게. headPitch 는 있을 때만(얼굴 모델 켜짐).
export class AbsSmoother {
  constructor() {
    this.f = {
      headVertical: new OneEuro({ minCutoff: 0.8, beta: 0.01 }),
      shoulderTilt: new OneEuro({ minCutoff: 0.8, beta: 0.01 }),
      headPitch: new OneEuro({ minCutoff: 0.8, beta: 0.02 }),
      headForward: new OneEuro({ minCutoff: 0.5, beta: 0.005 }), // Z는 노이즈 커서 더 강하게 스무딩
      shoulderSpan: new OneEuro({ minCutoff: 0.6, beta: 0.008 }), // 3D 폭도 Z 포함이라 강하게
      headLateral: new OneEuro({ minCutoff: 0.8, beta: 0.01 }),   // x축이라 노이즈 적음
      headRoll: new OneEuro({ minCutoff: 0.8, beta: 0.02 }),
      handToFace: new OneEuro({ minCutoff: 0.6, beta: 0.01 }),
    };
  }
  update(m, t) {
    if (!m) return null;
    const out = {
      headVertical: this.f.headVertical.filter(m.headVertical, t),
      shoulderTilt: this.f.shoulderTilt.filter(m.shoulderTilt, t),
    };
    if (m.headForward != null && Number.isFinite(m.headForward)) {
      out.headForward = this.f.headForward.filter(m.headForward, t);
    }
    if (m.shoulderSpan != null && Number.isFinite(m.shoulderSpan)) {
      out.shoulderSpan = this.f.shoulderSpan.filter(m.shoulderSpan, t);
    }
    if (m.headLateral != null && Number.isFinite(m.headLateral)) {
      out.headLateral = this.f.headLateral.filter(m.headLateral, t);
    }
    if (m.headRoll != null && Number.isFinite(m.headRoll)) {
      out.headRoll = this.f.headRoll.filter(m.headRoll, t);
    }
    if (m.handToFace != null && Number.isFinite(m.handToFace)) {
      out.handToFace = this.f.handToFace.filter(m.handToFace, t);
    }
    if (m.headPitch != null && Number.isFinite(m.headPitch)) {
      out.headPitch = this.f.headPitch.filter(m.headPitch, t);
    }
    return out;
  }
}

const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b), n = s.length;
  if (!n) return 0;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};

// 유도형 캘리브 동안 모은 절대 지표(부드럽게 필터된 값)의 대푯값을 "바른 자세 기준"으로.
export function finishAbsRef(samples) {
  const good = samples.filter(Boolean);
  if (good.length < 3) return null;
  const ref = {
    headVertical: median(good.map((s) => s.headVertical)),
    shoulderTilt: median(good.map((s) => s.shoulderTilt)),
    n: good.length,
  };
  // 얼굴 모델이 캘리브 동안 충분히 잡혔으면 머리 pitch 기준도 저장(없으면 pitch 게이트 off).
  const pitches = good.map((s) => s.headPitch).filter((v) => v != null && Number.isFinite(v));
  if (pitches.length >= Math.max(3, Math.floor(good.length * 0.3))) ref.headPitch = median(pitches);
  // 전방머리 기준(Phase1: 측정만 — 판정엔 아직 미사용). 있으면 __pgLive 로 편차 로깅.
  const fwds = good.map((s) => s.headForward).filter((v) => v != null && Number.isFinite(v));
  if (fwds.length >= 3) ref.headForward = median(fwds);
  const spans = good.map((s) => s.shoulderSpan).filter((v) => v != null && Number.isFinite(v));
  if (spans.length >= 3) ref.shoulderSpan = median(spans);
  const lats = good.map((s) => s.headLateral).filter((v) => v != null && Number.isFinite(v));
  if (lats.length >= 3) ref.headLateral = median(lats);
  const rolls = good.map((s) => s.headRoll).filter((v) => v != null && Number.isFinite(v));
  if (rolls.length >= Math.max(3, Math.floor(good.length * 0.3))) ref.headRoll = median(rolls);
  // handToFace 는 절대 임계(캘리브 무관) — ref 에 저장하지 않음.
  return ref;
}

// 머리 pitch 편차(양방향, 여유 넉넉) → 0..1.5. m·ref 둘 다 headPitch 있을 때만.
function pitchTerm(m, ref) {
  if (m.headPitch == null || ref.headPitch == null) return 0;
  const dp = Math.abs(m.headPitch - ref.headPitch) - PITCH_MARGIN_DEG;
  return dp > 0 ? Math.min(dp / PITCH_FULL_DEG, 1.5) : 0;
}

// 전방머리(거북목) 편차 → 0..1.5. '앞으로' 나온 만큼만(뒤로 젖힘은 무시=비대칭).
// MediaPipe world z: 작을수록 카메라에 가까움 → 거북목이면 귀 z↓ → headForward↑ → 기준보다 커짐.
function forwardTerm(m, ref) {
  if (m.headForward == null || ref.headForward == null) return 0;
  const f = (m.headForward - ref.headForward) - FORWARD_MARGIN;
  return f > 0 ? Math.min(f / FORWARD_FULL, 1.5) : 0;
}

// 어깨 말림 → 0..1.5. 3D 어깨너비/귀간격이 기준보다 '줄어든' 만큼만(말릴수록 감소).
function spanTerm(m, ref) {
  if (m.shoulderSpan == null || ref.shoulderSpan == null) return 0;
  const sdrop = (ref.shoulderSpan - m.shoulderSpan) / Math.max(ref.shoulderSpan, 1e-3) - SPAN_DEADZONE;
  return sdrop > 0 ? Math.min(sdrop / SPAN_FULL, 1.5) : 0;
}

// 머리 좌우 쏠림 → 0..1.5. 기준 대비 좌/우 어느 쪽이든(양방향) 벗어난 만큼.
function lateralTerm(m, ref) {
  if (m.headLateral == null || ref.headLateral == null) return 0;
  const dl = Math.abs(m.headLateral - ref.headLateral) - LATERAL_MARGIN;
  return dl > 0 ? Math.min(dl / LATERAL_FULL, 1.5) : 0;
}

// 고개 갸웃(roll) → 0..1.5. 기준 대비 양방향 편차.
function rollTerm(m, ref) {
  if (m.headRoll == null || ref.headRoll == null) return 0;
  const dr = Math.abs(m.headRoll - ref.headRoll) - ROLL_MARGIN_DEG;
  return dr > 0 ? Math.min(dr / ROLL_FULL_DEG, 1.5) : 0;
}

// 손으로 얼굴 괴기 → 0..1.5. 손목이 코에 PROP_NEAR 이내로 오면 가까울수록 커짐(캘리브 무관 고정임계).
function propTerm(m) {
  if (m.handToFace == null) return 0;
  const near = PROP_NEAR - m.handToFace;
  return near > 0 ? Math.min(near / (PROP_NEAR - PROP_FULL), 1.5) : 0;
}

// 머리 가라앉음(귀-어깨 수직 축소) → 0.. . 기준 대비 deadzone 초과분.
function headDropTerm(m, ref) {
  if (!ref.headVertical) return 0;
  const drop = (ref.headVertical - m.headVertical) / Math.max(ref.headVertical, 1e-3) - HEAD_DROP_DEADZONE;
  return drop > 0 ? drop : 0;
}
// 어깨 기울기 → 0..1.5. 기준 + 마진 초과분.
function tiltTerm(m, ref) {
  const t = m.shoulderTilt - (ref.shoulderTilt + TILT_MARGIN_DEG);
  return t > 0 ? Math.min(t / TILT_FULL_DEG, 1.5) : 0;
}

// 좋은 기준 대비 얼마나 나빠졌는지 → 페널티(≥0). core 점수에 exp(-penalty)로 곱한다.
export function absPenalty(m, ref) {
  if (!m || !ref || !ref.headVertical) return 0;
  return ABS_W.head * headDropTerm(m, ref)       // 머리 가라앉음
    + ABS_W.tilt * tiltTerm(m, ref)              // 어깨 기울기
    + ABS_W.pitch * pitchTerm(m, ref)            // 고개 숙임(머리 각도 편차)
    + ABS_W.forward * forwardTerm(m, ref)        // 거북목 전방이동(깊이 Z)
    + ABS_W.span * spanTerm(m, ref)              // 어깨 말림(3D 어깨너비 축소)
    + ABS_W.lateral * lateralTerm(m, ref)        // 머리 좌우 쏠림
    + ABS_W.roll * rollTerm(m, ref)              // 고개 갸웃
    + ABS_W.prop * propTerm(m);                  // 손으로 얼굴 괴기
}

// 지금 '가장 크게 감점 중인' 절대 신호 → {key(메시지용), c(가중 기여도)}. 없으면 null.
// 신호마다 자기에게 맞는 말풍선 키를 준다(예: 고개숙임=pitch, 어깨기울기=shoulder_tilt).
export function absDominant(m, ref) {
  if (!m || !ref || !ref.headVertical) return null;
  const cands = [
    ["head_drop", ABS_W.head * headDropTerm(m, ref)],    // 머리 가라앉음 → 거북목류
    ["head_drop", ABS_W.forward * forwardTerm(m, ref)],  // 거북목 전방이동
    ["pitch", ABS_W.pitch * pitchTerm(m, ref)],          // 고개 숙임
    ["shoulder_tilt", ABS_W.tilt * tiltTerm(m, ref)],    // 어깨 높이 비대칭
    ["shoulder_roll", ABS_W.span * spanTerm(m, ref)],    // 어깨 말림/등 굽음
    ["head_tilt", ABS_W.lateral * lateralTerm(m, ref)],  // 좌우 쏠림
    ["head_tilt", ABS_W.roll * rollTerm(m, ref)],        // 고개 갸웃
    ["hand_face", ABS_W.prop * propTerm(m)],             // 손으로 얼굴 괴기
  ];
  let bestKey = null, bestC = 0;
  for (const [k, c] of cands) if (c > bestC) { bestC = c; bestKey = k; }
  return bestKey ? { key: bestKey, c: bestC } : null;
}

// 하위호환 래퍼(부위 키만) — 트래킹 펄스 링 등에서 사용.
export function absWorst(m, ref) {
  return absDominant(m, ref)?.key ?? null;
}

// ── 트래킹 고스트 가이드용 2D 기하 (판정과 무관, 렌더 전용) ──
// 어깨 프레임: 원점=어깨중점, 기저 u=(오른어깨-왼어깨), v=u를 90° 회전. 점 P를 P=shMid+a·u+b·v 로 표현.
// a,b 는 어깨너비 단위(무차원)라 카메라 거리/좌우이동/어깨 기울기에 불변 → 캘리브 때의 '바른 머리
// 위치'를 라이브 어깨에 재투영해 고스트 가이드로 그린다. 정규화 좌표(x,y∈[0,1])에서 계산.
const G = { NOSE: 0, EAR_L: 7, EAR_R: 8, SH_L: 11, SH_R: 12 };

function toShoulderFrame(P, sL, sR) {
  const ox = (sL.x + sR.x) / 2, oy = (sL.y + sR.y) / 2;
  const ux = sR.x - sL.x, uy = sR.y - sL.y;   // 어깨 벡터
  const vx = -uy, vy = ux;                     // 90° 회전(수직)
  const det = ux * vy - uy * vx;               // = |u|^2
  if (Math.abs(det) < 1e-9) return null;
  const dx = P.x - ox, dy = P.y - oy;
  return { a: (dx * vy - dy * vx) / det, b: (ux * dy - uy * dx) / det };
}
function fromShoulderFrame(ab, sL, sR) {
  const ox = (sL.x + sR.x) / 2, oy = (sL.y + sR.y) / 2;
  const ux = sR.x - sL.x, uy = sR.y - sL.y;
  const vx = -uy, vy = ux;
  return { x: ox + ab.a * ux + ab.b * vx, y: oy + ab.a * uy + ab.b * vy };
}

// 라이브 랜드마크 → 어깨 프레임 기준 머리 점들(귀중점·코·좌우귀). 미검출이면 null.
export function extractGuidePoints(lms) {
  for (const i of [G.NOSE, G.EAR_L, G.EAR_R, G.SH_L, G.SH_R]) {
    if (!lms[i] || (lms[i].visibility ?? 1) < 0.5) return null;
  }
  const sL = lms[G.SH_L], sR = lms[G.SH_R];
  const earMid = { x: (lms[G.EAR_L].x + lms[G.EAR_R].x) / 2, y: (lms[G.EAR_L].y + lms[G.EAR_R].y) / 2 };
  const ear = toShoulderFrame(earMid, sL, sR);
  const nose = toShoulderFrame(lms[G.NOSE], sL, sR);
  const earL = toShoulderFrame(lms[G.EAR_L], sL, sR);
  const earR = toShoulderFrame(lms[G.EAR_R], sL, sR);
  if (!ear || !nose || !earL || !earR) return null;
  return { ear, nose, earL, earR };
}

// 유도 캘리브 동안 모은 '바른 머리 위치'의 대푯값(어깨 프레임 좌표).
export function finishGuide(samples) {
  const g = samples.filter(Boolean);
  if (g.length < 3) return null;
  const med = (sel) => ({ a: median(g.map((s) => sel(s).a)), b: median(g.map((s) => sel(s).b)) });
  return { ear: med((s) => s.ear), nose: med((s) => s.nose), earL: med((s) => s.earL), earR: med((s) => s.earR) };
}

// 저장된 가이드를 라이브 어깨에 재투영 → 그릴 정규화 점들(ear/nose/earL/earR). 어깨 미검출이면 null.
export function projectGuide(guide, lms) {
  if (!guide || !lms[G.SH_L] || !lms[G.SH_R]) return null;
  const sL = lms[G.SH_L], sR = lms[G.SH_R];
  return {
    ear: fromShoulderFrame(guide.ear, sL, sR),
    nose: fromShoulderFrame(guide.nose, sL, sR),
    earL: fromShoulderFrame(guide.earL, sL, sR),
    earR: fromShoulderFrame(guide.earR, sL, sR),
  };
}
