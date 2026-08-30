"""
routers/study_material.py
=========================
Study Material — maintenance ki padhai ka saamaan.

Yahan MTTR / MTBF / LTTR / KPI / Breakdown / PM / DMC / ANDON / CAPA jaisi
cheezein saaf-saaf likhi rehti hain, taaki naya banda padh kar samajh sake.

Do baatein jaan-boojh kar aisi hain:

1. **Content DB me hai, code me nahi.**  Admin heading ya matter kabhi bhi
   badal sakta hai, aur naya topic jod sakta hai — bina deploy ke.  Isiliye
   koi baat yahan hardcode nahi ki gayi.

2. **Pehli baar par seed hota hai.**  Table khali ho to neeche wale topics
   apne aap bhar jaate hain — warna page khali milta aur koi padhta hi nahi.
   Seed SIRF tab chalta hai jab table BILKUL khali ho, isliye admin ke likhe
   par kabhi nahi chadhta (delete kiya hua topic wapas nahi aata).

Endpoints
---------
GET    /api/study-material/       → saare topic (padhna sab ke liye khula)
GET    /api/study-material/{id}   → ek topic
POST   /api/study-material/       → naya topic        (admin)
PUT    /api/study-material/{id}   → topic badlo       (admin)
DELETE /api/study-material/{id}   → topic hatao       (admin)
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from database import get_conn, dict_cursor
from auth import get_current_user, require_admin

router = APIRouter(prefix="/api/study-material", tags=["study-material"])

_ENSURED = False


# ── seed content ────────────────────────────────────────────────────────────
# Ye is plant ke ASLI niyam hain (KPI page aur CAPA page se milaye gaye), na ki
# kitaabi.  Formula kabhi badle to yahan bhi badalna — warna padhne wala kuch
# aur seekhega aur screen kuch aur dikhayegi.
_SEED = [
    ("Basics", "What is Maintenance?",
     "Maintenance means keeping a machine in a condition where it can run and "
     "produce good parts safely.\n\n"
     "It has two sides:\n\n"
     "1. BREAKDOWN maintenance - the machine has already stopped or is giving "
     "trouble, and we repair it.\n\n"
     "2. PREVENTIVE maintenance (PM) - we service the machine on a plan so that "
     "it does not break down in the first place.\n\n"
     "A good maintenance team is judged less by how fast it repairs, and more "
     "by how rarely it has to."),

    ("Basics", "What is a Breakdown?",
     "A breakdown is any machine problem that needs maintenance action.\n\n"
     "In our system every breakdown is recorded on a BREAK DOWN SLIP, which "
     "carries: machine, date, shift, start time, OK time, what the problem was, "
     "what action was taken, spares used, and who attended.\n\n"
     "The slip is the source of every number you see on the KPI and Dashboard "
     "pages. If the slip is filled carelessly, every report built on it is "
     "wrong."),

    ("Basics", "Breakdown Categories (A and B)",
     "Every slip must be marked with one category.\n\n"
     "A CATEGORY - Machine or line has STOPPED and there is production loss "
     "directly.\n\n"
     "B CATEGORY - Machine is still RUNNING but production is affected "
     "(adjustment).\n\n"
     "Why it matters: A-category losses hit output immediately, so they are "
     "reviewed first. Marking a real A-category slip as B hides a genuine "
     "production loss from the report."),

    ("Basics", "Down Time vs Response Time",
     "These two are often confused. They are not the same thing.\n\n"
     "RESPONSE TIME - from the moment the call is raised to the moment "
     "maintenance reaches the machine. It measures how quickly we REACT.\n\n"
     "DOWN TIME (M/C down time) - from B/D start time to B/D OK time. It "
     "measures how long PRODUCTION was affected.\n\n"
     "A fast response with a long repair still means a long down time. Both "
     "numbers are tracked separately for this reason."),

    ("KPI", "What is a KPI?",
     "KPI = Key Performance Indicator. It is a number that tells you whether "
     "things are getting better or worse, without reading every slip.\n\n"
     "Our maintenance KPIs are: MTTR, MTBF, LTTR, Availability, Breakdown "
     "Frequency, Total Breakdown Hours, and Breakdowns of 60 minutes or more.\n\n"
     "A KPI is only as honest as the data behind it. Every one of these is "
     "calculated live from the breakdown slips - nothing is typed in by hand."),

    ("KPI", "MTTR - Mean Time To Repair",
     "MTTR tells you, on average, how long a machine stays down once it "
     "breaks.\n\n"
     "FORMULA (as used in this system):\n\n"
     "    MTTR = Total down time (minutes) / Total breakdown frequency\n\n"
     "Unit: MINUTES. Lower is better.\n\n"
     "Note carefully: MTTR is about REPAIR time, not response time. Do not mix "
     "the two.\n\n"
     "If MTTR is rising, ask: are spares available? is the right skill on "
     "shift? is the same fault repeating and being patched instead of fixed?"),

    ("KPI", "MTBF - Mean Time Between Failures",
     "MTBF tells you how long a machine runs, on average, before it fails "
     "again.\n\n"
     "FORMULA (as used in this system):\n\n"
     "    MTBF = (Elapsed hours - Total down hours) / Total breakdown "
     "frequency\n\n"
     "Unit: HOURS. Higher is better.\n\n"
     "MTTR and MTBF answer two different questions:\n\n"
     "  MTTR - when it breaks, how fast are we back?\n"
     "  MTBF - how often does it break at all?\n\n"
     "Improving MTBF is preventive work (PM, DMC, root-cause fixes). Improving "
     "MTTR is repair readiness (spares, skill, tools)."),

    ("KPI", "LTTR - Longest Time To Repair",
     "LTTR is the single longest breakdown in the selected period.\n\n"
     "    LTTR = MAX(down time)\n\n"
     "Unit: usually shown in hours. Lower is better.\n\n"
     "Why it is tracked separately: an average can look healthy while one "
     "12-hour breakdown quietly caused most of the month's loss. LTTR makes "
     "that one bad event visible instead of letting the average hide it."),

    ("KPI", "Availability",
     "Availability is the share of planned time a machine was actually "
     "available to run.\n\n"
     "    Availability = MTBF / (MTBF + MTTR in hours) x 100\n\n"
     "Unit: PERCENT. Higher is better.\n\n"
     "It combines both sides in one number: breaking rarely (high MTBF) AND "
     "recovering quickly (low MTTR) both push availability up."),

    ("KPI", "Breakdown Frequency",
     "Frequency is how MANY times breakdowns happened - not how long they "
     "lasted.\n\n"
     "Important: our reports add up the FREQUENCY column on the slips, they do "
     "not simply count rows. One slip can record more than one occurrence.\n\n"
     "Frequency is also the divider in both MTTR and MTBF, so a wrong "
     "frequency quietly corrupts both of those KPIs."),

    ("CAPA", "Breakdowns of 60 minutes or more",
     "Any breakdown whose down time is 60 MINUTES OR MORE is treated as a "
     "serious loss and needs a CAPA.\n\n"
     "Note the rule carefully: it is 60 minutes OR MORE. A breakdown of exactly "
     "60 minutes DOES count.\n\n"
     "(Earlier two pages disagreed on this - one used 'more than 60' and the "
     "other used '60 or more' - and the counts never matched. The whole system "
     "now uses 60-or-more everywhere.)"),

    ("CAPA", "What is CAPA?",
     "CAPA = Corrective And Preventive Action.\n\n"
     "CORRECTIVE - fix the problem that happened.\n"
     "PREVENTIVE - make sure it cannot happen again.\n\n"
     "Repairing a broken sensor is corrective. Finding out why the sensor keeps "
     "getting hit, and adding a guard, is preventive. Only the second one "
     "reduces future breakdowns.\n\n"
     "In our system every breakdown of 60 minutes or more becomes a CAPA, and "
     "it is closed by filling the QPR sheet."),

    ("CAPA", "What is QPR?",
     "QPR is the quality problem report sheet used to close a CAPA.\n\n"
     "It walks through the problem in order: what was observed, how it was "
     "confirmed, what was done immediately to contain it, what the root cause "
     "was for OCCURRENCE and for OUTFLOW, and what permanent action was "
     "taken.\n\n"
     "A CAPA is not closed because the machine is running again. It is closed "
     "when the QPR shows the cause was found and blocked."),

    ("Preventive", "PM - Preventive Maintenance",
     "PM is planned servicing done BEFORE the machine fails - cleaning, "
     "lubrication, tightening, checking wear, replacing parts on schedule.\n\n"
     "Each machine has a PM frequency and a yearly schedule of planned weeks. "
     "When PM is actually done, the actual week and date are recorded, so plan "
     "vs actual can be compared.\n\n"
     "PM is the main lever on MTBF. Breakdown repair only restores what was "
     "lost; PM is what stops the loss from happening."),

    ("Preventive", "DMC - Daily Machine Check",
     "DMC is the short daily check the operator does on the machine - a small "
     "list of points marked OK or NG every day.\n\n"
     "It is the cheapest early warning available. A loose guard, a small leak "
     "or an odd sound caught in a 5-minute daily check is a 10-minute job; the "
     "same thing found after failure can cost a full shift.\n\n"
     "An NG point raised in DMC goes to maintenance for action."),

    ("ANDON", "What is ANDON?",
     "ANDON is the call system on the shop floor. When a machine has a problem "
     "the operator presses a button, and a call is raised to the right "
     "department - Maintenance, Tool Room, Quality, Material and so on.\n\n"
     "The call records when it started, when someone responded, and when it "
     "ended. From this we get response time and duration automatically, without "
     "anyone writing it down.\n\n"
     "For Maintenance and Tool Room the tower light goes OFF as soon as someone "
     "RESPONDS. For the other departments it stays ON until the call is "
     "closed."),

    ("ANDON", "Total Loss and why lines are counted separately",
     "When two departments are called on the same line, the time is not counted "
     "twice - the newest call takes over, and the earlier one resumes when the "
     "newer one ends.\n\n"
     "But two different LINES can be down at the same time, and both losses are "
     "real. So the loss is worked out separately for each line and then added "
     "up. Treating the whole plant as one timeline would under-report the "
     "loss."),

    ("Basics", "The plant day and the financial year",
     "PLANT DAY: our day runs from 07:00 to 06:30 the next morning, not "
     "midnight to midnight. A call at 6 AM belongs to the PREVIOUS day's "
     "report. This is why a night-shift breakdown appears on the earlier "
     "date.\n\n"
     "FINANCIAL YEAR: April to March. 'FY 2026-27' means 01-Apr-2026 to "
     "31-Mar-2027. Every yearly report on this system follows this, not the "
     "calendar year."),

    ("Basics", "Why filling the slip properly matters",
     "Every KPI on this system is built from the breakdown slips. Nothing is "
     "typed in separately.\n\n"
     "  - Wrong start or OK time -> wrong down time -> wrong MTTR and wrong "
     "availability\n\n"
     "  - Blank frequency -> wrong MTTR and MTBF (frequency is the divider)\n\n"
     "  - Wrong category -> a real production loss disappears from the report\n\n"
     "  - Vague problem / action -> the next person repeats your investigation "
     "from zero\n\n"
     "Five extra minutes on the slip today saves hours of guessing later."),
]


def _ensure_table() -> None:
    global _ENSURED
    if _ENSURED:
        return
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS maintenance_study_material (
                id          SERIAL PRIMARY KEY,
                category    VARCHAR(80)  NOT NULL DEFAULT 'General',
                title       VARCHAR(200) NOT NULL,
                body        TEXT         NOT NULL DEFAULT '',
                sort_order  INTEGER      NOT NULL DEFAULT 0,
                active      BOOLEAN      NOT NULL DEFAULT TRUE,
                created_by  VARCHAR(120),
                created_at  TIMESTAMP    DEFAULT NOW(),
                updated_by  VARCHAR(120),
                updated_at  TIMESTAMP    DEFAULT NOW()
            )""")
        # Seed SIRF bilkul khali table par — admin ke likhe par kabhi na chadhe,
        # aur delete kiya hua topic wapas na aaye.
        cur.execute("SELECT COUNT(*) FROM maintenance_study_material")
        if cur.fetchone()[0] == 0:
            for i, (cat, title, body) in enumerate(_SEED):
                cur.execute(
                    """INSERT INTO maintenance_study_material
                         (category, title, body, sort_order, created_by, updated_by)
                       VALUES (%s, %s, %s, %s, 'system', 'system')""",
                    (cat, title, body, (i + 1) * 10))
        conn.commit()
    _ENSURED = True


