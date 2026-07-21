// 월별 공부 캘린더 — pg_daily(일별 집계, sync.js) 기반. 로그인 시 서버 기록을 월 단위로 내려받아 병합.
// 셀 농도 = 그날 공부(감시) 시간. 날짜를 누르면 아래에 일별 상세.
import { useEffect, useMemo, useState } from "react";
import { readDaily, pullDailyRange, localDateStr } from "../sync.js";

const fmtShort = (sec) => {
  if (!sec) return "";
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  return `${(sec / 3600).toFixed(sec < 10 * 3600 ? 1 : 0)}h`;
};
const fmtLong = (sec) => {
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return h ? `${h}시간 ${m}분` : `${m}분`;
};
const pad = (n) => String(n).padStart(2, "0");
const keyOf = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;

export default function CalendarCard() {
  const today = localDateStr();
  const [ym, setYm] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const [data, setData] = useState(readDaily);
  const [sel, setSel] = useState(today);

  // 월 진입 시 서버 기록 내려받아 병합 + 오늘 셀 최신화용 주기 리프레시
  useEffect(() => {
    const first = keyOf(ym.y, ym.m, 1);
    const last = keyOf(ym.y, ym.m, new Date(ym.y, ym.m + 1, 0).getDate());
    let alive = true;
    pullDailyRange(first, last).then((all) => { if (alive) setData({ ...all }); });
    const iv = setInterval(() => setData({ ...readDaily() }), 60_000);
    return () => { alive = false; clearInterval(iv); };
  }, [ym.y, ym.m]);

  const nDays = new Date(ym.y, ym.m + 1, 0).getDate();
  const lead = new Date(ym.y, ym.m, 1).getDay(); // 0=일
  const now = new Date();
  const isThisMonth = ym.y === now.getFullYear() && ym.m === now.getMonth();

  const monthTotal = useMemo(() => {
    let t = 0;
    for (let d = 1; d <= nDays; d++) t += data[keyOf(ym.y, ym.m, d)]?.watched || 0;
    return t;
  }, [data, ym.y, ym.m, nDays]);

  const move = (delta) => {
    const d = new Date(ym.y, ym.m + delta, 1);
    setYm({ y: d.getFullYear(), m: d.getMonth() });
  };

  const rec = sel ? data[sel] : null;
  const ratio = rec && rec.watched > 0 ? Math.round((rec.good / rec.watched) * 100) : null;

  return (
    <div className="card cal-card">
      <div className="cal-head">
        <button type="button" className="cal-nav" onClick={() => move(-1)} aria-label="이전 달">‹</button>
        <div className="cal-title">
          {ym.y}년 {ym.m + 1}월
          {monthTotal > 0 && <span className="cal-total">이번 달 공부 {fmtLong(monthTotal)}</span>}
        </div>
        <button type="button" className="cal-nav" onClick={() => move(1)} disabled={isThisMonth} aria-label="다음 달">›</button>
      </div>

      <div className="cal-grid cal-week">
        {["일", "월", "화", "수", "목", "금", "토"].map((w) => <div key={w} className="cal-wd">{w}</div>)}
      </div>
      <div className="cal-grid">
        {Array.from({ length: lead }).map((_, i) => <div key={`b${i}`} />)}
        {Array.from({ length: nDays }).map((_, i) => {
          const d = i + 1, key = keyOf(ym.y, ym.m, d);
          const r = data[key];
          const level = r?.watched ? Math.min(1, r.watched / (4 * 3600)) : 0; // 4시간이면 최고 농도
          const future = key > today;
          return (
            <button type="button" key={key} disabled={future}
              className={`cal-day${key === sel ? " sel" : ""}${key === today ? " today" : ""}`}
              style={level ? { background: `color-mix(in srgb, var(--accent) ${Math.round(10 + level * 55)}%, var(--panel))` } : undefined}
              onClick={() => setSel(key)}>
              <span className="cal-num">{d}</span>
              <span className="cal-min">{fmtShort(r?.watched)}</span>
            </button>
          );
        })}
      </div>

      <div className="cal-detail">
        <div className="cal-detail-title">{sel.replaceAll("-", ".")}{sel === today ? " · 오늘" : ""}</div>
        {rec && rec.watched > 0 ? (
          <div className="cal-rows">
            <div className="cal-row"><span>공부 시간</span><b>{fmtLong(rec.watched)}</b></div>
            <div className="cal-row"><span>바른 자세</span><b>{fmtLong(rec.good)}{ratio !== null ? ` (${ratio}%)` : ""}</b></div>
            {rec.caution > 0 && <div className="cal-row"><span>주의</span><b>{fmtLong(rec.caution)}</b></div>}
            <div className="cal-row"><span>거북목 위험</span><b>{fmtLong(rec.bad)} · {rec.badCount}회</b></div>
            <div className="cal-row"><span>최장 연속 바른자세</span><b>{fmtLong(rec.longestGood)}</b></div>
          </div>
        ) : (
          <p className="hint">이날은 공부 기록이 없어요.</p>
        )}
      </div>
    </div>
  );
}
