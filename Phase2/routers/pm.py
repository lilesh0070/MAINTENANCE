"""
routers/pm.py
=============
Preventive Maintenance (PM) — schedule / planner + reminder-mail config.

2026-07-02 — the CHECK-SHEET module was removed entirely (frontend option,
endpoints and its tables pm_check_sheet / pm_check_master / pm_filled /
pm_fills / pm_points / pm_machines / pm_records were dropped; CSV backups
kept in Phase2/pm_backup_*.csv).  A new check-sheet module will be added
later.

Remaining tables
----------------
  pm_schedule     — the PM planner/schedule (one row per planned PM).
  pm_mail_config  — single-row reminder recipient config.
  pm_mail_log     — idempotence log for the reminder worker (pm_mail.py).

Endpoints (prefix /api/pm)
--------------------------
GET    /dashboard          Schedule-driven dashboard (this month + next)
GET    /schedule           List planned PMs (?month=YYYY-MM)
POST   /schedule           Plan a PM (optionally repeat 12 months)
PATCH  /schedule/{sid}     Update status / due date
DELETE /schedule/{sid}     Remove a plan
GET    /mail-config        Reminder recipient config
PUT    /mail-config        Save reminder recipient config
"""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from database import get_conn, dict_cursor
from auth import get_current_user

router = APIRouter(prefix="/api/pm", tags=["pm"])


# ════════════════════════════════════════════════════════════════════
# CHECK-SHEET FORMAT  (from 'PM CHECK SHEET FORMAT.xlsx' — layout only;
# the per-machine check-POINTS table comes later as a separate module)
# ════════════════════════════════════════════════════════════════════
# The blank TBDI PM check-sheet format, saved verbatim in the table
# maintenance_pm_check_sheet_format so the frontend renders it from the DB.
_PM_FORMAT = {
    "company": "TOYOTA BOSHOKU DEVICE INDIA PVT LTD",
    "title": "PREVENTIVE MAINTENANCE CHECK SHEET",
    "rev_box": {"title": "Check Sheet Points Revision History",
                "fields": ["Rev No.", "Rev Date"]},
    "header_fields": [
        {"key": "zone",         "label": "ZONE"},
        {"key": "machine_name", "label": "MACHINE_NAME"},
        {"key": "line",         "label": "LINE"},
        {"key": "dept",         "label": "Deptt:-", "default": "Maintenance"},
        {"key": "machine_no",   "label": "MACHINE_NO"},
        {"key": "pm_date",      "label": "PM Date:"},
        {"key": "month",        "label": "Month :"},
        {"key": "pm_team",      "label": "PM Team Name:"},
    ],
    "columns": ["S.NO.", "CHECK POINTS / DETAIL OF WORK", "JUDGEMENT STANDARD",
                "METHOD", "OBSERVATION OF CHECK POINTS", "ACTION TAKEN",
                "SPARES USED", "STATUS", "SIGN."],
    "blank_rows": 21,
    "signoff": [
        {"label": "PREPARED BY:-", "caption": "( TEAM MEMBER - MAINTENANCE )"},
        {"label": "CHECKED BY:-",  "caption": "( ENGINEER - MAINTENANCE )"},
        {"label": "APPROVED BY:-", "caption": "( IN-CHARGE MAINTENANCE )"},
    ],
    # document-control footer shown at the very bottom of the sheet
    "doc_footer": {"format_no": "TBDI / MAINT. / F / 011",
                   "rev_no": "00", "rev_date": "20/3/2024"},
}


def _ensure_format_table() -> None:
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS maintenance_pm_check_sheet_format (
                id          SERIAL PRIMARY KEY,
                name        VARCHAR(120) UNIQUE NOT NULL,
                format      JSONB NOT NULL DEFAULT '{}'::jsonb,
                created_at  TIMESTAMP DEFAULT NOW(),
                updated_at  TIMESTAMP DEFAULT NOW()
            )
        """)
        # seed / refresh the standard format row
        cur.execute("""
            INSERT INTO maintenance_pm_check_sheet_format (name, format)
            VALUES ('PM CHECK SHEET FORMAT', %s::jsonb)
            ON CONFLICT (name) DO NOTHING
        """, (json.dumps(_PM_FORMAT),))
        # patch existing rows that predate the doc-control footer (idempotent —
        # only fills it in where missing, without touching other keys)
        cur.execute("""
            UPDATE maintenance_pm_check_sheet_format
               SET format = format || %s::jsonb
             WHERE NOT (format ? 'doc_footer')
        """, (json.dumps({"doc_footer": _PM_FORMAT["doc_footer"]}),))
        # the Yearly PM Schedule shares the same doc-control footer mechanism.
        # Its LAYOUT is generated in code (see /yearly-schedule); only the
        # editable footer (Format No / Rev No / Rev Date) is stored here.
        cur.execute("""
            INSERT INTO maintenance_pm_check_sheet_format (name, format)
            VALUES ('YEARLY PM SCHEDULE FORMAT', %s::jsonb)
            ON CONFLICT (name) DO NOTHING
        """, (json.dumps({"doc_footer": {"format_no": "", "rev_no": "", "rev_date": ""}}),))
        conn.commit()


# formats whose document-control footer is editable from the Maintenance
# Panel → PM Check Sheet → Format dropdown.  (name, dropdown label)
_EDITABLE_FORMATS = [
    ("PM CHECK SHEET FORMAT",     "PM CHECK SHEET"),
    ("YEARLY PM SCHEDULE FORMAT", "YEARLY PM SCHEDULE"),
]


def _get_doc_footer(name: str) -> dict:
    """Read a format's document-control footer (Format No / Rev No / Rev Date)."""
    _ensure_format_table()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT format->'doc_footer' AS df "
                    "FROM maintenance_pm_check_sheet_format WHERE name=%s", (name,))
        row = cur.fetchone()
    df = (row["df"] if row else None) or {}
    return {"format_no": df.get("format_no", ""),
            "rev_no":    df.get("rev_no", ""),
            "rev_date":  df.get("rev_date", "")}


