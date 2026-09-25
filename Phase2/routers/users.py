"""
routers/users.py
================
User management (admin only).

Tables:
  maintenance_users              login — username / password_hash / role
  maintenance_user_permissions   per-page access (page_key -> perm_level)

Roles (designation ladder — sirf `admin` ke paas full power hai; baaki sab
ko admin per-page permissions deta hai):
  admin · supervisor · det · engineer · senior_engineer ·
  assistant_manager · deputy_manager · manager · senior_manager
  (det + manager 2026-09-24 me jude.  Role ke naam par kahin koi khaas logic
  nahi chalta -- access sirf per-page permission se -- isliye naya role jodna
  = yahan VALID_ROLES + ROLE_LABELS + frontend mailconfig.jsx ka
  ROLE_OPTIONS/ROLE_PILL.)

Kis user ko kaunsa page dikhega aur wo likh payega ya nahi, ye poori tarah
`maintenance_user_permissions` tay karti hai — frontend ka `canAccess()` /
`canWrite()` isi map par chalta hai (`/api/auth/me` se aata hai).
"""

import time
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import List, Optional

from database import get_conn, dict_cursor
from auth import require_admin, hash_password

router = APIRouter(prefix="/api/users", tags=["users"])

VALID_ROLES = {
    "admin", "supervisor", "det", "engineer", "senior_engineer",
    "assistant_manager", "deputy_manager", "manager", "senior_manager",
}

# Role ka DIKHNE wala naam ("designation") -- frontend `ROLE_OPTIONS`
# (admin/mailconfig.jsx) ke label hubahu.  Attendance Dashboard me jo aadmi
# kisi app user se juda hai (emp code se), uski designation yahin se aati hai
# (user 2026-09-25: "jo hamne wahan define kar rakhi hai wo aa jaye, change
# bhi na ho").  Naya role jodo to VALID_ROLES + yahan + ROLE_OPTIONS, teeno.
ROLE_LABELS = {
    "admin": "Admin",
    "supervisor": "Supervisor",
    "det": "DET",
    "engineer": "Engineer",
    "senior_engineer": "Senior Engineer",
    "assistant_manager": "Assistant Manager",
    "deputy_manager": "Deputy Manager",
    "manager": "Manager",
    "senior_manager": "Senior Manager",
}


def role_label_sql(col: str) -> str:
    """SQL CASE: role -> dikhne wala naam; anjaan role par NULL."""
    whens = " ".join(f"WHEN '{k}' THEN '{v}'" for k, v in ROLE_LABELS.items())
    return f"(CASE {col} {whens} END)"


def sync_attendance_designation(cur, user_id: int) -> None:
    """Attendance board (maintenance_employee) me is user se jude aadmi (emp
    code se) ki SAVE wali designation bhi role ke naam par kar do.
    User 2026-09-25: "yahan (Admin) designation badlein to wahan (Attendance)
    bhi ho jaani chahiye."  Board to waise bhi role se hi dikhata hai
    (attendance.py `_DESIG`) -- ye save wali naqal isliye ki jo seedha table
    padhe (AI assistant, report) use bhi wahi mile, aur user kabhi hat jaaye
    to aakhri designation bachi rahe.  Attendance ki table na ho (naya
    install) to chup-chaap kuch nahi.  Role anjaan ho to kuch nahi badalta."""
    cur.execute("SELECT to_regclass('maintenance_employee') IS NOT NULL")
    r = cur.fetchone()
    if not (r[0] if not isinstance(r, dict) else list(r.values())[0]):
        return
    label = role_label_sql("u.role")
    cur.execute(f"""
        UPDATE maintenance_employee e
           SET designation = {label}
          FROM maintenance_users u
         WHERE u.id = %s
           AND e.removed_on IS NULL
           AND COALESCE(TRIM(u.emp_code), '') <> ''
           AND UPPER(TRIM(e.emp_code)) = UPPER(TRIM(u.emp_code))
           AND {label} IS NOT NULL
           AND COALESCE(e.designation, '') IS DISTINCT FROM {label}
    """, (user_id,))


class UserCreate(BaseModel):
    username: str
    password: str
    role:     str = "engineer"
    # Employee ID -- naya user banate waqt ZAROORI (user 2026-09-23).  Isi se
    # Attendance Dashboard ka aadmi aur app ka user ek doosre se jude rehte
    # hain; aage buzz bhi isi rishte par chalega.
    emp_code: str = ""


class UserNameIn(BaseModel):
    username: str


class UserUpdate(BaseModel):
    role: Optional[str] = None
    # purane user me emp code bharne ke liye (list me hi badal sakte hain)
    emp_code: Optional[str] = None


