// 공부 특화 튜닝 검증: '내려보기(정상 공부)'는 저감점, '전방 craning(거북목)'은 고감점
import { absPenalty } from "../src/posture3d.js";
import { TUNING } from "../src/core.js";

let pass = 0, fail = 0;
const ok = (n, c, extra = "") => { if (c) pass++; else { fail++; console.log("  ✗ FAIL:", n, extra); } };

// 기준(공부 바른자세): 살짝 내려본 상태로 등록됐다고 가정
const ref = { headVertical: 0.5, shoulderTilt: 3, headPitch: 0, headForward: 0.0, shoulderSpan: 2.0, headLateral: 0, headRoll: 0 };

// A. 정상 공부 — 책을 더 내려봄: 머리 20% 내려가고 고개 30° 숙임, 전방/어깨는 그대로
const look = { headVertical: 0.40, shoulderTilt: 4, headPitch: 30, headForward: 0.02, shoulderSpan: 1.98, headLateral: 0, headRoll: 0, handToFace: null };
const pLook = absPenalty(look, ref);
ok("내려보기(정상 공부)는 페널티 ≈ 0", pLook < 0.05, `pLook=${pLook.toFixed(3)}`);

// B. 거북목 — 머리 앞으로 빠짐(forward↑) + 어깨 말림(span↓). 고개는 오히려 덜 숙임
const turtle = { headVertical: 0.38, shoulderTilt: 4, headPitch: 15, headForward: 0.35, shoulderSpan: 1.60, headLateral: 0, headRoll: 0, handToFace: null };
const pTurtle = absPenalty(turtle, ref);
ok("거북목(전방+말림)은 강한 페널티", pTurtle > 0.8, `pTurtle=${pTurtle.toFixed(3)}`);
ok("거북목 >> 내려보기 (구분됨)", pTurtle > pLook * 8, `${pTurtle.toFixed(2)} vs ${pLook.toFixed(2)}`);

// C. 경계: 고개를 아주 깊이(45°) 숙여도 전방/어깨 정상이면 감점 작아야(책 정독 허용)
const deepLook = { headVertical: 0.36, shoulderTilt: 4, headPitch: 45, headForward: 0.03, shoulderSpan: 1.95, headLateral: 0, headRoll: 0, handToFace: null };
const pDeep = absPenalty(deepLook, ref);
ok("깊은 내려보기(45°)도 완만", pDeep < 0.35, `pDeep=${pDeep.toFixed(3)}`);

// D. 어깨 기울기(진짜 나쁨)는 여전히 잡힘 — 내려보기 완화가 다른 신호를 죽이지 않았나
const tilted = { headVertical: 0.48, shoulderTilt: 20, headPitch: 5, headForward: 0.02, shoulderSpan: 1.98, headLateral: 0, headRoll: 0, handToFace: null };
ok("어깨 기울기 20°는 여전히 감점", absPenalty(tilted, ref) > 0.5, `p=${absPenalty(tilted, ref).toFixed(3)}`);

// E. core WEIGHTS 합=1, pitch 낮아짐
const wsum = Object.values(TUNING.WEIGHTS).reduce((a, b) => a + b, 0);
ok("core WEIGHTS 합 = 1", Math.abs(wsum - 1) < 1e-9, `sum=${wsum}`);
ok("core pitch 가중치 ≤ 0.10", TUNING.WEIGHTS.pitch <= 0.10, `pitch=${TUNING.WEIGHTS.pitch}`);

console.log(`\n결과: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
