// 돌아다니는 요정 도우미 — 화면을 로밍하며 지금 어느 부위가 문제인지 말풍선으로 콕 짚어준다.
// 엔진이 window.__pgLive = { running, state, worst, dur }로 노출한 라이브 자세를 폴링해 반응.
// 말풍선은 body에 명령형 DOM으로 직접 생성/갱신한다(요정만 React) — 렌더/캡처 안정성 목적.
import { useEffect, useRef, useState } from "react";
import { SKINS, hurtMotion } from "../reward.js";
import { TUNING } from "../core.js";

const skinDir = () => {
  try { const shop = JSON.parse(localStorage.getItem("pg_shop") || "{}"); return SKINS[shop.skin]?.spriteDir || "assets/fairy"; }
  catch { return "assets/fairy"; }
};
// 원인 신호 → 부위 멘트. 모션은 reward.js의 hurtMotion(worst)를 그대로 써서(헤더 요정과 같은 SSoT)
// 멘트가 가리키는 부위와 아픈 부위 GIF가 항상 일치한다 (예: 턱괴기 = 삐딱함 계열 → hurt_pelvis).
const PROBLEM = {
  head_drop:     { msgs: ["목이 앞으로 쏙 나왔어요! 턱을 살짝 당겨요", "거북목 조심! 목을 뒤로 당겨볼까요?"] },
  proximity:     { msgs: ["화면에 너무 가까워요! 조금만 뒤로", "눈 아파요~ 화면과 거리를 둬요"] },
  pitch:         { msgs: ["고개가 푹 숙여졌어요! 살짝 들어요", "화면을 눈높이로 올려볼까요?"] },
  shoulder_roll: { msgs: ["등이 굽었어요! 가슴을 쫙 펴요", "어깨가 말렸어요~ 활짝 펴봐요"] },
  shoulder_tilt: { msgs: ["어깨가 한쪽으로 기울었어요! 수평 맞춰요", "양 어깨 높이를 맞춰볼까요?"] },
  head_tilt:     { msgs: ["고개가 갸웃 기울었어요! 수평 맞춰요", "머리가 한쪽으로 쏠렸어요~ 가운데로"] },
  hand_face:     { msgs: ["손으로 턱 괴지 마요~ 골반까지 비뚤어져요", "얼굴 괴면 척추가 울어요! 손 내려요"] },
};
const PRAISE = ["자세 완벽해요", "좋아요, 이대로", "허리 곧게 잘 폈어요", "최고예요"];
const TIPS = ["바른 자세, 잊지 말아요", "가끔 어깨도 쭉 펴줘요", "지금처럼 곧게, 좋아요"];
const pick = (a) => a[Math.floor(Math.random() * a.length)];

