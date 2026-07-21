// 척추요정 백엔드 — VM(Compute Engine) + PostgreSQL 버전 (설계: docs/백엔드-설계.md)
// Cloud Run/Firestore 버전(backend/)을 DB만 Postgres로 교체. API 계약은 동일.
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import pg from "pg";
import http from "http";
import https from "https"; // 구글 tokeninfo 폴백 (글로벌 fetch 없는 구버전 노드)
import crypto from "crypto";
import { attachSignaling } from "./signaling.js";
import { AccessToken } from "livekit-server-sdk";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });

// 스키마 보장 (첫 기동 시 1회)
await pool.query(`
  CREATE TABLE IF NOT EXISTS groups (
    id SERIAL PRIMARY KEY, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now());
  CREATE TABLE IF NOT EXISTS members (
    id TEXT PRIMARY KEY, nickname TEXT NOT NULL,
    group_id INT REFERENCES groups(id), created_at TIMESTAMPTZ DEFAULT now());
  CREATE TABLE IF NOT EXISTS weekly_stats (
    member_id TEXT REFERENCES members(id), week TEXT NOT NULL,
    good_sec INT NOT NULL DEFAULT 0, points INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT now(), PRIMARY KEY (member_id, week));
  CREATE TABLE IF NOT EXISTS presence (
    member_id TEXT PRIMARY KEY REFERENCES members(id),
    state TEXT NOT NULL, updated_at TIMESTAMPTZ DEFAULT now());
  CREATE TABLE IF NOT EXISTS nudges (
    id SERIAL PRIMARY KEY, to_member TEXT NOT NULL,
    from_nick TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT now());
  CREATE TABLE IF NOT EXISTS champions (
    group_id INT NOT NULL, week TEXT NOT NULL,
    member_id TEXT, nickname TEXT NOT NULL, good_sec INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT now(), PRIMARY KEY (group_id, week));
  -- 한 기기(member)가 여러 그룹에 동시 참여 (N:N). 그룹별 닉네임 허용.
  CREATE TABLE IF NOT EXISTS memberships (
    member_id TEXT REFERENCES members(id), group_id INT REFERENCES groups(id),
    nickname TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (member_id, group_id));
  ALTER TABLE presence ADD COLUMN IF NOT EXISTS skin TEXT NOT NULL DEFAULT 'fairy';
  ALTER TABLE weekly_stats ADD COLUMN IF NOT EXISTS streak INT NOT NULL DEFAULT 0;
  -- 레거시 members.group_id(1:1) → memberships 백필 (멱등)
  INSERT INTO memberships (member_id, group_id, nickname)
    SELECT id, group_id, nickname FROM members WHERE group_id IS NOT NULL
    ON CONFLICT (member_id, group_id) DO NOTHING;
  -- 계정 + 데이터 동기화 (id는 서버에서 crypto.randomUUID로 생성 — gen_random_uuid 의존 없음)
  CREATE TABLE IF NOT EXISTS accounts (
    id UUID PRIMARY KEY,
    nickname TEXT UNIQUE NOT NULL,
    pass_hash TEXT NOT NULL,
    member_id UUID UNIQUE NOT NULL,
    token UUID,
    data JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
  CREATE INDEX IF NOT EXISTS accounts_token_idx ON accounts (token); -- 동기화 인증 조회 경로
  -- 구글 소셜 로그인 — 구글 전용 계정은 비밀번호가 없다(pass_hash NULL 허용)
  ALTER TABLE accounts ADD COLUMN IF NOT EXISTS google_sub TEXT UNIQUE;
  ALTER TABLE accounts ALTER COLUMN pass_hash DROP NOT NULL;
  -- 일별 공부/자세 집계 (월별 캘린더) — 기기별 스냅샷을 필드별 GREATEST로 병합
  CREATE TABLE IF NOT EXISTS daily_stats (
    account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    watched_sec INT NOT NULL DEFAULT 0,
    good_sec INT NOT NULL DEFAULT 0,
    caution_sec INT NOT NULL DEFAULT 0,
    bad_sec INT NOT NULL DEFAULT 0,
    bad_count INT NOT NULL DEFAULT 0,
    longest_good_sec INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (account_id, date));
`);

