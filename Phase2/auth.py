"""
auth.py
=======
JWT-based authentication.  Roles = ek designation ladder — admin ·
supervisor · engineer · senior_engineer · assistant_manager ·
deputy_manager · senior_manager.  Sirf `admin` ke paas full access hai;
baaki sab ko per-page permissions (maintenance_user_permissions) milti hain.

To change JWT secret → edit SECRET_KEY
To change token expiry → edit TOKEN_EXPIRE_HOURS
"""

import os
import secrets
from datetime import datetime, timedelta
from typing import Optional

import bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import JWTError, jwt
from pydantic import BaseModel

from database import get_conn, dict_cursor
import psycopg2

# ── Config ─────────────────────────────────────────────────────
# SECURITY: the JWT signing key MUST come from the environment.  A key baked
# into source can be read by anyone with repo/file access and used to FORGE an
# admin token (get_current_user only checks the signature).  Set JWT_SECRET_KEY
# (or SECRET_KEY) in .env to a long random value, e.g.:
#     python -c "import secrets; print(secrets.token_urlsafe(48))"
# No signing key is baked into the source (a hardcoded key can be read from the
# repo and used to FORGE an admin token).  If the env var is missing we generate
# a RANDOM per-process key instead — tokens then reset on every restart (a safe
# failure mode), but the key can never be forged from the source.  Set
# JWT_SECRET_KEY in .env to a long random value for stable, shared sessions.
SECRET_KEY          = os.getenv("JWT_SECRET_KEY") or os.getenv("SECRET_KEY")
if not SECRET_KEY:
    SECRET_KEY = secrets.token_urlsafe(48)
    print("[SECURITY] WARNING: JWT_SECRET_KEY not set — generated a random "
          "per-process key. All sessions reset on restart. Set JWT_SECRET_KEY "
          "in .env for stable signing.")
ALGORITHM           = "HS256"
TOKEN_EXPIRE_HOURS  = 12

# ── Crypto ─────────────────────────────────────────────────────
# Use bcrypt directly (passlib 1.7.4 is incompatible with bcrypt >= 4.1).
oauth2_scheme          = OAuth2PasswordBearer(tokenUrl="/api/auth/login")
# Same as oauth2_scheme but tolerates missing/invalid tokens — returns None
# instead of raising 401.  Used by endpoints that are PUBLICLY readable
# (Fullscreen TV display) but ALSO benefit from a logged-in user context
# (e.g. operator-line restriction) when the caller is authenticated.
oauth2_scheme_optional = OAuth2PasswordBearer(tokenUrl="/api/auth/login",
                                              auto_error=False)


# ── Schemas ────────────────────────────────────────────────────
class Token(BaseModel):
    access_token: str
    token_type:   str
    username:     str
    user_id:      int
    role:         str
    expires_in:   int   # seconds


class TokenData(BaseModel):
    username: Optional[str] = None


# ── Helpers ────────────────────────────────────────────────────
def verify_password(plain: str, hashed: str) -> bool:
    if not plain or not hashed:
        return False
    try:
        # bcrypt truncates at 72 bytes; encode both sides consistently.
        return bcrypt.checkpw(plain.encode("utf-8")[:72], hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8")[:72], bcrypt.gensalt()).decode("utf-8")


def create_token(username: str, role: str, user_id: int) -> str:
    expire = datetime.utcnow() + timedelta(hours=TOKEN_EXPIRE_HOURS)
    return jwt.encode(
        {"sub": username, "exp": expire, "role": role, "id": user_id},
        SECRET_KEY,
        algorithm=ALGORITHM
    )


def get_user_from_db(username: str) -> Optional[dict]:
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            "SELECT * FROM maintenance_users WHERE username = %s",
            (username,)
        )
        return cur.fetchone()


# ── Dependencies ───────────────────────────────────────────────
def get_current_user(token: str = Depends(oauth2_scheme)) -> dict:
    """
    FastAPI dependency that returns the current authenticated user.
    Contains keys: id, username, role, last_login, created_at.
    """
    creds_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired token",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username = payload.get("sub")
        if not username:
            raise creds_exc
    except JWTError:
        raise creds_exc

    user = get_user_from_db(username)
    if not user:
        raise creds_exc
    return dict(user)


def get_current_user_optional(token: Optional[str] = Depends(oauth2_scheme_optional)
                              ) -> Optional[dict]:
    """
    Optional variant of get_current_user.  Returns the authenticated user
    when a valid `Authorization: Bearer <token>` header is present, else
    returns None — never raises 401.

    Use on PUBLIC read-only endpoints that the Fullscreen TV display polls
    without ever logging in.  Endpoints can still branch on `if user:` to
    apply per-user filters when an authenticated request comes in.
    """
    if not token:
        return None
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username = payload.get("sub")
        if not username:
            return None
    except JWTError:
        return None
    user = get_user_from_db(username)
    return dict(user) if user else None