# ── Revision history for check points ────────────────────────────────
# maintenance_pm_check_point always holds the CURRENT revision's points.
# When the admin bumps the revision (new rev_no must be numerically
# GREATER), the current snapshot is archived per-machine into
# maintenance_pm_check_point_rev under the OLD rev — so any previous rev
# can be viewed point-by-point later.
def _ensure_cp_rev_table() -> None:
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS maintenance_pm_check_point_rev (
                id                 SERIAL PRIMARY KEY,
                zone               VARCHAR(80),
                line               VARCHAR(80),
                machine_no         VARCHAR(80),
                machine_name       VARCHAR(200),
                s_no               VARCHAR(40),
                check_point        TEXT,
                judgement_standard TEXT,
                method             TEXT,
                rev_no             VARCHAR(20),
                rev_date           DATE,
                sort_order         INTEGER,
                archived_at        TIMESTAMP DEFAULT NOW()
            )""")
        cur.execute("CREATE INDEX IF NOT EXISTS ix_pm_cpr_machine "
                    "ON maintenance_pm_check_point_rev (machine_no, rev_no)")
        conn.commit()


def _rev_int(v) -> int:
    try:
        return int(float(str(v).strip()))
    except Exception:
        return 0


class PointAdd(BaseModel):
    zone: str
    line: str
    machine_no: str
    machine_name: Optional[str] = ""
    s_no: Optional[str] = ""
    check_point: str
    judgement_standard: Optional[str] = ""
    method: Optional[str] = ""


class PmStagedPoint(BaseModel):
    """Ek staged (pending) naya point — rev bump ke saath hi commit hota hai."""
    s_no: Optional[str] = ""
    check_point: str
    judgement_standard: Optional[str] = ""
    method: Optional[str] = ""
    machine_name: Optional[str] = ""


class RevBump(BaseModel):
    zone: str
    line: str
    machine_no: str
    rev_no: str                          # must be > current (numeric)
    rev_date: str                        # YYYY-MM-DD
    new_points: List[PmStagedPoint] = [] # staged adds — NEW rev par commit


@router.get("/check-point-revs")
def check_point_revs(zone: str = Query(""), line: str = Query(""),
                     machine_no: str = Query(...), user=Depends(get_current_user)):
    """Current rev + all archived revs for one machine."""
    _ensure_cp_rev_table()
    where = ["machine_no = %s"]; params = [machine_no]
    if zone:
        where.append("zone = %s"); params.append(zone)
    if line:
        where.append("line = %s"); params.append(line)
    w = " AND ".join(where)
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute(f"SELECT rev_no, MAX(rev_date) rev_date, COUNT(*) n "
                    f"FROM maintenance_pm_check_point WHERE {w} GROUP BY rev_no", params)
        c = cur.fetchone()
        cur.execute(f"SELECT rev_no, MAX(rev_date) rev_date, COUNT(*) n "
                    f"FROM maintenance_pm_check_point_rev WHERE {w} GROUP BY rev_no", params)
        hist = cur.fetchall()
    fmt = lambda r: {"rev_no": r["rev_no"],
                     "rev_date": r["rev_date"].isoformat() if r["rev_date"] else "",
                     "count": int(r["n"])}
    history = sorted((fmt(h) for h in hist), key=lambda x: -_rev_int(x["rev_no"]))
    return {"current": fmt(c) if c else None, "history": history}


@router.post("/check-points", status_code=201)
def add_check_point(body: PointAdd, user=Depends(get_current_user)):
    """Add a point to the machine's CURRENT revision."""
    if not (body.check_point or "").strip():
        raise HTTPException(400, "check_point required")
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("""SELECT MAX(rev_no) rev_no, MAX(rev_date) rev_date,
                              COALESCE(MAX(sort_order),0) so, COUNT(*) n,
                              MAX(machine_name) mname
                         FROM maintenance_pm_check_point
                        WHERE zone=%s AND line=%s AND machine_no=%s""",
                    (body.zone, body.line, body.machine_no))
        ctx = cur.fetchone()
        rev_no = ctx["rev_no"] or "1"
        rev_date = ctx["rev_date"] or date.today()
        s_no = (body.s_no or "").strip() or str(int(ctx["n"] or 0) + 1)
        mname = (body.machine_name or "").strip() or (ctx["mname"] or "")
        cur.execute("""INSERT INTO maintenance_pm_check_point
              (zone,line,machine_no,machine_name,s_no,check_point,judgement_standard,
               method,rev_no,rev_date,sort_order)
              VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
            (body.zone, body.line, body.machine_no, mname, s_no,
             body.check_point.strip(), (body.judgement_standard or "").strip(),
             (body.method or "").strip(), rev_no, rev_date, int(ctx["so"]) + 1))
        pid = cur.fetchone()["id"]
        conn.commit()
    return {"ok": True, "id": pid, "s_no": s_no, "rev_no": rev_no}


@router.delete("/check-points/{pid}")
def delete_check_point(pid: int, user=Depends(get_current_user)):
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM maintenance_pm_check_point WHERE id=%s", (pid,))
        if cur.rowcount == 0:
            raise HTTPException(404, "point not found")
        conn.commit()
    return {"ok": True}


@router.put("/check-point-rev")
def bump_check_point_rev(body: RevBump, user=Depends(get_current_user)):
    """Update the sheet's revision.  New rev_no must be numerically GREATER
    than the current one.  The current points are archived under the OLD
    rev first, so the previous revision stays viewable point-by-point."""
    _ensure_cp_rev_table()
    try:
        new_date = datetime.strptime(body.rev_date, "%Y-%m-%d").date()
    except Exception:
        raise HTTPException(400, "rev_date must be YYYY-MM-DD")
    new_rev = _rev_int(body.rev_no)
    if new_rev <= 0:
        raise HTTPException(400, "rev_no must be a number")
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("""SELECT MAX(rev_no) rev_no FROM maintenance_pm_check_point
                        WHERE zone=%s AND line=%s AND machine_no=%s""",
                    (body.zone, body.line, body.machine_no))
        ctx = cur.fetchone()
        if not ctx or ctx["rev_no"] is None:
            raise HTTPException(404, "no points for this machine")
        cur_rev = _rev_int(ctx["rev_no"])
        if new_rev <= cur_rev:
            raise HTTPException(400,
                f"New rev no. must be greater than the current rev ({ctx['rev_no']}).")
        cur2 = conn.cursor()
        # replace any earlier snapshot of the old rev with the final state
        cur2.execute("""DELETE FROM maintenance_pm_check_point_rev
                         WHERE zone=%s AND line=%s AND machine_no=%s AND rev_no=%s""",
                     (body.zone, body.line, body.machine_no, ctx["rev_no"]))
        cur2.execute("""INSERT INTO maintenance_pm_check_point_rev
              (zone,line,machine_no,machine_name,s_no,check_point,judgement_standard,
               method,rev_no,rev_date,sort_order)
              SELECT zone,line,machine_no,machine_name,s_no,check_point,
                     judgement_standard,method,rev_no,rev_date,sort_order
                FROM maintenance_pm_check_point
               WHERE zone=%s AND line=%s AND machine_no=%s""",
                     (body.zone, body.line, body.machine_no))
        archived = cur2.rowcount
        cur2.execute("""UPDATE maintenance_pm_check_point
                           SET rev_no=%s, rev_date=%s
                         WHERE zone=%s AND line=%s AND machine_no=%s""",
                     (str(new_rev), new_date, body.zone, body.line, body.machine_no))
        # staged naye points ko NEW rev par commit karo (atomic — rev bump ke saath hi)
        added = 0
        if body.new_points:
            cur.execute("""SELECT COALESCE(MAX(sort_order),0) so, COUNT(*) n, MAX(machine_name) mname
                             FROM maintenance_pm_check_point WHERE zone=%s AND line=%s AND machine_no=%s""",
                        (body.zone, body.line, body.machine_no))
            base = cur.fetchone() or {}
            so_next = int(base.get("so") or 0)
            n_next  = int(base.get("n") or 0)
            mn_ctx  = base.get("mname") or ""
            for pt in body.new_points:
                if not (pt.check_point or "").strip():
                    continue
                so_next += 1; n_next += 1
                s_no = (pt.s_no or "").strip() or str(n_next)
                cur2.execute("""INSERT INTO maintenance_pm_check_point
                      (zone,line,machine_no,machine_name,s_no,check_point,judgement_standard,method,rev_no,rev_date,sort_order)
                      VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                    (body.zone, body.line, body.machine_no, (pt.machine_name or mn_ctx), s_no,
                     pt.check_point.strip(), (pt.judgement_standard or "").strip(),
                     (pt.method or "").strip(), str(new_rev), new_date, so_next))
                added += 1
        conn.commit()
    return {"ok": True, "old_rev": ctx["rev_no"], "new_rev": str(new_rev),
            "archived_points": archived, "added_points": added}


@router.get("/check-point-machines")
def check_point_machines(user=Depends(get_current_user)):
    """Distinct zone / line / machine combos present in
    maintenance_pm_check_point — feeds the Check Sheet cascade so every
    option has real points."""
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("""
            SELECT DISTINCT zone AS zone_name, line AS line_name,
                            machine_no, machine_name
              FROM maintenance_pm_check_point
             WHERE machine_no IS NOT NULL AND machine_no <> ''
             ORDER BY 1, 2, 3
        """)
        return cur.fetchall()


@router.get("/check-points")
def check_points(zone: str = Query(""), line: str = Query(""),
                 machine_no: str = Query(...), rev_no: str = Query(""),
                 user=Depends(get_current_user)):
    """All check points for one machine, in sheet order, plus rev no/date.
    Default = the CURRENT revision (maintenance_pm_check_point); pass an
    archived rev_no to read that revision's snapshot instead."""
    where = ["machine_no = %s"]; params = [machine_no]
    if zone:
        where.append("zone = %s"); params.append(zone)
    if line:
        where.append("line = %s"); params.append(line)
    table = "maintenance_pm_check_point"
    with get_conn() as conn:
        cur = dict_cursor(conn)
        if rev_no:
            # archived rev requested?  (current rev still reads live)
            cur.execute(f"SELECT MAX(rev_no) r FROM maintenance_pm_check_point "
                        f"WHERE {' AND '.join(where)}", params)
            crow = cur.fetchone()
            if not crow or str(crow["r"]) != str(rev_no):
                _ensure_cp_rev_table()
                table = "maintenance_pm_check_point_rev"
                where.append("rev_no = %s"); params.append(rev_no)
        cur.execute(f"""
            SELECT id, s_no, check_point, judgement_standard, method, rev_no, rev_date
              FROM {table}
             WHERE {' AND '.join(where)}
             ORDER BY sort_order
        """, params)
        pts = cur.fetchall()
    for p in pts:
        if p.get("rev_date"):
            p["rev_date"] = p["rev_date"].isoformat()
    rev = {"rev_no": pts[0]["rev_no"], "rev_date": pts[0]["rev_date"]} if pts else {"rev_no": "", "rev_date": ""}
    return {"machine_no": machine_no, "count": len(pts), "rev": rev, "points": pts}


