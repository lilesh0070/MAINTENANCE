"""
routers/capa_logbook.py
=======================
CAPA driven directly by the Break Down Slip table (`maintenance_breakdown_data`) — the
SAME source the Maintenance-KPI / BD-History / BD-Analysis pages compute
from, so the CAPA counts always reconcile with those pages.

Rule: every breakdown whose repair duration (mc_down_time_minutes, numeric) is
60 minutes or more is automatically a CAPA.

  • OPEN   (Pending)      — its CAPA-QPR has not been completed yet.
  • CLOSED (CAPA Records) — a QPR has been filled and saved for it
                            (maintenance_qpr.logbook_id = breakdown id,
                             capa_status = 'CLOSED').

`maintenance_qpr.logbook_id` stores the **maintenance_breakdown_data id** (since
2026-07-03; it previously pointed at maintenance_logbook_db_history — the
old open stubs were backed up to Phase2/qpr_capa_stubs_backup.csv and
removed during the switch).

Clicking "Start CAPA" opens a QPR (auto-created, pre-filled from the
breakdown) — saving it closes the CAPA and the record lands in the QPR
Filling section.  No manual CAPA creation, no duplicates (starting again
resumes the same QPR).

Endpoints (prefix /api/capa-lb)
-------------------------------
GET  /summary          {open_count, closed_count, open[], closed[]}
POST /start/{bd_id}    Open (or resume) the CAPA-QPR for a breakdown → {qpr_id}
"""
import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from database import get_conn, dict_cursor
from auth import get_current_user

router = APIRouter(prefix="/api/capa-lb", tags=["capa-logbook"])

# a CAPA = a breakdown with a ≥60-minute repair (mc_down_time_minutes)
_MIN60 = "mc_down_time_minutes >= 60"


def _author(user) -> str:
    if isinstance(user, dict):
        return user.get("username") or user.get("name") or "user"
    return getattr(user, "username", None) or "user"


def _ensure_qpr():
    # make sure maintenance_qpr + its capa columns exist
    import routers.qpr as q
    q._ensure_table()


def _num(v):
    """Decimal → int when whole (155.0 → 155), else float."""
    if v is None:
        return None
    f = float(v)
    return int(f) if f == int(f) else f


@router.get("/summary")
def summary(user=Depends(get_current_user)):
    _ensure_qpr()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        # LEFT JOIN LATERAL that picks ONE QPR per breakdown and PREFERS a CLOSED
        # one — so once a CAPA has been closed it can never reappear as Open, even
        # if a stray/legacy duplicate QPR exists.  (The unique index on logbook_id
        # normally prevents duplicates in the first place; this is belt-and-braces
        # and also makes the row choice deterministic.)
        cur.execute(f"""
            SELECT bd.id,
                   bd.zone AS zone_name,
                   bd.line AS line_name,
                   bd.machine_no, bd.machine_name,
                   COALESCE(bd.slip_date, bd.bd_start_date)  AS bd_date,
                   bd.problem_reported_by_production          AS problem_production,
                   bd.problem_observed_by_maintenance                 AS problem_maintenance,
                   bd.action_taken_on_problem                 AS action_taken,
                   bd.mc_down_time_minutes                    AS solve_time_min,
                   bd.bd_attended_by                          AS attended_by,
                   q.qpr_id, q.qpr_no, q.capa_status
              FROM maintenance_breakdown_data bd
              LEFT JOIN LATERAL (
                   SELECT mq.id AS qpr_id, mq.qpr_no, mq.capa_status
                     FROM maintenance_qpr mq
                    WHERE mq.logbook_id = bd.id
                    ORDER BY (mq.capa_status = 'CLOSED') DESC, mq.id DESC
                    LIMIT 1
              ) q ON TRUE
             WHERE {_MIN60}
             ORDER BY COALESCE(bd.slip_date, bd.bd_start_date) DESC NULLS LAST, bd.id DESC
        """)
        rows = cur.fetchall()

    seen, opens, closed = set(), [], []
    for r in rows:
        if r["id"] in seen:
            continue
        seen.add(r["id"])
        rec = {
            "logbook_id": r["id"], "zone_name": r["zone_name"], "line_name": r["line_name"],
            "machine_no": r["machine_no"], "machine_name": r["machine_name"],
            "bd_date": r["bd_date"].isoformat() if r["bd_date"] else None,
            "problem": r["problem_maintenance"] or r["problem_production"] or "",
            "action_taken": r["action_taken"] or "",
            "duration_min": _num(r["solve_time_min"]), "attended_by": r["attended_by"] or "",
            "qpr_id": r["qpr_id"], "qpr_no": r["qpr_no"],
        }
        if r["capa_status"] == "CLOSED":
            closed.append(rec)
        else:
            opens.append(rec)

    return {"open_count": len(opens), "closed_count": len(closed),
            "open": opens, "closed": closed}


