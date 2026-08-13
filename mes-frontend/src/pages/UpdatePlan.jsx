/* ───────────────────────────────────────────────────────────────────
 * UpdatePlan.jsx — "Update Plan" (sidebar, first entry in Maintenance)
 * ───────────────────────────────────────────────────────────────────
 * Landing page with the six plan sections (user-specified):
 *   Preventive Yearly Plan · Preventive Monthly Plan · Predictive Plan ·
 *   Sunday Plan Work · Shutdown Plan Work · Daily Work Assign
 * Each opens its own sub-page at /maintenance-update-plan/:section —
 * placeholders for now; each section's format/content comes later.
 *
 * Routing: /maintenance-update-plan  (+ /:section via UpdatePlanSection)
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const api = {
  async get(path, token) {
    const r = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
    return r.json();
  },
  async post(path, token, body) {
    const r = await fetch(path, { method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body) });
    if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
    return r.json();
  },
};

export const UP_SECTIONS = [
  { key: "preventive-yearly",  label: "Preventive Yearly Plan",  icon: "🗓️", desc: "Year-wise preventive maintenance plan" },
  { key: "preventive-monthly", label: "Preventive Monthly Plan", icon: "📅", desc: "Month-wise preventive maintenance plan" },
  { key: "predictive",         label: "Predictive Plan",         icon: "📡", desc: "Predictive maintenance plan" },
  { key: "sunday",             label: "Sunday Plan Work",        icon: "☀️", desc: "Work planned for Sundays" },
  { key: "shutdown",           label: "Shutdown Plan Work",      icon: "🔌", desc: "Work planned for shutdowns" },
  { key: "daily-work",         label: "Daily Work Assign",       icon: "📋", desc: "Day-wise work assignment" },
];

// section value (`:section` route param / UP_SECTIONS.key) → permission sub-key.
// Used to gate the landing tiles and the per-section page.
const SECTION_KEY = {
  "preventive-yearly":  "maintenance-plan-yearly",
  "preventive-monthly": "maintenance-plan-monthly",
  "predictive":         "maintenance-plan-predictive",
  "sunday":             "maintenance-plan-sunday",
  "shutdown":           "maintenance-plan-shutdown",
  "daily-work":         "maintenance-plan-daily",
};
const sectionKeyFor = (section) => SECTION_KEY[section];

function PageShell({ theme, user, title, sub, children, onBack }) {
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700;800&family=Barlow+Condensed:wght@700;800&display=swap');
        .up-root { min-height:100vh; background:#eef2f7; font-family:'Barlow',sans-serif; padding-bottom:50px; }
        .up-top { background:#fff; border-bottom:1px solid #e2e8f0; height:56px; padding:0 28px 0 96px;
                  display:flex; align-items:center; justify-content:space-between;
                  position:sticky; top:0; z-index:50; box-shadow:0 1px 3px rgba(0,0,0,.06); }
        .up-top::after { content:''; position:absolute; bottom:0; left:0; right:0; height:2px; background:${theme.gradient}; }
        .up-title { font-family:'Barlow Condensed',sans-serif; font-size:22px; font-weight:800; color:#0f172a; }
        .up-title span { color:${theme.accent}; }
        .up-sub { font-size:11px; color:#94a3b8; margin-top:-2px; }
        .up-back { display:flex; align-items:center; gap:6px; font-size:13px; font-weight:700; color:#475569;
                   background:#f1f5f9; border:1px solid #e2e8f0; border-radius:8px; padding:7px 14px; cursor:pointer; }
        .up-body { max-width:1200px; margin:30px auto 0; padding:0 22px; }
        .up-grid { display:grid; gap:18px; grid-template-columns:repeat(auto-fit, minmax(320px, 1fr)); }
        .up-tile { background:#fff; border:1px solid #e2e8f0; border-radius:16px; padding:26px 24px;
                   display:flex; align-items:center; gap:18px; cursor:pointer; text-align:left;
                   box-shadow:0 1px 4px rgba(15,23,42,.06); transition:all .15s; font-family:'Barlow',sans-serif; }
        .up-tile:hover { border-color:${theme.accent}; transform:translateY(-2px);
                         box-shadow:0 8px 20px rgba(15,23,42,.12); }
        .up-tile .ico { width:58px; height:58px; border-radius:14px; background:#f1f5f9; flex-shrink:0;
                        display:flex; align-items:center; justify-content:center; font-size:27px; }
        .up-tile h3 { margin:0 0 4px; font-size:15.5px; font-weight:800; color:#0f172a; }
        .up-tile p { margin:0; font-size:12px; color:#64748b; }
        .up-tile .go { margin-left:auto; font-size:18px; color:${theme.accent}; font-weight:800; }
        .up-card { background:#fff; border:1px solid #e2e8f0; border-radius:14px; padding:60px 30px;
                   text-align:center; box-shadow:0 1px 4px rgba(15,23,42,.06); }
        .up-card .ico { font-size:44px; margin-bottom:14px; }
        .up-card h3 { margin:0 0 8px; font-size:17px; font-weight:800; color:#0f172a; }
        .up-card p { margin:0; font-size:13px; color:#64748b; line-height:1.7; }
      `}</style>
      <div className="up-root">
        <div className="up-top">
          <div style={{ display:"flex", alignItems:"center", gap:14 }}>
            {onBack && <button className="up-back" onClick={onBack}>← Back</button>}
            <div>
              <div className="up-title">{title}</div>
              {sub && <div className="up-sub">{sub}</div>}
            </div>
          </div>
          {user?.username && <span style={{ fontSize:12, color:"#64748b", fontWeight:600 }}>{user.username}</span>}
        </div>
        <div className="up-body">{children}</div>
      </div>
    </>
  );
}

export default function UpdatePlan() {
  const { theme, user, canAccess } = useAuth();
  const nav = useNavigate();
  return (
    <PageShell theme={theme} user={user}
               title={<>Update <span>Plan</span></>} sub="Maintenance work plans">
      <div className="up-grid">
        {UP_SECTIONS.filter((s) => canAccess(sectionKeyFor(s.key))).map((s) => (
          <button key={s.key} className="up-tile" onClick={() => nav(`/maintenance-update-plan/${s.key}`)}>
            <span className="ico">{s.icon}</span>
            <span>
              <h3>{s.label}</h3>
              <p>{s.desc}</p>
            </span>
            <span className="go">→</span>
          </button>
        ))}
      </div>
    </PageShell>
  );
}

/* One plan section — preventive-yearly is live; the rest are placeholders. */
export function UpdatePlanSection() {
  const { theme, user, canAccess } = useAuth();
  const nav = useNavigate();
  const { section } = useParams();
  const s = UP_SECTIONS.find((x) => x.key === section) || { label: "Plan", icon: "📝", desc: "" };

  // Per-section gate: parent grant inherits (canAccess), but a sub-key set to
  // None hides just this section.
  if (!canAccess(sectionKeyFor(section))) {
    return (
      <PageShell theme={theme} user={user}
                 title={<>No <span>Access</span></>}
                 sub={s.desc} onBack={() => nav("/maintenance-update-plan")}>
        <div className="up-card" style={{ maxWidth:800, margin:"0 auto" }}>
          <div className="ico">🔒</div>
          <h3>{s.label}</h3>
          <p>Aapko is section ka access nahi.</p>
        </div>
      </PageShell>
    );
  }

  if (section === "preventive-yearly") {
    return <PreventiveYearlyPlan theme={theme} user={user} nav={nav} meta={s} />;
  }
  if (section === "sunday") {
    return <WorkPlanBoard theme={theme} user={user} nav={nav} cfg={SUNDAY_CFG} />;
  }
  if (section === "daily-work") {
    return <WorkPlanBoard theme={theme} user={user} nav={nav} cfg={DAILY_CFG} />;
  }
  if (section === "shutdown") {
    return <WorkPlanBoard theme={theme} user={user} nav={nav} cfg={SHUTDOWN_CFG} />;
  }

  return (
    <PageShell theme={theme} user={user}
               title={<>{s.label.split(" ").slice(0, -1).join(" ")} <span>{s.label.split(" ").slice(-1)}</span></>}
               sub={s.desc} onBack={() => nav("/maintenance-update-plan")}>
      <div className="up-card" style={{ maxWidth:800, margin:"0 auto" }}>
        <div className="ico">{s.icon}</div>
        <h3>{s.label}</h3>
        <p>This section is ready — its format/content will be added next.</p>
      </div>
    </PageShell>
  );
}

