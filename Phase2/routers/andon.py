"""
routers/andon.py
================
Standalone Industrial **ANDON Management** module — configured entirely from the
UI (no source changes to add a PLC or a department).

Design (per requirement):
  • Zone / Line are NOT stored here — they come from the machine master
    (`maintenance_machines`), exactly like every other picker in the app.  A device
    just records the zone + line NAME it sits on.
  • Departments are a small editable list (Maintenance / Quality / Production /
    Store …) used by the output mapping; all time calculations are per-department.
  • Each device has 8 outputs (DO1–DO8); each output maps to ONE department (plus a
    display name / priority / enable).  A shared default template applies to every
    device, and any device can override its own outputs.

Tables (prefixed `andon_`):
  andon_departments         id · name · color
  andon_plc_devices         id · name · ip · port · zone · line · enabled · poll_path
  andon_plc_output_mapping  plc_id (NULL = default) · do_index · display_name ·
                            department_id · priority · enabled
  andon_system              live OPEN calls (running timer)
  andon_history             closed calls (duration / response time)

Signal model — the server POLLS the PLC (outbound):
  • ANDON reads a Mitsubishi PLC over MC-protocol.  A background poller connects
    OUT to each enabled PLC and reads every mapped bit (~100 ms): 1 → open a call
    on that output (timer starts), 0 → close it (→ history, with duration).
    Nothing is pushed to the server, so no inbound port is needed.  (The legacy
    ESP raw-TCP push ingest has been retired.)

Endpoints (prefix /api/andon)
-----------------------------
GET             /masters                    distinct zone → lines from maintenance_machines
GET/POST/PUT/DELETE  /departments · /plc-devices
GET/PUT         /outputs/default            shared DO1–DO8 template
GET/PUT         /plc-devices/{id}/outputs   this device's DO1–DO8 (default-filled)
GET             /events                     live OPEN calls (running timer)
GET             /history                    closed calls (duration / response)
"""
import os
import re
import socket
import threading
import time as _time
from datetime import datetime, timedelta
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from database import get_conn, dict_cursor
from auth import get_current_user, require_admin

router = APIRouter(prefix="/api/andon", tags=["andon"])

_ensured = False

_DEFAULT_DEPTS = ["Maintenance", "Toolroom", "Quality", "Material", "Other Loss", "Model Setup"]
_DEFAULT_OUTPUTS = [
    (1, "Maintenance",     "Maintenance", "Critical"),
    (2, "Maintenance ACC", None,          "Critical"),
    (3, "Toolroom",        "Toolroom",    "High"),
    (4, "Tool ACC",        None,          "High"),
    (5, "Quality",         "Quality",     "Normal"),
    (6, "Material",        "Material",    "Normal"),
    (7, "Model Setup",     "Model Setup", "Normal"),
    (8, "Other Loss",      "Other Loss",  "Normal"),
]

_ACK_OF = {2: 1, 4: 3}


def _ack_map(cur, plc_id):
    eff = {}
    try:
        cur.execute("""SELECT do_index, department_id, display_name
                         FROM andon_plc_output_mapping WHERE plc_id IS NULL""")
        for r in cur.fetchall():
            eff[r["do_index"]] = {"dept": r["department_id"], "name": r["display_name"]}
        cur.execute("""SELECT do_index, department_id, display_name
                         FROM andon_plc_output_mapping WHERE plc_id = %s""", (plc_id,))
        for r in cur.fetchall():
            base = eff.get(r["do_index"], {})
            eff[r["do_index"]] = {
                "dept": r["department_id"] if r["department_id"] is not None else base.get("dept"),
                "name": r["display_name"] or base.get("name"),
            }
    except Exception as e:
        print(f"[ANDON] ack-map padhne me dikkat (fallback use kar rahe): {e}")
        return dict(_ACK_OF)

    if not eff:
        return dict(_ACK_OF)

    out, last_call = {}, None
    for do in sorted(eff):
        if eff[do].get("dept") is not None:
            last_call = do
        elif last_call is not None:
            out[do] = last_call
    return out


_PLC_STATUS = {}


def _shift_for_time(dt):
    if dt is None:
        return None
    return "A" if 7 <= dt.hour < 18 else "B"


def _hhmm(dt):
    return dt.strftime("%H:%M") if dt else None


