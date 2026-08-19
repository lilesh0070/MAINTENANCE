"""
routers/breakdown_slips.py
==========================
Standalone storage for the MANUAL "Break Down Slip" (raised from the sidebar

  • Every slip field is stored as its own flat column in `maintenance_breakdown_data`.

DO ALAG TABLES (kabhi mix nahi hote)
------------------------------------
  maintenance_breakdown_data       MANUAL slip — sirf yahan se aati hai (POST below)
  maintenance_auto_breakdown_slip  AUTO slip — ANDON ke Maintenance call band hote hi
                           banti hai (andon.py → _auto_slip_from_call).
                           Structure dono ka bilkul same.

AUTO ka data `maintenance_breakdown_data` me KABHI nahi jaata — `_insert_flat()` ka
`table` argument ye pakka karta hai.

Endpoint
--------
POST /api/breakdown-slips/            → insert one filled MANUAL slip → {id}
GET  /api/breakdown-slips/            → MANUAL slips (newest first)
GET  /api/breakdown-slips/auto/{id}   → ek AUTO slip, form ke `ticket` shape me
POST /api/breakdown-slips/auto/{id}/fill → maintenance ne form bhara → USI row
                                        me update (nayi row nahi banti)
"""
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from database import get_conn, dict_cursor
from auth import get_current_user, require_admin

router = APIRouter(prefix="/api/breakdown-slips", tags=["breakdown-slips"])

# ── Do ALAG tables — kabhi mix nahi hote ──────────────────────────────────
#   maintenance_breakdown_data       : MANUAL slip (sidebar → Breakdown Slip)
#   maintenance_auto_breakdown_slip  : AUTO slip (breakdown close par mirror)
# Structure dono ka bilkul same hai, bas source alag hai — isse manual aur
# auto ka data kabhi aapas me nahi milta.
MANUAL_SLIP_TABLE   = "maintenance_breakdown_data"
AUTO_SLIP_TABLE     = "maintenance_auto_breakdown_slip"
# TOOL ROOM ka apna alag table — bilkul auto-slip jaisa hi dhaancha, par data
# kabhi maintenance ke saath nahi milta.  ANDON ka Toolroom call yahan aata hai,
# Maintenance call AUTO_SLIP_TABLE me.  Main dashboard sirf AUTO_SLIP_TABLE
# padhta hai, isliye tool room ki slip wahan kabhi nahi dikhti.
TOOLROOM_SLIP_TABLE = "toolroom_auto_breakdown_slip"
_ALLOWED_SLIP_TABLES = {MANUAL_SLIP_TABLE, AUTO_SLIP_TABLE, TOOLROOM_SLIP_TABLE}

# API me source ka naam -> asli table
SRC_TABLES = {"maintenance": AUTO_SLIP_TABLE, "toolroom": TOOLROOM_SLIP_TABLE}


def _src_table(src: str) -> str:
    """'maintenance' / 'toolroom' -> table name (galat naam par 400)."""
    t = SRC_TABLES.get((src or "maintenance").strip().lower())
    if not t:
        raise HTTPException(400, "src must be 'maintenance' or 'toolroom'")
    return t

_ensured = False


