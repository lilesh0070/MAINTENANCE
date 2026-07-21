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
                shift                 VARCHAR(8),
                zone_name             VARCHAR(120),
                line_name             VARCHAR(120),
                machine_no            VARCHAR(60),
                machine_name          VARCHAR(160),
                bd_date               DATE,
                nature_of_work        VARCHAR(60),
                problem_production    TEXT,
                problem_maintenance   TEXT,
                action_taken          TEXT,
                knockout_production   VARCHAR(40),
                cumulative_production VARCHAR(40),
                total_production      VARCHAR(40),
                bd_start_time         VARCHAR(8),
                bd_received_time      VARCHAR(8),
                bd_ok_time            VARCHAR(8),
                solve_time_min        VARCHAR(20),
                solve_time_hours      VARCHAR(20),
                problem_repeated      VARCHAR(8),
                spare_used            VARCHAR(8),
                spares_detail         TEXT,
                spare_part_code       VARCHAR(120),
                spare_qty             VARCHAR(40),
                attended_by           VARCHAR(160),
                tool_room_maintenance VARCHAR(8),
                handover_to           VARCHAR(160),
                category              VARCHAR(40),
                remarks               TEXT,
                created_by            VARCHAR(120),
                created_at            TIMESTAMP DEFAULT NOW()
            )
        """)
        # Extra columns from the Machine-History-Card format (root cause +
        # B/D response time) so the Log Book list can show every column.
        cur.execute("ALTER TABLE maintenance_logbook_db_history ADD COLUMN IF NOT EXISTS root_cause TEXT")
        cur.execute("ALTER TABLE maintenance_logbook_db_history ADD COLUMN IF NOT EXISTS bd_response_time VARCHAR(20)")
        conn.commit()


# Column order used for INSERT (everything except id / created_at).
FIELDS = [
    "shift", "zone_name", "line_name", "machine_no", "machine_name", "bd_date",
    "nature_of_work", "problem_production", "problem_maintenance", "root_cause",
    "action_taken", "knockout_production", "cumulative_production", "total_production",
    "bd_start_time", "bd_received_time", "bd_response_time", "bd_ok_time", "solve_time_min",
    "solve_time_hours", "problem_repeated", "spare_used", "spares_detail",
    "spare_part_code", "spare_qty", "attended_by", "tool_room_maintenance",
    "handover_to", "category", "remarks",
]


class EntryIn(BaseModel):
    shift:                 Optional[str] = None
    zone_name:             Optional[str] = None
    line_name:             Optional[str] = None
    machine_no:            Optional[str] = None
    machine_name:          Optional[str] = None
    bd_date:               Optional[str] = None
    nature_of_work:        Optional[str] = None
    problem_production:    Optional[str] = None
    problem_maintenance:   Optional[str] = None
    root_cause:            Optional[str] = None
    action_taken:          Optional[str] = None
    knockout_production:   Optional[str] = None
    cumulative_production: Optional[str] = None
    total_production:      Optional[str] = None
    bd_start_time:         Optional[str] = None
    bd_received_time:      Optional[str] = None
    bd_response_time:      Optional[str] = None
    bd_ok_time:            Optional[str] = None
    solve_time_min:        Optional[str] = None
    solve_time_hours:      Optional[str] = None
    problem_repeated:      Optional[str] = None
    spare_used:            Optional[str] = None
    spares_detail:         Optional[str] = None
    spare_part_code:       Optional[str] = None
    spare_qty:             Optional[str] = None
    attended_by:           Optional[str] = None
    tool_room_maintenance: Optional[str] = None
    handover_to:           Optional[str] = None
    category:              Optional[str] = None
    remarks:               Optional[str] = None


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
