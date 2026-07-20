// 알림 설정 — 방식·알림음·음량·진동 횟수. select 옵션은 엔진이 채운다.
export default function SettingsPanel() {
  return (
    <details id="settings">
      <summary>🔔 알림 설정</summary>
      <div className="row">
        <label>방식</label>
        <select id="set-mode" defaultValue="sound">
          <option value="sound">소리</option>
          <option value="vibrate">진동 (안드로이드만)</option>
          <option value="both">소리 + 진동</option>
          <option value="silent">무음 (배너만)</option>
        </select>
        <button id="btn-test">알림 테스트</button>
      </div>
      <div className="row">
        <label>알림음</label>
        <select id="set-melody"></select>
      </div>
      <div className="row">
        <label>음량</label>
        <input type="range" id="set-volume" min="0" max="100" defaultValue={70} />
        <label>진동 횟수</label>
        <select id="set-vibrate" defaultValue="2">
          <option value="1">1회</option>
          <option value="2">2회</option>
          <option value="3">3회</option>
        </select>
      </div>
    </details>
  );
}
