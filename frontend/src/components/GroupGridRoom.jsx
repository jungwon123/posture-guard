// LiveKit 실시간 그리드 (반전체) — 지연 로드되는 무거운 부분. 토큰 받아 방 접속 후 참가자 카메라 그리드.
// 안전: 카메라 공유 opt-in(기본 OFF), 감지용 #cam 트랙 재사용(모바일 이중카메라 방지), 같은 그룹만(토큰 게이트).
// 데이터 채널: (1) 각자 자세 상태/점수를 주기 브로드캐스트(topic "posture") → 타일에 배지,
//              (2) 친구에게 "자세 콕!" 타겟 알림(topic "nudge", destinationIdentities).
import { useEffect, useState, useCallback } from "react";
import { LiveKitRoom, GridLayout, ParticipantTile, useTracks, useRoomContext, useMaybeTrackRefContext } from "@livekit/components-react";
import { Track, RoomEvent } from "livekit-client";
import "@livekit/components-styles";

const API_BASE = "https://34-64-158-222.sslip.io";
const myId = () => localStorage.getItem("pg_member_id");
const enc = new TextEncoder(), dec = new TextDecoder();
const NUDGE_COOLDOWN = 12000; // 같은 친구 콕 재전송 제한(ms)

// 각 타일 = 참가자 영상 + 자세 배지 + (친구면) 자세 콕 버튼
function PostureTile({ postures, onNudge, cooldown }) {
  const ref = useMaybeTrackRefContext();
  const pt = ref?.participant;
  const id = pt?.identity;
  const info = id ? postures[id] : null;
  const fresh = info && Date.now() - info.ts < 6000; // 6초 지나면 오래된 정보로 간주
  const state = fresh ? info.state : null;
  const nick = pt?.name || "친구";
  const badge = state === "BAD" ? "🔴 자세 흐트러짐"
    : state === "GOOD" ? `🟢 ${Math.round(info.score ?? 0)}점`
    : state === "AWAY" ? "⚪ 자리비움"
    : state === "off" ? "카메라 꺼짐" : "…";
  const bcol = state === "BAD" ? "#e64545" : state === "GOOD" ? "#2f8f3f" : "#59636e";
  const onCd = id && cooldown[id] && Date.now() < cooldown[id];
  return (
    <div className="grid-tile">
      <ParticipantTile />
      <div className="grid-badge">
        <span className="grid-nick">{nick}</span>
        <span className="grid-state" style={{ background: bcol }}>{badge}</span>
      </div>
      {pt && !pt.isLocal && (
        <button className="grid-nudge" disabled={onCd} onClick={() => onNudge(id, nick)}>
          {onCd ? "콕 보냈어요 ✓" : "👉 자세 콕!"}
        </button>
      )}
    </div>
  );
}

function Grid({ postures, onNudge, cooldown }) {
  const tracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }]);
  return (
    <GridLayout tracks={tracks} style={{ height: "min(58vh, 440px)" }}>
      <PostureTile postures={postures} onNudge={onNudge} cooldown={cooldown} />
    </GridLayout>
  );
}

function ShareToggle() {
  const room = useRoomContext();
  const [on, setOn] = useState(false);
  const [msg, setMsg] = useState("");
  const toggle = async (v) => {
    const lp = room.localParticipant;
    try {
      if (v) {
        const track = document.getElementById("cam")?.srcObject?.getVideoTracks?.()[0];
        if (!track) { setMsg("카메라를 먼저 켜야 공유할 수 있어요."); setOn(false); return; }
        await lp.publishTrack(track, { source: Track.Source.Camera, name: "posture" });
        setOn(true); setMsg("");
      } else {
        lp.videoTrackPublications.forEach((pub) => { if (pub.track) lp.unpublishTrack(pub.track); });
        setOn(false);
      }
    } catch { setMsg("공유 전환에 실패했어요."); }
  };
  return (
    <>
      <div className="rtc-share">
        <label className="rtc-toggle">
          <input type="checkbox" checked={on} onChange={(e) => toggle(e.target.checked)} />
          <span>내 카메라 공유하기</span>
        </label>
        {on && <span className="rtc-live">🔴 공유 중</span>}
      </div>
      {msg && <p className="hint rtc-err">{msg}</p>}
    </>
  );
}

