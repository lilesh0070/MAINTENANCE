"""
routers/walkie.py
=================
**Walkie-Talkie** — plant ke andar aapas me baat karne ka push-to-talk system.
Poora aapke APNE server par: koi Firebase/FCM nahi, koi internet nahi.

KYUN AISE BANA HAI (faisle, taaki baad me koi "aise kyun" na poochhe)
---------------------------------------------------------------------
1. **WebSocket, REST nahi.**  Aawaz ko dono taraf beh-te rehna hai; har frame
   par ek naya HTTP request bhejna na sirf dheema hai, usme "kaun abhi bol
   raha hai" jaisa haal rakhne ki jagah bhi nahi hoti.

2. **Raw PCM16 @ 16 kHz mono, koi codec/container nahi.**  Opus/WebM chhota
   hota, par uske tukde AKELE nahi bajte -- pehle tukde me container ka
   header hota hai, isliye beech me jud-ne wala kuch sun hi nahi pata, aur
   ek tukda gir jaye to aage ka sab bekaar.  PCM me har frame apne aap me
   poora hai: Wi-Fi ki ek hichki se sirf 20ms ki aawaz jaati hai, dhaara
   nahi tootti.  Android me `AudioTrack` ise seedha baja deta hai -- beech
   me koi decoder hi nahi.  LAN par 256 kbps kuch bhi nahi hai.

3. **Server sirf DAAKIYA hai.**  Aawaz DB me nahi jaati, disk par nahi
   girti -- ek connection se aayi, doosre par chali gayi.  (Log me sirf
   itna jaata hai ki kisne kisko kab bulaya -- aawaz nahi.)

4. **Sunne wala Android me JAVA ki foreground service hai, WebView nahi.**
   WebView background me jaate hi ROK diya jaata hai (yahi cheez isi app me
   naapi ja chuki hai -- background me PDF banana beech me ruk jaata tha).
   Yaani jeb me pade phone par WebView kabhi call nahi sun sakta.  Isliye
   socket Java pakadta hai.  BOLNE wala WebView hi hai -- button dabate
   waqt app khuli hoti hi hai.

5. **Ek waqt me ek hi bolega (floor control).**  Do log ek saath bole to
   dono ki aawaz mil kar kuch samajh me nahi aati.  Pehle dabane wale ko
   "floor" mil jaata hai, doosre ko saaf "busy" dikh jaata hai.

Tables (sab `walkie_` se shuru):
  walkie_members          user_id · enabled · added_by · added_at
  walkie_channels         id · name · color · created_at
  walkie_channel_members  channel_id · user_id
  walkie_events           id · at · kind(voice|buzz) · from_user · target · secs
  walkie_messages         id · at · from_user · target(user|channel) · convo · body
  walkie_reads            user_id · convo · last_id   (kitna padh liya)

Endpoints:
  GET    /api/walkie/roster                 kaun-kaun hai + kaun online
  GET    /api/walkie/members                (admin) saare user + enabled flag
  PUT    /api/walkie/members/{user_id}      (admin) kisi ko jodo/hatao
  GET    /api/walkie/channels               channel list (+ members)
  POST   /api/walkie/channels               (admin) naya channel
  DELETE /api/walkie/channels/{id}          (admin)
  PUT    /api/walkie/channels/{id}/members  (admin) channel ke log set karo
  GET    /api/walkie/events                 haal ki call ka log
  GET    /api/walkie/chat?with=<uid>|channel=<id>   ek baat-cheet
  POST   /api/walkie/chat                           message bhejo (REST bhi)
  GET    /api/walkie/chat/threads                   meri saari baat-cheet
  POST   /api/walkie/chat/read                      "yahan tak padh liya"
  GET    /api/walkie/chat/admin?a=&b=|channel=      (admin) kisi ki bhi
  POST   /api/walkie/chat/clear                     (admin) range se saaf
  POST   /api/walkie/chat/delete                    (admin) chune hue / poori chat
  GET    /api/walkie/buzz/pairs                     (admin) kaun kisko buzz kar sakta hai
  PUT    /api/walkie/buzz/pairs/{user_id}           (admin) ek bande ki list set karo
  WS     /api/walkie/ws?token=..&role=rx|tx&kind=web|native[&andon=1][&walkie=0]
         andon=1  -> nayi MAINTENANCE ANDON call bhi isi socket par ("t":"andon")
         walkie=0 -> sirf ANDON, walkie ka kuch nahi.  Walkie ka member na ho
                     tab bhi andon=1 wala socket isi tarah (sirf ANDON) judta hai.
"""
from __future__ import annotations

import asyncio
import json
import os
import time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from jose import JWTError, jwt
from pydantic import BaseModel

from database import get_conn, dict_cursor
from auth import (ALGORITHM, SECRET_KEY, get_current_user, get_user_from_db,
                  require_admin)

router = APIRouter(prefix="/api/walkie", tags=["walkie"])

# Ek banda kitni der lagatar bol sakta hai.  Ye "bakbak rokne" ke liye nahi
# hai -- ye us soorat ke liye hai jab button daba hi reh jaye (phone jeb me
# chala gaya, app mar gayi) aur channel hamesha ke liye jam ho jaye.
MAX_TALK_SECONDS = 60


def _env_s(naam: str, default: float, kam_se_kam: float) -> float:
    """.env se seconds -- galat likha ho to default, bahut chhota ho to hadd.
    (Yahan ki galti se poora router import hi na ho, wo nahi hona chahiye.)"""
    try:
        v = float(os.getenv(naam, "") or default)
    except ValueError:
        v = default
    return max(v, kam_se_kam)


# ── Phone ki background service (kind=native) ka "zinda hoon" ping ──
# uvicorn har socket ko har 20 sec ping karta hai.  Jeb me pade phone ke liye
# iska matlab: sirf "zinda hoon" batane ke liye ghante me ~180 baar jaagna.
# (User 2026-09-19: "ping kam karo".)  Isliye SIRF native socket ka ping
# lamba karte hain -- browser / page wale 20 sec par hi rehte hain, taaki
# unka "online" pehle jaisa jaldi sahi ho.  2 min isliye ki kai Wi-Fi
# controller ~5 min chup rehne wale phone ko nikaal dete hain.  Plant ka
# Wi-Fi lamba jhelta ho to `.env` me WALKIE_NATIVE_PING_S badha do (backend
# restart, APK nahi).
NATIVE_PING_S = _env_s("WALKIE_NATIVE_PING_S", 120, 10)
NATIVE_PING_TIMEOUT_S = _env_s("WALKIE_NATIVE_PING_TIMEOUT_S", 20, 5)

# Nayi ANDON call DB me kitni der me dekhi jaaye.  Pehle HAR khuli app khud
# har 2.5 sec poochti thi (aur band app ko kuch pata hi nahi chalta tha); ab
# server EK query se sab sunne walon ko bata deta hai.
ANDON_CHAKKAR_S = 2.0

# ══════════════════════════════════════════════════════════════════
#  DDL — baaki routers jaisa hi lazy + idempotent
# ══════════════════════════════════════════════════════════════════
_DDL_DONE = False


