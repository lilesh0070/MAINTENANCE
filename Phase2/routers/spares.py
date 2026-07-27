# ════════════════════════════════════════════════════════════════════
#  routers/spares.py — Spare consumption, consolidated
# --------------------------------------------------------------------
#  READ-ONLY report.  Nothing is entered here: every spare shown was
#  recorded in the page that already owns that workflow.  Three sources:
#
#    Breakdown  mes_breakdown_log.spares_detail
#               → ONE free-text field ("CNMM0320 QTY-02 NOS"), often with
#                 several spares mashed into one string.  Kept VERBATIM;
#                 the quantity is a best-effort parse and is flagged as
#                 such (qty_source) so a guess is never mistaken for data.
#    Log Book   maintenance_logbook_db_history
#               → properly split: spare_name / spare_model_no /
#                 spare_cnmm_no / spare_qty, plus a multi-spare `spares`
#                 JSONB list.  This is the only source that has a MODEL.
#    PM         maintenance_pm_check_sheet_filled.entries[].spares_used
#               → free text per check point.  Only APPROVED sheets count,
#                 same rule History uses — an unapproved sheet can still
#                 be edited or sent back.
#
#  NOTE: mes_breakdown_log.model_no is empty for every row and
#  mes_machines has no model column at all, so Breakdown/PM rows carry
#  no model.  That is a data-capture gap, not a bug here.
# ════════════════════════════════════════════════════════════════════
from __future__ import annotations

import re
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from database import get_conn, dict_cursor
from auth import get_current_user

router = APIRouter(prefix="/api/spares", tags=["spares"])

SOURCES = ("Manual Slip", "Log Book")

# ── best-effort quantity out of free text ────────────────────────────
# Alternatives are ordered so the most explicit wins, and finditer never
# overlaps — so "QTY-02 NOS" yields 2 once, not 2 twice.
_QTY_RE = re.compile(
    r"""
      (?:QTY|QNTY|Q'?TY)[\s.:\-]*(\d{1,4})\s*(?:NOS|NO\.?|PCS|PC)?\b   # QTY-02 NOS
    | \(\s*(\d{1,4})\s*(?:NOS|NO\.?|PCS|PC)\s*\)                        # (1 NOS)
    | (\d{1,4})\s*[-–]?\s*(?:NOS|PCS)\b                                 # 02-NOS / 01 NOS
    | =\s*(\d{1,3})\s*(?=$|[,;])                                        # "CNMM2758=01" / "…=01,"
    | \s[-–]\s*(\d{1,3})\s*$                                            # trailing " - 01"
    """,
    re.IGNORECASE | re.VERBOSE,
)
# Two deliberate narrow spots, both learned from the real 293 rows:
#   • "=NN" only counts at the end or before a comma, else "FCV=1/8*6=2NOS"
#     would read the size 1/8 as a quantity.
#   • the trailing dash needs a SPACE before it ("GOT - 01" yes,
#     "CDQMB20-5" no) — part numbers routinely end in -<digits>.


def parse_qty(text: str) -> tuple[Optional[int], str]:
    """Return (quantity, how_we_got_it) for a free-text spare string.

    how_we_got_it: 'parsed'  — exactly one quantity found
                   'summed'  — several found (string held >1 spare), added up
                   'none'    — nothing recognisable; quantity stays NULL
    """
    if not text:
        return None, "none"
    nums = []
    for m in _QTY_RE.finditer(text):
        g = next((x for x in m.groups() if x), None)
        if g is not None:
            nums.append(int(g))
    if not nums:
        return None, "none"
    if len(nums) == 1:
        return nums[0], "parsed"
    return sum(nums), "summed"


def _to_int(v) -> Optional[int]:
    """Log Book qty is VARCHAR — take a clean integer if it is one."""
    s = str(v or "").strip()
    if not s:
        return None
    m = re.search(r"\d{1,5}", s)
    return int(m.group()) if m else None


