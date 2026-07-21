"""
routers/sunday_plan.py
======================
Sunday Plan Work — Update Plan → "Sunday Plan Work" section.

Assign work to a machine for a Sunday (zone/line/machine from the Machine
Master, plus the problem/work description).  Later the plan is COMPLETED by
filling what work was done and who did it.  Completed + pending plans are
also listed on the Historical Data page.

Table: maintenance_sunday_plan
Endpoints (prefix /api/sunday-plan)
-----------------------------------
GET    /            List plans (+filters) with {total, pending, done} counts
POST   /            Assign a new Sunday work plan
PUT    /{id}/complete   Fill work_done + done_by → status DONE
PUT    /{id}/reopen     Undo a completion (back to PENDING)
DELETE /{id}        Remove a plan (wrong entry)
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from database import get_conn, dict_cursor
from auth import get_current_user

router = APIRouter(prefix="/api/sunday-plan", tags=["sunday-plan"])


def _ensure_table() -> None:
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS maintenance_sunday_plan (
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
    plan_date:    str            # YYYY-MM-DD (the Sunday)
    zone_name:    str
    line_name:    str
    machine_no:   str
    machine_name: Optional[str] = ""
    problem:      str


class SundayPlanComplete(BaseModel):
    work_done: str
    done_by:   str


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
        cur.execute(f"""SELECT * FROM maintenance_sunday_plan WHERE {w}
                        ORDER BY plan_date DESC, id DESC LIMIT %s""", params + [limit])
        rows = [_ser(r) for r in cur.fetchall()]
        # counts over the same filter WITHOUT the status narrowing
        w2_parts = [c for c in where if not c.startswith("status")]
        p2 = [p for c, p in zip(where[1:], params) if not c.startswith("status")]
        cur.execute(f"""SELECT COUNT(*) AS total,
                               COUNT(*) FILTER (WHERE status='DONE')    AS done,
                               COUNT(*) FILTER (WHERE status='PENDING') AS pending
                          FROM maintenance_sunday_plan WHERE {' AND '.join(w2_parts)}""", p2)
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
        cur.execute("""INSERT INTO maintenance_sunday_plan
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
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("""UPDATE maintenance_sunday_plan
                          SET status='DONE', work_done=%s, done_by=%s, done_at=NOW()
                        WHERE id=%s""",
                    (body.work_done.strip(), body.done_by.strip(), pid))
        if cur.rowcount == 0:
            raise HTTPException(404, "Plan not found")
        conn.commit()
    return {"ok": True}


@router.put("/{pid}/reopen")
def reopen_plan(pid: int, user=Depends(get_current_user)):
    _ensure_table()
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("""UPDATE maintenance_sunday_plan
                          SET status='PENDING', work_done=NULL, done_by=NULL, done_at=NULL
                        WHERE id=%s""", (pid,))
        if cur.rowcount == 0:
            raise HTTPException(404, "Plan not found")
        conn.commit()
    return {"ok": True}


@router.delete("/{pid}")
def delete_plan(pid: int, user=Depends(get_current_user)):
    _ensure_table()
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM maintenance_sunday_plan WHERE id=%s", (pid,))
        if cur.rowcount == 0:
            raise HTTPException(404, "Plan not found")
        conn.commit()
    return {"ok": True}
