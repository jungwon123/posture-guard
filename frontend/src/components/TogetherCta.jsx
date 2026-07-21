// 홈 → 함께 탭 진입 CTA. 엔진(app.js)이 45초마다 활성 그룹 리더보드 presence로 계산한
// '지금 공부 중인 친구 수'(window.__pgStudying)를 실시간 표시.
import { useEffect, useState } from "react";

export default function TogetherCta({ onGo }) {
  const [n, setN] = useState(() => (typeof window !== "undefined" ? window.__pgStudying : null));
  useEffect(() => {
    const onEvt = (e) => setN(e.detail);
    window.addEventListener("pg-studying", onEvt);
    const id = setInterval(() => setN(window.__pgStudying ?? null), 5000); // 폴백 동기화
    return () => { window.removeEventListener("pg-studying", onEvt); clearInterval(id); };
  }, []);

  const live = n != null && n > 0;
  return (
    <button className="together-cta" onClick={onGo}>
      
      <span className="tc-body">
        <b>함께 공부</b>
        <span>{live ? `지금 친구 ${n}명이 공부 중이에요` : "친구들과 같이 집중해요"}</span>
      </span>
      {live && <span className="tc-badge"><i className="tc-dot" />{n}</span>}
      <span className="tc-arrow">›</span>
    </button>
  );
}
