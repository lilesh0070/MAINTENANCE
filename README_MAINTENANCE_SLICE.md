# Maintenance Department — Standalone Slice

Extracted from the full EOL/MES project (`Deep`) on 2026-06-18 (rebuilt with latest route changes).
Yeh sirf **Maintenance** department ka UI + uske zaroori backend + DB schema hai.
Code **as-is** copy kiya gaya hai — sirf 2 files ko surgically trim kiya gaya
(neeche "Edited files" dekho). Baaki sab bilkul original jaisa hai.

Ports: **Backend 8892**, **Frontend 9965**.

---

## Quick start — bas 2 batch file (RECOMMENDED)
Root folder mein 3 batch files hain. Pehli baar:
1. **`INSTALL.bat`** double-click karo — backend venv + pip install, frontend npm install. (Python 3.12 + Node.js LTS machine par hone chahiye.)
2. **`START.bat`** double-click karo — backend (:8892) + frontend (:9965) dono alag windows mein chalu, ports pehle free karke.
3. Browser kholo: **http://localhost:9965**
4. Band karne ke liye: **`STOP.bat`** — dono ports (8892, 9965) kill kar deta hai (windows bhi band).

| Batch file | Kaam |
|------------|------|
| `INSTALL.bat` | Saari dependencies install (backend + frontend) — sirf ek baar |
| `START.bat`   | Sab kuch chalu (pehle ports free karta hai) |
| `STOP.bat`    | Sab band / ports free (8892 + 9965) |

---

## Quick start — Linux / Ubuntu
Same repo Linux par bhi chalta hai — bas `.sh` scripts use karo (Windows ke `.bat` ke barabar).

```bash
# 1. one-time system prereqs
sudo apt update && sudo apt install -y python3 python3-venv python3-pip nodejs npm lsof

# 2. clone + per-machine config
git clone https://github.com/lilesh0070/MAINTENANCEDX.git
cd MAINTENANCEDX
cp Phase2/.env.example Phase2/.env      # phir DB_HOST / DB_PASS set karo

# 3. install deps — SIRF EK BAAR (Windows ke INSTALL.bat jaisa)
./install.sh

# 4. run / stop
./start.sh        # backend :8892 + frontend :9965 (logs/ me)
./stop.sh
```

**Portability — kyun clone-and-go kaam karta hai:**
- `.venv/` aur `node_modules/` git me **nahi** hain (gitignored) — ye har OS par `install.sh` se **fresh** ban-te hain. Windows ka venv Linux par chalta hi nahi, isliye copy karne ki koshish mat karna.
- Ek baar `install.sh` chalane ke baad, code changes sirf **`git pull`** se aa jaate hain — **dependencies dobara install karne ki zaroorat nahi** (sirf jab `requirements.txt` / `package.json` badle tab `./install.sh` phir chalao).
- Config `Phase2/.env` me hai (gitignored, per-machine) — DB IP/password har machine par apna.
- Line-endings `.gitattributes` se normalize hain: `.sh` = LF, `.bat` = CRLF — dono OS par sahi chalte hain.
- Frontend relative `/api` use karta hai (Vite proxy → `:8892`), koi hardcoded IP nahi.
- Edge: EOL/video-archive feature (`lines.py`) me kuch Windows paths (`D:\VideoArchive` …) hain jo `VIDEO_ARCHIVE_ROOT` jaise env-var se override ho jaate hain — maintenance slice ke liye zaroori nahi.

---

## Folder structure
```
maintainence/
├─ INSTALL.bat / START.bat / STOP.bat
├─ maintenance_schema.sql   # 50 maintenance tables (schema-only dump)
├─ mes-frontend/            # React + Vite (port 9965)
│  ├─ src/
│  │  ├─ App.jsx            # ✏️ TRIMMED — sirf maintenance routes
│  │  ├─ pages/             # 7 maintenance pages + Login + AdminPanel
│  │  ├─ components/        # shared (SlideNav, Layout, etc.) — as-is
│  │  ├─ context/, api/, assets/
│  │  └─ main.jsx
│  ├─ public/, index.html, vite.config.js, package.json, package-lock.json
└─ Phase2/                  # FastAPI backend (port 8892)
   ├─ main.py               # ✏️ TRIMMED — sirf maintenance routers wired
   ├─ auth.py, database.py, provisioner.py, oee_alarm.py
   ├─ routers/              # 18 routers
   ├─ .env                  # DB + SMTP + API keys (same remote DB)
   ├─ requirements.txt, run.bat, _run_mes_api.bat
   └─ uploads/
```

## Pages included (photo waale 7 + Login + admin)
MaintenanceDashboard, MaintenanceHistorical, MaintenanceCAPA,
MaintenanceDeviations, MaintenancePokaYoke, LogBook (Log Book),
PMPanel (Preventive Maint.), Login, MaintenanceAdminPanel.

## Backend routers included (18)
plants, lines, config, poka_yoke, status_schema, users, zones, departments,
breakdowns, machines, breakdown_mail, operators, maintenance_kpi, capa,
quality, maintenance_logbook, pm, pm_mail  (+ auth from `auth.py`).

## NOT included (dropped — non-maintenance)
Routers: non_production, submachines, reports, manpower, store_dispatch,
shift_calc, kanban, anything_wrong, heijunka, five_s, pdca, cms_sync, wallboard.

### Known minor gaps (cosmetic only)
- **CMS camera grid** (AdminPanel ka camera section) `/cms-api` → port 5555 maangta
  hai; CMS is slice mein nahi hai, to wo section blank/error dega.
- **ManpowerAlertBanner** `/api/manpower/alerts` call karta hai (manpower router
  dropped) → banner empty rahega. Non-fatal.
- SlideNav abhi bhi saare department links dikhata hai (aap ne "as-is" kaha tha),
  par sirf maintenance routes exist karte hain — baaki link `/dashboard` pe bounce.

---

## Database
- Backend abhi **same remote DB** se connect karta hai:
  `192.168.10.210 : 5432 / energydb` (set in `Phase2/database.py`, override via `.env`).
- `maintenance_schema.sql` = sirf 50 maintenance tables ka schema. Fresh/local DB
  ke liye: `psql -h <host> -U postgres -d <newdb> -f maintenance_schema.sql`,
  phir `.env` mein `DB_HOST/DB_NAME/...` naye DB pe point kar dena.

## Manual setup (agar batch use na karna ho)
**Backend (Phase2):**
```
cd Phase2
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
.venv\Scripts\python -m uvicorn main:app --host 0.0.0.0 --port 8892
```
**Frontend (mes-frontend):**
```
cd mes-frontend
npm install
npm run dev        # http://localhost:9965
```

## Ports (FINAL)
| Service  | Port | Kahan set hai |
|----------|------|---------------|
| Frontend | **9965** | `mes-frontend/vite.config.js` → `server.port` |
| Backend  | **8892** | `main.py`, `_run_mes_api.bat`, `run.bat`, `lines.py` self-call, aur `vite.config.js` ka `/api` proxy target |

## Edited files (sirf yeh 2 — baaki sab as-is)
- `mes-frontend/src/App.jsx` — sirf maintenance pages import/route.
- `Phase2/main.py` — sirf maintenance routers ke import/include/scheduler; baaki
  13 routers + unke 3 startup workers hata diye. Har dusri line same.
