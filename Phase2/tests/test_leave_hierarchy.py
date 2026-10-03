# -*- coding: utf-8 -*-
"""LEAVE -- hierarchy wale niyam + dashboard / board ka kram.  ASLI DB, SIRF ROLLBACK.

User (2026-10-03): apni ID se apni hi arzi; maint ID par sab; Supervisor / DET
/ Engineer / Senior Engineer -> AM, AM -> DM, DM -> Manager, Manager khud;
admin sab + row delete; AM / DM / Manager purana record dekhein.  Aur naam
hierarchy ke kram me (dashboard dono shift, board).

  (1) arzi: apne naam ki haan; doosre ki 403; jo board se juda nahi 403;
      maint / admin kisi ki bhi
  (2) kaun kya dekhe (pending + rows): supervisor sirf apni, AM staff, DM
      AM + staff, Manager / maint / admin sab
  (3) approve: staff -> sirf AM (DM / Manager nahi), AM apni nahi -> DM, DM ->
      Manager, Manager apni khud; admin sab
  (4) date badlo / reject -- wahi haq
  (5) cancel: apni haan, paraayi 403, maint ne bhari wo maint kar sake
  (6) delete: sirf admin; row gayab; audit me naqal
  (7) record ki chhanti: start / end / status / staff_id; pending par tareekh nahi
  (8) jawab: me / waiting_for / can_apply_any / people (hierarchy kram)
  (9) on-duty: dono group, abhi wala upar, har group me hierarchy kram;
      board ki kataar me bhi kram + `rank`
 (10) ROLLBACK ke baad: ZZ user / aadmi / arzi kuch nahi bacha

⚠ PROD DB: ek connection, commit kabhi nahi (har request ek SAVEPOINT); DDL
naqli (`_bani`, `_leave_bani` = True -- leave table pehle se hai); audit naqli
(`main.write_audit` pakda jaata hai).  Naqli user ka password_hash 'x' --
koi asli credential nahi, aur rollback ke saath gayab.
Chalane ka tareeqa (Phase2 folder se):
    .venv/Scripts/python.exe tests/test_leave_hierarchy.py
"""
import os
import sys
import types
from contextlib import contextmanager
from datetime import date, datetime, timedelta

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
    print("   %s  %-68s %s" % ("PASS" if ok else "FAIL", name, extra))


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
A.get_conn = fake_get_conn
A._bani = True
A._leave_bani = True
sys.modules["main"] = types.SimpleNamespace(write_audit=lambda *a, **k: AUDIT.append(k))

ADMIN = {"id": -9401, "username": "zz_lv_admin", "role": "admin"}
pehle_leave = None

