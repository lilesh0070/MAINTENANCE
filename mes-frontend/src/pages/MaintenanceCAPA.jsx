/* ───────────────────────────────────────────────────────────────────
 * MaintenanceCAPA.jsx  —  CAPA / Quality Problem Report (QPR)
 * ───────────────────────────────────────────────────────────────────
 * Every manual-slip breakdown with a ≥60-min repair (maintenance_breakdown_data,
 * mc_down_time_minutes ≥ 60) is a CAPA.  This page has two views:
 *   • LIST  — the pending / filled CAPAs (Machine No / Name / Date / Model /
 *             Duration / Problem) from /api/capa-lb/pending.
 *   • FORM  — the full QPR sheet (capa.xlsx format, grid from capaGrid.js, every
 *             blank cell an <input name="f_row_col">).  Opening a breakdown
 *             pre-fills machine/date/model/problem; Save stores one JSONB blob
 *             (POST /api/capa-lb/sheet) linked to the breakdown.
 *
 * Regenerate the grid from the xlsx:  <scratchpad>\gen_capa_html.py
 * Routing: /maintenance-capa
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { CAPA_QPR_GRID } from "./capaGrid";

// breakdown field  →  QPR grid cell (input name)
const PREFILL = (bd) => ({
  f_9_6:  bd.machine_no   || "",   // MACHINE_NO
  f_10_6: bd.machine_name || "",   // MACHINE_NAME
  f_10_4: bd.model_no     || "",   // Model
  f_2_13: bd.bd_date      || "",   // QPR DATE
  f_16_3: bd.problem      || "",   // Reported Problem
});

export default function MaintenanceCAPA() {
  const { token, theme, user } = useAuth();
  const formRef = useRef(null);
  const [view, setView]   = useState("list");      // "list" | "form"
  const [rows, setRows]   = useState([]);
  const [counts, setCounts] = useState({ total: 0, pending: 0, done: 0 });
  const [loading, setLoading] = useState(true);

  const [sid, setSid] = useState(null);            // current saved-sheet id
  const [bdId, setBdId] = useState(null);          // current breakdown id
  const [prefill, setPrefill] = useState({});      // {cell: value} to apply on open
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(""), 3000); };

  const api = useCallback(async (path, opts = {}) => {
    const r = await fetch(`/api/capa-lb${path}`, {
      ...opts,
      headers: { "Content-Type": "application/json",
                 ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) },
    });
    if (!r.ok) { let m; try { m = JSON.parse(await r.text()).detail; } catch { m = null; }
      throw new Error(m || `HTTP ${r.status}`); }
    return r.json();
  }, [token]);

  const loadPending = useCallback(() => {
    setLoading(true);
    api(`/pending`)
      .then((d) => { setRows(d.rows || []); setCounts({ total: d.total || 0, pending: d.pending || 0, done: d.done || 0 }); })
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [api]);
  useEffect(() => { loadPending(); }, [loadPending]);

  // apply the prefill / loaded data whenever the FORM view opens
  // (handles text inputs AND checkboxes)
  useEffect(() => {
    if (view !== "form" || !formRef.current) return;
    const els = formRef.current.elements;
    formRef.current.reset();
    Object.entries(prefill || {}).forEach(([k, v]) => {
      const el = els[k]; if (!el || v == null) return;
      if (el.type === "checkbox") el.checked = (v === true || v === "on" || v === "true" || v === 1 || v === "1");
      else el.value = v;
    });
    // reflect any loaded photo (hidden pdata value → <img>)
    formRef.current.querySelectorAll(".pbox").forEach((box) => {
      const d = box.querySelector(".pdata")?.value;
      const img = box.querySelector(".pimg");
      if (d) { if (img) img.src = d; box.classList.add("has"); }
      else { if (img) img.removeAttribute("src"); box.classList.remove("has"); }
    });
  }, [view, prefill]);

  // wire the photo upload / camera widgets (uncontrolled → data-URL into a hidden input)
  useEffect(() => {
    if (view !== "form" || !formRef.current) return;
    const form = formRef.current;
    const onChange = (e) => {
      const inp = e.target;
      if (inp.type !== "file" || !inp.closest || !inp.closest(".pbox")) return;
      const f = inp.files && inp.files[0]; if (!f) return;
      const box = inp.closest(".pbox");
      const rd = new FileReader();
      rd.onload = () => { const img = box.querySelector(".pimg");
        box.querySelector(".pdata").value = rd.result; if (img) img.src = rd.result; box.classList.add("has"); };
      rd.readAsDataURL(f); inp.value = "";
    };
    const onClick = (e) => {
      if (!e.target.classList || !e.target.classList.contains("pclr")) return;
      const box = e.target.closest(".pbox");
      box.querySelector(".pdata").value = ""; const img = box.querySelector(".pimg");
      if (img) img.removeAttribute("src"); box.classList.remove("has");
    };
    form.addEventListener("change", onChange);
    form.addEventListener("click", onClick);
    return () => { form.removeEventListener("change", onChange); form.removeEventListener("click", onClick); };
  }, [view]);

  const collect = () => {
    const data = {};
    if (formRef.current) new FormData(formRef.current).forEach((v, k) => { if (String(v).trim() !== "") data[k] = v; });
    return data;
  };

  const fillQpr = async (row) => {
    if (row.sheet_id) {                            // already started → load it
      try {
        const s = await api(`/sheet/${row.sheet_id}`);
        setPrefill(s.data || {}); setSid(s.id); setBdId(s.breakdown_id || row.bd_id);
      } catch (e) { flash("Open failed: " + (e.message || "")); return; }
    } else {                                       // fresh → pre-fill from the breakdown
      setPrefill(PREFILL(row)); setSid(null); setBdId(row.bd_id);
    }
    setView("form");
  };

  const save = async () => {
    setSaving(true);
    try {
      const r = await api(`/sheet`, { method: "POST",
        body: JSON.stringify({ id: sid, breakdown_id: bdId, data: collect() }) });
      setSid(r.id); flash(`Saved ✓ (QPR #${r.id})`);
    } catch (e) { flash("Save failed: " + (e.message || "")); }
    finally { setSaving(false); }
  };

  const backToList = () => { setView("list"); setSid(null); setBdId(null); setPrefill({}); loadPending(); };

  const btn = { border:"1px solid #cbd5e1", background:"#fff", cursor:"pointer", borderRadius:8, padding:"8px 14px", fontSize:13, fontWeight:700, color:"#334155" };
  const tile = (label, val, color, sub) => (
    <div style={{ background:"#fff", border:"1px solid #e2e8f0", borderTop:`3px solid ${color}`, borderRadius:14, padding:"14px 18px", minWidth:150 }}>
      <div style={{ fontSize:11.5, fontWeight:800, letterSpacing:".05em", textTransform:"uppercase", color:"#64748b" }}>{label}</div>
      <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:38, fontWeight:800, color, lineHeight:1 }}>{loading ? "…" : val}</div>
      <div style={{ fontSize:11, color:"#94a3b8", marginTop:3 }}>{sub}</div>
    </div>
  );

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700;800&family=Barlow+Condensed:wght@700;800&display=swap');
        .cp-root { min-height:100vh; background:#eef2f7; font-family:'Barlow',sans-serif; padding-bottom:40px; }
        .cp-top { background:#fff; border-bottom:1px solid #e2e8f0; min-height:60px; padding:8px 30px 8px 96px;
                  display:flex; align-items:center; gap:14px; flex-wrap:wrap; position:sticky; top:0; z-index:50; box-shadow:0 1px 3px rgba(0,0,0,.06); }
        .cp-top::after { content:''; position:absolute; bottom:0; left:0; right:0; height:2px; background:${theme.gradient}; }
        .cp-title { font-family:'Barlow Condensed',sans-serif; font-size:28px; font-weight:800; color:#0f172a; }
        .cp-title span { color:${theme.accent}; }
        .cp-save { border:none; background:${theme.accent}; color:#fff; cursor:pointer; border-radius:8px; padding:8px 20px; font-size:13.5px; font-weight:800; }
        .cp-save:disabled { opacity:.5; cursor:default; }
        .cp-msg { font-size:12.5px; font-weight:700; color:#16a34a; }
        .cp-body { max-width:1280px; margin:16px auto; padding:0 24px; }

        .cp-tbl-wrap { background:#fff; border:1px solid #e2e8f0; border-radius:14px; overflow-x:auto; box-shadow:0 1px 3px rgba(15,23,42,.05); }
        .cp-tbl { width:100%; border-collapse:collapse; }
        .cp-tbl th { background:#1e3a8a; color:#fff; font-size:11.5px; font-weight:700; padding:11px 14px; text-align:left; white-space:nowrap; }
        .cp-tbl td { border-bottom:1px solid #eef2f7; padding:10px 14px; font-size:12.5px; color:#334155; }
        .cp-tbl tbody tr { cursor:pointer; }
        .cp-tbl tr:hover td { background:#f8fafc; }
        /* long text columns clamped to ~3 lines so the QPR button stays visible */
        .cp-clamp { max-width:230px; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; line-height:1.3; }
        /* keep Status + QPR pinned to the right while scrolling wide rows */
        .cp-tbl th.cp-stick, .cp-tbl td.cp-stick { position:sticky; right:0; background:#fff; box-shadow:-6px 0 8px -6px rgba(0,0,0,.15); }
        .cp-tbl th.cp-stick { background:#1e3a8a; }
        .cp-tbl tr:hover td.cp-stick { background:#f8fafc; }
        .cp-dur { font-weight:800; color:#dc2626; text-align:center; }
        .cp-mno { font-weight:800; color:#0f172a; }
        .cp-fill { border:none; cursor:pointer; background:${theme.accent}; color:#fff; border-radius:8px; padding:7px 15px; font-size:12.5px; font-weight:800; }
        .cp-open { border:1.5px solid #cbd5e1; background:#fff; cursor:pointer; border-radius:8px; padding:6px 14px; font-size:12.5px; font-weight:700; color:#334155; }
        .cp-badge { padding:3px 10px; border-radius:99px; font-size:11px; font-weight:800; }

        .cp-scroll { overflow-x:auto; margin-top:12px; }
        .cp-sheet { background:#fff; padding:10px; box-shadow:0 3px 16px rgba(15,23,42,.18); min-width:1000px; }
        .qpr { width:100%; border-collapse:collapse; table-layout:fixed; font-family:Arial, sans-serif; color:#111; }
        .qpr td { overflow:hidden; word-wrap:break-word; line-height:1.15; }
        .qpr input.fin, .qpr textarea.fta { width:100%; box-sizing:border-box; border:none; outline:none; background:transparent; font:inherit; color:#1d4ed8; padding:1px 3px; }
        .qpr textarea.fta { resize:none; overflow:hidden; line-height:1.15; }
        .qpr input.fin:focus, .qpr textarea.fta:focus { background:#eff6ff; }
        .qpr input.fcb { width:14px; height:14px; margin-left:5px; vertical-align:middle; cursor:pointer; accent-color:#1d4ed8; }
        .qpr .pbox { position:relative; min-height:90px; height:100%; display:flex; align-items:center; justify-content:center; gap:8px; }
        .qpr .pbox .pimg { display:none; max-width:100%; max-height:230px; }
        .qpr .pbox.has .pimg { display:block; } .qpr .pbox.has .pbtns { display:none; }
        .qpr .pbtns { display:flex; gap:8px; flex-wrap:wrap; justify-content:center; }
        .qpr .pbtn { display:inline-flex; align-items:center; gap:4px; border:1px dashed #94a3b8; border-radius:8px; padding:6px 12px; font-size:11px; font-weight:700; color:#475569; cursor:pointer; background:#f8fafc; }
        .qpr .pbtn input[type=file] { display:none; }
        .qpr .pclr { display:none; position:absolute; top:3px; right:3px; border:none; background:#dc2626; color:#fff; border-radius:6px; width:20px; height:20px; cursor:pointer; font-weight:800; line-height:1; }
        .qpr .pbox.has .pclr { display:block; }
        @media print { .cp-top { display:none; } .cp-root { background:#fff; } .cp-body { margin:0; padding:0; } .cp-sheet { box-shadow:none; } }
      `}</style>

      <div className="cp-root">
        <div className="cp-top">
          <div className="cp-title">CA<span>PA</span> <span style={{ fontFamily:"'Barlow',sans-serif", fontSize:14, color:"#64748b", fontWeight:700 }}>· QPR</span></div>
          {view === "form" ? (<>
            <button style={btn} onClick={backToList}>← Pending CAPA</button>
            <button className="cp-save" onClick={save} disabled={saving}>{saving ? "Saving…" : (sid ? "💾 Update" : "💾 Save")}</button>
            <button style={btn} onClick={() => window.print()}>🖨 Print</button>
            {sid && <span style={{ fontSize:12, color:"#64748b", fontWeight:700 }}>QPR #{sid}</span>}
          </>) : (
            <button style={btn} onClick={() => { setPrefill({}); setSid(null); setBdId(null); setView("form"); }}>+ Blank QPR</button>
          )}
          {msg && <span className="cp-msg">{msg}</span>}
          <span style={{ marginLeft:"auto", fontSize:12, color:"#64748b", fontWeight:600 }}>{user?.username ? <>Signed in as <b>{user.username}</b></> : ""}</span>
        </div>

        {view === "list" ? (
          <div className="cp-body">
            <div style={{ fontSize:12.5, color:"#64748b", marginBottom:14 }}>
              Manual Slip ke har breakdown jiska repair <b>60 min ya usse zyada</b> hai wo ek CAPA hai. QPR bharke close karo.
            </div>
            <div style={{ display:"flex", gap:14, marginBottom:16, flexWrap:"wrap" }}>
              {tile("Total CAPA", counts.total, "#2563eb", "≥ 60-min breakdowns")}
              {tile("Pending", counts.pending, "#dc2626", "QPR baaki")}
              {tile("Filled", counts.done, "#16a34a", "QPR started")}
            </div>
            <div className="cp-tbl-wrap">
              <table className="cp-tbl">
                <thead><tr>
                  <th>#</th><th>Date</th><th>Zone</th><th>Line</th><th>Machine No</th>
                  <th>Problem by Maintenance</th><th>Action Taken</th>
                  <th style={{ textAlign:"center" }}>Total Time (min)</th><th>Attended By</th>
                  <th style={{ textAlign:"center" }}>Status</th>
                  <th className="cp-stick" style={{ textAlign:"center" }}>QPR</th>
                </tr></thead>
                <tbody>
                  {loading && <tr><td colSpan={11} style={{ textAlign:"center", color:"#94a3b8", padding:30 }}>Loading…</td></tr>}
                  {!loading && rows.length === 0 && <tr><td colSpan={11} style={{ textAlign:"center", color:"#94a3b8", padding:30 }}>No ≥60-min breakdowns.</td></tr>}
                  {!loading && rows.map((r, i) => (
                    <tr key={r.bd_id} onClick={() => fillQpr(r)} title="Click to open QPR">
                      <td>{i + 1}</td>
                      <td style={{ whiteSpace:"nowrap" }}>{r.bd_date}</td>
                      <td>{r.zone_name}</td>
                      <td>{r.line_name}</td>
                      <td className="cp-mno">{r.machine_no}</td>
                      <td><div className="cp-clamp">{r.problem_maintenance}</div></td>
                      <td><div className="cp-clamp">{r.action_taken}</div></td>
                      <td className="cp-dur">{r.duration_min}</td>
                      <td style={{ whiteSpace:"nowrap" }}>{r.attended_by}</td>
                      <td style={{ textAlign:"center" }}>
                        {r.sheet_id
                          ? <span className="cp-badge" style={{ background:"#dcfce7", color:"#166534" }}>Filled</span>
                          : <span className="cp-badge" style={{ background:"#fee2e2", color:"#b91c1c" }}>Pending</span>}
                      </td>
                      <td className="cp-stick" style={{ textAlign:"center" }}>
                        {r.sheet_id
                          ? <button className="cp-open" onClick={(e) => { e.stopPropagation(); fillQpr(r); }}>Open</button>
                          : <button className="cp-fill" onClick={(e) => { e.stopPropagation(); fillQpr(r); }}>Fill QPR</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="cp-body">
            <div className="cp-scroll">
              <form ref={formRef} onSubmit={(e) => e.preventDefault()}>
                <div className="cp-sheet" dangerouslySetInnerHTML={{ __html: CAPA_QPR_GRID }} />
              </form>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
