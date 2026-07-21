"""
routers/org_chart.py
====================
Organization Chart with monthly version history.  One record per month
(YYYY-MM); saving upserts the given month so previous months are never
overwritten.  The whole chart — nodes (employees, positions, base64
photos), edges (connectors), manpower boxes and stars — lives in the JSONB
`data` column.

Endpoints (prefix /api/org-chart)
---------------------------------
GET    /months          List months that have a saved chart (newest first)
GET    /?month=YYYY-MM   Fetch one month's chart (null data if none)
POST   /                Upsert a month's chart {month, title, data}
DELETE /{month}         Delete a month's chart
"""
import json
import calendar
from typing import Optional, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from database import get_conn, dict_cursor
from auth import get_current_user

router = APIRouter(prefix="/api/org-chart", tags=["org-chart"])


def _ensure_table() -> None:
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS maintenance_org_chart (
                id          SERIAL PRIMARY KEY,
                month       VARCHAR(7) UNIQUE NOT NULL,   -- YYYY-MM
                title       VARCHAR(200),
                data        JSONB NOT NULL DEFAULT '{}'::jsonb,
                created_by  VARCHAR(120),
                created_at  TIMESTAMP DEFAULT NOW(),
                updated_at  TIMESTAMP DEFAULT NOW()
            )
        """)
        conn.commit()


def _label(month: str) -> str:
    try:
        y, m = month.split("-")
        return f"{calendar.month_name[int(m)]} {y}"
    except Exception:
        return month


class ChartIn(BaseModel):
    month: str                       # YYYY-MM
    title: Optional[str] = None
    data:  dict[str, Any] = {}


def _author(user) -> str:
    if isinstance(user, dict):
        return user.get("username") or user.get("name") or "user"
    return getattr(user, "username", None) or "user"


@router.get("/months")
def list_months(user=Depends(get_current_user)):
    _ensure_table()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT month, title, updated_at FROM maintenance_org_chart ORDER BY month DESC")
        return [{"month": r["month"], "label": _label(r["month"]),
                 "updated_at": r["updated_at"].isoformat() if r["updated_at"] else None}
                for r in cur.fetchall()]


@router.get("/")
def get_chart(month: str = Query(..., description="YYYY-MM"), user=Depends(get_current_user)):
    _ensure_table()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT * FROM maintenance_org_chart WHERE month=%s", (month,))
        row = cur.fetchone()
    if not row:
        return {"month": month, "label": _label(month), "data": None, "exists": False}
    return {"month": row["month"], "label": _label(row["month"]),
            "title": row["title"], "data": row["data"], "exists": True,
            "updated_at": row["updated_at"].isoformat() if row["updated_at"] else None}


@router.post("/", status_code=201)
def save_chart(body: ChartIn, user=Depends(get_current_user)):
    _ensure_table()
    if not body.month or len(body.month) != 7 or body.month[4] != "-":
        raise HTTPException(400, "month must be YYYY-MM")
    with get_conn() as conn:
        cur = conn.cursor()
        try:
            cur.execute("""
                INSERT INTO maintenance_org_chart (month, title, data, created_by)
                VALUES (%s, %s, %s::jsonb, %s)
                ON CONFLICT (month) DO UPDATE
                   SET title = EXCLUDED.title,
                       data  = EXCLUDED.data,
                       updated_at = NOW()
                RETURNING id
            """, (body.month, body.title, json.dumps(body.data), _author(user)))
            new_id = cur.fetchone()[0]
            conn.commit()
        except Exception as e:
            conn.rollback()
            raise HTTPException(400, f"Save failed: {e}")
    return {"id": new_id, "month": body.month, "label": _label(body.month)}


@router.delete("/{month}")
def delete_chart(month: str, user=Depends(get_current_user)):
    _ensure_table()
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM maintenance_org_chart WHERE month=%s", (month,))
        if cur.rowcount == 0:
            raise HTTPException(404, "No chart for that month")
        conn.commit()
    return {"ok": True}
