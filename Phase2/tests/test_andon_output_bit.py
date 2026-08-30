# -*- coding: utf-8 -*-
"""ANDON Call->Output bit ka behaviour test.

Do baatein pakki karta hai (user ne yahi maanga tha):
  (a) Har department ka PLC bit SIRF apne department ki call par ON ho.
  (b) Bit pehle se ON ho aur doosri machine se aur call aa jaye to koi jhatka
      na lage — bit ON hi rahe, aur AAKHRI call nipatne par hi OFF ho.

Chalane ka tareeqa (Phase2 folder se):
    .venv/Scripts/python.exe tests/test_andon_output_bit.py

Yeh asli `_want_bit` ko bulata hai — code ki nakal nahi — isliye logic badla to
test yahin pakad lega.
"""
import os
import sys
import warnings

warnings.filterwarnings("ignore")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv                                    # noqa: E402
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"),
            override=True)
from routers.andon import _want_bit, _dept_key                    # noqa: E402

_fail = 0


def L(**kw):
    """{'Maintenance': (total, unacked)} -> writer jaisa `live` map."""
    return {_dept_key(d): {"total": t, "unacked": u} for d, (t, u) in kw.items()}


def T(name, dept, live, expect):
    global _fail
    got = _want_bit(dept, live)
    ok = got is expect
    if not ok:
        _fail += 1
    print("   %s  %-58s %-12s bit=%s" % ("PASS" if ok else "FAIL", name, dept,
                                         "ON " if got else "OFF"))


print("\n--- (a) DEPARTMENT ALAG-ALAG: doosre ki call apna bit na chhede ---")
T("koi call nahi",                         "Maintenance", L(), False)
T("sirf Quality ki call khuli",            "Maintenance", L(Quality=(1, 1)), False)
T("sirf Toolroom ki call khuli",           "Maintenance", L(Toolroom=(1, 1)), False)
T("Quality+Toolroom+Material teeno khule", "Maintenance",
  L(Quality=(2, 2), Toolroom=(1, 1), Material=(3, 3)), False)
T("...usi waqt Toolroom ka apna bit",      "Toolroom",
  L(Quality=(2, 2), Toolroom=(1, 1), Material=(3, 3)), True)
T("...usi waqt Quality ka apna bit",       "Quality",
  L(Quality=(2, 2), Toolroom=(1, 1), Material=(3, 3)), True)
T("sirf Maintenance khuli, Quality ka bit", "Quality", L(Maintenance=(1, 1)), False)

print("\n--- (b) EK SE ZYADA CALL: bit pehle se ON hai to jhatka na lage ---")
T("1 call khuli, response nahi aaya",       "Maintenance", L(Maintenance=(1, 1)), True)
T("doosri machine se aur call -> 2",        "Maintenance", L(Maintenance=(2, 2)), True)
T("teesri bhi -> 3",                        "Maintenance", L(Maintenance=(3, 3)), True)
T("1 ka response aaya (3 khuli, 2 baaki)",  "Maintenance", L(Maintenance=(3, 2)), True)
T("2 ka response (3 khuli, 1 baaki)",       "Maintenance", L(Maintenance=(3, 1)), True)
T("AAKHRI ka bhi response -> tab OFF",      "Maintenance", L(Maintenance=(3, 0)), False)

print("\n--- Quality jaise dept: response se OFF nahi, call band hone par ---")
T("2 khuli, response aa gaya (unacked 0)",  "Quality", L(Quality=(2, 0)), True)
T("dono call band ho gayi",                 "Quality", L(Quality=(0, 0)), False)

print("\n--- naam ka style kuch bhi ho ---")
T("mapping 'Tool Room', ANDON 'Toolroom'",  "Tool Room", L(Toolroom=(1, 1)), True)
T("mapping ' MAINTENANCE '",                " MAINTENANCE ", L(Maintenance=(1, 1)), True)

print("\n   %s\n" % (">>> SAB PASS" if not _fail else ">>> %d FAIL" % _fail))
sys.exit(1 if _fail else 0)
