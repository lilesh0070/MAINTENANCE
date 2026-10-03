"""
routers/attendance.py
=====================
Attendance Dashboard (sidebar) -- kaun aadmi kis din kis kataar me hai:
G Shift, A Shift, B Shift, Week Off, Leave, Work From Home.  Format user ki
Excel wali (2026-09-22): har kataar me logon ke card -- photo, naam, emp
code, contact number, designation.  Card ghaseet kar doosri kataar me.

Teen table
----------
  maintenance_employee          -- aadmi: naam, emp code, designation,
                                   contact, date of joining, removed_on
                                   (naam user ne diya 2026-09-22; pehle
                                   maintenance_attendance_staff tha --
                                   _purane_naam_badlo() khud badal deta hai)
  maintenance_employee_photo    -- photo ALAG table me (data URL, ~15 KB):
        * board ki list halki rahe -- photo browser ek hi baar laata hai,
          `photo_ver` badle tabhi dobara
        * AI assistant ka query tool ise nahi padh sakta (main.py ka
          _AI_BLOCKED_TABLES) -- warna ek `SELECT *` me 20 photo = ~300 KB
          base64 AI ke context me chala jaata
  maintenance_attendance_board  -- (day, staff_id) -> slot + pos
  maintenance_attendance_log    -- (2026-09-26) har badlav ki ek line: kisne,
                                   kab, kise, kis kataar se kis me (History ka
                                   "Changes").  Sirf jodte hain, kabhi badalte nahi.

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
  read / full  -> board + saare members dekhna
  full         -> shift badalna (ghaseetna)
  SIRF ADMIN   -> member jodna / badalna / hatana (user 2026-09-22: "add
                  member admin hi kar sake ... admin delete aur change kar sake")
Jaanch SERVER par -- isme contact number hain, sirf button chhupana
permission nahi hoti.

Endpoints (prefix /api/attendance)
----------------------------------
GET    /app-users                app ke user (id/username/emp code/designation/on_board) -- Add Member ke liye (admin)
GET    /on-duty                  dono shift ke log (abhi wali upar, hierarchy kram) -- SIRF NAAM (dashboard)
GET    /board?day=YYYY-MM-DD     us din ka board (photo ke bina)
PUT    /board                    {day, lanes:{slot:[ids]}} -- ghaseetne ke baad
GET    /photos?ids=1,2,3         {id: dataURL}
GET    /members                  saare chalu member (aaj ki kataar ke saath)
GET    /history?start=&end=      History: har aadmi x har din ki kataar + ginti + badlav
POST   /staff                    naya aadmi {..., slot, day}        (admin)
PUT    /staff/{id}               details / photo / kataar badlo     (admin)
DELETE /staff/{id}?day=          us din se hatao                    (admin)

Leave (2026-10-03) -- neeche "LEAVE" wala hissa (board ki page-permission NAHI; haq pad se)
GET    /leave?start=&end=&status=&staff_id=   {pending, rows (record), me, people, ...}
POST   /leave                    nayi arzi {staff_id, from_date, to_date, reason}   (apne naam ki; maint/admin kisi ki)
POST   /leave/{id}/approve       {from_date?, to_date?, note?}      (us pad ka approver)
PUT    /leave/{id}               date badlo {from_date, to_date}    (us pad ka approver)
POST   /leave/{id}/reject        {note?}                            (us pad ka approver)
POST   /leave/{id}/cancel        PENDING arzi wapas (jiski / jisne bhari / approver)
DELETE /leave/{id}               row mitao                          (SIRF admin; audit me naqal)
"""
import re
from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Optional

import psycopg2.extras
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from database import get_conn, dict_cursor
from auth import get_current_user
from routers.users import role_label_sql

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


def _purane_naam_badlo(cur) -> None:
    """2026-09-22 user: "attendance wali table maintenance employee ke naam se".
    Pehle (kuch hi ghante, deploy se pehle) naam maintenance_attendance_staff
    / _photo tha, aur usme user ka joda hua data bhi hai -- isliye MITAO MAT,
    NAAM BADLO.  Constraint (pkey ke saath uska index bhi) aur sequence ke naam
    bhi naye, taaki DB me purana naam na dikhe.  Dobara chale to kuch nahi."""
    def hai(rel):
        cur.execute("SELECT to_regclass(%s) IS NOT NULL", (rel,))
        return cur.fetchone()[0]

    for old, new in (("maintenance_attendance_staff", "maintenance_employee"),
                     ("maintenance_attendance_photo", "maintenance_employee_photo")):
        if not hai(old) or hai(new):
            continue
        cur.execute(f"ALTER TABLE {old} RENAME TO {new}")
        cur.execute("SELECT conname FROM pg_constraint WHERE conrelid = %s::regclass", (new,))
        for (cn,) in cur.fetchall():
            if not cn.startswith(old + "_"):
                continue
            # sirf naam ki baat hai -- koi ek na badle to baaki kaam na ruke
            cur.execute("SAVEPOINT naam")
            try:
                cur.execute(f'ALTER TABLE {new} RENAME CONSTRAINT "{cn}" TO "{new}{cn[len(old):]}"')
                cur.execute("RELEASE SAVEPOINT naam")
            except Exception:
                cur.execute("ROLLBACK TO SAVEPOINT naam")
    if hai("maintenance_attendance_staff_id_seq") and not hai("maintenance_employee_id_seq"):
        cur.execute("ALTER SEQUENCE maintenance_attendance_staff_id_seq RENAME TO maintenance_employee_id_seq")


