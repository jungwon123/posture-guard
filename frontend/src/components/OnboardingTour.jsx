// 첫 사용 온보딩 투어 — 로그인·닉네임 게이트 통과 후 기기당 1회(pg_onboard_done).
// 슬라이드 = HTML 타이틀(가독 크기) + 일러스트 크롭(assets/onboarding/art-N.webp).
// 스와이프/탭 진행 + [다음]/[시작하기] + 건너뛰기.
import { useEffect, useRef, useState } from "react";

const DONE_KEY = "pg_onboard_done";

const STEPS = [
  { art: "art-1", title: <>먼저 <em>카메라</em>를 켜고,<br />바른 자세를 <em>5초</em>만 유지해 줘!</> },
  { art: "art-2", title: <>이제 내가 <em>지켜볼게!</em><br />자세가 흐트러지면 바로 알려줄게.</> },
  { art: "art-3", title: <><em>친구들과 함께</em> 공부하고<br />서로 콕! 찔러 깨워줄 수 있어.</> },
  { art: "art-4", title: <>바른 자세를 유지하면<br /><em>포인트</em>와 <em>보상</em>을 받을 수 있어!</> },
];

export default function OnboardingTour() {
  const [open, setOpen] = useState(() => !localStorage.getItem(DONE_KEY));
  const [step, setStep] = useState(0);
  const [drag, setDrag] = useState(0); // 드래그 중 x 오프셋(px)
  const startX = useRef(null);

  // 설정 > 온보딩 다시 보기 — 완료 후에도 이벤트로 재오픈
  useEffect(() => {
    const show = () => { setStep(0); setOpen(true); };
    window.addEventListener("pg-show-onboarding", show);
    return () => window.removeEventListener("pg-show-onboarding", show);
  }, []);

  if (!open) return null;

  const finish = () => { localStorage.setItem(DONE_KEY, "1"); setOpen(false); };
  const next = () => (step >= STEPS.length - 1 ? finish() : setStep(step + 1));

  const onDown = (e) => {
    startX.current = e.clientX;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e) => { if (startX.current !== null) setDrag(e.clientX - startX.current); };
  const onUp = () => {
    if (startX.current === null) return;
    if (drag < -50 && step < STEPS.length - 1) setStep(step + 1);
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
          {STEPS.map((s, i) => (
            <div key={i} className="onboard-slide">
              <p className="onboard-title">{s.title}</p>
              <img className="onboard-art" src={`/assets/onboarding/${s.art}.webp`}
                alt="" draggable={false} />
            </div>
          ))}
        </div>
      </div>
      <div className="onboard-dots">
        {STEPS.map((_, i) => <i key={i} className={i === step ? "on" : ""} />)}
      </div>
      <button type="button" className="onboard-next" onClick={next}>
        {step >= STEPS.length - 1 ? "시작하기" : "다음"}
      </button>
    </div>
  );
}
