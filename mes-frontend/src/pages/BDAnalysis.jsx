/* ───────────────────────────────────────────────────────────────────
 * BDAnalysis.jsx
 * ───────────────────────────────────────────────────────────────────
 * "BD Analysis" — drill-down breakdown analysis over mes_breakdown_data.
 *
 *   filter bar (FY · Month · Zone · Line · Machine No · Machine Name —
 *   options from the Machine Master List `mes_machines`)
 *      ↓
 *   2 metric buttons: TOTAL BREAKDOWN HOURS | TOTAL BREAKDOWN FREQUENCY
 *      ↓
 *   one bar chart whose grouping follows the drill:
 *      no zone selected   → ZONE-wise   (the 6 production zones)
 *      zone selected      → LINE-wise   (lines of that zone)
 *      line selected      → MACHINE-wise (machine_no of that line;
 *                           picking a Machine No / Name highlights its bar)
 *
 * Data: GET /api/maintenance-kpi/breakdown-by (mes_breakdown_data).
 * Routing: /maintenance-breakdown/bd-analysis
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, LabelList, Cell,
} from "recharts";
import { useAuth } from "../context/AuthContext";
import { PROD_ZONES, onlyProdZones } from "../constants/zones";

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

const METRICS = [
  { key: "hours",     label: "Total Breakdown Hours",     unit: "hrs",   color: "#f59e0b", icon: "⏱" },
  { key: "frequency", label: "Total Breakdown Frequency", unit: "count", color: "#3b82f6", icon: "📊" },
];

export default function BDAnalysis() {
  const { token, theme, user } = useAuth();
  const nav = useNavigate();
  // ── the single top filter bar ──
  const [years, setYears]   = useState([]);
  const [master, setMaster] = useState([]);   // Machine Master List rows (mes_machines)
  const [fFy, setFFy]       = useState("");
  const [fMonth, setFMonth] = useState("");
  const [fZone, setFZone]   = useState("");
  const [fLine, setFLine]   = useState("");
  const [fMachineNo, setFMachineNo]     = useState("");
  const [fMachineName, setFMachineName] = useState("");
  // ── the analysis ──
  const [metric, setMetric]       = useState("hours");   // "hours" | "frequency"
  const [chartRows, setChartRows] = useState([]);        // rows from /breakdown-by
  const [loading, setLoading]     = useState(false);

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
  const clearFilters = () => { setFFy(""); setFMonth(""); setFZone(""); setFLine(""); setFMachineNo(""); setFMachineName(""); };

  // ── drill level follows the filters: zone → line → machine ──
  const group = fLine ? "machine" : fZone ? "line" : "zone";

  useEffect(() => {
    if (!token) return;
    const p = new URLSearchParams({ group });
    if (fFy)    p.set("fy", fFy);
    if (fMonth) p.set("month", fMonth);
    if (fZone)  p.set("zone_name", fZone);
    if (fLine)  p.set("line_name", fLine);
    setLoading(true);
    api.get(`/api/maintenance-kpi/breakdown-by?${p.toString()}`, token)
      .then((d) => setChartRows(Array.isArray(d?.rows) ? d.rows : []))
      .catch(() => setChartRows([]))
      .finally(() => setLoading(false));
  }, [token, group, fFy, fMonth, fZone, fLine]);

  // Machine No selected directly, or resolved from the Machine Name pick —
  // used to highlight that machine's bar in the machine-wise chart.
  const selMachineNo = fMachineNo ||
    (fMachineName
      ? (master.find((m) => m.zone_name === fZone && m.line_name === fLine && m.machine_name === fMachineName)?.machine_no || "")
      : "");

  // Chart categories come from the master (zero-filled), data from the log.
  const chartData = useMemo(() => {
    let cats = group === "zone" ? PROD_ZONES : group === "line" ? lineOpts : machineNoOpts;
    const byKey = Object.fromEntries(chartRows.map((r) => [r.key, r]));
    if (group !== "zone") {
      // codes that exist in the data but drifted from the master → append,
      // so the chart totals stay honest.
      const extra = chartRows.map((r) => r.key).filter((k) => !cats.includes(k)).sort();
      cats = [...cats, ...extra];
    }
    return cats.map((c) => ({
      name: c,
      hours: byKey[c]?.hours ?? 0,
      frequency: byKey[c]?.frequency ?? 0,
    }));
  }, [group, lineOpts, machineNoOpts, chartRows]);

  const met = METRICS.find((m) => m.key === metric) || METRICS[0];
  const totalVal = useMemo(
    () => chartData.reduce((s, d) => s + (d[metric] || 0), 0), [chartData, metric]);
  const levelLabel = group === "zone" ? "Zone Wise"
    : group === "line" ? `Line Wise — ${fZone}`
    : `Machine Wise — ${fZone} / ${fLine}`;
  const periodLabel = fMonth
    ? (monthOpts.find((m) => m.value === fMonth)?.label || fMonth)
    : (fFy ? `FY ${fFy}` : "All time");

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700;800&family=Barlow+Condensed:wght@700;800&display=swap');
        .ba-root { min-height:100vh; background:#eef2f7; font-family:'Barlow',sans-serif; padding-bottom:50px; }
        .ba-top { background:#fff; border-bottom:1px solid #e2e8f0; height:56px; padding:0 28px 0 96px;
                  display:flex; align-items:center; justify-content:space-between;
                  position:sticky; top:0; z-index:50; box-shadow:0 1px 3px rgba(0,0,0,.06); }
        .ba-top::after { content:''; position:absolute; bottom:0; left:0; right:0; height:2px; background:${theme.gradient}; }
        .ba-title { font-family:'Barlow Condensed',sans-serif; font-size:22px; font-weight:800; color:#0f172a; }
        .ba-title span { color:${theme.accent}; }
        .ba-sub { font-size:11px; color:#94a3b8; margin-top:-2px; }
        .ba-back { display:flex; align-items:center; gap:6px; font-size:13px; font-weight:700; color:#475569;
                   background:#f1f5f9; border:1px solid #e2e8f0; border-radius:8px; padding:7px 14px; cursor:pointer; }

        .ba-filters { max-width:1500px; margin:16px auto 0; padding:0 22px;
                      display:flex; gap:12px; flex-wrap:wrap; align-items:flex-end; }
        .ba-fld { display:flex; flex-direction:column; gap:5px; }
        .ba-fld label { font-size:10.5px; font-weight:800; letter-spacing:.05em; text-transform:uppercase; color:#64748b; }
        .ba-sel { border:1.5px solid #cbd5e1; border-radius:9px; padding:9px 12px; font-size:13px; font-weight:600;
                  color:#0f172a; outline:none; font-family:'Barlow',sans-serif; background:#fff; min-width:150px; }
        .ba-sel:focus { border-color:${theme.accent}; }
        .ba-sel:disabled { background:#f1f5f9; color:#94a3b8; cursor:not-allowed; }

        /* ── the 2 metric buttons (below the zone filter bar) ── */
        .ba-metrics { max-width:1500px; margin:18px auto 0; padding:0 22px; display:flex; gap:12px; flex-wrap:wrap; }
        .ba-mbtn { display:flex; align-items:center; gap:9px; padding:11px 22px; border-radius:11px; cursor:pointer;
                   border:2px solid #e2e8f0; background:#fff; color:#475569;
                   font-family:'Barlow',sans-serif; font-size:13.5px; font-weight:800;
                   letter-spacing:.03em; text-transform:uppercase; transition:all .15s; }
        .ba-mbtn:hover { border-color:#94a3b8; }
        .ba-mbtn.on { color:#fff; border-color:transparent; box-shadow:0 4px 12px rgba(15,23,42,.18); }

        .ba-body { max-width:1500px; margin:18px auto 0; padding:0 22px; }
        .ba-card { background:#fff; border:1px solid #e2e8f0; border-radius:14px;
                   box-shadow:0 1px 4px rgba(15,23,42,.06); padding:18px 20px 8px; }
        .ba-chead { display:flex; align-items:flex-end; justify-content:space-between; flex-wrap:wrap;
                    gap:10px; padding:0 6px 12px; border-bottom:1px solid #f1f5f9; margin-bottom:8px; }
        .ba-chead h3 { margin:0; font-size:16px; font-weight:800; color:#0f172a; }
        .ba-chead .lvl { font-size:11.5px; font-weight:700; color:#64748b; margin-top:2px; }
        .ba-total { text-align:right; }
        .ba-total .v { font-family:'Barlow Condensed',sans-serif; font-size:26px; font-weight:800; line-height:1; }
        .ba-total .u { font-size:10.5px; font-weight:800; letter-spacing:.06em; text-transform:uppercase; color:#94a3b8; }
      `}</style>

      <div className="ba-root">
        <div className="ba-top">
          <div style={{ display:"flex", alignItems:"center", gap:14 }}>
            <button className="ba-back" onClick={() => nav("/maintenance-breakdown")}>← Back</button>
            <div>
              <div className="ba-title">BD <span>Analysis</span></div>
              <div className="ba-sub">Breakdown analysis</div>
            </div>
          </div>
          {user?.username && <span style={{ fontSize:12, color:"#64748b", fontWeight:600 }}>{user.username}</span>}
        </div>

        {/* ── the single filter bar ── */}
        <div className="ba-filters">
          <div className="ba-fld">
            <label>Financial Year</label>
            <select className="ba-sel" value={fFy} onChange={(e) => { setFFy(e.target.value); setFMonth(""); }}>
              <option value="">All Financial Years</option>
              {years.map((y) => <option key={y.fy} value={y.fy}>{y.fy}{y.is_current ? "  (current)" : ""}</option>)}
            </select>
          </div>
          <div className="ba-fld">
            <label>Month</label>
            <select className="ba-sel" value={fMonth} onChange={(e) => setFMonth(e.target.value)} disabled={!fFy}>
              <option value="">All Months</option>
              {monthOpts.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <div className="ba-fld">
            <label>Zone</label>
            <select className="ba-sel" value={fZone} onChange={(e) => onZone(e.target.value)}>
              <option value="">All Zones</option>
              {zoneOpts.map((z) => <option key={z} value={z}>{z}</option>)}
            </select>
          </div>
          <div className="ba-fld">
            <label>Line</label>
            <select className="ba-sel" value={fLine} onChange={(e) => onLine(e.target.value)} disabled={!fZone}>
              <option value="">All Lines</option>
              {lineOpts.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <div className="ba-fld">
            <label>Machine No.</label>
            <select className="ba-sel" value={fMachineNo} onChange={(e) => setFMachineNo(e.target.value)} disabled={!fLine}>
              <option value="">All Machine No.</option>
              {machineNoOpts.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="ba-fld">
            <label>Machine Name</label>
            <select className="ba-sel" value={fMachineName} onChange={(e) => setFMachineName(e.target.value)} disabled={!fLine}>
              <option value="">All Machine Names</option>
              {machineNameOpts.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="ba-fld">
            <label>&nbsp;</label>
            <button className="ba-back" style={{ padding:"9px 16px" }} onClick={clearFilters}>✕ Clear</button>
          </div>
        </div>

        {/* ── 2 metric buttons: Total Breakdown Hours | Total Breakdown Frequency ── */}
        <div className="ba-metrics">
          {METRICS.map((m) => (
            <button key={m.key}
                    className={`ba-mbtn${metric === m.key ? " on" : ""}`}
                    style={metric === m.key ? { background: m.color } : {}}
                    onClick={() => setMetric(m.key)}>
              <span>{m.icon}</span>{m.label}
            </button>
          ))}
        </div>

        {/* ── the drill-down chart: zone-wise → line-wise → machine-wise ── */}
        <div className="ba-body">
          <div className="ba-card">
            <div className="ba-chead">
              <div>
                <h3>{met.label}</h3>
                <div className="lvl">{levelLabel} · {periodLabel}{loading ? " · loading…" : ""}</div>
              </div>
              <div className="ba-total">
                <div className="v" style={{ color: met.color }}>
                  {metric === "hours" ? totalVal.toFixed(1) : totalVal}
                </div>
                <div className="u">Total {met.unit}</div>
              </div>
            </div>

            {chartData.length === 0 ? (
              <div style={{ padding:"60px 0", textAlign:"center", color:"#94a3b8", fontSize:13, fontWeight:600 }}>
                No {group}s to plot — pick a {group === "line" ? "zone" : "line"} above.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={groupHeight(group, chartData.length)}>
                <BarChart data={chartData}
                          margin={{ top: 28, right: 24, left: 0,
                                    bottom: group === "zone" ? 10 : 30 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="name" interval={0}
                         angle={group === "zone" ? 0 : -35}
                         textAnchor={group === "zone" ? "middle" : "end"}
                         height={group === "zone" ? 34 : 84}
                         tick={{ fontSize: 11, fontWeight: 700, fill: "#475569" }} />
                  <YAxis tick={{ fontSize: 11, fill: "#64748b" }} allowDecimals={metric === "hours"} />
                  <Tooltip
                    formatter={(v) => [metric === "hours" ? `${Number(v).toFixed(2)} hrs` : v, met.label]}
                    contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0",
                                    fontFamily: "'Barlow',sans-serif", fontSize: 12.5, fontWeight: 600 }} />
                  <Bar dataKey={metric} name={met.label} radius={[6, 6, 0, 0]} maxBarSize={56}>
                    <LabelList dataKey={metric} position="top"
                               formatter={(v) => (v ? (metric === "hours" ? Number(v).toFixed(1) : v) : "")}
                               style={{ fontSize: 11, fontWeight: 800, fill: "#334155" }} />
                    {chartData.map((d, i) => (
                      <Cell key={i}
                            fill={group === "machine" && selMachineNo
                              ? (d.name === selMachineNo ? met.color : "#cbd5e1")
                              : met.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

/* Taller canvas when many machine bars need angled labels. */
function groupHeight(group, n) {
  if (group === "zone") return 360;
  return n > 14 ? 430 : 400;
}
