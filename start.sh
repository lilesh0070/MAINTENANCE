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

# ── Backend + ESP ko uthne do, phir STATUS dikhao ──────────────────
# (START.bat jaisa hi — taaki Windows aur Linux dono par ek jaisa dikhe)
# Port khula hai ya nahi — Ubuntu par `ss` default aata hai; na ho to
# netstat, phir lsof par gir jaate hain (install.sh lsof mangwati hai).
port_up () {
  local p="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | grep -qE "[:.]${p}[[:space:]]" && return 0
  elif command -v netstat >/dev/null 2>&1; then
    netstat -ltn 2>/dev/null | grep -qE "[:.]${p}[[:space:]]" && return 0
  elif command -v lsof >/dev/null 2>&1; then
    lsof -ti "tcp:${p}" >/dev/null 2>&1 && return 0
  fi
  return 1
}
# ANDON ka koi ESP juda hua hai? (:9000 par ESTABLISHED connection)
esp_line () {
  if command -v ss >/dev/null 2>&1; then
    ss -tn state established 2>/dev/null | grep -E "[:.]9000[[:space:]]" | head -1
  elif command -v netstat >/dev/null 2>&1; then
    netstat -tn 2>/dev/null | grep ESTABLISHED | grep -E "[:.]9000[[:space:]]" | head -1
  fi
}

# Backend ke READY hone ka intezaar (fixed sleep nahi).  Machine/DB slow ho to
# backend 15 sec se zyada le leta tha aur STATUS jhooti "[X] nahi chala" deti
# thi.  Ab har 2 sec check, 60 sec tak — ready hote hi aage badh jaate hain.
echo ""
echo "Waiting for backend to come up..."
for _i in $(seq 1 30); do
  port_up 8892 && break
  sleep 2
done

# ESP har 3 sec me khud judta hai — 12 sec ka mauka
echo "Waiting for ESP to connect..."
for _i in $(seq 1 6); do
  [ -n "$(esp_line || true)" ] && break
  sleep 2
done

echo ""
echo "==================================================="
echo "  STATUS"
echo "==================================================="
port_up 8892 && echo "  Backend  :8892   [OK]" || echo "  Backend  :8892   [X] nahi chala  (logs/backend.log dekho)"
port_up 9000 && echo "  ANDON    :9000   [OK] ESP ka intezaar" || echo "  ANDON    :9000   [X] nahi chala"
port_up 9965 && echo "  Frontend :9965   [OK]" || echo "  Frontend :9965   [X] nahi chala  (logs/frontend.log dekho)"
_esp="$(esp_line || true)"
if [ -n "${_esp:-}" ]; then
  echo "  ESP juda         [OK]"
  echo "    $_esp"
else
  echo "  ESP juda         [..] abhi nahi - ESP har 3 sec me khud judta hai"
fi
echo ""
echo "  Open in browser : http://localhost:9965"
echo "  Logs            : logs/backend.log · logs/frontend.log"
echo "  Stop            : ./stop.sh"
echo "==================================================="
