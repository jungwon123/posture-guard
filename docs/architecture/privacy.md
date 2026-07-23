---
title: 프라이버시 불변식
domain: architecture
requires: []
related: []
status: stable
---

## 목적

상시 웹캠 감시 도구의 수용성은 프라이버시 보장에 달려 있다. 이 문서의 불변식은 **어떤 기능 추가에서도 깨면 안 되는** 비협상 규칙이다.

## 불변식

1. **프레임(영상·이미지)은 저장하지 않는다.** 디스크·메모리 버퍼 축적·스크린샷 전부 금지.
2. **네트워크 전송이 없다.** 모든 처리는 로컬. 외부 API 호출을 추가하지 않는다.
3. **디스크에 남는 것은 3가지뿐**:
   - `posture_profile.json` — 개인 캘리브레이션 기준 (μ, σ)
   - `posture.db` — 상태 전이 이벤트 (state, started_at, ended_at)
   - `posture_rec_*.json` — 사용자가 `r`키로 **명시적으로** 녹화한 신호 값 (랜드마크 좌표 파생 수치, 영상 아님)
4. 위 3가지도 **개인 데이터로 취급** — git 커밋 금지 (훅으로 차단, `HARNESS.md` 2절).

## 관련 결정

- `decisions/0004-transition-only-logging.md` — 왜 점수 시계열이 아니라 전이만 기록하는가
