// 과목 칩 바 (P0) — 타이머 아래에서 현재 공부 과목을 전환한다. 칩 탭=전환, 같은 칩 재탭=해제(일반 공부),
// [+]=인라인 추가. 전환은 pg_subj_log에 append(자세 이벤트와 별도 스트림 — subjects.js가 SSoT).
import { useEffect, useState } from "react";
import { readSubjects, addSubject, setCurrentSubject, currentSubjectId } from "../subjects.js";

export default function SubjectChips() {
  const [subjects, setSubjects] = useState(readSubjects);
  const [cur, setCur] = useState(currentSubjectId);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");

  useEffect(() => {
    const id = setInterval(() => { setSubjects(readSubjects()); setCur(currentSubjectId()); }, 2000);
    return () => clearInterval(id);
  }, []);

  const tap = (id) => {
    const next = cur === id ? null : id;
    setCurrentSubject(next);
    setCur(next);
  };
  const submitAdd = () => {
    const n = name.trim();
    if (n) { addSubject(n); setSubjects(readSubjects()); }
    setName(""); setAdding(false);
  };

  return (
    <div className="subj-bar" role="group" aria-label="공부 과목 선택">
      {subjects.map((s) => (
        <button key={s.id} type="button"
          className={"subj-chip" + (cur === s.id ? " on" : "")}
          style={{ "--subj": s.color }}
          onClick={() => tap(s.id)}>
          <i className="subj-dot" />{s.name}
        </button>
      ))}
      {adding ? (
        <span className="subj-add-row">
          <input className="subj-add-input" autoFocus value={name} maxLength={8}
            placeholder="과목명" onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submitAdd(); if (e.key === "Escape") { setName(""); setAdding(false); } }}
            onBlur={submitAdd} />
        </span>
      ) : (
        <button type="button" className="subj-chip subj-add" onClick={() => setAdding(true)}
          title="과목 추가">+</button>
      )}
    </div>
  );
}
