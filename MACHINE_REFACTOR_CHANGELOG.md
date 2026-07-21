# Machine Master Refactor — Change Log (for main-MES integration)

**Goal:** Each machine in a line now has a per-line **`serial_no`** (integer, unique per line — this is what used to be the integer `machine_no`) AND a string **`machine_no`** code (e.g. `Y17_SS_01`). The `mes_machines` master was replaced from `MACHINE_LIST.xlsx`. The breakdown slip now has a **Serial No.** field that auto-fills **Machine No. (code)** + **Machine Name**.

This file is the single source of truth to replay the same change in the main MES. Each section lists: what changed, old → new, and exact SQL / file edits.

---

## 0. Data model summary

`mes_machines` (master):

| column | before | after |
|---|---|---|
| `serial_no` | — (did not exist) | **INTEGER**, per-line 1..N, unique within (zone, line). The per-line number that used to live in `machine_no`. |
| `machine_no` | INTEGER (per-line 1,2,3) | **VARCHAR(60)** = the machine **code** (e.g. `Y17_SS_01`) |
| `machine_name` | text | text (unchanged) |
| `zone_name`, `line_name` | text | text (unchanged) |

Rule of thumb: anywhere a **per-line integer** machine number was used → now `serial_no`. The **identifier code** → `machine_no`.

---

## 1. mes_machines table — replaced from MACHINE_LIST.xlsx  ✅
- Backup of the old 285 rows: `mes_machines_backup_<ts>.csv` + `.sql` (at repo root).
- Schema migration + reload (run once, in a transaction):
```sql
DELETE FROM mes_machines;
ALTER TABLE mes_machines ALTER COLUMN machine_no   TYPE VARCHAR(60);
ALTER TABLE mes_machines ALTER COLUMN machine_name TYPE VARCHAR(160);
ALTER TABLE mes_machines ADD COLUMN IF NOT EXISTS serial_no INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS uq_machine_serial
  ON mes_machines (zone_name, line_name, serial_no);
-- then INSERT one row per Excel machine
```
- **Mapping (MACHINE_LIST.xlsx → mes_machines):** `zone_name←zone`, `line_name←line`,
  `serial_no←` per-line row index 1..N (re-sequenced for uniqueness; Excel `Serial_no`
  had 2 duplicate lines + nulls), `machine_no←` Excel `machine_no` **code** (e.g. `Y17_SS_01`;
  if blank, synthesized `{line}_{NN}`), `machine_name←` Excel `machine_name` (**if blank, the
  code is used**), `is_active=TRUE`.
- Result: **286 machines**, 16 zones, 0 duplicate `(zone,line,serial_no)`.
- Heads-up: `mes_machine_processes` (1 row) and `mes_machine_process_log` (59,390 rows)
  reference machine **id**; after the master replace those historical ids no longer map to a
  current machine. Expected for a master swap.

## 2. routers/machines.py  ✅
- `GET /api/machines/by-line/{line_id}` and `GET /api/machines/` now SELECT and return
  **`serial_no`** alongside `machine_no` (code) + `machine_name`, and `ORDER BY serial_no`.
- `GET /api/machines/lookup?line_id=X&no=N` — `no` now means **serial_no**; it looks up by
  `serial_no` and returns `serial_no, machine_no (code), machine_name`.
- **`_resolve_nf2_line` made separator/case-insensitive** (new `_norm()` helper, `import re`).
  The master replace changed line names from display style ('YNC Seat Slider') to code style
  ('YNC_SS'), which broke the old exact `nf2_line_name` match. The resolver now normalizes
  (strip non-alphanumerics, lowercase) and matches zone + line by (1) exact-normalized then
  (2) unambiguous first-token prefix — so 'YNC-SS'↔'YNC_SS' and 'Seat Slider'↔'SEAT_SLIDER'
  resolve. Verified: all MES lines (YNC-SS→YNC_SS 9, YSD-SS→YSD_SS 8, YRA Recliner→YRA_RC 7).
- **Main-MES note:** alternatively (or additionally) set each `mes_lines.nf2_line_name` to the
  exact new master line code for a deterministic match.

## 3. Breakdown slip (MaintenanceDashboard.jsx)  ✅
ClosureFormModal (production half):
- Added `"serial_no"` to `PROD_FIELDS`; added `serial_no` to the form `data` init
  (`prod.serial_no ?? legacy.serial_no ?? ""`).
- Renamed the old `setMachineNo` (which matched an INTEGER machine_no) to **`setSerialNo`**:
  parses the typed number, finds `machines.find(m => m.serial_no === n)`, and auto-fills
  **`machine_no` (the code)** + **`machine_name`**.
- Form cells: the old "MACHINE NO." (type=number, auto-fill driver) is now **"SERIAL NO."**
  (drives auto-fill). Added a separate **"MACHINE NO."** cell (text) that shows the auto-filled
  code (still manually editable as a fallback). "MACHINE NAME" unchanged.
- **routers/breakdowns.py — NO change needed:** `production_data` is stored whole as JSONB
  (`SET production_data = %s` with `Json(...)`), and `subsetForPhase()` already sends every
  `PROD_FIELDS` key — so `serial_no` persists automatically alongside `machine_no` (code) +
  `machine_name`. Downstream stats group by `production_data->>'machine_no'` (text) → now the code.
- **`mes_breakdown_log` NOT modified:** it's the historical breakdown register (populated from
  imports, not the live form); its `machine_no` is already TEXT. serial_no lives in
  `mes_breakdowns.production_data`. (Add a `serial_no` column here later only if the main MES
  syncs live breakdowns into that register.)