# ════════════════════════════════════════════════════════════════════
# FILLED CHECK SHEETS  (maintenance_pm_check_sheet_filled)
# ---------------------------------------------------------------------
# One row = one completed PM check sheet for a machine on a date.  The
# point-wise results are SNAPSHOTTED into `entries` JSONB (point text +
# observation / action / spares / status / sign), so an old sheet stays
# intact even after the machine's check points are revised.  Viewable
# from the Historical Data page (like filled breakdown slips).
# ════════════════════════════════════════════════════════════════════
def _ensure_fill_table() -> None:
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS maintenance_pm_check_sheet_filled (
                id           SERIAL PRIMARY KEY,
                zone_name    TEXT,
                line_name    TEXT,
                machine_no   TEXT,
                machine_name TEXT,
                pm_date      DATE,
                rev_no       TEXT,
                rev_date     TEXT,
                entries      JSONB NOT NULL DEFAULT '[]'::jsonb,
                prepared_by  TEXT,
                checked_by   TEXT,
                approved_by  TEXT,
                filled_by    TEXT,
                created_at   TIMESTAMP DEFAULT NOW()
            )
        """)
        # format document-control footer SNAPSHOT at fill time (Format No /
        # Rev No / Rev Date of the FORMAT) — so an old sheet always shows the
        # format number it was filled under, even after the format is updated.
        cur.execute("ALTER TABLE maintenance_pm_check_sheet_filled "
                    "ADD COLUMN IF NOT EXISTS doc_footer JSONB")
        # drawn signatures for [prepared_by, checked_by, approved_by] as PNG
        # data-URLs — each role signs its own cell in the sign-off band.
        cur.execute("ALTER TABLE maintenance_pm_check_sheet_filled "
                    "ADD COLUMN IF NOT EXISTS sign_imgs JSONB")
        # ── THREE-STAGE APPROVAL CHAIN (same shape as the Machine DMC one) ──
        #   FILLED    → Team Member (Maintenance) ne sheet bhar di
        #   ENGINEER  → Engineer (Maintenance) ne verify + sign kar diya
        #   APPROVED  → In-Charge Maintenance ne sign kar diya  → ONLY THEN the
        #               sheet becomes visible in History / Historical Data.
        cur.execute("ALTER TABLE maintenance_pm_check_sheet_filled "
                    "ADD COLUMN IF NOT EXISTS stage TEXT")
        cur.execute("ALTER TABLE maintenance_pm_check_sheet_filled "
                    "ADD COLUMN IF NOT EXISTS checked_at TIMESTAMP")
        cur.execute("ALTER TABLE maintenance_pm_check_sheet_filled "
                    "ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP")
        # WHO advanced each stage (the logged-in account, not the typed code) —
        # checked_by/approved_by hold the free-text CODE the signer types, so
        # they cannot serve as an audit trail on their own.
        cur.execute("ALTER TABLE maintenance_pm_check_sheet_filled "
                    "ADD COLUMN IF NOT EXISTS checked_by_user TEXT")
        cur.execute("ALTER TABLE maintenance_pm_check_sheet_filled "
                    "ADD COLUMN IF NOT EXISTS approved_by_user TEXT")
        # ── REJECT / SEND-BACK ──────────────────────────────────────────
        # Engineer or In-Charge can push a sheet back with a mandatory reason.
        # stage goes to REJECTED; the filled entries are NEVER cleared — the
        # Team Member edits the SAME row and re-submits it (stage → FILLED).
        cur.execute("ALTER TABLE maintenance_pm_check_sheet_filled "
                    "ADD COLUMN IF NOT EXISTS reject_reason TEXT")
        cur.execute("ALTER TABLE maintenance_pm_check_sheet_filled "
                    "ADD COLUMN IF NOT EXISTS rejected_from TEXT")   # role that sent it back
        cur.execute("ALTER TABLE maintenance_pm_check_sheet_filled "
                    "ADD COLUMN IF NOT EXISTS rejected_by TEXT")     # the code they typed
        cur.execute("ALTER TABLE maintenance_pm_check_sheet_filled "
                    "ADD COLUMN IF NOT EXISTS rejected_by_user TEXT")
        cur.execute("ALTER TABLE maintenance_pm_check_sheet_filled "
                    "ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMP")
        # append-only audit of every stage move (fill / verify / reject / resubmit)
        cur.execute("ALTER TABLE maintenance_pm_check_sheet_filled "
                    "ADD COLUMN IF NOT EXISTS chain_log JSONB NOT NULL DEFAULT '[]'::jsonb")
        # sheets saved BEFORE the chain existed were single-step and complete —
        # treat them as fully approved so nothing disappears from History.
        cur.execute("UPDATE maintenance_pm_check_sheet_filled "
                    "SET stage='APPROVED' WHERE stage IS NULL")
        conn.commit()


def _log(action: str, frm: str, to: str, code: str = "", user: str = "", reason: str = "") -> dict:
    """One append-only entry for the sheet's chain_log."""
    return {"at": datetime.now().isoformat(timespec="seconds"), "action": action,
            "from": frm, "to": to, "code": code, "user": user, "reason": reason}


class CheckSheetFill(BaseModel):
    zone_name:    str
    line_name:    str
    machine_no:   str
    machine_name: Optional[str] = ""
    pm_date:      str                      # YYYY-MM-DD
    rev_no:       Optional[str] = ""
    rev_date:     Optional[str] = ""
    entries:      List[dict] = []
    prepared_by:  Optional[str] = ""
    checked_by:   Optional[str] = ""
    approved_by:  Optional[str] = ""
    sign_imgs:    List = []                 # [prepared, checked, approved] PNG data-URLs


def _record_pm_spares(body: "CheckSheetFill", pm_date) -> None:
    """Mirror every spare entered against this PM sheet's check points into the
    shared `maintenance_spare` master (source 'PM'), keyed by machine + PM date —
    exactly like the Break Down Slip / Log Book, so PM spares show on the Spare
    page.  Idempotent: a re-save (correction) replaces THIS sheet's PM rows."""
    _SK = ("spare_name", "spare_model_no", "spare_cnmm_no", "spare_qty")
    spares = [s for e in (body.entries or []) for s in (e.get("spares") or [])
              if isinstance(s, dict) and any(str(s.get(k) or "").strip() for k in _SK)]
    try:
        from routers.maintenance_spare import record_usage
        with get_conn() as sconn:
            cur = sconn.cursor()
            cur.execute("DELETE FROM maintenance_spare WHERE source='PM' "
                        "AND machine_no=%s AND used_date=%s", (body.machine_no, pm_date))
            if spares:
                record_usage(sconn, "PM", {
                    "zone": body.zone_name, "line": body.line_name,
                    "machine_no": body.machine_no, "machine_name": body.machine_name,
                    "used_date": pm_date,
                }, spares)
    except Exception as e:
        print(f"[SPARE-MASTER] record failed (PM): {e}")


