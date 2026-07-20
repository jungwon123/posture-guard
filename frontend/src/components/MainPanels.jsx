// 2분할: 왼쪽 내 화면(카메라+얼굴 가리기 커버), 오른쪽 TRACKING 캔버스.
export default function MainPanels() {
  return (
    <main>
      <div className="panel" id="cam-panel">
        <span className="label">내 화면</span>
        <video id="cam" autoPlay playsInline muted></video>
        <div id="vignette"></div>
        <div id="face-cover">
          <img id="fc-img" alt="척추요정" />
          <span className="fc-emoji" id="fc-emoji">🧚</span>
          <div className="fc-text">얼굴 숨김 중 · 감지는 계속돼요</div>
        </div>

        {/* 카메라 시작 전 — 가장 먼저 눌러야 할 큰 시작 버튼 (첫 화면 길잡이) */}
        <div id="start-cta">
          <div className="start-cta-desc">카메라로 자세를 확인해 보세요</div>
          <button id="btn-start-hero" className="primary">📷 카메라 시작</button>
          <div className="start-cta-sub">영상은 저장·전송되지 않아요</div>
        </div>

        {/* 바른자세 기준 등록 중 — 자세 안내 + 큰 카운트다운 */}
        <div id="calib-guide">
          <div className="calib-instr">평소 공부하는 자세로 앉아 주세요</div>
          <div className="calib-count" id="calib-count">5</div>
          <div className="calib-sub">등·목만 곧게 — 이게 '내 공부 바른자세' 기준이 돼요</div>
        </div>

        {/* 자리 비움 — 측정이 멈췄음을 분명히 안내 */}
        <div id="away-notice">
          <div className="away-emoji">⏸️</div>
          <div className="away-title">측정을 잠시 멈췄어요</div>
          <div className="away-sub">자리를 비운 것 같아요 —<br />다시 앉으면 이어서 측정해요</div>
        </div>

        {/* 범용 중앙 팝업 — 등록 완료·종료 안내 등 (app.js가 내용 채움) */}
        <div id="center-pop"><div className="center-pop-card" id="center-pop-card"></div></div>
      </div>
      <div className="panel">
        <canvas id="track" className="fill" width="640" height="480"></canvas>
      </div>
    </main>
  );
}
