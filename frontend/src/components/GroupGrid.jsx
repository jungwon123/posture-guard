// 실시간 그리드 진입점 — 그룹 있을 때만 노출, "열기" 누르면 무거운 LiveKit 방을 지연 로드.
// (LiveKit 번들은 그리드를 열 때만 내려받음)
import { lazy, Suspense, useEffect, useState } from "react";

const Room = lazy(() => import("./GroupGridRoom.jsx"));
const myGroup = () => { try { return JSON.parse(localStorage.getItem("pg_group") || "null"); } catch { return null; } };

export default function GroupGrid() {
  const [group, setGroup] = useState(myGroup);
  const [open, setOpen] = useState(false);
  useEffect(() => { const id = setInterval(() => setGroup(myGroup()), 3000); return () => clearInterval(id); }, []);

  if (!group) return null;
  return (
    <details id="rtc" open>
      <summary>실시간 자세 그리드 (같은 그룹)</summary>
      {!open ? (
        <div className="rtc-intro">
          <div className="rtc-intro-row">
            <img className="rtc-intro-icon" src="/assets/ui/nav-group.png" alt="" />
            <div className="rtc-intro-body">
              <p className="rtc-intro-copy">같은 그룹 친구들과 <b>실시간 카메라 그리드</b>로 함께 공부해요.</p>
              <p className="rtc-intro-sub">열면 그룹 방에 접속해요. 카메라 공유는 옵트인 — 직접 켜야만 보여요.</p>
            </div>
          </div>
          <button className="rtc-open-cta" onClick={() => setOpen(true)}>
            실시간 그리드 열기<span className="rtc-open-arrow" aria-hidden="true">›</span>
          </button>
        </div>
      ) : (
        <Suspense fallback={<p className="hint">불러오는 중…</p>}>
          <Room code={group.code} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </details>
  );
}
