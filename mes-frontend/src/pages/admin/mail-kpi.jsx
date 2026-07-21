/* admin/mail-kpi.jsx — Breakdown Mails (+NgMailConfig) · KPI Targets ·
   CAPA Settings · New PY Requests. */
import { useState, useEffect, useRef, useCallback, useMemo, Fragment } from "react";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../api/client";
import {
  PageHeading, Card, Pill, Btn, FF, Input, Select,
  Modal, ModalActions, Toast, EmptyState, Spinner, ExcelImportButton,
} from "./ui";

function NgMailConfig() {
  const lineId = 2;   // YNC-SS
  const token = (typeof window !== "undefined" && sessionStorage.getItem("mes_token")) || "";
  const [to, setTo]         = useState("");
  const [cc, setCc]         = useState("");
  const [meta, setMeta]     = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg]       = useState("");

  useEffect(() => {
    fetch(`/api/lines/${lineId}/quality-mail-config`,
          { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(r => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then(d => { setTo(d.to_emails || d.env_to || ""); setCc(d.cc_emails || d.env_cc || "");
                   setMeta(d); })
      .catch(() => {});
  }, [token]);

  const saveCfg = () => {
    if (!token) { setMsg("✗ Login required"); return; }
    setSaving(true); setMsg("");
    fetch(`/api/lines/${lineId}/quality-mail-config`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ to_emails: to.trim(), cc_emails: cc.trim() }),
    })
      .then(r => r.ok ? r.json() : r.text().then(t => Promise.reject(t)))
      .then(d => { setMsg("✓ Saved successfully");
                   setMeta(m => ({ ...(m || {}), updated_by: d.updated_by,
                                   updated_at: new Date().toISOString() })); })
      .catch(e => setMsg("✗ " + String(e).slice(0, 160)))
      .finally(() => setSaving(false));
  };

  const lab = { fontSize: 10, fontWeight: 700, color: "#475569",
                textTransform: "uppercase", letterSpacing: ".05em" };
  const inp = { width: "100%", padding: "6px 10px", fontSize: 13, borderRadius: 6,
                border: "1px solid #cbd5e1", marginTop: 3, boxSizing: "border-box" };
  return (
    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8,
                  padding: "14px 16px", marginTop: 16, boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
      <div style={{ fontWeight: 700, fontSize: 15, color: "#0f172a" }}>NG → Quality Mail Recipients</div>
      <div style={{ fontSize: 11, color: "#64748b", marginTop: 2, marginBottom: 10 }}>
        These addresses receive the “Send to Quality” NG report.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8, alignItems: "end" }}>
        <div>
          <label style={lab}>To (comma-separated)</label>
          <input value={to} onChange={e => setTo(e.target.value)}
                 placeholder="quality@co.com, lead@co.com" style={inp} />
        </div>
        <div>
          <label style={lab}>Cc (optional)</label>
          <input value={cc} onChange={e => setCc(e.target.value)}
                 placeholder="optional" style={inp} />
        </div>
        <button onClick={saveCfg} disabled={saving} style={{
          padding: "8px 18px", borderRadius: 6, border: "none", background: "#16a34a",
          color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", height: 34 }}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
      <div style={{ fontSize: 10, marginTop: 6,
                    color: msg.startsWith("✓") ? "#16a34a"
                         : msg.startsWith("✗") ? "#dc2626" : "#94a3b8" }}>
        {msg || (meta && meta.updated_at
          ? `Last updated by ${meta.updated_by || "—"} · ${new Date(meta.updated_at).toLocaleString("en-IN")}`
          : "")}
      </div>
    </div>
  );
}

