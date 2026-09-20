"""
routers/capa_logbook.py
=======================
CAPA driven directly by the Break Down Slip table (`maintenance_breakdown_data`) — the
SAME source the Maintenance-KPI / BD-History / BD-Analysis pages compute
from, so the CAPA counts always reconcile with those pages.

Rule: every breakdown whose repair duration (mc_down_time_minutes, numeric)
reaches the CAPA down-time limit is automatically a CAPA.  The limit is
**55 minutes by default** and an admin may set a different one for any single
month (same design as the Breakdown-QPR limit) — see /min-config below.

  • OPEN   (Pending)      — its CAPA-QPR has not been completed yet.
  • CLOSED (CAPA Records) — a QPR has been filled and saved for it
                            (maintenance_qpr.logbook_id = breakdown id,
                             capa_status = 'CLOSED').

`maintenance_qpr.logbook_id` stores the **maintenance_breakdown_data id** (since
2026-07-03; it previously pointed at maintenance_logbook_db_history — the
old open stubs were backed up to Phase2/qpr_capa_stubs_backup.csv and
removed during the switch).

Clicking "Start CAPA" opens a QPR (auto-created, pre-filled from the
breakdown) — saving it closes the CAPA and the record lands in the QPR
Filling section.  No manual CAPA creation, no duplicates (starting again
resumes the same QPR).

Endpoints (prefix /api/capa-lb)
-------------------------------
GET  /summary          {open_count, closed_count, open[], closed[]}
POST /start/{bd_id}    Open (or resume) the CAPA-QPR for a breakdown → {qpr_id}
GET  /min-config       {min_down_time_min, months:{'YYYY-MM': n}, updated_at}
PUT  /min-config       admin — set the default, or one month's own limit
DEL  /min-config/{m}   admin — drop that month's limit (back to the default)
"""
import json
import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from database import get_conn, dict_cursor
from auth import get_current_user, require_admin

router = APIRouter(prefix="/api/capa-lb", tags=["capa-logbook"])

# ════════════════════════════════════════════════════════════════════
#  CAPA ki HADD (minute) -- default + MAHINE-WISE
# ════════════════════════════════════════════════════════════════════
# User (2026-09-20): "jaise Breakdown QPR ke liye kar rakha hai ki kitne minute
# se upar ke breakdown ka data aayega -- default 55 aur monthly alag-alag save --
# same CAPA ke liye karna hai."  Isliye bilkul wahi dhancha jo
# `routers/breakdowns.py` ke QPR config me hai:
#   * ek qatar (id=1) wali chhoti table = SAB mahine ki default hadd (55)
#   * `..._month` table me SIRF un mahino ki qatar jinki hadd ALAG rakhi ho
#   * har breakdown APNE mahine (slip_date / bd_start_date) ki hadd se parkha
#     jaata hai -- isliye SQL me `CASE to_char(...) WHEN ... END` banta hai.
# Hadd sirf ADMIN badalta hai; baaki sab sirf dekhte hain (QPR jaisa hi).
#
# ⚠ Pehle yahan pakki `>= 60` likhi thi.  Default ab 55 hai -- yaani 55-59
# minute wale breakdown bhi ab CAPA me aayenge (user ne yahi maanga).
CAPA_DEFAULT_MIN = 55
CAPA_MAX_MIN = 1440          # ek din -- isse upar ki hadd ka koi matlab nahi
_CAPA_MONTH = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
_min_table_ready = False


def _min_ensure(conn):
    global _min_table_ready
    if _min_table_ready:
        return
    cur = conn.cursor()
    cur.execute(f"""
        CREATE TABLE IF NOT EXISTS maintenance_capa_min_config (
            id                 INT PRIMARY KEY DEFAULT 1,
            min_down_time_min  INTEGER NOT NULL DEFAULT {CAPA_DEFAULT_MIN},
            updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )""")
    cur.execute("""
        CREATE TABLE IF NOT EXISTS maintenance_capa_min_month (
            month              VARCHAR(7) PRIMARY KEY,
            min_down_time_min  INTEGER NOT NULL,
            updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )""")
    conn.commit()
    _min_table_ready = True