def _validate_role(role: Optional[str]) -> None:
    if role is not None and role not in VALID_ROLES:
        raise HTTPException(400, f"role must be one of {sorted(VALID_ROLES)}")


def _saaf_code(v) -> str:
    """Employee ID ek hi shakl me rakhte hain -- aage-peeche ki jagah hatao
    aur BADE akshar.  Warna ' 97' aur '97' do alag aadmi ban jaate."""
    return " ".join(str(v or "").split()).upper()


def _ensure_emp_code_col(conn) -> None:
    """`emp_code` ka khaana + uska ek-jaisa-na-ho wala pehra.  Idempotent.

    Pehra PARTIAL index se hai (`WHERE emp_code <> ''`) -- purane user jinka
    code abhi khaali hai wo sab ek saath rah sakein, par bhar dene ke baad do
    logon ka ek code na ho."""
    cur = conn.cursor()
    cur.execute("ALTER TABLE maintenance_users ADD COLUMN IF NOT EXISTS emp_code VARCHAR(40)")
    cur.execute("UPDATE maintenance_users SET emp_code = '' WHERE emp_code IS NULL")
    cur.execute("""CREATE UNIQUE INDEX IF NOT EXISTS maintenance_users_emp_code_uniq
                     ON maintenance_users (emp_code)
                  WHERE emp_code IS NOT NULL AND emp_code <> ''""")
    conn.commit()


def _naam_jaancho(cur, uname: str, chhodo_id=None) -> None:
    """Username khaali na ho, kisi aur ka username na ho, aur kisi aur ka
    EMPLOYEE ID bhi na ho.

    ⚠ Aakhri shart isliye: login ab username YA emp id -- dono se chalta hai.
    Agar Ram ka username '354' ho aur Shyam ka emp code bhi '354', to '354'
    type karne wala kis khaate me jaayega, ye pakka nahi rehta.  Isliye dono
    taraf se rok yahin lagti hai."""
    if not uname:
        raise HTTPException(400, "Username is required.")
    if chhodo_id is None:
        cur.execute("SELECT id FROM maintenance_users WHERE LOWER(username) = LOWER(%s)", (uname,))
    else:
        cur.execute("SELECT id FROM maintenance_users WHERE LOWER(username) = LOWER(%s) AND id <> %s",
                    (uname, chhodo_id))
    if cur.fetchone():
        raise HTTPException(400, "Username already exists")
    cur.execute("""SELECT username FROM maintenance_users
                    WHERE COALESCE(emp_code, '') <> '' AND UPPER(emp_code) = UPPER(%s)
                      AND (%s::int IS NULL OR id <> %s::int)""",
                (uname, chhodo_id, chhodo_id))
    r = cur.fetchone()
    if r:
        kiska = r[0] if not isinstance(r, dict) else r.get("username")
        raise HTTPException(400, f"'{uname}' is already the Employee ID of user '{kiska}'.")


def _code_khaali_ya_dohra(cur, code: str, chhodo_id=None, zaroori: bool = True) -> None:
    """Code kisi aur ke paas na ho.  `zaroori` ho to khaali bhi na ho.

    ⚠ Badalte waqt `zaroori=False` -- warna galat type ho gaya code KABHI
    hataya hi nahi ja sakta (pehli baar yahi galti ki thi: list me se code
    khaali karne par 'Employee ID is required' aa jaata tha)."""
    if not code:
        if zaroori:
            raise HTTPException(400, "Employee ID is required.")
        return
    if chhodo_id is None:
        cur.execute("SELECT username FROM maintenance_users WHERE emp_code = %s", (code,))
    else:
        cur.execute("SELECT username FROM maintenance_users WHERE emp_code = %s AND id <> %s",
                    (code, chhodo_id))
    r = cur.fetchone()
    if r:
        naam = r[0] if not isinstance(r, dict) else r.get("username")
        raise HTTPException(400, f"Employee ID {code} is already used by '{naam}'.")
    # ...aur ye code kisi DOOSRE ka username bhi na ho (login dono se hota hai)
    cur.execute("""SELECT username FROM maintenance_users
                    WHERE LOWER(username) = LOWER(%s)
                      AND (%s::int IS NULL OR id <> %s::int)""",
                (code, chhodo_id, chhodo_id))
    if cur.fetchone():
        raise HTTPException(400, f"'{code}' is already a username — pick another Employee ID.")


