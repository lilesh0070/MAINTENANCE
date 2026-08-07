"""
routers/deviations.py — Online Deviation Form.

Jab Maintenance kisi fault ko 24 ghante me theek nahi kar paati to Deviation
uthti hai.  Maintenance upar ka aadha bharti hai (Non-Conformance / Root Cause
/ Containment + Permanent CA), Quality Sec Head approve ya reject karta hai,
aur QA Head date/qty ka extension de sakta hai.  Kagaz wale Deviation Form ka
hu-ba-hu roop.

Frontend: `/maintenance-deviations` (sidebar me "Deviations")
Table   : `maintenance_deviations`
URL     : `/api/quality/deviations` (purana prefix, taaki frontend na badle)
"""
from datetime import date, datetime, timedelta
from typing  import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form
from fastapi.responses import Response
from pydantic import BaseModel
from psycopg2.extras import Json
from database import get_conn, dict_cursor
from auth     import get_current_user, require_admin

router = APIRouter(prefix="/api/quality", tags=["deviations"])


class DeviationCreate(BaseModel):
    breakdown_id:        Optional[int] = None
    line_id:             Optional[int] = None
    line_name:           Optional[str] = None
    zone_id:             Optional[int] = None
    zone_name:           Optional[str] = None
    machine_no:          Optional[str] = None
    machine_name:        Optional[str] = None
    category:            Optional[str] = None
    process_name:        Optional[str] = None
    process_no:          Optional[str] = None
    srv_no:              Optional[str] = None
    deviation_qty:       Optional[int] = None
    deviation_upto_qty:  Optional[int] = None
    deviation_upto_date: Optional[str] = None  # ISO date
    initiated_by:        Optional[str] = None
    reason:              Optional[str] = None
    requirement:         Optional[str] = None
    observation:         Optional[str] = None
    root_cause_occurrence: Optional[str] = None
    root_cause_detection:  Optional[str] = None
    potential_consequences: Optional[str] = None
    hod_production:      Optional[str] = None
    hod_production_note: Optional[str] = None
    containment_actions: Optional[List[Dict[str, Any]]] = None
    permanent_actions:   Optional[List[Dict[str, Any]]] = None


class DeviationUpdate(DeviationCreate):
    pass


class DeviationApprove(BaseModel):
    hod_quality:      Optional[str] = None
    hod_quality_note: Optional[str] = None


class DeviationReject(BaseModel):
    hod_quality:      Optional[str] = None
    rejection_reason: str


class DeviationExtension(BaseModel):
    from_qty_date:  Optional[str] = None
    to_qty_date:    Optional[str] = None
    reason:         Optional[str] = None
    hod_concerned:  Optional[str] = None
    sign:           Optional[str] = None
    hod_quality:    Optional[str] = None
    hod_operation:  Optional[str] = None
    decision:       Optional[str] = None  # APPROVED / REJECTED


class DeviationClose(BaseModel):
    closure_remarks:     Optional[str] = None
    hod_concerned_close: Optional[str] = None
    hod_quality_close:   Optional[str] = None


def _dev_dict(r) -> dict:
    return dict(r) if r else None


@router.get("/deviations")
def list_deviations(days: int = Query(60, ge=1, le=730),
                    status: Optional[str] = Query(None),
                    line_id: Optional[int] = Query(None),
                    user=Depends(get_current_user)):
    cutoff = datetime.utcnow() - timedelta(days=days)
    where = ["d.created_at >= %s"]
    params: list = [cutoff]
    if status:
        where.append("d.status = %s"); params.append(status.upper())
    if line_id is not None:
        where.append("d.line_id = %s"); params.append(line_id)
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute(f"""
            SELECT d.*, ru.username AS raised_by_username,
                   au.username AS approved_by_username
              FROM maintenance_deviations d
              LEFT JOIN maintenance_users ru ON ru.id = d.raised_by_user_id
              LEFT JOIN maintenance_users au ON au.id = d.approved_by_user_id
             WHERE {' AND '.join(where)}
             ORDER BY d.created_at DESC
             LIMIT 500
        """, params)
        return [dict(r) for r in cur.fetchall()]


