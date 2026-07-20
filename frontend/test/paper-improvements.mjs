// 논문 반영 개선 단위테스트: (1) absPenalty 중복감점 완화 (2) CAUTION 상태머신
import { absPenalty, absDominant } from "/Users/jwon/Downloads/turtle/frontend/src/posture3d.js";
import { StateMachine, TUNING } from "/Users/jwon/Downloads/turtle/frontend/src/core.js";

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.log("  ✗ FAIL:", name); } };
const approx = (a, b, e = 1e-6) => Math.abs(a - b) < e;

// ── (1) absPenalty: 상관 신호 중복 감점 완화 ──
// ref: 바른 자세 기준
const ref = { headVertical: 0.5, shoulderTilt: 3, headPitch: 0, headForward: 0.0, shoulderSpan: 2.0, headLateral: 0, headRoll: 0 };
// 거북목만 심하게(단일 지배 신호) — 페널티는 forward term 그대로여야
const mForwardOnly = { headVertical: 0.5, shoulderTilt: 3, headForward: 0.40, shoulderSpan: 2.0, headLateral: 0, headRoll: 0, headPitch: 0, handToFace: null };
const pForward = absPenalty(mForwardOnly, ref);
ok("단일 거북목 페널티 > 0", pForward > 0.3);

// 거북목 + 고개숙임 + 어깨말림 동시(상관 신호 3개) — sum이면 3배, 우리는 dominant+할인이라 sum보다 작아야
const mSlouch = { headVertical: 0.3, shoulderTilt: 3, headForward: 0.40, shoulderSpan: 1.6, headLateral: 0, headRoll: 0, headPitch: 40, handToFace: null };
const pSlouch = absPenalty(mSlouch, ref);
// 순수 합산이었다면 각 term 가중합. dominant+0.35*나머지라 '합'보다 확실히 작아야.
// 개별 기여도 재구성해서 sum과 비교
const terms = absDominant(mSlouch, ref);
ok("복합 슬라우치 지배신호 존재", terms && terms.c > 0);
ok("복합 페널티가 지배신호보다는 큼(나머지 일부 반영)", pSlouch > terms.c - 1e-9);
// dominant + 할인 결합이므로, 페널티 <= 모든 기여 단순합. 단순합 근사 계산:
// (직접 합을 못 구하니) 최소한 pSlouch < pForward * 3 (3개 신호가 각자 forward만큼이어도 3배는 안 됨)
ok("중복감점 억제: 복합 < 단일×3", pSlouch < pForward * 3);
ok("바른자세면 페널티 0", approx(absPenalty(ref === ref ? { ...ref, handToFace: null } : ref, ref), 0));

// dominant는 여전히 최댓값 신호를 고름(거북목류=head_drop)
ok("dominant 키 = head_drop(거북목)", absDominant(mForwardOnly, ref)?.key === "head_drop");

// ── (2) CAUTION 상태머신 ──
function run(seq) { // seq: [[score, t], ...] — 마지막 상태 반환
  const sm = new StateMachine(); sm.state = "GOOD"; sm.stateSince = 0;
  let s;
  for (const [score, t] of seq) s = sm.update(score, t);
  return sm.state;
}
// GOOD → 완만한 하락(70, 60~73 사이) 2.5s 지속 → CAUTION
ok("GOOD→CAUTION (score70, 2.5s)", run([[70, 0], [70, 3]]) === "CAUTION");
// GOOD, 잠깐(2.5s 미만)이면 아직 GOOD
ok("GOOD 유지(2s만)", run([[70, 0], [70, 2]]) === "GOOD");
// GOOD → 급락(50<60) 7s → BAD (주의 안 거치고)
ok("GOOD→BAD (score50, 7s)", run([[50, 0], [50, 7.1]]) === "BAD");
// GOOD → 급락 5s만이면 아직 GOOD (BAD sustain 7s)
ok("GOOD 급락 5s는 아직 GOOD", run([[50, 0], [50, 5]]) === "GOOD");
// CAUTION → 회복(80>=75) 3s → GOOD
ok("CAUTION→GOOD (score80, 3s)", run([[70, 0], [70, 3], [80, 3], [80, 6.1]]) === "GOOD");
// CAUTION → 악화(50) 5s → BAD
ok("CAUTION→BAD (score50, 5s)", run([[70, 0], [70, 3], [50, 3], [50, 8.1]]) === "BAD");
// BAD → 부분회복(74, 73~75) 2.5s → CAUTION
ok("BAD→CAUTION (score74, 2.5s)", run([[50, 0], [50, 7.1], [74, 8], [74, 11]]) === "CAUTION");
// BAD → 완전회복(80) 3s → GOOD
ok("BAD→GOOD (score80, 3s)", run([[50, 0], [50, 7.1], [80, 8], [80, 11.1]]) === "GOOD");
// CAUTION에서 애매한 점수(70, 60~75)면 그대로 유지(튐 방지)
ok("CAUTION 유지(score70)", run([[70, 0], [70, 3], [70, 6], [70, 20]]) === "CAUTION");
// AWAY 복귀는 여전히 GOOD
ok("null(사람없음) 10s → AWAY", run([[null, 0], [null, 10.1]]) === "AWAY");

console.log(`\n결과: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