@router.post("/start/{bd_id}", status_code=201)
def start_capa(bd_id: int, user=Depends(get_current_user)):
    _ensure_qpr()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute(f"""SELECT id, zone AS zone_code,
                               COALESCE(slip_date, bd_start_date) AS bd_date,
                               problem_reported_by_production AS problem_production,
                               problem_observed_by_maintenance AS problem_maintenance,
                               machine_name, machine_no,
                               bd_attended_by AS attended_by
                          FROM maintenance_breakdown_data WHERE id=%s AND {_MIN60}""", (bd_id,))
        bd = cur.fetchone()
        if not bd:
            raise HTTPException(404, "No ≥60-minute breakdown for this id")

        # already started? → return the existing CAPA-QPR (no duplicate)
        cur.execute("SELECT id, qpr_no FROM maintenance_qpr WHERE logbook_id=%s", (bd_id,))
        ex = cur.fetchone()
        if ex:
            return {"qpr_id": ex["id"], "qpr_no": ex["qpr_no"], "resumed": True}

        # pre-fill a QPR payload from the breakdown
        payload = {
            "location": bd["zone_code"] or "",
            "qpr_date": bd["bd_date"].isoformat() if bd["bd_date"] else "",
            "reported_problem": bd["problem_production"] or bd["problem_maintenance"] or "",
            "defect_confirmation": bd["problem_maintenance"] or "",
            "w_what": bd["problem_maintenance"] or "",
            "part_name": bd["machine_name"] or "",
            "qpr_raised_by": bd["attended_by"] or "",
        }
        cur2 = conn.cursor()
        cur2.execute("SELECT COALESCE(MAX(qpr_no),0)+1 FROM maintenance_qpr")
        next_no = cur2.fetchone()[0]
        title = f"CAPA · {bd['machine_no'] or bd['machine_name'] or ''} · QPR No. {next_no}"
        # ON CONFLICT makes the create atomic vs the unique index on logbook_id:
        # if a concurrent "Start CAPA" (double-click / another tab) already made
        # the QPR, our insert is skipped and we resume the existing one — never a
        # duplicate.
        cur2.execute(
            """INSERT INTO maintenance_qpr (qpr_no, title, payload, logbook_id, capa_status, created_by)
               VALUES (%s, %s, %s::jsonb, %s, 'OPEN', %s)
               ON CONFLICT (logbook_id) WHERE logbook_id IS NOT NULL DO NOTHING
               RETURNING id""",
            (next_no, title, json.dumps(payload), bd_id, _author(user)),
        )
        row = cur2.fetchone()
        conn.commit()
        if row is None:                       # lost the race — resume the winner
            cur.execute("SELECT id, qpr_no FROM maintenance_qpr WHERE logbook_id=%s", (bd_id,))
            ex = cur.fetchone()
            return {"qpr_id": ex["id"], "qpr_no": ex["qpr_no"], "resumed": True}
        new_id = row[0]
    return {"qpr_id": new_id, "qpr_no": next_no, "resumed": False}


# ─────────────────────────────────────────────────────────────────────────────
# NEW CAPA / QPR SHEET  (capa.xlsx format — the full fillable QUALITY PROBLEM
# REPORT sheet).  Standalone from the breakdown-driven flow above: the whole
# form is stored as a flat {cell_name: value} JSONB map (cell names f_<row>_<col>
# match the generated grid).  A few key cells are mirrored into columns for the
# list / filtering.
# ─────────────────────────────────────────────────────────────────────────────
_QPR_NO_KEY  = "f_4_13"    # M4  — QPR No.
_TITLE_KEY   = "f_16_3"    # C16 — Reported Problem
_MC_KEY      = "f_9_6"     # F9  — MACHINE_NO value

_CAPA_DDL = False


