"""
routers/machines.py
===================
Machine master list (zone × line × machine_no → machine_name).

Source-of-truth was imported from NF2's `zones.json`.  Used by the
Maintenance closure form to auto-fill the Machine Name when the user
types a Machine No.

Endpoints
---------
GET  /api/machines/by-line/{line_id}     → list of machines for a MES line
                                            (resolves zone + NF2 line name
                                            mapping, with fuzzy fallback)
GET  /api/machines/?zone=X&line=Y        → raw lookup (no MES line FK)
GET  /api/machines/lookup?line_id=X&no=N → single machine_name for type-ahead
"""
import re
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from database import get_conn, dict_cursor
from auth import get_current_user, require_admin

router = APIRouter(prefix="/api/machines", tags=["machines"])


def _norm(s: str) -> str:
    """Strip everything but a-z0-9 (so 'YNC-SS', 'YNC_SS', 'YNC SS' all match)."""
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def _resolve_nf2_line(conn, line_id: int):
    """Purane `/by-line/{line_id}` callers ke liye.  Line ka koi master ab
    nahi hai, isliye hamesha (None, None) — caller apne aap Machine Master ke
    zone/line naam par gir jaata hai."""
    return None, None


@router.get("/by-line/{line_id}")
def list_for_line(line_id: int, user=Depends(get_current_user)):
    """Return every machine row for the (zone, line) combo of a MES line —
    sorted by serial_no.  Each row carries serial_no (per-line int) +
    machine_no (code) + machine_name.  Frontend keeps this list in memory
    and auto-fills machine_no + machine_name as the user types a Serial No."""
    with get_conn() as conn:
        zone_name, nf2_line = _resolve_nf2_line(conn, line_id)
        if not zone_name or not nf2_line:
            return {"zone_name": None, "line_name": None, "machines": []}

        cur = dict_cursor(conn)
        cur.execute("""
            SELECT id, source_id, zone_name, line_name, serial_no, machine_no,
                   machine_name, is_active
              FROM maintenance_machines
             WHERE LOWER(zone_name) = LOWER(%s)
               AND LOWER(line_name) = LOWER(%s)
               AND is_active = TRUE
             ORDER BY serial_no
        """, (zone_name, nf2_line))
        return {
            "zone_name": zone_name,
            "line_name": nf2_line,
            "machines":  cur.fetchall(),
        }


@router.get("/")
def list_machines(zone: Optional[str] = None,
                  line: Optional[str] = None,
                  user=Depends(get_current_user)):
    """Raw lookup by zone_name + line_name.  Either or both can be omitted
    to widen the result.  Used for ad-hoc admin browsing."""
    where = ["is_active = TRUE"]
    params: list = []
    if zone:
        where.append("LOWER(zone_name) = LOWER(%s)"); params.append(zone)
    if line:
        where.append("LOWER(line_name) = LOWER(%s)"); params.append(line)

    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute(f"""
            SELECT id, zone_name, line_name, serial_no, machine_no, machine_name
              FROM maintenance_machines
             WHERE {' AND '.join(where)}
             ORDER BY zone_name, line_name, serial_no
             LIMIT 1000
        """, params)
        return cur.fetchall()


@router.get("/lookup")
def lookup_one(line_id: int = Query(...),
               no: int = Query(..., description="serial_no (1-based per line)"),
               user=Depends(get_current_user)):
    """Single-machine lookup by per-line serial_no → returns the machine_no
    (code) + machine_name.  Used by the breakdown slip to auto-fill the
    Machine No. (code) and Machine Name when the user types a Serial No."""
    with get_conn() as conn:
        zone_name, nf2_line = _resolve_nf2_line(conn, line_id)
        if not zone_name or not nf2_line:
            raise HTTPException(404, "Line not found or not mapped")

        cur = dict_cursor(conn)
        cur.execute("""
            SELECT id, serial_no, machine_no, machine_name
              FROM maintenance_machines
             WHERE LOWER(zone_name) = LOWER(%s)
               AND LOWER(line_name) = LOWER(%s)
               AND serial_no = %s
               AND is_active = TRUE
             LIMIT 1
        """, (zone_name, nf2_line, no))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Machine not found")
        return row