try:
    conn.autocommit = False
    c = database.dict_cursor(conn)
    c.execute("SET LOCAL lock_timeout = '2s'")
    c.execute("SET LOCAL statement_timeout = '20s'")
    c.execute("SET LOCAL idle_in_transaction_session_timeout = '120s'")
    c.execute("SELECT COUNT(*) AS n FROM maintenance_attendance_leave")
    pehle_leave = c.fetchone()["n"]
    c.execute("SELECT COUNT(*) AS n FROM maintenance_users WHERE username LIKE 'zz\\_lv\\_%%'")
    assert c.fetchone()["n"] == 0, "pichhla zz_lv_ user bacha hai -- pehle dekho"
    c.execute("SELECT id, username, role FROM maintenance_users WHERE lower(username) = 'maint'")
    mr = c.fetchone()
    MAINT = {"id": mr["id"], "username": mr["username"], "role": mr["role"]} if mr else \
        {"id": -9409, "username": "maint", "role": "supervisor"}

    # naqli log -- (key, role, emp code, designation, slot)
    LOG = [("sup", "supervisor", "ZZLV1", "Supervisor", "A"),
           ("eng", "engineer", "ZZLV2", "Engineer", "A"),
           ("am", "assistant_manager", "ZZLV3", "Assistant Manager", "A"),
           ("dm", "deputy_manager", "ZZLV4", "Deputy Manager", "B"),
           ("mgr", "manager", "ZZLV5", "Manager", "B"),
           ("sup2", "supervisor", "ZZLV6", "Supervisor", "B"),
           ("det", "det", "ZZLV7", "DET", "A")]
    U, S = {}, {}
    for k, role, emp, desig, _ in LOG:
        c.execute("""INSERT INTO maintenance_users (username, password_hash, role, emp_code, is_active)
                     VALUES (%s, 'x', %s, %s, TRUE) RETURNING id""", (f"zz_lv_{k}", role, emp))
        U[k] = {"id": c.fetchone()["id"], "username": f"zz_lv_{k}", "role": role}
        c.execute("""INSERT INTO maintenance_employee (name, emp_code, designation, created_by, updated_by)
                     VALUES (%s, %s, %s, 'zz', 'zz') RETURNING id""", (f"ZZ_LV_{k.upper()}", emp, desig))
        S[k] = c.fetchone()["id"]
    # board se juda nahi wala login + bina login wala aadmi (designation se pad)
    c.execute("""INSERT INTO maintenance_users (username, password_hash, role, emp_code, is_active)
                 VALUES ('zz_lv_nostaff', 'x', 'engineer', 'ZZLV9', TRUE) RETURNING id""")
    NOSTAFF = {"id": c.fetchone()["id"], "username": "zz_lv_nostaff", "role": "engineer"}
    c.execute("""INSERT INTO maintenance_employee (name, emp_code, designation, created_by, updated_by)
                 VALUES ('ZZ_LV_TECH', 'ZZLV8', 'Senior Engineer', 'zz', 'zz') RETURNING id""")
    S["tech"] = c.fetchone()["id"]
    today = date.today()
    d = lambda n: (today + timedelta(days=n)).isoformat()      # noqa: E731
    LI = A.LeaveIn

    print("(1) arzi kaun bhare")
    st, l_sup = err(A.apply_leave, LI(staff_id=S["sup"], from_date=d(3), to_date=d(4)), U["sup"])
    T("supervisor apne naam -> PENDING, AM ka intezaar", st is None and l_sup["status"] == "PENDING"
      and l_sup["waiting_for"] == "Assistant Manager" and l_sup["mine"] is True, l_sup if st else "")
    st, m = err(A.apply_leave, LI(staff_id=S["eng"], from_date=d(3), to_date=d(4)), U["sup"])
    T("supervisor doosre ke naam -> 403", st == 403, m)
    st, m = err(A.apply_leave, LI(staff_id=S["eng"], from_date=d(3), to_date=d(4)), NOSTAFF)
    T("board se juda nahi -> 403 (emp code jodo)", st == 403 and "Emp code" in str(m), m)
    st, l_eng = err(A.apply_leave, LI(staff_id=S["eng"], from_date=d(5), to_date=d(6)), MAINT)
    T("maint kisi ke bhi naam -> chalti hai", st is None and l_eng["applied_by"] == MAINT["username"], l_eng if st else "")
    st, l_am = err(A.apply_leave, LI(staff_id=S["am"], from_date=d(7), to_date=d(8)), U["am"])
    T("AM apni -> DM ka intezaar", st is None and l_am["waiting_for"] == "Deputy Manager", l_am if st else "")
    st, l_dm = err(A.apply_leave, LI(staff_id=S["dm"], from_date=d(9), to_date=d(9)), U["dm"])
    T("DM apni -> Manager ka intezaar", st is None and l_dm["waiting_for"] == "Manager", l_dm if st else "")
    st, l_mgr = err(A.apply_leave, LI(staff_id=S["mgr"], from_date=d(10), to_date=d(10)), ADMIN)
    T("admin Manager ke naam -> chalti hai, Manager ka intezaar", st is None and l_mgr["waiting_for"] == "Manager",
      l_mgr if st else "")
    st, l_tech = err(A.apply_leave, LI(staff_id=S["tech"], from_date=d(11), to_date=d(11)), MAINT)
    T("bina login wala (designation Senior Engineer) -> AM ka", st is None and l_tech["level"] == "staff"
      and l_tech["designation"] == "Senior Engineer", l_tech if st else "")
    st, l_sup2 = err(A.apply_leave, LI(staff_id=S["sup2"], from_date=d(12), to_date=d(12)), U["sup2"])

    ids = {k: v["id"] for k, v in (("sup", l_sup), ("eng", l_eng), ("am", l_am), ("dm", l_dm),
                                   ("mgr", l_mgr), ("tech", l_tech), ("sup2", l_sup2))}
    zz = set(ids.values())

    def dikhe(u):
        g = A.list_leave(None, None, None, None, u)
        return ({r["id"] for r in g["pending"]} & zz, {r["id"] for r in g["rows"]} & zz, g)

    print("\n(2) kaun kya dekhe")
    p, r, g = dikhe(U["sup"])
    T("supervisor: sirf apni", p == {ids["sup"]} and r == {ids["sup"]}, sorted(p))
    p, r, _ = dikhe(U["eng"])
    T("engineer: apni (maint ne bhari) -- mine", p == {ids["eng"]}, sorted(p))
    p, r, _ = dikhe(U["am"])
    T("AM: staff (sup, sup2, eng, tech) + apni; DM / Manager nahi",
      p == {ids["sup"], ids["sup2"], ids["eng"], ids["tech"], ids["am"]}, sorted(p))
    p, r, _ = dikhe(U["dm"])
    T("DM: AM + staff + apni; Manager nahi", p == zz - {ids["mgr"]}, sorted(p))
    for who, u in (("Manager", U["mgr"]), ("maint", MAINT), ("admin", ADMIN)):
        p, r, g = dikhe(u)
        T(f"{who}: sab", p == zz and g["see_all"] is True, sorted(zz - p))

    print("\n(3) approve")
    A_ = A.approve_leave
    LD = A.LeaveDecide
    st, m = err(A_, ids["sup"], LD(), U["dm"])
    T("staff ki: DM -> 403 (sirf AM)", st == 403 and "Assistant Manager" in str(m), m)
    st, m = err(A_, ids["sup"], LD(), U["mgr"])
    T("staff ki: Manager -> 403", st == 403, m)
    st, m = err(A_, ids["sup"], LD(), U["sup2"])
    T("staff ki: doosra supervisor -> 403", st == 403, m)
    st, a = err(A_, ids["sup"], LD(note="ok"), U["am"])
    T("staff ki: AM -> APPROVED", st is None and a["status"] == "APPROVED" and a["decided_by"] == "zz_lv_am", a if st else "")
    st, m = err(A_, ids["am"], LD(), U["am"])
    T("AM apni approve -> 403", st == 403 and "Deputy Manager" in str(m), m)
    st, a = err(A_, ids["am"], LD(), U["dm"])
    T("AM ki: DM -> APPROVED", st is None and a["status"] == "APPROVED", a if st else "")
    st, m = err(A_, ids["dm"], LD(), U["am"])
    T("DM ki: AM -> 403", st == 403, m)
    st, m = err(A_, ids["dm"], LD(), U["dm"])
    T("DM apni -> 403", st == 403, m)
    st, a = err(A_, ids["dm"], LD(), U["mgr"])
    T("DM ki: Manager -> APPROVED", st is None and a["status"] == "APPROVED", a if st else "")
    st, a = err(A_, ids["mgr"], LD(), U["mgr"])
    T("Manager apni khud -> APPROVED", st is None and a["status"] == "APPROVED", a if st else "")
    st, a = err(A_, ids["tech"], LD(), ADMIN)
    T("admin kisi ki bhi -> APPROVED", st is None and a["status"] == "APPROVED", a if st else "")
    st, m = err(A_, ids["eng"], LD(), MAINT)
    T("maint approve -> 403", st == 403, m)
    g = A.list_leave(None, None, None, None, U["am"])
    row = next(x for x in g["pending"] if x["id"] == ids["eng"])
    T("jawab ki can_approve: AM ko staff par haan", row["can_approve"] is True and row["can_delete"] is False)
    g = A.list_leave(None, None, None, None, U["dm"])
    row = next(x for x in g["pending"] if x["id"] == ids["eng"])
    T("jawab ki can_approve: DM ko staff par nahi", row["can_approve"] is False)

    print("\n(4) date badlo / reject")
    st, m = err(A.change_leave_dates, ids["eng"], LD(from_date=d(15), to_date=d(16)), U["dm"])
    T("staff ki date: DM -> 403", st == 403, m)
    st, x = err(A.change_leave_dates, ids["eng"], LD(from_date=d(15), to_date=d(16)), U["am"])
    T("staff ki date: AM -> badli, orig bachi", st is None and x["from_date"] == d(15)
      and x["orig_from"] == d(5), x if st else "")
    st, m = err(A.reject_leave, ids["sup2"], LD(note="no"), U["mgr"])
    T("staff ki reject: Manager -> 403", st == 403, m)
    st, x = err(A.reject_leave, ids["sup2"], LD(note="short staff"), U["am"])
    T("staff ki reject: AM -> REJECTED", st is None and x["status"] == "REJECTED", x if st else "")

    print("\n(5) cancel")
    st, m = err(A.cancel_leave, ids["eng"], U["sup"])
    T("paraayi cancel (supervisor) -> 403", st == 403, m)
    st, x = err(A.cancel_leave, ids["eng"], MAINT)
    T("maint ne bhari wo maint cancel -> CANCELLED", st is None and x["status"] == "CANCELLED", x if st else "")
    st, l_s3 = err(A.apply_leave, LI(staff_id=S["sup"], from_date=d(20), to_date=d(20)), U["sup"])
    st, x = err(A.cancel_leave, l_s3["id"], U["sup"])
    T("apni PENDING cancel -> CANCELLED", st is None and x["status"] == "CANCELLED", x if st else "")
    st, m = err(A.cancel_leave, ids["sup"], U["sup"])
    T("APPROVED cancel -> 400", st == 400, m)
    zz.add(l_s3["id"])

    print("\n(6) delete")
    st, m = err(A.delete_leave, ids["sup"], U["mgr"])
    T("Manager delete -> 403", st == 403, m)
    st, m = err(A.delete_leave, ids["sup"], MAINT)
    T("maint delete -> 403", st == 403, m)
    st, x = err(A.delete_leave, ids["sup"], ADMIN)
    c.execute("SELECT COUNT(*) AS n FROM maintenance_attendance_leave WHERE id = %s", (ids["sup"],))
    T("admin delete -> row gayab", st is None and c.fetchone()["n"] == 0, x if st else "")
    T("audit me naqal (LEAVE_DELETE, naam + tareekh)", len(AUDIT) == 1 and AUDIT[0].get("action") == "LEAVE_DELETE"
      and "ZZ_LV_SUP" in AUDIT[0].get("details", "") and d(3) in AUDIT[0].get("details", ""), AUDIT)
    st, m = err(A.delete_leave, ids["sup"], ADMIN)
    T("dobara delete -> 404", st == 404, m)
    zz.discard(ids["sup"])

    print("\n(7) record ki chhanti")
    g = A.list_leave(d(9), d(10), None, None, ADMIN)
    T("start..end se takraati: dm (9), mgr (10)", {r["id"] for r in g["rows"]} & zz == {ids["dm"], ids["mgr"]},
      sorted({r["id"] for r in g["rows"]} & zz))
    g = A.list_leave(d(0), d(30), "REJECTED", None, ADMIN)
    T("status=REJECTED -> sirf sup2", {r["id"] for r in g["rows"]} & zz == {ids["sup2"]})
    g = A.list_leave(d(0), d(30), None, S["mgr"], ADMIN)
    T("staff_id -> sirf us aadmi ki", {r["id"] for r in g["rows"]} & zz == {ids["mgr"]})
    st, l_far = err(A.apply_leave, LI(staff_id=S["sup2"], from_date=d(80), to_date=d(80)), U["sup2"])
    zz.add(l_far["id"])
    g = A.list_leave(d(0), d(30), None, None, U["am"])
    T("pending par tareekh ki had nahi (80 din aage wali bhi)", l_far["id"] in {r["id"] for r in g["pending"]}
      and l_far["id"] not in {r["id"] for r in g["rows"]})
    st, m = err(A.list_leave, d(5), d(1), None, None, ADMIN)
    T("end < start -> 400", st == 400, m)
    st, m = err(A.list_leave, None, None, "WHATEVER", None, ADMIN)
    T("anjaan status -> 400", st == 400, m)

    print("\n(8) jawab ki baaki baatein")
    g = A.list_leave(None, None, None, None, U["sup"])
    T("supervisor: me = apna, AM ka intezaar; kisi ki nahi; people khaali",
      g["me"] and g["me"]["staff_id"] == S["sup"] and g["me"]["waiting_for"] == "Assistant Manager"
      and g["can_apply_any"] is False and g["people"] == [] and g["can_delete"] is False, g["me"])
    g = A.list_leave(None, None, None, None, NOSTAFF)
    T("board se juda nahi: me = None", g["me"] is None)
    g = A.list_leave(None, None, None, None, MAINT)
    ranks = [A._RANK.get(A._pad(None, p["designation"]), A._RANK_BAAKI) for p in g["people"]]
    T("maint: people hierarchy kram me (Manager pehle)", g["can_apply_any"] is True and len(g["people"]) > 0
      and ranks == sorted(ranks), [p["designation"] for p in g["people"]][:6])
    T("admin: can_delete, approves sab level", A.list_leave(None, None, None, None, ADMIN)["can_delete"] is True
      and set(A.list_leave(None, None, None, None, ADMIN)["approves"]) == set(A._LEAVE_APPROVER))
    T("AM: approves = staff", A.list_leave(None, None, None, None, U["am"])["approves"] == ["staff"])

    print("\n(9) on-duty / board ka kram")
    sl = {k: slot for k, _, _, _, slot in LOG}
    plant = today if 7 <= datetime.now().hour else today - timedelta(days=1)
    for i, (k, *_r) in enumerate(LOG):
        c.execute("""INSERT INTO maintenance_attendance_board (day, staff_id, slot, pos, updated_by)
                     VALUES (%s, %s, %s, %s, 'zz')""", (plant, S[k], sl[k], 100 - i))
    od = A.on_duty(ADMIN)
    G = od["groups"]
    T("do group, pehla 'now'", len(G) == 2 and G[0]["now"] is True and G[1]["now"] is False, [g["shift"] for g in G])
    raat = not (7 <= datetime.now().hour < 18)
    T("abhi wala upar (din = G + A, raat = B)", G[0]["shift"] == ("B" if raat else "G + A"))
    T("purane khaane (people = abhi wala group)", od["people"] == G[0]["people"] and od["count"] == G[0]["count"])
    ga = next(g for g in G if g["shift"] == "G + A")["people"]
    gb = next(g for g in G if g["shift"] == "B")["people"]
    T("ZZ A wale G + A me, B wale B me",
      {p["id"] for p in ga} >= {S["sup"], S["eng"], S["am"]} and {p["id"] for p in gb} >= {S["dm"], S["mgr"], S["sup2"]})
    T("har group me rank badhta kram", all([p["rank"] for p in g["people"]] == sorted(p["rank"] for p in g["people"]) for g in G))
    zza = [p["id"] for p in ga if p["id"] in (S["sup"], S["eng"], S["am"], S["det"])]
    # user: "supervisor pehle aana tha, DET baad me" -- pos ulta (DET sabse chhota) phir bhi
    T("A me AM, Engineer, Supervisor, DET (pos ulta tha phir bhi)",
      zza == [S["am"], S["eng"], S["sup"], S["det"]], zza)
    j = A._jawab(c, plant, "full")
    lane_b = [p["id"] for p in j["people"] if p["id"] in (S["dm"], S["mgr"], S["sup2"])]
    T("board: B me Manager, DM, Supervisor + rank khaana", lane_b == [S["mgr"], S["dm"], S["sup2"]]
      and all("rank" in p for p in j["people"]), lane_b)
finally:
    try:
        conn.rollback()
    finally:
        pool.putconn(conn)

print("\n(10) rollback ke baad")
with database.get_conn() as c2:
    k = database.dict_cursor(c2)
    k.execute("SELECT COUNT(*) AS n FROM maintenance_users WHERE username LIKE 'zz\\_lv\\_%%'")
    T("ZZ user nahi bacha", k.fetchone()["n"] == 0)
    k.execute("SELECT COUNT(*) AS n FROM maintenance_employee WHERE name LIKE 'ZZ\\_LV\\_%%'")
    T("ZZ aadmi nahi bacha", k.fetchone()["n"] == 0)
    k.execute("SELECT COUNT(*) AS n FROM maintenance_attendance_leave")
    T("leave ki ginti jaisi pehle (%s)" % pehle_leave, k.fetchone()["n"] == pehle_leave)

print("\n%s -- %d fail" % ("SAB PASS" if not _fail else "KUCH FAIL", _fail))
sys.exit(1 if _fail else 0)
