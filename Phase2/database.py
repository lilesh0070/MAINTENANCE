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
    "database": os.getenv("DB_NAME",     "energydb"),
    "user":     os.getenv("DB_USER",     "postgres"),
    "password": os.getenv("DB_PASS",     ""),
    # 2026-06-14 — fail FAST when the DB is down so a request returns an error
    # in seconds instead of hanging for the OS-default ~minute+.  Lets the
    # login surface "Server not connected" promptly and the JSON write-buffer
    # detect the outage quickly.
    "connect_timeout": int(os.getenv("DB_CONNECT_TIMEOUT", "5") or 5),
}

_pool = None


def db_reachable(timeout: float = 2.0) -> bool:
    """Fast TCP probe of the DB host:port (no auth, no pool).  Used to skip
    DB-dependent startup work (migrations) and to gate the JSON write-buffer
    flush, so nothing blocks for the full connect timeout when the DB is down."""
    import socket
    try:
        s = socket.create_connection((DB_CONFIG["host"], DB_CONFIG["port"]), timeout=timeout)
        s.close()
        return True
    except OSError:
        return False

def _get_pool():
    global _pool
    if _pool is None or _pool.closed:
        # 2026-05-18 — Pool bumped from 1..10 to 2..30.
        # Dashboard polls /realtime every 3s + /submachines every 10s per
        # line; 8-line YNC line × 2 endpoints = ~16 concurrent during burst,
        # which would block on the old 10-cap.  30 gives 2x headroom.
        # Postgres default max_connections=100, so well within budget.
        _pool = psycopg2.pool.SimpleConnectionPool(2, 30, **DB_CONFIG)
    return _pool

@contextmanager
def get_conn():
    pool = _get_pool()          # keep reference to the pool
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