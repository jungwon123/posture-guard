// 과목별 타이머(P0) — computeSubjects 스트림 머지 단위 테스트. 실행: node test/subjects.mjs
import { computeSubjects } from "../src/subjects.js";

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log("  ✓", name); } else { fail++; console.log("  ✗", name); } };

// 자세: GOOD 0..100, AWAY 100..150, GOOD 150..250, BAD 250..300(열림)
const events = [
  { t: 0, to: "GOOD" }, { t: 100, to: "AWAY" }, { t: 150, to: "GOOD" }, { t: 250, to: "BAD" },
];
// 과목: 수학 t=0, 국어 t=200, 해제 t=280
const subjLog = [{ t: 0, id: "math" }, { t: 200, id: "kor" }, { t: 280, id: null }];

const r = computeSubjects(events, subjLog, 0, 300);
console.log("— 기본 머지 (착석 × 과목 교집합)");
ok("수학 watched=150 (GOOD 0-100 + GOOD 150-200, AWAY 자동 제외)", r.math?.watched === 150);
ok("수학 good=150", r.math?.good === 150);
ok("국어 watched=80 (GOOD 200-250 + BAD 250-280)", r.kor?.watched === 80);
ok("국어 good=50 (BAD 구간은 good 제외)", r.kor?.good === 50);
ok("해제 후 _none watched=20 (BAD 280-300)", r._none?.watched === 20);

console.log("— 창 경계·초기 상태");
const r2 = computeSubjects(events, subjLog, 170, 220); // 창 시작 전 상태(GOOD)·과목(math) 이어받기
ok("창 중간 진입: 수학 30 (170-200)", r2.math?.watched === 30);
ok("창 중간 진입: 국어 20 (200-220)", r2.kor?.watched === 20);

console.log("— 빈 입력 무해성");
ok("과목 로그 없음 → 전부 _none (총 착석 250)", computeSubjects(events, [], 0, 300)._none?.watched === 250);
ok("이벤트 없음 → 빈 결과", Object.keys(computeSubjects([], subjLog, 0, 300)).length === 0);

console.log(`결과: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
