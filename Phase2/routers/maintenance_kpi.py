"""
routers/maintenance_kpi.py
==========================
Maintenance KPI dashboard — auto-computed from the filled slips over a
selectable period (today / last 7d / 30d / custom range).  Compares each
KPI to its admin-set target and returns a pass/fail flag.

KPIs computed
-------------
  mtbf_hours          — mean time between failures (hours)
                          = window_hours / breakdowns_count       (higher is better)
  mttr_minutes        — mean time to repair (minutes)
                          = AVG(ended_at - started_at)            (lower is better)
  availability_pct    — Availability %
                          = MTBF / (MTBF + MTTR_h) × 100          (higher is better)
  breakdowns_count    — total breakdowns in window                 (lower is better)
  total_downtime_min  — sum of (ended_at - started_at) minutes     (lower is better)
  pending_closures    — RESOLVED tickets waiting for closure form  (lower is better)

Endpoints
---------
GET    /api/maintenance-kpi/                  Compute KPIs (with target compare)
GET    /api/maintenance-kpi/export.csv        Same data as CSV download
GET    /api/maintenance-kpi/targets           List all targets
POST   /api/maintenance-kpi/targets           Create / upsert target (admin)
PUT    /api/maintenance-kpi/targets/{id}      Update target (admin)
DELETE /api/maintenance-kpi/targets/{id}      Delete target (admin)
"""
import csv
import io
import calendar
from datetime import datetime, timedelta, date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

_AUTO_SLIP_TBL = "maintenance_auto_breakdown_slip"


def _stamp(d, t):
    """Slip me date aur time alag columns me hain (`bd_start_date` +
    `bd_start_time` = 'HH:MM').  Frontend ek timestamp expect karta hai,
    isliye dono ko jod kar ISO bana dete hain."""
    if not d:
        return None
    try:
        hh, mm = (t or "00:00").split(":")[:2]
        return datetime(d.year, d.month, d.day, int(hh), int(mm)).isoformat()
    except Exception:
        return datetime(d.year, d.month, d.day).isoformat()
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from database import get_conn, dict_cursor
from auth import get_current_user, require_admin

router = APIRouter(prefix="/api/maintenance-kpi", tags=["maintenance-kpi"])


# ── KPI metadata ─────────────────────────────────────────────────────
KPI_DEFS = [
    # (key, label, unit, direction, default_target)
    ("mtbf_hours",         "MTBF",                "hours",   "higher", 100.0),
    ("mttr_minutes",       "MTTR",                "minutes", "lower",   30.0),
    ("availability_pct",   "Availability",        "%",       "higher",  95.0),
    ("breakdowns_count",   "Total breakdowns",    "count",   "lower",   10.0),
    ("total_downtime_min", "Total downtime",      "minutes", "lower",  120.0),
    ("pending_closures",   "Pending closures",    "count",   "lower",    0.0),
]


# ── Models ───────────────────────────────────────────────────────────
class TargetUpsert(BaseModel):
    kpi_key:      str
    line_id:      Optional[int] = None
    target_value: float
    unit:         Optional[str] = None
    direction:    str = "higher"
    is_active:    bool = True


# ── Helpers ──────────────────────────────────────────────────────────
def _resolve_window(period: Optional[str],
                    date_from: Optional[str],
                    date_to:   Optional[str]) -> tuple[datetime, datetime, str]:
    """Map (period | from-to) → (start_dt, end_dt, label).
    period can be: today / yesterday / 7d / 30d / 90d / custom"""
    now = datetime.utcnow()
    today_start = datetime.combine(date.today(), datetime.min.time())

    if period == "custom":
        if not date_from or not date_to:
            raise HTTPException(400, "custom period requires from + to (YYYY-MM-DD)")
        try:
            f = datetime.strptime(date_from, "%Y-%m-%d")
            t = datetime.strptime(date_to,   "%Y-%m-%d") + timedelta(days=1)
        except ValueError:
            raise HTTPException(400, "from/to must be YYYY-MM-DD")
        return f, t, f"{date_from} → {date_to}"
    if period == "today":
        return today_start, now, "Today"
    if period == "yesterday":
        y = today_start - timedelta(days=1)
        return y, today_start, "Yesterday"
    if period == "30d":
        return now - timedelta(days=30), now, "Last 30 days"
    if period == "90d":
        return now - timedelta(days=90), now, "Last 90 days"
    # default = 7d
    return now - timedelta(days=7), now, "Last 7 days"


