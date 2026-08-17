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

# Seeded once so a fresh install is usable immediately.  Fixed plant scheme:
#   DO1 Maintenance · DO2 Maintenance ACC · DO3 Toolroom · DO4 Tool ACC ·
#   DO5 Quality · DO6 Material · DO7 Model Setup · DO8 Other Loss
#   — same wiring for every PLC.
_DEFAULT_DEPTS = ["Maintenance", "Toolroom", "Quality", "Material", "Other Loss", "Model Setup"]
# Each real department maps to ONE output; DO2 / DO4 are acknowledgement pulses
# (no department of their own) that only measure response time on DO1 / DO3.
# 2026-08-10 — DO8 "Model Setup" jodi: kaam DO6/DO7 jaisa (plain toggle, ON→OFF
# se duration/loss; koi ACK/response nahi).
_DEFAULT_OUTPUTS = [
    (1, "Maintenance",     "Maintenance", "Critical"),
    (2, "Maintenance ACC", None,          "Critical"),   # ACK of DO1 → response time
    (3, "Toolroom",        "Toolroom",    "High"),
    (4, "Tool ACC",        None,          "High"),        # ACK of DO3 → response time
    (5, "Quality",         "Quality",     "Normal"),
    (6, "Material",        "Material",    "Normal"),
    (7, "Model Setup",     "Model Setup", "Normal"),
    (8, "Other Loss",      "Other Loss",  "Normal"),
]

# DO2 / DO4 acknowledge DO1 / DO3: their ON edge stamps the parent call's
# response time (call-ON → ACK-ON) and nothing else — no duration of their own.
_ACK_OF = {2: 1, 4: 3}


# ── PLC connectivity status ──────────────────────────────────────────
# Live green/red per device, maintained by the PLC poller (_plc_poll_loop):
# a successful connect+read marks it online, a failed one offline.  Cached
# here so the list endpoint reads it instantly (no per-request network probe).
_PLC_STATUS = {}          # {plc_id: {"online": bool|None, "last_seen": iso|None, "checked": iso}}


def _shift_for_time(dt):
    """Plant ka shift rule (user ne diya):
         A  =  subah 07:00  se  shaam 06:00 PM se pehle tak
         B  =  shaam 06:00 PM  se  agli subah 07:00 tak
    User ne A ko 07:00–17:30 aur B ko 18:00–06:30 bataya tha. Beech me do chhote
    gaps reh jaate the (17:30–18:00 aur 06:30–07:00) — unhe nazdeeki shift me
    daal diya hai taaki koi bhi time bina shift ke na rahe."""
    if dt is None:
        return None
    return "A" if 7 <= dt.hour < 18 else "B"


def _hhmm(dt):
    """Slip ke time columns VARCHAR(5) hain -> 'HH:MM'."""
    return dt.strftime("%H:%M") if dt else None


def _mins_between(a, b):
    """a se b tak ke poore MINUTE (HH:MM level par, seconds gira kar).

    Slip par time HH:MM me chhapta hai, isliye minute bhi wahin se ginte hain —
    warna slip khud se ulta padta hai (jaise 09:08 → 09:09 dikhe par 0 min).
    Poore date+time par ghatate hain, to raat 12 baje paar karne par bhi sahi."""
    if not a or not b:
        return None
    d = int((b.replace(second=0, microsecond=0)
             - a.replace(second=0, microsecond=0)).total_seconds() // 60)
    return max(d, 0)


def _is_maintenance(dept):
    """Slip sirf MAINTENANCE ke call ki banti hai (Toolroom/Quality/Material/
    Other Loss ki nahi)."""
    return str(dept or "").strip().lower() == "maintenance"


# ── AUTO slip ka threshold (default 2 min) ───────────────────────────────
# Slip tabhi banti hai jab maintenance call itne minute se ZYADA khuli rahe.
# Config har call par DB se padhna mehnga hai, isliye 10 sec cache rakhte hain.
_THRESH_CACHE = {"min": None, "at": 0.0}


def _slip_threshold_min():
    """maintenance_slip_config se threshold (minute).  Na mile to 2."""
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
    """Call `started` se `upto` tak kam se kam threshold minute khuli rahi?
    upto = abhi ka waqt (chalu call) ya ended_at (band call).  started/upto me
    se koi None ho to False (bina time ke slip ka faisla nahi kar sakte)."""
    if not started or not upto:
        return False
    return (upto - started).total_seconds() >= _slip_threshold_min() * 60


def _slip_fields(zone, line, started, received, ended, dur_seconds=None, model=None):
    """Call ke waqt se slip ke khaane banao.

    machine_no / machine_name JAAN-BUJH KE khali — PLC signal poori LINE par aata hai,
    kisi ek machine par nahi, to kaunsi machine kharab hui ye ANDON nahi jaanta.
    Maintenance Fill Slip me us line ki machines me se khud chunta hai.
    """
    resp_min = _mins_between(started, received)
    down_min = _mins_between(started, ended)
    if down_min is None and dur_seconds is not None:
        down_min = int(round(dur_seconds / 60.0))          # fallback
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
        "model_no": model or None,          # Assign→Model se abhi ka model (PLC value match)
        "problem_related_to": "maintenance",
    }


def _slip_insert(conn, event_id, flat, power_cut=False):
    """Slip daalo aur use call se JOD do (`andon_event_id`).

    `ON CONFLICT DO NOTHING` + unique index = ek call ki EK hi slip.  PLC event
    dobara bheje, ACK do baar dabe, ya ack aur close ki race ho — duplicate slip
    kabhi nahi banegi.  Return: nayi slip ka id, ya None (pehle se thi)."""
    from routers.breakdown_slips import _COLS, _blank_to_none, AUTO_SLIP_TABLE
    cols = list(_COLS) + ["andon_event_id", "power_cut"]
    vals = [_blank_to_none(flat.get(c)) for c in _COLS] + [event_id, bool(power_cut)]
    ph = ", ".join(["%s"] * len(cols))
    cur = conn.cursor()
    cur.execute(
        f"INSERT INTO {AUTO_SLIP_TABLE} ({', '.join(cols)}) VALUES ({ph}) "
        f"ON CONFLICT (andon_event_id) WHERE andon_event_id IS NOT NULL "
        f"DO NOTHING RETURNING id", vals)
    row = cur.fetchone()
    return row[0] if row else None


