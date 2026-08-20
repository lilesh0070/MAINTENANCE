"""
routers/breakdown_mail.py
=========================
BREAKDOWN ESCALATION MAIL — breakdown jitna lamba khichta jaayega, utne upar
tak apne aap mail chala jaayega.

Admin ek SEEDHI (ladder) banata hai:

    Engineer      15 min  -> a@x.com
    Sr. Engineer  30 min  -> b@x.com
    AM            60 min  -> ...
    DM           120 min
    HOD          180 min
    Plant Head   240 min

Ek MAINTENANCE ANDON call jitne minute khuli rahegi, jis-jis level ka waqt paar
hoga us level ko mail chala jaayega — ek level ka mail ek breakdown me SIRF EK
BAAR (log table se pakka hota hai, isliye worker har 30s chalne par bhi dobara
mail nahi jaata).

Tables
------
maintenance_escalation_level   ladder (seq / role / minutes / emails / on-off)
maintenance_escalation_config  ek row — poore feature ka on-off + CC
maintenance_escalation_log     kis call ke kis level ka mail kab gaya (dedupe + history)

Endpoints (prefix /api/breakdown-mail)
--------------------------------------
GET  /config     ladder + on-off
PUT  /config     ladder save (replace-all) + on-off      [admin]
POST /test       ek level par test mail                   [admin]
GET  /log        pichhle bheje gaye mail
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from database import get_conn, dict_cursor
from auth import get_current_user, require_admin

router = APIRouter(prefix="/api/breakdown-mail", tags=["breakdown-mail"])

# Jo ladder pehli baar apne aap ban jaati hai (admin baad me badal sakta hai).
_DEFAULT_LADDER = [
    (1, "Engineer",      15),
    (2, "Sr. Engineer",  30),
    (3, "AM",            60),
    (4, "DM",           120),
    (5, "HOD",          180),
    (6, "Plant Head",   240),
]

_ensured = False


def _ensure():
    global _ensured
    if _ensured:
        return
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS maintenance_escalation_level (
                id            SERIAL PRIMARY KEY,
                seq           INTEGER NOT NULL,
                role_label    VARCHAR(60)  NOT NULL,
                after_minutes INTEGER      NOT NULL,
                emails        TEXT,
                enabled       BOOLEAN DEFAULT TRUE,
                updated_at    TIMESTAMP DEFAULT NOW()
            )
        """)
        # auto_enabled DEFAULT FALSE — feature khud se mail bhejna tab hi shuru
        # kare jab admin ne ladder bhar kar ON kiya ho (warna khali/galat pate
        # par pehle hi din mail chal padte).
        cur.execute("""
            CREATE TABLE IF NOT EXISTS maintenance_escalation_config (
                id           INTEGER PRIMARY KEY DEFAULT 1,
                auto_enabled BOOLEAN DEFAULT FALSE,
                cc           TEXT,
                updated_at   TIMESTAMP DEFAULT NOW()
            )
        """)
        cur.execute("INSERT INTO maintenance_escalation_config (id) VALUES (1) ON CONFLICT DO NOTHING")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS maintenance_escalation_log (
                id             SERIAL PRIMARY KEY,
                andon_event_id INTEGER NOT NULL,
                level_id       INTEGER NOT NULL,
                role_label     VARCHAR(60),
                zone           VARCHAR(60),
                line           VARCHAR(60),
                machine_no     VARCHAR(60),
                minutes        INTEGER,
                to_emails      TEXT,
                ok             BOOLEAN DEFAULT TRUE,
                err            TEXT,
                sent_at        TIMESTAMP DEFAULT NOW()
            )
        """)
        # Ek call ke ek level ka mail SIRF EK BAAR — asli guarantee yahi index hai.
        cur.execute("ALTER TABLE maintenance_escalation_log ADD COLUMN IF NOT EXISTS machine_no VARCHAR(60)")
        cur.execute("""CREATE UNIQUE INDEX IF NOT EXISTS maintenance_escalation_log_uq
                         ON maintenance_escalation_log (andon_event_id, level_id)""")
        cur.execute("SELECT COUNT(*) FROM maintenance_escalation_level")
        if cur.fetchone()[0] == 0:
            for seq, role, mins in _DEFAULT_LADDER:
                cur.execute("""INSERT INTO maintenance_escalation_level
                               (seq, role_label, after_minutes, emails, enabled)
                               VALUES (%s,%s,%s,'',TRUE)""", (seq, role, mins))
        conn.commit()
    _ensured = True


# -- Models ---------------------------------------------------------------
class Level(BaseModel):
    id:            Optional[int] = None
    seq:           int
    role_label:    str
    after_minutes: int
    emails:        Optional[str] = ""
    enabled:       bool = True


class ConfigIn(BaseModel):
    auto_enabled: bool = False
    cc:           Optional[str] = ""
    levels:       List[Level] = []


class TestIn(BaseModel):
    level_id: Optional[int] = None
    to:       Optional[str] = None      # seedha koi pata (level ke bajaye)


def _emails(s):
    """a@x, b@y  ->  [a@x, b@y]   (khali / duplicate hata kar)."""
    out, seen = [], set()
    for x in (s or "").replace(";", ",").split(","):
        e = x.strip()
        if e and "@" in e and e.lower() not in seen:
            seen.add(e.lower())
            out.append(e)
    return out


# -- Endpoints ------------------------------------------------------------
@router.get("/config")
def get_config(user=Depends(get_current_user)):
    _ensure()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT auto_enabled, cc FROM maintenance_escalation_config WHERE id=1")
        cfg = cur.fetchone() or {"auto_enabled": False, "cc": ""}
        cur.execute("""SELECT id, seq, role_label, after_minutes, emails, enabled
                         FROM maintenance_escalation_level ORDER BY seq, id""")
        return {"auto_enabled": bool(cfg["auto_enabled"]),
                "cc": cfg.get("cc") or "",
                "levels": [dict(r) for r in cur.fetchall()]}


@router.put("/config")
def put_config(body: ConfigIn, admin=Depends(require_admin)):
    """Ladder poori nayi se likh do (replace-all) + feature on-off."""
    _ensure()
    for lv in body.levels:
        if not (lv.role_label or "").strip():
            raise HTTPException(400, "Role name cannot be empty")
        if lv.after_minutes is None or lv.after_minutes < 1:
            raise HTTPException(400, f"{lv.role_label}: minutes must be at least 1")
    # ON karne ja rahe ho to kam se kam ek chalu level me sahi email hona chahiye
    if body.auto_enabled and not any(_emails(l.emails) for l in body.levels if l.enabled):
        raise HTTPException(400, "Add an email address to at least one active level before turning Auto Mail on")
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("""UPDATE maintenance_escalation_config
                          SET auto_enabled=%s, cc=%s, updated_at=NOW() WHERE id=1""",
                    (bool(body.auto_enabled), (body.cc or "").strip()))
        cur.execute("DELETE FROM maintenance_escalation_level")
        for lv in body.levels:
            cur.execute("""INSERT INTO maintenance_escalation_level
                           (seq, role_label, after_minutes, emails, enabled)
                           VALUES (%s,%s,%s,%s,%s)""",
                        (lv.seq, lv.role_label.strip(), int(lv.after_minutes),
                         (lv.emails or "").strip(), bool(lv.enabled)))
        conn.commit()
    return {"ok": True, "levels": len(body.levels)}


@router.get("/log")
def get_log(limit:      int = Query(200, ge=1, le=1000),
            fy:         Optional[str] = Query(None),
            month:      Optional[str] = Query(None),
            zone:       Optional[str] = Query(None),
            line:       Optional[str] = Query(None),
            machine_no: Optional[str] = Query(None),
            role:       Optional[str] = Query(None),
            user=Depends(get_current_user)):
    """Bheje gaye mail — FY / month / zone / line / machine / level se chhaan kar."""
    _ensure()
    from routers.breakdown_slips import _fy_range          # ek hi FY hisaab, do jagah nahi
    d0, d1 = _fy_range(fy, month)
    where, params = ["1=1"], []
    if d0:
        # sent_at timestamp hai — poore aakhri din tak lena hai
        where.append("sent_at >= %s AND sent_at < (%s::date + INTERVAL '1 day')")
        params += [d0, d1]
    if zone:       where.append("zone = %s");       params.append(zone)
    if line:       where.append("line = %s");       params.append(line)
    if machine_no: where.append("machine_no = %s"); params.append(machine_no)
    if role:       where.append("role_label = %s"); params.append(role)
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute(f"""SELECT * FROM maintenance_escalation_log
                         WHERE {' AND '.join(where)}
                         ORDER BY sent_at DESC LIMIT %s""", params + [limit])
        return [dict(r) for r in cur.fetchall()]


@router.post("/test")
def send_test(body: TestIn, admin=Depends(require_admin)):
    """Test mail — pate sahi hain ya nahi, abhi pata chal jaata hai."""
    _ensure()
    to = _emails(body.to)
    role = "Test"
    if not to and body.level_id:
        with get_conn() as conn:
            cur = dict_cursor(conn)
            cur.execute("SELECT role_label, emails FROM maintenance_escalation_level WHERE id=%s",
                        (body.level_id,))
            r = cur.fetchone()
            if not r:
                raise HTTPException(404, "Level not found")
            role, to = r["role_label"], _emails(r["emails"])
    if not to:
        raise HTTPException(400, "No email address found")
    html = _mail_html(role=role, zone="SEAT_SLIDER", line="YHB_SS", machine="-",
                      minutes=30, started="-", test=True)
    from routers.mailer import _send_email
    try:
        _send_email(f"[TEST] Breakdown Escalation - {role}", html, to, [])
    except Exception as ex:
        raise HTTPException(400, f"Mail failed: {ex}")
    return {"ok": True, "sent_to": to}


# -- Mail body ------------------------------------------------------------
def _mail_html(*, role, zone, line, machine, minutes, started, test=False):
    tag = ('<div style="background:#fef3c7;color:#92400e;padding:8px 12px;border-radius:8px;'
           'font-weight:700;margin-bottom:14px">TEST MAIL - this is not a real breakdown</div>'
           ) if test else ""
    return (
        '<div style="font-family:Arial,sans-serif;max-width:640px">' + tag +
        '<div style="background:#b91c1c;color:#fff;padding:14px 18px;border-radius:10px 10px 0 0">'
        '<div style="font-size:19px;font-weight:800">BREAKDOWN ESCALATION</div>'
        f'<div style="font-size:13px;opacity:.9">Notification for {role}</div></div>'
        '<div style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 10px 10px;padding:16px 18px">'
        '<p style="margin:0 0 14px;font-size:14px;color:#334155">The breakdown below has been running for '
        f'<b>{minutes} minutes</b> and is still not resolved.</p>'
        '<table style="border-collapse:collapse;font-size:14px">'
        f'<tr><td style="padding:5px 14px 5px 0;color:#64748b">Zone</td><td style="font-weight:700">{zone or "-"}</td></tr>'
        f'<tr><td style="padding:5px 14px 5px 0;color:#64748b">Line</td><td style="font-weight:700">{line or "-"}</td></tr>'
        f'<tr><td style="padding:5px 14px 5px 0;color:#64748b">Machine</td><td style="font-weight:700">{machine or "-"}</td></tr>'
        f'<tr><td style="padding:5px 14px 5px 0;color:#64748b">Started</td><td style="font-weight:700">{started}</td></tr>'
        f'<tr><td style="padding:5px 14px 5px 0;color:#64748b">Elapsed</td>'
        f'<td style="font-weight:800;color:#b91c1c">{minutes} min</td></tr></table>'
        '<p style="margin:16px 0 0;font-size:12px;color:#94a3b8">Toyota Boshoku Device India — '
        'sent automatically by the Maintenance MES.</p></div></div>'
    )


# -- Worker ---------------------------------------------------------------
def _escalate_once():
    """Har khuli MAINTENANCE call dekho — jis level ka waqt paar ho chuka hai
    aur jiska mail abhi tak nahi gaya, uska mail bhejo.  Return: kitne gaye."""
    _ensure()
    with get_conn() as conn:
        cur = dict_cursor(conn)
        cur.execute("SELECT auto_enabled, cc FROM maintenance_escalation_config WHERE id=1")
        cfg = cur.fetchone() or {}
        if not cfg.get("auto_enabled"):
            return 0
        cc = _emails(cfg.get("cc"))
        cur.execute("""SELECT id, seq, role_label, after_minutes, emails
                         FROM maintenance_escalation_level
                        WHERE enabled = TRUE ORDER BY seq, id""")
        levels = [dict(r) for r in cur.fetchall()]
        if not levels:
            return 0
        # Khuli maintenance calls + kitne minute ho gaye (DB ki apni ghadi se —
        # app aur DB ki clock alag ho to bhi hisaab sahi rehta).
        cur.execute("""
            SELECT e.id, e.zone, e.line, e.machine_no, e.started_at,
                   FLOOR(EXTRACT(EPOCH FROM (NOW() - e.started_at))/60)::int AS mins
              FROM andon_system e
              LEFT JOIN andon_departments dep ON dep.id = e.department_id
             WHERE e.state = 'OPEN'
               AND REPLACE(LOWER(TRIM(COALESCE(dep.name, e.display_name))), ' ', '') = 'maintenance'
               AND e.started_at IS NOT NULL
        """)
        calls = [dict(r) for r in cur.fetchall()]
        cur.execute("SELECT andon_event_id, level_id FROM maintenance_escalation_log")
        done = {(r["andon_event_id"], r["level_id"]) for r in cur.fetchall()}

    if not calls:
        return 0
    sent = 0
    from routers.mailer import _send_email
    for c in calls:
        for lv in levels:
            if c["mins"] < lv["after_minutes"]:
                continue
            if (c["id"], lv["id"]) in done:
                continue
            to = _emails(lv["emails"])
            if not to:
                continue
            started = c["started_at"].strftime("%d/%m/%Y %I:%M %p") if c["started_at"] else "-"
            html = _mail_html(role=lv["role_label"], zone=c["zone"], line=c["line"],
                              machine=c["machine_no"], minutes=c["mins"], started=started)
            subject = (f"BREAKDOWN {c['mins']} min - "
                       f"{c['line'] or c['zone'] or 'Line'} ({lv['role_label']})")
            ok, err = True, None
            try:
                _send_email(subject, html, to, cc)
            except Exception as ex:
                ok, err = False, str(ex)[:300]
            # Log HAMESHA likho — fail hone par bhi.  Warna SMTP kharab hone par
            # har 30 second me wahi mail dobara try hota rahega (mail-bomb).
            try:
                with get_conn() as conn2:
                    cur2 = conn2.cursor()
                    cur2.execute("""INSERT INTO maintenance_escalation_log
                        (andon_event_id, level_id, role_label, zone, line, machine_no,
                         minutes, to_emails, ok, err)
                        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                        ON CONFLICT (andon_event_id, level_id) DO NOTHING""",
                        (c["id"], lv["id"], lv["role_label"], c["zone"], c["line"],
                         c.get("machine_no"), c["mins"], ", ".join(to), ok, err))
                    conn2.commit()
            except Exception as ex:
                print(f"[BD-MAIL] log likhne me dikkat: {ex}")
            if ok:
                sent += 1
                print(f"[BD-MAIL] call {c['id']} {c['mins']}min -> {lv['role_label']} ({', '.join(to)})")
            else:
                print(f"[BD-MAIL] call {c['id']} -> {lv['role_label']} FAIL: {err}")
    return sent


def escalation_worker():
    """Daemon thread (main.py se chalu).  Har 30s me dekhta hai.
    Best-effort — koi dikkat aaye to sirf log, thread kabhi marta nahi."""
    import time
    time.sleep(20)          # backend theek se boot ho jaye
    while True:
        try:
            _escalate_once()
        except Exception as ex:
            print(f"[BD-MAIL] worker: {ex}")
        time.sleep(30)
