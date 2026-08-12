"""
routers/plc.py
==============
PLC Integration — Mitsubishi PLC (Q series / FX5U CPU) se connect karke
device (D / M / L / X / Y …) padhna-likhna.  MC Protocol (SLMP, 3E frame)
over TCP — `pymcprotocol` library se.

Sidebar → PLC Integration.  Routing: /maintenance-plc.

Tables
------
maintenance_plc          — ek PLC connection (zone/line/machine + ip/port + series)
maintenance_plc_device   — us PLC ke "models"/devices (D-bit/M-bit/L-bit …)

Endpoints (prefix /api/plc)
---------------------------
GET    /                 saare PLC connections
POST   /                 naya PLC connection add
DELETE /{pid}            PLC hatao
POST   /{pid}/test       connection test (CPU type padho)
GET    /{pid}/devices    us PLC ke devices + abhi ki live value
POST   /{pid}/devices    device add (type + address + label)
DELETE /devices/{did}    device hatao
POST   /{pid}/read       saare devices ki live value ek saath padho
POST   /devices/{did}/write   ek device par value likho (word) / ON-OFF (bit)
"""
import socket
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from database import get_conn, dict_cursor
from auth import get_current_user

router = APIRouter(prefix="/api/plc", tags=["plc"])

# ── device classification (bit vs word) — value input ya ON/OFF decide karta hai ──
BIT_DEVICES  = {"X", "Y", "M", "L", "F", "V", "B", "S", "SB", "TS", "CS", "SS"}
WORD_DEVICES = {"D", "W", "R", "ZR", "SD", "SW", "Z", "TN", "CN"}
ALL_DEVICES  = sorted(BIT_DEVICES | WORD_DEVICES)

# series → pymcprotocol plctype.  FX5U (iQ-F) MC-protocol 3E me Q-compatible hai.
_PLCTYPE = {"Q": "Q", "FX5U": "Q", "iQ-R": "iQ-R", "L": "L", "QnA": "QnA"}


def _is_bit(dtype: str) -> bool:
    return (dtype or "").upper() in BIT_DEVICES


def _ensure_tables() -> None:
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS maintenance_plc (
                id           SERIAL PRIMARY KEY,
                zone_name    TEXT,
                line_name    TEXT,
                machine_no   TEXT,
                machine_name TEXT,
                plc_ip       TEXT NOT NULL,
                plc_port     INTEGER NOT NULL DEFAULT 5007,
                series       TEXT NOT NULL DEFAULT 'Q',
                enabled      BOOLEAN NOT NULL DEFAULT TRUE,
                created_by   TEXT,
                created_at   TIMESTAMP DEFAULT NOW()
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS maintenance_plc_device (
                id           SERIAL PRIMARY KEY,
                plc_id       INTEGER NOT NULL REFERENCES maintenance_plc(id) ON DELETE CASCADE,
                label        TEXT,
                device_type  TEXT NOT NULL,          -- D / M / L / X / Y …
                device_no    TEXT NOT NULL,          -- address (e.g. 100)
                created_at   TIMESTAMP DEFAULT NOW()
            )
        """)
        # value → model-name mapping.  D1016 me PLC ki value X aaye to model = <name>.
        cur.execute("""
            CREATE TABLE IF NOT EXISTS maintenance_plc_model (
                id          SERIAL PRIMARY KEY,
                device_id   INTEGER NOT NULL REFERENCES maintenance_plc_device(id) ON DELETE CASCADE,
                plc_value   INTEGER NOT NULL,
                model_name  TEXT NOT NULL,
                created_at  TIMESTAMP DEFAULT NOW()
            )
        """)
        conn.commit()


def _author(user) -> str:
    if isinstance(user, dict):
        return user.get("username") or "user"
    return getattr(user, "username", None) or "user"


def _ser(r: dict) -> dict:
    r = dict(r)
    for k in ("created_at",):
        if r.get(k):
            r[k] = r[k].isoformat()
    return r


# ── PLC se connect (best-effort — real PLC network par hona chahiye) ──
def _open(plc: dict):
    """pymcprotocol se connect.  Fail ho to saaf message ke saath 400."""
    try:
        import pymcprotocol
    except Exception:
        raise HTTPException(500, "pymcprotocol library install nahi hai (pip install pymcprotocol)")
    plctype = _PLCTYPE.get((plc.get("series") or "Q"), "Q")
    mc = pymcprotocol.Type3E(plctype=plctype)
    mc.timer = 4   # ~1s units → ~4s timeout
    try:
        mc.connect(plc["plc_ip"], int(plc["plc_port"]))
    except Exception as e:
        raise HTTPException(400, f"PLC connect fail ({plc['plc_ip']}:{plc['plc_port']}): {e}")
    return mc


def _read_one(mc, dtype: str, dno: str):
    head = f"{dtype.upper()}{dno}"
    if _is_bit(dtype):
        return int(mc.batchread_bitunits(headdevice=head, readsize=1)[0])
    return int(mc.batchread_wordunits(headdevice=head, readsize=1)[0])


# ── models ──
class PlcCreate(BaseModel):
    zone_name:    Optional[str] = ""
    line_name:    Optional[str] = ""
    machine_no:   Optional[str] = ""
    machine_name: Optional[str] = ""
    plc_ip:       str
    plc_port:     int = 5007
    series:       str = "Q"


class DeviceCreate(BaseModel):
    label:       Optional[str] = ""
    device_type: str
    device_no:   str


class WriteValue(BaseModel):
    value: int          # word → number; bit → 0 / 1 (OFF / ON)


class ModelMap(BaseModel):
    plc_value:  int     # PLC me ye value aaye…
    model_name: str     # …to model = ye naam


# ── PLC connections ──
@router.get("/")
def list_plcs(user=Depends(get_current_user)):
    _ensure_tables()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT * FROM maintenance_plc ORDER BY id DESC")
        return {"rows": [_ser(r) for r in cur.fetchall()], "device_types": ALL_DEVICES,
                "bit_devices": sorted(BIT_DEVICES)}


@router.post("/", status_code=201)
def create_plc(body: PlcCreate, user=Depends(get_current_user)):
    _ensure_tables()
    if not (body.plc_ip or "").strip():
        raise HTTPException(400, "PLC IP required")
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("""INSERT INTO maintenance_plc
                       (zone_name, line_name, machine_no, machine_name,
                        plc_ip, plc_port, series, created_by)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
                    (body.zone_name, body.line_name, body.machine_no, body.machine_name,
                     body.plc_ip.strip(), int(body.plc_port), (body.series or "Q"), _author(user)))
        pid = cur.fetchone()[0]
        conn.commit()
    return {"id": pid}


