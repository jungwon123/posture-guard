// 서버 동기화 계층 — 로그인 계정에 포인트·요정(상점)·출석을 백업/복원한다.
// 백엔드 계약(docs/백엔드-설계.md): POST /api/sync {token, data}, POST /api/sync-pull {token}.
// 실패는 전부 조용히 무시(오프라인 우선 — 로컬이 진실, 서버는 백업).

export const API_BASE = "https://34-64-158-222.sslip.io";

// 구글 소셜 로그인 클라이언트 ID — 빈 문자열이면 미설정(로그인 화면에 구글 버튼이 안 뜸).
// Google Cloud 콘솔에서 OAuth 클라이언트(웹) 만들고 여기에 채우면 켜진다.
export const GOOGLE_CLIENT_ID = "291653947562-29ijtudcujiff6ogsj5icbvn6gmrpabb.apps.googleusercontent.com";

const jparse = (k, fallback) => {
  try { return JSON.parse(localStorage.getItem(k) ?? "null") ?? fallback; } catch { return fallback; }
};

// ── 로그인 상태 (pg_auth = {token, nickname, needsNickname?}) ──
// needsNickname: 가입/첫 구글 로그인 직후 닉네임 온보딩이 필요하면 true. 온보딩 완료 시 키 자체를 제거.
export function getAuth() {
  const a = jparse("pg_auth", null);
  return a && a.token ? a : null;
}
export function setAuth(token, nickname, needsNickname) {
  const auth = { token, nickname };
  if (needsNickname) auth.needsNickname = true; // falsy면 키 미포함(기존 사용자와 동일 형태)
  localStorage.setItem("pg_auth", JSON.stringify(auth));
}
export function clearAuth() { localStorage.removeItem("pg_auth"); }

// ── 동기화 페이로드 — 로컬 진실을 모아 서버로 (points·shop·att 필수) ──
export function collectData() {
  return {
    points: +(localStorage.getItem("pg_points") || 0),
    shop: { owned: [], skin: "fairy", ...jparse("pg_shop", {}) },
    att: { // 출석 — reward.js가 쓰는 실제 키: pg_attend_days(YYYY-MM-DD 배열), pg_attend_last
      days: jparse("pg_attend_days", []),
      last: localStorage.getItem("pg_attend_last") || null,
    },
    goal: jparse("pg_goal", null),         // 오늘 목표(시간·자세%·D-Day) — P0
    subjects: jparse("pg_subjects", null), // 과목 사전(이름·색) — P0. 과목 로그는 로컬 온리(P1에서 서버화)
  };
}

// ── 복원 (로그인 직후) — 서버 data를 로컬에 기록. 없는 키는 건드리지 않는다 ──
export function restoreData(data) {
  if (!data || typeof data !== "object") return;
  if (data.points != null) localStorage.setItem("pg_points", String(Math.max(0, +data.points || 0)));
  if (data.shop && typeof data.shop === "object") localStorage.setItem("pg_shop", JSON.stringify(data.shop));
  if (data.att && typeof data.att === "object") {
    if (Array.isArray(data.att.days)) localStorage.setItem("pg_attend_days", JSON.stringify(data.att.days));
    if (data.att.last) localStorage.setItem("pg_attend_last", String(data.att.last));
  }
  if (data.goal && typeof data.goal === "object") localStorage.setItem("pg_goal", JSON.stringify(data.goal));
  if (Array.isArray(data.subjects)) localStorage.setItem("pg_subjects", JSON.stringify(data.subjects));
}

// ── 부팅 병합 (이미 로그인된 상태) — 단순 max/합집합 병합 후 로컬에 기록, 병합 결과를 반환.
// 포인트는 큰 쪽, 상점 owned는 합집합, 출석 days도 합집합. 스킨은 로컬 우선(갑자기 안 바뀌게).
export function mergeData(server) {
  const local = collectData();
  if (!server || typeof server !== "object") return { data: local, changed: false };
  const points = Math.max(local.points, +server.points || 0);
  const owned = [...new Set([...(local.shop.owned || []), ...(server.shop?.owned || [])])];
  const skin = local.shop.skin || server.shop?.skin || "fairy";
  const days = [...new Set([...(local.att.days || []), ...(server.att?.days || [])])].sort().slice(-60);
  const merged = {
    points,
    shop: { ...server.shop, ...local.shop, owned, skin },
    att: { days, last: local.att.last || server.att?.last || null },
    // 목표·과목: 최신 수정 우선(goal은 updatedAt 비교), 과목은 로컬 우선(없으면 서버)
    goal: (local.goal?.updatedAt || 0) >= (server.goal?.updatedAt || 0) ? local.goal : server.goal,
    subjects: local.subjects || server.subjects || null,
  };
  const changed = points !== local.points
    || owned.length !== (local.shop.owned || []).length
    || days.length !== (local.att.days || []).length
    || (!local.goal && !!server.goal) || (!local.subjects && !!server.subjects);
  if (changed) restoreData(merged);
  return { data: merged, changed };
}