const app = express();
app.set("trust proxy", 1); // Caddy 프록시 뒤 — 실제 IP
app.use(express.json());
// CORS — 프로덕션 alias 하나만 허용하면 Vercel 배포/프리뷰 URL(매 배포마다 새 도메인)·로컬 dev에서
// 모든 API가 막혀 그룹 그리드 등이 조용히 죽는다. 이 프로젝트의 Vercel 오리진 전체 + 로컬 dev 허용.
const CORS_ALLOW = [
  /^https:\/\/posture-guard-rust\.vercel\.app$/,                              // 프로덕션 alias
  /^https:\/\/posture-guard-[a-z0-9]+-jungwons-projects-[a-z0-9]+\.vercel\.app$/, // 배포/프리뷰 URL(팀 스코프)
  /^http:\/\/localhost:\d+$/,                                                // 로컬 개발
];
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // 서버-서버·curl(Origin 없음) 허용
    cb(null, CORS_ALLOW.some((re) => re.test(origin)));
  },
}));
// rate limit — 학교 와이파이는 반 전체가 공인 IP 하나를 공유하므로 IP 키만 쓰면 시연 때 합산돼 막힌다.
// 요청에 memberId/token이 있으면 그 단위로, 없으면 IP로 제한.
app.use("/api/", rateLimit({
  windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false,
  validate: { keyGeneratorIpFallback: false },
  keyGenerator: (req) =>
    req.body?.memberId || req.body?.token || req.query?.memberId || req.ip,
}));
const createLimiter = rateLimit({ windowMs: 3600_000, max: 10, standardHeaders: true, legacyHeaders: false,
  message: { error: "그룹 생성이 너무 잦아요 — 잠시 후 다시 시도해주세요" } });