def _mins_between(a, b):
    if not a or not b:
        return None
    d = int((b.replace(second=0, microsecond=0)
             - a.replace(second=0, microsecond=0)).total_seconds() // 60)
    return max(d, 0)


def _related_to_for(tbl):
    from routers.breakdown_slips import TOOLROOM_SLIP_TABLE
    return "tool_room" if tbl == TOOLROOM_SLIP_TABLE else "maintenance"


def _slip_table_for(dept):
    d = str(dept or "").strip().lower()
    if d == "maintenance":
        from routers.breakdown_slips import AUTO_SLIP_TABLE
        return AUTO_SLIP_TABLE
    if d in ("toolroom", "tool room", "tool_room"):
        from routers.breakdown_slips import TOOLROOM_SLIP_TABLE
        return TOOLROOM_SLIP_TABLE
    return None


_THRESH_CACHE = {"min": None, "at": 0.0}


def _slip_threshold_min():
    now = _time.time()
    if _THRESH_CACHE["min"] is not None and (now - _THRESH_CACHE["at"]) < 10:
        return _THRESH_CACHE["min"]
    val = 2
    try:
        with get_conn() as conn:
            cur = conn.cursor()
            cur.execute("SELECT slip_threshold_min FROM maintenance_slip_config WHERE scope='GLOBAL'")
            r = cur.fetchone()
            if r and r[0] is not None:
                val = int(r[0])
    except Exception:
        pass
    _THRESH_CACHE["min"] = val
    _THRESH_CACHE["at"]  = now
    return val


def _open_long_enough(started, upto):
    if not started or not upto:
        return False
    return (upto - started).total_seconds() >= _slip_threshold_min() * 60


def _slip_fields(zone, line, started, received, ended, dur_seconds=None, model=None,
                 related_to="maintenance"):
    resp_min = _mins_between(started, received)
    down_min = _mins_between(started, ended)
    if down_min is None and dur_seconds is not None:
        down_min = int(round(dur_seconds / 60.0))
    return {
        "zone": zone, "line": line,
        "machine_no": None, "machine_name": None,
        "slip_date": started.date() if started else None,
        "shift": _shift_for_time(started),
        "bd_start_time":    _hhmm(started),
        "bd_received_time": _hhmm(received),
        "bd_ok_time":       _hhmm(ended),
        "bd_start_date": started.date() if started else None,
        "bd_end_date":   ended.date() if ended else None,
        "mc_down_time_minutes":  down_min,
        "response_time_minutes": resp_min,
        "frequency": 1,
        "model_no": model or None,
        "problem_related_to": related_to,
    }


def _slip_insert(conn, event_id, flat, power_cut=False, table=None):
    from routers.breakdown_slips import _COLS, _blank_to_none
    if not table:
        raise ValueError("_slip_insert: `table` zaroori hai (maintenance ya toolroom)")
    tbl = table
    cols = list(_COLS) + ["andon_event_id", "power_cut"]
    vals = [_blank_to_none(flat.get(c)) for c in _COLS] + [event_id, bool(power_cut)]
    ph = ", ".join(["%s"] * len(cols))
    cur = conn.cursor()
    cur.execute(
        f"INSERT INTO {tbl} ({', '.join(cols)}) VALUES ({ph}) "
        f"ON CONFLICT (andon_event_id) WHERE andon_event_id IS NOT NULL "
        f"DO NOTHING RETURNING id", vals)
    row = cur.fetchone()
    if row:
        from routers.breakdown_slips import sync_status
        sync_status(cur, tbl, row[0])
    return row[0] if row else None


def auto_slip_on_ack(event_id):
    try:
        from routers.breakdown_slips import _ensure_table
        _ensure_table()
        with get_conn() as conn:
            cur = dict_cursor(conn)
            cur.execute("""
                SELECT e.id, e.zone, e.line, e.started_at, e.acknowledged_at,
                       COALESCE(dep.name, e.display_name) AS dept,
                       (e.started_at <= NOW() - (%s * INTERVAL '1 minute')) AS long_enough
                  FROM andon_system e
                  LEFT JOIN andon_departments dep ON dep.id = e.department_id
                 WHERE e.id = %s""", (_slip_threshold_min(), event_id))
            e = cur.fetchone()
            _tbl = _slip_table_for(e["dept"]) if e else None
            if not _tbl:
                return
            if not e["long_enough"]:
                return
            flat = _slip_fields(e["zone"], e["line"],
                                e["started_at"], e["acknowledged_at"], None,
                                related_to=_related_to_for(_tbl))
            new_id = _slip_insert(conn, event_id, flat, table=_tbl)
            if not new_id:
                cur2 = conn.cursor()
                cur2.execute(f"""
                    UPDATE {_tbl}
                       SET bd_received_time      = %s,
                           response_time_minutes = %s
                     WHERE andon_event_id = %s
                       AND bd_received_time IS NULL""",
                    (flat["bd_received_time"], flat["response_time_minutes"], event_id))
                if cur2.rowcount:
                    print(f"[ANDON-SLIP] call {event_id} ki slip me response bhara "
                          f"(recv {flat['bd_received_time']}, resp {flat['response_time_minutes']} min)")
        if new_id:
            print(f"[ANDON-SLIP] call {event_id} acknowledge hua -> slip #{new_id} "
                  f"({flat['zone']}/{flat['line']} {flat['bd_start_time']}"
                  f"→recv {flat['bd_received_time']}, resp {flat['response_time_minutes']} min)")
    except Exception as ex:
        print(f"[ANDON-SLIP] ack par slip banane me dikkat (call {event_id}): {ex}")


def auto_slip_on_close(event_id, history_id, power_cut=False):
    try:
        from routers.breakdown_slips import _ensure_table
        _ensure_table()
        with get_conn() as conn:
            cur = dict_cursor(conn)
            cur.execute("""
                SELECT h.zone, h.line, h.started_at, h.ended_at,
                       h.duration_seconds, h.response_seconds,
                       COALESCE(dep.name, h.display_name) AS dept
                  FROM andon_history h
                  LEFT JOIN andon_departments dep ON dep.id = h.department_id
                 WHERE h.id = %s""", (history_id,))
            h = cur.fetchone()
            _tbl = _slip_table_for(h["dept"]) if h else None
            if not _tbl:
                return
            started, ended = h["started_at"], h["ended_at"]
            received = (started + timedelta(seconds=int(h["response_seconds"]))
                        if h["response_seconds"] is not None and started else None)
            flat = _slip_fields(h["zone"], h["line"], started, received, ended,
                                h["duration_seconds"],
                                related_to=_related_to_for(_tbl))

            cur2 = conn.cursor()
            cur2.execute(f"""
                UPDATE {_tbl}
                   SET bd_ok_time            = %s,
                       bd_end_date           = %s,
                       mc_down_time_minutes  = %s,
                       power_cut             = %s,
                       bd_received_time      = COALESCE(bd_received_time, %s),
                       response_time_minutes = COALESCE(response_time_minutes, %s)
                 WHERE andon_event_id = %s""",
                (flat["bd_ok_time"], flat["bd_end_date"],
                 flat["mc_down_time_minutes"], bool(power_cut),
                 flat["bd_received_time"], flat["response_time_minutes"], event_id))
            if cur2.rowcount:
                from routers.breakdown_slips import sync_status
                cur.execute(f"SELECT id FROM {_tbl} WHERE andon_event_id = %s", (event_id,))
                _r = cur.fetchone()
                if _r:
                    sync_status(cur2, _tbl, _r["id"])
                print(f"[ANDON-SLIP] call {event_id} band -> slip poori hui "
                      f"(ok {flat['bd_ok_time']}, down {flat['mc_down_time_minutes']} min"
                      f"{', POWER CUT' if power_cut else ''})")
                return
            if not _open_long_enough(started, ended):
                return
            new_id = _slip_insert(conn, event_id, flat, power_cut=power_cut, table=_tbl)
        if new_id:
            print(f"[ANDON-SLIP] call {event_id} bina acknowledge band hua -> slip #{new_id}"
                  f"{' (POWER CUT)' if power_cut else ''}")
    except Exception as ex:
        print(f"[ANDON-SLIP] close par slip update me dikkat (call {event_id}): {ex}")


def _slip_threshold_sweep():
    try:
        thr = _slip_threshold_min()
        from routers.breakdown_slips import _ensure_table, AUTO_SLIP_TABLE, TOOLROOM_SLIP_TABLE
        _ensure_table()
        made, heal = 0, []
        with get_conn() as conn:
            cur = dict_cursor(conn)
            for _dept, _tbl in (("maintenance", AUTO_SLIP_TABLE),
                                ("toolroom",    TOOLROOM_SLIP_TABLE)):
                cur.execute(f"""
                    SELECT e.id, e.zone, e.line, e.started_at, e.acknowledged_at, e.model
                      FROM andon_system e
                      LEFT JOIN andon_departments dep ON dep.id = e.department_id
                     WHERE e.state = 'OPEN'
                       AND REPLACE(REPLACE(LOWER(TRIM(COALESCE(dep.name, e.display_name))), ' ', ''), '_', '') = %s
                       AND e.started_at IS NOT NULL
                       AND e.started_at <= NOW() - (%s * INTERVAL '1 minute')
                       AND NOT EXISTS (
                            SELECT 1 FROM {_tbl} s
                             WHERE s.andon_event_id = e.id)
                """, (_dept, thr))
                for e in cur.fetchall():
                    flat = _slip_fields(e["zone"], e["line"],
                                        e["started_at"], e["acknowledged_at"], None,
                                        model=e.get("model"),
                                        related_to=_related_to_for(_tbl))
                    if _slip_insert(conn, e["id"], flat, table=_tbl):
                        made += 1
                cur.execute(f"""
                    SELECT e.id FROM andon_system e
                      JOIN {_tbl} s ON s.andon_event_id = e.id
                     WHERE e.state = 'OPEN' AND e.acknowledged_at IS NOT NULL
                       AND s.bd_received_time IS NULL""")
                heal += [r["id"] for r in cur.fetchall()]
        for _eid in heal:
            try: auto_slip_on_ack(_eid)
            except Exception as _e: print(f"[ANDON-SLIP] self-heal dikkat (call {_eid}): {_e}")
        if made:
            print(f"[ANDON-SLIP] threshold sweep -> {made} slip bani "
                  f"(call {thr} min se zyada khuli rahi)")
    except Exception as ex:
        print(f"[ANDON-SLIP] threshold sweep me dikkat: {ex}")


# ═══════════════════════════════════════════════════════════════════════
# PLC PROTOCOL DRIVER & ALLOCATION ENGINE
# ═══════════════════════════════════════════════════════════════════════
_PLC_POLL_INTERVAL = 0.1
_OUT_WAKE = threading.Event()

_PLC_RETRY_SECS    = 5
_plc_poller_started = False
_PLC_CONN  = {}
_PLC_RETRY = {}
_SUB_CONN  = {}
_SUB_RETRY = {}

# Har PLC ka apna taala.
#
# ⚠ KYUN ZAROORI HAI: FX5U ek waqt me SIRF EK Modbus client jhelti hai, aur
# ek hi client ke do read aapas me gutth jaayein to jawab mila-jula aata hai.
# Poller apne thread me chalta hai; "Read now" wala diagnostic request ke
# thread me.  Dono ek hi connection istemal karte hain (naya kholna PLC ki
# ek-client wali hadd todta), isliye beech me taala lazmi hai.
_PLC_LOCKS = {}
_PLC_LOCKS_GUARD = threading.Lock()


def _plc_lock(dev_id):
    with _PLC_LOCKS_GUARD:
        lk = _PLC_LOCKS.get(dev_id)
        if lk is None:
            lk = _PLC_LOCKS[dev_id] = threading.Lock()
        return lk


# Jis PLC par ek bhi bit-address bhara hi nahi hai.  Aisi PLC ka poll SAFAL
# hota hai (ek dummy read chalti hai) -- yaani wo "online" dikhti hai -- par
# alarm kabhi ban hi nahi sakta.  Pehle ye baat kahin dikhti hi nahi thi.
_POLL_NOBITS = {}

BIT_DEVICES = {"X", "Y", "M", "L", "F", "V", "B", "S", "SB", "TS", "CS", "SS"}
_PLCTYPE    = {"Q": "Q", "FX5U": "Q", "iQ-R": "iQ-R", "L": "L", "QnA": "QnA"}

MODBUS_SPACES = {
    "COIL": ("bits",      "read_coils"),
    "DI":   ("bits",      "read_discrete_inputs"),
    "HR":   ("registers", "read_holding_registers"),
    "IR":   ("registers", "read_input_registers"),
}
MODBUS_DEFAULT_PORT = 502
MC_DEFAULT_PORT     = 5007

MODBUS_TIMEOUT       = 1.5
MODBUS_POLL_INTERVAL = 0.4

_MB_BUSY_HINT = ("PLC accepted the connection but did not answer. This FX5U "
                 "serves only ONE Modbus client at a time — close any other "
                 "Modbus tool or monitor connected to this PLC")

MODBUS_ALLOC = {
    "X":  ("DI",   0,     1024, 8),
    "Y":  ("COIL", 0,     1024, 8),
    "M":  ("COIL", 8192,  7680, 10),
    "SM": ("COIL", 20480, 2048, 10),
    "L":  ("COIL", 22528, 7680, 10),
    "B":  ("COIL", 30720, 256,  16),
    "F":  ("COIL", 38912, 128,  10),
    "D":  ("HR",   0,     None, 10),
}


def _modbus_addr(dtype, dno):
    t = (dtype or "").strip().upper()
    if t in MODBUS_SPACES:
        return t, int(str(dno).strip())
    
    # 1-to-1 exact mapping
    if t == "D":
        return "HR", int(str(dno).strip())

    alloc = MODBUS_ALLOC.get(t)
    if alloc is None:
        raise ValueError(f"Modbus address type '{dtype}' invalid")
    space, start, points, base = alloc
    raw = str(dno).strip()
    try:
        n = int(raw, base)
    except ValueError:
        raise ValueError(f"{t}{raw} is not a valid {t} address (base {base})") from None
    # ⚠ HADD KI JAANCH -- 2026-09-12 me jodi.
    # Pehle `points` likha to tha par kabhi PADHA hi nahi jaata tha.  Natija:
    # `M99999` chup-chaap coil 108191 ban jaata tha -- ek aisa pata jo FX5U ki
    # device-allocation me hai hi nahi.  PLC us par ya to mana karti ya 0
    # lauta deti, aur user ko lagta "address to bhar diya hai, alarm kyun
    # nahi aata".  Ab shuru me hi saaf mana kar dete hain.
    if points is not None and not (0 <= n < points):
        top = format(points - 1, "o" if base == 8 else "X" if base == 16 else "d")
        raise ValueError(f"{t}{raw} is out of range — this PLC maps {t}0 to {t}{top} only")
    return space, start + n


class PlcProtocolError(Exception):
    pass


def _is_modbus(protocol):
    return str(protocol or "MC").strip().upper() == "MODBUS"


def _norm_proto(p):
    return "MODBUS" if _is_modbus(p) else "MC"


MODBUS_SERIES = {"FX5U"}


def _series_supports_modbus(series):
    return str(series or "Q").strip() in MODBUS_SERIES


def _proto_for(series, protocol):
    return "MODBUS" if (_is_modbus(protocol) and _series_supports_modbus(series)) else "MC"


def _default_port(protocol):
    return MODBUS_DEFAULT_PORT if _is_modbus(protocol) else MC_DEFAULT_PORT


def _is_bit(dtype):
    return (dtype or "").upper() in BIT_DEVICES


class _McDriver:
    def __init__(self, ip, port, series, timer=4):
        import pymcprotocol
        plctype = _PLCTYPE.get((series or "Q"), "Q")
        self.mc = pymcprotocol.Type3E(plctype=plctype)
        self.mc.timer = timer
        self.mc.connect(ip, int(port))

    def read_one(self, dtype, dno):
        head = f"{dtype.upper()}{dno}"
        if _is_bit(dtype):
            return int(self.mc.batchread_bitunits(headdevice=head, readsize=1)[0])
        return int(self.mc.batchread_wordunits(headdevice=head, readsize=1)[0])

    def read_many(self, pairs):
        return [self.read_one(t, n) for t, n in pairs]

    def write_bit(self, dtype, dno, value):
        self.mc.batchwrite_bitunits(headdevice=f"{(dtype or '').upper()}{dno}",
                                    values=[1 if value else 0])

    def close(self):
        self.mc.close()


class _ModbusDriver:
    def __init__(self, ip, port, unit_id=1, timeout=MODBUS_TIMEOUT):
        from pymodbus.client import ModbusTcpClient
        self.cl = ModbusTcpClient(str(ip), port=int(port or MODBUS_DEFAULT_PORT),
                                  timeout=timeout)
        if not self.cl.connect():
            raise ConnectionError(f"Modbus TCP connect failed {ip}:{port}")
        self.unit = 1 if unit_id is None else int(unit_id)

    def alive(self):
        try:    return bool(self.cl.connected)
        except Exception: return False

    def read_one(self, dtype, dno):
        space, addr = _modbus_addr(dtype, dno)
        return self._read_run(space, addr, 1, f"{dtype}{dno}")[0]

    _RUN_MAX = {"registers": 100, "bits": 500}
    _RUN_GAP = 8

    def _read_run(self, space, addr, count, tag):
        attr, fname = MODBUS_SPACES[space]
        func = getattr(self.cl, fname)
        try:
            # Pymodbus 3.8+ compatibility fix: address=addr, count=count
            try:
                rr = func(address=addr, count=count, slave=self.unit)
            except TypeError:
                try:
                    rr = func(address=addr, count=count)
                except TypeError:
                    rr = func(addr, count)
        except OSError as e:
            try: self.cl.close()
            except Exception: pass
            raise IOError(f"{_MB_BUSY_HINT} — Socket closed ({e}, {tag})") from None

        if rr is None:
            raise IOError(f"{_MB_BUSY_HINT} (no reply for {tag})")
        if rr.isError():
            if type(rr).__name__ == "ExceptionResponse":
                raise PlcProtocolError(f"PLC Refused: {rr}")
            raise IOError(f"{_MB_BUSY_HINT} (Unit {self.unit}, Tag {tag})")

        vals = getattr(rr, attr, None)
        if not vals or len(vals) < count:
            raise IOError(f"Modbus returned incomplete bytes for {tag}")
        return [int(v) for v in vals[:count]]

    def read_many(self, pairs):
        if not pairs:
            return []
        addrs = [_modbus_addr(t, n) for t, n in pairs]
        out = [None] * len(addrs)
        i = 0
        order = sorted(range(len(addrs)), key=lambda k: (addrs[k][0], addrs[k][1]))
        while i < len(order):
            k0 = order[i]
            space, start = addrs[k0]
            lim = self._RUN_MAX[MODBUS_SPACES[space][0]]
            run = [k0]
            j = i + 1
            while j < len(order):
                k = order[j]
                sp, ad = addrs[k]
                if sp != space or ad > addrs[run[-1]][1] + self._RUN_GAP or (ad - start + 1) > lim:
                    break
                run.append(k)
                j += 1
            count = addrs[run[-1]][1] - start + 1
            tag = f"{pairs[k0][0]}{pairs[k0][1]}+{len(run)}"
            try:
                vals = self._read_run(space, start, count, tag)
                for k in run:
                    out[k] = vals[addrs[k][1] - start]
            except PlcProtocolError:
                if len(run) == 1:
                    raise
                for k in run:
                    sp, ad = addrs[k]
                    out[k] = self._read_run(sp, ad, 1, f"{pairs[k][0]}{pairs[k][1]}")[0]
            i = j
        return out

    def write_bit(self, dtype, dno, value):
        raise NotImplementedError("Modbus is read-only in ANDON; outputs must use MC protocol")

    def close(self):
        self.cl.close()


def _connect(plc, timer=4):
    if _is_modbus(plc.get("protocol")):
        return _ModbusDriver(plc["plc_ip"], plc["plc_port"], plc.get("unit_id"))
    return _McDriver(plc["plc_ip"], plc["plc_port"], plc.get("series"), timer=timer)


def _read_one(mc, dtype, dno):
    return mc.read_one(dtype, dno)


def _probe(ip, port, timeout=1.5):
    try:
        s = socket.create_connection((ip, int(port)), timeout=timeout)
        s.close()
        return True, "ok"
    except socket.timeout:
        return False, "timeout"
    except ConnectionRefusedError:
        return False, "refused"
    except socket.gaierror:
        return False, "dns"
    except OSError as e:
        if getattr(e, "winerror", None) == 10061 or getattr(e, "errno", None) == 111:
            return False, "refused"
        if getattr(e, "winerror", None) == 10060 or getattr(e, "errno", None) == 110:
            return False, "timeout"
        return False, "error"
    except Exception:
        return False, "error"


_PROBE_CACHE = {}
_PROBE_TTL   = 60.0


def _probe_cached(ip, port, timeout=3.0, force=False):
    key = (str(ip), int(port))
    now = _time.time()
    if not force:
        hit = _PROBE_CACHE.get(key)
        if hit and (now - hit[0]) < _PROBE_TTL:
            return hit[1], hit[2]
    ok, why = _probe(ip, port, timeout=timeout)
    _PROBE_CACHE[key] = (now, ok, why)
    return ok, why


def _reachable(ip, port, timeout=1.5):
    return _probe(ip, port, timeout)[0]


def _plc_drop(dev_id):
    for _pool in (_PLC_CONN, _SUB_CONN):
        ent = _pool.pop(dev_id, None)
        if ent is not None:
            try: ent[0].close()
            except Exception: pass


def _ensure_conn(pool, retry, key, ip, port, series, protocol=None, unit_id=None):
    p   = int(port or _default_port(protocol))
    sig = (str(ip), p, _norm_proto(protocol), str(series or "Q"), int(unit_id or 1))
    ent = pool.get(key)
    if ent is not None:
        mc, old_sig = ent
        if old_sig == sig:
            if hasattr(mc, "alive") and not mc.alive():
                try: mc.close()
                except Exception: pass
                pool.pop(key, None)
                retry.pop(key, None)
            else:
                return mc
        try: mc.close()
        except Exception: pass
        pool.pop(key, None)
        retry.pop(key, None)
    if _time.monotonic() < retry.get(key, 0):
        return None

    if not _is_modbus(protocol) and not _reachable(ip, p, timeout=1.5):
        retry[key] = _time.monotonic() + _PLC_RETRY_SECS
        return None
    try:
        mc = _connect({"series": series or "Q", "plc_ip": ip, "plc_port": p,
                       "protocol": protocol, "unit_id": unit_id})
        pool[key] = (mc, sig)
        retry.pop(key, None)
        return mc
    except Exception:
        retry[key] = _time.monotonic() + _PLC_RETRY_SECS
        return None


def _read_map_name(mc, plc_id, cur, table, name_col):
    cur.execute(f"""SELECT device_type, device_no, value, {name_col} AS nm
                     FROM {table}
                    WHERE plc_id=%s AND COALESCE(device_type,'')<>''
                          AND COALESCE(device_no,'')<>'' AND value IS NOT NULL
                    ORDER BY id""", (plc_id,))
    rows = cur.fetchall()
    if not rows:
        return None
    live = {}
    for r in rows:
        key = (r["device_type"], r["device_no"])
        if key not in live:
            try: live[key] = _read_one(mc, r["device_type"], r["device_no"])
            except Exception: live[key] = None
        if live[key] is not None and int(live[key]) == int(r["value"]):
            return r["nm"]
    return None


_POLL_FAIL = {}
_POLL_LOG_EVERY = 30.0


def _poll_fail(dev_id, exc):
    why = f"{type(exc).__name__}: {exc}"[:200]
    now = _time.monotonic()
    prev = _POLL_FAIL.get(dev_id)
    if prev and prev["why"] == why:
        prev["count"] += 1
        if now - prev["logged"] < _POLL_LOG_EVERY:
            return
        prev["logged"] = now
        print(f"[ANDON-PLC-POLL] dev {dev_id}: {why}  ({prev['count']} baar)", flush=True)
    else:
        _POLL_FAIL[dev_id] = {"why": why, "count": 1, "logged": now}
        print(f"[ANDON-PLC-POLL] dev {dev_id}: {why}", flush=True)


def _poll_ok(dev_id):
    if _POLL_FAIL.pop(dev_id, None):
        print(f"[ANDON-PLC-POLL] dev {dev_id}: wapas theek", flush=True)


def _plc_poll_once(dev):
    """Taala lagao, phir asli poll.  Taale ki wajah `_plc_lock` par likhi hai."""
    with _plc_lock(dev["id"]):
        return _plc_poll_once_locked(dev)


def _plc_poll_once_locked(dev):
    did = dev["id"]
    has_sub = bool((dev.get("sub_ip") or "").strip())
    proto     = _proto_for(dev.get("series"),     dev.get("protocol"))
    sub_proto = _proto_for(dev.get("sub_series"), dev.get("sub_protocol"))
    mc = _ensure_conn(_PLC_CONN, _PLC_RETRY, did, dev["ip"],
                      dev.get("port") or _default_port(proto),
                      dev.get("series") or "Q", proto, dev.get("unit_id"))
    if mc is None:
        return False, (False if has_sub else None)

    sub_mc = _ensure_conn(_SUB_CONN, _SUB_RETRY, did, dev["sub_ip"],
                          dev.get("sub_port") or _default_port(sub_proto),
                          dev.get("sub_series") or "Q", sub_proto,
                          dev.get("sub_unit_id")) if has_sub else None
    read_mc = sub_mc if has_sub else mc
    try:
        closed = []
        acked  = []
        bit_changed = False
        with get_conn() as conn:
            cur = dict_cursor(conn)
            cur.execute("""SELECT do_index, bit_type, bit_no FROM andon_plc_output_mapping
                            WHERE plc_id=%s AND COALESCE(bit_type,'')<>'' AND COALESCE(bit_no,'')<>''
                            ORDER BY do_index""", (did,))
            _rows = cur.fetchall()

            # Ek bhi bit-address bhara hai ya nahi -- ye yaad rakhna zaroori
            # hai, warna aisi PLC "online" dikhti rehti hai aur koi nahi
            # samajh paata ki alarm kyun nahi aata.
            _POLL_NOBITS[did] = not _rows
            if not _rows:
                if _is_modbus(proto):
                    _ = mc.read_one("HR", 3001)
                else:
                    _ = mc.read_one("M", 0)
                bits = []
            else:
                bits = list(zip(_rows, mc.read_many([(b["bit_type"], b["bit_no"]) for b in _rows])))

            any_on = any(v != 0 for _, v in bits)
            model = fault = None
            if any_on and read_mc:
                try:
                    model = _read_map_name(read_mc, did, cur, "andon_model_map", "model_name")
                    fault = _read_map_name(read_mc, did, cur, "andon_fault_map", "fault_name")
                except Exception:
                    model = fault = None
            for b, val in bits:
                res = _apply_state(cur, dev, b["do_index"], val != 0, model=model, fault=fault)
                if res and res.get("action") == "closed":
                    closed.append((res.get("event_id"), res.get("history_id")))
                elif res and res.get("action") == "acknowledged":
                    acked.append(res.get("event_id"))
                if res and res.get("action") in ("opened", "acknowledged", "closed"):
                    bit_changed = True
            conn.commit()

        if bit_changed:
            _OUT_WAKE.set()

        for _eid, _hid in closed:
            if _eid and _hid:
                try: auto_slip_on_close(_eid, _hid)
                except Exception as _e: print(f"[ANDON-SLIP] close-fill dikkat (call {_eid}): {_e}")

        for _eid in acked:
            if _eid:
                try: auto_slip_on_ack(_eid)
                except Exception as _e: print(f"[ANDON-SLIP] ack-fill dikkat (call {_eid}): {_e}")
        _poll_ok(did)
        return True, (bool(sub_mc) if has_sub else None)
    except Exception as e:
        _poll_fail(did, e)
        if not isinstance(e, PlcProtocolError):
            _plc_drop(did)
            n = (_POLL_FAIL.get(did) or {}).get("count", 1)
            _PLC_RETRY[did] = _time.monotonic() + min(1 + (n // 10), _PLC_RETRY_SECS)
        return False, (False if has_sub else None)


def _stale_call_sweep():
    try:
        closed = []
        with get_conn() as conn:
            cur = dict_cursor(conn)
            cur.execute("SELECT id, enabled FROM andon_plc_devices")
            devrows = {r["id"]: r for r in cur.fetchall()}
            cur.execute("SELECT DISTINCT plc_id FROM andon_system WHERE state='OPEN'")
            open_pids = [r["plc_id"] for r in cur.fetchall()]
            for pid in open_pids:
                dv = devrows.get(pid)
                reason = None
                if dv is None:
                    reason = "PLC deleted"
                elif not dv.get("enabled"):
                    reason = "PLC disabled"
                if not reason:
                    continue
                cur.execute("SELECT do_index FROM andon_system WHERE plc_id=%s AND state='OPEN'", (pid,))
                for r in cur.fetchall():
                    res = _apply_state(cur, {"id": pid}, r["do_index"], False)
                    if res and res.get("action") == "closed":
                        closed.append((res.get("event_id"), res.get("history_id"), reason))
            conn.commit()
        if closed:
            _OUT_WAKE.set()
        for eid, hid, reason in closed:
            print(f"[ANDON] ghost call {eid} auto-closed ({reason}) -> timer band")
            if eid and hid:
                try: auto_slip_on_close(eid, hid)
                except Exception as e: print(f"[ANDON-SLIP] ghost close-fill (call {eid}): {e}")
    except Exception as e:
        print(f"[ANDON] stale-call sweep dikkat: {e}")


_MB_LAST = {}


def _plc_poll_loop():
    n = 0
    while True:
        try:
            _ensure_tables()
            with get_conn() as conn:
                cur = dict_cursor(conn)
                cur.execute("""SELECT id, zone, line, machine_no, machine_name,
                                      ip, port, series, protocol, unit_id,
                                      sub_ip, sub_port, sub_series, sub_protocol, sub_unit_id,
                                      enabled
                                 FROM andon_plc_devices""")
                devs = cur.fetchall()
            now = datetime.now().isoformat(timespec="seconds")
            ids = set()
            for dev in devs:
                ids.add(dev["id"])
                prev = _PLC_STATUS.get(dev["id"], {})

                if _is_modbus(dev.get("protocol")) and dev.get("enabled"):
                    _t = _time.monotonic()
                    if _t - _MB_LAST.get(dev["id"], 0.0) < MODBUS_POLL_INTERVAL:
                        continue
                    _MB_LAST[dev["id"]] = _t
                if not dev.get("enabled"):
                    _PLC_STATUS[dev["id"]] = {"online": None, "sub_online": None, "checked": now, "last_seen": prev.get("last_seen")}
                    _plc_drop(dev["id"])
                    continue
                ok, sub_ok = _plc_poll_once(dev)
                _st = {"online": ok, "sub_online": sub_ok, "checked": now,
                       "last_seen": now if ok else prev.get("last_seen")}

                if ok and _POLL_NOBITS.get(dev["id"]):
                    # PLC juda hua hai par usme ek bhi bit-address nahi --
                    # UI ise chetavni ke roop me dikhata hai.
                    _st["no_bits"] = True
                _f = _POLL_FAIL.get(dev["id"])
                if not ok and _f:
                    _st["poll_error"] = _f["why"]
                    _st["poll_error_count"] = _f["count"]
                if not ok:
                    _st["offline_since"] = prev.get("offline_since") or now
                _PLC_STATUS[dev["id"]] = _st
            for k in list(_PLC_CONN.keys()):
                if k not in ids: _plc_drop(k)
            for k in list(_PLC_STATUS.keys()):
                if k not in ids: _PLC_STATUS.pop(k, None)
            for k in list(_MB_LAST.keys()):
                if k not in ids: _MB_LAST.pop(k, None)
            for k in list(_POLL_NOBITS.keys()):
                if k not in ids: _POLL_NOBITS.pop(k, None)
        except Exception as e:
            print(f"[ANDON-PLC-POLL] {e}")
        n += 1
        if n % 60 == 0:
            try: _stale_call_sweep()
            except Exception as e: print(f"[ANDON] stale-sweep {e}")
        _time.sleep(_PLC_POLL_INTERVAL)


def _slip_sweep_loop():
    while True:
        try:
            _slip_threshold_sweep()
        except Exception as e:
            print(f"[ANDON-SLIP] sweep-loop {e}")
        _time.sleep(1.0)


def _start_plc_poller():
    global _plc_poller_started
    if _plc_poller_started: return
    _plc_poller_started = True
    threading.Thread(target=_plc_poll_loop, daemon=True, name="andon-plc-poller").start()
    threading.Thread(target=_slip_sweep_loop, daemon=True, name="andon-slip-sweep").start()


_output_writer_started = False


def _start_output_writer():
    global _output_writer_started
    if _output_writer_started: return
    _output_writer_started = True
    threading.Thread(target=_andon_output_loop, daemon=True, name="andon-output-writer").start()


def start_workers():
    def _off(name, default):
        return os.getenv(name, default).strip().lower() in ("0", "false", "no", "off")
    poll_off = _off("ANDON_POLL_ENABLED", "1")
    out_off  = _off("ANDON_OUTPUT_ENABLED", "0" if poll_off else "1")
    if poll_off:
        print("[ANDON] input poller DISABLED (ANDON_POLL_ENABLED=0)")
    else:
        _start_plc_poller()
    if out_off:
        print("[ANDON] output writer disabled")
    else:
        _start_output_writer()
        print("[ANDON] output writer ENABLED — mirroring calls to output-PLC bits")


# ════════════════════════════════════════════════════════════════════
#  CALL → PLC OUTPUT
# ════════════════════════════════════════════════════════════════════
_OUT_CONN   = {}
_OUT_RETRY  = {}
_OUT_STATE  = {}
_ACK_DEPTS  = {"maintenance", "toolroom"}


def _dept_key(name):
    return re.sub(r"[\s_\-]+", "", str(name or "").strip().lower())
_OUT_ENSURED = False

_WRITER_ID   = f"{socket.gethostname()}:{os.getpid()}"
_WRITER_PRIO = 0 if os.getenv("ANDON_POLL_ENABLED", "1").strip().lower() in ("0", "false", "no", "off") else 1
_have_lock   = None


def _dept_off_on_ack(dept):
    return _dept_key(dept) in _ACK_DEPTS


def _want_bit(dept, live, on_close=False):
    row = live.get(_dept_key(dept))
    if not row:
        return False
    field = "total" if on_close else ("unacked" if _dept_off_on_ack(dept) else "total")
    return int(row.get(field) or 0) > 0


def _ensure_output():
    global _OUT_ENSURED
    if _OUT_ENSURED:
        return
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS andon_call_output (
                id          SERIAL PRIMARY KEY,
                department  TEXT NOT NULL,
                plc_ip      TEXT NOT NULL,
                plc_port    INTEGER DEFAULT 5007,
                plc_series  TEXT    DEFAULT 'Q',
                bit_type    TEXT NOT NULL,
                bit_no      TEXT NOT NULL,
                enabled     BOOLEAN DEFAULT TRUE,
                created_at  TIMESTAMP DEFAULT NOW()
            )""")
        for col, typ in (("last_bit", "BOOLEAN"), ("last_want", "BOOLEAN"),
                         ("last_online", "BOOLEAN"), ("last_at", "TIMESTAMP"),
                         ("last_writer", "TEXT"), ("reconnect_req", "TIMESTAMP"),
                         ("bit2_type", "TEXT"), ("bit2_no", "TEXT"),
                         ("last_bit2", "BOOLEAN"), ("last_want2", "BOOLEAN")):
            cur.execute(f"ALTER TABLE andon_call_output ADD COLUMN IF NOT EXISTS {col} {typ}")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS andon_output_lock (
                id         INTEGER PRIMARY KEY DEFAULT 1,
                holder     TEXT,
                prio       INTEGER DEFAULT 0,
                heartbeat  TIMESTAMP,
                CONSTRAINT andon_output_lock_one CHECK (id = 1)
            )""")
        conn.commit()
    _OUT_ENSURED = True


def _acquire_writer_lock():
    try:
        with get_conn() as conn:
            cur = conn.cursor()
            cur.execute("""INSERT INTO andon_output_lock (id, holder, prio, heartbeat)
                           VALUES (1, %s, %s, NOW()) ON CONFLICT (id) DO NOTHING""",
                        (_WRITER_ID, _WRITER_PRIO))
            cur.execute("""UPDATE andon_output_lock SET holder=%s, prio=%s, heartbeat=NOW()
                            WHERE id=1 AND (holder=%s
                                            OR split_part(holder, ':', 1) = %s
                                            OR COALESCE(prio,0) < %s
                                            OR (COALESCE(prio,0) = %s
                                                AND heartbeat < NOW() - INTERVAL '10 seconds')
                                            OR (COALESCE(prio,0) > %s
                                                AND heartbeat < NOW() - INTERVAL '60 seconds'))""",
                        (_WRITER_ID, _WRITER_PRIO, _WRITER_ID,
                         socket.gethostname(), _WRITER_PRIO, _WRITER_PRIO, _WRITER_PRIO))
            got = cur.rowcount == 1
            conn.commit()
            return got
    except Exception as e:
        print(f"[ANDON-OUT] lock error: {e}")
        return False


_OUT_FAILS = {}
_OUT_MAX_FAILS = 3
_OUT_RECONN_SEEN = {}


def _out_drop(ip, port):
    key = (ip, int(port or 5007))
    mc = _OUT_CONN.pop(key, None)
    if mc is not None:
        try: mc.close()
        except Exception: pass
    _OUT_RETRY.pop(key, None)
    _OUT_FAILS.pop(key, None)


def _out_write_bit(ip, port, series, bit_type, bit_no, value):
    key = (ip, int(port or 5007))
    head = f"{(bit_type or '').upper()}{bit_no}"
    mc = _OUT_CONN.get(key)
    if mc is None:
        if _time.monotonic() < _OUT_RETRY.get(key, 0):
            return None
        try:
            mc = _connect({"series": series or "Q", "plc_ip": ip, "plc_port": key[1]})
            _OUT_CONN[key] = mc
            _OUT_RETRY.pop(key, None)
            _OUT_FAILS[key] = 0
        except Exception:
            _OUT_RETRY[key] = _time.monotonic() + _PLC_RETRY_SECS
            return None

    want = 1 if value else 0
    try:
        cur_bit = int(_read_one(mc, bit_type, bit_no))
        if cur_bit != want:
            mc.write_bit(bit_type, bit_no, want)
            cur_bit = int(_read_one(mc, bit_type, bit_no))
        _OUT_FAILS[key] = 0
        return bool(cur_bit)
    except Exception as e:
        n = _OUT_FAILS.get(key, 0) + 1
        _OUT_FAILS[key] = n
        if n < _OUT_MAX_FAILS:
            return None
        try: mc.close()
        except Exception: pass
        _OUT_CONN.pop(key, None)
        _OUT_FAILS[key] = 0
        _OUT_RETRY[key] = _time.monotonic() + 1
        print(f"[ANDON-OUT] {ip}:{key[1]} {head} — {n} baar lagataar fail, connection reset ({e})", flush=True)
        return None


def _out_read_bit(ip, port, series, bit_type, bit_no):
    try:
        p = int(port or 5007)
        if not _reachable(ip, p, timeout=0.4):
            return None
        mc = _connect({"series": series or "Q", "plc_ip": ip, "plc_port": p})
        try:
            return bool(_read_one(mc, bit_type, bit_no))
        finally:
            try: mc.close()
            except Exception: pass
    except Exception:
        return None


def _andon_output_write_once():
    _ensure_output()
    global _have_lock
    got = _acquire_writer_lock()
    if got != _have_lock:
        print(f"[ANDON-OUT] writer lock "
              f"{'ACQUIRED' if got else 'RELEASED'} ({_WRITER_ID}, prio={_WRITER_PRIO})", flush=True)
        _have_lock = got
    if not got:
        for k in list(_OUT_CONN.keys()):
            try: _OUT_CONN.pop(k).close()
            except Exception: pass
        return
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("""SELECT id, department, plc_ip, plc_port, plc_series, bit_type, bit_no,
                              bit2_type, bit2_no, reconnect_req
                         FROM andon_call_output WHERE enabled=TRUE""")
        maps = cur.fetchall()
        cur.execute("""SELECT COALESCE(dep.name, e.display_name) AS dept,
                              COUNT(*) FILTER (WHERE e.acknowledged_at IS NULL) AS unacked,
                              COUNT(*) AS total
                         FROM andon_system e
                         LEFT JOIN andon_departments dep ON dep.id = e.department_id
                        WHERE e.state='OPEN' GROUP BY 1""")
        live = {_dept_key(r["dept"]): r for r in cur.fetchall()}
    enabled_ids = set()
    updates = []
    for m in maps:
        enabled_ids.add(m["id"])
        req = m.get("reconnect_req")
        if req is not None and _OUT_RECONN_SEEN.get(m["id"]) != req:
            _OUT_RECONN_SEEN[m["id"]] = req
            _out_drop(m["plc_ip"], m["plc_port"])
            print(f"[ANDON-OUT] Retry — {m['plc_ip']}:{m['plc_port']} connection reset", flush=True)
        want = _want_bit(m["department"], live)
        prev = _OUT_STATE.get(m["id"], {})
        actual = _out_write_bit(m["plc_ip"], m["plc_port"], m["plc_series"],
                                m["bit_type"], m["bit_no"], want)
        if actual is None and (m["plc_ip"], int(m["plc_port"] or 5007)) in _OUT_CONN:
            actual = prev.get("on")

        want2 = actual2 = None
        if (m.get("bit2_no") or "").strip() and _dept_off_on_ack(m["department"]):
            want2 = _want_bit(m["department"], live, on_close=True)
            actual2 = _out_write_bit(m["plc_ip"], m["plc_port"], m["plc_series"],
                                     m["bit2_type"] or "M", m["bit2_no"], want2)
            if actual2 is None and (m["plc_ip"], int(m["plc_port"] or 5007)) in _OUT_CONN:
                actual2 = prev.get("on2")

        _OUT_STATE[m["id"]] = {"ip": m["plc_ip"], "port": m["plc_port"], "series": m["plc_series"],
                               "bit_type": m["bit_type"], "bit_no": m["bit_no"],
                               "bit2_type": m.get("bit2_type"), "bit2_no": m.get("bit2_no"),
                               "want": want, "on": actual, "online": actual is not None,
                               "want2": want2, "on2": actual2,
                               "checked": datetime.now().isoformat(timespec="seconds")}
        updates.append((actual, want, actual is not None, actual2, want2, m["id"]))

    for oid in list(_OUT_STATE.keys()):
        if oid in enabled_ids:
            continue
        st = _OUT_STATE[oid]
        if st.get("on"):
            _out_write_bit(st.get("ip"), st.get("port"), st.get("series"),
                          st.get("bit_type"), st.get("bit_no"), False)
        if st.get("on2") and (st.get("bit2_no") or "").strip():
            _out_write_bit(st.get("ip"), st.get("port"), st.get("series"),
                          st.get("bit2_type") or "M", st.get("bit2_no"), False)
        _OUT_STATE.pop(oid, None)

    if updates:
        try:
            with get_conn() as conn:
                cur = conn.cursor()
                for last_bit, last_want, last_online, last_bit2, last_want2, mid in updates:
                    cur.execute("""UPDATE andon_call_output
                                      SET last_bit=%s, last_want=%s, last_online=%s,
                                          last_bit2=%s, last_want2=%s,
                                          last_at=NOW(), last_writer=%s
                                    WHERE id=%s""",
                                (last_bit, last_want, last_online,
                                 last_bit2, last_want2, _WRITER_ID, mid))
                conn.commit()
        except Exception as e:
            print(f"[ANDON-OUT] persist error: {e}")


def _andon_output_loop():
    while True:
        _OUT_WAKE.clear()
        try:
            _andon_output_write_once()
        except Exception as e:
            print(f"[ANDON-OUT] {e}")
        _OUT_WAKE.wait(timeout=1.0)


class CallOutputIn(BaseModel):
    department: str
    plc_ip: str
    plc_port: Optional[int] = 5007
    plc_series: Optional[str] = "Q"
    bit_type: str
    bit_no: str
    bit2_type: Optional[str] = "M"
    bit2_no: Optional[str] = ""
    enabled: bool = True


@router.get("/call-outputs")
def list_call_outputs(user=Depends(get_current_user)):
    _ensure_output()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("""SELECT id, department, plc_ip, plc_port, plc_series,
                              bit_type, bit_no, bit2_type, bit2_no,
                              enabled, created_at,
                              last_bit, last_bit2, last_online, last_writer,
                              EXTRACT(EPOCH FROM (NOW() - last_at)) AS last_age
                         FROM andon_call_output ORDER BY id""")
        rows = cur.fetchall()
        cur.execute("""SELECT COALESCE(dep.name, e.display_name) AS dept,
                              COUNT(*) FILTER (WHERE e.acknowledged_at IS NULL) AS unacked,
                              COUNT(*) AS total
                         FROM andon_system e
                         LEFT JOIN andon_departments dep ON dep.id = e.department_id
                        WHERE e.state='OPEN' GROUP BY 1""")
        live = {_dept_key(r["dept"]): r for r in cur.fetchall()}
        cur.execute("SELECT holder, EXTRACT(EPOCH FROM (NOW()-heartbeat)) AS age FROM andon_output_lock WHERE id=1")
        _lk = cur.fetchone() or {}
    _wlive = _lk.get("age") is not None and _lk["age"] <= 12
    for r in rows:
        r["off_on_ack"] = _dept_off_on_ack(r["department"])
        r["should_be_on"] = _want_bit(r["department"], live)
        r["bit2_allowed"] = bool(r["off_on_ack"])
        r["should_be_on2"] = (_want_bit(r["department"], live, on_close=True)
                              if ((r.get("bit2_no") or "").strip() and r["off_on_ack"])
                              else None)
        age = r.pop("last_age", None)
        fresh = age is not None and age <= 12
        r.pop("last_writer", None)
        r["writer"] = _lk.get("holder") if _wlive else None
        r["writer_age"] = round(_lk["age"], 1) if _lk.get("age") is not None else None
        if r["enabled"] and fresh:
            r["bit_on"], r["online"] = r.get("last_bit"), r.get("last_online")
            r["bit2_on"] = r.get("last_bit2")
        else:
            r["bit_on"], r["online"] = None, None
            r["bit2_on"] = None
        reach = True if r["bit_on"] is not None else r["online"]
        if reach is None and r.get("plc_ip") and r["enabled"]:
            reach = _reachable(r["plc_ip"], r.get("plc_port") or 5007, timeout=0.4)
        r["reachable"] = reach
        r.pop("last_bit", None); r.pop("last_bit2", None); r.pop("last_online", None)
        if isinstance(r.get("created_at"), datetime):
            r["created_at"] = r["created_at"].isoformat()
    return rows


@router.post("/call-outputs", status_code=201)
def add_call_output(body: CallOutputIn, user=Depends(get_current_user)):
    _ensure_output()
    dept = (body.department or "").strip()
    ip   = (body.plc_ip or "").strip()
    bt   = (body.bit_type or "").strip().upper()
    bn   = str(body.bit_no or "").strip()
    if not (dept and ip and bt and bn):
        raise HTTPException(400, "department, plc_ip, bit_type, bit_no required")
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("""INSERT INTO andon_call_output
                         (department, plc_ip, plc_port, plc_series, bit_type, bit_no,
                          bit2_type, bit2_no, enabled)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
                    (dept, ip, body.plc_port or 5007, body.plc_series or "Q", bt, bn,
                     (body.bit2_type or "M").strip().upper(),
                     str(body.bit2_no or "").strip(), bool(body.enabled)))
        new_id = cur.fetchone()[0]; conn.commit()
    return {"id": new_id}


@router.put("/call-outputs/{oid}")
def edit_call_output(oid: int, body: CallOutputIn, user=Depends(get_current_user)):
    _ensure_output()
    with get_conn() as conn:
        cur = conn.cursor()
        new_b2 = str(body.bit2_no or "").strip()
        cur.execute("SELECT bit2_type, bit2_no, plc_ip, plc_port, plc_series FROM andon_call_output WHERE id=%s", (oid,))
        _old = cur.fetchone()
        if _old and (_old[1] or "").strip() and (_old[1] or "").strip() != new_b2:
            try:
                _out_write_bit(_old[2], _old[3], _old[4], _old[0] or "M", _old[1], False)
            except Exception as _e:
                print(f"[ANDON-OUT] bit2 reset error: {_e}")
        cur.execute("""UPDATE andon_call_output
                          SET department=%s, plc_ip=%s, plc_port=%s, plc_series=%s,
                              bit_type=%s, bit_no=%s, bit2_type=%s, bit2_no=%s, enabled=%s
                        WHERE id=%s""",
                    ((body.department or "").strip(), (body.plc_ip or "").strip(),
                     body.plc_port or 5007, body.plc_series or "Q",
                     (body.bit_type or "").strip().upper(), str(body.bit_no or "").strip(),
                     (body.bit2_type or "M").strip().upper(), new_b2,
                     bool(body.enabled), oid))
        if cur.rowcount == 0:
            raise HTTPException(404, "mapping not found")
        conn.commit()
    return {"ok": True}


@router.delete("/call-outputs/{oid}")
def del_call_output(oid: int, user=Depends(get_current_user)):
    _ensure_output()
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM andon_call_output WHERE id=%s", (oid,))
        conn.commit()
    return {"ok": True}


@router.post("/call-outputs/{oid}/recheck")
def call_output_recheck(oid: int, user=Depends(get_current_user)):
    _ensure_output()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("""SELECT id, department, plc_ip, plc_port, enabled
                         FROM andon_call_output WHERE id = %s""", (oid,))
        m = cur.fetchone()
        if not m:
            raise HTTPException(404, "Mapping not found")
        cur.execute("UPDATE andon_call_output SET reconnect_req = NOW() WHERE id=%s", (oid,))
        conn.commit()

    if _have_lock:
        _out_drop(m["plc_ip"], m["plc_port"])

    ok, why = _probe_cached(m["plc_ip"], m["plc_port"] or 5007, timeout=3.0, force=True)
    return {"id": oid, "ok": ok, "reason": why}


def _ensure_tables():
    global _ensured
    if _ensured:
        return
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS maintenance_slip_config (
                scope               TEXT PRIMARY KEY DEFAULT 'GLOBAL',
                slip_threshold_min  INTEGER NOT NULL DEFAULT 2,
                updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )""")
        cur.execute("""
            INSERT INTO maintenance_slip_config (scope) VALUES ('GLOBAL')
            ON CONFLICT (scope) DO NOTHING""")
        cur.execute("ALTER TABLE maintenance_slip_config ADD COLUMN IF NOT EXISTS target_breakdowns INTEGER NOT NULL DEFAULT 10")
        cur.execute("ALTER TABLE maintenance_slip_config ADD COLUMN IF NOT EXISTS target_pending    INTEGER NOT NULL DEFAULT 0")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS andon_departments (
                id         SERIAL PRIMARY KEY,
                name       VARCHAR(120) NOT NULL UNIQUE,
                color      VARCHAR(20)  DEFAULT '#2563eb',
                created_at TIMESTAMP DEFAULT NOW()
            )""")

        try:
            for _old, _new in (("andon_esp_devices", "andon_plc_devices"),
                               ("andon_esp_output_mapping", "andon_plc_output_mapping")):
                cur.execute("SELECT to_regclass(%s) IS NOT NULL, to_regclass(%s) IS NOT NULL", (_old, _new))
                _old_ex, _new_ex = cur.fetchone()
                if _old_ex and not _new_ex:
                    cur.execute(f"ALTER TABLE {_old} RENAME TO {_new}")
            for _tbl in ("andon_plc_output_mapping", "andon_system", "andon_history"):
                cur.execute("""SELECT 1 FROM information_schema.columns
                                 WHERE table_name=%s AND column_name='esp_id'""", (_tbl,))
                if cur.fetchone():
                    cur.execute(f"ALTER TABLE {_tbl} RENAME COLUMN esp_id TO plc_id")
            cur.execute("ALTER INDEX IF EXISTS andon_esp_ip_uq   RENAME TO andon_plc_ip_uq")
            cur.execute("ALTER INDEX IF EXISTS andon_esp_name_uq RENAME TO andon_plc_name_uq")
            conn.commit()
        except Exception as _me:
            conn.rollback()
            print(f"[ANDON] esp->plc migration skip: {_me}")

        cur.execute("""
            CREATE TABLE IF NOT EXISTS andon_plc_devices (
                id          SERIAL PRIMARY KEY,
                name        VARCHAR(160) NOT NULL,
                ip          VARCHAR(60)  NOT NULL,
                port        INTEGER      DEFAULT 80,
                zone         VARCHAR(120),
                line         VARCHAR(120),
                machine_no   VARCHAR(60),
                machine_name VARCHAR(160),
                description  TEXT,
                enabled      BOOLEAN DEFAULT TRUE,
                poll_path    VARCHAR(120) DEFAULT '/status',
                created_at   TIMESTAMP DEFAULT NOW(),
                updated_at   TIMESTAMP DEFAULT NOW()
            )""")

        for _ix, _expr in (("andon_plc_ip_uq",   "LOWER(TRIM(ip))"),
                           ("andon_plc_name_uq", "LOWER(TRIM(name))")):
            try:
                cur.execute(f"""CREATE UNIQUE INDEX IF NOT EXISTS {_ix}
                                  ON andon_plc_devices (({_expr}))""")
            except Exception as _e:
                conn.rollback()

        cur.execute("ALTER TABLE andon_plc_devices ADD COLUMN IF NOT EXISTS zone VARCHAR(120)")
        cur.execute("ALTER TABLE andon_plc_devices ADD COLUMN IF NOT EXISTS line VARCHAR(120)")
        cur.execute("ALTER TABLE andon_plc_devices ADD COLUMN IF NOT EXISTS machine_no VARCHAR(60)")
        cur.execute("ALTER TABLE andon_plc_devices ADD COLUMN IF NOT EXISTS machine_name VARCHAR(160)")
        cur.execute("ALTER TABLE andon_plc_devices ADD COLUMN IF NOT EXISTS series VARCHAR(20) DEFAULT 'Q'")
        cur.execute("ALTER TABLE andon_plc_devices ADD COLUMN IF NOT EXISTS sub_ip VARCHAR(60)")
        cur.execute("ALTER TABLE andon_plc_devices ADD COLUMN IF NOT EXISTS sub_port INTEGER")
        cur.execute("ALTER TABLE andon_plc_devices ADD COLUMN IF NOT EXISTS sub_series VARCHAR(20)")
        cur.execute("ALTER TABLE andon_plc_devices ADD COLUMN IF NOT EXISTS sub_machine_no VARCHAR(60)")
        cur.execute("ALTER TABLE andon_plc_devices ADD COLUMN IF NOT EXISTS protocol     VARCHAR(10) DEFAULT 'MC'")
        cur.execute("ALTER TABLE andon_plc_devices ADD COLUMN IF NOT EXISTS unit_id      INTEGER     DEFAULT 1")
        cur.execute("ALTER TABLE andon_plc_devices ADD COLUMN IF NOT EXISTS sub_protocol VARCHAR(10) DEFAULT 'MC'")
        cur.execute("ALTER TABLE andon_plc_devices ADD COLUMN IF NOT EXISTS sub_unit_id  INTEGER     DEFAULT 1")

        cur.execute("UPDATE andon_plc_devices SET protocol='MC' WHERE protocol IS NULL")
        cur.execute("UPDATE andon_plc_devices SET sub_protocol='MC' WHERE sub_protocol IS NULL")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS andon_plc_output_mapping (
                id            SERIAL PRIMARY KEY,
                plc_id        INTEGER REFERENCES andon_plc_devices(id) ON DELETE CASCADE,
                do_index      INTEGER NOT NULL CHECK (do_index BETWEEN 1 AND 8),
                display_name  VARCHAR(160),
                department_id INTEGER REFERENCES andon_departments(id) ON DELETE SET NULL,
                priority      VARCHAR(20) DEFAULT 'Normal',
                enabled       BOOLEAN DEFAULT TRUE,
                UNIQUE (plc_id, do_index)
            )""")
        cur.execute("""CREATE UNIQUE INDEX IF NOT EXISTS andon_output_default_uq
                       ON andon_plc_output_mapping (do_index) WHERE plc_id IS NULL""")
        cur.execute("ALTER TABLE andon_plc_output_mapping ADD COLUMN IF NOT EXISTS bit_type VARCHAR(4)")
        cur.execute("ALTER TABLE andon_plc_output_mapping ADD COLUMN IF NOT EXISTS bit_no   VARCHAR(20)")

        cur.execute("""
            CREATE TABLE IF NOT EXISTS andon_model_map (
                id          SERIAL PRIMARY KEY,
                plc_id      INTEGER NOT NULL REFERENCES andon_plc_devices(id) ON DELETE CASCADE,
                device_type VARCHAR(4),
                device_no   VARCHAR(20),
                value       INTEGER,
                model_name  TEXT,
                created_at  TIMESTAMP DEFAULT NOW()
            )""")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS andon_fault_map (
                id          SERIAL PRIMARY KEY,
                plc_id      INTEGER NOT NULL REFERENCES andon_plc_devices(id) ON DELETE CASCADE,
                device_type VARCHAR(4),
                device_no   VARCHAR(20),
                value       INTEGER,
                fault_name  TEXT,
                created_at  TIMESTAMP DEFAULT NOW()
            )""")

        cur.execute("""
            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM information_schema.tables
                            WHERE table_schema='public' AND table_name='andon_events')
                   AND NOT EXISTS (SELECT 1 FROM information_schema.tables
                                    WHERE table_schema='public' AND table_name='andon_system')
                THEN
                    ALTER TABLE andon_events RENAME TO andon_system;
                END IF;
            END $$;""")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS andon_system (
                id            SERIAL PRIMARY KEY,
                plc_id        INTEGER REFERENCES andon_plc_devices(id) ON DELETE CASCADE,
                do_index      INTEGER,
                department_id INTEGER,
                zone          VARCHAR(120),
                line          VARCHAR(120),
                display_name  VARCHAR(160),
                priority      VARCHAR(20),
                started_at    TIMESTAMP DEFAULT NOW(),
                acknowledged_at TIMESTAMP,
                state         VARCHAR(12) DEFAULT 'OPEN',
                created_at    TIMESTAMP DEFAULT NOW()
            )""")
        cur.execute("ALTER TABLE andon_system ADD COLUMN IF NOT EXISTS model VARCHAR(120)")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS andon_history (
                id               SERIAL PRIMARY KEY,
                plc_id           INTEGER,
                do_index         INTEGER,
                department_id    INTEGER,
                zone             VARCHAR(120),
                line             VARCHAR(120),
                display_name     VARCHAR(160),
                priority         VARCHAR(20),
                started_at       TIMESTAMP,
                ended_at         TIMESTAMP,
                duration_seconds INTEGER,
                response_seconds INTEGER,
                created_at       TIMESTAMP DEFAULT NOW()
            )""")

        for _t in ("andon_system", "andon_history"):
            cur.execute(f"ALTER TABLE {_t} ADD COLUMN IF NOT EXISTS zone VARCHAR(120)")
            cur.execute(f"ALTER TABLE {_t} ADD COLUMN IF NOT EXISTS line VARCHAR(120)")
            cur.execute(f"ALTER TABLE {_t} ADD COLUMN IF NOT EXISTS machine_no VARCHAR(60)")
            cur.execute(f"ALTER TABLE {_t} ADD COLUMN IF NOT EXISTS model VARCHAR(120)")
            cur.execute(f"ALTER TABLE {_t} ADD COLUMN IF NOT EXISTS fault VARCHAR(160)")

        cur.execute("SELECT COUNT(*) FROM andon_departments")
        if (cur.fetchone()[0] or 0) == 0:
            for d in _DEFAULT_DEPTS:
                cur.execute("INSERT INTO andon_departments (name) VALUES (%s) ON CONFLICT DO NOTHING", (d,))
        cur.execute("SELECT COUNT(*) FROM andon_plc_output_mapping WHERE plc_id IS NULL")
        if (cur.fetchone()[0] or 0) == 0:
            for do_i, disp, dept, prio in _DEFAULT_OUTPUTS:
                dept_id = None
                if dept:
                    cur.execute("SELECT id FROM andon_departments WHERE name=%s", (dept,))
                    r = cur.fetchone(); dept_id = r[0] if r else None
                cur.execute("""INSERT INTO andon_plc_output_mapping
                               (plc_id, do_index, display_name, department_id, priority, enabled)
                               VALUES (NULL,%s,%s,%s,%s,TRUE) ON CONFLICT DO NOTHING""",
                            (do_i, disp, dept_id, prio))

        cur.execute("""SELECT COUNT(*) FROM andon_plc_output_mapping
                         WHERE plc_id IS NULL AND display_name='Other Loss'""")
        if (cur.fetchone()[0] or 0) == 0:
            cur.execute("DELETE FROM andon_plc_output_mapping")
            cur.execute("DELETE FROM andon_departments")
            dept_id = {}
            for d in ("Maintenance", "Toolroom", "Quality", "Material", "Other Loss"):
                cur.execute("INSERT INTO andon_departments (name) VALUES (%s) RETURNING id", (d,))
                dept_id[d] = cur.fetchone()[0]
            for do_i, disp, dept, prio in _DEFAULT_OUTPUTS:
                cur.execute("""INSERT INTO andon_plc_output_mapping
                                 (plc_id, do_index, display_name, department_id, priority, enabled)
                               VALUES (NULL,%s,%s,%s,%s,TRUE)""",
                            (do_i, disp, dept_id.get(dept), prio))

        cur.execute("""UPDATE andon_departments SET name='Material' WHERE name='Store'
                        AND NOT EXISTS (SELECT 1 FROM andon_departments WHERE name='Material')""")
        cur.execute("UPDATE andon_plc_output_mapping SET display_name='Material' WHERE display_name='Store'")

        cur.execute("INSERT INTO andon_departments (name, color) VALUES ('Model Setup', '#db2777') ON CONFLICT DO NOTHING")
        cur.execute("UPDATE andon_departments SET color='#db2777' WHERE name='Model Setup' AND (color IS NULL OR color='#2563eb')")
        cur.execute("SELECT id FROM andon_departments WHERE name='Model Setup'")
        _msrow = cur.fetchone()
        _ms_id = _msrow[0] if _msrow else None
        cur.execute("SELECT 1 FROM andon_plc_output_mapping WHERE plc_id IS NULL AND do_index=8")
        if not cur.fetchone():
            cur.execute("""INSERT INTO andon_plc_output_mapping
                             (plc_id, do_index, display_name, department_id, priority, enabled)
                           VALUES (NULL, 8, 'Model Setup', %s, 'Normal', TRUE)""", (_ms_id,))
        conn.commit()
    _ensured = True
    start_workers()


# ════════════════════════════════════════════════════════════════════
#  MASTERS
# ════════════════════════════════════════════════════════════════════
@router.get("/masters")
def masters(user=Depends(get_current_user)):
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("""SELECT DISTINCT zone_name, line_name FROM maintenance_machines
                        WHERE COALESCE(is_active, TRUE) AND zone_name IS NOT NULL
                        ORDER BY zone_name, line_name""")
        rows = cur.fetchall()
    tree = {}
    for r in rows:
        tree.setdefault(r["zone_name"], [])
        if r["line_name"] and r["line_name"] not in tree[r["zone_name"]]:
            tree[r["zone_name"]].append(r["line_name"])
    return [{"zone": z, "lines": ls} for z, ls in tree.items()]


# ════════════════════════════════════════════════════════════════════
#  SLIP CONFIG
# ════════════════════════════════════════════════════════════════════
class SlipThresholdIn(BaseModel):
    slip_threshold_min: int
    target_breakdowns: Optional[int] = None
    target_pending:    Optional[int] = None


@router.get("/slip-config")
def get_slip_config(user=Depends(get_current_user)):
    _ensure_tables()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT slip_threshold_min, target_breakdowns, target_pending, updated_at "
                    "FROM maintenance_slip_config WHERE scope='GLOBAL'")
        r = cur.fetchone()
    return {"slip_threshold_min": int(r["slip_threshold_min"]) if r else 2,
            "target_breakdowns": int(r["target_breakdowns"]) if r and r["target_breakdowns"] is not None else 10,
            "target_pending":    int(r["target_pending"])    if r and r["target_pending"]    is not None else 0,
            "updated_at": r["updated_at"].isoformat() if r and r["updated_at"] else None}


@router.put("/slip-config")
def set_slip_config(body: SlipThresholdIn, admin=Depends(require_admin)):
    _ensure_tables()
    mins = max(1, min(60, int(body.slip_threshold_min)))
    tb = None if body.target_breakdowns is None else max(0, int(body.target_breakdowns))
    tp = None if body.target_pending    is None else max(0, int(body.target_pending))
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("""
            INSERT INTO maintenance_slip_config (scope, slip_threshold_min, target_breakdowns, target_pending, updated_at)
            VALUES ('GLOBAL', %s, COALESCE(%s,10), COALESCE(%s,0), NOW())
            ON CONFLICT (scope) DO UPDATE
               SET slip_threshold_min = EXCLUDED.slip_threshold_min,
                   target_breakdowns  = COALESCE(%s, maintenance_slip_config.target_breakdowns),
                   target_pending     = COALESCE(%s, maintenance_slip_config.target_pending),
                   updated_at         = NOW()
            RETURNING slip_threshold_min, target_breakdowns, target_pending
        """, (mins, tb, tp, tb, tp))
        row = cur.fetchone()
        conn.commit()
    _THRESH_CACHE["min"] = mins
    _THRESH_CACHE["at"]  = _time.time()
    return {"slip_threshold_min": int(row["slip_threshold_min"]),
            "target_breakdowns":  int(row["target_breakdowns"]),
            "target_pending":     int(row["target_pending"])}


# ════════════════════════════════════════════════════════════════════
#  DEPARTMENTS
# ════════════════════════════════════════════════════════════════════
class DeptIn(BaseModel):
    name: str
    color: Optional[str] = "#2563eb"


@router.get("/departments")
def list_departments(user=Depends(get_current_user)):
    _ensure_tables()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT id, name, color FROM andon_departments ORDER BY id")
        return cur.fetchall()


@router.post("/departments", status_code=201)
def add_department(body: DeptIn, user=Depends(get_current_user)):
    _ensure_tables()
    nm = (body.name or "").strip()
    if not nm:
        raise HTTPException(400, "name required")
    with get_conn() as conn:
        cur = conn.cursor()
        try:
            cur.execute("INSERT INTO andon_departments (name, color) VALUES (%s,%s) RETURNING id",
                        (nm, body.color or "#2563eb"))
        except Exception:
            conn.rollback(); raise HTTPException(409, "department already exists")
        new_id = cur.fetchone()[0]; conn.commit()
    return {"id": new_id}


@router.put("/departments/{did}")
def edit_department(did: int, body: DeptIn, user=Depends(get_current_user)):
    _ensure_tables()
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("UPDATE andon_departments SET name=%s, color=%s WHERE id=%s",
                    ((body.name or "").strip(), body.color or "#2563eb", did))
        if cur.rowcount == 0:
            raise HTTPException(404, "department not found")
        conn.commit()
    return {"ok": True}


@router.delete("/departments/{did}")
def del_department(did: int, user=Depends(get_current_user)):
    _ensure_tables()
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM andon_departments WHERE id=%s", (did,))
        conn.commit()
    return {"ok": True}


# ════════════════════════════════════════════════════════════════════
#  PLC DEVICES
# ════════════════════════════════════════════════════════════════════
class PlcIn(BaseModel):
    name: str
    ip: str
    port: Optional[int] = None
    series: Optional[str] = "Q"
    protocol: Optional[str] = "MC"
    unit_id: Optional[int] = 1
    zone: Optional[str] = ""
    line: Optional[str] = ""
    machine_no: Optional[str] = ""
    machine_name: Optional[str] = ""
    description: Optional[str] = ""
    enabled: bool = True
    poll_path: Optional[str] = "/status"
    sub_ip: Optional[str] = ""
    sub_port: Optional[int] = None
    sub_series: Optional[str] = "Q"
    sub_protocol: Optional[str] = "MC"
    sub_unit_id: Optional[int] = 1
    sub_machine_no: Optional[str] = ""


@router.get("/plc-devices")
def list_plc(user=Depends(get_current_user)):
    _ensure_tables()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("""SELECT id, name, ip, port, series, protocol, unit_id,
                              zone, line, machine_no, machine_name,
                              sub_ip, sub_port, sub_series, sub_protocol, sub_unit_id,
                              sub_machine_no, description, enabled, poll_path
                         FROM andon_plc_devices ORDER BY name""")
        rows = cur.fetchall()

    todo = []
    for r in rows:
        st = _PLC_STATUS.get(r["id"], {})
        r["online"]     = st.get("online")
        r["sub_online"] = st.get("sub_online")
        r["online_reason"] = r["sub_online_reason"] = None
        r["last_seen"] = st.get("last_seen")
        r["checked"]   = st.get("checked")
        r["poll_error"]       = st.get("poll_error")
        r["poll_error_count"] = st.get("poll_error_count")

        if r["online"] is not True and r.get("enabled") and r.get("ip"):
            todo.append((r, "main", r["ip"], r.get("port") or _default_port(r.get("protocol"))))

        if r["sub_online"] is not True and (r.get("sub_ip") or "").strip():
            todo.append((r, "sub", r["sub_ip"], r.get("sub_port") or _default_port(r.get("sub_protocol"))))

    if todo:
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=min(16, len(todo))) as ex:
            for (r, which, _ip, _pt), (ok, why) in zip(
                    todo, ex.map(lambda t: _probe_cached(t[2], t[3], timeout=3.0), todo)):
                key   = "online" if which == "main" else "sub_online"
                known = r[key]
                if known is None:
                    r[key], r[key + "_reason"] = ok, why
                else:
                    r[key + "_reason"] = "mc" if ok else why

    for r in rows:
        if r.get("enabled") and r["online"] is None:
            r["online"] = False
            r["online_reason"] = r.get("poll_error") or "timeout"

    return rows


@router.post("/plc-devices/{dev_id}/recheck")
def plc_recheck(dev_id: int, user=Depends(get_current_user)):
    _ensure_tables()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("""SELECT id, name, ip, port, protocol, sub_ip, sub_port, sub_protocol, enabled
                         FROM andon_plc_devices WHERE id = %s""", (dev_id,))
        d = cur.fetchone()
    if not d:
        raise HTTPException(404, "PLC not found")

    out = {"id": dev_id, "online": None, "online_reason": None,
           "sub_online": None, "sub_online_reason": None}

    if d.get("ip"):
        ok, why = _probe_cached(d["ip"], d.get("port") or _default_port(d.get("protocol")),
                                timeout=3.0, force=True)
        out["online"], out["online_reason"] = ok, why
        _PLC_RETRY.pop(dev_id, None)

    if (d.get("sub_ip") or "").strip():
        ok2, why2 = _probe_cached(d["sub_ip"], d.get("sub_port") or _default_port(d.get("sub_protocol")),
                                  timeout=3.0, force=True)
        out["sub_online"], out["sub_online_reason"] = ok2, why2
        _SUB_RETRY.pop(dev_id, None)

    _PLC_STATUS[dev_id] = {
        "online": out["online"],
        "sub_online": out["sub_online"],
        "checked": datetime.now().isoformat(timespec="seconds"),
        "last_seen": datetime.now().isoformat(timespec="seconds") if out["online"] else None
    }
    return out


@router.get("/plc-devices/{eid}/read-now")
def plc_read_now(eid: int, user=Depends(get_current_user)):
    """Is PLC ke bit ABHI padh kar dikhao — pate ke saath.

    KYUN BANAYA (2026-09-12)
    ------------------------
    Pehle jaanchne ka ek hi zariya tha: `plc-recheck`, jo SIRF TCP connect
    karta hai.  Yaani "online" ka matlab bas itna tha ki port khulta hai —
    ek bhi bit padha ja raha hai ya nahi, wo kahin dikhta hi nahi tha.

    Isi wajah se "data to aa raha hai par alarm nahi aata" wali dikkat
    pakadna bahut mushkil tha: PLC hari dikhti thi, poll safal hota tha, aur
    andar se `bits` khali tha.

    Ab ye endpoint teen cheezein ek saath saaf kar deta hai:
      1. kaunsa protocol SACH ME chal raha hai (maanga hua nahi),
      2. har bit ka Modbus pata jo code nikalta hai (COIL/DI/HR + number),
      3. us pate par ABHI ki value.

    ⚠ POLLER KA HI CONNECTION istemal hota hai, naya nahi kholte — FX5U ek
    waqt me sirf EK Modbus client jhelti hai.  Isliye `_plc_lock` ke andar
    chalte hain, warna poller ke saath frame gutth jaate hain.
    """
    _ensure_tables()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("""SELECT id, name, ip, port, series, protocol, unit_id, enabled
                         FROM andon_plc_devices WHERE id=%s""", (eid,))
        d = cur.fetchone()
        if not d:
            raise HTTPException(404, "PLC not found")
        cur.execute("""SELECT do_index, display_name, bit_type, bit_no
                         FROM andon_plc_output_mapping
                        WHERE plc_id=%s ORDER BY do_index""", (eid,))
        mine = cur.fetchall()
        # Default rows alag se ginte hain — poller inhe NAHI padhta, par
        # naam/department ke liye inpar fallback hota hai.  Isi farak ki wajah
        # se screen bhari-bhari dikhti hai aur poll ke paas kuch hota nahi.
        cur.execute("""SELECT COUNT(*) AS n FROM andon_plc_output_mapping
                        WHERE plc_id IS NULL AND COALESCE(bit_type,'') <> ''
                              AND COALESCE(bit_no,'') <> ''""")
        n_default = cur.fetchone()["n"]
        # Kaunsa output CALL hai aur kaunsa sirf ACK -- yahi wo baat hai jo
        # "bit ON dikh raha hai par call nahi aati" ki asli wajah nikalti hai.
        ack_map = _ack_map(cur, eid)
        cur.execute("""SELECT do_index, department_id, display_name
                         FROM andon_plc_output_mapping WHERE plc_id IS NULL""")
        dept_of = {r["do_index"]: r["department_id"] for r in cur.fetchall()}
        cur.execute("""SELECT do_index, department_id FROM andon_plc_output_mapping
                        WHERE plc_id=%s""", (eid,))
        for r in cur.fetchall():
            if r["department_id"] is not None:
                dept_of[r["do_index"]] = r["department_id"]
        cur.execute("SELECT id, name FROM andon_departments")
        dept_name = {r["id"]: r["name"] for r in cur.fetchall()}
        cur.execute("""SELECT do_index, id FROM andon_system
                        WHERE plc_id=%s AND state='OPEN'""", (eid,))
        open_of = {r["do_index"]: r["id"] for r in cur.fetchall()}

    proto = _proto_for(d.get("series"), d.get("protocol"))
    port  = int(d.get("port") or _default_port(proto))
    out = {
        "id": eid, "name": d.get("name"), "ip": d.get("ip"), "port": port,
        "series": d.get("series"), "unit_id": d.get("unit_id"),
        "enabled": bool(d.get("enabled")),
        "protocol_asked": _norm_proto(d.get("protocol")),
        "protocol_used":  proto,
        "default_rows_with_bits": n_default,
        "rows": [], "error": None, "hint": None,
    }

    # Do chup-chaap galtiyan jo yahin pakad leni chahiye.
    if out["protocol_asked"] == "MODBUS" and proto != "MODBUS":
        out["hint"] = (f"Protocol is set to MODBUS, but the series is '{d.get('series')}'. "
                       f"Modbus runs only on FX5U, so MC protocol is being used instead. "
                       f"Set the series to exactly FX5U.")
    elif proto == "MODBUS" and port == MC_DEFAULT_PORT:
        out["hint"] = (f"Protocol is MODBUS but the port is still {MC_DEFAULT_PORT} "
                       f"(the MC default). Modbus TCP normally uses {MODBUS_DEFAULT_PORT}.")
    elif proto == "MC" and port == MODBUS_DEFAULT_PORT:
        out["hint"] = (f"Protocol is MC but the port is {MODBUS_DEFAULT_PORT} "
                       f"(the Modbus default). MC normally uses {MC_DEFAULT_PORT}.")

    usable = [r for r in mine
              if (r["bit_type"] or "").strip() and str(r["bit_no"] or "").strip()]
    if not usable:
        out["error"] = ("No bit address is filled in on this PLC — that is why an alarm is "
                        "never raised. The PLC still shows as online because the poller only "
                        "makes a dummy read when nothing is mapped.")
        if n_default:
            out["hint"] = (f"{n_default} default output row(s) do have addresses, but the poller "
                           f"reads addresses saved on THIS PLC only. Fill them in on this PLC's "
                           f"Outputs table.")
        return out

    # Pehle pata nikaalo — galat/out-of-range address yahin pakda jayega,
    # PLC se baat karne se pehle.
    for r in usable:
        di = r["do_index"]
        item = {"do_index": di,
                "name": r["display_name"] or f"OUT{di}",
                "bit_type": r["bit_type"], "bit_no": r["bit_no"],
                "addr": None, "value": None, "on": None, "error": None,
                # ⚠ Ye teen khaane hi asli jawab dete hain jab bit ON ho par
                # call na aaye:
                "department": dept_name.get(dept_of.get(di)),
                "role": ("ack" if di in ack_map else "call"),
                "ack_of": ack_map.get(di),
                "open_call": open_of.get(di)}
        if proto == "MODBUS":
            try:
                sp, ad = _modbus_addr(r["bit_type"], r["bit_no"])
                item["addr"] = f"{sp} {ad}"
            except Exception as e:
                item["error"] = str(e)
        else:
            item["addr"] = f"{(r['bit_type'] or '').upper()}{r['bit_no']}"
        out["rows"].append(item)

    thik = [i for i in out["rows"] if not i["error"]]
    if not thik:
        out["error"] = "Every mapped address is invalid — see the rows below."
        return out

    with _plc_lock(eid):
        # Poller ne haar kar intezaar shuru kar diya ho to use hata do —
        # user ne KHUD button dabaya hai, use abhi jawab chahiye.
        _PLC_RETRY.pop(eid, None)
        mc = _ensure_conn(_PLC_CONN, _PLC_RETRY, eid, d["ip"], port,
                          d.get("series") or "Q", proto, d.get("unit_id"))
        if mc is None:
            out["error"] = ("Could not connect to the PLC right now. Check the IP, the port, "
                            "and that the PLC's Modbus/MC server is switched on.")
            return out
        try:
            vals = mc.read_many([(i["bit_type"], i["bit_no"]) for i in thik])
            for i, v in zip(thik, vals):
                i["value"] = v
                i["on"] = bool(v)
        except Exception as e:
            out["error"] = f"{type(e).__name__}: {e}"

    # Sabse aam jaal: bit ON hai, par us output ka DEPARTMENT khali hai --
    # tab wo CALL nahi, pichhle output ka ACKNOWLEDGE bit ban jaata hai, aur
    # call kabhi banti hi nahi (`_apply_state` chup-chaap laut jaata hai).
    on_ack = [i for i in out["rows"] if i.get("on") and i.get("role") == "ack"]
    if on_ack and not out["hint"]:
        ek = on_ack[0]
        out["hint"] = (
            f"{ek['name']} (OUT{ek['do_index']}) is ON, but it has no department, so it is "
            f"being treated as the ACKNOWLEDGE bit for OUT{ek['ack_of']} — not as a call. "
            f"That is why no call is raised. Give this output a department in the Outputs "
            f"table to make it a call bit.")
    return out


@router.get("/plc-status")
def plc_status(user=Depends(get_current_user)):
    _ensure_tables()
    return _PLC_STATUS


def _check_plc_unique(cur, ip, name, skip_id=None):
    for field, value, label in (("ip", ip, "IP"), ("name", name, "Naam")):
        val = (value or "").strip()
        if not val:
            continue
        cur.execute(f"""SELECT id, name, ip, zone, line FROM andon_plc_devices
                         WHERE LOWER(TRIM({field})) = LOWER(%s)
                           AND (%s::int IS NULL OR id <> %s)
                         LIMIT 1""", (val, skip_id, skip_id))
        hit = cur.fetchone()
        if hit:
            eid, ename, eip, ezone, eline = hit[0], hit[1], hit[2], hit[3], hit[4]
            where = " · ".join(x for x in (ezone, eline) if x) or "zone/line set nahi"
            raise HTTPException(409,
                f"Ye {label} '{val}' pehle se PLC \"{ename}\" ki hai ({where}, IP {eip}). "
                f"Ek {label} sirf EK hi PLC ko de sakte hain.")


@router.post("/plc-devices", status_code=201)
def add_plc(body: PlcIn, user=Depends(get_current_user)):
    _ensure_tables()
    if not (body.name or "").strip() or not (body.ip or "").strip():
        raise HTTPException(400, "name and ip are required")
    with get_conn() as conn:
        cur = conn.cursor()
        _check_plc_unique(cur, body.ip, body.name)
        proto     = _proto_for(body.series,     body.protocol)
        sub_proto = _proto_for(body.sub_series, body.sub_protocol)
        cur.execute("""INSERT INTO andon_plc_devices
                       (name, ip, port, series, protocol, unit_id,
                        zone, line, machine_no, machine_name, description, enabled, poll_path,
                        sub_ip, sub_port, sub_series, sub_protocol, sub_unit_id, sub_machine_no)
                       VALUES (%s,%s,%s,%s,%s,%s, %s,%s,%s,%s,%s,%s,%s, %s,%s,%s,%s,%s,%s) RETURNING id""",
                    (body.name.strip(), body.ip.strip(), body.port or _default_port(proto),
                     (body.series or "Q").strip() or "Q", proto, int(body.unit_id or 1),
                     (body.zone or "").strip() or None, (body.line or "").strip() or None,
                     (body.machine_no or "").strip() or None, (body.machine_name or "").strip() or None,
                     body.description or "", body.enabled, (body.poll_path or "/status").strip(),
                     (body.sub_ip or "").strip() or None, int(body.sub_port or _default_port(sub_proto)),
                     (body.sub_series or "Q").strip() or "Q", sub_proto, int(body.sub_unit_id or 1),
                     (body.sub_machine_no or "").strip() or None))
        new_id = cur.fetchone()[0]; conn.commit()
    return {"id": new_id}


@router.put("/plc-devices/{eid}")
def edit_plc(eid: int, body: PlcIn, user=Depends(get_current_user)):
    _ensure_tables()
    if not (body.name or "").strip() or not (body.ip or "").strip():
        raise HTTPException(400, "name and ip are required")
    with get_conn() as conn:
        cur = conn.cursor()
        _check_plc_unique(cur, body.ip, body.name, skip_id=eid)
        proto     = _proto_for(body.series,     body.protocol)
        sub_proto = _proto_for(body.sub_series, body.sub_protocol)
        cur.execute("""UPDATE andon_plc_devices
                          SET name=%s, ip=%s, port=%s, series=%s, protocol=%s, unit_id=%s,
                              zone=%s, line=%s, machine_no=%s, machine_name=%s,
                              description=%s, enabled=%s, poll_path=%s,
                              sub_ip=%s, sub_port=%s, sub_series=%s, sub_protocol=%s, sub_unit_id=%s,
                              sub_machine_no=%s, updated_at=NOW()
                        WHERE id=%s""",
                    (body.name.strip(), body.ip.strip(), body.port or _default_port(proto),
                     (body.series or "Q").strip() or "Q", proto, int(body.unit_id or 1),
                     (body.zone or "").strip() or None, (body.line or "").strip() or None,
                     (body.machine_no or "").strip() or None, (body.machine_name or "").strip() or None,
                     body.description or "", body.enabled, (body.poll_path or "/status").strip(),
                     (body.sub_ip or "").strip() or None, int(body.sub_port or _default_port(sub_proto)),
                     (body.sub_series or "Q").strip() or "Q", sub_proto, int(body.sub_unit_id or 1),
                     (body.sub_machine_no or "").strip() or None, eid))
        if cur.rowcount == 0:
            raise HTTPException(404, "PLC not found")
        conn.commit()
    return {"ok": True}


@router.delete("/plc-devices/{eid}")
def del_plc(eid: int, user=Depends(get_current_user)):
    _ensure_tables()
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM andon_plc_devices WHERE id=%s", (eid,))
        conn.commit()
    return {"ok": True}


# ════════════════════════════════════════════════════════════════════
#  OUTPUT MAPPING
# ════════════════════════════════════════════════════════════════════
class OutRow(BaseModel):
    do_index: int
    display_name: Optional[str] = ""
    department_id: Optional[int] = None
    priority: Optional[str] = "Normal"
    enabled: bool = True
    bit_type: Optional[str] = ""
    bit_no: Optional[str] = ""


class OutSave(BaseModel):
    rows: List[OutRow]


@router.get("/outputs/default")
def get_default_outputs(user=Depends(get_current_user)):
    _ensure_tables()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("""SELECT do_index, display_name, department_id, priority, enabled
                         FROM andon_plc_output_mapping WHERE plc_id IS NULL ORDER BY do_index""")
        return cur.fetchall()


@router.get("/plc-devices/{eid}/outputs")
def get_plc_outputs(eid: int, user=Depends(get_current_user)):
    _ensure_tables()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("""SELECT do_index, display_name, department_id, priority, enabled, bit_type, bit_no
                         FROM andon_plc_output_mapping WHERE plc_id=%s ORDER BY do_index""", (eid,))
        own = cur.fetchall()
        if own:
            for r in own:
                r["overridden"] = True
            return own
        cur.execute("""SELECT do_index, display_name, department_id, priority, enabled
                         FROM andon_plc_output_mapping WHERE plc_id IS NULL ORDER BY do_index""")
        rows = cur.fetchall()
        for r in rows:
            r["overridden"] = False
        return rows


def _valid_rows(rows):
    seen, out = set(), []
    for r in rows:
        if not (1 <= int(r.do_index) <= 8):
            continue
        if r.department_id is not None:
            if r.department_id in seen:
                raise HTTPException(400, "each department can be mapped to only ONE output")
            seen.add(r.department_id)
        out.append(r)
    return out


def _replace_outputs(plc_id, rows):
    good = _valid_rows(rows)
    with get_conn() as conn:
        cur = conn.cursor()
        if plc_id is None:
            cur.execute("DELETE FROM andon_plc_output_mapping WHERE plc_id IS NULL")
        else:
            cur.execute("DELETE FROM andon_plc_output_mapping WHERE plc_id=%s", (plc_id,))
        for r in good:
            cur.execute("""INSERT INTO andon_plc_output_mapping
                             (plc_id, do_index, display_name, department_id, priority, enabled, bit_type, bit_no)
                           VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
                        (plc_id, r.do_index, (r.display_name or "").strip(), r.department_id,
                         r.priority or "Normal", r.enabled,
                         (getattr(r, "bit_type", "") or "").strip().upper() or None,
                         (getattr(r, "bit_no", "") or "").strip() or None))
        conn.commit()


