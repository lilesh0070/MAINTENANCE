"""
routers/logbook.py
==================
Maintenance Log Book (rebuilt 2026-07-07) — one row per breakdown entry,
matching the physical TBDI/MAINT log-book format with these changes:
  • Machine identity captured as Zone → Line → Machine No (from the Machine
    Master, mes_machines).  Machine Name is auto-derived from Machine No.
  • Serial No is AUTO-GENERATED (running number) on save.
  • "Problem Reported / Found"  →  "Problem Observed by Maintenance".
  • Spare split into: Spare Name · Model Number · CNMM Number · Quantity.

Stored in the SAME table `maintenance_logbook_db_history` (kept from before);
the new columns are added idempotently, existing columns are reused.

Endpoints (prefix /api/logbook)
-------------------------------
GET    /            List entries (newest first)
POST   /            Create one entry (serial_no auto = MAX+1)
DELETE /{id}        Delete one entry
"""
import json
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from database import get_conn, dict_cursor
from auth import get_current_user

router = APIRouter(prefix="/api/logbook", tags=["logbook"])


def _ensure_table() -> None:
    with get_conn() as conn:
        cur = conn.cursor()
        # Base table (kept from the old Log Book — created if missing).
        cur.execute("""
            CREATE TABLE IF NOT EXISTS maintenance_logbook_db_history (
                id           SERIAL PRIMARY KEY,
                created_at   TIMESTAMP DEFAULT NOW()
            )
        """)
        # New-format columns — added idempotently so the kept table gains them.
        for col, typ in [
            ("serial_no",                       "INTEGER"),
            ("shift",                           "VARCHAR(8)"),
            ("zone",                       "VARCHAR(120)"),
            ("line",                       "VARCHAR(120)"),
            ("machine_no",                      "VARCHAR(60)"),
            ("machine_name",                    "VARCHAR(160)"),
            ("bd_date",                         "DATE"),
            ("bd_start_time",                   "VARCHAR(8)"),
            ("bd_ok_time",                      "VARCHAR(8)"),
            ("mc_down_time_minutes",                  "VARCHAR(20)"),
            ("solve_time_hours",                "VARCHAR(20)"),
            ("problem_observed_by_maintenance", "TEXT"),
            ("action_taken_on_problem",                    "TEXT"),
            # Spare storage — SAME shape as the Manual Break Down Slip:
            # `spares` (full multi-spare JSONB list) + `spares_used` (one-line
            # text summary).  No flat spare_* columns.
            ("spares",                          "JSONB"),
            ("spares_used",                     "TEXT"),
            ("bd_attended_by",                     "VARCHAR(160)"),
            ("created_by",                      "VARCHAR(120)"),
        ]:
            cur.execute(f"ALTER TABLE maintenance_logbook_db_history "
                        f"ADD COLUMN IF NOT EXISTS {col} {typ}")
        conn.commit()


def _author(user) -> str:
    if isinstance(user, dict):
        return user.get("username") or user.get("name") or "user"
    return getattr(user, "username", None) or "user"


def _ser(r: dict) -> dict:
    r = dict(r)
    for k in ("bd_date",):
        if r.get(k): r[k] = r[k].isoformat()
    for k in ("created_at",):
        if r.get(k): r[k] = r[k].isoformat()
    return r


class EntryIn(BaseModel):
    shift:        Optional[str] = None
    zone:    Optional[str] = None
    line:    Optional[str] = None
    machine_no:   Optional[str] = None
    machine_name: Optional[str] = None
    bd_date:      Optional[str] = None
    bd_start_time:    Optional[str] = None
    bd_ok_time:       Optional[str] = None
    mc_down_time_minutes:   Optional[str] = None
    solve_time_hours: Optional[str] = None
    problem_observed_by_maintenance: Optional[str] = None
    action_taken_on_problem: Optional[str] = None
    # Multi-spare list — [{spare_name, spare_model_no, spare_cnmm_no, spare_qty}, …]
    # (same shape as the Manual Break Down Slip).  `spares_used` (text summary)
    # is derived from this list on the backend.
    spares:         Optional[List[dict]] = None
    spares_used:    Optional[str] = None
    bd_attended_by:  Optional[str] = None


