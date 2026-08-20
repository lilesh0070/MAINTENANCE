"""
main.py
=======
Platform — FastAPI Backend
Toyota Boshoku Device India Pvt. Ltd., Bawal, Haryana
"""

import os
import io
import csv
from datetime import datetime, timedelta
from typing import List, Any

# IMPORTANT: load .env BEFORE importing any router. Routers read env vars
# (e.g. CYCLE_VIDEO_BASE_URL) at import time — if dotenv loads after, they
# silently fall back to defaults and proxy calls hit the wrong port.
from dotenv import load_dotenv
# override=True so .env values WIN over any pre-set system env vars.
# Windows sometimes has empty ANTHROPIC_API_KEY / OPENAI_API_KEY set
# at user level; without override the .env value gets ignored and
# downstream API clients fail with auth errors.
load_dotenv(override=True)

import uvicorn
from fastapi import FastAPI, Depends, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import HTMLResponse, StreamingResponse, FileResponse
from pydantic import BaseModel

from database import get_conn, dict_cursor
from auth import auth_router, get_current_user, require_admin, TOKEN_EXPIRE_HOURS
# ── MAINTENANCE-ONLY SLICE ─────────────────────────────────────
# Only the routers the Maintenance department UI needs are imported.
# The non-maintenance routers (non_production, submachines, reports,
# manpower, store_dispatch, shift_calc, kanban, anything_wrong,
# heijunka, five_s, pdca, cms_sync, wallboard) were removed along with
# their files — every other line of main.py is unchanged.
from routers.users           import router as users_router
from routers.breakdowns      import router as breakdowns_router
from routers.machines        import router as machines_router
from routers.deviations      import router as deviations_router
from routers.maintenance_kpi import router as maintenance_kpi_router
from routers.maintenance_kpi_target import router as maintenance_kpi_target_router
from routers.logbook         import router as logbook_router
from routers.spares          import router as spares_router
from routers.skill_training   import router as skill_training_router
from routers.qpr             import router as qpr_router
from routers.skill_eval      import router as skill_eval_router
from routers.org_chart       import router as org_chart_router
from routers.capa_logbook    import router as capa_logbook_router
from routers.maintenance_logbook import router as maintenance_logbook_router
from routers.pm               import router as pm_router
from routers.pm_mail          import mail_router as pm_mail_router
from routers.sunday_plan      import router as sunday_plan_router
from routers.daily_plan       import router as daily_plan_router
from routers.shutdown_plan    import router as shutdown_plan_router
from routers.machine_dmc      import router as machine_dmc_router
from routers.breakdown_slips  import router as breakdown_slips_router
from routers.breakdown_logbook import router as breakdown_logbook_router
from routers.maintenance_spare import router as maintenance_spare_router
from routers.andon           import router as andon_router
from routers.dashboard_zones import router as dashboard_zones_router
from routers.machine_running_hours import router as machine_running_hours_router
from routers.kpi_ui_settings import router as kpi_ui_settings_router

# ── App ────────────────────────────────────────────────────────
# SECURITY: /docs, /redoc aur /openapi.json bina login ke khulte hain — ye
# poora API surface (har endpoint, har parameter) dikha dete hain.  Endpoints
# khud auth-protected hain, isliye khatra sirf "information disclosure" ka hai,
# par production me inki zaroorat nahi.  Band karne ke liye .env me:
#     ENABLE_API_DOCS=false
# (default true rakha hai taaki abhi ka koi kaam na ruke.)
_DOCS_ON = (os.getenv("ENABLE_API_DOCS", "true") or "true").strip().lower() not in ("0", "false", "no", "off")

app = FastAPI(
    title       = "Platform — Toyota Boshoku Device India",
    description = "Manufacturing Execution System API",
    version     = "2.0.0",
    docs_url    = "/docs"  if _DOCS_ON else None,
    redoc_url   = "/redoc" if _DOCS_ON else None,
    openapi_url = "/openapi.json" if _DOCS_ON else None,
)

# ── Static assets ──────────────────────────────────────────────
# SECURITY: do NOT mount the source directory — it also holds .env, *.py
# source, *.log, and DB/CSV backups, which StaticFiles would serve to any
# unauthenticated caller (e.g. GET /static/.env).  Serve ONLY whitelisted
# image assets (logo.jpg etc.) by exact extension, from this directory,
# with no path traversal.
_STATIC_DIR = os.path.dirname(__file__)
_STATIC_ALLOWED_EXT = {".jpg", ".jpeg", ".png", ".gif", ".ico", ".svg", ".webp"}


@app.get("/static/{filename}")
def serve_static_asset(filename: str):
    # bare filename only — reject path separators / traversal
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(404, "Not found")
    if os.path.splitext(filename)[1].lower() not in _STATIC_ALLOWED_EXT:
        raise HTTPException(404, "Not found")
    path = os.path.join(_STATIC_DIR, filename)
    if not os.path.isfile(path):
        raise HTTPException(404, "Not found")
    return FileResponse(path)

