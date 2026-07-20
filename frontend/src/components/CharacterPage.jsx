// 캐릭터 페이지 — 현재 장착 캐릭터 미리보기 + 보유 스킨 장착 (그리드는 엔진이 관리)
import { useEffect, useState } from "react";
import { SKINS } from "../reward.js";

function readShop() {
  return { owned: [], skin: "fairy", ...JSON.parse(localStorage.getItem("pg_shop") || "{}") };
}

export default function CharacterPage() {
  const [shop, setShop] = useState(readShop);
  useEffect(() => {
    const id = setInterval(() => setShop(readShop()), 2000);
    return () => clearInterval(id);
  }, []);

  const skin = SKINS[shop.skin] || SKINS.fairy;

  return (
    <>
      <img className="page-banner wide" src="/assets/ui/character.png" alt="캐릭터" />
      <div className="card char-card">
        <span className="hint">지금 장착 중</span>
        {skin.spriteDir ? (
          <img className="char-preview" src={`/${skin.spriteDir}/idle.gif`} alt={skin.label} />
        ) : (
          <div className="char-preview-emoji">{skin.good}</div>
        )}
        <b>{skin.label}</b>
      </div>
      <details id="character-equip" open>
        <summary>🎽 갈아입히기</summary>
        <div id="equip-grid" className="equip-grid"></div>
        <p className="hint">보유한 요정을 눌러 바로 갈아입어요. 새 요정은 [상점]에서 포인트로 살 수 있어요.</p>
      </details>
    </>
  );
}