def _ensure() -> None:
    global _bani
    if _bani:
        return
    with get_conn() as conn:
        cur = conn.cursor()
        _purane_naam_badlo(cur)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS maintenance_employee (
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
            CREATE TABLE IF NOT EXISTS maintenance_employee_photo (
                staff_id    INTEGER PRIMARY KEY
                            REFERENCES maintenance_employee(id) ON DELETE CASCADE,
                photo       TEXT NOT NULL,
                updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS maintenance_attendance_board (
                day         DATE NOT NULL,
                staff_id    INTEGER NOT NULL
                            REFERENCES maintenance_employee(id) ON DELETE CASCADE,
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
        # Badlav ka log (History -> Changes) -- upar `_log` ki tippani.
        # staff_id par FK jaan-boojh kar NAHI: aadmi mite to bhi itihaas rahe
        # (naam / emp code ki naqal saath me).
        cur.execute("""
            CREATE TABLE IF NOT EXISTS maintenance_attendance_log (
                id          BIGSERIAL PRIMARY KEY,
                at          TIMESTAMP NOT NULL DEFAULT NOW(),
                by_user     VARCHAR(120),
                day         DATE NOT NULL,
                staff_id    INTEGER,
                staff_name  VARCHAR(120),
                emp_code    VARCHAR(40),
                action      VARCHAR(12) NOT NULL,
                from_slot   VARCHAR(10),
                to_slot     VARCHAR(10),
                detail      VARCHAR(300)
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_att_log_day"
                    " ON maintenance_attendance_log (day)")
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


def _admin_hai(user: dict) -> bool:
    return (user.get("role") or "") == "admin"


def _sirf_admin(user: dict) -> None:
    """Member jodna / badalna / hatana SIRF admin (user 2026-09-22).  Shift
    badalna (ghaseetna) full wale bhi kar sakte hain -- wo _likh_sakta."""
    if not _admin_hai(user):
        raise HTTPException(403, "Only admin can add, edit or remove members.")


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


# ── Designation: app user se juda aadmi ─────────────────────────────────
# User 2026-09-25: "Add Member me designation nahi aati -- jo hamne wahan
# (Admin -> Users) define kar rakhi hai wo aa jaye, aur change bhi na ho."
# Isliye jo aadmi kisi app user se juda hai (sirf EMP CODE se -- attendance
# aur app user ka yahi ek rishta hai), uski designation HAR BAAR us user ke
# role ka naam hoti hai (ROLE_LABELS, routers/users.py) -- yahan save wali
# nahi.  Admin role badle to board par apne aap badal jaati hai.  Juda nahi,
# ya role anjaan -> jo yahan save hai wahi.
# LATERAL + LIMIT 1: ek emp code do user par ho bhi jaaye to qatar dohri na ho.
_JUDA_USER = """
      LEFT JOIN LATERAL (
            SELECT ju.role FROM maintenance_users ju
             WHERE COALESCE(TRIM(s.emp_code), '') <> ''
               AND UPPER(TRIM(ju.emp_code)) = UPPER(TRIM(s.emp_code))
             ORDER BY ju.id LIMIT 1
      ) ju ON TRUE"""
_DESIG = f"COALESCE({role_label_sql('ju.role')}, s.designation) AS designation"

# ── Hierarchy (user 2026-10-03) ─────────────────────────────────────────
# "attendance me hierarchy ke hisaab se naam aaye upar se neeche -- main
# dashboard me shift ke hisaab se, aur attendance panel me bhi."  Kram (user
# ne baad me theek kiya -- "supervisor pehle aana tha, DET baad me"):
# Manager, Deputy Manager, Assistant Manager, Senior Engineer, Engineer,
# Supervisor, DET; anjaan sabse neeche.  Board ki ek kataar ke andar pehle ye kram,
# phir ghaseeta hua (`pos`) -- yaani ek hi pad ke log apas me ghaseet kar
# aage-peeche ho sakte hain.  Leave ki manzoori bhi isi pad se (neeche LEAVE).
# Pad = juda app user ka ROLE (emp code se); juda nahi to save ki hui
# designation ka naam ("Senior Engineer" -> senior_engineer).
_RANK = {"senior_manager": 0, "manager": 1, "deputy_manager": 2, "assistant_manager": 3,
         "senior_engineer": 4, "engineer": 5, "supervisor": 6, "det": 7}
_RANK_BAAKI = 9


def _pad(role: Optional[str], desig: Optional[str] = None) -> str:
    """Role (ya designation) se pad ki kunji -- anjaan ho to ''."""
    r = (role or "").strip().lower()
    if r in _RANK:
        return r
    d = re.sub(r"[^a-z]+", "_", (desig or "").strip().lower()).strip("_")
    return d if d in _RANK else ""


def _rank(role: Optional[str], desig: Optional[str] = None) -> int:
    return _RANK.get(_pad(role, desig), _RANK_BAAKI)


# ── Board padhna ────────────────────────────────────────────────────────
# Har aadmi ki aakhri row (day <= D).  Photo ka sirf updated_at -- asli
# photo (TEXT) yahan nahi padhi jaati.
_BOARD_SQL = f"""
    WITH aakhri AS (
        SELECT DISTINCT ON (b.staff_id)
               b.staff_id, b.slot, b.pos, b.updated_by, b.updated_at
          FROM maintenance_attendance_board b
         WHERE b.day <= %(d)s
         ORDER BY b.staff_id, b.day DESC
    )
    SELECT s.id, s.name, s.emp_code, {_DESIG}, ju.role AS juda_role, s.contact, s.doj,
           a.slot, a.pos, a.updated_by, a.updated_at,
           p.updated_at AS photo_at
      FROM aakhri a
      JOIN maintenance_employee s ON s.id = a.staff_id
      LEFT JOIN maintenance_employee_photo p ON p.staff_id = s.id{_JUDA_USER}
     WHERE s.removed_on IS NULL OR s.removed_on > %(d)s
     ORDER BY a.pos, s.name, s.id
"""


def _board(cur, d: date) -> list:
    """Us din ka board -- kram: pad (hierarchy), phir ghaseeta hua `pos`, phir naam."""
    cur.execute(_BOARD_SQL, {"d": d})
    rows = cur.fetchall()
    rows.sort(key=lambda r: (_rank(r["juda_role"], r["designation"]), r["pos"] or 0,
                             (r["name"] or "").lower(), r["id"]))
    return rows


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
            "rank": _rank(r["juda_role"], r["designation"]),
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


# ── Badlav ka log ───────────────────────────────────────────────────────
# User 2026-09-26: "attendance dashboard me history ka option ... jisme sab ho".
# Board ki table har din ka sirf AAKHRI haal rakhti hai, aur uska `updated_by`
# us din kataar ko aakhri baar chhoone wale ka ho jaata hai (kram badalne par
# poori kataar dobara likhi jaati hai) -- "kisne kab kya badla" usse pakka nahi
# milta.  Isliye ab se har badlav ek line yahan: move / add / remove / delete /
# edit.  Pehle ke dino ka hisaab board ki rows se nikalta hai (`_hist_*`).
def _log(cur, who: str, items: list) -> None:
    """items: [{day, id, name, emp_code, action, from, to, detail}].
    SAVEPOINT ke andar -- log na likh paaye to bhi asli kaam (board / member)
    NA ruke; bas server log me ek line."""
    if not items:
        return
    try:
        cur.execute("SAVEPOINT att_log")
    except Exception as ex:
        print(f"[ATTENDANCE] log nahi likha: {ex}")
        return
    try:
        psycopg2.extras.execute_values(cur, """
            INSERT INTO maintenance_attendance_log
                   (by_user, day, staff_id, staff_name, emp_code, action, from_slot, to_slot, detail)
            VALUES %s
        """, [(who, i["day"], i.get("id"), (i.get("name") or "")[:120] or None,
               (i.get("emp_code") or "")[:40] or None, i["action"], i.get("from"), i.get("to"),
               (i.get("detail") or "")[:300] or None) for i in items])
        cur.execute("RELEASE SAVEPOINT att_log")
    except Exception as ex:
        try:
            cur.execute("ROLLBACK TO SAVEPOINT att_log")
        except Exception:
            pass
        print(f"[ATTENDANCE] log nahi likha: {ex}")


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
        SELECT name FROM maintenance_employee
         WHERE removed_on IS NULL AND lower(emp_code) = lower(%s)
           AND (%s::int IS NULL OR id <> %s::int)
         LIMIT 1
    """, (emp, apna, apna))
    r = cur.fetchone()
    if r:
        naam = r["name"] if isinstance(r, dict) else r[0]
        raise HTTPException(409, f"Emp code {emp} is already on the board ({naam}).")


def _juda_desig(cur, emp: str) -> Optional[str]:
    """Emp code kisi app user se juda ho to uske role ka naam, warna None.
    Add/Edit me SERVER bhi yahi save karta hai -- form (ya purani APK, jiska
    khaana abhi khula hai) kuch aur bheje to bhi.  Warna board to role hi
    dikhata, par table ki naqal (AI / report yahi padhte hain) alag ho jaati."""
    if not emp:
        return None
    cur.execute(f"""
        SELECT {role_label_sql('u.role')} AS d FROM maintenance_users u
         WHERE UPPER(TRIM(u.emp_code)) = UPPER(TRIM(%s))
         ORDER BY u.id LIMIT 1
    """, (emp,))
    r = cur.fetchone()
    if not r:
        return None
    return r["d"] if isinstance(r, dict) else r[0]


def _slot(s: Optional[str]) -> str:
    s = (s or "G").strip().upper()
    if s not in SLOTS:
        raise HTTPException(400, f"Unknown row: {s}")
    return s


def _norm_slot(s: Optional[str]) -> str:
    """DB me anjaan kataar ho to G -- board (`_lanes`) bhi yahi karta hai."""
    return s if s in SLOTS else "G"


# Edit ke log me kaunse khaane (sirf naam jaata hai, value nahi)
_EDIT_FIELDS = (("name", "Name"), ("emp_code", "Emp code"), ("designation", "Designation"),
                ("contact", "Contact"), ("doj", "Date of joining"))


# ── Endpoints ───────────────────────────────────────────────────────────
# ── Add Member ke liye app ke user ──────────────────────────────────────
# User 2026-09-23: "user banate waqt Employee ID zaroori, phir Attendance ke
# Add Member me wahin se utha lenge."  Isliye ye chhoti list -- SIRF id,
# username aur emp code.  `/api/users/` jaan-boojh kar nahi bulate: wo password
# bhi lautaata hai, aur use is page par laane ki koi zaroorat nahi.
@router.get("/app-users")
def app_users(user=Depends(get_current_user)):
    """App ke user, Add Member ke picker ke liye.  Sirf admin (member jodna bhi
    sirf admin ka kaam hai)."""
    if not _admin_hai(user):
        raise HTTPException(403, "Only admin can add members.")
    _ensure()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("ALTER TABLE maintenance_users ADD COLUMN IF NOT EXISTS emp_code VARCHAR(40)")
        # `designation` = role ka dikhne wala naam (Admin -> Users wala) --
        # form me wahi bharti hai aur badli nahi ja sakti.
        # `on_board` = is emp code ka chalu aadmi board par pehle se hai ->
        # Add Member ki list me dobara nahi dikhta (user 2026-09-25).  Edit
        # form ko poori list chahiye (designation milane ke liye), isliye
        # chhantna frontend karta hai, yahan sirf nishaan.
        cur.execute(f"""
            SELECT u.id, u.username, COALESCE(u.full_name, '') AS full_name,
                   COALESCE(u.emp_code, '') AS emp_code, u.role,
                   COALESCE({role_label_sql('u.role')}, '') AS designation,
                   EXISTS (SELECT 1 FROM maintenance_employee e
                            WHERE e.removed_on IS NULL
                              AND COALESCE(TRIM(u.emp_code), '') <> ''
                              AND UPPER(TRIM(e.emp_code)) = UPPER(TRIM(u.emp_code))) AS on_board
              FROM maintenance_users u
             WHERE COALESCE(u.is_active, TRUE)
             ORDER BY u.username""")
        return {"users": cur.fetchall()}


# ── Abhi duty par kaun ──────────────────────────────────────────────────
# Maintenance Dashboard ke daayin taraf wale khaane ke liye (user 2026-09-23):
#     subah 7 se shaam 6       ->  G aur A shift wale
#     shaam 6 se agli subah 7  ->  B shift wale
# Waqt SERVER ka lagta hai, TV/phone ka nahi -- warna har screen apni ghadi se
# alag jawab deti.  Raat 12 se subah 7 wali duty PICHHLE din ke board ki hai,
# isliye us khidki me din ek peeche kar dete hain (wahi "plant day" wali soch
# jo ANDON ke Today card me hai).
#
# User 2026-10-03: "A shift chal rahi hai to sirf A ki aa rahi hai -- A aur B
# dono ki aani chahiye; B me bhi dono, bas shift ke hisaab se upar-neeche."
# Isliye `groups`: abhi wali shift UPAR, doosri neeche; har group me log
# hierarchy ke kram me (`_board`).  `shift` / `slots` / `people` / `count`
# pehle jaise (sirf abhi wali shift) -- purani APK yahi padhti hai.
#
# ⚠ Yahan page-permission JAAN-BOOJH KAR nahi maangi jaati: jawab me sirf naam,
#   emp code, designation aur shift jaate hain -- contact number, photo aur
#   date-of-joining kuch NAHI.  Attendance Dashboard (jisme wo sab hai) par rok
#   bilkul pehle jaisi hai.  Yahan kuch aur khaana jodna ho to pehle ye soch
#   lena.
DUTY_DIN_SE, DUTY_RAAT_SE = 7, 18          # ghante (24 wali ghadi)


@router.get("/on-duty")
def on_duty(user=Depends(get_current_user)):
    """Abhi jo shift chal rahi hai uske logon ke naam."""
    _ensure()
    ab = datetime.now()
    din = ab.date()
    if DUTY_DIN_SE <= ab.hour < DUTY_RAAT_SE:
        slots, label = ("G", "A"), "G + A"
    else:
        slots, label = ("B",), "B"
        if ab.hour < DUTY_DIN_SE:           # aadhi raat ke baad = kal ki raat
            din = din - timedelta(days=1)
    with get_conn() as conn:
        rows = _board(dict_cursor(conn), din)

    def kaun(sl):
        return [{"id": r["id"], "name": r["name"], "emp_code": r["emp_code"] or "",
                 "designation": r["designation"] or "",
                 "slot": _norm_slot(r["slot"]),
                 "rank": _rank(r["juda_role"], r["designation"])}
                for r in rows if _norm_slot(r["slot"]) in sl]

    din_wale, raat_wale = ("G", "A"), ("B",)
    groups = [{"shift": "G + A", "slots": list(din_wale), "people": kaun(din_wale)},
              {"shift": "B", "slots": list(raat_wale), "people": kaun(raat_wale)}]
    if slots == raat_wale:
        groups.reverse()
    for i, g in enumerate(groups):
        g["now"] = i == 0
        g["count"] = len(g["people"])
    log = groups[0]["people"]
    return {"shift": label, "slots": list(slots), "day": din.isoformat(),
            "now": ab.strftime("%H:%M"), "count": len(log), "people": log,
            "groups": groups, "total": sum(g["count"] for g in groups)}


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
        # log me SIRF jinki kataar badli -- kram badalna (usi kataar me aage-
        # peeche) badlav nahi
        pehle = {r["id"]: r for r in rows}
        _log(cur, _kaun(user), [
            {"day": d, "id": i, "name": pehle[i]["name"], "emp_code": pehle[i]["emp_code"],
             "action": "move", "from": _norm_slot(pehle[i]["slot"]), "to": slot}
            for slot, ids in naya.items() for i in ids
            if i in pehle and _norm_slot(pehle[i]["slot"]) != slot])
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
        cur.execute("SELECT staff_id, photo FROM maintenance_employee_photo"
                    " WHERE staff_id = ANY(%s)", (want,))
        return {str(r[0]): r[1] for r in cur.fetchall()}


@router.get("/members")
def get_members(user=Depends(get_current_user)):
    """Saare CHALU member (hataye gaye nahi) -- "All Members" panel.  `slot` =
    aaj ki kataar; aage ki tareekh se jude ho to None + `from_day`."""
    _ensure()
    _padh_sakta(user)
    today = date.today()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute(f"""
            WITH aaj AS (
                SELECT DISTINCT ON (b.staff_id) b.staff_id, b.slot
                  FROM maintenance_attendance_board b
                 WHERE b.day <= %(d)s
                 ORDER BY b.staff_id, b.day DESC
            ), pehla AS (
                SELECT staff_id, MIN(day) AS from_day
                  FROM maintenance_attendance_board GROUP BY staff_id
            )
            SELECT s.id, s.name, s.emp_code, {_DESIG}, ju.role AS juda_role, s.contact, s.doj,
                   a.slot, f.from_day, p.updated_at AS photo_at
              FROM maintenance_employee s
              LEFT JOIN aaj a   ON a.staff_id = s.id
              LEFT JOIN pehla f ON f.staff_id = s.id
              LEFT JOIN maintenance_employee_photo p ON p.staff_id = s.id{_JUDA_USER}
             WHERE s.removed_on IS NULL
             ORDER BY lower(s.name), s.id
        """, {"d": today})
        rows = cur.fetchall()
    # hierarchy ke kram me (2026-10-03), phir naam
    rows.sort(key=lambda r: (_rank(r["juda_role"], r["designation"]), (r["name"] or "").lower(), r["id"]))
    return {
        "today": today.isoformat(),
        "is_admin": _admin_hai(user),
        "members": [{
            "id": r["id"],
            "name": r["name"],
            "emp_code": r["emp_code"] or "",
            "designation": r["designation"] or "",
            "contact": r["contact"] or "",
            "doj": r["doj"].isoformat() if r["doj"] else None,
            "slot": r["slot"] if r["slot"] in SLOTS else None,
            "from_day": r["from_day"].isoformat() if r["from_day"] else None,
            "rank": _rank(r["juda_role"], r["designation"]),
            "photo_ver": int(r["photo_at"].timestamp() * 1000) if r["photo_at"] else None,
        } for r in rows],
    }


@router.post("/staff", status_code=201)
def add_staff(body: StaffIn, user=Depends(get_current_user)):
    _ensure()
    _sirf_admin(user)
    v = _saaf(body)
    d = _din(body.day)
    _badal_sakte(d)
    slot = _slot(body.slot)
    who = _kaun(user)
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT pg_advisory_xact_lock(%s)", (_LOCK_KEY,))
        _dohra(cur, v["emp_code"], None)
        v["designation"] = _juda_desig(cur, v["emp_code"]) or v["designation"]
        cur.execute("""
            INSERT INTO maintenance_employee
                   (name, emp_code, designation, contact, doj, created_by, updated_by)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            RETURNING id
        """, (v["name"], v["emp_code"], v["designation"], v["contact"], v["doj"], who, who))
        sid = cur.fetchone()["id"]
        if v["photo"]:
            cur.execute("INSERT INTO maintenance_employee_photo (staff_id, photo)"
                        " VALUES (%s, %s)", (sid, v["photo"]))
        lane = _lanes(_board(cur, d))[slot] + [sid]
        _likho(cur, d, {slot: lane}, who)
        _log(cur, who, [{"day": d, "id": sid, "name": v["name"], "emp_code": v["emp_code"],
                         "action": "add", "to": slot}])
    return {"id": sid}


@router.put("/staff/{sid}")
def edit_staff(sid: int, body: StaffIn, user=Depends(get_current_user)):
    _ensure()
    _sirf_admin(user)
    v = _saaf(body)
    who = _kaun(user)
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT pg_advisory_xact_lock(%s)", (_LOCK_KEY,))
        cur.execute("SELECT removed_on, name, emp_code, designation, contact, doj"
                    " FROM maintenance_employee WHERE id = %s", (sid,))
        r = cur.fetchone()
        if not r:
            raise HTTPException(404, "Person not found.")
        if r["removed_on"] is not None:
            raise HTTPException(400, "This person has been removed from the board.")
        _dohra(cur, v["emp_code"], sid)
        v["designation"] = _juda_desig(cur, v["emp_code"]) or v["designation"]
        cur.execute("""
            UPDATE maintenance_employee
               SET name = %s, emp_code = %s, designation = %s, contact = %s, doj = %s,
                   updated_by = %s, updated_at = NOW()
             WHERE id = %s
        """, (v["name"], v["emp_code"], v["designation"], v["contact"], v["doj"], who, sid))
        # log: kaunse khaane badle -- sirf NAAM, value nahi (contact number
        # log me na jaaye)
        badla = [lbl for k, lbl in _EDIT_FIELDS if (r[k] or None) != (v[k] or None)]
        if body.photo_change:
            badla.append("Photo")
        logs = []
        if badla:
            logs.append({"day": date.today(), "id": sid, "name": v["name"], "emp_code": v["emp_code"],
                         "action": "edit", "detail": ", ".join(badla)})
        if body.photo_change:
            if v["photo"]:
                cur.execute("""
                    INSERT INTO maintenance_employee_photo (staff_id, photo) VALUES (%s, %s)
                    ON CONFLICT (staff_id) DO UPDATE
                       SET photo = EXCLUDED.photo, updated_at = NOW()
                """, (sid, v["photo"]))
            else:
                cur.execute("DELETE FROM maintenance_employee_photo WHERE staff_id = %s", (sid,))
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
                logs.append({"day": d, "id": sid, "name": v["name"], "emp_code": v["emp_code"],
                             "action": "move", "from": abhi, "to": slot})
        _log(cur, who, logs)
    return {"ok": True}


@router.delete("/staff/{sid}")
def remove_staff(sid: int, day: Optional[str] = Query(None), user=Depends(get_current_user)):
    _ensure()
    _sirf_admin(user)
    d = _din(day)
    _badal_sakte(d)
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("SELECT pg_advisory_xact_lock(%s)", (_LOCK_KEY,))
        cur.execute("SELECT removed_on, name, emp_code FROM maintenance_employee WHERE id = %s", (sid,))
        r = cur.fetchone()
        if not r:
            raise HTTPException(404, "Person not found.")
        if r[0] is not None:
            return {"ok": True, "mode": "removed"}
        # log ke liye: us din kis kataar me tha
        cur.execute("SELECT slot FROM maintenance_attendance_board"
                    " WHERE staff_id = %s AND day <= %s ORDER BY day DESC LIMIT 1", (sid, d))
        tha = cur.fetchone()
        tha = _norm_slot(tha[0]) if tha else None
        cur.execute("SELECT 1 FROM maintenance_attendance_board"
                    " WHERE staff_id = %s AND day < %s LIMIT 1", (sid, d))
        if cur.fetchone():
            # pehle ke din ka itihaas bache -- sirf is din se aage se hatao
            cur.execute("""
                UPDATE maintenance_employee
                   SET removed_on = %s, updated_by = %s, updated_at = NOW()
                 WHERE id = %s
            """, (d, _kaun(user), sid))
            cur.execute("DELETE FROM maintenance_attendance_board"
                        " WHERE staff_id = %s AND day >= %s", (sid, d))
            mode = "removed"
        else:
            # kabhi kisi pichhle din par tha hi nahi -- galti se joda; poora mitao
            # (photo aur board ki row ON DELETE CASCADE se)
            cur.execute("DELETE FROM maintenance_employee WHERE id = %s", (sid,))
            mode = "deleted"
        _log(cur, _kaun(user), [{"day": d, "id": sid, "name": r[1], "emp_code": r[2],
                                 "action": "remove" if mode == "removed" else "delete", "from": tha}])
    return {"ok": True, "mode": mode}


# ── History (user 2026-09-26: "history ka option ... jisme sab ho") ─────
# Register: har aadmi x har din ki kataar -- board wala hi "aage chalta hai"
# niyam (din D par aakhri row <= D; removed_on se hata), aakhir me ginti, aur
# har din kitne duty par.  Changes: kisne kab kya badla.
#
# EK AADMI = EK QATAR, EMP CODE se (TRIM + UPPER): 23-Sep ko purane record hata
# kar wahi log naye record se jode gaye (id alag, emp code wahi) -- id se qatar
# banti to ek aadmi do qatar me bant jaata.  Emp code khaali -> record ki id.
# Ek din ek hi emp code ke do record hon (`_dohra` hone nahi deta) to naya
# (badi id) jeetta hai.
#
# Changes do jagah se:
#   * maintenance_attendance_log -- ab se, har badlav, sahi kisne / kab
#   * usse PEHLE ke: board ki rows se (`_hist_changes`) -- har din ka AAKHRI
#     haal; "kisne" = us din row aakhri baar likhne wala (upar `_log` dekho)
# Ginti sirf AAJ tak (aage ke din "planned" -- dikhte hain, ginte nahi).
HIST_MAX_DAYS = 93          # ek baar me itne din (~3 mahine) -- grid aur jawab halke
_ON_DUTY = ("G", "A", "B")  # board ke "On duty" jaisa


def _hist_timeline(days, carry, rows, removed_on):
    """Ek RECORD ka har din: [(slot | None, us din ki row | None)].
    days[0] = start se ek din pehle (pehle din ka badlav pakadne ke liye);
    carry = days[0] tak ki aakhri row; rows = {day: row} (start..end)."""
    slot = _norm_slot(carry["slot"]) if carry else None
    out = []
    for d in days:
        r = rows.get(d)
        if r is not None:
            slot = _norm_slot(r["slot"])
        on = slot is not None and (removed_on is None or removed_on > d)
        out.append((slot if on else None, r))
    return out


def _hist_key(rec) -> str:
    emp = (rec.get("emp_code") or "").strip().upper()
    return f"E:{emp}" if emp else f"I:{rec['id']}"


def _hist_merge(recs, lines):
    """Ek aadmi ke saare record (NAYA PEHLE) -> har din (slot, record, row)."""
    n = len(lines[recs[0]["id"]])
    out = []
    for i in range(n):
        got = (None, None, None)
        for rec in recs:
            s, row = lines[rec["id"]][i]
            if s is not None:
                got = (s, rec, row)
                break
        out.append(got)
    return out


def _hist_changes(days, merged, name, emp):
    """Board ki rows se nikale badlav (log shuru hone se pehle ke liye)."""
    ev = []
    prev = merged[0]
    for i in range(1, len(days)):
        cur = merged[i]
        if cur[0] != prev[0]:
            if cur[0] is not None:
                row = cur[2]
                ev.append({"day": days[i], "action": "add" if prev[0] is None else "move",
                           "from": prev[0], "to": cur[0],
                           "by": row["updated_by"] if row else None,
                           "at": row["updated_at"] if row else None})
            else:
                # pichhle din wala record isi din hataya gaya (removed_on) --
                # hataane wale ka naam / waqt usi record par
                rec = prev[1]
                ev.append({"day": days[i], "action": "remove", "from": prev[0], "to": None,
                           "by": rec.get("updated_by"), "at": rec.get("updated_at")})
            ev[-1].update(name=name, emp_code=emp, detail=None, source="board")
        prev = cur
    return ev


def _iso(v):
    return v.isoformat(timespec="seconds") if isinstance(v, datetime) else (v.isoformat() if v else None)


@router.get("/history")
def history(start: Optional[str] = Query(None), end: Optional[str] = Query(None),
            user=Depends(get_current_user)):
    """History: start..end (khaali = is mahine ki 1 tareekh se aaj tak)."""
    _ensure()
    _padh_sakta(user)
    today = date.today()
    s = _din(start) if start else today.replace(day=1)
    e = _din(end) if end else today
    if e < s:
        raise HTTPException(400, "The From date must be on or before the To date.")
    n = (e - s).days + 1
    if n > HIST_MAX_DAYS:
        raise HTTPException(400, f"Please choose at most {HIST_MAX_DAYS} days at a time.")
    pre = s - timedelta(days=1)
    days = [pre + timedelta(days=i) for i in range(n + 1)]       # days[0] = pre

    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("""
            SELECT DISTINCT ON (staff_id) staff_id, day, slot, updated_by, updated_at
              FROM maintenance_attendance_board
             WHERE day <= %s
             ORDER BY staff_id, day DESC
        """, (pre,))
        carry = {r["staff_id"]: r for r in cur.fetchall()}
        cur.execute("""
            SELECT staff_id, day, slot, updated_by, updated_at
              FROM maintenance_attendance_board
             WHERE day > %s AND day <= %s
        """, (pre, e))
        rows = defaultdict(dict)
        for r in cur.fetchall():
            rows[r["staff_id"]][r["day"]] = r
        ids = sorted(set(carry) | set(rows))
        recs = []
        if ids:
            cur.execute(f"""
                SELECT s.id, s.name, s.emp_code, {_DESIG}, s.removed_on,
                       s.updated_by, s.updated_at
                  FROM maintenance_employee s{_JUDA_USER}
                 WHERE s.id = ANY(%s)
            """, (ids,))
            recs = cur.fetchall()
        cur.execute("SELECT MIN(at) AS m FROM maintenance_attendance_log")
        log_since = cur.fetchone()["m"]
        cur.execute("""
            SELECT at, by_user, day, staff_name, emp_code, action, from_slot, to_slot, detail
              FROM maintenance_attendance_log
             WHERE day >= %s AND day <= %s
             ORDER BY at DESC, id DESC
             LIMIT 5000
        """, (s, e))
        logs = cur.fetchall()

    groups = defaultdict(list)
    for rec in recs:
        groups[_hist_key(rec)].append(rec)
    people, changes = [], []
    for key, grp in groups.items():
        grp.sort(key=lambda r: r["id"], reverse=True)           # naya record pehle
        lines = {r["id"]: _hist_timeline(days, carry.get(r["id"]), rows.get(r["id"], {}),
                                         r["removed_on"]) for r in grp}
        merged = _hist_merge(grp, lines)
        top = grp[0]
        name, emp = top["name"], (top["emp_code"] or "")
        for ev in _hist_changes(days, merged, name, emp):
            # log shuru hone ke baad wale badlav log se aate hain (sahi kisne/kab)
            if (log_since is None or (ev["at"] is not None and ev["at"] < log_since)
                    or (ev["at"] is None and ev["day"] < log_since.date())):
                changes.append(ev)
        slots = [m[0] for m in merged[1:]]
        if not any(slots):
            continue                                            # is beech board par tha hi nahi
        tot = {k: 0 for k in SLOTS}
        for d, sl in zip(days[1:], slots):
            if sl and d <= today:
                tot[sl] += 1
        tot["duty"] = sum(tot[k] for k in _ON_DUTY)
        hata = [r["removed_on"] for r in grp]
        people.append({
            "key": key,
            "name": name,
            "emp_code": emp,
            "designation": top["designation"] or "",
            "removed_on": max(hata).isoformat() if all(hata) else None,
            "slots": slots,
            "totals": tot,
        })
    people.sort(key=lambda p: (p["removed_on"] is not None, p["name"].lower(), p["emp_code"]))

    day_totals = []
    for i in range(n):
        c = {k: 0 for k in SLOTS}
        for p in people:
            if p["slots"][i]:
                c[p["slots"][i]] += 1
        c["duty"] = sum(c[k] for k in _ON_DUTY)
        c["total"] = sum(c[k] for k in SLOTS)
        day_totals.append(c)

    for r in logs:
        changes.append({"day": r["day"], "action": r["action"], "from": r["from_slot"],
                        "to": r["to_slot"], "by": r["by_user"], "at": r["at"],
                        "name": r["staff_name"] or "", "emp_code": r["emp_code"] or "",
                        "detail": r["detail"], "source": "log"})
    changes.sort(key=lambda c: (c["day"], c["at"] or datetime.min), reverse=True)

    return {
        "start": s.isoformat(),
        "end": e.isoformat(),
        "today": today.isoformat(),
        "max_days": HIST_MAX_DAYS,
        "days": [d.isoformat() for d in days[1:]],
        "people": people,
        "day_totals": day_totals,
        "changes": [{**c, "day": _iso(c["day"]), "at": _iso(c["at"])} for c in changes],
        "log_since": _iso(log_since),
    }


# ══════════════════════════════════════════════════════════════════════════
# LEAVE -- chhutti ki arzi (user 2026-10-03)
# ══════════════════════════════════════════════════════════════════════════
# Pehli baat (user): "attendance ke neeche leave ka option do -- apna naam
# select karke kab se kab tak leave par rahega apni ID se daal dega, wo leave
# section me dikhega; assistant manager approve karega, date change kar sake."
# Usi din doosri baat (user): "jisko leave apply karni hai wo APNI ID se apply
# karega aur use APNI leave dikhegi bas; maint wali ID par sabki dikhegi.
# Supervisor / DET / Engineer / Senior Engineer ki leave AM approve karega, AM
# ki DM, DM ki Manager, aur Manager apni khud.  Admin ke paas sab.  Leave ka
# proper record rahe -- AM / DM / Manager purana record dekh sakein.  Admin
# leave ki row delete kar sake."
#
# Ek arzi = ek row (maintenance_attendance_leave).  Haal:
#   PENDING  -> APPROVED / REJECTED      (us pad ka approver)
#   PENDING  -> CANCELLED                (jiski arzi / jisne bhari / approver)
#   APPROVED -> date badle / REJECTED    (approver -- manzoori wapas bhi)
#   koi bhi  -> mita di                  (SIRF admin; audit log me naqal)
# PAD (upar `_pad`) arzi WALE aadmi ka -- uske emp code se juda app user ka
# role, warna board ki designation.  Pad -> "level" -> kaun approve kare:
#   staff (supervisor / det / engineer / senior_engineer / baaki) -> assistant_manager
#   assistant_manager -> deputy_manager
#   deputy_manager    -> manager / senior_manager
#   manager / senior_manager -> manager / senior_manager (apni khud bhi)
#   admin -> sab
# Kaun kya DEKHE:
#   admin, sanjha "maint" ID, manager / senior_manager -> sab
#   deputy_manager    -> AM + staff + apni
#   assistant_manager -> staff + apni
#   baaki             -> sirf APNI (jiski arzi hai wo khud, ya jo usne bhari)
# Arzi kaun bhare: har login SIRF APNE naam ki (emp code se juda board ka
# aadmi); sanjha "maint" ID aur admin kisi ki bhi (plant ka sanjha device).
# Attendance BOARD ki page-permission leave ke liye JAAN-BOOJH KAR nahi
# maangi jaati -- warna jinke paas board ka haq nahi (zyadatar log) wo apni
# leave bhi na bhar paate.  Har jaanch SERVER par, sirf button chhupana nahi.
#   * Board par apne aap KUCH nahi hota -- arzi sirf Leave section me.
#   * Date badli to pehli wali `orig_from` / `orig_to` me (sirf pehli baar).
# Table apne `_ensure_leave()` me (apna flag) -- board / history ke raaste par
# koi naya DDL nahi juda.
LEAVE_MAX_DAYS = 92          # ek arzi me itne din tak
LEAVE_BACK_DAYS = 7          # itne din peechhe tak ki arzi (beemari wagairah baad me)
_LEAVE_LOCK = 7_202_610      # ek aadmi ki do arzi ek saath na takrayein (staff_id ke saath)
_leave_bani = False

# Sanjha (shared) maintenance login -- plant ke sanjhe device par chalta hai;
# user: "maint wali ID par sabki leave dikhegi".  Username se (emp code 1001).
_SANJHA_IDS = ("maint",)

# level -> kaun approve kare (role)
_LEAVE_APPROVER = {
    "staff":             ("assistant_manager",),
    "assistant_manager": ("deputy_manager",),
    "deputy_manager":    ("manager", "senior_manager"),
    "manager":           ("manager", "senior_manager"),
}
# level -> "kiska intezaar" (UI ki line -- English)
_LEAVE_WAIT = {
    "staff": "Assistant Manager", "assistant_manager": "Deputy Manager",
    "deputy_manager": "Manager", "manager": "Manager",
}
# dekhne wale ka role -> kin level ki arzi dikhe (apni to hamesha)
_LEAVE_DEKHE = {
    "assistant_manager": ("staff",),
    "deputy_manager":    ("staff", "assistant_manager"),
}
_LEAVE_SAB_DEKHE = ("manager", "senior_manager")

_LEAVE_COLS = ("id, staff_id, staff_name, emp_code, from_date, to_date, reason, status,"
               " applied_by, applied_by_id, applied_at, decided_by, decided_at, note,"
               " orig_from, orig_to, updated_by, updated_at")
_LEAVE_COL_LIST = tuple(c.strip() for c in _LEAVE_COLS.split(","))
# arzi + arzi wale ka pad (juda user ka role / board ki designation).  Aadmi
# board se hat gaya ho to bhi row ki emp code ki naqal se user milta hai.
_LEAVE_SELECT = f"""
    SELECT {", ".join("l." + c for c in _LEAVE_COL_LIST)},
           lu.role AS taker_role, e.designation AS taker_desig,
           COALESCE({role_label_sql('lu.role')}, e.designation) AS taker_label
      FROM maintenance_attendance_leave l
      LEFT JOIN maintenance_employee e ON e.id = l.staff_id
      LEFT JOIN LATERAL (
            SELECT u.role FROM maintenance_users u
             WHERE COALESCE(TRIM(COALESCE(e.emp_code, l.emp_code)), '') <> ''
               AND UPPER(TRIM(u.emp_code)) = UPPER(TRIM(COALESCE(e.emp_code, l.emp_code)))
             ORDER BY u.id LIMIT 1
      ) lu ON TRUE"""


def _ensure_leave() -> None:
    global _leave_bani
    if _leave_bani:
        return
    with get_conn() as conn:
        cur = conn.cursor()
        # staff_id par FK jaan-boojh kar NAHI (log jaisa): aadmi mite to bhi
        # arzi ka itihaas rahe -- naam / emp code ki naqal saath me.
        cur.execute("""
            CREATE TABLE IF NOT EXISTS maintenance_attendance_leave (
                id             SERIAL PRIMARY KEY,
                staff_id       INTEGER,
                staff_name     VARCHAR(120) NOT NULL,
                emp_code       VARCHAR(40),
                from_date      DATE NOT NULL,
                to_date        DATE NOT NULL,
                reason         VARCHAR(300),
                status         VARCHAR(12) NOT NULL DEFAULT 'PENDING',
                applied_by     VARCHAR(120),
                applied_by_id  INTEGER,
                applied_at     TIMESTAMP NOT NULL DEFAULT NOW(),
                decided_by     VARCHAR(120),
                decided_at     TIMESTAMP,
                note           VARCHAR(300),
                orig_from      DATE,
                orig_to        DATE,
                updated_by     VARCHAR(120),
                updated_at     TIMESTAMP NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_att_leave_dates"
                    " ON maintenance_attendance_leave (to_date, from_date)")
    _leave_bani = True


def _leave_level(pad: str) -> str:
    """Pad -> leave ka level (kaun approve kare isi se)."""
    if pad in ("manager", "senior_manager"):
        return "manager"
    if pad in ("deputy_manager", "assistant_manager"):
        return pad
    return "staff"


def _mera_staff(cur, user: dict) -> Optional[int]:
    """Login user ka emp code jis CHALU aadmi se mile -- wahi uski 'apni' leave."""
    cur.execute("""
        SELECT s.id FROM maintenance_employee s
          JOIN maintenance_users u ON UPPER(TRIM(u.emp_code)) = UPPER(TRIM(s.emp_code))
         WHERE u.id = %s AND COALESCE(TRIM(s.emp_code), '') <> ''
           AND (s.removed_on IS NULL OR s.removed_on > CURRENT_DATE)
         ORDER BY s.id DESC LIMIT 1
    """, (user.get("id"),))
    r = cur.fetchone()
    if not r:
        return None
    return r["id"] if isinstance(r, dict) else r[0]


def _viewer(cur, user: dict) -> dict:
    """Dekhne / karne wale ka haq -- har leave endpoint isi se."""
    role = (user.get("role") or "").strip().lower()
    admin = role == "admin"
    sanjha = str(user.get("username") or "").strip().lower() in _SANJHA_IDS
    return {
        "id": user.get("id"),
        "role": role,
        "admin": admin,
        "sanjha": sanjha,
        "staff_id": _mera_staff(cur, user),
        "sab": admin or sanjha or role in _LEAVE_SAB_DEKHE,
        "dekhe": set(_LEAVE_DEKHE.get(role, ())),
        "kisi_ki": admin or sanjha,          # kisi ke bhi naam ki arzi bhar sake
    }


def _apni(v: dict, r) -> bool:
    """Arzi dekhne wale ki APNI hai (wo khud chhutti par) ya usi ne bhari."""
    return ((v["staff_id"] is not None and r["staff_id"] == v["staff_id"])
            or (r["applied_by_id"] is not None and r["applied_by_id"] == v["id"]))


def _row_level(r) -> str:
    return _leave_level(_pad(r.get("taker_role"), r.get("taker_desig")))


def _approve_kar_sake(v: dict, r) -> bool:
    return v["admin"] or v["role"] in _LEAVE_APPROVER.get(_row_level(r), ())


def _dikhe(v: dict, r) -> bool:
    return v["sab"] or _apni(v, r) or _row_level(r) in v["dekhe"]


def _leave_json(r, v: dict) -> dict:
    lvl = _row_level(r)
    d = {k: r[k] for k in _LEAVE_COL_LIST}
    d["days"] = (d["to_date"] - d["from_date"]).days + 1
    d["designation"] = r.get("taker_label") or ""
    d["level"] = lvl
    d["waiting_for"] = _LEAVE_WAIT.get(lvl, "Assistant Manager")
    d["mine"] = _apni(v, r)
    d["can_approve"] = _approve_kar_sake(v, r)
    d["can_cancel"] = r["status"] == "PENDING" and (d["mine"] or d["can_approve"])
    d["can_delete"] = v["admin"]
    for k in ("from_date", "to_date", "applied_at", "decided_at", "orig_from", "orig_to", "updated_at"):
        d[k] = _iso(d.get(k))
    return d


def _leave_dates(f: Optional[str], t: Optional[str], naya: bool) -> tuple:
    if not f or not t:
        raise HTTPException(400, "Please choose both the From and To dates.")
    fd, td = _din(f), _din(t)
    if td < fd:
        raise HTTPException(400, "The To date must be on or after the From date.")
    if (td - fd).days + 1 > LEAVE_MAX_DAYS:
        raise HTTPException(400, f"A leave can be at most {LEAVE_MAX_DAYS} days.")
    if naya and fd < date.today() - timedelta(days=LEAVE_BACK_DAYS):
        raise HTTPException(400, f"A leave can start at most {LEAVE_BACK_DAYS} days in the past.")
    return fd, td


def _overlap(cur, staff_id: Optional[int], fd: date, td: date, siwa: Optional[int] = None) -> None:
    """Usi aadmi ki PENDING / APPROVED arzi in dino par pehle se ho to mana."""
    if staff_id is None:
        return
    cur.execute("""
        SELECT from_date, to_date, status FROM maintenance_attendance_leave
         WHERE staff_id = %s AND status IN ('PENDING', 'APPROVED')
           AND from_date <= %s AND to_date >= %s
           AND (%s::int IS NULL OR id <> %s)
         ORDER BY from_date LIMIT 1
    """, (staff_id, td, fd, siwa, siwa))
    r = cur.fetchone()
    if r:
        ek = "an" if r["status"] == "APPROVED" else "a"
        raise HTTPException(400, f"There is already {ek} {r['status'].lower()} leave for "
                                 f"{r['from_date']:%d %b} – {r['to_date']:%d %b} on these dates.")


def _saaf_note(s: Optional[str]) -> Optional[str]:
    return " ".join((s or "").split())[:300] or None


class LeaveIn(BaseModel):
    staff_id: int
    from_date: str
    to_date: str
    reason: Optional[str] = ""


class LeaveDecide(BaseModel):
    from_date: Optional[str] = None
    to_date: Optional[str] = None
    note: Optional[str] = ""


_LEAVE_STATUS = ("PENDING", "APPROVED", "REJECTED", "CANCELLED")


@router.get("/leave")
def list_leave(start: Optional[str] = Query(None), end: Optional[str] = Query(None),
               status: Optional[str] = Query(None), staff_id: Optional[int] = Query(None),
               user=Depends(get_current_user)):
    """Leave section.
      pending -- dekhne wale ke daayre ki SAARI PENDING (tareekh ki koi had nahi)
      rows    -- record: [start, end] se takraati arzi (start na ho = 60 din
                 pehle; end na ho = aage sab); status / staff_id ho to chhanti
      me      -- apna board ka aadmi (arzi isi naam se); people -- kisi ki bhi
                 arzi bharne wale (admin / maint) ke liye chalu log (hierarchy kram)"""
    _ensure()
    _ensure_leave()
    s = _din(start) if start else date.today() - timedelta(days=60)
    e = _din(end) if end else None
    if e is not None and e < s:
        raise HTTPException(400, "The To date must be on or after the From date.")
    st = (status or "").strip().upper() or None
    if st and st not in _LEAVE_STATUS:
        raise HTTPException(400, f"Unknown status: {status}")
    with get_conn() as conn:
        cur = dict_cursor(conn)
        v = _viewer(cur, user)
        cur.execute(f"""{_LEAVE_SELECT}
             WHERE l.status = 'PENDING'
                OR (l.to_date >= %(s)s AND (%(e)s::date IS NULL OR l.from_date <= %(e)s::date))
             ORDER BY l.from_date DESC, l.id DESC
             LIMIT 3000
        """, {"s": s, "e": e})
        dikhe = [r for r in cur.fetchall() if _dikhe(v, r)]
        me = None
        if v["staff_id"] is not None:
            cur.execute(f"""
                SELECT s.id, s.name, s.emp_code, {_DESIG}, ju.role AS juda_role
                  FROM maintenance_employee s{_JUDA_USER}
                 WHERE s.id = %s""", (v["staff_id"],))
            m = cur.fetchone()
            if m:
                lvl = _leave_level(_pad(m["juda_role"], m["designation"]))
                me = {"staff_id": m["id"], "name": m["name"], "emp_code": m["emp_code"] or "",
                      "designation": m["designation"] or "", "waiting_for": _LEAVE_WAIT[lvl]}
        people = []
        if v["kisi_ki"]:
            cur.execute(f"""
                SELECT s.id, s.name, s.emp_code, {_DESIG}, ju.role AS juda_role
                  FROM maintenance_employee s{_JUDA_USER}
                 WHERE s.removed_on IS NULL OR s.removed_on > CURRENT_DATE""")
            pr = sorted(cur.fetchall(), key=lambda r: (_rank(r["juda_role"], r["designation"]),
                                                        (r["name"] or "").lower(), r["id"]))
            people = [{"id": r["id"], "name": r["name"], "emp_code": r["emp_code"] or "",
                       "designation": r["designation"] or "",
                       "waiting_for": _LEAVE_WAIT[_leave_level(_pad(r["juda_role"], r["designation"]))]}
                      for r in pr]

    def record(r) -> bool:
        if r["to_date"] < s or (e is not None and r["from_date"] > e):
            return False
        if st and r["status"] != st:
            return False
        return staff_id is None or r["staff_id"] == staff_id

    pending = sorted((r for r in dikhe if r["status"] == "PENDING"),
                     key=lambda r: (r["from_date"], r["id"]))
    return {
        "today": date.today().isoformat(),
        "start": s.isoformat(),
        "end": e.isoformat() if e else None,
        "me": me,
        "see_all": v["sab"],
        "can_apply_any": v["kisi_ki"],
        "can_delete": v["admin"],
        "approves": sorted(lvl for lvl, roles in _LEAVE_APPROVER.items()
                           if v["admin"] or v["role"] in roles),
        "people": people,
        "max_days": LEAVE_MAX_DAYS,
        "back_days": LEAVE_BACK_DAYS,
        "pending": [_leave_json(r, v) for r in pending],
        "rows": [_leave_json(r, v) for r in dikhe if record(r)],
    }


@router.post("/leave", status_code=201)
def apply_leave(body: LeaveIn, user=Depends(get_current_user)):
    _ensure()
    _ensure_leave()
    fd, td = _leave_dates(body.from_date, body.to_date, naya=True)
    with get_conn() as conn:
        cur = dict_cursor(conn)
        v = _viewer(cur, user)
        if not v["kisi_ki"]:
            if v["staff_id"] is None:
                raise HTTPException(403, "Your login is not linked to anyone on the attendance list "
                                         "— ask admin to add your Emp code there.")
            if body.staff_id != v["staff_id"]:
                raise HTTPException(403, "You can apply for leave only in your own name.")
        cur.execute("SELECT pg_advisory_xact_lock(%s, %s)", (_LEAVE_LOCK, body.staff_id))
        cur.execute("SELECT id, name, emp_code, removed_on FROM maintenance_employee WHERE id = %s",
                    (body.staff_id,))
        sm = cur.fetchone()
        if not sm or (sm["removed_on"] is not None and sm["removed_on"] <= fd):
            raise HTTPException(400, "Please choose a member from the list.")
        _overlap(cur, sm["id"], fd, td)
        cur.execute("""
            INSERT INTO maintenance_attendance_leave
                   (staff_id, staff_name, emp_code, from_date, to_date, reason, status,
                    applied_by, applied_by_id, updated_by)
            VALUES (%s, %s, %s, %s, %s, %s, 'PENDING', %s, %s, %s)
            RETURNING id
        """, (sm["id"], sm["name"], sm["emp_code"], fd, td, _saaf_note(body.reason),
              _kaun(user), user.get("id"), _kaun(user)))
        lid = cur.fetchone()["id"]
        return _leave_json(_leave_row(cur, lid, lock=False), v)


def _leave_row(cur, lid: int, lock: bool = True) -> dict:
    cur.execute(f"{_LEAVE_SELECT} WHERE l.id = %s{' FOR UPDATE OF l' if lock else ''}", (lid,))
    r = cur.fetchone()
    if not r:
        raise HTTPException(404, "Leave request not found.")
    return r


def _sirf_approver(v: dict, r) -> None:
    if not _approve_kar_sake(v, r):
        raise HTTPException(403, f"Only the {_LEAVE_WAIT.get(_row_level(r), 'Assistant Manager')} "
                                 f"(or admin) can approve or change this leave.")


def _naye_din(cur, r, body: LeaveDecide) -> tuple:
    """Approver ne date bheji ho to jaancho (aur takraav dekho); na bheji to wahi."""
    if not body.from_date and not body.to_date:
        return r["from_date"], r["to_date"]
    fd, td = _leave_dates(body.from_date or r["from_date"].isoformat(),
                          body.to_date or r["to_date"].isoformat(), naya=False)
    if (fd, td) != (r["from_date"], r["to_date"]):
        _overlap(cur, r["staff_id"], fd, td, siwa=r["id"])
    return fd, td


@router.post("/leave/{lid}/approve")
def approve_leave(lid: int, body: LeaveDecide, user=Depends(get_current_user)):
    _ensure_leave()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        v = _viewer(cur, user)
        r = _leave_row(cur, lid)
        _sirf_approver(v, r)
        if r["status"] != "PENDING":
            raise HTTPException(400, f"This request is already {r['status'].lower()}.")
        cur.execute("SELECT pg_advisory_xact_lock(%s, %s)", (_LEAVE_LOCK, r["staff_id"] or 0))
        fd, td = _naye_din(cur, r, body)
        badli = (fd, td) != (r["from_date"], r["to_date"])
        # RHS ka from_date / to_date = PURANI value (UPDATE ka niyam) -- wahi orig me
        cur.execute("""
            UPDATE maintenance_attendance_leave
               SET status = 'APPROVED', from_date = %s, to_date = %s,
                   orig_from = CASE WHEN %s THEN COALESCE(orig_from, from_date) ELSE orig_from END,
                   orig_to   = CASE WHEN %s THEN COALESCE(orig_to,   to_date)   ELSE orig_to   END,
                   decided_by = %s, decided_at = NOW(), note = COALESCE(%s, note),
                   updated_by = %s, updated_at = NOW()
             WHERE id = %s
        """, (fd, td, badli, badli, _kaun(user), _saaf_note(body.note), _kaun(user), lid))
        return _leave_json(_leave_row(cur, lid, lock=False), v)


@router.put("/leave/{lid}")
def change_leave_dates(lid: int, body: LeaveDecide, user=Depends(get_current_user)):
    """Approver date badle -- PENDING ya APPROVED dono par (haal wahi rehta hai)."""
    _ensure_leave()
    if not body.from_date or not body.to_date:
        raise HTTPException(400, "Please choose both the From and To dates.")
    with get_conn() as conn:
        cur = dict_cursor(conn)
        v = _viewer(cur, user)
        r = _leave_row(cur, lid)
        _sirf_approver(v, r)
        if r["status"] not in ("PENDING", "APPROVED"):
            raise HTTPException(400, f"This request is {r['status'].lower()} — its dates can't be changed.")
        cur.execute("SELECT pg_advisory_xact_lock(%s, %s)", (_LEAVE_LOCK, r["staff_id"] or 0))
        fd, td = _naye_din(cur, r, body)
        if (fd, td) == (r["from_date"], r["to_date"]):
            return _leave_json(r, v)
        cur.execute("""
            UPDATE maintenance_attendance_leave
               SET from_date = %s, to_date = %s,
                   orig_from = COALESCE(orig_from, from_date),
                   orig_to   = COALESCE(orig_to,   to_date),
                   note = COALESCE(%s, note), updated_by = %s, updated_at = NOW()
             WHERE id = %s
        """, (fd, td, _saaf_note(body.note), _kaun(user), lid))
        return _leave_json(_leave_row(cur, lid, lock=False), v)


@router.post("/leave/{lid}/reject")
def reject_leave(lid: int, body: LeaveDecide, user=Depends(get_current_user)):
    _ensure_leave()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        v = _viewer(cur, user)
        r = _leave_row(cur, lid)
        _sirf_approver(v, r)
        if r["status"] not in ("PENDING", "APPROVED"):
            raise HTTPException(400, f"This request is already {r['status'].lower()}.")
        cur.execute("""
            UPDATE maintenance_attendance_leave
               SET status = 'REJECTED', decided_by = %s, decided_at = NOW(),
                   note = COALESCE(%s, note), updated_by = %s, updated_at = NOW()
             WHERE id = %s
        """, (_kaun(user), _saaf_note(body.note), _kaun(user), lid))
        return _leave_json(_leave_row(cur, lid, lock=False), v)


@router.post("/leave/{lid}/cancel")
def cancel_leave(lid: int, user=Depends(get_current_user)):
    """PENDING arzi wapas -- jiski arzi / jisne bhari, ya us pad ka approver."""
    _ensure_leave()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        v = _viewer(cur, user)
        r = _leave_row(cur, lid)
        if not (_apni(v, r) or _approve_kar_sake(v, r)):
            raise HTTPException(403, "Only the person on leave, the person who applied, or the "
                                     "approver can cancel this request.")
        if r["status"] != "PENDING":
            raise HTTPException(400, "Only a pending request can be cancelled.")
        cur.execute("""
            UPDATE maintenance_attendance_leave
               SET status = 'CANCELLED', decided_by = %s, decided_at = NOW(),
                   updated_by = %s, updated_at = NOW()
             WHERE id = %s
        """, (_kaun(user), _kaun(user), lid))
        return _leave_json(_leave_row(cur, lid, lock=False), v)


@router.delete("/leave/{lid}")
def delete_leave(lid: int, user=Depends(get_current_user)):
    """SIRF admin -- arzi ki row poori mita do (user: "admin me option do leave
    wali row ko delete karne ka").  Mitane se pehle uski naqal audit log me
    (kiski, kis din ki, kya haal tha, kisne bhari / faisla kiya) -- record ka
    nishaan rahe."""
    _ensure_leave()
    if not _admin_hai(user):
        raise HTTPException(403, "Only admin can delete a leave record.")
    with get_conn() as conn:
        cur = dict_cursor(conn)
        r = _leave_row(cur, lid)
        cur.execute("DELETE FROM maintenance_attendance_leave WHERE id = %s", (lid,))
        try:
            from main import write_audit
            faisla = f" · decided {r['decided_by']}" if r["decided_by"] else ""
            write_audit(conn, action="LEAVE_DELETE", entity_type="maintenance_attendance_leave",
                        entity_id=lid, user=user,
                        details=(f"leave #{lid} deleted: {r['staff_name']} ({r['emp_code'] or '-'}) "
                                 f"{r['from_date']:%Y-%m-%d} .. {r['to_date']:%Y-%m-%d} {r['status']}"
                                 f" · applied {r['applied_by'] or '-'}{faisla}")[:500])
        except Exception as ex:
            print(f"[ATTENDANCE] leave delete ka audit nahi likha: {ex}")
    return {"ok": True, "id": lid}