def _ensure_pw_plain_col(conn) -> None:
    """Admin ke liye password list me dikhana hai — hash se wapas nahi milta,
    isliye plaintext ki ek copy `password_plain` me rakhte hain.  INTERNAL
    admin-only tool; column admin auth ke peeche hi expose hoti hai.
    Idempotent — column pehle se ho to kuch nahi karta."""
    cur = conn.cursor()
    cur.execute("ALTER TABLE maintenance_users ADD COLUMN IF NOT EXISTS password_plain TEXT")
    conn.commit()


class PasswordReset(BaseModel):
    password: str


@router.get("/")
def list_users(admin=Depends(require_admin)):
    """Saare users (admin only) — password_plain samet (admin ko dikhane ke liye)."""
    with get_conn() as conn:
        _ensure_pw_plain_col(conn)
        cur = dict_cursor(conn)
        _ensure_emp_code_col(conn)
        cur.execute("""
            SELECT id, username, role, full_name, is_active, last_login, created_at,
                   password_plain, COALESCE(emp_code, '') AS emp_code
              FROM maintenance_users
             ORDER BY username
        """)
        return cur.fetchall()


@router.post("/", status_code=201)
def create_user(body: UserCreate, admin=Depends(require_admin)):
    """Naya user banao."""
    _validate_role(body.role)
    code = _saaf_code(body.emp_code)
    with get_conn() as conn:
        _ensure_pw_plain_col(conn)
        _ensure_emp_code_col(conn)
        cur = dict_cursor(conn)
        _naam_jaancho(conn.cursor(), body.username)
        # NAYE user par Employee ID zaroori (purane bina code ke chalte rahenge
        # jab tak admin unme bhar na de -- warna update ke din sab atak jaate).
        _code_khaali_ya_dohra(conn.cursor(), code)
        cur.execute("""
            INSERT INTO maintenance_users (username, password_hash, role, password_plain, emp_code)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING id, username, role, is_active, created_at, emp_code
        """, (body.username, hash_password(body.password), body.role, body.password, code))
        row = cur.fetchone()
        # Board par is emp code ka aadmi pehle se ho (haath se joda gaya) to
        # uski save wali designation bhi abhi role se mila do.
        sync_attendance_designation(cur, row["id"])
        conn.commit()
        return row


@router.put("/{user_id}/password")
def reset_user_password(user_id: int, body: PasswordReset, admin=Depends(require_admin)):
    """Kisi user ka password reset karo (admin only) — hash + plaintext dono update."""
    if not body.password:
        raise HTTPException(400, "password required")
    with get_conn() as conn:
        _ensure_pw_plain_col(conn)
        cur = conn.cursor()
        cur.execute(
            # pwd_changed_at = ABHI ka app-clock unix-ts (wahi clock jo token iat use
            # karta hai; DB skew se bachne ko DB NOW() nahi) => is user ke sab purane
            # token invalid => wo jaha jaha login hai wahan se logout (agli req 401).
            "UPDATE maintenance_users SET password_hash = %s, password_plain = %s, "
            "pwd_changed_at = %s WHERE id = %s",
            (hash_password(body.password), body.password, int(time.time()), user_id),
        )
        if cur.rowcount == 0:
            raise HTTPException(404, "User not found")
        conn.commit()
    return {"ok": True}


@router.post("/{user_id}/force-logout")
def force_logout_user(user_id: int, admin=Depends(require_admin)):
    """Admin kisi logged-in user ko force LOGOUT kare — uske SAB token turant
    invalid (pwd_changed_at ab tak bump) + ek AUTH_LOGOUT audit.  User agli
    request par 401 => login page par chala jayega.  Password NAHI badalta —
    wahi se dobara login kar lega.  (Login History ke "Currently Logged In" me
    har id ke aage 'Logout' button isi ko call karta hai.)"""
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("SELECT username FROM maintenance_users WHERE id = %s", (user_id,))
        r = cur.fetchone()
        if not r:
            raise HTTPException(404, "User not found")
        uname = r[0]
        cur.execute("UPDATE maintenance_users SET pwd_changed_at = %s WHERE id = %s",
                    (int(time.time()), user_id))
        cur.execute("""INSERT INTO maintenance_audit_log
                           (action, entity_type, entity_id, details, user_id, username)
                       VALUES ('AUTH_LOGOUT', 'user', %s, %s, %s, %s)""",
                    (user_id, f"admin '{admin.get('username')}' ne force-logout kiya",
                     user_id, uname))
        conn.commit()
    return {"ok": True, "username": uname}


