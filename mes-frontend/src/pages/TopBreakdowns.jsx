/* ───────────────────────────────────────────────────────────────────
 * TopBreakdowns.jsx  —  Breakdown → Top 10 BD
 * ───────────────────────────────────────────────────────────────────
 * Ranked "worst offenders" view: the top-N breakdown contributors for
 * the current filter, ranked by DOWN TIME (minutes) or by FREQUENCY
 * (number of breakdowns).  Shows rank, name, frequency, down-time
 * (min + hrs) and % of the filtered total, with an inline bar.
 *
 * Same filter bar + drill as the other Breakdown pages:
 *   All Zones     → top ZONES
 *   zone selected → top LINES (of that zone)
 *   line selected → top MACHINES (machine_no of that line)
 * Filter options come from the Machine Master List (mes_machines).
 *
 * Data: GET /api/maintenance-kpi/breakdown-by?group=zone|line|machine
 *       (mes_breakdown_log — the same source as Pareto / BD Analysis).
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

const BAR = "#1f4e79";   // Excel navy (matches Pareto)

export default function TopBreakdowns() {
  const { token, theme, user } = useAuth();
  const nav = useNavigate();
  // ── the single top filter bar (same as the other Breakdown pages) ──
  const [years, setYears]   = useState([]);
  const [master, setMaster] = useState([]);   // Machine Master List rows (mes_machines)
  const [fFy, setFFy]       = useState("");
  const [fMonth, setFMonth] = useState("");
  const [fZone, setFZone]   = useState("SEAT_SLIDER");   // default zone (user can switch to All / any other)
  const [fLine, setFLine]   = useState("");
  const [fMachineNo, setFMachineNo]     = useState("");
  const [fMachineName, setFMachineName] = useState("");
  // ── the ranking ──
  const [rows, setRows]       = useState([]);   // grouped rows from /breakdown-by
  const [topN, setTopN]       = useState(10);   // 5 | 10 | 20 | 0 (=All)
  const [rankBy, setRankBy]   = useState("minutes");   // "minutes" | "frequency"
  const [loading, setLoading] = useState(false);

  // On first load default to the current FY with its FIRST month (April)
  // pre-selected; the user can switch Month to "All Months" or any other.
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
        setFMonth(fyMonths(cur.fy)[0]?.value || "");
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

  // ── drill level follows the filters: zone → line → machine ──
  const group = fLine ? "machine" : fZone ? "line" : "zone";

  // machine_no → machine_name lookup (from the Machine Master) so the
  // machine-level ranking can show the descriptive name next to the code.
  const nameByNo = useMemo(() => {
    const map = {};
    for (const m of master) {
      if (m.machine_no && m.machine_name &&
          (!fZone || m.zone_name === fZone) &&
          (!fLine || m.line_name === fLine)) {
        map[String(m.machine_no)] = m.machine_name;
      }
    }
    return map;
  }, [master, fZone, fLine]);
  // display name for a row: machine level shows the master name, else the key
  const dispName = (r) => (group === "machine" ? (nameByNo[String(r.key)] || "") : r.key);

  useEffect(() => {
    if (!token) return;
    const p = new URLSearchParams({ group });
    if (fFy)          p.set("fy", fFy);
    if (fMonth)       p.set("month", fMonth);
    if (fZone)        p.set("zone_name", fZone);
    if (fLine)        p.set("line_name", fLine);
    if (fMachineNo)   p.set("machine_no", fMachineNo);
    if (fMachineName) p.set("machine_name", fMachineName);
    setLoading(true);
    api.get(`/api/maintenance-kpi/breakdown-by?${p.toString()}`, token)
      .then((d) => setRows(Array.isArray(d?.rows) ? d.rows : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [token, group, fFy, fMonth, fZone, fLine, fMachineNo, fMachineName]);

  // Rank by the chosen metric; keep grand totals over the FULL filtered set
  // so the % column and the "covers X%" line stay honest for a Top-N view.
  const { ranked, totalMin, totalFreq, shown, maxVal, topMin, topFreq } = useMemo(() => {
    const key = rankBy === "frequency" ? "frequency" : "minutes";
    const sorted = [...rows].filter((r) => (r[key] || 0) > 0)
                            .sort((a, b) => (b[key] || 0) - (a[key] || 0));
    const tMin  = rows.reduce((s, r) => s + (r.minutes || 0), 0);
    const tFreq = rows.reduce((s, r) => s + (r.frequency || 0), 0);
    const take  = topN > 0 ? sorted.slice(0, topN) : sorted;
    const mx    = take.length ? (take[0][key] || 0) : 0;
    // #1 by EACH metric independently (headline cards) — over the full set
    const byMin  = [...rows].filter((r) => (r.minutes || 0) > 0)
                            .sort((a, b) => (b.minutes || 0) - (a.minutes || 0))[0] || null;
    const byFreq = [...rows].filter((r) => (r.frequency || 0) > 0)
                            .sort((a, b) => (b.frequency || 0) - (a.frequency || 0))[0] || null;
    return { ranked: take, totalMin: tMin, totalFreq: tFreq, shown: take.length,
             maxVal: mx, topMin: byMin, topFreq: byFreq };
  }, [rows, topN, rankBy]);

  const unitWord = group === "zone" ? "zone" : group;
  const levelNoun = group === "zone" ? "Zone" : group === "line" ? "Line" : "Machine";
  const listTitle = group === "zone" ? "TOP BREAKDOWN ZONES"
    : group === "line" ? `TOP BREAKDOWN LINES — ${fZone}`
    : `TOP BREAKDOWN MACHINES — ${fZone} / ${fLine}`;
  const coveredPct = rankBy === "frequency"
    ? (totalFreq ? Math.round((ranked.reduce((s, r) => s + (r.frequency || 0), 0) / totalFreq) * 100) : 0)
    : (totalMin  ? Math.round((ranked.reduce((s, r) => s + (r.minutes || 0), 0) / totalMin) * 100) : 0);

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
        .tb-table td { border-bottom:1px solid #eef2f7; padding:8px 12px; font-size:13px; color:#0f172a; }
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
              <div className="pa-sub">Worst breakdown offenders</div>
            </div>
          </div>
          {user?.username && <span style={{ fontSize:12, color:"#64748b", fontWeight:600 }}>{user.username}</span>}
        </div>

        {/* ── the single filter bar (same as BD History / BD Analysis / Pareto) ── */}
        <div className="pa-filters">
          <div className="pa-fld">
            <label>Financial Year</label>
            <select className="pa-sel" value={fFy}
                    onChange={(e) => { const v = e.target.value;
                                       setFFy(v);
                                       setFMonth(v ? (fyMonths(v)[0]?.value || "") : ""); }}>
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

        {/* ── headline: #1 by hours + #1 by frequency (with name) ── */}
        <div className="pa-body" style={{ marginBottom:0 }}>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(300px, 1fr))", gap:14, marginBottom:14 }}>
            {[
              { icon:"🕐", head:`Highest Down Time (${levelNoun})`, accent:"#b91c1c",
                row: topMin,
                big: topMin ? `${(topMin.minutes || 0).toLocaleString()} min` : "—",
                small: topMin ? `${(topMin.hours || 0).toLocaleString()} hrs · ${(topMin.frequency || 0)} breakdowns` : "no data" },
              { icon:"🔁", head:`Most Frequent (${levelNoun})`, accent:"#1f4e79",
                row: topFreq,
                big: topFreq ? `${(topFreq.frequency || 0).toLocaleString()} times` : "—",
                small: topFreq ? `${(topFreq.minutes || 0).toLocaleString()} min · ${(topFreq.hours || 0)} hrs` : "no data" },
            ].map((c, i) => (
              <div key={i} style={{ background:"#fff", border:"1px solid #e2e8f0", borderLeft:`4px solid ${c.accent}`,
                                    borderRadius:14, padding:"14px 18px", boxShadow:"0 1px 4px rgba(15,23,42,.06)" }}>
                <div style={{ fontSize:10.5, fontWeight:800, letterSpacing:".06em", textTransform:"uppercase", color:"#94a3b8" }}>
                  {c.icon} {c.head}
                </div>
                <div style={{ fontSize:18, fontWeight:800, color:"#0f172a", marginTop:6, lineHeight:1.15 }}>
                  {c.row ? c.row.key : "—"}
                  {c.row && group === "machine" && nameByNo[String(c.row.key)] && (
                    <span style={{ fontSize:13, fontWeight:600, color:"#64748b" }}> · {nameByNo[String(c.row.key)]}</span>
                  )}
                </div>
                <div style={{ display:"flex", alignItems:"baseline", gap:10, marginTop:4 }}>
                  <span style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:26, fontWeight:800, color:c.accent, lineHeight:1 }}>
                    {c.big}
                  </span>
                  <span style={{ fontSize:11.5, color:"#94a3b8", fontWeight:600 }}>{c.small}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── the ranked list ── */}
        <div className="pa-body">
          <div className="pa-card">
            <div className="pa-chead">
              <div>
                <h3>{listTitle}</h3>
                <div className="lvl">
                  {shown} {unitWord}{shown === 1 ? "" : "s"} shown
                  {topN > 0 && coveredPct > 0
                    ? ` — covering ${coveredPct}% of total ${rankBy === "frequency" ? "breakdowns" : "down time"}`
                    : ""}
                  {loading ? " · loading…" : ""}
                </div>
              </div>
              <div className="pa-right">
                <div className="pa-fld">
                  <label>Rank By</label>
                  <select className="pa-sel" style={{ minWidth:140 }} value={rankBy}
                          onChange={(e) => setRankBy(e.target.value)}>
                    <option value="minutes">Down Time</option>
                    <option value="frequency">Frequency</option>
                  </select>
                </div>
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
                No breakdowns for this filter.
              </div>
            ) : (
              <div style={{ overflowX:"auto" }}>
                <table className="tb-table">
                  <thead>
                    <tr>
                      <th style={{ width:56 }}>Rank</th>
                      <th>{group === "zone" ? "Zone" : group === "line" ? "Line" : "Machine No. / Name"}</th>
                      <th className="num">Frequency</th>
                      <th className="num">Down Time (min)</th>
                      <th className="num">Hrs</th>
                      <th className="num">% of total</th>
                      <th style={{ width:240 }}>{rankBy === "frequency" ? "Frequency" : "Down Time"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ranked.map((r, i) => {
                      const val    = rankBy === "frequency" ? (r.frequency || 0) : (r.minutes || 0);
                      const barPct = maxVal ? Math.max(3, Math.round((val / maxVal) * 100)) : 0;
                      const denom  = rankBy === "frequency" ? totalFreq : totalMin;
                      const pctOfTotal = denom ? Math.round((val / denom) * 100) : 0;
                      // Top 3 get medal colours; the rest a calm navy.
                      const rankBg = i === 0 ? "#b91c1c" : i === 1 ? "#c2410c" : i === 2 ? "#a16207" : "#334155";
                      return (
                        <tr key={r.key}>
                          <td><span className="tb-rank" style={{ background:rankBg }}>{i + 1}</span></td>
                          <td style={{ fontWeight:700 }}>
                            {r.key}
                            {group === "machine" && dispName(r) && (
                              <div style={{ fontSize:11, fontWeight:500, color:"#64748b", marginTop:1 }}>
                                {dispName(r)}
                              </div>
                            )}
                          </td>
                          <td className="num">{(r.frequency || 0).toLocaleString()}</td>
                          <td className="num">{(r.minutes || 0).toLocaleString()}</td>
                          <td className="num" style={{ color:"#64748b" }}>{(r.hours || 0).toLocaleString()}</td>
                          <td className="num" style={{ color:"#1f4e79" }}>{pctOfTotal}%</td>
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
                      <td colSpan={2} style={{ fontWeight:800, color:"#0f172a", borderTop:"2px solid #e2e8f0" }}>
                        Total (filtered)
                      </td>
                      <td className="num" style={{ borderTop:"2px solid #e2e8f0" }}>{totalFreq.toLocaleString()}</td>
                      <td className="num" style={{ borderTop:"2px solid #e2e8f0" }}>{totalMin.toLocaleString()}</td>
                      <td className="num" style={{ borderTop:"2px solid #e2e8f0", color:"#64748b" }}>
                        {Math.round(totalMin / 60).toLocaleString()}
                      </td>
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