@router.put("/outputs/default")
def save_default_outputs(body: OutSave, user=Depends(get_current_user)):
    _ensure_tables()
    _replace_outputs(None, body.rows)
    return {"ok": True}


@router.put("/plc-devices/{eid}/outputs")
def save_plc_outputs(eid: int, body: OutSave, user=Depends(get_current_user)):
    _ensure_tables()
    _replace_outputs(eid, body.rows)
    return {"ok": True}


# ── ASSIGN: Models & Faults
class MapRow(BaseModel):
    device_type: Optional[str] = ""
    device_no:   Optional[str] = ""
    value:       Optional[int] = None
    name:        Optional[str] = ""


class MapSave(BaseModel):
    rows: List[MapRow] = []


def _get_map(table, name_col, eid):
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute(f"""SELECT device_type, device_no, value, {name_col} AS name
                          FROM {table} WHERE plc_id=%s ORDER BY id""", (eid,))
        return cur.fetchall()


def _save_map(table, name_col, eid, rows):
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute(f"DELETE FROM {table} WHERE plc_id=%s", (eid,))
        for r in rows:
            dt = (r.device_type or "").strip().upper() or None
            dn = (r.device_no or "").strip() or None
            nm = (r.name or "").strip() or None
            if dt is None and dn is None and r.value is None and nm is None:
                continue
            cur.execute(f"""INSERT INTO {table} (plc_id, device_type, device_no, value, {name_col})
                            VALUES (%s,%s,%s,%s,%s)""", (eid, dt, dn, r.value, nm))
        conn.commit()


