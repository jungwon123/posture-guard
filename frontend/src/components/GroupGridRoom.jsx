// LiveKit 실시간 그리드 (반전체) — 지연 로드되는 무거운 부분. 토큰 받아 방 접속 후 참가자 카메라 그리드.
// 안전: 카메라 공유 opt-in(기본 OFF), 감지용 #cam 트랙 재사용(모바일 이중카메라 방지), 같은 그룹만(토큰 게이트).
import { useEffect, useState } from "react";
import { LiveKitRoom, GridLayout, ParticipantTile, useTracks, useRoomContext } from "@livekit/components-react";
import { Track } from "livekit-client";
import "@livekit/components-styles";

const API_BASE = "https://34-64-158-222.sslip.io";
const myId = () => localStorage.getItem("pg_member_id");

function Grid() {
  const tracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }]);
  return (
    <GridLayout tracks={tracks} style={{ height: "min(58vh, 440px)" }}>
      <ParticipantTile />
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
      <ShareToggle />
      <p className="hint">공유를 켜면 같은 그룹 친구들이 내 자세를 실시간으로 봐요. 영상은 LiveKit 서버를 통해 전달돼요(끄면 안 보임).</p>
      <Grid />
      <div className="row" style={{ marginTop: 8 }}>
        <button onClick={onClose}>그리드 닫기</button>
      </div>
    </LiveKitRoom>
  );
}
