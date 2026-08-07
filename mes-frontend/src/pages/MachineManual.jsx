/* ───────────────────────────────────────────────────────────────────
 * MachineManual.jsx — "Machine Manual" (sidebar, Maintenance section)
 * ───────────────────────────────────────────────────────────────────
 * Two tabs (both view + upload a PDF manual):
 *
 *   1. MACHINE MANUAL    — pick Zone → Line → Machine No / Machine Name
 *                          (all from the Machine Master `maintenance_machines`).
 *   2. EQUIPMENT MANUAL  — search an equipment by Name + Model.
 *
 * From the Maintenance Panel an admin can upload/update the manual.
 *
 * ⚠️ FRONT VIEW ONLY (2026-07-06): the layout + PDF preview + the upload
 * option are wired, but nothing is persisted yet — where/how the PDF is
 * stored (backend endpoint + table) is intentionally NOT built yet.  The
 * picked file previews locally (object URL) so the flow can be demoed; it
 * is lost on reload.  Wire the save later.
 *
 * Routing: /maintenance-machine-manual
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const api = {
  async get(path, token) {
    const r = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
    return r.json();
  },
};

const sel2 = { border:"1.5px solid #cbd5e1", borderRadius:9, padding:"9px 12px", fontSize:13,
               fontWeight:600, color:"#0f172a", outline:"none", fontFamily:"'Barlow',sans-serif",
               background:"#fff", minWidth:170 };
function Fld({ label, children }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
      <label style={{ fontSize:10.5, fontWeight:800, letterSpacing:".05em", textTransform:"uppercase", color:"#64748b" }}>{label}</label>
      {children}
    </div>
  );
}

export default function MachineManual() {
  const { token, theme, user, isAdmin } = useAuth();
  const nav = useNavigate();
  const [master, setMaster] = useState([]);   // Machine Master List (maintenance_machines)

  const [mode, setMode] = useState("machine");   // "machine" | "equipment"

  // ── Machine Manual filter cascade ──
  const [zone, setZone]   = useState("");
  const [line, setLine]   = useState("");
  const [mno, setMno]     = useState("");
  const [mname, setMname] = useState("");

  // ── Equipment Manual search ──
  const [eqName, setEqName]     = useState("");
  const [eqModel, setEqModel]   = useState("");
  const [eqSubject, setEqSubject] = useState(null);   // {name, model} once searched

  // picked PDF (front-only preview — not saved anywhere yet)
  const [picked, setPicked] = useState(null);   // { name, url }

  useEffect(() => {
    if (!token) return;
    api.get("/api/machines/", token).then((m) => setMaster(Array.isArray(m) ? m : [])).catch(() => setMaster([]));
  }, [token]);

  // Full master zone list (maintenance page — every machine can have a manual).
  const zoneOpts = useMemo(() => [...new Set(master.map((m) => m.zone_name).filter(Boolean))].sort(), [master]);
  const lineOpts = useMemo(() => zone
    ? [...new Set(master.filter((m) => m.zone_name === zone).map((m) => m.line_name).filter(Boolean))].sort() : [], [master, zone]);
  const machineNoOpts = useMemo(() => (zone && line)
    ? [...new Set(master.filter((m) => m.zone_name === zone && m.line_name === line)
                        .map((m) => m.machine_no).filter(Boolean))].sort() : [], [master, zone, line]);
  const machineNameOpts = useMemo(() => (zone && line)
    ? [...new Set(master.filter((m) => m.zone_name === zone && m.line_name === line)
                        .map((m) => m.machine_name).filter(Boolean))].sort() : [], [master, zone, line]);

  // one effective machine — picked by No., or resolved from the Name pick
  const effMno = mno || (mname
    ? (master.find((m) => m.zone_name === zone && m.line_name === line && m.machine_name === mname)?.machine_no || "")
    : "");
  const sel = master.find((m) => m.zone_name === zone && m.line_name === line
                                 && String(m.machine_no) === String(effMno)) || null;
  const effName = sel?.machine_name || mname || "";

  const onZone = (v) => { setZone(v); setLine(""); setMno(""); setMname(""); setPicked(null); };
  const onLine = (v) => { setLine(v); setMno(""); setMname(""); setPicked(null); };
  const onMno  = (v) => { setMno(v); setMname(""); setPicked(null); };
  const onMname= (v) => { setMname(v); setMno(""); setPicked(null); };
  const clearAll = () => { setZone(""); setLine(""); setMno(""); setMname(""); setPicked(null); };

  const searchEquipment = () => {
    if (!eqName.trim() && !eqModel.trim()) return;
    setEqSubject({ name: eqName.trim(), model: eqModel.trim() });
    setPicked(null);
  };
  const clearEquipment = () => { setEqName(""); setEqModel(""); setEqSubject(null); setPicked(null); };

  const switchMode = (m) => { setMode(m); setPicked(null); };

  const onPick = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== "application/pdf") { alert("Only PDF files are allowed."); e.target.value = ""; return; }
    // Local preview only — object URL, nothing is uploaded/saved yet.
    setPicked({ name: file.name, url: URL.createObjectURL(file) });
    e.target.value = "";
  };

  // The active "subject" (whichever tab) drives the shared header + viewer.
  const subject = mode === "machine"
    ? (effMno ? { title: effMno, meta: [["Machine", effName || "—"], ["Zone", zone], ["Line", line]], label: effMno + (effName ? ` (${effName})` : "") } : null)
    : (eqSubject ? { title: eqSubject.name || eqSubject.model, meta: [["Model", eqSubject.model || "—"], ["Equipment", eqSubject.name || "—"]], label: eqSubject.name || eqSubject.model } : null);

  const promptText = mode === "machine"
    ? "Pick Zone → Line → Machine No. (or Machine Name) above. The machine's PDF manual will open here."
    : "Enter an equipment Name and/or Model above and press Search. The equipment's PDF manual will open here.";

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700;800&family=Barlow+Condensed:wght@700;800&display=swap');
        .mm-root { min-height:100vh; background:#eef2f7; font-family:'Barlow',sans-serif; padding-bottom:50px; }
        .mm-top { background:#fff; border-bottom:1px solid #e2e8f0; height:56px; padding:0 28px 0 96px;
                  display:flex; align-items:center; justify-content:space-between;
                  position:sticky; top:0; z-index:50; box-shadow:0 1px 3px rgba(0,0,0,.06); }
        .mm-top::after { content:''; position:absolute; bottom:0; left:0; right:0; height:2px; background:${theme.gradient}; }
        .mm-title { font-family:'Barlow Condensed',sans-serif; font-size:22px; font-weight:800; color:#0f172a; }
        .mm-title span { color:${theme.accent}; }
        .mm-sub { font-size:11px; color:#94a3b8; margin-top:-2px; }
        .mm-back { display:flex; align-items:center; gap:6px; font-size:13px; font-weight:700; color:#475569;
                   background:#f1f5f9; border:1px solid #e2e8f0; border-radius:8px; padding:7px 14px; cursor:pointer; }
        .mm-tabs { max-width:1400px; margin:16px auto 0; padding:0 22px; display:flex; gap:10px; }
        .mm-tab { display:inline-flex; align-items:center; gap:8px; padding:9px 20px; border-radius:99px;
                  border:1.5px solid #e2e8f0; background:#fff; color:#64748b; font-size:13px; font-weight:800;
                  cursor:pointer; font-family:'Barlow',sans-serif; }
        .mm-tab.active { border-color:${theme.accent}; background:${theme.accent}; color:#fff; }
        .mm-filters { max-width:1400px; margin:14px auto 0; padding:0 22px; display:flex; gap:12px; flex-wrap:wrap; align-items:flex-end; }
        .mm-sel:disabled { background:#f1f5f9; color:#94a3b8; cursor:not-allowed; }
        .mm-body { max-width:1400px; margin:18px auto 0; padding:0 22px; }
        .mm-card { background:#fff; border:1px solid #e2e8f0; border-radius:14px; box-shadow:0 1px 4px rgba(15,23,42,.06); }
        .mm-badge { display:inline-block; font-size:9.5px; font-weight:800; letter-spacing:.06em; text-transform:uppercase;
                    color:#92400e; background:#fef3c7; border:1px solid #fcd34d; border-radius:99px; padding:3px 10px; }
        .mm-go { background:${theme.accent}; color:#fff; border:none; border-radius:9px; padding:9px 20px;
                 font-size:13px; font-weight:800; cursor:pointer; font-family:'Barlow',sans-serif; }
      `}</style>

      <div className="mm-root">
        <div className="mm-top">
          <div style={{ display:"flex", alignItems:"center", gap:14 }}>
            <button className="mm-back" onClick={() => nav("/dashboard")}>← Back</button>
            <div>
              <div className="mm-title">Machine <span>Manual</span></div>
              <div className="mm-sub">View / upload machine &amp; equipment manuals (PDF)</div>
            </div>
          </div>
          {user?.username && <span style={{ fontSize:12, color:"#64748b", fontWeight:600 }}>{user.username}</span>}
        </div>

        {/* ── tab switcher ── */}
        <div className="mm-tabs">
          <button className={`mm-tab${mode === "machine" ? " active" : ""}`} onClick={() => switchMode("machine")}>
            🛠 Machine Manual
          </button>
          <button className={`mm-tab${mode === "equipment" ? " active" : ""}`} onClick={() => switchMode("equipment")}>
            ⚙ Equipment Manual
          </button>
        </div>

        {/* ── the search/filter row (per tab) ── */}
        {mode === "machine" ? (
          <div className="mm-filters">
            <Fld label="Zone">
              <select style={sel2} value={zone} onChange={(e) => onZone(e.target.value)}>
                <option value="">— zone —</option>
                {zoneOpts.map((z) => <option key={z} value={z}>{z}</option>)}
              </select>
            </Fld>
            <Fld label="Line">
              <select style={sel2} className="mm-sel" value={line} onChange={(e) => onLine(e.target.value)} disabled={!zone}>
                <option value="">— line —</option>
                {lineOpts.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </Fld>
            <Fld label="Machine No.">
              <select style={sel2} className="mm-sel" value={mno} onChange={(e) => onMno(e.target.value)} disabled={!line}>
                <option value="">— machine no —</option>
                {machineNoOpts.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </Fld>
            <Fld label="Machine Name">
              <select style={sel2} className="mm-sel" value={mname} onChange={(e) => onMname(e.target.value)} disabled={!line}>
                <option value="">— machine name —</option>
                {machineNameOpts.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </Fld>
            <Fld label="&nbsp;">
              <button className="mm-back" style={{ padding:"9px 16px" }} onClick={clearAll}>✕ Clear</button>
            </Fld>
          </div>
        ) : (
          <div className="mm-filters">
            <Fld label="Equipment Name">
              <input style={{ ...sel2, minWidth:240 }} value={eqName}
                     placeholder="e.g. WELDING ROBOT"
                     onChange={(e) => setEqName(e.target.value.toUpperCase())}
                     onKeyDown={(e) => { if (e.key === "Enter") searchEquipment(); }} />
            </Fld>
            <Fld label="Model">
              <input style={{ ...sel2, minWidth:200 }} value={eqModel}
                     placeholder="e.g. FANUC R-2000iC"
                     onChange={(e) => setEqModel(e.target.value.toUpperCase())}
                     onKeyDown={(e) => { if (e.key === "Enter") searchEquipment(); }} />
            </Fld>
            <Fld label="&nbsp;">
              <button className="mm-go" onClick={searchEquipment}>🔍 Search</button>
            </Fld>
            <Fld label="&nbsp;">
              <button className="mm-back" style={{ padding:"9px 16px" }} onClick={clearEquipment}>✕ Clear</button>
            </Fld>
          </div>
        )}

        <div className="mm-body">
          {!subject ? (
            /* nothing picked/searched yet */
            <div className="mm-card" style={{ padding:"70px 30px", textAlign:"center", marginTop:6 }}>
              <div style={{ fontSize:42, marginBottom:10 }}>{mode === "machine" ? "📄" : "⚙"}</div>
              <div style={{ fontSize:16, fontWeight:800, color:"#0f172a" }}>
                {mode === "machine" ? "Select a machine to see its manual" : "Search an equipment to see its manual"}
              </div>
              <div style={{ fontSize:12.5, color:"#64748b", marginTop:6 }}>{promptText}</div>
            </div>
          ) : (
            <>
              {/* subject header */}
              <div className="mm-card" style={{ padding:"16px 20px", marginBottom:16, display:"flex",
                                                 alignItems:"center", gap:22, flexWrap:"wrap" }}>
                <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:30, fontWeight:800,
                              color:theme.accent, lineHeight:1 }}>
                  {subject.title}
                </div>
                <div style={{ display:"flex", gap:26, flexWrap:"wrap", fontSize:13, color:"#0f172a" }}>
                  {subject.meta.map(([k, v]) => <span key={k}><b>{k}</b> {v}</span>)}
                </div>
                <span style={{ marginLeft:"auto" }} className="mm-badge">Manual · PDF</span>
              </div>

              {/* ── admin upload / update (front only — no save yet) ── */}
              {isAdmin && (
                <div className="mm-card" style={{ padding:"16px 20px", marginBottom:16 }}>
                  <div style={{ fontSize:13.5, fontWeight:800, color:"#0f172a", marginBottom:4 }}>
                    ⬆ Upload / Update Manual <span style={{ fontSize:11, fontWeight:700, color:"#b45309" }}>(Maintenance Panel)</span>
                  </div>
                  <div style={{ fontSize:11.5, color:"#94a3b8", marginBottom:12 }}>
                    PDF only. This uploads/updates the manual for <b>{subject.label}</b>.
                  </div>
                  <div style={{ display:"flex", gap:12, alignItems:"center", flexWrap:"wrap" }}>
                    <label style={{ display:"inline-flex", alignItems:"center", gap:8, cursor:"pointer",
                                    background:theme.accent, color:"#fff", fontSize:13, fontWeight:800,
                                    borderRadius:9, padding:"10px 18px" }}>
                      📎 Choose PDF
                      <input type="file" accept="application/pdf" onChange={onPick} style={{ display:"none" }} />
                    </label>
                    {picked && <span style={{ fontSize:12.5, color:"#334155", fontWeight:600 }}>Selected: <b>{picked.name}</b></span>}
                    <button disabled
                            title="Save wiring pending — will be added later"
                            style={{ background:"#e2e8f0", color:"#94a3b8", border:"none", borderRadius:9,
                                     padding:"10px 18px", fontSize:13, fontWeight:800, cursor:"not-allowed" }}>
                      💾 Update (pending)
                    </button>
                  </div>
                  <div style={{ marginTop:10, fontSize:11, color:"#94a3b8", fontStyle:"italic" }}>
                    ⚠ Front view only — the picked PDF previews below but is <b>not saved</b> yet (storage to be wired later).
                  </div>
                </div>
              )}

              {/* ── manual viewer ── */}
              <div className="mm-card" style={{ overflow:"hidden" }}>
                <div style={{ display:"flex", alignItems:"center", gap:10, padding:"12px 18px", borderBottom:"1px solid #eef2f7" }}>
                  <span style={{ fontSize:14, fontWeight:800, color:"#0f172a" }}>📖 Manual — {subject.title}</span>
                  {picked && <span style={{ fontSize:11.5, color:"#64748b" }}>{picked.name}</span>}
                  <span style={{ marginLeft:"auto", fontSize:11, color:"#94a3b8" }}>
                    {picked ? "local preview (not saved)" : "no manual on record"}
                  </span>
                </div>
                {picked ? (
                  <iframe title="manual-pdf" src={picked.url}
                          style={{ width:"100%", height:"70vh", border:"none", display:"block" }} />
                ) : (
                  <div style={{ padding:"70px 30px", textAlign:"center" }}>
                    <div style={{ fontSize:38, marginBottom:10 }}>🗎</div>
                    <div style={{ fontSize:15, fontWeight:800, color:"#0f172a" }}>No manual uploaded yet</div>
                    <div style={{ fontSize:12.5, color:"#64748b", marginTop:6 }}>
                      {isAdmin
                        ? "Use “Choose PDF” above to preview a manual here."
                        : "The manual will appear here once Maintenance uploads it."}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
