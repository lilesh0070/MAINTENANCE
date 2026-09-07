# -*- coding: utf-8 -*-
r"""
push_apk.py — abhi jo APK bani hai use GitHub par `apk` branch par chadha do.

KYUN ALAG BRANCH
----------------
APK 6 MB ki hai aur har release par nayi banti hai.  `main` me daal dete to
har version hamesha ke liye history me jud jaata aur repo bhaari hoti jaati.
Isliye ek ALAG branch `apk` hai jisme SIRF do file hoti hain, aur wo har baar
POORI BADAL di jaati hai (force-push).  Purani apne aap chhoot jaati hai.

Git LFS jaan-boojh kar nahi liya: wo purani file KABHI nahi mitata, aur is
raftaar par (ek din me 6 release dekhe hain) GitHub ka 1 GB free quota
lagbhag ek mahine me khatam ho jaata -- aur uske baad nikalne ka raasta bhi
nahi hota.

TOKEN KI ZAROORAT NAHI
----------------------
Ye git ke apne raaste se jaata hai, isliye wahi credentials chalte hain jo
`git push` ke liye pehle se hain.  Koi naya token/PAT nahi banana.

CHALANE KA TAREEQA (Phase2 folder se)
-------------------------------------
    .venv\Scripts\python.exe scripts\push_apk.py            # chadha do
    .venv\Scripts\python.exe scripts\push_apk.py --dry-run  # sirf dikhao

Server (Linux) par utaarne ke liye: `./pull_apk.sh`
"""
import argparse
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PHASE2 = os.path.dirname(HERE)
ROOT = os.path.dirname(PHASE2)
APP_DIR = os.path.join(PHASE2, "app")
APK = os.path.join(APP_DIR, "maintenance.apk")
META = os.path.join(APP_DIR, "version.json")

BRANCH = "apk"


def git(*args, **kw):
    """Git chalao aur output lauta do.  Bytes me, kyunki APK binary hai."""
    r = subprocess.run(["git"] + list(args), cwd=ROOT,
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE, **kw)
    if r.returncode != 0:
        sys.stderr.write("\n  git %s -- fail\n%s\n" % (" ".join(args),
                                                       r.stderr.decode("utf-8", "replace")))
        sys.exit(1)
    return r.stdout.decode("utf-8", "replace").strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true",
                    help="sab kuch banao par push MAT karo")
    a = ap.parse_args()

    # ── file hain ya nahi ──────────────────────────────────────────
    for p in (APK, META):
        if not os.path.isfile(p):
            print("  RUK GAYE -- ye file nahi mili:\n     %s" % p)
            print("  Pehle release bana lein:  python scripts\\release_app.py")
            sys.exit(1)

    with open(META, encoding="utf-8") as f:
        ver = (json.load(f).get("version") or "").strip()
    if not ver:
        print("  RUK GAYE -- version.json me version khali hai.")
        sys.exit(1)

    size = os.path.getsize(APK)
    print("\n  chadhane ja rahe hain:")
    print("     version : %s" % ver)
    print("     APK     : %s (%.1f MB)" % (APK, size / 1048576))
    print("     branch  : %s  (force-push -- purani hat jaayegi)" % BRANCH)

    # ── git object banao ───────────────────────────────────────────
    # `--no-filters` ZAROORI hai: .gitattributes me `* text=auto eol=lf` hai,
    # aur bina iske git file ko "text" samajh kar line-ending badal sakta hai
    # -- APK usi waqt kharab ho jaati.
    #
    # `--path` ke SAATH nahi de sakte (git mana kar deta hai) -- aur zaroorat
    # bhi nahi: `--path` ka kaam hi ye batana hai ki "is naam ke hisaab se
    # filter lagao", jo yahan hum lagne hi nahi de rahe.
    apk_blob = git("hash-object", "-w", "--no-filters", APK)
    meta_blob = git("hash-object", "-w", "--no-filters", META)

    # mktree ko tab se alag ki hui line chahiye
    entries = "100644 blob %s\tmaintenance.apk\n100644 blob %s\tversion.json\n" % (apk_blob, meta_blob)
    r = subprocess.run(["git", "mktree"], cwd=ROOT, input=entries.encode(),
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if r.returncode != 0:
        sys.stderr.write(r.stderr.decode("utf-8", "replace"))
        sys.exit(1)
    tree = r.stdout.decode().strip()

    commit = git("commit-tree", tree, "-m", "APK v%s" % ver)

    # ── jaanch: jo object bana hai usme sach me wahi APK hai? ───────
    r = subprocess.run(["git", "cat-file", "blob", apk_blob], cwd=ROOT,
                       stdout=subprocess.PIPE)
    if len(r.stdout) != size:
        print("  RUK GAYE -- git me gayi APK ka aakar alag hai "
              "(%d vs %d).  Push nahi kiya." % (len(r.stdout), size))
        sys.exit(1)
    print("     jaancha : git ke andar APK %d bytes -- theek" % len(r.stdout))

    if a.dry_run:
        print("\n  --dry-run tha, PUSH NAHI KIYA.")
        print("     commit taiyaar : %s" % commit[:12])
        return

    # ── push ───────────────────────────────────────────────────────
    git("push", "-f", "origin", "%s:refs/heads/%s" % (commit, BRANCH))

    print("\n  HO GAYA -- v%s branch `%s` par chadh gayi." % (ver, BRANCH))
    print("     server (Linux) par utaarne ke liye:  ./pull_apk.sh")


if __name__ == "__main__":
    main()
