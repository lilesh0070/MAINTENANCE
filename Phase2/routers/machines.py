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


# ── Machine Master ka schema (lazy, idempotent) ──────────────────────
_ensured = False


def _ensure_master():
    """`ip` column jodo — Machine Master page har machine ka IP dikhata/bharta
    hai.  Baaki columns pehle se hain (is_active bhi), isliye sirf yahi."""
    global _ensured
    if _ensured:
        return
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("ALTER TABLE maintenance_machines ADD COLUMN IF NOT EXISTS ip VARCHAR(45)")
        conn.commit()
    _ensured = True


# machine_no in SAB tables me sirf TEXT ke roop me pada hai — koi foreign key
# nahi hai.  Isliye master me naam badalte hi us machine ki poori history
# (breakdown, PM, DMC, spare, KPI target, ANDON...) TOOT jaati: purane records
# purane naam par reh jaate aur machine ke saath dikhna band ho jaate.
#
# Isliye rename par ye saari tables SAATH me badalte hain, ek hi transaction
# me — ya sab badlega ya kuch nahi.  Ye list `information_schema` se nikaali
# hai (jin tables me machine_no column hai), khud maan kar nahi.
_MNO_TABLES = [
    "andon_history", "andon_plc_devices", "andon_system", "breakdown_status",
    "machine_dmc", "machine_dmc_fill_ng_point", "machine_dmc_filled", "machine_dmc_rev",
    "maintenance_auto_breakdown_slip", "maintenance_breakdown_data",
    "maintenance_capa_sheet", "maintenance_daily_plan_work", "maintenance_deviations",
    "maintenance_escalation_log", "maintenance_kpi_target",
    "maintenance_logbook_db_history", "maintenance_machine_running_hours",
    "maintenance_pm_check_point", "maintenance_pm_check_point_rev",
    "maintenance_pm_check_sheet_filled", "maintenance_shutdown_plan",
    "maintenance_spare", "maintenance_sunday_plan", "pm_schedule",
    "toolroom_auto_breakdown_slip",
]


def _cascade_machine_no(cur, old: str, new: str) -> dict:
    """Har us table me machine_no badlo jahan wo text ke roop me pada hai.
    Caller ke SAME transaction me chalta hai, isliye master aur history dono
    ek saath badalte hain — beech me fail hua to kuch bhi nahi badla.
    Lautata hai {table: kitni rows badli} sirf un tables ka jahan kuch badla."""
    touched = {}
    for t in _MNO_TABLES:
        try:
            cur.execute(f"UPDATE {t} SET machine_no = %s WHERE machine_no = %s", (new, old))
            if cur.rowcount:
                touched[t] = cur.rowcount
        except Exception as e:
            # Table maujood na ho (naya deployment) to chhod do — baaki chalta rahe.
            raise HTTPException(500, f"{t} me machine_no badalte waqt dikkat: {str(e)[:160]}")
    return touched


def _mno_usage(cur, mno: str) -> dict:
    """Ye machine_no kis-kis table me kitni baar aaya hai — rename se pehle
    user ko dikhane ke liye (taaki pata rahe kitni history saath chalegi)."""
    out = {}
    for t in _MNO_TABLES:
        cur.execute(f"SELECT COUNT(*) AS n FROM {t} WHERE machine_no = %s", (mno,))
        n = cur.fetchone()["n"]
        if n:
            out[t] = n
    return out


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




# ══════════════════════════════════════════════════════════════════════
#  MACHINE MASTER  (sidebar → Machine Master)
#  Padhna sabke liye, LIKHNA sirf admin.  Ye poore app ka master hai —
#  har dropdown, har filter, har report isi se chalti hai, isliye badalne
#  ka haq ek hi jagah rakha hai.
#  DELETE jaan-boojh kar nahi hai: machine ki history machine_no se judi
#  hoti hai, mita denge to wo sab anaath ho jayegi.  Uski jagah DISABLE
#  hai — machine har dropdown se hat jaati hai par record bana rehta hai.
# ══════════════════════════════════════════════════════════════════════
class MachineIn(BaseModel):
    zone_name:    Optional[str] = None
    line_name:    Optional[str] = None
    machine_no:   Optional[str] = None
    machine_name: Optional[str] = None
    ip:           Optional[str] = None
    is_active:    Optional[bool] = None


def _clean(v):
    return (v or "").strip() or None


def _check_ip(ip):
    """Khali chalega; kuch likha hai to sahi IP hona chahiye.  Aadha-adhoora
    IP baad me ping/PLC page par chupchaap fail hota hai, isliye yahin rok."""
    if not ip:
        return None
    import ipaddress
    try:
        return str(ipaddress.ip_address(ip.strip()))
    except ValueError:
        raise HTTPException(400, f"'{ip}' sahi IP address nahi hai")


@router.get("/master")
def master_list(include_inactive: bool = Query(True), user=Depends(get_current_user)):
    """Poora Machine Master — by default DISABLED machines bhi, kyunki page
    par unhe wapas chalu karne ka option dena hai."""
    _ensure_master()
    where = "" if include_inactive else "WHERE is_active = TRUE"
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute(f"""
            SELECT id, serial_no, zone_name, line_name, machine_no, machine_name,
                   ip, is_active, created_at, updated_at
              FROM maintenance_machines {where}
             ORDER BY zone_name, line_name, machine_no
        """)
        return cur.fetchall()


