# -*- coding: utf-8 -*-
"""ANDON Call->Output: HAR PLC KA APNA THREAD (user 2026-09-26).

User: "kal ko Maintenance ki 5 PLC lagayi aur Toolroom ki 6, tab?" -- "ek hi
signal ke liye alag-alag thread kar do".  Ye test pakka karta hai:
  (1) Band PLC (connect par ~2 s atakta, jaise asli pymcprotocol) CHALTE PLC
      ki bit ko late NAHI karta -- 6 band PLC ke saath bhi.
  (2) Ek department ki saari mapping (5 Maintenance PLC) par WAHI signal.
  (3) Maintenance: call -> M1000 + M1001 ON, ACK -> M1000 OFF (M1001 ON),
      band -> dono OFF.
  (4) Band PLC chalu hua to apne aap judta hai aur khuli call ki bit likhta hai.
  (5) Mapping hatao to uski ON bit bujhti hai, aur uska worker band hota hai.
  (6) Coordinator ka chakkar (writer-lock ki heartbeat) band PLC se nahi atakta.
  (7) Writer ka taala gaya to koi worker PLC ko nahi chhoota; wapas mila to phir chalu.

BINA DB, BINA ASLI PLC: andon.py ke DB wale do function (_out_read_db,
_out_persist), taala aur PLC driver (_connect) naqli se badle jaate hain --
production ka writer, andon_output_lock aur asli PLC ko haath nahi lagta.

Chalane ka tareeqa (Phase2 folder se):
    .venv/Scripts/python.exe tests/test_andon_output_threads.py
"""
import os
import sys
import threading
import time
import warnings

warnings.filterwarnings("ignore")
_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(_HERE))

from dotenv import load_dotenv                                    # noqa: E402
load_dotenv(os.path.join(os.path.dirname(_HERE), ".env"), override=True)
import routers.andon as A                                         # noqa: E402

DEAD_WAIT = 2.0          # pymcprotocol ka soc_timeout -- band PLC par itna atakta hai


class FakePlc:
    """Naqli FX5U -- bits yaad rakhta hai, har read/write ~5 ms."""
    def __init__(self):
        self.bits = {}

    def read_one(self, t, n):
        time.sleep(0.005)
        return self.bits.get(f"{t}{n}", 0)

    def write_bit(self, t, n, v):
        time.sleep(0.005)
        self.bits[f"{t}{n}"] = 1 if v else 0

    def close(self):
        pass


PLCS, DEAD, CONNECTS = {}, set(), {}
MAPS, LIVE, PERSIST, CYCLES = [], {}, {}, []
LOCK = {"got": True}


def fake_connect(plc, timer=4):
    ip = plc["plc_ip"]
    CONNECTS[ip] = CONNECTS.get(ip, 0) + 1
    if ip in DEAD:
        time.sleep(DEAD_WAIT)
        raise TimeoutError("timed out")
    return PLCS.setdefault(ip, FakePlc())


def fake_read_db():
    return [dict(m) for m in MAPS], {k: dict(v) for k, v in LIVE.items()}


def fake_persist(updates):
    for u in updates:
        PERSIST[u[-1]] = u


A._out_read_db = fake_read_db
A._out_persist = fake_persist
A._acquire_writer_lock = lambda: LOCK["got"]
A._ensure_output = lambda: None
A._connect = fake_connect
_orig_once = A._andon_output_write_once


def _timed_once():
    t0 = time.monotonic()
    _orig_once()
    CYCLES.append(time.monotonic() - t0)


A._andon_output_write_once = _timed_once


def mapping(mid, dept, ip):
    return {"id": mid, "department": dept, "plc_ip": ip, "plc_port": 2000,
            "plc_series": "FX5U", "protocol": "MC", "unit_id": 1,
            "bit_type": "M", "bit_no": "1000", "bit2_type": "M", "bit2_no": "1001",
            "reconnect_req": None}