def _ensure_tables():
    global _DDL_DONE
    if _DDL_DONE:
        return
    with get_conn() as conn:
        cur = conn.cursor()
        # Buzz ki jodi PEHLI BAAR ban rahi hai kya?  (Neeche CREATE se PEHLE
        # poochhna zaroori hai -- baad me to wo hamesha maujood milegi.)
        cur.execute("SELECT to_regclass('public.walkie_buzz_pairs') IS NULL")
        buzz_nayi = bool(cur.fetchone()[0])
        cur.execute("""
            CREATE TABLE IF NOT EXISTS walkie_members (
                user_id   INTEGER PRIMARY KEY,
                enabled   BOOLEAN NOT NULL DEFAULT TRUE,
                added_by  TEXT,
                added_at  TIMESTAMP NOT NULL DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS walkie_channels (
                id         SERIAL PRIMARY KEY,
                name       TEXT NOT NULL UNIQUE,
                color      TEXT,
                created_at TIMESTAMP NOT NULL DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS walkie_channel_members (
                channel_id INTEGER NOT NULL,
                user_id    INTEGER NOT NULL,
                PRIMARY KEY (channel_id, user_id)
            );
            CREATE TABLE IF NOT EXISTS walkie_events (
                id          SERIAL PRIMARY KEY,
                at          TIMESTAMP NOT NULL DEFAULT NOW(),
                kind        TEXT NOT NULL,
                from_user   INTEGER,
                from_name   TEXT,
                target_type TEXT,
                target_id   INTEGER,
                target_name TEXT,
                secs        NUMERIC(6,1)
            );
            CREATE INDEX IF NOT EXISTS walkie_events_at_idx ON walkie_events (at DESC);
            -- Kisne jawab diya aur kab.  Ek buzz ka jawab EK hi banda deta hai
            -- (jisne pehle OK dabaya) -- isliye alag table ki zaroorat nahi.
            ALTER TABLE walkie_events ADD COLUMN IF NOT EXISTS acked_at   TIMESTAMP;
            ALTER TABLE walkie_events ADD COLUMN IF NOT EXISTS acked_by   INTEGER;
            ALTER TABLE walkie_events ADD COLUMN IF NOT EXISTS acked_name TEXT;

            -- ── CHAT ───────────────────────────────────────────────
            -- Aawaz DB me nahi jaati, par chat ko TIKNA hai -- warna na
            -- baad me padh sakte hain, na admin dekh sakta.
            --
            -- `convo` ek hi khaana hai jo dono kism ki baat-cheet ka pata
            -- deta hai: do bande -> "u:3:7" (hamesha chhota:bada, isliye
            -- dono taraf se EK hi key banti hai), group -> "c:2".  Isi par
            -- index hai, isliye thread kholna aur admin ka "A ke saath B"
            -- dono ek hi seedhi query hain -- koi OR-scan nahi.
            CREATE TABLE IF NOT EXISTS walkie_messages (
                id          SERIAL PRIMARY KEY,
                at          TIMESTAMP NOT NULL DEFAULT NOW(),
                from_user   INTEGER NOT NULL,
                from_name   TEXT,
                target_type TEXT NOT NULL,
                target_id   INTEGER NOT NULL,
                convo       TEXT NOT NULL,
                body        TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS walkie_msgs_convo_idx
                ON walkie_messages (convo, id DESC);
            CREATE INDEX IF NOT EXISTS walkie_msgs_at_idx
                ON walkie_messages (at DESC);

            -- "Kis baat-cheet me maine kahan tak padh liya."  Har message par
            -- har bande ki qatar rakhne se (group me wo N guna ho jaati) --
            -- yahan har baat-cheet par EK qatar hai, bas.
            -- KAUN KISKE SAATH chat kar sakta hai.  Admin Setup me tay
            -- karta hai.  Qatar hamesha (chhota, bada) me rakhte hain, isliye
            -- rishta apne aap dono taraf ka hota hai -- ek hi jodi do baar
            -- nahi ban sakti aur "A ne B ko allow kiya par B ne A ko nahi"
            -- jaisi haalat mumkin hi nahi.
            CREATE TABLE IF NOT EXISTS walkie_chat_pairs (
                a_user   INTEGER NOT NULL,
                b_user   INTEGER NOT NULL,
                added_by TEXT,
                added_at TIMESTAMP NOT NULL DEFAULT NOW(),
                PRIMARY KEY (a_user, b_user)
            );
            -- KAUN KISKO BUZZ kar sakta hai.  Bilkul chat ki jodi jaisa --
            -- qatar hamesha (chhota, bada) me, isliye rishta dono taraf ka.
            CREATE TABLE IF NOT EXISTS walkie_buzz_pairs (
                a_user   INTEGER NOT NULL,
                b_user   INTEGER NOT NULL,
                added_by TEXT,
                added_at TIMESTAMP NOT NULL DEFAULT NOW(),
                PRIMARY KEY (a_user, b_user)
            );
            CREATE TABLE IF NOT EXISTS walkie_reads (
                user_id INTEGER NOT NULL,
                convo   TEXT NOT NULL,
                last_id INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (user_id, convo)
            );
        """)
        # ⚠ PEHLI BAAR: aaj buzz sab kar sakte hain.  Jodi ka niyam lagate hi
        # wo sab band ho jaata aur update ke din shift ke beech kisi ka buzz na
        # chalta -- buzz wahi cheez hai jisse maintenance ko bulaya jaata hai.
        # Isliye shuruaat me abhi jude hue logon ki saari jodiyan bhar dete
        # hain: bartaav bilkul pehle jaisa.  Admin Setup me jaakar ghata sakta
        # hai.  Ye sirf table banne ke waqt hota hai -- baad me kabhi nahi,
        # warna admin ka hataya hua wapas aa jaata.
        if buzz_nayi:
            cur.execute("""
                INSERT INTO walkie_buzz_pairs (a_user, b_user, added_by)
                SELECT a.user_id, b.user_id, 'auto: pehle jaisa'
                  FROM walkie_members a
                  JOIN walkie_members b ON a.user_id < b.user_id
                 WHERE a.enabled AND b.enabled
                ON CONFLICT DO NOTHING
            """)
            print(f"[WALKIE] buzz ki jodi pehli baar bhari: {cur.rowcount} jodi")
        conn.commit()
    _DDL_DONE = True


def _log_event(kind, frm, frm_name, t_type, t_id, t_name, secs=None):
    """Aawaz NAHI, sirf "kisne kisko kab bulaya".  Nayi qatar ka `id` lauta
    deta hai -- buzz ke saath wahi id sunne walon ko jaati hai, taaki unke
    "OK" dabate hi hum us qatar par jawab ka waqt likh sakein.
    Fail ho to `None` -- call ka kaam ek log ki wajah se nahi rukna chahiye."""
    try:
        with get_conn() as conn:
            cur = conn.cursor()
            cur.execute(
                "INSERT INTO walkie_events (kind, from_user, from_name, target_type,"
                " target_id, target_name, secs) VALUES (%s,%s,%s,%s,%s,%s,%s)"
                " RETURNING id",
                (kind, frm, frm_name, t_type, t_id, t_name, secs))
            eid = cur.fetchone()[0]
            conn.commit()
            return eid
    except Exception:
        return None


# ══════════════════════════════════════════════════════════════════
#  Chhoti madad
# ══════════════════════════════════════════════════════════════════
def _members_rows():
    """walkie_members + user ka naam, ek hi jagah se."""
    _ensure_tables()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("""
            SELECT u.id, u.username, u.full_name, u.role,
                   COALESCE(w.enabled, FALSE) AS enabled
              FROM maintenance_users u
              LEFT JOIN walkie_members w ON w.user_id = u.id
             WHERE COALESCE(u.is_active, TRUE)
             ORDER BY COALESCE(NULLIF(u.full_name, ''), u.username)
        """)
        return cur.fetchall() or []


def _enabled_ids() -> set:
    return {r["id"] for r in _members_rows() if r["enabled"]}


def _channels_rows():
    _ensure_tables()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT id, name, color FROM walkie_channels ORDER BY name")
        chans = cur.fetchall() or []
        cur.execute("SELECT channel_id, user_id FROM walkie_channel_members")
        mem = cur.fetchall() or []
    by = {}
    for m in mem:
        by.setdefault(m["channel_id"], []).append(m["user_id"])
    for c in chans:
        c["members"] = sorted(by.get(c["id"], []))
    return chans


def _naam(u: dict) -> str:
    return (u.get("full_name") or "").strip() or u.get("username") or f"#{u.get('id')}"


# Walkie ke sab sub-key isi page se latakte hain.
_PARENT = "walkie-talkie"

# Ye CHAAR "kaam" hain (page nahi).  Inka niyam baaki sub-page se ALAG hai --
# neeche `_can` me wajah likhi hai.
#
# ⚠ `walkie-chat` yahan jodne ka ek aur asar hai: jis user ke liye in me se
# koi bhi khaana pehle se saaf-saaf set hai (jaise sirf Buzz di thi), use chat
# TAB TAK NAHI milegi jab tak admin use bhi tick na kare.  Ye jaan-boojh kar
# hai -- niyam wahi hai jo user ne chuna tha: "jo tick kiya, wahi milega".
_CAPS = ("walkie-buzz", "walkie-voice", "walkie-channel", "walkie-chat")


def _can(user: dict, key: str) -> bool:
    """Kya is user ko `key` ki ijazat hai?

    ⚠ BUZZ / VOICE / GROUP KA NIYAM BAAKI SE ALAG HAI -- aur ye jaan-boojh
    kar hai.  App ka aam niyam ye hai ki sub-page khali chhodne par parent se
    ijazat mil jaati hai.  Us niyam par ye teeno TOOT GAYE THE: admin ne kisi
    ko sirf "Buzz" di, par "Voice" kahin set hi nahi tha, to wo upar wali
    `walkie-talkie` se apne aap mil gaya -- aur bande ko bolne ka button bhi
    dikhne laga.  (User ne device par yahi pakda.)

    Isliye yahan niyam ye hai:
      admin                        -> hamesha haan
      in teeno me se KUCH BHI set  -> sirf wahi milega jo saaf-saaf diya hai
      teeno me se kuch bhi set nahi -> parent se mil jaata hai (purane user
                                       ka bartaav na toote)

    Yaani "jo tick kiya, wahi milega" -- wahi jo admin se ummeed ki jaati hai.

    ⚠ JAANCH SERVER PAR HONI HI CHAHIYE.  Sirf button chhupa dena permission
    nahi hoti -- socket seedha bhi khola ja sakta hai.
    """
    if (user.get("role") or "") == "admin":
        return True
    try:
        with get_conn() as conn:
            cur = dict_cursor(conn)
            cur.execute(
                "SELECT page_key, perm_level FROM maintenance_user_permissions"
                " WHERE user_id = %s AND page_key = ANY(%s)",
                (user["id"], list(_CAPS) + [_PARENT, key]))
            got = {r["page_key"]: r["perm_level"] for r in (cur.fetchall() or [])}
    except Exception:
        return False

    lvl = got.get(key)
    if key in _CAPS:
        koi_set = any(got.get(k) in ("read", "full", "none") for k in _CAPS)
        if koi_set:
            return lvl in ("read", "full")
    else:
        # baaki sub-key (setup/history) -- app ka aam niyam
        if lvl in ("read", "full"):
            return True
        if lvl == "none":
            return False
    return got.get(_PARENT) in ("read", "full")


# ══════════════════════════════════════════════════════════════════
#  REST
# ══════════════════════════════════════════════════════════════════

# ══════════════════════════════════════════════════════════════════
#  Chat -- chhoti madad
# ══════════════════════════════════════════════════════════════════
MAX_CHAT_LEN = 1000


def _convo_key(uid: int, target: dict) -> str:
    """Ek baat-cheet ka pata.  Do bande -> "u:chhota:bada" (isliye A->B aur
    B->A dono EK hi key banate hain), group -> "c:id"."""
    t = (target or {}).get("type")
    tid = int((target or {}).get("id") or 0)
    if t == "channel":
        return f"c:{tid}"
    a, b = sorted((int(uid), tid))
    return f"u:{a}:{b}"


