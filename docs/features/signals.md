---
title: 신호 추출
domain: feature
requires: []
related: [architecture/pipeline.md]
status: stable
---

## 목적

MediaPipe Pose 랜드마크 5개(코·양귀·양어깨)에서 거북목 판정에 쓰는 신호 4개를 뽑는다. 코드: `extract_signals`, `SignalSmoother`.

## 신호 정의 (전부 비율 정규화 — ADR-0002)

| 키 | 계산 | 나쁜 방향 (`BAD_DIRECTION`) | 의미 |
|---|---|---|---|
| `proximity` | 귀 간 거리 | +1 (커지면 나쁨) | 머리가 카메라 쪽으로 나옴. **유일한 절대(비정규화) 신호** |
| `pitch` | (코y − 귀중점y) / 귀거리 | +1 | 고개 숙임 프록시 (ADR-0001) |
| `head_drop` | (어깨중점y − 코y) / 어깨폭 | −1 (작아지면 나쁨) | 목이 꺾여 머리가 어깨선으로 하강 |
| `shoulder_roll` | 어깨폭 / 귀거리 | −1 | 어깨 말림 또는 머리만 전방 돌출 |

## 핵심 흐름

1. 필수 랜드마크(NOSE, EAR_L/R, SH_L/R) 중 하나라도 `visibility < 0.5` → `None` 반환 (판정 건너뜀 → 상태 머신에서 AWAY 카운트)
2. 귀거리·어깨폭이 퇴화(≈0)해도 `None`
3. 신호 4개 계산 → `SignalSmoother`가 EMA(`EMA_ALPHA`) 스무딩

## 새 신호 추가 시 체크리스트

- 비율 정규화할 것 (해상도·카메라 거리 불변)
- `WEIGHTS`, `BAD_DIRECTION`에 등록 (`SIGNAL_KEYS`는 `WEIGHTS`에서 파생됨)
- 캘리브레이션 재수행 필요 — 기존 `posture_profile.json`과 키가 어긋나면 `Judge` 생성이 깨짐
- 이 문서의 표 갱신

## 경계 / 비목표

- 점수화·임계값은 여기서 다루지 않는다 (`features/scoring.md`).
- Face Landmarker 기반 정밀 피치는 비목표 (ADR-0001 참조).
