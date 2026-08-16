"""
routers/shutdown_plan.py
========================
Shutdown Plan Work — Update Plan → "Shutdown Plan Work" section.

Assign work to a machine for a shutdown date (zone/line/machine from the
Machine Master, plus the problem/work description and WHO will do it —
`assigned_to`).  Later the plan is COMPLETED by filling what work was
actually done and who did it.  Completed + pending plans are also listed
on the Historical Data page.

Mirrors sunday_plan.py / daily_plan.py, with one extra field: `assigned_to`
(the responsible person planned up-front — "kaun karega").

Table: maintenance_shutdown_plan
Endpoints (prefix /api/shutdown-plan)
-------------------------------------
GET    /                List plans (+filters) with {total, pending, done} counts
POST   /                Assign a new shutdown work plan
PUT    /{id}/complete   Fill work_done + done_by → status DONE
PUT    /{id}/reopen     Undo a completion (back to PENDING)
DELETE /{id}            Remove a plan (wrong entry)
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from database import get_conn, dict_cursor
from auth import get_current_user, require_admin

router = APIRouter(prefix="/api/shutdown-plan", tags=["shutdown-plan"])


def _ensure_table() -> None:
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS maintenance_shutdown_plan (
                id           SERIAL PRIMARY KEY,
                plan_date    DATE NOT NULL,
                zone_name    TEXT,
                line_name    TEXT,
                machine_no   TEXT,
                machine_name TEXT,
                problem      TEXT NOT NULL,
                assigned_to  TEXT,
                status       VARCHAR(12) NOT NULL DEFAULT 'PENDING',
                work_done    TEXT,
                done_by      TEXT,
                done_at      TIMESTAMP,
                created_by   TEXT,
                created_at   TIMESTAMP DEFAULT NOW()
            )
        """)
        # Safe on existing installs — add the column if the table pre-dates it.
        cur.execute("""
            ALTER TABLE maintenance_shutdown_plan
                ADD COLUMN IF NOT EXISTS assigned_to TEXT
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


class ShutdownPlanCreate(BaseModel):
    plan_date:    str            # YYYY-MM-DD (the shutdown date)
    zone_name:    str
    line_name:    str
    machine_no:   str
    machine_name: Optional[str] = ""
    problem:      str
    assigned_to:  Optional[str] = ""   # who will do it (planned owner)


class ShutdownPlanComplete(BaseModel):
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
        cur.execute(f"""SELECT * FROM maintenance_shutdown_plan WHERE {w}
                        ORDER BY plan_date DESC, id DESC LIMIT %s""", params + [limit])
        rows = [_ser(r) for r in cur.fetchall()]
        # counts over the same filter WITHOUT the status narrowing
        w2_parts = [c for c in where if not c.startswith("status")]
        p2 = [p for c, p in zip(where[1:], params) if not c.startswith("status")]
        cur.execute(f"""SELECT COUNT(*) AS total,
                               COUNT(*) FILTER (WHERE status='DONE')    AS done,
                               COUNT(*) FILTER (WHERE status='PENDING') AS pending
                          FROM maintenance_shutdown_plan WHERE {' AND '.join(w2_parts)}""", p2)
        c = cur.fetchone()
    return {"rows": rows, "total": int(c["total"]), "done": int(c["done"]),
            "pending": int(c["pending"])}


@router.post("/", status_code=201)
def create_plan(body: ShutdownPlanCreate, user=Depends(get_current_user)):
    _ensure_table()
    if not body.problem.strip():
        raise HTTPException(400, "problem / work description is required")
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("""INSERT INTO maintenance_shutdown_plan
                       (plan_date, zone_name, line_name, machine_no, machine_name,
                        problem, assigned_to, created_by)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
                    (body.plan_date, body.zone_name, body.line_name, body.machine_no,
                     body.machine_name, body.problem.strip(),
                     (body.assigned_to or "").strip() or None, _author(user)))
        new_id = cur.fetchone()[0]
        conn.commit()
    return {"id": new_id}


@router.put("/{pid}/complete")
def complete_plan(pid: int, body: ShutdownPlanComplete, user=Depends(get_current_user)):
    _ensure_table()
    if not body.work_done.strip():
        raise HTTPException(400, "work_done is required — what work was carried out?")
    if not body.done_by.strip():
        raise HTTPException(400, "done_by is required — who did the work?")
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("""UPDATE maintenance_shutdown_plan
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
        cur.execute("""UPDATE maintenance_shutdown_plan
                          SET status='PENDING', work_done=NULL, done_by=NULL, done_at=NULL
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
        cur.execute("DELETE FROM maintenance_shutdown_plan WHERE id=%s", (pid,))
        if cur.rowcount == 0:
            raise HTTPException(404, "Plan not found")
        conn.commit()
    return {"ok": True}
