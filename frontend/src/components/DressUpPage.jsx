// 꾸미기 페이지 — 상점 + 캐릭터(장착)를 한 탭으로 통합(B안 4탭). 세그먼트로 [내 요정]/[상점] 전환.
// 엔진이 id로 채우는 #equip-grid·#shop-list는 둘 다 항상 마운트(표시만 토글).
import { useEffect, useState } from "react";
import { SKINS } from "../reward.js";

function readShop() {
  return { owned: [], skin: "fairy", ...JSON.parse(localStorage.getItem("pg_shop") || "{}") };
}

export default function DressUpPage() {
  const [seg, setSeg] = useState("equip");
  const [shop, setShop] = useState(readShop);
  const [points, setPoints] = useState(() => +(localStorage.getItem("pg_points") || 0));
  useEffect(() => {
    const id = setInterval(() => {
      setShop(readShop());
      setPoints(+(localStorage.getItem("pg_points") || 0));
    }, 2000);
    return () => clearInterval(id);
  }, []);

  const skin = SKINS[shop.skin] || SKINS.fairy;

  return (
    <>
      <div className="page-title">꾸미기</div>

      {/* 현재 장착 + 포인트 */}
      <div className="card dressup-head">
        <div className="du-preview">
          {skin.spriteDir
            ? <img className="char-preview" src={`/${skin.spriteDir}/idle.gif`} alt={skin.label} />
            : <div className="char-preview-emoji">{skin.good}</div>}
          <b>{skin.label}</b>
          <span className="hint">지금 장착 중</span>
        </div>
        <div className="du-points">
          <span className="hint">보유 포인트</span>
          <div className="points-big">🪙 {points}P</div>
          <span className="hint">바른 자세 1분 = 1P</span>
        </div>
      </div>

      <div className="seg-tabs">
        <button className={seg === "equip" ? "on" : ""} onClick={() => setSeg("equip")}>내 요정</button>
        <button className={seg === "shop" ? "on" : ""} onClick={() => setSeg("shop")}>상점</button>
      </div>

      {/* 내 요정 (장착) — 엔진이 #equip-grid 렌더 */}
      <div style={{ display: seg === "equip" ? undefined : "none" }}>
        <div id="equip-grid" className="equip-grid"></div>
        <p className="hint">보유한 요정을 눌러 바로 갈아입어요. 새 요정은 [상점]에서 포인트로 사요.</p>
      </div>

      {/* 상점 — 엔진이 #shop-list 렌더 */}
      <div style={{ display: seg === "shop" ? undefined : "none" }}>
        <div id="shop-list"></div>
        <p className="hint">공부로 모은 포인트로 새 요정을 데려와요.</p>
      </div>
    </>
  );
}
