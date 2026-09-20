#!/usr/bin/env python3
# -*- coding: utf-8 -*-
r"""
doctor.pyw — TBDI Maintenance ka "daaktar".

KYA KARTA HAI
-------------
Ek hi file.  Chalate hi bata deta hai ki kahan dikkat hai:

  * Backend zinda hai ya nahi (aur kitni der me jawab deta hai)
  * Database se connection banta hai ya nahi
  * DB ka dhancha (schema) badla to nahi
  * HAR padhne wale API ko chala kar: kaam kar raha? kitni der? kitni row?
      -> TOOTA  : wo page khulega hi nahi
      -> DHEEMA : us page par phone "Close / Wait" dikhayega
  * Backend ke log ki aakhri galtiyan
  * App (APK) aur server ka version milta hai ya nahi
  * ANDON poller ek se jyada machine par to chalu nahi

KAISE CHALAO
------------
  Windows : is file par DOUBLE-CLICK.  (kaala console nahi khulega)
  Ubuntu  : ek baar  chmod +x doctor.pyw   phir right-click -> Run as a Program
            (`sudo apt install -y python3-tk` chahiye -- install.sh jaanchta hai)
  SSH se  : python3 tools/doctor.pyw       -- window na bane to text me chhap jaata hai
  Zabardasti text : python3 tools/doctor.pyw --cli

SAFETY -- ye pakka niyam hai
----------------------------
  * SIRF PADHTA hai.  Sirf GET (padhne wale) API chalte hain; POST / PUT /
    DELETE ko haath tak nahi lagaya jaata.  DB me ek akshar nahi likhta.
  * Koi password nahi maangta -- token `Phase2/.env` se khud ban jaata hai.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PHASE2 = os.path.dirname(HERE)
ROOT = os.path.dirname(PHASE2)


# ── 1. SAHI PYTHON ────────────────────────────────────────────────────
# Double-click system ke Python se chalta hai, jisme psycopg2 / jose nahi
# hote (wo project ke venv me hain).  To pehle khud ko venv wale Python se
# dobara chala lete hain -- isliye SIRF EK file kaafi hai, koi .bat nahi.
def _venv_python():
    if os.name == "nt":
        for n in ("pythonw.exe", "python.exe"):
            p = os.path.join(PHASE2, ".venv", "Scripts", n)
            if os.path.exists(p):
                return p
    else:
        for n in ("python3", "python"):
            p = os.path.join(PHASE2, ".venv", "bin", n)
            if os.path.exists(p):
                return p
    return None


def _bootstrap():
    try:
        import psycopg2  # noqa: F401
        import dotenv    # noqa: F401
        return
    except Exception:
        pass
    vp = _venv_python()
    if not vp or os.path.abspath(vp) == os.path.abspath(sys.executable):
        return          # venv hi nahi -- aage saaf sandesh de denge
    import subprocess
    sys.exit(subprocess.call([vp, os.path.abspath(__file__)] + sys.argv[1:]))


_bootstrap()

import json          # noqa: E402
import re            # noqa: E402
import socket        # noqa: E402
import subprocess    # noqa: E402
import threading     # noqa: E402
import time          # noqa: E402
import urllib.error  # noqa: E402
import urllib.request  # noqa: E402
from datetime import datetime  # noqa: E402

APP_TIMEOUT = 12          # ek API itni der me na bole to "dheema/atka" maana
SLOW_S = 2.0              # itne second se upar = DHEEMA (phone atkega)
BIG_ROWS = 1500           # itni row se upar = bhaari


# ── 2. NATEEJE ka dhancha ─────────────────────────────────────────────
OK, BAD, SLOW, INFO = "ok", "bad", "slow", "info"


class Hal:
    """Jaanch ke nateeje -- ek jagah."""

    def __init__(self):
        self.rows = []          # [{kind, area, title, detail}]
        self.ginti = {OK: 0, BAD: 0, SLOW: 0}
        self.line = ""          # abhi kya chal raha hai (UI ke liye)
        self.hua = 0            # kitne API ho chuke
        self.kul = 0            # kitne karne hain

    def add(self, kind, area, title, detail=""):
        self.rows.append({"kind": kind, "area": area, "title": title, "detail": detail})
        if kind in self.ginti:
            self.ginti[kind] += 1

    def text(self):
        b = ["TBDI Maintenance — JAANCH", datetime.now().strftime("%d-%b-%Y %H:%M"), ""]
        for r in self.rows:
            nishaan = {OK: "OK  ", BAD: "TOOTA", SLOW: "DHEEMA", INFO: "    "}[r["kind"]]
            b.append(f"[{nishaan}] {r['area']}: {r['title']}")
            if r["detail"]:
                for ln in str(r["detail"]).splitlines():
                    b.append(f"          {ln}")
        b += ["", f"Theek: {self.ginti[OK]} · Toota: {self.ginti[BAD]} · Dheeme: {self.ginti[SLOW]}"]
        return "\n".join(b)


# ── 3. CHHOTE AUJAR ───────────────────────────────────────────────────
def http_get(url, token=None, timeout=APP_TIMEOUT):
    """(status, body-text, galti) -- kabhi phekta nahi."""
    req = urllib.request.Request(url)
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode("utf-8", "replace"), None
    except urllib.error.HTTPError as e:
        try:
            body = e.read().decode("utf-8", "replace")
        except Exception:
            body = ""
        return e.code, body, None
    except socket.timeout:
        return 0, "", f"{timeout}s me jawab nahi"
    except Exception as e:
        return 0, "", str(e)


def row_ginti(body):
    """Jawab me kitni row hain -- pata na chale to None."""
    try:
        d = json.loads(body)
    except Exception:
        return None
    if isinstance(d, list):
        return len(d)
    if isinstance(d, dict):
        for k in ("rows", "items", "data", "list", "open", "results"):
            v = d.get(k)
            if isinstance(v, list):
                return len(v)
    return None


def chhota(s, n=110):
    s = " ".join(str(s).split())
    return s if len(s) <= n else s[: n - 1] + "…"


# ── 4. JAANCH ─────────────────────────────────────────────────────────
def load_env():
    from dotenv import load_dotenv
    load_dotenv(os.path.join(PHASE2, ".env"), override=True)


def token_banao(hal):
    """Admin ka token -- DB se naam lekar app ki apni key se.  Koi password nahi."""
    try:
        sys.path.insert(0, PHASE2)
        import psycopg2
        import auth
        c = psycopg2.connect(host=os.getenv("DB_HOST"), port=os.getenv("DB_PORT"),
                             dbname=os.getenv("DB_NAME"), user=os.getenv("DB_USER"),
                             password=os.getenv("DB_PASS"), connect_timeout=6)
        cur = c.cursor()
        cur.execute("SELECT id, username, role FROM maintenance_users "
                    "WHERE role='admin' ORDER BY id LIMIT 1")
        u = cur.fetchone()
        cur.close()
        c.close()
        if not u:
            hal.add(BAD, "Login", "DB me koi admin nahi mila — API ki jaanch nahi ho payegi")
            return None
        return auth.create_token(u[1], u[2], u[0])
    except Exception as e:
        hal.add(BAD, "Login", "Token nahi ban paya — API ki jaanch nahi ho payegi", chhota(e))
        return None


def token_chalta(hal, base, token):
    """Token IS backend par maanya hai ya nahi.

    Har backend apni `.env` ki key se token parkhta hai.  Laptop se banaya
    token PLANT SERVER par nahi chalega (uski key alag hai) -- tab har API
    401 deti hai.  Us haal me 100 bekaar lines dikhane ka koi matlab nahi:
    ek saaf sandesh do aur API ki jaanch chhod do."""
    code, _, err = http_get(base + "/api/auth/me", token, timeout=10)
    if code == 200:
        return True
    if code in (401, 403):
        hal.add(INFO, "API", "is server par API ki jaanch nahi ho sakti",
                "\n".join([
                    "Token is machine ki Phase2/.env se banta hai, aur har backend",
                    "apni hi key se parkhta hai -- doosri machine ka token wo",
                    "nahi maanta.",
                    "Hal: ye doctor USI machine par chalaiye jahan ye backend chalta hai.",
                ]))
        return False
    hal.add(BAD, "API", "jaanch shuru nahi ho payi", err or f"HTTP {code}")
    return False


def jaanch_backend(hal, base):
    hal.line = "Backend…"
    t0 = time.time()
    code, body, err = http_get(base + "/api/health", timeout=8)
    dt = time.time() - t0
    if err or code != 200:
        hal.add(BAD, "Backend", f"{base} se jawab nahi",
                err or f"HTTP {code}\nServer par: ./start.sh   (ya START.bat)")
        return False
    try:
        j = json.loads(body)
        hal.add(OK, "Backend", f"chalu — v{j.get('version','?')} · {j.get('machines','?')} machine",
                f"{base} · {dt:.2f}s")
    except Exception:
        hal.add(OK, "Backend", "chalu", f"{base} · {dt:.2f}s")
    return True


def jaanch_db(hal):
    hal.line = "Database…"
    try:
        import psycopg2
        t0 = time.time()
        c = psycopg2.connect(host=os.getenv("DB_HOST"), port=os.getenv("DB_PORT"),
                             dbname=os.getenv("DB_NAME"), user=os.getenv("DB_USER"),
                             password=os.getenv("DB_PASS"), connect_timeout=8)
        dt = time.time() - t0
        cur = c.cursor()
        cur.execute("SELECT count(*) FROM information_schema.tables "
                    "WHERE table_schema='public'")
        n = cur.fetchone()[0]
        cur.close()
        c.close()
        kind = SLOW if dt > 1.5 else OK
        hal.add(kind, "Database", f"juda — {n} table",
                f"{os.getenv('DB_HOST')} · {dt:.2f}s")
        return True
    except Exception as e:
        hal.add(BAD, "Database", "connection nahi bana", chhota(e, 160))
        return False


def jaanch_schema(hal):
    hal.line = "Schema…"
    g = os.path.join(HERE, "schema_guard.py")
    if not os.path.exists(g):
        return
    try:
        r = subprocess.run([sys.executable, g, "check"], cwd=PHASE2,
                           capture_output=True, text=True, timeout=90)
        out = (r.stdout or "") + (r.stderr or "")
        if "KOI FARAK NAHI" in out:
            hal.add(OK, "Schema", "DB ka dhancha waisa hi hai")
        else:
            kaam = [ln.strip() for ln in out.splitlines()
                    if ln.strip().startswith(("+", "-", "~"))]
            hal.add(BAD, "Schema", "DB ka dhancha BADLA hua hai",
                    "\n".join(kaam[:12]) or chhota(out, 300))
    except Exception as e:
        hal.add(INFO, "Schema", "jaanch nahi ho payi", chhota(e))


# Openapi na mile to inhi par jaanch -- yahi page sabse jyada use hote hain
ZAROORI = [
    "/api/health", "/api/machines/", "/api/breakdowns/log?limit=200",
    "/api/capa-lb/pending", "/api/capa-lb/summary", "/api/capa-lb/sheets",
    "/api/capa-lb/min-config", "/api/breakdowns/qpr-config",
    "/api/andon/dashboard", "/api/client-services/", "/api/pm/check-points",
    "/api/machine-dmc/", "/api/skill-training/", "/api/spares/",
]


def api_list(base, token, hal):
    """Sab padhne wale (GET) raaste -- server ki apni suchi se."""
    code, body, _ = http_get(base + "/openapi.json", token, timeout=20)
    if code == 200:
        try:
            paths = json.loads(body).get("paths", {})
            out = [p for p, ops in paths.items()
                   if "get" in {k.lower() for k in ops} and "{" not in p]
            if out:
                return sorted(out)
        except Exception:
            pass
    hal.add(INFO, "API", "server ki poori suchi nahi mili — zaroori raaston par jaanch")
    return list(ZAROORI)


def jaanch_api(hal, base, token):
    raaste = api_list(base, token, hal)
    hal.kul = len(raaste)
    theek = 0
    mana = 0
    for i, p in enumerate(raaste, 1):
        hal.hua = i
        hal.line = f"API {i}/{len(raaste)} — {p}"
        t0 = time.time()
        code, body, err = http_get(base + p, token)
        dt = time.time() - t0
        n = row_ginti(body)
        kitni = f" · {n:,} row" if n is not None else ""
        if err:
            hal.add(BAD, "API", f"{p} — atak gaya", f"{err} · {dt:.1f}s")
        elif code == 422:
            pass                      # parameter maangta hai -- galti nahi
        elif code in (401, 403):
            mana += 1                 # admin ko bhi mana -- alag se ginti me
        elif code >= 500:
            galti = ""
            try:
                galti = str(json.loads(body).get("detail", ""))[:200]
            except Exception:
                galti = chhota(body, 200)
            hal.add(BAD, "API", f"{p} — TOOTA", f"HTTP {code}  {galti}")
        elif code == 400:
            # Bina sahi input ke bulaya -- galti nahi (jaise walkie ka chat,
            # jo do ALAG log maangta hai).  Warna jhoothi warning aati hai.
            mana += 1
        elif code >= 400:
            hal.add(SLOW, "API", f"{p} — HTTP {code}", chhota(body, 140))
        elif dt >= SLOW_S or (n is not None and n >= BIG_ROWS):
            hal.add(SLOW, "API", f"{p} — dheema / bhaari",
                    f"{dt:.1f}s{kitni}\nIs page par phone 'Close / Wait' dikha sakta hai")
        else:
            theek += 1
    hal.line = ""
    hal.add(OK, "API", f"{theek} raaste theek chal rahe hain")
    if mana:
        hal.add(INFO, "API", f"{mana} raaste par ijazat nahi (ye theek hai)",
                "Jaise ANDON / audit -- inki apni alag ijazat hoti hai")


def page_calls():
    """Bhaari page JAISE SACH ME bulate hain, waise hi bulao.

    Aam sweep har raaste ko bina parameter ke bulati hai -- to
    `/api/breakdowns/log` chand row dekar turant laut aata hai aur "dheema"
    kabhi pakda hi nahi jaata.  Asli dikkat tab hoti hai jab page `limit=3000`
    maangta hai.  Isliye ye chand call alag se, poore parameter ke saath."""
    from datetime import date
    aaj = date.today()
    shuru = aaj.replace(day=1).isoformat()
    ant = aaj.isoformat()
    return [
        ("BD History / Breakdown QPR",
         f"/api/breakdowns/log?limit=3000&date_from={shuru}&date_to={ant}"),
        ("Overview — spare consumption", "/api/spares/consumption?limit=20000"),
        ("CAPA — pending list", "/api/capa-lb/pending"),
        ("CAPA — saved sheets", "/api/capa-lb/sheets"),
        ("Historical — CAPA (Closed)", "/api/capa-lb/closed"),
        ("Machine master", "/api/machines/"),
    ]


def jaanch_bhaari(hal, base, token):
    """Kaunsa page phone ko atkayega -- yahi "Close / Wait" wali jaanch hai."""
    for naam, p in page_calls():
        hal.line = f"Bhaari page — {naam}"
        t0 = time.time()
        code, body, err = http_get(base + p, token, timeout=40)
        dt = time.time() - t0
        n = row_ginti(body)
        kitni = f" · {n:,} row" if n is not None else ""
        if err:
            hal.add(BAD, "Bhaari page", f"{naam} — atak gaya", f"{err}\n{p}")
        elif code >= 500:
            hal.add(BAD, "Bhaari page", f"{naam} — TOOTA", f"HTTP {code}\n{p}")
        elif code >= 400:
            continue
        elif dt >= SLOW_S or (n is not None and n >= BIG_ROWS):
            hal.add(SLOW, "Bhaari page", f"{naam} — dheema / bhaari",
                    f"{dt:.1f}s{kitni}\n{p}\n"
                    "Is page par phone 'Close / Wait' dikha sakta hai — "
                    "chhota filter (ek month) lagaiye")
        else:
            hal.add(OK, "Bhaari page", f"{naam} — theek", f"{dt:.1f}s{kitni}")
    hal.line = ""


def jaanch_log(hal):
    hal.line = "Log…"
    p = os.path.join(ROOT, "logs", "backend.log")
    if not os.path.exists(p):
        hal.add(INFO, "Log", "backend.log yahan nahi hai",
                "Ye sirf SERVER par banti hai (./start.sh) — wahan chalaiye")
        return
    try:
        with open(p, "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()[-800:]
    except Exception as e:
        hal.add(INFO, "Log", "log padh nahi paye", chhota(e))
        return
    galti = [ln.rstrip() for ln in lines
             if re.search(r"Traceback|ERROR|Exception|CRITICAL| 500 ", ln)]
    if galti:
        hal.add(BAD, "Log", f"backend.log me {len(galti)} galti",
                "\n".join(chhota(g, 130) for g in galti[-6:]))
    else:
        hal.add(OK, "Log", "backend.log me koi galti nahi")


def jaanch_version(hal):
    hal.line = "Version…"
    def ver(p):
        try:
            with open(p, "r", encoding="utf-8") as f:
                return json.load(f).get("version")
        except Exception:
            return None
    a = ver(os.path.join(ROOT, "mes-frontend", "app.version.json"))
    b = ver(os.path.join(PHASE2, "app", "version.json"))
    if a and b and a == b:
        hal.add(OK, "Version", f"APK aur server dono par v{a}")
    elif a or b:
        hal.add(SLOW, "Version", "APK aur server ka version alag",
                f"mes-frontend: {a or '—'} · Phase2/app: {b or '—'}\n"
                f"Server par: ./pull_apk.sh")


def jaanch_andon(hal):
    """ANDON ka poller SIRF ek machine par chalu hona chahiye (pakka niyam)."""
    v = (os.getenv("ANDON_POLL_ENABLED") or "").strip()
    if v in ("1", "true", "True"):
        hal.add(INFO, "ANDON", "is machine par poller CHALU hai",
                "Dhyan: poori company me sirf EK machine par 1 hona chahiye")
    else:
        hal.add(OK, "ANDON", "is machine par poller band hai")


def sab_jaanch(hal, base):
    load_env()
    if not jaanch_backend(hal, base):
        jaanch_db(hal)
        jaanch_log(hal)
        return
    db = jaanch_db(hal)
    if db:
        jaanch_schema(hal)
    token = token_banao(hal) if db else None
    if token and token_chalta(hal, base, token):
        jaanch_api(hal, base, token)
        jaanch_bhaari(hal, base, token)
    jaanch_log(hal)
    jaanch_version(hal)
    jaanch_andon(hal)
    hal.line = ""


# ── 5. KAHAN JAANCHNA HAI ─────────────────────────────────────────────
def thikane():
    load_env()
    ip = (os.getenv("DB_HOST") or "").strip()
    out = [("Ye machine", "http://127.0.0.1:8892")]
    if ip and not ip.startswith("127."):
        out.insert(0, (f"Plant server · {ip}", f"http://{ip}:8892"))
    return out


# ── 6. TEXT me (SSH / --cli) ──────────────────────────────────────────
def cli(base):
    hal = Hal()
    print(f"  Jaanch shuru — {base}\n")
    sab_jaanch(hal, base)
    print(hal.text())
    return 1 if hal.ginti[BAD] else 0


# ── 7. WINDOW ─────────────────────────────────────────────────────────
def gui(thik):
    import tkinter as tk
    from tkinter import ttk, filedialog

    BG, CARD, LINE = "#f1f5f9", "#ffffff", "#cbd5e1"
    INK, MUTE = "#0f172a", "#64748b"
    RANG = {OK: ("#e1f5ee", "#0f6e56"), BAD: ("#fcebeb", "#a32d2d"),
            SLOW: ("#faeeda", "#854f0b"), INFO: ("#f1f5f9", "#475569")}

    win = tk.Tk()
    win.title("TBDI Maintenance — Doctor")
    win.geometry("980x680")
    win.configure(bg=BG)

    top = tk.Frame(win, bg=CARD, padx=16, pady=12)
    top.pack(fill="x")
    tk.Label(top, text="Maintenance doctor", bg=CARD, fg=INK,
             font=("Segoe UI", 15, "bold")).pack(side="left")
    tk.Label(top, text="   sirf padhta hai — kuch badalta nahi", bg=CARD,
             fg=MUTE, font=("Segoe UI", 9)).pack(side="left")

    bar = tk.Frame(win, bg=CARD, padx=16, pady=10)
    bar.pack(fill="x")
    tk.Label(bar, text="Kahan jaanchein", bg=CARD, fg=MUTE,
             font=("Segoe UI", 9)).pack(side="left", padx=(0, 8))
    naam = [n for n, _ in thik]
    chuna = ttk.Combobox(bar, values=naam, state="readonly", width=28)
    chuna.current(0)
    chuna.pack(side="left")
    chalao = tk.Button(bar, text="Jaanch karo", bg="#2563eb", fg="white",
                       font=("Segoe UI", 10, "bold"), relief="flat",
                       padx=20, pady=6, cursor="hand2")
    chalao.pack(side="left", padx=10)
    haal = tk.Label(bar, text="", bg=CARD, fg=MUTE, font=("Segoe UI", 9))
    haal.pack(side="left", padx=6)

    tiles = tk.Frame(win, bg=BG, padx=12, pady=10)
    tiles.pack(fill="x")
    box = {}
    for key, label in ((OK, "Theek"), (BAD, "Toota"), (SLOW, "Dheeme"), ("db", "Database")):
        f = tk.Frame(tiles, bg=RANG.get(key, ("#e2e8f0", INK))[0], padx=16, pady=10)
        f.pack(side="left", padx=(0, 10))
        tk.Label(f, text=label, bg=f["bg"], fg=RANG.get(key, ("", MUTE))[1],
                 font=("Segoe UI", 9)).pack(anchor="w")
        v = tk.Label(f, text="—", bg=f["bg"], fg=RANG.get(key, ("", INK))[1],
                     font=("Segoe UI", 20, "bold"))
        v.pack(anchor="w")
        box[key] = v

    wrap = tk.Frame(win, bg=BG, padx=12)
    wrap.pack(fill="both", expand=True)
    sb = tk.Scrollbar(wrap)
    sb.pack(side="right", fill="y")
    out = tk.Text(wrap, wrap="word", bg=CARD, fg=INK, relief="flat",
                  font=("Consolas", 10), yscrollcommand=sb.set,
                  padx=12, pady=10, highlightthickness=1,
                  highlightbackground=LINE, highlightcolor=LINE)
    out.pack(fill="both", expand=True)
    sb.config(command=out.yview)
    for k, (bgc, fgc) in RANG.items():
        out.tag_config(k, background=bgc, foreground=fgc, spacing1=3, spacing3=3)
    out.tag_config("d", foreground=MUTE, font=("Consolas", 9))

    neeche = tk.Frame(win, bg=CARD, padx=16, pady=8)
    neeche.pack(fill="x")

    def likho(hal):
        out.config(state="normal")
        out.delete("1.0", "end")
        for r in hal.rows:
            nishaan = {OK: "  OK    ", BAD: "  TOOTA ", SLOW: "  DHEEMA", INFO: "        "}[r["kind"]]
            out.insert("end", f"{nishaan}  {r['area']} — {r['title']}\n", r["kind"])
            if r["detail"]:
                for ln in str(r["detail"]).splitlines():
                    out.insert("end", f"              {ln}\n", "d")
        out.config(state="disabled")
        out.see("1.0")

    box_state = {"hal": None, "chal": False}

    def tick():
        hal = box_state["hal"]
        if hal is None:
            return
        haal.config(text=hal.line or "")
        box[OK].config(text=str(hal.ginti[OK]))
        box[BAD].config(text=str(hal.ginti[BAD]))
        box[SLOW].config(text=str(hal.ginti[SLOW]))
        db = [r for r in hal.rows if r["area"] == "Database"]
        box["db"].config(text=("OK" if db and db[0]["kind"] != BAD else ("X" if db else "—")))
        likho(hal)
        if box_state["chal"]:
            win.after(400, tick)
        else:
            chalao.config(state="normal", text="Jaanch karo")
            haal.config(text=f"ho gaya — {datetime.now().strftime('%H:%M')}")

    def shuru():
        base = thik[naam.index(chuna.get())][1]
        hal = Hal()
        box_state["hal"] = hal
        box_state["chal"] = True
        chalao.config(state="disabled", text="Chal raha hai…")

        def kaam():
            try:
                sab_jaanch(hal, base)
            except Exception as e:
                hal.add(BAD, "Doctor", "jaanch beech me ruk gayi", chhota(e, 300))
            box_state["chal"] = False

        threading.Thread(target=kaam, daemon=True).start()
        tick()

    chalao.config(command=shuru)

    def nakal():
        h = box_state["hal"]
        if not h:
            return
        win.clipboard_clear()
        win.clipboard_append(h.text())
        haal.config(text="report copy ho gayi")

    def sambhalo():
        h = box_state["hal"]
        if not h:
            return
        p = filedialog.asksaveasfilename(defaultextension=".txt",
                                         initialfile="maintenance-doctor.txt")
        if p:
            with open(p, "w", encoding="utf-8") as f:
                f.write(h.text())
            haal.config(text="file save ho gayi")

    for t, fn in (("Report copy karo", nakal), ("File me save karo", sambhalo)):
        tk.Button(neeche, text=t, relief="flat", bg="#e2e8f0", fg=INK,
                  font=("Segoe UI", 9), padx=14, pady=5, cursor="hand2",
                  command=fn).pack(side="left", padx=(0, 8))
    tk.Label(neeche, text="POST / PUT / DELETE kabhi nahi chalte", bg=CARD,
             fg=MUTE, font=("Segoe UI", 9)).pack(side="right")

    win.after(300, shuru)          # khulte hi ek baar jaanch
    win.mainloop()
    return 0


# ── 8. SHURUAAT ───────────────────────────────────────────────────────
def main():
    thik = thikane()
    base = thik[0][1]
    for a in sys.argv[1:]:
        if a.startswith("http"):
            base = a.rstrip("/")
    if "--cli" in sys.argv:
        return cli(base)
    # window ban sakti hai?  Linux par bina desktop ke nahi banti.
    try:
        import tkinter  # noqa: F401
        if os.name != "nt" and not (os.environ.get("DISPLAY")
                                    or os.environ.get("WAYLAND_DISPLAY")):
            raise RuntimeError("koi desktop nahi")
        return gui(thik)
    except Exception as e:
        print(f"  (window nahi ban payi: {e})")
        print("  Ubuntu par: sudo apt install -y python3-tk\n")
        return cli(base)


if __name__ == "__main__":
    sys.exit(main())
