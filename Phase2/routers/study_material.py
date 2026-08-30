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
import os
import re
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


# ── translate ───────────────────────────────────────────────────────────────
# Admin ek zubaan me likhe aur doosri apne aap ban jaye.  Par translation ko
# aankh band karke bharosa NAHI karte — technical Hindi me machine translation
# ki sabse aam galti ye hai ki wo technical naam bhi anuvaad kar deta hai
# ("reed switch" -> "सरकंडा स्विच", jo bematlab hai).  Isliye:
#
#   1. Prompt me saaf niyam — prose Devanagari me, par technical naam Latin me
#      hi rahein.  Wahi style jo pehle se 61 topic me hai.
#   2. Jawab par JAANCH — script sahi hai? acronym bache? lambai theek?
#   3. Jaanch fail ho to EK BAAR sudhar ke saath dobara koshish, phir bhi fail
#      ho to SAAF MANA — galat matter chupchap bhar dena isse kahin bura hai,
#      kyunki wo save ho kar mahinon padha jaata rahega.

# Ye naam kabhi anuvaad nahi hone chahiye.  Source me jo mile, output me bhi
# hona chahiye — warna translation ne unhe tod diya hai.
_KEEP_AS_IS = [
    "PLC", "HMI", "VFD", "SMPS", "MCB", "MCCB", "FRL", "SLMP", "MES",
    "MTTR", "MTBF", "LTTR", "CAPA", "QPR", "ANDON", "DMC", "LOTO", "PPE",
    "PNP", "NPN", "RPM", "FLA", "OEE",
]

_DEVANAGARI = re.compile(r"[ऀ-ॿ]")
_LATIN      = re.compile(r"[A-Za-z]")
# "Here is the translation:" / "I cannot" jaisa meta-jawab — matter nahi hai
_META       = re.compile(r"^\s*(here is|here's|sure[,!]|i (cannot|can't|am unable)|"
                         r"translation\s*:|अनुवाद\s*:)", re.I)


class TranslateIn(BaseModel):
    text: str
    to:   Optional[str] = "hi"          # "hi" = Hindi, "en" = English


def _translate_prompt(to_hi: bool) -> str:
    if to_hi:
        return (
            "You translate maintenance training material from English into HINDI "
            "for shop-floor maintenance staff at an auto-parts plant in India.\n\n"
            "RULES - follow every one:\n"
            "1. Write the prose in DEVANAGARI script. Do not use Roman/Hinglish.\n"
            "2. KEEP THESE IN LATIN SCRIPT, EXACTLY AS WRITTEN - never translate or "
            "transliterate them: PLC, HMI, VFD, SMPS, MCB, MCCB, FRL, SLMP, MES, "
            "MTTR, MTBF, LTTR, CAPA, QPR, ANDON, DMC, LOTO, PPE, PNP, NPN, RPM, "
            "FLA, OEE, NO, NC, OK, NG, and all units and values (24V, 4-20 mA, "
            "0-10 V, 5/2, 5-6 bar, mm, kW).\n"
            "3. Common machine part names should be written in Devanagari the way "
            "they are actually SPOKEN on the shop floor - सेंसर, सिलेंडर, वाल्व, "
            "बेयरिंग, कपलिंग, मोटर, पैनल, कॉइल - NOT invented pure-Hindi words. "
            "Never translate 'reed switch' as 'सरकंडा स्विच'; write 'रीड स्विच'.\n"
            "4. Keep the SAME structure - same line breaks, same blank lines, same "
            "bullet or arrow layout, same formulas unchanged.\n"
            "5. Translate the meaning, not word by word. It must read naturally to "
            "a Hindi-speaking technician.\n"
            "6. Output ONLY the translated text. No preface, no notes, no quotes."
        )
    return (
        "You translate maintenance training material from Hindi into clear, simple "
        "ENGLISH for shop-floor maintenance staff.\n\n"
        "RULES:\n"
        "1. Keep all technical terms, acronyms, units and values exactly as they "
        "appear (PLC, HMI, VFD, MTTR, 24V, 4-20 mA, 5/2 ...).\n"
        "2. Keep the SAME structure - same line breaks, blank lines, bullets and "
        "formulas.\n"
        "3. Plain shop-floor English. Short sentences. No flowery language.\n"
        "4. Output ONLY the translated text. No preface, no notes, no quotes."
    )


