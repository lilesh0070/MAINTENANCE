# -*- coding: utf-8 -*-
"""Log Book ki entry EDIT (PUT /api/logbook/{id}) -- ASLI DB, SIRF ROLLBACK.

  (1) GET /{id}: entry milti hai, date ISO; na ho -> 404
  (2) haq: doosra (non-admin) -> 403; jisne likhi (bade-chhote akshar alag) -> OK;
      admin (doosra naam) -> OK; na ho -> 404
  (3) khaane badle, Serial No / created_by NAHI; `changed` me sahi naam
  (4) spare: JSONB list + `spares_used` text dobara bana; khaali spare rows chhooti
  (5) spare report: clear_usage(id, 'Log Book') phir record_usage(slip_id=id) --
      DB nahi, naqli function se pakda (maintenance_spare ko haath nahi)
  (6) audit: LOGBOOK_ENTRY_EDIT is id par, "badla: ..." ke saath
  (7) ROLLBACK ke baad: ZZ_TEST entry aur uska audit nahi bacha

⚠ PROD DB: ek hi connection, `commit` kabhi nahi (har request ek SAVEPOINT);
aakhir me ROLLBACK, phir naye connection se jaancha.  DDL nahi (`_ensure_table`
naqli).  Chalane ka tareeqa (Phase2 folder se):
    .venv/Scripts/python.exe tests/test_logbook_edit.py
"""
import os
import sys
from contextlib import contextmanager

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(_HERE))
from dotenv import load_dotenv                                    # noqa: E402
load_dotenv(os.path.join(os.path.dirname(_HERE), ".env"), override=True)
from fastapi import HTTPException                                 # noqa: E402
import database                                                   # noqa: E402
import routers.logbook as LB                                      # noqa: E402
import routers.maintenance_spare as MS                            # noqa: E402

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


calls = []
MS.clear_usage = lambda c, sid, source=None: calls.append(("clear", sid, source)) or 0
MS.record_usage = lambda c, source, ctx, spares: calls.append(("record", source, dict(ctx), list(spares)))

WRITER = {"id": -9201, "username": "ZZ_LB_Writer", "role": "supervisor"}
OTHER  = {"id": -9202, "username": "zz_lb_other", "role": "supervisor"}
ADMIN  = {"id": -9203, "username": "zz_lb_admin", "role": "admin"}

BODY = dict(shift="B", zone="ZZ ZONE", line="ZZ LINE", machine_no="ZZ-M2", machine_name="ZZ MACHINE 2",
            bd_date="2026-10-02", bd_start_time="10:00", bd_ok_time="11:30",
            mc_down_time_minutes="90", solve_time_hours="1.50",
            problem_observed_by_maintenance="ZZ NAYI DIKKAT", action_taken_on_problem="ZZ NAYA KAAM",
            spares=[{"spare_name": "ZZ BEARING", "spare_model_no": "6204", "spare_cnmm_no": "ABCD1234", "spare_qty": "2"},
                    {"spare_name": "", "spare_model_no": "", "spare_cnmm_no": "", "spare_qty": ""}],
            bd_attended_by="ZZ RAM")

