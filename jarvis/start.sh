#!/usr/bin/env bash
# J.A.R.V.I.S. one-click start (macOS / Linux). First run installs everything.
set -euo pipefail
cd "$(dirname "$0")"

command -v python3 >/dev/null || { echo "Python 3 not found. Install it from python.org"; exit 1; }

if [ ! -d backend/.venv ]; then
  echo "[1/3] Creating Python environment..."
  python3 -m venv backend/.venv
  backend/.venv/bin/pip install --upgrade pip >/dev/null
  backend/.venv/bin/pip install -r backend/requirements.txt
fi

if [ ! -f frontend/dist/index.html ]; then
  command -v node >/dev/null || { echo "Node.js not found. Install the LTS from nodejs.org, then rerun."; exit 1; }
  echo "[2/3] Building the UI (first run only)..."
  (cd frontend && npm install --no-audit --no-fund && npm run build)
fi

echo "[3/3] Starting Jarvis at http://127.0.0.1:8765"
cd backend
../backend/.venv/bin/python run.py &
BACKEND=$!
cd ..
trap 'kill $BACKEND 2>/dev/null' EXIT

for _ in $(seq 1 40); do
  curl -fs http://127.0.0.1:8765/api/health >/dev/null 2>&1 && break
  sleep 0.3
done

URL=http://127.0.0.1:8765
if command -v google-chrome >/dev/null; then google-chrome --app=$URL --window-size=1440,900 >/dev/null 2>&1 &
elif command -v chromium >/dev/null; then chromium --app=$URL --window-size=1440,900 >/dev/null 2>&1 &
elif [ "$(uname)" = "Darwin" ]; then open -a "Google Chrome" --args --app=$URL 2>/dev/null || open $URL
elif command -v xdg-open >/dev/null; then xdg-open $URL
fi
echo "Jarvis is running. Press Ctrl+C to stop."
wait $BACKEND