def _targets() -> dict:
    """{kpi_key: target} — Dashboard ke KPI card ka pass/fail target.

    Zone / Line / Machine ke asli target `maintenance_kpi_target` me hain
    (Admin Panel > KPI Targets) — wo Maintenance KPI page dikhata hai.
    Dashboard ka card in saade default par chalta hai.
    """
    return {key: {"kpi_key": key, "line_id": None, "target_value": default,
                  "unit": unit, "direction": direction, "is_active": True}
            for key, label, unit, direction, default in KPI_DEFS}


def _compute(conn, start: datetime, end: datetime, line_id: Optional[int],
             zone_name: Optional[str] = None, line_name: Optional[str] = None) -> dict:
    """Aggregate raw figures from the AUTO slips over [start, end).

    Source: **`maintenance_auto_breakdown_slip`** — ANDON ke Maintenance call
    se bani slips.  Upar ke stat cards aur neeche ki slip list, dono yahi se
    aate hain, isliye unke numbers hamesha match karte hain.

    Down-time slip ke `mc_down_time_minutes` se aata hai (wahi ANDON ka
    start→OK ka hisaab), aur "pending closure" = jis slip me maintenance ne
    abhi problem/action nahi bhara.  zone/line filter seedha slip ke apne
    text columns par lagta hai — kisi JOIN ki zaroorat nahi."""
    cur = dict_cursor(conn)
    where = "s.bd_start_date >= %s::date AND s.bd_start_date <= %s::date"
    params: list = [start.date(), (end - timedelta(seconds=1)).date()]
    if line_id is not None:
        pass
    if line_name:
        where += " AND s.line = %s"
        params.append(line_name)
    if zone_name:
        where += " AND s.zone = %s"
        params.append(zone_name)

    cur.execute(f"""
        SELECT COUNT(*)                                            AS bd_count,
               COALESCE(SUM(s.mc_down_time_minutes), 0) * 60       AS total_down_sec,
               COALESCE(AVG(s.mc_down_time_minutes), 0) * 60       AS avg_repair_sec,
               COUNT(*) FILTER (
                   WHERE COALESCE(NULLIF(TRIM(s.action_taken_on_problem), ''), '') = ''
                     AND COALESCE(NULLIF(TRIM(s.problem_observed_by_maintenance), ''), '') = ''
               )                                                   AS pending_closures
          FROM {_AUTO_SLIP_TBL} s
         WHERE {where}
    """, params)
    row = cur.fetchone() or {}

    bd_count        = int(row.get("bd_count") or 0)
    total_down_sec  = float(row.get("total_down_sec") or 0)
    avg_repair_sec  = float(row.get("avg_repair_sec") or 0)
    pending         = int(row.get("pending_closures") or 0)

    window_hours = max((end - start).total_seconds() / 3600.0, 0.001)

    if bd_count > 0:
        # Uptime = window - total downtime, divided across failures
        uptime_hours = max(window_hours - total_down_sec / 3600.0, 0)
        mtbf_hours   = round(uptime_hours / bd_count, 2)
        mttr_minutes = round(avg_repair_sec / 60.0, 2)
    else:
        mtbf_hours   = round(window_hours, 2)  # zero failures → MTBF = full window
        mttr_minutes = 0.0

    if mtbf_hours > 0 or mttr_minutes > 0:
        denom = mtbf_hours + (mttr_minutes / 60.0)
        availability_pct = round((mtbf_hours / denom) * 100.0, 2) if denom > 0 else 100.0
    else:
        availability_pct = 100.0

    return {
        "mtbf_hours":         mtbf_hours,
        "mttr_minutes":       mttr_minutes,
        "availability_pct":   availability_pct,
        "breakdowns_count":   bd_count,
        "total_downtime_min": round(total_down_sec / 60.0, 1),
        "pending_closures":   pending,
    }