@router.get("/deviations/{did}")
def get_deviation(did: int, user=Depends(get_current_user)):
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("""
            SELECT d.*, ru.username AS raised_by_username,
                   au.username AS approved_by_username
              FROM maintenance_deviations d
              LEFT JOIN maintenance_users ru ON ru.id = d.raised_by_user_id
              LEFT JOIN maintenance_users au ON au.id = d.approved_by_user_id
             WHERE d.id = %s
        """, (did,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Deviation not found")
        return dict(row)


@router.post("/deviations", status_code=201)
def create_deviation(body: DeviationCreate, user=Depends(get_current_user)):
    """Maintenance raises a new deviation against a breakdown.  Auto-
    generates dev_no = DEV-YYYY-NNNN (year-scoped sequence)."""
    with get_conn() as conn:
        cur = dict_cursor(conn)
        dev_no = _next_seq_no("DEV", "maintenance_deviations", "dev_no", conn)
        cur.execute("""
            INSERT INTO maintenance_deviations
                (dev_no, breakdown_id, line_id, line_name, zone_id, zone_name,
                 machine_no, machine_name, category, process_name, process_no,
                 srv_no, deviation_qty, deviation_upto_qty, deviation_upto_date,
                 initiated_by, initiated_at, reason, requirement, observation,
                 root_cause_occurrence, root_cause_detection, potential_consequences,
                 hod_production, hod_production_note,
                 containment_actions, permanent_actions, raised_by_user_id, status)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                    NOW(), %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'PENDING_QA')
            RETURNING *
        """, (
            dev_no, body.breakdown_id, body.line_id, body.line_name,
            body.zone_id, body.zone_name, body.machine_no, body.machine_name,
            body.category, body.process_name, body.process_no, body.srv_no,
            body.deviation_qty, body.deviation_upto_qty, body.deviation_upto_date,
            body.initiated_by or user.get("username"),
            body.reason, body.requirement, body.observation,
            body.root_cause_occurrence, body.root_cause_detection,
            body.potential_consequences,
            body.hod_production, body.hod_production_note,
            Json(body.containment_actions or []),
            Json(body.permanent_actions or []),
            user["id"],
        ))
        row = cur.fetchone()
        conn.commit()
    return dict(row)


@router.put("/deviations/{did}")
def update_deviation(did: int, body: DeviationUpdate,
                     user=Depends(get_current_user)):
    """Edit a deviation while it's still PENDING_QA — once approved /
    rejected / closed, edits are blocked."""
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT status FROM maintenance_deviations WHERE id = %s", (did,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Deviation not found")
        if row["status"] != "PENDING_QA":
            raise HTTPException(409, "Deviation is locked — only PENDING_QA edits allowed")

        # Sparse update — only fields the caller sent.
        fields, params = [], []
        body_dict = body.model_dump(exclude_none=True)
        for k, v in body_dict.items():
            if k in ("containment_actions", "permanent_actions"):
                fields.append(f"{k} = %s"); params.append(Json(v))
            else:
                fields.append(f"{k} = %s"); params.append(v)
        if not fields:
            return {"ok": True, "noop": True}
        fields.append("updated_at = NOW()")
        params.append(did)
        cur.execute(
            f"UPDATE maintenance_deviations SET {', '.join(fields)} WHERE id = %s "
            f"RETURNING *", params,
        )
        out = cur.fetchone()
        conn.commit()
    return dict(out)


@router.post("/deviations/{did}/approve")
def approve_deviation(did: int, body: DeviationApprove,
                      user=Depends(get_current_user)):
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("""
            UPDATE maintenance_deviations
               SET status = 'APPROVED', approved_at = NOW(),
                   approved_by_user_id = %s,
                   hod_quality = COALESCE(%s, hod_quality),
                   hod_quality_note = COALESCE(%s, hod_quality_note),
                   updated_at = NOW()
             WHERE id = %s AND status = 'PENDING_QA'
            RETURNING *
        """, (user["id"], body.hod_quality, body.hod_quality_note, did))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Deviation not pending or not found")
        conn.commit()
    return dict(row)


@router.post("/deviations/{did}/reject")
def reject_deviation(did: int, body: DeviationReject,
                     user=Depends(get_current_user)):
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("""
            UPDATE maintenance_deviations
               SET status = 'REJECTED', approved_at = NOW(),
                   approved_by_user_id = %s,
                   hod_quality = COALESCE(%s, hod_quality),
                   hod_quality_note = %s,
                   updated_at = NOW()
             WHERE id = %s AND status = 'PENDING_QA'
            RETURNING *
        """, (user["id"], body.hod_quality, body.rejection_reason, did))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Deviation not pending or not found")
        conn.commit()
    return dict(row)


@router.post("/deviations/{did}/extend")
def extend_deviation(did: int, body: DeviationExtension,
                     user=Depends(get_current_user)):
    """QA Head appends a new extension row to the deviation's extensions
    JSONB array.  Sets status to EXTENDED if currently APPROVED."""
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT extensions, status FROM maintenance_deviations WHERE id = %s", (did,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Deviation not found")
        ext_list = row["extensions"] or []
        ext_list.append({**body.model_dump(exclude_none=True),
                         "added_by": user.get("username"),
                         "added_at": datetime.utcnow().isoformat()})
        new_status = "EXTENDED" if row["status"] in ("APPROVED", "EXTENDED") else row["status"]
        cur.execute("""
            UPDATE maintenance_deviations
               SET extensions = %s, status = %s, updated_at = NOW()
             WHERE id = %s
            RETURNING *
        """, (Json(ext_list), new_status, did))
        out = cur.fetchone()
        conn.commit()
    return dict(out)


@router.post("/deviations/{did}/close")
def close_deviation(did: int, body: DeviationClose,
                    user=Depends(get_current_user)):
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("""
            UPDATE maintenance_deviations
               SET status = 'CLOSED', closed_at = NOW(),
                   closure_remarks = COALESCE(%s, closure_remarks),
                   hod_concerned_close = COALESCE(%s, hod_concerned_close),
                   hod_quality_close   = COALESCE(%s, hod_quality_close),
                   updated_at = NOW()
             WHERE id = %s AND status IN ('APPROVED', 'EXTENDED')
            RETURNING *
        """, (body.closure_remarks, body.hod_concerned_close,
              body.hod_quality_close, did))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Only APPROVED or EXTENDED deviations can be closed")
        conn.commit()
    return dict(row)