def auto_slip_on_ack(event_id):
    """ACK aate hi — yani RESPONSE TIME milte hi — slip bana do.

    Pehle slip call BAND hone par banti thi.  Ab acknowledge hote hi ban jaati
    hai, isliye:
      • maintenance ko slip turant dikh jaati hai (call chalu rehte hue bhi)
      • beech me bijli chali jaye to bhi slip bach jaati hai
    OK-time / down-time baad me `auto_slip_on_close()` bhar deta hai.

    Best-effort: koi dikkat aaye to sirf log — ANDON ka data kabhi nahi rukta.
    """
    try:
        from routers.breakdown_slips import _ensure_table
        _ensure_table()
        with get_conn() as conn:
            cur = dict_cursor(conn)
            # Threshold gate SQL me hi — `long_enough` = call threshold se
            # zyada khuli rahi?  Ye check DB ki NOW() se hota hai (na ki app
            # ki local clock se), kyunki started_at bhi DB ki clock se bani
            # thi — dono ek hi ghadi, to app aur DB server ki clock me farak
            # ho to bhi hisaab sahi rehta hai.
            cur.execute("""
                SELECT e.id, e.zone, e.line, e.started_at, e.acknowledged_at,
                       COALESCE(dep.name, e.display_name) AS dept,
                       (e.started_at <= NOW() - (%s * INTERVAL '1 minute')) AS long_enough
                  FROM andon_system e
                  LEFT JOIN andon_departments dep ON dep.id = e.department_id
                 WHERE e.id = %s""", (_slip_threshold_min(), event_id))
            e = cur.fetchone()
            if not e or not _is_maintenance(e["dept"]):
                return
            # Call abhi tak threshold se KAM khuli hai to slip nahi banate.
            # Jaise-jaise call khuli rahegi, poller ka sweep use threshold paar
            # karte hi bana dega (ya close par, agar tab tak duration paar kar
            # chuki ho).  ACK ka waqt andon_system me save ho chuka hai — slip
            # baad me bhi bane to wahi asli response time uthati hai.
            if not e["long_enough"]:
                return
            flat = _slip_fields(e["zone"], e["line"],
                                e["started_at"], e["acknowledged_at"], None)
            new_id = _slip_insert(conn, event_id, flat)
            # Slip pehle se ho sakti hai — sweep ne ACK aane se PEHLE bana di ho
            # (tab response khali thi).  Us haal me ab RESPONSE bhar dete hain.
            # Sirf tab jab abhi khali ho — maintenance ki apni edit ya baad ki
            # koi value overwrite na ho.
            if not new_id:
                from routers.breakdown_slips import AUTO_SLIP_TABLE
                cur2 = conn.cursor()
                cur2.execute(f"""
                    UPDATE {AUTO_SLIP_TABLE}
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
    """Call band hone par USI slip me OK-time / end-date / down-time bhar do.

    Slip na mile to bana do — aisa tab hota hai jab acknowledge aaya hi na ho
    (jaise bijli chali gayi aur call atka hua band hua).  Isse koi breakdown
    bina slip ke nahi rehta.

    `power_cut=True` par slip par nishaan lag jaata hai: call button se band
    nahi hua tha, isliye uska OK-time bharose ke laayak nahi.
    """
    try:
        from routers.breakdown_slips import _ensure_table, AUTO_SLIP_TABLE
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
            if not h or not _is_maintenance(h["dept"]):
                return
            started, ended = h["started_at"], h["ended_at"]
            received = (started + timedelta(seconds=int(h["response_seconds"]))
                        if h["response_seconds"] is not None and started else None)
            flat = _slip_fields(h["zone"], h["line"], started, received, ended,
                                h["duration_seconds"])

            # Pehle jodi hui slip ko poora karo.  Sirf CLOSE wale khaane
            # chhedte hain — start/received/response jo ACK par bhare the wo
            # waise ke waise rehte hain.  Aur agar maintenance ne slip already
            # bhar di ho to bhi ye khaane safe hain (wo alag columns hain).
            cur2 = conn.cursor()
            cur2.execute(f"""
                UPDATE {AUTO_SLIP_TABLE}
                   SET bd_ok_time            = %s,
                       bd_end_date           = %s,
                       mc_down_time_minutes  = %s,
                       power_cut             = %s
                 WHERE andon_event_id = %s""",
                (flat["bd_ok_time"], flat["bd_end_date"],
                 flat["mc_down_time_minutes"], bool(power_cut), event_id))
            if cur2.rowcount:
                print(f"[ANDON-SLIP] call {event_id} band -> slip poori hui "
                      f"(ok {flat['bd_ok_time']}, down {flat['mc_down_time_minutes']} min"
                      f"{', POWER CUT' if power_cut else ''})")
                return
            # Slip thi hi nahi.  Ab banate hain SIRF tab jab poori breakdown
            # threshold se lambi thi — chhoti breakdown (threshold se kam) ki
            # koi slip nahi banti.  (Threshold se lambi thi par slip nahi bani
            # thi, aisa tab hota hai jab ACK aaya hi na ho — jaise bijli chali
            # gayi — ya call sweep se pehle hi band ho gayi.)
            if not _open_long_enough(started, ended):
                return
            new_id = _slip_insert(conn, event_id, flat, power_cut=power_cut)
        if new_id:
            print(f"[ANDON-SLIP] call {event_id} bina acknowledge band hua -> slip #{new_id}"
                  f"{' (POWER CUT)' if power_cut else ''}")
    except Exception as ex:
        print(f"[ANDON-SLIP] close par slip update me dikkat (call {event_id}): {ex}")


def _slip_threshold_sweep():
    """Har khuli MAINTENANCE call jo threshold paar kar chuki hai par jiski abhi
    tak slip nahi bani — uski slip AB bana do.  Isse slip 2-min mark par LIVE
    dikh jaati hai (poller har baar ye chala kar dekhta hai).

    Times asli hi rehte hain: bd_start = call ka started_at, response = ACK ka
    acknowledged_at (agar aa chuka ho, warna khali — baad me ACK par bhar jaata
    hai).  Sirf slip BANANE ka faisla threshold se hota hai, time se nahi.

    Best-effort: koi dikkat aaye to sirf log, ANDON kabhi nahi rukta."""
    try:
        thr = _slip_threshold_min()
        from routers.breakdown_slips import _ensure_table, AUTO_SLIP_TABLE
        _ensure_table()
        with get_conn() as conn:
            cur = dict_cursor(conn)
            # OPEN maintenance call, threshold paar, aur jiski slip abhi nahi hai
            cur.execute(f"""
                SELECT e.id, e.zone, e.line, e.started_at, e.acknowledged_at, e.model
                  FROM andon_system e
                  LEFT JOIN andon_departments dep ON dep.id = e.department_id
                 WHERE e.state = 'OPEN'
                   AND LOWER(TRIM(COALESCE(dep.name, e.display_name))) = 'maintenance'
                   AND e.started_at IS NOT NULL
                   AND e.started_at <= NOW() - (%s * INTERVAL '1 minute')
                   AND NOT EXISTS (
                        SELECT 1 FROM {AUTO_SLIP_TABLE} s
                         WHERE s.andon_event_id = e.id)
            """, (thr,))
            due = cur.fetchall()
            made = 0
            for e in due:
                flat = _slip_fields(e["zone"], e["line"],
                                    e["started_at"], e["acknowledged_at"], None,
                                    model=e.get("model"))
                if _slip_insert(conn, e["id"], flat):
                    made += 1
        if made:
            print(f"[ANDON-SLIP] threshold sweep -> {made} slip bani "
                  f"(call {thr} min se zyada khuli rahi)")
    except Exception as ex:
        print(f"[ANDON-SLIP] threshold sweep me dikkat: {ex}")


# ═══════════════════════════════════════════════════════════════════════
# PLC MODE — ANDON ab ESP ki jagah Mitsubishi PLC se signal leta hai.
# Har ~200ms har enabled PLC ka mapped bit padho: 1 → call ON (timer start),
# 0 → OFF (stop).  Call/timer/history ka poora logic wahi `_apply_state` hai —
# SEQUENCE bilkul same.  PLC connect+read ka code niche isi file me hai (pehle
# routers.plc me tha; PLC Integration feature hatne par yahan aa gaya).
# ═══════════════════════════════════════════════════════════════════════
_PLC_POLL_INTERVAL = 0.1       # 100 ms — near real-time (press karte hi call)
_PLC_RETRY_SECS    = 5         # offline PLC ko itni der baad dobara connect-try
_plc_poller_started = False
_PLC_CONN  = {}                # {dev_id: mc}  MAIN PLC (ANDON bits) persistent connection
_PLC_RETRY = {}                # {dev_id: monotonic ts — is se pehle reconnect na karo}
# ── SUB PLC ── optional doosra PLC jisse Model/Fault register padhe jaate hain
# (ANDON bits MAIN PLC se, Model/Fault SUB PLC se — jab do machine par alag ho).
_SUB_CONN  = {}                # {dev_id: mc}  SUB PLC persistent connection
_SUB_RETRY = {}                # {dev_id: monotonic ts}

# ── PLC connect/read helpers (MC protocol via pymcprotocol).  Pehle routers.plc
# me the; PLC Integration feature hatne par ANDON ne apne me le liye. ────────
BIT_DEVICES = {"X", "Y", "M", "L", "F", "V", "B", "S", "SB", "TS", "CS", "SS"}
_PLCTYPE    = {"Q": "Q", "FX5U": "Q", "iQ-R": "iQ-R", "L": "L", "QnA": "QnA"}


def _is_bit(dtype):
    return (dtype or "").upper() in BIT_DEVICES


def _connect(plc, timer=4):
    """Core connect — mc object return karta hai ya plain exception raise."""
    import pymcprotocol
    plctype = _PLCTYPE.get((plc.get("series") or "Q"), "Q")
    mc = pymcprotocol.Type3E(plctype=plctype)
    mc.timer = timer                        # ~1s units → ~4s timeout
    mc.connect(plc["plc_ip"], int(plc["plc_port"]))
    return mc


def _read_one(mc, dtype, dno):
    head = f"{dtype.upper()}{dno}"
    if _is_bit(dtype):
        return int(mc.batchread_bitunits(headdevice=head, readsize=1)[0])
    return int(mc.batchread_wordunits(headdevice=head, readsize=1)[0])


def _reachable(ip, port, timeout=1.5):
    """Fast TCP probe — PLC ka port pahunch me hai ya nahi (connected indicator)."""
    try:
        s = socket.create_connection((ip, int(port)), timeout=timeout)
        s.close()
        return True
    except Exception:
        return False


def _plc_drop(dev_id):
    # MAIN + SUB dono connection band karo
    for _pool in (_PLC_CONN, _SUB_CONN):
        mc = _pool.pop(dev_id, None)
        if mc is not None:
            try: mc.close()
            except Exception: pass


def _ensure_conn(pool, retry, key, ip, port, series):
    """Persistent MC connection (ya None) — backoff + fast reachability probe.
    MAIN aur SUB PLC dono isi se connect hote hain (alag pool/retry dicts se)."""
    mc = pool.get(key)
    if mc is not None:
        return mc
    if _time.monotonic() < retry.get(key, 0):            # backoff — abhi try mat karo
        return None
    p = int(port or 5007)
    if not _reachable(ip, p, timeout=0.4):               # 4s block se bacho
        retry[key] = _time.monotonic() + _PLC_RETRY_SECS
        return None
    try:
        mc = _connect({"series": series or "Q", "plc_ip": ip, "plc_port": p})
        pool[key] = mc
        retry.pop(key, None)
        return mc
    except Exception:
        retry[key] = _time.monotonic() + _PLC_RETRY_SECS
        return None


def _read_map_name(mc, plc_id, cur, table, name_col):
    """Kisi map-table (model/fault) ke register(s) ko live padho; jis row ki value
    match kare uska naam.  Match na ho / map khali ho to None.  (Assign → Model/Fault.)"""
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


def _plc_poll_once(dev):
    """Ek PLC cycle: MAIN se bits (ANDON), SUB (agar ho) se Model/Fault.
    Return (main_ok, sub_ok).  sub_ok = None jab koi SUB PLC set nahi."""
    did = dev["id"]
    has_sub = bool((dev.get("sub_ip") or "").strip())
    mc = _ensure_conn(_PLC_CONN, _PLC_RETRY, did, dev["ip"], dev.get("port") or 5007, dev.get("series") or "Q")
    if mc is None:
        return False, (False if has_sub else None)
    # Model/Fault register kis PLC se — SUB ho to usse, warna MAIN (mc) se.
    sub_mc = _ensure_conn(_SUB_CONN, _SUB_RETRY, did, dev["sub_ip"], dev.get("sub_port") or 5007,
                          dev.get("sub_series") or "Q") if has_sub else None
    read_mc = sub_mc if has_sub else mc
    try:
        # ek hi cycle me: bit-mapping fetch + PLC read + apply (fast cycle)
        closed = []
        with get_conn() as conn:
            cur = dict_cursor(conn)
            cur.execute("""SELECT do_index, bit_type, bit_no FROM andon_plc_output_mapping
                            WHERE plc_id=%s AND COALESCE(bit_type,'')<>'' AND COALESCE(bit_no,'')<>''
                            ORDER BY do_index""", (did,))
            bits = [(b, _read_one(mc, b["bit_type"], b["bit_no"])) for b in cur.fetchall()]
            # koi call ON ho to abhi ka model + fault bhi padho (read_mc = SUB ya MAIN).
            # read_mc None ho (SUB offline) to model/fault skip — call phir bhi chale.
            # ISOLATED: model/fault read fail ho (SUB glitch/register error) to bhi
            # neeche ka open/close loop KABHI block na ho — warna ek bit ON rehte hue
            # doosri bit 0 hoti to read-error uski close ko rok deta = GHOST timer.
            any_on = any(v != 0 for _, v in bits)
            model = fault = None
            if any_on and read_mc:
                try:
                    model = _read_map_name(read_mc, did, cur, "andon_model_map", "model_name")
                    fault = _read_map_name(read_mc, did, cur, "andon_fault_map", "fault_name")
                except Exception:
                    model = fault = None                 # enrichment optional
            for b, val in bits:
                res = _apply_state(cur, dev, b["do_index"], val != 0, model=model, fault=fault)  # 1→ON, 0→OFF
                if res and res.get("action") == "closed":            # call band -> slip poori karni hai
                    closed.append((res.get("event_id"), res.get("history_id")))
            conn.commit()
        # commit ke BAAD (andon_history ab doosri connection ko dikhega) — har band
        # hui MAINTENANCE call ki slip me bd_ok_time / end-date / down-time bhar do.
        # (auto_slip_on_close pehle kahin call hi nahi hota tha -> OK-time khali reh
        #  jaata tha; ab close par ye chalega.)
        for _eid, _hid in closed:
            if _eid and _hid:
                try: auto_slip_on_close(_eid, _hid)
                except Exception as _e: print(f"[ANDON-SLIP] close-fill dikkat (call {_eid}): {_e}")
        return True, (bool(sub_mc) if has_sub else None)
    except Exception:
        _plc_drop(did)                                        # MAIN+SUB reconnect
        _PLC_RETRY[did] = _time.monotonic() + 1
        return False, (False if has_sub else None)


def _stale_call_sweep():
    """Force-close an OPEN call ONLY when the PLC can NEVER read its bit=0 again:
      • PLC delete ho gaya (ab kabhi poll nahi hoga),
      • PLC disabled kar diya (Enabled off).
    PLC sirf OFFLINE (connection toota) ho to yahan band NAHI karte — call ka
    timer chalta rehta hai; jab PLC wapas aata hai to normal poll uska bit padhta
    hai: 0 → close, 1 → continue (kabhi 0 se restart nahi).  (Pehle yahan 180s
    grace ke baad offline call band kar dete the — us se genuine lambe outage me
    call galti se band ho jaati thi; requirement ye hai ki timer chale.)
    Deleted/disabled case me OPEN row normal path se kabhi close nahi hoti, isliye
    yahan zabardasti band karte hain — history + duration + slip OK-time ke saath."""
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
                # PLC sirf OFFLINE (connection toota) ho to call band NAHI karte —
                # timer chalta rehta hai; reconnect par normal poll bit padhta hai
                # (0 → close, 1 → continue).  Isse lambe outage me galat close aur
                # 0-se-restart dono nahi hote (yahi asli requirement hai).
                if not reason:
                    continue
                cur.execute("SELECT do_index FROM andon_system WHERE plc_id=%s AND state='OPEN'", (pid,))
                for r in cur.fetchall():
                    res = _apply_state(cur, {"id": pid}, r["do_index"], False)
                    if res and res.get("action") == "closed":
                        closed.append((res.get("event_id"), res.get("history_id"), reason))
            conn.commit()
        for eid, hid, reason in closed:
            print(f"[ANDON] ghost call {eid} auto-closed ({reason}) -> timer band")
            if eid and hid:
                try: auto_slip_on_close(eid, hid)
                except Exception as e: print(f"[ANDON-SLIP] ghost close-fill (call {eid}): {e}")
    except Exception as e:
        print(f"[ANDON] stale-call sweep dikkat: {e}")


def _plc_poll_loop():
    n = 0
    while True:
        try:
            _ensure_tables()          # schema (series/bit columns) ready — boot ordering fix
            with get_conn() as conn:
                cur = dict_cursor(conn)
                cur.execute("""SELECT id, zone, line, machine_no, machine_name,
                                      ip, port, series, sub_ip, sub_port, sub_series, enabled
                                 FROM andon_plc_devices""")
                devs = cur.fetchall()
            now = datetime.now().isoformat(timespec="seconds")
            ids = set()
            for dev in devs:
                ids.add(dev["id"])
                prev = _PLC_STATUS.get(dev["id"], {})
                if not dev.get("enabled"):
                    _PLC_STATUS[dev["id"]] = {"online": None, "sub_online": None, "checked": now, "last_seen": prev.get("last_seen")}
                    _plc_drop(dev["id"])
                    continue
                ok, sub_ok = _plc_poll_once(dev)
                _st = {"online": ok, "sub_online": sub_ok, "checked": now,
                       "last_seen": now if ok else prev.get("last_seen")}
                # offline hone ka pehla waqt yaad rakho — stale-call sweep grace ke liye
                if not ok:
                    _st["offline_since"] = prev.get("offline_since") or now
                _PLC_STATUS[dev["id"]] = _st
            for k in list(_PLC_CONN.keys()):        # deleted PLC → connection band
                if k not in ids: _plc_drop(k)
            for k in list(_PLC_STATUS.keys()):
                if k not in ids: _PLC_STATUS.pop(k, None)
        except Exception as e:
            print(f"[ANDON-PLC-POLL] {e}")
        n += 1
        if n % 60 == 0:                             # ~6s: ghost open call (offline/disabled/deleted PLC) band karo
            try: _stale_call_sweep()                 # slip sweep ab ALAG dedicated thread me (poll-blocking se free)
            except Exception as e: print(f"[ANDON] stale-sweep {e}")
        _time.sleep(_PLC_POLL_INTERVAL)


def _slip_sweep_loop():
    """DEDICATED thread — har 1s me threshold-sweep, taaki auto-slip threshold PAAR
    karte hi (~1s me) ban jaaye.  Poll loop ke andar chalane se offline PLC ki
    connection-attempt cadence isko slow kar deti thi (slip 3-4s late banti thi)."""
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
    threading.Thread(target=_andon_output_loop, daemon=True, name="andon-output-writer").start()


def start_workers():
    """PLC bit-poller — ANDON ka signal source.  (ESP raw-TCP ingest retire ho
    chuka hai.)  Idempotent + DB-independent (boot par safe).

    Set ANDON_POLL_ENABLED=0 in .env to SKIP the poller.  A dev machine that
    shares the production DB (192.168.30.15) + sits on the plant network can
    otherwise reach the SAME PLCs and write the SAME andon_system table as the
    production backend — two pollers then fight over the PLC's single MC
    connection (read fails read as bit-0 → call closes → next read bit-1 →
    reopens = the call keeps restarting) and deadlock on andon_system.  So dev
    runs the API without the poller; only ONE backend (production) should poll.
    """
    if os.getenv("ANDON_POLL_ENABLED", "1").strip().lower() in ("0", "false", "no", "off"):
        print("[ANDON] poller DISABLED (ANDON_POLL_ENABLED=0) — not polling the PLC")
        return
    _start_plc_poller()


# ════════════════════════════════════════════════════════════════════
#  CALL → PLC OUTPUT  (SEPARATE config)
#  Mirror each department's LIVE andon call onto a bit of an OUTPUT PLC:
#  bit ON while the call is active, OFF when it ends.  Maintenance / Tool
#  Room turn OFF as soon as the call is ACKNOWLEDGED (response received);
#  every other department stays ON until the call actually ends.
#  This WRITES to a PLC, so it runs ONLY where the poller runs
#  (start_workers → ANDON_POLL_ENABLED); a dev box never writes.
# ════════════════════════════════════════════════════════════════════
_OUT_CONN   = {}     # {(ip,port): mc}   persistent WRITE connections (separate pool)
_OUT_RETRY  = {}     # {(ip,port): monotonic ts}
_OUT_STATE  = {}     # {mapping_id: {ip,port,series,bit_type,bit_no,on,online,checked}}
# departments that have an ACK output (DO2/DO4) → bit off on RESPONSE, not on end.
_ACK_DEPTS  = {"maintenance", "tool room", "toolroom"}
_OUT_ENSURED = False


def _dept_off_on_ack(dept):
    return (dept or "").strip().lower() in _ACK_DEPTS


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
        conn.commit()
    _OUT_ENSURED = True


def _out_write_bit(ip, port, series, bit_type, bit_no, value):
    """Write ONE bit to an output PLC (persistent connection + backoff).
    Pure MC bit-WRITE, separate pool from the ANDON read poller.  True on ok."""
    key = (ip, int(port or 5007))
    mc = _OUT_CONN.get(key)
    if mc is None:
        if _time.monotonic() < _OUT_RETRY.get(key, 0):
            return False
        if not _reachable(ip, key[1], timeout=0.4):
            _OUT_RETRY[key] = _time.monotonic() + _PLC_RETRY_SECS
            return False
        try:
            mc = _connect({"series": series or "Q", "plc_ip": ip, "plc_port": key[1]})
            _OUT_CONN[key] = mc
            _OUT_RETRY.pop(key, None)
        except Exception:
            _OUT_RETRY[key] = _time.monotonic() + _PLC_RETRY_SECS
            return False
    try:
        mc.batchwrite_bitunits(headdevice=f"{(bit_type or '').upper()}{bit_no}",
                               values=[1 if value else 0])
        return True
    except Exception:
        try: mc.close()
        except Exception: pass
        _OUT_CONN.pop(key, None)
        _OUT_RETRY[key] = _time.monotonic() + 1
        return False


def _andon_output_write_once():
    """One cycle: every enabled mapping → decide bit (department call active?) →
    write it.  Mappings that were ON but got disabled/deleted are turned OFF."""
    _ensure_output()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("""SELECT id, department, plc_ip, plc_port, plc_series, bit_type, bit_no
                         FROM andon_call_output WHERE enabled=TRUE""")
        maps = cur.fetchall()
        cur.execute("""SELECT COALESCE(dep.name, e.display_name) AS dept,
                              COUNT(*) FILTER (WHERE e.acknowledged_at IS NULL) AS unacked,
                              COUNT(*) AS total
                         FROM andon_system e
                         LEFT JOIN andon_departments dep ON dep.id = e.department_id
                        WHERE e.state='OPEN' GROUP BY 1""")
        live = {(r["dept"] or "").strip().lower(): r for r in cur.fetchall()}
    enabled_ids = set()
    for m in maps:
        enabled_ids.add(m["id"])
        row = live.get((m["department"] or "").strip().lower())
        if _dept_off_on_ack(m["department"]):
            # Maintenance / Tool Room → ON only while an UN-acknowledged call is
            # open (bit off the moment response arrives).
            want = bool(row and int(row["unacked"] or 0) > 0)
        else:
            # Quality / Material / … → ON while ANY open call exists.
            want = bool(row and int(row["total"] or 0) > 0)
        ok = _out_write_bit(m["plc_ip"], m["plc_port"], m["plc_series"],
                            m["bit_type"], m["bit_no"], want)
        _OUT_STATE[m["id"]] = {"ip": m["plc_ip"], "port": m["plc_port"], "series": m["plc_series"],
                               "bit_type": m["bit_type"], "bit_no": m["bit_no"],
                               "on": want if ok else _OUT_STATE.get(m["id"], {}).get("on"),
                               "online": ok, "checked": datetime.now().isoformat(timespec="seconds")}
    # a mapping that was ON but is no longer enabled/present → force its bit OFF once
    for oid in list(_OUT_STATE.keys()):
        if oid in enabled_ids:
            continue
        st = _OUT_STATE[oid]
        if st.get("on"):
            _out_write_bit(st.get("ip"), st.get("port"), st.get("series"),
                          st.get("bit_type"), st.get("bit_no"), False)
        _OUT_STATE.pop(oid, None)


def _andon_output_loop():
    """DEDICATED thread — mirror ANDON calls onto output PLC bits every ~1s.
    Started only from _start_plc_poller (i.e. only when polling is enabled)."""
    while True:
        try:
            _andon_output_write_once()
        except Exception as e:
            print(f"[ANDON-OUT] {e}")
        _time.sleep(1.0)


class CallOutputIn(BaseModel):
    department: str
    plc_ip: str
    plc_port: Optional[int] = 5007
    plc_series: Optional[str] = "Q"
    bit_type: str
    bit_no: str
    enabled: bool = True


@router.get("/call-outputs")
def list_call_outputs(user=Depends(get_current_user)):
    _ensure_output()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("""SELECT id, department, plc_ip, plc_port, plc_series,
                              bit_type, bit_no, enabled, created_at
                         FROM andon_call_output ORDER BY id""")
        rows = cur.fetchall()
        # live open calls per department (unacked vs total) → DESIRED bit state
        cur.execute("""SELECT COALESCE(dep.name, e.display_name) AS dept,
                              COUNT(*) FILTER (WHERE e.acknowledged_at IS NULL) AS unacked,
                              COUNT(*) AS total
                         FROM andon_system e
                         LEFT JOIN andon_departments dep ON dep.id = e.department_id
                        WHERE e.state='OPEN' GROUP BY 1""")
        live = {(r["dept"] or "").strip().lower(): r for r in cur.fetchall()}
    for r in rows:
        r["off_on_ack"] = _dept_off_on_ack(r["department"])   # response pe off?
        # Bit now = DESIRED state, call ki live state se (call ON → bit ON; off_on_ack
        # dept sirf jab tak UN-acknowledged).  Writer se INDEPENDENT — isliye dev
        # (writer off) par bhi sahi ON/OFF dikhta hai, "—" nahi.
        lc = live.get((r["department"] or "").strip().lower())
        r["bit_on"] = (bool(lc and int(lc["unacked"] or 0) > 0) if r["off_on_ack"]
                       else bool(lc and int(lc["total"] or 0) > 0))
        st = _OUT_STATE.get(r["id"], {})
        r["online"] = st.get("online")    # last write ok/fail (writer)
        # Connection dot: agar writer chal raha (production) to uska write-success
        # hi connected/disconnected batata hai; nahi (dev poller off) to ek quick
        # TCP reachability probe — taaki yahan bhi Connected/Disconnected dikhe.
        reach = st.get("online")
        if reach is None and r.get("plc_ip"):
            reach = _reachable(r["plc_ip"], r.get("plc_port") or 5007, timeout=0.4)
        r["reachable"] = reach
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
                         (department, plc_ip, plc_port, plc_series, bit_type, bit_no, enabled)
                       VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
                    (dept, ip, body.plc_port or 5007, body.plc_series or "Q", bt, bn, bool(body.enabled)))
        new_id = cur.fetchone()[0]; conn.commit()
    return {"id": new_id}


@router.put("/call-outputs/{oid}")
def edit_call_output(oid: int, body: CallOutputIn, user=Depends(get_current_user)):
    _ensure_output()
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("""UPDATE andon_call_output
                          SET department=%s, plc_ip=%s, plc_port=%s, plc_series=%s,
                              bit_type=%s, bit_no=%s, enabled=%s
                        WHERE id=%s""",
                    ((body.department or "").strip(), (body.plc_ip or "").strip(),
                     body.plc_port or 5007, body.plc_series or "Q",
                     (body.bit_type or "").strip().upper(), str(body.bit_no or "").strip(),
                     bool(body.enabled), oid))
        if cur.rowcount == 0:
            raise HTTPException(404, "mapping not found")
        conn.commit()
    # let the writer re-evaluate + turn off the old bit if this got disabled
    return {"ok": True}


@router.delete("/call-outputs/{oid}")
def del_call_output(oid: int, user=Depends(get_current_user)):
    _ensure_output()
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM andon_call_output WHERE id=%s", (oid,))
        conn.commit()
    return {"ok": True}


def _ensure_tables():
    global _ensured
    if _ensured:
        return
    with get_conn() as conn:
        cur = conn.cursor()
        # AUTO breakdown slip ka THRESHOLD — slip tabhi banti hai jab maintenance
        # call itne minute se zyada khuli rahe (chhoti breakdown ki slip nahi).
        # Admin isse ANDON page se badal sakta hai; default 2 minute.
        cur.execute("""
            CREATE TABLE IF NOT EXISTS maintenance_slip_config (
                scope               TEXT PRIMARY KEY DEFAULT 'GLOBAL',
                slip_threshold_min  INTEGER NOT NULL DEFAULT 2,
                updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )""")
        cur.execute("""
            INSERT INTO maintenance_slip_config (scope) VALUES ('GLOBAL')
            ON CONFLICT (scope) DO NOTHING""")
        # "Pending Breakdown" dashboard ke 2 target — yahi (Slip Threshold) page se set.
        cur.execute("ALTER TABLE maintenance_slip_config ADD COLUMN IF NOT EXISTS target_breakdowns INTEGER NOT NULL DEFAULT 10")
        cur.execute("ALTER TABLE maintenance_slip_config ADD COLUMN IF NOT EXISTS target_pending    INTEGER NOT NULL DEFAULT 0")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS andon_departments (
                id         SERIAL PRIMARY KEY,
                name       VARCHAR(120) NOT NULL UNIQUE,
                color      VARCHAR(20)  DEFAULT '#2563eb',
                created_at TIMESTAMP DEFAULT NOW()
            )""")
        # ── MIGRATION: ESP → PLC naming (DATA BACHA KE) — RACE-SAFE ──────
        # Purani install par device/output table + FK column ka naam 'esp' tha,
        # ab 'plc'.  Old hai aur naya nahi → RENAME (data intact); phir neeche
        # ka CREATE IF NOT EXISTS no-op.  Do worker (main.py + poll thread) ek
        # saath boot par migration chala sakte — TOCTOU race me ek RENAME fail
        # ho sakta, isliye try/except me: doosra pehle kar chuka to skip.
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
            conn.rollback()      # doosra worker pehle kar chuka — data safe hai
            print(f"[ANDON] esp->plc migration skip (shayad already done): {_me}")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS andon_plc_devices (
                id          SERIAL PRIMARY KEY,
                name        VARCHAR(160) NOT NULL,
                ip          VARCHAR(60)  NOT NULL,
                port        INTEGER      DEFAULT 80,
                zone         VARCHAR(120),          -- from maintenance_machines master
                line         VARCHAR(120),          -- from maintenance_machines master
                machine_no   VARCHAR(60),           -- from maintenance_machines master
                machine_name VARCHAR(160),          -- auto-filled from machine_no
                description  TEXT,
                enabled      BOOLEAN DEFAULT TRUE,
                poll_path    VARCHAR(120) DEFAULT '/status',
                created_at   TIMESTAMP DEFAULT NOW(),
                updated_at   TIMESTAMP DEFAULT NOW()
            )""")
        # ── EK IP / EK NAAM = EK HI PLC ────────────────────────────────────
        # Aane wala signal device par IP se (phir naam se) bithaya jaata hai.
        # Do device ek hi IP par hon to koi bhi ek utha liya jaata hai — dono
        # board ka data ek hi line par chadh jaata aur kisi ko pata bhi na
        # chalta.  Ye DB-level rule aakhri suraksha hai: API/UI se bache to
        # yahan se nahi bachega.
        # Case/space ka farq na bane isliye LOWER(TRIM(...)) par index hai.
        # Purane data me duplicate ho to index banega nahi — us soorat me
        # backend chalta rahe (bas ek warning), warna app hi na khule.
        for _ix, _expr in (("andon_plc_ip_uq",   "LOWER(TRIM(ip))"),
                           ("andon_plc_name_uq", "LOWER(TRIM(name))")):
            try:
                cur.execute(f"""CREATE UNIQUE INDEX IF NOT EXISTS {_ix}
                                  ON andon_plc_devices (({_expr}))""")
            except Exception as _e:
                conn.rollback()
                print(f"[ANDON] {_ix} nahi ban paya (shayad purana duplicate data hai): {_e}")
        # earlier builds used zone_id/line_id FKs — move to plain master text fields
        cur.execute("ALTER TABLE andon_plc_devices ADD COLUMN IF NOT EXISTS zone VARCHAR(120)")
        cur.execute("ALTER TABLE andon_plc_devices ADD COLUMN IF NOT EXISTS line VARCHAR(120)")
        cur.execute("ALTER TABLE andon_plc_devices ADD COLUMN IF NOT EXISTS machine_no VARCHAR(60)")
        cur.execute("ALTER TABLE andon_plc_devices ADD COLUMN IF NOT EXISTS machine_name VARCHAR(160)")
        # ── PLC mode ── device ab ESP nahi, Mitsubishi PLC hai: `series` (MC-protocol
        # plctype — Q/FX5U/iQ-R/L), IP=PLC IP, port=PLC MC port (default 5007).
        cur.execute("ALTER TABLE andon_plc_devices ADD COLUMN IF NOT EXISTS series VARCHAR(20) DEFAULT 'Q'")
        # ── SUB PLC (optional) ── ANDON bits MAIN PLC se, par Model/Fault register
        # kisi DOOSRE PLC se aa sakte hain (jaise ANDON machine-5 par, Model/Fault
        # machine-8 se).  sub_ip set ho to Model/Fault usi PLC se padhe jaate hain.
        cur.execute("ALTER TABLE andon_plc_devices ADD COLUMN IF NOT EXISTS sub_ip VARCHAR(60)")
        cur.execute("ALTER TABLE andon_plc_devices ADD COLUMN IF NOT EXISTS sub_port INTEGER")
        cur.execute("ALTER TABLE andon_plc_devices ADD COLUMN IF NOT EXISTS sub_series VARCHAR(20)")
        cur.execute("ALTER TABLE andon_plc_devices ADD COLUMN IF NOT EXISTS sub_machine_no VARCHAR(60)")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS andon_plc_output_mapping (
                id            SERIAL PRIMARY KEY,
                plc_id        INTEGER REFERENCES andon_plc_devices(id) ON DELETE CASCADE,  -- NULL = default
                do_index      INTEGER NOT NULL CHECK (do_index BETWEEN 1 AND 8),
                display_name  VARCHAR(160),
                department_id INTEGER REFERENCES andon_departments(id) ON DELETE SET NULL,
                priority      VARCHAR(20) DEFAULT 'Normal',
                enabled       BOOLEAN DEFAULT TRUE,
                UNIQUE (plc_id, do_index)
            )""")
        cur.execute("""CREATE UNIQUE INDEX IF NOT EXISTS andon_output_default_uq
                       ON andon_plc_output_mapping (do_index) WHERE plc_id IS NULL""")
        # ── PLC bit mapping ── har output (do_index) ka PLC bit address:
        # bit_type = M/Y/X/L/D… , bit_no = number.  PLC poll is bit ko padhta hai
        # (1 → call ON/timer start, 0 → OFF/stop).  Per-PLC row me set hota hai.
        cur.execute("ALTER TABLE andon_plc_output_mapping ADD COLUMN IF NOT EXISTS bit_type VARCHAR(4)")
        cur.execute("ALTER TABLE andon_plc_output_mapping ADD COLUMN IF NOT EXISTS bit_no   VARCHAR(20)")
        # ── ASSIGN: per-machine Model & Fault maps ──────────────────────────
        # ANDON "Assign" page se: kisi PLC device/register ki VALUE ko model-naam
        # ya fault-naam se map karo.  device_type=D/M/L…, device_no=address,
        # value=register me jo aaye, model_name/fault_name=us par naam.  Per-PLC.
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
        # ── MIGRATION: andon_events → andon_system ──────────────────────
        # Live-calls table ka naam andon_events tha; ab andon_system hai.
        # Purani install par use RENAME karo (data bacha rahe) — warna neeche
        # ka CREATE IF NOT EXISTS ek naya KHALI andon_system bana deta aur
        # purane chalu calls andon_events me phase reh jaate.
        # Idempotent: dono me se jo bhi haalat ho, sahi natija deta hai.
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
        # call OPEN hote waqt PLC par jo model chal raha tha (model-map se) — slip ke model_no me jaata hai
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
        # earlier builds stored zone_id/line_id (int FKs); the push model records
        # the zone/line NAME instead — add the text columns on old tables.
        for _t in ("andon_system", "andon_history"):
            cur.execute(f"ALTER TABLE {_t} ADD COLUMN IF NOT EXISTS zone VARCHAR(120)")
            cur.execute(f"ALTER TABLE {_t} ADD COLUMN IF NOT EXISTS line VARCHAR(120)")
            cur.execute(f"ALTER TABLE {_t} ADD COLUMN IF NOT EXISTS machine_no VARCHAR(60)")  # device se
            cur.execute(f"ALTER TABLE {_t} ADD COLUMN IF NOT EXISTS model VARCHAR(120)")      # call-open pe capture -> slip model_no
            cur.execute(f"ALTER TABLE {_t} ADD COLUMN IF NOT EXISTS fault VARCHAR(160)")      # Fault History ke liye

        # ── seed defaults ──
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

        # ── one-time upgrade: adopt the fixed DO1..DO7 plant scheme.  Runs once
        # (guarded by 'Other Loss').  Config-only clean rebuild — departments +
        # the default template + any per-PLC overrides — so EVERY PLC uses the
        # single universal scheme the plant standardised on.
        cur.execute("""SELECT COUNT(*) FROM andon_plc_output_mapping
                         WHERE plc_id IS NULL AND display_name='Other Loss'""")
        if (cur.fetchone()[0] or 0) == 0:
            cur.execute("DELETE FROM andon_plc_output_mapping")   # default + per-PLC overrides
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

        # DO6 department is 'Material' (was briefly labelled 'Store').
        # Idempotent self-heal (renames dept + the DO6 label if still 'Store').
        cur.execute("""UPDATE andon_departments SET name='Material' WHERE name='Store'
                        AND NOT EXISTS (SELECT 1 FROM andon_departments WHERE name='Material')""")
        cur.execute("UPDATE andon_plc_output_mapping SET display_name='Material' WHERE display_name='Store'")

        # 2026-08-10 — DO8 "Model Setup" ensure.  Purane installs me DO1-7 the,
        # DO8 nahi tha (seeding sirf khaali table par chalti hai).  Idempotent:
        # department + default DO8 mapping jodo agar nahi hain.  Kaam DO6/DO7
        # jaisa (plain toggle, department call).
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
    start_workers()          # PLC bit-poller


