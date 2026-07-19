// 그룹 페이지 — 내 그룹·생성/참여·포인트순 랭킹·멤버 실시간 상태·콕 찌르기.
// 목록 렌더와 콕 전송은 엔진(app.js)이 담당한다.
export default function GroupPanel() {
  return (
    <>
    <img className="page-banner sq" src="/assets/ui/group.png" alt="그룹" />
    <details id="group" open>
      <summary>👥 명예의 전당 (이번 주 · 바른 자세 시간순)</summary>
      <div className="row">
        <input type="text" id="group-name" placeholder="그룹 이름" maxLength={20} style={{ width: "130px" }} />
        <button id="btn-group-create" className="primary">그룹 생성하기</button>
      </div>
      <div className="row">
        <input type="text" id="group-code" placeholder="6자리 코드" maxLength={6} style={{ width: "110px" }} />
        <input type="text" id="group-nick" placeholder="닉네임" maxLength={12} style={{ width: "110px" }} />
        <button id="btn-group-join">참여하기</button>
      </div>
      <div id="group-info" className="hint"></div>
      <div id="leaderboard"></div>
      <p className="hint">
        친구가 <b>집중 이탈</b>(나쁜 자세)이면 <b>👉</b> 버튼으로 자세 펴라고 알림을 보낼 수 있어요 (1분에 한 번).
      </p>
    </details>
    </>
  );
}
