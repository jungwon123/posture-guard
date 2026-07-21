// 시작 화면(앱 로그인 게이트) — 숲 배경 위 글래스 카드. HeroUI/Ant 톤: 깔끔한 라운드 카드 +
// 솔리드 프라이머리 버튼. 실제 인증은 백엔드 로드맵 ③(계정). 지금은 게스트 진입.
export default function LoginPage({ onGuest }) {
  return (
    <div className="login-card-v2">
      <img className="login-logo" src="/assets/ui/logo.png" alt="척추요정" />
      <h2 className="login-title">척추요정</h2>
      <p className="login-tagline">함께 공부하고, 자세는 요정이 지켜줘요</p>

      <div className="login-pillars">
        <span><b>👀</b>공부 감시</span>
        <span><b>🧚</b>자세 교정</span>
        <span><b>👥</b>함께 열품타</span>
      </div>

      <button type="button" className="login-primary" onClick={onGuest}>시작하기</button>
      <p className="login-note">로그인 없이 바로 쓸 수 있어요.<br />계정 기능이 열리면 기기를 바꿔도 기록이 이어져요.</p>

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