# ── CORS ───────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins     = ["*"],
    # SECURITY: auth is via the Authorization: Bearer header (no cookies), so
    # credentialed CORS is not needed.  Keeping this False avoids the
    # wildcard-origin + credentials combination (Starlette would otherwise
    # reflect the caller's Origin), which would let any site a logged-in user
    # visits read authenticated responses.  For header-based auth, a malicious
    # site cannot attach the victim's token, so "*" origins stay safe here.
    allow_credentials = False,
    allow_methods     = ["*"],
    allow_headers     = ["*"],
)

# ── Gzip ───────────────────────────────────────────────────────
# 2026-05-18 — LAN-access perf fix.  Realtime/submachines/history
# responses are pure JSON and compress 5-10x.  minimum_size=500 skips
# tiny replies (ok/health) where compression overhead doesn't pay.
# Removes the buffering symptom on remote-PC dashboard access.
app.add_middleware(GZipMiddleware, minimum_size=500)

# ── Routers ────────────────────────────────────────────────────
app.include_router(auth_router)
app.include_router(users_router)
app.include_router(breakdowns_router)
app.include_router(machines_router)
app.include_router(deviations_router)    # Online Deviation Form (maintenance)
app.include_router(maintenance_kpi_router)
app.include_router(maintenance_kpi_target_router)
app.include_router(logbook_router)              # Maintenance Log Book (rebuilt)
app.include_router(spares_router)               # Spare consumption (Breakdown + Log Book + PM)
app.include_router(skill_training_router)       # Maintenance Skill & Training (OJT, etc.)
app.include_router(qpr_router)                   # Breakdown QPR register
app.include_router(skill_eval_router)            # Skill Matrix — skill evaluation
app.include_router(org_chart_router)             # Organization Chart (monthly versions)
app.include_router(capa_logbook_router)          # CAPA driven by the Breakdown Log Book
app.include_router(maintenance_logbook_router)  # maintenance daily log book (DB-backed)
app.include_router(pm_router)                   # preventive maintenance check sheets
app.include_router(pm_mail_router)              # PM reminder mail (server-side)
app.include_router(sunday_plan_router)          # Update Plan → Sunday Plan Work
app.include_router(daily_plan_router)           # Update Plan → Daily Work Assign
app.include_router(shutdown_plan_router)        # Update Plan → Shutdown Plan Work
app.include_router(machine_dmc_router)          # Machine DMC — daily check-sheet points
app.include_router(breakdown_slips_router)      # Manual Break Down Slip → standalone maintenance_breakdown_data
app.include_router(breakdown_logbook_router)    # Log Book + History Card (/combined merges slip + log book)
app.include_router(maintenance_spare_router)    # Spare master (grows from slip + log-book spares)
app.include_router(andon_router)                # ANDON Management module (standalone andon_* tables)
app.include_router(dashboard_zones_router)      # Dashboard Pending-Breakdown zone tiles (admin-curated whitelist)
app.include_router(machine_running_hours_router) # Per-machine running hours → MTBF calculation (KPI Target)
app.include_router(kpi_ui_settings_router)       # Admin-editable KPI page appearance (colors/axis)


# NOTE (maintenance-only slice): the manpower / kanban / report-scheduler
# startup workers were removed — their routers (routers/manpower.py,
# routers/kanban.py, routers/reports.py) are not part of this build.



# ── PM reminder mail background worker ───────────────────────────
@app.on_event("startup")
def _start_pm_mail_worker():
    """Server-side PM reminder mailer (Mon=this-week / Sat=next-week)."""
    try:
        import threading
        from routers.pm_mail import pm_mail_worker
        threading.Thread(target=pm_mail_worker, daemon=True, name="pm-mail").start()
    except Exception as exc:
        print(f"[PM-MAIL] failed to start: {exc}")


# ── OEE alarm config endpoints (admin only) ──────────────────────
from pydantic import BaseModel as _BM_oee


@app.on_event("startup")
def start_andon_workers():
    """ANDON PLC bit-poller.  Start at boot, independent of the DB — the poller
    connects OUT to each PLC and applies bit changes; persistence retries once
    the DB is back."""
    try:
        from routers.andon import start_workers
        start_workers()
    except Exception as e:
        print(f"[STARTUP] ANDON workers start failed: {e}")


