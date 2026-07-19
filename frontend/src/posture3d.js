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
const IDX = { NOSE: 0, EAR_L: 7, EAR_R: 8, SH_L: 11, SH_R: 12 };
const MIN_VIS = 0.5;

// 절대 페널티 가중치 — core z-score 점수에 exp(-penalty)로 곱해 결합한다(0이면 무영향).
const ABS_W = { head: 1.6, tilt: 0.6 };
const HEAD_DROP_DEADZONE = 0.15; // 기준 대비 15% 이상 내려가야 페널티 시작
const TILT_MARGIN_DEG = 8;       // 기준 + 8도 초과부터 페널티
const TILT_FULL_DEG = 30;        // 30도 초과분에서 가중치 최대

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
  if (shoulderWidth < 1e-4) return null;
  const earMidY = (eL.y + eR.y) / 2, shMidY = (sL.y + sR.y) / 2;
  // world y 는 아래 방향(+). 귀가 어깨보다 위 → shMidY > earMidY → headVertical > 0.
  const headVertical = (shMidY - earMidY) / shoulderWidth;
  const shoulderTilt = Math.atan2(Math.abs(sR.y - sL.y), Math.abs(sR.x - sL.x) + 1e-6) * 180 / Math.PI;
  return { headVertical, shoulderTilt };
}

// 매 프레임 raw 지표에 One-Euro 를 적용해 부드럽게.
export class AbsSmoother {
  constructor() {
    this.f = {
      headVertical: new OneEuro({ minCutoff: 0.8, beta: 0.01 }),
      shoulderTilt: new OneEuro({ minCutoff: 0.8, beta: 0.01 }),
    };
  }
  update(m, t) {
    if (!m) return null;
    return {
      headVertical: this.f.headVertical.filter(m.headVertical, t),
      shoulderTilt: this.f.shoulderTilt.filter(m.shoulderTilt, t),
    };
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
  return {
    headVertical: median(good.map((s) => s.headVertical)),
    shoulderTilt: median(good.map((s) => s.shoulderTilt)),
    n: good.length,
  };
}

// 좋은 기준 대비 얼마나 나빠졌는지 → 페널티(≥0). core 점수에 exp(-penalty)로 곱한다.
export function absPenalty(m, ref) {
  if (!m || !ref || !ref.headVertical) return 0;
  let pen = 0;
  const drop = (ref.headVertical - m.headVertical) / Math.max(ref.headVertical, 1e-3);
  if (drop > HEAD_DROP_DEADZONE) pen += ABS_W.head * (drop - HEAD_DROP_DEADZONE);
  const tilt = m.shoulderTilt - (ref.shoulderTilt + TILT_MARGIN_DEG);
  if (tilt > 0) pen += ABS_W.tilt * Math.min(tilt / TILT_FULL_DEG, 1.5);
  return pen;
}

// 절대 지표 중 어떤 문제가 지배적인지 — Buddy 말풍선 부위 힌트용(없으면 null).
export function absWorst(m, ref) {
  if (!m || !ref || !ref.headVertical) return null;
  const drop = (ref.headVertical - m.headVertical) / Math.max(ref.headVertical, 1e-3);
  const tilt = (m.shoulderTilt - (ref.shoulderTilt + TILT_MARGIN_DEG)) / TILT_FULL_DEG;
  if (drop <= HEAD_DROP_DEADZONE && tilt <= 0) return null;
  return (drop - HEAD_DROP_DEADZONE) >= tilt ? "head_drop" : "shoulder_roll";
}