def _ensure_table():
    """Create maintenance_breakdown_data once (idempotent).  Called lazily on first use
    so the app still boots when the DB is down."""
    global _ensured
    if _ensured:
        return
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS maintenance_breakdown_data (
                id                             SERIAL PRIMARY KEY,
                -- Upper half (Production)
                zone                           VARCHAR(60),
                line                           VARCHAR(60),
                machine_no                     VARCHAR(60),
                machine_name                   VARCHAR(160),
                slip_date                      DATE,
                shift                          VARCHAR(20),
                line_leader_name               VARCHAR(120),
                model_no                       VARCHAR(60),
                machine_operator_name          VARCHAR(120),
                category                       VARCHAR(40),
                bd_start_time                  VARCHAR(5),
                bd_received_time               VARCHAR(5),
                bd_ok_time                     VARCHAR(5),
                bd_start_date                  DATE,
                bd_end_date                    DATE,
                mc_down_time_minutes           INTEGER,
                problem_reported_by_production TEXT,
                -- Lower half (Maintenance / Tool Room)
                problem_related_to             VARCHAR(20),
                type_electrical                BOOLEAN DEFAULT FALSE,
                type_mechanical                BOOLEAN DEFAULT FALSE,
                problem_observed_by_maintenance        TEXT,
                action_taken_on_problem        TEXT,
                spares_used                    TEXT,
                bd_attended_by                 VARCHAR(160),
                prepared_by_name               VARCHAR(120),
                received_by_name               VARCHAR(120),
                line_leader_operator_name      VARCHAR(120),
                quality_engineer_name          VARCHAR(120),
                -- audit
                submitted_by_user_id           INTEGER,
                submitted_at                   TIMESTAMP DEFAULT NOW()
            )
        """)
        # 2026-07-28: actual_problem_observed renamed to
        # problem_observed_by_maintenance (to match the Log Book).  Guarded so
        # it runs once on an existing table; fresh tables already use the new
        # name (see CREATE above).
        cur.execute("""
            DO $$
            BEGIN
              IF EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_name='maintenance_breakdown_data'
                            AND column_name='actual_problem_observed')
                 AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_name='maintenance_breakdown_data'
                            AND column_name='problem_observed_by_maintenance')
              THEN
                ALTER TABLE maintenance_breakdown_data
                  RENAME COLUMN actual_problem_observed TO problem_observed_by_maintenance;
              END IF;
            END $$;
        """)
        # Legacy category values are descriptive ('Mechanical', 'PLC / Software'),
        # not just 'A'/'B'/'C' — widen an existing VARCHAR(1) column if present.
        cur.execute("ALTER TABLE maintenance_breakdown_data ALTER COLUMN category TYPE VARCHAR(40)")
        # Repeatable Spare Details — full list stored as JSONB.  `spares_used`
        # (above) stays as a one-line text summary for the flat/legacy readers.
        cur.execute("ALTER TABLE maintenance_breakdown_data ADD COLUMN IF NOT EXISTS spares JSONB")
        # Response time (Start→Received) + breakdown frequency (default 1).
        cur.execute("ALTER TABLE maintenance_breakdown_data ADD COLUMN IF NOT EXISTS response_time_minutes INTEGER")
        cur.execute("ALTER TABLE maintenance_breakdown_data ADD COLUMN IF NOT EXISTS frequency INTEGER DEFAULT 1")

        # ── AUTO slip ki ALAG tables ──────────────────────────────────────
        # `maintenance_auto_breakdown_slip` (Maintenance call) aur
        # `toolroom_auto_breakdown_slip` (Toolroom call) — dono bilkul
        # maintenance_breakdown_data jaisi hi, par sirf AUTO (ANDON se bani)
        # slips rakhti hain.  MANUAL slip hamesha maintenance_breakdown_data me
        # hi jaati hai — teeno ka data kabhi aapas me nahi milta.
        for _T in (AUTO_SLIP_TABLE, TOOLROOM_SLIP_TABLE):
            _ensure_auto_table(cur, _T)

        conn.commit()
    _ensured = True


def _ensure_auto_table(cur, tbl: str):
    """Ek AUTO-slip table banao / upgrade karo (maintenance ya tool room —
    dono ka dhaancha bilkul same hai).  Idempotent."""
    AUTO_SLIP_TABLE = tbl          # neeche ka poora block isi table par chalta hai
    if True:
        # LIKE ... se structure hu-ba-hu copy hota hai, isliye upar ke saare
        # columns/ALTER apne aap is table me bhi aa jaate hain.
        cur.execute(f"""
            CREATE TABLE IF NOT EXISTS {AUTO_SLIP_TABLE}
                (LIKE maintenance_breakdown_data INCLUDING DEFAULTS INCLUDING CONSTRAINTS)
        """)
        # `LIKE ... INCLUDING DEFAULTS` id ka default bhi copy karta hai, jo
        # maintenance_breakdown_data ke SEQUENCE ko point karta hai. Usse hata kar is
        # table ko apna sequence do, warna dono ek hi counter share karengi.
        cur.execute(f"CREATE SEQUENCE IF NOT EXISTS {AUTO_SLIP_TABLE}_id_seq OWNED BY {AUTO_SLIP_TABLE}.id")
        cur.execute(f"ALTER TABLE {AUTO_SLIP_TABLE} ALTER COLUMN id SET DEFAULT nextval('{AUTO_SLIP_TABLE}_id_seq')")
        # Sequence ko hamesha MAX(id) ke AAGE rakho.  Warna (DB restore, purane
        # rows, ya explicit-id insert ke baad) sequence peeche reh jaati hai aur
        # har naya INSERT "duplicate key" se fail hota — aur ANDON ke slip-paths
        # exception ko sirf log karte hain, to slip banna CHUP-CHAAP band ho
        # jaata.  Idempotent: har boot par safe.
        cur.execute(f"""SELECT setval('{AUTO_SLIP_TABLE}_id_seq',
                          GREATEST((SELECT COALESCE(MAX(id), 0) FROM {AUTO_SLIP_TABLE}),
                                   (SELECT last_value FROM {AUTO_SLIP_TABLE}_id_seq)), true)""")
        cur.execute(f"""
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_constraint
                                WHERE conrelid = '{AUTO_SLIP_TABLE}'::regclass
                                  AND contype = 'p')
                THEN
                    ALTER TABLE {AUTO_SLIP_TABLE} ADD PRIMARY KEY (id);
                END IF;
            END $$;
        """)
        # Purani auto-table (jo LIKE se pehle bani ho) me naye columns aa jaayen
        for _c in ("spares JSONB",
                   "response_time_minutes INTEGER",
                   "frequency INTEGER DEFAULT 1"):
            cur.execute(f"ALTER TABLE {AUTO_SLIP_TABLE} ADD COLUMN IF NOT EXISTS {_c}")

        # ── AUTO slip ↔ ANDON call ka link ────────────────────────────────
        # Slip ab call ke ACKNOWLEDGE hote hi ban jaati hai, aur call band hone
        # par USI row me OK-time/down-time bhar jaate hain.  Isliye ek pakka
        # link chahiye.  `andon_event_id` = us waqt ke live call (andon_system)
        # ka id — call ke poore jeevan me nahi badalta.
        #   UNIQUE index => ek call ki EK hi slip.  ESP event dobara bheje
        #   (resend), ya ACK do baar dabe, ya close ke saath race ho — duplicate
        #   slip kabhi nahi banegi.
        # `power_cut` = call button se band nahi hua, bijli/reboot se band hua —
        #   uske OK-time bharose ke laayak nahi, isliye nishaan.
        cur.execute(f"ALTER TABLE {AUTO_SLIP_TABLE} ADD COLUMN IF NOT EXISTS andon_event_id INTEGER")
        cur.execute(f"ALTER TABLE {AUTO_SLIP_TABLE} ADD COLUMN IF NOT EXISTS power_cut BOOLEAN DEFAULT FALSE")
        cur.execute(f"""CREATE UNIQUE INDEX IF NOT EXISTS {AUTO_SLIP_TABLE}_call_uq
                          ON {AUTO_SLIP_TABLE} (andon_event_id)
                        WHERE andon_event_id IS NOT NULL""")

        # ── 2-STAGE (Production → Maintenance) flow ────────────────────────
        # prod_stage: ANDON slip banaye  → 'PENDING_PRODUCTION'
        #             Production half submit → 'PENDING_MAINTENANCE'  (tab hi
        #                                       MAIN DASHBOARD pe maintenance ko dikhe)
        #             Maintenance complete → 'COMPLETED'
        cur.execute("""SELECT 1 FROM information_schema.columns
                        WHERE table_name=%s AND column_name='prod_stage'
                          AND table_schema = current_schema()""", (AUTO_SLIP_TABLE,))
        if not cur.fetchone():
            cur.execute(f"ALTER TABLE {AUTO_SLIP_TABLE} ADD COLUMN prod_stage VARCHAR(20)")
            # Ye feature se PEHLE bani saari slips maintenance-ready thi — unhe
            # PENDING_MAINTENANCE karo taaki dashboard se gayab na ho jaayein.
            cur.execute(f"UPDATE {AUTO_SLIP_TABLE} SET prod_stage='PENDING_MAINTENANCE' WHERE prod_stage IS NULL")
        # Aage se har NAYI ANDON slip PENDING_PRODUCTION se shuru hogi.  Ye
        # JAAN-BUJH KE `if` ke BAAHAR hai (idempotent) — agar kabhi column to ban
        # jaye par DEFAULT set na ho, to har nayi slip prod_stage=NULL bharti,
        # aur NULL ko gate "dikhao" maanta hai → poora production-gate chup-chaap
        # band pad jaata.
        cur.execute(f"ALTER TABLE {AUTO_SLIP_TABLE} ALTER COLUMN prod_stage SET DEFAULT 'PENDING_PRODUCTION'")
        cur.execute(f"ALTER TABLE {AUTO_SLIP_TABLE} ADD COLUMN IF NOT EXISTS production_by_user_id INTEGER")
        cur.execute(f"ALTER TABLE {AUTO_SLIP_TABLE} ADD COLUMN IF NOT EXISTS production_at TIMESTAMP")
        cur.execute(f"""CREATE INDEX IF NOT EXISTS {AUTO_SLIP_TABLE}_stage_idx
                          ON {AUTO_SLIP_TABLE} (prod_stage)""")


class BreakdownSlipIn(BaseModel):
    # `model_no` would otherwise trip Pydantic v2's protected "model_" namespace.
    model_config = {"protected_namespaces": ()}
    # Upper half
    zone: Optional[str] = None
    line: Optional[str] = None
    machine_no: Optional[str] = None
    machine_name: Optional[str] = None
    slip_date: Optional[str] = None
    shift: Optional[str] = None
    line_leader_name: Optional[str] = None
    model_no: Optional[str] = None
    machine_operator_name: Optional[str] = None
    category: Optional[str] = None
    bd_start_time: Optional[str] = None
    bd_received_time: Optional[str] = None
    bd_ok_time: Optional[str] = None
    bd_start_date: Optional[str] = None
    bd_end_date: Optional[str] = None
    mc_down_time_minutes: Optional[int] = None
    response_time_minutes: Optional[int] = None    # auto: Start → Received
    frequency: Optional[int] = 1                    # breakdown frequency, default 1
    problem_reported_by_production: Optional[str] = None
    # Lower half
    problem_related_to: Optional[str] = None            # 'maintenance' | 'tool_room'
    type_electrical: bool = False
    type_mechanical: bool = False
    problem_observed_by_maintenance: Optional[str] = None
    action_taken_on_problem: Optional[str] = None
    spares_used: Optional[str] = None
    bd_attended_by: Optional[str] = None
    prepared_by_name: Optional[str] = None
    received_by_name: Optional[str] = None
    line_leader_operator_name: Optional[str] = None
    quality_engineer_name: Optional[str] = None
    # repeatable Spare Details: [{spare_name, spare_model_no, spare_cnmm_no, spare_qty}, …]
    spares: Optional[List[dict]] = None


# Columns written on insert, in order (excludes id / submitted_at defaults).
_COLS = [
    "zone", "line", "machine_no", "machine_name", "slip_date", "shift",
    "line_leader_name", "model_no", "machine_operator_name", "category",
    "bd_start_time", "bd_received_time", "bd_ok_time", "bd_start_date",
    "bd_end_date", "mc_down_time_minutes", "response_time_minutes", "frequency",
    "problem_reported_by_production",
    "problem_related_to", "type_electrical", "type_mechanical",
    "problem_observed_by_maintenance", "action_taken_on_problem", "spares_used",
    "bd_attended_by", "prepared_by_name", "received_by_name",
    "line_leader_operator_name", "quality_engineer_name",
]


def _blank_to_none(v):
    """Empty strings → NULL so DATE/text columns stay clean."""
    if isinstance(v, str) and v.strip() == "":
        return None
    return v


def _to_int(v):
    """Coerce a possibly-string / blank down-time value to int or None."""
    if v is None or (isinstance(v, str) and v.strip() == ""):
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _insert_flat(conn, flat: dict, user_id, table: str = MANUAL_SLIP_TABLE):
    """INSERT one flat row into the given slip table; returns the new id.
    The flat columns go in as-is; `spares` (a list) is stored as JSONB.

    `table` default MANUAL hai — manual slip ka raasta bilkul pehle jaisa.
    AUTO mirror `AUTO_SLIP_TABLE` pass karta hai, isliye auto ka data kabhi
    maintenance_breakdown_data me nahi jaata."""
    if table not in _ALLOWED_SLIP_TABLES:          # sirf ye do naam allowed
        raise ValueError(f"unknown slip table: {table}")
    from psycopg2.extras import Json
    # drop completely-blank spare rows so an unused "Add" never persists
    spares = [s for s in (flat.get("spares") or [])
              if isinstance(s, dict) and any(str(v or "").strip() for v in s.values())]
    vals = [_blank_to_none(flat.get(c)) for c in _COLS]
    vals.append(Json(spares) if spares else None)
    vals.append(user_id)
    cols_sql = ", ".join(_COLS + ["spares", "submitted_by_user_id"])
    ph = ", ".join(["%s"] * (len(_COLS) + 2))
    cur = conn.cursor()
    cur.execute(
        f"INSERT INTO {table} ({cols_sql}) VALUES ({ph}) RETURNING id", vals,
    )
    return cur.fetchone()[0]


def mirror_from_halves(conn, prod: dict, maint: dict, user_id,
                       started_at=None, ended_at=None):
    """Flatten a CLOSED breakdown's production + maintenance halves into a
    standalone AUTO-slip row.  Called from the breakdown close flow — a one-way
    copy of the filled slip.

    *** Ye row `maintenance_auto_breakdown_slip` me jaati hai, `maintenance_breakdown_data` me
    KABHI NAHI.  Manual slip aur auto slip alag-alag tables me rehte hain,
    chahe auto-mirror on ho ya off. ***

    started_at / ended_at (the collector-stamped timestamps) are used only as a
    FALLBACK to fill down-time minutes + the slip dates when the slip itself
    didn't carry them — so KPI aggregates stay accurate."""
    _ensure_table()
    flat = _halves_to_flat(prod, maint)
    # Fallbacks from the collector timestamps so KPI (down-time, date) stays
    # accurate even when the slip fields were left blank.
    if flat["mc_down_time_minutes"] is None and started_at and ended_at:
        flat["mc_down_time_minutes"] = max(int(round((ended_at - started_at).total_seconds() / 60)), 0)
    if not flat["bd_start_date"] and started_at:
        flat["bd_start_date"] = started_at.date()
    if not flat["slip_date"] and started_at:
        flat["slip_date"] = started_at.date()
    if not flat["bd_end_date"] and ended_at:
        flat["bd_end_date"] = ended_at.date()
    # AUTO slip -> ALAG table (maintenance_breakdown_data ko haath nahi lagta)
    return _insert_flat(conn, flat, user_id, table=AUTO_SLIP_TABLE)