# ── Startup migrations ─────────────────────────────────────────
@app.on_event("startup")
def run_migrations():
    """Apply any pending schema changes that are safe to run on every startup."""
    # 2026-06-14 — DB-DOWN RESILIENCE: never block API boot on a dead DB.
    # Each migration opens a connection; with the DB down every connect would
    # burn the full timeout (×50 migrations = startup hang → API never binds).
    # Fast TCP probe first; if unreachable, skip — migrations re-run on the
    # next startup once the DB is back.  The API now boots regardless, so the
    # login can return its "Server not connected" 503.
    from database import db_reachable
    if not db_reachable():
        print("[STARTUP] DB unreachable — skipping migrations (API boots anyway; "
              "migrations re-run on next startup once DB is back)")
        return
    # Ensure the maintenance_breakdown_data table (manual Break Down Slip store) exists
    # Idempotent + best-effort.
    try:
        from routers.breakdown_slips import _ensure_table as _ensure_bd_data
        _ensure_bd_data()
    except Exception as e:
        print(f"[STARTUP] maintenance_breakdown_data ensure failed: {e}")
    # Ensure the Log Book table matches the frontend Log Book's columns and
    # drop the legacy columns the form no longer fills.  Idempotent.
    try:
        from routers.breakdown_logbook import _ensure_table as _ensure_logbook
        _ensure_logbook()
    except Exception as e:
        print(f"[STARTUP] Log Book table ensure failed: {e}")
    # ANDON tables/scheme (idempotent) — also (re)starts the PLC poller.
    try:
        from routers.andon import _ensure_tables as _ensure_andon
        _ensure_andon()
    except Exception as e:
        print(f"[STARTUP] ANDON tables ensure failed: {e}")
    migrations = [
        """
        CREATE TABLE IF NOT EXISTS maintenance_users (
            id             SERIAL PRIMARY KEY,
            username       VARCHAR(80)  NOT NULL UNIQUE,
            password_hash  TEXT         NOT NULL,
            role           VARCHAR(30)  NOT NULL DEFAULT 'admin',
            full_name      VARCHAR(120),
            is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
            last_login     TIMESTAMP,
            created_at     TIMESTAMP    NOT NULL DEFAULT NOW()
        )
        """,
        # password badalne par us se purane sab token invalid ho jaayein — is
        # column me unix-ts (UTC seconds) set hota hai jab bhi password badle.
        "ALTER TABLE maintenance_users ADD COLUMN IF NOT EXISTS pwd_changed_at BIGINT",
        """
        CREATE TABLE IF NOT EXISTS maintenance_user_permissions (
            id          SERIAL PRIMARY KEY,
            user_id     INTEGER NOT NULL REFERENCES maintenance_users(id) ON DELETE CASCADE,
            page_key    VARCHAR(60) NOT NULL,
            perm_level  VARCHAR(20) NOT NULL DEFAULT 'read',
            UNIQUE (user_id, page_key)
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS maintenance_audit_log (
            id           SERIAL PRIMARY KEY,
            action       VARCHAR(60)  NOT NULL,
            entity_type  VARCHAR(40),
            entity_id    INTEGER,
            details      TEXT,
            user_id      INTEGER,
            username     VARCHAR(80),
            created_at   TIMESTAMP    NOT NULL DEFAULT NOW()
        )
        """,
        "CREATE INDEX IF NOT EXISTS ix_maint_users_username ON maintenance_users (LOWER(username))",
        "CREATE INDEX IF NOT EXISTS ix_maint_audit_created  ON maintenance_audit_log (created_at DESC)",
        "CREATE INDEX IF NOT EXISTS ix_maint_audit_user     ON maintenance_audit_log (user_id, created_at DESC)",
        """
        CREATE TABLE IF NOT EXISTS maintenance_machines (
            id           SERIAL PRIMARY KEY,
            source_id    VARCHAR(40),     -- 'machine_<id>' from NF2 (traceability)
            zone_name    VARCHAR(60)  NOT NULL,
            line_name    VARCHAR(60)  NOT NULL,
            serial_no    INTEGER,         -- per-line unique number (1..N)
            machine_no   VARCHAR(60),     -- machine code, e.g. 'Y17_SS_01'
            machine_name VARCHAR(160) NOT NULL,
            is_active    BOOLEAN      NOT NULL DEFAULT TRUE,
            created_at   TIMESTAMP    DEFAULT NOW(),
            updated_at   TIMESTAMP    DEFAULT NOW(),
            UNIQUE (zone_name, line_name, serial_no)
        )
        """,
        "CREATE INDEX IF NOT EXISTS idx_maintenance_machines_lookup ON maintenance_machines (LOWER(zone_name), LOWER(line_name), serial_no)",
        "CREATE INDEX IF NOT EXISTS idx_maintenance_machines_line   ON maintenance_machines (LOWER(zone_name), LOWER(line_name))",
        # For existing DBs that predate the serial_no/machine_no(code) refactor:
        # add serial_no (cheap, no rewrite).  The machine_no INTEGER→VARCHAR(60)
        # type change is intentionally NOT run on every startup (ALTER COLUMN TYPE
        # takes an AccessExclusive lock that can hang behind the collector — see
        # the note near the top of this list).  Do that type change once, manually
        # — see MACHINE_REFACTOR_CHANGELOG.md.
        "ALTER TABLE maintenance_machines ADD COLUMN IF NOT EXISTS serial_no INTEGER",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_machine_serial ON maintenance_machines (zone_name, line_name, serial_no)",

        # Seed sensible plant-wide defaults.

        # ── Maintenance KPI targets (per FY, scoped Zone/Line/Machine) ─────
        # One target value per row, at one of three levels (set by how deep
        # the selection goes): ZONE (zone only), LINE (zone+line) or MACHINE
        # (zone+line+machine_no).  Zone / line / machine_no all come from the
        # Machine Master List (maintenance_machines).  The COALESCE unique index lets
        # re-saving the same (fy, zone, line, machine_no) update its row.
        """
        CREATE TABLE IF NOT EXISTS maintenance_kpi_target (
            id           SERIAL PRIMARY KEY,
            fy           VARCHAR(12)  NOT NULL,
            zone_name    VARCHAR(120) NOT NULL,
            line_name    VARCHAR(120),
            serial_no    INTEGER,
            machine_no   VARCHAR(60),
            machine_name VARCHAR(160),
            level        VARCHAR(10)  NOT NULL,
            kpi_key      VARCHAR(40)  NOT NULL,
            target_value DOUBLE PRECISION NOT NULL,
            created_at   TIMESTAMP DEFAULT NOW(),
            updated_at   TIMESTAMP DEFAULT NOW()
        )
        """,
        # Per-KPI targets: add kpi_key and swap the unique key to include it
        # (so the same scope can hold one target per KPI).  The old index
        # (without kpi_key) is dropped; the new one is named uq_mkt_kpi.
        "ALTER TABLE maintenance_kpi_target ADD COLUMN IF NOT EXISTS kpi_key VARCHAR(40)",
        "DROP INDEX IF EXISTS uq_mkt",
        # MONTHLY (all-zone) targets: a `month` column, and zone_name may be
        # NULL for a MONTHLY row (it applies to every zone).  The unique key now
        # includes month so it's one target per (fy, month, kpi) for monthly,
        # while zone/line/machine rows (month NULL) keep their original key.
        "ALTER TABLE maintenance_kpi_target ADD COLUMN IF NOT EXISTS month VARCHAR(8)",
        "ALTER TABLE maintenance_kpi_target ALTER COLUMN zone_name DROP NOT NULL",
        "DROP INDEX IF EXISTS uq_mkt_kpi",
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_mkt_kpi2
          ON maintenance_kpi_target
          (fy, COALESCE(zone_name,''), COALESCE(line_name,''),
           COALESCE(serial_no,0), COALESCE(month,''), kpi_key)
        """,

        """
        CREATE TABLE IF NOT EXISTS maintenance_deviations (
            id                  SERIAL PRIMARY KEY,
            dev_no              VARCHAR(40) UNIQUE,            -- DEV-2026-0001
            -- maintenance_db me hai hi nahi; FK rehta to nayi DB par ye CREATE
            -- TABLE hi fail ho jaata.
            breakdown_id        INTEGER,
            line_id             INTEGER,
            line_name           VARCHAR(120),
            zone_id             INTEGER,
            zone_name           VARCHAR(120),
            machine_no          VARCHAR(40),
            machine_name        VARCHAR(120),
            -- Header fields (mirror paper Deviation Form)
            category            VARCHAR(60),                   -- "Process" | "In-House" | etc.
            process_name        VARCHAR(160),
            process_no          VARCHAR(60),
            srv_no              VARCHAR(60),
            deviation_qty       INTEGER,
            deviation_upto_qty  INTEGER,
            deviation_upto_date DATE,
            initiated_by        VARCHAR(120),
            initiated_at        TIMESTAMP,
            reason              TEXT,
            -- Non-Conformance
            requirement         TEXT,
            observation         TEXT,
            -- Root Cause
            root_cause_occurrence TEXT,
            root_cause_detection  TEXT,
            potential_consequences TEXT,
            -- Sign-offs (Production HOD + Quality HOD)
            hod_production      VARCHAR(120),
            hod_production_note TEXT,
            hod_quality         VARCHAR(120),
            hod_quality_note    TEXT,
            -- Action plans (each row: {action, resp, deptt, tgt_date, approver, remarks})
            containment_actions JSONB DEFAULT '[]'::JSONB,
            permanent_actions   JSONB DEFAULT '[]'::JSONB,
            -- Extensions list (each row: {from_qty_date, to_qty_date, reason, hod_concerned, sign, hod_quality, hod_operation, status})
            extensions          JSONB DEFAULT '[]'::JSONB,
            closure_remarks     TEXT,
            hod_concerned_close VARCHAR(120),
            hod_quality_close   VARCHAR(120),
            -- Workflow: PENDING_QA → APPROVED → CLOSED  /  REJECTED  /  EXTENDED
            status              VARCHAR(20) NOT NULL DEFAULT 'PENDING_QA',
            raised_by_user_id   INTEGER,
            approved_by_user_id INTEGER,
            approved_at         TIMESTAMP,
            closed_at           TIMESTAMP,
            created_at          TIMESTAMP DEFAULT NOW(),
            updated_at          TIMESTAMP DEFAULT NOW()
        )
        """,
        "CREATE INDEX IF NOT EXISTS idx_q_dev_status  ON maintenance_deviations (status, created_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_q_dev_line    ON maintenance_deviations (line_id, created_at DESC)",
    ]
    # Smart-skip: pre-check existing columns/tables so we don't even acquire
    # a lock on tables where the schema is already in the desired state.
    # This keeps backend startup fast even when the collector is holding
    # read locks on those tables.
    import re as _re
    try:
        with get_conn() as conn:
            cur = conn.cursor()
            cur.execute("""
                SELECT table_name, column_name FROM information_schema.columns
                WHERE table_schema='public'
            """)
            existing_cols = {(r[0], r[1]) for r in cur.fetchall()}
            cur.execute("""
                SELECT table_name FROM information_schema.tables WHERE table_schema='public'
            """)
            existing_tables = {r[0] for r in cur.fetchall()}
            cur.close()
    except Exception as e:
        print(f"[STARTUP] Schema introspection failed: {e}"); existing_cols = set(); existing_tables = set()

    def _is_needed(sql: str) -> bool:
        s = sql.strip().upper()
        # ALTER TABLE <t> ADD COLUMN IF NOT EXISTS <c>
        m = _re.match(r"ALTER TABLE\s+(\w+)\s+ADD COLUMN IF NOT EXISTS\s+(\w+)", s, _re.IGNORECASE)
        if m:
            return (m.group(1).lower(), m.group(2).lower()) not in existing_cols
        # CREATE TABLE IF NOT EXISTS <t>
        m = _re.match(r"CREATE TABLE IF NOT EXISTS\s+(\w+)", s, _re.IGNORECASE)
        if m:
            return m.group(1).lower() not in existing_tables
        # CREATE INDEX IF NOT EXISTS — cheap, let it run
        return True

    skipped = 0
    already  = 0
    for sql in migrations:
        if not _is_needed(sql):
            already += 1
            continue
        try:
            with get_conn() as conn:
                cur = conn.cursor()
                # CRITICAL: use SET LOCAL so the timeout vanishes with the
                # transaction. Plain SET would persist on the pooled connection
                # and poison every later query on that same handle.
                cur.execute("BEGIN")
                cur.execute("SET LOCAL lock_timeout = '3s'")
                cur.execute("SET LOCAL statement_timeout = '10s'")
                cur.execute(sql)
                cur.execute("COMMIT")   # LOCAL settings reset automatically
                cur.close()
        except Exception as m_exc:
            skipped += 1
            # Roll back so the connection is returned to the pool in a clean state.
            try:
                with get_conn() as _c:
                    _c.rollback()
            except Exception:
                pass
            print(f"[MIGRATION] skipped ({type(m_exc).__name__}): {str(m_exc).strip()[:120]}")
    print(f"[STARTUP] migrations: {already} already-applied, {skipped} skipped")

    # Belt-and-suspenders: explicitly reset timeouts on any already-pooled
    # connection that may have been poisoned by a previous instance.
    try:
        with get_conn() as conn:
            c = conn.cursor()
            c.execute("RESET lock_timeout")
            c.execute("RESET statement_timeout")
            conn.commit()
            c.close()
    except Exception:
        pass


# ── Health ─────────────────────────────────────────────────────
@app.get("/api/health")
def health():
    try:
        with get_conn() as conn:
            cur = dict_cursor(conn)
            cur.execute("SELECT COUNT(*) AS n FROM maintenance_machines")
            row = cur.fetchone()
            return {"status": "ok", "machines": row["n"], "version": "2.0.0"}
    except Exception as e:
        return {"status": "error", "detail": str(e)}


# ── Audit ──────────────────────────────────────────────────────

def write_audit(conn, *, action, entity_type=None, entity_id=None,
                details=None, user=None):
    """Idempotent helper: append one row to maintenance_audit_log.

    2026-05-18 — Centralised so every endpoint that wants an audit
    trail can call this with a single line.  `user` is the dict
    returned by get_current_user() (has id + username); if omitted,
    user_id/username land NULL (e.g. system-driven events).
    Never raises — audit must never block business logic.
    """
    try:
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO maintenance_audit_log
                   (action, entity_type, entity_id, details,
                    user_id, username)
               VALUES (%s, %s, %s, %s, %s, %s)""",
            (action,
             entity_type,
             int(entity_id) if entity_id is not None else None,
             details,
             (user or {}).get("id"),
             (user or {}).get("username"))
        )
    except Exception as exc:
        try: conn.rollback()
        except Exception: pass
        print(f"[AUDIT] write failed action={action}: {exc}")


