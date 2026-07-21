// 보상·알림설정 계층 (기능 v2) — 판정 코어(core.js)와 분리. 전부 로컬 저장.
// 규칙은 docs/기능-v2.md 가 SSoT.

export const MELODIES = {
  dingdong: { label: "딩동", notes: [[660, .15], [880, .30]] },
  chime:    { label: "차임", notes: [[523, .12], [659, .12], [784, .25]] },
  sparkle:  { label: "뾰로롱", notes: [[880, .08], [1175, .08], [1568, .20]] },
  alarm:    { label: "경보", notes: [[880, .15], [0, .05], [880, .15], [0, .05], [880, .30]] },
};

// 스킨: spriteDir 있으면 이미지 스프라이트(아틀라스+GIF), 없으면 이모지.
// 이미지 스킨도 이모지 필드(good 등)를 두어 알림 문구에서 fallback으로 쓴다.
const IMG = (label, dir, good) => ({
  label, spriteDir: `assets/fairy/skins/${dir}`, atlas: `assets/fairy/skins/${dir}/atlas.png`,
  egg: "🥚", good, warn: good, bad: good, rage: good, happy: good, away: "💤",
});
export const SKINS = {
  fairy: { label: "척추요정", spriteDir: "assets/fairy", atlas: "assets/fairy/cheokcheok-atlas.png",
           egg: "🥚", good: "🧚", warn: "🤨", bad: "😠", rage: "🤬", happy: "🥰", away: "💤" },
  cat:   { label: "고양이",   egg: "🥚", good: "🐱", warn: "😼", bad: "😾", rage: "🙀", happy: "😻", away: "💤" },
  bear:  { label: "곰",      egg: "🥚", good: "🐻", warn: "🐻", bad: "🐻‍❄️", rage: "🐻‍❄️", happy: "🧸", away: "💤" },
  strawberry: IMG("딸기 디저트 요정", "strawberry", "🍓"),
  ocean:      IMG("바다 요정", "ocean", "🌊"),
  crystal:    IMG("크리스탈 요정", "crystal", "💎"),
  moonlight:  IMG("달빛 요정", "moonlight", "🌙"),
  forest:     IMG("숲 요정", "forest", "🌲"),
  blue:       IMG("파랑 요정", "blue", "💙"),
  yellow:     IMG("노랑 요정", "yellow", "💛"),
  pink:       IMG("핑크 요정", "pink", "💗"),
  idol:       IMG("아이돌 요정", "idol", "🎤"),
};

// 상점 등급 (목업: 레어/에픽/프리미엄)
export const TIERS = [
  { id: "rare",    label: "레어",    sub: "특별한 시작!" },
  { id: "epic",    label: "에픽",    sub: "마법이 깃든 요정" },
  { id: "premium", label: "프리미엄", sub: "단 하나뿐인 빛" },
];

export const SHOP = [
  // 레어
  { id: "skin_blue",   type: "skin", key: "blue",   label: "파랑 요정", tier: "rare", price: 500 },
  { id: "skin_yellow", type: "skin", key: "yellow", label: "노랑 요정", tier: "rare", price: 700 },
  { id: "skin_pink",   type: "skin", key: "pink",   label: "핑크 요정", tier: "rare", price: 900 },
  // 에픽
  { id: "skin_moonlight", type: "skin", key: "moonlight", label: "달빛 요정",   tier: "epic", price: 2000 },
  { id: "skin_crystal",   type: "skin", key: "crystal",   label: "크리스탈 요정", tier: "epic", price: 2500 },
  { id: "skin_forest",    type: "skin", key: "forest",    label: "숲 요정",     tier: "epic", price: 3000 },
  // 프리미엄
  { id: "skin_strawberry", type: "skin", key: "strawberry", label: "딸기 디저트 요정", tier: "premium", price: 8000 },
  { id: "skin_ocean",      type: "skin", key: "ocean",      label: "바다 요정",       tier: "premium", price: 10000 },
  { id: "skin_idol",       type: "skin", key: "idol",       label: "아이돌 요정",     tier: "premium", price: 12000 },
];

export const DEFAULT_SETTINGS = {
  mode: "sound",        // sound | vibrate | both | silent
  melody: "dingdong",
  volume: 0.7,          // 0~1
  vibrate: "2",         // 진동 횟수 "1" | "2" | "3" (강도 제어는 웹에서 불가 — 횟수로 통일)
};

const GOOD_SEC_PER_POINT = 60;
const ATTEND_BONUS = 10;

