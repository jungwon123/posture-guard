// 그룹 실시간 카메라 시그널링 (WebRTC). 서버는 SDP/ICE 중개만 하고, 영상은 P2P로 직접 전송.
// 저장 없음. 방 = 그룹코드. 멤버십은 DB로 검증(같은 그룹만).
import { WebSocketServer } from "ws";

const isUuid = (s) => /^[0-9a-f-]{36}$/.test(s || "");
const isCode = (s) => /^[A-Z2-9]{6}$/.test(s || "");

export function attachSignaling(server, pool) {
  const wss = new WebSocketServer({ server, path: "/ws" });
  const rooms = new Map(); // code -> Map(memberId -> {ws, nick, sharing})

  const room = (code) => rooms.get(code);
  const list = (code) => {
    const r = room(code); if (!r) return [];
    return [...r.entries()].map(([id, m]) => ({ memberId: id, nick: m.nick, sharing: !!m.sharing }));
  };
  const sendTo = (code, id, msg) => {
    const m = room(code)?.get(id);
    if (m && m.ws.readyState === 1) m.ws.send(JSON.stringify(msg));
  };
  const broadcast = (code, msg, exceptId) => {
    const r = room(code); if (!r) return;
    const s = JSON.stringify(msg);
    for (const [id, m] of r) if (id !== exceptId && m.ws.readyState === 1) m.ws.send(s);
  };

  wss.on("connection", (ws) => {
    ws.meta = null;
    ws.on("message", async (buf) => {
      let msg; try { msg = JSON.parse(buf.toString()); } catch { return; }
      const t = msg.t;

      if (t === "hello") {
        const code = (msg.code || "").trim().toUpperCase();
        const memberId = (msg.memberId || "").trim();
        if (!isCode(code) || !isUuid(memberId)) return ws.send(JSON.stringify({ t: "error", msg: "잘못된 파라미터" }));
        let nick;
        try {
          const q = await pool.query(
            "SELECT m.nickname FROM members m JOIN groups g ON g.id = m.group_id WHERE m.id = $1 AND g.code = $2",
            [memberId, code]);
          if (!q.rows.length) return ws.send(JSON.stringify({ t: "error", msg: "그룹 멤버만 가능해요" }));
          nick = q.rows[0].nickname;
        } catch { return ws.send(JSON.stringify({ t: "error", msg: "서버 오류" })); }
        if (!rooms.has(code)) rooms.set(code, new Map());
        const prev = room(code).get(memberId);
        if (prev && prev.ws !== ws && prev.ws.readyState === 1) try { prev.ws.close(); } catch {}
        room(code).set(memberId, { ws, nick, sharing: false });
        ws.meta = { code, memberId };
        ws.send(JSON.stringify({ t: "peers", list: list(code) }));
        broadcast(code, { t: "join", memberId, nick }, memberId);
        return;
      }
      if (!ws.meta) return; // hello 먼저
      const { code, memberId } = ws.meta;

      if (t === "share") {
        const m = room(code)?.get(memberId);
        if (m) { m.sharing = !!msg.on; broadcast(code, { t: "share", memberId, on: m.sharing }); }
      } else if (t === "watch") {
        sendTo(code, (msg.target || "").trim(), { t: "watch", from: memberId }); // 대상(공유자)이 offer 시작
      } else if (t === "unwatch") {
        sendTo(code, (msg.target || "").trim(), { t: "unwatch", from: memberId });
      } else if (t === "signal") {
        sendTo(code, (msg.target || "").trim(), { t: "signal", from: memberId, data: msg.data }); // SDP/ICE 중개
      }
    });

    ws.on("close", () => {
      if (!ws.meta) return;
      const { code, memberId } = ws.meta;
      const r = room(code);
      if (r && r.get(memberId)?.ws === ws) {
        r.delete(memberId);
        if (!r.size) rooms.delete(code);
        else broadcast(code, { t: "leave", memberId });
      }
    });
  });

  console.log("signaling ws attached on /ws");
  return wss;
}
