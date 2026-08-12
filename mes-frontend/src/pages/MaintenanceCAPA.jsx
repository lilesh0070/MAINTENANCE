/* ───────────────────────────────────────────────────────────────────
 * MaintenanceCAPA.jsx
 * ───────────────────────────────────────────────────────────────────
 * CAPA (Corrective Action / Preventive Action) for Maintenance.
 *
 * Original page format — driven by the MES Breakdown Log (maintenance_breakdown_data,
 * the SAME source as Maintenance KPI / BD History / BD Analysis):
 *   • KPI tiles (Open / Closed / Total CAPA)
 *   • Filter bar
 *   • "Pending CAPA" — auto-detected (every breakdown with duration
 *     ≥ 60 min whose QPR is not filled yet), each with a "Start CAPA"
 *     button that opens the QPR form pre-filled with the breakdown context.
 *   • "CAPA Records" archive — completed CAPAs with a View button.
 *
 * Saving a CAPA's QPR closes it automatically (Open −1 / Closed +1); the
 * completed sheet stays viewable from CAPA Records (the standalone QPR
 * register page was removed).
 *
 * Backend: /api/capa-lb   Routing: /maintenance-capa
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
  async post(path, token) {
    const r = await fetch(path, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
    return r.json();
  },
};

const MON = ["", "January", "February", "March", "April", "May", "June", "July",
             "August", "September", "October", "November", "December"];
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
    const mo = ((3 + i) % 12) + 1;           // Apr=4 … Mar=3
    const yr = mo >= 4 ? y : y + 1;
    out.push({ value: `${yr}-${String(mo).padStart(2, "0")}`, label: `${MON[mo].slice(0, 3)} ${yr}` });
  }
  return out;
}

export default function MaintenanceCAPA() {
  const { token, theme, user } = useAuth();
  const nav = useNavigate();
  const [data, setData]   = useState({ open_count: 0, closed_count: 0, open: [], closed: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy]   = useState(null);
  const [toast, setToast] = useState(null);
  const flash = (m) => { setToast(m); setTimeout(() => setToast(null), 2800); };

  // Filters — same style as the Maintenance KPI page (Machine Master List).
  const [years, setYears]   = useState([]);
  const [fFy, setFFy]           = useState("");   // "" = all FY
  const [fMonth, setFMonth]     = useState("");
  const [fZone, setFZone]       = useState("");
  const [fLine, setFLine]       = useState("");
  const [fMachineNo, setFMachineNo]     = useState("");
  const [fMachineName, setFMachineName] = useState("");

  const load = useCallback(() => {
    if (!token) return;
    setLoading(true);
    api.get("/api/capa-lb/summary", token)
      .then((d) => setData(d))
      .catch(() => flash("Could not load CAPA data"))
      .finally(() => setLoading(false));
  }, [token]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const h = () => load();
    window.addEventListener("focus", h);
    return () => window.removeEventListener("focus", h);
  }, [load]);

  // FY list + Machine Master List (maintenance_machines — the single master for
  // every filter across the app).
  const [master, setMaster] = useState([]);
  const booted = useRef(false);   // default the FY to the current one, once
  useEffect(() => {
    if (!token) return;
    api.get("/api/maintenance-kpi/financial-years", token).then((y) => {
      const list = Array.isArray(y) ? y : [];
      setYears(list);
      if (!booted.current && list.length) {
        booted.current = true;
        setFFy((list.find((v) => v.is_current) || list[list.length - 1]).fy);
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

  const match = (r) => {
    const d = r.bd_date ? String(r.bd_date).slice(0, 10) : "";
    if (fFy) { const w = fyWindow(fFy); if (w && !(d >= w.start && d < w.end)) return false; }
    if (fMonth && d.slice(0, 7) !== fMonth) return false;
    if (fZone && r.zone_name !== fZone) return false;
    if (fLine && r.line_name !== fLine) return false;
    if (fMachineNo && r.machine_no !== fMachineNo) return false;
    if (fMachineName && r.machine_name !== fMachineName) return false;
    return true;
  };
  const openRows   = data.open.filter(match);
  const closedRows = data.closed.filter(match);
  const total = data.open_count + data.closed_count;
  const pct = total ? Math.round((data.closed_count / total) * 100) : 0;

  const startCapa = async (lb) => {
    setBusy(lb.logbook_id);
    try {
      const res = await api.post(`/api/capa-lb/start/${lb.logbook_id}`, token);
      nav(`/maintenance-breakdown/qpr/${res.qpr_id}`);
    } catch (e) { flash("Could not start CAPA: " + (e.message || "")); }
    finally { setBusy(null); }
  };

  const Tile = ({ label, value, color, sub }) => (
    <div className="cp-tile" style={{ borderTop: `3px solid ${color}` }}>
      <div className="cp-tile-l">{label}</div>
      <div className="cp-tile-v" style={{ color }}>{loading ? "…" : value}</div>
      <div className="cp-tile-s">{sub}</div>
    </div>
  );

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700;800&family=Barlow+Condensed:wght@700;800&display=swap');
        .cp-root { min-height:100vh; background:#f1f5f9; font-family:'Barlow',sans-serif; padding-bottom:60px; }
        .cp-top { background:#fff; border-bottom:1px solid #e2e8f0; height:60px; padding:0 40px 0 96px;
                  display:flex; align-items:center; justify-content:space-between; position:sticky; top:0; z-index:50; box-shadow:0 1px 3px rgba(0,0,0,.06); }
        .cp-top::after { content:''; position:absolute; bottom:0; left:0; right:0; height:2px; background:${theme.gradient}; }
        .cp-title { font-family:'Barlow Condensed',sans-serif; font-size:30px; font-weight:800; color:#0f172a; }
        .cp-title span { color:${theme.accent}; }
        .cp-body { max-width:1280px; margin:0 auto; padding:22px 30px 0; }
        .cp-note { font-size:12.5px; color:#64748b; margin-bottom:16px; }
        .cp-note b { color:#0f172a; }

        .cp-tiles { display:grid; gap:16px; grid-template-columns:repeat(auto-fit, minmax(210px,1fr)); margin-bottom:20px; }
        .cp-tile { background:#fff; border:1px solid #e2e8f0; border-radius:16px; padding:18px 20px; box-shadow:0 1px 3px rgba(15,23,42,.05); }
        .cp-tile-l { font-size:12px; font-weight:800; text-transform:uppercase; letter-spacing:.06em; color:#64748b; }
        .cp-tile-v { font-family:'Barlow Condensed',sans-serif; font-size:46px; font-weight:800; line-height:1; margin-top:6px; }
        .cp-tile-s { font-size:11px; color:#94a3b8; margin-top:6px; }

        .cp-filters { display:flex; gap:12px; flex-wrap:wrap; align-items:flex-end; margin-bottom:16px; }
        .cp-fld { display:flex; flex-direction:column; gap:5px; }
        .cp-fld label { font-size:10.5px; font-weight:800; letter-spacing:.05em; text-transform:uppercase; color:#64748b; }
        .cp-in, .cp-sel { border:1.5px solid #cbd5e1; border-radius:9px; padding:9px 12px; font-size:13px; font-weight:600;
                          color:#0f172a; outline:none; font-family:'Barlow',sans-serif; background:#fff; min-width:150px; }
        .cp-in:focus, .cp-sel:focus { border-color:${theme.accent}; }
        .cp-sel:disabled { background:#f1f5f9; color:#94a3b8; cursor:not-allowed; }
        .cp-refresh { border:1.5px solid #cbd5e1; background:#fff; cursor:pointer; border-radius:9px; padding:9px 16px; font-size:13px; font-weight:700; color:#334155; }
        .cp-refresh:hover { border-color:${theme.accent}; color:${theme.accent}; }

        .cp-sec { background:#fff; border:1px solid #e2e8f0; border-radius:16px; box-shadow:0 1px 3px rgba(15,23,42,.05); margin-bottom:22px; overflow:hidden; }
        .cp-sec-h { display:flex; align-items:center; gap:10px; padding:14px 20px; border-bottom:1px solid #eef2f7; }
        .cp-sec-dot { width:10px; height:10px; border-radius:3px; }
        .cp-sec-t { font-size:15px; font-weight:800; color:#0f172a; }
        .cp-sec-c { font-size:12px; font-weight:700; color:#fff; border-radius:99px; padding:2px 10px; }

        .cp-tbl { width:100%; border-collapse:collapse; }
        .cp-tbl th { background:#1e3a8a; color:#fff; font-size:11.5px; font-weight:700; padding:11px 14px; text-align:left; white-space:nowrap;
                     position:sticky; top:0; z-index:2; }
        /* more than 8 rows → the section scrolls instead of stretching the page */
        .cp-scroll { max-height:560px; overflow-y:auto; }
        .cp-tbl td { border-bottom:1px solid #eef2f7; padding:11px 14px; font-size:12.5px; color:#334155; }
        .cp-tbl tr:hover td { background:#f8fafc; }
        .cp-dur { font-weight:800; color:#dc2626; text-align:center; }
        .cp-mno { font-weight:800; color:#0f172a; }
        .cp-start { border:none; cursor:pointer; background:${theme.accent}; color:#fff; border-radius:8px; padding:8px 16px;
                    font-size:12.5px; font-weight:800; font-family:'Barlow',sans-serif; }
        .cp-start:hover { filter:brightness(1.05); } .cp-start:disabled { opacity:.5; cursor:default; }
        .cp-view { border:1.5px solid #cbd5e1; background:#fff; cursor:pointer; border-radius:8px; padding:7px 14px; font-size:12.5px; font-weight:700; color:#334155; }
        .cp-view:hover { border-color:${theme.accent}; color:${theme.accent}; }
        .cp-badge { padding:3px 10px; border-radius:99px; font-size:11px; font-weight:800; }
        .cp-empty { text-align:center; color:#94a3b8; padding:34px; font-size:13.5px; }
        .cp-toast { position:fixed; bottom:26px; left:50%; transform:translateX(-50%); background:#0f172a; color:#fff; padding:12px 22px;
                    border-radius:10px; font-size:13px; font-weight:600; z-index:300; box-shadow:0 8px 24px rgba(0,0,0,.25); }
      `}</style>

      <div className="cp-root">
        <div className="cp-top">
          <div className="cp-title">CA<span>PA</span></div>
          {user?.username && <span style={{ fontSize:12, color:"#64748b", fontWeight:600 }}>Signed in as <b>{user.username}</b></span>}
        </div>

        <div className="cp-body">
          <div className="cp-note">
            Auto-generated from the <b>MES Breakdown Log</b> (same source as Maintenance KPI) — every breakdown with a
            duration of <b>60 minutes or more</b> becomes an Open CAPA. Complete its QPR to close it.
          </div>

          {/* KPI tiles */}
          <div className="cp-tiles">
            <Tile label="Open CAPA"   value={data.open_count}   color="#dc2626" sub="pending — breakdowns ≥ 60 min" />
            <Tile label="Closed CAPA" value={data.closed_count} color="#16a34a" sub="QPR completed" />
            <Tile label="Total CAPA"  value={total}             color="#2563eb" sub="≥ 60-min breakdowns" />
            <Tile label="Completion"  value={`${pct}%`}         color="#7c3aed" sub="closed / total" />
          </div>

          {/* filter bar — same style as the Maintenance KPI page */}
          <div className="cp-filters">
            <div className="cp-fld">
              <label>Financial Year</label>
              <select className="cp-sel" value={fFy} onChange={(e) => { setFFy(e.target.value); setFMonth(""); }}>
                <option value="">All Financial Years</option>
                {years.map((y) => <option key={y.fy} value={y.fy}>{y.fy}{y.is_current ? "  (current)" : ""}</option>)}
              </select>
            </div>
            <div className="cp-fld">
              <label>Month</label>
              <select className="cp-sel" value={fMonth} onChange={(e) => setFMonth(e.target.value)} disabled={!fFy}>
                <option value="">All Months</option>
                {monthOpts.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            <div className="cp-fld">
              <label>Zone</label>
              <select className="cp-sel" value={fZone} onChange={(e) => onZone(e.target.value)}>
                <option value="">All Zones</option>
                {zoneOpts.map((z) => <option key={z} value={z}>{z}</option>)}
              </select>
            </div>
            <div className="cp-fld">
              <label>Line</label>
              <select className="cp-sel" value={fLine} onChange={(e) => onLine(e.target.value)} disabled={!fZone}>
                <option value="">All Lines</option>
                {lineOpts.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div className="cp-fld">
              <label>Machine No.</label>
              <select className="cp-sel" value={fMachineNo} onChange={(e) => setFMachineNo(e.target.value)} disabled={!fLine}>
                <option value="">All Machine No.</option>
                {machineNoOpts.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div className="cp-fld">
              <label>Machine Name</label>
              <select className="cp-sel" value={fMachineName} onChange={(e) => setFMachineName(e.target.value)} disabled={!fLine}>
                <option value="">All Machine Names</option>
                {machineNameOpts.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div className="cp-fld">
              <label>&nbsp;</label>
              <button className="cp-refresh" onClick={clearFilters}>✕ Clear</button>
            </div>
          </div>

          {/* Pending CAPA */}
          <div className="cp-sec">
            <div className="cp-sec-h">
              <span className="cp-sec-dot" style={{ background:"#dc2626" }} />
              <span className="cp-sec-t">Pending CAPA</span>
              <span className="cp-sec-c" style={{ background:"#dc2626" }}>{openRows.length}</span>
              <span style={{ marginLeft:"auto", fontSize:11.5, color:"#94a3b8" }}>auto-detected from MES Breakdown Log (≥ 60 min)</span>
            </div>
            <div className={openRows.length > 8 ? "cp-scroll" : undefined}>
            <table className="cp-tbl">
              <thead>
                <tr>
                  <th>#</th><th>M/C No</th><th>Machine</th><th>Zone</th><th>Line</th><th>BD Date</th>
                  <th style={{ textAlign:"center" }}>Duration (min)</th><th>Problem</th><th style={{ textAlign:"center" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={9} className="cp-empty">Loading…</td></tr>}
                {!loading && openRows.length === 0 && <tr><td colSpan={9} className="cp-empty">No pending CAPAs 🎉</td></tr>}
                {!loading && openRows.map((r, i) => (
                  <tr key={r.logbook_id}>
                    <td>{i + 1}</td>
                    <td className="cp-mno">{r.machine_no}</td>
                    <td>{r.machine_name}</td>
                    <td>{r.zone_name}</td>
                    <td>{r.line_name}</td>
                    <td>{r.bd_date}</td>
                    <td className="cp-dur">{r.duration_min}</td>
                    <td style={{ maxWidth:260 }}>{r.problem}</td>
                    <td style={{ textAlign:"center" }}>
                      <button className="cp-start" disabled={busy === r.logbook_id} onClick={() => startCapa(r)}>
                        {busy === r.logbook_id ? "Opening…" : "Start CAPA"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>

          {/* CAPA Records (archive) */}
          <div className="cp-sec">
            <div className="cp-sec-h">
              <span className="cp-sec-dot" style={{ background:"#16a34a" }} />
              <span className="cp-sec-t">CAPA Records</span>
              <span className="cp-sec-c" style={{ background:"#16a34a" }}>{closedRows.length}</span>
              <span style={{ marginLeft:"auto", fontSize:11.5, color:"#94a3b8" }}>completed CAPAs</span>
            </div>
            <div className={closedRows.length > 8 ? "cp-scroll" : undefined}>
            <table className="cp-tbl">
              <thead>
                <tr>
                  <th>#</th><th>M/C No</th><th>Machine</th><th>Zone</th><th>Line</th><th>BD Date</th>
                  <th style={{ textAlign:"center" }}>Duration (min)</th><th>QPR</th><th style={{ textAlign:"center" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={9} className="cp-empty">Loading…</td></tr>}
                {!loading && closedRows.length === 0 && <tr><td colSpan={9} className="cp-empty">No closed CAPAs yet.</td></tr>}
                {!loading && closedRows.map((r, i) => (
                  <tr key={r.logbook_id}>
                    <td>{i + 1}</td>
                    <td className="cp-mno">{r.machine_no}</td>
                    <td>{r.machine_name}</td>
                    <td>{r.zone_name}</td>
                    <td>{r.line_name}</td>
                    <td>{r.bd_date}</td>
                    <td className="cp-dur" style={{ color:"#0f172a" }}>{r.duration_min}</td>
                    <td>{r.qpr_no ? `QPR No. ${r.qpr_no}` : "—"}</td>
                    <td style={{ textAlign:"center" }}>
                      <span style={{ display:"inline-flex", gap:8, alignItems:"center" }}>
                        <span className="cp-badge" style={{ background:"#dcfce7", color:"#166534" }}>Closed</span>
                        {r.qpr_id && <button className="cp-view" onClick={() => nav(`/maintenance-breakdown/qpr/${r.qpr_id}`)}>View</button>}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        </div>

        {toast && <div className="cp-toast">{toast}</div>}
      </div>
    </>
  );
}
