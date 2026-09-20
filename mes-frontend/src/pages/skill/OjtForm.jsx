/* ───────────────────────────────────────────────────────────────────
 * skill/OjtForm.jsx — "ON JOB TRAINING" (TBDI / HR / F / 014) ka FORM.
 * ───────────────────────────────────────────────────────────────────
 * Pehle ye poora markup + CSS `OJT.jsx` ke andar tha.  2026-09-20 se CAPA me
 * bhi OJT form jud sakta hai (user: "OJT form attach karke usko fill kar
 * ske"), isliye form yahan alag kar diya -- DmcSheet / FormatSheet ki tarah
 * EK hi jagah.  Layout kahin badla to dono jagah ek jaisa dikhega.
 *
 * Props:
 *   value     — { training_subjects, duration, trainer, date_of_training,
 *                 rows:[{emp_code, emp_name, dept_area, signature}],
 *                 details, trainer_signature }
 *   onChange  — (nayaValue) => void     (readOnly me zaroorat nahi)
 *   readOnly  — sirf dikhana (CAPA ka "sirf dekhne" wala parda)
 *   actions   — head ke daayein kuch (Save button / "Unsaved" patti)
 *   accent/soft — theme ke rang (page se aate hain)
 * ─────────────────────────────────────────────────────────────────── */

export const ojtRow = () => ({ emp_code: "", emp_name: "", dept_area: "", signature: "" });

export const ojtBlank = () => ({
  training_subjects: "", duration: "", trainer: "", date_of_training: "",
  rows: [ojtRow(), ojtRow(), ojtRow(), ojtRow(), ojtRow()],
  details: "", trainer_signature: "",
});

/** Bhara hua kuch hai ya form khali hi pada hai? */
export const ojtBhara = (v) => {
  if (!v) return false;
  if ((v.training_subjects || v.duration || v.trainer || v.date_of_training
       || v.details || v.trainer_signature || "").trim?.()) return true;
  return (v.rows || []).some((r) => (r.emp_code || r.emp_name || r.dept_area || r.signature || "").trim());
};

