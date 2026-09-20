/* ───────────────────────────────────────────────────────────────────
 * BDHistory.jsx
 * ───────────────────────────────────────────────────────────────────
 * "BD History" — read-only history of the Manual Break Down Slips, shown in
 * the same table format as the Log Book → List view.  Source:
 * /api/breakdowns/log (→ maintenance_breakdown_data, the table the Break Down Slip
 * saves into).  This is a SEPARATE register from the Log Book / History Card
 * (those read maintenance_logbook_db_history).
 *
 * Routing: /maintenance-breakdown/bd-history
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { onlyProdZones } from "../constants/zones";
import SheetPrintBtn from "../components/SheetPrintBtn";
import ExcelBtn from "../components/ExcelBtn";
import { aajKaNaam, tableReportCss } from "../constants/sheetTools";

const api = {
  async get(path, token) {
    const r = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
    return r.json();
  },
};

const fmtDate = (d) => (d ? String(d).slice(0, 10) : "—");
const pad2 = (n) => String(n).padStart(2, "0");
/* Aaj ki tareekh LOCAL time me.  `toISOString()` jaan-boojh kar nahi --
   wo UTC me badal deta hai aur IST me 05:30 se pehle ek din PICHHE chala
   jaata hai (yahi galti Historical page par pakdi ja chuki hai). */
const aajISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
/* "2026-09" -> "2026-09-30" (us mahine ka aakhri din) */
const mahineKaAnt = (ym) => {
  const [y, m] = String(ym).split("-").map(Number);
  return y && m ? `${ym}-${pad2(new Date(y, m, 0).getDate())}` : "";
};
const MON = ["", "January", "February", "March", "April", "May", "June", "July",
             "August", "September", "October", "November", "December"];
function fyWindow(fy) {
  const y = parseInt(String(fy).split("-")[0], 10);
  if (isNaN(y)) return null;
  return { start: `${y}-04-01`, end: `${y + 1}-04-01` };
}
function fyMonths(fy) {
  const y = parseInt(String(fy).split("-")[0], 10);
  if (isNaN(y)) return [];
  const out = [];
  for (let i = 0; i < 12; i++) {
    const mo = ((3 + i) % 12) + 1;
    const yr = mo >= 4 ? y : y + 1;
    out.push({ value: `${yr}-${String(mo).padStart(2, "0")}`, label: `${MON[mo].slice(0, 3)} ${yr}` });
  }
  return out;
}

// BD History table = Break Down Slip ke SAARE column (maintenance_breakdown_data).
// /api/breakdowns/log inhe aliased naam se already deta hai — yahan bas dikhate hain.
// [header, (row) => value]  — order slip ke flow jaisa (production → maintenance → sign).
// Header = actual DB column naam (maintenance_breakdown_data), order user ke sequence me.
const COLUMNS = [
  // ── User ka kram (2026-09-20).  Naam koi nahi badla -- sirf kram. ──
  ["shift",                              (r) => r.shift],
  ["zone",                               (r) => r.zone_name],
  ["line",                               (r) => r.line_name],
  ["machine_no",                         (r) => r.machine_no],
  ["machine_name",                       (r) => r.machine_name],
  ["slip_date",                          (r) => fmtDate(r.bd_date)],
  ["problem_reported_by_production",     (r) => r.problem_production, "txt"],
  ["problem_observed_by_maintenance",    (r) => r.problem_maintenance, "txt"],
  ["action_taken_on_problem",            (r) => r.action_taken, "txt"],
  ["bd_start_time",                      (r) => r.bd_start_time],
  ["bd_received_time",                   (r) => r.bd_received_time],
  ["response_time_minutes",              (r) => r.bd_response_time],
  ["bd_ok_time",                         (r) => r.bd_ok_time],
  ["mc_down_time_minutes",               (r) => r.solve_time_min],
  ["spares_used",                        (r) => r.spares_detail, "txt"],
  ["bd_attended_by",                     (r) => r.attended_by],
  ["problem_related_to",                 (r) => r.problem_related_to, "txt"],
  ["category",                           (r) => r.category],
  // ── uske baad baaki sab ──
  ["model_no",                           (r) => r.model_no],
  ["line_leader_name",                   (r) => r.line_leader_name],
  ["machine_operator_name",              (r) => r.machine_operator_name],
  ["bd_start_date",                      (r) => fmtDate(r.bd_start_date)],
  ["bd_end_date",                        (r) => fmtDate(r.bd_end_date)],
  ["frequency",                          (r) => r.frequency],
  ["type_electrical / type_mechanical",  (r) => r.type_of_problem],
  ["prepared_by_name",                   (r) => r.prepared_by],
  ["received_by_name",                   (r) => r.received_by],
  ["line_leader_operator_name",          (r) => r.line_leader_operator],
  ["quality_engineer_name",              (r) => r.quality_engineer],
];