def require_admin(user: dict = Depends(get_current_user)):
    """Dependency that raises 403 if the user is not admin.
    App admin-only hai — admin hi eklauta role hai."""
    if user["role"] != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required"
        )
    return user


def require_read_only(user: dict = Depends(get_current_user)):
    """Any authenticated user can read."""
    return user


# Legacy: keep get_current_admin for backward compatibility (same as get_current_user)
get_current_admin = get_current_user


# ── Router ─────────────────────────────────────────────────────
from fastapi import APIRouter

auth_router = APIRouter(prefix="/api/auth", tags=["auth"])


@auth_router.post("/login", response_model=Token)
def login(form: OAuth2PasswordRequestForm = Depends()):
    """
    Exchange username+password for a JWT token.
    Returns token with user id, role, and expiry.
    """
    # 2026-06-14 — DB unreachable ≠ bad credentials.  A connection failure
    # here must surface as a distinct 503 so the login UI shows "Server not
    # connected" instead of the misleading "Invalid credentials".
    try:
        user = get_user_from_db(form.username)
    except (psycopg2.OperationalError, psycopg2.InterfaceError) as _exc:
        print(f"[LOGIN] DB unreachable: {_exc}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Server not connected — database unreachable.",
        )
    if not user or not verify_password(form.password, user["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
        )

    # Update last_login + write AUTH_LOGIN audit row in one round-trip
    # 2026-05-18 — Operator audit-log spec: every successful login lands
    # in maintenance_audit_log so the "every user · last login" top card on the
    # Audit page and the per-user activity trail both work.  user_id +
    # username columns were added in the same release.
    with get_conn() as conn:
        c = conn.cursor()
        c.execute(
            "UPDATE maintenance_users SET last_login = NOW() WHERE username = %s",
            (form.username,)
        )
        try:
            c.execute(
                """INSERT INTO maintenance_audit_log
                       (action, entity_type, entity_id, details,
                        user_id, username)
                   VALUES (%s, %s, %s, %s, %s, %s)""",
                ("AUTH_LOGIN", "user", user["id"],
                 f"role={user['role']}",
                 user["id"], form.username)
            )
        except Exception as _exc:
            # Audit failure must never block login — log and continue
            print(f"[AUDIT] login write failed: {_exc}")

    token = create_token(form.username, user["role"], user["id"])
    return Token(
        access_token=token,
        token_type="bearer",
        username=form.username,
        user_id=user["id"],
        role=user["role"],
        expires_in=TOKEN_EXPIRE_HOURS * 3600,
    )


@auth_router.post("/change-password")
def change_password(
    body: dict,
    user=Depends(get_current_user)
):
    """Change password for the authenticated user."""
    if not verify_password(body.get("current_password", ""), user["password_hash"]):
        raise HTTPException(400, "Current password is incorrect")

    new_hash = hash_password(body["new_password"])
    with get_conn() as conn:
        conn.cursor().execute(
            "UPDATE maintenance_users SET password_hash = %s WHERE username = %s",
            (new_hash, user["username"])
        )
        # Audit-trail
        try:
            conn.cursor().execute(
                """INSERT INTO maintenance_audit_log
                       (action, entity_type, entity_id, details,
                        user_id, username)
                   VALUES (%s, %s, %s, %s, %s, %s)""",
                ("PASSWORD_CHANGED", "user", user["id"],
                 "self-service password change",
                 user["id"], user["username"])
            )
        except Exception as _exc:
            print(f"[AUDIT] password-change write failed: {_exc}")
    return {"ok": True, "message": "Password changed successfully"}


@auth_router.get("/me")
def me(user=Depends(get_current_user)):
    """Return current user info (no password hash).  Joins department row
    so the frontend can render '{DeptName} Panel' in the slide-nav for
    department users without a separate fetch.

    Also returns the explicit per-page permission map so AuthContext's
    canAccess() / canWrite() can honor admin-configured overrides
    without an extra round-trip on every page load."""
    permissions = {}    # { page_key: perm_level }
    with get_conn() as conn:
        cur = dict_cursor(conn)
        # Permissions table naye install par shayad na ho — /me kabhi na fate.
        try:
            cur.execute("""
                SELECT page_key, perm_level
                  FROM maintenance_user_permissions
                 WHERE user_id = %s
            """, (user["id"],))
            for row in cur.fetchall():
                permissions[row["page_key"]] = row["perm_level"]
        except Exception:
            pass
    return {
        "id":              user["id"],
        "username":        user["username"],
        "role":            user["role"],
        "last_login":      user["last_login"],
        "created_at":      user["created_at"],
        "permissions":     permissions,
    }