export class Rewards {
  constructor(storage) {
    this.s = storage;
    this.points = +(storage.getItem("pg_points") || 0);
    this.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(storage.getItem("pg_settings") || "{}") };
    this.shop = { owned: [], skin: "fairy", ...JSON.parse(storage.getItem("pg_shop") || "{}") };
    this.today = JSON.parse(storage.getItem("pg_today") || "null") || { date: "", earned: 0 };
    this.goodAcc = 0;
    this.lastTick = null;
  }
  _save() {
    this.s.setItem("pg_points", String(this.points));
    this.s.setItem("pg_settings", JSON.stringify(this.settings));
    this.s.setItem("pg_shop", JSON.stringify(this.shop));
    this.s.setItem("pg_today", JSON.stringify(this.today));
  }
  _earn(n, dateStr) {
    if (this.today.date !== dateStr) this.today = { date: dateStr, earned: 0 };
    this.points += n;
    this.today.earned += n;
    this._save();
  }

  // 매 감지 틱마다 호출. GOOD 1분당 +1P. 적립되면 그 양을 반환.
  tick(state, nowSec, dateStr) {
    const dt = this.lastTick === null ? 0 : Math.min(nowSec - this.lastTick, 3); // 탭 정지 공백 방어
    this.lastTick = nowSec;
    if (state !== "GOOD") return 0;
    this.goodAcc += dt;
    let earned = 0;
    while (this.goodAcc >= GOOD_SEC_PER_POINT) {
      this.goodAcc -= GOOD_SEC_PER_POINT;
      earned += 1;
    }
    if (earned) this._earn(earned, dateStr);
    return earned;
  }

  // 하루 첫 감지 시작 시 +10P. 지급했으면 true. 출석 캘린더용으로 날짜도 기록.
  attend(dateStr) {
    if (this.s.getItem("pg_attend_last") === dateStr) return false;
    this.s.setItem("pg_attend_last", dateStr);
    const days = JSON.parse(this.s.getItem("pg_attend_days") || "[]");
    if (!days.includes(dateStr)) days.push(dateStr);
    this.s.setItem("pg_attend_days", JSON.stringify(days.slice(-60)));
    this._earn(ATTEND_BONUS, dateStr);
    return true;
  }

  buy(itemId) {
    const item = SHOP.find((i) => i.id === itemId);
    if (!item) return { ok: false, msg: "없는 상품" };
    if (item.soon) return { ok: false, msg: "곧 나와요, 조금만 기다려주세요" };
    if (this.shop.owned.includes(itemId)) return { ok: false, msg: "이미 보유 중" };
    if (this.points < item.price) return { ok: false, msg: `포인트 부족 (${item.price}P 필요)` };
    this.points -= item.price;
    this.shop.owned.push(itemId);
    // 사자마자 적용
    if (item.type === "skin") this.shop.skin = item.key;
    this._save();
    return { ok: true, msg: `${item.label} 구매 완료!` };
  }
  apply(type, key) {
    if (type === "skin" && (key === "fairy" || this.shop.owned.some((id) => SHOP.find((i) => i.id === id)?.key === key))) this.shop.skin = key;
    this._save();
  }
  ownedOf(type) {
    const base = type === "skin" ? ["fairy"] : [];
    return base.concat(SHOP.filter((i) => i.type === type && this.shop.owned.includes(i.id)).map((i) => i.key));
  }

  // 척추요정 얼굴: 상태 + 지속시간 + BAD 후보 여부 → 이모지
  fairy(state, dur, badCandidate) {
    const skin = SKINS[this.shop.skin] || SKINS.fairy;
    if (state === "UNCALIBRATED") return skin.egg;
    if (state === "AWAY") return skin.away;
    if (state === "BAD") return dur >= 60 ? skin.rage : skin.bad;
    if (state === "CAUTION") return skin.warn;   // 주의 — 알람 없이 표정만 살짝 걱정
    if (badCandidate) return skin.warn;
    return skin.good;
  }
}

// 오늘 리포트 — 상태 전이 기록(events)에서 계산. 순수 함수.
export function computeReport(events, dayStartSec, nowSec) {
  const acc = { GOOD: 0, CAUTION: 0, BAD: 0, AWAY: 0 };
  let badCount = 0, longestGood = 0;
  for (let i = 0; i < events.length; i++) {
    const start = Math.max(events[i].t, dayStartSec);
    const end = i + 1 < events.length ? events[i + 1].t : nowSec;
    if (end <= dayStartSec) continue;
    const st = events[i].to;
    if (st in acc) acc[st] += end - start;
    if (st === "GOOD") longestGood = Math.max(longestGood, end - start);
    if (st === "BAD" && events[i].t >= dayStartSec) badCount++;
  }
  // 감시시간 = 바른+주의+나쁜(자리비움 제외). 주의는 '완전한 바름'은 아니라 비율을 살짝 낮춘다.
  const watched = acc.GOOD + acc.CAUTION + acc.BAD;
  const ratio = watched > 0 ? acc.GOOD / watched : null;
  const grade = ratio === null ? "" :
    ratio >= 0.9 ? "완벽! 요정이 춤을 춰요" :
    ratio >= 0.7 ? "좋아요, 조금만 더!" : "내일은 요정을 웃게 해줘요";
  return { watched, good: acc.GOOD, bad: acc.BAD, badCount, longestGood, ratio, grade };
}
