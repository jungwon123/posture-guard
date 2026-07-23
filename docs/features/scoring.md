---
title: 판정 (점수화)
domain: feature
requires: [features/signals.md]
related: [features/calibration.md]
status: stable
---

## 목적

신호 4개를 개인 기준 대비 0~100 점수 하나로 접는다. 코드: `Judge.score`.

## 핵심 흐름

```
신호별: z = (값 − μ) / σ × BAD_DIRECTION[k]     ← 나쁜 방향만 양수가 되게 부호 정렬
       penalty += WEIGHTS[k] × max(0, z − DEADZONE_Z)   ← 데드존 이하 흔들림은 무시
score = 100 × exp(−penalty / SCORE_K)
```

- **한 방향 페널티**: 기준보다 "좋은" 쪽 편차는 점수에 영향 없음 (max(0, ·))
- **데드존** `DEADZONE_Z`: 평상시 미세 움직임 흡수. 오탐이 많으면 1순위로 올리는 값
- **가중치** `WEIGHTS`: proximity > pitch > head_drop > shoulder_roll 순. 합 1.0 유지 권장
- 지수 감쇠라 페널티가 누적될수록 점수가 급락 — 임계값 60/75와 조합되어 동작 (상태 판단은 `features/state-machine.md`)

## 튜닝 시 주의

- 값 자체는 `posture_guard.py` 상단 튜닝 블록이 SSoT. 여기 복제 금지.
- 가중치·데드존 변경 후에는 반드시 녹화 리플레이로 회귀 확인 (`features/replay-tuning.md`).

## 경계 / 비목표

- 시간 요소(지속·디바운스)는 없음 — 순수하게 "이 순간의 자세"만. 시간은 상태 머신 담당.