const bad = (res, code, msg) => res.status(code).json({ error: msg });
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const genCode = () => Array.from({ length: 6 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join("");
const MAX_GOOD_SEC = 7 * 16 * 3600, MAX_POINTS = 100000, MAX_GROUP_MEMBERS = 100;
const isUuid = (s) => /^[0-9a-f-]{36}$/.test(s || "");
const isWeek = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
const SKIN_RE = /^[a-z]{2,16}$/; // 스킨 키 화이트리스트(경로/XSS 안전). 미검증이면 기본 요정.
const cleanSkin = (s) => (SKIN_RE.test(s || "") ? s : "fairy");
const MAX_STREAK = 366;

const boardCache = new Map(); // `${code}:${week}` → {at, rows}
const BOARD_TTL_MS = 30_000;

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.post("/api/group", createLimiter, async (req, res) => {
  const name = (req.body?.name || "").trim();
  if (!name || name.length > 20) return bad(res, 400, "그룹 이름은 1~20자");
  for (let i = 0; i < 5; i++) {
    const code = genCode();
    try {
      const { rows } = await pool.query(
        "INSERT INTO groups (code, name) VALUES ($1, $2) RETURNING code, name", [code, name]);
      return res.json(rows[0]);
    } catch (e) { if (e.code !== "23505") throw e; } // 23505=unique 위반 → 코드 재시도
  }
  return bad(res, 500, "코드 생성 실패 — 다시 시도해주세요");
});

app.post("/api/join", async (req, res) => {
  const code = (req.body?.code || "").trim().toUpperCase();
  const nickname = (req.body?.nickname || "").trim();
  const memberId = (req.body?.memberId || "").trim();
  if (!/^[A-Z2-9]{6}$/.test(code)) return bad(res, 400, "코드는 6자리예요");
  if (!nickname || nickname.length > 12) return bad(res, 400, "닉네임은 1~12자");
  if (!isUuid(memberId)) return bad(res, 400, "잘못된 기기 ID");

  const g = await pool.query("SELECT id, name FROM groups WHERE code = $1", [code]);
  if (!g.rows.length) return bad(res, 404, "그 코드의 그룹이 없어요");
  const gid = g.rows[0].id;
  const cnt = await pool.query("SELECT count(*)::int AS n FROM memberships WHERE group_id = $1", [gid]);
  const existing = await pool.query("SELECT 1 FROM memberships WHERE member_id = $1 AND group_id = $2", [memberId, gid]);
  if (!existing.rows.length && cnt.rows[0].n >= MAX_GROUP_MEMBERS)
    return bad(res, 409, `그룹 정원(${MAX_GROUP_MEMBERS}명)이 찼어요`);
  // 멤버 행 보장(FK 타깃) — 최신 닉네임 반영. 기존 다른 그룹 참여는 유지(덮어쓰지 않음).
  await pool.query(
    `INSERT INTO members (id, nickname) VALUES ($1, $2)
     ON CONFLICT (id) DO UPDATE SET nickname = EXCLUDED.nickname`,
    [memberId, nickname]);
  await pool.query(
    `INSERT INTO memberships (member_id, group_id, nickname) VALUES ($1, $2, $3)
     ON CONFLICT (member_id, group_id) DO UPDATE SET nickname = EXCLUDED.nickname`,
    [memberId, gid, nickname]);
  return res.json({ name: g.rows[0].name });
});

// 내가 속한 그룹 목록 (다중 그룹) — 참여 순.
app.get("/api/my-groups", async (req, res) => {
  const memberId = (req.query.memberId || "").trim();
  if (!isUuid(memberId)) return bad(res, 400, "잘못된 기기 ID");
  const { rows } = await pool.query(
    `SELECT g.code, g.name, ms.nickname,
            (SELECT count(*)::int FROM memberships m2 WHERE m2.group_id = g.id) AS members
     FROM memberships ms JOIN groups g ON g.id = ms.group_id
     WHERE ms.member_id = $1 ORDER BY ms.created_at ASC`, [memberId]);
  return res.json({ groups: rows });
});

// 그룹 나가기 — 해당 그룹 멤버십만 제거(다른 그룹은 유지).
app.post("/api/leave", async (req, res) => {
  const memberId = (req.body?.memberId || "").trim();
  const code = (req.body?.code || "").trim().toUpperCase();
  if (!isUuid(memberId)) return bad(res, 400, "잘못된 기기 ID");
  if (!/^[A-Z2-9]{6}$/.test(code)) return bad(res, 400, "코드는 6자리예요");
  const g = await pool.query("SELECT id FROM groups WHERE code = $1", [code]);
  if (!g.rows.length) return bad(res, 404, "그 코드의 그룹이 없어요");
  await pool.query("DELETE FROM memberships WHERE member_id = $1 AND group_id = $2", [memberId, g.rows[0].id]);
  return res.json({ ok: true });
});

app.post("/api/stats", async (req, res) => {
  const memberId = (req.body?.memberId || "").trim();
  const week = (req.body?.week || "").trim();
  if (!isUuid(memberId)) return bad(res, 400, "잘못된 기기 ID");
  if (!isWeek(week)) return bad(res, 400, "week 형식은 YYYY-MM-DD");
  const goodSec = Math.min(Math.max(0, Math.round(+req.body?.goodSec || 0)), MAX_GOOD_SEC);
  const points = Math.min(Math.max(0, Math.round(+req.body?.points || 0)), MAX_POINTS);
  const streak = Math.min(Math.max(0, Math.round(+req.body?.streak || 0)), MAX_STREAK);
  const r = await pool.query(
    `INSERT INTO weekly_stats (member_id, week, good_sec, points, streak, updated_at)
     SELECT $1, $2, $3, $4, $5, now() WHERE EXISTS (SELECT 1 FROM members WHERE id = $1)
     ON CONFLICT (member_id, week)
     DO UPDATE SET good_sec = EXCLUDED.good_sec, points = EXCLUDED.points,
                   streak = EXCLUDED.streak, updated_at = now()
     RETURNING member_id`,
    [memberId, week, goodSec, points, streak]);
  if (!r.rows.length) return bad(res, 404, "먼저 그룹에 참여해주세요");
  return res.json({ ok: true });
});

// 내 현재 자세 상태 업로드 (엔진이 30초마다) — 그룹 친구들이 상태 점으로 본다
const STATES = new Set(["GOOD", "BAD", "AWAY", "UNCALIBRATED"]);
app.post("/api/presence", async (req, res) => {
  const memberId = (req.body?.memberId || "").trim();
  const state = (req.body?.state || "").trim();
  const skin = cleanSkin((req.body?.skin || "").trim());
  if (!isUuid(memberId)) return bad(res, 400, "잘못된 기기 ID");
  if (!STATES.has(state)) return bad(res, 400, "잘못된 상태");
  const r = await pool.query(
    `INSERT INTO presence (member_id, state, skin, updated_at)
     SELECT $1, $2, $3, now() WHERE EXISTS (SELECT 1 FROM members WHERE id = $1)
     ON CONFLICT (member_id) DO UPDATE SET state = EXCLUDED.state, skin = EXCLUDED.skin, updated_at = now()
     RETURNING member_id`, [memberId, state, skin]);
  if (!r.rows.length) return bad(res, 404, "먼저 그룹에 참여해주세요");
  return res.json({ ok: true });
});

// 콕 찌르기 — 같은 그룹의 친구에게 자세 경고. 같은 사람에게 분당 1회.
app.post("/api/nudge", async (req, res) => {
  const fromId = (req.body?.fromId || "").trim();
  const toId = (req.body?.toId || "").trim();
  if (!isUuid(fromId) || !isUuid(toId)) return bad(res, 400, "잘못된 기기 ID");
  if (fromId === toId) return bad(res, 400, "자기 자신은 못 찔러요");
  const pair = await pool.query(
    `SELECT f.nickname AS from_nick FROM memberships f
     JOIN memberships t ON f.group_id = t.group_id
     WHERE f.member_id = $1 AND t.member_id = $2 LIMIT 1`,
    [fromId, toId]);
  if (!pair.rows.length) return bad(res, 404, "같은 그룹의 친구에게만 보낼 수 있어요");
  const recent = await pool.query(
    `SELECT 1 FROM nudges WHERE to_member = $1 AND from_nick = $2
     AND created_at > now() - interval '60 seconds'`,
    [toId, pair.rows[0].from_nick]);
  if (recent.rows.length) return bad(res, 429, "같은 친구에게는 1분에 한 번만 보낼 수 있어요");
  await pool.query(`INSERT INTO nudges (to_member, from_nick) VALUES ($1, $2)`,
    [toId, pair.rows[0].from_nick]);
  return res.json({ ok: true });
});

// 나에게 온 콕 수령 (반환 후 삭제) — 엔진이 30초마다 폴링
app.get("/api/nudges", async (req, res) => {
  const memberId = (req.query.memberId || "").trim();
  if (!isUuid(memberId)) return bad(res, 400, "잘못된 기기 ID");
  const { rows } = await pool.query(
    `DELETE FROM nudges WHERE to_member = $1 RETURNING from_nick`, [memberId]);
  return res.json({ nudges: rows });
});

// 그룹 주간 리더보드 — 포인트 많은 순. 멤버의 실시간 상태(presence)도 함께 반환.
app.get("/api/leaderboard", async (req, res) => {
  const code = (req.query.code || "").trim().toUpperCase();
  const week = (req.query.week || "").trim();
  if (!/^[A-Z2-9]{6}$/.test(code)) return bad(res, 400, "코드는 6자리예요");
  if (!isWeek(week)) return bad(res, 400, "week 형식은 YYYY-MM-DD");
  const key = `${code}:${week}`;
  const c = boardCache.get(key);
  if (c && Date.now() - c.at < BOARD_TTL_MS) return res.json({ rows: c.rows, champions: c.champions });

  const g = await pool.query("SELECT id FROM groups WHERE code = $1", [code]);
  if (!g.rows.length) return res.json({ rows: [], champions: [] });
  const gid = g.rows[0].id;

  const { rows } = await pool.query(
    `SELECT m.id AS member_id, ms.nickname,
            COALESCE(w.good_sec, 0) AS good_sec, COALESCE(w.points, 0) AS points,
            COALESCE(w.streak, 0) AS streak,
            p.state, COALESCE(p.skin, 'fairy') AS skin,
            EXTRACT(EPOCH FROM (now() - p.updated_at))::int AS ago_sec
     FROM memberships ms
     JOIN members m ON m.id = ms.member_id
     LEFT JOIN weekly_stats w ON w.member_id = m.id AND w.week = $2
     LEFT JOIN presence p ON p.member_id = m.id
     WHERE ms.group_id = $1 ORDER BY good_sec DESC, points DESC, ms.created_at ASC LIMIT 100`,
    [gid, week]);

  // 이번 주 1위를 명예의 전당에 기록(멱등 upsert). 캐시 미스 때만 → 쓰기 자연 throttle.
  if (rows.length && rows[0].good_sec > 0) {
    await pool.query(
      `INSERT INTO champions (group_id, week, member_id, nickname, good_sec, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (group_id, week) DO UPDATE SET
         member_id = EXCLUDED.member_id, nickname = EXCLUDED.nickname,
         good_sec = EXCLUDED.good_sec, updated_at = now()`,
      [gid, week, rows[0].member_id, rows[0].nickname, rows[0].good_sec]);
  }
  // 역대 챔피언(지난 주 이전) 최근 5주
  const champs = await pool.query(
    `SELECT week, nickname, good_sec FROM champions
     WHERE group_id = $1 AND week < $2 ORDER BY week DESC LIMIT 5`, [gid, week]);
  const champions = champs.rows;

  boardCache.set(key, { at: Date.now(), rows, champions });
  if (boardCache.size > 5000) boardCache.clear();
  return res.json({ rows, champions });
});

// LiveKit(반전체 그리드) 참가 토큰 — 같은 그룹 멤버만. 키 미설정 시 503으로 대기.
app.post("/api/rtc-token", async (req, res) => {
  const memberId = (req.body?.memberId || "").trim();
  const code = (req.body?.code || "").trim().toUpperCase();
  if (!isUuid(memberId)) return bad(res, 400, "잘못된 기기 ID");
  if (!/^[A-Z2-9]{6}$/.test(code)) return bad(res, 400, "코드는 6자리예요");
  const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = process.env;
  if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET)
    return res.status(503).json({ error: "LiveKit 미설정 (관리자 키 필요)", configured: false });
  const q = await pool.query(
    `SELECT ms.nickname FROM memberships ms JOIN groups g ON g.id = ms.group_id
     WHERE ms.member_id = $1 AND g.code = $2`,
    [memberId, code]);
  if (!q.rows.length) return bad(res, 404, "그룹 멤버만 가능해요");
  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET,
    { identity: memberId, name: q.rows[0].nickname, ttl: "2h" });
  at.addGrant({ roomJoin: true, room: `pg-${code}`, canPublish: true, canSubscribe: true, canPublishData: true });
  const token = await at.toJwt(); // v2: async
  return res.json({ token, url: LIVEKIT_URL, room: `pg-${code}`, configured: true });
});

