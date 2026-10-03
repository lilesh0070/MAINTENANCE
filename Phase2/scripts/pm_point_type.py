# -*- coding: utf-8 -*-
r"""
pm_point_type.py — PM check point ka TYPE (ALPHABET / NUMBER) EK BAAR bharo.

User (2026-10-03): "pm check sheet wali table me ek column aur -- type; usme
alphabet aur number.  Point 1, 2, 3 (Neat & Clean...) alphabet, point 4
(3ph/210 Vac ±10 Vac) me value daalni padegi -- number.  Saare check kar lo
aur daal do."

Niyam (168 alag-alag judgement standard ek-ek padh kar tay kiye):
  NUMBER   = judgement standard me NAAPNE wali value -- volt (Vac / V), amp,
             LPM:  "3ph/210 Vac ±10 Vac", "< 8AMP", "≤ 2.0 AMP", "> 5 LPM" ...
             Judgement khaali ho to check point se: "...Current" (clamp meter),
             "...220 Volt".
  ALPHABET = baaki sab (Neat & Clean, No Loosness, Should be work ...).  Jaan-
             boojh kar ALPHABET: "≥ 80% Should be OK" (copper shunt -- aankh se),
             "Should display 180 Degree ..." (display ki jaanch), "1.Gear box ..."
             (sirf ginti).
Sirf jinka type KHAALI hai unhe bharta hai -- baad me haath se badla hua
type kabhi nahi chhedta.  Dono table: chalu + revision archive.

CHALANE KA TAREEQA (Phase2 folder se)
    .venv\Scripts\python.exe scripts\pm_point_type.py            # sirf dikhao (kuch nahi likhta)
    .venv\Scripts\python.exe scripts\pm_point_type.py --apply    # DB me likho
"""
import argparse
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PHASE2 = os.path.dirname(HERE)
sys.path.insert(0, PHASE2)
os.chdir(PHASE2)
from dotenv import load_dotenv                                   # noqa: E402
load_dotenv(os.path.join(PHASE2, ".env"), override=True)
from database import get_conn, dict_cursor                       # noqa: E402

# value + ikai (volt / amp / LPM).  "80%", "180 Degree", "1.Gear" yahan nahi aate.
_NUM_JS = re.compile(r"\d+(?:\.\d+)?\s*(?:v\s*ac|vac|v\b|volt|amp|a\b|lpm)", re.I)
# judgement khaali ho to check point me naap ka shabd
_NUM_CP = re.compile(r"\b(?:current|volt|voltage)\b|\d+\s*volt", re.I)

TABLES = ("maintenance_pm_check_point", "maintenance_pm_check_point_rev")


def classify(js, cp) -> str:
    s = (js or "").strip()
    if s:
        return "NUMBER" if _NUM_JS.search(s) else "ALPHABET"
    return "NUMBER" if _NUM_CP.search(cp or "") else "ALPHABET"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="DB me likho (warna sirf dikhao)")
    args = ap.parse_args()

    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("SET LOCAL lock_timeout = '5s'")
        cur.execute("SET LOCAL statement_timeout = '60s'")
        for t in TABLES:
            cur.execute("SELECT to_regclass(%s) IS NOT NULL AS hai", (t,))
            if not cur.fetchone()["hai"]:
                print(f"  {t}: table hi nahi -- chhoda")
                continue
            if args.apply:
                cur.execute(f"ALTER TABLE {t} ADD COLUMN IF NOT EXISTS type VARCHAR(10)")
            cur.execute("""SELECT 1 FROM information_schema.columns
                            WHERE table_name = %s AND column_name = 'type'""", (t,))
            has_col = bool(cur.fetchone())
            sel = "type" if has_col else "NULL::text AS type"
            cur.execute(f"SELECT id, judgement_standard, check_point, {sel} FROM {t}")
            rows = cur.fetchall()
            khaali = [r for r in rows if not (r["type"] or "").strip()]
            ginti = {"NUMBER": [], "ALPHABET": []}
            for r in khaali:
                ginti[classify(r["judgement_standard"], r["check_point"])].append(r["id"])
            print(f"\n  {t}: kul {len(rows)}, type khaali {len(khaali)} -> "
                  f"NUMBER {len(ginti['NUMBER'])}, ALPHABET {len(ginti['ALPHABET'])}")
            # NUMBER wale judgement standard (alag-alag) -- jaanch ke liye
            js_num = {}
            for r in khaali:
                if classify(r["judgement_standard"], r["check_point"]) == "NUMBER":
                    k = (r["judgement_standard"] or "").strip() or f"(khaali) {r['check_point']}"
                    js_num[k] = js_num.get(k, 0) + 1
            for k in sorted(js_num, key=str.lower):
                print(f"     NUMBER [{js_num[k]:3d}] {k}")
            if args.apply:
                for typ, ids in ginti.items():
                    for i in range(0, len(ids), 500):
                        cur.execute(f"UPDATE {t} SET type = %s WHERE id = ANY(%s) AND type IS NULL",
                                    (typ, ids[i:i + 500]))
        if args.apply:
            conn.commit()
            print("\n  LIKH DIYA.")
        else:
            conn.rollback()
            print("\n  (sirf dikhaya -- DB me kuch nahi likha; likhne ke liye --apply)")


if __name__ == "__main__":
    main()