# ════════════════════════════════════════════════════════════════════
#  MASTERS — zone / line come straight from maintenance_machines
# ════════════════════════════════════════════════════════════════════
@router.get("/masters")
def masters(user=Depends(get_current_user)):
    """Distinct zone → lines from the machine master (maintenance_machines), so the PLC
    picker matches every other page in the app."""
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
#  SLIP THRESHOLD  (AUTO breakdown slip tabhi bane jab call itni der khuli rahe)
# ════════════════════════════════════════════════════════════════════
class SlipThresholdIn(BaseModel):
    slip_threshold_min: int
    # "Pending Breakdown" dashboard ke 2 target (None => purana rakho)
    target_breakdowns: Optional[int] = None
    target_pending:    Optional[int] = None


@router.get("/slip-config")
def get_slip_config(user=Depends(get_current_user)):
    """Abhi ka AUTO-slip threshold (minute) + dashboard ke 2 target.  Default 2/10/0."""
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
    """Admin: AUTO-slip threshold (1..60 min) + Pending Breakdown ke 2 target
    (Total Breakdowns / Pending Closures).  Turant lag jaata hai — threshold ka
    cache 10 sec me refresh, target har KPI fetch par seedha DB se padha jaata hai."""
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
    _THRESH_CACHE["min"] = mins        # cache turant update
    _THRESH_CACHE["at"]  = _time.time()
    return {"slip_threshold_min": int(row["slip_threshold_min"]),
            "target_breakdowns":  int(row["target_breakdowns"]),
            "target_pending":     int(row["target_pending"])}


