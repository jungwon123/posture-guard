// 오늘 리포트 모달 — 표·등급은 엔진이 채우고, 오버레이 열림은 id 클래스로 제어.
export default function ReportOverlay() {
  return (
    <div id="report-overlay">
      <div id="report-card">
        <h2>오늘 리포트</h2>
        <img
          id="report-fairy"
          style={{ width: "72px", height: "72px", imageRendering: "pixelated", display: "block", margin: "0 auto 10px" }}
        />
        <table id="report-table"></table>
        <div id="report-grade"></div>
        <div className="row" style={{ justifyContent: "flex-end", marginTop: "14px" }}>
          <button id="btn-report-close">닫기</button>
        </div>
      </div>
    </div>
  );
}
