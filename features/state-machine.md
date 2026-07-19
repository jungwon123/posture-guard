---
title: 상태 머신
domain: feature
requires: []
related: [features/scoring.md]
status: stable
---

## 목적

순간 점수의 출렁임을 사용자에게 노출하지 않고, "의미 있는 자세 상태"로만 전이한다. 코드: `StateMachine`.

## 상태와 전이

입력은 `update(score, now)` — score는 0~100 또는 `None`(미검출). **`now`는 주입** (ADR-0005).

```
UNCALIBRATED ──(캘리브레이션 완료)──▶ GOOD
GOOD ──(score < BAD_ENTER_SCORE 가 BAD_ENTER_SUSTAIN 지속)──▶ BAD
BAD ──(score > GOOD_ENTER_SCORE 가 GOOD_ENTER_SUSTAIN 지속)──▶ GOOD
GOOD/BAD ──(미검출 AWAY_AFTER 지속)──▶ AWAY
AWAY ──(재검출 즉시)──▶ GOOD   ← 판정은 다음 프레임부터
```

## 설계 포인트 (ADR-0003)

- **히스테리시스**: 진입 60 / 복귀 75가 다르다 → 경계 점수에서 상태 핑퐁 방지
- **비대칭 디바운스**: BAD 진입은 길게(20s — 잠깐 숙인 건 무시), GOOD 복귀는 짧게(5s — 교정하면 빨리 보상)
- **후보 리셋**: 조건이 끊기면 `cand=None`으로 타이머 리셋 — 지속 시간은 연속이어야 함
- 값들은 `posture_guard.py` 튜닝 블록 참조 (테스트 시 `BAD_ENTER_SUSTAIN=8.0` 권장)

## 경계 / 비목표

- 전이 시 무엇을 할지(알림·기록)는 모른다. 소비자는 `features/intervention.md`, `features/event-log.md`.
