# -*- coding: utf-8 -*-
"""ANDON call padhna -- DB wala hissa ASLI DB par, par SIRF ROLLBACK (2026-09-26).

Reader thread jo haal padhta hai, poller use `_in_apply` -> `_in_apply_db` ->
`_apply_state` se DB me lagata hai.  Ye test ASLI `_apply_state` (asli SQL)
chalata hai -- ek naqli PLC 'ZZ_TEST_INREADER' (enabled=FALSE) par:
  (1) call ON                      -> andon_system me OPEN (dept / model / fault sahi)
  (2) ACK ON                       -> acknowledged_at + ack slip bulaya
  (3) call OFF                     -> andon_history me, OPEN hata, close slip bulaya
  (4) ek hi batch me ON->ACK->OFF  -> teeno usi kram me
  (5) badlav nahi + 1 s nahi hua   -> DB ko haath nahi (periodic chhoot)
  (6) atka (purana) haal           -> dobara nahi lagta
  (7) DB ek baar fail              -> line (queue) wahi rehti, agli baar lagta
  (8) band PLC ki khuli call       -> _stale_call_sweep band karta

⚠ PROD DB: sab kuch EK transaction me; `commit` naqli (kuch nahi hota); aakhir
me ROLLBACK, phir naye connection se jaanch ki kuch bhi nahi bacha.  Slip wale
function naqli (asli slip nahi banti).  lock_timeout 2 s -- kisi ka intezaar
nahi karte.  Sirf sequence (id ginti) aage badhti hai -- rollback me wo waapas
nahi aati, bas.

Chalane ka tareeqa (Phase2 folder se):
    .venv/Scripts/python.exe tests/test_andon_input_apply_db.py
"""
import collections
import os
import sys
import time

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(_HERE))
from dotenv import load_dotenv                                    # noqa: E402
load_dotenv(os.path.join(os.path.dirname(_HERE), ".env"), override=True)
import routers.andon as A                                         # noqa: E402
from database import get_conn, dict_cursor                        # noqa: E402

NAME = "ZZ_TEST_INREADER"
A._ensure_tables = lambda: None                                   # DDL kabhi nahi
SLIPS = []
A.auto_slip_on_close = lambda eid, hid: SLIPS.append(("close", eid, hid))
A.auto_slip_on_ack = lambda eid: SLIPS.append(("ack", eid))

_fail = 0


def T(name, ok, extra=""):
    global _fail
    if not ok:
        _fail += 1
    print("   %s  %-60s %s" % ("PASS" if ok else "FAIL", name, extra))


class _Rollback(Exception):
    pass


class ConnProxy:
    """Asli connection -- par `commit` NAQLI.  Baaki sab asli ko."""
    def __init__(self, real):
        self._real = real
        self.commits = 0

    def commit(self):
        self.commits += 1

    def __getattr__(self, k):
        return getattr(self._real, k)


class Ctx:
    def __init__(self, p):
        self.p = p

    def __enter__(self):
        return self.p

    def __exit__(self, *a):
        return False


class FakeWorker:
    def __init__(self):
        self.changes = collections.deque()
        self.latest = None


def reading(bits, model=None, fault=None, ago=0.0):
    return {"ok": True, "sub_ok": None, "bits": bits, "model": model, "fault": fault,
            "at": time.monotonic() - ago}


with get_conn() as _c:                                            # pehle: koi purana bacha to nahi
    _cur = dict_cursor(_c)
    _cur.execute("SELECT COUNT(*) AS n FROM andon_plc_devices WHERE name=%s", (NAME,))
    assert _cur.fetchone()["n"] == 0, "pichhla ZZ_TEST bacha hai -- pehle dekho"
    _cur.execute("SELECT MAX(id) AS m FROM andon_plc_devices")
    MAX_BEFORE = _cur.fetchone()["m"]
    _c.rollback()

