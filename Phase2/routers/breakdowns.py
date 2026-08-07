"""
routers/breakdowns.py
=====================
BREAKDOWN LOG — bhari hui Break Down Slips ka reader (`maintenance_breakdown_data`).

Ye wahi flat hub hai jisme plant ki SAARI breakdown entries aati hain — Excel
se aaya purana data (`source='historical'`) aur UI se bhari nayi slips
(`source='manual'`).  BD History aur Historical Data dono page yahin se
chalte hain.

Endpoints
---------
GET  /api/breakdowns/log            saari slips (zone / line / machine / date
                                    / dept / category / free-text filter)
GET  /api/breakdowns/log/master     zone -> line -> machine ka universe
                                    (dropdown isi se bharte hain)
GET  /api/breakdowns/log/stats      ginti + kul ghante
"""

from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Query

from database import get_conn, dict_cursor
from auth import get_current_user

router = APIRouter(prefix="/api/breakdowns", tags=["breakdowns"])


# maintenance_breakdown_data read straight, with the readable column aliases the readers
# below (and _bdlog_serialize) expect — zone_code, solve_time_min, bd_date, …
# now inlined as a subquery so every reader hits maintenance_breakdown_data DIRECTLY and
# no separate DB view object exists.  (Columns absent on the slip table — dept,
# nature_of_work, remarks, handover_to, src_row_no, line_id, zone_id — surface as
# NULL, exactly as the view did.)
_BD_SRC = """(
    SELECT
        id,
        'Manual Slip'::text                            AS source,
        NULL::int                                      AS src_row_no,
        zone                                           AS zone_code,
        line                                           AS line_code,
        machine_no,
        machine_name,
        COALESCE(slip_date, bd_start_date)             AS bd_date,
        shift,
        NULL::text                                     AS nature_of_work,
        problem_reported_by_production                 AS problem_production,
        problem_observed_by_maintenance                        AS problem_maintenance,
        action_taken_on_problem                        AS action_taken,
        bd_start_time,
        bd_received_time,
        response_time_minutes::text                    AS bd_response_time,
        bd_ok_time,
        mc_down_time_minutes::numeric                  AS solve_time_min,
        ROUND(mc_down_time_minutes::numeric / 60, 2)   AS solve_time_hours,
        spares_used                                    AS spares_detail,
        bd_attended_by                                 AS attended_by,
        NULL::text                                     AS dept,
        NULL::text                                     AS handover_to,
        category,
        frequency::text                                AS frequency,
        NULL::text                                     AS remarks,
        NULL::int                                      AS line_id,
        NULL::int                                      AS zone_id,
        submitted_at                                   AS created_at,
        model_no,
        line_leader_name,
        machine_operator_name,
        bd_start_date,
        bd_end_date,
        problem_related_to,
        NULLIF(TRIM(BOTH ', ' FROM CONCAT_WS(', ',
            CASE WHEN type_electrical THEN 'ELECTRICAL' END,
            CASE WHEN type_mechanical THEN 'MECHANICAL' END)), '') AS type_of_problem,
        prepared_by_name                               AS prepared_by,
        received_by_name                               AS received_by,
        line_leader_operator_name                      AS line_leader_operator,
        quality_engineer_name                          AS quality_engineer
      FROM maintenance_breakdown_data
) AS bd"""

_BDLOG_COLS = (
    "id, source, src_row_no, zone_code, line_code, machine_no, machine_name, "
    "bd_date, shift, nature_of_work, problem_production, problem_maintenance, "
    "action_taken, bd_start_time, bd_received_time, bd_response_time, bd_ok_time, "
    "solve_time_min, solve_time_hours, spares_detail, attended_by, dept, "
    "handover_to, category, frequency, remarks, "
    "model_no, line_leader_name, machine_operator_name, bd_start_date, bd_end_date, "
    "problem_related_to, type_of_problem, prepared_by, received_by, "
    "line_leader_operator, quality_engineer, created_at"
)


