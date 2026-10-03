# -*- coding: utf-8 -*-
"""PM check sheet LAYOUT (classic / status_first) -- ASLI DB, SIRF ROLLBACK, HTTP raaste se.

  (1) PUT /check-sheet-layout: supervisor -> 403; galat naam -> 400; admin -> 200,
      GET /check-sheet-format me layout, _current_layout() wahi
  (2) nayi sheet (layout na bheja = chuna hua status_first): OK point ka
      Observation / Action saaf, NG ka bacha; har row ka sign saaf; Spares
      Used sirf YES / NO ("yes" -> YES, kachra -> khaali); doc_footer snapshot
      me layout = status_first
  (3) nayi sheet layout="classic" bheja: kuch saaf NAHI, snapshot classic
  (4) layout chuna hua classic ho jaye, phir status_first wali sheet ka
      RESUBMIT -> sheet ka APNA layout (status_first) chalta hai -> saaf
  (5) ADMIN edit: classic sheet par OK ka observation bacha; status_first par saaf
  (6) GET /check-sheet-fill/{id}: doc_footer.layout aata hai
  (7) ROLLBACK ke baad: format ki layout jaisi pehle thi, ZZ sheet nahi bachi

⚠ PROD DB: ek connection, commit kabhi nahi (har request ek SAVEPOINT); DDL /
spare / audit naqli (`_ensure_*`, `_record_pm_spares`, `main.write_audit`).
Chalane ka tareeqa (Phase2 folder se):
    .venv/Scripts/python.exe tests/test_pm_layout.py
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


# naqli: DB rasta, DDL band, spare report / audit band
P.get_conn = fake_get_conn
P._ensure_format_table = lambda: None
P._ensure_fill_table = lambda: None
P._record_pm_spares = lambda body, pmd: None
sys.modules["main"] = types.SimpleNamespace(write_audit=lambda *a, **k: None)

ADMIN = {"id": -9301, "username": "zz_pm_admin", "role": "admin"}
SUP   = {"id": -9302, "username": "zz_pm_sup", "role": "supervisor"}
ab = {"user": ADMIN}
app = FastAPI()
app.include_router(P.router)
app.dependency_overrides[auth.get_current_user] = lambda: ab["user"]


class _Cl:
    """Starlette ka TestClient is venv ke httpx se mel nahi khaata -- seedha
    httpx + ASGITransport (asli route / Depends / require_admin se guzarta hai)."""
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

SIGN = "data:image/png;base64,iVBORw0KGgo="


def entries():
    return [
        {"s_no": 1, "check_point": "ZZ BELT", "judgement_standard": "NO CRACK", "method": "VISUAL",
         "status": "OK", "observation": "ZZ OK PAR LIKHA", "action_taken": "ZZ OK ACTION", "sign": "ZZ", "spares_used": " yes "},
        {"s_no": 2, "check_point": "ZZ BOLT", "judgement_standard": "TIGHT", "method": "SPANNER",
         "status": "NG", "observation": "ZZ LOOSE", "action_taken": "ZZ TIGHTENED", "sign": "ZZ", "spares_used": "NO"},
        {"s_no": 3, "check_point": "ZZ OIL", "judgement_standard": "LEVEL", "method": "VISUAL",
         "status": "OK", "observation": "", "action_taken": "", "sign": "", "spares_used": "BEARING 6204"},
    ]


def body(**k):
    b = {"zone_name": "ZZ ZONE", "line_name": "ZZ LINE", "machine_no": "ZZ-PM-1", "machine_name": "ZZ M",
         "pm_date": "2026-10-03", "rev_no": "1", "rev_date": "2026-01-01", "entries": entries(),
         "prepared_by": "ZZ TM", "sign_imgs": [SIGN, None, None], "sheet_spares": []}
    b.update(k)
    return b


try:
    conn.autocommit = False
    c = database.dict_cursor(conn)
    c.execute("SET LOCAL lock_timeout = '2s'")
    c.execute("SET LOCAL statement_timeout = '20s'")
    c.execute("SET LOCAL idle_in_transaction_session_timeout = '120s'")
    c.execute("SELECT format->>'layout' AS l FROM maintenance_pm_check_sheet_format WHERE name='PM CHECK SHEET FORMAT'")
    pehle = c.fetchone()["l"]
    print("format ka layout pehle:", pehle)

    print("(1) layout chunna")
    ab["user"] = SUP
    r = cl.put("/api/pm/check-sheet-layout", json={"layout": "status_first"})
    T("supervisor -> 403", r.status_code == 403, r.status_code)
    ab["user"] = ADMIN
    r = cl.put("/api/pm/check-sheet-layout", json={"layout": "galat"})
    T("galat naam -> 400", r.status_code == 400, r.text[:80])
    r = cl.put("/api/pm/check-sheet-layout", json={"layout": "status_first"})
    T("admin -> 200", r.status_code == 200 and r.json().get("layout") == "status_first", r.text[:80])
    g = cl.get("/api/pm/check-sheet-format").json()
    T("GET format me layout = status_first", (g.get("format") or {}).get("layout") == "status_first")
    T("_current_layout() = status_first", P._current_layout() == "status_first")

    print("\n(2) nayi sheet -- chuna hua status_first")
    r = cl.post("/api/pm/check-sheet-fill", json=body())
    T("save 201", r.status_code == 201, r.text[:120])
    sid = r.json().get("id")
    c.execute("SELECT entries, doc_footer FROM maintenance_pm_check_sheet_filled WHERE id=%s", (sid,))
    row = c.fetchone()
    e1, e2, e3 = row["entries"]
    T("OK point: observation pakka 'FOUND OK', action jaisa likha (badal sakte)",
      e1["observation"] == "FOUND OK" and e1["action_taken"] == "ZZ OK ACTION", e1)
    T("OK point, action khaali -> '-' (sabke liye default)", e3["action_taken"] == "-"
      and e3["observation"] == "FOUND OK", e3)
    T("NG point: observation / action bache", e2["observation"] == "ZZ LOOSE" and e2["action_taken"] == "ZZ TIGHTENED")
    T("har row ka sign saaf", e1["sign"] == "" and e2["sign"] == "")
    T("Spares Used: ' yes ' -> YES, NO -> NO, kachra -> khaali",
      (e1["spares_used"], e2["spares_used"], e3["spares_used"]) == ("YES", "NO", ""),
      (e1["spares_used"], e2["spares_used"], e3["spares_used"]))
    T("snapshot layout = status_first", (row["doc_footer"] or {}).get("layout") == "status_first", row["doc_footer"])

    print("\n(3) nayi sheet -- layout classic bheja")
    r = cl.post("/api/pm/check-sheet-fill", json=body(layout="classic"))
    cid = r.json().get("id")
    c.execute("SELECT entries, doc_footer FROM maintenance_pm_check_sheet_filled WHERE id=%s", (cid,))
    row = c.fetchone()
    T("classic: OK ka observation / sign bache", row["entries"][0]["observation"] == "ZZ OK PAR LIKHA"
      and row["entries"][0]["sign"] == "ZZ", row["entries"][0])
    T("classic: spares_used jyon ka tyon", row["entries"][2]["spares_used"] == "BEARING 6204")
    T("classic: OK + khaali observation / action -> 'FOUND OK' / '-'",
      row["entries"][2]["observation"] == "FOUND OK" and row["entries"][2]["action_taken"] == "-", row["entries"][2])
    T("snapshot layout = classic", (row["doc_footer"] or {}).get("layout") == "classic")

    print("\n(4) resubmit -- sheet ka APNA layout")
    r = cl.put("/api/pm/check-sheet-layout", json={"layout": "classic"})
    T("ab chuna hua classic", r.status_code == 200 and P._current_layout() == "classic")
    c.execute("UPDATE maintenance_pm_check_sheet_filled SET stage='REJECTED' WHERE id=%s", (sid,))
    r = cl.put(f"/api/pm/check-sheet-fill/{sid}", json=body())
    T("resubmit 200", r.status_code == 200, r.text[:120])
    c.execute("SELECT entries FROM maintenance_pm_check_sheet_filled WHERE id=%s", (sid,))
    e1 = c.fetchone()["entries"][0]
    T("status_first sheet: OK ka observation phir bhi default", e1["observation"] == "FOUND OK" and e1["sign"] == "", e1)

    print("\n(5) admin edit")
    r = cl.put(f"/api/pm/check-sheet-fill/{cid}/admin", json=body(layout="status_first"))
    T("classic sheet admin edit 200", r.status_code == 200, r.text[:120])
    c.execute("SELECT entries FROM maintenance_pm_check_sheet_filled WHERE id=%s", (cid,))
    T("classic sheet: OK ka observation bacha (body ka layout nahi maana)",
      c.fetchone()["entries"][0]["observation"] == "ZZ OK PAR LIKHA")
    r = cl.put(f"/api/pm/check-sheet-fill/{sid}/admin", json=body())
    c.execute("SELECT entries FROM maintenance_pm_check_sheet_filled WHERE id=%s", (sid,))
    T("status_first sheet admin edit: OK ka observation default", r.status_code == 200
      and c.fetchone()["entries"][0]["observation"] == "FOUND OK")
    ab["user"] = SUP
    r = cl.put(f"/api/pm/check-sheet-fill/{sid}/admin", json=body())
    T("supervisor admin-edit -> 403", r.status_code == 403)
    ab["user"] = ADMIN

    print("\n(6) GET sheet")
    g = cl.get(f"/api/pm/check-sheet-fill/{sid}").json()
    T("doc_footer.layout aata hai", (g.get("doc_footer") or {}).get("layout") == "status_first", g.get("doc_footer"))
finally:
    try:
        conn.rollback()
    finally:
        pool.putconn(conn)

print("\n(7) rollback ke baad")
with database.get_conn() as c2:
    k = database.dict_cursor(c2)
    k.execute("SELECT format->>'layout' AS l FROM maintenance_pm_check_sheet_format WHERE name='PM CHECK SHEET FORMAT'")
    T("format ka layout jaisa pehle (%s)" % pehle, k.fetchone()["l"] == pehle)
    k.execute("SELECT COUNT(*) AS n FROM maintenance_pm_check_sheet_filled WHERE machine_no = 'ZZ-PM-1'")
    T("ZZ sheet nahi bachi", k.fetchone()["n"] == 0)

print("\n%s -- %d fail" % ("SAB PASS" if not _fail else "KUCH FAIL", _fail))
sys.exit(1 if _fail else 0)
