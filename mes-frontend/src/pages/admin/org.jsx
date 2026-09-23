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
  const { token, user: me } = useAuth();
  const [users,       setUsers]       = useState([]);
  const [khoj,        setKhoj]        = useState("");   // username se dhoondho
  const [lines,       setLines]       = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [modal,       setModal]       = useState(false);
  const [assignModal, setAssignModal] = useState(null);
  const [form,        setForm]        = useState({
    username:"", password:"", role:"", department_id:"", emp_code:"",
  });
  /* Employee ID list me hi bhara ja sake (user 2026-09-23: "ek baar tum do,
     abhi main sab me daal deta hu").  Jo khaana abhi type ho raha hai wahi
     yahan rehta hai; Enter ya bahar click karte hi save. */
  const [codeDraft, setCodeDraft] = useState({});
  /* Username bhi list me hi badal sake (user 2026-09-23: "admin ke paas access
     do ki username change kar sake").  Wahi tareeqa jo Emp ID ka hai. */
  const [nameDraft, setNameDraft] = useState({});
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
    const code  = form.emp_code.trim().toUpperCase();
    if (!uname||!form.password) { toast("Username and password required","err"); return; }
    if (!form.role) { toast("Select a role","err"); return; }
    /* Employee ID naye user par ZAROORI (user 2026-09-23) -- isi se Attendance
       ka aadmi aur app ka user jude rehte hain.  Server bhi yahi rokta hai. */
    if (!code) { toast("Employee ID is required","err"); return; }
    // Duplicate username — frontend pe turant rok (backend bhi 400 deta hai).
    if (users.some(u => (u.username||"").toLowerCase() === uname.toLowerCase())) {
      toast("Username already exists — pick another","err"); return;
    }
    const dohra = users.find(u => (u.emp_code||"").toUpperCase() === code);
    if (dohra) { toast(`Employee ID ${code} already used by "${dohra.username}"`,"err"); return; }
    setSaving(true);
    try {
      const body = { username: uname, password: form.password, role: form.role, emp_code: code };
      await api.post("/api/users/", body, token);
      toast("User created ✓");
      setModal(false);
      setForm({ username:"", password:"", role:"", department_id:"", emp_code:"" });
      load();
    }
    catch(e) { toast(e.message,"err"); }
    finally { setSaving(false); }
  };

  /* List me se username badalna.  ⚠ Jiska naam badla uska chalu token turant
     bekaar ho jaata hai (token me purana naam hai) -- wo apne aap logout ho
     jaayega.  Isliye apne hi naam par pehle poochhte hain. */
  const saveName = async (u) => {
    const naya = (nameDraft[u.id] ?? "").trim();
    setNameDraft(d => { const n = { ...d }; delete n[u.id]; return n; });
    if (!naya || naya === u.username) return;
    if (u.username === me?.username &&
        !confirm(`Change your own username to "${naya}"? You will be signed out.`)) return;
    try {
      await api.put(`/api/users/${u.id}/username`, { username: naya }, token);
      toast(`Username changed to ${naya} ✓`);
      load();
    } catch(e) { toast(e.message,"err"); load(); }
  };

  /* List me se Employee ID bharna / badalna. */
  const saveCode = async (u) => {
    const naya = (codeDraft[u.id] ?? "").trim().toUpperCase();
    setCodeDraft(d => { const n = { ...d }; delete n[u.id]; return n; });
    if (naya === (u.emp_code || "").toUpperCase()) return;      // kuch badla hi nahi
    try {
      await api.put(`/api/users/${u.id}/role`, { emp_code: naya }, token);
      toast(naya ? `Employee ID ${naya} saved ✓` : "Employee ID cleared");
      load();
    } catch(e) { toast(e.message,"err"); load(); }
  };

  const deleteUser = async (u) => {
    if (!confirm(`Delete user "${u.username}"?`)) return;
    try { await api.delete(`/api/users/${u.id}`, token); toast("User deleted"); load(); }
    catch(e) { toast(e.message,"err"); }
  };

  const resetPassword = async (u) => {
    const pw = prompt(`New password for "${u.username}":`);
    if (pw == null) return;                       // cancel dabaya
    if (!pw.trim()) { toast("Password cannot be empty","err"); return; }
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

  // Group items + unke nested children ko ek flat list me (parent, phir sub-pages `_child` mark ke saath).
  const flatItems = (items) => items.flatMap(it =>
    it.children ? [it, ...it.children.map(c => ({ ...c, _child: true }))] : [it]);

  const setAllInGroup = (groupItems, level) => {
    setPermMap(p => {
      const n = { ...p };
      for (const it of flatItems(groupItems)) n[it.key] = level;
      return n;
    });
  };

  /* Search: username, role ya ID -- teeno se.  Sirf username se karte to
     "supervisor" dhoondhne par kuch na milta, aur admin ko aksar role se hi
     dhoondhna hota hai. */
  const dikhneWale = users.filter(u => {
    const q = khoj.trim().toLowerCase();
    if (!q) return true;
    return [u.username, u.role, String(u.id)]
      .some(v => String(v ?? "").toLowerCase().includes(q));
  });

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
      {/* Search baayein, "+ Add User" daayein.  `flexWrap` isliye ki tang
          screen par dono ek doosre par na chadhein -- neeche chale jayein. */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
                    gap:12, flexWrap:"wrap", marginBottom:20 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, flex:"1 1 220px", minWidth:0 }}>
          <input value={khoj} onChange={e=>setKhoj(e.target.value)}
                 placeholder="Search by username, role or ID…"
                 style={{ ...inputStyle, flex:"1 1 auto", minWidth:0, maxWidth:340 }} />
          {khoj && (
            <Btn onClick={()=>setKhoj("")}>Clear</Btn>
          )}
        </div>
        <Btn variant="primary" onClick={()=>setModal(true)}>+ Add User</Btn>
      </div>
      <Card>
        {loading ? <Spinner /> : dikhneWale.length===0 ? (
          <EmptyState text={users.length ? `No user matches \u201c${khoj}\u201d` : "No users"} />
        ) : (
          /* ⚠ Ye scroll wala dabba ZAROORI hai.  Table me chhe column hain
             (ID / Username / Role / Password / Last Login / Actions) aur ye
             card ke bahar nikal jaati thi -- Password aur uske aage ka hissa
             screen se BAHAR chala jaata tha aur wahan pahunchne ka koi
             raasta hi nahi tha.  Ab table apni chaudai le sakti hai aur
             card ke andar hi daayein-baayein khisakti hai. */
          <div style={{ overflowX:"auto", WebkitOverflowScrolling:"touch" }}>
          {/* `ap-users` = phone par har qatar ek chhota card ban jaati hai
              (responsive.css dekho).  Chhe column 640px maangte hain aur
              phone ke card me ~260px hi hote hain -- sirf daayein-baayein
              khiskana kaafi nahi tha. */}
          <table className="ap-stack" style={{ width:"100%", minWidth:640, borderCollapse:"collapse", fontSize:13 }}>
            <thead>
              <tr>{["ID","Username","Emp ID","Role","Password","Last Login","Actions"].map(h=>(
                <th key={h} style={{ padding:"10px 14px", textAlign:"left", fontSize:10, fontWeight:700, letterSpacing:".08em", textTransform:"uppercase", color:"#64748b", borderBottom:"2px solid #e2e8f0" }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {dikhneWale.map(u=>{
                const rp = ROLE_PILL[u.role] || {};
                return (
                <tr key={u.id} style={{ borderBottom:"1px solid #f1f5f9" }}>
                  <td data-lbl="ID" style={{ padding:"12px 14px", fontFamily:"monospace", color:"#64748b" }}>{u.id}</td>
                  {/* Username yahin badal sakte hain (Enter/blur = save, Esc = chhodo). */}
                  <td className="an-stk-hdr" style={{ padding:"12px 14px", fontWeight:600, color:"#0f172a" }}>
                    <input
                      value={nameDraft[u.id] ?? (u.username || "")}
                      onChange={e=>setNameDraft(d=>({ ...d, [u.id]: e.target.value }))}
                      onBlur={()=>{ if (nameDraft[u.id] !== undefined) saveName(u); }}
                      onKeyDown={e=>{ if (e.key === "Enter") e.currentTarget.blur();
                                      if (e.key === "Escape") setNameDraft(d=>{ const n={...d}; delete n[u.id]; return n; }); }}
                      maxLength={80} readOnly={readOnly} title="Login name — can be changed"
                      style={{ ...inputStyle, padding:"4px 8px", fontSize:13, width:130, fontWeight:600 }} />
                  </td>
                  {/* Employee ID -- yahin bhar do (Enter ya bahar click = save).
                      Attendance ka Add Member isi code se aadmi uthata hai. */}
                  <td data-lbl="Emp ID" style={{ padding:"12px 14px" }}>
                    <input
                      value={codeDraft[u.id] ?? (u.emp_code || "")}
                      onChange={e=>setCodeDraft(d=>({ ...d, [u.id]: e.target.value }))}
                      onBlur={()=>{ if (codeDraft[u.id] !== undefined) saveCode(u); }}
                      onKeyDown={e=>{ if (e.key === "Enter") e.currentTarget.blur();
                                      if (e.key === "Escape") setCodeDraft(d=>{ const n={...d}; delete n[u.id]; return n; }); }}
                      placeholder="—" maxLength={40} readOnly={readOnly}
                      style={{ ...inputStyle, padding:"4px 8px", fontSize:12, width:90,
                               fontFamily:"monospace",
                               ...(u.emp_code ? {} : { borderColor:"#fca5a5", background:"#fef2f2" }) }} />
                  </td>
                  <td data-lbl="Role" style={{ padding:"12px 14px" }}>
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
                  <td data-lbl="Password" style={{ padding:"12px 14px" }}>
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
                      <span style={{ color:"#cbd5e1", fontStyle:"italic", fontSize:12 }}>Set via Reset PW</span>
                    )}
                  </td>
                  <td data-lbl="Last Login" style={{ padding:"12px 14px", fontFamily:"monospace", fontSize:11, color:"#64748b" }}>{u.last_login?new Date(u.last_login).toLocaleString("en-IN"):"Never"}</td>
                  <td style={{ padding:"12px 14px" }}>
                    <div className="ap-act" style={{ display:"flex", gap:8 }}>
                      <Btn size="sm" onClick={()=>resetPassword(u)}>Reset PW</Btn>
                      {u.username!=="admin" && <Btn size="sm" onClick={()=>openPerms(u)}>Permissions</Btn>}
                      {u.username!=="admin" && <Btn size="sm" variant="danger" onClick={()=>deleteUser(u)}>Delete</Btn>}
                    </div>
                  </td>
                </tr>
              );})}
            </tbody>
          </table>
          </div>
        )}
      </Card>

      <Modal open={modal} onClose={()=>setModal(false)} title="Add User">
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
          <FF label="Username *"><Input value={form.username} onChange={e=>setForm(f=>({...f,username:e.target.value}))} placeholder="login id"
                                        name="mes-new-username" autoComplete="off" /></FF>
          {/* Employee ID ZAROORI -- Attendance ka Add Member isi se aadmi
              uthata hai, aur aage buzz bhi isi rishte par chalega. */}
          <FF label="Employee ID *" hint="Attendance → Add Member picks the person by this code.">
            <Input value={form.emp_code} onChange={e=>setForm(f=>({...f,emp_code:e.target.value}))}
                   placeholder="e.g. 487" name="mes-new-empcode" autoComplete="off" />
          </FF>
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

            {/* ── SABSE UPAR: ANDON ki khabar ──────────────────
                Ye page ki permission NAHI hai -- ye "is bande ke phone par
                ANDON call ka popup/beep aayega ya nahi" hai.  Isliye groups
                se alag, aur sabse upar.

                ⚠ Khali chhodne ka matlab yahan ON hai (baaki permissions me
                khali = band).  ANDON madad bulane ka system hai; agar khali
                ka matlab band hota to is update ke baad sabki khabar chup-chaap
                band ho jaati. */}
            <div style={{ border:"1px solid #fcd34d", background:"#fffbeb",
                          borderRadius:10, padding:"12px 14px", marginBottom:18 }}>
              <div style={{ display:"flex", alignItems:"center", gap:12, flexWrap:"wrap" }}>
                <div style={{ flex:"1 1 260px", minWidth:0 }}>
                  <div style={{ fontSize:13, fontWeight:800, color:"#92400e" }}>
                    ANDON call notification
                  </div>
                  <div style={{ fontSize:11.5, color:"#78350f", lineHeight:1.5, marginTop:2 }}>
                    When a maintenance ANDON call comes in, this user gets the red
                    popup, the beep, and (in the phone app) a vibration — on
                    whatever screen they are on. Turn it off for people who should
                    not be called.
                  </div>
                </div>
                <div style={{ display:"flex", gap:6, flex:"0 0 auto" }}>
                  {[{ k:"full", t:"Gets it",     bg:"#dcfce7", fg:"#15803d", br:"#86efac" },
                    { k:"none", t:"No notification", bg:"#fee2e2", fg:"#b91c1c", br:"#fca5a5" }].map(o => {
                    const abhi = permMap["andon-alert"] === "none" ? "none" : "full";
                    const on = abhi === o.k;
                    return (
                      <button key={o.k}
                              onClick={() => setPermMap(m => ({ ...m, "andon-alert": o.k }))}
                              style={{ fontSize:11.5, fontWeight:800, padding:"7px 14px",
                                       borderRadius:99, cursor:"pointer",
                                       border:`1px solid ${on ? o.br : "#e2e8f0"}`,
                                       background: on ? o.bg : "#fff",
                                       color: on ? o.fg : "#94a3b8" }}>
                        {on ? "✓ " : ""}{o.t}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

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
                {flatItems(g.items).map(it => {
                  const cur = permMap[it.key] || "none";
                  return (
                    <div key={it.key} className="perm-row" style={{
                      display:"grid",
                      gridTemplateColumns:"1fr auto auto auto",
                      gap:8, alignItems:"center",
                      padding:"6px 0",
                      paddingLeft: it._child ? 26 : 0,
                      background: it._child ? "#fbfcfe" : undefined,
                      borderBottom:"1px solid #f1f5f9",
                    }}>
                      <div>
                        <div style={{ fontSize: it._child ? 12.5 : 13,
                                       fontWeight: it._child ? 500 : 600,
                                       color: it._child ? "#475569" : "#0f172a" }}>
                          {it._child ? "└ " : ""}{it.label}
                        </div>
                        <div style={{ fontSize:10, color:"#94a3b8",
                                       fontFamily:"monospace" }}>
                          {it.key}
                        </div>
                      </div>
                      {/* Teeno button ek dabbe me -- phone par qatar ek hi
                          column ki ho jaati hai, aur bina iske teeno alag-alag
                          line par chale jaate (ek permission = chaar line). */}
                      <div className="perm-btns" style={{ display:"contents" }}>
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
