"""
routers/machine_running_hours.py
================================
Per-machine RUNNING HOURS for a financial year — a simple manual entry that is
the operating-time input for MTBF.  Admin picks a machine, types its running
(operating) hours for a financial year, and saves.  The breakdown count comes
from the maintenance breakdown register (frequency-weighted, same as the KPI
page), and

    MTBF (hours) = running_hours / number_of_breakdowns

Backing table (lazy-created): maintenance_machine_running_hours
    fy            TEXT      -- e.g. '2026-2027'
    machine_no    TEXT      -- master machine code
    running_hours NUMERIC
    UNIQUE (fy, machine_no)

Endpoints (prefix /api/machine-running-hours)
---------------------------------------------
GET    /?fy=2026-2027   Saved rows for the FY (+ breakdowns + MTBF)
POST   /                Save/update one machine's running hours (admin)
DELETE /{row_id}        Delete a saved row (admin)
"""
from datetime import date
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from database import get_conn, dict_cursor
from auth import get_current_user, require_admin

router = APIRouter(prefix="/api/machine-running-hours", tags=["machine-running-hours"])


class RhEntry(BaseModel):
    zone_name:     Optional[str] = None
    line_name:     Optional[str] = None
    serial_no:     Optional[int] = None
    machine_no:    str
    machine_name:  Optional[str] = None
    running_hours: float = 0


class RhSave(BaseModel):
    fy: str
    entries: List[RhEntry] = []


def _ensure(conn):
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS maintenance_machine_running_hours (
            id            SERIAL PRIMARY KEY,
            fy            TEXT        NOT NULL,
            zone_name     TEXT,
            line_name     TEXT,
            serial_no     INTEGER,
            machine_no    TEXT        NOT NULL,
            machine_name  TEXT,
            running_hours NUMERIC     NOT NULL DEFAULT 0,
            created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (fy, machine_no)
        )
    """)
    conn.commit()


def _fy_dates(fy: str):
    """'2026-2027' → (date(2026,4,1), date(2027,4,1)).  Financial year Apr→Mar."""
    try:
        y = int(str(fy).split("-")[0])
    except (ValueError, AttributeError, IndexError):
        raise HTTPException(400, "fy must look like '2026-2027'")
    return date(y, 4, 1), date(y + 1, 4, 1)


@router.get("/")
def list_running_hours(fy: str = Query(..., description="e.g. 2026-2027"),
                       user=Depends(get_current_user)):
    """Saved running-hours rows for the FY, plus the aggregate MTBF:

        MTBF (days) = (running_hours × number_of_machines − total_breakdown_hours)
                      / breakdown_frequency / 24

    where number_of_machines is the count of machines in the Machine Master
    (maintenance_machines), and total_breakdown_hours / breakdown_frequency are
    the FY totals from the maintenance breakdown register (frequency-weighted).
    running_hours is the sum of the saved per-machine running-hours entries."""
    start, end = _fy_dates(fy)
    with get_conn() as conn:
        _ensure(conn)
        cur = dict_cursor(conn)
        cur.execute("""
            SELECT id, zone_name, line_name, serial_no, machine_no, machine_name, running_hours
              FROM maintenance_machine_running_hours
             WHERE fy = %s
             ORDER BY zone_name, line_name, serial_no
        """, [fy])
        saved = cur.fetchall()

        # Number of machines — straight from the Machine Master.
        cur.execute("SELECT COUNT(*) AS n FROM maintenance_machines WHERE is_active = TRUE")
        num_machines = int(cur.fetchone()["n"] or 0)

        # FY totals from the breakdown register.
        cur.execute("""
            SELECT COALESCE(SUM(mc_down_time_minutes), 0) / 60.0     AS bd_hours,
                   COALESCE(SUM(COALESCE(frequency, 1)), 0)          AS bd_freq
              FROM maintenance_breakdown_data
             WHERE COALESCE(slip_date, bd_start_date) >= %s
               AND COALESCE(slip_date, bd_start_date) <  %s
        """, [start, end])
        agg = cur.fetchone()
        bd_hours = float(agg["bd_hours"] or 0)
        bd_freq  = int(agg["bd_freq"] or 0)

    rows = [{
        "id": m["id"], "zone_name": m["zone_name"], "line_name": m["line_name"],
        "serial_no": m["serial_no"], "machine_no": m["machine_no"],
        "machine_name": m["machine_name"], "running_hours": float(m["running_hours"] or 0),
    } for m in saved]

    running_hours = sum(r["running_hours"] for r in rows)
    mtbf_days = (round((running_hours * num_machines - bd_hours) / bd_freq / 24.0, 2)
                 if bd_freq > 0 else None)

    return {
        "fy": fy,
        "rows": rows,
        "calc": {
            "running_hours":          round(running_hours, 2),
            "num_machines":           num_machines,
            "total_breakdown_hours":  round(bd_hours, 2),
            "breakdown_frequency":    bd_freq,
            "mtbf_days":              mtbf_days,
        },
    }


@router.post("/", status_code=201)
def save_running_hours(body: RhSave, admin=Depends(require_admin)):
    """Save/update running hours (one row per machine per FY)."""
    if not body.fy:
        raise HTTPException(400, "Financial Year is required")
    saved = 0
    with get_conn() as conn:
        _ensure(conn)
        cur = conn.cursor()
        for e in body.entries:
            if not e.machine_no:
                continue
            cur.execute("""
                INSERT INTO maintenance_machine_running_hours
                    (fy, zone_name, line_name, serial_no, machine_no, machine_name, running_hours)
                VALUES (%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (fy, machine_no) DO UPDATE
                   SET running_hours = EXCLUDED.running_hours,
                       zone_name     = EXCLUDED.zone_name,
                       line_name     = EXCLUDED.line_name,
                       serial_no     = EXCLUDED.serial_no,
                       machine_name  = EXCLUDED.machine_name,
                       updated_at    = NOW()
            """, (body.fy, e.zone_name, e.line_name, e.serial_no,
                  e.machine_no, e.machine_name, e.running_hours or 0))
            saved += 1
        conn.commit()
    return {"ok": True, "saved": saved}


@router.delete("/{row_id}")
def delete_running_hours(row_id: int, admin=Depends(require_admin)):
    with get_conn() as conn:
        _ensure(conn)
        cur = conn.cursor()
        cur.execute("DELETE FROM maintenance_machine_running_hours WHERE id = %s", (row_id,))
        conn.commit()
    return {"ok": True}