def _check_translation(src: str, out: str, to_hi: bool):
    """Sahi lage to None, warna wajah (string).  Ye hi wo pehra hai jo galat
    matter ko DB tak nahi pahunchne deta."""
    out = (out or "").strip()
    if not out:
        return "translation khali aayi"
    if _META.search(out):
        return "jawab me matter ke bajaye meta-text aaya"

    dev = len(_DEVANAGARI.findall(out))
    lat = len(_LATIN.findall(out))
    if to_hi:
        # Hindi chahiye thi — Devanagari na ho to translation hui hi nahi
        if dev == 0:
            return "Hindi maangi thi par Devanagari ek bhi akshar nahi"
        if dev < (dev + lat) * 0.30:
            return "zyadatar text Latin me hai, Devanagari bahut kam"
    else:
        if dev > 0:
            return "English maangi thi par Devanagari akshar aaye"

    # Technical naam bache ya nahi
    missing = [w for w in _KEEP_AS_IS
               if re.search(r"\b" + re.escape(w) + r"\b", src)
               and not re.search(r"\b" + re.escape(w) + r"\b", out)]
    if missing:
        return "ye technical naam translation me gayab ho gaye: " + ", ".join(missing)

    # Lambai — kata hua ya bemtlab phaila hua to nahi
    r = len(out) / max(1, len(src))
    if r < 0.45:
        return f"translation bahut chhoti hai (source ka {int(r * 100)}%) — shayad kat gayi"
    if r > 3.0:
        return f"translation bahut lambi hai (source ka {int(r * 100)}%)"

    # Structure — khali line ka dhancha kaafi alag to nahi
    if abs(src.count("\n\n") - out.count("\n\n")) > 2:
        return "paragraph ka dhancha badal gaya"
    return None


@router.post("/translate")
def translate_text(body: TranslateIn, user=Depends(require_admin)) -> dict:
    """Ek zubaan se doosri.  Admin-only.  Jaanch fail hone par 422 — taaki UI
    admin ko bata sake, aur galat matter chup-chaap save na ho jaye."""
    src = (body.text or "").strip()
    if not src:
        raise HTTPException(400, "Text required")
    if len(src) > 20000:
        raise HTTPException(400, "Text too long (20000 characters max)")
    to_hi = (body.to or "hi").lower() != "en"

    if not os.getenv("ANTHROPIC_API_KEY"):
        raise HTTPException(503, "Translation service not configured")

    import anthropic
    client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
    # Translation quality-critical hai aur kabhi-kabhaar hi chalti hai, isliye
    # chat wale Haiku ke bajaye Sonnet — thoda dheema, par kaafi behtar.
    model = os.getenv("AI_TRANSLATE_MODEL", "claude-sonnet-5")

    system = _translate_prompt(to_hi)
    msg    = src
    why    = None
    for attempt in (1, 2):
        try:
            resp = client.messages.create(
                model=model, max_tokens=4000, system=system,
                messages=[{"role": "user", "content": msg}])
        except Exception as e:
            raise HTTPException(502, f"Translation failed: {str(e)[:160]}")
        out = "".join(b.text for b in resp.content if hasattr(b, "text")).strip()
        why = _check_translation(src, out, to_hi)
        if why is None:
            return {"ok": True, "text": out, "to": "hi" if to_hi else "en",
                    "model": model, "attempts": attempt}
        # ek baar aur — is baar galti batakar
        msg = (f"{src}\n\n---\nYour previous attempt was rejected because: {why}. "
               f"Translate again and fix exactly that. Output only the translation.")

    # Do baar me bhi theek nahi hui — bhejo mat, bata do.
    raise HTTPException(
        422, f"Translation ठीक नहीं आई ({why}). Kripya haath se likhein ya dobara koshish karein.")
