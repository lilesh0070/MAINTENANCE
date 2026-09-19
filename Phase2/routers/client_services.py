"""
routers/client_services.py
==========================
Admin tay karta hai ki kaunsi SERVICE kahan chale -- WEBSITE par aur APP
(APK: phone / tablet / TV) par ALAG-ALAG (user 2026-09-19: "admin panel me
naya tab -- har service ka option website aur app ke liye alag; abhi website
ke liye sab band, zaroorat hogi tab chalu kar lenge").

Services (key -> kya band hota hai):
  andon_alert        Nayi maintenance ANDON call par popup + beep (app me
                     vibration bhi).  Website har ~2.5 sec poochti hai; app me
                     background service chal rahi ho to server khud usi socket
                     par bhejta hai (routers/walkie.py) -- app band ho tab bhi
                     ring + notification.
  walkie             Walkie-Talkie ka connection: online dikhna, buzz ka parda,
                     chat ki patti, live aawaz.  Band = socket hi nahi judta.
  walkie_background  (sirf APP) app band hone par bhi sunna -- Android ki
                     background service + "Listening" wali notification.
                     2026-09-19 se ANDON bhi isi se aata hai, isliye walkie
                     band ho par ANDON chalu, tab bhi ye kaam ka hai.

Ek hi row (id=1), JSON me sirf wahi jo admin ne save kiya; baaki DEFAULTS se.
DEFAULTS: website par sab BAND, app par sab CHALU (jaisa pehle chalta tha).

ANDON RING -- ID ke hisaab se (user 2026-09-19: "Services me ek option aur --
kis ID par ANDON popup ki ring bajegi; maint par OFF, baaki sab par ON"):
  `andon_ring_off`  un user-id ki list jin par ring NAHI bajti.  List me na
                    ho = ring bajti hai.  Default ON -- user ne yahi chuna, aur
                    ANDON madad bulane ka system hai, naye user ki ring galti
                    se band na rahe.  Ring band = popup / notification phir bhi
                    aata hai, phone thartharata hai -- bas awaaz nahi.
  Kaun padhta hai: page (`andon_ring` isi GET se -- popup ki beep) aur
  `routers/walkie.py` (har ANDON list ke saath har phone ko uski ring --
  app band ho tab bhi admin ka badlaav turant lagta hai).

Endpoints (prefix /api/client-services)
---------------------------------------
GET  /   Sab services ka haal + `andon_ring` (IS user ki ring bajegi?)
         (koi bhi signed-in user -- har device padhta hai).  Admin ko upar se
         `andon_ring_off` + `users` (Services tab ki list ke liye).
PUT  /   Save  (sirf admin; audit me CLIENT_SERVICES_SAVE).  `andon_ring_off`
         bheja to badlega, na bheja (purana tab) to jaisa tha waisa.
"""
import json
from typing import Optional

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
    # None = mat chhedo -- purana (cache wala) Services tab ye bhejta hi nahi
    andon_ring_off: Optional[list] = None


_DDL_DONE = False