@router.post("/check-sheet-fill", status_code=201)
def save_check_sheet_fill(body: CheckSheetFill, user=Depends(get_current_user)):
    """Save one filled PM check sheet (snapshot of points + results)."""
    _ensure_fill_table()
    try:
        pmd = datetime.strptime(body.pm_date, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        raise HTTPException(400, "pm_date must be YYYY-MM-DD")
    if not body.entries:
        raise HTTPException(400, "entries is empty — nothing to save")
    # a sheet saves ONLY fully filled: every check point needs a STATUS
    unfilled = [str(e.get("s_no") or "?") for e in body.entries
                if not str(e.get("status") or "").strip()]
    if unfilled:
        raise HTTPException(
            400, f"All check points must be filled before saving — "
                 f"{len(unfilled)} of {len(body.entries)} have no STATUS "
                 f"(s_no: {', '.join(unfilled[:10])}{'…' if len(unfilled) > 10 else ''})")
    author = user.get("username") if isinstance(user, dict) else getattr(user, "username", "user")
    # Stage 1 of the chain: only the Team Member's own name + signature are
    # accepted here.  Engineer / In-Charge cells stay EMPTY until they verify
    # through /check-sheet-verify — the client cannot pre-fill them.
    sign_in = list(body.sign_imgs or [])
    prepared_sign = sign_in[0] if sign_in else None
    if not str(body.prepared_by or "").strip():
        raise HTTPException(400, "prepared_by (Team Member - Maintenance) is required")
    if not prepared_sign:
        raise HTTPException(400, "Prepared By signature is required before saving")
    # SNAPSHOT the CURRENT check-sheet format number/rev at fill time, so this
    # saved sheet keeps its own format even after the format is later updated.
    snap = _get_doc_footer("PM CHECK SHEET FORMAT")
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO maintenance_pm_check_sheet_filled
                (zone_name, line_name, machine_no, machine_name, pm_date,
                 rev_no, rev_date, entries, prepared_by, checked_by,
                 approved_by, filled_by, doc_footer, sign_imgs, stage, chain_log)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s,%s,%s,%s,%s::jsonb,%s::jsonb,%s,%s::jsonb)
            RETURNING id
        """, (body.zone_name, body.line_name, body.machine_no, body.machine_name,
              pmd, str(body.rev_no or ""), str(body.rev_date or ""),
              json.dumps(body.entries), body.prepared_by, "",
              "", author, json.dumps(snap),
              json.dumps([prepared_sign, None, None]), "FILLED",
              json.dumps([_log("fill", "-", "FILLED", body.prepared_by, author)])))
        new_id = cur.fetchone()[0]
        conn.commit()
    _record_pm_spares(body, pmd)      # PM spares → maintenance_spare (source 'PM')
    return {"id": new_id, "stage": "FILLED"}


@router.put("/check-sheet-fill/{fill_id}")
def resubmit_check_sheet_fill(fill_id: int, body: CheckSheetFill, user=Depends(get_current_user)):
    """Re-submit a sheet that was sent back.  Only a REJECTED sheet can be
    edited, and it updates the SAME row — so a correction never creates a
    duplicate sheet and the chain history stays on one record."""
    _ensure_fill_table()
    try:
        pmd = datetime.strptime(body.pm_date, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        raise HTTPException(400, "pm_date must be YYYY-MM-DD")
    if not body.entries:
        raise HTTPException(400, "entries is empty — nothing to save")
    unfilled = [str(e.get("s_no") or "?") for e in body.entries
                if not str(e.get("status") or "").strip()]
    if unfilled:
        raise HTTPException(400, f"All check points must be filled before re-submitting — "
                                 f"{len(unfilled)} of {len(body.entries)} have no STATUS")
    sign_in = list(body.sign_imgs or [])
    prepared_sign = sign_in[0] if sign_in else None
    if not str(body.prepared_by or "").strip():
        raise HTTPException(400, "prepared_by (Team Member - Maintenance) is required")
    if not prepared_sign:
        raise HTTPException(400, "Prepared By signature is required before re-submitting")
    author = user.get("username") if isinstance(user, dict) else getattr(user, "username", "user")
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT id, stage, chain_log FROM maintenance_pm_check_sheet_filled "
                    "WHERE id=%s FOR UPDATE", (fill_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Filled check sheet not found")
        cur_stage = str(row.get("stage") or "").upper()
        if cur_stage != "REJECTED":
            raise HTTPException(409, f"Only a sent-back sheet can be edited — this one is at "
                                     f"'{cur_stage}'. Refresh the list.")
        log = list(row.get("chain_log") or [])
        log.append(_log("resubmit", "REJECTED", "FILLED", body.prepared_by, author))
        cur2 = conn.cursor()
        cur2.execute("""
            UPDATE maintenance_pm_check_sheet_filled
               SET pm_date=%s, entries=%s::jsonb, prepared_by=%s,
                   sign_imgs=%s::jsonb, stage='FILLED', chain_log=%s::jsonb,
                   checked_by='', checked_by_user=NULL, checked_at=NULL,
                   approved_by='', approved_by_user=NULL, approved_at=NULL
             WHERE id=%s
        """, (pmd, json.dumps(body.entries), body.prepared_by,
              json.dumps([prepared_sign, None, None]), json.dumps(log), fill_id))
        conn.commit()
    _record_pm_spares(body, pmd)      # re-sync PM spares → maintenance_spare
    return {"id": fill_id, "stage": "FILLED"}


@router.get("/check-sheet-fills")
def list_check_sheet_fills(zone:       Optional[str] = Query(None),
                           line:       Optional[str] = Query(None),
                           machine_no: Optional[str] = Query(None),
                           date_from:  Optional[str] = Query(None),
                           date_to:    Optional[str] = Query(None),
                           stage:      Optional[str] = Query(None, description="FILLED | ENGINEER | APPROVED"),
                           limit:      int = Query(2000, ge=1, le=5000),
                           user=Depends(get_current_user)):
    """Filled check sheets, newest first — list WITHOUT the heavy entries
    blob (fetch one by id for the full sheet).  Pass stage=APPROVED to see
    only sheets that cleared the full Engineer → In-Charge chain."""
    _ensure_fill_table()
    where, params = ["1=1"], []
    if zone:       where.append("zone_name = %s");  params.append(zone)
    if line:       where.append("line_name = %s");  params.append(line)
    if machine_no: where.append("machine_no = %s"); params.append(machine_no)
    if date_from:  where.append("pm_date >= %s");   params.append(date_from)
    if date_to:    where.append("pm_date <= %s");   params.append(date_to)
    if stage:      where.append("stage = %s");      params.append(stage.upper())
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute(f"""
            SELECT id, zone_name, line_name, machine_no, machine_name,
                   pm_date, rev_no, prepared_by, checked_by, approved_by,
                   filled_by, created_at, doc_footer, stage,
                   checked_at, approved_at, checked_by_user, approved_by_user,
                   doc_footer->>'format_no' AS format_no,
                   jsonb_array_length(entries) AS n_points
              FROM maintenance_pm_check_sheet_filled
             WHERE {' AND '.join(where)}
             ORDER BY pm_date DESC, id DESC
             LIMIT %s
        """, params + [limit])
        rows = cur.fetchall()
        for r in rows:
            for k in ("checked_at", "approved_at"):
                if r.get(k):
                    r[k] = r[k].isoformat()
    for r in rows:
        if r.get("pm_date"):    r["pm_date"] = r["pm_date"].isoformat()
        if r.get("created_at"): r["created_at"] = r["created_at"].isoformat()
    return {"rows": rows, "total": len(rows)}


@router.get("/check-sheet-fill/{fill_id}")
def get_check_sheet_fill(fill_id: int, user=Depends(get_current_user)):
    """One filled check sheet, entries included — feeds the read-only
    sheet view on the Historical Data page."""
    _ensure_fill_table()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT * FROM maintenance_pm_check_sheet_filled WHERE id=%s", (fill_id,))
        row = cur.fetchone()
    if not row:
        raise HTTPException(404, "Filled check sheet not found")
    if row.get("pm_date"):    row["pm_date"] = row["pm_date"].isoformat()
    for k in ("created_at", "checked_at", "approved_at", "rejected_at"):
        if row.get(k):
            row[k] = row[k].isoformat()
    return row


# ── the two verification stages ───────────────────────────────────────
# Stage 2  Engineer (Maintenance)      : FILLED   → ENGINEER
# Stage 3  In-Charge Maintenance       : ENGINEER → APPROVED
# A sheet reaches History only at APPROVED.  Stage order is enforced on the
# server with a row lock, so two people signing at once cannot skip a stage.
# Stages:
#   FILLED       → waiting for the Engineer
#   ENGINEER     → waiting for the In-Charge
#   APPROVED     → done, visible in History
#   REJECTED     → Engineer sent it back to the TEAM MEMBER  (Fill tab)
#   RET_ENGINEER → In-Charge sent it back to the ENGINEER    (Engineer Verify tab)
# A reject always lands one step back, never all the way down.
_VERIFY_STAGES = {
    "engineer": {
        "role":       "Engineer (Maintenance)",
        "accept":     ("FILLED", "RET_ENGINEER"),   # can sign a new OR a returned sheet
        "queue":      "FILLED",                     # its main pending list
        "returned":   "RET_ENGINEER",               # sheets the In-Charge pushed back
        "to":         "ENGINEER",
        "code_col":   "checked_by",  "user_col": "checked_by_user",
        "time_col":   "checked_at",  "slot": 1,
        "reject_to":  "REJECTED",                   # → Team Member
        "reject_who": "Team Member (Maintenance) — Fill Check Sheets",
    },
    "incharge": {
        "role":       "In-Charge Maintenance",
        "accept":     ("ENGINEER",),
        "queue":      "ENGINEER",
        "returned":   None,
        "to":         "APPROVED",
        "code_col":   "approved_by", "user_col": "approved_by_user",
        "time_col":   "approved_at", "slot": 2,
        "reject_to":  "RET_ENGINEER",               # → Engineer, NOT the Team Member
        "reject_who": "Engineer (Maintenance)",
    },
}


@router.get("/check-sheet-pending-verify")
def check_sheet_pending_verify(stage: str = Query(..., description="engineer | incharge"),
                               user=Depends(get_current_user)):
    """Sheets waiting at one stage of the chain — feeds the Engineer Verify
    and In-Charge Approve tabs (oldest first, so nothing sits forgotten)."""
    st = _VERIFY_STAGES.get(str(stage).lower())
    if not st:
        raise HTTPException(400, "stage must be 'engineer' or 'incharge'")
    _ensure_fill_table()
    wanted = [st["queue"]] + ([st["returned"]] if st["returned"] else [])
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("""
            SELECT id, zone_name, line_name, machine_no, machine_name,
                   pm_date, rev_no, prepared_by, checked_by, approved_by,
                   filled_by, created_at, stage,
                   reject_reason, rejected_from, rejected_by, rejected_at,
                   jsonb_array_length(entries) AS n_points
              FROM maintenance_pm_check_sheet_filled
             WHERE stage = ANY(%s)
             ORDER BY pm_date ASC, id ASC
        """, (wanted,))
        rows = cur.fetchall()
    for r in rows:
        for k in ("pm_date", "created_at", "rejected_at"):
            if r.get(k) and not isinstance(r[k], str):
                r[k] = r[k].isoformat()
    fresh    = [r for r in rows if r["stage"] == st["queue"]]
    returned = [r for r in rows if st["returned"] and r["stage"] == st["returned"]]
    return {"stage": str(stage).lower(), "role": st["role"],
            "reject_who": st["reject_who"],
            "rows": fresh, "total": len(fresh),
            "returned": returned, "returned_total": len(returned)}


class CheckSheetVerify(BaseModel):
    fill_id:  int
    stage:    str                       # "engineer" | "incharge"
    name:     str                       # who is signing
    sign_img: Optional[str] = ""        # PNG data-URL of the drawn signature


@router.post("/check-sheet-verify")
def verify_check_sheet(body: CheckSheetVerify, user=Depends(get_current_user)):
    """Verify + sign one filled check sheet at the given stage."""
    st = _VERIFY_STAGES.get(str(body.stage).lower())
    if not st:
        raise HTTPException(400, "stage must be 'engineer' or 'incharge'")
    role, to_stage = st["role"], st["to"]
    code_col, user_col, time_col, slot = st["code_col"], st["user_col"], st["time_col"], st["slot"]
    if not str(body.name or "").strip():
        raise HTTPException(400, f"{role} code is required")
    if not str(body.sign_img or "").strip():
        raise HTTPException(400, f"{role} signature is required")
    author = user.get("username") if isinstance(user, dict) else getattr(user, "username", "user")
    _ensure_fill_table()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        # lock the row so a concurrent sign-off cannot skip or double-apply a stage
        cur.execute("SELECT id, stage, sign_imgs, chain_log FROM maintenance_pm_check_sheet_filled "
                    "WHERE id=%s FOR UPDATE", (body.fill_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Filled check sheet not found")
        cur_stage = str(row.get("stage") or "FILLED").upper()
        if cur_stage not in st["accept"]:
            raise HTTPException(
                409, f"This sheet is at stage '{cur_stage}' — {role} can only sign "
                     f"a sheet at {' or '.join(st['accept'])}. Refresh the list.")
        imgs = list(row.get("sign_imgs") or [])
        while len(imgs) < 3:
            imgs.append(None)
        imgs[slot] = body.sign_img
        log = list(row.get("chain_log") or [])
        log.append(_log("verify", cur_stage, to_stage, body.name.strip(), author))
        cur2 = conn.cursor()
        cur2.execute(
            f"UPDATE maintenance_pm_check_sheet_filled "
            f"SET {code_col}=%s, {user_col}=%s, sign_imgs=%s::jsonb, "
            f"    stage=%s, {time_col}=NOW(), chain_log=%s::jsonb "
            f"WHERE id=%s",
            (body.name.strip(), author, json.dumps(imgs), to_stage,
             json.dumps(log), body.fill_id))
        conn.commit()
    return {"ok": True, "id": body.fill_id, "stage": to_stage,
            "final": to_stage == "APPROVED"}


class CheckSheetReject(BaseModel):
    fill_id: int
    stage:   str                       # "engineer" | "incharge" — who is rejecting
    name:    str                       # their CODE
    reason:  str                       # mandatory — why it is going back


@router.post("/check-sheet-reject")
def reject_check_sheet(body: CheckSheetReject, user=Depends(get_current_user)):
    """Send a sheet ONE STEP back for correction — never all the way down:
        Engineer  rejects → REJECTED      (Team Member, Fill Check Sheets tab)
        In-Charge rejects → RET_ENGINEER  (Engineer, his own Verify tab)
    The filled entries are LEFT INTACT; the receiver edits / re-checks the
    SAME row.  Signatures at and below the receiving step are cleared, because
    after a change the old sign-off no longer applies — who signed what stays
    recorded in chain_log."""
    st = _VERIFY_STAGES.get(str(body.stage).lower())
    if not st:
        raise HTTPException(400, "stage must be 'engineer' or 'incharge'")
    role, reject_to = st["role"], st["reject_to"]
    reason = str(body.reason or "").strip()
    if not str(body.name or "").strip():
        raise HTTPException(400, f"{role} code is required")
    if len(reason) < 3:
        raise HTTPException(400, "Reject reason is required — likho ki kya theek karna hai")
    author = user.get("username") if isinstance(user, dict) else getattr(user, "username", "user")
    _ensure_fill_table()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT id, stage, sign_imgs, chain_log FROM maintenance_pm_check_sheet_filled "
                    "WHERE id=%s FOR UPDATE", (body.fill_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Filled check sheet not found")
        cur_stage = str(row.get("stage") or "FILLED").upper()
        if cur_stage not in st["accept"]:
            raise HTTPException(
                409, f"This sheet is at stage '{cur_stage}' — {role} can only send back "
                     f"a sheet at {' or '.join(st['accept'])}. Refresh the list.")
        # the Team Member's signature always survives; the Engineer's is cleared
        # only when the sheet goes back past him (i.e. all the way to the fill step)
        imgs = list(row.get("sign_imgs") or [])
        while len(imgs) < 3:
            imgs.append(None)
        imgs[1] = None          # Engineer must re-check after any change
        imgs[2] = None          # In-Charge approval is void either way
        log = list(row.get("chain_log") or [])
        log.append(_log("reject", cur_stage, reject_to, body.name.strip(), author, reason))
        cur2 = conn.cursor()
        cur2.execute("""
            UPDATE maintenance_pm_check_sheet_filled
               SET stage=%s, reject_reason=%s, rejected_from=%s,
                   rejected_by=%s, rejected_by_user=%s, rejected_at=NOW(),
                   sign_imgs=%s::jsonb, chain_log=%s::jsonb,
                   checked_by='', checked_by_user=NULL, checked_at=NULL,
                   approved_by='', approved_by_user=NULL, approved_at=NULL
             WHERE id=%s
        """, (reject_to, reason, role, body.name.strip(), author,
              json.dumps(imgs), json.dumps(log), body.fill_id))
        conn.commit()
    return {"ok": True, "id": body.fill_id, "stage": reject_to,
            "by": role, "to": st["reject_who"]}


@router.get("/check-sheet-returned")
def check_sheet_returned(user=Depends(get_current_user)):
    """Sheets sent back for correction — feeds the banner on the Fill tab.
    Data is intact; the Team Member edits and re-submits the same row."""
    _ensure_fill_table()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("""
            SELECT id, zone_name, line_name, machine_no, machine_name, pm_date,
                   prepared_by, reject_reason, rejected_from, rejected_by, rejected_at,
                   jsonb_array_length(entries) AS n_points
              FROM maintenance_pm_check_sheet_filled
             WHERE stage = 'REJECTED'
             ORDER BY rejected_at DESC NULLS LAST, id DESC
        """)
        rows = cur.fetchall()
    for r in rows:
        if r.get("pm_date"):     r["pm_date"] = r["pm_date"].isoformat()
        if r.get("rejected_at"): r["rejected_at"] = r["rejected_at"].isoformat()
    return {"rows": rows, "total": len(rows)}


# ════════════════════════════════════════════════════════════════════
# YEARLY PM SCHEDULE FORMAT  (maintenance_yearly_pm_shedule — imported
# from 'maintenance_pm_shedule.xlsx': ANNUAL PREVENTIVE / PREDICTIVE
# MAINTENANCE SCHEDULE, 12 months x 4 weeks per machine, P/A rows)
# ════════════════════════════════════════════════════════════════════
def _ensure_yearly_signoff_table() -> None:
    """Per-FY sign-off signatures for the Yearly PM Schedule (Prepared By /
    Approved By) — one row per financial year, drawn PNG data-URLs."""
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS maintenance_yearly_pm_signoff (
                year_label  VARCHAR(20) PRIMARY KEY,
                sign_imgs   JSONB NOT NULL DEFAULT '[]'::jsonb,
                updated_by  VARCHAR(120),
                updated_at  TIMESTAMP DEFAULT NOW()
            )
        """)
        conn.commit()


