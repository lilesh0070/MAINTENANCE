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

SOURCES = ("Breakdown", "Log Book", "PM")

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
    """Every spare used across Breakdown, Log Book and PM — one row per
    spare occurrence, newest first."""
    if source and source not in SOURCES:
        raise HTTPException(400, f"source must be one of {', '.join(SOURCES)}")
    rows: list[dict] = []

    def want(src: str) -> bool:
        return not source or source == src

    with get_conn() as conn:
        cur = dict_cursor(conn)

        # ── 1. BREAKDOWN — free text, kept verbatim ──
        if want("Breakdown"):
            w, p = ["NULLIF(TRIM(COALESCE(spares_detail,'')),'') IS NOT NULL"], []
            if zone:       w.append("zone_code = %s");  p.append(zone)
            if line:       w.append("line_code = %s");  p.append(line)
            if machine_no: w.append("machine_no = %s"); p.append(machine_no)
            if date_from:  w.append("bd_date >= %s");   p.append(date_from)
            if date_to:    w.append("bd_date <= %s");   p.append(date_to)
            if q:          w.append("spares_detail ILIKE %s"); p.append(f"%{q}%")
            cur.execute(f"""
                SELECT id, zone_code AS zone, line_code AS line, machine_no, machine_name,
                       bd_date AS used_date, spares_detail
                  FROM mes_breakdown_log
                 WHERE {' AND '.join(w)}
                 ORDER BY bd_date DESC NULLS LAST, id DESC
                 LIMIT %s
            """, p + [limit])
            for r in cur.fetchall():
                qty, how = parse_qty(r["spares_detail"])
                rows.append({
                    "source": "Breakdown", "ref_id": r["id"],
                    "zone": r["zone"], "line": r["line"],
                    "machine_no": r["machine_no"], "machine_name": r["machine_name"],
                    "model_no": "", "cnmm_no": "",
                    "spare_name": r["spares_detail"],
                    "qty": qty, "qty_source": how,
                    "used_date": r["used_date"].isoformat() if r["used_date"] else None,
                })

        # ── 2. LOG BOOK — structured; expand the multi-spare list ──
        if want("Log Book"):
            w, p = ["1=1"], []
            if zone:       w.append("zone_name = %s");  p.append(zone)
            if line:       w.append("line_name = %s");  p.append(line)
            if machine_no: w.append("machine_no = %s"); p.append(machine_no)
            if date_from:  w.append("bd_date >= %s");   p.append(date_from)
            if date_to:    w.append("bd_date <= %s");   p.append(date_to)
            cur.execute(f"""
                SELECT id, zone_name AS zone, line_name AS line, machine_no, machine_name,
                       bd_date AS used_date, spares,
                       spare_name, spare_model_no, spare_cnmm_no, spare_qty
                  FROM maintenance_logbook_db_history
                 WHERE {' AND '.join(w)}
                 ORDER BY bd_date DESC NULLS LAST, id DESC
                 LIMIT %s
            """, p + [limit])
            for r in cur.fetchall():
                # the JSONB list is the source of truth; the flat columns are
                # a legacy mirror of its first item, so only fall back to them
                items = r["spares"] if isinstance(r["spares"], list) and r["spares"] else None
                if items is None:
                    items = [{"spare_name": r["spare_name"], "spare_model_no": r["spare_model_no"],
                              "spare_cnmm_no": r["spare_cnmm_no"], "spare_qty": r["spare_qty"]}]
                for it in items:
                    name = str((it or {}).get("spare_name") or "").strip()
                    model = str((it or {}).get("spare_model_no") or "").strip()
                    cnmm = str((it or {}).get("spare_cnmm_no") or "").strip()
                    raw_q = (it or {}).get("spare_qty")
                    if not (name or model or cnmm or str(raw_q or "").strip()):
                        continue
                    if q and q.lower() not in f"{name} {model} {cnmm}".lower():
                        continue
                    qty = _to_int(raw_q)
                    rows.append({
                        "source": "Log Book", "ref_id": r["id"],
                        "zone": r["zone"], "line": r["line"],
                        "machine_no": r["machine_no"], "machine_name": r["machine_name"],
                        "model_no": model, "cnmm_no": cnmm,
                        "spare_name": name,
                        "qty": qty, "qty_source": "recorded" if qty is not None else "none",
                        "used_date": r["used_date"].isoformat() if r["used_date"] else None,
                    })

        # ── 3. PM — spares_used per check point, APPROVED sheets only ──
        if want("PM"):
            w, p = ["stage = 'APPROVED'"], []
            if zone:       w.append("zone_name = %s");  p.append(zone)
            if line:       w.append("line_name = %s");  p.append(line)
            if machine_no: w.append("machine_no = %s"); p.append(machine_no)
            if date_from:  w.append("pm_date >= %s");   p.append(date_from)
            if date_to:    w.append("pm_date <= %s");   p.append(date_to)
            cur.execute(f"""
                SELECT id, zone_name AS zone, line_name AS line, machine_no, machine_name,
                       pm_date AS used_date, entries
                  FROM maintenance_pm_check_sheet_filled
                 WHERE {' AND '.join(w)}
                 ORDER BY pm_date DESC NULLS LAST, id DESC
                 LIMIT %s
            """, p + [limit])
            for r in cur.fetchall():
                for e in (r["entries"] or []):
                    used = str((e or {}).get("spares_used") or "").strip()
                    if not used:
                        continue
                    if q and q.lower() not in used.lower():
                        continue
                    qty, how = parse_qty(used)
                    rows.append({
                        "source": "PM", "ref_id": r["id"],
                        "zone": r["zone"], "line": r["line"],
                        "machine_no": r["machine_no"], "machine_name": r["machine_name"],
                        "model_no": "", "cnmm_no": "",
                        "spare_name": used,
                        "qty": qty, "qty_source": how,
                        "used_date": r["used_date"].isoformat() if r["used_date"] else None,
                        "check_point": str((e or {}).get("check_point") or "")[:120],
                    })

    rows.sort(key=lambda x: (x["used_date"] or "", x["source"]), reverse=True)
    rows = rows[:limit]
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

        # only offer years that have something in them
        cur.execute("""
            SELECT MIN(d) AS lo, MAX(d) AS hi FROM (
                SELECT bd_date AS d FROM mes_breakdown_log
                 WHERE NULLIF(TRIM(COALESCE(spares_detail,'')),'') IS NOT NULL AND bd_date IS NOT NULL
                UNION ALL
                SELECT bd_date FROM maintenance_logbook_db_history WHERE bd_date IS NOT NULL
                UNION ALL
                SELECT pm_date FROM maintenance_pm_check_sheet_filled
                 WHERE stage = 'APPROVED' AND pm_date IS NOT NULL
            ) t
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