def _bdlog_serialize(r: dict) -> dict:
    """Serialize a master row AND add ticket-shaped compat aliases so the
    Maintenance-Historical page renders
    master rows unchanged: started_at/duration_seconds/state/line_name/zone_name
    + production_data/maintenance_data/closure_data (for the View-Slip modal)."""
    bd = r.get("bd_date")
    bd_iso = bd.isoformat() if bd else None
    r["bd_date"] = bd_iso
    if r.get("created_at"): r["created_at"] = r["created_at"].isoformat()
    smin = float(r["solve_time_min"])   if r.get("solve_time_min")   is not None else None
    shrs = float(r["solve_time_hours"]) if r.get("solve_time_hours") is not None else None
    r["solve_time_min"], r["solve_time_hours"] = smin, shrs
    dur = int(smin * 60) if smin is not None else (int(shrs * 3600) if shrs is not None else None)
    for _dk in ("bd_start_date", "bd_end_date"):
        if r.get(_dk) is not None and hasattr(r[_dk], "isoformat"):
            r[_dk] = r[_dk].isoformat()
    def _nm(v): return {"name": v or ""}
    _prt = (r.get("problem_related_to") or "").lower()
    _top = (r.get("type_of_problem") or r.get("dept") or "").lower()
    prod = {"machine_no": r.get("machine_no"), "machine_name": r.get("machine_name"),
            "zone": r.get("zone_code"), "line": r.get("line_code"), "shift": r.get("shift"),
            "category": r.get("category"), "date": bd_iso,
            "line_leader_name": r.get("line_leader_name"), "model_no": r.get("model_no"),
            "machine_operator_name": r.get("machine_operator_name"),
            "problem_reported_by_production": r.get("problem_production"),
            "bd_received_time": r.get("bd_received_time")}
    maint = {"problem_observed_by_maintenance": r.get("problem_maintenance"),
             "action_taken_on_problem": r.get("action_taken"),
             "spares_used": r.get("spares_detail"), "bd_attended_by": r.get("attended_by"),
             "problem_related_to": {"maintenance": "maint" in _prt, "tool_room": "tool" in _prt},
             "type_of_problem": {"electrical": "elec" in _top, "mechanical": "mech" in _top},
             "prepared_by": _nm(r.get("prepared_by")), "received_by": _nm(r.get("received_by")),
             "line_leader_operator": _nm(r.get("line_leader_operator")),
             "quality_engineer": _nm(r.get("quality_engineer"))}
    r.update({
        "started_at": bd_iso, "ended_at": bd_iso, "duration_seconds": dur,
        "state": "CLOSED", "line_id": r.get("line_code"), "line_name": r.get("line_code"),
        "zone_id": r.get("zone_code"), "zone_name": r.get("zone_code"),
        "shift_name": r.get("shift"), "serial_in_shift": None,
        "production_filled_at": bd_iso, "maintenance_filled_at": bd_iso,
        "reason": r.get("problem_production"),
        "production_data": prod, "maintenance_data": maint,
        "closure_data": {**prod, **maint, "mc_down_time_minutes": smin,
                         "bd_start_time": r.get("bd_start_time"), "bd_ok_time": r.get("bd_ok_time"),
                         "bd_start_date": r.get("bd_start_date"), "bd_end_date": r.get("bd_end_date"),
                         "line_area": r.get("zone_code")},
    })
    return r


def _bdlog_where(zone, line, machine, date_from, date_to, dept, category, q):
    where, params = ["1=1"], []
    if zone:      where.append("zone_code = %s");    params.append(zone)
    if line:      where.append("line_code = %s");    params.append(line)
    if machine:   where.append("machine_name = %s"); params.append(machine)
    if date_from: where.append("bd_date >= %s");     params.append(date_from)
    if date_to:   where.append("bd_date <= %s");     params.append(date_to)
    if dept:      where.append("dept = %s");         params.append(dept)
    if category:  where.append("category = %s");     params.append(category)
    if q:
        where.append("(machine_name ILIKE %s OR problem_production ILIKE %s "
                     "OR problem_maintenance ILIKE %s OR action_taken ILIKE %s "
                     "OR attended_by ILIKE %s OR line_code ILIKE %s)")
        params += [f"%{q}%"] * 6
    return " AND ".join(where), params