def _allowed_ids(user: dict) -> set:
    """Ye banda kis-kis se CHAT kar sakta hai.  (Buzz ki apni alag jodi hai.)"""
    return _jodi_ids(user, "walkie_chat_pairs")


def _jodi_ids(user: dict, table: str) -> set:
    """`table` ki jodi ke hisaab se ye banda kis-kis tak pahunch sakta hai.

    Do jagah ek hi soch chahiye thi -- chat ki jodi aur buzz ki jodi -- isliye
    ek hi function, table ka naam badal kar.

    ADMIN ko dono taraf chhoot hai, aur ye zaroori hai (suvidha nahi): warna
    admin kisi ko bula to leta par wo bechara jawab hi na de pata, kyunki uski
    list me admin hota hi nahi."""
    me = int(user["id"])
    chalu = _enabled_ids()
    if (user.get("role") or "") == "admin":
        return set(chalu) - {me}
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute(f"SELECT a_user, b_user FROM {table}"
                    " WHERE a_user = %s OR b_user = %s", (me, me))
        out = {(r["a_user"] if r["b_user"] == me else r["b_user"])
               for r in (cur.fetchall() or [])}
        cur.execute("SELECT id FROM maintenance_users WHERE role = 'admin'")
        out |= {r["id"] for r in (cur.fetchall() or [])}
    return (out & set(chalu)) - {me}


def _buzz_ok(user: dict, target: dict):
    """Ye banda is target ko buzz kar sakta hai ya nahi.  (None = haan.)"""
    t = (target or {}).get("type")
    tid = int((target or {}).get("id") or 0)
    if t == "channel":
        # Group par buzz ka niyam wahi purana hai -- channel ki membership.
        # Jodi sirf ek-se-ek par lagti hai.
        return None
    if t != "user" or tid <= 0:
        return "Bad target"
    if tid not in _jodi_ids(user, "walkie_buzz_pairs"):
        return "You are not allowed to buzz that person"
    return None


def _chat_ok(user: dict, target: dict):
    """Ye banda is target ko chat kar sakta hai ya nahi.  (None = haan.)

    ⚠ Sirf button chhupana kaafi nahi -- socket aur REST dono seedha bulaye
    ja sakte hain, isliye jaanch YAHI hoti hai."""
    t = (target or {}).get("type")
    tid = int((target or {}).get("id") or 0)
    if not _can(user, "walkie-chat"):
        return "You are not allowed to send messages"
    if t == "channel":
        if not _can(user, "walkie-channel"):
            return "You are not allowed to use groups"
        # apne hi group me bhej sakta hai, kisi bhi group me nahi
        with get_conn() as conn:
            cur = conn.cursor()
            cur.execute("SELECT 1 FROM walkie_channel_members"
                        " WHERE channel_id = %s AND user_id = %s", (tid, user["id"]))
            if not cur.fetchone():
                return "You are not in that group"
        return None
    if t != "user" or tid <= 0:
        return "Bad target"
    if tid == int(user["id"]):
        return "You cannot message yourself"
    if tid not in _enabled_ids():
        return "That person is not on Walkie-Talkie"
    # Setup me jodi banaye bina chat nahi -- aur ye jaanch YAHI hoti hai,
    # sirf list chhupane se koi rok nahi lagti.
    if tid not in _allowed_ids(user):
        return "You are not allowed to chat with that person"
    return None


def _save_msg(uid: int, name: str, target: dict, body: str):
    """Ek message DB me daalo aur wahi payload lauta do jo socket par jaata
    hai -- dono jagah ek hi shakal rahe, isliye ek hi jagah banti hai."""
    t = (target or {}).get("type")
    tid = int((target or {}).get("id") or 0)
    convo = _convo_key(uid, target)
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            "INSERT INTO walkie_messages (from_user, from_name, target_type,"
            " target_id, convo, body) VALUES (%s,%s,%s,%s,%s,%s)"
            " RETURNING id, at", (uid, name, t, tid, convo, body))
        r = cur.fetchone()
        conn.commit()
    return {"t": "chat", "id": r["id"],
            "at": r["at"].isoformat(timespec="seconds"),
            "convo": convo, "from": {"id": uid, "name": name},
            "target": {"type": t, "id": tid}, "body": body}


def _convo_naam(convo: str) -> str:
    """"u:1:4" -> "Administrator <-> maint", "c:2" -> group ka naam.
    Nishaan me raw key likhne se koi baad me samajh hi nahi paata."""
    try:
        p = (convo or "").split(":")
        with get_conn() as conn:
            cur = dict_cursor(conn)
            if p[0] == "c":
                cur.execute("SELECT name FROM walkie_channels WHERE id = %s", (int(p[1]),))
                r = cur.fetchone()
                return f"group {r['name']}" if r else convo
            cur.execute("SELECT id, username, full_name FROM maintenance_users"
                        " WHERE id = ANY(%s)", ([int(p[1]), int(p[2])],))
            naam = {r["id"]: _naam(r) for r in (cur.fetchall() or [])}
        return f"{naam.get(int(p[1]), p[1])} \u2194 {naam.get(int(p[2]), p[2])}"
    except Exception:
        return convo


def _clean_body(x) -> str:
    b = (x or "")
    if not isinstance(b, str):
        return ""
    b = b.strip()
    return b[:MAX_CHAT_LEN]


@router.get("/roster")
def roster(user=Depends(get_current_user)):
    """App ki main list: kaun-kaun walkie par hai, kaun abhi online hai, aur
    kaunse channel me main hoon.  Khud ko list me nahi bhejte -- apne aap ko
    bulane ka koi matlab nahi."""
    rows = [r for r in _members_rows() if r["enabled"]]
    online = _hub.online_ids()
    me_in = [c for c in _channels_rows() if user["id"] in c["members"]]
    return {
        "me": {"id": user["id"], "name": _naam(user),
               "enabled": user["id"] in {r["id"] for r in rows},
               # UI ka faisla bhi SERVER se aata hai, taaki dono jagah ek hi
               # jawab rahe (frontend ka `canAccess` sirf dikhane ke liye).
               "can_voice": _can(user, "walkie-voice"),
               "can_buzz": _can(user, "walkie-buzz"),
               "can_channel": _can(user, "walkie-channel"),
               "can_chat": _can(user, "walkie-chat")},
        # `can_buzz_ids` -- in me se kis-kis ko ye banda buzz kar sakta hai.
        # Page list se naam HATATA nahi (warna voice bhi chala jaata, aur wo
        # alag cheez hai) -- sirf Buzz ka button chhupa deta hai.
        "can_buzz_ids": sorted(_jodi_ids(user, "walkie_buzz_pairs")),
        "people": [{"id": r["id"], "name": _naam(r), "username": r["username"],
                    "online": r["id"] in online}
                   for r in rows if r["id"] != user["id"]],
        # Group ki ijazat na ho to list bhejte hi nahi -- page chhupa de,
        # itna kaafi nahi hota.
        "channels": ([{"id": c["id"], "name": c["name"], "color": c["color"],
                       "size": len(c["members"]),
                       "online": len([u for u in c["members"] if u in online])}
                      for c in me_in] if _can(user, "walkie-channel") else []),
    }


@router.get("/members")
def members(user=Depends(require_admin)):
    """Admin ka assign parda — har active user, jude hue par tick."""
    online = _hub.online_ids()
    return [{"id": r["id"], "name": _naam(r), "username": r["username"],
             "role": r["role"], "enabled": r["enabled"], "online": r["id"] in online}
            for r in _members_rows()]


class MemberIn(BaseModel):
    enabled: bool


@router.put("/members/{user_id}")
def set_member(user_id: int, body: MemberIn, user=Depends(require_admin)):
    _ensure_tables()
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("SELECT 1 FROM maintenance_users WHERE id = %s", (user_id,))
        if not cur.fetchone():
            raise HTTPException(404, "User not found")
        cur.execute("""
            INSERT INTO walkie_members (user_id, enabled, added_by)
                 VALUES (%s, %s, %s)
            ON CONFLICT (user_id) DO UPDATE SET enabled = EXCLUDED.enabled
        """, (user_id, body.enabled, user.get("username")))
        conn.commit()
    # Hata diya to uska socket abhi band karo -- warna wo aage bhi sunta
    # rahega jab tak app band na kare.
    if not body.enabled:
        _hub.kick_later(user_id)
    return {"ok": True}


@router.get("/channels")
def channels(user=Depends(get_current_user)):
    online = _hub.online_ids()
    out = []
    for c in _channels_rows():
        out.append({**c, "online": len([u for u in c["members"] if u in online])})
    return out


class ChannelIn(BaseModel):
    name: str
    color: Optional[str] = None


@router.post("/channels")
def add_channel(body: ChannelIn, user=Depends(require_admin)):
    _ensure_tables()
    nm = (body.name or "").strip()
    if not nm:
        raise HTTPException(400, "Channel name is required")
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("SELECT 1 FROM walkie_channels WHERE LOWER(name) = LOWER(%s)", (nm,))
        if cur.fetchone():
            raise HTTPException(409, "A channel with this name already exists")
        cur.execute("INSERT INTO walkie_channels (name, color) VALUES (%s,%s) RETURNING id",
                    (nm, body.color))
        cid = cur.fetchone()[0]
        conn.commit()
    return {"id": cid}


@router.delete("/channels/{cid}")
def del_channel(cid: int, user=Depends(require_admin)):
    _ensure_tables()
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM walkie_channel_members WHERE channel_id = %s", (cid,))
        cur.execute("DELETE FROM walkie_channels WHERE id = %s", (cid,))
        conn.commit()
    return {"ok": True}


