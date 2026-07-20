// 메인 하단 — 오늘의 자세를 [차트]/[기록] 탭으로 따로 본다.
// 차트 탭 = 대시보드: ①시간별 정확도(꺾은선) ②최근 7일 공부시간(막대) ③오늘 자세 비율(도넛).
// 데이터: localStorage pg_events(상태 전이)를 30초마다 다시 읽는다.
import { useEffect, useState } from "react";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  BarChart, Bar, Cell, PieChart, Pie, ReferenceArea, LabelList,
} from "recharts";

const nowSec = () => Date.now() / 1000;
const dayStartSec = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() / 1000; };
function weekStartSec(offsetWeeks = 0) {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - offsetWeeks * 7);
  d.setHours(0, 0, 0, 0);
  return d.getTime() / 1000;
}
// n일 전 00:00 ~ +24h
function dayBounds(daysAgo) {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  const start = d.getTime() / 1000;
  return { start, end: start + 86400, date: d };
}
const WD = ["일", "월", "화", "수", "목", "금", "토"];
const fmtMin = (sec) => Math.round(sec / 60) + "분";

// 상태 색 (명예의 전당과 동일 팔레트). 좋음(초록)/보통(주황)은 색상만이 아니라
// 막대 위 정확도 %와 범례 아이콘으로도 구분한다(색 대비 강화 + 색맹 접근성, QC #20).
const C_GOOD = "#4fd07a", C_BAD = "#ff7a7a", C_AWAY = "#9aa6c9", C_EMPTY = "#3a4260";
const C_AMBER = "#f59e2b"; // 초록과 확실히 구분되게 더 진한 주황
const barColor = (acc, hasData) => (!hasData ? C_EMPTY : acc >= 70 ? C_GOOD : acc >= 40 ? C_AMBER : C_BAD);

// 구간 [start,end]의 GOOD/CAUTION/BAD 누적·비율·최장 GOOD. 공부시간=바름+주의+나쁨, 비율=바름/공부시간.
function aggregate(events, start, end, now) {
  let good = 0, caution = 0, bad = 0, longestGood = 0;
  for (let i = 0; i < events.length; i++) {
    const st = events[i].to;
    if (st !== "GOOD" && st !== "BAD" && st !== "CAUTION") continue;
    const s = Math.max(events[i].t, start);
    const e = Math.min(i + 1 < events.length ? events[i + 1].t : now, end);
    if (e <= s) continue;
    if (st === "GOOD") { good += e - s; longestGood = Math.max(longestGood, e - s); }
    else if (st === "CAUTION") caution += e - s;
    else bad += e - s;
  }
  const study = good + caution + bad;
  return { study, good, caution, bad, longestGood, ratio: study > 0 ? good / study : null };
}
// 구간의 상태별(GOOD/CAUTION/BAD/AWAY) 누적 초
function stateTotals(events, start, end, now) {
  const acc = { GOOD: 0, CAUTION: 0, BAD: 0, AWAY: 0 };
  for (let i = 0; i < events.length; i++) {
    const st = events[i].to;
    if (!(st in acc)) continue;
    const s = Math.max(events[i].t, start);
    const e = Math.min(i + 1 < events.length ? events[i + 1].t : now, end);
    if (e > s) acc[st] += e - s;
  }
  return acc;
}

