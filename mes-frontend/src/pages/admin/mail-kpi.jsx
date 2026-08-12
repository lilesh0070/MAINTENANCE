/* admin/mail-kpi.jsx — KPI Targets page.

   `maintenance_kpi_target` par teen tab (Zone / Line / Machine): Financial
   Year chuno, scope chuno, aur us scope ke KPI target bharo.  Zone / line /
   machine ke dropdown Machine Master (`maintenance_machines`) se aate hain. */
import { useState, useEffect, useRef, useCallback, useMemo, Fragment } from "react";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../api/client";
import {
  PageHeading, Card, Pill, Btn, FF, Input, Select,
  Modal, ModalActions, Toast, EmptyState, Spinner, ExcelImportButton,
} from "./ui";


// ─── KPI TARGETS PAGE (Maintenance) ───────────────────────────
// Three tabs (Zone / Line / Machine) over `maintenance_kpi_target`.  Pick a
// Financial Year, choose the scope for the active tab (dropdowns from the
// Machine Master List), pick a KPI, enter a target value and Save.  Each tab
// lists its own saved rows.  One row per (FY, scope, KPI).

// Financial years for the dropdown: 2025-2026 going forward 40 years.
const MKT_FYS = Array.from({ length: 41 }, (_, i) => {
  const y = 2025 + i;
  return `${y}-${y + 1}`;
});

