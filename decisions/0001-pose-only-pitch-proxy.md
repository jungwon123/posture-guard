# 0001. 피치는 Pose 전용 프록시로 (Face Landmarker 제외)

- 상태: accepted (2026-07, 프로토타입)

## 맥락

고개 숙임(피치)은 거북목의 핵심 신호. 정석은 MediaPipe Face Landmarker의 얼굴 변환 행렬에서 피치 각도를 직접 얻는 것이나, 별도 모델 다운로드가 필요하다.

## 결정

프로토타입에서는 Pose 랜드마크만으로 **코-귀 상대 위치 프록시**(`(코y − 귀중점y) / 귀거리`)를 쓴다.

## 결과

- 의존성·설치가 가벼움 (Pose 1개 모델). 프록시 정밀도는 낮지만 EMA+z-score+디바운스가 흡수.
- 업그레이드 경로: 신호 계층(`extract_signals`) 내부 교체만으로 가능하도록 계층 경계 유지 (`architecture/pipeline.md`).
