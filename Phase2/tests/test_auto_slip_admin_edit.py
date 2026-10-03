# -*- coding: utf-8 -*-
"""AUTO slip ka ADMIN edit (PUT /api/breakdown-slips/auto/{id}) -- ASLI DB, SIRF ROLLBACK.

User 2026-10-03: "historical data me auto breakdown slip edit karne par time edit
nahi ho raha -- edit ka matlab sab kuch edit".  Ab admin edit me ANDON ke date /
time / downtime / response bhi badalte hain; sirf problem_related_to lock.

  (1) time / date / minutes bheje -> sab badle; problem_related_to chhoota
      (`locked_skipped` me), action_taken badla
  (2) time na bheje (sirf action) -> time / date / minutes jyon ke tyon
  (3) audit AUTO_SLIP_EDIT: "badle:" me bd_start_time; time na bheje to nahi
  (4) ROLLBACK ke baad: asli row bilkul pehle jaisi (naye connection se)

⚠ PROD DB: ek hi connection, `commit` kabhi nahi (har request ek SAVEPOINT);
aakhir me ROLLBACK, phir naye connection se jaancha.  DDL nahi (`_ensured`).
Sabse nayi auto slip par UPDATE hota hai -- rollback se wapas.
Chalane ka tareeqa (Phase2 folder se):
    .venv/Scripts/python.exe tests/test_auto_slip_admin_edit.py
"""
import os
import sys
import types
from contextlib import contextmanager

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(_HERE))
from dotenv import load_dotenv                                    # noqa: E402
load_dotenv(os.path.join(os.path.dirname(_HERE), ".env"), override=True)
from fastapi import HTTPException                                 # noqa: E402
import database                                                   # noqa: E402
import routers.breakdown_slips as BS                              # noqa: E402

_fail = 0


def T(name, ok, extra=""):
    global _fail
    if not ok:
        _fail += 1
    print("   %s  %-66s %s" % ("PASS" if ok else "FAIL", name, extra))


def err(fn, *a, **k):
    try:
        return None, fn(*a, **k)
    except HTTPException as e:
        return e.status_code, e.detail


pool = database._get_pool()
conn = pool.getconn()


class _Proxy:
    def __init__(self, c):
        self._c = c

    def commit(self):
        pass

    def rollback(self):
        self._c.cursor().execute("ROLLBACK TO SAVEPOINT req")

    def __getattr__(self, n):
        return getattr(self._c, n)


@contextmanager
def fake_get_conn():
    cur = conn.cursor()
    cur.execute("SAVEPOINT req")
    try:
        yield _Proxy(conn)
        cur.execute("RELEASE SAVEPOINT req")
    except Exception:
        cur.execute("ROLLBACK TO SAVEPOINT req")
        cur.execute("RELEASE SAVEPOINT req")
        raise


AUDIT = []
sys.modules["main"] = types.SimpleNamespace(write_audit=lambda *a, **k: AUDIT.append(k))
ADMIN = {"id": -9301, "username": "zz_auto_admin", "role": "admin"}
COLS = ["bd_start_date", "bd_end_date", "bd_start_time", "bd_received_time", "bd_ok_time",
        "response_time_minutes", "mc_down_time_minutes", "problem_related_to", "action_taken_on_problem"]
TBL = BS.AUTO_SLIP_TABLE
pehle = None
sid = None


def s(v):
    return "" if v is None else str(v)[:5] if hasattr(v, "hour") else str(v)