@router.get("/plc-devices/{eid}/models")
def get_plc_models(eid: int, user=Depends(get_current_user)):
    _ensure_tables()
    return _get_map("andon_model_map", "model_name", eid)


@router.put("/plc-devices/{eid}/models")
def save_plc_models(eid: int, body: MapSave, user=Depends(get_current_user)):
    _ensure_tables()
    _save_map("andon_model_map", "model_name", eid, body.rows)
    return {"ok": True}


@router.get("/plc-devices/{eid}/faults")
def get_plc_faults(eid: int, user=Depends(get_current_user)):
    _ensure_tables()
    return _get_map("andon_fault_map", "fault_name", eid)


@router.put("/plc-devices/{eid}/faults")
def save_plc_faults(eid: int, body: MapSave, user=Depends(get_current_user)):
    _ensure_tables()
    _save_map("andon_fault_map", "fault_name", eid, body.rows)
    return {"ok": True}


# ── FAULT HISTORY
def _fy_range(fy):
    try:
        y = int(str(fy).split("-")[0])
        return (f"{y}-04-01", f"{y + 1}-04-01")
    except Exception:
        return None


@router.get("/fault-history")
def fault_history(fy: str = "", month: str = "", date: str = "",
                  zone: str = "", line: str = "", machine_no: str = "", fault: str = "",
                  user=Depends(get_current_user)):
    _ensure_tables()
    where, params = ["started_at IS NOT NULL", "COALESCE(fault,'') <> ''"], []
    rng = _fy_range(fy) if fy else None
    if rng:
        where.append("started_at >= %s AND started_at < %s"); params += [rng[0], rng[1]]
    if month:
        where.append("to_char(started_at,'YYYY-MM') = %s"); params.append(month)
    if date:
        where.append("started_at::date = %s"); params.append(date)
    for _col, _val in (("zone", zone), ("line", line), ("machine_no", machine_no)):
        if _val:
            where.append(f"{_col} = %s"); params.append(_val)
    if fault:
        where.append("fault = %s"); params.append(fault)
    w = " AND ".join(where)
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute(f"""
            WITH allcalls AS (
                SELECT zone, line, machine_no, fault, started_at FROM andon_history
                UNION ALL
                SELECT zone, line, machine_no, fault, started_at FROM andon_system
            )
            SELECT COALESCE(zone,'')       AS zone,
                   COALESCE(line,'')       AS line,
                   COALESCE(machine_no,'') AS machine_no,
                   fault,
                   COUNT(*) AS total
              FROM allcalls
             WHERE {w}
             GROUP BY 1, 2, 3, 4
             ORDER BY total DESC, zone, line, machine_no
        """, params)
        rows = cur.fetchall()
        cur.execute("""SELECT DISTINCT fault
                         FROM (SELECT fault FROM andon_history
                               UNION ALL SELECT fault FROM andon_system) t
                        WHERE COALESCE(fault,'') <> ''
                        ORDER BY 1""")
        faults = [r["fault"] for r in cur.fetchall()]
    return {"rows": rows, "faults": faults}


