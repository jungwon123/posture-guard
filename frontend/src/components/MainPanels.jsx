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
      </div>
      <div className="panel">
        <canvas id="track" className="fill" width="640" height="480"></canvas>
      </div>
    </main>
  );
}
