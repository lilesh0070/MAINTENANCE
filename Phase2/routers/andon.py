"""
routers/andon.py
================
Standalone Industrial **ANDON Management** module — configured entirely from the
UI (no source changes to add an ESP or a department).

Design (per requirement):
  • Zone / Line are NOT stored here — they come from the machine master
    (`maintenance_machines`), exactly like every other picker in the app.  An ESP just
    records the zone + line NAME it sits on.
  • Departments are a small editable list (Maintenance / Quality / Production /
    Store …) used by the output mapping; all time calculations are per-department.
  • Each ESP has 8 outputs (DO1–DO8); each output maps to ONE department (plus a
    display name / priority / enable).  A shared default template applies to every
    ESP, and any ESP can override its own outputs.

Tables (prefixed `andon_`):
  andon_departments         id · name · color
  andon_esp_devices         id · name · ip · port · zone · line · enabled · poll_path
  andon_esp_output_mapping  esp_id (NULL = default) · do_index · display_name ·
                            department_id · priority · enabled
  andon_system              live OPEN calls (running timer)
  andon_history             closed calls (duration / response time)

Event model — PUSH, not poll:
  • The ESP itself PUSHES every output change to POST /ingest ("DO3 turned ON",
    then later "DO3 turned OFF").  The server never polls the ESP for output
    state — it only opens a call on ON and closes it (→ history, with duration)
    on OFF.  The background poller does ONE thing: check each ESP is still
    reachable (green/red connectivity), nothing else.

Endpoints (prefix /api/andon)
-----------------------------
GET             /masters                    distinct zone → lines from maintenance_machines
GET/POST/PUT/DELETE  /departments · /esp-devices
GET/PUT         /outputs/default            shared DO1–DO8 template
GET/PUT         /esp-devices/{id}/outputs   this ESP's DO1–DO8 (default-filled)
POST            /ingest                     ESP pushes an output ON/OFF change (no auth — device call)
GET             /events                     live OPEN calls (running timer)
GET             /history                    closed calls (duration / response)
"""
import json
import os
import platform
import socket
import subprocess
import threading
import time as _time
from datetime import datetime, timedelta
from typing import Optional, List, Union, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from database import get_conn, dict_cursor
from auth import get_current_user

router = APIRouter(prefix="/api/andon", tags=["andon"])

_ensured = False

# Seeded once so a fresh install is usable immediately.  Fixed plant scheme:
#   DO1 Maintenance · DO2 Maintenance ACC · DO3 Toolroom · DO4 Tool ACC ·
#   DO5 Quality · DO6 Material · DO7 Other Loss   — same wiring for every ESP.
_DEFAULT_DEPTS = ["Maintenance", "Toolroom", "Quality", "Material", "Other Loss"]
# Each real department maps to ONE output; DO2 / DO4 are acknowledgement pulses
# (no department of their own) that only measure response time on DO1 / DO3.
_DEFAULT_OUTPUTS = [
    (1, "Maintenance",     "Maintenance", "Critical"),
    (2, "Maintenance ACC", None,          "Critical"),   # ACK of DO1 → response time
    (3, "Toolroom",        "Toolroom",    "High"),
    (4, "Tool ACC",        None,          "High"),        # ACK of DO3 → response time
    (5, "Quality",         "Quality",     "Normal"),
    (6, "Material",        "Material",    "Normal"),
    (7, "Other Loss",      "Other Loss",  "Normal"),
]

# DO2 / DO4 acknowledge DO1 / DO3: their ON edge stamps the parent call's
# response time (call-ON → ACK-ON) and nothing else — no duration of their own.
_ACK_OF = {2: 1, 4: 3}


# ── ESP connectivity monitor ─────────────────────────────────────────
# A light background poller: every _CHECK_INTERVAL seconds it TCP-connects to
# each ENABLED ESP's ip:port (short timeout).  Reachable → online (green),
# unreachable → offline (red).  The result is cached in _ESP_STATUS so the UI
# reads it instantly (no per-request network probe).  NOT continuous — one sweep
# per interval — so a disconnect shows up within a few seconds.
_ESP_STATUS = {}          # {esp_id: {"online": bool|None, "last_seen": iso|None, "checked": iso}}
_CHECK_INTERVAL = 12
_poller_started = False


def _tcp_alive(ip, port, timeout=2.0):
    try:
        with socket.create_connection((str(ip), int(port or 80)), timeout=timeout):
            return True
    except Exception:
        return False


def _ping_alive(ip, timeout_ms=1200):
    """ICMP ping — 'is the device on the network', independent of any port."""
    ip = str(ip or "").strip()
    if not ip:
        return False
    is_win = platform.system().lower().startswith("win")
    cmd = (["ping", "-n", "1", "-w", str(int(timeout_ms))] if is_win
           else ["ping", "-c", "1", "-W", str(max(1, int(timeout_ms / 1000)))]) + [ip]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=(timeout_ms / 1000) + 2)
        out = ((r.stdout or "") + (r.stderr or "")).upper()
        # Windows returns exit 0 even for "host unreachable"; a real reply has TTL=
        return ("TTL=" in out) if is_win else (r.returncode == 0)
    except Exception:
        return False


def _esp_reachable(ip, port):
    """Connected = pingable OR the configured port is open (covers both ICMP-
    blocked networks and ping-only devices)."""
    return _ping_alive(ip) or _tcp_alive(ip, port)