MAINT = [f"10.9.0.{i}" for i in range(1, 6)]        # 5 Maintenance PLC -- chalu
TOOL = [f"10.9.1.{i}" for i in range(1, 7)]         # 6 Toolroom PLC -- BAND
for n, ip in enumerate(MAINT, 1):
    MAPS.append(mapping(n, "Maintenance", ip))
for n, ip in enumerate(TOOL, 101):
    MAPS.append(mapping(n, "Toolroom", ip))
DEAD.update(TOOL)

_fail = 0


def T(name, ok, extra=""):
    global _fail
    if not ok:
        _fail += 1
    print("   %s  %-66s %s" % ("PASS" if ok else "FAIL", name, extra))


def bit(ip, b):
    p = PLCS.get(ip)
    return p.bits.get(f"M{b}", 0) if p else None


def wait_until(cond, timeout):
    t0 = time.monotonic()
    while time.monotonic() - t0 < timeout:
        if cond():
            return time.monotonic() - t0
        time.sleep(0.01)
    return None


def set_live(dept, total=0, unacked=0):
    k = A._dept_key(dept)
    if total:
        LIVE[k] = {"dept": dept, "total": total, "unacked": unacked}
    else:
        LIVE.pop(k, None)
    A._OUT_WAKE.set()                  # poller bhi call badalne par yahi karta hai


def all_maint(b, v, ips=MAINT):
    return all(bit(ip, b) == v for ip in ips)


threading.Thread(target=A._andon_output_loop, daemon=True, name="coordinator").start()
time.sleep(3.0)                         # worker chalu + band PLC apni atkan ki taal me

print("\n--- (1)+(2) 5 chalu Maintenance PLC, 6 BAND Toolroom PLC: call ki bit kitni der me ---")
lat = []
for trial in range(8):                  # band PLC ki alag-alag taal par (har ~0.7 s) aazmao
    time.sleep(0.7)
    set_live("Maintenance", 1, 1)
    t_on = wait_until(lambda: all_maint(1000, 1) and all_maint(1001, 1), 15)
    set_live("Maintenance", 0)
    t_off = wait_until(lambda: all_maint(1000, 0) and all_maint(1001, 0), 15)
    lat += [t for t in (t_on, t_off) if t is not None]
    if t_on is None or t_off is None:
        lat.append(99)
T("paanchon PLC par ON aur OFF, har baar", len(lat) == 16 and max(lat) < 99)
T("sabse der wali bit bhi 1 s ke andar (band PLC ke bawajood)", max(lat) < 1.0,
  f"max {max(lat):.3f}s, avg {sum(lat) / len(lat):.3f}s")
threads = {t.name for t in threading.enumerate() if t.name.startswith("andon-out-")}
T("har PLC (IP) ka apna thread -- 11", len(threads) == 11, f"{len(threads)} thread")

print("\n--- (3) Maintenance: call -> ACK -> band ---")
set_live("Maintenance", 1, 1)
T("call aayi: M1000 + M1001 ON (paanchon)",
  wait_until(lambda: all_maint(1000, 1) and all_maint(1001, 1), 3) is not None)
set_live("Maintenance", 1, 0)
T("ACK hua: M1000 OFF, M1001 ON rahi",
  wait_until(lambda: all_maint(1000, 0) and all_maint(1001, 1), 3) is not None)
set_live("Maintenance", 2, 1)
T("doosri machine ki call: M1000 phir ON", wait_until(lambda: all_maint(1000, 1), 3) is not None)
set_live("Maintenance", 0)
T("saari call band: dono OFF",
  wait_until(lambda: all_maint(1000, 0) and all_maint(1001, 0), 3) is not None)

print("\n--- band Toolroom PLC: DB me sahi haal ---")
set_live("Toolroom", 1, 1)
time.sleep(1.5)
tr = [PERSIST.get(m["id"]) for m in MAPS if m["department"] == "Toolroom"]
T("Toolroom: online=False + 'connect failed' wajah (sab 6)",
  all(u and u[2] is False and "connect failed" in (u[5] or "") for u in tr))
