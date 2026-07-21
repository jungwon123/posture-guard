// 공부방 히어로 — 열품타식 '오늘 공부 시간'(자리 지키며 공부한 watched 시간, 라이브 틱).
// 상태(공부중/자리비움/꺼짐)·바른자세%·연속일을 한눈에. 데이터=엔진이 쌓는 pg_events + window.__pgLive.
import { useEffect, useState } from "react";
import { computeReport } from "../reward.js";

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

export default function StudyTimer() {
  const [, setTick] = useState(0);
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

  return (
    <section className="study-hero">
      <div className="sh-top">
        <span className="sh-label">오늘 공부 시간</span>
        <span className={"sh-status " + status.cls}>
          <i className="sh-dot" />{status.text}
        </span>
      </div>
      <div className="sh-time">{fmtClock(rep.watched)}</div>
      {sessionSec != null && (
        <div className="sh-session">▶ 이번 세션 <b>{fmtClock(sessionSec)}</b></div>
      )}
      <div className="sh-chips">
        <span className="sh-chip">바른자세 <b>{ratio != null ? ratio + "%" : "-"}</b></span>
        <span className="sh-chip">연속 <b>{streak}일</b></span>
      </div>
    </section>
  );
}