def _get_yearly_signoff(fy: str) -> list:
    _ensure_yearly_signoff_table()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT sign_imgs FROM maintenance_yearly_pm_signoff WHERE year_label=%s", (fy,))
        row = cur.fetchone()
    return (row["sign_imgs"] if row and row["sign_imgs"] else [])


class YearlySignoffIn(BaseModel):
    fy:        str
    sign_imgs: List = []          # [prepared_by, approved_by] PNG data-URLs


@router.put("/yearly-signoff")
def save_yearly_signoff(body: YearlySignoffIn, user=Depends(get_current_user)):
    """Save the Yearly PM Schedule sign-off signatures for one FY."""
    _ensure_yearly_signoff_table()
    author = user.get("username") if isinstance(user, dict) else getattr(user, "username", "user")
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("""INSERT INTO maintenance_yearly_pm_signoff (year_label, sign_imgs, updated_by, updated_at)
                       VALUES (%s,%s::jsonb,%s,NOW())
                       ON CONFLICT (year_label)
                       DO UPDATE SET sign_imgs=EXCLUDED.sign_imgs, updated_by=EXCLUDED.updated_by, updated_at=NOW()""",
                    (body.fy, json.dumps(body.sign_imgs or []), author))
        conn.commit()
    return {"ok": True, "fy": body.fy, "sign_imgs": body.sign_imgs or []}


@router.get("/yearly-schedule")
def yearly_schedule(fy: Optional[str] = Query(None, description="financial year, e.g. 2026-27"),
                    user=Depends(get_current_user)):
    fy = fy or _current_fy()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        # New FY selected → clone the machine list with BLANK plans so the
        # sheet shows every machine ready to be planned.
        _ensure_fy_rows(cur, fy)
        # append any machines newly added to the Machine Master (at the END).
        _sync_master_machines(cur, fy)
        conn.commit()
        cur.execute("""SELECT id, s_no, machine_name, machine_code, zone_name, line,
                              pm_frequency, plan_weeks, actual_weeks, year_label
                         FROM maintenance_yearly_pm_shedule
                        WHERE year_label = %s
                        ORDER BY sort_order, id""", (fy,))
        rows = cur.fetchall()
        # LIVE names from the Machine Master (maintenance_machines) — the schedule stores
        # its own copy, but zone / line / machine name are shown from the master
        # so a later master edit reflects here automatically.  Matched by code
        # (normalized); machine_code (the identity) is kept as-is.
        cur.execute("SELECT machine_no, zone_name, line_name, machine_name FROM maintenance_machines")
        master = {_norm_code(r["machine_no"]): r for r in cur.fetchall()}
        for r in rows:
            m = master.get(_norm_code(r["machine_code"]))
            if m:
                r["zone_name"]    = m["zone_name"]
                r["line"]         = m["line_name"]
                r["machine_name"] = m["machine_name"]
    return {
        "company": "TOYOTA BOSHOKU DEVICE INDIA PVT.LTD",
        "title": "ANNUAL PREVENTIVE / PREDICTIVE MAINTENANCE SCHEDULE",
        "fy": fy,
        "year_label": rows[0]["year_label"] if rows else fy,
        "months": ["APR", "MAY", "JUN", "JUL", "AUG", "SEP",
                   "OCT", "NOV", "DEC", "JAN", "FEB", "MAR"],
        "weeks": ["1W", "2W", "3W", "4W"],
        "freq_legend": [["Y", "YEARLY"], ["H", "HALF YEARLY"], ["Q", "QUATERLY"],
                        ["M", "MONTHLY"], ["W", "WEEK"]],
        "mark_legend": [["due", "PM PLAN"], ["done", "PM DONE"],
                        ["slip", "SLIPPAGE"]],
        "footer_rows": ["No. of PM Scheduled", "No. of PM Conducted",
                        "No. of Slippage Report Filled", "Reviewed by (Section In-Charge)"],
        "signoff": [{"label": "PREPARED BY:-", "caption": "( ENGINEER - MAINTENANCE )"},
                    {"label": "APPROVED BY:-", "caption": "( IN-CHARGE MAINTENANCE )"}],
        "doc_footer": _get_doc_footer("YEARLY PM SCHEDULE FORMAT"),
        "signoff_imgs": _get_yearly_signoff(fy),
        "rows": rows,
    }


# ── Updating the yearly plan (the "P" row) from Update Plan → Preventive
#    Yearly Plan: FY → zone/line/machine (Machine Master) → month → week.
#    The master's machine_no ("TR_LM_01") and the yearly sheet's machine_code
#    ("TR-LM -01") use different separators → matched via normalization.
import re as _re

def _norm_code(s) -> str:
    return _re.sub(r"^_+|_+$", "", _re.sub(r"[^A-Z0-9]+", "_", str(s or "").upper()))


def _current_fy() -> str:
    now = datetime.utcnow()
    s = now.year if now.month >= 4 else now.year - 1
    return f"{s}-{str(s + 1)[-2:]}"


