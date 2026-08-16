"""
routers/daily_plan.py
======================
Daily Work Assign — Update Plan → "Daily Work Assign" section.

Assign day-wise work to a machine (zone/line/machine from the Machine
Master, plus the problem/work description).  Later the plan is COMPLETED by
filling what work was done and who did it.  Completed + pending plans are
also listed on the Historical Data page.

Table: maintenance_daily_plan_work
Endpoints (prefix /api/daily-plan)
-----------------------------------
GET    /            List plans (+filters) with {total, pending, done} counts
POST   /            Assign a new daily work plan
PUT    /{id}/complete   Fill work_done + done_by → status DONE
PUT    /{id}/reopen     Undo a completion (back to PENDING)
DELETE /{id}        Remove a plan (wrong entry)
"""
import json
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from database import get_conn, dict_cursor
from auth import get_current_user, require_admin

router = APIRouter(prefix="/api/daily-plan", tags=["daily-plan"])


def _ensure_table() -> None:
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS maintenance_daily_plan_work (
                id           SERIAL PRIMARY KEY,
                plan_date    DATE NOT NULL,
                zone_name    TEXT,
                line_name    TEXT,
                machine_no   TEXT,
                machine_name TEXT,
                problem      TEXT NOT NULL,
                status       VARCHAR(12) NOT NULL DEFAULT 'PENDING',
                work_done    TEXT,
                done_by      TEXT,
                done_at      TIMESTAMP,
                created_by   TEXT,
                created_at   TIMESTAMP DEFAULT NOW()
            )
        """)
        for col, typ in (("start_time", "TEXT"), ("end_time", "TEXT"),
                         ("duration_minutes", "INTEGER"),
                         ("spares", "JSONB"), ("spares_used", "TEXT")):
            cur.execute(f"ALTER TABLE maintenance_daily_plan_work ADD COLUMN IF NOT EXISTS {col} {typ}")
        conn.commit()


def _author(user) -> str:
    if isinstance(user, dict):
        return user.get("username") or "user"
    return getattr(user, "username", None) or "user"


def _ser(r: dict) -> dict:
    r = dict(r)
    for k in ("plan_date",):
        if r.get(k): r[k] = r[k].isoformat()
    for k in ("done_at", "created_at"):
        if r.get(k): r[k] = r[k].isoformat()
    return r


class SundayPlanCreate(BaseModel):
    plan_date:    str            # YYYY-MM-DD (the work date)
    zone_name:    str
    line_name:    str
    machine_no:   str
    machine_name: Optional[str] = ""
    problem:      str


_SPARE_KEYS = ("spare_name", "spare_model_no", "spare_cnmm_no", "spare_qty")


def _spare_summary(spares: list) -> Optional[str]:
    parts = []
    for s in spares or []:
        name = str(s.get("spare_name") or "").strip()
        if not name:
            continue
        extra = " / ".join(x for x in (str(s.get("spare_model_no") or "").strip(),
                                       str(s.get("spare_cnmm_no") or "").strip()) if x)
        qty = str(s.get("spare_qty") or "").strip()
        parts.append(name + (f" ({extra})" if extra else "") + (f" QTY-{qty}" if qty else ""))
    return " | ".join(parts) if parts else None


def _mins_between(start: Optional[str], end: Optional[str]) -> Optional[int]:
    try:
        sh, sm = [int(x) for x in str(start).split(":")[:2]]
        eh, em = [int(x) for x in str(end).split(":")[:2]]
        d = (eh * 60 + em) - (sh * 60 + sm)
        return d + 24 * 60 if d < 0 else d
    except Exception:
        return None


class SundayPlanComplete(BaseModel):
    work_done:  str
    done_by:    str
    start_time: Optional[str] = None
    end_time:   Optional[str] = None
    spares:     Optional[List[dict]] = None


@router.get("/")
def list_plans(date_from:  Optional[str] = Query(None),
               date_to:    Optional[str] = Query(None),
               zone:       Optional[str] = Query(None),
               line:       Optional[str] = Query(None),
               machine_no: Optional[str] = Query(None),
               status:     Optional[str] = Query(None),
               limit:      int = Query(2000, ge=1, le=5000),
               user=Depends(get_current_user)):
    _ensure_table()
    where, params = ["1=1"], []
    if date_from:  where.append("plan_date >= %s");  params.append(date_from)
    if date_to:    where.append("plan_date <= %s");  params.append(date_to)
    if zone:       where.append("zone_name = %s");   params.append(zone)
    if line:       where.append("line_name = %s");   params.append(line)
    if machine_no: where.append("machine_no = %s");  params.append(machine_no)
    if status:     where.append("status = %s");      params.append(status.upper())
    w = " AND ".join(where)
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute(f"""SELECT * FROM maintenance_daily_plan_work WHERE {w}
                        ORDER BY plan_date DESC, id DESC LIMIT %s""", params + [limit])
        rows = [_ser(r) for r in cur.fetchall()]
        # counts over the same filter WITHOUT the status narrowing
        w2_parts = [c for c in where if not c.startswith("status")]
        p2 = [p for c, p in zip(where[1:], params) if not c.startswith("status")]
        cur.execute(f"""SELECT COUNT(*) AS total,
                               COUNT(*) FILTER (WHERE status='DONE')    AS done,
                               COUNT(*) FILTER (WHERE status='PENDING') AS pending
                          FROM maintenance_daily_plan_work WHERE {' AND '.join(w2_parts)}""", p2)
        c = cur.fetchone()
    return {"rows": rows, "total": int(c["total"]), "done": int(c["done"]),
            "pending": int(c["pending"])}


@router.post("/", status_code=201)
def create_plan(body: SundayPlanCreate, user=Depends(get_current_user)):
    _ensure_table()
    if not body.problem.strip():
        raise HTTPException(400, "problem / work description is required")
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("""INSERT INTO maintenance_daily_plan_work
                       (plan_date, zone_name, line_name, machine_no, machine_name,
                        problem, created_by)
                       VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
                    (body.plan_date, body.zone_name, body.line_name, body.machine_no,
                     body.machine_name, body.problem.strip(), _author(user)))
        new_id = cur.fetchone()[0]
        conn.commit()
    return {"id": new_id}


