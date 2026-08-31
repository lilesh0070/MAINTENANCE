# -*- coding: utf-8 -*-
"""ANDON output bit — END-TO-END, asli SQL par.

test_andon_output_bit.py `live` dict haath se banata hai, to wo sirf faisle
ka logic jaanchta hai.  Asli khatra us QUERY me hai jo `live` banati hai
(GROUP BY, COALESCE(dep.name, display_name), state='OPEN' ka filter).  Yeh
test wahi query chalata hai, asli andon_system par.

SAB KUCH EK TRANSACTION ME HAI AUR ANT ME ROLLBACK — kuch commit nahi hota,
isliye na ANDON board par test calls dikhti hain, na escalation mail chalta
hai, na production ka writer inhe dekhta hai.

Chalane ka tareeqa (Phase2 folder se):
    .venv/Scripts/python.exe tests/test_andon_live_query.py
"""
import os
import sys
import warnings

warnings.filterwarnings("ignore")
_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(_HERE))

import psycopg2                                                   # noqa: E402
import psycopg2.extras                                            # noqa: E402
from dotenv import load_dotenv                                    # noqa: E402

load_dotenv(os.path.join(os.path.dirname(_HERE), ".env"), override=True)
from routers.andon import _want_bit, _dept_key                    # noqa: E402

# andon.py ke _andon_output_write_once wali query — hu-ba-hu.
LIVE = """SELECT COALESCE(dep.name, e.display_name) AS dept,
                 COUNT(*) FILTER (WHERE e.acknowledged_at IS NULL) AS unacked,
                 COUNT(*) AS total
            FROM andon_system e
            LEFT JOIN andon_departments dep ON dep.id = e.department_id
           WHERE e.state='OPEN' GROUP BY 1"""

_fail = 0


