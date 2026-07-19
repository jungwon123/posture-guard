// 눈 깜빡임 챙기기 (베타) — 주기 샘플링 토글.
export default function EyeCarePanel() {
  return (
    <details id="eyecare">
      <summary>👁 눈 깜빡임 챙기기 (베타)</summary>
      <div className="row">
        <label style={{ minWidth: "auto" }}>
          <input type="checkbox" id="set-blink" /> 눈 깜빡임도 재기
        </label>
        <span className="hint" id="blink-status"></span>
      </div>
      <div className="hint">
        몇 분마다 잠깐씩(≈30초) 눈 깜빡임을 재서 분당 횟수를 알려줘요. 너무 적으면(눈 건조) 알림을
        보냅니다. 배터리 아끼려고 계속이 아니라 주기적으로만 잽니다.
      </div>
    </details>
  );
}
