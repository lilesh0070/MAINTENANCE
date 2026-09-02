# -*- coding: utf-8 -*-
r"""
release_app.py — nayi APK banao aur server par rakh do, ek hi command me.

KYA KARTA HAI (isi kram me)
---------------------------
1. `mes-frontend/app.version.json` se version padhta hai aur usme +1 karta hai
2. `npm run build`            -> website ka naya bundle
3. `npx cap sync android`     -> bundle ko Android project me copy
4. `gradlew assembleDebug`    -> APK
5. APK ko `Phase2/app/maintenance.apk` par rakh deta hai
6. `Phase2/app/version.json` likh deta hai

Uske baad har phone ke app me "Update" dabate hi naya version dikhega aur
wahin se download ho jayega.

CHALANE KA TAREEQA (Phase2 folder se)
-------------------------------------
    .venv\Scripts\python.exe scripts\release_app.py                 # version khud +1
    .venv\Scripts\python.exe scripts\release_app.py --version 1.2.0 # apna version
    .venv\Scripts\python.exe scripts\release_app.py --notes "ANDON screen theek ki"

DHYAN: build karne wali machine par Java 21 aur Android SDK hona chahiye.
Server par sirf `Phase2/app/` ki do file chahiye — build wahan nahi hota.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
PHASE2 = os.path.dirname(HERE)
ROOT = os.path.dirname(PHASE2)
FRONT = os.path.join(ROOT, "mes-frontend")
APP_DIR = os.path.join(PHASE2, "app")
VER_FILE = os.path.join(FRONT, "app.version.json")
APK_SRC = os.path.join(FRONT, "android", "app", "build", "outputs", "apk", "debug", "app-debug.apk")


def run(cmd, cwd, label):
    print("\n  >>> %s" % label)
    r = subprocess.run(cmd, cwd=cwd, shell=True)
    if r.returncode != 0:
        print("\n  RUK GAYE — '%s' fail hua (code %s).  Upar ki galti dekhein." % (label, r.returncode))
        sys.exit(1)


def bump(v):
    """1.0.3 -> 1.0.4.  Ganda version ho to 1.0.1 se shuru."""
    try:
        a, b, c = (int(x) for x in str(v).split("."))
        return "%d.%d.%d" % (a, b, c + 1)
    except Exception:
        return "1.0.1"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--version", help="apna version dena ho to (warna khud +1)")
    ap.add_argument("--notes", default="", help="is version me kya badla (app me dikhega)")
    ap.add_argument("--skip-build", action="store_true", help="APK pehle se bani ho to sirf server par rakho")
    args = ap.parse_args()

    old = ""
    if os.path.isfile(VER_FILE):
        try:
            old = json.load(open(VER_FILE, encoding="utf-8")).get("version", "")
        except Exception:
            old = ""
    new = args.version or bump(old or "1.0.0")
    print("  version: %s  ->  %s" % (old or "(pehli baar)", new))

    # app ko apna version pata ho, isliye build se PEHLE likhte hain
    with open(VER_FILE, "w", encoding="utf-8") as f:
        json.dump({"version": new, "notes": args.notes,
                   "released_at": datetime.now().isoformat(timespec="seconds")},
                  f, indent=2, ensure_ascii=False)

    if not args.skip_build:
        run("npm run build", FRONT, "website ka bundle banana")
        run("npx cap sync android", FRONT, "bundle ko Android project me copy")
        # Windows par current folder PATH me nahi hota, isliye poora path do —
        # warna "'gradlew.bat' is not recognized" milta hai.
        andr = os.path.join(FRONT, "android")
        gradle = os.path.join(andr, "gradlew.bat" if os.name == "nt" else "gradlew")
        run('"%s" assembleDebug -q --console=plain' % gradle, andr, "APK banana")

    if not os.path.isfile(APK_SRC):
        print("\n  APK mili hi nahi: %s" % APK_SRC)
        sys.exit(1)

    os.makedirs(APP_DIR, exist_ok=True)
    shutil.copy2(APK_SRC, os.path.join(APP_DIR, "maintenance.apk"))
    with open(os.path.join(APP_DIR, "version.json"), "w", encoding="utf-8") as f:
        json.dump({"version": new, "notes": args.notes,
                   "released_at": datetime.now().isoformat(timespec="seconds")},
                  f, indent=2, ensure_ascii=False)

    mb = os.path.getsize(os.path.join(APP_DIR, "maintenance.apk")) / 1048576
    print("\n  HO GAYA")
    print("     version : %s" % new)
    print("     APK     : %s  (%.1f MB)" % (os.path.join(APP_DIR, "maintenance.apk"), mb))
    print("     ab har phone ke app me 'Update' dabate hi ye naya version dikhega.")
    print("\n  DHYAN: backend restart ki zaroorat NAHI — file seedha padhi jaati hai.")


if __name__ == "__main__":
    main()
