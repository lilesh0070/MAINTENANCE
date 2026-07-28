"""
routers/breakdown_slips.py
==========================
Standalone storage for the MANUAL "Break Down Slip" (raised from the sidebar
→ Breakdown Slip).  This is intentionally SEPARATE from mes_breakdowns:

  • It does NOT touch mes_breakdowns / the collector / ANDON / KPI at all.
  • Every slip field is stored as its own flat column in `mes_breakdown_data`.
  • No foreign key / link back to mes_breakdowns — fully decoupled.

Endpoint
--------
POST /api/breakdown-slips/   → insert one filled slip, returns {id}
GET  /api/breakdown-slips/   → list (newest first) for a simple register view
"""
from typing import Optional, List
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from database import get_conn, dict_cursor
from auth import get_current_user

router = APIRouter(prefix="/api/breakdown-slips", tags=["breakdown-slips"])

_ensured = False


def _ensure_table():
    """Create mes_breakdown_data once (idempotent).  Called lazily on first use
    so the app still boots when the DB is down."""
    global _ensured
    if _ensured:
        return
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS mes_breakdown_data (
                id                             SERIAL PRIMARY KEY,
                -- Upper half (Production)
                zone                           VARCHAR(60),
                line                           VARCHAR(60),
                machine_no                     VARCHAR(60),
                machine_name                   VARCHAR(160),
                slip_date                      DATE,
                shift                          VARCHAR(20),
                line_leader_name               VARCHAR(120),
                model_no                       VARCHAR(60),
                machine_operator_name          VARCHAR(120),
                category                       VARCHAR(40),
                bd_start_time                  VARCHAR(5),
                bd_received_time               VARCHAR(5),
                bd_ok_time                     VARCHAR(5),
                bd_start_date                  DATE,
                bd_end_date                    DATE,
                mc_down_time_minutes           INTEGER,
                problem_reported_by_production TEXT,
                -- Lower half (Maintenance / Tool Room)
                problem_related_to             VARCHAR(20),
                type_electrical                BOOLEAN DEFAULT FALSE,
                type_mechanical                BOOLEAN DEFAULT FALSE,
                problem_observed_by_maintenance        TEXT,
                action_taken_on_problem        TEXT,
                spares_used                    TEXT,
                bd_attended_by                 VARCHAR(160),
                prepared_by_name               VARCHAR(120),
                received_by_name               VARCHAR(120),
                line_leader_operator_name      VARCHAR(120),
                quality_engineer_name          VARCHAR(120),
                -- audit
                submitted_by_user_id           INTEGER,
                submitted_at                   TIMESTAMP DEFAULT NOW()
            )
        """)
        # NOTE: the old reporting view mes_breakdown_data_v has been REMOVED.
        # KPI / History / Analysis / CAPA now read mes_breakdown_data DIRECTLY
        # (breakdowns.py inlines the same column-alias mapping as _BD_SRC).
        # Drop it FIRST — it depends on the `category` column, so the widen
        # below would otherwise fail with "cannot alter type of a column used
        # by a view" and abort this whole migration.
        cur.execute("DROP VIEW IF EXISTS mes_breakdown_data_v")
        # 2026-07-28: actual_problem_observed renamed to
        # problem_observed_by_maintenance (to match the Log Book).  Guarded so
        # it runs once on an existing table; fresh tables already use the new
        # name (see CREATE above).
        cur.execute("""
            DO $$
            BEGIN
              IF EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_name='mes_breakdown_data'
                            AND column_name='actual_problem_observed')
                 AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_name='mes_breakdown_data'
                            AND column_name='problem_observed_by_maintenance')
              THEN
                ALTER TABLE mes_breakdown_data
                  RENAME COLUMN actual_problem_observed TO problem_observed_by_maintenance;
              END IF;
            END $$;
        """)
        # Legacy category values are descriptive ('Mechanical', 'PLC / Software'),
        # not just 'A'/'B'/'C' — widen an existing VARCHAR(1) column if present.
        cur.execute("ALTER TABLE mes_breakdown_data ALTER COLUMN category TYPE VARCHAR(40)")
        # Repeatable Spare Details — full list stored as JSONB.  `spares_used`
        # (above) stays as a one-line text summary for the flat/legacy readers.
        cur.execute("ALTER TABLE mes_breakdown_data ADD COLUMN IF NOT EXISTS spares JSONB")
        # Response time (Start→Received) + breakdown frequency (default 1).
        cur.execute("ALTER TABLE mes_breakdown_data ADD COLUMN IF NOT EXISTS response_time_minutes INTEGER")
        cur.execute("ALTER TABLE mes_breakdown_data ADD COLUMN IF NOT EXISTS frequency INTEGER DEFAULT 1")
        conn.commit()
    _ensured = True


class BreakdownSlipIn(BaseModel):
    # `model_no` would otherwise trip Pydantic v2's protected "model_" namespace.
    model_config = {"protected_namespaces": ()}
    # Upper half
    zone: Optional[str] = None
    line: Optional[str] = None
    machine_no: Optional[str] = None
    machine_name: Optional[str] = None
    slip_date: Optional[str] = None
    shift: Optional[str] = None
    line_leader_name: Optional[str] = None
    model_no: Optional[str] = None
    machine_operator_name: Optional[str] = None
    category: Optional[str] = None
    bd_start_time: Optional[str] = None
    bd_received_time: Optional[str] = None
    bd_ok_time: Optional[str] = None
    bd_start_date: Optional[str] = None
    bd_end_date: Optional[str] = None
    mc_down_time_minutes: Optional[int] = None
    response_time_minutes: Optional[int] = None    # auto: Start → Received
    frequency: Optional[int] = 1                    # breakdown frequency, default 1
    problem_reported_by_production: Optional[str] = None
    # Lower half
    problem_related_to: Optional[str] = None            # 'maintenance' | 'tool_room'
    type_electrical: bool = False
    type_mechanical: bool = False
    problem_observed_by_maintenance: Optional[str] = None
    action_taken_on_problem: Optional[str] = None
    spares_used: Optional[str] = None
    bd_attended_by: Optional[str] = None
    prepared_by_name: Optional[str] = None
    received_by_name: Optional[str] = None
    line_leader_operator_name: Optional[str] = None
    quality_engineer_name: Optional[str] = None
    # repeatable Spare Details: [{spare_name, spare_model_no, spare_cnmm_no, spare_qty}, …]
    spares: Optional[List[dict]] = None


# Columns written on insert, in order (excludes id / submitted_at defaults).
_COLS = [
    "zone", "line", "machine_no", "machine_name", "slip_date", "shift",
    "line_leader_name", "model_no", "machine_operator_name", "category",
    "bd_start_time", "bd_received_time", "bd_ok_time", "bd_start_date",
    "bd_end_date", "mc_down_time_minutes", "response_time_minutes", "frequency",
    "problem_reported_by_production",
    "problem_related_to", "type_electrical", "type_mechanical",
    "problem_observed_by_maintenance", "action_taken_on_problem", "spares_used",
    "bd_attended_by", "prepared_by_name", "received_by_name",
    "line_leader_operator_name", "quality_engineer_name",
]


def _blank_to_none(v):
    """Empty strings → NULL so DATE/text columns stay clean."""
    if isinstance(v, str) and v.strip() == "":
        return None
    return v


def _to_int(v):
    """Coerce a possibly-string / blank down-time value to int or None."""
    if v is None or (isinstance(v, str) and v.strip() == ""):
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _insert_flat(conn, flat: dict, user_id):
    """INSERT one flat row into mes_breakdown_data; returns the new id.
    The flat columns go in as-is; `spares` (a list) is stored as JSONB."""
    from psycopg2.extras import Json
    # drop completely-blank spare rows so an unused "Add" never persists
    spares = [s for s in (flat.get("spares") or [])
              if isinstance(s, dict) and any(str(v or "").strip() for v in s.values())]
    vals = [_blank_to_none(flat.get(c)) for c in _COLS]
    vals.append(Json(spares) if spares else None)
    vals.append(user_id)
    cols_sql = ", ".join(_COLS + ["spares", "submitted_by_user_id"])
    ph = ", ".join(["%s"] * (len(_COLS) + 2))
    cur = conn.cursor()
    cur.execute(
        f"INSERT INTO mes_breakdown_data ({cols_sql}) VALUES ({ph}) RETURNING id", vals,
    )
    return cur.fetchone()[0]


def mirror_from_halves(conn, prod: dict, maint: dict, user_id,
                       started_at=None, ended_at=None):
    """Flatten a CLOSED breakdown's production + maintenance halves into a
    standalone mes_breakdown_data row.  Called from the breakdown close flow so
    AUTO (collector) breakdowns land in the new table too — a one-way copy of
    the filled slip, with NO stored link back to mes_breakdowns.

    started_at / ended_at (the collector-stamped timestamps) are used only as a
    FALLBACK to fill down-time minutes + the slip dates when the slip itself
    didn't carry them — so KPI aggregates stay accurate."""
    _ensure_table()
    prod = prod or {}
    maint = maint or {}
    prt = maint.get("problem_related_to") or {}
    top = maint.get("type_of_problem") or {}
    flat = {
        "zone": prod.get("zone"), "line": prod.get("line"),
        "machine_no": prod.get("machine_no"), "machine_name": prod.get("machine_name"),
        "slip_date": prod.get("date"), "shift": prod.get("shift"),
        "line_leader_name": prod.get("line_leader_name"), "model_no": prod.get("model_no"),
        "machine_operator_name": prod.get("machine_operator_name"),
        "category": prod.get("category"),
        "bd_start_time": prod.get("bd_start_time"),
        "bd_received_time": prod.get("bd_received_time"),
        "bd_ok_time": prod.get("bd_ok_time"),
        "bd_start_date": prod.get("bd_start_date"),
        "bd_end_date": prod.get("bd_end_date"),
        "mc_down_time_minutes": _to_int(prod.get("mc_down_time_minutes")),
        "response_time_minutes": _to_int(prod.get("response_time_minutes")),
        "frequency": _to_int(prod.get("frequency")) or 1,
        "problem_reported_by_production": prod.get("problem_reported_by_production"),
        "problem_related_to": "maintenance" if prt.get("maintenance")
                              else ("tool_room" if prt.get("tool_room") else None),
        "type_electrical": bool(top.get("electrical")),
        "type_mechanical": bool(top.get("mechanical")),
        "problem_observed_by_maintenance": maint.get("problem_observed_by_maintenance"),
        "action_taken_on_problem": maint.get("action_taken_on_problem"),
        "spares_used": maint.get("spares_used"),
        "bd_attended_by": maint.get("bd_attended_by"),
        "spares": maint.get("spares"),          # repeatable Spare Details (JSONB)
        "prepared_by_name": (maint.get("prepared_by") or {}).get("name"),
        "received_by_name": (maint.get("received_by") or {}).get("name"),
        "line_leader_operator_name": (maint.get("line_leader_operator") or {}).get("name"),
        "quality_engineer_name": (maint.get("quality_engineer") or {}).get("name"),
    }
    # Fallbacks from the collector timestamps so KPI (down-time, date) stays
    # accurate even when the slip fields were left blank.
    if flat["mc_down_time_minutes"] is None and started_at and ended_at:
        flat["mc_down_time_minutes"] = max(int(round((ended_at - started_at).total_seconds() / 60)), 0)
    if not flat["bd_start_date"] and started_at:
        flat["bd_start_date"] = started_at.date()
    if not flat["slip_date"] and started_at:
        flat["slip_date"] = started_at.date()
    if not flat["bd_end_date"] and ended_at:
        flat["bd_end_date"] = ended_at.date()
    return _insert_flat(conn, flat, user_id)


@router.post("/", status_code=201)
def create_slip(body: BreakdownSlipIn, user=Depends(get_current_user)):
    """Insert one filled (manual) Break Down Slip into mes_breakdown_data."""
    _ensure_table()
    with get_conn() as conn:
        new_id = _insert_flat(conn, body.model_dump(), user["id"])
        conn.commit()
    # Record this slip's spares into maintenance_spare (own txn, best-effort).
    try:
        from routers.maintenance_spare import record_usage
        with get_conn() as sconn:
            record_usage(sconn, "Manual Slip", {
                "zone": body.zone, "line": body.line,
                "machine_no": body.machine_no, "machine_name": body.machine_name,
                "used_date": body.slip_date or body.bd_start_date,
            }, body.spares)
    except Exception as e:
        print(f"[SPARE-MASTER] record failed (slip): {e}")
    return {"id": new_id, "ok": True}


@router.get("/")
def list_slips(user=Depends(get_current_user)) -> List[dict]:
    """Newest-first list of filled slips (simple register view)."""
    _ensure_table()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT * FROM mes_breakdown_data ORDER BY id DESC LIMIT 1000")
        return cur.fetchall()
