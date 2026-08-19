"""
routers/maintenance_kpi_target.py
=================================
Maintenance KPI targets — one target value per row, at one of three levels
set by how deep the selection goes:

    ZONE     →  zone_name only
    LINE     →  zone_name + line_name
    MACHINE  →  zone_name + line_name + serial_no   (machine_no = code, snapshot)

Zone / line / serial_no all come from the Machine Master List (maintenance_machines).
A machine is identified per line by its integer `serial_no`; `machine_no`
holds the master's machine **code** (e.g. Y17_SS_01) as a display snapshot.
Every row is keyed by a financial year (fy).

Backing table: maintenance_kpi_target (created in main.py startup bootstrap).

Endpoints (prefix /api/maintenance-kpi-target)
----------------------------------------------
GET    /            List saved rows (optional ?fy=...)
POST   /            Create / upsert a row
PUT    /{id}        Update a row
DELETE /{id}        Delete a row
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from database import get_conn, dict_cursor
from auth import get_current_user

router = APIRouter(prefix="/api/maintenance-kpi-target",
                   tags=["maintenance-kpi-target"])


# ── Model ────────────────────────────────────────────────────────────
class TargetIn(BaseModel):
    fy:           str
    zone_name:    Optional[str]   = None
    line_name:    Optional[str]   = None
    serial_no:    Optional[int]   = None
    machine_no:   Optional[str]   = None   # master machine code (snapshot)
    machine_name: Optional[str]   = None
    kpi_key:      Optional[str]   = None
    target_value: Optional[float] = None
    month:        Optional[str]   = None   # MONTHLY level: Apr..Mar (all zones)


def _level_of(body: "TargetIn") -> str:
    if body.month:
        return "MONTHLY"
    if body.serial_no is not None:
        return "MACHINE"
    if body.line_name:
        return "LINE"
    return "ZONE"


def _validate(body: TargetIn) -> str:
    if not body.fy:
        raise HTTPException(400, "Financial Year is required")
    if not body.kpi_key:
        raise HTTPException(400, "KPI is required")
    if body.target_value is None:
        raise HTTPException(400, "Target value is required")
    # MONTHLY target — applies to every zone; needs a month, not a zone.
    if body.month:
        return "MONTHLY"
    if not body.zone_name:
        raise HTTPException(400, "Zone is required")
    if body.serial_no is not None and not body.line_name:
        raise HTTPException(400, "Machine target needs a Line selected too")
    return _level_of(body)


# ── Endpoints ────────────────────────────────────────────────────────
@router.get("/")
def list_targets(fy: Optional[str] = Query(None, description="e.g. 2025-2026"),
                 user=Depends(get_current_user)):
    """All saved rows, newest financial year first."""
    sql = """
        SELECT id, fy, zone_name, line_name, serial_no, machine_no, machine_name,
               level, kpi_key, target_value, month, created_at, updated_at
          FROM maintenance_kpi_target
    """
    params: list = []
    if fy:
        sql += " WHERE fy = %s"
        params.append(fy)
    # KPI series first (MTTR → MTBF → LTTR → Frequency → Hours → >1hr) so the
    # saved-targets list reads "all zones' MTTR, then all zones' MTBF, …".
    sql += (" ORDER BY fy DESC, "
            "CASE kpi_key "
            "  WHEN 'mttr_minutes'          THEN 1 "
            "  WHEN 'mtbf_hours'            THEN 2 "
            "  WHEN 'lttr_minutes'          THEN 3 "
            "  WHEN 'breakdown_frequency'   THEN 4 "
            "  WHEN 'total_breakdown_hours' THEN 5 "
            "  WHEN 'over_1hr_count'        THEN 6 "
            "  ELSE 7 END, "
            "zone_name, COALESCE(line_name,''), COALESCE(serial_no,0)")
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute(sql, params)
        return cur.fetchall()


@router.post("/", status_code=201)
def create_target(body: TargetIn, user=Depends(get_current_user)):
    """Create.  The same scope (zone / line / machine) + same KPI can be
    filled only ONCE per financial year — a duplicate save is rejected with
    409 (the frontend shows a popup); use Edit to change an existing one."""
    level = _validate(body)
    with get_conn() as conn:
        cur = conn.cursor()
        try:
            if level == "MONTHLY":
                cur.execute("""
                    SELECT id FROM maintenance_kpi_target
                     WHERE fy = %s AND kpi_key = %s AND level = 'MONTHLY'
                       AND month IS NOT DISTINCT FROM %s
                """, (body.fy, body.kpi_key, body.month))
                if cur.fetchone():
                    raise HTTPException(409,
                        f"Target already filled: {body.kpi_key} for month {body.month} in FY {body.fy}. "
                        f"It can be filled only once — use Edit to change it.")
            else:
                cur.execute("""
                    SELECT id FROM maintenance_kpi_target
                     WHERE fy = %s AND zone_name = %s AND kpi_key = %s
                       AND line_name IS NOT DISTINCT FROM %s
                       AND serial_no IS NOT DISTINCT FROM %s
                       AND month IS NULL
                """, (body.fy, body.zone_name, body.kpi_key, body.line_name, body.serial_no))
                if cur.fetchone():
                    scope = body.zone_name + (f" / {body.line_name}" if body.line_name else "") \
                            + (f" / {body.machine_no}" if body.machine_no else "")
                    raise HTTPException(409,
                        f"Target already filled: {body.kpi_key} for {scope} in FY {body.fy}. "
                        f"It can be filled only once per financial year — use Edit to change it.")
            cur.execute("""
                INSERT INTO maintenance_kpi_target
                    (fy, zone_name, line_name, serial_no, machine_no,
                     machine_name, level, kpi_key, target_value, month)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                RETURNING id
            """, (body.fy, body.zone_name, body.line_name, body.serial_no,
                  body.machine_no, body.machine_name, level, body.kpi_key,
                  body.target_value, body.month))
            new_id = cur.fetchone()[0]
            conn.commit()
        except HTTPException:
            conn.rollback()
            raise
        except Exception as e:
            conn.rollback()
            raise HTTPException(400, f"Save failed: {e}")
    return {"id": new_id, "level": level}


@router.put("/{target_id}")
def update_target(target_id: int, body: TargetIn, user=Depends(get_current_user)):
    level = _validate(body)
    with get_conn() as conn:
        cur = conn.cursor()
        try:
            cur.execute("""
                UPDATE maintenance_kpi_target
                   SET fy=%s, zone_name=%s, line_name=%s, serial_no=%s,
                       machine_no=%s, machine_name=%s, level=%s, kpi_key=%s,
                       target_value=%s, month=%s, updated_at=NOW()
                 WHERE id=%s
            """, (body.fy, body.zone_name, body.line_name, body.serial_no,
                  body.machine_no, body.machine_name, level, body.kpi_key,
                  body.target_value, body.month, target_id))
            if cur.rowcount == 0:
                raise HTTPException(404, "Target not found")
            conn.commit()
        except HTTPException:
            conn.rollback()
            raise
        except Exception as e:
            conn.rollback()
            raise HTTPException(400, f"Update failed: {e}")
    return {"ok": True, "level": level}


@router.delete("/{target_id}")
def delete_target(target_id: int, user=Depends(get_current_user)):
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM maintenance_kpi_target WHERE id=%s", (target_id,))
        if cur.rowcount == 0:
            raise HTTPException(404, "Target not found")
        conn.commit()
    return {"ok": True}
