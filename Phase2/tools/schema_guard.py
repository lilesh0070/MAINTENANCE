# -*- coding: utf-8 -*-
"""
schema_guard.py — DB ke dhanche ka pehra.

Kaam kya hai
------------
Ek baar poore `maintenance_db` ka dhancha (har table, har column, uska type,
nullable, default) ek JSON file me utaar leta hai.  Baad me kabhi bhi milaan
kar ke bata deta hai ki kya-kya badla:

  • nayi table bani            • table gayab ho gayi
  • naya column juda           • column gayab ho gaya
  • column ka type badla       • nullable / default badla
  • column ka NAAM badla       (drop + add ki jodi se anumaan lagata hai)

Kyun zaroori hai
----------------
Kal koi bhi seedha DB me column jod sakta hai ya naam badal sakta hai, aur
code chalta rahega — dikkat mahinon baad kisi report me nikalti hai.  Snapshot
git me rehta hai, isliye `git log` se ye bhi pata chalta hai ki wo badlav KAB
aaya aur kis commit ke saath.

Istemal (Phase2 folder se)
--------------------------
    .venv/Scripts/python.exe tools/schema_guard.py check    # milaan karo
    .venv/Scripts/python.exe tools/schema_guard.py save     # naya baseline

`check` ka exit code:  0 = sab waisa hi,  1 = farak mila,  2 = DB tak nahi
pahuncha.  (Isse ise kisi bhi jaanch/CI me chalaya ja sakta hai.)

DHYAN: `save` tabhi chalayein jab badlav JAAN-BOOJHKAR kiya gaya ho.  Bina
soche `save` chala diya to pehra apne aap "sab theek" kehne lagega — aur
yahi ek cheez is tool ko bekaar kar sakti hai.
"""
import json
import os
import sys
from datetime import datetime

_HERE = os.path.dirname(os.path.abspath(__file__))
_PHASE2 = os.path.dirname(_HERE)
sys.path.insert(0, _PHASE2)

SNAPSHOT = os.path.join(_HERE, "schema_snapshot.json")