def main():
    global _fail
    c = psycopg2.connect(host=os.getenv("DB_HOST"), port=os.getenv("DB_PORT"),
                         dbname=os.getenv("DB_NAME"), user=os.getenv("DB_USER"),
                         password=os.getenv("DB_PASS"))
    c.autocommit = False
    cur = c.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    def bits():
        cur.execute(LIVE)
        live = {_dept_key(r["dept"]): r for r in cur.fetchall()}
        return {d: _want_bit(d, live) for d in ("Maintenance", "Toolroom", "Quality")}, live

    def T_named(step, got, dept, exp):
        """T ka wo roop jo kisi bhi department ka bit jaanch sake."""
        global _fail
        ok = got[dept] is exp
        if not ok:
            _fail += 1
        print("   %s  %-52s %s=%s" % ("PASS" if ok else "FAIL", step, dept,
                                      "ON " if got[dept] else "OFF"))

    def T2(step, live, exp1, exp2):
        """bit1 aur bit2 dono ek saath jaancho (Maintenance ke liye)."""
        global _fail
        b1 = _want_bit("Maintenance", live)
        b2 = _want_bit("Maintenance", live, on_close=True)
        ok = (b1 is exp1) and (b2 is exp2)
        if not ok:
            _fail += 1
        print("   %s  %-46s bit1=%s  bit2=%s" % ("PASS" if ok else "FAIL", step,
                                                 "ON " if b1 else "OFF", "ON " if b2 else "OFF"))

    def T(step, got, exp):
        global _fail
        ok = got["Maintenance"] is exp
        if not ok:
            _fail += 1
        print("   %s  %-52s Maint=%s  Tool=%s  Qual=%s"
              % ("PASS" if ok else "FAIL", step,
                 "ON " if got["Maintenance"] else "OFF",
                 "ON" if got["Toolroom"] else "off",
                 "ON" if got["Quality"] else "off"))

    try:
        cur.execute("SELECT id FROM andon_departments WHERE name='Maintenance'")
        md = cur.fetchone()["id"]
        cur.execute("SELECT id FROM andon_departments WHERE name='Quality'")
        qd = cur.fetchone()["id"]

        b, _ = bits()
        T("shuru me (koi call nahi)", b, False)

        ids = []
        for i in range(3):
            cur.execute("""INSERT INTO andon_system (department_id, display_name, state, started_at)
                           VALUES (%s,'Maintenance','OPEN', now()) RETURNING id""", (md,))
            ids.append(cur.fetchone()["id"])
            b, _ = bits()
            T("%d Maintenance call khuli (alag machine se)" % (i + 1), b, True)

        cur.execute("""INSERT INTO andon_system (department_id, display_name, state, started_at)
                       VALUES (%s,'Quality','OPEN', now())""", (qd,))
        b, _ = bits()
        T("saath me Quality ki call bhi khuli", b, True)

        for i, rid in enumerate(ids[:-1]):
            cur.execute("UPDATE andon_system SET acknowledged_at=now() WHERE id=%s", (rid,))
            b, _ = bits()
            T("%d ka response aa gaya (%d baaki)" % (i + 1, len(ids) - i - 1), b, True)

        cur.execute("UPDATE andon_system SET acknowledged_at=now() WHERE id=%s", (ids[-1],))
        b, _ = bits()
        T("AAKHRI ka bhi response -> ab OFF", b, False)

        cur.execute("""INSERT INTO andon_system (department_id, display_name, state, started_at)
                       VALUES (%s,'Maintenance','OPEN', now())""", (md,))
        b, _ = bits()
        T("baad me nayi call aayi -> phir ON", b, True)

        # ── SAFETY NET: ACK (ACC) na aaye to bhi call BAND hone par bit OFF ──
        # User ki chinta: "maan lo ACC wala data na pahuncha, kuch issue ho gaya
        # to Maintenance/Toolroom wali call band ho jaye tab bhi bit OFF ho".
        # Ye apne aap chalta hai kyunki `live` sirf andon_system ki KHULI calls
        # se banta hai, aur call band hote hi uski row wahan se hat jaati hai
        # (_apply_state close par DELETE karta hai) -> ginti 0 -> bit OFF.
        # Test isliye rakha hai ki kal koi `live` ki query badle (jaise band
        # calls bhi ginne lage) to yahin pakda jaye — warna ACK atakne par
        # andon tower hamesha jalta reh jaata.
        print()
        print("--- SAFETY NET: ACK na aaye, par call band ho jaye ---")
        cur.execute("DELETE FROM andon_system")          # sab saaf
        cur.execute("""INSERT INTO andon_system (department_id, display_name, state, started_at)
                       VALUES (%s,'Maintenance','OPEN', now()) RETURNING id""", (md,))
        c1 = cur.fetchone()["id"]
        b, _ = bits()
        T("Maintenance call aayi, ACK nahi aaya", b, True)
        cur.execute("DELETE FROM andon_system WHERE id=%s", (c1,))   # close = row hat jaati hai
        b, _ = bits()
        T("ACK BINA hi call band hui -> bit OFF", b, False)

        # do call: ek ACK se nipti, doosri ACK ke bina band hui
        cur.execute("""INSERT INTO andon_system (department_id, display_name, state, started_at)
                       VALUES (%s,'Maintenance','OPEN', now()) RETURNING id""", (md,))
        c2 = cur.fetchone()["id"]
        cur.execute("""INSERT INTO andon_system (department_id, display_name, state, started_at)
                       VALUES (%s,'Maintenance','OPEN', now()) RETURNING id""", (md,))
        c3 = cur.fetchone()["id"]
        cur.execute("UPDATE andon_system SET acknowledged_at=now() WHERE id=%s", (c2,))
        b, _ = bits()
        T("ek ka ACK aaya, doosri abhi baaki", b, True)
        cur.execute("DELETE FROM andon_system WHERE id=%s", (c3,))
        b, _ = bits()
        T("doosri ACK bina band -> bit OFF", b, False)

        # Toolroom par bhi wahi (uska bhi off-on-ack wala niyam hai)
        cur.execute("DELETE FROM andon_system")
        cur.execute("SELECT id FROM andon_departments WHERE name='Toolroom'")
        td = cur.fetchone()["id"]
        cur.execute("""INSERT INTO andon_system (department_id, display_name, state, started_at)
                       VALUES (%s,'Toolroom','OPEN', now()) RETURNING id""", (td,))
        t1 = cur.fetchone()["id"]
        bb, _ = bits()
        T_named("Toolroom call aayi, ACK nahi", bb, "Toolroom", True)
        cur.execute("DELETE FROM andon_system WHERE id=%s", (t1,))
        bb, _ = bits()
        T_named("Toolroom ACK bina band -> bit OFF", bb, "Toolroom", False)
        # ── DOOSRA BIT: response par nahi, BREAKDOWN BAND hone par girta hai ──
        # bit1 = "koi pahuncha ya nahi"  ·  bit2 = "kaam khatam hua ya nahi".
        # Ye test isliye hai ki bit2 ka faisla `total` par tika hai — kal koi
        # `live` ki query ya _want_bit ka on_close hissa chhed de to bit2 ya to
        # response par gir jayega (galat) ya kabhi girega hi nahi (tower jalti
        # rehti).  Dono yahin pakde jaayenge.
        print()
        print("--- DOOSRA BIT (on_close): response se nahi, band hone par OFF ---")
        cur.execute("DELETE FROM andon_system")
        cur.execute("""INSERT INTO andon_system (department_id, display_name, state, started_at)
                       VALUES (%s,'Maintenance','OPEN', now()) RETURNING id""", (md,))
        d1 = cur.fetchone()["id"]
        b, live = bits()
        T2("call aayi -> dono ON", live, True, True)
        cur.execute("UPDATE andon_system SET acknowledged_at=now() WHERE id=%s", (d1,))
        b, live = bits()
        T2("RESPONSE aaya -> bit1 OFF, bit2 ON", live, False, True)
        cur.execute("DELETE FROM andon_system WHERE id=%s", (d1,))
        b, live = bits()
        T2("breakdown BAND -> dono OFF", live, False, False)

        cur.execute("""INSERT INTO andon_system (department_id, display_name, state, started_at)
                       VALUES (%s,'Maintenance','OPEN', now()) RETURNING id""", (md,))
        d2 = cur.fetchone()["id"]
        cur.execute("DELETE FROM andon_system WHERE id=%s", (d2,))
        b, live = bits()
        T2("ACK aaye BINA band hui -> dono OFF", live, False, False)
    finally:
        c.rollback()                      # <- test ka koi nishan nahi bachta

    cur2 = c.cursor()
    cur2.execute("SELECT COUNT(*) FROM andon_system WHERE state='OPEN'")
    print("\n   ROLLBACK ho gaya — khuli calls ab: %d (test se pehle jitni)" % cur2.fetchone()[0])
    c.close()
    print("   %s\n" % (">>> SAB PASS" if not _fail else ">>> %d FAIL" % _fail))
    return 1 if _fail else 0


if __name__ == "__main__":
    sys.exit(main())
