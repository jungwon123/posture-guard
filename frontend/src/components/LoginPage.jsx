// 시작 화면(앱 로그인 게이트) — 숲 배경 위 미니멀 글래스 카드.
// 게스트 진입(시작하기) + 계정 로그인/회원가입(서버 동기화 — 포인트·요정·출석 백업/복원).
import { useEffect, useRef, useState } from "react";
import { apiLogin, apiRegister, apiGoogleLogin, setAuth, restoreData, GOOGLE_CLIENT_ID } from "../sync.js";

const GSI_SRC = "https://accounts.google.com/gsi/client";

export default function LoginPage({ onGuest }) {
  const [mode, setMode] = useState("login"); // login | register
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const googleRef = useRef(null); // GIS가 버튼을 그려 넣을 자리

  // 구글 로그인 — GOOGLE_CLIENT_ID가 설정된 경우에만 GIS 스크립트를 동적 로드해 버튼을 그린다.
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return; // 미설정: 버튼 자체가 안 뜸(콘솔 등록 후 켜지는 구조)
    let cancelled = false;
    let inFlight = false;

    // credential(JWT) 수신 → 기존 계정 로그인 성공 처리와 동일한 흐름
    const onCredential = async (resp) => {
      if (cancelled || inFlight || !resp?.credential) return;
      inFlight = true;
      setError("");
      setBusy(true);
      try {
        // 기존 익명 기기 ID를 계정에 연결(그룹 랭킹 기록 유지). 없으면 새로 발급.
        let memberId = localStorage.getItem("pg_member_id");
        if (!memberId) { memberId = crypto.randomUUID(); localStorage.setItem("pg_member_id", memberId); }
        const r = await apiGoogleLogin(resp.credential, memberId);
        setAuth(r.token, r.nickname);
        if (r.memberId) localStorage.setItem("pg_member_id", r.memberId); // 서버 ID 채택(기기 간 통일)
        if (r.data) restoreData(r.data); // 서버 백업을 로컬로 복원(포인트·요정·출석)
        localStorage.setItem("pg_entered", "1");
        location.reload(); // 엔진·React가 복원된 데이터로 다시 부팅
      } catch (err) {
        // 503 {configured:false} = 서버에 구글 키 미등록
        setError(err?.status === 503 ? "구글 로그인은 준비 중이에요" : (err?.message || "구글 로그인에 실패했어요"));
        inFlight = false;
        setBusy(false);
      }
    };

    const renderGoogleButton = () => {
      if (cancelled) return;
      try {
        const g = window.google?.accounts?.id;
        if (!g || !googleRef.current) throw new Error("gsi unavailable");
        g.initialize({ client_id: GOOGLE_CLIENT_ID, callback: onCredential });
        g.renderButton(googleRef.current, {
          theme: "outline", size: "large", width: 280, text: "continue_with", locale: "ko",
        });
      } catch {
        setError("구글 로그인 버튼을 불러오지 못했어요"); // CSP 차단·초기화 실패 등
      }
    };

    if (window.google?.accounts?.id) { renderGoogleButton(); return () => { cancelled = true; }; }
    let script = document.querySelector(`script[src="${GSI_SRC}"]`);
    if (!script) {
      script = document.createElement("script");
      script.src = GSI_SRC;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
    const onLoad = () => renderGoogleButton();
    const onErr = () => { if (!cancelled) setError("구글 로그인 스크립트를 불러오지 못했어요"); };
    script.addEventListener("load", onLoad);
    script.addEventListener("error", onErr);
    return () => {
      cancelled = true;
      script.removeEventListener("load", onLoad);
      script.removeEventListener("error", onErr);
    };
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    const nick = nickname.trim();
    if (!nick || !password) { setError("닉네임과 비밀번호를 입력해 주세요"); return; }
    setError("");
    setBusy(true);
    try {
      let r;
      if (mode === "register") {
        // 기존 익명 기기 ID를 계정에 연결(그룹 랭킹 기록 유지). 없으면 새로 발급.
        let memberId = localStorage.getItem("pg_member_id");
        if (!memberId) { memberId = crypto.randomUUID(); localStorage.setItem("pg_member_id", memberId); }
        r = await apiRegister(nick, password, memberId);
      } else {
        r = await apiLogin(nick, password);
        if (r.data) restoreData(r.data); // 서버 백업을 로컬로 복원(포인트·요정·출석)
      }
      setAuth(r.token, r.nickname || nick);
      if (r.memberId) localStorage.setItem("pg_member_id", r.memberId); // 서버 ID 채택(기기 간 통일)
      localStorage.setItem("pg_entered", "1");
      location.reload(); // 엔진·React가 복원된 데이터로 다시 부팅
    } catch (err) {
      setError(err.message); // 서버 error 메시지 그대로 (409 닉네임 중복, 401 불일치 등)
      setBusy(false);
    }
  };

  return (
    <div className="login-card-v2">
      <h2 className="login-title">척추요정</h2>
      <p className="login-tagline">함께 공부하고, 자세는 요정이 지켜줘요</p>
      <button type="button" className="login-primary" onClick={onGuest}>시작하기</button>
      <details className="login-more">
        <summary>{mode === "login" ? "계정으로 로그인 · 어느 기기서든 이어쓰기" : "새 계정 만들기"}</summary>
        <form className="login-form" onSubmit={submit}>
          <input type="text" placeholder="닉네임" maxLength={12} autoComplete="username"
            value={nickname} onChange={(e) => setNickname(e.target.value)} />
          <input type="password" placeholder="비밀번호" maxLength={64}
            autoComplete={mode === "register" ? "new-password" : "current-password"}
            value={password} onChange={(e) => setPassword(e.target.value)} />
          {error && <div className="login-error" role="alert">{error}</div>}
          <button type="submit" disabled={busy}>
            {busy ? "확인 중…" : mode === "login" ? "로그인" : "회원가입"}
          </button>
          <button type="button" className="login-switch" disabled={busy}
            onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>
            {mode === "login" ? "계정이 없나요? 회원가입" : "이미 계정이 있나요? 로그인"}
          </button>
          {GOOGLE_CLIENT_ID ? <div className="login-google" ref={googleRef}></div> : null}
        </form>
      </details>
    </div>
  );
}