@app.get("/api/audit")
def audit_log(
    limit:     int = 50,
    offset:    int = 0,
    date_from: str = None,
    date_to:   str = None,
    action:    str = None,
    username:  str = None,
    user=Depends(get_current_user)
):
    """Paged audit-log read.  Optional filters:
      • date_from / date_to (inclusive)
      • action  — exact match
      • username — filter to one user (NEW 2026-05-18)
    """
    with get_conn() as conn:
        cur    = dict_cursor(conn)
        where  = []
        params = []
        if date_from:
            where.append("created_at >= %s")
            params.append(date_from + " 00:00:00")
        if date_to:
            where.append("created_at <= %s")
            params.append(date_to + " 23:59:59")
        if action:
            where.append("action = %s")
            params.append(action)
        if username:
            where.append("username = %s")
            params.append(username)

        where_sql = ("WHERE " + " AND ".join(where)) if where else ""
        cur.execute(f"SELECT COUNT(*) as total FROM maintenance_audit_log {where_sql}", params)
        total = cur.fetchone()["total"]
        cur.execute(f"""
            SELECT * FROM maintenance_audit_log {where_sql}
            ORDER BY created_at DESC LIMIT %s OFFSET %s
        """, params + [limit, offset])
        return {
            "logs":     cur.fetchall(),
            "total":    total,
            "offset":   offset,
            "limit":    limit,
            "has_more": (offset + limit) < total,
        }