# ════════════════════════════════════════════════════════════════════
#  CALL LIFECYCLE
# ════════════════════════════════════════════════════════════════════
def _resolve_output(cur, plc_id, do_index):
    cur.execute("""SELECT display_name, department_id, priority FROM andon_plc_output_mapping
                    WHERE plc_id=%s AND do_index=%s""", (plc_id, do_index))
    r = cur.fetchone()
    cur.execute("""SELECT display_name, department_id, priority FROM andon_plc_output_mapping
                    WHERE plc_id IS NULL AND do_index=%s""", (do_index,))
    d = cur.fetchone()
    if not r:
        r = d
    if r:
        name = r["display_name"] or (d and d["display_name"]) or f"DO{do_index}"
        dept = r["department_id"] if r["department_id"] is not None else (d and d["department_id"])
        prio = r["priority"] or (d and d["priority"]) or "Normal"
        return name, dept, prio
    return f"DO{do_index}", None, "Normal"


def _apply_state(cur, dev, do_index, on, dur_override=None, model=None, fault=None):
    ack_map = _ack_map(cur, dev["id"])
    if do_index in ack_map:
        if not on:
            return {"do_index": do_index, "action": "ack_off_ignored"}
        parent = ack_map[do_index]
        cur.execute("""SELECT id, started_at FROM andon_system
                        WHERE plc_id=%s AND do_index=%s AND state='OPEN'
                              AND acknowledged_at IS NULL
                        ORDER BY id DESC LIMIT 1""", (dev["id"], parent))
        pe = cur.fetchone()
        if not pe:
            return {"do_index": do_index, "action": "ack_no_open_call", "parent_do": parent}
        cur.execute("""UPDATE andon_system SET acknowledged_at=NOW() WHERE id=%s
                        RETURNING EXTRACT(EPOCH FROM (NOW()-started_at))::int AS resp""", (pe["id"],))
        rr = cur.fetchone()
        return {"do_index": do_index, "action": "acknowledged", "parent_do": parent,
                "event_id": pe["id"], "response_seconds": (rr["resp"] if rr else None)}

    cur.execute("""SELECT id, started_at FROM andon_system
                    WHERE plc_id=%s AND do_index=%s AND state='OPEN'
                    ORDER BY id DESC LIMIT 1""", (dev["id"], do_index))
    open_ev = cur.fetchone()
    if on:
        if open_ev:
            return {"do_index": do_index, "action": "already_open", "event_id": open_ev["id"]}
        disp, dept_id, prio = _resolve_output(cur, dev["id"], do_index)
        cur.execute("""INSERT INTO andon_system
                         (plc_id, do_index, department_id, zone, line, machine_no, display_name, priority, model, fault, state, started_at)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'OPEN', NOW()) RETURNING id""",
                    (dev["id"], do_index, dept_id, dev.get("zone"), dev.get("line"), dev.get("machine_no"), disp, prio, model, fault))
        return {"do_index": do_index, "action": "opened", "event_id": cur.fetchone()["id"],
                "department_id": dept_id, "display_name": disp}

    if not open_ev:
        return {"do_index": do_index, "action": "not_open"}
    cur.execute("""INSERT INTO andon_history
                     (plc_id, do_index, department_id, zone, line, machine_no, display_name, priority, model, fault,
                      started_at, ended_at, duration_seconds, response_seconds)
                   SELECT plc_id, do_index, department_id, zone, line, machine_no, display_name, priority, model, fault,
                          started_at, NOW(),
                          COALESCE(%s, EXTRACT(EPOCH FROM (NOW() - started_at))::int),
                          CASE WHEN acknowledged_at IS NOT NULL
                               THEN EXTRACT(EPOCH FROM (acknowledged_at - started_at))::int END
                     FROM andon_system WHERE id=%s
                   RETURNING id, duration_seconds""", (dur_override, open_ev["id"]))
    hist = cur.fetchone()
    cur.execute("DELETE FROM andon_system WHERE id=%s", (open_ev["id"],))
    return {"do_index": do_index, "action": "closed",
            "event_id": open_ev["id"],
            "history_id": hist["id"], "duration_seconds": hist["duration_seconds"]}


