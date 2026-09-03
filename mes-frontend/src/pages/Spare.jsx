/* ───────────────────────────────────────────────────────────────────
 * Spare.jsx — "Spare" (Maintenance)
 * ───────────────────────────────────────────────────────────────────
 * Consolidated spare CONSUMPTION report.  Read-only: every row was
 * recorded on the Manual Break Down Slip or the Log Book, which write
 * their spares into the maintenance_spare table.  Sources: Manual Slip · Log Book.
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, LabelList,
} from "recharts";
import { useAuth } from "../context/AuthContext";

// Spare data now comes ONLY from the Manual Break Down Slip + Log Book
// (via the maintenance_spare table).  Breakdown-log / PM sources removed.
const SOURCES = ["Manual Slip", "Log Book", "PM"];   // real source values (backend filter)
// Display labels for the Source dropdown — the underlying VALUE stays the real
// source string above (what maintenance_spare stores), only the label changes.
const SRC_LABEL = { "Manual Slip": "Breakdown", "Log Book": "Plan Work", "PM": "Preventive Maintenance" };
const ONE_HUE = "#2563eb";               // single-series charts: one hue, no legend
const TOP_HUE = "#b45309";               // "Most Used Spare" card — green Total se alag dikhe
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

  const booted = useRef(false);   // default the FY to the current one, once
  useEffect(() => {
    if (!token) return;
    api(`/filters`).then((d) => {
      setMachines(d.machines || []);
      const list = d.years || [];
      setYears(list);
      if (!booted.current && list.length) {
        booted.current = true;
        setFFy(list.includes(d.current_fy) ? d.current_fy : list[0]);
      }
    })
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

  /* ── chart data (spare CONSUMPTION = quantity), from the SAME rows ── */
  // Focus month for the zone chart: the picked Month, else the current
  // calendar month.  Format YYYY-MM.
  const focusYm = useMemo(() => {
    if (fFy && fMon !== "") { const [from] = fyRange(fFy, fMon); return from ? from.slice(0, 7) : null; }
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }, [fFy, fMon]);
  const focusLabel = useMemo(() =>
    focusYm ? `${MONTHS[(Number(focusYm.slice(5, 7)) + 8) % 12]} ${focusYm.slice(0, 4)}` : "", [focusYm]);

  // current / selected month → zone-wise consumed quantity
  const zoneThisMonth = useMemo(() => {
    const m = new Map();
    rows.forEach(r => {
      if ((r.used_date || "").slice(0, 7) !== focusYm) return;
      const k = r.zone || "—";
      m.set(k, (m.get(k) || 0) + (Number(r.qty) || 0));
    });
    return [...m.entries()].map(([name, qty]) => ({ name, qty }))
      .sort((a, b) => b.qty - a.qty);
  }, [rows, focusYm]);

  // every month → consumed quantity (trend across the loaded window)
  const byMonthQty = useMemo(() => {
    const m = new Map();
    rows.forEach(r => {
      const k = (r.used_date || "").slice(0, 7);
      if (!k) return;
      m.set(k, (m.get(k) || 0) + (Number(r.qty) || 0));
    });
    return [...m.entries()].map(([k, qty]) => ({
      key: k, label: `${MONTHS[(Number(k.slice(5, 7)) + 8) % 12]} ${k.slice(2, 4)}`, qty,
    })).sort((a, b) => a.key.localeCompare(b.key));
  }, [rows]);

  /* ── spare-wise rollup: kaunsa spare kitna gaya, kitni baar, kitni machine par ──
     qty AUR entries dono rakhte hain kyunki dono alag kahani kehte hain:
     ek 46 ka single entry (CAM SUPPORT JIG — ek hi machine, ek hi baar) aur
     baar-baar aane wala chhota spare (CYLINDER — 6 baar, 4 machine).  Sirf qty
     dikhate to doosri wali kahani chhup jaati, jo maintenance ke liye zyada
     kaam ki hai.  Sab kuch UNHI rows se banta hai jo table/charts use karte
     hain — koi alag API call nahi, filter badle to ye bhi apne aap badalta hai. */
  const spareRank = useMemo(() => {
    const m = new Map();
    rows.forEach(r => {
      const name = (r.spare_name || "").trim() || "(no name)";
      let o = m.get(name);
      if (!o) { o = { name, qty: 0, entries: 0, mset: new Set(), last: "" }; m.set(name, o); }
      o.qty     += Number(r.qty) || 0;
      o.entries += 1;
      if (r.machine_no) o.mset.add(r.machine_no);
      if ((r.used_date || "") > o.last) o.last = r.used_date || "";
    });
    return [...m.values()]
      .map(o => ({ name: o.name, qty: o.qty, entries: o.entries, machines: o.mset.size, last: o.last }))
      .sort((a, b) => b.qty - a.qty || b.entries - a.entries);
  }, [rows]);

  const topSpare = spareRank[0] || null;

  // Ye cards/modal poore FILTER KIYE HUE window ka data dikhate hain (wahi jo
  // Total card aur neeche ki table dikhati hai) — zone-chart wale focus month
  // ka nahi.  Isliye period saaf likh dete hain, warna 64 aur 53 me bhram hota.
  const windowLabel = useMemo(() => {
    if (fFy && fMon !== "") return focusLabel;
    if (fFy) return `FY ${fFy}`;
    return "all data";
  }, [fFy, fMon, focusLabel]);

  // kis spare ka machine-wise breakdown khula hai (null = modal band)
  const [drill, setDrill] = useState(null);
  const drillRows = useMemo(() => {
    if (!drill) return [];
    const m = new Map();
    rows.forEach(r => {
      if (((r.spare_name || "").trim() || "(no name)") !== drill) return;
      const k = `${r.zone || "-"}|${r.line || "-"}|${r.machine_no || "-"}`;
      let o = m.get(k);
      if (!o) {
        o = { zone: r.zone || "—", line: r.line || "—", mno: r.machine_no || "—",
              mname: r.machine_name || "—", qty: 0, entries: 0, last: "" };
        m.set(k, o);
      }
      o.qty     += Number(r.qty) || 0;
      o.entries += 1;
      if ((r.used_date || "") > o.last) o.last = r.used_date || "";
    });
    return [...m.values()].sort((a, b) => b.qty - a.qty || b.entries - a.entries);
  }, [rows, drill]);

  const drillInfo = useMemo(() => spareRank.find(x => x.name === drill) || null, [spareRank, drill]);

  // Esc se band — modal khula ho tabhi listener lagta hai
  useEffect(() => {
    if (!drill) return;
    const onKey = (e) => { if (e.key === "Escape") setDrill(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drill]);

  const exportCsv = () => {
    const head = ["Source", "Date", "Zone", "Line", "Machine No", "Machine Name",
                  "Model No", "Spare ERP No", "Spare Name", "Quantity", "Qty From"];
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
            <div className="sp-sub">Spare consumption — {SOURCES.map(s => SRC_LABEL[s]).join(" · ")}</div>
          </div>
          {user?.username && <span className="app-user" style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>{user.username}</span>}
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
              {SOURCES.map(s => <option key={s} value={s}>{SRC_LABEL[s]}</option>)}
            </select>
          </div>
          <div className="sp-fld">
            <label>Search</label>
            <input className="sp-sel" value={q} onChange={(e) => setQ(e.target.value)}
                   placeholder="spare name / ERP no / model" style={{ minWidth: 210 }} />
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
          {/* ── KPI cards: kul consumption + sabse zyada use hua spare ── */}
          <div style={{ marginBottom: 14, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "stretch" }}>
            <div className="sp-card" style={{ borderTop: "3px solid #16a34a", minWidth: 240, padding: "12px 22px" }}>
              <div style={{ fontSize: 11, color: "#64748b", fontWeight: 800, letterSpacing: ".04em", textTransform: "uppercase" }}>Total Spare Consumption</div>
              <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 40, fontWeight: 800, color: "#16a34a", lineHeight: 1.05 }}>
                {data?.qty_total ?? "—"}
              </div>
              <div style={{ fontSize: 10.5, color: "#94a3b8", fontWeight: 700 }}>
                {data ? `${data.total} entries${data.qty_unknown ? ` · ${data.qty_unknown} without qty` : ""}` : ""}
              </div>
            </div>

            {/* Click par machine-wise breakdown.  Poora card hi button hai
                (keyboard se bhi khulta hai) — chhote "view" link se click
                karna TV/tablet par mushkil hota hai. */}
            {topSpare && (
              <div className="sp-card sp-top" role="button" tabIndex={0}
                   onClick={() => setDrill(topSpare.name)}
                   onKeyDown={(e) => {
                     if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDrill(topSpare.name); }
                   }}
                   title="Click to see which machines used this spare"
                   style={{ borderTop: `3px solid ${TOP_HUE}`, minWidth: 268, maxWidth: 430,
                            padding: "12px 22px", cursor: "pointer" }}>
                <div style={{ fontSize: 11, color: "#64748b", fontWeight: 800, letterSpacing: ".04em", textTransform: "uppercase" }}>Most Used Spare</div>
                <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 27, fontWeight: 800,
                              color: TOP_HUE, lineHeight: 1.12, wordBreak: "break-word" }}>
                  {topSpare.name}
                </div>
                <div style={{ fontSize: 10.5, color: "#94a3b8", fontWeight: 700 }}>
                  {topSpare.qty} qty · {topSpare.entries} {topSpare.entries === 1 ? "entry" : "entries"}
                  {" · "}{topSpare.machines} {topSpare.machines === 1 ? "machine" : "machines"}
                </div>
                <div style={{ fontSize: 10.5, color: TOP_HUE, fontWeight: 800, marginTop: 5 }}>
                  View machines →
                </div>
              </div>
            )}
          </div>

          {err && <div className="sp-card" style={{ marginBottom: 14, color: "#dc2626", fontWeight: 700, fontSize: 12.5 }}>{err}</div>}

          {/* ── charts: current-month zone consumption + monthly consumption ── */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 14, marginBottom: 14 }}>
            <div className="sp-card">
              <h3 className="sp-ch">Zone-wise spare consumption — {focusLabel || "current month"}</h3>
              <div className="sp-cs">Spare quantity consumed by zone this month</div>
              {zoneThisMonth.length === 0 ? (
                <div style={{ padding: "24px 0", textAlign: "center", color: "#94a3b8", fontSize: 12.5, fontStyle: "italic" }}>
                  {focusLabel} has no spare consumption.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={Math.max(200, zoneThisMonth.length * 30 + 24)}>
                  <BarChart data={zoneThisMonth} layout="vertical" margin={{ top: 4, right: 34, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" horizontal={false} />
                    <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} />
                    <YAxis type="category" dataKey="name" width={132}
                           tick={{ fontSize: 11, fill: "#334155" }} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={tip} itemStyle={{ color: "#fff" }} labelStyle={{ color: "#cbd5e1", fontWeight: 700 }}
                             cursor={{ fill: "rgba(37,99,235,.06)" }} />
                    <Bar dataKey="qty" name="Spare consumed" fill={ONE_HUE} radius={[0, 4, 4, 0]}
                         maxBarSize={22} isAnimationActive={false}>
                      <LabelList dataKey="qty" position="right" style={{ fontSize: 11, fontWeight: 800, fill: "#475569" }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="sp-card">
              <h3 className="sp-ch">Monthly spare consumption</h3>
              <div className="sp-cs">Spare quantity consumed each month</div>
              {byMonthQty.length === 0 ? (
                <div style={{ padding: "24px 0", textAlign: "center", color: "#94a3b8", fontSize: 12.5, fontStyle: "italic" }}>
                  No spare consumption for these filters.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={byMonthQty} margin={{ top: 16, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={{ stroke: "#e2e8f0" }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={tip} itemStyle={{ color: "#fff" }} labelStyle={{ color: "#cbd5e1", fontWeight: 700 }}
                             cursor={{ fill: "rgba(37,99,235,.06)" }} />
                    <Bar dataKey="qty" name="Spare consumed" fill={ONE_HUE} radius={[4, 4, 0, 0]}
                         maxBarSize={46} isAnimationActive={false}>
                      <LabelList dataKey="qty" position="top" style={{ fontSize: 10.5, fontWeight: 800, fill: "#475569" }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* how much of the Quantity column is real vs read from text */}
          {data && (data.qty_guessed > 0 || data.qty_unknown > 0) && (
            <div className="sp-card" style={{ marginBottom: 14, fontSize: 11.5, color: "#92400e",
                                              background: "#fffbeb", borderColor: "#fde68a" }}>
              ⓘ Quantity: <b>{data.qty_recorded}</b> rows had the quantity entered directly on the Manual Slip / Log Book.
              <b> {data.qty_guessed}</b> rows were read from free text — those are shown with a <b>~</b>.
              <b> {data.qty_unknown}</b> rows had no quantity written in the text, so those cells are left blank
              (better than showing a wrong number). That is why the charts count entries, not quantity.
            </div>
          )}

          {/* ── table ── */}
          <div className="sp-card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ maxHeight: "60vh", overflow: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["Date", "Zone", "Line", "Machine No.", "Machine Name",
                      "Model No.", "Spare ERP No.", "Spare Name", "Qty"].map(h => (
                      <th key={h} style={{ ...th, textAlign: h === "Qty" ? "center" : "left" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {busy && (
                    <tr><td colSpan={9} style={{ ...td, textAlign: "center", color: "#94a3b8", padding: 26 }}>Loading…</td></tr>
                  )}
                  {!busy && rows.length === 0 && (
                    <tr><td colSpan={9} style={{ ...td, textAlign: "center", color: "#64748b", padding: 26 }}>
                      No spares found for these filters.
                    </td></tr>
                  )}
                  {!busy && rows.map((r, i) => (
                    <tr key={`${r.source}-${r.ref_id}-${i}`} className="sp-row">
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
                          <span style={{ color: "#cbd5e1" }} title="No quantity was written in the text">—</span>
                        ) : r.qty_source === "recorded" ? (
                          <span style={{ color: "#0f172a" }}>{r.qty}</span>
                        ) : (
                          <span style={{ color: "#b45309" }}
                                title={r.qty_source === "summed"
                                  ? "This entry listed more than one spare — quantities added together"
                                  : "Read from free text (not a recorded value)"}>~{r.qty}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* ── Machine-wise breakdown (Most Used Spare card se khulta hai) ──
          Backdrop par click / Esc se band.  Upar wale chips se doosre spare
          par switch kar sakte hain — sirf top wale par atakna theek nahi
          lagta, kyunki "sabse zyada" qty se aur "sabse baar-baar" entries se
          alag spare nikal sakta hai. */}
      {drill && (
        <div onClick={() => setDrill(null)}
             style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)",
                      backdropFilter: "blur(2px)", zIndex: 9000, display: "flex",
                      alignItems: "flex-start", justifyContent: "center",
                      overflowY: "auto", padding: "32px 12px" }}>
          <div onClick={(e) => e.stopPropagation()}
               style={{ width: "100%", maxWidth: 880, background: "#fff", borderRadius: 12,
                        boxShadow: "0 20px 60px rgba(0,0,0,.35)", overflow: "hidden" }}>

            <div style={{ display: "flex", alignItems: "flex-start", gap: 12,
                          padding: "16px 20px", borderBottom: "1px solid #e2e8f0" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10.5, color: "#64748b", fontWeight: 800,
                              letterSpacing: ".04em", textTransform: "uppercase" }}>
                  Spare used on
                </div>
                <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 26,
                              fontWeight: 800, color: "#0f172a", lineHeight: 1.15,
                              wordBreak: "break-word" }}>{drill}</div>
                {drillInfo && (
                  <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 700 }}>
                    {drillInfo.qty} qty · {drillInfo.entries} {drillInfo.entries === 1 ? "entry" : "entries"}
                    {" · "}{drillRows.length} {drillRows.length === 1 ? "machine" : "machines"}
                    {windowLabel ? ` · ${windowLabel}` : ""}
                  </div>
                )}
              </div>
              <button onClick={() => setDrill(null)}
                      style={{ border: "1px solid #e2e8f0", background: "#f8fafc", borderRadius: 8,
                               width: 30, height: 30, cursor: "pointer", fontSize: 15,
                               color: "#475569", lineHeight: 1, flexShrink: 0 }}
                      title="Close">✕</button>
            </div>

            {spareRank.length > 1 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap",
                            padding: "10px 20px", borderBottom: "1px solid #eef2f7",
                            background: "#fafbfc" }}>
                {spareRank.slice(0, 10).map(sp => (
                  <button key={sp.name} onClick={() => setDrill(sp.name)}
                          title={`${sp.qty} qty · ${sp.entries} entries · ${sp.machines} machines`}
                          style={{ border: "1px solid " + (sp.name === drill ? TOP_HUE : "#e2e8f0"),
                                   background: sp.name === drill ? TOP_HUE : "#fff",
                                   color: sp.name === drill ? "#fff" : "#475569",
                                   borderRadius: 99, padding: "4px 11px", fontSize: 11,
                                   fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
                    {sp.name} <span style={{ opacity: .75 }}>({sp.qty})</span>
                  </button>
                ))}
              </div>
            )}

            <div style={{ maxHeight: "58vh", overflowY: "auto", padding: "0 20px 18px" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 12 }}>
                <thead>
                  <tr>
                    {["Zone", "Line", "Machine No", "Machine Name", "Qty", "Entries", "Last Used"].map(h => (
                      <th key={h} style={th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {drillRows.map((r, i) => (
                    <tr key={i} className="sp-row">
                      <td style={td}>{r.zone}</td>
                      <td style={td}>{r.line}</td>
                      <td style={{ ...td, fontWeight: 700, whiteSpace: "nowrap" }}>{r.mno}</td>
                      <td style={td}>{r.mname}</td>
                      <td style={{ ...td, fontWeight: 800, color: TOP_HUE, textAlign: "right" }}>{r.qty}</td>
                      <td style={{ ...td, textAlign: "right" }}>{r.entries}</td>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>{r.last || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {drillRows.length === 0 && (
                <div style={{ padding: "26px 0", textAlign: "center", color: "#94a3b8",
                              fontSize: 12.5, fontStyle: "italic" }}>
                  No machine recorded for this spare.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
