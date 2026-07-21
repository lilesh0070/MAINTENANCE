"""
routers/skill_eval.py
=====================
Skill Matrix — Skill Evaluation.  One record per
(employee, zone, machine, process, assessment-cycle).  A cycle is a
3-month calendar quarter (Jan-Mar / Apr-Jun / Jul-Sep / Oct-Dec); an
employee cannot be evaluated twice for the same machine/process within the
same cycle.

Totals, max, percentage and skill-level status are computed server-side
from the submitted per-topic marks.

Endpoints (prefix /api/skill-eval)
----------------------------------
GET    /            List records (filters: period, zone, machine, process, employee, date_from, date_to)
GET    /check       {exists} for (employee, zone, machine, process, assessment_date)
GET    /periods     Selectable 3-month cycles (current + recent)
POST   /            Create one evaluation (duplicate-guarded)
DELETE /{id}        Delete one record
"""
import json
import calendar
from datetime import datetime, date
from typing import Optional, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from database import get_conn, dict_cursor
from auth import get_current_user

router = APIRouter(prefix="/api/skill-eval", tags=["skill-eval"])


# ── 3-month cycle helpers ────────────────────────────────────────────
def _cycle_of(d: date) -> tuple[str, str, date, date]:
    """date → (key 'YYYY-Q#', label 'Jul–Sep 2026', start, end-exclusive)."""
    q = (d.month - 1) // 3 + 1                # 1..4
    start_month = (q - 1) * 3 + 1
    start = date(d.year, start_month, 1)
    end_year = d.year + (1 if start_month + 3 > 12 else 0)
    end_month = (start_month + 3 - 1) % 12 + 1
    end = date(end_year, end_month, 1)
    label = f"{calendar.month_abbr[start_month]}–{calendar.month_abbr[start_month + 2]} {d.year}"
    return f"{d.year}-Q{q}", label, start, end


def _status_for(pct: float) -> str:
    if pct >= 76:  return "Level 4 (76-100%)"
    if pct >= 51:  return "Level 3 (51-75%)"
    if pct >= 26:  return "Level 2 (26-50%)"
    if pct > 0:    return "Level 1 (0-25%)"
    return "Level 0"


def _ensure_table() -> None:
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS maintenance_skill_eval (
                id              SERIAL PRIMARY KEY,
                employee        VARCHAR(120) NOT NULL,
                zone            VARCHAR(120),
                machine         VARCHAR(160),
                process         VARCHAR(160),
                period          VARCHAR(16),
                period_label    VARCHAR(40),
                assessment_date DATE,
                topics          JSONB NOT NULL DEFAULT '[]'::jsonb,
                total_marks     NUMERIC,
                max_marks       NUMERIC,
                percentage      NUMERIC,
                status          VARCHAR(40),
                created_by      VARCHAR(120),
                created_at      TIMESTAMP DEFAULT NOW()
            )
        """)
        cur.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS uq_skill_eval
                ON maintenance_skill_eval (employee, zone, machine, process, period)
        """)
        conn.commit()


class TopicMark(BaseModel):
    name: str
    max:  float = 0
    mark: float = 0


class EvalIn(BaseModel):
    employee:        str
    zone:            str
    machine:         str
    process:         Optional[str] = ""
    assessment_date: str                       # YYYY-MM-DD
    topics:          list[TopicMark] = []


def _author(user) -> str:
    if isinstance(user, dict):
        return user.get("username") or user.get("name") or "user"
    return getattr(user, "username", None) or "user"


