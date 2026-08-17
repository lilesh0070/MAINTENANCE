/* ───────────────────────────────────────────────────────────────────
 * MaintenanceKPI.jsx
 * ───────────────────────────────────────────────────────────────────
 * Standalone "Maintenance KPI" page.
 *
 *   • Top-right: a Financial Year selector (Apr → Mar, e.g. 2025-26).
 *     Defaults to FY 2025-26 and lists every year up to the current FY.
 *   • Six headline cards, refreshed live every 12 s:
 *        – MTTR  (mean time to repair, minutes)
 *        – MTBF  (mean time between failures, hours)
 *        – LTTR  (longest time to repair, minutes)
 *        – Breakdowns > 1 hour (count)
 *        – Total breakdown frequency (count)
 *        – Total breakdown hours
 *
 * Data: GET /api/maintenance-kpi/summary?fy=YYYY-YY  (recomputed from
 * the filled slips on every call) and GET /api/maintenance-kpi/financial-years.
 *
 * Routing: /maintenance-kpi — gated to maintenance department users
 * (and admin) via canAccess('maintenance-kpi').
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { onlyProdZones } from "../constants/zones";
import {
  ResponsiveContainer, ComposedChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, LabelList, ReferenceLine,
} from "recharts";

const API = "";
const api = {
  async get(path, token) {
    const r = await fetch(API + path, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
    return r.json();
  },
};

const POLL_MS = 12000;

// 1234.5 → "1,234.5"; null → "—"
function fmt(n, digits = 1, dash = "—") {
  if (n == null || (typeof n === "number" && isNaN(n))) return dash;
  return Number(n).toLocaleString("en-IN", {
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  });
}

// minutes → friendly "Xh Ym" sub-line
function asHm(min) {
  if (min == null || isNaN(min)) return "";
  const s = Math.round(min);
  if (s < 60) return `${s} min`;
  const h = Math.floor(s / 60), m = s % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

// One professional accent used across every card + chart (no per-metric
// rainbow): values, bars, top-borders and dots.  Secondary text is one grey.
const KPI_COLOR = "#1e40af";

// The six cards — driven off the /summary `metrics` object.
// val(): pick + format from metrics.
const CARDS = [
  {
    key: "mttr_minutes", label: "MTTR", accent: "#b45309",
    unit: "minutes", sub: (m) => asHm(m.mttr_minutes),
    val: (m) => fmt(m.mttr_minutes, 1),
    hint: "Mean Time To Repair",
  },
  {
    key: "mtbf_days", label: "MTBF", accent: "#16a34a",
    unit: "days", sub: () => "between failures",
    val: (m) => (m.mtbf_days == null ? "—" : fmt(m.mtbf_days, 2)),
    hint: "Mean Time Between Failures — (running hours × machines − breakdown hours) ÷ frequency ÷ 24. Running hours 'MTBF Calculation' page se aate hain.",
  },
  {
    key: "lttr_hours", label: "LTTR", accent: "#dc2626",
    unit: "hours", sub: (m) => asHm(m.lttr_minutes),
    val: (m) => fmt(m.lttr_hours, 2),
    hint: "Longest Time To Repair — the single breakdown that took the most time",
  },
  {
    key: "over_1hr_count", label: "More than 1 Hour", accent: "#7c3aed",
    unit: "breakdowns", sub: () => "duration > 60 min",
    val: (m) => fmt(m.over_1hr_count, 0),
    hint: "Breakdowns that took over an hour",
  },
  {
    key: "breakdown_frequency", label: "Total Breakdown Frequency", accent: "#1e40af",
    unit: "breakdowns", sub: () => "this financial year",
    val: (m) => fmt(m.breakdown_frequency, 0),
    hint: "Total number of breakdowns",
  },
  {
    key: "total_breakdown_hours", label: "Total Breakdown Hours", accent: "#0e7490",
    unit: "hours", sub: (m) => asHm(m.total_breakdown_hours * 60),
    val: (m) => fmt(m.total_breakdown_hours, 2),
    hint: "Cumulative downtime",
  },
];

// Compact number for the always-on data labels (e.g. 1234.5 → "1,234.5")
function chartNum(v) {
  if (v == null || (typeof v === "number" && isNaN(v))) return "";
  return Number(v).toLocaleString("en-IN", { maximumFractionDigits: 1 });
}

// One chart per KPI card — the metric plotted month-by-month across the
// financial year (Apr → Mar).  Clean solid bars (each metric's stable accent)
// with always-on black value labels.  When a REAL target is saved for the
// current FY + scope in KPI Targets, it is drawn as a red dashed line.
function MetricChart({ def, series, target }) {
  const c = KPI_COLOR;
  const data = series || [];
  const t = target != null && target !== "" ? Number(target) : null;
  return (
    <div className="mk-chart">
      <div className="mk-chart-head">
        <span className="mk-chart-dot" style={{ background: c }} />
        {def.label}
        <span className="mk-chart-unit">· {def.unit} / month</span>
        {t != null && <span className="mk-chart-target">Target: {t}</span>}
      </div>
      <div className="mk-chart-body">
        <ResponsiveContainer width="100%" height={208}>
          <ComposedChart data={data} margin={{ top: 22, right: 10, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
            <XAxis dataKey="month" interval={0} tick={{ fontSize: 10.5, fill: "#64748b", fontWeight: 600 }}
                   axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: "#64748b" }}
                   axisLine={false} tickLine={false} width={34}
                   domain={[0, (dataMax) => Math.max(1, Math.ceil(Math.max((dataMax || 1) * 1.2, t != null ? t * 1.15 : 0)))]} />
            <Tooltip
              cursor={{ fill: "rgba(148,163,184,.10)" }}
              contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 12,
                              boxShadow: "0 6px 18px rgba(15,23,42,.10)" }}
              labelStyle={{ fontWeight: 700, color: "#0f172a" }}
              formatter={(v) => [Number(v).toLocaleString("en-IN"), def.label]}
            />
            <Bar dataKey={def.key} name={def.label} fill={c}
                 radius={[4, 4, 0, 0]} barSize={24} maxBarSize={36}
                 isAnimationActive={false}>
              <LabelList dataKey={def.key} position="top" formatter={chartNum}
                         fill="#0f172a" fontSize={11} fontWeight={700} />
            </Bar>
            {t != null && (
              <ReferenceLine y={t} stroke="#dc2626" strokeWidth={2} strokeDasharray="7 4"
                             label={({ viewBox }) => (
                               /* the target value written just ABOVE the dotted line */
                               <text x={viewBox.x + viewBox.width / 2} y={viewBox.y - 6}
                                     textAnchor="middle" fill="#dc2626"
                                     fontSize={11.5} fontWeight={800}>
                                 Target {t}
                               </text>
                             )} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function KpiCard({ def, metrics }) {
  const v = metrics ? def.val(metrics) : "—";
  const sub = metrics ? def.sub(metrics) : "";
  return (
    <div className="mk-card" style={{ borderTop: `3px solid ${KPI_COLOR}` }}>
      <div className="mk-card-label">{def.label}</div>
      <div className="mk-card-value" style={{ color: KPI_COLOR }}>{v}</div>
      <div className="mk-card-unit">{def.unit}</div>
      {sub && <div className="mk-card-sub">{sub}</div>}
    </div>
  );
}

