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
# .env gitignored hai — nayi machine par ye file hoti hi nahi.  Bina iske
# backend chal to jaata hai par DB se jud nahi paata, aur error samajh nahi
# aata.  Isliye yahin saaf-saaf rok dete hain.
if [ ! -f "Phase2/.env" ]; then
  echo "  [ERROR] Phase2/.env missing."
  echo "          cp Phase2/.env.example Phase2/.env"
  echo "          phir usme DB_PASS aur JWT_SECRET_KEY bhar dein."
  exit 1
fi
if ! grep -qE '^DB_PASS=.+' Phase2/.env; then
  echo "  [WARN] Phase2/.env me DB_PASS khali hai — DB connect nahi hoga."
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

# ── Backend ko uthne do, phir STATUS dikhao ──────────────────
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

# Backend ke READY hone ka intezaar (fixed sleep nahi).  Machine/DB slow ho to
# backend 15 sec se zyada le leta tha aur STATUS jhooti "[X] nahi chala" deti
# thi.  Ab har 2 sec check, 60 sec tak — ready hote hi aage badh jaate hain.
echo ""
echo "Waiting for backend to come up..."
for _i in $(seq 1 30); do
  port_up 8892 && break
  sleep 2
done

echo ""
echo "==================================================="
echo "  STATUS"
echo "==================================================="
port_up 8892 && echo "  Backend  :8892   [OK]" || echo "  Backend  :8892   [X] nahi chala  (logs/backend.log dekho)"
port_up 9965 && echo "  Frontend :9965   [OK]" || echo "  Frontend :9965   [X] nahi chala  (logs/frontend.log dekho)"
echo ""
echo "  Open in browser : http://localhost:9965"
echo "  Logs            : logs/backend.log · logs/frontend.log"
echo "  Stop            : ./stop.sh"
echo "==================================================="
