// 홈 화면 설치 안내 배너 + PiP용 숨김 미디어. 표시·내용은 엔진이 제어.
export default function InstallBanner() {
  return (
    <>
      <div id="install-banner">
        
        <span className="ib-text" id="install-text"></span>
        <button className="ib-action" id="install-action">설치</button>
        <button className="ib-close" id="install-close">✕</button>
      </div>
      <canvas id="mini-canvas" width="280" height="90" style={{ display: "none" }}></canvas>
      <video id="mini-video" muted playsInline style={{ display: "none" }}></video>
    </>
  );
}
