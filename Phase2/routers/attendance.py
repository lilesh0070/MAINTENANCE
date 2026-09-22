"""
routers/attendance.py
=====================
Attendance Dashboard (sidebar) -- kaun aadmi kis din kis kataar me hai:
G Shift, A Shift, B Shift, Week Off, Leave, Work From Home.  Format user ki
Excel wali (2026-09-22): har kataar me logon ke card -- photo, naam, emp
code, contact number, designation.  Card ghaseet kar doosri kataar me.

Teen table
----------
  maintenance_attendance_staff  -- aadmi: naam, emp code, designation,
                                   contact, date of joining, removed_on
  maintenance_attendance_photo  -- photo ALAG table me (data URL, ~15 KB):
        * board ki list halki rahe -- photo browser ek hi baar laata hai,
          `photo_ver` badle tabhi dobara
        * AI assistant ka query tool ise nahi padh sakta (main.py ka
          _AI_BLOCKED_TABLES) -- warna ek `SELECT *` me 20 photo = ~300 KB
          base64 AI ke context me chala jaata
  maintenance_attendance_board  -- (day, staff_id) -> slot + pos

Din-wise, "aage chalta hai" niyam
---------------------------------
Din D par aadmi usi kataar me dikhta hai jo uski AAKHRI row (day <= D)
kehti hai.  Yaani aaj kisi ko Leave me daala to kal bhi Leave me dikhega jab
tak wapas na ghaseeto -- bilkul ek hi board jaisa.  Fayda: pichhle din ka
board dekh sakte hain, aur aage ke din ki planning bhi ho sakti hai.

  * Purani tareekh SIRF DEKHNE ke liye.  Wahan badlav aage ke dino (aaj
    tak) me bhi chala jaata -- ulajhan.  Isliye server hi rokta hai (400);
    sirf button chhupana kaafi nahi.
  * Ghaseetne par jin kataaron ka kram badla, un kataaron ke SAARE logon ki
    row us din likhi jaati hai -- to ek kataar ka kram hamesha ek hi din ki
    row se aata hai (alag-alag din ke `pos` aapas me nahi ulajhte).
  * Hatana: removed_on = us din se, pichhle dino ke board me wo dikhta rahe
    (itihaas).  Agar us din se pehle kabhi board par tha hi nahi (galti se
    joda) to poori tarah mita dete hain.

Permission: page key "maintenance-attendance" (top-level, parent nahi).
Padhna = read/full, likhna = full, admin hamesha.  Jaanch SERVER par --
isme contact number hain, sirf sidebar chhupana permission nahi hoti.

Endpoints (prefix /api/attendance)
----------------------------------
GET    /board?day=YYYY-MM-DD     us din ka board (photo ke bina)
PUT    /board                    {day, lanes:{slot:[ids]}} -- ghaseetne ke baad
GET    /photos?ids=1,2,3         {id: dataURL}
POST   /staff                    naya aadmi {..., slot, day}
PUT    /staff/{id}               details / photo / kataar badlo
DELETE /staff/{id}?day=          us din se hatao
"""
import re
from datetime import date
from typing import Optional

import psycopg2.extras
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from database import get_conn, dict_cursor
from auth import get_current_user

router = APIRouter(prefix="/api/attendance", tags=["attendance"])

PAGE_KEY = "maintenance-attendance"

# Kataar -- kram wahi jo board par (user ki Excel)
SLOTS = ("G", "A", "B", "WO", "LEAVE", "WFH")

# Browser photo ko 240px JPEG bana kar bhejta hai (~15 KB).  Ye sirf
# galat / bahut badi cheez rokne ki had hai.
PHOTO_MAX = 400_000

# Do supervisor ek saath ghaseetein to kram na bigde -- likhne wale kaam
# ek-ek karke (sirf is board ke liye, padhne par koi rok nahi).
_LOCK_KEY = 7_202_609

_bani = False


