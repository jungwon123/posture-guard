// 실시간 그룹 카메라 (WebRTC P2P). 시그널링=VM /ws, 영상은 P2P 직접 전송(서버 경유·저장 없음).
// 안전: 공유 기본 OFF·옵트인만, 같은 그룹만, 공유 중 표시, 언제든 중지.
const WS_URL = "wss://34-64-158-222.sslip.io/ws";
const ICE = { iceServers: [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
] };
// 감지용 카메라 스트림을 그대로 재사용 (두 번째 getUserMedia 없이). 켜져 있을 때만 존재.
const localStream = () => document.getElementById("cam")?.srcObject || null;

let ws = null, myId = null, myCode = null, sharing = false, want = false;
const pcs = new Map(); // peerId -> RTCPeerConnection (pc.__role: "sharer"|"viewer")
const subs = new Set();
const emit = (ev) => subs.forEach((cb) => { try { cb(ev); } catch {} });
const send = (m) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); };
const watchers = () => [...pcs.entries()].filter(([, pc]) => pc.__role === "sharer").map(([id]) => id);

export const onRealtime = (cb) => { subs.add(cb); return () => subs.delete(cb); };
export const getSharing = () => sharing;

export function startRealtime(memberId, code) {
  if (!memberId || !code) return;
  if (myId === memberId && myCode === code && ws && ws.readyState <= 1) return; // 이미 연결
  myId = memberId; myCode = code; want = true;
  connect();
}
export function stopRealtime() {
  want = false; sharing = false;
  pcs.forEach((pc) => { try { pc.close(); } catch {} }); pcs.clear();
  if (ws) { try { ws.close(); } catch {} ws = null; }
}
function connect() {
  if (!want) return;
  try { ws = new WebSocket(WS_URL); } catch { return; }
  ws.onopen = () => send({ t: "hello", memberId: myId, code: myCode });
  ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } handle(m); };
  ws.onclose = () => { ws = null; if (want) setTimeout(connect, 3000); };
  ws.onerror = () => {};
}

export function setSharing(on) {
  if (on && !localStream()) { emit({ type: "error", msg: "카메라를 먼저 켜야 공유할 수 있어요." }); return false; }
  sharing = !!on;
  send({ t: "share", on: sharing });
  if (!sharing) { // 공유 끄면 나를 보던 연결 종료
    for (const [pid, pc] of [...pcs]) if (pc.__role === "sharer") { try { pc.close(); } catch {} pcs.delete(pid); }
    emit({ type: "watchers", ids: [] });
  }
  emit({ type: "sharing", on: sharing });
  return true;
}
export function watch(peerId) { send({ t: "watch", target: peerId }); }
export function unwatch(peerId) {
  send({ t: "unwatch", target: peerId });
  const pc = pcs.get(peerId); if (pc) { try { pc.close(); } catch {} pcs.delete(peerId); }
  emit({ type: "stream", peerId, stream: null });
}

function makePc(peerId, role) {
  const pc = new RTCPeerConnection(ICE);
  pc.__role = role;
  pc.onicecandidate = (e) => { if (e.candidate) send({ t: "signal", target: peerId, data: { ice: e.candidate } }); };
  pc.ontrack = (e) => emit({ type: "stream", peerId, stream: e.streams[0] });
  pc.onconnectionstatechange = () => {
    if (["failed", "closed", "disconnected"].includes(pc.connectionState) && pcs.get(peerId) === pc) {
      try { pc.close(); } catch {} pcs.delete(peerId);
      emit({ type: "stream", peerId, stream: null });
      emit({ type: "watchers", ids: watchers() });
    }
  };
  pcs.set(peerId, pc);
  return pc;
}

async function handle(m) {
  switch (m.t) {
    case "error": emit({ type: "error", msg: m.msg }); break;
    case "peers": emit({ type: "peers", list: m.list }); break;
    case "join": emit({ type: "join", memberId: m.memberId, nick: m.nick }); break;
    case "leave": {
      const pc = pcs.get(m.memberId); if (pc) { try { pc.close(); } catch {} pcs.delete(m.memberId); }
      emit({ type: "leave", memberId: m.memberId });
      emit({ type: "stream", peerId: m.memberId, stream: null });
      break;
    }
    case "share": emit({ type: "peer-share", memberId: m.memberId, on: m.on }); break;
    case "watch": { // 누군가 내 카메라를 보고 싶어함 (나 = 공유자)
      if (!sharing) return; // 옵트인 게이트
      const stream = localStream(); if (!stream) return;
      const pc = makePc(m.from, "sharer");
      stream.getVideoTracks().forEach((tr) => pc.addTrack(tr, stream));
      try {
        const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
        send({ t: "signal", target: m.from, data: { sdp: pc.localDescription } });
      } catch {}
      emit({ type: "watchers", ids: watchers() });
      break;
    }
    case "unwatch": {
      const pc = pcs.get(m.from); if (pc) { try { pc.close(); } catch {} pcs.delete(m.from); }
      emit({ type: "watchers", ids: watchers() });
      break;
    }
    case "signal": {
      const peerId = m.from, data = m.data || {};
      let pc = pcs.get(peerId);
      try {
        if (data.sdp) {
          if (data.sdp.type === "offer") { // 나 = viewer, 공유자의 offer 수신
            if (!pc) pc = makePc(peerId, "viewer");
            await pc.setRemoteDescription(data.sdp);
            const ans = await pc.createAnswer(); await pc.setLocalDescription(ans);
            send({ t: "signal", target: peerId, data: { sdp: pc.localDescription } });
          } else if (data.sdp.type === "answer" && pc) {
            await pc.setRemoteDescription(data.sdp);
          }
        } else if (data.ice && pc) {
          await pc.addIceCandidate(data.ice);
        }
      } catch {}
      break;
    }
  }
}
