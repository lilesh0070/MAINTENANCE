/* ───────────────────────────────────────────────────────────────────
 * TopBreakdowns.jsx  —  Breakdown → Top 10 BD
 * ───────────────────────────────────────────────────────────────────
 * Top-N INDIVIDUAL breakdowns (har manual Break Down Slip = ek row),
 * ranked by DOWN TIME (minutes).  Default = All Zones, so the worst
 * breakdowns of the whole plant surface — naturally spread across zones
 * (e.g. 4 in Seat Slider, 2 in Recliner …).  Filters (FY / Month / Zone /
 * Line / Machine) sirf set ko narrow karte hain; unit hamesha ek breakdown.
 *
 * Data: GET /api/breakdowns/log  (maintenance_breakdown_data — MANUAL slip,
 *       same source as BD History).  AUTO slip yahan nahi aata.
 * Routing: /maintenance-breakdown/top-10
 */
import { useEffect, useMemo, useRef, useState } from "react";
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

const MONTHS = ["January", "February", "March", "April", "May", "June",
                "July", "August", "September", "October", "November", "December"];
function fyMonths(fy) {
  const y = parseInt(String(fy).split("-")[0], 10);
  if (isNaN(y)) return [];
  const out = [];
  for (let i = 0; i < 12; i++) {
    const mo = ((3 + i) % 12) + 1;
    const yr = mo >= 4 ? y : y + 1;
    out.push({ value: `${yr}-${String(mo).padStart(2, "0")}`, label: `${MONTHS[mo - 1].slice(0, 3)} ${yr}` });
  }
  return out;
}

const fmtDate = (d) => (d ? String(d).slice(0, 10) : "—");

// FY + Month se date window (date_from, date_to) — /log ise chahiye.
function dateWindow(fy, month) {
  if (month) {                                   // month = "YYYY-MM"
    const [y, m] = month.split("-").map(Number);
    const last = new Date(y, m, 0).getDate();
    return [`${month}-01`, `${month}-${String(last).padStart(2, "0")}`];
  }
  if (fy) {                                      // poora financial year (Apr → Mar)
    const y = parseInt(String(fy).split("-")[0], 10);
    return [`${y}-04-01`, `${y + 1}-03-31`];
  }
  return [null, null];                           // All FY → no date filter
}

const BAR = "#1f4e79";   // Excel navy (matches Pareto)