@app.get("/api/audit/actions")
def audit_actions(user=Depends(get_current_user)):
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT DISTINCT action FROM maintenance_audit_log ORDER BY action")
        return [r["action"] for r in cur.fetchall()]


@app.get("/api/audit/users")
def audit_users(user=Depends(get_current_user)):
    """Return every user with their last login + 24-h activity count.

    2026-05-18 — Backs the "Users · Last Login" top card on the Audit
    page so admin can see at-a-glance who's actively using the system.
    Joins maintenance_users (canonical user list) with a lateral aggregate of
    maintenance_audit_log for last-action time + 24-h count.
    """
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("""
            -- 2026-08-07: department ka JOIN hata diya, `maintenance_departments`
            -- table ab hai hi nahi (app sirf Maintenance ka hai).
            SELECT u.id, u.username, u.role, u.last_login,
                   (SELECT COUNT(*) FROM maintenance_audit_log a
                     WHERE a.username = u.username
                       AND a.created_at >= NOW() - INTERVAL '24 hours') AS actions_24h,
                   (SELECT MAX(created_at) FROM maintenance_audit_log a
                     WHERE a.username = u.username) AS last_action_at
            FROM maintenance_users u
            ORDER BY (u.last_login IS NULL), u.last_login DESC, u.username
        """)
        return cur.fetchall()