@router.post("/force-logout")
def force_logout_by_name(username: str, admin=Depends(require_admin)):
    """USERNAME se force-logout — user DELETE ho chuka ho tab bhi chalta hai.

    Kyun alag endpoint: "Currently Logged In" ki list `maintenance_audit_log`
    se banti hai (username par), `maintenance_users` se nahi.  Isliye user ko
    delete kar dene par bhi uski row wahan atki reh jaati thi, aur upar wala
    `/{user_id}/force-logout` use hata nahi paata tha — deleted user ki id NULL
    aati hai, to URL `/api/users/null/force-logout` ban kar 422 de deta tha
    (aur UI use chup-chaap nigal jaata tha, isliye button "kuch nahi karta"
    lagta tha).  Ye endpoint sirf naam par chalta hai.

    User abhi maujood ho  -> `pwd_changed_at` bump (uske sab token turant mare).
    User delete ho chuka  -> token waise bhi mara hua hai (get_current_user
                             DB me user na milne par 401 deta hai), to sirf
                             AUTH_LOGOUT likhna kaafi hai — wahi row ko list
                             se hataata hai.
    """
    uname = (username or "").strip()
    if not uname:
        raise HTTPException(400, "username required")
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id FROM maintenance_users WHERE username = %s", (uname,))
        r = cur.fetchone()
        uid = r[0] if r else None
        existed = uid is not None
        if existed:
            cur.execute("UPDATE maintenance_users SET pwd_changed_at = %s WHERE id = %s",
                        (int(time.time()), uid))
        cur.execute("""INSERT INTO maintenance_audit_log
                           (action, entity_type, entity_id, details, user_id, username)
                       VALUES ('AUTH_LOGOUT', 'user', %s, %s, %s, %s)""",
                    (uid, f"admin '{admin.get('username')}' ne force-logout kiya"
                          + ("" if existed else " (user delete ho chuka tha — sirf session band ki)"),
                     uid, uname))
        conn.commit()
    return {"ok": True, "username": uname, "user_existed": existed}


@router.put("/{user_id}/username")
def update_username(user_id: int, body: UserNameIn, admin=Depends(require_admin)):
    """Username badlo -- SIRF admin (user 2026-09-23).

    ⚠ Jiska naam badla, uska chalu token TURANT bekaar ho jaata hai: token me
    `sub` = purana username hai aur `get_current_user` usi se aadmi dhoondta
    hai.  Yaani wo aadmi apne aap logout ho jaayega aur naye naam (ya apne emp
    id) se dobara login karega.  Ye jaan-boojh kar hai -- naam badal kar purana
    session chalte rehna zyada ulta hota."""
    naya = " ".join(str(body.username or "").split())
    with get_conn() as conn:
        _ensure_emp_code_col(conn)
        cur = conn.cursor()
        cur.execute("SELECT username FROM maintenance_users WHERE id = %s", (user_id,))
        r = cur.fetchone()
        if not r:
            raise HTTPException(404, "User not found")
        purana = r[0]
        if purana == naya:
            return {"ok": True, "updated": False, "username": naya}
        _naam_jaancho(cur, naya, chhodo_id=user_id)
        cur.execute("UPDATE maintenance_users SET username = %s WHERE id = %s", (naya, user_id))
        try:
            cur.execute("""INSERT INTO maintenance_audit_log
                               (action, entity_type, entity_id, details, user_id, username)
                           VALUES ('USER_RENAME', 'user', %s, %s, %s, %s)""",
                        (user_id, f"'{purana}' -> '{naya}' (by {admin.get('username')})",
                         user_id, naya))
        except Exception as _e:
            print(f"[AUDIT] rename write failed: {_e}")
        conn.commit()
    return {"ok": True, "updated": True, "username": naya, "was": purana}


@router.put("/{user_id}/role")
def update_user_role(user_id: int, body: UserUpdate, admin=Depends(require_admin)):
    """Role badlo.  (Naam `/role` hi rakha hai taaki AdminPanel ke purane
    calls waise ke waise chalte rahein.)"""
    _validate_role(body.role)
    # Sirf emp code bhejo -> sirf wahi badlega (list me se seedha bharne ke liye)
    if body.emp_code is not None:
        code = _saaf_code(body.emp_code)
        with get_conn() as conn:
            _ensure_emp_code_col(conn)
            cur = conn.cursor()
            _code_khaali_ya_dohra(cur, code, chhodo_id=user_id, zaroori=False)
            cur.execute("UPDATE maintenance_users SET emp_code = %s WHERE id = %s", (code, user_id))
            if cur.rowcount == 0:
                raise HTTPException(404, "User not found")
            # naya emp code kisi board wale aadmi se mila -> uski designation bhi
            sync_attendance_designation(cur, user_id)
            conn.commit()
        if body.role is None:
            return {"ok": True, "updated": True}
    if body.role is None:
        return {"ok": True, "updated": False}
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("UPDATE maintenance_users SET role = %s WHERE id = %s", (body.role, user_id))
        if cur.rowcount == 0:
            raise HTTPException(404, "User not found")
        # Attendance board ki designation bhi saath me (user 2026-09-25)
        sync_attendance_designation(cur, user_id)
        conn.commit()
    return {"ok": True, "updated": True}


