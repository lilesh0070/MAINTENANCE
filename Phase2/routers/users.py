"""
routers/users.py
================
User management (admin only).

Tables:
  maintenance_users              login — username / password_hash / role
  maintenance_user_permissions   per-page access (page_key -> perm_level)

Roles (designation ladder — sirf `admin` ke paas full power hai; baaki sab
ko admin per-page permissions deta hai):
  admin · supervisor · engineer · senior_engineer ·
  assistant_manager · deputy_manager · senior_manager

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
    "admin", "supervisor", "engineer", "senior_engineer",
    "assistant_manager", "deputy_manager", "senior_manager",
}


class UserCreate(BaseModel):
    username: str
    password: str
    role:     str = "engineer"


class UserUpdate(BaseModel):
    role: Optional[str] = None


def _validate_role(role: Optional[str]) -> None:
    if role is not None and role not in VALID_ROLES:
        raise HTTPException(400, f"role must be one of {sorted(VALID_ROLES)}")


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
        cur.execute("""
            SELECT id, username, role, full_name, is_active, last_login, created_at,
                   password_plain
              FROM maintenance_users
             ORDER BY username
        """)
        return cur.fetchall()


@router.post("/", status_code=201)
def create_user(body: UserCreate, admin=Depends(require_admin)):
    """Naya user banao."""
    _validate_role(body.role)
    with get_conn() as conn:
        _ensure_pw_plain_col(conn)
        cur = dict_cursor(conn)
        cur.execute("SELECT 1 FROM maintenance_users WHERE username = %s", (body.username,))
        if cur.fetchone():
            raise HTTPException(400, "Username already exists")
        cur.execute("""
            INSERT INTO maintenance_users (username, password_hash, role, password_plain)
            VALUES (%s, %s, %s, %s)
            RETURNING id, username, role, is_active, created_at
        """, (body.username, hash_password(body.password), body.role, body.password))
        row = cur.fetchone()
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


@router.put("/{user_id}/role")
def update_user_role(user_id: int, body: UserUpdate, admin=Depends(require_admin)):
    """Role badlo.  (Naam `/role` hi rakha hai taaki AdminPanel ke purane
    calls waise ke waise chalte rahein.)"""
    _validate_role(body.role)
    if body.role is None:
        return {"ok": True, "updated": False}
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("UPDATE maintenance_users SET role = %s WHERE id = %s", (body.role, user_id))
        if cur.rowcount == 0:
            raise HTTPException(404, "User not found")
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
