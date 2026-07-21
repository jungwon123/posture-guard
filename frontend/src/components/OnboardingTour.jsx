// 첫 사용 온보딩 투어 — 로그인·닉네임 게이트 통과 후 기기당 1회(pg_onboard_done).
// 카드 4장(assets/onboarding/step-N.webp, 페이지 점은 이미지에 포함) 스와이프 + [다음]/[시작하기] + 건너뛰기.
// 카드 탭도 다음으로 진행(마지막 카드의 그림 속 CTA를 눌러도 동작하게).
import { useRef, useState } from "react";

const N_STEPS = 4;
const DONE_KEY = "pg_onboard_done";

export default function OnboardingTour() {
  const [open, setOpen] = useState(() => !localStorage.getItem(DONE_KEY));
  const [step, setStep] = useState(0);
  const [drag, setDrag] = useState(0); // 드래그 중 x 오프셋(px)
  const startX = useRef(null);

  if (!open) return null;

  const finish = () => { localStorage.setItem(DONE_KEY, "1"); setOpen(false); };
  const next = () => (step >= N_STEPS - 1 ? finish() : setStep(step + 1));

  const onDown = (e) => {
    startX.current = e.clientX;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e) => { if (startX.current !== null) setDrag(e.clientX - startX.current); };
  const onUp = () => {
    if (startX.current === null) return;
    if (drag < -50 && step < N_STEPS - 1) setStep(step + 1);
    else if (drag > 50 && step > 0) setStep(step - 1);
    else if (Math.abs(drag) < 8) next(); // 탭 = 다음
    startX.current = null;
    setDrag(0);
  };

  return (
    <div className="onboard-gate">
      <button type="button" className="onboard-skip" onClick={finish}>건너뛰기</button>
      <div className="onboard-frame"
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <div className="onboard-track"
          style={{
            transform: `translateX(calc(${-step * 100}% + ${drag}px))`,
            transition: startX.current !== null ? "none" : "transform .28s ease",
          }}>
          {Array.from({ length: N_STEPS }, (_, i) => (
            <img key={i} className="onboard-card" src={`/assets/onboarding/step-${i + 1}.webp`}
              alt={`온보딩 ${i + 1}단계`} draggable={false} />
          ))}
        </div>
      </div>
      <button type="button" className="onboard-next" onClick={next}>
        {step >= N_STEPS - 1 ? "시작하기" : "다음"}
      </button>
    </div>
  );
}