def _halves_to_flat(prod: dict, maint: dict) -> dict:
    """Form ke do halves (production + maintenance) → slip ke flat columns.

    Ek hi jagah rakha hai taaki AUTO slip banate waqt aur baad me use FILL
    karte waqt bilkul same mapping chale — do jagah alag logic na ho jaye."""
    prod = prod or {}
    maint = maint or {}
    prt = maint.get("problem_related_to") or {}
    top = maint.get("type_of_problem") or {}
    return {
        "zone": prod.get("zone"), "line": prod.get("line"),
        # Machine dono halves me hoti hai (form ke MAINT_FIELDS me bhi).  Sirf
        # `prod` se lete the, to maintenance-only fill par ye NULL ho jaati thi
        # aur ANDON ki bhari hui machine mit jaati thi.  Ab jis half me mile
        # wahi le lo.
        "machine_no":   prod.get("machine_no")   or maint.get("machine_no"),
        "machine_name": prod.get("machine_name") or maint.get("machine_name"),
        "slip_date": prod.get("date"), "shift": prod.get("shift"),
        "line_leader_name": prod.get("line_leader_name"), "model_no": prod.get("model_no"),
        "machine_operator_name": prod.get("machine_operator_name"),
        "category": prod.get("category"),
        "bd_start_time": prod.get("bd_start_time"),
        "bd_received_time": prod.get("bd_received_time"),
        "bd_ok_time": prod.get("bd_ok_time"),
        "bd_start_date": prod.get("bd_start_date"),
        "bd_end_date": prod.get("bd_end_date"),
        "mc_down_time_minutes": _to_int(prod.get("mc_down_time_minutes")),
        "response_time_minutes": _to_int(prod.get("response_time_minutes")),
        "frequency": _to_int(prod.get("frequency")) or 1,
        "problem_reported_by_production": prod.get("problem_reported_by_production"),
        "problem_related_to": "maintenance" if prt.get("maintenance")
                              else ("tool_room" if prt.get("tool_room") else None),
        "type_electrical": bool(top.get("electrical")),
        "type_mechanical": bool(top.get("mechanical")),
        "problem_observed_by_maintenance": maint.get("problem_observed_by_maintenance"),
        "action_taken_on_problem": maint.get("action_taken_on_problem"),
        "spares_used": maint.get("spares_used"),
        "bd_attended_by": maint.get("bd_attended_by"),
        "spares": maint.get("spares"),          # repeatable Spare Details (JSONB)
        "prepared_by_name": (maint.get("prepared_by") or {}).get("name"),
        "received_by_name": (maint.get("received_by") or {}).get("name"),
        "line_leader_operator_name": (maint.get("line_leader_operator") or {}).get("name"),
        "quality_engineer_name": (maint.get("quality_engineer") or {}).get("name"),
    }


