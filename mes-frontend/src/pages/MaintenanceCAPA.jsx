/* ───────────────────────────────────────────────────────────────────
 * MaintenanceCAPA.jsx  —  CAPA / Quality Problem Report (QPR)
 * ───────────────────────────────────────────────────────────────────
 * Format = capa.xlsx (TOYOTA BOSHOKU — QUALITY PROBLEM REPORT / QPR, 8D).
 * The full sheet grid is generated cell-for-cell from the Excel (exact
 * merged-cell colspan/rowspan) into `capaGrid.js`, with every blank cell an
 * <input>/<textarea name="f_<row>_<col>">.  This page renders that grid inside
 * a <form>, and Save serialises all named fields into one JSONB blob
 * (backend /api/capa-lb/sheet).  Saved QPRs reopen from the dropdown.
 *
 * Regenerate the grid from the xlsx:  <scratchpad>\gen_capa_html.py
 * Routing: /maintenance-capa
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { CAPA_QPR_GRID } from "./capaGrid";

export default function MaintenanceCAPA() {
  const { token, theme, user } = useAuth();
  const formRef = useRef(null);
  const [sid, setSid]   = useState(null);     // current saved-sheet id (null = new)
  const [list, setList] = useState([]);       // saved QPR sheets
  const [saving, setSaving] = useState(false);
  const [msg, setMsg]   = useState("");
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

  const loadList = useCallback(() => {
    api(`/sheets`).then((d) => setList(d.rows || [])).catch(() => {});
  }, [api]);
  useEffect(() => { loadList(); }, [loadList]);

  // read every named field → { f_r_c: value }  (only the filled ones)
  const collect = () => {
    const data = {};
    if (formRef.current) new FormData(formRef.current).forEach((v, k) => {
      if (String(v).trim() !== "") data[k] = v;
    });
    return data;
  };

  const save = async () => {
    setSaving(true);
    try {
      const r = await api(`/sheet`, { method: "POST", body: JSON.stringify({ id: sid, data: collect() }) });
      setSid(r.id);
      flash(`Saved ✓ (QPR #${r.id})`);
      loadList();
    } catch (e) { flash("Save failed: " + (e.message || "")); }
    finally { setSaving(false); }
  };

  const openSheet = async (id) => {
    if (!id) return;
    try {
      const r = await api(`/sheet/${id}`);
      const els = formRef.current?.elements;
      if (els) {
        formRef.current.reset();                       // clear all fields first
        Object.entries(r.data || {}).forEach(([k, v]) => { if (els[k]) els[k].value = v; });
      }
      setSid(r.id);
      flash(`Opened QPR #${r.id}`);
    } catch (e) { flash("Open failed: " + (e.message || "")); }
  };

  const newSheet = () => { formRef.current?.reset(); setSid(null); flash("New blank QPR"); };

  const btn = { border:"1px solid #cbd5e1", background:"#fff", cursor:"pointer", borderRadius:8,
                padding:"8px 14px", fontSize:13, fontWeight:700, color:"#334155" };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700;800&family=Barlow+Condensed:wght@700;800&display=swap');
        .cp-root { min-height:100vh; background:#e5e7eb; font-family:'Barlow',sans-serif; padding-bottom:40px; }
        .cp-top { background:#fff; border-bottom:1px solid #e2e8f0; min-height:60px; padding:8px 30px 8px 96px;
                  display:flex; align-items:center; gap:14px; flex-wrap:wrap; position:sticky; top:0; z-index:50; box-shadow:0 1px 3px rgba(0,0,0,.06); }
        .cp-top::after { content:''; position:absolute; bottom:0; left:0; right:0; height:2px; background:${theme.gradient}; }
        .cp-title { font-family:'Barlow Condensed',sans-serif; font-size:28px; font-weight:800; color:#0f172a; }
        .cp-title span { color:${theme.accent}; }
        .cp-save { border:none; background:${theme.accent}; color:#fff; cursor:pointer; border-radius:8px; padding:8px 20px; font-size:13.5px; font-weight:800; }
        .cp-save:disabled { opacity:.5; cursor:default; }
        .cp-sel { border:1px solid #cbd5e1; border-radius:8px; padding:8px 10px; font-size:13px; font-weight:600; color:#0f172a; background:#fff; min-width:230px; }
        .cp-msg { font-size:12.5px; font-weight:700; color:#16a34a; }

        .cp-scroll { max-width:1180px; margin:16px auto; overflow-x:auto; }
        .cp-sheet { background:#fff; padding:10px; box-shadow:0 3px 16px rgba(15,23,42,.18); min-width:1000px; }
        .qpr { width:100%; border-collapse:collapse; table-layout:fixed; font-family:Arial, sans-serif; color:#111; }
        .qpr td { overflow:hidden; word-wrap:break-word; line-height:1.15; }
        .qpr input.fin, .qpr textarea.fta { width:100%; box-sizing:border-box; border:none; outline:none; background:transparent; font:inherit; color:#1d4ed8; padding:1px 3px; }
        .qpr textarea.fta { resize:none; overflow:hidden; line-height:1.15; }
        .qpr input.fin:focus, .qpr textarea.fta:focus { background:#eff6ff; }
        @media print { .cp-top { display:none; } .cp-root { background:#fff; } .cp-scroll { margin:0; } .cp-sheet { box-shadow:none; } }
      `}</style>

      <div className="cp-root">
        <div className="cp-top">
          <div className="cp-title">CA<span>PA</span> <span style={{ fontFamily:"'Barlow',sans-serif", fontSize:14, color:"#64748b", fontWeight:700 }}>· QPR</span></div>
          <button style={btn} onClick={newSheet}>+ New</button>
          <button className="cp-save" onClick={save} disabled={saving}>{saving ? "Saving…" : (sid ? "💾 Update" : "💾 Save")}</button>
          <select className="cp-sel" value={sid || ""} onChange={(e) => openSheet(e.target.value ? Number(e.target.value) : null)}>
            <option value="">— open saved QPR —</option>
            {list.map((s) => (
              <option key={s.id} value={s.id}>
                #{s.id}{s.qpr_no ? ` · QPR ${s.qpr_no}` : ""}{s.machine_no ? ` · ${s.machine_no}` : ""}
                {s.title ? ` · ${String(s.title).slice(0, 40)}` : ""}
              </option>
            ))}
          </select>
          <button style={btn} onClick={() => window.print()}>🖨 Print</button>
          {sid && <span style={{ fontSize:12, color:"#64748b", fontWeight:700 }}>editing #{sid}</span>}
          {msg && <span className="cp-msg">{msg}</span>}
          <span style={{ marginLeft:"auto", fontSize:12, color:"#64748b", fontWeight:600 }}>{user?.username ? <>Signed in as <b>{user.username}</b></> : ""}</span>
        </div>

        <div className="cp-scroll">
          <form ref={formRef} onSubmit={(e) => e.preventDefault()}>
            <div className="cp-sheet" dangerouslySetInnerHTML={{ __html: CAPA_QPR_GRID }} />
          </form>
        </div>
      </div>
    </>
  );
}
