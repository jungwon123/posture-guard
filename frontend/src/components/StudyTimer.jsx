// 공부방 히어로 — 열품타식 '오늘 공부 시간'(자리 지키며 공부한 watched 시간, 라이브 틱).
// 상태(공부중/자리비움/꺼짐)·바른자세%·연속일 + 오늘 목표(시간+자세% 이중 목표) 게이지 + D-Day.
// 데이터=엔진이 쌓는 pg_events + window.__pgLive. 목표(pg_goal)는 JSONB 동기화, 달성 보상은
// 'pg-goal-achieved' 이벤트로 엔진(app.js)에 위임(1일 1회 pg_goal_award_last 가드).
import { useEffect, useState } from "react";
import { computeReport } from "../reward.js";

const GOAL_GOOD_PCT = 0.7; // 자세 목표 기본 70% (P0은 고정)
const readGoal = () => { try { return JSON.parse(localStorage.getItem("pg_goal") || "null"); } catch { return null; } };
const saveGoal = (g) => localStorage.setItem("pg_goal", JSON.stringify({ ...g, updatedAt: Date.now() }));
const ddayLeft = (date) => Math.ceil((new Date(date + "T00:00:00") - new Date().setHours(0, 0, 0, 0)) / 86400000);

const nowSec = () => Date.now() / 1000;
const dayStartSec = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() / 1000; };
const dstr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// H:MM:SS (열품타식 러닝 클록). 0:00:00 부터.
function fmtClock(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
function readStreak() {
  let days;
  try { days = new Set(JSON.parse(localStorage.getItem("pg_attend_days") || "[]")); } catch { days = new Set(); }
  const cur = new Date();
  if (!days.has(dstr(cur))) cur.setDate(cur.getDate() - 1);
  let n = 0;
  while (days.has(dstr(cur))) { n++; cur.setDate(cur.getDate() - 1); }
  return n;
}

// 숫자가 바뀌는 자리만 굴러 올라오는 롤링 디지트 — key에 값을 넣어 변경 시 리마운트→CSS 애니 재생.
// 반드시 모듈 스코프에 정의: 컴포넌트 안에서 정의하면 매 리렌더마다 새 타입이 돼
// 시계 전체가 리마운트되면서 안 바뀐 숫자까지 매초 애니메이션이 재생된다.
const RollingClock = ({ text }) => (
  <span className="sh-clock">
    {text.split("").map((ch, i) =>
      /\d/.test(ch)
        ? <span key={`${i}-${ch}`} className="sh-digit">{ch}</span>
        : <span key={`s${i}`} className="sh-sep">{ch}</span>)}
  </span>
);

export default function StudyTimer() {
  const [, setTick] = useState(0);
  const [editGoal, setEditGoal] = useState(false);
  useEffect(() => {
    const id = setInterval(() => setTick((x) => x + 1), 1000); // 1초마다 갱신 → 러닝 클록
    return () => clearInterval(id);
  }, []);

  let events = [];
  try { events = JSON.parse(localStorage.getItem("pg_events") || "[]"); } catch {}
  const rep = computeReport(events, dayStartSec(), nowSec());
  const live = (typeof window !== "undefined" && window.__pgLive) || {};
  // 이번 세션 공부시간 = 세션 시작 이후 watched(자리 지키며 공부). 종료하면 사라짐.
  const sessionSec = (live.running && live.sessionStart)
    ? computeReport(events, live.sessionStart, nowSec()).watched : null;
  const studying = !!live.running && (live.state === "GOOD" || live.state === "CAUTION" || live.state === "BAD");
  const away = !!live.running && live.state === "AWAY";
  const status = !live.running ? { cls: "off", text: "꺼짐" }
    : away ? { cls: "away", text: "⏸ 자리 비움" }
    : studying ? { cls: "on", text: "공부 중" }
    : { cls: "on", text: "준비" };
  const ratio = rep.ratio != null ? Math.round(rep.ratio * 100) : null;
  const streak = readStreak();

  // 오늘 목표(이중: 시간 + 자세%) — 달성 순간 1회 엔진에 보상 위임
  const goal = readGoal();
  const today = dstr(new Date());
  const goalPct = goal?.dailySec ? Math.min(1, rep.watched / goal.dailySec) : 0;
  const postureOk = rep.ratio == null || rep.ratio >= GOAL_GOOD_PCT; // 측정 전엔 미판정=통과 취급 안 함(아래 달성 조건에서 ratio 필요)
  const achieved = !!goal?.dailySec && rep.watched >= goal.dailySec && rep.ratio != null && rep.ratio >= GOAL_GOOD_PCT;
  if (achieved && localStorage.getItem("pg_goal_award_last") !== today) {
    localStorage.setItem("pg_goal_award_last", today);
    window.dispatchEvent(new Event("pg-goal-achieved"));
  }
  const dday = goal?.dday?.date ? ddayLeft(goal.dday.date) : null;

  const setPreset = (h) => { saveGoal({ ...(goal || {}), dailySec: h * 3600, goodPct: GOAL_GOOD_PCT }); setEditGoal(false); };
  const setDday = (label, date) => { saveGoal({ ...(goal || {}), dday: date ? { label, date } : null }); };

  return (
    <section className="study-hero">
      <div className="sh-top">
        <span className="sh-label">오늘 공부 시간
          {dday != null && dday >= 0 && (
            <span className="sh-dday">{goal.dday.label} D-{dday === 0 ? "DAY" : dday}</span>
          )}
        </span>
        <span className={"sh-status " + status.cls}>
          <i className="sh-dot" />{status.text}
        </span>
      </div>
      <div className="sh-time"><RollingClock text={fmtClock(rep.watched)} /></div>
      {sessionSec != null && (
        <div className="sh-session">▶ 이번 세션 <b><RollingClock text={fmtClock(sessionSec)} /></b></div>
      )}

      {/* 오늘 목표 게이지 — 채움색: 자세 70% 유지 중이면 accent, 무너지면 앰버. 탭=목표 편집 */}
      {goal?.dailySec && !editGoal ? (
        <button type="button" className="sh-goal" onClick={() => setEditGoal(true)}
          title="탭해서 목표 변경">
          <span className="sh-goal-bar">
            <i className={"sh-goal-fill" + (postureOk ? "" : " warn") + (achieved ? " done" : "")}
              style={{ width: `${Math.round(goalPct * 100)}%` }} />
          </span>
          <span className="sh-goal-text">
            {achieved ? "오늘 목표 달성!" : `목표 ${Math.round(goal.dailySec / 3600 * 10) / 10}시간 · ${Math.round(goalPct * 100)}%`}
          </span>
        </button>
      ) : (
        <div className="sh-goal-edit">
          <span className="sh-goal-label">{goal?.dailySec ? "목표 변경:" : "오늘 목표 정하기:"}</span>
          {[1, 2, 4, 6].map((h) => (
            <button key={h} type="button" className="sh-goal-preset" onClick={() => setPreset(h)}>{h}시간</button>
          ))}
          {editGoal && (
            <button type="button" className="sh-goal-preset sub" onClick={() => {
              const label = prompt("D-Day 이름 (예: 수능, 중간고사) — 비우면 해제", goal?.dday?.label || "수능");
              if (label === null) { setEditGoal(false); return; }
              if (!label.trim()) { setDday(null, null); setEditGoal(false); return; }
              const date = prompt("날짜 (YYYY-MM-DD)", goal?.dday?.date || "");
              if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) setDday(label.trim().slice(0, 8), date);
              setEditGoal(false);
            }}>D-Day</button>
          )}
        </div>
      )}

      <div className="sh-chips">
        <span className="sh-chip">바른자세 <b>{ratio != null ? ratio + "%" : "-"}</b></span>
        <span className="sh-chip">연속 <b>{streak}일</b></span>
      </div>
    </section>
  );
}
