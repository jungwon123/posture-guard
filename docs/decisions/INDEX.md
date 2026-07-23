# 의사결정 이력 (ADR)

> 프로토타입 코드의 docstring·주석에 적혀 있던 설계 결정을 ADR로 추출한 것 (2026-07-15).
> 이후 ADR은 사람이 작성한다 — 에이전트는 필요 시 **제안만** (CLAUDE.md 5.4).

| # | 제목 | 상태 |
|---|------|------|
| [0001](0001-pose-only-pitch-proxy.md) | 피치는 Pose 전용 프록시로 (Face Landmarker 제외) | accepted |
| [0002](0002-personal-baseline-zscore.md) | 비율 정규화 신호 + 개인 기준 z-score 판정 | accepted |
| [0003](0003-hysteresis-asymmetric-debounce.md) | 히스테리시스 + 비대칭 디바운스 상태 전이 | accepted |
| [0004](0004-transition-only-logging.md) | 상태 전이만 기록, 프레임은 저장·전송 안 함 | accepted |
| [0005](0005-clock-injection-replay.md) | 시계 주입으로 리플레이·테스트 가능하게 | accepted |
