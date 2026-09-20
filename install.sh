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

# tkinter (doctor.pyw ki WINDOW) — ye pip ka package hai hi NAHI, isliye
# requirements.txt me nahi daala ja sakta.  Python ke saath aata hai, par
# Ubuntu use alag `python3-tk` (apt) me rakhta hai.  Yahin laga dete hain,
# taaki `git pull && ./install.sh` ke baad aur kuch na karna pade.
# Na lag paye to ROKTE NAHI — doctor.pyw text me phir bhi chalta hai.
echo "  Checking tkinter (doctor.pyw ki window)..."
if ./.venv/bin/python -c "import tkinter" >/dev/null 2>&1; then
  echo "  tkinter OK — doctor.pyw ki window khulegi."
else
  SUDO=""
  if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then SUDO="sudo"; fi
  if command -v apt-get >/dev/null 2>&1; then
    echo "  tkinter nahi hai — python3-tk laga rahe hain (sudo maang sakta hai)..."
    $SUDO apt-get install -y python3-tk >/dev/null 2>&1 || {
      $SUDO apt-get update -y >/dev/null 2>&1 || true
      $SUDO apt-get install -y python3-tk >/dev/null 2>&1 || true
    }
  fi
  if ./.venv/bin/python -c "import tkinter" >/dev/null 2>&1; then
    echo "  tkinter lag gaya — doctor.pyw ki window khulegi."
  else
    echo "  [NOTE] tkinter nahi lag paya.  doctor.pyw phir bhi TEXT me chalta hai."
    echo "         Window chahiye to khud:  sudo apt install -y python3-tk"
  fi
fi

# doctor.pyw right-click -> "Run as a Program" se chale, iske liye chalne ki
# ijazat chahiye.  (Yahan hum Phase2 ke ANDAR hain -- raasta usi hisaab se.)
chmod +x tools/doctor.pyw 2>/dev/null || true

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