class ChannelMembersIn(BaseModel):
    user_ids: list[int]


@router.put("/channels/{cid}/members")
def set_channel_members(cid: int, body: ChannelMembersIn, user=Depends(require_admin)):
    _ensure_tables()
    ids = sorted({int(i) for i in (body.user_ids or [])})
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("SELECT 1 FROM walkie_channels WHERE id = %s", (cid,))
        if not cur.fetchone():
            raise HTTPException(404, "Channel not found")
        cur.execute("DELETE FROM walkie_channel_members WHERE channel_id = %s", (cid,))
        for uid in ids:
            cur.execute("INSERT INTO walkie_channel_members (channel_id, user_id)"
                        " VALUES (%s,%s) ON CONFLICT DO NOTHING", (cid, uid))
        conn.commit()
    return {"ok": True, "count": len(ids)}


@router.post("/events/{eid}/ack")
def ack_event(eid: int, user=Depends(get_current_user)):
    """Buzz ka jawab.  Jo PEHLE "OK" dabata hai uska naam aur waqt lag jaata
    hai; uske baad wale chup-chaap nazarandaaz (channel ke buzz me kai log
    sun rahe hote hain, par "jawab mila ya nahi" ka matlab pehle wale se hi
    hai)."""
    _ensure_tables()
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            "UPDATE walkie_events SET acked_at = NOW(), acked_by = %s, acked_name = %s"
            " WHERE id = %s AND acked_at IS NULL",
            (user["id"], _naam(user), eid))
        conn.commit()
        return {"ok": True, "first": cur.rowcount > 0}


class DeleteIn(BaseModel):
    ids: list[int]


@router.post("/events/delete")
def delete_events(body: DeleteIn, user=Depends(require_admin)):
    """History se qatarein hatao.  SIRF ADMIN.

    Ek-ek `DELETE` ke bajaye ek hi call me kai id -- history me 100-200
    qatar aam baat hai, aur ek-ek karke hatana dono taraf bhaari padta."""
    _ensure_tables()
    ids = [int(i) for i in (body.ids or [])]
    if not ids:
        return {"ok": True, "deleted": 0}
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM walkie_events WHERE id = ANY(%s)", (ids,))
        n = cur.rowcount
        conn.commit()
    return {"ok": True, "deleted": n}


def _fy_window(fy: str):
    """"2026-27" -> (2026-04-01, 2027-04-01).  Baaki app me bhi FY Apr->Mar hi
    hai, isliye wahi yahan."""
    try:
        y = int(str(fy).split("-")[0])
    except Exception:
        return None
    return (f"{y}-04-01", f"{y + 1}-04-01")


@router.get("/events")
def events(limit: int = Query(300, ge=1, le=2000),
           fy: Optional[str] = Query(None),
           month: Optional[str] = Query(None),     # "2026-09"
           date: Optional[str] = Query(None),      # "2026-09-13"
           user_id: Optional[int] = Query(None),   # kisne kiya YA kiske liye
           kind: Optional[str] = Query(None),      # buzz | voice | chat
           user=Depends(get_current_user)):
    """Walkie ka itihaas -- call, buzz, aur (admin ko) chat bhi.

    CHAT KI QATAREIN PADHTE WAQT JODI JAATI HAIN (`UNION ALL`), likhte waqt
    nahi.  Har message par `walkie_events` me ek aur qatar daalne se likhne
    ka kaam dugna ho jaata aur do jagah ek hi baat rakhni padti -- yahan ek
    bhi extra INSERT nahi hota.

    ⚠ CHAT SIRF ADMIN KO DIKHTI HAI.  Baaki itihaas (kisne kisko bulaya)
    har judey hue user ko dikhta hai -- wo pehle se aisa hi tha.  Par message
    ka MATN niji baat hai, isliye wo sirf admin tak.

    Har qatar par `src` hota hai (`event` ya `chat`) -- id dono tableon me
    alag-alag chalti hain, isliye bina `src` ke dono ki id aapas me mil
    jaati aur "delete" galat qatar utha leta.
    """
    _ensure_tables()
    is_admin = (user.get("role") or "") == "admin"

    def tareekh(col):
        w, p = [], []
        if fy:
            win = _fy_window(fy)
            if win:
                w.append(f"{col} >= %s AND {col} < %s")
                p += [win[0], win[1]]
        if month:
            w.append(f"to_char({col}, 'YYYY-MM') = %s")
            p.append(month)
        if date:
            w.append(f"{col}::date = %s")
            p.append(date)
        return w, p

    hisse, params = [], []

    # ── call / buzz ──
    if kind != "chat":
        w, p = tareekh("at")
        if user_id:
            # "is bande se judi" har qatar: usne kiya, ya uske liye tha, ya
            # usne jawab diya.
            w.append("(from_user = %s OR (target_type = 'user' AND target_id = %s)"
                     " OR acked_by = %s)")
            p += [user_id, user_id, user_id]
        if kind:
            w.append("kind = %s")
            p.append(kind)
        q = ("SELECT 'event' AS src, id, at, kind, from_user, from_name, target_type,"
             " target_id, target_name, secs, acked_at, acked_by, acked_name,"
             " NULL::text AS body FROM walkie_events")
        if w:
            q += " WHERE " + " AND ".join(w)
        hisse.append(q)
        params += p

    # ── chat (sirf admin) ──
    if is_admin and kind in (None, "", "chat"):
        w, p = tareekh("m.at")
        if user_id:
            w.append("(m.from_user = %s OR (m.target_type = 'user' AND m.target_id = %s))")
            p += [user_id, user_id]
        q = ("SELECT 'chat' AS src, m.id, m.at, 'chat' AS kind, m.from_user, m.from_name,"
             " m.target_type, m.target_id,"
             " COALESCE(NULLIF(TRIM(u.full_name), ''), u.username, ch.name,"
             "          '#' || m.target_id) AS target_name,"
             " NULL::numeric(6,1) AS secs, NULL::timestamp AS acked_at,"
             " NULL::integer AS acked_by, NULL::text AS acked_name, m.body"
             " FROM walkie_messages m"
             " LEFT JOIN maintenance_users u"
             "   ON m.target_type = 'user' AND u.id = m.target_id"
             " LEFT JOIN walkie_channels ch"
             "   ON m.target_type = 'channel' AND ch.id = m.target_id")
        if w:
            q += " WHERE " + " AND ".join(w)
        hisse.append(q)
        params += p

    if not hisse:
        return []
    sql = " UNION ALL ".join(f"({x})" for x in hisse) + " ORDER BY at DESC LIMIT %s"
    params.append(limit)
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute(sql, tuple(params))
        return cur.fetchall() or []


# ══════════════════════════════════════════════════════════════════
#  WebSocket hub
# ══════════════════════════════════════════════════════════════════
class ChatIn(BaseModel):
    target_type: str = "user"
    target_id: int = 0
    body: str = ""


@router.post("/chat")
def chat_send(body: ChatIn, user=Depends(get_current_user)):
    """Message bhejo -- REST se.

    Socket rehte hue REST kyun: PHONE KE NOTIFICATION SE JAWAB dete waqt app
    khuli hoti hi nahi.  Wahan sirf Java ki service zinda hai, aur uske liye
    ek POST bhejna socket ki haalat sambhalne se kahin saaf hai.  (Yahi soch
    `events/{id}/ack` me bhi hai.)

    Bhejne ke baad message UN SABKE khule socket par bhi chala jaata hai jinko
    milna chahiye -- yaani notification se bheja hua jawab saamne wale ki
    khuli app me TURANT dikh jaata hai."""
    _ensure_tables()
    target = {"type": (body.target_type or "user"), "id": int(body.target_id or 0)}
    txt = _clean_body(body.body)
    if not txt:
        raise HTTPException(status_code=400, detail="Message is empty")
    why = _chat_ok(user, target)
    if why:
        raise HTTPException(status_code=403, detail=why)
    payload = _save_msg(user["id"], _naam(user), target, txt)
    _hub.push_later(payload, user["id"], target)
    return payload


@router.get("/chat")
def chat_thread(with_user: int = Query(0, alias="with"),
                channel: int = Query(0),
                limit: int = Query(50, ge=1, le=200),
                before: int = Query(0),
                user=Depends(get_current_user)):
    """Ek baat-cheet -- nayi se purani.  `before` se aur peeche jao."""
    _ensure_tables()
    target = ({"type": "channel", "id": channel} if channel
              else {"type": "user", "id": with_user})
    why = _chat_ok(user, target)
    if why:
        raise HTTPException(status_code=403, detail=why)
    return {"convo": _convo_key(user["id"], target),
            "messages": _thread_rows(_convo_key(user["id"], target), limit, before)}


def _thread_rows(convo: str, limit: int, before: int = 0):
    """Ek hi indexed query -- `(convo, id DESC)` par.  Kram ULTA karke
    lautate hain taaki page par purani upar aur nayi neeche dikhe."""
    with get_conn() as conn:
        cur = dict_cursor(conn)
        if before:
            cur.execute(
                "SELECT id, at, from_user, from_name, body FROM walkie_messages"
                " WHERE convo = %s AND id < %s ORDER BY id DESC LIMIT %s",
                (convo, before, limit))
        else:
            cur.execute(
                "SELECT id, at, from_user, from_name, body FROM walkie_messages"
                " WHERE convo = %s ORDER BY id DESC LIMIT %s", (convo, limit))
        rows = cur.fetchall() or []
    out = []
    for r in reversed(rows):
        out.append({"id": r["id"], "at": r["at"].isoformat(timespec="seconds"),
                    "from": {"id": r["from_user"], "name": r["from_name"]},
                    "body": r["body"]})
    return out


