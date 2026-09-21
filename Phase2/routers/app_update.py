# -*- coding: utf-8 -*-
"""
routers/app_update.py — Android app ka apna update check.

KAAM KYA HAI
------------
App ke andar ek button hai ("Update").  Dabate hi app yahan poochhta hai ki
naya version hai ya nahi.  Hai to seedha yahin se APK download ho jaati hai
aur Android use install kar deta hai — kisi ko APK haath se baantni nahi
padti.

TEEN RAASTE
-----------
    GET  /api/app/version   -> {version, notes, released_at, size_mb, apk_url}
    GET  /api/app/download  -> APK ki file khud
    GET  /api/app/health    -> sirf ye batata hai ki intezaam theek se laga hai

(Neeche "APP KI ATAK / CRASH KA LOG" ke raaste bhi isi prefix par hain -- wo
LOGIN ke peeche hain, in teeno jaise khule nahi.)

BINA LOGIN KYUN
---------------
Download **external browser / Android ke download manager** se hota hai, aur
uske paas app ka login token hota hi nahi.  Isliye ye teeno raaste bina token
ke khule hain.  Ismein koi data nahi hai — sirf version ka number aur wahi APK
jo waise bhi sabke phone me hai.  (Baaki poora API pehle jaisa login ke peeche
hi hai.)

FILE KAHAN RAKHNI HAI
---------------------
    Phase2/app/maintenance.apk   <- nayi APK  (purana naam `mes.apk` bhi chalta hai)
    Phase2/app/version.json   <- {"version": "1.0.1", "notes": "..."}

Dono `scripts/release_app.py` apne aap rakh deta hai — haath se copy karne ki
zaroorat nahi.
"""
from __future__ import annotations

import json
import os
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel

from database import get_conn, dict_cursor
from auth import get_current_user, require_admin, _asli_ip

router = APIRouter(prefix="/api/app", tags=["app-update"])

_APP_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "app")
# Naam badalte waqt purani APK bhi pade ho sakti hai (server par purana code
# chal raha ho, ya file pehle se `mes.apk` naam se rakhi ho).  Isliye dono
# naam dekh lete hain — pehla jo mile wahi.  Naya naam pehle.
_APK_NAMES = ("maintenance.apk", "mes.apk")


def _apk_path():
    for n in _APK_NAMES:
        p = os.path.join(_APP_DIR, n)
        if os.path.isfile(p):
            return p
    return os.path.join(_APP_DIR, _APK_NAMES[0])   # naya naam — error saaf aaye
_META = os.path.join(_APP_DIR, "version.json")