// 요정이 이동할 때 '샤랄라' 잔상 — 글라이드하는 동안 실제 위치를 rAF로 샘플링해 경로에 반짝이를 남기고 사라지게.
const SPARK_COLORS = ["#8fd694", "#ffd76a", "#ffb3c8", "#bfe3ff"];
function sparkleTrail(from, to) {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return; // 모션 최소화 존중
  if (Math.hypot(to.left - from.left, to.top - from.top) < 40) return;         // 거의 안 움직이면 스킵
  const el = document.querySelector(".buddy");
  if (!el) return;
  const start = performance.now(), DUR = 1050;
  let last = -100;
  const step = (t) => {
    const el2 = document.querySelector(".buddy");
    const elapsed = t - start;
    if (!el2 || elapsed > DUR) return;
    if (elapsed - last >= 65) {
      last = elapsed;
      const r = el2.getBoundingClientRect();
      const s = document.createElement("div");
      s.className = "buddy-spark";
      s.style.left = (r.left + r.width / 2 + (Math.random() * 26 - 13)) + "px";
      s.style.top = (r.top + r.height / 2 + (Math.random() * 26 - 13)) + "px";
      s.style.setProperty("--spark", SPARK_COLORS[Math.floor(Math.random() * SPARK_COLORS.length)]);
      document.body.appendChild(s);
      setTimeout(() => s.remove(), 1000);
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

const loadPin = () => { try { return JSON.parse(localStorage.getItem("pg_buddy_pos") || "null"); } catch { return null; } };

export default function Buddy() {
  const [hidden, setHidden] = useState(() => localStorage.getItem("pg_buddy_off") === "1");
  // 통계(리포트) 오버레이 열림 감지 — 요정·말풍선 함께 숨김 (QC2차 #19).
  // CSS :has 규칙과 이중 안전장치: :has 미지원 브라우저(구형 삼성 인터넷 등)에서도 동작.
  const [reportOpen, setReportOpen] = useState(false);
  useEffect(() => {
    const ro = document.getElementById("report-overlay");
    if (!ro) return;
    const sync = () => {
      const open = ro.classList.contains("open");
      setReportOpen(open);
      if (open) document.querySelectorAll(".buddy-bubble-wrap").forEach((w) => { w.style.display = "none"; });
    };
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(ro, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);
  // 초기 위치: 사용자가 끌어다 둔 자리(pin)가 있으면 거기, 없으면 폰 컬럼 안 기본 자리
  const [pos, setPos] = useState(() => {
    const pin = loadPin();
    const B = 78;
    if (pin) return { left: Math.min(Math.max(pin.left, 0), innerWidth - B), top: Math.min(Math.max(pin.top, 0), innerHeight - B) };
    return { left: Math.max(0, (window.innerWidth - 430) / 2) + 56, top: 120 };
  });
  const [anim, setAnim] = useState("idle");
  const [dir, setDir] = useState(skinDir);
  const [dragging, setDragging] = useState(false);
  const R = useRef({ state: null, worst: null, lastSpeak: 0, lastMove: 0, bubbleUntil: 0, anim: "idle" });
  const posRef = useRef(pos);          // 드래그·말풍선 배치가 공유하는 현재 위치
  // 드래그로 놓은 자리엔 '잠시' 머문다(가리던 콘텐츠 비켜주기) — 유예가 끝나면 다시 자유 로밍.
  const HOLD_MS = 90_000;
  const holdUntilRef = useRef(0);      // 이 시각(performance.now)까지 자동 이동(로밍·무대) 중지
  const dragRef = useRef(null);        // { dx, dy, moved } 포인터-요정 오프셋 + 실제 이동 여부

  useEffect(() => {
    const id = setInterval(() => {
      setDir(skinDir());
      // 설정 페이지에서 요정 숨김/위치 초기화를 바꾸면 리로드 없이 반영
      const off = localStorage.getItem("pg_buddy_off") === "1";
      setHidden(off);
      // 설정 > 위치 초기화: 저장 위치가 지워지면 유예도 즉시 해제 → 바로 다시 돌아다님
      if (!localStorage.getItem("pg_buddy_pos") && holdUntilRef.current) holdUntilRef.current = 0;
      // 자가 치유: 어떤 이유로든 위치가 화면 밖이면 고정 자리(없으면 기본 자리)로 복귀
      // (뷰포트가 아직 0인 순간 — 백그라운드 탭 복원 등 — 에는 계산이 오염되므로 스킵)
      if (!off && innerWidth > 100 && innerHeight > 100) {
        const B = 78;
        setPos((p) => {
          const ok = p.left >= 0 && p.top >= 0 && p.left <= innerWidth - B && p.top <= innerHeight - B;
          if (ok) return p;
          const pin = loadPin();
          const np = pin
            ? { left: Math.min(Math.max(pin.left, 0), innerWidth - B), top: Math.min(Math.max(pin.top, 0), innerHeight - B) }
            : { left: Math.max(0, (innerWidth - 430) / 2) + 56, top: 120 };
          posRef.current = np;
          return np;
        });
      }
    }, 2000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (hidden) return;
    // 말풍선 DOM (body에 직접)
    const wrap = document.createElement("div");
    wrap.className = "buddy-bubble-wrap"; wrap.style.display = "none";
    const bub = document.createElement("div"); bub.className = "buddy-bubble";
    wrap.appendChild(bub); document.body.appendChild(wrap);

    const B = 78;
    const placeBubble = () => {
      const cur = posRef.current;
      const w = bub.offsetWidth || 150;
      wrap.style.left = Math.round(Math.min(Math.max(cur.left + B / 2 - w / 2, 6), innerWidth - w - 6)) + "px";
      // 화면 하단에 고정해 두면 말풍선이 잘리므로 위쪽으로 뒤집기
      wrap.style.top = (cur.top + B + 12 + 40 > innerHeight ? cur.top - 40 : cur.top + B + 12) + "px";
    };
    const showBubble = (t) => {
      if (document.getElementById("report-overlay")?.classList.contains("open")) return; // 통계 열람 중엔 말풍선 금지
      bub.textContent = t; wrap.style.display = "block"; placeBubble();
    };
    const hideBubble = () => { wrap.style.display = "none"; };
    wrap.__place = placeBubble; // 드래그 핸들러(이펙트 밖)가 말풍선을 따라오게 할 훅
    const setBoth = (p) => { const from = posRef.current; posRef.current = p; setPos(p); if (wrap.style.display !== "none") placeBubble(); R.current.lastMove = performance.now(); sparkleTrail(from, p); };

    // PC에서는 앱이 폰 폭(430px) 중앙 컬럼으로 보이므로, 도우미도 그 컬럼 안에서만 로밍
    const FRAME = 430;
    const fx = () => Math.max(0, (innerWidth - FRAME) / 2); // 폰 컬럼 왼쪽 오프셋(모바일=0)
    const fw = () => Math.min(innerWidth, FRAME);           // 폰 컬럼 폭(모바일=innerWidth)
    const perches = () => { const x0 = fx(), w = fw(), h = innerHeight; return [
      { left: x0 + 56, top: 118 }, { left: x0 + w - B - 56, top: 118 },
      { left: x0 + 56, top: Math.round(h * 0.4) }, { left: x0 + w - B - 56, top: Math.round(h * 0.4) },
      { left: x0 + 56, top: h - 250 }, { left: x0 + w - B - 56, top: h - 250 },
    ]; };
    // 드래그 중이거나 놓은 자리 유예(HOLD_MS) 동안에는 자동 이동 금지 — 유예가 끝나면 자유 로밍 재개
    const autoMoveBlocked = () => dragRef.current || performance.now() < holdUntilRef.current;
    const roam = () => { if (!autoMoveBlocked()) setBoth(perches()[Math.floor(Math.random() * 6)]); };
    // 말할 때 서는 '무대' — 카메라 <video> 위에 말풍선이 가려지므로(비디오 오버레이) 비디오 없는 하단 중앙으로
    const stageSpot = () => { if (!autoMoveBlocked()) setBoth({ left: Math.round(fx() + fw() / 2 - B / 2), top: Math.max(120, innerHeight - 240) }); };
    const say = (t, ms = 4600) => { stageSpot(); showBubble(t); R.current.bubbleUntil = performance.now() + ms; R.current.lastSpeak = performance.now(); };

    // setAnim은 stale closure(deps=[hidden])라 anim 상태를 직접 비교하면 안 됨 — R.current.anim이 진실.
    const applyAnim = (a) => { const s = R.current; if (s.anim !== a) { s.anim = a; setAnim(a); } };

    roam();
    const id = setInterval(() => {
      const now = performance.now(), s = R.current;
      if (s.bubbleUntil && now > s.bubbleUntil) { hideBubble(); s.bubbleUntil = 0; }
      const live = window.__pgLive || { running: false };
      const { running, state, worst, dur } = live;

      if (running && state === "BAD") {
        const toBad = s.state !== "BAD";
        const changed = worst && worst !== s.worst;
        if ((toBad || changed) && now - s.lastSpeak > 3500) {
          const p = PROBLEM[worst] || PROBLEM.head_drop;
          applyAnim(hurtMotion(worst)); say(pick(p.msgs), 5200); // 멘트 부위 = 아픈 부위 (SSoT 공유)
        } else if (!s.bubbleUntil && (dur || 0) >= TUNING.ESCALATE_NOTIFY) {
          applyAnim("angry"); // 오래 방치 — 헤더 요정과 같은 에스컬레이션
        }
      } else if (running && s.state === "BAD" && state === "GOOD") {
        applyAnim("praise"); say(pick(PRAISE), 3600);
      } else if (running && state === "CAUTION") {
        if (!s.bubbleUntil) applyAnim("alert"); // 주의 — 말풍선 없이 경고 표정만(과민 방지)
      } else {
        if (!s.bubbleUntil) applyAnim("idle");
        if (!s.bubbleUntil && now - s.lastMove > 11000) roam();
        if (running && state === "GOOD" && now - s.lastSpeak > 40000 && Math.random() < 0.18) { applyAnim("encourage"); say(pick(TIPS), 3600); }
        if (!running && now - s.lastSpeak > 60000 && Math.random() < 0.05) say("카메라를 켜면 자세를 봐줄게요", 3600);
      }
      s.state = state; s.worst = worst;
    }, 700);
    return () => { clearInterval(id); wrap.remove(); };
  }, [hidden]); // eslint-disable-line

  // 드래그로 요정 옮기기 — 놓은 자리에 잠시(HOLD_MS) 머물렀다가 다시 자유롭게 돌아다닌다.
  // 저장된 위치는 다음 부팅의 시작 자리로만 쓰인다(영구 고정 아님).
  const onPointerDown = (e) => {
    if (e.target.closest(".buddy-x")) return;
    e.preventDefault(); // 드래그 중 페이지 텍스트 선택 방지
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch {} // 일부 브라우저는 무효 포인터에 throw
    dragRef.current = { dx: e.clientX - posRef.current.left, dy: e.clientY - posRef.current.top, moved: false };
    setDragging(true);
  };
  const onPointerMove = (e) => {
    if (!dragRef.current) return;
    const B = 78;
    const p = {
      left: Math.min(Math.max(e.clientX - dragRef.current.dx, 0), innerWidth - B),
      top: Math.min(Math.max(e.clientY - dragRef.current.dy, 0), innerHeight - B),
    };
    if (Math.hypot(p.left - posRef.current.left, p.top - posRef.current.top) > 6) dragRef.current.moved = true;
    posRef.current = p; setPos(p);
    document.querySelector(".buddy-bubble-wrap")?.__place?.(); // 말풍선 따라오기
  };
  const onPointerUp = () => {
    if (!dragRef.current) return;
    const moved = dragRef.current.moved;
    dragRef.current = null; setDragging(false);
    if (!moved) return; // 제자리 탭은 유예 없음 — 로밍 그대로
    holdUntilRef.current = performance.now() + HOLD_MS;
    localStorage.setItem("pg_buddy_pos", JSON.stringify(posRef.current));
  };

  if (hidden || reportOpen) return null;
  return (
    <div className={`buddy${dragging ? " dragging" : ""}`} style={{ left: pos.left, top: pos.top }}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
      <img className="buddy-img" src={`/${dir}/${anim}.gif`} alt="요정 도우미" draggable={false}
        onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = "/assets/fairy/idle.gif"; }} />
      <button className="buddy-x" onClick={() => { localStorage.setItem("pg_buddy_off", "1"); setHidden(true); }} title="도우미 숨기기">✕</button>
    </div>
  );
}