function readData() {
  const events = JSON.parse(localStorage.getItem("pg_events") || "[]");
  const now = nowSec(), t0 = dayStartSec();

  // ① 시간별 정확도(꺾은선): 각 시간의 GOOD/(GOOD+BAD)
  const hours = Array.from({ length: 24 }, () => ({ good: 0, bad: 0 }));
  for (let i = 0; i < events.length; i++) {
    const st = events[i].to;
    if (st !== "GOOD" && st !== "BAD") continue;
    const s = Math.max(events[i].t, t0);
    const e = Math.min(i + 1 < events.length ? events[i + 1].t : now, now);
    for (let h = 0; h < 24; h++) {
      const ov = Math.min(e, t0 + (h + 1) * 3600) - Math.max(s, t0 + h * 3600);
      if (ov > 0) hours[h][st === "GOOD" ? "good" : "bad"] += ov;
    }
  }
  let minH = null, maxH = null;
  hours.forEach((h, i) => { if (h.good + h.bad > 0) { if (minH === null) minH = i; maxH = i; } });
  const series = [];
  if (minH !== null) for (let i = minH; i <= maxH; i++) {
    const tot = hours[i].good + hours[i].bad;
    series.push({ hour: i, label: `${i}시`, acc: tot > 0 ? Math.round((hours[i].good / tot) * 100) : null });
  }

  // ② 최근 7일 공부시간·정확도(막대)
  const daily = [];
  for (let k = 6; k >= 0; k--) {
    const { start, end, date } = dayBounds(k);
    const a = aggregate(events, start, Math.min(end, now), now);
    daily.push({
      label: WD[date.getDay()],
      date: `${date.getMonth() + 1}/${date.getDate()}`,
      min: Math.round(a.study / 60),
      acc: a.ratio != null ? Math.round(a.ratio * 100) : 0,
      hasData: a.study > 0,
      today: k === 0,
    });
  }
  const dailyHasData = daily.some((x) => x.hasData);

  // ③ 오늘 자세 비율(도넛)
  const st = stateTotals(events, t0, now, now);
  const breakdown = [
    { key: "GOOD", name: "바른 자세", value: st.GOOD, color: C_GOOD },
    { key: "CAUTION", name: "주의", value: st.CAUTION, color: C_AMBER },
    { key: "BAD", name: "나쁜 자세", value: st.BAD, color: C_BAD },
    { key: "AWAY", name: "자리 비움", value: st.AWAY, color: C_AWAY },
  ].filter((x) => x.value > 0);
  const breakdownTotal = st.GOOD + st.CAUTION + st.BAD + st.AWAY;

  const today = aggregate(events, t0, now, now);
  const thisWeek = aggregate(events, weekStartSec(0), now, now);
  const lastWeek = aggregate(events, weekStartSec(1), weekStartSec(0), now);

  // ⑤ 최근 28일 자세 정확도 추세 — 논문(JIIBC 2024)의 선형회귀 기울기 기법.
  // 하루 정확도(%)를 (경과일 x, 정확도 y)로 놓고 최소제곱 기울기 → '한 달간 교정되고 있나'.
  const trendPts = [];
  for (let k = 27; k >= 0; k--) {
    const { start, end } = dayBounds(k);
    const a = aggregate(events, start, Math.min(end, now), now);
    if (a.ratio != null && a.study > 60) trendPts.push({ x: 27 - k, y: a.ratio * 100 });
  }
  let trend = null;
  if (trendPts.length >= 4) {
    const n = trendPts.length;
    const mx = trendPts.reduce((s, p) => s + p.x, 0) / n;
    const my = trendPts.reduce((s, p) => s + p.y, 0) / n;
    let num = 0, den = 0;
    for (const p of trendPts) { num += (p.x - mx) * (p.y - my); den += (p.x - mx) ** 2; }
    const slope = den > 0 ? num / den : 0; // 하루당 %p
    trend = { slope, days: n, perWeek: slope * 7, avg: Math.round(my) };
  } else {
    trend = { slope: 0, days: trendPts.length, perWeek: 0, avg: null, insufficient: true };
  }

  // 오늘 상태 변화 로그(최근 15개)
  const L = { GOOD: "바른 자세 🟢", CAUTION: "주의 🟡", BAD: "나쁜 자세 🔴", AWAY: "자리 비움 ⚪" };
  const log = events.filter((ev) => ev.t >= t0 && ev.from && L[ev.to]).slice(-15).reverse()
    .map((ev) => ({ time: new Date(ev.t * 1000).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }), text: L[ev.to] }));

  // ④ 오늘 눈 깜빡임(분당) — pg_blink_log = [{t, rate}]
  let blinkLog = [];
  try { blinkLog = JSON.parse(localStorage.getItem("pg_blink_log") || "[]"); } catch {}
  const blink = blinkLog.filter((x) => x.t >= t0).map((x) => ({
    label: new Date(x.t * 1000).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }),
    rate: x.rate,
  }));
  const blinkAvg = blink.length ? Math.round(blink.reduce((a, b) => a + b.rate, 0) / blink.length) : null;

  return { series, daily, dailyHasData, breakdown, breakdownTotal, today, thisWeek, lastWeek, log, blink, blinkAvg, trend };
}