def _mere_convo(user: dict):
    """Meri saari mumkin baat-cheet ki key.  Roster jitni hi hain, isliye
    list chhoti rehti hai aur neeche ki query `= ANY(...)` par index use
    karti hai -- koi OR-scan nahi."""
    me = int(user["id"])
    keys = {}
    mil_sakte = _allowed_ids(user)
    for r in _members_rows():
        # Sirf wahi log dikhte hain jinse chat ki ijazat hai -- "allow karne
        # ke baad hi uski id dikhegi".
        if not r["enabled"] or r["id"] == me or r["id"] not in mil_sakte:
            continue
        a, b = sorted((me, int(r["id"])))
        keys[f"u:{a}:{b}"] = {"type": "user", "id": r["id"], "name": _naam(r)}
    if _can(user, "walkie-channel"):
        for c in _channels_rows():
            if me in c["members"]:
                keys[f"c:{c['id']}"] = {"type": "channel", "id": c["id"], "name": c["name"]}
    return keys


@router.get("/chat/threads")
def chat_threads(user=Depends(get_current_user)):
    """Meri saari baat-cheet: aakhri message + kitne bina padhe.

    DO query, dono indexed -- ek har baat-cheet ka aakhri message uthati hai
    (`DISTINCT ON`), doosri bina padhe ki ginti.  Har message par qatar nahi
    ginte, isliye ye list badi hone par bhi bhaari nahi hoti."""
    _ensure_tables()
    keys = _mere_convo(user)
    if not keys:
        return {"threads": []}
    kl = list(keys.keys())
    me = int(user["id"])
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            "SELECT DISTINCT ON (convo) convo, id, at, from_user, from_name, body"
            "  FROM walkie_messages WHERE convo = ANY(%s)"
            " ORDER BY convo, id DESC", (kl,))
        last = {r["convo"]: r for r in (cur.fetchall() or [])}
        cur.execute(
            "SELECT m.convo, COUNT(*) AS n FROM walkie_messages m"
            "  LEFT JOIN walkie_reads r ON r.user_id = %s AND r.convo = m.convo"
            " WHERE m.convo = ANY(%s) AND m.from_user <> %s"
            "   AND m.id > COALESCE(r.last_id, 0) GROUP BY m.convo", (me, kl, me))
        anpadhe = {r["convo"]: r["n"] for r in (cur.fetchall() or [])}
    out = []
    for k, who in keys.items():
        l = last.get(k)
        out.append({
            "convo": k, "with": who,
            "unread": anpadhe.get(k, 0),
            "last": ({"id": l["id"], "at": l["at"].isoformat(timespec="seconds"),
                      "from": {"id": l["from_user"], "name": l["from_name"]},
                      "body": l["body"]} if l else None),
        })
    # Jisme baat hui ho wo upar, aur usme bhi nayi baat sabse upar
    out.sort(key=lambda x: (x["last"]["id"] if x["last"] else 0), reverse=True)
    return {"threads": out}


class PairsIn(BaseModel):
    user_ids: List[int] = []


@router.get("/buzz/pairs")
def buzz_pairs(user=Depends(require_admin)):
    """Kaun kisko buzz kar sakta hai -- {user_id: [ids]}."""
    _ensure_tables()
    return _jodi_padho("walkie_buzz_pairs")


@router.put("/buzz/pairs/{user_id}")
def set_buzz_pairs(user_id: int, body: PairsIn, user=Depends(require_admin)):
    """Is bande ki POORI buzz-list set karo -- jo list me nahi, wo jodi tooti."""
    _ensure_tables()
    return _jodi_likho("walkie_buzz_pairs", user_id, body.user_ids, user)


def _jodi_padho(table: str):
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute(f"SELECT a_user, b_user FROM {table}")
        rows = cur.fetchall() or []
    m = {}
    for r in rows:
        m.setdefault(r["a_user"], set()).add(r["b_user"])
        m.setdefault(r["b_user"], set()).add(r["a_user"])
    return {"pairs": {str(k): sorted(v) for k, v in m.items()}}


def _jodi_likho(table: str, user_id: int, ids, kisne):
    """Pehle sab hata kar dobara daalte hain -- "kya jodo, kya hatao" ka
    hisaab karne se ek din dono taraf alag-alag ho jaate hain."""
    me = int(user_id)
    doosre = {int(i) for i in (ids or []) if int(i) != me}
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute(f"DELETE FROM {table} WHERE a_user = %s OR b_user = %s", (me, me))
        for o in sorted(doosre):
            cur.execute(f"INSERT INTO {table} (a_user, b_user, added_by)"
                        " VALUES (%s,%s,%s) ON CONFLICT DO NOTHING",
                        (min(me, o), max(me, o), kisne.get("username")))
        conn.commit()
    return {"ok": True, "count": len(doosre)}


@router.get("/chat/pairs")
def chat_pairs(user=Depends(require_admin)):
    """Kaun kis-kis se chat kar sakta hai -- {user_id: [ids]}.
    Dono taraf se bharte hain, taaki UI ko jodne ka hisaab na karna pade."""
    _ensure_tables()
    return _jodi_padho("walkie_chat_pairs")


@router.put("/chat/pairs/{user_id}")
def set_chat_pairs(user_id: int, body: PairsIn, user=Depends(require_admin)):
    """Is bande ki POORI list set karo -- jo list me nahi, wo jodi tooti.

    Pehle sab hata kar dobara daalte hain: "kya jodo, kya hatao" ka hisaab
    karne se ek din dono taraf alag-alag ho jaate hain."""
    _ensure_tables()
    return _jodi_likho("walkie_chat_pairs", user_id, body.user_ids, user)


class ChatReadIn(BaseModel):
    convo: str = ""
    last_id: int = 0


@router.post("/chat/read")
def chat_read(body: ChatReadIn, user=Depends(get_current_user)):
    """"Yahan tak padh liya."  Har baat-cheet par EK hi qatar banti hai."""
    _ensure_tables()
    convo = (body.convo or "").strip()
    if not convo:
        raise HTTPException(status_code=400, detail="convo is required")
    if convo not in _mere_convo(user):
        raise HTTPException(status_code=403, detail="Not your conversation")
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO walkie_reads (user_id, convo, last_id) VALUES (%s,%s,%s)"
            " ON CONFLICT (user_id, convo) DO UPDATE SET last_id ="
            " GREATEST(walkie_reads.last_id, EXCLUDED.last_id)",
            (user["id"], convo, int(body.last_id or 0)))
        conn.commit()
    return {"ok": True}


@router.get("/chat/admin")
def chat_admin(a: int = 0, b: int = 0, channel: int = 0,
               limit: int = Query(200, ge=1, le=1000),
               before: int = Query(0),
               user=Depends(require_admin)):
    """(admin) Kisi ke bhi do bande ki, ya kisi bhi group ki baat-cheet.

    Yahan `_chat_ok` nahi lagta -- admin ka kaam hi doosron ki baat dekhna
    hai.  `require_admin` hi poori rok hai."""
    _ensure_tables()
    if channel:
        convo = f"c:{int(channel)}"
    else:
        if not a or not b or int(a) == int(b):
            raise HTTPException(status_code=400, detail="Pick two different people")
        x, y = sorted((int(a), int(b)))
        convo = f"u:{x}:{y}"
    return {"convo": convo, "messages": _thread_rows(convo, limit, before)}


# Ek baar me itne se jyada message nahi.  Page par 200 hi aate hain; ye bas
# had hai, taaki galti se (ya jaan-boojh kar) hazaron ek saath na chale jayen.
MAX_AUDIT_PICK_CHAT = 200


class ChatClearIn(BaseModel):
    date_from: str = ""
    date_to: str = ""
    convo: str = ""          # khali = us range ki saari baat-cheet


# Safai ka nishaan audit-log me jaata hai.  Naam me DELETE isliye hai ki wo
# Maintenance Panel ke "Delete History" me default view me hi dikh jaye.
CHAT_CLEAR_ACTION = "WALKIE_CHAT_DELETE"


@router.post("/chat/clear")
def chat_clear(body: ChatClearIn, user=Depends(require_admin)):
    """(admin) Purani chat hatao -- tareekh ki range se, nishaan chhod kar.

    Wahi soch jo Delete History ki safai me hai: mitana to de rahe hain, par
    ek pankti audit-log me ruk jaati hai (kisne, kaunsi range, kitni qatarein)
    -- warna baat-cheet chup-chaap gayab ki ja sakti thi."""
    _ensure_tables()
    df = (body.date_from or "").strip()
    dt = (body.date_to or "").strip()
    if not df or not dt:
        raise HTTPException(status_code=400, detail="date_from and date_to are required")
    if dt < df:
        raise HTTPException(status_code=400, detail="date_to cannot be before date_from")
    convo = (body.convo or "").strip()
    with get_conn() as conn:
        cur = conn.cursor()
        if convo:
            cur.execute("DELETE FROM walkie_messages WHERE at >= %s AND at <= %s"
                        " AND convo = %s", (df + " 00:00:00", dt + " 23:59:59", convo))
        else:
            cur.execute("DELETE FROM walkie_messages WHERE at >= %s AND at <= %s",
                        (df + " 00:00:00", dt + " 23:59:59"))
        kitni = cur.rowcount or 0
        if kitni:
            kya = f" in {convo}" if convo else ""
            cur.execute(
                "INSERT INTO maintenance_audit_log (action, details, user_id, username)"
                " VALUES (%s,%s,%s,%s)",
                (CHAT_CLEAR_ACTION,
                 f"Cleared Walkie chat {df} to {dt}{kya} \u2014 {kitni} "
                 f"{'message' if kitni == 1 else 'messages'} removed",
                 user.get("id"), user.get("username")))
        conn.commit()
    return {"ok": True, "deleted": kitni}


