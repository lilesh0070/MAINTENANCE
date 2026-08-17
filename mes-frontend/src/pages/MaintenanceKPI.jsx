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
  async put(path, body, token) {
    const r = await fetch(API + path, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
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

// Chart-bar colour = each card's accent made LIGHTER but still vivid.  We raise
// the lightness in HSL (instead of mixing toward white, which looked washed out
// / dull) so the hue keeps its full saturation.
function barColor(hex) {
  const h2 = String(hex || "#1e40af").replace("#", "");
  const r0 = parseInt(h2.slice(0, 2), 16) / 255,
        g0 = parseInt(h2.slice(2, 4), 16) / 255,
        b0 = parseInt(h2.slice(4, 6), 16) / 255;
  const max = Math.max(r0, g0, b0), min = Math.min(r0, g0, b0), d = max - min;
  let h = 0, s = 0; let l = (max + min) / 2;
  if (d) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r0 ? (g0 - b0) / d + (g0 < b0 ? 6 : 0)
      : max === g0 ? (b0 - r0) / d + 2
      :              (r0 - g0) / d + 4;
    h /= 6;
  }
  l = Math.min(l + 0.20, 0.66);   // lighter but keep saturation → vivid tint
  const hue = (p, q, t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue(p, q, h + 1 / 3); g = hue(p, q, h); b = hue(p, q, h - 1 / 3);
  }
  const toHex = (x) => Math.round(x * 255).toString(16).padStart(2, "0");
  return "#" + toHex(r) + toHex(g) + toHex(b);
}

// The six cards — each keeps its own accent colour.  val(): pick + format
// from metrics.
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
function MetricChart({ def, series, target, accent, barFill, yMax, cfg }) {
  const c = accent || def.accent;             // card's accent — dot
  const bar = barFill || barColor(c);         // bars: lighter but still vivid
  const cc = cfg || CHART_D;
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
        <ResponsiveContainer width="100%" height={cc.height ?? 208}>
          <ComposedChart data={data} margin={{ top: 22, right: 10, left: -10, bottom: 0 }}>
            {cc.grid !== false && <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />}
            <XAxis dataKey="month" interval={0} tick={{ fontSize: 10.5, fill: cc.axisColor || "#64748b", fontWeight: 600 }}
                   axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: cc.axisColor || "#64748b" }}
                   axisLine={false} tickLine={false} width={34}
                   domain={yMax != null ? [0, yMax]
                     : [0, (dataMax) => Math.max(1, Math.ceil(Math.max((dataMax || 1) * 1.2, t != null ? t * 1.15 : 0)))]} />
            <Tooltip
              cursor={{ fill: "rgba(148,163,184,.10)" }}
              contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 12,
                              boxShadow: "0 6px 18px rgba(15,23,42,.10)" }}
              labelStyle={{ fontWeight: 700, color: "#0f172a" }}
              formatter={(v) => [Number(v).toLocaleString("en-IN"), def.label]}
            />
            <Bar dataKey={def.key} name={def.label} fill={bar}
                 radius={[cc.barRadius ?? 4, cc.barRadius ?? 4, 0, 0]} barSize={cc.barSize ?? 24} maxBarSize={80}
                 isAnimationActive={false}>
              {cc.labels !== false && (
                <LabelList dataKey={def.key} position="top" formatter={chartNum}
                           fill="#0f172a" fontSize={11} fontWeight={700} />
              )}
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

function KpiCard({ def, metrics, accent, cfg }) {
  const a = accent || def.accent;
  const c = cfg || CARD_D;
  const v = metrics ? def.val(metrics) : "—";
  const sub = metrics ? def.sub(metrics) : "";
  return (
    <div className="mk-card" style={{
      borderTop: `${c.borderW ?? 3}px solid ${a}`,
      background: c.bg || "#fff",
      borderRadius: c.radius ?? 16,
      boxShadow: c.shadow === false ? "none" : undefined,
    }}>
      <div className="mk-card-label" style={{ color: c.labelColor || "#64748b" }}>{def.label}</div>
      <div className="mk-card-value" style={{ color: a, fontSize: c.valueSize ?? 48 }}>{v}</div>
      <div className="mk-card-unit">{def.unit}</div>
      {sub && <div className="mk-card-sub">{sub}</div>}
    </div>
  );
}