# ════════════════════════════════════════════════════════════════════
#  DEPARTMENTS  (editable list — outputs & time-calc key off these)
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
#  PLC DEVICES  (name · ip · port · zone · line — zone/line from master)
# ════════════════════════════════════════════════════════════════════
class PlcIn(BaseModel):
    name: str
    ip: str
    port: Optional[int] = 5007          # PLC MC-protocol port
    series: Optional[str] = "Q"         # Q / FX5U / iQ-R / L
    zone: Optional[str] = ""
    line: Optional[str] = ""
    machine_no: Optional[str] = ""
    machine_name: Optional[str] = ""
    description: Optional[str] = ""
    enabled: bool = True
    poll_path: Optional[str] = "/status"
    # optional SUB PLC — Model/Fault register isi se padhe jaate hain (ANDON MAIN se).
    # sub_ip khali => koi sub nahi (Model/Fault MAIN PLC se aayenge).
    sub_ip: Optional[str] = ""
    sub_port: Optional[int] = 5007
    sub_series: Optional[str] = "Q"
    sub_machine_no: Optional[str] = ""


@router.get("/plc-devices")
def list_plc(user=Depends(get_current_user)):
    _ensure_tables()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("""SELECT id, name, ip, port, series, zone, line, machine_no, machine_name,
                              sub_ip, sub_port, sub_series, sub_machine_no,
                              description, enabled, poll_path
                         FROM andon_plc_devices ORDER BY name""")
        rows = cur.fetchall()
    # merge live connectivity (green/red) from the background poller.  On a box
    # whose poller is OFF (ANDON_POLL_ENABLED=0 — e.g. a dev machine), _PLC_STATUS
    # is empty so `online` stays None and the UI is stuck on "Checking…".  Fall
    # back to a quick TCP reachability probe so the Config page still shows
    # connected/disconnected.  A raw connect+close is NOT an MC poll — it never
    # reads bits / opens-closes calls, so it cannot cause the call flap.
    for r in rows:
        st = _PLC_STATUS.get(r["id"], {})
        online = st.get("online")
        if online is None and r.get("enabled") and r.get("ip"):
            online = _reachable(r["ip"], r.get("port") or 5007, timeout=0.4)
        r["online"] = online                      # True=connected · False=disconnected · None=disabled/unknown
        sub_online = st.get("sub_online")
        if sub_online is None and (r.get("sub_ip") or "").strip():
            sub_online = _reachable(r["sub_ip"], r.get("sub_port") or 5007, timeout=0.4)
        r["sub_online"] = sub_online               # None = koi sub PLC nahi
        r["last_seen"] = st.get("last_seen")
        r["checked"] = st.get("checked")
    return rows


