# Posture Guard — 웹(PWA) 버전

파이썬 프로토타입(`../posture_guard.py`)의 웹 포팅. 빌드 도구 없음 — 정적 파일만으로 동작.

## 배포 (Vercel)

- **운영 URL**: https://posture-guard-rust.vercel.app (팀 공유용 — HTTPS라 모바일 카메라 동작)
- 재배포: `cd web && npx vercel deploy --prod --yes` (계정: jungwon123 / 프로젝트: posture-guard)

## 실행

```bash
python3 -m http.server 8137 -d web    # 프로젝트 루트에서
# → http://localhost:8137
```

카메라·알림은 localhost 또는 HTTPS에서만 동작한다 (브라우저 보안 정책).
배포는 정적 호스팅(GitHub Pages, Vercel 등)에 web/ 폴더를 올리면 끝.

## 구조

```
web/
├─ index.html        UI (2분할: 내 화면 / TRACKING + 설정·상점·리포트)
├─ js/core.js        판정 코어 — posture_guard.py 와 수치·로직 동일 (파이썬이 레퍼런스)
├─ js/reward.js      보상·알림설정 계층 (v2) — 포인트·출석·상점·척추요정·리포트 (docs/기능-v2.md가 SSoT)
├─ js/app.js         플랫폼 계층 — 카메라·MediaPipe·알림(멜로디/노래/진동)·PiP·localStorage
├─ assets/fairy/     척척요정 스프라이트 (아틀라스 + 상태별 GIF, 출처: ~/Downloads/cheokcheok-fairy/export)
├─ sw.js             앱 셸 캐시 (PWA)
├─ manifest.webmanifest
├─ test/parity.mjs   판정 패리티 테스트 (아래)
└─ test/rewards.test.mjs  보상 로직 단위 테스트 (node rewards.test.mjs)
```

- 감지 주기: 보일 때 10Hz / 백그라운드 1Hz (BAD는 20초 지속이 조건이라 충분)
- 미니 모드: 캔버스 → PiP(항상 위 작은 창). 데스크톱 Chrome/Safari 지원
- 저장: 기준값·상태 전이만 localStorage. **영상은 저장·전송되지 않음** (파이썬 버전과 동일 불변식)

## 패리티 테스트 (코어 수정 시 필수)

같은 녹화 JSON을 두 구현에 리플레이해서 상태 전이가 일치하는지 확인:

```bash
.venv/bin/python posture_guard.py --replay rec.json \
  | awk '/->/{t=$2; gsub(/s/,"",t); print t","$3","$5}' > expected.txt
node web/test/parity.mjs rec.json expected.txt   # → PARITY OK 확인
```

`js/core.js`의 튜닝 값을 바꾸면 `posture_guard.py` 상단 튜닝 블록도 함께 바꿔야 한다 (역도 동일).