// Defaults for the admin-customizable card + chart styling (match the CSS).
const CARD_D  = { bg: "#ffffff", valueSize: 48, labelColor: "#64748b", borderW: 3, radius: 16, shadow: true };
const CHART_D = { barSize: 24, barRadius: 4, height: 208, grid: true, labels: true, axisColor: "#64748b" };

// Inline styles for the admin "Customize" panel.
const custBtn   = { border: "1px solid #cbd5e1", background: "#fff", color: "#1e40af", fontWeight: 700, fontSize: 12, borderRadius: 8, padding: "5px 11px", cursor: "pointer", fontFamily: "inherit", marginRight: 6 };
const custTabBtn = (on) => ({ border: on ? "none" : "1px solid #cbd5e1", background: on ? "linear-gradient(135deg,#1e40af,#2563eb)" : "#fff", color: on ? "#fff" : "#475569", fontWeight: 700, fontSize: 12.5, borderRadius: 8, padding: "7px 20px", cursor: "pointer", fontFamily: "inherit" });
const custField  = { display: "flex", flexDirection: "column", gap: 5, fontSize: 11, fontWeight: 700, color: "#64748b" };
const custSecTitle = { fontWeight: 800, fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: ".06em", margin: "4px 0 8px" };
const custControls = { display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 18, padding: "12px 14px", background: "#fafbfc", border: "1px solid #eef2f7", borderRadius: 10 };
const custPanel = { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 16, marginBottom: 18, boxShadow: "0 4px 16px rgba(15,23,42,.06)" };
const custCard  = { border: "1px solid #eef2f7", borderRadius: 10, padding: "10px 12px", background: "#fafbfc" };
const custLbl   = { display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, color: "#64748b" };
const custColor = { width: 36, height: 26, border: "1px solid #cbd5e1", borderRadius: 6, padding: 0, cursor: "pointer", background: "#fff" };
const custNum   = { width: 72, border: "1.5px solid #e2e8f0", borderRadius: 6, padding: "4px 6px", fontSize: 12, fontFamily: "inherit" };
const custGhost = { border: "1px solid #e2e8f0", background: "#fff", color: "#475569", fontWeight: 700, fontSize: 11, borderRadius: 7, padding: "4px 9px", cursor: "pointer", fontFamily: "inherit" };
const custSave  = { border: "none", background: "linear-gradient(135deg,#1e40af,#2563eb)", color: "#fff", fontWeight: 700, fontSize: 12, borderRadius: 8, padding: "6px 14px", cursor: "pointer", fontFamily: "inherit" };