def _parse_date(s: str) -> date:
    try:
        return datetime.strptime(s, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        raise HTTPException(400, "assessment_date must be YYYY-MM-DD")


@router.get("/periods")
def periods(user=Depends(get_current_user)):
    """Current 3-month cycle + the previous 7, newest first."""
    now = datetime.utcnow().date()
    out, seen = [], set()
    y, m = now.year, now.month
    for _ in range(8):
        d = date(y, m, 1)
        key, label, start, _end = _cycle_of(d)
        if key not in seen:
            seen.add(key)
            out.append({"period": key, "label": label, "start": start.isoformat(),
                        "is_current": key == _cycle_of(now)[0]})
        # step back 3 months
        m -= 3
        if m <= 0:
            m += 12; y -= 1
    return out


@router.get("/check")
def check_dup(employee: str = Query(...), zone: str = Query(...),
              machine: str = Query(...), process: str = Query(""),
              assessment_date: str = Query(...), user=Depends(get_current_user)):
    _ensure_table()
    key, label, *_ = _cycle_of(_parse_date(assessment_date))
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("""
            SELECT id, assessment_date FROM maintenance_skill_eval
             WHERE employee=%s AND zone=%s AND machine=%s AND COALESCE(process,'')=%s AND period=%s
        """, (employee, zone, machine, process or "", key))
        row = cur.fetchone()
    return {"exists": bool(row), "period": key, "period_label": label,
            "existing_id": row["id"] if row else None}


@router.get("/")
def list_evals(period:    Optional[str] = Query(None),
               zone:      Optional[str] = Query(None),
               machine:   Optional[str] = Query(None),
               process:   Optional[str] = Query(None),
               employee:  Optional[str] = Query(None),
               date_from: Optional[str] = Query(None),
               date_to:   Optional[str] = Query(None),
               user=Depends(get_current_user)):
    _ensure_table()
    where, params = ["1=1"], []
    if period:   where.append("period = %s");   params.append(period)
    if zone:     where.append("zone = %s");     params.append(zone)
    if machine:  where.append("machine = %s");  params.append(machine)
    if process:  where.append("process = %s");  params.append(process)
    if employee: where.append("employee = %s"); params.append(employee)
    if date_from:where.append("assessment_date >= %s"); params.append(date_from)
    if date_to:  where.append("assessment_date <= %s"); params.append(date_to)
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute(f"""SELECT * FROM maintenance_skill_eval
                        WHERE {' AND '.join(where)}
                        ORDER BY assessment_date DESC, id DESC LIMIT 2000""", params)
        return cur.fetchall()


@router.post("/", status_code=201)
def create_eval(body: EvalIn, user=Depends(get_current_user)):
    _ensure_table()
    if not body.employee.strip():
        raise HTTPException(400, "Employee is required")
    if not body.zone.strip() or not body.machine.strip():
        raise HTTPException(400, "Zone and Machine are required")
    d = _parse_date(body.assessment_date)
    key, label, *_ = _cycle_of(d)
    proc = (body.process or "").strip()

    # duplicate guard — one evaluation per employee/machine/process per cycle
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("""SELECT id FROM maintenance_skill_eval
                        WHERE employee=%s AND zone=%s AND machine=%s
                          AND COALESCE(process,'')=%s AND period=%s""",
                    (body.employee, body.zone, body.machine, proc, key))
        if cur.fetchone():
            raise HTTPException(409,
                f"{body.employee} is already evaluated for “{body.machine}” in {label}. "
                f"Skill Matrix is filled once per 3-month cycle.")

    total = round(sum(float(t.mark or 0) for t in body.topics), 2)
    mx    = round(sum(float(t.max or 0) for t in body.topics), 2)
    pct   = round(total / mx * 100, 1) if mx else 0.0
    status = _status_for(pct)
    topics_json = [{"name": t.name, "max": t.max, "mark": t.mark} for t in body.topics]

    with get_conn() as conn:
        cur = conn.cursor()
        try:
            cur.execute("""
                INSERT INTO maintenance_skill_eval
                  (employee, zone, machine, process, period, period_label, assessment_date,
                   topics, total_marks, max_marks, percentage, status, created_by)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s,%s,%s,%s,%s) RETURNING id
            """, (body.employee, body.zone, body.machine, proc, key, label, d,
                  json.dumps(topics_json), total, mx, pct, status, _author(user)))
            new_id = cur.fetchone()[0]
            conn.commit()
        except HTTPException:
            conn.rollback(); raise
        except Exception as e:
            conn.rollback()
            # unique-index violation → friendly message
            if "uq_skill_eval" in str(e):
                raise HTTPException(409, f"{body.employee} already evaluated for this machine in {label}.")
            raise HTTPException(400, f"Save failed: {e}")
    return {"id": new_id, "period": key, "period_label": label,
            "total": total, "max": mx, "percentage": pct, "status": status}


@router.delete("/{eval_id}")
def delete_eval(eval_id: int, user=Depends(get_current_user)):
    _ensure_table()
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM maintenance_skill_eval WHERE id=%s", (eval_id,))
        if cur.rowcount == 0:
            raise HTTPException(404, "Record not found")
        conn.commit()
    return {"ok": True}
