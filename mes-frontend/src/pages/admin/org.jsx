/* admin/org.jsx — Users · Machines · Cameras · Departments. */
import { useState, useEffect, useRef, useCallback, useMemo, Fragment } from "react";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../api/client";
import {
  PageHeading, Card, Pill, Btn, FF, Input, Select,
  Modal, ModalActions, Toast, EmptyState, Spinner, ExcelImportButton,
  inputStyle,
} from "./ui";
import { PAGE_PERM_GROUPS, PERM_LEVELS, ROLE_PILL } from "./pokayoke";

export function UsersPage({ toast, readOnly = false }) {
  const { token } = useAuth();
  const [users,       setUsers]       = useState([]);
  const [lines,       setLines]       = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [modal,       setModal]       = useState(false);
  const [assignModal, setAssignModal] = useState(null);
  const [form,        setForm]        = useState({
    username:"", password:"", role:"production", department_id:"",
  });
  const [saving,      setSaving]      = useState(false);
  const [selLines,    setSelLines]    = useState([]);

  // Permission matrix state — opened when admin clicks "Permissions"
  // on a user row.  permModal=null means closed; otherwise it holds
  // the user being edited.  permMap is { page_key: 'none'|'read'|'full' }.
  const [permModal,  setPermModal]  = useState(null);
  const [permMap,    setPermMap]    = useState({});
  const [permLoading,setPermLoading]= useState(false);
  const [permSaving, setPermSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [u,l,d] = await Promise.all([
        api.get("/api/users/", token),
        api.get("/api/lines/", token),
        api.get("/api/departments/", token),
      ]);
      setUsers(Array.isArray(u)?u:[]);
      setLines(Array.isArray(l)?l:[]);
      setDepartments(Array.isArray(d)?d:[]);
    } catch { toast("Failed to load","err"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const createUser = async () => {
    if (!form.username||!form.password) { toast("Username and password required","err"); return; }
    if (form.role === "department" && !form.department_id) {
      toast("Pick a department for this user","err"); return;
    }
    setSaving(true);
    try {
      const body = {
        username: form.username,
        password: form.password,
        role:     form.role,
        department_id: form.role === "department" ? Number(form.department_id) : null,
      };
      await api.post("/api/users/", body, token);
      toast("User created ✓");
      setModal(false);
      setForm({ username:"", password:"", role:"production", department_id:"" });
      load();
    }
    catch(e) { toast(e.message,"err"); }
    finally { setSaving(false); }
  };

  const deleteUser = async (u) => {
    if (!confirm(`Delete user "${u.username}"?`)) return;
    try { await api.delete(`/api/users/${u.id}`, token); toast("User deleted"); load(); }
    catch(e) { toast(e.message,"err"); }
  };

  const patchUser = async (u, patch) => {
    try { await api.put(`/api/users/${u.id}/role`, patch, token); toast("Updated ✓"); load(); }
    catch(e) { toast(e.message,"err"); }
  };

  const changeRole = (u, role) => {
    // Switching to 'department' needs a dept_id — pick the first available one
    // as a sensible default; admin can change immediately via the dept dropdown.
    if (role === "department") {
      if (!departments.length) {
        toast("Add a department first (Admin → Departments)","err"); return;
      }
      patchUser(u, { role, department_id: departments[0].id });
    } else {
      patchUser(u, { role });
    }
  };
  const changeDept = (u, dept_id) => {
    patchUser(u, { department_id: dept_id ? Number(dept_id) : null });
  };

  const openAssign = async (u) => {
    const assigned = await api.get(`/api/users/${u.id}/lines`, token).catch(()=>[]);
    setSelLines(Array.isArray(assigned)?assigned:[]);
    setAssignModal(u);
  };

  const saveAssign = async () => {
    if (!assignModal) return;
    setSaving(true);
    try { await api.put(`/api/users/${assignModal.id}/lines`, selLines, token); toast("Lines assigned ✓"); setAssignModal(null); }
    catch(e) { toast(e.message,"err"); }
    finally { setSaving(false); }
  };

  const toggleLine = (id) => setSelLines(p=>p.includes(id)?p.filter(x=>x!==id):[...p,id]);

  // ── Permission matrix handlers ──
  const openPerms = async (u) => {
    setPermModal(u);
    setPermLoading(true);
    setPermMap({});
    try {
      const rows = await api.get(`/api/users/${u.id}/permissions`, token);
      const m = {};
      for (const r of (Array.isArray(rows) ? rows : [])) {
        m[r.page_key] = r.perm_level;
      }
      setPermMap(m);
    } catch { toast?.("Failed to load permissions","err"); }
    finally   { setPermLoading(false); }
  };

  const setPerm = (page_key, level) => {
    setPermMap(p => ({ ...p, [page_key]: level }));
  };

  const setAllInGroup = (groupItems, level) => {
    setPermMap(p => {
      const n = { ...p };
      for (const it of groupItems) n[it.key] = level;
      return n;
    });
  };

  const savePerms = async () => {
    if (!permModal) return;
    setPermSaving(true);
    try {
      const payload = {
        permissions: Object.entries(permMap).map(([page_key, perm_level]) => ({
          page_key, perm_level,
        })),
      };
      await api.put(`/api/users/${permModal.id}/permissions`, payload, token);
      toast?.("Permissions saved ✓");
      setPermModal(null);
    } catch (e) { toast?.(e.message || "Save failed", "err"); }
    finally   { setPermSaving(false); }
  };

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:20 }}>
        <Btn variant="primary" onClick={()=>setModal(true)}>+ Add User</Btn>
      </div>
      <Card>
        {loading ? <Spinner /> : users.length===0 ? <EmptyState text="No users" /> : (
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
            <thead>
              <tr>{["ID","Username","Role","Department","Last Login","Actions"].map(h=>(
                <th key={h} style={{ padding:"10px 14px", textAlign:"left", fontSize:10, fontWeight:700, letterSpacing:".08em", textTransform:"uppercase", color:"#64748b", borderBottom:"2px solid #e2e8f0" }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {users.map(u=>{
                const rp = ROLE_PILL[u.role] || {};
                return (
                <tr key={u.id} style={{ borderBottom:"1px solid #f1f5f9" }}>
                  <td style={{ padding:"12px 14px", fontFamily:"monospace", color:"#64748b" }}>{u.id}</td>
                  <td style={{ padding:"12px 14px", fontWeight:600, color:"#0f172a" }}>{u.username}</td>
                  <td style={{ padding:"12px 14px" }}>
                    {u.username==="admin"
                      ? <span style={{ padding:"3px 9px", borderRadius:99, fontSize:10, fontWeight:700, background:rp.bg||"#f1f5f9", color:rp.fg||"#475569", textTransform:"uppercase", letterSpacing:".05em" }}>admin</span>
                      : (
                        <select value={u.role} onChange={e=>changeRole(u,e.target.value)}
                                style={{ ...inputStyle, padding:"4px 8px", fontSize:12, width:"auto",
                                         ...(rp.bg ? { background: rp.bg, color: rp.fg, fontWeight:700 } : {}) }}>
                          <option value="admin">Admin</option>
                          <option value="plant_head">Plant Head</option>
                          <option value="department">Department</option>
                          <option value="production">Production</option>
                          <option value="operator">Operator</option>
                        </select>
                      )
                    }
                  </td>
                  <td style={{ padding:"12px 14px" }}>
                    {u.role === "department" ? (
                      <select value={u.department_id || ""}
                              onChange={e => changeDept(u, e.target.value)}
                              style={{ ...inputStyle, padding:"4px 8px", fontSize:11, width:"auto" }}>
                        <option value="" disabled>— pick —</option>
                        {departments.map(d => (
                          <option key={d.id} value={d.id}>{d.name}</option>
                        ))}
                      </select>
                    ) : (
                      <span style={{ color:"#cbd5e1" }}>—</span>
                    )}
                  </td>
                  <td style={{ padding:"12px 14px", fontFamily:"monospace", fontSize:11, color:"#64748b" }}>{u.last_login?new Date(u.last_login).toLocaleString("en-IN"):"Never"}</td>
                  <td style={{ padding:"12px 14px" }}>
                    <div style={{ display:"flex", gap:8 }}>
                      {u.role==="operator" && <Btn size="sm" onClick={()=>openAssign(u)}>Assign Lines</Btn>}
                      {u.username!=="admin" && <Btn size="sm" onClick={()=>openPerms(u)}>Permissions</Btn>}
                      {u.username!=="admin" && <Btn size="sm" variant="danger" onClick={()=>deleteUser(u)}>Delete</Btn>}
                    </div>
                  </td>
                </tr>
              );})}
            </tbody>
          </table>
        )}
      </Card>

      <Modal open={modal} onClose={()=>setModal(false)} title="Add User">
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
          <FF label="Username *"><Input value={form.username} onChange={e=>setForm(f=>({...f,username:e.target.value}))} placeholder="login id"/></FF>
          <FF label="Password *"><Input type="password" value={form.password} onChange={e=>setForm(f=>({...f,password:e.target.value}))} placeholder="password"/></FF>
          <FF label="Role *">
            <Select value={form.role} onChange={e=>setForm(f=>({...f,role:e.target.value, department_id:""}))}>
              <option value="production">Production</option>
              <option value="operator">Operator</option>
              <option value="department">Department</option>
              <option value="plant_head">Plant Head (admin-equivalent)</option>
              <option value="admin">Admin</option>
            </Select>
          </FF>
          {form.role === "department" && (
            <FF label="Department *" hint="Maintenance / Quality / etc.  Manage from Admin → Departments.">
              <Select value={form.department_id}
                      onChange={e=>setForm(f=>({...f,department_id:e.target.value}))}>
                <option value="">— pick a department —</option>
                {departments.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </Select>
            </FF>
          )}
        </div>
        <ModalActions>
          <Btn onClick={()=>setModal(false)}>Cancel</Btn>
          <Btn variant="primary" onClick={createUser} disabled={saving}>{saving?"Creating…":"Create User"}</Btn>
        </ModalActions>
      </Modal>

      {/* ── PERMISSION MATRIX MODAL ──────────────────────────────────
          Per-user, per-page access control.  Each row in the matrix
          is one page; admin picks None / Read-only / Full CRUD.
          Pages absent from the saved set fall back to role defaults. */}
      <Modal open={!!permModal} onClose={()=>setPermModal(null)}
              title={`Page Permissions — ${permModal?.username || ""}`} wide>
        <div style={{ fontSize:12, color:"#475569", marginBottom:14, lineHeight:1.5 }}>
          Choose which pages this user can see and the level of access for
          each.  <b>None</b> hides the page entirely; <b>Read-only</b>
          shows it but blocks Save / Edit / Delete buttons; <b>Full CRUD</b>
          gives complete access.  Pages left untouched fall back to the
          user's role defaults.
        </div>

        {permLoading ? <Spinner/> : (
          <div style={{ maxHeight:"60vh", overflowY:"auto" }}>
            {PAGE_PERM_GROUPS.map(g => (
              <div key={g.group} style={{ marginBottom:18 }}>
                <div style={{
                  display:"flex", justifyContent:"space-between", alignItems:"center",
                  padding:"6px 0", marginBottom:6,
                  borderBottom:"2px solid #e2e8f0",
                }}>
                  <div style={{ fontSize:11, fontWeight:800, letterSpacing:".08em",
                                  textTransform:"uppercase", color:"#0f172a" }}>
                    {g.group}
                  </div>
                  <div style={{ display:"flex", gap:6 }}>
                    {PERM_LEVELS.map(p => (
                      <button key={p.key}
                              onClick={() => setAllInGroup(g.items, p.key)}
                              style={{
                                fontSize:9, fontWeight:700, padding:"3px 9px",
                                borderRadius:99, border:"none",
                                background:p.bg, color:p.color, cursor:"pointer",
                              }}
                              title={`Set all ${g.group} pages to ${p.label}`}>
                        ALL → {p.label}
                      </button>
                    ))}
                  </div>
                </div>
                {g.items.map(it => {
                  const cur = permMap[it.key] || "none";
                  return (
                    <div key={it.key} style={{
                      display:"grid",
                      gridTemplateColumns:"1fr auto auto auto",
                      gap:8, alignItems:"center",
                      padding:"6px 0",
                      borderBottom:"1px solid #f1f5f9",
                    }}>
                      <div>
                        <div style={{ fontSize:13, fontWeight:600, color:"#0f172a" }}>
                          {it.label}
                        </div>
                        <div style={{ fontSize:10, color:"#94a3b8",
                                       fontFamily:"monospace" }}>
                          {it.key}
                        </div>
                      </div>
                      {PERM_LEVELS.map(p => {
                        const sel = cur === p.key;
                        return (
                          <button key={p.key}
                                  onClick={() => setPerm(it.key, p.key)}
                                  style={{
                                    padding:"5px 12px", borderRadius:7, fontSize:11,
                                    fontWeight:700, cursor:"pointer",
                                    border: sel ? `2px solid ${p.color}` : "1.5px solid #e2e8f0",
                                    background: sel ? p.bg : "#fff",
                                    color:      sel ? p.color : "#94a3b8",
                                    minWidth: 90,
                                  }}>
                            {p.label}
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}

        <ModalActions>
          <Btn onClick={()=>setPermModal(null)}>Cancel</Btn>
          <Btn variant="primary" onClick={savePerms} disabled={permSaving}>
            {permSaving ? "Saving…" : "Save Permissions"}
          </Btn>
        </ModalActions>
      </Modal>

      <Modal open={!!assignModal} onClose={()=>setAssignModal(null)} title={`Assign Lines — ${assignModal?.username}`} wide>
        <p style={{ fontSize:13, color:"#64748b", marginBottom:16 }}>Select which lines this operator can access.</p>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))", gap:10, maxHeight:300, overflowY:"auto" }}>
          {lines.map(l=>{
            const checked = selLines.includes(l.id);
            return (
              <label key={l.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px", borderRadius:8, cursor:"pointer", background:checked?"rgba(30,64,175,.06)":"#f8fafc", border:`1px solid ${checked?"rgba(30,64,175,.25)":"#e2e8f0"}`, transition:"all .12s" }}>
                <input type="checkbox" checked={checked} onChange={()=>toggleLine(l.id)} style={{ width:15, height:15, accentColor:"#1e40af" }}/>
                <div>
                  <div style={{ fontSize:13, fontWeight:600, color:"#0f172a" }}>{l.line_name}</div>
                  <div style={{ fontSize:10, color:"#94a3b8" }}>{l.line_code}</div>
                </div>
              </label>
            );
          })}
        </div>
        <ModalActions>
          <Btn onClick={()=>setAssignModal(null)}>Cancel</Btn>
          <Btn variant="primary" onClick={saveAssign} disabled={saving}>{saving?"Saving…":"Save Assignments"}</Btn>
        </ModalActions>
      </Modal>
    </div>
  );
}

// ─── MACHINES PAGE ────────────────────────────────────────────
// parent_plc_id = null  → MAIN PLC (one per line, drives Dashboard tile + collector)
// parent_plc_id = <id>  → SUB-MACHINE (auxiliary, listed under main on Dashboard)
// nf2_camera_id        → bound NF2/CMS camera id (copy from NF2 Camera Master)
// machine_seq          → admin-chosen display number (M-1, M-2, …) shown
//                        as the big badge on Dashboard sub-machine tiles.
const BLANK_MACHINE_PLC = { machine_name:"", plc_ip:"", plc_port:5002, protocol:"MC4E", ok_bit_address:"L108", ng_bit_address:"L109", status_address:"D6005", model_address:"D6048", sensor_ok_address:"", process_seq_address:"", override_address:"", ideal_cycle_time:15.0, max_allowed_cycle:16.0, ok_ng_pulse_min_gap:0.5, parent_plc_id:null, nf2_camera_id:"", machine_seq:null,
  // 2026-05-29 - Count mode (Final Inspection main PLC only).
  // 'bit' = legacy L108/L109 rising-edge counting.
  // 'register' = poll D-register value, increment = +N OK/NG.
  count_mode:"bit", ok_data_register:"", ng_data_register:"", shift_reset_bit:"",
  // Semi-Auto data capture (sub-machine only, optional)
  sa_enabled:false, sa_fetch_bit:"", sa_part_code_addr:"", sa_part_code_len:null,
  sa_data_addr:"", sa_data_len:null, sa_time_addr:"", sa_time_len:null,
  sa_register_names:[], sa_register_scales:[],
  // Bottleneck marker — surfaces a badge on Dashboard tile + Submachine fullscreen.
  is_bottleneck:false };
 
export function MachinesPage({ toast, readOnly = false }) {
  const { token } = useAuth();
  const [subPage,   setSubPage]   = useState(0);
 
  // Cascade selects
  const [zones,    setZones]    = useState([]);
  const [lines,    setLines]    = useState([]);
  const [machines, setMachines] = useState([]);
  const [selZone,  setSelZone]  = useState("");
  const [selLine,  setSelLine]  = useState("");
  const [selMach,  setSelMach]  = useState(null);
 
  // PLC form
  const [plcForm,  setPlcForm]  = useState({ ...BLANK_MACHINE_PLC });
  const [saving,   setSaving]   = useState(false);
 
  // Status mappings (kept for potential future re-use)
  const [statuses, setStatuses]  = useState([]);
 
  // Bit addresses modal
  const [bitModal, setBitModal] = useState(false);
 
  // ── NEW: Monitor Config state ──────────────────────────────
  const [monCfg,        setMonCfg]        = useState(null);
  const [monLoading,    setMonLoading]    = useState(false);
  const [monSaving,     setMonSaving]     = useState(false);
  const [pollingBit,    setPollingBit]    = useState("");
  const [hasDataRegs,   setHasDataRegs]   = useState(false);
  const [dataRegs,      setDataRegs]      = useState([]);   // [{register, label, desired_value}]
  const [hasLoadcell,   setHasLoadcell]   = useState(false);
  const [loadcellRegs,  setLoadcellRegs]  = useState([]);   // [{register, label, min_value, max_value}]

  // ── NEW: Process Config state (sub-page 3) ─────────────────
  // Each machine can have N processes; admin sets per-process
  // process_no / process_name / target_value / actual_register.
  // The frontend turns this into bar graphs with a target line on
  // the per-machine Process Graphs page.
  const [procRows,      setProcRows]      = useState([]);   // [{process_no, process_name, target_value, actual_register, register_type, is_active}]
  const [procLoading,   setProcLoading]   = useState(false);
  const [procSaving,    setProcSaving]    = useState(false);

  const loadProcessConfig = useCallback(async (machineId) => {
    if (!machineId) return;
    setProcLoading(true);
    try {
      const r = await api.get(`/api/machines/${machineId}/processes`, token);
      const arr = Array.isArray(r) ? r : [];
      // Normalise field names from snake_case → component shape
      setProcRows(arr.map(p => ({
        process_no:      p.process_no,
        process_name:    p.process_name || "",
        target_value:    Number(p.target_value || 0),
        actual_register: p.actual_register || "",
        register_type:   p.register_type   || "word",
        is_active:       p.is_active !== false,
        latest_value:    p.latest_value,    // read-only display
        latest_at:       p.latest_at,
      })));
    } catch {
      setProcRows([]);
    } finally {
      setProcLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (subPage === 3 && selMach) loadProcessConfig(selMach.id);
  }, [subPage, selMach, loadProcessConfig]);

  const saveProcessConfig = async () => {
    if (!selMach) return toast?.("Select a machine first", "err");
    // Sanity check: every row needs at least process_name + actual_register
    for (const p of procRows) {
      if (!p.process_name?.trim()) {
        return toast?.("Every process needs a name", "err");
      }
      if (!p.actual_register?.trim()) {
        return toast?.(`Process "${p.process_name}" needs an actual-value PLC register`, "err");
      }
    }
    setProcSaving(true);
    try {
      await api.put(`/api/machines/${selMach.id}/processes`,
                     { processes: procRows.map((p, i) => ({
                         process_no:      p.process_no || (i + 1),
                         process_name:    p.process_name.trim(),
                         target_value:    Number(p.target_value || 0),
                         actual_register: p.actual_register.trim().toUpperCase(),
                         register_type:   p.register_type || "word",
                         is_active:       p.is_active !== false,
                       })) },
                     token);
      toast?.("Process config saved ✓");
      await loadProcessConfig(selMach.id);
      try { window.dispatchEvent(new CustomEvent("ap-config-changed")); } catch {}
    } catch (e) { toast?.(e.message || "Save failed", "err"); }
    finally { setProcSaving(false); }
  };
 
  useEffect(() => {
    api.get("/api/zones/", token).then(r => setZones(Array.isArray(r) ? r : [])).catch(()=>{});
  }, [token]);
 
  const [allLines, setAllLines] = useState([]);
  useEffect(() => {
    api.get("/api/lines/", token).then(r => setAllLines(Array.isArray(r) ? r : [])).catch(()=>{});
  }, [token]);
 
  useEffect(() => {
    if (!selZone) { setLines(allLines); setSelLine(""); setMachines([]); setSelMach(null); return; }
    setLines(allLines.filter(l => String(l.zone_id) === String(selZone)));
    setSelLine(""); setMachines([]); setSelMach(null);
  }, [selZone, allLines]);
 
  useEffect(() => {
    if (!selLine) { setMachines([]); setSelMach(null); return; }
    api.get(`/api/lines/${selLine}/machines`, token)
      .then(r => setMachines(Array.isArray(r) ? r : []))
      .catch(()=>{});
    setSelMach(null);
  }, [selLine, token]);
 
  const loadStatuses = () => {
    if (!selLine) return;
    api.get(`/api/config/status/${selLine}`, token)
      .then(r => setStatuses(Array.isArray(r) ? r : [])).catch(()=>{});
  };
 
  // ── NEW: load monitor config when machine selected & tab is open ──
  const loadMonitorConfig = useCallback(async (machineId) => {
    if (!selLine || !machineId) return;
    setMonLoading(true);
    try {
      const r = await api.get(`/api/lines/${selLine}/machines/${machineId}/monitor-config`, token);
      setMonCfg(r);
      setPollingBit(r.polling_bit || "");
      setHasDataRegs(r.has_data_registers || false);
      setDataRegs(r.data_registers || []);
      setHasLoadcell(r.has_loadcell || false);
      setLoadcellRegs(r.loadcell_registers || []);
    } catch {
      setMonCfg(null);
      setPollingBit(""); setHasDataRegs(false); setDataRegs([]);
      setHasLoadcell(false); setLoadcellRegs([]);
    } finally {
      setMonLoading(false);
    }
  }, [selLine, token]);
 
  useEffect(() => {
    if (subPage === 2 && selMach) loadMonitorConfig(selMach.id);
  }, [subPage, selMach, loadMonitorConfig]);
 
  // ── NEW: save monitor config ───────────────────────────────
  const saveMonitorConfig = async () => {
    if (!selLine || !selMach) return toast("Select a machine first", "err");
    if (!pollingBit.trim()) return toast("Polling bit is required (e.g. M99)", "err");
    setMonSaving(true);
    try {
      await api.put(
        `/api/lines/${selLine}/machines/${selMach.id}/monitor-config`,
        {
          plc_id:             selMach.id,
          polling_bit:        pollingBit.trim().toUpperCase(),
          has_data_registers: hasDataRegs,
          data_registers:     hasDataRegs ? dataRegs.filter(r => r.register) : [],
          has_loadcell:       hasLoadcell,
          loadcell_registers: hasLoadcell ? loadcellRegs.filter(r => r.register) : [],
        },
        token
      );
      toast("Monitor config saved ✓");
      await loadMonitorConfig(selMach.id); // refresh
    } catch (e) { toast(e.message || "Save failed", "err"); }
    finally { setMonSaving(false); }
  };
 
  const deleteMonitorConfig = async () => {
    if (!window.confirm("Remove all monitor config for this machine?")) return;
    try {
      await api.delete(`/api/lines/${selLine}/machines/${selMach.id}/monitor-config`, token);
      toast("Monitor config removed");
      setMonCfg(null); setPollingBit(""); setHasDataRegs(false);
      setDataRegs([]); setHasLoadcell(false); setLoadcellRegs([]);
    } catch (e) { toast(e.message, "err"); }
  };
 
  // ── NEW: row helpers ───────────────────────────────────────
  const addDataReg    = () => setDataRegs(p => [...p, { register:"", label:"", desired_value:"" }]);
  const removeDataReg = (i) => setDataRegs(p => p.filter((_,idx) => idx !== i));
  const setDataReg    = (i, field, val) => setDataRegs(p => p.map((r,idx) => idx===i ? {...r,[field]:val} : r));
 
  const addLoadcell    = () => setLoadcellRegs(p => [...p, { register:"", label:"", min_value:"", max_value:"" }]);
  const removeLoadcell = (i) => setLoadcellRegs(p => p.filter((_,idx) => idx !== i));
  const setLoadcell    = (i, field, val) => setLoadcellRegs(p => p.map((r,idx) => idx===i ? {...r,[field]:val} : r));
 
  // ── Existing helpers (unchanged) ──────────────────────────
  const selectMachine = (m) => {
    setSelMach(m);
    setPlcForm({
      machine_name: m.machine_name || "",
      plc_ip: m.plc_ip || "",
      plc_port: m.plc_port || 5002,
      protocol: m.protocol || "MC4E",
      ok_bit_address: m.ok_bit_address || "L108",
      ng_bit_address: m.ng_bit_address || "L109",
      status_address: m.status_address || "D6005",
      model_address: m.model_address || "D6048",
      sensor_ok_address: m.sensor_ok_address || "",
      process_seq_address: m.process_seq_address || "",
      override_address: m.override_address || "",
      ideal_cycle_time: m.ideal_cycle_time || 15.0,
      max_allowed_cycle: m.max_allowed_cycle || 16.0,
      ok_ng_pulse_min_gap: m.ok_ng_pulse_min_gap || 0.5,
      // Planned takt time — lives on mes_lines (per-line, customer-demand rhythm),
      // not on the PLC row.  Surfaced in this form for editing convenience when
      // admin is configuring the line's main PLC.  Loaded asynchronously below.
      planned_takt_time: null,
      // Energy per part — also lives on mes_lines.  Static admin entry
      // (kWh/part), surfaced on the Fullscreen Production card.
      energy_per_part:   null,
      // Sub-machine wiring — keep null/empty for main PLCs.
      parent_plc_id: m.parent_plc_id ?? null,
      nf2_camera_id: m.nf2_camera_id || "",
      // Display sequence (M-1, M-2 …) for Dashboard tiles.
      machine_seq:   m.machine_seq ?? null,
      // Semi-Auto data capture (sub-machine only)
      sa_enabled:        !!m.sa_enabled,
      sa_fetch_bit:      m.sa_fetch_bit || "",
      sa_part_code_addr: m.sa_part_code_addr || "",
      sa_part_code_len:  m.sa_part_code_len ?? null,
      sa_data_addr:      m.sa_data_addr || "",
      sa_data_len:       m.sa_data_len ?? null,
      sa_time_addr:      m.sa_time_addr || "",
      sa_time_len:       m.sa_time_len ?? null,
      sa_register_names: Array.isArray(m.sa_register_names) ? m.sa_register_names : [],
      sa_register_scales: Array.isArray(m.sa_register_scales) ? m.sa_register_scales : [],
      // Bottleneck flag
      is_bottleneck:     !!m.is_bottleneck,
      // 2026-05-30 — Register-mirror counting.  MUST load the saved values
      // here: without them the form rebuilds with count_mode undefined →
      // shows "Bit edge" on a register machine, and Save then PUTs no
      // count_mode (defaults to bit) + NULL registers, silently wiping the
      // register config.  Loading them = zero regression on edit.
      count_mode:       m.count_mode || "bit",
      ok_data_register: m.ok_data_register || "",
      ng_data_register: m.ng_data_register || "",
      shift_reset_bit:  m.shift_reset_bit || "",
    });
    // Fetch the line-level planned takt time so the form can display
    // (and edit) it inline with the other PLC fields.
    if (selLine) {
      api.get(`/api/lines/${selLine}/planning`, token)
        .then(r => {
          const pt  = r?.planned_takt;
          const epp = r?.energy_per_part;
          setPlcForm(f => ({
            ...f,
            planned_takt_time: pt  != null ? Number(pt)  : null,
            energy_per_part:   epp != null ? Number(epp) : null,
          }));
        })
        .catch(() => {});
    }
  };
 
  const savePLC = async () => {
    if (!selLine) return toast("Select a line first", "err");
    setSaving(true);
    try {
      // planned_takt_time + energy_per_part live on mes_lines, not on
      // mes_plc_configs.  Strip both from the machine payload so the
      // PLC PUT doesn't reject them as unknown columns, then push them
      // to the line in a follow-up call.
      const { planned_takt_time, energy_per_part, ...plcPayload } = plcForm;
      if (selMach) {
        await api.put(`/api/lines/${selLine}/machines/${selMach.id}`, plcPayload, token);
        toast("Machine PLC config updated ✓");
      } else {
        if (!plcForm.plc_ip) return toast("IP address required", "err");
        await api.post(`/api/lines/${selLine}/machines`, plcPayload, token);
        toast("Machine added ✓");
        setPlcForm({ ...BLANK_MACHINE_PLC });
      }
      // Persist line-level planned takt + energy/part in ONE /planning
      // PUT so the line stays in sync with both fields together.
      const hasTakt   = planned_takt_time != null && Number(planned_takt_time) > 0;
      const hasEnergy = energy_per_part   != null && Number(energy_per_part)   >= 0;
      if (hasTakt || hasEnergy) {
        try {
          const payload = {
            ideal_ct:     Number(plcForm.ideal_cycle_time) || 15.0,
            recalculate:  false,
          };
          if (hasTakt)   payload.planned_takt    = Number(planned_takt_time);
          if (hasEnergy) payload.energy_per_part = Number(energy_per_part);
          await api.put(`/api/lines/${selLine}/planning`, payload, token);
        } catch (e) {
          toast(`Line-level save failed: ${e.message}`, "err");
        }
      }
      const r = await api.get(`/api/lines/${selLine}/machines`, token);
      setMachines(Array.isArray(r) ? r : []);
      setSelMach(null);
    } catch (e) { toast(e.message, "err"); }
    finally { setSaving(false); }
  };
 
  const deleteMachine = async (m) => {
    if (!window.confirm(`Delete machine "${m.machine_name || m.plc_ip}"?`)) return;
    try {
      await api.delete(`/api/lines/${selLine}/machines/${m.id}`, token);
      toast("Machine deleted");
      const r = await api.get(`/api/lines/${selLine}/machines`, token);
      setMachines(Array.isArray(r) ? r : []);
      if (selMach?.id === m.id) { setSelMach(null); setPlcForm({ ...BLANK_MACHINE_PLC }); }
    } catch (e) { toast(e.message, "err"); }
  };
 
  const mini = { ...inputStyle, padding:"8px 10px", fontSize:12 };
  const BIT_FIELDS = [
    { key:"ok_bit_address",      label:"OK Bit Address" },
    { key:"ng_bit_address",      label:"NG Bit Address" },
    { key:"status_address",      label:"Status Address" },
    { key:"model_address",       label:"Model Address" },
    { key:"sensor_ok_address",   label:"Sensor OK Address" },
    { key:"process_seq_address", label:"Process Seq Address" },
    { key:"override_address",    label:"Override Address" },
  ];
 
  return (
    <div>
 
      {/* Cascade selects */}
      <Card style={{ marginBottom:20 }}>
        <div style={{ display:"flex", gap:12, flexWrap:"wrap", alignItems:"flex-end" }}>
          <FF label="Zone">
            <select style={mini} value={selZone} onChange={e=>setSelZone(e.target.value)}>
              <option value="">— Select Zone —</option>
              {zones.map(z=><option key={z.id} value={z.id}>{z.zone_name}</option>)}
            </select>
          </FF>
          <FF label="Line">
            <select style={mini} value={selLine} onChange={e=>setSelLine(e.target.value)} disabled={!selZone}>
              <option value="">— Select Line —</option>
              {lines.map(l=><option key={l.id} value={l.id}>{l.line_name}</option>)}
            </select>
          </FF>
          <FF label="Machine">
            <select style={mini} value={selMach?.id||""} onChange={e=>{ const m=machines.find(m=>m.id===Number(e.target.value)); if(m) selectMachine(m); else { setSelMach(null); setPlcForm({...BLANK_MACHINE_PLC}); }}} disabled={!selLine}>
              <option value="">— New Machine —</option>
              {machines.map(m=><option key={m.id} value={m.id}>{m.machine_name||m.plc_ip}</option>)}
            </select>
          </FF>
        </div>
      </Card>
 
      {/* Sub-page tabs — ④ Process Config added for per-machine
          process target/actual graphs */}
      <div style={{ display:"flex", gap:0, borderBottom:"2px solid #e2e8f0", marginBottom:24 }}>
        {["① Machines","② PLC Config","③ Monitor Config","④ Process Config"].map((label,i)=>(
          <button key={i} onClick={()=>setSubPage(i)}
            style={{ padding:"8px 16px", border:"none", background:"none", fontFamily:"'Barlow',sans-serif",
              fontSize:12, fontWeight:600, cursor:"pointer",
              color:subPage===i?"#1e40af":"#64748b",
              borderBottom:`2px solid ${subPage===i?"#1e40af":"transparent"}`,
              marginBottom:-2, transition:"all .12s" }}>
            {label}
          </button>
        ))}
      </div>
 
      {/* ── Sub-page 0: Machine list (unchanged) ── */}
      {subPage === 0 && (
        <Card>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
            <h3 style={{ fontSize:15, fontWeight:700, color:"#0f172a" }}>
              {selLine ? `Machines on ${lines.find(l=>l.id===Number(selLine))?.line_name||""}` : "Select a line to view machines"}
            </h3>
            {selLine && <Btn variant="primary" size="sm" onClick={()=>{ setSelMach(null); setPlcForm({...BLANK_MACHINE_PLC}); setSubPage(1); }}>+ Add Machine</Btn>}
          </div>
          {machines.length === 0 ? (
            <p style={{ color:"#94a3b8", fontSize:13 }}>{selLine ? "No machines configured for this line." : "Select a zone, then a line to see machines."}</p>
          ) : (
            machines.map(m => (
              <div key={m.id} style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 14px", borderRadius:8, border:"1px solid #e2e8f0", marginBottom:8, background:"#f8fafc" }}>
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:700, fontSize:13, color:"#0f172a", display:"flex", alignItems:"center", gap:8 }}>
                    {m.machine_name || "(unnamed)"}
                    {m.parent_plc_id ? (
                      <span style={{ fontSize:9, fontWeight:700, padding:"2px 6px", borderRadius:4, background:"#dbeafe", color:"#1e40af", letterSpacing:".05em" }}>
                        SUB of #{m.parent_plc_id}
                      </span>
                    ) : (
                      <span style={{ fontSize:9, fontWeight:700, padding:"2px 6px", borderRadius:4, background:"#dcfce7", color:"#15803d", letterSpacing:".05em" }}>
                        MAIN
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize:11, color:"#64748b" }}>{m.plc_ip}:{m.plc_port} · {m.protocol}{m.nf2_camera_id ? ` · cam=${m.nf2_camera_id}` : ""}</div>
                </div>
                <Btn size="sm" onClick={()=>{ selectMachine(m); setSubPage(1); }}>Edit PLC</Btn>
                <Btn size="sm" onClick={()=>{ selectMachine(m); setSubPage(2); }}>Monitor Config</Btn>
                <Btn size="sm" variant="danger" onClick={()=>deleteMachine(m)}>Delete</Btn>
              </div>
            ))
          )}
        </Card>
      )}
 
      {/* ── Sub-page 1: PLC Config (unchanged) ── */}
      {subPage === 1 && (
        <Card>
          <h3 style={{ fontSize:15, fontWeight:700, color:"#0f172a", marginBottom:18 }}>
            {selMach ? `Edit PLC — ${selMach.machine_name||selMach.plc_ip}` : "Add New Machine"}
            {selLine && <span style={{ fontWeight:400, color:"#64748b", fontSize:12, marginLeft:8 }}>for {lines.find(l=>l.id===Number(selLine))?.line_name}</span>}
          </h3>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"10px 16px" }}>
            {[
              { k:"machine_name",      l:"Machine Name",          t:"text" },
              { k:"plc_ip",            l:"PLC IP Address",         t:"text" },
              { k:"plc_port",          l:"PLC Port",               t:"number" },
              { k:"protocol",          l:"Protocol",               t:"text" },
              { k:"ideal_cycle_time",  l:"Ideal Cycle Time (s)",   t:"number" },
              { k:"max_allowed_cycle", l:"Max Allowed Cycle (s)",  t:"number" },
              { k:"ok_ng_pulse_min_gap",l:"OK/NG Min Gap (s)",     t:"number" },
              { k:"planned_takt_time", l:"Planned Takt Time (s)",  t:"number",
                hint:"Customer-demand rhythm (line-level). Saved to the line, not the machine." },
              { k:"energy_per_part",   l:"Energy / Part (kWh)",   t:"number",
                hint:"Static admin entry — shown on Fullscreen Production card. Line-level." },
            ].map(({k,l,t,hint})=>(
              <FF key={k} label={l}>
                <input style={mini} type={t} step={t==="number"?"0.01":undefined}
                       value={plcForm[k] ?? ""}
                       onChange={e=>setPlcForm(f=>({...f,[k]:t==="number"?(e.target.value===""?null:parseFloat(e.target.value)):e.target.value}))}/>
                {hint && <div style={{ fontSize:10, color:"#94a3b8", marginTop:4 }}>{hint}</div>}
              </FF>
            ))}
          </div>
          {/* Bit addresses inline */}
          <div style={{ borderTop:"1px solid #e2e8f0", marginTop:20, paddingTop:20 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
              <h4 style={{ fontSize:13, fontWeight:700, color:"#0f172a", margin:0 }}>Bit / Register Addresses</h4>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"10px 16px" }}>
              {BIT_FIELDS.map(({key,label})=>(
                <FF key={key} label={label}>
                  <input style={mini} type="text" value={plcForm[key]||""} onChange={e=>setPlcForm(f=>({...f,[key]:e.target.value}))}/>
                </FF>
              ))}
            </div>
            {/* 2026-05-30 — OK/NG count mode: bit edge OR D-register mirror.
                Only one logic is active at a time.  Shown for the main PLC
                AND for sub-machines, EXCEPT Semi-Auto machines (sa_enabled),
                which stay bit-only and untouched (operator: "no touch semi
                auto"). */}
            {!plcForm.sa_enabled && (
              <div style={{ marginTop:18, padding:12, borderRadius:6,
                            background:"#f8fafc", border:"1px solid #e2e8f0" }}>
                <div style={{ fontSize:12, fontWeight:700, color:"#0f172a", marginBottom:8 }}>
                  OK / NG Counting Mode <span style={{ fontSize:10, fontWeight:500, color:"#64748b" }}>(except Semi-Auto)</span>
                </div>
                <div style={{ display:"flex", gap:18, marginBottom:10 }}>
                  <label style={{ display:"flex", alignItems:"center", gap:6, fontSize:12, cursor:"pointer" }}>
                    <input type="radio" name="count_mode"
                           checked={(plcForm.count_mode || "bit") === "bit"}
                           onChange={()=>setPlcForm(f=>({...f, count_mode:"bit"}))}/>
                    <span><b>Bit edge</b> — L108 rise = +1 OK, L109 rise = +1 NG</span>
                  </label>
                  <label style={{ display:"flex", alignItems:"center", gap:6, fontSize:12, cursor:"pointer" }}>
                    <input type="radio" name="count_mode"
                           checked={plcForm.count_mode === "register"}
                           onChange={()=>setPlcForm(f=>({...f, count_mode:"register"}))}/>
                    <span><b>Register</b> — poll D-register value, increment = +N OK/NG</span>
                  </label>
                </div>
                {plcForm.count_mode === "register" && (
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"10px 16px" }}>
                    <FF label="OK Data Register">
                      <input style={mini} type="text"
                             placeholder="e.g. D5100"
                             value={plcForm.ok_data_register||""}
                             onChange={e=>setPlcForm(f=>({...f, ok_data_register:e.target.value.trim().toUpperCase()}))}/>
                      <div style={{ fontSize:10, color:"#94a3b8", marginTop:4 }}>
                        Word register holding shift OK count. Value increase → +N OK rows. Resets per shift.
                      </div>
                    </FF>
                    <FF label="NG Data Register">
                      <input style={mini} type="text"
                             placeholder="e.g. D5101"
                             value={plcForm.ng_data_register||""}
                             onChange={e=>setPlcForm(f=>({...f, ng_data_register:e.target.value.trim().toUpperCase()}))}/>
                      <div style={{ fontSize:10, color:"#94a3b8", marginTop:4 }}>
                        Word register holding shift NG count. Same logic, separate from OK.
                      </div>
                    </FF>
                    <div style={{ gridColumn:"1 / -1" }}>
                      <FF label="Shift Reset Bit">
                        <input style={mini} type="text"
                               placeholder="e.g. M5800"
                               value={plcForm.shift_reset_bit||""}
                               onChange={e=>setPlcForm(f=>({...f, shift_reset_bit:e.target.value.trim().toUpperCase()}))}/>
                        <div style={{ fontSize:10, color:"#94a3b8", marginTop:4 }}>
                          Bit that pulses ON (~2s) at shift end. On rising edge the closing OK/NG count is archived first, then the registers reset to 0. Leave blank = no auto-reset.
                        </div>
                      </FF>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          {/* ── Machine Type & Camera (sub-machine wiring) ─────────────
              parent_plc_id NULL → main PLC. Otherwise this row appears as
              a sub-machine tile under that main on the Dashboard. */}
          <div style={{ borderTop:"1px solid #e2e8f0", marginTop:20, paddingTop:20 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
              <h4 style={{ fontSize:13, fontWeight:700, color:"#0f172a", margin:0 }}>Machine Type</h4>
              <span style={{ fontSize:10, color:"#64748b" }}>
                Choose Main PLC for the line's primary station, or Sub-machine for an auxiliary station (M-bit pulse).
              </span>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:"10px 16px" }}>
              <FF label="Type">
                <select style={mini}
                        value={plcForm.parent_plc_id == null ? "" : String(plcForm.parent_plc_id)}
                        onChange={e=>{
                          const v = e.target.value;
                          setPlcForm(f=>({...f, parent_plc_id: v === "" ? null : Number(v)}));
                        }}>
                  <option value="">Main PLC (primary station of this line)</option>
                  {machines
                    .filter(m => !m.parent_plc_id && m.id !== selMach?.id)
                    .map(m => (
                      <option key={m.id} value={m.id}>
                        Sub-machine of: {m.machine_name || m.plc_ip}
                      </option>
                    ))}
                </select>
              </FF>
              <FF label="Machine No. (M-N badge)">
                <input style={mini}
                       type="number"
                       min="1"
                       max="99"
                       value={plcForm.machine_seq == null ? "" : plcForm.machine_seq}
                       placeholder="e.g. 1, 2, 3 …"
                       onChange={e=>{
                         const v = e.target.value;
                         setPlcForm(f=>({...f, machine_seq: v === "" ? null : parseInt(v) || null}));
                       }}/>
                <div style={{ fontSize:10, color:"#94a3b8", marginTop:4 }}>
                  Shown as the big <b>M-{plcForm.machine_seq || "N"}</b> badge on the Dashboard tile. Leave blank to skip.
                </div>
              </FF>
              <FF label="NF2 Camera ID (sub-machine only)">
                <input style={mini}
                       type="text"
                       value={plcForm.nf2_camera_id||""}
                       placeholder="e.g. cam_upper_side_greasing_1776851562"
                       disabled={plcForm.parent_plc_id == null}
                       onChange={e=>setPlcForm(f=>({...f, nf2_camera_id: e.target.value.trim()}))}/>
                <div style={{ fontSize:10, color:"#94a3b8", marginTop:4 }}>
                  Copy from NF2 → Camera Master. Leave blank if no camera bound yet.
                </div>
              </FF>
            </div>
            {/* ── Bottleneck flag — UX marker, no backend logic change ── */}
            <div style={{ marginTop:14, padding:10, borderRadius:6,
                          background: plcForm.is_bottleneck ? "rgba(220,38,38,0.08)" : "#f8fafc",
                          border: `1px solid ${plcForm.is_bottleneck ? "rgba(220,38,38,0.35)" : "#e2e8f0"}` }}>
              <label style={{ display:"flex", alignItems:"center", gap:10, cursor:"pointer" }}>
                <input type="checkbox"
                       checked={!!plcForm.is_bottleneck}
                       onChange={e=>setPlcForm(f=>({...f, is_bottleneck: e.target.checked}))}/>
                <div>
                  <div style={{ fontSize:12, fontWeight:700, color: plcForm.is_bottleneck ? "#b91c1c" : "#0f172a" }}>
                    🚧 Mark as Bottleneck Machine
                  </div>
                  <div style={{ fontSize:10, color:"#64748b", marginTop:2 }}>
                    When enabled, a red <b>BOTTLENECK</b> badge surfaces on this machine's tile in the line Dashboard and on its Sub-machine fullscreen header. Pure UX — no effect on cycle counting or video.
                  </div>
                </div>
              </label>
            </div>
          </div>

          {/* ── Semi-Auto data capture (sub-machine only) ──────────── */}
          {/* Always rendered so the operator never wonders "where did it
              go?" — but the inputs are disabled until Type=Sub-machine
              is picked, with a clear hint why. */}
          {(() => {
            const isSub = plcForm.parent_plc_id != null;
            return (
            <div style={{ marginTop:16, padding:14, borderRadius:8,
                          background: isSub ? "#fefce8" : "#f8fafc",
                          border: `1px solid ${isSub ? "#fde68a" : "#e2e8f0"}`,
                          opacity: isSub ? 1 : 0.7 }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
                <div>
                  <h4 style={{ fontSize:13, fontWeight:700, color:"#0f172a", margin:0 }}>
                    Semi-Auto Data Capture
                    {!isSub && <span style={{
                      marginLeft:8, fontSize:10, fontWeight:700, color:"#64748b",
                      background:"#e2e8f0", padding:"2px 8px", borderRadius:99,
                    }}>SUB-MACHINE ONLY</span>}
                  </h4>
                  <span style={{ fontSize:10, color: isSub ? "#92400e" : "#64748b" }}>
                    {isSub
                      ? <>On each rising edge of <b>Fetching Bit</b>, the collector reads part code + N raw data registers + PLC time and stores one row in <code>mes_submachine_data_log</code>. Video clip still extracts via the normal cycle bit — these are independent paths.</>
                      : <>Select <b>Type → Sub-machine of: …</b> above to enable this section. Semi-Auto pulls part code + N data registers from the PLC on a separate fetch bit, stored per cycle for the Part History search.</>}
                  </span>
                </div>
                <label style={{ display:"flex", alignItems:"center", gap:8,
                                cursor: isSub ? "pointer" : "not-allowed",
                                fontSize:12, fontWeight:700,
                                color: isSub ? "#92400e" : "#94a3b8" }}>
                  <input type="checkbox"
                         disabled={!isSub}
                         checked={!!plcForm.sa_enabled}
                         onChange={e=>setPlcForm(f=>({...f, sa_enabled: e.target.checked}))}/>
                  Enable
                </label>
              </div>

              {isSub && plcForm.sa_enabled && (
                <>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:"10px 16px", marginBottom:12 }}>
                    <FF label="Fetching Bit">
                      <input style={mini} type="text"
                             value={plcForm.sa_fetch_bit||""}
                             placeholder="e.g. M5700"
                             onChange={e=>setPlcForm(f=>({...f, sa_fetch_bit: e.target.value.trim()}))}/>
                      <div style={{ fontSize:10, color:"#94a3b8", marginTop:3 }}>
                        Rising edge here = capture trigger. Can be same as cycle bit or different.
                      </div>
                    </FF>
                    <FF label="Part Code Address">
                      <div style={{ display:"flex", gap:6 }}>
                        <input style={{...mini, flex:2}} type="text"
                               value={plcForm.sa_part_code_addr||""}
                               placeholder="D530"
                               onChange={e=>setPlcForm(f=>({...f, sa_part_code_addr: e.target.value.trim()}))}/>
                        <input style={{...mini, flex:1}} type="number" min="1" max="50"
                               value={plcForm.sa_part_code_len ?? ""}
                               placeholder="len 13"
                               onChange={e=>setPlcForm(f=>({...f, sa_part_code_len: e.target.value === "" ? null : parseInt(e.target.value) || null}))}/>
                      </div>
                      <div style={{ fontSize:10, color:"#94a3b8", marginTop:3 }}>
                        Byte-reversed ASCII. Leave blank to skip part-code capture.
                      </div>
                    </FF>
                    <FF label="Time Address (optional)">
                      <div style={{ display:"flex", gap:6 }}>
                        <input style={{...mini, flex:2}} type="text"
                               value={plcForm.sa_time_addr||""}
                               placeholder="D1600"
                               onChange={e=>setPlcForm(f=>({...f, sa_time_addr: e.target.value.trim()}))}/>
                        <input style={{...mini, flex:1}} type="number" min="6" max="6"
                               value={plcForm.sa_time_len ?? ""}
                               placeholder="6"
                               onChange={e=>setPlcForm(f=>({...f, sa_time_len: e.target.value === "" ? null : parseInt(e.target.value) || null}))}/>
                      </div>
                      <div style={{ fontSize:10, color:"#94a3b8", marginTop:3 }}>
                        6 regs: yr, mo, dy, hr, min, sec. Blank → use server clock.
                      </div>
                    </FF>
                  </div>

                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"10px 16px", marginBottom:8 }}>
                    <FF label="Data Block Start Address">
                      <input style={mini} type="text"
                             value={plcForm.sa_data_addr||""}
                             placeholder="D5801"
                             onChange={e=>setPlcForm(f=>({...f, sa_data_addr: e.target.value.trim()}))}/>
                    </FF>
                    <FF label="Number of Registers">
                      <input style={mini} type="number" min="1" max="100"
                             value={plcForm.sa_data_len ?? ""}
                             placeholder="20"
                             onChange={e=>{
                               const v = e.target.value === "" ? null : parseInt(e.target.value) || null;
                               setPlcForm(f=>{
                                 const newLen = v;
                                 // Resize register-names + scales arrays to match
                                 const names  = Array.from({length: newLen||0}, (_,i)=> f.sa_register_names?.[i] || "");
                                 const scales = Array.from({length: newLen||0}, (_,i)=> f.sa_register_scales?.[i] ?? 1);
                                 return { ...f, sa_data_len: newLen, sa_register_names: names, sa_register_scales: scales };
                               });
                             }}/>
                    </FF>
                  </div>

                  {(plcForm.sa_data_len || 0) > 0 && (
                    <div style={{ marginTop:10 }}>
                      <div style={{ fontSize:11, fontWeight:700, color:"#92400e", marginBottom:6 }}>
                        Register Labels &amp; Scaling — {plcForm.sa_data_len} register{plcForm.sa_data_len === 1 ? "" : "s"}
                      </div>
                      <div style={{ maxHeight:240, overflowY:"auto", border:"1px solid #fde68a", borderRadius:6, background:"#fff" }}>
                        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11 }}>
                          <thead>
                            <tr style={{ background:"#fef3c7" }}>
                              {["#","Register","Label","Scale (raw × scale)"].map(h => (
                                <th key={h} style={{ padding:"6px 10px", textAlign:"left", color:"#78350f", fontWeight:700 }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {Array.from({length: plcForm.sa_data_len}).map((_, i) => {
                              const baseAddr = plcForm.sa_data_addr || "";
                              const match = baseAddr.match(/^([A-Za-z]+)(\d+)/);
                              const reg = match ? `${match[1]}${parseInt(match[2])+i}` : `${baseAddr}+${i}`;
                              return (
                                <tr key={i} style={{ borderBottom:"1px solid #fef3c7" }}>
                                  <td style={{ padding:"5px 10px", color:"#92400e", fontWeight:700 }}>{i+1}</td>
                                  <td style={{ padding:"5px 10px", fontFamily:"monospace", color:"#475569" }}>{reg}</td>
                                  <td style={{ padding:"5px 10px" }}>
                                    <input style={{...mini, width:"100%"}} type="text"
                                           value={plcForm.sa_register_names?.[i] || ""}
                                           placeholder={`data_${i+1}`}
                                           onChange={e=>setPlcForm(f=>{
                                             const arr = [...(f.sa_register_names||[])];
                                             while (arr.length <= i) arr.push("");
                                             arr[i] = e.target.value;
                                             return { ...f, sa_register_names: arr };
                                           })}/>
                                  </td>
                                  <td style={{ padding:"5px 10px" }}>
                                    <input style={{...mini, width:"100%"}} type="number" step="0.001"
                                           value={plcForm.sa_register_scales?.[i] ?? 1}
                                           onChange={e=>setPlcForm(f=>{
                                             const arr = [...(f.sa_register_scales||[])];
                                             while (arr.length <= i) arr.push(1);
                                             arr[i] = e.target.value === "" ? 1 : parseFloat(e.target.value);
                                             return { ...f, sa_register_scales: arr };
                                           })}/>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      <div style={{ fontSize:10, color:"#92400e", marginTop:6 }}>
                        Scale 1.0 = no transform. Use e.g. 0.01 for torque values where PLC stores 2345 = 23.45 N·m.
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
            );
          })()}

          <div style={{ marginTop:16, display:"flex", justifyContent:"flex-end", gap:8 }}>
            <Btn onClick={()=>{setSelMach(null);setPlcForm({...BLANK_MACHINE_PLC});}}>Clear</Btn>
            <Btn variant="primary" onClick={savePLC} disabled={saving||!selLine}>{saving?"Saving…":selMach?"Update Machine":"Add Machine"}</Btn>
          </div>
        </Card>
      )}
 
      {/* ── Sub-page 2: Monitor Config (NEW) ── */}
      {subPage === 2 && (
        <div style={{ maxWidth:860 }}>
 
          {!selMach ? (
            <Card>
              <p style={{ color:"#94a3b8", fontSize:13 }}>Select a machine from Sub-page ① first.</p>
            </Card>
          ) : monLoading ? (
            <Card>
              <p style={{ color:"#94a3b8", fontSize:13 }}>Loading config…</p>
            </Card>
          ) : (
            <Card>
              {/* Header */}
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:22 }}>
                <div>
                  <h3 style={{ fontSize:15, fontWeight:700, color:"#0f172a", margin:0 }}>
                    Monitor Config — {selMach.machine_name || selMach.plc_ip}
                  </h3>
                  <p style={{ fontSize:12, color:"#64748b", margin:"4px 0 0" }}>
                    Polling bit, data registers, and loadcell channels read each cycle by the collector.
                  </p>
                </div>
                {monCfg && (
                  <Btn variant="danger" size="sm" onClick={deleteMonitorConfig}>Remove Config</Btn>
                )}
              </div>
 
              {/* ── Polling Bit ── */}
              <div style={{ marginBottom:24 }}>
                <div style={{ fontSize:11, fontWeight:700, color:"#1e40af", textTransform:"uppercase",
                  letterSpacing:".08em", marginBottom:8, display:"flex", alignItems:"center", gap:8 }}>
                  <span style={{ background:"#1e40af", color:"#fff", borderRadius:4,
                    padding:"1px 7px", fontSize:10 }}>REQUIRED</span>
                  Polling Bit
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                  <input
                    style={{ ...mini, width:150, fontFamily:"monospace", fontSize:14, fontWeight:700,
                      textTransform:"uppercase", letterSpacing:".05em" }}
                    type="text"
                    placeholder="e.g. M99"
                    value={pollingBit}
                    onChange={e => setPollingBit(e.target.value.toUpperCase())}
                  />
                  <span style={{ fontSize:12, color:"#64748b" }}>
                    PLC bit the collector reads each cycle to detect machine activity
                  </span>
                </div>
              </div>
 
              {/* ── Data Registers ── */}
              <div style={{ marginBottom:20, padding:16, borderRadius:8,
                border:`2px solid ${hasDataRegs ? "#3b82f6" : "#e2e8f0"}`,
                background: hasDataRegs ? "#f0f7ff" : "#fafafa", transition:"all .15s" }}>
 
                <label style={{ display:"flex", alignItems:"center", gap:10, cursor:"pointer", userSelect:"none" }}>
                  <input type="checkbox" checked={hasDataRegs}
                    onChange={e => { setHasDataRegs(e.target.checked); if (e.target.checked && dataRegs.length===0) addDataReg(); }}
                    style={{ width:16, height:16, accentColor:"#3b82f6", cursor:"pointer" }}/>
                  <span style={{ fontSize:13, fontWeight:700, color:"#0f172a" }}>Enable Data Registers</span>
                  <span style={{ fontSize:11, color:"#64748b" }}>— word/D-register values read each cycle (max 15)</span>
                </label>
 
                {hasDataRegs && (
                  <div style={{ marginTop:16 }}>
                    {/* Column headers */}
                    <div style={{ display:"grid", gridTemplateColumns:"130px 1fr 140px 32px",
                      gap:8, marginBottom:6, padding:"0 4px" }}>
                      {["Register","Label / Description","Desired Value",""].map((h,i)=>(
                        <span key={i} style={{ fontSize:10, fontWeight:700, color:"#475569",
                          textTransform:"uppercase", letterSpacing:".06em" }}>{h}</span>
                      ))}
                    </div>
 
                    {dataRegs.map((reg, i) => (
                      <div key={i} style={{ display:"grid", gridTemplateColumns:"130px 1fr 140px 32px",
                        gap:8, marginBottom:7, alignItems:"center" }}>
                        <input style={{ ...mini, fontFamily:"monospace", fontWeight:600, textTransform:"uppercase" }}
                          type="text" placeholder="D100" value={reg.register}
                          onChange={e => setDataReg(i,"register",e.target.value.toUpperCase())}/>
                        <input style={mini} type="text" placeholder="e.g. Torque Value" value={reg.label}
                          onChange={e => setDataReg(i,"label",e.target.value)}/>
                        <input style={{ ...mini, fontFamily:"monospace" }} type="number"
                          placeholder="e.g. 450" value={reg.desired_value ?? ""}
                          onChange={e => setDataReg(i,"desired_value",e.target.value)}/>
                        <button onClick={() => removeDataReg(i)}
                          style={{ border:"none", background:"#fee2e2", color:"#dc2626", borderRadius:6,
                            width:28, height:28, cursor:"pointer", fontSize:13, fontWeight:700,
                            display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
                      </div>
                    ))}
 
                    <div style={{ display:"flex", alignItems:"center", gap:10, marginTop:10 }}>
                      <Btn size="sm" onClick={addDataReg} disabled={dataRegs.length >= 15}>+ Add Register</Btn>
                      {dataRegs.length >= 15 && <span style={{ fontSize:11, color:"#d97706" }}>Maximum 15 reached</span>}
                      <span style={{ fontSize:11, color:"#64748b", marginLeft:"auto" }}>
                        {dataRegs.filter(r=>r.register).length} / 15 configured
                      </span>
                    </div>
                  </div>
                )}
              </div>
 
              {/* ── Loadcell Registers ── */}
              <div style={{ marginBottom:24, padding:16, borderRadius:8,
                border:`2px solid ${hasLoadcell ? "#8b5cf6" : "#e2e8f0"}`,
                background: hasLoadcell ? "#faf5ff" : "#fafafa", transition:"all .15s" }}>
 
                <label style={{ display:"flex", alignItems:"center", gap:10, cursor:"pointer", userSelect:"none" }}>
                  <input type="checkbox" checked={hasLoadcell}
                    onChange={e => { setHasLoadcell(e.target.checked); if (e.target.checked && loadcellRegs.length===0) addLoadcell(); }}
                    style={{ width:16, height:16, accentColor:"#8b5cf6", cursor:"pointer" }}/>
                  <span style={{ fontSize:13, fontWeight:700, color:"#0f172a" }}>Enable Loadcell Monitoring</span>
                  <span style={{ fontSize:11, color:"#64748b" }}>— analog weight/force registers with min/max thresholds</span>
                </label>
 
                {hasLoadcell && (
                  <div style={{ marginTop:16 }}>
                    {/* Column headers */}
                    <div style={{ display:"grid", gridTemplateColumns:"130px 1fr 110px 110px 32px",
                      gap:8, marginBottom:6, padding:"0 4px" }}>
                      {["Register","Label / Description","Min Value","Max Value",""].map((h,i)=>(
                        <span key={i} style={{ fontSize:10, fontWeight:700, color:"#475569",
                          textTransform:"uppercase", letterSpacing:".06em" }}>{h}</span>
                      ))}
                    </div>
 
                    {loadcellRegs.map((lc, i) => (
                      <div key={i} style={{ display:"grid", gridTemplateColumns:"130px 1fr 110px 110px 32px",
                        gap:8, marginBottom:7, alignItems:"center" }}>
                        <input style={{ ...mini, fontFamily:"monospace", fontWeight:600, textTransform:"uppercase" }}
                          type="text" placeholder="D200" value={lc.register}
                          onChange={e => setLoadcell(i,"register",e.target.value.toUpperCase())}/>
                        <input style={mini} type="text" placeholder="e.g. Loadcell 1" value={lc.label}
                          onChange={e => setLoadcell(i,"label",e.target.value)}/>
                        <input style={{ ...mini, fontFamily:"monospace" }} type="number"
                          placeholder="Min" value={lc.min_value ?? ""}
                          onChange={e => setLoadcell(i,"min_value",e.target.value)}/>
                        <input style={{ ...mini, fontFamily:"monospace" }} type="number"
                          placeholder="Max" value={lc.max_value ?? ""}
                          onChange={e => setLoadcell(i,"max_value",e.target.value)}/>
                        <button onClick={() => removeLoadcell(i)}
                          style={{ border:"none", background:"#f3e8ff", color:"#7c3aed", borderRadius:6,
                            width:28, height:28, cursor:"pointer", fontSize:13, fontWeight:700,
                            display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
                      </div>
                    ))}
 
                    <div style={{ display:"flex", alignItems:"center", gap:10, marginTop:10 }}>
                      <Btn size="sm" onClick={addLoadcell}>+ Add Loadcell Channel</Btn>
                      <span style={{ fontSize:11, color:"#64748b", marginLeft:"auto" }}>
                        {loadcellRegs.filter(r=>r.register).length} channel(s) configured
                      </span>
                    </div>
                  </div>
                )}
              </div>
 
              {/* ── Summary badges ── */}
              <div style={{ display:"flex", gap:8, marginBottom:20, flexWrap:"wrap" }}>
                <span style={{ padding:"3px 10px", borderRadius:99, fontSize:11, fontWeight:600,
                  background: pollingBit ? "#dcfce7" : "#fee2e2",
                  color: pollingBit ? "#15803d" : "#dc2626",
                  border:`1px solid ${pollingBit ? "#86efac" : "#fca5a5"}` }}>
                  {pollingBit ? `● Polling: ${pollingBit}` : "○ No polling bit set"}
                </span>
                {hasDataRegs && (
                  <span style={{ padding:"3px 10px", borderRadius:99, fontSize:11, fontWeight:600,
                    background:"#dbeafe", color:"#1d4ed8", border:"1px solid #93c5fd" }}>
                    ◈ {dataRegs.filter(r=>r.register).length} data register(s)
                  </span>
                )}
                {hasLoadcell && (
                  <span style={{ padding:"3px 10px", borderRadius:99, fontSize:11, fontWeight:600,
                    background:"#ede9fe", color:"#6d28d9", border:"1px solid #c4b5fd" }}>
                    ⊞ {loadcellRegs.filter(r=>r.register).length} loadcell channel(s)
                  </span>
                )}
              </div>
 
              {/* ── Action buttons ── */}
              <div style={{ display:"flex", justifyContent:"flex-end", gap:10 }}>
                <Btn onClick={() => {
                  setPollingBit(monCfg?.polling_bit || "");
                  setHasDataRegs(monCfg?.has_data_registers || false);
                  setDataRegs(monCfg?.data_registers || []);
                  setHasLoadcell(monCfg?.has_loadcell || false);
                  setLoadcellRegs(monCfg?.loadcell_registers || []);
                }}>Reset</Btn>
                <Btn variant="primary" onClick={saveMonitorConfig}
                  disabled={monSaving || !pollingBit.trim()}>
                  {monSaving ? "Saving…" : "Save Monitor Config"}
                </Btn>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* ── Sub-page 3: Process Config ──────────────────────────────
          Per-machine process list with target value + actual-value PLC
          register.  Each row will eventually drive a bar-graph card
          (actual bars + target line) on the dedicated Process Graphs
          page.  Admin can add / remove / reorder rows freely. */}
      {subPage === 3 && (
        <div>
          <Card>
            <h3 style={{ fontSize:15, fontWeight:700, color:"#0f172a", marginBottom:6 }}>
              {selMach ? `Process Config — ${selMach.machine_name||selMach.plc_ip}` : "Process Config"}
            </h3>
            <div style={{ fontSize:12, color:"#64748b", marginBottom:18, lineHeight:1.5 }}>
              Some machines have 5 processes, some 7. Add one row per
              process, each with its own <b>name</b>, <b>target value</b>,
              and the <b>PLC register</b> where the live actual value
              comes from. The Process Graphs page renders each row as a
              bar chart (actual = bars, target = horizontal line, title = name).
            </div>

            {!selMach ? (
              <p style={{ color:"#94a3b8", fontSize:13, fontStyle:"italic" }}>
                Select a machine from sub-page ① to configure its processes.
              </p>
            ) : procLoading ? (
              <Spinner/>
            ) : (
              <>
                {/* Header row */}
                <div style={{ display:"grid",
                              gridTemplateColumns:"60px 1fr 130px 150px 110px 80px 60px",
                              gap:8, marginBottom:8,
                              padding:"6px 10px",
                              fontSize:9, fontWeight:800, letterSpacing:".08em",
                              color:"#64748b", textTransform:"uppercase",
                              background:"#f8fafc", borderRadius:8 }}>
                  <div>#</div>
                  <div>Process Name</div>
                  <div>Target Value</div>
                  <div>Actual PLC Register</div>
                  <div>Type</div>
                  <div>Active</div>
                  <div></div>
                </div>

                {/* Rows */}
                {procRows.length === 0 ? (
                  <div style={{ padding:"30px 12px", textAlign:"center",
                                 color:"#94a3b8", fontStyle:"italic", fontSize:12 }}>
                    No processes configured yet — click <b>+ Add Process</b> below.
                  </div>
                ) : procRows.map((p, idx) => (
                  <div key={idx} style={{ display:"grid",
                                           gridTemplateColumns:"60px 1fr 130px 150px 110px 80px 60px",
                                           gap:8, marginBottom:6, alignItems:"center",
                                           padding:"4px 0" }}>
                    <input style={mini} type="number" min="1"
                           value={p.process_no || idx + 1}
                           onChange={e => setProcRows(rs => {
                             const n = [...rs];
                             n[idx] = { ...n[idx], process_no: parseInt(e.target.value) || idx+1 };
                             return n;
                           })}/>
                    <input style={mini} type="text"
                           placeholder={`e.g. Pressing, Welding, …`}
                           value={p.process_name || ""}
                           onChange={e => setProcRows(rs => {
                             const n = [...rs];
                             n[idx] = { ...n[idx], process_name: e.target.value };
                             return n;
                           })}/>
                    <input style={mini} type="number" step="0.01" min="0"
                           value={p.target_value ?? 0}
                           onChange={e => setProcRows(rs => {
                             const n = [...rs];
                             n[idx] = { ...n[idx], target_value: parseFloat(e.target.value) || 0 };
                             return n;
                           })}/>
                    <input style={mini} type="text"
                           placeholder="e.g. D2000, M100, Y10"
                           value={p.actual_register || ""}
                           onChange={e => setProcRows(rs => {
                             const n = [...rs];
                             n[idx] = { ...n[idx], actual_register: e.target.value };
                             return n;
                           })}/>
                    <select style={mini}
                            value={p.register_type || "word"}
                            onChange={e => setProcRows(rs => {
                              const n = [...rs];
                              n[idx] = { ...n[idx], register_type: e.target.value };
                              return n;
                            })}>
                      <option value="word">Word</option>
                      <option value="bit">Bit</option>
                    </select>
                    <div style={{ textAlign:"center" }}>
                      <input type="checkbox"
                             checked={p.is_active !== false}
                             onChange={e => setProcRows(rs => {
                               const n = [...rs];
                               n[idx] = { ...n[idx], is_active: e.target.checked };
                               return n;
                             })}
                             style={{ width:18, height:18, cursor:"pointer", accentColor:"#1e40af" }}/>
                    </div>
                    <Btn size="sm" variant="danger"
                         onClick={() => setProcRows(rs => rs.filter((_,i) => i !== idx))}>
                      ×
                    </Btn>
                  </div>
                ))}

                <div style={{ display:"flex", gap:10, marginTop:14, paddingTop:14,
                                borderTop:"1px solid #e2e8f0", justifyContent:"space-between",
                                alignItems:"center", flexWrap:"wrap" }}>
                  <Btn onClick={() => setProcRows(rs => [...rs, {
                                process_no:      rs.length + 1,
                                process_name:    "",
                                target_value:    0,
                                actual_register: "",
                                register_type:   "word",
                                is_active:       true,
                              }])}>
                    + Add Process
                  </Btn>
                  <div style={{ display:"flex", gap:10 }}>
                    <Btn onClick={() => loadProcessConfig(selMach.id)}>Reset</Btn>
                    <Btn variant="primary" onClick={saveProcessConfig}
                         disabled={procSaving}>
                      {procSaving ? "Saving…" : `Save ${procRows.length} process${procRows.length===1?"":"es"}`}
                    </Btn>
                  </div>
                </div>

                {/* Latest values readout — useful for verifying the
                    register addresses are reading sane numbers before
                    relying on the graphs. */}
                {procRows.some(p => p.latest_value !== undefined) && (
                  <div style={{ marginTop:18, padding:14, background:"#f8fafc",
                                  border:"1px solid #e2e8f0", borderRadius:10 }}>
                    <div style={{ fontSize:11, fontWeight:700, color:"#64748b",
                                    letterSpacing:".08em", textTransform:"uppercase",
                                    marginBottom:8 }}>
                      Latest sampled values
                    </div>
                    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",
                                    gap:10 }}>
                      {procRows.filter(p => p.latest_value !== undefined && p.latest_value !== null).map((p,i) => {
                        const target = Number(p.target_value || 0);
                        const actual = Number(p.latest_value || 0);
                        const ok     = target > 0 ? actual >= target : true;
                        return (
                          <div key={i} style={{
                            background:"#fff", border:`1.5px solid ${ok?"#16a34a":"#dc2626"}33`,
                            borderRadius:8, padding:"8px 10px",
                          }}>
                            <div style={{ fontSize:11, fontWeight:700, color:"#0f172a",
                                            whiteSpace:"nowrap", overflow:"hidden",
                                            textOverflow:"ellipsis" }}>
                              {p.process_name}
                            </div>
                            <div style={{ display:"flex", alignItems:"baseline",
                                            justifyContent:"space-between", marginTop:4 }}>
                              <span style={{ fontSize:18, fontWeight:800, color:ok?"#16a34a":"#dc2626" }}>
                                {actual}
                              </span>
                              <span style={{ fontSize:10, color:"#94a3b8" }}>
                                / target {target}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </Card>
        </div>
      )}

      {/* Bit address edit modal — now inside PLC Config sub-page */}
      <Modal open={bitModal} onClose={()=>setBitModal(false)} title={`Edit Bit Addresses — ${selMach?.machine_name||""}`}>
        {selMach && (
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"10px 16px" }}>
            {BIT_FIELDS.map(({key,label})=>(
              <FF key={key} label={label}>
                <input style={inputStyle} type="text" value={plcForm[key]||""} onChange={e=>setPlcForm(f=>({...f,[key]:e.target.value}))}/>
              </FF>
            ))}
          </div>
        )}
        <ModalActions>
          <Btn onClick={()=>setBitModal(false)}>Cancel</Btn>
          <Btn variant="primary" onClick={async()=>{ await savePLC(); setBitModal(false); const r=await api.get(`/api/lines/${selLine}/machines`,token); setMachines(Array.isArray(r)?r:[]); const updated=r.find?.(m=>m.id===selMach?.id); if(updated) selectMachine(updated); }} disabled={saving}>{saving?"Saving…":"Save Addresses"}</Btn>
        </ModalActions>
      </Modal>
 
    </div>
  );
}
// ─── CAMERA LIST PAGE ─────────────────────────────────────────
export function CameraListPage({ toast, readOnly = false }) {
  const { token } = useAuth();
  const [grid, setGrid]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [pings, setPings]     = useState({});  // { "192.168.10.115": {ok:true,ms:12} }
  const [pinging, setPinging] = useState(false);

  // ── Assign-camera modal state ─────────────────────────────────────────
  const [assignTarget, setAssignTarget] = useState(null); // row being assigned
  const [allCameras,   setAllCameras]   = useState([]);
  const [camLoading,   setCamLoading]   = useState(false);
  const [picked,       setPicked]       = useState("");
  const [saving,       setSaving]       = useState(false);

  const openAssign = async (machine) => {
    setAssignTarget(machine);
    setPicked(machine.camera_id || "");
    setCamLoading(true);
    try {
      const r = await api.get("/api/cms/cameras", token);
      const list = Array.isArray(r) ? r : (Array.isArray(r?.data) ? r.data : []);
      setAllCameras(list);
    } catch (e) { toast("Failed to load cameras list from CMS", "err"); setAllCameras([]); }
    finally { setCamLoading(false); }
  };

  const saveAssign = async () => {
    if (!assignTarget || !picked) { toast("Select a camera first","err"); return; }
    const { zone_id, line_id, machine_id } = assignTarget;
    if (!zone_id || !line_id || !machine_id) { toast("Machine is missing zone/line/id — can't assign","err"); return; }
    setSaving(true);
    try {
      await api.patch(
        `/api/cms/machines/${encodeURIComponent(zone_id)}/${encodeURIComponent(line_id)}/${encodeURIComponent(machine_id)}/camera`,
        { camera_id: picked },
        token,
      );
      toast("Camera assigned ✓");
      setAssignTarget(null);
      load();
    } catch (e) { toast(e.message || "Assign failed", "err"); }
    finally { setSaving(false); }
  };

  // Fetch camera grid from CMS backend (via /cms-api proxy)
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/api/cms/camera-grid", token);
      setGrid(Array.isArray(r) ? r : (Array.isArray(r?.data) ? r.data : []));
    } catch { toast("Failed to load camera grid from CMS portal", "err"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Ping all unique camera IPs
  const pingAll = useCallback(async (data) => {
    const items = data || grid;
    const ips = [...new Set(items.filter(m => m.camera_ip).map(m => m.camera_ip))];
    if (!ips.length) return;
    setPinging(true);
    const results = {};
    await Promise.allSettled(ips.map(async ip => {
      try {
        const r = await api.get(`/api/ping?ip=${encodeURIComponent(ip)}&port=554`, token);
        results[ip] = r;
      } catch { results[ip] = { ok: false, ms: 0 }; }
    }));
    setPings(results);
    setPinging(false);
  }, [grid, token]);

  // Ping on load and every 30s
  useEffect(() => {
    if (!grid.length) return;
    pingAll(grid);
    const t = setInterval(() => pingAll(), 30000);
    return () => clearInterval(t);
  }, [grid]); // eslint-disable-line

  // Group: zone → line → machines
  const grouped = {};
  grid.forEach(m => {
    const zk = m.zone_name || "Unknown Zone";
    const lk = m.line_name || "Unknown Line";
    if (!grouped[zk]) grouped[zk] = {};
    if (!grouped[zk][lk]) grouped[zk][lk] = [];
    grouped[zk][lk].push(m);
  });

  const zones = Object.keys(grouped).sort();
  const totalCams = grid.filter(m => m.has_camera).length;
  const onlineCount = Object.values(pings).filter(p => p.ok).length;
  const uniqueIPs = [...new Set(grid.filter(m => m.camera_ip).map(m => m.camera_ip))];

  return (
    <div>
      {/* Stats */}
      <div style={{display:"flex",gap:14,marginBottom:18,flexWrap:"wrap"}}>
        {[
          { label: "Machines",   val: grid.length,   color: "#1e40af" },
          { label: "With Camera",val: totalCams,      color: "#16a34a" },
          { label: "Unique IPs", val: uniqueIPs.length, color: "#7c3aed" },
          { label: "Online",     val: onlineCount,    color: "#16a34a" },
          { label: "Offline",    val: uniqueIPs.length - onlineCount, color: "#dc2626" },
        ].map(({ label, val, color }) => (
          <div key={label} style={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:10,padding:"12px 18px",minWidth:100}}>
            <div style={{fontSize:11,color:"#64748b",fontWeight:600,textTransform:"uppercase",letterSpacing:".06em"}}>{label}</div>
            <div style={{fontSize:26,fontWeight:800,color}}>{val}</div>
          </div>
        ))}
        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:8}}>
          <Btn size="sm" onClick={() => pingAll()} disabled={pinging}>
            {pinging ? "Pinging..." : "Refresh Ping"}
          </Btn>
          <Btn size="sm" onClick={load}>Reload</Btn>
        </div>
      </div>

      {loading ? <Spinner /> : zones.length === 0 ? (
        <EmptyState text="No cameras found" sub="CMS portal returned no machine/camera data. Make sure the CMS backend is running on port 5000." />
      ) : (
        zones.map(zoneName => (
          <Card key={zoneName} style={{marginBottom:18}}>
            {/* Zone header */}
            <div style={{padding:"12px 16px",background:"#f8fafc",borderBottom:"1px solid #e2e8f0",display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:16}}>◎</span>
              <span style={{fontSize:14,fontWeight:800,color:"#0f172a"}}>{zoneName}</span>
              <span style={{fontSize:10,color:"#94a3b8",marginLeft:4}}>
                {Object.values(grouped[zoneName]).reduce((a, ms) => a + ms.length, 0)} machines
              </span>
            </div>

            {Object.keys(grouped[zoneName]).sort().map(lineName => {
              const machines = grouped[zoneName][lineName];
              return (
                <div key={lineName}>
                  {/* Line sub-header */}
                  <div style={{padding:"8px 16px 6px 32px",fontSize:11,fontWeight:700,color:"#1e40af",
                    letterSpacing:".06em",textTransform:"uppercase",borderBottom:"1px solid #f1f5f9"}}>
                    {lineName}
                  </div>

                  {/* Machine rows */}
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                    <thead>
                      <tr>
                        {["Machine","Camera","IP","Port","Status","Action"].map(h => (
                          <th key={h} style={{padding:"6px 14px 6px 32px",textAlign:"left",fontSize:9,fontWeight:700,
                            letterSpacing:".08em",textTransform:"uppercase",color:"#94a3b8",borderBottom:"1px solid #f1f5f9"}}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {machines.map((m, i) => {
                        const ping = m.camera_ip ? pings[m.camera_ip] : null;
                        const online = ping?.ok;
                        return (
                          <tr key={i} style={{borderBottom:"1px solid #f8fafc"}}>
                            <td style={{padding:"9px 14px 9px 32px",fontWeight:600,color:"#0f172a"}}>{m.machine_name || "—"}</td>
                            <td style={{padding:"9px 14px"}}>
                              {m.has_camera
                                ? <span style={{padding:"2px 9px",borderRadius:99,fontSize:10,fontWeight:700,
                                    background:"rgba(22,163,74,.1)",color:"#16a34a"}}>{m.camera_name || m.camera_id}</span>
                                : <span style={{color:"#cbd5e1",fontSize:11}}>No camera</span>}
                            </td>
                            <td style={{padding:"9px 14px",fontFamily:"monospace",fontWeight:700,color:m.camera_ip?"#7c3aed":"#cbd5e1",fontSize:11}}>
                              {m.camera_ip || "—"}
                            </td>
                            <td style={{padding:"9px 14px",fontFamily:"monospace",color:"#64748b",fontSize:11}}>
                              {m.camera_port || "—"}
                            </td>
                            <td style={{padding:"9px 14px"}}>
                              {!m.has_camera ? (
                                <span style={{display:"flex",alignItems:"center",gap:4,fontSize:10,color:"#cbd5e1"}}>
                                  <span style={{width:8,height:8,borderRadius:"50%",background:"#e2e8f0"}}/>N/A
                                </span>
                              ) : ping == null ? (
                                <span style={{fontSize:10,color:"#94a3b8"}}>...</span>
                              ) : online ? (
                                <span style={{display:"flex",alignItems:"center",gap:4,fontSize:10,fontWeight:700,color:"#16a34a"}}>
                                  <span style={{width:8,height:8,borderRadius:"50%",background:"#16a34a"}}/>Online
                                  <span style={{fontSize:9,color:"#94a3b8",fontWeight:500}}>{ping.ms}ms</span>
                                </span>
                              ) : (
                                <span style={{display:"flex",alignItems:"center",gap:4,fontSize:10,fontWeight:700,color:"#dc2626"}}>
                                  <span style={{width:8,height:8,borderRadius:"50%",background:"#dc2626"}}/>Offline
                                </span>
                              )}
                            </td>
                            <td style={{padding:"9px 14px"}}>
                              <Btn size="sm" variant={m.has_camera?"ghost":"primary"} onClick={()=>openAssign(m)}>
                                {m.has_camera ? "Change" : "Assign"}
                              </Btn>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </Card>
        ))
      )}

      {/* ── Assign Camera Modal ── */}
      <Modal
        open={!!assignTarget}
        onClose={()=>setAssignTarget(null)}
        title={`Assign Camera → ${assignTarget?.machine_name || ""}`}
      >
        {assignTarget && (
          <div>
            <div style={{fontSize:11,color:"#64748b",marginBottom:14,lineHeight:1.5}}>
              <b style={{color:"#0f172a"}}>{assignTarget.zone_name}</b> &nbsp;/&nbsp;
              <b style={{color:"#0f172a"}}>{assignTarget.line_name}</b> &nbsp;/&nbsp;
              <b style={{color:"#7c3aed",fontFamily:"monospace"}}>{assignTarget.machine_name}</b>
              {assignTarget.has_camera && (
                <div style={{marginTop:6,padding:"6px 10px",background:"rgba(22,163,74,.06)",borderRadius:6,display:"inline-block"}}>
                  Currently: <b style={{color:"#16a34a"}}>{assignTarget.camera_name || assignTarget.camera_id}</b>
                </div>
              )}
            </div>

            {camLoading ? <Spinner/> : allCameras.length === 0 ? (
              <EmptyState
                text="No cameras registered in CMS Portal"
                sub="Go to CMS Portal → Cameras → Add Camera first, then come back here."
              />
            ) : (
              <div style={{
                maxHeight:360, overflowY:"auto",
                display:"flex", flexDirection:"column", gap:6,
                border:"1px solid #e2e8f0", borderRadius:10, padding:10, background:"#f8fafc",
              }}>
                {allCameras.map(cam => {
                  const on = picked === cam.id;
                  const isCurrent = assignTarget.camera_id === cam.id;
                  return (
                    <label key={cam.id} style={{
                      display:"flex",alignItems:"center",gap:10,padding:"9px 12px",
                      background: on ? "rgba(30,64,175,.08)" : "#fff",
                      border: `1px solid ${on ? "rgba(30,64,175,.35)" : "#e2e8f0"}`,
                      borderRadius:8, cursor:"pointer",
                    }}>
                      <input type="radio" checked={on} onChange={()=>setPicked(cam.id)}/>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:12,fontWeight:700,color:"#0f172a",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                          {cam.name}
                          {isCurrent && <span style={{marginLeft:8,fontSize:9,fontWeight:600,color:"#16a34a"}}>● current</span>}
                        </div>
                        <div style={{fontSize:10,color:"#64748b",fontFamily:"monospace",marginTop:2}}>
                          {cam.ip}:{cam.port || 554}  {cam.path ? `· ${cam.path}` : ""}
                        </div>
                      </div>
                      <span style={{fontSize:9,color:"#94a3b8",fontFamily:"monospace"}}>#{cam.id}</span>
                    </label>
                  );
                })}
              </div>
            )}
            <div style={{fontSize:10,color:"#94a3b8",marginTop:10}}>
              Select a camera and press <b>Assign</b>. Binding updates in CMS Portal
              and will be picked up by the video recorder automatically.
            </div>
            <ModalActions>
              <Btn onClick={()=>setAssignTarget(null)}>Cancel</Btn>
              <Btn variant="primary" onClick={saveAssign} disabled={saving || !picked}>
                {saving ? "Saving…" : "Assign"}
              </Btn>
            </ModalActions>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ─── DEPARTMENTS PAGE ─────────────────────────────────────────
// Admin-managed master list of departments.  Seeded with Maintenance and
// Quality at install time; admin can add more (e.g. Tool Room) anytime.
// Department users (role='department') are bound to a row here via
// mes_admin.department_id and the SlideNav labels their Department Panel
// item with this row's `name` (e.g. "Maintenance Panel").
export function DepartmentsPage({ toast, readOnly = false }) {
  const { token } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name:"", slug:"", description:"" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/api/departments/", token);
      setRows(Array.isArray(r) ? r : []);
    } catch (e) { toast(e.message || "Load failed", "err"); }
    finally    { setLoading(false); }
  }, [token, toast]);
  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm({ name:"", slug:"", description:"" });
    setModal(true);
  };
  const openEdit = (row) => {
    setEditing(row);
    setForm({ name: row.name || "", slug: row.slug || "", description: row.description || "" });
    setModal(true);
  };
  const save = async () => {
    if (!form.name.trim()) { toast("Name is required", "err"); return; }
    setSaving(true);
    try {
      // Backend auto-derives slug from name if blank — let it.
      const body = {
        name: form.name.trim(),
        slug: form.slug.trim() || null,
        description: form.description.trim() || null,
      };
      if (editing) await api.put(`/api/departments/${editing.id}`, body, token);
      else         await api.post("/api/departments/", body, token);
      toast(editing ? "Department updated ✓" : "Department added ✓");
      setModal(false);
      load();
    } catch (e) { toast(e.message || "Save failed", "err"); }
    finally    { setSaving(false); }
  };
  const remove = async (r) => {
    if (!confirm(`Delete department "${r.name}"?\n\nUsers bound to this department will keep their role but lose the department link.`)) return;
    try {
      await api.delete(`/api/departments/${r.id}`, token);
      toast("Removed");
      load();
    } catch (e) { toast(e.message || "Delete failed", "err"); }
  };

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
        <div>
          <div style={{ fontWeight:700, fontSize:15, color:"#0f172a" }}>Departments</div>
          <div style={{ fontSize:11, color:"#64748b", marginTop:2 }}>
            Master list of departments.&nbsp; Each department user is bound to one row here, and the slide-nav labels their panel as <b>"{`{Name}`} Panel"</b>.&nbsp; Add new departments (e.g. Tool Room, Stores) as needed.
          </div>
        </div>
        <Btn variant="primary" onClick={openCreate}>+ Add Department</Btn>
      </div>

      <Card>
        {loading ? <Spinner /> : rows.length === 0 ? (
          <EmptyState text="No departments yet" sub="Click + Add Department to get started." />
        ) : (
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
            <thead>
              <tr>{["ID","Name","Slug","Description","Created","Actions"].map(h => (
                <th key={h} style={{ padding:"10px 14px", textAlign:"left", fontSize:10, fontWeight:700, letterSpacing:".08em", textTransform:"uppercase", color:"#64748b", borderBottom:"2px solid #e2e8f0" }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} style={{ borderBottom:"1px solid #f1f5f9" }}>
                  <td style={{ padding:"12px 14px", fontFamily:"monospace", color:"#64748b" }}>{r.id}</td>
                  <td style={{ padding:"12px 14px", fontWeight:700, color:"#0f172a" }}>{r.name}</td>
                  <td style={{ padding:"12px 14px", fontFamily:"monospace", fontSize:11, color:"#475569" }}>{r.slug}</td>
                  <td style={{ padding:"12px 14px", color:"#475569", fontSize:12 }}>
                    {r.description || <span style={{ color:"#cbd5e1" }}>—</span>}
                  </td>
                  <td style={{ padding:"12px 14px", fontFamily:"monospace", fontSize:11, color:"#64748b" }}>
                    {r.created_at ? new Date(r.created_at).toLocaleDateString("en-IN") : "—"}
                  </td>
                  <td style={{ padding:"12px 14px" }}>
                    <div style={{ display:"flex", gap:8 }}>
                      <Btn size="sm" onClick={() => openEdit(r)}>Edit</Btn>
                      <Btn size="sm" variant="danger" onClick={() => remove(r)}>Delete</Btn>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Modal open={modal} onClose={() => setModal(false)}
             title={editing ? "Edit Department" : "Add Department"}>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
          <FF label="Name *" hint="Display name shown in slide-nav (e.g. 'Maintenance', 'Tool Room').">
            <Input value={form.name}
                   onChange={e => setForm(f => ({ ...f, name:e.target.value }))}
                   placeholder="e.g. Tool Room"/>
          </FF>
          <FF label="Slug" hint="URL-safe identifier — auto-derived from Name if left blank.">
            <Input value={form.slug}
                   onChange={e => setForm(f => ({ ...f, slug:e.target.value.toLowerCase() }))}
                   placeholder="auto"/>
          </FF>
          <div style={{ gridColumn:"1 / -1" }}>
            <FF label="Description (optional)">
              <Input value={form.description}
                     onChange={e => setForm(f => ({ ...f, description:e.target.value }))}
                     placeholder="What does this department do?"/>
            </FF>
          </div>
        </div>
        <ModalActions>
          <Btn onClick={() => setModal(false)}>Cancel</Btn>
          <Btn variant="primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : editing ? "Update" : "Create"}
          </Btn>
        </ModalActions>
      </Modal>
    </div>
  );
}


// (Closure form is now hardcoded to the Toyota Boshoku BREAK DOWN SLIP
//  layout in MaintenanceDashboard.jsx — admin no longer configures fields.)


// ─── BREAKDOWN MAILS PAGE ─────────────────────────────────────
// CRUD over `mes_breakdown_mail_levels` — admin defines the escalation
// chain (Level 1 fires immediately, Level 2 after delay_minutes, etc.).
// A background worker (Phase2/routers/breakdown_mail.py) polls every
// 30 s and sends each level's mail once when its delay has elapsed —
// only as long as the breakdown is still OPEN.  When the line goes
// back to RUNNING (collector resolves the row), no more levels fire.
// 2026-06-09 — NG → Quality mail recipients, set live from this panel.
// Saves to DB (mes_quality_mail_config); the "Send to Quality" mail reads it
// first, so a change takes effect on the next report — no restart.
