// 그룹 페이지 — 방 목록(내 그룹)·랭킹 위주로 단순화. 생성/참여 폼은 접이식(app.js가 그룹 유무로 자동 펼침/접힘).
export default function GroupPanel() {
  return (
    <>
    <img className="page-banner sq" src="/assets/ui/group.png" alt="그룹" />
    <details id="group" open>
      <summary>우리 그룹</summary>

      {/* 내가 속한 방 목록 (app.js가 렌더) */}
      <div id="group-switcher" className="group-switcher"></div>

      {/* 그룹 만들기 · 코드로 참여 (접이식) */}
      <details id="group-add" className="group-add">
        <summary>그룹 만들기 · 코드로 참여</summary>
        <div className="row">
          <input type="text" id="group-name" placeholder="새 그룹 이름" maxLength={20} style={{ flex: 1, minWidth: 0 }} />
          <button id="btn-group-create" className="primary">만들기</button>
        </div>
        <div className="row">
          <input type="text" id="group-code" placeholder="6자리 코드" maxLength={6} style={{ width: "104px" }} />
          <input type="text" id="group-nick" placeholder="닉네임" maxLength={12} style={{ flex: 1, minWidth: 0 }} />
          <button id="btn-group-join">참여</button>
        </div>
        <p className="hint">여러 그룹에 동시에 들어갈 수 있어요 (예: 우리 반 + 스터디).</p>
      </details>

      <div id="group-info" className="hint"></div>
      <div id="leaderboard"></div>
    </details>
    </>
  );
}