export default function TopBreakdowns() {
  const { token, theme, user } = useAuth();
  const nav = useNavigate();
  // ── the single top filter bar (same as the other Breakdown pages) ──
  const [years, setYears]   = useState([]);
  const [master, setMaster] = useState([]);   // Machine Master List rows (maintenance_machines)
  const [fFy, setFFy]       = useState("");
  const [fMonth, setFMonth] = useState("");
  const [fZone, setFZone]   = useState("");    // DEFAULT All Zones — top 10 poore plant ke
  const [fLine, setFLine]   = useState("");
  const [fMachineNo, setFMachineNo]     = useState("");
  const [fMachineName, setFMachineName] = useState("");
  // ── the ranking ──
  const [rows, setRows]       = useState([]);   // individual breakdown rows from /log
  const [topN, setTopN]       = useState(10);   // 5 | 10 | 20 | 0 (=All)
  const [loading, setLoading] = useState(false);

  // On first load default to the current FY, ALL months (whole year ka top-10).
  const booted = useRef(false);
  useEffect(() => {
    if (!token) return;
    api.get("/api/maintenance-kpi/financial-years", token).then((y) => {
      const list = Array.isArray(y) ? y : [];
      setYears(list);
      if (!booted.current && list.length) {
        booted.current = true;
        const cur = list.find((v) => v.is_current) || list[0];
        setFFy(cur.fy);
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
  const clearFilters = () => { setFFy(""); setFMonth(""); setFZone(""); setFLine(""); setFMachineNo(""); setFMachineName(""); };

  // ── fetch individual breakdowns (manual slip) for the FY/month/zone/line window ──
  useEffect(() => {
    if (!token) return;
    const [df, dt] = dateWindow(fFy, fMonth);
    const p = new URLSearchParams({ limit: "3000" });
    if (df)    p.set("date_from", df);
    if (dt)    p.set("date_to", dt);
    if (fZone) p.set("zone", fZone);
    if (fLine) p.set("line", fLine);
    setLoading(true);
    api.get(`/api/breakdowns/log?${p.toString()}`, token)
      .then((d) => setRows(Array.isArray(d?.rows) ? d.rows : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [token, fFy, fMonth, fZone, fLine]);

  // Machine No / Name filter client-side (endpoint machine filter machine_name par
  // hai; No client-side saaf rehta), phir down-time se sort → top-N.
  const { ranked, totalMin, totalCount, shown, maxVal, longest } = useMemo(() => {
    let list = rows.filter((r) => (r.solve_time_min || 0) > 0);
    if (fMachineNo)   list = list.filter((r) => String(r.machine_no) === String(fMachineNo));
    if (fMachineName) list = list.filter((r) => r.machine_name === fMachineName);
    list = [...list].sort((a, b) => (b.solve_time_min || 0) - (a.solve_time_min || 0));
    const tMin  = list.reduce((s, r) => s + (r.solve_time_min || 0), 0);
    const take  = topN > 0 ? list.slice(0, topN) : list;
    const mx    = take.length ? (take[0].solve_time_min || 0) : 0;
    return { ranked: take, totalMin: tMin, totalCount: list.length, shown: take.length,
             maxVal: mx, longest: list[0] || null };
  }, [rows, fMachineNo, fMachineName, topN]);

  const coveredPct = totalMin ? Math.round((ranked.reduce((s, r) => s + (r.solve_time_min || 0), 0) / totalMin) * 100) : 0;
  const totalHrs   = Math.round((totalMin / 60) * 10) / 10;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700;800&family=Barlow+Condensed:wght@700;800&display=swap');
        .pa-root { min-height:100vh; background:#eef2f7; font-family:'Barlow',sans-serif; padding-bottom:50px; }
        .pa-top { background:#fff; border-bottom:1px solid #e2e8f0; height:56px; padding:0 28px 0 96px;
                  display:flex; align-items:center; justify-content:space-between;
                  position:sticky; top:0; z-index:50; box-shadow:0 1px 3px rgba(0,0,0,.06); }
        .pa-top::after { content:''; position:absolute; bottom:0; left:0; right:0; height:2px; background:${theme.gradient}; }
        .pa-title { font-family:'Barlow Condensed',sans-serif; font-size:22px; font-weight:800; color:#0f172a; }
        .pa-title span { color:${theme.accent}; }
        .pa-sub { font-size:11px; color:#94a3b8; margin-top:-2px; }
        .pa-back { display:flex; align-items:center; gap:6px; font-size:13px; font-weight:700; color:#475569;
                   background:#f1f5f9; border:1px solid #e2e8f0; border-radius:8px; padding:7px 14px; cursor:pointer; }

        .pa-filters { max-width:1500px; margin:16px auto 0; padding:0 22px;
                      display:flex; gap:12px; flex-wrap:wrap; align-items:flex-end; }
        .pa-fld { display:flex; flex-direction:column; gap:5px; }
        .pa-fld label { font-size:10.5px; font-weight:800; letter-spacing:.05em; text-transform:uppercase; color:#64748b; }
        .pa-sel { border:1.5px solid #cbd5e1; border-radius:9px; padding:9px 12px; font-size:13px; font-weight:600;
                  color:#0f172a; outline:none; font-family:'Barlow',sans-serif; background:#fff; min-width:150px; }
        .pa-sel:focus { border-color:${theme.accent}; }
        .pa-sel:disabled { background:#f1f5f9; color:#94a3b8; cursor:not-allowed; }

        .pa-body { max-width:1500px; margin:18px auto 0; padding:0 22px; }
        .pa-card { background:#fff; border:1px solid #e2e8f0; border-radius:14px;
                   box-shadow:0 1px 4px rgba(15,23,42,.06); padding:18px 20px 12px; }
        .pa-chead { display:flex; align-items:flex-end; justify-content:space-between; flex-wrap:wrap;
                    gap:10px; padding:0 6px 12px; border-bottom:1px solid #f1f5f9; margin-bottom:8px; }
        .pa-chead h3 { margin:0; font-size:16px; font-weight:800; color:#0f172a; letter-spacing:.04em; }
        .pa-chead .lvl { font-size:11.5px; font-weight:700; color:#64748b; margin-top:2px; }
        .pa-right { display:flex; align-items:flex-end; gap:14px; }
        .tb-table { width:100%; border-collapse:collapse; }
        .tb-table th { background:#1f4e79; color:#fff; font-size:11px; font-weight:700; letter-spacing:.03em;
                       padding:9px 12px; text-align:left; white-space:nowrap; }
        .tb-table th.num { text-align:right; }
        .tb-table td { border-bottom:1px solid #eef2f7; padding:8px 12px; font-size:13px; color:#0f172a; white-space:nowrap; }
        .tb-table td.num { text-align:right; font-variant-numeric:tabular-nums; font-weight:700; }
        .tb-rank { width:34px; height:34px; border-radius:9px; display:inline-flex; align-items:center;
                   justify-content:center; font-family:'Barlow Condensed',sans-serif; font-size:17px;
                   font-weight:800; color:#fff; }
        .tb-barwrap { background:#eef2f7; border-radius:6px; height:16px; width:100%; min-width:90px; overflow:hidden; }
        .tb-bar { height:100%; border-radius:6px; background:${BAR}; }
      `}</style>

      <div className="pa-root">
        <div className="pa-top">
          <div style={{ display:"flex", alignItems:"center", gap:14 }}>
            <button className="pa-back" onClick={() => nav("/maintenance-breakdown")}>← Back</button>
            <div>
              <div className="pa-title">Top 10 <span>BD</span></div>
              <div className="pa-sub">Sabse lambe breakdown (down-time) — manual slip</div>
            </div>
          </div>
          {user?.username && <span style={{ fontSize:12, color:"#64748b", fontWeight:600 }}>{user.username}</span>}
        </div>

        {/* ── the single filter bar (same as BD History / BD Analysis / Pareto) ── */}
        <div className="pa-filters">
          <div className="pa-fld">
            <label>Financial Year</label>
            <select className="pa-sel" value={fFy}
                    onChange={(e) => { setFFy(e.target.value); setFMonth(""); }}>
              <option value="">All Financial Years</option>
              {years.map((y) => <option key={y.fy} value={y.fy}>{y.fy}{y.is_current ? "  (current)" : ""}</option>)}
            </select>
          </div>
          <div className="pa-fld">
            <label>Month</label>
            <select className="pa-sel" value={fMonth} onChange={(e) => setFMonth(e.target.value)} disabled={!fFy}>
              <option value="">All Months</option>
              {monthOpts.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <div className="pa-fld">
            <label>Zone</label>
            <select className="pa-sel" value={fZone} onChange={(e) => onZone(e.target.value)}>
              <option value="">All Zones</option>
              {zoneOpts.map((z) => <option key={z} value={z}>{z}</option>)}
            </select>
          </div>
          <div className="pa-fld">
            <label>Line</label>
            <select className="pa-sel" value={fLine} onChange={(e) => onLine(e.target.value)} disabled={!fZone}>
              <option value="">All Lines</option>
              {lineOpts.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <div className="pa-fld">
            <label>Machine No.</label>
            <select className="pa-sel" value={fMachineNo} onChange={(e) => setFMachineNo(e.target.value)} disabled={!fLine}>
              <option value="">All Machine No.</option>
              {machineNoOpts.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="pa-fld">
            <label>Machine Name</label>
            <select className="pa-sel" value={fMachineName} onChange={(e) => setFMachineName(e.target.value)} disabled={!fLine}>
              <option value="">All Machine Names</option>
              {machineNameOpts.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="pa-fld">
            <label>&nbsp;</label>
            <button className="pa-back" style={{ padding:"9px 16px" }} onClick={clearFilters}>✕ Clear</button>
          </div>
        </div>

        {/* ── headline: longest single breakdown + total down time in filter ── */}
        <div className="pa-body" style={{ marginBottom:0 }}>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(300px, 1fr))", gap:14, marginBottom:14 }}>
            <div style={{ background:"#fff", border:"1px solid #e2e8f0", borderLeft:"4px solid #b91c1c",
                          borderRadius:14, padding:"14px 18px", boxShadow:"0 1px 4px rgba(15,23,42,.06)" }}>
              <div style={{ fontSize:10.5, fontWeight:800, letterSpacing:".06em", textTransform:"uppercase", color:"#94a3b8" }}>
                🕐 Longest Breakdown
              </div>
              <div style={{ fontSize:18, fontWeight:800, color:"#0f172a", marginTop:6, lineHeight:1.15 }}>
                {longest ? (longest.machine_name || longest.machine_no || "—") : "—"}
                {longest && longest.machine_no && longest.machine_name && (
                  <span style={{ fontSize:13, fontWeight:600, color:"#64748b" }}> · {longest.machine_no}</span>
                )}
              </div>
              <div style={{ display:"flex", alignItems:"baseline", gap:10, marginTop:4 }}>
                <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:26, fontWeight:800, color:"#b91c1c", lineHeight:1 }}>
                  {longest ? `${(longest.solve_time_min || 0).toLocaleString()} min` : "—"}
                </span>
                <span style={{ fontSize:11.5, color:"#94a3b8", fontWeight:600 }}>
                  {longest ? `${(longest.solve_time_hours || 0).toLocaleString()} hrs · ${longest.zone_code || "—"} / ${longest.line_code || "—"} · ${fmtDate(longest.bd_date)}` : "no data"}
                </span>
              </div>
            </div>
            <div style={{ background:"#fff", border:"1px solid #e2e8f0", borderLeft:"4px solid #1f4e79",
                          borderRadius:14, padding:"14px 18px", boxShadow:"0 1px 4px rgba(15,23,42,.06)" }}>
              <div style={{ fontSize:10.5, fontWeight:800, letterSpacing:".06em", textTransform:"uppercase", color:"#94a3b8" }}>
                📋 Total Down Time (filter)
              </div>
              <div style={{ fontSize:18, fontWeight:800, color:"#0f172a", marginTop:6, lineHeight:1.15 }}>
                {totalCount.toLocaleString()} breakdown{totalCount === 1 ? "" : "s"}
              </div>
              <div style={{ display:"flex", alignItems:"baseline", gap:10, marginTop:4 }}>
                <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:26, fontWeight:800, color:"#1f4e79", lineHeight:1 }}>
                  {totalMin.toLocaleString()} min
                </span>
                <span style={{ fontSize:11.5, color:"#94a3b8", fontWeight:600 }}>{totalHrs.toLocaleString()} hrs</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── the ranked list of individual breakdowns ── */}
        <div className="pa-body">
          <div className="pa-card">
            <div className="pa-chead">
              <div>
                <h3>TOP BREAKDOWNS{fZone ? ` — ${fZone}${fLine ? ` / ${fLine}` : ""}` : " — ALL ZONES"}</h3>
                <div className="lvl">
                  {shown} breakdown{shown === 1 ? "" : "s"} shown
                  {topN > 0 && coveredPct > 0 ? ` — covering ${coveredPct}% of total down time` : ""}
                  {loading ? " · loading…" : ""}
                </div>
              </div>
              <div className="pa-right">
                <div className="pa-fld">
                  <label>Show</label>
                  <select className="pa-sel" style={{ minWidth:110 }} value={topN}
                          onChange={(e) => setTopN(Number(e.target.value))}>
                    <option value={5}>Top 5</option>
                    <option value={10}>Top 10</option>
                    <option value={20}>Top 20</option>
                    <option value={0}>All</option>
                  </select>
                </div>
              </div>
            </div>

            {ranked.length === 0 ? (
              <div style={{ padding:"60px 0", textAlign:"center", color:"#94a3b8", fontSize:13, fontWeight:600 }}>
                {loading ? "Loading…" : "No breakdowns for this filter."}
              </div>
            ) : (
              <div style={{ overflowX:"auto" }}>
                <table className="tb-table">
                  <thead>
                    <tr>
                      <th style={{ width:56 }}>Rank</th>
                      <th>Date</th>
                      <th>Zone</th>
                      <th>Line</th>
                      <th>Machine No</th>
                      <th>Machine</th>
                      <th>Problem (Maintenance)</th>
                      <th className="num">Down Time (min)</th>
                      <th className="num">Hrs</th>
                      <th className="num">% of total</th>
                      <th style={{ width:210 }}>Down Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ranked.map((r, i) => {
                      const val    = r.solve_time_min || 0;
                      const barPct = maxVal ? Math.max(3, Math.round((val / maxVal) * 100)) : 0;
                      const pct    = totalMin ? Math.round((val / totalMin) * 100) : 0;
                      const rankBg = i === 0 ? "#b91c1c" : i === 1 ? "#c2410c" : i === 2 ? "#a16207" : "#334155";
                      return (
                        <tr key={r.id}>
                          <td><span className="tb-rank" style={{ background:rankBg }}>{i + 1}</span></td>
                          <td>{fmtDate(r.bd_date)}</td>
                          <td>{r.zone_code || "—"}</td>
                          <td>{r.line_code || "—"}</td>
                          <td style={{ fontWeight:700 }}>{r.machine_no || "—"}</td>
                          <td>{r.machine_name || "—"}</td>
                          <td style={{ maxWidth:280, overflow:"hidden", textOverflow:"ellipsis" }}
                              title={r.problem_maintenance || ""}>{r.problem_maintenance || "—"}</td>
                          <td className="num">{val.toLocaleString()}</td>
                          <td className="num" style={{ color:"#64748b" }}>{(r.solve_time_hours || 0).toLocaleString()}</td>
                          <td className="num" style={{ color:"#1f4e79" }}>{pct}%</td>
                          <td>
                            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                              <div className="tb-barwrap"><div className="tb-bar" style={{ width:`${barPct}%` }} /></div>
                              <span style={{ fontSize:11.5, fontWeight:800, color:"#334155", minWidth:44, textAlign:"right" }}>
                                {val.toLocaleString()}
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={7} style={{ fontWeight:800, color:"#0f172a", borderTop:"2px solid #e2e8f0" }}>
                        Total (filtered) — {totalCount.toLocaleString()} breakdown{totalCount === 1 ? "" : "s"}
                      </td>
                      <td className="num" style={{ borderTop:"2px solid #e2e8f0" }}>{totalMin.toLocaleString()}</td>
                      <td className="num" style={{ borderTop:"2px solid #e2e8f0", color:"#64748b" }}>{totalHrs.toLocaleString()}</td>
                      <td className="num" style={{ borderTop:"2px solid #e2e8f0" }}>100%</td>
                      <td style={{ borderTop:"2px solid #e2e8f0" }} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