// ── 계정 + 데이터 동기화 ──────────────────────────────────────────────
// 비밀번호 해시: node 내장 scrypt (salt 16바이트 랜덤, "salt:hash" hex 저장). 외부 의존성 없음.
const scryptAsync = (password, salt) =>
  new Promise((resolve, reject) =>
    crypto.scrypt(password, salt, 64, (err, buf) => (err ? reject(err) : resolve(buf))));
const hashPassword = async (password) => {
  const salt = crypto.randomBytes(16).toString("hex");
  const buf = await scryptAsync(password, salt);
  return `${salt}:${buf.toString("hex")}`;
};
const verifyPassword = async (password, stored) => {
  const [salt, hash] = (stored || "").split(":");
  if (!salt || !hash) return false;
  const buf = await scryptAsync(password, salt);
  const expected = Buffer.from(hash, "hex");
  return buf.length === expected.length && crypto.timingSafeEqual(buf, expected);
};
const MAX_SYNC_BYTES = 64 * 1024;

// 계정 등록 — 닉네임 전역 유니크, 기기(memberId)당 1계정.
app.post("/api/register", async (req, res) => {
  const nickname = (req.body?.nickname || "").trim();
  const password = req.body?.password || "";
  const memberId = (req.body?.memberId || "").trim();
  if (nickname.length < 2 || nickname.length > 12) return bad(res, 400, "닉네임은 2~12자");
  if (password.length < 4 || password.length > 64) return bad(res, 400, "비밀번호는 4~64자");
  if (!isUuid(memberId)) return bad(res, 400, "잘못된 기기 ID");
  const passHash = await hashPassword(password);
  const token = crypto.randomUUID();
  try {
    await pool.query(
      `INSERT INTO accounts (id, nickname, pass_hash, member_id, token)
       VALUES ($1, $2, $3, $4, $5)`,
      [crypto.randomUUID(), nickname, passHash, memberId, token]);
  } catch (e) {
    if (e.code === "23505") { // unique 위반 — 어느 제약인지로 메시지 분기
      if ((e.constraint || "").includes("member_id")) return bad(res, 409, "이 기기는 이미 계정이 있어요");
      return bad(res, 409, "이미 있는 닉네임이에요");
    }
    throw e;
  }
  return res.json({ ok: true, token, nickname, memberId });
});