@router.post("/", status_code=201)
def create_slip(body: BreakdownSlipIn, user=Depends(get_current_user)):
    """Insert one filled (manual) Break Down Slip into maintenance_breakdown_data."""
    _ensure_table()
    with get_conn() as conn:
        new_id = _insert_flat(conn, body.model_dump(), user["id"])
        conn.commit()
    # Record this slip's spares into maintenance_spare (own txn, best-effort).
    try:
        from routers.maintenance_spare import record_usage
        with get_conn() as sconn:
            record_usage(sconn, "Manual Slip", {
                "zone": body.zone, "line": body.line,
                "machine_no": body.machine_no, "machine_name": body.machine_name,
                "used_date": body.slip_date or body.bd_start_date,
            }, body.spares)
    except Exception as e:
        print(f"[SPARE-MASTER] record failed (slip): {e}")
    return {"id": new_id, "ok": True}


@router.get("/")
def list_slips(user=Depends(get_current_user)) -> List[dict]:
    """Newest-first list of filled slips (simple register view)."""
    _ensure_table()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT * FROM maintenance_breakdown_data ORDER BY id DESC LIMIT 1000")
        return cur.fetchall()


# ════════════════════════════════════════════════════════════════════════
#  AUTO slip (ANDON se bani) — padhna + bharna
# ════════════════════════════════════════════════════════════════════════
#  Dashboard ke zone-wise "Breakdown Slips" list me ab yehi slips aati hain.
#  ANDON sirf time/machine wala hissa bharta hai; problem / action / spares
#  maintenance yahan se bharta hai.  Sab kuch USI row me update hota hai —
#  koi nayi row nahi banti, aur MANUAL table ko kabhi haath nahi lagta.

