/* ───────────────────────────────────────────────────────────────────
 * SkillUpgradation.jsx  —  Skill & Training → Skill Upgradation Plan
 * ───────────────────────────────────────────────────────────────────
 * Reproduces "SKILL UPGRADATION TRAINING PLAN OF TOOLING PERSON 2026-27"
 * (TBDI Press Shop) — the training content comes verbatim from the Excel
 * (src/data/skillUpgradationData.js).  Columns: Sr.No / Training /
 * Sub-Group / Topics / Trainee / Skill Upgrade Target / Time Duration /
 * Trainer-Responsibility, then 12 months × 4 weeks, then Remarks.
 *
 * Each week cell is clickable: empty → ○ (Training Due) → ● (Training
 * Done) → empty.  The marks + remarks save to `maintenance_skill_training`
 * (section='skill_upgradation') via /api/skill-training.
 *
 * Routing: /skill-training/skill-upgradation
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { SU_COMPANY, SU_TITLE, SU_MONTHS, SU_LEGEND, SU_ROWS } from "../data/skillUpgradationData";

const api = {
  async get(path, token) {
    const r = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
    return r.json();
  },
  async post(path, body, token) {
    const r = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
    return r.json();
  },
  async put(path, body, token) {
    const r = await fetch(path, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
    return r.json();
  },
};

const WEEKS = ["W1", "W2", "W3", "W4"];
const MARK = { 1: "○", 2: "●" };          // 1 = due, 2 = done
const MARK_COLOR = { 1: "#475569", 2: "#16a34a" };

export default function SkillUpgradation() {
  const { token, theme, user } = useAuth();
  const nav = useNavigate();

  const [marks, setMarks] = useState({});   // { "sr_weekIdx": 1|2 }
  const [remarks, setRemarks] = useState({});   // { sr: text }
  const [recordId, setRecordId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [toast, setToast] = useState(null);

  const flash = (m) => { setToast(m); setTimeout(() => setToast(null), 2600); };

  // Pre-compute category / sub-group row spans for the merged cells.
  const meta = useMemo(() => {
    const m = SU_ROWS.map((r) => ({ ...r }));
    for (let i = 0; i < m.length;) {
      let j = i; while (j < m.length && m[j].category === m[i].category) j++;
      m[i].catSpan = j - i; m[i].catFirst = true;
      for (let k = i + 1; k < j; k++) m[k].catFirst = false;
      i = j;
    }
    for (let i = 0; i < m.length;) {
      let j = i;
      while (j < m.length && m[j].category === m[i].category && m[j].subcat === m[i].subcat) j++;
      m[i].subSpan = j - i; m[i].subFirst = true;
      for (let k = i + 1; k < j; k++) m[k].subFirst = false;
      i = j;
    }
    return m;
  }, []);

  // ── Load saved marks ───────────────────────────────────────────────
  const load = useCallback(() => {
    if (!token) return;
    setLoading(true);
    api.get("/api/skill-training/?section=skill_upgradation", token)
      .then((rows) => {
        const rec = Array.isArray(rows) && rows.length ? rows[0] : null;
        if (rec && rec.payload) {
          setRecordId(rec.id);
          setMarks(rec.payload.marks || {});
          setRemarks(rec.payload.remarks || {});
        }
        setDirty(false);
      })
      .catch(() => flash("Could not load saved plan"))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const cycle = (sr, wIdx) => {
    const key = `${sr}_${wIdx}`;
    setMarks((m) => {
      const cur = m[key] || 0;
      const next = (cur + 1) % 3;
      const out = { ...m };
      if (next === 0) delete out[key]; else out[key] = next;
      return out;
    });
    setDirty(true);
  };

  const setRemark = (sr, val) => { setRemarks((r) => ({ ...r, [sr]: val })); setDirty(true); };

  const save = async () => {
    const body = { section: "skill_upgradation", title: SU_TITLE, payload: { fy: "2026-27", marks, remarks } };
    try {
      if (recordId) await api.put(`/api/skill-training/${recordId}`, body, token);
      else { const res = await api.post("/api/skill-training/", body, token); setRecordId(res.id); }
      setDirty(false);
      flash("Saved ✓");
    } catch (e) { flash("Save failed: " + (e.message || "error")); }
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700;800&family=Barlow+Condensed:wght@600;700;800&display=swap');
        .su-root { height:100vh; display:flex; flex-direction:column; background:#fff;
                   font-family:'Barlow',sans-serif; overflow:hidden; }
        .su-top {
          background:#fff; border-bottom:1px solid #e2e8f0; flex-shrink:0;
          padding:14px 26px 14px 96px;
          display:flex; align-items:center; justify-content:space-between;
          position:relative; z-index:100; box-shadow:0 1px 3px rgba(0,0,0,.06);
        }
        .su-top::after { content:''; position:absolute; bottom:0; left:0; right:0;
                         height:2px; background:${theme.gradient}; }
        .su-back { display:inline-flex; align-items:center; gap:6px; border:1.5px solid #e2e8f0;
                   background:#f8fafc; border-radius:99px; padding:7px 16px; cursor:pointer;
                   font-size:13px; font-weight:700; color:#334155; font-family:'Barlow',sans-serif; }
        .su-back:hover { border-color:${theme.accent}; color:${theme.accent}; }
        .su-title { font-family:'Barlow Condensed',sans-serif; font-size:24px; font-weight:800; color:#0f172a; line-height:1; }
        .su-title span { color:${theme.accent}; }
        .su-sub { font-size:12px; color:#64748b; margin-top:3px; }
        .su-actions { display:flex; align-items:center; gap:14px; }
        .su-legend { display:flex; gap:14px; font-size:12px; color:#334155; }
        .su-legend .li { display:flex; align-items:center; gap:5px; font-weight:600; }
        .su-save { display:inline-flex; align-items:center; gap:7px; border:none; cursor:pointer;
                   background:${theme.accent}; color:#fff; border-radius:9px; padding:10px 18px;
                   font-size:14px; font-weight:800; font-family:'Barlow',sans-serif; box-shadow:0 4px 12px ${theme.soft}; }
        .su-save:disabled { opacity:.5; cursor:default; box-shadow:none; }

        .su-body { flex:1; min-height:0; display:flex; flex-direction:column; padding:0; }
        .su-card { flex:1; min-height:0; display:flex; flex-direction:column;
                   background:#fff; border:none; border-radius:0; overflow:hidden; box-shadow:none; }
        .su-head { border-bottom:1px solid #cbd5e1; padding:12px 16px; text-align:center; flex-shrink:0; }
        .su-company { font-size:15px; font-weight:800; color:#0f172a; }
        .su-doc { font-size:12.5px; font-weight:700; color:#1e293b; margin-top:3px; letter-spacing:.03em; }

        .su-scroll { flex:1; min-height:0; overflow:auto; }
        .su-tbl { border-collapse:collapse; font-size:11.5px; }
        .su-tbl th, .su-tbl td { border:1px solid #cbd5e1; word-break:break-word; overflow-wrap:anywhere; }
        .su-tbl thead th { position:sticky; top:0; z-index:5; background:${theme.accent}; color:#fff;
                           font-weight:700; padding:6px 6px; }
        .su-tbl thead tr:nth-child(2) th { top:30px; }
        /* Column-header cells: bigger + single-line (no wrap) like a div line of text. */
        .su-tbl thead th.su-th-info { vertical-align:middle; white-space:nowrap;
                                      padding:16px 20px; font-size:13px; }
        .su-cat { font-weight:800; color:#0f172a; background:#f1f5f9; padding:11px 10px; width:160px;
                  vertical-align:middle; line-height:1.5; white-space:normal; }
        .su-sub-g { color:#334155; font-weight:700; padding:11px 10px; width:190px; vertical-align:middle;
                    background:#f8fafc; line-height:1.5; white-space:normal; }
        .su-topic { padding:11px 12px; color:#0f172a; width:320px; line-height:1.55; white-space:normal; vertical-align:middle; }
        .su-info { padding:11px 10px; color:#334155; vertical-align:middle; white-space:normal; line-height:1.5; }
        .su-trainee { width:210px; font-size:11.5px; line-height:1.6; white-space:normal; vertical-align:middle; }
        .su-sr { text-align:center; font-weight:700; color:#0f172a; width:38px; vertical-align:middle; }
        .su-mhead { white-space:nowrap; }
        .su-wk { width:24px; text-align:center; color:#fff; font-weight:600; font-size:10px; padding:4px 0; }
        .su-cell { width:26px; text-align:center; vertical-align:middle; cursor:pointer; font-size:15px;
                   font-weight:800; user-select:none; }
        .su-cell:hover { background:${theme.soft}; }
        .su-mblock:nth-child(even) { background:rgba(0,0,0,.015); }
        .su-rem { min-width:150px; }
        .su-rem input { width:100%; border:none; background:transparent; padding:5px 6px; font-size:11.5px;
                        font-family:'Barlow',sans-serif; outline:none; }
        .su-rem input:focus { background:${theme.soft}; }
        .su-foot { display:flex; justify-content:space-between; padding:10px 16px; font-size:12px; color:#475569; flex-shrink:0; }

        .su-toast { position:fixed; bottom:26px; left:50%; transform:translateX(-50%);
                    background:#0f172a; color:#fff; padding:12px 22px; border-radius:10px;
                    font-size:13px; font-weight:600; z-index:300; box-shadow:0 8px 24px rgba(0,0,0,.25); }
      `}</style>

      <div className="su-root">
        <div className="su-top">
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <button className="su-back" onClick={() => nav("/skill-training")}>← Back</button>
            <div>
              <div className="su-title">Skill <span>Upgradation Plan</span></div>
              <div className="su-sub">Tooling Person · 2026-27</div>
            </div>
          </div>
          <div className="su-actions">
            <div className="su-legend">
              {SU_LEGEND.map((l) => (
                <span className="li" key={l.sym}>
                  <span style={{ color: l.sym === "○" ? MARK_COLOR[1] : MARK_COLOR[2], fontSize: 15 }}>{l.sym}</span>
                  {l.text}
                </span>
              ))}
            </div>
            <button className="su-save" onClick={save} disabled={!dirty}>💾 Save</button>
          </div>
        </div>

        <div className="su-body">
          <div className="su-card">
            <div className="su-head">
              <div className="su-company">{SU_COMPANY}</div>
              <div className="su-doc">{SU_TITLE}</div>
            </div>

            <div className="su-scroll">
              <table className="su-tbl">
                <thead>
                  <tr>
                    <th rowSpan={2} className="su-th-info">Sr.<br />No.</th>
                    <th rowSpan={2} className="su-th-info">Training</th>
                    <th rowSpan={2} className="su-th-info">Sub-Group</th>
                    <th rowSpan={2} className="su-th-info">Topics</th>
                    <th rowSpan={2} className="su-th-info">Trainee Person</th>
                    <th rowSpan={2} className="su-th-info">Skill Upgrade Target</th>
                    <th rowSpan={2} className="su-th-info">Time Duration</th>
                    <th rowSpan={2} className="su-th-info">Trainer / Responsibility</th>
                    {SU_MONTHS.map((mo) => (
                      <th key={mo} colSpan={4} className="su-mhead">{mo}</th>
                    ))}
                    <th rowSpan={2} className="su-th-info">Remarks</th>
                  </tr>
                  <tr>
                    {SU_MONTHS.map((mo) => WEEKS.map((w) => (
                      <th key={mo + w} className="su-wk">{w}</th>
                    )))}
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr><td colSpan={8 + SU_MONTHS.length * 4 + 1} style={{ textAlign: "center", padding: 30, color: "#64748b" }}>Loading…</td></tr>
                  )}
                  {!loading && meta.map((r) => (
                    <tr key={r.sr}>
                      <td className="su-sr">{r.sr}</td>
                      {r.catFirst && <td className="su-cat" rowSpan={r.catSpan}>{r.category}</td>}
                      {r.subFirst && <td className="su-sub-g" rowSpan={r.subSpan}>{r.subcat || "—"}</td>}
                      <td className="su-topic">{r.topic}</td>
                      {r.catFirst && <td className="su-info su-trainee" rowSpan={r.catSpan}>{r.trainee}</td>}
                      {r.catFirst && <td className="su-info" rowSpan={r.catSpan} style={{ textAlign: "center" }}>{r.target}</td>}
                      {r.catFirst && <td className="su-info" rowSpan={r.catSpan} style={{ textAlign: "center" }}>{r.duration}</td>}
                      {r.catFirst && <td className="su-info" rowSpan={r.catSpan} style={{ textAlign: "center" }}>{r.trainer}</td>}
                      {SU_MONTHS.map((mo, mi) => WEEKS.map((w, wi) => {
                        const wIdx = mi * 4 + wi;
                        const v = marks[`${r.sr}_${wIdx}`] || 0;
                        return (
                          <td key={wIdx} className={`su-cell${mi % 2 ? " su-mblock" : ""}`}
                            style={{ color: v ? MARK_COLOR[v] : "#cbd5e1" }}
                            onClick={() => cycle(r.sr, wIdx)}>
                            {v ? MARK[v] : ""}
                          </td>
                        );
                      }))}
                      <td className="su-rem">
                        <input value={remarks[r.sr] || ""} onChange={(e) => setRemark(r.sr, e.target.value)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="su-foot">
              <span>{SU_ROWS.length} training topics · {SU_MONTHS.length} months</span>
              <span>Click a week cell to mark ○ Due / ● Done.</span>
            </div>
          </div>
        </div>

        {toast && <div className="su-toast">{toast}</div>}
      </div>
    </>
  );
}