@app.get("/api/audit/logins")
def audit_logins(fy: str = "", month: str = "", date: str = "", username: str = "",
                 user=Depends(get_current_user)):
    """Login/Logout activity — kisne kab login kiya, kab logout.  Har AUTH_LOGIN
    ko usi user ke agle AUTH_LOGOUT se pair karta hai (logout_at NULL = abhi tak
    logout nahi hua).  Filters: fy(2026-27) · month(YYYY-MM) · date(YYYY-MM-DD) ·
    username.  Sab optional, AND me lagte hain."""
    where, params = ["l.action='AUTH_LOGIN'"], []
    if fy:
        try:
            y = int(str(fy).split("-")[0])
            where.append("l.created_at >= %s AND l.created_at < %s"); params += [f"{y}-04-01", f"{y + 1}-04-01"]
        except Exception:
            pass
    if month:
        where.append("to_char(l.created_at,'YYYY-MM') = %s"); params.append(month)
    if date:
        where.append("l.created_at::date = %s"); params.append(date)
    if username:
        where.append("l.username = %s"); params.append(username)
    w = " AND ".join(where)
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute(f"""
            SELECT l.username,
                   (SELECT u.role FROM maintenance_users u WHERE u.username = l.username) AS role,
                   l.created_at AS login_at,
                   (SELECT MIN(o.created_at) FROM maintenance_audit_log o
                     WHERE o.username = l.username AND o.action = 'AUTH_LOGOUT'
                           AND o.created_at > l.created_at) AS logout_at
              FROM maintenance_audit_log l
             WHERE {w}
             ORDER BY l.created_at DESC
             LIMIT 500
        """, params)
        rows = cur.fetchall()
        cur.execute("SELECT DISTINCT username FROM maintenance_audit_log WHERE action='AUTH_LOGIN' AND username IS NOT NULL ORDER BY username")
        users = [r["username"] for r in cur.fetchall()]
    return {"rows": rows, "users": users}


@app.get("/api/audit/active-logins")
def audit_active_logins(user=Depends(get_current_user)):
    """Abhi kaun-kaun logged-in hai — har user ka LATEST login jo token-window
    ({TOKEN_EXPIRE_HOURS}h) ke andar hai AUR uske baad koi AUTH_LOGOUT nahi.
    JWT stateless hai isliye ye best-effort estimate hai (bina logout ke browser
    band karo to token expiry tak "active" dikhega)."""
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("""
            SELECT t.username,
                   (SELECT u.role FROM maintenance_users u WHERE u.username = t.username) AS role,
                   (SELECT u.id   FROM maintenance_users u WHERE u.username = t.username) AS user_id,
                   t.login_at
              FROM (SELECT l.username, l.created_at AS login_at,
                           ROW_NUMBER() OVER (PARTITION BY l.username ORDER BY l.created_at DESC) AS rn
                      FROM maintenance_audit_log l WHERE l.action = 'AUTH_LOGIN') t
             WHERE t.rn = 1
               AND t.login_at >= NOW() - (%s * INTERVAL '1 hour')
               AND NOT EXISTS (SELECT 1 FROM maintenance_audit_log o
                               WHERE o.username = t.username AND o.action = 'AUTH_LOGOUT'
                                     AND o.created_at > t.login_at)
             ORDER BY t.login_at DESC
        """, (TOKEN_EXPIRE_HOURS,))
        return {"rows": cur.fetchall(), "token_hours": TOKEN_EXPIRE_HOURS}


@app.delete("/api/audit/logins")
def clear_login_history(date_from: str = "", date_to: str = "", user=Depends(require_admin)):
    """Login/Logout history (AUTH_LOGIN/AUTH_LOGOUT rows) ko date-range me CLEAR
    karo — Login History tab ke "Clear History" se.  date_from/date_to
    (YYYY-MM-DD, inclusive) — dono khali ho to SAARI login history.  Admin only."""
    where, params = ["action IN ('AUTH_LOGIN','AUTH_LOGOUT')"], []
    if date_from:
        where.append("created_at >= %s"); params.append(date_from + " 00:00:00")
    if date_to:
        where.append("created_at <= %s"); params.append(date_to + " 23:59:59")
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute(f"DELETE FROM maintenance_audit_log WHERE {' AND '.join(where)}", params)
        n = cur.rowcount
        conn.commit()
    return {"ok": True, "deleted": n}


