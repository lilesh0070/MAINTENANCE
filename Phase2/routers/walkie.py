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

Endpoints:
  GET    /api/walkie/roster                 kaun-kaun hai + kaun online
  GET    /api/walkie/members                (admin) saare user + enabled flag
  PUT    /api/walkie/members/{user_id}      (admin) kisi ko jodo/hatao
  GET    /api/walkie/channels               channel list (+ members)
  POST   /api/walkie/channels               (admin) naya channel
  DELETE /api/walkie/channels/{id}          (admin)
  PUT    /api/walkie/channels/{id}/members  (admin) channel ke log set karo
  GET    /api/walkie/events                 haal ki call ka log
  WS     /api/walkie/ws?token=..&role=rx|tx&kind=web|native
"""
from __future__ import annotations

import asyncio
import json
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
        """)
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


# ══════════════════════════════════════════════════════════════════
#  REST
# ══════════════════════════════════════════════════════════════════
@router.get("/roster")
def roster(user=Depends(get_current_user)):
    """App ki main list: kaun-kaun walkie par hai, kaun abhi online hai, aur
    kaunse channel me main hoon.  Khud ko list me nahi bhejte -- apne aap ko
    bulane ka koi matlab nahi."""
    rows = [r for r in _members_rows() if r["enabled"]]
    online = _hub.online_ids()
    me_in = [c for c in _channels_rows() if user["id"] in c["members"]]
    return {
        "me": {"id": user["id"], "name": _naam(user), "enabled": user["id"] in {r["id"] for r in rows}},
        "people": [{"id": r["id"], "name": _naam(r), "username": r["username"],
                    "online": r["id"] in online}
                   for r in rows if r["id"] != user["id"]],
        "channels": [{"id": c["id"], "name": c["name"], "color": c["color"],
                      "size": len(c["members"]),
                      "online": len([u for u in c["members"] if u in online])}
                     for c in me_in],
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
           kind: Optional[str] = Query(None),      # buzz | voice
           user=Depends(get_current_user)):
    _ensure_tables()
    where, params = [], []
    if fy:
        w = _fy_window(fy)
        if w:
            where.append("at >= %s AND at < %s")
            params += [w[0], w[1]]
    if month:
        where.append("to_char(at, 'YYYY-MM') = %s")
        params.append(month)
    if date:
        where.append("at::date = %s")
        params.append(date)
    if user_id:
        # "is bande se judi" har qatar: usne kiya, ya uske liye tha, ya usne
        # jawab diya.
        where.append("(from_user = %s OR (target_type = 'user' AND target_id = %s)"
                     " OR acked_by = %s)")
        params += [user_id, user_id, user_id]
    if kind:
        where.append("kind = %s")
        params.append(kind)
    sql = "SELECT * FROM walkie_events"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY at DESC LIMIT %s"
    params.append(limit)
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute(sql, tuple(params))
        return cur.fetchall() or []


# ══════════════════════════════════════════════════════════════════
#  WebSocket hub
# ══════════════════════════════════════════════════════════════════
class _Conn:
    """Ek juda hua socket.  `role`:
         rx = sunne wala (Java service, ya browser ka khula page)
         tx = bolne wala (WebView ka page jab button dabta hai)
       `kind` sirf batane ke liye hai ki ye native service hai ya web page --
       server dono ko ek jaisa hi bhejta hai; bajana ya na bajana CLIENT tay
       karta hai (phone par service bajati hai, page nahi -- warna ek hi
       aawaz do baar aati)."""
    __slots__ = ("ws", "uid", "name", "role", "kind", "since")

    def __init__(self, ws, uid, name, role, kind):
        self.ws, self.uid, self.name = ws, uid, name
        self.role, self.kind = role, kind
        self.since = time.time()


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

    # ── presence ──
    def online_ids(self) -> set:
        return {c.uid for c in self._conns if c.role == "rx"}

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
        for c in [x for x in self._conns if x.uid == uid]:
            try:
                await c.ws.close(code=4403)
            except Exception:
                pass

    def _rx_of(self, uid: int):
        return [c for c in self._conns if c.uid == uid and c.role == "rx"]

    async def add(self, c: _Conn):
        if self._loop is None:
            self._loop = asyncio.get_running_loop()
        async with self._lock:
            self._conns.append(c)
        await self._presence()

    async def drop(self, c: _Conn):
        async with self._lock:
            if c in self._conns:
                self._conns.remove(c)
            held = self._talking.pop(c.uid, None)
        if held:
            await self._release(c.uid, held, "disconnect")
        await self._presence()

    async def _presence(self):
        msg = json.dumps({"t": "presence", "online": sorted(self.online_ids())})
        for c in list(self._conns):
            try:
                await c.ws.send_text(msg)
            except Exception:
                pass

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
                    kind: str = Query("web")):
    user = _user_from_token(token)
    if not user:
        await ws.close(code=4401)                  # 4401 = humara "token galat"
        return
    _ensure_tables()
    if user["id"] not in _enabled_ids():
        await ws.close(code=4403)                  # 4403 = "admin ne jodha hi nahi"
        return

    role = "tx" if role == "tx" else "rx"
    c = _Conn(ws, user["id"], _naam(user), role, kind)
    await ws.accept()
    # `ready` SABSE PEHLA message hona chahiye -- usi me client ko apni id aur
    # naam milta hai.  Pehle `add()` karte the, par wo presence broadcast kar
    # deta hai aur wo broadcast is socket par bhi jaata hai -- yaani client ko
    # apni pehchan se PEHLE doosron ki list mil jaati thi.  (Test me pakda.)
    try:
        await ws.send_text(json.dumps({
            "t": "ready",
            "me": {"id": c.uid, "name": c.name},
            "online": sorted(_hub.online_ids()),
            "max_talk": MAX_TALK_SECONDS,
        }))
        await _hub.add(c)
        while True:
            m = await ws.receive()
            if m.get("type") == "websocket.disconnect":
                break
            if m.get("bytes") is not None:
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
            elif t == "ptt_start":
                ok, info = await _hub.take_floor(c, d.get("target") or {})
                await ws.send_text(json.dumps(
                    {"t": "floor", "ok": ok,
                     **({"listeners": info} if ok else {"why": info})}))
            elif t == "ptt_stop":
                await _hub.drop_floor(c)
                await ws.send_text(json.dumps({"t": "floor", "ok": False, "why": "stopped"}))
            elif t == "buzz":
                n = await _hub.buzz(c, d.get("target") or {})
                await ws.send_text(json.dumps({"t": "buzz_sent", "listeners": n}))
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        await _hub.drop(c)