// 로그인 — 저장된 동기화 데이터 반환. 토큰은 기존 것 재사용(다른 기기의 동기화가 안 끊기게).
app.post("/api/login", async (req, res) => {
  const nickname = (req.body?.nickname || "").trim();
  const password = req.body?.password || "";
  const r = await pool.query(
    "SELECT id, pass_hash, member_id, token, data FROM accounts WHERE nickname = $1", [nickname]);
  // 구글 전용 계정(pass_hash NULL)은 비밀번호 로그인 불가 — verifyPassword 진입 전에 가드
  if (!r.rows.length || !r.rows[0].pass_hash || !(await verifyPassword(password, r.rows[0].pass_hash)))
    return bad(res, 401, "닉네임 또는 비밀번호가 달라요");
  const token = r.rows[0].token || crypto.randomUUID();
  await pool.query("UPDATE accounts SET token = $1 WHERE id = $2", [token, r.rows[0].id]);
  return res.json({ ok: true, token, nickname, memberId: r.rows[0].member_id, data: r.rows[0].data });
});

// ── 구글 소셜 로그인 ──────────────────────────────────────────────────
// GET JSON 헬퍼 — Node 18+ 글로벌 fetch 우선, 없으면 https 모듈 폴백. 실패는 전부 null.
const fetchJson = (url) =>
  typeof fetch === "function"
    ? fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null)
    : new Promise((resolve) => {
        https.get(url, (r) => {
          let body = "";
          r.on("data", (c) => (body += c));
          r.on("end", () => {
            if (r.statusCode !== 200) return resolve(null);
            try { resolve(JSON.parse(body)); } catch { resolve(null); }
          });
        }).on("error", () => resolve(null));
      });

