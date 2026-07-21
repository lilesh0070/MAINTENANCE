/* ───────────────────────────────────────────────────────────────────
 * SkillMatrix.jsx  —  Skill & Training → Skill Matrix (Skill Evaluation)
 * ───────────────────────────────────────────────────────────────────
 * Redesigned evaluation workflow (replaces the old flexibility-chart page).
 *
 *   FORM tab
 *     • Pick Employee (required) + Assessment Date → 3-month cycle derived
 *     • Zone cards → Machine dropdown → Process dropdown
 *     • Topics for the machine appear (name, out-of, actual-marks input)
 *     • Live total / max / % / skill-level status
 *     • Duplicate guard: one evaluation per employee·machine·cycle
 *     • Save → /api/skill-eval
 *
 *   LIST tab
 *     • All submitted records with filters (period, date range, zone,
 *       machine, process, employee); auto % + status; expand to see topics.
 *
 * Data source (zones/machines/topics + employees): src/data/skillEvalData.js
 * Routing: /skill-training/skill-matrix
 */
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { SKILL_EVAL_EMPLOYEES, SKILL_EVAL_ZONES } from "../data/skillEvalData";
import { SKILL_DASH_SEED } from "../data/skillDashboardSeed";

// Circular skill-percentage indicator (colour by performance band).
function SkillRing({ pct, size = 92, stroke = 9, sub }) {
  const p = Math.max(0, Math.min(100, Math.round(pct || 0)));
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const col = p >= 76 ? "#16a34a" : p >= 51 ? "#2563eb" : p >= 26 ? "#f59e0b" : p > 0 ? "#dc2626" : "#94a3b8";
  return (
    <svg width={size} height={size} style={{ display: "block" }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#eef2f7" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={col} strokeWidth={stroke} strokeLinecap="round"
              strokeDasharray={c} strokeDashoffset={c * (1 - p / 100)}
              transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: "stroke-dashoffset .6s ease" }} />
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" fontSize={size * 0.26} fontWeight="800" fill="#0f172a">{p}%</text>
      {sub && <text x="50%" y={size * 0.72} textAnchor="middle" fontSize={size * 0.12} fill="#94a3b8" fontWeight="700">{sub}</text>}
    </svg>
  );
}
const avg = (a) => a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : 0;
const groupAvg = (recs, key) => {
  const m = new Map();
  recs.forEach((r) => { const k = r[key]; if (!k) return; (m.get(k) || m.set(k, []).get(k)).push(Number(r.percentage) || 0); });
  return [...m.entries()].map(([name, arr]) => ({ name, pct: avg(arr), count: arr.length })).sort((a, b) => b.pct - a.pct);
};

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
    if (!r.ok) { let m; try { m = JSON.parse(await r.text()).detail; } catch { m = null; }
      throw new Error(m || `HTTP ${r.status}`); }
    return r.json();
  },
  async del(path, token) {
    const r = await fetch(path, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
    return r.json();
  },
};

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const todayStr = () => new Date().toISOString().slice(0, 10);
const cycleLabel = (ds) => {
  const d = new Date(ds + "T00:00:00");
  if (isNaN(d)) return "";
  const s = Math.floor(d.getMonth() / 3) * 3;
  return `${MON[s]}–${MON[s + 2]} ${d.getFullYear()}`;
};
const STATUS_COLOR = (pct) =>
  pct >= 76 ? "#16a34a" : pct >= 51 ? "#2563eb" : pct >= 26 ? "#d97706" : pct > 0 ? "#dc2626" : "#94a3b8";

