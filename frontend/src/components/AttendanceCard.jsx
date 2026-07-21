// 출석 카드 — 이번 주 도장 + 연속 출석. 카메라를 시작하면 엔진이 자동 출석(+10P).
import { useEffect, useState } from "react";

const DAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"];
const dstr = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function readAttendance() {
  const days = new Set(JSON.parse(localStorage.getItem("pg_attend_days") || "[]"));
  const monday = new Date();
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  monday.setHours(0, 0, 0, 0);
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return { label: DAY_LABELS[i], date: dstr(d), isToday: dstr(d) === dstr(new Date()) };
  });
  // 연속 출석: 오늘(또는 어제)부터 거슬러 센다
  let streak = 0;
  const cur = new Date();
  if (!days.has(dstr(cur))) cur.setDate(cur.getDate() - 1);
  while (days.has(dstr(cur))) { streak++; cur.setDate(cur.getDate() - 1); }
  return { days, week, streak };
}

export default function AttendanceCard() {
  const [att, setAtt] = useState(readAttendance);
  useEffect(() => {
    const id = setInterval(() => setAtt(readAttendance()), 5000);
    return () => clearInterval(id);
  }, []);

  const todayDone = att.days.has(dstr(new Date()));
  return (
    <div className="card">
      <div className="att-head">
        <img className="att-ic" src="/assets/ui/attendance.png" alt="" aria-hidden="true" />
        <b>출석체크</b>
        <span className="hint">
          {todayDone ? `오늘 출석 완료 · ${att.streak}일 연속` : "카메라를 시작하면 출석 도장이 찍혀요 (+10P)"}
        </span>
      </div>
      <div className="att-week">
        {att.week.map((d) => (
          <div key={d.date} className={"att-day" + (d.isToday ? " today" : "")}>
            <span className="att-label">{d.label}</span>
            <span className="att-stamp">{att.days.has(d.date)
              ? <img className="att-stamp-img" src="/assets/ui/ui-stamp-flower.png" alt="출석" />
              : "·"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
