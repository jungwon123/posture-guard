// 측면 모드(베타) 단위 테스트 — extractSide·finishSideRef·sidePenalty·sideDominant. 실행: node test/side-mode.mjs
import { extractSide, finishSideRef, sidePenalty, sideDominant, SideSmoother } from "../src/posture3d.js";

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log("  ✓", name); } else { fail++; console.log("  ✗", name); } };
const approx = (a, b, e = 0.02) => Math.abs(a - b) < e;

// 합성 랜드마크: 33점 배열, 왼쪽(7,11)이 카메라에 가까운 프로필. 코 = 전방 방향 결정.
const mk = ({ earX = 0.5, earY = 0.3, shX = 0.5, shY = 0.55, noseX = 0.62, noseY = 0.32, mirror = false, noNose = false }) => {
  const a = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0 }));
  const nearEar = mirror ? 8 : 7, farEar = mirror ? 7 : 8, nearSh = mirror ? 12 : 11, farSh = mirror ? 11 : 12;
  a[nearEar] = { x: earX, y: earY, visibility: 0.9 };
  a[farEar] = { x: 0, y: 0, visibility: 0.1 };
  a[nearSh] = { x: shX, y: shY, visibility: 0.9 };
  a[farSh] = { x: 0, y: 0, visibility: 0.1 };
  a[0] = noNose ? { x: 0, y: 0, visibility: 0.1 } : { x: noseX, y: noseY, visibility: 0.9 };
  return a;
};

console.log("— 추출·부호");
const up = extractSide(mk({}));
ok("정자세: fhp ≈ 0", approx(up.fhp, 0));
ok("정자세: 목 각도 ≈ 0°", approx(up.neckAngle, 0, 0.5));
ok("가까운 쪽 자동 감지 (left)", up.side === "left");

const fwd = extractSide(mk({ earX: 0.58 })); // 귀가 코 방향(+x)으로 — 거북목
ok("거북목: fhp > 0.25", fwd.fhp > 0.25);
ok("거북목: 목 각도 > 10°", fwd.neckAngle > 10);

const mirrorFwd = extractSide(mk({ earX: 0.42, noseX: 0.38, mirror: true })); // 반대편 배치: 전방 = -x
ok("반대편 배치도 거북목 fhp > 0.25", mirrorFwd.fhp > 0.25 && mirrorFwd.side === "right");

const back = extractSide(mk({ earX: 0.45 })); // 귀가 뒤로(젖힘) — 음수
ok("뒤로 젖힘: fhp < 0", back.fhp < 0);

const down = extractSide(mk({ noseY: 0.45 })); // 코가 귀보다 아래 — 고개 숙임
ok("고개 숙임: headPitch 증가", down.headPitch > up.headPitch + 10);

console.log("— 가드");
ok("어깨 미검출 → null", extractSide(mk({})) && extractSide((() => { const a = mk({}); a[11].visibility = 0.2; return a; })()) === null);
const noN = extractSide(mk({ noNose: true }));
ok("코 미검출이어도 동작(전방부호 기본값)·headPitch null", noN !== null && noN.headPitch === null);
ok("입력 null → null", extractSide(null) === null);

console.log("— 기준·페널티");
const samples = Array.from({ length: 20 }, () => extractSide(mk({})));
samples.push(extractSide(mk({ earX: 0.7 }))); // 이상치 1개 — median이 걸러야
const ref = finishSideRef(samples);
ok("기준: fhp ≈ 0 (이상치 무시)", approx(ref.fhp, 0));
ok("표본 부족(<5) → null", finishSideRef(samples.slice(0, 3)) === null);

ok("정자세 페널티 = 0", sidePenalty(up, ref) === 0);
const penF = sidePenalty(fwd, ref);
ok("거북목 페널티 > 0.5", penF > 0.5);
ok("지배 신호 = head_drop(거북목류)", sideDominant(fwd, ref)?.key === "head_drop");
ok("기준 없음 → 페널티 0 (무해)", sidePenalty(fwd, null) === 0 && sidePenalty(fwd, {}) === 0);

console.log("— 스무더 무해성");
const sm2 = new SideSmoother();
const s1 = sm2.update(extractSide(mk({})), 0);
const s2 = sm2.update(extractSide(mk({})), 0.1);
ok("스무딩 후에도 fhp ≈ 0 유지", approx(s2.fhp, 0) && Number.isFinite(s1.fhp));
ok("null 입력 → null", sm2.update(null, 0.2) === null);

console.log(`결과: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