// ── 서버 호출 ──
async function post(path, body) {
  const res = await fetch(`${API_BASE}/api/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// 동기화 401 = 토큰 무효(계정 삭제·토큰 교체 등) — 로그인 상태를 정리해 설정에서 재로그인을 유도.
// 네트워크 오류(status 없음)는 로그아웃하지 않는다.
const dropAuthIf401 = (e) => { if (e && e.status === 401) clearAuth(); };

export async function apiRegister(email, password, memberId) {
  return post("register", { email, password, memberId });
}
export async function apiLogin(email, password) {
  return post("login", { email, password });
}
// 닉네임 설정(온보딩) — 성공 시 {ok, nickname}. 400 "닉네임은 2~12자"·409 "이미 있는 닉네임이에요"는 error로 throw.
export async function apiSetNickname(token, nickname) {
  return post("set-nickname", { token, nickname });
}
// 구글 로그인 — GIS credential(JWT)을 서버로 보내 검증. 응답은 /api/login과 동일 형태.
export async function apiGoogleLogin(credential, memberId) {
  return post("google-login", { credential, memberId });
}

// 업로드 — 로그인 상태일 때만. 실패는 조용히 무시(다음 주기에 재시도).
let pushing = false;
export async function pushSync() {
  const auth = getAuth();
  if (!auth || pushing) return;
  pushing = true;
  try { await post("sync", { token: auth.token, data: collectData() }); } catch (e) { dropAuthIf401(e); }
  finally { pushing = false; }
}

// 서버 최신본 내려받기 — 성공 시 data, 아니면 null.
export async function syncPull() {
  const auth = getAuth();
  if (!auth) return null;
  try { const r = await post("sync-pull", { token: auth.token }); return r.data ?? null; }
  catch (e) { dropAuthIf401(e); return null; }
}

// 주기 업로드 시작 — 60초 주기 + 탭이 숨겨질 때 1회(앱 이탈 직전 백업). 최초 1회 즉시.
let loopStarted = false;
export function startSyncLoop() {
  if (loopStarted || !getAuth()) return;
  loopStarted = true;
  pushSync(); pushDaily();
  setInterval(() => { pushSync(); pushDaily(); }, 60_000);
  document.addEventListener("visibilitychange", () => { if (document.hidden) { pushSync(); pushDaily(); } });
}

// ── 일별 공부/자세 집계 (pg_daily = {"YYYY-MM-DD": {watched,good,caution,bad,badCount,longestGood}}) ──
// 이벤트 로그(pg_events)는 최근 2000건 캡이라 오래된 날짜가 유실된다 — 일별 스냅샷으로 영구화.
// 날짜 키는 로컬 기준(자정~오전엔 UTC 날짜가 전날로 밀리는 문제 방지).
export const localDateStr = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function readDaily() { return jparse("pg_daily", {}); }

const mergeDay = (cur, next) => ({
  watched: Math.max(cur?.watched || 0, Math.round(next.watched || 0)),
  good: Math.max(cur?.good || 0, Math.round(next.good || 0)),
  caution: Math.max(cur?.caution || 0, Math.round(next.caution || 0)),
  bad: Math.max(cur?.bad || 0, Math.round(next.bad || 0)),
  badCount: Math.max(cur?.badCount || 0, next.badCount || 0),
  longestGood: Math.max(cur?.longestGood || 0, Math.round(next.longestGood || 0)),
});

function saveDaily(all) {
  const keys = Object.keys(all).sort(); // 400일 초과분 정리(스토리지 보호)
  keys.slice(0, Math.max(0, keys.length - 400)).forEach((k) => delete all[k]);
  localStorage.setItem("pg_daily", JSON.stringify(all));
}

// 오늘 스냅샷 기록 — 엔진이 1분 주기·측정 종료 시 호출. 필드별 max(하루 안에서 단조 증가).
export function writeDailySnapshot(rep) {
  if (!rep || !(rep.watched > 0)) return;
  const all = readDaily();
  const key = localDateStr();
  const caution = Math.max(0, rep.watched - rep.good - rep.bad);
  all[key] = mergeDay(all[key], { ...rep, caution });
  saveDaily(all);
}

// 오늘 스냅샷 재계산(1회 마이그레이션) — 오염 기간에 max 병합·GREATEST로 박제된 오늘 값을
// '이벤트 재계산 진실'로 로컬·서버 모두 교체. 라이브 표면(타이머·차트)과 캘린더·서버가 다시 일치한다.
export async function recalcTodaySnapshot(rep) {
  const key = localDateStr();
  const caution = Math.max(0, (rep?.watched || 0) - (rep?.good || 0) - (rep?.bad || 0));
  const day = {
    watched: Math.round(rep?.watched || 0), good: Math.round(rep?.good || 0), caution: Math.round(caution),
    bad: Math.round(rep?.bad || 0), badCount: rep?.badCount || 0, longestGood: Math.round(rep?.longestGood || 0),
  };
  const all = readDaily();
  all[key] = day; // 교체 (max 병합 아님)
  saveDaily(all);
  localStorage.setItem("pg_daily_recalc_at", String(Date.now())); // pull 병합 보호창 시작
  const auth = getAuth();
  if (!auth) return;
  try { await post("daily", { token: auth.token, overwrite: true, days: [{ date: key, ...day }] }); }
  catch (e) { dropAuthIf401(e); }
}

// 최근 14일 업로드 — 로그인 상태일 때만. 서버도 GREATEST 병합이라 중복 전송 안전.
let pushingDaily = false;
export async function pushDaily() {
  const auth = getAuth();
  if (!auth || pushingDaily) return;
  const all = readDaily();
  const keys = Object.keys(all).sort().slice(-14);
  if (!keys.length) return;
  pushingDaily = true;
  try { await post("daily", { token: auth.token, days: keys.map((d) => ({ date: d, ...all[d] })) }); }
  catch (e) { dropAuthIf401(e); } finally { pushingDaily = false; }
}

// 범위 내려받기(캘린더 월 이동 시) — 서버 기록을 로컬 pg_daily에 max 병합 후 전체 반환.
export async function pullDailyRange(from, to) {
  const auth = getAuth();
  if (!auth) return readDaily();
  try {
    const r = await post("daily-pull", { token: auth.token, from, to });
    // 로컬 스냅샷은 반드시 'await 후'에 읽는다 — 네트워크 대기 중 다른 코드(오늘 재계산·1분 스냅샷)가
    // 쓴 값을, 대기 전에 떠 둔 낡은 사본으로 통째로 되덮는 lost-update를 막는다.
    const all = readDaily();
    // 재계산 직후 보호창: overwrite POST가 서버에 닿기 전에 응답한 pull이 옛 부풀린 값을
    // max 병합으로 되살리지 않도록, 10분 안에는 오늘 키의 서버 값을 무시(로컬 유지).
    const recalcAt = +(localStorage.getItem("pg_daily_recalc_at") || 0);
    const guardToday = Date.now() - recalcAt < 10 * 60 * 1000 ? localDateStr() : null;
    for (const row of r.days || []) {
      if (row.date === guardToday) continue;
      all[row.date] = mergeDay(all[row.date], {
        watched: row.watched_sec, good: row.good_sec, caution: row.caution_sec,
        bad: row.bad_sec, badCount: row.bad_count, longestGood: row.longest_good_sec,
      });
    }
    saveDaily(all);
    return all;
  } catch (e) { dropAuthIf401(e); return readDaily(); }
}

// 오늘 서버 기록 0으로 덮어쓰기(초기화 버튼용) — GREATEST 병합을 우회하는 overwrite 플래그 사용.
export async function resetDailyOnServer(dateKey) {
  const auth = getAuth();
  if (!auth) return;
  try {
    await post("daily", { token: auth.token, overwrite: true,
      days: [{ date: dateKey, watched: 0, good: 0, caution: 0, bad: 0, badCount: 0, longestGood: 0 }] });
  } catch (e) { dropAuthIf401(e); }
}

// 로그아웃 시 개인 데이터 삭제 — 서버가 원본이므로 기기(특히 공용 기기)에 통계를 남기지 않는다.
// 기기 설정(알림·테마·요정 위치 등)은 유지.
export function wipeLocalData() {
  ["pg_events", "pg_daily", "pg_points", "pg_today", "pg_shop",
   "pg_attend_days", "pg_attend_last", "pg_last_active", "pg_profile",
   "pg_blink", "pg_blink_log", "pg_group", "pg_groups", "pg_entered",
   "pg_goal", "pg_goal_award_last", "pg_subjects", "pg_subj_log", "pg_daily_subj",
  ].forEach((k) => localStorage.removeItem(k));
}