@router.get("/master/{mid}/usage")
def master_usage(mid: int, user=Depends(get_current_user)):
    """Is machine ka machine_no kis-kis table me kitni baar aaya hai.
    Rename se PEHLE dikhaya jaata hai, taaki user ko pata ho ki kitni
    history saath badlegi (aur ye ki wo tootegi nahi)."""
    _ensure_master()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT machine_no FROM maintenance_machines WHERE id = %s", (mid,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Machine not found")
        usage = _mno_usage(cur, row["machine_no"])
    return {"machine_no": row["machine_no"], "total": sum(usage.values()), "tables": usage}


@router.post("/master", status_code=201)
def master_create(body: MachineIn, admin=Depends(require_admin)):
    """Nayi machine — maintenance_machines me hi jaati hai, isliye banate hi
    har dropdown/filter/report me apne aap aa jaati hai."""
    _ensure_master()
    zone, line = _clean(body.zone_name), _clean(body.line_name)
    mno, mname = _clean(body.machine_no), _clean(body.machine_name)
    if not (zone and line and mno and mname):
        raise HTTPException(400, "Zone, Line, Machine No aur Machine Name — chaaron zaroori hain")
    ip = _check_ip(body.ip)
    with get_conn() as conn:
        cur = dict_cursor(conn)
        # Duplicate machine_no par DB me koi rok nahi hai, isliye yahan rokte
        # hain — do machine ek hi number par hon to unki history aapas me mil
        # jaati aur kisi ko pata bhi nahi chalta.  Case/space se farak nahi.
        cur.execute("""SELECT id FROM maintenance_machines
                        WHERE LOWER(TRIM(machine_no)) = LOWER(TRIM(%s))""", (mno,))
        if cur.fetchone():
            raise HTTPException(409, f"Machine No '{mno}' pehle se maujood hai")
        cur.execute("SELECT COALESCE(MAX(serial_no), 0) + 1 AS nxt FROM maintenance_machines")
        nxt = cur.fetchone()["nxt"]
        cur.execute("""
            INSERT INTO maintenance_machines
                (serial_no, zone_name, line_name, machine_no, machine_name, ip,
                 is_active, created_at, updated_at)
            VALUES (%s,%s,%s,%s,%s,%s, TRUE, NOW(), NOW())
            RETURNING id, serial_no
        """, (nxt, zone, line, mno, mname, ip))
        out = dict(cur.fetchone())
        conn.commit()
    return {"ok": True, **out}


@router.put("/master/{mid}")
def master_update(mid: int, body: MachineIn, admin=Depends(require_admin)):
    """Machine badlo.  Sirf wahi khaane chhoote hain jo bheje gaye.

    machine_no badla to us machine ki poori history bhi SAATH badalti hai
    (`_cascade_machine_no`) — usi transaction me.  Bina iske purane records
    purane number par reh jaate aur machine ke saath dikhna band ho jaate.
    """
    _ensure_master()
    sent = body.model_dump(exclude_unset=True)
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT * FROM maintenance_machines WHERE id = %s", (mid,))
        old = cur.fetchone()
        if not old:
            raise HTTPException(404, "Machine not found")

        sets, vals, cascaded = [], [], {}

        if "machine_no" in sent:
            mno = _clean(sent["machine_no"])
            if not mno:
                raise HTTPException(400, "Machine No khali nahi ho sakta")
            if mno.lower() != (old["machine_no"] or "").lower():
                cur.execute("""SELECT id FROM maintenance_machines
                                WHERE LOWER(TRIM(machine_no)) = LOWER(TRIM(%s)) AND id <> %s""",
                            (mno, mid))
                if cur.fetchone():
                    raise HTTPException(409, f"Machine No '{mno}' pehle se maujood hai")
                cascaded = _cascade_machine_no(cur, old["machine_no"], mno)
            sets.append("machine_no = %s"); vals.append(mno)

        for col in ("zone_name", "line_name", "machine_name"):
            if col in sent:
                v = _clean(sent[col])
                if not v:
                    raise HTTPException(400, f"{col} khali nahi ho sakta")
                sets.append(f"{col} = %s"); vals.append(v)

        if "ip" in sent:
            sets.append("ip = %s"); vals.append(_check_ip(sent["ip"]))
        if "is_active" in sent:
            sets.append("is_active = %s"); vals.append(bool(sent["is_active"]))

        if sets:
            sets.append("updated_at = NOW()")
            cur.execute(f"UPDATE maintenance_machines SET {', '.join(sets)} WHERE id = %s",
                        vals + [mid])
        cur.execute("SELECT * FROM maintenance_machines WHERE id = %s", (mid,))
        row = dict(cur.fetchone())
        conn.commit()
    return {"ok": True, "machine": row,
            "cascaded": cascaded, "cascaded_total": sum(cascaded.values())}