## 4. KPI Target (routers/maintenance_kpi_target.py + KpiTargetsPage)  ✅
- Table `maintenance_kpi_target`: machine identity changed from `machine_no INTEGER` to
  **`serial_no INTEGER` + `machine_no VARCHAR(60)` (code) + `machine_name`**. Unique index
  now `(fy, zone_name, COALESCE(line_name,''), COALESCE(serial_no,0))`. (0 rows → dropped+recreated.)
- Router: `TargetIn` adds `serial_no` (int) and `machine_no` is now a string (code);
  `_level_of`/`_validate`/upsert key use **serial_no** (MACHINE level needs serial_no + line).
- Frontend `KpiTargetsPage` (AdminPanel.jsx): form's machine dropdown is now **value=serial_no**
  (label "No. {serial} — {name} ({code})"); on save it stores `serial_no` + `machine_no` (code)
  + `machine_name` looked up from the master list. Saved table shows `S.No {serial} · {name} · ({code})`.
- Verified: ZONE/LINE/MACHINE round-trip (machine stores serial=1, code=Y17_SS_01), upsert by
  serial, serial-without-line rejected.

### 4b. Per-KPI targets + 3-tab UI (later change)
- **`kpi_key VARCHAR(40)` added** to `maintenance_kpi_target`; each target is now per-KPI.
  Unique key swapped to `(fy, zone_name, COALESCE(line_name,''), COALESCE(serial_no,0), kpi_key)`
  — index renamed **`uq_mkt` → `uq_mkt_kpi`** (bootstrap does `ALTER ADD COLUMN kpi_key` +
  `DROP INDEX IF EXISTS uq_mkt` + create `uq_mkt_kpi`, so existing DBs auto-migrate on restart).
- Router `TargetIn` gains `kpi_key`; `_validate` requires it; list/insert/upsert/update include it;
  upsert key is now `(fy, zone, line, serial_no, kpi_key)`.
- Frontend `KpiTargetsPage` redesigned to **3 tabs — Zone / Line / Machine** (`MKT_TABS`). The
  active tab sets the scope (Zone tab: Zone only; Line: Zone+Line; Machine: Zone+Line+Machine(Serial)),
  plus a **KPI** dropdown (`MKT_KPIS` = the 6 maintenance KPIs) + Target value. Each tab lists only
  its own saved rows (`rows.filter(level===tab)`) with columns `FY · Zone [· Line] [· Machine] · KPI · Target`.
- **NOTE:** live table migration + round-trip NOT yet verified — the plant DB (192.168.10.210)
  was unreachable during this change. On next backend restart with the DB up, the bootstrap
  auto-applies the kpi_key column + index swap.

## 5. Fresh-install DDL (main.py bootstrap + maintenance_schema.sql)  ✅
- `main.py` `CREATE TABLE IF NOT EXISTS mes_machines`: `machine_no INTEGER NOT NULL` →
  **`serial_no INTEGER` + `machine_no VARCHAR(60)`**, `machine_name` widened to 160,
  `UNIQUE(zone_name,line_name,serial_no)`, lookup index now on `serial_no`.
- Added safe startup migrations for older DBs: `ADD COLUMN IF NOT EXISTS serial_no` +
  `CREATE UNIQUE INDEX uq_machine_serial`.
- **NOT auto-run:** `ALTER COLUMN machine_no TYPE VARCHAR(60)` (ALTER TYPE takes an
  AccessExclusive lock that can hang behind the collector). Run it **once, manually** on the
  main MES:
  ```sql
  ALTER TABLE mes_machines ALTER COLUMN machine_no   TYPE VARCHAR(60) USING machine_no::text;
  ALTER TABLE mes_machines ALTER COLUMN machine_name TYPE VARCHAR(160);
  ```
  (then re-sequence serial_no per (zone,line) and load the codes — see §1.)
- `maintenance_schema.sql` mes_machines definition updated to match.

---

## MAIN-MES INTEGRATION — one-shot recipe
1. `mes_machines`: add `serial_no INTEGER`; `machine_no` → `VARCHAR(60)`; widen `machine_name`;
   `UNIQUE(zone_name,line_name,serial_no)`. Load MACHINE_LIST.xlsx with the §1 mapping.
2. `routers/machines.py`: return/sort by `serial_no`; `/lookup` by serial_no → code+name;
   normalize `_resolve_nf2_line` (or set each `mes_lines.nf2_line_name` to the new line code).
3. Breakdown slip: add **SERIAL NO.** field that auto-fills **MACHINE NO. (code)** + **MACHINE NAME**
   from `/api/machines/by-line` (match on `serial_no`); include `serial_no` in `production_data`.
4. KPI Target: `serial_no` + `machine_no` (code) + `machine_name`; key by serial_no.
5. Nothing else changes — CAPA/PM/Quality/filters consume `machine_no` as free-form text.

## 6. Unaffected (intentionally NOT changed)
- `routers/capa.py`, `pm.py`, `pm_mail.py`, `quality.py` and frontend filters
  (`MaintenanceCAPA/Deviations/Historical.jsx`, `DeviationForm.jsx`, `PMPanel.jsx`,
  `MaintenancePokaYoke.jsx`) use `machine_no` as **free-form text copied from the
  breakdown `production_data`**, not `mes_machines.machine_no`. They keep working — the
  breakdown now writes the **code** string into that same text field.
