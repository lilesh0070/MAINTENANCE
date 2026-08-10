"""
routers/machine_dmc.py
======================
Machine DMC (Daily Machine Check Sheet) — check-point master + editor.

Two halves:

  READ (Machine DMC page, unchanged):
    GET /machines            distinct zone/line/machine_no/machine_name for pickers
    GET /points?machine_no=  that machine's check points + header/format info

  ADMIN (Maintenance Panel → Machine DMC — points editor with revisions):
    POST   /points           add a check point to the CURRENT revision
    PUT    /points/{pid}      edit a check point (current revision)
    DELETE /points/{pid}      delete a check point (current revision)
    PUT    /rev              bump revision — archives the current point set
    GET    /revs             { current, history } revision summary
    GET    /format           DMC check-sheet FORMAT (doc-control layout)
    PUT    /format-doc       update Format No. / Rev No. / Rev Date (footer)

Data model mirrors the PM check-sheet subsystem:
  • `machine_dmc`         — the LIVE table; always IS the current revision.
                            (xlsx-loaded; the ADMIN endpoints also mutate it.)
  • `machine_dmc_rev`     — archive of superseded revisions (populated on bump).
  • `machine_dmc_format`  — named FORMAT layout + editable doc-control footer.

Auth: every endpoint requires an authenticated user (get_current_user), same
as the PM original — the Maintenance Panel is reachable by maintenance
department users, not just admins, so mutations are NOT admin-gated here; the
frontend `readOnly` flag controls who sees the edit UI.
"""
from datetime import date, datetime
from typing import Optional, List
import json

from fastapi import APIRouter, Depends, Query, HTTPException
from pydantic import BaseModel

from database import get_conn, dict_cursor
from auth import get_current_user

router = APIRouter(prefix="/api/machine-dmc", tags=["machine-dmc"])

# ── DMC check-sheet FORMAT default (doc-control footer shown on the sheet) ──
_DMC_FORMAT = {
    "company": "TOYOTA BOSHOKU DEVICE INDIA PVT LTD",
    "title":   "Daily Machine Check Sheet (DMC)",
    "doc_footer": {"format_no": "TBDI / MAINT. / F / 002", "rev_no": "00", "rev_date": "20/03/2024"},
}
_DMC_FORMAT_NAME = "DMC CHECK SHEET FORMAT"

# One-time (per-process) DDL guard so the ensure-helper is cheap after boot.
_DDL_DONE = {"ok": False}


def _rev_int(v) -> int:
    """Parse a rev string to an int (blanks / garbage → 0).  Mirrors pm.py so
    the two subsystems compare revisions the same way."""
    try:
        return int(float(str(v).strip()))
    except (ValueError, TypeError):
        return 0


