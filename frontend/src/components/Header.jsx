// 상단 바 — 상태·점수·포인트·눈깜빡임. 값은 엔진(app.js)이 id로 갱신한다.
export default function Header() {
  return (
    <header>
      <img className="app-logo" src="/assets/ui/logo.png" alt="척추요정 로고" />
      <h1>척추요정</h1>
      <span id="fairy" title="척추요정">🥚</span>
      <img id="fairy-img" alt="척추요정" title="척추요정" />
      <span id="speech" className="speech"></span>
      <span id="state-pill">준비 중</span>
      {/* 점수는 트래킹 캔버스 우측 상단에 표시 — 헤더에선 숨김(엔진 갱신 대상이라 DOM은 유지) */}
      <span id="score" style={{ display: "none" }}></span>
      <span id="points">0P</span>
      <span id="blink" style={{ display: "none" }}>--</span>
      <button id="theme-toggle" title="배경 밝게/어둡게">라이트</button>
    </header>
  );
}
