# -*- coding: utf-8 -*-
"""Attendance History (user 2026-09-26: "history ka option ... jisme sab ho").

ASLI DB, SIRF PADHNA.  History ka har din ka haal usi din ke asli board
(`_board`, jo /board?day= deta hai) se HUBAHU milna chahiye -- ek aadmi ek
qatar (emp code se), ginti, aage ke din ginti me nahi, galat range par 400.

  * DDL nahi: `_bani = True` (asli `_ensure` nahi chalta).
  * Log table abhi DB me na ho to usi naam ki TEMP table (sirf is connection
    me, band hote hi gayab) -- asli DB me kuch nahi banta.
  * get_conn = ek hi connection, sirf SELECT, aakhir me rollback + band.

Chalane ka tareeqa (Phase2 folder se):
    .venv/Scripts/python.exe tests/test_attendance_history.py
"""
import os
import sys
from contextlib import contextmanager
from datetime import date, timedelta

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(_HERE))
from dotenv import load_dotenv                                    # noqa: E402
load_dotenv(os.path.join(os.path.dirname(_HERE), ".env"), override=True)
from fastapi import HTTPException                                 # noqa: E402
import database                                                   # noqa: E402
import routers.attendance as A                                    # noqa: E402

_fail = 0


def T(name, ok, extra=""):
    global _fail
    if not ok:
        _fail += 1
    print("   %s  %-62s %s" % ("PASS" if ok else "FAIL", name, extra))


pool = database._get_pool()
conn = pool.getconn()
try:
    conn.autocommit = False
    c = conn.cursor()
    c.execute("SELECT to_regclass('maintenance_attendance_log') IS NOT NULL")
    asli_log = c.fetchone()[0]
    if not asli_log:
        c.execute("""CREATE TEMP TABLE maintenance_attendance_log (
                        id BIGSERIAL PRIMARY KEY, at TIMESTAMP NOT NULL DEFAULT NOW(),
                        by_user VARCHAR(120), day DATE NOT NULL, staff_id INTEGER,
                        staff_name VARCHAR(120), emp_code VARCHAR(40), action VARCHAR(12) NOT NULL,
                        from_slot VARCHAR(10), to_slot VARCHAR(10), detail VARCHAR(300))""")

    @contextmanager
    def _one():
        yield conn

    A.get_conn = _one
    A._bani = True
    ADMIN = {"id": 0, "username": "zz_hist_test", "role": "admin"}

    c.execute("SELECT MIN(day), MAX(day) FROM maintenance_attendance_board")
    lo, hi = c.fetchone()
    today = date.today()
    start, end = lo - timedelta(days=2), max(hi, today) + timedelta(days=2)
    print(f"\n   board ka data {lo} .. {hi};  jaanch {start} .. {end}  (log table asli: {asli_log})")

    h = A.history(start=start.isoformat(), end=end.isoformat(), user=ADMIN)
    days = h["days"]
    n = (end - start).days + 1

    print("\n--- (1) har din: History == asli board ---")
    T("din ki ginti sahi", len(days) == n and days[0] == start.isoformat()
      and days[-1] == end.isoformat(), f"{len(days)} din")
    by_key = {p["key"]: p for p in h["people"]}
    galat = []
    cur = database.dict_cursor(conn)
    for i, dstr in enumerate(days):
        d = date.fromisoformat(dstr)
        asli = {}
        for r in sorted(A._board(cur, d), key=lambda r: r["id"]):   # naya record baad me -> jeetta
            asli[A._hist_key(r)] = A._norm_slot(r["slot"])
        hist = {k: p["slots"][i] for k, p in by_key.items() if p["slots"][i]}
        if asli != hist:
            galat.append((dstr, {k: (asli.get(k), hist.get(k)) for k in set(asli) | set(hist)
                                 if asli.get(k) != hist.get(k)}))
        dt = h["day_totals"][i]
        if dt["total"] != len(asli) or any(dt[s] != sum(1 for v in asli.values() if v == s)
                                           for s in A.SLOTS):
            galat.append((dstr, "day_totals", dt))
    T("har din, har aadmi ki kataar board jaisi (ginti bhi)", not galat,
      "" if not galat else str(galat[:3])[:300])

    print("\n--- (2) ek aadmi = ek qatar (emp code) ---")
    keys = [p["key"] for p in h["people"]]
    T("koi emp code do qatar me nahi", len(keys) == len(set(keys)))
    c.execute("""SELECT COUNT(DISTINCT UPPER(TRIM(emp_code))) FROM maintenance_employee s
                  WHERE COALESCE(TRIM(emp_code),'') <> ''
                    AND EXISTS (SELECT 1 FROM maintenance_attendance_board b WHERE b.staff_id = s.id)""")
    T("jitne alag emp code board par rahe, utni qatar (emp wali)",
      sum(1 for k in keys if k.startswith("E:")) == c.fetchone()[0])

    print("\n--- (3) ginti: sirf aaj tak; aage ke din ginti me nahi ---")
    ok = True
    for p in h["people"]:
        exp = {s: 0 for s in A.SLOTS}
        for dstr, sl in zip(days, p["slots"]):
            if sl and dstr <= h["today"]:
                exp[sl] += 1
        exp["duty"] = exp["G"] + exp["A"] + exp["B"]
        ok = ok and exp == p["totals"]
    T("har aadmi ki ginti (G/A/B/WO/Leave/WFH/duty) sahi", ok)
    fut = [i for i, dstr in enumerate(days) if dstr > h["today"]]
    T("aage ke din bhi dikhte hain (planned)", bool(fut) and any(p["slots"][fut[0]] for p in h["people"]))

    print("\n--- (4) badlav (board se nikale) ---")
    ch = h["changes"]
    T("har badlav ka din range me + kram (naya pehle)",
      all(start.isoformat() <= x["day"] <= end.isoformat() for x in ch)
      and all(ch[i]["day"] >= ch[i + 1]["day"] for i in range(len(ch) - 1)))
    for x in ch[:12]:
        print(f"      {x['day']}  {x['name'][:16]:<16} {x['emp_code']:<5} {x['action']:<6} "
              f"{str(x['from']):<5} -> {str(x['to']):<5} by {x['by']}  {str(x['at'])[:16]}  [{x['source']}]")
    if len(ch) > 12:
        print(f"      … aur {len(ch) - 12}")

    print("\n--- (5) default range + galat range ---")
    d0 = A.history(start=None, end=None, user=ADMIN)
    T("khaali = is mahine ki 1 se aaj", d0["start"] == today.replace(day=1).isoformat()
      and d0["end"] == today.isoformat())
    for bad, why in (((end, start), "ulti"), ((start, start + timedelta(days=A.HIST_MAX_DAYS)), "94 din"),
                     (("2026-13-01", end), "galat tareekh")):
        try:
            A.history(start=str(bad[0]), end=str(bad[1]), user=ADMIN)
            T(f"{why} range -> 400", False)
        except HTTPException as e:
            T(f"{why} range -> 400", e.status_code == 400, e.detail)
    try:
        A.history(start=None, end=None, user={"id": -5, "username": "zz", "role": "operator"})
        T("bina permission -> 403", False)
    except HTTPException as e:
        T("bina permission -> 403", e.status_code == 403)
finally:
    conn.rollback()
    pool.putconn(conn, close=True)

print("\n   %s\n" % (">>> SAB PASS" if not _fail else ">>> %d FAIL" % _fail))
sys.exit(1 if _fail else 0)
