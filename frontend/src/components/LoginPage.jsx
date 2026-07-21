// 시작 화면(앱 로그인 게이트) — 숲 배경 위 미니멀 글래스 카드. 게스트 진입만.
export default function LoginPage({ onGuest }) {
  return (
    <div className="login-card-v2">
      <h2 className="login-title">척추요정</h2>
      <p className="login-tagline">함께 공부하고, 자세는 요정이 지켜줘요</p>
      <button type="button" className="login-primary" onClick={onGuest}>시작하기</button>
      <details className="login-more">
        <summary>이미 계정이 있나요? 로그인 (준비 중)</summary>
        <div className="login-form">
          <input type="text" placeholder="닉네임" maxLength={12} disabled />
          <input type="password" placeholder="비밀번호" disabled />
          <button type="button" disabled title="준비 중이에요">로그인 (준비 중)</button>
        </div>
      </details>
    </div>
  );
}