// 월간 추세 배너 — 기울기 부호로 격려/주의. 데이터 부족하면 안내만.
function TrendBanner({ trend }) {
  if (!trend || trend.insufficient) {
    return <div className="trend-banner flat">📈 며칠 더 기록하면 <b>한 달 자세 추세</b>를 보여줄게요 (최소 4일)</div>;
  }
  const pw = trend.perWeek;
  if (pw >= 2) return <div className="trend-banner up">📈 최근 {trend.days}일 <b>좋아지고 있어요 ↗</b> · 주당 +{Math.round(pw)}%p</div>;
  if (pw <= -2) return <div className="trend-banner down">📉 최근 {trend.days}일 <b>조금씩 나빠지고 있어요 ↘</b> · 자세에 신경 써봐요 (주당 {Math.round(pw)}%p)</div>;
  return <div className="trend-banner flat">📊 최근 {trend.days}일 <b>꾸준히 유지 중</b> · 평균 바름 {trend.avg}%</div>;
}

function Delta({ now, prev, unit, pct }) {
  if (prev == null || now == null) return <span className="delta flat">지난주 기록 없음</span>;
  const d = now - prev;
  const val = pct ? `${Math.abs(Math.round(d * 100))}%p` : `${Math.abs(Math.round(d))}${unit}`;
  if (Math.round(d * (pct ? 100 : 1)) === 0) return <span className="delta flat">지난주와 비슷</span>;
  return <span className={"delta " + (d > 0 ? "up" : "down")}>{d > 0 ? "▲" : "▼"} {val}</span>;
}

function AccTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return <div className="chart-tip">{p.label} · 정확도 <b>{p.acc}%</b></div>;
}
function DayTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return <div className="chart-tip">{p.date}({p.label}) · <b>{p.min}분</b>{p.hasData ? <> · 정확도 {p.acc}%</> : " · 기록 없음"}</div>;
}
function PieTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const pct = p._total > 0 ? Math.round((p.value / p._total) * 100) : 0;
  return <div className="chart-tip"><b style={{ color: p.color }}>{p.name}</b> · {fmtMin(p.value)} ({pct}%)</div>;
}
function BlinkTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return <div className="chart-tip">{p.label} · <b>{p.rate}회/분</b></div>;
}

