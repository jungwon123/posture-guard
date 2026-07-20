// 로그인 페이지 — 숲 히어로 + [시작하기] 버튼(게스트 진입). 실제 인증은 백엔드 로드맵 ③(계정).
export default function LoginPage({ onGuest }) {
  return (
    <div className="card login-card login-hero">
      <h2>척추요정과 함께 시작해요</h2>
      <p className="login-tagline">함께 공부하고, 자세는 요정이 지켜줘요</p>
      <div className="login-pillars">
        <span><b>👀</b>공부 감시</span>
        <span><b>🧚</b>자세 교정</span>
        <span><b>👥</b>함께 열품타</span>
      </div>
      <button type="button" className="login-start" onClick={onGuest} aria-label="시작하기">
        <img src="/assets/ui/start.png" alt="시작하기" />
      </button>
      <p className="hint">
        로그인 없이 바로 쓸 수 있어요. 계정 기능이 열리면 기기를 바꿔도 포인트·기록이 이어집니다.
      </p>

      <details className="login-more">
        <summary className="hint">로그인 (준비 중)</summary>
        <form onSubmit={(e) => { e.preventDefault(); onGuest(); }}>
          <div className="row">
            <input type="text" placeholder="닉네임" maxLength={12} style={{ flex: 1 }} disabled />
          </div>
          <div className="row">
            <input type="password" placeholder="비밀번호" style={{ flex: 1 }} disabled />
          </div>
          <div className="row">
            <button type="button" disabled title="준비 중이에요">로그인 (준비 중)</button>
          </div>
        </form>
      </details>
    </div>
  );
}