def _ensure_capa_sheet():
    global _CAPA_DDL
    if _CAPA_DDL:
        return
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS maintenance_capa_sheet (
                id          SERIAL PRIMARY KEY,
                qpr_no      TEXT,
                machine_no  TEXT,
                zone        TEXT,
                line        TEXT,
                title       TEXT,
                status      TEXT DEFAULT 'DRAFT',
                data        JSONB DEFAULT '{}'::jsonb,
                created_by  TEXT,
                created_at  TIMESTAMP DEFAULT NOW(),
                updated_by  TEXT,
                updated_at  TIMESTAMP DEFAULT NOW()
            )
        """)
        # link a saved QPR sheet back to the ≥60-min breakdown it belongs to
        cur.execute("ALTER TABLE maintenance_capa_sheet ADD COLUMN IF NOT EXISTS breakdown_id INTEGER")
        conn.commit()
    _CAPA_DDL = True


@router.get("/pending")
def capa_pending(user=Depends(get_current_user)):
    """Every manual-slip breakdown with a ≥60-min repair (mc_down_time_minutes) is
    a CAPA.  Returns each with machine_no / machine_name / date / model + whether
    its QPR sheet is started (sheet_id) yet."""
    _ensure_capa_sheet()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute(f"""
            SELECT bd.id AS bd_id, bd.machine_no, bd.machine_name,
                   COALESCE(bd.slip_date, bd.bd_start_date) AS bd_date,
                   bd.model_no, bd.mc_down_time_minutes AS duration_min,
                   bd.zone AS zone_name, bd.line AS line_name,
                   COALESCE(bd.problem_observed_by_maintenance, '')  AS problem_maintenance,
                   COALESCE(bd.action_taken_on_problem, '')          AS action_taken,
                   COALESCE(bd.bd_attended_by, '')                   AS attended_by,
                   COALESCE(NULLIF(bd.problem_observed_by_maintenance,''),
                            bd.problem_reported_by_production, '') AS problem,
                   s.id AS sheet_id, s.status AS sheet_status, s.qpr_no
              FROM maintenance_breakdown_data bd
              LEFT JOIN LATERAL (
                   SELECT id, status, qpr_no FROM maintenance_capa_sheet
                    WHERE breakdown_id = bd.id ORDER BY id DESC LIMIT 1
              ) s ON TRUE
             WHERE {_MIN60}
             ORDER BY COALESCE(bd.slip_date, bd.bd_start_date) DESC NULLS LAST, bd.id DESC
        """)
        rows = cur.fetchall()
    for r in rows:
        if r.get("bd_date"):
            r["bd_date"] = r["bd_date"].isoformat()
        r["duration_min"] = _num(r["duration_min"])
    pend = sum(1 for r in rows if not r["sheet_id"])
    return {"rows": rows, "total": len(rows), "pending": pend, "done": len(rows) - pend}


class CapaSheet(BaseModel):
    id:           Optional[int] = None
    data:         dict = {}
    qpr_no:       Optional[str] = ""
    machine_no:   Optional[str] = ""
    zone:         Optional[str] = ""
    line:         Optional[str] = ""
    title:        Optional[str] = ""
    status:       Optional[str] = "DRAFT"
    breakdown_id: Optional[int] = None


@router.get("/sheets")
def list_capa_sheets(user=Depends(get_current_user)):
    """Saved QPR sheets — newest first (no data blob, just the list fields)."""
    _ensure_capa_sheet()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("""SELECT id, qpr_no, machine_no, zone, line, title, status,
                              created_by, created_at, updated_by, updated_at
                         FROM maintenance_capa_sheet
                        ORDER BY updated_at DESC NULLS LAST, id DESC LIMIT 500""")
        rows = cur.fetchall()
    for r in rows:
        for k in ("created_at", "updated_at"):
            if r.get(k):
                r[k] = r[k].isoformat()
    return {"rows": rows}


@router.get("/sheet/{sid}")
def get_capa_sheet(sid: int, user=Depends(get_current_user)):
    """One saved QPR sheet with its full {cell: value} data map."""
    _ensure_capa_sheet()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT * FROM maintenance_capa_sheet WHERE id=%s", (sid,))
        r = cur.fetchone()
    if not r:
        raise HTTPException(404, "QPR sheet not found")
    for k in ("created_at", "updated_at"):
        if r.get(k):
            r[k] = r[k].isoformat()
    return r


@router.post("/sheet")
def save_capa_sheet(body: CapaSheet, user=Depends(get_current_user)):
    """Create a new QPR sheet, or update an existing one (when `id` is sent).
    The whole form rides in `data`; qpr_no / machine_no / title are pulled from
    known cells unless the caller sent them."""
    _ensure_capa_sheet()
    d = body.data or {}
    qpr_no = (body.qpr_no or str(d.get(_QPR_NO_KEY) or "")).strip()
    machine = (body.machine_no or str(d.get(_MC_KEY) or "")).strip()
    title = (body.title or str(d.get(_TITLE_KEY) or "")).strip()
    status = (body.status or "DRAFT").strip() or "DRAFT"
    who = _author(user)
    with get_conn() as conn:
        cur = conn.cursor()
        if body.id:
            cur.execute("""UPDATE maintenance_capa_sheet
                              SET data=%s::jsonb, qpr_no=%s, machine_no=%s, zone=%s, line=%s,
                                  title=%s, status=%s, updated_by=%s, updated_at=NOW()
                            WHERE id=%s RETURNING id""",
                        (json.dumps(d), qpr_no, machine, body.zone or "", body.line or "",
                         title, status, who, body.id))
            row = cur.fetchone()
            if not row:
                raise HTTPException(404, "QPR sheet not found")
            sid = row[0]
        else:
            cur.execute("""INSERT INTO maintenance_capa_sheet
                              (qpr_no, machine_no, zone, line, title, status, data,
                               breakdown_id, created_by, updated_by)
                            VALUES (%s,%s,%s,%s,%s,%s,%s::jsonb,%s,%s,%s) RETURNING id""",
                        (qpr_no, machine, body.zone or "", body.line or "", title, status,
                         json.dumps(d), body.breakdown_id, who, who))
            sid = cur.fetchone()[0]
        conn.commit()
    return {"ok": True, "id": sid}


@router.delete("/sheet/{sid}")
def delete_capa_sheet(sid: int, user=Depends(get_current_user)):
    _ensure_capa_sheet()
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM maintenance_capa_sheet WHERE id=%s", (sid,))
        if cur.rowcount == 0:
            raise HTTPException(404, "QPR sheet not found")
        conn.commit()
    return {"ok": True}