export default function BDHistory() {
  const { token, theme, user } = useAuth();
  const nav = useNavigate();
  const [rows, setRows]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ]         = useState("");
  const [years, setYears]   = useState([]);
  const [fFy, setFFy]       = useState("");
  const [fMonth, setFMonth] = useState("");
  // Din wala filter -- page khulte hi AAJ ka din.  Khali karte hi poora
  // mahina/FY dikhne lagta hai (user ne yahi maanga: "clear karke sab").
  const [fDate, setFDate]   = useState(aajISO());
  const [fZone, setFZone]   = useState("");
  const [fLine, setFLine]   = useState("");
  const [fMachineNo, setFMachineNo]     = useState("");
  const [fMachineName, setFMachineName] = useState("");
  const [fCat, setFCat]                 = useState("");   // A / B (slip ka B/D category)

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Source = maintenance_breakdown_data — the SAME table the Maintenance KPI /
      // MTTR-MTBF pages compute from, so counts always match.
      // FY chuni ho to sirf USI saal ki qatarein aati hain.  FY khali ho
      // (yaani user ne Clear dabaya) to SAB aata hai -- "Last 7 Days" wala
      // period filter hata diya gaya hai, user ko poora register chahiye.
      const qs = new URLSearchParams({ limit: "3000" });
      if (fFy) {
        const w = fyWindow(fFy);                     // FY selected → load that FY
        if (w) {
          const end = new Date(w.end + "T00:00:00");
          end.setDate(end.getDate() - 1);            // inclusive upper bound
          // format in LOCAL time (toISOString would shift a day back in IST)
          const dt = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
          qs.set("date_from", w.start);
          qs.set("date_to", dt);
        }
      }
      const r = await api.get(`/api/breakdowns/log?${qs.toString()}`, token);
      const bd = (r?.rows || [])
        .filter((x) => x.bd_date)
        .map((x) => ({ ...x, zone_name: x.zone_code, line_name: x.line_code }));
      setRows(bd);
    } catch { setRows([]); }
    finally { setLoading(false); }
  }, [token, fFy]);
  useEffect(() => { load(); }, [load]);

  // FY list + Machine Master List (maintenance_machines — the single master for
  // every filter across the app).
  const [master, setMaster] = useState([]);
  const booted = useRef(false);   // default the FY to the current one, once
  useEffect(() => {
    if (!token) return;
    api.get("/api/maintenance-kpi/financial-years", token).then((y) => {
      const list = Array.isArray(y) ? y : [];
      setYears(list);
      if (!booted.current && list.length) {
        booted.current = true;
        const cur = (list.find((v) => v.is_current) || list[list.length - 1]).fy;
        setFFy(cur);
        // Month default = abhi ka current month (agar wo current FY me aata ho).
        const now = new Date();
        const cm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
        if (fyMonths(cur).some((m) => m.value === cm)) setFMonth(cm);
      }
    }).catch(() => setYears([]));
    api.get("/api/machines/", token).then((m) => setMaster(Array.isArray(m) ? m : [])).catch(() => setMaster([]));
  }, [token]);

  const zoneOpts = useMemo(() => onlyProdZones([...new Set(master.map((m) => m.zone_name).filter(Boolean))]), [master]);
  const lineOpts = useMemo(() => fZone
    ? [...new Set(master.filter((m) => m.zone_name === fZone).map((m) => m.line_name).filter(Boolean))].sort() : [], [master, fZone]);
  const machineNoOpts = useMemo(() => (fZone && fLine)
    ? [...new Set(master.filter((m) => m.zone_name === fZone && m.line_name === fLine)
                        .map((m) => m.machine_no).filter(Boolean))].sort() : [], [master, fZone, fLine]);
  const machineNameOpts = useMemo(() => (fZone && fLine)
    ? [...new Set(master.filter((m) => m.zone_name === fZone && m.line_name === fLine)
                        .map((m) => m.machine_name).filter(Boolean))].sort() : [], [master, fZone, fLine]);
  const monthOpts = useMemo(() => fFy ? fyMonths(fFy) : [], [fFy]);
  const onZone = (v) => { setFZone(v); setFLine(""); setFMachineNo(""); setFMachineName(""); };
  const onLine = (v) => { setFLine(v); setFMachineNo(""); setFMachineName(""); };

  // When an FY is picked, default the Month to that FY's LATEST month with
  // data (so the whole year isn't dumped at once).  The user can still pick
  // "All Months" or any other month manually afterwards.
  const autoMonth = useRef(false);
  // Print/PDF ke liye card ka pata.
  const cardRef = useRef(null);
  const onFy = (v) => { setFFy(v); setFMonth(""); setFDate(""); autoMonth.current = !!v; };
  /* Mahina badla aur chuna hua din us mahine ka nahi -- to din hata do.
     Warna table khali dikhti hai aur wajah kahin likhi nahi hoti. */
  const onMonth = (v) => { setFMonth(v); if (fDate && v && fDate.slice(0, 7) !== v) setFDate(""); };
  useEffect(() => {
    if (!autoMonth.current || !fFy || rows.length === 0) return;
    const months = [...new Set(rows.map((r) => String(r.bd_date).slice(0, 7)))].sort();
    if (months.length) { setFMonth(months[months.length - 1]); autoMonth.current = false; }
  }, [rows, fFy]);

  const clearFilters = () => { autoMonth.current = false; setFFy(""); setFMonth(""); setFDate("");
    setFZone(""); setFLine(""); setFMachineNo(""); setFMachineName(""); setFCat(""); setQ(""); };

  const filtered = rows.filter((r) => {
    const d = r.bd_date ? String(r.bd_date).slice(0, 10) : "";
    if (fFy) { const w = fyWindow(fFy); if (w && !(d >= w.start && d < w.end)) return false; }
    if (fMonth && d.slice(0, 7) !== fMonth) return false;
    if (fDate && d !== fDate) return false;
    if (fZone && r.zone_name !== fZone) return false;
    if (fLine && r.line_name !== fLine) return false;
    if (fMachineNo && r.machine_no !== fMachineNo) return false;
    if (fMachineName && r.machine_name !== fMachineName) return false;
    // DB me ek qatar "B  " (peechhe space) bhi padi hai -- trim kiye bina
    // wo B ke filter me aati hi nahi.  (Naapa: A 322, B 19, "B  " 1.)
    if (fCat && String(r.category ?? "").trim().toUpperCase() !== fCat) return false;
    if (q) {
      const s = q.toLowerCase();
      const hay = [r.zone_name, r.line_name, r.machine_no, r.machine_name, r.attended_by, r.category, r.shift, fmtDate(r.bd_date)]
        .map((x) => String(x ?? "").toLowerCase()).join(" | ");
      if (!hay.includes(s)) return false;
    }
    return true;
  });

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700;800&family=Barlow+Condensed:wght@700;800&display=swap');
        .bh-root { min-height:100vh; background:#eef2f7; font-family:'Barlow',sans-serif; padding-bottom:50px; }
        .bh-top { background:#fff; border-bottom:1px solid #e2e8f0; height:56px; padding:0 28px 0 96px;
                  display:flex; align-items:center; justify-content:space-between;
                  position:sticky; top:0; z-index:50; box-shadow:0 1px 3px rgba(0,0,0,.06); }
        .bh-top::after { content:''; position:absolute; bottom:0; left:0; right:0; height:2px; background:${theme.gradient}; }
        .bh-title { font-family:'Barlow Condensed',sans-serif; font-size:22px; font-weight:800; color:#0f172a; }
        .bh-title span { color:${theme.accent}; }
        .bh-sub { font-size:11px; color:#94a3b8; margin-top:-2px; }
        .bh-back { display:flex; align-items:center; gap:6px; font-size:13px; font-weight:700; color:#475569;
                   background:#f1f5f9; border:1px solid #e2e8f0; border-radius:8px; padding:7px 14px; cursor:pointer; }
        .bh-search { font-size:13px; border:1px solid #cbd5e1; border-radius:9px; padding:8px 13px;
                     min-width:220px; outline:none; }
        .bh-search:focus { border-color:${theme.accent}; box-shadow:0 0 0 3px ${theme.soft}; }
        .bh-body { max-width:1500px; margin:18px auto 0; padding:0 22px; }
        .bh-filters { display:flex; gap:12px; flex-wrap:wrap; align-items:flex-end; margin-bottom:16px; }
        .bh-fld { display:flex; flex-direction:column; gap:5px; }
        .bh-fld label { font-size:10.5px; font-weight:800; letter-spacing:.05em; text-transform:uppercase; color:#64748b; }
        .bh-sel { border:1.5px solid #cbd5e1; border-radius:9px; padding:9px 12px; font-size:13px; font-weight:600;
                  color:#0f172a; outline:none; font-family:'Barlow',sans-serif; background:#fff; min-width:150px; }
        .bh-sel:focus { border-color:${theme.accent}; }
        .bh-sel:disabled { background:#f1f5f9; color:#94a3b8; cursor:not-allowed; }
        /* date input ko baaki dropdown jaisi hi lambai -- warna wo chhota
           reh jaata hai aur pankti tedhi dikhti hai. */
        .bh-date { min-width:150px; }
        .bh-card { background:#fff; border:1px solid #e2e8f0; border-radius:12px; overflow:hidden;
                   box-shadow:0 1px 4px rgba(15,23,42,.06); }
        .bh-card-head { background:#0f172a; color:#fff; font-weight:800; font-size:13px;
                        letter-spacing:.08em; text-transform:uppercase; padding:13px 20px;
                        display:flex; align-items:center; justify-content:space-between; }
        .bh-count { font-size:11px; font-weight:600; color:#94a3b8; letter-spacing:.04em; }
        .bh-table { width:100%; border-collapse:collapse; font-size:13px; }
        .bh-table th { text-align:left; padding:10px 12px; font-size:10.5px; font-weight:700; letter-spacing:.02em;
                       text-transform:none; color:#64748b; border-bottom:2px solid #e2e8f0; white-space:nowrap; }
        .bh-table td { padding:9px 12px; border-bottom:1px solid #f1f5f9; color:#334155; white-space:nowrap;
                       max-width:300px; overflow:hidden; text-overflow:ellipsis; vertical-align:top; }
        /* Lamba likha hua khaana (problem / action / spares): chaudai WAHI
           300px, par text kaat kar "..." nahi -- neeche lipat kar poora
           dikhta hai (user 2026-09-20).  Bina space wala lamba shabd bhi
           khaane se bahar na nikle, isliye break-word. */
        .bh-table td.txt { white-space:normal; overflow:visible; text-overflow:clip;
                           min-width:200px; line-height:1.45; }
        /* Bina space wala lamba shabd khaane se bahar na nikle -- par ye SIRF
           SCREEN par.  Print/PDF ki window page ki saari CSS utha leti hai
           (pageKeStyles), aur wahan shabd todna mana hai: sheetTools me likha
           hai ki ek baar laga kar dekha tha to PDF me "breakdown" ek-ek akshar
           karke khada nikla tha.  Kaagaz par tableReportCss waise bhi
           max-width hata deti hai, to jagah ki kami hoti hi nahi. */
        @media screen { .bh-table td.txt { overflow-wrap:break-word; } }
        .bh-table tr:hover td { background:#f8fafc; }
        .bh-empty { padding:46px; text-align:center; color:#94a3b8; font-size:13px; }
      `}</style>

      <div className="bh-root">
        <div className="bh-top">
          <div style={{ display:"flex", alignItems:"center", gap:14 }}>
            <button className="bh-back" onClick={() => nav("/maintenance-breakdown")}>← Back</button>
            <div>
              <div className="bh-title">BD <span>History</span></div>
              <div className="bh-sub">Breakdown entries from the MES Breakdown Log</div>
            </div>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            <input className="bh-search" placeholder="Search zone / line / machine…"
                   value={q} onChange={(e) => setQ(e.target.value)} />
            {user?.username && <span className="app-user" style={{ fontSize:12, color:"#64748b", fontWeight:600 }}>{user.username}</span>}
          </div>
        </div>

        <div className="bh-body">
          {/* filter bar — same style as the Maintenance KPI page */}
          <div className="bh-filters">
            <div className="bh-fld">
              <label>Financial Year</label>
              <select className="bh-sel" value={fFy} onChange={(e) => onFy(e.target.value)}>
                <option value="">All Financial Years</option>
                {years.map((y) => <option key={y.fy} value={y.fy}>{y.fy}{y.is_current ? "  (current)" : ""}</option>)}
              </select>
            </div>
            <div className="bh-fld">
              <label>Month</label>
              <select className="bh-sel" value={fMonth} onChange={(e) => onMonth(e.target.value)} disabled={!fFy}>
                <option value="">All Months</option>
                {monthOpts.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            <div className="bh-fld">
              <label>Date</label>
              {/* Mahina chuna ho to calendar usi mahine tak simit -- bahar ki
                  tareekh chunne par table khali aati, aur wajah dikhti nahi. */}
              <input type="date" className="bh-sel bh-date" value={fDate}
                     min={fMonth ? `${fMonth}-01` : undefined}
                     max={fMonth ? mahineKaAnt(fMonth) : undefined}
                     onChange={(e) => setFDate(e.target.value)} />
            </div>
            <div className="bh-fld">
              <label>Zone</label>
              <select className="bh-sel" value={fZone} onChange={(e) => onZone(e.target.value)}>
                <option value="">All Zones</option>
                {zoneOpts.map((z) => <option key={z} value={z}>{z}</option>)}
              </select>
            </div>
            <div className="bh-fld">
              <label>Line</label>
              <select className="bh-sel" value={fLine} onChange={(e) => onLine(e.target.value)} disabled={!fZone}>
                <option value="">All Lines</option>
                {lineOpts.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div className="bh-fld">
              <label>Machine No.</label>
              <select className="bh-sel" value={fMachineNo} onChange={(e) => setFMachineNo(e.target.value)} disabled={!fLine}>
                <option value="">All Machine No.</option>
                {machineNoOpts.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div className="bh-fld">
              <label>Machine Name</label>
              <select className="bh-sel" value={fMachineName} onChange={(e) => setFMachineName(e.target.value)} disabled={!fLine}>
                <option value="">All Machine Names</option>
                {machineNameOpts.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div className="bh-fld">
              <label>Category</label>
              {/* Slip par do hi category hain -- "A CATEGORY B/D" aur
                  "B CATEGORY B/D".  Isliye list yahin fixed hai, master se
                  nahi aati (master me machine hoti hai, category nahi). */}
              <select className="bh-sel" value={fCat} onChange={(e) => setFCat(e.target.value)}>
                <option value="">All Categories</option>
                <option value="A">A</option>
                <option value="B">B</option>
              </select>
            </div>
            <div className="bh-fld">
              <label>&nbsp;</label>
              <button className="bh-back" style={{ padding:"9px 16px" }} onClick={clearFilters}>✕ Clear</button>
            </div>
          </div>

          <div className="bh-card" ref={cardRef}>
            <div className="bh-card-head">
              <span>Breakdown History</span>
              <span style={{ display:"flex", alignItems:"center", gap:12 }}>
                <span className="bh-count">{filtered.length} {filtered.length === 1 ? "entry" : "entries"}</span>
                {/* Excel me bhi WAHI qatarein aur WAHI khaane jaate hain jo abhi
                    saamne hain (filter + search ke baad) -- heading bhi wahi
                    `COLUMNS` se, isliye screen aur file kabhi alag nahi hongi.
                    "—" ki jagah Excel me khali khaana. */}
                <ExcelBtn banao={() => ({
                  naam: `Breakdown-History_${aajKaNaam()}`,
                  sheet: "Breakdown History",
                  headers: COLUMNS.map(([h]) => h),
                  rows: filtered.map((r) => COLUMNS.map(([, fn]) => {
                    const v = fn(r);
                    return v === null || v === undefined || v === "—" ? "" : v;
                  })),
                })} />
                {/* Print/PDF me WAHI qatarein jaati hain jo abhi saamne hain
                    (filter + search lagne ke baad).  Card ka heading aur ginti
                    bhi kaagaz par aati hai.  Landscape -- table chaudi hai. */}
                <SheetPrintBtn
                  boxRef={cardRef}
                  naam={`Breakdown-History_${aajKaNaam()}`}
                  css={tableReportCss("bh")}
                  khali={filtered.length === 0}
                  kamSeKam={0.25}
                  style={{ marginBottom: 0 }} />
              </span>
            </div>
            <div style={{ overflowX:"auto" }}>
              {loading ? (
                <div className="bh-empty">Loading…</div>
              ) : filtered.length === 0 ? (
                <div className="bh-empty">No breakdown entries yet.</div>
              ) : (
                <table className="bh-table">
                  <thead>
                    <tr>{COLUMNS.map(([h], i) => <th key={i}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {filtered.map((r) => (
                      <tr key={r.id}>
                        {COLUMNS.map(([, fn], i) => {
                          const v = fn(r);
                          const show = (v === null || v === undefined || v === "") ? "—" : v;
                          return (
                            <td key={i} className={COLUMNS[i][2] === "txt" ? "txt" : undefined}
                                title={show === "—" ? "" : String(show)}>{show}</td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
