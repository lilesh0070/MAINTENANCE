"""
routers/logbook.py
==================
Maintenance Log Book (rebuilt 2026-07-07) — one row per breakdown entry,
matching the physical TBDI/MAINT log-book format with these changes:
  • Machine identity captured as Zone → Line → Machine No (from the Machine
    Master, maintenance_machines).  Machine Name is auto-derived from Machine No.
  • Serial No is AUTO-GENERATED (running number) on save.
  • "Problem Reported / Found"  →  "Problem Observed by Maintenance".
  • Spare split into: Spare Name · Model Number · Spare ERP Number · Quantity.

Stored in the SAME table `maintenance_logbook_db_history` (kept from before);
the new columns are added idempotently, existing columns are reused.

Endpoints (prefix /api/logbook)
-------------------------------
GET    /            List entries (newest first)
GET    /{id}        Ek entry (edit form bharne ke liye -- Historical Data se aate waqt)
POST   /            Create one entry (serial_no auto = MAX+1)
PUT    /{id}        Entry badlo -- sirf jisne likhi ya admin (2026-10-03)
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
                # slip_id 2026-09-08 me juda -- bina iske entry delete karne par
                # uske spare Spare report me anaath pade reh jaate the, aur
                # `clear_usage` unhe kabhi dhoondh hi nahi paata tha.
                "slip_id": new_id,
            }, spares)
    except Exception as e:
        print(f"[SPARE-MASTER] record failed (logbook): {e}")
    return {"id": new_id, "serial_no": serial_no}


@router.get("/{entry_id}")
def get_entry(entry_id: int, user=Depends(get_current_user)):
    """Ek entry -- Historical Data ke "Edit" se Log Book page khulta hai to
    form isi se bharta hai (list 2000 tak hi aati hai)."""
    _ensure_table()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute(f"SELECT {_LIST_COLS} FROM maintenance_logbook_db_history WHERE id = %s",
                    (entry_id,))
        r = cur.fetchone()
    if not r:
        raise HTTPException(404, "Entry not found")
    return _ser(r)


# Audit me "kya badla" ke liye -- (column, dikhne wala naam).  Spare alag se.
_EDIT_LABELS = (
    ("shift", "Shift"), ("zone", "Zone"), ("line", "Line"), ("machine_no", "Machine No"),
    ("machine_name", "Machine Name"), ("bd_date", "Date"), ("bd_start_time", "Start Time"),
    ("bd_ok_time", "End Time"), ("mc_down_time_minutes", "Total (min)"),
    ("solve_time_hours", "Total (hrs)"),
    ("problem_observed_by_maintenance", "Problem Observed"),
    ("action_taken_on_problem", "Action Taken"), ("bd_attended_by", "Attended By"),
)


def _txt(v) -> str:
    """Tulna ke liye ek jaisa text -- DATE object aur '2026-10-03' string barabar."""
    if v is None:
        return ""
    return v.isoformat()[:10] if hasattr(v, "isoformat") else str(v).strip()


@router.put("/{entry_id}")
def update_entry(entry_id: int, body: EntryIn, user=Depends(get_current_user)):
    """Log Book ki entry BADLO (user 2026-10-03: "logbook fill karne ke baad
    edit wala option do, list me; aur historical data me admin edit kar sake").

    Haq: jisne entry likhi (`created_by`, bina case dekhe) ya admin -- server
    par jaancha jaata hai, sirf button chhupana kaafi nahi.  Serial No,
    created_by / created_at nahi badalte.

    SPARE: `create_entry` jaisa hi -- entry ka save pehle (commit), phir spare
    report (`maintenance_spare`) apne alag txn me: is entry (slip_id + source
    'Log Book') ki purani rows hata kar nayi (Manual Slip ke edit jaisa).
    Warna har edit par report me spare dohre chadhte.  Spare fail ho to bhi
    entry ka save nahi rukta (wahi best-effort niyam).

    Audit: `maintenance_audit_log` me LOGBOOK_ENTRY_EDIT + kaun se khaane badle."""
    _ensure_table()
    data = body.model_dump()
    if not (data.get("bd_date") or "").strip():
        data["bd_date"] = None
    spares = [s for s in (data.get("spares") or [])
              if any(str(s.get(k) or "").strip() for k in _SPARE_KEYS)]
    spares_used = _spare_summary(spares)
    kaun = _author(user)

    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT * FROM maintenance_logbook_db_history WHERE id = %s FOR UPDATE",
                    (entry_id,))
        old = cur.fetchone()
        if not old:
            raise HTTPException(404, "Entry not found")
        likha = (old.get("created_by") or "").strip().lower()
        admin = ((user or {}).get("role") or "") == "admin"
        if not (admin or (likha and likha == kaun.strip().lower())):
            raise HTTPException(403, "Only the person who wrote this entry, or admin, can edit it.")

        badla = [lbl for k, lbl in _EDIT_LABELS if _txt(old.get(k)) != _txt(data.get(k))]
        if _txt(old.get("spares_used")) != _txt(spares_used):
            badla.append("Spares")
        try:
            cur.execute("""
                UPDATE maintenance_logbook_db_history
                   SET shift = %s, zone = %s, line = %s, machine_no = %s, machine_name = %s,
                       bd_date = %s, bd_start_time = %s, bd_ok_time = %s,
                       mc_down_time_minutes = %s, solve_time_hours = %s,
                       problem_observed_by_maintenance = %s, action_taken_on_problem = %s,
                       spares = %s, spares_used = %s, bd_attended_by = %s
                 WHERE id = %s
            """, (
                data["shift"], data["zone"], data["line"], data["machine_no"], data["machine_name"],
                data["bd_date"], data["bd_start_time"], data["bd_ok_time"],
                data["mc_down_time_minutes"], data["solve_time_hours"],
                data["problem_observed_by_maintenance"], data["action_taken_on_problem"],
                json.dumps(spares) if spares else None, spares_used, data["bd_attended_by"],
                entry_id,
            ))
        except Exception as e:
            conn.rollback()
            raise HTTPException(400, f"Save failed: {e}")
        # Audit -- fail ho to bhi save na ruke (SAVEPOINT)
        cur.execute("SAVEPOINT lb_audit")
        try:
            cur.execute("""INSERT INTO maintenance_audit_log
                               (action, entity_type, entity_id, details, user_id, username)
                           VALUES (%s, %s, %s, %s, %s, %s)""",
                        ("LOGBOOK_ENTRY_EDIT", "maintenance_logbook_db_history", entry_id,
                         (f"log book #{entry_id} · serial={old.get('serial_no')} · badla: "
                          + (", ".join(badla) if badla else "kuch nahi"))[:1000],
                         (user or {}).get("id"), kaun))
            cur.execute("RELEASE SAVEPOINT lb_audit")
        except Exception as e:
            cur.execute("ROLLBACK TO SAVEPOINT lb_audit")
            print(f"[LOGBOOK] edit ka audit nahi likha: {e}")
        conn.commit()

    # Spare report -- alag txn, best-effort (Manual Slip ke edit jaisa)
    try:
        from routers.maintenance_spare import record_usage, clear_usage
        with get_conn() as sconn:
            clear_usage(sconn, entry_id, "Log Book")
            record_usage(sconn, "Log Book", {
                "zone": data.get("zone"), "line": data.get("line"),
                "machine_no": data.get("machine_no"), "machine_name": data.get("machine_name"),
                "used_date": data.get("bd_date"),
                "slip_id": entry_id,
            }, spares)
            sconn.commit()
    except Exception as e:
        print(f"[SPARE-MASTER] re-record failed (logbook {entry_id}): {e}")

    return {"ok": True, "id": entry_id, "serial_no": old.get("serial_no"), "changed": badla}


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