/* Shared field/tile helpers — defined at MODULE level on purpose: defining
 * them inside a component recreates the component type on every render,
 * which remounts the inputs and drops keyboard focus after each keystroke. */
const selStyle = { border:"1.5px solid #cbd5e1", borderRadius:9, padding:"9px 12px", fontSize:13,
                   fontWeight:600, color:"#0f172a", outline:"none", fontFamily:"'Barlow',sans-serif",
                   background:"#fff", minWidth:150 };
function Fld({ label, children }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
      <label style={{ fontSize:10.5, fontWeight:800, letterSpacing:".05em", textTransform:"uppercase", color:"#64748b" }}>{label}</label>
      {children}
    </div>
  );
}
function Tile({ label, value, color, sub }) {
  return (
    <div style={{ background:"#fff", border:"1px solid #e2e8f0", borderTop:`3px solid ${color}`,
                  borderRadius:14, padding:"14px 20px", minWidth:150, boxShadow:"0 1px 3px rgba(15,23,42,.05)" }}>
      <div style={{ fontSize:11, fontWeight:800, textTransform:"uppercase", letterSpacing:".05em", color:"#64748b" }}>{label}</div>
      <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:36, fontWeight:800, lineHeight:1.1, color }}>{value}</div>
      {sub && <div style={{ fontSize:10.5, color:"#94a3b8" }}>{sub}</div>}
    </div>
  );
}

/* ── Work-plan board (Sunday Plan Work + Daily Work Assign) ──────────
 * Assign work: Date + Zone → Line → Machine No / Machine Name (all from
 * the Machine Master, like everywhere) + the problem/work.  Each plan is
 * later COMPLETED by filling the Action Taken and who did it.  Counter
 * tiles on top (planned / pending / done); the plans are also listed on
 * the Historical Data page.  Daily mode adds a FROM–TO date range to
 * check what happened / what is pending between two dates.             */
const nextSundayISO = () => {
  const d = new Date();
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7));   // today if Sunday
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const todayLocalISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const EMPTY_SPARE = { spare_name: "", spare_model_no: "", spare_cnmm_no: "", spare_qty: "" };
// HH:MM se HH:MM ka farak → "Xh Ym" (auto Total), end < start ho to agla din
const durLabel = (start, end) => {
  if (!start || !end) return "—";
  const [sh, sm] = start.split(":").map(Number), [eh, em] = end.split(":").map(Number);
  let d = (eh * 60 + em) - (sh * 60 + sm); if (d < 0) d += 24 * 60;
  const h = Math.floor(d / 60), m = d % 60;
  return (h ? `${h}h ` : "") + `${m}m` + `  (${d} min)`;
};
const SUNDAY_CFG = {
  api: "/api/sunday-plan", t1: "Sunday Plan", t2: "Work",
  sub: "Assign Sunday work · fill the action taken and by whom",
  dateLabel: "Sunday Date", listTitle: "🗓 Sunday Work Plans",
  defDate: nextSundayISO, range: false, dateCol: "Sunday",
  timesSpares: true,   // Sunday par hi: Start/End time + auto Total + Spares (Log Book jaisa)
};
const DAILY_CFG = {
  api: "/api/daily-plan", t1: "Daily Work", t2: "Assign",
  sub: "Assign day-wise work · fill the action taken and by whom",
  dateLabel: "Work Date", listTitle: "📋 Daily Work Plans",
  defDate: todayLocalISO, range: true, dateCol: "Date",
  timesSpares: true,   // Daily me bhi: Start/End time + auto Total + Spares (Log Book jaisa)
};
const SHUTDOWN_CFG = {
  api: "/api/shutdown-plan", t1: "Shutdown Plan", t2: "Work",
  sub: "Assign shutdown work · who will do it · then mark done / not done",
  dateLabel: "Shutdown Date", listTitle: "🔌 Shutdown Work Plans",
  defDate: todayLocalISO, range: true, dateCol: "Shutdown",
  assignee: true,   // adds an "Assigned To (who will do it)" field + column
};

