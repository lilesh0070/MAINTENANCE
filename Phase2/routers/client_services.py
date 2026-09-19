"""
routers/client_services.py
==========================
Admin tay karta hai ki kaunsi SERVICE kahan chale -- WEBSITE par aur APP
(APK: phone / tablet / TV) par ALAG-ALAG (user 2026-09-19: "admin panel me
naya tab -- har service ka option website aur app ke liye alag; abhi website
ke liye sab band, zaroorat hogi tab chalu kar lenge").

Services (key -> kya band hota hai):
  andon_alert        Nayi maintenance ANDON call par popup + beep (app me
                     vibration bhi) -- har ~2.5 sec ki polling bhi isi ke saath.
  walkie             Walkie-Talkie ka connection: online dikhna, buzz ka parda,
                     chat ki patti, live aawaz.  Band = socket hi nahi judta.
  walkie_background  (sirf APP) app band hone par bhi sunna -- Android ki
                     background service + "Listening" wali notification.

Ek hi row (id=1), JSON me sirf wahi jo admin ne save kiya; baaki DEFAULTS se.
DEFAULTS: website par sab BAND, app par sab CHALU (jaisa pehle chalta tha).

Endpoints (prefix /api/client-services)
---------------------------------------
GET  /   Sab services ka haal   (koi bhi signed-in user -- har device padhta hai)
PUT  /   Save                   (sirf admin; audit me CLIENT_SERVICES_SAVE)
"""
import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from database import get_conn, dict_cursor
from auth import get_current_user, require_admin

router = APIRouter(prefix="/api/client-services", tags=["client-services"])

# kram wahi jo admin ke tab me dikhta hai
DEFAULTS = {
    "andon_alert":       {"web": False, "app": True},
    "walkie":            {"web": False, "app": True},
    "walkie_background": {"web": False, "app": True},
}
# website par jiska matlab hi nahi (sirf app ki cheez) -- hamesha band
APP_ONLY = {"walkie_background"}


class ServicesIn(BaseModel):
    services: dict = {}


def _ensure(conn):
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS maintenance_client_services (
            id         INT PRIMARY KEY DEFAULT 1,
            services   JSONB       NOT NULL DEFAULT '{}'::jsonb,
            updated_by TEXT,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    conn.commit()


def _merge(saved: dict) -> dict:
    """DEFAULTS ke upar saved -- anjaan key / galat value chhod do."""
    out = {}
    for k, d in DEFAULTS.items():
        s = (saved or {}).get(k) or {}
        web = s.get("web", d["web"])
        app = s.get("app", d["app"])
        out[k] = {"web": bool(web) and k not in APP_ONLY, "app": bool(app)}
    return out


@router.get("/")
def get_services(user=Depends(get_current_user)):
    with get_conn() as conn:
        _ensure(conn)
        cur = dict_cursor(conn)
        cur.execute("SELECT services, updated_by, updated_at FROM maintenance_client_services WHERE id = 1")
        row = cur.fetchone()
    return {
        "services": _merge(row["services"] if row else {}),
        "updated_by": row["updated_by"] if row else None,
        "updated_at": row["updated_at"].isoformat() if row and row["updated_at"] else None,
    }


@router.put("/")
def save_services(body: ServicesIn, admin=Depends(require_admin)):
    raw = body.services or {}
    anjaan = [k for k in raw if k not in DEFAULTS]
    if anjaan:
        raise HTTPException(400, f"Unknown service: {', '.join(anjaan)}")
    for k, v in raw.items():
        if not isinstance(v, dict) or any(not isinstance(v.get(p), bool) for p in ("web", "app") if p in v):
            raise HTTPException(400, f"Service {k}: web / app must be true or false")
    services = _merge(raw)
    who = (admin or {}).get("username") or ""
    with get_conn() as conn:
        _ensure(conn)
        cur = dict_cursor(conn)
        cur.execute("SELECT services FROM maintenance_client_services WHERE id = 1")
        row = cur.fetchone()
        pehle = _merge(row["services"] if row else {})
        cur.execute("""
            INSERT INTO maintenance_client_services (id, services, updated_by, updated_at)
            VALUES (1, %s::jsonb, %s, NOW())
            ON CONFLICT (id) DO UPDATE
               SET services = EXCLUDED.services, updated_by = EXCLUDED.updated_by, updated_at = NOW()
        """, [json.dumps(services), who])
        # kya badla -- audit me (Admin → Delete History → "All" me dikhta hai)
        badla = [f"{k}.{p}: {'on' if services[k][p] else 'off'}"
                 for k in services for p in ("web", "app") if services[k][p] != pehle[k][p]]
        if badla:
            try:
                from main import write_audit
                write_audit(conn, action="CLIENT_SERVICES_SAVE", entity_type="maintenance_client_services",
                            entity_id=1, details="; ".join(badla), user=admin)
            except Exception as e:          # audit kabhi save ko na roke
                print(f"[client-services] audit: {e}")
        conn.commit()
    return {"ok": True, "services": services}
