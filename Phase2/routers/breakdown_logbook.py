"""
routers/breakdown_logbook.py
============================
Breakdown Log Book — one row per breakdown entry (the "BREAKDOWN LOG BOOK —
NEW ENTRY" form).  Self-contained table `maintenance_logbook_db_history` created on
first use (no main.py bootstrap needed).

Endpoints (prefix /api/breakdown-logbook)
-----------------------------------------
GET    /            List entries (optional ?date=YYYY-MM-DD, newest first)
POST   /            Create one entry
DELETE /{id}        Delete one entry
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from database import get_conn, dict_cursor
from auth import get_current_user

router = APIRouter(prefix="/api/breakdown-logbook", tags=["breakdown-logbook"])


def _ensure_table() -> None:
    with get_conn() as conn:
        cur = conn.cursor()
        # If this data previously lived in mes_breakdown_logbook, rename it to
        # the new name (preserves every existing row).  Runs once; afterwards
        # the old table no longer exists so this is a cheap no-op.
        cur.execute("""
            DO $$
            BEGIN
              IF EXISTS (SELECT 1 FROM information_schema.tables
                          WHERE table_name='mes_breakdown_logbook')
                 AND NOT EXISTS (SELECT 1 FROM information_schema.tables
                          WHERE table_name='maintenance_logbook_db_history')
              THEN
                ALTER TABLE mes_breakdown_logbook RENAME TO maintenance_logbook_db_history;
              END IF;
            END $$;
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS maintenance_logbook_db_history (
                id                    SERIAL PRIMARY KEY,
                serial_no             INTEGER,
                shift                 VARCHAR(8),
                zone                  VARCHAR(120),
                line                  VARCHAR(120),
                machine_no            VARCHAR(60),
                machine_name          VARCHAR(160),
                bd_date               DATE,
                bd_start_time         VARCHAR(8),
                bd_ok_time            VARCHAR(8),
                mc_down_time_minutes  VARCHAR(20),
                solve_time_hours      VARCHAR(20),
                problem_observed_by_maintenance TEXT,
                action_taken_on_problem TEXT,
                spare_name            TEXT,
                spare_model_no        VARCHAR(120),
                spare_cnmm_no         VARCHAR(120),
                spare_qty             VARCHAR(40),
                spares                JSONB,
                bd_attended_by        VARCHAR(160),
                created_by            VARCHAR(120),
                created_at            TIMESTAMP DEFAULT NOW()
            )
        """)
        # The Log Book table now mirrors EXACTLY what the frontend Log Book
        # (BreakdownLogBook) saves.  Drop the legacy columns the current form
        # never fills — old fuller-format leftovers + History-Card-only blanks.
        for _col in ("nature_of_work", "problem_production", "actual_problem_observed",
                     "spare_used", "spares_detail", "category", "remarks",
                     "knockout_production", "cumulative_production", "total_production",
                     "bd_received_time", "problem_repeated", "spare_part_code",
                     "tool_room_maintenance", "handover_to", "root_cause", "bd_response_time"):
            cur.execute(f"ALTER TABLE maintenance_logbook_db_history DROP COLUMN IF EXISTS {_col}")
        conn.commit()


# Column order used for INSERT (everything except id / created_at).
FIELDS = [
    "serial_no", "shift", "zone", "line", "machine_no", "machine_name", "bd_date",
    "bd_start_time", "bd_ok_time", "mc_down_time_minutes", "solve_time_hours",
    "problem_observed_by_maintenance", "action_taken_on_problem",
    "spare_name", "spare_model_no", "spare_cnmm_no", "spare_qty", "bd_attended_by",
]


class EntryIn(BaseModel):
    serial_no:               Optional[int] = None
    shift:                   Optional[str] = None
    zone:                    Optional[str] = None
    line:                    Optional[str] = None
    machine_no:              Optional[str] = None
    machine_name:            Optional[str] = None
    bd_date:                 Optional[str] = None
    bd_start_time:           Optional[str] = None
    bd_ok_time:              Optional[str] = None
    mc_down_time_minutes:    Optional[str] = None
    solve_time_hours:        Optional[str] = None
    problem_observed_by_maintenance: Optional[str] = None
    action_taken_on_problem: Optional[str] = None
    spare_name:              Optional[str] = None
    spare_model_no:          Optional[str] = None
    spare_cnmm_no:           Optional[str] = None
    spare_qty:               Optional[str] = None
    bd_attended_by:          Optional[str] = None


def _author(user) -> str:
    if isinstance(user, dict):
        return user.get("username") or user.get("name") or "user"
    return getattr(user, "username", None) or "user"


@router.get("/")
def list_entries(date: Optional[str] = Query(None, description="bd_date YYYY-MM-DD"),
                 user=Depends(get_current_user)):
    _ensure_table()
    sql = "SELECT * FROM maintenance_logbook_db_history"
    params: list = []
    if date:
        sql += " WHERE bd_date = %s"
        params.append(date)
    sql += " ORDER BY created_at DESC, id DESC LIMIT 2000"
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute(sql, params)
        return cur.fetchall()


@router.post("/", status_code=201)
def create_entry(body: EntryIn, user=Depends(get_current_user)):
    _ensure_table()
    data = body.model_dump()
    # blank date string -> NULL (DATE column can't take "")
    if not (data.get("bd_date") or "").strip():
        data["bd_date"] = None
    cols   = FIELDS + ["created_by"]
    vals   = [data.get(f) for f in FIELDS] + [_author(user)]
    holders = ",".join(["%s"] * len(cols))
    with get_conn() as conn:
        cur = conn.cursor()
        try:
            cur.execute(
                f"INSERT INTO maintenance_logbook_db_history ({','.join(cols)}) "
                f"VALUES ({holders}) RETURNING id",
                vals,
            )
            new_id = cur.fetchone()[0]
            conn.commit()
        except Exception as e:
            conn.rollback()
            raise HTTPException(400, f"Save failed: {e}")
    return {"id": new_id}


@router.delete("/{entry_id}")
def delete_entry(entry_id: int, user=Depends(get_current_user)):
    _ensure_table()
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM maintenance_logbook_db_history WHERE id=%s", (entry_id,))
        if cur.rowcount == 0:
            raise HTTPException(404, "Entry not found")
        conn.commit()
    return {"ok": True}