@router.get("/events")
def live_events(user=Depends(get_current_user)):
    _ensure_tables()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("""SELECT e.id, e.plc_id, d.name AS plc_name, e.do_index, e.department_id,
                              dep.name AS department, e.zone, e.line, e.display_name, e.priority,
                              e.started_at, e.acknowledged_at,
                              EXTRACT(EPOCH FROM (NOW() - e.started_at))::int AS elapsed_seconds
                         FROM andon_system e
                         LEFT JOIN andon_plc_devices d   ON d.id  = e.plc_id
                         LEFT JOIN andon_departments dep ON dep.id = e.department_id
                        WHERE e.state='OPEN'
                        ORDER BY e.started_at""")
        return cur.fetchall()


@router.get("/monitor")
def monitor_board(user=Depends(get_current_user)):
    _ensure_tables()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("""SELECT e.id, COALESCE(dep.name, e.display_name) AS department,
                              e.zone, e.line, e.machine_no, e.display_name, e.priority,
                              e.started_at, e.acknowledged_at,
                              EXTRACT(EPOCH FROM (NOW() - e.started_at))::int AS elapsed_seconds,
                              CASE WHEN e.acknowledged_at IS NOT NULL
                                   THEN EXTRACT(EPOCH FROM (e.acknowledged_at - e.started_at))::int END
                                   AS response_seconds
                         FROM andon_system e
                         LEFT JOIN andon_departments dep ON dep.id = e.department_id
                        WHERE e.state='OPEN'
                        ORDER BY e.started_at""")
        rows = cur.fetchall()
        cur.execute("SELECT id, name, color FROM andon_departments ORDER BY id")
        depts = cur.fetchall()
        day_start = ("CASE WHEN NOW()::time >= TIME '07:00' "
                     "     THEN CURRENT_DATE + TIME '07:00' "
                     "     ELSE (CURRENT_DATE - INTERVAL '1 day') + TIME '07:00' END")
        day_end = f"(({day_start}) + INTERVAL '23 hours 30 minutes')"
        cur.execute(f"""SELECT
              (SELECT COUNT(*) FROM andon_system
                 WHERE started_at >= ({day_start}) AND started_at < {day_end})
            + (SELECT COUNT(*) FROM andon_history
                 WHERE started_at >= ({day_start}) AND started_at < {day_end}) AS today""")
        today = int((cur.fetchone() or {}).get("today") or 0)
        cur.execute(f"""
            SELECT COALESCE(dep.name, x.display_name) AS department, COUNT(*) AS n
              FROM (SELECT department_id, display_name, started_at FROM andon_system
                     WHERE started_at >= ({day_start}) AND started_at < {day_end}
                    UNION ALL
                    SELECT department_id, display_name, started_at FROM andon_history
                     WHERE started_at >= ({day_start}) AND started_at < {day_end}) x
              LEFT JOIN andon_departments dep ON dep.id = x.department_id
             GROUP BY 1""")
        today_by_dept = {(r["department"] or "").strip(): int(r["n"]) for r in cur.fetchall()}
    counts, longest = {}, 0
    for r in rows:
        k = (r["department"] or "").strip()
        counts[k] = counts.get(k, 0) + 1
        if (r["elapsed_seconds"] or 0) > longest:
            longest = r["elapsed_seconds"]
    for d in depts:
        name = (d["name"] or "").strip()
        d["active"] = counts.get(name, 0)
        d["today"]  = today_by_dept.get(name, 0)
    return {"rows": rows, "departments": depts,
            "stats": {"active": len(rows), "longest_seconds": int(longest), "today": today}}


