// 서버 동기화 계층 — 로그인 계정에 포인트·요정(상점)·출석을 백업/복원한다.
// 백엔드 계약(docs/백엔드-설계.md): POST /api/sync {token, data}, POST /api/sync-pull {token}.
// 실패는 전부 조용히 무시(오프라인 우선 — 로컬이 진실, 서버는 백업).

export const API_BASE = "https://34-64-158-222.sslip.io";

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
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export async function apiRegister(nickname, password, memberId) {
  return post("register", { nickname, password, memberId });
}
export async function apiLogin(nickname, password) {
  return post("login", { nickname, password });
}

// 업로드 — 로그인 상태일 때만. 실패는 조용히 무시(다음 주기에 재시도).
let pushing = false;
export async function pushSync() {
  const auth = getAuth();
  if (!auth || pushing) return;
  pushing = true;
  try { await post("sync", { token: auth.token, data: collectData() }); } catch {}
  finally { pushing = false; }
}

// 서버 최신본 내려받기 — 성공 시 data, 아니면 null.
export async function syncPull() {
  const auth = getAuth();
  if (!auth) return null;
  try { const r = await post("sync-pull", { token: auth.token }); return r.data ?? null; }
  catch { return null; }
}

// 주기 업로드 시작 — 60초 주기 + 탭이 숨겨질 때 1회(앱 이탈 직전 백업). 최초 1회 즉시.
let loopStarted = false;
export function startSyncLoop() {
  if (loopStarted || !getAuth()) return;
  loopStarted = true;
  pushSync();
  setInterval(pushSync, 60_000);
  document.addEventListener("visibilitychange", () => { if (document.hidden) pushSync(); });
}
