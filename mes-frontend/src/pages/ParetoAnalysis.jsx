/* ───────────────────────────────────────────────────────────────────
 * ParetoAnalysis.jsx  —  Breakdown → Pareto Analysis
 * ───────────────────────────────────────────────────────────────────
 * Down-time Pareto chart (matches the user's Excel reference): navy bars
 * = total breakdown LOSSES in MINUTES (descending), red dashed line =
 * cumulative % of the total downtime (CUMM%), labels on both.
 *
 * The grouping follows the drill (same as BD Analysis):
 *   All Zones          → ZONE-wise pareto
 *   zone selected      → LINE-wise pareto (lines of that zone)
 *   line selected      → MACHINE-wise pareto (machine_no of that line;
 *                        Machine No / Name filters narrow it further)
 *
 * Same filter bar as the other Breakdown pages (FY · Month · Zone ·
 * Line · Machine No · Machine Name — options from the Machine Master
 * List `mes_machines`).  Cumulative % is always computed over ALL the
 * filtered machines, so "Top 20" ending at e.g. 74% reads as "these 20
 * machines cause 74% of the downtime".
 *
 * Data: GET /api/maintenance-kpi/breakdown-by?group=machine
 *       (mes_breakdown_data — the same source as Maintenance KPI).
 * Routing: /maintenance-breakdown/pareto-analysis
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, LabelList,
} from "recharts";
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

const BAR = "#1f4e79";     // Excel navy  (down-time bars)
const LINE = "#c0392b";    // Excel red   (down-time CUMM%)
const BAR2 = "#5b9bd5";    // Excel light blue (frequency bars)
const LINE2 = "#70ad47";   // Excel green      (frequency CUMM%)

export default function ParetoAnalysis() {
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
  // ── the pareto ──
  const [rows, setRows]       = useState([]);   // machine-wise rows from /breakdown-by
  const topN = 0;   // show ALL (the Top-N "Show" selector was removed)
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

  // Pareto: machines sorted by downtime desc; CUMM% over the FULL filtered
  // total (so a Top-N view honestly shows how much of the whole it covers).
  const { chartData, grandTotal, shown, freqData, grandFreq, shownFreq } = useMemo(() => {
    // ── DOWN TIME WISE (minutes, descending) ──
    const sortedT = [...rows].filter((r) => (r.minutes || 0) > 0)
                             .sort((a, b) => (b.minutes || 0) - (a.minutes || 0));
    const totalT = sortedT.reduce((s, r) => s + (r.minutes || 0), 0);
    const takeT  = topN > 0 ? sortedT.slice(0, topN) : sortedT;
    let cumT = 0;
    const dataT = takeT.map((r) => {
      cumT += r.minutes || 0;
      return { name: r.key, minutes: r.minutes || 0,
               cumPct: totalT ? Math.round((cumT / totalT) * 100) : 0 };
    });
    // ── DOWN FREQ WISE (frequency, descending) ──
    const sortedF = [...rows].filter((r) => (r.frequency || 0) > 0)
                             .sort((a, b) => (b.frequency || 0) - (a.frequency || 0));
    const totalF = sortedF.reduce((s, r) => s + (r.frequency || 0), 0);
    const takeF  = topN > 0 ? sortedF.slice(0, topN) : sortedF;
    let cumF = 0;
    const dataF = takeF.map((r) => {
      cumF += r.frequency || 0;
      return { name: r.key, frequency: r.frequency || 0,
               cumPct: totalF ? Math.round((cumF / totalF) * 100) : 0 };
    });
    return { chartData: dataT, grandTotal: totalT, shown: takeT.length,
             freqData: dataF, grandFreq: totalF, shownFreq: takeF.length };
  }, [rows, topN]);

  const lastPct = chartData.length ? chartData[chartData.length - 1].cumPct : 0;
  const lastPctFreq = freqData.length ? freqData[freqData.length - 1].cumPct : 0;
  const chartTitle = group === "zone" ? "ZONE DOWN TIME WISE"
    : group === "line" ? `LINE DOWN TIME WISE — ${fZone}`
    : `MACHINE DOWN TIME WISE — ${fZone} / ${fLine}`;
  const freqTitle = group === "zone" ? "ZONE DOWN FREQ WISE"
    : group === "line" ? `LINE DOWN FREQ WISE — ${fZone}`
    : `MACHINE DOWN FREQ WISE — ${fZone} / ${fLine}`;
  const unitWord = group === "zone" ? "zone" : group;

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
                   box-shadow:0 1px 4px rgba(15,23,42,.06); padding:18px 20px 8px; }
        .pa-chead { display:flex; align-items:flex-end; justify-content:space-between; flex-wrap:wrap;
                    gap:10px; padding:0 6px 12px; border-bottom:1px solid #f1f5f9; margin-bottom:8px; }
        .pa-chead h3 { margin:0; font-size:16px; font-weight:800; color:#0f172a; letter-spacing:.04em; }
        .pa-chead .lvl { font-size:11.5px; font-weight:700; color:#64748b; margin-top:2px; }
        .pa-right { display:flex; align-items:center; gap:14px; }
        .pa-stat { text-align:right; }
        .pa-stat .v { font-family:'Barlow Condensed',sans-serif; font-size:24px; font-weight:800; line-height:1; color:${"#1f4e79"}; }
        .pa-stat .u { font-size:10px; font-weight:800; letter-spacing:.06em; text-transform:uppercase; color:#94a3b8; }
      `}</style>

      <div className="pa-root">
        <div className="pa-top">
          <div style={{ display:"flex", alignItems:"center", gap:14 }}>
            <button className="pa-back" onClick={() => nav("/maintenance-breakdown")}>← Back</button>
            <div>
              <div className="pa-title">Pareto <span>Analysis</span></div>
              <div className="pa-sub">Machine down time wise</div>
            </div>
          </div>
          {user?.username && <span style={{ fontSize:12, color:"#64748b", fontWeight:600 }}>{user.username}</span>}
        </div>

        {/* ── the single filter bar (same as BD History / BD Analysis / CAPA) ── */}
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

        {/* ── the two Pareto charts, side by side ── */}
        <div className="pa-body">
          <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div className="pa-card" style={{ flex: "1 1 480px", minWidth: 0 }}>
            <div className="pa-chead">
              <div>
                <h3>{chartTitle}</h3>
                <div className="lvl">
                  {shown} {unitWord}{shown === 1 ? "" : "s"} shown
                  {topN > 0 && lastPct > 0 ? ` — covering ${lastPct}% of total down time` : ""}
                  {loading ? " · loading…" : ""}
                </div>
              </div>
              <div className="pa-right">
                <div className="pa-stat">
                  <div className="v">{grandTotal.toLocaleString()}</div>
                  <div className="u">Total min (filtered)</div>
                </div>
              </div>
            </div>

            {chartData.length === 0 ? (
              <div style={{ padding:"60px 0", textAlign:"center", color:"#94a3b8", fontSize:13, fontWeight:600 }}>
                No breakdown down-time for this filter.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={460}>
                <ComposedChart data={chartData} margin={{ top: 30, right: 18, left: 8, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="name" interval={0} angle={-40} textAnchor="end" height={96}
                         tick={{ fontSize: 10.5, fontWeight: 700, fill: "#475569" }} />
                  <YAxis yAxisId="min" tick={{ fontSize: 11, fill: "#64748b" }}
                         label={{ value: "TIME IN MINUTES", angle: -90, position: "insideLeft",
                                  style: { fontSize: 11, fontWeight: 800, fill: "#475569", letterSpacing: ".04em" } }} />
                  <YAxis yAxisId="pct" orientation="right" domain={[0, 100]}
                         tick={{ fontSize: 11, fill: "#64748b" }} tickFormatter={(v) => `${v}`} />
                  <Tooltip
                    formatter={(v, n) => (n === "CUMM%" ? [`${v}%`, "CUMM%"] : [`${Number(v).toLocaleString()} min`, "LOSSES (MIN.)"])}
                    contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0",
                                    fontFamily: "'Barlow',sans-serif", fontSize: 12.5, fontWeight: 600 }} />
                  <Legend wrapperStyle={{ fontSize: 12, fontWeight: 700 }} />
                  <Bar yAxisId="min" dataKey="minutes" name="LOSSES (MIN.)" fill={BAR}
                       maxBarSize={54}>
                    <LabelList dataKey="minutes" position="top"
                               formatter={(v) => (v ? Number(v).toLocaleString() : "")}
                               style={{ fontSize: 11.5, fontWeight: 800, fill: "#1e293b" }} />
                  </Bar>
                  <Line yAxisId="pct" dataKey="cumPct" name="CUMM%" type="monotone"
                        stroke={LINE} strokeWidth={3} strokeDasharray="7 6"
                        dot={{ r: 3, fill: LINE }} activeDot={{ r: 5 }}>
                    <LabelList dataKey="cumPct" position="top" offset={12}
                               formatter={(v) => `${v}`}
                               style={{ fontSize: 11.5, fontWeight: 800, fill: "#334155" }} />
                  </Line>
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* ── second Pareto chart: MACHINE DOWN FREQ WISE ── */}
          <div className="pa-card" style={{ flex: "1 1 480px", minWidth: 0 }}>
            <div className="pa-chead">
              <div>
                <h3>{freqTitle}</h3>
                <div className="lvl">
                  {shownFreq} {unitWord}{shownFreq === 1 ? "" : "s"} shown
                  {topN > 0 && lastPctFreq > 0 ? ` — covering ${lastPctFreq}% of total breakdowns` : ""}
                  {loading ? " · loading…" : ""}
                </div>
              </div>
              <div className="pa-right">
                <div className="pa-stat">
                  <div className="v" style={{ color: BAR2 }}>{grandFreq.toLocaleString()}</div>
                  <div className="u">Total B/D (filtered)</div>
                </div>
              </div>
            </div>

            {freqData.length === 0 ? (
              <div style={{ padding:"60px 0", textAlign:"center", color:"#94a3b8", fontSize:13, fontWeight:600 }}>
                No breakdown frequency for this filter.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={460}>
                <ComposedChart data={freqData} margin={{ top: 30, right: 18, left: 8, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="name" interval={0} angle={-40} textAnchor="end" height={96}
                         tick={{ fontSize: 10.5, fontWeight: 700, fill: "#475569" }} />
                  <YAxis yAxisId="freq" allowDecimals={false} tick={{ fontSize: 11, fill: "#64748b" }}
                         label={{ value: "FREQUENCY NUMBER", angle: -90, position: "insideLeft",
                                  style: { fontSize: 11, fontWeight: 800, fill: "#475569", letterSpacing: ".04em" } }} />
                  <YAxis yAxisId="pct" orientation="right" domain={[0, 100]}
                         tick={{ fontSize: 11, fill: "#64748b" }} tickFormatter={(v) => `${v}`} />
                  <Tooltip
                    formatter={(v, n) => (n === "CUMM%" ? [`${v}%`, "CUMM%"] : [`${Number(v).toLocaleString()}`, "FREQUENCY OF B/D"])}
                    contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0",
                                    fontFamily: "'Barlow',sans-serif", fontSize: 12.5, fontWeight: 600 }} />
                  <Legend wrapperStyle={{ fontSize: 12, fontWeight: 700 }} />
                  <Bar yAxisId="freq" dataKey="frequency" name="FREQUENCY OF B/D" fill={BAR2}
                       maxBarSize={54}>
                    <LabelList dataKey="frequency" position="top"
                               formatter={(v) => (v ? Number(v).toLocaleString() : "")}
                               style={{ fontSize: 11.5, fontWeight: 800, fill: "#1e293b" }} />
                  </Bar>
                  <Line yAxisId="pct" dataKey="cumPct" name="CUMM%" type="monotone"
                        stroke={LINE2} strokeWidth={3} strokeDasharray="7 6"
                        dot={{ r: 3, fill: LINE2 }} activeDot={{ r: 5 }}>
                    <LabelList dataKey="cumPct" position="top" offset={12}
                               formatter={(v) => `${v}`}
                               style={{ fontSize: 11.5, fontWeight: 800, fill: "#334155" }} />
                  </Line>
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
          </div>
        </div>
      </div>
    </>
  );
}