export function BreakdownMailsPage({ toast, readOnly = false }) {
  const { token } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState(null);

  const EMPTY = {
    level_no: "", label: "", delay_minutes: 0,
    to_addresses: "", cc_addresses: "", is_active: true,
  };
  const [form, setForm] = useState(EMPTY);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/api/breakdown-mails/", token);
      setRows(Array.isArray(r) ? r : []);
    } catch (e) { toast(e.message || "Load failed", "err"); }
    finally    { setLoading(false); }
  }, [token, toast]);
  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    const nextLvl = rows.length ? Math.max(...rows.map(r => r.level_no || 0)) + 1 : 1;
    setEditing(null);
    setForm({ ...EMPTY, level_no: nextLvl,
              delay_minutes: nextLvl === 1 ? 0 : (nextLvl - 1) * 10 });
    setModal(true);
  };
  const openEdit = (r) => {
    setEditing(r);
    setForm({
      level_no:      r.level_no,
      label:         r.label || "",
      delay_minutes: r.delay_minutes ?? 0,
      to_addresses:  r.to_addresses || "",
      cc_addresses:  r.cc_addresses || "",
      is_active:     r.is_active !== false,
    });
    setModal(true);
  };

  const save = async () => {
    if (!form.level_no || form.level_no < 1) {
      toast("Level No. is required and must be ≥ 1", "err"); return;
    }
    if (form.delay_minutes < 0) {
      toast("Delay must be ≥ 0", "err"); return;
    }
    setSaving(true);
    try {
      const body = {
        level_no:      Number(form.level_no),
        label:         form.label?.trim() || null,
        delay_minutes: Number(form.delay_minutes) || 0,
        to_addresses:  form.to_addresses || "",
        cc_addresses:  form.cc_addresses || "",
        is_active:     !!form.is_active,
      };
      if (editing) await api.put(`/api/breakdown-mails/${editing.id}`, body, token);
      else         await api.post("/api/breakdown-mails/", body, token);
      toast(editing ? "Updated ✓" : "Added ✓");
      setModal(false);
      load();
    } catch (e) { toast(e.message || "Save failed", "err"); }
    finally    { setSaving(false); }
  };

  const remove = async (r) => {
    if (!confirm(`Delete escalation Level ${r.level_no}${r.label?` — ${r.label}`:""}?`)) return;
    try {
      await api.delete(`/api/breakdown-mails/${r.id}`, token);
      toast("Removed");
      load();
    } catch (e) { toast(e.message || "Delete failed", "err"); }
  };

  const sendTest = async (r) => {
    if (!confirm(`Send a test email for Level ${r.level_no} to:\n  To: ${r.to_addresses || "(none)"}\n  Cc: ${r.cc_addresses || "(none)"}`)) return;
    setTestingId(r.id);
    try {
      await api.post(`/api/breakdown-mails/${r.id}/test`, {}, token);
      toast("Test email sent ✓");
    } catch (e) { toast(e.message || "Send failed", "err"); }
    finally    { setTestingId(null); }
  };

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,gap:10,flexWrap:"wrap"}}>
        <div>
          <div style={{fontWeight:700,fontSize:15,color:"#0f172a"}}>Breakdown Escalation Mails</div>
          <div style={{fontSize:11,color:"#64748b",marginTop:2,maxWidth:760,lineHeight:1.5}}>
            Defines the chain of emails that fire while a line is in BREAKDOWN status.&nbsp;
            Level 1 (delay&nbsp;=&nbsp;0) fires the moment the breakdown is detected; subsequent
            levels fire after their <b>delay (minutes)</b> elapses, but only if the line is
            <i> still down</i>.&nbsp; If the line returns to RUNNING before a level fires, that
            level (and all later ones) is skipped.
          </div>
        </div>
        <Btn variant="primary" onClick={openCreate}>+ Add Level</Btn>
      </div>

      <Card>
        {loading ? <Spinner /> : rows.length === 0 ? (
          <EmptyState text="No escalation levels configured" sub="Add at least one — typically L1 immediate, L2 +10m, L3 +20m, etc." />
        ) : (
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
            <thead>
              <tr>{["Level","Label","Delay","To","Cc","Active","Actions"].map(h=>(
                <th key={h} style={{padding:"10px 14px",textAlign:"left",fontSize:10,fontWeight:700,letterSpacing:".08em",textTransform:"uppercase",color:"#64748b",borderBottom:"2px solid #e2e8f0"}}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} style={{borderBottom:"1px solid #f1f5f9", opacity: r.is_active ? 1 : 0.5}}>
                  <td style={{padding:"10px 14px",fontFamily:"'Barlow Condensed',sans-serif",fontSize:18,fontWeight:800,color:"#dc2626"}}>L{r.level_no}</td>
                  <td style={{padding:"10px 14px",fontWeight:700,color:"#0f172a"}}>{r.label || <span style={{color:"#cbd5e1"}}>—</span>}</td>
                  <td style={{padding:"10px 14px"}}>
                    <span style={{padding:"3px 10px",borderRadius:99,fontSize:11,fontWeight:700,background:"rgba(217,119,6,.10)",color:"#b45309",fontFamily:"monospace"}}>
                      {r.delay_minutes === 0 ? "Immediate" : `+${r.delay_minutes}m`}
                    </span>
                  </td>
                  <td style={{padding:"10px 14px",fontFamily:"monospace",fontSize:11,color:r.to_addresses?"#16a34a":"#dc2626",maxWidth:300,wordBreak:"break-all"}}>
                    {r.to_addresses || <span style={{color:"#dc2626"}}>&lt;not set&gt;</span>}
                  </td>
                  <td style={{padding:"10px 14px",fontFamily:"monospace",fontSize:11,color:"#64748b",maxWidth:240,wordBreak:"break-all"}}>
                    {r.cc_addresses || <span style={{color:"#cbd5e1"}}>—</span>}
                  </td>
                  <td style={{padding:"10px 14px",fontWeight:700,fontSize:11,color:r.is_active?"#16a34a":"#94a3b8"}}>
                    {r.is_active ? "Yes" : "Off"}
                  </td>
                  <td style={{padding:"10px 14px"}}>
                    <div style={{display:"flex",gap:6}}>
                      <Btn size="sm" onClick={()=>openEdit(r)}>Edit</Btn>
                      <Btn size="sm" disabled={testingId===r.id || !r.to_addresses}
                            onClick={()=>sendTest(r)}>
                        {testingId===r.id ? "Sending…" : "Send Test"}
                      </Btn>
                      <Btn size="sm" variant="danger" onClick={()=>remove(r)}>Delete</Btn>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* 2026-06-09 — NG → Quality mail recipients (set live, no restart) */}
      <NgMailConfig />

      <Modal open={modal} onClose={()=>setModal(false)}
             title={editing ? `Edit Level ${editing.level_no}` : "Add Escalation Level"} wide>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
          <FF label="Level No. *" hint="Order in the chain — L1 fires first.">
            <Input type="number" value={form.level_no}
                   onChange={e=>setForm(f=>({...f,level_no:e.target.value}))}/>
          </FF>
          <FF label="Delay (minutes) *" hint="Minutes after breakdown started_at. 0 = fire immediately.">
            <Input type="number" value={form.delay_minutes}
                   onChange={e=>setForm(f=>({...f,delay_minutes:e.target.value}))}
                   placeholder="0"/>
          </FF>
          <div style={{ gridColumn:"1 / -1" }}>
            <FF label="Label (optional)" hint="Shown in the email subject + admin grid.">
              <Input value={form.label}
                     onChange={e=>setForm(f=>({...f,label:e.target.value}))}
                     placeholder="e.g. HOD Maintenance"/>
            </FF>
          </div>
          <div style={{ gridColumn:"1 / -1" }}>
            <FF label="To addresses *" hint="Comma-separated list (e.g. a@x.com, b@x.com)">
              <Input value={form.to_addresses}
                     onChange={e=>setForm(f=>({...f,to_addresses:e.target.value}))}
                     placeholder="hod.maint@plant.com, supervisor@plant.com"/>
            </FF>
          </div>
          <div style={{ gridColumn:"1 / -1" }}>
            <FF label="Cc addresses (optional)" hint="Comma-separated list">
              <Input value={form.cc_addresses}
                     onChange={e=>setForm(f=>({...f,cc_addresses:e.target.value}))}
                     placeholder="plant.head@plant.com"/>
            </FF>
          </div>
          <div style={{ gridColumn:"1 / -1", marginTop:4 }}>
            <label style={{ display:"flex", alignItems:"center", gap:8, fontSize:13, cursor:"pointer" }}>
              <input type="checkbox" checked={!!form.is_active}
                     onChange={e=>setForm(f=>({...f,is_active:e.target.checked}))}/>
              Active &nbsp;<span style={{color:"#94a3b8",fontSize:11,fontWeight:400}}>
                — uncheck to keep the level configured but stop it from firing.
              </span>
            </label>
          </div>
        </div>
        <ModalActions>
          <Btn onClick={()=>setModal(false)}>Cancel</Btn>
          <Btn variant="primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : editing ? "Update" : "Add Level"}
          </Btn>
        </ModalActions>
      </Modal>
    </div>
  );
}


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
    fy: MKT_FYS[0],
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


// ─── CAPA SETTINGS PAGE ───────────────────────────────────────
// Admin-editable Pareto cutoff %.  The /api/capa/pareto-config endpoint
// is the single source of truth — the same value is shown (read-only)
// on the Maintenance CAPA page's Pareto chart, and editing it here
// instantly reflects there via the global ap-config-changed event.
//
// Why split this out: the user wanted the *threshold* command to live
// in the Admin Maintenance Panel, not on the Maintenance dashboard
// itself.  Maintenance dept users never see this tab (the Maintenance
// section in their /admin/maintenance is rendered read-only), but they
// see the live value in their CAPA Pareto chart.
export function CapaSettingsPage({ toast, readOnly = false }) {
  const { token } = useAuth();
  // All three GLOBAL knobs come from /api/capa/pareto-config — single
  // PUT updates them as a unit so admin has one save button.
  const [pct,     setPct]     = useState(80);
  const [monthly, setMonthly] = useState(120);
  const [single,  setSingle]  = useState(60);
  const [original, setOrig]   = useState({ pct:80, monthly:120, single:60 });
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get("/api/capa/pareto-config", token);
      setPct    (r.pareto_pct                     ?? 80);
      setMonthly(r.monthly_sum_minutes_limit      ?? 120);
      setSingle (r.single_breakdown_minutes_limit ?? 60);
      setOrig({ pct: r.pareto_pct ?? 80,
                monthly: r.monthly_sum_minutes_limit ?? 120,
                single:  r.single_breakdown_minutes_limit ?? 60 });
    } catch { toast?.("Failed to load CAPA settings", "err"); }
    finally { setLoading(false); }
  }, [token, toast]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (pct     < 1 || pct     > 100)    { toast?.("Pareto cutoff must be 1–100", "err"); return; }
    if (monthly < 1 || monthly > 99999)  { toast?.("Monthly threshold must be 1–99999 min", "err"); return; }
    if (single  < 1 || single  > 99999)  { toast?.("Single threshold must be 1–99999 min", "err"); return; }
    setSaving(true);
    try {
      await api.put("/api/capa/pareto-config", {
        pareto_pct: pct,
        monthly_sum_minutes_limit:      monthly,
        single_breakdown_minutes_limit: single,
      }, token);
      toast?.("CAPA settings saved ✓");
      setOrig({ pct, monthly, single });
    } catch (e) { toast?.(e.message || "Save failed", "err"); }
    finally   { setSaving(false); }
  };

  const dirty = pct !== original.pct
             || monthly !== original.monthly
             || single  !== original.single;
  const reset = () => { setPct(original.pct); setMonthly(original.monthly); setSingle(original.single); };

  return (
    <div className={readOnly ? "ap-readonly" : ""}>
      <fieldset disabled={readOnly} style={{border:0, padding:0, margin:0, minWidth:0}}>
      <Card style={{ padding: 24 }}>
        <div style={{ fontSize:14, fontWeight:700, color:"#0f172a", marginBottom:6 }}>
          CAPA Thresholds &amp; Auto-Mandate Cutoff
        </div>
        <div style={{ fontSize:12, color:"#64748b", marginBottom:22, lineHeight:1.5 }}>
          Three numbers drive every CAPA in the plant.  Per-line and
          per-machine rows can override these globals from <b>POST /api/capa/thresholds</b>;
          this page edits the GLOBAL defaults that apply when no override exists.
        </div>

        {loading ? (
          <Spinner/>
        ) : (
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",
                         gap:18, marginBottom:18 }}>
            {/* Monthly sum threshold */}
            <FF label="Monthly Sum Threshold (min)"
                hint="Per-machine breakdown ceiling per calendar month. Crosses this → joins the breached cohort.">
              <Input type="number" min="1" max="99999"
                     value={monthly}
                     onChange={e => setMonthly(Number(e.target.value) || 0)}
                     style={{ fontFamily:"monospace", fontWeight:700,
                              fontSize:20, textAlign:"center" }}/>
            </FF>

            {/* Single breakdown threshold */}
            <FF label="Single Breakdown Threshold (min)"
                hint="Per-event ceiling. A single closed breakdown crossing this fires an immediate SINGLE_LIMIT CAPA.">
              <Input type="number" min="1" max="99999"
                     value={single}
                     onChange={e => setSingle(Number(e.target.value) || 0)}
                     style={{ fontFamily:"monospace", fontWeight:700,
                              fontSize:20, textAlign:"center" }}/>
            </FF>

            {/* Pareto cutoff % */}
            <FF label="Pareto Cutoff %"
                hint="Of the breached cohort, the top N% by cumulative breakdown minutes MUST file CAPA.">
              <Input type="number" min="1" max="100"
                     value={pct}
                     onChange={e => setPct(Number(e.target.value) || 0)}
                     style={{ fontFamily:"monospace", fontWeight:700,
                              fontSize:20, textAlign:"center" }}/>
            </FF>
          </div>
        )}

        <div style={{ display:"flex", gap:10, alignItems:"center" }}>
          <Btn variant="primary" onClick={save} disabled={saving || !dirty}>
            {saving ? "Saving…" : dirty ? "Save Changes" : "Saved ✓"}
          </Btn>
          {dirty && <Btn onClick={reset}>Cancel</Btn>}
          {!dirty && !loading && (
            <span style={{ fontSize:11, color:"#94a3b8" }}>
              No pending changes
            </span>
          )}
        </div>

        <div style={{ marginTop:26, padding:14, background:"#f8fafc",
                       border:"1px solid #e2e8f0", borderRadius:10 }}>
          <div style={{ fontSize:11, fontWeight:700, color:"#64748b",
                         letterSpacing:".08em", textTransform:"uppercase",
                         marginBottom:8 }}>
            How it works
          </div>
          <div style={{ fontSize:12, color:"#334155", lineHeight:1.7 }}>
            <div>1.  The collector aggregates closed breakdown minutes per machine for the calendar month.</div>
            <div>2.  Each calendar month resets every machine's counter to 0 on the 1st.</div>
            <div>3.  Machines whose monthly sum &gt; <b style={{color:"#dc2626"}}>{monthly} min</b> join the breached cohort.</div>
            <div>4.  Any single closed breakdown &gt; <b style={{color:"#dc2626"}}>{single} min</b> fires an immediate SINGLE_LIMIT CAPA.</div>
            <div>5.  The cohort is sorted descending by total breakdown minutes.</div>
            <div>6.  Cumulative % is computed across the breached cohort only.</div>
            <div>7.  The top <b style={{color:"#dc2626"}}>{pct}%</b> of cumulative time → <b>must file CAPA / QPR</b>.</div>
          </div>
        </div>
      </Card>
      </fieldset>
    </div>
  );
}


