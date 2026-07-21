"""
routers/skill_training.py
=========================
Maintenance Skill & Training — backing store for the "Skill & Training"
section of the Maintenance panel (OJT, Skill Matrix, Organisation Chart,
Skill Upgradation Plan).

One self-contained table `maintenance_skill_training` holds every entry.
Each row is tagged with a `section` (e.g. 'ojt') and carries the whole form
in a JSONB `payload`, so each sub-page can save its own format without a
schema change — when a sub-page's exact fields are finalised, they are just
posted inside `payload` and stored as-is.

Endpoints (prefix /api/skill-training)
--------------------------------------
GET    /            List entries (optional ?section=ojt, newest first)
GET    /{id}        Fetch one entry
POST   /            Create one entry  {section, payload}
PUT    /{id}        Update one entry  {section?, payload}
DELETE /{id}        Delete one entry
"""
import json
from typing import Optional, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from database import get_conn, dict_cursor
from auth import get_current_user

router = APIRouter(prefix="/api/skill-training", tags=["skill-training"])


def _ensure_table() -> None:
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS maintenance_skill_training (
                id          SERIAL PRIMARY KEY,
                section     VARCHAR(40) NOT NULL DEFAULT 'ojt',
                title       VARCHAR(200),
                payload     JSONB       NOT NULL DEFAULT '{}'::jsonb,
                created_by  VARCHAR(120),
                created_at  TIMESTAMP DEFAULT NOW(),
                updated_at  TIMESTAMP DEFAULT NOW()
            )
        """)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS ix_mst_section
                ON maintenance_skill_training (section)
        """)
        conn.commit()


class EntryIn(BaseModel):
    section: str = "ojt"
    title:   Optional[str] = None
    payload: dict[str, Any] = {}


class EntryUpdate(BaseModel):
    section: Optional[str] = None
    title:   Optional[str] = None
    payload: dict[str, Any] = {}


def _author(user) -> str:
    if isinstance(user, dict):
        return user.get("username") or user.get("name") or "user"
    return getattr(user, "username", None) or "user"


@router.get("/")
def list_entries(section: Optional[str] = Query(None, description="e.g. ojt"),
                 user=Depends(get_current_user)):
    _ensure_table()
    sql = "SELECT * FROM maintenance_skill_training"
    params: list = []
    if section:
        sql += " WHERE section = %s"
        params.append(section)
    sql += " ORDER BY created_at DESC, id DESC LIMIT 500"
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute(sql, params)
        return cur.fetchall()


@router.get("/{entry_id}")
def get_entry(entry_id: int, user=Depends(get_current_user)):
    _ensure_table()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT * FROM maintenance_skill_training WHERE id=%s", (entry_id,))
        row = cur.fetchone()
    if not row:
        raise HTTPException(404, "Entry not found")
    return row


@router.post("/", status_code=201)
def create_entry(body: EntryIn, user=Depends(get_current_user)):
    _ensure_table()
    with get_conn() as conn:
        cur = conn.cursor()
        try:
            cur.execute(
                """INSERT INTO maintenance_skill_training
                       (section, title, payload, created_by)
                   VALUES (%s, %s, %s::jsonb, %s) RETURNING id""",
                (body.section, body.title, json.dumps(body.payload), _author(user)),
            )
            new_id = cur.fetchone()[0]
            conn.commit()
        except Exception as e:
            conn.rollback()
            raise HTTPException(400, f"Save failed: {e}")
    return {"id": new_id}


@router.put("/{entry_id}")
def update_entry(entry_id: int, body: EntryUpdate, user=Depends(get_current_user)):
    _ensure_table()
    with get_conn() as conn:
        cur = conn.cursor()
        try:
            cur.execute(
                """UPDATE maintenance_skill_training
                      SET section    = COALESCE(%s, section),
                          title      = %s,
                          payload    = %s::jsonb,
                          updated_at = NOW()
                    WHERE id = %s""",
                (body.section, body.title, json.dumps(body.payload), entry_id),
            )
            if cur.rowcount == 0:
                raise HTTPException(404, "Entry not found")
            conn.commit()
        except HTTPException:
            conn.rollback()
            raise
        except Exception as e:
            conn.rollback()
            raise HTTPException(400, f"Update failed: {e}")
    return {"ok": True}


@router.delete("/{entry_id}")
def delete_entry(entry_id: int, user=Depends(get_current_user)):
    _ensure_table()
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM maintenance_skill_training WHERE id=%s", (entry_id,))
        if cur.rowcount == 0:
            raise HTTPException(404, "Entry not found")
        conn.commit()
    return {"ok": True}
