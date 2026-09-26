# -*- coding: utf-8 -*-
"""ANDON call PADHNA: HAR LINE PLC KA APNA READER THREAD (user 2026-09-26).

User: "dono kar do lekin dhyan se".  Ye test pakka karta hai:
  (1) Band line PLC (connect / tatolna ~1.5 s atakta) CHALTI line ki call ko
      late NAHI karta -- 3 band PLC ke saath (jaise LOOP_PIPE_1/2/3).
  (2) Har line PLC ka apna reader thread.
  (3) Kram: call -> ACK -> band, teeno DB tak usi kram me.
  (4) Chhota ACK pulse (0.25 s) bhi chhoot-ta nahi.
  (5) DB ek baar fail -- badlav line me rehta hai, agle chakkar me lag jaata hai.
  (6) Band PLC ka haal: online=False + wajah; chalu ka online=True.
  (7) PLC band (disabled) / hatayi -> uska reader ruk jaata hai.
  (8) Band PLC chalu hua -> apne aap juda aur uski call pakdi.
  (9) Poller (DB wala) chakkar kabhi nahi atka.
 (10) Lambi line (DB der tak ruka) 50-50 ke tukdon me, kram se lagti hai.
 (11) Purana reader band ho par usi PLC ka naya chal raha ho -> connection
      nahi tootta; aakhri reader band -> connection chhoot jaata hai.
 (12) SUB-PLC (model / fault wali) ka apna thread; BAND sub-PLC apni hi line
      ki call ko bhi late nahi karti (pehle har ~5 s ~1.5 s rukti thi).
 (13) Chalti sub-PLC se model call ke pal par hi padha jaata hai.
 (14) Chalti sub-PLC achanak band (connection latka): EK hi baar intezaar,
      phir connection chhoda -- har chakkar nahi; wapas aayi to phir judi.
 (15) Sub-PLC ka IP badla -> naya connection; sub hataya -> connection chhoda.
 (16) Chalte system me NAYI line PLC (sub-PLC ke saath) aur nayi Modbus PLC
      jodi -> bina restart dono ke apne thread, call + model turant.

BINA DB, BINA ASLI PLC: andon.py ke DB wale function (_in_read_config,
_in_apply_db, _in_stamp, _stale_call_sweep, get_conn) aur PLC driver
(_connect, _reachable) naqli se badle jaate hain.  `_apply_state` (asli DB
wala) alag test me: tests/test_andon_input_apply_db.py.

Chalane ka tareeqa (Phase2 folder se):
    .venv/Scripts/python.exe tests/test_andon_input_threads.py
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

DEAD_WAIT = 1.5          # asli: MC par tatolna 1.5 s, Modbus connect 1.5 s

BITS, DEAD = {}, set()   # ip -> {"M100": 0, ...};  band ip


class FakeDrv:
    """MC jaisa -- asli `_McDriver` ki tarah `alive()` NAHI: band PLC par juda
    hua connection sirf read ke timeout se pata chalta hai."""
    def __init__(self, ip):
        self.ip = ip
        self.closed = False

    def read_one(self, t, n):
        if self.ip in DEAD:
            time.sleep(DEAD_WAIT)
            raise TimeoutError("timed out")
        time.sleep(0.004)
        return BITS.setdefault(self.ip, {}).get(f"{t}{n}", 0)

    def read_many(self, pairs):
        return [self.read_one(t, n) for t, n in pairs]

    def close(self):
        self.closed = True


class FakeMbDrv(FakeDrv):
    """Modbus jaisa -- `alive()` hai (pymodbus `connected`)."""
    def alive(self):
        return self.ip not in DEAD and not self.closed


def fake_connect(plc, timer=4):
    if plc["plc_ip"] in DEAD:
        time.sleep(DEAD_WAIT)
        raise ConnectionError("Modbus TCP connect failed")
    return (FakeMbDrv if A._is_modbus(plc.get("protocol")) else FakeDrv)(plc["plc_ip"])


def fake_reachable(ip, port, timeout=1.5):
    if ip in DEAD:
        time.sleep(DEAD_WAIT)
        return False
    return True


# ── naqli line PLC: 9 MC + 8 Modbus chalu, 3 Modbus band (LOOP_PIPE jaise) ──
DEVS, ROWS = [], {}
for i in range(20):
    did = 900 + i
    proto = "MC" if i < 9 else "MODBUS"
    ip = f"10.8.0.{i + 1}"
    DEVS.append({"id": did, "zone": "Z", "line": f"L{i}", "machine_no": None, "machine_name": None,
                 "ip": ip, "port": 5002 if proto == "MC" else 506,
                 "series": "Q" if proto == "MC" else "FX5U", "protocol": proto, "unit_id": 1,
                 "sub_ip": None, "sub_port": None, "sub_series": None, "sub_protocol": None,
                 "sub_unit_id": None, "enabled": True})
    t = "M" if proto == "MC" else "HR"
    ROWS[did] = [{"plc_id": did, "do_index": d, "bit_type": t, "bit_no": str(100 + d)}
                 for d in (1, 2, 3, 4)]
IP = {d["id"]: d["ip"] for d in DEVS}
BITKEY = {d["id"]: ("M" if d["protocol"] == "MC" else "HR") for d in DEVS}
DEAD_IDS = [917, 918, 919]
DEAD.update(IP[d] for d in DEAD_IDS)
MC_IDS = [900, 903, 906]
MB_IDS = [910, 913, 915]

# ── sub-PLC (model wali): 900 chalu + model, 901 BAND, 902 chalu + model ──
SUB = {900: "10.8.2.1", 901: "10.8.2.2", 902: "10.8.2.3"}
MODELS = {}
for _d, _ip in SUB.items():
    _dv = next(x for x in DEVS if x["id"] == _d)
    _dv.update(sub_ip=_ip, sub_port=5002, sub_series="Q", sub_protocol="MC", sub_unit_id=1)
    BITS.setdefault(_ip, {})["D1016"] = 5
for _d in (900, 902):
    MODELS[_d] = [{"plc_id": _d, "device_type": "D", "device_no": "1016", "value": 5, "nm": "MODEL-5"},
                  {"plc_id": _d, "device_type": "D", "device_no": "1016", "value": 7, "nm": "MODEL-7"}]
DEAD.add(SUB[901])


def setbit(did, do, v):
    BITS.setdefault(IP[did], {})[f"{BITKEY[did]}{100 + do}"] = 1 if v else 0


# ── naqli DB: call kholna / ACK / band (asli _apply_state jaisa hi niyam) ──
OPEN, LOG, FAIL_NEXT, CFG_CALLS = {}, [], set(), []
OPENED_MODEL = {}          # (did, do) -> call khulte waqt ka model
ACK_OF = {2: 1, 4: 3}


def fake_apply_db(cur, dev, batch):
    did = dev["id"]
    if did in FAIL_NEXT:
        FAIL_NEXT.discard(did)
        raise RuntimeError("naqli DB galti")
    closed, acked, changed = [], [], False
    for r in batch:
        for do, val in r["bits"]:
            on = val != 0
            if do in ACK_OF:
                ev = OPEN.get((did, ACK_OF[do]))
                if on and ev and not ev["acked"]:
                    ev["acked"] = True
                    LOG.append((time.monotonic(), did, ACK_OF[do], "acknowledged"))
                    acked.append(1)
                    changed = True
                continue
            if on and (did, do) not in OPEN:
                OPEN[(did, do)] = {"acked": False}
                OPENED_MODEL[(did, do)] = r["model"]
                LOG.append((time.monotonic(), did, do, "opened"))
                changed = True
            elif not on and (did, do) in OPEN:
                OPEN.pop((did, do))
                LOG.append((time.monotonic(), did, do, "closed"))
                closed.append((None, None))
                changed = True
    return closed, acked, changed


class FakeConn:
    def __enter__(self): return self
    def __exit__(self, *a): return False
    def commit(self): pass


def fake_read_config():
    CFG_CALLS.append(time.monotonic())
    return [dict(d) for d in DEVS], ROWS, MODELS, {}


A._connect = fake_connect
A._reachable = fake_reachable
A._in_read_config = fake_read_config
A._in_apply_db = fake_apply_db
A._in_stamp = lambda did, ok, why: None
A._stale_call_sweep = lambda: None
A._ensure_tables = lambda: None
A.get_conn = lambda: FakeConn()
A.dict_cursor = lambda conn: None
A.auto_slip_on_close = lambda *a, **k: None
A.auto_slip_on_ack = lambda *a, **k: None

_fail = 0


def T(name, ok, extra=""):
    global _fail
    if not ok:
        _fail += 1
    print("   %s  %-64s %s" % ("PASS" if ok else "FAIL", name, extra))


def wait_log(did, do, action, since, timeout):
    t0 = time.monotonic()
    while time.monotonic() - t0 < timeout:
        for t, d, o, a in LOG:
            if t >= since and d == did and o == do and a == action:
                return t - since
        time.sleep(0.005)
    return None


def wait_until(fn, timeout):
    t0 = time.monotonic()
    while time.monotonic() - t0 < timeout:
        if fn():
            return True
        time.sleep(0.01)
    return False


# ── poller shuru hone se PEHLE (koi dakhal na de) ──
print("\n--- (10) lambi line (120 badlav) -> 50 + 50 + 20, kram se ---")
SIZES = []
_real_apply_db = A._in_apply_db


def _rec_apply_db(cur, dev, batch):
    SIZES.append(len(batch))
    return _real_apply_db(cur, dev, batch)


class _FW:
    def __init__(self):
        import collections
        self.changes, self.latest = collections.deque(), None


A._in_apply_db = _rec_apply_db
fw, appl = _FW(), {}
for k in range(120):
    fw.changes.append({"ok": True, "sub_ok": None, "bits": [(1, (k + 1) % 2)], "model": None,
                       "fault": None, "at": time.monotonic()})
fw.latest = fw.changes[-1]
dv = {"id": 991}
for _ in range(3):
    A._in_apply(dv, fw, appl)
A._in_apply_db = _real_apply_db
seq991 = [a for t, d, o, a in LOG if d == 991]
T("teen transaction: 50, 50, 20", SIZES == [50, 50, 20], str(SIZES))
T("line khaali + 60 khuli / 60 band, baari-baari", not fw.changes and len(seq991) == 120
  and all(a == ("opened" if i % 2 == 0 else "closed") for i, a in enumerate(seq991)))

print("\n--- (11) purana reader band hua, par usi PLC ka naya reader chal raha ---")
d990 = dict(DEVS[0], id=990, ip="10.8.1.90", sub_ip=None)
r990 = [{"plc_id": 990, "do_index": 1, "bit_type": "M", "bit_no": "101"}]
W1 = A._InWorker(990)
W1.configure(d990, r990, [], [])
T("purana reader juda", wait_until(lambda: (W1.latest or {}).get("ok"), 3))
drv = A._PLC_CONN[990][0]
W2 = A._IN_WORKERS[990] = A._InWorker(990)             # PLC turant dobara chalu
W2.configure(d990, r990, [], [])
W1.stop()
W1._t.join(3)
T("purana ruka, naye ka connection NAHI toota", not W1._t.is_alive() and 990 in A._PLC_CONN
  and A._PLC_CONN[990][0] is drv and not drv.closed)
A._in_stop(990)
W2._t.join(3)
T("aakhri reader ruka -> connection chhoda", not W2._t.is_alive() and 990 not in A._PLC_CONN
  and drv.closed)

threading.Thread(target=A._plc_poll_loop, daemon=True, name="poller").start()
time.sleep(4.0)                           # reader chalu + band PLC apni atkan ki taal me

print("\n--- (2) har line PLC ka apna reader thread ---")
names = {t.name for t in threading.enumerate() if t.name.startswith("andon-in-")}
T("20 line PLC -> 20 reader thread", len(names) == 20, f"{len(names)} thread")

print("\n--- (1) 3 BAND PLC ke saath chalti line ki call kitni der me DB tak ---")
lat_mc, lat_mb = [], []
for k in range(6):
    for did, bucket in ((MC_IDS[k % 3], lat_mc), (MB_IDS[k % 3], lat_mb)):
        t0 = time.monotonic()
        setbit(did, 1, 1)
        x = wait_log(did, 1, "opened", t0, 10)
        bucket.append(x if x is not None else 99)
        t1 = time.monotonic()
        setbit(did, 1, 0)
        y = wait_log(did, 1, "closed", t1, 10)
        bucket.append(y if y is not None else 99)
    time.sleep(0.37)                      # band PLC ki taal ke alag-alag pal par
T("MC line: call khuli / band -- sabse der wali 0.5 s ke andar", max(lat_mc) < 0.5,
  f"max {max(lat_mc):.3f}s, avg {sum(lat_mc) / len(lat_mc):.3f}s")
T("Modbus line: 1.0 s ke andar (Modbus har 0.4 s padhte hain)", max(lat_mb) < 1.0,
  f"max {max(lat_mb):.3f}s, avg {sum(lat_mb) / len(lat_mb):.3f}s")

print("\n--- (3)+(4) kram: call -> chhota ACK pulse (0.25 s) -> band ---")
did = 903
t0 = time.monotonic()
setbit(did, 1, 1)
time.sleep(0.3)
setbit(did, 2, 1)
time.sleep(0.25)
setbit(did, 2, 0)
time.sleep(0.3)
setbit(did, 1, 0)
time.sleep(0.6)
seq = [a for t, d, o, a in LOG if t >= t0 and d == did and o == 1]
T("DB tak kram: opened -> acknowledged -> closed", seq == ["opened", "acknowledged", "closed"],
  str(seq))

print("\n--- (5) DB ek baar fail ---")
did = 906
FAIL_NEXT.add(did)
t0 = time.monotonic()
setbit(did, 1, 1)
x = wait_log(did, 1, "opened", t0, 5)
T("pehli koshish fail, agle chakkar me call khuli", x is not None and did not in FAIL_NEXT,
  f"{x:.3f}s" if x is not None else "")
setbit(did, 1, 0)
wait_log(did, 1, "closed", t0, 5)

print("\n--- (6) band PLC ka haal ---")
st = [A._PLC_STATUS.get(d, {}) for d in DEAD_IDS]
T("band 3: online=False + wajah", all(s.get("online") is False and s.get("poll_error") for s in st),
  (st[0].get("poll_error") or "")[:60])
T("chalu 17: online=True", all(A._PLC_STATUS.get(d["id"], {}).get("online") is True
                               for d in DEVS if d["id"] not in DEAD_IDS))

print("\n--- (8) band PLC chalu hua ---")
back = DEAD_IDS[0]
DEAD.discard(IP[back])
A._PLC_RETRY.pop(back, None)
t0 = time.monotonic()
ok_t = None
while time.monotonic() - t0 < 10:
    if A._PLC_STATUS.get(back, {}).get("online") is True:
        ok_t = time.monotonic() - t0
        break
    time.sleep(0.02)
T("apne aap juda (online=True)", ok_t is not None, f"{ok_t:.1f}s" if ok_t is not None else "")
t1 = time.monotonic()
setbit(back, 1, 1)
T("uski call pakdi", wait_log(back, 1, "opened", t1, 3) is not None)
setbit(back, 1, 0)
wait_log(back, 1, "closed", t1, 3)

print("\n--- (7) PLC band (disabled) / hatayi ---")
dis = next(d for d in DEVS if d["id"] == 912)
dis["enabled"] = False
time.sleep(1.2)
T("disabled: reader ruka", not [t for t in threading.enumerate()
                                if t.name == "andon-in-912" and t.is_alive()])
T("disabled: online=None", A._PLC_STATUS.get(912, {}).get("online") is None)
DEVS[:] = [d for d in DEVS if d["id"] != 914]
time.sleep(1.2)
T("hatayi: reader ruka + haal hata", 914 not in A._IN_WORKERS and 914 not in A._PLC_STATUS)

def toggle(did, n, gap):
    """n baar call ON -> OFF; har baar khulne / band hone ki der."""
    lat = []
    for _ in range(n):
        t0 = time.monotonic()
        setbit(did, 1, 1)
        x = wait_log(did, 1, "opened", t0, 10)
        lat.append(x if x is not None else 99)
        t1 = time.monotonic()
        setbit(did, 1, 0)
        y = wait_log(did, 1, "closed", t1, 10)
        lat.append(y if y is not None else 99)
        time.sleep(gap)
    return lat


print("\n--- (12) sub-PLC ka apna thread; BAND sub-PLC (901) apni line ko late nahi karti ---")
subs = sorted(t.name for t in threading.enumerate() if t.name.startswith("andon-sub-"))
T("3 sub-PLC -> 3 alag thread", subs == ["andon-sub-900", "andon-sub-901", "andon-sub-902"], str(subs))
lat = toggle(901, 14, 0.25)                  # ~8 s -- sub ke tatolne (har 5 s, 1.5 s) ke upar se
T("901 (sub band): har call 0.5 s ke andar", max(lat) < 0.5,
  f"max {max(lat):.3f}s, avg {sum(lat) / len(lat):.3f}s")
s901 = A._PLC_STATUS.get(901, {})
T("901: online=True, sub_online=False", s901.get("online") is True and s901.get("sub_online") is False)

print("\n--- (13) chalti sub-PLC (900) se model, call ke pal par ---")
toggle(900, 1, 0.1)
T("call ke saath model = MODEL-5 (sub-PLC ke D1016 se)", OPENED_MODEL.get((900, 1)) == "MODEL-5",
  str(OPENED_MODEL.get((900, 1))))
BITS[SUB[900]]["D1016"] = 7
toggle(900, 1, 0.1)
T("sub par model badla -> agli call MODEL-7", OPENED_MODEL.get((900, 1)) == "MODEL-7",
  str(OPENED_MODEL.get((900, 1))))

print("\n--- (14) chalti sub-PLC (902) achanak band -- connection latka ---")
T("902 ka sub juda hua", wait_until(lambda: 902 in A._SUB_CONN, 5))
sub_drv = A._SUB_CONN[902][0]
DEAD.add(SUB[902])                           # bijli gayi: purana connection read par atkega
first = toggle(902, 1, 0.1)
T("pehli call: ek hi baar ka intezaar (~1.5 s), model khaali", first[0] < 2.5
  and OPENED_MODEL.get((902, 1)) is None, f"{first[0]:.2f}s")
T("latka connection chhoda (band kiya)", 902 not in A._SUB_CONN and sub_drv.closed)
rest = toggle(902, 6, 0.2)
T("baad ki 6 call: har baar 0.5 s ke andar (har chakkar atakna nahi)", max(rest) < 0.5,
  f"max {max(rest):.3f}s")
T("902: sub_online=False, line online=True", A._PLC_STATUS.get(902, {}).get("sub_online") is False
  and A._PLC_STATUS.get(902, {}).get("online") is True)
DEAD.discard(SUB[902])                       # wapas aayi
A._SUB_RETRY.pop(902, None)                  # (UI ka Recheck yahi karta hai)
T("wapas aayi -> apne thread ne phir joda", wait_until(lambda: 902 in A._SUB_CONN, 5))
toggle(902, 1, 0.1)
T("phir se model aaya", OPENED_MODEL.get((902, 1)) == "MODEL-5", str(OPENED_MODEL.get((902, 1))))

print("\n--- (15) sub-PLC ka IP badla / hataya ---")
old = A._SUB_CONN[900][0]
BITS.setdefault("10.8.2.9", {})["D1016"] = 5
next(d for d in DEVS if d["id"] == 900)["sub_ip"] = "10.8.2.9"
T("naya IP -> naya connection", wait_until(lambda: 900 in A._SUB_CONN
                                          and A._SUB_CONN[900][1][0] == "10.8.2.9", 3))
T("purana connection band", old.closed)
toggle(900, 1, 0.1)
T("naye sub se model", OPENED_MODEL.get((900, 1)) == "MODEL-5")
new = A._SUB_CONN[900][0]
next(d for d in DEVS if d["id"] == 900)["sub_ip"] = None
T("sub hataya -> connection chhoda", wait_until(lambda: 900 not in A._SUB_CONN, 3) and new.closed)
toggle(900, 1, 0.1)
T("bina sub: call khuli, model khaali (sub hi nahi)", OPENED_MODEL.get((900, 1)) is None)

print("\n--- (16) chalte system me NAYI PLC jodi (930 MC + sub-PLC, 931 Modbus) ---")
for _did, _proto, _ip, _sub in ((930, "MC", "10.8.0.30", "10.8.2.30"),
                                (931, "MODBUS", "10.8.0.31", None)):
    _t = "M" if _proto == "MC" else "HR"
    ROWS[_did] = [{"plc_id": _did, "do_index": d, "bit_type": _t, "bit_no": str(100 + d)}
                  for d in (1, 2, 3, 4)]
    IP[_did], BITKEY[_did] = _ip, _t
    if _sub:
        BITS.setdefault(_sub, {})["D1016"] = 5
        MODELS[_did] = [{"plc_id": _did, "device_type": "D", "device_no": "1016",
                         "value": 5, "nm": "MODEL-5"}]
    DEVS.append({"id": _did, "zone": "Z", "line": f"NEW{_did}", "machine_no": None,
                 "machine_name": None, "ip": _ip, "port": 5002 if _proto == "MC" else 506,
                 "series": "Q" if _proto == "MC" else "FX5U", "protocol": _proto, "unit_id": 1,
                 "sub_ip": _sub, "sub_port": 5002 if _sub else None,
                 "sub_series": "Q" if _sub else None, "sub_protocol": "MC" if _sub else None,
                 "sub_unit_id": 1 if _sub else None, "enabled": True})
t_add = time.monotonic()


def _alive(name):
    return any(th.name == name and th.is_alive() for th in threading.enumerate())


t_thr = wait_until(lambda: _alive("andon-in-930") and _alive("andon-in-931")
                   and _alive("andon-sub-930") and 930 in A._SUB_CONN, 5)
T("bina restart: andon-in-930, andon-sub-930, andon-in-931 chalu", t_thr,
  f"{time.monotonic() - t_add:.2f}s")
T("931 (bina sub-PLC) ka sub thread nahi bana", not _alive("andon-sub-931"))
lat930, lat931 = toggle(930, 3, 0.1), toggle(931, 3, 0.1)
T("930 (MC): call 0.5 s ke andar + model sub-PLC se", max(lat930) < 0.5
  and OPENED_MODEL.get((930, 1)) == "MODEL-5", f"max {max(lat930):.3f}s")
T("931 (Modbus): call 1.0 s ke andar", max(lat931) < 1.0, f"max {max(lat931):.3f}s")
T("dono online=True", A._PLC_STATUS.get(930, {}).get("online") is True
  and A._PLC_STATUS.get(931, {}).get("online") is True)

print("\n--- (9) poller (DB wala) chakkar kabhi nahi atka ---")
gaps = [b - a for a, b in zip(CFG_CALLS, CFG_CALLS[1:])]
T("do chakkar ke beech sabse lamba gap 0.4 s se kam", max(gaps) < 0.4,
  f"max {max(gaps) * 1000:.0f} ms, {len(CFG_CALLS)} chakkar")

print("\n   %s\n" % (">>> SAB PASS" if not _fail else ">>> %d FAIL" % _fail))
sys.stdout.flush()
os._exit(1 if _fail else 0)
