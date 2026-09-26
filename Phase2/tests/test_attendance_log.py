# -*- coding: utf-8 -*-
"""Attendance badlav ka LOG (History -> Changes) -- ASLI DB, SIRF ROLLBACK.

Asli endpoint function (add / board ghaseetna / edit / remove) chalte hain,
aur jaancha jaata hai ki log me sahi line padi:
  (1) Add Member            -> add  (kataar)
  (2) ghaseet kar kataar badli -> move (from -> to); baaki kataar wale jinki
      sirf jagah likhi gayi unki line NAHI
  (3) usi kataar me aage-peeche -> koi line nahi
  (4) Edit: contact badla   -> edit "Contact" (value NAHI); kuch na badla -> nahi
      + Edit se kataar badli -> move
  (5) Remove (agle din se)  -> remove (kis kataar se)
  (6) History ke Changes me yahi line (source log), board wali dohri nahi
  (7) log likhna fail ho to bhi asli kaam chalta rahe (SAVEPOINT)

⚠ PROD DB: ek hi connection, `commit` kabhi nahi; aakhir me ROLLBACK, phir
naye connection se jaancha ki kuch nahi bacha.  Tareekh 400 din AAGE -- asli
logon ki kisi row ko haath nahi (us din ki nayi rows banti hain, wo bhi
rollback).  Advisory lock ki chaabi alag -- server ka koi save nahi rukta.
DDL nahi (`_bani = True`); log table na ho to TEMP table.

Chalane ka tareeqa (Phase2 folder se):
    .venv/Scripts/python.exe tests/test_attendance_log.py
"""
import os
import sys
from contextlib import contextmanager
from datetime import date, timedelta

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(_HERE))
from dotenv import load_dotenv                                    # noqa: E402
load_dotenv(os.path.join(os.path.dirname(_HERE), ".env"), override=True)
import database                                                   # noqa: E402
import routers.attendance as A                                    # noqa: E402

NAME = "ZZ_TEST_HIST_A"
EMP = "ZZH1"
USER = {"id": 0, "username": "zz_hist_test", "role": "admin"}
_fail = 0


def T(name, ok, extra=""):
    global _fail
    if not ok:
        _fail += 1
    print("   %s  %-62s %s" % ("PASS" if ok else "FAIL", name, extra))


