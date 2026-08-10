/* ───────────────────────────────────────────────────────────────────
 * MachineDMC.jsx — "Machine DMC" (Maintenance)
 * ───────────────────────────────────────────────────────────────────
 * Two surfaces (button landing):
 *   • DMC Format         → the blank Daily Machine Check Sheet layout.
 *   • Machine Check Sheet → pick zone → line → machine no; the sheet
 *                           renders with THAT machine's DMC check points
 *                           (from the machine_dmc table), grouped by
 *                           category (Inspection/Cleaning/Lubrication/Tightness).
 *
 * Routing: /maintenance-machine-dmc — canAccess('maintenance-machine-dmc').
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { DmcSheet } from "./DmcSheet";

const CAT_ORDER = ["Inspection", "Cleaning", "Lubrication", "Tightness"];
const JP = { Inspection: "点検", Cleaning: "清掃", Lubrication: "給油", Tightness: "締付" };
// blank format: category row counts (from dmc.xlsx layout)
const BLANK_ROWS = { Inspection: 18, Cleaning: 3, Lubrication: 2, Tightness: 2 };

export default function MachineDMC() {
  const { theme, token } = useAuth();
  const navigate = useNavigate();
  const [view, setView] = useState("home");       // 'home' | 'format' | 'machine'
  const [machines, setMachines] = useState([]);
  const [zone, setZone] = useState("");
  const [line, setLine] = useState("");
  const [mno, setMno]   = useState("");
  const [data, setData] = useState(null);         // { header, points }
  const [loading, setLoading] = useState(false);
  const [footer, setFooter] = useState(null);     // format doc-control footer (admin-set)

  const api = useCallback(async (path) => {
    const r = await fetch(`/api/machine-dmc${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!r.ok) throw new Error(await r.text() || `HTTP ${r.status}`);
    return r.json();
  }, [token]);

  useEffect(() => {
    if (view === "machine" && machines.length === 0)
      api(`/machines`).then((d) => setMachines(Array.isArray(d) ? d : [])).catch(() => {});
  }, [view, machines.length, api]);

  // Format doc-control footer (Format No. / Rev No. / Rev Date) — admin-set in
  // Maintenance Panel → Machine DMC → Format.  Shown at the foot of the sheet,
  // exactly like the PM check sheet.
  useEffect(() => {
    api(`/format`).then((d) => setFooter((d && d.format && d.format.doc_footer) || null)).catch(() => {});
  }, [api]);

  useEffect(() => {
    if (!mno) { setData(null); return; }
    setLoading(true);
    api(`/points?machine_no=${encodeURIComponent(mno)}`)
      .then(setData).catch(() => setData(null)).finally(() => setLoading(false));
  }, [mno, api]);

  const zoneOpts = useMemo(() => [...new Set(machines.map((m) => m.zone).filter(Boolean))].sort(), [machines]);
  const lineOpts = useMemo(() => zone
    ? [...new Set(machines.filter((m) => m.zone === zone).map((m) => m.line).filter(Boolean))].sort() : [], [machines, zone]);
  const mcOpts = useMemo(() => (zone && line)
    ? machines.filter((m) => m.zone === zone && m.line === line && m.machine_no)
              .sort((a, b) => String(a.machine_no).localeCompare(String(b.machine_no))) : [], [machines, zone, line]);
  const mcSel = mcOpts.find((m) => String(m.machine_no) === String(mno)) || null;

  // group a machine's points by category (known order first)
  const groupsFor = (points) => {
    const by = {};
    (points || []).forEach((p) => { (by[p.category] = by[p.category] || []).push(p); });
    const cats = [...CAT_ORDER.filter((c) => by[c]), ...Object.keys(by).filter((c) => !CAT_ORDER.includes(c))];
    return cats.map((c) => ({ eng: c, jp: JP[c] || "", points: by[c] }));
  };
  // blank format groups
  const blankGroups = CAT_ORDER.map((c) => ({ eng: c, jp: JP[c], points: Array.from({ length: BLANK_ROWS[c] }, () => null) }));

  // ── styles (picker only; the sheet itself lives in DmcSheet) ──
  const sel = { padding: "8px 10px", borderRadius: 8, border: "1px solid #cbd5e1", fontSize: 13, fontWeight: 600, minWidth: 180, background: "#fff" };
  const lab = { fontSize: 10.5, fontWeight: 800, color: "#64748b", marginBottom: 4 };

  const backBtn = (
    <button onClick={() => { setView("home"); setMno(""); setData(null); }}
      style={{ marginBottom: 14, padding: "8px 16px", borderRadius: 8, border: "1px solid #cbd5e1",
               background: "#fff", cursor: "pointer", fontWeight: 800, fontSize: 13, color: "#334155" }}>← Back</button>
  );
  const bigBtn = (icon, label, sub, onClick) => (
    <button onClick={onClick}
      style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10,
               width: 220, height: 150, borderRadius: 16, border: "1px solid #e2e8f0", background: "#fff",
               cursor: "pointer", boxShadow: "0 2px 10px rgba(15,23,42,.06)", fontFamily: "inherit" }}>
      <span style={{ fontSize: 44 }}>{icon}</span>
      <span style={{ fontSize: 15, fontWeight: 800, color: "#0f172a" }}>{label}</span>
      <span style={{ fontSize: 11.5, color: "#64748b" }}>{sub}</span>
    </button>
  );

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700;800&family=Barlow+Condensed:wght@600;700;800&display=swap');
        .dmc-root { min-height:100vh; background:#f8fafc; font-family:'Barlow',sans-serif; padding-bottom:60px; }
        .dmc-topbar { background:#fff; border-bottom:1px solid #e2e8f0; padding:0 40px 0 88px; height:60px;
          display:flex; align-items:center; justify-content:space-between; position:sticky; top:0; z-index:100;
          box-shadow:0 1px 3px rgba(0,0,0,.06); }
        .dmc-topbar::after { content:''; position:absolute; bottom:0; left:0; right:0; height:2px; background:${theme.gradient}; }
        .dmc-title { position:absolute; left:50%; transform:translateX(-50%); font-family:'Barlow Condensed',sans-serif;
          font-size:32px; font-weight:800; color:#0f172a; pointer-events:none; white-space:nowrap; }
        .dmc-title span { color:${theme.accent}; }
        .dmc-body { padding:20px; max-width:1500px; margin:0 auto; }
      `}</style>
      <div className="dmc-root">
        <div className="dmc-topbar"><div /><div className="dmc-title">🏷 Machine <span>DMC</span></div><div /></div>

        <div className="dmc-body">
          {view === "home" && (
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", paddingTop: 8 }}>
              {bigBtn("📋", "DMC Format", "Blank format →", () => setView("format"))}
              {bigBtn("🔍", "Machine Check Sheet", "Select machine →", () => setView("machine"))}
              {bigBtn("📝", "Operator DMC Fill", "Operator fills daily →", () => navigate("/maintenance-daily-dmc"))}
              {bigBtn("✅", "Supervisor Verify", "Check & sign off →", () => navigate("/maintenance-dmc-verify"))}
              {bigBtn("🔧", "Maintenance Weekly", "Weekly sign off →", () => navigate("/maintenance-dmc-weekly"))}
              {bigBtn("✗", "DMC NG Point", "Action & close →", () => navigate("/maintenance-dmc-ng"))}
            </div>
          )}

          {view === "format" && (<>{backBtn}<DmcSheet hdr={{}} groups={blankGroups} footer={footer} signGrid /></>)}

          {view === "machine" && (<>
            {backBtn}
            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 16, marginBottom: 14,
                          display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div><div style={lab}>ZONE</div>
                <select style={sel} value={zone} onChange={(e) => { setZone(e.target.value); setLine(""); setMno(""); }}>
                  <option value="">— zone —</option>{zoneOpts.map((z) => <option key={z} value={z}>{z}</option>)}
                </select></div>
              <div><div style={lab}>LINE</div>
                <select style={sel} value={line} onChange={(e) => { setLine(e.target.value); setMno(""); }} disabled={!zone}>
                  <option value="">— line —</option>{lineOpts.map((l) => <option key={l} value={l}>{l}</option>)}
                </select></div>
              <div><div style={lab}>MACHINE NO</div>
                <select style={{ ...sel, minWidth: 190 }} value={mno} onChange={(e) => setMno(e.target.value)} disabled={!line}>
                  <option value="">— machine no —</option>
                  {mcOpts.map((m) => <option key={m.machine_no} value={m.machine_no}>{m.machine_no}</option>)}
                </select></div>
              <div><div style={lab}>MACHINE NAME</div>
                <input readOnly value={mcSel?.machine_name || ""} placeholder="— auto —"
                       style={{ ...sel, minWidth: 240, background: "#f8fafc", color: "#334155", cursor: "default" }} /></div>
              {mno && data && <span style={{ fontSize: 12, fontWeight: 800, color: "#16a34a" }}>{data.count} check points</span>}
            </div>
            {loading ? (
              <div style={{ background: "#fff", borderRadius: 12, padding: 40, textAlign: "center", color: "#64748b" }}>Loading…</div>
            ) : !mno ? (
              <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 40, textAlign: "center", color: "#64748b" }}>
                Select zone → line → machine no to open that machine's DMC check sheet.
              </div>
            ) : (data && data.points && data.points.length
                  ? <DmcSheet groups={groupsFor(data.points)} footer={footer} signGrid
                              hdr={{ zone, line, machine_no: mno,
                                     machine_name: mcSel?.machine_name || (data.header && data.header.machine_name) || "",
                                     rev_no: data.header && data.header.rev_no,
                                     rev_date: data.header && data.header.rev_date }} />
                  : <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 40, textAlign: "center", color: "#94a3b8" }}>No DMC check points for this machine.</div>)}
          </>)}
        </div>
      </div>
    </>
  );
}
