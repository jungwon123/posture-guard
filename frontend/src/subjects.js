// 과목별 타이머 v1 (P0) — 자세 이벤트(pg_events)는 절대 건드리지 않고, 별도의 '과목 라벨 스트림'을 둔다.
// pg_subjects: 과목 사전(JSONB 동기화 대상) / pg_subj_log: 전환 로그(로컬, 2000건 캡) /
// pg_daily_subj: 일별 스냅샷(2000건 캡 유실 대비, 필드별 max 병합 — pg_daily와 동일 패턴).
// 계산은 computeSubjects가 자세 스트림과 과목 스트림을 시간순 머지해 (착석상태 × 과목) 교집합을 합산 —
// AWAY 구간은 자동으로 어느 과목에도 안 잡혀 "과목별 시간도 착석 기반"이 성립한다.

const LOG_CAP = 2000;
const jget = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };

// 기본 과목 — 저채도 팔레트(글로우·네온 금지 원칙)
export const DEFAULT_SUBJECTS = [
  { id: "kor", name: "국어", color: "#c96f5c" },
  { id: "math", name: "수학", color: "#5c85b8" },
  { id: "eng", name: "영어", color: "#7da865" },
];

export const readSubjects = () => {
  const s = jget("pg_subjects", null);
  return Array.isArray(s) && s.length ? s : DEFAULT_SUBJECTS;
};
export const saveSubjects = (list) => localStorage.setItem("pg_subjects", JSON.stringify(list));
export function addSubject(name) {
  const list = readSubjects();
  const palette = ["#b08947", "#8a6fb8", "#5ba8a0", "#b85c8a", "#6f7db8", "#a8985b"];
  const s = { id: "s" + Math.random().toString(36).slice(2, 8), name: name.slice(0, 8),
    color: palette[list.length % palette.length] };
  saveSubjects([...list, s]);
  return s;
}

export const readSubjLog = () => jget("pg_subj_log", []);
export function setCurrentSubject(id) { // id=null → 과목 해제('일반 공부')
  const log = readSubjLog();
  if ((log[log.length - 1]?.id ?? null) === id) return;
  log.push({ t: Math.floor(Date.now() / 1000), id });
  localStorage.setItem("pg_subj_log", JSON.stringify(log.slice(-LOG_CAP)));
}
export const currentSubjectId = () => readSubjLog().at(-1)?.id ?? null;

// (자세상태 × 과목) 교집합 합산 → { [subjectId]: { watched, good } }. id=null 구간은 "_none".
export function computeSubjects(events, subjLog, fromSec, toSec) {
  const acc = {};
  const add = (id, state, dur) => {
    if (dur <= 0 || !["GOOD", "CAUTION", "BAD"].includes(state)) return;
    const k = id ?? "_none";
    (acc[k] ??= { watched: 0, good: 0 }).watched += dur;
    if (state === "GOOD") acc[k].good += dur;
  };
  let ei = 0, si = 0;
  let state = null, subj = null;
  // fromSec 이전의 마지막 상태/과목을 초기값으로
  while (ei < events.length && events[ei].t <= fromSec) { state = events[ei].to; ei++; }
  while (si < subjLog.length && subjLog[si].t <= fromSec) { subj = subjLog[si].id ?? null; si++; }
  let cur = fromSec;
  while (cur < toSec) {
    const nextE = ei < events.length ? events[ei].t : Infinity;
    const nextS = si < subjLog.length ? subjLog[si].t : Infinity;
    const next = Math.min(nextE, nextS, toSec);
    add(subj, state, next - cur);
    if (next === Infinity) break;
    if (nextE === next && ei < events.length) { state = events[ei].to; ei++; }
    if (nextS === next && si < subjLog.length) { subj = subjLog[si].id ?? null; si++; }
    cur = next;
  }
  return acc;
}

// 일별 스냅샷 — 과목별 watched/good 을 필드별 max 병합(중복 호출·리로드 안전, pg_daily 패턴)
export function writeDailySubjSnapshot(dateStr, perSubj) {
  const all = jget("pg_daily_subj", {});
  const day = all[dateStr] || {};
  for (const [id, v] of Object.entries(perSubj)) {
    const prev = day[id] || { watched: 0, good: 0 };
    day[id] = { watched: Math.max(prev.watched, Math.round(v.watched)), good: Math.max(prev.good, Math.round(v.good)) };
  }
  all[dateStr] = day;
  localStorage.setItem("pg_daily_subj", JSON.stringify(all));
}
