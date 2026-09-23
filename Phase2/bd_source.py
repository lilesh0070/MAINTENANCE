"""
Breakdown ka SOURCE ek hi jagah tay hota hai — manual slip / auto slip / dono.
──────────────────────────────────────────────────────────────────────────────
User (2026-09-23): BD History, BD Analysis, Pareto, Top 10 BD, Breakdown QPR,
CAPA aur Maintenance KPI — sab par upar "Slip Type" ka switch ho, aur **auto
slip tabhi gine jaaye jab wo POORI BHAR KAR SUBMIT ho chuki ho**.

    manual = maintenance_breakdown_data       (haath se bhari Break Down Slip)
    auto   = maintenance_auto_breakdown_slip  (ANDON call band hone par bani)
    all    = dono (UNION ALL)

⚠ AUTO SLIP SIRF `prod_stage = 'COMPLETED'`
   ANDON call par slip apne-aap ban jaati hai — us waqt usme sirf
   zone/line/time/down-time hota hai; problem, action, attended-by, category
   sab khaali.  Aisi adhoori qatar kisi bhi report me nahi aani chahiye.
   Nishaan `prod_stage` hai (breakdown_slips.py ka 2-stage gate):
       PENDING_PRODUCTION  ->  PENDING_MAINTENANCE  ->  COMPLETED
   NULL ko bhi "poori nahi" maana jaata hai (wahi COALESCE idiom jo
   breakdown_slips.py me hai) — yaani shak ho to qatar ginti me NAHI aati.
   Manual table par `prod_stage` column hai hi nahi: wo slip ek hi baar me
   poori bhar kar save hoti hai, isliye uspar koi shart nahi.

⚠ DEFAULT HAMESHA "manual"
   Har endpoint ka default `manual` hai.  Jo purane page `src` bhejte hi nahi
   (Maintenance Overview, Annual Index, …) unka matlab manual register hi hai
   aur unka bartaav bilkul nahi badalta.

⚠ id AKELI PEHCHAAN NAHI HAI
   Dono table ki id 1 se shuru hoti hai aur overlap karti hai (naapa 2026-09-23:
   auto ki **saari** 16 id manual me bhi maujood thi).  Isliye har qatar ke
   saath `bd_source` ('manual'/'auto') jaata hai.  Jahan bhi row ko id se
   pakda jaata ho (React key, CAPA ka logbook_id, …) wahan source ke BINA
   pakadna GALAT hai.
"""
from typing import Optional

from database import get_conn

MANUAL_TABLE = "maintenance_breakdown_data"
AUTO_TABLE   = "maintenance_auto_breakdown_slip"

# Auto slip par lagne wali shart -- "poori bhar kar submit ho chuki hai".
AUTO_DONE_SQL = "COALESCE(prod_stage, 'PENDING_MAINTENANCE') = 'COMPLETED'"

CHOICES = ("manual", "auto", "all")

# naam: (table, dikhne wala label, us table par lagne wali shart)
SRC_TABLES = {
    "manual": (MANUAL_TABLE, "Manual Slip", ""),
    "auto":   (AUTO_TABLE,   "Auto Slip",   "\n     WHERE " + AUTO_DONE_SQL),
}


def norm(src: Optional[str]) -> str:
    """Kachra / khali / anjaan value hamesha "manual" ban jaati hai."""
    s = (src or "manual").strip().lower()
    return s if s in CHOICES else "manual"


def _keys(src: Optional[str]):
    s = norm(src)
    return ("manual", "auto") if s == "all" else (s,)


# ══════════════════════════════════════════════════════════════════════════
#  1) ALIASED source -- BD History / breakdowns.py ke readable naam
# ══════════════════════════════════════════════════════════════════════════
# (zone -> zone_code, mc_down_time_minutes -> solve_time_min, …)  Poora
# template breakdowns.py me hai; wahan se register hota hai taaki us lambi
# SELECT ki ek hi copy rahe.
_ALIASED_TPL = ""


def register_aliased_tpl(tpl: str) -> None:
    """breakdowns.py apna SELECT template yahan de deta hai (import ke waqt)."""
    global _ALIASED_TPL
    _ALIASED_TPL = tpl


def aliased(src: Optional[str] = "manual") -> str:
    """`src` ke hisaab se readable-naam wali subquery — `AS bd`."""
    if not _ALIASED_TPL:
        raise RuntimeError("aliased template register nahi hua (routers.breakdowns import karo)")
    parts = []
    for k in _keys(src):
        tbl, label, filt = SRC_TABLES[k]
        parts.append(_ALIASED_TPL.format(tbl=tbl, label=label, filt=filt))
    return "(" + " UNION ALL ".join(parts) + ") AS bd"


# ══════════════════════════════════════════════════════════════════════════
#  2) RAW source -- KPI / CAPA ke liye, khaano ke ASLI naam
# ══════════════════════════════════════════════════════════════════════════
# maintenance_kpi.py aur capa_logbook.py apni SQL me table ke asli khaane
# use karte hain (zone, line, mc_down_time_minutes, frequency, category …).
# Isliye unke liye WAHI naam wali UNION chahiye, alias wali nahi.
#
# Khaano ki list DB se khud nikalti hai (dono table ka mel) -- hardcode karne
# par kal koi naya column aaya to wo chup-chaap gayab rehta.  Naapa 2026-09-23:
# manual ke 34 me se 34 khaane auto me bhi hain, naap bhi bilkul same.
_RAW_COLS: Optional[list] = None


def _load_raw_cols(cur) -> list:
    cur.execute("""
        SELECT a.column_name
          FROM information_schema.columns a
          JOIN information_schema.columns b
            ON b.table_schema = a.table_schema
           AND b.table_name   = %s
           AND b.column_name  = a.column_name
         WHERE a.table_schema = current_schema()
           AND a.table_name   = %s
         ORDER BY a.ordinal_position
    """, (AUTO_TABLE, MANUAL_TABLE))
    rows = cur.fetchall() or []
    # dict_cursor bhi ho sakta hai aur normal bhi
    cols = [(r["column_name"] if isinstance(r, dict) else r[0]) for r in rows]
    if not cols:
        raise RuntimeError(f"{MANUAL_TABLE} / {AUTO_TABLE} ke saanjhe khaane nahi mile")
    return cols


def raw_cols(cur=None) -> list:
    """Dono table me maujood khaane (manual ke kram me).  Ek baar hi padhe jaate hain."""
    global _RAW_COLS
    if _RAW_COLS is None:
        if cur is not None:
            _RAW_COLS = _load_raw_cols(cur)
        else:
            with get_conn() as conn:
                _RAW_COLS = _load_raw_cols(conn.cursor())
    return _RAW_COLS


def raw(src: Optional[str] = "manual", cur=None) -> str:
    """`src` ke hisaab se ASLI khaano wali subquery — hamesha `AS bd`.

    Har qatar me ek extra khaana `bd_source` ('manual'/'auto') bhi aata hai,
    kyunki akeli id dono table me takra jaati hai."""
    cols = ", ".join(raw_cols(cur))
    parts = []
    for k in _keys(src):
        tbl, _label, filt = SRC_TABLES[k]
        parts.append(f"\n    SELECT {cols}, '{k}'::text AS bd_source\n      FROM {tbl}{filt}")
    return "(" + " UNION ALL ".join(parts) + "\n) AS bd"
