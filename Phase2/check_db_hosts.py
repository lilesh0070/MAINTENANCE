# -*- coding: utf-8 -*-
r"""check_db_hosts.py — .env me jo DB raaste likhe hain, wo mil rahe hain ya nahi.

Kuch badalta nahi, sirf padh kar batata hai.  Production par .env chhedne ke
BAAD isi se pakka kar lein ki setting sahi padhi ja rahi hai.

Chalane ka tareeqa (Phase2 folder se):
    .venv\Scripts\python.exe check_db_hosts.py
"""
import os
import socket
import time

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"), override=True)

host = (os.getenv("DB_HOST") or "").strip()
alts = [x.strip() for x in (os.getenv("DB_HOST_ALT") or "").split(",") if x.strip()]
port = int(os.getenv("DB_PORT", "5432") or 5432)
tmo  = os.getenv("DB_CONNECT_TIMEOUT", "(set nahi)")

print()
print("  .env se padha gaya")
print("  ------------------")
print("  DB_HOST (pehle yahi)   :", host or "(khali!)")
print("  DB_HOST_ALT (baad me)  :", ", ".join(alts) if alts else "(khali — koi doosra raasta nahi)")
print("  DB_PORT                :", port)
print("  DB_CONNECT_TIMEOUT     :", tmo, "  (WiFi ke liye 12 rakhna theek hai)")
print()
print("  abhi kaun-kaun mil raha hai")
print("  ---------------------------")
for ip, lbl in [(host, "PRIMARY")] + [(a, "ALT    ") for a in alts]:
    s = socket.socket()
    s.settimeout(3)
    t0 = time.time()
    try:
        s.connect((ip, port))
        print("  %s  %-16s MIL RAHA   %.0f ms" % (lbl, ip, (time.time() - t0) * 1000))
    except OSError:
        print("  %s  %-16s nahi mila" % (lbl, ip))
    finally:
        try: s.close()
        except OSError: pass
print()
if host and alts:
    print("  Matlab: PRIMARY mile to wahi chalega; na mile to upar wale kram me ALT.")
elif host:
    print("  DHYAN: koi ALT nahi hai — PRIMARY band hua to app DB tak nahi pahunchega.")
print()
