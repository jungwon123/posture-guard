# CLAUDE.md

> 이 파일은 **진입점(entry point)**이자 **라우팅 테이블**입니다.
> 모든 기능 문서를 한 번에 펼치지 않습니다. 작업 맥락에 맞는 문서만 필요할 때 `Read`하세요.
> 원칙: **관련된 최소한만 컨텍스트에 넣는다.** 도달 가능한 전부가 아니라.

---

## 0. 읽기 규칙 (가장 먼저 적용)

1. **이 파일 전체를 먼저 훑되, 하위 md는 펼치지 마세요.** 라우팅 테이블로 "어떤 작업에 어떤 문서가 필요한지"만 파악합니다.
2. 작업이 정해지면 해당 행의 **`주 문서`만** 먼저 읽습니다. (= depth 0)
3. 주 문서의 **`requires:`(hard 의존)**를 읽습니다. (= depth 1)
   - 그 문서가 또 `requires:`를 가지면 **depth 2까지만** 따라갑니다.
   - **depth 2에서 멈춥니다.** depth 3 이상은 따라가지 않습니다.
4. **`related:`(soft 참조)는 자동으로 읽지 않습니다.** "지금 작업에 정말 필요한가?"를 판단한 뒤, 필요할 때만 1개씩 읽습니다.
5. **visited 집합을 유지합니다.** 이미 읽은 문서는 다시 펼치지 않습니다.
6. **예산 상한**: 한 작업당 **문서 총 5개 이하 / 최대 깊이 2**. 초과 시 멈추고 사용자에게 묻습니다.
7. 확신이 서지 않으면 전부 읽지 말고 **사용자에게 어떤 작업인지 되묻습니다.**
8. 한 작업이 끝나면 다음 작업에 불필요한 문서는 컨텍스트에서 배제합니다.

---

## 1. 프로젝트 개요 — Posture Guard (거북목 감지)

- **무엇**: 웹캠으로 거북목(전방두부자세)을 실시간 감지하고, 개인 기준 대비 점수화 → 상태 전이 → 단계적 개입(테두리/벨/비네트)하는 데스크톱 도구.
- **스택**: Python 3 + MediaPipe Pose + OpenCV + NumPy + SQLite. 단일 파일 `posture_guard.py`.
- **실행**: `pip install -r requirements.txt` → `python posture_guard.py` (리플레이: `--replay <rec.json>`)
- **핵심 불변식**: 프레임(영상)은 어디에도 저장/전송하지 않는다. 기록은 상태 전이뿐.
- **문서 철학**: 기능 정의는 도메인별로 분리. 이 파일은 그 문서들을 *읽는 순서와 조건*만 관리.

---

## 2. 라우팅 테이블

트리거 키워드가 요청에 보이면 해당 행으로 진입, **주 문서**부터 읽습니다.

| # | 작업 유형 | 트리거 키워드 | 주 문서 | requires (hard, 자동 depth 2) | related (soft, 판단 후) | 연결 스킬 |
|---|----------|-------------|---------|------------------------------|------------------------|----------|
| 1 | 신호 추출 | landmark, 신호, proximity, pitch, head_drop, 어깨 말림 | `features/signals.md` | — | `architecture/pipeline.md` | — |
| 2 | 캘리브레이션 | 캘리브레이션, calibrate, profile, 기준값, μ, σ | `features/calibration.md` | `features/signals.md` | — | — |
| 3 | 점수/판정 | score, z-score, 페널티, deadzone, 가중치 | `features/scoring.md` | `features/signals.md` | `features/calibration.md` | — |
| 4 | 상태 머신 | GOOD, BAD, AWAY, 히스테리시스, 디바운스, 상태 전이 | `features/state-machine.md` | — | `features/scoring.md` | — |
| 5 | 개입/알림 | 알림, 벨, 비네트, 에스컬레이션, 개입, OS 알림, 미니 모드, 창 숨기기 | `features/intervention.md` | `features/state-machine.md` | — | — |
| 6 | 이벤트 기록/통계 | SQLite, posture.db, 이벤트, 요약, 통계 | `features/event-log.md` | `features/state-machine.md` | `architecture/privacy.md` | — |
| 7 | 리플레이/튜닝 | replay, 녹화, 튜닝, 임계값 조정 | `features/replay-tuning.md` | — | `features/scoring.md`, `features/state-machine.md` | (예정: threshold-tuning) |
| 8 | 전체 구조 | 파이프라인, 레이어, 아키텍처, 구조 | `architecture/pipeline.md` | — | — | — |
| 9 | 프라이버시 | 프라이버시, 프레임 저장, 전송, 카메라 데이터 | `architecture/privacy.md` | — | — | — |
| 10 | 의사결정 이력 | 왜 이렇게, ADR, 트레이드오프 | `decisions/INDEX.md` | — | (해당 ADR 1건만) | — |
| 11 | 기획/발표 | 기획서, 기획 문서, 발표, 로드맵, 팀 구성 | `docs/기획서.md` | — | `architecture/pipeline.md` | — |
| 12 | 웹 버전 | 웹, PWA, PiP, 브라우저, 패리티 | `web/README.md` | — | `features/scoring.md`, `features/state-machine.md` | — |
| 13 | 리텐션 기능(v2) | 포인트, 출석, 상점, 척추요정, 캐릭터, 알림음, 리포트, 그룹 | `docs/기능-v2.md` | — | `features/intervention.md` | — |
| 14 | 기능 고도화(팀) | 고도화, 개선, 개선 카드, 학생 가이드 | `docs/기능-고도화-가이드.md` | — | `docs/기능-v2.md` | — |

