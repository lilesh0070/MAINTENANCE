"""
routers/kpi_ui_settings.py
==========================
Admin-editable APPEARANCE settings for the Maintenance KPI page — so colours,
chart bar colours and axis limits can be changed from inside the page (no code
edit).  One shared singleton row; any signed-in user can read it (to render the
page), only an admin can save it.

Shape of `settings` (JSON): { <kpi_key>: {accent, bar, yMax}, ... }

Backing table (lazy-created): maintenance_kpi_ui_settings (id=1 singleton)

Endpoints (prefix /api/kpi-ui-settings)
---------------------------------------
GET  /   Current settings   (any signed-in user)
PUT  /   Save settings      (admin only)
"""
import json

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from database import get_conn, dict_cursor
from auth import get_current_user, require_admin

router = APIRouter(prefix="/api/kpi-ui-settings", tags=["kpi-ui-settings"])


class UiIn(BaseModel):
    settings: dict = {}


def _ensure(conn):
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS maintenance_kpi_ui_settings (
            id         INT PRIMARY KEY DEFAULT 1,
            settings   JSONB       NOT NULL DEFAULT '{}'::jsonb,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    conn.commit()


@router.get("/")
def get_settings(user=Depends(get_current_user)):
    with get_conn() as conn:
        _ensure(conn)
        cur = dict_cursor(conn)
        cur.execute("SELECT settings FROM maintenance_kpi_ui_settings WHERE id = 1")
        row = cur.fetchone()
    return {"settings": (row["settings"] if row else {}) or {}}


@router.put("/")
def save_settings(body: UiIn, admin=Depends(require_admin)):
    with get_conn() as conn:
        _ensure(conn)
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO maintenance_kpi_ui_settings (id, settings, updated_at)
            VALUES (1, %s::jsonb, NOW())
            ON CONFLICT (id) DO UPDATE
               SET settings = EXCLUDED.settings, updated_at = NOW()
        """, [json.dumps(body.settings or {})])
        conn.commit()
    return {"ok": True}