class ChatDeleteIn(BaseModel):
    ids: List[int] = []      # chune hue message
    convo: str = ""          # ...ya poori baat-cheet


@router.post("/chat/delete")
def chat_delete(body: ChatDeleteIn, user=Depends(require_admin)):
    """(admin) Chune hue message hatao, ya poori baat-cheet.

    Dono raaste ek hi jagah, kyunki dono ka nishaan ek jaisa hi banta hai.

    ⚠ NISHAAN ME MESSAGE KA MATN NAHI JAATA -- jaan-boojh kar.
    Delete History me hatayi gayi qatar ka byora nishaan me likha jaata hai,
    par wahan wo khud ek AUDIT record tha.  Yahan matn kisi ki niji baat hai:
    use audit-log me rakh dena "delete" ko bemaani kar deta, aur jo baat
    sabse zyada sambhal kar hatai jaati hai wahi kahin aur pad jaati.
    Isliye nishaan me utna hi hai jitna JAWABDEHI ke liye chahiye --
    kaunsa message (#id), kisne likha tha, kab, aur kis baat-cheet me.
    """
    _ensure_tables()
    ids = sorted({int(i) for i in (body.ids or [])})
    convo = (body.convo or "").strip()
    if bool(ids) == bool(convo):
        raise HTTPException(status_code=400,
                            detail="Send either ids or convo, not both")
    if len(ids) > MAX_AUDIT_PICK_CHAT:
        raise HTTPException(status_code=400,
                            detail=f"At most {MAX_AUDIT_PICK_CHAT} messages at a time")

    with get_conn() as conn:
        cur = dict_cursor(conn)
        # PEHLE padho -- delete ke baad ye byora kahin se nahi milega.
        if ids:
            cur.execute("SELECT id, convo, from_user, from_name, at"
                        "  FROM walkie_messages WHERE id = ANY(%s)"
                        " ORDER BY id", (ids,))
        else:
            cur.execute("SELECT id, convo, from_user, from_name, at"
                        "  FROM walkie_messages WHERE convo = %s"
                        " ORDER BY id", (convo,))
        rows = cur.fetchall() or []
        if not rows:
            return {"ok": True, "deleted": 0, "skipped": len(ids)}

        mile = [r["id"] for r in rows]
        cur.execute("DELETE FROM walkie_messages WHERE id = ANY(%s)", (mile,))
        kitni = cur.rowcount or 0

        n = len(rows)
        if convo:
            byora = (f"Deleted the whole chat \u2014 {_convo_naam(convo)} ({convo})"
                     f" \u2014 {n} {'message' if n == 1 else 'messages'}")
        else:
            kis = sorted({r["convo"] for r in rows})
            tukde = [f"#{r['id']} by {r['from_name'] or '-'}"
                     f" {r['at'].strftime('%Y-%m-%d %H:%M:%S') if r['at'] else '?'}"
                     for r in rows]
            byora = (f"Deleted {n} selected {'message' if n == 1 else 'messages'}"
                     f" in {', '.join(_convo_naam(k) for k in kis)}"
                     f" \u2014 " + " | ".join(tukde))
        cur.execute(
            "INSERT INTO maintenance_audit_log (action, details, user_id, username)"
            " VALUES (%s,%s,%s,%s)",
            (CHAT_CLEAR_ACTION, byora, user.get("id"), user.get("username")))
        conn.commit()

    # Jinke paas wo baat-cheet khuli hai, unke parde se message ab hi hat jaye
    # -- warna wo page refresh hone tak hatayi hui baat dekhte rehte.
    for k in sorted({r["convo"] for r in rows}):
        _hub.del_later(k, [r["id"] for r in rows if r["convo"] == k])

    return {"ok": True, "deleted": kitni, "skipped": len(ids) - len(mile) if ids else 0}


class _Conn:
    """Ek juda hua socket.  `role`:
         rx = sunne wala (Java service, ya browser ka khula page)
         tx = bolne wala (WebView ka page jab button dabta hai)
       `kind` sirf batane ke liye hai ki ye native service hai ya web page --
       server dono ko ek jaisa hi bhejta hai; bajana ya na bajana CLIENT tay
       karta hai (phone par service bajati hai, page nahi -- warna ek hi
       aawaz do baar aati).  Sirf "online/offline" (presence) native ko nahi
       jaata -- wo use padhti hi nahi, bas phone jaagta.
       `walkie` False = sirf ANDON wala socket (walkie ka member nahi, ya app
       me walkie band): na online dikhta, na walkie ka koi message jaata.
       `andon` True = nayi ANDON call isi socket par bhejo."""
    __slots__ = ("ws", "uid", "name", "role", "kind", "since", "walkie", "andon")

    def __init__(self, ws, uid, name, role, kind, walkie=True, andon=False):
        self.ws, self.uid, self.name = ws, uid, name
        self.role, self.kind = role, kind
        self.since = time.time()
        self.walkie, self.andon = walkie, andon


def _lamba_ping(ws: WebSocket, every: float, timeout: float) -> bool:
    """Sirf IS socket ka server-ping badlo (baaki sab 20 sec par hi rehte hain).

    uvicorn ping ka waqt sabke liye ek hi rakhta hai (`--ws-ping-interval`),
    per-socket koi raasta nahi.  Isliye socket ke peechhe baithe uvicorn ke
    protocol object tak pahunch kar uska `ping_interval` badalte hain --
    websockets ka keepalive har chakkar me wahi padhta hai.  Starlette `send`
    ko closure me lapet deta hai, isliye closure ke andar dhoondhte hain.

    ⚠ Ye uvicorn / websockets ke ANDAR ka hissa hai.  requirements.txt me
    uvicorn 0.27.0 + websockets 12.0 pinned hain -- unpar naapa: 2s set kiya
    to ping theek 2s par aaya.  Kuch na mile to kuch nahi badalta -- ping
    20 sec hi rehta hai, tootta kuch nahi.
    """
    seen, todo = set(), [getattr(ws, "_send", None)]
    while todo and len(seen) < 50:
        f = todo.pop()
        if f is None or id(f) in seen:
            continue
        seen.add(id(f))
        p = getattr(f, "__self__", None)
        if p is not None and isinstance(getattr(p, "ping_interval", None), (int, float)) \
                and hasattr(p, "ping_timeout"):
            p.ping_interval = float(every)
            p.ping_timeout = float(timeout)
            return True
        for cell in (getattr(f, "__closure__", None) or ()):
            try:
                todo.append(cell.cell_contents)
            except ValueError:              # khaali cell
                pass
    return False


_PING_BATAYA = False


def _andon_band(user: dict) -> bool:
    """Is user ki ANDON khabar band hai?  Wahi niyam jo page (`AndonAlert.jsx`)
    maanta hai: SIRF saaf-saaf "none" band karta hai, set na ho to chalu --
    ANDON madad bulane ka system hai, galti se sabki khabar band na ho."""
    try:
        with get_conn() as conn:
            cur = dict_cursor(conn)
            cur.execute("SELECT perm_level FROM maintenance_user_permissions"
                        " WHERE user_id = %s AND page_key = 'andon-alert'", (user["id"],))
            r = cur.fetchone()
        return bool(r) and (r["perm_level"] or "") == "none"
    except Exception:
        return False


def _andon_rows_db() -> list:
    """Abhi khuli MAINTENANCE ANDON calls -- bilkul wahi jo `/api/andon/dashboard`
    ki `rows` deti hai (wahi shart, wahi naam), taaki page ka popup dono raaston
    se ek jaisa bane.  Sync hai -- event-loop se `asyncio.to_thread` me bulao."""
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("""
            SELECT e.id, e.zone AS zone_name, e.line AS line_name, e.started_at,
                   CASE WHEN e.acknowledged_at IS NOT NULL
                        THEN EXTRACT(EPOCH FROM (e.acknowledged_at - e.started_at))::int END
                        AS response_seconds
              FROM andon_system e
              LEFT JOIN andon_departments dep ON dep.id = e.department_id
             WHERE e.state = 'OPEN'
               AND COALESCE(dep.name, e.display_name) ILIKE 'maintenance'
             ORDER BY e.started_at
        """)
        rows = cur.fetchall() or []
    return [{"id": r["id"], "zone_name": r["zone_name"], "line_name": r["line_name"],
             "started_at": r["started_at"].isoformat() if r["started_at"] else None,
             "response_seconds": r["response_seconds"]} for r in rows]


def _andon_ring_band() -> set:
    """Jin ID par ANDON ki RING band hai (admin → Services → "ANDON ring").
    Wahan popup / notification phir bhi jaata hai, bas phone awaaz nahi karta.
    Kuch na mile (table abhi bani nahi) to kisi ki band nahi -- default ON."""
    try:
        from routers.client_services import ring_band_ids
        return ring_band_ids()
    except Exception:
        return set()


