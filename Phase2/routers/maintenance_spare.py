"""
routers/maintenance_spare.py
============================
`maintenance_spare` — the SINGLE source for spare data, fed ONLY by the Manual
Break Down Slip and the Maintenance Log Book.  One row per spare occurrence,
with its zone / line / machine / date context, so it powers BOTH:

  • the Spare page consumption report   (GET /api/spares/consumption reads here)
  • the Spare-Name picker on the slip + log book  (GET /api/maintenance-spare/)

Endpoint
--------
GET /api/maintenance-spare/   → distinct spares (one row per name) for the picker
"""
from typing import List
from fastapi import APIRouter, Depends

from database import get_conn, dict_cursor
from auth import get_current_user

router = APIRouter(prefix="/api/maintenance-spare", tags=["maintenance-spare"])

_ensured = False


def _ensure_table():
    global _ensured
    if _ensured:
        return
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS maintenance_spare (
                id             SERIAL PRIMARY KEY,
                source         VARCHAR(20),        -- 'Manual Slip' | 'Log Book'
                zone           VARCHAR(120),
                line           VARCHAR(120),
                machine_no     VARCHAR(60),
                machine_name   VARCHAR(160),
                spare_name     VARCHAR(200) NOT NULL,
                spare_model_no VARCHAR(200),
                spare_cnmm_no  VARCHAR(200),
                spare_qty      VARCHAR(40),
                used_date      DATE,
                created_at     TIMESTAMP DEFAULT NOW()
            )
        """)
        # If an earlier (name-only master) version of the table exists, add the
        # usage-context columns and drop the old distinct-master unique index
        # (we now keep one row per occurrence).
        for col, typ in [
            ("source", "VARCHAR(20)"), ("zone", "VARCHAR(120)"), ("line", "VARCHAR(120)"),
            ("machine_no", "VARCHAR(60)"), ("machine_name", "VARCHAR(160)"),
            ("spare_qty", "VARCHAR(40)"), ("used_date", "DATE"),
        ]:
            cur.execute(f"ALTER TABLE maintenance_spare ADD COLUMN IF NOT EXISTS {col} {typ}")
        cur.execute("DROP INDEX IF EXISTS uq_maintenance_spare")
        conn.commit()
    _ensured = True


def record_usage(conn, source: str, ctx: dict, spares):
    """Record each spare occurrence (name required) from a Manual Slip / Log Book
    save, with its zone/line/machine/date context.  Best-effort — never let a
    spare failure block the actual save (callers wrap this in try/except)."""
    _ensure_table()
    ctx = ctx or {}
    used_date = (ctx.get("used_date") or "").strip() if isinstance(ctx.get("used_date"), str) else ctx.get("used_date")
    cur = conn.cursor()
    for s in (spares or []):
        if not isinstance(s, dict):
            continue
        name = (s.get("spare_name") or "").strip()
        if not name:
            continue
        cur.execute("""
            INSERT INTO maintenance_spare
                (source, zone, line, machine_no, machine_name,
                 spare_name, spare_model_no, spare_cnmm_no, spare_qty, used_date)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        """, (
            source, ctx.get("zone"), ctx.get("line"),
            ctx.get("machine_no"), ctx.get("machine_name"),
            name,
            (s.get("spare_model_no") or "").strip() or None,
            (s.get("spare_cnmm_no") or "").strip() or None,
            (str(s.get("spare_qty") or "").strip() or None),
            used_date or None,
        ))


@router.get("/")
def list_spares(user=Depends(get_current_user)) -> List[dict]:
    """One row per distinct spare name (newest model/cnmm) — feeds the pickers."""
    _ensure_table()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("""
            SELECT DISTINCT ON (LOWER(spare_name))
                   spare_name, spare_model_no, spare_cnmm_no
              FROM maintenance_spare
             WHERE NULLIF(TRIM(COALESCE(spare_name,'')),'') IS NOT NULL
             ORDER BY LOWER(spare_name), id DESC
        """)
        return cur.fetchall()