export default function PostureChart() {
  const [tab, setTab] = useState("chart");
  const [d, setD] = useState(readData);
  useEffect(() => {
    const id = setInterval(() => setD(readData()), 30_000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => { setD(readData()); }, [tab]);

  const hasHourly = d.series.length > 0;
  const anyData = hasHourly || d.dailyHasData || d.breakdownTotal > 0 || d.blink.length > 0;
  const t = d.today;
  const blinkMax = Math.max(25, ...d.blink.map((x) => x.rate)); // 정상 20 + 여유
  const pieData = d.breakdown.map((x) => ({ ...x, _total: d.breakdownTotal }));
  // 막대 차트 Y축 도메인 명시 — auto 도메인 + ResponsiveContainer 초기 측정이 겹치면 막대 스케일이 축과 어긋난다.
  const dayMax = Math.max(30, ...d.daily.map((x) => x.min));
  const niceMax = Math.ceil(dayMax / 30) * 30;
  const goodPct = d.breakdownTotal > 0 ? Math.round(((d.breakdown.find((x) => x.key === "GOOD")?.value || 0) / d.breakdownTotal) * 100) : 0;

  return (
    <div className="card chart-card">
      <div className="seg-tabs">
        <button className={tab === "chart" ? "on" : ""} onClick={() => setTab("chart")}>차트</button>
        <button className={tab === "log" ? "on" : ""} onClick={() => setTab("log")}>기록</button>
      </div>

      {tab === "chart" && (
        !anyData ? (
          <p className="hint">아직 오늘 데이터가 없어요 — 카메라를 시작하면 자세 그래프가 여기 그려집니다.</p>
        ) : (
          <div className="charts">
            <TrendBanner trend={d.trend} />
            {/* ① 시간별 자세 정확도 */}
            {hasHourly && (
              <section className="chart-sub">
                <div className="chart-title">시간별 자세 정확도 추이</div>
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={d.series} margin={{ top: 8, right: 10, left: -18, bottom: 0 }}>
                    <defs>
                      <linearGradient id="accFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.45} />
                        <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: "var(--dim)", fontSize: 11 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                    <YAxis domain={[0, 100]} ticks={[0, 50, 100]} tick={{ fill: "var(--dim)", fontSize: 11 }} axisLine={false} tickLine={false} unit="%" width={44} />
                    <Tooltip content={<AccTip />} cursor={{ stroke: "var(--accent)", strokeOpacity: 0.3 }} />
                    <Area type="monotone" dataKey="acc" stroke="var(--accent)" strokeWidth={2.5}
                          fill="url(#accFill)" connectNulls dot={{ r: 2.5, fill: "var(--accent)" }}
                          activeDot={{ r: 5 }} isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
                <p className="hint">높을수록 바른 자세로 있었던 비율이에요. 오늘 공부한 시간대만 표시됩니다.</p>
              </section>
            )}

            {/* ② 최근 7일 공부시간 */}
            {d.dailyHasData && (
              <section className="chart-sub">
                <div className="chart-title">최근 7일 공부시간</div>
                <ResponsiveContainer width="100%" height={190}>
                  <BarChart data={d.daily} margin={{ top: 8, right: 10, left: -18, bottom: 0 }}>
                    <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: "var(--dim)", fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis domain={[0, niceMax]} tick={{ fill: "var(--dim)", fontSize: 11 }} axisLine={false} tickLine={false} unit="분" width={44} allowDecimals={false} />
                    <Tooltip content={<DayTip />} cursor={{ fill: "var(--accent)", fillOpacity: 0.08 }} />
                    <Bar dataKey="min" radius={[6, 6, 0, 0]} isAnimationActive={false}>
                      {d.daily.map((x, i) => (
                        <Cell key={i} fill={barColor(x.acc, x.hasData)} fillOpacity={x.today ? 1 : 0.82}
                              stroke={x.today ? "var(--accent)" : "none"} strokeWidth={x.today ? 2 : 0} />
                      ))}
                      {/* 색만이 아니라 숫자로도 정확도를 읽게 — 색맹 접근성 */}
                      <LabelList dataKey="acc" position="top" content={(p) => {
                        const x = d.daily[p.index];
                        if (!x || !x.hasData) return null;
                        return (
                          <text x={+p.x + (+p.width) / 2} y={+p.y - 5} fill="var(--dim)"
                                fontSize={10.5} fontWeight={700} textAnchor="middle">{x.acc}%</text>
                        );
                      }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <p className="hint">막대 위 숫자 = 그날 자세 정확도, 색으로도 표시(<b style={{ color: C_GOOD }}>■</b> 좋음 70%+ · <b style={{ color: C_AMBER }}>■</b> 보통 · <b style={{ color: C_BAD }}>■</b> 주의). 테두리 있는 막대가 오늘이에요.</p>
              </section>
            )}

            {/* ③ 오늘 자세 비율 */}
            {d.breakdownTotal > 0 && (
              <section className="chart-sub">
                <div className="chart-title">오늘 자세 비율</div>
                <div className="pie-wrap">
                  <ResponsiveContainer width="100%" height={190}>
                    <PieChart>
                      <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%"
                           innerRadius={52} outerRadius={78} paddingAngle={2} stroke="none" isAnimationActive={false}>
                        {pieData.map((x, i) => <Cell key={i} fill={x.color} />)}
                      </Pie>
                      <Tooltip content={<PieTip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pie-center"><b>{goodPct}%</b><span>바른 자세</span></div>
                </div>
                <div className="pie-legend">
                  {d.breakdown.map((x) => (
                    <span key={x.key}><i style={{ background: x.color }} />{x.name} {fmtMin(x.value)}</span>
                  ))}
                </div>
              </section>
            )}

            {/* ④ 오늘 눈 깜빡임 (분당) */}
            {d.blink.length > 0 && (
              <section className="chart-sub">
                <div className="chart-title">오늘 눈 깜빡임 (분당)</div>
                <ResponsiveContainer width="100%" height={190}>
                  <AreaChart data={d.blink} margin={{ top: 8, right: 10, left: -18, bottom: 0 }}>
                    <defs>
                      <linearGradient id="blinkFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#5ec8e0" stopOpacity={0.42} />
                        <stop offset="100%" stopColor="#5ec8e0" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: "var(--dim)", fontSize: 11 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                    <YAxis domain={[0, blinkMax]} tick={{ fill: "var(--dim)", fontSize: 11 }} axisLine={false} tickLine={false} unit="회" width={44} allowDecimals={false} />
                    <ReferenceArea y1={15} y2={20} fill="#6fe08a" fillOpacity={0.13} ifOverflow="extendDomain"
                                   label={{ value: "정상", fill: "var(--dim)", fontSize: 10, position: "insideTopRight" }} />
                    <Tooltip content={<BlinkTip />} cursor={{ stroke: "#5ec8e0", strokeOpacity: 0.3 }} />
                    <Area type="monotone" dataKey="rate" stroke="#5ec8e0" strokeWidth={2.5}
                          fill="url(#blinkFill)" connectNulls dot={{ r: 2.5, fill: "#5ec8e0" }}
                          activeDot={{ r: 5 }} isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
                <p className="hint">분당 15~20회가 정상이에요{d.blinkAvg != null ? ` · 오늘 평균 ${d.blinkAvg}회` : ""}. 낮으면 눈이 건조할 수 있어요 — 잠깐 먼 곳을 봐요.</p>
              </section>
            )}
          </div>
        )
      )}

      {tab === "log" && (
        t.study <= 0 ? (
          <p className="hint">아직 오늘 기록이 없어요.</p>
        ) : (
          <>
            <div className="stat-row">
              <div className="stat">
                <span className="stat-label">공부 시간</span>
                <span className="stat-num">{fmtMin(t.study)}</span>
                <Delta now={d.thisWeek.study / 60} prev={d.lastWeek.study === 0 ? null : d.lastWeek.study / 60} unit="분" />
              </div>
              <div className="stat">
                <span className="stat-label">바름 비율(평균)</span>
                <span className="stat-num accent">{Math.round((t.ratio ?? 0) * 100)}%</span>
                <Delta now={d.thisWeek.ratio} prev={d.lastWeek.ratio} pct />
              </div>
              <div className="stat">
                <span className="stat-label">최대 유지 시간</span>
                <span className="stat-num">{fmtMin(t.longestGood)}</span>
                <span className="delta flat">가장 오래 버틴 바른 자세</span>
              </div>
            </div>

            <div className="week-compare">
              <b>지난주와 비교</b> · 이번 주 공부 {fmtMin(d.thisWeek.study)}
              {d.lastWeek.study > 0 && <> (지난주 {fmtMin(d.lastWeek.study)})</>} ·
              평균 바름 {d.thisWeek.ratio != null ? Math.round(d.thisWeek.ratio * 100) : 0}%
              {d.lastWeek.ratio != null && <> (지난주 {Math.round(d.lastWeek.ratio * 100)}%)</>}
            </div>

            <ul className="log-list">
              {d.log.map((l, i) => (
                <li key={i}><span className="log-time">{l.time}</span> {l.text}</li>
              ))}
            </ul>
          </>
        )
      )}
    </div>
  );
}
