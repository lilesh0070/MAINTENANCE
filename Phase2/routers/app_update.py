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

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

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
