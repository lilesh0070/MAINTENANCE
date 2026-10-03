# -*- coding: utf-8 -*-
"""Attendance LEAVE (arzi -> approve / date badlo / reject / cancel) -- ASLI DB, SIRF ROLLBACK.

Asli endpoint function chalte hain (routers/attendance.py, LEAVE wala hissa):
  (1) arzi: theek -> PENDING, din ginti, mine, applied_by
  (2) galat arzi: To < From, 92 din se zyada, 7 din se purani, list me na ho -> 400
  (3) usi aadmi ki takraati arzi -> 400; alag din / alag aadmi -> chalti hai
  (4) list: pending + rows; approves (supervisor kuch nahi, assistant_manager staff)
  (5) approve: supervisor -> 403; AM -> APPROVED; dobara -> 400
  (6) approve ke saath date badli -> orig_from/orig_to me purani
  (7) PUT date badlo (APPROVED par) -> nayi; orig PEHLI hi rehti hai
  (8) date badal kar usi aadmi ki doosri arzi se takraav -> 400
  (9) reject (note ke saath); dobara -> 400
 (10) cancel: jisne bhari -> CANCELLED; doosra supervisor -> 403; APPROVED -> 400
 (11) record me sab haal (CANCELLED bhi -- "proper record"), REJECTED / APPROVED haan
 (12) ROLLBACK ke baad: leave ki ginti jaisi pehle, ZZ_TEST aadmi nahi

2026-10-03 (baad me): arzi ab sirf APNE naam ki -- doosre ke naam sirf sanjha
"maint" ID / admin.  Isliye yahan bharne wale do sanjha login ("maint" /
"MAINT", alag id); hierarchy ke baaki niyam tests/test_leave_hierarchy.py me.

⚠ PROD DB: ek hi connection, `commit` kabhi nahi -- har "request" ek SAVEPOINT
(fail = usi tak wapas, jaise asli request ka rollback); aakhir me ROLLBACK, phir
naye connection se jaancha ki kuch nahi bacha.  Koi DDL nahi (`_bani` /
`_leave_bani` = True -- leave table prod me pehle se hai).

Chalane ka tareeqa (Phase2 folder se):
    .venv/Scripts/python.exe tests/test_attendance_leave.py
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
    print("   %s  %-66s %s" % ("PASS" if ok else "FAIL", name, extra))


def err(fn, *a, **k):
    """HTTPException ka (status, detail) -- na aaye to (None, jawab)."""
    try:
        return None, fn(*a, **k)
    except HTTPException as e:
        return e.status_code, e.detail


pool = database._get_pool()
conn = pool.getconn()


class _Proxy:
    """Endpoint ka `conn` -- commit kuch nahi karta, rollback = request ke SAVEPOINT tak."""
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


AM  = {"id": -9101, "username": "zz_am",  "role": "assistant_manager"}
# kisi ke bhi naam arzi sirf ADMIN (maint ab nahi -- 2026-10-03) -- do alag id
SUP = {"id": -9102, "username": "zz_ad1", "role": "admin"}
SUP2 = {"id": -9103, "username": "zz_ad2", "role": "admin"}
# na approver, na arzi wala -- 403 wali jaanch ke liye
NON = {"id": -9104, "username": "zz_sup_x", "role": "supervisor"}
MAINT = {"id": -9105, "username": "maint", "role": "supervisor"}

try:
    conn.autocommit = False
    c = database.dict_cursor(conn)
    c.execute("SET LOCAL lock_timeout = '2s'")
    c.execute("SET LOCAL statement_timeout = '20s'")
    c.execute("SET LOCAL idle_in_transaction_session_timeout = '90s'")
    c.execute("SELECT COUNT(*) AS n FROM maintenance_attendance_leave")
    pehle_se = c.fetchone()["n"]
    c.execute("SELECT COUNT(*) AS n FROM maintenance_employee WHERE name LIKE 'ZZ\\_TEST\\_LEAVE%%'")
    assert c.fetchone()["n"] == 0, "pichhla ZZ_TEST_LEAVE bacha hai -- pehle dekho"

    # naqli: DB rasta, DDL band, page ka haq sabko
    A.get_conn = fake_get_conn
    A._bani = True
    A._leave_bani = True
    print("leave pehle se:", pehle_se)

    c.execute("""INSERT INTO maintenance_employee (name, emp_code, designation, created_by, updated_by)
                 VALUES ('ZZ_TEST_LEAVE_A', 'ZZL1', 'Tester', 'zz', 'zz'),
                        ('ZZ_TEST_LEAVE_B', 'ZZL2', 'Tester', 'zz', 'zz')
                 RETURNING id""")
    sa, sb = [r["id"] for r in c.fetchall()]
    today = date.today()
    d = lambda n: (today + timedelta(days=n)).isoformat()      # noqa: E731

    print("\n(1) arzi")
    st, r1 = err(A.apply_leave, A.LeaveIn(staff_id=sa, from_date=d(3), to_date=d(5), reason="  family   function "), SUP)
    T("theek arzi -> PENDING", st is None and r1["status"] == "PENDING", str(r1)[:90] if st else "")
    T("din ginti 3 (dono din shamil)", st is None and r1["days"] == 3)
    T("applied_by = login, mine = True", st is None and r1["applied_by"] == "zz_ad1" and r1["mine"] is True)
    T("reason saaf (faltu space hata)", st is None and r1["reason"] == "family function")
    T("naam/emp code ki naqal", st is None and r1["staff_name"] == "ZZ_TEST_LEAVE_A" and r1["emp_code"] == "ZZL1")

    print("\n(2) galat arzi")
    st, m = err(A.apply_leave, A.LeaveIn(staff_id=sa, from_date=d(9), to_date=d(8)), SUP)
    T("To < From -> 400", st == 400, m)
    st, m = err(A.apply_leave, A.LeaveIn(staff_id=sa, from_date=d(20), to_date=d(20 + 92)), SUP)
    T("93 din -> 400", st == 400, m)
    # back date band (2026-10-03) -- admin ki bhi nahi
    st, m = err(A.apply_leave, A.LeaveIn(staff_id=sa, from_date=d(-1), to_date=d(1)), SUP)
    T("kal se (back date) -> 400, admin ki bhi", st == 400 and "back-dated" in str(m), m)
    st, m = err(A.apply_leave, A.LeaveIn(staff_id=sa, from_date=d(-7), to_date=d(-7)), SUP)
    T("7 din purani -> 400", st == 400, m)
    st, m = err(A.apply_leave, A.LeaveIn(staff_id=sa, from_date=d(0), to_date=d(0)), SUP)
    T("aaj ki -> chalti hai", st is None, m if st else "")
    st, m = err(A.apply_leave, A.LeaveIn(staff_id=-1, from_date=d(1), to_date=d(1)), SUP)
    T("list me na ho -> 400", st == 400, m)

    print("\n(3) takraav")
    st, m = err(A.apply_leave, A.LeaveIn(staff_id=sa, from_date=d(5), to_date=d(6)), SUP2)
    T("usi aadmi, ek din takraya -> 400", st == 400, m)
    st, r2 = err(A.apply_leave, A.LeaveIn(staff_id=sa, from_date=d(6), to_date=d(7)), SUP2)
    T("usi aadmi, agle din se -> chalti hai", st is None, r2 if st else "")
    st, r3 = err(A.apply_leave, A.LeaveIn(staff_id=sb, from_date=d(3), to_date=d(5)), SUP2)
    T("alag aadmi, wahi din -> chalti hai", st is None, r3 if st else "")

    print("\n(4) list")
    L = A.list_leave(None, None, None, None, SUP)
    T("supervisor: kuch approve nahi", A.list_leave(None, None, None, None, NON)["approves"] == [])
    st, m = err(A.apply_leave, A.LeaveIn(staff_id=sa, from_date=d(40), to_date=d(40)), MAINT)
    T("maint (sanjha) arzi -> 403", st == 403, m)
    T("maint: can_apply False, shared_login True",
      A.list_leave(None, None, None, None, MAINT)["can_apply"] is False
      and A.list_leave(None, None, None, None, MAINT)["shared_login"] is True)
    T("AM: staff approve", A.list_leave(None, None, None, None, AM)["approves"] == ["staff"])
    mine = [x for x in L["pending"] if x["id"] in (r1["id"], r2["id"], r3["id"])]
    T("teeno arzi pending me", len(mine) == 3)
    T("pending me sirf PENDING", all(x["status"] == "PENDING" for x in L["pending"]))
    T("mine: r1 SUP ki, r2 SUP2 ki", next(x for x in L["rows"] if x["id"] == r1["id"])["mine"] is True
      and next(x for x in L["rows"] if x["id"] == r2["id"])["mine"] is False)

    print("\n(5) approve")
    st, m = err(A.approve_leave, r1["id"], A.LeaveDecide(), NON)
    T("supervisor approve -> 403", st == 403, m)
    st, a1 = err(A.approve_leave, r1["id"], A.LeaveDecide(note="ok"), AM)
    T("AM approve -> APPROVED", st is None and a1["status"] == "APPROVED", a1 if st else "")
    T("decided_by = AM, date wahi, orig khaali", st is None and a1["decided_by"] == "zz_am"
      and a1["from_date"] == d(3) and a1["orig_from"] is None)
    st, m = err(A.approve_leave, r1["id"], A.LeaveDecide(), AM)
    T("dobara approve -> 400", st == 400, m)

    print("\n(6) approve ke saath date badli")
    st, a3 = err(A.approve_leave, r3["id"], A.LeaveDecide(from_date=d(4), to_date=d(6)), AM)
    T("APPROVED + nayi date", st is None and a3["status"] == "APPROVED" and a3["from_date"] == d(4)
      and a3["to_date"] == d(6), a3 if st else "")
    T("orig = arzi wali purani date", st is None and a3["orig_from"] == d(3) and a3["orig_to"] == d(5))

    print("\n(7) PUT date badlo")
    st, p3 = err(A.change_leave_dates, r3["id"], A.LeaveDecide(from_date=d(10), to_date=d(11)), AM)
    T("APPROVED par nayi date", st is None and p3["from_date"] == d(10) and p3["status"] == "APPROVED", p3 if st else "")
    T("orig PEHLI hi (3-5), beech wali (4-6) nahi", st is None and p3["orig_from"] == d(3) and p3["orig_to"] == d(5))
    st, m = err(A.change_leave_dates, r3["id"], A.LeaveDecide(from_date=d(10), to_date=d(11)), NON)
    T("supervisor date badle -> 403", st == 403, m)

    print("\n(7b) back date -- approver bhi naye beete din nahi jod sakta (chhota karna chalta hai)")
    st, m = err(A.change_leave_dates, r3["id"], A.LeaveDecide(from_date=d(-2), to_date=d(11)), AM)
    T("shuruaat peechhe (parson) kheenchi -> 400", st == 400 and "back-dated" in str(m), m)
    st, r5 = err(A.apply_leave, A.LeaveIn(staff_id=sb, from_date=d(30), to_date=d(33)), SUP)
    st, x = err(A.approve_leave, r5["id"], A.LeaveDecide(), AM)
    c.execute("UPDATE maintenance_attendance_leave SET from_date = %s, to_date = %s WHERE id = %s",
              (d(-3), d(2), r5["id"]))           # chalu chhutti (parson se) -- jaise beech me
    st, x = err(A.change_leave_dates, r5["id"], A.LeaveDecide(from_date=d(-3), to_date=d(0)), AM)
    T("chalu chhutti chhoti (aaj tak) -> chalti hai", st is None and x["to_date"] == d(0), x if st else "")
    st, x = err(A.change_leave_dates, r5["id"], A.LeaveDecide(from_date=d(-3), to_date=d(4)), AM)
    T("aakhir aage (aaj ke baad) badhaya -> chalta hai", st is None and x["to_date"] == d(4), x if st else "")
    st, m = err(A.change_leave_dates, r5["id"], A.LeaveDecide(from_date=d(-5), to_date=d(4)), AM)
    T("shuruaat aur peechhe -> 400", st == 400, m)
    st, x = err(A.change_leave_dates, r5["id"], A.LeaveDecide(from_date=d(-2), to_date=d(4)), AM)
    T("shuruaat aage kheenchi (beeta din kam) -> chalti hai", st is None and x["from_date"] == d(-2), x if st else "")
    c.execute("UPDATE maintenance_attendance_leave SET from_date = %s, to_date = %s WHERE id = %s",
              (d(-9), d(-7), r5["id"]))          # beeti hui chhutti
    st, m = err(A.change_leave_dates, r5["id"], A.LeaveDecide(from_date=d(-9), to_date=d(-5)), AM)
    T("beeti chhutti ka aakhir beete din tak badhaya -> 400", st == 400, m)
    st, x = err(A.change_leave_dates, r5["id"], A.LeaveDecide(from_date=d(-9), to_date=d(-8)), AM)
    T("beeti chhutti chhoti -> chalti hai", st is None and x["to_date"] == d(-8), x if st else "")

    print("\n(8) date badal kar takraav")
    st, m = err(A.change_leave_dates, r2["id"], A.LeaveDecide(from_date=d(4), to_date=d(6)), AM)
    T("r2 ko r1 ke dino par -> 400", st == 400, m)

    print("\n(9) reject")
    st, j2 = err(A.reject_leave, r2["id"], A.LeaveDecide(note="  short   staff "), AM)
    T("reject -> REJECTED + note", st is None and j2["status"] == "REJECTED" and j2["note"] == "short staff", j2 if st else "")
    st, m = err(A.reject_leave, r2["id"], A.LeaveDecide(), AM)
    T("dobara reject -> 400", st == 400, m)

    print("\n(10) cancel")
    st, r4 = err(A.apply_leave, A.LeaveIn(staff_id=sb, from_date=d(20), to_date=d(21)), SUP)
    st, m = err(A.cancel_leave, r4["id"], NON)
    T("doosra supervisor cancel -> 403", st == 403, m)
    st, k4 = err(A.cancel_leave, r4["id"], SUP)
    T("jisne bhari wo cancel -> CANCELLED", st is None and k4["status"] == "CANCELLED", k4 if st else "")
    st, m = err(A.cancel_leave, r1["id"], SUP)
    T("APPROVED cancel -> 400", st == 400, m)

    print("\n(11) list ka haal")
    ids = {x["id"]: x["status"] for x in A.list_leave(None, None, None, None, AM)["rows"]}
    T("CANCELLED bhi record me (haal ke saath)", ids.get(r4["id"]) == "CANCELLED")
    T("REJECTED / APPROVED dikhte hain", ids.get(r2["id"]) == "REJECTED" and ids.get(r1["id"]) == "APPROVED")
finally:
    try:
        conn.rollback()
    finally:
        pool.putconn(conn)

print("\n(12) rollback ke baad")
with database.get_conn() as c2:
    k = database.dict_cursor(c2)
    k.execute("SELECT COUNT(*) AS n FROM maintenance_attendance_leave")
    T("leave ki ginti jaisi pehle (%s)" % pehle_se, k.fetchone()["n"] == pehle_se)
    k.execute("SELECT COUNT(*) AS n FROM maintenance_employee WHERE name LIKE 'ZZ\\_TEST\\_LEAVE%%'")
    T("ZZ_TEST_LEAVE aadmi nahi bache", k.fetchone()["n"] == 0)

print("\n%s -- %d fail" % ("SAB PASS" if not _fail else "KUCH FAIL", _fail))
sys.exit(1 if _fail else 0)