# ── Ping check (TCP connect test for camera/device IPs) ──────
@app.get("/api/ping")
def ping_host(ip: str, port: int = 554, user=Depends(get_current_user)):
    """TCP connect test. Returns {ok: true/false, ms: latency}.
    Used by admin Camera List page to show online/offline status.

    SECURITY: login ZAROORI hai.  Ye kisi bhi host:port par connect kar ke
    bata deta hai wo khula hai ya nahi — bina auth ke ye poore andar ke
    network ka free port-scanner ban jaata (koi bhi jo backend tak pahunch
    sakta hai, PLC/DB/camera sab tatol leta)."""
    import socket, time as _t
    try:
        t0 = _t.time()
        s = socket.create_connection((ip, port), timeout=3)
        ms = round((_t.time() - t0) * 1000)
        s.close()
        return {"ok": True, "ms": ms}
    except Exception:
        return {"ok": False, "ms": 0}


# ── Backend root — sirf ek info line.  Asli UI frontend (:9965) par hai; ye
# API server hai.  (Pehle yahan legacy admin.html/fullscreen.html serve hote
# the — ab hata diye, koi bhi frontend/script unhe use nahi karta tha.)
@app.get("/", response_class=HTMLResponse)
def serve_root():
    return HTMLResponse(
        "<h2>Backend running</h2>"
        "<p>Ye API server hai. App yahan: "
        "<a href='http://localhost:9965'>http://localhost:9965</a> · "
        "API docs: <a href='/docs'>/docs</a></p>"
    )


# ── AI Chat ────────────────────────────────────────────────────
# ── AI schema cache (loaded once, refreshed every 5 min) ──────────────────
_AI_SCHEMA_CACHE = {"ts": 0.0, "prompt": "", "lines": []}

def _get_ai_schema_info():
    """Build the schema block for the AI system prompt. Cached for 5 minutes
    so we don't hammer the DB on every chat message."""
    import time as _t
    if _AI_SCHEMA_CACHE["prompt"] and (_t.time() - _AI_SCHEMA_CACHE["ts"]) < 300:
        return _AI_SCHEMA_CACHE["prompt"], _AI_SCHEMA_CACHE["lines"]
    try:
        with get_conn() as conn:
            cur = dict_cursor(conn)
            cur.execute("""
                SELECT DISTINCT zone_name, line_name
                  FROM maintenance_machines
                 WHERE is_active = TRUE
                 ORDER BY zone_name, line_name
            """)
            lines = cur.fetchall()
            schema_info = "ZONES / LINES (Machine Master se):\n"
            for l in lines:
                schema_info += f"  {l['zone_name']} -> {l['line_name']}\n"
            schema_info += (
                "\nMAINTENANCE TABLES:\n"
                "  andon_system / andon_history - ANDON calls (zone, line, "
                "started_at, acknowledged_at, ended_at, duration_seconds)\n"
                "  maintenance_auto_breakdown_slip - ANDON se auto bani slip\n"
                "  maintenance_breakdown_data - manual Break Down Slip\n"
                "  maintenance_yearly_pm_shedule / maintenance_pm_check_point - PM\n"
                "  machine_dmc / machine_dmc_filled - daily machine check\n"
                "  maintenance_spare, maintenance_qpr, maintenance_skill_eval\n"
                "MASTER: maintenance_machines(zone_name, line_name, machine_no, machine_name)"
            )
            _AI_SCHEMA_CACHE["prompt"] = schema_info
            _AI_SCHEMA_CACHE["lines"]  = lines
            _AI_SCHEMA_CACHE["ts"]     = _t.time()
            return schema_info, lines
    except Exception as e:
        return f"(schema load error: {e})", []