// 구글 ID 토큰(credential)으로 로그인/가입 — 응답 형태는 /api/login과 동일(프론트 공용 처리).
app.post("/api/google-login", async (req, res) => {
  const { GOOGLE_CLIENT_ID } = process.env;
  if (!GOOGLE_CLIENT_ID)
    return res.status(503).json({ error: "구글 로그인 미설정", configured: false });
  const credential = (req.body?.credential || "").trim();
  if (!credential) return bad(res, 401, "구글 인증에 실패했어요");
  // 서버-서버 토큰 검증 — 구글 tokeninfo가 서명/만료를 확인해준다. aud가 우리 클라이언트여야 유효.
  const info = await fetchJson(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
  if (!info || info.aud !== GOOGLE_CLIENT_ID || !info.sub)
    return bad(res, 401, "구글 인증에 실패했어요");

  // 기존 구글 계정 → 로그인. 토큰은 기존 것 재사용(다른 기기의 동기화가 안 끊기게) — /api/login과 동일.
  const r = await pool.query(
    "SELECT id, nickname, member_id, token, data FROM accounts WHERE google_sub = $1", [info.sub]);
  if (r.rows.length) {
    const token = r.rows[0].token || crypto.randomUUID();
    await pool.query("UPDATE accounts SET token = $1 WHERE id = $2", [token, r.rows[0].id]);
    return res.json({ ok: true, token, nickname: r.rows[0].nickname,
      memberId: r.rows[0].member_id, data: r.rows[0].data });
  }

  // 신규 계정 — memberId는 기기 UUID 재사용(이미 다른 계정에 묶여 있으면 새로 발급).
  let memberId = isUuid((req.body?.memberId || "").trim()) ? (req.body.memberId || "").trim() : crypto.randomUUID();
  const taken = await pool.query("SELECT 1 FROM accounts WHERE member_id = $1", [memberId]);
  if (taken.rows.length) memberId = crypto.randomUUID();
  // 닉네임은 구글 이름 기반 1~12자. UNIQUE 충돌 시 뒤에 숫자 붙여 최대 5회 재시도.
  const base = ((info.name || "").trim() || (info.email || "").split("@")[0] || "요정").slice(0, 12) || "요정";
  const token = crypto.randomUUID();
  for (let i = 0; i < 5; i++) {
    const suffix = i === 0 ? "" : String(i + 1);
    const nickname = base.slice(0, 12 - suffix.length) + suffix;
    try {
      const ins = await pool.query(
        `INSERT INTO accounts (id, nickname, pass_hash, member_id, token, google_sub)
         VALUES ($1, $2, NULL, $3, $4, $5) RETURNING data`,
        [crypto.randomUUID(), nickname, memberId, token, info.sub]);
      return res.json({ ok: true, token, nickname, memberId, data: ins.rows[0].data });
    } catch (e) {
      if (e.code !== "23505") throw e; // unique 위반만 재시도 대상
      const c = e.constraint || "";
      if (c.includes("google_sub")) { // 동시 가입 경합 — 방금 생긴 계정으로 로그인
        const dup = await pool.query(
          "SELECT nickname, member_id, token, data FROM accounts WHERE google_sub = $1", [info.sub]);
        if (dup.rows.length)
          return res.json({ ok: true, token: dup.rows[0].token, nickname: dup.rows[0].nickname,
            memberId: dup.rows[0].member_id, data: dup.rows[0].data });
        continue;
      }
      if (c.includes("member_id")) { memberId = crypto.randomUUID(); continue; } // 기기 충돌 → 새 UUID
      // 닉네임 충돌 → 다음 suffix로 재시도
    }
  }
  return bad(res, 409, "닉네임 만들기에 실패했어요 — 다시 시도해주세요");
});

// 데이터 업로드 — 토큰 인증, 64KB 제한.
app.post("/api/sync", async (req, res) => {
  const token = (req.body?.token || "").trim();
  const data = req.body?.data;
  if (!isUuid(token)) return bad(res, 401, "다시 로그인해주세요");
  if (!data || typeof data !== "object" || Array.isArray(data)) return bad(res, 400, "잘못된 데이터");
  if (JSON.stringify(data).length > MAX_SYNC_BYTES) return bad(res, 413, "데이터가 너무 커요 (64KB 제한)");
  const r = await pool.query(
    "UPDATE accounts SET data = $1, updated_at = now() WHERE token = $2 RETURNING id",
    [JSON.stringify(data), token]);
  if (!r.rows.length) return bad(res, 401, "다시 로그인해주세요");
  return res.json({ ok: true });
});

// 데이터 다운로드 — 다른 기기에서 이어하기.
app.post("/api/sync-pull", async (req, res) => {
  const token = (req.body?.token || "").trim();
  if (!isUuid(token)) return bad(res, 401, "다시 로그인해주세요");
  const r = await pool.query(
    "SELECT data, nickname, member_id FROM accounts WHERE token = $1", [token]);
  if (!r.rows.length) return bad(res, 401, "다시 로그인해주세요");
  return res.json({ ok: true, data: r.rows[0].data, nickname: r.rows[0].nickname, memberId: r.rows[0].member_id });
});

// ── 일별 공부/자세 집계 (월별 캘린더) ──
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
const DAY_SEC_MAX = 24 * 3600;
const clampSec = (v) => Math.min(Math.max(0, Math.round(+v || 0)), DAY_SEC_MAX);

// 업로드 — 최근 며칠 스냅샷을 upsert. 필드별 GREATEST 병합(늦게 온 옛 스냅샷이 최신 기록을 깎지 않게).
app.post("/api/daily", async (req, res) => {
  const token = (req.body?.token || "").trim();
  if (!isUuid(token)) return bad(res, 401, "다시 로그인해주세요");
  const a = await pool.query("SELECT id FROM accounts WHERE token = $1", [token]);
  if (!a.rows.length) return bad(res, 401, "다시 로그인해주세요");
  const days = (Array.isArray(req.body?.days) ? req.body.days.slice(0, 40) : [])
    .filter((d) => isDate(d?.date));
  const overwrite = req.body?.overwrite === true; // 초기화용 — GREATEST 병합 대신 그대로 덮어쓰기
  if (days.length) {
    // 루프 INSERT(요청당 최대 40쿼리) 대신 multi-row upsert 한 방
    const params = [a.rows[0].id];
    const rows = days.map((d) => {
      const base = params.length;
      params.push(d.date, clampSec(d.watched), clampSec(d.good), clampSec(d.caution),
        clampSec(d.bad), Math.min(Math.max(0, Math.round(+d.badCount || 0)), 5000), clampSec(d.longestGood));
      return `($1, $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`;
    });
    await pool.query(
      `INSERT INTO daily_stats (account_id, date, watched_sec, good_sec, caution_sec, bad_sec, bad_count, longest_good_sec)
       VALUES ${rows.join(", ")}
       ON CONFLICT (account_id, date) DO UPDATE SET
         watched_sec = ${overwrite ? "EXCLUDED.watched_sec" : "GREATEST(daily_stats.watched_sec, EXCLUDED.watched_sec)"},
         good_sec = ${overwrite ? "EXCLUDED.good_sec" : "GREATEST(daily_stats.good_sec, EXCLUDED.good_sec)"},
         caution_sec = ${overwrite ? "EXCLUDED.caution_sec" : "GREATEST(daily_stats.caution_sec, EXCLUDED.caution_sec)"},
         bad_sec = ${overwrite ? "EXCLUDED.bad_sec" : "GREATEST(daily_stats.bad_sec, EXCLUDED.bad_sec)"},
         bad_count = ${overwrite ? "EXCLUDED.bad_count" : "GREATEST(daily_stats.bad_count, EXCLUDED.bad_count)"},
         longest_good_sec = ${overwrite ? "EXCLUDED.longest_good_sec" : "GREATEST(daily_stats.longest_good_sec, EXCLUDED.longest_good_sec)"},
         updated_at = now()`, params);
  }
  return res.json({ ok: true, saved: days.length });
});

// 월(범위) 조회 — 캘린더용. 최대 366일 범위.
app.post("/api/daily-pull", async (req, res) => {
  const token = (req.body?.token || "").trim();
  const from = (req.body?.from || "").trim(), to = (req.body?.to || "").trim();
  if (!isUuid(token)) return bad(res, 401, "다시 로그인해주세요");
  if (!isDate(from) || !isDate(to)) return bad(res, 400, "날짜 형식은 YYYY-MM-DD");
  if ((new Date(to) - new Date(from)) / 86400000 > 366) return bad(res, 400, "범위가 너무 넓어요");
  const a = await pool.query("SELECT id FROM accounts WHERE token = $1", [token]);
  if (!a.rows.length) return bad(res, 401, "다시 로그인해주세요");
  const { rows } = await pool.query(
    `SELECT to_char(date, 'YYYY-MM-DD') AS date, watched_sec, good_sec, caution_sec, bad_sec, bad_count, longest_good_sec
     FROM daily_stats WHERE account_id = $1 AND date BETWEEN $2 AND $3 ORDER BY date`,
    [a.rows[0].id, from, to]);
  return res.json({ ok: true, days: rows });
});

const server = http.createServer(app);
attachSignaling(server, pool); // (기존 mesh) WebRTC 시그널링 /ws
const port = process.env.PORT || 8080;
server.listen(port, "127.0.0.1", () => console.log(`posture-guard-api (pg) on :${port}`));