def _ensure() -> None:
    global _bani
    if _bani:
        return
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS maintenance_attendance_staff (
                id           SERIAL PRIMARY KEY,
                name         VARCHAR(120) NOT NULL,
                emp_code     VARCHAR(40),
                designation  VARCHAR(120),
                contact      VARCHAR(40),
                doj          DATE,
                removed_on   DATE,
                created_by   VARCHAR(120),
                created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
                updated_by   VARCHAR(120),
                updated_at   TIMESTAMP NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS maintenance_attendance_photo (
                staff_id    INTEGER PRIMARY KEY
                            REFERENCES maintenance_attendance_staff(id) ON DELETE CASCADE,
                photo       TEXT NOT NULL,
                updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS maintenance_attendance_board (
                day         DATE NOT NULL,
                staff_id    INTEGER NOT NULL
                            REFERENCES maintenance_attendance_staff(id) ON DELETE CASCADE,
                slot        VARCHAR(10) NOT NULL,
                pos         INTEGER NOT NULL DEFAULT 0,
                updated_by  VARCHAR(120),
                updated_at  TIMESTAMP NOT NULL DEFAULT NOW(),
                PRIMARY KEY (day, staff_id)
            )
        """)
        # "har aadmi ki aakhri row <= din" isi se tez
        cur.execute("CREATE INDEX IF NOT EXISTS ix_att_board_staff_day"
                    " ON maintenance_attendance_board (staff_id, day DESC)")
    _bani = True


# ── Permission ──────────────────────────────────────────────────────────
def _level(user: dict) -> str:
    """Is page par hak: 'full' | 'read' | 'none'.  Admin hamesha 'full'."""
    if (user.get("role") or "") == "admin":
        return "full"
    try:
        with get_conn() as conn:
            cur = conn.cursor()
            cur.execute("SELECT perm_level FROM maintenance_user_permissions"
                        " WHERE user_id = %s AND page_key = %s", (user["id"], PAGE_KEY))
            r = cur.fetchone()
    except Exception:
        return "none"
    lvl = r[0] if r else None
    return lvl if lvl in ("read", "full") else "none"


def _padh_sakta(user: dict) -> str:
    lvl = _level(user)
    if lvl == "none":
        raise HTTPException(403, "You do not have access to the Attendance Dashboard.")
    return lvl


def _likh_sakta(user: dict) -> None:
    if _level(user) != "full":
        raise HTTPException(403, "You have view-only access to the Attendance Dashboard.")


def _kaun(user: dict) -> str:
    return str(user.get("username") or user.get("full_name") or "user")[:120]


# ── Din ─────────────────────────────────────────────────────────────────
def _din(s: Optional[str]) -> date:
    if not s:
        return date.today()
    try:
        return date.fromisoformat(str(s)[:10])
    except ValueError:
        raise HTTPException(400, "Date must be YYYY-MM-DD.")


def _badal_sakte(d: date) -> None:
    if d < date.today():
        raise HTTPException(400, "Past dates are view-only.")


# ── Board padhna ────────────────────────────────────────────────────────
# Har aadmi ki aakhri row (day <= D).  Photo ka sirf updated_at -- asli
# photo (TEXT) yahan nahi padhi jaati.
_BOARD_SQL = """
    WITH aakhri AS (
        SELECT DISTINCT ON (b.staff_id)
               b.staff_id, b.slot, b.pos, b.updated_by, b.updated_at
          FROM maintenance_attendance_board b
         WHERE b.day <= %(d)s
         ORDER BY b.staff_id, b.day DESC
    )
    SELECT s.id, s.name, s.emp_code, s.designation, s.contact, s.doj,
           a.slot, a.pos, a.updated_by, a.updated_at,
           p.updated_at AS photo_at
      FROM aakhri a
      JOIN maintenance_attendance_staff s ON s.id = a.staff_id
      LEFT JOIN maintenance_attendance_photo p ON p.staff_id = s.id
     WHERE s.removed_on IS NULL OR s.removed_on > %(d)s
     ORDER BY a.pos, s.name, s.id
"""


def _board(cur, d: date) -> list:
    cur.execute(_BOARD_SQL, {"d": d})
    return cur.fetchall()


def _lanes(rows) -> dict:
    lanes = {k: [] for k in SLOTS}
    for r in rows:                              # pehle se pos ke kram me
        lanes[r["slot"] if r["slot"] in lanes else "G"].append(r["id"])
    return lanes


def _jawab(cur, d: date, lvl: str) -> dict:
    today = date.today()
    people, last = [], None
    for r in _board(cur, d):
        people.append({
            "id": r["id"],
            "name": r["name"],
            "emp_code": r["emp_code"] or "",
            "designation": r["designation"] or "",
            "contact": r["contact"] or "",
            "doj": r["doj"].isoformat() if r["doj"] else None,
            "slot": r["slot"] if r["slot"] in SLOTS else "G",
            "pos": r["pos"],
            "photo_ver": int(r["photo_at"].timestamp() * 1000) if r["photo_at"] else None,
        })
        if r["updated_at"] and (last is None or r["updated_at"] > last["updated_at"]):
            last = r
    return {
        "day": d.isoformat(),
        "today": today.isoformat(),
        "can_edit": lvl == "full",
        "editable": lvl == "full" and d >= today,
        "people": people,
        "last_change": ({"by": last["updated_by"], "at": last["updated_at"].isoformat()}
                        if last else None),
    }


def _likho(cur, d: date, lanes: dict, who: str) -> None:
    """Di hui kataaron ke SAARE logon ki row us din -- kram 0,1,2..."""
    rows = [(d, sid, slot, i, who)
            for slot, ids in lanes.items() for i, sid in enumerate(ids)]
    if not rows:
        return
    psycopg2.extras.execute_values(cur, """
        INSERT INTO maintenance_attendance_board (day, staff_id, slot, pos, updated_by)
        VALUES %s
        ON CONFLICT (day, staff_id) DO UPDATE
           SET slot = EXCLUDED.slot, pos = EXCLUDED.pos,
               updated_by = EXCLUDED.updated_by, updated_at = NOW()
    """, rows)


# ── Aadmi ki details ────────────────────────────────────────────────────
class StaffIn(BaseModel):
    name: str
    emp_code: Optional[str] = ""
    designation: Optional[str] = ""
    contact: Optional[str] = ""
    doj: Optional[str] = None            # YYYY-MM-DD
    photo: Optional[str] = None          # data:image/...;base64,...
    photo_change: bool = False           # PUT: photo badli / hatayi?  (POST par photo ho to lagti hai)
    slot: Optional[str] = None           # POST: kis kataar me.  PUT: di ho to wahan le jao
    day: Optional[str] = None            # kis din se (khaali = aaj)


def _saaf(b: StaffIn) -> dict:
    name = " ".join((b.name or "").split())
    if not name:
        raise HTTPException(400, "Name is required.")
    if len(name) > 120:
        raise HTTPException(400, "Name is too long (max 120 characters).")
    emp = " ".join((b.emp_code or "").split())
    if len(emp) > 40:
        raise HTTPException(400, "Emp code is too long (max 40 characters).")
    desig = " ".join((b.designation or "").split())
    if len(desig) > 120:
        raise HTTPException(400, "Designation is too long (max 120 characters).")
    contact = " ".join((b.contact or "").split())
    if contact and not re.fullmatch(r"[0-9+\-()/, ]{3,40}", contact):
        raise HTTPException(400, "Contact number can only have digits, spaces and + - ( ) / ,")
    doj = None
    if b.doj:
        try:
            doj = date.fromisoformat(str(b.doj)[:10])
        except ValueError:
            raise HTTPException(400, "Date of joining must be YYYY-MM-DD.")
        if doj.year < 1950:
            raise HTTPException(400, "Date of joining looks wrong.")
    photo = (b.photo or "").strip() or None
    if photo:
        if not re.match(r"data:image/(jpeg|png|webp);base64,", photo):
            raise HTTPException(400, "Photo must be a JPEG, PNG or WebP image.")
        if len(photo) > PHOTO_MAX:
            raise HTTPException(400, "Photo is too large.")
    return {"name": name, "emp_code": emp, "designation": desig,
            "contact": contact, "doj": doj, "photo": photo}


def _dohra(cur, emp: str, apna: Optional[int]) -> None:
    """Ek hi emp code do chalu logon par nahi (galti se do baar jodna)."""
    if not emp:
        return
    cur.execute("""
        SELECT name FROM maintenance_attendance_staff
         WHERE removed_on IS NULL AND lower(emp_code) = lower(%s)
           AND (%s::int IS NULL OR id <> %s::int)
         LIMIT 1
    """, (emp, apna, apna))
    r = cur.fetchone()
    if r:
        naam = r["name"] if isinstance(r, dict) else r[0]
        raise HTTPException(409, f"Emp code {emp} is already on the board ({naam}).")


def _slot(s: Optional[str]) -> str:
    s = (s or "G").strip().upper()
    if s not in SLOTS:
        raise HTTPException(400, f"Unknown row: {s}")
    return s


# ── Endpoints ───────────────────────────────────────────────────────────
@router.get("/board")
def get_board(day: Optional[str] = Query(None), user=Depends(get_current_user)):
    _ensure()
    lvl = _padh_sakta(user)
    d = _din(day)
    with get_conn() as conn:
        return _jawab(dict_cursor(conn), d, lvl)


class BoardIn(BaseModel):
    day: str
    lanes: dict[str, list[int]]


@router.put("/board")
def save_board(body: BoardIn, user=Depends(get_current_user)):
    _ensure()
    _likh_sakta(user)
    d = _din(body.day)
    _badal_sakte(d)
    bad = [k for k in body.lanes if k not in SLOTS]
    if bad:
        raise HTTPException(400, f"Unknown row: {', '.join(bad)}")
    diye = set()
    for ids in body.lanes.values():
        for i in ids:
            if i in diye:
                raise HTTPException(400, "The same person is listed twice.")
            diye.add(i)

    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT pg_advisory_xact_lock(%s)", (_LOCK_KEY,))
        rows = _board(cur, d)
        abhi = _lanes(rows)
        dikhe = {r["id"] for r in rows}
        naya = {}
        for slot, ids in body.lanes.items():
            # hataye gaye / anjaan id chhodo; aur kisi doosre ne isi beech
            # is kataar me koi daala ho jo is list me nahi -- use aakhir me
            # rakho, gayab mat karo
            naya[slot] = ([i for i in ids if i in dikhe]
                          + [i for i in abhi[slot] if i not in diye])
        _likho(cur, d, naya, _kaun(user))
    with get_conn() as conn:
        return _jawab(dict_cursor(conn), d, "full")


@router.get("/photos")
def get_photos(ids: str = Query(""), user=Depends(get_current_user)):
    _ensure()
    _padh_sakta(user)
    try:
        want = sorted({int(x) for x in ids.split(",") if x.strip()})[:300]
    except ValueError:
        raise HTTPException(400, "ids must be numbers.")
    if not want:
        return {}
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("SELECT staff_id, photo FROM maintenance_attendance_photo"
                    " WHERE staff_id = ANY(%s)", (want,))
        return {str(r[0]): r[1] for r in cur.fetchall()}


@router.post("/staff", status_code=201)
def add_staff(body: StaffIn, user=Depends(get_current_user)):
    _ensure()
    _likh_sakta(user)
    v = _saaf(body)
    d = _din(body.day)
    _badal_sakte(d)
    slot = _slot(body.slot)
    who = _kaun(user)
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT pg_advisory_xact_lock(%s)", (_LOCK_KEY,))
        _dohra(cur, v["emp_code"], None)
        cur.execute("""
            INSERT INTO maintenance_attendance_staff
                   (name, emp_code, designation, contact, doj, created_by, updated_by)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            RETURNING id
        """, (v["name"], v["emp_code"], v["designation"], v["contact"], v["doj"], who, who))
        sid = cur.fetchone()["id"]
        if v["photo"]:
            cur.execute("INSERT INTO maintenance_attendance_photo (staff_id, photo)"
                        " VALUES (%s, %s)", (sid, v["photo"]))
        lane = _lanes(_board(cur, d))[slot] + [sid]
        _likho(cur, d, {slot: lane}, who)
    return {"id": sid}


@router.put("/staff/{sid}")
def edit_staff(sid: int, body: StaffIn, user=Depends(get_current_user)):
    _ensure()
    _likh_sakta(user)
    v = _saaf(body)
    who = _kaun(user)
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT pg_advisory_xact_lock(%s)", (_LOCK_KEY,))
        cur.execute("SELECT removed_on FROM maintenance_attendance_staff WHERE id = %s", (sid,))
        r = cur.fetchone()
        if not r:
            raise HTTPException(404, "Person not found.")
        if r["removed_on"] is not None:
            raise HTTPException(400, "This person has been removed from the board.")
        _dohra(cur, v["emp_code"], sid)
        cur.execute("""
            UPDATE maintenance_attendance_staff
               SET name = %s, emp_code = %s, designation = %s, contact = %s, doj = %s,
                   updated_by = %s, updated_at = NOW()
             WHERE id = %s
        """, (v["name"], v["emp_code"], v["designation"], v["contact"], v["doj"], who, sid))
        if body.photo_change:
            if v["photo"]:
                cur.execute("""
                    INSERT INTO maintenance_attendance_photo (staff_id, photo) VALUES (%s, %s)
                    ON CONFLICT (staff_id) DO UPDATE
                       SET photo = EXCLUDED.photo, updated_at = NOW()
                """, (sid, v["photo"]))
            else:
                cur.execute("DELETE FROM maintenance_attendance_photo WHERE staff_id = %s", (sid,))
        if body.slot:
            slot = _slot(body.slot)
            d = _din(body.day)
            _badal_sakte(d)
            lanes = _lanes(_board(cur, d))
            abhi = next((k for k, ids in lanes.items() if sid in ids), None)
            if abhi is None:
                raise HTTPException(400, "This person is not on the board for that date.")
            if abhi != slot:
                lanes[abhi].remove(sid)
                lanes[slot].append(sid)
                _likho(cur, d, {abhi: lanes[abhi], slot: lanes[slot]}, who)
    return {"ok": True}


@router.delete("/staff/{sid}")
def remove_staff(sid: int, day: Optional[str] = Query(None), user=Depends(get_current_user)):
    _ensure()
    _likh_sakta(user)
    d = _din(day)
    _badal_sakte(d)
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("SELECT pg_advisory_xact_lock(%s)", (_LOCK_KEY,))
        cur.execute("SELECT removed_on FROM maintenance_attendance_staff WHERE id = %s", (sid,))
        r = cur.fetchone()
        if not r:
            raise HTTPException(404, "Person not found.")
        if r[0] is not None:
            return {"ok": True, "mode": "removed"}
        cur.execute("SELECT 1 FROM maintenance_attendance_board"
                    " WHERE staff_id = %s AND day < %s LIMIT 1", (sid, d))
        if cur.fetchone():
            # pehle ke din ka itihaas bache -- sirf is din se aage se hatao
            cur.execute("""
                UPDATE maintenance_attendance_staff
                   SET removed_on = %s, updated_by = %s, updated_at = NOW()
                 WHERE id = %s
            """, (d, _kaun(user), sid))
            cur.execute("DELETE FROM maintenance_attendance_board"
                        " WHERE staff_id = %s AND day >= %s", (sid, d))
            mode = "removed"
        else:
            # kabhi kisi pichhle din par tha hi nahi -- galti se joda; poora mitao
            # (photo aur board ki row ON DELETE CASCADE se)
            cur.execute("DELETE FROM maintenance_attendance_staff WHERE id = %s", (sid,))
            mode = "deleted"
    return {"ok": True, "mode": mode}