def _min_config(cur):
    """Poori hadd ek saath: default + jin mahino ki alag rakhi hai."""
    cur.execute("SELECT min_down_time_min, updated_at "
                "FROM maintenance_capa_min_config WHERE id = 1")
    r = cur.fetchone()
    cur.execute("SELECT month, min_down_time_min FROM maintenance_capa_min_month ORDER BY month")
    months = {m["month"]: int(m["min_down_time_min"]) for m in (cur.fetchall() or [])}
    return {"min_down_time_min": int(r["min_down_time_min"]) if r else CAPA_DEFAULT_MIN,
            "months": months,
            "updated_at": r["updated_at"].isoformat() if r and r["updated_at"] else None}


def _min_sql(cfg, p="bd."):
    """Hadd ka SQL tukda -- `<p>mc_down_time_minutes >= <us mahine ki hadd>`.

    Number hi jaate hain (month regex se parkha, minute int me badla), isliye
    seedha jodna mehfooz hai.  `p` = table ka alias ('bd.' ya khaali)."""
    d = int(cfg["min_down_time_min"])
    months = cfg.get("months") or {}
    if not months:
        return f"{p}mc_down_time_minutes >= {d}"
    whens = " ".join(f"WHEN '{m}' THEN {int(v)}" for m, v in months.items()
                     if _CAPA_MONTH.match(str(m)))
    if not whens:
        return f"{p}mc_down_time_minutes >= {d}"
    return (f"{p}mc_down_time_minutes >= CASE "
            f"to_char(COALESCE({p}slip_date, {p}bd_start_date), 'YYYY-MM') "
            f"{whens} ELSE {d} END")


def _min_where(conn, p="bd.", bhi=None):
    """Hadd ki shart, aur `bhi` diya ho to "ya jiski CAPA pehle se khuli hai".

    Admin hadd BADHA de to jo CAPA pehle se shuru/bhari padi hai wo list se
    gayab nahi honi chahiye -- warna bhara hua kaam dikhna hi band ho jaata.
    Isliye wahan `bhi` me wo shart aati hai ("iski sheet/QPR maujood hai")."""
    _min_ensure(conn)
    sql = _min_sql(_min_config(dict_cursor(conn)), p)
    return f"({sql}{' OR ' + bhi if bhi else ''})"


def _min_month_ok(month):
    if not month or not _CAPA_MONTH.match(month):
        raise HTTPException(status_code=400, detail="Month must be YYYY-MM")
    return month


def _author(user) -> str:
    if isinstance(user, dict):
        return user.get("username") or user.get("name") or "user"
    return getattr(user, "username", None) or "user"


def _ensure_qpr():
    # make sure maintenance_qpr + its capa columns exist
    import routers.qpr as q
    q._ensure_table()


def _num(v):
    """Decimal → int when whole (155.0 → 155), else float."""
    if v is None:
        return None
    f = float(v)
    return int(f) if f == int(f) else f


# ⚠ Model apne endpoint se PEHLE -- FastAPI decorator lagte hi body ka type
# padh leta hai; neeche likhne par import par hi phat-ta hai.
class CapaMinIn(BaseModel):
    min_down_time_min: int
    month: Optional[str] = None      # 'YYYY-MM' -> sirf us mahine ki; khaali -> default


@router.get("/min-config")
def get_min_config(user=Depends(get_current_user)):
    """CAPA ki hadd (minute) -- har signed-in user padh sakta hai."""
    with get_conn() as conn:
        _min_ensure(conn)
        return _min_config(dict_cursor(conn))