@router.get("/consumption")
def spare_consumption(zone:       Optional[str] = Query(None),
                      line:       Optional[str] = Query(None),
                      machine_no: Optional[str] = Query(None),
                      source:     Optional[str] = Query(None, description="Breakdown | Log Book | PM"),
                      date_from:  Optional[str] = Query(None),
                      date_to:    Optional[str] = Query(None),
                      q:          Optional[str] = Query(None, description="search spare name / model / code"),
                      limit:      int = Query(5000, ge=1, le=20000),
                      user=Depends(get_current_user)):
    """Every spare used across the Manual Break Down Slip + Log Book — one row
    per spare occurrence, newest first.  Sourced entirely from maintenance_spare
    (the old Breakdown-log / PM sources are no longer read here)."""
    from routers.maintenance_spare import _ensure_table as _ensure_spare
    _ensure_spare()
    if source and source not in SOURCES:
        raise HTTPException(400, f"source must be one of {', '.join(SOURCES)}")

    w = ["NULLIF(TRIM(COALESCE(spare_name,'')),'') IS NOT NULL"]
    p: list = []
    if source:     w.append("source = %s");       p.append(source)
    if zone:       w.append("zone = %s");          p.append(zone)
    if line:       w.append("line = %s");          p.append(line)
    if machine_no: w.append("machine_no = %s");    p.append(machine_no)
    if date_from:  w.append("used_date >= %s");    p.append(date_from)
    if date_to:    w.append("used_date <= %s");    p.append(date_to)
    if q:
        w.append("(spare_name ILIKE %s OR COALESCE(spare_model_no,'') ILIKE %s "
                 "OR COALESCE(spare_cnmm_no,'') ILIKE %s)")
        p += [f"%{q}%", f"%{q}%", f"%{q}%"]

    rows: list[dict] = []
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute(f"""
            SELECT id, source, zone, line, machine_no, machine_name,
                   spare_name, spare_model_no, spare_cnmm_no, spare_qty, used_date
              FROM maintenance_spare
             WHERE {' AND '.join(w)}
             ORDER BY used_date DESC NULLS LAST, id DESC
             LIMIT %s
        """, p + [limit])
        for r in cur.fetchall():
            raw_q = (r["spare_qty"] or "").strip()
            try:
                qty, how = int(raw_q), "recorded"      # dedicated qty field
            except (ValueError, TypeError):
                qty, how = parse_qty(raw_q)
            rows.append({
                "source": r["source"] or "", "ref_id": r["id"],
                "zone": r["zone"], "line": r["line"],
                "machine_no": r["machine_no"], "machine_name": r["machine_name"],
                "model_no": r["spare_model_no"] or "", "cnmm_no": r["spare_cnmm_no"] or "",
                "spare_name": r["spare_name"],
                "qty": qty, "qty_source": how,
                "used_date": r["used_date"].isoformat() if r["used_date"] else None,
            })

    by_source = {s: sum(1 for r in rows if r["source"] == s) for s in SOURCES}
    return {
        "rows": rows,
        "total": len(rows),
        "by_source": by_source,
        # how trustworthy the Quantity column is, at a glance
        "qty_recorded": sum(1 for r in rows if r["qty_source"] == "recorded"),
        "qty_guessed":  sum(1 for r in rows if r["qty_source"] in ("parsed", "summed")),
        "qty_unknown":  sum(1 for r in rows if r["qty_source"] == "none"),
        "qty_total":    sum(r["qty"] or 0 for r in rows),
    }


def _fy_of(d: date) -> str:
    """Financial year label for a date — Apr→Mar, e.g. 2026-27."""
    s = d.year if d.month >= 4 else d.year - 1
    return f"{s}-{str(s + 1)[-2:]}"


@router.get("/filters")
def spare_filters(user=Depends(get_current_user)):
    """Zone → line → machine options, plus the financial years that actually
    have spare data.  Machines come straight from the machine master — the
    standing rule for every picker in the app."""
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("""SELECT zone_name, line_name, machine_no, machine_name
                         FROM mes_machines
                        WHERE COALESCE(is_active, TRUE)
                        ORDER BY zone_name, line_name, serial_no NULLS LAST, machine_no""")
        machines = cur.fetchall()

        # only offer years that actually have spare data (from maintenance_spare)
        from routers.maintenance_spare import _ensure_table as _ensure_spare
        _ensure_spare()
        cur.execute("""
            SELECT MIN(used_date) AS lo, MAX(used_date) AS hi
              FROM maintenance_spare
             WHERE used_date IS NOT NULL
        """)
        r = cur.fetchone() or {}

    years: list[str] = []
    if r.get("lo") and r.get("hi"):
        y = int(_fy_of(r["lo"]).split("-")[0])
        end = int(_fy_of(r["hi"]).split("-")[0])
        while y <= end:
            years.append(f"{y}-{str(y + 1)[-2:]}")
            y += 1
        years.reverse()                      # newest first
    return {"machines": machines, "years": years,
            "current_fy": _fy_of(date.today())}
