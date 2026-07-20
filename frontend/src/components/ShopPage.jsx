// 상점 페이지 — 상단 보유 포인트 + 스킨 구매 (목록은 엔진이 #shop-list에 렌더)
import { useEffect, useState } from "react";

export default function ShopPage() {
  const [points, setPoints] = useState(() => +(localStorage.getItem("pg_points") || 0));
  useEffect(() => {
    const id = setInterval(() => setPoints(+(localStorage.getItem("pg_points") || 0)), 2000);
    return () => clearInterval(id);
  }, []);

  return (
    <>
      <img className="page-banner sq" src="/assets/ui/shop.png" alt="상점" />
      <div className="card points-card">
        <span className="hint">보유 포인트</span>
        <div className="points-big">🪙 {points}P</div>
        <span className="hint">바른 자세 1분 = 1P · 출석 +10P</span>
      </div>
      <details id="shop" open>
        <summary>🛍️ 요정 스킨 구매</summary>
        <div id="shop-list"></div>
        <p className="hint">산 스킨은 [캐릭터] 페이지에서 갈아입힐 수 있어요.</p>
      </details>
    </>
  );
}