@router.get("/plc-status")
def plc_status(user=Depends(get_current_user)):
    """Live connectivity of every PLC — {plc_id: {online, last_seen, checked}}."""
    _ensure_tables()
    return _PLC_STATUS


def _check_plc_unique(cur, ip, name, skip_id=None):
    """Ek IP / ek naam par do PLC na ban sakein.

    Signal device par IP se bithaya jaata hai — do board ek hi IP par hon to
    dono ka data ek hi line par chadh jayega aur kisi ko pata bhi nahi
    chalega.  Isliye save se PEHLE rok dete hain, aur message me saaf batate
    hain ki wo IP kis PLC ki hai (zone/line ke saath) — taaki galti turant
    samajh aaye.  `skip_id` = edit karte waqt khud ko chhod do.
    Compare case/space-safe hai (' 192.168.30.77 ' bhi wahi maana jayega).
    """
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
                f"Ek {label} sirf EK hi PLC ko de sakte hain — "
                f"{'doosra IP dijiye' if field == 'ip' else 'doosra naam dijiye'}.")


@router.post("/plc-devices", status_code=201)
def add_plc(body: PlcIn, user=Depends(get_current_user)):
    _ensure_tables()
    if not (body.name or "").strip() or not (body.ip or "").strip():
        raise HTTPException(400, "name and ip are required")
    with get_conn() as conn:
        cur = conn.cursor()
        _check_plc_unique(cur, body.ip, body.name)
        cur.execute("""INSERT INTO andon_plc_devices
                       (name, ip, port, series, zone, line, machine_no, machine_name, description, enabled, poll_path,
                        sub_ip, sub_port, sub_series, sub_machine_no)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s, %s,%s,%s,%s) RETURNING id""",
                    (body.name.strip(), body.ip.strip(), body.port or 5007, (body.series or "Q").strip() or "Q",
                     (body.zone or "").strip() or None, (body.line or "").strip() or None,
                     (body.machine_no or "").strip() or None, (body.machine_name or "").strip() or None,
                     body.description or "", body.enabled, (body.poll_path or "/status").strip(),
                     (body.sub_ip or "").strip() or None, int(body.sub_port or 5007),
                     (body.sub_series or "Q").strip() or "Q", (body.sub_machine_no or "").strip() or None))
        new_id = cur.fetchone()[0]; conn.commit()
    return {"id": new_id}


