/* admin/masters.jsx — Plants · Zones · Lines · Status master pages. */
import { useState, useEffect, useRef, useCallback, useMemo, Fragment } from "react";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../api/client";
import {
  PageHeading, Card, Pill, Btn, FF, Input, Select,
  Modal, ModalActions, Toast, EmptyState, Spinner, ExcelImportButton,
  inputStyle,
} from "./ui";

export function PlantsPage({ toast, readOnly = false }) {
  const { token } = useAuth();
  const [plants,  setPlants]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal,   setModal]   = useState(false);
  const [editing, setEditing] = useState(null);
  const [form,    setForm]    = useState({ plant_code: "", plant_name: "", location: "", timezone: "Asia/Kolkata" });
  const [saving,  setSaving]  = useState(false);

  const load = useCallback(async () => {
    try { setPlants(await api.get("/api/plants/", token)); }
    catch { toast("Failed to load plants", "err"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const openAdd = () => {
    setEditing(null);
    setForm({ plant_code: "", plant_name: "", location: "", timezone: "Asia/Kolkata" });
    setModal(true);
  };

  const openEdit = (p) => {
    setEditing(p);
    setForm({ plant_code: p.plant_code, plant_name: p.plant_name, location: p.location || "", timezone: p.timezone || "Asia/Kolkata" });
    setModal(true);
  };

  const save = async () => {
    if (!form.plant_code || !form.plant_name) { toast("Code and name required", "err"); return; }
    setSaving(true);
    try {
      if (editing) {
        await api.put(`/api/plants/${editing.id}`, { plant_name: form.plant_name, location: form.location, timezone: form.timezone }, token);
        toast("Plant updated ✓");
      } else {
        await api.post("/api/plants/", form, token);
        toast("Plant created ✓");
      }
      setModal(false); load();
    } catch (e) { toast(e.message, "err"); }
    finally { setSaving(false); }
  };

  const deactivate = async (p) => {
    if (!confirm(`Deactivate plant "${p.plant_name}"?`)) return;
    try { await api.delete(`/api/plants/${p.id}`, token); toast("Plant deactivated"); load(); }
    catch (e) { toast(e.message, "err"); }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 20 }}>
        <Btn variant="primary" onClick={openAdd}>+ Add Plant</Btn>
      </div>
      <Card>
        {loading ? <Spinner /> : plants.length === 0 ? <EmptyState text="No plants yet" sub="Add your first plant to get started" /> : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>{["Code", "Name", "Location", "Lines", "Status", "Actions"].map(h => (
                <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "#64748b", borderBottom: "2px solid #e2e8f0" }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {plants.map(p => (
                <tr key={p.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "12px 14px", fontFamily: "monospace", fontWeight: 700, color: "#1e40af" }}>{p.plant_code}</td>
                  <td style={{ padding: "12px 14px", fontWeight: 600, color: "#0f172a" }}>{p.plant_name}</td>
                  <td style={{ padding: "12px 14px", color: "#64748b" }}>{p.location || "—"}</td>
                  <td style={{ padding: "12px 14px", fontFamily: "monospace" }}>{p.total_lines || 0}</td>
                  <td style={{ padding: "12px 14px" }}><Pill label={p.is_active ? "Active" : "Inactive"} color={p.is_active ? "green" : "gray"} /></td>
                  <td style={{ padding: "12px 14px" }}>
                    <div style={{ display: "flex", gap: 8 }}>
                      <Btn size="sm" onClick={() => openEdit(p)}>Edit</Btn>
                      <Btn size="sm" variant="danger" onClick={() => deactivate(p)}>Deactivate</Btn>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Modal open={modal} onClose={() => setModal(false)} title={editing ? `Edit — ${editing.plant_name}` : "Add Plant"}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <FF label="Plant Code *">
            <Input value={form.plant_code} onChange={e => setForm(f => ({ ...f, plant_code: e.target.value }))} placeholder="TBI-BHW" disabled={!!editing} />
          </FF>
          <FF label="Plant Name *">
            <Input value={form.plant_name} onChange={e => setForm(f => ({ ...f, plant_name: e.target.value }))} placeholder="Toyota Boshoku..." />
          </FF>
          <FF label="Location">
            <Input value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} placeholder="City, State" />
          </FF>
          <FF label="Timezone">
            <Input value={form.timezone} onChange={e => setForm(f => ({ ...f, timezone: e.target.value }))} />
          </FF>
        </div>
        <ModalActions>
          <Btn onClick={() => setModal(false)}>Cancel</Btn>
          <Btn variant="primary" onClick={save} disabled={saving}>{saving ? "Saving…" : editing ? "Save Changes" : "Create Plant"}</Btn>
        </ModalActions>
      </Modal>
    </div>
  );
}

// ─── ZONES PAGE ───────────────────────────────────────────────
export function ZonesPage({ toast, readOnly = false }) {
  const { token } = useAuth();
  const [zones,      setZones]      = useState([]);
  const [plants,     setPlants]     = useState([]);
  const [lines,      setLines]      = useState([]);
  const [loading,    setLoading]    = useState(true);

  // Wizard modal
  const [wizOpen,    setWizOpen]    = useState(false);
  const [wizZone,    setWizZone]    = useState(null);   // null = new zone being created
  const [subPage,    setSubPage]    = useState(0);
  const [saving,     setSaving]     = useState(false);
  const [subLoading, setSubLoading] = useState(false);

  // Sub-page data
  const [infoForm,   setInfoForm]   = useState({ plant_id: "", zone_code: "", zone_name: "", description: "" });
  const [selLines,   setSelLines]   = useState([]);
  const [shifts,     setShifts]     = useState([]);
  const [breaks,     setBreaks]     = useState([]);
  const [slotShift,  setSlotShift]  = useState("A");
  const [slots,      setSlots]      = useState([]);
  const [zoneModels, setZoneModels] = useState([]);
  const [machines,   setMachines]   = useState([]);

  const SUB_LABELS = ["① Zone Info", "② Lines", "③ Shifts & Breaks", "④ Hourly Slots", "⑤ Models", "⑥ Machines"];

  // ── Helpers ───────────────────────────────────────────────

  function defaultShifts() {
    return [
      { shift_name:"A",      start_time:"08:30", end_time:"17:15", crosses_midnight:false, total_plan:1860, working_minutes:465, startup_delay_min:5, is_production:true,  ot_enabled:false, ot_end_time:"" },
      { shift_name:"B",      start_time:"18:30", end_time:"03:15", crosses_midnight:true,  total_plan:1860, working_minutes:465, startup_delay_min:5, is_production:true,  ot_enabled:false, ot_end_time:"" },
      { shift_name:"GAP_AB", start_time:"17:15", end_time:"18:30", crosses_midnight:false, total_plan:0,    working_minutes:0,   startup_delay_min:0, is_production:false, ot_enabled:false, ot_end_time:"" },
      { shift_name:"GAP_BA", start_time:"03:15", end_time:"08:30", crosses_midnight:false, total_plan:0,    working_minutes:0,   startup_delay_min:0, is_production:false, ot_enabled:false, ot_end_time:"" },
    ];
  }

  function defaultBreaks() {
    return [
      { break_name:"Morning Tea Break",   start_time:"10:00", end_time:"10:10", crosses_midnight:false, applies_to_shifts:"A"   },
      { break_name:"Lunch Break",         start_time:"12:00", end_time:"12:35", crosses_midnight:false, applies_to_shifts:"A"   },
      { break_name:"Evening Tea Break",   start_time:"14:30", end_time:"14:40", crosses_midnight:false, applies_to_shifts:"A"   },
      { break_name:"Dinner Break 1",      start_time:"18:00", end_time:"18:10", crosses_midnight:false, applies_to_shifts:"B"   },
      { break_name:"Tea Break",           start_time:"20:00", end_time:"20:10", crosses_midnight:false, applies_to_shifts:"B"   },
      { break_name:"Dinner Break 2",      start_time:"22:00", end_time:"22:35", crosses_midnight:false, applies_to_shifts:"B"   },
      { break_name:"Night Tea Break",     start_time:"01:00", end_time:"01:10", crosses_midnight:true,  applies_to_shifts:"B"   },
      { break_name:"Early Morning Break", start_time:"04:00", end_time:"04:10", crosses_midnight:true,  applies_to_shifts:"B"   },
    ];
  }

  // ── Data loading ─────────────────────────────────────────

  const load = useCallback(async () => {
    try {
      const [z, p, l] = await Promise.all([
        api.get("/api/zones/", token),
        api.get("/api/plants/", token),
        api.get("/api/lines/", token),
      ]);
      setZones(Array.isArray(z) ? z : []);
      setPlants(Array.isArray(p) ? p : []);
      setLines(Array.isArray(l) ? l : []);
    } catch { toast("Failed to load", "err"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const loadShifts = async (zoneId) => {
    try {
      const s = await api.get(`/api/zones/${zoneId}/shifts`, token);
      if (Array.isArray(s) && s.length) {
        setShifts(s.map(x => ({
          shift_name: x.shift_name, start_time: x.start_time?.slice(0,5)||"",
          end_time: x.end_time?.slice(0,5)||"", crosses_midnight: x.crosses_midnight||false,
          total_plan: x.total_plan||0, working_minutes: x.working_minutes||0,
          startup_delay_min: x.startup_delay_min||5, is_production: x.is_production!==false,
          ot_enabled: x.ot_enabled||false, ot_end_time: x.ot_end_time?.slice(0,5)||"",
        })));
      } else { setShifts(defaultShifts()); }
    } catch { setShifts(defaultShifts()); }
  };

  const loadBreaks = async (zoneId) => {
    try {
      const b = await api.get(`/api/zones/${zoneId}/breaks`, token);
      if (Array.isArray(b) && b.length) {
        setBreaks(b.map(x => ({
          break_name: x.break_name, start_time: x.start_time?.slice(0,5)||"",
          end_time: x.end_time?.slice(0,5)||"", crosses_midnight: x.crosses_midnight||false,
          applies_to_shifts: x.applies_to_shifts||"A,B",
        })));
      } else { setBreaks(defaultBreaks()); }
    } catch { setBreaks(defaultBreaks()); }
  };

  const loadSlots = async (zoneId, shiftName) => {
    if (!zoneId) return;
    setSubLoading(true);
    try {
      const s = await api.get(`/api/zones/${zoneId}/hourly-slots?shift_name=${shiftName}`, token);
      setSlots(Array.isArray(s) ? s.map(x => ({
        shift_name: x.shift_name, slot_label: x.slot_label,
        start_time: x.start_time?.slice(0,5)||"", end_time: x.end_time?.slice(0,5)||"",
        crosses_midnight: x.crosses_midnight||false,
        working_minutes: x.working_minutes, plan_pieces: x.plan_pieces, slot_order: x.slot_order,
      })) : []);
    } catch { setSlots([]); }
    finally { setSubLoading(false); }
  };

  const loadModels = async (zoneId) => {
    setSubLoading(true);
    try {
      const m = await api.get(`/api/zones/${zoneId}/models`, token);
      setZoneModels(Array.isArray(m) ? m : []);
    } catch { setZoneModels([]); }
    finally { setSubLoading(false); }
  };

  const loadMachines = async (zoneId) => {
    setSubLoading(true);
    try {
      const m = await api.get(`/api/zones/${zoneId}/machines`, token);
      setMachines(Array.isArray(m) ? m : []);
    } catch { setMachines([]); }
    finally { setSubLoading(false); }
  };

  // ── Open wizard ───────────────────────────────────────────

  const openAdd = () => {
    setWizZone(null); setSubPage(0);
    setInfoForm({ plant_id: plants[0]?.id||"", zone_code:"", zone_name:"", description:"" });
    setSelLines([]); setShifts(defaultShifts()); setBreaks(defaultBreaks());
    setSlots([]); setZoneModels([]); setMachines([]);
    setWizOpen(true);
  };

  const openConfigure = (zone) => {
    setWizZone(zone); setSubPage(0);
    setInfoForm({ plant_id:zone.plant_id, zone_code:zone.zone_code, zone_name:zone.zone_name, description:zone.description||"" });
    setSelLines(lines.filter(l => String(l.zone_id) === String(zone.id)).map(l => l.id));
    loadShifts(zone.id); loadBreaks(zone.id);
    setSlots([]); setZoneModels([]); setMachines([]);
    setWizOpen(true);
  };

  const handleSubPage = (page) => {
    setSubPage(page);
    if (!wizZone) return;
    if (page === 3) loadSlots(wizZone.id, slotShift);
    if (page === 4) loadModels(wizZone.id);
    if (page === 5) loadMachines(wizZone.id);
  };

  // ── Save functions ────────────────────────────────────────

  const saveInfo = async () => {
    if (!infoForm.zone_code || !infoForm.zone_name || !infoForm.plant_id) { toast("All fields required", "err"); return; }
    setSaving(true);
    try {
      if (wizZone) {
        await api.put(`/api/zones/${wizZone.id}`, { zone_name:infoForm.zone_name, description:infoForm.description }, token);
        setWizZone(prev => ({ ...prev, zone_name:infoForm.zone_name, description:infoForm.description }));
        toast("Zone updated ✓");
      } else {
        const z = await api.post("/api/zones/", { plant_id:parseInt(infoForm.plant_id), zone_code:infoForm.zone_code, zone_name:infoForm.zone_name, description:infoForm.description }, token);
        setWizZone(z);
        toast("Zone created ✓");
      }
      load(); setSubPage(1);
    } catch (e) { toast(e.message, "err"); }
    finally { setSaving(false); }
  };

  const saveLines = async () => {
    if (!wizZone) { toast("Create zone first", "err"); return; }
    setSaving(true);
    try {
      const current = lines.filter(l => String(l.zone_id) === String(wizZone.id)).map(l => l.id);
      for (const id of selLines) { if (!current.includes(id)) await api.post(`/api/zones/${wizZone.id}/lines/${id}`, {}, token); }
      for (const id of current)  { if (!selLines.includes(id)) await api.delete(`/api/zones/${wizZone.id}/lines/${id}`, token); }
      toast("Lines saved ✓"); load();
      await loadShifts(wizZone.id); await loadBreaks(wizZone.id);
      setSubPage(2);
    } catch (e) { toast(e.message, "err"); }
    finally { setSaving(false); }
  };

  const saveShiftsBreaks = async () => {
    if (!wizZone) { toast("Create zone first", "err"); return; }
    const validShifts = shifts.filter(s => s.shift_name && s.start_time && s.end_time);
    if (!validShifts.length) { toast("Add at least one shift", "err"); return; }
    setSaving(true);
    try {
      await api.put(`/api/zones/${wizZone.id}/shifts`, validShifts.map(s => ({ ...s, ot_end_time: s.ot_end_time || null })), token);
      const validBreaks = breaks.filter(b => b.break_name && b.start_time && b.end_time);
      await api.put(`/api/zones/${wizZone.id}/breaks`, validBreaks, token);
      toast("Shifts & Breaks saved ✓");
    } catch (e) { toast(e.message, "err"); }
    finally { setSaving(false); }
  };

  const toggleOT = async (shiftName, enabled, otEnd) => {
    if (!wizZone) return;
    try {
      await api.put(`/api/zones/${wizZone.id}/shifts/${shiftName}/ot`, { ot_enabled:enabled, ot_end_time: enabled ? otEnd||null : null }, token);
      toast(`OT ${enabled ? "enabled" : "disabled"} for Shift ${shiftName} ✓`);
    } catch (e) { toast(e.message, "err"); }
  };

  const saveSlots = async () => {
    if (!wizZone) return;
    setSaving(true);
    try {
      await api.put(`/api/zones/${wizZone.id}/hourly-slots`, slots.filter(s => s.slot_label && s.start_time && s.end_time), token);
      toast("Hourly slots saved ✓");
    } catch (e) { toast(e.message, "err"); }
    finally { setSaving(false); }
  };

  const deactivate = async (z) => {
    if (!confirm(`Deactivate zone "${z.zone_name}"? All lines will be unassigned.`)) return;
    try { await api.delete(`/api/zones/${z.id}`, token); toast("Zone deactivated"); load(); }
    catch (e) { toast(e.message, "err"); }
  };

  // ── Field mutators ────────────────────────────────────────

  const setShiftFld  = (i, k, v) => setShifts(prev  => { const a=[...prev];  a[i]={...a[i],[k]:v}; return a; });
  const setBreakFld  = (i, k, v) => setBreaks(prev  => { const a=[...prev];  a[i]={...a[i],[k]:v}; return a; });
  const setSlotFld   = (i, k, v) => setSlots(prev   => { const a=[...prev];  a[i]={...a[i],[k]:v}; return a; });
  const addBreak  = () => setBreaks(prev  => [...prev,  { break_name:"", start_time:"", end_time:"", crosses_midnight:false, applies_to_shifts:"A" }]);
  const rmBreak   = (i)=> setBreaks(prev  => prev.filter((_,j)=>j!==i));
  const addSlot   = () => setSlots(prev   => [...prev,  { shift_name:slotShift, slot_label:"", start_time:"", end_time:"", crosses_midnight:false, working_minutes:60, plan_pieces:240, slot_order:prev.length+1 }]);
  const rmSlot    = (i)=> setSlots(prev   => prev.filter((_,j)=>j!==i));

  // ── Sub-page renderers ────────────────────────────────────

  const miniInp = { ...inputStyle, padding:"7px 9px", fontSize:12 };

  const renderInfo = () => (
    <div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
        <FF label="Plant *">
          <Select value={infoForm.plant_id} onChange={e=>setInfoForm(f=>({...f,plant_id:e.target.value}))} disabled={!!wizZone}>
            <option value="">Select plant…</option>
            {plants.map(p=><option key={p.id} value={p.id}>{p.plant_name}</option>)}
          </Select>
        </FF>
        <FF label="Zone Code *">
          <Input value={infoForm.zone_code} onChange={e=>setInfoForm(f=>({...f,zone_code:e.target.value}))} placeholder="ZONE-1" disabled={!!wizZone}/>
        </FF>
        <FF label="Zone Name *">
          <Input value={infoForm.zone_name} onChange={e=>setInfoForm(f=>({...f,zone_name:e.target.value}))} placeholder="e.g. Assembly Line A"/>
        </FF>
        <FF label="Description">
          <Input value={infoForm.description} onChange={e=>setInfoForm(f=>({...f,description:e.target.value}))} placeholder="Optional"/>
        </FF>
      </div>
      <ModalActions>
        <Btn onClick={()=>setWizOpen(false)}>Cancel</Btn>
        <Btn variant="primary" onClick={saveInfo} disabled={saving}>
          {saving ? "Saving…" : wizZone ? "Update & Next →" : "Create Zone & Next →"}
        </Btn>
      </ModalActions>
    </div>
  );

  const renderLines = () => (
    <div>
      <p style={{ fontSize:13, color:"#64748b", marginBottom:16 }}>
        Select lines to assign to this zone. A line can only belong to one zone.
      </p>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))", gap:10, maxHeight:300, overflowY:"auto", marginBottom:16 }}>
        {lines.map(l => {
          const checked   = selLines.includes(l.id);
          const otherZone = l.zone_id && String(l.zone_id) !== String(wizZone?.id);
          return (
            <label key={l.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px", borderRadius:8, cursor:"pointer", background:checked?"rgba(30,64,175,.06)":"#f8fafc", border:`1px solid ${checked?"rgba(30,64,175,.25)":"#e2e8f0"}`, transition:"all .12s" }}>
              <input type="checkbox" checked={checked} onChange={()=>setSelLines(prev=>prev.includes(l.id)?prev.filter(x=>x!==l.id):[...prev,l.id])} style={{ width:15,height:15,accentColor:"#1e40af" }}/>
              <div>
                <div style={{ fontSize:13,fontWeight:600,color:"#0f172a" }}>{l.line_name}</div>
                <div style={{ fontSize:10,color:"#94a3b8" }}>
                  {l.line_code}
                  {otherZone && <span style={{ color:"#d97706",marginLeft:6 }}>· other zone</span>}
                </div>
              </div>
            </label>
          );
        })}
      </div>
      <ModalActions>
        <Btn onClick={()=>setSubPage(0)}>← Back</Btn>
        <Btn variant="primary" onClick={saveLines} disabled={saving||!wizZone}>
          {saving ? "Saving…" : "Save Lines & Next →"}
        </Btn>
      </ModalActions>
    </div>
  );

  const addShift = () => setShifts(prev => {
    const existingNames = prev.map(s => s.shift_name);
    // suggest next letter not already used
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").filter(l => !existingNames.includes(l));
    const name = letters[0] || `SHIFT${prev.filter(s=>s.is_production).length + 1}`;
    return [...prev, { shift_name:name, start_time:"", end_time:"", crosses_midnight:false, total_plan:0, working_minutes:0, startup_delay_min:5, is_production:true, ot_enabled:false, ot_end_time:"" }];
  });

  const addGap = () => setShifts(prev => {
    const existingNames = prev.map(s => s.shift_name);
    const name = `GAP_${Date.now().toString().slice(-4)}`;
    return [...prev, { shift_name:name, start_time:"", end_time:"", crosses_midnight:false, total_plan:0, working_minutes:0, startup_delay_min:0, is_production:false, ot_enabled:false, ot_end_time:"" }];
  });

  const rmShift = (shiftName) => setShifts(prev => prev.filter(s => s.shift_name !== shiftName));

  const renderShiftsBreaks = () => {
    const prodShifts = shifts.filter(s=>s.is_production);
    const gapShifts  = shifts.filter(s=>!s.is_production);

    // build dynamic shift name options for break applies_to dropdown
    const shiftOptions = prodShifts.map(s=>s.shift_name);
    const shiftOptionPairs = [
      ...shiftOptions.map(n => ({ value:n, label:`Shift ${n}` })),
      ...shiftOptions.length > 1 ? [{ value: shiftOptions.join(","), label:"All Shifts" }] : [],
    ];

    return (
      <div style={{ maxHeight:"65vh", overflowY:"auto", paddingRight:4 }}>
        {/* Production Shifts header */}
        <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12 }}>
          <div style={{ fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"#64748b" }}>Production Shifts</div>
          <Btn size="sm" onClick={addShift}>+ Add Shift</Btn>
        </div>

        {prodShifts.map(sh => {
          const idx = shifts.findIndex(s=>s.shift_name===sh.shift_name);
          const isDefaultAB = sh.shift_name==="A" || sh.shift_name==="B";
          return (
            <div key={sh.shift_name} style={{ background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:10,padding:14,marginBottom:12 }}>
              {/* Header row */}
              <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12 }}>
                <div style={{ display:"flex",alignItems:"center",gap:10 }}>
                  {/* Editable shift name */}
                  <div style={{ display:"flex",alignItems:"center",gap:6 }}>
                    <span style={{ fontSize:11,fontWeight:700,color:"#64748b" }}>SHIFT</span>
                    <input
                      value={sh.shift_name}
                      onChange={e => {
                        const newName = e.target.value.toUpperCase().replace(/\s/g,"");
                        // avoid duplicate names
                        if (newName && shifts.some((s,i)=>s.shift_name===newName && i!==idx)) return;
                        setShiftFld(idx,"shift_name",newName);
                      }}
                      disabled={isDefaultAB}
                      maxLength={10}
                      style={{ ...miniInp,width:70,fontWeight:800,fontSize:14,color:"#0f172a",textAlign:"center",padding:"4px 8px",...(isDefaultAB?{background:"#f1f5f9",color:"#64748b"}:{}) }}
                      title={isDefaultAB?"Default shifts A and B cannot be renamed":"Rename this shift"}
                    />
                  </div>
                  <label style={{ display:"flex",alignItems:"center",gap:5,fontSize:11,color:"#64748b" }}>
                    <input type="checkbox" checked={sh.crosses_midnight} onChange={e=>setShiftFld(idx,"crosses_midnight",e.target.checked)}/> crosses midnight
                  </label>
                </div>

                <div style={{ display:"flex",alignItems:"center",gap:10 }}>
                  {/* Remove button — only for non-default shifts */}
                  {!isDefaultAB && (
                    <button
                      onClick={()=>{ if(confirm(`Remove Shift ${sh.shift_name}?`)) rmShift(sh.shift_name); }}
                      title="Remove this shift"
                      style={{ background:"rgba(220,38,38,.08)",border:"1px solid rgba(220,38,38,.2)",color:"#dc2626",borderRadius:6,cursor:"pointer",fontSize:12,fontWeight:700,padding:"3px 8px" }}
                    >✕ Remove</button>
                  )}
                </div>
              </div>

              {/* Time / plan grid */}
              <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(105px,1fr))",gap:10 }}>
                <FF label="Start"><input type="time" value={sh.start_time} onChange={e=>setShiftFld(idx,"start_time",e.target.value)} style={miniInp}/></FF>
                <FF label="End"><input type="time" value={sh.end_time} onChange={e=>setShiftFld(idx,"end_time",e.target.value)} style={miniInp}/></FF>
                <FF label="Total Plan"><input type="number" min="0" value={sh.total_plan} onChange={e=>setShiftFld(idx,"total_plan",parseInt(e.target.value)||0)} style={miniInp}/></FF>
                <FF label="Working Min"><input type="number" min="0" value={sh.working_minutes} onChange={e=>setShiftFld(idx,"working_minutes",parseInt(e.target.value)||0)} style={miniInp}/></FF>
                <FF label="Startup Delay"><input type="number" min="0" value={sh.startup_delay_min} onChange={e=>setShiftFld(idx,"startup_delay_min",parseInt(e.target.value)||0)} style={miniInp}/></FF>
              </div>
            </div>
          );
        })}

        {/* Gap Periods */}
        <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",margin:"16px 0 10px" }}>
          <div style={{ fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"#64748b" }}>Gap Periods</div>
          <Btn size="sm" onClick={addGap}>+ Add Gap</Btn>
        </div>
        {gapShifts.length===0 && (
          <div style={{ fontSize:12,color:"#94a3b8",padding:"8px 0",marginBottom:8 }}>No gap periods defined.</div>
        )}
        {gapShifts.map(sh => {
          const idx = shifts.findIndex(s=>s.shift_name===sh.shift_name);
          const isDefaultGap = sh.shift_name==="GAP_AB" || sh.shift_name==="GAP_BA";
          return (
            <div key={sh.shift_name} style={{ display:"flex",alignItems:"center",gap:8,padding:"10px 14px",background:"#f8fafc",borderRadius:8,border:"1px solid #e2e8f0",marginBottom:8,flexWrap:"wrap" }}>
              {/* Editable gap name */}
              <input
                value={sh.shift_name}
                onChange={e=>{ const v=e.target.value.toUpperCase().replace(/\s/g,""); if(!shifts.some((s,i)=>s.shift_name===v&&i!==idx)) setShiftFld(idx,"shift_name",v); }}
                disabled={isDefaultGap}
                maxLength={12}
                style={{ ...miniInp,width:90,fontWeight:700,fontSize:12,color:"#64748b",textAlign:"center",...(isDefaultGap?{background:"#f1f5f9"}:{}) }}
              />
              <FF label="Start">
                <input type="time" value={sh.start_time} onChange={e=>setShiftFld(idx,"start_time",e.target.value)} style={{ ...miniInp,width:90 }}/>
              </FF>
              <FF label="End">
                <input type="time" value={sh.end_time} onChange={e=>setShiftFld(idx,"end_time",e.target.value)} style={{ ...miniInp,width:90 }}/>
              </FF>
              <label style={{ display:"flex",alignItems:"center",gap:4,fontSize:11,color:"#64748b",whiteSpace:"nowrap" }}>
                <input type="checkbox" checked={sh.crosses_midnight} onChange={e=>setShiftFld(idx,"crosses_midnight",e.target.checked)}/> midnight
              </label>
              {!isDefaultGap && (
                <button onClick={()=>rmShift(sh.shift_name)} style={{ background:"none",border:"none",color:"#dc2626",cursor:"pointer",fontSize:16,marginLeft:"auto" }}>✕</button>
              )}
            </div>
          );
        })}

        {/* Breaks */}
        <div style={{ fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"#64748b",margin:"20px 0 10px" }}>Breaks</div>
        {breaks.map((b,i) => (
          <div key={i} style={{ display:"flex",alignItems:"center",gap:8,marginBottom:8,flexWrap:"wrap" }}>
            <input placeholder="Break name" value={b.break_name} onChange={e=>setBreakFld(i,"break_name",e.target.value)} style={{ ...miniInp,flex:"2 1 140px" }}/>
            <input type="time" value={b.start_time} onChange={e=>setBreakFld(i,"start_time",e.target.value)} style={{ ...miniInp,width:90,flex:"0 0 90px" }}/>
            <input type="time" value={b.end_time}   onChange={e=>setBreakFld(i,"end_time",e.target.value)}   style={{ ...miniInp,width:90,flex:"0 0 90px" }}/>
            <select value={b.applies_to_shifts} onChange={e=>setBreakFld(i,"applies_to_shifts",e.target.value)} style={{ ...miniInp,flex:"0 0 100px" }}>
              {shiftOptionPairs.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
              <option value="A,B">All (A,B)</option>
            </select>
            <label style={{ display:"flex",alignItems:"center",gap:4,fontSize:11,color:"#64748b",whiteSpace:"nowrap" }}>
              <input type="checkbox" checked={b.crosses_midnight} onChange={e=>setBreakFld(i,"crosses_midnight",e.target.checked)}/> midnight
            </label>
            <button onClick={()=>rmBreak(i)} style={{ background:"none",border:"none",color:"#dc2626",cursor:"pointer",fontSize:18,padding:"0 2px" }}>✕</button>
          </div>
        ))}
        <Btn size="sm" onClick={addBreak} style={{ marginBottom:8 }}>+ Add Break</Btn>

        <ModalActions>
          <Btn onClick={()=>setSubPage(1)}>← Back</Btn>
          <Btn variant="primary" onClick={saveShiftsBreaks} disabled={saving||!wizZone}>
            {saving?"Saving…":"Save Shifts & Breaks ✓"}
          </Btn>
        </ModalActions>
      </div>
    );
  };

  const renderHourlySlots = () => (
    <div>
      <div style={{ display:"flex",alignItems:"flex-end",gap:12,marginBottom:16 }}>
        <FF label="Shift Filter">
          <Select value={slotShift} onChange={e=>{ setSlotShift(e.target.value); if(wizZone) loadSlots(wizZone.id,e.target.value); }} style={{ width:110 }}>
            <option value="A">Shift A</option>
            <option value="B">Shift B</option>
          </Select>
        </FF>
        <Btn size="sm" variant="primary" onClick={addSlot}>+ Add Slot</Btn>
      </div>

      {subLoading ? <Spinner /> : slots.length===0 ? (
        <EmptyState text="No hourly slots" sub={`No slots configured for Shift ${slotShift}. Click + Add Slot to begin.`}/>
      ) : (
        <div style={{ overflowX:"auto" }}>
          <div style={{ display:"grid",gridTemplateColumns:"1fr 90px 90px 90px 70px 60px 24px",gap:6,padding:"6px 4px",borderBottom:"2px solid #e2e8f0",marginBottom:6 }}>
            {["Slot Label","Start","End","Plan Pcs","Work Min","Order",""].map(h=>(
              <div key={h} style={{ fontSize:9,fontWeight:700,letterSpacing:".08em",textTransform:"uppercase",color:"#64748b" }}>{h}</div>
            ))}
          </div>
          {slots.map((s,i)=>(
            <div key={i} style={{ display:"grid",gridTemplateColumns:"1fr 90px 90px 90px 70px 60px 24px",gap:6,marginBottom:6,alignItems:"center" }}>
              <input value={s.slot_label} onChange={e=>setSlotFld(i,"slot_label",e.target.value)} placeholder="08:30-09:30" style={miniInp}/>
              <input type="time" value={s.start_time} onChange={e=>setSlotFld(i,"start_time",e.target.value)} style={miniInp}/>
              <input type="time" value={s.end_time}   onChange={e=>setSlotFld(i,"end_time",e.target.value)}   style={miniInp}/>
              <input type="number" min="0" value={s.plan_pieces}     onChange={e=>setSlotFld(i,"plan_pieces",parseInt(e.target.value)||0)}     style={miniInp}/>
              <input type="number" min="0" value={s.working_minutes} onChange={e=>setSlotFld(i,"working_minutes",parseInt(e.target.value)||0)} style={miniInp}/>
              <input type="number" min="0" value={s.slot_order}      onChange={e=>setSlotFld(i,"slot_order",parseInt(e.target.value)||0)}      style={miniInp}/>
              <button onClick={()=>rmSlot(i)} style={{ background:"none",border:"none",color:"#dc2626",cursor:"pointer",fontSize:16,padding:0 }}>✕</button>
            </div>
          ))}
        </div>
      )}

      <ModalActions>
        <Btn onClick={()=>setSubPage(2)}>← Back</Btn>
        <Btn variant="primary" onClick={saveSlots} disabled={saving||!wizZone}>
          {saving?"Saving…":"Save Slots ✓"}
        </Btn>
      </ModalActions>
    </div>
  );

  const renderModels = () => {
    // Group by model_number (the "bit")
    const bitMap = {};
    zoneModels.forEach(m => {
      if (!bitMap[m.model_number]) bitMap[m.model_number] = [];
      bitMap[m.model_number].push(m);
    });
    const sortedBits = Object.entries(bitMap).sort((a,b)=>parseInt(a[0])-parseInt(b[0]));

    return (
      <div>
        <p style={{ fontSize:13,color:"#64748b",marginBottom:16 }}>
          Models across all lines in this zone, grouped by bit (model number). Each bit must be unique. Duplicate bits are flagged in amber.
        </p>
        {subLoading ? <Spinner /> : sortedBits.length===0 ? (
          <EmptyState text="No models assigned" sub="Configure models on individual lines via the Lines section"/>
        ) : (
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%",borderCollapse:"collapse",fontSize:12 }}>
              <thead>
                <tr>{["Bit #","Model Name","Line","Status"].map(h=>(
                  <th key={h} style={{ padding:"8px 12px",textAlign:"left",fontSize:9,fontWeight:700,letterSpacing:".08em",textTransform:"uppercase",color:"#64748b",borderBottom:"2px solid #e2e8f0" }}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {sortedBits.flatMap(([bit,entries])=>
                  entries.map((m,i)=>(
                    <tr key={`${bit}-${i}`} style={{ background:entries.length>1?"rgba(217,119,6,.04)":(parseInt(bit)%2===0?"#fff":"#f8fafc"),borderBottom:"1px solid #f1f5f9" }}>
                      {i===0 && (
                        <td rowSpan={entries.length} style={{ padding:"8px 12px",fontFamily:"monospace",fontWeight:800,color:"#1e40af",fontSize:13,borderRight:"1px solid #f1f5f9",verticalAlign:"middle",background:entries.length>1?"rgba(217,119,6,.07)":undefined }}>
                          {bit}
                        </td>
                      )}
                      <td style={{ padding:"8px 12px",fontWeight:500,color:"#0f172a" }}>{m.model_name}</td>
                      <td style={{ padding:"8px 12px",fontFamily:"monospace",fontSize:11,color:"#64748b" }}>{m.line_code}</td>
                      <td style={{ padding:"8px 12px" }}>
                        {entries.length>1
                          ? <span style={{ padding:"2px 9px",borderRadius:99,fontSize:10,fontWeight:700,background:"rgba(217,119,6,.12)",color:"#d97706" }}>⚠ Duplicate Bit</span>
                          : <span style={{ padding:"2px 9px",borderRadius:99,fontSize:10,fontWeight:700,background:"rgba(22,163,74,.1)",color:"#16a34a" }}>✓ Unique</span>
                        }
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            <div style={{ padding:"8px 14px",fontSize:11,color:"#94a3b8",borderTop:"1px solid #f1f5f9" }}>
              {sortedBits.length} unique bits · {zoneModels.length} total model entries
              {sortedBits.some(([,e])=>e.length>1) && <span style={{ color:"#d97706",marginLeft:10,fontWeight:600 }}>⚠ Duplicate bits detected — each bit must be unique across lines in this zone</span>}
            </div>
          </div>
        )}
        <ModalActions>
          <Btn onClick={()=>setSubPage(3)}>← Back</Btn>
          <Btn onClick={()=>handleSubPage(5)}>Next: Machines →</Btn>
        </ModalActions>
      </div>
    );
  };

  const renderMachines = () => (
    <div>
      <p style={{ fontSize:13,color:"#64748b",marginBottom:16 }}>
        Lines / machines in this zone with their PLC card configuration.
      </p>
      {subLoading ? <Spinner /> : machines.length===0 ? (
        <EmptyState text="No machines found" sub="Assign lines to this zone and configure their PLC settings"/>
      ) : (
        <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%",borderCollapse:"collapse",fontSize:12 }}>
            <thead>
              <tr>{["Line Code","Line Name","PLC IP","Port","Protocol","OK Bit","NG Bit","Ideal CT","Status"].map(h=>(
                <th key={h} style={{ padding:"8px 10px",textAlign:"left",fontSize:9,fontWeight:700,letterSpacing:".08em",textTransform:"uppercase",color:"#64748b",borderBottom:"2px solid #e2e8f0",whiteSpace:"nowrap" }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {machines.map(m=>(
                <tr key={m.id} style={{ borderBottom:"1px solid #f1f5f9" }}>
                  <td style={{ padding:"10px 10px",fontFamily:"monospace",fontWeight:700,color:"#1e40af" }}>{m.line_code}</td>
                  <td style={{ padding:"10px 10px",fontWeight:500,color:"#0f172a",maxWidth:160,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{m.line_name}</td>
                  <td style={{ padding:"10px 10px",fontFamily:"monospace",color:"#334155" }}>{m.plc_ip||"—"}</td>
                  <td style={{ padding:"10px 10px",fontFamily:"monospace",color:"#64748b" }}>{m.plc_port||"—"}</td>
                  <td style={{ padding:"10px 10px" }}>{m.protocol ? <span style={{ padding:"2px 8px",borderRadius:99,fontSize:10,fontWeight:700,background:"rgba(30,64,175,.1)",color:"#1e40af" }}>{m.protocol}</span> : "—"}</td>
                  <td style={{ padding:"10px 10px",fontFamily:"monospace",color:"#7c3aed",fontWeight:700 }}>{m.ok_bit_address||"—"}</td>
                  <td style={{ padding:"10px 10px",fontFamily:"monospace",color:"#dc2626",fontWeight:700 }}>{m.ng_bit_address||"—"}</td>
                  <td style={{ padding:"10px 10px",fontFamily:"monospace" }}>{m.ideal_cycle_time ? `${m.ideal_cycle_time}s` : "—"}</td>
                  <td style={{ padding:"10px 10px" }}><Pill label={m.collector_status||"stopped"} color={m.collector_status==="running"?"green":"gray"}/></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ padding:"8px 14px",fontSize:11,color:"#94a3b8",borderTop:"1px solid #f1f5f9" }}>
            {machines.length} machine{machines.length!==1?"s":""} configured in this zone
          </div>
        </div>
      )}
      <ModalActions>
        <Btn onClick={()=>setSubPage(4)}>← Back</Btn>
        <Btn variant="primary" onClick={()=>setWizOpen(false)}>Done ✓</Btn>
      </ModalActions>
    </div>
  );

  // ── Main render ───────────────────────────────────────────

  const subPageContent = [renderInfo, renderLines, renderShiftsBreaks, renderHourlySlots, renderModels, renderMachines];
  const canAccessAll = !!wizZone;

  return (
    <div>
      <div style={{ display:"flex",justifyContent:"flex-end",marginBottom:20 }}>
        <Btn variant="primary" onClick={openAdd}>+ Add Zone</Btn>
      </div>

      <Card>
        {loading ? <Spinner /> : zones.length===0 ? (
          <EmptyState text="No zones yet" sub="Create zones to group your production lines"/>
        ) : (
          <table style={{ width:"100%",borderCollapse:"collapse",fontSize:13 }}>
            <thead>
              <tr>{["Code","Zone Name","Plant","Lines","Actions"].map(h=>(
                <th key={h} style={{ padding:"10px 14px",textAlign:"left",fontSize:10,fontWeight:700,letterSpacing:".08em",textTransform:"uppercase",color:"#64748b",borderBottom:"2px solid #e2e8f0" }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {zones.map(z=>(
                <tr key={z.id} style={{ borderBottom:"1px solid #f1f5f9" }}>
                  <td style={{ padding:"12px 14px",fontFamily:"monospace",fontWeight:700,color:"#1e40af" }}>{z.zone_code}</td>
                  <td style={{ padding:"12px 14px",fontWeight:600,color:"#0f172a" }}>{z.zone_name}</td>
                  <td style={{ padding:"12px 14px",color:"#64748b" }}>{z.plant_name}</td>
                  <td style={{ padding:"12px 14px",fontFamily:"monospace" }}>{z.line_count||0}</td>
                  <td style={{ padding:"12px 14px" }}>
                    <div style={{ display:"flex",gap:8 }}>
                      <Btn size="sm" variant="primary" onClick={()=>openConfigure(z)}>Configure</Btn>
                      <Btn size="sm" variant="danger" onClick={()=>deactivate(z)}>Deactivate</Btn>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* Zone wizard modal */}
      <Modal open={wizOpen} onClose={()=>setWizOpen(false)} title={wizZone ? `Configure Zone — ${wizZone.zone_name}` : "Add New Zone"} wide>
        {/* Sub-page tab bar */}
        <div style={{ display:"flex",gap:0,borderBottom:"2px solid #e2e8f0",marginBottom:24,overflowX:"auto" }}>
          {SUB_LABELS.map((label,i)=>{
            const enabled = i===0 || canAccessAll;
            return (
              <button key={i} onClick={()=>{ if(enabled) handleSubPage(i); }}
                style={{ padding:"8px 14px",fontFamily:"'Barlow',sans-serif",fontSize:12,fontWeight:600,cursor:enabled?"pointer":"not-allowed",border:"none",background:"none",color:subPage===i?"#1e40af":enabled?"#64748b":"#cbd5e1",borderBottom:`2px solid ${subPage===i?"#1e40af":"transparent"}`,marginBottom:-2,whiteSpace:"nowrap",transition:"all .12s",opacity:enabled?1:0.45 }}>
                {label}
              </button>
            );
          })}
        </div>
        {subPageContent[subPage]?.()}
      </Modal>
    </div>
  );
}

// ─── PRODUCTION LINES PAGE ────────────────────────────────────
const BLANK_MACHINE = { machine_name:"", plc_ip:"", plc_port:5002, protocol:"MC4E", ok_bit_address:"L108", ng_bit_address:"L109", status_address:"D6005", model_address:"D6048", ideal_cycle_time:15.0, max_allowed_cycle:16.0, ok_ng_pulse_min_gap:0.5, sensor_ok_address:"", process_seq_address:"", override_address:"" };

export function LinesPage({ toast, readOnly = false }) {
  const { token } = useAuth();
  const [lines,      setLines]      = useState([]);
  const [plants,     setPlants]     = useState([]);
  const [zones,      setZones]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [modal,      setModal]      = useState(false);
  const [editing,    setEditing]    = useState(null);   // null=add, obj=edit
  const [subPage,    setSubPage]    = useState(0);
  const [saving,     setSaving]     = useState(false);
  const [subLoading, setSubLoading] = useState(false);

  // Sub-page 0 state
  const [basicForm, setBasicForm] = useState({ plant_id:"", line_code:"", line_name:"", db_table_name:"", zone_id:"" });
  // Sub-page 1 state
  const [zoneShiftsCfg, setZoneShiftsCfg] = useState([]);
  const [activeShifts,  setActiveShifts]  = useState(["A","B"]);
  // Sub-page 2 state
  const [machines,    setMachines]    = useState([]);
  const [machineForm, setMachineForm] = useState(null);   // null=hidden, obj=form data
  // Sub-page 3 state
  const [dashboardPlcId, setDashboardPlcId] = useState(null);
  // Sub-page 4 state — Models are now picked from the Poka-Yoke Model Master.
  const [pyModelOptions, setPyModelOptions] = useState([]);   // all Model Master entries
  const [selectedPyIds,  setSelectedPyIds]  = useState([]);   // IDs assigned to this line
  const [pyPickerOpen,   setPyPickerOpen]   = useState(false);
  // Sub-page 5 state
  const [idealCt,       setIdealCt]       = useState(15.0);
  const [plannedTakt,   setPlannedTakt]   = useState("");   // empty string = "not set"
  const [planningShifts,setPlanningShifts] = useState([]);
  // Sub-page 6 state
  const [otConfigs,     setOtConfigs]     = useState([]);

  // ── Loaders ──────────────────────────────────────────────────
  const load = useCallback(async () => {
    try {
      const [l, p, z] = await Promise.all([api.get("/api/lines/", token), api.get("/api/plants/", token), api.get("/api/zones/", token)]);
      setLines(Array.isArray(l) ? l : []);
      setPlants(Array.isArray(p) ? p : []);
      setZones(Array.isArray(z) ? z : []);
    } catch { toast("Failed to load", "err"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const loadZoneShifts = async (zoneId) => {
    if (!zoneId) { setZoneShiftsCfg([]); return; }
    try {
      const s = await api.get(`/api/zones/${zoneId}/shifts`, token);
      setZoneShiftsCfg(Array.isArray(s) ? s.filter(sh => sh.is_production) : []);
    } catch { setZoneShiftsCfg([]); }
  };

  const loadMachines = useCallback(async (lineId) => {
    if (!lineId) return;
    setSubLoading(true);
    try { const m = await api.get(`/api/lines/${lineId}/machines`, token); setMachines(Array.isArray(m) ? m : []); }
    catch { setMachines([]); }
    finally { setSubLoading(false); }
  }, [token]);

  const loadModels = useCallback(async (lineId) => {
    if (!lineId) return;
    try {
      // Keep dashboard_plc_id loading (sub-page 3 also relies on this call).
      const d = await api.get(`/api/lines/${lineId}`, token);
      setDashboardPlcId(d.dashboard_plc_id || null);
    } catch {}
    // Load the full Model Master list + this line's current selections.
    try {
      const [all, curr] = await Promise.all([
        api.get("/api/poka-yoke/models/", token).catch(()=>[]),
        api.get(`/api/config/py-models/${lineId}`, token).catch(()=>[]),
      ]);
      setPyModelOptions(Array.isArray(all) ? all : []);
      setSelectedPyIds(Array.isArray(curr) ? curr.map(m => m.id) : []);
    } catch {}
  }, [token]);

  const loadPlanning = useCallback(async (lineId) => {
    if (!lineId) return;
    setSubLoading(true);
    try {
      const p = await api.get(`/api/lines/${lineId}/planning`, token);
      setIdealCt(parseFloat(p.ideal_ct) || 15.0);
      setPlannedTakt(p.planned_takt != null ? String(p.planned_takt) : "");
      setPlanningShifts(Array.isArray(p.shifts) ? p.shifts : []);
    } catch {}
    finally { setSubLoading(false); }
  }, [token]);

  const loadOtConfig = useCallback(async (lineId) => {
    if (!lineId) return;
    setSubLoading(true);
    try {
      const cfg = await api.get(`/api/lines/${lineId}/ot-config`, token);
      setOtConfigs(Array.isArray(cfg) ? cfg.map(c => ({
        shift_name:    c.shift_name,
        ot_start_time: c.ot_start_time || "",
        ot_end_time:   c.ot_end_time   || "",
      })) : []);
    } catch { setOtConfigs([]); }
    finally { setSubLoading(false); }
  }, [token]);

  // ── Open handlers ─────────────────────────────────────────────
  const openAdd = () => {
    setEditing(null); setSubPage(0); setMachineForm(null);
    setBasicForm({ plant_id: plants[0]?.id || "", line_code:"", line_name:"", db_table_name:"", zone_id:"" });
    setZoneShiftsCfg([]); setActiveShifts(["A","B"]);
    setMachines([]); setDashboardPlcId(null);
    setPyModelOptions([]); setSelectedPyIds([]);
    setIdealCt(15.0); setPlanningShifts([]);
    setModal(true);
  };

  const openEdit = async (l) => {
    setEditing(l); setSubPage(0); setMachineForm(null);
    setBasicForm({ plant_id: l.plant_id, line_code: l.line_code, line_name: l.line_name, db_table_name: l.db_table_name, zone_id: l.zone_id || "" });
    setActiveShifts(l.active_shifts ? l.active_shifts.split(",").map(s=>s.trim()) : ["A","B"]);
    if (l.zone_id) loadZoneShifts(l.zone_id);
    loadMachines(l.id); loadModels(l.id); loadPlanning(l.id); loadOtConfig(l.id);
    setModal(true);
  };

  const handleSubPage = (i) => {
    if (!editing && i > 0) return;
    setSubPage(i); setMachineForm(null);
    if (editing) {
      if (i === 2) loadMachines(editing.id);
      if (i === 3) loadMachines(editing.id);
      if (i === 4) loadModels(editing.id);
      if (i === 5) loadPlanning(editing.id);
      if (i === 6) loadOtConfig(editing.id);
    }
  };

  // ── Save functions ────────────────────────────────────────────
  const saveLine = async () => {
    const { plant_id, line_code, line_name, db_table_name, zone_id } = basicForm;
    if (!plant_id || !line_code || !line_name || !db_table_name) { toast("Fill all required fields", "err"); return; }
    setSaving(true);
    try {
      if (!editing) {
        const res = await api.post("/api/lines/", { plant_id:parseInt(plant_id), line_code, line_name, db_table_name, active_shifts: activeShifts.join(",") }, token);
        if (zone_id) await api.put(`/api/lines/${res.id}`, { zone_id:parseInt(zone_id) }, token);
        setEditing({ ...res, zone_id: zone_id ? parseInt(zone_id) : null, plant_id:parseInt(plant_id), line_code, line_name, db_table_name });
        if (zone_id) loadZoneShifts(zone_id);
        load(); toast("Line created ✓ Configure remaining tabs →");
      } else {
        await api.put(`/api/lines/${editing.id}`, { line_name, zone_id: zone_id ? parseInt(zone_id) : null, active_shifts: activeShifts.join(",") }, token);
        setEditing(prev => ({ ...prev, line_name, zone_id: zone_id ? parseInt(zone_id) : null }));
        if (zone_id) loadZoneShifts(zone_id);
        load(); toast("Line info saved ✓");
      }
    } catch (e) { toast(e.message, "err"); }
    finally { setSaving(false); }
  };

  const saveShifts = async () => {
    if (!editing || !activeShifts.length) { toast("Select at least one shift", "err"); return; }
    setSaving(true);
    try { await api.put(`/api/lines/${editing.id}`, { active_shifts: activeShifts.join(",") }, token); load(); toast("Active shifts saved ✓"); }
    catch (e) { toast(e.message, "err"); }
    finally { setSaving(false); }
  };

  const saveMachine = async () => {
    if (!editing || !machineForm) return;
    const { id, ...body } = machineForm;
    if (!body.machine_name || !body.plc_ip) { toast("Machine name and IP required", "err"); return; }
    setSaving(true);
    try {
      if (id) { await api.put(`/api/lines/${editing.id}/machines/${id}`, body, token); }
      else     { await api.post(`/api/lines/${editing.id}/machines`, body, token); }
      setMachineForm(null); loadMachines(editing.id); toast("Machine saved ✓");
    } catch (e) { toast(e.message, "err"); }
    finally { setSaving(false); }
  };

  const deleteMachine = async (plcId) => {
    if (!confirm("Delete this machine?")) return;
    try { await api.delete(`/api/lines/${editing.id}/machines/${plcId}`, token); loadMachines(editing.id); toast("Machine deleted"); }
    catch (e) { toast(e.message, "err"); }
  };

  const saveDashboardPlc = async () => {
    if (!editing || !dashboardPlcId) return;
    setSaving(true);
    try { await api.put(`/api/lines/${editing.id}/dashboard-plc`, { plc_id: dashboardPlcId }, token); toast("Dashboard PLC saved ✓"); }
    catch (e) { toast(e.message, "err"); }
    finally { setSaving(false); }
  };

  const saveModels = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await api.put(`/api/config/py-models/${editing.id}`, selectedPyIds, token);
      toast(`Saved ${selectedPyIds.length} model${selectedPyIds.length===1?"":"s"} ✓`);
    } catch (e) { toast(e.message, "err"); }
    finally { setSaving(false); }
  };

  const savePlanning = async () => {
    if (!editing || !(idealCt > 0)) { toast("Ideal cycle time must be > 0", "err"); return; }
    setSaving(true);
    try {
      const body = { ideal_ct: parseFloat(idealCt), recalculate: true };
      const ptVal = plannedTakt === "" ? null : parseFloat(plannedTakt);
      if (ptVal !== null && !(ptVal > 0)) { toast("Planned takt must be > 0 if provided", "err"); setSaving(false); return; }
      body.planned_takt = ptVal;
      await api.put(`/api/lines/${editing.id}/planning`, body, token);
      loadPlanning(editing.id);
      toast("Planning saved & applied ✓");
    }
    catch (e) { toast(e.message, "err"); }
    finally { setSaving(false); }
  };

  const saveOtConfig = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await api.put(`/api/lines/${editing.id}/ot-config`,
        otConfigs.map(c => ({
          shift_name:    c.shift_name,
          ot_start_time: c.ot_start_time || null,
          ot_end_time:   c.ot_end_time   || null,
        })),
        token
      );
      toast("OT config saved ✓");
    } catch (e) { toast(e.message, "err"); }
    finally { setSaving(false); }
  };

  const setOtFld = (i, k, v) => setOtConfigs(prev => { const a = [...prev]; a[i] = {...a[i], [k]: v}; return a; });

  const provisionLine = async (l) => {
    try { const r = await api.post(`/api/lines/${l.id}/provision`, {}, token); toast(`Started ✓ PID ${r.pid}`); load(); }
    catch (e) { toast(e.message, "err"); }
  };

  // ── Helpers ───────────────────────────────────────────────────
  const toggleShift    = (n) => setActiveShifts(s => s.includes(n) ? (s.length > 1 ? s.filter(x=>x!==n) : s) : [...s, n]);
  const togglePyModel  = (id) => setSelectedPyIds(s => s.includes(id) ? s.filter(x=>x!==id) : [...s, id]);
  const setMF          = (k,v) => setMachineForm(f => ({...f,[k]:v}));
  const stopLine       = async (l) => { try { await api.post(`/api/lines/${l.id}/stop`,{},token); toast("Collector stopped"); load(); } catch(e){toast(e.message,"err");} };

  const SUB_LABELS = ["① Zone & Info","② Active Shifts","③ Machines","④ Dashboard PLC","⑤ Models","⑥ Planning","⑦ OT Config"];
  const canAll     = !!editing;
  const miniInp    = { ...inputStyle, padding:"8px 10px", fontSize:12 };
  const rowStyle   = { display:"flex", alignItems:"center", gap:8, marginBottom:8 };

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:20 }}>
        <Btn variant="primary" onClick={openAdd}>+ Add Line</Btn>
      </div>
      <Card>
        {loading ? <Spinner /> : lines.length===0 ? <EmptyState text="No lines yet" sub="Add a production line to begin" /> : (
          lines.map(l => {
            const running = l.collector_status === "running";
            return (
              <div key={l.id} style={{ display:"flex", alignItems:"center", gap:14, padding:"14px 0", borderBottom:"1px solid #f1f5f9" }}>
                <div style={{ width:38, height:38, borderRadius:9, flexShrink:0, background:running?"rgba(22,163,74,.1)":"#f8fafc", border:`1px solid ${running?"rgba(22,163,74,.3)":"#e2e8f0"}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, color:running?"#16a34a":"#94a3b8", fontWeight:700 }}>
                  {running ? "▶" : "■"}
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontWeight:700, fontSize:14, color:"#0f172a" }}>{l.line_name}</div>
                  <div style={{ fontSize:11, color:"#94a3b8", marginTop:2 }}>
                    {l.plant_name} · {l.line_code} · {l.db_table_name}
                    {l.zone_name && <span style={{ marginLeft:6, color:"#1e40af", fontWeight:600 }}>· {l.zone_name}</span>}
                    {l.active_shifts && l.active_shifts !== "A,B" && <span style={{ marginLeft:6, color:"#d97706", fontWeight:600 }}>· Shifts: {l.active_shifts}</span>}
                  </div>
                </div>
                <Pill label={l.collector_status} color={running?"green":"gray"} />
                <div style={{ display:"flex", gap:8 }}>
                  <Btn size="sm" onClick={() => openEdit(l)}>Configure</Btn>
                  {running && <Btn size="sm" variant="danger" onClick={() => stopLine(l)}>Stop</Btn>}
                </div>
              </div>
            );
          })
        )}
      </Card>

      <Modal open={modal} onClose={() => setModal(false)} title={editing ? `Configure — ${editing.line_name}` : "Add Production Line"} wide>
        {/* Sub-page tab bar */}
        <div style={{ display:"flex", gap:0, borderBottom:"2px solid #e2e8f0", marginBottom:24, overflowX:"auto" }}>
          {SUB_LABELS.map((label, i) => {
            const enabled = i === 0 || canAll;
            return (
              <button key={i} onClick={() => { if (enabled) handleSubPage(i); }}
                style={{ padding:"8px 14px", fontFamily:"'Barlow',sans-serif", fontSize:12, fontWeight:600, cursor:enabled?"pointer":"not-allowed", border:"none", background:"none", color:subPage===i?"#1e40af":enabled?"#64748b":"#cbd5e1", borderBottom:`2px solid ${subPage===i?"#1e40af":"transparent"}`, marginBottom:-2, whiteSpace:"nowrap", transition:"all .12s", opacity:enabled?1:0.4 }}>
                {label}
              </button>
            );
          })}
        </div>

        {/* ── ① Zone & Info ── */}
        {subPage === 0 && (
          <div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, marginBottom:16 }}>
              <FF label="Plant *">
                <Select value={basicForm.plant_id} onChange={e=>setBasicForm(f=>({...f,plant_id:e.target.value}))} disabled={!!editing}>
                  <option value="">Select plant…</option>
                  {plants.map(p => <option key={p.id} value={p.id}>{p.plant_name}</option>)}
                </Select>
              </FF>
              <FF label="Line Code *">
                <Input value={basicForm.line_code} onChange={e=>setBasicForm(f=>({...f,line_code:e.target.value}))} placeholder="YNC-L2" disabled={!!editing}/>
              </FF>
              <FF label="Line Name *">
                <Input value={basicForm.line_name} onChange={e=>setBasicForm(f=>({...f,line_name:e.target.value}))} placeholder="e.g. Production Line 2"/>
              </FF>
              <FF label="DB Table Name *" hint="Created automatically on provision">
                <Input value={basicForm.db_table_name} onChange={e=>setBasicForm(f=>({...f,db_table_name:e.target.value}))} placeholder="ync_l2_dashboard" disabled={!!editing}/>
              </FF>
            </div>
            <FF label="Zone Assignment" hint="This line inherits shifts, breaks and hourly slots from the assigned zone">
              <Select value={basicForm.zone_id} onChange={e=>{ setBasicForm(f=>({...f,zone_id:e.target.value})); loadZoneShifts(e.target.value); }}>
                <option value="">— No Zone —</option>
                {zones.map(z => <option key={z.id} value={z.id}>{z.zone_name} ({z.zone_code})</option>)}
              </Select>
            </FF>
            {basicForm.zone_id && (
              <div style={{ marginTop:14, background:"rgba(30,64,175,.04)", border:"1px solid rgba(30,64,175,.15)", borderRadius:9, padding:"10px 14px", fontSize:12, color:"#1e40af" }}>
                ℹ️ Shifts, break schedules and hourly slots are managed in the Zone configuration.
                Go to <strong>② Active Shifts</strong> to select which shifts this line operates in.
              </div>
            )}
            <ModalActions>
              <Btn onClick={() => setModal(false)}>Cancel</Btn>
              <Btn variant="primary" onClick={saveLine} disabled={saving}>{saving?"Saving…": editing ? "Save Info →" : "Create Line →"}</Btn>
            </ModalActions>
          </div>
        )}

        {/* ── ② Active Shifts ── */}
        {subPage === 1 && (
          <div>
            <p style={{ fontSize:12, color:"#64748b", marginBottom:20 }}>
              Select which shifts this line operates in. During unselected shifts the line will appear as <strong>Offline</strong> on the dashboard.
            </p>
            {zoneShiftsCfg.length === 0 ? (
              <div style={{ textAlign:"center", padding:32, color:"#94a3b8", fontSize:13 }}>
                {basicForm.zone_id ? "Loading zone shifts…" : "Assign a zone first (① Zone & Info tab) to see available shifts"}
              </div>
            ) : (
              <div style={{ display:"flex", flexDirection:"column", gap:12, marginBottom:24 }}>
                {zoneShiftsCfg.map(s => {
                  const checked = activeShifts.includes(s.shift_name);
                  return (
                    <div key={s.shift_name} onClick={() => toggleShift(s.shift_name)}
                      style={{ display:"flex", alignItems:"center", gap:16, padding:"14px 18px", borderRadius:10, border:`1.5px solid ${checked?"#1e40af":"#e2e8f0"}`, background:checked?"rgba(30,64,175,.04)":"#fff", cursor:"pointer", transition:"all .12s" }}>
                      <input type="checkbox" checked={checked} onChange={() => toggleShift(s.shift_name)}
                        style={{ width:18, height:18, accentColor:"#1e40af", cursor:"pointer" }} onClick={e=>e.stopPropagation()}/>
                      <div style={{ flex:1 }}>
                        <div style={{ fontWeight:700, fontSize:14, color:checked?"#1e40af":"#0f172a" }}>Shift {s.shift_name}</div>
                        <div style={{ fontSize:12, color:"#64748b", marginTop:2 }}>
                          Active: {s.start_time?.slice(0,5)||"—"} → {s.end_time?.slice(0,5)||"—"}
                          {s.crosses_midnight && <span style={{ marginLeft:6, color:"#94a3b8" }}>(crosses midnight)</span>}
                        </div>
                      </div>
                      <span style={{ fontSize:11, fontWeight:700, color:checked?"#16a34a":"#94a3b8" }}>{checked?"✓ ACTIVE":"OFFLINE"}</span>
                    </div>
                  );
                })}
              </div>
            )}
            <ModalActions>
              <Btn onClick={() => setSubPage(0)}>← Back</Btn>
              <Btn variant="primary" onClick={saveShifts} disabled={saving}>{saving?"Saving…":"Save Active Shifts ✓"}</Btn>
            </ModalActions>
          </div>
        )}

        {/* ── ③ Machines ── */}
        {subPage === 2 && (
          <div>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
              <span style={{ fontSize:12, color:"#64748b" }}>PLC machines for this line. Each machine is a separate physical data source.</span>
              {!machineForm && <Btn size="sm" variant="primary" onClick={() => setMachineForm({...BLANK_MACHINE})}>+ Add Machine</Btn>}
            </div>

            {/* Inline machine form */}
            {machineForm && (
              <div style={{ background:"#f8fafc", border:"1.5px solid #e2e8f0", borderRadius:12, padding:18, marginBottom:18 }}>
                <div style={{ fontSize:12, fontWeight:700, color:"#0f172a", marginBottom:14 }}>{machineForm.id ? "Edit Machine" : "New Machine"}</div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12, marginBottom:14 }}>
                  <FF label="Machine Name *" style={{ gridColumn:"span 3" }}>
                    <Input value={machineForm.machine_name} onChange={e=>setMF("machine_name",e.target.value)} placeholder="e.g. Main PLC, Robot Arm 1"/>
                  </FF>
                  <FF label="PLC IP *"><Input value={machineForm.plc_ip} onChange={e=>setMF("plc_ip",e.target.value)} placeholder="192.168.10.151"/></FF>
                  <FF label="Port"><Input type="number" value={machineForm.plc_port} onChange={e=>setMF("plc_port",parseInt(e.target.value))}/></FF>
                  <FF label="Protocol"><Select value={machineForm.protocol} onChange={e=>setMF("protocol",e.target.value)}><option>MC4E</option><option>MC3E</option></Select></FF>
                </div>
                <div style={{ fontSize:11, fontWeight:700, color:"#64748b", letterSpacing:".08em", textTransform:"uppercase", marginBottom:10 }}>Signal Registers</div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:10, marginBottom:14 }}>
                  <FF label="OK Bit"><Input value={machineForm.ok_bit_address} onChange={e=>setMF("ok_bit_address",e.target.value)}/></FF>
                  <FF label="NG Bit"><Input value={machineForm.ng_bit_address} onChange={e=>setMF("ng_bit_address",e.target.value)}/></FF>
                  <FF label="Status Word"><Input value={machineForm.status_address} onChange={e=>setMF("status_address",e.target.value)}/></FF>
                  <FF label="Model Word"><Input value={machineForm.model_address} onChange={e=>setMF("model_address",e.target.value)}/></FF>
                </div>
                <div style={{ fontSize:11, fontWeight:700, color:"#64748b", letterSpacing:".08em", textTransform:"uppercase", marginBottom:10 }}>Cycle Time</div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10, marginBottom:14 }}>
                  <FF label="Ideal CT (sec)"><Input type="number" step="0.1" value={machineForm.ideal_cycle_time} onChange={e=>setMF("ideal_cycle_time",parseFloat(e.target.value))}/></FF>
                  <FF label="Max CT (sec)"><Input type="number" step="0.1" value={machineForm.max_allowed_cycle} onChange={e=>setMF("max_allowed_cycle",parseFloat(e.target.value))}/></FF>
                  <FF label="Pulse Gap (sec)"><Input type="number" step="0.1" value={machineForm.ok_ng_pulse_min_gap} onChange={e=>setMF("ok_ng_pulse_min_gap",parseFloat(e.target.value))}/></FF>
                </div>
                <div style={{ fontSize:11, fontWeight:700, color:"#64748b", letterSpacing:".08em", textTransform:"uppercase", marginBottom:10 }}>Poka Yoke Registers (optional)</div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10, marginBottom:16 }}>
                  <FF label="Sensor OK"><Input value={machineForm.sensor_ok_address} onChange={e=>setMF("sensor_ok_address",e.target.value)} placeholder="e.g. L110"/></FF>
                  <FF label="Process Seq"><Input value={machineForm.process_seq_address} onChange={e=>setMF("process_seq_address",e.target.value)} placeholder="e.g. D6010"/></FF>
                  <FF label="Override Bit"><Input value={machineForm.override_address} onChange={e=>setMF("override_address",e.target.value)} placeholder="e.g. D6011"/></FF>
                </div>
                <div style={{ display:"flex", gap:8 }}>
                  <Btn variant="primary" onClick={saveMachine} disabled={saving}>{saving?"Saving…":"Save Machine ✓"}</Btn>
                  <Btn onClick={() => setMachineForm(null)}>Cancel</Btn>
                </div>
              </div>
            )}

            {/* Machine list */}
            {subLoading ? <Spinner /> : machines.length === 0 && !machineForm ? (
              <EmptyState text="No machines yet" sub="Add a PLC machine to this line"/>
            ) : (
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                {machines.map(m => (
                  <div key={m.id} style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 16px", background:"#f8fafc", borderRadius:10, border:"1px solid #e2e8f0" }}>
                    <div style={{ width:36, height:36, borderRadius:8, background:"rgba(30,64,175,.08)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:15, color:"#1e40af", flexShrink:0 }}>⚙</div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontWeight:700, fontSize:13, color:"#0f172a" }}>{m.machine_name || "Unnamed"}</div>
                      <div style={{ fontSize:11, color:"#94a3b8", marginTop:2 }}>{m.plc_ip}:{m.plc_port} · {m.protocol} · Ideal CT: {m.ideal_cycle_time}s</div>
                    </div>
                    <div style={{ display:"flex", gap:6 }}>
                      <Btn size="sm" onClick={() => setMachineForm({...m})}>Edit</Btn>
                      <Btn size="sm" variant="danger" onClick={() => deleteMachine(m.id)}>Delete</Btn>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── ④ Dashboard PLC ── */}
        {subPage === 3 && (
          <div>
            <p style={{ fontSize:12, color:"#64748b", marginBottom:20 }}>
              Choose which machine's output feeds the <strong>Dashboard</strong> and <strong>Fullscreen</strong> pages.
              Only one machine can be the active data source at a time.
            </p>
            {machines.length === 0 ? (
              <div style={{ textAlign:"center", padding:32, color:"#94a3b8", fontSize:13 }}>No machines configured — add machines in the ③ Machines tab first</div>
            ) : (
              <div style={{ display:"flex", flexDirection:"column", gap:10, marginBottom:24 }}>
                {machines.map(m => {
                  const sel = dashboardPlcId === m.id;
                  return (
                    <div key={m.id} onClick={() => setDashboardPlcId(m.id)}
                      style={{ display:"flex", alignItems:"center", gap:14, padding:"14px 18px", borderRadius:10, border:`1.5px solid ${sel?"#1e40af":"#e2e8f0"}`, background:sel?"rgba(30,64,175,.05)":"#fff", cursor:"pointer", transition:"all .12s" }}>
                      <div style={{ width:20, height:20, borderRadius:"50%", border:`2px solid ${sel?"#1e40af":"#cbd5e1"}`, background:sel?"#1e40af":"#fff", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center" }}>
                        {sel && <div style={{ width:8, height:8, borderRadius:"50%", background:"#fff" }}/>}
                      </div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontWeight:700, fontSize:14, color:sel?"#1e40af":"#0f172a" }}>{m.machine_name || "Unnamed"}</div>
                        <div style={{ fontSize:11, color:"#94a3b8", marginTop:2 }}>{m.plc_ip}:{m.plc_port} · {m.protocol} · CT: {m.ideal_cycle_time}s</div>
                      </div>
                      {sel && <span style={{ fontSize:11, fontWeight:800, color:"#1e40af" }}>✓ DASHBOARD SOURCE</span>}
                    </div>
                  );
                })}
              </div>
            )}
            <ModalActions>
              <Btn onClick={() => setSubPage(2)}>← Machines</Btn>
              <Btn variant="primary" onClick={saveDashboardPlc} disabled={saving || !dashboardPlcId}>{saving?"Saving…":"Set Dashboard PLC ✓"}</Btn>
            </ModalActions>
          </div>
        )}

        {/* ── ⑤ Models ── */}
        {subPage === 4 && (() => {
          const byId = {};
          pyModelOptions.forEach(m => { byId[m.id] = m; });
          const assignedRows = selectedPyIds
            .map(id => byId[id])
            .filter(Boolean)
            .sort((a,b) => (a.bitNumber ?? 9999) - (b.bitNumber ?? 9999));
          const cleanName = s => String(s||"").replace(/^TYPE-SERIES:\s*/i,"");

          return (
            <div>
              <p style={{ fontSize:12, color:"#64748b", marginBottom:16 }}>
                Iss line par jo models chlte hain unhe <b>Poka Yoke &rarr; Model Master</b> se pick karo.
                Model add/edit Model Master mein hi hota hai — yahaan sirf assign/unassign.
              </p>

              {/* Header + Add button */}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,gap:10,flexWrap:"wrap"}}>
                <div style={{fontSize:12,color:"#64748b",fontWeight:700,letterSpacing:".04em"}}>
                  Assigned Models <span style={{color:"#0f172a"}}>({assignedRows.length})</span>
                </div>
                <Btn size="sm" variant="primary" onClick={()=>setPyPickerOpen(true)}
                  disabled={pyModelOptions.length === 0}>
                  + Add Models
                </Btn>
              </div>

              {/* Assigned list */}
              {pyModelOptions.length === 0 ? (
                <div style={{
                  padding:"14px 16px", borderRadius:10,
                  background:"rgba(220,38,38,.04)", border:"1px dashed #fecaca",
                  fontSize:12, color:"#991b1b",
                }}>
                  Model Master abhi khali hai. Pehle <b>Poka Yoke &rarr; Model Master</b> mein models banao.
                </div>
              ) : assignedRows.length === 0 ? (
                <div style={{
                  padding:"18px 16px", borderRadius:10,
                  background:"#f8fafc", border:"1px dashed #e2e8f0",
                  textAlign:"center", fontSize:12, color:"#94a3b8",
                }}>
                  Koi model assign nahi. <b>+ Add Models</b> se Model Master se pick karo.
                </div>
              ) : (
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  {assignedRows.map(m => (
                    <div key={m.id} style={{
                      display:"flex",alignItems:"center",gap:10,padding:"10px 12px",
                      background:"#fff",border:"1px solid #e2e8f0",borderRadius:10,
                    }}>
                      <span style={{display:"inline-flex",alignItems:"center",justifyContent:"center",minWidth:44,height:32,padding:"0 10px",borderRadius:7,background:"linear-gradient(135deg,#7c3aed,#6d28d9)",color:"#fff",fontWeight:800,fontSize:12,fontFamily:"monospace"}}>
                        #{m.bitNumber ?? "—"}
                      </span>
                      <span style={{fontFamily:"monospace",fontWeight:700,color:"#0f172a",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={cleanName(m.modelName)}>
                        {cleanName(m.modelName)}
                      </span>
                      {m.type && <span style={{padding:"2px 8px",borderRadius:99,fontSize:10,fontWeight:700,background:"rgba(30,64,175,.1)",color:"#1e40af",whiteSpace:"nowrap"}}>{m.type}</span>}
                      <button
                        onClick={()=>togglePyModel(m.id)}
                        title="Unassign"
                        style={{
                          border:"1px solid #fecaca",background:"rgba(220,38,38,.06)",color:"#dc2626",
                          fontWeight:800,cursor:"pointer",fontSize:12,lineHeight:1,
                          width:26,height:26,borderRadius:6,padding:0,
                        }}
                      >✕</button>
                    </div>
                  ))}
                </div>
              )}

              <ModalActions>
                <Btn onClick={() => setModal(false)}>Close</Btn>
                <Btn variant="primary" onClick={saveModels} disabled={saving}>
                  {saving ? "Saving…" : "Save Assignments ✓"}
                </Btn>
              </ModalActions>

              {/* Picker dialog — checkbox list of all Master models */}
              <Modal
                open={pyPickerOpen}
                onClose={()=>setPyPickerOpen(false)}
                title="Select Models from Master"
                wide
              >
                <div style={{fontSize:11,color:"#64748b",marginBottom:12}}>
                  Ticked models is line par assign honge (abhi Save nahi kiya — "Done" click karke fir "Save Assignments" dabao).
                </div>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,gap:10}}>
                  <div style={{fontSize:11,color:"#64748b",fontWeight:700,letterSpacing:".06em",textTransform:"uppercase"}}>
                    {selectedPyIds.length} of {pyModelOptions.length} selected
                  </div>
                  <div style={{display:"flex",gap:6}}>
                    <Btn size="sm" onClick={()=>setSelectedPyIds(pyModelOptions.filter(m=>m.bitNumber!=null).map(m=>m.id))}>Select All</Btn>
                    <Btn size="sm" onClick={()=>setSelectedPyIds([])}>Clear</Btn>
                  </div>
                </div>
                <div style={{
                  maxHeight:400, overflowY:"auto",
                  display:"flex", flexDirection:"column", gap:6,
                  border:"1px solid #e2e8f0", borderRadius:10, padding:10, background:"#f8fafc",
                }}>
                  {[...pyModelOptions]
                    .sort((a,b) => (a.bitNumber ?? 9999) - (b.bitNumber ?? 9999))
                    .map(m => {
                      const checked  = selectedPyIds.includes(m.id);
                      const name     = cleanName(m.modelName);
                      const disabled = m.bitNumber == null;
                      return (
                        <label key={m.id} style={{
                          display:"flex",alignItems:"center",gap:10,padding:"8px 10px",
                          background: checked ? "rgba(30,64,175,.08)" : "#fff",
                          border: `1px solid ${checked ? "rgba(30,64,175,.3)" : "#e2e8f0"}`,
                          borderRadius:8, cursor: disabled ? "not-allowed" : "pointer",
                          opacity: disabled ? 0.5 : 1,
                        }} title={disabled ? "No bit number set on this model — edit in Model Master" : ""}>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={disabled}
                            onChange={()=>togglePyModel(m.id)}
                          />
                          <span style={{display:"inline-flex",alignItems:"center",justifyContent:"center",minWidth:40,height:30,padding:"0 10px",borderRadius:7,background:disabled?"#e2e8f0":"linear-gradient(135deg,#7c3aed,#6d28d9)",color:disabled?"#94a3b8":"#fff",fontWeight:800,fontSize:12,fontFamily:"monospace"}}>
                            #{m.bitNumber ?? "—"}
                          </span>
                          <span style={{fontFamily:"monospace",fontWeight:600,color:"#0f172a",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={name}>
                            {name}
                          </span>
                        </label>
                      );
                    })}
                </div>
                <ModalActions>
                  <Btn variant="primary" onClick={()=>setPyPickerOpen(false)}>Done</Btn>
                </ModalActions>
              </Modal>
            </div>
          );
        })()}

        {/* ── ⑦ OT Config ── */}
        {subPage === 6 && (
          <div>
            <p style={{ fontSize:12, color:"#64748b", marginBottom:20 }}>
              Configure overtime window for each production shift (per line).<br/>
              During OT time the plan counter freezes — only actual keeps incrementing.
            </p>
            {subLoading ? <Spinner /> : otConfigs.length === 0 ? (
              <div style={{ textAlign:"center", padding:30, color:"#94a3b8", fontSize:13 }}>No production shifts found. Assign this line to a zone first.</div>
            ) : (
              <div style={{ display:"flex", flexDirection:"column", gap:14, marginBottom:24 }}>
                {otConfigs.map((cfg, i) => (
                  <div key={cfg.shift_name} style={{ background:"#f8fafc", border:"1px solid #e2e8f0", borderRadius:10, padding:16 }}>
                    <div style={{ fontSize:12, fontWeight:800, color:"#0f172a", marginBottom:12 }}>Shift {cfg.shift_name} — OT Window</div>
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                      <FF label="OT Start Time">
                        <Input type="time" value={cfg.ot_start_time} onChange={e => setOtFld(i, "ot_start_time", e.target.value)}/>
                      </FF>
                      <FF label="OT End Time">
                        <Input type="time" value={cfg.ot_end_time} onChange={e => setOtFld(i, "ot_end_time", e.target.value)}/>
                      </FF>
                    </div>
                    {cfg.ot_start_time && cfg.ot_end_time && (
                      <div style={{ marginTop:10, padding:"8px 12px", borderRadius:7, background:"rgba(22,163,74,.06)", border:"1px solid rgba(22,163,74,.2)", fontSize:11, color:"#16a34a", fontWeight:600 }}>
                        OT window: {cfg.ot_start_time} → {cfg.ot_end_time}. Plan freezes at shift end; actual continues during this window.
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            <ModalActions>
              <Btn onClick={() => setModal(false)}>Close</Btn>
              <Btn variant="primary" onClick={saveOtConfig} disabled={saving || otConfigs.length === 0}>{saving?"Saving…":"Save OT Config ✓"}</Btn>
            </ModalActions>
          </div>
        )}

        {/* ── ⑥ Planning ── */}
        {subPage === 5 && (
          <div>
            <p style={{ fontSize:12, color:"#64748b", marginBottom:20 }}>
              Set the ideal cycle time to auto-calculate production plan per shift.<br/>
              Formula: <code style={{ background:"#f1f5f9", padding:"2px 6px", borderRadius:4, fontSize:12 }}>Plan = ⌊Working Minutes × 60 ÷ Ideal CT⌋</code>
            </p>
            <div style={{ display:"grid", gridTemplateColumns:"220px 220px 1fr", gap:16, alignItems:"end", marginBottom:24 }}>
              <FF label="Ideal Cycle Time (seconds)" hint="Machine's achievable target — used to compute plan">
                <Input type="number" step="0.1" min="0.1" value={idealCt}
                  onChange={e => {
                    const ct = parseFloat(e.target.value) || 15;
                    setIdealCt(ct);
                    setPlanningShifts(s => s.map(sh => ({...sh, _calc: sh.working_minutes > 0 ? Math.floor(sh.working_minutes*60/ct) : 0 })));
                  }}/>
              </FF>
              <FF label="Planned Takt Time (seconds)" hint="Customer-demand rhythm. Shown as Plan in the Takt Time card on Fullscreen.">
                <Input type="number" step="0.01" min="0" value={plannedTakt}
                  placeholder="optional — e.g. 15.33"
                  onChange={e => setPlannedTakt(e.target.value)}/>
              </FF>
              <div/>
            </div>
            {subLoading ? <Spinner /> : planningShifts.filter(s=>!s.shift_name.startsWith("GAP")).length === 0 ? (
              <div style={{ textAlign:"center", padding:30, color:"#94a3b8", fontSize:13 }}>No shifts configured. Configure shifts in the Zone settings first.</div>
            ) : (
              <table style={{ width:"100%", borderCollapse:"collapse" }}>
                <thead>
                  <tr style={{ background:"#f8fafc" }}>
                    {["Shift","Start","End","Working Min","Current Plan","New Plan"].map(h=>(
                      <th key={h} style={{ padding:"10px 14px", textAlign:"left", fontSize:11, fontWeight:700, color:"#64748b", letterSpacing:".06em", textTransform:"uppercase", borderBottom:"2px solid #e2e8f0" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {planningShifts.filter(s=>!s.shift_name.startsWith("GAP")).map(s => {
                    const calc  = idealCt > 0 ? Math.floor(s.working_minutes * 60 / idealCt) : 0;
                    const dirty = calc !== s.total_plan;
                    return (
                      <tr key={s.shift_name} style={{ borderBottom:"1px solid #f1f5f9" }}>
                        <td style={{ padding:"12px 14px", fontWeight:700 }}>Shift {s.shift_name}</td>
                        <td style={{ padding:"12px 14px", color:"#64748b", fontFamily:"monospace" }}>{s.start_time?.slice(0,5)||"—"}</td>
                        <td style={{ padding:"12px 14px", color:"#64748b", fontFamily:"monospace" }}>{s.end_time?.slice(0,5)||"—"}</td>
                        <td style={{ padding:"12px 14px", color:"#0f172a" }}>{s.working_minutes} min</td>
                        <td style={{ padding:"12px 14px", color:"#94a3b8" }}>{s.total_plan}</td>
                        <td style={{ padding:"12px 14px" }}>
                          <span style={{ fontSize:16, fontWeight:700, color:dirty?"#1e40af":"#94a3b8" }}>{calc}</span>
                          {dirty && <span style={{ fontSize:10, color:"#16a34a", marginLeft:6, fontWeight:700 }}>← will update</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            <ModalActions>
              <Btn onClick={() => setModal(false)}>Close</Btn>
              <Btn variant="primary" onClick={savePlanning} disabled={saving || !idealCt}>{saving?"Saving…":"Save & Apply Plan ✓"}</Btn>
            </ModalActions>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ─── STATUS SCHEMA PAGE ───────────────────────────────────────
export function StatusPage({ toast, readOnly = false }) {
  const { token } = useAuth();
  const [statuses, setStatuses] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [modal,    setModal]    = useState(false);
  const [editing,  setEditing]  = useState(null);
  const [form,     setForm]     = useState({ status_code:"", status_name:"", color_hex:"#3b82f6", color_label:"", loss_type:"", is_production:"false" });
  const [saving,   setSaving]   = useState(false);

  const PROTECTED = [0, 1, 2];

  const load = useCallback(async () => {
    try { setStatuses(await api.get("/api/status-schema/", token)); }
    catch { toast("Failed to load", "err"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const openAdd = () => {
    setEditing(null);
    setForm({ status_code:"", status_name:"", color_hex:"#3b82f6", color_label:"", loss_type:"", is_production:"false" });
    setModal(true);
  };

  const openEdit = (s) => {
    setEditing(s);
    setForm({ status_code: s.status_code, status_name: s.status_name, color_hex: s.color_hex, color_label: s.color_label, loss_type: s.loss_type||"", is_production: String(s.is_production) });
    setModal(true);
  };

  const save = async () => {
    if (!form.status_name || !form.color_hex || !form.color_label) { toast("Name, color and label required","err"); return; }
    if (!form.color_hex.match(/^#[0-9a-fA-F]{3,6}$/)) { toast("Invalid color — use #rrggbb","err"); return; }
    setSaving(true);
    try {
      if (editing) {
        await api.put(`/api/status-schema/${editing.status_code}`, { status_name: form.status_name, color_hex: form.color_hex, color_label: form.color_label, loss_type: form.loss_type||null, is_production: form.is_production==="true" }, token);
        toast("Status updated ✓ — all lines affected");
      } else {
        if (!form.status_code) { toast("Status code required","err"); setSaving(false); return; }
        await api.post("/api/status-schema/", { status_code: parseInt(form.status_code), status_name: form.status_name, color_hex: form.color_hex, color_label: form.color_label, loss_type: form.loss_type||null, is_production: form.is_production==="true" }, token);
        toast("Status added ✓");
      }
      setModal(false); load();
    } catch (e) { toast(e.message,"err"); }
    finally { setSaving(false); }
  };

  const deactivate = async (s) => {
    if (!confirm(`Deactivate status "${s.status_name}"?`)) return;
    try { await api.delete(`/api/status-schema/${s.status_code}`, token); toast("Status deactivated"); load(); }
    catch (e) { toast(e.message,"err"); }
  };

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:20 }}>
        <Btn variant="primary" onClick={openAdd}>+ Add Status</Btn>
      </div>
      {statuses.length > 0 && (
        <Card style={{ marginBottom:20 }}>
          <div style={{ fontSize:11, fontWeight:700, color:"#64748b", letterSpacing:".1em", textTransform:"uppercase", marginBottom:12 }}>Live Preview — How operators see this</div>
          <div style={{ display:"flex", flexWrap:"wrap", gap:10 }}>
            {statuses.filter(s=>s.is_active).map(s=>(
              <div key={s.status_code} style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 14px", borderRadius:8, background:`${s.color_hex}18`, border:`1px solid ${s.color_hex}44` }}>
                <div style={{ width:10, height:10, borderRadius:"50%", background:s.color_hex }}/>
                <span style={{ fontSize:12, fontWeight:600, color:"#0f172a" }}>{s.status_name}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
      <Card>
        {loading ? <Spinner /> : (
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
            <thead>
              <tr>{["Code","Color","Status Name","Machine State","Loss Category","Actions"].map(h=>(
                <th key={h} style={{ padding:"10px 14px", textAlign:"left", fontSize:10, fontWeight:700, letterSpacing:".08em", textTransform:"uppercase", color:"#64748b", borderBottom:"2px solid #e2e8f0" }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {statuses.map(s=>(
                <tr key={s.status_code} style={{ borderBottom:"1px solid #f1f5f9" }}>
                  <td style={{ padding:"12px 14px", fontFamily:"monospace", fontWeight:700, color:"#1e40af" }}>{s.status_code}</td>
                  <td style={{ padding:"12px 14px" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                      <div style={{ width:28, height:28, borderRadius:6, background:s.color_hex, border:"1px solid #e2e8f0", flexShrink:0 }}/>
                      <span style={{ fontFamily:"monospace", fontSize:11, color:"#64748b" }}>{s.color_hex}</span>
                      <span style={{ fontSize:11, color:"#94a3b8" }}>{s.color_label}</span>
                    </div>
                  </td>
                  <td style={{ padding:"12px 14px", fontWeight:600, color:"#0f172a" }}>{s.status_name}</td>
                  <td style={{ padding:"12px 14px" }}><Pill label={s.is_production?"Production":"Stoppage"} color={s.is_production?"green":"gray"}/></td>
                  <td style={{ padding:"12px 14px", fontFamily:"monospace", fontSize:11, color:"#64748b" }}>{s.loss_type||"—"}</td>
                  <td style={{ padding:"12px 14px" }}>
                    {PROTECTED.includes(s.status_code)
                      ? <span style={{ fontSize:11, color:"#94a3b8", padding:"4px 8px" }}>Protected</span>
                      : (
                        <div style={{ display:"flex", gap:8 }}>
                          <Btn size="sm" onClick={()=>openEdit(s)}>Edit</Btn>
                          <Btn size="sm" variant="danger" onClick={()=>deactivate(s)}>Remove</Btn>
                        </div>
                      )
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Modal open={modal} onClose={()=>setModal(false)} title={editing?`Edit Status ${editing.status_code} — ${editing.status_name}`:"Add New Status Type"}>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
          <FF label="Status Code *" hint="Integer matching PLC word value">
            <Input type="number" value={form.status_code} onChange={e=>setForm(f=>({...f,status_code:e.target.value}))} placeholder="e.g. 8" disabled={!!editing}/>
          </FF>
          <FF label="Status Name *">
            <Input value={form.status_name} onChange={e=>setForm(f=>({...f,status_name:e.target.value}))} placeholder="e.g. TRIAL RUN"/>
          </FF>
          <FF label="Color (hex) *">
            <div style={{ display:"flex", gap:8, alignItems:"center" }}>
              <Input value={form.color_hex} onChange={e=>setForm(f=>({...f,color_hex:e.target.value}))} placeholder="#3b82f6" style={{flex:1}}/>
              <div style={{ width:38, height:38, borderRadius:7, border:"1px solid #e2e8f0", background:form.color_hex, flexShrink:0, cursor:"pointer", position:"relative" }}>
                <input type="color" value={form.color_hex} onChange={e=>setForm(f=>({...f,color_hex:e.target.value}))} style={{ position:"absolute", inset:0, opacity:0, cursor:"pointer", width:"100%", height:"100%" }}/>
              </div>
            </div>
          </FF>
          <FF label="Color Label *">
            <Input value={form.color_label} onChange={e=>setForm(f=>({...f,color_label:e.target.value}))} placeholder="e.g. Blue"/>
          </FF>
          <FF label="Loss Category">
            <Select value={form.loss_type} onChange={e=>setForm(f=>({...f,loss_type:e.target.value}))}>
              <option value="">None — not a loss</option>
              <option value="breakdown">Breakdown</option>
              <option value="quality">Quality</option>
              <option value="setup">Setup</option>
              <option value="material">Material</option>
              <option value="others">Others</option>
              <option value="change_over">Change Over</option>
              <option value="speed">Speed</option>
            </Select>
          </FF>
          <FF label="Machine State">
            <Select value={form.is_production} onChange={e=>setForm(f=>({...f,is_production:e.target.value}))}>
              <option value="false">Stoppage (not producing)</option>
              <option value="true">Production (making parts)</option>
            </Select>
          </FF>
        </div>
        <ModalActions>
          <Btn onClick={()=>setModal(false)}>Cancel</Btn>
          <Btn variant="primary" onClick={save} disabled={saving}>{saving?"Saving…":"Save — applies to all lines"}</Btn>
        </ModalActions>
      </Modal>
    </div>
  );
}

// ─── LINE ASSIGN MODAL ────────────────────────────────────────