@app.post("/api/ai/chat")
async def ai_chat(request: Request, user=Depends(get_current_user)):
    """Fast AI chat — Haiku model, cached schema, smaller token budget, lower
    tool-iteration cap.  Typical response 2-10 s (was 1-3 min)."""
    import anthropic

    body    = await request.json()
    message = body.get("message", "").strip()
    context = body.get("context", {})
    history = body.get("history", [])

    if not message:
        raise HTTPException(400, "Message required")

    today     = datetime.now().date()
    yesterday = today - timedelta(days=1)
    schema_info, _ = _get_ai_schema_info()

    # Compact prompt — fewer tokens = much faster response.
    system_prompt = (
        f"You are the production-data assistant for Toyota Boshoku Device India, Bawal.\n"
        f"Today={today}  Yesterday={yesterday}  Page={context.get('page','Dashboard')}\n\n"
        f"{schema_info}\n\n"
        "RULES:\n"
        "- ALWAYS use run_query for data; never guess numbers.\n"
        "- SELECT only.  Use record_date='YYYY-MM-DD' and shift_name='A'/'B'.\n"
        "- Be brief: one-line answer + short table or bullets. No preamble.\n"
        "- Format OEE as %, times as HH:MM:SS.\n"
        "- Prefer ONE well-written query over many small ones."
    )

    tools = [{
        "name": "run_query",
        "description": "Execute a SQL SELECT on the PostgreSQL DB.",
        "input_schema": {
            "type": "object",
            "properties": {
                "sql":         {"type": "string"},
                "description": {"type": "string"},
            },
            "required": ["sql"],
        },
    }]

    # Tables the AI query tool must never expose (credentials / audit /
    # permission map).  The bcrypt hashes in maintenance_users would be crackable
    # offline if dumped, so this is a hard block.
    _AI_BLOCKED_TABLES = ("maintenance_users", "maintenance_audit_log", "maintenance_user_permissions")

    def execute_query(sql: str) -> str:
        # SECURITY: the model authors this SQL.  Constrain it to a single
        # read-only SELECT — startswith("SELECT") alone was bypassable
        # (multi-statement `SELECT 1; UPDATE ...` and read-only-but-sensitive
        # dumps / pg_read_file both slipped through).
        import re as _re
        sql = (sql or "").strip().rstrip(";").strip()
        low = sql.lower()
        if ";" in sql:                                    # one statement only
            return "Error: only a single SELECT statement is allowed."
        if not (low.startswith("select") or low.startswith("with")):
            return "Error: only SELECT allowed."
        # block write / DDL / file / dblink keywords anywhere (incl. CTEs/subqueries)
        if _re.search(r"\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|"
                      r"copy|call|do|merge|lo_import|lo_export|pg_read_file|pg_read_binary_file|"
                      r"pg_ls_dir|pg_stat_file|dblink)\b", low):
            return "Error: only read-only SELECT is allowed."
        if any(t in low for t in _AI_BLOCKED_TABLES):
            return "Error: that table is not queryable."
        try:
            with get_conn() as conn:
                cur  = dict_cursor(conn)
                cur.execute("SET TRANSACTION READ ONLY")   # belt-and-suspenders: DB rejects any write
                cur.execute("SET LOCAL statement_timeout = '8s'")
                cur.execute(sql)
                rows = cur.fetchall()
                if not rows:
                    return "No rows."
                if len(rows) == 1 and len(rows[0]) == 1:
                    return str(list(rows[0].values())[0])
                headers = list(rows[0].keys())
                out     = [" | ".join(str(h) for h in headers)]
                for row in rows[:20]:     # was 50 — tighter context
                    out.append(" | ".join(
                        str(v) if v is not None else "-" for v in row.values()))
                if len(rows) > 20:
                    out.append(f"... +{len(rows)-20} more rows")
                return "\n".join(out)
        except Exception as e:
            return f"Query error: {str(e)[:200]}"

    try:
        client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
        msgs   = []
        # Shorter history — only last 4 turns instead of 8. Each history
        # message can be big, so this drops a lot of input tokens.
        for h in history[-4:]:
            msgs.append({"role": h["role"], "content": h["content"]})
        msgs.append({"role": "user", "content": message})

        # Model choice:
        #  - AI_MODEL env override wins (pick any Anthropic model ID).
        #  - Default = Haiku 4.5 — fastest tier available on this account
        #    (this account doesn't have Haiku 3.5 access). Set
        #    AI_MODEL=claude-sonnet-4-6 for heavier reasoning at +latency.
        model = os.getenv("AI_MODEL", "claude-haiku-4-5")

        # Cap tool-use loops to 3 instead of 5. Each iteration = full round-trip
        # to Anthropic + DB, which is the biggest source of latency.
        max_iterations = 3
        iteration      = 0
        while iteration < max_iterations:
            iteration += 1
            resp = client.messages.create(
                model      = model,
                max_tokens = 1024,         # was 2048 — shorter outputs
                system     = system_prompt,
                tools      = tools,
                messages   = msgs,
            )
            if resp.stop_reason == "end_turn":
                reply = ""
                for block in resp.content:
                    if hasattr(block, "text"):
                        reply += block.text
                return {"reply": reply.strip(), "provider": model.split("-")[1] if "-" in model else "claude"}
            if resp.stop_reason == "tool_use":
                msgs.append({"role": "assistant", "content": resp.content})
                tool_results = []
                for block in resp.content:
                    if block.type == "tool_use":
                        sql         = block.input.get("sql", "")
                        description = block.input.get("description", "")
                        print(f"[AI] {description or sql[:60]}")
                        result = execute_query(sql)
                        tool_results.append({
                            "type":        "tool_result",
                            "tool_use_id": block.id,
                            "content":     result,
                        })
                msgs.append({"role": "user", "content": tool_results})
                continue
            break

        return {"reply": "Unable to complete analysis. Please rephrase.", "provider": "claude"}

    except Exception as e:
        print(f"[AI] Error: {e}")
        raise HTTPException(500, f"AI error: {str(e)}")




# ── Entry point ────────────────────────────────────────────────
if __name__ == "__main__":
    print("\n" + "=" * 65)
    print("  Platform — Toyota Boshoku Device India Pvt. Ltd.")
    print("=" * 65)
    uvicorn.run("main:app", host="0.0.0.0", port=8892, reload=False, workers=1)