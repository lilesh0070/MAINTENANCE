/* ───────────────────────────────────────────────────────────────────
 * QPRForm.jsx  —  CAPA → one QPR sheet (opened by "Start CAPA" / "View";
 *                  the standalone QPR register page was removed)
 * ───────────────────────────────────────────────────────────────────
 * Full "QUALITY PROBLEM REPORT (QPR)" sheet reproducing the reference
 * format.  Every field is fillable and the whole sheet saves to
 * /api/qpr/{id} (table maintenance_qpr) inside the JSONB payload.
 *
 * Routing: /maintenance-breakdown/qpr/:id
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const api = {
  async get(path, token) {
    const r = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
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

const PROBLEM_AT = [
  ["pd_assembly", "Assembly"], ["pd_sqa", "SQA"], ["pd_weld", "Weld Shop"],
  ["pd_customer", "Customer"], ["pd_maintenance", "Maintenance"], ["pd_store", "Store"],
  ["pd_logistics", "Logistics"], ["pd_npd", "NPD/Engg."], ["pd_others", "Others"],
];
const STOCK_LOCATIONS = [
  "Customer PDI", "Customer Assy line", "Customer Stores", "Transit to Customer",
  "Bonded", "Assembly", "Main Stores", "Receiving Stores", "Supplier", "Transit from Supplier",
];
const STD_ACTIVITIES = [
  "Control Plan", "PFMEA", "OS/WI", "MIS-P", "Poka Yoke List", "Drawings",
  "Process Check Sheet", "Master samples", "Horizontal deployment actions",
  "Risk Register ( System )", "Others, pl. specify", "PMC",
];

const arr = (n, mk) => Array.from({ length: n }, mk);
const emptyForm = () => ({
  location: "", qpr_date: "", reporting_time: "",
  // problem detected at — booleans default false
  // OEM / part details
  customer: "", product_name: "", product_no: "", part_name: "", part_no: "",
  model: "",
  rejected_batch_code: "", parts_given_analysis: "", qpr_raised_by: "", qpr_recd_by: "",
  is_repeated: "", dept_raising: "", dept_recd: "",
  qty_rejected: "", date_raising: "", sign_raising: "", date_recd: "", sign_recd: "",
  recommended_reply_date: "",
  reported_problem: "",
  // 5W2H
  w_what: "", w_where: "", w_when: "", w_who: "", w_why: "", w_how: "", w_howmuch: "",
  // containment
  defect_confirmation: "", sketch_img: "", interim_containment: "",
  notify_customer: "", notify_resp: "", notify_tgt_date: "", notify_imp_date: "",
  stock_sort: arr(10, () => ({ date: "", resp: "", qty: "", bcode: "", ok: "", ng: "", id_mark: "", remarks: "" })),
  analysis_start_date: "",
  // fishbone
  fb_man: "", fb_machine: "", fb_environment: "", fb_abnormality: "",
  fb_material: "", fb_method: "", fb_measurement: "",
  team_members: "",
  data_validation: arr(6, () => ({ cause: "", method: "", result: "", remarks: "" })),
  // root cause why-why
  occ_why: arr(6, () => ""),
  flow_why: arr(5, () => ""),
  flow_remarks: "",
  analysis_completion_date: "",
  ca_occurrence: arr(5, () => ({ cm: "", resp: "", tgt: "", impl: "", batch: "" })),
  ca_flowout: arr(5, () => ({ cm: "", resp: "", tgt: "", impl: "", batch: "" })),
  hd: arr(5, () => ({ action: "", resp: "", tgt: "", impl: "", remarks: "" })),
  eff: { qty: ["", "", ""], date: ["", "", ""], status: ["", "", ""], sign: ["", "", ""], remarks: "" },
  std_check: arr(12, () => ({ reviewed: "", revision_reqd: "", details: "", remarks: "" })),
  prepared: { name: "", date: "", sign: "" },
  verified: { name: "", date: "", sign: "" },
  approved: { name: "", date: "", sign: "" },
});

export default function QPRForm() {
  const { token, theme, user } = useAuth();
  const nav = useNavigate();
  const { id } = useParams();
  const [f, setF]       = useState(emptyForm());
  const [qprNo, setQprNo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [toast, setToast] = useState(null);
  const flash = (m) => { setToast(m); setTimeout(() => setToast(null), 2600); };

  const load = useCallback(() => {
    if (!token || !id) return;
    setLoading(true);
    api.get(`/api/qpr/${id}`, token)
      .then((rec) => {
        setQprNo(rec.qpr_no);
        setF({ ...emptyForm(), ...(rec.payload || {}) });
        setDirty(false);
      })
      .catch(() => flash("Could not load QPR"))
      .finally(() => setLoading(false));
  }, [token, id]);
  useEffect(() => { load(); }, [load]);

  // ── setters ────────────────────────────────────────────────────────
  const set = (k, v) => { setF((p) => ({ ...p, [k]: v })); setDirty(true); };
  const setRow = (key, i, col, v) =>
    setF((p) => { setDirty(true); return { ...p, [key]: p[key].map((r, j) => j === i ? { ...r, [col]: v } : r) }; });
  const setArrVal = (key, i, v) =>
    setF((p) => { setDirty(true); return { ...p, [key]: p[key].map((r, j) => j === i ? v : r) }; });
  const setObj = (key, sub, v) =>
    setF((p) => { setDirty(true); return { ...p, [key]: { ...p[key], [sub]: v } }; });
  const setEff = (band, i, v) =>
    setF((p) => { setDirty(true); return { ...p, eff: { ...p.eff, [band]: p.eff[band].map((x, j) => j === i ? v : x) } }; });

  const save = async () => {
    try {
      await api.put(`/api/qpr/${id}`, { title: `QPR No. ${qprNo}`, payload: f }, token);
      setDirty(false);
      flash("Saved ✓");
    } catch (e) { flash("Save failed: " + (e.message || "error")); }
  };

  const onImg = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1.5 * 1024 * 1024) { flash("Image too large (max 1.5 MB)"); return; }
    const reader = new FileReader();
    reader.onload = () => set("sketch_img", reader.result);
    reader.readAsDataURL(file);
  };

  // ── small field helpers ─────────────────────────────────────────────
  const T = (k, ph = "") => (
    <input className="qf-in" value={f[k] || ""} placeholder={ph} onChange={(e) => set(k, e.target.value)} />
  );
  const D = (k) => (
    <input className="qf-in qf-date" type="date" value={f[k] || ""} onChange={(e) => set(k, e.target.value)} />
  );
  const A = (k) => (
    <textarea className="qf-area" value={f[k] || ""} onChange={(e) => set(k, e.target.value)} />
  );
  const YN = (k) => (
    <span className="qf-yn">
      <label><input type="radio" checked={f[k] === "Yes"} onChange={() => set(k, "Yes")} /> Yes</label>
      <label><input type="radio" checked={f[k] === "No"} onChange={() => set(k, "No")} /> No</label>
    </span>
  );

  if (loading) return (
    <div style={{ padding: 60, fontFamily: "Barlow, sans-serif", color: "#64748b" }}>Loading QPR…</div>
  );

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700;800&display=swap');
        .qf-root { min-height:100vh; background:#e9eef3; font-family:'Barlow',sans-serif; padding-bottom:60px; }
        .qf-top { background:#fff; border-bottom:1px solid #e2e8f0; height:56px; padding:0 26px 0 96px;
                  display:flex; align-items:center; justify-content:space-between; position:sticky; top:0; z-index:60;
                  box-shadow:0 1px 3px rgba(0,0,0,.06); }
        .qf-top::after { content:''; position:absolute; bottom:0; left:0; right:0; height:2px; background:${theme.gradient}; }
        .qf-back { display:flex; align-items:center; gap:6px; font-size:13px; font-weight:700; color:#475569;
                   background:#f1f5f9; border:1px solid #e2e8f0; border-radius:8px; padding:7px 14px; cursor:pointer; }
        .qf-htitle { font-size:18px; font-weight:800; color:#0f172a; }
        .qf-htitle span { color:${theme.accent}; }
        .qf-save { display:inline-flex; align-items:center; gap:7px; border:none; cursor:pointer; background:${theme.accent};
                   color:#fff; border-radius:9px; padding:9px 18px; font-size:14px; font-weight:800;
                   font-family:'Barlow',sans-serif; box-shadow:0 4px 12px ${theme.soft}; }
        .qf-save:disabled { opacity:.55; cursor:default; box-shadow:none; }
        .qf-dirty { font-size:11px; font-weight:700; color:#b45309; margin-right:6px; }

        .qf-sheet { max-width:1120px; margin:18px auto 0; background:#fff; border:2px solid #1f2937;
                    box-shadow:0 4px 16px rgba(15,23,42,.10); }
        table.qf { width:100%; border-collapse:collapse; }
        .qf td, .qf th { border:1px solid #475569; padding:5px 8px; vertical-align:top; font-size:12.5px; color:#0f172a; }
        .qf-in { width:100%; border:none; border-bottom:1px solid #cbd5e1; background:transparent; outline:none;
                 font-size:12.5px; color:#1d4ed8; font-weight:600; font-family:'Barlow',sans-serif; padding:2px 2px; }
        .qf-in:focus { border-bottom-color:${theme.accent}; }
        .qf-date { color:#15803d; }
        .qf-area { width:100%; min-height:46px; border:none; outline:none; resize:vertical; background:transparent;
                   font-size:12.5px; color:#1d4ed8; font-weight:600; font-family:'Barlow',sans-serif; }
        .qf-lbl { font-weight:700; color:#0f172a; white-space:nowrap; }
        .qf-band { background:#f1f5f9; text-align:center; font-weight:800; color:#64748b; letter-spacing:.04em;
                   font-size:12px; text-transform:uppercase; padding:7px; }
        .qf-band-red { text-align:center; font-weight:800; color:#b91c1c; letter-spacing:.03em; font-size:13px; padding:7px; }
        .qf-note { font-style:italic; color:#64748b; font-size:11.5px; }
        .qf-center { text-align:center; }
        .qf-yn { display:inline-flex; gap:14px; align-items:center; font-size:12px; font-weight:600; }
        .qf-yn label { display:inline-flex; gap:4px; align-items:center; cursor:pointer; }
        .qf-chk { display:flex; align-items:center; gap:8px; font-weight:600; }
        .qf-company { font-size:14px; font-weight:800; }
        .qf-doc { font-size:17px; font-weight:800; text-align:center; }
        .qf-doc-sub { font-size:10.5px; font-style:italic; color:#9a3412; text-align:center; font-weight:600; }
        .qf-grid-lbl { font-weight:700; }
        .qf-img { max-width:180px; max-height:120px; border:1px solid #cbd5e1; border-radius:4px; display:block; margin-top:6px; }
        .qf-tbl-head th { background:#1e3a8a; color:#fff; font-weight:700; text-align:center; font-size:11.5px; }
        .qf-sn { text-align:center; font-weight:700; width:36px; }
        .qf-fixed { font-weight:700; }
        .qf-toast { position:fixed; bottom:26px; left:50%; transform:translateX(-50%); background:#0f172a; color:#fff;
                    padding:12px 22px; border-radius:10px; font-size:13px; font-weight:600; z-index:300;
                    box-shadow:0 8px 24px rgba(0,0,0,.25); }
      `}</style>

      <div className="qf-root">
        <div className="qf-top">
          <div style={{ display:"flex", alignItems:"center", gap:14 }}>
            <button className="qf-back" onClick={() => nav("/maintenance-capa")}>← Back</button>
            <div className="qf-htitle">Quality Problem Report · <span>QPR No. {qprNo}</span></div>
          </div>
          <div style={{ display:"flex", alignItems:"center" }}>
            {dirty && <span className="qf-dirty">Unsaved</span>}
            <button className="qf-save" onClick={save} disabled={!dirty}>💾 Save</button>
          </div>
        </div>

        <div className="qf-sheet">
          <table className="qf">
            <tbody>
              {/* ── Header ──────────────────────────────────────── */}
              <tr>
                <td colSpan={3} style={{ width:"60%" }}>
                  <div className="qf-company">TOYOTA BOSHOKU DEVICE INDIA PRIVATE LIMITED</div>
                  <div className="qf-doc">QUALITY PROBLEM REPORT (QPR)</div>
                  <div className="qf-doc-sub">ORIGINAL : TO KEEP IN RECORD WHO IS RAISING QPR</div>
                  <div style={{ marginTop:10 }}><span className="qf-lbl">Location- </span>{T("location")}</div>
                </td>
                <td style={{ width:"16%" }} className="qf-lbl">QPR Date :-</td>
                <td colSpan={2}>{D("qpr_date")}</td>
              </tr>
              <tr style={{ display:"none" }}><td /></tr>
            </tbody>
          </table>

          {/* second header block (Reporting time / QPR No) aligned right */}
          <table className="qf"><tbody>
            <tr>
              <td style={{ width:"60%", borderTop:"none" }} rowSpan={2} className="qf-note">
                (To be filled by the Department who is raising the QPR)
              </td>
              <td style={{ width:"16%" }} className="qf-lbl">Reporting Time :</td>
              <td colSpan={2}>{T("reporting_time", "HH : MM AM/PM")}</td>
            </tr>
            <tr>
              <td className="qf-lbl">QPR No. :</td>
              <td colSpan={2}><b style={{ color: theme.accent }}>QPR- {qprNo}</b></td>
            </tr>
            <tr>
              <td className="qf-band-red" style={{ background:"#fff" }}></td>
              <td colSpan={3} className="qf-band-red">PROBLEM DETECTED AT :-</td>
            </tr>
          </tbody></table>

          {/* ── Problem detected at — 3×3 checkboxes ───────────── */}
          <table className="qf"><tbody>
            {[0, 3, 6].map((base) => (
              <tr key={base}>
                {[0, 1, 2].map((c) => {
                  const [k, label] = PROBLEM_AT[base + c];
                  return (
                    <td key={k} style={{ width:"33.3%" }}>
                      <label className="qf-chk">
                        <input type="checkbox" checked={!!f[k]} onChange={(e) => set(k, e.target.checked)} />
                        {label}
                      </label>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody></table>

          {/* ── Timeline + record note ─────────────────────────── */}
          <table className="qf"><tbody>
            <tr>
              <td style={{ width:"22%" }} className="qf-band">Timeline for action</td>
              <td className="qf-center" style={{ fontWeight:800 }}>
                RECORD THE FOLLOWING DETAILS &amp; DISTRIBUTE QPR THROUGH MAIL / HARD COPY
              </td>
            </tr>
          </tbody></table>

          {/* ── OEM / Assembly / Child part details ─────────────── */}
          <table className="qf"><tbody>
            <tr>
              <th className="qf-center" style={{ width:"24%", background:"#f8fafc" }}>OEM</th>
              <th className="qf-center" colSpan={2} style={{ background:"#f8fafc" }}>TBDI Assembly Part Details:-</th>
              <th className="qf-center" colSpan={2} style={{ background:"#f8fafc" }}>TBDI Child Part Details:-</th>
            </tr>
            <tr>
              <td><span className="qf-lbl">Customer:- </span>{T("customer")}</td>
              <td><span className="qf-lbl">Product Name:- </span>{T("product_name")}</td>
              <td><span className="qf-lbl">Product No.:- </span>{T("product_no")}</td>
              <td><span className="qf-lbl">Part Name:- </span>{T("part_name")}</td>
              <td><span className="qf-lbl">Part No.:- </span>{T("part_no")}</td>
            </tr>
            <tr>
              <td><span className="qf-lbl">Model:- </span>{T("model")}</td>
              <td colSpan={2}></td>
              <td colSpan={2}></td>
            </tr>
            <tr>
              <td><span className="qf-lbl">Rejected part/s Batch Code:- </span>{T("rejected_batch_code")}</td>
              <td><span className="qf-lbl">Part/s given for analysis :-</span><br />{YN("parts_given_analysis")}</td>
              <td><span className="qf-lbl">QPR Raised by:- </span>{T("qpr_raised_by")}</td>
              <td colSpan={2}><span className="qf-lbl">QPR Recd. By:- </span>{T("qpr_recd_by")}</td>
            </tr>
            <tr>
              <td><span className="qf-lbl">Is it a Repeated Problem:-</span><br />{YN("is_repeated")}</td>
              <td colSpan={2}><span className="qf-lbl">Department:- </span>{T("dept_raising")}</td>
              <td colSpan={2}><span className="qf-lbl">Department:- </span>{T("dept_recd")}</td>
            </tr>
            <tr>
              <td><span className="qf-lbl">Qty. Rejected (How many):- </span>{T("qty_rejected")}</td>
              <td colSpan={2}>
                <span className="qf-lbl">Date:- </span>{D("date_raising")}
                <div style={{ marginTop:4 }}><span className="qf-lbl">Sign.:- </span>{T("sign_raising")}</div>
              </td>
              <td colSpan={2}>
                <span className="qf-lbl">Date:- </span>{D("date_recd")}
                <div style={{ marginTop:4 }}><span className="qf-lbl">Sign.:- </span>{T("sign_recd")}</div>
              </td>
            </tr>
            <tr>
              <td colSpan={3} style={{ border:"none" }}></td>
              <td colSpan={2}><span className="qf-lbl">Recommended Reply Date:- </span>{D("recommended_reply_date")}</td>
            </tr>
          </tbody></table>

          {/* ── Reported problem ───────────────────────────────── */}
          <table className="qf"><tbody>
            <tr><td><span className="qf-lbl">Reported Problem :-</span>{A("reported_problem")}</td></tr>
          </tbody></table>

          {/* ── 5W2H ───────────────────────────────────────────── */}
          <table className="qf"><tbody>
            <tr><td colSpan={2} className="qf-band-red">DEFINED PROBLEM (THROUGH 5W2H) :-</td></tr>
            <tr>
              <td style={{ width:"50%" }}><span className="qf-lbl">What? </span>{T("w_what")}</td>
              <td><span className="qf-lbl">Where? </span>{T("w_where")}</td>
            </tr>
            <tr>
              <td><span className="qf-lbl">When? </span>{T("w_when")}</td>
              <td><span className="qf-lbl">Who? </span>{T("w_who")}</td>
            </tr>
            <tr>
              <td><span className="qf-lbl">Why? </span>{T("w_why")}</td>
              <td><span className="qf-lbl">How? </span>{T("w_how")}</td>
            </tr>
            <tr>
              <td><span className="qf-lbl">How Much? </span>{T("w_howmuch")}</td>
              <td></td>
            </tr>
          </tbody></table>

          {/* ── Containment ────────────────────────────────────── */}
          <table className="qf"><tbody>
            <tr><td colSpan={2} className="qf-band">Containment action is to be taken within 3 hours of problem reported</td></tr>
            <tr><td colSpan={2} className="qf-note">Below fields to be filled by the Department receiving the QPR</td></tr>
            <tr>
              <td style={{ width:"50%" }}><span className="qf-lbl">Defect Confirmation (HOW) :-</span>{A("defect_confirmation")}</td>
              <td>
                <span className="qf-lbl">Sketch / Photograph (Recd. Part with Observations)</span>
                <input type="file" accept="image/*" onChange={onImg} style={{ display:"block", marginTop:6, fontSize:11 }} />
                {f.sketch_img
                  ? <img className="qf-img" src={f.sketch_img} alt="sketch" />
                  : <div className="qf-note" style={{ marginTop:6 }}>No image uploaded</div>}
              </td>
            </tr>
            <tr><td colSpan={2}><span className="qf-lbl">Interim Containment Action :</span>{A("interim_containment")}</td></tr>
            <tr>
              <td colSpan={2}>
                <table style={{ width:"100%", borderCollapse:"collapse" }}><tbody><tr>
                  <td style={{ width:"32%", border:"none" }}>
                    <span className="qf-lbl">Notification to Customer (Internal/External) required ( Please Tick ):-</span><br />{YN("notify_customer")}
                  </td>
                  <td style={{ width:"28%", border:"none" }}><span className="qf-lbl">If Yes, Resp.:- </span>{T("notify_resp")}</td>
                  <td style={{ width:"20%", border:"none" }}><span className="qf-lbl">Tgt. Date:- </span>{D("notify_tgt_date")}</td>
                  <td style={{ width:"20%", border:"none" }}><span className="qf-lbl">Imp. Date:- </span>{D("notify_imp_date")}</td>
                </tr></tbody></table>
              </td>
            </tr>
          </tbody></table>

          {/* ── Stock sort ─────────────────────────────────────── */}
          <table className="qf"><tbody>
            <tr><td colSpan={10} className="qf-band">Stock sort details as below: (to be initiated within 3 hrs of problem receiving)</td></tr>
            <tr className="qf-tbl-head">
              <th>S.No</th><th>Parts Checked Location</th><th>Date</th><th>Resp.</th><th>Qty. Checked</th>
              <th>B'Code</th><th>O.K</th><th>N.G</th><th>Identification Mark</th><th>Remarks</th>
            </tr>
            {f.stock_sort.map((r, i) => (
              <tr key={i}>
                <td className="qf-sn">{i + 1}</td>
                <td className="qf-fixed">{STOCK_LOCATIONS[i]}</td>
                <td>{<input className="qf-in qf-date" type="date" value={r.date} onChange={(e) => setRow("stock_sort", i, "date", e.target.value)} />}</td>
                <td><input className="qf-in" value={r.resp} onChange={(e) => setRow("stock_sort", i, "resp", e.target.value)} /></td>
                <td><input className="qf-in" value={r.qty} onChange={(e) => setRow("stock_sort", i, "qty", e.target.value)} /></td>
                <td><input className="qf-in" value={r.bcode} onChange={(e) => setRow("stock_sort", i, "bcode", e.target.value)} /></td>
                <td><input className="qf-in" value={r.ok} onChange={(e) => setRow("stock_sort", i, "ok", e.target.value)} /></td>
                <td><input className="qf-in" value={r.ng} onChange={(e) => setRow("stock_sort", i, "ng", e.target.value)} /></td>
                <td><input className="qf-in" value={r.id_mark} onChange={(e) => setRow("stock_sort", i, "id_mark", e.target.value)} /></td>
                <td><input className="qf-in" value={r.remarks} onChange={(e) => setRow("stock_sort", i, "remarks", e.target.value)} /></td>
              </tr>
            ))}
          </tbody></table>

          {/* ── Corrective action / analysis start ─────────────── */}
          <table className="qf"><tbody>
            <tr><td colSpan={2} className="qf-band">Corrective action is to be taken within 3 days of problem reported</td></tr>
            <tr><td style={{ width:"30%" }} className="qf-lbl">Analysis Start Date:-</td><td>{D("analysis_start_date")}</td></tr>
          </tbody></table>

          {/* ── Fishbone ───────────────────────────────────────── */}
          <table className="qf"><tbody>
            <tr><td colSpan={4} className="qf-band-red">DATA ANALYSIS (USING FISH BONE DIAGRAM APPROACH)</td></tr>
            <tr>
              <th className="qf-center">Man</th><th className="qf-center">Machine</th>
              <th className="qf-center">Environment</th><th className="qf-center">Abnormality Handling</th>
            </tr>
            <tr>
              <td>{A("fb_man")}</td><td>{A("fb_machine")}</td><td>{A("fb_environment")}</td><td>{A("fb_abnormality")}</td>
            </tr>
            <tr>
              <th className="qf-center">Material</th><th className="qf-center">Method</th>
              <th className="qf-center">Measurement</th><th></th>
            </tr>
            <tr>
              <td>{A("fb_material")}</td><td>{A("fb_method")}</td><td>{A("fb_measurement")}</td><td></td>
            </tr>
            <tr><td colSpan={4}><span className="qf-lbl">Team members Involved : </span>{T("team_members")}</td></tr>
            <tr><td colSpan={4} className="qf-note">* Use Ranking Methodology to prioritize the possible causes (See Annexure-A)</td></tr>
          </tbody></table>

          {/* ── Data validation ────────────────────────────────── */}
          <table className="qf"><tbody>
            <tr><td colSpan={5} className="qf-band-red">DATA VALIDATION</td></tr>
            <tr className="qf-tbl-head">
              <th>Sr. No</th><th>Possible cause</th>
              <th>Verification method (Gemba / Inspection / Statistical test / Experiment)</th>
              <th>Result</th><th>Remarks</th>
            </tr>
            {f.data_validation.map((r, i) => (
              <tr key={i}>
                <td className="qf-sn">{i + 1}</td>
                <td><input className="qf-in" value={r.cause} onChange={(e) => setRow("data_validation", i, "cause", e.target.value)} /></td>
                <td><input className="qf-in" value={r.method} onChange={(e) => setRow("data_validation", i, "method", e.target.value)} /></td>
                <td><input className="qf-in" value={r.result} onChange={(e) => setRow("data_validation", i, "result", e.target.value)} /></td>
                <td><input className="qf-in" value={r.remarks} onChange={(e) => setRow("data_validation", i, "remarks", e.target.value)} /></td>
              </tr>
            ))}
          </tbody></table>

          {/* ── Root cause why-why ─────────────────────────────── */}
          <table className="qf"><tbody>
            <tr><td colSpan={7} className="qf-band-red">ROOT CAUSE (USING WHY-WHY APPROACH)</td></tr>
            <tr>
              <th style={{ width:"14%" }}></th>
              <th className="qf-center">1st Why</th><th className="qf-center">2nd Why</th><th className="qf-center">3rd Why</th>
              <th className="qf-center">4th Why</th><th className="qf-center">5th Why</th><th className="qf-center">6th Why</th>
            </tr>
            <tr>
              <td className="qf-lbl">For Occurrence</td>
              {f.occ_why.map((v, i) => (
                <td key={i}><textarea className="qf-area" value={v} onChange={(e) => setArrVal("occ_why", i, e.target.value)} /></td>
              ))}
            </tr>
            <tr>
              <th></th>
              <th className="qf-center">1st Why</th><th className="qf-center">2nd Why</th><th className="qf-center">3rd Why</th>
              <th className="qf-center">4th Why</th><th className="qf-center">5th Why</th><th className="qf-center">Remarks</th>
            </tr>
            <tr>
              <td className="qf-lbl">For Flow Out</td>
              {f.flow_why.map((v, i) => (
                <td key={i}><textarea className="qf-area" value={v} onChange={(e) => setArrVal("flow_why", i, e.target.value)} /></td>
              ))}
              <td>{A("flow_remarks")}</td>
            </tr>
            <tr><td className="qf-lbl">Analysis Completion Date:-</td><td colSpan={6}>{D("analysis_completion_date")}</td></tr>
          </tbody></table>

          {/* ── Countermeasure occurrence ──────────────────────── */}
          <table className="qf"><tbody>
            <tr><td colSpan={6} className="qf-band">Countermeasure (C/M) taken</td></tr>
            <tr><td colSpan={6} className="qf-band-red">CORRECTIVE ACTION — FOR OCCURRENCE</td></tr>
            <tr className="qf-tbl-head">
              <th>S.No</th><th>Countermeasures</th><th>Resp.</th><th>Tgt. Date</th><th>Impl Dt</th><th>Effective Batch Code</th>
            </tr>
            {f.ca_occurrence.map((r, i) => (
              <tr key={i}>
                <td className="qf-sn">{i + 1}</td>
                <td><input className="qf-in" value={r.cm} onChange={(e) => setRow("ca_occurrence", i, "cm", e.target.value)} /></td>
                <td><input className="qf-in" value={r.resp} onChange={(e) => setRow("ca_occurrence", i, "resp", e.target.value)} /></td>
                <td><input className="qf-in qf-date" type="date" value={r.tgt} onChange={(e) => setRow("ca_occurrence", i, "tgt", e.target.value)} /></td>
                <td><input className="qf-in qf-date" type="date" value={r.impl} onChange={(e) => setRow("ca_occurrence", i, "impl", e.target.value)} /></td>
                <td><input className="qf-in" value={r.batch} onChange={(e) => setRow("ca_occurrence", i, "batch", e.target.value)} /></td>
              </tr>
            ))}
            <tr><td colSpan={6} className="qf-band-red">CORRECTIVE ACTION — FOR FLOW OUT</td></tr>
            <tr className="qf-tbl-head">
              <th>S.No</th><th>Countermeasures</th><th>Resp.</th><th>Tgt. Date</th><th>Impl Dt</th><th>Effective Batch Code</th>
            </tr>
            {f.ca_flowout.map((r, i) => (
              <tr key={i}>
                <td className="qf-sn">{i + 1}</td>
                <td><input className="qf-in" value={r.cm} onChange={(e) => setRow("ca_flowout", i, "cm", e.target.value)} /></td>
                <td><input className="qf-in" value={r.resp} onChange={(e) => setRow("ca_flowout", i, "resp", e.target.value)} /></td>
                <td><input className="qf-in qf-date" type="date" value={r.tgt} onChange={(e) => setRow("ca_flowout", i, "tgt", e.target.value)} /></td>
                <td><input className="qf-in qf-date" type="date" value={r.impl} onChange={(e) => setRow("ca_flowout", i, "impl", e.target.value)} /></td>
                <td><input className="qf-in" value={r.batch} onChange={(e) => setRow("ca_flowout", i, "batch", e.target.value)} /></td>
              </tr>
            ))}
          </tbody></table>

          {/* ── Horizontal deployment ──────────────────────────── */}
          <table className="qf"><tbody>
            <tr><td colSpan={6} className="qf-band">Standardization / horizontal deployment is to be done within 3 weeks of problem reported</td></tr>
            <tr className="qf-tbl-head">
              <th>S.No</th><th>Action Taken for Horizontal Deployment</th><th>Resp.</th><th>Tgt. Date</th><th>Impl Dt</th><th>Remarks</th>
            </tr>
            {f.hd.map((r, i) => (
              <tr key={i}>
                <td className="qf-sn">{i + 1}</td>
                <td><input className="qf-in" value={r.action} onChange={(e) => setRow("hd", i, "action", e.target.value)} /></td>
                <td><input className="qf-in" value={r.resp} onChange={(e) => setRow("hd", i, "resp", e.target.value)} /></td>
                <td><input className="qf-in qf-date" type="date" value={r.tgt} onChange={(e) => setRow("hd", i, "tgt", e.target.value)} /></td>
                <td><input className="qf-in qf-date" type="date" value={r.impl} onChange={(e) => setRow("hd", i, "impl", e.target.value)} /></td>
                <td><input className="qf-in" value={r.remarks} onChange={(e) => setRow("hd", i, "remarks", e.target.value)} /></td>
              </tr>
            ))}
          </tbody></table>

          {/* ── Effectiveness check ────────────────────────────── */}
          <table className="qf"><tbody>
            <tr><td colSpan={5} className="qf-band">Countermeasures effectiveness check</td></tr>
            <tr className="qf-tbl-head">
              <th style={{ width:"18%" }}></th><th>WK1</th><th>WK2</th><th>WK3</th><th style={{ width:"22%" }}>Remarks</th>
            </tr>
            {[["qty", "Qty"], ["date", "DATE"], ["status", "STATUS"], ["sign", "SIGN."]].map(([band, label], ri) => (
              <tr key={band}>
                <td className="qf-lbl">{label}</td>
                {[0, 1, 2].map((i) => (
                  <td key={i}>
                    {band === "date"
                      ? <input className="qf-in qf-date" type="date" value={f.eff.date[i]} onChange={(e) => setEff("date", i, e.target.value)} />
                      : <input className="qf-in" value={f.eff[band][i]} onChange={(e) => setEff(band, i, e.target.value)} />}
                  </td>
                ))}
                {ri === 0 && (
                  <td rowSpan={4} style={{ verticalAlign:"middle" }}>
                    <textarea className="qf-area" value={f.eff.remarks}
                              onChange={(e) => setObj("eff", "remarks", e.target.value)} />
                  </td>
                )}
              </tr>
            ))}
          </tbody></table>

          {/* ── Standardization check ──────────────────────────── */}
          <table className="qf"><tbody>
            <tr><td colSpan={6} className="qf-band">Standardization check</td></tr>
            <tr className="qf-tbl-head">
              <th>S.No</th><th>Activities</th><th>Reviewed (Yes/No)</th><th>Revision Reqd. (Yes/No)</th>
              <th>Revision Details</th><th>Remarks</th>
            </tr>
            {f.std_check.map((r, i) => (
              <tr key={i}>
                <td className="qf-sn">{i + 1}</td>
                <td className="qf-fixed">{STD_ACTIVITIES[i]}</td>
                <td className="qf-center">
                  <span className="qf-yn">
                    <label><input type="radio" checked={r.reviewed === "Yes"} onChange={() => setRow("std_check", i, "reviewed", "Yes")} /> Yes</label>
                    <label><input type="radio" checked={r.reviewed === "No"} onChange={() => setRow("std_check", i, "reviewed", "No")} /> No</label>
                  </span>
                </td>
                <td className="qf-center">
                  <span className="qf-yn">
                    <label><input type="radio" checked={r.revision_reqd === "Yes"} onChange={() => setRow("std_check", i, "revision_reqd", "Yes")} /> Yes</label>
                    <label><input type="radio" checked={r.revision_reqd === "No"} onChange={() => setRow("std_check", i, "revision_reqd", "No")} /> No</label>
                  </span>
                </td>
                <td><input className="qf-in" value={r.details} onChange={(e) => setRow("std_check", i, "details", e.target.value)} /></td>
                <td><input className="qf-in" value={r.remarks} onChange={(e) => setRow("std_check", i, "remarks", e.target.value)} /></td>
              </tr>
            ))}
          </tbody></table>

          {/* ── Sign-off ───────────────────────────────────────── */}
          <table className="qf"><tbody>
            <tr>
              <th className="qf-center" colSpan={2} style={{ background:"#f8fafc" }}>Prepared By:-</th>
              <th className="qf-center" colSpan={2} style={{ background:"#f8fafc" }}>Verified By:-</th>
              <th className="qf-center" colSpan={2} style={{ background:"#f8fafc" }}>Approved By:- (Internal Customer)</th>
            </tr>
            {[["name", "Name:-"], ["date", "Date:-"], ["sign", "Sign:-"]].map(([sub, label]) => (
              <tr key={sub}>
                <td className="qf-lbl" style={{ width:"10%" }}>{label}</td>
                <td>{sub === "date"
                  ? <input className="qf-in qf-date" type="date" value={f.prepared.date} onChange={(e) => setObj("prepared", "date", e.target.value)} />
                  : <input className="qf-in" value={f.prepared[sub]} onChange={(e) => setObj("prepared", sub, e.target.value)} />}</td>
                <td className="qf-lbl" style={{ width:"10%" }}>{label}</td>
                <td>{sub === "date"
                  ? <input className="qf-in qf-date" type="date" value={f.verified.date} onChange={(e) => setObj("verified", "date", e.target.value)} />
                  : <input className="qf-in" value={f.verified[sub]} onChange={(e) => setObj("verified", sub, e.target.value)} />}</td>
                <td className="qf-lbl" style={{ width:"10%" }}>{label}</td>
                <td>{sub === "date"
                  ? <input className="qf-in qf-date" type="date" value={f.approved.date} onChange={(e) => setObj("approved", "date", e.target.value)} />
                  : <input className="qf-in" value={f.approved[sub]} onChange={(e) => setObj("approved", sub, e.target.value)} />}</td>
              </tr>
            ))}
          </tbody></table>
        </div>
      </div>

      {toast && <div className="qf-toast">{toast}</div>}
    </>
  );
}