try:
    conn.autocommit = False
    c = database.dict_cursor(conn)
    c.execute("SET LOCAL lock_timeout = '2s'")
    c.execute("SET LOCAL statement_timeout = '20s'")
    c.execute("SET LOCAL idle_in_transaction_session_timeout = '90s'")
    LB.get_conn = fake_get_conn
    LB._ensure_table = lambda: None

    c.execute("""INSERT INTO maintenance_logbook_db_history
                     (serial_no, shift, zone, line, machine_no, machine_name, bd_date,
                      bd_start_time, bd_ok_time, mc_down_time_minutes, solve_time_hours,
                      problem_observed_by_maintenance, action_taken_on_problem,
                      spares, spares_used, bd_attended_by, created_by)
                 VALUES (987654, 'A', 'ZZ ZONE', 'ZZ LINE', 'ZZ-M1', 'ZZ MACHINE 1', '2026-10-01',
                         '09:00', '09:30', '30', '0.50', 'ZZ PURANI DIKKAT', 'ZZ PURANA KAAM',
                         NULL, NULL, 'ZZ SHYAM', 'zz_lb_writer')
                 RETURNING id""")
    eid = c.fetchone()["id"]

    print("(1) GET /{id}")
    st, g = err(LB.get_entry, eid, OTHER)
    T("entry mili, date ISO", st is None and g["bd_date"] == "2026-10-01" and g["serial_no"] == 987654, g if st else "")
    st, m = err(LB.get_entry, -1, OTHER)
    T("na ho -> 404", st == 404, m)

    print("\n(2) haq")
    st, m = err(LB.update_entry, eid, LB.EntryIn(**BODY), OTHER)
    T("doosra supervisor -> 403", st == 403, m)
    st, m = err(LB.update_entry, -1, LB.EntryIn(**BODY), ADMIN)
    T("na ho -> 404", st == 404, m)
    calls.clear()
    st, u = err(LB.update_entry, eid, LB.EntryIn(**BODY), WRITER)
    T("jisne likhi (ZZ_LB_Writer = zz_lb_writer) -> OK", st is None and u["ok"] is True, u if st else "")

    print("\n(3) kya badla")
    c.execute("SELECT * FROM maintenance_logbook_db_history WHERE id = %s", (eid,))
    r = c.fetchone()
    T("khaane naye", r["shift"] == "B" and r["machine_no"] == "ZZ-M2" and str(r["bd_date"]) == "2026-10-02"
      and r["bd_ok_time"] == "11:30" and r["problem_observed_by_maintenance"] == "ZZ NAYI DIKKAT"
      and r["bd_attended_by"] == "ZZ RAM")
    T("Serial No / created_by nahi badle", r["serial_no"] == 987654 and r["created_by"] == "zz_lb_writer")
    ch = set(u["changed"]) if st is None else set()
    T("changed me sahi naam", {"Shift", "Machine No", "Date", "Problem Observed", "Attended By", "Spares"} <= ch
      and "Zone" not in ch and "Line" not in ch, sorted(ch))

    print("\n(4) spare")
    T("JSONB me sirf bhari row (khaali chhooti)", isinstance(r["spares"], list) and len(r["spares"]) == 1
      and r["spares"][0]["spare_name"] == "ZZ BEARING")
    T("spares_used text bana", r["spares_used"] == "ZZ BEARING (6204 / ABCD1234) QTY-2", r["spares_used"])

    print("\n(5) spare report")
    T("pehle clear(id, 'Log Book')", calls[:1] == [("clear", eid, "Log Book")], calls[:1])
    rec = calls[1] if len(calls) > 1 else None
    T("phir record: slip_id = id, nayi machine/date, 1 spare",
      rec is not None and rec[0] == "record" and rec[1] == "Log Book" and rec[2].get("slip_id") == eid
      and rec[2].get("machine_no") == "ZZ-M2" and rec[2].get("used_date") == "2026-10-02" and len(rec[3]) == 1, rec)

    print("\n(6) audit")
    c.execute("""SELECT details, username FROM maintenance_audit_log
                  WHERE action = 'LOGBOOK_ENTRY_EDIT' AND entity_id = %s ORDER BY id DESC""", (eid,))
    au = c.fetchall()
    T("audit line likhi (kaun + badla)", len(au) == 1 and au[0]["username"] == "ZZ_LB_Writer"
      and "badla:" in (au[0]["details"] or ""), au[:1])

    print("\n(7) admin bhi")
    body2 = dict(BODY, spares=[], bd_attended_by="ZZ ADMIN NE BADLA")
    calls.clear()
    st, u2 = err(LB.update_entry, eid, LB.EntryIn(**body2), ADMIN)
    T("admin (doosra naam) -> OK", st is None and u2["ok"] is True, u2 if st else "")
    c.execute("SELECT spares, spares_used, bd_attended_by FROM maintenance_logbook_db_history WHERE id = %s", (eid,))
    r2 = c.fetchone()
    T("spare hataye -> NULL / NULL", r2["spares"] is None and r2["spares_used"] is None)
    T("record_usage khaali list ke saath (report se spare hatte)", any(x[0] == "record" and x[3] == [] for x in calls), calls)
finally:
    try:
        conn.rollback()
    finally:
        pool.putconn(conn)

print("\n(8) rollback ke baad")
with database.get_conn() as c2:
    k = database.dict_cursor(c2)
    k.execute("SELECT COUNT(*) AS n FROM maintenance_logbook_db_history WHERE serial_no = 987654")
    T("ZZ_TEST entry nahi bachi", k.fetchone()["n"] == 0)
    k.execute("SELECT COUNT(*) AS n FROM maintenance_audit_log WHERE action = 'LOGBOOK_ENTRY_EDIT' AND username IN ('ZZ_LB_Writer','zz_lb_admin')")
    T("audit line nahi bachi", k.fetchone()["n"] == 0)

print("\n%s -- %d fail" % ("SAB PASS" if not _fail else "KUCH FAIL", _fail))
sys.exit(1 if _fail else 0)
