#!/bin/bash
# Posture Guard 실행 (더블클릭 또는 open run.command)
cd "$(dirname "$0")"
.venv/bin/python posture_guard.py 2>&1 | tee last_run.log
