#!/usr/bin/env bash
# ===================================================================
#  MAINTENANCE SLICE — Start backend + frontend (Linux / Ubuntu)
#  Linux equivalent of START.bat. Runs both in the background and
#  writes logs to ./logs. Stop with ./stop.sh.
# ===================================================================
set -euo pipefail
cd "$(dirname "$0")"

# free the ports first (kill any stale listeners)
./stop.sh silent || true

# sanity checks: are deps installed?
if [ ! -x "Phase2/.venv/bin/python" ]; then
  echo "  [ERROR] Backend venv missing. Run ./install.sh first."; exit 1
fi
if [ ! -d "mes-frontend/node_modules" ]; then
  echo "  [ERROR] Frontend node_modules missing. Run ./install.sh first."; exit 1
fi

mkdir -p logs .run

echo "Starting backend (uvicorn :8892)..."
( cd Phase2 && exec ./.venv/bin/python -u -m uvicorn main:app --host 0.0.0.0 --port 8892 ) \
    > logs/backend.log 2>&1 &
echo $! > .run/backend.pid

echo "Starting frontend (vite :9965)..."
# --host makes Vite listen on 0.0.0.0 so the app is reachable from other
# machines on the network (drop it to keep it localhost-only).
( cd mes-frontend && exec npm run dev -- --host ) \
    > logs/frontend.log 2>&1 &
echo $! > .run/frontend.pid

echo ""
echo "==================================================="
echo "  Backend  : http://localhost:8892   (logs/backend.log)"
echo "  Frontend : http://localhost:9965   (logs/frontend.log)"
echo "  Stop     : ./stop.sh"
echo "==================================================="
