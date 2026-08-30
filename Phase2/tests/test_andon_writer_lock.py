# -*- coding: utf-8 -*-
"""ANDON output-writer lock ka takeover niyam.

Sirf EK backend output PLC par likhe.  Pehle niyam sabke liye ek jaisa tha —
"holder 10 second chup ho to koi bhi le le".  Ek MC operation ka timeout ~4s
hai, to production ka loop zara sa atakne par bhi 10s paar kar jaata tha aur
DEV laptop lock utha leta: production laut kar apna PLC connection band karta,
phir prio se wapas chheen kar dobara connect karta — yahi "baar-baar connect /
disconnect" tha, aur sabse zyada tab jab bit ON hota hai (asli write usi waqt).

Ab niyam prio-aware hai: chhota backend bade se tabhi leta hai jab wo poore 60
second chup ho (sach me mar gaya ho).  Yeh test wahi SQL asli DB par chalata
hai, magar ek SCRATCH table par — live lock (andon_output_lock) ko haath nahi
lagata, production chalta rehta hai.

Chalane ka tareeqa (Phase2 folder se):
    .venv/Scripts/python.exe tests/test_andon_writer_lock.py
"""
import os
import sys
import warnings

warnings.filterwarnings("ignore")
_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(_HERE))

import psycopg2                                                   # noqa: E402
from dotenv import load_dotenv                                    # noqa: E402

load_dotenv(os.path.join(os.path.dirname(_HERE), ".env"), override=True)

# andon.py ke _acquire_writer_lock wala WHERE — bilkul wahi shartein.
SQL = """UPDATE _lock_test SET holder=%s, prio=%s, heartbeat=NOW()
          WHERE id=1 AND (holder=%s
                          OR split_part(holder, ':', 1) = %s
                          OR COALESCE(prio,0) < %s
                          OR (COALESCE(prio,0) = %s AND heartbeat < NOW() - INTERVAL '10 seconds')
                          OR (COALESCE(prio,0) > %s AND heartbeat < NOW() - INTERVAL '60 seconds'))"""

DEV = "dev-laptop:111"
PRD = "server-ThinkSystem-ST650-V3:13298"
_fail = 0


def main():
    global _fail
    c = psycopg2.connect(host=os.getenv("DB_HOST"), port=os.getenv("DB_PORT"),
                         dbname=os.getenv("DB_NAME"), user=os.getenv("DB_USER"),
                         password=os.getenv("DB_PASS"))
    cur = c.cursor()
    cur.execute("DROP TABLE IF EXISTS _lock_test")
    cur.execute("""CREATE TABLE _lock_test (id INTEGER PRIMARY KEY DEFAULT 1,
                     holder TEXT, prio INTEGER DEFAULT 0, heartbeat TIMESTAMP)""")

    def attempt(me, myprio, myhost, holder, hprio, stale_s):
        cur.execute("DELETE FROM _lock_test")
        cur.execute("INSERT INTO _lock_test VALUES (1,%s,%s, NOW() - (%s || ' seconds')::interval)",
                    (holder, hprio, stale_s))
        cur.execute(SQL, (me, myprio, me, myhost, myprio, myprio, myprio))
        return cur.rowcount == 1

    def T(name, got, expect):
        global _fail
        ok = got is expect
        if not ok:
            _fail += 1
        print("   %s  %-62s -> %s" % ("PASS" if ok else "FAIL", name,
                                      "LE LIYA" if got else "nahi liya"))

    print("\n--- DEV (prio 0) production (prio 1) se lock lene ki koshish ---")
    T("production abhi-abhi bola (0s chup)",    attempt(DEV, 0, "dev-laptop", PRD, 1, 0), False)
    T("production 12s chup (PLC slow tha)",     attempt(DEV, 0, "dev-laptop", PRD, 1, 12), False)
    T("production 30s chup",                    attempt(DEV, 0, "dev-laptop", PRD, 1, 30), False)
    T("production 59s chup",                    attempt(DEV, 0, "dev-laptop", PRD, 1, 59), False)
    T("production 90s chup (sach me mar gaya)", attempt(DEV, 0, "dev-laptop", PRD, 1, 90), True)

    print("\n--- PRODUCTION (prio 1) — apna haq turant ---")
    T("dev baitha hai, 0s chup -> turant preempt",
      attempt(PRD, 1, "server-ThinkSystem-ST650-V3", DEV, 0, 0), True)

    print("\n--- barabar prio ka failover (10s) ---")
    T("peer 5s chup",  attempt("b:2", 1, "hostB", "a:1", 1, 5), False)
    T("peer 12s chup", attempt("b:2", 1, "hostB", "a:1", 1, 12), True)

    print("\n--- apna hi purana instance (restart) ---")
    T("wahi host, 0s chup -> turant",
      attempt("server-ThinkSystem-ST650-V3:999", 1, "server-ThinkSystem-ST650-V3", PRD, 1, 0), True)

    print("\n--- holder khud (heartbeat refresh) ---")
    T("main hi holder hoon", attempt(PRD, 1, "server-ThinkSystem-ST650-V3", PRD, 1, 0), True)

    cur.execute("DROP TABLE _lock_test")
    c.commit()
    c.close()
    print("\n   %s\n" % (">>> SAB PASS" if not _fail else ">>> %d FAIL" % _fail))
    return 1 if _fail else 0


if __name__ == "__main__":
    sys.exit(main())