did = None
t_start = time.monotonic()
try:
    with get_conn() as real:
        cur = dict_cursor(real)
        cur.execute("SET LOCAL lock_timeout = '2s'")
        cur.execute("SET LOCAL statement_timeout = '15s'")
        cur.execute("SET LOCAL idle_in_transaction_session_timeout = '60s'")
        cur.execute("""INSERT INTO andon_plc_devices (name, ip, zone, line, enabled, protocol, series)
                       VALUES (%s, '10.254.254.254', 'ZZ_TEST', 'ZZ_TEST', FALSE, 'MC', 'Q')
                       RETURNING id, zone, line, machine_no, machine_name, ip, port, series,
                                 protocol, unit_id, sub_ip, sub_port, sub_series,
                                 sub_protocol, sub_unit_id, enabled""", (NAME,))
        dev = dict(cur.fetchone())
        did = dev["id"]
        ack = A._ack_map(cur, did)
        print(f"\n   naqli PLC id {did}; ACK map {ack}")
        CALL, ACK = 1, 2
        T("ACK map: DO2 -> DO1 (default)", ack.get(ACK) == CALL, str(ack))

        proxy = ConnProxy(real)
        A.get_conn = lambda: Ctx(proxy)
        w, applied = FakeWorker(), {}

        def open_rows():
            cur.execute("""SELECT id, do_index, department_id, display_name, model, fault,
                                  acknowledged_at FROM andon_system
                            WHERE plc_id=%s AND state='OPEN' ORDER BY id""", (did,))
            return cur.fetchall()

        def hist_rows():
            cur.execute("""SELECT id, do_index, model, duration_seconds, response_seconds
                             FROM andon_history WHERE plc_id=%s ORDER BY id""", (did,))
            return cur.fetchall()

        def push(r):
            w.changes.append(r)
            w.latest = r

        print("\n--- (1) call ON ---")
        A._OUT_WAKE.clear()
        push(reading([(CALL, 1), (ACK, 0)], model="ZZM", fault="ZZF"))
        A._in_apply(dev, w, applied)
        o = open_rows()
        T("andon_system me 1 OPEN call", len(o) == 1 and o[0]["do_index"] == CALL)
        T("dept 9 (Maintenance), model/fault sahi",
          bool(o) and o[0]["department_id"] == 9 and o[0]["model"] == "ZZM" and o[0]["fault"] == "ZZF",
          str(dict(o[0])) if o else "")
        T("line (queue) khaali + ek commit + output writer jagaya",
          not w.changes and proxy.commits == 1 and A._OUT_WAKE.is_set())
        eid1 = o[0]["id"] if o else None

        print("\n--- (2) ACK ON ---")
        push(reading([(CALL, 1), (ACK, 1)], model="ZZM", fault="ZZF"))
        A._in_apply(dev, w, applied)
        o = open_rows()
        T("acknowledged_at bhara", bool(o) and o[0]["acknowledged_at"] is not None)
        T("ack slip bulaya (naqli)", ("ack", eid1) in SLIPS)

        print("\n--- (3) call OFF ---")
        push(reading([(CALL, 0), (ACK, 0)]))
        A._in_apply(dev, w, applied)
        h = hist_rows()
        T("OPEN hata, andon_history me 1 row", not open_rows() and len(h) == 1)
        T("history me model + response bhara", bool(h) and h[0]["model"] == "ZZM"
          and h[0]["response_seconds"] is not None, str(dict(h[0])) if h else "")
        T("close slip bulaya (naqli)", bool(h) and ("close", eid1, h[0]["id"]) in SLIPS)

        print("\n--- (4) ek hi batch me ON -> ACK -> OFF ---")
        n_slip = len(SLIPS)
        w.changes.extend([reading([(CALL, 1), (ACK, 0)]), reading([(CALL, 1), (ACK, 1)]),
                          reading([(CALL, 0), (ACK, 0)])])
        w.latest = w.changes[-1]
        A._in_apply(dev, w, applied)
        h = hist_rows()
        kinds = [s[0] for s in SLIPS[n_slip:]]
        T("history 2 row, OPEN khaali, line khaali", len(h) == 2 and not open_rows() and not w.changes)
        T("slip kram: ack phir close", kinds == ["ack", "close"], str(kinds))

        print("\n--- (5) badlav nahi, 1 s nahi hua -> DB ko haath nahi ---")
        c0 = proxy.commits
        A._in_apply(dev, w, applied)
        T("koi commit nahi", proxy.commits == c0)
        applied[did] = (applied[did][0], time.monotonic() - 2.0)
        A._in_apply(dev, w, applied)
        T("1 s baad periodic milaan (1 commit, koi naya call nahi)",
          proxy.commits == c0 + 1 and not open_rows() and len(hist_rows()) == 2)

        print("\n--- (6) atka (purana) haal ---")
        c0 = proxy.commits
        w.latest = reading([(CALL, 1), (ACK, 0)], ago=A._IN_STALE_S + 5)
        applied[did] = (None, -1e9)
        A._in_apply(dev, w, applied)
        T("purana ON dobara nahi lagaya", proxy.commits == c0 and not open_rows())

        print("\n--- (7) DB ek baar fail ---")
        real_apply_db = A._in_apply_db

        def _boom(*a, **k):
            A._in_apply_db = real_apply_db
            raise RuntimeError("naqli DB galti")
        A._in_apply_db = _boom
        push(reading([(CALL, 1), (ACK, 0)]))
        try:
            A._in_apply(dev, w, applied)
            T("pehli koshish me galti aayi", False)
        except RuntimeError:
            T("pehli koshish me galti aayi", True)
        T("badlav line me wahi raha", len(w.changes) == 1 and not open_rows())
        A._in_apply(dev, w, applied)
        T("agli koshish me call khuli", len(open_rows()) == 1 and not w.changes)

        print("\n--- (8) band PLC (enabled=FALSE) ki khuli call -> stale sweep ---")
        n_slip = len(SLIPS)
        A._stale_call_sweep()
        T("sweep ne call band ki + close slip",
          not open_rows() and len(hist_rows()) == 3 and [s[0] for s in SLIPS[n_slip:]] == ["close"])

        print(f"\n   (transaction {time.monotonic() - t_start:.1f}s)")
        real.rollback()
        raise _Rollback()
except _Rollback:
    pass

print("\n--- ROLLBACK ke baad: kuch bacha to nahi ---")
with get_conn() as _c:
    _cur = dict_cursor(_c)
    _cur.execute("SELECT COUNT(*) AS n FROM andon_plc_devices WHERE name=%s", (NAME,))
    n_dev = _cur.fetchone()["n"]
    _cur.execute("SELECT COUNT(*) AS n FROM andon_system WHERE plc_id=%s", (did,))
    n_sys = _cur.fetchone()["n"]
    _cur.execute("SELECT COUNT(*) AS n FROM andon_history WHERE plc_id=%s", (did,))
    n_his = _cur.fetchone()["n"]
    _cur.execute("SELECT MAX(id) AS m FROM andon_plc_devices")
    max_after = _cur.fetchone()["m"]
    _c.rollback()
T("naqli PLC / call / history -- kuch nahi bacha", n_dev == 0 and n_sys == 0 and n_his == 0,
  f"dev {n_dev}, system {n_sys}, history {n_his}")
T("PLC list jyon ki tyon", max_after == MAX_BEFORE, f"max id {max_after}")

print("\n   %s\n" % (">>> SAB PASS" if not _fail else ">>> %d FAIL" % _fail))
sys.exit(1 if _fail else 0)
