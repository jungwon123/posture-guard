# 척추요정 (Posture Guard)

웹캠으로 공부 자세를 실시간 감지하고, 요정 캐릭터와 함께 공부 습관을 만드는 PWA.
자세 판정(MediaPipe 33포인트)은 **전부 사용자 기기 안에서** 실행되며 영상은 서버로 전송되지 않는다.

프로덕션: https://posture-guard-rust.vercel.app

## 구조

| 디렉터리 | 역할 | 배포 |
|---|---|---|
| `frontend/` | React + Vite PWA — 자세 감지·공부 타이머·통계·상점·함께 공부 | Vercel (push 자동) |
| `backend-vm/` | Node.js + Express API — 계정·기록 동기화·그룹·랭킹 | GCE VM1 도커 (push 자동) |
| `infra/` | VM1 스택 (nginx · api · redis) docker compose + 운영 런북 | — |
| `infra-lk/` | VM2 미디어 스택 (nginx · LiveKit SFU 셀프호스팅) | — |
| `docs/` | 발표 자료 · 임계값 선정(논문 3편) · 아키텍처 · 설계 기록(ADR) | — |
| `.github/workflows/` | CI(테스트+빌드) · 프론트/백엔드 자동 배포 | — |

## 아키텍처 (요약)

```
사용자 ── Vercel(React+MediaPipe, 기기 내 판정)
   │
   ├── VM1: nginx → Express API → Cloud SQL(PostgreSQL) / Redis(캐시·접속상태, 폴백 있음)
   └── VM2: nginx → LiveKit SFU (함께 공부 영상 중계)
```

두 VM은 직접 통신하지 않고 JWT 서명 키만 공유한다. 상세는 `docs/시스템-아키텍처.md`.

## 개발

```bash
cd frontend && npm install && npm run dev   # 프론트 (localhost:5173)
cd frontend && for f in test/*.mjs; do node "$f"; done   # 단위 테스트
```

배포는 `realtime-camera` 브랜치에 push하면 GitHub Actions가 테스트 → 빌드 → 배포까지 자동 수행한다.
