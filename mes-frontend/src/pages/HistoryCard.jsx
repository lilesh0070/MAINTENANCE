/* ───────────────────────────────────────────────────────────────────
 * HistoryCard.jsx
 * ───────────────────────────────────────────────────────────────────
 * "History Card" — zone-wise machine history MERGED from BOTH the Log Book
 * (maintenance_logbook_db_history) and the Manual Break Down Slip
 * (maintenance_breakdown_data).  Pick a Zone tab to see every entry for that zone from
 * both registers in one detailed table, tagged by Source, with search + filters.
 *
 * Source: /api/breakdown-logbook/combined (UNION of both tables).
 * Routing: /maintenance-history-card  (top-level sidebar page "History Card")
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
const fmtDate = (d) => (d ? String(d).slice(0, 10) : "—");
// today as YYYY-MM-DD (the Date filter defaults here)
function todayLocalISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
// "2025-26" → [Apr 2025, Apr 2026)   (financial year Apr → Mar)
function fyWindow(fy) {
  const y = parseInt(String(fy).split("-")[0], 10);
  if (isNaN(y)) return null;
  return { start: `${y}-04-01`, end: `${y + 1}-04-01` };
}
// months of a financial year: [{value:"2025-04", label:"Apr 2025"}, …]
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

// Table columns (in order) — the FULL Manual Break Down Slip (maintenance_breakdown_data)
// column set.  Log Book rows only carry a subset; the slip-only columns come back
// blank for them.  wrap = allow multi-line text; date = format YYYY-MM-DD.
const COLS = [
  // Header = actual DB column naam, order BD History jaisa (S No. + Source History Card-specific).
  { key: "_sno",                            label: "S No." },
  { key: "source",                          label: "source" },
  { key: "bd_date",                         label: "slip_date", date: true },
  { key: "zone",                            label: "zone" },
  { key: "line",                            label: "line" },
  { key: "machine_no",                      label: "machine_no" },
  { key: "machine_name",                    label: "machine_name", wrap: true },
  { key: "problem_observed_by_maintenance", label: "problem_observed_by_maintenance", wrap: true },
  { key: "action_taken_on_problem",         label: "action_taken_on_problem", wrap: true },
  { key: "bd_start_time",                   label: "bd_start_time" },
  { key: "bd_received_time",                label: "bd_received_time" },
  { key: "response_time_minutes",           label: "response_time_minutes" },
  { key: "bd_ok_time",                      label: "bd_ok_time" },
  { key: "mc_down_time_minutes",            label: "mc_down_time_minutes" },
  { key: "spares_used",                     label: "spares_used", wrap: true },
  { key: "bd_attended_by",                  label: "bd_attended_by" },
  { key: "shift",                           label: "shift" },
  { key: "model_no",                        label: "model_no" },
  { key: "category",                        label: "category" },
  { key: "line_leader_name",                label: "line_leader_name" },
  { key: "machine_operator_name",           label: "machine_operator_name" },
  { key: "bd_start_date",                   label: "bd_start_date", date: true },
  { key: "bd_end_date",                     label: "bd_end_date", date: true },
  { key: "frequency",                       label: "frequency" },
  { key: "problem_reported_by_production",  label: "problem_reported_by_production", wrap: true },
  { key: "problem_related_to",              label: "problem_related_to" },
  { key: "type_of_problem",                 label: "type_electrical / type_mechanical" },
  { key: "prepared_by_name",                label: "prepared_by_name" },
  { key: "received_by_name",                label: "received_by_name" },
  { key: "line_leader_operator_name",       label: "line_leader_operator_name" },
  { key: "quality_engineer_name",           label: "quality_engineer_name" },
];

// Enum/boolean prettifiers for the derived cells.
const RELATED_LBL = { maintenance: "Maintenance", tool_room: "Tool Room" };
// Source column display: breakdown slip -> "breakdown"; Sunday/Daily plan work -> "plan work".
// (Log Book jaisa koi aur source ho to apna raw naam hi dikhta hai.)
const SOURCE_LBL = { "Break Down Slip": "breakdown", "Sunday Plan": "plan work", "Daily Plan": "plan work" };

export default function HistoryCard() {
  const { token, theme, user } = useAuth();
  const nav = useNavigate();
  const [all, setAll]   = useState([]);
  const [zone, setZone] = useState("");
  const [years, setYears] = useState([]);
  const [fFy, setFFy]     = useState("");
  const [fMonth, setFMonth] = useState("");
  const [fDate, setFDate]   = useState("");   // manual date pick (empty = month drives the view)
  const [fLine, setFLine]   = useState("");
  const [fMno, setFMno]     = useState("");
  const [fMname, setFMname] = useState("");
  const [q, setQ]       = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await api.get("/api/breakdown-logbook/combined", token); setAll(Array.isArray(r) ? r : []); }
    catch { setAll([]); }
    finally { setLoading(false); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  // FY list + Machine Master List (maintenance_machines — the single master for
  // every filter across the app; zone tabs come from it too).
  const [master, setMaster] = useState([]);
  const booted = useRef(false);   // default the FY to the current one, once
  useEffect(() => {
    if (!token) return;
    api.get("/api/maintenance-kpi/financial-years", token)
      .then((y) => {
        const list = Array.isArray(y) ? y : [];
        setYears(list);
        if (!booted.current && list.length) {
          booted.current = true;
          const cur = (list.find((v) => v.is_current) || list[list.length - 1]).fy;
          setFFy(cur);
          // Month default = abhi ka current month (agar wo current FY me aata ho)
          const now = new Date();
          const cm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
          if (fyMonths(cur).some((m) => m.value === cm)) setFMonth(cm);
        }
      }).catch(() => setYears([]));
    api.get("/api/machines/", token)
      .then((m) => setMaster(Array.isArray(m) ? m : [])).catch(() => setMaster([]));
  }, [token]);

  const zoneTabs = useMemo(
    () => onlyProdZones([...new Set(master.map((m) => m.zone_name).filter(Boolean))]), [master]);
  useEffect(() => {
    if (zoneTabs.length && !zoneTabs.includes(zone)) setZone(zoneTabs[0]);
  }, [zoneTabs, zone]);

  const monthOpts = useMemo(() => fFy ? fyMonths(fFy) : [], [fFy]);

  // Line / Machine options from the master, scoped to the active zone tab.
  const lineOpts = useMemo(
    () => zone
      ? [...new Set(master.filter((m) => m.zone_name === zone).map((m) => m.line_name).filter(Boolean))].sort()
      : [], [master, zone]);
  const machineNoOpts = useMemo(
    () => (zone && fLine)
      ? [...new Set(master.filter((m) => m.zone_name === zone && m.line_name === fLine).map((m) => m.machine_no).filter(Boolean))].sort()
      : [], [master, zone, fLine]);
  const machineNameOpts = useMemo(
    () => (zone && fLine)
      ? [...new Set(master.filter((m) => m.zone_name === zone && m.line_name === fLine).map((m) => m.machine_name).filter(Boolean))].sort()
      : [], [master, zone, fLine]);

  // Selecting a Financial Year auto-picks the Month:
  //   • normal FY   → April (the FY's first month)
  //   • CURRENT FY  → the month that's actually running right now
  const onFy = (v) => {
    setFDate("");                       // month drives the view now, drop any manual date
    if (!v) { setFFy(""); setFMonth(""); return; }
    setFFy(v);
    const yObj = years.find((y) => y.fy === v);
    if (yObj?.is_current) {
      setFMonth(todayLocalISO().slice(0, 7));            // "YYYY-MM" — current running month
    } else {
      const startY = parseInt(String(v).split("-")[0], 10);
      setFMonth(`${startY}-04`);                         // April of that FY
    }
  };

  // Changing the zone tab resets the line/machine filters (they're zone-scoped).
  const pickZone = (z) => { setZone(z); setFLine(""); setFMno(""); setFMname(""); };
  const onFLine  = (v) => { setFLine(v); setFMno(""); setFMname(""); };
  // Picking a Machine No auto-fills its Machine Name (1:1 from the machine master).
  const onFMno = (v) => {
    setFMno(v);
    const m = master.find((x) => x.zone_name === zone && x.line_name === fLine
                                 && String(x.machine_no) === String(v));
    setFMname(m?.machine_name || "");
  };
  const clearFilters = () => {
    setFFy(""); setFMonth(""); setFDate(""); setFLine(""); setFMno(""); setFMname(""); setQ("");
  };

  const rows = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const w = fFy ? fyWindow(fFy) : null;
    return all
      .filter((e) => e.zone === zone)
      .filter((e) => {
        if (!w && !fMonth && !fDate) return true;
        const d = e.bd_date ? String(e.bd_date).slice(0, 10) : "";
        if (w && !(d >= w.start && d < w.end)) return false;
        if (fMonth && d.slice(0, 7) !== fMonth) return false;
        if (fDate && d !== fDate) return false;
        return true;
      })
      .filter((e) => !fLine  || e.line === fLine)
      .filter((e) => !fMno   || String(e.machine_no) === String(fMno))
      .filter((e) => !fMname || e.machine_name === fMname)
      .filter((e) => !ql || COLS.some((c) => String(e[c.key] ?? "").toLowerCase().includes(ql)))
      .sort((a, b) => String(a.bd_date || "").localeCompare(String(b.bd_date || "")) || (a.id - b.id));
  }, [all, zone, fFy, fMonth, fDate, fLine, fMno, fMname, q]);

  const cell = (e, c, i) => {
    if (c.key === "_sno") return i + 1;
    if (c.key === "source") return SOURCE_LBL[e.source] || e.source || "—";
    if (c.key === "type_of_problem") {           // derived from the two booleans
      const t = [];
      if (e.type_electrical) t.push("Electrical");
      if (e.type_mechanical) t.push("Mechanical");
      return t.length ? t.join(", ") : "—";
    }
    if (c.key === "problem_related_to")
      return RELATED_LBL[e.problem_related_to] || e.problem_related_to || "—";
    if (c.date) return fmtDate(e[c.key]);
    return e[c.key] || "—";
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700;800&family=Barlow+Condensed:wght@700;800&display=swap');
        .hc-root { min-height:100vh; background:#eef2f7; font-family:'Barlow',sans-serif; padding-bottom:50px; }
        .hc-top { background:#fff; border-bottom:1px solid #e2e8f0; height:56px; padding:0 28px 0 96px;
                  display:flex; align-items:center; justify-content:space-between;
                  position:sticky; top:0; z-index:50; box-shadow:0 1px 3px rgba(0,0,0,.06); }
        .hc-top::after { content:''; position:absolute; bottom:0; left:0; right:0; height:2px; background:${theme.gradient}; }
        .hc-title { font-family:'Barlow Condensed',sans-serif; font-size:22px; font-weight:800; color:#0f172a; }
        .hc-title span { color:${theme.accent}; }
        .hc-sub { font-size:11px; color:#94a3b8; margin-top:-2px; }
        .hc-back { display:flex; align-items:center; gap:6px; font-size:13px; font-weight:700; color:#475569;
                   background:#f1f5f9; border:1px solid #e2e8f0; border-radius:8px; padding:7px 14px; cursor:pointer; }
        .hc-body { max-width:1900px; margin:16px auto 0; padding:0 22px; }
        .hc-zones { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:14px; }
        .hc-zlbl { font-size:10px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:#64748b; }
        .hc-ztab { border:1px solid #cbd5e1; background:#fff; color:#334155; font-weight:700; font-size:13px;
                   padding:8px 18px; border-radius:99px; cursor:pointer; transition:all .12s; }
        .hc-ztab:hover { border-color:${theme.accent}; }
        .hc-ztab.on { background:${theme.accent}; color:#fff; border-color:${theme.accent}; }
        .hc-filters { display:flex; gap:12px; flex-wrap:wrap; align-items:flex-end; margin-bottom:14px; }
        .hc-fld { display:flex; flex-direction:column; gap:5px; }
        .hc-fld label { font-size:10.5px; font-weight:800; letter-spacing:.05em; text-transform:uppercase; color:#64748b; }
        .hc-fsel { border:1.5px solid #cbd5e1; border-radius:9px; padding:9px 12px; font-size:13px; font-weight:600;
                   color:#0f172a; outline:none; font-family:'Barlow',sans-serif; background:#fff; min-width:150px; }
        .hc-fsel:focus { border-color:${theme.accent}; }
        .hc-fsel:disabled { background:#f1f5f9; color:#94a3b8; cursor:not-allowed; }
        .hc-card { background:#fff; border:1px solid #e2e8f0; border-radius:12px; overflow:hidden;
                   box-shadow:0 1px 4px rgba(15,23,42,.06); }
        .hc-card-head { background:#0f172a; color:#fff; padding:13px 18px; display:flex; align-items:center;
                        justify-content:space-between; gap:14px; flex-wrap:wrap; }
        .hc-card-title { font-weight:800; font-size:13px; letter-spacing:.08em; text-transform:uppercase; }
        .hc-tools { display:flex; align-items:center; gap:12px; }
        .hc-search { font-size:13px; border:1px solid #334155; background:#1e293b; color:#fff; border-radius:8px;
                     padding:7px 12px; min-width:200px; outline:none; }
        .hc-search::placeholder { color:#94a3b8; }
        .hc-month { font-size:13px; font-weight:700; border:1px solid #334155; background:#1e293b; color:#fff;
                    border-radius:8px; padding:7px 10px; outline:none; }
        .hc-month:disabled { opacity:.45; cursor:not-allowed; }
        .hc-mlbl { font-size:10px; font-weight:700; letter-spacing:.08em; color:#94a3b8; }
        .hc-count { font-size:11px; color:#94a3b8; font-weight:600; }
        .hc-scroll { overflow-x:auto; }
        .hc-table { width:100%; border-collapse:collapse; font-size:12.5px; }
        .hc-table th { text-align:left; padding:10px 12px; font-size:10.5px; font-weight:700; letter-spacing:.02em;
                       text-transform:none; color:#64748b; border-bottom:2px solid #e2e8f0;
                       white-space:nowrap; background:#f8fafc; position:sticky; top:0; }
        .hc-table td { padding:9px 12px; border-bottom:1px solid #f1f5f9; color:#334155; vertical-align:top; white-space:nowrap; }
        .hc-table td.wrap { white-space:normal; min-width:170px; max-width:280px; line-height:1.4; }
        .hc-table td.sno { font-weight:700; color:#0f172a; }
        .hc-table tr:hover td { background:#f8fafc; }
        .hc-empty { padding:50px; text-align:center; color:#94a3b8; font-size:14px; }
      `}</style>

      <div className="hc-root">
        <div className="hc-top">
          <div style={{ display:"flex", alignItems:"center", gap:14 }}>
            <button className="hc-back" onClick={() => nav("/dashboard")}>← Back</button>
            <div>
              <div className="hc-title">History <span>Card</span></div>
              <div className="hc-sub">Zone-wise machine history — Log Book + Break Down Slip</div>
            </div>
          </div>
          {user?.username && <span style={{ fontSize:12, color:"#64748b", fontWeight:600 }}>{user.username}</span>}
        </div>

        <div className="hc-body">
          {/* Zone tabs */}
          <div className="hc-zones">
            <span className="hc-zlbl">Zone</span>
            {zoneTabs.length === 0 ? (
              <span style={{ fontSize:13, color:"#94a3b8" }}>No data yet</span>
            ) : zoneTabs.map((z) => (
              <button key={z} className={`hc-ztab${zone === z ? " on" : ""}`} onClick={() => pickZone(z)}>{z}</button>
            ))}
          </div>

          {/* Filter bar — same set as the other pages (FY · Month · Date ·
              Line · Machine No · Machine Name).  Zone is the tabs above.
              Date defaults to the current date but is freely changeable. */}
          <div className="hc-filters">
            <div className="hc-fld">
              <label>Financial Year</label>
              <select className="hc-fsel" value={fFy} onChange={(e) => onFy(e.target.value)}>
                <option value="">All FY</option>
                {years.map((y) => <option key={y.fy} value={y.fy}>{y.fy}{y.is_current ? " (current)" : ""}</option>)}
              </select>
            </div>
            <div className="hc-fld">
              <label>Month</label>
              <select className="hc-fsel" value={fMonth} onChange={(e) => setFMonth(e.target.value)} disabled={!fFy}>
                <option value="">All Months</option>
                {monthOpts.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            <div className="hc-fld">
              <label>Date</label>
              <input className="hc-fsel" type="date" value={fDate} onChange={(e) => setFDate(e.target.value)} />
            </div>
            <div className="hc-fld">
              <label>Line</label>
              <select className="hc-fsel" value={fLine} onChange={(e) => onFLine(e.target.value)}>
                <option value="">All Lines</option>
                {lineOpts.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div className="hc-fld">
              <label>Machine No.</label>
              <select className="hc-fsel" value={fMno} onChange={(e) => onFMno(e.target.value)} disabled={!fLine}>
                <option value="">All Machine No.</option>
                {machineNoOpts.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div className="hc-fld">
              <label>Machine Name</label>
              <select className="hc-fsel" value={fMname} onChange={(e) => setFMname(e.target.value)} disabled={!fLine}>
                <option value="">All Machine Names</option>
                {machineNameOpts.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div className="hc-fld">
              <label>&nbsp;</label>
              <button className="hc-back" style={{ padding:"9px 16px" }} onClick={clearFilters}>✕ Clear</button>
            </div>
          </div>

          <div className="hc-card">
            <div className="hc-card-head">
              <span className="hc-card-title">History Card — {zone || "—"}</span>
              <div className="hc-tools">
                <input className="hc-search" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
                <span className="hc-count">{rows.length} {rows.length === 1 ? "entry" : "entries"}</span>
              </div>
            </div>
            <div className="hc-scroll">
              {loading ? (
                <div className="hc-empty">Loading…</div>
              ) : rows.length === 0 ? (
                <div className="hc-empty">No entries{zone ? ` for ${zone}` : ""}.</div>
              ) : (
                <table className="hc-table">
                  <thead>
                    <tr>{COLS.map((c) => <th key={c.key}>{c.label}</th>)}</tr>
                  </thead>
                  <tbody>
                    {rows.map((e, i) => (
                      <tr key={`${e.source}-${e.id}`}>
                        {COLS.map((c) => (
                          <td key={c.key} className={`${c.wrap ? "wrap" : ""} ${c.key === "_sno" ? "sno" : ""}`}>
                            {cell(e, c, i)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
