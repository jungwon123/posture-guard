// reward.js 순수 로직 테스트: node rewards.test.mjs
import { Rewards, computeReport, SHOP } from "../js/reward.js";

const mem = new Map();
const storage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
};
let fails = 0;
const check = (name, cond) => { console.log((cond ? "PASS" : "FAIL") + " — " + name); if (!cond) fails++; };

const r = new Rewards(storage);

// 1) 출석: 첫 호출 +10P, 같은 날 재호출 무효
check("출석 +10P", r.attend("2026-07-18") === true && r.points === 10);
check("같은 날 중복 출석 무효", r.attend("2026-07-18") === false && r.points === 10);

// 2) 포인트: GOOD 1분당 +1 (1초 간격 틱 120회 → +2P)
let earned = 0;
for (let t = 0; t <= 120; t++) earned += r.tick("GOOD", 1000 + t, "2026-07-18");
check("GOOD 2분 → +2P", earned === 2 && r.points === 12);

// 3) BAD 중 적립 정지
let e2 = 0;
for (let t = 0; t <= 120; t++) e2 += r.tick("BAD", 2000 + t, "2026-07-18");
check("BAD 2분 → +0P", e2 === 0 && r.points === 12);

// 4) 탭 정지 공백 방어: 1시간 건너뛴 틱이 3초로 캡
r.tick("GOOD", 3000, "2026-07-18");
const e3 = r.tick("GOOD", 6600, "2026-07-18"); // 1시간 갭
check("긴 공백은 3초로 캡 (한 번에 60P 적립 방지)", e3 === 0);

// 5) 상점: 잔액 부족 → 실패, 충분 → 구매·적용
check("30P 부족 시 구매 실패", r.buy("skin_cat").ok === false);
r.points = 50;
const b = r.buy("skin_cat");
check("구매 성공 + 잔액 차감", b.ok === true && r.points === 20 && r.shop.skin === "cat");
check("중복 구매 차단", r.buy("skin_cat").ok === false);

// 6) 요정 얼굴
r.apply("skin", "fairy");
check("BAD 90초 → 분노", r.fairy("BAD", 90, false) === "🤬");
check("GOOD + BAD후보 → 경계", r.fairy("GOOD", 5, true) === "🤨");

// 7) 리포트: GOOD 60분 → BAD 10분 → GOOD 30분
const ev = [
  { t: 0, to: "GOOD" }, { t: 3600, to: "BAD" }, { t: 4200, to: "GOOD" },
];
const rep = computeReport(ev, 0, 6000);
check("리포트 감시 100분", Math.round(rep.watched) === 6000);
check("리포트 BAD 1회·10분", rep.badCount === 1 && Math.round(rep.bad) === 600);
check("최장 연속 GOOD 60분", Math.round(rep.longestGood) === 3600);
check("비율 90% = 완벽 등급", rep.ratio === 0.9 && rep.grade.includes("완벽"));

process.exit(fails ? 1 : 0);
