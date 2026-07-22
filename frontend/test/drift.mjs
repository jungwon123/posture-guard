// 슬로우 드리프트 감지(computeDrift) 단위 테스트. 실행: node test/drift.mjs
import { computeDrift } from "../src/posture3d.js";

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log("  ✓", name); } else { fail++; console.log("  ✗", name); } };
const approx = (a, b, e = 0.01) => Math.abs(a - b) < e;

const REF_HV = 0.5;
const mk = (n, hvFn, fwdFn) => Array.from({ length: n }, (_, i) => ({ t: i * 2, hv: hvFn(i), fwd: fwdFn ? fwdFn(i) : undefined }));

console.log("— 안정 상태");
const stable = computeDrift(mk(100, () => 0.5, () => 0.1), REF_HV);
ok("변화 없음 → hvDrop ≈ 0", approx(stable.hvDrop, 0));
ok("변화 없음 → fwdRise ≈ 0", approx(stable.fwdRise, 0));

console.log("— 서서히 가라앉음 (hv 0.5 → 0.42 선형)");
const sink = computeDrift(mk(100, (i) => 0.5 - (0.08 * i) / 99, () => 0.1), REF_HV);
// 전/후반 평균차 = 전체 낙폭의 절반 = 0.04 → /ref 0.5 = 0.08
ok("hvDrop ≈ +0.08 (기준 대비)", approx(sink.hvDrop, 0.08, 0.012));
ok("fwd는 무변화", approx(sink.fwdRise, 0));

console.log("— 서서히 전방이동 (fwd 0.0 → 0.16 선형)");
const crane = computeDrift(mk(100, () => 0.5, (i) => (0.16 * i) / 99), REF_HV);
ok("fwdRise ≈ +0.08", approx(crane.fwdRise, 0.08, 0.012));
ok("hv는 무변화", approx(crane.hvDrop, 0));

console.log("— 좋아지는 방향(음수)·노이즈 무해성");
const up = computeDrift(mk(100, (i) => 0.42 + (0.08 * i) / 99, () => 0.1), REF_HV);
ok("펴는 중이면 hvDrop 음수", up.hvDrop < 0);
const noisy = computeDrift(mk(100, (i) => 0.5 + (i % 2 ? 0.02 : -0.02), () => 0.1), REF_HV);
ok("교대 노이즈는 평균화 → ≈0", approx(noisy.hvDrop, 0, 0.02));

console.log("— 결측·가드");
ok("샘플 부족(<10) → null", computeDrift(mk(5, () => 0.5), REF_HV) === null);
ok("ref 없음 → null", computeDrift(mk(100, () => 0.5), 0) === null);
const noFwd = computeDrift(mk(100, (i) => 0.5 - (0.08 * i) / 99), REF_HV);
ok("fwd 전결측이어도 hvDrop 계산", approx(noFwd.hvDrop, 0.08, 0.012) && noFwd.fwdRise === 0);

console.log(`결과: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
