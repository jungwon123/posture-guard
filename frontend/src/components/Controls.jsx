// 조작 버튼 줄 + 상태 메시지/요약. onClick 핸들러는 엔진(app.js)이 id로 붙인다.
export default function Controls() {
  return (
    <>
      <div id="controls">
        <button id="btn-start" className="primary">카메라 시작</button>
        <button id="btn-calib" disabled title="가장 바른 자세로 앉아 5초간 유지하세요 — 이 자세가 '정답 기준'이 됩니다">바른자세 기준 등록 (5초)</button>
        <button id="btn-notify">알림 허용</button>
        <button id="btn-pip" disabled>미니 모드 (PiP)</button>
        <button id="btn-face">얼굴 가리기</button>
        <button id="btn-report">오늘 리포트</button>
      </div>
      <div id="msg">카메라 시작을 누르면 감지가 시작됩니다. 영상은 저장·전송되지 않습니다.</div>
      <div id="summary"></div>
    </>
  );
}