// ─── BREAKDOWN SLIP RAISE THRESHOLD ───────────────────────────
// Operator's clarified ask:
//
//   "Some breakdowns get fixed in 5–10 minutes — those don't need a
//    full slip.  Set ONE threshold: if a breakdown takes LONGER than
//    X minutes to resolve, the formal slip is RAISED (full closure
//    form mandatory).  Below X minutes, only Production logs basic
//    details — no slip needed."
//
// So this page exposes a single integer (default 10 min).  The
// breakdown lifecycle endpoints will read this to decide whether to
// move a resolved breakdown straight to CLOSED (tier='MINOR') or to
// RESOLVED with a mandatory slip (tier='MAJOR').

// ════════════════════════════════════════════════════════════════════
// NewRequestsPanel — admin's audit panel for PY remarks submitted
// from the Maintenance > Poka Yoke page.
// 2026-05-21 — Operator spec: "remarks ka option if any changes are
// required so mention changes are save in audit panel name as new
// panel new requests jisme sari details ho bs mujhe vha jha k pta
// chal jaye ki whats are input from users".
//
// Endpoints used:
//   GET    /api/poka-yoke/requests?status=NEW|REVIEWED|RESOLVED&days=N
//   PUT    /api/poka-yoke/requests/{id}/resolve  body={status, note}
//   DELETE /api/poka-yoke/requests/{id}
// ════════════════════════════════════════════════════════════════════
export function NewRequestsPanel({ toast, readOnly = false }) {
  const { token } = useAuth();
  const [rows,    setRows]    = useState([]);
  const [counts,  setCounts]  = useState({});
  const [loading, setLoading] = useState(true);
  const [filter,  setFilter]  = useState("NEW");   // NEW | REVIEWED | RESOLVED | ALL
  const [days,    setDays]    = useState(30);
  const [expanded,setExpanded]= useState({});      // {id: bool}
  const [resolveModal, setResolveModal] = useState(null);  // {req, status}
  const [noteText, setNoteText] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = `days=${days}` + (filter !== "ALL" ? `&status=${filter}` : "");
      const r = await api.get(`/api/poka-yoke/requests?${qs}`, token);
      setRows(r?.rows || []);
      setCounts(r?.by_status || {});
    } catch (e) {
      if (toast) toast(`Failed to load: ${String(e).slice(0, 60)}`, "err");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filter, days, token, toast]);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh every 30 s
  useEffect(() => {
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  const onResolveSubmit = async () => {
    if (!resolveModal) return;
    const { req, status } = resolveModal;
    try {
      await api.put(`/api/poka-yoke/requests/${req.id}/resolve`, token, {
        status, resolution_note: noteText.trim() || null,
      });
      if (toast) toast(`Request #${req.id} → ${status}`, "ok");
      setResolveModal(null);
      setNoteText("");
      load();
    } catch (e) {
      if (toast) toast(`Update failed: ${String(e).slice(0, 60)}`, "err");
    }
  };

  const onDelete = async (req) => {
    if (!confirm(`Delete request #${req.id} (PY ${req.py_no})?  Cannot be undone.`)) return;
    try {
      await api.delete(`/api/poka-yoke/requests/${req.id}`, token);
      if (toast) toast(`Deleted #${req.id}`, "ok");
      load();
    } catch (e) {
      if (toast) toast(`Delete failed: ${String(e).slice(0, 60)}`, "err");
    }
  };

  const fmt = (ts) => {
    if (!ts) return "—";
    try {
      const d = new Date(ts);
      return d.toLocaleString("en-GB", { day:"2-digit", month:"short",
                                          year:"2-digit", hour:"2-digit",
                                          minute:"2-digit" });
    } catch { return ts; }
  };

  const statusPill = (s) => {
    const colors = {
      NEW:      { bg:"#fef3c7", fg:"#92400e" },
      REVIEWED: { bg:"#dbeafe", fg:"#1e40af" },
      RESOLVED: { bg:"#d1fae5", fg:"#065f46" },
    };
    const c = colors[s] || colors.NEW;
    return (
      <span style={{
        fontSize:10, fontWeight:800, padding:"3px 9px",
        borderRadius:99, background:c.bg, color:c.fg,
        letterSpacing:".05em",
      }}>{s}</span>
    );
  };

  return (
    <div style={{ padding:"16px 40px" }}>
      <div style={{
        display:"flex", alignItems:"center", justifyContent:"space-between",
        marginBottom:14,
      }}>
        <div>
          <h2 style={{ fontSize:22, fontWeight:800, color:"#0f172a", margin:0 }}>
            📝 New Requests — Maintenance Audit
          </h2>
          <p style={{ fontSize:12, color:"#64748b", margin:"4px 0 0 0" }}>
            Operator-submitted PY remarks &amp; change requests.  Auto-refresh every 30 s.
          </p>
        </div>
        <button onClick={load}
                style={{
                  fontSize:12, padding:"6px 14px",
                  background:"#0369a1", color:"#fff",
                  border:"none", borderRadius:6, cursor:"pointer",
                  fontWeight:700,
                }}>
          ↻ Refresh
        </button>
      </div>

      {/* Filter chips */}
      <div style={{ display:"flex", gap:8, marginBottom:14, alignItems:"center",
                     flexWrap:"wrap" }}>
        {["NEW", "REVIEWED", "RESOLVED", "ALL"].map(s => {
          const active = filter === s;
          const n = s === "ALL"
            ? Object.values(counts).reduce((a,b) => a + (b || 0), 0)
            : (counts[s] || 0);
          return (
            <button key={s} onClick={() => setFilter(s)}
              style={{
                fontSize:11, fontWeight:700, padding:"6px 14px",
                background: active ? "#0f172a" : "#f1f5f9",
                color:    active ? "#fff"    : "#475569",
                border:   "none", borderRadius:99, cursor:"pointer",
                letterSpacing:".05em",
              }}>
              {s} <span style={{ opacity:.7, marginLeft:6 }}>({n})</span>
            </button>
          );
        })}
        <span style={{ marginLeft:"auto", fontSize:11, color:"#64748b" }}>
          Lookback:
          <select value={days} onChange={e => setDays(+e.target.value)}
            style={{ fontSize:11, padding:"3px 8px", marginLeft:6,
                     border:"1px solid #cbd5e1", borderRadius:4 }}>
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
            <option value={365}>1 year</option>
          </select>
        </span>
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ padding:40, textAlign:"center", color:"#94a3b8" }}>
          Loading…
        </div>
      ) : !rows.length ? (
        <div style={{ padding:40, textAlign:"center", color:"#94a3b8",
                       fontStyle:"italic" }}>
          No requests found for this filter.
        </div>
      ) : (
        <div style={{ background:"#fff", border:"1px solid #e2e8f0",
                       borderRadius:10, overflow:"hidden" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
            <thead>
              <tr style={{ background:"#f8fafc",
                            borderBottom:"2px solid #e2e8f0" }}>
                {["#", "PY", "Sensor", "Bit", "Line/Zone",
                  "Remark", "Submitted", "By", "Status", "Actions"].map(h =>
                  <th key={h} style={{
                    padding:"10px 12px", fontSize:9, fontWeight:800,
                    letterSpacing:".08em", color:"#64748b",
                    textAlign:"left", whiteSpace:"nowrap",
                  }}>{h}</th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Fragment key={r.id}>
                  <tr style={{ borderBottom:"1px solid #f1f5f9" }}>
                    <td style={{ padding:"10px 12px",
                                  fontFamily:"monospace", color:"#64748b" }}>
                      #{r.id}
                    </td>
                    <td style={{ padding:"10px 12px",
                                  fontFamily:"monospace", fontWeight:700 }}>
                      {r.py_no}
                      {r.py_name && (
                        <div style={{ fontSize:9, color:"#94a3b8",
                                       fontWeight:400, marginTop:1 }}>
                          {r.py_name}
                        </div>
                      )}
                    </td>
                    <td style={{ padding:"10px 12px",
                                  fontFamily:"monospace", color:"#0369a1",
                                  fontWeight:700 }}>
                      {r.sensing_bits || "—"}
                    </td>
                    <td style={{ padding:"10px 12px",
                                  fontFamily:"monospace", color:"#475569" }}>
                      {r.bit || "—"}
                    </td>
                    <td style={{ padding:"10px 12px", color:"#475569" }}>
                      {r.line_name || `Line ${r.line_id || "?"}`}
                      {r.zone_name && (
                        <div style={{ fontSize:9, color:"#94a3b8" }}>
                          {r.zone_name}
                        </div>
                      )}
                    </td>
                    <td style={{ padding:"10px 12px", maxWidth:280 }}>
                      <div style={{
                        whiteSpace: expanded[r.id] ? "normal" : "nowrap",
                        overflow:"hidden", textOverflow:"ellipsis",
                        cursor:"pointer",
                      }}
                      onClick={() => setExpanded(e => ({...e, [r.id]: !e[r.id]}))}
                      title={r.remark}>
                        {r.remark}
                      </div>
                    </td>
                    <td style={{ padding:"10px 12px",
                                  fontFamily:"monospace", fontSize:10,
                                  color:"#64748b" }}>
                      {fmt(r.submitted_at)}
                    </td>
                    <td style={{ padding:"10px 12px", color:"#475569" }}>
                      {r.submitted_by_username || "—"}
                    </td>
                    <td style={{ padding:"10px 12px" }}>
                      {statusPill(r.status)}
                      {r.status === "RESOLVED" && r.resolution_note && (
                        <div style={{ fontSize:9, color:"#94a3b8",
                                       marginTop:4, fontStyle:"italic" }}
                             title={r.resolution_note}>
                          ↪ {r.resolution_note.slice(0, 40)}
                          {r.resolution_note.length > 40 ? "…" : ""}
                        </div>
                      )}
                    </td>
                    <td style={{ padding:"10px 12px" }}>
                      {!readOnly && (
                        <div style={{ display:"flex", gap:4 }}>
                          {r.status === "NEW" && (
                            <button onClick={() => {
                                      setResolveModal({ req:r, status:"REVIEWED" });
                                      setNoteText("");
                                    }}
                                    style={{
                                      fontSize:10, padding:"3px 8px",
                                      background:"#dbeafe", color:"#1e40af",
                                      border:"none", borderRadius:4,
                                      fontWeight:700, cursor:"pointer",
                                    }}>
                              Mark Reviewed
                            </button>
                          )}
                          {r.status !== "RESOLVED" && (
                            <button onClick={() => {
                                      setResolveModal({ req:r, status:"RESOLVED" });
                                      setNoteText(r.resolution_note || "");
                                    }}
                                    style={{
                                      fontSize:10, padding:"3px 8px",
                                      background:"#d1fae5", color:"#065f46",
                                      border:"none", borderRadius:4,
                                      fontWeight:700, cursor:"pointer",
                                    }}>
                              Resolve
                            </button>
                          )}
                          <button onClick={() => onDelete(r)}
                                  style={{
                                    fontSize:10, padding:"3px 8px",
                                    background:"#fee2e2", color:"#b91c1c",
                                    border:"none", borderRadius:4,
                                    fontWeight:700, cursor:"pointer",
                                  }}
                                  title="Delete request">
                            ✕
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                  {expanded[r.id] && (
                    <tr style={{ background:"#f8fafc" }}>
                      <td colSpan={10} style={{ padding:"10px 16px",
                                                  fontSize:11, color:"#475569" }}>
                        <strong>Full remark:</strong> {r.remark}
                        {r.machine_name && (
                          <span style={{ marginLeft:16 }}>
                            <strong>Machine:</strong> {r.machine_name}
                          </span>
                        )}
                        {r.expected && (
                          <span style={{ marginLeft:16 }}>
                            <strong>Expected:</strong> {r.expected}
                          </span>
                        )}
                        {r.resolved_by_username && (
                          <span style={{ marginLeft:16 }}>
                            <strong>Resolved by:</strong> {r.resolved_by_username}
                            {" @ "}{fmt(r.resolved_at)}
                          </span>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Resolve modal */}
      {resolveModal && (
        <div style={{
          position:"fixed", inset:0, background:"rgba(0,0,0,.5)",
          display:"flex", alignItems:"center", justifyContent:"center",
          zIndex:1000,
        }}
        onClick={() => setResolveModal(null)}>
          <div onClick={e => e.stopPropagation()}
               style={{
                 background:"#fff", padding:24, borderRadius:10,
                 maxWidth:520, width:"90%", boxShadow:"0 20px 60px rgba(0,0,0,.3)",
               }}>
            <h3 style={{ margin:"0 0 6px 0", fontSize:18, fontWeight:800 }}>
              {resolveModal.status === "RESOLVED" ? "Resolve" : "Mark Reviewed"}: Request #{resolveModal.req.id}
            </h3>
            <p style={{ fontSize:12, color:"#64748b", margin:"0 0 14px 0" }}>
              PY {resolveModal.req.py_no} · {resolveModal.req.sensing_bits || resolveModal.req.bit}
            </p>
            <div style={{ fontSize:12, color:"#475569", marginBottom:14,
                           padding:10, background:"#f8fafc", borderRadius:6,
                           borderLeft:"3px solid #cbd5e1" }}>
              <strong>Operator remark:</strong> {resolveModal.req.remark}
            </div>
            <label style={{ fontSize:11, fontWeight:700, color:"#475569",
                             display:"block", marginBottom:6 }}>
              Resolution note {resolveModal.status === "RESOLVED" ? "(recommended)" : "(optional)"}:
            </label>
            <textarea value={noteText}
                      onChange={e => setNoteText(e.target.value)}
                      rows={3}
                      placeholder="e.g. PLC ladder updated, sensor X15 now wired to LOCATE PIN"
                      style={{
                        width:"100%", fontSize:12, padding:"8px 10px",
                        border:"1px solid #cbd5e1", borderRadius:6,
                        resize:"vertical", fontFamily:"inherit",
                      }}/>
            <div style={{ display:"flex", gap:10, justifyContent:"flex-end",
                           marginTop:16 }}>
              <button onClick={() => setResolveModal(null)}
                      style={{ fontSize:12, padding:"8px 16px",
                               background:"#f1f5f9", color:"#475569",
                               border:"none", borderRadius:6,
                               fontWeight:700, cursor:"pointer" }}>
                Cancel
              </button>
              <button onClick={onResolveSubmit}
                      style={{ fontSize:12, padding:"8px 16px",
                               background:"#0369a1", color:"#fff",
                               border:"none", borderRadius:6,
                               fontWeight:700, cursor:"pointer" }}>
                {resolveModal.status === "RESOLVED" ? "Save Resolution" : "Mark Reviewed"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


// ════════════════════════════════════════════════════════════════════
// PyManualsPage — admin UI to manage per-PY visual manual:
//   • Instructions / follow-steps text
//   • Reference images (upload, delete, caption)
// Operator sees these read-only on Maintenance > Poka Yoke > 📷 icon.
// 2026-05-21 — Spec: "image set krne ka option ... maintenance panel
// jha maintenance setting hoti h ... kuch instruction ya follow steps
// bhi add krne ka option bhi dede or same py me visual".
// ════════════════════════════════════════════════════════════════════