// Current financial year (Apr–Mar), e.g. "2026-27".  The page opens on it so
// real data shows immediately — no flash of an empty older default year.
const CUR_FY = (() => {
  const d = new Date();
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}-${String(y + 1).slice(-2)}`;
})();

export default function MaintenanceKPI() {
  const { token, theme, user } = useAuth();
  const [years, setYears]     = useState([]);
  const [fy, setFy]           = useState(CUR_FY);   // open on current FY (data shows at once)
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
  const isAdmin = user?.role === "admin";

  // Admin-editable appearance — /api/kpi-ui-settings.  Shape:
  //   { card:{…global…}, chart:{…global…}, kpi:{ <key>:{accent,bar,yMax} } }
  const [ui, setUi]             = useState({});
  const [showCust, setShowCust] = useState(false);
  const [custTab, setCustTab]   = useState("card");   // "card" | "chart"
  const [savingUi, setSavingUi] = useState(false);
  useEffect(() => {
    if (!token) return;
    api.get("/api/kpi-ui-settings/", token)
      .then((r) => setUi((r && r.settings) || {}))
      .catch(() => {});
  }, [token]);
  const cardCfg  = { ...CARD_D,  ...(ui.card  || {}) };
  const chartCfg = { ...CHART_D, ...(ui.chart || {}) };
  const kpiStyle = (key, defAccent) => {
    const s = (ui.kpi && ui.kpi[key]) || {};
    const accent = s.accent || defAccent;
    return { accent, bar: s.bar || barColor(accent),
             yMax: (s.yMax != null && Number(s.yMax) > 0) ? Number(s.yMax) : null };
  };
  const setCard  = (f, v) => setUi((p) => ({ ...p, card:  { ...(p.card  || {}), [f]: v } }));
  const setChart = (f, v) => setUi((p) => ({ ...p, chart: { ...(p.chart || {}), [f]: v } }));
  const setKpi   = (key, f, v) => setUi((p) => ({ ...p, kpi: { ...(p.kpi || {}), [key]: { ...((p.kpi || {})[key] || {}), [f]: v } } }));
  const resetKpi = (key) => setUi((p) => { const k = { ...(p.kpi || {}) }; delete k[key]; return { ...p, kpi: k }; });
  const saveUi = async () => {
    setSavingUi(true);
    try { await api.put("/api/kpi-ui-settings/", { settings: ui }, token); setShowCust(false); }
    catch (e) { alert(e.message || "Save failed"); }
    finally { setSavingUi(false); }
  };
  // Fullscreen toggle (for the TV display).
  const goFullscreen = () => {
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen();
    } catch { /* ignore */ }
  };

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

        /* ── Portrait / vertical TV (e.g. 65" mounted vertical) ─────────────
           3 cards per row (3×2) + 3 charts per row (3×2), full-width. */
        @media (orientation: portrait) {
          .mk-body   { padding: 0 22px 44px; }
          .mk-grid   { grid-template-columns: repeat(3, 1fr) !important; gap: 20px; }
          .mk-charts { grid-template-columns: repeat(3, 1fr) !important; gap: 20px; }
          .mk-card-label   { font-size: 13px; }
          .mk-charts-title { font-size: 26px; }
          .mk-fybar        { flex-wrap: wrap; row-gap: 10px; }
        }
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
                {years.length === 0 && <option value={CUR_FY}>{CUR_FY}</option>}
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
              <button onClick={goFullscreen} style={custBtn} title="Fullscreen (TV)">⛶ Fullscreen</button>
              {isAdmin && (
                <button onClick={() => setShowCust((v) => !v)} style={custBtn}>⚙ Customize</button>
              )}
              <span className="mk-dot" />
              {loading ? "Loading…"
                : lastTick ? `Live · updated ${lastTick.toLocaleTimeString("en-IN")}`
                : "Live"}
            </div>
          </div>

          {isAdmin && showCust && (
            <div style={custPanel}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
                <div style={{ fontWeight: 800, fontSize: 14, color: "#0f172a" }}>
                  ⚙ Customize{" "}
                  <span style={{ fontWeight: 600, fontSize: 11, color: "#94a3b8" }}>(admin · applies for everyone · live preview)</span>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => setUi({})} style={custGhost}>Reset all</button>
                  <button onClick={saveUi} disabled={savingUi} style={custSave}>{savingUi ? "Saving…" : "Save"}</button>
                </div>
              </div>

              {/* Card | Charts */}
              <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                <button onClick={() => setCustTab("card")}  style={custTabBtn(custTab === "card")}>Cards</button>
                <button onClick={() => setCustTab("chart")} style={custTabBtn(custTab === "chart")}>Charts</button>
              </div>

              {custTab === "card" ? (
                <>
                  <div style={custSecTitle}>All cards</div>
                  <div style={custControls}>
                    <label style={custField}>Background
                      <input type="color" value={cardCfg.bg} onChange={(e) => setCard("bg", e.target.value)} style={custColor} /></label>
                    <label style={custField}>Label colour
                      <input type="color" value={cardCfg.labelColor} onChange={(e) => setCard("labelColor", e.target.value)} style={custColor} /></label>
                    <label style={custField}>Value size
                      <input type="number" min="20" max="90" value={cardCfg.valueSize} onChange={(e) => setCard("valueSize", Number(e.target.value))} style={custNum} /></label>
                    <label style={custField}>Border width
                      <input type="number" min="0" max="12" value={cardCfg.borderW} onChange={(e) => setCard("borderW", Number(e.target.value))} style={custNum} /></label>
                    <label style={custField}>Corner radius
                      <input type="number" min="0" max="30" value={cardCfg.radius} onChange={(e) => setCard("radius", Number(e.target.value))} style={custNum} /></label>
                    <label style={{ ...custField, flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <input type="checkbox" checked={cardCfg.shadow !== false} onChange={(e) => setCard("shadow", e.target.checked)} style={{ width: 18, height: 18 }} />Shadow</label>
                  </div>
                  <div style={custSecTitle}>Per-card colour</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(210px,1fr))", gap: 10 }}>
                    {CARDS.map((def) => {
                      const accent = (ui.kpi && ui.kpi[def.key] && ui.kpi[def.key].accent) || def.accent;
                      return (
                        <div key={def.key} style={{ ...custCard, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                          <span style={{ fontWeight: 700, fontSize: 12, color: "#0f172a" }}>{def.label}</span>
                          <input type="color" value={accent} onChange={(e) => setKpi(def.key, "accent", e.target.value)} style={custColor} />
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <>
                  <div style={custSecTitle}>All charts</div>
                  <div style={custControls}>
                    <label style={custField}>Bar width
                      <input type="number" min="6" max="60" value={chartCfg.barSize} onChange={(e) => setChart("barSize", Number(e.target.value))} style={custNum} /></label>
                    <label style={custField}>Bar radius
                      <input type="number" min="0" max="20" value={chartCfg.barRadius} onChange={(e) => setChart("barRadius", Number(e.target.value))} style={custNum} /></label>
                    <label style={custField}>Chart height
                      <input type="number" min="140" max="360" value={chartCfg.height} onChange={(e) => setChart("height", Number(e.target.value))} style={custNum} /></label>
                    <label style={custField}>Axis colour
                      <input type="color" value={chartCfg.axisColor} onChange={(e) => setChart("axisColor", e.target.value)} style={custColor} /></label>
                    <label style={{ ...custField, flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <input type="checkbox" checked={chartCfg.grid !== false} onChange={(e) => setChart("grid", e.target.checked)} style={{ width: 18, height: 18 }} />Grid</label>
                    <label style={{ ...custField, flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <input type="checkbox" checked={chartCfg.labels !== false} onChange={(e) => setChart("labels", e.target.checked)} style={{ width: 18, height: 18 }} />Value labels</label>
                  </div>
                  <div style={custSecTitle}>Per-chart</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 10 }}>
                    {CARDS.map((def) => {
                      const s = (ui.kpi && ui.kpi[def.key]) || {};
                      const accent = s.accent || def.accent;
                      const bar = s.bar || barColor(accent);
                      return (
                        <div key={def.key} style={custCard}>
                          <div style={{ fontWeight: 700, fontSize: 12, color: "#0f172a", marginBottom: 8 }}>{def.label}</div>
                          <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
                            <label style={custLbl}>Bar
                              <input type="color" value={bar} onChange={(e) => setKpi(def.key, "bar", e.target.value)} style={custColor} /></label>
                            <label style={custLbl}>Axis max
                              <input type="number" min="0" placeholder="auto" value={s.yMax ?? ""}
                                     onChange={(e) => setKpi(def.key, "yMax", e.target.value === "" ? null : Number(e.target.value))} style={custNum} /></label>
                            <button onClick={() => resetKpi(def.key)} style={custGhost}>Reset</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              <div style={{ fontSize: 11, color: "#64748b", marginTop: 14 }}>
                Changes turant preview hote hain. <b>Save</b> pe sabke liye apply. Bar default = card color ka light version; axis max blank = auto.
              </div>
            </div>
          )}

          {err && <div className="mk-err">{err}</div>}

          {/* ── KPI cards ─────────────────────────────────── */}
          <div className="mk-grid">
            {CARDS.map((def) => (
              <KpiCard key={def.key} def={def} metrics={metrics}
                       accent={kpiStyle(def.key, def.accent).accent} cfg={cardCfg} />
            ))}
          </div>

          {/* ── Per-card charts (month-by-month for the FY) ─── */}
          <div className="mk-charts-title">Monthly Trend — {data?.fy_label || fy}</div>
          <div className="mk-charts">
            {CARDS.map((def) => {
              const st = kpiStyle(def.key, def.accent);
              return (
                <MetricChart key={def.key} def={def} series={trend} target={targetFor(def.key)}
                             accent={st.accent} barFill={st.bar} yMax={st.yMax} cfg={chartCfg} />
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