def _connect():
    import warnings
    warnings.filterwarnings("ignore")
    import psycopg2
    from dotenv import load_dotenv
    load_dotenv(os.path.join(_PHASE2, ".env"), override=True)
    return psycopg2.connect(
        host=os.getenv("DB_HOST"), port=os.getenv("DB_PORT"),
        dbname=os.getenv("DB_NAME"), user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASS"), connect_timeout=8)


def read_live():
    """DB se abhi ka dhancha padho -> {table: {column: {type, nullable, default}}}"""
    conn = _connect()
    cur = conn.cursor()
    cur.execute("""
        SELECT c.table_name, c.column_name, c.data_type,
               c.is_nullable, c.column_default, c.ordinal_position
          FROM information_schema.columns c
          JOIN information_schema.tables t
            ON t.table_schema = c.table_schema AND t.table_name = c.table_name
         WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
         ORDER BY c.table_name, c.ordinal_position
    """)
    out = {}
    for tbl, col, typ, nul, dflt, pos in cur.fetchall():
        # default me apne aap banne wale sequence ka naam aata hai (nextval(...)),
        # jo table rename par badal jaata — usse jhoothi "badlav" report banti.
        d = None if dflt is None else str(dflt)
        if d and d.startswith("nextval("):
            d = "nextval(<sequence>)"
        out.setdefault(tbl, {})[col] = {
            "type": typ, "nullable": nul == "YES", "default": d, "pos": pos}
    conn.close()
    return out


def save():
    live = read_live()
    data = {
        "taken_at": datetime.now().isoformat(timespec="seconds"),
        "db": os.getenv("DB_NAME"),
        "tables": len(live),
        "columns": sum(len(v) for v in live.values()),
        "schema": live,
    }
    with open(SNAPSHOT, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=1, ensure_ascii=False, sort_keys=True)
    print("  snapshot save: %d tables, %d columns  ->  %s"
          % (data["tables"], data["columns"], os.path.basename(SNAPSHOT)))
    print("  ise git me commit kar dein — tabhi baad me pata chalega badlav KAB aaya.")


def check():
    if not os.path.exists(SNAPSHOT):
        print("  snapshot hai hi nahi.  Pehle chalayein:  python tools/schema_guard.py save")
        return 2
    with open(SNAPSHOT, encoding="utf-8") as f:
        old = json.load(f)["schema"]
    new = read_live()

    added_t = sorted(set(new) - set(old))
    gone_t = sorted(set(old) - set(new))
    added_c, gone_c, changed = [], [], []
    for t in sorted(set(old) & set(new)):
        o, n = old[t], new[t]
        for c in sorted(set(n) - set(o)):
            added_c.append((t, c, n[c]["type"]))
        for c in sorted(set(o) - set(n)):
            gone_c.append((t, c, o[c]["type"]))
        for c in sorted(set(o) & set(n)):
            for k in ("type", "nullable", "default"):
                if o[c].get(k) != n[c].get(k):
                    changed.append((t, c, k, o[c].get(k), n[c].get(k)))

    # NAAM BADLA hua column: ek hi table me ek column gaya aur ek aaya, aur
    # dono ka type ek hi -> bahut sambhavna hai ki rename hua hai, naya nahi.
    renamed = []
    for t in {x[0] for x in gone_c} & {x[0] for x in added_c}:
        g = [x for x in gone_c if x[0] == t]
        a = [x for x in added_c if x[0] == t]
        if len(g) == 1 and len(a) == 1 and g[0][2] == a[0][2]:
            renamed.append((t, g[0][1], a[0][1], g[0][2]))
            gone_c.remove(g[0])
            added_c.remove(a[0])

    print("  snapshot : %d tables" % len(old))
    print("  abhi DB  : %d tables" % len(new))
    print()
    if not any([added_t, gone_t, added_c, gone_c, changed, renamed]):
        print("  >>> KOI FARAK NAHI — dhancha bilkul waisa hi hai.")
        return 0

    if added_t:
        print("  NAYI TABLE (%d):" % len(added_t))
        for t in added_t:
            print("     + %s  (%d columns)" % (t, len(new[t])))
    if gone_t:
        print("  TABLE GAYAB (%d):" % len(gone_t))
        for t in gone_t:
            print("     - %s  (snapshot me %d columns the)" % (t, len(old[t])))
    if renamed:
        print("  COLUMN KA NAAM BADLA lagta hai (%d):" % len(renamed))
        for t, a, b, ty in renamed:
            print("     ~ %s : %s  ->  %s   (%s)" % (t, a, b, ty))
    if added_c:
        print("  NAYA COLUMN (%d):" % len(added_c))
        for t, c, ty in added_c:
            print("     + %s.%s   (%s)" % (t, c, ty))
    if gone_c:
        print("  COLUMN GAYAB (%d):" % len(gone_c))
        for t, c, ty in gone_c:
            print("     - %s.%s   (%s)" % (t, c, ty))
    if changed:
        print("  COLUMN BADLA (%d):" % len(changed))
        for t, c, k, o, n in changed:
            print("     ~ %s.%s  %s: %s  ->  %s" % (t, c, k, o, n))

    print()
    print("  >>> FARAK MILA.  Har badlav jaan-boojhkar kiya gaya hai — ye pakka")
    print("      karne ke BAAD hi `save` chalayein, warna pehra bekaar ho jayega.")
    return 1


if __name__ == "__main__":
    cmd = (sys.argv[1] if len(sys.argv) > 1 else "check").lower()
    try:
        if cmd == "save":
            save()
            sys.exit(0)
        elif cmd == "check":
            sys.exit(check())
        else:
            print(__doc__)
            sys.exit(2)
    except Exception as e:
        print("  DB tak nahi pahuncha ya kuch aur dikkat: %s" % str(e)[:200])
        sys.exit(2)
