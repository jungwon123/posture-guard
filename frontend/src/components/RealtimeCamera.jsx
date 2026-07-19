// 실시간 그룹 카메라 — 같은 그룹 친구의 카메라를 실시간으로 보기(WebRTC P2P).
// 안전: 공유 기본 OFF·옵트인, 공유 중 표시, 같은 그룹만, 녹화/저장 없음.
import { useEffect, useRef, useState } from "react";
import { startRealtime, stopRealtime, setSharing, watch, unwatch, onRealtime } from "../realtime.js";

const myGroup = () => { try { return JSON.parse(localStorage.getItem("pg_group") || "null"); } catch { return null; } };
const myId = () => localStorage.getItem("pg_member_id");

export default function RealtimeCamera() {
  const [group, setGroup] = useState(myGroup);
  const [peers, setPeers] = useState([]);        // [{memberId, nick, sharing}]
  const [sharing, setSh] = useState(false);
  const [watcherN, setWatcherN] = useState(0);   // 나를 보는 사람 수
  const [viewing, setViewing] = useState(null);  // {peerId, nick}
  const [err, setErr] = useState("");
  const videoRef = useRef(null);
  const viewingRef = useRef(null);
  const streams = useRef(new Map());

  useEffect(() => { const id = setInterval(() => setGroup(myGroup()), 3000); return () => clearInterval(id); }, []);

  const code = group?.code || null;
  useEffect(() => {
    const mid = myId();
    if (!code || !mid) { stopRealtime(); setPeers([]); return; }
    startRealtime(mid, code);
    const off = onRealtime((ev) => {
      switch (ev.type) {
        case "peers": setPeers(ev.list.filter((p) => p.memberId !== mid)); break;
        case "join": setPeers((p) => p.some((x) => x.memberId === ev.memberId) ? p
          : [...p, { memberId: ev.memberId, nick: ev.nick, sharing: false }]); break;
        case "leave": setPeers((p) => p.filter((x) => x.memberId !== ev.memberId)); break;
        case "peer-share": setPeers((p) => p.map((x) => x.memberId === ev.memberId ? { ...x, sharing: ev.on } : x)); break;
        case "sharing": setSh(ev.on); break;
        case "watchers": setWatcherN(ev.ids.length); break;
        case "error": setErr(ev.msg); setTimeout(() => setErr(""), 3500); break;
        case "stream":
          streams.current.set(ev.peerId, ev.stream);
          if (viewingRef.current === ev.peerId) attach(ev.stream);
          break;
      }
    });
    return () => { off(); };
  }, [code]);

  const attach = (stream) => { if (videoRef.current) videoRef.current.srcObject = stream || null; };

  const openView = (p) => { viewingRef.current = p.memberId; setViewing({ peerId: p.memberId, nick: p.nick }); watch(p.memberId); };
  const closeView = () => { const v = viewingRef.current; viewingRef.current = null; if (v) unwatch(v); attach(null); setViewing(null); };
  useEffect(() => { if (viewing) attach(streams.current.get(viewing.peerId) || null); }, [viewing]);

  if (!group) return null;

  return (
    <details id="rtc" open>
      <summary>📹 실시간 자세 보기 (같은 그룹)</summary>

      <div className="rtc-share">
        <label className="rtc-toggle">
          <input type="checkbox" checked={sharing} onChange={(e) => setSharing(e.target.checked)} />
          <span>내 카메라 공유하기</span>
        </label>
        {sharing && <span className="rtc-live">🔴 공유 중{watcherN ? ` · ${watcherN}명이 보는 중` : ""}</span>}
      </div>
      <p className="hint">
        켜면 <b>같은 그룹 친구만</b> 내 카메라를 실시간으로 볼 수 있어요. 영상은 <b>서버에 저장되지 않고</b> 친구 기기로 직접(P2P) 전송돼요. 카메라가 켜져 있어야 공유됩니다.
      </p>
      {err && <p className="hint rtc-err">{err}</p>}

      <div className="rtc-peers">
        {peers.length === 0 && <span className="hint">지금 접속 중인 그룹 친구가 없어요.</span>}
        {peers.map((p) => (
          <div key={p.memberId} className="rtc-peer">
            <span className="rtc-nick">{p.nick}</span>
            {p.sharing
              ? <button className="rtc-view" onClick={() => openView(p)}>📹 자세 보기</button>
              : <span className="rtc-off">공유 안 함</span>}
          </div>
        ))}
      </div>

      {viewing && (
        <div className="rtc-modal" onClick={closeView}>
          <div className="rtc-modal-in" onClick={(e) => e.stopPropagation()}>
            <div className="rtc-modal-head">
              <b>{viewing.nick}님의 자세</b>
              <button className="rtc-close" onClick={closeView} aria-label="닫기">✕</button>
            </div>
            <video ref={videoRef} autoPlay playsInline muted className="rtc-video" />
            <p className="hint">연결 중이면 잠시 기다려주세요. 상대가 공유를 끄면 자동 종료됩니다.</p>
          </div>
        </div>
      )}
    </details>
  );
}
