#!/bin/bash
# PreToolUse(Bash) 훅 — git commit/add 시 시크릿·개인데이터 스테이징 차단
# exit 0 = 진행, exit 2 = 차단 (stderr가 Claude에 피드백됨)

INPUT=$(cat)

CMD=$(printf '%s' "$INPUT" | python3 -c '
import json, sys
try:
    print(json.load(sys.stdin).get("tool_input", {}).get("command", ""))
except Exception:
    pass
')

# git commit / git add 계열만 검사
if ! printf '%s' "$CMD" | grep -qE '(^|[;&|[:space:]])git[[:space:]]+(commit|add)'; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR" 2>/dev/null || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

# 스테이징된 파일 + add 명령이면 대상 인자까지 함께 검사
TARGETS=$(git diff --cached --name-only 2>/dev/null; printf '%s\n' "$CMD")

# 차단 패턴: 일반 시크릿 + 이 프로젝트의 개인 데이터(캘리브레이션 프로파일·이벤트 DB·신호 녹화)
BLOCK='(^|/)\.env(\.|$)|\.(pem|key|p12)$|credentials|posture_profile\.json|posture\.db|posture_rec_.*\.json'

MATCHES=$(printf '%s\n' "$TARGETS" | grep -E "$BLOCK" | sort -u)
if [ -n "$MATCHES" ]; then
  {
    echo "차단: 시크릿 또는 개인 데이터가 커밋 대상에 포함되어 있습니다."
    echo "$MATCHES"
    echo "posture_profile.json / posture.db / posture_rec_*.json 은 개인 신체 데이터입니다 (architecture/privacy.md). .gitignore에 추가하고 unstage 하세요."
  } >&2
  exit 2
fi
exit 0