> **requires** = 반드시 알아야 하는 전제(자동 depth 2 추적).
> **related** = 관련 있으나 없어도 작업 가능(판단 후에만 읽음).

---

## 3. 디렉토리 구조

```
.
├─ CLAUDE.md            ← 진입점 (이 파일). 라우팅만.
├─ HARNESS.md           ← 스킬·훅·서브에이전트 배치 설계
├─ posture_guard.py     ← 구현 전체 (신호→판정→상태→기록, 단일 파일)
├─ requirements.txt
├─ features/            ← 기능 단위 (signals, calibration, scoring, state-machine, intervention, event-log, replay-tuning)
├─ architecture/        ← 횡단 관심사 (pipeline, privacy)
├─ decisions/           ← ADR (INDEX.md + NNNN-*.md)
└─ .claude/             ← 하네스 (hooks: 시크릿 차단)
```

### 레이어 순서 (의존 방향 규칙)

의존은 **항상 한 방향**. 하위 레이어가 상위 레이어를 `requires`하지 않습니다.

```
features/  →  architecture/  →  (공통/기반)
   (역방향 금지 → 순환 차단)
```

런타임 데이터 흐름도 한 방향입니다 (코드의 계층 주석과 일치):

```
신호(signals) → 캘리브레이션(profile) → 판정(scoring) → 상태(state-machine) → 개입/기록
```

---

## 4. 하위 문서 작성 규약

각 md 상단 frontmatter에 의존을 **두 종류로 명시**합니다.

```md
---
title: 판정(점수화)
domain: feature
requires: [features/signals.md]   # hard. 이 문서 이해의 전제. 자동 depth 2 추적.
related:  [features/calibration.md] # soft. 관련은 있으나 없어도 됨. 자동 추적 X.
status: stable                    # draft | stable | deprecated
---
```

**requires vs related 판단**
- `requires`(hard): "이 문서를 이해하려면 **반드시 먼저** 알아야 함."
- `related`(soft): "관련 있지만 **없어도 이 작업은 됨**."
- **헷갈리면 related로.** requires를 인색하게 적을수록 자동 추적이 가벼워집니다.

**작성 원칙**
- 한 문서 = 한 도메인. 코드 기준점은 `posture_guard.py`의 심볼명으로 표기 (예: `Judge.score`).
- `requires`는 **단방향**. `requires` 체인이 3단계를 넘으면 문서 구조를 재검토.

---

## 5. 문서 동기화 규칙 (쓰기 측)

> 방식: **자동 반영하되 무엇을 바꿨는지 명시.** (문서 드리프트 방지)

### 5.1 언제
코드·아키텍처를 **변경하는 작업을 끝낼 때**, 이번 작업에서 **이미 읽은 문서**(주 문서 + requires + 판단해 읽은 related)가 여전히 정확한지 점검.
- **읽지 않은 문서는 손대지 않음.**

### 5.2 무엇을
- **내용 어긋남**: 코드 변경으로 틀려진 설명 수정. 특히 **튜닝 파라미터 값**(임계값·가중치·지속시간)은 문서에 그대로 복제하지 말고 "`posture_guard.py` 상단 튜닝 블록 참조"로 표기 — 값 드리프트 방지.
- **새 기능**: 기능 문서 생성 시 **라우팅 테이블 행도 함께 추가**.
- **의존 변경**: frontmatter의 `requires`/`related` 함께 수정. 단방향·순환 금지 유지.
- **상태 변경**: `status` 갱신.

### 5.3 변경 내역 명시 (필수)
자동 갱신하되, **응답 끝에 반드시 요약**:

```
[문서 동기화]
- features/scoring.md: deadzone 설명 갱신 (신호별 개별 deadzone 반영)
- CLAUDE.md 라우팅: "세션 리포트" 행 신규 추가
```

### 5.4 예외
- `decisions/`(ADR)는 **자동 수정하지 않음.** "ADR 추가/갱신 필요해 보임"이라고 **제안만** 하고 내용은 사람이 작성.

---

## 6. 안티패턴

- ❌ 모든 md를 한 번에 펼치기 → 토큰 폭발
- ❌ `requires`를 깊이 제한 없이 추적 → **depth 2에서 멈춤**
- ❌ `related`를 자동으로 다 읽기 → 판단 후 1개씩
- ❌ 튜닝 파라미터 숫자를 문서에 복제 → 코드 상단 튜닝 블록이 SSoT
- ❌ 라우팅 테이블 없이 디렉토리 전체 스캔 → 진입점을 거칠 것
- ❌ 코드만 바꾸고 문서 방치 → 드리프트 발생
- ❌ 안 읽은 문서를 추측으로 수정 → 이번 작업에서 로드한 문서만 갱신
- ❌ 변경 내역 말 없이 자동 수정 → 반드시 요약