def _slip_to_ticket(r: dict) -> dict:
    """Slip row → wahi shape jo ClosureFormModal `ticket` me expect karta hai.
    Mapping `_halves_to_flat()` ka ULTA hai, isliye jo bhara tha wahi wapas
    form me dikhta hai."""
    from datetime import datetime as _dt

    def _stamp(d, t):
        """DATE + 'HH:MM' → ISO timestamp (form inhe todkar dikhata hai)."""
        if not d:
            return None
        try:
            hh, mm = (t or "00:00").split(":")[:2]
            return _dt(d.year, d.month, d.day, int(hh), int(mm)).isoformat()
        except Exception:
            return _dt(d.year, d.month, d.day).isoformat()

    prt = r.get("problem_related_to")
    return {
        "id":        r["id"],
        "auto_slip": True,                       # frontend isse pehchanta hai
        "zone_name": r.get("zone"),
        "line_name": r.get("line"),
        "shift_name": r.get("shift"),
        "started_at": _stamp(r.get("bd_start_date"), r.get("bd_start_time")),
        "ended_at":   _stamp(r.get("bd_end_date"),   r.get("bd_ok_time")),
        "duration_seconds": (r["mc_down_time_minutes"] * 60
                             if r.get("mc_down_time_minutes") is not None else None),
        "production_data": {
            "zone": r.get("zone"), "line": r.get("line"),
            "machine_no": r.get("machine_no"), "machine_name": r.get("machine_name"),
            "date": r.get("slip_date"), "shift": r.get("shift"),
            "line_leader_name": r.get("line_leader_name"),
            "model_no": r.get("model_no"),
            "machine_operator_name": r.get("machine_operator_name"),
            "category": r.get("category"),
            "bd_start_time": r.get("bd_start_time"),
            "bd_received_time": r.get("bd_received_time"),
            "bd_ok_time": r.get("bd_ok_time"),
            "bd_start_date": r.get("bd_start_date"),
            "bd_end_date": r.get("bd_end_date"),
            "mc_down_time_minutes": r.get("mc_down_time_minutes"),
            "response_time_minutes": r.get("response_time_minutes"),
            "frequency": r.get("frequency"),
            "problem_reported_by_production": r.get("problem_reported_by_production"),
        },
        "maintenance_data": {
            "machine_no": r.get("machine_no"), "machine_name": r.get("machine_name"),
            "problem_related_to": {"maintenance": prt == "maintenance",
                                   "tool_room":   prt == "tool_room"},
            "type_of_problem": {"electrical": bool(r.get("type_electrical")),
                                "mechanical": bool(r.get("type_mechanical"))},
            "problem_observed_by_maintenance": r.get("problem_observed_by_maintenance"),
            "action_taken_on_problem": r.get("action_taken_on_problem"),
            "spares_used": r.get("spares_used"),
            "spares": r.get("spares") or [],
            "bd_attended_by": r.get("bd_attended_by"),
            "prepared_by":          {"name": r.get("prepared_by_name")},
            "received_by":          {"name": r.get("received_by_name")},
            "line_leader_operator": {"name": r.get("line_leader_operator_name")},
            "quality_engineer":     {"name": r.get("quality_engineer_name")},
        },
    }