@router.put("/plc-devices/{eid}")
def edit_plc(eid: int, body: PlcIn, user=Depends(get_current_user)):
    _ensure_tables()
    if not (body.name or "").strip() or not (body.ip or "").strip():
        raise HTTPException(400, "name and ip are required")
    with get_conn() as conn:
        cur = conn.cursor()
        # Edit me bhi wahi rok — apne aap ko chhod kar (skip_id=eid)
        _check_plc_unique(cur, body.ip, body.name, skip_id=eid)
        cur.execute("""UPDATE andon_plc_devices
                          SET name=%s, ip=%s, port=%s, series=%s, zone=%s, line=%s, machine_no=%s, machine_name=%s,
                              description=%s, enabled=%s, poll_path=%s,
                              sub_ip=%s, sub_port=%s, sub_series=%s, sub_machine_no=%s, updated_at=NOW()
                        WHERE id=%s""",
                    (body.name.strip(), body.ip.strip(), body.port or 5007, (body.series or "Q").strip() or "Q",
                     (body.zone or "").strip() or None, (body.line or "").strip() or None,
                     (body.machine_no or "").strip() or None, (body.machine_name or "").strip() or None,
                     body.description or "", body.enabled, (body.poll_path or "/status").strip(),
                     (body.sub_ip or "").strip() or None, int(body.sub_port or 5007),
                     (body.sub_series or "Q").strip() or "Q", (body.sub_machine_no or "").strip() or None, eid))
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
#  OUTPUT MAPPING (DO1–DO8 → department)
# ════════════════════════════════════════════════════════════════════
class OutRow(BaseModel):
    do_index: int
    display_name: Optional[str] = ""
    department_id: Optional[int] = None
    priority: Optional[str] = "Normal"
    enabled: bool = True
    bit_type: Optional[str] = ""       # PLC bit device — M/Y/X/L/D…
    bit_no: Optional[str] = ""         # PLC bit number/address


class OutSave(BaseModel):
    rows: List[OutRow]


@router.get("/outputs/default")
def get_default_outputs(user=Depends(get_current_user)):
    """The default output rows — one per department, in DO order (not padded)."""
    _ensure_tables()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("""SELECT do_index, display_name, department_id, priority, enabled
                         FROM andon_plc_output_mapping WHERE plc_id IS NULL ORDER BY do_index""")
        return cur.fetchall()


@router.get("/plc-devices/{eid}/outputs")
def get_plc_outputs(eid: int, user=Depends(get_current_user)):
    """This PLC's output rows — its own overrides if any, else the default set."""
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
    """Keep only do_index 1–8, and reject a department mapped to two outputs."""
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
    """Replace ALL rows for a target (default = plc_id None, or a specific PLC) —
    so adding / removing an output just works."""
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
    """Replace the shared default output template (one row per department)."""
    _ensure_tables()
    _replace_outputs(None, body.rows)
    return {"ok": True}


@router.put("/plc-devices/{eid}/outputs")
def save_plc_outputs(eid: int, body: OutSave, user=Depends(get_current_user)):
    """Replace this PLC's output overrides."""
    _ensure_tables()
    _replace_outputs(eid, body.rows)
    return {"ok": True}


# ── ASSIGN: per-machine Model & Fault value→name maps ──────────────────
#  Assign page (per PLC device) me do lists: register-VALUE → model naam,
#  aur register-VALUE → fault naam.  Dono ka shape same, isliye ek helper.
class MapRow(BaseModel):
    device_type: Optional[str] = ""
    device_no:   Optional[str] = ""
    value:       Optional[int] = None
    name:        Optional[str] = ""      # model_name ya fault_name


class MapSave(BaseModel):
    rows: List[MapRow] = []


def _get_map(table, name_col, eid):
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute(f"""SELECT device_type, device_no, value, {name_col} AS name
                          FROM {table} WHERE plc_id=%s ORDER BY id""", (eid,))
        return cur.fetchall()


def _save_map(table, name_col, eid, rows):
    """Replace-all: is PLC ki poori list nayi se likho (khali rows chhod ke)."""
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute(f"DELETE FROM {table} WHERE plc_id=%s", (eid,))
        for r in rows:
            dt = (r.device_type or "").strip().upper() or None
            dn = (r.device_no or "").strip() or None
            nm = (r.name or "").strip() or None
            if dt is None and dn is None and r.value is None and nm is None:
                continue                                  # poori khali row skip
            cur.execute(f"""INSERT INTO {table} (plc_id, device_type, device_no, value, {name_col})
                            VALUES (%s,%s,%s,%s,%s)""", (eid, dt, dn, r.value, nm))
        conn.commit()


