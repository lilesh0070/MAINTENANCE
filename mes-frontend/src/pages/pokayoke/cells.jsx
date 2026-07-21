import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../../context/AuthContext";
import { api } from "./shared";

// ════════════════════════════════════════════════════════════════════
// RemarksCell — per-PY remarks input + submit button.
// Submits to /api/poka-yoke/requests (Phase 2 backend).
// On submit, the request lands in mes_py_requests audit table
// and admins see it on the "New Requests" panel.
// 2026-05-21 — Added per operator spec: "remarks ka option if any
// changes are required so mention changes are save in audit panel".
// ════════════════════════════════════════════════════════════════════
function RemarksCell({ py, lineId, modelBit }) {
  const { token, user } = useAuth();
  const [text, setText]       = useState("");
  const [busy, setBusy]       = useState(false);
  const [status, setStatus]   = useState(null);  // null | 'ok' | 'err' | msg

  const submit = async () => {
    const remark = (text || "").trim();
    if (!remark) {
      setStatus("Please enter a remark");
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const r = await fetch(API + "/api/poka-yoke/requests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({
          py_no:       py.poka_yoke_no,
          py_name:     py.poka_yoke_name,
          py_master_id: py.py_master_id || py.id,
          line_id:     lineId,
          model_bit:   modelBit,
          sensing_bits: py.sensing_bits,
          machine_name: py.machine_name,
          bit:         py.bit,
          expected:    py.value,
          remark:      remark,
        }),
      });
      if (r.ok) {
        setText("");
        setStatus("ok");
        setTimeout(() => setStatus(null), 2500);
      } else {
        const body = await r.text();
        setStatus(`HTTP ${r.status}: ${body.slice(0, 80)}`);
      }
    } catch (e) {
      setStatus(`Error: ${String(e).slice(0, 80)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:4, minWidth:180 }}>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Add remark / change request…"
        rows={2}
        disabled={busy}
        style={{
          width:"100%", fontSize:11, padding:"4px 6px",
          border:"1px solid #cbd5e1", borderRadius:4,
          resize:"vertical", fontFamily:"inherit", minHeight:34,
        }}
      />
      <div style={{ display:"flex", gap:6, alignItems:"center" }}>
        <button
          onClick={submit}
          disabled={busy || !text.trim()}
          style={{
            fontSize:10, fontWeight:700, padding:"4px 10px",
            background: busy ? "#94a3b8" : "#0369a1",
            color:"#fff", border:"none", borderRadius:4,
            cursor: busy ? "not-allowed" : "pointer",
            letterSpacing:".05em",
          }}>
          {busy ? "Submitting…" : "Submit"}
        </button>
        {status === "ok" && (
          <span style={{ fontSize:10, color:"#16a34a", fontWeight:600 }}>
            ✓ Saved
          </span>
        )}
        {status && status !== "ok" && (
          <span style={{ fontSize:9, color:"#b91c1c" }}
                title={status}>
            {status.length > 22 ? status.slice(0, 22) + "…" : status}
          </span>
        )}
      </div>
    </div>
  );
}


// ════════════════════════════════════════════════════════════════════
// ImageCell — per-PY image button + viewer modal + (admin) upload UI.
// Operator clicks the 📷 button → modal opens showing all images for
// this PY.  Admin sees an "Upload" tile in the modal to add images
// (single or multiple).  Spec from operator (2026-05-21):
//   "first row p click kru to image show ho jaye or ye image set
//    krne ka option dede maintenance panel ... image single bhi ho
//    sakti h or multiple bhi ok as a manual".
// ════════════════════════════════════════════════════════════════════
// 2026-05-21 — Maintenance side is VIEW ONLY.  No upload, no delete.
// Admin manages images + instructions from a separate tab in the
// Maintenance Panel (PyManualsPage).  Operator just sees the manual:
// instructions text at top + image gallery below.
function ImageCell({ py, lineId }) {
  const { token } = useAuth();
  const [open,    setOpen]    = useState(false);
  const [images,  setImages]  = useState(null);
  const [instr,   setInstr]   = useState(null);   // {text, updated_by, updated_at}
  const [busy,    setBusy]    = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const qs = new URLSearchParams();
      qs.set("py_no", py.poka_yoke_no);
      if (lineId != null) qs.set("line_id", String(lineId));
      // Parallel fetch images + instructions
      const [imgR, insR] = await Promise.all([
        fetch(API + "/api/poka-yoke/images?" + qs.toString(),
              { headers: token ? { Authorization: `Bearer ${token}` } : {} }),
        fetch(API + "/api/poka-yoke/instructions?" + qs.toString(),
              { headers: token ? { Authorization: `Bearer ${token}` } : {} }),
      ]);
      if (imgR.ok) {
        const d = await imgR.json();
        setImages(d.rows || []);
      } else {
        setImages([]);
      }
      if (insR.ok) {
        const d = await insR.json();
        const row = (d.rows || [])[0];
        setInstr(row || null);
      } else {
        setInstr(null);
      }
    } catch {
      setImages([]);
      setInstr(null);
    } finally {
      setBusy(false);
    }
  }, [py.poka_yoke_no, lineId, token]);

  useEffect(() => {
    if (open && images === null) refresh();
  }, [open, images, refresh]);

  return (
    <>
      <button onClick={() => setOpen(true)}
              title="View / upload images"
              style={{
                fontSize:14, padding:"3px 8px",
                background:"#f1f5f9", color:"#475569",
                border:"1px solid #cbd5e1", borderRadius:4,
                cursor:"pointer",
              }}>
        📷
      </button>
      {open && (
        <div style={{
          position:"fixed", inset:0, background:"rgba(0,0,0,.65)",
          display:"flex", alignItems:"center", justifyContent:"center",
          zIndex:1000,
        }}
        onClick={() => setOpen(false)}>
          <div onClick={e => e.stopPropagation()}
               style={{
                 background:"#fff", padding:20, borderRadius:10,
                 maxWidth:880, width:"92%", maxHeight:"86vh",
                 overflowY:"auto",
                 boxShadow:"0 20px 60px rgba(0,0,0,.4)",
               }}>
            <div style={{ display:"flex", justifyContent:"space-between",
                           alignItems:"flex-start", marginBottom:12 }}>
              <div>
                <h3 style={{ margin:0, fontSize:18, fontWeight:800, color:"#0f172a" }}>
                  📷 Images: {py.poka_yoke_no}
                </h3>
                <div style={{ fontSize:11, color:"#64748b", marginTop:4 }}>
                  {py.poka_yoke_name || "—"}
                  {py.sensing_bits && <span> · Sensor <strong style={{ color:"#0369a1" }}>{py.sensing_bits}</strong></span>}
                  {py.bit && <span> · Bit <strong>{py.bit}</strong></span>}
                </div>
              </div>
              <button onClick={() => setOpen(false)}
                      style={{ fontSize:18, padding:"4px 10px",
                               background:"transparent", color:"#64748b",
                               border:"none", cursor:"pointer", fontWeight:700 }}>
                ✕
              </button>
            </div>

            {/* Instructions / follow-steps (read-only here; admin
                edits this from Maintenance Panel → PY Manuals tab). */}
            {instr && instr.instruction_text && (
              <div style={{
                padding:"12px 14px", marginBottom:14,
                background:"#fffbeb", border:"1px solid #fcd34d",
                borderRadius:8,
              }}>
                <div style={{
                  fontSize:10, fontWeight:800, color:"#92400e",
                  letterSpacing:".08em", marginBottom:6,
                }}>
                  📋 INSTRUCTIONS / FOLLOW STEPS
                </div>
                <div style={{
                  fontSize:12, color:"#451a03", whiteSpace:"pre-wrap",
                  lineHeight:1.5,
                }}>
                  {instr.instruction_text}
                </div>
                {instr.updated_by_username && (
                  <div style={{ fontSize:9, color:"#92400e",
                                 marginTop:8, fontStyle:"italic" }}>
                    Last updated by {instr.updated_by_username}
                  </div>
                )}
              </div>
            )}

            {/* Image gallery */}
            {busy && images === null ? (
              <div style={{ padding:30, textAlign:"center", color:"#94a3b8" }}>
                Loading images…
              </div>
            ) : (!images?.length && !instr?.instruction_text) ? (
              <div style={{ padding:30, textAlign:"center", color:"#94a3b8",
                             fontStyle:"italic" }}>
                No manual content yet for this PY.
                <div style={{ fontSize:10, marginTop:6 }}>
                  Admin can add reference images + instructions from
                  <strong> Maintenance Panel → PY Manuals</strong>.
                </div>
              </div>
            ) : !images?.length ? (
              <div style={{ padding:20, textAlign:"center", color:"#94a3b8",
                             fontSize:11, fontStyle:"italic" }}>
                (No images — text instructions above)
              </div>
            ) : (
              <div style={{
                display:"grid",
                gridTemplateColumns:"repeat(auto-fill, minmax(200px, 1fr))",
                gap:10,
              }}>
                {images.map(img => (
                  <div key={img.id} style={{
                    border:"1px solid #e2e8f0", borderRadius:6,
                    overflow:"hidden", background:"#fff", position:"relative",
                  }}>
                    <a href={API + img.url} target="_blank" rel="noreferrer"
                       title="Click to open full-size">
                      <img src={API + img.url}
                           alt={img.caption || img.original_filename}
                           style={{ width:"100%", height:160, objectFit:"cover",
                                     display:"block", background:"#f8fafc",
                                     cursor:"zoom-in" }}/>
                    </a>
                    <div style={{ padding:"6px 8px", fontSize:10,
                                   borderTop:"1px solid #e2e8f0" }}>
                      <div style={{ fontWeight:600, color:"#475569",
                                     overflow:"hidden", textOverflow:"ellipsis",
                                     whiteSpace:"nowrap" }}
                           title={img.original_filename}>
                        {img.original_filename}
                      </div>
                      {img.caption && (
                        <div style={{ fontSize:9, color:"#94a3b8", marginTop:2 }}>
                          {img.caption}
                        </div>
                      )}
                      <div style={{ fontSize:9, color:"#94a3b8", marginTop:2 }}>
                        Uploaded by {img.uploaded_by_username || "—"}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}



export { RemarksCell, ImageCell };
