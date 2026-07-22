// 조작 버튼 줄 + 상태 메시지/요약. onClick 핸들러는 엔진(app.js)이 id로 붙인다.
export default function Controls() {
  return (
    <>
      <div id="controls">
        <button id="btn-start" className="primary">공부 시작</button>
        <button id="btn-calib" disabled title="평소 공부하는 자세로 등과 목만 곧게 펴고 5초간 유지하세요. 이 자세가 '내 공부 바른자세' 기준이 됩니다. 화면과 책을 오가며 공부하면 자세가 바뀔 때 다시 잡아요.">바른자세 기준 등록 (5초)</button>
        {/* 측정 중 카메라 배치 전환 — 공부 종료 없이 정면↔측면 (표시는 엔진이 start/stop에서 토글) */}
        <div className="cam-mode" id="cam-mode-live" title="공부를 끝내지 않고 카메라 배치를 바꿔요. 전환 후 폰을 옮기면 이어서 측정해요.">
          <button id="mode-front-live" type="button">정면</button>
          <button id="mode-side-live" type="button">측면</button>
        </div>
      </div>
      <details className="more-controls">
        <summary>더보기 · 알림 · 미니 모드 · 얼굴 가리기</summary>
        <div className="more-controls-row">
          <button id="btn-notify">알림 허용</button>
          <button id="btn-pip" disabled>미니 모드 (PiP)</button>
          <button id="btn-face">얼굴 가리기</button>
          <button id="btn-report">오늘 리포트</button>
        </div>
      </details>
      <div id="msg">영상은 저장되지 않습니다.</div>
      <div id="summary"></div>
    </>
  );
}