@router.get("/plc-devices/{eid}/models")
def get_plc_models(eid: int, user=Depends(get_current_user)):
    """This PLC's value→model map (Assign → Model tab)."""
    _ensure_tables()
    return _get_map("andon_model_map", "model_name", eid)


@router.put("/plc-devices/{eid}/models")
def save_plc_models(eid: int, body: MapSave, user=Depends(get_current_user)):
    _ensure_tables()
    _save_map("andon_model_map", "model_name", eid, body.rows)
    return {"ok": True}


@router.get("/plc-devices/{eid}/faults")
def get_plc_faults(eid: int, user=Depends(get_current_user)):
    """This PLC's value→fault map (Assign → Fault tab)."""
    _ensure_tables()
    return _get_map("andon_fault_map", "fault_name", eid)


@router.put("/plc-devices/{eid}/faults")
def save_plc_faults(eid: int, body: MapSave, user=Depends(get_current_user)):
    _ensure_tables()
    _save_map("andon_fault_map", "fault_name", eid, body.rows)
    return {"ok": True}


# ── FAULT HISTORY — kaunsa fault kitni baar (zone/line/machine/fault group + count) ──
def _fy_range(fy):
    """'2026-27' -> (Apr 1 us saal, agla Apr 1) — FY ka date range."""
    try:
        y = int(str(fy).split("-")[0])
        return (f"{y}-04-01", f"{y + 1}-04-01")
    except Exception:
        return None


@router.get("/fault-history")
def fault_history(fy: str = "", month: str = "", date: str = "",
                  zone: str = "", line: str = "", machine_no: str = "", fault: str = "",
                  user=Depends(get_current_user)):
    """Zone/Line/Machine/Fault ke hisaab se fault count — history (band call) + abhi ke
    live OPEN call, dono.  Filters: fy(2026-27) · month(YYYY-MM) · date(YYYY-MM-DD) ·
    zone · line · machine_no · fault.  Sab optional, AND me lagte hain."""
    _ensure_tables()
    # SIRF define kiye hue fault dikhte hain — jinka fault khali/NULL hai (abhi tak
    # fault-map define nahi hua) wo count me aate hi nahi.
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
#  CALL LIFECYCLE  (the PLC poll applies each output's ON/OFF here)
# ════════════════════════════════════════════════════════════════════
#  The PLC bit is the source of truth for output state.  The poller reads every
#  mapped bit and hands it to _apply_state:
#     1 (ON)  →  open a call in andon_system (timer starts)
#     0 (OFF) →  close it → move to andon_history with the elapsed duration
#  DO2 / DO4 are ACK pulses that stamp the parent call's response time.


def _resolve_output(cur, plc_id, do_index):
    """Output ka (name, dept, priority).  Per-PLC row pehle, phir shared default.
    Per-PLC row me department/name/priority MISSING (NULL) ho to default (dept
    scheme) se bhar do — taaki user PLC par sirf BIT set kare to bhi call sahi
    department se judi rahe."""
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
    """Open (ON) or close (OFF) the call for one output — idempotent.

    DO2 / DO4 are acknowledgement pulses, not calls of their own:
      • DO2 ON = maintenance responded to the open DO1 call
      • DO4 ON = toolroom     responded to the open DO3 call
    Their ON edge stamps acknowledged_at on the parent call (→ response time =
    call-ON → ACK-ON); they never open an event or accumulate a duration.

    dur_override (seconds): on OFF, use this hardware-measured duration instead
    of the server-computed one — so a call that was closed WHILE the PLC was
    disconnected (event flushed later on reconnect) still gets its true length."""
    if do_index in _ACK_OF:
        if not on:
            return {"do_index": do_index, "action": "ack_off_ignored"}
        parent = _ACK_OF[do_index]
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
        if open_ev:                                   # already open → duplicate ON, ignore
            return {"do_index": do_index, "action": "already_open", "event_id": open_ev["id"]}
        disp, dept_id, prio = _resolve_output(cur, dev["id"], do_index)
        cur.execute("""INSERT INTO andon_system
                         (plc_id, do_index, department_id, zone, line, machine_no, display_name, priority, model, fault, state, started_at)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'OPEN', NOW()) RETURNING id""",
                    (dev["id"], do_index, dept_id, dev.get("zone"), dev.get("line"), dev.get("machine_no"), disp, prio, model, fault))
        return {"do_index": do_index, "action": "opened", "event_id": cur.fetchone()["id"],
                "department_id": dept_id, "display_name": disp}
    # OFF ─────────────────────────────────────────────────────────────
    if not open_ev:                                   # OFF with no open call → nothing to close
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
            # `event_id` = live-call ka id.  Slip isi se judi hoti hai (ACK par
            # ban chuki hoti hai), isliye band hone par usi row me OK-time bhar
            # paate hain — nayi slip nahi banti.
            "event_id": open_ev["id"],
            "history_id": hist["id"], "duration_seconds": hist["duration_seconds"]}


@router.get("/events")
def live_events(user=Depends(get_current_user)):
    """Currently OPEN calls (running timer) — for the live board."""
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
    """Simple ALL-department ANDON monitor page: every OPEN call
    (department / zone / line / running timer), the department list with each
    one's active-call count (for the 6 buttons), and top stats
    (active now · longest active · total today).  Read-only, from andon_system."""
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
    counts, longest = {}, 0
    for r in rows:
        k = (r["department"] or "").strip()
        counts[k] = counts.get(k, 0) + 1
        if (r["elapsed_seconds"] or 0) > longest:
            longest = r["elapsed_seconds"]
    for d in depts:
        d["active"] = counts.get((d["name"] or "").strip(), 0)
    return {"rows": rows, "departments": depts,
            "stats": {"active": len(rows), "longest_seconds": int(longest), "today": today}}


@router.get("/dashboard")
def dashboard_board(user=Depends(get_current_user)):
    """Maintenance Dashboard ke ANDON table ke liye — SIRF abhi chalu calls.

    Dashboard ka live data yahin se aata hai.
    Ab wahi table PLC ke asli ANDON calls dikhata hai. Dikhne ka format wahi
    purana hai, isliye yahan fields bhi wahi naam se bhejte hain jo
    AndonTable.jsx padhta hai:
        serial_in_shift → S.No       zone_name → Zone
        line_name       → Line Name  started_at → Start Time + Duration
    Table me sirf wahi call dikhta hai jo ABHI chal raha hai (button dabaya hua
    hai) — band hote hi row apne aap hat jaati hai, duration live badhta rehta
    hai. Band ho chuke calls Reports/History me dekhe jaate hain, dashboard par
    nahi.

    Return: {"rows": [...], "stats": {active, awaiting, today, longest_seconds}}
    — stats dashboard ke 4 cards ke liye (`today` me band hue bhi ginte hain,
    wo sirf ek ginti hai, table me unki row nahi aati).
    """
    _ensure_tables()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("""
            SELECT e.id, e.plc_id, d.name AS plc_name, e.do_index,
                   dep.name AS department, e.display_name, e.priority,
                   e.zone AS zone_name, e.line AS line_name,
                   e.started_at, NULL::timestamp AS ended_at,
                   NULL::int AS duration_seconds,
                   -- server-computed elapsed (skew-free) — DB clock aur browser
                   -- clock alag ho to bhi duration breakdown START se sahi chale
                   -- (pehle frontend started_at se ginta tha -> DB skew ~1min ka
                   --  delay dikhta tha, threshold ki tarah).
                   EXTRACT(EPOCH FROM (NOW() - e.started_at))::int AS elapsed_seconds,
                   CASE WHEN e.acknowledged_at IS NOT NULL
                        THEN EXTRACT(EPOCH FROM (e.acknowledged_at - e.started_at))::int END
                        AS response_seconds,
                   TRUE AS is_live
              FROM andon_system e
              LEFT JOIN andon_plc_devices d   ON d.id   = e.plc_id
              LEFT JOIN andon_departments dep ON dep.id = e.department_id
             WHERE e.state='OPEN'                 -- SIRF chalu calls (band hue nahi)
               -- Ye panel "MAINTENANCE ANDON" hai -> sirf Maintenance ke call.
               -- Toolroom / Quality / Material / Other Loss yahan nahi aayenge
               -- (wo ANDON System page ke Live Board par dikhte hain).
               -- department mapping na ho to display_name se maan lo.
               AND COALESCE(dep.name, e.display_name) ILIKE 'maintenance'
             ORDER BY e.started_at                 -- sabse purana upar (sabse lamba chal raha)
        """)
        rows = cur.fetchall()

        day_start = (
            "CASE WHEN NOW()::time >= TIME '07:00' "
            "     THEN CURRENT_DATE + TIME '07:00' "
            "     ELSE (CURRENT_DATE - INTERVAL '1 day') + TIME '07:00' END")
        day_end = f"(({day_start}) + INTERVAL '23 hours 30 minutes')"   # agle din 06:30
        cur.execute(f"""
            SELECT
              (SELECT COUNT(*) FROM andon_system WHERE state='OPEN')            AS active,
              (SELECT COUNT(*) FROM andon_system
                 WHERE state='OPEN' AND acknowledged_at IS NULL)                AS awaiting,
              (SELECT COUNT(*) FROM andon_system
                 WHERE started_at >= ({day_start}) AND started_at < {day_end})
            + (SELECT COUNT(*) FROM andon_history
                 WHERE started_at >= ({day_start}) AND started_at < {day_end})  AS today,
              COALESCE((SELECT MAX(EXTRACT(EPOCH FROM (NOW() - started_at))::int)
                          FROM andon_system WHERE state='OPEN'), 0)             AS longest_seconds
        """)
        stats = dict(cur.fetchone() or {})

    # S.No: list me position (PLC data me shift-wise serial hota hi nahi)
    for i, r in enumerate(rows, 1):
        r["serial_in_shift"] = i
    return {"rows": rows, "stats": stats}


