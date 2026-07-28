"""
routers/qpr.py
==============
The QPR (Quality Problem Report) sheet store — now used ONLY by the CAPA
workflow (the standalone "QPR register" page and its list/create/delete
endpoints were removed on 2026-07-03).

A QPR row is created by POST /api/capa-lb/start/{bd_id} (pre-filled from a
≥60-minute breakdown in mes_breakdown_data, capa_status='OPEN').  The full
sheet lives in the JSONB `payload`; saving it via PUT auto-sets
capa_status='CLOSED', which closes the CAPA.

Endpoints (prefix /api/qpr)
---------------------------
GET    /{id}        Fetch one QPR sheet (the CAPA form / View)
PUT    /{id}        Save the sheet (title / payload) → closes its CAPA
"""
import json
from typing import Optional, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from database import get_conn, dict_cursor
from auth import get_current_user

router = APIRouter(prefix="/api/qpr", tags=["qpr"])


def _ensure_table() -> None:
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS maintenance_qpr (
                id          SERIAL PRIMARY KEY,
                qpr_no      INTEGER,
                title       VARCHAR(200),
                payload     JSONB       NOT NULL DEFAULT '{}'::jsonb,
                created_by  VARCHAR(120),
                created_at  TIMESTAMP DEFAULT NOW(),
                updated_at  TIMESTAMP DEFAULT NOW()
            )
        """)
        # CAPA linkage: a QPR filed against a ≥60-min breakdown carries the
        # source mes_breakdown_data row id + a capa_status (OPEN while being
        # filled, CLOSED once saved).
        cur.execute("ALTER TABLE maintenance_qpr ADD COLUMN IF NOT EXISTS logbook_id INTEGER")
        cur.execute("ALTER TABLE maintenance_qpr ADD COLUMN IF NOT EXISTS capa_status VARCHAR(12)")
        conn.commit()


class QPRUpdate(BaseModel):
    title:   Optional[str] = None
    payload: dict[str, Any] = {}


@router.get("/{qpr_id}")
def get_qpr(qpr_id: int, user=Depends(get_current_user)):
    _ensure_table()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT * FROM maintenance_qpr WHERE id=%s", (qpr_id,))
        row = cur.fetchone()
    if not row:
        raise HTTPException(404, "QPR not found")
    return row


@router.put("/{qpr_id}")
def update_qpr(qpr_id: int, body: QPRUpdate, user=Depends(get_current_user)):
    _ensure_table()
    with get_conn() as conn:
        cur = conn.cursor()
        try:
            cur.execute(
                """UPDATE maintenance_qpr
                      SET title = %s, payload = %s::jsonb, updated_at = NOW(),
                          capa_status = CASE WHEN logbook_id IS NOT NULL THEN 'CLOSED' ELSE capa_status END
                    WHERE id = %s""",
                (body.title, json.dumps(body.payload), qpr_id),
            )
            if cur.rowcount == 0:
                raise HTTPException(404, "QPR not found")
            conn.commit()
        except HTTPException:
            conn.rollback(); raise
        except Exception as e:
            conn.rollback()
            raise HTTPException(400, f"Update failed: {e}")
    return {"ok": True}
