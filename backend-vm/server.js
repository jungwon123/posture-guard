// 척추요정 백엔드 — VM(Compute Engine) + PostgreSQL 버전 (설계: docs/백엔드-설계.md)
// Cloud Run/Firestore 버전(backend/)을 DB만 Postgres로 교체. API 계약은 동일.
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import pg from "pg";

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
  ALTER TABLE presence ADD COLUMN IF NOT EXISTS skin TEXT NOT NULL DEFAULT 'fairy';
  ALTER TABLE weekly_stats ADD COLUMN IF NOT EXISTS streak INT NOT NULL DEFAULT 0;
`);

const app = express();
app.set("trust proxy", 1); // Caddy 프록시 뒤 — 실제 IP
app.use(express.json());
app.use(cors({ origin: ["https://posture-guard-rust.vercel.app", "http://localhost:8137"] }));
app.use("/api/", rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false }));
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
  const cnt = await pool.query("SELECT count(*)::int AS n FROM members WHERE group_id = $1", [g.rows[0].id]);
  const existing = await pool.query("SELECT 1 FROM members WHERE id = $1 AND group_id = $2", [memberId, g.rows[0].id]);
  if (!existing.rows.length && cnt.rows[0].n >= MAX_GROUP_MEMBERS)
    return bad(res, 409, `그룹 정원(${MAX_GROUP_MEMBERS}명)이 찼어요`);
  await pool.query(
    `INSERT INTO members (id, nickname, group_id) VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET nickname = EXCLUDED.nickname, group_id = EXCLUDED.group_id`,
    [memberId, nickname, g.rows[0].id]);
  return res.json({ name: g.rows[0].name });
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
    `SELECT f.nickname AS from_nick FROM members f, members t
     WHERE f.id = $1 AND t.id = $2 AND f.group_id = t.group_id AND f.group_id IS NOT NULL`,
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
    `SELECT m.id AS member_id, m.nickname,
            COALESCE(w.good_sec, 0) AS good_sec, COALESCE(w.points, 0) AS points,
            COALESCE(w.streak, 0) AS streak,
            p.state, COALESCE(p.skin, 'fairy') AS skin,
            EXTRACT(EPOCH FROM (now() - p.updated_at))::int AS ago_sec
     FROM members m
     LEFT JOIN weekly_stats w ON w.member_id = m.id AND w.week = $2
     LEFT JOIN presence p ON p.member_id = m.id
     WHERE m.group_id = $1 ORDER BY good_sec DESC, points DESC, m.created_at ASC LIMIT 100`,
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

const port = process.env.PORT || 8080;
app.listen(port, "127.0.0.1", () => console.log(`posture-guard-api (pg) on :${port}`));
