---
title: 녹화·리플레이 튜닝
domain: feature
requires: []
related: [features/scoring.md, features/state-machine.md]
status: stable
---

## 목적

임계값·가중치 튜닝을 "웹캠 앞에서 자세 잡고 20초 기다리기" 없이 반복한다. 신호를 한 번 녹화해두면 판정·상태 로직을 오프라인으로 몇 번이고 다시 돌릴 수 있다. 코드: `replay`, 메인 루프의 `r` 키 처리.

## 핵심 흐름

1. 실행 중 `r` → 프레임마다 `{t, sig}` 축적, 다시 `r` → `posture_rec_<ts>.json` 저장 (당시 profile 포함)
2. `python posture_guard.py --replay posture_rec_*.json` → Judge+StateMachine만 재구동, 전이 타임라인 출력
3. 튜닝 블록 수정 → 2번 반복. 기대 전이가 나올 때까지.

이게 가능한 이유: `StateMachine.update(score, now)`가 시계를 주입받기 때문 (ADR-0005). 벽시계에 묶인 로직이 없다.

## 튜닝 가이드 (증상 → 파라미터)

| 증상 | 1순위로 볼 것 |
|---|---|
| 평상시 오탐 (가만히 있어도 BAD) | `DEADZONE_Z` ↑, `SIGMA_FLOOR_FRAC` 확인 |
| 잠깐 숙였는데 BAD | `BAD_ENTER_SUSTAIN` ↑ |
| 명백한 거북목인데 안 잡힘 | `WEIGHTS` (특히 proximity/pitch), `BAD_ENTER_SCORE` |
| BAD에서 안 돌아옴 | `GOOD_ENTER_SCORE` ↓ 또는 재캘리브레이션 |

## 주의

- 녹화 JSON에는 profile(개인 기준)이 포함됨 — 커밋 금지 (훅 차단 대상)
- 리플레이는 `sig=None` 프레임도 재생하므로 AWAY 전이 튜닝에도 사용 가능