@router.delete("/{pid}")
def delete_plc(pid: int, user=Depends(get_current_user)):
    _ensure_tables()
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM maintenance_plc WHERE id=%s", (pid,))
        if cur.rowcount == 0:
            raise HTTPException(404, "PLC not found")
        conn.commit()
    return {"ok": True}


def _get_plc(pid: int) -> dict:
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT * FROM maintenance_plc WHERE id=%s", (pid,))
        r = cur.fetchone()
    if not r:
        raise HTTPException(404, "PLC not found")
    return dict(r)


def _reachable(ip: str, port, timeout: float = 1.5) -> bool:
    """Fast TCP probe — PLC ka port pahunch me hai ya nahi (connected indicator)."""
    try:
        s = socket.create_connection((ip, int(port)), timeout=timeout)
        s.close()
        return True
    except Exception:
        return False


@router.get("/status")
def plc_status(user=Depends(get_current_user)):
    """Har PLC ka live connected/offline (quick TCP probe)."""
    _ensure_tables()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT id, plc_ip, plc_port FROM maintenance_plc")
        plcs = [dict(r) for r in cur.fetchall()]
    return {str(p["id"]): _reachable(p["plc_ip"], p["plc_port"]) for p in plcs}


@router.post("/{pid}/test")
def test_plc(pid: int, user=Depends(get_current_user)):
    _ensure_tables()
    plc = _get_plc(pid)
    mc = _open(plc)
    try:
        cpu = mc.read_cputype()
    except Exception as e:
        raise HTTPException(400, f"Connected par CPU read fail: {e}")
    finally:
        try: mc.close()
        except Exception: pass
    return {"ok": True, "connected": True, "cpu": cpu}


# ── devices ──
@router.get("/{pid}/devices")
def list_devices(pid: int, user=Depends(get_current_user)):
    _ensure_tables()
    _get_plc(pid)
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT * FROM maintenance_plc_device WHERE plc_id=%s ORDER BY id", (pid,))
        rows = [_ser(r) for r in cur.fetchall()]
        cur.execute("""SELECT m.id, m.device_id, m.plc_value, m.model_name
                         FROM maintenance_plc_model m JOIN maintenance_plc_device d ON d.id=m.device_id
                        WHERE d.plc_id=%s ORDER BY m.plc_value""", (pid,))
        mods = cur.fetchall()
    by_dev = {}
    for m in mods:
        by_dev.setdefault(m["device_id"], []).append({"id": m["id"], "plc_value": m["plc_value"], "model_name": m["model_name"]})
    for r in rows:
        r["is_bit"] = _is_bit(r["device_type"])
        r["models"] = by_dev.get(r["id"], [])
    return rows


