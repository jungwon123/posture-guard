import { useEffect, useState } from "react";
import Header from "./components/Header.jsx";
import MainPanels from "./components/MainPanels.jsx";
import Controls from "./components/Controls.jsx";
import AttendanceCard from "./components/AttendanceCard.jsx";
import PostureChart from "./components/PostureChart.jsx";
import SettingsPanel from "./components/SettingsPanel.jsx";
import EyeCarePanel from "./components/EyeCarePanel.jsx";
import GroupPanel from "./components/GroupPanel.jsx";
import GroupGrid from "./components/GroupGrid.jsx";
import ShopPage from "./components/ShopPage.jsx";
import CharacterPage from "./components/CharacterPage.jsx";
import LoginPage from "./components/LoginPage.jsx";
import ReportOverlay from "./components/ReportOverlay.jsx";
import InstallBanner from "./components/InstallBanner.jsx";
import BottomNav from "./components/BottomNav.jsx";
import Buddy from "./components/Buddy.jsx";
import { initApp } from "./app.js";

// 페이지 5개는 전부 마운트한 채 표시만 전환한다 — 어느 탭에 있든 카메라 감지가 계속
// 돌아야 하고(상점 구경 중에도 감시), 엔진(initApp)이 id로 잡은 요소가 사라지면 안 되기 때문.
export default function App() {
  const [page, setPage] = useState("main");
  useEffect(() => { initApp(); }, []);
  const show = (id) => ({ display: page === id ? undefined : "none" });

  return (
    <>
      <div id="app-bg" aria-hidden="true" />
      <Header />

      <div className="page" style={show("main")}>
        <MainPanels />
        <Controls />
        <AttendanceCard />
        <PostureChart />
        <SettingsPanel />
        <EyeCarePanel />
      </div>

      <div className="page" style={show("group")}>
        <GroupPanel />
        <GroupGrid />
      </div>

      <div className="page" style={show("shop")}>
        <ShopPage />
      </div>

      <div className="page" style={show("character")}>
        <CharacterPage />
      </div>

      <div className="page" style={show("login")}>
        <LoginPage onGuest={() => setPage("main")} />
      </div>

      <ReportOverlay />
      <InstallBanner />
      <Buddy />
      <BottomNav page={page} onChange={setPage} />
    </>
  );
}
