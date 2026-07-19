// 척추요정 백엔드 — Cloud Run + Firestore (설계: docs/백엔드-설계.md)
// 데이터 모델: groups/{code} · members/{memberId} · stats/{memberId}_{week}
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { Firestore, FieldValue } from "@google-cloud/firestore";

const db = new Firestore();
const app = express();
app.set("trust proxy", 1); // Cloud Run 프록시 뒤 — X-Forwarded-For에서 실제 IP
app.use(express.json());
app.use(cors({
  origin: ["https://posture-guard-rust.vercel.app", "http://localhost:8137"],
}));

// 레이트 리밋 (IP별) — 공개 서비스 남용 방어선
app.use("/api/", rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false }));
const createLimiter = rateLimit({ windowMs: 3600_000, max: 10, standardHeaders: true, legacyHeaders: false,
  message: { error: "그룹 생성이 너무 잦아요 — 잠시 후 다시 시도해주세요" } });

const MAX_GROUP_MEMBERS = 100;

// 리더보드 30초 캐시 — 조회 1회당 Firestore 읽기가 인원수만큼 나가므로 공개 규모에선 필수
const boardCache = new Map(); // key `${code}:${week}` → { at, rows }
const BOARD_TTL_MS = 30_000;

const bad = (res, code, msg) => res.status(code).json({ error: msg });
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 헷갈리는 I/O/0/1 제외
const genCode = () =>
  Array.from({ length: 6 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join("");

const MAX_GOOD_SEC = 7 * 16 * 3600; // 주 7일×16시간 — 치팅 상한
const MAX_POINTS = 100000;
const isUuid = (s) => /^[0-9a-f-]{36}$/.test(s || "");
const isWeek = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");

// 주의: /healthz 는 run.app 프론트엔드(GFE)가 가로채 404를 반환 → /api/health 사용
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// 그룹 생성
app.post("/api/group", createLimiter, async (req, res) => {
  const name = (req.body?.name || "").trim();
  if (!name || name.length > 20) return bad(res, 400, "그룹 이름은 1~20자");
  for (let i = 0; i < 5; i++) {
    const code = genCode();
    try {
      await db.doc(`groups/${code}`).create({ name, createdAt: FieldValue.serverTimestamp() });
      return res.json({ code, name });
    } catch { /* 코드 충돌 — 재시도 */ }
  }
  return bad(res, 500, "코드 생성 실패 — 다시 시도해주세요");
});

// 그룹 참여 (멤버 upsert — 닉네임 변경 겸용)
app.post("/api/join", async (req, res) => {
  const code = (req.body?.code || "").trim().toUpperCase();
  const nickname = (req.body?.nickname || "").trim();
  const memberId = (req.body?.memberId || "").trim();
  if (!/^[A-Z2-9]{6}$/.test(code)) return bad(res, 400, "코드는 6자리예요");
  if (!nickname || nickname.length > 12) return bad(res, 400, "닉네임은 1~12자");
  if (!isUuid(memberId)) return bad(res, 400, "잘못된 기기 ID");

  const group = await db.doc(`groups/${code}`).get();
  if (!group.exists) return bad(res, 404, "그 코드의 그룹이 없어요");
  const count = await db.collection("members").where("groupCode", "==", code).count().get();
  if (count.data().count >= MAX_GROUP_MEMBERS) return bad(res, 409, `그룹 정원(${MAX_GROUP_MEMBERS}명)이 찼어요`);
  await db.doc(`members/${memberId}`).set(
    { nickname, groupCode: code, createdAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
  // 새 멤버는 최대 30초(캐시 TTL) 후 리더보드에 반영된다
  return res.json({ name: group.data().name });
});

// 주간 집계 업로드 (서버 클램프)
app.post("/api/stats", async (req, res) => {
  const memberId = (req.body?.memberId || "").trim();
  const week = (req.body?.week || "").trim();
  if (!isUuid(memberId)) return bad(res, 400, "잘못된 기기 ID");
  if (!isWeek(week)) return bad(res, 400, "week 형식은 YYYY-MM-DD");
  const member = await db.doc(`members/${memberId}`).get();
  if (!member.exists) return bad(res, 404, "먼저 그룹에 참여해주세요");

  const goodSec = Math.min(Math.max(0, Math.round(+req.body?.goodSec || 0)), MAX_GOOD_SEC);
  const points = Math.min(Math.max(0, Math.round(+req.body?.points || 0)), MAX_POINTS);
  await db.doc(`stats/${memberId}_${week}`).set(
    { memberId, week, goodSec, points, updatedAt: FieldValue.serverTimestamp() },
  );
  return res.json({ ok: true });
});

// 그룹 주간 리더보드
app.get("/api/leaderboard", async (req, res) => {
  const code = (req.query.code || "").trim().toUpperCase();
  const week = (req.query.week || "").trim();
  if (!/^[A-Z2-9]{6}$/.test(code)) return bad(res, 400, "코드는 6자리예요");
  if (!isWeek(week)) return bad(res, 400, "week 형식은 YYYY-MM-DD");

  const cacheKey = `${code}:${week}`;
  const cached = boardCache.get(cacheKey);
  if (cached && Date.now() - cached.at < BOARD_TTL_MS) return res.json({ rows: cached.rows });

  const members = await db.collection("members").where("groupCode", "==", code).limit(100).get();
  if (members.empty) return res.json({ rows: [] });
  const refs = members.docs.map((d) => db.doc(`stats/${d.id}_${week}`));
  const stats = await db.getAll(...refs);
  const byId = new Map(stats.filter((s) => s.exists).map((s) => [s.data().memberId, s.data()]));
  const rows = members.docs
    .map((d) => ({
      member_id: d.id,
      nickname: d.data().nickname,
      good_sec: byId.get(d.id)?.goodSec || 0,
      points: byId.get(d.id)?.points || 0,
    }))
    .sort((a, b) => b.good_sec - a.good_sec);
  boardCache.set(cacheKey, { at: Date.now(), rows });
  if (boardCache.size > 5000) boardCache.clear(); // 메모리 상한 (단순 전량 비우기)
  return res.json({ rows });
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`posture-guard-api on :${port}`));
