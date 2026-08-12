/* admin/org.jsx — Users · Machines · Cameras · Departments. */
import { useState, useEffect, useRef, useCallback, useMemo, Fragment } from "react";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../api/client";
import {
  PageHeading, Card, Pill, Btn, FF, Input, Select,
  Modal, ModalActions, Toast, EmptyState, Spinner, ExcelImportButton,
  inputStyle,
} from "./ui";
import { PAGE_PERM_GROUPS, PERM_LEVELS, ROLE_PILL, ROLE_OPTIONS } from "./mailconfig";

export function UsersPage({ toast, readOnly = false }) {
  const { token } = useAuth();
  const [users,       setUsers]       = useState([]);
  const [lines,       setLines]       = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [modal,       setModal]       = useState(false);
  const [assignModal, setAssignModal] = useState(null);
  const [form,        setForm]        = useState({
    username:"", password:"", role:"", department_id:"",
  });
  const [saving,      setSaving]      = useState(false);
  const [selLines,    setSelLines]    = useState([]);
  const [revealed,    setRevealed]    = useState(() => new Set());  // kin users ka password dikhana hai
  const [showPw,      setShowPw]      = useState(false);            // add-form password visible?

  // Permission matrix state — opened when admin clicks "Permissions"
  // on a user row.  permModal=null means closed; otherwise it holds
  // the user being edited.  permMap is { page_key: 'none'|'read'|'full' }.
  const [permModal,  setPermModal]  = useState(null);
  const [permMap,    setPermMap]    = useState({});
  const [permLoading,setPermLoading]= useState(false);
  const [permSaving, setPermSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const u = await api.get("/api/users/", token);
      setUsers(Array.isArray(u)?u:[]);
      setLines([]);
      setDepartments([]);
    } catch { toast("Failed to load","err"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const createUser = async () => {
    const uname = form.username.trim();
    if (!uname||!form.password) { toast("Username and password required","err"); return; }
    if (!form.role) { toast("Role select karo","err"); return; }
    // Duplicate username — frontend pe turant rok (backend bhi 400 deta hai).
    if (users.some(u => (u.username||"").toLowerCase() === uname.toLowerCase())) {
      toast("Ye username pehle se hai — dusra chuno","err"); return;
    }
    setSaving(true);
    try {
      const body = { username: uname, password: form.password, role: form.role };
      await api.post("/api/users/", body, token);
      toast("User created ✓");
      setModal(false);
      setForm({ username:"", password:"", role:"", department_id:"" });
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

  const resetPassword = async (u) => {
    const pw = prompt(`New password for "${u.username}":`);
    if (pw == null) return;                       // cancel dabaya
    if (!pw.trim()) { toast("Password khaali nahi","err"); return; }
    try { await api.put(`/api/users/${u.id}/password`, { password: pw }, token); toast("Password reset ✓"); load(); }
    catch(e) { toast(e.message,"err"); }
  };
  const toggleReveal = (id) =>
    setRevealed(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

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
              <tr>{["ID","Username","Role","Password","Last Login","Actions"].map(h=>(
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
                          {ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                        </select>
                      )
                    }
                  </td>
                  <td style={{ padding:"12px 14px" }}>
                    {u.password_plain ? (
                      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                        <span style={{ fontFamily:"monospace", fontSize:13, color:"#0f172a",
                                       letterSpacing: revealed.has(u.id) ? "normal" : "2px" }}>
                          {revealed.has(u.id) ? u.password_plain : "••••••"}
                        </span>
                        <button onClick={()=>toggleReveal(u.id)} title={revealed.has(u.id)?"Hide":"Show"}
                                style={{ border:"none", background:"transparent", cursor:"pointer", fontSize:14, padding:0, lineHeight:1 }}>
                          {revealed.has(u.id) ? "🙈" : "👁"}
                        </button>
                      </div>
                    ) : (
                      <span style={{ color:"#cbd5e1", fontStyle:"italic", fontSize:12 }}>Reset PW se set karo</span>
                    )}
                  </td>
                  <td style={{ padding:"12px 14px", fontFamily:"monospace", fontSize:11, color:"#64748b" }}>{u.last_login?new Date(u.last_login).toLocaleString("en-IN"):"Never"}</td>
                  <td style={{ padding:"12px 14px" }}>
                    <div style={{ display:"flex", gap:8 }}>
                      <Btn size="sm" onClick={()=>resetPassword(u)}>Reset PW</Btn>
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
          <FF label="Username *"><Input value={form.username} onChange={e=>setForm(f=>({...f,username:e.target.value}))} placeholder="login id"
                                        name="mes-new-username" autoComplete="off" /></FF>
          <FF label="Password *">
            <div style={{ position:"relative" }}>
              <Input type={showPw?"text":"password"} value={form.password}
                     onChange={e=>setForm(f=>({...f,password:e.target.value}))} placeholder="password"
                     name="mes-new-password" autoComplete="new-password" />
              <button type="button" onClick={()=>setShowPw(v=>!v)} title={showPw?"Hide":"Show"}
                      style={{ position:"absolute", right:8, top:"50%", transform:"translateY(-50%)",
                               border:"none", background:"transparent", cursor:"pointer", fontSize:15, lineHeight:1 }}>
                {showPw?"🙈":"👁"}
              </button>
            </div>
          </FF>
          <FF label="Role *">
            <Select value={form.role} onChange={e=>setForm(f=>({...f,role:e.target.value, department_id:""}))}>
              <option value="" disabled>— Select role —</option>
              {/* Admin yahan nahi — naya user galti se admin na ban jaye.  Zaroorat ho
                  to user banao phir table me role dropdown se Admin kar do. */}
              {ROLE_OPTIONS.filter(r => r.value !== "admin").map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
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
