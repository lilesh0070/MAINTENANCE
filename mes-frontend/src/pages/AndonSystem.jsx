/* ───────────────────────────────────────────────────────────────────
 * AndonSystem.jsx
 * ───────────────────────────────────────────────────────────────────
 * "ANDON" — standalone Industrial ANDON Management module (sidebar → ANDON).
 * Configured entirely from THIS UI (no source change to add an ESP / department).
 *   • Zone / Line come from the machine master (mes_machines), like every page.
 *   • ESP32 devices: name · ip · port · zone · line · enable.
 *   • Departments: an editable list (Maintenance/Quality/Production/Store …).
 *   • Output mapping: DO1–DO8 → a department (+ display name / priority / enable),
 *     a shared default + per-ESP override.  Time calc (Phase 3) is per-department.
 * Backend: /api/andon/*.  Routing: /andon-system.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const PRIORITIES = ["Critical", "High", "Normal", "Low"];
const PRIO_COLOR = { Critical: "#dc2626", High: "#ea580c", Normal: "#2563eb", Low: "#64748b" };
const prioColor = (p) => PRIO_COLOR[p] || "#2563eb";

// Live board par har call ka apna rang — priority se nahi, DEPARTMENT se.
// (Priority se rang lene par saare "Normal" wale ek jaise neele dikhte the.)
// Plant ka fixed wiring: DO1 Maintenance · DO3 Toolroom · DO5 Quality ·
// DO6 Material · DO7 Other Loss. Naam badla ho to naam se, warna DO index se.
const DEPT_COLOR = {
  maintenance: "#dc2626",   // laal
  toolroom:    "#ea580c",   // narangi
  quality:     "#7c3aed",   // baingani
  material:    "#0d9488",   // teal
  "other loss":"#2563eb",   // neela
};
const DO_COLOR = { 1:"#dc2626", 2:"#dc2626", 3:"#ea580c", 4:"#ea580c",
                   5:"#7c3aed", 6:"#0d9488", 7:"#2563eb", 8:"#64748b" };
// jo in dono me na mile uske liye stable fallback (naam ke hash se)
const FALLBACK = ["#0891b2", "#c026d3", "#65a30d", "#e11d48", "#4f46e5", "#b45309"];
const deptColor = (ev) => {
  const key = String(ev?.department || ev?.display_name || "").trim().toLowerCase();
  if (DEPT_COLOR[key]) return DEPT_COLOR[key];
  if (DO_COLOR[ev?.do_index]) return DO_COLOR[ev.do_index];
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return FALLBACK[h % FALLBACK.length];
};
const fmtClock = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  const p2 = (n) => String(n).padStart(2, "0");
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return (h ? p2(h) + ":" : "") + p2(m) + ":" + p2(s % 60);
};
// DO2 acknowledges DO1 (Maintenance), DO4 acknowledges DO3 (Toolroom) — an ACK
// output belongs to the SAME department as the call it responds to.
const ACK_PARENT = { 2: 1, 4: 3 };

export default function AndonSystem() {
  const { token, theme, user } = useAuth();
  const nav = useNavigate();
  const accent = theme?.accent || "#dc2626";

  const api = useCallback(async (path, opts = {}) => {
    const r = await fetch(`/api/andon${path}`, {
      ...opts,
      headers: { "Content-Type": "application/json",
                 ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) },
    });
    if (!r.ok) {
      // FastAPI galti ko {"detail":"..."} me bhejta hai — seedha text dikhane
      // par user ko JSON dikhta tha.  Yahan se saaf message nikal lete hain.
      const raw = await r.text().catch(() => "");
      let msg = raw;
      try { const j = JSON.parse(raw); msg = j?.detail || raw; } catch { /* plain text */ }
      const err = new Error(msg || `HTTP ${r.status}`);
      err.status = r.status;            // 409 = takraav (duplicate IP/naam)
      throw err;
    }
    return r.status === 204 ? null : r.json();
  }, [token]);

  const [tab, setTab] = useState("config");
  const [cfg, setCfg] = useState("esp");            // esp | outputs
  const [msg, setMsg] = useState("");
  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(""), 2500); };

  const [master, setMaster]   = useState([]);       // flat mes_machines rows (zone_name/line_name/machine_no/machine_name)
  const [depts, setDepts]     = useState([]);
  const [esps, setEsps]       = useState([]);
  const [events, setEvents]   = useState([]);       // live OPEN calls (the board)
  const [evAt, setEvAt]       = useState(0);         // Date.now() at last /events fetch
  const [, setTick]           = useState(0);         // 1s heartbeat so timers advance smoothly

  const load = useCallback(async () => {
    try {
      const [mc, d, e] = await Promise.all([
        fetch("/api/machines/", { headers: { Authorization: `Bearer ${token}` } }).then((r) => (r.ok ? r.json() : [])).catch(() => []),
        api("/departments").catch(() => []), api("/esp-devices").catch(() => []),
      ]);
      setMaster(Array.isArray(mc) ? mc : []); setDepts(d || []); setEsps(e || []);
    } catch (err) { flash(String(err.message || err).slice(0, 120)); }
  }, [api, token]);
  useEffect(() => { if (token) load(); }, [token, load]);
  // live ESP connectivity — re-poll the list every 10s so the green/red dots update
  useEffect(() => {
    if (!token) return;
    const id = setInterval(() => { api("/esp-devices").then((e) => setEsps(e || [])).catch(() => {}); }, 10000);
    return () => clearInterval(id);
  }, [token, api]);
  // ── Live board: pull active calls every 2s while the board tab is open ──
  useEffect(() => {
    if (!token || tab !== "board") return;
    let alive = true;
    const pull = () => api("/events").then((e) => { if (alive) { setEvents(e || []); setEvAt(Date.now()); } }).catch(() => {});
    pull();
    const id = setInterval(pull, 2000);
    return () => { alive = false; clearInterval(id); };
  }, [token, tab, api]);
  // 1s heartbeat so the running timers advance between the 2s polls
  useEffect(() => {
    if (tab !== "board") return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [tab]);
  // elapsed = server value at fetch + wall-clock since fetch (timezone-proof)
  const liveElapsed = (ev) => (ev.elapsed_seconds || 0) + (evAt ? Math.max(0, Math.floor((Date.now() - evAt) / 1000)) : 0);
  // group active calls by the ESP's defined zone / line
  const eventsByLine = useMemo(() => {
    const g = {};
    for (const ev of events) { const k = `${ev.zone || "—"} / ${ev.line || "—"}`; (g[k] = g[k] || []).push(ev); }
    return g;
  }, [events]);
  // Takraav (409) = wahi IP/naam kisi aur ESP ki hai.  Ye chhote toast me
  // dabana theek nahi — galat IP par do board ka data ek jagah chala jayega
  // aur pata bhi nahi chalega.  Isliye poora popup, jo khud gayab na ho.
  const [alertBox, setAlertBox] = useState(null);   // { title, text }
  const wrap = async (fn, ok) => {
    try {
      await fn();
      await load();
      if (ok) flash(ok);
    } catch (e) {
      const text = String(e?.message || e);
      if (e?.status === 409) setAlertBox({ title: "Ye IP / naam pehle se use me hai", text });
      else flash(text.slice(0, 140));
    }
  };

  // ── Departments ──
  const [dName, setDName] = useState("");

  // ── ESP form (zone / line from the machine master) ──
  const blankEsp = { name: "", ip: "", port: 8080, zone: "", line: "", machine_no: "", machine_name: "", enabled: true };
  const [espForm, setEspForm] = useState(blankEsp);
  const [espEdit, setEspEdit] = useState(null);
  // zone → line → machine cascade, all from the machine master (like every page)
  const espZones    = useMemo(() => [...new Set(master.map((m) => m.zone_name).filter(Boolean))].sort(), [master]);
  const espLines    = useMemo(() => espForm.zone ? [...new Set(master.filter((m) => m.zone_name === espForm.zone).map((m) => m.line_name).filter(Boolean))].sort() : [], [master, espForm.zone]);
  const espMachines = useMemo(() => (espForm.zone && espForm.line) ? [...new Set(master.filter((m) => m.zone_name === espForm.zone && m.line_name === espForm.line).map((m) => m.machine_no).filter(Boolean))].sort() : [], [master, espForm.zone, espForm.line]);
  const onEspMachine = (v) => {
    const m = master.find((x) => x.zone_name === espForm.zone && x.line_name === espForm.line && String(x.machine_no) === String(v));
    setEspForm((f) => ({ ...f, machine_no: v, machine_name: m?.machine_name || "" }));
  };
  const startEspEdit = (e) => { setEspEdit(e.id); setEspForm({ ...blankEsp, ...e, zone: e.zone || "", line: e.line || "", machine_no: e.machine_no || "", machine_name: e.machine_name || "" }); setCfg("esp"); };
  const saveEsp = () => wrap(async () => {
    const body = { name: espForm.name, ip: espForm.ip, port: Number(espForm.port) || 80,
                   zone: espForm.zone || "", line: espForm.line || "", machine_no: espForm.machine_no || "",
                   machine_name: espForm.machine_name || "", enabled: espForm.enabled };
    if (espEdit) await api(`/esp-devices/${espEdit}`, { method: "PUT", body: JSON.stringify(body) });
    else await api("/esp-devices", { method: "POST", body: JSON.stringify(body) });
    setEspForm(blankEsp); setEspEdit(null);
  }, espEdit ? "ESP updated" : "ESP added");

  // ── Output mapping (default template OR a specific ESP) ──
  const [outFor, setOutFor] = useState({ type: "default", id: null, name: "Default template" });
  const [outRows, setOutRows] = useState([]);
  const [outZone, setOutZone] = useState("");
  const [outLine, setOutLine] = useState("");
  const loadOutputs = useCallback(async (target) => {
    setOutFor(target);
    const rows = target.type === "default" ? await api("/outputs/default") : await api(`/esp-devices/${target.id}/outputs`);
    setOutRows(rows || []); setCfg("outputs");
  }, [api]);
  const outLinesFor = (z) => z ? [...new Set(master.filter((m) => m.zone_name === z).map((m) => m.line_name).filter(Boolean))].sort() : [];
  // Output mapping target: no zone = the shared Default template; zone + line =
  // the ESP sitting on that zone/line (its own override).
  const pickOutTarget = (zone, line) => {
    setOutZone(zone); setOutLine(line);
    if (!zone) { loadOutputs({ type: "default", id: null, name: "Default template" }); return; }
    if (zone && line) {
      const e = esps.find((x) => x.zone === zone && x.line === line);
      if (e) loadOutputs({ type: "esp", id: e.id, name: `${e.name} — ${zone} / ${line}` });
      else { setOutFor({ type: "none", id: null, name: `No ESP on ${zone} / ${line}` }); setOutRows([]); }
    } else { setOutFor({ type: "pick", id: null, name: "Select a line" }); setOutRows([]); }
  };
  useEffect(() => { if (token && cfg === "outputs" && !outRows.length) loadOutputs({ type: "default", id: null, name: "Default template" }); /* eslint-disable-next-line */ }, [cfg, token]);
  const setOut = (i, k, v) => setOutRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const saveOutputs = () => wrap(async () => {
    const body = { rows: outRows.map((r) => ({ do_index: r.do_index, display_name: r.display_name,
      department_id: r.department_id || null, priority: r.priority || "Normal", enabled: r.enabled !== false })) };
    if (outFor.type === "default") await api("/outputs/default", { method: "PUT", body: JSON.stringify(body) });
    else await api(`/esp-devices/${outFor.id}/outputs`, { method: "PUT", body: JSON.stringify(body) });
  }, "Output mapping saved");
  // each department appears ONCE — its dropdown excludes departments used by other rows
  const deptUsedElsewhere = (i) => new Set(outRows.filter((_, j) => j !== i).map((r) => r.department_id).filter(Boolean));
  const onOutDept = (i, deptId) => {
    const d = depts.find((x) => x.id === deptId);
    setOutRows((rs) => rs.map((r, j) => (j === i ? { ...r, department_id: deptId, display_name: d ? d.name : (r.display_name || "") } : r)));
  };
  const addOutput = () => {
    if (outRows.length >= 8) { flash("Max 8 outputs (ESP has DO1–DO8)"); return; }
    const usedDo = new Set(outRows.map((r) => r.do_index));
    let nd = 1; while (usedDo.has(nd) && nd < 8) nd++;
    const used = new Set(outRows.map((r) => r.department_id).filter(Boolean));
    const free = depts.find((d) => !used.has(d.id));
    setOutRows((rs) => [...rs, { do_index: nd, department_id: free?.id || null,
      display_name: free ? free.name : "", priority: "Normal", enabled: true }]);
  };
  const removeOutput = (i) => setOutRows((rs) => rs.filter((_, j) => j !== i));

  return (
    <>
      <style>{`
        .an-root { min-height:100vh; background:#eef2f7; font-family:'Barlow',system-ui,sans-serif; padding-bottom:44px; }
        .an-top { background:#fff; border-bottom:1px solid #e2e8f0; height:58px; padding:0 26px 0 92px;
                  display:flex; align-items:center; justify-content:space-between; position:sticky; top:0; z-index:40; }
        .an-top::after { content:''; position:absolute; bottom:0; left:0; right:0; height:2px; background:${theme?.gradient || accent}; }
        .an-ttl { font-size:20px; font-weight:800; color:#0f172a; } .an-ttl span { color:${accent}; }
        .an-sub { font-size:11px; color:#94a3b8; margin-top:-2px; }
        .an-back,.an-btn { font-size:13px; font-weight:700; border-radius:8px; padding:8px 14px; cursor:pointer; border:1px solid #e2e8f0; }
        .an-back { color:#475569; background:#f1f5f9; }
        .an-btn { background:${accent}; color:#fff; border-color:${accent}; } .an-btn.gh { background:#fff; color:#334155; }
        .an-btn.sm { padding:5px 10px; font-size:12px; } .an-btn:disabled { opacity:.5; cursor:not-allowed; }
        .an-body { max-width:1180px; margin:16px auto 0; padding:0 22px; }
        .an-tabs { display:flex; gap:8px; margin-bottom:16px; }
        .an-tab { border:1px solid #cbd5e1; background:#fff; color:#334155; font-weight:700; font-size:13px; padding:9px 18px; border-radius:99px; cursor:pointer; }
        .an-tab.on { background:${accent}; color:#fff; border-color:${accent}; }
        .an-ctabs { display:flex; gap:6px; margin-bottom:14px; }
        .an-ctab { border:1px solid #cbd5e1; background:#fff; color:#475569; font-weight:700; font-size:12.5px; padding:7px 16px; border-radius:8px; cursor:pointer; }
        .an-ctab.on { background:#0f172a; color:#fff; border-color:#0f172a; }
        .an-card { background:#fff; border:1px solid #e2e8f0; border-radius:13px; padding:16px; box-shadow:0 1px 4px rgba(15,23,42,.05); }
        .an-row { display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
        .an-in { border:1.5px solid #cbd5e1; border-radius:8px; padding:8px 11px; font-size:13px; font-family:inherit; outline:none; }
        .an-in:focus { border-color:${accent}; } .an-in:disabled { background:#f1f5f9; color:#94a3b8; }
        .an-tbl { width:100%; border-collapse:collapse; font-size:13px; margin-top:6px; }
        .an-tbl th { text-align:left; padding:8px 10px; font-size:10px; font-weight:800; letter-spacing:.04em; text-transform:uppercase; color:#64748b; border-bottom:1px solid #e2e8f0; }
        .an-tbl td { padding:9px 10px; border-bottom:1px solid #f1f5f9; color:#334155; }
        .an-x { border:none; background:transparent; color:#dc2626; cursor:pointer; font-weight:800; font-size:16px; }
        .an-lbl { font-size:10.5px; font-weight:800; letter-spacing:.04em; text-transform:uppercase; color:#64748b; margin-bottom:4px; display:block; }
        .an-chip { display:inline-flex; align-items:center; gap:6px; font-size:12.5px; font-weight:700; padding:5px 6px 5px 11px; border-radius:99px; }
        .an-panel { background:#fff; border:1px solid #e2e8f0; border-radius:13px; padding:34px; text-align:center; }
        .an-panel .big { font-size:40px; } .an-panel h2 { font-size:17px; font-weight:800; color:#0f172a; margin:10px 0 6px; }
        .an-panel p { font-size:13px; color:#64748b; max-width:560px; margin:0 auto; line-height:1.6; }
        .an-msg { position:fixed; bottom:20px; left:50%; transform:translateX(-50%); background:#0f172a; color:#fff; padding:10px 18px; border-radius:10px; font-size:13px; font-weight:600; z-index:9999; box-shadow:0 8px 24px rgba(0,0,0,.3); }
      `}</style>

      <div className="an-root">
        <div className="an-top">
          <div style={{ display:"flex", alignItems:"center", gap:14 }}>
            <button className="an-back" onClick={() => nav("/dashboard")}>← Back</button>
            <div>
              <div className="an-ttl">🚦 ANDON <span>Management</span></div>
              <div className="an-sub">ESP32-driven · zone/line from machine master · {esps.length} ESP · {depts.length} departments</div>
            </div>
          </div>
          {user?.username && <span style={{ fontSize:12, color:"#64748b", fontWeight:600 }}>{user.username}</span>}
        </div>

        <div className="an-body">
          <div className="an-tabs">
            {[["board","Live Board"],["config","Configuration"],["reports","Reports"]].map(([k, l]) => (
              <button key={k} className={`an-tab${tab === k ? " on" : ""}`} onClick={() => setTab(k)}>{l}</button>
            ))}
          </div>

          {tab === "config" && (
            <>
              <div className="an-ctabs">
                {[["esp","ESP Devices"],["outputs","Outputs"]].map(([k, l]) => (
                  <button key={k} className={`an-ctab${cfg === k ? " on" : ""}`} onClick={() => setCfg(k)}>{l}</button>
                ))}
              </div>

              {/* ── ESP DEVICES ── */}
              {cfg === "esp" && (
                <>
                  <div className="an-card" style={{ marginBottom:14 }}>
                    <b style={{ fontSize:14 }}>{espEdit ? "Edit ESP32" : "Add ESP32"}</b>
                    <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, marginTop:12 }}>
                      <div><label className="an-lbl">Zone</label>
                        <select className="an-in" style={{ width:"100%" }} value={espForm.zone} onChange={(e) => setEspForm({ ...espForm, zone: e.target.value, line: "", machine_no: "", machine_name: "" })}>
                          <option value="">— select —</option>{espZones.map((z) => <option key={z} value={z}>{z}</option>)}
                        </select></div>
                      <div><label className="an-lbl">Line</label>
                        <select className="an-in" style={{ width:"100%" }} value={espForm.line} disabled={!espForm.zone} onChange={(e) => setEspForm({ ...espForm, line: e.target.value, machine_no: "", machine_name: "" })}>
                          <option value="">— select —</option>{espLines.map((l) => <option key={l} value={l}>{l}</option>)}
                        </select></div>
                      <div><label className="an-lbl">Machine No</label>
                        <select className="an-in" style={{ width:"100%" }} value={espForm.machine_no} disabled={!espForm.line} onChange={(e) => onEspMachine(e.target.value)}>
                          <option value="">— select —</option>{espMachines.map((mc) => <option key={mc} value={mc}>{mc}</option>)}
                        </select>
                        {espForm.machine_name && <div style={{ fontSize:11, color:"#94a3b8", marginTop:3 }}>{espForm.machine_name}</div>}
                      </div>
                      <div><label className="an-lbl">ESP IP Address</label><input className="an-in" style={{ width:"100%" }} value={espForm.ip} onChange={(e) => setEspForm({ ...espForm, ip: e.target.value })} placeholder="192.168.30.101" /></div>
                      <div><label className="an-lbl">Port</label><input className="an-in" style={{ width:"100%" }} type="number" value={espForm.port} onChange={(e) => setEspForm({ ...espForm, port: e.target.value })} /></div>
                      <div><label className="an-lbl">Device Name</label><input className="an-in" style={{ width:"100%" }} value={espForm.name} onChange={(e) => setEspForm({ ...espForm, name: e.target.value })} placeholder="e.g. Zone A Line 1" /></div>
                    </div>
                    <div className="an-row" style={{ marginTop:12 }}>
                      <label style={{ fontSize:13, fontWeight:700, display:"flex", alignItems:"center", gap:6 }}>
                        <input type="checkbox" checked={espForm.enabled} onChange={(e) => setEspForm({ ...espForm, enabled: e.target.checked })} /> Enabled (poll this ESP)
                      </label>
                      <div style={{ marginLeft:"auto" }} />
                      {espEdit && <button className="an-btn gh" onClick={() => { setEspEdit(null); setEspForm(blankEsp); }}>Cancel</button>}
                      <button className="an-btn" disabled={!espForm.name.trim() || !espForm.ip.trim()} onClick={saveEsp}>{espEdit ? "Save" : "+ Add ESP"}</button>
                    </div>
                    {!espZones.length && <div style={{ fontSize:12, color:"#b45309", marginTop:8 }}>No zones in the machine master (mes_machines) yet — zone/line/machine list is empty.</div>}
                  </div>
                  <div className="an-card">
                    <b style={{ fontSize:14 }}>ESP Devices ({esps.length})</b>
                    <table className="an-tbl">
                      <thead><tr><th>Name</th><th>IP:Port</th><th>Zone / Line / M/C</th><th>Connection</th><th>Status</th><th></th></tr></thead>
                      <tbody>
                        {esps.map((e) => (
                          <tr key={e.id}>
                            <td style={{ fontWeight:600 }}>{e.name}</td>
                            <td>{e.ip}:{e.port}</td>
                            <td>{[e.zone, e.line, e.machine_no].filter(Boolean).join(" / ") || "—"}</td>
                            <td>
                              {!e.enabled ? <span style={{ color:"#94a3b8", fontSize:12 }}>— off —</span> : (
                                <span style={{ display:"inline-flex", alignItems:"center", gap:7, fontWeight:700, fontSize:12,
                                               color: e.online === true ? "#16a34a" : e.online === false ? "#dc2626" : "#94a3b8" }}
                                      title={e.last_seen ? `last seen ${e.last_seen}` : (e.checked ? `checked ${e.checked}` : "")}>
                                  <span style={{ width:10, height:10, borderRadius:"50%", flex:"0 0 auto",
                                                 background: e.online === true ? "#16a34a" : e.online === false ? "#dc2626" : "#cbd5e1",
                                                 boxShadow: e.online === true ? "0 0 0 3px rgba(22,163,74,.2)" : e.online === false ? "0 0 0 3px rgba(220,38,38,.2)" : "none" }} />
                                  {e.online === true ? "Connected" : e.online === false ? "Disconnected" : "Checking…"}
                                </span>
                              )}
                            </td>
                            <td><span className="an-chip" style={{ padding:"2px 9px", background: e.enabled ? "#dcfce7" : "#fee2e2", color: e.enabled ? "#16a34a" : "#dc2626" }}>{e.enabled ? "Enabled" : "Disabled"}</span></td>
                            <td style={{ whiteSpace:"nowrap" }}>
                              <button className="an-btn gh sm" onClick={() => loadOutputs({ type:"esp", id:e.id, name:e.name })}>🔌 Outputs</button>{" "}
                              <button className="an-btn gh sm" onClick={() => startEspEdit(e)}>Edit</button>{" "}
                              <button className="an-x" onClick={() => wrap(() => api(`/esp-devices/${e.id}`, { method:"DELETE" }), "ESP removed")}>×</button>
                            </td>
                          </tr>
                        ))}
                        {!esps.length && <tr><td colSpan={6} style={{ color:"#94a3b8" }}>No ESP devices yet.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {/* ── OUTPUTS (departments + DO1–DO8 → department) ── */}
              {cfg === "outputs" && (
                <>
                  <div className="an-card" style={{ marginBottom:14 }}>
                    <b style={{ fontSize:14 }}>Departments</b>
                    <div style={{ fontSize:11.5, color:"#94a3b8", margin:"4px 0 10px" }}>Every output maps to one of these. Time calculation is per-department.</div>
                    <div className="an-row">
                      {depts.map((d) => (
                        <span key={d.id} className="an-chip" style={{ background: (d.color || "#2563eb") + "1a", color: d.color || "#2563eb" }}>
                          {d.name}
                          <button className="an-x" style={{ fontSize:14, color:"inherit", opacity:.7 }} onClick={() => wrap(() => api(`/departments/${d.id}`, { method:"DELETE" }), "Department removed")}>×</button>
                        </span>
                      ))}
                    </div>
                    <div className="an-row" style={{ marginTop:12 }}>
                      <input className="an-in" placeholder="New department" value={dName} onChange={(e) => setDName(e.target.value)} style={{ width:240 }} />
                      <button className="an-btn" disabled={!dName.trim()}
                              onClick={() => wrap(async () => { await api("/departments", { method:"POST", body: JSON.stringify({ name: dName.trim() }) }); setDName(""); }, "Department added")}>+ Add</button>
                    </div>
                  </div>

                  <div className="an-card">
                    <div className="an-row" style={{ marginBottom:6 }}>
                      <b style={{ fontSize:14 }}>Output Mapping</b>
                      <span style={{ marginLeft:"auto", fontSize:11.5, color:"#94a3b8" }}>Fixed plant scheme — same DO1–DO7 wiring for every ESP.</span>
                    </div>
                    <table className="an-tbl">
                      <thead><tr><th style={{ width:200 }}>Output</th><th>Department / role</th></tr></thead>
                      <tbody>
                        {outRows.map((r) => {
                          const parentDo = ACK_PARENT[r.do_index];               // DO2→DO1, DO4→DO3
                          const isAck = !!parentDo;
                          const deptId = isAck ? outRows.find((x) => x.do_index === parentDo)?.department_id : r.department_id;
                          const dept = depts.find((d) => d.id === deptId);
                          return (
                            <tr key={r.do_index}>
                              <td style={{ fontWeight:800 }}>
                                {r.display_name || `OUT${r.do_index}`}
                                <div style={{ fontSize:10.5, fontWeight:600, color:"#94a3b8" }}>OUT{r.do_index}</div>
                              </td>
                              <td>
                                <span style={{ fontWeight:700 }}>{dept ? dept.name : (r.display_name || "—")}</span>
                                {isAck && <span style={{ fontSize:10.5, fontWeight:600, color:"#94a3b8", marginLeft:8 }}>⏱ response time</span>}
                              </td>
                            </tr>
                          );
                        })}
                        {!outRows.length && <tr><td colSpan={2} style={{ color:"#94a3b8" }}>Loading…</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}

          {tab === "board" && (
            <>
              <div className="an-row" style={{ marginBottom:14, justifyContent:"space-between", alignItems:"center" }}>
                <b style={{ fontSize:16, color:"#0f172a" }}>🚦 Live ANDON Board</b>
                <span style={{ fontSize:12, color:"#64748b", fontWeight:600 }}>
                  <span style={{ display:"inline-block", width:8, height:8, borderRadius:99, background:"#16a34a", marginRight:6 }} />
                  {events.length} active call{events.length === 1 ? "" : "s"} · auto-refresh 2s
                </span>
              </div>

              {!events.length ? (
                <div className="an-panel"><div className="big">✅</div><h2>All clear</h2>
                  <p>No active ANDON calls right now. Press a button on the ESP — the call appears here on its defined line, with a running timer.</p></div>
              ) : (
                Object.entries(eventsByLine).map(([line, evs]) => (
                  <div key={line} className="an-card" style={{ marginBottom:14 }}>
                    <div style={{ fontSize:13.5, fontWeight:800, color:"#0f172a", marginBottom:12 }}>📍 {line}</div>
                    {/* Saare active calls EK hi line me. auto-fill wrap kar deta tha
                        (5 calls => 4 + 1). Ab jitne calls utne hi columns, sab barabar
                        chaudai me. Bahut zyada calls hon to line todne ke bajaye
                        line andar hi horizontally scroll ho jayegi. */}
                    <div style={{ display:"grid", gridTemplateColumns:`repeat(${evs.length},minmax(200px,1fr))`,
                                  gap:12, overflowX:"auto", paddingBottom:2 }}>
                      {evs.map((ev) => {
                        const c = deptColor(ev);            // card ka rang = department ka rang
                        const acked = !!ev.acknowledged_at;
                        return (
                          <div key={ev.id} style={{ border:`1px solid ${c}33`, borderLeft:`6px solid ${c}`, borderRadius:11,
                                                     padding:"12px 14px", background:`${c}0d` }}>
                            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:8 }}>
                              <div style={{ fontSize:15.5, fontWeight:800, color:"#0f172a", lineHeight:1.2 }}>
                                {ev.display_name || ev.department || `OUT${ev.do_index}`}
                              </div>
                              {(() => { const pc = prioColor(ev.priority);   // badge ka rang priority ka hi rahega
                                return (
                              <span style={{ fontSize:9.5, fontWeight:800, color:pc, background:`${pc}1a`, padding:"3px 8px",
                                             borderRadius:99, textTransform:"uppercase", whiteSpace:"nowrap" }}>{ev.priority || "Normal"}</span>
                                ); })()}
                            </div>
                            {ev.department && ev.department !== ev.display_name &&
                              <div style={{ fontSize:11.5, color:"#64748b", marginTop:1 }}>{ev.department}</div>}
                            <div style={{ fontSize:28, fontWeight:800, color:c, fontVariantNumeric:"tabular-nums", margin:"7px 0 3px" }}>
                              {fmtClock(liveElapsed(ev))}
                            </div>
                            <div style={{ fontSize:11, color:"#94a3b8" }}>OUT{ev.do_index} · {ev.esp_name || "ESP"}</div>
                            <div style={{ marginTop:7 }}>
                              {acked
                                ? <span style={{ fontSize:10.5, fontWeight:700, color:"#16a34a" }}>
                                    ✓ Responded in {fmtClock((new Date(ev.acknowledged_at) - new Date(ev.started_at)) / 1000)}
                                  </span>
                                : <span style={{ fontSize:10.5, fontWeight:700, color:"#b45309" }}>● Waiting for response…</span>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </>
          )}
          {tab === "reports" && (
            <div className="an-panel"><div className="big">📊</div><h2>Reports</h2>
              <p>Filter ANDON history by date · zone · line · department · ESP → export Excel / PDF. <b>Phase 4</b>.</p></div>
          )}
        </div>
      </div>
      {msg && <div className="an-msg">{msg}</div>}

      {/* Takraav ka popup — IP/naam pehle se kisi aur ESP ki hai.
          Jaan-bujh kar khud gayab NAHI hota: user ko padhna aur samajhna
          zaroori hai, warna do board ka data ek hi line par chadh jayega. */}
      {alertBox && (
        <div onClick={() => setAlertBox(null)}
             style={{ position:"fixed", inset:0, background:"rgba(15,23,42,.55)",
                      display:"flex", alignItems:"center", justifyContent:"center",
                      zIndex:10000, padding:20 }}>
          <div onClick={(e) => e.stopPropagation()}
               style={{ background:"#fff", borderRadius:14, maxWidth:520, width:"100%",
                        boxShadow:"0 24px 60px rgba(0,0,0,.35)", overflow:"hidden" }}>
            <div style={{ background:"linear-gradient(135deg,#dc2626,#b91c1c)", color:"#fff",
                          padding:"14px 20px", display:"flex", alignItems:"center", gap:12 }}>
              <span style={{ fontSize:24 }}>⚠️</span>
              <div style={{ fontSize:16, fontWeight:800 }}>{alertBox.title}</div>
            </div>
            <div style={{ padding:"18px 20px", fontSize:13.5, lineHeight:1.65, color:"#0f172a" }}>
              {alertBox.text}
              <div style={{ marginTop:14, padding:"10px 12px", background:"#fef2f2",
                            border:"1px solid #fecaca", borderRadius:9,
                            fontSize:12.5, color:"#991b1b" }}>
                Ek IP sirf EK hi ESP ko de sakte hain. Do board ek hi IP par hon to
                dono ka data ek hi line par chala jayega aur pata bhi nahi chalega.
              </div>
            </div>
            <div style={{ padding:"0 20px 18px", textAlign:"right" }}>
              <button onClick={() => setAlertBox(null)}
                      style={{ border:"none", background:"#dc2626", color:"#fff",
                               borderRadius:9, padding:"9px 22px", fontSize:13,
                               fontWeight:800, cursor:"pointer", fontFamily:"inherit" }}>
                Samajh gaya
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