def _ensure_fy_rows(cur, fy: str) -> None:
    """A yearly schedule is per-FY.  If `fy` has no rows yet (e.g. the user
    just selected a NEW/next financial year), clone the machine list (identity
    only) from the most-recent existing FY with EMPTY plan/actual weeks AND a
    BLANK PM Frequency — a new FY starts as a clean slate; the frequency and the
    plan are BOTH filled per-FY from Update Plan → Preventive Yearly Plan.
    No-op if the FY already has rows."""
    cur.execute("SELECT COUNT(*) AS n FROM maintenance_yearly_pm_shedule WHERE year_label = %s", (fy,))
    if (cur.fetchone()["n"] or 0) > 0:
        return
    cur.execute("""SELECT year_label FROM maintenance_yearly_pm_shedule
                    WHERE year_label IS NOT NULL AND year_label <> %s
                    ORDER BY year_label DESC LIMIT 1""", (fy,))
    src = cur.fetchone()
    if not src:
        return
    cur.execute("""
        INSERT INTO maintenance_yearly_pm_shedule
            (s_no, machine_name, machine_code, zone_name, line, pm_frequency,
             plan_weeks, actual_weeks, year_label, sort_order)
        SELECT s_no, machine_name, machine_code, zone_name, line, '',
               '{}'::jsonb, '{}'::jsonb, %s, sort_order
          FROM maintenance_yearly_pm_shedule
         WHERE year_label = %s
    """, (fy, src["year_label"]))


def _sync_master_machines(cur, fy: str) -> None:
    """Keep the yearly schedule in step with the Machine Master (maintenance_machines)
    WITHOUT touching it: any machine present in maintenance_machines but not yet in this
    FY's schedule is APPENDED at the END (sort_order after all existing rows)
    with a blank plan/actual/frequency.  Existing rows are never reordered,
    renumbered or edited — so the current sequence stays and nothing shifts up."""
    cur.execute("SELECT machine_code FROM maintenance_yearly_pm_shedule WHERE year_label=%s", (fy,))
    have = {_norm_code(r["machine_code"]) for r in cur.fetchall()}
    cur.execute("SELECT COALESCE(MAX(sort_order),0) AS so FROM maintenance_yearly_pm_shedule WHERE year_label=%s", (fy,))
    so = cur.fetchone()["so"] or 0
    cur.execute("SELECT machine_no, machine_name, zone_name, line_name FROM maintenance_machines "
                "ORDER BY serial_no NULLS LAST, id")
    for m in cur.fetchall():
        code = m["machine_no"]
        if not code or _norm_code(code) in have:
            continue
        so += 1
        cur.execute("""INSERT INTO maintenance_yearly_pm_shedule
                (s_no, machine_name, machine_code, zone_name, line, pm_frequency,
                 plan_weeks, actual_weeks, year_label, sort_order)
            VALUES (%s,%s,%s,%s,%s,'','{}'::jsonb,'{}'::jsonb,%s,%s)""",
            (str(so), m["machine_name"], code, m["zone_name"], m["line_name"], fy, so))
        have.add(_norm_code(code))


def _find_yearly_row(cur, machine_no: str, fy: str):
    _ensure_fy_rows(cur, fy)
    cur.execute("""SELECT id, s_no, machine_name, machine_code, line,
                          pm_frequency, plan_weeks, actual_weeks, year_label
                     FROM maintenance_yearly_pm_shedule
                    WHERE year_label = %s""", (fy,))
    want = _norm_code(machine_no)
    for r in cur.fetchall():
        if _norm_code(r["machine_code"]) == want:
            return r
    return None


@router.get("/yearly-plan-years")
def yearly_plan_years(user=Depends(get_current_user)):
    """FY options for Update Plan — starts at 2026-27 and grows
    automatically: every April the new FY (Apr-anchored) appears on its
    own.  Any year_label already present in the yearly table is included
    too.  Newest first."""
    now = datetime.utcnow()
    cur_start = now.year if now.month >= 4 else now.year - 1
    # +2 so the NEXT financial year is always selectable (to plan ahead).
    years = {f"{y}-{str(y + 1)[-2:]}" for y in range(2026, max(cur_start, 2026) + 2)}
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT DISTINCT year_label FROM maintenance_yearly_pm_shedule "
                    "WHERE year_label IS NOT NULL")
        years |= {r["year_label"] for r in cur.fetchall()}
    return sorted(years, reverse=True)


@router.get("/yearly-plan-match")
def yearly_plan_match(machine_no: str = Query(...), fy: str = Query(...),
                      user=Depends(get_current_user)):
    """Preview: which yearly-schedule row a master machine_no maps to."""
    with get_conn() as conn:
        cur = dict_cursor(conn)
        row = _find_yearly_row(cur, machine_no, fy)
    if not row:
        return {"found": False}
    return {"found": True, "id": row["id"], "s_no": row["s_no"],
            "machine_name": row["machine_name"], "machine_code": row["machine_code"],
            "line": row["line"], "pm_frequency": row["pm_frequency"],
            "plan_weeks": row["plan_weeks"] or {}}