@router.delete("/{user_id}")
def delete_user(user_id: int, admin=Depends(require_admin)):
    """User hatao (admin only)."""
    with get_conn() as conn:
        conn.cursor().execute("DELETE FROM maintenance_users WHERE id = %s", (user_id,))
        conn.commit()
    return {"ok": True}



# ═════════════════════════════════════════════════════════════════════
# PER-PAGE PERMISSIONS
# ═════════════════════════════════════════════════════════════════════
# Operator's request: when admin creates/edits a user, they want to
# pick which pages the user can SEE and whether each page is read-only
# or full CRUD.
#
# Schema (auto-created on first call):
#   maintenance_user_permissions
#       user_id    FK → maintenance_users
#       page_key   TEXT (matches the canAccess keys used by the frontend)
#       perm_level 'none' | 'read' | 'full'
#       updated_at
#
# perm_level semantics:
#   none  – page hidden from slide-nav, blocked by canAccess()
#   read  – page visible, but admin sub-panels render readOnly
#   full  – full CRUD (default for admin-equivalents, configurable per
#           page for everyone else)
#
# When NO row exists for a (user, page), the auth layer falls back to
# the role/department defaults baked into AuthContext.canAccess() —
# nothing is broken for users who haven't had explicit perms set.
# ═════════════════════════════════════════════════════════════════════

VALID_PERM_LEVELS = {"none", "read", "full"}


class UserPermission(BaseModel):
    page_key:   str
    perm_level: str


class UserPermissionBulk(BaseModel):
    permissions: List[UserPermission]


def _ensure_perm_table(conn) -> None:
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS maintenance_user_permissions (
            user_id    INTEGER NOT NULL
                       REFERENCES maintenance_users(id) ON DELETE CASCADE,
            page_key   TEXT    NOT NULL,
            perm_level TEXT    NOT NULL DEFAULT 'none',
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (user_id, page_key)
        )
    """)
    conn.commit()


@router.get("/{user_id}/permissions")
def get_user_permissions(user_id: int, admin=Depends(require_admin)):
    """Return the explicit per-page permission map for a user.  Pages
    not listed in the response inherit the role/department defaults."""
    with get_conn() as conn:
        _ensure_perm_table(conn)
        cur = dict_cursor(conn)
        cur.execute("""
            SELECT page_key, perm_level
              FROM maintenance_user_permissions
             WHERE user_id = %s
             ORDER BY page_key
        """, (user_id,))
        return cur.fetchall()


@router.put("/{user_id}/permissions")
def set_user_permissions(user_id: int,
                          body: UserPermissionBulk,
                          admin=Depends(require_admin)):
    """Replace the entire permission set for a user.  Pages omitted from
    the payload (or sent with perm_level='none') effectively hide that
    page for the user."""
    # Validate
    for p in body.permissions:
        if p.perm_level not in VALID_PERM_LEVELS:
            raise HTTPException(400,
                f"perm_level must be one of {sorted(VALID_PERM_LEVELS)}, "
                f"got {p.perm_level!r} for {p.page_key}")

    with get_conn() as conn:
        _ensure_perm_table(conn)
        cur = conn.cursor()

        # Sanity: user must exist
        cur.execute("SELECT 1 FROM maintenance_users WHERE id = %s", (user_id,))
        if cur.fetchone() is None:
            raise HTTPException(404, "User not found")

        cur.execute("DELETE FROM maintenance_user_permissions WHERE user_id = %s",
                    (user_id,))
        seen = set()
        for p in body.permissions:
            key = p.page_key.strip()
            if not key or key in seen:
                continue
            seen.add(key)
            # 'none' rows are stored too (so the absence of a row truly
            # means "no override" → fall back to role defaults).  Admin
            # who explicitly chose 'none' wants the page HIDDEN even if
            # the role default would expose it.
            cur.execute("""
                INSERT INTO maintenance_user_permissions
                    (user_id, page_key, perm_level)
                VALUES (%s, %s, %s)
            """, (user_id, key, p.perm_level))
        conn.commit()
    return {"ok": True, "count": len(seen)}
