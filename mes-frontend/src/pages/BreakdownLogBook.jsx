/* ───────────────────────────────────────────────────────────────────
 * BreakdownLogBook.jsx  —  Maintenance Log Book (rebuilt 2026-07-07)
 * ───────────────────────────────────────────────────────────────────
 * Physical TBDI/MAINT log-book format with the requested changes:
 *   • Zone → Line → Machine No  (from the Machine Master, maintenance_machines);
 *     Machine Name auto-fills from Machine No.
 *   • Serial No is AUTO-GENERATED on save (running number).
 *   • "Problem Reported / Found"  →  "Problem Observed by Maintenance".
 *   • Spare split: Spare Name · Model Number · Spare ERP Number · Quantity.
 * Fill the form, then "Save Entry" → POST /api/logbook.
 * Routing: /maintenance-logbook
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
    const r = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
    return r.json();
  },
  async del(path, token) {
    const r = await fetch(path, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
    return r.json();
  },
};

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// "HH:MM" pair → minutes between them (wraps past midnight).
function diffMinutes(start, ok) {
  if (!start || !ok) return "";
  const [sh, sm] = start.split(":").map(Number);
  const [oh, om] = ok.split(":").map(Number);
  if ([sh, sm, oh, om].some((n) => Number.isNaN(n))) return "";
  let d = (oh * 60 + om) - (sh * 60 + sm);
  if (d < 0) d += 24 * 60;
  return String(d);
}

const EMPTY_SPARE = { spare_name: "", spare_model_no: "", spare_cnmm_no: "", spare_qty: "" };
// Spare ERP Number mask — 4 alphabetic letters + 4 numeric digits (ABCD1234).
const fmtErp = (raw) => {
  const s = String(raw || "").toUpperCase();
  let out = "";
  for (const ch of s) {
    if (out.length < 4) { if (ch >= "A" && ch <= "Z") out += ch; }
    else if (out.length < 8) { if (ch >= "0" && ch <= "9") out += ch; }
  }
  return out;
};
const EMPTY = {
  shift: "A",
  zone: "", line: "", machine_no: "", machine_name: "",
  bd_date: todayISO(), bd_start_time: "", bd_ok_time: "",
  problem_observed_by_maintenance: "", action_taken_on_problem: "",
  spare_used: "no",               // "yes" reveals the (mandatory) Spare Details
  spares: [{ ...EMPTY_SPARE }],   // one entry can consume several spares
  bd_attended_by: "",
};
// EMPTY holds an array — always hand out a FRESH copy, never the same reference.
const newForm = () => ({ ...EMPTY, bd_date: todayISO(), spares: [{ ...EMPTY_SPARE }] });

// The 4 spare columns in the List tab render from the `spares` array when present.
const SPARE_KEYS = new Set(["spare_name", "spare_model_no", "spare_cnmm_no", "spare_qty"]);
const spareCell = (r, k) => {
  const arr = Array.isArray(r.spares) && r.spares.length ? r.spares : null;
  if (!arr) return r[k] ?? "";                       // legacy row → flat column
  return arr.map((s) => String(s[k] ?? "").trim() || "—").join(" | ");
};

// Table columns for the List tab (header → row field).
const LIST_COLS = [
  { h: "Serial No.", k: "serial_no" },
  { h: "Shift", k: "shift" },
  { h: "Zone", k: "zone" },
  { h: "Line", k: "line" },
  { h: "Machine No.", k: "machine_no" },
  { h: "Machine Name", k: "machine_name", wide: true },
  { h: "Date", k: "bd_date" },
  { h: "Start Time", k: "bd_start_time" },
  { h: "End Time", k: "bd_ok_time" },
  { h: "Total (min)", k: "mc_down_time_minutes" },
  { h: "Total (hrs)", k: "solve_time_hours" },
  { h: "Problem Observed by Maintenance", k: "problem_observed_by_maintenance", wide: true },
  { h: "Action Taken", k: "action_taken_on_problem", wide: true },
  { h: "Spare Name", k: "spare_name" },
  { h: "Model No.", k: "spare_model_no" },
  { h: "Spare ERP No.", k: "spare_cnmm_no" },
  { h: "Qty", k: "spare_qty" },
  { h: "Attended By", k: "bd_attended_by" },
];

export default function BreakdownLogBook() {
  const { token, theme, user } = useAuth();
  const nav = useNavigate();
  const [form, setForm]   = useState(newForm);
  const [master, setMaster] = useState([]);
  const [spareMaster, setSpareMaster] = useState([]);   // spare picker (maintenance_spare)
  const [view, setView]   = useState("entry");   // entry | list
  const [rows, setRows]   = useState([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg]     = useState(null);       // {type, text}

  // ── List filters — date defaults to TODAY, freely changeable ──
  const [flMonth, setFlMonth] = useState(todayISO().slice(0, 7));   // default = current month
  const [flDate, setFlDate]   = useState("");
  const [flShift, setFlShift] = useState("");
  const [flZone, setFlZone]   = useState("");
  const [flLine, setFlLine]   = useState("");
  const [flMno, setFlMno]     = useState("");

  useEffect(() => {
    if (!token) return;
    api.get("/api/machines/", token).then((m) => setMaster(Array.isArray(m) ? m : [])).catch(() => {});
    api.get("/api/maintenance-spare/", token).then((s) => setSpareMaster(Array.isArray(s) ? s : [])).catch(() => {});
  }, [token]);

  const loadList = useCallback(async () => {
    try { const r = await api.get("/api/logbook/", token); setRows(Array.isArray(r) ? r : []); }
    catch (e) { setMsg({ type: "err", text: e.message || "Load failed" }); }
  }, [token]);
  useEffect(() => { if (view === "list") loadList(); }, [view, loadList]);

  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), msg.type === "ok" ? 2500 : 5500);
    return () => clearTimeout(t);
  }, [msg]);

  // Zone → Line → Machine No cascade from the Machine Master.
  const zoneOpts = useMemo(
    () => [...new Set(master.map((m) => m.zone_name).filter(Boolean))].sort(), [master]);
  const lineOpts = useMemo(
    () => form.zone
      ? [...new Set(master.filter((m) => m.zone_name === form.zone).map((m) => m.line_name).filter(Boolean))].sort()
      : [], [master, form.zone]);
  const mcOpts = useMemo(
    () => (form.zone && form.line)
      ? master.filter((m) => m.zone_name === form.zone && m.line_name === form.line && m.machine_no)
              .sort((a, b) => (a.serial_no || 0) - (b.serial_no || 0))
      : [], [master, form.zone, form.line]);

  const UPPER = new Set([
    "problem_observed_by_maintenance", "action_taken_on_problem",
    "spare_name", "spare_model_no", "spare_cnmm_no", "bd_attended_by",
  ]);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: UPPER.has(k) ? String(v).toUpperCase() : v }));

  // ── spares (repeatable) ──
  const setSpare = (i, k, v) => setForm((f) => ({
    ...f,
    spares: f.spares.map((s, idx) =>
      idx === i ? { ...s, [k]: UPPER.has(k) ? String(v).toUpperCase() : v } : s),
  }));
  const addSpare = () => setForm((f) => ({ ...f, spares: [...f.spares, { ...EMPTY_SPARE }] }));
  const removeSpare = (i) => setForm((f) => ({
    ...f,
    spares: f.spares.length > 1 ? f.spares.filter((_, idx) => idx !== i) : [{ ...EMPTY_SPARE }],
  }));
  // Spare Name picker (from maintenance_spare): choosing a known spare auto-fills
  // its Model No. / CNMM No.; a brand-new name is kept (and added to the master
  // on save).
  const onSpareName = (i, v) => setForm((f) => ({
    ...f,
    spares: f.spares.map((s, idx) => {
      if (idx !== i) return s;
      const hit = spareMaster.find((m) => String(m.spare_name || "").toLowerCase() === String(v).trim().toLowerCase());
      const name = String(v).toUpperCase();
      return hit
        ? { ...s, spare_name: name,
            spare_model_no: (hit.spare_model_no || s.spare_model_no || "").toUpperCase(),
            spare_cnmm_no:  (hit.spare_cnmm_no  || s.spare_cnmm_no  || "").toUpperCase() }
        : { ...s, spare_name: name };
    }),
  }));
  const onZone = (v) => setForm((f) => ({ ...f, zone: v, line: "", machine_no: "", machine_name: "" }));
  const onLine = (v) => setForm((f) => ({ ...f, line: v, machine_no: "", machine_name: "" }));
  const onMc = (v) => {
    const hit = mcOpts.find((m) => String(m.machine_no) === String(v));
    setForm((f) => ({ ...f, machine_no: v, machine_name: hit?.machine_name || "" }));
  };

  // Total time auto-computed from Start & End time (min + hrs).
  const solveMin = diffMinutes(form.bd_start_time, form.bd_ok_time);
  const solveHrs = solveMin === "" ? "" : (Number(solveMin) / 60).toFixed(2);

  // ── List filter options (from the Machine Master) ──
  const flZoneOpts = useMemo(() => [...new Set(master.map((m) => m.zone_name).filter(Boolean))].sort(), [master]);
  const flLineOpts = useMemo(() => flZone
    ? [...new Set(master.filter((m) => m.zone_name === flZone).map((m) => m.line_name).filter(Boolean))].sort() : [], [master, flZone]);
  const flMnoOpts = useMemo(() => (flZone && flLine)
    ? [...new Set(master.filter((m) => m.zone_name === flZone && m.line_name === flLine).map((m) => m.machine_no).filter(Boolean))].sort() : [], [master, flZone, flLine]);
  const onFlZone = (v) => { setFlZone(v); setFlLine(""); setFlMno(""); };
  const onFlLine = (v) => { setFlLine(v); setFlMno(""); };
  const clearFilters = () => { setFlMonth(""); setFlDate(""); setFlShift(""); setFlZone(""); setFlLine(""); setFlMno(""); };

  const filteredRows = useMemo(() => rows.filter((r) => {
    if (flMonth && String(r.bd_date || "").slice(0, 7) !== flMonth) return false;
    if (flDate && String(r.bd_date || "").slice(0, 10) !== flDate) return false;
    if (flShift && r.shift !== flShift) return false;
    if (flZone && r.zone !== flZone) return false;
    if (flLine && r.line !== flLine) return false;
    if (flMno && String(r.machine_no) !== String(flMno)) return false;
    return true;
  }), [rows, flMonth, flDate, flShift, flZone, flLine, flMno]);

  const reset = () => { setForm(newForm()); setMsg(null); };

  // Required to save: machine (zone+line+no) + problem observed.
  const REQUIRED = [
    ["zone", "Zone"], ["line", "Line"], ["machine_no", "Machine No."],
    ["bd_date", "Date"], ["problem_observed_by_maintenance", "Problem Observed by Maintenance"],
  ];

  // Save is only enabled once EVERY field is filled — and, when Spare Used = YES,
  // every filled spare row must have all 4 columns.
  const REQUIRED_ALL = [
    "shift", "zone", "line", "machine_no", "machine_name", "bd_date",
    "bd_start_time", "bd_ok_time", "problem_observed_by_maintenance",
    "action_taken_on_problem", "bd_attended_by",
  ];
  const spareRuleOK = () => {
    if (form.spare_used !== "yes") return true;   // No → spares don't block
    const cols = ["spare_name", "spare_model_no", "spare_cnmm_no", "spare_qty"];
    const rows = (form.spares || []).filter((s) => cols.some((c) => String(s[c] ?? "").trim()));
    return rows.length > 0 && rows.every((s) => cols.every((c) => String(s[c] ?? "").trim()));
  };
  const canSubmit = REQUIRED_ALL.every((k) => String(form[k] ?? "").trim()) && spareRuleOK();

  const save = async () => {
    const missing = REQUIRED.filter(([k]) => !String(form[k] ?? "").trim()).map(([, l]) => l);
    if (missing.length) {
      setMsg({ type: "err", text: `Please fill: ${missing.join(", ")}` });
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setSaving(true); setMsg(null);
    try {
      // drop completely-blank spare rows so an unused "Add" doesn't get saved
      const spares = (form.spares || []).filter((s) => Object.values(s).some((v) => String(v ?? "").trim()));
      const r = await api.post("/api/logbook/",
        { ...form, spares, mc_down_time_minutes: solveMin, solve_time_hours: solveHrs }, token);
      setMsg({ type: "ok", text: `Entry saved ✓ (Serial No. ${r.serial_no})` });
      setForm(newForm());
    } catch (e) { setMsg({ type: "err", text: e.message || "Save failed" }); }
    finally    { setSaving(false); }
  };

  const remove = async (r) => {
    if (!confirm("Delete this entry?")) return;
    try { await api.del(`/api/logbook/${r.id}`, token); loadList(); }
    catch (e) { setMsg({ type: "err", text: e.message || "Delete failed" }); }
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700;800&family=Barlow+Condensed:wght@700;800&display=swap');
        .lb-root { min-height:100vh; background:#eef2f7; font-family:'Barlow',sans-serif; padding-bottom:50px; }
        .lb-top { background:#fff; border-bottom:1px solid #e2e8f0; height:56px; padding:0 28px 0 96px;
                  display:flex; align-items:center; justify-content:space-between;
                  position:sticky; top:0; z-index:50; box-shadow:0 1px 3px rgba(0,0,0,.06); }
        .lb-top::after { content:''; position:absolute; bottom:0; left:0; right:0; height:2px; background:${theme.gradient}; }
        .lb-title { font-family:'Barlow Condensed',sans-serif; font-size:22px; font-weight:800; color:#0f172a; }
        .lb-title span { color:${theme.accent}; }
        .lb-sub { font-size:11px; color:#94a3b8; margin-top:-2px; }
        .lb-back { display:flex; align-items:center; gap:6px; font-size:13px; font-weight:700; color:#475569;
                   background:#f1f5f9; border:1px solid #e2e8f0; border-radius:8px; padding:7px 14px; cursor:pointer; }
        .lb-toggle { display:flex; gap:0; border:1px solid #cbd5e1; border-radius:9px; overflow:hidden; }
        .lb-toggle button { border:none; background:#fff; color:#64748b; font-weight:700; font-size:12px;
                            padding:7px 16px; cursor:pointer; letter-spacing:.03em; }
        .lb-toggle button.on { background:${theme.accent}; color:#fff; }
        .lb-body { max-width:1200px; margin:18px auto 0; padding:0 22px; }
        .lb-card { background:#fff; border:1px solid #e2e8f0; border-radius:12px; overflow:hidden;
                   box-shadow:0 1px 4px rgba(15,23,42,.06); }
        .lb-card-head { background:#0f172a; color:#fff; font-weight:800; font-size:13px;
                        letter-spacing:.08em; text-transform:uppercase; padding:13px 20px; }
        .lb-form { padding:22px 20px; }
        .lb-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(160px, 1fr)); gap:16px 18px; }
        .lb-field { display:flex; flex-direction:column; gap:5px; min-width:0; }
        .lb-field.full { grid-column:1/-1; }
        .lb-lbl { font-size:10.5px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:#475569; }
        .lb-in, .lb-sel, .lb-ta { font-family:'Barlow',sans-serif; font-size:14px; color:#0f172a;
                 border:1px solid #cbd5e1; border-radius:8px; padding:9px 11px; background:#fff; width:100%;
                 outline:none; transition:border-color .12s, box-shadow .12s; box-sizing:border-box; }
        .lb-in:focus, .lb-sel:focus, .lb-ta:focus { border-color:${theme.accent}; box-shadow:0 0 0 3px ${theme.soft}; }
        .lb-in:disabled, .lb-sel:disabled { background:#f1f5f9; color:#94a3b8; cursor:not-allowed; }
        .lb-in[readonly] { background:#f8fafc; color:#334155; }
        .lb-ta { resize:vertical; min-height:64px; line-height:1.45; }
        .lb-section { margin-top:20px; padding-top:18px; border-top:1px dashed #e2e8f0; }
        .lb-section-t { font-size:12px; font-weight:800; letter-spacing:.05em; text-transform:uppercase;
                        color:#0f172a; margin-bottom:14px; }
        .lb-actions { display:flex; justify-content:flex-end; gap:12px; padding:16px 20px;
                      border-top:1px solid #eef2f7; background:#fafbfc; }
        .lb-btn { font-weight:800; font-size:13px; border-radius:9px; padding:11px 22px; cursor:pointer;
                  border:1px solid #cbd5e1; background:#fff; color:#334155; letter-spacing:.03em; }
        .lb-btn.primary { background:${theme.accent}; color:#fff; border-color:${theme.accent}; }
        .lb-btn:disabled { opacity:.6; cursor:not-allowed; }
        .lb-toast { position:fixed; top:70px; left:50%; transform:translateX(-50%); z-index:200;
                    padding:13px 22px; border-radius:11px; font-size:14px; font-weight:700; color:#fff;
                    box-shadow:0 12px 32px rgba(15,23,42,.22); display:flex; align-items:center; gap:9px; max-width:92vw; }
        .lb-toast.ok  { background:#16a34a; }
        .lb-toast.err { background:#dc2626; }
        .lb-table { width:100%; border-collapse:collapse; font-size:13px; }
        .lb-table th { text-align:left; padding:10px 12px; font-size:10px; font-weight:700; letter-spacing:.06em;
                       text-transform:uppercase; color:#64748b; border-bottom:2px solid #e2e8f0; white-space:nowrap; }
        .lb-table td { padding:9px 12px; border-bottom:1px solid #f1f5f9; color:#334155; white-space:nowrap; }
        .lb-table td.lb-td-wide { max-width:240px; overflow:hidden; text-overflow:ellipsis; }
        .lb-table tbody tr:hover td { background:#f8fafc; }
        /* Delete/actions column ko right pe FREEZE karo — chaudi table me scroll par bhi dikhe */
        .lb-table th:last-child, .lb-table td:last-child { position:sticky; right:0; background:#fff;
                       box-shadow:-8px 0 10px -8px rgba(15,23,42,.18); }
        .lb-del { font-weight:800; font-size:11px; border-radius:7px; padding:5px 12px; cursor:pointer;
                  border:1px solid #fecaca; background:#fef2f2; color:#dc2626; white-space:nowrap; }
        .lb-del:hover { background:#dc2626; color:#fff; border-color:#dc2626; }
      `}</style>

      <div className="lb-root">
        <div className="lb-top">
          <div style={{ display:"flex", alignItems:"center", gap:14 }}>
            <button className="lb-back" onClick={() => nav("/dashboard")}>← Back</button>
            <div>
              <div className="lb-title"><span>Log Book</span></div>
              <div className="lb-sub">Maintenance log book entry</div>
            </div>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:14 }}>
            <div className="lb-toggle">
              <button className={view === "entry" ? "on" : ""} onClick={() => setView("entry")}>Data Entry</button>
              <button className={view === "list"  ? "on" : ""} onClick={() => setView("list")}>List</button>
            </div>
            {user?.username && <span style={{ fontSize:12, color:"#64748b", fontWeight:600 }}>{user.username}</span>}
          </div>
        </div>

        {msg && (
          <div className={`lb-toast ${msg.type}`} onClick={() => setMsg(null)}>
            <span>{msg.type === "err" ? "⚠" : "✓"}</span>{msg.text}
          </div>
        )}

        <div className="lb-body">
          {view === "entry" ? (
            <div className="lb-card">
              <div className="lb-card-head">Maintenance Log Book — New Entry</div>
              <div className="lb-form">
                <div style={{ fontSize:11.5, color:"#94a3b8", marginBottom:16, fontWeight:600 }}>
                  Serial No. is generated automatically on save. Pick Zone → Line → Machine No.
                  (Machine Name auto-fills), then fill the details and press <b>Save Entry</b>.
                </div>

                {/* ── Identity ───────────────────────────────── */}
                <div className="lb-grid">
                  <div className="lb-field">
                    <span className="lb-lbl">Serial No.</span>
                    <input className="lb-in" readOnly value="(auto — on save)" />
                  </div>
                  <div className="lb-field">
                    <span className="lb-lbl">Shift</span>
                    <select className="lb-sel" value={form.shift} onChange={(e) => set("shift", e.target.value)}>
                      <option value="A">A</option>
                      <option value="B">B</option>
                    </select>
                  </div>
                  <div className="lb-field">
                    <span className="lb-lbl">Zone</span>
                    <select className="lb-sel" value={form.zone} onChange={(e) => onZone(e.target.value)}>
                      <option value="">— Select Zone —</option>
                      {zoneOpts.map((z) => <option key={z} value={z}>{z}</option>)}
                    </select>
                  </div>
                  <div className="lb-field">
                    <span className="lb-lbl">Line</span>
                    <select className="lb-sel" value={form.line} disabled={!form.zone} onChange={(e) => onLine(e.target.value)}>
                      <option value="">{form.zone ? "— Select Line —" : "Select Zone first"}</option>
                      {lineOpts.map((l) => <option key={l} value={l}>{l}</option>)}
                    </select>
                  </div>
                  <div className="lb-field">
                    <span className="lb-lbl">Machine No.</span>
                    <select className="lb-sel" value={form.machine_no} disabled={!form.line} onChange={(e) => onMc(e.target.value)}>
                      <option value="">{form.line ? "— Select M/C No —" : "Select Line first"}</option>
                      {mcOpts.map((m) => <option key={m.id} value={m.machine_no}>{m.machine_no}</option>)}
                    </select>
                  </div>
                  <div className="lb-field">
                    <span className="lb-lbl">Machine Name</span>
                    <input className="lb-in" readOnly value={form.machine_name} placeholder="Auto-filled from M/C No." />
                  </div>
                  <div className="lb-field">
                    <span className="lb-lbl">Date</span>
                    <input className="lb-in" type="date" value={form.bd_date} onChange={(e) => set("bd_date", e.target.value)} />
                  </div>
                  <div className="lb-field">
                    <span className="lb-lbl">Start Time</span>
                    <input className="lb-in" type="time" value={form.bd_start_time} onChange={(e) => set("bd_start_time", e.target.value)} />
                  </div>
                  <div className="lb-field">
                    <span className="lb-lbl">End Time</span>
                    <input className="lb-in" type="time" value={form.bd_ok_time} onChange={(e) => set("bd_ok_time", e.target.value)} />
                  </div>
                  <div className="lb-field">
                    <span className="lb-lbl">Total Time (Min)</span>
                    <input className="lb-in" readOnly value={solveMin} placeholder="Auto from Start & End" />
                  </div>
                  <div className="lb-field">
                    <span className="lb-lbl">Total Time (Hrs)</span>
                    <input className="lb-in" readOnly value={solveHrs} placeholder="Auto from Start & End" />
                  </div>
                </div>

                {/* ── Problem / action ───────────────────────── */}
                <div className="lb-section lb-grid">
                  <div className="lb-field full">
                    <span className="lb-lbl">Problem Observed by Maintenance</span>
                    <textarea className="lb-ta" value={form.problem_observed_by_maintenance}
                              onChange={(e) => set("problem_observed_by_maintenance", e.target.value)} />
                  </div>
                  <div className="lb-field full">
                    <span className="lb-lbl">Action Taken</span>
                    <textarea className="lb-ta" value={form.action_taken_on_problem}
                              onChange={(e) => set("action_taken_on_problem", e.target.value)} />
                  </div>
                </div>

                {/* ── Spare Used? + (mandatory when YES) Spare Details ── */}
                <div className="lb-section">
                  <div className="lb-section-t">
                    🔧 Spare Details
                    {form.spare_used === "yes" && form.spares.length > 1 && (
                      <span style={{ fontWeight: 600, color: "#94a3b8", fontSize: 11.5 }}> · {form.spares.length} spares</span>
                    )}
                  </div>
                  <div className="lb-field" style={{ maxWidth: 300 }}>
                    <span className="lb-lbl">Spare Used ?</span>
                    <div style={{ display: "flex", gap: 24, paddingTop: 6 }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
                        <input type="radio" name="lb_spare_used" checked={form.spare_used === "yes"}
                               onChange={() => set("spare_used", "yes")} /> YES
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
                        <input type="radio" name="lb_spare_used" checked={form.spare_used === "no"}
                               onChange={() => setForm((f) => ({ ...f, spare_used: "no", spares: [{ ...EMPTY_SPARE }] }))} /> NO
                      </label>
                    </div>
                  </div>
                  <datalist id="lb-spare-names">
                    {spareMaster.map((m, i) => <option key={i} value={m.spare_name} />)}
                  </datalist>
                  {form.spare_used === "yes" && form.spares.map((sp, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "flex-end", gap: 10,
                                          paddingTop: i ? 10 : 0, marginTop: i ? 10 : 0,
                                          borderTop: i ? "1px dashed #e2e8f0" : "none" }}>
                      <div className="lb-grid" style={{ flex: 1 }}>
                        <div className="lb-field">
                          <span className="lb-lbl">Spare Name{form.spares.length > 1 ? ` ${i + 1}` : ""}</span>
                          <input className="lb-in" list="lb-spare-names" placeholder="Pick or type a spare"
                                 value={sp.spare_name} onChange={(e) => onSpareName(i, e.target.value)} />
                        </div>
                        <div className="lb-field">
                          <span className="lb-lbl">Model Number</span>
                          <input className="lb-in" value={sp.spare_model_no} onChange={(e) => setSpare(i, "spare_model_no", e.target.value)} />
                        </div>
                        <div className="lb-field">
                          <span className="lb-lbl">Spare ERP Number</span>
                          <input className="lb-in" value={sp.spare_cnmm_no} maxLength={8} placeholder="ABCD1234"
                                 onChange={(e) => setSpare(i, "spare_cnmm_no", fmtErp(e.target.value))} />
                        </div>
                        <div className="lb-field">
                          <span className="lb-lbl">Quantity</span>
                          <input className="lb-in" type="number" value={sp.spare_qty} onChange={(e) => setSpare(i, "spare_qty", e.target.value)} />
                        </div>
                      </div>
                      <button type="button" onClick={() => removeSpare(i)}
                              title={form.spares.length > 1 ? "Remove this spare" : "Clear this spare"}
                              style={{ border: "1px solid #fecaca", background: "#fff", color: "#dc2626",
                                       borderRadius: 8, padding: "8px 11px", cursor: "pointer",
                                       fontWeight: 800, fontSize: 13, marginBottom: 2 }}>🗑</button>
                    </div>
                  ))}
                  {form.spare_used === "yes" && (
                    <button type="button" onClick={addSpare}
                            style={{ marginTop: 12, border: "1px dashed #cbd5e1", background: "#f8fafc",
                                     color: "#334155", borderRadius: 8, padding: "8px 16px",
                                     cursor: "pointer", fontWeight: 800, fontSize: 12.5 }}>
                      ＋ Add another spare
                    </button>
                  )}
                </div>

                {/* ── Attended By ────────────────────────────── */}
                <div className="lb-section lb-grid">
                  <div className="lb-field">
                    <span className="lb-lbl">Attended By</span>
                    <input className="lb-in" value={form.bd_attended_by} onChange={(e) => set("bd_attended_by", e.target.value)} />
                  </div>
                </div>
              </div>

              <div className="lb-actions">
                <button className="lb-btn" onClick={reset}>↺ Reset</button>
                <button className="lb-btn primary" onClick={save} disabled={saving || !canSubmit}
                        title={canSubmit ? "" : "Pehle saare fields bharo (aur Spare Used = Yes ho to spares) — tabhi Save enable hoga"}>
                  {saving ? "Saving…" : "💾 Save Entry"}
                </button>
              </div>
            </div>
          ) : (
            <div className="lb-card">
              <div className="lb-card-head">Maintenance Log Book — Entries</div>

              {/* ── List filters (date defaults to today · rest from master) ── */}
              <div style={{ display:"flex", gap:12, flexWrap:"wrap", alignItems:"flex-end",
                            padding:"16px 20px", borderBottom:"1px solid #eef2f7", background:"#fafbfc" }}>
                <div className="lb-field" style={{ minWidth:150 }}>
                  <span className="lb-lbl">Month</span>
                  <input className="lb-in" type="month" value={flMonth} onChange={(e) => setFlMonth(e.target.value)} />
                </div>
                <div className="lb-field" style={{ minWidth:150 }}>
                  <span className="lb-lbl">Date</span>
                  <input className="lb-in" type="date" value={flDate} onChange={(e) => setFlDate(e.target.value)} />
                </div>
                <div className="lb-field" style={{ minWidth:110 }}>
                  <span className="lb-lbl">Shift</span>
                  <select className="lb-sel" value={flShift} onChange={(e) => setFlShift(e.target.value)}>
                    <option value="">All</option>
                    <option value="A">A</option>
                    <option value="B">B</option>
                  </select>
                </div>
                <div className="lb-field" style={{ minWidth:150 }}>
                  <span className="lb-lbl">Zone</span>
                  <select className="lb-sel" value={flZone} onChange={(e) => onFlZone(e.target.value)}>
                    <option value="">All Zones</option>
                    {flZoneOpts.map((z) => <option key={z} value={z}>{z}</option>)}
                  </select>
                </div>
                <div className="lb-field" style={{ minWidth:150 }}>
                  <span className="lb-lbl">Line</span>
                  <select className="lb-sel" value={flLine} onChange={(e) => onFlLine(e.target.value)} disabled={!flZone}>
                    <option value="">All Lines</option>
                    {flLineOpts.map((l) => <option key={l} value={l}>{l}</option>)}
                  </select>
                </div>
                <div className="lb-field" style={{ minWidth:150 }}>
                  <span className="lb-lbl">Machine No.</span>
                  <select className="lb-sel" value={flMno} onChange={(e) => setFlMno(e.target.value)} disabled={!flLine}>
                    <option value="">All Machine No.</option>
                    {flMnoOpts.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <button className="lb-back" style={{ padding:"9px 16px" }} onClick={clearFilters}>✕ Clear</button>
                <span style={{ marginLeft:"auto", fontSize:12, color:"#64748b", fontWeight:600 }}>
                  {filteredRows.length} entr{filteredRows.length === 1 ? "y" : "ies"}
                </span>
              </div>

              <div style={{ overflowX:"auto", padding:"4px 0" }}>
                {filteredRows.length === 0 ? (
                  <div style={{ padding:"40px", textAlign:"center", color:"#94a3b8", fontSize:13 }}>
                    {rows.length === 0 ? "No entries yet." : "No entries match the selected filters."}
                  </div>
                ) : (
                  <table className="lb-table">
                    <thead>
                      <tr>
                        {LIST_COLS.map((c) => <th key={c.k}>{c.h}</th>)}
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRows.map((r) => (
                        <tr key={r.id}>
                          {LIST_COLS.map((c) => {
                            const v = SPARE_KEYS.has(c.k) ? spareCell(r, c.k) : r[c.k];
                            return (
                              <td key={c.k} className={c.wide ? "lb-td-wide" : ""} title={v ? String(v) : ""}>
                                {v === "" || v == null ? "—" : String(v)}
                              </td>
                            );
                          })}
                          <td><button className="lb-del" onClick={() => remove(r)}>🗑 Delete</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