@router.put("/min-config")
def set_min_config(body: CapaMinIn, admin=Depends(require_admin)):
    """Hadd badlo -- SIRF admin.  `month` diya to sirf us mahine ki, warna
    default (sab mahine jinki alag nahi rakhi).  0 se 1440 ke bahar ka number
    kinare par le aate hain; jawab me poori hadd jo SACH ME save hui."""
    mins = max(0, min(CAPA_MAX_MIN, int(body.min_down_time_min)))
    month = (body.month or "").strip()
    with get_conn() as conn:
        _min_ensure(conn)
        cur = dict_cursor(conn)
        if month:
            _min_month_ok(month)
            cur.execute("""
                INSERT INTO maintenance_capa_min_month (month, min_down_time_min, updated_at)
                VALUES (%s, %s, NOW())
                ON CONFLICT (month) DO UPDATE
                   SET min_down_time_min = EXCLUDED.min_down_time_min, updated_at = NOW()""",
                        (month, mins))
        else:
            cur.execute("""
                INSERT INTO maintenance_capa_min_config (id, min_down_time_min, updated_at)
                VALUES (1, %s, NOW())
                ON CONFLICT (id) DO UPDATE
                   SET min_down_time_min = EXCLUDED.min_down_time_min, updated_at = NOW()""",
                        (mins,))
        conn.commit()
        return _min_config(cur)


@router.delete("/min-config/{month}")
def reset_min_month(month: str, admin=Depends(require_admin)):
    """Us mahine ki alag hadd hatao -- wo mahina wapas default par.  SIRF admin."""
    _min_month_ok(month)
    with get_conn() as conn:
        _min_ensure(conn)
        cur = dict_cursor(conn)
        cur.execute("DELETE FROM maintenance_capa_min_month WHERE month = %s", (month,))
        conn.commit()
        return _min_config(cur)


@router.get("/summary")
def summary(user=Depends(get_current_user)):
    _ensure_qpr()
    with get_conn() as conn:
        # hadd + "ya jiski QPR pehle se hai" (khuli CAPA kabhi gayab na ho)
        shart = _min_where(conn, "bd.", "q.qpr_id IS NOT NULL")
        cur = dict_cursor(conn)
        # LEFT JOIN LATERAL that picks ONE QPR per breakdown and PREFERS a CLOSED
        # one — so once a CAPA has been closed it can never reappear as Open, even
        # if a stray/legacy duplicate QPR exists.  (The unique index on logbook_id
        # normally prevents duplicates in the first place; this is belt-and-braces
        # and also makes the row choice deterministic.)
        cur.execute(f"""
            SELECT bd.id,
                   bd.zone AS zone_name,
                   bd.line AS line_name,
                   bd.machine_no, bd.machine_name,
                   COALESCE(bd.slip_date, bd.bd_start_date)  AS bd_date,
                   bd.problem_reported_by_production          AS problem_production,
                   bd.problem_observed_by_maintenance                 AS problem_maintenance,
                   bd.action_taken_on_problem                 AS action_taken,
                   bd.mc_down_time_minutes                    AS solve_time_min,
                   bd.bd_attended_by                          AS attended_by,
                   q.qpr_id, q.qpr_no, q.capa_status
              FROM maintenance_breakdown_data bd
              LEFT JOIN LATERAL (
                   SELECT mq.id AS qpr_id, mq.qpr_no, mq.capa_status
                     FROM maintenance_qpr mq
                    WHERE mq.logbook_id = bd.id
                    ORDER BY (mq.capa_status = 'CLOSED') DESC, mq.id DESC
                    LIMIT 1
              ) q ON TRUE
             WHERE {shart}
             ORDER BY COALESCE(bd.slip_date, bd.bd_start_date) DESC NULLS LAST, bd.id DESC
        """)
        rows = cur.fetchall()

    seen, opens, closed = set(), [], []
    for r in rows:
        if r["id"] in seen:
            continue
        seen.add(r["id"])
        rec = {
            "logbook_id": r["id"], "zone_name": r["zone_name"], "line_name": r["line_name"],
            "machine_no": r["machine_no"], "machine_name": r["machine_name"],
            "bd_date": r["bd_date"].isoformat() if r["bd_date"] else None,
            "problem": r["problem_maintenance"] or r["problem_production"] or "",
            "action_taken": r["action_taken"] or "",
            "duration_min": _num(r["solve_time_min"]), "attended_by": r["attended_by"] or "",
            "qpr_id": r["qpr_id"], "qpr_no": r["qpr_no"],
        }
        if r["capa_status"] == "CLOSED":
            closed.append(rec)
        else:
            opens.append(rec)

    return {"open_count": len(opens), "closed_count": len(closed),
            "open": opens, "closed": closed}


