---
title: 이벤트 기록·통계
domain: feature
requires: [features/state-machine.md]
related: [architecture/privacy.md]
status: stable
---

## 목적

하루 동안 GOOD/BAD/AWAY에 각각 얼마나 있었는지 집계할 수 있는 최소 기록. **상태 전이만** SQLite에 남긴다 (ADR-0004). 코드: `EventLog`.

## 스키마와 흐름

```sql
posture_events(id, state TEXT, started_at REAL, ended_at REAL)
```

- 전이 발생 → 열려 있던 행의 `ended_at`을 닫고 새 행 INSERT (구간 인코딩)
- 종료 시 `__closed__` 센티널 행으로 마지막 구간을 닫음 (`close`)
- `summary_today(now)`: 오늘 0시 이후 구간을 상태별 합산 — 진행 중 구간은 `now`로 간주

## 주의

- `posture.db`는 개인 데이터 — 커밋 금지 (훅 차단 대상, `architecture/privacy.md`)
- 열린 구간(`ended_at IS NULL`)이 남는 것은 비정상 종료 흔적. 집계는 `COALESCE`로 방어하고 있음

## 경계 / 비목표

- 점수 시계열·신호 원본은 기록하지 않는다. 튜닝용 신호 기록은 별도 기능(`features/replay-tuning.md`)이며 사용자가 명시적으로 켠다.
- 리포트 UI는 비목표 (현재는 종료 시 콘솔 요약뿐).