@router.get("/dashboard")
def dashboard_board(user=Depends(get_current_user)):
    _ensure_tables()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("""
            SELECT e.id, e.plc_id, d.name AS plc_name, e.do_index,
                   dep.name AS department, e.display_name, e.priority,
                   e.zone AS zone_name, e.line AS line_name,
                   e.started_at, NULL::timestamp AS ended_at,
                   NULL::int AS duration_seconds,
                   EXTRACT(EPOCH FROM (NOW() - e.started_at))::int AS elapsed_seconds,
                   CASE WHEN e.acknowledged_at IS NOT NULL
                        THEN EXTRACT(EPOCH FROM (e.acknowledged_at - e.started_at))::int END
                        AS response_seconds,
                   TRUE AS is_live
              FROM andon_system e
              LEFT JOIN andon_plc_devices d   ON d.id   = e.plc_id
              LEFT JOIN andon_departments dep ON dep.id = e.department_id
             WHERE e.state='OPEN'
               AND COALESCE(dep.name, e.display_name) ILIKE 'maintenance'
             ORDER BY e.started_at
        """)
        rows = cur.fetchall()

        day_start = (
            "CASE WHEN NOW()::time >= TIME '07:00' "
            "     THEN CURRENT_DATE + TIME '07:00' "
            "     ELSE (CURRENT_DATE - INTERVAL '1 day') + TIME '07:00' END")
        day_end = f"(({day_start}) + INTERVAL '23 hours 30 minutes')"
        maint_e = "COALESCE(dep.name, e.display_name) ILIKE 'maintenance'"
        maint_h = "COALESCE(dep.name, h.display_name) ILIKE 'maintenance'"
        cur.execute(f"""
            SELECT
              (SELECT COUNT(*) FROM andon_system e
                 LEFT JOIN andon_departments dep ON dep.id = e.department_id
                WHERE e.state='OPEN' AND {maint_e})                             AS active,
              (SELECT COUNT(*) FROM andon_system e
                 LEFT JOIN andon_departments dep ON dep.id = e.department_id
                WHERE e.state='OPEN' AND e.acknowledged_at IS NULL
                  AND {maint_e})                                                AS awaiting,
              (SELECT COUNT(*) FROM andon_system e
                 LEFT JOIN andon_departments dep ON dep.id = e.department_id
                WHERE e.started_at >= ({day_start}) AND e.started_at < {day_end}
                  AND {maint_e})
            + (SELECT COUNT(*) FROM andon_history h
                 LEFT JOIN andon_departments dep ON dep.id = h.department_id
                WHERE h.started_at >= ({day_start}) AND h.started_at < {day_end}
                  AND {maint_h})                                                AS today,
              COALESCE((SELECT MAX(EXTRACT(EPOCH FROM (NOW() - e.started_at))::int)
                          FROM andon_system e
                          LEFT JOIN andon_departments dep ON dep.id = e.department_id
                         WHERE e.state='OPEN' AND {maint_e}), 0)                AS longest_seconds
        """)
        stats = dict(cur.fetchone() or {})

    for i, r in enumerate(rows, 1):
        r["serial_in_shift"] = i
    return {"rows": rows, "stats": stats}


