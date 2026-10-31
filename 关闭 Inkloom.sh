#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if command -v pwsh >/dev/null 2>&1; then
    exec pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File "$SCRIPT_DIR/scripts/stop.ps1" "$@"
fi

PORT="${PORT:-8765}"
echo "==> 正在查找并停止 Inkloom 服务 (端口 $PORT)..."

TARGET_PID=""
if command -v lsof >/dev/null 2>&1; then
    TARGET_PID="$(lsof -ti :"$PORT" 2>/dev/null || true)"
elif command -v fuser >/dev/null 2>&1; then
    TARGET_PID="$(fuser "$PORT"/tcp 2>/dev/null || true)"
fi

if [ -n "$TARGET_PID" ]; then
    kill "$TARGET_PID" 2>/dev/null || true
    echo "==> 已成功停止 Inkloom 服务 (PID: $TARGET_PID)。"
else
    echo "==> 未发现运行在端口 $PORT 的服务。"
fi

rm -f "$SCRIPT_DIR/.runtime/server-$PORT.json" "$SCRIPT_DIR/.runtime/launcher.lock"