class _Hub:
    def __init__(self):
        self._conns: list[_Conn] = []
        self._floor: dict[str, tuple] = {}      # "u:5"/"c:2" -> (uid, started_at)
        self._talking: dict[int, dict] = {}     # uid -> {key, target, started}
        self._lock = asyncio.Lock()
        # REST wale handler dusre THREAD me chalte hain (FastAPI sync endpoint
        # ko threadpool me daalta hai), isliye wahan se socket band karne ke
        # liye event-loop ka pata chahiye.  Pehla connection aate hi rakh lete
        # hain.
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        # ANDON: aakhri list jo sabko bheji gayi, jin ID ki ring band hai, aur
        # DB dekhne wala chakkar
        self._andon_rows: Optional[list] = None
        self._andon_band: Optional[set] = None
        self._andon_task: Optional[asyncio.Task] = None

    # ── presence ──
    def online_ids(self) -> set:
        return {c.uid for c in self._conns if c.role == "rx" and c.walkie}

    def kick_later(self, uid: int):
        """Admin ne kisi ko walkie se hata diya -- uska socket ABHI band karo.
        Pehle sirf ek nishaan lagta tha jo tab dekha jaata jab wo AGLI BAAR
        kuch bhejta -- yaani chup baitha banda hatane ke baad bhi sunta
        rehta tha, app band karne tak.  (Test me pakda.)"""
        loop = self._loop
        if loop is None:
            return
        try:
            asyncio.run_coroutine_threadsafe(self._close_user(int(uid)), loop)
        except Exception:
            pass

    async def _close_user(self, uid: int):
        for c in [x for x in self._conns if x.uid == uid and x.walkie]:
            try:
                # ANDON bhi isi socket par aata ho to 4410 = "dobara judo":
                # server ab use sirf-ANDON wala bana dega, ANDON chalta rahe.
                # Bina ANDON 4403 = "ab mat judna" (jaisa pehle tha).
                await c.ws.close(code=4410 if c.andon else 4403)
            except Exception:
                pass

    def _rx_of(self, uid: int):
        # Sirf-ANDON wale socket ko walkie ka kuch nahi jaata
        return [c for c in self._conns if c.uid == uid and c.role == "rx" and c.walkie]

    async def add(self, c: _Conn):
        if self._loop is None:
            self._loop = asyncio.get_running_loop()
        async with self._lock:
            self._conns.append(c)
        if c.walkie:
            await self._presence()
        if c.andon:
            await self._andon_naya(c)

    async def drop(self, c: _Conn):
        async with self._lock:
            if c in self._conns:
                self._conns.remove(c)
            held = self._talking.pop(c.uid, None) if c.walkie else None
        if held:
            await self._release(c.uid, held, "disconnect")
        if c.walkie:
            await self._presence()

    async def _presence(self):
        msg = json.dumps({"t": "presence", "online": sorted(self.online_ids())})
        # Phone ki service (native) "online" padhti hi nahi -- use bhejna
        # matlab har kisi ke app kholne / band karne par har jeb me pade phone
        # ko bina kaam jagana.  Sirf page wale socket ko.
        for c in [x for x in self._conns if x.walkie and x.kind != "native"]:
            try:
                await c.ws.send_text(msg)
            except Exception:
                pass

    # ── ANDON: nayi MAINTENANCE call isi socket par ──
    # Pehle har khuli app khud har 2.5 sec `/api/andon/dashboard` poochti thi,
    # aur band app ko kuch pata hi nahi chalta tha.  Ab server EK query har
    # ANDON_CHAKKAR_S par chalata hai aur list badalte hi (nayi call, response
    # aaya, call band) POORI list un sab socket ko bhej deta hai jinhone
    # `andon=1` maanga.  Poori list isliye (sirf "nayi call" nahi) ki client
    # ka hisaab wahi rahe jo polling me tha, aur beech ka koi message chhoot
    # bhi jaye to agli list sab theek kar de.
    def _andon_wale(self) -> list:
        return [c for c in self._conns if c.andon]

    def _andon_msg(self, c: _Conn) -> str:
        # `ring` = is ID par ANDON ki ring baje?  Har phone ko uski apni -- isiliye
        # message har socket ka alag banta hai.
        return json.dumps({"t": "andon", "rows": self._andon_rows,
                           "ring": c.uid not in (self._andon_band or set())})

    async def _andon_naya(self, c: _Conn):
        """Naya ANDON sunne wala: jo list pehle se hai wo turant, aur chakkar
        chalu (pehla sunne wala ho to)."""
        if self._andon_rows is not None:
            try:
                await c.ws.send_text(self._andon_msg(c))
            except Exception:
                pass
        if self._andon_task is None or self._andon_task.done():
            self._andon_task = asyncio.create_task(self._andon_chakkar())

    async def _andon_chakkar(self):
        galti = ""
        try:
            while self._andon_wale():
                try:
                    rows = await asyncio.to_thread(_andon_rows_db)
                    band = await asyncio.to_thread(_andon_ring_band)
                    galti = ""
                except Exception as e:          # DB gaya -- agle chakkar me phir
                    rows = band = None
                    if str(e) != galti:         # ek hi galti baar-baar mat chhapo
                        galti = str(e)
                        print(f"[walkie] ANDON list nahi mili: {e}")
                # List badli, ya admin ne kisi ki ring badli -- sabko taaza haal
                # (app band pade phone par bhi badlaav turant lagta hai).
                if rows is not None and (rows != self._andon_rows or band != self._andon_band):
                    self._andon_rows, self._andon_band = rows, band
                    for c in self._andon_wale():
                        try:
                            await c.ws.send_text(self._andon_msg(c))
                        except Exception:
                            pass
                await asyncio.sleep(ANDON_CHAKKAR_S)
        finally:
            # Koi sunne wala nahi bacha -- agli baar naye sire se, taaki
            # purani list kisi naye socket ko na chali jaye.
            self._andon_rows = None
            self._andon_band = None
            self._andon_task = None

    # ── target -> kaun sunega ──
    def _targets(self, sender_uid: int, target: dict) -> list:
        t = (target or {}).get("type")
        tid = (target or {}).get("id")
        if t == "user":
            return self._rx_of(int(tid))
        if t == "channel":
            with get_conn() as conn:
                cur = dict_cursor(conn)
                cur.execute("SELECT user_id FROM walkie_channel_members WHERE channel_id = %s",
                            (int(tid),))
                ids = [r["user_id"] for r in (cur.fetchall() or [])]
            out = []
            for uid in ids:
                if uid != sender_uid:
                    out += self._rx_of(uid)
            return out
        return []

    def _target_name(self, target: dict) -> str:
        t = (target or {}).get("type")
        tid = (target or {}).get("id")
        try:
            with get_conn() as conn:
                cur = dict_cursor(conn)
                if t == "user":
                    cur.execute("SELECT username, full_name FROM maintenance_users WHERE id = %s", (tid,))
                    r = cur.fetchone()
                    return _naam(r) if r else f"#{tid}"
                cur.execute("SELECT name FROM walkie_channels WHERE id = %s", (tid,))
                r = cur.fetchone()
                return r["name"] if r else f"#{tid}"
        except Exception:
            return f"#{tid}"

    # ── floor ──
    async def take_floor(self, c: _Conn, target: dict):
        key = f"{'u' if target.get('type') == 'user' else 'c'}:{target.get('id')}"
        async with self._lock:
            cur = self._floor.get(key)
            # Ek pada hua floor (button daba reh gaya / app mar gayi) khud chhoot jaye
            if cur and (time.time() - cur[1]) > MAX_TALK_SECONDS:
                cur = None
                self._floor.pop(key, None)
            if cur and cur[0] != c.uid:
                who = next((x.name for x in self._conns if x.uid == cur[0]), "someone")
                return False, f"{who} is speaking"
            self._floor[key] = (c.uid, time.time())
            self._talking[c.uid] = {"key": key, "target": target, "started": time.time()}
        listeners = self._targets(c.uid, target)
        if not listeners:
            # Floor to mil gaya, par koi sunne wala hai hi nahi -- ye batana
            # zaroori hai, warna banda deewar se baat karta rehta hai.
            pass
        msg = json.dumps({"t": "rx_start", "from": {"id": c.uid, "name": c.name},
                          "target": target})
        for l in listeners:
            try:
                await l.ws.send_text(msg)
            except Exception:
                pass
        return True, len(listeners)

    async def _release(self, uid: int, held: dict, why: str = "stop"):
        async with self._lock:
            key = held["key"]
            if self._floor.get(key, (None,))[0] == uid:
                self._floor.pop(key, None)
        msg = json.dumps({"t": "rx_stop", "from": {"id": uid}})
        for l in self._targets(uid, held["target"]):
            try:
                await l.ws.send_text(msg)
            except Exception:
                pass

    async def drop_floor(self, c: _Conn):
        async with self._lock:
            held = self._talking.pop(c.uid, None)
        if not held:
            return
        await self._release(c.uid, held)
        secs = round(time.time() - held["started"], 1)
        tgt = held["target"]
        _log_event("voice", c.uid, c.name, tgt.get("type"), tgt.get("id"),
                   self._target_name(tgt), secs)

    # ── aawaz ka ek frame aage badha do ──
    async def relay(self, c: _Conn, data: bytes):
        held = self._talking.get(c.uid)
        if not held:
            return                      # bina floor ke aayi aawaz chup-chaap giradi
        if (time.time() - held["started"]) > MAX_TALK_SECONDS:
            await self.drop_floor(c)
            try:
                await c.ws.send_text(json.dumps({"t": "floor_lost", "why": "time limit"}))
            except Exception:
                pass
            return
        for l in self._targets(c.uid, held["target"]):
            try:
                await l.ws.send_bytes(data)
            except Exception:
                pass

    # ── chat ──
    def _chat_targets(self, sender_uid: int, target: dict) -> list:
        """Jinko message milna chahiye + KHUD BHEJNE WALE ke apne socket.

        Apne aap ko bhi bhejte hain taaki bande ke doosre device (phone ki
        service + khula hua page) dono par wahi baat-cheet ek jaisi dikhe --
        chahe usne notification se bheja ho ya page se.
        Apni hi phone ki SERVICE ko nakal nahi: wo apna message waise bhi
        chhod deti hai (MERI_ID), bhejne se bas jeb me pada phone jaagta."""
        return self._targets(sender_uid, target) + [
            c for c in self._rx_of(int(sender_uid)) if c.kind != "native"]

    async def chat_push(self, payload: dict, sender_uid: int, target: dict):
        msg = json.dumps(payload)
        for l in self._chat_targets(sender_uid, target):
            try:
                await l.ws.send_text(msg)
            except Exception:
                pass

    def _convo_ke_log(self, convo: str) -> list:
        """Is baat-cheet me kaun-kaun hai -- unke khule socket."""
        try:
            p = (convo or "").split(":")
            if p[0] == "c":
                with get_conn() as conn:
                    cur = dict_cursor(conn)
                    cur.execute("SELECT user_id FROM walkie_channel_members"
                                " WHERE channel_id = %s", (int(p[1]),))
                    ids = [r["user_id"] for r in (cur.fetchall() or [])]
            else:
                ids = [int(p[1]), int(p[2])]
        except Exception:
            return []
        out = []
        for uid in ids:
            out += self._rx_of(uid)
        return out

    async def _del_push(self, convo: str, ids: list):
        msg = json.dumps({"t": "chat_del", "convo": convo, "ids": ids})
        # Parde se hatana page ka kaam hai -- phone ki service ko nahi chahiye
        for l in [x for x in self._convo_ke_log(convo) if x.kind != "native"]:
            try:
                await l.ws.send_text(msg)
            except Exception:
                pass

    def del_later(self, convo: str, ids: list):
        """Admin ne message hataye -- jinke paas wo baat-cheet khuli hai unhe
        abhi bata do.  REST wale thread se aata hai, isliye `push_later`
        ki tarah event-loop par bhejte hain."""
        loop = self._loop
        if loop is None:
            return
        try:
            asyncio.run_coroutine_threadsafe(self._del_push(convo, ids), loop)
        except Exception:
            pass

    def push_later(self, payload: dict, sender_uid: int, target: dict):
        """REST se aaya message socket par aage badha do.

        REST wale handler DOOSRE THREAD me chalte hain (FastAPI sync endpoint
        ko threadpool me daalta hai), isliye seedha `await` nahi kar sakte --
        event-loop par bhejte hain, bilkul `kick_later` ki tarah."""
        loop = self._loop
        if loop is None:
            return
        try:
            asyncio.run_coroutine_threadsafe(
                self.chat_push(payload, sender_uid, target), loop)
        except Exception:
            pass

    # ── buzz (sirf vibrate) ──
    async def buzz(self, c: _Conn, target: dict):
        listeners = self._targets(c.uid, target)
        # Event PEHLE banate hain -- uska id message ke saath jaata hai, taaki
        # sunne wale ka "OK" seedha usi qatar par jawab likh de.
        eid = _log_event("buzz", c.uid, c.name, target.get("type"), target.get("id"),
                         self._target_name(target))
        msg = json.dumps({"t": "buzz", "ev": eid,
                          "from": {"id": c.uid, "name": c.name},
                          "target": target})
        for l in listeners:
            try:
                await l.ws.send_text(msg)
            except Exception:
                pass
        return len(listeners)