def _poll_loop():
    while True:
        try:
            with get_conn() as conn:
                cur = dict_cursor(conn)
                cur.execute("SELECT id, ip, port, enabled FROM andon_esp_devices")
                devs = cur.fetchall()
            now = datetime.now().isoformat(timespec="seconds")
            ids = set()
            for d in devs:
                ids.add(d["id"])
                prev = _ESP_STATUS.get(d["id"], {})
                if not d.get("enabled"):
                    _ESP_STATUS[d["id"]] = {"online": None, "checked": now, "last_seen": prev.get("last_seen")}
                    continue
                ok = _esp_reachable(d["ip"], d["port"])
                _ESP_STATUS[d["id"]] = {"online": ok, "checked": now,
                                        "last_seen": now if ok else prev.get("last_seen")}
            for k in list(_ESP_STATUS.keys()):        # forget deleted ESPs
                if k not in ids:
                    _ESP_STATUS.pop(k, None)
        except Exception as e:
            print(f"[ANDON-POLL] {e}")
        _time.sleep(_CHECK_INTERVAL)


def _start_poller():
    global _poller_started
    if _poller_started:
        return
    _poller_started = True
    threading.Thread(target=_poll_loop, daemon=True, name="andon-esp-poller").start()


# ── ESP raw-TCP ingest (the ESP32 firmware's NATIVE protocol) ────────
# The ESP does NOT speak HTTP.  It opens a raw TCP connection to this server's
# ANDON_TCP_PORT and streams newline-delimited JSON:
#   hello : {"type":"hello","id":"ESP-01","zone":..,"line":..,"ip":..}
#   event : {"seq":N,"id":"ESP-01","ch":1,"event":"ON","t_ms":..}
#           {"seq":N,...,"event":"OFF","on_ms":..,"on_s":..}
#           {"seq":N,...,"ch":2,"event":"ACK","of":1}
# For EVERY event (it carries a seq) the server must reply {"ack":N}\n or the
# ESP resends — so nothing is lost across a reconnect.  We ack only AFTER the
# event is persisted (transient DB error → no ack → the ESP resends later).
# ch == DO index (1..8): ON opens a call, OFF closes it (duration), ACK (ch2→
# of1, ch4→of3) stamps the parent call's response time — the SAME lifecycle
# _apply_state already implements for the HTTP /ingest path.
_ANDON_TCP_PORT = int(os.getenv("ANDON_TCP_PORT", "9000") or 9000)
_tcp_started = False


def _tcp_apply_event(ip, device_id, obj):
    """Persist one ESP event.  Returns True if handled (→ ack it), False on a
    transient error (do NOT ack → the ESP will resend)."""
    ev = obj.get("event")
    ch = obj.get("ch")
    if not ev or ch is None:
        return True
    try:
        ch = int(ch)
    except (TypeError, ValueError):
        return True
    if not (1 <= ch <= 8):
        return True
    try:
        with get_conn() as conn:
            cur = dict_cursor(conn)
            esp = _find_esp(cur, None, ip, device_id)
            if not esp:
                print(f"[ANDON-TCP] unknown ESP ip={ip} id={device_id} — add it in ANDON config")
                return True                      # can't map — ack anyway (avoid a resend storm)
            res = None
            if ev == "ON":
                _apply_state(cur, esp, ch, True)
            elif ev == "OFF":
                dur = obj.get("on_s")            # ESP's hardware-measured ON duration
                if dur is None and obj.get("on_ms") is not None:
                    dur = obj["on_ms"] / 1000.0
                res = _apply_state(cur, esp, ch, False,
                                   dur_override=(int(round(dur)) if dur is not None else None))
            elif ev == "ACK":                    # ch 2/4 → _apply_state stamps the parent's response
                res = _apply_state(cur, esp, ch, True)
            else:
                return True                      # unknown event kind — ack, ignore
            conn.commit()
        # AUTO breakdown slip — commit ke BAAD, apne alag connection par
        # (best-effort).  Slip me kuch gadbad ho to bhi ANDON ka data save ho
        # chuka hota hai aur ESP ko ack mil jaata hai (warna wo event baar-baar
        # bhejta rehta).
        #   ACK   → slip BAN jaati hai (response time milte hi)
        #   CLOSE → usi slip me OK-time / down-time bhar jaate hain
        if res and res.get("action") == "acknowledged" and res.get("event_id"):
            auto_slip_on_ack(res["event_id"])
        elif res and res.get("action") == "closed" and res.get("history_id"):
            auto_slip_on_close(res.get("event_id"), res["history_id"])
        now = datetime.now().isoformat(timespec="seconds")
        _ESP_STATUS[esp["id"]] = {"online": True, "checked": now, "last_seen": now}
        return True
    except Exception as e:
        print(f"[ANDON-TCP] persist error (no ack → ESP resends): {e}")
        return False


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


