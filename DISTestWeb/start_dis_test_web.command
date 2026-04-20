#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SERVER_SCRIPT="$SCRIPT_DIR/server.js"
URL="http://127.0.0.1:7070"

cd "$PROJECT_ROOT"

nohup node "$SERVER_SCRIPT" >/tmp/dis_test_web.log 2>&1 &
sleep 1

open "$URL"
echo "Opened $URL"
echo "Log: /tmp/dis_test_web.log"
