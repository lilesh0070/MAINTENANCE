"""
routers/dashboard_zones.py
==========================
Which zones show as tiles on the Maintenance Dashboard "Pending Breakdown"
panel (KpiPanel).  This is an admin-curated whitelist that *defaults* to the
six production zones but can be extended — a new zone can only be added if it
already exists in the Machine Master (maintenance_machines), so the standing
rule holds: **zone maintenance_machines se hi aata hai**.

Backing table (lazy-created): maintenance_dashboard_zones
    zone_name   TEXT PRIMARY KEY   -- exact spelling from maintenance_machines
    sort_order  INT                -- display order (lower first)
    created_at  TIMESTAMPTZ

Endpoints (prefix /api/dashboard-zones)
---------------------------------------
GET    /                List zone_names in display order   (any signed-in user)
POST   /                Add a zone (must exist in master)   (admin only)
DELETE /{zone_name}     Remove a zone from the dashboard     (admin only)
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from database import get_conn, dict_cursor
from auth import get_current_user, require_admin

router = APIRouter(prefix="/api/dashboard-zones", tags=["dashboard-zones"])

# Default production zones (same list/order as the frontend PROD_ZONES).
_DEFAULT_ZONES = [
    "SEAT_SLIDER",
    "RECLINER",
    "SUB_ASSEMBLY",
    "PRESS_SHOP",
    "THIN_RECLINER",
    "LOOP_PIPE",
]


class ZoneIn(BaseModel):
    zone_name: str


def _ensure(conn):
    """Create the table on first use and seed the six production zones if it
    is empty (a fresh install, or after every zone was removed)."""
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS maintenance_dashboard_zones (
            zone_name  TEXT PRIMARY KEY,
            sort_order INT         NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        )
    """)
    cur.execute("SELECT COUNT(*) FROM maintenance_dashboard_zones")
    if cur.fetchone()[0] == 0:
        for i, z in enumerate(_DEFAULT_ZONES):
            cur.execute(
                "INSERT INTO maintenance_dashboard_zones (zone_name, sort_order) "
                "VALUES (%s,%s) ON CONFLICT (zone_name) DO NOTHING", (z, i))
    conn.commit()


def _list(conn):
    cur = dict_cursor(conn)
    cur.execute("SELECT zone_name, sort_order FROM maintenance_dashboard_zones "
                "ORDER BY sort_order, zone_name")
    return cur.fetchall()


@router.get("/")
def list_zones(user=Depends(get_current_user)):
    """Zones shown on the dashboard, in display order."""
    with get_conn() as conn:
        _ensure(conn)
        return _list(conn)


@router.post("/", status_code=201)
def add_zone(body: ZoneIn, admin=Depends(require_admin)):
    """Add a zone tile.  The zone MUST exist in the Machine Master — the
    picker only offers maintenance_machines zones, and we re-check here so no
    stray zone can be introduced from outside the master."""
    name = (body.zone_name or "").strip()
    if not name:
        raise HTTPException(400, "Zone is required")
    with get_conn() as conn:
        _ensure(conn)
        cur = conn.cursor()
        # Must exist in the master — and store the master's exact spelling.
        cur.execute("SELECT zone_name FROM maintenance_machines "
                    "WHERE LOWER(zone_name) = LOWER(%s) LIMIT 1", (name,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(400,
                f"'{name}' is not a zone in the Machine Master "
                f"(maintenance_machines). Only master zones can be added.")
        canon = row[0]
        cur.execute("SELECT COALESCE(MAX(sort_order), -1) + 1 "
                    "FROM maintenance_dashboard_zones")
        nxt = cur.fetchone()[0]
        cur.execute("INSERT INTO maintenance_dashboard_zones (zone_name, sort_order) "
                    "VALUES (%s,%s) ON CONFLICT (zone_name) DO NOTHING", (canon, nxt))
        conn.commit()
        return {"ok": True, "zones": _list(conn)}


@router.delete("/{zone_name}")
def remove_zone(zone_name: str, admin=Depends(require_admin)):
    """Remove a zone tile from the dashboard.  Does NOT touch the Machine
    Master — only this display list."""
    with get_conn() as conn:
        _ensure(conn)
        cur = conn.cursor()
        cur.execute("DELETE FROM maintenance_dashboard_zones "
                    "WHERE LOWER(zone_name) = LOWER(%s)", (zone_name,))
        conn.commit()
        return {"ok": True, "zones": _list(conn)}
