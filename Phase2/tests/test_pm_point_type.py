# -*- coding: utf-8 -*-
"""PM check point ka TYPE (ALPHABET / NUMBER) -- ASLI DB, SIRF ROLLBACK, HTTP raaste se.

User (2026-10-03): points table me `type`; naya point jodte waqt chunna
zaroori; NUMBER wale point par fill me reading (number), OK / NG nahi.

  (1) POST /check-points: type na ho -> 400; "number" -> 201, GET me NUMBER;
      purane point (seedha SQL, type NULL) GET me ALPHABET
  (2) PUT /check-points/{id}/type: badla; galat -> 400; anjaan id -> 404
  (3) PUT /check-point-rev (bump): ek staged point bina type -> 400 aur KUCH
      nahi badla (archive khaali, rev wahi); sab ke saath -> archive me type
      ki naqal, naye point par type
  (4) PUT /check-point-rev-stepdown: wapas aaye point ka type wahi
  (5) POST /check-sheet-fill (teesri baar ka niyam): STATUS sirf OK / NG; NUMBER
      ki reading OBSERVATION me -- khaali / "VAC 212" -> 400; purane tareeqe ki
      STATUS "212 VAC" -> 400; "240VAC", "210 VAC", "-0.5" -> 201 (OK ho ya NG);
      Action khaali -> "-"; status_first me NUMBER ka Observation bachta
  (6) ROLLBACK ke baad ZZ machine ka kuch nahi bacha

⚠ PROD DB: ek connection, commit kabhi nahi (har request SAVEPOINT); DDL
naqli (`_ensure_*`), spare / audit naqli.  `type` column prod me pehle se hai
(scripts/pm_point_type.py).
Chalane ka tareeqa (Phase2 folder se):
    .venv/Scripts/python.exe tests/test_pm_point_type.py
"""
import os
import sys
import types
from contextlib import contextmanager

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(_HERE))
from dotenv import load_dotenv                                    # noqa: E402
load_dotenv(os.path.join(os.path.dirname(_HERE), ".env"), override=True)
import asyncio                                                    # noqa: E402
import httpx                                                      # noqa: E402
from fastapi import FastAPI                                       # noqa: E402
import database                                                   # noqa: E402
import auth                                                       # noqa: E402
import routers.pm as P                                            # noqa: E402

_fail = 0


def T(name, ok, extra=""):
    global _fail
    if not ok:
        _fail += 1
    print("   %s  %-66s %s" % ("PASS" if ok else "FAIL", name, extra))


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


P.get_conn = fake_get_conn
P._ensure_cp_rev_table = lambda: None
P._ensure_cp_type = lambda: None
P._ensure_format_table = lambda: None
P._ensure_fill_table = lambda: None
P._record_pm_spares = lambda body, pmd: None
sys.modules["main"] = types.SimpleNamespace(write_audit=lambda *a, **k: None)

ADMIN = {"id": -9501, "username": "zz_pt_admin", "role": "admin"}
app = FastAPI()
app.include_router(P.router)
app.dependency_overrides[auth.get_current_user] = lambda: ADMIN


class _Cl:
    def _go(self, m, url, **k):
        async def chalo():
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://zz") as ac:
                return await ac.request(m, url, **k)
        return asyncio.run(chalo())

    def get(self, url, **k):
        return self._go("GET", url, **k)

    def put(self, url, **k):
        return self._go("PUT", url, **k)

    def post(self, url, **k):
        return self._go("POST", url, **k)


cl = _Cl()
Z, L, M = "ZZ ZONE", "ZZ LINE", "ZZ-PT-1"
Q = f"zone={Z}&line={L}&machine_no={M}"


def pts():
    return cl.get(f"/api/pm/check-points?{Q}").json()["points"]


