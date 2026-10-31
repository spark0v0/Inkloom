#!/usr/bin/env bash
set -euo pipefail

# Inkloom 一键启动脚本 (Linux / macOS / Git Bash)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if command -v pwsh >/dev/null 2>&1; then
    exec pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File "$SCRIPT_DIR/scripts/launch.ps1" "$@"
fi

PORT="${PORT:-8765}"
DATA_DIR="${DATA_DIR:-$SCRIPT_DIR/data}"
VENV_PYTHON="$SCRIPT_DIR/backend/.venv/bin/python"

echo "==> 启动 Inkloom (Shell 模式)..."

if [ ! -f "$VENV_PYTHON" ]; then
    if ! command -v uv >/dev/null 2>&1; then
        echo "[错误] 未检测到 uv 与 Python 环境。请先安装 uv: https://docs.astral.sh/uv/"
        exit 1
    fi
    echo "正在初始化后端环境..."
    uv sync --project backend --frozen --link-mode copy
fi

if [ ! -f "$SCRIPT_DIR/frontend/dist/index.html" ]; then
    if ! command -v npm >/dev/null 2>&1; then
        echo "[错误] 未检测到 npm 与网页构建产物。请先安装 Node.js 22.12+"
        exit 1
    fi
    echo "正在构建前端静态网页..."
    (cd "$SCRIPT_DIR/frontend" && npm ci && npm run build)
fi

URL="http://127.0.0.1:$PORT"
echo "==> Inkloom 正在启动：$URL"
echo "==> 按 Ctrl+C 停止服务。"

if command -v open >/dev/null 2>&1; then
    (sleep 1 && open "$URL") &
elif command -v xdg-open >/dev/null 2>&1; then
    (sleep 1 && xdg-open "$URL") &
fi

exec "$VENV_PYTHON" -X utf8 -m app --port "$PORT" --data-dir "$DATA_DIR"
