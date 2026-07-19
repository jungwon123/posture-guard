---
title: 캘리브레이션 (개인 기준)
domain: feature
requires: [features/signals.md]
related: []
status: stable
---

## 목적

절대 임계값 대신 **개인별 바른 자세 기준(μ, σ)**을 잡는다. 사람마다 체형·카메라 각도가 달라 절대값 판정은 오탐이 심하다 (ADR-0002). 코드: `finish_calibration`, `Judge.__init__`의 σ 하한.

## 핵심 흐름

1. 사용자가 바르게 앉은 뒤 `c` → `CALIB_SECS`초 동안 스무딩된 신호 샘플 수집
2. 샘플 5개 이상이면 신호별 평균 μ·표준편차 σ 계산 → `posture_profile.json` 저장
3. `Judge`가 로드할 때 **σ 하한 적용**: `max(σ, |μ|·SIGMA_FLOOR_FRAC, 1e-6)` — 미동 없이 캘리브레이션하면 σ≈0이 되어 z-score가 폭발하는 것을 방지
4. 프로파일이 있으면 재실행 시 자동 로드 (재캘리브레이션은 언제든 `c`)

## 경계 / 비목표

- 다중 프로파일(여러 사용자/좌석)은 비목표. 환경이 바뀌면 재캘리브레이션이 정답.
- 캘리브레이션 중에는 판정하지 않는다 (메인 루프에서 `calib_until` 체크).

## 관련 결정

- `decisions/0002-personal-baseline-zscore.md`
