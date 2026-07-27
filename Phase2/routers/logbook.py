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
            ("zone_name",                       "VARCHAR(120)"),
            ("line_name",                       "VARCHAR(120)"),
            ("machine_no",                      "VARCHAR(60)"),
            ("machine_name",                    "VARCHAR(160)"),
            ("bd_date",                         "DATE"),
            ("bd_start_time",                   "VARCHAR(8)"),
            ("bd_ok_time",                      "VARCHAR(8)"),
            ("solve_time_min",                  "VARCHAR(20)"),
            ("solve_time_hours",                "VARCHAR(20)"),
            ("problem_observed_by_maintenance", "TEXT"),
            ("action_taken",                    "TEXT"),
            ("spare_name",                      "TEXT"),
            ("spare_model_no",                  "VARCHAR(120)"),
            ("spare_cnmm_no",                   "VARCHAR(120)"),
            ("spare_qty",                       "VARCHAR(40)"),
            # Full multi-spare list: [{spare_name, spare_model_no, spare_cnmm_no,
            # spare_qty}, …].  The FIRST spare is also mirrored into the flat
            # spare_* columns above so existing rows/readers keep working.
            ("spares",                          "JSONB"),
            ("attended_by",                     "VARCHAR(160)"),
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
    zone_name:    Optional[str] = None
    line_name:    Optional[str] = None
    machine_no:   Optional[str] = None
    machine_name: Optional[str] = None
    bd_date:      Optional[str] = None
    bd_start_time:    Optional[str] = None
    bd_ok_time:       Optional[str] = None
    solve_time_min:   Optional[str] = None
    solve_time_hours: Optional[str] = None
    problem_observed_by_maintenance: Optional[str] = None
    action_taken: Optional[str] = None
    # Legacy single-spare fields (still accepted); the first entry of `spares`
    # wins when both are sent.
    spare_name:     Optional[str] = None
    spare_model_no: Optional[str] = None
    spare_cnmm_no:  Optional[str] = None
    spare_qty:      Optional[str] = None
    # Multi-spare list — [{spare_name, spare_model_no, spare_cnmm_no, spare_qty}, …]
    spares:         Optional[List[dict]] = None
    attended_by:  Optional[str] = None


_SPARE_KEYS = ("spare_name", "spare_model_no", "spare_cnmm_no", "spare_qty")

_LIST_COLS = ("id, serial_no, shift, zone_name, line_name, machine_no, machine_name, "
              "bd_date, bd_start_time, bd_ok_time, solve_time_min, solve_time_hours, "
              "problem_observed_by_maintenance, action_taken, "
              "spare_name, spare_model_no, spare_cnmm_no, spare_qty, spares, "
              "attended_by, created_by, created_at")


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

    # ── spares: keep the full list in `spares`, mirror the first into the flat
    # spare_* columns (backward compatibility for old rows / readers / exports).
    spares = [s for s in (data.get("spares") or [])
              if any(str(s.get(k) or "").strip() for k in _SPARE_KEYS)]
    if spares:
        first = spares[0]
        for k in _SPARE_KEYS:
            data[k] = first.get(k)
    elif any(str(data.get(k) or "").strip() for k in _SPARE_KEYS):
        # legacy single-spare payload → store it as a one-item list too
        spares = [{k: data.get(k) for k in _SPARE_KEYS}]

    with get_conn() as conn:
        cur = conn.cursor()
        # Serial No auto-generated = next running number.
        cur.execute("SELECT COALESCE(MAX(serial_no), 0) + 1 "
                    "FROM maintenance_logbook_db_history")
        next_serial = cur.fetchone()[0]
        try:
            cur.execute("""
                INSERT INTO maintenance_logbook_db_history
                    (serial_no, shift, zone_name, line_name, machine_no, machine_name,
                     bd_date, bd_start_time, bd_ok_time, solve_time_min, solve_time_hours,
                     problem_observed_by_maintenance, action_taken,
                     spare_name, spare_model_no, spare_cnmm_no, spare_qty, spares,
                     attended_by, created_by)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                RETURNING id, serial_no
            """, (
                next_serial, data["shift"], data["zone_name"], data["line_name"],
                data["machine_no"], data["machine_name"], data["bd_date"],
                data["bd_start_time"], data["bd_ok_time"],
                data["solve_time_min"], data["solve_time_hours"],
                data["problem_observed_by_maintenance"], data["action_taken"],
                data["spare_name"], data["spare_model_no"], data["spare_cnmm_no"],
                data["spare_qty"], json.dumps(spares) if spares else None,
                data["attended_by"], _author(user),
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
                "zone": data.get("zone_name"), "line": data.get("line_name"),
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
