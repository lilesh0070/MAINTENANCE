"""
routers/study_material.py
=========================
Study Material — maintenance ki padhai ka saamaan.

Yahan MTTR / MTBF / LTTR / KPI / Breakdown / PM / DMC / ANDON / CAPA jaisi
cheezein saaf-saaf likhi rehti hain, taaki naya banda padh kar samajh sake.

Do baatein jaan-boojh kar aisi hain:

1. **Content DB me hai, code me nahi.**  Admin heading ya matter kabhi bhi
   badal sakta hai, aur naya topic jod sakta hai — bina deploy ke.  Isiliye
   koi baat yahan hardcode nahi ki gayi.

2. **Pehli baar par seed hota hai.**  Table khali ho to neeche wale topics
   apne aap bhar jaate hain — warna page khali milta aur koi padhta hi nahi.
   Seed SIRF tab chalta hai jab table BILKUL khali ho, isliye admin ke likhe
   par kabhi nahi chadhta (delete kiya hua topic wapas nahi aata).

Endpoints
---------
GET    /api/study-material/       → saare topic (padhna sab ke liye khula)
GET    /api/study-material/{id}   → ek topic
POST   /api/study-material/       → naya topic        (admin)
PUT    /api/study-material/{id}   → topic badlo       (admin)
DELETE /api/study-material/{id}   → topic hatao       (admin)
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from database import get_conn, dict_cursor
from auth import get_current_user, require_admin

router = APIRouter(prefix="/api/study-material", tags=["study-material"])

_ENSURED = False


# ── seed content ────────────────────────────────────────────────────────────
# Content do alag file me rakha hai taaki maintain karna aasan rahe:
#   study_seed_core.py — Basics / KPI / CAPA / Preventive / ANDON
#   study_seed_tech.py — Sensors / Pneumatic / Hydraulic / Electrical /
#                        Control (PLC-HMI) / Mechanical / Safety
# Har topic: (category, title, body_en, body_hi) — dono zubaan me.
from routers.study_seed_core import CORE
from routers.study_seed_tech import TECH

_SEED = CORE + TECH


def _ensure_table() -> None:
    global _ENSURED
    if _ENSURED:
        return
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS maintenance_study_material (
                id          SERIAL PRIMARY KEY,
                category    VARCHAR(80)  NOT NULL DEFAULT 'General',
                title       VARCHAR(200) NOT NULL,
                body        TEXT         NOT NULL DEFAULT '',
                body_hi     TEXT         NOT NULL DEFAULT '',
                sort_order  INTEGER      NOT NULL DEFAULT 0,
                active      BOOLEAN      NOT NULL DEFAULT TRUE,
                created_by  VARCHAR(120),
                created_at  TIMESTAMP    DEFAULT NOW(),
                updated_by  VARCHAR(120),
                updated_at  TIMESTAMP    DEFAULT NOW()
            )""")
        # Purani table par bhi Hindi ka column jud jaye (pehle sirf English tha)
        cur.execute("""ALTER TABLE maintenance_study_material
                       ADD COLUMN IF NOT EXISTS body_hi TEXT NOT NULL DEFAULT ''""")
        # Seed SIRF bilkul khali table par — admin ke likhe par kabhi na chadhe,
        # aur delete kiya hua topic wapas na aaye.
        cur.execute("SELECT COUNT(*) FROM maintenance_study_material")
        if cur.fetchone()[0] == 0:
            for i, (cat, title, body_en, body_hi) in enumerate(_SEED):
                cur.execute(
                    """INSERT INTO maintenance_study_material
                         (category, title, body, body_hi, sort_order,
                          created_by, updated_by)
                       VALUES (%s, %s, %s, %s, %s, 'system', 'system')""",
                    (cat, title, body_en, body_hi, (i + 1) * 10))
        conn.commit()
    _ENSURED = True


class TopicIn(BaseModel):
    category:   Optional[str] = "General"
    title:      str
    body:       Optional[str] = ""      # English
    body_hi:    Optional[str] = ""      # Hindi
    sort_order: Optional[int] = 0
    active:     Optional[bool] = True


@router.get("/")
def list_topics(include_inactive: bool = Query(False),
                user=Depends(get_current_user)) -> List[dict]:
    """Saare topic.  Padhna sab ke liye khula — likhna sirf admin ka kaam."""
    _ensure_table()
    sql = "SELECT * FROM maintenance_study_material"
    if not include_inactive:
        sql += " WHERE active = TRUE"
    sql += " ORDER BY sort_order, id"
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute(sql)
        return cur.fetchall()


@router.get("/{tid}")
def get_topic(tid: int, user=Depends(get_current_user)) -> dict:
    _ensure_table()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT * FROM maintenance_study_material WHERE id = %s", (tid,))
        row = cur.fetchone()
    if not row:
        raise HTTPException(404, "Topic not found")
    return row


@router.post("/", status_code=201)
def add_topic(t: TopicIn, user=Depends(require_admin)) -> dict:
    _ensure_table()
    if not (t.title or "").strip():
        raise HTTPException(400, "Title required")
    with get_conn() as conn:
        cur = dict_cursor(conn)
        order = t.sort_order
        if not order:            # na diya ho to sabse aakhir me lag jaye
            cur.execute("""SELECT COALESCE(MAX(sort_order), 0) + 10 AS n
                             FROM maintenance_study_material""")
            order = cur.fetchone()["n"]
        cur.execute(
            """INSERT INTO maintenance_study_material
                 (category, title, body, body_hi, sort_order, active,
                  created_by, updated_by)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING *""",
            ((t.category or "General").strip(), t.title.strip(), t.body or "",
             t.body_hi or "", order, True if t.active is None else t.active,
             user["username"], user["username"]))
        row = cur.fetchone()
        conn.commit()
    return row


@router.put("/{tid}")
def edit_topic(tid: int, t: TopicIn, user=Depends(require_admin)) -> dict:
    """Heading, matter, category, kram — kuch bhi badla ja sakta hai."""
    _ensure_table()
    if not (t.title or "").strip():
        raise HTTPException(400, "Title required")
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            """UPDATE maintenance_study_material
                  SET category=%s, title=%s, body=%s, body_hi=%s, sort_order=%s,
                      active=%s, updated_by=%s, updated_at=NOW()
                WHERE id=%s RETURNING *""",
            ((t.category or "General").strip(), t.title.strip(), t.body or "",
             t.body_hi or "", t.sort_order or 0,
             True if t.active is None else t.active,
             user["username"], tid))
        row = cur.fetchone()
        conn.commit()
    if not row:
        raise HTTPException(404, "Topic not found")
    return row


@router.delete("/{tid}")
def del_topic(tid: int, user=Depends(require_admin)) -> dict:
    _ensure_table()
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM maintenance_study_material WHERE id=%s", (tid,))
        n = cur.rowcount
        conn.commit()
    if not n:
        raise HTTPException(404, "Topic not found")
    return {"ok": True, "deleted": tid}
