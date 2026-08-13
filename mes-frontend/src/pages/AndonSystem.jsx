/* ───────────────────────────────────────────────────────────────────
 * AndonSystem.jsx
 * ───────────────────────────────────────────────────────────────────
 * "ANDON" — standalone Industrial ANDON Management module (sidebar → ANDON).
 * Configured entirely from THIS UI (no source change to add a PLC / department).
 *   • Zone / Line come from the machine master (maintenance_machines), like every page.
 *   • PLC devices: name · ip · port · zone · line · enable.
 *   • Departments: an editable list (Maintenance/Quality/Production/Store …).
 *   • Output mapping: DO1–DO8 → a department (+ display name / priority / enable),
 *     a shared default + per-PLC override.  Time calc (Phase 3) is per-department.
 * Backend: /api/andon/*.  Routing: /andon-system.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const PRIORITIES = ["Critical", "High", "Normal", "Low"];
const PRIO_COLOR = { Critical: "#dc2626", High: "#ea580c", Normal: "#2563eb", Low: "#64748b" };
const prioColor = (p) => PRIO_COLOR[p] || "#2563eb";

// Live board par har call ka apna rang — priority se nahi, DEPARTMENT se.
// (Priority se rang lene par saare "Normal" wale ek jaise neele dikhte the.)
// Plant ka fixed wiring: DO1 Maintenance · DO3 Toolroom · DO5 Quality ·
// DO6 Material · DO7 Other Loss. Naam badla ho to naam se, warna DO index se.
const DEPT_COLOR = {
  maintenance: "#dc2626",   // laal
  toolroom:    "#ea580c",   // narangi
  quality:     "#7c3aed",   // baingani
  material:    "#0d9488",   // teal
  "other loss":"#2563eb",   // neela
  "model setup":"#db2777",  // rose (DO8)
};
const DO_COLOR = { 1:"#dc2626", 2:"#dc2626", 3:"#ea580c", 4:"#ea580c",
                   5:"#7c3aed", 6:"#0d9488", 7:"#2563eb", 8:"#db2777" };
// jo in dono me na mile uske liye stable fallback (naam ke hash se)
const FALLBACK = ["#0891b2", "#c026d3", "#65a30d", "#e11d48", "#4f46e5", "#b45309"];
const deptColor = (ev) => {
  const key = String(ev?.department || ev?.display_name || "").trim().toLowerCase();
  if (DEPT_COLOR[key]) return DEPT_COLOR[key];
  if (DO_COLOR[ev?.do_index]) return DO_COLOR[ev.do_index];
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return FALLBACK[h % FALLBACK.length];
};
const fmtClock = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  const p2 = (n) => String(n).padStart(2, "0");
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return (h ? p2(h) + ":" : "") + p2(m) + ":" + p2(s % 60);
};
// DO2 acknowledges DO1 (Maintenance), DO4 acknowledges DO3 (Toolroom) — an ACK
// output belongs to the SAME department as the call it responds to.
const ACK_PARENT = { 2: 1, 4: 3 };
// ANDON top tabs → per-tab permission sub-key (inherits the andon-system parent
// unless a sub-key is explicitly set to None).
const TAB_KEY = { board: "andon-board", config: "andon-config", reports: "andon-reports" };

export default function AndonSystem() {
  const { token, theme, user, canAccess } = useAuth();
  const nav = useNavigate();
  const accent = theme?.accent || "#dc2626";

  const api = useCallback(async (path, opts = {}) => {
    const r = await fetch(`/api/andon${path}`, {
      ...opts,
      headers: { "Content-Type": "application/json",
                 ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) },
    });
    if (!r.ok) {
      // FastAPI galti ko {"detail":"..."} me bhejta hai — seedha text dikhane
      // par user ko JSON dikhta tha.  Yahan se saaf message nikal lete hain.
      const raw = await r.text().catch(() => "");
      let msg = raw;
      try { const j = JSON.parse(raw); msg = j?.detail || raw; } catch { /* plain text */ }
      const err = new Error(msg || `HTTP ${r.status}`);
      err.status = r.status;            // 409 = takraav (duplicate IP/naam)
      throw err;
    }
    return r.status === 204 ? null : r.json();
  }, [token]);

  const [tab, setTab] = useState("config");
  const [cfg, setCfg] = useState("plc");            // plc | outputs
  const [msg, setMsg] = useState("");
  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(""), 2500); };

  // Default/active tab ko accessible rakho: agar current tab ka access nahi
  // (sub-key None), to board→config→reports me se pehle allowed tab par switch.
  // Guard (early-return + firstOk !== tab) loop rokta hai.
  useEffect(() => {
    if (canAccess(TAB_KEY[tab])) return;
    const firstOk = ["board", "config", "reports"].find((t) => canAccess(TAB_KEY[t]));
    if (firstOk && firstOk !== tab) setTab(firstOk);
  }, [tab, user]);   // eslint-disable-line react-hooks/exhaustive-deps

  const [master, setMaster]   = useState([]);       // flat maintenance_machines rows (zone_name/line_name/machine_no/machine_name)
  const [depts, setDepts]     = useState([]);
  const [plcs, setPlcs]       = useState([]);
  const [events, setEvents]   = useState([]);       // live OPEN calls (the board)
  const [totals, setTotals]   = useState([]);        // aaj ka per-department total loss
  const [, setTick]           = useState(0);         // 1s heartbeat so timers advance smoothly
  // Har chalu call ka "virtual start" (epoch ms) — EK BAAR anchor hota hai.
  // Timer wall-clock se tick karta hai, isliye har second ek-ek badhta hai; 2s
  // poll par dobara anchor NAHI hota, isliye number kabhi jhatka/peeche nahi
  // jaata.  (Tab background me ho kar timer ruk jaye to drift 2s se upar jaata
  // hai — tab hi dobara anchor kar dete hain, taaki wapas aane par sahi ho.)
  const startRefs = useRef({});      // callId -> virtual start (ms)

  // ── Department loss HISTORY (card par click → modal) ──────────────────
  const [histDept, setHistDept] = useState(null);   // khuli history ka department (null = band)
  const [histData, setHistData] = useState(null);   // {rows, total_loss_seconds, calls, show_response}
  const [histLoad, setHistLoad] = useState(false);
  const [histFrom, setHistFrom] = useState("");     // YYYY-MM-DD (plant-day start date)
  const [histTo,   setHistTo]   = useState("");
  const loadHistory = useCallback(async (dept, from, to) => {
    setHistLoad(true);
    try {
      const q = new URLSearchParams({ department: dept });
      if (from) q.set("from", from);
      if (to)   q.set("to", to);
      const d = await api(`/dept-history?${q.toString()}`);
      setHistData(d || null);
      setHistFrom(d?.from || ""); setHistTo(d?.to || "");
    } catch (e) { flash(String(e.message || e).slice(0, 120)); setHistData(null); }
    finally { setHistLoad(false); }
  }, [api]);
  const openHistory = (dept) => { setHistDept(dept); setHistData(null); loadHistory(dept); };

  // ── Reports → TOTAL LOSS (union) ──────────────────────────────────────
  // Sab department ke call-windows ko MERGE karke total plant-downtime.  Ek
  // waqt par ek hi loss (overlap ek baar) — Maintenance chalu me Toolroom bhi
  // dab jaye to bhi wo time ek hi baar gina jaata hai.  Backend: /total-loss.
  const [tlData, setTlData] = useState(null);   // {total_loss_seconds, raw_sum_seconds, calls, from, to}
  const [tlLoad, setTlLoad] = useState(false);
  const [tlFrom, setTlFrom] = useState("");
  const [tlTo,   setTlTo]   = useState("");
  const loadTotalLoss = useCallback(async (from, to) => {
    setTlLoad(true);
    try {
      const q = new URLSearchParams();
      if (from) q.set("from", from);
      if (to)   q.set("to", to);
      const d = await api(`/total-loss${q.toString() ? "?" + q.toString() : ""}`);
      setTlData(d || null);
      setTlFrom(d?.from || ""); setTlTo(d?.to || "");
    } catch (e) { flash(String(e.message || e).slice(0, 120)); setTlData(null); }
    finally { setTlLoad(false); }
  }, [api]);
  // reports tab khulte hi aaj ka total; phir har 3s refresh taaki chalu calls
  // (jinka end = abhi) ka loss live badhta rahe.  Sirf tabhi jab range aaj ho.
  useEffect(() => {
    if (!token || tab !== "reports") return;
    let alive = true;
    if (!tlData) loadTotalLoss();
    const id = setInterval(() => {
      const ymd = (dt) => `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")}`;
      const n = new Date(); const d = new Date(n); if (n.getHours() < 7) d.setDate(d.getDate()-1);
      const today = ymd(d);
      if (alive && tlFrom === today && tlTo === today) loadTotalLoss(tlFrom, tlTo);
    }, 3000);
    return () => { alive = false; clearInterval(id); };
  }, [token, tab, tlFrom, tlTo, tlData, loadTotalLoss]);

  const load = useCallback(async () => {
    try {
      const [mc, d, e] = await Promise.all([
        fetch("/api/machines/", { headers: { Authorization: `Bearer ${token}` } }).then((r) => (r.ok ? r.json() : [])).catch(() => []),
        api("/departments").catch(() => []), api("/plc-devices").catch(() => []),
      ]);
      setMaster(Array.isArray(mc) ? mc : []); setDepts(d || []); setPlcs(e || []);
    } catch (err) { flash(String(err.message || err).slice(0, 120)); }
  }, [api, token]);
  useEffect(() => { if (token) load(); }, [token, load]);
  // live PLC connectivity — re-poll the list every 10s so the green/red dots update
  useEffect(() => {
    if (!token) return;
    const id = setInterval(() => { api("/plc-devices").then((e) => setPlcs(e || [])).catch(() => {}); }, 10000);
    return () => clearInterval(id);
  }, [token, api]);
  // ── Live board: pull active calls every 300ms while the board tab is open ──
  useEffect(() => {
    if (!token || tab !== "board") return;
    let alive = true;
    const pull = () => {
      api("/events").then((e) => {
        if (!alive) return;
        const list = Array.isArray(e) ? e : [];
        const refs = startRefs.current;
        const now = Date.now();
        const live = new Set();
        for (const ev of list) {
          live.add(ev.id);
          const srv = ev.elapsed_seconds || 0;
          const anchored = refs[ev.id];
          // pehli baar dikhi call → server ke elapsed se anchor karo (skew-free).
          // pehle se anchored → chhodo, TAAKI number smooth chale — sirf tab
          // dobara anchor karo jab humara hisaab server se 2 sec+ hat gaya ho
          // (jaise tab background me ruk gaya tha).
          if (anchored == null || Math.abs(Math.floor((now - anchored) / 1000) - srv) > 2) {
            refs[ev.id] = now - srv * 1000;
          }
        }
        for (const k of Object.keys(refs)) if (!live.has(Number(k))) delete refs[k];  // band calls bhulo
        setEvents(list);
      }).catch(() => {});
      // aaj ka per-department total loss — upar ke cards ke liye (same poll)
      api("/today-totals").then((t) => { if (alive) setTotals(t?.departments || []); }).catch(() => {});
    };
    pull();
    // 300ms par — PLC bit press karte hi call turant screen pe aaye (backend poll
    // ab 100ms hai; UI 1s tha to ~1s dikhaई-delay aata tha).  Endpoint ~20ms ka
    // hai, to 300ms poll par bhi load na ke barabar.
    const id = setInterval(pull, 300);
    return () => { alive = false; clearInterval(id); };
  }, [token, tab, api]);
  // 1s heartbeat so the running timers advance between the 300ms polls
  useEffect(() => {
    if (tab !== "board") return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [tab]);
  // elapsed = wall-clock since is call ka anchor.  Anchor server ke elapsed se
  // bana tha (skew-free), aur poll par badalta nahi — isliye number har second
  // ek-ek smooth badhta hai, jhatka nahi.
  const liveElapsed = (ev) => {
    const ref = startRefs.current[ev.id];
    if (ref == null) return ev.elapsed_seconds || 0;   // abhi anchor nahi hua (pehla render)
    return Math.max(0, Math.floor((Date.now() - ref) / 1000));
  };
  // group active calls by the PLC's defined zone / line
  const eventsByLine = useMemo(() => {
    const g = {};
    for (const ev of events) { const k = `${ev.zone || "—"} / ${ev.line || "—"}`; (g[k] = g[k] || []).push(ev); }
    return g;
  }, [events]);
  // Takraav (409) = wahi IP/naam kisi aur PLC ki hai.  Ye chhote toast me
  // dabana theek nahi — galat IP par do board ka data ek jagah chala jayega
  // aur pata bhi nahi chalega.  Isliye poora popup, jo khud gayab na ho.
  const [alertBox, setAlertBox] = useState(null);   // { title, text }
  const wrap = async (fn, ok) => {
    try {
      await fn();
      await load();
      if (ok) flash(ok);
    } catch (e) {
      const text = String(e?.message || e);
      if (e?.status === 409) setAlertBox({ title: "Ye IP / naam pehle se use me hai", text });
      else flash(text.slice(0, 140));
    }
  };

  // ── Departments ──
  const [dName, setDName] = useState("");

  // ── PLC form (zone / line from the machine master) ──
  const blankPlc = { name: "", ip: "", port: 5007, series: "Q", zone: "", line: "", machine_no: "", machine_name: "", enabled: true };
  const [plcForm, setPlcForm] = useState(blankPlc);
  const [plcEdit, setPlcEdit] = useState(null);
  // zone → line → machine cascade, all from the machine master (like every page)
  const plcZones    = useMemo(() => [...new Set(master.map((m) => m.zone_name).filter(Boolean))].sort(), [master]);
  const plcLines    = useMemo(() => plcForm.zone ? [...new Set(master.filter((m) => m.zone_name === plcForm.zone).map((m) => m.line_name).filter(Boolean))].sort() : [], [master, plcForm.zone]);
  const plcMachines = useMemo(() => (plcForm.zone && plcForm.line) ? [...new Set(master.filter((m) => m.zone_name === plcForm.zone && m.line_name === plcForm.line).map((m) => m.machine_no).filter(Boolean))].sort() : [], [master, plcForm.zone, plcForm.line]);
  const onPlcMachine = (v) => {
    const m = master.find((x) => x.zone_name === plcForm.zone && x.line_name === plcForm.line && String(x.machine_no) === String(v));
    setPlcForm((f) => ({ ...f, machine_no: v, machine_name: m?.machine_name || "" }));
  };
  const startPlcEdit = (e) => { setPlcEdit(e.id); setPlcForm({ ...blankPlc, ...e, series: e.series || "Q", zone: e.zone || "", line: e.line || "", machine_no: e.machine_no || "", machine_name: e.machine_name || "" }); setCfg("plc"); };
  const savePlc = () => wrap(async () => {
    const body = { name: plcForm.name, ip: plcForm.ip, port: Number(plcForm.port) || 80,
                   series: plcForm.series || "Q",
                   zone: plcForm.zone || "", line: plcForm.line || "", machine_no: plcForm.machine_no || "",
                   machine_name: plcForm.machine_name || "", enabled: plcForm.enabled };
    if (plcEdit) await api(`/plc-devices/${plcEdit}`, { method: "PUT", body: JSON.stringify(body) });
    else await api("/plc-devices", { method: "POST", body: JSON.stringify(body) });
    setPlcForm(blankPlc); setPlcEdit(null);
  }, plcEdit ? "PLC updated" : "PLC added");

  // ── Output mapping (default template OR a specific PLC) ──
  const [outFor, setOutFor] = useState({ type: "default", id: null, name: "Default template" });
  const [outRows, setOutRows] = useState([]);
  const [outZone, setOutZone] = useState("");
  const [outLine, setOutLine] = useState("");
  const loadOutputs = useCallback(async (target) => {
    setOutFor(target);
    const rows = target.type === "default" ? await api("/outputs/default") : await api(`/plc-devices/${target.id}/outputs`);
    setOutRows(rows || []); setCfg("outputs");
  }, [api]);
  const outLinesFor = (z) => z ? [...new Set(master.filter((m) => m.zone_name === z).map((m) => m.line_name).filter(Boolean))].sort() : [];
  // Output mapping target: no zone = the shared Default template; zone + line =
  // the PLC sitting on that zone/line (its own override).
  const pickOutTarget = (zone, line) => {
    setOutZone(zone); setOutLine(line);
    if (!zone) { loadOutputs({ type: "default", id: null, name: "Default template" }); return; }
    if (zone && line) {
      const e = plcs.find((x) => x.zone === zone && x.line === line);
      if (e) loadOutputs({ type: "plc", id: e.id, name: `${e.name} — ${zone} / ${line}` });
      else { setOutFor({ type: "none", id: null, name: `No PLC on ${zone} / ${line}` }); setOutRows([]); }
    } else { setOutFor({ type: "pick", id: null, name: "Select a line" }); setOutRows([]); }
  };
  useEffect(() => { if (token && cfg === "outputs" && !outRows.length) loadOutputs({ type: "default", id: null, name: "Default template" }); /* eslint-disable-next-line */ }, [cfg, token]);
  const setOut = (i, k, v) => setOutRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const saveOutputs = () => wrap(async () => {
    const body = { rows: outRows.map((r) => ({ do_index: r.do_index, display_name: r.display_name,
      department_id: r.department_id || null, priority: r.priority || "Normal", enabled: r.enabled !== false,
      bit_type: r.bit_type || "", bit_no: r.bit_no || "" })) };
    if (outFor.type === "default") await api("/outputs/default", { method: "PUT", body: JSON.stringify(body) });
    else await api(`/plc-devices/${outFor.id}/outputs`, { method: "PUT", body: JSON.stringify(body) });
  }, "Output mapping saved");
  // each department appears ONCE — its dropdown excludes departments used by other rows
  const deptUsedElsewhere = (i) => new Set(outRows.filter((_, j) => j !== i).map((r) => r.department_id).filter(Boolean));
  const onOutDept = (i, deptId) => {
    const d = depts.find((x) => x.id === deptId);
    setOutRows((rs) => rs.map((r, j) => (j === i ? { ...r, department_id: deptId, display_name: d ? d.name : (r.display_name || "") } : r)));
  };
  const addOutput = () => {
    if (outRows.length >= 8) { flash("Max 8 outputs (DO1–DO8)"); return; }
    const usedDo = new Set(outRows.map((r) => r.do_index));
    let nd = 1; while (usedDo.has(nd) && nd < 8) nd++;
    const used = new Set(outRows.map((r) => r.department_id).filter(Boolean));
    const free = depts.find((d) => !used.has(d.id));
    setOutRows((rs) => [...rs, { do_index: nd, department_id: free?.id || null,
      display_name: free ? free.name : "", priority: "Normal", enabled: true }]);
  };
  const removeOutput = (i) => setOutRows((rs) => rs.filter((_, j) => j !== i));

  return (
    <>
      <style>{`
        .an-root { min-height:100vh; background:#eef2f7; font-family:'Barlow',system-ui,sans-serif; padding-bottom:44px; }
        .an-top { background:#fff; border-bottom:1px solid #e2e8f0; height:58px; padding:0 26px 0 92px;
                  display:flex; align-items:center; justify-content:space-between; position:sticky; top:0; z-index:40; }
        .an-top::after { content:''; position:absolute; bottom:0; left:0; right:0; height:2px; background:${theme?.gradient || accent}; }
        .an-ttl { font-size:20px; font-weight:800; color:#0f172a; } .an-ttl span { color:${accent}; }
        .an-back,.an-btn { font-size:13px; font-weight:700; border-radius:8px; padding:8px 14px; cursor:pointer; border:1px solid #e2e8f0; }
        .an-back { color:#475569; background:#f1f5f9; }
        .an-btn { background:${accent}; color:#fff; border-color:${accent}; } .an-btn.gh { background:#fff; color:#334155; }
        .an-btn.sm { padding:5px 10px; font-size:12px; } .an-btn:disabled { opacity:.5; cursor:not-allowed; }
        .an-body { max-width:1180px; margin:16px auto 0; padding:0 22px; }
        .an-tabs { display:flex; gap:8px; margin-bottom:16px; }
        .an-tab { border:1px solid #cbd5e1; background:#fff; color:#334155; font-weight:700; font-size:13px; padding:9px 18px; border-radius:99px; cursor:pointer; }
        .an-tab.on { background:${accent}; color:#fff; border-color:${accent}; }
        .an-ctabs { display:flex; gap:6px; margin-bottom:14px; }
        .an-ctab { border:1px solid #cbd5e1; background:#fff; color:#475569; font-weight:700; font-size:12.5px; padding:7px 16px; border-radius:8px; cursor:pointer; }
        .an-ctab.on { background:#0f172a; color:#fff; border-color:#0f172a; }
        .an-card { background:#fff; border:1px solid #e2e8f0; border-radius:13px; padding:16px; box-shadow:0 1px 4px rgba(15,23,42,.05); }
        .an-row { display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
        .an-in { border:1.5px solid #cbd5e1; border-radius:8px; padding:8px 11px; font-size:13px; font-family:inherit; outline:none; }
        .an-in:focus { border-color:${accent}; } .an-in:disabled { background:#f1f5f9; color:#94a3b8; }
        .an-tbl { width:100%; border-collapse:collapse; font-size:13px; margin-top:6px; }
        .an-tbl th { text-align:left; padding:8px 10px; font-size:10px; font-weight:800; letter-spacing:.04em; text-transform:uppercase; color:#64748b; border-bottom:1px solid #e2e8f0; }
        .an-tbl td { padding:9px 10px; border-bottom:1px solid #f1f5f9; color:#334155; }
        .an-x { border:none; background:transparent; color:#dc2626; cursor:pointer; font-weight:800; font-size:16px; }
        .an-lbl { font-size:10.5px; font-weight:800; letter-spacing:.04em; text-transform:uppercase; color:#64748b; margin-bottom:4px; display:block; }
        .an-chip { display:inline-flex; align-items:center; gap:6px; font-size:12.5px; font-weight:700; padding:5px 6px 5px 11px; border-radius:99px; }
        .an-panel { background:#fff; border:1px solid #e2e8f0; border-radius:13px; padding:34px; text-align:center; }
        .an-panel .big { font-size:40px; } .an-panel h2 { font-size:17px; font-weight:800; color:#0f172a; margin:10px 0 6px; }
        .an-panel p { font-size:13px; color:#64748b; max-width:560px; margin:0 auto; line-height:1.6; }
        .an-msg { position:fixed; bottom:20px; left:50%; transform:translateX(-50%); background:#0f172a; color:#fff; padding:10px 18px; border-radius:10px; font-size:13px; font-weight:600; z-index:9999; box-shadow:0 8px 24px rgba(0,0,0,.3); }
      `}</style>

      <div className="an-root">
        <div className="an-top">
          <div style={{ display:"flex", alignItems:"center", gap:14 }}>
            <button className="an-back" onClick={() => nav("/dashboard")}>← Back</button>
            <div>
              <div className="an-ttl">🚦 ANDON <span>Management</span></div>
            </div>
          </div>
          {user?.username && <span style={{ fontSize:12, color:"#64748b", fontWeight:600 }}>{user.username}</span>}
        </div>

        <div className="an-body">
          <div className="an-tabs">
            {[["board","Live Board"],["config","Configuration"],["reports","Reports"]]
              .filter(([k]) => canAccess(TAB_KEY[k]))
              .map(([k, l]) => (
              <button key={k} className={`an-tab${tab === k ? " on" : ""}`} onClick={() => setTab(k)}>{l}</button>
            ))}
          </div>

          {tab === "config" && canAccess("andon-config") && (
            <>
              <div className="an-ctabs">
                {[["plc","PLC Devices"],["outputs","Outputs"]].map(([k, l]) => (
                  <button key={k} className={`an-ctab${cfg === k ? " on" : ""}`} onClick={() => setCfg(k)}>{l}</button>
                ))}
              </div>

              {/* ── PLC DEVICES ── */}
              {cfg === "plc" && (
                <>
                  <div className="an-card" style={{ marginBottom:14 }}>
                    <b style={{ fontSize:14 }}>{plcEdit ? "Edit PLC" : "Add PLC"}</b>
                    <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, marginTop:12 }}>
                      <div><label className="an-lbl">Zone</label>
                        <select className="an-in" style={{ width:"100%" }} value={plcForm.zone} onChange={(e) => setPlcForm({ ...plcForm, zone: e.target.value, line: "", machine_no: "", machine_name: "" })}>
                          <option value="">— select —</option>{plcZones.map((z) => <option key={z} value={z}>{z}</option>)}
                        </select></div>
                      <div><label className="an-lbl">Line</label>
                        <select className="an-in" style={{ width:"100%" }} value={plcForm.line} disabled={!plcForm.zone} onChange={(e) => setPlcForm({ ...plcForm, line: e.target.value, machine_no: "", machine_name: "" })}>
                          <option value="">— select —</option>{plcLines.map((l) => <option key={l} value={l}>{l}</option>)}
                        </select></div>
                      <div><label className="an-lbl">Machine No</label>
                        <select className="an-in" style={{ width:"100%" }} value={plcForm.machine_no} disabled={!plcForm.line} onChange={(e) => onPlcMachine(e.target.value)}>
                          <option value="">— select —</option>{plcMachines.map((mc) => <option key={mc} value={mc}>{mc}</option>)}
                        </select>
                        {plcForm.machine_name && <div style={{ fontSize:11, color:"#94a3b8", marginTop:3 }}>{plcForm.machine_name}</div>}
                      </div>
                      <div><label className="an-lbl">PLC IP</label><input className="an-in" style={{ width:"100%" }} value={plcForm.ip} onChange={(e) => setPlcForm({ ...plcForm, ip: e.target.value })} placeholder="192.168.30.101" /></div>
                      <div><label className="an-lbl">Port</label><input className="an-in" style={{ width:"100%" }} type="number" value={plcForm.port} onChange={(e) => setPlcForm({ ...plcForm, port: e.target.value })} placeholder="5007" /></div>
                      <div><label className="an-lbl">Series</label>
                        <select className="an-in" style={{ width:"100%" }} value={plcForm.series || "Q"} onChange={(e) => setPlcForm({ ...plcForm, series: e.target.value })}>
                          {["Q","FX5U","iQ-R","L"].map((s) => <option key={s} value={s}>{s}</option>)}
                        </select></div>
                      <div><label className="an-lbl">Device Name</label><input className="an-in" style={{ width:"100%" }} value={plcForm.name} onChange={(e) => setPlcForm({ ...plcForm, name: e.target.value })} placeholder="e.g. Zone A Line 1" /></div>
                    </div>
                    <div className="an-row" style={{ marginTop:12 }}>
                      <label style={{ fontSize:13, fontWeight:700, display:"flex", alignItems:"center", gap:6 }}>
                        <input type="checkbox" checked={plcForm.enabled} onChange={(e) => setPlcForm({ ...plcForm, enabled: e.target.checked })} /> Enabled (poll this PLC)
                      </label>
                      <div style={{ marginLeft:"auto" }} />
                      {plcEdit && <button className="an-btn gh" onClick={() => { setPlcEdit(null); setPlcForm(blankPlc); }}>Cancel</button>}
                      <button className="an-btn" disabled={!plcForm.name.trim() || !plcForm.ip.trim()} onClick={savePlc}>{plcEdit ? "Save" : "+ Add PLC"}</button>
                    </div>
                    {!plcZones.length && <div style={{ fontSize:12, color:"#b45309", marginTop:8 }}>No zones in the machine master (maintenance_machines) yet — zone/line/machine list is empty.</div>}
                  </div>
                  <div className="an-card">
                    <b style={{ fontSize:14 }}>PLC Devices ({plcs.length})</b>
                    <table className="an-tbl">
                      <thead><tr><th>Name</th><th>IP:Port</th><th>Zone / Line / M/C</th><th>Connection</th><th>Status</th><th></th></tr></thead>
                      <tbody>
                        {plcs.map((e) => (
                          <tr key={e.id}>
                            <td style={{ fontWeight:600 }}>{e.name}</td>
                            <td>{e.ip}:{e.port}{e.series && <span style={{ marginLeft:6, fontSize:10, fontWeight:700, color:"#64748b", background:"#f1f5f9", padding:"1px 6px", borderRadius:99 }}>{e.series}</span>}</td>
                            <td>{[e.zone, e.line, e.machine_no].filter(Boolean).join(" / ") || "—"}</td>
                            <td>
                              {!e.enabled ? <span style={{ color:"#94a3b8", fontSize:12 }}>— off —</span> : (
                                <span style={{ display:"inline-flex", alignItems:"center", gap:7, fontWeight:700, fontSize:12,
                                               color: e.online === true ? "#16a34a" : e.online === false ? "#dc2626" : "#94a3b8" }}
                                      title={e.last_seen ? `last seen ${e.last_seen}` : (e.checked ? `checked ${e.checked}` : "")}>
                                  <span style={{ width:10, height:10, borderRadius:"50%", flex:"0 0 auto",
                                                 background: e.online === true ? "#16a34a" : e.online === false ? "#dc2626" : "#cbd5e1",
                                                 boxShadow: e.online === true ? "0 0 0 3px rgba(22,163,74,.2)" : e.online === false ? "0 0 0 3px rgba(220,38,38,.2)" : "none" }} />
                                  {e.online === true ? "Connected" : e.online === false ? "Disconnected" : "Checking…"}
                                </span>
                              )}
                            </td>
                            <td><span className="an-chip" style={{ padding:"2px 9px", background: e.enabled ? "#dcfce7" : "#fee2e2", color: e.enabled ? "#16a34a" : "#dc2626" }}>{e.enabled ? "Enabled" : "Disabled"}</span></td>
                            <td style={{ whiteSpace:"nowrap" }}>
                              <button className="an-btn gh sm" onClick={() => loadOutputs({ type:"plc", id:e.id, name:e.name })}>🔌 Outputs</button>{" "}
                              <button className="an-btn gh sm" onClick={() => startPlcEdit(e)}>Edit</button>{" "}
                              <button className="an-x" onClick={() => wrap(() => api(`/plc-devices/${e.id}`, { method:"DELETE" }), "PLC removed")}>×</button>
                            </td>
                          </tr>
                        ))}
                        {!plcs.length && <tr><td colSpan={6} style={{ color:"#94a3b8" }}>No PLC devices yet.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {/* ── OUTPUTS (departments + DO1–DO8 → department) ── */}
              {cfg === "outputs" && (
                <>
                  <div className="an-card" style={{ marginBottom:14 }}>
                    <b style={{ fontSize:14 }}>Departments</b>
                    <div style={{ fontSize:11.5, color:"#94a3b8", margin:"4px 0 10px" }}>Every output maps to one of these. Time calculation is per-department.</div>
                    <div className="an-row">
                      {depts.map((d) => (
                        <span key={d.id} className="an-chip" style={{ background: (d.color || "#2563eb") + "1a", color: d.color || "#2563eb" }}>
                          {d.name}
                          <button className="an-x" style={{ fontSize:14, color:"inherit", opacity:.7 }} onClick={() => wrap(() => api(`/departments/${d.id}`, { method:"DELETE" }), "Department removed")}>×</button>
                        </span>
                      ))}
                    </div>
                    <div className="an-row" style={{ marginTop:12 }}>
                      <input className="an-in" placeholder="New department" value={dName} onChange={(e) => setDName(e.target.value)} style={{ width:240 }} />
                      <button className="an-btn" disabled={!dName.trim()}
                              onClick={() => wrap(async () => { await api("/departments", { method:"POST", body: JSON.stringify({ name: dName.trim() }) }); setDName(""); }, "Department added")}>+ Add</button>
                    </div>
                  </div>

                  <div className="an-card">
                    <div className="an-row" style={{ marginBottom:6 }}>
                      <b style={{ fontSize:14 }}>Output Mapping</b>
                      {outFor?.name && <span style={{ fontSize:11.5, color:"#64748b", fontWeight:600 }}>· {outFor.name}</span>}
                      <span style={{ marginLeft:"auto", fontSize:11.5, color:"#94a3b8" }}>PLC bit — 1=ON, 0=OFF. Department scheme fixed for every PLC.</span>
                    </div>
                    <table className="an-tbl">
                      <thead><tr><th style={{ width:200 }}>Output</th><th>Department / role</th><th style={{ width:120 }}>Bit Type</th><th style={{ width:130 }}>Bit No</th></tr></thead>
                      <tbody>
                        {outRows.map((r, i) => {
                          const parentDo = ACK_PARENT[r.do_index];               // DO2→DO1, DO4→DO3
                          const isAck = !!parentDo;
                          const deptId = isAck ? outRows.find((x) => x.do_index === parentDo)?.department_id : r.department_id;
                          const dept = depts.find((d) => d.id === deptId);
                          return (
                            <tr key={r.do_index}>
                              <td style={{ fontWeight:800 }}>
                                {r.display_name || `OUT${r.do_index}`}
                                <div style={{ fontSize:10.5, fontWeight:600, color:"#94a3b8" }}>OUT{r.do_index}</div>
                              </td>
                              <td>
                                <span style={{ fontWeight:700 }}>{dept ? dept.name : (r.display_name || "—")}</span>
                                {isAck && <span style={{ fontSize:10.5, fontWeight:600, color:"#94a3b8", marginLeft:8 }}>⏱ response time</span>}
                              </td>
                              <td>
                                <select className="an-in" style={{ width:"100%", padding:"6px 8px" }} value={r.bit_type || ""} onChange={(e) => setOut(i, "bit_type", e.target.value)}>
                                  <option value="">—</option>
                                  {["M","Y","X","L","D"].map((b) => <option key={b} value={b}>{b}</option>)}
                                </select>
                              </td>
                              <td>
                                <input className="an-in" style={{ width:"100%", padding:"6px 8px" }} value={r.bit_no || ""} onChange={(e) => setOut(i, "bit_no", e.target.value)} placeholder="e.g. 100" />
                              </td>
                            </tr>
                          );
                        })}
                        {!outRows.length && <tr><td colSpan={4} style={{ color:"#94a3b8" }}>Loading…</td></tr>}
                      </tbody>
                    </table>
                    <div className="an-row" style={{ marginTop:12, justifyContent:"flex-end" }}>
                      <button className="an-btn" onClick={saveOutputs}>Save bit mapping</button>
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {tab === "board" && canAccess("andon-board") && (
            <>
              <div className="an-row" style={{ marginBottom:14, justifyContent:"space-between", alignItems:"center" }}>
                <b style={{ fontSize:16, color:"#0f172a" }}>🚦 Live ANDON Board</b>
                <span style={{ fontSize:12, color:"#64748b", fontWeight:600 }}>
                  <span style={{ display:"inline-block", width:8, height:8, borderRadius:99, background:"#16a34a", marginRight:6 }} />
                  {events.length} active call{events.length === 1 ? "" : "s"} · auto-refresh 0.3s
                </span>
              </div>

              {/* ── Aaj ka per-department TOTAL LOSS — chote cards (7AM–6:30AM plant day).
                  band + chalu dono calls ka down-time; response yahan nahi. ── */}
              <div style={{ display:"grid", gap:10, marginBottom:16,
                            gridTemplateColumns:`repeat(${Math.max(totals.length,1)}, minmax(0,1fr))` }}>
                {totals.map((t) => (
                  <div key={t.department} onClick={() => openHistory(t.department)}
                       title={`${t.department} ki poori history dekho`}
                       style={{
                        background:"#fff", border:"1px solid #e2e8f0", borderRadius:12,
                        padding:"12px 14px", borderTop:`3px solid ${t.color || "#64748b"}`,
                        boxShadow:"0 1px 3px rgba(0,0,0,.04)", cursor:"pointer",
                        transition:"box-shadow .12s, transform .12s" }}
                       onMouseEnter={(e) => { e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,.10)"; e.currentTarget.style.transform = "translateY(-1px)"; }}
                       onMouseLeave={(e) => { e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,.04)"; e.currentTarget.style.transform = "none"; }}>
                    <div style={{ fontSize:11, fontWeight:800, letterSpacing:".04em",
                                  textTransform:"uppercase", color:"#64748b",
                                  whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                      {t.department}
                    </div>
                    <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:26,
                                  fontWeight:800, color:"#0f172a", lineHeight:1.15 }}>
                      {/* band calls ka total (server) + is dept ke chalu calls ka
                          SMOOTH elapsed — isliye card bhi har second tick karta hai */}
                      {fmtClock(
                        (t.closed_loss_seconds ?? t.total_loss_seconds ?? 0) +
                        events.filter((ev) => ev.department === t.department)
                              .reduce((s, ev) => s + liveElapsed(ev), 0)
                      )}
                    </div>
                    <div style={{ fontSize:10.5, color:"#94a3b8", fontWeight:600,
                                  display:"flex", justifyContent:"space-between", gap:6 }}>
                      <span>total loss · {t.calls} call{t.calls === 1 ? "" : "s"}</span>
                      <span style={{ color:"#94a3b8" }}>history ↗</span>
                    </div>
                  </div>
                ))}
              </div>

              {!events.length ? (
                <div className="an-panel"><div className="big">✅</div><h2>All clear</h2>
                  <p>No active ANDON calls right now. Press a button on the PLC — the call appears here on its defined line, with a running timer.</p></div>
              ) : (
                Object.entries(eventsByLine).map(([line, evs]) => (
                  <div key={line} className="an-card" style={{ marginBottom:14 }}>
                    <div style={{ fontSize:13.5, fontWeight:800, color:"#0f172a", marginBottom:12 }}>📍 {line}</div>
                    {/* Saare active calls EK hi row me — jitne calls utne columns, sab
                        BARABAR chaudai me aur screen ke hisab se apne aap shrink.  minmax(0,1fr)
                        se scroll nahi hoti (5 ho ya 8, sab fit).  Har card ek container hai,
                        andar ke fonts card ki chaudai (cqi) se scale hote hain. */}
                    <div style={{ display:"grid", gridTemplateColumns:`repeat(${evs.length},minmax(0,1fr))`,
                                  gap:10, paddingBottom:2 }}>
                      {evs.map((ev) => {
                        const c = deptColor(ev);            // card ka rang = department ka rang
                        const acked = !!ev.acknowledged_at;
                        return (
                          <div key={ev.id} style={{ border:`1px solid ${c}33`, borderLeft:`5px solid ${c}`, borderRadius:11,
                                                     padding:"11px 13px", background:`${c}0d`, minWidth:0,
                                                     containerType:"inline-size", overflow:"hidden" }}>
                            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:6 }}>
                              <div style={{ fontSize:"clamp(12px,9cqi,15.5px)", fontWeight:800, color:"#0f172a",
                                            lineHeight:1.2, minWidth:0, overflowWrap:"anywhere" }}>
                                {ev.display_name || ev.department || `OUT${ev.do_index}`}
                              </div>
                              {(() => { const pc = prioColor(ev.priority);   // badge ka rang priority ka hi rahega
                                return (
                              <span style={{ fontSize:9.5, fontWeight:800, color:pc, background:`${pc}1a`, padding:"3px 8px",
                                             borderRadius:99, textTransform:"uppercase", whiteSpace:"nowrap" }}>{ev.priority || "Normal"}</span>
                                ); })()}
                            </div>
                            {ev.department && ev.department !== ev.display_name &&
                              <div style={{ fontSize:11.5, color:"#64748b", marginTop:1, whiteSpace:"nowrap",
                                            overflow:"hidden", textOverflow:"ellipsis" }}>{ev.department}</div>}
                            <div style={{ fontSize:"clamp(20px,17cqi,28px)", fontWeight:800, color:c,
                                          fontVariantNumeric:"tabular-nums", margin:"7px 0 3px" }}>
                              {fmtClock(liveElapsed(ev))}
                            </div>
                            <div style={{ fontSize:10.5, color:"#94a3b8", whiteSpace:"nowrap", overflow:"hidden",
                                          textOverflow:"ellipsis" }}>OUT{ev.do_index} · {ev.plc_name || "PLC"}</div>
                            <div style={{ marginTop:7, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                              {acked
                                ? <span style={{ fontSize:10.5, fontWeight:700, color:"#16a34a" }}>
                                    ✓ Responded in {fmtClock((new Date(ev.acknowledged_at) - new Date(ev.started_at)) / 1000)}
                                  </span>
                                : <span style={{ fontSize:10.5, fontWeight:700, color:"#b45309" }}>● Waiting for response…</span>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </>
          )}
          {tab === "reports" && canAccess("andon-reports") && (() => {
            const ymd = (dt) => `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")}`;
            const plantToday = () => { const n = new Date(); const d = new Date(n); if (n.getHours() < 7) d.setDate(d.getDate()-1); return ymd(d); };
            const addDays = (s, n) => { if (!s) return plantToday(); const [y,m,dd] = s.split("-").map(Number); const dt = new Date(y, m-1, dd); dt.setDate(dt.getDate()+n); return ymd(dt); };
            const sameRange = tlData && tlFrom === tlTo;
            const overlap = tlData ? Math.max(0, (tlData.raw_sum_seconds || 0) - (tlData.total_loss_seconds || 0)) : 0;
            return (
            <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
              {/* Total Loss card */}
              <div style={{ background:"#fff", border:"1px solid #e2e8f0", borderRadius:16,
                            boxShadow:"0 1px 3px rgba(0,0,0,.06)", overflow:"hidden", maxWidth:640 }}>
                {/* header + date filter */}
                <div style={{ padding:"16px 20px", borderBottom:"1px solid #f1f5f9" }}>
                  <div style={{ fontSize:16, fontWeight:800, color:"#0f172a" }}>Total Loss</div>
                  <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap", marginTop:12 }}>
                    {[["Today", 0], ["Yesterday", -1]].map(([lbl, off]) => {
                      const dt = addDays(plantToday(), off);
                      const active = tlFrom === dt && tlTo === dt;
                      return (
                        <button key={lbl} onClick={() => loadTotalLoss(dt, dt)}
                                style={{ border:"1px solid #cbd5e1", borderRadius:8, padding:"6px 12px",
                                         fontWeight:700, fontSize:12.5, cursor:"pointer",
                                         background: active ? "#1e40af" : "#fff",
                                         color: active ? "#fff" : "#334155" }}>{lbl}</button>
                      );
                    })}
                    <span style={{ color:"#cbd5e1" }}>|</span>
                    <label style={{ fontSize:12, color:"#64748b", fontWeight:600 }}>From
                      <input type="date" value={tlFrom} onChange={(e) => setTlFrom(e.target.value)}
                             style={{ marginLeft:6, padding:"5px 8px", border:"1px solid #cbd5e1", borderRadius:7, fontSize:12.5 }} />
                    </label>
                    <label style={{ fontSize:12, color:"#64748b", fontWeight:600 }}>To
                      <input type="date" value={tlTo} min={tlFrom} onChange={(e) => setTlTo(e.target.value)}
                             style={{ marginLeft:6, padding:"5px 8px", border:"1px solid #cbd5e1", borderRadius:7, fontSize:12.5 }} />
                    </label>
                    <button onClick={() => loadTotalLoss(tlFrom, tlTo)}
                            style={{ border:"none", background:"#1e40af", color:"#fff", borderRadius:8,
                                     padding:"6px 14px", fontWeight:700, fontSize:12.5, cursor:"pointer" }}>View</button>
                  </div>
                </div>
                {/* value */}
                <div style={{ padding:"22px 20px" }}>
                  {tlLoad && !tlData ? (
                    <div style={{ color:"#94a3b8", fontSize:14 }}>Loading…</div>
                  ) : (
                    <>
                      <div style={{ fontSize:12, color:"#64748b", fontWeight:700, letterSpacing:.3, textTransform:"uppercase" }}>
                        {sameRange ? tlFrom : `${tlFrom} → ${tlTo}`}
                      </div>
                      <div style={{ fontSize:40, fontWeight:900, color:"#dc2626", lineHeight:1.1, marginTop:6,
                                    fontVariantNumeric:"tabular-nums" }}>
                        {fmtClock(tlData?.total_loss_seconds || 0)}
                      </div>
                      <div style={{ display:"flex", gap:22, flexWrap:"wrap", marginTop:14 }}>
                        <div>
                          <div style={{ fontSize:11, color:"#94a3b8", fontWeight:700, textTransform:"uppercase" }}>Total Calls</div>
                          <div style={{ fontSize:18, fontWeight:800, color:"#0f172a" }}>{tlData?.calls ?? 0}</div>
                        </div>
                        <div>
                          <div style={{ fontSize:11, color:"#94a3b8", fontWeight:700, textTransform:"uppercase" }}>Raw Sum</div>
                          <div style={{ fontSize:18, fontWeight:800, color:"#475569" }}>{fmtClock(tlData?.raw_sum_seconds || 0)}</div>
                        </div>
                        <div>
                          <div style={{ fontSize:11, color:"#94a3b8", fontWeight:700, textTransform:"uppercase" }}>Overlap Saved</div>
                          <div style={{ fontSize:18, fontWeight:800, color:"#0d9488" }}>{fmtClock(overlap)}</div>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
            );
          })()}
        </div>
      </div>
      {msg && <div className="an-msg">{msg}</div>}

      {/* ── Department loss HISTORY modal (card par click se) ────────────── */}
      {histDept && (() => {
        const ymd = (dt) => `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")}`;
        const plantToday = () => { const n = new Date(); const d = new Date(n); if (n.getHours() < 7) d.setDate(d.getDate()-1); return ymd(d); };
        const addDays = (s, n) => { if (!s) return plantToday(); const [y,m,dd] = s.split("-").map(Number); const dt = new Date(y, m-1, dd); dt.setDate(dt.getDate()+n); return ymd(dt); };
        const showResp = histData?.show_response;
        return (
        <div onClick={() => setHistDept(null)}
             style={{ position:"fixed", inset:0, background:"rgba(15,23,42,.55)",
                      display:"flex", alignItems:"center", justifyContent:"center",
                      zIndex:1000, padding:20 }}>
          <div onClick={(e) => e.stopPropagation()}
               style={{ background:"#fff", borderRadius:16, width:"min(920px,96vw)",
                        maxHeight:"88vh", display:"flex", flexDirection:"column",
                        boxShadow:"0 20px 60px rgba(0,0,0,.35)", overflow:"hidden" }}>
            {/* header */}
            <div style={{ padding:"16px 20px", borderBottom:"1px solid #e2e8f0",
                          display:"flex", alignItems:"center", justifyContent:"space-between" }}>
              <div>
                <div style={{ fontSize:17, fontWeight:800, color:"#0f172a" }}>
                  {histDept} — Loss History
                </div>
                <div style={{ fontSize:12, color:"#64748b" }}>
                  zone · line · start–end · duration{showResp ? " · response" : ""}
                </div>
              </div>
              <button onClick={() => setHistDept(null)}
                      style={{ border:"none", background:"#f1f5f9", borderRadius:8, width:32, height:32,
                               fontSize:18, cursor:"pointer", color:"#475569" }}>×</button>
            </div>

            {/* date filter */}
            <div style={{ padding:"12px 20px", borderBottom:"1px solid #f1f5f9",
                          display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
              {[["Today", 0], ["Yesterday", -1]].map(([lbl, off]) => {
                const dt = addDays(plantToday(), off);
                const active = histFrom === dt && histTo === dt;
                return (
                  <button key={lbl} onClick={() => loadHistory(histDept, dt, dt)}
                          style={{ border:"1px solid #cbd5e1", borderRadius:8, padding:"6px 12px",
                                   fontWeight:700, fontSize:12.5, cursor:"pointer",
                                   background: active ? "#1e40af" : "#fff",
                                   color: active ? "#fff" : "#334155" }}>{lbl}</button>
                );
              })}
              <span style={{ color:"#cbd5e1" }}>|</span>
              <label style={{ fontSize:12, color:"#64748b", fontWeight:600 }}>From
                <input type="date" value={histFrom} onChange={(e) => setHistFrom(e.target.value)}
                       style={{ marginLeft:6, padding:"5px 8px", border:"1px solid #cbd5e1", borderRadius:7, fontSize:12.5 }} />
              </label>
              <label style={{ fontSize:12, color:"#64748b", fontWeight:600 }}>To
                <input type="date" value={histTo} min={histFrom} onChange={(e) => setHistTo(e.target.value)}
                       style={{ marginLeft:6, padding:"5px 8px", border:"1px solid #cbd5e1", borderRadius:7, fontSize:12.5 }} />
              </label>
              <button onClick={() => loadHistory(histDept, histFrom, histTo)}
                      style={{ border:"none", background:"#1e40af", color:"#fff", borderRadius:8,
                               padding:"6px 14px", fontWeight:700, fontSize:12.5, cursor:"pointer" }}>View</button>
              <div style={{ marginLeft:"auto", fontSize:12.5, color:"#0f172a", fontWeight:700 }}>
                {histData ? `Total ${fmtClock(histData.total_loss_seconds)} · ${histData.calls} call${histData.calls===1?"":"s"}` : ""}
              </div>
            </div>

            {/* table */}
            <div style={{ overflow:"auto", padding:"0 4px" }}>
              {histLoad ? (
                <div style={{ padding:40, textAlign:"center", color:"#94a3b8" }}>Loading…</div>
              ) : !histData || !histData.rows.length ? (
                <div style={{ padding:40, textAlign:"center", color:"#94a3b8" }}>
                  Is date range me {histDept} ki koi call nahi.
                </div>
              ) : (
                <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
                  <thead>
                    <tr style={{ background:"#f8fafc", position:"sticky", top:0 }}>
                      {["Date","Zone","Line","Start","End","Duration (loss)", ...(showResp?["Response"]:[])].map((h) => (
                        <th key={h} style={{ textAlign:"left", padding:"10px 14px", fontSize:10.5,
                                             fontWeight:800, letterSpacing:".06em", textTransform:"uppercase",
                                             color:"#64748b", borderBottom:"2px solid #e2e8f0", whiteSpace:"nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {histData.rows.map((r) => (
                      <tr key={r.id} style={{ borderBottom:"1px solid #f1f5f9" }}>
                        <td style={{ padding:"9px 14px", fontFamily:"monospace", color:"#475569" }}>{r.date}</td>
                        <td style={{ padding:"9px 14px", fontWeight:600, color:"#0f172a" }}>{r.zone || "—"}</td>
                        <td style={{ padding:"9px 14px", color:"#334155" }}>{r.line || "—"}</td>
                        <td style={{ padding:"9px 14px", fontFamily:"monospace", color:"#475569" }}>{r.start_time || "—"}</td>
                        <td style={{ padding:"9px 14px", fontFamily:"monospace", color:"#475569" }}>{r.end_time || "—"}</td>
                        <td style={{ padding:"9px 14px", fontFamily:"'Barlow Condensed',sans-serif", fontSize:16, fontWeight:800, color:"#0f172a" }}>
                          {fmtClock(r.duration_seconds)}
                        </td>
                        {showResp && (
                          <td style={{ padding:"9px 14px", fontFamily:"'Barlow Condensed',sans-serif", fontSize:16, fontWeight:800,
                                       color: r.response_seconds == null ? "#cbd5e1" : "#16a34a" }}>
                            {r.response_seconds == null ? "—" : fmtClock(r.response_seconds)}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
        );
      })()}

      {/* Takraav ka popup — IP/naam pehle se kisi aur PLC ki hai.
          Jaan-bujh kar khud gayab NAHI hota: user ko padhna aur samajhna
          zaroori hai, warna do board ka data ek hi line par chadh jayega. */}
      {alertBox && (
        <div onClick={() => setAlertBox(null)}
             style={{ position:"fixed", inset:0, background:"rgba(15,23,42,.55)",
                      display:"flex", alignItems:"center", justifyContent:"center",
                      zIndex:10000, padding:20 }}>
          <div onClick={(e) => e.stopPropagation()}
               style={{ background:"#fff", borderRadius:14, maxWidth:520, width:"100%",
                        boxShadow:"0 24px 60px rgba(0,0,0,.35)", overflow:"hidden" }}>
            <div style={{ background:"linear-gradient(135deg,#dc2626,#b91c1c)", color:"#fff",
                          padding:"14px 20px", display:"flex", alignItems:"center", gap:12 }}>
              <span style={{ fontSize:24 }}>⚠️</span>
              <div style={{ fontSize:16, fontWeight:800 }}>{alertBox.title}</div>
            </div>
            <div style={{ padding:"18px 20px", fontSize:13.5, lineHeight:1.65, color:"#0f172a" }}>
              {alertBox.text}
              <div style={{ marginTop:14, padding:"10px 12px", background:"#fef2f2",
                            border:"1px solid #fecaca", borderRadius:9,
                            fontSize:12.5, color:"#991b1b" }}>
                Ek IP sirf EK hi PLC ko de sakte hain. Do board ek hi IP par hon to
                dono ka data ek hi line par chala jayega aur pata bhi nahi chalega.
              </div>
            </div>
            <div style={{ padding:"0 20px 18px", textAlign:"right" }}>
              <button onClick={() => setAlertBox(null)}
                      style={{ border:"none", background:"#dc2626", color:"#fff",
                               borderRadius:9, padding:"9px 22px", fontSize:13,
                               fontWeight:800, cursor:"pointer", fontFamily:"inherit" }}>
                Samajh gaya
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