try:
    conn.autocommit = False
    c = database.dict_cursor(conn)
    c.execute("SET LOCAL lock_timeout = '2s'")
    c.execute("SET LOCAL statement_timeout = '20s'")
    c.execute("SET LOCAL idle_in_transaction_session_timeout = '120s'")
    c.execute("SELECT COUNT(*) n FROM maintenance_pm_check_point WHERE machine_no=%s", (M,))
    assert c.fetchone()["n"] == 0, "pichhla ZZ-PT-1 bacha hai -- pehle dekho"
    # do purane point (type NULL -- jaise pehle ki rows)
    c.execute("""INSERT INTO maintenance_pm_check_point
                 (zone,line,machine_no,machine_name,s_no,check_point,judgement_standard,method,rev_no,rev_date,sort_order)
                 VALUES (%s,%s,%s,'ZZ M','1','ZZ Clean panel','Neat & Clean','By cloth','1','2026-01-01',1),
                        (%s,%s,%s,'ZZ M','2','ZZ Main voltage','3ph/210 Vac ±10 Vac','Multimeter','1','2026-01-01',2)""",
              (Z, L, M, Z, L, M))

    print("(1) point jodna")
    r = cl.post("/api/pm/check-points", json={"zone": Z, "line": L, "machine_no": M, "check_point": "ZZ current"})
    T("type na ho -> 400", r.status_code == 400 and "type" in r.text.lower(), r.text[:90])
    r = cl.post("/api/pm/check-points", json={"zone": Z, "line": L, "machine_no": M, "check_point": "ZZ current",
                                              "judgement_standard": "< 8AMP", "type": "number"})
    T("type 'number' -> 201", r.status_code == 201, r.text[:90])
    new_id = r.json().get("id")
    p = pts()
    T("GET: naya NUMBER, purane (NULL) ALPHABET", [x["type"] for x in p] == ["ALPHABET", "ALPHABET", "NUMBER"],
      [x["type"] for x in p])

    print("\n(2) type badlo")
    vid = p[1]["id"]
    r = cl.put(f"/api/pm/check-points/{vid}/type", json={"type": "NUMBER"})
    T("voltage point -> NUMBER", r.status_code == 200 and pts()[1]["type"] == "NUMBER", r.text[:80])
    r = cl.put(f"/api/pm/check-points/{vid}/type", json={"type": "maybe"})
    T("galat type -> 400", r.status_code == 400)
    r = cl.put("/api/pm/check-points/-77/type", json={"type": "NUMBER"})
    T("anjaan id -> 404", r.status_code == 404)

    print("\n(3) revision bump")
    r = cl.put("/api/pm/check-point-rev", json={"zone": Z, "line": L, "machine_no": M, "rev_no": "", "rev_date": "",
                                                "new_points": [{"check_point": "ZZ ok one", "type": "ALPHABET"},
                                                               {"check_point": "ZZ no type"}]})
    T("staged point bina type -> 400", r.status_code == 400, r.text[:80])
    c.execute("SELECT COUNT(*) n FROM maintenance_pm_check_point_rev WHERE machine_no=%s", (M,))
    T("...aur kuch nahi badla (archive khaali, rev 1)", c.fetchone()["n"] == 0
      and all(str(x["rev_no"]) == "1" for x in pts()))
    r = cl.put("/api/pm/check-point-rev", json={"zone": Z, "line": L, "machine_no": M, "rev_no": "", "rev_date": "",
                                                "new_points": [{"check_point": "ZZ flow", "judgement_standard": "> 5 LPM",
                                                                "type": "NUMBER"}]})
    T("sab type ke saath -> 200", r.status_code == 200 and r.json().get("added_points") == 1, r.text[:90])
    c.execute("SELECT check_point, type FROM maintenance_pm_check_point_rev WHERE machine_no=%s ORDER BY sort_order", (M,))
    arch = [(x["check_point"], x["type"]) for x in c.fetchall()]
    T("archive me type ki naqal", arch == [("ZZ Clean panel", None), ("ZZ Main voltage", "NUMBER"),
                                         ("ZZ current", "NUMBER")], arch)
    p = pts()
    T("naya point NUMBER, rev 2", p[-1]["check_point"] == "ZZ flow" and p[-1]["type"] == "NUMBER"
      and str(p[-1]["rev_no"]) == "2", p[-1])

    print("\n(4) stepdown")
    r = cl.put("/api/pm/check-point-rev-stepdown", json={"zone": Z, "line": L, "machine_no": M})
    p = pts()
    T("Rev 1 wapas, type wahi", r.status_code == 200 and [(x["check_point"], x["type"]) for x in p]
      == [("ZZ Clean panel", "ALPHABET"), ("ZZ Main voltage", "NUMBER"), ("ZZ current", "NUMBER")],
      [(x["check_point"], x["type"]) for x in p])

    print("\n(5) bhari sheet")
    def body(st_v, ob="", lay=None, act=None):
        b = {"zone_name": Z, "line_name": L, "machine_no": M, "machine_name": "ZZ M", "pm_date": "2026-10-03",
             "rev_no": "1", "rev_date": "2026-01-01", "prepared_by": "ZZ", "sign_imgs": ["data:image/png;base64,AA==", None, None],
             "sheet_spares": [],
             "entries": [{"s_no": "1", "check_point": "ZZ Clean panel", "status": "OK", "type": "ALPHABET"},
                         {"s_no": "2", "check_point": "ZZ Main voltage", "status": st_v, "type": "NUMBER",
                          "observation": ob, "action_taken": ob if act is None else act}]}
        if lay:
            b["layout"] = lay
        return b
    r = cl.post("/api/pm/check-sheet-fill", json=body("OK", ob=""))
    T("NUMBER, Observation khaali -> 400 (reading chahiye)", r.status_code == 400
      and "Observation" in r.text, r.text[:120])
    r = cl.post("/api/pm/check-sheet-fill", json=body("OK", ob="VAC 212"))
    T("NUMBER, Observation 'VAC 212' -> 400 (shuru me number nahi)", r.status_code == 400)
    r = cl.post("/api/pm/check-sheet-fill", json=body("212 VAC", ob=""))
    T("purana tareeqa (STATUS me reading) -> 400", r.status_code == 400, r.text[:100])
    r = cl.post("/api/pm/check-sheet-fill", json=body("MAYBE", ob="240VAC"))
    T("STATUS OK / NG ke alawa -> 400", r.status_code == 400 and "OK or NG" in r.text, r.text[:100])
    for st_v, ob_v in (("OK", "240VAC"), ("NG", "210 VAC low side"), ("OK", "-0.5")):
        r = cl.post("/api/pm/check-sheet-fill", json=body(st_v, ob=ob_v, lay="classic"))
        T(f"NUMBER {st_v} + Observation '{ob_v}' -> 201", r.status_code == 201, r.text[:80])
    r = cl.post("/api/pm/check-sheet-fill", json=body("NG", ob="190 VAC low", lay="status_first", act=""))
    T("NG + Action khaali -> 400 (NG par Action zaroori)", r.status_code == 400 and "is NG" in r.text, r.text[:100])
    r = cl.post("/api/pm/check-sheet-fill", json=body("NG", ob="190 VAC low", lay="status_first", act="-"))
    T("NG + Action '-' -> 400 ('-' sirf OK ka default)", r.status_code == 400, r.text[:100])
    r = cl.post("/api/pm/check-sheet-fill", json=body("NG", ob="190 VAC low", lay="status_first", act="Tap changed"))
    T("status_first NUMBER NG + Action likha -> 201", r.status_code == 201, r.text[:100])
    sid = r.json().get("id")
    c.execute("SELECT entries FROM maintenance_pm_check_sheet_filled WHERE id=%s", (sid,))
    e1, e2 = c.fetchone()["entries"]
    T("NUMBER NG: Observation (reading) + Action bache, type naqal", e2["observation"] == "190 VAC low"
      and e2["action_taken"] == "Tap changed" and e2["type"] == "NUMBER" and e2["status"] == "NG", e2)
    T("ALPHABET OK: 'FOUND OK' + Action '-'", e1["observation"] == "FOUND OK" and e1["action_taken"] == "-", e1)
    r = cl.post("/api/pm/check-sheet-fill", json=body("OK", ob="240VAC", lay="status_first", act=""))
    sid = r.json().get("id")
    c.execute("SELECT entries FROM maintenance_pm_check_sheet_filled WHERE id=%s", (sid,))
    e2 = c.fetchone()["entries"][1]
    T("NUMBER OK + Action khaali -> '-'", r.status_code == 201 and e2["action_taken"] == "-", e2)
finally:
    try:
        conn.rollback()
    finally:
        pool.putconn(conn)

print("\n(6) rollback ke baad")
with database.get_conn() as c2:
    k = database.dict_cursor(c2)
    for t in ("maintenance_pm_check_point", "maintenance_pm_check_point_rev", "maintenance_pm_check_sheet_filled"):
        k.execute(f"SELECT COUNT(*) n FROM {t} WHERE machine_no=%s", (M,))
        T(f"{t}: ZZ-PT-1 nahi bacha", k.fetchone()["n"] == 0)

print("\n%s -- %d fail" % ("SAB PASS" if not _fail else "KUCH FAIL", _fail))
sys.exit(1 if _fail else 0)
