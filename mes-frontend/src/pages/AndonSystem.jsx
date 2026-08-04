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
    if (!r.ok) throw new Error((await r.text().catch(() => "")) || `HTTP ${r.status}`);
    return r.status === 204 ? null : r.json();
  }, [token]);

  const [tab, setTab] = useState("config");
  const [cfg, setCfg] = useState("esp");            // esp | outputs
  const [msg, setMsg] = useState("");
  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(""), 2500); };

  const [master, setMaster]   = useState([]);       // flat mes_machines rows (zone_name/line_name/machine_no/machine_name)
  const [depts, setDepts]     = useState([]);
  const [esps, setEsps]       = useState([]);

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
  const wrap = async (fn, ok) => { try { await fn(); await load(); if (ok) flash(ok); } catch (e) { flash(String(e.message || e).slice(0, 140)); } };

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
    setOutRows((rs) => rs.map((r, j) => (j === i ? { ...r, department_id: deptId, display_name: d ? `${d.name} Call` : "" } : r)));
  };
  const addOutput = () => {
    if (outRows.length >= 8) { flash("Max 8 outputs (ESP has DO1–DO8)"); return; }
    const usedDo = new Set(outRows.map((r) => r.do_index));
    let nd = 1; while (usedDo.has(nd) && nd < 8) nd++;
    const used = new Set(outRows.map((r) => r.department_id).filter(Boolean));
    const free = depts.find((d) => !used.has(d.id));
    setOutRows((rs) => [...rs, { do_index: nd, department_id: free?.id || null,
      display_name: free ? `${free.name} Call` : "", priority: "Normal", enabled: true }]);
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
                    <div className="an-row" style={{ marginBottom:12 }}>
                      <b style={{ fontSize:14 }}>Output Mapping — {outFor.name}</b>
                      <div style={{ marginLeft:"auto", display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
                        <select className="an-in sm" value={outZone} onChange={(e) => pickOutTarget(e.target.value, "")}>
                          <option value="">Default template (all ESPs)</option>
                          {espZones.map((z) => <option key={z} value={z}>{z}</option>)}
                        </select>
                        {outZone && (
                          <select className="an-in sm" value={outLine} onChange={(e) => pickOutTarget(outZone, e.target.value)}>
                            <option value="">— select line —</option>
                            {outLinesFor(outZone).map((l) => <option key={l} value={l}>{l}</option>)}
                          </select>
                        )}
                        <button className="an-btn" onClick={saveOutputs} disabled={outFor.type === "none" || outFor.type === "pick"}>Save mapping</button>
                      </div>
                    </div>
                    {outFor.type === "pick" ? (
                      <div style={{ color:"#94a3b8", fontSize:13, padding:"18px 4px" }}>Select a <b>line</b> to map that ESP's outputs.</div>
                    ) : outFor.type === "none" ? (
                      <div style={{ color:"#b45309", fontSize:13, padding:"18px 4px" }}>No ESP is configured on <b>{outZone} / {outLine}</b>. Add one in <b>ESP Devices</b> first.</div>
                    ) : (
                    <>
                    <table className="an-tbl">
                      <thead><tr><th style={{ width:90 }}>Output</th><th>Department</th><th style={{ width:44 }}></th></tr></thead>
                      <tbody>
                        {outRows.map((r, i) => {
                          const used = deptUsedElsewhere(i);
                          return (
                            <tr key={r.do_index}>
                              <td style={{ fontWeight:800 }}>OUT{r.do_index}</td>
                              <td>
                                <select className="an-in" style={{ width:"100%", maxWidth:340 }} value={r.department_id || ""}
                                        onChange={(e) => onOutDept(i, e.target.value ? Number(e.target.value) : null)}>
                                  <option value="">— select —</option>
                                  {depts.filter((d) => !used.has(d.id)).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                                </select>
                              </td>
                              <td style={{ textAlign:"center" }}><button className="an-x" title="Remove this output" onClick={() => removeOutput(i)}>×</button></td>
                            </tr>
                          );
                        })}
                        {!outRows.length && <tr><td colSpan={3} style={{ color:"#94a3b8" }}>No outputs — click “+ Add output”.</td></tr>}
                      </tbody>
                    </table>
                    <div className="an-row" style={{ marginTop:12, justifyContent:"space-between" }}>
                      <button className="an-btn gh" onClick={addOutput} disabled={outRows.length >= 8 || outRows.length >= depts.length}>+ Add output</button>
                      <span style={{ fontSize:11.5, color:"#94a3b8" }}>Each department once · up to 8 outputs (ESP DO1–DO8) · default applies to every ESP.</span>
                    </div>
                    </>
                    )}
                  </div>
                </>
              )}
            </>
          )}

          {tab === "board" && (
            <div className="an-panel"><div className="big">📟</div><h2>Live ANDON Board</h2>
              <p>Real-time active calls + running timers, department / zone / line cards, today's downtime — over WebSocket from the ESP-polling engine. <b>Phase 3–4</b> (needs the ESP32 response format).</p></div>
          )}
          {tab === "reports" && (
            <div className="an-panel"><div className="big">📊</div><h2>Reports</h2>
              <p>Filter ANDON history by date · zone · line · department · ESP → export Excel / PDF. <b>Phase 4</b>.</p></div>
          )}
        </div>
      </div>
      {msg && <div className="an-msg">{msg}</div>}
    </>
  );
}
