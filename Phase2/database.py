"""
database.py — lazy connection pool + canonical DB config.
Pool startup pe nahi banta, pehli request pe banta hai.
DB down ho toh app start hoti rehti hai.

This module is the SINGLE SOURCE for DB credentials in the stack.
Other modules (collectors, plc_diag, scripts) import `DB_CONFIG` from
here instead of redefining their own copy.

Resolution order:
  1. Individual env vars (DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASS)
     — loaded from .env by main.py via load_dotenv().  See .env.example.
  2. Non-secret host/port/db/user fall back to the on-prem defaults so
     existing installs keep working.  The PASSWORD has NO default — it must
     come from .env (never hardcode a secret in source / git history).
"""

import os
import psycopg2
import psycopg2.extras
import psycopg2.pool
from contextlib import contextmanager

DB_CONFIG = {
    "host":     os.getenv("DB_HOST",     "192.168.30.15"),
    "port":     int(os.getenv("DB_PORT", "5432") or 5432),
    # 2026-08-07 — default `energydb` se badal kar `maintenance_db`.  Agar
    # kabhi .env na mile to app galti se production MES ki shared DB par
    # nahi chala jayega.
    "database": os.getenv("DB_NAME",     "maintenance_db"),
    "user":     os.getenv("DB_USER",     "postgres"),
    "password": os.getenv("DB_PASS",     ""),
    # 2026-06-14 — fail FAST when the DB is down so a request returns an error
    # in seconds instead of hanging for the OS-default ~minute+.  Lets the
    # login surface "Server not connected" promptly and the JSON write-buffer
    # detect the outage quickly.
    "connect_timeout": int(os.getenv("DB_CONNECT_TIMEOUT", "5") or 5),
    # 2026-08-13 — koi transaction galti se khuli reh jaye ("idle in transaction")
    # to 30s baad postgres khud us connection ko maar de.  Warna aisi atki
    # connection apne locks pakde rehti hai aur naye backend ki startup migration
    # (ALTER TABLE / CREATE INDEX) block ho jaati hai — backend "Waiting for
    # application startup" par hang, login fail.  Poll ki transactions <1s hain,
    # to normal kaam par koi asar nahi.  .env se override: DB_OPTIONS.
    "options": os.getenv("DB_OPTIONS", "-c idle_in_transaction_session_timeout=30000"),
}

_pool = None

# ── DB_HOST_ALT — LAN pe LAN se, bahar se Tailscale se ────────────────────
# `.env`:
#     DB_HOST=192.168.30.15        <- office LAN (tez)
#     DB_HOST_ALT=100.121.68.19    <- Tailscale (bahar se)
#
# Pool banate waqt pehle DB_HOST ko TCP se tatolte hain (1.5s).  Mil gaya to
# wahi (LAN, ~70ms).  Nahi mila (matlab office ke bahar ho) to DB_HOST_ALT.
# Laptop office se ghar le jao — pehli fail hote hi pool dobara bana kar doosre
# host par chala jaata hai, .env chhune ki zaroorat nahi.
# DB_HOST_ALT set na ho to bilkul purana vyavhaar — kuch nahi badalta.
DB_HOST_ALT   = (os.getenv("DB_HOST_ALT") or "").strip()
_HOST_PROBE_S = float(os.getenv("DB_HOST_PROBE_TIMEOUT", "1.5") or 1.5)
_active_host  = None            # abhi kaunsa host chal raha hai


def _tcp_ok(host, port, timeout):
    import socket
    try:
        s = socket.create_connection((host, port), timeout=timeout); s.close()
        return True
    except OSError:
        return False


def _pick_host(force=False):
    """Kaunsa host use karna hai — LAN pehle, phir alt.  Ek baar tay hone ke
    baad yaad rakhta hai (har connection par probe nahi karta)."""
    global _active_host
    if _active_host and not force:
        return _active_host
    primary, port = DB_CONFIG["host"], DB_CONFIG["port"]
    if not DB_HOST_ALT:
        _active_host = primary
        return _active_host
    if _tcp_ok(primary, port, _HOST_PROBE_S):
        _active_host = primary
    elif _tcp_ok(DB_HOST_ALT, port, max(_HOST_PROBE_S, 3.0)):
        _active_host = DB_HOST_ALT
        print(f"[DB] {primary} nahi mila -> {DB_HOST_ALT} (Tailscale) se jud rahe hain")
    else:
        _active_host = primary          # dono band — purana behaviour (saaf error)
    return _active_host


def db_reachable(timeout: float = 2.0) -> bool:
    """Fast TCP probe of the DB host:port (no auth, no pool).  Used to skip
    DB-dependent startup work (migrations) and to gate the JSON write-buffer
    flush, so nothing blocks for the full connect timeout when the DB is down."""
    port = DB_CONFIG["port"]
    if _tcp_ok(_pick_host(), port, timeout):
        return True
    if DB_HOST_ALT:                     # doosre host par bhi dekh lo
        return _tcp_ok(_pick_host(force=True), port, timeout)
    return False

def _get_pool():
    global _pool
    if _pool is None or _pool.closed:
        # 2026-05-18 — Pool bumped from 1..10 to 2..30.
        # Dashboard polls /realtime every 3s + /submachines every 10s per
        # line; 8-line YNC line × 2 endpoints = ~16 concurrent during burst,
        # which would block on the old 10-cap.  30 gives 2x headroom.
        # Postgres default max_connections=100, so well within budget.
        host = _pick_host()
        cfg = {**DB_CONFIG, "host": host}
        # Tailscale (alt host) par har connection relay se jaata hai (~5s), to
        # shuru me 2 ki jagah 1 hi kholo — pool phir zaroorat par khud badhta hai.
        minconn = 1 if (DB_HOST_ALT and host == DB_HOST_ALT) else 2
        _pool = psycopg2.pool.SimpleConnectionPool(minconn, 30, **cfg)
    return _pool

@contextmanager
def get_conn():
    pool = _get_pool()          # keep reference to the pool
    try:
        conn = pool.getconn()
    except Exception:
        # Host badal gaya (laptop office se bahar, ya ulta) — doosre host par
        # dobara koshish.  Sirf tab jab DB_HOST_ALT diya ho.
        if not DB_HOST_ALT:
            raise
        global _pool
        try: pool.closeall()
        except Exception: pass
        _pool = None
        _pick_host(force=True)
        pool = _get_pool()
        conn = pool.getconn()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        pool.putconn(conn)      # use the same pool reference

def dict_cursor(conn):
    return conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)