// 첫 사용 온보딩 투어 — 로그인·닉네임 게이트 통과 후 기기당 1회(pg_onboard_done).
// 슬라이드 = 소프트-3D 클레이 아이콘(assets/onboarding/icon-N.webp, 네비 아이콘과 동일 스타일)
//          + 타이포 타이틀/설명. 스와이프/탭 진행 + [다음]/[시작하기] + 건너뛰기.
// 설정 > 도움말의 '온보딩 다시 보기'가 pg-show-onboarding 이벤트로 재오픈한다.
import { useEffect, useRef, useState } from "react";

const DONE_KEY = "pg_onboard_done";

const STEPS = [
  {
    icon: "icon-1",
    title: <><em>카메라</em>를 켜고<br />바른 자세를 등록해요</>,
    desc: "평소 공부하는 자세로 5초만 유지하면 돼요. 영상은 어디에도 저장되지 않아요.",
  },
  {
    icon: "icon-2",
    title: <>자세가 무너지면<br /><em>요정이 바로 알려줘요</em></>,
    desc: "거북목과 기운 어깨를 지켜보다가, 무너진 순간에만 알려요.",
  },
  {
    icon: "icon-3",
    title: <><em>친구들과 함께</em><br />공부할 수 있어요</>,
    desc: "실시간 그리드에서 같이 공부하고, 조는 친구는 콕 찔러 깨워요.",
  },
  {
    icon: "icon-4",
    title: <>바른 자세로<br /><em>포인트</em>를 모아요</>,
    desc: "포인트로 요정을 꾸미고, 친구들과 랭킹도 겨뤄요.",
  },
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
            transition: startX.current !== null ? "none" : "transform .3s cubic-bezier(.22,.9,.36,1)",
          }}>
          {STEPS.map((s, i) => (
            <div key={i} className={`onboard-slide${i === step ? " active" : ""}`}>
              <img className="onboard-icon" src={`/assets/onboarding/${s.icon}.webp`}
                alt="" draggable={false} />
              <p className="onboard-title">{s.title}</p>
              <p className="onboard-desc">{s.desc}</p>
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