class AutoSlipFill(BaseModel):
    maintenance_data: Optional[dict] = None
    production_data:  Optional[dict] = None
    # 2-stage flow: production apni half submit kare -> 'PENDING_MAINTENANCE',
    # maintenance complete kare -> 'COMPLETED'.  None = sirf save, stage na badle.
    stage:            Optional[str]  = None
    # kis table ki slip: 'maintenance' (default) ya 'toolroom'
    src:              Optional[str]  = None


@router.get("/auto/{sid}")
def get_auto_slip(sid: int, src: str = Query("maintenance"),
                  user=Depends(get_current_user)) -> dict:
    """Ek AUTO slip — form ke `ticket` shape me.  `src` = maintenance | toolroom."""
    _ensure_table()
    tbl = _src_table(src)
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute(f"SELECT * FROM {tbl} WHERE id = %s", (sid,))
        r = cur.fetchone()
    if not r:
        raise HTTPException(404, "auto slip not found")
    t = _slip_to_ticket(dict(r))
    t["src"] = "toolroom" if tbl == TOOLROOM_SLIP_TABLE else "maintenance"
    return t


@router.get("/stage/{stage}")
def list_by_stage(stage: str, src: str = Query("maintenance"),
                  user=Depends(get_current_user)) -> List[dict]:
    """2-stage flow ki list: PENDING_PRODUCTION (production tab), PENDING_MAINTENANCE
    (maintenance / tool room ko), COMPLETED (history).

    `src`: 'maintenance' | 'toolroom' | 'all'.  Production tab 'all' bhejta hai —
    dono taraf ki pending slips ek hi jagah dikhti hain; har row me `src` bata deta
    hai wo maintenance ki hai ya tool room ki (aage usi table me jaati hai)."""
    _ensure_table()
    if stage not in ("PENDING_PRODUCTION", "PENDING_MAINTENANCE", "COMPLETED"):
        raise HTTPException(400, "bad stage")
    srcs = (["maintenance", "toolroom"] if (src or "").strip().lower() == "all"
            else [(src or "maintenance").strip().lower()])
    out: List[dict] = []
    with get_conn() as conn:
        cur = dict_cursor(conn)
        for s in srcs:
            tbl = _src_table(s)
            cur.execute(f"""
                SELECT id, zone, line, machine_no, machine_name, shift, slip_date,
                       bd_start_date, bd_start_time, bd_received_time, bd_ok_time,
                       mc_down_time_minutes, response_time_minutes, category,
                       problem_reported_by_production, prod_stage, andon_event_id,
                       production_at, submitted_at
                  FROM {tbl}
                 WHERE COALESCE(prod_stage, 'PENDING_MAINTENANCE') = %s
            """, (stage,))
            for r in cur.fetchall():
                d = dict(r); d["src"] = s; out.append(d)
    # dono tables ke rows ek saath — naya pehle
    out.sort(key=lambda d: (str(d.get("bd_start_date") or ""), str(d.get("bd_start_time") or ""),
                            d.get("id") or 0), reverse=True)
    return out