pool = database._get_pool()
conn = pool.getconn()
asli_log = False
try:
    conn.autocommit = False
    c = database.dict_cursor(conn)
    c.execute("SET LOCAL lock_timeout = '2s'")
    c.execute("SET LOCAL statement_timeout = '20s'")
    c.execute("SET LOCAL idle_in_transaction_session_timeout = '90s'")
    c.execute("SELECT COUNT(*) AS n FROM maintenance_employee WHERE name LIKE 'ZZ\\_TEST\\_HIST%%'")
    assert c.fetchone()["n"] == 0, "pichhla ZZ_TEST_HIST bacha hai -- pehle dekho"
    c.execute("SELECT to_regclass('maintenance_attendance_log') IS NOT NULL AS h")
    asli_log = c.fetchone()["h"]
    if not asli_log:
        c.execute("""CREATE TEMP TABLE maintenance_attendance_log (
                        id BIGSERIAL PRIMARY KEY, at TIMESTAMP NOT NULL DEFAULT NOW(),
                        by_user VARCHAR(120), day DATE NOT NULL, staff_id INTEGER,
                        staff_name VARCHAR(120), emp_code VARCHAR(40), action VARCHAR(12) NOT NULL,
                        from_slot VARCHAR(10), to_slot VARCHAR(10), detail VARCHAR(300))""")

    @contextmanager
    def _one():
        yield conn                                  # commit NAHI -- sab ek transaction me

    A.get_conn = _one
    A._bani = True
    A._LOCK_KEY = 7_202_609 + 424_242               # server wali chaabi se alag

    D = date.today() + timedelta(days=400)
    D1 = D + timedelta(days=1)

    def logs():
        c.execute("""SELECT action, from_slot, to_slot, detail, day, staff_name, emp_code, by_user
                       FROM maintenance_attendance_log WHERE by_user = %s ORDER BY id""",
                  (USER["username"],))
        return c.fetchall()

    print(f"\n   tareekh {D} (400 din aage), log table asli: {asli_log}")
    print("\n--- (1) Add Member ---")
    sid = A.add_staff(A.StaffIn(name=NAME, emp_code=EMP, designation="Tester", contact="12345",
                                slot="G", day=D.isoformat()), user=USER)["id"]
    L = logs()
    T("add -> 1 line: add, G, us din", len(L) == 1 and L[0]["action"] == "add" and L[0]["to_slot"] == "G"
      and L[0]["day"] == D and L[0]["staff_name"] == NAME and L[0]["emp_code"] == EMP, str(L[-1:]))

    print("\n--- (2) ghaseet kar G -> LEAVE ---")
    b = A.get_board(day=D.isoformat(), user=USER)
    lanes = {s: [p["id"] for p in sorted(b["people"], key=lambda p: p["pos"]) if p["slot"] == s]
             for s in ("G", "LEAVE")}
    n_g = len(lanes["G"])
    lanes["G"].remove(sid)
    lanes["LEAVE"].append(sid)
    A.save_board(A.BoardIn(day=D.isoformat(), lanes=lanes), user=USER)
    L = logs()
    T("sirf ek nayi line: move G -> LEAVE", len(L) == 2 and L[1]["action"] == "move"
      and (L[1]["from_slot"], L[1]["to_slot"]) == ("G", "LEAVE"),
      f"G kataar me {n_g} log the, unki line nahi")

    print("\n--- (3) usi kataar me aage-peeche ---")
    b = A.get_board(day=D.isoformat(), user=USER)
    g = [p["id"] for p in sorted(b["people"], key=lambda p: p["pos"]) if p["slot"] == "G"]
    if len(g) >= 2:
        A.save_board(A.BoardIn(day=D.isoformat(), lanes={"G": list(reversed(g))}), user=USER)
    T("kram badla -> koi nayi line nahi", len(logs()) == 2, f"G me {len(g)}")

    print("\n--- (4) Edit ---")
    A.edit_staff(sid, A.StaffIn(name=NAME, emp_code=EMP, designation="Tester", contact="12345"), user=USER)
    T("kuch na badla -> koi line nahi", len(logs()) == 2)
    A.edit_staff(sid, A.StaffIn(name=NAME, emp_code=EMP, designation="Tester", contact="99999",
                                slot="WFH", day=D.isoformat()), user=USER)
    L = logs()
    T("contact badla -> edit 'Contact' (number log me NAHI)", len(L) >= 3 and L[2]["action"] == "edit"
      and L[2]["detail"] == "Contact" and "99999" not in str(L[2]) and "12345" not in str(L[2]), str(L[2:3]))
    T("edit se kataar badli -> move LEAVE -> WFH", len(L) == 4 and L[3]["action"] == "move"
      and (L[3]["from_slot"], L[3]["to_slot"]) == ("LEAVE", "WFH"))

    print("\n--- (5) Remove (agle din se) ---")
    r = A.remove_staff(sid, day=D1.isoformat(), user=USER)
    L = logs()
    T("remove -> 1 line: remove, WFH se, agle din", r["mode"] == "removed" and len(L) == 5
      and L[4]["action"] == "remove" and L[4]["from_slot"] == "WFH" and L[4]["day"] == D1, str(L[4:5]))

    print("\n--- (6) History ke Changes ---")
    h = A.history(start=(D - timedelta(days=1)).isoformat(), end=(D1 + timedelta(days=1)).isoformat(),
                  user=USER)
    mine = [x for x in h["changes"] if x["emp_code"] == EMP]
    T("us range me 4 line (add, move, move, remove) -- sab log se, dohri nahi",
      [x["action"] for x in mine] == ["remove", "move", "move", "add"]
      and all(x["source"] == "log" for x in mine), str([(x["action"], x["source"]) for x in mine]))
    h2 = A.history(start=date.today().isoformat(), end=date.today().isoformat(), user=USER)
    ed = [x for x in h2["changes"] if x["emp_code"] == EMP]
    T("edit ki line AAJ ki tareekh par (jis din badla)", [x["action"] for x in ed] == ["edit"]
      and ed[0]["detail"] == "Contact" and ed[0]["by"] == USER["username"], str(ed)[:160])
    T("kisi asli aadmi ki 'badlav' line nahi (unki kataar nahi badli)",
      all(x["emp_code"] == EMP for x in h["changes"]), str([x["name"] for x in h["changes"]][:5]))
    row = next((p for p in h["people"] if p["emp_code"] == EMP), None)
    i_d = h["days"].index(D.isoformat())
    T("register: us din WFH, agle din khaali (hata)", row is not None and row["slots"][i_d] == "WFH"
      and row["slots"][i_d + 1] is None)

    print("\n--- (7) log fail ho to bhi asli kaam chale ---")
    n0 = len(logs())
    A._log(c, USER["username"], [{"day": D, "action": "x" * 40}])      # VARCHAR(12) todega
    c.execute("SELECT 1 AS ok")
    T("galat line: log nahi, transaction zinda", c.fetchone()["ok"] == 1 and len(logs()) == n0)
finally:
    conn.rollback()
    pool.putconn(conn, close=True)

print("\n--- ROLLBACK ke baad: kuch bacha to nahi ---")
with database.get_conn() as k:
    cc = database.dict_cursor(k)
    cc.execute("SELECT COUNT(*) AS n FROM maintenance_employee WHERE name LIKE 'ZZ\\_TEST\\_HIST%%'")
    n_emp = cc.fetchone()["n"]
    cc.execute("SELECT COUNT(*) AS n FROM maintenance_attendance_board WHERE day >= %s",
               (date.today() + timedelta(days=300),))
    n_board = cc.fetchone()["n"]
    n_log = 0
    if asli_log:
        cc.execute("SELECT COUNT(*) AS n FROM maintenance_attendance_log WHERE by_user = %s", (USER["username"],))
        n_log = cc.fetchone()["n"]
    k.rollback()
T("ZZ_TEST member / aage ki board rows / log -- kuch nahi bacha", (n_emp, n_board, n_log) == (0, 0, 0),
  f"emp {n_emp}, board {n_board}, log {n_log}")

print("\n   %s\n" % (">>> SAB PASS" if not _fail else ">>> %d FAIL" % _fail))
sys.exit(1 if _fail else 0)
