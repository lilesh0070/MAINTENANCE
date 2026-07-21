/* admin/system.jsx — PY Manuals · Breakdown-Slip Threshold · System Map ·
   Reports · OEE Alarm · Operators · Processes · Manpower Config. */
import { useState, useEffect, useRef, useCallback, useMemo, Fragment } from "react";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../api/client";
import {
  PageHeading, Card, Pill, Btn, FF, Input, Select,
  Modal, ModalActions, Toast, EmptyState, Spinner, ExcelImportButton,
} from "./ui";

export function PyManualsPage({ toast, readOnly = false }) {
  const { token } = useAuth();
  const [lines,    setLines]    = useState([]);
  const [lineId,   setLineId]   = useState(null);
  const [pys,      setPys]      = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [editor,   setEditor]   = useState(null);   // {py} when open

  // Load lines once
  useEffect(() => {
    (async () => {
      try {
        const ls = await api.get("/api/lines/", token);
        setLines(Array.isArray(ls) ? ls : []);
        if (ls?.[0]?.id) setLineId(ls[0].id);
      } catch (e) {
        if (toast) toast(`Failed to load lines: ${String(e).slice(0, 60)}`, "err");
      }
    })();
  }, [token, toast]);

  // Load PYs whenever line changes
  const loadPys = useCallback(async () => {
    if (!lineId) return;
    setLoading(true);
    try {
      const rt = await api.get(`/api/lines/${lineId}/realtime`, token).catch(() => ({}));
      const modelBit = rt?.current_model_number;
      const qs = modelBit != null && modelBit !== 0
        ? `?model_bit=${modelBit}`
        : "";
      const data = await api.get(`/api/poka-yoke/live/${lineId}${qs}`, token);
      // /live returns {pys: [...]} OR a flat array depending on version
      const list = Array.isArray(data) ? data
                 : (data?.pys || data?.checks || []);
      setPys(list);
    } catch (e) {
      if (toast) toast(`Failed to load PYs: ${String(e).slice(0, 60)}`, "err");
      setPys([]);
    } finally {
      setLoading(false);
    }
  }, [lineId, token, toast]);

  useEffect(() => { loadPys(); }, [loadPys]);

  return (
    <div style={{ padding:"16px 40px" }}>
      <div style={{ display:"flex", justifyContent:"space-between",
                     alignItems:"center", marginBottom:14 }}>
        <div>
          <h2 style={{ fontSize:22, fontWeight:800, color:"#0f172a", margin:0 }}>
            📷 PY Visual Manuals
          </h2>
          <p style={{ fontSize:12, color:"#64748b", margin:"4px 0 0 0" }}>
            Upload reference images and write follow-step instructions for each PY.
            Operators see these read-only on Maintenance &gt; Poka Yoke.
          </p>
        </div>
        <div>
          <label style={{ fontSize:11, color:"#64748b", marginRight:8 }}>
            Line:
          </label>
          <select value={lineId || ""} onChange={e => setLineId(+e.target.value)}
            style={{ fontSize:12, padding:"5px 10px",
                     border:"1px solid #cbd5e1", borderRadius:6 }}>
            {lines.map(l => (
              <option key={l.id} value={l.id}>
                {l.line_name || `Line ${l.id}`}
              </option>
            ))}
          </select>
          <button onClick={loadPys}
            style={{ fontSize:12, padding:"5px 12px", marginLeft:8,
                     background:"#0369a1", color:"#fff",
                     border:"none", borderRadius:6, cursor:"pointer",
                     fontWeight:700 }}>
            ↻
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ padding:40, textAlign:"center", color:"#94a3b8" }}>Loading…</div>
      ) : !pys?.length ? (
        <div style={{ padding:40, textAlign:"center", color:"#94a3b8",
                       fontStyle:"italic" }}>
          No PYs for the current model on this line.
        </div>
      ) : (
        <div style={{ background:"#fff", border:"1px solid #e2e8f0",
                       borderRadius:10, overflow:"hidden" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
            <thead>
              <tr style={{ background:"#f8fafc",
                            borderBottom:"2px solid #e2e8f0" }}>
                {["PY No.", "Name", "Sensor", "Bit", "Side", "Manual"].map(h =>
                  <th key={h} style={{
                    padding:"10px 12px", fontSize:9, fontWeight:800,
                    letterSpacing:".08em", color:"#64748b",
                    textAlign:"left", whiteSpace:"nowrap",
                  }}>{h}</th>
                )}
              </tr>
            </thead>
            <tbody>
              {pys.map((p, i) => (
                <tr key={i} style={{ borderBottom:"1px solid #f1f5f9" }}>
                  <td style={{ padding:"10px 12px", fontFamily:"monospace",
                                fontWeight:700 }}>
                    {p.poka_yoke_no}
                  </td>
                  <td style={{ padding:"10px 12px" }}>
                    {p.poka_yoke_name || "—"}
                  </td>
                  <td style={{ padding:"10px 12px", fontFamily:"monospace",
                                color:"#0369a1", fontWeight:700 }}>
                    {p.sensing_bits || "—"}
                  </td>
                  <td style={{ padding:"10px 12px", fontFamily:"monospace",
                                color:"#475569" }}>
                    {p.bit || "—"}
                  </td>
                  <td style={{ padding:"10px 12px", color:"#64748b" }}>
                    {p.side || "ALL"}
                  </td>
                  <td style={{ padding:"10px 12px" }}>
                    <button onClick={() => setEditor({ py: p })}
                      disabled={readOnly}
                      style={{
                        fontSize:11, padding:"5px 12px",
                        background:"#0369a1", color:"#fff",
                        border:"none", borderRadius:5, cursor:"pointer",
                        fontWeight:700,
                      }}>
                      📷 Manage
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editor && (
        <PyManualEditorModal
          py={editor.py}
          lineId={lineId}
          token={token}
          toast={toast}
          onClose={() => setEditor(null)}
        />
      )}
    </div>
  );
}


// ── Editor modal (admin-only image upload + instructions edit) ──────
function PyManualEditorModal({ py, lineId, token, toast, onClose }) {
  const [images,   setImages]   = useState([]);
  const [instText, setInstText] = useState("");
  const [instId,   setInstId]   = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [busy,     setBusy]     = useState(false);
  const [savedTs,  setSavedTs]  = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      qs.set("py_no", py.poka_yoke_no);
      if (lineId != null) qs.set("line_id", String(lineId));
      const [imgR, insR] = await Promise.all([
        fetch(`/api/poka-yoke/images?${qs}`,
              { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`/api/poka-yoke/instructions?${qs}`,
              { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (imgR.ok) {
        const d = await imgR.json();
        setImages(d.rows || []);
      }
      if (insR.ok) {
        const d = await insR.json();
        const row = (d.rows || [])[0];
        setInstText(row?.instruction_text || "");
        setInstId(row?.id || null);
      }
    } catch (e) {
      if (toast) toast(`Load failed: ${String(e).slice(0, 60)}`, "err");
    } finally {
      setLoading(false);
    }
  }, [py.poka_yoke_no, lineId, token, toast]);

  useEffect(() => { refresh(); }, [refresh]);

  const onUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setBusy(true);
    let ok = 0, fail = 0;
    for (const f of files) {
      const fd = new FormData();
      fd.append("file", f);
      const qs = new URLSearchParams();
      qs.set("py_no", py.poka_yoke_no);
      if (lineId != null) qs.set("line_id", String(lineId));
      if (py.py_master_id) qs.set("py_master_id", String(py.py_master_id));
      try {
        const r = await fetch(`/api/poka-yoke/images?${qs}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        });
        if (r.ok) ok++; else fail++;
      } catch { fail++; }
    }
    setBusy(false);
    e.target.value = "";
    if (toast) toast(`Uploaded ${ok}/${files.length}` +
                     (fail ? ` (${fail} failed)` : ""),
                     fail ? "err" : "ok");
    refresh();
  };

  const onDeleteImg = async (img) => {
    if (!confirm(`Delete "${img.original_filename}"?`)) return;
    try {
      const r = await fetch(`/api/poka-yoke/images/${img.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok) {
        if (toast) toast("Image deleted", "ok");
        refresh();
      } else {
        if (toast) toast(`Delete failed: HTTP ${r.status}`, "err");
      }
    } catch (e) {
      if (toast) toast(`Delete error: ${String(e).slice(0, 60)}`, "err");
    }
  };

  const onSaveInstructions = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/poka-yoke/instructions", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({
          py_no:        py.poka_yoke_no,
          line_id:      lineId,
          py_master_id: py.py_master_id || null,
          instruction_text: instText,
        }),
      });
      if (r.ok) {
        const d = await r.json();
        setInstId(d.id);
        setSavedTs(new Date().toLocaleTimeString("en-GB"));
        if (toast) toast("Instructions saved", "ok");
      } else {
        if (toast) toast(`Save failed: HTTP ${r.status}`, "err");
      }
    } catch (e) {
      if (toast) toast(`Save error: ${String(e).slice(0, 60)}`, "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{
      position:"fixed", inset:0, background:"rgba(0,0,0,.65)",
      display:"flex", alignItems:"center", justifyContent:"center",
      zIndex:1000,
    }}
    onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
           style={{
             background:"#fff", padding:24, borderRadius:10,
             maxWidth:880, width:"92%", maxHeight:"88vh",
             overflowY:"auto",
             boxShadow:"0 20px 60px rgba(0,0,0,.4)",
           }}>
        <div style={{ display:"flex", justifyContent:"space-between",
                       alignItems:"flex-start", marginBottom:14 }}>
          <div>
            <h3 style={{ margin:0, fontSize:18, fontWeight:800, color:"#0f172a" }}>
              📷 Manage Manual: {py.poka_yoke_no}
            </h3>
            <div style={{ fontSize:11, color:"#64748b", marginTop:4 }}>
              {py.poka_yoke_name || "—"}
              {py.sensing_bits && <span> · Sensor <strong style={{ color:"#0369a1" }}>{py.sensing_bits}</strong></span>}
              {py.bit && <span> · Bit <strong>{py.bit}</strong></span>}
            </div>
          </div>
          <button onClick={onClose}
                  style={{ fontSize:18, padding:"4px 10px",
                           background:"transparent", color:"#64748b",
                           border:"none", cursor:"pointer", fontWeight:700 }}>
            ✕
          </button>
        </div>

        {/* Instructions edit */}
        <div style={{ marginBottom:18 }}>
          <label style={{ fontSize:11, fontWeight:800, color:"#475569",
                           letterSpacing:".06em", display:"block", marginBottom:6 }}>
            📋 INSTRUCTIONS / FOLLOW STEPS
          </label>
          <textarea
            value={instText}
            onChange={e => setInstText(e.target.value)}
            disabled={busy}
            rows={6}
            placeholder={`Example:\n1. Place part on jig\n2. Ensure sensor X15 reads HIGH before pressing OK\n3. If sensor not triggering, check cable B-12 and reset PLC bit M101\n4. Call maintenance if persists > 2 cycles`}
            style={{
              width:"100%", fontSize:12, padding:"10px 12px",
              border:"1px solid #cbd5e1", borderRadius:6,
              resize:"vertical", fontFamily:"inherit",
              minHeight:120, lineHeight:1.5,
            }}/>
          <div style={{ display:"flex", justifyContent:"space-between",
                         alignItems:"center", marginTop:6 }}>
            <span style={{ fontSize:10, color:"#94a3b8" }}>
              Plain text. Line breaks preserved. Operator sees this exactly.
              {savedTs && <span style={{ color:"#16a34a", marginLeft:10 }}>✓ Saved at {savedTs}</span>}
            </span>
            <button onClick={onSaveInstructions} disabled={busy}
              style={{ fontSize:12, padding:"6px 16px",
                       background:"#0369a1", color:"#fff",
                       border:"none", borderRadius:6, cursor:"pointer",
                       fontWeight:700 }}>
              {busy ? "Saving…" : "Save Instructions"}
            </button>
          </div>
        </div>

        <div style={{ borderTop:"1px solid #e2e8f0", margin:"18px 0" }}/>

        {/* Image upload */}
        <div>
          <label style={{ fontSize:11, fontWeight:800, color:"#475569",
                           letterSpacing:".06em", display:"block", marginBottom:6 }}>
            🖼  REFERENCE IMAGES
          </label>
          <div style={{
            padding:12, marginBottom:14,
            border:"2px dashed #cbd5e1", borderRadius:8,
            background:"#f8fafc", textAlign:"center",
          }}>
            <label style={{
              display:"inline-block", padding:"8px 18px",
              background:"#0369a1", color:"#fff", borderRadius:6,
              fontSize:12, fontWeight:700, cursor:"pointer",
              letterSpacing:".05em",
            }}>
              + Upload Image(s)
              <input type="file" multiple accept="image/*"
                     onChange={onUpload}
                     disabled={busy}
                     style={{ display:"none" }}/>
            </label>
            <div style={{ fontSize:10, color:"#94a3b8", marginTop:6 }}>
              PNG, JPG, GIF, WEBP, BMP · max 10 MB each · select multiple at once
            </div>
          </div>
          {loading ? (
            <div style={{ padding:20, textAlign:"center", color:"#94a3b8" }}>Loading…</div>
          ) : !images?.length ? (
            <div style={{ padding:20, textAlign:"center", color:"#94a3b8",
                           fontStyle:"italic", fontSize:11 }}>
              No images uploaded yet.
            </div>
          ) : (
            <div style={{
              display:"grid",
              gridTemplateColumns:"repeat(auto-fill, minmax(180px, 1fr))",
              gap:10,
            }}>
              {images.map(img => (
                <div key={img.id} style={{
                  border:"1px solid #e2e8f0", borderRadius:6,
                  overflow:"hidden", background:"#fff",
                }}>
                  <a href={img.url} target="_blank" rel="noreferrer">
                    <img src={img.url}
                         alt={img.original_filename}
                         style={{ width:"100%", height:140, objectFit:"cover",
                                   display:"block", background:"#f8fafc",
                                   cursor:"zoom-in" }}/>
                  </a>
                  <div style={{ padding:"6px 8px", fontSize:10 }}>
                    <div style={{ fontWeight:600, color:"#475569",
                                   overflow:"hidden", textOverflow:"ellipsis",
                                   whiteSpace:"nowrap" }}
                         title={img.original_filename}>
                      {img.original_filename}
                    </div>
                    <div style={{ display:"flex",
                                   justifyContent:"space-between",
                                   marginTop:4 }}>
                      <span style={{ fontSize:9, color:"#94a3b8" }}>
                        {img.uploaded_by_username || "—"}
                      </span>
                      <button onClick={() => onDeleteImg(img)}
                              style={{ fontSize:9, padding:"1px 6px",
                                       background:"#fee2e2", color:"#b91c1c",
                                       border:"none", borderRadius:3,
                                       cursor:"pointer", fontWeight:700 }}>
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


export function BreakdownSlipThresholdPage({ toast, readOnly = false }) {
  const { token } = useAuth();
  const [threshold, setThreshold] = useState(10);
  const [original,  setOrig]      = useState(10);
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get("/api/breakdowns/slip-config", token);
      const v = r.slip_raise_threshold_min ?? 10;
      setThreshold(v);
      setOrig(v);
    } catch { toast?.("Failed to load slip threshold", "err"); }
    finally { setLoading(false); }
  }, [token, toast]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (threshold < 1 || threshold > 1440) {
      toast?.("Threshold must be 1–1440 min (≤24 h)", "err"); return;
    }
    setSaving(true);
    try {
      await api.put("/api/breakdowns/slip-config", {
        slip_raise_threshold_min: threshold,
      }, token);
      toast?.("Slip threshold saved ✓");
      setOrig(threshold);
      try { window.dispatchEvent(new CustomEvent("ap-config-changed")); } catch {}
    } catch (e) { toast?.(e.message || "Save failed", "err"); }
    finally   { setSaving(false); }
  };

  const dirty = threshold !== original;
  const reset = () => setThreshold(original);

  // Human-readable formatter — converts minutes → "1 h 15 min".
  const fmtMins = (m) => {
    if (!m || m <= 0) return "—";
    const h = Math.floor(m / 60);
    const mm = m % 60;
    if (h && mm) return `${h} h ${mm} min`;
    if (h)       return `${h} h`;
    return `${mm} min`;
  };

  return (
    <div className={readOnly ? "ap-readonly" : ""}>
      <fieldset disabled={readOnly} style={{border:0, padding:0, margin:0, minWidth:0}}>
      <Card style={{ padding: 24 }}>
        <div style={{ fontSize:14, fontWeight:700, color:"#0f172a", marginBottom:6 }}>
          Breakdown Slip Raise Threshold
        </div>
        <div style={{ fontSize:12, color:"#64748b", marginBottom:22, lineHeight:1.5 }}>
          A breakdown that's attended and fixed quickly doesn't need a
          full closure slip — only the threshold matters.  Set the
          number of minutes below which a breakdown is treated as a
          <b> MINOR </b>event (Production logs basic details only, no
          formal slip).  Anything that takes longer becomes a
          <b> MAJOR </b>event and the full slip is raised
          (Production + Maintenance halves both required).
        </div>

        {loading ? (
          <Spinner/>
        ) : (
          <div style={{ display:"flex", justifyContent:"center",
                         marginBottom:18 }}>
            <div style={{ maxWidth: 360, width: "100%" }}>
              <FF label="Slip Raise Threshold (min)"
                  hint="Breakdowns < this many minutes → MINOR (Production basic log only). Breakdowns ≥ this → MAJOR (full slip raised, both halves mandatory).">
                <Input type="number" min="1" max="1440"
                       value={threshold}
                       onChange={e => setThreshold(Number(e.target.value) || 0)}
                       style={{ fontFamily:"monospace", fontWeight:800,
                                fontSize:28, textAlign:"center" }}/>
                <div style={{ fontSize:12, color:"#475569", marginTop:8,
                                textAlign:"center", fontWeight:600 }}>
                  = {fmtMins(threshold)}
                </div>
              </FF>
            </div>
          </div>
        )}

        <div style={{ display:"flex", gap:10, alignItems:"center", justifyContent:"center" }}>
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

        {/* Two side-by-side panels showing the two outcomes — visual
            cheat-sheet for what each tier means */}
        <div style={{ marginTop:26, display:"grid",
                        gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",
                        gap:14 }}>
          {/* MINOR panel */}
          <div style={{ padding:14, background:"rgba(22,163,74,.04)",
                          border:"1.5px solid rgba(22,163,74,.25)",
                          borderRadius:10 }}>
            <div style={{ fontSize:11, fontWeight:800, color:"#15803d",
                            letterSpacing:".08em", textTransform:"uppercase",
                            marginBottom:8 }}>
              ✓ MINOR — fixed under {fmtMins(threshold)}
            </div>
            <div style={{ fontSize:12, color:"#334155", lineHeight:1.7 }}>
              <div>• Slip is <b>NOT raised</b></div>
              <div>• Production logs only basic details (line, time, brief reason)</div>
              <div>• No Maintenance closure form needed</div>
              <div>• Counts in MTBF stats but not in CAPA breach counters</div>
            </div>
          </div>

          {/* MAJOR panel */}
          <div style={{ padding:14, background:"rgba(220,38,38,.04)",
                          border:"1.5px solid rgba(220,38,38,.25)",
                          borderRadius:10 }}>
            <div style={{ fontSize:11, fontWeight:800, color:"#b91c1c",
                            letterSpacing:".08em", textTransform:"uppercase",
                            marginBottom:8 }}>
              ⚠ MAJOR — open ≥ {fmtMins(threshold)}
            </div>
            <div style={{ fontSize:12, color:"#334155", lineHeight:1.7 }}>
              <div>• Slip is <b>RAISED</b></div>
              <div>• Production half required (line/zone/machine, reported-by, received-time)</div>
              <div>• Maintenance half required (problem observed, action taken, spares, attended-by)</div>
              <div>• Counts toward CAPA breach thresholds + Pareto chart</div>
              <div>• Breakdown Mails escalation chain fires</div>
            </div>
          </div>
        </div>
      </Card>
      </fieldset>
    </div>
  );
}


// ─── SYSTEM MAP ───────────────────────────────────────────────
// Single-pane consolidated view: every Zone → Line → Machine → its PLC IP
// → its bound Camera IP, ordered top-down so an admin can verify wiring
// at a glance without bouncing across Plants/Zones/Lines/Machines/Camera
// tabs.  Read-only by design (it's a derived/joined view) — modifications
// happen in the underlying single-purpose pages.
export function SystemMapPage({ toast }) {
  const { token, theme } = useAuth();
  const [grid, setGrid] = useState([]);
  const [zones, setZones] = useState([]);
  const [lines, setLines] = useState([]);
  const [machinesByLine, setMachinesByLine] = useState({});
  const [loading, setLoading] = useState(true);
  const [pings, setPings] = useState({});
  const [lastSync, setLastSync] = useState(null);

  // `silent=true` skips the loading spinner — used for background polling
  // and focus-refetch so the table doesn't flicker every few seconds.
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      // Four sources stitched together:
      //   1. mes_zones                        — Zone roll-ups
      //   2. mes_lines                        — Line list per zone
      //   3. mes_plc_configs (per line)       — the ACTUAL PLC IPs / ports
      //                                          / camera bindings.  This is
      //                                          where the system config lives.
      //   4. CMS camera-grid (NF2)            — camera_id → camera_ip lookup
      // We query /api/lines/{id}/machines instead of /api/machines/by-line/{id}
      // because the latter is a name-only lookup table (zones.json import) —
      // it doesn't carry plc_ip / plc_port / nf2_camera_id.
      const [g, z, l] = await Promise.all([
        api.get("/api/cms/camera-grid", token).catch(()=>[]),
        api.get("/api/zones/",          token).catch(()=>[]),
        api.get("/api/lines/",          token).catch(()=>[]),
      ]);
      setGrid(Array.isArray(g) ? g : (Array.isArray(g?.data) ? g.data : []));
      setZones(Array.isArray(z) ? z : []);
      const linesArr = Array.isArray(l) ? l : [];
      setLines(linesArr);
      const map = {};
      await Promise.allSettled(linesArr.map(async ln => {
        try {
          const r = await api.get(`/api/lines/${ln.id}/machines`, token);
          // Endpoint returns a raw array of mes_plc_configs rows.  Each row:
          //   { id, line_id, parent_plc_id, machine_name, plc_ip, plc_port,
          //     protocol, ok_bit_address, ng_bit_address, status_address,
          //     nf2_camera_id, machine_seq, ... }
          map[ln.id] = Array.isArray(r) ? r : [];
        } catch { map[ln.id] = []; }
      }));
      setMachinesByLine(map);
      setLastSync(new Date());
    } catch(e) {
      if (!silent) toast(e.message || "Load failed", "err");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [token, toast]);

  // Initial load + auto-refresh wiring.  System Map needs to react to
  // edits made in the Production Panel (Plants / Zones / Lines /
  // Machines) without forcing the user to hit Refresh.  Three triggers:
  //   1. Mount                               — fetch on first render
  //   2. Window focus                        — admin tabbed away & back
  //   3. Polling every 6 s (silent)          — picks up CRUD made in
  //                                              another tab / by another
  //                                              admin within seconds
  //   4. 'ap-config-changed' DOM event       — fired by the api/client
  //                                              wrapper on any successful
  //                                              POST / PUT / PATCH /
  //                                              DELETE so same-tab edits
  //                                              show up instantly
  useEffect(() => {
    load();
    const onFocus    = () => load(true);
    const onChange   = () => load(true);
    const onVisible  = () => { if (document.visibilityState === "visible") load(true); };
    window.addEventListener("focus", onFocus);
    window.addEventListener("ap-config-changed", onChange);
    document.addEventListener("visibilitychange", onVisible);
    const tick = setInterval(() => load(true), 6000);
    return () => {
      clearInterval(tick);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("ap-config-changed", onChange);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  // Ping unique camera + PLC IPs in one go so the admin sees what's reachable.
  useEffect(() => {
    if (!grid.length && !lines.length) return;
    const ips = new Set();
    grid.forEach(m => m.camera_ip && ips.add(m.camera_ip + "|554"));
    Object.values(machinesByLine).flat().forEach(mc => {
      if (mc.plc_ip) ips.add(mc.plc_ip + "|" + (mc.plc_port || 5002));
    });
    if (!ips.size) return;
    let alive = true;
    (async () => {
      const out = {};
      await Promise.allSettled([...ips].map(async key => {
        const [ip, port] = key.split("|");
        try {
          const r = await api.get(`/api/ping?ip=${encodeURIComponent(ip)}&port=${port}`, token);
          out[key] = r;
        } catch { out[key] = { ok:false }; }
      }));
      if (alive) setPings(out);
    })();
    return () => { alive = false; };
  }, [grid, machinesByLine, lines]); // eslint-disable-line

  // Zones to surface in the System Map — explicit allow-list per the
  // user's spec (Toyota Boshoku Bawal plant has these six functional
  // zones).  Anything else returned by /api/cms/camera-grid is ignored
  // here so the page stays uncluttered.  Matching is substring-based
  // (case-insensitive) so minor naming variations between CMS zones.json
  // and the spec — e.g. "Seat Slider" vs "Seat Slide Zone", "Thin
  // Recliner" vs "Thin Reclinor" — all resolve correctly.
  const ZONE_ALLOWLIST = [
    "seat slid",   // covers "Seat Slider" / "Seat Slide Zone" / "SEAT SLIDER"
    "sub assem",   // "Sub Assembly" / "Sub-Assembly"
    "recliner",    // "Recliner"  (also matched by "thin recliner" — see below)
    "press shop",  // "Press Shop"
    "loop pipe",   // "Loop Pipe"
    "thin recli",  // "Thin Recliner"
  ];
  const isAllowedZone = (zoneName) => {
    const n = String(zoneName || "").trim().toLowerCase();
    if (!n) return false;
    return ZONE_ALLOWLIST.some(p => n.includes(p));
  };

  // Stitch: zone → line → machine entries, driven by the CMS camera-grid
  // (NF2 zones.json), then filtered to the six allowed zones above.  PLC
  // info is overlaid from mes_plc_configs by matching (zone_name,
  // line_name, machine_name).  Camera info comes straight from the grid
  // row (blank when no binding yet).
  const tree = useMemo(() => {
    const norm = (s) => String(s || "").trim().toLowerCase();

    // Build PLC lookup keyed by (zone_name|line_name|machine_name)
    // and also (line_id|machine_name) as a fallback.
    const plcByZLM = {};   // "zone|line|machine"  → mes_plc_configs row
    const plcByLM  = {};   // "line_id|machine"    → mes_plc_configs row (stricter)
    Object.entries(machinesByLine).forEach(([lineId, mlist]) => {
      const ln = lines.find(l => String(l.id) === String(lineId));
      const lineName = norm(ln?.line_name);
      const zoneName = norm(ln?.zone_name);
      mlist.forEach(mc => {
        const mName = norm(mc.machine_name);
        if (zoneName && lineName && mName) {
          plcByZLM[`${zoneName}|${lineName}|${mName}`] = mc;
        }
        if (lineName && mName) {
          plcByLM[`${lineName}|${mName}`] = mc;
        }
      });
    });

    // Zone → Line → [machines] dictionary, populated from camera-grid.
    // Skip any zone that isn't in the explicit allow-list above.
    const zMap = {};
    grid.forEach(m => {
      const zKey = m.zone_name || `Zone ${m.zone_id ?? "?"}`;
      if (!isAllowedZone(zKey)) return;       // ← drop unwanted zones
      const lKey = m.line_name || `Line ${m.line_id ?? "?"}`;
      if (!zMap[zKey]) {
        zMap[zKey] = {
          id:        m.zone_id,
          zone_name: zKey,
          lines:     {},
        };
      }
      const z = zMap[zKey];
      if (!z.lines[lKey]) {
        z.lines[lKey] = {
          id:             m.line_id,
          line_name:      lKey,
          db_table_name:  "",
          machines:       [],
        };
      }
      const ln = z.lines[lKey];

      // Find PLC info for this (zone, line, machine) tuple.
      const k1 = `${norm(zKey)}|${norm(lKey)}|${norm(m.machine_name)}`;
      const k2 = `${norm(lKey)}|${norm(m.machine_name)}`;
      const mc = plcByZLM[k1] || plcByLM[k2] || {};

      ln.machines.push({
        // PLC details (may all be empty if MES hasn't provisioned this machine)
        machine_name:  m.machine_name,
        plc_ip:        mc.plc_ip      || "",
        plc_port:      mc.plc_port    || "",
        machine_seq:   mc.machine_seq ?? null,
        parent_plc_id: mc.parent_plc_id ?? null,
        // Camera details from CMS grid (blank when no binding)
        camera: m.camera_id ? {
          camera_id:   m.camera_id,
          camera_ip:   m.camera_ip || "",
          camera_name: m.camera_name || "",
        } : null,
      });
    });

    // Also surface mes_plc_configs rows that the CMS grid DOESN'T know
    // about — e.g. a brand-new sub-PLC admin just added that hasn't
    // been registered in the NF2 zones.json yet.  These appear at the
    // bottom of their owning line (no camera, just PLC info).
    // Same allow-list filter applies.
    Object.entries(machinesByLine).forEach(([lineId, mlist]) => {
      const ln = lines.find(l => String(l.id) === String(lineId));
      if (!ln) return;
      const zKey = ln.zone_name || `Zone ${ln.zone_id ?? "?"}`;
      if (!isAllowedZone(zKey)) return;        // ← same filter
      const lKey = ln.line_name || `Line ${ln.id}`;
      if (!zMap[zKey]) zMap[zKey] = { id: ln.zone_id, zone_name: zKey, lines: {} };
      if (!zMap[zKey].lines[lKey]) {
        zMap[zKey].lines[lKey] = {
          id: ln.id, line_name: lKey, db_table_name: ln.db_table_name || "", machines: [],
        };
      }
      const lineNode = zMap[zKey].lines[lKey];
      lineNode.db_table_name = ln.db_table_name || lineNode.db_table_name;
      const have = new Set(lineNode.machines.map(x => norm(x.machine_name)));
      mlist.forEach(mc => {
        if (have.has(norm(mc.machine_name))) return;
        lineNode.machines.push({
          machine_name:  mc.machine_name,
          plc_ip:        mc.plc_ip || "",
          plc_port:      mc.plc_port || "",
          machine_seq:   mc.machine_seq ?? null,
          parent_plc_id: mc.parent_plc_id ?? null,
          camera:        null,
        });
      });
    });

    return Object.values(zMap)
      .sort((a,b) => String(a.zone_name||"").localeCompare(String(b.zone_name||"")))
      .map(z => ({
        ...z,
        lines: Object.values(z.lines)
          .sort((a,b) => String(a.line_name||"").localeCompare(String(b.line_name||"")))
          .map(l => ({
            ...l,
            machines: l.machines.sort((a,b) =>
              (a.machine_seq ?? 999) - (b.machine_seq ?? 999)
              || String(a.machine_name||"").localeCompare(String(b.machine_name||""))
            ),
          })),
      }));
  }, [zones, lines, grid, machinesByLine]);

  const pingStatus = (ip, port) => {
    if (!ip) return null;
    const p = pings[`${ip}|${port}`];
    if (!p) return <Pill label="…" color="gray" />;
    return p.ok
      ? <Pill label={`${p.ms ?? 0}ms`} color="green" />
      : <Pill label="down" color="red" />;
  };

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,flexWrap:"wrap",gap:10}}>
        <div>
          <div style={{fontWeight:700,fontSize:15,color:"#0f172a"}}>System Map</div>
          <div style={{fontSize:11,color:"#64748b",marginTop:2}}>
            Read-only consolidated view: every Zone → Line → Machine, its PLC IP and bound Camera IP.
            Edits happen in the dedicated Plants / Zones / Lines / Machines pages — they reflect here automatically.
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <span style={{display:"inline-flex",alignItems:"center",gap:6,fontSize:11,color:"#64748b"}}>
            {/* Pulse colour follows the role theme — admin sees blue,
                others see their accent so the indicator never clashes. */}
            <span style={{width:7,height:7,borderRadius:99,background:theme.accent,
                          animation:"sm-pulse 1.6s infinite"}}/>
            Live
            {lastSync && <span style={{color:"#94a3b8",fontFamily:"monospace"}}>
              · {lastSync.toLocaleTimeString()}
            </span>}
          </span>
          <Btn onClick={() => load(false)} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</Btn>
        </div>
      </div>
      <style>{`
        @keyframes sm-pulse {
          0%   { box-shadow:0 0 0 0   ${theme.soft}; }
          70%  { box-shadow:0 0 0 6px rgba(0,0,0,0); }
          100% { box-shadow:0 0 0 0   rgba(0,0,0,0); }
        }
      `}</style>
      {loading ? <Spinner/> : tree.length === 0 ? (
        <Card><EmptyState text="No zones/lines configured" sub="Configure Plants → Zones → Lines first."/></Card>
      ) : (
        tree.map(z => (
          <Card key={z.id} style={{marginBottom:14}}>
            <div style={{padding:"12px 18px",borderBottom:"1px solid #f1f5f9",display:"flex",alignItems:"center",gap:10}}>
              <span style={{fontSize:11,fontWeight:700,letterSpacing:".15em",textTransform:"uppercase",color:"#64748b"}}>Zone</span>
              <span style={{fontSize:15,fontWeight:700,color:"#0f172a"}}>{z.zone_name || "—"}</span>
              <span style={{fontSize:11,color:"#94a3b8"}}>· {z.lines.length} line{z.lines.length===1?"":"s"}</span>
            </div>
            {z.lines.length === 0 ? (
              <div style={{padding:"14px 18px",color:"#94a3b8",fontSize:12}}>No lines</div>
            ) : z.lines.map(ln => (
              <div key={ln.id} style={{borderBottom:"1px solid #f1f5f9",padding:"10px 18px"}}>
                <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
                  <span style={{fontSize:10,fontWeight:700,letterSpacing:".15em",textTransform:"uppercase",color:"#64748b"}}>Line</span>
                  <span style={{fontSize:13,fontWeight:700,color:"#0f172a"}}>{ln.line_name || "—"}</span>
                  <span style={{fontSize:10,color:"#94a3b8",fontFamily:"monospace"}}>{ln.db_table_name || ""}</span>
                </div>
                {ln.machines.length === 0 ? (
                  <div style={{paddingLeft:12,fontSize:11,color:"#94a3b8"}}>No machines</div>
                ) : (
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,marginTop:4}}>
                    <thead><tr>
                      {["#","Machine","PLC IP","PLC port","PLC ping","Camera ID","Camera IP","Cam ping"].map(h=>(
                        <th key={h} style={{padding:"6px 10px",textAlign:"left",fontSize:9,fontWeight:700,letterSpacing:".08em",textTransform:"uppercase",color:"#64748b",borderBottom:"1px solid #e2e8f0"}}>{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {ln.machines.map((mc, i) => (
                        <tr key={i} style={{borderBottom:"1px solid #f8fafc"}}>
                          <td style={{padding:"7px 10px",color:"#94a3b8"}}>{mc.machine_seq ?? i+1}</td>
                          <td style={{padding:"7px 10px",fontWeight:600,color:"#0f172a"}}>{mc.machine_name || "—"}</td>
                          <td style={{padding:"7px 10px",fontFamily:"monospace",color:"#1e40af"}}>{mc.plc_ip || "—"}</td>
                          <td style={{padding:"7px 10px",fontFamily:"monospace",color:"#475569"}}>{mc.plc_port || "—"}</td>
                          <td style={{padding:"7px 10px"}}>{pingStatus(mc.plc_ip, mc.plc_port || 5002)}</td>
                          <td style={{padding:"7px 10px",fontFamily:"monospace",color:"#475569"}}>{mc.camera?.camera_id || "—"}</td>
                          <td style={{padding:"7px 10px",fontFamily:"monospace",color:"#1e40af"}}>{mc.camera?.camera_ip || "—"}</td>
                          <td style={{padding:"7px 10px"}}>{mc.camera?.camera_ip ? pingStatus(mc.camera.camera_ip, 554) : <span style={{color:"#cbd5e1"}}>—</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ))}
          </Card>
        ))
      )}
    </div>
  );
}


// ─── ADMIN PANEL SHELL ────────────────────────────────────────
// Two-level navigation: a top-row of SECTIONS (Production / Maintenance /
// Quality / Admin) and a sub-tab strip per section. URL hash is
// "<section>/<tab>" so a refresh keeps you exactly where you were.
//
// Department users (role='department') see this same shell rendered
// inside DepartmentPanel.jsx, but with `readOnly` threaded down — they
// can READ everything but cannot Add / Edit / Delete.  Admin & plant_head
// get full write access here.
export const ADMIN_SECTIONS = [
  {
    key: "production", label: "Production", color: "#16a34a",
    tabs: [
      { key: "plants",    label: "Plants",            icon: "⬡" },
      { key: "zones",     label: "Zones",             icon: "◎" },
      { key: "lines",     label: "Production Lines",  icon: "⬡" },
      { key: "machines",  label: "Machines",          icon: "⚙" },
      { key: "processes", label: "Processes / Skill", icon: "🛠" },
      { key: "status",    label: "Status Colour",     icon: "◉" },
      { key: "hourlymail",label: "Hourly Report Mail",icon: "📧" },
      { key: "reports",   label: "Shift Reports",     icon: "📊" },
      { key: "oeealarm",  label: "OEE Drop Alarm",    icon: "⚠" },
      { key: "manpowercfg", label: "Manpower Settings", icon: "👥" },
    ],
  },
  {
    key: "maintenance", label: "Maintenance", color: "#dc2626",
    tabs: [
      // Sensor Health intentionally NOT a standalone tab here — it
      // already lives inside Poka Yoke as its 5th sub-tab, so a
      // duplicate top-level entry would double-render it.
      // Bypass Alerts also dropped — the bypass kind is already covered
      // by Mail Settings (its config) and the actual events stream is
      // visible inside Poka Yoke → Matrix; a separate empty-data tab
      // was just noise.
      { key: "pokayoke",   label: "Poka Yoke",        icon: "⚑" },
      { key: "pymanuals",  label: "PY Manuals",       icon: "📷" },
      { key: "newrequests",label: "New Requests",     icon: "📝" },
      { key: "pymail",     label: "Mail Settings",    icon: "📧" },
      { key: "bdmail",     label: "Breakdown Mails",  icon: "🚨" },
      { key: "kpitarget",  label: "KPI Targets",      icon: "🎯" },
      { key: "capacfg",    label: "CAPA Settings",    icon: "📊" },
      { key: "slipth",     label: "Slip Threshold",   icon: "⏱" },
      { key: "pmchecksheet", label: "PM Check Sheet", icon: "📋" },
      { key: "machinedmc",   label: "Machine DMC",    icon: "🏷" },
    ],
  },
  {
    key: "quality", label: "Quality", color: "#ca8a04",
    tabs: [
      // PY Failure escalation chain (level / delay / recipients / test
      // send) — same UI Maintenance admin uses; mirrored here so the
      // Quality Sec Head can audit / adjust the email tree without
      // hopping to the Maintenance Panel.
      { key: "pyescalation", label: "PY Escalation Mails", icon: "🚨" },
    ],
  },
  {
    key: "admin", label: "Admin", color: "#1e40af",
    tabs: [
      { key: "systemmap",   label: "System Map",   icon: "🗺" },
      { key: "departments", label: "Departments",  icon: "🏛" },
      { key: "users",       label: "Users",        icon: "👥" },
      { key: "operators",   label: "Operators",    icon: "🪪" },
    ],
  },
];

// ════════════════════════════════════════════════════════════════════
//  ReportsPage  —  per-shift Excel / PDF download + email-config
// ════════════════════════════════════════════════════════════════════
//
// Backend endpoints used:
//   GET  /api/reports/shift-excel?line_id=&date=&shift=    (streams xlsx)
//   GET  /api/reports/shift-pdf?line_id=&date=&shift=      (streams pdf)
//   GET  /api/reports/email-config                         (list)
//   PUT  /api/reports/email-config                         (admin upsert)
//   POST /api/reports/email-now                            (admin manual fire)
//
// The auto-mail scheduler runs in the backend (90 s after shift end_time).
// This page is the admin's window into who gets the auto-mail and a
// manual "fire now" button for testing.
export function ReportsPage({ toast, readOnly = false }) {
  const { token } = useAuth();
  const [lines,    setLines]    = useState([]);
  const [configs,  setConfigs]  = useState([]);
  const [lineId,   setLineId]   = useState("");
  const [date,     setDate]     = useState(() => new Date().toISOString().slice(0, 10));
  const [shift,    setShift]    = useState("A");
  const [saving,   setSaving]   = useState(false);
  const [form,     setForm]     = useState({ line_id: "", to_addresses: "", cc_addresses: "", is_active: true });

  const load = useCallback(async () => {
    try {
      const [ls, cfgs] = await Promise.all([
        api.get("/api/lines/", token),
        api.get("/api/reports/email-config", token),
      ]);
      setLines(ls || []);
      setConfigs(cfgs || []);
      if (!lineId && ls?.length) setLineId(ls[0].id);
    } catch (e) { toast("Failed to load reports config", "err"); }
  }, [token, lineId]);

  useEffect(() => { load(); }, [load]);

  const downloadFile = async (kind) => {
    if (!lineId || !date || !shift) { toast("Pick line / date / shift", "err"); return; }
    const url = `/api/reports/shift-${kind}?line_id=${lineId}&date=${date}&shift=${encodeURIComponent(shift)}`;
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        const txt = await res.text();
        toast(`Download failed: ${txt.slice(0, 100)}`, "err");
        return;
      }
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `shift_${date}_${shift}.${kind === "excel" ? "xlsx" : "pdf"}`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) { toast(`Download failed: ${e.message}`, "err"); }
  };

  const emailNow = async () => {
    if (!lineId) return;
    try {
      const r = await api.post("/api/reports/email-now",
        { line_id: lineId, date, shift, kinds: ["excel", "pdf"] }, token);
      toast(`Emailed to ${(r?.to || []).join(", ")} ✓`);
    } catch (e) { toast(e.message, "err"); }
  };

  const saveCfg = async () => {
    if (!form.line_id) { toast("Pick a line first", "err"); return; }
    setSaving(true);
    try {
      await api.put("/api/reports/email-config", {
        line_id:      Number(form.line_id),
        report_kind:  "shift_end",
        to_addresses: form.to_addresses,
        cc_addresses: form.cc_addresses,
        is_active:    form.is_active,
      }, token);
      toast("Email config saved ✓");
      setForm({ line_id: "", to_addresses: "", cc_addresses: "", is_active: true });
      load();
    } catch (e) { toast(e.message, "err"); }
    finally { setSaving(false); }
  };

  return (
    <div>
      {/* ── ONE-SHOT DOWNLOAD / MANUAL EMAIL ───────────────────── */}
      <Card style={{ marginBottom: 20 }}>
        <div style={{ padding: 18 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", marginBottom: 12 }}>
            Download or email a single shift's report
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
            <div>
              <label style={{ fontSize: 11, color: "#64748b" }}>Line</label>
              <select value={lineId} onChange={e => setLineId(Number(e.target.value))}
                      style={{ display: "block", padding: "6px 8px", fontSize: 13, border: "1px solid #cbd5e1", borderRadius: 6, minWidth: 180 }}>
                {lines.map(l => <option key={l.id} value={l.id}>{l.line_name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, color: "#64748b" }}>Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                     style={{ display: "block", padding: "6px 8px", fontSize: 13, border: "1px solid #cbd5e1", borderRadius: 6 }} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "#64748b" }}>Shift</label>
              <select value={shift} onChange={e => setShift(e.target.value)}
                      style={{ display: "block", padding: "6px 8px", fontSize: 13, border: "1px solid #cbd5e1", borderRadius: 6 }}>
                <option value="A">A</option><option value="B">B</option><option value="C">C</option>
              </select>
            </div>
            <Btn onClick={() => downloadFile("excel")} variant="primary">📥 Excel</Btn>
            <Btn onClick={() => downloadFile("pdf")}                 >📄 PDF</Btn>
            {!readOnly && <Btn onClick={emailNow} variant="primary">✉ Email Now</Btn>}
          </div>
        </div>
      </Card>

      {/* ── AUTO-MAIL RECIPIENTS PER LINE ──────────────────────── */}
      <Card>
        <div style={{ padding: 18 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", marginBottom: 4 }}>
            Auto end-of-shift email recipients
          </div>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 14 }}>
            Each shift's PDF + Excel auto-mails 90 s after the shift's <code>end_time</code>.
            Set per-line recipients below; leave blank to disable auto-mail for a line.
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#f1f5f9", textAlign: "left" }}>
                <th style={{ padding: 8 }}>Line</th>
                <th style={{ padding: 8 }}>To</th>
                <th style={{ padding: 8 }}>Cc</th>
                <th style={{ padding: 8 }}>Active</th>
                <th style={{ padding: 8 }}>Updated</th>
              </tr>
            </thead>
            <tbody>
              {configs.map(c => {
                const line = lines.find(l => l.id === c.line_id);
                return (
                  <tr key={c.id} style={{ borderTop: "1px solid #e2e8f0" }}>
                    <td style={{ padding: 8, fontWeight: 600 }}>{line?.line_name || `Line #${c.line_id}`}</td>
                    <td style={{ padding: 8 }}>{c.to_addresses || <em style={{ color: "#94a3b8" }}>—</em>}</td>
                    <td style={{ padding: 8 }}>{c.cc_addresses || <em style={{ color: "#94a3b8" }}>—</em>}</td>
                    <td style={{ padding: 8 }}>
                      <span style={{
                        display: "inline-block", padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 600,
                        background: c.is_active ? "#dcfce7" : "#fee2e2",
                        color:      c.is_active ? "#166534" : "#991b1b",
                      }}>{c.is_active ? "ON" : "OFF"}</span>
                    </td>
                    <td style={{ padding: 8, color: "#64748b" }}>{c.updated_at ? new Date(c.updated_at).toLocaleString() : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {!readOnly && (
            <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#475569", marginBottom: 8 }}>Add / update recipients</div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
                <div>
                  <label style={{ fontSize: 10, color: "#64748b" }}>Line</label>
                  <select value={form.line_id} onChange={e => setForm({ ...form, line_id: e.target.value })}
                          style={{ display: "block", padding: "6px 8px", fontSize: 13, border: "1px solid #cbd5e1", borderRadius: 6, minWidth: 160 }}>
                    <option value="">— select —</option>
                    {lines.map(l => <option key={l.id} value={l.id}>{l.line_name}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <label style={{ fontSize: 10, color: "#64748b" }}>To (comma-separated)</label>
                  <input value={form.to_addresses} onChange={e => setForm({ ...form, to_addresses: e.target.value })}
                         placeholder="plant.head@tbdi.com, supervisor@tbdi.com"
                         style={{ width: "100%", padding: "6px 8px", fontSize: 13, border: "1px solid #cbd5e1", borderRadius: 6 }} />
                </div>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <label style={{ fontSize: 10, color: "#64748b" }}>Cc</label>
                  <input value={form.cc_addresses} onChange={e => setForm({ ...form, cc_addresses: e.target.value })}
                         placeholder="(optional)"
                         style={{ width: "100%", padding: "6px 8px", fontSize: 13, border: "1px solid #cbd5e1", borderRadius: 6 }} />
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#475569" }}>
                  <input type="checkbox" checked={form.is_active} onChange={e => setForm({ ...form, is_active: e.target.checked })} />
                  Active
                </label>
                <Btn variant="primary" onClick={saveCfg} disabled={saving}>{saving ? "…" : "Save"}</Btn>
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}


// ════════════════════════════════════════════════════════════════════
//  OEEAlarmPage  —  configure sustained-drop email alerts
// ════════════════════════════════════════════════════════════════════
export function OEEAlarmPage({ toast, readOnly = false }) {
  const { token } = useAuth();
  const [lines,   setLines]   = useState([]);
  const [configs, setConfigs] = useState([]);
  const [form,    setForm]    = useState({
    line_id: "", threshold_pct: 60, sustain_minutes: 10, cooldown_minutes: 60,
    to_addresses: "", cc_addresses: "", is_active: true,
  });
  const [saving, setSaving]   = useState(false);

  const load = useCallback(async () => {
    try {
      const [ls, cfgs] = await Promise.all([
        api.get("/api/lines/", token),
        api.get("/api/oee-alarm", token),
      ]);
      setLines(ls || []);
      setConfigs(cfgs || []);
    } catch (e) { toast("Failed to load OEE alarms", "err"); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!form.line_id) { toast("Pick a line", "err"); return; }
    if (!form.to_addresses) { toast("Add at least one recipient", "err"); return; }
    setSaving(true);
    try {
      await api.put("/api/oee-alarm", {
        line_id:          Number(form.line_id),
        threshold_pct:    Number(form.threshold_pct),
        sustain_minutes:  Number(form.sustain_minutes),
        cooldown_minutes: Number(form.cooldown_minutes),
        to_addresses:     form.to_addresses,
        cc_addresses:     form.cc_addresses,
        is_active:        form.is_active,
      }, token);
      toast("OEE alarm saved ✓");
      setForm({ line_id: "", threshold_pct: 60, sustain_minutes: 10, cooldown_minutes: 60,
                to_addresses: "", cc_addresses: "", is_active: true });
      load();
    } catch (e) { toast(e.message, "err"); }
    finally { setSaving(false); }
  };

  const loadIntoForm = (c) => setForm({
    line_id:          String(c.line_id),
    threshold_pct:    c.threshold_pct,
    sustain_minutes:  c.sustain_minutes,
    cooldown_minutes: c.cooldown_minutes,
    to_addresses:     c.to_addresses || "",
    cc_addresses:     c.cc_addresses || "",
    is_active:        !!c.is_active,
  });

  return (
    <div>
      <Card style={{ marginBottom: 20 }}>
        <div style={{ padding: 18 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", marginBottom: 4 }}>
            How it works
          </div>
          <div style={{ fontSize: 11.5, color: "#475569", lineHeight: 1.7 }}>
            Background watcher samples the dashboard table every 30 s.  When a line's <code>overall_oee</code> stays
            below <b>Threshold %</b> for <b>Sustain minutes</b> continuously, one email goes out to the recipients
            below.  Within <b>Cooldown minutes</b> of a fire, no new alert is sent for that line — prevents flooding
            during a really bad shift.  The streak resets to zero as soon as OEE recovers above threshold, so the next
            dip fires fresh.
          </div>
        </div>
      </Card>

      <Card style={{ marginBottom: 20 }}>
        <div style={{ padding: 18 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", marginBottom: 12 }}>Active alarms</div>
          {configs.length === 0 ? <EmptyState text="No alarms configured" sub="Add one below to start watching a line" /> : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#f1f5f9", textAlign: "left" }}>
                  <th style={{ padding: 8 }}>Line</th>
                  <th style={{ padding: 8 }}>Threshold</th>
                  <th style={{ padding: 8 }}>Sustain</th>
                  <th style={{ padding: 8 }}>Cooldown</th>
                  <th style={{ padding: 8 }}>To</th>
                  <th style={{ padding: 8 }}>Status</th>
                  <th style={{ padding: 8 }}>Last fired</th>
                  {!readOnly && <th style={{ padding: 8 }}></th>}
                </tr>
              </thead>
              <tbody>
                {configs.map(c => {
                  const line = lines.find(l => l.id === c.line_id);
                  return (
                    <tr key={c.line_id} style={{ borderTop: "1px solid #e2e8f0" }}>
                      <td style={{ padding: 8, fontWeight: 600 }}>{line?.line_name || `Line #${c.line_id}`}</td>
                      <td style={{ padding: 8 }}>{Number(c.threshold_pct).toFixed(0)}%</td>
                      <td style={{ padding: 8 }}>{c.sustain_minutes} min</td>
                      <td style={{ padding: 8 }}>{c.cooldown_minutes} min</td>
                      <td style={{ padding: 8, color: "#475569", fontSize: 11 }}>{c.to_addresses || "—"}</td>
                      <td style={{ padding: 8 }}>
                        <span style={{
                          display: "inline-block", padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 600,
                          background: c.is_active ? "#dcfce7" : "#fee2e2",
                          color:      c.is_active ? "#166534" : "#991b1b",
                        }}>{c.is_active ? "ON" : "OFF"}</span>
                      </td>
                      <td style={{ padding: 8, color: "#64748b", fontSize: 11 }}>
                        {c.last_fired_at ? new Date(c.last_fired_at).toLocaleString() : <em>never</em>}
                      </td>
                      {!readOnly && (
                        <td style={{ padding: 8 }}>
                          <Btn size="sm" onClick={() => loadIntoForm(c)}>Edit</Btn>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      {!readOnly && (
        <Card>
          <div style={{ padding: 18 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", marginBottom: 12 }}>
              Add / update alarm
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
              <div>
                <label style={{ fontSize: 10, color: "#64748b" }}>Line</label>
                <select value={form.line_id} onChange={e => setForm({ ...form, line_id: e.target.value })}
                        style={{ width: "100%", padding: "6px 8px", fontSize: 13, border: "1px solid #cbd5e1", borderRadius: 6 }}>
                  <option value="">— select —</option>
                  {lines.map(l => <option key={l.id} value={l.id}>{l.line_name}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 10, color: "#64748b" }}>Threshold %</label>
                <input type="number" min={0} max={100} value={form.threshold_pct}
                       onChange={e => setForm({ ...form, threshold_pct: e.target.value })}
                       style={{ width: "100%", padding: "6px 8px", fontSize: 13, border: "1px solid #cbd5e1", borderRadius: 6 }} />
              </div>
              <div>
                <label style={{ fontSize: 10, color: "#64748b" }}>Sustain (min)</label>
                <input type="number" min={1} value={form.sustain_minutes}
                       onChange={e => setForm({ ...form, sustain_minutes: e.target.value })}
                       style={{ width: "100%", padding: "6px 8px", fontSize: 13, border: "1px solid #cbd5e1", borderRadius: 6 }} />
              </div>
              <div>
                <label style={{ fontSize: 10, color: "#64748b" }}>Cooldown (min)</label>
                <input type="number" min={1} value={form.cooldown_minutes}
                       onChange={e => setForm({ ...form, cooldown_minutes: e.target.value })}
                       style={{ width: "100%", padding: "6px 8px", fontSize: 13, border: "1px solid #cbd5e1", borderRadius: 6 }} />
              </div>
            </div>
            <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={{ fontSize: 10, color: "#64748b" }}>To (comma-separated)</label>
                <input value={form.to_addresses} onChange={e => setForm({ ...form, to_addresses: e.target.value })}
                       placeholder="plant.head@tbdi.com"
                       style={{ width: "100%", padding: "6px 8px", fontSize: 13, border: "1px solid #cbd5e1", borderRadius: 6 }} />
              </div>
              <div>
                <label style={{ fontSize: 10, color: "#64748b" }}>Cc</label>
                <input value={form.cc_addresses} onChange={e => setForm({ ...form, cc_addresses: e.target.value })}
                       style={{ width: "100%", padding: "6px 8px", fontSize: 13, border: "1px solid #cbd5e1", borderRadius: 6 }} />
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#475569" }}>
                <input type="checkbox" checked={form.is_active} onChange={e => setForm({ ...form, is_active: e.target.checked })} />
                Active
              </label>
              <Btn variant="primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save Alarm"}</Btn>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}


// ════════════════════════════════════════════════════════════════════
//  OperatorsPage  —  badge master + per-shift productivity
// ════════════════════════════════════════════════════════════════════
export function OperatorsPage({ toast, readOnly = false }) {
  const { token } = useAuth();
  const [operators, setOperators] = useState([]);
  const [lines,     setLines]     = useState([]);
  const [modal,     setModal]     = useState(false);
  const [form,      setForm]      = useState({ badge_code: "", full_name: "", employee_id: "", department: "", skill_level: 1, is_active: true });

  // Per-shift summary state
  const [sumLine,  setSumLine]  = useState("");
  const [sumDate,  setSumDate]  = useState(() => new Date().toISOString().slice(0, 10));
  const [sumShift, setSumShift] = useState("A");
  const [summary,  setSummary]  = useState([]);
  const [loadingSum, setLoadingSum] = useState(false);

  const load = useCallback(async () => {
    try {
      const [ops, ls] = await Promise.all([
        api.get("/api/operators", token),
        api.get("/api/lines/", token),
      ]);
      setOperators(ops || []);
      setLines(ls || []);
      if (!sumLine && ls?.length) setSumLine(ls[0].id);
    } catch (e) { toast("Failed to load operators", "err"); }
  }, [token, sumLine]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!form.badge_code || !form.full_name) { toast("Badge code and name required", "err"); return; }
    try {
      await api.post("/api/operators", form, token);
      toast("Operator saved ✓");
      setModal(false);
      setForm({ badge_code: "", full_name: "", employee_id: "", department: "", skill_level: 1, is_active: true });
      load();
    } catch (e) { toast(e.message, "err"); }
  };

  const remove = async (op) => {
    if (!confirm(`Delete operator "${op.full_name}"?`)) return;
    try { await api.delete(`/api/operators/${op.id}`, token); toast("Deleted"); load(); }
    catch (e) { toast(e.message, "err"); }
  };

  const loadSummary = async () => {
    if (!sumLine || !sumDate || !sumShift) return;
    setLoadingSum(true);
    try {
      const r = await api.get(`/api/operators/shift-summary?line_id=${sumLine}&date=${sumDate}&shift=${encodeURIComponent(sumShift)}`, token);
      setSummary(r || []);
    } catch (e) { toast(e.message, "err"); setSummary([]); }
    finally { setLoadingSum(false); }
  };

  return (
    <div>
      {/* ── Master CRUD ─────────────────────────────────────────── */}
      <Card style={{ marginBottom: 20 }}>
        <div style={{ padding: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>Operator Master</div>
              <div style={{ fontSize: 11, color: "#64748b" }}>
                Badge → name mapping.  Floor PC scans the badge → frontend POSTs <code>/api/operators/login</code>.
              </div>
            </div>
            {!readOnly && <Btn variant="primary" onClick={() => setModal(true)}>+ Add Operator</Btn>}
          </div>

          {operators.length === 0 ? <EmptyState text="No operators yet" sub="Add badges before scanning on the floor" /> : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#f1f5f9", textAlign: "left" }}>
                  <th style={{ padding: 8 }}>Badge</th>
                  <th style={{ padding: 8 }}>Name</th>
                  <th style={{ padding: 8 }}>Employee ID</th>
                  <th style={{ padding: 8 }}>Department</th>
                  <th style={{ padding: 8 }}>Skill</th>
                  <th style={{ padding: 8 }}>Active</th>
                  {!readOnly && <th style={{ padding: 8 }}></th>}
                </tr>
              </thead>
              <tbody>
                {operators.map(op => {
                  const skillColor = op.skill_level >= 4 ? "#16a34a" : op.skill_level >= 3 ? "#3b82f6" : op.skill_level >= 2 ? "#d97706" : "#94a3b8";
                  return (
                  <tr key={op.id} style={{ borderTop: "1px solid #e2e8f0" }}>
                    <td style={{ padding: 8, fontFamily: "monospace" }}>{op.badge_code}</td>
                    <td style={{ padding: 8, fontWeight: 600 }}>{op.full_name}</td>
                    <td style={{ padding: 8 }}>{op.employee_id || "—"}</td>
                    <td style={{ padding: 8 }}>{op.department || "—"}</td>
                    <td style={{ padding: 8 }}>
                      <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 700,
                                     background: `${skillColor}22`, color: skillColor }}>
                        L{op.skill_level || 1}
                      </span>
                    </td>
                    <td style={{ padding: 8 }}>
                      <span style={{
                        display: "inline-block", padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 600,
                        background: op.is_active ? "#dcfce7" : "#fee2e2",
                        color:      op.is_active ? "#166534" : "#991b1b",
                      }}>{op.is_active ? "ON" : "OFF"}</span>
                    </td>
                    {!readOnly && (
                      <td style={{ padding: 8 }}>
                        <Btn size="sm" variant="danger" onClick={() => remove(op)}>Delete</Btn>
                      </td>
                    )}
                  </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      {/* ── Per-shift productivity summary ──────────────────────── */}
      <Card>
        <div style={{ padding: 18 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", marginBottom: 4 }}>
            Per-operator shift summary
          </div>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 12 }}>
            OK / NG cycles in each operator's session window, joined to the line's ct_log on timestamp.
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end", marginBottom: 14 }}>
            <div>
              <label style={{ fontSize: 10, color: "#64748b" }}>Line</label>
              <select value={sumLine} onChange={e => setSumLine(Number(e.target.value))}
                      style={{ display: "block", padding: "6px 8px", fontSize: 13, border: "1px solid #cbd5e1", borderRadius: 6, minWidth: 160 }}>
                {lines.map(l => <option key={l.id} value={l.id}>{l.line_name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 10, color: "#64748b" }}>Date</label>
              <input type="date" value={sumDate} onChange={e => setSumDate(e.target.value)}
                     style={{ display: "block", padding: "6px 8px", fontSize: 13, border: "1px solid #cbd5e1", borderRadius: 6 }} />
            </div>
            <div>
              <label style={{ fontSize: 10, color: "#64748b" }}>Shift</label>
              <select value={sumShift} onChange={e => setSumShift(e.target.value)}
                      style={{ display: "block", padding: "6px 8px", fontSize: 13, border: "1px solid #cbd5e1", borderRadius: 6 }}>
                <option value="A">A</option><option value="B">B</option><option value="C">C</option>
              </select>
            </div>
            <Btn variant="primary" onClick={loadSummary}>{loadingSum ? "…" : "Load"}</Btn>
          </div>

          {summary.length === 0 ? <EmptyState text="No data" sub="Load a shift after operators have logged in" /> : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#f1f5f9", textAlign: "left" }}>
                  <th style={{ padding: 8 }}>Operator</th>
                  <th style={{ padding: 8 }}>Started</th>
                  <th style={{ padding: 8 }}>Ended</th>
                  <th style={{ padding: 8 }}>Cycles</th>
                  <th style={{ padding: 8, color: "#166534" }}>OK</th>
                  <th style={{ padding: 8, color: "#991b1b" }}>NG</th>
                  <th style={{ padding: 8 }}>Avg CT (s)</th>
                </tr>
              </thead>
              <tbody>
                {summary.map(s => (
                  <tr key={s.session_id} style={{ borderTop: "1px solid #e2e8f0" }}>
                    <td style={{ padding: 8, fontWeight: 600 }}>
                      {s.full_name}
                      {s.employee_id && <span style={{ color: "#64748b", marginLeft: 6 }}>· {s.employee_id}</span>}
                    </td>
                    <td style={{ padding: 8 }}>{s.started_at ? new Date(s.started_at).toLocaleTimeString() : "—"}</td>
                    <td style={{ padding: 8 }}>{s.ended_at ? new Date(s.ended_at).toLocaleTimeString() : <em style={{color:"#06A77D"}}>active</em>}</td>
                    <td style={{ padding: 8 }}>{s.cycles}</td>
                    <td style={{ padding: 8, color: "#166534", fontWeight: 600 }}>{s.oks}</td>
                    <td style={{ padding: 8, color: "#991b1b", fontWeight: 600 }}>{s.ngs}</td>
                    <td style={{ padding: 8 }}>{Number(s.avg_ct || 0).toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      <Modal open={modal} onClose={() => setModal(false)} title="Add Operator">
        <div style={{ display: "grid", gap: 12 }}>
          <div>
            <label style={{ fontSize: 11, color: "#64748b" }}>Badge code (scan once here)</label>
            <input autoFocus value={form.badge_code} onChange={e => setForm({ ...form, badge_code: e.target.value })}
                   placeholder="0012345 or RFID UID"
                   style={{ width: "100%", padding: "8px 10px", fontSize: 13, border: "1px solid #cbd5e1", borderRadius: 6, fontFamily: "monospace" }} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: "#64748b" }}>Full name</label>
            <input value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })}
                   placeholder="Ramesh Kumar"
                   style={{ width: "100%", padding: "8px 10px", fontSize: 13, border: "1px solid #cbd5e1", borderRadius: 6 }} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={{ fontSize: 11, color: "#64748b" }}>Employee ID</label>
              <input value={form.employee_id} onChange={e => setForm({ ...form, employee_id: e.target.value })}
                     style={{ width: "100%", padding: "8px 10px", fontSize: 13, border: "1px solid #cbd5e1", borderRadius: 6 }} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "#64748b" }}>Department</label>
              <input value={form.department} onChange={e => setForm({ ...form, department: e.target.value })}
                     placeholder="Production / Quality"
                     style={{ width: "100%", padding: "8px 10px", fontSize: 13, border: "1px solid #cbd5e1", borderRadius: 6 }} />
            </div>
          </div>
          <div>
            <label style={{ fontSize: 11, color: "#64748b" }}>Skill Level (1=Trainee … 5=Expert)</label>
            <select value={form.skill_level}
                    onChange={e => setForm({ ...form, skill_level: Number(e.target.value) })}
                    style={{ width: "100%", padding: "8px 10px", fontSize: 13, border: "1px solid #cbd5e1", borderRadius: 6 }}>
              <option value={1}>L1 — Trainee</option>
              <option value={2}>L2 — Basic</option>
              <option value={3}>L3 — Skilled</option>
              <option value={4}>L4 — Multi-skilled</option>
              <option value={5}>L5 — Expert / Trainer</option>
            </select>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#475569" }}>
            <input type="checkbox" checked={form.is_active} onChange={e => setForm({ ...form, is_active: e.target.checked })} />
            Active
          </label>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
            <Btn onClick={() => setModal(false)}>Cancel</Btn>
            <Btn variant="primary" onClick={save}>Save</Btn>
          </div>
        </div>
      </Modal>
    </div>
  );
}


// ════════════════════════════════════════════════════════════════════
//  ProcessesPage  —  derived from Machine Master
// ════════════════════════════════════════════════════════════════════
//
// Each row is automatically created from mes_machines for the line.
// The backend GET /api/manpower/processes?line_id= seeds the table on
// every call, so renaming a machine in the Machine Master propagates
// here on the next refresh; adding a new machine inserts a fresh row
// with default L3 / 1 slot / 1 machine-per-op.
//
// Section Incharge only edits, per machine:
//   • Required skill level (L1-L5)
//   • Manpower count (slots)
//   • Machines per operator
//   • Display order
//   • Active flag
//
// process_name is owned by the Machine Master — NOT editable here.
export function ProcessesPage({ toast, readOnly = false }) {
  const { token } = useAuth();
  const [lines,   setLines]   = useState([]);
  const [lineId,  setLineId]  = useState("");
  const [rows,    setRows]    = useState([]);
  const [loading, setLoading] = useState(false);
  // Per-row local edits before "Save" is hit
  const [edits, setEdits] = useState({});   // {process_id: {field: value}}

  const loadLines = useCallback(async () => {
    try {
      const ls = await api.get("/api/lines/", token);
      setLines(ls || []);
      if (!lineId && ls?.length) setLineId(ls[0].id);
    } catch (e) { toast("Failed to load lines", "err"); }
  }, [token, lineId]);

  const loadRows = useCallback(async () => {
    if (!lineId) return;
    setLoading(true);
    try {
      const r = await api.get(`/api/manpower/processes?line_id=${lineId}`, token);
      setRows(r || []);
      setEdits({});
    } catch (e) { toast(`Failed to load processes: ${e.message}`, "err"); }
    finally { setLoading(false); }
  }, [token, lineId]);

  useEffect(() => { loadLines(); }, [loadLines]);
  useEffect(() => { loadRows();  }, [loadRows]);

  const setField = (id, field, value) => {
    setEdits(prev => ({ ...prev, [id]: { ...(prev[id] || {}), [field]: value } }));
  };

  const effective = (r, field) => {
    const e = edits[r.id];
    return e && field in e ? e[field] : r[field];
  };

  const isDirty = (r) => !!edits[r.id] && Object.keys(edits[r.id]).length > 0;
  const dirtyCount = Object.keys(edits).length;

  const saveRow = async (r) => {
    try {
      await api.put(`/api/manpower/processes/${r.id}`, {
        required_skill_level:    Number(effective(r, "required_skill_level")),
        required_manpower_count: Number(effective(r, "required_manpower_count")),
        machines_covered:        Number(effective(r, "machines_covered")),
        display_order:           Number(effective(r, "display_order")),
        is_active:               !!effective(r, "is_active"),
      }, token);
      toast(`Saved · ${r.process_name}`);
      setEdits(prev => { const { [r.id]: _, ...rest } = prev; return rest; });
      loadRows();
    } catch (e) { toast(e.message, "err"); }
  };

  const saveAll = async () => {
    const dirtyIds = Object.keys(edits);
    if (dirtyIds.length === 0) return;
    let ok = 0, fail = 0;
    for (const idStr of dirtyIds) {
      const r = rows.find(x => x.id === Number(idStr));
      if (!r) continue;
      try {
        await api.put(`/api/manpower/processes/${r.id}`, {
          required_skill_level:    Number(effective(r, "required_skill_level")),
          required_manpower_count: Number(effective(r, "required_manpower_count")),
          machines_covered:        Number(effective(r, "machines_covered")),
          display_order:           Number(effective(r, "display_order")),
          is_active:               !!effective(r, "is_active"),
        }, token);
        ok += 1;
      } catch { fail += 1; }
    }
    toast(`Saved ${ok}${fail ? ` · ${fail} failed` : ""} ✓`, fail ? "err" : "ok");
    loadRows();
  };

  const skillColor = (l) => l >= 4 ? "#16a34a" : l >= 3 ? "#3b82f6" : l >= 2 ? "#d97706" : "#94a3b8";

  return (
    <div>
      <Card>
        <div style={{ padding: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>Process / Skill — Machine Master Linked</div>
              <div style={{ fontSize: 11, color: "#64748b" }}>
                Rows are auto-derived from the Machine Master.  Set required skill, manpower count, and machines/operator per machine.
                Renaming a machine in the Machine Master will reflect here on next refresh.
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "end" }}>
              <div>
                <label style={{ fontSize: 10, color: "#64748b" }}>Line</label>
                <select value={lineId} onChange={e => setLineId(Number(e.target.value))}
                        style={{ display: "block", padding: "6px 8px", fontSize: 13, border: "1px solid #cbd5e1", borderRadius: 6, minWidth: 180 }}>
                  {lines.map(l => <option key={l.id} value={l.id}>{l.line_name}</option>)}
                </select>
              </div>
              <Btn onClick={loadRows}>↻ {loading ? "…" : "Reload from Master"}</Btn>
              {!readOnly && dirtyCount > 0 && (
                <Btn variant="primary" onClick={saveAll}>💾 Save All ({dirtyCount})</Btn>
              )}
            </div>
          </div>

          {rows.length === 0 ? (
            <EmptyState
              text={loading ? "Loading…" : "No machines on this line"}
              sub="Add machines via Admin → Production → Machines.  They will appear here automatically." />
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#f1f5f9", textAlign: "left" }}>
                  <th style={{ padding: 8, width: 60 }}>M#</th>
                  <th style={{ padding: 8 }}>Machine</th>
                  <th style={{ padding: 8, width: 180 }}>Req. Skill</th>
                  <th style={{ padding: 8, width: 110 }}>Slots</th>
                  <th style={{ padding: 8, width: 130 }}>Machines / Op</th>
                  <th style={{ padding: 8, width: 100 }}>Order</th>
                  <th style={{ padding: 8, width: 80 }}>Active</th>
                  {!readOnly && <th style={{ padding: 8, width: 90 }}></th>}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const skill = Number(effective(r, "required_skill_level"));
                  const c = skillColor(skill);
                  const dirty = isDirty(r);
                  return (
                    <tr key={r.id} style={{
                      borderTop: "1px solid #e2e8f0",
                      background: dirty ? "#fef9c3" : (effective(r, "is_active") ? "transparent" : "#fafafa"),
                    }}>
                      <td style={{ padding: 8, fontFamily: "monospace", color: "#475569" }}>
                        {r.machine_no != null ? `M-${r.machine_no}` : "—"}
                      </td>
                      <td style={{ padding: 8, fontWeight: 600 }}>
                        {r.process_name}
                        {r.machine_id && (
                          <span style={{ display: "block", fontSize: 10, color: "#64748b", fontWeight: 400 }}>
                            from machine master · id #{r.machine_id}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: 6 }}>
                        <select value={skill} disabled={readOnly}
                                onChange={e => setField(r.id, "required_skill_level", Number(e.target.value))}
                                style={{
                                  width: "100%", padding: "5px 6px", fontSize: 12,
                                  border: `1.5px solid ${c}55`, borderRadius: 6,
                                  background: `${c}11`, color: c, fontWeight: 700,
                                }}>
                          <option value={1}>L1 — Trainee</option>
                          <option value={2}>L2 — Basic</option>
                          <option value={3}>L3 — Skilled</option>
                          <option value={4}>L4 — Multi-skilled</option>
                          <option value={5}>L5 — Expert</option>
                        </select>
                      </td>
                      <td style={{ padding: 6 }}>
                        <input type="number" min={1} disabled={readOnly}
                               value={effective(r, "required_manpower_count")}
                               onChange={e => setField(r.id, "required_manpower_count", Math.max(1, Number(e.target.value)))}
                               style={cellInputStyle} />
                      </td>
                      <td style={{ padding: 6 }}>
                        <input type="number" min={1} disabled={readOnly}
                               value={effective(r, "machines_covered")}
                               onChange={e => setField(r.id, "machines_covered", Math.max(1, Number(e.target.value)))}
                               style={cellInputStyle} />
                      </td>
                      <td style={{ padding: 6 }}>
                        <input type="number" disabled={readOnly}
                               value={effective(r, "display_order")}
                               onChange={e => setField(r.id, "display_order", Number(e.target.value))}
                               style={cellInputStyle} />
                      </td>
                      <td style={{ padding: 8, textAlign: "center" }}>
                        <input type="checkbox" disabled={readOnly}
                               checked={!!effective(r, "is_active")}
                               onChange={e => setField(r.id, "is_active", e.target.checked)} />
                      </td>
                      {!readOnly && (
                        <td style={{ padding: 6 }}>
                          {dirty && <Btn size="sm" variant="primary" onClick={() => saveRow(r)}>Save</Btn>}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </Card>
    </div>
  );
}

const cellInputStyle = {
  width: "100%", padding: "5px 6px", fontSize: 12,
  border: "1px solid #cbd5e1", borderRadius: 6, background: "#fff",
};


// ════════════════════════════════════════════════════════════════════
//  ManpowerConfigPage  —  per-line timings + recipient lists
// ════════════════════════════════════════════════════════════════════
//
// Backend endpoints used:
//   GET /api/manpower/config           (list all)
//   PUT /api/manpower/config           (upsert by line_id)
//
// Configures the per-line "deadline to allocate" minute window after
// shift start, the acknowledgement timeout that triggers escalation,
// and the recipient lists for Quality, Section Incharge, and the
// escalation tier.
export function ManpowerConfigPage({ toast, readOnly = false }) {
  const { token } = useAuth();
  const [lines,   setLines]   = useState([]);
  const [configs, setConfigs] = useState([]);
  const [lineId,  setLineId]  = useState("");
  const [form,    setForm]    = useState({
    line_id: "",
    allocation_deadline_minutes: 60,
    ack_timeout_minutes: 30,
    quality_to_addresses: "",
    section_incharge_to_addresses: "",
    escalation_to_addresses: "",
    is_active: true,
  });

  const load = useCallback(async () => {
    try {
      const [ls, cfgs] = await Promise.all([
        api.get("/api/lines/", token),
        api.get("/api/manpower/config", token),
      ]);
      setLines(ls || []);
      setConfigs(cfgs || []);
      if (!lineId && ls?.length) setLineId(ls[0].id);
    } catch (e) { toast("Failed to load manpower config", "err"); }
  }, [token, lineId]);

  useEffect(() => { load(); }, [load]);

  // Hydrate form when the active line changes
  useEffect(() => {
    if (!lineId) return;
    const c = configs.find(c => c.line_id === Number(lineId));
    setForm({
      line_id: Number(lineId),
      allocation_deadline_minutes: c?.allocation_deadline_minutes ?? 60,
      ack_timeout_minutes:         c?.ack_timeout_minutes ?? 30,
      quality_to_addresses:        c?.quality_to_addresses ?? "",
      section_incharge_to_addresses: c?.section_incharge_to_addresses ?? "",
      escalation_to_addresses:     c?.escalation_to_addresses ?? "",
      is_active:                   c?.is_active ?? true,
    });
  }, [lineId, configs]);

  const save = async () => {
    if (!form.line_id) { toast("Pick a line", "err"); return; }
    try {
      await api.put("/api/manpower/config", form, token);
      toast("Config saved ✓");
      load();
    } catch (e) { toast(e.message, "err"); }
  };

  return (
    <div>
      <Card>
        <div style={{ padding: 18 }}>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>Manpower Allocation · Settings</div>
            <div style={{ fontSize: 11, color: "#64748b" }}>
              Per-line: how long the supervisor has to allocate after shift start, how long Quality + Section Incharge
              have to acknowledge before escalation, and the email recipients for each tier.
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "end", marginBottom: 16, flexWrap: "wrap" }}>
            <div>
              <label style={{ fontSize: 10, color: "#64748b" }}>Line</label>
              <select value={lineId} onChange={e => setLineId(Number(e.target.value))}
                      style={{ display: "block", padding: "6px 8px", fontSize: 13, border: "1px solid #cbd5e1", borderRadius: 6, minWidth: 200 }}>
                {lines.map(l => <option key={l.id} value={l.id}>{l.line_name}</option>)}
              </select>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <FF label="Allocation Deadline (minutes from shift start)" hint="After this many minutes, unfilled process slots fire UNALLOCATED alerts.">
              <Input type="number" min={1} max={480} value={form.allocation_deadline_minutes}
                     onChange={e => setForm({ ...form, allocation_deadline_minutes: Math.max(1, Number(e.target.value)) })}
                     disabled={readOnly} />
            </FF>
            <FF label="Ack Timeout (minutes)" hint="If neither Quality nor Section Incharge acks within this window, escalation email fires.">
              <Input type="number" min={1} max={240} value={form.ack_timeout_minutes}
                     onChange={e => setForm({ ...form, ack_timeout_minutes: Math.max(1, Number(e.target.value)) })}
                     disabled={readOnly} />
            </FF>
          </div>

          <div style={{ display: "grid", gap: 14, marginTop: 14 }}>
            <FF label="Quality — TO addresses" hint="Comma-separated. Receives popup on dashboard + email.">
              <Input value={form.quality_to_addresses}
                     onChange={e => setForm({ ...form, quality_to_addresses: e.target.value })}
                     placeholder="qa1@plant.com, qa2@plant.com" disabled={readOnly} />
            </FF>
            <FF label="Section Incharge — TO addresses" hint="Comma-separated. Receives popup + email.">
              <Input value={form.section_incharge_to_addresses}
                     onChange={e => setForm({ ...form, section_incharge_to_addresses: e.target.value })}
                     placeholder="incharge@plant.com" disabled={readOnly} />
            </FF>
            <FF label="Escalation — TO addresses" hint="Comma-separated. Fired if no acknowledgement within ack-timeout.">
              <Input value={form.escalation_to_addresses}
                     onChange={e => setForm({ ...form, escalation_to_addresses: e.target.value })}
                     placeholder="plant.head@plant.com, hr@plant.com" disabled={readOnly} />
            </FF>
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#475569", marginTop: 14 }}>
            <input type="checkbox" checked={form.is_active}
                   onChange={e => setForm({ ...form, is_active: e.target.checked })} disabled={readOnly} />
            Active (watcher will run for this line)
          </label>

          {!readOnly && (
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
              <Btn variant="primary" onClick={save}>Save Config</Btn>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}