@router.post("/start/{bd_id}", status_code=201)
def start_capa(bd_id: int, user=Depends(get_current_user)):
    _ensure_qpr()
    with get_conn() as conn:
        # hadd, ya jiski QPR pehle se khul chuki ho (hadd badhne par bhi khule
        # CAPA par "Start / Resume" chalta rahe)
        shart = _min_where(conn, "bd.",
                           "EXISTS (SELECT 1 FROM maintenance_qpr mq WHERE mq.logbook_id = bd.id)")
        cur = dict_cursor(conn)
        cur.execute(f"""SELECT bd.id, bd.zone AS zone_code,
                               COALESCE(bd.slip_date, bd.bd_start_date) AS bd_date,
                               bd.problem_reported_by_production AS problem_production,
                               bd.problem_observed_by_maintenance AS problem_maintenance,
                               bd.machine_name, bd.machine_no,
                               bd.bd_attended_by AS attended_by
                          FROM maintenance_breakdown_data bd
                         WHERE bd.id=%s AND {shart}""", (bd_id,))
        bd = cur.fetchone()
        if not bd:
            raise HTTPException(404, "This breakdown is below the CAPA down-time limit")

        # already started? → return the existing CAPA-QPR (no duplicate)
        cur.execute("SELECT id, qpr_no FROM maintenance_qpr WHERE logbook_id=%s", (bd_id,))
        ex = cur.fetchone()
        if ex:
            return {"qpr_id": ex["id"], "qpr_no": ex["qpr_no"], "resumed": True}

        # pre-fill a QPR payload from the breakdown
        payload = {
            "location": bd["zone_code"] or "",
            "qpr_date": bd["bd_date"].isoformat() if bd["bd_date"] else "",
            "reported_problem": bd["problem_production"] or bd["problem_maintenance"] or "",
            "defect_confirmation": bd["problem_maintenance"] or "",
            "w_what": bd["problem_maintenance"] or "",
            "part_name": bd["machine_name"] or "",
            "qpr_raised_by": bd["attended_by"] or "",
        }
        cur2 = conn.cursor()
        cur2.execute("SELECT COALESCE(MAX(qpr_no),0)+1 FROM maintenance_qpr")
        next_no = cur2.fetchone()[0]
        title = f"CAPA · {bd['machine_no'] or bd['machine_name'] or ''} · QPR No. {next_no}"
        # ON CONFLICT makes the create atomic vs the unique index on logbook_id:
        # if a concurrent "Start CAPA" (double-click / another tab) already made
        # the QPR, our insert is skipped and we resume the existing one — never a
        # duplicate.
        cur2.execute(
            """INSERT INTO maintenance_qpr (qpr_no, title, payload, logbook_id, capa_status, created_by)
               VALUES (%s, %s, %s::jsonb, %s, 'OPEN', %s)
               ON CONFLICT (logbook_id) WHERE logbook_id IS NOT NULL DO NOTHING
               RETURNING id""",
            (next_no, title, json.dumps(payload), bd_id, _author(user)),
        )
        row = cur2.fetchone()
        conn.commit()
        if row is None:                       # lost the race — resume the winner
            cur.execute("SELECT id, qpr_no FROM maintenance_qpr WHERE logbook_id=%s", (bd_id,))
            ex = cur.fetchone()
            return {"qpr_id": ex["id"], "qpr_no": ex["qpr_no"], "resumed": True}
        new_id = row[0]
    return {"qpr_id": new_id, "qpr_no": next_no, "resumed": False}


