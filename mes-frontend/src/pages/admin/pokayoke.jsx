/* admin/pokayoke.jsx — Poka-Yoke config (Matrix/Config/Master/Models),
   plus the adjacent Mail-Config & Sensor-Health pages (Sensor Health is a
   PokaYoke sub-tab). Exports: PokaYokePage, MailConfigPage, SensorHealthPage. */
import { useState, useEffect, useRef, useCallback, useMemo, Fragment } from "react";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../api/client";
import {
  PageHeading, Card, Pill, Btn, FF, Input, Select,
  Modal, ModalActions, Toast, EmptyState, Spinner, ExcelImportButton,
  inputStyle,
} from "./ui";

function LineAssignModal({ py, lines, zones, rules, token, toast, onClose, onReload }) {
  const assignedMap = rules
    .filter(r => r.poka_yoke_no === py.pyNo)
    .reduce((m, r) => { m[r.line_id] = r.id; return m; }, {});
  const [checked, setChecked] = useState(() => new Set(Object.keys(assignedMap).map(Number)));
  const [saving,  setSaving]  = useState(false);

  const toggle = id => setChecked(prev => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  const save = async () => {
    setSaving(true);
    try {
      const toAdd    = lines.filter(l => checked.has(l.id) && !assignedMap[l.id]);
      const toRemove = lines.filter(l => !checked.has(l.id) && assignedMap[l.id]);
      await Promise.all([
        ...toAdd.map(l => api.post(`/api/poka-yoke/rules/${l.id}`, {
          poka_yoke_no:   py.pyNo,
          poka_yoke_name: py.description || py.pyNo,
          side:           py.typeSide   || "ALL",
          model:          "ALL",
          bit:            py.dBit        || "",
          value:          py.desiredValue ?? 1,
          machine_name:   py.machineFixture || "",
          sheet_name:     "",
          alert_level:    "WARNING",
          is_active:      true,
        }, token)),
        ...toRemove.map(l => api.delete(`/api/poka-yoke/rules/${assignedMap[l.id]}`, token)),
      ]);
      toast("Line assignment saved ✓");
      onReload();
      onClose();
    } catch (e) { toast(e.message, "err"); }
    finally { setSaving(false); }
  };

  const byZone = zones.map(z => ({ zone: z, zlines: lines.filter(l => l.zone_id === z.id) }))
                      .filter(g => g.zlines.length > 0);

  return (
    <Modal open onClose={onClose} title={`Assign "${py.description || py.pyNo}" to Lines`}>
      <p style={{fontSize:12,color:"#64748b",marginBottom:14}}>
        Select which production lines should monitor this poka-yoke check (Bit: <b>{py.dBit||"—"}</b>, Value: <b>{py.desiredValue??1}</b>).
      </p>
      <div style={{maxHeight:320,overflowY:"auto",border:"1px solid #e2e8f0",borderRadius:8,padding:4}}>
        {byZone.length === 0
          ? <div style={{padding:20,textAlign:"center",color:"#94a3b8",fontSize:12}}>No lines configured</div>
          : byZone.map(({ zone, zlines }) => (
            <div key={zone.id} style={{marginBottom:4}}>
              <div style={{fontSize:10,fontWeight:700,color:"#64748b",letterSpacing:".08em",textTransform:"uppercase",padding:"6px 10px 4px",background:"#f8fafc",borderRadius:6}}>{zone.zone_name}</div>
              {zlines.map(l => (
                <label key={l.id} style={{display:"flex",alignItems:"center",gap:10,padding:"7px 12px",borderRadius:6,cursor:"pointer",background:checked.has(l.id)?"rgba(30,64,175,.06)":"transparent",border:`1px solid ${checked.has(l.id)?"rgba(30,64,175,.25)":"transparent"}`,margin:"2px 0"}}>
                  <input type="checkbox" checked={checked.has(l.id)} onChange={()=>toggle(l.id)} style={{width:15,height:15,accentColor:"#1e40af"}}/>
                  <span style={{fontSize:13,fontWeight:checked.has(l.id)?600:400,color:checked.has(l.id)?"#1e40af":"#0f172a",flex:1}}>{l.line_name}</span>
                  {checked.has(l.id) && assignedMap[l.id] && <span style={{fontSize:10,color:"#16a34a",fontWeight:600}}>✓ Already assigned</span>}
                  {checked.has(l.id) && !assignedMap[l.id] && <span style={{fontSize:10,color:"#1e40af",fontWeight:600}}>+ New</span>}
                </label>
              ))}
            </div>
          ))
        }
      </div>
      <div style={{fontSize:11,color:"#64748b",marginTop:10}}>{checked.size} line{checked.size!==1?"s":""} selected</div>
      <ModalActions>
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn variant="primary" onClick={save} disabled={saving}>{saving?"Saving…":"Save Assignment"}</Btn>
      </ModalActions>
    </Modal>
  );
}

// ─── POKA YOKE PAGE ───────────────────────────────────────────
// ─── POKA YOKE PAGE ──────────────────────────────────────────
export function PokaYokePage({ toast, readOnly = false }) {
  const { token } = useAuth();
  // Sub-tab is persisted in localStorage so a refresh keeps you on the
  // same sub-page (operator's typical flow: open Sensor Health, alt-tab
  // to PLC, refresh — landing back on Model Master would be jarring).
  const SUB_LS_KEY = "ap.pokayoke.sub";
  const [subTab,   setSubTab]   = useState(() => {
    try { return localStorage.getItem(SUB_LS_KEY) || "models"; }
    catch { return "models"; }
  });
  useEffect(() => {
    try { localStorage.setItem(SUB_LS_KEY, subTab); } catch {}
  }, [subTab]);
  // Dropdown open/close state — replaces the old horizontal tab strip.
  const [subOpen, setSubOpen] = useState(false);
  const subRef = useRef(null);
  useEffect(() => {
    const onDocDown = (e) => {
      if (subOpen && subRef.current && !subRef.current.contains(e.target)) setSubOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [subOpen]);
  const [lines,    setLines]    = useState([]);
  const [zones,    setZones]    = useState([]);
  const [rules,    setRules]    = useState([]);
  const [pyMaster, setPyMaster] = useState([]);
  const [models,   setModels]   = useState([]);
  const [series,   setSeries]   = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [events,   setEvents]   = useState([]);
  const [loading,  setLoading]  = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [l, z, m, py, asgn, sr] = await Promise.all([
        api.get("/api/lines/",             token).catch(()=>[]),
        api.get("/api/zones/",             token).catch(()=>[]),
        api.get("/api/poka-yoke/models/",  token).catch(()=>[]),
        api.get("/api/poka-yoke/master/",  token).catch(()=>[]),
        api.get("/api/poka-yoke/assignments/", token).catch(()=>[]),
        api.get("/api/poka-yoke/series/",  token).catch(()=>[]),
      ]);
      const linesArr = Array.isArray(l) ? l : [];
      setLines(linesArr);
      setZones(Array.isArray(z) ? z : []);
      setModels(Array.isArray(m) ? m : []);
      setPyMaster(Array.isArray(py) ? py : []);
      setAssignments(Array.isArray(asgn) ? asgn : []);
      setSeries(Array.isArray(sr) ? sr : []);

      let allRules=[], allEvents=[];
      await Promise.allSettled(linesArr.map(async line => {
        const [r,e] = await Promise.all([
          api.get(`/api/poka-yoke/rules/${line.id}`, token).catch(()=>[]),
          api.get(`/api/poka-yoke/events/${line.id}?unacked_only=true&limit=20`, token).catch(()=>({events:[]})),
        ]);
        allRules.push(...(Array.isArray(r)?r:[]).map(x=>({...x,line_name:line.line_name})));
        allEvents.push(...(e.events||[]).map(x=>({...x,line_name:line.line_name})));
      }));
      setRules(allRules); setEvents(allEvents);
    } catch { toast("Failed to load","err"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const SUB_TABS = [
    { key:"models", label:"🗂️ Model Master"     },
    { key:"master", label:"🔍 Poka Yoke Master" },
    { key:"config", label:"⚙️ Config"           },
    { key:"matrix", label:"📊 Matrix"          },
    { key:"health", label:"🔬 Sensor Health"   },
  ];

  const activeSub = SUB_TABS.find(t => t.key === subTab) || SUB_TABS[0];

  return (
    <div>
      {/* Sub-tab dropdown — replaces the old horizontal strip per
          operator request: "PY ab pe click karu toh dropdown de".
          Always interactive (even in read-only mode) so dept users can
          still navigate between Model Master / Master / Config /
          Matrix / Sensor Health.  Selection persists in localStorage
          → refresh keeps you on the last opened sub-page. */}
      <div ref={subRef} style={{position:"relative", marginBottom:24}}>
        <button onClick={() => setSubOpen(o => !o)}
                style={{
                  display:"flex", alignItems:"center", gap:10,
                  padding:"12px 18px", borderRadius:10,
                  border:"1.5px solid #e2e8f0", background:"#fff",
                  color:"#0f172a", fontFamily:"'Barlow',sans-serif",
                  fontSize:14, fontWeight:700, cursor:"pointer",
                  minWidth:260, justifyContent:"space-between",
                  boxShadow: subOpen ? "0 4px 18px rgba(30,64,175,.12)" : "0 1px 3px rgba(0,0,0,.04)",
                  transition:"all .12s",
                }}>
          <span style={{display:"flex", alignItems:"center", gap:10}}>
            <span style={{fontSize:11, fontWeight:700, color:"#94a3b8",
                            letterSpacing:".08em", textTransform:"uppercase"}}>
              Page
            </span>
            <span style={{color:"#1e40af"}}>{activeSub.label}</span>
          </span>
          <span style={{
            transform: subOpen ? "rotate(180deg)" : "rotate(0deg)",
            transition:"transform .15s", color:"#64748b", fontSize:14, fontWeight:800,
          }}>▾</span>
        </button>
        {subOpen && (
          <div style={{
            position:"absolute", top:"calc(100% + 4px)", left:0, zIndex:50,
            background:"#fff", border:"1px solid #e2e8f0", borderRadius:10,
            boxShadow:"0 12px 32px rgba(15,23,42,.18)",
            minWidth:260, padding:"6px",
          }}>
            {SUB_TABS.map(t => (
              <button key={t.key}
                      onClick={() => { setSubTab(t.key); setSubOpen(false); }}
                      style={{
                        display:"block", width:"100%", textAlign:"left",
                        padding:"10px 14px", borderRadius:7, border:"none",
                        background: subTab === t.key ? "rgba(30,64,175,.08)" : "transparent",
                        color: subTab === t.key ? "#1e40af" : "#334155",
                        fontWeight: subTab === t.key ? 700 : 500,
                        fontSize:13, cursor:"pointer",
                        fontFamily:"'Barlow',sans-serif",
                      }}
                      onMouseEnter={e => { if (subTab !== t.key) e.currentTarget.style.background = "#f8fafc"; }}
                      onMouseLeave={e => { if (subTab !== t.key) e.currentTarget.style.background = "transparent"; }}>
                {t.label}
                {subTab === t.key && <span style={{float:"right", color:"#1e40af"}}>✓</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Sub-component output — `readOnly` is threaded down so each
          sub-component can hide its CUD UI (Add / Edit / Delete /
          Import / Template + the Actions column) entirely instead of
          just disabling them.  The fieldset wrap is a belt-and-braces
          guard so any control we missed is still natively disabled. */}
      <fieldset disabled={readOnly}
                style={{ border:0, padding:0, margin:0, minWidth:0 }}>
        {loading ? <Spinner /> : <>
          {subTab==="models" && <PYModels models={models} series={series} zones={zones} toast={toast} token={token} onReload={load} readOnly={readOnly}/>}
          {subTab==="master" && <PYMaster pyMaster={pyMaster} models={models} zones={zones} toast={toast} token={token} onReload={load} readOnly={readOnly}/>}
          {subTab==="config" && <PYConfig assignments={assignments} pyMaster={pyMaster} models={models} lines={lines} zones={zones} toast={toast} token={token} onReload={load} readOnly={readOnly}/>}
          {subTab==="matrix" && <PYMatrix assignments={assignments} events={events} lines={lines} zones={zones} rules={rules} toast={toast} token={token} onReload={load} readOnly={readOnly}/>}
          {subTab==="health" && <SensorHealthPage lines={lines} toast={toast} token={token} readOnly={readOnly}/>}
        </>}
      </fieldset>
    </div>
  );
}

// ── Shared: SheetJS loader ────────────────────────────────────
const loadSheetJS = () => new Promise((res,rej) => {
  if (window.XLSX) return res();
  const s=document.createElement("script");
  s.src="/xlsx.full.min.js";  // local copy for air-gapped LAN
  s.onload=res; s.onerror=rej; document.head.appendChild(s);
});

// ── Shared: parse any sheet from uploaded file ────────────────
async function parseSheet(file, sheetName) {
  await loadSheetJS();
  const buf = await file.arrayBuffer();
  const wb  = window.XLSX.read(buf, {type:"array"});
  if (!wb.SheetNames.includes(sheetName)) return null;
  const ws  = wb.Sheets[sheetName];
  return window.XLSX.utils.sheet_to_json(ws, {defval:""});
}

// ── Shared: Excel import button with column mapping ───────────
function ExcelImportBtn({ label, sheetName, expectedCols, onParsed, disabled }) {
  const fileRef = useRef(null);
  const [colMap,    setColMap]    = useState({});  // {systemCol: excelCol}
  const [colModal,  setColModal]  = useState(false);
  const [tempMap,   setTempMap]   = useState({});
  const [headers,   setHeaders]   = useState([]);  // actual excel headers found

  const handleFile = async e => {
    const file = e.target.files[0]; if (!file) return;
    e.target.value="";
    await loadSheetJS();
    const buf = await file.arrayBuffer();
    const wb  = window.XLSX.read(buf, {type:"array"});
    if (!wb.SheetNames.includes(sheetName)) {
      alert(`Sheet "${sheetName}" not found in this file.\nAvailable: ${wb.SheetNames.join(", ")}`);
      return;
    }
    const ws   = wb.Sheets[sheetName];
    const rows = window.XLSX.utils.sheet_to_json(ws, {defval:""});
    if (!rows.length) { alert("Sheet is empty"); return; }
    const hdrs = Object.keys(rows[0]);
    setHeaders(hdrs);
    onParsed(rows, colMap);
  };

  const activeMap = {...colMap};
  expectedCols.forEach(c => { if (!activeMap[c]) activeMap[c]=c; });
  const hasCustom = expectedCols.some(c=>colMap[c]&&colMap[c]!==c);

  return (
    <>
      <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
        <Btn variant="primary" size="sm" onClick={()=>fileRef.current?.click()} disabled={disabled}>
          📥 {label}
        </Btn>
        <Btn size="sm" onClick={()=>{setTempMap({...activeMap});setColModal(true);}}>
          🗂 Column Map {hasCustom&&"⚠"}
        </Btn>
        <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{display:"none"}} onChange={handleFile}/>
        {hasCustom && <span style={{fontSize:10,color:"#d97706",background:"rgba(217,119,6,.08)",border:"1px solid rgba(217,119,6,.2)",borderRadius:99,padding:"3px 10px"}}>Custom mapping active</span>}
      </div>

      <Modal open={colModal} onClose={()=>setColModal(false)} title={`Column Mapping — ${sheetName}`} wide>
        <p style={{fontSize:12,color:"#64748b",marginBottom:16}}>
          Map your Excel column headers to system fields. If your Excel uses different column names, enter them here.
          {headers.length>0 && <span style={{display:"block",marginTop:6,color:"#94a3b8"}}>Detected headers: <b>{headers.join(", ")}</b></span>}
        </p>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
          {expectedCols.map(sysCol=>(
            <FF key={sysCol} label={`System field: ${sysCol}`}>
              <Input
                value={tempMap[sysCol]||sysCol}
                onChange={e=>setTempMap(m=>({...m,[sysCol]:e.target.value}))}
                placeholder={sysCol}
              />
            </FF>
          ))}
        </div>
        <ModalActions>
          <Btn onClick={()=>{setTempMap({});setColModal(false);}}>Reset to Default</Btn>
          <Btn onClick={()=>setColModal(false)}>Cancel</Btn>
          <Btn variant="primary" onClick={()=>{setColMap(tempMap);setColModal(false);}}>Save Mapping</Btn>
        </ModalActions>
      </Modal>
    </>
  );
}

// ─── MATRIX TAB ───────────────────────────────────────────────
function MatrixAssignModal({ modelName, items, lines, zones, rules, token, toast, onClose, onReload }) {
  // Lines that already have ALL bits of this model assigned
  const pyNos = [...new Set(items.map(a => a.pyNo))];
  const assignedLineIds = new Set(
    lines.filter(l =>
      pyNos.every(pyNo =>
        rules.some(r => r.line_id === l.id && r.poka_yoke_no === pyNo)
      )
    ).map(l => l.id)
  );
  const [selectedLine, setSelectedLine] = useState("");
  const [saving,       setSaving]       = useState(false);
  const [removing,     setRemoving]     = useState(false);

  const byZone = zones.map(z => ({ zone: z, zlines: lines.filter(l => l.zone_id === z.id) }))
                      .filter(g => g.zlines.length > 0);

  const assign = async () => {
    if (!selectedLine) { toast("Select a line first", "err"); return; }
    setSaving(true);
    const lineId = parseInt(selectedLine);
    const rulesPayload = items.map(a => ({
      poka_yoke_no:   a.pyNo,
      poka_yoke_name: a.pyName || a.pyNo,
      side:           a.typeSide || "ALL",
      model:          "ALL",   // "ALL" so rules always appear regardless of current PLC model name
      bit:            a.dBit || "",
      value:          a.desiredValue ?? 1,
      machine_name:   a.machineFixture || "",
      sheet_name:     "",
      alert_level:    "WARNING",
      is_active:      true,
    }));
    try {
      const res = await api.post(`/api/poka-yoke/rules/${lineId}/bulk`, { rules: rulesPayload }, token);
      toast(`✓ ${res.inserted} rules assigned${res.skipped > 0 ? `, ${res.skipped} already existed` : ""}`);
      onReload(); onClose();
    } catch (e) { toast(e.message, "err"); }
    finally { setSaving(false); }
  };

  const remove = async () => {
    if (!selectedLine) { toast("Select a line first", "err"); return; }
    if (!confirm(`Remove all "${modelName}" poka-yoke rules from this line?`)) return;
    setRemoving(true);
    try {
      const pyNos = [...new Set(items.map(a => a.pyNo))];
      await api.post(`/api/poka-yoke/rules/${selectedLine}/bulk-delete`, { poka_yoke_nos: pyNos }, token);
      toast("Rules removed ✓"); onReload(); onClose();
    } catch (e) { toast(e.message, "err"); }
    finally { setRemoving(false); }
  };

  const selLineAlreadyAssigned = selectedLine ? assignedLineIds.has(parseInt(selectedLine)) : false;

  return (
    <Modal open onClose={onClose} title={`Assign "${modelName}" to Line`} wide>
      <p style={{ fontSize: 12, color: "#64748b", marginBottom: 14 }}>
        This will create <b>{items.length} poka-yoke rules</b> on the selected line for all bits in this model configuration.
      </p>

      {/* Already assigned indicator */}
      {assignedLineIds.size > 0 && (
        <div style={{ padding: "8px 12px", borderRadius: 8, background: "rgba(22,163,74,.06)", border: "1px solid rgba(22,163,74,.2)", fontSize: 12, color: "#16a34a", marginBottom: 14, fontWeight: 600 }}>
          ✓ Already fully assigned on: {lines.filter(l => assignedLineIds.has(l.id)).map(l => l.line_name).join(", ")}
        </div>
      )}

      {/* Bit summary */}
      <div style={{ marginBottom: 16, padding: "10px 14px", background: "#f8fafc", borderRadius: 8, border: "1px solid #e2e8f0" }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8 }}>
          {items.length} Checks to Assign
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {items.map((a, i) => (
            <span key={i} title={`${a.pyNo}: ${a.pyName}`}
              style={{ display: "inline-flex", alignItems: "center", borderRadius: 99, border: "1px solid #e2e8f0", overflow: "hidden", fontFamily: "monospace", fontSize: 11, fontWeight: 700 }}>
              <span style={{ padding: "3px 8px", background: "#f8fafc", color: "#334155" }}>{a.dBit || "—"}</span>
              <span style={{ padding: "3px 7px", background: a.desiredValue == 1 ? "rgba(22,163,74,.1)" : "rgba(220,38,38,.1)", color: a.desiredValue == 1 ? "#16a34a" : "#dc2626" }}>{a.desiredValue ?? 1}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Line selector grouped by zone */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: ".06em", display: "block", marginBottom: 8 }}>
          Select Production Line *
        </label>
        <div style={{ maxHeight: 240, overflowY: "auto", border: "1px solid #e2e8f0", borderRadius: 8, padding: 4 }}>
          {byZone.length === 0
            ? <div style={{ padding: 20, textAlign: "center", color: "#94a3b8", fontSize: 12 }}>No lines configured</div>
            : byZone.map(({ zone, zlines }) => (
              <div key={zone.id} style={{ marginBottom: 4 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", letterSpacing: ".08em", textTransform: "uppercase", padding: "6px 10px 4px", background: "#f8fafc", borderRadius: 6 }}>{zone.zone_name}</div>
                {zlines.map(l => {
                  const isAssigned = assignedLineIds.has(l.id);
                  const isSelected = String(l.id) === String(selectedLine);
                  return (
                    <label key={l.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 12px", borderRadius: 6, cursor: "pointer", background: isSelected ? "rgba(30,64,175,.06)" : "transparent", border: `1px solid ${isSelected ? "rgba(30,64,175,.25)" : "transparent"}`, margin: "2px 0" }}>
                      <input type="radio" name="assignLine" value={l.id} checked={isSelected} onChange={() => setSelectedLine(String(l.id))} style={{ accentColor: "#1e40af" }} />
                      <span style={{ fontSize: 13, fontWeight: isSelected ? 600 : 400, color: isSelected ? "#1e40af" : "#0f172a", flex: 1 }}>{l.line_name}</span>
                      {isAssigned && <span style={{ fontSize: 10, color: "#16a34a", fontWeight: 700, background: "rgba(22,163,74,.1)", padding: "2px 8px", borderRadius: 99 }}>✓ Assigned</span>}
                    </label>
                  );
                })}
              </div>
            ))
          }
        </div>
      </div>

      <ModalActions>
        <Btn onClick={onClose}>Cancel</Btn>
        {selLineAlreadyAssigned && (
          <Btn variant="danger" onClick={remove} disabled={removing}>{removing ? "Removing…" : "Remove from Line"}</Btn>
        )}
        <Btn variant="primary" onClick={assign} disabled={saving || !selectedLine}>
          {saving ? "Assigning…" : `Assign ${items.length} Rules`}
        </Btn>
      </ModalActions>
    </Modal>
  );
}

function PYMatrix({ assignments, events, lines, zones, rules, toast, token, onReload, readOnly = false }) {
  const [search,       setSearch]       = useState("");
  const [filterType,   setFilterType]   = useState("");
  const [filterSeries, setFilterSeries] = useState("");
  const [selected,     setSelected]     = useState(null);
  const [assignModel,  setAssignModel]  = useState(null); // { modelName, items }

  const uniqueTypes  = [...new Set(assignments.map(a=>a.modelType).filter(Boolean))].sort();
  const uniqueSeries = [...new Set(assignments.map(a=>a.modelSeries).filter(Boolean))].sort();

  const filtered = assignments.filter(a => {
    const s=search.toLowerCase();
    return (!search||Object.values(a).some(v=>String(v).toLowerCase().includes(s)))
      && (!filterType||a.modelType===filterType)
      && (!filterSeries||a.modelSeries===filterSeries);
  });

  // group by modelName — exactly like original server.js MatrixTab
  const grouped = {};
  filtered.forEach(a => {
    if (!grouped[a.modelName]) grouped[a.modelName]=[];
    grouped[a.modelName].push(a);
  });

  const crits = events.filter(e=>e.alert_level==="CRITICAL");
  const warns = events.filter(e=>e.alert_level==="WARNING");

  const bitValBg  = v=>v==0?"rgba(220,38,38,.1)":v==1?"rgba(22,163,74,.1)":"rgba(30,64,175,.1)";
  const bitValClr = v=>v==0?"#dc2626":v==1?"#16a34a":"#1e40af";
  const sideBg    = s=>s==="LH"?"rgba(30,64,175,.1)":s==="RH"?"rgba(22,163,74,.1)":"#f1f5f9";
  const sideClr   = s=>s==="LH"?"#1e40af":s==="RH"?"#16a34a":"#64748b";

  const ackEvent = async id => {
    try { await api.post(`/api/poka-yoke/events/${id}/acknowledge`,{},token); toast("Acknowledged"); onReload(); }
    catch(e) { toast(e.message,"err"); }
  };

  // Detail view — like original MatrixTab detail
  if (selected) {
    const items = assignments.filter(a=>a.modelName===selected);
    return (
      <div>
        <div style={{display:"flex",alignItems:"center",gap:12,background:"#fff",borderRadius:10,padding:"14px 18px",marginBottom:16,border:"1px solid #e2e8f0"}}>
          <button onClick={()=>setSelected(null)} style={{background:"none",border:"none",color:"#1e40af",cursor:"pointer",fontWeight:600,fontSize:13}}>← Back to Matrix</button>
          <span style={{fontWeight:700,fontSize:15,color:"#0f172a",flex:1}}>{selected}</span>
          {items[0]&&<span style={{fontSize:12,color:"#94a3b8"}}>{items[0].modelType} | Series: {items[0].modelSeries} | {items[0].oldModelNo}</span>}
        </div>
        <Card>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
              <thead><tr>
                {["#","PY No","Poka Yoke Description","Side","D Bit (PLC)","Desired Value","Machine / Fixture"].map(h=>(
                  <th key={h} style={{padding:"9px 12px",textAlign:"left",fontSize:9,fontWeight:700,letterSpacing:".08em",textTransform:"uppercase",color:"#64748b",borderBottom:"2px solid #e2e8f0",whiteSpace:"nowrap"}}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {items.map((a,i)=>(
                  <tr key={a.id||i} style={{borderBottom:"1px solid #f1f5f9"}}>
                    <td style={{padding:"8px 12px",color:"#94a3b8",fontSize:11}}>{i+1}</td>
                    <td style={{padding:"8px 12px",fontFamily:"monospace",fontWeight:700,color:"#1e40af",fontSize:11}}>{a.pyNo}</td>
                    <td style={{padding:"8px 12px",color:"#0f172a"}}>{a.pyName}</td>
                    <td style={{padding:"8px 12px"}}><span style={{padding:"2px 8px",borderRadius:99,fontSize:10,fontWeight:700,background:sideBg(a.typeSide),color:sideClr(a.typeSide)}}>{a.typeSide||"—"}</span></td>
                    <td style={{padding:"8px 12px",fontFamily:"monospace",fontWeight:700,color:"#7c3aed"}}>{a.dBit||"—"}</td>
                    <td style={{padding:"8px 12px",textAlign:"center"}}>
                      {a.desiredValue!=null?<span style={{padding:"3px 10px",borderRadius:99,fontSize:11,fontWeight:700,background:bitValBg(a.desiredValue),color:bitValClr(a.desiredValue)}}>{a.desiredValue}</span>:"—"}
                    </td>
                    <td style={{padding:"8px 12px",fontSize:11,color:"#64748b"}}>{a.machineFixture||"—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{padding:"8px 14px",fontSize:11,color:"#94a3b8",borderTop:"1px solid #f1f5f9"}}>{items.length} poka yoke checks for this model</div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div>
      {/* Stats — identical to original */}
      <div style={{display:"flex",gap:14,marginBottom:18,flexWrap:"wrap"}}>
        {[
          {label:"Models",       val:Object.keys(grouped).length},
          {label:"Total Checks", val:filtered.length},
          {label:"Unique PY",    val:[...new Set(filtered.map(a=>a.pyNo))].length},
          {label:"Bits Used",    val:[...new Set(filtered.map(a=>a.dBit).filter(Boolean))].length},
        ].map(({label,val})=>(
          <div key={label} style={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:10,padding:"12px 18px",minWidth:110}}>
            <div style={{fontSize:11,color:"#64748b",fontWeight:600,textTransform:"uppercase",letterSpacing:".06em"}}>{label}</div>
            <div style={{fontSize:26,fontWeight:800,color:"#1e40af"}}>{val}</div>
          </div>
        ))}
      </div>

      {/* Unacked events */}
      {events.length>0&&(
        <Card style={{marginBottom:18}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
            <span style={{fontSize:13,fontWeight:700,color:"#0f172a"}}>Unacknowledged Events <span style={{fontSize:11,background:"rgba(30,64,175,.1)",color:"#1e40af",padding:"2px 8px",borderRadius:4,marginLeft:6}}>{events.length}</span></span>
            {!readOnly && events.length>1 && (
              <Btn size="sm" variant="danger" onClick={()=>[...new Set(events.map(e=>e.line_id))].forEach(id=>api.post(`/api/poka-yoke/events/${id}/acknowledge-all`,{},token).then(onReload))}>Acknowledge All</Btn>
            )}
          </div>
          {events.map(e=>(
            <div key={e.id} style={{display:"flex",alignItems:"center",gap:12,padding:"8px 0",borderBottom:"1px solid #f1f5f9"}}>
              <span style={{fontSize:18}}>{e.alert_level==="CRITICAL"?"🚨":"⚠️"}</span>
              <div style={{flex:1}}>
                <div style={{fontWeight:600,fontSize:13,color:"#0f172a"}}>{e.rule_name||e.poka_yoke_name||"Event"}</div>
                <div style={{fontSize:11,color:"#94a3b8",marginTop:2}}>{e.line_name} · {new Date(e.detected_at).toLocaleString("en-IN")}</div>
              </div>
              <Pill label={e.alert_level} color={e.alert_level==="CRITICAL"?"red":"amber"}/>
              {!readOnly && <Btn size="sm" onClick={()=>ackEvent(e.id)}>Acknowledge</Btn>}
            </div>
          ))}
        </Card>
      )}

      {/* Filters + title — identical to original */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",marginBottom:14,flexWrap:"wrap",gap:10}}>
        <div style={{fontWeight:700,fontSize:15,color:"#0f172a"}}>Poka Yoke Matrix</div>
        <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search model / PY / bit..."
            style={{...inputStyle,width:220,padding:"8px 12px"}}/>
          <select value={filterType} onChange={e=>setFilterType(e.target.value)} style={{...inputStyle,padding:"8px 10px",fontSize:12,width:160}}>
            <option value="">All Types</option>{uniqueTypes.map(t=><option key={t}>{t}</option>)}
          </select>
          <select value={filterSeries} onChange={e=>setFilterSeries(e.target.value)} style={{...inputStyle,padding:"8px 10px",fontSize:12,width:140}}>
            <option value="">All Series</option>{uniqueSeries.map(s=><option key={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {/* Matrix cards — identical to original */}
      {Object.keys(grouped).length===0 ? (
        <Card><EmptyState text="No data" sub="Import from Excel in Config, Poka Yoke Master, or Model Master tabs"/></Card>
      ) : (
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {Object.entries(grouped).map(([modelName,items])=>(
            <Card key={modelName} style={{padding:0,overflow:"hidden"}}>
              <div style={{display:"flex",alignItems:"center",gap:12,padding:"11px 16px",background:"#f8fafc",borderBottom:"1px solid #e2e8f0"}}>
                <div onClick={()=>setSelected(modelName)} style={{flex:1,cursor:"pointer"}}>
                  <div style={{fontWeight:600,fontSize:14,color:"#0f172a"}}>{modelName}</div>
                  <div style={{fontSize:11,color:"#94a3b8",marginTop:2,display:"flex",gap:8}}>
                    {items[0]?.modelType&&<span style={{background:items[0].modelType?.includes("4")?"rgba(30,64,175,.1)":"rgba(124,58,237,.1)",color:items[0].modelType?.includes("4")?"#1e40af":"#7c3aed",padding:"1px 8px",borderRadius:99,fontSize:10,fontWeight:700}}>{items[0].modelType}</span>}
                    {items[0]?.modelSeries&&<span style={{background:"#f1f5f9",color:"#64748b",padding:"1px 8px",borderRadius:99,fontSize:10,fontWeight:700}}>{items[0].modelSeries}</span>}
                    {items[0]?.oldModelNo&&<span style={{color:"#94a3b8",fontSize:11}}>{items[0].oldModelNo}</span>}
                  </div>
                </div>
                <span style={{background:"#f1f5f9",color:"#64748b",padding:"2px 10px",borderRadius:99,fontSize:11,fontWeight:700}}>{items.length} checks</span>
                {!readOnly && (
                  <Btn size="sm" variant="primary" onClick={e=>{e.stopPropagation();setAssignModel({modelName,items});}}>🏭 Assign to Line</Btn>
                )}
                <span onClick={()=>setSelected(modelName)} style={{fontSize:12,color:"#1e40af",fontWeight:600,cursor:"pointer"}}>View Details →</span>
              </div>
              {/* Bit pills */}
              <div style={{padding:"10px 16px",display:"flex",flexWrap:"wrap",gap:6}}>
                {items.map((a,i)=>{
                  const bit=a.dBit||"—"; const val=a.desiredValue??1;
                  return (
                    <span key={i} title={`${a.pyNo}: ${a.pyName}`}
                      style={{display:"inline-flex",alignItems:"center",borderRadius:99,border:"1px solid #e2e8f0",overflow:"hidden",fontFamily:"monospace",fontSize:11,fontWeight:700}}>
                      <span style={{padding:"3px 8px",background:"#f8fafc",color:"#334155"}}>{bit}</span>
                      <span style={{padding:"3px 7px",background:bitValBg(val),color:bitValClr(val)}}>{val}</span>
                    </span>
                  );
                })}
              </div>
            </Card>
          ))}
        </div>
      )}

      {assignModel && (
        <MatrixAssignModal
          modelName={assignModel.modelName}
          items={assignModel.items}
          lines={lines||[]}
          zones={zones||[]}
          rules={rules||[]}
          token={token}
          toast={toast}
          onClose={()=>setAssignModel(null)}
          onReload={onReload}
        />
      )}
    </div>
  );
}

// ─── CONFIG TAB — Set desired output per model × pokayoke ────
function PYConfig({ assignments, pyMaster, models, lines, zones, toast, token, onReload, readOnly = false }) {
  const [search,      setSearch]     = useState("");
  const [filterModel, setFilterModel]= useState("");
  const [filterType,  setFilterType] = useState("");
  const [saving,      setSaving]     = useState({});  // {assignmentId: true}
  const [importing,   setImporting]  = useState(false);
  const [impResult,   setImpResult]  = useState(null);
  const [addBitFor,   setAddBitFor]  = useState(null);  // assignment row to add extra bit for
  const [newBit,      setNewBit]     = useState({dBit:"",desiredValue:"",register:""});

  const uniqueModels    =[...new Set(assignments.map(a=>a.modelName).filter(Boolean))].sort();
  const uniqueModelTypes=[...new Set(assignments.map(a=>a.modelType).filter(Boolean))].sort();
  const filtered=assignments.filter(a=>{
    const s=search.toLowerCase();
    return(!search||Object.values(a).some(v=>String(v).toLowerCase().includes(s)))&&(!filterModel||a.modelName===filterModel)&&(!filterType||a.modelType===filterType);
  });

  // Build PY lookup for bit/register display
  const pyLookup={};
  pyMaster.forEach(p=>{pyLookup[p.pyNo]=p;});

  // Build Model lookup (by modelName) so we can show bit # on each group card.
  // Index both the raw name and the legacy-prefix-stripped variant so old
  // assignments (with "TYPE-SERIES:" prefix) still match cleaned master rows.
  const stripPrefix = (s) => (s||"").replace(/^TYPE-SERIES:\s*/i,"");
  const modelLookup={};
  (models||[]).forEach(m=>{
    if (!m.modelName) return;
    modelLookup[m.modelName]       = m;
    modelLookup[stripPrefix(m.modelName)] = m;
  });
  const findModel = (name) => modelLookup[name] || modelLookup[stripPrefix(name)] || null;

  const sideBg =s=>s==="LH"?"rgba(30,64,175,.1)":s==="RH"?"rgba(22,163,74,.1)":"#f1f5f9";
  const sideClr=s=>s==="LH"?"#1e40af":s==="RH"?"#16a34a":"#64748b";
  const valBg  =v=>v==0?"rgba(22,163,74,.1)":v==1?"rgba(220,38,38,.08)":"rgba(30,64,175,.08)";
  const valClr =v=>v==0?"#16a34a":v==1?"#dc2626":"#1e40af";

  // Output options per register count
  const OUTPUT_OPTS = {
    1: [
      { code: 0, label: "PASS" },
      { code: 1, label: "OFF"  },
      { code: 2, label: "ON"   },
    ],
    2: [
      { code: 0, label: "PASS"     },
      { code: 1, label: "OFF, OFF" },
      { code: 2, label: "OFF, ON"  },
      { code: 3, label: "ON, OFF"  },
      { code: 4, label: "ON, ON"   },
    ],
  };
  const optsFor = (cnt) => OUTPUT_OPTS[cnt === 2 ? 2 : 1];

  // Inline-patch a single assignment (desired_bit[_2] or desired_value[_2]).
  const patchAssignment = async (a, patch) => {
    setSaving(s=>({...s,[a.id]:true}));
    try {
      await api.patch(`/api/poka-yoke/assignments/${a.id}`, patch, token);
      toast("Saved ✓");
      onReload();
    } catch(e) { toast(e.message,"err"); }
    finally   { setSaving(s=>{const n={...s};delete n[a.id];return n;}); }
  };
  const updateBit   = (a, key, raw) => {
    const v = raw === "" ? null : parseInt(raw);
    if (raw !== "" && (isNaN(v) || v < 0)) { toast("Enter a positive bit number","err"); return; }
    patchAssignment(a, { [key]: v });
  };
  const updateValue = (a, key, raw) => {
    const v = raw === "" ? null : parseInt(raw);
    patchAssignment(a, { [key]: v });
  };

  // Import
  const FINAL_COLS=["Poka Yoke No","Poka Yoke Name","Type Side","Model Type","Model Name","Type2","Old Model No","Model","D bit From PLC","Desired Value (0/1/2)","Machine/Fixture"];
  const doImport=async(rows,colMap)=>{
    if(!rows||!rows.length){toast("No rows found","err");return;}
    setImporting(true); setImpResult(null);
    try{
      const res=await api.post("/api/poka-yoke/import/bulk",{sheet:"final seat",rows,col_map:colMap},token);
      setImpResult(res); toast(`✓ ${res.inserted} assignments imported`,res.ok?"ok":"info");
      onReload();
    }catch(e){toast(e.message,"err");}
    finally{setImporting(false);}
  };

  const del=async id=>{
    if(!confirm("Delete this assignment?")) return;
    try{ await api.delete(`/api/poka-yoke/assignments/${id}`,token); toast("Deleted"); onReload(); }
    catch(e){toast(e.message,"err");}
  };

  const delModel=async(modelName, items)=>{
    if(!confirm(`"${modelName}" ke saare ${items.length} poka-yoke assignments delete karne hain?`)) return;
    try{
      await Promise.all(items.map(a=>api.delete(`/api/poka-yoke/assignments/${a.id}`,token)));
      toast(`${items.length} assignments deleted for ${modelName}`);
      onReload();
    }catch(e){toast(e.message,"err");}
  };

  // Add an extra desirable-bit row for the same PY+model.
  const openAddBit=(a)=>{
    setAddBitFor(a);
    setNewBit({desiredBit:"", desiredValue:""});
  };
  const saveAddBit=async()=>{
    if(newBit.desiredBit===""){ toast("Desirable bit daalo","err"); return; }
    const a=addBitFor;
    try{
      await api.post("/api/poka-yoke/assignments/",{
        pyNo:a.pyNo, pyName:a.pyName, typeSide:a.typeSide, modelType:a.modelType,
        modelName:a.modelName, type2:a.modelType, oldModelNo:a.oldModelNo||"",
        modelSeries:a.modelSeries||"",
        dBit: a.dBit || (pyLookup[a.pyNo]||{}).dBit || "",
        desiredBit:   parseInt(newBit.desiredBit),
        desiredValue: newBit.desiredValue!=="" ? parseInt(newBit.desiredValue) : null,
        machineFixture:a.machineFixture||"",
      },token);
      toast("Added ✓"); setAddBitFor(null); onReload();
    }catch(e){toast(e.message,"err");}
  };

  // Group by model_id (bit-stable) — not model_name which can be renamed.
  // Each group carries its own bitNumber + live modelName from backend.
  const grouped={};
  filtered.forEach(a=>{
    const key = a.modelId != null ? `id:${a.modelId}`
              : a.bitNumber != null ? `bit:${a.bitNumber}`
              : `name:${a.modelName || "Unknown"}`;
    if(!grouped[key]) grouped[key]=[];
    grouped[key].push(a);
  });

  return (
    <div>
      {/* Stats */}
      <div style={{display:"flex",gap:14,marginBottom:18,flexWrap:"wrap"}}>
        {[
          {label:"Total Assignments",val:assignments.length,color:"#1e40af"},
          {label:"Models Configured",val:uniqueModels.length,color:"#16a34a"},
          {label:"Unique PY",        val:[...new Set(assignments.map(a=>a.pyNo))].length,color:"#7c3aed"},
        ].map(({label,val,color})=>(
          <div key={label} style={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:10,padding:"12px 18px",minWidth:120}}>
            <div style={{fontSize:11,color:"#64748b",fontWeight:600,textTransform:"uppercase",letterSpacing:".06em"}}>{label}</div>
            <div style={{fontSize:26,fontWeight:800,color}}>{val}</div>
          </div>
        ))}
      </div>

      {/* Import Card — admin only */}
      {!readOnly && (
        <Card style={{marginBottom:18}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12,paddingBottom:12,borderBottom:"1px solid #f1f5f9"}}>
            <span style={{fontSize:20}}>📥</span>
            <div>
              <div style={{fontSize:14,fontWeight:700,color:"#0f172a"}}>Import from Excel — "final seat" sheet</div>
              <div style={{fontSize:11,color:"#94a3b8",fontFamily:"monospace"}}>Poka Yoke No | Poka Yoke Name | Type Side | Model Type | Model Name | Type2 | Old Model No | Model | D bit From PLC | Desired Value (0/1/2) | Machine/Fixture</div>
            </div>
          </div>
          <ExcelImportBtn label={importing?"Importing…":"Upload Excel (final seat)"} sheetName="final seat" expectedCols={FINAL_COLS} onParsed={doImport} disabled={importing}/>
          {impResult&&(
            <div style={{marginTop:12,padding:"10px 14px",borderRadius:8,background:impResult.ok?"rgba(22,163,74,.06)":"rgba(220,38,38,.06)",border:`1px solid ${impResult.ok?"rgba(22,163,74,.2)":"rgba(220,38,38,.2)"}`,fontSize:12}}>
              {impResult.ok?<span style={{color:"#16a34a",fontWeight:600}}>✓ Imported {impResult.inserted} assignments{impResult.skipped>0?`, skipped ${impResult.skipped}`:""}</span>:<span style={{color:"#dc2626",fontWeight:600}}>✗ {impResult.errors?.[0]||"Import failed"}</span>}
            </div>
          )}
        </Card>
      )}

      {/* Filters */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",marginBottom:14,gap:10,flexWrap:"wrap"}}>
        <div style={{fontWeight:700,fontSize:15,color:"#0f172a"}}>Config — Set Expected Output</div>
        <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search..." style={{...inputStyle,width:180,padding:"8px 12px"}}/>
          <select value={filterType} onChange={e=>setFilterType(e.target.value)} style={{...inputStyle,padding:"8px 10px",fontSize:12,width:150}}>
            <option value="">All Types</option>{uniqueModelTypes.map(t=><option key={t}>{t}</option>)}
          </select>
          <select value={filterModel} onChange={e=>setFilterModel(e.target.value)} style={{...inputStyle,padding:"8px 10px",fontSize:12,width:220}}>
            <option value="">All Models</option>{uniqueModels.map(m=><option key={m}>{m}</option>)}
          </select>
        </div>
      </div>

      {/* Grouped by model */}
      {Object.keys(grouped).length===0?<Card><EmptyState text="No assignments" sub="Import Excel from above or add PY in PY Master tab first"/></Card>:(
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          {Object.entries(grouped).map(([key,items])=>{
            const first    = items[0];
            // Source bit # and name from the assignment row itself (comes
            // straight from the backend, joined live with the master). Falls
            // back to models[] prop lookup if something's missing.
            const bit      = first?.bitNumber ?? findModel(first?.modelName)?.bitNumber ?? null;
            const nameRaw  = first?.modelName || findModel(first?.modelName)?.modelName || "";
            const name     = String(nameRaw).replace(/^TYPE-SERIES:\s*/i,"");
            return (
              <Card key={key} style={{padding:0,overflow:"hidden"}}>
                <div style={{padding:"10px 16px",background:"#f8fafc",borderBottom:"1px solid #e2e8f0",display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
                  <div style={{flex:1,display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                    {bit != null && (
                      <span style={{display:"inline-flex",alignItems:"center",justifyContent:"center",minWidth:40,height:32,padding:"0 10px",borderRadius:8,background:"linear-gradient(135deg,#7c3aed,#6d28d9)",color:"#fff",fontWeight:800,fontSize:13,fontFamily:"monospace"}}>
                        #{bit}
                      </span>
                    )}
                    <div>
                      <div style={{fontWeight:800,fontSize:14,color:"#0f172a",letterSpacing:".02em"}}>
                        MODEL No. — {bit ?? "—"}
                      </div>
                      <div style={{fontSize:11,color:"#475569",fontWeight:600,marginTop:2,fontFamily:"monospace"}}>
                        {name || "—"}
                      </div>
                      <div style={{fontSize:10,color:"#94a3b8",display:"flex",gap:8,marginTop:3,flexWrap:"wrap"}}>
                        {first?.modelType&&<span style={{background:first.modelType?.includes("4")?"rgba(30,64,175,.1)":"rgba(124,58,237,.1)",color:first.modelType?.includes("4")?"#1e40af":"#7c3aed",padding:"1px 8px",borderRadius:99,fontWeight:700,whiteSpace:"nowrap"}}>{first.modelType}</span>}
                        {first?.modelSeries&&<span style={{background:"#f1f5f9",color:"#64748b",padding:"1px 8px",borderRadius:99,fontWeight:700}}>{first.modelSeries}</span>}
                      </div>
                    </div>
                  </div>
                  <span style={{background:"#f1f5f9",color:"#64748b",padding:"2px 10px",borderRadius:99,fontSize:11,fontWeight:700}}>{items.length} checks</span>
                  {!readOnly && (
                    <Btn size="sm" variant="danger" onClick={()=>delModel(first?.modelName,items)}>Delete Model</Btn>
                  )}
                </div>
                <div style={{overflowX:"auto"}}>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                    <thead><tr>
                      {["#","PY No","Description","Side","Bit","Register Output","Desirable Bit","Output 1","Output 2", ...(readOnly ? [] : [""])].map(h=>(
                        <th key={h} style={{padding:"7px 10px",textAlign:"left",fontSize:8,fontWeight:700,letterSpacing:".08em",textTransform:"uppercase",color:"#94a3b8",borderBottom:"1px solid #e2e8f0",whiteSpace:"nowrap"}}>{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {items.map((a,i)=>{
                        const pyInfo = pyLookup[a.pyNo] || {};
                        const regCnt = pyInfo.registerCount === 2 ? 2 : 1;
                        const busy   = !!saving[a.id];

                        // Dropdown options: 0=PASS, 1=OFF, 2=ON.  null = not set.
                        const outBg  = v => v===2 ? "rgba(22,163,74,.1)"
                                          : v===1 ? "rgba(220,38,38,.08)"
                                          : v===0 ? "rgba(30,64,175,.08)"
                                          : "#fff";
                        const outClr = v => v===2 ? "#16a34a"
                                          : v===1 ? "#dc2626"
                                          : v===0 ? "#1e40af"
                                          : "#64748b";

                        const VALUE_LABEL = { 0: "PASS", 1: "OFF", 2: "ON" };
                        const outCell = (val, valKey, enabled) => (
                          <td style={{padding:"6px 10px"}}>
                            {!enabled ? (
                              <span style={{color:"#e2e8f0",fontSize:11,fontWeight:700}}>—</span>
                            ) : readOnly ? (
                              // Read-only pill — same colour scheme as the editable
                              // select but no dropdown affordance.
                              val == null ? (
                                <span style={{color:"#cbd5e1",fontSize:11,fontWeight:700}}>—</span>
                              ) : (
                                <span style={{
                                  display:"inline-block", padding:"3px 12px", borderRadius:99,
                                  fontSize:11, fontWeight:700, minWidth:60, textAlign:"center",
                                  background: outBg(val), color: outClr(val),
                                  border:"1px solid #e2e8f0",
                                }}>{VALUE_LABEL[val] ?? val}</span>
                              )
                            ) : (
                              <select
                                value={val!=null ? String(val) : ""}
                                disabled={busy}
                                onChange={e => updateValue(a, valKey, e.target.value)}
                                style={{
                                  padding:"3px 10px",fontSize:11,borderRadius:6,border:"1px solid #e2e8f0",
                                  fontWeight:700,minWidth:90,cursor:"pointer",
                                  background: outBg(val),
                                  color:      outClr(val),
                                }}
                              >
                                <option value="">— Set —</option>
                                <option value="0">PASS</option>
                                <option value="1">OFF</option>
                                <option value="2">ON</option>
                              </select>
                            )}
                          </td>
                        );

                        return (
                          <tr key={a.id||i} style={{borderBottom:"1px solid #f8fafc"}}>
                            <td style={{padding:"6px 10px",color:"#cbd5e1",fontSize:10}}>{i+1}</td>
                            <td style={{padding:"6px 10px",fontFamily:"monospace",fontWeight:700,color:"#1e40af",fontSize:10}}>{a.pyNo}</td>
                            <td style={{padding:"6px 10px",fontSize:11,maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={a.pyName}>{a.pyName}</td>
                            <td style={{padding:"6px 10px",whiteSpace:"nowrap"}}><span style={{display:"inline-block",padding:"1px 6px",borderRadius:99,fontSize:9,fontWeight:700,background:sideBg(a.typeSide),color:sideClr(a.typeSide),whiteSpace:"nowrap"}}>{a.typeSide||"—"}</span></td>
                            <td style={{padding:"6px 10px",whiteSpace:"nowrap"}}>{
                              (() => {
                                const RE = /(?:D|R|M|L|F|T|C|S)\d+|(?:X|Y|W|B)[0-9A-F]+/gi;
                                const toks = String(a.dBit||pyInfo.dBit||"").toUpperCase().match(RE) || [];
                                if (!toks.length) return <span style={{color:"#cbd5e1"}}>—</span>;
                                return toks.map((b,j)=>(
                                  <span key={j} style={{display:"inline-block",padding:"1px 7px",borderRadius:99,fontSize:10,fontWeight:700,background:"rgba(124,58,237,.1)",color:"#7c3aed",fontFamily:"monospace",marginRight:4}}>{b}</span>
                                ));
                              })()
                            }</td>
                            <td style={{padding:"6px 10px",whiteSpace:"nowrap"}}>
                              <span style={{display:"inline-block",padding:"2px 9px",borderRadius:99,fontSize:10,fontWeight:700,background:regCnt===2?"rgba(234,88,12,.1)":"rgba(30,64,175,.1)",color:regCnt===2?"#c2410c":"#1e40af",whiteSpace:"nowrap"}}>
                                {regCnt} Register{regCnt===2?"s":""} Output
                              </span>
                            </td>

                            {/* Desirable Bit — single column for both reg counts */}
                            <td style={{padding:"6px 10px"}}>
                              {readOnly ? (
                                a.desiredBit != null ? (
                                  <span style={{
                                    display:"inline-block", width:72, padding:"3px 8px",
                                    fontSize:11, borderRadius:6, border:"1px solid #e2e8f0",
                                    fontWeight:700, fontFamily:"monospace",
                                    color:"#7c3aed", textAlign:"center",
                                    background:"rgba(124,58,237,.06)",
                                  }}>{a.desiredBit}</span>
                                ) : (
                                  <span style={{color:"#cbd5e1",fontSize:11,fontWeight:700}}>—</span>
                                )
                              ) : (
                                <input
                                  type="number" min="0"
                                  defaultValue={a.desiredBit!=null ? a.desiredBit : ""}
                                  disabled={busy}
                                  onBlur={e => {
                                    const raw = e.target.value.trim();
                                    const curr = a.desiredBit!=null ? String(a.desiredBit) : "";
                                    if (raw !== curr) updateBit(a, "desired_bit", raw);
                                  }}
                                  onKeyDown={e => { if (e.key === "Enter") e.target.blur(); }}
                                  placeholder="bit #"
                                  style={{
                                    width:72,padding:"3px 8px",fontSize:11,borderRadius:6,
                                    border:"1px solid #e2e8f0",fontWeight:700,fontFamily:"monospace",
                                    color:a.desiredBit!=null?"#7c3aed":"#94a3b8",textAlign:"center",
                                  }}
                                />
                              )}
                            </td>

                            {/* Output 1 — first register (always present, editable for admin) */}
                            {outCell(a.desiredValue,  "desired_value",   true)}
                            {/* Output 2 — second register (only for 2-register PYs) */}
                            {outCell(a.desiredValue2, "desired_value_2", regCnt === 2)}

                            {!readOnly && (
                              <td style={{padding:"6px 10px"}}><div style={{display:"flex",gap:4}}>
                                <Btn size="sm" variant="danger" onClick={()=>del(a.id)} style={{fontSize:9,padding:"2px 8px"}}>X</Btn>
                              </div></td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      <div style={{padding:"10px 0",fontSize:11,color:"#94a3b8",textAlign:"center"}}>Showing {filtered.length} of {assignments.length} total assignments</div>

      {/* Add Extra Bit Modal */}
      <Modal open={!!addBitFor} onClose={()=>setAddBitFor(null)} title="Add Another Desirable Bit for this Model">
        {addBitFor&&(
          <div>
            <div style={{background:"#f0f9ff",border:"1px solid #bae6fd",borderRadius:8,padding:"10px 14px",marginBottom:16,fontSize:12}}>
              <div style={{fontWeight:700,color:"#0c4a6e"}}>{addBitFor.pyNo} — {addBitFor.pyName}</div>
              <div style={{fontSize:11,color:"#64748b",marginTop:2}}>Model: {addBitFor.modelName}</div>
              <div style={{fontSize:11,color:"#64748b"}}>PLC Register: <b style={{fontFamily:"monospace",color:"#7c3aed"}}>{addBitFor.dBit || (pyLookup[addBitFor.pyNo]||{}).dBit || "—"}</b></div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
              <FF label="Desirable Bit *">
                <Input
                  type="number" min="0"
                  value={newBit.desiredBit}
                  onChange={e=>setNewBit(f=>({...f,desiredBit:e.target.value}))}
                  placeholder="0, 1, 2, 3..."
                  style={{fontFamily:"monospace",fontWeight:700,color:"#7c3aed"}}
                />
              </FF>
              <FF label="Desirable Output *">
                <Select value={newBit.desiredValue} onChange={e=>setNewBit(f=>({...f,desiredValue:e.target.value}))}>
                  <option value="">— Set —</option>
                  <option value="0">OFF</option>
                  <option value="1">ON</option>
                </Select>
              </FF>
            </div>
            <ModalActions>
              <Btn onClick={()=>setAddBitFor(null)}>Cancel</Btn>
              <Btn variant="primary" onClick={saveAddBit} disabled={newBit.desiredBit===""}>Add</Btn>
            </ModalActions>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ─── POKA YOKE MASTER TAB ─────────────────────────────────────
// ─── PY MASTER TAB ─────────────────────────────────────────────
// TYPE  : 4 Way / 6 Way
// SIDE  : depends on TYPE (4 Way → LH/RH/OTR; 6 Way → LH/RH/Otr LH/Otr RH)
// Each combination maps uniquely to one Model Master `type` value.
// ─── Reusable Excel template + import buttons (Model Master / PY Master) ──
// Given a `routePrefix` like "/api/poka-yoke/master" or "/api/poka-yoke/models",
// renders a "Download Template" button and an "Import Excel" file picker that
// hits {prefix}/template (GET, blob) and {prefix}/import (POST multipart).
// Reports the {inserted, skipped, errors[]} summary via toast.
function ExcelTools({ routePrefix, label, fileBaseName, token, toast, onDone }) {
  const [busy, setBusy] = useState(false);
  const fileRef = useRef();

  const downloadTemplate = async () => {
    setBusy(true);
    try {
      const r = await fetch(`${routePrefix}/template`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${fileBaseName}_template.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch(e) { toast(`Template download failed: ${e.message}`, "err"); }
    finally   { setBusy(false); }
  };

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const r = await fetch(`${routePrefix}/import`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
      const errs = j.errors?.length ? ` · ${j.errors.length} error(s)` : "";
      toast(`Imported ${j.inserted} ${label}, skipped ${j.skipped}${errs}`, j.inserted>0?"ok":"err");
      if (j.errors?.length) {
        console.warn(`[${label} import] errors:`, j.errors);
      }
      if (onDone) onDone();
    } catch(err) { toast(`Import failed: ${err.message}`, "err"); }
    finally     {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <>
      <Btn onClick={downloadTemplate} disabled={busy} title="Download Excel template">
        ⬇ Template
      </Btn>
      <Btn onClick={()=>fileRef.current?.click()} disabled={busy} title="Upload filled Excel to bulk-import">
        {busy ? "Working…" : "📤 Import Excel"}
      </Btn>
      <input type="file" accept=".xlsx,.xls" ref={fileRef}
             style={{display:"none"}} onChange={onFile}/>
    </>
  );
}


function PYMaster({ pyMaster, models, zones = [], toast, token, onReload, readOnly = false }) {
  const TYPES = ["4 Way", "6 Way"];
  const sidesFor = (type) => {
    if (type === "4 Way") return ["ALL", "LH", "RH", "OTR"];
    if (type === "6 Way") return ["ALL", "LH", "RH", "Otr LH", "Otr RH"];
    return [];
  };
  // Map (TYPE + SIDE) → list of model.type strings stored in Model Master.
  // ALL on a given TYPE returns every variant for that TYPE.
  const modelTypesFor = (type, side) => {
    if (!type || !side) return [];
    if (type === "4 Way") {
      if (side === "ALL") return ["4 Way Inr LH", "4 Way Inr RH", "4 Way OTR"];
      if (side === "LH")  return ["4 Way Inr LH"];
      if (side === "RH")  return ["4 Way Inr RH"];
      if (side === "OTR") return ["4 Way OTR"];
    }
    if (type === "6 Way") {
      if (side === "ALL")    return ["6 Way Inr LH", "6 Way Inr RH", "6 Way Otr LH", "6 Way Otr RH"];
      if (side === "LH")     return ["6 Way Inr LH"];
      if (side === "RH")     return ["6 Way Inr RH"];
      if (side === "Otr LH") return ["6 Way Otr LH"];
      if (side === "Otr RH") return ["6 Way Otr RH"];
    }
    return [];
  };

  // Output code → label reference (shown in modal, also used in Config tab).
  const OUTPUT_MAP = {
    1: [
      { code: 0, label: "PASS" },
      { code: 1, label: "OFF"  },
      { code: 2, label: "ON"   },
    ],
    2: [
      { code: 0, label: "PASS"     },
      { code: 1, label: "OFF, OFF" },
      { code: 2, label: "OFF, ON"  },
      { code: 3, label: "ON, OFF"  },
      { code: 4, label: "ON, ON"   },
    ],
  };

  const [modal,   setModal]   = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving,  setSaving]  = useState(false);
  const [search,  setSearch]  = useState("");

  const EMPTY = {
    description:   "",
    modelType:     "",   // 4 Way / 6 Way
    typeSide:      "",   // LH / RH / OTR / Otr LH / Otr RH
    dBit:          "",   // D400 — now also acts as functional primary key
    sensingBits:   "",   // X-bit(s), used by sensor health check
    zoneId:        "",   // FK → mes_zones.id
    registerCount: 1,
    assignedModelIds: [],
  };
  const [form, setForm] = useState(EMPTY);

  const openAdd = () => { setForm(EMPTY); setEditing(null); setModal(true); };
  const openEdit = (p) => {
    setForm({
      description:   p.description || "",
      modelType:     p.modelType || "",
      typeSide:      p.typeSide  || "",
      dBit:          p.dBit || p.register || "",
      sensingBits:   p.sensingBits || "",
      zoneId:        p.zoneId ?? "",
      registerCount: p.registerCount || 1,
      assignedModelIds: Array.isArray(p.assignedModelIds) ? p.assignedModelIds : [],
    });
    setEditing(p); setModal(true);
  };

  // Eligible models for current type+side, sorted by bit number.
  // When side = "ALL", merges all variants for the chosen Type.
  const eligibleModels = useMemo(() => {
    const wantedList = modelTypesFor(form.modelType, form.typeSide);
    if (wantedList.length === 0) return [];
    const wanted = new Set(wantedList);
    return models
      .filter(m => wanted.has(m.type || ""))
      .sort((a,b) => (a.bitNumber ?? 9999) - (b.bitNumber ?? 9999));
  }, [form.modelType, form.typeSide, models]);

  // When type/side changes, drop any selected IDs that no longer apply.
  useEffect(() => {
    setForm(f => {
      const keep = new Set(eligibleModels.map(m=>m.id));
      const pruned = (f.assignedModelIds || []).filter(id => keep.has(id));
      return pruned.length === (f.assignedModelIds || []).length ? f
        : { ...f, assignedModelIds: pruned };
    });
    // eslint-disable-next-line
  }, [eligibleModels.map(m=>m.id).join(",")]);

  const toggleModel = (id) => {
    setForm(f => ({ ...f,
      assignedModelIds: f.assignedModelIds.includes(id)
        ? f.assignedModelIds.filter(x=>x!==id)
        : [...f.assignedModelIds, id],
    }));
  };

  const save = async () => {
    if (!form.description.trim()){ toast("Description required","err");  return; }
    if (!form.modelType)         { toast("Type required","err");         return; }
    if (!form.typeSide)          { toast("Side required","err");         return; }
    if (!form.dBit.trim())       { toast("Output D-Bit required","err"); return; }
    if (!form.zoneId)            { toast("Zone required","err");         return; }
    if (![1,2].includes(form.registerCount)) { toast("Register count must be 1 or 2","err"); return; }

    // Normalize the register fields — extract every register token regardless
    // of separator (comma, space, mixed, none).  Accepts Mitsubishi types:
    //   D/R/M/L/F/T/C/S → decimal address (D400, M100)
    //   X/Y/W/B         → hex address     (X1E, Y10)
    const REG_RE = /(?:D|R|M|L|F|T|C|S)\d+|(?:X|Y|W|B)[0-9A-F]+/gi;
    const tokens = (form.dBit || "").toUpperCase().match(REG_RE) || [];
    const normalizedBit = tokens.join(",");
    if (!tokens.length) { toast("At least one register (e.g. D400 / X1E) required","err"); return; }

    const sensTokens = (form.sensingBits || "").toUpperCase().match(REG_RE) || [];
    const normalizedSens = sensTokens.join(",");

    const payload = {
      description:      form.description.trim(),
      modelType:        form.modelType,
      typeSide:         form.typeSide,
      dBit:             normalizedBit,
      register:         normalizedBit,
      sensingBits:      normalizedSens || null,
      zoneId:           form.zoneId ? Number(form.zoneId) : null,
      registerCount:    form.registerCount,
      assignedModelIds: form.assignedModelIds,
    };

    setSaving(true);
    try {
      if (editing) {
        await api.put(`/api/poka-yoke/master/${editing.id}`, payload, token);
        toast("Updated ✓");
      } else {
        await api.post("/api/poka-yoke/master/", payload, token);
        toast(`Added ✓ — ${form.assignedModelIds.length} model${form.assignedModelIds.length===1?"":"s"} linked`);
      }
      setModal(false); onReload();
    } catch(e) { toast(e.message, "err"); }
    finally   { setSaving(false); }
  };

  const del = async id => {
    if (!confirm("Delete this poka yoke?")) return;
    try { await api.delete(`/api/poka-yoke/master/${id}`, token); toast("Deleted"); onReload(); }
    catch(e) { toast(e.message, "err"); }
  };

  const filtered = pyMaster.filter(p =>
    !search || Object.values(p).some(v => String(v).toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div>
      {/* Stats */}
      <div style={{display:"flex",gap:14,marginBottom:18,flexWrap:"wrap"}}>
        {[
          { label:"Total PY",   val: pyMaster.length,                                           color:"#1e40af" },
          { label:"4 Way",      val: pyMaster.filter(p=>p.modelType==="4 Way").length,          color:"#1e40af" },
          { label:"6 Way",      val: pyMaster.filter(p=>p.modelType==="6 Way").length,          color:"#7c3aed" },
          { label:"2-Register", val: pyMaster.filter(p=>p.registerCount===2).length,            color:"#16a34a" },
        ].map(({label,val,color})=>(
          <div key={label} style={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:10,padding:"12px 18px",minWidth:110}}>
            <div style={{fontSize:11,color:"#64748b",fontWeight:600,textTransform:"uppercase",letterSpacing:".06em"}}>{label}</div>
            <div style={{fontSize:26,fontWeight:800,color}}>{val}</div>
          </div>
        ))}
      </div>

      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,gap:10,flexWrap:"wrap"}}>
        <div style={{fontWeight:700,fontSize:15,color:"#0f172a"}}>Poka Yoke Master</div>
        <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search..." style={{...inputStyle,width:200,padding:"8px 12px"}}/>
          {!readOnly && (
            <>
              <ExcelTools routePrefix="/api/poka-yoke/master"
                          label="PYs" fileBaseName="py_master"
                          token={token} toast={toast} onDone={onReload}/>
              <Btn variant="primary" onClick={openAdd}>+ Add Poka Yoke</Btn>
            </>
          )}
        </div>
      </div>

      <Card>
        {filtered.length===0 ? (
          <EmptyState text="No poka yokes" sub={readOnly ? "No poka-yoke checks configured yet." : 'Click "+ Add Poka Yoke" to create one.'}/>
        ) : (
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
              <thead><tr>
                {["S.No","Zone #","Description","Type","Side","Output D-Bit","Sensing","Reg Count","Models", ...(readOnly ? [] : ["Actions"])].map(h=>(
                  <th key={h} style={{padding:"9px 12px",textAlign:"left",fontSize:9,fontWeight:700,letterSpacing:".08em",textTransform:"uppercase",color:"#64748b",borderBottom:"2px solid #e2e8f0",whiteSpace:"nowrap"}}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {filtered.map((p,i)=>{
                  const cnt = (p.assignedModelIds || []).length;
                  const zoneLabel = p.zoneName
                    ? `${p.zoneName} #${p.seqInZone || "?"}`
                    : "— (no zone)";
                  return (
                    <tr key={p.id} style={{borderBottom:"1px solid #f1f5f9"}}>
                      <td style={{padding:"8px 12px",color:"#94a3b8",fontSize:11,fontWeight:600}}>{i+1}</td>
                      <td style={{padding:"8px 12px",fontWeight:700,color:p.zoneName?"#1e40af":"#94a3b8",fontSize:11,whiteSpace:"nowrap"}} title={p.zoneCode}>{zoneLabel}</td>
                      <td style={{padding:"8px 12px",color:"#0f172a",maxWidth:260,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={p.description}>{p.description}</td>
                      <td style={{padding:"8px 12px",whiteSpace:"nowrap"}}>
                        <span style={{display:"inline-block",padding:"2px 9px",borderRadius:99,fontSize:10,fontWeight:700,background:p.modelType==="4 Way"?"rgba(30,64,175,.1)":"rgba(124,58,237,.1)",color:p.modelType==="4 Way"?"#1e40af":"#7c3aed",whiteSpace:"nowrap"}}>{p.modelType||"—"}</span>
                      </td>
                      <td style={{padding:"8px 12px",whiteSpace:"nowrap"}}>
                        <span style={{display:"inline-block",padding:"2px 9px",borderRadius:99,fontSize:10,fontWeight:700,background:"rgba(22,163,74,.1)",color:"#16a34a",whiteSpace:"nowrap"}}>{p.typeSide||"—"}</span>
                      </td>
                      <td style={{padding:"8px 12px",fontFamily:"monospace",fontWeight:700,color:"#7c3aed",fontSize:11}}>{p.dBit || p.register || "—"}</td>
                      <td style={{padding:"8px 12px",fontFamily:"monospace",fontWeight:700,color:p.sensingBits?"#0891b2":"#cbd5e1",fontSize:11}}>{p.sensingBits || "—"}</td>
                      <td style={{padding:"8px 12px"}}>
                        <span style={{display:"inline-block",padding:"2px 9px",borderRadius:99,fontSize:10,fontWeight:700,background:"#f1f5f9",color:"#475569"}}>{p.registerCount || 1} reg</span>
                      </td>
                      <td style={{padding:"8px 12px"}}>
                        <span style={{display:"inline-block",padding:"2px 9px",borderRadius:99,fontSize:10,fontWeight:700,background:cnt?"rgba(234,88,12,.1)":"#f1f5f9",color:cnt?"#c2410c":"#94a3b8"}}>{cnt} model{cnt===1?"":"s"}</span>
                      </td>
                      {!readOnly && (
                        <td style={{padding:"8px 12px"}}>
                          <div style={{display:"flex",gap:6}}>
                            <Btn size="sm" onClick={()=>openEdit(p)}>Edit</Btn>
                            <Btn size="sm" variant="danger" onClick={()=>del(p.id)}>Delete</Btn>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div style={{padding:"8px 14px",fontSize:11,color:"#94a3b8",borderTop:"1px solid #f1f5f9"}}>Showing {filtered.length} of {pyMaster.length}</div>
          </div>
        )}
      </Card>

      {/* ── Add / Edit Modal ── */}
      <Modal open={modal} onClose={()=>setModal(false)} title={editing?"Edit Poka Yoke":"Add New Poka Yoke"} wide>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
          <FF label="Zone *">
            <Select value={form.zoneId} onChange={e=>setForm(f=>({...f,zoneId:e.target.value}))}>
              <option value="">— Select Zone —</option>
              {zones.map(z=>(
                <option key={z.id} value={z.id}>{z.zone_name} ({z.zone_code})</option>
              ))}
            </Select>
            <div style={{fontSize:10,color:"#94a3b8",marginTop:4}}>
              PY zone ke andar auto-numbered — Seat Slider #1…#25, Press Shop #1…#3, etc.
            </div>
          </FF>
          <FF label="Output D-Bit *">
            <Input
              value={form.dBit}
              onChange={e=>setForm(f=>({...f,dBit:e.target.value.toUpperCase()}))}
              placeholder="D400   OR   X1E,X1F   OR   D413,D414,D415"
              style={{fontFamily:"monospace",fontWeight:700,color:"#7c3aed"}}
            />
            <div style={{fontSize:10,color:"#94a3b8",marginTop:4}}>
              D-register (bypass ke liye) — isi se PY uniquely identify hoti hai. Supports D/R/M/L/F/T/C/S (decimal), X/Y/W/B (hex), comma-separated.
            </div>
          </FF>
          <FF label="Description *" style={{gridColumn:"1/-1"}}>
            <Input value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} placeholder="Harness brkt pop rivet operation miss"/>
          </FF>
          <FF label="Sensing X-Bit(s)" style={{gridColumn:"1/-1"}}>
            <Input
              value={form.sensingBits}
              onChange={e=>setForm(f=>({...f,sensingBits:e.target.value.toUpperCase()}))}
              placeholder="X15   OR   X21,X22   (sensor health check — blank = skip health test)"
              style={{fontFamily:"monospace",fontWeight:700,color:"#0891b2"}}
            />
            <div style={{fontSize:10,color:"#94a3b8",marginTop:4}}>
              Sensor ka X-bit input — har 15 cycles mein liveness check hogi (stuck bit → HEALTH ✗ + alert).
            </div>
          </FF>

          <FF label="Type *">
            <Select value={form.modelType} onChange={e=>setForm(f=>({...f,modelType:e.target.value,typeSide:""}))}>
              <option value="">— Select Type —</option>
              {TYPES.map(t=><option key={t}>{t}</option>)}
            </Select>
          </FF>
          <FF label="Side *">
            <Select value={form.typeSide} onChange={e=>setForm(f=>({...f,typeSide:e.target.value}))} disabled={!form.modelType}>
              <option value="">— Select Side —</option>
              {sidesFor(form.modelType).map(s=><option key={s}>{s}</option>)}
            </Select>
          </FF>

          {/* Register Count */}
          <FF label="Register Output *" style={{gridColumn:"1/-1"}}>
            <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
              {[1,2].map(n=>{
                const on = form.registerCount === n;
                return (
                  <button key={n} type="button" onClick={()=>setForm(f=>({...f,registerCount:n}))} style={{
                    flex:1,minWidth:220,padding:"10px 14px",borderRadius:8,cursor:"pointer",
                    border: on ? "1.5px solid #1e40af" : "1px solid #e2e8f0",
                    background: on ? "rgba(30,64,175,.08)" : "#fff",
                    color: on ? "#1e40af" : "#475569",fontWeight:700,fontSize:12,textAlign:"left",
                  }}>
                    <div style={{fontSize:13,fontWeight:800}}>{on?"● ":"○ "}{n} Register{n===2?"s":""}</div>
                    <div style={{fontSize:10,color:"#64748b",marginTop:2,fontWeight:600,fontFamily:"monospace"}}>
                      {OUTPUT_MAP[n].map(o=>`${o.code}=${o.label}`).join("  ")}
                    </div>
                  </button>
                );
              })}
            </div>
          </FF>
        </div>

        {/* ── Applicable Models (checkbox list, filtered by type+side) ── */}
        <div style={{marginTop:16,padding:"14px 16px",background:"#fff7ed",borderRadius:10,border:"1px solid #fed7aa"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,gap:10,flexWrap:"wrap"}}>
            <div>
              <div style={{fontSize:11,fontWeight:700,color:"#c2410c",letterSpacing:".08em",textTransform:"uppercase"}}>
                Applicable Models ({form.assignedModelIds.length} selected)
              </div>
              <div style={{fontSize:10,color:"#9a3412",marginTop:2}}>
                {form.modelType && form.typeSide
                  ? `Showing Model Master entries where Type ∈ ${modelTypesFor(form.modelType, form.typeSide).map(t=>`"${t}"`).join(", ")}`
                  : "Select TYPE and SIDE above to see matching models."}
              </div>
            </div>
            {eligibleModels.length > 0 && (
              <div style={{display:"flex",gap:6}}>
                <Btn size="sm" onClick={()=>setForm(f=>({...f,assignedModelIds:eligibleModels.map(m=>m.id)}))}>Select All</Btn>
                <Btn size="sm" onClick={()=>setForm(f=>({...f,assignedModelIds:[]}))}>Clear</Btn>
              </div>
            )}
          </div>

          {(!form.modelType || !form.typeSide) ? (
            <div style={{fontSize:11,color:"#9a3412",fontStyle:"italic",padding:"8px 4px"}}>
              Select Type + Side first.
            </div>
          ) : eligibleModels.length === 0 ? (
            <div style={{fontSize:11,color:"#9a3412",fontStyle:"italic",padding:"8px 4px"}}>
              No models in Model Master match <b>{modelTypesFor(form.modelType, form.typeSide).join(" / ")}</b>. Add some in the Model Master tab first.
            </div>
          ) : (
            <div style={{maxHeight:240,overflowY:"auto",display:"flex",flexDirection:"column",gap:4}}>
              {eligibleModels.map(m=>{
                const checked = form.assignedModelIds.includes(m.id);
                const name = (m.modelName||"").replace(/^TYPE-SERIES:\s*/i,"");
                return (
                  <label key={m.id} style={{
                    display:"flex",alignItems:"center",gap:10,padding:"8px 10px",
                    background: checked ? "rgba(194,65,12,.08)" : "#fff",
                    border: `1px solid ${checked ? "rgba(194,65,12,.3)" : "#e2e8f0"}`,
                    borderRadius:6,cursor:"pointer",fontSize:12,
                  }}>
                    <input type="checkbox" checked={checked} onChange={()=>toggleModel(m.id)}/>
                    <span style={{display:"inline-flex",alignItems:"center",justifyContent:"center",minWidth:32,height:24,padding:"0 8px",borderRadius:6,background:"linear-gradient(135deg,#7c3aed,#6d28d9)",color:"#fff",fontWeight:800,fontSize:11,fontFamily:"monospace"}}>
                      #{m.bitNumber ?? "—"}
                    </span>
                    <span style={{fontFamily:"monospace",fontWeight:600,color:"#0f172a",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1}} title={name}>
                      {name}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <ModalActions>
          <Btn onClick={()=>setModal(false)}>Cancel</Btn>
          <Btn variant="primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : editing ? "Update" : "Add Poka Yoke"}
          </Btn>
        </ModalActions>
      </Modal>
    </div>
  );
}

// ─── MAIL CONFIG (top-level tab) ──────────────────────────────
// CRUD over mes_mail_config — per-kind (bypass / health / hourly) To + Cc
// lists.  Each row shows the stored value, the env fallback, and the
// effective value currently in use.  "Send Test" verifies the full chain
// (SMTP + addresses) without waiting for a real alert.
// Page is rendered in three places now:
//   1. Admin Panel → Maintenance section → "Mail Settings"     → kindFilter=["bypass","health"]
//   2. Admin Panel → Production  section → "Hourly Report Mail" → kindFilter=["hourly"]
//   3. Department Panel (read-only) — same kind filters depending on dept
// Without `kindFilter`, ALL kinds render (legacy single-tab behavior).
export function MailConfigPage({ toast, kindFilter = null, readOnly = false }) {
  const { token } = useAuth();
  const [rows,    setRows]    = useState([]);
  const [drafts,  setDrafts]  = useState({});   // { key → dirty value }
  const [saving,  setSaving]  = useState(null); // currently-saving key
  const [testing, setTesting] = useState(null);

  const load = useCallback(async () => {
    try {
      const d = await api.get("/api/poka-yoke/mail-config/", token);
      setRows(Array.isArray(d) ? d : []);
      setDrafts({});
    } catch(e) { toast(e.message || "Load failed", "err"); }
  }, [token, toast]);

  useEffect(() => { load(); }, [load]);

  const save = async (key) => {
    setSaving(key);
    try {
      await api.put(`/api/poka-yoke/mail-config/${key}`,
        { value: drafts[key] ?? "" }, token);
      toast("Saved ✓", "ok");
      await load();
    } catch(e) { toast(e.message || "Save failed", "err"); }
    finally   { setSaving(null); }
  };

  const sendTest = async (key) => {
    setTesting(key);
    try {
      const d = await api.post(`/api/poka-yoke/mail-config/${key}/test`, {}, token);
      toast(`Test sent → To: ${d.to.join(", ")}${d.cc?.length?` | Cc: ${d.cc.join(", ")}`:""}`, "ok");
    } catch(e) { toast(e.message || "Test failed", "err"); }
    finally   { setTesting(null); }
  };

  // Group rows by kind (bypass / health / hourly) for nicer layout
  const groups = {};
  rows.forEach(r => {
    const kind = r.key.replace(/_(to|cc)$/, "");
    (groups[kind] = groups[kind] || []).push(r);
  });
  const KIND_LABELS = {
    bypass:  { label:"Poka-Yoke Bypass Alerts",
               desc:"Fires immediately on every new SENSOR_BYPASS event + 15-min digest." },
    health:  { label:"Sensor Health Fail Alerts",
               desc:"Fires once when a sensor stays stuck (>15 min without a natural toggle)." },
    hourly:  { label:"Hourly Slot Report",
               desc:"Automated per-shift slot summary: plan/actual/OK/NG/losses/bypasses." },
  };

  const KIND_ORDER = ["bypass","health","hourly"];
  // When AdminPanel renders this filtered (e.g. only ["hourly"] in the
  // Production section) we strip everything else so the user sees just
  // the relevant alert type.
  const visibleKinds = kindFilter
    ? KIND_ORDER.filter(k => kindFilter.includes(k) && groups[k])
    : KIND_ORDER.filter(k => groups[k]);

  return (
    <div className={readOnly ? "ap-readonly" : ""}>
      <fieldset disabled={readOnly} style={{border:0,padding:0,margin:0,minWidth:0}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,gap:10,flexWrap:"wrap"}}>
        <div>
          <div style={{fontWeight:700,fontSize:15,color:"#0f172a"}}>Mail Configuration</div>
          <div style={{fontSize:11,color:"#64748b",marginTop:2}}>
            Recipients for each alert type.  DB value wins over <code>.env</code>; blank falls back to env / legacy var.
            Comma-separated email lists supported.
          </div>
        </div>
      </div>

      {visibleKinds.map((kind) => {
        const kindRows = groups[kind];
        const meta = KIND_LABELS[kind] || { label: kind, desc: "" };
        return (
          <Card key={kind} style={{marginBottom:16}}>
            <div style={{padding:"14px 18px",borderBottom:"1px solid #f1f5f9"}}>
              <div style={{fontSize:14,fontWeight:700,color:"#0f172a"}}>{meta.label}</div>
              {meta.desc && <div style={{fontSize:11,color:"#64748b",marginTop:2}}>{meta.desc}</div>}
            </div>
            <div style={{padding:"8px 0"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                <thead><tr>
                  {["Field","Value (DB)","Env fallback","Effective","Actions"].map(h=>(
                    <th key={h} style={{padding:"9px 14px",textAlign:"left",fontSize:9,fontWeight:700,letterSpacing:".08em",textTransform:"uppercase",color:"#64748b",borderBottom:"1px solid #e2e8f0",whiteSpace:"nowrap"}}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {kindRows.map(r => {
                    const isDirty = drafts[r.key] !== undefined && drafts[r.key] !== (r.value||"");
                    const fieldName = r.key.endsWith("_to") ? "TO" :
                                     r.key.endsWith("_cc") ? "CC" : r.key;
                    return (
                      <tr key={r.key} style={{borderBottom:"1px solid #f1f5f9"}}>
                        <td style={{padding:"10px 14px",fontWeight:700,color:"#1e40af",fontFamily:"monospace",whiteSpace:"nowrap"}}>{fieldName}</td>
                        <td style={{padding:"10px 14px",minWidth:260}}>
                          <Input
                            value={drafts[r.key] ?? r.value ?? ""}
                            onChange={e => setDrafts(d => ({ ...d, [r.key]: e.target.value }))}
                            placeholder={r.env_value || r.legacy_value || "email1@x.com, email2@y.com"}
                            style={{fontFamily:"monospace",fontSize:12}}
                          />
                          {r.updated_at && (
                            <div style={{fontSize:10,color:"#94a3b8",marginTop:4}}>
                              Last edit: {new Date(r.updated_at).toLocaleString()} by {r.updated_by || "—"}
                            </div>
                          )}
                        </td>
                        <td style={{padding:"10px 14px",fontSize:11,color:"#64748b",maxWidth:220}}>
                          <div><code style={{fontSize:10,background:"#f1f5f9",padding:"1px 5px",borderRadius:3}}>{r.env_var}</code></div>
                          <div style={{marginTop:2,fontFamily:"monospace",fontSize:10,color:"#94a3b8",wordBreak:"break-all"}}>
                            {r.env_value || "—"}
                          </div>
                          {r.legacy_var && (
                            <div style={{marginTop:4,fontSize:10}}>
                              <span style={{color:"#c2410c"}}>legacy:</span> <code style={{fontSize:10,background:"#fef3c7",padding:"1px 5px",borderRadius:3}}>{r.legacy_var}</code>
                              <div style={{marginTop:1,fontFamily:"monospace",fontSize:10,color:"#94a3b8",wordBreak:"break-all"}}>
                                {r.legacy_value || "—"}
                              </div>
                            </div>
                          )}
                        </td>
                        <td style={{padding:"10px 14px",fontFamily:"monospace",fontSize:11,color:r.effective?"#16a34a":"#ef4444",maxWidth:240,wordBreak:"break-all"}}>
                          {r.effective || <span style={{color:"#ef4444"}}>&lt;not set&gt;</span>}
                        </td>
                        <td style={{padding:"10px 14px",whiteSpace:"nowrap"}}>
                          <div style={{display:"flex",gap:6}}>
                            <Btn size="sm" variant="primary"
                              disabled={!isDirty || saving===r.key}
                              onClick={()=>save(r.key)}>
                              {saving===r.key ? "Saving…" : "Save"}
                            </Btn>
                            {r.key.endsWith("_to") && (
                              <Btn size="sm"
                                disabled={testing===r.key}
                                onClick={()=>sendTest(r.key)}>
                                {testing===r.key ? "Sending…" : "Send Test"}
                              </Btn>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        );
      })}

      {rows.length === 0 && (
        <Card><EmptyState text="No mail config rows" sub="Restart the backend to seed defaults."/></Card>
      )}
      {rows.length > 0 && visibleKinds.length === 0 && (
        <Card><EmptyState text="No matching mail config" sub={`Filter: ${(kindFilter||[]).join(", ")}`}/></Card>
      )}
      </fieldset>
    </div>
  );
}


// ─── SENSOR HEALTH TAB ────────────────────────────────────────
// Polls /api/poka-yoke/sensor-sweep/{line_id} every 5 s.  Passive read-only
// view: each sensing X-bit shows its current value, when it last toggled,
// and whether it's gone stuck (>15 min without a natural toggle).  No
// force-toggle: the collector NEVER writes back to the PLC.  If a sensor
// goes stuck, an email fires once and the operator inspects physically.
export function SensorHealthPage({ lines, toast, token, readOnly = false }) {
  const [lineId,    setLineId]    = useState(() => (lines?.[0]?.id ?? null));
  const [sweep,     setSweep]     = useState({ swept_at: null, entries: [] });
  const [search,    setSearch]    = useState("");
  const [zoneFilter, setZoneFilter] = useState("");   // "" = all zones

  // 1-second wall-clock tick so every relative-time label ("13s ago",
  // "Last snapshot 2s old") re-renders smoothly without waiting for the
  // next 5-second backend poll.  Cheap — just a Date.now() bump.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // ── Zones list for the filter dropdown ─────────────────────────────
  const [zones, setZones] = useState([]);
  useEffect(() => {
    api.get("/api/zones/", token)
      .then(z => setZones(Array.isArray(z) ? z : []))
      .catch(() => {});
  }, [token]);

  // ── Current model running on the selected line ─────────────────────
  // We poll /api/poka-yoke/live/{line_id} (already filters by current
  // model on the backend) — every row's py_master_id tells us which PYs
  // are applicable for the model that's actually running right now.
  const [liveModel, setLiveModel] = useState({
    name: null, bit: null, allowed_py_ids: null,
  });
  useEffect(() => {
    if (!lineId) {
      setLiveModel({ name: null, bit: null, allowed_py_ids: null });
      return;
    }
    const fetchLive = () => {
      api.get(`/api/poka-yoke/live/${lineId}`, token)
        .then(rows => {
          const arr = Array.isArray(rows) ? rows : [];
          const ids = new Set(
            arr.map(r => r.py_master_id).filter(v => v != null),
          );
          // Prefer the top-level resolved bit (always set when /live/
          // resolved a model); fall back to per-row JOIN bit_number.
          const bit = arr[0]?.current_model_bit ?? arr[0]?.model_bit ?? null;
          setLiveModel({
            name: arr[0]?.current_model || null,
            bit,
            allowed_py_ids: ids.size > 0 ? ids : null,
          });
        })
        .catch(() => {});
    };
    fetchLive();
    const t = setInterval(fetchLive, 10000);
    return () => clearInterval(t);
  }, [lineId, token]);

  // ── PY Master CRUD (inline edit + delete + quick-add) ───────────────
  // Drives the ✏️ / 🗑️ icons on each row and the "+ Add Sensor" button at
  // the top — all backed by the same /api/poka-yoke/master/ endpoints the
  // PY Master tab uses.  Also gives us each PY's zone so the Zone filter
  // dropdown can do a client-side join.
  const [pyMaster, setPyMaster]     = useState([]);
  const [editPy,   setEditPy]       = useState(null);   // py object being edited
  const [editForm, setEditForm]     = useState({ description: "", sensingBits: "" });
  const [savingEdit, setSavingEdit] = useState(false);
  const [showAdd,  setShowAdd]      = useState(false);
  const [addForm,  setAddForm]      = useState({
    pyNo: "", description: "", dBit: "", sensingBits: "",
    modelType: "4 Way", typeSide: "ALL", registerCount: 1, zoneId: "",
  });
  const [savingAdd, setSavingAdd]   = useState(false);

  const reloadMaster = useCallback(async () => {
    try {
      const d = await api.get("/api/poka-yoke/master/", token);
      setPyMaster(Array.isArray(d) ? d : []);
    } catch(e) { /* silent — master list is best-effort */ }
  }, [token]);

  useEffect(() => {
    if (!lineId) return;
    const fetchSweep = () => {
      api.get(`/api/poka-yoke/sensor-sweep/${lineId}`, token)
        .then(d => setSweep(d && typeof d === "object" ? d
                              : { swept_at: null, entries: [] }))
        .catch(() => {});
    };
    fetchSweep();
    reloadMaster();
    const t = setInterval(fetchSweep, 5000);
    return () => clearInterval(t);
  }, [lineId, token, reloadMaster]);

  // ── Edit X-bit / description for an existing PY ────────────────────
  const openEdit = (g) => {
    // Find the PY master row matching this group's d_bit
    const py = pyMaster.find(p =>
      (p.dBit || p.register || "").toUpperCase().includes((g.d_bit||"").toUpperCase())
      || g.py_id === p.id);
    if (!py) {
      toast("PY master row not found — load PY Master tab once", "err");
      return;
    }
    setEditPy(py);
    setEditForm({
      description: py.description || "",
      sensingBits: py.sensingBits || "",
    });
  };
  const closeEdit = () => { setEditPy(null); setEditForm({ description:"", sensingBits:"" }); };
  const saveEdit  = async () => {
    if (!editPy) return;
    setSavingEdit(true);
    try {
      await api.put(`/api/poka-yoke/master/${editPy.id}`, {
        description: editForm.description,
        sensingBits: editForm.sensingBits.toUpperCase(),
      }, token);
      toast("Updated ✓", "ok");
      closeEdit();
      reloadMaster();
    } catch(e) { toast(e.message || "Save failed", "err"); }
    finally   { setSavingEdit(false); }
  };

  // ── Delete (soft-deactivate) a PY ──────────────────────────────────
  const delSensor = async (g) => {
    const py = pyMaster.find(p =>
      (p.dBit || p.register || "").toUpperCase().includes((g.d_bit||"").toUpperCase())
      || g.py_id === p.id);
    if (!py) { toast("PY master row not found", "err"); return; }
    if (!confirm(`Delete "${py.description || py.dBit}" from PY master?\n\nIt'll stop monitoring this sensor immediately.`)) return;
    try {
      await api.delete(`/api/poka-yoke/master/${py.id}`, token);
      toast("Deleted ✓", "ok");
      reloadMaster();
    } catch(e) { toast(e.message || "Delete failed", "err"); }
  };

  // ── Quick-add a new PY straight from the Sensor Health page ────────
  const openAdd = () => {
    setAddForm({
      pyNo: "", description: "", dBit: "", sensingBits: "",
      modelType: "4 Way", typeSide: "ALL", registerCount: 1,
    });
    setShowAdd(true);
  };
  const saveAdd = async () => {
    if (!addForm.dBit.trim() || !addForm.description.trim()) {
      toast("D-Bit and Description are required", "err");
      return;
    }
    setSavingAdd(true);
    try {
      await api.post("/api/poka-yoke/master/", {
        pyNo:          addForm.pyNo.trim() || addForm.dBit.toUpperCase().trim(),
        description:   addForm.description.trim(),
        dBit:          addForm.dBit.toUpperCase().trim(),
        register:      addForm.dBit.toUpperCase().trim(),
        sensingBits:   addForm.sensingBits.toUpperCase().trim() || null,
        modelType:     addForm.modelType,
        typeSide:      addForm.typeSide,
        registerCount: addForm.registerCount,
      }, token);
      toast("Added ✓", "ok");
      setShowAdd(false);
      reloadMaster();
    } catch(e) { toast(e.message || "Add failed", "err"); }
    finally   { setSavingAdd(false); }
  };

  // py_id → zoneId / zoneName / zoneCode  (cross-ref from pyMaster).
  // The collector's snapshot doesn't include zone info, so we join here on
  // the client side using whatever's currently in PY Master.
  const pyZoneMap = {};
  pyMaster.forEach(p => {
    if (p.id != null) pyZoneMap[p.id] = {
      zoneId:   p.zoneId,
      zoneName: p.zoneName,
      zoneCode: p.zoneCode,
    };
  });

  const rawEntries = (sweep.entries || []).filter(e => {
    if (search && !`${e.bit||""} ${e.d_bit||""} ${e.py_name||""}`
                       .toLowerCase().includes(search.toLowerCase()))
      return false;
    if (zoneFilter) {
      const z = pyZoneMap[e.py_id];
      if (!z || String(z.zoneId) !== String(zoneFilter)) return false;
    }
    // Restrict to PYs actually configured for the line's CURRENT model.
    // If the live endpoint hasn't returned anything yet, allow all so the
    // user sees something while the page loads.
    if (liveModel.allowed_py_ids) {
      if (!liveModel.allowed_py_ids.has(e.py_id)) return false;
    }
    return true;
  });

  // Group by PY / D-bit so a multi-sensing-bit PY (e.g. D407 with X26+X27)
  // collapses into a single row.  Aggregate X-bits + values as comma-lists
  // and pick the BEST status — if ANY bit toggled recently the PY is
  // doing its job, so the row is "alive".  Only when EVERY bit is stuck
  // does the row read STUCK.  This matches operator intuition: an E-RING
  // PY with X12+X13 where one limit-switch is firing means the part is
  // being detected, even if the other bit hasn't seen a part yet.
  const STATUS_RANK = { alive: 0, stuck: 1 };
  const STATUS_BACK = ["alive", "stuck"];
  const groupKey = (e) => e.d_bit || `__${e.bit}`;
  const groupedMap = {};
  rawEntries.forEach(e => {
    const k = groupKey(e);
    if (!groupedMap[k]) {
      groupedMap[k] = {
        d_bit:    e.d_bit,
        py_id:    e.py_id,
        py_name:  e.py_name,
        x_bits:   [],
        x_states: [],
        best:     1,       // start at "stuck"; improves to "alive" if any bit is alive
        // Row "ago" tracks the FRESHEST toggle across all bits, not the
        // oldest — same rationale: any-bit-toggled is enough.  Field
        // name kept as `oldest_toggle_*` for back-compat with downstream
        // formatters; semantics flipped to FRESHEST.
        oldest_toggle_ago: null,
        oldest_toggle_at:  null,
      };
    }
    const g = groupedMap[k];
    g.x_bits.push(e.bit);
    g.x_states.push(e);
    const rank = STATUS_RANK[e.status] ?? 0;
    if (rank < g.best) g.best = rank;   // any "alive" (rank 0) wins
    if (e.last_toggle_ago_sec != null
        && (g.oldest_toggle_ago == null
            || e.last_toggle_ago_sec < g.oldest_toggle_ago)) {
      g.oldest_toggle_ago = e.last_toggle_ago_sec;
      g.oldest_toggle_at  = e.last_toggle_at || g.oldest_toggle_at;
    }
  });
  const entries = Object.values(groupedMap)
    .map(g => ({ ...g, status: STATUS_BACK[g.best] }));

  const total    = entries.length;
  const aliveCt  = entries.filter(e => e.status === "alive").length;
  const stuckCt  = entries.filter(e => e.status === "stuck").length;

  const fmtAgo = (sec) => {
    if (sec == null || sec < 0) return "—";
    if (sec < 60)  return `${Math.round(sec)}s ago`;
    if (sec < 3600) return `${Math.floor(sec/60)}m ${Math.round(sec%60)}s ago`;
    return `${Math.floor(sec/3600)}h ${Math.floor((sec%3600)/60)}m ago`;
  };

  // Live "ago" — reads the backend ISO timestamp and recomputes against
  // the 1-Hz wall-clock tick so the label keeps moving (13s → 14s → 15s)
  // even between backend polls.  Falls back to backend-supplied seconds
  // if the ISO string is missing.
  const liveAgo = (isoStr, fallbackSec) => {
    if (isoStr) {
      const t = new Date(isoStr).getTime();
      if (!isNaN(t)) return fmtAgo((nowMs - t) / 1000);
    }
    return fmtAgo(fallbackSec);
  };

  // Snapshot age — green if fresh (<15 s), amber if 15–30 s, red if older
  // because that means the collector probably stopped publishing.
  const snapAgeSec = sweep.swept_at
    ? (nowMs - new Date(sweep.swept_at).getTime()) / 1000
    : null;
  const snapColor =
    snapAgeSec == null ? "#94a3b8" :
    snapAgeSec < 15    ? "#16a34a" :
    snapAgeSec < 30    ? "#f59e0b" : "#ef4444";

  return (
    <div>
      {/* Stats */}
      <div style={{display:"flex",gap:14,marginBottom:18,flexWrap:"wrap"}}>
        {[
          { label:"Total tracked", val: total,   color:"#1e40af" },
          { label:"Alive",         val: aliveCt, color:"#16a34a" },
          { label:"Stuck (>15m)",  val: stuckCt, color:"#ef4444" },
        ].map(({label,val,color})=>(
          <div key={label} style={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:10,padding:"12px 18px",minWidth:120}}>
            <div style={{fontSize:11,color:"#64748b",fontWeight:600,textTransform:"uppercase",letterSpacing:".06em"}}>{label}</div>
            <div style={{fontSize:26,fontWeight:800,color}}>{val}</div>
          </div>
        ))}
      </div>

      {/* Header + controls */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,gap:10,flexWrap:"wrap"}}>
        <div>
          <div style={{fontWeight:700,fontSize:15,color:"#0f172a"}}>Sensor Health — passive read-only monitor</div>
          <div style={{fontSize:11,color:"#64748b",marginTop:2}}>
            Last snapshot:&nbsp;
            <b style={{color:snapColor}}>
              {sweep.swept_at ? new Date(sweep.swept_at).toLocaleTimeString() : "—"}
            </b>
            <span style={{color:snapColor,marginLeft:6,fontWeight:600}}>
              ({snapAgeSec == null ? "no data" : `${Math.round(snapAgeSec)}s old`})
            </span>
            &nbsp; | &nbsp; X-bit polled ~1 Hz; collector NEVER writes the PLC.
            &nbsp; If no natural toggle in 15 min → STUCK + email alert fires once.
          </div>
        </div>
        <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
          <Select value={lineId || ""} onChange={e=>setLineId(Number(e.target.value)||null)} style={{minWidth:140}}>
            {(lines || []).map(l=> <option key={l.id} value={l.id}>{l.line_name}</option>)}
          </Select>
          <Select value={zoneFilter} onChange={e=>setZoneFilter(e.target.value)} style={{minWidth:160}}>
            <option value="">All Zones</option>
            {zones.map(z=>(
              <option key={z.id} value={z.id}>
                {z.zone_name}{z.zone_code ? ` (${z.zone_code})` : ""}
              </option>
            ))}
          </Select>
          <Input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search bit / PY…" style={{width:200}}/>
          {!readOnly && <Btn variant="primary" onClick={openAdd}>+ Add Sensor</Btn>}
        </div>
      </div>

      {/* Per-line current-model heading */}
      <div style={{marginBottom:16,padding:"12px 18px",background:"#fff",
                   border:"1px solid #e2e8f0",borderRadius:10,
                   display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
        <div style={{fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:".06em"}}>
          Line
        </div>
        <div style={{fontSize:16,fontWeight:800,color:"#0f172a",fontFamily:"'Barlow Condensed',sans-serif"}}>
          {(lines || []).find(l => l.id === lineId)?.line_name || "—"}
        </div>
        <div style={{borderLeft:"2px solid #e2e8f0",height:24,margin:"0 4px"}}/>
        <div style={{fontSize:11,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:".06em"}}>
          Running Model
        </div>
        {liveModel.name ? (
          <>
            <span style={{display:"inline-block",padding:"3px 12px",borderRadius:99,fontSize:13,fontWeight:800,
                         background:"rgba(124,58,237,.12)",color:"#6d28d9",fontFamily:"monospace"}}>
              #{liveModel.bit ?? "?"}
            </span>
            <span style={{fontSize:13,fontWeight:700,color:"#0f172a"}}>
              {liveModel.name}
            </span>
          </>
        ) : (
          <span style={{fontSize:12,color:"#94a3b8",fontStyle:"italic"}}>
            no model running — showing all configured PYs
          </span>
        )}
        {liveModel.allowed_py_ids && (
          <span style={{marginLeft:"auto",fontSize:11,color:"#64748b"}}>
            <b>{liveModel.allowed_py_ids.size}</b> PY{liveModel.allowed_py_ids.size===1?"":"s"} applicable for this model
          </span>
        )}
      </div>

      <Card>
        {entries.length === 0 ? (
          <EmptyState text="No sensor data yet"
            sub={readOnly
              ? "Collector publishes every ~10 seconds — readings will appear once data flows in."
              : 'Collector publishes every ~10 seconds. Click "+ Add Sensor" to register a new PY (D-bit + X-bit) right here.'}/>
        ) : (
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
              <thead><tr>
                {["Zone","D-Bit","PY Name","X-Bit","Current","Last Toggle","Status", ...(readOnly ? [] : ["Edit"])].map(h=>(
                  <th key={h} style={{padding:"9px 12px",textAlign:"left",fontSize:9,fontWeight:700,letterSpacing:".08em",textTransform:"uppercase",color:"#64748b",borderBottom:"2px solid #e2e8f0",whiteSpace:"nowrap"}}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {entries.map(g => {
                  const status  = g.status || "alive";
                  const isStuck = status === "stuck";

                  // Comma-joined X-bit list and the per-bit current values
                  // shown in the same order so user can pair them up.
                  const xBitsStr = g.x_bits.join(", ");
                  const valStr   = g.x_states
                      .map(s => s.current_value == null ? "—" : s.current_value)
                      .join(", ");

                  // Zone label — pulled from PY Master cross-ref.
                  const zoneInfo  = pyZoneMap[g.py_id] || {};
                  const zoneLabel = zoneInfo.zoneName || zoneInfo.zoneCode || "—";

                  const statusNode = isStuck ? (
                    <span style={{display:"inline-block",padding:"2px 9px",borderRadius:99,fontSize:10,fontWeight:700,
                                  background:"rgba(239,68,68,.14)",color:"#b91c1c",
                                  animation:"blink 1s infinite"}}>
                      ✗ STUCK
                    </span>
                  ) : (
                    <span style={{display:"inline-block",padding:"2px 9px",borderRadius:99,fontSize:10,fontWeight:700,
                                  background:"rgba(22,163,74,.14)",color:"#15803d"}}>
                      ✓ ALIVE
                    </span>
                  );

                  const rowKey = g.d_bit || g.x_bits[0];

                  return (
                    <tr key={rowKey} style={{borderBottom:"1px solid #f1f5f9",
                          background: isStuck ? "rgba(239,68,68,.04)" : "transparent"}}>
                      <td style={{padding:"8px 12px",fontSize:11,whiteSpace:"nowrap"}}
                          title={zoneInfo.zoneCode ? `Code: ${zoneInfo.zoneCode}` : ""}>
                        {zoneInfo.zoneName ? (
                          <span style={{display:"inline-block",padding:"2px 8px",borderRadius:99,
                                        background:"rgba(30,64,175,.1)",color:"#1e40af",fontWeight:700,fontSize:10}}>
                            {zoneInfo.zoneName}
                          </span>
                        ) : <span style={{color:"#cbd5e1"}}>—</span>}
                      </td>
                      <td style={{padding:"8px 12px",fontFamily:"monospace",fontWeight:700,color:"#7c3aed"}}>{g.d_bit || "—"}</td>
                      <td style={{padding:"8px 12px",color:"#0f172a",maxWidth:240,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={g.py_name||""}>
                        {g.py_name || <span style={{color:"#94a3b8",fontStyle:"italic"}}>(unbound)</span>}
                      </td>
                      <td style={{padding:"8px 12px",fontFamily:"monospace",fontWeight:700,color:"#0891b2"}}
                          title={g.x_bits.length > 1 ? `${g.x_bits.length} sensing bits` : ""}>
                        {xBitsStr}
                      </td>
                      <td style={{padding:"8px 12px",fontFamily:"monospace",fontWeight:700,color:"#0f172a"}}
                          title={g.x_bits.length > 1 ? "values shown in the order of X-bits" : ""}>
                        {valStr}
                      </td>
                      <td style={{padding:"8px 12px",fontSize:11,color:"#64748b"}}
                          title={`oldest of ${g.x_bits.length} bit(s)`}>
                        {liveAgo(g.oldest_toggle_at, g.oldest_toggle_ago)}
                      </td>
                      <td style={{padding:"8px 12px"}}>{statusNode}</td>
                      {!readOnly && (
                        <td style={{padding:"8px 12px",whiteSpace:"nowrap"}}>
                          <div style={{display:"flex",gap:6}}>
                            <Btn size="sm" onClick={()=>openEdit(g)} title="Change X-bit / description">✏️</Btn>
                            <Btn size="sm" variant="danger" onClick={()=>delSensor(g)} title="Remove this PY from monitoring">🗑️</Btn>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div style={{padding:"8px 14px",fontSize:11,color:"#94a3b8",borderTop:"1px solid #f1f5f9"}}>
              Showing {entries.length} PYs ({rawEntries.length} total sensing X-bits).
              Multi-X-bit PYs (e.g. D406 with X21+X22) are collapsed into one row;
              if <b style={{color:"#16a34a"}}>any</b> bit toggled within 15&nbsp;min the row reads <b>ALIVE</b>;
              only when <b>every</b> bit goes stuck does the row turn <b style={{color:"#ef4444"}}>STUCK</b>.
              {!readOnly && ' ✏️ to change X-bit/description, 🗑️ to remove the sensor, "+ Add Sensor" to register a new one.'}
            </div>
          </div>
        )}
      </Card>

      {/* ── Edit X-bit / description ── */}
      {editPy && (
        <Modal open={!!editPy} onClose={closeEdit} title={`Edit ${editPy.dBit || editPy.register || editPy.pyNo}`}>
          <div style={{display:"grid",gridTemplateColumns:"1fr",gap:14}}>
            <FF label="D-Bit (read-only)">
              <Input value={editPy.dBit || editPy.register || ""} disabled
                style={{fontFamily:"monospace",color:"#7c3aed",fontWeight:700}}/>
            </FF>
            <FF label="Description">
              <Input value={editForm.description}
                onChange={e=>setEditForm(f=>({...f,description:e.target.value}))}
                placeholder="Harness brkt pop rivet operation miss"/>
            </FF>
            <FF label="Sensing X-Bit(s)">
              <Input value={editForm.sensingBits}
                onChange={e=>setEditForm(f=>({...f,sensingBits:e.target.value.toUpperCase()}))}
                placeholder="X15  OR  X21,X22"
                style={{fontFamily:"monospace",fontWeight:700,color:"#0891b2"}}/>
              <div style={{fontSize:10,color:"#94a3b8",marginTop:4}}>
                Comma-separated for PYs with multiple sensing inputs.  Blank = skip health monitoring.
              </div>
            </FF>
          </div>
          <ModalActions>
            <Btn onClick={closeEdit}>Cancel</Btn>
            <Btn variant="primary" disabled={savingEdit} onClick={saveEdit}>
              {savingEdit ? "Saving…" : "Save"}
            </Btn>
          </ModalActions>
        </Modal>
      )}

      {/* ── Quick-add a new PY ── */}
      {showAdd && (
        <Modal open={showAdd} onClose={()=>setShowAdd(false)} title="Add Sensor (new PY)" wide>
          <div style={{padding:"10px 14px",background:"#fff7ed",border:"1px solid #fed7aa",borderRadius:8,fontSize:11,color:"#9a3412",marginBottom:14}}>
            Quick-add only — for full type/side/model assignment use Poka Yoke → Master tab.
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
            <FF label="D-Bit *">
              <Input value={addForm.dBit}
                onChange={e=>setAddForm(f=>({...f,dBit:e.target.value.toUpperCase()}))}
                placeholder="D420"
                style={{fontFamily:"monospace",fontWeight:700,color:"#7c3aed"}}/>
            </FF>
            <FF label="Sensing X-Bit(s)">
              <Input value={addForm.sensingBits}
                onChange={e=>setAddForm(f=>({...f,sensingBits:e.target.value.toUpperCase()}))}
                placeholder="X20  OR  X21,X22"
                style={{fontFamily:"monospace",fontWeight:700,color:"#0891b2"}}/>
            </FF>
            <FF label="Description *" style={{gridColumn:"1/-1"}}>
              <Input value={addForm.description}
                onChange={e=>setAddForm(f=>({...f,description:e.target.value}))}
                placeholder="Sensor description"/>
            </FF>
            <FF label="PY No. (optional, defaults to D-bit)">
              <Input value={addForm.pyNo}
                onChange={e=>setAddForm(f=>({...f,pyNo:e.target.value}))}
                placeholder="auto"/>
            </FF>
            <FF label="Type">
              <Select value={addForm.modelType} onChange={e=>setAddForm(f=>({...f,modelType:e.target.value}))}>
                <option>4 Way</option>
                <option>6 Way</option>
              </Select>
            </FF>
            <FF label="Side">
              <Select value={addForm.typeSide} onChange={e=>setAddForm(f=>({...f,typeSide:e.target.value}))}>
                <option>ALL</option>
                <option>LH</option>
                <option>RH</option>
                <option>OTR</option>
              </Select>
            </FF>
            <FF label="Register Output">
              <Select value={addForm.registerCount}
                onChange={e=>setAddForm(f=>({...f,registerCount:Number(e.target.value)}))}>
                <option value={1}>1 register (PASS / OFF / ON)</option>
                <option value={2}>2 registers (combined codes)</option>
              </Select>
            </FF>
          </div>
          <ModalActions>
            <Btn onClick={()=>setShowAdd(false)}>Cancel</Btn>
            <Btn variant="primary" disabled={savingAdd} onClick={saveAdd}>
              {savingAdd ? "Saving…" : "Add Sensor"}
            </Btn>
          </ModalActions>
        </Modal>
      )}
    </div>
  );
}

// ─── MODEL MASTER TAB ─────────────────────────────────────────
function PYModels({ models, series, zones = [], toast, token, onReload, readOnly = false }) {
  // ── Series Master (top section) ───────────────────────────────────────────
  const [newSeries, setNewSeries] = useState("");
  const [sBusy,     setSBusy]     = useState(false);

  // ── Model Config (bottom section) ─────────────────────────────────────────
  const [modal,   setModal]   = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving,  setSaving]  = useState(false);
  const [search,  setSearch]  = useState("");

  const MODEL_TYPES = ["4 Way Inr LH","4 Way Inr RH","4 Way OTR","6 Way Inr LH","6 Way Inr RH","6 Way Otr LH","6 Way Otr RH"];
  const EMPTY = { bitNumber:"", type:"", selSeries:[], modelName:"", zoneId:"" };
  const [form, setForm] = useState(EMPTY);

  // Bit numbers are unique WITHIN a zone, so the "already used" warning
  // only fires when the user picks a zone that already has the same bit.
  const usedBits = new Set(
    models
      .filter(m => m.bitNumber != null
                && String(m.zoneId || "") === String(form.zoneId || ""))
      .map(m => m.bitNumber)
  );

  // {TYPE}: ({S1/S2/...})
  const buildName = (type, seriesArr) => {
    const t = (type||"").toUpperCase().trim() || "—";
    const s = (seriesArr||[]).join("/") || "—";
    return `${t}: (${s})`;
  };

  // ── Series handlers ───────────────────────────────────────────────────────
  const addSeries = async () => {
    const code = newSeries.trim().toUpperCase();
    if (!code) { toast("Series code required","err"); return; }
    if (series.some(s=>s.code===code)) { toast(`${code} already exists`,"err"); return; }
    setSBusy(true);
    try {
      await api.post("/api/poka-yoke/series/", { code }, token);
      setNewSeries(""); toast(`${code} added ✓`); onReload();
    } catch(e) { toast(e.message,"err"); }
    finally { setSBusy(false); }
  };

  const delSeries = async (s) => {
    if (!confirm(`Delete series "${s.code}"?`)) return;
    try { await api.delete(`/api/poka-yoke/series/${s.id}`, token); toast("Deleted"); onReload(); }
    catch(e) { toast(e.message,"err"); }
  };

  // ── Model handlers ────────────────────────────────────────────────────────
  const openAdd  = () => { setForm(EMPTY); setEditing(null); setModal(true); };
  const openEdit = m => {
    const seriesArr = (m.model||"").split("/").map(x=>x.trim()).filter(Boolean);
    setForm({
      bitNumber: m.bitNumber!=null ? String(m.bitNumber) : "",
      type:      m.type || "",
      selSeries: seriesArr,
      modelName: (m.modelName||"").replace(/^TYPE-SERIES:\s*/i,""),
      zoneId:    m.zoneId != null ? String(m.zoneId) : "",
    });
    setEditing(m); setModal(true);
  };

  const toggleSeries = (code) => {
    setForm(f => ({ ...f, selSeries: f.selSeries.includes(code)
      ? f.selSeries.filter(x=>x!==code)
      : [...f.selSeries, code] }));
  };

  const save = async () => {
    if (!form.bitNumber)          { toast("Bit number required","err");      return; }
    if (!form.zoneId)             { toast("Zone required","err");            return; }
    if (!form.type)               { toast("Type required","err");            return; }
    if (form.selSeries.length===0){ toast("Select at least one series","err"); return; }
    if (!form.modelName.trim())   { toast("Model Name required","err");      return; }
    const bit = parseInt(form.bitNumber);
    // Bit-conflict check is now scoped to the selected zone — same bit
    // can legitimately exist in another zone.
    const conflict = models.find(m =>
      m.bitNumber === bit
      && String(m.zoneId || "") === String(form.zoneId)
      && (!editing || m.id !== editing.id),
    );
    if (conflict) {
      toast(`Bit ${bit} already used by "${conflict.modelName}" in this zone`,"err");
      return;
    }

    const payload = {
      modelName: form.modelName.trim(),
      type:      form.type,
      model:     form.selSeries.join("/"),
      bitNumber: bit,
      zoneId:    Number(form.zoneId),
    };
    setSaving(true);
    try {
      if (editing) { await api.put(`/api/poka-yoke/models/${editing.id}`, payload, token); toast("Updated ✓"); }
      else         { await api.post("/api/poka-yoke/models/", payload, token);            toast("Added ✓"); }
      setModal(false); onReload();
    } catch(e) { toast(e.message,"err"); }
    finally { setSaving(false); }
  };

  const del = async id => {
    if (!confirm("Delete this model?")) return;
    try { await api.delete(`/api/poka-yoke/models/${id}`, token); toast("Deleted"); onReload(); }
    catch(e) { toast(e.message,"err"); }
  };

  const filtered = models.filter(m => !search ||
    Object.values(m).some(v => String(v).toLowerCase().includes(search.toLowerCase())));

  return (
    <div>
      {/* ═════════ SECTION A — Series Master ═════════ */}
      <Card style={{ marginBottom: 20 }}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14,paddingBottom:12,borderBottom:"1px solid #f1f5f9"}}>
          <span style={{fontSize:22}}>🏷️</span>
          <div>
            <div style={{fontSize:15,fontWeight:700,color:"#0f172a"}}>Series Master</div>
            <div style={{fontSize:11,color:"#94a3b8"}}>
              {readOnly
                ? "Series codes (YRA, YNC, YY8 …) currently assignable to models below."
                : "Add the series codes (YRA, YNC, YY8 …) that can be assigned to models below."}
            </div>
          </div>
        </div>
        {!readOnly && (
          <div style={{display:"flex",gap:10,marginBottom:14}}>
            <Input
              value={newSeries}
              onChange={e=>setNewSeries(e.target.value.toUpperCase())}
              placeholder="e.g. YNC"
              style={{maxWidth:220}}
              onKeyDown={e=>{ if(e.key==="Enter") addSeries(); }}
            />
            <Btn variant="primary" onClick={addSeries} disabled={sBusy}>+ Add Series</Btn>
          </div>
        )}
        <div style={{display:"flex",gap:8,flexWrap:"wrap",minHeight:32,alignItems:"center"}}>
          {series.length===0 ? (
            <span style={{fontSize:12,color:"#cbd5e1",fontStyle:"italic"}}>
              {readOnly ? "No series configured." : "No series yet — add your first one above."}
            </span>
          ) : series.map(s=>(
            <span key={s.id} style={{
              display:"inline-flex",alignItems:"center",gap:6,
              padding:"6px 12px 6px 12px",borderRadius:99,
              background:"rgba(22,163,74,.1)",color:"#16a34a",
              fontWeight:800,fontSize:12,letterSpacing:".04em",
            }}>
              {s.code}
              {!readOnly && (
                <button
                  onClick={()=>delSeries(s)}
                  title={`Delete ${s.code}`}
                  style={{
                    border:"none",background:"rgba(220,38,38,.12)",color:"#dc2626",
                    fontWeight:900,cursor:"pointer",fontSize:12,lineHeight:1,
                    width:18,height:18,borderRadius:"50%",padding:0,
                    display:"inline-flex",alignItems:"center",justifyContent:"center",
                    marginLeft:4,
                  }}
                >×</button>
              )}
            </span>
          ))}
        </div>
      </Card>

      {/* ═════════ SECTION B — Model Config ═════════ */}
      <div style={{display:"flex",gap:14,marginBottom:16,flexWrap:"wrap"}}>
        {[
          {label:"Total Models", val:models.length,                                            color:"#1e40af"},
          {label:"Series",       val:series.length,                                            color:"#16a34a"},
          {label:"Bits Assigned",val:models.filter(m=>m.bitNumber!=null).length,               color:"#7c3aed"},
        ].map(({label,val,color})=>(
          <div key={label} style={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:10,padding:"12px 18px",minWidth:110}}>
            <div style={{fontSize:11,color:"#64748b",fontWeight:600,textTransform:"uppercase",letterSpacing:".06em"}}>{label}</div>
            <div style={{fontSize:26,fontWeight:800,color}}>{val}</div>
          </div>
        ))}
      </div>

      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,gap:10,flexWrap:"wrap"}}>
        <div style={{fontWeight:700,fontSize:15,color:"#0f172a"}}>Model Master</div>
        <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search..." style={{...inputStyle,width:200,padding:"8px 12px"}}/>
          {!readOnly && (
            <>
              <ExcelTools routePrefix="/api/poka-yoke/models"
                          label="models" fileBaseName="model_master"
                          token={token} toast={toast} onDone={onReload}/>
              <Btn variant="primary" onClick={openAdd}>+ Add Model</Btn>
            </>
          )}
        </div>
      </div>

      <Card>
        {filtered.length===0 ? (
          <EmptyState text="No models" sub={readOnly ? "No models configured yet." : 'Click "+ Add Model" to create your first one.'}/>
        ) : (
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
              <thead><tr>
                {["Zone","Bit #","Type","Series","Model Name", ...(readOnly ? [] : ["Actions"])].map(h=>(
                  <th key={h} style={{padding:"9px 14px",textAlign:"left",fontSize:9,fontWeight:700,letterSpacing:".08em",textTransform:"uppercase",color:"#64748b",borderBottom:"2px solid #e2e8f0"}}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {filtered.map(m=>(
                  <tr key={m.id} style={{borderBottom:"1px solid #f1f5f9"}}>
                    <td style={{padding:"10px 14px",whiteSpace:"nowrap"}}>
                      {m.zoneName ? (
                        <span style={{display:"inline-block",padding:"2px 9px",borderRadius:99,fontSize:10,fontWeight:700,background:"rgba(30,64,175,.1)",color:"#1e40af"}}
                              title={m.zoneCode||""}>
                          {m.zoneName}
                        </span>
                      ) : <span style={{color:"#cbd5e1",fontSize:11}}>—</span>}
                    </td>
                    <td style={{padding:"10px 14px"}}>
                      {m.bitNumber!=null
                        ? <span style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:34,height:34,borderRadius:8,background:"linear-gradient(135deg,#7c3aed,#6d28d9)",color:"#fff",fontWeight:800,fontSize:14}}>{m.bitNumber}</span>
                        : <span style={{color:"#cbd5e1",fontSize:11}}>—</span>}
                    </td>
                    <td style={{padding:"10px 14px",whiteSpace:"nowrap"}}>
                      <span style={{display:"inline-block",padding:"3px 10px",borderRadius:99,fontSize:10,fontWeight:700,background:"rgba(30,64,175,.1)",color:"#1e40af",whiteSpace:"nowrap"}}>{m.type||"—"}</span>
                    </td>
                    <td style={{padding:"10px 14px"}}>
                      <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                        {(m.model||"").split("/").map(x=>x.trim()).filter(Boolean).map(s=>(
                          <span key={s} style={{padding:"2px 9px",borderRadius:99,fontSize:10,fontWeight:700,background:"rgba(22,163,74,.1)",color:"#16a34a"}}>{s}</span>
                        ))}
                        {!m.model && <span style={{color:"#cbd5e1"}}>—</span>}
                      </div>
                    </td>
                    <td style={{padding:"10px 14px",fontFamily:"monospace",fontSize:11,color:"#475569",fontWeight:600}}>{(m.modelName||"").replace(/^TYPE-SERIES:\s*/i,"")}</td>
                    {!readOnly && (
                      <td style={{padding:"10px 14px"}}>
                        <div style={{display:"flex",gap:6}}>
                          <Btn size="sm" onClick={()=>openEdit(m)}>Edit</Btn>
                          <Btn size="sm" variant="danger" onClick={()=>del(m.id)}>Delete</Btn>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div style={{padding:"8px 14px",fontSize:11,color:"#94a3b8",borderTop:"1px solid #f1f5f9"}}>Showing {filtered.length} of {models.length} models</div>
      </Card>

      {/* Add / Edit Modal */}
      <Modal open={modal} onClose={()=>setModal(false)} title={editing?"Edit Model":"Add New Model"} wide>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
          <FF label="Zone *">
            <Select value={form.zoneId}
                    onChange={e=>setForm(f=>({...f,zoneId:e.target.value}))}>
              <option value="">— Select Zone —</option>
              {zones.map(z=>(
                <option key={z.id} value={z.id}>
                  {z.zone_name}{z.zone_code ? ` (${z.zone_code})` : ""}
                </option>
              ))}
            </Select>
            <div style={{fontSize:10,color:"#94a3b8",marginTop:4}}>
              Bit numbers are unique <b>within a zone</b> — same bit can repeat across zones.
            </div>
          </FF>

          <FF label="Bit Number *">
            <Input
              type="number"
              value={form.bitNumber}
              onChange={e=>setForm(f=>({...f,bitNumber:e.target.value}))}
              placeholder="1, 2, 3..."
              min="1"
              disabled={!form.zoneId}
            />
            {form.bitNumber && usedBits.has(parseInt(form.bitNumber)) && (!editing || editing.bitNumber!==parseInt(form.bitNumber) || String(editing.zoneId||"") !== String(form.zoneId)) && (
              <div style={{fontSize:10,color:"#dc2626",marginTop:4,fontWeight:600}}>Bit {form.bitNumber} already used in this zone!</div>
            )}
          </FF>

          <FF label="Type *">
            <Select value={form.type} onChange={e=>setForm(f=>({...f,type:e.target.value}))}>
              <option value="">— Select Type —</option>
              {MODEL_TYPES.map(t=><option key={t}>{t}</option>)}
            </Select>
          </FF>

          <FF label="Series * (pick one or more)" style={{gridColumn:"1/-1"}}>
            {series.length===0 ? (
              <div style={{fontSize:12,color:"#dc2626",padding:12,border:"1px dashed #fecaca",borderRadius:8,background:"rgba(220,38,38,.04)"}}>
                Add series in the <b>Series Master</b> section above first.
              </div>
            ) : (
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                {series.map(s=>{
                  const on = form.selSeries.includes(s.code);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={()=>toggleSeries(s.code)}
                      style={{
                        padding:"7px 14px",borderRadius:99,fontSize:12,fontWeight:700,cursor:"pointer",
                        transition:"all .12s",letterSpacing:".04em",
                        border: on ? "1.5px solid #16a34a" : "1px solid #e2e8f0",
                        background: on ? "rgba(22,163,74,.12)" : "#fff",
                        color: on ? "#16a34a" : "#475569",
                      }}
                    >
                      {on ? "✓ " : ""}{s.code}
                    </button>
                  );
                })}
              </div>
            )}
          </FF>

          <FF label="Model Name *" style={{gridColumn:"1/-1"}}>
            <Input
              value={form.modelName}
              onChange={e=>setForm(f=>({...f, modelName: e.target.value}))}
              placeholder="e.g. TRACK ASSY FRONT SEAT YNC 4 WAY INR LH"
              style={{fontFamily:"monospace",fontWeight:600}}
            />
            <div style={{fontSize:10,color:"#94a3b8",marginTop:4}}>
              Jab PLC is bit ko trigger karega, yehi naam Fullscreen par "Model No. {form.bitNumber||'#'}: {form.modelName||'—'}" format mein show hoga.
            </div>
          </FF>
        </div>
        <ModalActions>
          <Btn onClick={()=>setModal(false)}>Cancel</Btn>
          <Btn variant="primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : editing ? "Update Model" : "Add Model"}
          </Btn>
        </ModalActions>
      </Modal>
    </div>
  );
}

// ─── USERS PAGE ───────────────────────────────────────────────
export const ROLE_PILL = {
  admin:      { bg:"rgba(30,64,175,.10)",  fg:"#1e40af" },
  plant_head: { bg:"rgba(30,64,175,.10)",  fg:"#1e40af" },
  department: { bg:"rgba(220,38,38,.10)",  fg:"#dc2626" },
  production: { bg:"rgba(22,163,74,.10)",  fg:"#16a34a" },
  operator:   { bg:"rgba(124,58,237,.10)", fg:"#6d28d9" },
};

// Master list of pages admins can grant per-user permissions on.
// Grouped by area for the permission matrix modal.  page_key MUST
// match the canAccess() keys in AuthContext.jsx so explicit overrides
// resolve correctly.
export const PAGE_PERM_GROUPS = [
  { group: "Production", items: [
    { key: "dashboard",         label: "Production Dashboard" },
    { key: "historical",        label: "Historical Data" },
    { key: "import",            label: "Import / Export" },
    { key: "process-graphs",    label: "Process Graphs" },
    { key: "admin-production",  label: "Admin → Production Panel" },
  ]},
  { group: "Maintenance", items: [
    { key: "maintenance-dashboard",  label: "Maintenance Dashboard" },
    { key: "maintenance-historical", label: "Maintenance Historical Data" },
    { key: "maintenance-capa",       label: "Maintenance CAPA" },
    { key: "maintenance-deviations", label: "Maintenance Deviations" },
    { key: "maintenance-poka-yoke",  label: "Maintenance Poka Yoke" },
    { key: "maintenance-logbook",    label: "Maintenance Log Book" },
    { key: "maintenance-pm",         label: "Preventive Maintenance" },
    { key: "admin-maintenance",      label: "Admin → Maintenance Panel" },
  ]},
  { group: "Quality", items: [
    { key: "quality-dashboard",  label: "Quality Dashboard" },
    { key: "quality-deviations", label: "Quality Deviation" },
    { key: "admin-quality",      label: "Admin → Quality Panel" },
  ]},
  { group: "System", items: [
    { key: "department-panel",   label: "Department Panel" },
    { key: "settings",           label: "Settings" },
    { key: "audit",              label: "Audit Log" },
    { key: "admin",              label: "Admin Core (System Map / Departments / Users)" },
  ]},
];

export const PERM_LEVELS = [
  { key: "none", label: "No Access",  bg: "#fee2e2", color: "#b91c1c" },
  { key: "read", label: "Read-only",  bg: "#fef3c7", color: "#a16207" },
  { key: "full", label: "Full CRUD",  bg: "#dcfce7", color: "#15803d" },
];


