// 닉네임 온보딩 — 가입/첫 구글 로그인 직후(auth.needsNickname) 그룹·랭킹에 보일 이름을 정한다.
// App의 .login-gate 오버레이 안에서 로그인 카드와 같은 글래스 카드(.login-card-v2)를 재사용.
import { useState } from "react";
import { getAuth, setAuth, clearAuth, wipeLocalData, apiSetNickname } from "../sync.js";

export default function OnboardingNickname() {
  const auth = getAuth();
  const [nickname, setNickname] = useState(auth?.nickname || "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    const nick = nickname.trim();
    if (nick.length < 2 || nick.length > 12) { setError("닉네임은 2~12자로 입력해 주세요"); return; }
    setError("");
    setBusy(true);
    try {
      const r = await apiSetNickname(auth.token, nick);
      setAuth(auth.token, r.nickname || nick); // needsNickname 미전달 = 온보딩 완료(키 제거)
      location.reload(); // 앱이 새 닉네임으로 다시 부팅
    } catch (err) {
      if (err?.status === 401) { clearAuth(); location.reload(); return; } // 토큰 무효 → 재로그인
      setError(err?.message || "닉네임을 저장하지 못했어요"); // 400 형식·409 중복 등 인라인 표시
      setBusy(false);
    }
  };

  // 다른 계정으로 — 로그아웃 + 이 기기의 개인 데이터 삭제(공용 기기 보호)
  const logout = () => { clearAuth(); wipeLocalData(); location.reload(); };

  return (
    <div className="login-card-v2">
      <h2 className="login-title">닉네임 정하기</h2>
      <p className="login-tagline">그룹·랭킹에서 친구들에게 보일 이름이에요 (2~12자)</p>
      <form className="login-form" onSubmit={submit}>
        <input type="text" placeholder="닉네임" maxLength={12} autoComplete="nickname" autoFocus
          value={nickname} onChange={(e) => setNickname(e.target.value)} />
        {error && <div className="login-error" role="alert">{error}</div>}
        <button type="submit" className="login-primary" disabled={busy}>
          {busy ? "확인 중…" : "시작하기"}
        </button>
        <button type="button" className="login-switch" disabled={busy} onClick={logout}>
          다른 계정으로 로그인
        </button>
      </form>
    </div>
  );
}
