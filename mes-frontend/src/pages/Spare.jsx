/* ───────────────────────────────────────────────────────────────────
 * Spare.jsx — "Spare" (Maintenance)
 * ───────────────────────────────────────────────────────────────────
 * Consolidated spare CONSUMPTION report.  Read-only: every row was
 * recorded in the page that owns that workflow —
 *   Breakdown  → mes_breakdown_log.spares_detail   (one free-text field)
 *   Log Book   → spare_name / model / CNMM / qty   (properly split)
 *   PM         → entries[].spares_used, APPROVED sheets only
 * Nothing is entered here; fix a wrong entry where it was made.
 *
 * Layout follows the BD Analysis pattern: sticky top bar → one filter
 * row (FY · Month · Zone · Line · Machine No · Machine Name · Source)
 * → KPI tiles → charts → table.
 *
 * Quantity honesty: Log Book has a real qty field.  Breakdown and PM
 * only have free text, so the number there is a best-effort parse and
 * is marked "~".  Where nothing could be read the cell stays blank
 * rather than showing a made-up number.  Charts sum ENTRIES (a count we
 * can trust) — quantity is a secondary line, never the headline.
 *
 * Routing: /maintenance-spare — canAccess('maintenance-spare').
 * ─────────────────────────────────────────────────────────────────── */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, LabelList,
} from "recharts";
import { useAuth } from "../context/AuthContext";

// Spare data now comes ONLY from the Manual Break Down Slip + Log Book
// (via the maintenance_spare table).  Breakdown-log / PM sources removed.
const SOURCES = ["Manual Slip", "Log Book"];
const SRC_COLOR = { "Manual Slip": "#dc2626", "Log Book": "#2563eb" };
const ONE_HUE = "#2563eb";               // single-series charts: one hue, no legend
const MONTHS = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];

/* FY (Apr→Mar) → the date window the API filters on */
function fyRange(fy, monthIdx) {
  if (!fy) return [null, null];
  const s = parseInt(String(fy).split("-")[0], 10);
  if (monthIdx === "" || monthIdx == null) return [`${s}-04-01`, `${s + 1}-03-31`];
  const i = Number(monthIdx);                       // 0 = Apr … 11 = Mar
  const y = i <= 8 ? s : s + 1;
  const m = ((i + 3) % 12) + 1;
  const last = new Date(y, m, 0).getDate();
  return [`${y}-${String(m).padStart(2, "0")}-01`,
          `${y}-${String(m).padStart(2, "0")}-${last}`];
}