@router.post("/devices/{did}/models", status_code=201)
def add_model(did: int, body: ModelMap, user=Depends(get_current_user)):
    _ensure_tables()
    if not (body.model_name or "").strip():
        raise HTTPException(400, "model name required")
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("""INSERT INTO maintenance_plc_model (device_id, plc_value, model_name)
                       VALUES (%s,%s,%s) RETURNING id""",
                    (did, int(body.plc_value), body.model_name.strip()))
        mid = cur.fetchone()[0]
        conn.commit()
    return {"id": mid}


@router.delete("/models/{mid}")
def delete_model(mid: int, user=Depends(get_current_user)):
    _ensure_tables()
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM maintenance_plc_model WHERE id=%s", (mid,))
        if cur.rowcount == 0:
            raise HTTPException(404, "mapping not found")
        conn.commit()
    return {"ok": True}


@router.post("/{pid}/devices", status_code=201)
def add_device(pid: int, body: DeviceCreate, user=Depends(get_current_user)):
    _ensure_tables()
    _get_plc(pid)
    # Abhi sirf DEFINE kar rahe (PLC se match baad me) — isliye koi bhi device
    # type chalega (D / M / L / X / Y / kuch bhi), fixed list par restrict nahi.
    dt = (body.device_type or "").upper().strip()
    if not dt:
        raise HTTPException(400, "device type required")
    if not (body.device_no or "").strip():
        raise HTTPException(400, "device address required")
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("""INSERT INTO maintenance_plc_device (plc_id, label, device_type, device_no)
                       VALUES (%s,%s,%s,%s) RETURNING id""",
                    (pid, (body.label or "").strip(), dt, str(body.device_no).strip()))
        did = cur.fetchone()[0]
        conn.commit()
    return {"id": did}


@router.delete("/devices/{did}")
def delete_device(did: int, user=Depends(get_current_user)):
    _ensure_tables()
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM maintenance_plc_device WHERE id=%s", (did,))
        if cur.rowcount == 0:
            raise HTTPException(404, "device not found")
        conn.commit()
    return {"ok": True}


# ── read all device values (ek connection me) ──
@router.post("/{pid}/read")
def read_values(pid: int, user=Depends(get_current_user)):
    _ensure_tables()
    plc = _get_plc(pid)
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT * FROM maintenance_plc_device WHERE plc_id=%s ORDER BY id", (pid,))
        devs = [dict(r) for r in cur.fetchall()]
        cur.execute("""SELECT m.device_id, m.plc_value, m.model_name
                         FROM maintenance_plc_model m JOIN maintenance_plc_device d ON d.id=m.device_id
                        WHERE d.plc_id=%s""", (pid,))
        modmap = {}                       # (device_id, plc_value) -> model_name
        for m in cur.fetchall():
            modmap[(m["device_id"], m["plc_value"])] = m["model_name"]
    mc = _open(plc)
    out = []
    try:
        for d in devs:
            item = {"id": d["id"], "device_type": d["device_type"], "device_no": d["device_no"],
                    "is_bit": _is_bit(d["device_type"]), "value": None, "model_name": None, "error": None}
            try:
                item["value"] = _read_one(mc, d["device_type"], d["device_no"])
                item["model_name"] = modmap.get((d["id"], item["value"]))   # value se model naam
            except Exception as e:
                item["error"] = str(e)[:80]
            out.append(item)
    finally:
        try: mc.close()
        except Exception: pass
    return {"values": out}


# ── ek device par likho (word value / bit ON-OFF) ──
@router.post("/devices/{did}/write")
def write_value(did: int, body: WriteValue, user=Depends(get_current_user)):
    _ensure_tables()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("""SELECT d.*, p.plc_ip, p.plc_port, p.series
                         FROM maintenance_plc_device d JOIN maintenance_plc p ON p.id=d.plc_id
                        WHERE d.id=%s""", (did,))
        d = cur.fetchone()
    if not d:
        raise HTTPException(404, "device not found")
    d = dict(d)
    head = f"{d['device_type'].upper()}{d['device_no']}"
    mc = _open(d)
    try:
        if _is_bit(d["device_type"]):
            mc.batchwrite_bitunits(headdevice=head, values=[1 if body.value else 0])
        else:
            mc.batchwrite_wordunits(headdevice=head, values=[int(body.value)])
    except Exception as e:
        raise HTTPException(400, f"Write fail ({head}): {e}")
    finally:
        try: mc.close()
        except Exception: pass
    return {"ok": True, "wrote": body.value, "device": head}