def _verdict(value: float, target: float, direction: str) -> str:
    """'pass' / 'fail' / 'na' depending on direction."""
    if value is None or target is None:
        return "na"
    if direction == "higher":
        return "pass" if value >= target else "fail"
    if direction == "lower":
        return "pass" if value <= target else "fail"
    return "na"


def _build_payload(conn, start: datetime, end: datetime,
                   line_id: Optional[int], window_label: str,
                   zone_name: Optional[str] = None, line_name: Optional[str] = None) -> dict:
    raw     = _compute(conn, start, end, line_id, zone_name, line_name)
    targets = _targets()

    cards = []
    for key, label, unit, direction, _default in KPI_DEFS:
        t   = targets[key]
        val = raw[key]
        cards.append({
            "kpi_key":   key,
            "label":     label,
            "value":     val,
            "unit":      t.get("unit") or unit,
            "target":    t["target_value"],
            "direction": t["direction"],
            "verdict":   _verdict(val, t["target_value"], t["direction"]),
        })

    # Resolve line name so the UI can echo it in the export.
    # AHEM: pehle yahan `line_name = None` bina shart ke chalta tha, jisse caller
    # ka Line filter MIT jaata tha — cards (_compute upar chal chuka) filter
    # maante the par neeche ke zone tiles aur slip list nahi.  Ab caller ka
    # line_name jaisa hai waisa rehta hai; sirf line_id se naam nikaalte hain
    # jab naam diya hi na gaya ho.
    if line_id and not line_name:
        cur = dict_cursor(conn)
        cur.execute("SELECT NULL::text AS line_name")   # line ka master nahi hai
        r = cur.fetchone()
        line_name = r["line_name"] if r else None

    zs_where = ["s.bd_start_date >= %s::date", "s.bd_start_date <= %s::date",
                "COALESCE(NULLIF(TRIM(s.action_taken_on_problem), ''), '') = ''",
                "COALESCE(NULLIF(TRIM(s.problem_observed_by_maintenance), ''), '') = ''"]
    zs_params: list = [start.date(), (end - timedelta(seconds=1)).date()]
    if line_name:
        zs_where.append("s.line = %s"); zs_params.append(line_name)
    if zone_name:
        zs_where.append("s.zone = %s"); zs_params.append(zone_name)
    cur = dict_cursor(conn)
    cur.execute(f"""
        SELECT COALESCE(s.zone, '(unzoned)') AS zone_name,
               COUNT(*) AS pending
          FROM {_AUTO_SLIP_TBL} s
         WHERE {' AND '.join(zs_where)}
         GROUP BY 1 ORDER BY 2 DESC
    """, zs_params)
    zone_pending = cur.fetchall()

    # Per-zone TOTAL slips (bhari + pending, dono) — taaki tiles ka jod
    # "Total Breakdowns" card se mile.  Ye bhi ab AUTO slips se.
    zt_where = ["s.bd_start_date >= %s::date", "s.bd_start_date <= %s::date"]
    zt_params: list = [start.date(), (end - timedelta(seconds=1)).date()]
    if line_name:
        zt_where.append("s.line = %s"); zt_params.append(line_name)
    if zone_name:
        zt_where.append("s.zone = %s"); zt_params.append(zone_name)

    cur.execute(f"""
        SELECT COALESCE(s.zone, '(unzoned)') AS zone_name,
               COUNT(*) AS total
          FROM {_AUTO_SLIP_TBL} s
         WHERE {' AND '.join(zt_where)}
         GROUP BY 1 ORDER BY 2 DESC
    """, zt_params)
    zone_totals = cur.fetchall()

    sl_where = ["s.bd_start_date >= %s::date", "s.bd_start_date <= %s::date"]
    sl_params: list = [start.date(), (end - timedelta(seconds=1)).date()]
    if line_name:
        sl_where.append("s.line = %s"); sl_params.append(line_name)
    if zone_name:
        sl_where.append("s.zone = %s"); sl_params.append(zone_name)

    cur.execute(f"""
        SELECT s.id,
               NULL::int                                   AS serial_in_shift,
               s.shift                                     AS shift_name,
               s.bd_start_date, s.bd_start_time,
               s.bd_end_date,   s.bd_ok_time,
               s.mc_down_time_minutes,
               CASE WHEN COALESCE(NULLIF(TRIM(s.action_taken_on_problem), ''), '') = ''
                     AND COALESCE(NULLIF(TRIM(s.problem_observed_by_maintenance), ''), '') = ''
                    THEN 'PENDING' ELSE 'COMPLETED' END    AS state,
               -- Reason: production ne kuch likha ho to wahi; warna batao ye
               -- ANDON se apne aap bani hai.  POWER CUT wali slip par saaf
               -- nishaan — uska OK time button se nahi, bijli jaane se bana
               -- tha, isliye bharose ke laayak nahi.
               CASE WHEN s.power_cut THEN
                        '⚠ POWER CUT se band — OK time check karein'
                    ELSE COALESCE(NULLIF(TRIM(s.problem_reported_by_production), ''),
                                  'ANDON se auto-generated') END  AS reason,
               COALESCE(s.zone, '(unzoned)')               AS zone_name,
               s.line                                      AS line_name
          FROM {_AUTO_SLIP_TBL} s
         WHERE {' AND '.join(sl_where)}
         ORDER BY s.bd_start_date DESC, s.bd_start_time DESC
    """, sl_params)
    breakdowns = []
    for r in cur.fetchall():
        r = dict(r)
        # DATE + 'HH:MM' → ISO timestamp (frontend inhe todkar time dikhata hai)
        r["started_at"] = _stamp(r.pop("bd_start_date"), r.pop("bd_start_time"))
        r["ended_at"]   = _stamp(r.pop("bd_end_date"),   r.pop("bd_ok_time"))
        breakdowns.append(r)

    return {
        "window":   {"label": window_label,
                     "from":  start.isoformat(),
                     "to":    end.isoformat()},
        "line_id":  line_id,
        "line_name": line_name,
        "kpis":     cards,
        "zone_pending": zone_pending,
        "zone_totals":  zone_totals,
        "breakdowns":   breakdowns,
    }


