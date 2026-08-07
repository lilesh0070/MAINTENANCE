# Maintenance MES — Toyota Boshoku Device India (Bawal)

Maintenance department ka standalone system — ANDON, Breakdown Slip, PM, Machine DMC,
Spare, Skill & Training, KPI.

**Ports:** Backend `8892` · Frontend `9965` · ANDON ESP ingest `9000`
**Database:** PostgreSQL — `maintenance_db` (apni alag DB, kisi aur system se saanjhi nahi)

---

## Pehli baar chalane ke liye

### Windows
```
INSTALL.bat          REM ek baar — venv + pip + npm install
copy Phase2\.env.example Phase2\.env
REM .env me DB_PASS aur JWT_SECRET_KEY bhar dein
START.bat            REM sab chalu
```

### Linux / Ubuntu
```bash
sudo apt update && sudo apt install -y python3 python3-venv python3-pip nodejs npm lsof
./install.sh                                   # ek baar
cp Phase2/.env.example Phase2/.env             # DB_PASS + JWT_SECRET_KEY bharein
./start.sh
```

Phir browser me **http://localhost:9965**

Band karne ke liye: `STOP.bat` (Windows) ya `./stop.sh` (Linux)

> `.env` git me nahi jaati (usme password hai).  Isliye har nayi machine par
> `.env.example` se nakal banani padti hai.  `JWT_SECRET_KEY` zaroor bharein —
> na bharne par har restart pe sabke session log-out ho jaate hain:
> `python -c "import secrets; print(secrets.token_urlsafe(48))"`

---

## Kya-kya hai

| Module | Kaam |
|---|---|
| **ANDON** | ESP32 (raw-TCP `:9000`) se live breakdown call — ON / acknowledge / OFF |
| **Breakdown Slip** | ANDON se **auto** slip, aur manual slip — dono ka register + history |
| **PM** | Yearly PM schedule (week-wise plan/actual) + fillable check sheet |
| **Machine DMC** | Daily machine check — operator fill → supervisor verify → weekly → NG point |
| **Spare** | Spare consumption (slip + log book + PM se) aur spare master |
| **Log Book / History Card** | Machine-wise maintenance history |
| **Skill & Training** | OJT, Skill Matrix, Org Chart |
| **KPI** | MTTR / MTBF / availability, FY-wise target ke saath |
| **Deviation** | Online Deviation Form (24h me fix na ho paane par) |
| **Admin Panel** | KPI Targets · PM Check Sheet · Machine DMC · Users |

---

## Dhanche ki baat

```
Phase2/                FastAPI backend (psycopg2, connection pool)
  main.py              app + startup migrations (tables idempotent bante hain)
  auth.py              JWT login, role + per-page permission
  routers/             har module ka apna router
mes-frontend/          React 19 + Vite
  src/pages/           har screen
  src/context/         auth + display
```

Frontend `/api/*` ko Vite proxy ke through backend par bhejta hai
(`vite.config.js`), isliye dev me CORS ki zaroorat nahi.

### Database

Saari tables `maintenance_db` me hain — naam ka dhancha:

* `andon_*` — ANDON
* `machine_dmc*` — DMC
* `maintenance_*` — baaki sab (slip, PM, plan, spare, KPI, user, audit)
* `pm_*` — PM mail / schedule

Tables **apne aap ban jaati hain** backend start hone par — alag se koi SQL
chalane ki zaroorat nahi.  Sirf khaali database bana kar `.env` me uska naam
de dein.

---

## Pehli baar login

Nayi DB par koi user nahi hota.  Ek admin banane ke liye:

```bash
cd Phase2
./.venv/bin/python -c "
from dotenv import load_dotenv; load_dotenv()
from database import DB_CONFIG
from auth import hash_password
import psycopg2
c = psycopg2.connect(**DB_CONFIG); c.autocommit = True
c.cursor().execute(
    \"INSERT INTO maintenance_users (username, password_hash, role, full_name) \"
    \"VALUES (%s, %s, 'admin', 'Administrator') ON CONFLICT (username) DO NOTHING\",
    ('admin', hash_password('admin')))
print('admin bana diya')"
```

(Windows par `.venv\Scripts\python.exe` use karein.)

---

## ESP32 (ANDON)

ESP32-S3-POE-ETH board raw TCP par `:9000` pe newline-JSON bhejta hai
(seq/ack ke saath, taaki koi event chhoot na jaye).  Har ESP ka IP
`andon_esp_devices` me register hota hai — Admin se ANDON Management page par.

Ek IP / ek naam sirf ek hi ESP ko mil sakta hai; dobara dene par saaf error
aata hai.
