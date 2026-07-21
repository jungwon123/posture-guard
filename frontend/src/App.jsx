import { useEffect, useState } from "react";
import Header from "./components/Header.jsx";
import MainPanels from "./components/MainPanels.jsx";
import StudyTimer from "./components/StudyTimer.jsx";
import TogetherCta from "./components/TogetherCta.jsx";
import Controls from "./components/Controls.jsx";
import AttendanceCard from "./components/AttendanceCard.jsx";
import PostureChart from "./components/PostureChart.jsx";
import CalendarCard from "./components/CalendarCard.jsx";
import { localDateStr, resetDailyOnServer } from "./sync.js";
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
import { getAuth, clearAuth } from "./sync.js";

// 계정 카드(설정 페이지) — 로그인 상태·동기화 안내 + 로그아웃/로그인 진입
function AccountCard({ onLogin }) {
  const auth = getAuth();
  const logout = () => { clearAuth(); location.reload(); };
  return (
    <div className="card account-card">
      {auth ? (
        <>
          <div className="account-info">
            <b>{auth.nickname}님</b>
            <span className="account-sub">동기화 중 · 포인트와 요정이 계정에 백업돼요</span>
          </div>
          <button type="button" onClick={logout}>로그아웃</button>
        </>
      ) : (
        <>
          <div className="account-info">
            <b>게스트로 사용 중</b>
            <span className="account-sub">로그인하면 포인트·요정을 어느 기기서든 이어써요</span>
          </div>
          <button type="button" className="primary" onClick={onLogin}>로그인</button>
        </>
      )}
    </div>
  );
}

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
        <button id="fab-stats" title="차트·기록 보기" aria-label="통계 보기" onClick={() => setShowStats(true)}>통계</button>
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
        <AccountCard onLogin={() => { localStorage.removeItem("pg_entered"); setEntered(false); }} />
        <AttendanceCard />
        <SettingsPanel />
        <EyeCarePanel />
        <FairyCard />
        <DataCard />
      </div>

      {/* 통계 시트 — [통계] 버튼으로 열리는 차트·기록. 항상 마운트(display 토글)해 데이터 갱신 유지 */}
      <div id="stats-overlay" className={showStats ? "open" : ""} onClick={(e) => { if (e.target.id === "stats-overlay") setShowStats(false); }}>
        <div className="stats-sheet">
          <div className="stats-head">
            <b>통계</b>
            <button className="stats-close" onClick={() => setShowStats(false)} aria-label="닫기">✕</button>
          </div>
          <PostureChart />
          <CalendarCard />
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

// 데이터 관리 — 오늘 공부 기록 초기화 (잘못 부풀어 기록된 날 복구용. 포인트·요정·출석은 유지)
function DataCard() {
  const resetToday = async () => {
    if (!confirm("오늘 공부 기록을 초기화할까요?\n(포인트·요정·출석은 그대로 유지됩니다)")) return;
    const d = new Date(); d.setHours(0, 0, 0, 0);
    const t0 = d.getTime() / 1000;
    let ev = [];
    try { ev = JSON.parse(localStorage.getItem("pg_events") || "[]").filter((e) => e.t < t0); } catch {}
    // 자정 이전에서 넘어온 열린 세그먼트가 오늘로 다시 새지 않게 자정에 AWAY로 봉인
    const last = ev[ev.length - 1];
    if (last && last.to !== "AWAY") ev.push({ t: t0, from: last.to, to: "AWAY" });
    localStorage.setItem("pg_events", JSON.stringify(ev));
    try {
      const daily = JSON.parse(localStorage.getItem("pg_daily") || "{}");
      delete daily[localDateStr()];
      localStorage.setItem("pg_daily", JSON.stringify(daily));
    } catch {}
    await resetDailyOnServer(localDateStr()); // 로그인 상태면 서버 캘린더 기록도 0으로
    location.reload();
  };
  return (
    <div className="card">
      <h2>데이터 관리</h2>
      <p className="hint">공부 시간이 실제와 다르게 기록됐다면 오늘 기록만 초기화할 수 있어요. 포인트·요정·출석은 유지됩니다.</p>
      <button type="button" onClick={resetToday}>오늘 공부 기록 초기화</button>
    </div>
  );
}

// 요정 도우미 — 숨긴 요정 복구 + 드래그로 고정한 위치 풀기
function FairyCard() {
  const [off, setOff] = useState(() => localStorage.getItem("pg_buddy_off") === "1");
  const [pinned, setPinned] = useState(() => !!localStorage.getItem("pg_buddy_pos"));
  // 요정 쪽(X 버튼·드래그)에서 바뀐 상태를 따라감
  useEffect(() => {
    const id = setInterval(() => {
      setOff(localStorage.getItem("pg_buddy_off") === "1");
      setPinned(!!localStorage.getItem("pg_buddy_pos"));
    }, 1000);
    return () => clearInterval(id);
  }, []);
  const toggle = () => {
    if (off) localStorage.removeItem("pg_buddy_off");
    else localStorage.setItem("pg_buddy_off", "1");
    setOff(!off);
  };
  const resetPos = () => { localStorage.removeItem("pg_buddy_pos"); setPinned(false); };
  return (
    <div className="card">
      <h2>요정 도우미</h2>
      <p className="hint">
        {off
          ? "요정이 숨어 있어요. 다시 부르면 화면을 돌아다니며 자세를 봐줘요."
          : "화면 속 요정을 끌어서 원하는 자리에 둘 수 있어요. 요정의 X 버튼으로 숨길 수 있어요."}
      </p>
      <div className="row" style={{ display: "flex", gap: 8 }}>
        <button type="button" onClick={toggle}>{off ? "요정 다시 부르기" : "요정 숨기기"}</button>
        {!off && pinned && <button type="button" onClick={resetPos}>위치 초기화</button>}
      </div>
    </div>
  );
}