class TopicIn(BaseModel):
    category:   Optional[str] = "General"
    title:      str
    body:       Optional[str] = ""
    sort_order: Optional[int] = 0
    active:     Optional[bool] = True


@router.get("/")
def list_topics(include_inactive: bool = Query(False),
                user=Depends(get_current_user)) -> List[dict]:
    """Saare topic.  Padhna sab ke liye khula — likhna sirf admin ka kaam."""
    _ensure_table()
    sql = "SELECT * FROM maintenance_study_material"
    if not include_inactive:
        sql += " WHERE active = TRUE"
    sql += " ORDER BY sort_order, id"
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute(sql)
        return cur.fetchall()


@router.get("/{tid}")
def get_topic(tid: int, user=Depends(get_current_user)) -> dict:
    _ensure_table()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT * FROM maintenance_study_material WHERE id = %s", (tid,))
        row = cur.fetchone()
    if not row:
        raise HTTPException(404, "Topic not found")
    return row


@router.post("/", status_code=201)
def add_topic(t: TopicIn, user=Depends(require_admin)) -> dict:
    _ensure_table()
    if not (t.title or "").strip():
        raise HTTPException(400, "Title required")
    with get_conn() as conn:
        cur = dict_cursor(conn)
        order = t.sort_order
        if not order:            # na diya ho to sabse aakhir me lag jaye
            cur.execute("""SELECT COALESCE(MAX(sort_order), 0) + 10 AS n
                             FROM maintenance_study_material""")
            order = cur.fetchone()["n"]
        cur.execute(
            """INSERT INTO maintenance_study_material
                 (category, title, body, sort_order, active, created_by, updated_by)
               VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING *""",
            ((t.category or "General").strip(), t.title.strip(), t.body or "",
             order, True if t.active is None else t.active,
             user["username"], user["username"]))
        row = cur.fetchone()
        conn.commit()
    return row


@router.put("/{tid}")
def edit_topic(tid: int, t: TopicIn, user=Depends(require_admin)) -> dict:
    """Heading, matter, category, kram — kuch bhi badla ja sakta hai."""
    _ensure_table()
    if not (t.title or "").strip():
        raise HTTPException(400, "Title required")
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute(
            """UPDATE maintenance_study_material
                  SET category=%s, title=%s, body=%s, sort_order=%s,
                      active=%s, updated_by=%s, updated_at=NOW()
                WHERE id=%s RETURNING *""",
            ((t.category or "General").strip(), t.title.strip(), t.body or "",
             t.sort_order or 0, True if t.active is None else t.active,
             user["username"], tid))
        row = cur.fetchone()
        conn.commit()
    if not row:
        raise HTTPException(404, "Topic not found")
    return row


@router.delete("/{tid}")
def del_topic(tid: int, user=Depends(require_admin)) -> dict:
    _ensure_table()
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM maintenance_study_material WHERE id=%s", (tid,))
        n = cur.rowcount
        conn.commit()
    if not n:
        raise HTTPException(404, "Topic not found")
    return {"ok": True, "deleted": tid}