# ─────────────────────────────────────────────────────────────────────────────
# NEW CAPA / QPR SHEET  (capa.xlsx format — the full fillable QUALITY PROBLEM
# REPORT sheet).  Standalone from the breakdown-driven flow above: the whole
# form is stored as a flat {cell_name: value} JSONB map (cell names f_<row>_<col>
# match the generated grid).  A few key cells are mirrored into columns for the
# list / filtering.
# ─────────────────────────────────────────────────────────────────────────────
_QPR_NO_KEY  = "f_4_13"    # M4  — QPR No.
_TITLE_KEY   = "f_16_3"    # C16 — Reported Problem
_MC_KEY      = "f_mno"     # MACHINE_NO value (machine section cell)

_CAPA_DDL = False


def _ensure_capa_sheet():
    global _CAPA_DDL
    if _CAPA_DDL:
        return
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS maintenance_capa_sheet (
                id          SERIAL PRIMARY KEY,
                qpr_no      TEXT,
                machine_no  TEXT,
                zone        TEXT,
                line        TEXT,
                title       TEXT,
                status      TEXT DEFAULT 'DRAFT',
                data        JSONB DEFAULT '{}'::jsonb,
                created_by  TEXT,
                created_at  TIMESTAMP DEFAULT NOW(),
                updated_by  TEXT,
                updated_at  TIMESTAMP DEFAULT NOW()
            )
        """)
        # link a saved QPR sheet back to the ≥60-min breakdown it belongs to
        cur.execute("ALTER TABLE maintenance_capa_sheet ADD COLUMN IF NOT EXISTS breakdown_id INTEGER")
        conn.commit()
    _CAPA_DDL = True


@router.get("/pending")
def capa_pending(user=Depends(get_current_user)):
    """Every manual-slip breakdown whose repair took at least the CAPA down-time
    limit (default 55 min, per-month overrides — GET /min-config) is a CAPA.
    Returns each with machine_no / machine_name / date / model + whether
    its QPR sheet is started (sheet_id) yet."""
    _ensure_capa_sheet()
    with get_conn() as conn:
        # hadd + "ya jiski sheet pehle se hai" (bhari CAPA kabhi gayab na ho)
        shart = _min_where(conn, "bd.", "s.id IS NOT NULL")
        cur = dict_cursor(conn)
        cur.execute(f"""
            SELECT bd.id AS bd_id, bd.machine_no, bd.machine_name,
                   COALESCE(bd.slip_date, bd.bd_start_date) AS bd_date,
                   bd.model_no, bd.mc_down_time_minutes AS duration_min,
                   bd.zone AS zone_name, bd.line AS line_name,
                   COALESCE(bd.problem_observed_by_maintenance, '')  AS problem_maintenance,
                   COALESCE(bd.action_taken_on_problem, '')          AS action_taken,
                   COALESCE(bd.bd_attended_by, '')                   AS attended_by,
                   -- QPR ke "Who?" me jaata hai (slip ka LINE LEADER NAME)
                   COALESCE(bd.line_leader_name, '')                 AS line_leader_name,
                   COALESCE(NULLIF(bd.problem_observed_by_maintenance,''),
                            bd.problem_reported_by_production, '') AS problem,
                   s.id AS sheet_id, s.status AS sheet_status, s.qpr_no
              FROM maintenance_breakdown_data bd
              LEFT JOIN LATERAL (
                   SELECT id, status, qpr_no FROM maintenance_capa_sheet
                    WHERE breakdown_id = bd.id ORDER BY id DESC LIMIT 1
              ) s ON TRUE
             WHERE {shart}
             ORDER BY COALESCE(bd.slip_date, bd.bd_start_date) DESC NULLS LAST, bd.id DESC
        """)
        rows = cur.fetchall()
    for r in rows:
        if r.get("bd_date"):
            r["bd_date"] = r["bd_date"].isoformat()
        r["duration_min"] = _num(r["duration_min"])
    pend = sum(1 for r in rows if not r["sheet_id"])
    return {"rows": rows, "total": len(rows), "pending": pend, "done": len(rows) - pend}


class CapaSheet(BaseModel):
    id:           Optional[int] = None
    data:         dict = {}
    qpr_no:       Optional[str] = ""
    machine_no:   Optional[str] = ""
    zone:         Optional[str] = ""
    line:         Optional[str] = ""
    title:        Optional[str] = ""
    status:       Optional[str] = "DRAFT"
    breakdown_id: Optional[int] = None


@router.get("/sheets")
def list_capa_sheets(user=Depends(get_current_user)):
    """Saved QPR sheets — newest first (no data blob, just the list fields)."""
    _ensure_capa_sheet()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("""SELECT id, qpr_no, machine_no, zone, line, title, status,
                              created_by, created_at, updated_by, updated_at
                         FROM maintenance_capa_sheet
                        ORDER BY updated_at DESC NULLS LAST, id DESC LIMIT 500""")
        rows = cur.fetchall()
    for r in rows:
        for k in ("created_at", "updated_at"):
            if r.get(k):
                r[k] = r[k].isoformat()
    return {"rows": rows}


@router.get("/sheet/{sid}")
def get_capa_sheet(sid: int, user=Depends(get_current_user)):
    """One saved QPR sheet with its full {cell: value} data map."""
    _ensure_capa_sheet()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT * FROM maintenance_capa_sheet WHERE id=%s", (sid,))
        r = cur.fetchone()
    if not r:
        raise HTTPException(404, "QPR sheet not found")
    for k in ("created_at", "updated_at"):
        if r.get(k):
            r[k] = r[k].isoformat()
    return r


@router.post("/sheet")
def save_capa_sheet(body: CapaSheet, user=Depends(get_current_user)):
    """Create a new QPR sheet, or update an existing one (when `id` is sent).
    The whole form rides in `data`; qpr_no / machine_no / title are pulled from
    known cells unless the caller sent them."""
    _ensure_capa_sheet()
    d = body.data or {}
    qpr_no = (body.qpr_no or str(d.get(_QPR_NO_KEY) or "")).strip()
    machine = (body.machine_no or str(d.get(_MC_KEY) or "")).strip()
    title = (body.title or str(d.get(_TITLE_KEY) or "")).strip()
    status = (body.status or "DRAFT").strip() or "DRAFT"
    who = _author(user)
    with get_conn() as conn:
        cur = conn.cursor()
        if body.id:
            cur.execute("""UPDATE maintenance_capa_sheet
                              SET data=%s::jsonb, qpr_no=%s, machine_no=%s, zone=%s, line=%s,
                                  title=%s, status=%s, updated_by=%s, updated_at=NOW()
                            WHERE id=%s RETURNING id""",
                        (json.dumps(d), qpr_no, machine, body.zone or "", body.line or "",
                         title, status, who, body.id))
            row = cur.fetchone()
            if not row:
                raise HTTPException(404, "QPR sheet not found")
            sid = row[0]
        else:
            cur.execute("""INSERT INTO maintenance_capa_sheet
                              (qpr_no, machine_no, zone, line, title, status, data,
                               breakdown_id, created_by, updated_by)
                            VALUES (%s,%s,%s,%s,%s,%s,%s::jsonb,%s,%s,%s) RETURNING id""",
                        (qpr_no, machine, body.zone or "", body.line or "", title, status,
                         json.dumps(d), body.breakdown_id, who, who))
            sid = cur.fetchone()[0]
        conn.commit()
    return {"ok": True, "id": sid}


@router.delete("/sheet/{sid}")
def delete_capa_sheet(sid: int, admin=Depends(require_admin)):
    """CAPA/QPR sheet mitao — SIRF admin.

    ⚠ 2026-09-08 me DO CHEEZEIN THEEK KI GAYIN:
      1. Pehle yahan `get_current_user` tha — yaani KOI BHI logged-in user
         kisi ki bhi CAPA mita sakta tha.  Ab `require_admin`.
      2. Audit likha hi nahi jaata tha.  Delete wapas nahi aata, isliye kam
         se kam nishan to rehna chahiye — ab `write_audit` hota hai.

    Is sheet par koi doosri table ishara nahi karti (`breakdown_id` isse
    BAHAR ki taraf jaata hai, andar ki taraf nahi), isliye saath me kuch aur
    hatane ki zaroorat nahi.
    """
    _ensure_capa_sheet()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT * FROM maintenance_capa_sheet WHERE id=%s", (sid,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "QPR sheet not found")
        cur.execute("DELETE FROM maintenance_capa_sheet WHERE id=%s", (sid,))

        try:
            from main import write_audit
            write_audit(conn, action="CAPA_SHEET_DELETE",
                        entity_type="maintenance_capa_sheet", entity_id=sid,
                        details=(f"CAPA #{sid} · qpr_no={row.get('qpr_no')} · "
                                 f"{row.get('zone')}/{row.get('line')}/{row.get('machine_no')} · "
                                 f"status={row.get('status')} · "
                                 f"breakdown_id={row.get('breakdown_id')} · "
                                 f"created_by={row.get('created_by')}"),
                        user=admin)
        except Exception as e:
            print(f"[CAPA] sheet-delete ka audit nahi likha: {e}")

        conn.commit()
    return {"ok": True, "deleted": sid}


@router.get("/closed")
def closed_capa(user=Depends(get_current_user)):
    """CLOSE ho chuki CAPA — Historical Data ka "CAPA (Closed)" section isi se
    bharta hai.

    Sirf `status = 'CLOSED'` wali sheets.  Jab tak koi CAPA close nahi hoti,
    ye khali rehta hai — yahi user ki shart thi ("close hone ke BAAD hi yahan
    aayega").

    Date breakdown ki hoti hai (jab dikkat hui), sheet ke save-time ki nahi —
    Historical ke baaki saare section bhi kaam ki date par filter hote hain.
    """
    _ensure_capa_sheet()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("""
            SELECT s.id, s.qpr_no, s.title, s.status, s.breakdown_id,
                   COALESCE(NULLIF(TRIM(s.machine_no),''), bd.machine_no) AS machine_no,
                   -- zone_name / line_name naam se bhejte hain: Historical Data ka
                   -- `planMatch()` inhi naamo par filter karta hai (baaki sab section
                   -- bhi yahi bhejte hain), to wahan koi alag handling nahi chahiye.
                   COALESCE(NULLIF(TRIM(s.zone),''),  bd.zone)  AS zone_name,
                   COALESCE(NULLIF(TRIM(s.line),''),  bd.line)  AS line_name,
                   bd.machine_name,
                   COALESCE(bd.slip_date, bd.bd_start_date) AS bd_date,
                   bd.mc_down_time_minutes AS duration_min,
                   COALESCE(NULLIF(bd.problem_observed_by_maintenance,''),
                            bd.problem_reported_by_production, '') AS problem,
                   s.updated_by AS closed_by, s.updated_at AS closed_at,
                   s.created_by, s.created_at
              FROM maintenance_capa_sheet s
              LEFT JOIN maintenance_breakdown_data bd ON bd.id = s.breakdown_id
             WHERE UPPER(COALESCE(s.status,'')) = 'CLOSED'
             ORDER BY COALESCE(bd.slip_date, bd.bd_start_date, s.created_at::date) DESC NULLS LAST,
                      s.id DESC
        """)
        rows = cur.fetchall()
    for r in rows:
        for k in ("bd_date", "closed_at", "created_at"):
            if r.get(k) is not None and hasattr(r[k], "isoformat"):
                r[k] = r[k].isoformat()
        r["duration_min"] = _num(r["duration_min"])
    return {"rows": rows, "total": len(rows)}