def _slip_fields(zone, line, started, received, ended, dur_seconds=None):
    """Call ke waqt se slip ke khaane banao.

    machine_no / machine_name JAAN-BUJH KE khali — ESP poori LINE par lagta hai,
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
        "problem_related_to": "maintenance",
    }


def _slip_insert(conn, event_id, flat, power_cut=False):
    """Slip daalo aur use call se JOD do (`andon_event_id`).

    `ON CONFLICT DO NOTHING` + unique index = ek call ki EK hi slip.  ESP event
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
            cur.execute("""
                SELECT e.id, e.zone, e.line, e.started_at, e.acknowledged_at,
                       COALESCE(dep.name, e.display_name) AS dept
                  FROM andon_system e
                  LEFT JOIN andon_departments dep ON dep.id = e.department_id
                 WHERE e.id = %s""", (event_id,))
            e = cur.fetchone()
            if not e or not _is_maintenance(e["dept"]):
                return
            flat = _slip_fields(e["zone"], e["line"],
                                e["started_at"], e["acknowledged_at"], None)
            new_id = _slip_insert(conn, event_id, flat)
        if new_id:
            print(f"[ANDON-SLIP] call {event_id} acknowledge hua → slip #{new_id} "
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
                print(f"[ANDON-SLIP] call {event_id} band → slip poori hui "
                      f"(ok {flat['bd_ok_time']}, down {flat['mc_down_time_minutes']} min"
                      f"{', POWER CUT' if power_cut else ''})")
                return
            # Slip thi hi nahi (acknowledge aaya hi nahi tha) → ab bana do,
            # taaki koi breakdown bina slip ke na rahe.
            new_id = _slip_insert(conn, event_id, flat, power_cut=power_cut)
        if new_id:
            print(f"[ANDON-SLIP] call {event_id} bina acknowledge band hua → slip #{new_id}"
                  f"{' (POWER CUT)' if power_cut else ''}")
    except Exception as ex:
        print(f"[ANDON-SLIP] close par slip update me dikkat (call {event_id}): {ex}")


def _close_open_calls_on_boot(ip, device_id):
    """Fresh power-on cleanup.  On boot the ESP forces every output OFF, so any
    call still sitting OPEN in andon_system for this device is STALE — power was
    cut mid-call and the OFF edge never arrived.  Close each one into history with
    its elapsed duration (call-start → now) so it can't stay 'open' forever.

    Only fired when the hello carries boot=1 (a real reboot).  A plain network
    reconnect sends boot=0 and leaves live calls untouched.

    Slip ka hisaab: har call ALAG-ALAG band hota hai (pehle sab ek saath band
    hote the) taaki har ek ki slip bhi poori ho sake —
      • ACK aa chuka tha  → slip pehle se hai, usme OK-time bhar jaata hai
      • ACK aaya hi nahi  → slip ab banti hai, taaki breakdown bina slip na rahe
    Dono par `power_cut=True` ka nishaan lagta hai: call button se band nahi
    hua tha, isliye uska OK-time bharose ke laayak nahi."""
    try:
        closed = []                        # [(event_id, history_id), ...]
        with get_conn() as conn:
            cur = dict_cursor(conn)
            esp = _find_esp(cur, None, ip, device_id)
            if not esp:
                return
            cur.execute("""SELECT id FROM andon_system
                            WHERE esp_id=%s AND state='OPEN' ORDER BY id""", (esp["id"],))
            open_ids = [r["id"] for r in cur.fetchall()]
            if not open_ids:
                return
            for ev_id in open_ids:
                cur.execute("""INSERT INTO andon_history
                                 (esp_id, do_index, department_id, zone, line, display_name, priority,
                                  started_at, ended_at, duration_seconds, response_seconds)
                               SELECT esp_id, do_index, department_id, zone, line, display_name, priority,
                                      started_at, NOW(),
                                      EXTRACT(EPOCH FROM (NOW() - started_at))::int,
                                      CASE WHEN acknowledged_at IS NOT NULL
                                           THEN EXTRACT(EPOCH FROM (acknowledged_at - started_at))::int END
                                 FROM andon_system WHERE id=%s
                               RETURNING id""", (ev_id,))
                hist = cur.fetchone()
                cur.execute("DELETE FROM andon_system WHERE id=%s", (ev_id,))
                if hist:
                    closed.append((ev_id, hist["id"]))
            conn.commit()
        print(f"[ANDON-TCP] ESP {esp['id']} rebooted (boot=1) → closed {len(closed)} stale open call(s)")
        # Commit ke BAAD — slip ka kaam kabhi ANDON ka data na roke
        for ev_id, hist_id in closed:
            auto_slip_on_close(ev_id, hist_id, power_cut=True)
    except Exception as e:
        print(f"[ANDON-TCP] boot stale-close error: {e}")


def _tcp_client(conn, addr):
    peer_ip = addr[0]
    device_id = None
    dev_ip = None            # the ESP's self-reported IP from its hello
    last_seq = 0
    buf = b""
    conn.settimeout(2.0)
    try:
        while True:
            try:
                data = conn.recv(2048)
            except socket.timeout:
                continue
            except OSError:
                break
            if not data:                          # peer closed
                break
            buf += data
            while b"\n" in buf:
                raw, buf = buf.split(b"\n", 1)
                raw = raw.strip()
                if not raw:
                    continue
                try:
                    obj = json.loads(raw.decode("utf-8", "replace"))
                except Exception:
                    continue
                if obj.get("type") == "hello":    # identity — no seq, no ack
                    device_id = obj.get("id") or device_id
                    dev_ip = obj.get("ip") or dev_ip
                    last_seq = 0
                    if _state_on(obj.get("boot")):   # fresh power-on → outputs all OFF → drop stale open calls
                        _close_open_calls_on_boot(dev_ip or peer_ip, device_id)
                    continue
                seq = obj.get("seq")
                if seq is not None and seq <= last_seq:      # duplicate resend → re-ack, skip
                    try:
                        conn.sendall((json.dumps({"ack": seq}) + "\n").encode())
                    except OSError:
                        return
                    continue
                if _tcp_apply_event(dev_ip or peer_ip, device_id or obj.get("id"), obj):
                    if seq is not None:
                        try:
                            conn.sendall((json.dumps({"ack": seq}) + "\n").encode())
                        except OSError:
                            return
                        last_seq = seq
    finally:
        try:
            conn.close()
        except OSError:
            pass


def _tcp_server_loop():
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        srv.bind(("0.0.0.0", _ANDON_TCP_PORT))
        srv.listen(32)
    except OSError as e:
        print(f"[ANDON-TCP] cannot bind :{_ANDON_TCP_PORT} — {e}")
        return
    print(f"[ANDON-TCP] listening on 0.0.0.0:{_ANDON_TCP_PORT} — ESP push ingest ready")
    while True:
        try:
            conn, addr = srv.accept()
        except OSError:
            break
        threading.Thread(target=_tcp_client, args=(conn, addr), daemon=True, name="andon-tcp-client").start()


def _start_tcp_server():
    global _tcp_started
    if _tcp_started:
        return
    _tcp_started = True
    threading.Thread(target=_tcp_server_loop, daemon=True, name="andon-tcp-server").start()


def start_workers():
    """Start the connectivity poller + the ESP raw-TCP ingest server — both
    idempotent and DB-independent (safe to call at boot even if the DB is down)."""
    _start_poller()
    _start_tcp_server()


def _ensure_tables():
    global _ensured
    if _ensured:
        return
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS andon_departments (
                id         SERIAL PRIMARY KEY,
                name       VARCHAR(120) NOT NULL UNIQUE,
                color      VARCHAR(20)  DEFAULT '#2563eb',
                created_at TIMESTAMP DEFAULT NOW()
            )""")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS andon_esp_devices (
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
        # ── EK IP / EK NAAM = EK HI ESP ────────────────────────────────────
        # `_find_esp()` aane wale event ko IP se (phir naam se) device par
        # bithata hai.  Do device ek hi IP par hon to koi bhi ek utha liya
        # jaata hai — dono board ka data ek hi line par chadh jaata aur kisi ko
        # pata bhi na chalta.  Ye DB-level rule aakhri suraksha hai: API/UI se
        # bache to yahan se nahi bachega.
        # Case/space ka farq na bane isliye LOWER(TRIM(...)) par index hai.
        # Purane data me duplicate ho to index banega nahi — us soorat me
        # backend chalta rahe (bas ek warning), warna app hi na khule.
        for _ix, _expr in (("andon_esp_ip_uq",   "LOWER(TRIM(ip))"),
                           ("andon_esp_name_uq", "LOWER(TRIM(name))")):
            try:
                cur.execute(f"""CREATE UNIQUE INDEX IF NOT EXISTS {_ix}
                                  ON andon_esp_devices (({_expr}))""")
            except Exception as _e:
                conn.rollback()
                print(f"[ANDON] {_ix} nahi ban paya (shayad purana duplicate data hai): {_e}")
        # earlier builds used zone_id/line_id FKs — move to plain master text fields
        cur.execute("ALTER TABLE andon_esp_devices ADD COLUMN IF NOT EXISTS zone VARCHAR(120)")
        cur.execute("ALTER TABLE andon_esp_devices ADD COLUMN IF NOT EXISTS line VARCHAR(120)")
        cur.execute("ALTER TABLE andon_esp_devices ADD COLUMN IF NOT EXISTS machine_no VARCHAR(60)")
        cur.execute("ALTER TABLE andon_esp_devices ADD COLUMN IF NOT EXISTS machine_name VARCHAR(160)")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS andon_esp_output_mapping (
                id            SERIAL PRIMARY KEY,
                esp_id        INTEGER REFERENCES andon_esp_devices(id) ON DELETE CASCADE,  -- NULL = default
                do_index      INTEGER NOT NULL CHECK (do_index BETWEEN 1 AND 8),
                display_name  VARCHAR(160),
                department_id INTEGER REFERENCES andon_departments(id) ON DELETE SET NULL,
                priority      VARCHAR(20) DEFAULT 'Normal',
                enabled       BOOLEAN DEFAULT TRUE,
                UNIQUE (esp_id, do_index)
            )""")
        cur.execute("""CREATE UNIQUE INDEX IF NOT EXISTS andon_output_default_uq
                       ON andon_esp_output_mapping (do_index) WHERE esp_id IS NULL""")
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
                esp_id        INTEGER REFERENCES andon_esp_devices(id) ON DELETE CASCADE,
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
        cur.execute("""
            CREATE TABLE IF NOT EXISTS andon_history (
                id               SERIAL PRIMARY KEY,
                esp_id           INTEGER,
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

        # ── seed defaults ──
        cur.execute("SELECT COUNT(*) FROM andon_departments")
        if (cur.fetchone()[0] or 0) == 0:
            for d in _DEFAULT_DEPTS:
                cur.execute("INSERT INTO andon_departments (name) VALUES (%s) ON CONFLICT DO NOTHING", (d,))
        cur.execute("SELECT COUNT(*) FROM andon_esp_output_mapping WHERE esp_id IS NULL")
        if (cur.fetchone()[0] or 0) == 0:
            for do_i, disp, dept, prio in _DEFAULT_OUTPUTS:
                dept_id = None
                if dept:
                    cur.execute("SELECT id FROM andon_departments WHERE name=%s", (dept,))
                    r = cur.fetchone(); dept_id = r[0] if r else None
                cur.execute("""INSERT INTO andon_esp_output_mapping
                               (esp_id, do_index, display_name, department_id, priority, enabled)
                               VALUES (NULL,%s,%s,%s,%s,TRUE) ON CONFLICT DO NOTHING""",
                            (do_i, disp, dept_id, prio))

        # ── one-time upgrade: adopt the fixed DO1..DO7 plant scheme.  Runs once
        # (guarded by 'Other Loss').  Config-only clean rebuild — departments +
        # the default template + any per-ESP overrides — so EVERY ESP uses the
        # single universal scheme the plant standardised on.
        cur.execute("""SELECT COUNT(*) FROM andon_esp_output_mapping
                         WHERE esp_id IS NULL AND display_name='Other Loss'""")
        if (cur.fetchone()[0] or 0) == 0:
            cur.execute("DELETE FROM andon_esp_output_mapping")   # default + per-ESP overrides
            cur.execute("DELETE FROM andon_departments")
            dept_id = {}
            for d in ("Maintenance", "Toolroom", "Quality", "Material", "Other Loss"):
                cur.execute("INSERT INTO andon_departments (name) VALUES (%s) RETURNING id", (d,))
                dept_id[d] = cur.fetchone()[0]
            for do_i, disp, dept, prio in _DEFAULT_OUTPUTS:
                cur.execute("""INSERT INTO andon_esp_output_mapping
                                 (esp_id, do_index, display_name, department_id, priority, enabled)
                               VALUES (NULL,%s,%s,%s,%s,TRUE)""",
                            (do_i, disp, dept_id.get(dept), prio))

        # DO6 department is 'Material' (was briefly labelled 'Store').
        # Idempotent self-heal (renames dept + the DO6 label if still 'Store').
        cur.execute("""UPDATE andon_departments SET name='Material' WHERE name='Store'
                        AND NOT EXISTS (SELECT 1 FROM andon_departments WHERE name='Material')""")
        cur.execute("UPDATE andon_esp_output_mapping SET display_name='Material' WHERE display_name='Store'")
        conn.commit()
    _ensured = True
    start_workers()          # connectivity sweep + ESP raw-TCP ingest server


# ════════════════════════════════════════════════════════════════════
#  MASTERS — zone / line come straight from maintenance_machines
# ════════════════════════════════════════════════════════════════════
@router.get("/masters")
def masters(user=Depends(get_current_user)):
    """Distinct zone → lines from the machine master (maintenance_machines), so the ESP
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
#  ESP32 DEVICES  (name · ip · port · zone · line — zone/line from master)
# ════════════════════════════════════════════════════════════════════
class EspIn(BaseModel):
    name: str
    ip: str
    port: Optional[int] = 80
    zone: Optional[str] = ""
    line: Optional[str] = ""
    machine_no: Optional[str] = ""
    machine_name: Optional[str] = ""
    description: Optional[str] = ""
    enabled: bool = True
    poll_path: Optional[str] = "/status"


@router.get("/esp-devices")
def list_esp(user=Depends(get_current_user)):
    _ensure_tables()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("""SELECT id, name, ip, port, zone, line, machine_no, machine_name,
                              description, enabled, poll_path
                         FROM andon_esp_devices ORDER BY name""")
        rows = cur.fetchall()
    # merge live connectivity (green/red) from the background poller
    for r in rows:
        st = _ESP_STATUS.get(r["id"], {})
        r["online"] = st.get("online")            # True=connected · False=disconnected · None=not-checked/disabled
        r["last_seen"] = st.get("last_seen")
        r["checked"] = st.get("checked")
    return rows


@router.get("/esp-status")
def esp_status(user=Depends(get_current_user)):
    """Live connectivity of every ESP — {esp_id: {online, last_seen, checked}}."""
    _ensure_tables()
    return _ESP_STATUS


def _check_esp_unique(cur, ip, name, skip_id=None):
    """Ek IP / ek naam par do ESP na ban sakein.

    Event device par IP se bithaya jaata hai — do board ek hi IP par hon to
    dono ka data ek hi line par chadh jayega aur kisi ko pata bhi nahi
    chalega.  Isliye save se PEHLE rok dete hain, aur message me saaf batate
    hain ki wo IP kis ESP ki hai (zone/line ke saath) — taaki galti turant
    samajh aaye.  `skip_id` = edit karte waqt khud ko chhod do.
    Compare case/space-safe hai (' 192.168.30.77 ' bhi wahi maana jayega).
    """
    for field, value, label in (("ip", ip, "IP"), ("name", name, "Naam")):
        val = (value or "").strip()
        if not val:
            continue
        cur.execute(f"""SELECT id, name, ip, zone, line FROM andon_esp_devices
                         WHERE LOWER(TRIM({field})) = LOWER(%s)
                           AND (%s::int IS NULL OR id <> %s)
                         LIMIT 1""", (val, skip_id, skip_id))
        hit = cur.fetchone()
        if hit:
            eid, ename, eip, ezone, eline = hit[0], hit[1], hit[2], hit[3], hit[4]
            where = " · ".join(x for x in (ezone, eline) if x) or "zone/line set nahi"
            raise HTTPException(409,
                f"Ye {label} '{val}' pehle se ESP \"{ename}\" ki hai ({where}, IP {eip}). "
                f"Ek {label} sirf EK hi ESP ko de sakte hain — "
                f"{'doosra IP dijiye' if field == 'ip' else 'doosra naam dijiye'}.")


@router.post("/esp-devices", status_code=201)
def add_esp(body: EspIn, user=Depends(get_current_user)):
    _ensure_tables()
    if not (body.name or "").strip() or not (body.ip or "").strip():
        raise HTTPException(400, "name and ip are required")
    with get_conn() as conn:
        cur = conn.cursor()
        _check_esp_unique(cur, body.ip, body.name)
        cur.execute("""INSERT INTO andon_esp_devices
                       (name, ip, port, zone, line, machine_no, machine_name, description, enabled, poll_path)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
                    (body.name.strip(), body.ip.strip(), body.port or 80,
                     (body.zone or "").strip() or None, (body.line or "").strip() or None,
                     (body.machine_no or "").strip() or None, (body.machine_name or "").strip() or None,
                     body.description or "", body.enabled, (body.poll_path or "/status").strip()))
        new_id = cur.fetchone()[0]; conn.commit()
    return {"id": new_id}


@router.put("/esp-devices/{eid}")
def edit_esp(eid: int, body: EspIn, user=Depends(get_current_user)):
    _ensure_tables()
    if not (body.name or "").strip() or not (body.ip or "").strip():
        raise HTTPException(400, "name and ip are required")
    with get_conn() as conn:
        cur = conn.cursor()
        # Edit me bhi wahi rok — apne aap ko chhod kar (skip_id=eid)
        _check_esp_unique(cur, body.ip, body.name, skip_id=eid)
        cur.execute("""UPDATE andon_esp_devices
                          SET name=%s, ip=%s, port=%s, zone=%s, line=%s, machine_no=%s, machine_name=%s,
                              description=%s, enabled=%s, poll_path=%s, updated_at=NOW()
                        WHERE id=%s""",
                    (body.name.strip(), body.ip.strip(), body.port or 80,
                     (body.zone or "").strip() or None, (body.line or "").strip() or None,
                     (body.machine_no or "").strip() or None, (body.machine_name or "").strip() or None,
                     body.description or "", body.enabled, (body.poll_path or "/status").strip(), eid))
        if cur.rowcount == 0:
            raise HTTPException(404, "esp not found")
        conn.commit()
    return {"ok": True}


@router.delete("/esp-devices/{eid}")
def del_esp(eid: int, user=Depends(get_current_user)):
    _ensure_tables()
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM andon_esp_devices WHERE id=%s", (eid,))
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


class OutSave(BaseModel):
    rows: List[OutRow]


@router.get("/outputs/default")
def get_default_outputs(user=Depends(get_current_user)):
    """The default output rows — one per department, in DO order (not padded)."""
    _ensure_tables()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("""SELECT do_index, display_name, department_id, priority, enabled
                         FROM andon_esp_output_mapping WHERE esp_id IS NULL ORDER BY do_index""")
        return cur.fetchall()


@router.get("/esp-devices/{eid}/outputs")
def get_esp_outputs(eid: int, user=Depends(get_current_user)):
    """This ESP's output rows — its own overrides if any, else the default set."""
    _ensure_tables()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("""SELECT do_index, display_name, department_id, priority, enabled
                         FROM andon_esp_output_mapping WHERE esp_id=%s ORDER BY do_index""", (eid,))
        own = cur.fetchall()
        if own:
            for r in own:
                r["overridden"] = True
            return own
        cur.execute("""SELECT do_index, display_name, department_id, priority, enabled
                         FROM andon_esp_output_mapping WHERE esp_id IS NULL ORDER BY do_index""")
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


def _replace_outputs(esp_id, rows):
    """Replace ALL rows for a target (default = esp_id None, or a specific ESP) —
    so adding / removing an output just works."""
    good = _valid_rows(rows)
    with get_conn() as conn:
        cur = conn.cursor()
        if esp_id is None:
            cur.execute("DELETE FROM andon_esp_output_mapping WHERE esp_id IS NULL")
        else:
            cur.execute("DELETE FROM andon_esp_output_mapping WHERE esp_id=%s", (esp_id,))
        for r in good:
            cur.execute("""INSERT INTO andon_esp_output_mapping
                             (esp_id, do_index, display_name, department_id, priority, enabled)
                           VALUES (%s,%s,%s,%s,%s,%s)""",
                        (esp_id, r.do_index, (r.display_name or "").strip(), r.department_id,
                         r.priority or "Normal", r.enabled))
        conn.commit()


@router.put("/outputs/default")
def save_default_outputs(body: OutSave, user=Depends(get_current_user)):
    """Replace the shared default output template (one row per department)."""
    _ensure_tables()
    _replace_outputs(None, body.rows)
    return {"ok": True}


@router.put("/esp-devices/{eid}/outputs")
def save_esp_outputs(eid: int, body: OutSave, user=Depends(get_current_user)):
    """Replace this ESP's output overrides."""
    _ensure_tables()
    _replace_outputs(eid, body.rows)
    return {"ok": True}


# ════════════════════════════════════════════════════════════════════
#  EVENT INGEST  (PUSH — the ESP calls this on every output change)
# ════════════════════════════════════════════════════════════════════
#  The ESP is the source of truth for output state: it POSTs here the moment an
#  output turns ON, and again the moment it turns OFF.  The server does NOT poll
#  the ESP for output state — it only reacts:
#     ON  →  open a call in andon_system (timer starts)
#     OFF →  close it → move to andon_history with the elapsed duration
#  No auth (an ESP32 has no JWT); the device is identified by esp_id / ip / name.
class IngestIn(BaseModel):
    esp_id:   Optional[int] = None                    # direct id (if the ESP knows it)
    ip:       Optional[str] = None                    # or match by configured IP
    device:   Optional[str] = None                    # or match by ESP name
    do_index: Optional[int] = None                    # single event: which output (1–8)
    state:    Optional[Union[int, str, bool]] = None  #   … ON/OFF (1/0, on/off, true/false)
    outputs:  Optional[List[Union[int, str, bool]]] = None  # OR a full snapshot [DO1..DO8]


def _state_on(v):
    """Interpret whatever the ESP sends as ON(True)/OFF(False)."""
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return int(v) != 0
    return str(v).strip().lower() in ("1", "on", "true", "high", "open", "yes", "active")


def _find_esp(cur, esp_id, ip, device):
    """Locate the configured ESP by id, then IP, then name."""
    if esp_id:
        cur.execute("SELECT id, zone, line, machine_no, machine_name FROM andon_esp_devices WHERE id=%s", (esp_id,))
        r = cur.fetchone()
        if r:
            return r
    if ip and str(ip).strip():
        cur.execute("SELECT id, zone, line, machine_no, machine_name FROM andon_esp_devices WHERE ip=%s", (str(ip).strip(),))
        r = cur.fetchone()
        if r:
            return r
    if device and str(device).strip():
        cur.execute("SELECT id, zone, line, machine_no, machine_name FROM andon_esp_devices WHERE name=%s", (str(device).strip(),))
        r = cur.fetchone()
        if r:
            return r
    return None


def _resolve_output(cur, esp_id, do_index):
    """This ESP's mapping for the output, else the shared default → (name, dept, priority)."""
    cur.execute("""SELECT display_name, department_id, priority FROM andon_esp_output_mapping
                    WHERE esp_id=%s AND do_index=%s""", (esp_id, do_index))
    r = cur.fetchone()
    if not r:
        cur.execute("""SELECT display_name, department_id, priority FROM andon_esp_output_mapping
                        WHERE esp_id IS NULL AND do_index=%s""", (do_index,))
        r = cur.fetchone()
    if r:
        return (r["display_name"] or f"DO{do_index}"), r["department_id"], (r["priority"] or "Normal")
    return f"DO{do_index}", None, "Normal"


def _apply_state(cur, esp, do_index, on, dur_override=None):
    """Open (ON) or close (OFF) the call for one output — idempotent.

    DO2 / DO4 are acknowledgement pulses, not calls of their own:
      • DO2 ON = maintenance responded to the open DO1 call
      • DO4 ON = toolroom     responded to the open DO3 call
    Their ON edge stamps acknowledged_at on the parent call (→ response time =
    call-ON → ACK-ON); they never open an event or accumulate a duration.

    dur_override (seconds): on OFF, use this hardware-measured duration instead
    of the server-computed one — so a call that was closed WHILE the ESP was
    disconnected (event flushed later on reconnect) still gets its true length."""
    if do_index in _ACK_OF:
        if not on:
            return {"do_index": do_index, "action": "ack_off_ignored"}
        parent = _ACK_OF[do_index]
        cur.execute("""SELECT id, started_at FROM andon_system
                        WHERE esp_id=%s AND do_index=%s AND state='OPEN'
                              AND acknowledged_at IS NULL
                        ORDER BY id DESC LIMIT 1""", (esp["id"], parent))
        pe = cur.fetchone()
        if not pe:
            return {"do_index": do_index, "action": "ack_no_open_call", "parent_do": parent}
        cur.execute("""UPDATE andon_system SET acknowledged_at=NOW() WHERE id=%s
                        RETURNING EXTRACT(EPOCH FROM (NOW()-started_at))::int AS resp""", (pe["id"],))
        rr = cur.fetchone()
        return {"do_index": do_index, "action": "acknowledged", "parent_do": parent,
                "event_id": pe["id"], "response_seconds": (rr["resp"] if rr else None)}

    cur.execute("""SELECT id, started_at FROM andon_system
                    WHERE esp_id=%s AND do_index=%s AND state='OPEN'
                    ORDER BY id DESC LIMIT 1""", (esp["id"], do_index))
    open_ev = cur.fetchone()
    if on:
        if open_ev:                                   # already open → duplicate ON, ignore
            return {"do_index": do_index, "action": "already_open", "event_id": open_ev["id"]}
        disp, dept_id, prio = _resolve_output(cur, esp["id"], do_index)
        cur.execute("""INSERT INTO andon_system
                         (esp_id, do_index, department_id, zone, line, display_name, priority, state, started_at)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,'OPEN', NOW()) RETURNING id""",
                    (esp["id"], do_index, dept_id, esp.get("zone"), esp.get("line"), disp, prio))
        return {"do_index": do_index, "action": "opened", "event_id": cur.fetchone()["id"],
                "department_id": dept_id, "display_name": disp}
    # OFF ─────────────────────────────────────────────────────────────
    if not open_ev:                                   # OFF with no open call → nothing to close
        return {"do_index": do_index, "action": "not_open"}
    cur.execute("""INSERT INTO andon_history
                     (esp_id, do_index, department_id, zone, line, display_name, priority,
                      started_at, ended_at, duration_seconds, response_seconds)
                   SELECT esp_id, do_index, department_id, zone, line, display_name, priority,
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


@router.post("/ingest")
def ingest(body: IngestIn):
    """PUSH endpoint the ESP hits on every output change (NO auth — device call).

    Single event  →  {"ip": "192.168.30.50", "do_index": 3, "state": "ON"}
    Snapshot      →  {"ip": "192.168.30.50", "outputs": [0,0,1,0,0,0,0,0]}
    (`esp_id` or `device` name work in place of `ip`.)
    """
    _ensure_tables()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        esp = _find_esp(cur, body.esp_id, body.ip, body.device)
        if not esp:
            raise HTTPException(404, "unknown ESP — add it (ip / name) in ANDON config first")
        results = []
        if body.outputs is not None:                  # full snapshot [DO1..DO8]
            for i, st in enumerate(body.outputs[:8], start=1):
                results.append(_apply_state(cur, esp, i, _state_on(st)))
        elif body.do_index is not None:               # single output event
            if not (1 <= int(body.do_index) <= 8):
                raise HTTPException(400, "do_index must be 1–8")
            results.append(_apply_state(cur, esp, int(body.do_index), _state_on(body.state)))
        else:
            raise HTTPException(400, "send do_index+state, or an outputs[] snapshot")
        conn.commit()
    # AUTO breakdown slip — TCP path jaisa hi (commit ke baad, best-effort).
    # ACK par slip banti hai, CLOSE par usi me OK-time bhar jaata hai.
    # Maintenance wale call ki hi banti hai — check function ke andar hai.
    for _r in results:
        if not _r:
            continue
        if _r.get("action") == "acknowledged" and _r.get("event_id"):
            auto_slip_on_ack(_r["event_id"])
        elif _r.get("action") == "closed" and _r.get("history_id"):
            auto_slip_on_close(_r.get("event_id"), _r["history_id"])
    # a pushing ESP is, by definition, connected — refresh its live status
    now = datetime.now().isoformat(timespec="seconds")
    _ESP_STATUS[esp["id"]] = {"online": True, "checked": now, "last_seen": now}
    return {"ok": True, "esp_id": esp["id"], "results": results}


@router.get("/events")
def live_events(user=Depends(get_current_user)):
    """Currently OPEN calls (running timer) — for the live board."""
    _ensure_tables()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("""SELECT e.id, e.esp_id, d.name AS esp_name, e.do_index, e.department_id,
                              dep.name AS department, e.zone, e.line, e.display_name, e.priority,
                              e.started_at, e.acknowledged_at,
                              EXTRACT(EPOCH FROM (NOW() - e.started_at))::int AS elapsed_seconds
                         FROM andon_system e
                         LEFT JOIN andon_esp_devices d   ON d.id  = e.esp_id
                         LEFT JOIN andon_departments dep ON dep.id = e.department_id
                        WHERE e.state='OPEN'
                        ORDER BY e.started_at""")
        return cur.fetchall()


@router.get("/dashboard")
def dashboard_board(user=Depends(get_current_user)):
    """Maintenance Dashboard ke ANDON table ke liye — SIRF abhi chalu calls.

    Dashboard ka live data yahin se aata hai.
    Ab wahi table ESP ke asli ANDON calls dikhata hai. Dikhne ka format wahi
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
            SELECT e.id, e.esp_id, d.name AS esp_name, e.do_index,
                   dep.name AS department, e.display_name, e.priority,
                   e.zone AS zone_name, e.line AS line_name,
                   e.started_at, NULL::timestamp AS ended_at,
                   NULL::int AS duration_seconds,
                   CASE WHEN e.acknowledged_at IS NOT NULL
                        THEN EXTRACT(EPOCH FROM (e.acknowledged_at - e.started_at))::int END
                        AS response_seconds,
                   TRUE AS is_live
              FROM andon_system e
              LEFT JOIN andon_esp_devices d   ON d.id   = e.esp_id
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

    # S.No: list me position (ESP data me shift-wise serial hota hi nahi)
    for i, r in enumerate(rows, 1):
        r["serial_in_shift"] = i
    return {"rows": rows, "stats": stats}


@router.get("/history")
def event_history(limit: int = 200, user=Depends(get_current_user)):
    """Closed calls (duration / response) — for reports."""
    _ensure_tables()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("""SELECT h.id, h.esp_id, d.name AS esp_name, h.do_index, h.department_id,
                              dep.name AS department, h.zone, h.line, h.display_name, h.priority,
                              h.started_at, h.ended_at, h.duration_seconds, h.response_seconds
                         FROM andon_history h
                         LEFT JOIN andon_esp_devices d   ON d.id  = h.esp_id
                         LEFT JOIN andon_departments dep ON dep.id = h.department_id
                        ORDER BY h.ended_at DESC
                        LIMIT %s""", (int(limit),))
        return cur.fetchall()
