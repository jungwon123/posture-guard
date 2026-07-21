import { useEffect, useState } from "react";
import Header from "./components/Header.jsx";
import MainPanels from "./components/MainPanels.jsx";
import StudyTimer from "./components/StudyTimer.jsx";
import TogetherCta from "./components/TogetherCta.jsx";
import Controls from "./components/Controls.jsx";
import AttendanceCard from "./components/AttendanceCard.jsx";
import PostureChart from "./components/PostureChart.jsx";
import SettingsPanel from "./components/SettingsPanel.jsx";
import EyeCarePanel from "./components/EyeCarePanel.jsx";
import GroupPanel from "./components/GroupPanel.jsx";
import GroupGrid from "./components/GroupGrid.jsx";
import DressUpPage from "./components/DressUpPage.jsx";
import LoginPage from "./components/LoginPage.jsx";
import ReportOverlay from "./components/ReportOverlay.jsx";
import InstallBanner from "./components/InstallBanner.jsx";
import BottomNav from "./components/BottomNav.jsx";
import Buddy from "./components/Buddy.jsx";
import { initApp } from "./app.js";

// 페이지들은 전부 마운트한 채 표시만 전환한다 — 어느 탭에 있든 카메라 감지가 계속
// 돌아야 하고(상점 구경 중에도 감시), 엔진(initApp)이 id로 잡은 요소가 사라지면 안 되기 때문.
// 설정 패널(알림·눈깜빡임)은 엔진이 id로 배선하므로 '설정' 페이지로 옮겨도 마운트는 유지한다.
export default function App() {
  const [page, setPage] = useState("main");
  const [showStats, setShowStats] = useState(false);            // 통계 시트(차트·기록)
  const [entered, setEntered] = useState(() => localStorage.getItem("pg_entered") === "1"); // 로그인 게이트
  useEffect(() => { initApp(); }, []);
  const enter = () => { localStorage.setItem("pg_entered", "1"); setEntered(true); };
  const show = (id) => ({ display: page === id ? undefined : "none" });

  return (
    <>
      <div id="app-bg" aria-hidden="true" />
      <Header />

      <div className="page" style={show("main")}>
        <StudyTimer />
        <MainPanels />
        <Controls />
        <TogetherCta onGo={() => setPage("group")} />
        <AttendanceCard />
        <button id="fab-stats" title="차트·기록 보기" aria-label="통계 보기" onClick={() => setShowStats(true)}>📊 통계</button>
      </div>

      <div className="page" style={show("group")}>
        <GroupPanel />
        <GroupGrid />
      </div>

      <div className="page" style={show("dressup")}>
        <DressUpPage />
      </div>

      {/* 설정 페이지 — 하단 '설정' 탭. 출석·알림·눈깜빡임 설정을 여기로 모음 */}
      <div className="page" style={show("settings")}>
        <div className="page-title">설정</div>
        <AttendanceCard />
        <SettingsPanel />
        <EyeCarePanel />
      </div>

      {/* 통계 시트 — [통계] 버튼으로 열리는 차트·기록. 항상 마운트(display 토글)해 데이터 갱신 유지 */}
      <div id="stats-overlay" className={showStats ? "open" : ""} onClick={(e) => { if (e.target.id === "stats-overlay") setShowStats(false); }}>
        <div className="stats-sheet">
          <div className="stats-head">
            <b>통계</b>
            <button className="stats-close" onClick={() => setShowStats(false)} aria-label="닫기">✕</button>
          </div>
          <PostureChart />
        </div>
      </div>

      <ReportOverlay />
      <InstallBanner />
      <Buddy />
      <BottomNav page={page} onChange={setPage} />

      {/* 로그인 게이트 — 앱 시작 시 표시(게스트 진입까지). 뒤에서 앱은 이미 마운트돼 엔진이 돈다. */}
      {!entered && (
        <div className="login-gate">
          <LoginPage onGuest={enter} />
        </div>
      )}
    </>
  );
}