# ── Endpoints ────────────────────────────────────────────────────────
@router.get("/")
def get_kpis(period:    Optional[str] = Query("7d"),
             date_from: Optional[str] = Query(None),
             date_to:   Optional[str] = Query(None),
             line_id:   Optional[int] = Query(None),
             zone_name: Optional[str] = Query(None),
             line_name: Optional[str] = Query(None),
             user=Depends(get_current_user)):
    """Compute KPIs for the requested window + zone/line, with target verdicts."""
    start, end, label = _resolve_window(period, date_from, date_to)
    with get_conn() as conn:
        return _build_payload(conn, start, end, line_id, label, zone_name, line_name)


# ── Financial-year summary (Apr → Mar) ───────────────────────────────
# Powers the standalone "Maintenance KPI" page.  A financial year runs
# 1-Apr of the start year to 31-Mar of the next, e.g. fy="2025-26" →
# [2025-04-01, 2026-04-01).  Returns the six headline figures the page
# shows as live cards.
def _fy_window(fy: str) -> tuple[datetime, datetime, str]:
    """'2025-26' → (2025-04-01, 2026-04-01, 'Apr 2025 – Mar 2026')."""
    try:
        start_year = int(str(fy).split("-")[0])
    except (ValueError, AttributeError, IndexError):
        raise HTTPException(400, "fy must look like '2025-26'")
    start = datetime(start_year,     4, 1)
    end   = datetime(start_year + 1, 4, 1)
    label = f"Apr {start_year} – Mar {start_year + 1}"
    return start, end, label


def _current_fy_start(now: datetime) -> int:
    """Start year of the FY that `now` falls in (Apr-anchored)."""
    return now.year if now.month >= 4 else now.year - 1