@router.get("/yearly-plan-month")
def yearly_plan_month(month: str = Query(..., description="YYYY-MM"),
                      user=Depends(get_current_user)):
    """Which machines have a yearly-plan (P) mark in each week of one
    calendar month — feeds the PM Calendar overlay (hover shows the
    lines/machines planned that week).  Week 1 = days 1-7, 2 = 8-14,
    3 = 15-21, 4 = 22-end."""
    try:
        y, m = map(int, str(month).split("-"))
        assert 1 <= m <= 12
    except (ValueError, AssertionError):
        raise HTTPException(400, "month must be YYYY-MM")
    fy_start = y if m >= 4 else y - 1
    fy = f"{fy_start}-{str(fy_start + 1)[-2:]}"
    month_idx = (m - 4) % 12                      # Apr=0 … Mar=11
    base = month_idx * 4
    weeks = {"1": [], "2": [], "3": [], "4": []}
    with get_conn() as conn:
        cur = dict_cursor(conn)
        # which machines already have a FILLED check sheet this month, and
        # in which week (pm_date day 1-7 = wk1 … 22-end = wk4)
        _ensure_fill_table()
        m_start = date(y, m, 1)
        m_end = date(y + 1, 1, 1) if m == 12 else date(y, m + 1, 1)
        cur.execute("""SELECT machine_no, pm_date FROM maintenance_pm_check_sheet_filled
                        WHERE pm_date >= %s AND pm_date < %s""", (m_start, m_end))
        filled = {}
        for fr in cur.fetchall():
            wk = min(4, (fr["pm_date"].day - 1) // 7 + 1)
            filled.setdefault(_norm_code(fr["machine_no"]), set()).add(wk)

        cur.execute("ALTER TABLE maintenance_yearly_pm_shedule "
                    "ADD COLUMN IF NOT EXISTS actual_dates JSONB DEFAULT '{}'::jsonb")
        cur.execute("""SELECT machine_code, machine_name, zone_name, line, pm_frequency,
                              plan_weeks, actual_weeks, actual_dates
                         FROM maintenance_yearly_pm_shedule
                        WHERE year_label = %s AND plan_weeks <> '{}'::jsonb
                        ORDER BY sort_order""", (fy,))
        for r in cur.fetchall():
            actual = r["actual_weeks"] or {}
            adates = r["actual_dates"] or {}
            for k in (r["plan_weeks"] or {}).keys():
                wi = int(k)
                if base <= wi <= base + 3:
                    wno = wi - base + 1
                    weeks[str(wno)].append({
                        "machine_code": r["machine_code"],
                        "machine_name": r["machine_name"],
                        "zone_name": r["zone_name"] or "",
                        "line": r["line"] or "",
                        "pm_frequency": r["pm_frequency"] or "",
                        "week_index": wi,
                        "done": str(wi) in actual,
                        "done_date": adates.get(str(wi), ""),
                        "sheet_filled": wno in filled.get(_norm_code(r["machine_code"]), set())})
    items = [x for v in weeks.values() for x in v]
    done = sum(1 for x in items if x["done"])
    sheet_pending = sum(1 for x in items if x["done"] and not x["sheet_filled"])
    total = len(items)
    return {"month": month, "fy": fy, "month_idx": month_idx, "weeks": weeks,
            "total": total, "done": done, "pending": total - done,
            "sheet_pending": sheet_pending}


@router.get("/pending-sheets")
def pending_sheets(fy: Optional[str] = Query(None, description="financial year, e.g. 2026-27"),
                   user=Depends(get_current_user)):
    """Every machine whose PM is DONE but the check sheet is NOT yet filled,
    across ALL months of the financial year — for the 'Fill Check Sheets' tab.
    Returns the flat list + a per-month summary (which months have pending)."""
    fy = fy or _current_fy()
    try:
        fy_start = int(str(fy).split("-")[0])
    except (ValueError, IndexError):
        raise HTTPException(400, "fy must be like 2026-27")
    MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    with get_conn() as conn:
        cur = dict_cursor(conn)
        _ensure_fill_table()
        cur.execute("ALTER TABLE maintenance_yearly_pm_shedule "
                    "ADD COLUMN IF NOT EXISTS actual_dates JSONB DEFAULT '{}'::jsonb")
        # filled check sheets in this FY → machine -> set of (year, month, week)
        fy_from = date(fy_start, 4, 1)
        fy_to   = date(fy_start + 1, 4, 1)
        cur.execute("""SELECT machine_no, pm_date FROM maintenance_pm_check_sheet_filled
                        WHERE pm_date >= %s AND pm_date < %s""", (fy_from, fy_to))
        filled = {}
        for f in cur.fetchall():
            d = f["pm_date"]; wk = min(4, (d.day - 1) // 7 + 1)
            filled.setdefault(_norm_code(f["machine_no"]), set()).add((d.year, d.month, wk))
        # every DONE plan-week that is not yet filled
        cur.execute("""SELECT machine_code, machine_name, zone_name, line, pm_frequency,
                              actual_weeks, actual_dates
                         FROM maintenance_yearly_pm_shedule
                        WHERE year_label = %s AND actual_weeks <> '{}'::jsonb
                        ORDER BY sort_order""", (fy,))
        items = []
        for r in cur.fetchall():
            actual = r["actual_weeks"] or {}
            adates = r["actual_dates"] or {}
            for wi_str, val in actual.items():
                if val != "done":
                    continue
                wi = int(wi_str)
                month_idx = wi // 4                       # 0 = Apr … 11 = Mar
                wno = wi % 4 + 1
                m = ((month_idx + 3) % 12) + 1            # Apr=4 … Mar=3
                yr = fy_start if month_idx <= 8 else fy_start + 1
                if (yr, m, wno) in filled.get(_norm_code(r["machine_code"]), set()):
                    continue                              # already filled
                items.append({
                    "machine_code": r["machine_code"],
                    "machine_name": r["machine_name"],
                    "zone_name": r["zone_name"] or "",
                    "line": r["line"] or "",
                    "pm_frequency": r["pm_frequency"] or "",
                    "month": f"{yr}-{m:02d}",
                    "month_label": f"{MON[m-1]} {yr}",
                    "week": wno,
                    "done_date": adates.get(wi_str, ""),
                })
    by = {}
    for it in items:
        b = by.setdefault(it["month"], {"month": it["month"], "label": it["month_label"], "count": 0})
        b["count"] += 1
    by_month = sorted(by.values(), key=lambda x: x["month"])
    items.sort(key=lambda x: (x["month"], x["week"], x["machine_code"]))
    return {"fy": fy, "total": len(items), "by_month": by_month, "items": items}


class YearlyActualMark(BaseModel):
    machine_code: str                  # EXACT yearly-sheet code (from plan-month)
    month:        str                  # YYYY-MM
    week:         int                  # 1..4
    action:       str = "set"          # "set" = PM DONE | "clear" = undo


@router.post("/yearly-actual-mark")
def yearly_actual_mark(body: YearlyActualMark, user=Depends(get_current_user)):
    """Mark a planned PM as DONE (A-row of the yearly schedule): sets
    actual_weeks[week_index] = 'done' for the machine.  Called when the
    machine's PM check sheet is saved from the calendar (or directly for
    machines that have no check points)."""
    try:
        y, m = map(int, str(body.month).split("-"))
        assert 1 <= m <= 12
    except (ValueError, AssertionError):
        raise HTTPException(400, "month must be YYYY-MM")
    if not (1 <= body.week <= 4):
        raise HTTPException(400, "week must be 1..4")
    if body.action not in ("set", "clear"):
        raise HTTPException(400, "action must be 'set' or 'clear'")
    fy_start = y if m >= 4 else y - 1
    fy = f"{fy_start}-{str(fy_start + 1)[-2:]}"
    wk_idx = str(((m - 4) % 12) * 4 + (body.week - 1))
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("ALTER TABLE maintenance_yearly_pm_shedule "
                    "ADD COLUMN IF NOT EXISTS actual_dates JSONB DEFAULT '{}'::jsonb")
        cur.execute("""SELECT id, actual_weeks, actual_dates FROM maintenance_yearly_pm_shedule
                        WHERE year_label = %s AND machine_code = %s""", (fy, body.machine_code))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, f"'{body.machine_code}' not in the {fy} yearly schedule")
        actual = dict(row["actual_weeks"] or {})
        dates  = dict(row["actual_dates"] or {})
        if body.action == "set":
            actual[wk_idx] = "done"
            # remember the date the PM was marked done → auto-fills the check sheet
            dates[wk_idx] = date.today().isoformat()
        else:
            actual.pop(wk_idx, None)
            dates.pop(wk_idx, None)
        cur2 = conn.cursor()
        cur2.execute("UPDATE maintenance_yearly_pm_shedule "
                     "SET actual_weeks=%s::jsonb, actual_dates=%s::jsonb WHERE id=%s",
                     (json.dumps(actual), json.dumps(dates), row["id"]))
        conn.commit()
    return {"ok": True, "week_index": int(wk_idx),
            "done": body.action == "set", "actual_weeks": actual,
            "done_date": dates.get(wk_idx, "")}


@router.get("/check-points-by-code")
def check_points_by_code(code: str = Query(...), user=Depends(get_current_user)):
    """Resolve a yearly-sheet machine code ('TR-LM -01') to its check-point
    machine identity ('TR_LM_01' taxonomy) via normalization — so the
    calendar's DONE flow can open the right check sheet."""
    want = _norm_code(code)
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("""SELECT DISTINCT zone, line, machine_no, machine_name
                         FROM maintenance_pm_check_point
                        WHERE machine_no IS NOT NULL AND machine_no <> ''""")
        for r in cur.fetchall():
            if _norm_code(r["machine_no"]) == want:
                return {"found": True, "zone": r["zone"], "line": r["line"],
                        "machine_no": r["machine_no"], "machine_name": r["machine_name"]}
    return {"found": False}


class YearlyPlanMark(BaseModel):
    fy:         str                    # year_label, e.g. "2026-27"
    machine_no: str                    # master machine_no (code)
    month_idx:  int                    # 0=Apr … 11=Mar
    week:       int                    # 1..4
    action:     str = "set"            # "set" (mark P planned) | "clear"


@router.post("/yearly-plan-mark")
def yearly_plan_mark(body: YearlyPlanMark, user=Depends(get_current_user)):
    """Set/clear the PLAN (P-row) mark of one week cell in the yearly PM
    schedule for the machine matched by machine_no.  A set mark stores
    'due' (renders yellow = MAINTENANCE DUE on the Yearly PM Schedule)."""
    if not (0 <= body.month_idx <= 11):
        raise HTTPException(400, "month_idx must be 0..11 (Apr..Mar)")
    if not (1 <= body.week <= 4):
        raise HTTPException(400, "week must be 1..4")
    if body.action not in ("set", "clear"):
        raise HTTPException(400, "action must be 'set' or 'clear'")
    wk_idx = str(body.month_idx * 4 + (body.week - 1))

    with get_conn() as conn:
        cur = dict_cursor(conn)
        row = _find_yearly_row(cur, body.machine_no, body.fy)
        if not row:
            raise HTTPException(404,
                f"Machine '{body.machine_no}' has no row in the {body.fy} "
                f"yearly PM schedule (machine code not matched)")
        plan = dict(row["plan_weeks"] or {})
        if body.action == "set":
            plan[wk_idx] = "due"
        else:
            plan.pop(wk_idx, None)
        cur2 = conn.cursor()
        cur2.execute("UPDATE maintenance_yearly_pm_shedule SET plan_weeks=%s::jsonb WHERE id=%s",
                     (json.dumps(plan), row["id"]))
        conn.commit()
    return {"ok": True, "id": row["id"], "machine_code": row["machine_code"],
            "week_index": int(wk_idx), "mark": "due" if body.action == "set" else None,
            "plan_weeks": plan}


class YearlyPlanFreq(BaseModel):
    fy:           str                  # year_label, e.g. "2026-27"
    machine_no:   str                  # master machine_no (code)
    pm_frequency: str                  # Y / H / Q / M / W / 4M … (blank to clear)


@router.post("/yearly-plan-frequency")
def yearly_plan_frequency(body: YearlyPlanFreq, user=Depends(get_current_user)):
    """Set the PM FREQUENCY of a machine in the yearly PM schedule for the
    given FY — updated from Update Plan → Preventive Yearly Plan (per-FY, so
    a new FY starts blank and is set here)."""
    with get_conn() as conn:
        cur = dict_cursor(conn)
        row = _find_yearly_row(cur, body.machine_no, body.fy)   # ensures FY rows exist
        if not row:
            raise HTTPException(404,
                f"Machine '{body.machine_no}' has no row in the {body.fy} yearly PM schedule")
        cur2 = conn.cursor()
        cur2.execute("UPDATE maintenance_yearly_pm_shedule SET pm_frequency=%s WHERE id=%s",
                     ((body.pm_frequency or "").strip(), row["id"]))
        conn.commit()
    return {"ok": True, "machine_code": row["machine_code"],
            "pm_frequency": (body.pm_frequency or "").strip()}


@router.get("/check-sheet-format")
def get_check_sheet_format(user=Depends(get_current_user)):
    """The blank PM check-sheet format (layout), served from the DB table
    maintenance_pm_check_sheet_format."""
    _ensure_format_table()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT id, name, format FROM maintenance_pm_check_sheet_format "
                    "WHERE name='PM CHECK SHEET FORMAT'")
        row = cur.fetchone()
    if not row:
        raise HTTPException(404, "format not found")
    return row


class DocFooterIn(BaseModel):
    format_no:   Optional[str] = None
    rev_no:      Optional[str] = None
    rev_date:    Optional[str] = None
    format_name: Optional[str] = "PM CHECK SHEET FORMAT"   # which format to edit


@router.get("/format-docs")
def list_format_docs(user=Depends(get_current_user)):
    """Every format whose document-control footer is editable from the
    Maintenance Panel → PM Check Sheet → Format dropdown, with its current
    Format No / Rev No / Rev Date."""
    return [{"name": n, "label": lbl, "doc_footer": _get_doc_footer(n)}
            for n, lbl in _EDITABLE_FORMATS]


@router.put("/check-sheet-format-doc")
def update_check_sheet_doc(body: DocFooterIn, user=Depends(get_current_user)):
    """Update a FORMAT's document-control footer (Format No. / Rev No. /
    Rev Date) shown at the bottom of that sheet.  `format_name` picks which
    format — the PM check sheet or the Yearly PM schedule."""
    name = (body.format_name or "PM CHECK SHEET FORMAT").strip()
    if name not in {n for n, _ in _EDITABLE_FORMATS}:
        raise HTTPException(400, f"unknown format '{name}'")
    _ensure_format_table()
    footer = {"format_no": (body.format_no or "").strip(),
              "rev_no":    (body.rev_no or "").strip(),
              "rev_date":  (body.rev_date or "").strip()}
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("""UPDATE maintenance_pm_check_sheet_format
                          SET format = jsonb_set(COALESCE(format,'{}'::jsonb), '{doc_footer}', %s::jsonb, true),
                              updated_at = NOW()
                        WHERE name=%s""", (json.dumps(footer), name))
        updated = cur.rowcount
        conn.commit()
    if not updated:
        raise HTTPException(404, "format not found")
    return {"ok": True, "format_name": name, "doc_footer": footer}