try:
    conn.autocommit = False
    c = database.dict_cursor(conn)
    c.execute("SET LOCAL lock_timeout = '2s'")
    c.execute("SET LOCAL statement_timeout = '20s'")
    c.execute(f"SELECT id, {', '.join(COLS)} FROM {TBL} "
              f"WHERE bd_start_time IS NOT NULL AND bd_start_date IS NOT NULL ORDER BY id DESC LIMIT 1")
    pehle = c.fetchone()
    assert pehle, "koi auto slip nahi mili"
    sid = pehle["id"]
    print("auto slip #%s (rollback me)" % sid)

    BS.get_conn = fake_get_conn
    BS._ensured = True

    def row():
        c.execute(f"SELECT {', '.join(COLS)} FROM {TBL} WHERE id = %s", (sid,))
        return c.fetchone()

    rel = pehle["problem_related_to"]
    ulta = {"maintenance": False, "tool_room": True}
    print("\n(1) time / date / minutes bheje")
    body = BS.AutoSlipFill(
        production_data={"bd_start_date": "2026-09-01", "bd_end_date": "2026-09-02",
                         "bd_start_time": "23:10", "bd_received_time": "23:15", "bd_ok_time": "01:40",
                         "response_time_minutes": "5", "mc_down_time_minutes": "150"},
        maintenance_data={"problem_related_to": ulta, "action_taken_on_problem": "ZZ ADMIN SUDHAAR"},
        src="maintenance")
    st, r = err(BS.admin_update_auto_slip, sid, body, ADMIN)
    T("200 + locked_skipped = sirf problem_related_to", st is None and r["locked_skipped"] == ["problem_related_to"], r)
    x = row()
    T("date badli (start / end)", s(x["bd_start_date"]) == "2026-09-01" and s(x["bd_end_date"]) == "2026-09-02",
      (s(x["bd_start_date"]), s(x["bd_end_date"])))
    T("time badle (start / received / ok)", (s(x["bd_start_time"]), s(x["bd_received_time"]), s(x["bd_ok_time"]))
      == ("23:10", "23:15", "01:40"), (s(x["bd_start_time"]), s(x["bd_received_time"]), s(x["bd_ok_time"])))
    T("minutes badle (response 5, downtime 150)", s(x["response_time_minutes"]) in ("5", "5.0")
      and s(x["mc_down_time_minutes"]) in ("150", "150.0"), (x["response_time_minutes"], x["mc_down_time_minutes"]))
    T("problem_related_to NAHI badla", x["problem_related_to"] == rel, (x["problem_related_to"], rel))
    T("action_taken badla", x["action_taken_on_problem"] == "ZZ ADMIN SUDHAAR")
    a = [k for k in AUDIT if k.get("action") == "AUTO_SLIP_EDIT"]
    T("audit AUTO_SLIP_EDIT me bd_start_time + problem_related_to chhoota",
      a and "bd_start_time" in a[-1]["details"] and "problem_related_to" in a[-1]["details"], a[-1]["details"] if a else "")

    print("\n(2) time NA bheje (sirf action)")
    n = len(AUDIT)
    st, r = err(BS.admin_update_auto_slip, sid, BS.AutoSlipFill(
        maintenance_data={"action_taken_on_problem": "ZZ DOOSRA SUDHAAR"}, src="maintenance"), ADMIN)
    y = row()
    T("200, kuch lock nahi chhoota", st is None and r["locked_skipped"] == [], r)
    T("time / date / minutes jyon ke tyon", all(s(y[k]) == s(x[k]) for k in COLS[:7]))
    T("action badla", y["action_taken_on_problem"] == "ZZ DOOSRA SUDHAAR")
    T("audit me time nahi", len(AUDIT) > n and "bd_start_time" not in AUDIT[-1]["details"], AUDIT[-1]["details"])
finally:
    try:
        conn.rollback()
    finally:
        pool.putconn(conn)

print("\n(4) rollback ke baad")
with database.get_conn() as c2:
    k = database.dict_cursor(c2)
    k.execute(f"SELECT {', '.join(COLS)} FROM {TBL} WHERE id = %s", (sid,))
    baad = k.fetchone()
T("row bilkul pehle jaisi", baad is not None and all(s(baad[col]) == s(pehle[col]) for col in COLS))

print("\nSAB PASS -- 0 fail" if not _fail else "\n%d FAIL" % _fail)
sys.exit(1 if _fail else 0)