@router.put("/{pid}/complete")
def complete_plan(pid: int, body: SundayPlanComplete, user=Depends(get_current_user)):
    _ensure_table()
    if not body.work_done.strip():
        raise HTTPException(400, "work_done is required — what work was carried out?")
    if not body.done_by.strip():
        raise HTTPException(400, "done_by is required — who did the work?")
    spares = [s for s in (body.spares or [])
              if any(str(s.get(k) or "").strip() for k in _SPARE_KEYS)]
    spares_used = _spare_summary(spares)
    dur = _mins_between(body.start_time, body.end_time) if (body.start_time and body.end_time) else None
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("""UPDATE maintenance_daily_plan_work
                          SET status='DONE', work_done=%s, done_by=%s, done_at=NOW(),
                              start_time=%s, end_time=%s, duration_minutes=%s,
                              spares=%s, spares_used=%s
                        WHERE id=%s
                    RETURNING zone_name, line_name, machine_no, machine_name, plan_date""",
                    (body.work_done.strip(), body.done_by.strip(),
                     (body.start_time or None), (body.end_time or None), dur,
                     json.dumps(spares) if spares else None, spares_used, pid))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Plan not found")
        conn.commit()
    if spares:
        try:
            from routers.maintenance_spare import record_usage
            with get_conn() as sconn:
                record_usage(sconn, "Daily Plan", {
                    "zone": row[0], "line": row[1], "machine_no": row[2],
                    "machine_name": row[3],
                    "used_date": row[4].isoformat() if row[4] else None,
                }, spares)
        except Exception as e:
            print(f"[SPARE-MASTER] record failed (daily): {e}")
    return {"ok": True, "duration_minutes": dur}


@router.put("/{pid}/reopen")
def reopen_plan(pid: int, user=Depends(get_current_user)):
    _ensure_table()
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("""UPDATE maintenance_daily_plan_work
                          SET status='PENDING', work_done=NULL, done_by=NULL, done_at=NULL,
                              start_time=NULL, end_time=NULL, duration_minutes=NULL,
                              spares=NULL, spares_used=NULL
                        WHERE id=%s""", (pid,))
        if cur.rowcount == 0:
            raise HTTPException(404, "Plan not found")
        conn.commit()
    return {"ok": True}


@router.delete("/{pid}")
def delete_plan(pid: int, admin=Depends(require_admin)):   # sirf admin delete kar sakta hai
    _ensure_table()
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM maintenance_daily_plan_work WHERE id=%s", (pid,))
        if cur.rowcount == 0:
            raise HTTPException(404, "Plan not found")
        conn.commit()
    return {"ok": True}
