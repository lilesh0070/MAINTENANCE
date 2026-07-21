/* ───────────────────────────────────────────────────────────────────
 * OJT.jsx  —  Skill & Training → OJT (On-the-Job Training)
 * ───────────────────────────────────────────────────────────────────
 * "ON JOB TRAINING" record sheet (TBDI / HR / F / 014) with a Form / List
 * workflow (like the Log Book):
 *
 *   FORM  — fill one OJT record: Training Subjects / Duration / Trainer /
 *           Date of Training + employee table + details + trainer sign.
 *   LIST  — every saved record shown by Training Month + Subject; click a
 *           row to open its filled form (view / edit / delete).
 *
 * Stored in maintenance_skill_training (section='ojt') via /api/skill-training.
 * Routing: /skill-training/ojt
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const api = {
  async get(path, token) {
    const r = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
    return r.json();
  },
  async post(path, body, token) {
    const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
    return r.json();
  },
  async put(path, body, token) {
    const r = await fetch(path, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
    return r.json();
  },
  async del(path, token) {
    const r = await fetch(path, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
    return r.json();
  },
};

const emptyRow = () => ({ emp_code: "", emp_name: "", dept_area: "", signature: "" });
const emptyForm = () => ({
  id: null, training_subjects: "", duration: "", trainer: "", date_of_training: "",
  rows: [emptyRow(), emptyRow(), emptyRow(), emptyRow(), emptyRow()],
  details: "", trainer_signature: "",
});
const MON = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthLabel = (ds) => { if (!ds) return "—"; const [y, m] = ds.split("-"); return m ? `${MON[+m]} ${y}` : ds; };

export default function OJT() {
  const { token, theme, user } = useAuth();
  const nav = useNavigate();
  const [tab, setTab]       = useState("form");
  const [form, setForm]     = useState(emptyForm());
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty]   = useState(false);
  const [q, setQ]           = useState("");
  const [toast, setToast]   = useState(null);
  const flash = (m) => { setToast(m); setTimeout(() => setToast(null), 2600); };

  const loadList = useCallback(() => {
    if (!token) return;
    setLoading(true);
    api.get("/api/skill-training/?section=ojt", token)
      .then((rows) => setRecords(Array.isArray(rows) ? rows : []))
      .catch(() => flash("Could not load records"))
      .finally(() => setLoading(false));
  }, [token]);
  useEffect(() => { loadList(); }, [loadList]);

  // ── form mutators ────────────────────────────────────────────────────
  const patch = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setDirty(true); };
  const patchRow = (ri, k, v) => { setForm((f) => ({ ...f, rows: f.rows.map((r, j) => j === ri ? { ...r, [k]: v } : r) })); setDirty(true); };
  const addRow = () => { setForm((f) => ({ ...f, rows: [...f.rows, emptyRow()] })); setDirty(true); };
  const delRow = (ri) => { setForm((f) => { const rows = f.rows.filter((_, j) => j !== ri); return { ...f, rows: rows.length ? rows : [emptyRow()] }; }); setDirty(true); };

  const newForm = () => { setForm(emptyForm()); setDirty(false); setTab("form"); };
  const openRecord = (rec) => {
    const p = rec.payload || {};
    const rows = Array.isArray(p.rows) && p.rows.length ? p.rows.map((x) => ({ ...emptyRow(), ...x })) : [emptyRow()];
    setForm({ id: rec.id, training_subjects: p.training_subjects || "", duration: p.duration || "", trainer: p.trainer || "",
              date_of_training: p.date_of_training || "", rows, details: p.details || "", trainer_signature: p.trainer_signature || "" });
    setDirty(false); setTab("form");
  };

  const save = async () => {
    setSaving(true);
    const payload = {
      training_subjects: form.training_subjects, duration: form.duration, trainer: form.trainer,
      date_of_training: form.date_of_training, rows: form.rows, details: form.details, trainer_signature: form.trainer_signature,
    };
    const body = { section: "ojt", title: form.training_subjects || "OJT record", payload };
    try {
      if (form.id) await api.put(`/api/skill-training/${form.id}`, body, token);
      else { const res = await api.post("/api/skill-training/", body, token); setForm((f) => ({ ...f, id: res.id })); }
      setDirty(false); flash("Saved ✓"); loadList();
    } catch (e) { flash("Save failed: " + (e.message || "error")); }
    finally { setSaving(false); }
  };
  const remove = async (id, e) => {
    e?.stopPropagation();
    try { await api.del(`/api/skill-training/${id}`, token); setRecords((r) => r.filter((x) => x.id !== id));
      if (form.id === id) newForm(); flash("Deleted"); }
    catch (er) { flash("Delete failed: " + (er.message || "error")); }
  };

  const listRows = useMemo(() => {
    const arr = records.map((rec) => {
      const p = rec.payload || {};
      return { id: rec.id, subject: p.training_subjects || "(no subject)", month: monthLabel(p.date_of_training),
               date: p.date_of_training || "", trainer: p.trainer || "", count: (p.rows || []).filter((x) => x.emp_name || x.emp_code).length };
    }).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    if (!q) return arr;
    const s = q.toLowerCase();
    return arr.filter((r) => r.subject.toLowerCase().includes(s) || r.month.toLowerCase().includes(s) || r.trainer.toLowerCase().includes(s));
  }, [records, q]);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700;800&family=Barlow+Condensed:wght@600;700;800&display=swap');
        .oj-root { min-height:100vh; background:#eef2f6; font-family:'Barlow',sans-serif; padding-bottom:70px; }
        .oj-top { background:#fff; border-bottom:1px solid #e2e8f0; padding:14px 40px 14px 96px; flex-shrink:0;
                  display:flex; align-items:center; justify-content:space-between; position:sticky; top:0; z-index:100; box-shadow:0 1px 3px rgba(0,0,0,.06); }
        .oj-top::after { content:''; position:absolute; bottom:0; left:0; right:0; height:2px; background:${theme.gradient}; }
        .oj-back { display:inline-flex; align-items:center; gap:6px; border:1.5px solid #e2e8f0; background:#f8fafc; border-radius:99px;
                   padding:7px 16px; cursor:pointer; font-size:13px; font-weight:700; color:#334155; font-family:'Barlow',sans-serif; }
        .oj-back:hover { border-color:${theme.accent}; color:${theme.accent}; }
        .oj-title { font-family:'Barlow Condensed',sans-serif; font-size:28px; font-weight:800; color:#0f172a; line-height:1; }
        .oj-title span { color:${theme.accent}; }
        .oj-sub { font-size:12px; color:#64748b; margin-top:3px; }
        .oj-user-pill { display:flex; align-items:center; gap:10px; padding:6px 14px; border-radius:99px; border:1.5px solid #e2e8f0;
                        background:#f8fafc; font-size:12px; font-weight:600; color:#334155; white-space:nowrap; }
        .oj-user-pill b { color:#0f172a; font-weight:800; }

        .oj-tabs { max-width:1180px; margin:18px auto 0; padding:0 40px; display:flex; gap:8px; align-items:center; }
        .oj-tab { border:1px solid #cbd5e1; background:#fff; color:#64748b; font-weight:800; font-size:14px; padding:10px 26px; border-radius:10px 10px 0 0; cursor:pointer; }
        .oj-tab.on { background:${theme.accent}; color:#fff; border-color:${theme.accent}; }
        .oj-new { margin-left:auto; border:none; cursor:pointer; background:${theme.accent}; color:#fff; border-radius:9px; padding:9px 18px;
                  font-size:13.5px; font-weight:800; font-family:'Barlow',sans-serif; box-shadow:0 4px 12px ${theme.soft}; }

        .oj-body { max-width:1180px; margin:0 auto; padding:0 40px; }
        .oj-panel { background:#fff; border:1px solid #e2e8f0; border-radius:0 12px 12px 12px; box-shadow:0 1px 3px rgba(15,23,42,.05); }

        .oj-card { border:1px solid #cbd5e1; border-radius:6px; overflow:hidden; margin:0; }
        .oj-head { position:relative; border-bottom:1px solid #cbd5e1; padding:14px 18px; text-align:center; }
        .oj-company { font-size:16px; font-weight:800; color:#0f172a; }
        .oj-doc { font-size:13px; font-weight:700; color:#1e293b; margin-top:3px; letter-spacing:.06em; }
        .oj-card-actions { position:absolute; top:12px; right:14px; display:flex; gap:8px; align-items:center; }
        .oj-btn { display:inline-flex; align-items:center; gap:6px; border-radius:8px; cursor:pointer; font-size:12px; font-weight:700; padding:8px 14px; font-family:'Barlow',sans-serif; }
        .oj-btn-save { border:1.5px solid ${theme.accent}; background:${theme.accent}; color:#fff; }
        .oj-btn-save:disabled { opacity:.5; cursor:default; }
        .oj-dirty { font-size:11px; font-weight:700; color:#b45309; }

        .oj-fields { padding:16px 22px 6px; }
        .oj-frow { display:grid; grid-template-columns:1fr 1fr; gap:0 40px; }
        .oj-field { display:flex; align-items:flex-end; gap:10px; padding:8px 0; }
        .oj-flabel { font-size:11.5px; font-weight:800; color:#334155; letter-spacing:.04em; text-transform:uppercase; white-space:nowrap; padding-bottom:5px; min-width:120px; }
        .oj-finput { flex:1; border:none; border-bottom:1px solid #94a3b8; background:transparent; font-size:14px; color:#0f172a; padding:5px 2px; font-family:'Barlow',sans-serif; outline:none; }
        .oj-finput:focus { border-bottom-color:${theme.accent}; }

        .oj-tbl-wrap { padding:8px 22px 4px; }
        .oj-tbl { width:100%; border-collapse:collapse; }
        .oj-tbl th { background:#eef2f7; border:1px solid #cbd5e1; font-size:11.5px; font-weight:800; color:#1e293b; padding:8px; text-transform:uppercase; }
        .oj-tbl td { border:1px solid #cbd5e1; padding:0; }
        .oj-tbl td.sno { text-align:center; font-weight:800; color:#0f172a; width:48px; padding:6px; }
        .oj-cell-input { width:100%; border:none; background:transparent; padding:9px 10px; font-size:13.5px; color:#0f172a; font-family:'Barlow',sans-serif; outline:none; }
        .oj-cell-input:focus { background:${theme.soft}; }
        .oj-rowdel { width:42px; text-align:center; }
        .oj-rowdel button { border:none; background:transparent; cursor:pointer; color:#dc2626; font-size:15px; padding:6px; }
        .oj-addrow { margin:12px 0 4px; display:inline-flex; align-items:center; gap:7px; border:1px solid #cbd5e1; background:#f8fafc; border-radius:8px;
                     cursor:pointer; font-size:13px; font-weight:700; color:#334155; padding:8px 15px; font-family:'Barlow',sans-serif; }
        .oj-foot { padding:6px 22px 18px; }
        .oj-foot-label { font-size:11.5px; font-weight:800; color:#334155; letter-spacing:.04em; text-transform:uppercase; margin:10px 0 6px; }
        .oj-textarea { width:100%; min-height:90px; border:1px solid #94a3b8; border-radius:6px; padding:10px 12px; font-size:14px; color:#0f172a; resize:vertical; font-family:'Barlow',sans-serif; outline:none; }
        .oj-sig { display:flex; align-items:flex-end; gap:10px; margin-top:14px; }
        .oj-format { border-top:1px solid #e2e8f0; margin-top:14px; padding-top:8px; text-align:right; font-size:11px; color:#64748b; }

        .oj-lwrap { padding:18px 20px; }
        .oj-search { width:100%; max-width:360px; box-sizing:border-box; border:1.5px solid #cbd5e1; border-radius:9px; padding:9px 12px; font-size:13.5px;
                     font-family:'Barlow',sans-serif; outline:none; margin-bottom:14px; }
        .oj-search:focus { border-color:${theme.accent}; }
        .oj-list { display:grid; gap:12px; grid-template-columns:repeat(auto-fill, minmax(300px,1fr)); }
        .oj-item { border:1px solid #e2e8f0; border-left:4px solid ${theme.accent}; border-radius:12px; padding:14px 16px; cursor:pointer;
                   background:#fff; transition:all .12s ease; position:relative; }
        .oj-item:hover { box-shadow:0 8px 22px rgba(15,23,42,.10); transform:translateY(-2px); }
        .oj-item-month { font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:.05em; color:${theme.accentDark};
                         background:${theme.soft}; display:inline-block; padding:2px 10px; border-radius:99px; }
        .oj-item-subj { font-size:15px; font-weight:800; color:#0f172a; margin-top:8px; line-height:1.25; }
        .oj-item-meta { font-size:12px; color:#64748b; margin-top:6px; }
        .oj-item-del { position:absolute; top:10px; right:10px; border:none; background:transparent; cursor:pointer; color:#cbd5e1; font-size:14px; }
        .oj-item-del:hover { color:#dc2626; }
        .oj-empty { text-align:center; color:#94a3b8; padding:44px; font-size:14px; }
        .oj-toast { position:fixed; bottom:26px; left:50%; transform:translateX(-50%); background:#0f172a; color:#fff; padding:12px 22px; border-radius:10px;
                    font-size:13px; font-weight:600; z-index:300; box-shadow:0 8px 24px rgba(0,0,0,.25); }
      `}</style>

      <div className="oj-root">
        <div className="oj-top">
          <div style={{ display:"flex", alignItems:"center", gap:16 }}>
            <button className="oj-back" onClick={() => nav("/skill-training")}>← Back</button>
            <div>
              <div className="oj-title">O<span>JT</span></div>
              <div className="oj-sub">On-the-Job Training records</div>
            </div>
          </div>
          {user?.username && <div className="oj-user-pill">Signed in as <b>{user.username}</b></div>}
        </div>

        <div className="oj-tabs">
          <button className={`oj-tab${tab === "form" ? " on" : ""}`} onClick={() => setTab("form")}>📝 Form</button>
          <button className={`oj-tab${tab === "list" ? " on" : ""}`} onClick={() => { setTab("list"); loadList(); }}>📋 List ({records.length})</button>
          {tab === "form" && <button className="oj-new" onClick={newForm}>+ New OJT Record</button>}
        </div>

        <div className="oj-body">
          {tab === "form" ? (
            <div className="oj-panel" style={{ padding: 18 }}>
              <div className="oj-card">
                <div className="oj-head">
                  <div className="oj-company">TOYOTA BOSHOKU DEVICE INDIA PVT. LTD.</div>
                  <div className="oj-doc">ON JOB TRAINING</div>
                  <div className="oj-card-actions">
                    {dirty && <span className="oj-dirty">Unsaved</span>}
                    <button className="oj-btn oj-btn-save" onClick={save} disabled={saving || !dirty}>{saving ? "Saving…" : (form.id ? "💾 Update" : "💾 Save")}</button>
                  </div>
                </div>

                <div className="oj-fields">
                  <div className="oj-frow">
                    <div className="oj-field"><span className="oj-flabel">Training Subjects</span>
                      <input className="oj-finput" value={form.training_subjects} onChange={(e) => patch("training_subjects", e.target.value)} /></div>
                    <div className="oj-field"><span className="oj-flabel">Duration</span>
                      <input className="oj-finput" value={form.duration} onChange={(e) => patch("duration", e.target.value)} /></div>
                    <div className="oj-field"><span className="oj-flabel">Trainer</span>
                      <input className="oj-finput" value={form.trainer} onChange={(e) => patch("trainer", e.target.value)} /></div>
                    <div className="oj-field"><span className="oj-flabel">Date of Training</span>
                      <input className="oj-finput" type="date" value={form.date_of_training} onChange={(e) => patch("date_of_training", e.target.value)} /></div>
                  </div>
                </div>

                <div className="oj-tbl-wrap">
                  <table className="oj-tbl">
                    <thead>
                      <tr><th style={{ width:48 }}>S.No</th><th style={{ width:160 }}>Employee Code No.</th><th>Employee Name</th>
                        <th>Department / Area</th><th>Signature</th><th style={{ width:42 }}></th></tr>
                    </thead>
                    <tbody>
                      {form.rows.map((row, ri) => (
                        <tr key={ri}>
                          <td className="sno">{ri + 1}</td>
                          <td><input className="oj-cell-input" value={row.emp_code} onChange={(e) => patchRow(ri, "emp_code", e.target.value)} /></td>
                          <td><input className="oj-cell-input" value={row.emp_name} onChange={(e) => patchRow(ri, "emp_name", e.target.value)} /></td>
                          <td><input className="oj-cell-input" value={row.dept_area} onChange={(e) => patchRow(ri, "dept_area", e.target.value)} /></td>
                          <td><input className="oj-cell-input" value={row.signature} onChange={(e) => patchRow(ri, "signature", e.target.value)} /></td>
                          <td className="oj-rowdel"><button title="Remove row" onClick={() => delRow(ri)}>🗑</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <button className="oj-addrow" onClick={addRow}>+ Add Row</button>
                </div>

                <div className="oj-foot">
                  <div className="oj-foot-label">Details of Given Training :-</div>
                  <textarea className="oj-textarea" value={form.details} onChange={(e) => patch("details", e.target.value)} />
                  <div className="oj-sig"><span className="oj-flabel">Signature of Trainer</span>
                    <input className="oj-finput" value={form.trainer_signature} onChange={(e) => patch("trainer_signature", e.target.value)} /></div>
                  <div className="oj-format">FORMAT NO.: TBDI / HR / F / 014, REV. NO.: 00, REV. DATE: 20/03/2024</div>
                </div>
              </div>
            </div>
          ) : (
            <div className="oj-panel oj-lwrap">
              <input className="oj-search" placeholder="🔍 Search by month / subject / trainer…" value={q} onChange={(e) => setQ(e.target.value)} />
              {loading && <div className="oj-empty">Loading…</div>}
              {!loading && listRows.length === 0 && <div className="oj-empty">No OJT records yet. Go to Form → fill → Save.</div>}
              <div className="oj-list">
                {listRows.map((r) => (
                  <div className="oj-item" key={r.id} onClick={() => openRecord(records.find((x) => x.id === r.id))}>
                    <button className="oj-item-del" title="Delete" onClick={(e) => remove(r.id, e)}>🗑</button>
                    <span className="oj-item-month">{r.month}</span>
                    <div className="oj-item-subj">{r.subject}</div>
                    <div className="oj-item-meta">Trainer: <b>{r.trainer || "—"}</b> · {r.count} employee{r.count === 1 ? "" : "s"}{r.date ? ` · ${r.date}` : ""}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {toast && <div className="oj-toast">{toast}</div>}
      </div>
    </>
  );
}