export default function MaintenanceKPI() {
  const { token, theme, user } = useAuth();
  const [years, setYears]     = useState([]);
  const [fy, setFy]           = useState("2025-26");   // default per requirement
  const [data, setData]       = useState(null);
  const [trend, setTrend]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState("");
  const [lastTick, setLastTick] = useState(null);
  // Filters — sourced from the Machine Master List (same as the Log Book)
  const [master, setMaster]       = useState([]);   // flat maintenance_machines rows
  const [zoneName, setZoneName]   = useState("");
  const [lineName, setLineName]   = useState("");
  const [machineNo, setMachineNo] = useState("");
  // Saved KPI targets (maintenance_kpi_target) for the current FY + scope.
  const [targets, setTargets]     = useState({});   // {kpi_key: target_value}
  const timer = useRef(null);

  // Page FY is "2025-26"; the KPI Target table stores "2025-2026".
  const longFy = (f) => {
    const [a, b] = String(f).split("-");
    return b && b.length === 2 ? `${a}-${a.slice(0, 2)}${b}` : f;
  };

  // Resolve the applicable saved target per KPI for the selected scope:
  // machine filter → MACHINE target, line → LINE, zone → ZONE; no scope → none.
  useEffect(() => {
    if (!token || !fy) { setTargets({}); return; }
    api.get(`/api/maintenance-kpi-target/?fy=${encodeURIComponent(longFy(fy))}`, token)
      .then((rows) => {
        const arr = Array.isArray(rows) ? rows : [];
        const pick = (r) => {
          if (machineNo) return r.level === "MACHINE" && r.zone_name === zoneName &&
                                 r.line_name === lineName && r.machine_no === machineNo;
          if (lineName)  return r.level === "LINE" && r.zone_name === zoneName && r.line_name === lineName;
          if (zoneName)  return r.level === "ZONE" && r.zone_name === zoneName;
          return false;
        };
        const map = {};
        const scoped = arr.filter(pick);
        if (scoped.length) {
          scoped.forEach((r) => { map[r.kpi_key] = Number(r.target_value); });
        } else if (!zoneName && !lineName && !machineNo) {
          // "All Zones" view — combine the ZONE-level monthly targets:
          // SUM for count/hour KPIs, AVERAGE for time/rate KPIs.
          const SUM_KEYS = new Set(["breakdown_frequency", "total_breakdown_hours", "over_1hr_count"]);
          const groups = {};
          arr.filter((r) => r.level === "ZONE").forEach((r) => {
            (groups[r.kpi_key] = groups[r.kpi_key] || []).push(Number(r.target_value));
          });
          Object.entries(groups).forEach(([k, vals]) => {
            const v = SUM_KEYS.has(k)
              ? vals.reduce((s, x) => s + x, 0)
              : vals.reduce((s, x) => s + x, 0) / vals.length;
            map[k] = Math.round(v * 100) / 100;
          });
        }
        setTargets(map);
      })
      .catch(() => setTargets({}));
  }, [token, fy, zoneName, lineName, machineNo]);

  // Chart metric key → target kpi_key (LTTR chart is in hours; its saved
  // target key is 'lttr_minutes' but the value is entered in the same unit
  // the page shows, so it maps straight across).
  const targetFor = (defKey) => {
    let k = defKey;
    if (defKey === "lttr_hours")     k = "lttr_minutes";
    else if (defKey === "mtbf_days") k = "mtbf_hours";   // MTBF target key unchanged
    return targets[k];
  };

  // Load the FY list once + default to the CURRENT financial year.
  const bootedFy = useRef(false);
  useEffect(() => {
    if (!token) return;
    api.get("/api/maintenance-kpi/financial-years", token)
      .then((list) => {
        if (Array.isArray(list) && list.length) {
          setYears(list);
          if (!bootedFy.current) {
            bootedFy.current = true;
            setFy((list.find((y) => y.is_current) || list[list.length - 1]).fy);
          }
        }
      })
      .catch(() => {});
  }, [token]);

  // Filter options come from the Machine Master List (maintenance_machines) — the
  // single master for every filter across the app.
  useEffect(() => {
    if (!token) return;
    api.get("/api/machines/", token)
      .then((m) => setMaster(Array.isArray(m) ? m : []))
      .catch(() => setMaster([]));
  }, [token]);

  // Cascading filter options derived from the master list (production zones only).
  const zoneOpts = onlyProdZones([...new Set(master.map((m) => m.zone_name).filter(Boolean))]);
  const lineOpts = zoneName
    ? [...new Set(master.filter((m) => m.zone_name === zoneName)
                        .map((m) => m.line_name).filter(Boolean))].sort()
    : [];
  const machineOpts = (zoneName && lineName)
    ? [...new Set(master.filter((m) => m.zone_name === zoneName && m.line_name === lineName)
                        .map((m) => m.machine_no).filter(Boolean))].sort()
    : [];
  const onZone = (v) => { setZoneName(v); setLineName(""); setMachineNo(""); };
  const onLine = (v) => { setLineName(v); setMachineNo(""); };

  const load = useCallback(async (silent = false) => {
    if (!token || !fy) return;
    if (!silent) setLoading(true);
    try {
      const qp = new URLSearchParams({ fy });
      if (zoneName)  qp.set("zone_name", zoneName);
      if (lineName)  qp.set("line_name", lineName);
      if (machineNo) qp.set("machine_no", machineNo);
      const qs = qp.toString();
      const [d, t] = await Promise.all([
        api.get(`/api/maintenance-kpi/summary?${qs}`, token),
        api.get(`/api/maintenance-kpi/trend?${qs}`, token),
      ]);
      setData(d);
      setTrend(t?.series || []);
      setErr("");
      setLastTick(new Date());
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }, [token, fy, zoneName, lineName, machineNo]);

  // Fetch on FY change + poll live.
  useEffect(() => {
    load();
    clearInterval(timer.current);
    timer.current = setInterval(() => load(true), POLL_MS);
    return () => clearInterval(timer.current);
  }, [load]);

  const metrics = data?.metrics || null;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700;800&family=Barlow+Condensed:wght@600;700;800&display=swap');
        .mk-root { min-height:100vh; background:#f8fafc; font-family:'Barlow',sans-serif; padding-bottom:60px; }
        .mk-topbar {
          background:#fff; border-bottom:1px solid #e2e8f0;
          padding:0 40px 0 88px; height:60px;
          display:flex; align-items:center; justify-content:space-between;
          position:sticky; top:0; z-index:100;
          box-shadow:0 1px 3px rgba(0,0,0,.06);
        }
        .mk-topbar::after { content:''; position:absolute; bottom:0; left:0; right:0;
                            height:2px; background:${theme.gradient}; }
        .mk-title { position:absolute; left:50%; transform:translateX(-50%);
                    font-family:'Barlow Condensed',sans-serif;
                    font-size:34px; font-weight:800; color:#0f172a;
                    letter-spacing:-.01em; pointer-events:none; white-space:nowrap; }
        .mk-title span { color:${theme.accent}; }
        .mk-user-pill {
          display:flex; align-items:center; gap:10px;
          padding:6px 14px; border-radius:99px;
          border:1.5px solid #e2e8f0; background:#f8fafc;
          font-size:12px; font-weight:600; color:#334155; white-space:nowrap;
        }
        .mk-user-pill b { color:#0f172a; font-weight:800; }
        .mk-body { padding:24px 40px 0; max-width:1280px; margin:0 auto; }

        .mk-fybar { display:flex; align-items:center; justify-content:space-between;
                    gap:16px; flex-wrap:wrap; margin-bottom:22px; }
        .mk-fy-left { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
        .mk-fy-label { font-family:'Barlow Condensed',sans-serif; font-size:13px;
                       font-weight:700; letter-spacing:.1em; text-transform:uppercase;
                       color:#64748b; }
        .mk-fy-select { padding:10px 16px; border-radius:10px;
                        border:1.5px solid ${theme.accent};
                        background:${theme.soft}; color:${theme.accentDark};
                        font-size:15px; font-weight:800; font-family:'Barlow',sans-serif;
                        cursor:pointer; outline:none; min-width:200px; }
        .mk-fy-range { font-size:13px; color:#94a3b8; font-weight:600; }
        .mk-filter { min-width:150px; border:1.5px solid #cbd5e1; background:#fff;
                     color:#334155; font-weight:700; font-size:13px; }
        .mk-filter:disabled { background:#f1f5f9; color:#94a3b8; cursor:not-allowed; }
        .mk-live { display:flex; align-items:center; gap:7px; font-size:12px;
                   font-weight:600; color:#64748b; }
        .mk-dot { width:8px; height:8px; border-radius:50%; background:#16a34a;
                  box-shadow:0 0 0 0 rgba(22,163,74,.5); animation:mkpulse 1.6s infinite; }
        @keyframes mkpulse {
          0%   { box-shadow:0 0 0 0 rgba(22,163,74,.45); }
          70%  { box-shadow:0 0 0 7px rgba(22,163,74,0); }
          100% { box-shadow:0 0 0 0 rgba(22,163,74,0); }
        }

        .mk-grid { display:grid; gap:18px;
                   grid-template-columns:repeat(auto-fill, minmax(250px, 1fr)); }
        .mk-card { background:#fff; border:1px solid #e2e8f0; border-radius:16px;
                   padding:22px 22px 18px; box-shadow:0 1px 3px rgba(0,0,0,.05);
                   transition:transform .15s ease, box-shadow .15s ease; }
        .mk-card:hover { transform:translateY(-3px); box-shadow:0 8px 24px rgba(0,0,0,.09); }
        .mk-card-label { font-size:11px; font-weight:800; letter-spacing:.08em;
                         text-transform:uppercase; color:#64748b; min-height:28px; }
        .mk-card-value { font-family:'Barlow Condensed',sans-serif; font-size:48px;
                         font-weight:800; line-height:1.05; margin-top:6px; }
        .mk-card-unit { font-size:13px; font-weight:700; color:#64748b; margin-top:2px; }
        .mk-card-sub  { font-size:12px; color:#64748b; margin-top:8px; font-weight:600; }
        .mk-card-hint { font-size:11px; color:#cbd5e1; margin-top:10px;
                        border-top:1px dashed #eef2f7; padding-top:8px; }
        .mk-err { background:rgba(220,38,38,.08); border:1px solid rgba(220,38,38,.25);
                  border-radius:10px; padding:12px 16px; color:#b91c1c; font-size:13px;
                  margin-bottom:18px; }

        .mk-charts-title { margin:28px 0 14px; font-family:'Barlow Condensed',sans-serif;
                           font-size:20px; font-weight:800; color:#0f172a;
                           letter-spacing:.02em; text-transform:uppercase; }
        .mk-charts { display:grid; gap:20px;
                     grid-template-columns:repeat(auto-fill, minmax(380px, 1fr)); }
        .mk-chart { background:#fff; border:1px solid #eef2f7; border-radius:16px;
                    padding:18px 18px 12px; box-shadow:0 1px 3px rgba(15,23,42,.05);
                    transition:transform .15s ease, box-shadow .15s ease; }
        .mk-chart:hover { transform:translateY(-3px); box-shadow:0 12px 28px rgba(15,23,42,.10); }
        .mk-chart-head { display:flex; align-items:center; gap:8px; font-size:13px;
                         font-weight:800; color:#0f172a; text-transform:uppercase;
                         letter-spacing:.05em; margin-bottom:10px; }
        .mk-chart-dot { width:10px; height:10px; border-radius:3px; flex-shrink:0; }
        .mk-chart-unit { font-size:11px; font-weight:600; color:#64748b;
                         text-transform:none; letter-spacing:0; }
        .mk-chart-target { margin-left:auto; font-size:11px; font-weight:800; color:#dc2626;
                           background:#fef2f2; border:1px solid #fecaca; border-radius:99px;
                           padding:2px 10px; text-transform:none; letter-spacing:0; }
        .mk-chart-body { width:100%; }
      `}</style>

      <div className="mk-root">
        <div className="mk-topbar">
          <div />
          <div className="mk-title">
            KPI <span>Maintenance</span>
          </div>
          {user?.username && (
            <div className="mk-user-pill">Signed in as <b>{user.username}</b></div>
          )}
        </div>

        <div className="mk-body">
          {/* ── Financial Year selector ───────────────────── */}
          <div className="mk-fybar">
            <div className="mk-fy-left">
              <span className="mk-fy-label">Financial Year</span>
              <select className="mk-fy-select" value={fy}
                      onChange={(e) => setFy(e.target.value)}>
                {years.length === 0 && <option value="2025-26">2025-26</option>}
                {years.map((y) => (
                  <option key={y.fy} value={y.fy}>
                    {y.fy}{y.is_current ? "  (current)" : ""}
                  </option>
                ))}
              </select>
              <select className="mk-fy-select mk-filter" value={zoneName}
                      onChange={(e) => onZone(e.target.value)}>
                <option value="">All Zones</option>
                {zoneOpts.map((z) => <option key={z} value={z}>{z}</option>)}
              </select>
              <select className="mk-fy-select mk-filter" value={lineName}
                      onChange={(e) => onLine(e.target.value)} disabled={!zoneName}>
                <option value="">All Lines</option>
                {lineOpts.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
              <select className="mk-fy-select mk-filter" value={machineNo}
                      onChange={(e) => setMachineNo(e.target.value)} disabled={!lineName}>
                <option value="">All Machine No.</option>
                {machineOpts.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div className="mk-live">
              <span className="mk-dot" />
              {loading ? "Loading…"
                : lastTick ? `Live · updated ${lastTick.toLocaleTimeString("en-IN")}`
                : "Live"}
            </div>
          </div>

          {err && <div className="mk-err">{err}</div>}

          {/* ── KPI cards ─────────────────────────────────── */}
          <div className="mk-grid">
            {CARDS.map((def) => (
              <KpiCard key={def.key} def={def} metrics={metrics} />
            ))}
          </div>

          {/* ── Per-card charts (month-by-month for the FY) ─── */}
          <div className="mk-charts-title">Monthly Trend — {data?.fy_label || fy}</div>
          <div className="mk-charts">
            {CARDS.map((def) => (
              <MetricChart key={def.key} def={def} series={trend} target={targetFor(def.key)} />
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