@router.get("/summary")
def fy_summary(fy:         Optional[str] = Query(None, description="e.g. 2025-26"),
               zone_name:  Optional[str] = Query(None),
               line_name:  Optional[str] = Query(None),
               machine_no: Optional[str] = Query(None),
               user=Depends(get_current_user)):
    """Six headline maintenance KPIs for a financial year (Apr → Mar):
    MTTR, MTBF, LTTR, breakdowns > 1 hour, total breakdown frequency,
    total breakdown hours.

    Source: maintenance_breakdown_data — the maintenance breakdown register, which
    carries the per-slip repair time (mc_down_time_minutes) and breakdown date
    (bd_date).  Live — recomputed on every call."""
    now = datetime.utcnow()
    if not fy:
        cy = _current_fy_start(now)
        fy = f"{cy}-{str(cy + 1)[-2:]}"
    start, end, label = _fy_window(fy)

    # Window for MTBF must be *elapsed* time, so cap the end at "now"
    # when the FY is still in progress (e.g. current year).
    eff_end = min(end, now)
    window_hours = max((eff_end - start).total_seconds() / 3600.0, 0.001)

    # Source = maintenance_breakdown_data — the maintenance breakdown register (910
    # rows).  Its zone / line / machine_no use the same Machine-
    # Master taxonomy as the master list, so the page's zone/line/machine
    # filters map straight onto those columns.  mc_down_time_minutes is a numeric
    # column here → used directly (no text cast needed).
    where = "COALESCE(slip_date, bd_start_date) >= %s AND COALESCE(slip_date, bd_start_date) < %s"
    params: list = [start.date(), end.date()]
    if zone_name:
        where += " AND zone = %s";  params.append(zone_name)
    if line_name:
        where += " AND line = %s";  params.append(line_name)
    if machine_no:
        where += " AND machine_no = %s"; params.append(machine_no)

    st = "mc_down_time_minutes"
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute(f"""
            SELECT
                COUNT(*)                                  AS bd_count,
                COALESCE(SUM({st}), 0)                    AS total_min,
                COALESCE(AVG({st}), 0)                    AS avg_min,
                COALESCE(MAX({st}), 0)                    AS max_min,
                COUNT(*) FILTER (WHERE ({st}) > 60)       AS over_1hr
              FROM maintenance_breakdown_data
             WHERE {where}
        """, params)
        row = cur.fetchone() or {}

    bd_count   = int(row.get("bd_count") or 0)
    total_min  = float(row.get("total_min") or 0)
    avg_min    = float(row.get("avg_min") or 0)
    max_min    = float(row.get("max_min") or 0)
    over_1hr   = int(row.get("over_1hr") or 0)

    total_hours  = round(total_min / 60.0, 2)
    mttr_minutes = round(avg_min, 2)
    lttr_minutes = round(max_min, 2)

    if bd_count > 0:
        uptime_hours = max(window_hours - total_hours, 0)
        mtbf_hours   = round(uptime_hours / bd_count, 2)
    else:
        # No breakdowns for this filter (e.g. a zone/line/machine with no
        # data) → every figure reads 0, not the full window as "infinite
        # uptime".  The user wants an empty filter to show plain zeros.
        mtbf_hours   = 0.0

    return {
        "fy":        fy,
        "fy_label":  label,
        "zone_name": zone_name,
        "line_name": line_name,
        "machine_no": machine_no,
        "window":    {"from": start.isoformat(), "to": end.isoformat(),
                      "as_of": eff_end.isoformat()},
        "metrics": {
            "mttr_minutes":          mttr_minutes,
            "mtbf_hours":            mtbf_hours,
            "lttr_minutes":          lttr_minutes,
            # LTTR = the single breakdown that took the LONGEST to solve,
            # expressed in hours (max solve_time / 60).
            "lttr_hours":            round(max_min / 60.0, 2),
            "over_1hr_count":        over_1hr,
            "breakdown_frequency":   bd_count,
            "total_breakdown_hours": total_hours,
        },
    }