function RoomInner({ onClose }) {
  const room = useRoomContext();
  const [postures, setPostures] = useState({});   // { identity: {state, score, ts} }
  const [cooldown, setCooldown] = useState({});   // { identity: 재전송가능시각 }
  const [nudge, setNudge] = useState(null);       // 받은 콕 알림 배너

  // 내 자세 상태/점수 주기 브로드캐스트 (점수는 숫자만 — 영상/좌표 아님) + 내 타일에도 반영
  useEffect(() => {
    const tick = () => {
      const live = window.__pgLive;
      const body = live?.running ? { state: live.state, score: live.score } : { state: "off" };
      try { room.localParticipant.publishData(enc.encode(JSON.stringify(body)), { reliable: false, topic: "posture" }); } catch {}
      const me = myId();
      if (me) setPostures((m) => ({ ...m, [me]: { ...body, ts: Date.now() } }));
    };
    tick();
    const iv = setInterval(tick, 1500);
    return () => clearInterval(iv);
  }, [room]);

  // 수신: 자세 브로드캐스트 / 콕 알림
  useEffect(() => {
    const onData = (payload, participant, _kind, topic) => {
      let obj; try { obj = JSON.parse(dec.decode(payload)); } catch { return; }
      if (topic === "posture" && participant?.identity) {
        setPostures((m) => ({ ...m, [participant.identity]: { ...obj, ts: Date.now() } }));
      } else if (topic === "nudge") {
        const from = obj.from || participant?.name || "친구";
        setNudge({ from, ts: Date.now() });
        try { navigator.vibrate?.([140, 70, 140]); } catch {}
        // 엔진(app.js)에 알려 알림음·요정 반응까지 (리스너가 있으면)
        try { window.dispatchEvent(new CustomEvent("pg-nudge", { detail: { from } })); } catch {}
        setTimeout(() => setNudge((n) => (n && Date.now() - n.ts >= 4800 ? null : n)), 5000);
      }
    };
    room.on(RoomEvent.DataReceived, onData);
    return () => room.off(RoomEvent.DataReceived, onData);
  }, [room]);

  const sendNudge = useCallback((toId, toNick) => {
    if (cooldown[toId] && Date.now() < cooldown[toId]) return;
    const myNick = room.localParticipant?.name || "친구";
    try {
      room.localParticipant.publishData(
        enc.encode(JSON.stringify({ type: "nudge", from: myNick })),
        { reliable: true, topic: "nudge", destinationIdentities: [toId] });
      setCooldown((c) => ({ ...c, [toId]: Date.now() + NUDGE_COOLDOWN }));
    } catch {}
  }, [room, cooldown]);

  return (
    <>
      {nudge && (
        <div className="nudge-pop">🔔 <b>{nudge.from}</b> 님이 자세 펴라고 콕! 찔렀어요 — 허리 쫙! 🌟</div>
      )}
      <ShareToggle />
      <p className="hint">공유를 켜면 친구들이 내 자세를 실시간으로 봐요. <b>자세 점수(숫자)는 카메라를 안 켜도</b> 서로 보여요. 영상은 LiveKit 서버를 통해 전달돼요.</p>
      <Grid postures={postures} onNudge={sendNudge} cooldown={cooldown} />
      <div className="row" style={{ marginTop: 8 }}>
        <button onClick={onClose}>그리드 닫기</button>
      </div>
    </>
  );
}

export default function GroupGridRoom({ code, onClose }) {
  const [conn, setConn] = useState(null); // {token,url} | "unconfigured" | "error" | null

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`${API_BASE}/api/rtc-token`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ memberId: myId(), code }),
        });
        const d = await r.json().catch(() => ({}));
        if (!alive) return;
        if (r.status === 503 || d.configured === false) setConn("unconfigured");
        else if (!r.ok || !d.token) setConn("error");
        else setConn({ token: d.token, url: d.url });
      } catch { if (alive) setConn("error"); }
    })();
    return () => { alive = false; };
  }, [code]);

  if (conn === "unconfigured")
    return <p className="hint">실시간 그리드는 <b>LiveKit 설정</b> 후 켜져요 (관리자가 키를 등록해야 함). 지금은 준비 중이에요.</p>;
  if (conn === "error")
    return <p className="hint rtc-err">연결 준비에 실패했어요 — 잠시 후 다시 시도해주세요.</p>;
  if (!conn) return <p className="hint">연결 중…</p>;

  return (
    <LiveKitRoom serverUrl={conn.url} token={conn.token} connect audio={false} video={false} style={{ background: "transparent" }}>
      <RoomInner onClose={onClose} />
    </LiveKitRoom>
  );
}