export function OjtForm({ value, onChange = null, readOnly = false, actions = null,
                          accent = "#1d4ed8", soft = "#eff6ff" }) {
  const v = { ...ojtBlank(), ...(value || {}) };
  const rows = Array.isArray(v.rows) && v.rows.length ? v.rows : [ojtRow()];
  const patch = (k, x) => onChange && onChange({ ...v, [k]: x });
  const patchRow = (ri, k, x) =>
    onChange && onChange({ ...v, rows: rows.map((r, j) => (j === ri ? { ...r, [k]: x } : r)) });
  const addRow = () => onChange && onChange({ ...v, rows: [...rows, ojtRow()] });
  const delRow = (ri) => {
    if (!onChange) return;
    const left = rows.filter((_, j) => j !== ri);
    onChange({ ...v, rows: left.length ? left : [ojtRow()] });
  };

  return (
    <>
      <style>{`
        .oj-card { border:1px solid #cbd5e1; border-radius:6px; overflow:hidden; margin:0; background:#fff; }
        .oj-head { position:relative; border-bottom:1px solid #cbd5e1; padding:14px 18px; text-align:center; }
        .oj-company { font-size:16px; font-weight:800; color:#0f172a; }
        .oj-doc { font-size:13px; font-weight:700; color:#1e293b; margin-top:3px; letter-spacing:.06em; }
        .oj-card-actions { position:absolute; top:12px; right:14px; display:flex; gap:8px; align-items:center; }
        .oj-btn { display:inline-flex; align-items:center; gap:6px; border-radius:8px; cursor:pointer; font-size:12px; font-weight:700; padding:8px 14px; font-family:'Barlow',sans-serif; }
        .oj-btn-save { border:1.5px solid ${accent}; background:${accent}; color:#fff; }
        .oj-btn-save:disabled { opacity:.5; cursor:default; }
        .oj-dirty { font-size:11px; font-weight:700; color:#b45309; }

        .oj-fields { padding:16px 22px 6px; }
        .oj-frow { display:grid; grid-template-columns:1fr 1fr; gap:0 40px; }
        .oj-field { display:flex; align-items:flex-end; gap:10px; padding:8px 0; }
        .oj-flabel { font-size:11.5px; font-weight:800; color:#334155; letter-spacing:.04em; text-transform:uppercase; white-space:nowrap; padding-bottom:5px; min-width:120px; }
        .oj-finput { flex:1; border:none; border-bottom:1px solid #94a3b8; background:transparent; font-size:14px; color:#0f172a; padding:5px 2px; font-family:'Barlow',sans-serif; outline:none; }
        .oj-finput:focus { border-bottom-color:${accent}; }
        .oj-finput:disabled { color:#0f172a; -webkit-text-fill-color:#0f172a; opacity:1; }

        .oj-tbl-wrap { padding:8px 22px 4px; }
        .oj-tbl { width:100%; border-collapse:collapse; }
        .oj-tbl th { background:#eef2f7; border:1px solid #cbd5e1; font-size:11.5px; font-weight:800; color:#1e293b; padding:8px; text-transform:uppercase; }
        .oj-tbl td { border:1px solid #cbd5e1; padding:0; }
        .oj-tbl td.sno { text-align:center; font-weight:800; color:#0f172a; width:48px; padding:6px; }
        .oj-cell-input { width:100%; box-sizing:border-box; border:none; background:transparent; padding:9px 10px; font-size:13.5px; color:#0f172a; font-family:'Barlow',sans-serif; outline:none; }
        .oj-cell-input:focus { background:${soft}; }
        .oj-cell-input:disabled { color:#0f172a; -webkit-text-fill-color:#0f172a; opacity:1; }
        .oj-rowdel { width:42px; text-align:center; }
        .oj-rowdel button { border:none; background:transparent; cursor:pointer; color:#dc2626; font-size:15px; padding:6px; }
        .oj-addrow { margin:12px 0 4px; display:inline-flex; align-items:center; gap:7px; border:1px solid #cbd5e1; background:#f8fafc; border-radius:8px;
                     cursor:pointer; font-size:13px; font-weight:700; color:#334155; padding:8px 15px; font-family:'Barlow',sans-serif; }
        .oj-foot { padding:6px 22px 18px; }
        .oj-foot-label { font-size:11.5px; font-weight:800; color:#334155; letter-spacing:.04em; text-transform:uppercase; margin:10px 0 6px; }
        .oj-textarea { width:100%; box-sizing:border-box; min-height:90px; border:1px solid #94a3b8; border-radius:6px; padding:10px 12px; font-size:14px; color:#0f172a; resize:vertical; font-family:'Barlow',sans-serif; outline:none; }
        .oj-textarea:disabled { color:#0f172a; -webkit-text-fill-color:#0f172a; opacity:1; background:#fff; }
        .oj-sig { display:flex; align-items:flex-end; gap:10px; margin-top:14px; }
        .oj-format { border-top:1px solid #e2e8f0; margin-top:14px; padding-top:8px; text-align:right; font-size:11px; color:#64748b; }
        /* patli screen (phone / CAPA ka parda): do khaane ki jagah ek */
        @media (max-width: 760px) { .oj-frow { grid-template-columns:1fr; gap:0; } }
      `}</style>

      <div className="oj-card">
        <div className="oj-head">
          <div className="oj-company">TOYOTA BOSHOKU DEVICE INDIA PVT. LTD.</div>
          <div className="oj-doc">ON JOB TRAINING</div>
          {actions && <div className="oj-card-actions">{actions}</div>}
        </div>

        <div className="oj-fields">
          <div className="oj-frow">
            <div className="oj-field"><span className="oj-flabel">Training Subjects</span>
              <input className="oj-finput" disabled={readOnly} value={v.training_subjects}
                     onChange={(e) => patch("training_subjects", e.target.value)} /></div>
            <div className="oj-field"><span className="oj-flabel">Duration</span>
              <input className="oj-finput" disabled={readOnly} value={v.duration}
                     onChange={(e) => patch("duration", e.target.value)} /></div>
            <div className="oj-field"><span className="oj-flabel">Trainer</span>
              <input className="oj-finput" disabled={readOnly} value={v.trainer}
                     onChange={(e) => patch("trainer", e.target.value)} /></div>
            <div className="oj-field"><span className="oj-flabel">Date of Training</span>
              <input className="oj-finput" type="date" disabled={readOnly} value={v.date_of_training}
                     onChange={(e) => patch("date_of_training", e.target.value)} /></div>
          </div>
        </div>

        <div className="oj-tbl-wrap">
          <table className="oj-tbl">
            <thead>
              <tr><th style={{ width:48 }}>S.No</th><th style={{ width:160 }}>Employee Code No.</th><th>Employee Name</th>
                <th>Department / Area</th><th>Signature</th>{!readOnly && <th style={{ width:42 }}></th>}</tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri}>
                  <td className="sno">{ri + 1}</td>
                  <td><input className="oj-cell-input" disabled={readOnly} value={row.emp_code}
                             onChange={(e) => patchRow(ri, "emp_code", e.target.value)} /></td>
                  <td><input className="oj-cell-input" disabled={readOnly} value={row.emp_name}
                             onChange={(e) => patchRow(ri, "emp_name", e.target.value)} /></td>
                  <td><input className="oj-cell-input" disabled={readOnly} value={row.dept_area}
                             onChange={(e) => patchRow(ri, "dept_area", e.target.value)} /></td>
                  <td><input className="oj-cell-input" disabled={readOnly} value={row.signature}
                             onChange={(e) => patchRow(ri, "signature", e.target.value)} /></td>
                  {!readOnly && (
                    <td className="oj-rowdel"><button title="Remove row" onClick={() => delRow(ri)}>🗑</button></td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {!readOnly && <button className="oj-addrow" onClick={addRow}>+ Add Row</button>}
        </div>

        <div className="oj-foot">
          <div className="oj-foot-label">Details of Given Training :-</div>
          <textarea className="oj-textarea" disabled={readOnly} value={v.details}
                    onChange={(e) => patch("details", e.target.value)} />
          <div className="oj-sig"><span className="oj-flabel">Signature of Trainer</span>
            <input className="oj-finput" disabled={readOnly} value={v.trainer_signature}
                   onChange={(e) => patch("trainer_signature", e.target.value)} /></div>
          <div className="oj-format">FORMAT NO.: TBDI / HR / F / 014, REV. NO.: 00, REV. DATE: 20/03/2024</div>
        </div>
      </div>
    </>
  );
}