_hub = _Hub()


def _user_from_token(token: str) -> Optional[dict]:
    """WS me `Authorization` header nahi bhej sakte (browser ka WebSocket API
    header lene hi nahi deta), isliye token query me aata hai.  Jaanch bilkul
    wahi hai jo `get_current_user` karta hai -- password badalne par purane
    token yahan bhi mare jaate hain."""
    if not token:
        return None
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username = payload.get("sub")
        if not username:
            return None
    except JWTError:
        return None
    u = get_user_from_db(username)
    if not u:
        return None
    pca = u.get("pwd_changed_at")
    if pca is not None:
        iat = payload.get("iat")
        if iat is None or int(iat) < int(pca):
            return None
    return dict(u)


@router.websocket("/ws")
async def walkie_ws(ws: WebSocket,
                    token: str = Query(""),
                    role: str = Query("rx"),
                    kind: str = Query("web"),
                    andon: str = Query("0"),
                    walkie: str = Query("1")):
    global _PING_BATAYA
    user = _user_from_token(token)
    if not user:
        await ws.close(code=4401)                  # 4401 = humara "token galat"
        return
    _ensure_tables()
    # Walkie tabhi jab admin ne jodha ho (aur client ne walkie maanga ho).
    # ANDON ki khabar walkie ke member hone par tiki NAHI -- phone ki service
    # ab ANDON bhi isi socket se sunti hai, isliye member na ho to bhi
    # `andon=1` wala socket "sirf ANDON" ban kar judta hai.
    walkie_mila = walkie != "0" and user["id"] in _enabled_ids()
    andon_mila = andon == "1" and not _andon_band(user)
    if not walkie_mila and not andon_mila:
        await ws.close(code=4403)                  # 4403 = "admin ne jodha hi nahi"
        return

    role = "tx" if role == "tx" else "rx"
    c = _Conn(ws, user["id"], _naam(user), role, kind, walkie=walkie_mila, andon=andon_mila)
    await ws.accept()
    if kind == "native":
        # Jeb me pade phone ko server ka ping kam jagaye (upar NATIVE_PING_S)
        ok = _lamba_ping(ws, NATIVE_PING_S, NATIVE_PING_TIMEOUT_S)
        if not _PING_BATAYA:
            _PING_BATAYA = True
            print(f"[walkie] phone service ka server-ping: {NATIVE_PING_S:.0f}s" if ok
                  else "[walkie] phone service ka server-ping badal nahi paya -- 20s hi")
    # `ready` SABSE PEHLA message hona chahiye -- usi me client ko apni id aur
    # naam milta hai.  Pehle `add()` karte the, par wo presence broadcast kar
    # deta hai aur wo broadcast is socket par bhi jaata hai -- yaani client ko
    # apni pehchan se PEHLE doosron ki list mil jaati thi.  (Test me pakda.)
    try:
        await ws.send_text(json.dumps({
            "t": "ready",
            "me": {"id": c.uid, "name": c.name},
            "online": sorted(_hub.online_ids()) if c.walkie else [],
            "max_talk": MAX_TALK_SECONDS,
            # Naya client inse jaanta hai ki server ANDON bhejega, aur walkie
            # mila ya sirf ANDON.  (Purana server ye bhejta hi nahi -- tab
            # client pehle jaisa khud poochta rehta hai.)
            "walkie": c.walkie,
            "andon": c.andon,
        }))
        await _hub.add(c)
        while True:
            m = await ws.receive()
            if m.get("type") == "websocket.disconnect":
                break
            if m.get("bytes") is not None:
                if c.walkie:
                    await _hub.relay(c, m["bytes"])
                continue

            txt = m.get("text")
            if not txt:
                continue
            try:
                d = json.loads(txt)
            except Exception:
                continue
            t = d.get("t")

            if t == "ping":
                await ws.send_text(json.dumps({"t": "pong"}))
            elif not c.walkie:
                continue            # sirf-ANDON socket: walkie ka koi kaam nahi
            elif t == "ptt_start":
                if (d.get("target") or {}).get("type") == "channel" \
                        and not _can(user, "walkie-channel"):
                    await ws.send_text(json.dumps(
                        {"t": "floor", "ok": False,
                         "why": "You are not allowed to use groups"}))
                    continue
                if not _can(user, "walkie-voice"):
                    await ws.send_text(json.dumps(
                        {"t": "floor", "ok": False,
                         "why": "You are not allowed to talk — you can still buzz"}))
                    continue
                ok, info = await _hub.take_floor(c, d.get("target") or {})
                await ws.send_text(json.dumps(
                    {"t": "floor", "ok": ok,
                     **({"listeners": info} if ok else {"why": info})}))
            elif t == "ptt_stop":
                await _hub.drop_floor(c)
                await ws.send_text(json.dumps({"t": "floor", "ok": False, "why": "stopped"}))
            elif t == "buzz":
                if (d.get("target") or {}).get("type") == "channel" \
                        and not _can(user, "walkie-channel"):
                    await ws.send_text(json.dumps(
                        {"t": "buzz_sent", "listeners": 0,
                         "why": "You are not allowed to use groups"}))
                    continue
                if not _can(user, "walkie-buzz"):
                    await ws.send_text(json.dumps(
                        {"t": "buzz_sent", "listeners": 0,
                         "why": "You are not allowed to buzz"}))
                    continue
                # Setup me jodi bane bina kisi ek bande ko buzz nahi.
                # (Group par ye laagu nahi -- wahan channel ki membership
                #  hi niyam hai.)  Jaanch YAHI hoti hai: button chhupa dena
                #  koi rok nahi hoti, socket seedha bhi khola ja sakta hai.
                _kyun = _buzz_ok(user, d.get("target") or {})
                if _kyun:
                    await ws.send_text(json.dumps(
                        {"t": "buzz_sent", "listeners": 0, "why": _kyun}))
                    continue
                n = await _hub.buzz(c, d.get("target") or {})
                await ws.send_text(json.dumps({"t": "buzz_sent", "listeners": n}))
            elif t == "chat":
                # Text usi socket par jo pehle se khula hai -- ~200 byte, jabki
                # bolte waqt yahi socket 256 kbps dhoti hai.  Isliye chat ka
                # apna koi connection ya polling nahi hai.
                target = d.get("target") or {}
                why = _chat_ok(user, target)
                if why:
                    await ws.send_text(json.dumps({"t": "chat_err", "why": why}))
                    continue
                txt = _clean_body(d.get("body"))
                if not txt:
                    continue
                payload = _save_msg(c.uid, c.name, target, txt)
                await _hub.chat_push(payload, c.uid, target)
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        await _hub.drop(c)