export default function SkillMatrix() {
  const { token, theme, user } = useAuth();
  const nav = useNavigate();
  const [tab, setTab] = useState("dashboard");
  const [toast, setToast] = useState(null);
  const flash = (m) => { setToast(m); setTimeout(() => setToast(null), 3200); };

  // ── DASHBOARD state (all records, unfiltered → summaries + circles) ────
  const [allRecs, setAllRecs] = useState([]);
  const [dashZone, setDashZone] = useState("");   // "" = all zones
  const loadDash = useCallback(() => {
    if (!token) return;
    api.get("/api/skill-eval/", token).then((r) => setAllRecs(Array.isArray(r) ? r : [])).catch(() => setAllRecs([]));
  }, [token]);
  useEffect(() => { loadDash(); }, [loadDash]);

  // Dashboard is computed straight from the List (skill_eval records) so the
  // two are always connected.  Each person's "Overall Skill Matrix" record
  // holds their headline % (imported from the Excel); per-zone evaluations
  // are separate.  All-zones view shows the Overall %; a zone filter shows
  // that zone's evaluations.
  const OVR = "Overall";
  const dash = useMemo(() => {
    // ── Zone selected → only that zone's real evaluations ──
    if (dashZone) {
      const recs = allRecs.filter((r) => r.zone === dashZone);
      const o = avg(recs.map((r) => Number(r.percentage) || 0));
      return {
        live: true, zone: dashZone, overall: o,
        employees: groupAvg(recs, "employee"),
        byZone: recs.length ? [{ name: dashZone, pct: o, count: recs.length }] : [],
        byMachine: groupAvg(recs, "machine"),
        byProcess: groupAvg(recs, "process"),
        evalCount: recs.length,
      };
    }
    // ── All zones ──
    if (allRecs.length === 0) {           // nothing saved yet → Excel seed
      return {
        live: false, overall: SKILL_DASH_SEED.overall,
        employees: SKILL_DASH_SEED.employees.map((e) => ({ name: e.name, pct: e.pct, count: 0 })),
        byZone: [], byMachine: [],
        byProcess: SKILL_DASH_SEED.processes.map((p) => ({ name: p.name, pct: p.pct, count: p.actual })),
        evalCount: 0,
      };
    }
    // group all records by employee → headline % = the Overall record, else avg of their evals
    const byEmp = new Map();
    allRecs.forEach((r) => { const k = r.employee; if (!k) return; (byEmp.get(k) || byEmp.set(k, []).get(k)).push(r); });
    const employees = [...byEmp.entries()].map(([name, recs]) => {
      const ov = recs.find((r) => r.zone === OVR);
      const pct = ov ? Math.round(Number(ov.percentage) || 0) : avg(recs.map((r) => Number(r.percentage) || 0));
      return { name, pct, count: recs.filter((r) => r.zone !== OVR).length };
    }).sort((a, b) => b.pct - a.pct);
    const realRecs = allRecs.filter((r) => r.zone !== OVR);   // exclude the synthetic Overall from zone/machine views
    return {
      live: true,
      overall: avg(employees.map((e) => e.pct)),
      employees,
      byZone: groupAvg(realRecs, "zone"),
      byMachine: groupAvg(realRecs, "machine"),
      byProcess: SKILL_DASH_SEED.processes.map((p) => ({ name: p.name, pct: p.pct, count: p.actual })),
      evalCount: allRecs.length,
    };
  }, [allRecs, dashZone]);

  // ── FORM state ──────────────────────────────────────────────────────
  const [employee, setEmployee]       = useState("");
  const [assessDate, setAssessDate]   = useState(todayStr());
  const [zoneIdx, setZoneIdx]         = useState(-1);
  const [machineIdx, setMachineIdx]   = useState(-1);
  const [marks, setMarks]             = useState({});
  const [dup, setDup]                 = useState(null);   // {exists, period_label}
  const [saving, setSaving]           = useState(false);

  const zone    = zoneIdx >= 0 ? SKILL_EVAL_ZONES[zoneIdx] : null;
  const machine = zone && machineIdx >= 0 ? zone.machines[machineIdx] : null;
  const topics  = machine ? machine.topics : [];

  const totals = useMemo(() => {
    const max = topics.reduce((s, t) => s + (t.max || 0), 0);
    const tot = topics.reduce((s, t) => s + (Number(marks[t.name]) || 0), 0);
    const pct = max ? Math.round((tot / max) * 1000) / 10 : 0;
    return { max, tot, pct };
  }, [topics, marks]);

  const selectZone = (i) => { setZoneIdx(i); setMachineIdx(-1); setMarks({}); };
  const selectMachine = (i) => { setMachineIdx(i); setMarks({}); };
  const setMark = (name, v, max) => {
    let n = v === "" ? "" : Math.max(0, Math.min(max, Number(v)));
    setMarks((m) => ({ ...m, [name]: n }));
  };

  // duplicate check when employee+zone+machine+date all set
  useEffect(() => {
    if (!token || !employee || !zone || !machine || !assessDate) { setDup(null); return; }
    const qp = new URLSearchParams({
      employee, zone: zone.zone, machine: machine.machine,
      process: machine.process || "", assessment_date: assessDate,
    });
    api.get(`/api/skill-eval/check?${qp}`, token).then(setDup).catch(() => setDup(null));
  }, [token, employee, zone, machine, assessDate]);

  const save = async () => {
    if (!employee) return flash("Please select an employee first.");
    if (!zone || !machine) return flash("Please select a zone and machine.");
    if (dup?.exists) return flash(`Already evaluated in ${dup.period_label}.`);
    setSaving(true);
    try {
      const body = {
        employee, zone: zone.zone, machine: machine.machine, process: machine.process || "",
        assessment_date: assessDate,
        topics: topics.map((t) => ({ name: t.name, max: t.max, mark: Number(marks[t.name]) || 0 })),
      };
      const res = await api.post("/api/skill-eval/", body, token);
      flash(`Saved ✓  ${employee} · ${res.percentage}% · ${res.status}`);
      setMarks({}); setZoneIdx(-1); setMachineIdx(-1);
      loadList(); loadDash();
    } catch (e) { flash(e.message || "Save failed"); }
    finally { setSaving(false); }
  };

  // ── LIST state ──────────────────────────────────────────────────────
  const [records, setRecords] = useState([]);
  const [periods, setPeriods] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const [fPeriod, setFPeriod] = useState("");
  const [fZone, setFZone]     = useState("");
  const [fMachine, setFMachine] = useState("");
  const [fProcess, setFProcess] = useState("");
  const [fEmp, setFEmp]       = useState("");
  const [fFrom, setFFrom]     = useState("");
  const [fTo, setFTo]         = useState("");
  const [listLoading, setListLoading] = useState(false);

  useEffect(() => {
    if (!token) return;
    api.get("/api/skill-eval/periods", token).then((p) => setPeriods(Array.isArray(p) ? p : [])).catch(() => {});
  }, [token]);

  const loadList = useCallback(() => {
    if (!token) return;
    setListLoading(true);
    const qp = new URLSearchParams();
    if (fPeriod) qp.set("period", fPeriod);
    if (fZone) qp.set("zone", fZone);
    if (fMachine) qp.set("machine", fMachine);
    if (fProcess) qp.set("process", fProcess);
    if (fEmp) qp.set("employee", fEmp);
    if (fFrom) qp.set("date_from", fFrom);
    if (fTo) qp.set("date_to", fTo);
    api.get(`/api/skill-eval/?${qp}`, token)
      .then((r) => setRecords(Array.isArray(r) ? r : []))
      .catch(() => setRecords([]))
      .finally(() => setListLoading(false));
  }, [token, fPeriod, fZone, fMachine, fProcess, fEmp, fFrom, fTo]);
  useEffect(() => { loadList(); }, [loadList]);

  const removeRec = async (id) => {
    try { await api.del(`/api/skill-eval/${id}`, token); setRecords((r) => r.filter((x) => x.id !== id)); loadDash(); flash("Deleted"); }
    catch (e) { flash(e.message || "Delete failed"); }
  };

  // machine options for list filter (all machines across zones, or zone-scoped)
  const listMachineOpts = useMemo(() => {
    const zs = fZone ? SKILL_EVAL_ZONES.filter((z) => z.zone === fZone) : SKILL_EVAL_ZONES;
    return [...new Set(zs.flatMap((z) => z.machines.map((m) => m.machine)))];
  }, [fZone]);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700;800&family=Barlow+Condensed:wght@700;800&display=swap');
        .se-root { min-height:100vh; background:#eef2f6; font-family:'Barlow',sans-serif; padding-bottom:60px; }
        .se-top { background:#fff; border-bottom:1px solid #e2e8f0; padding:0 26px 0 96px; height:58px;
                  display:flex; align-items:center; justify-content:space-between; position:sticky; top:0; z-index:60;
                  box-shadow:0 1px 3px rgba(0,0,0,.06); }
        .se-top::after { content:''; position:absolute; bottom:0; left:0; right:0; height:2px; background:${theme.gradient}; }
        .se-back { display:inline-flex; align-items:center; gap:6px; border:1.5px solid #e2e8f0; background:#f8fafc;
                   border-radius:99px; padding:7px 16px; cursor:pointer; font-size:13px; font-weight:700; color:#334155; }
        .se-title { font-family:'Barlow Condensed',sans-serif; font-size:22px; font-weight:800; color:#0f172a; }
        .se-title span { color:${theme.accent}; }
        .se-sub { font-size:11px; color:#94a3b8; margin-top:-2px; }

        .se-tabs { display:flex; gap:8px; max-width:1300px; margin:18px auto 0; padding:0 22px; }
        .se-tab { border:1px solid #cbd5e1; background:#fff; color:#64748b; font-weight:800; font-size:14px;
                  padding:10px 26px; border-radius:10px 10px 0 0; cursor:pointer; }
        .se-tab.on { background:${theme.accent}; color:#fff; border-color:${theme.accent}; }

        .se-dash-filter { display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:12px; }
        .se-dash-filter label { font-size:11px; font-weight:800; letter-spacing:.05em; text-transform:uppercase; color:#64748b; }
        .se-dash-scope { font-size:12.5px; font-weight:700; color:${theme.accentDark}; background:${theme.soft};
                         border:1px solid ${theme.accent}; border-radius:99px; padding:6px 14px; }
        .se-seedbadge { background:#fffbeb; border:1px solid #fde68a; color:#92400e; font-size:12.5px; font-weight:600;
                        border-radius:10px; padding:10px 14px; margin-bottom:16px; }
        .se-dash-top { display:flex; gap:20px; flex-wrap:wrap; align-items:center; margin-bottom:22px; }
        .se-overall { display:flex; align-items:center; gap:14px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:16px; padding:16px 22px; }
        .se-overall-l { font-family:'Barlow Condensed',sans-serif; font-size:17px; font-weight:800; color:#334155; line-height:1.05; text-transform:uppercase; }
        .se-dash-stats { display:grid; grid-template-columns:repeat(auto-fit, minmax(130px,1fr)); gap:14px; flex:1; min-width:280px; }
        .se-dstat { background:#fff; border:1px solid #e2e8f0; border-radius:14px; padding:14px 16px; text-align:center; box-shadow:0 1px 3px rgba(15,23,42,.05); }
        .se-dstat-v { font-family:'Barlow Condensed',sans-serif; font-size:34px; font-weight:800; color:#0f172a; line-height:1; }
        .se-dstat-l { font-size:11px; font-weight:700; color:#64748b; margin-top:5px; }
        .se-dash-h { font-family:'Barlow Condensed',sans-serif; font-size:18px; font-weight:800; color:#0f172a; text-transform:uppercase;
                     letter-spacing:.03em; margin:8px 0 14px; }
        .se-ringgrid { display:grid; grid-template-columns:repeat(auto-fill, minmax(128px,1fr)); gap:14px; margin-bottom:26px; }
        .se-ringcard { background:#fff; border:1px solid #e2e8f0; border-radius:14px; padding:14px 8px 12px; text-align:center;
                       box-shadow:0 1px 3px rgba(15,23,42,.05); display:flex; flex-direction:column; align-items:center; gap:6px; }
        .se-ringcard:hover { box-shadow:0 8px 22px rgba(15,23,42,.10); }
        .se-ringname { font-size:12.5px; font-weight:800; color:#0f172a; line-height:1.2; max-width:118px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .se-ringsub { font-size:10.5px; color:#94a3b8; font-weight:700; }
        .se-dash-cols { display:grid; grid-template-columns:repeat(auto-fit, minmax(280px,1fr)); gap:16px; }
        .se-sumbox { background:#fff; border:1px solid #e2e8f0; border-radius:14px; padding:14px 16px; box-shadow:0 1px 3px rgba(15,23,42,.05); }
        .se-sumbox-h { font-size:13.5px; font-weight:800; color:#0f172a; margin-bottom:10px; }
        .se-sumbox-empty { font-size:12px; color:#94a3b8; padding:8px 0; }
        .se-bar-row { display:flex; align-items:center; gap:10px; margin:7px 0; }
        .se-bar-l { flex:0 0 110px; font-size:11.5px; font-weight:600; color:#334155; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .se-bar-track { flex:1; height:9px; background:#eef2f7; border-radius:99px; overflow:hidden; }
        .se-bar-fill { height:100%; border-radius:99px; transition:width .5s ease; }
        .se-bar-v { flex:0 0 40px; text-align:right; font-size:12px; font-weight:800; }

        .se-wrap { max-width:1300px; margin:0 auto; padding:0 22px; }
        .se-panel { background:#fff; border:1px solid #e2e8f0; border-radius:0 12px 12px 12px;
                    box-shadow:0 1px 3px rgba(15,23,42,.05); padding:20px 22px; }

        .se-row { display:flex; gap:16px; flex-wrap:wrap; align-items:flex-end; margin-bottom:16px; }
        .se-fld { display:flex; flex-direction:column; gap:5px; }
        .se-fld label { font-size:11px; font-weight:800; letter-spacing:.05em; text-transform:uppercase; color:#64748b; }
        .se-fld .req { color:#dc2626; }
        .se-input, .se-select { border:1.5px solid #cbd5e1; border-radius:9px; padding:9px 12px; font-size:14px;
                                font-weight:600; color:#0f172a; font-family:'Barlow',sans-serif; outline:none; background:#fff; min-width:180px; }
        .se-input:focus, .se-select:focus { border-color:${theme.accent}; }
        .se-cyc { font-size:12px; font-weight:700; color:${theme.accentDark}; background:${theme.soft};
                  border:1px solid ${theme.accent}; border-radius:8px; padding:9px 12px; align-self:flex-end; }

        .se-need { color:#64748b; font-size:13px; background:#f8fafc; border:1px dashed #cbd5e1; border-radius:10px;
                   padding:16px; text-align:center; }
        .se-dupwarn { background:#fef2f2; border:1px solid #fecaca; color:#b91c1c; font-size:13px; font-weight:600;
                      border-radius:10px; padding:12px 14px; margin-bottom:14px; }

        .se-zlabel { font-size:12px; font-weight:800; text-transform:uppercase; letter-spacing:.05em; color:#334155; margin:6px 0 10px; }
        .se-zones { display:grid; gap:10px; grid-template-columns:repeat(auto-fill, minmax(190px,1fr)); margin-bottom:16px; }
        .se-zone { border:1.5px solid #e2e8f0; background:#f8fafc; border-radius:12px; padding:14px 14px; cursor:pointer;
                   text-align:left; transition:all .12s ease; }
        .se-zone:hover { border-color:${theme.accent}; transform:translateY(-2px); }
        .se-zone.on { border-color:${theme.accent}; background:${theme.soft}; box-shadow:0 0 0 2px ${theme.soft}; }
        .se-zone-n { font-size:14px; font-weight:800; color:#0f172a; }
        .se-zone-m { font-size:11px; color:#64748b; margin-top:3px; }

        .se-tbl { width:100%; border-collapse:collapse; margin-top:6px; }
        .se-tbl th { background:#1e3a8a; color:#fff; font-size:12px; font-weight:700; padding:10px 12px; text-align:left; }
        .se-tbl td { border-bottom:1px solid #eef2f7; padding:9px 12px; font-size:13px; color:#334155; }
        .se-tbl td.num, .se-tbl th.num { text-align:center; }
        .se-mark-in { width:80px; border:1.5px solid #cbd5e1; border-radius:8px; padding:7px 8px; text-align:center;
                      font-size:14px; font-weight:700; color:#1d4ed8; font-family:'Barlow',sans-serif; outline:none; }
        .se-mark-in:focus { border-color:${theme.accent}; }
        .se-totbar { display:flex; gap:24px; align-items:center; flex-wrap:wrap; margin-top:16px; padding:14px 18px;
                     background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; }
        .se-tot { font-size:13px; color:#64748b; font-weight:600; }
        .se-tot b { font-size:22px; color:#0f172a; font-family:'Barlow Condensed',sans-serif; }
        .se-badge { padding:5px 12px; border-radius:99px; color:#fff; font-size:12px; font-weight:800; }
        .se-save { margin-left:auto; border:none; cursor:pointer; background:${theme.accent}; color:#fff; border-radius:10px;
                   padding:12px 26px; font-size:15px; font-weight:800; font-family:'Barlow',sans-serif; box-shadow:0 4px 12px ${theme.soft}; }
        .se-save:disabled { opacity:.5; cursor:default; box-shadow:none; }

        .se-filters { display:flex; gap:12px; flex-wrap:wrap; align-items:flex-end; margin-bottom:16px; }
        .se-list-tbl { width:100%; border-collapse:collapse; }
        .se-list-tbl th { background:#1e3a8a; color:#fff; font-size:11.5px; font-weight:700; padding:10px 10px; text-align:left; white-space:nowrap; }
        .se-list-tbl td { border-bottom:1px solid #eef2f7; padding:9px 10px; font-size:12.5px; color:#334155; }
        .se-list-tbl tr:hover td { background:#f8fafc; }
        .se-pct { font-weight:800; }
        .se-st { padding:3px 10px; border-radius:99px; color:#fff; font-size:11px; font-weight:800; white-space:nowrap; }
        .se-exp-btn, .se-del-btn { border:none; background:transparent; cursor:pointer; font-size:14px; padding:3px 6px; }
        .se-exp-btn { color:${theme.accent}; font-weight:800; }
        .se-del-btn { color:#cbd5e1; } .se-del-btn:hover { color:#dc2626; }
        .se-topicgrid { display:grid; grid-template-columns:repeat(auto-fill, minmax(230px,1fr)); gap:6px 18px;
                        padding:10px 14px; background:#f8fafc; border-radius:8px; }
        .se-topicgrid .ti { font-size:11.5px; color:#475569; display:flex; justify-content:space-between; gap:10px; border-bottom:1px dotted #e2e8f0; padding:3px 0; }
        .se-topicgrid .ti b { color:#0f172a; }
        .se-empty { text-align:center; color:#94a3b8; padding:40px; font-size:14px; }

        .se-toast { position:fixed; bottom:26px; left:50%; transform:translateX(-50%); background:#0f172a; color:#fff;
                    padding:13px 24px; border-radius:10px; font-size:13px; font-weight:600; z-index:300; box-shadow:0 8px 24px rgba(0,0,0,.25);
                    max-width:90vw; text-align:center; }
        @media (max-width:640px){ .se-input,.se-select{ min-width:140px; } }
      `}</style>

      <div className="se-root">
        <div className="se-top">
          <div style={{ display:"flex", alignItems:"center", gap:14 }}>
            <button className="se-back" onClick={() => nav("/skill-training")}>← Back</button>
            <div>
              <div className="se-title">Skill <span>Matrix</span></div>
              <div className="se-sub">Skill evaluation · once per 3-month cycle</div>
            </div>
          </div>
          {user?.username && <span style={{ fontSize:12, color:"#64748b", fontWeight:600 }}>{user.username}</span>}
        </div>

        <div className="se-tabs">
          <button className={`se-tab${tab === "dashboard" ? " on" : ""}`} onClick={() => { setTab("dashboard"); loadDash(); }}>📊 Dashboard</button>
          <button className={`se-tab${tab === "form" ? " on" : ""}`} onClick={() => setTab("form")}>📝 Form</button>
          <button className={`se-tab${tab === "list" ? " on" : ""}`} onClick={() => { setTab("list"); loadList(); }}>📋 List</button>
        </div>

        <div className="se-wrap">
          {tab === "dashboard" ? (
            /* ── DASHBOARD ────────────────────────────────────── */
            <div className="se-panel">
              <div className="se-dash-filter">
                <label>Zone</label>
                <select className="se-select" value={dashZone} onChange={(e) => setDashZone(e.target.value)}>
                  <option value="">All Zones (overall)</option>
                  {SKILL_EVAL_ZONES.map((z) => <option key={z.zone} value={z.zone}>{z.zone}</option>)}
                </select>
                {dashZone && <button className="se-back" style={{ padding:"9px 14px" }} onClick={() => setDashZone("")}>✕ Clear</button>}
                <span className="se-dash-scope">{dashZone ? `Showing: ${dashZone}` : "Showing: all zones"}</span>
              </div>
              <div className="se-seedbadge">
                {dashZone
                  ? (dash.evalCount === 0
                      ? `No evaluations recorded for ${dashZone} yet — add one in the Form to see this zone's skill %.`
                      : `${dashZone} — computed from ${dash.evalCount} live evaluation${dash.evalCount === 1 ? "" : "s"} in this zone.`)
                  : (dash.evalCount === 0
                      ? "Initial data from the Excel sheet. Records appear in the List as they are added, and the dashboard stays in sync."
                      : `Live — synced with the Skill Matrix List (${dash.evalCount} record${dash.evalCount === 1 ? "" : "s"}). Add or edit records in the List/Form and the dashboard updates automatically.`)}
              </div>
              {/* headline */}
              <div className="se-dash-top">
                <div className="se-overall">
                  <SkillRing pct={dash.overall} size={132} stroke={13} />
                  <div className="se-overall-l">Overall<br/>Performance</div>
                </div>
                <div className="se-dash-stats">
                  <div className="se-dstat"><div className="se-dstat-v">{dash.employees.length}</div><div className="se-dstat-l">Employees</div></div>
                  <div className="se-dstat"><div className="se-dstat-v">{dash.evalCount}</div><div className="se-dstat-l">Evaluations</div></div>
                  <div className="se-dstat"><div className="se-dstat-v" style={{ color:"#16a34a" }}>{dash.employees.filter((e) => e.pct >= 76).length}</div><div className="se-dstat-l">Level 4 (≥76%)</div></div>
                  <div className="se-dstat"><div className="se-dstat-v" style={{ color:"#dc2626" }}>{dash.employees.filter((e) => e.pct < 51).length}</div><div className="se-dstat-l">Needs training (&lt;51%)</div></div>
                </div>
              </div>

              {/* employee-wise circular indicators */}
              <div className="se-dash-h">Employee-wise Skill %</div>
              <div className="se-ringgrid">
                {dash.employees.map((e) => (
                  <div className="se-ringcard" key={e.name}>
                    <SkillRing pct={e.pct} size={96} />
                    <div className="se-ringname" title={e.name}>{e.name}</div>
                    {e.count > 0 && <div className="se-ringsub">{e.count} eval{e.count === 1 ? "" : "s"}</div>}
                  </div>
                ))}
                {dash.employees.length === 0 && <div className="se-empty">No data yet.</div>}
              </div>

              {/* zone / process / machine summaries */}
              <div className="se-dash-cols">
                {[["Zone-wise", dash.byZone], ["Process-wise / Area", dash.byProcess], ["Machine-wise", dash.byMachine]].map(([title, rows]) => (
                  <div className="se-sumbox" key={title}>
                    <div className="se-sumbox-h">{title}</div>
                    {rows.length === 0 ? <div className="se-sumbox-empty">No data.</div> : rows.map((r) => (
                      <div className="se-bar-row" key={r.name}>
                        <div className="se-bar-l" title={r.name}>{r.name}</div>
                        <div className="se-bar-track"><div className="se-bar-fill" style={{ width: `${r.pct}%`, background: STATUS_COLOR(r.pct) }} /></div>
                        <div className="se-bar-v" style={{ color: STATUS_COLOR(r.pct) }}>{r.pct}%</div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          ) : tab === "form" ? (
            <div className="se-panel">
              {/* Employee + date */}
              <div className="se-row">
                <div className="se-fld">
                  <label>Employee <span className="req">*</span></label>
                  <select className="se-select" value={employee} onChange={(e) => setEmployee(e.target.value)}>
                    <option value="">— Select employee —</option>
                    {SKILL_EVAL_EMPLOYEES.map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                <div className="se-fld">
                  <label>Assessment Date</label>
                  <input className="se-input" type="date" value={assessDate} onChange={(e) => setAssessDate(e.target.value)} />
                </div>
                <div className="se-cyc">Cycle: {cycleLabel(assessDate) || "—"}</div>
              </div>

              {!employee ? (
                <div className="se-need">Select an employee to begin the evaluation.</div>
              ) : (
                <>
                  <div className="se-zlabel">Select Zone</div>
                  <div className="se-zones">
                    {SKILL_EVAL_ZONES.map((z, i) => (
                      <button key={z.zone} className={`se-zone${zoneIdx === i ? " on" : ""}`} onClick={() => selectZone(i)}>
                        <div className="se-zone-n">{z.zone}</div>
                        <div className="se-zone-m">{z.machines.length} machine{z.machines.length > 1 ? "s" : ""}</div>
                      </button>
                    ))}
                  </div>

                  {zone && (
                    <div className="se-row">
                      <div className="se-fld">
                        <label>Machine</label>
                        <select className="se-select" value={machineIdx} onChange={(e) => selectMachine(Number(e.target.value))}>
                          <option value={-1}>— Select machine —</option>
                          {zone.machines.map((m, i) => <option key={i} value={i}>{m.machine}</option>)}
                        </select>
                      </div>
                      <div className="se-fld">
                        <label>Process</label>
                        <select className="se-select" value={machine ? machine.process : ""} disabled>
                          <option value="">{machine ? machine.process : "— Select machine first —"}</option>
                        </select>
                      </div>
                    </div>
                  )}

                  {dup?.exists && (
                    <div className="se-dupwarn">
                      ⚠ {employee} is already evaluated for “{machine?.machine}” in {dup.period_label}. Skill Matrix is
                      filled once per 3-month cycle — change the employee, machine, or date.
                    </div>
                  )}

                  {machine && (
                    <>
                      <table className="se-tbl">
                        <thead>
                          <tr><th className="num" style={{ width:44 }}>#</th><th>Topic</th>
                            <th className="num" style={{ width:90 }}>Out Of</th>
                            <th className="num" style={{ width:150 }}>Actual Marks</th></tr>
                        </thead>
                        <tbody>
                          {topics.map((t, i) => (
                            <tr key={i}>
                              <td className="num">{i + 1}</td>
                              <td>{t.name}</td>
                              <td className="num">{t.max}</td>
                              <td className="num">
                                <input className="se-mark-in" type="number" min="0" max={t.max}
                                       value={marks[t.name] ?? ""} placeholder="0"
                                       onChange={(e) => setMark(t.name, e.target.value, t.max)} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>

                      <div className="se-totbar">
                        <div className="se-tot">Total <b>{totals.tot}</b> / {totals.max}</div>
                        <div className="se-tot">Percentage <b>{totals.pct}%</b></div>
                        <span className="se-badge" style={{ background: STATUS_COLOR(totals.pct) }}>
                          {totals.pct >= 76 ? "Level 4" : totals.pct >= 51 ? "Level 3" : totals.pct >= 26 ? "Level 2" : totals.pct > 0 ? "Level 1" : "Level 0"}
                        </span>
                        <button className="se-save" onClick={save} disabled={saving || dup?.exists}>
                          {saving ? "Saving…" : "💾 Save Evaluation"}
                        </button>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          ) : (
            /* ── LIST ─────────────────────────────────────────── */
            <div className="se-panel">
              <div className="se-filters">
                <div className="se-fld">
                  <label>Assessment Period</label>
                  <select className="se-select" value={fPeriod} onChange={(e) => setFPeriod(e.target.value)}>
                    <option value="">All periods</option>
                    {periods.map((p) => <option key={p.period} value={p.period}>{p.label}{p.is_current ? " (current)" : ""}</option>)}
                  </select>
                </div>
                <div className="se-fld"><label>From</label><input className="se-input" type="date" value={fFrom} onChange={(e) => setFFrom(e.target.value)} /></div>
                <div className="se-fld"><label>To</label><input className="se-input" type="date" value={fTo} onChange={(e) => setFTo(e.target.value)} /></div>
                <div className="se-fld">
                  <label>Zone</label>
                  <select className="se-select" value={fZone} onChange={(e) => { setFZone(e.target.value); setFMachine(""); }}>
                    <option value="">All zones</option>
                    {SKILL_EVAL_ZONES.map((z) => <option key={z.zone} value={z.zone}>{z.zone}</option>)}
                  </select>
                </div>
                <div className="se-fld">
                  <label>Machine</label>
                  <select className="se-select" value={fMachine} onChange={(e) => setFMachine(e.target.value)}>
                    <option value="">All machines</option>
                    {listMachineOpts.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div className="se-fld">
                  <label>Employee</label>
                  <select className="se-select" value={fEmp} onChange={(e) => setFEmp(e.target.value)}>
                    <option value="">All employees</option>
                    {SKILL_EVAL_EMPLOYEES.map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                <div className="se-fld">
                  <label>&nbsp;</label>
                  <button className="se-back" style={{ padding:"9px 16px" }}
                          onClick={() => { setFPeriod(""); setFZone(""); setFMachine(""); setFProcess(""); setFEmp(""); setFFrom(""); setFTo(""); }}>
                    Clear filters
                  </button>
                </div>
              </div>

              <table className="se-list-tbl">
                <thead>
                  <tr>
                    <th>Employee</th><th>Zone</th><th>Machine</th><th>Process</th><th>Date</th><th>Period</th>
                    <th style={{ textAlign:"center" }}>Total</th><th style={{ textAlign:"center" }}>Max</th>
                    <th style={{ textAlign:"center" }}>%</th><th>Status</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {listLoading && <tr><td colSpan={11} className="se-empty">Loading…</td></tr>}
                  {!listLoading && records.length === 0 && <tr><td colSpan={11} className="se-empty">No evaluations found.</td></tr>}
                  {!listLoading && records.map((r) => {
                    const pct = Number(r.percentage) || 0;
                    return (
                      <Fragment key={r.id}>
                        <tr>
                          <td style={{ fontWeight:700, color:"#0f172a" }}>{r.employee}</td>
                          <td>{r.zone}</td><td>{r.machine}</td><td>{r.process}</td>
                          <td>{r.assessment_date ? String(r.assessment_date).slice(0, 10) : ""}</td>
                          <td>{r.period_label}</td>
                          <td style={{ textAlign:"center", fontWeight:700 }}>{Number(r.total_marks)}</td>
                          <td style={{ textAlign:"center" }}>{Number(r.max_marks)}</td>
                          <td className="se-pct" style={{ textAlign:"center", color: STATUS_COLOR(pct) }}>{pct}%</td>
                          <td><span className="se-st" style={{ background: STATUS_COLOR(pct) }}>{r.status}</span></td>
                          <td style={{ whiteSpace:"nowrap" }}>
                            <button className="se-exp-btn" title="Topic scores"
                                    onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                              {expanded === r.id ? "▲" : "▼"}
                            </button>
                            <button className="se-del-btn" title="Delete" onClick={() => removeRec(r.id)}>🗑</button>
                          </td>
                        </tr>
                        {expanded === r.id && (
                          <tr>
                            <td colSpan={11} style={{ padding:"4px 10px 12px" }}>
                              <div className="se-topicgrid">
                                {(Array.isArray(r.topics) ? r.topics : []).map((t, i) => (
                                  <div className="ti" key={i}><span>{t.name}</span><b>{t.mark}/{t.max}</b></div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {toast && <div className="se-toast">{toast}</div>}
      </div>
    </>
  );
}