def _ensure(conn):
    # Har device har baar GET karta hai -- DDL process me ek hi baar
    global _DDL_DONE
    if _DDL_DONE:
        return
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS maintenance_client_services (
            id         INT PRIMARY KEY DEFAULT 1,
            services   JSONB       NOT NULL DEFAULT '{}'::jsonb,
            updated_by TEXT,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    # 2026-09-19: ANDON ki ring kis ID par BAND (upar dekho)
    cur.execute("ALTER TABLE maintenance_client_services"
                " ADD COLUMN IF NOT EXISTS andon_ring_off JSONB NOT NULL DEFAULT '[]'::jsonb")
    conn.commit()
    _DDL_DONE = True


def _ids(v) -> list:
    """JSONB list -> saaf, bina dohraav int list (kharab value chhod do)."""
    out = set()
    for x in (v or []):
        if isinstance(x, bool):
            continue
        try:
            out.add(int(x))
        except (TypeError, ValueError):
            pass
    return sorted(out)


def ring_band_ids() -> set:
    """Jin user-id par ANDON ki ring NAHI bajti.  `routers/walkie.py` har ANDON
    list ke saath har phone ko uski ring isi se bhejta hai."""
    with get_conn() as conn:
        _ensure(conn)
        cur = dict_cursor(conn)
        cur.execute("SELECT andon_ring_off FROM maintenance_client_services WHERE id = 1")
        row = cur.fetchone()
    return set(_ids(row["andon_ring_off"] if row else []))


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
    admin = (user or {}).get("role") == "admin"
    users = None
    with get_conn() as conn:
        _ensure(conn)
        cur = dict_cursor(conn)
        cur.execute("SELECT services, andon_ring_off, updated_by, updated_at"
                    " FROM maintenance_client_services WHERE id = 1")
        row = cur.fetchone()
        if admin:
            # Services tab ki "ANDON ring" list -- sab chalu user
            cur.execute("SELECT id, username, full_name, role FROM maintenance_users"
                        " WHERE COALESCE(is_active, TRUE) ORDER BY LOWER(username)")
            users = [dict(r) for r in (cur.fetchall() or [])]
    band = _ids(row["andon_ring_off"] if row else [])
    out = {
        "services": _merge(row["services"] if row else {}),
        "updated_by": row["updated_by"] if row else None,
        "updated_at": row["updated_at"].isoformat() if row and row["updated_at"] else None,
        # IS user ke device par ANDON popup ki ring bajegi?
        "andon_ring": (user or {}).get("id") not in band,
    }
    if admin:
        out["andon_ring_off"] = band
        out["users"] = users
    return out


@router.put("/")
def save_services(body: ServicesIn, admin=Depends(require_admin)):
    raw = body.services or {}
    anjaan = [k for k in raw if k not in DEFAULTS]
    if anjaan:
        raise HTTPException(400, f"Unknown service: {', '.join(anjaan)}")
    for k, v in raw.items():
        if not isinstance(v, dict) or any(not isinstance(v.get(p), bool) for p in ("web", "app") if p in v):
            raise HTTPException(400, f"Service {k}: web / app must be true or false")
    ring_naya = None
    if body.andon_ring_off is not None:
        if any(isinstance(x, bool) or not isinstance(x, int) for x in body.andon_ring_off):
            raise HTTPException(400, "andon_ring_off must be a list of user ids")
        ring_naya = sorted(set(body.andon_ring_off))
    services = _merge(raw)
    who = (admin or {}).get("username") or ""
    with get_conn() as conn:
        _ensure(conn)
        cur = dict_cursor(conn)
        cur.execute("SELECT services, andon_ring_off FROM maintenance_client_services WHERE id = 1")
        row = cur.fetchone()
        pehle = _merge(row["services"] if row else {})
        ring_pehle = _ids(row["andon_ring_off"] if row else [])
        ring = ring_pehle if ring_naya is None else ring_naya
        cur.execute("""
            INSERT INTO maintenance_client_services (id, services, andon_ring_off, updated_by, updated_at)
            VALUES (1, %s::jsonb, %s::jsonb, %s, NOW())
            ON CONFLICT (id) DO UPDATE
               SET services = EXCLUDED.services, andon_ring_off = EXCLUDED.andon_ring_off,
                   updated_by = EXCLUDED.updated_by, updated_at = NOW()
        """, [json.dumps(services), json.dumps(ring), who])
        # kya badla -- audit me (Admin → Delete History → "All" me dikhta hai)
        badla = [f"{k}.{p}: {'on' if services[k][p] else 'off'}"
                 for k in services for p in ("web", "app") if services[k][p] != pehle[k][p]]
        # ring: id nahi, naam likho -- audit padhne wale ko id se kuch samajh nahi aata
        bandi, khuli = set(ring) - set(ring_pehle), set(ring_pehle) - set(ring)
        if bandi or khuli:
            cur.execute("SELECT id, username FROM maintenance_users WHERE id = ANY(%s)",
                        (sorted(bandi | khuli),))
            naam = {r["id"]: r["username"] for r in (cur.fetchall() or [])}
            badla += [f"andon_ring {naam.get(i, f'#{i}')}: off" for i in sorted(bandi)]
            badla += [f"andon_ring {naam.get(i, f'#{i}')}: on" for i in sorted(khuli)]
        if badla:
            try:
                from main import write_audit
                write_audit(conn, action="CLIENT_SERVICES_SAVE", entity_type="maintenance_client_services",
                            entity_id=1, details="; ".join(badla), user=admin)
            except Exception as e:          # audit kabhi save ko na roke
                print(f"[client-services] audit: {e}")
        conn.commit()
    return {"ok": True, "services": services, "andon_ring_off": ring}
