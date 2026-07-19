// 패리티 테스트: 같은 녹화 JSON을 JS 코어로 리플레이한 전이가
// posture_guard.py --replay 결과와 일치하는지 확인.
// 사용: node parity.mjs <rec.json> [expected.txt]
//   expected.txt 없이 실행하면 전이만 출력.
//   expected.txt: "t,from,to" 줄 목록 (t는 첫 프레임 기준 상대 초)
import { readFileSync } from "node:fs";
import { replay } from "../js/core.js";

const recPath = process.argv[2];
if (!recPath) {
  console.error("usage: node parity.mjs <rec.json> [expected.txt]");
  process.exit(2);
}
const data = JSON.parse(readFileSync(recPath, "utf8"));
const t0 = data.frames[0].t;
const got = replay(data).map(([t, a, b]) => `${(t - t0).toFixed(1)},${a},${b}`);

console.log(`${data.frames.length} frames replayed (JS core)`);
for (const line of got) console.log("  " + line);

const expectedPath = process.argv[3];
if (expectedPath) {
  const want = readFileSync(expectedPath, "utf8").trim().split("\n").map((s) => s.trim());
  const ok = got.length === want.length && got.every((g, i) => g === want[i]);
  if (!ok) {
    console.error("\nPARITY FAIL");
    console.error("expected:\n  " + want.join("\n  "));
    process.exit(1);
  }
  console.log("\nPARITY OK — 파이썬 리플레이와 전이 일치");
}
