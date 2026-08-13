#!/usr/bin/env bash
# ===================================================================
#  MAINTENANCE SLICE — Dependency Installer (Linux / Ubuntu)
#  Linux equivalent of INSTALL.bat. Run ONCE per machine (and again
#  only when requirements.txt / package.json change).
#
#  Prereqs on Ubuntu:
#    sudo apt update
#    sudo apt install -y python3 python3-venv python3-pip nodejs npm lsof
#  (Node LTS is best installed from https://nodejs.org or nvm.)
# ===================================================================
set -euo pipefail
cd "$(dirname "$0")"

echo "=== Maintenance Slice — installing dependencies (Linux) ==="

# ----------------------- BACKEND -----------------------
echo "[1/2] Backend (Phase2) — Python venv + pip"
cd Phase2

PY=""
for c in python3.12 python3 python; do
  command -v "$c" >/dev/null 2>&1 && { PY="$c"; break; }
done
if [ -z "$PY" ]; then
  echo "  [ERROR] Python 3 not found. Install:  sudo apt install -y python3 python3-venv python3-pip"
  exit 1
fi

if [ ! -x ".venv/bin/python" ]; then
  echo "  Creating virtual environment [.venv] with $PY ..."
  "$PY" -m venv .venv
fi

echo "  Upgrading pip (non-fatal if offline)..."
./.venv/bin/python -m pip install --upgrade pip || true

echo "  Installing backend requirements (can take a few minutes)..."
./.venv/bin/python -m pip install -r requirements.txt
echo "  Backend dependencies installed."

# Kuch distros par cryptography/psycopg2/bcrypt ke wheels nahi hote aur pip
# beech me fail ho jaati hai — venv adhoora reh jaata hai aur start.sh me
# backend chup-chaap import par mar jaata (port khulta hi nahi).  Yahin pakdo:
echo "  Verifying backend imports..."
if ! ./.venv/bin/python -c "import fastapi, uvicorn, pydantic, psycopg2, jose, passlib, dotenv" 2>/tmp/mes_impchk; then
  echo "  [ERROR] Backend ke kuch modules import nahi ho rahe (pip install poora nahi hua):"
  sed 's/^/      /' /tmp/mes_impchk 2>/dev/null || true
  echo "      Ubuntu build tools chahiye ho sakte hain, phir install dobara:"
  echo "        sudo apt install -y build-essential python3-dev libpq-dev libffi-dev"
  echo "        ./install.sh"
  exit 1
fi
echo "  Backend imports OK."

# ----------------------- FRONTEND ----------------------
echo "[2/2] Frontend (mes-frontend) — npm"
cd ../mes-frontend
if ! command -v npm >/dev/null 2>&1; then
  echo "  [ERROR] npm / Node.js not found. Install Node.js LTS from https://nodejs.org/"
  exit 1
fi

# npm ci = clean, reproducible install straight from package-lock.json.
# Falls back to npm install if the lockfile is out of sync.
npm ci || npm install
echo "  Frontend dependencies installed."

echo ""
echo "=== ALL DEPENDENCIES INSTALLED ==="
echo "  Next:  cp Phase2/.env.example Phase2/.env   (then set DB_HOST / DB_PASS)"
echo "  Then:  ./start.sh    → open http://localhost:9965"
