// 얼굴 트래킹 업그레이드(홍채 절대 거리 비율 + 카메라 전진 거북목 게이트) 단위 테스트.
// 실행: node test/iris-upgrade.mjs
import { absPenalty, absDominant, finishAbsRef } from "../src/posture3d.js";

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log("  ✓", name); } else { fail++; console.log("  ✗", name); } };

// 기준: 바른 자세 샘플 (홍채 0.030, 어깨너비 0.42)
const base = {
  headVertical: 0.8, shoulderTilt: 2, headForward: 0.1, shoulderSpan: 1.4,
  headLateral: 0, headRoll: 0, headPitch: -5, irisNorm: 0.030, camW: 0.42,
};
const ref = finishAbsRef(Array.from({ length: 10 }, () => ({ ...base })));

console.log("— 기준 캡처");
ok("ref에 irisNorm 저장", ref.irisNorm === 0.030);
ok("ref에 camW 저장", ref.camW === 0.42);

console.log("— 근접(nearTerm, 홍채 비율)");
ok("기준 그대로 → 페널티 0", absPenalty({ ...base }, ref) === 0);
ok("15% 이내 근접(데드존) → 0", absPenalty({ ...base, irisNorm: 0.030 * 1.12, camW: 0.42 * 1.12 }, ref) === 0);
{
  // 몸 전체가 크게 다가옴(홍채 +45%, 어깨도 +45%) → 근접 페널티만, worst=proximity
  const m = { ...base, irisNorm: 0.030 * 1.45, camW: 0.42 * 1.45 };
  ok("몸 전체 근접 45% → 페널티 > 0", absPenalty(m, ref) > 0);
  ok("worst = proximity(화면 거리)", absDominant(m, ref)?.key === "proximity");
}
ok("멀어짐(홍채 -30%) → 0 (비대칭)", absPenalty({ ...base, irisNorm: 0.030 * 0.7, camW: 0.42 * 0.7 }, ref) === 0);

console.log("— 카메라 전진 거북목(camForwardTerm, 몸통 게이트)");
{
  // 얼굴만 30% 가까워짐(어깨너비 그대로) = 거북목 — worst 는 head_drop 계열
  const m = { ...base, irisNorm: 0.030 * 1.30, camW: 0.42 };
  ok("얼굴만 전진 30% → 페널티 > 0", absPenalty(m, ref) > 0);
  ok("worst = head_drop(거북목류)", absDominant(m, ref)?.key === "head_drop");
}
{
  // 몸 전체 근접(어깨 +20%)이면 camfwd 게이트 꺼짐 — 홍채 +20%는 근접 데드존 초과라 proximity만
  const m = { ...base, irisNorm: 0.030 * 1.20, camW: 0.42 * 1.20 };
  ok("몸 전체 근접 시 거북목 게이트 off (worst≠head_drop)", absDominant(m, ref)?.key !== "head_drop");
}

console.log("— 하위 호환(무해성)");
{
  // 옛 프로필(irisNorm 없는 ref): 두 게이트 전부 auto-skip
  const oldRef = finishAbsRef(Array.from({ length: 10 }, () => {
    const { irisNorm, camW, ...rest } = base; return rest;
  }));
  ok("옛 ref → irisNorm 미저장", oldRef.irisNorm == null);
  ok("옛 ref + 홍채 근접 45% → 페널티 0 (게이트 skip)",
    absPenalty({ ...base, irisNorm: 0.030 * 1.45 }, oldRef) === 0);
  ok("홍채 미검출 측정 → 페널티 0", absPenalty({ ...base, irisNorm: undefined, camW: undefined }, ref) === 0);
}

console.log(`결과: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