export default function Spare() {
  const { theme, token, user } = useAuth();

  const api = useCallback(async (path) => {
    const r = await fetch(`/api/spares${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!r.ok) throw new Error((await r.text().catch(() => "")) || `HTTP ${r.status}`);
    return r.json();
  }, [token]);

  const [machines, setMachines] = useState([]);
  const [years, setYears] = useState([]);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(true);
  const [err, setErr]   = useState("");

  const [fFy, setFFy]     = useState("");
  const [fMon, setFMon]   = useState("");
  const [fZone, setFZone] = useState("");
  const [fLine, setFLine] = useState("");
  const [fMno, setFMno]   = useState("");
  const [fMname, setFMname] = useState("");
  const [fSrc, setFSrc]   = useState("");
  const [q, setQ]         = useState("");

  useEffect(() => {
    if (!token) return;
    api(`/filters`).then((d) => { setMachines(d.machines || []); setYears(d.years || []); })
      .catch(() => { setMachines([]); setYears([]); });
  }, [api, token]);

  const load = useCallback(() => {
    if (!token) return;
    const [from, to] = fyRange(fFy, fMon);
    const p = new URLSearchParams();
    if (fZone) p.set("zone", fZone);
    if (fLine) p.set("line", fLine);
    if (fMno)  p.set("machine_no", fMno);
    if (fSrc)  p.set("source", fSrc);
    if (from)  p.set("date_from", from);
    if (to)    p.set("date_to", to);
    if (q.trim()) p.set("q", q.trim());
    setBusy(true); setErr("");
    api(`/consumption?${p.toString()}`)
      .then(setData)
      .catch((e) => { setErr(String(e.message || e).slice(0, 200)); setData(null); })
      .finally(() => setBusy(false));
  }, [api, token, fFy, fMon, fZone, fLine, fMno, fSrc, q]);

  // load() flips the busy flag synchronously so the spinner shows on every
  // filter change — that is the intended behaviour here.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  // cascade — machine master is the single source for every picker
  const zoneOpts = useMemo(() => [...new Set(machines.map(m => m.zone_name).filter(Boolean))].sort(), [machines]);
  const lineOpts = useMemo(() => fZone
    ? [...new Set(machines.filter(m => m.zone_name === fZone).map(m => m.line_name).filter(Boolean))].sort()
    : [], [machines, fZone]);
  const mnoOpts = useMemo(() => (fZone && fLine)
    ? [...new Set(machines.filter(m => m.zone_name === fZone && m.line_name === fLine)
                          .map(m => m.machine_no).filter(Boolean))].sort()
    : [], [machines, fZone, fLine]);
  const mnameOpts = useMemo(() => (fZone && fLine)
    ? [...new Set(machines.filter(m => m.zone_name === fZone && m.line_name === fLine)
                          .map(m => m.machine_name).filter(Boolean))].sort()
    : [], [machines, fZone, fLine]);

  const onZone = (v) => { setFZone(v); setFLine(""); setFMno(""); setFMname(""); };
  const onLine = (v) => { setFLine(v); setFMno(""); setFMname(""); };
  // picking a name picks its number (and vice-versa) — the API filters on machine_no
  const onMname = (v) => {
    setFMname(v);
    setFMno(machines.find(m => m.zone_name === fZone && m.line_name === fLine && m.machine_name === v)?.machine_no || "");
  };
  const onMno = (v) => {
    setFMno(v);
    setFMname(machines.find(m => m.zone_name === fZone && m.line_name === fLine && m.machine_no === v)?.machine_name || "");
  };
  const clearFilters = () => { setFFy(""); setFMon(""); setFZone(""); setFLine(""); setFMno(""); setFMname(""); setFSrc(""); setQ(""); };

  // memoised so the three chart aggregations below don't re-run on every
  // render (a fresh [] literal would change identity each time)
  const rows = useMemo(() => data?.rows || [], [data]);

  /* ── chart data, derived from the SAME rows the table shows ── */
  const byMonth = useMemo(() => {
    const m = new Map();
    rows.forEach(r => {
      const k = (r.used_date || "").slice(0, 7);
      if (!k) return;
      if (!m.has(k)) m.set(k, { key: k, label: `${MONTHS[(Number(k.slice(5, 7)) + 8) % 12]} ${k.slice(2, 4)}`,
                                "Manual Slip": 0, "Log Book": 0 });
      if (m.get(k)[r.source] != null) m.get(k)[r.source] += 1;
    });
    return [...m.values()].sort((a, b) => a.key.localeCompare(b.key));
  }, [rows]);

  const byMachine = useMemo(() => {
    const m = new Map();
    rows.forEach(r => {
      const k = r.machine_no || "—";
      m.set(k, (m.get(k) || 0) + 1);
    });
    return [...m.entries()].map(([name, entries]) => ({ name, entries }))
      .sort((a, b) => b.entries - a.entries).slice(0, 10).reverse();
  }, [rows]);

  const byZone = useMemo(() => {
    const m = new Map();
    rows.forEach(r => {
      const k = r.zone || "—";
      m.set(k, (m.get(k) || 0) + 1);
    });
    return [...m.entries()].map(([name, entries]) => ({ name, entries }))
      .sort((a, b) => b.entries - a.entries);
  }, [rows]);

  const exportCsv = () => {
    const head = ["Source", "Date", "Zone", "Line", "Machine No", "Machine Name",
                  "Model No", "CNMM No", "Spare Name", "Quantity", "Qty From"];
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const body = rows.map(r => [r.source, r.used_date || "", r.zone || "", r.line || "",
      r.machine_no || "", r.machine_name || "", r.model_no || "", r.cnmm_no || "",
      r.spare_name || "", r.qty ?? "", r.qty_source].map(esc).join(","));
    const blob = new Blob(["﻿" + [head.map(esc).join(","), ...body].join("\r\n")],
                          { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `spare-consumption-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(a.href);
  };

  const td = { border: "1px solid #e2e8f0", padding: "6px 8px", fontSize: 12, color: "#334155", verticalAlign: "top" };
  const th = { border: "1px solid #cbd5e1", padding: "7px 8px", fontSize: 10.5, fontWeight: 800,
               background: "#f1f5f9", color: "#1e293b", textAlign: "left", position: "sticky", top: 0, zIndex: 1, whiteSpace: "nowrap" };

  const tip = { background: "#0f172a", border: "none", borderRadius: 8, fontSize: 12, color: "#fff" };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700;800&family=Barlow+Condensed:wght@600;700;800&display=swap');
        .sp-root { min-height:100vh; background:#f8fafc; font-family:'Barlow',sans-serif; padding-bottom:60px; }
        .sp-top { background:#fff; border-bottom:1px solid #e2e8f0; padding:0 40px 0 88px; height:60px;
          display:flex; align-items:center; justify-content:space-between; position:sticky; top:0; z-index:100;
          box-shadow:0 1px 3px rgba(0,0,0,.06); }
        .sp-top::after { content:''; position:absolute; bottom:0; left:0; right:0; height:2px; background:${theme.gradient}; }
        .sp-title { font-family:'Barlow Condensed',sans-serif; font-size:22px; font-weight:800; color:#0f172a; }
        .sp-title span { color:${theme.accent}; }
        .sp-sub { font-size:11px; color:#94a3b8; margin-top:-2px; }

        .sp-filters { max-width:1600px; margin:16px auto 0; padding:0 22px;
                      display:flex; gap:12px; flex-wrap:wrap; align-items:flex-end; }
        .sp-fld { display:flex; flex-direction:column; gap:5px; }
        .sp-fld label { font-size:10.5px; font-weight:800; letter-spacing:.05em; text-transform:uppercase; color:#64748b; }
        .sp-sel { border:1.5px solid #cbd5e1; border-radius:9px; padding:9px 12px; font-size:13px; font-weight:600;
                  color:#0f172a; outline:none; font-family:'Barlow',sans-serif; background:#fff; min-width:150px; }
        .sp-sel:focus { border-color:${theme.accent}; }
        .sp-sel:disabled { background:#f1f5f9; color:#94a3b8; cursor:not-allowed; }
        .sp-btn { display:flex; align-items:center; gap:6px; font-size:13px; font-weight:700; color:#475569;
                  background:#f1f5f9; border:1px solid #e2e8f0; border-radius:9px; padding:9px 16px; cursor:pointer;
                  font-family:'Barlow',sans-serif; }

        .sp-body { max-width:1600px; margin:16px auto 0; padding:0 22px; }
        .sp-card { background:#fff; border:1px solid #e2e8f0; border-radius:14px;
                   box-shadow:0 1px 4px rgba(15,23,42,.06); padding:16px 18px; }
        .sp-ch { font-size:14px; font-weight:800; color:#0f172a; margin:0 0 2px; }
        .sp-cs { font-size:11px; color:#94a3b8; margin-bottom:10px; }
        .sp-row:nth-child(even) { background:#fafbfc; }
      `}</style>

      <div className="sp-root">
        <div className="sp-top">
          <div>
            <div className="sp-title">🔩 <span>Spare</span></div>
            <div className="sp-sub">Spare consumption — Manual Slip · Log Book</div>
          </div>
          {user?.username && <span style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>{user.username}</span>}
        </div>

        {/* ── one filter row, same shape as the other analysis pages ── */}
        <div className="sp-filters">
          <div className="sp-fld">
            <label>Financial Year</label>
            <select className="sp-sel" value={fFy} onChange={(e) => { setFFy(e.target.value); setFMon(""); }}>
              <option value="">All Financial Years</option>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div className="sp-fld">
            <label>Month</label>
            <select className="sp-sel" value={fMon} onChange={(e) => setFMon(e.target.value)} disabled={!fFy}>
              <option value="">All Months</option>
              {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
            </select>
          </div>
          <div className="sp-fld">
            <label>Zone</label>
            <select className="sp-sel" value={fZone} onChange={(e) => onZone(e.target.value)}>
              <option value="">All Zones</option>
              {zoneOpts.map(z => <option key={z} value={z}>{z}</option>)}
            </select>
          </div>
          <div className="sp-fld">
            <label>Line</label>
            <select className="sp-sel" value={fLine} onChange={(e) => onLine(e.target.value)} disabled={!fZone}>
              <option value="">All Lines</option>
              {lineOpts.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <div className="sp-fld">
            <label>Machine No.</label>
            <select className="sp-sel" value={fMno} onChange={(e) => onMno(e.target.value)} disabled={!fLine}>
              <option value="">All Machine No.</option>
              {mnoOpts.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="sp-fld">
            <label>Machine Name</label>
            <select className="sp-sel" value={fMname} onChange={(e) => onMname(e.target.value)} disabled={!fLine}>
              <option value="">All Machine Names</option>
              {mnameOpts.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="sp-fld">
            <label>Source</label>
            <select className="sp-sel" value={fSrc} onChange={(e) => setFSrc(e.target.value)}>
              <option value="">All Sources</option>
              {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="sp-fld">
            <label>Search</label>
            <input className="sp-sel" value={q} onChange={(e) => setQ(e.target.value)}
                   placeholder="spare name / CNMM / model" style={{ minWidth: 210 }} />
          </div>
          <div className="sp-fld">
            <label>&nbsp;</label>
            <button className="sp-btn" onClick={clearFilters}>✕ Clear</button>
          </div>
          <div className="sp-fld">
            <label>&nbsp;</label>
            <button className="sp-btn" onClick={exportCsv} disabled={!rows.length}
                    style={{ background: rows.length ? "#16a34a" : "#e2e8f0",
                             color: rows.length ? "#fff" : "#94a3b8", border: "none",
                             cursor: rows.length ? "pointer" : "not-allowed" }}>⬇ Export CSV</button>
          </div>
        </div>

        <div className="sp-body">
          {/* ── KPI tiles ── */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
            {[["Spare entries", data?.total ?? "—", "#0f172a", ""],
              ["Total quantity", data?.qty_total ?? "—", "#16a34a", data ? `${data.qty_unknown} rows me qty nahi thi` : ""],
              ...SOURCES.map(s => [s, data?.by_source?.[s] ?? "—", SRC_COLOR[s], ""])].map(([l, v, c, sub]) => (
              <div key={l} className="sp-card" style={{ borderTop: `3px solid ${c}`, minWidth: 140, padding: "10px 16px" }}>
                <div style={{ fontSize: 10.5, color: "#64748b", fontWeight: 700 }}>{l}</div>
                <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 28, fontWeight: 800, color: c, lineHeight: 1.05 }}>{v}</div>
                {sub && <div style={{ fontSize: 9.5, color: "#94a3b8", fontWeight: 700 }}>{sub}</div>}
              </div>
            ))}
          </div>

          {err && <div className="sp-card" style={{ marginBottom: 14, color: "#dc2626", fontWeight: 700, fontSize: 12.5 }}>{err}</div>}

          {/* ── charts ── */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
            <div className="sp-card" style={{ gridColumn: "1 / -1" }}>
              <h3 className="sp-ch">Month-wise spare entries</h3>
              <div className="sp-cs">Kitni baar spare use hua — source ke hisaab se stacked. Quantity nahi, entries gini gayi hain (wo har row me bharosemand hai).</div>
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={byMonth} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={{ stroke: "#e2e8f0" }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={tip} itemStyle={{ color: "#fff" }} labelStyle={{ color: "#cbd5e1", fontWeight: 700 }}
                           cursor={{ fill: "rgba(37,99,235,.06)" }} />
                  <Legend wrapperStyle={{ fontSize: 11.5, fontWeight: 700 }} />
                  {SOURCES.map((s, i) => (
                    <Bar key={s} dataKey={s} stackId="a" fill={SRC_COLOR[s]} isAnimationActive={false}
                         stroke="#fff" strokeWidth={2}
                         radius={i === SOURCES.length - 1 ? [4, 4, 0, 0] : 0} maxBarSize={44} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="sp-card">
              <h3 className="sp-ch">Top 10 machines</h3>
              <div className="sp-cs">Sabse zyada spare kis machine pe laga</div>
              <ResponsiveContainer width="100%" height={Math.max(200, byMachine.length * 26 + 24)}>
                <BarChart data={byMachine} layout="vertical" margin={{ top: 4, right: 30, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="name" width={132}
                         tick={{ fontSize: 10.5, fill: "#334155" }} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={tip} itemStyle={{ color: "#fff" }} labelStyle={{ color: "#cbd5e1", fontWeight: 700 }}
                           cursor={{ fill: "rgba(37,99,235,.06)" }} />
                  <Bar dataKey="entries" name="Spare entries" fill={ONE_HUE} radius={[0, 4, 4, 0]}
                       maxBarSize={16} isAnimationActive={false}>
                    <LabelList dataKey="entries" position="right" style={{ fontSize: 10.5, fontWeight: 800, fill: "#475569" }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="sp-card">
              <h3 className="sp-ch">Zone-wise</h3>
              <div className="sp-cs">Kis zone me sabse zyada spare consumption</div>
              <ResponsiveContainer width="100%" height={Math.max(200, byZone.length * 26 + 24)}>
                <BarChart data={byZone} layout="vertical" margin={{ top: 4, right: 30, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="name" width={132}
                         tick={{ fontSize: 10.5, fill: "#334155" }} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={tip} itemStyle={{ color: "#fff" }} labelStyle={{ color: "#cbd5e1", fontWeight: 700 }}
                           cursor={{ fill: "rgba(37,99,235,.06)" }} />
                  <Bar dataKey="entries" name="Spare entries" fill={ONE_HUE} radius={[0, 4, 4, 0]}
                       maxBarSize={16} isAnimationActive={false}>
                    <LabelList dataKey="entries" position="right" style={{ fontSize: 10.5, fontWeight: 800, fill: "#475569" }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* how much of the Quantity column is real vs read from text */}
          {data && (data.qty_guessed > 0 || data.qty_unknown > 0) && (
            <div className="sp-card" style={{ marginBottom: 14, fontSize: 11.5, color: "#92400e",
                                              background: "#fffbeb", borderColor: "#fde68a" }}>
              ⓘ Quantity: <b>{data.qty_recorded}</b> rows ka number Manual Slip / Log Book me seedha bhara gaya tha.
              <b> {data.qty_guessed}</b> rows text se padha gaya hai — wo <b>~</b> ke saath dikh raha hai.
              <b> {data.qty_unknown}</b> rows me text me quantity likhi hi nahi thi, isliye wahan khaali chhoda hai
              (galat number dikhane se behtar). Charts isliye entries ginte hain, quantity nahi.
            </div>
          )}

          {/* ── table ── */}
          <div className="sp-card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ maxHeight: "60vh", overflow: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["Source", "Date", "Zone", "Line", "Machine No.", "Machine Name",
                      "Model No.", "CNMM No.", "Spare Name", "Qty"].map(h => (
                      <th key={h} style={{ ...th, textAlign: h === "Qty" ? "center" : "left" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {busy && (
                    <tr><td colSpan={10} style={{ ...td, textAlign: "center", color: "#94a3b8", padding: 26 }}>Loading…</td></tr>
                  )}
                  {!busy && rows.length === 0 && (
                    <tr><td colSpan={10} style={{ ...td, textAlign: "center", color: "#64748b", padding: 26 }}>
                      Is filter pe koi spare nahi mila.
                    </td></tr>
                  )}
                  {!busy && rows.map((r, i) => (
                    <tr key={`${r.source}-${r.ref_id}-${i}`} className="sp-row">
                      <td style={td}>
                        <span style={{ padding: "1px 8px", borderRadius: 99, fontSize: 10.5, fontWeight: 800,
                                       background: `${SRC_COLOR[r.source]}18`, color: SRC_COLOR[r.source],
                                       whiteSpace: "nowrap" }}>{r.source}</span>
                      </td>
                      <td style={{ ...td, fontFamily: "monospace", whiteSpace: "nowrap" }}>{r.used_date || "—"}</td>
                      <td style={td}>{r.zone || "—"}</td>
                      <td style={td}>{r.line || "—"}</td>
                      <td style={{ ...td, fontWeight: 800, color: "#0f172a", whiteSpace: "nowrap" }}>{r.machine_no || "—"}</td>
                      <td style={td}>{r.machine_name || "—"}</td>
                      <td style={td}>{r.model_no || "—"}</td>
                      <td style={td}>{r.cnmm_no || "—"}</td>
                      <td style={{ ...td, minWidth: 280 }} title={r.check_point ? `PM point: ${r.check_point}` : ""}>
                        {r.spare_name || "—"}
                      </td>
                      <td style={{ ...td, textAlign: "center", fontWeight: 800, whiteSpace: "nowrap" }}>
                        {r.qty == null ? (
                          <span style={{ color: "#cbd5e1" }} title="Text me quantity likhi hi nahi thi">—</span>
                        ) : r.qty_source === "recorded" ? (
                          <span style={{ color: "#0f172a" }}>{r.qty}</span>
                        ) : (
                          <span style={{ color: "#b45309" }}
                                title={r.qty_source === "summed"
                                  ? "Is text me ek se zyada spare the — sabki quantity jodi gayi hai"
                                  : "Free text se padha gaya (recorded nahi)"}>~{r.qty}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 8 }}>
            Ye sirf report hai — entry yahan se nahi hoti. Spare data ab sirf Manual Break Down Slip aur
            Log Book se aata hai (maintenance_spare table). Galat spare dikhe to wahin theek karo jahan bhara tha.
          </div>
        </div>
      </div>
    </>
  );
}