@router.get("/today-calls")
def today_calls(frm: Optional[str] = Query(None, alias="from"),
                to:  Optional[str] = None,
                user=Depends(get_current_user)):
    """Dashboard ke "Today" card par click → us plant-day (D 07:00 → D+1 06:30)
    ki SAARI ANDON calls (har department).  Har row: zone, line, department,
    start-time, end-time, total-time (loss seconds).  Band ho chuke (andon_history)
    + abhi chalu (andon_system OPEN, end = abhi) dono.  Newest first.
    `today` stat card wahi window ginta hai, to yahan ki count us card se match
    karti hai.  from/to na do to aaj ka plant-day.
    """
    _ensure_tables()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("""SELECT (CASE WHEN NOW()::time >= TIME '07:00' THEN CURRENT_DATE
                                    ELSE CURRENT_DATE - INTERVAL '1 day' END)::date AS d""")
        today_pd = cur.fetchone()["d"].isoformat()
        f = frm or today_pd
        t = to or f
        # window: from-date 07:00  se  (to-date + 1 din) 06:30
        cur.execute("""
            SELECT h.zone, h.line, COALESCE(dep.name, h.display_name) AS department,
                   h.started_at, h.ended_at, h.duration_seconds, FALSE AS is_live
              FROM andon_history h
              LEFT JOIN andon_departments dep ON dep.id = h.department_id
             WHERE h.started_at >= (%s::date + TIME '07:00')
               AND h.started_at <  ((%s::date + INTERVAL '1 day') + TIME '06:30')
            UNION ALL
            SELECT e.zone, e.line, COALESCE(dep.name, e.display_name) AS department,
                   e.started_at, NULL::timestamp AS ended_at,
                   EXTRACT(EPOCH FROM (NOW() - e.started_at))::int AS duration_seconds,
                   TRUE AS is_live
              FROM andon_system e
              LEFT JOIN andon_departments dep ON dep.id = e.department_id
             WHERE e.state='OPEN'
               AND e.started_at >= (%s::date + TIME '07:00')
               AND e.started_at <  ((%s::date + INTERVAL '1 day') + TIME '06:30')
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
    """Aaj ka (plant-day 7AM → agle din 6:30AM) HAR department ka TOTAL LOSS.

    total_loss_seconds = us department ke aaj ke calls ka poora down-time —
    band ho chuke calls (andon_history.duration_seconds) + abhi chalu calls ka
    ab tak ka elapsed (NOW - started_at).  Response time yahan nahi (user ne
    kaha "respoance rhne dena").  Har department dikhta hai, chahe aaj 0 hi ho.
    """
    _ensure_tables()
    day_start = (
        "(CASE WHEN NOW()::time >= TIME '07:00' "
        "      THEN CURRENT_DATE + TIME '07:00' "
        "      ELSE (CURRENT_DATE - INTERVAL '1 day') + TIME '07:00' END)")
    with get_conn() as conn:
        cur = dict_cursor(conn)
        # band ho chuke (aaj) — poora duration
        cur.execute(f"""
            SELECT COALESCE(dep.name, h.display_name) AS dept,
                   COALESCE(SUM(h.duration_seconds), 0)::int AS secs,
                   COUNT(*) AS calls
              FROM andon_history h
              LEFT JOIN andon_departments dep ON dep.id = h.department_id
             WHERE h.started_at >= {day_start}
             GROUP BY 1""")
        closed = {r["dept"]: r for r in cur.fetchall()}
        # abhi chalu — ab tak ka elapsed
        cur.execute(f"""
            SELECT COALESCE(dep.name, e.display_name) AS dept,
                   COALESCE(SUM(EXTRACT(EPOCH FROM (NOW() - e.started_at)))::int, 0) AS secs,
                   COUNT(*) AS calls
              FROM andon_system e
              LEFT JOIN andon_departments dep ON dep.id = e.department_id
             WHERE e.state = 'OPEN' AND e.started_at >= {day_start}
             GROUP BY 1""")
        openc = {r["dept"]: r for r in cur.fetchall()}
        # saare departments (config wale) — 0 hone par bhi card dikhe
        cur.execute("SELECT name, color FROM andon_departments ORDER BY id")
        depts = cur.fetchall()

    out = []
    for d in depts:
        nm = d["name"]
        c = closed.get(nm, {}); o = openc.get(nm, {})
        out.append({
            "department": nm,
            "color": d["color"],
            # closed_loss_seconds = band ho chuke calls ka total (BADALTA NAHI).
            # Frontend ise base rakh kar chalu calls ka apna smooth timer jod deta
            # hai, taaki card ka number bhi har SECOND ek-ek karke bade (2 sec ke
            # poll par jhatka na lage).  total_loss_seconds sirf fallback ke liye.
            "closed_loss_seconds": int(c.get("secs", 0)),
            "total_loss_seconds":  int(c.get("secs", 0)) + int(o.get("secs", 0)),
            "calls": int(c.get("calls", 0)) + int(o.get("calls", 0)),
        })
    return {"departments": out}


@router.get("/total-loss")
def total_loss(frm: Optional[str] = Query(None, alias="from"),
               to:  Optional[str] = None,
               user=Depends(get_current_user)):
    """LINE ka TOTAL LOSS — jitni der line down rahi (chahe kitne bhi department
    ne button dabaya ho).

    Ahem baat: OVERLAP ek hi baar ginte hain.  Jaise Maintenance 10:00–10:05 aur
    Tool Room 10:03–10:08 dabaye — line 10:00 se 10:08 tak down thi = 8 min
    (5+5=10 NAHI).  Ek waqt par ek hi loss.  Iske liye SAARE calls ke time-window
    ko MERGE (union) karke jodte hain.

    Date plant-day se (D subah 7:00 → agle din 6:30), from/to na do to aaj.
    Band + chalu dono calls ginate hain (chalu ka end = abhi).
    """
    _ensure_tables()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("""SELECT (CASE WHEN NOW()::time >= TIME '07:00' THEN CURRENT_DATE
                                    ELSE CURRENT_DATE - INTERVAL '1 day' END)::date AS d""")
        today_pd = cur.fetchone()["d"].isoformat()
        f = frm or today_pd
        t = to or f
        # window: from-date 07:00 se (to-date + 1 din) 06:30
        cur.execute("""
            SELECT started_at AS s, ended_at AS e FROM andon_history
             WHERE started_at >= (%s::date + TIME '07:00')
               AND started_at <  ((%s::date + INTERVAL '1 day') + TIME '06:30')
               AND ended_at IS NOT NULL
            UNION ALL
            SELECT started_at AS s, NOW()::timestamp AS e FROM andon_system
             WHERE state='OPEN'
               AND started_at >= (%s::date + TIME '07:00')
               AND started_at <  ((%s::date + INTERVAL '1 day') + TIME '06:30')
        """, (f, t, f, t))
        rows = cur.fetchall()

    # intervals ko waqt se sort karke MERGE karo (union) — overlap ek baar
    ivals = sorted(((r["s"], r["e"]) for r in rows if r["s"] and r["e"] and r["e"] > r["s"]),
                   key=lambda x: x[0])
    union_sec = 0
    raw_sec = 0
    cur_s = cur_e = None
    for s, e in ivals:
        raw_sec += (e - s).total_seconds()
        if cur_e is None:
            cur_s, cur_e = s, e
        elif s <= cur_e:                       # overlap ya laga hua → merge
            if e > cur_e:
                cur_e = e
        else:                                  # gap → pichhla band karo
            union_sec += (cur_e - cur_s).total_seconds()
            cur_s, cur_e = s, e
    if cur_e is not None:
        union_sec += (cur_e - cur_s).total_seconds()

    return {"from": f, "to": t,
            "total_loss_seconds": int(round(union_sec)),   # UNION (overlap ek baar) — asli line down time
            "raw_sum_seconds":    int(round(raw_sec)),      # saade jod (overlap do baar) — reference
            "calls": len(ivals)}


@router.get("/dept-history")
def dept_history(department: str,
                 frm: Optional[str] = Query(None, alias="from"),
                 to:  Optional[str] = None,
                 user=Depends(get_current_user)):
    """Ek department ki call HISTORY — card par click karke khulti hai.

    Date PLANT-DAY se: chuni hui date D ka matlab D subah 7:00 se agle din 6:30
    tak (wahi window jo cards use karte hain).  from/to na do to aaj ka plant-day.
    Har row: date, zone, line, start-time, end-time, duration (loss), aur
    response (jo Maintenance/Toolroom me hi aata hai — unhi ke ACK output hote
    hain).  Sirf BAND ho chuke calls (andon_history) — chalu call band hone par
    yahan aayega.
    """
    _ensure_tables()
    # aaj ka plant-day date (agar abhi 7 baje se pehle hai to kal ki date)
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("""SELECT (CASE WHEN NOW()::time >= TIME '07:00' THEN CURRENT_DATE
                                    ELSE CURRENT_DATE - INTERVAL '1 day' END)::date AS d""")
        today_pd = cur.fetchone()["d"].isoformat()
        f = frm or today_pd
        t = to or f
        # window: from-date 07:00  se  (to-date + 1 din) 06:30
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


@router.get("/history")
def event_history(limit: int = 200, user=Depends(get_current_user)):
    """Closed calls (duration / response) — for reports."""
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
