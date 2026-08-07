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

const api = {
  async get(path, token) {
    const r = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
    return r.json();
  },
};

const fmtDate = (d) => (d ? String(d).slice(0, 10) : "—");
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

export default function BDHistory() {
  const { token, theme, user } = useAuth();
  const nav = useNavigate();
  const [rows, setRows]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ]         = useState("");
  const [period, setPeriod] = useState("7");   // days window — default last 7 days
  const [years, setYears]   = useState([]);
  const [fFy, setFFy]       = useState("");
  const [fMonth, setFMonth] = useState("");
  const [fZone, setFZone]   = useState("");
  const [fLine, setFLine]   = useState("");
  const [fMachineNo, setFMachineNo]     = useState("");
  const [fMachineName, setFMachineName] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Source = maintenance_breakdown_data — the SAME table the Maintenance KPI /
      // MTTR-MTBF pages compute from, so counts always match.
      // Only the selected window is fetched (default: last 7 days) so the
      // page stays light on a continuously running site.
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
      } else if (period !== "all") {
        qs.set("days", period);
      }
      const r = await api.get(`/api/breakdowns/log?${qs.toString()}`, token);
      const bd = (r?.rows || [])
        .filter((x) => x.bd_date)
        .map((x) => ({ ...x, zone_name: x.zone_code, line_name: x.line_code }));
      setRows(bd);
    } catch { setRows([]); }
    finally { setLoading(false); }
  }, [token, period, fFy]);
  useEffect(() => { load(); }, [load]);

  // FY list + Machine Master List (maintenance_machines — the single master for
  // every filter across the app).
  const [master, setMaster] = useState([]);
  useEffect(() => {
    if (!token) return;
    api.get("/api/maintenance-kpi/financial-years", token).then((y) => setYears(Array.isArray(y) ? y : [])).catch(() => setYears([]));
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
  const onFy = (v) => { setFFy(v); setFMonth(""); autoMonth.current = !!v; };
  useEffect(() => {
    if (!autoMonth.current || !fFy || rows.length === 0) return;
    const months = [...new Set(rows.map((r) => String(r.bd_date).slice(0, 7)))].sort();
    if (months.length) { setFMonth(months[months.length - 1]); autoMonth.current = false; }
  }, [rows, fFy]);

  const clearFilters = () => { autoMonth.current = false; setPeriod("7"); setFFy(""); setFMonth(""); setFZone(""); setFLine(""); setFMachineNo(""); setFMachineName(""); setQ(""); };

  const filtered = rows.filter((r) => {
    const d = r.bd_date ? String(r.bd_date).slice(0, 10) : "";
    if (fFy) { const w = fyWindow(fFy); if (w && !(d >= w.start && d < w.end)) return false; }
    if (fMonth && d.slice(0, 7) !== fMonth) return false;
    if (fZone && r.zone_name !== fZone) return false;
    if (fLine && r.line_name !== fLine) return false;
    if (fMachineNo && r.machine_no !== fMachineNo) return false;
    if (fMachineName && r.machine_name !== fMachineName) return false;
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
        .bh-card { background:#fff; border:1px solid #e2e8f0; border-radius:12px; overflow:hidden;
                   box-shadow:0 1px 4px rgba(15,23,42,.06); }
        .bh-card-head { background:#0f172a; color:#fff; font-weight:800; font-size:13px;
                        letter-spacing:.08em; text-transform:uppercase; padding:13px 20px;
                        display:flex; align-items:center; justify-content:space-between; }
        .bh-count { font-size:11px; font-weight:600; color:#94a3b8; letter-spacing:.04em; }
        .bh-table { width:100%; border-collapse:collapse; font-size:13px; }
        .bh-table th { text-align:left; padding:10px 12px; font-size:10px; font-weight:700; letter-spacing:.06em;
                       text-transform:uppercase; color:#64748b; border-bottom:2px solid #e2e8f0; white-space:nowrap; }
        .bh-table td { padding:9px 12px; border-bottom:1px solid #f1f5f9; color:#334155; white-space:nowrap; }
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
            {user?.username && <span style={{ fontSize:12, color:"#64748b", fontWeight:600 }}>{user.username}</span>}
          </div>
        </div>

        <div className="bh-body">
          {/* filter bar — same style as the Maintenance KPI page */}
          <div className="bh-filters">
            <div className="bh-fld">
              <label>Period</label>
              <select className="bh-sel" value={period} onChange={(e) => setPeriod(e.target.value)} disabled={!!fFy}
                      title={fFy ? "Financial Year selected — period follows the FY" : ""}>
                <option value="7">Last 7 Days</option>
                <option value="15">Last 15 Days</option>
                <option value="30">Last 1 Month</option>
                <option value="120">Last 4 Months</option>
                <option value="365">Last 1 Year</option>
                <option value="all">All</option>
              </select>
            </div>
            <div className="bh-fld">
              <label>Financial Year</label>
              <select className="bh-sel" value={fFy} onChange={(e) => onFy(e.target.value)}>
                <option value="">All Financial Years</option>
                {years.map((y) => <option key={y.fy} value={y.fy}>{y.fy}{y.is_current ? "  (current)" : ""}</option>)}
              </select>
            </div>
            <div className="bh-fld">
              <label>Month</label>
              <select className="bh-sel" value={fMonth} onChange={(e) => setFMonth(e.target.value)} disabled={!fFy}>
                <option value="">All Months</option>
                {monthOpts.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
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
              <label>&nbsp;</label>
              <button className="bh-back" style={{ padding:"9px 16px" }} onClick={clearFilters}>✕ Clear</button>
            </div>
          </div>

          <div className="bh-card">
            <div className="bh-card-head">
              <span>Breakdown History</span>
              <span className="bh-count">{filtered.length} {filtered.length === 1 ? "entry" : "entries"}</span>
            </div>
            <div style={{ overflowX:"auto" }}>
              {loading ? (
                <div className="bh-empty">Loading…</div>
              ) : filtered.length === 0 ? (
                <div className="bh-empty">No breakdown entries yet.</div>
              ) : (
                <table className="bh-table">
                  <thead>
                    <tr>{["Date","Shift","Zone","Line","M/C No","Machine","Nature","Time (min)","Attended By","Category"]
                      .map((h, i) => <th key={i}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {filtered.map((r) => (
                      <tr key={r.id}>
                        <td>{fmtDate(r.bd_date)}</td>
                        <td>{r.shift || "—"}</td>
                        <td>{r.zone_name || "—"}</td>
                        <td>{r.line_name || "—"}</td>
                        <td>{r.machine_no || "—"}</td>
                        <td>{r.machine_name || "—"}</td>
                        <td>{r.nature_of_work || "—"}</td>
                        <td>{r.solve_time_min || "—"}</td>
                        <td>{r.attended_by || "—"}</td>
                        <td>{r.category || "—"}</td>
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