@router.delete("/auto/{sid}")
def delete_auto_slip(sid: int, src: str = Query("maintenance"), admin=Depends(require_admin)):
    """AUTO slip delete — galat/extra auto-generated slip hatane ke liye (admin-only)."""
    _ensure_table()
    tbl = _src_table(src)
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute(f"DELETE FROM {tbl} WHERE id = %s", (sid,))
        if cur.rowcount == 0:
            raise HTTPException(404, "auto slip not found")
    return {"ok": True, "deleted": sid}


@router.post("/auto/{sid}/fill")
def fill_auto_slip(sid: int, body: AutoSlipFill, user=Depends(get_current_user)):
    """Maintenance ne form bhara → USI row ko update karo (nayi row nahi).

    Sirf wahi columns badalte hain jo form ne bheje.  Jo field form me aaya
    hi nahi, uski purani value (jo ANDON ne bhari thi) waise hi rehti hai —
    isliye time / machine kabhi khali nahi hote."""
    _ensure_table()
    tbl = _src_table(body.src or "maintenance")   # maintenance ya tool room ki table
    flat = _halves_to_flat(body.production_data, body.maintenance_data)

    sent_prod  = set((body.production_data  or {}).keys())
    sent_maint = set((body.maintenance_data or {}).keys())
    # form ne kuch bheja hi nahi AUR stage bhi nahi badalna -> kuch karne ko nahi.
    # (stage aaya ho to aage badho — neeche uska poora validation hota hai, taaki
    #  galat transition par saaf error mile, chup-chaap "ok" nahi.)
    if not sent_prod and not sent_maint and not body.stage:
        return {"ok": True, "id": sid, "updated": 0}

    # Konsa flat column kis half ke kis field se banta hai
    from_prod = {
        "zone": "zone", "line": "line", "machine_no": "machine_no",
        "machine_name": "machine_name", "slip_date": "date", "shift": "shift",
        "line_leader_name": "line_leader_name", "model_no": "model_no",
        "machine_operator_name": "machine_operator_name", "category": "category",
        "bd_start_time": "bd_start_time", "bd_received_time": "bd_received_time",
        "bd_ok_time": "bd_ok_time", "bd_start_date": "bd_start_date",
        "bd_end_date": "bd_end_date", "mc_down_time_minutes": "mc_down_time_minutes",
        "response_time_minutes": "response_time_minutes", "frequency": "frequency",
        "problem_reported_by_production": "problem_reported_by_production",
    }
    from_maint = {
        "machine_no": "machine_no", "machine_name": "machine_name",
        "problem_related_to": "problem_related_to",
        "type_electrical": "type_of_problem", "type_mechanical": "type_of_problem",
        "problem_observed_by_maintenance": "problem_observed_by_maintenance",
        "action_taken_on_problem": "action_taken_on_problem",
        "spares_used": "spares_used", "spares": "spares",
        "bd_attended_by": "bd_attended_by",
        "prepared_by_name": "prepared_by", "received_by_name": "received_by",
        "line_leader_operator_name": "line_leader_operator",
        "quality_engineer_name": "quality_engineer",
    }

    from psycopg2.extras import Json
    sets, vals = [], []
    for col, value in flat.items():
        came = ((col in from_prod  and from_prod[col]  in sent_prod) or
                (col in from_maint and from_maint[col] in sent_maint))
        if not came:
            continue                              # form me tha hi nahi -> mat chhedo
        if col == "spares":
            keep = [s for s in (value or [])
                    if isinstance(s, dict) and any(str(v or "").strip() for v in s.values())]
            sets.append("spares = %s")
            vals.append(Json(keep) if keep else None)
        else:
            sets.append(f"{col} = %s")
            vals.append(_blank_to_none(value))

    # ── 2-stage transition ────────────────────────────────────────────────
    # Sirf AAGE ki taraf, ek-ek karke:  PENDING_PRODUCTION → PENDING_MAINTENANCE
    # → COMPLETED.  Isse production skip nahi ho sakti, stage peeche nahi jaa
    # sakti, aur do log ek saath submit karein to bhi (WHERE prod_stage=<expected>)
    # sirf pehla lagta hai — doosre ko saaf error milta hai.
    _uid = user.get("id") if isinstance(user, dict) else None
    _ALLOWED_FROM = {                       # naya stage -> jis stage se aa sakta hai
        "PENDING_MAINTENANCE": ("PENDING_PRODUCTION",),
        "COMPLETED":           ("PENDING_MAINTENANCE",),
    }
    stage_guard = None
    if body.stage:
        if body.stage not in _ALLOWED_FROM:
            raise HTTPException(400, f"stage '{body.stage}' set nahi kar sakte")
        with get_conn() as _c:
            _cur = dict_cursor(_c)
            _cur.execute(f"SELECT prod_stage FROM {tbl} WHERE id = %s", (sid,))
            _row = _cur.fetchone()
        if not _row:
            raise HTTPException(404, "auto slip not found")
        _cur_stage = _row["prod_stage"] or "PENDING_MAINTENANCE"   # purani slips
        if _cur_stage == body.stage:
            raise HTTPException(409, "Ye slip pehle hi submit ho chuki hai (refresh karein).")
        if _cur_stage not in _ALLOWED_FROM[body.stage]:
            raise HTTPException(409,
                f"Abhi ye slip '{_cur_stage}' par hai — pehle uska step poora hona chahiye.")
        stage_guard = _cur_stage            # UPDATE me WHERE clause banega (race-safe)
        sets.append("prod_stage = %s"); vals.append(body.stage)
        if body.stage == "PENDING_MAINTENANCE":     # production ne apni half di
            sets.append("production_by_user_id = %s"); vals.append(_uid)
            sets.append("production_at = NOW()")

    if not sets:
        return {"ok": True, "id": sid, "updated": 0}

    sets.append("submitted_by_user_id = %s")
    vals.append(user.get("id") if isinstance(user, dict) else None)
    sets.append("submitted_at = NOW()")
    vals.append(sid)
    # Race-safe: stage badal rahe hain to UPDATE tabhi lage jab row abhi bhi usi
    # purane stage par ho (do log ek saath submit karein to doosra 409 paayega,
    # dono ka data aadha-aadha mix nahi hoga).
    where = "id = %s"
    if stage_guard is not None:
        where += " AND COALESCE(prod_stage, 'PENDING_MAINTENANCE') = %s"
        vals.append(stage_guard)
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute(f"UPDATE {tbl} SET {', '.join(sets)} WHERE {where}", vals)
        if cur.rowcount == 0:
            if stage_guard is not None:
                raise HTTPException(409, "Slip ka stage abhi-abhi badal gaya — refresh karke dobara dekhein.")
            raise HTTPException(404, "auto slip not found")

    # Spares master me bhi likh do (best-effort, manual slip jaisa hi)
    try:
        spares = (body.maintenance_data or {}).get("spares")
        if spares:
            from routers.maintenance_spare import record_usage
            with get_conn() as sconn:
                record_usage(sconn, "Auto Slip", {
                    "zone": flat.get("zone"), "line": flat.get("line"),
                    "machine_no": flat.get("machine_no"),
                    "machine_name": flat.get("machine_name"),
                    "used_date": flat.get("slip_date") or flat.get("bd_start_date"),
                }, spares)
    except Exception as e:
        print(f"[SPARE-MASTER] record failed (auto slip {sid}): {e}")

    return {"ok": True, "id": sid, "updated": len(sets)}