T("Toolroom: program bit (want) = ON", all(u and u[1] is True for u in tr))
mt = [PERSIST.get(m["id"]) for m in MAPS if m["department"] == "Maintenance"]
T("Maintenance: online=True, koi galti nahi", all(u and u[2] is True and u[5] is None for u in mt))

print("\n--- (4) ek Toolroom PLC chalu hua ---")
DEAD.discard(TOOL[0])
t = wait_until(lambda: bit(TOOL[0], 1000) == 1 and bit(TOOL[0], 1001) == 1, 10)
T("apne aap juda, khuli call ki M1000 + M1001 ON", t is not None,
  f"{t:.1f}s (retry har {A._PLC_RETRY_SECS}s)" if t is not None else "")
set_live("Toolroom", 1, 0)
T("Tool ACC: M1000 OFF, M1001 ON",
  wait_until(lambda: bit(TOOL[0], 1000) == 0 and bit(TOOL[0], 1001) == 1, 3) is not None)
set_live("Toolroom", 0)
T("band: dono OFF",
  wait_until(lambda: bit(TOOL[0], 1000) == 0 and bit(TOOL[0], 1001) == 0, 3) is not None)

print("\n--- (5) ON bit wali mapping hatayi ---")
set_live("Maintenance", 1, 1)
wait_until(lambda: all_maint(1000, 1), 3)
MAPS[:] = [m for m in MAPS if m["plc_ip"] != MAINT[0]]
A._OUT_WAKE.set()
T("hatayi mapping ki M1000 + M1001 OFF",
  wait_until(lambda: bit(MAINT[0], 1000) == 0 and bit(MAINT[0], 1001) == 0, 4) is not None)
T("baaki 4 par bit ON hi", all_maint(1000, 1, MAINT[1:]))
T("uska worker band ho gaya",
  wait_until(lambda: MAINT[0] not in A._OUT_WORKERS, 5) is not None)
set_live("Maintenance", 0)
wait_until(lambda: all_maint(1000, 0, MAINT[1:]) and all_maint(1001, 0, MAINT[1:]), 3)

print("\n--- (6) coordinator (writer-lock heartbeat) kabhi nahi atka ---")
T("sabse lamba chakkar 0.5 s se kam", max(CYCLES) < 0.5,
  f"max {max(CYCLES) * 1000:.0f} ms, {len(CYCLES)} chakkar")

print("\n--- (7) writer ka taala gaya / wapas mila ---")
LOCK["got"] = False
A._OUT_WAKE.set()
T("saare worker band",
  wait_until(lambda: not [t for t in threading.enumerate()
                          if t.name.startswith("andon-out-") and t.is_alive()], 6) is not None)
set_live("Maintenance", 1, 1)
time.sleep(1.5)
T("taale ke bina PLC ko haath nahi (bit OFF hi)", all_maint(1000, 0, MAINT[1:]))
LOCK["got"] = True
A._OUT_WAKE.set()
T("taala wapas: bit ON", wait_until(lambda: all_maint(1000, 1, MAINT[1:]), 4) is not None)
set_live("Maintenance", 0)
wait_until(lambda: all_maint(1000, 0, MAINT[1:]), 3)

print("\n   %s\n" % (">>> SAB PASS" if not _fail else ">>> %d FAIL" % _fail))
# Worker (daemon thread) band karke hi niklo -- warna Python band hote waqt
# unka print adhoora reh kar "Fatal Python error ... daemon threads" deta hai.
LOCK["got"] = False
A._OUT_WAKE.set()
wait_until(lambda: not [t for t in threading.enumerate()
                        if t.name.startswith("andon-out-") and t.is_alive()], 6)
sys.stdout.flush()
os._exit(1 if _fail else 0)