def _bdlog_window(days, date_from, from_date, date_to, to_date):
    """Resolve the date window from the union of param names (master ones +
    the ones the Maintenance-Historical page sends).
    NO 365-day cap (the page's 'Last 2 years' = 730d failed on the old /stats)."""
    df = date_from or from_date
    dt = date_to or to_date
    if not df and days:
        df = (datetime.now().date() - timedelta(days=int(days))).isoformat()
    return df, dt


@router.get("/log")
def list_breakdown_log(
    zone:      Optional[str] = Query(None),
    line:      Optional[str] = Query(None),
    machine:   Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to:   Optional[str] = Query(None),
    dept:      Optional[str] = Query(None),
    category:  Optional[str] = Query(None),
    q:         Optional[str] = Query(None),
    limit:     int = Query(3000),
    # compat params — the Maintenance-Historical page sends these:
    zone_id:    Optional[str] = Query(None),
    line_id:    Optional[str] = Query(None),
    machine_no: Optional[str] = Query(None),
    days:       Optional[int] = Query(None),
    from_date:  Optional[str] = Query(None),
    to_date:    Optional[str] = Query(None),
    state:      Optional[str] = Query(None),
    user=Depends(get_current_user),
):
    """Master breakdown log — all-lines or filtered.  Accepts BOTH the master
    param names (zone/line/machine/date_from/date_to) and the compat ones
    (zone_id/line_id/machine_no/days/from_date/to_date/state) the Maintenance
    Historical page uses, so both screens share this one endpoint."""
    if state and state.upper() in ("OPEN", "RESOLVED"):
        return {"rows": [], "total": 0, "total_hours": 0.0}   # master = all historical/closed
    z, ln, mc = (zone or zone_id), (line or line_id), (machine or machine_no)
    df, dt = _bdlog_window(days, date_from, from_date, date_to, to_date)
    wsql, params = _bdlog_where(z, ln, mc, df, dt, dept, category, q)
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute(f"SELECT {_BDLOG_COLS} FROM {_BD_SRC} WHERE {wsql} "
                    f"ORDER BY bd_date DESC NULLS LAST, id DESC LIMIT %s", params + [limit])
        rows = [_bdlog_serialize(r) for r in (cur.fetchall() or [])]
        cur.execute(f"SELECT COUNT(*) n, COALESCE(SUM(solve_time_hours),0) hrs "
                    f"FROM {_BD_SRC} WHERE {wsql}", params)
        agg = cur.fetchone()
    return {"rows": rows, "total": agg["n"], "total_hours": round(float(agg["hrs"]), 1)}


@router.get("/log/master")
def breakdown_log_master(user=Depends(get_current_user)):
    """Zone → line → machine universe + dept/category lists for dropdowns,
    derived from the master table itself."""
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute(f"SELECT DISTINCT zone_code, line_code, machine_name "
                    f"FROM {_BD_SRC} WHERE zone_code IS NOT NULL "
                    f"ORDER BY zone_code, line_code, machine_name")
        tree = {}
        for r in cur.fetchall() or []:
            z, ln, m = r["zone_code"], r["line_code"], r["machine_name"]
            tree.setdefault(z, {})
            if ln:
                tree[z].setdefault(ln, set())
                if m:
                    tree[z][ln].add(m)
        cur.execute(f"SELECT DISTINCT dept FROM {_BD_SRC} WHERE dept IS NOT NULL ORDER BY 1")
        depts = [r["dept"] for r in cur.fetchall()]
        cur.execute(f"SELECT DISTINCT category FROM {_BD_SRC} WHERE category IS NOT NULL ORDER BY 1")
        cats = [r["category"] for r in cur.fetchall()]
    zones = [{"zone": z,
              "lines": [{"line": ln, "machines": sorted(tree[z][ln])} for ln in sorted(tree[z])]}
             for z in sorted(tree)]
    return {"zones": zones, "depts": depts, "categories": cats}