@router.get("/today-calls")
def today_calls(frm: Optional[str] = Query(None, alias="from"),
                to:  Optional[str] = None,
                user=Depends(get_current_user)):
    _ensure_tables()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("""SELECT (CASE WHEN NOW()::time >= TIME '07:00' THEN CURRENT_DATE
                                    ELSE CURRENT_DATE - INTERVAL '1 day' END)::date AS d""")
        today_pd = cur.fetchone()["d"].isoformat()
        f = frm or today_pd
        t = to or f
        cur.execute("""
            SELECT h.id, h.zone, h.line, COALESCE(dep.name, h.display_name) AS department,
                   h.started_at, h.ended_at, h.duration_seconds, FALSE AS is_live
              FROM andon_history h
              LEFT JOIN andon_departments dep ON dep.id = h.department_id
             WHERE h.started_at >= (%s::date + TIME '07:00')
               AND h.started_at <  ((%s::date + INTERVAL '1 day') + TIME '06:30')
               AND COALESCE(dep.name, h.display_name) ILIKE 'maintenance'
            UNION ALL
            SELECT NULL::int AS id,
                   e.zone, e.line, COALESCE(dep.name, e.display_name) AS department,
                   e.started_at, NULL::timestamp AS ended_at,
                   EXTRACT(EPOCH FROM (NOW() - e.started_at))::int AS duration_seconds,
                   TRUE AS is_live
              FROM andon_system e
              LEFT JOIN andon_departments dep ON dep.id = e.department_id
             WHERE e.state='OPEN'
               AND e.started_at >= (%s::date + TIME '07:00')
               AND e.started_at <  ((%s::date + INTERVAL '1 day') + TIME '06:30')
               AND COALESCE(dep.name, e.display_name) ILIKE 'maintenance'
             ORDER BY started_at DESC
        """, (f, t, f, t))
        rows = cur.fetchall()

    out = []
    total = 0
    for r in rows:
        st, en = r["started_at"], r["ended_at"]
        dur = int(r["duration_seconds"] or 0)
        total += dur
        out.append({
            "id":         r["id"],
            "zone":       r["zone"], "line": r["line"],
            "department": r["department"],
            "date":       st.date().isoformat() if st else None,
            "start_time": st.strftime("%H:%M:%S") if st else None,
            "end_time":   en.strftime("%H:%M:%S") if en else None,
            "duration_seconds": dur,
            "is_live":    bool(r["is_live"]),
        })
    return {"from": f, "to": t, "calls": len(out),
            "total_loss_seconds": int(total), "rows": out}


@router.get("/today-totals")
def today_totals(user=Depends(get_current_user)):
    _ensure_tables()
    day_start = (
        "(CASE WHEN NOW()::time >= TIME '07:00' "
        "      THEN CURRENT_DATE + TIME '07:00' "
        "      ELSE (CURRENT_DATE - INTERVAL '1 day') + TIME '07:00' END)")
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute(f"""
            SELECT COALESCE(dep.name, h.display_name) AS dept,
                   COALESCE(SUM(h.duration_seconds), 0)::int AS secs,
                   COUNT(*) AS calls
              FROM andon_history h
              LEFT JOIN andon_departments dep ON dep.id = h.department_id
             WHERE h.started_at >= {day_start}
             GROUP BY 1""")
        closed = {r["dept"]: r for r in cur.fetchall()}
        cur.execute(f"""
            SELECT COALESCE(dep.name, e.display_name) AS dept,
                   COALESCE(SUM(EXTRACT(EPOCH FROM (NOW() - e.started_at)))::int, 0) AS secs,
                   COUNT(*) AS calls
              FROM andon_system e
              LEFT JOIN andon_departments dep ON dep.id = e.department_id
             WHERE e.state = 'OPEN' AND e.started_at >= {day_start}
             GROUP BY 1""")
        openc = {r["dept"]: r for r in cur.fetchall()}
        cur.execute("SELECT name, color FROM andon_departments ORDER BY id")
        depts = cur.fetchall()

    out = []
    for d in depts:
        nm = d["name"]
        c = closed.get(nm, {}); o = openc.get(nm, {})
        out.append({
            "department": nm,
            "color": d["color"],
            "closed_loss_seconds": int(c.get("secs", 0)),
            "total_loss_seconds":  int(c.get("secs", 0)) + int(o.get("secs", 0)),
            "calls": int(c.get("calls", 0)) + int(o.get("calls", 0)),
        })
    return {"departments": out}


def _fy_window(fy: str):
    try:
        y = int(str(fy).split("-")[0])
        return f"{y}-04-01", f"{y+1}-03-31"
    except Exception:
        return None, None


def _month_window(month: str):
    try:
        y, m = (int(x) for x in str(month).split("-")[:2])
        import calendar
        return f"{y}-{m:02d}-01", f"{y}-{m:02d}-{calendar.monthrange(y, m)[1]:02d}"
    except Exception:
        return None, None


def _preempt_split(rows):
    iv = [(r["s"], r["e"], r["dept"]) for r in rows
          if r["s"] and r["e"] and r["e"] > r["s"]]
    if not iv:
        return {}, 0.0
    marks = sorted({t for s, e, _ in iv for t in (s, e)})
    per, total = {}, 0.0
    for i in range(len(marks) - 1):
        a, b = marks[i], marks[i + 1]
        span = (b - a).total_seconds()
        if span <= 0:
            continue
        live = [(s, e, d) for s, e, d in iv if s <= a and e >= b]
        if not live:
            continue
        winner = max(live, key=lambda x: (x[0], x[1], str(x[2])))[2]
        per[winner] = per.get(winner, 0.0) + span
        total += span
    return per, total


@router.get("/total-loss")
def total_loss(frm: Optional[str] = Query(None, alias="from"),
               to:  Optional[str] = None,
               fy:    Optional[str] = None,
               month: Optional[str] = None,
               zone:  Optional[str] = None,
               line:  Optional[str] = None,
               user=Depends(get_current_user)):
    _ensure_tables()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("""SELECT (CASE WHEN NOW()::time >= TIME '07:00' THEN CURRENT_DATE
                                    ELSE CURRENT_DATE - INTERVAL '1 day' END)::date AS d""")
        today_pd = cur.fetchone()["d"].isoformat()
        wf = wt = None
        if month:
            wf, wt = _month_window(month)
        if not wf and fy:
            wf, wt = _fy_window(fy)
        f = wf or frm or today_pd
        t = wt or to or f

        cond, args = "", []
        if zone:
            cond += " AND TRIM(LOWER(COALESCE(zone,''))) = TRIM(LOWER(%s))"; args.append(zone)
        if line:
            cond += " AND TRIM(LOWER(COALESCE(line,''))) = TRIM(LOWER(%s))"; args.append(line)

        cur.execute(f"""
            SELECT h.started_at AS s, h.ended_at AS e,
                   COALESCE(d.name, h.display_name, 'DO' || h.do_index) AS dept,
                   h.zone, h.line
              FROM andon_history h
              LEFT JOIN andon_departments d ON d.id = h.department_id
             WHERE h.started_at >= (%s::date + TIME '07:00')
               AND h.started_at <  ((%s::date + INTERVAL '1 day') + TIME '06:30')
               AND h.ended_at IS NOT NULL
               {cond.replace('zone', 'h.zone').replace('line', 'h.line')}
            UNION ALL
            SELECT e.started_at AS s, NOW()::timestamp AS e,
                   COALESCE(d.name, e.display_name, 'DO' || e.do_index) AS dept,
                   e.zone, e.line
              FROM andon_system e
              LEFT JOIN andon_departments d ON d.id = e.department_id
             WHERE e.state='OPEN'
               AND e.started_at >= (%s::date + TIME '07:00')
               AND e.started_at <  ((%s::date + INTERVAL '1 day') + TIME '06:30')
               {cond.replace('zone', 'e.zone').replace('line', 'e.line')}
        """, [f, t] + args + [f, t] + args)
        rows = cur.fetchall()

    ivals = sorted(((r["s"], r["e"]) for r in rows if r["s"] and r["e"] and r["e"] > r["s"]),
                   key=lambda x: x[0])
    union_sec = 0
    raw_sec = 0
    cur_s = cur_e = None
    for s, e in ivals:
        raw_sec += (e - s).total_seconds()
        if cur_e is None:
            cur_s, cur_e = s, e
        elif s <= cur_e:
            if e > cur_e:
                cur_e = e
        else:
            union_sec += (cur_e - cur_s).total_seconds()
            cur_s, cur_e = s, e
    if cur_e is not None:
        union_sec += (cur_e - cur_s).total_seconds()

    from collections import defaultdict
    buckets = defaultdict(list)
    for r in rows:
        if not (r["s"] and r["e"] and r["e"] > r["s"]):
            continue
        pd = (r["s"] - timedelta(hours=7)).date()
        buckets[(pd, r.get("zone") or "—", r.get("line") or "—")].append(r)

    by_line = []
    for (pd, z, ln), rs in buckets.items():
        p2, tot2 = _preempt_split(rs)
        by_line.append({
            "date": pd.isoformat(), "zone": z, "line": ln,
            "seconds": int(round(tot2)), "calls": len(rs),
            "departments": sorted(
                ({"department": k, "seconds": int(round(v))} for k, v in p2.items()),
                key=lambda x: -x["seconds"]),
        })
    by_line.sort(key=lambda x: (x["date"], x["zone"], x["line"]), reverse=True)
    lines_total = sum(x["seconds"] for x in by_line)

    agg = {}
    for bl in by_line:
        for d in bl["departments"]:
            agg[d["department"]] = agg.get(d["department"], 0) + d["seconds"]
    by_dept = sorted(({"department": k, "seconds": v} for k, v in agg.items()),
                     key=lambda x: -x["seconds"])
    _, split_total = _preempt_split(rows)

    return {"from": f, "to": t,
            "fy": fy or "", "month": month or "", "zone": zone or "", "line": line or "",
            "total_loss_seconds": int(lines_total),
            "union_seconds":      int(round(union_sec)),
            "raw_sum_seconds":    int(round(raw_sec)),
            "calls": len(ivals),
            "by_department": by_dept,
            "by_line": by_line,
            "lines_total_seconds": int(lines_total),
            "split_total_seconds": int(round(split_total))}


@router.get("/dept-history")
def dept_history(department: str,
                 frm: Optional[str] = Query(None, alias="from"),
                 to:  Optional[str] = None,
                 user=Depends(get_current_user)):
    _ensure_tables()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("""SELECT (CASE WHEN NOW()::time >= TIME '07:00' THEN CURRENT_DATE
                                    ELSE CURRENT_DATE - INTERVAL '1 day' END)::date AS d""")
        today_pd = cur.fetchone()["d"].isoformat()
        f = frm or today_pd
        t = to or f
        cur.execute("""
            SELECT h.id, h.zone, h.line, h.display_name,
                   h.started_at, h.ended_at, h.duration_seconds, h.response_seconds
              FROM andon_history h
              LEFT JOIN andon_departments dep ON dep.id = h.department_id
             WHERE LOWER(TRIM(COALESCE(dep.name, h.display_name))) = LOWER(TRIM(%s))
               AND h.started_at >= (%s::date + TIME '07:00')
               AND h.started_at <  ((%s::date + INTERVAL '1 day') + TIME '06:30')
             ORDER BY h.started_at DESC
        """, (department, f, t))
        rows = cur.fetchall()

    dept_l = department.strip().lower()
    show_response = dept_l in ("maintenance", "toolroom", "tool room")
    out = []
    total = 0
    for r in rows:
        st, en = r["started_at"], r["ended_at"]
        dur = r["duration_seconds"] or 0
        total += dur
        out.append({
            "id": r["id"],
            "date":       st.date().isoformat() if st else None,
            "zone":       r["zone"], "line": r["line"],
            "start_time": st.strftime("%H:%M:%S") if st else None,
            "end_time":   en.strftime("%H:%M:%S") if en else None,
            "duration_seconds": dur,
            "response_seconds": r["response_seconds"] if show_response else None,
        })
    return {"department": department, "from": f, "to": t,
            "show_response": show_response,
            "total_loss_seconds": total, "calls": len(out), "rows": out}


class HistoryDeleteIn(BaseModel):
    ids: List[int]


@router.post("/history/delete")
def delete_history(body: HistoryDeleteIn, admin=Depends(require_admin)):
    ids = [int(i) for i in (body.ids or []) if i is not None]
    if not ids:
        raise HTTPException(400, "Koi row select nahi ki")
    if len(ids) > 500:
        raise HTTPException(400, "Ek baar me 500 se zyada nahi")
    _ensure_tables()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("""SELECT h.id, COALESCE(dep.name, h.display_name) AS dept,
                              h.zone, h.line, h.machine_no, h.started_at,
                              h.duration_seconds
                         FROM andon_history h
                         LEFT JOIN andon_departments dep ON dep.id = h.department_id
                        WHERE h.id = ANY(%s)""", (ids,))
        rows = cur.fetchall()
        if not rows:
            raise HTTPException(404, "Ye rows mili hi nahi")
        cur.execute("DELETE FROM andon_history WHERE id = ANY(%s)", (ids,))
        n = cur.rowcount
        try:
            from main import write_audit
            summary = "; ".join(
                f"#{r['id']} {r['dept']} {r['zone']}/{r['line']}/{r['machine_no']} "
                f"{r['started_at']} {r['duration_seconds']}s" for r in rows[:20])
            if len(rows) > 20:
                summary += f" ... (+{len(rows) - 20} aur)"
            write_audit(conn, action="ANDON_HISTORY_DELETE", entity_type="andon_history",
                        entity_id=rows[0]["id"], details=summary, user=admin)
        except Exception as e:
            print(f"[ANDON] history delete ka audit nahi likha: {e}")
        conn.commit()
    return {"ok": True, "deleted": n, "ids": [r["id"] for r in rows]}


@router.get("/history")
def event_history(limit: int = 200, user=Depends(get_current_user)):
    _ensure_tables()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("""SELECT h.id, h.plc_id, d.name AS plc_name, h.do_index, h.department_id,
                              dep.name AS department, h.zone, h.line, h.display_name, h.priority,
                              h.started_at, h.ended_at, h.duration_seconds, h.response_seconds
                         FROM andon_history h
                         LEFT JOIN andon_plc_devices d   ON d.id  = h.plc_id
                         LEFT JOIN andon_departments dep ON dep.id = h.department_id
                        ORDER BY h.ended_at DESC
                        LIMIT %s""", (int(limit),))
        return cur.fetchall()