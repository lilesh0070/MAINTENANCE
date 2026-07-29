/* ───────────────────────────────────────────────────────────────────
 * MaintenanceOverview.jsx
 * ───────────────────────────────────────────────────────────────────
 * "Overview" — Tool & Die Maintenance management dashboard.  Dark, at-a-glance
 * view built entirely from OUR data (no dummy numbers):
 *   • KPI tiles  ........ /api/maintenance-kpi/summary   (mes_breakdown_data)
 *   • Breakdown trend ... /api/maintenance-kpi/trend
 *   • By zone / machine . /api/maintenance-kpi/breakdown-by?group=zone|machine
 *   • CAPA .............. /api/capa-lb/summary
 *   • PM compliance ..... /api/pm/dashboard
 *   • Spare usage ....... /api/spares/consumption
 * Layout is inspired by the reference dashboard, numbers are 100% live.
 * Routing: /maintenance-overview  (sidebar → Overview)
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart, Pie, Cell, BarChart, Bar,
} from "recharts";
import TvFit from "../components/TvFit";
import { useDisplay } from "../context/DisplayContext";

const api = {
  async get(path, token) {
    const r = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
    return r.json();
  },
};

// chart series palette (dark-bg friendly)
const C = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#a855f7", "#06b6d4", "#ec4899", "#14b8a6"];
const n1 = (v) => (Math.round((Number(v) || 0) * 10) / 10).toLocaleString();
const n0 = (v) => Math.round(Number(v) || 0).toLocaleString();
// "2026-04" → "Apr" (readable month tick); anything else passes through.
const MO_ABBR = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const moLabel = (m) => {
  const mo = parseInt(String(m).split("-")[1], 10);
  return mo >= 1 && mo <= 12 ? MO_ABBR[mo] : String(m ?? "");
};

export default function MaintenanceOverview() {
  const { token, user } = useAuth();
  const { theme: dtTheme } = useDisplay();   // "dark" (native) | "light" (skin)
  const nav = useNavigate();

  const [fy, setFy]       = useState("");        // "" → backend uses current FY
  const [years, setYears] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr]     = useState("");

  const [sum, setSum]     = useState(null);
  const [trend, setTrend] = useState([]);
  const [byZone, setByZone]   = useState([]);
  const [byMc, setByMc]       = useState([]);
  const [capa, setCapa]   = useState(null);
  const [pm, setPm]       = useState(null);
  const [spare, setSpare] = useState(null);
  const [tick, setTick]   = useState(null);

  // FY list (default the picker to the current FY once loaded)
  useEffect(() => {
    if (!token) return;
    api.get("/api/maintenance-kpi/financial-years", token)
      .then((y) => {
        const list = Array.isArray(y) ? y : [];
        setYears(list);
        const cur = list.find((x) => x.is_current);
        if (cur) setFy(cur.fy);
      })
      .catch(() => setYears([]));
  }, [token]);

  const load = useCallback(async (silent) => {
    if (!token) return;
    if (!silent) setLoading(true);
    const qs = fy ? `?fy=${encodeURIComponent(fy)}` : "";
    try {
      const [s, t, z, m, cp, p, sp] = await Promise.all([
        api.get(`/api/maintenance-kpi/summary${qs}`, token),
        api.get(`/api/maintenance-kpi/trend${qs}`, token),
        api.get(`/api/maintenance-kpi/breakdown-by?group=zone${fy ? `&fy=${encodeURIComponent(fy)}` : ""}`, token),
        api.get(`/api/maintenance-kpi/breakdown-by?group=machine${fy ? `&fy=${encodeURIComponent(fy)}` : ""}`, token),
        api.get("/api/capa-lb/summary", token).catch(() => null),
        api.get(`/api/pm/compliance${qs}`, token).catch(() => null),
        api.get("/api/spares/consumption?limit=20000", token).catch(() => null),
      ]);
      setSum(s?.metrics || null);
      setTrend(Array.isArray(t?.series) ? t.series : []);
      setByZone(Array.isArray(z?.rows) ? z.rows : []);
      setByMc(Array.isArray(m?.rows) ? m.rows : []);
      setCapa(cp || null);
      setPm(p || null);
      setSpare(sp || null);
      setErr("");
      setTick(new Date());
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }, [token, fy]);

  useEffect(() => { load(false); }, [load]);
  useEffect(() => {
    const id = setInterval(() => load(true), 15000);   // live refresh
    return () => clearInterval(id);
  }, [load]);

  // ── derived ────────────────────────────────────────────────────────
  const pmPct = pm?.pct ?? 0;

  const topMc = useMemo(
    () => [...byMc].sort((a, b) => (b.hours || 0) - (a.hours || 0)).slice(0, 6), [byMc]);

  const zonePie = useMemo(
    () => byZone.filter((r) => (r.frequency || 0) > 0)
      .map((r, i) => ({ name: r.key || "—", value: r.frequency, hours: r.hours, fill: C[i % C.length] })), [byZone]);

  const trendData = useMemo(
    () => trend.map((s) => ({ month: s.month, count: s.breakdown_frequency || 0, hours: Math.round((s.total_breakdown_hours || 0) * 10) / 10 })), [trend]);

  const alerts = useMemo(() => {
    const a = [];
    if ((capa?.open_count || 0) > 0)
      a.push({ t: "danger", h: `${capa.open_count} CAPA open`, s: "≥60-min breakdowns pending closure" });
    if ((pm?.pending || 0) > 0)
      a.push({ t: "warn", h: `${pm.pending} PM pending`, s: "PM schedule not yet completed" });
    if ((sum?.over_1hr_count || 0) > 0)
      a.push({ t: "warn", h: `${sum.over_1hr_count} breakdowns > 1 hr`, s: "long-downtime events this FY" });
    if (!a.length) a.push({ t: "ok", h: "All clear", s: "no open CAPA / pending PM / long breakdowns" });
    return a;
  }, [capa, pm, sum]);

  const KPIS = [
    { label: "TOTAL BREAKDOWNS", val: n0(sum?.breakdown_frequency), unit: "", sub: "this financial year", color: "#3b82f6" },
    { label: "MTTR",            val: n1(sum?.mttr_minutes),         unit: "min", sub: "mean time to repair", color: "#a855f7" },
    { label: "TOTAL DOWNTIME",  val: n1(sum?.total_breakdown_hours), unit: "Hrs", sub: "sum of repair time", color: "#06b6d4" },
    { label: "PM COMPLIANCE",   val: `${pmPct}`,                    unit: "%", sub: `${pm?.done || 0}/${pm?.scheduled || 0} done this FY`, color: "#22c55e" },
    { label: "OPEN CAPA",       val: n0(capa?.open_count),          unit: "", sub: `${capa?.closed_count || 0} closed`, color: "#ef4444" },
  ];

  const today = new Date();
  const dstr = today.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const tstr = tick ? tick.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "—";

  return (
    <TvFit designWidth={1500} bg="#0a1120">
    <>
      <style>{`
        .ov-root { min-height:100vh; background:#0a1120; font-family:'Barlow',system-ui,sans-serif;
                   color:#e2e8f0; padding:0 0 46px; }
        .ov-top { background:linear-gradient(180deg,#0f1c33,#0b1526); border-bottom:1px solid #1e293b;
                  padding:16px 26px 16px 92px; display:flex; align-items:center; justify-content:space-between;
                  flex-wrap:wrap; gap:14px; position:sticky; top:0; z-index:40; }
        .ov-ttl { font-size:22px; font-weight:800; letter-spacing:.02em; color:#fff; line-height:1.05; }
        .ov-ttl b { color:#f59e0b; }
        .ov-sub { font-size:12px; font-weight:700; letter-spacing:.18em; color:#3b82f6; text-transform:uppercase; }
        .ov-meta { display:flex; align-items:center; gap:18px; font-size:13px; color:#94a3b8; }
        .ov-live { display:inline-flex; align-items:center; gap:6px; color:#22c55e; font-weight:700; font-size:12px; }
        .ov-dot { width:8px; height:8px; border-radius:50%; background:#22c55e; box-shadow:0 0 0 0 rgba(34,197,94,.6);
                  animation:ovp 1.6s infinite; }
        @keyframes ovp { 0%{box-shadow:0 0 0 0 rgba(34,197,94,.5)} 70%{box-shadow:0 0 0 7px rgba(34,197,94,0)} 100%{box-shadow:0 0 0 0 rgba(34,197,94,0)} }
        .ov-fy { background:#0b1526; border:1.5px solid #334155; color:#e2e8f0; font-weight:700; font-size:13px;
                 border-radius:8px; padding:7px 11px; outline:none; }
        .ov-body { max-width:1500px; margin:18px auto 0; padding:0 22px; }
        .ov-cards { display:grid; grid-template-columns:repeat(5,1fr); gap:14px; margin-bottom:16px; }
        .ov-card { background:linear-gradient(160deg,#111f38,#0d1830); border:1px solid #1e293b; border-radius:13px;
                   padding:15px 16px; position:relative; overflow:hidden; }
        .ov-card::before { content:''; position:absolute; left:0; top:0; bottom:0; width:4px; background:var(--c); }
        .ov-card .lbl { font-size:10.5px; font-weight:800; letter-spacing:.08em; color:#94a3b8; text-transform:uppercase; }
        .ov-card .big { font-size:32px; font-weight:800; color:#fff; margin-top:6px; line-height:1; }
        .ov-card .big span { font-size:14px; font-weight:700; color:#94a3b8; margin-left:4px; }
        .ov-card .sub { font-size:11px; color:#64748b; margin-top:7px; }
        .ov-grid { display:grid; gap:14px; margin-bottom:16px; }
        .ov-g23 { grid-template-columns:1.55fr 1fr; }
        .ov-g12 { grid-template-columns:1fr 1.4fr; }
        .ov-g3  { grid-template-columns:repeat(3,1fr); }
        .ov-panel { background:#0e1a30; border:1px solid #1e293b; border-radius:13px; padding:15px 16px; min-width:0; }
        .ov-ph { font-size:12px; font-weight:800; letter-spacing:.06em; color:#cbd5e1; text-transform:uppercase;
                 margin-bottom:12px; display:flex; align-items:center; justify-content:space-between; }
        .ov-ph small { font-size:10px; font-weight:700; color:#64748b; letter-spacing:.04em; }
        .ov-tbl { width:100%; border-collapse:collapse; font-size:12.5px; }
        .ov-tbl th { text-align:left; padding:8px 10px; font-size:9.5px; font-weight:700; letter-spacing:.05em;
                     text-transform:uppercase; color:#64748b; border-bottom:1px solid #1e293b; }
        .ov-tbl td { padding:9px 10px; border-bottom:1px solid #16233c; color:#cbd5e1; white-space:nowrap; }
        .ov-tbl td.r, .ov-tbl th.r { text-align:right; }
        .ov-bar { height:7px; border-radius:4px; background:#1e293b; overflow:hidden; min-width:70px; }
        .ov-bar > i { display:block; height:100%; border-radius:4px; }
        .ov-alert { display:flex; gap:11px; align-items:flex-start; padding:11px 0; border-bottom:1px solid #16233c; }
        .ov-alert:last-child { border-bottom:0; }
        .ov-ico { width:26px; height:26px; border-radius:7px; display:grid; place-items:center; font-size:14px; flex:0 0 auto; }
        .ov-alert .ah { font-weight:700; font-size:13px; color:#e2e8f0; }
        .ov-alert .as { font-size:11.5px; color:#748099; margin-top:2px; }
        .ov-gauge { text-align:center; padding:6px 0 2px; }
        .ov-gauge .pct { font-size:40px; font-weight:800; color:#22c55e; line-height:1; }
        .ov-gwrap { display:flex; gap:18px; align-items:center; }
        .ov-glist { flex:1; }
        .ov-grow { display:flex; justify-content:space-between; font-size:12.5px; padding:6px 0; border-bottom:1px solid #16233c; }
        .ov-grow b { color:#fff; }
        .ov-empty { padding:26px; text-align:center; color:#64748b; font-size:13px; }
        .ov-chips { display:flex; gap:10px; flex-wrap:wrap; }
        .ov-chip { flex:1; min-width:110px; background:#0b1526; border:1px solid #1e293b; border-radius:10px; padding:11px 12px; }
        .ov-chip .cv { font-size:24px; font-weight:800; color:#fff; }
        .ov-chip .cl { font-size:10.5px; font-weight:700; letter-spacing:.05em; color:#94a3b8; text-transform:uppercase; margin-top:3px; }
        @media (max-width:1100px){ .ov-cards{grid-template-columns:repeat(2,1fr)} .ov-g23,.ov-g12,.ov-g3{grid-template-columns:1fr} }

        /* ── LIGHT skin (toolbar Light/Dark toggle) — Overview is dark by
              default; these overrides flip its main surfaces to light. ── */
        .ov-root[data-dt="light"] { background:#eef2f7; color:#0f172a; }
        .ov-root[data-dt="light"] .ov-top { background:linear-gradient(180deg,#ffffff,#f1f5f9); border-bottom-color:#e2e8f0; }
        .ov-root[data-dt="light"] .ov-ttl { color:#0f172a; }
        .ov-root[data-dt="light"] .ov-meta { color:#475569; }
        .ov-root[data-dt="light"] .ov-fy { background:#fff; border-color:#cbd5e1; color:#0f172a; }
        .ov-root[data-dt="light"] .ov-card { background:linear-gradient(160deg,#ffffff,#f8fafc); border-color:#e2e8f0; }
        .ov-root[data-dt="light"] .ov-card .big { color:#0f172a; }
        .ov-root[data-dt="light"] .ov-panel { background:#ffffff; border-color:#e2e8f0; }
        .ov-root[data-dt="light"] .ov-ph { color:#334155; }
        .ov-root[data-dt="light"] .ov-tbl th { color:#64748b; border-bottom-color:#e2e8f0; }
        .ov-root[data-dt="light"] .ov-tbl td { color:#334155; border-bottom-color:#eef2f7; }
        .ov-root[data-dt="light"] .ov-chip { background:#f1f5f9; border-color:#e2e8f0; }
        .ov-root[data-dt="light"] .ov-bar { background:#e2e8f0; }
        .ov-root[data-dt="light"] .ov-alert { border-bottom-color:#eef2f7; }
        .ov-root[data-dt="light"] .ov-alert .ah { color:#0f172a; }
        .ov-root[data-dt="light"] .ov-empty { color:#94a3b8; }
      `}</style>

      <div className="ov-root" data-dt={dtTheme}>
        <div className="ov-top">
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <button className="ov-fy" onClick={() => nav("/dashboard")}>← Back</button>
            <div>
              <div className="ov-ttl">MAINTENANCE <b>OVERVIEW</b></div>
              <div className="ov-sub">Management Dashboard</div>
            </div>
          </div>
          <div className="ov-meta">
            <span>📅 {dstr}</span>
            <span>🕒 {tstr}</span>
            <span className="ov-live"><i className="ov-dot" /> Live</span>
            <select className="ov-fy" value={fy} onChange={(e) => setFy(e.target.value)}>
              {years.map((y) => <option key={y.fy} value={y.fy}>{y.fy}{y.is_current ? " (current)" : ""}</option>)}
            </select>
            {user?.username && <span style={{ fontWeight: 600 }}>{user.username}</span>}
          </div>
        </div>

        <div className="ov-body">
          {err && <div className="ov-panel" style={{ borderColor: "#7f1d1d", color: "#fca5a5", marginBottom: 14 }}>⚠ {err}</div>}

          {/* KPI tiles */}
          <div className="ov-cards">
            {KPIS.map((k) => (
              <div className="ov-card" key={k.label} style={{ "--c": k.color }}>
                <div className="lbl">{k.label}</div>
                <div className="big">{loading ? "…" : k.val}{k.unit && <span>{k.unit}</span>}</div>
                <div className="sub">{k.sub}</div>
              </div>
            ))}
          </div>

          {/* Trend + Zone donut */}
          <div className="ov-grid ov-g23">
            <div className="ov-panel">
              <div className="ov-ph">Breakdown Trend <small>this FY · count &amp; downtime hrs</small></div>
              {trendData.length ? (
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={trendData} margin={{ top: 6, right: 12, left: -8, bottom: 0 }}>
                    <CartesianGrid stroke="#1e293b" vertical={false} />
                    <XAxis dataKey="month" stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={{ stroke: "#1e293b" }} tickFormatter={moLabel} />
                    <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip contentStyle={{ background: "#0b1526", border: "1px solid #334155", borderRadius: 8, color: "#e2e8f0" }}
                             labelFormatter={moLabel} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="count" name="Breakdowns" stroke="#3b82f6" strokeWidth={2.5} dot={{ r: 3 }} isAnimationActive={false} />
                    <Line type="monotone" dataKey="hours" name="Downtime (hrs)" stroke="#f59e0b" strokeWidth={2.5} dot={{ r: 3 }} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : <div className="ov-empty">No breakdown data for this FY yet.</div>}
            </div>

            <div className="ov-panel">
              <div className="ov-ph">Breakdowns by Zone <small>frequency</small></div>
              {zonePie.length ? (
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie data={zonePie} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={54} outerRadius={92}
                         paddingAngle={2} isAnimationActive={false} labelLine={false}
                         label={({ cx, cy, midAngle, innerRadius, outerRadius, value }) => {
                           const R = Math.PI / 180;
                           const r = innerRadius + (outerRadius - innerRadius) * 0.5;
                           const x = cx + r * Math.cos(-midAngle * R);
                           const y = cy + r * Math.sin(-midAngle * R);
                           return (
                             <text x={x} y={y} fill="#fff" fontSize={12} fontWeight="700"
                                   textAnchor="middle" dominantBaseline="central">{value}</text>
                           );
                         }}>
                      {zonePie.map((e, i) => <Cell key={i} fill={e.fill} stroke="#0e1a30" strokeWidth={2} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: "#0b1526", border: "1px solid #334155", borderRadius: 8, color: "#e2e8f0" }} />
                    <Legend wrapperStyle={{ fontSize: 11 }}
                            formatter={(val) => { const z = zonePie.find((p) => p.name === val); return z ? `${val}  ·  ${z.value}` : val; }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : <div className="ov-empty">No zone breakdowns yet.</div>}
            </div>
          </div>

          {/* PM gauge + Top machines table */}
          <div className="ov-grid ov-g12">
            <div className="ov-panel">
              <div className="ov-ph">PM Compliance <small>this month</small></div>
              <div className="ov-gwrap">
                <div className="ov-gauge">
                  <div className="pct" style={{ color: pmPct >= 90 ? "#22c55e" : pmPct >= 70 ? "#f59e0b" : "#ef4444" }}>{pmPct}%</div>
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>completed</div>
                </div>
                <div className="ov-glist">
                  <div className="ov-grow"><span>Scheduled</span><b>{n0(pm?.scheduled)}</b></div>
                  <div className="ov-grow"><span>Done</span><b style={{ color: "#22c55e" }}>{n0(pm?.done)}</b></div>
                  <div className="ov-grow"><span>Pending</span><b style={{ color: "#f59e0b" }}>{n0(pm?.pending)}</b></div>
                </div>
              </div>
              <div className="ov-bar" style={{ marginTop: 12, height: 9 }}>
                <i style={{ width: `${pmPct}%`, background: pmPct >= 90 ? "#22c55e" : pmPct >= 70 ? "#f59e0b" : "#ef4444" }} />
              </div>
            </div>

            <div className="ov-panel">
              <div className="ov-ph">Top Machines by Downtime <small>this FY</small></div>
              {topMc.length ? (
                <table className="ov-tbl">
                  <thead><tr><th>Machine No.</th><th className="r">Downtime (hrs)</th><th className="r">Count</th><th style={{ width: "28%" }}></th></tr></thead>
                  <tbody>
                    {topMc.map((m, i) => {
                      const max = topMc[0]?.hours || 1;
                      return (
                        <tr key={m.key}>
                          <td style={{ color: "#fff", fontWeight: 600 }}>{m.key || "—"}</td>
                          <td className="r">{n1(m.hours)}</td>
                          <td className="r">{n0(m.frequency)}</td>
                          <td><div className="ov-bar"><i style={{ width: `${Math.max(6, (m.hours / max) * 100)}%`, background: C[i % C.length] }} /></div></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : <div className="ov-empty">No machine downtime yet.</div>}
            </div>
          </div>

          {/* CAPA + Spares + Alerts */}
          <div className="ov-grid ov-g3">
            <div className="ov-panel">
              <div className="ov-ph">CAPA Status</div>
              <div className="ov-chips">
                <div className="ov-chip"><div className="cv" style={{ color: "#ef4444" }}>{n0(capa?.open_count)}</div><div className="cl">Open</div></div>
                <div className="ov-chip"><div className="cv" style={{ color: "#22c55e" }}>{n0(capa?.closed_count)}</div><div className="cl">Closed</div></div>
              </div>
              <div style={{ fontSize: 11.5, color: "#64748b", marginTop: 12 }}>
                A CAPA is auto-raised for every breakdown ≥ 60 min.
              </div>
            </div>

            <div className="ov-panel">
              <div className="ov-ph">Spare Consumption <small>all time</small></div>
              <div className="ov-chips">
                <div className="ov-chip"><div className="cv">{n0(spare?.qty_total)}</div><div className="cl">Total qty</div></div>
                <div className="ov-chip"><div className="cv">{n0(spare?.total)}</div><div className="cl">Line items</div></div>
              </div>
              <div className="ov-glist" style={{ marginTop: 10 }}>
                <div className="ov-grow"><span>Manual Slip</span><b>{n0(spare?.by_source?.["Manual Slip"])}</b></div>
                <div className="ov-grow"><span>Log Book</span><b>{n0(spare?.by_source?.["Log Book"])}</b></div>
              </div>
            </div>

            <div className="ov-panel">
              <div className="ov-ph">Alerts &amp; Notifications</div>
              {alerts.map((a, i) => {
                const map = { danger: ["#7f1d1d33", "#ef4444", "⚠"], warn: ["#78350f33", "#f59e0b", "⚠"], ok: ["#14532d33", "#22c55e", "✓"] };
                const [bg, col, ic] = map[a.t];
                return (
                  <div className="ov-alert" key={i}>
                    <div className="ov-ico" style={{ background: bg, color: col }}>{ic}</div>
                    <div><div className="ah">{a.h}</div><div className="as">{a.s}</div></div>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ fontSize: 11, color: "#475569", marginTop: 6 }}>
            Live from mes_breakdown_data · maintenance_qpr · pm_schedule · maintenance_spare — auto-refresh 15s.
          </div>
        </div>
      </div>
    </>
    </TvFit>
  );
}
