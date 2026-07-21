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

// ── 로그인 상태 (pg_auth = {token, nickname}) ──
export function getAuth() {
  const a = jparse("pg_auth", null);
  return a && a.token ? a : null;
}
export function setAuth(token, nickname) {
  localStorage.setItem("pg_auth", JSON.stringify({ token, nickname }));
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
  };
  const changed = points !== local.points
    || owned.length !== (local.shop.owned || []).length
    || days.length !== (local.att.days || []).length;
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

export async function apiRegister(nickname, password, memberId) {
  return post("register", { nickname, password, memberId });
}
export async function apiLogin(nickname, password) {
  return post("login", { nickname, password });
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
  const all = readDaily();
  if (!auth) return all;
  try {
    const r = await post("daily-pull", { token: auth.token, from, to });
    for (const row of r.days || []) {
      all[row.date] = mergeDay(all[row.date], {
        watched: row.watched_sec, good: row.good_sec, caution: row.caution_sec,
        bad: row.bad_sec, badCount: row.bad_count, longestGood: row.longest_good_sec,
      });
    }
    saveDaily(all);
  } catch (e) { dropAuthIf401(e); }
  return all;
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
  ].forEach((k) => localStorage.removeItem(k));
}
