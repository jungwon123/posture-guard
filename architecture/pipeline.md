---
title: 전체 파이프라인 (레이어 구조)
domain: architecture
requires: []
related: []
status: stable
---

## 목적

`posture_guard.py`는 단일 파일이지만 내부는 한 방향으로 흐르는 5개 계층이다. 어떤 기능을 고칠 때 어느 계층만 만지면 되는지 판단하는 기준.

## 핵심 흐름

```
웹캠 프레임 (또는 --replay JSON)
  │  MediaPipe Pose (model_complexity=0)
  ▼
① 신호 계층: extract_signals + SignalSmoother(EMA)     → features/signals.md
  ▼  신호 4개 dict (전부 비율 정규화)
② 기준 계층: 캘리브레이션 profile (μ, σ)                → features/calibration.md
  ▼
③ 판정 계층: Judge.score — z-score·deadzone·가중 페널티 → features/scoring.md
  ▼  score 0~100 (또는 None=미검출)
④ 상태 계층: StateMachine — 히스테리시스+디바운스        → features/state-machine.md
  ▼  상태 전이 이벤트만
⑤ 출력 계층: 개입(HUD/벨/비네트) + EventLog(SQLite)     → features/intervention.md, features/event-log.md
```

## 설계 규칙

- **의존은 아래 방향으로만.** 상위 계층(신호)은 하위 계층(상태·기록)을 모른다.
- **시계 주입**: `StateMachine.update(score, now)`처럼 `now`를 인자로 받는다. 실시간·리플레이·테스트가 같은 코드를 돈다. 새 시간 의존 로직도 `time.time()` 직접 호출 금지.
- **튜닝 파라미터는 파일 상단 튜닝 블록이 SSoT.** 문서에 값을 복제하지 않는다.
- 프레임 원본은 어떤 계층에서도 저장·전송하지 않는다 (`architecture/privacy.md`).

## 경계 / 비목표

- 다중 사용자, 원격 전송, GUI 프레임워크는 다루지 않는다 (프로토타입 범위).
- MediaPipe 교체(Face Landmarker 등)는 ①계층 내부 교체로 격리 가능해야 한다.
