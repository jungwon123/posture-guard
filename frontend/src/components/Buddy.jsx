// 돌아다니는 요정 도우미 — 화면을 로밍하며 지금 어느 부위가 문제인지 말풍선으로 콕 짚어준다.
// 엔진이 window.__pgLive = { running, state, worst, dur }로 노출한 라이브 자세를 폴링해 반응.
// 말풍선은 body에 명령형 DOM으로 직접 생성/갱신한다(요정만 React) — 렌더/캡처 안정성 목적.
import { useEffect, useRef, useState } from "react";
import { SKINS } from "../reward.js";

const skinDir = () => {
  try { const shop = JSON.parse(localStorage.getItem("pg_shop") || "{}"); return SKINS[shop.skin]?.spriteDir || "assets/fairy"; }
  catch { return "assets/fairy"; }
};
const PROBLEM = {
  head_drop:     { anim: "hurt_neck", msgs: ["목이 앞으로 쏙 나왔어요! 턱을 살짝 당겨요 🐢", "거북목 조심! 목을 뒤로 당겨볼까요?"] },
  proximity:     { anim: "hurt_neck", msgs: ["화면에 너무 가까워요! 조금만 뒤로 🙈", "눈 아파요~ 화면과 거리를 둬요"] },
  pitch:         { anim: "hurt_neck", msgs: ["고개가 푹 숙여졌어요! 살짝 들어요 ⬆️", "화면을 눈높이로 올려볼까요?"] },
  shoulder_roll: { anim: "hurt_back", msgs: ["등이 굽었어요! 가슴을 쫙 펴요 🌟", "어깨가 말렸어요~ 활짝 펴봐요"] },
  head_tilt:     { anim: "hurt_neck", msgs: ["고개가 갸웃 기울었어요! 수평 맞춰요 ⚖️", "머리가 한쪽으로 쏠렸어요~ 가운데로 🙂"] },
  hand_face:     { anim: "hurt_neck", msgs: ["손으로 턱 괴지 마요~ 목이 비뚤어져요 ✋", "얼굴 괴면 척추가 울어요! 손 내려요"] },
};
const PRAISE = ["자세 완벽해요! ✨", "좋아요, 이대로! 💚", "허리 곧게 잘 폈어요 👍", "최고예요 🥰"];
const TIPS = ["바른 자세, 잊지 말아요~", "가끔 어깨도 쭉 펴줘요 🙆", "물 한 모금 마셔요 💧"];
const pick = (a) => a[Math.floor(Math.random() * a.length)];

export default function Buddy() {
  const [hidden, setHidden] = useState(() => localStorage.getItem("pg_buddy_off") === "1");
  // 초기 위치도 폰 컬럼(PC=중앙 430px, 모바일=전체) 안으로 잡아 마운트 직후 깜빡임 방지
  const [pos, setPos] = useState(() => ({ left: Math.max(0, (window.innerWidth - 430) / 2) + 56, top: 120 }));
  const [anim, setAnim] = useState("idle");
  const [dir, setDir] = useState(skinDir);
  const R = useRef({ state: null, worst: null, lastSpeak: 0, lastMove: 0, bubbleUntil: 0 });

  useEffect(() => { const id = setInterval(() => setDir(skinDir()), 2000); return () => clearInterval(id); }, []);

  useEffect(() => {
    if (hidden) return;
    // 말풍선 DOM (body에 직접)
    const wrap = document.createElement("div");
    wrap.className = "buddy-bubble-wrap"; wrap.style.display = "none";
    const bub = document.createElement("div"); bub.className = "buddy-bubble";
    wrap.appendChild(bub); document.body.appendChild(wrap);

    const B = 78;
    let cur = { left: 60, top: 120 };
    const placeBubble = () => {
      const w = bub.offsetWidth || 150;
      wrap.style.left = Math.round(Math.min(Math.max(cur.left + B / 2 - w / 2, 6), innerWidth - w - 6)) + "px";
      wrap.style.top = (cur.top + B + 12) + "px";
    };
    const showBubble = (t) => { bub.textContent = t; wrap.style.display = "block"; placeBubble(); };
    const hideBubble = () => { wrap.style.display = "none"; };
    const setBoth = (p) => { cur = p; setPos(p); if (wrap.style.display !== "none") placeBubble(); R.current.lastMove = performance.now(); };

    // PC에서는 앱이 폰 폭(430px) 중앙 컬럼으로 보이므로, 도우미도 그 컬럼 안에서만 로밍
    const FRAME = 430;
    const fx = () => Math.max(0, (innerWidth - FRAME) / 2); // 폰 컬럼 왼쪽 오프셋(모바일=0)
    const fw = () => Math.min(innerWidth, FRAME);           // 폰 컬럼 폭(모바일=innerWidth)
    const perches = () => { const x0 = fx(), w = fw(), h = innerHeight; return [
      { left: x0 + 56, top: 118 }, { left: x0 + w - B - 56, top: 118 },
      { left: x0 + 56, top: Math.round(h * 0.4) }, { left: x0 + w - B - 56, top: Math.round(h * 0.4) },
      { left: x0 + 56, top: h - 250 }, { left: x0 + w - B - 56, top: h - 250 },
    ]; };
    const roam = () => setBoth(perches()[Math.floor(Math.random() * 6)]);
    // 말할 때 서는 '무대' — 카메라 <video> 위에 말풍선이 가려지므로(비디오 오버레이) 비디오 없는 하단 중앙으로
    const stageSpot = () => setBoth({ left: Math.round(fx() + fw() / 2 - B / 2), top: Math.max(120, innerHeight - 240) });
    const say = (t, ms = 4600) => { stageSpot(); showBubble(t); R.current.bubbleUntil = performance.now() + ms; R.current.lastSpeak = performance.now(); };

    roam();
    const id = setInterval(() => {
      const now = performance.now(), s = R.current;
      if (s.bubbleUntil && now > s.bubbleUntil) { hideBubble(); s.bubbleUntil = 0; }
      const live = window.__pgLive || { running: false };
      const { running, state, worst } = live;

      if (running && state === "BAD") {
        const toBad = s.state !== "BAD";
        const changed = worst && worst !== s.worst;
        if ((toBad || changed) && now - s.lastSpeak > 3500) {
          const p = PROBLEM[worst] || PROBLEM.head_drop;
          setAnim(p.anim); say(pick(p.msgs), 5200);
        }
      } else if (running && s.state === "BAD" && state === "GOOD") {
        setAnim("praise"); say(pick(PRAISE), 3600);
      } else {
        if (anim !== "idle" && !s.bubbleUntil) setAnim("idle");
        if (!s.bubbleUntil && now - s.lastMove > 11000) roam();
        if (running && state === "GOOD" && now - s.lastSpeak > 40000 && Math.random() < 0.18) say(pick(TIPS), 3600);
        if (!running && now - s.lastSpeak > 60000 && Math.random() < 0.05) say("카메라를 켜면 자세를 봐줄게요 👀", 3600);
      }
      s.state = state; s.worst = worst;
    }, 700);
    return () => { clearInterval(id); wrap.remove(); };
  }, [hidden]); // eslint-disable-line

  if (hidden) return null;
  return (
    <div className="buddy" style={{ left: pos.left, top: pos.top }}>
      <img className="buddy-img" src={`/${dir}/${anim}.gif`} alt="요정 도우미"
        onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = "/assets/fairy/idle.gif"; }} />
      <button className="buddy-x" onClick={() => { localStorage.setItem("pg_buddy_off", "1"); setHidden(true); }} title="도우미 숨기기">✕</button>
    </div>
  );
}