function WorkPlanBoard({ theme, user, nav, cfg }) {
  const { token } = useAuth();
  const [master, setMaster] = useState([]);
  // assign form
  const [fDate, setFDate] = useState(cfg.defDate());
  const [zone, setZone]   = useState("");
  const [line, setLine]   = useState("");
  const [mno, setMno]     = useState("");
  const [mname, setMname] = useState("");
  const [problem, setProblem] = useState("");
  const [assignee, setAssignee] = useState("");   // "kaun karega" — only used when cfg.assignee
  const [saving, setSaving]   = useState(false);
  // list + counters (+ optional FROM–TO range: "2 dates ke beech kya hua")
  const [data, setData]     = useState({ rows: [], total: 0, pending: 0, done: 0 });
  const [tab, setTab]       = useState("ALL");        // ALL | PENDING | DONE
  const [rFrom, setRFrom]   = useState("");
  const [rTo, setRTo]       = useState("");
  const [busyId, setBusyId] = useState(null);
  const [fillId, setFillId] = useState(null);         // plan being completed
  const [fill, setFill]     = useState({ work_done: "", done_by: "", start_time: "", end_time: "", spare_used: "no", spares: [{ ...EMPTY_SPARE }] });
  const [spareMaster, setSpareMaster] = useState([]);   // spare name picker (maintenance_spare)
  const [msg, setMsg]       = useState(null);
  const blankFill = () => ({ work_done: "", done_by: "", start_time: "", end_time: "", spare_used: "no", spares: [{ ...EMPTY_SPARE }] });

  // ── spares (repeatable, Log Book jaisa) — sirf cfg.timesSpares (Sunday) par ──
  const setFillSpare = (i, k, v) => setFill((f) => ({
    ...f, spares: (f.spares || []).map((s, idx) => idx === i ? { ...s, [k]: v } : s) }));
  const addFillSpare = () => setFill((f) => ({ ...f, spares: [...(f.spares || []), { ...EMPTY_SPARE }] }));
  const removeFillSpare = (i) => setFill((f) => ({
    ...f, spares: (f.spares || []).length > 1 ? f.spares.filter((_, idx) => idx !== i) : [{ ...EMPTY_SPARE }] }));
  // known spare chunne par model/ERP auto-fill (master se)
  const onFillSpareName = (i, v) => setFill((f) => ({
    ...f, spares: (f.spares || []).map((s, idx) => {
      if (idx !== i) return s;
      const name = v.toUpperCase();
      const hit = spareMaster.find((m) => String(m.spare_name || "").toLowerCase() === String(v).trim().toLowerCase());
      return hit ? { ...s, spare_name: name,
                     spare_model_no: (hit.spare_model_no || s.spare_model_no || "").toUpperCase(),
                     spare_cnmm_no:  (hit.spare_cnmm_no  || s.spare_cnmm_no  || "").toUpperCase() }
                 : { ...s, spare_name: name };
    }) }));

  const load = () => {
    const p = new URLSearchParams();
    if (cfg.range && rFrom) p.set("date_from", rFrom);
    if (cfg.range && rTo)   p.set("date_to", rTo);
    return api.get(`${cfg.api}/?${p.toString()}`, token).then(setData).catch(() => {});
  };
  useEffect(() => {
    if (!token) return;
    api.get("/api/machines/", token).then((m) => setMaster(Array.isArray(m) ? m : [])).catch(() => setMaster([]));
    if (cfg.timesSpares)
      api.get("/api/maintenance-spare/", token).then((s) => setSpareMaster(Array.isArray(s) ? s : [])).catch(() => {});
  }, [token]);
  useEffect(() => {
    if (!token) return;
    load();
  }, [token, rFrom, rTo]);   // eslint-disable-line react-hooks/exhaustive-deps

  const zoneOpts = useMemo(() => [...new Set(master.map((m) => m.zone_name).filter(Boolean))].sort(), [master]);
  const lineOpts = useMemo(() => zone
    ? [...new Set(master.filter((m) => m.zone_name === zone).map((m) => m.line_name).filter(Boolean))].sort() : [], [master, zone]);
  const machineNoOpts = useMemo(() => (zone && line)
    ? [...new Set(master.filter((m) => m.zone_name === zone && m.line_name === line)
                        .map((m) => m.machine_no).filter(Boolean))].sort() : [], [master, zone, line]);
  const machineNameOpts = useMemo(() => (zone && line)
    ? [...new Set(master.filter((m) => m.zone_name === zone && m.line_name === line)
                        .map((m) => m.machine_name).filter(Boolean))].sort() : [], [master, zone, line]);
  const effMno = mno || (mname
    ? (master.find((m) => m.zone_name === zone && m.line_name === line && m.machine_name === mname)?.machine_no || "")
    : "");
  const effName = mname || (effMno
    ? (master.find((m) => m.zone_name === zone && m.line_name === line && String(m.machine_no) === String(effMno))?.machine_name || "")
    : "");

  const assign = async () => {
    if (!fDate || !zone || !line || !effMno || !problem.trim()) {
      setMsg({ ok: false, text: "Fill everything — date, zone, line, machine and the problem/work." });
      return;
    }
    setSaving(true); setMsg(null);
    try {
      await api.post(`${cfg.api}/`, token, {
        plan_date: fDate, zone_name: zone, line_name: line,
        machine_no: effMno, machine_name: effName, problem: problem.trim(),
        ...(cfg.assignee ? { assigned_to: assignee.trim() } : {}) });
      setProblem(""); setMno(""); setMname(""); setAssignee("");
      setMsg({ ok: true, text: "✓ Work assigned for " + fDate });
      load();
    } catch (e) { setMsg({ ok: false, text: String(e.message || e).slice(0, 160) }); }
    finally { setSaving(false); }
  };

  const complete = async (id) => {
    if (!fill.work_done.trim() || !fill.done_by.trim()) {
      setMsg({ ok: false, text: "Fill BOTH — what work was done AND who did it." });
      return;
    }
    if (cfg.timesSpares && fill.spare_used === "yes" &&
        !(fill.spares || []).some((s) => String(s.spare_name || "").trim())) {
      setMsg({ ok: false, text: "Spare Used = YES — kam se kam ek spare ka naam bharo (ya NO karo)." });
      return;
    }
    setBusyId(id); setMsg(null);
    try {
      const r = await fetch(`${cfg.api}/${id}/complete`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(fill) });
      if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
      setFillId(null); setFill(blankFill());
      setMsg({ ok: true, text: "✓ Updated — work recorded as DONE" });
      load();
    } catch (e) { setMsg({ ok: false, text: String(e.message || e).slice(0, 160) }); }
    finally { setBusyId(null); }
  };

  const reopen = async (id) => {
    setBusyId(id);
    try {
      const r = await fetch(`${cfg.api}/${id}/reopen`, {
        method: "PUT", headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) throw new Error(await r.text());
      load();
    } catch (e) { setMsg({ ok: false, text: String(e.message || e).slice(0, 160) }); }
    finally { setBusyId(null); }
  };

  const rows = data.rows.filter((r) => tab === "ALL" || r.status === tab);
  const pct = data.total ? Math.round((data.done / data.total) * 100) : 0;
  // Header columns — Shutdown mode adds an "Assigned To" column after Problem.
  const headers = ["#", cfg.dateCol, "Zone", "Line", "M/C No", "Machine", "Problem / Work",
                   ...(cfg.assignee ? ["Assigned To"] : []),
                   "Status", "Action Taken", "Done By", "Action"];
  const COLS = headers.length;

  const badge = (st) => (
    <span style={{ padding:"2px 10px", borderRadius:99, fontSize:11, fontWeight:800,
                   background: st === "DONE" ? "#dcfce7" : "#fef3c7",
                   color: st === "DONE" ? "#15803d" : "#b45309" }}>
      {st === "DONE" ? "✓ Done" : "Pending"}
    </span>
  );

  return (
    <PageShell theme={theme} user={user}
               title={<>{cfg.t1} <span>{cfg.t2}</span></>}
               sub={cfg.sub}
               onBack={() => nav("/maintenance-update-plan")}>
      {/* counters on top: kitna pending, kitna ho gya (range-aware in daily) */}
      <div style={{ display:"flex", gap:14, flexWrap:"wrap", marginBottom:20 }}>
        <Tile label="Total Planned" value={data.total}   color="#2563eb"
              sub={cfg.range && (rFrom || rTo) ? "in selected dates" : undefined} />
        <Tile label="Pending"       value={data.pending} color="#d97706" sub="work not done yet" />
        <Tile label="Done"          value={data.done}    color="#16a34a" sub="work completed" />
        <Tile label="Completion"    value={`${pct}%`}    color="#7c3aed" sub="done / total" />
      </div>

      {/* assign work */}
      <div style={{ background:"#fff", border:"1px solid #e2e8f0", borderRadius:14,
                    padding:"18px 22px", boxShadow:"0 1px 4px rgba(15,23,42,.06)", marginBottom:20 }}>
        <div style={{ fontSize:14, fontWeight:800, color:"#0f172a", marginBottom:14 }}>➕ Assign Work</div>
        <div style={{ display:"flex", gap:12, flexWrap:"wrap", alignItems:"flex-end" }}>
          <Fld label={cfg.dateLabel}>
            <input type="date" className="" style={selStyle} value={fDate} onChange={(e) => setFDate(e.target.value)} />
          </Fld>
          <Fld label="Zone">
            <select style={selStyle} value={zone} onChange={(e) => { setZone(e.target.value); setLine(""); setMno(""); setMname(""); }}>
              <option value="">— zone —</option>
              {zoneOpts.map((z) => <option key={z} value={z}>{z}</option>)}
            </select>
          </Fld>
          <Fld label="Line">
            <select style={selStyle} value={line} onChange={(e) => { setLine(e.target.value); setMno(""); setMname(""); }} disabled={!zone}>
              <option value="">— line —</option>
              {lineOpts.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </Fld>
          <Fld label="Machine No.">
            <select style={selStyle} value={mno} onChange={(e) => { setMno(e.target.value); setMname(""); }} disabled={!line}>
              <option value="">— machine no —</option>
              {machineNoOpts.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </Fld>
          <Fld label="Machine Name">
            <select style={selStyle} value={mname} onChange={(e) => { setMname(e.target.value); setMno(""); }} disabled={!line}>
              <option value="">— machine name —</option>
              {machineNameOpts.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </Fld>
        </div>
        <div style={{ display:"flex", gap:12, flexWrap:"wrap", alignItems:"flex-end", marginTop:12 }}>
          <Fld label="Problem / Work to do">
            <input style={{ ...selStyle, minWidth:cfg.assignee ? 320 : 420 }} value={problem}
                   placeholder="e.g. CONVEYOR BELT ALIGNMENT + GREASING"
                   onChange={(e) => setProblem(e.target.value.toUpperCase())} />
          </Fld>
          {cfg.assignee && (
            <Fld label="Assigned To (who will do it)">
              <input style={{ ...selStyle, minWidth:200 }} value={assignee}
                     placeholder="name(s) — kaun karega"
                     onChange={(e) => setAssignee(e.target.value.toUpperCase())} />
            </Fld>
          )}
          <button onClick={assign} disabled={saving}
                  style={{ padding:"11px 26px", borderRadius:9, border:"none", cursor:"pointer",
                           background:"#16a34a", color:"#fff", fontSize:13.5, fontWeight:800,
                           fontFamily:"'Barlow',sans-serif" }}>
            {saving ? "Assigning…" : "✔ Assign Work"}
          </button>
        </div>
        {msg && (
          <div style={{ marginTop:12, padding:"9px 14px", borderRadius:9, fontSize:12.5, fontWeight:700,
                        background: msg.ok ? "#dcfce7" : "#fee2e2", color: msg.ok ? "#166534" : "#991b1b" }}>
            {msg.text}
          </div>
        )}
      </div>

      {/* the plans — check what is planned, fill what was done */}
      <div style={{ background:"#fff", border:"1px solid #e2e8f0", borderRadius:14,
                    boxShadow:"0 1px 4px rgba(15,23,42,.06)", overflow:"hidden" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, padding:"12px 18px", borderBottom:"1px solid #eef2f7", flexWrap:"wrap" }}>
          <span style={{ fontSize:14, fontWeight:800, color:"#0f172a" }}>{cfg.listTitle}</span>
          <span style={{ display:"inline-flex", gap:6, marginLeft:14 }}>
            {["ALL", "PENDING", "DONE"].map((t) => (
              <button key={t} onClick={() => setTab(t)}
                      style={{ padding:"4px 14px", borderRadius:99, border:"1.5px solid",
                               borderColor: tab === t ? theme.accent : "#e2e8f0",
                               background: tab === t ? theme.accent : "#fff",
                               color: tab === t ? "#fff" : "#64748b",
                               fontSize:11.5, fontWeight:800, cursor:"pointer" }}>{t}</button>
            ))}
          </span>
          {/* daily: check what happened / what is pending between 2 dates */}
          {cfg.range && (
            <span style={{ display:"inline-flex", gap:8, alignItems:"center", marginLeft:14 }}>
              <span style={{ fontSize:10.5, fontWeight:800, textTransform:"uppercase", color:"#64748b" }}>From</span>
              <input type="date" value={rFrom} onChange={(e) => setRFrom(e.target.value)}
                     style={{ ...selStyle, minWidth:0, padding:"6px 8px", fontSize:12 }} />
              <span style={{ fontSize:10.5, fontWeight:800, textTransform:"uppercase", color:"#64748b" }}>To</span>
              <input type="date" value={rTo} onChange={(e) => setRTo(e.target.value)}
                     style={{ ...selStyle, minWidth:0, padding:"6px 8px", fontSize:12 }} />
              {(rFrom || rTo) && (
                <button onClick={() => { setRFrom(""); setRTo(""); }}
                        style={{ padding:"5px 10px", borderRadius:7, border:"1.5px solid #cbd5e1",
                                 background:"#fff", color:"#64748b", cursor:"pointer", fontSize:11, fontWeight:700 }}>✕ Clear</button>
              )}
            </span>
          )}
          <span style={{ marginLeft:"auto", fontSize:11.5, color:"#94a3b8" }}>
            also visible on the Historical Data page
          </span>
        </div>
        <div style={rows.length > 6 ? { maxHeight:440, overflowY:"auto" } : undefined}>
          <table style={{ width:"100%", borderCollapse:"collapse" }}>
            <thead>
              <tr>{headers.map((h) => (
                <th key={h} style={{ background:"#1e3a8a", color:"#fff", fontSize:11.5, fontWeight:700,
                                     padding:"10px 12px", textAlign:"left", whiteSpace:"nowrap",
                                     position:"sticky", top:0, zIndex:2 }}>{h}</th>))}</tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={COLS} style={{ textAlign:"center", color:"#94a3b8", padding:32, fontSize:13 }}>
                  No {tab === "ALL" ? "" : tab.toLowerCase() + " "}plans yet.</td></tr>
              )}
              {rows.map((r, i) => (
                <tr key={r.id} style={{ background: r.status === "DONE" ? "#f0fdf4" : "transparent" }}>
                  <td style={{ borderBottom:"1px solid #eef2f7", padding:"9px 12px", fontSize:12 }}>{i + 1}</td>
                  <td style={{ borderBottom:"1px solid #eef2f7", padding:"9px 12px", fontSize:12, fontWeight:700 }}>{r.plan_date}</td>
                  <td style={{ borderBottom:"1px solid #eef2f7", padding:"9px 12px", fontSize:12 }}>{r.zone_name}</td>
                  <td style={{ borderBottom:"1px solid #eef2f7", padding:"9px 12px", fontSize:12 }}>{r.line_name}</td>
                  <td style={{ borderBottom:"1px solid #eef2f7", padding:"9px 12px", fontSize:12, fontWeight:800 }}>{r.machine_no}</td>
                  <td style={{ borderBottom:"1px solid #eef2f7", padding:"9px 12px", fontSize:12 }}>{r.machine_name}</td>
                  <td style={{ borderBottom:"1px solid #eef2f7", padding:"9px 12px", fontSize:12, maxWidth:240 }}>{r.problem}</td>
                  {cfg.assignee && (
                    <td style={{ borderBottom:"1px solid #eef2f7", padding:"9px 12px", fontSize:12, fontWeight:700, color:"#334155" }}>
                      {r.assigned_to || <span style={{ color:"#cbd5e1" }}>—</span>}
                    </td>
                  )}
                  <td style={{ borderBottom:"1px solid #eef2f7", padding:"9px 12px" }}>{badge(r.status)}</td>
                  <td style={{ borderBottom:"1px solid #eef2f7", padding:"9px 12px", fontSize:12, maxWidth:220 }}>
                    {r.status === "DONE" ? r.work_done : <span style={{ color:"#cbd5e1" }}>—</span>}
                  </td>
                  <td style={{ borderBottom:"1px solid #eef2f7", padding:"9px 12px", fontSize:12, fontWeight:700, color:"#334155" }}>
                    {r.status === "DONE" ? r.done_by : <span style={{ color:"#cbd5e1" }}>—</span>}
                  </td>
                  <td style={{ borderBottom:"1px solid #eef2f7", padding:"9px 12px", whiteSpace:"nowrap" }}>
                    {r.status === "PENDING" ? (
                      <button onClick={() => { setFillId(fillId === r.id ? null : r.id); setFill(blankFill()); }}
                              style={{ padding:"5px 14px", borderRadius:7, border:"none", background:"#16a34a",
                                       color:"#fff", cursor:"pointer", fontSize:11.5, fontWeight:800 }}>
                        {fillId === r.id ? "✕ Cancel" : "✔ Update Work"}
                      </button>
                    ) : (
                      <button onClick={() => reopen(r.id)} disabled={busyId === r.id}
                              style={{ padding:"5px 10px", borderRadius:7, border:"1.5px solid #cbd5e1",
                                       background:"#fff", color:"#64748b", cursor:"pointer", fontSize:11, fontWeight:700 }}>↩ Undo</button>
                    )}
                  </td>
                </tr>
              )).flatMap((row, i) => {
                const r = rows[i];
                if (fillId !== r.id) return [row];
                return [row, (
                  <tr key={`fill-${r.id}`}>
                    <td colSpan={COLS} style={{ background:"#f8fafc", borderBottom:"1px solid #eef2f7", padding:"12px 16px" }}>
                      <div style={{ display:"flex", gap:12, flexWrap:"wrap", alignItems:"flex-end" }}>
                        {cfg.timesSpares && (<>
                          <Fld label="Start Time">
                            <input type="time" style={{ ...selStyle, minWidth:120 }} value={fill.start_time}
                                   onChange={(e) => setFill((f) => ({ ...f, start_time: e.target.value }))} />
                          </Fld>
                          <Fld label="End Time">
                            <input type="time" style={{ ...selStyle, minWidth:120 }} value={fill.end_time}
                                   onChange={(e) => setFill((f) => ({ ...f, end_time: e.target.value }))} />
                          </Fld>
                          <Fld label="Total (auto)">
                            <div style={{ ...selStyle, minWidth:150, background:"#eef2ff", color:"#3730a3",
                                          fontWeight:800, display:"flex", alignItems:"center" }}>
                              {durLabel(fill.start_time, fill.end_time)}
                            </div>
                          </Fld>
                        </>)}
                        <Fld label="Action Taken">
                          <input style={{ ...selStyle, minWidth:340 }} value={fill.work_done}
                                 placeholder="e.g. BELT ALIGNED, TENSION SET, GREASING DONE"
                                 onChange={(e) => setFill((f) => ({ ...f, work_done: e.target.value.toUpperCase() }))} />
                        </Fld>
                        <Fld label="Who did it?">
                          <input style={{ ...selStyle, minWidth:200 }} value={fill.done_by}
                                 placeholder="name(s)"
                                 onChange={(e) => setFill((f) => ({ ...f, done_by: e.target.value.toUpperCase() }))} />
                        </Fld>
                      </div>
                      {cfg.timesSpares && (
                        <div style={{ marginTop:14 }}>
                          <div style={{ display:"flex", alignItems:"center", gap:16, marginBottom:8, flexWrap:"wrap" }}>
                            <span style={{ fontSize:11.5, fontWeight:800, color:"#475569" }}>🔧 Spare Used ?</span>
                            <label style={{ fontSize:12.5, fontWeight:700, cursor:"pointer" }}>
                              <input type="radio" checked={fill.spare_used === "yes"}
                                     onChange={() => setFill((f) => ({ ...f, spare_used: "yes",
                                       spares: (f.spares && f.spares.length) ? f.spares : [{ ...EMPTY_SPARE }] }))} /> YES
                            </label>
                            <label style={{ fontSize:12.5, fontWeight:700, cursor:"pointer" }}>
                              <input type="radio" checked={fill.spare_used !== "yes"}
                                     onChange={() => setFill((f) => ({ ...f, spare_used: "no", spares: [{ ...EMPTY_SPARE }] }))} /> NO
                            </label>
                            {fill.spare_used === "yes" &&
                              <span style={{ fontSize:11, color:"#b45309", fontWeight:700 }}>· spare details bharni zaroori hai</span>}
                          </div>
                          {fill.spare_used === "yes" && (<>
                          <datalist id="sun-spare-names">
                            {spareMaster.map((m, i) => <option key={i} value={m.spare_name} />)}
                          </datalist>
                          {(fill.spares || []).map((sp, i) => (
                            <div key={i} style={{ display:"flex", gap:10, flexWrap:"wrap", alignItems:"flex-end",
                                                  paddingTop: i ? 10 : 0, marginTop: i ? 10 : 0,
                                                  borderTop: i ? "1px dashed #e2e8f0" : "none" }}>
                              <Fld label={`Spare Name${fill.spares.length > 1 ? ` ${i + 1}` : ""}`}>
                                <input list="sun-spare-names" placeholder="Pick or type a spare" style={{ ...selStyle, minWidth:220 }}
                                       value={sp.spare_name} onChange={(e) => onFillSpareName(i, e.target.value)} />
                              </Fld>
                              <Fld label="Model Number">
                                <input style={{ ...selStyle, minWidth:170 }}
                                       value={sp.spare_model_no} onChange={(e) => setFillSpare(i, "spare_model_no", e.target.value.toUpperCase())} />
                              </Fld>
                              <Fld label="Spare ERP Number">
                                <input maxLength={8} placeholder="ABCD1234" style={{ ...selStyle, minWidth:150 }}
                                       value={sp.spare_cnmm_no} onChange={(e) => setFillSpare(i, "spare_cnmm_no", e.target.value.toUpperCase())} />
                              </Fld>
                              <Fld label="Quantity">
                                <input type="number" style={{ ...selStyle, minWidth:110 }}
                                       value={sp.spare_qty} onChange={(e) => setFillSpare(i, "spare_qty", e.target.value)} />
                              </Fld>
                              <button type="button" onClick={() => removeFillSpare(i)} title="Remove spare"
                                      style={{ border:"1px solid #fecaca", background:"#fff", color:"#dc2626", borderRadius:8,
                                               padding:"8px 11px", cursor:"pointer", fontWeight:800, fontSize:13, marginBottom:2 }}>🗑</button>
                            </div>
                          ))}
                          <button type="button" onClick={addFillSpare}
                                  style={{ border:"1px dashed #cbd5e1", background:"#fff", color:"#2563eb", borderRadius:7,
                                           padding:"5px 12px", fontSize:12, fontWeight:700, cursor:"pointer" }}>+ Add spare</button>
                          </>)}
                        </div>
                      )}
                      <div style={{ marginTop:14 }}>
                        <button onClick={() => complete(r.id)} disabled={busyId === r.id}
                                style={{ padding:"11px 24px", borderRadius:9, border:"none", cursor:"pointer",
                                         background:"#2563eb", color:"#fff", fontSize:13, fontWeight:800 }}>
                          {busyId === r.id ? "Updating…" : "💾 Update (mark Done)"}
                        </button>
                      </div>
                    </td>
                  </tr>
                )];
              })}
            </tbody>
          </table>
        </div>
      </div>
    </PageShell>
  );
}

/* ── Preventive Yearly Plan ──────────────────────────────────────────
 * Updates the PLAN (P) row of the "Yearly PM Schedule" (Preventive
 * Maintenance page).  Flow: Financial Year → Zone → Line → Machine No
 * (Machine Master List — FULL zone list, this is a Preventive page) →
 * Month → Week → Update.  The machine is matched to the yearly sheet
 * by machine_no (normalized: master "TR_LM_01" ↔ sheet "TR-LM -01");
 * the mark saves as "due" (yellow) at week index month*4+week.       */
const MONTH_ABBR = ["APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC","JAN","FEB","MAR"];

function PreventiveYearlyPlan({ theme, user, nav, meta }) {
  const { token } = useAuth();
  const [years, setYears]   = useState([]);
  const [master, setMaster] = useState([]);
  const [fy, setFy]         = useState("");
  const [zone, setZone]     = useState("");
  const [line, setLine]     = useState("");
  const [mno, setMno]       = useState("");
  const [mname, setMname]   = useState("");
  const [monthIdx, setMonthIdx] = useState("");   // "0".."11"
  const [week, setWeek]     = useState("");       // "1".."4"
  const [match, setMatch]   = useState(null);     // yearly-row preview
  const [busy, setBusy]     = useState(false);
  const [msg, setMsg]       = useState(null);     // {ok, text}
  const [freqSel, setFreqSel] = useState("");     // PM Frequency editor value

  useEffect(() => {
    if (!token) return;
    const now = new Date();
    const cy = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    const curFy = `${cy}-${String(cy + 1).slice(-2)}`;   // current FY, Apr-anchored (e.g. "2026-27")
    api.get("/api/pm/yearly-plan-years", token)
      .then((y) => { setYears(y); if (y.length) setFy(y.includes(curFy) ? curFy : y[0]); })
      .catch(() => setYears([]));
    api.get("/api/machines/", token).then((m) => setMaster(Array.isArray(m) ? m : [])).catch(() => setMaster([]));
  }, [token]);

  // FULL master zone list — Update Plan is a Preventive page (Tool Room,
  // Utility etc. machines are planned too), so the 6-zone rule doesn't apply.
  const zoneOpts = useMemo(() => [...new Set(master.map((m) => m.zone_name).filter(Boolean))].sort(), [master]);
  const lineOpts = useMemo(() => zone
    ? [...new Set(master.filter((m) => m.zone_name === zone).map((m) => m.line_name).filter(Boolean))].sort() : [], [master, zone]);
  // same style as every other page: Machine No. shows only the codes,
  // Machine Name is its own dropdown — both from the Machine Master.
  const machineNoOpts = useMemo(() => (zone && line)
    ? [...new Set(master.filter((m) => m.zone_name === zone && m.line_name === line)
                        .map((m) => m.machine_no).filter(Boolean))].sort() : [], [master, zone, line]);
  const machineNameOpts = useMemo(() => (zone && line)
    ? [...new Set(master.filter((m) => m.zone_name === zone && m.line_name === line)
                        .map((m) => m.machine_name).filter(Boolean))].sort() : [], [master, zone, line]);
  // one effective machine: picked by No., or resolved from the Name pick
  const effMno = mno || (mname
    ? (master.find((m) => m.zone_name === zone && m.line_name === line && m.machine_name === mname)?.machine_no || "")
    : "");
  const sel = master.find((m) => m.zone_name === zone && m.line_name === line
                                 && String(m.machine_no) === String(effMno)) || null;
  const fyStart = parseInt(String(fy).split("-")[0], 10);
  const monthOpts = MONTH_ABBR.map((mo, i) => ({
    idx: i, label: `${mo} ${isNaN(fyStart) ? "" : (i < 9 ? fyStart : fyStart + 1)}` }));

  // preview the matched yearly row whenever machine/fy change
  useEffect(() => {
    setMatch(null); setMsg(null);
    if (!token || !fy || !effMno) return;
    api.get(`/api/pm/yearly-plan-match?machine_no=${encodeURIComponent(effMno)}&fy=${encodeURIComponent(fy)}`, token)
      .then((m) => { setMatch(m); setFreqSel(m?.pm_frequency || ""); })
      .catch(() => setMatch(null));
  }, [token, fy, effMno]);

  const wkIdx = monthIdx !== "" && week !== "" ? Number(monthIdx) * 4 + (Number(week) - 1) : null;
  const curMark = match?.found && wkIdx != null ? (match.plan_weeks || {})[String(wkIdx)] : null;

  const mark = async (action) => {
    setBusy(true); setMsg(null);
    try {
      const res = await api.post("/api/pm/yearly-plan-mark", token, {
        fy, machine_no: effMno, month_idx: Number(monthIdx), week: Number(week), action });
      setMatch((m) => (m ? { ...m, plan_weeks: res.plan_weeks } : m));
      setMsg({ ok: true, text: action === "set"
        ? `✓ Plan updated — ${res.machine_code} · ${monthOpts[Number(monthIdx)].label} · ${week}W (P row marked on the Yearly PM Schedule)`
        : `✓ Mark cleared — ${res.machine_code} · ${monthOpts[Number(monthIdx)].label} · ${week}W` });
    } catch (e) { setMsg({ ok: false, text: String(e.message || e).slice(0, 180) }); }
    finally { setBusy(false); }
  };

  const saveFreq = async () => {
    setBusy(true); setMsg(null);
    try {
      const res = await api.post("/api/pm/yearly-plan-frequency", token, {
        fy, machine_no: effMno, pm_frequency: freqSel });
      setMatch((m) => (m ? { ...m, pm_frequency: res.pm_frequency } : m));
      setMsg({ ok: true, text: `✓ PM Frequency updated — ${res.machine_code} · ${res.pm_frequency || "(blank)"}` });
    } catch (e) { setMsg({ ok: false, text: String(e.message || e).slice(0, 180) }); }
    finally { setBusy(false); }
  };

  return (
    <PageShell theme={theme} user={user}
               title={<>Preventive Yearly <span>Plan</span></>}
               sub="Marks the PLAN (P) row on the Yearly PM Schedule"
               onBack={() => nav("/maintenance-update-plan")}>
      {/* the selection cascade */}
      <div style={{ display:"flex", gap:12, flexWrap:"wrap", alignItems:"flex-end", marginBottom:18 }}>
        <Fld label="Financial Year">
          <select style={selStyle} value={fy} onChange={(e) => setFy(e.target.value)}>
            {years.length === 0 && <option value="">—</option>}
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </Fld>
        <Fld label="Zone">
          <select style={selStyle} value={zone} onChange={(e) => { setZone(e.target.value); setLine(""); setMno(""); setMname(""); }}>
            <option value="">All Zones</option>
            {zoneOpts.map((z) => <option key={z} value={z}>{z}</option>)}
          </select>
        </Fld>
        <Fld label="Line">
          <select style={selStyle} value={line} onChange={(e) => { setLine(e.target.value); setMno(""); setMname(""); }} disabled={!zone}>
            <option value="">All Lines</option>
            {lineOpts.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </Fld>
        <Fld label="Machine No.">
          <select style={selStyle} value={mno} onChange={(e) => { setMno(e.target.value); setMname(""); }} disabled={!line}>
            <option value="">All Machine No.</option>
            {machineNoOpts.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Fld>
        <Fld label="Machine Name">
          <select style={selStyle} value={mname} onChange={(e) => { setMname(e.target.value); setMno(""); }} disabled={!line}>
            <option value="">All Machine Names</option>
            {machineNameOpts.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Fld>
        <Fld label="Frequency">
          <select style={selStyle} value={freqSel} onChange={(e) => setFreqSel(e.target.value)} disabled={!effMno}>
            <option value="">— freq —</option>
            {["Y","H","Q","M","W","4M","2M","3M","6M"].map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </Fld>
        <Fld label="Month">
          <select style={selStyle} value={monthIdx} onChange={(e) => setMonthIdx(e.target.value)} disabled={!effMno}>
            <option value="">— month —</option>
            {monthOpts.map((m) => <option key={m.idx} value={m.idx}>{m.label}</option>)}
          </select>
        </Fld>
        <Fld label="Week">
          <select style={selStyle} value={week} onChange={(e) => setWeek(e.target.value)} disabled={monthIdx === ""}>
            <option value="">— week —</option>
            {[1, 2, 3, 4].map((w) => <option key={w} value={w}>{w}W</option>)}
          </select>
        </Fld>
      </div>

      {/* matched yearly row + action */}
      {effMno && (
        <div style={{ background:"#fff", border:"1px solid #e2e8f0", borderRadius:14, padding:"18px 22px",
                      boxShadow:"0 1px 4px rgba(15,23,42,.06)", maxWidth:860 }}>
          {!match ? (
            <div style={{ color:"#64748b", fontSize:13 }}>Checking the yearly schedule…</div>
          ) : !match.found ? (
            <div style={{ color:"#dc2626", fontSize:13, fontWeight:700 }}>
              ⚠ {effMno} ({sel?.machine_name || ""}) is NOT in the {fy} Yearly PM Schedule — its machine code
              could not be matched, so there is no P row to update.
            </div>
          ) : (
            <>
              <div style={{ fontSize:11, fontWeight:800, letterSpacing:".05em", textTransform:"uppercase",
                            color:"#64748b", marginBottom:8 }}>Matched on the Yearly PM Schedule</div>
              <div style={{ display:"flex", gap:26, flexWrap:"wrap", fontSize:13, color:"#0f172a", marginBottom:14 }}>
                <span><b>S.No</b> {match.s_no}</span>
                <span><b>Machine</b> {match.machine_name}</span>
                <span><b>M/C Code</b> {match.machine_code}</span>
                <span><b>Line</b> {match.line || "—"}</span>
                <span><b>Frequency</b> {match.pm_frequency || "—"}</span>
                <span><b>Weeks planned</b> {Object.keys(match.plan_weeks || {}).length}</span>
              </div>

              {/* PM Frequency — pick it in the Frequency dropdown above, then save here */}
              <div style={{ display:"flex", gap:12, alignItems:"center", flexWrap:"wrap", marginBottom:14,
                            paddingBottom:14, borderBottom:"1px dashed #e2e8f0" }}>
                <span style={{ fontSize:13, fontWeight:700, color:"#334155" }}>
                  PM Frequency — current: <b style={{ color:"#0f172a" }}>{match.pm_frequency || "(blank)"}</b>
                  {freqSel !== (match.pm_frequency || "") && <span style={{ color:"#b45309" }}> → set to <b>{freqSel || "(blank)"}</b></span>}
                </span>
                <button disabled={busy || freqSel === (match.pm_frequency || "")} onClick={saveFreq}
                        style={{ padding:"9px 20px", borderRadius:9, border:"none",
                                 cursor: (busy || freqSel === (match.pm_frequency || "")) ? "not-allowed" : "pointer",
                                 background: (busy || freqSel === (match.pm_frequency || "")) ? "#cbd5e1" : "#2563eb",
                                 color:"#fff", fontSize:13, fontWeight:800, fontFamily:"'Barlow',sans-serif" }}>
                  {busy ? "Saving…" : "💾 Update Frequency"}
                </button>
              </div>
              {wkIdx == null ? (
                <div style={{ fontSize:12.5, color:"#94a3b8", fontWeight:600 }}>Pick Month + Week above to update the plan.</div>
              ) : (
                <div style={{ display:"flex", gap:12, alignItems:"center", flexWrap:"wrap" }}>
                  <span style={{ fontSize:13, fontWeight:700, color:"#334155" }}>
                    {monthOpts[Number(monthIdx)].label} · {week}W —
                    {curMark
                      ? <span style={{ color:"#b45309" }}> already planned ({curMark})</span>
                      : <span style={{ color:"#64748b" }}> not planned yet</span>}
                  </span>
                  <button disabled={busy} onClick={() => mark("set")}
                          style={{ padding:"9px 22px", borderRadius:9, border:"none", cursor:"pointer",
                                   background:"#16a34a", color:"#fff", fontSize:13, fontWeight:800,
                                   fontFamily:"'Barlow',sans-serif" }}>
                    {busy ? "Updating…" : "✔ Update Plan (mark P)"}
                  </button>
                  {curMark && (
                    <button disabled={busy} onClick={() => mark("clear")}
                            style={{ padding:"9px 18px", borderRadius:9, border:"1.5px solid #cbd5e1", cursor:"pointer",
                                     background:"#fff", color:"#475569", fontSize:13, fontWeight:700,
                                     fontFamily:"'Barlow',sans-serif" }}>
                      ✕ Clear mark
                    </button>
                  )}
                </div>
              )}
            </>
          )}
          {msg && (
            <div style={{ marginTop:14, padding:"10px 14px", borderRadius:9, fontSize:12.5, fontWeight:700,
                          background: msg.ok ? "#dcfce7" : "#fee2e2",
                          color: msg.ok ? "#166534" : "#991b1b" }}>{msg.text}</div>
          )}
        </div>
      )}

      <div style={{ marginTop:18, fontSize:12, color:"#94a3b8" }}>
        Updated marks appear as <b style={{ background:"#fef08a", padding:"1px 8px", border:"1px solid #000" }}>&nbsp;</b> (PM PLAN)
        in the P row on <b>Preventive Maint. → Yearly PM Schedule</b>.
      </div>
    </PageShell>
  );
}