@router.get("/trend")
def fy_trend(fy:         Optional[str] = Query(None, description="e.g. 2025-26"),
             zone_name:  Optional[str] = Query(None),
             line_name:  Optional[str] = Query(None),
             machine_no: Optional[str] = Query(None),
             user=Depends(get_current_user)):
    """Month-by-month series (Apr → Mar, 12 buckets) for the same six
    KPIs as /summary.  Source: maintenance_breakdown_data (the breakdown register),
    filterable by zone/line/machine_no via its zone/line columns."""
    now = datetime.utcnow()
    if not fy:
        cy = _current_fy_start(now)
        fy = f"{cy}-{str(cy + 1)[-2:]}"
    start, end, label = _fy_window(fy)

    where = "COALESCE(slip_date, bd_start_date) >= %s AND COALESCE(slip_date, bd_start_date) < %s"
    params: list = [start.date(), end.date()]
    if zone_name:
        where += " AND zone = %s";  params.append(zone_name)
    if line_name:
        where += " AND line = %s";  params.append(line_name)
    if machine_no:
        where += " AND machine_no = %s"; params.append(machine_no)

    st = "mc_down_time_minutes"
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute(f"""
            SELECT date_trunc('month', COALESCE(slip_date, bd_start_date))::date           AS m,
                   COUNT(*)                                      AS bd_count,
                   COALESCE(SUM({st}), 0)                        AS total_min,
                   COALESCE(AVG({st}), 0)                        AS avg_min,
                   COALESCE(MAX({st}), 0)                        AS max_min,
                   COUNT(*) FILTER (WHERE ({st}) > 60)           AS over_1hr
              FROM maintenance_breakdown_data
             WHERE {where}
             GROUP BY 1
        """, params)
        by_month = {r["m"]: r for r in cur.fetchall()}

    # Build the 12 FY months in order (Apr → Mar), filling gaps with zeros.
    series = []
    for i in range(12):
        y = start.year + (start.month - 1 + i) // 12
        mo = (start.month - 1 + i) % 12 + 1
        key = date(y, mo, 1)
        r = by_month.get(key)

        # Elapsed hours in this month (cap the current/in-progress month at now).
        days = calendar.monthrange(y, mo)[1]
        m_start = datetime(y, mo, 1)
        m_end   = m_start + timedelta(days=days)
        eff_end = min(m_end, now)
        month_hours = max((eff_end - m_start).total_seconds() / 3600.0, 0.001) \
            if eff_end > m_start else days * 24.0

        if r:
            cnt   = int(r["bd_count"] or 0)
            t_min = float(r["total_min"] or 0)
            a_min = float(r["avg_min"] or 0)
            x_min = float(r["max_min"] or 0)
            o1    = int(r["over_1hr"] or 0)
        else:
            cnt = t_min = a_min = x_min = o1 = 0

        t_hours = round(t_min / 60.0, 2)
        mtbf = round(max(month_hours - t_hours, 0) / cnt, 2) if cnt > 0 else 0.0

        series.append({
            "month":  calendar.month_abbr[mo],
            "ym":     key.isoformat(),
            "mttr_minutes":          round(a_min, 2),
            "mtbf_hours":            mtbf,
            "lttr_minutes":          round(x_min, 2),
            "lttr_hours":            round(x_min / 60.0, 2),
            "over_1hr_count":        o1,
            "breakdown_frequency":   cnt,
            "total_breakdown_hours": t_hours,
        })

    return {"fy": fy, "fy_label": label, "zone_name": zone_name,
            "line_name": line_name, "machine_no": machine_no, "series": series}