def _read_meta() -> dict:
    try:
        with open(_META, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


@router.get("/version")
def app_version(request: Request):
    """Abhi server par kaunsi APK padi hai.  App isi se apna version milata hai."""
    meta = _read_meta()
    apk = _apk_path()
    have_apk = os.path.isfile(apk)
    size_mb = round(os.path.getsize(apk) / 1048576, 1) if have_apk else 0
    built = None
    if have_apk:
        built = datetime.fromtimestamp(os.path.getmtime(apk)).isoformat(timespec="seconds")
    # apk_url usi pate par banao jispar app ne poochha hai — app Ethernet se
    # aaya ho ya WiFi se, download bhi usi raaste se jayega.
    base = str(request.base_url).rstrip("/")
    return {
        "version":     meta.get("version") or "",
        "notes":       meta.get("notes") or "",
        "released_at": meta.get("released_at") or built,
        "apk_ready":   have_apk,
        "size_mb":     size_mb,
        "apk_url":     f"{base}/api/app/download" if have_apk else "",
    }


@router.get("/download")
def app_download():
    """APK khud.  Android ka download manager ise seedha uthata hai."""
    apk = _apk_path()
    if not os.path.isfile(apk):
        raise HTTPException(404, "Abhi koi APK server par rakhi hi nahi hai")
    meta = _read_meta()
    ver = (meta.get("version") or "").replace(" ", "")
    name = f"Maintenance-{ver}.apk" if ver else "Maintenance.apk"
    return FileResponse(apk, media_type="application/vnd.android.package-archive",
                        filename=name)


@router.get("/health")
def app_health():
    """Intezaam theek se laga hai ya nahi — seedha jawab, andaza nahi."""
    return {
        "folder":       _APP_DIR,
        "folder_hai":   os.path.isdir(_APP_DIR),
        "apk_hai":      os.path.isfile(_apk_path()),
        "apk_file":     os.path.basename(_apk_path()),
        "version_hai":  os.path.isfile(_META),
        "version":      _read_meta().get("version") or "",
    }


# ═════════════════════════════════════════════════════════════════════════
# APP KI ATAK / CRASH KA LOG  (2026-09-21)
# ═════════════════════════════════════════════════════════════════════════
# User: "TV me din bhar 'Close app / Wait' aata hai -- log bana de, aaye to
# log bhej de jisse tu dekh sake."
#
# App (`AnrLog.java` + `AppDiag.jsx`) main thread 4 sec se zyada atakte hi
# uska stack (kis line par atka) + memory likh leti hai, aur Android 11+ par
# Android ka apna record bhi (pichhli baar app ANR / crash / kam memory se
# band hui).  Page wo reports yahan bhejta hai; yahan ek table me rakhi jaati
# hain.  Dekhne ke do raaste: admin ke GET (neeche), ya laptop se seedha DB:
#     SELECT id, received_at, device, kind, summary FROM maintenance_app_diag
#     ORDER BY id DESC LIMIT 20;
#
#   POST /api/app/diag        (login)  {reports:[{kind, at_ms, summary, detail, path}],
#                                       app_version, device, path}
#   GET  /api/app/diag        (admin)  aakhri reports (detail ke bina)
#   GET  /api/app/diag/{id}   (admin)  ek report poori
#
# ⚠ Upar ke teen raaste bina login hain -- ye JAAN-BOOJH KAR login ke peeche
# hain: domain ke raaste `/api` internet se bhi pahunch me hai, bina login ke
# koi bhi DB bhar deta.  Hadd bhi: ek request me 10, detail 200 KB, ek user
# ke 24 ghante me 300 (usse upar chup-chaap chhod dete hain -- "ok" hi lautta
# hai, warna app wahi report baar-baar bhejti rehti).  60 din se purani
# report process shuru hote hi mit jaati hai.
_DIAG_MAX_REPORTS = 10
_DIAG_MAX_DETAIL = 200_000
_DIAG_MAX_DAY = 300
_DIAG_KEEP_DAYS = 60
_DIAG_DDL_DONE = False


def _diag_ensure(conn):
    global _DIAG_DDL_DONE
    if _DIAG_DDL_DONE:
        return
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS maintenance_app_diag (
            id           SERIAL PRIMARY KEY,
            received_at  TIMESTAMP NOT NULL DEFAULT NOW(),
            happened_at  TIMESTAMP,
            user_id      INT,
            username     TEXT,
            client_ip    TEXT,
            device       TEXT,
            app_version  TEXT,
            kind         TEXT,
            summary      TEXT,
            detail       TEXT,
            path         TEXT
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS ix_app_diag_received"
                " ON maintenance_app_diag (received_at)")
    cur.execute("DELETE FROM maintenance_app_diag WHERE received_at < NOW() - %s * INTERVAL '1 day'",
                (_DIAG_KEEP_DAYS,))
    conn.commit()
    _DIAG_DDL_DONE = True


class _DiagReport(BaseModel):
    kind: str = "stall"                  # stall | anr | crash | low_memory | ...
    at_ms: Optional[float] = None        # device ka waqt (epoch ms)
    summary: str = ""
    detail: str = ""
    path: str = ""                       # atak ke waqt app kaunse page par thi


class _DiagIn(BaseModel):
    reports: List[_DiagReport] = []
    app_version: str = ""
    device: str = ""                     # tv / tab / phone
    path: str = ""                       # bhejte waqt ka page


def _kaat(s, n):
    s = "" if s is None else str(s)
    return s if len(s) <= n else s[:n] + "\n…[kaata: %d aur]" % (len(s) - n)


def _waqt(ms):
    try:
        if ms and float(ms) > 0:
            return datetime.fromtimestamp(float(ms) / 1000.0)
    except (TypeError, ValueError, OverflowError, OSError):
        pass
    return None


@router.post("/diag")
def app_diag_save(body: _DiagIn, request: Request, user=Depends(get_current_user)):
    """App ki atak / crash ki report -- `AppDiag.jsx` bhejta hai."""
    reps = list(body.reports or [])[:_DIAG_MAX_REPORTS]
    if not reps:
        return {"ok": True, "saved": 0}
    uid = (user or {}).get("id")
    uname = (user or {}).get("username")
    ip = _asli_ip(request)
    with get_conn() as conn:
        _diag_ensure(conn)
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM maintenance_app_diag"
                    " WHERE user_id = %s AND received_at > NOW() - INTERVAL '1 day'", (uid,))
        pehle = cur.fetchone()[0] or 0
        jagah = max(0, _DIAG_MAX_DAY - pehle)
        saved = 0
        for r in reps[:jagah]:
            cur.execute("""
                INSERT INTO maintenance_app_diag
                    (happened_at, user_id, username, client_ip, device, app_version,
                     kind, summary, detail, path)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (_waqt(r.at_ms), uid, uname, ip,
                  _kaat(body.device, 20), _kaat(body.app_version, 30),
                  _kaat(r.kind, 30), _kaat(r.summary, 1000),
                  _kaat(r.detail, _DIAG_MAX_DETAIL), _kaat(r.path or body.path, 300)))
            saved += 1
        conn.commit()
    if saved < len(reps):
        print(f"[APP-DIAG] {uname} ki {len(reps) - saved} report chhodi (24 ghante ki hadd)")
    return {"ok": True, "saved": saved, "dropped": len(reps) - saved}


@router.get("/diag")
def app_diag_list(limit: int = 50, user=Depends(require_admin)):
    """Aakhri reports -- detail ke bina (wo `/diag/{id}` se)."""
    limit = max(1, min(int(limit or 50), 500))
    with get_conn() as conn:
        _diag_ensure(conn)
        cur = dict_cursor(conn)
        cur.execute("""
            SELECT id, received_at, happened_at, username, client_ip, device,
                   app_version, kind, summary, path, LENGTH(detail) AS detail_len
            FROM maintenance_app_diag ORDER BY id DESC LIMIT %s
        """, (limit,))
        return cur.fetchall()


@router.get("/diag/{did}")
def app_diag_one(did: int, user=Depends(require_admin)):
    with get_conn() as conn:
        _diag_ensure(conn)
        cur = dict_cursor(conn)
        cur.execute("SELECT * FROM maintenance_app_diag WHERE id = %s", (did,))
        row = cur.fetchone()
    if not row:
        raise HTTPException(404, "Report nahi mili")
    return row
