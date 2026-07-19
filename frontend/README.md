# 척추요정 — 프론트엔드 (Vite + React)

바닐라 버전(`../web/`)을 Vite + React로 옮긴 것. 배포 중인 현재 프론트.

## 실행

```bash
npm install
npm run dev      # 개발 서버 (http://localhost:5173)
npm run build    # 프로덕션 빌드 → dist/
npm run preview  # 빌드 결과 미리보기
```

## 배포 (Vercel)

```bash
npx vercel deploy --prod --yes   # 프로젝트 posture-guard, Vercel이 Vite 빌드
# → https://posture-guard-rust.vercel.app
```

## 구조 — "React 셸 + 명령형 엔진" 하이브리드

실시간 카메라·캔버스 앱이라, 감지 루프를 React로 억지로 감싸지 않고 분리했다.

```
src/
├─ main.jsx            React 진입점 (StrictMode 없음 — 엔진 1회 실행 보장)
├─ App.jsx             컴포넌트 조립 + useEffect에서 initApp() 1회 호출
├─ components/*.jsx     UI 셸 (Header, MainPanels, Controls, SettingsPanel,
│                       EyeCarePanel, GroupPanel, ShopPanel, ReportOverlay, InstallBanner)
├─ index.css           스타일 (원본 그대로)
├─ core.js             판정 코어 — 파이썬 레퍼런스와 패리티 유지 (수정 금지 without 패리티 테스트)
├─ reward.js           보상·알림설정 규칙
└─ app.js              엔진 계층 — 카메라·MediaPipe·판정·상태머신·알림·PiP·포인트·그룹·눈깜빡임
                       (옛 web/js/app.js를 initApp()으로 래핑, 로직 무변경)
```

- **React가 하는 일**: 정적 UI 구조 렌더링(같은 id/class), 컴포넌트 분리
- **엔진(app.js)이 하는 일**: 마운트 후 `initApp()`이 id로 요소를 잡아 카메라 루프·이벤트·캔버스 그리기 담당
- 이 분리 덕분에 판정 로직은 바닐라 버전과 100% 동일하고, UI만 컴포넌트로 구조화됨

## 참고

- 판정 코어 수정 시: `../web/test/parity.mjs`로 파이썬 레퍼런스와 일치 확인
- 백엔드 API 주소는 `src/app.js`의 `API_BASE` (GCP VM)
- 옛 바닐라 버전 `../web/`은 참고용으로 보존 (미배포)
