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
      <summary>📹 실시간 자세 그리드 (같은 그룹)</summary>
      {!open ? (
        <>
          <p className="hint">
            같은 그룹 친구들과 <b>실시간 카메라 그리드</b>로 함께 공부해요. 열면 그룹 방에 접속하고,
            <b> 카메라 공유는 옵트인</b>(직접 켜야 보임)이에요.
          </p>
          <button className="rtc-view" onClick={() => setOpen(true)}>📹 실시간 그리드 열기</button>
        </>
      ) : (
        <Suspense fallback={<p className="hint">불러오는 중…</p>}>
          <Room code={group.code} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </details>
  );
}