// Default the FY selector to the CURRENT financial year (Apr–Mar), e.g. 2026-2027.
const MKT_CURRENT_FY = (() => {
  const d = new Date();
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}-${y + 1}`;
})();
const MKT_DEFAULT_FY = MKT_FYS.includes(MKT_CURRENT_FY) ? MKT_CURRENT_FY : MKT_FYS[0];

// The six Maintenance KPI page metrics.
const MKT_KPIS = [
  { key: "mttr_minutes",          label: "MTTR" },
  { key: "mtbf_hours",            label: "MTBF" },
  { key: "lttr_minutes",          label: "LTTR" },
  { key: "breakdown_frequency",   label: "Total Breakdown Frequency" },
  { key: "total_breakdown_hours", label: "Total Breakdown Hours" },
  { key: "over_1hr_count",        label: "More than 1 Hour" },
];

const MKT_TABS = [
  { key: "ZONE",    label: "Zone",    accent: "#1e40af" },
  { key: "LINE",    label: "Line",    accent: "#6d28d9" },
  { key: "MACHINE", label: "Machine", accent: "#0e7490" },
];

export function KpiTargetsPage({ toast, readOnly = false }) {
  const { token } = useAuth();
  const [master, setMaster] = useState([]);   // flat Machine Master List rows
  const [rows, setRows]     = useState([]);
  const [ready, setReady]   = useState(false);
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState(null);
  const [tab, setTab]       = useState("ZONE");   // ZONE | LINE | MACHINE
  // KPI filter buttons between the form and the saved list — the list shows
  // only the selected KPI's targets.  Default on refresh = MTTR.
  const [kpiFilter, setKpiFilter] = useState("mttr_minutes");

  const EMPTY = {
    fy: MKT_DEFAULT_FY,
    zone_name: "", line_name: "", serial_no: "",
    kpi_key: MKT_KPIS[0].key, target_value: "",
  };
  const [form, setForm] = useState(EMPTY);

  // Machine Master List — the single source for zone / line / machine.
  const loadMaster = useCallback(async () => {
    try {
      const m = await api.get("/api/machines/", token);
      setMaster(Array.isArray(m) ? m : []);
    } catch (e) { toast(e.message || "Load failed", "err"); }
    finally    { setReady(true); }
  }, [token, toast]);

  // Saved rows for the chosen FY — reloads on FY change / after save.
  const loadRows = useCallback(async () => {
    if (!form.fy) { setRows([]); return; }
    try {
      const r = await api.get(`/api/maintenance-kpi-target/?fy=${encodeURIComponent(form.fy)}`, token);
      setRows(Array.isArray(r) ? r : []);
    } catch (e) { toast(e.message || "Load failed", "err"); }
  }, [token, toast, form.fy]);

  useEffect(() => { loadMaster(); }, [loadMaster]);
  useEffect(() => { loadRows();  }, [loadRows]);

  // Cascading options derived entirely from the Machine Master List.
  // Only the six production zones are target-able — the other master zones
  // (LAB / STORE / UTILITY / TOOL_ROOM / …) are hidden from the selection.
  const MKT_ZONES = ["SEAT_SLIDER", "RECLINER", "SUB_ASSEMBLY",
                     "PRESS_SHOP", "LOOP_PIPE", "THIN_RECLINER"];
  const zoneOpts = [...new Set(master.map(m => m.zone_name).filter(Boolean))]
    .filter(z => MKT_ZONES.includes(z))
    .sort((a, b) => MKT_ZONES.indexOf(a) - MKT_ZONES.indexOf(b));
  const lineOpts = form.zone_name
    ? [...new Set(master.filter(m => m.zone_name === form.zone_name)
                        .map(m => m.line_name).filter(Boolean))].sort()
    : [];
  const machineOpts = (form.zone_name && form.line_name)
    ? master.filter(m => m.zone_name === form.zone_name && m.line_name === form.line_name)
            .sort((a, b) => (a.serial_no || 0) - (b.serial_no || 0))
    : [];

  const onZone = (v) => setForm(f => ({ ...f, zone_name: v, line_name: "", serial_no: "" }));
  const onLine = (v) => setForm(f => ({ ...f, line_name: v, serial_no: "" }));

  // After save (or tab switch) keep the selected KPI in the form — only the
  // zone/line/machine + value clear, so the next entry for the same KPI is quick.
  const resetForm = () => { setEditId(null); setForm(f => ({ ...EMPTY, fy: f.fy, kpi_key: kpiFilter })); };
  const pickTab = (t) => {
    setTab(t); setEditId(null);
    setForm(f => ({ ...EMPTY, fy: f.fy, kpi_key: kpiFilter }));
  };

  const kpiLabel = (k) => MKT_KPIS.find(x => x.key === k)?.label || k;

  const onEdit = (r) => {
    setTab(r.level || "ZONE");
    setEditId(r.id);
    setForm({
      fy: r.fy,
      zone_name:    r.zone_name ?? "",
      line_name:    r.line_name ?? "",
      serial_no:    r.serial_no ?? "",
      kpi_key:      r.kpi_key ?? MKT_KPIS[0].key,
      target_value: r.target_value ?? "",
    });
  };

  const save = async () => {
    if (!form.fy)        { toast("Select a Financial Year", "err"); return; }
    if (!form.zone_name) { toast("Select a Zone", "err"); return; }
    if (tab !== "ZONE"   && !form.line_name)        { toast("Select a Line", "err"); return; }
    if (tab === "MACHINE" && form.serial_no === "") { toast("Select a Machine", "err"); return; }
    if (!form.kpi_key)   { toast("Select a KPI", "err"); return; }
    if (form.target_value === "" || form.target_value == null) {
      toast("Enter the Target value", "err"); return;
    }
    const useLine = tab !== "ZONE";
    const useMach = tab === "MACHINE";
    const sno = useMach && form.serial_no !== "" ? Number(form.serial_no) : null;
    const machine = sno != null
      ? machineOpts.find(m => String(m.serial_no) === String(form.serial_no))
      : null;
    // One target per (FY + scope + KPI): block a duplicate fill with a popup.
    if (!editId) {
      const dup = rows.find(r =>
        r.fy === form.fy &&
        r.kpi_key === form.kpi_key &&
        r.zone_name === form.zone_name &&
        String(r.line_name ?? "") === String(useLine ? (form.line_name || "") : "") &&
        String(r.serial_no ?? "") === String(sno ?? ""));
      if (dup) {
        const scope = form.zone_name + (useLine && form.line_name ? ` / ${form.line_name}` : "")
                    + (machine?.machine_no ? ` / ${machine.machine_no}` : "");
        window.alert(`⚠ Target already filled!\n\n${kpiLabel(form.kpi_key)} for ${scope} in FY ${form.fy} is already set (value: ${dup.target_value}).\n\nIt can be filled only ONCE per financial year — use the Edit button in the list to change it.`);
        return;
      }
    }
    setSaving(true);
    try {
      const body = {
        fy:           form.fy,
        zone_name:    form.zone_name,
        line_name:    useLine ? (form.line_name || null) : null,
        serial_no:    sno,
        machine_no:   machine?.machine_no || null,
        machine_name: machine?.machine_name || null,
        kpi_key:      form.kpi_key,
        target_value: Number(form.target_value),
      };
      if (editId) await api.put(`/api/maintenance-kpi-target/${editId}`, body, token);
      else        await api.post(`/api/maintenance-kpi-target/`, body, token);
      toast(editId ? "Updated ✓" : "Saved ✓");
      resetForm();
      loadRows();
    } catch (e) {
      const msg = e.message || "Save failed";
      if (msg.includes("already filled") || msg.includes("once per financial year")) window.alert(`⚠ ${msg}`);
      else toast(msg, "err");
    }
    finally    { setSaving(false); }
  };

  const remove = async (r) => {
    if (!confirm(`Delete this ${(r.level||"").toLowerCase()} target (${kpiLabel(r.kpi_key)} · ${r.zone_name})?`)) return;
    try { await api.delete(`/api/maintenance-kpi-target/${r.id}`, token); toast("Removed"); loadRows(); }
    catch (e) { toast(e.message || "Delete failed", "err"); }
  };

  const machineCell = (r) => {
    if (r.machine_no == null && r.serial_no == null) return "—";
    const parts = [r.machine_no || `No. ${r.serial_no}`];
    if (r.machine_name) parts.push(r.machine_name);
    return parts.join(" · ");
  };
  const lbl = {fontSize:11,fontWeight:700,letterSpacing:".04em",textTransform:"uppercase",
               color:"#64748b",marginBottom:5,display:"block"};
  const grid = {display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(180px, 1fr))",gap:16};

  const tabAccent = MKT_TABS.find(t => t.key === tab)?.accent || "#1e40af";
  const tabRows   = rows.filter(r => r.level === tab && r.fy === form.fy
                                  && r.kpi_key === kpiFilter);
  const headers = ["FY", "Zone"]
    .concat(tab !== "ZONE"   ? ["Line"] : [])
    .concat(tab === "MACHINE" ? ["Machine No"] : [])
    .concat(["KPI", "Target Value"])
    .concat(readOnly ? [] : ["Actions"]);

  if (!ready) return <Spinner />;

  return (
    <div>
      {/* ── Header · Financial Year · Save (top) ─────────────────── */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",marginBottom:14,gap:16,flexWrap:"wrap"}}>
        <div>
          <div style={{fontWeight:700,fontSize:15,color:"#0f172a"}}>KPI Target</div>
          <div style={{fontSize:11,color:"#64748b",marginTop:2,maxWidth:760,lineHeight:1.5}}>
            Pick a <b>Financial Year</b>, choose a tab (<b>Zone / Line / Machine</b>), set the scope
            from the <b>Machine Master List</b>, pick a <b>KPI</b>, enter the <b>Target value</b> and Save.
          </div>
        </div>
        <div style={{display:"flex",alignItems:"flex-end",gap:12,flexWrap:"wrap"}}>
          <div>
            <label style={lbl}>Financial Year *</label>
            <Select value={form.fy} onChange={e=>setForm(f=>({...f,fy:e.target.value}))}
                    style={{minWidth:160,fontWeight:700}}>
              {MKT_FYS.map(y => <option key={y} value={y}>{y}</option>)}
            </Select>
          </div>
          {!readOnly && (
            <Btn variant="primary" onClick={save} disabled={saving}>
              {saving ? "Saving…" : editId ? "Update" : "Save"}
            </Btn>
          )}
        </div>
      </div>

      {/* ── Tabs: Zone / Line / Machine ──────────────────────────── */}
      <div style={{display:"flex",gap:6,marginBottom:16,borderBottom:"2px solid #eef2f7"}}>
        {MKT_TABS.map(t => (
          <button key={t.key} onClick={()=>pickTab(t.key)}
            style={{padding:"8px 20px",border:"none",background:"none",cursor:"pointer",
                    fontFamily:"'Barlow Condensed',sans-serif",fontWeight:800,fontSize:15,
                    letterSpacing:".04em",textTransform:"uppercase",
                    color: tab===t.key ? t.accent : "#94a3b8",
                    borderBottom: tab===t.key ? `3px solid ${t.accent}` : "3px solid transparent",
                    marginBottom:-2}}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── The form (fields depend on the active tab) ───────────── */}
      {!readOnly && (
        <Card>
          {editId && (
            <div style={{marginBottom:14,fontSize:12,fontWeight:700,color:tabAccent,display:"flex",alignItems:"center",gap:10}}>
              Editing a saved {tab.toLowerCase()} target — change values and press Update.
              <Btn size="sm" onClick={resetForm}>New entry</Btn>
            </div>
          )}
          <div style={grid}>
            <div>
              <label style={lbl}>Zone *</label>
              <Select value={form.zone_name} onChange={e=>onZone(e.target.value)}>
                <option value="">Select zone…</option>
                {zoneOpts.map(z => <option key={z} value={z}>{z}</option>)}
              </Select>
            </div>
            {tab !== "ZONE" && (
              <div>
                <label style={lbl}>Line *</label>
                <Select value={form.line_name} disabled={!form.zone_name} onChange={e=>onLine(e.target.value)}>
                  <option value="">Select line…</option>
                  {lineOpts.map(l => <option key={l} value={l}>{l}</option>)}
                </Select>
              </div>
            )}
            {tab === "MACHINE" && (
              <div>
                <label style={lbl}>Machine No *</label>
                <Select value={form.serial_no} disabled={!form.line_name}
                        onChange={e=>setForm(f=>({...f,serial_no:e.target.value}))}>
                  <option value="">Select machine…</option>
                  {machineOpts.map(m => <option key={m.id} value={m.serial_no}>{m.machine_no || `No. ${m.serial_no}`}</option>)}
                </Select>
              </div>
            )}
            <div>
              <label style={lbl}>KPI *</label>
              <Select value={form.kpi_key} onChange={e=>setForm(f=>({...f,kpi_key:e.target.value}))}>
                {MKT_KPIS.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}
              </Select>
            </div>
            <div>
              <label style={lbl}>Target value *</label>
              <Input type="number" step="any" placeholder="enter value" value={form.target_value}
                     onChange={e=>setForm(f=>({...f,target_value:e.target.value}))}/>
            </div>
          </div>
        </Card>
      )}

      {/* ── KPI filter buttons — the list below shows only this KPI ── */}
      <div style={{display:"flex",gap:8,flexWrap:"wrap",margin:"20px 0 4px"}}>
        {MKT_KPIS.map(k => (
          /* selecting a KPI button also pre-fills the form's KPI (still
             manually changeable in the dropdown above) */
          <button key={k.key} onClick={()=>{ setKpiFilter(k.key); setForm(f=>({...f, kpi_key:k.key})); }}
            style={{padding:"8px 18px",borderRadius:99,cursor:"pointer",fontSize:12.5,fontWeight:800,
                    fontFamily:"'Barlow',sans-serif",transition:"all .12s",
                    border:`1.5px solid ${kpiFilter===k.key ? tabAccent : "#cbd5e1"}`,
                    background: kpiFilter===k.key ? tabAccent : "#fff",
                    color: kpiFilter===k.key ? "#fff" : "#475569"}}>
            {k.label}
          </button>
        ))}
      </div>

      {/* ── Saved targets for this tab + FY + KPI ─────────────────── */}
      <div style={{margin:"14px 0 10px",fontWeight:800,fontSize:13,color:tabAccent,textTransform:"uppercase",letterSpacing:".05em"}}>
        Saved {MKT_TABS.find(t=>t.key===tab)?.label} Targets · {kpiLabel(kpiFilter)} · FY {form.fy}
      </div>
      <Card>
        {tabRows.length === 0 ? (
          <EmptyState text={`No ${tab.toLowerCase()} ${kpiLabel(kpiFilter)} targets saved yet`} sub={`for FY ${form.fy}`} />
        ) : (
          /* One KPI group (all zones) visible at a time — scrolling SNAPS to
             the next KPI's group (MTTR → MTBF → LTTR → …); the header row
             stays pinned while scrolling. */
          <div style={{overflowX:"auto", ...(tabRows.length > 6 ? {maxHeight:300, overflowY:"auto", scrollSnapType:"y mandatory"} : {})}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:13,minWidth:560}}>
            <thead>
              <tr>{headers.map((h,i)=>(
                <th key={i} style={{padding:"9px 12px",textAlign:"left",fontSize:10,fontWeight:700,letterSpacing:".08em",textTransform:"uppercase",color:"#64748b",borderBottom:"2px solid #e2e8f0",position:"sticky",top:0,background:"#fff",zIndex:2}}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {tabRows.map((r, i) => (
                <tr key={r.id} style={{borderBottom:"1px solid #f1f5f9",
                    /* first row of each KPI group = scroll snap point */
                    ...((i === 0 || tabRows[i-1].kpi_key !== r.kpi_key)
                        ? {scrollSnapAlign:"start", scrollMarginTop:34} : {})}}>
                  <td style={{padding:"9px 12px",fontWeight:700,color:"#334155"}}>{r.fy}</td>
                  <td style={{padding:"9px 12px",color:"#0f172a",fontWeight:700}}>{r.zone_name}</td>
                  {tab !== "ZONE"   && <td style={{padding:"9px 12px",color:"#334155"}}>{r.line_name || "—"}</td>}
                  {tab === "MACHINE" && <td style={{padding:"9px 12px",color:"#334155"}}>{machineCell(r)}</td>}
                  <td style={{padding:"9px 12px",fontWeight:700,color:"#0f172a"}}>{kpiLabel(r.kpi_key)}</td>
                  <td style={{padding:"9px 12px",fontFamily:"'Barlow Condensed',sans-serif",fontSize:18,fontWeight:800,color:tabAccent}}>{r.target_value}</td>
                  {!readOnly && (
                    <td style={{padding:"9px 12px"}}>
                      <div style={{display:"flex",gap:6}}>
                        <Btn size="sm" onClick={()=>onEdit(r)}>Edit</Btn>
                        <Btn size="sm" variant="danger" onClick={()=>remove(r)}>Delete</Btn>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </Card>
    </div>
  );
}

