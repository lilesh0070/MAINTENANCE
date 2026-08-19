/* MaintenanceAnnualIndex.jsx — "Global Maintenance Index" annual report.

   Replicates the Book1.xlsx "Year Data" format: one block per KPI showing the
   monthly target, the 12 month-wise actuals (Apr → Mar), the yearly roll-up
   (Total / MAX / Average) and a per-month Judgment row (○ met, × missed).

   Data: /api/maintenance-kpi/trend (plant-wide monthly actuals) +
   /api/maintenance-kpi-target (MONTHLY targets).  Opened from a button on the
   Maintenance KPI page. */
import { useEffect, useState, useCallback } from "react";
import { useAuth } from "../context/AuthContext";

const MONTHS = ["Apr", "May", "Jun", "Jul", "Aug", "Sep",
                "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];

// KPI blocks (MTBF intentionally left out — matches the source format).
//   sk = trend series key · tk = target key · agg = yearly roll-up · dec = round
const IDX = [
  { no: 1, title: "The number of Long downtime (more than 1 hour)",
    sk: "over_1hr_count", tk: "over_1hr_count", tl: "Target(times/month)",
    agg: "sum", al: "Total", rl: "total target", dec: 0 },
  { no: 2, title: "LTTR (Longest Time To Repair)",
    sk: "lttr_hours", tk: "lttr_minutes", tl: "Target(Hr.)",
    agg: "max", al: "MAX", rl: "MAX target", dec: 2 },
  { no: 3, title: "Total breakdown number",
    sk: "breakdown_frequency", tk: "breakdown_frequency", tl: "Target(times/month)",
    agg: "sum", al: "Total", rl: "total target", dec: 0 },
  { no: 4, title: "Total downtime",
    sk: "total_breakdown_hours", tk: "total_breakdown_hours", tl: "Target(Hr.)",
    agg: "sum", al: "Total", rl: "total target", dec: 1 },
  { no: 5, title: "MTTR (Mean Time To Repair (Recovery))",
    sk: "mttr_minutes", tk: "mttr_minutes", tl: "Target(min.)",
    agg: "average", al: "Average", rl: "target", dec: 2 },
];

const apiGet = async (path, token) => {
  const r = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
  return r.json();
};
// page FY "2026-27" → target-table FY "2026-2027"
const longFy = (f) => {
  const [a, b] = String(f).split("-");
  return b && b.length === 2 ? `${a}-${a.slice(0, 2)}${b}` : f;
};
// round to `dec` and trim trailing zeros; null → ""
const num = (n, dec) => {
  if (n == null || isNaN(n)) return "";
  const v = Math.round(Number(n) * 10 ** dec) / 10 ** dec;
  return String(v);
};

export function MaintenanceAnnualIndex({ fy, onBack }) {
  const { token } = useAuth();
  const [series, setSeries] = useState([]);
  const [tmap, setTmap]     = useState({});
  const [loading, setLoad]  = useState(true);
  const [err, setErr]       = useState("");
  const [tick, setTick]     = useState(null);   // last live-refresh time

  const load = useCallback(async () => {
    if (!token || !fy) return;
    setLoad(true); setErr("");
    try {
      const [tr, tg] = await Promise.all([
        apiGet(`/api/maintenance-kpi/trend?fy=${encodeURIComponent(fy)}`, token),
        apiGet(`/api/maintenance-kpi-target/?fy=${encodeURIComponent(longFy(fy))}`, token),
      ]);
      setSeries(Array.isArray(tr?.series) ? tr.series : []);
      const g = {};
      (Array.isArray(tg) ? tg : []).filter((r) => r.level === "MONTHLY")
        .forEach((r) => { (g[r.kpi_key] = g[r.kpi_key] || []).push(Number(r.target_value)); });
      const m = {};
      Object.entries(g).forEach(([k, v]) => { m[k] = v.reduce((s, x) => s + x, 0) / v.length; });
      setTmap(m);
      setTick(new Date());
    } catch (e) { setErr(e.message || "Load failed"); }
    finally { setLoad(false); }
  }, [fy, token]);
  // load on open + FY change, and auto-refresh every 30s while open (live).
  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  const y1 = parseInt(String(fy).slice(0, 4), 10) || new Date().getFullYear();
  const y2 = y1 + 1;

  // per-KPI computed block
  const active = (i) => Number(series[i]?.breakdown_frequency ?? 0) > 0;
  const blocks = IDX.map((k) => {
    const mt = tmap[k.tk];                       // monthly target (may be undefined)
    const acts = MONTHS.map((_, i) => Number(series[i]?.[k.sk] ?? 0));
    let agg;
    if (k.agg === "sum")      agg = acts.reduce((s, x) => s + x, 0);
    else if (k.agg === "max") agg = acts.length ? Math.max(...acts) : 0;
    else {                                        // average of ACTIVE months only
      const av = acts.filter((_, i) => active(i));
      agg = av.length ? av.reduce((s, x) => s + x, 0) / av.length : 0;
    }
    const annual = mt == null ? null : (k.agg === "sum" ? mt * 12 : mt);
    const jm = (v) => (mt == null ? "" : v <= mt ? "○" : "×");   // lower-is-better
    const monthJ = MONTHS.map((_, i) => (active(i) ? jm(acts[i]) : ""));
    const overallJ = annual == null ? "" : (agg <= annual ? "○" : "×");
    return { k, mt, acts, agg, annual, monthJ, overallJ };
  });

  const J = (s) => (s === "○" ? <span className="ix-ok">○</span>
                  : s === "×" ? <span className="ix-no">×</span> : "");

  return (
    <div className="ix-root">
      <style>{`
        .ix-root { background:#f1f5f9; min-height:100vh; padding:20px 26px 60px; font-family:'Barlow',sans-serif; }
        .ix-bar { display:flex; align-items:center; gap:16px; margin-bottom:18px; flex-wrap:wrap; }
        .ix-back { border:1px solid #cbd5e1; background:#fff; border-radius:8px; padding:7px 14px; font-weight:700; font-size:13px; cursor:pointer; color:#334155; }
        .ix-back:hover { background:#f8fafc; }
        .ix-h1 { font-family:'Barlow Condensed',sans-serif; font-weight:800; font-size:24px; color:#0f172a; letter-spacing:.02em; }
        .ix-h1 b { color:#1e40af; }
        .ix-live { margin-left:auto; font-size:12px; font-weight:700; color:#16a34a; display:inline-flex; align-items:center; gap:6px; }
        .ix-sheet { background:#fff; border:1px solid #cbd5e1; border-radius:10px; padding:16px; max-width:1180px; box-shadow:0 2px 10px rgba(15,23,42,.05); overflow-x:auto; }
        .ix-sec { font-weight:800; font-size:14px; color:#fff; background:#334155; padding:7px 12px; border-radius:6px 6px 0 0; margin-top:22px; }
        .ix-sec:first-child { margin-top:0; }
        .ix-tbl { width:100%; border-collapse:collapse; font-size:12px; min-width:940px; }
        .ix-tbl th, .ix-tbl td { border:1px solid #94a3b8; padding:4px 6px; text-align:center; }
        .ix-tbl thead th { background:#e2e8f0; font-weight:700; color:#334155; }
        .ix-tbl .ix-yr { background:#dbeafe; }
        .ix-name { font-weight:800; color:#0f172a; }
        .ix-tgt { font-weight:800; color:#b45309; background:#fff7ed; }
        .ix-act { font-weight:700; color:#1d4ed8; }
        .ix-blank { background:#f8fafc; color:#cbd5e1; }
        .ix-agg { font-weight:800; color:#0f172a; background:#f1f5f9; }
        .ix-annual { font-weight:800; color:#dc2626; background:#fef2f2; }
        .ix-jlabel { font-weight:800; color:#475569; background:#f8fafc; }
        .ix-ok { color:#16a34a; font-weight:800; font-size:14px; }
        .ix-no { color:#dc2626; font-weight:800; font-size:14px; }
        .ix-note { font-size:11px; color:#64748b; margin-top:14px; line-height:1.5; }
      `}</style>

      <div className="ix-bar">
        <button className="ix-back" onClick={onBack}>← Back to KPI</button>
        <div className="ix-h1">Global Maintenance <b>Index</b> · TBDI · FY {fy}</div>
        <span className="ix-live">🟢 Live{tick ? ` · updated ${tick.toLocaleTimeString("en-IN")}` : ""}</span>
      </div>

      {err && <div style={{ color: "#dc2626", fontWeight: 700, marginBottom: 12 }}>⚠ {err}</div>}
      {loading ? (
        <div style={{ color: "#64748b", fontWeight: 600 }}>Loading…</div>
      ) : (
        <div className="ix-sheet">
          {blocks.map((b) => (
            <div key={b.k.no}>
              <div className="ix-sec">{b.k.no}. {b.k.title}</div>
              <table className="ix-tbl">
                <thead>
                  <tr>
                    <th rowSpan={2} style={{ width: 34 }}>Sr</th>
                    <th rowSpan={2} style={{ width: 120 }}>Factory/Division name</th>
                    <th rowSpan={2} style={{ width: 92 }}>{b.k.tl}</th>
                    <th className="ix-yr" colSpan={9}>{y1}</th>
                    <th className="ix-yr" colSpan={3}>{y2}</th>
                    <th rowSpan={2} style={{ width: 72 }}>{b.k.al}</th>
                    <th style={{ width: 78 }}>Annual</th>
                  </tr>
                  <tr>
                    {MONTHS.map((m) => <th key={m}>{m}</th>)}
                    <th>{b.k.rl}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td rowSpan={2}>{b.k.no}</td>
                    <td rowSpan={2} className="ix-name">TBDI</td>
                    <td className="ix-tgt">{num(b.mt, 2)}</td>
                    {b.acts.map((v, i) => (
                      <td key={i} className={active(i) ? "ix-act" : "ix-blank"}>
                        {active(i) ? num(v, b.k.dec) : "–"}
                      </td>
                    ))}
                    <td className="ix-agg">{num(b.agg, b.k.dec)}</td>
                    <td rowSpan={2} className="ix-annual">{num(b.annual, b.k.dec)}</td>
                  </tr>
                  <tr>
                    <td className="ix-jlabel">Judgment</td>
                    {b.monthJ.map((s, i) => <td key={i}>{J(s)}</td>)}
                    <td className="ix-agg">{J(b.overallJ)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ))}
          <div className="ix-note">
            <b>○</b> = target achieved (actual ≤ target) &nbsp;·&nbsp; <b>×</b> = target not achieved &nbsp;·&nbsp;
            "–" = us month me abhi koi breakdown data nahi. &nbsp;
            Aggregate: <b>Total</b> = 12 months ka sum · <b>MAX</b> = sabse zyada · <b>Average</b> = filled months ka mean.
            Data live: breakdown register + KPI monthly targets.
          </div>
        </div>
      )}
    </div>
  );
}