_SPARE_KEYS = ("spare_name", "spare_model_no", "spare_cnmm_no", "spare_qty")


def _spare_summary(spares: list) -> Optional[str]:
    """One-line text summary of the spares list → stored in `spares_used`
    (mirrors the Manual Break Down Slip's derived text field)."""
    parts = []
    for s in spares or []:
        name = str(s.get("spare_name") or "").strip()
        if not name:
            continue
        extra = " / ".join(x for x in (str(s.get("spare_model_no") or "").strip(),
                                       str(s.get("spare_cnmm_no") or "").strip()) if x)
        qty = str(s.get("spare_qty") or "").strip()
        bit = name + (f" ({extra})" if extra else "") + (f" QTY-{qty}" if qty else "")
        parts.append(bit)
    return " | ".join(parts) if parts else None


_LIST_COLS = ("id, serial_no, shift, zone, line, machine_no, machine_name, "
              "bd_date, bd_start_time, bd_ok_time, mc_down_time_minutes, solve_time_hours, "
              "problem_observed_by_maintenance, action_taken_on_problem, "
              "spares, spares_used, "
              "bd_attended_by, created_by, created_at")


@router.get("/")
def list_entries(user=Depends(get_current_user)):
    _ensure_table()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute(f"SELECT {_LIST_COLS} FROM maintenance_logbook_db_history "
                    f"ORDER BY serial_no DESC NULLS LAST, id DESC LIMIT 2000")
        return [_ser(r) for r in cur.fetchall()]


@router.post("/", status_code=201)
def create_entry(body: EntryIn, user=Depends(get_current_user)):
    _ensure_table()
    data = body.model_dump()
    if not (data.get("bd_date") or "").strip():
        data["bd_date"] = None

    # ── spares: keep the full list in `spares` (JSONB) + a one-line text
    # summary in `spares_used` — SAME shape as the Manual Break Down Slip.
    spares = [s for s in (data.get("spares") or [])
              if any(str(s.get(k) or "").strip() for k in _SPARE_KEYS)]
    spares_used = _spare_summary(spares)

    with get_conn() as conn:
        cur = conn.cursor()
        # Serial No auto-generated = next running number.
        cur.execute("SELECT COALESCE(MAX(serial_no), 0) + 1 "
                    "FROM maintenance_logbook_db_history")
        next_serial = cur.fetchone()[0]
        try:
            cur.execute("""
                INSERT INTO maintenance_logbook_db_history
                    (serial_no, shift, zone, line, machine_no, machine_name,
                     bd_date, bd_start_time, bd_ok_time, mc_down_time_minutes, solve_time_hours,
                     problem_observed_by_maintenance, action_taken_on_problem,
                     spares, spares_used,
                     bd_attended_by, created_by)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                RETURNING id, serial_no
            """, (
                next_serial, data["shift"], data["zone"], data["line"],
                data["machine_no"], data["machine_name"], data["bd_date"],
                data["bd_start_time"], data["bd_ok_time"],
                data["mc_down_time_minutes"], data["solve_time_hours"],
                data["problem_observed_by_maintenance"], data["action_taken_on_problem"],
                json.dumps(spares) if spares else None, spares_used,
                data["bd_attended_by"], _author(user),
            ))
            new_id, serial_no = cur.fetchone()
            conn.commit()
        except Exception as e:
            conn.rollback()
            raise HTTPException(400, f"Save failed: {e}")
    # Record this entry's spares into maintenance_spare (own txn, best-effort).
    try:
        from routers.maintenance_spare import record_usage
        with get_conn() as sconn:
            record_usage(sconn, "Log Book", {
                "zone": data.get("zone"), "line": data.get("line"),
                "machine_no": data.get("machine_no"), "machine_name": data.get("machine_name"),
                "used_date": data.get("bd_date"),
            }, spares)
    except Exception as e:
        print(f"[SPARE-MASTER] record failed (logbook): {e}")
    return {"id": new_id, "serial_no": serial_no}


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
