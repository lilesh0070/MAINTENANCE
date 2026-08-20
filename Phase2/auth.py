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
import time
from datetime import datetime, timedelta
from typing import Optional

import bcrypt
from fastapi import Depends, HTTPException, status, Request
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
    now = datetime.utcnow()
    expire = now + timedelta(hours=TOKEN_EXPIRE_HOURS)
    return jwt.encode(
        # `iat` (issued-at) zaroori hai — password badalne par is se purane token
        # invalid ho jaate hain (get_current_user me pwd_changed_at se compare).
        {"sub": username, "exp": expire, "iat": int(time.time()), "role": role, "id": user_id},
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
    # Password badalne par us se PEHLE bane SAB token turant invalid — user har
    # device/tab se logout ho jaata hai.  JWT stateless hai isliye token ka `iat`
    # ko user ke `pwd_changed_at` (unix-ts, password badalte hi set) se compare
    # karte hain.  Token purana => 401 => frontend login par bhej deta hai.
    pca = user.get("pwd_changed_at")
    if pca is not None:
        iat = payload.get("iat")
        if iat is None or int(iat) < int(pca):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Password badal gaya hai — dobara login karein",
                headers={"WWW-Authenticate": "Bearer"})
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


# ── Login throttle (brute-force rok) ──────────────────────────────────────
# Pehle password anginat baar try kiye ja sakte the — LAN/Tailscale par koi bhi
# chup-chaap dictionary attack chala sakta tha.  Ab ek hi (username, IP) se
# lagataar galat password par thodi der ke liye rok lag jaati hai.
# Sahi password milte hi counter saaf.  Sirf memory me hai (koi DB/table nahi).
_LOGIN_FAILS: dict = {}
_LOGIN_MAX_FAILS  = int(os.getenv("LOGIN_MAX_FAILS", "10") or 10)
_LOGIN_WINDOW_S   = int(os.getenv("LOGIN_FAIL_WINDOW", "300") or 300)   # 5 min
_LOGIN_BLOCK_S    = int(os.getenv("LOGIN_BLOCK_SECONDS", "120") or 120) # 2 min


def _throttle_key(username, request):
    ip = "?"
    try:
        ip = (request.client.host if request and request.client else "?") or "?"
    except Exception:
        pass
    return (str(username or "").strip().lower(), ip)


def _throttle_check(key):
    """Abhi block hai to bache hue second lauta do, warna 0."""
    rec = _LOGIN_FAILS.get(key)
    if not rec:
        return 0
    fails, first, blocked_until = rec
    now = time.time()
    if blocked_until and now < blocked_until:
        return int(blocked_until - now) + 1
    if now - first > _LOGIN_WINDOW_S:          # window nikal gayi — reset
        _LOGIN_FAILS.pop(key, None)
    return 0


def _throttle_fail(key):
    now = time.time()
    fails, first, _ = _LOGIN_FAILS.get(key, (0, now, 0))
    if now - first > _LOGIN_WINDOW_S:
        fails, first = 0, now
    fails += 1
    blocked_until = now + _LOGIN_BLOCK_S if fails >= _LOGIN_MAX_FAILS else 0
    _LOGIN_FAILS[key] = (fails, first, blocked_until)
    if len(_LOGIN_FAILS) > 5000:               # memory na badhe — purane hata do
        for k, v in list(_LOGIN_FAILS.items()):
            if now - v[1] > _LOGIN_WINDOW_S and now > (v[2] or 0):
                _LOGIN_FAILS.pop(k, None)


@auth_router.post("/login", response_model=Token)
def login(request: Request, form: OAuth2PasswordRequestForm = Depends()):
    """
    Exchange username+password for a JWT token.
    Returns token with user id, role, and expiry.
    """
    # 2026-06-14 — DB unreachable ≠ bad credentials.  A connection failure
    # here must surface as a distinct 503 so the login UI shows "Server not
    # connected" instead of the misleading "Invalid credentials".
    _tkey = _throttle_key(form.username, request)
    _wait = _throttle_check(_tkey)
    if _wait:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Bahut baar galat password. {_wait} second baad dobara koshish karein.",
            headers={"Retry-After": str(_wait)},
        )
    try:
        user = get_user_from_db(form.username)
    except (psycopg2.OperationalError, psycopg2.InterfaceError) as _exc:
        print(f"[LOGIN] DB unreachable: {_exc}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Server not connected — database unreachable.",
        )
    if not user or not verify_password(form.password, user["password_hash"]):
        _throttle_fail(_tkey)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
        )
    _LOGIN_FAILS.pop(_tkey, None)          # sahi password -> counter saaf

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


@auth_router.post("/logout")
def logout(user=Depends(get_current_user)):
    """AUTH_LOGOUT audit row.  JWT stateless hai (server-side session nahi) —
    frontend logout par ye best-effort call karta hai sirf audit-trail ke liye,
    taaki "kisne kab logout kiya" bhi maintenance_audit_log me aa jaye."""
    try:
        with get_conn() as conn:
            conn.cursor().execute(
                """INSERT INTO maintenance_audit_log
                       (action, entity_type, entity_id, details, user_id, username)
                   VALUES ('AUTH_LOGOUT', 'user', %s, %s, %s, %s)""",
                (user["id"], f"role={user.get('role')}", user["id"], user["username"]))
    except Exception as _exc:
        print(f"[AUDIT] logout write failed: {_exc}")
    return {"ok": True}


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
            # pwd_changed_at = ABHI ka app-clock unix-ts (wahi jo token iat use karta
            # hai) — DB clock skew se bachne ko DB NOW() nahi.
            "UPDATE maintenance_users SET password_hash = %s, pwd_changed_at = %s "
            "WHERE username = %s",
            (new_hash, int(time.time()), user["username"])
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
    # A transient DB hiccup (busy pool / dropped connection / timeout) must NOT
    # masquerade as "no pages assigned" — that was flashing the 'Koi page assign
    # nahi' screen at users who DO have access.  So: RETRY on a connection error,
    # and if it still fails, return 503 (frontend retries) instead of an EMPTY
    # permission map.  Only a genuinely-missing table (fresh install) falls back
    # to {} — that's a real "no permissions yet" state, not a hiccup.
    err = None
    for attempt in range(3):
        try:
            with get_conn() as conn:
                cur = dict_cursor(conn)
                cur.execute("""SELECT page_key, perm_level
                                 FROM maintenance_user_permissions
                                WHERE user_id = %s""", (user["id"],))
                permissions = {r["page_key"]: r["perm_level"] for r in cur.fetchall()}
            err = None
            break
        except psycopg2.ProgrammingError:                       # table missing (new install)
            permissions = {}; err = None; break
        except (psycopg2.OperationalError, psycopg2.InterfaceError) as e:
            err = e; time.sleep(0.15 * (attempt + 1))          # transient — retry
        except Exception as e:
            err = e; break
    if err is not None:
        raise HTTPException(503, "Permissions temporarily unavailable — please retry")
    return {
        "id":              user["id"],
        "username":        user["username"],
        "role":            user["role"],
        "last_login":      user["last_login"],
        "created_at":      user["created_at"],
        "permissions":     permissions,
    }