# NOTE: the old POST /api/breakdowns/log (add_breakdown_log) has been REMOVED.
# Manual breakdowns are now raised via the Break Down Slip (→ maintenance_breakdown_data),
# and every reader (KPI / History / Analysis / CAPA) reads maintenance_breakdown_data
# DIRECTLY (via the _BD_SRC alias subquery above — no DB view).


@router.get("/log/stats")
def breakdown_log_stats(
    zone:      Optional[str] = Query(None),
    line:      Optional[str] = Query(None),
    machine:   Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to:   Optional[str] = Query(None),
    dept:      Optional[str] = Query(None),
    category:  Optional[str] = Query(None),
    q:         Optional[str] = Query(None),
    zone_id:    Optional[str] = Query(None),
    line_id:    Optional[str] = Query(None),
    machine_no: Optional[str] = Query(None),
    days:       Optional[int] = Query(None),
    from_date:  Optional[str] = Query(None),
    to_date:    Optional[str] = Query(None),
    state:      Optional[str] = Query(None),
    user=Depends(get_current_user),
):
    """Zone/line/machine MTBF·MTTR·LTTR roll-up from the MASTER table — same
    response shape as /stats so the Maintenance-Historical roll-up renders
    unchanged.  MTTR=avg solve, LTTR=max solve, MTBF=span/(n-1).  No day cap."""
    if state and state.upper() in ("OPEN", "RESOLVED"):
        return {"zones": [], "lines": [], "machines": []}
    z, ln, mc = (zone or zone_id), (line or line_id), (machine or machine_no)
    df, dt = _bdlog_window(days, date_from, from_date, date_to, to_date)
    wsql, params = _bdlog_where(z, ln, mc, df, dt, dept, category, q)
    MTBF = ("CASE WHEN COUNT(*)>1 THEN (MAX(bd_date)-MIN(bd_date))::numeric*24/(COUNT(*)-1) "
            "ELSE NULL END")
    def _fl(rows):
        for r in rows:
            for k in ("mttr_minutes", "lttr_minutes", "mtbf_hours"):
                if r.get(k) is not None:
                    r[k] = float(r[k])
        return rows
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute(f"""SELECT zone_code AS zone_name, zone_code AS zone_id,
                          COUNT(*) AS breakdowns_count, AVG(solve_time_min) AS mttr_minutes,
                          MAX(solve_time_min) AS lttr_minutes, {MTBF} AS mtbf_hours
                        FROM {_BD_SRC} WHERE {wsql} AND zone_code IS NOT NULL
                        GROUP BY zone_code ORDER BY breakdowns_count DESC""", params)
        zones = _fl(cur.fetchall() or [])
        cur.execute(f"""SELECT line_code AS line_name, line_code AS line_id,
                          zone_code AS zone_name, COUNT(*) AS breakdowns_count,
                          AVG(solve_time_min) AS mttr_minutes, MAX(solve_time_min) AS lttr_minutes,
                          {MTBF} AS mtbf_hours
                        FROM {_BD_SRC} WHERE {wsql} AND line_code IS NOT NULL
                        GROUP BY line_code, zone_code ORDER BY breakdowns_count DESC""", params)
        lines = _fl(cur.fetchall() or [])
        cur.execute(f"""SELECT COALESCE(machine_no, machine_name) AS machine_no,
                          machine_name, line_code AS line_name, line_code AS line_id,
                          zone_code AS zone_name, COUNT(*) AS breakdowns_count,
                          AVG(solve_time_min) AS mttr_minutes, MAX(solve_time_min) AS lttr_minutes,
                          {MTBF} AS mtbf_hours
                        FROM {_BD_SRC} WHERE {wsql} AND machine_name IS NOT NULL
                        GROUP BY machine_name, machine_no, line_code, zone_code
                        ORDER BY breakdowns_count DESC""", params)
        machines = _fl(cur.fetchall() or [])
    return {"zones": zones, "lines": lines, "machines": machines}


