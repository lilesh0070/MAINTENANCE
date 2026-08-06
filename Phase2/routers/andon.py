"""
routers/andon.py
================
Standalone Industrial **ANDON Management** module — configured entirely from the
UI (no source changes to add an ESP or a department).

Design (per requirement):
  • Zone / Line are NOT stored here — they come from the machine master
    (`mes_machines`), exactly like every other picker in the app.  An ESP just
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
  andon_events              live OPEN calls (running timer)
  andon_history             closed calls (duration / response time)

Event model — PUSH, not poll:
  • The ESP itself PUSHES every output change to POST /ingest ("DO3 turned ON",
    then later "DO3 turned OFF").  The server never polls the ESP for output
    state — it only opens a call on ON and closes it (→ history, with duration)
    on OFF.  The background poller does ONE thing: check each ESP is still
    reachable (green/red connectivity), nothing else.

Endpoints (prefix /api/andon)
-----------------------------
GET             /masters                    distinct zone → lines from mes_machines
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
from datetime import datetime
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
            if ev == "ON":
                _apply_state(cur, esp, ch, True)
            elif ev == "OFF":
                dur = obj.get("on_s")            # ESP's hardware-measured ON duration
                if dur is None and obj.get("on_ms") is not None:
                    dur = obj["on_ms"] / 1000.0
                _apply_state(cur, esp, ch, False,
                             dur_override=(int(round(dur)) if dur is not None else None))
            elif ev == "ACK":                    # ch 2/4 → _apply_state stamps the parent's response
                _apply_state(cur, esp, ch, True)
            else:
                return True                      # unknown event kind — ack, ignore
            conn.commit()
        now = datetime.now().isoformat(timespec="seconds")
        _ESP_STATUS[esp["id"]] = {"online": True, "checked": now, "last_seen": now}
        return True
    except Exception as e:
        print(f"[ANDON-TCP] persist error (no ack → ESP resends): {e}")
        return False


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
                zone         VARCHAR(120),          -- from mes_machines master
                line         VARCHAR(120),          -- from mes_machines master
                machine_no   VARCHAR(60),           -- from mes_machines master
                machine_name VARCHAR(160),          -- auto-filled from machine_no
                description  TEXT,
                enabled      BOOLEAN DEFAULT TRUE,
                poll_path    VARCHAR(120) DEFAULT '/status',
                created_at   TIMESTAMP DEFAULT NOW(),
                updated_at   TIMESTAMP DEFAULT NOW()
            )""")
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
        cur.execute("""
            CREATE TABLE IF NOT EXISTS andon_events (
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
        for _t in ("andon_events", "andon_history"):
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
#  MASTERS — zone / line come straight from mes_machines
# ════════════════════════════════════════════════════════════════════
@router.get("/masters")
def masters(user=Depends(get_current_user)):
    """Distinct zone → lines from the machine master (mes_machines), so the ESP
    picker matches every other page in the app."""
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("""SELECT DISTINCT zone_name, line_name FROM mes_machines
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


@router.post("/esp-devices", status_code=201)
def add_esp(body: EspIn, user=Depends(get_current_user)):
    _ensure_tables()
    if not (body.name or "").strip() or not (body.ip or "").strip():
        raise HTTPException(400, "name and ip are required")
    with get_conn() as conn:
        cur = conn.cursor()
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
    with get_conn() as conn:
        cur = conn.cursor()
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
#     ON  →  open a call in andon_events (timer starts)
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
        cur.execute("""SELECT id, started_at FROM andon_events
                        WHERE esp_id=%s AND do_index=%s AND state='OPEN'
                              AND acknowledged_at IS NULL
                        ORDER BY id DESC LIMIT 1""", (esp["id"], parent))
        pe = cur.fetchone()
        if not pe:
            return {"do_index": do_index, "action": "ack_no_open_call", "parent_do": parent}
        cur.execute("""UPDATE andon_events SET acknowledged_at=NOW() WHERE id=%s
                        RETURNING EXTRACT(EPOCH FROM (NOW()-started_at))::int AS resp""", (pe["id"],))
        rr = cur.fetchone()
        return {"do_index": do_index, "action": "acknowledged", "parent_do": parent,
                "event_id": pe["id"], "response_seconds": (rr["resp"] if rr else None)}

    cur.execute("""SELECT id, started_at FROM andon_events
                    WHERE esp_id=%s AND do_index=%s AND state='OPEN'
                    ORDER BY id DESC LIMIT 1""", (esp["id"], do_index))
    open_ev = cur.fetchone()
    if on:
        if open_ev:                                   # already open → duplicate ON, ignore
            return {"do_index": do_index, "action": "already_open", "event_id": open_ev["id"]}
        disp, dept_id, prio = _resolve_output(cur, esp["id"], do_index)
        cur.execute("""INSERT INTO andon_events
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
                     FROM andon_events WHERE id=%s
                   RETURNING id, duration_seconds""", (dur_override, open_ev["id"]))
    hist = cur.fetchone()
    cur.execute("DELETE FROM andon_events WHERE id=%s", (open_ev["id"],))
    return {"do_index": do_index, "action": "closed",
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
                         FROM andon_events e
                         LEFT JOIN andon_esp_devices d   ON d.id  = e.esp_id
                         LEFT JOIN andon_departments dep ON dep.id = e.department_id
                        WHERE e.state='OPEN'
                        ORDER BY e.started_at""")
        return cur.fetchall()


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