@router.get("/breakdown-by")
def breakdown_by(group:        str = Query("zone", description="zone | line | machine"),
                 fy:           Optional[str] = Query(None, description="e.g. 2025-26; empty = all time"),
                 month:        Optional[str] = Query(None, description="YYYY-MM (narrows inside the FY)"),
                 zone_name:    Optional[str] = Query(None),
                 line_name:    Optional[str] = Query(None),
                 machine_no:   Optional[str] = Query(None),
                 machine_name: Optional[str] = Query(None),
                 user=Depends(get_current_user)):
    """Grouped breakdown totals for the BD-Analysis drill-down charts:
    total breakdown FREQUENCY (count) and total breakdown HOURS
    (SUM(mc_down_time_minutes)/60) per zone / per line / per machine_no.
    Source: maintenance_breakdown_data (same register as /summary & /trend).
    Drill: no zone filter → group=zone; zone picked → group=line;
    line picked → group=machine."""
    col = {"zone": "zone", "line": "line", "machine": "machine_no"}.get(group)
    if not col:
        raise HTTPException(400, "group must be one of: zone, line, machine")

    where, params = [f"{col} IS NOT NULL AND {col} <> ''"], []
    if month:
        try:
            y, m = map(int, str(month).split("-"))
            m_start = date(y, m, 1)
            m_end   = date(y + 1, 1, 1) if m == 12 else date(y, m + 1, 1)
        except (ValueError, TypeError):
            raise HTTPException(400, "month must be YYYY-MM")
        where.append("COALESCE(slip_date, bd_start_date) >= %s AND COALESCE(slip_date, bd_start_date) < %s"); params += [m_start, m_end]
    elif fy:
        start, end, _ = _fy_window(fy)
        where.append("COALESCE(slip_date, bd_start_date) >= %s AND COALESCE(slip_date, bd_start_date) < %s"); params += [start.date(), end.date()]
    if zone_name:
        where.append("zone = %s");    params.append(zone_name)
    if line_name:
        where.append("line = %s");    params.append(line_name)
    if machine_no:
        where.append("machine_no = %s");   params.append(machine_no)
    if machine_name:
        where.append("machine_name = %s"); params.append(machine_name)

    st = "mc_down_time_minutes"
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute(f"""
            SELECT {col}                                        AS key,
                   COUNT(*)                                     AS frequency,
                   ROUND(COALESCE(SUM({st}), 0) / 60.0, 2)      AS hours,
                   ROUND(COALESCE(SUM({st}), 0))                AS minutes
              FROM maintenance_breakdown_data
             WHERE {' AND '.join(where)}
             GROUP BY 1
             ORDER BY 1
        """, params)
        rows = cur.fetchall() or []
    return {"group": group,
            "rows": [{"key": r["key"],
                      "frequency": int(r["frequency"] or 0),
                      "hours": float(r["hours"] or 0),
                      "minutes": int(r["minutes"] or 0)} for r in rows]}


@router.get("/filter-options")
def filter_options(user=Depends(get_current_user)):
    """Distinct zone / line / machine combos actually present in
    maintenance_breakdown_data — feeds the KPI & MTTR/MTBF filter dropdowns so the
    options always match the data (instead of the machine master, whose
    taxonomy can drift from the register)."""
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("""
            SELECT DISTINCT zone  AS zone_name,
                            line  AS line_name,
                            machine_no,
                            machine_name
              FROM maintenance_breakdown_data
             WHERE zone IS NOT NULL AND zone <> ''
             ORDER BY 1, 2, 3
        """)
        return cur.fetchall()


@router.get("/financial-years")
def financial_years(user=Depends(get_current_user)):
    """List selectable financial years, newest first, from FY 2025-26 up
    to the FY the current date falls in."""
    now = datetime.utcnow()
    cur_start = _current_fy_start(now)
    first = 2025
    last  = max(cur_start, first)
    out = []
    for y in range(last, first - 1, -1):
        out.append({"fy": f"{y}-{str(y + 1)[-2:]}",
                    "label": f"Apr {y} – Mar {y + 1}",
                    "is_current": y == cur_start})
    return out


@router.get("/export.csv")
def export_csv(period:    Optional[str] = Query("7d"),
               date_from: Optional[str] = Query(None),
               date_to:   Optional[str] = Query(None),
               line_id:   Optional[int] = Query(None),
               user=Depends(get_current_user)):
    """Same payload as /  but as a flat CSV file the user can keep."""
    start, end, label = _resolve_window(period, date_from, date_to)
    with get_conn() as conn:
        payload = _build_payload(conn, start, end, line_id, label)

    buf = io.StringIO()
    w   = csv.writer(buf)
    w.writerow(["Maintenance KPI Report"])
    w.writerow(["Period",  payload["window"]["label"],
                "From", payload["window"]["from"],
                "To",   payload["window"]["to"]])
    w.writerow(["Line",    payload["line_name"] or "(All lines)"])
    w.writerow([])
    w.writerow(["KPI", "Value", "Unit", "Target", "Direction", "Verdict"])
    for c in payload["kpis"]:
        w.writerow([c["label"], c["value"], c["unit"], c["target"],
                    c["direction"], c["verdict"].upper()])

    fname = f"maintenance_kpi_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.csv"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )
