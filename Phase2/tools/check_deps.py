# -*- coding: utf-8 -*-
r"""
check_deps.py — `requirements.txt` aur venv ka milaan, startup par.

KYUN BANI
---------
`requirements.txt` badalne par `pip install` dobara chalana bhool jaana bahut
aasan hai, aur ye galti **chup-chaap** nikalti hai: backend poori tarah chal
jaata hai, bas wo EK feature marta hai jo us library par tika hota hai.

2026-09-12 ko theek yahi hua.  `pymodbus` 09-10 ko requirements me juda tha,
laptop par install ho gaya, **server par nahi**.  Nateeja seedha UI par mila —
ANDON me FX5U "Disconnected".  Asli wajah (`ModuleNotFoundError: No module
named 'pymodbus'`) DB ke `last_poll_error` me padi thi, par wahan tab tak koi
nahi dekhta jab tak kuch laal na ho jaye.  Ab wo baat **shuru me hi** dikh
jaayegi, kisi ke laal hone se pehle.

DO FAISLE, JAAN-BOOJHKAR
-----------------------
1. **Rokte NAHI hain.**  Ek missing library ke liye poora MES band kar dena
   usse bura hai jo dikkat wo library ki kami se hoti hai.  Sirf saaf-saaf
   likh dete hain; exit code se `start.sh` faisla kar sakta hai.
2. **Import nahi karte, METADATA dekhte hain.**  `import` karna dheema hai
   (anthropic/fastapi uthane me waqt lagta hai) aur naam bhi alag hote hain
   (`psycopg2-binary` -> `psycopg2`, `python-dotenv` -> `dotenv`).
   `importlib.metadata` seedha WAHI naam samajhta hai jo requirements me
   likha hai, isliye koi naam-badalne wali table rakhni hi nahi padti.

CHALANE KA TAREEQA
------------------
    .venv/bin/python tools/check_deps.py               # chhota natija
    .venv/bin/python tools/check_deps.py --verbose     # har package
    .venv/bin/python tools/check_deps.py other/req.txt # kisi aur file par

Exit code:  0 = sab maujood,  1 = kuch missing.
(Version ka farak sirf chetawni hai — exit code us par nahi badalta.)
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PHASE2 = os.path.dirname(HERE)
REQ = os.path.join(PHASE2, "requirements.txt")

# naam[extra,extra] ==1.2.3   /  >=1.2   /  bina version
_LINE = re.compile(r"^\s*([A-Za-z0-9._-]+)\s*(?:\[[^\]]*\])?\s*(?:(==|>=|<=|~=|!=|>|<)\s*([^\s;#]+))?")


def padho(path):
    """requirements.txt se (naam, chinh, version) nikaalo."""
    out = []
    if not os.path.isfile(path):
        return out
    with open(path, encoding="utf-8") as f:
        for raw in f:
            line = raw.split("#", 1)[0].strip()
            # `-r other.txt`, `-e .`, environment marker wali line chhod dete hain
            if not line or line.startswith("-"):
                continue
            m = _LINE.match(line)
            if m and m.group(1):
                out.append((m.group(1), m.group(2), m.group(3)))
    return out


def main():
    verbose = "--verbose" in sys.argv or "-v" in sys.argv
    # Koi aur requirements file bhi de sakte hain -- ismi se ye jaanchna
    # mumkin hota hai ki "missing" wala raasta sach me kaam karta hai.
    global REQ
    for a in sys.argv[1:]:
        if not a.startswith("-"):
            REQ = a
            break
    try:
        from importlib.metadata import version as _ver, PackageNotFoundError
    except ImportError:                       # Python 3.7 ya usse purana
        print("  [WARN] check_deps: is Python me importlib.metadata nahi hai - jaanch chhodi.")
        return 0

    chahiye = padho(REQ)
    if not chahiye:
        print(f"  [WARN] check_deps: requirements.txt nahi mili ya khali hai ({REQ})")
        return 0

    missing, mismatch = [], []
    for naam, chinh, chaha in chahiye:
        try:
            mila = _ver(naam)
        except PackageNotFoundError:
            missing.append(naam)
            continue
        except Exception:
            continue                          # kisi ajeeb metadata par ruk mat jao
        if chinh == "==" and chaha and mila != chaha:
            mismatch.append((naam, chaha, mila))
        elif verbose:
            print(f"     ok  {naam} {mila}")

    if mismatch:
        print("  [WARN] Version requirements se alag hai:")
        for naam, chaha, mila in mismatch:
            print(f"           {naam}: chahiye {chaha}, laga hua {mila}")

    if missing:
        # Ye hissa jaan-boojhkar bhadkeela hai -- startup ka output lamba hota
        # hai aur ek saadi line usme kho jaati hai.
        print("")
        print("  " + "!" * 66)
        print("  !!  PYTHON LIBRARY MISSING - kuch feature CHUP-CHAAP fail karenge")
        print("  " + "!" * 66)
        for naam in missing:
            print(f"  !!    - {naam}")
        print("  !!")
        print("  !!  Theek karne ke liye:")
        if os.name == "nt":
            print("  !!      Phase2\\.venv\\Scripts\\python.exe -m pip install -r Phase2\\requirements.txt")
        else:
            print("  !!      Phase2/.venv/bin/python -m pip install -r Phase2/requirements.txt")
        print("  !!")
        print("  !!  Backend phir bhi chalega, par jo cheez in par tiki hai wo")
        print("  !!  seedha 'kaam nahi kar raha' ban kar dikhegi - error ke bina.")
        print("  " + "!" * 66)
        print("")
        return 1

    print(f"  [OK] Python libraries - sab {len(chahiye)} maujood hain.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