def _author(user) -> str:
    if isinstance(user, dict):
        return user.get("username") or user.get("name") or user.get("email") or "operator"
    return (getattr(user, "username", None) or getattr(user, "name", None)
            or getattr(user, "email", None) or "operator")


# ════════════════════════════════════════════════════════════════════
# DASHBOARD  (schedule-driven only — the check-sheet fill status is gone)
# ════════════════════════════════════════════════════════════════════
@router.get("/dashboard")
def dashboard(month: str = Query(None), user=Depends(get_current_user)):
    if not month:
        month = date.today().strftime("%Y-%m")
    sched = _schedule_dashboard(month)
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT COUNT(*) AS total, "
                    "COUNT(*) FILTER (WHERE LOWER(status)='done') AS done "
                    "FROM pm_schedule WHERE pm_month=%s", (month,))
        r = cur.fetchone() or {}
    total = int(r.get("total") or 0)
    done = int(r.get("done") or 0)
    return {
        "month": month,
        "counts": {"scheduled": total, "done": done,
                   "pending": total - done,
                   "next_month": len(sched["next_month"])},
        "scheduled_pending": sched["this_month_pending"],
        "next_month": sched["next_month"],
    }


@router.get("/compliance")
def pm_compliance(fy: str = Query(None, description="e.g. 2026-27; empty = all-time"),
                  user=Depends(get_current_user)):
    """PM compliance for a financial year — counted from the SAME yearly PM
    planner the PM pages use (`maintenance_yearly_pm_shedule`), NOT the sparse
    `pm_schedule` table (which is where the old version looked, so its counts
    were wrong).

      • scheduled = every PLANNED PM  → each 'due' week in `plan_weeks`
      • done      = those planned weeks marked complete in `actual_weeks`
      • pending   = scheduled − done

    `fy` empty → across every planned year.  The plan lives per (machine, week)
    inside plan_weeks/actual_weeks JSONB keyed by week-index, so we expand and
    count in Python (mirrors the planner's own done = 'week in actual' rule)."""
    where, params = "plan_weeks <> '{}'::jsonb", []
    if fy:
        where += " AND year_label = %s"
        params = [fy]
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute(f"SELECT plan_weeks, actual_weeks FROM maintenance_yearly_pm_shedule "
                    f"WHERE {where}", params)
        rows = cur.fetchall()
    scheduled = done = 0
    for r in rows:
        plan   = r.get("plan_weeks") or {}
        actual = r.get("actual_weeks") or {}
        for wk in plan.keys():                 # each planned week = one PM
            scheduled += 1
            if wk in actual:                   # that planned week was completed
                done += 1
    pending = scheduled - done
    return {"fy": fy, "scheduled": scheduled, "done": done, "pending": pending,
            "pct": round(done * 100 / scheduled) if scheduled else 0}


# ════════════════════════════════════════════════════════════════════
# SCHEDULE / PLANNER
# ════════════════════════════════════════════════════════════════════
class PlanIn(BaseModel):
    sheet_id: Optional[int] = None      # legacy column, unused now
    zone: Optional[str] = ""
    line: Optional[str] = ""
    machine_no: Optional[str] = ""
    machine_name: Optional[str] = ""
    due_date: str                       # 'YYYY-MM-DD'
    task: Optional[str] = "Line preventive maintenance"
    frequency: Optional[str] = "Monthly"
    owner: Optional[str] = "Maintenance"
    status: Optional[str] = "Pending"
    repeat_12m: bool = False            # clone monthly for 12 months


def _month_clamped_dates(start: date, n: int) -> List[date]:
    """n monthly dates from `start`, clamping the day to each month's length."""
    out = []
    for i in range(n):
        y = start.year + (start.month - 1 + i) // 12
        m = (start.month - 1 + i) % 12 + 1
        if m == 12:
            last = 31
        else:
            last = (date(y, m + 1, 1) - timedelta(days=1)).day
        out.append(date(y, m, min(start.day, last)))
    return out


@router.get("/schedule")
def list_schedule(month: str = Query(None), user=Depends(get_current_user)):
    with get_conn() as conn:
        cur = dict_cursor(conn)
        if month:
            cur.execute("SELECT * FROM pm_schedule WHERE pm_month=%s ORDER BY due_date, machine_name", (month,))
        else:
            cur.execute("SELECT * FROM pm_schedule ORDER BY due_date, machine_name")
        rows = cur.fetchall()
    for r in rows:
        if r.get("due_date"):
            r["due_date"] = r["due_date"].isoformat()
        for k in ("created_at", "updated_at"):
            if r.get(k):
                r[k] = r[k].isoformat()
    return {"schedule": rows}


@router.post("/schedule")
def add_plan(body: PlanIn, user=Depends(get_current_user)):
    try:
        start = datetime.strptime(body.due_date, "%Y-%m-%d").date()
    except Exception:
        raise HTTPException(400, "due_date must be YYYY-MM-DD")
    if not (body.machine_no or body.machine_name):
        raise HTTPException(400, "machine_no or machine_name required")
    author = _author(user)
    dates = _month_clamped_dates(start, 12) if body.repeat_12m else [start]
    ids = []
    with get_conn() as conn:
        cur = dict_cursor(conn)
        for d in dates:
            cur.execute(
                "INSERT INTO pm_schedule(sheet_id,zone,line,machine_no,machine_name,task,frequency,"
                " due_date,owner,status,pm_month,created_by,updated_at) "
                "VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,NOW()) "
                "ON CONFLICT (sheet_id,due_date) DO UPDATE SET "
                "  task=EXCLUDED.task, frequency=EXCLUDED.frequency, owner=EXCLUDED.owner, "
                "  pm_month=EXCLUDED.pm_month, updated_at=NOW() RETURNING id",
                (body.sheet_id, body.zone, body.line, body.machine_no, body.machine_name,
                 body.task, body.frequency, d,
                 body.owner, (body.status or "Pending"), d.strftime("%Y-%m"), author))
            ids.append(cur.fetchone()["id"])
        conn.commit()
    return {"ok": True, "ids": ids, "count": len(ids)}


class PlanPatch(BaseModel):
    status: Optional[str] = None
    due_date: Optional[str] = None


@router.patch("/schedule/{sid}")
def update_plan(sid: int, body: PlanPatch, user=Depends(get_current_user)):
    with get_conn() as conn:
        cur = dict_cursor(conn)
        if body.status is not None:
            cur.execute("UPDATE pm_schedule SET status=%s, updated_at=NOW() WHERE id=%s", (body.status, sid))
        if body.due_date:
            try:
                d = datetime.strptime(body.due_date, "%Y-%m-%d").date()
            except Exception:
                raise HTTPException(400, "due_date must be YYYY-MM-DD")
            cur.execute("UPDATE pm_schedule SET due_date=%s, pm_month=%s, updated_at=NOW() WHERE id=%s",
                        (d, d.strftime("%Y-%m"), sid))
        conn.commit()
    return {"ok": True}


@router.delete("/schedule/{sid}")
def delete_plan(sid: int, user=Depends(get_current_user)):
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("DELETE FROM pm_schedule WHERE id=%s", (sid,))
        conn.commit()
    return {"ok": True}


def _schedule_dashboard(month: str) -> dict:
    """this-month pending + next-month scheduled (for the dashboard)."""
    try:
        y, m = map(int, month.split("-"))
        nxt = f"{y + (m // 12)}-{(m % 12) + 1:02d}"
    except Exception:
        nxt = None
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT id, zone, line, machine_no, machine_name, due_date, status "
                    "FROM pm_schedule WHERE pm_month=%s AND status<>'Done' ORDER BY due_date", (month,))
        this_pending = cur.fetchall()
        nm = []
        if nxt:
            cur.execute("SELECT id, zone, line, machine_no, machine_name, due_date, status "
                        "FROM pm_schedule WHERE pm_month=%s ORDER BY due_date", (nxt,))
            nm = cur.fetchall()
    for lst in (this_pending, nm):
        for r in lst:
            if r.get("due_date"):
                r["due_date"] = r["due_date"].isoformat()
    return {"this_month_pending": this_pending, "next_month": nm}


# ════════════════════════════════════════════════════════════════════
# MAIL CONFIG  (recipient for the reminder worker in pm_mail.py)
# ════════════════════════════════════════════════════════════════════
class MailCfgIn(BaseModel):
    recipient: Optional[str] = ""
    cc: Optional[str] = ""
    auto_enabled: Optional[bool] = True


@router.get("/mail-config")
def get_mail_config(user=Depends(get_current_user)):
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT recipient, cc, auto_enabled FROM pm_mail_config WHERE id=1")
        row = cur.fetchone() or {"recipient": "", "cc": "", "auto_enabled": True}
    return row


@router.put("/mail-config")
def set_mail_config(body: MailCfgIn, user=Depends(get_current_user)):
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            "INSERT INTO pm_mail_config(id,recipient,cc,auto_enabled,updated_at) "
            "VALUES(1,%s,%s,%s,NOW()) ON CONFLICT (id) DO UPDATE SET "
            "  recipient=EXCLUDED.recipient, cc=EXCLUDED.cc, "
            "  auto_enabled=EXCLUDED.auto_enabled, updated_at=NOW()",
            ((body.recipient or "").strip(), (body.cc or "").strip(),
             bool(body.auto_enabled)))
        conn.commit()
    return {"ok": True}
