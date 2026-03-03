#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
#  start.sh  –  One-command dev startup for the backend
#
#  Usage:
#    cd backend
#    bash ../start.sh
#
#  Or from the project root:
#    bash start.sh
# ─────────────────────────────────────────────────────────────
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"

echo "────────────────────────────────────────"
echo "  Business Voice Assistant – Backend"
echo "────────────────────────────────────────"

# Create & activate virtualenv if not present
if [ ! -d "$BACKEND_DIR/venv" ]; then
  echo "→ Creating virtual environment…"
  python -m venv "$BACKEND_DIR/venv"
fi

echo "→ Activating virtual environment…"
# Windows (Git Bash / MINGW) compatible activation
if [ -f "$BACKEND_DIR/venv/Scripts/activate" ]; then
  source "$BACKEND_DIR/venv/Scripts/activate"
else
  source "$BACKEND_DIR/venv/bin/activate"
fi

echo "→ Installing dependencies…"
pip install -q -r "$BACKEND_DIR/requirements.txt"

echo "→ Starting FastAPI server on http://localhost:8000"
echo "   Open frontend/index.html in your browser."
echo "────────────────────────────────────────"

cd "$BACKEND_DIR"
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
