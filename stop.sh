#!/usr/bin/env bash
# ===================================================================
#  MAINTENANCE SLICE — Stop / free ports (Linux / Ubuntu)
#  Linux equivalent of STOP.bat. Kills whatever is listening on
#  8892 (backend) and 9965 (frontend).
#    ./stop.sh          → verbose
#    ./stop.sh silent   → quiet (used by start.sh)
# ===================================================================
set -uo pipefail
cd "$(dirname "$0")"
SILENT="${1:-}"

kill_port () {
  local port="$1" name="$2" pids=""
  if command -v lsof >/dev/null 2>&1; then
    pids=$(lsof -ti "tcp:${port}" 2>/dev/null || true)
  fi
  if [ -z "$pids" ] && command -v fuser >/dev/null 2>&1; then
    pids=$(fuser "${port}/tcp" 2>/dev/null || true)
  fi
  if [ -n "$pids" ]; then
    [ "$SILENT" = "silent" ] || echo "  Killing $name on :$port (PID $pids)"
    kill -9 $pids 2>/dev/null || true
  else
    [ "$SILENT" = "silent" ] || echo "  Nothing listening on :$port ($name)"
  fi
}

kill_port 8892 Backend
kill_port 9965 Frontend
# :9000 = ANDON ka TCP ingest (ESP yahan judta hai).  Aam taur par ye backend
# ke usi process ka hai, to upar wale kill se hi chala jaata hai — par agar
# kabhi wo process 8892 chhod kar sirf 9000 pakde rahe, to port block reh
# jaata aur agli baar backend "address already in use" par mar jaata.
kill_port 9000 "ANDON ingest"

[ "$SILENT" = "silent" ] || echo "Done. Ports 8892, 9000 and 9965 are free."