def _ensure_dmc():
    """Idempotent: make sure the columns the ADMIN endpoints mutate exist on
    `machine_dmc` (it is xlsx-loaded and may predate them), and lazily create
    the archive + format tables.  Non-destructive — every statement is
    IF NOT EXISTS / ADD COLUMN IF NOT EXISTS, so existing data/types are
    untouched.  Cached so it only really runs on the first request."""
    if _DDL_DONE["ok"]:
        return
    with get_conn() as conn:
        cur = conn.cursor()
        # machine_dmc is assumed to exist (xlsx import); create a stub only for
        # a completely fresh DB, then make sure every column we rely on is there.
        cur.execute("CREATE TABLE IF NOT EXISTS machine_dmc (id SERIAL PRIMARY KEY)")
        for ddl in (
            "ADD COLUMN IF NOT EXISTS id           SERIAL",
            "ADD COLUMN IF NOT EXISTS zone         VARCHAR(80)",
            "ADD COLUMN IF NOT EXISTS line         VARCHAR(80)",
            "ADD COLUMN IF NOT EXISTS machine_no   VARCHAR(80)",
            "ADD COLUMN IF NOT EXISTS machine_name VARCHAR(200)",
            "ADD COLUMN IF NOT EXISTS s_no         VARCHAR(40)",
            "ADD COLUMN IF NOT EXISTS category     VARCHAR(60)",
            "ADD COLUMN IF NOT EXISTS check_point  TEXT",
            "ADD COLUMN IF NOT EXISTS criteria     TEXT",
            "ADD COLUMN IF NOT EXISTS method       TEXT",
            "ADD COLUMN IF NOT EXISTS resp         VARCHAR(80)",
            "ADD COLUMN IF NOT EXISTS freq         VARCHAR(40)",
            "ADD COLUMN IF NOT EXISTS type         VARCHAR(60)",
            "ADD COLUMN IF NOT EXISTS format_no    VARCHAR(120)",
            "ADD COLUMN IF NOT EXISTS rev_no       VARCHAR(20)",
            "ADD COLUMN IF NOT EXISTS rev_date     DATE",
            "ADD COLUMN IF NOT EXISTS sort_order   INTEGER",
        ):
            try:
                cur.execute(f"ALTER TABLE machine_dmc {ddl}")
            except Exception:
                conn.rollback()

        # Archive of superseded revisions — same columns + archived_at.
        cur.execute("""
            CREATE TABLE IF NOT EXISTS machine_dmc_rev (
                id           SERIAL PRIMARY KEY,
                zone         VARCHAR(80),
                line         VARCHAR(80),
                machine_no   VARCHAR(80),
                machine_name VARCHAR(200),
                s_no         VARCHAR(40),
                category     VARCHAR(60),
                check_point  TEXT,
                criteria     TEXT,
                method       TEXT,
                resp         VARCHAR(80),
                freq         VARCHAR(40),
                type         VARCHAR(60),
                format_no    VARCHAR(120),
                rev_no       VARCHAR(20),
                rev_date     DATE,
                sort_order   INTEGER,
                archived_at  TIMESTAMP DEFAULT NOW()
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_machine_dmc_rev ON machine_dmc_rev (machine_no, rev_no)")

        # Named FORMAT layout + editable doc-control footer.
        cur.execute("""
            CREATE TABLE IF NOT EXISTS machine_dmc_format (
                id         SERIAL PRIMARY KEY,
                name       VARCHAR(120) UNIQUE NOT NULL,
                format     JSONB DEFAULT '{}'::jsonb,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        """)
        cur.execute(
            "INSERT INTO machine_dmc_format (name, format) VALUES (%s, %s) ON CONFLICT (name) DO NOTHING",
            (_DMC_FORMAT_NAME, json.dumps(_DMC_FORMAT)),
        )

        # Filled DMC sheets (one row per completed sheet).  Empty until the
        # DMC fill-&-save flow is added (Phase 2); the History tab reads it now
        # so it's ready — mirrors maintenance_pm_check_sheet_filled.
        cur.execute("""
            CREATE TABLE IF NOT EXISTS machine_dmc_filled (
                id           SERIAL PRIMARY KEY,
                zone_name    TEXT,
                line_name    TEXT,
                machine_no   TEXT,
                machine_name TEXT,
                sheet_month  TEXT,
                rev_no       TEXT,
                rev_date     TEXT,
                entries      JSONB DEFAULT '[]'::jsonb,
                filled_by    TEXT,
                doc_footer   JSONB,
                created_at   TIMESTAMP DEFAULT NOW()
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_machine_dmc_filled ON machine_dmc_filled (machine_no, sheet_month)")
        cur.execute("ALTER TABLE machine_dmc_filled ADD COLUMN IF NOT EXISTS signs JSONB")
        # drawn signatures (PNG data-URLs) for the operator / supervisor sign-off
        cur.execute("ALTER TABLE machine_dmc_filled ADD COLUMN IF NOT EXISTS sign_imgs JSONB")
        # PER-DATE sign-off + approval state, keyed by day-of-month:
        #   {"17": {status: PENDING|VERIFIED, operator_name, operator_sign,
        #           supervisor_name, supervisor_sign, verified_by, verified_at}}
        # The operator's save sets PENDING; the supervisor's sign sets VERIFIED.
        cur.execute("ALTER TABLE machine_dmc_filled ADD COLUMN IF NOT EXISTS day_meta JSONB")
        # PER-WEEK maintenance sign-off (WK1=1-7 … WK5=29-31), keyed by week no:
        #   {"2": {status: SIGNED, maintenance_code, signed_by, signed_at}}
        # Maintenance signs a whole week once, AFTER the supervisor has verified
        # every filled date in that week.
        cur.execute("ALTER TABLE machine_dmc_filled ADD COLUMN IF NOT EXISTS week_meta JSONB")

        # Every ✗ (Not-OK) mark from a Daily DMC Fill, exploded into its own row
        # — zone / line / machine wise, one row per (point, date).  Kept in sync
        # with machine_dmc_filled on every save (refreshed per machine+month).
        cur.execute("""
            CREATE TABLE IF NOT EXISTS machine_dmc_fill_ng_point (
                id           SERIAL PRIMARY KEY,
                zone_name    TEXT,
                line_name    TEXT,
                machine_no   TEXT,
                machine_name TEXT,
                ng_date      DATE,
                sheet_month  TEXT,
                fill_id      INTEGER,
                point_id     INTEGER,
                s_no         INTEGER,
                category     TEXT,
                check_point  TEXT,
                criteria     TEXT,
                method       TEXT,
                resp         TEXT,
                freq         TEXT,
                reason       TEXT,
                filled_by    TEXT,
                created_at   TIMESTAMP DEFAULT NOW()
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_dmc_ng_machine ON machine_dmc_fill_ng_point (zone_name, line_name, machine_no, ng_date)")
        cur.execute("CREATE INDEX IF NOT EXISTS ix_dmc_ng_month   ON machine_dmc_fill_ng_point (machine_no, sheet_month)")
        # corrective action on an NG point — filled from the DMC NG Point page.
        # These survive the per-save rebuild of this table (see dmc_save_fill).
        for ddl in ("ADD COLUMN IF NOT EXISTS action_taken TEXT",
                    "ADD COLUMN IF NOT EXISTS status       VARCHAR(12) DEFAULT 'OPEN'",
                    "ADD COLUMN IF NOT EXISTS closed_by    TEXT",
                    "ADD COLUMN IF NOT EXISTS closed_at    TIMESTAMP"):
            cur.execute(f"ALTER TABLE machine_dmc_fill_ng_point {ddl}")
    _DDL_DONE["ok"] = True


# ── pydantic bodies ────────────────────────────────────────────────────────
class DmcPointAdd(BaseModel):
    zone:         str
    line:         str
    machine_no:   str
    machine_name: Optional[str] = ""
    category:     Optional[str] = ""
    s_no:         Optional[str] = ""
    check_point:  str
    criteria:     Optional[str] = ""
    method:       Optional[str] = ""
    resp:         Optional[str] = ""
    freq:         Optional[str] = ""
    type:         Optional[str] = ""


class DmcPointEdit(BaseModel):
    category:    Optional[str] = None
    s_no:        Optional[str] = None
    check_point: Optional[str] = None
    criteria:    Optional[str] = None
    method:      Optional[str] = None
    resp:        Optional[str] = None
    freq:        Optional[str] = None
    type:        Optional[str] = None


class DmcStagedPoint(BaseModel):
    """Ek staged (pending) naya point — rev bump ke saath hi commit hota hai."""
    category:     Optional[str] = ""
    s_no:         Optional[str] = ""
    check_point:  str
    criteria:     Optional[str] = ""
    method:       Optional[str] = ""
    resp:         Optional[str] = ""
    freq:         Optional[str] = ""
    type:         Optional[str] = ""
    machine_name: Optional[str] = ""


class DmcRevBump(BaseModel):
    zone:       str
    line:       str
    machine_no: str
    rev_no:     str
    rev_date:   str   # YYYY-MM-DD
    new_points: List[DmcStagedPoint] = []   # staged adds — NEW rev par commit


class DmcDocFooter(BaseModel):
    format_no: Optional[str] = ""
    rev_no:    Optional[str] = ""
    rev_date:  Optional[str] = ""


# ── READ (unchanged surface used by the Machine DMC page) ──────────────────
@router.get("/machines")
def dmc_machines(user=Depends(get_current_user)):
    """Zone / line / machine pickers — sourced from the MACHINE MASTER
    (maintenance_machines), same as every other selector in the app.  Admin can pick
    ANY master machine here (even one with zero DMC points yet) to start
    adding points."""
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("""
            SELECT zone_name AS zone, line_name AS line, machine_no, machine_name
              FROM maintenance_machines
             WHERE machine_no IS NOT NULL AND machine_no <> ''
             ORDER BY zone_name, line_name, machine_no
        """)
        return cur.fetchall()


@router.get("/points")
def dmc_points(machine_no: str = Query(...),
               zone:   Optional[str] = Query(None),
               line:   Optional[str] = Query(None),
               rev_no: Optional[str] = Query(None),
               user=Depends(get_current_user)):
    """One machine's DMC check points (ordered), plus header + format info.

    Passing `rev_no` of an OLD revision reads it from the archive
    (machine_dmc_rev); the current revision always reads the live table.
    Backward compatible: callers that omit `rev_no` behave exactly as before,
    now with an extra `id` field per row (ignored by the read-only page)."""
    _ensure_dmc()
    table = "machine_dmc"
    where, params = ["machine_no = %s"], [machine_no]
    if zone:
        where.append("zone = %s"); params.append(zone)
    if line:
        where.append("line = %s"); params.append(line)
    with get_conn() as conn:
        cur = dict_cursor(conn)
        # An OLD rev (≠ current MAX) is served from the archive.
        if rev_no:
            cur.execute(f"SELECT MAX(rev_no) AS r FROM machine_dmc WHERE {' AND '.join(where)}", params)
            cr = cur.fetchone()
            cur_max = cr and cr["r"]
            if cur_max is None or _rev_int(rev_no) != _rev_int(cur_max):
                table = "machine_dmc_rev"
                where.append("rev_no = %s"); params.append(str(rev_no))
        cur.execute(f"""
            SELECT id, s_no, category, check_point, criteria, method, resp, freq, type,
                   zone, line, machine_no, machine_name, format_no, rev_no, rev_date
              FROM {table}
             WHERE {' AND '.join(where)}
             ORDER BY sort_order
        """, params)
        rows = cur.fetchall()
    for r in rows:
        if isinstance(r.get("rev_date"), date):
            r["rev_date"] = r["rev_date"].isoformat()
    hdr = {}
    if rows:
        r0 = rows[0]
        hdr = {"zone": r0["zone"], "line": r0["line"],
               "machine_no": r0["machine_no"], "machine_name": r0["machine_name"],
               "format_no": r0["format_no"], "rev_no": r0["rev_no"],
               "rev_date": r0["rev_date"]}
    return {"header": hdr, "points": rows, "count": len(rows)}


# ── ADMIN — point CRUD ─────────────────────────────────────────────────────
@router.post("/points", status_code=201)
def dmc_add_point(body: DmcPointAdd, user=Depends(get_current_user)):
    """Add one check point to the machine's CURRENT revision.  The new point
    inherits the machine's current rev_no / rev_date; s_no + sort_order auto
    when blank."""
    _ensure_dmc()
    if not (body.check_point or "").strip():
        raise HTTPException(400, "Check point required")
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("""
            SELECT MAX(rev_no) AS rev_no, MAX(rev_date) AS rev_date,
                   MAX(sort_order) AS so, COUNT(*) AS n, MAX(machine_name) AS mn
              FROM machine_dmc
             WHERE machine_no = %s AND zone = %s AND line = %s
        """, (body.machine_no, body.zone, body.line))
        ctx = cur.fetchone() or {}
        rev_no   = ctx.get("rev_no") or "1"
        rev_date = ctx.get("rev_date") or date.today()
        so       = (ctx.get("so") or 0) + 1
        s_no     = body.s_no.strip() if (body.s_no and body.s_no.strip()) else str((ctx.get("n") or 0) + 1)
        mname    = body.machine_name or ctx.get("mn") or ""
        cur.execute("""
            INSERT INTO machine_dmc
                (zone, line, machine_no, machine_name, s_no, category, check_point,
                 criteria, method, resp, freq, type, rev_no, rev_date, sort_order)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            RETURNING id
        """, (body.zone, body.line, body.machine_no, mname, s_no,
              body.category or "", body.check_point, body.criteria or "",
              body.method or "", body.resp or "", body.freq or "",
              body.type or "", rev_no, rev_date, so))
        new_id = cur.fetchone()["id"]
    return {"ok": True, "id": new_id, "s_no": s_no, "rev_no": rev_no}


@router.put("/points/{pid}")
def dmc_edit_point(pid: int, body: DmcPointEdit, user=Depends(get_current_user)):
    """Edit one check point (only fields sent are updated)."""
    _ensure_dmc()
    fields, params = [], []
    for k in ("category", "s_no", "check_point", "criteria", "method", "resp", "freq", "type"):
        v = getattr(body, k)
        if v is not None:
            fields.append(f"{k} = %s"); params.append(v)
    if not fields:
        raise HTTPException(400, "Nothing to update")
    params.append(pid)
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute(f"UPDATE machine_dmc SET {', '.join(fields)} WHERE id = %s", params)
        if cur.rowcount == 0:
            raise HTTPException(404, "Point not found")
    return {"ok": True}


@router.delete("/points/{pid}")
def dmc_del_point(pid: int, user=Depends(get_current_user)):
    """Delete one check point from the live (current-revision) table."""
    _ensure_dmc()
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM machine_dmc WHERE id = %s", (pid,))
        if cur.rowcount == 0:
            raise HTTPException(404, "Point not found")
    return {"ok": True}


# ── ADMIN — revision bump ──────────────────────────────────────────────────
@router.put("/rev")
def dmc_bump_rev(body: DmcRevBump, user=Depends(get_current_user)):
    """Update the revision: archive the CURRENT point set under the old rev,
    then re-stamp the live rows with the new rev_no / rev_date.  Points are
    carried forward (not wiped); add/delete against the new current rev after."""
    _ensure_dmc()
    try:
        datetime.strptime(body.rev_date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(400, "rev_date must be YYYY-MM-DD")
    new_rev = _rev_int(body.rev_no)
    if new_rev <= 0:
        raise HTTPException(400, "Invalid new rev no")
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("""SELECT MAX(rev_no) AS r FROM machine_dmc
                        WHERE machine_no = %s AND zone = %s AND line = %s""",
                    (body.machine_no, body.zone, body.line))
        row = cur.fetchone()
        cur_raw = row and row["r"]
        if cur_raw is None:
            raise HTTPException(404, "No points for this machine")
        if new_rev <= _rev_int(cur_raw):
            raise HTTPException(400, f"New rev no. must be greater than current rev ({cur_raw})")
        # archive the OLD rev (drop any partial earlier snapshot of it first)
        cur.execute("""DELETE FROM machine_dmc_rev
                        WHERE machine_no = %s AND zone = %s AND line = %s AND rev_no = %s""",
                    (body.machine_no, body.zone, body.line, str(cur_raw)))
        cur.execute("""
            INSERT INTO machine_dmc_rev
                (zone, line, machine_no, machine_name, s_no, category, check_point,
                 criteria, method, resp, freq, type, format_no, rev_no, rev_date, sort_order)
            SELECT zone, line, machine_no, machine_name, s_no, category, check_point,
                   criteria, method, resp, freq, type, format_no, rev_no, rev_date, sort_order
              FROM machine_dmc
             WHERE machine_no = %s AND zone = %s AND line = %s
        """, (body.machine_no, body.zone, body.line))
        archived = cur.rowcount
        cur.execute("""UPDATE machine_dmc SET rev_no = %s, rev_date = %s
                        WHERE machine_no = %s AND zone = %s AND line = %s""",
                    (str(new_rev), body.rev_date, body.machine_no, body.zone, body.line))
        # staged naye points ko NEW rev par commit karo (atomic — rev bump ke saath hi)
        added = 0
        if body.new_points:
            cur.execute("""SELECT COALESCE(MAX(sort_order),0) AS so, COUNT(*) AS n, MAX(machine_name) AS mn
                             FROM machine_dmc WHERE machine_no=%s AND zone=%s AND line=%s""",
                        (body.machine_no, body.zone, body.line))
            base = cur.fetchone() or {}
            so_next = base.get("so") or 0
            n_next  = base.get("n") or 0
            mn_ctx  = base.get("mn") or ""
            for pt in body.new_points:
                if not (pt.check_point or "").strip():
                    continue
                so_next += 1; n_next += 1
                s_no = pt.s_no.strip() if (pt.s_no and pt.s_no.strip()) else str(n_next)
                cur.execute("""
                    INSERT INTO machine_dmc
                        (zone, line, machine_no, machine_name, s_no, category, check_point,
                         criteria, method, resp, freq, type, rev_no, rev_date, sort_order)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                """, (body.zone, body.line, body.machine_no, pt.machine_name or mn_ctx, s_no,
                      pt.category or "", pt.check_point, pt.criteria or "", pt.method or "",
                      pt.resp or "", pt.freq or "", pt.type or "", str(new_rev), body.rev_date, so_next))
                added += 1
    return {"ok": True, "old_rev": str(cur_raw), "new_rev": str(new_rev),
            "archived_points": archived, "added_points": added}


@router.get("/revs")
def dmc_revs(machine_no: str = Query(...),
             zone: str = Query(""),
             line: str = Query(""),
             user=Depends(get_current_user)):
    """{ current, history } — current from the live table, history from the
    archive, newest-first."""
    _ensure_dmc()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("""SELECT rev_no, MAX(rev_date) AS rev_date, COUNT(*) AS count
                         FROM machine_dmc
                        WHERE machine_no = %s AND zone = %s AND line = %s
                        GROUP BY rev_no ORDER BY rev_no DESC LIMIT 1""",
                    (machine_no, zone, line))
        current = cur.fetchone()
        cur.execute("""SELECT rev_no, MAX(rev_date) AS rev_date, COUNT(*) AS count
                         FROM machine_dmc_rev
                        WHERE machine_no = %s AND zone = %s AND line = %s
                        GROUP BY rev_no""",
                    (machine_no, zone, line))
        history = cur.fetchall()
    for r in ([current] if current else []) + list(history):
        if isinstance(r.get("rev_date"), date):
            r["rev_date"] = r["rev_date"].isoformat()
    history.sort(key=lambda h: _rev_int(h.get("rev_no")), reverse=True)
    return {"current": current, "history": history}


# ── ADMIN — format doc-control ─────────────────────────────────────────────
@router.get("/format")
def dmc_format(user=Depends(get_current_user)):
    """The DMC check-sheet FORMAT row (layout + doc-control footer)."""
    _ensure_dmc()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT id, name, format FROM machine_dmc_format WHERE name = %s",
                    (_DMC_FORMAT_NAME,))
        row = cur.fetchone()
    if not row:
        raise HTTPException(404, "DMC format not found")
    return row


@router.put("/format-doc")
def dmc_format_doc(body: DmcDocFooter, user=Depends(get_current_user)):
    """Update the Format No. / Rev No. / Rev Date shown at the foot of the
    DMC sheet.  Stored inside the format JSONB at key `doc_footer`."""
    _ensure_dmc()
    footer = {"format_no": (body.format_no or "").strip(),
              "rev_no":    (body.rev_no or "").strip(),
              "rev_date":  (body.rev_date or "").strip()}
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("""
            UPDATE machine_dmc_format
               SET format = jsonb_set(COALESCE(format, '{}'::jsonb), '{doc_footer}', %s::jsonb, true),
                   updated_at = NOW()
             WHERE name = %s
        """, (json.dumps(footer), _DMC_FORMAT_NAME))
        if cur.rowcount == 0:
            raise HTTPException(404, "DMC format not found")
    return {"ok": True, "doc_footer": footer}


# ── HISTORY — filled sheets (list + one).  Future-ready (Phase 2 fill flow) ──
@router.get("/check-sheet-fills")
def dmc_fills(zone:       Optional[str] = Query(None),
              line:       Optional[str] = Query(None),
              machine_no: Optional[str] = Query(None),
              limit:      int = Query(2000, ge=1, le=5000),
              user=Depends(get_current_user)):
    """List filled DMC sheets (newest first), EXCLUDING anything the FULL
    approval chain has not cleared.  A sheet enters History only once
    Maintenance has signed at least one WEEK of it (which itself is only
    possible after the Supervisor verified every date in that week), i.e.
    Operator → Supervisor → Maintenance.  Excludes the heavy `entries` blob."""
    _ensure_dmc()
    where, params = [], []
    if zone:       where.append("zone_name = %s");  params.append(zone)
    if line:       where.append("line_name = %s");  params.append(line)
    if machine_no: where.append("machine_no = %s"); params.append(machine_no)
    wsql = ("WHERE " + " AND ".join(where)) if where else ""
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute(f"""
            SELECT id, zone_name, line_name, machine_no, machine_name, sheet_month,
                   rev_no, rev_date, filled_by, created_at, day_meta, week_meta,
                   doc_footer->>'format_no' AS format_no,
                   jsonb_array_length(COALESCE(entries, '[]'::jsonb)) AS n_points
              FROM machine_dmc_filled {wsql}
             ORDER BY sheet_month DESC, id DESC
             LIMIT %s
        """, params + [limit])
        recs = cur.fetchall()

    # Approval gate: keep only sheets with at least one MAINTENANCE-SIGNED week.
    rows = []
    for r in recs:
        meta  = r.pop("day_meta", None) or {}
        wmeta = r.pop("week_meta", None) or {}
        signed_weeks = [w for w, m in wmeta.items()
                        if str((m or {}).get("status") or "").upper() == "SIGNED"]
        if not signed_weeks:
            continue
        verified = [d for d, m in meta.items()
                    if str((m or {}).get("status") or "").upper() == "VERIFIED"]
        r["signed_weeks"] = len(signed_weeks)
        r["verified_days"] = len(verified)
        r["submitted_days"] = len(meta)
        rows.append(r)
    for r in rows:
        if isinstance(r.get("created_at"), datetime):
            r["created_at"] = r["created_at"].isoformat()
    return {"rows": rows, "total": len(rows)}


@router.get("/check-sheet-fill/{fid}")
def dmc_fill_one(fid: int, user=Depends(get_current_user)):
    """One filled DMC sheet (full — includes entries + doc_footer snapshot)."""
    _ensure_dmc()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT * FROM machine_dmc_filled WHERE id = %s", (fid,))
        row = cur.fetchone()
    if not row:
        raise HTTPException(404, "Filled sheet not found")
    # Same approval gate as the History list — an unsigned sheet is not
    # readable here either (otherwise the gate would be UI-only).
    if not any(str((m or {}).get("status") or "").upper() == "SIGNED"
               for m in (row.get("week_meta") or {}).values()):
        raise HTTPException(404, "Sheet is not maintenance-signed yet")
    if isinstance(row.get("created_at"), datetime):
        row["created_at"] = row["created_at"].isoformat()
    return row


# ── DAILY FILL — operator fills the monthly DMC sheet (save + resume) ───────
class DmcFill(BaseModel):
    zone:         str
    line:         str
    machine_no:   str
    machine_name: Optional[str] = ""
    sheet_month:  str                       # YYYY-MM
    rev_no:       Optional[str] = ""
    rev_date:     Optional[str] = ""
    # one dict per check point: its text + a per-day status map
    #   {id, s_no, category, check_point, criteria, method, resp, freq, type,
    #    days: {"1":"OK"|"NG"|"", ... "31": ...}}
    entries:      List[dict] = []
    signs:        Optional[dict] = None      # {operator, supervisor, maintenance} — names
    sign_imgs:    Optional[dict] = None      # {operator, supervisor} — PNG data-URLs (legacy/per-record)
    day_meta:     Optional[dict] = None      # per-date sign-off + approval state (see _ensure_dmc)


def _week_of(d: int) -> int:
    """DMC sheet week blocks: WK1=1-7, WK2=8-14, WK3=15-21, WK4=22-28, WK5=29-31."""
    return 1 if d <= 7 else 2 if d <= 14 else 3 if d <= 21 else 4 if d <= 28 else 5


def _dmc_doc_footer(cur) -> dict:
    """Current format doc-control footer (frozen onto each saved sheet)."""
    cur.execute("SELECT format->'doc_footer' AS df FROM machine_dmc_format WHERE name = %s",
                (_DMC_FORMAT_NAME,))
    row = cur.fetchone()
    return (row and row.get("df")) or {}


@router.post("/check-sheet-fill", status_code=201)
def dmc_save_fill(body: DmcFill, user=Depends(get_current_user)):
    """Save (upsert) one operator-filled MONTHLY DMC sheet.  Re-saving the same
    (zone, line, machine, month) replaces the previous submission, so the
    operator can keep ticking days through the month and re-save."""
    _ensure_dmc()
    import re as _re
    if not _re.match(r"^\d{4}-\d{2}$", body.sheet_month or ""):
        raise HTTPException(400, "sheet_month must be YYYY-MM")
    if not body.entries:
        raise HTTPException(400, "Nothing to save — sheet has no check points")
    with get_conn() as conn:
        cur = dict_cursor(conn)
        footer = _dmc_doc_footer(cur)

        # ── CHAIN INTEGRITY ────────────────────────────────────────────────
        # This save is a DELETE+INSERT of the month row, so read the stored state
        # under a row lock and MERGE, never blindly replace.  Two rules:
        #   • approval state (day_meta VERIFIED / week_meta SIGNED) is owned by
        #     the supervisor / maintenance — an operator save can't touch it;
        #   • `entries` are merged PER (point, day), so a stale client that only
        #     knows about its own date can never drop another date's marks.
        cur.execute("""SELECT entries, day_meta, week_meta FROM machine_dmc_filled
                        WHERE zone_name=%s AND line_name=%s AND machine_no=%s AND sheet_month=%s
                        ORDER BY id DESC LIMIT 1
                        FOR UPDATE""",
                    (body.zone, body.line, body.machine_no, body.sheet_month))
        prev = cur.fetchone() or {}
        prev_entries = prev.get("entries") or []
        prev_day  = prev.get("day_meta") or {}
        prev_week = prev.get("week_meta") or {}      # maintenance sign — never client-writable

        signed_wk = {str(w) for w, m in prev_week.items()
                     if str((m or {}).get("status") or "").upper() == "SIGNED"}

        def _locked(day: str) -> bool:
            """A date already verified by the supervisor, or inside a week the
            maintenance has signed, is frozen — its data must not change."""
            if str((prev_day.get(str(day)) or {}).get("status") or "").upper() == "VERIFIED":
                return True
            try:
                return str(_week_of(int(day))) in signed_wk
            except (TypeError, ValueError):
                return False

        prev_by_id = {str(e.get("id")): e for e in prev_entries}

        # Reject (loudly, never silently) any attempt to CHANGE a frozen date.
        conflicts = set()
        for e in body.entries:
            prev_days = (prev_by_id.get(str(e.get("id"))) or {}).get("days") or {}
            for d, v in (e.get("days") or {}).items():
                if _locked(d) and str(prev_days.get(str(d), "")) != str(v):
                    conflicts.add(str(d))
        if conflicts:
            days_txt = ", ".join(sorted(conflicts, key=lambda x: int(x)))
            raise HTTPException(409,
                f"Date(s) {days_txt} are already verified/signed and cannot be changed. "
                f"Reload the sheet before saving.")

        # merge entries per (point, day) — keep stored days the client didn't send
        merged_entries, seen = [], set()
        for e in body.entries:
            pid = str(e.get("id")); seen.add(pid)
            prev_e = prev_by_id.get(pid) or {}
            days = dict(prev_e.get("days") or {})
            rz   = dict(prev_e.get("reasons") or {})
            for d, v in (e.get("days") or {}).items():
                if not _locked(d):
                    days[str(d)] = v
            for d, v in (e.get("reasons") or {}).items():
                if not _locked(d):
                    rz[str(d)] = v
            merged_entries.append({**e, "days": days, "reasons": rz})
        for pid, e in prev_by_id.items():             # points the client didn't send
            if pid not in seen:
                merged_entries.append(e)

        merged_day = dict(prev_day)
        for d, m in (body.day_meta or {}).items():
            if _locked(d):
                continue                              # approved → keep the stored one
            merged_day[d] = m

        cur.execute("""DELETE FROM machine_dmc_filled
                        WHERE zone_name=%s AND line_name=%s AND machine_no=%s AND sheet_month=%s""",
                    (body.zone, body.line, body.machine_no, body.sheet_month))
        cur.execute("""
            INSERT INTO machine_dmc_filled
                (zone_name, line_name, machine_no, machine_name, sheet_month,
                 rev_no, rev_date, entries, signs, sign_imgs, day_meta, week_meta,
                 filled_by, doc_footer)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            RETURNING id
        """, (body.zone, body.line, body.machine_no, body.machine_name or "",
              body.sheet_month, body.rev_no or "", body.rev_date or "",
              json.dumps(merged_entries), json.dumps(body.signs or {}),
              json.dumps(body.sign_imgs or {}), json.dumps(merged_day),
              json.dumps(prev_week),
              user.get("username"), json.dumps(footer)))
        new_id = cur.fetchone()["id"]

        # ── explode every ✗ (NG) mark into machine_dmc_fill_ng_point ──
        # Rebuilt for this (machine, month) on each save so it always mirrors
        # the sheet — zone / line / machine wise, one row per (point, date).
        # keep any corrective action already recorded against an NG point —
        # this table is rebuilt on every save, so carry the action/close state
        # across by (point_id, ng_date).
        cur.execute("""SELECT point_id, ng_date, action_taken, status, closed_by, closed_at
                         FROM machine_dmc_fill_ng_point
                        WHERE zone_name=%s AND line_name=%s AND machine_no=%s AND sheet_month=%s""",
                    (body.zone, body.line, body.machine_no, body.sheet_month))
        prev_ng = {}
        for r in cur.fetchall():
            nd = r["ng_date"]
            prev_ng[(r["point_id"], nd.isoformat() if hasattr(nd, "isoformat") else str(nd))] = r

        cur.execute("""DELETE FROM machine_dmc_fill_ng_point
                        WHERE zone_name=%s AND line_name=%s AND machine_no=%s AND sheet_month=%s""",
                    (body.zone, body.line, body.machine_no, body.sheet_month))
        ng_rows = []
        for e in merged_entries:
            days = e.get("days") or {}
            rz   = e.get("reasons") or {}
            for d, status in days.items():
                if str(status).upper() != "NG":
                    continue
                try:
                    ng_date = f"{body.sheet_month}-{int(d):02d}"
                except (TypeError, ValueError):
                    continue
                keep = prev_ng.get((e.get("id"), ng_date)) or {}
                ng_rows.append((
                    body.zone, body.line, body.machine_no, body.machine_name or "",
                    ng_date, body.sheet_month, new_id,
                    e.get("id"), e.get("s_no"), e.get("category"), e.get("check_point"),
                    e.get("criteria"), e.get("method"), e.get("resp"), e.get("freq"),
                    (rz.get(str(d)) or "").strip() or None, user.get("username"),
                    keep.get("action_taken"), keep.get("status") or "OPEN",
                    keep.get("closed_by"), keep.get("closed_at"),
                ))
        if ng_rows:
            cur.executemany("""
                INSERT INTO machine_dmc_fill_ng_point
                    (zone_name, line_name, machine_no, machine_name, ng_date, sheet_month,
                     fill_id, point_id, s_no, category, check_point, criteria, method,
                     resp, freq, reason, filled_by,
                     action_taken, status, closed_by, closed_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """, ng_rows)
    return {"ok": True, "id": new_id, "ng_points": len(ng_rows)}


# ── SUPERVISOR VERIFICATION (per date) ─────────────────────────────────────
def _merge_add_only(prev_entries: list, new_entries: list) -> list:
    """Merge a later stage's own check points into the stored sheet.

    ADD-ONLY on purpose: a (point, day) cell that already carries a mark is
    NEVER overwritten.  So the Line Leader can add his points to a day the
    operator filled, and Maintenance can add theirs to a day the supervisor
    already verified, but no stage can quietly change what another stage
    recorded.  Point identity is the check-point id.
    """
    by_id = {str(e.get("id")): dict(e) for e in (prev_entries or [])}
    for e in (new_entries or []):
        pid = str(e.get("id"))
        cur = by_id.get(pid)
        if cur is None:
            cur = {k: v for k, v in e.items() if k not in ("days", "reasons")}
            cur["days"], cur["reasons"] = {}, {}
            by_id[pid] = cur
        days = dict(cur.get("days") or {})
        rz   = dict(cur.get("reasons") or {})
        for d, v in (e.get("days") or {}).items():
            if str(v or "").strip() and not str(days.get(str(d)) or "").strip():
                days[str(d)] = v                       # only fill an EMPTY cell
        for d, v in (e.get("reasons") or {}).items():
            if str(v or "").strip() and not str(rz.get(str(d)) or "").strip():
                rz[str(d)] = v
        cur["days"], cur["reasons"] = days, rz
    return list(by_id.values())


class DmcVerify(BaseModel):
    zone:            str
    line:            str
    machine_no:      str
    sheet_month:     str          # YYYY-MM
    day:             int          # day-of-month being verified
    supervisor_code: Optional[str] = ""   # the supervisor's own sign-off code
    # the Line Leader's OWN points for this date (resp = LINE LEADER), merged
    # into the sheet in this same locked transaction before it flips VERIFIED
    entries:         List[dict] = []


@router.get("/pending-verify")
def dmc_pending_verify(zone:       Optional[str] = Query(None),
                       line:       Optional[str] = Query(None),
                       machine_no: Optional[str] = Query(None),
                       month:      Optional[str] = Query(None),
                       on_date:    Optional[str] = Query(None),   # YYYY-MM-DD — one date
                       only_pending: bool = Query(False),
                       user=Depends(get_current_user)):
    """One row per FILLED DATE with its supervisor-verification state.

    Days are derived from `entries` (a day is "filled" if any point has a mark)
    and joined with `day_meta`; a filled day with no meta counts as PENDING."""
    _ensure_dmc()
    where, params = [], []
    if zone:       where.append("zone_name = %s");   params.append(zone)
    if line:       where.append("line_name = %s");   params.append(line)
    if machine_no: where.append("machine_no = %s");  params.append(machine_no)
    if month:      where.append("sheet_month = %s"); params.append(month)
    wsql = ("WHERE " + " AND ".join(where)) if where else ""
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute(f"""
            SELECT id, zone_name, line_name, machine_no, machine_name, sheet_month,
                   entries, day_meta, filled_by
              FROM machine_dmc_filled {wsql}
             ORDER BY sheet_month DESC, machine_no
             LIMIT 500
        """, params)
        recs = cur.fetchall()

    rows = []
    for r in recs:
        entries = r.get("entries") or []
        meta    = r.get("day_meta") or {}
        stats = {}                       # day -> [filled_count, ng_count]
        for e in entries:
            for d, v in (e.get("days") or {}).items():
                st = stats.setdefault(str(d), [0, 0])
                st[0] += 1
                if str(v).upper() == "NG":
                    st[1] += 1
        for d in sorted(stats, key=lambda x: int(x)):
            m = meta.get(d) or {}
            status = (m.get("status") or "PENDING").upper()
            if on_date and f"{r['sheet_month']}-{int(d):02d}" != on_date:
                continue
            rows.append({
                "fill_id": r["id"], "zone_name": r["zone_name"], "line_name": r["line_name"],
                "machine_no": r["machine_no"], "machine_name": r["machine_name"],
                "sheet_month": r["sheet_month"], "day": int(d),
                "date": f"{r['sheet_month']}-{int(d):02d}",
                "points_filled": stats[d][0], "ng_count": stats[d][1],
                "status": status,
                "operator_code": m.get("operator_code") or "",
                "supervisor_code": m.get("supervisor_code") or "",
                "verified_by": m.get("verified_by"), "verified_at": m.get("verified_at"),
                "filled_by": r.get("filled_by"),
            })
    # counts are over EVERYTHING matching the filter (before only_pending), so
    # the header always shows the true pending / verified totals.
    counts = {
        "pending":  sum(1 for x in rows if x["status"] != "VERIFIED"),
        "verified": sum(1 for x in rows if x["status"] == "VERIFIED"),
        "total":    len(rows),
    }
    if only_pending:
        rows = [x for x in rows if x["status"] != "VERIFIED"]
    rows.sort(key=lambda x: (x["date"], x["machine_no"]), reverse=True)
    return {"rows": rows, "total": len(rows), "counts": counts}


@router.put("/verify-day")
def dmc_verify_day(body: DmcVerify, user=Depends(get_current_user)):
    """Supervisor signs off ONE date — flips that day to VERIFIED (final submit)."""
    _ensure_dmc()
    if not (body.supervisor_code or "").strip():
        raise HTTPException(400, "Supervisor code is required")
    if not (1 <= int(body.day) <= 31):
        raise HTTPException(400, "day must be 1..31")
    key = str(int(body.day))
    with get_conn() as conn:
        cur = dict_cursor(conn)
        # FOR UPDATE — two supervisors verifying different dates of the same
        # (machine, month) would otherwise lose one of the two writes.
        cur.execute("""SELECT id, entries, day_meta FROM machine_dmc_filled
                        WHERE zone_name=%s AND line_name=%s AND machine_no=%s AND sheet_month=%s
                        ORDER BY id DESC LIMIT 1
                        FOR UPDATE""",
                    (body.zone, body.line, body.machine_no, body.sheet_month))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "No filled sheet for this machine / month")
        # the Line Leader's own points go in FIRST, while the date is still open
        if body.entries:
            merged = _merge_add_only(row.get("entries") or [], body.entries)
            cur.execute("UPDATE machine_dmc_filled SET entries=%s WHERE id=%s",
                        (json.dumps(merged), row["id"]))
        meta = row.get("day_meta") or {}
        day  = dict(meta.get(key) or {})
        day.update({
            "status": "VERIFIED",
            "supervisor_code": (body.supervisor_code or "").strip().upper(),
            "verified_by": user.get("username"),
            "verified_at": datetime.now().isoformat(timespec="seconds"),
        })
        meta[key] = day
        cur.execute("UPDATE machine_dmc_filled SET day_meta=%s WHERE id=%s",
                    (json.dumps(meta), row["id"]))
    return {"ok": True, "day": int(body.day), "status": "VERIFIED"}


# ── MAINTENANCE WEEKLY SIGN-OFF ────────────────────────────────────────────
class DmcMaintSign(BaseModel):
    zone:             str
    line:             str
    machine_no:       str
    sheet_month:      str          # YYYY-MM
    week:             int          # 1..5
    maintenance_code: Optional[str] = ""
    # Maintenance's OWN points (resp = MAINTENANCE) for a date inside this week.
    # Merged add-only in the same locked transaction, just before the week is
    # signed — the supervisor-verified marks are untouchable.
    entries:          List[dict] = []


def _week_rows(recs, only_ready=False):
    """Collapse filled dates into per-week rows with their approval state."""
    out = []
    for r in recs:
        entries = r.get("entries") or []
        dmeta   = r.get("day_meta") or {}
        wmeta   = r.get("week_meta") or {}
        weeks = {}                       # wk -> {days:set, ng:int, verified:set}
        for e in entries:
            for d, v in (e.get("days") or {}).items():
                wk = _week_of(int(d))
                w = weeks.setdefault(wk, {"days": set(), "ng": 0, "verified": set()})
                w["days"].add(str(d))
                if str(v).upper() == "NG":
                    w["ng"] += 1
        for wk, w in weeks.items():
            for d in w["days"]:
                if str(((dmeta.get(d) or {}).get("status") or "")).upper() == "VERIFIED":
                    w["verified"].add(d)
            wm = wmeta.get(str(wk)) or {}
            signed = str(wm.get("status") or "").upper() == "SIGNED"
            all_verified = len(w["verified"]) == len(w["days"]) and len(w["days"]) > 0
            status = "SIGNED" if signed else ("READY" if all_verified else "PENDING_SUPERVISOR")
            if only_ready and status != "READY":
                continue
            out.append({
                "fill_id": r["id"], "zone_name": r["zone_name"], "line_name": r["line_name"],
                "machine_no": r["machine_no"], "machine_name": r["machine_name"],
                "sheet_month": r["sheet_month"], "week": wk,
                "days": sorted(w["days"], key=int),
                "dates_filled": len(w["days"]), "dates_verified": len(w["verified"]),
                "ng_count": w["ng"], "status": status,
                "maintenance_code": wm.get("maintenance_code") or "",
                "signed_by": wm.get("signed_by"), "signed_at": wm.get("signed_at"),
            })
    out.sort(key=lambda x: (x["sheet_month"], x["machine_no"], x["week"]), reverse=True)
    return out


@router.get("/pending-maint")
def dmc_pending_maint(zone:       Optional[str] = Query(None),
                      line:       Optional[str] = Query(None),
                      machine_no: Optional[str] = Query(None),
                      month:      Optional[str] = Query(None),
                      only_ready: bool = Query(False),
                      user=Depends(get_current_user)):
    """Per-WEEK rows for the maintenance weekly sign-off.

    status:  PENDING_SUPERVISOR — some dates still unverified by the supervisor
             READY              — all dates verified, waiting for maintenance
             SIGNED             — maintenance has signed the week"""
    _ensure_dmc()
    where, params = [], []
    if zone:       where.append("zone_name = %s");   params.append(zone)
    if line:       where.append("line_name = %s");   params.append(line)
    if machine_no: where.append("machine_no = %s");  params.append(machine_no)
    if month:      where.append("sheet_month = %s"); params.append(month)
    wsql = ("WHERE " + " AND ".join(where)) if where else ""
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute(f"""
            SELECT id, zone_name, line_name, machine_no, machine_name, sheet_month,
                   entries, day_meta, week_meta
              FROM machine_dmc_filled {wsql}
             ORDER BY sheet_month DESC, machine_no
             LIMIT 500
        """, params)
        recs = cur.fetchall()
    rows = _week_rows(recs, only_ready=only_ready)
    counts = {
        "ready":   sum(1 for x in rows if x["status"] == "READY"),
        "signed":  sum(1 for x in rows if x["status"] == "SIGNED"),
        "waiting": sum(1 for x in rows if x["status"] == "PENDING_SUPERVISOR"),
        "total":   len(rows),
    }
    return {"rows": rows, "total": len(rows), "counts": counts}


@router.put("/maint-sign-week")
def dmc_maint_sign_week(body: DmcMaintSign, user=Depends(get_current_user)):
    """Maintenance signs ONE week — allowed only once every filled date in that
    week has been verified by the Production Supervisor."""
    _ensure_dmc()
    if not (body.maintenance_code or "").strip():
        raise HTTPException(400, "Maintenance code is required")
    with get_conn() as conn:
        cur = dict_cursor(conn)
        if not (1 <= int(body.week) <= 5):
            raise HTTPException(400, "week must be 1..5")
        cur.execute("""SELECT id, entries, day_meta, week_meta FROM machine_dmc_filled
                        WHERE zone_name=%s AND line_name=%s AND machine_no=%s AND sheet_month=%s
                        ORDER BY id DESC LIMIT 1
                        FOR UPDATE""",
                    (body.zone, body.line, body.machine_no, body.sheet_month))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "No filled sheet for this machine / month")

        # ONE maintenance sign per week — never overwrite an already-signed week
        wmeta = row.get("week_meta") or {}
        already = wmeta.get(str(int(body.week))) or {}
        if str(already.get("status") or "").upper() == "SIGNED":
            raise HTTPException(409,
                f"Week {int(body.week)} is already signed"
                + (f" (code {already.get('maintenance_code')})" if already.get("maintenance_code") else "")
                + (f" on {already.get('signed_at')}" if already.get("signed_at") else ""))

        # every filled date of this week must already be supervisor-VERIFIED
        dmeta = row.get("day_meta") or {}
        days = {str(d) for e in (row.get("entries") or [])
                for d in (e.get("days") or {}) if _week_of(int(d)) == int(body.week)}
        if not days:
            raise HTTPException(400, "Nothing filled in this week")
        unverified = [d for d in days
                      if str(((dmeta.get(d) or {}).get("status") or "")).upper() != "VERIFIED"]
        if unverified:
            raise HTTPException(400,
                f"{len(unverified)} date(s) in this week are not verified by the supervisor yet")

        # Maintenance's own points go in last, right before the week is signed.
        # They may only land on a date this week that the supervisor already
        # verified — never on a new/unverified date, which would slip past the
        # check above.
        if body.entries:
            want = {str(d) for e in body.entries for d, v in (e.get("days") or {}).items()
                    if str(v or "").strip()}
            stray = sorted(d for d in want
                           if d not in days
                           or str(((dmeta.get(d) or {}).get("status") or "")).upper() != "VERIFIED")
            if stray:
                raise HTTPException(400,
                    f"Maintenance points can only be filled on a verified date of this week — "
                    f"date(s) {', '.join(stray)} are not.")
            merged = _merge_add_only(row.get("entries") or [], body.entries)
            cur.execute("UPDATE machine_dmc_filled SET entries=%s WHERE id=%s",
                        (json.dumps(merged), row["id"]))

        wmeta[str(int(body.week))] = {
            "status": "SIGNED",
            "maintenance_code": body.maintenance_code.strip().upper(),
            "signed_by": user.get("username"),
            "signed_at": datetime.now().isoformat(timespec="seconds"),
        }
        cur.execute("UPDATE machine_dmc_filled SET week_meta=%s WHERE id=%s",
                    (json.dumps(wmeta), row["id"]))
    return {"ok": True, "week": int(body.week), "status": "SIGNED"}


@router.get("/ng-points")
def dmc_ng_points(zone:       Optional[str] = Query(None),
                  line:       Optional[str] = Query(None),
                  machine_no: Optional[str] = Query(None),
                  month:      Optional[str] = Query(None),   # YYYY-MM
                  date_from:  Optional[str] = Query(None),
                  date_to:    Optional[str] = Query(None),
                  status:     Optional[str] = Query(None),   # OPEN | CLOSED
                  limit:      int = Query(2000, ge=1, le=10000),
                  user=Depends(get_current_user)):
    """Every ✗ (Not-OK) DMC point, newest first — zone / line / machine wise,
    with its corrective action / close state.  `counts` is computed over the
    filter BEFORE the status narrowing, so the totals always tell the truth."""
    _ensure_dmc()
    where, params = [], []
    if zone:       where.append("zone_name = %s");   params.append(zone)
    if line:       where.append("line_name = %s");   params.append(line)
    if machine_no: where.append("machine_no = %s");  params.append(machine_no)
    if month:      where.append("sheet_month = %s"); params.append(month)
    if date_from:  where.append("ng_date >= %s");    params.append(date_from)
    if date_to:    where.append("ng_date <= %s");    params.append(date_to)
    wsql = ("WHERE " + " AND ".join(where)) if where else ""
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute(f"""
            SELECT id, zone_name, line_name, machine_no, machine_name, ng_date, sheet_month,
                   point_id, s_no, category, check_point, criteria, method, resp, freq, reason,
                   filled_by, created_at,
                   COALESCE(status, 'OPEN') AS status, action_taken, closed_by, closed_at
              FROM machine_dmc_fill_ng_point {wsql}
             ORDER BY ng_date DESC, machine_no, s_no
             LIMIT %s
        """, params + [limit])
        rows = cur.fetchall()
    counts = {
        "open":   sum(1 for r in rows if str(r.get("status") or "OPEN").upper() != "CLOSED"),
        "closed": sum(1 for r in rows if str(r.get("status") or "OPEN").upper() == "CLOSED"),
        "total":  len(rows),
    }
    if status:
        rows = [r for r in rows if str(r.get("status") or "OPEN").upper() == status.upper()]
    for r in rows:
        for k in ("ng_date",):
            if isinstance(r.get(k), date):
                r[k] = r[k].isoformat()
        for k in ("created_at", "closed_at"):
            if isinstance(r.get(k), datetime):
                r[k] = r[k].isoformat()
    return {"rows": rows, "total": len(rows), "counts": counts}


@router.get("/ng-summary")
def dmc_ng_summary(zone:  Optional[str] = Query(None),
                   line:  Optional[str] = Query(None),
                   month: Optional[str] = Query(None),
                   user=Depends(get_current_user)):
    """Machine-wise count of OPEN ✗ points (+ grand total) — for the dashboard."""
    _ensure_dmc()
    where = ["COALESCE(status,'OPEN') <> 'CLOSED'"]
    params = []
    if zone:  where.append("zone_name = %s");   params.append(zone)
    if line:  where.append("line_name = %s");   params.append(line)
    if month: where.append("sheet_month = %s"); params.append(month)
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute(f"""
            SELECT zone_name, line_name, machine_no,
                   MAX(machine_name) AS machine_name,
                   COUNT(*)          AS open_count,
                   MAX(ng_date)      AS last_ng
              FROM machine_dmc_fill_ng_point
             WHERE {' AND '.join(where)}
             GROUP BY zone_name, line_name, machine_no
             ORDER BY COUNT(*) DESC, machine_no
        """, params)
        rows = cur.fetchall()
    for r in rows:
        if isinstance(r.get("last_ng"), date):
            r["last_ng"] = r["last_ng"].isoformat()
    return {"rows": rows,
            "total_open": sum(r["open_count"] for r in rows),
            "machines": len(rows)}


class DmcNgAction(BaseModel):
    action_taken: str
    reopen:       Optional[bool] = False


@router.put("/ng-point/{ng_id}/action")
def dmc_ng_action(ng_id: int, body: DmcNgAction, user=Depends(get_current_user)):
    """Record the corrective action on an NG point and CLOSE it (or reopen)."""
    _ensure_dmc()
    action = (body.action_taken or "").strip()
    if not body.reopen and not action:
        raise HTTPException(400, "Action taken is required to close an NG point")
    with get_conn() as conn:
        cur = conn.cursor()
        if body.reopen:
            cur.execute("""UPDATE machine_dmc_fill_ng_point
                              SET status='OPEN', closed_by=NULL, closed_at=NULL
                            WHERE id=%s""", (ng_id,))
        else:
            cur.execute("""UPDATE machine_dmc_fill_ng_point
                              SET action_taken=%s, status='CLOSED',
                                  closed_by=%s, closed_at=NOW()
                            WHERE id=%s""", (action, user.get("username"), ng_id))
        if cur.rowcount == 0:
            raise HTTPException(404, "NG point not found")
    return {"ok": True, "id": ng_id, "status": "OPEN" if body.reopen else "CLOSED"}


@router.get("/check-sheet-fill-current")
def dmc_fill_current(machine_no: str = Query(...),
                     month: str = Query(...),
                     zone: str = Query(""),
                     line: str = Query(""),
                     user=Depends(get_current_user)):
    """The saved monthly fill for (machine, month), or null — lets the operator
    resume a partially-ticked sheet."""
    _ensure_dmc()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("""SELECT * FROM machine_dmc_filled
                        WHERE zone_name=%s AND line_name=%s AND machine_no=%s AND sheet_month=%s
                        ORDER BY id DESC LIMIT 1""",
                    (zone, line, machine_no, month))
        row = cur.fetchone()
    if row and isinstance(row.get("created_at"), datetime):
        row["created_at"] = row["created_at"].isoformat()
    return row or None
