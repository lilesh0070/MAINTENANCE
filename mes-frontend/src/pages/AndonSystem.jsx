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
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import AndonMonitor from "./AndonMonitor";
import { PROD_ZONES } from "../constants/zones";

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
// Call History me tareekh + samay — "30-Aug 10:41:06" (chhota, nowrap-friendly)
const fmtDT = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d)) return String(iso).slice(0, 19).replace("T", " ");
  const p2 = (n) => String(n).padStart(2, "0");
  const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${p2(d.getDate())}-${MON[d.getMonth()]} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
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
// HAR tab ka apna key — taaki admin ek-ek tab alag grant kar sake.
// Pehle monitor `andon-board` par aur callout `andon-config` par chal rahe
// the, aur `calls` (Call History) kahin tha hi nahi — TAB_KEY["calls"]
// undefined hone se canAccess(undefined) = false, yaani wo tab galti se
// SIRF admin ko dikh raha tha.  Naya key jodte waqt teen jagah karna hota
// hai: yahan, AuthContext ke SUBPAGE_PARENT me, aur admin ke
// PAGE_PERM_GROUPS me — teeno na ho to tab ya chhup jaata hai ya grant
// hi nahi ho paata.
const TAB_KEY = { board: "andon-board", monitor: "andon-monitor",
                  faults: "andon-faults", calls: "andon-calls",
                  config: "andon-config", callout: "andon-callout",
                  reports: "andon-reports" };
// Call→Output: departments jinka bit RESPONSE (acknowledge) pe off hota hai
// (inme ACK output hai — DO2/DO4); baaki call band hone par hi off.
const OUT_ACK_DEPTS = ["maintenance", "tool room", "toolroom"];
const outDeptOffAck = (d) => OUT_ACK_DEPTS.includes(String(d || "").trim().toLowerCase());

// Fault History — FY ke 12 mahine (Apr..Mar)
function fyMonthsList(fy) {
  const y = parseInt(String(fy).split("-")[0], 10);
  if (isNaN(y)) return [];
  const MON = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const out = [];
  for (let i = 0; i < 12; i++) { const mo = ((3 + i) % 12) + 1; const yr = mo >= 4 ? y : y + 1; out.push({ value: `${yr}-${String(mo).padStart(2, "0")}`, label: `${MON[mo]} ${yr}` }); }
  return out;
}
const FH_LBL = { display: "flex", flexDirection: "column", gap: 3, fontSize: 10.5, fontWeight: 700, color: "#64748b" };
const FH_SEL = { padding: "6px 8px", minWidth: 118 };

/* PLC ki connection haalat.  Sirf "Disconnected" likhne se maintenance wale
   ghanton phaste hain — ping chal rahi hoti hai, PLC ki light jal rahi hoti
   hai, phir bhi UI red.  Backend ab WAJAH bhi bhejta hai (online_reason),
   aur do wajahon ka ilaaj bilkul alag hai:
     refused = PLC zinda hai par us port par kuch sun nahi raha  -> PLC ki setting
     timeout = jawab hi nahi aaya                                -> cable/firewall/power
   Isliye wajah UI par likh dete hain, warna har baar network hi shaq me aata hai. */
/* ── DO PROTOCOL ────────────────────────────────────────────────────────────
   MC     = Mitsubishi MC-protocol / SLMP  -> padhta AUR likhta hai (M/D/X/Y…)
   MODBUS = Modbus TCP                     -> SIRF padhta hai (COIL/DI/HR/IR)

   Modbus me M/D/X/Y hote hi nahi — uske chaar khaane hote hain aur address ek
   flat number hota hai.  Kaunsa Modbus address kis D/M par baithega, ye faisla
   PLC ke ANDAR hota hai (GX Works3 -> Modbus device assignment), yahan nahi.
   Isliye address seedha Modbus wale roop me likhe jaate hain — andaza nahi. */
const SERIES = ["Q", "FX5U", "iQ-R", "L"];      // pehle jaisi hi list
/* Modbus/TCP sirf FX5 me ANDAR se hota hai.  Q / iQ-R / L par wo CPU ka apna
   kaam nahi — uske liye alag Modbus module (jaise QJ71MB91) lagana padta hai.
   Isliye Protocol ka dropdown SIRF FX5U par dikhta hai; baaki series par
   raasta hamesha MC / SLMP hi rehta hai. */
const MODBUS_SERIES = ["FX5U"];
const canModbus = (s) => MODBUS_SERIES.includes(String(s || "Q"));
const PROTOCOLS = [
  { v: "MC",     label: "MC / SLMP",  port: 5007 },
  { v: "MODBUS", label: "Modbus TCP", port: 502  },
];
const isModbus  = (p) => String(p || "MC").toUpperCase() === "MODBUS";
const defPort   = (p) => (isModbus(p) ? 502 : 5007);
/* Ek hi jagah se sach — series Modbus kar hi nahi sakti to protocol ka koi
   bhi likha hua hona bekaar hai.  Har jagah (form, badge, address dropdown)
   YAHI se poochha jaata hai, warna kahin Q + Modbus jaisa jodha dikh sakta. */
const effProto = (series, protocol) => (canModbus(series) && isModbus(protocol) ? "MODBUS" : "MC");
const MC_ADDR     = ["D", "R", "W", "M", "L", "X", "Y"];   // Model / Fault register
const MC_BIT_ADDR = ["M", "Y", "X", "L", "D"];             // ANDON call ka signal
/* Modbus par bhi address WAHI roop me likha jaata hai jo MC me — `D3001`.
   Modbus ka asli number PLC ke apne "MODBUS Device Allocation" se banta hai
   aur wo badalna backend karta hai.  Isliye maujooda mapping (jo sab `D` par
   hai) ko Modbus par le jaane me EK BHI address dobara nahi likhna padta. */
const MODBUS_DEV_ADDR = ["D", "M", "X", "Y", "L", "B", "F", "SM"];
/* Seedha Modbus address — sirf us soorat ke liye jab kisi PLC ka allocation
   upar wali table se alag ho.  Ye raasta translation se guzarta hi nahi. */
const MODBUS_RAW_ADDR = ["HR", "IR", "COIL", "DI"];
const MODBUS_ALL_ADDR = [...MODBUS_DEV_ADDR, ...MODBUS_RAW_ADDR];
const MODBUS_ADDR_HINT = {
  D:    "D register — mapped to a Modbus holding register",
  M:    "M relay — mapped to a Modbus coil",
  X:    "X input — mapped to a Modbus discrete input (octal, like the PLC)",
  Y:    "Y output — mapped to a Modbus coil (octal, like the PLC)",
  L:    "L latch relay — mapped to a Modbus coil",
  B:    "B link relay — mapped to a Modbus coil (hex, like the PLC)",
  F:    "F annunciator — mapped to a Modbus coil",
  SM:   "SM special relay — mapped to a Modbus coil",
  HR:   "Holding register (4x) — raw Modbus address, no mapping",
  IR:   "Input register (3x) — raw Modbus address, no mapping",
  COIL: "Coil (0x) — raw Modbus address, no mapping",
  DI:   "Discrete input (1x) — raw Modbus address, no mapping",
};

/* Address ka dropdown.  MC par saadi list; Modbus par do hisse — PLC ke device
   (jo apne aap Modbus number me badal jaate hain) aur seedha Modbus address. */
function AddrOptions({ proto, mcList }) {
  if (!isModbus(proto)) return mcList.map((b) => <option key={b} value={b}>{b}</option>);
  return (
    <>
      <optgroup label="PLC device — same as MC">
        {MODBUS_DEV_ADDR.map((b) => <option key={b} value={b}>{b}</option>)}
      </optgroup>
      <optgroup label="Raw Modbus address">
        {MODBUS_RAW_ADDR.map((b) => <option key={b} value={b}>{b}</option>)}
      </optgroup>
    </>
  );
}

const PLC_WHY = {
  refused: { tag: "port refused",
             tip: "The device replied but nothing is listening on this port. Open the MC protocol / Ethernet port setting on the PLC, or correct the port here. This is not a network fault — ping will still work." },
  timeout: { tag: "no response",
             tip: "No reply from this address. Check the cable, the firewall/VLAN, or whether the PLC is powered on." },
  dns:     { tag: "bad address",
             tip: "This address could not be resolved." },
  modbus_no_probe: { tag: "waiting for poller",
             tip: "This PLC speaks Modbus TCP, and this FX5U serves only ONE Modbus connection at a time. A test connection would take that single slot away from the poller, so no probe is made here — the status comes from the poller itself. If it stays like this, check the backend log for the reason." },
  mc:      { tag: "no protocol reply",
             tip: "The port is open and accepting connections, but the PLC is not answering reads. For MC, check the MC protocol settings and the series (Q / iQ-R / L). For Modbus TCP, check that the Modbus server is enabled, that the unit ID matches, and that the device assignment covers these addresses." },
};

/* Address ke bagal ka chhota nishaan.  Modbus wala neela, taaki list me ek
   nazar me dikh jaye ki kaunsa device kis protocol par hai. */
function Tag({ text, on = false }) {
  if (!text) return null;
  return <span style={{ marginLeft:6, fontSize:10, fontWeight:700,
                        color: on ? "#1d4ed8" : "#64748b",
                        background: on ? "#dbeafe" : "#f1f5f9",
                        padding:"1px 6px", borderRadius:99 }}>{text}</span>;
}

function PlcState({ online, reason, dot = 10, glow = false, title = "" }) {
  const why  = online === false ? PLC_WHY[reason] : null;
  const col  = online === true ? "#16a34a" : online === false ? "#dc2626" : "#94a3b8";
  const dotc = online === true ? "#16a34a" : online === false ? "#dc2626" : "#cbd5e1";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontWeight: 700,
                   fontSize: 12, color: col }}
          title={why ? why.tip : title}>
      <span style={{ width: dot, height: dot, borderRadius: "50%", flex: "0 0 auto", background: dotc,
                     boxShadow: !glow ? "none"
                       : online === true  ? "0 0 0 3px rgba(22,163,74,.2)"
                       : online === false ? "0 0 0 3px rgba(220,38,38,.2)" : "none" }} />
      {online === true ? "Connected" : online === false ? "Disconnected" : "Checking…"}
      {why && why.tag && (
        <span style={{ fontWeight: 600, fontSize: 11, color: "#94a3b8" }}>· {why.tag}</span>
      )}
    </span>
  );
}

/* Machine ka IP ab MACHINE MASTER se aata hai (maintenance_machines.ip).
   Machine chunte hi PLC IP apne aap bhar jaata hai, taaki ek hi IP do jagah
   alag-alag na ho jaye.  Field editable rakha hai (kabhi PLC ka IP machine se
   alag ho sakta hai), par alag hote hi neeche saaf likha aata hai ki master
   me kya hai — warna farak chupchaap baith jaata aur baad me "connect kyun
   nahi ho raha" wali maathapachi hoti. */
function IpNote({ masterIp, value }) {
  const v = (value || "").trim();
  if (!masterIp) {
    return <div style={{ fontSize: 10.5, color: "#94a3b8", marginTop: 3 }}>
      No IP in Machine Master for this machine — add it there to auto-fill.
    </div>;
  }
  if (v === masterIp) {
    return <div style={{ fontSize: 10.5, color: "#16a34a", fontWeight: 700, marginTop: 3 }}>
      ✓ From Machine Master
    </div>;
  }
  return <div style={{ fontSize: 10.5, color: "#b45309", fontWeight: 700, marginTop: 3 }}>
    ⚠ Machine Master has {masterIp}
  </div>;
}

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

  const [tab, setTab] = useState("board");   // reload par pehla tab = Live Board
  const [cfg, setCfg] = useState("plc");            // plc | outputs
  const [msg, setMsg] = useState("");
  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(""), 2500); };

  // Default/active tab ko accessible rakho: agar current tab ka access nahi
  // (sub-key None), to tab-bar ke KRAM me pehle allowed tab par switch.
  // List wahi rakhi hai jo tab-bar me hai — pehle sirf teen naam the, to jis
  // user ke paas sirf Monitor ya Call History ka access hota uske liye koi
  // chalta tab na milta aur khali screen reh jaati.
  // Guard (early-return + firstOk !== tab) loop rokta hai.
  useEffect(() => {
    if (canAccess(TAB_KEY[tab])) return;
    const firstOk = ["board", "monitor", "faults", "calls", "config", "callout", "reports"]
      .find((t) => canAccess(TAB_KEY[t]));
    if (firstOk && firstOk !== tab) setTab(firstOk);
  }, [tab, user]);   // eslint-disable-line react-hooks/exhaustive-deps

  const [master, setMaster]   = useState([]);       // flat maintenance_machines rows (zone_name/line_name/machine_no/machine_name)
  const [depts, setDepts]     = useState([]);
  const [plcs, setPlcs]       = useState([]);
  const [outs, setOuts]       = useState([]);       // Call → PLC output mappings (list + live bit status)
  const [outForm, setOutForm] = useState({ department:"", plc_ip:"", plc_port:5007, plc_series:"Q", bit_type:"M", bit_no:"", bit2_type:"M", bit2_no:"", enabled:true });
  const [outEdit, setOutEdit] = useState(null);
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
  // Loss History se kachra call hatana — SIRF admin.  Ye modal HAR department
  // ke liye khulta hai (histDept), isliye ek hi jagah lagane se Maintenance,
  // Toolroom, Quality — sab cover ho jaate hain.  Isme sirf BAND ho chuki
  // calls aati hain (andon_history), to chalu call ka sawaal hi nahi.
  const [histDel, setHistDel] = useState(null);
  const deleteHistRow = async (r) => {
    if (!r?.id) return;
    if (!window.confirm(
      `This call will be permanently removed from history:

` +
      `${histDept} · ${r.zone || "-"} / ${r.line || "-"}
` +
      `${r.date} ${r.start_time || "-"} → ${r.end_time || "-"}

` +
      `This cannot be undone. Continue?`)) return;
    setHistDel(r.id);
    try {
      await api("/history/delete", { method: "POST", body: JSON.stringify({ ids: [r.id] }) });
      await loadHistory(histDept, histFrom, histTo);   // wahi filter, taaza data
    } catch (e) {
      flash(String(e?.message || e).slice(0, 140));
    } finally { setHistDel(null); }
  };
  const openHistory = (dept) => { setHistDept(dept); setHistData(null); loadHistory(dept); };

  // ── Reports → TOTAL LOSS (union) ──────────────────────────────────────
  // Sab department ke call-windows ko MERGE karke total plant-downtime.  Ek
  // waqt par ek hi loss (overlap ek baar) — Maintenance chalu me Toolroom bhi
  // dab jaye to bhi wo time ek hi baar gina jaata hai.  Backend: /total-loss.
  const [tlData, setTlData] = useState(null);   // {total_loss_seconds, raw_sum_seconds, calls, from, to}
  const [tlLoad, setTlLoad] = useState(false);
  const [tlFrom, setTlFrom] = useState("");
  const [tlTo,   setTlTo]   = useState("");
  // Total Loss ke filter — FY / Month / Zone / Line.  Month sabse pakka
  // (server par bhi wahi kram), phir FY, phir From-To.
  const [tlFy, setTlFy]       = useState("");
  const [tlMonth, setTlMonth] = useState("");
  const [tlZone, setTlZone]   = useState("");
  const [tlLine, setTlLine]   = useState("");

  const loadTotalLoss = useCallback(async (from, to, extra) => {
    setTlLoad(true);
    try {
      const q = new URLSearchParams();
      if (from) q.set("from", from);
      if (to)   q.set("to", to);
      const ex = extra || {};
      if (ex.fy)    q.set("fy", ex.fy);
      if (ex.month) q.set("month", ex.month);
      if (ex.zone)  q.set("zone", ex.zone);
      if (ex.line)  q.set("line", ex.line);
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
    // Pehla load bhi FILTERS ke saath — warna dropdown me "Aug 2026" dikhta
    // aur data aaj ka aata, jo aapas me mel nahi khaata.
    if (!tlData) loadTotalLoss(null, null, { fy: tlFy, month: tlMonth, zone: tlZone, line: tlLine });
    const id = setInterval(() => {
      const ymd = (dt) => `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")}`;
      const n = new Date(); const d = new Date(n); if (n.getHours() < 7) d.setDate(d.getDate()-1);
      const today = ymd(d);
      // Auto-refresh sirf tab jab range AAJ ho — aur zone/line filter SAATH
      // le jaana zaroori hai, warna har 3 second me filter apne aap ud jaata.
      // FY/Month lagi ho to wo range aaj ki hai hi nahi, isliye refresh chhoot
      // jaata hai — wahi theek hai (purani range live nahi badalti).
      if (alive && tlFrom === today && tlTo === today && !tlFy && !tlMonth) {
        loadTotalLoss(tlFrom, tlTo, { zone: tlZone, line: tlLine });
      }
    }, 3000);
    return () => { alive = false; clearInterval(id); };
  }, [token, tab, tlFrom, tlTo, tlData, loadTotalLoss, tlFy, tlMonth, tlZone, tlLine]);

  const load = useCallback(async () => {
    try {
      const [mc, d, e, o] = await Promise.all([
        fetch("/api/machines/", { headers: { Authorization: `Bearer ${token}` } }).then((r) => (r.ok ? r.json() : [])).catch(() => []),
        api("/departments").catch(() => []), api("/plc-devices").catch(() => []),
        api("/call-outputs").catch(() => []),
      ]);
      setMaster(Array.isArray(mc) ? mc : []); setDepts(d || []); setPlcs(e || []); setOuts(o || []);
    } catch (err) { flash(String(err.message || err).slice(0, 120)); }
  }, [api, token]);
  useEffect(() => { if (token) load(); }, [token, load]);
  // live PLC connectivity — re-poll the list every 10s so the green/red dots update
  useEffect(() => {
    if (!token) return;
    const id = setInterval(() => {
      api("/plc-devices").then((e) => setPlcs(e || [])).catch(() => {});
      api("/call-outputs").then((o) => setOuts(o || [])).catch(() => {});
    }, 10000);
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
      if (e?.status === 409) setAlertBox({ title: "This IP / name is already in use", text });
      else flash(text.slice(0, 140));
    }
  };

  // ── Departments ──
  const [dName, setDName] = useState("");

  // ── PLC form (zone / line from the machine master) ──
  const blankPlc = { name: "", ip: "", port: 5007, series: "Q", protocol: "MC", unit_id: 1,
                     zone: "", line: "", machine_no: "", machine_name: "", enabled: true,
                     sub_on: false, sub_ip: "", sub_port: 5007, sub_series: "Q",
                     sub_protocol: "MC", sub_unit_id: 1, sub_machine_no: "" };
  const [plcForm, setPlcForm] = useState(blankPlc);
  // Protocol badla -> port bhi usi ka aam port (5007 <-> 502).  Sirf tab jab
  // maujooda port DOOSRE protocol ka default ho -- yaani user ka apna likha
  // hua port (jaise 503) chhua nahi jaata.
  // Series badli -> agar nayi series Modbus kar hi nahi sakti to protocol
  // wapas MC, aur port bhi MC ka (par sirf tab jab port Modbus ka default
  // 502 pada ho -- user ka apna likha port kabhi nahi chhedte).
  const onSeries = (which, v) => setPlcForm((f) => {
    const sk = which === "sub" ? "sub_series"   : "series";
    const pk = which === "sub" ? "sub_protocol" : "protocol";
    const ok = which === "sub" ? "sub_port"     : "port";
    if (canModbus(v)) return { ...f, [sk]: v };
    return { ...f, [sk]: v, [pk]: "MC",
             [ok]: (Number(f[ok]) === 502 || !f[ok]) ? 5007 : f[ok] };
  });
  const onProto = (which, v) => setPlcForm((f) => {
    const pk = which === "sub" ? "sub_port" : "port";
    const cur = Number(f[pk]);
    const next = (cur === defPort(f[which === "sub" ? "sub_protocol" : "protocol"]) || !cur)
      ? defPort(v) : cur;
    return { ...f, [which === "sub" ? "sub_protocol" : "protocol"]: v, [pk]: next };
  });
  const [plcEdit, setPlcEdit] = useState(null);
  // zone → line → machine cascade, all from the machine master (like every page)
  const plcZones    = useMemo(() => [...new Set(master.map((m) => m.zone_name).filter(Boolean))].sort(), [master]);
  const plcLines    = useMemo(() => plcForm.zone ? [...new Set(master.filter((m) => m.zone_name === plcForm.zone).map((m) => m.line_name).filter(Boolean))].sort() : [], [master, plcForm.zone]);
  const plcMachines = useMemo(() => (plcForm.zone && plcForm.line) ? [...new Set(master.filter((m) => m.zone_name === plcForm.zone && m.line_name === plcForm.line).map((m) => m.machine_no).filter(Boolean))].sort() : [], [master, plcForm.zone, plcForm.line]);
  // Machine Master me us machine ka IP (na ho to "")
  const masterIpOf = (mno) => {
    const m = master.find((x) => x.zone_name === plcForm.zone && x.line_name === plcForm.line
                                 && String(x.machine_no) === String(mno));
    return (m?.ip || "").trim();
  };

  const onPlcMachine = (v) => {
    const m = master.find((x) => x.zone_name === plcForm.zone && x.line_name === plcForm.line && String(x.machine_no) === String(v));
    const ip = (m?.ip || "").trim();
    // Master me IP hai to wahi bhar do.  Na ho to jo pehle se type kiya hai
    // use mitate nahi — warna user ki bhari hui value gayab ho jaati.
    setPlcForm((f) => ({ ...f, machine_no: v, machine_name: m?.machine_name || "",
                         ip: ip || f.ip }));
  };

  const onSubMachine = (v) => {
    const ip = masterIpOf(v);
    setPlcForm((f) => ({ ...f, sub_machine_no: v, sub_ip: ip || f.sub_ip }));
  };
  const startPlcEdit = (e) => { setPlcEdit(e.id); setPlcForm({ ...blankPlc, ...e, series: e.series || "Q",
      protocol: e.protocol || "MC", unit_id: e.unit_id ?? 1,
      zone: e.zone || "", line: e.line || "", machine_no: e.machine_no || "", machine_name: e.machine_name || "",
      sub_on: !!e.sub_ip, sub_ip: e.sub_ip || "", sub_port: e.sub_port || defPort(e.sub_protocol), sub_series: e.sub_series || "Q",
      sub_protocol: e.sub_protocol || "MC", sub_unit_id: e.sub_unit_id ?? 1,
      sub_machine_no: e.sub_machine_no || "" }); setCfg("plc"); };
  const savePlc = () => wrap(async () => {
    // Bhejne se PEHLE hi saaf kar do — series Modbus kar hi nahi sakti to
    // protocol MC.  (Backend bhi yahi rok lagata hai; UI ki rok asli rok nahi
    // hoti, par galat value pehli jagah se hi nahi nikalni chahiye.)
    const proto    = effProto(plcForm.series, plcForm.protocol);
    const subProto = effProto(plcForm.sub_series, plcForm.sub_protocol);
    const body = { name: plcForm.name, ip: plcForm.ip,
                   // pehle yahan `|| 80` tha (ESP wale zamane ka bacha hua) — khali
                   // port par 80 jaana ab galat hai, protocol ka apna port chahiye.
                   port: Number(plcForm.port) || defPort(proto),
                   series: plcForm.series || "Q", protocol: proto,
                   unit_id: Number(plcForm.unit_id) || 1,
                   zone: plcForm.zone || "", line: plcForm.line || "", machine_no: plcForm.machine_no || "",
                   machine_name: plcForm.machine_name || "", enabled: plcForm.enabled,
                   // Sub PLC (Model/Fault ke liye) — sirf tab jab toggle ON ho
                   sub_ip: plcForm.sub_on ? (plcForm.sub_ip || "") : "",
                   sub_port: Number(plcForm.sub_port) || defPort(subProto),
                   sub_series: plcForm.sub_series || "Q", sub_protocol: subProto,
                   sub_unit_id: Number(plcForm.sub_unit_id) || 1,
                   sub_machine_no: plcForm.sub_on ? (plcForm.sub_machine_no || "") : "" };
    if (plcEdit) await api(`/plc-devices/${plcEdit}`, { method: "PUT", body: JSON.stringify(body) });
    else await api("/plc-devices", { method: "POST", body: JSON.stringify(body) });
    setPlcForm(blankPlc); setPlcEdit(null);
  }, plcEdit ? "PLC updated" : "PLC added");

  // ── Call → Output PLC bit mapping (save) ──
  const saveOut = () => wrap(async () => {
    const body = { department: outForm.department, plc_ip: (outForm.plc_ip || "").trim(),
                   plc_port: Number(outForm.plc_port) || 5007, plc_series: outForm.plc_series || "Q",
                   bit_type: outForm.bit_type || "M", bit_no: String(outForm.bit_no).trim(),
                   bit2_type: outForm.bit2_type || "M", bit2_no: String(outForm.bit2_no || "").trim(),
                   enabled: outForm.enabled };
    if (outEdit) await api(`/call-outputs/${outEdit}`, { method: "PUT", body: JSON.stringify(body) });
    else await api("/call-outputs", { method: "POST", body: JSON.stringify(body) });
    setOutForm({ department:"", plc_ip:"", plc_port:5007, plc_series:"Q", bit_type:"M", bit_no:"", bit2_type:"M", bit2_no:"", enabled:true });
    setOutEdit(null);
  }, outEdit ? "Mapping updated" : "Mapping added");

  // ── Output mapping (default template OR a specific PLC) ──
  const [outFor, setOutFor] = useState({ type: "default", id: null, name: "Default template" });
  // Address dropdown (ANDON bit + Model/Fault) jis device ka mapping khula hai
  // USI ke protocol se banta hai — Modbus par M/D/X/Y dikhana hi galat hoga.
  // "Default template" kisi ek device ka nahi hota, isliye wahan MC hi rehta
  // hai (aur waise bhi bit address hamesha per-PLC bhare jaate hain).
  const curProto = useMemo(() => {
    if (outFor?.type !== "plc") return "MC";
    const d = plcs.find((p) => p.id === outFor.id);
    return d ? effProto(d.series, d.protocol) : "MC";
  }, [outFor, plcs]);

  const [outRows, setOutRows] = useState([]);
  const [outZone, setOutZone] = useState("");
  const [outLine, setOutLine] = useState("");
  const loadOutputs = useCallback(async (target) => {
    setOutFor(target);
    const rows = target.type === "default" ? await api("/outputs/default") : await api(`/plc-devices/${target.id}/outputs`);
    setOutRows(rows || []); setCfg("outputs");
  }, [api]);
  const outLinesFor = (z) => z ? [...new Set(master.filter((m) => m.zone_name === z).map((m) => m.line_name).filter(Boolean))].sort() : [];

  // ── Fault History (live) — zone/line/machine/fault group + count ──
  const [fhFy, setFhFy] = useState("");
  const [fhMonth, setFhMonth] = useState("");
  const [fhDate, setFhDate] = useState("");
  const [fhZone, setFhZone] = useState("");
  const [fhLine, setFhLine] = useState("");
  const [fhMachine, setFhMachine] = useState("");
  const [fhFault, setFhFault] = useState("");
  // ── Call History (raw andon_history) ────────────────────────────────
  // Report sirf jod-ghata dikhati hai; yahan ASLI rows dikhti hain, taaki
  // admin kachra row (testing ki 2-second call, galat department) hata sake.
  const [chRows, setChRows]       = useState([]);
  const [chLoading, setChLoading] = useState(false);
  const [chSel, setChSel]         = useState(() => new Set());
  const [chLimit, setChLimit]     = useState(200);
  const [chDept, setChDept]       = useState("");     // "" = saare department

  // Filter client-side hai — rows pehle se load hain, to chunav turant lagta
  // hai (server ko dobara nahi poochte).
  const chShown = useMemo(
    () => (chDept ? chRows.filter((r) => (r.department || r.display_name) === chDept) : chRows),
    [chRows, chDept]);
  const isAdmin = user?.role === "admin";

  const loadCallHistory = useCallback(async () => {
    setChLoading(true);
    try {
      const d = await api(`/history?limit=${chLimit}`);
      setChRows(Array.isArray(d) ? d : []);
      setChSel(new Set());          // list badli to purana selection bekaar
    } catch { setChRows([]); }
    finally { setChLoading(false); }
  }, [api, chLimit]);

  useEffect(() => {
    if (!token || tab !== "calls") return;
    loadCallHistory();
  }, [token, tab, loadCallHistory]);

  const chToggle = (id) => setChSel((prev) => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const chDelete = async () => {
    const ids = [...chSel];
    if (!ids.length) return;
    // Delete wapas nahi aata — isliye ginti ke saath saaf poochte hain.
    if (!window.confirm(
      `${ids.length} call history rows will be permanently deleted.
` +
      `This cannot be undone. Continue?`)) return;
    try {
      const r = await api("/history/delete", { method: "POST", body: JSON.stringify({ ids }) });
      flash(`${r.deleted} rows deleted`);
      await loadCallHistory();
    } catch (e) {
      flash(String(e?.message || e).slice(0, 140));
    }
  };

  const [fhRows, setFhRows] = useState([]);
  const [fhFaultOpts, setFhFaultOpts] = useState([]);
  const [fhYears, setFhYears] = useState([]);
  const fhZones = useMemo(() => [...new Set(master.map((m) => m.zone_name).filter(Boolean))].sort(), [master]);
  const fhLines = useMemo(() => [...new Set(master.filter((m) => !fhZone || m.zone_name === fhZone).map((m) => m.line_name).filter(Boolean))].sort(), [master, fhZone]);
  const fhMachines = useMemo(() => [...new Set(master.filter((m) => (!fhZone || m.zone_name === fhZone) && (!fhLine || m.line_name === fhLine)).map((m) => m.machine_no).filter(Boolean))].sort(), [master, fhZone, fhLine]);
  // FY list + default = current FY & current month
  useEffect(() => {
    if (!token) return;
    fetch("/api/maintenance-kpi/financial-years", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : [])).then((list) => {
        const arr = Array.isArray(list) ? list : [];
        setFhYears(arr);
        const cur = arr.find((v) => v.is_current) || arr[0];
        if (cur) {
          setFhFy(cur.fy);
          const now = new Date();
          const cm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
          const inFy = fyMonthsList(cur.fy).some((m) => m.value === cm);
          if (inFy) setFhMonth(cm);
          // Total Loss ke filter bhi CHAALU FY + CHAALU MAHINE par khulein,
          // taaki page kholte hi is mahine ka poora data (line-wise) dikhe.
          setTlFy(cur.fy);
          if (inFy) setTlMonth(cm);
        }
      }).catch(() => {});
  }, [token]);
  const loadFaultHistory = useCallback(async () => {
    const qs = new URLSearchParams();
    for (const [k, v] of [["fy", fhFy], ["month", fhMonth], ["date", fhDate], ["zone", fhZone], ["line", fhLine], ["machine_no", fhMachine], ["fault", fhFault]]) if (v) qs.set(k, v);
    const d = await api(`/fault-history?${qs.toString()}`).catch(() => null);
    if (d) { setFhRows(d.rows || []); setFhFaultOpts(d.faults || []); }
  }, [api, fhFy, fhMonth, fhDate, fhZone, fhLine, fhMachine, fhFault]);
  useEffect(() => {
    if (!token || tab !== "faults") return;
    loadFaultHistory();
    const id = setInterval(loadFaultHistory, 3000);   // live refresh
    return () => clearInterval(id);
  }, [token, tab, loadFaultHistory]);
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
  // Naye PLC ke abhi koi output nahi hote.  Pehle ye effect `!outRows.length`
  // dekh kar Default template chadha deta tha — yaani button se PLC kholte hi
  // target badal kar Default ho jaata aur user doosri jagah bharne lagta.
  // Ab jab target pehle se koi PLC hai to haath nahi lagate.
  useEffect(() => { if (token && cfg === "outputs" && outFor.type !== "plc" && !outRows.length) loadOutputs({ type: "default", id: null, name: "Default template" }); /* eslint-disable-next-line */ }, [cfg, token]);
  const setOut = (i, k, v) => setOutRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const saveOutputs = () => wrap(async () => {
    const body = { rows: outRows.map((r) => ({ do_index: r.do_index, display_name: r.display_name,
      department_id: r.department_id || null, priority: r.priority || "Normal", enabled: r.enabled !== false,
      bit_type: r.bit_type || "", bit_no: r.bit_no || "" })) };
    if (outFor.type === "default") await api("/outputs/default", { method: "PUT", body: JSON.stringify(body) });
    else await api(`/plc-devices/${outFor.id}/outputs`, { method: "PUT", body: JSON.stringify(body) });
  }, "Output mapping saved");

  // ── Assign (per-machine): ANDON | Model | Fault sub-tabs ──
  const [assignTab, setAssignTab] = useState("andon");        // andon | model | fault
  const [modelRows, setModelRows] = useState([]);
  const [faultRows, setFaultRows] = useState([]);
  // list khali ho to bhi ek ready row dikhe — user turant Device/Value bhar sake
  const loadModels = useCallback(async (eid) => { const r = (await api(`/plc-devices/${eid}/models`)) || []; setModelRows(r.length ? r : [{ device_type: "D", device_no: "", value: "", name: "" }]); }, [api]);
  const loadFaults = useCallback(async (eid) => { const r = (await api(`/plc-devices/${eid}/faults`)) || []; setFaultRows(r.length ? r : [{ device_type: "D", device_no: "", value: "", name: "" }]); }, [api]);
  const openAssign = (e) => { setAssignTab("andon"); loadOutputs({ type: "plc", id: e.id, name: e.name }); loadModels(e.id); loadFaults(e.id); };

  // "Retry" — us PLC ko ABHI dobara jaancho.  List wala status cache se aata
  // hai (server PLC ko har 10s nahi thakthakata), isliye jab user khud kehta
  // hai "dobara dekho" tab ye taaza probe karwata hai aur sirf usi row ko
  // update karta hai — poori list dobara nahi mangwate.
  const [rechecking, setRechecking] = useState(null);   // jis PLC ki jaanch chal rahi hai

  /* "Read now" — PLC ke bit ABHI padh kar dikhao.
     Pehle jaanchne ka ek hi zariya tha: Retry, jo sirf TCP connect karta hai.
     Usse "port khulta hai" to pata chalta tha, par "bit padha ja raha hai ya
     nahi" kabhi nahi — aur asli dikkat wahin chhupi rehti thi. */
  const [readBusy, setReadBusy] = useState(null);
  const [readOut,  setReadOut]  = useState(null);
  const readNow = async (id) => {
    setReadBusy(id);
    try   { setReadOut(await api(`/plc-devices/${id}/read-now`)); }
    catch (e) { setReadOut({ error: e.message || "Could not read from the PLC" }); }
    finally   { setReadBusy(null); }
  };
  const recheckPlc = async (id) => {
    setRechecking(id);
    try {
      const r = await api(`/plc-devices/${id}/recheck`, { method: "POST" });
      setPlcs((list) => list.map((x) => (x.id === id ? { ...x, ...r } : x)));
    } catch { /* toast wrap() nahi — chup-chaap, agli jaanch phir ho jayegi */ }
    finally { setRechecking(null); }
  };
  // Output mapping ka Retry.  Writer ka socket writer ke APNE process me hota
  // hai (production), aur ye request koi doosra backend bhi serve kar sakta —
  // isliye endpoint DB me nishan lagata hai aur writer agle cycle (~1s) me
  // connection dobara banata hai.  Isliye button ke baad list refresh karte
  // hain, taaki naya nateeja dikh jaye.
  const [outRechecking, setOutRechecking] = useState(null);
  const recheckOut = async (id) => {
    setOutRechecking(id);
    try {
      const r = await api(`/call-outputs/${id}/recheck`, { method: "POST" });
      flash(r.ok ? "PLC is reachable — reconnecting"
                 : `Could not reach the PLC — ${PLC_WHY[r.reason]?.tag || r.reason}`);
      const o = await api("/call-outputs");
      setOuts(o || []);
    } catch { /* chup-chaap — writer agle cycle me khud bhi koshish karega */ }
    finally { setOutRechecking(null); }
  };
  const pickMap = (which) => (which === "model" ? setModelRows : setFaultRows);
  const setMap = (which, i, k, v) => pickMap(which)((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const addMap = (which) => pickMap(which)((rs) => [...rs, { device_type: "D", device_no: "", value: "", name: "" }]);
  const delMap = (which, i) => pickMap(which)((rs) => rs.filter((_, j) => j !== i));
  const saveMaps = (which) => wrap(async () => {
    const rows = which === "model" ? modelRows : faultRows;
    const body = { rows: rows.map((r) => ({ device_type: r.device_type || "", device_no: r.device_no || "",
      value: (r.value === "" || r.value == null) ? null : Number(r.value), name: r.name || "" })) };
    await api(`/plc-devices/${outFor.id}/${which === "model" ? "models" : "faults"}`, { method: "PUT", body: JSON.stringify(body) });
  }, "Saved");
  // Model / Fault dono ka editor same shape — ek renderer
  const mapEditor = (which, rows, label) => (
    <div className="an-card">
      <div className="an-row" style={{ marginBottom: 6 }}>
        <b style={{ fontSize: 14 }}>{label} mapping</b>
        {outFor?.name && <span style={{ fontSize: 11.5, color: "#64748b", fontWeight: 600 }}>· {outFor.name}</span>}
        <span style={{ marginLeft: "auto", fontSize: 11.5, color: "#94a3b8" }}>PLC register value → {label.toLowerCase()} name.</span>
      </div>
      <table className="an-tbl">
        <thead><tr><th style={{ width: 110 }}>Device</th><th style={{ width: 150 }}>Device No</th><th style={{ width: 120 }}>Value</th><th>{label} Name</th><th style={{ width: 40 }}></th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>
                <select className="an-in" style={{ width: "100%", padding: "6px 8px" }} value={r.device_type || ""} onChange={(e) => setMap(which, i, "device_type", e.target.value)} title={MODBUS_ADDR_HINT[r.device_type] || ""}>
                  <option value="">—</option>
                  <AddrOptions proto={curProto} mcList={MC_ADDR} />
                </select>
              </td>
              <td><input className="an-in" style={{ width: "100%", padding: "6px 8px" }} value={r.device_no || ""} onChange={(e) => setMap(which, i, "device_no", e.target.value)} placeholder="e.g. 3001" /></td>
              <td><input className="an-in" type="number" style={{ width: "100%", padding: "6px 8px" }} value={r.value ?? ""} onChange={(e) => setMap(which, i, "value", e.target.value)} placeholder="e.g. 5" /></td>
              <td><input className="an-in" style={{ width: "100%", padding: "6px 8px" }} value={r.name || ""} onChange={(e) => setMap(which, i, "name", e.target.value)} placeholder={`${label} name`} /></td>
              <td><button className="an-x" onClick={() => delMap(which, i)}>×</button></td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={5} style={{ color: "#94a3b8" }}>No rows yet — “+ Add row”.</td></tr>}
        </tbody>
      </table>
      <div className="an-row" style={{ marginTop: 12, justifyContent: "space-between" }}>
        <button className="an-btn gh" onClick={() => addMap(which)}>+ Add row</button>
        <button className="an-btn" onClick={() => saveMaps(which)}>Save {label.toLowerCase()} mapping</button>
      </div>
    </div>
  );
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
        /* Call -> Output form ke box baaki page se chhote — form ek nazar me
           poora dikhna chahiye, scroll kiye bina. */
        .an-form-sm .an-in { padding:5px 8px; font-size:12.5px; border-radius:7px; }
        .an-form-sm .an-lbl { font-size:9.5px; margin-bottom:3px; }
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
          {user?.username && <span className="an-user" style={{ fontSize:12, color:"#64748b", fontWeight:600 }}>{user.username}</span>}
        </div>

        <div className="an-body">
          <div className="an-tabs">
            {[["board","Live Board"],["monitor","Monitor"],["faults","Fault History"],["calls","Call History"],["config","Configuration"],["callout","Call → Output"],["reports","Reports"]]
              .filter(([k]) => canAccess(TAB_KEY[k]))
              .map(([k, l]) => (
              <button key={k} className={`an-tab${tab === k ? " on" : ""}`} onClick={() => setTab(k)}>{l}</button>
            ))}
          </div>

          {tab === "config" && canAccess("andon-config") && (
            <>
              <div className="an-ctabs">
                {/* "Assign" tab hataya (user ki request).  Wo apne aap me adhoora
                    tha — usme zone/line chunne ka picker hai hi nahi (uska
                    `pickOutTarget` dead pada hai), isliye wo sirf shared
                    "Default template" dikhata tha aur kisi PLC tak pahunchta
                    hi nahi tha.  PLC ka mapping ab neeche list me har row ke
                    "📍 Assign" se khulta hai — `loadOutputs` khud `cfg` ko
                    "outputs" kar deta hai, to wahi ek click kaafi hai. */}
                {[["plc","PLC Devices"]].map(([k, l]) => (
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
                      <div><label className="an-lbl">PLC IP</label><input className="an-in" style={{ width:"100%" }} value={plcForm.ip} onChange={(e) => setPlcForm({ ...plcForm, ip: e.target.value })} placeholder="192.168.30.101" />
                        {plcForm.machine_no && <IpNote masterIp={masterIpOf(plcForm.machine_no)} value={plcForm.ip} />}</div>
                      <div><label className="an-lbl">Series</label>
                        <select className="an-in" style={{ width:"100%" }} value={plcForm.series || "Q"} onChange={(e) => onSeries("main", e.target.value)}>
                          {SERIES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select></div>
                      {/* Protocol ka chunav SIRF FX5U par — baaki series me Modbus/TCP
                          CPU ke andar hota hi nahi, wahan hamesha MC / SLMP. */}
                      {canModbus(plcForm.series) && (
                        <div><label className="an-lbl">Protocol</label>
                          <select className="an-in" style={{ width:"100%" }} value={plcForm.protocol || "MC"} onChange={(e) => onProto("main", e.target.value)}>
                            {PROTOCOLS.map((p) => <option key={p.v} value={p.v}>{p.label}</option>)}
                          </select>
                          {isModbus(plcForm.protocol) && <div style={{ fontSize:11, color:"#94a3b8", marginTop:3 }}>Read only — outputs still use MC.</div>}</div>
                      )}
                      <div><label className="an-lbl">Port</label><input className="an-in" style={{ width:"100%" }} type="number" value={plcForm.port} onChange={(e) => setPlcForm({ ...plcForm, port: e.target.value })} placeholder={String(defPort(effProto(plcForm.series, plcForm.protocol)))} /></div>
                      {effProto(plcForm.series, plcForm.protocol) === "MODBUS" && (
                        <div><label className="an-lbl">Unit ID</label><input className="an-in" style={{ width:"100%" }} type="number" min="0" max="255" value={plcForm.unit_id ?? 1} onChange={(e) => setPlcForm({ ...plcForm, unit_id: e.target.value })} placeholder="1" />
                          <div style={{ fontSize:11, color:"#94a3b8", marginTop:3 }}>Modbus slave ID.</div></div>
                      )}
                      <div><label className="an-lbl">Device Name</label><input className="an-in" style={{ width:"100%" }} value={plcForm.name} onChange={(e) => setPlcForm({ ...plcForm, name: e.target.value })} placeholder="e.g. Zone A Line 1" /></div>
                    </div>
                    {/* ── SUB PLC (optional) — Model/Fault kisi doosre PLC se ── */}
                    <div style={{ marginTop:14, paddingTop:12, borderTop:"1px dashed #e2e8f0" }}>
                      <label style={{ fontSize:13, fontWeight:700, display:"flex", alignItems:"center", gap:7 }}>
                        <input type="checkbox" checked={plcForm.sub_on} onChange={(e) => setPlcForm({ ...plcForm, sub_on: e.target.checked })} />
                        Sub PLC — read Model / Fault from a <u>different</u> PLC? <span style={{ fontWeight:600, color:"#64748b" }}>(ANDON stays on this main PLC)</span>
                      </label>
                      {plcForm.sub_on && (
                        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10, marginTop:12 }}>
                          <div><label className="an-lbl">Sub Machine No</label>
                            <select className="an-in" style={{ width:"100%" }} value={plcForm.sub_machine_no} onChange={(e) => onSubMachine(e.target.value)} disabled={!plcMachines.length}>
                              <option value="">select</option>
                              {plcMachines.map((m) => <option key={m} value={m}>{m}</option>)}
                            </select></div>
                          <div><label className="an-lbl">Sub PLC IP</label><input className="an-in" style={{ width:"100%" }} value={plcForm.sub_ip} onChange={(e) => setPlcForm({ ...plcForm, sub_ip: e.target.value })} placeholder="192.168.30.108" />
                          {plcForm.sub_machine_no && <IpNote masterIp={masterIpOf(plcForm.sub_machine_no)} value={plcForm.sub_ip} />}</div>
                          <div><label className="an-lbl">Sub Series</label>
                            <select className="an-in" style={{ width:"100%" }} value={plcForm.sub_series || "Q"} onChange={(e) => onSeries("sub", e.target.value)}>
                              {SERIES.map((s) => <option key={s} value={s}>{s}</option>)}
                            </select></div>
                          {canModbus(plcForm.sub_series) && (
                            <div><label className="an-lbl">Sub Protocol</label>
                              <select className="an-in" style={{ width:"100%" }} value={plcForm.sub_protocol || "MC"} onChange={(e) => onProto("sub", e.target.value)}>
                                {PROTOCOLS.map((p) => <option key={p.v} value={p.v}>{p.label}</option>)}
                              </select></div>
                          )}
                          <div><label className="an-lbl">Sub Port</label><input className="an-in" style={{ width:"100%" }} type="number" value={plcForm.sub_port} onChange={(e) => setPlcForm({ ...plcForm, sub_port: e.target.value })} placeholder={String(defPort(effProto(plcForm.sub_series, plcForm.sub_protocol)))} /></div>
                          {effProto(plcForm.sub_series, plcForm.sub_protocol) === "MODBUS" && (
                            <div><label className="an-lbl">Sub Unit ID</label><input className="an-in" style={{ width:"100%" }} type="number" min="0" max="255" value={plcForm.sub_unit_id ?? 1} onChange={(e) => setPlcForm({ ...plcForm, sub_unit_id: e.target.value })} placeholder="1" /></div>
                          )}
                          <div style={{ gridColumn:"1 / -1", fontSize:11.5, color:"#94a3b8" }}>Pick the Sub Machine first, then enter its PLC IP. Model & Fault registers are read from this Sub PLC; ANDON bits still come from the main PLC.</div>
                        </div>
                      )}
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
                          <Fragment key={e.id}>
                          <tr>
                            <td style={{ fontWeight:600 }}>{e.name}</td>
                            <td>{e.ip}:{e.port}
                              {effProto(e.series, e.protocol) === "MODBUS"
                                ? <Tag text={`${e.series} · Modbus · unit ${e.unit_id ?? 1}`} on />
                                : <Tag text={e.series} />}</td>
                            <td>{[e.zone, e.line, e.machine_no].filter(Boolean).join(" / ") || "—"}</td>
                            <td>
                              {!e.enabled ? <span style={{ color:"#94a3b8", fontSize:12 }}>— off —</span> : (
                                /* flexWrap: is patti me ab paanch cheezein hain (state, poll
                                   error, no-bits, Retry, Read now).  Phone/tablet ki tang
                                   chaudai par bina wrap ke ye ek doosre ko sikoda deti hain. */
                                <span style={{ display:"inline-flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                                  <PlcState online={e.online} reason={e.online_reason} dot={10} glow
                                            title={e.last_seen ? `last seen ${e.last_seen}` : (e.checked ? `checked ${e.checked}` : "")} />
                                  {/* Poller ki ASLI shikayat.  TCP probe se ye nahi dikhti —
                                      port khula hone par bhi protocol jawab na de to probe
                                      "ok" bol deta hai.  Pehle sirf laal batti dikhti thi. */}
                                  {e.poll_error && (
                                    <span title={e.poll_error}
                                          style={{ fontSize:10.5, color:"#b91c1c", background:"#fee2e2",
                                                   padding:"1px 6px", borderRadius:4, maxWidth:230,
                                                   overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                                      {e.poll_error}{e.poll_error_count > 1 ? ` ×${e.poll_error_count}` : ""}
                                    </span>
                                  )}
                                  {/* PLC juda hua hai par usme ek bhi bit-address
                                      bhara nahi — poll SAFAL hota hai (dummy read)
                                      isliye batti hari rehti hai, par alarm kabhi
                                      ban hi nahi sakta.  Pehle ye kahin dikhta nahi tha. */}
                                  {e.no_bits && (
                                    <span title="No bit address is filled in on this PLC, so an alarm can never be raised. Open Outputs below and fill in Address + Bit No."
                                          style={{ fontSize:10.5, color:"#b45309", background:"#fef3c7",
                                                   padding:"1px 6px", borderRadius:4, whiteSpace:"nowrap" }}>
                                      ⚠ no bits mapped
                                    </span>
                                  )}
                                  {e.online === false && (
                                    <button className="an-btn gh sm" disabled={rechecking === e.id}
                                            onClick={() => recheckPlc(e.id)}
                                            title="Check this PLC again right now">
                                      {rechecking === e.id ? "Checking…" : "↻ Retry"}
                                    </button>
                                  )}
                                  <button className="an-btn gh sm" disabled={readBusy === e.id}
                                          onClick={() => readNow(e.id)}
                                          title="Read this PLC's mapped bits right now and show their live values">
                                    {readBusy === e.id ? "Reading…" : "👁 Read now"}
                                  </button>
                                </span>
                              )}
                            </td>
                            <td><span className="an-chip" style={{ padding:"2px 9px", background: e.enabled ? "#dcfce7" : "#fee2e2", color: e.enabled ? "#16a34a" : "#dc2626" }}>{e.enabled ? "Enabled" : "Disabled"}</span></td>
                            <td style={{ whiteSpace:"nowrap" }}>
                              <button className="an-btn gh sm" onClick={() => openAssign(e)}>📍 Assign</button>{" "}
                              <button className="an-btn gh sm" onClick={() => startPlcEdit(e)}>Edit</button>{" "}
                              <button className="an-x" onClick={() => wrap(() => api(`/plc-devices/${e.id}`, { method:"DELETE" }), "PLC removed")}>×</button>
                            </td>
                          </tr>
                          {e.sub_ip && (
                            <tr>
                              <td style={{ color:"#64748b", fontSize:11.5, paddingTop:0, borderBottom:"1px solid #f1f5f9" }}>↳ Sub PLC</td>
                              <td style={{ paddingTop:0 }}>{e.sub_ip}:{e.sub_port}
                                {effProto(e.sub_series, e.sub_protocol) === "MODBUS"
                                  ? <Tag text={`${e.sub_series} · Modbus · unit ${e.sub_unit_id ?? 1}`} on />
                                  : <Tag text={e.sub_series} />}</td>
                              <td style={{ color:"#94a3b8", fontSize:11.5, paddingTop:0 }}>Model / Fault{e.sub_machine_no ? ` · ${e.sub_machine_no}` : ""}</td>
                              <td style={{ paddingTop:0 }}>
                                <span style={{ display:"inline-flex", alignItems:"center", gap:8 }}>
                                  <PlcState online={e.sub_online} reason={e.sub_online_reason} dot={9}
                                            title="Sub PLC (Model/Fault) connection" />
                                  {e.sub_online === false && (
                                    <button className="an-btn gh sm" disabled={rechecking === e.id}
                                            onClick={() => recheckPlc(e.id)}
                                            title="Check this PLC again right now">
                                      {rechecking === e.id ? "Checking…" : "↻ Retry"}
                                    </button>
                                  )}
                                </span>
                              </td>
                              <td colSpan={2} style={{ paddingTop:0 }} />
                            </tr>
                          )}
                          </Fragment>
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
                  {/* Per-machine Assign: ANDON · Model · Fault */}
                  {outFor.type === "plc" && (
                    <div className="an-ctabs" style={{ marginBottom:12 }}>
                      {[["andon","🚦 ANDON"],["model","🏷 Model"],["fault","⚠ Fault"]].map(([k, l]) => (
                        <button key={k} className={`an-ctab${assignTab === k ? " on" : ""}`} onClick={() => setAssignTab(k)}>{l}</button>
                      ))}
                    </div>
                  )}

                  {(outFor.type !== "plc" || assignTab === "andon") && (
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
                      <span style={{ marginLeft:"auto", fontSize:11.5, color:"#94a3b8" }}>
                        PLC bit — 1=ON, 0=OFF. Department scheme fixed for every PLC.
                        {isModbus(curProto) && " Modbus: write the address exactly as in the PLC (D3001); it is mapped automatically."}
                      </span>
                    </div>
                    <table className="an-tbl">
                      <thead><tr><th style={{ width:200 }}>Output</th><th>Department / role</th><th style={{ width:120 }}>Device</th><th style={{ width:130 }}>Device No</th></tr></thead>
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
                                <select className="an-in" style={{ width:"100%", padding:"6px 8px" }} value={r.bit_type || ""} onChange={(e) => setOut(i, "bit_type", e.target.value)} title={MODBUS_ADDR_HINT[r.bit_type] || ""}>
                                  <option value="">—</option>
                                  <AddrOptions proto={curProto} mcList={MC_BIT_ADDR} />
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

                  {outFor.type === "plc" && assignTab === "model" && mapEditor("model", modelRows, "Model")}
                  {outFor.type === "plc" && assignTab === "fault" && mapEditor("fault", faultRows, "Fault")}
                </>
              )}
            </>
          )}

          {tab === "monitor" && canAccess("andon-board") && <AndonMonitor embedded />}

          {tab === "callout" && canAccess("andon-config") && (
            <>
              <div className="an-card an-form-sm" style={{ marginBottom:14 }}>
                <b style={{ fontSize:14 }}>{outEdit ? "Edit mapping" : "Add Call → Output mapping"}</b>
                {/* Lamba samjhaane wala paragraph hata diya — wahi baat ab neeche
                    har bit ke saamne "Off trigger" me likhi hai, jahan uski zaroorat
                    hai.  Do jagah likhne se form bhara-bhara lagta tha. */}
                <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:9, marginTop:12 }}>
                  <div><label className="an-lbl">Department (call)</label>
                    <select className="an-in" style={{ width:"100%" }} value={outForm.department} onChange={(e) => setOutForm({ ...outForm, department: e.target.value })}>
                      <option value="">— select —</option>{depts.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
                    </select>
                  </div>
                  <div><label className="an-lbl">Output PLC IP</label><input className="an-in" style={{ width:"100%" }} value={outForm.plc_ip} onChange={(e) => setOutForm({ ...outForm, plc_ip: e.target.value })} placeholder="192.168.30.120" /></div>
                  <div><label className="an-lbl">Port</label><input className="an-in" style={{ width:"100%" }} type="number" value={outForm.plc_port} onChange={(e) => setOutForm({ ...outForm, plc_port: e.target.value })} placeholder="5007" /></div>
                  <div><label className="an-lbl">Series</label>
                    <select className="an-in" style={{ width:"100%" }} value={outForm.plc_series || "Q"} onChange={(e) => setOutForm({ ...outForm, plc_series: e.target.value })}>
                      {SERIES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select></div>
                </div>

                {/* ── BITS ─────────────────────────────────────────────────
                    Label sirf EK BAAR upar (pehle har row par TYPE/BIT NO
                    dohra rahe the aur bhadda lag raha tha).
                    Doosri bit SIRF Maintenance / Tool Room ke liye — baaki
                    department ka bit pehle se call band hone par hi girta hai,
                    to unke liye doosri bit wahi cheez dobara karegi. */}
                <div style={{ marginTop:14, paddingTop:12, borderTop:"1px dashed #cbd5e1" }}>
                  <b style={{ fontSize:13 }}>Bits</b>
                  <div style={{ fontSize:11.5, color:"#64748b", margin:"2px 0 10px" }}>
                    Turns ON as soon as a call arrives. When it turns OFF varies — see below.
                  </div>

                  {/* labels — ek hi baar */}
                  <div className="an-row an-bitrow" style={{ marginBottom:3, flexWrap:"nowrap" }}>
                    <div style={{ flex:"0 0 22px" }} />
                    <div style={{ flex:"0 0 78px" }}><label className="an-lbl">Type</label></div>
                    <div style={{ flex:"0 0 130px" }}><label className="an-lbl">Bit no</label></div>
                    <div style={{ flex:"1 1 auto", minWidth:0 }}><label className="an-lbl">Off trigger</label></div>
                  </div>

                  {[
                    { n: 1, t: "bit_type", v: "bit_no", show: true,
                      rule: outDeptOffAck(outForm.department) ? "On acknowledge" : "When breakdown closes",
                      color: outDeptOffAck(outForm.department) ? "#b45309" : "#0e7490", ph: "e.g. 1000" },
                    { n: 2, t: "bit2_type", v: "bit2_no", show: outDeptOffAck(outForm.department),
                      rule: "When breakdown closes", color: "#0e7490", ph: "blank = not used" },
                  ].filter((b) => b.show).map((b) => (
                    <div key={b.n} className="an-row an-bitrow" style={{ alignItems:"center", marginBottom:6, flexWrap:"nowrap" }}>
                      <div style={{ flex:"0 0 22px", fontSize:14, fontWeight:800, color:"#94a3b8" }}>{b.n}</div>
                      <div style={{ flex:"0 0 78px" }}>
                        <select className="an-in" style={{ width:"100%" }} value={outForm[b.t] || "M"}
                                onChange={(e) => setOutForm({ ...outForm, [b.t]: e.target.value })}>
                          {["M","Y","L","B","F","V","S"].map((x) => <option key={x} value={x}>{x}</option>)}
                        </select>
                      </div>
                      <div style={{ flex:"0 0 130px" }}>
                        <input className="an-in" style={{ width:"100%" }} value={outForm[b.v] || ""}
                               onChange={(e) => setOutForm({ ...outForm, [b.v]: e.target.value })}
                               placeholder={b.ph} />
                      </div>
                      <div style={{ flex:"1 1 auto", minWidth:0 }}>
                        <span className="an-rule-chip" style={{ display:"inline-block", whiteSpace:"nowrap", fontSize:11.5, fontWeight:800,
                                       color:b.color, background:b.color + "14", border:"1px solid " + b.color + "33",
                                       padding:"3px 9px", borderRadius:99 }}>
                          {b.rule}
                        </span>
                      </div>
                    </div>
                  ))}

                  {outForm.department && !outDeptOffAck(outForm.department) && (
                    <div style={{ fontSize:11.5, color:"#94a3b8", marginTop:2 }}>
                      The second bit is only for <b>Maintenance</b> and <b>Tool Room</b> —
                      only their bit drops on response. {outForm.department}'s bit
                      already drops only when the call closes.
                    </div>
                  )}
                </div>

                <div className="an-row" style={{ marginTop:12 }}>
                  <label style={{ fontSize:13, fontWeight:700, display:"flex", alignItems:"center", gap:6 }}>
                    <input type="checkbox" checked={outForm.enabled} onChange={(e) => setOutForm({ ...outForm, enabled: e.target.checked })} /> Enabled (write this bit)
                  </label>
                  <div style={{ marginLeft:"auto" }} />
                  {outEdit && <button className="an-btn gh" onClick={() => { setOutEdit(null); setOutForm({ department:"", plc_ip:"", plc_port:5007, plc_series:"Q", bit_type:"M", bit_no:"", bit2_type:"M", bit2_no:"", enabled:true }); }}>Cancel</button>}
                  <button className="an-btn" disabled={!outForm.department || !outForm.plc_ip.trim() || !String(outForm.bit_no).trim()} onClick={saveOut}>{outEdit ? "Save" : "+ Add mapping"}</button>
                </div>
              </div>

              <div className="an-card">
                <b style={{ fontSize:14 }}>Mappings ({outs.length})</b>
                {(() => {
                  const w = outs.find((o) => o.writer);
                  return (
                    <div style={{ fontSize:12, fontWeight:700, marginTop:6, marginBottom:2,
                                  display:"flex", alignItems:"center", gap:7,
                                  color: w ? "#16a34a" : "#dc2626" }}>
                      <span style={{ width:9, height:9, borderRadius:"50%", flex:"0 0 auto",
                                     background: w ? "#16a34a" : "#dc2626",
                                     boxShadow: w ? "0 0 0 3px rgba(22,163,74,.2)" : "0 0 0 3px rgba(220,38,38,.2)" }} />
                      {w ? <>Writer active — <span style={{ fontFamily:"monospace" }}>{w.writer}</span> backend is maintaining the bits (last seen {w.writer_age}s ago)</>
                         : <>No active writer — bits are not being maintained (the backend with ANDON_OUTPUT_ENABLED=1 is down)</>}
                    </div>
                  );
                })()}
                <table className="an-tbl">
                  <thead><tr><th>Department</th><th>Output PLC</th><th>Bit</th><th>Off trigger</th><th>Connection</th><th>Program bit</th><th>PLC bit</th><th>Status</th><th></th></tr></thead>
                  <tbody>
                    {outs.length === 0 && <tr><td colSpan={9} style={{ color:"#94a3b8", padding:16, textAlign:"center" }}>No mappings yet — add one above.</td></tr>}
                    {outs.map((o) => (
                      <tr key={o.id}>
                        <td style={{ fontWeight:700 }}>{o.department}</td>
                        <td style={{ fontFamily:"monospace" }}>{o.plc_ip}:{o.plc_port}<span style={{ marginLeft:6, fontSize:10, fontWeight:700, color:"#64748b", background:"#f1f5f9", padding:"1px 6px", borderRadius:99 }}>{o.plc_series}</span></td>
                        {/* Dono bit numbered lines me — har row ke chaar khaane
                            (Bit / Off trigger / Program bit / PLC bit) ek jaisi
                            do lines dikhate hain, isliye 1 aur 2 aapas me sidhe
                            me padhe jaate hain. */}
                        <td style={{ fontFamily:"monospace", fontWeight:700, lineHeight:1.75 }}>
                          <div><span style={{ color:"#94a3b8", marginRight:6 }}>1</span>{o.bit_type}{o.bit_no}</div>
                          {o.bit2_allowed && (
                            <div style={{ color: (o.bit2_no || "").trim() ? "#0e7490" : "#cbd5e1" }}>
                              <span style={{ color:"#94a3b8", marginRight:6 }}>2</span>
                              {(o.bit2_no || "").trim() ? `${o.bit2_type || "M"}${o.bit2_no}` : "not set"}
                            </div>
                          )}
                        </td>
                        <td style={{ fontSize:12, lineHeight:1.75 }}>
                          <div style={{ color: o.off_on_ack ? "#b45309" : "#0e7490", fontWeight:700 }}>
                            {o.off_on_ack ? "On acknowledge" : "When breakdown closes"}
                          </div>
                          {o.bit2_allowed && (
                            <div style={{ color: (o.bit2_no || "").trim() ? "#0e7490" : "#cbd5e1", fontWeight:700 }}>
                              {(o.bit2_no || "").trim() ? "When breakdown closes" : "—"}
                            </div>
                          )}
                        </td>
                        <td>
                          <span style={{ display:"inline-flex", alignItems:"center", gap:7, fontWeight:700, fontSize:12,
                                         color: o.reachable === true ? "#16a34a" : o.reachable === false ? "#dc2626" : "#94a3b8" }}>
                            <span style={{ width:10, height:10, borderRadius:"50%", flex:"0 0 auto",
                                           background: o.reachable === true ? "#16a34a" : o.reachable === false ? "#dc2626" : "#cbd5e1",
                                           boxShadow: o.reachable === true ? "0 0 0 3px rgba(22,163,74,.2)" : o.reachable === false ? "0 0 0 3px rgba(220,38,38,.2)" : "none" }} />
                            {o.reachable === true ? "Connected" : o.reachable === false ? "Disconnected" : "Checking…"}
                          </span>
                          {o.reachable === false && (
                            <button className="an-btn gh sm" style={{ marginLeft:8 }}
                                    disabled={outRechecking === o.id}
                                    onClick={() => recheckOut(o.id)}
                                    title="Try reconnecting to this PLC now">
                              {outRechecking === o.id ? "Checking…" : "↻ Retry"}
                            </button>
                          )}
                        </td>
                        {/* PROGRAM BIT = software ne kya tay kiya (khuli calls se).  Ye hamesha
                            pata hota hai — PLC se baat na ho tab bhi. */}
                        <td style={{ lineHeight:1.75, fontWeight:800 }}>
                          <div style={{ color: o.should_be_on ? "#16a34a" : "#94a3b8" }}>
                            {o.should_be_on ? "● ON" : "OFF"}
                          </div>
                          {o.bit2_allowed && (
                            <div style={{ color: o.should_be_on2 == null ? "#cbd5e1"
                                               : o.should_be_on2 ? "#16a34a" : "#94a3b8" }}>
                              {o.should_be_on2 == null ? "—" : (o.should_be_on2 ? "● ON" : "OFF")}
                            </div>
                          )}
                        </td>
                        <td style={{ lineHeight:1.75, fontWeight:800 }}>
                          <div style={{ color: o.bit_on === true ? "#16a34a"
                                             : o.bit_on === false ? "#94a3b8" : "#cbd5e1" }}>
                            {o.bit_on === true ? "● ON" : o.bit_on === false ? "OFF" : "—"}
                            {o.should_be_on && o.bit_on !== true && (
                              <span style={{ fontSize:10, color:"#b45309", fontWeight:700, marginLeft:6, whiteSpace:"nowrap" }}>
                                {o.bit_on === false ? "pending" : "not being read"}
                              </span>
                            )}
                          </div>
                          {o.bit2_allowed && (
                          <div title={(o.bit2_no || "").trim() && o.bit2_on == null
                                        ? "The writer has not reported this bit yet — the older backend does not write bit 2. It will appear after a restart."
                                        : undefined}
                               style={{ color: !(o.bit2_no || "").trim() ? "#cbd5e1"
                                             : o.bit2_on === true ? "#16a34a"
                                             : o.bit2_on === false ? "#94a3b8" : "#cbd5e1" }}>
                            {!(o.bit2_no || "").trim() ? "—"
                              : o.bit2_on === true ? "● ON" : o.bit2_on === false ? "OFF" : "— ?"}
                            {o.should_be_on2 && o.bit2_on !== true && (
                              <span style={{ fontSize:10, color:"#b45309", fontWeight:700, marginLeft:6, whiteSpace:"nowrap" }}>
                                {o.bit2_on === false ? "pending" : "no status"}
                              </span>
                            )}
                          </div>
                          )}
                        </td>
                        <td><span className="an-chip" style={{ padding:"2px 9px", background: o.enabled ? "#dcfce7" : "#fee2e2", color: o.enabled ? "#16a34a" : "#dc2626" }}>{o.enabled ? "Enabled" : "Disabled"}</span></td>
                        <td style={{ whiteSpace:"nowrap" }}>
                          <button className="an-btn gh sm" onClick={() => { setOutEdit(o.id); setOutForm({ department:o.department, plc_ip:o.plc_ip, plc_port:o.plc_port, plc_series:o.plc_series, bit_type:o.bit_type, bit_no:o.bit_no, bit2_type:o.bit2_type || "M", bit2_no:o.bit2_no || "", enabled:o.enabled }); }}>Edit</button>{" "}
                          <button className="an-x" onClick={() => wrap(() => api(`/call-outputs/${o.id}`, { method:"DELETE" }), "Mapping removed")}>×</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
              <div className="an-dept-cards"
                   style={{ display:"grid", gap:10, marginBottom:16,
                            gridTemplateColumns:`repeat(${Math.max(totals.length,1)}, minmax(0,1fr))` }}>
                {totals.map((t) => (
                  <div key={t.department} onClick={() => openHistory(t.department)}
                       title={`View full history for ${t.department}`}
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
          {tab === "faults" && canAccess("andon-faults") && (
            <>
              <div className="an-card" style={{ marginBottom:14 }}>
                <div className="an-row" style={{ gap:10, flexWrap:"wrap", alignItems:"flex-end" }}>
                  <label style={FH_LBL}>FY
                    <select className="an-in" style={FH_SEL} value={fhFy} onChange={(e)=>{ setFhFy(e.target.value); setFhMonth(""); }}>
                      <option value="">All</option>
                      {fhYears.map((y)=><option key={y.fy} value={y.fy}>{y.label || y.fy}</option>)}
                    </select></label>
                  <label style={FH_LBL}>Month
                    <select className="an-in" style={FH_SEL} value={fhMonth} onChange={(e)=>setFhMonth(e.target.value)}>
                      <option value="">All</option>
                      {fyMonthsList(fhFy).map((m)=><option key={m.value} value={m.value}>{m.label}</option>)}
                    </select></label>
                  <label style={FH_LBL}>Date
                    <input type="date" className="an-in" style={FH_SEL} value={fhDate} onChange={(e)=>setFhDate(e.target.value)} /></label>
                  <label style={FH_LBL}>Zone
                    <select className="an-in" style={FH_SEL} value={fhZone} onChange={(e)=>{ setFhZone(e.target.value); setFhLine(""); setFhMachine(""); }}>
                      <option value="">All</option>{fhZones.map((z)=><option key={z} value={z}>{z}</option>)}
                    </select></label>
                  <label style={FH_LBL}>Line
                    <select className="an-in" style={FH_SEL} value={fhLine} onChange={(e)=>{ setFhLine(e.target.value); setFhMachine(""); }}>
                      <option value="">All</option>{fhLines.map((l)=><option key={l} value={l}>{l}</option>)}
                    </select></label>
                  <label style={FH_LBL}>Machine
                    <select className="an-in" style={FH_SEL} value={fhMachine} onChange={(e)=>setFhMachine(e.target.value)}>
                      <option value="">All</option>{fhMachines.map((m)=><option key={m} value={m}>{m}</option>)}
                    </select></label>
                  <label style={FH_LBL}>Fault
                    <select className="an-in" style={FH_SEL} value={fhFault} onChange={(e)=>setFhFault(e.target.value)}>
                      <option value="">All</option>{fhFaultOpts.map((f)=><option key={f} value={f}>{f}</option>)}
                    </select></label>
                  <button className="an-btn gh sm" onClick={()=>{ setFhMonth(""); setFhDate(""); setFhZone(""); setFhLine(""); setFhMachine(""); setFhFault(""); }}>Reset</button>
                </div>
              </div>
              <div className="an-card">
                <div className="an-row" style={{ marginBottom:6 }}>
                  <b style={{ fontSize:14 }}>Fault History</b>
                  <span style={{ fontSize:10.5, fontWeight:800, color:"#16a34a" }}>● live</span>
                  <span style={{ marginLeft:"auto", fontSize:11.5, color:"#94a3b8" }}>
                    {fhRows.reduce((s,r)=>s+Number(r.total||0),0)} total · {fhRows.length} row{fhRows.length===1?"":"s"}
                  </span>
                </div>
                <table className="an-tbl">
                  <thead><tr><th style={{ width:40 }}>#</th><th>Zone</th><th>Line</th><th>Machine No</th><th>Fault Name</th><th style={{ width:90 }}>Total</th></tr></thead>
                  <tbody>
                    {fhRows.map((r,i)=>(
                      <tr key={i}>
                        <td style={{ color:"#94a3b8" }}>{i+1}</td>
                        <td>{r.zone||"—"}</td><td>{r.line||"—"}</td><td>{r.machine_no||"—"}</td>
                        <td style={{ fontWeight:700 }}>{r.fault}</td>
                        <td><span className="an-chip" style={{ background:"#dbeafe", color:"#1d4ed8", fontWeight:800, padding:"2px 10px" }}>{r.total}</span></td>
                      </tr>
                    ))}
                    {!fhRows.length && <tr><td colSpan={6} style={{ color:"#94a3b8" }}>No fault records in this range.</td></tr>}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {/* ── Call History ────────────────────────────────────────────
              Raw andon_history rows.  Reports jod-ghata dikhati hai; yahan
              ek-ek call dikhti hai, taaki admin kachra row hata sake
              (testing ki 2-second call, ya galat department wali). */}
          {tab === "calls" && canAccess("andon-calls") && (
            <div className="an-card">
              <div className="an-row" style={{ gap:10, flexWrap:"wrap", alignItems:"center", marginBottom:12 }}>
                <b style={{ fontSize:15 }}>Call History</b>
                <span style={{ color:"#94a3b8", fontSize:12 }}>
                  {chLoading
                    ? "Loading…"
                    : `${chShown.length} call${chShown.length === 1 ? "" : "s"}` +
                      (chDept ? ` of ${chRows.length}` : "")}
                </span>
                <label style={{ fontSize:12, color:"#64748b", fontWeight:700 }}>
                  Department{" "}
                  <select className="an-in" style={{ padding:"4px 8px", minWidth:150 }}
                          value={chDept} onChange={(e) => setChDept(e.target.value)}>
                    <option value="">All departments</option>
                    {depts.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
                  </select>
                </label>
                <label style={{ fontSize:12, color:"#64748b", fontWeight:700 }}>
                  Show latest{" "}
                  <select className="an-in" style={{ padding:"4px 8px", width:90 }}
                          value={chLimit} onChange={(e) => setChLimit(Number(e.target.value))}>
                    {[100, 200, 500, 1000].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
                <button className="an-btn gh sm" onClick={loadCallHistory}>↻ Refresh</button>
                <span style={{ marginLeft:"auto", display:"flex", gap:10, alignItems:"center" }}>
                  {isAdmin ? (
                    <>
                      <span style={{ fontSize:12, color:"#64748b", fontWeight:700 }}>
                        {chSel.size} selected
                      </span>
                      <button className="an-btn" disabled={!chSel.size}
                              style={{ background: chSel.size ? "#dc2626" : "#e2e8f0",
                                       color: chSel.size ? "#fff" : "#94a3b8",
                                       cursor: chSel.size ? "pointer" : "default" }}
                              onClick={chDelete}>
                        🗑 Delete selected
                      </button>
                    </>
                  ) : (
                    <span style={{ fontSize:11.5, color:"#94a3b8" }}>
                      only an admin can delete
                    </span>
                  )}
                </span>
              </div>

              <div style={{ maxHeight:520, overflowY:"auto" }}>
                <table className="an-tbl">
                  <thead><tr>
                    {isAdmin && <th style={{ width:34 }}>
                      <input type="checkbox"
                             title="Select all shown"
                             checked={!!chShown.length && chSel.size === chShown.length}
                             onChange={(e) => setChSel(e.target.checked
                               ? new Set(chShown.map((r) => r.id)) : new Set())} />
                    </th>}
                    <th style={{ width:60 }}>ID</th>
                    <th>Department</th><th>Zone</th><th>Line</th><th>Machine</th>
                    <th>Started</th><th>Ended</th>
                    <th style={{ width:100, textAlign:"center" }}>Response</th>
                    <th style={{ width:90, textAlign:"center" }}>Total</th>
                  </tr></thead>
                  <tbody>
                    {chLoading && <tr><td colSpan={isAdmin ? 10 : 9} style={{ color:"#94a3b8" }}>Loading…</td></tr>}
                    {!chLoading && !chShown.length &&
                      <tr><td colSpan={isAdmin ? 10 : 9} style={{ color:"#94a3b8" }}>
                        {chRows.length ? `No calls for ${chDept}.` : "No closed calls yet."}
                      </td></tr>}
                    {!chLoading && chShown.map((r) => (
                      <tr key={r.id} style={{ background: chSel.has(r.id) ? "#fef2f2" : undefined }}>
                        {isAdmin && <td>
                          <input type="checkbox" checked={chSel.has(r.id)}
                                 onChange={() => chToggle(r.id)} />
                        </td>}
                        <td style={{ color:"#94a3b8" }}>{r.id}</td>
                        <td style={{ fontWeight:700 }}>{r.department || r.display_name || "—"}</td>
                        <td>{r.zone || "—"}</td>
                        <td>{r.line || "—"}</td>
                        <td className="an-mno">{r.machine_no || "—"}</td>
                        <td style={{ whiteSpace:"nowrap", fontSize:12 }}>{fmtDT(r.started_at)}</td>
                        <td style={{ whiteSpace:"nowrap", fontSize:12 }}>{fmtDT(r.ended_at)}</td>
                        <td style={{ textAlign:"center" }}>
                          {r.response_seconds == null
                            ? <span style={{ color:"#94a3b8" }}>—</span>
                            : `${r.response_seconds}s`}
                        </td>
                        <td style={{ textAlign:"center", fontWeight:800 }}>
                          {r.duration_seconds == null ? "—" : `${r.duration_seconds}s`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === "reports" && canAccess("andon-reports") && (() => {
            const ymd = (dt) => `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")}`;
            const plantToday = () => { const n = new Date(); const d = new Date(n); if (n.getHours() < 7) d.setDate(d.getDate()-1); return ymd(d); };
            const addDays = (s, n) => { if (!s) return plantToday(); const [y,m,dd] = s.split("-").map(Number); const dt = new Date(y, m-1, dd); dt.setDate(dt.getDate()+n); return ymd(dt); };
            const sameRange = tlData && tlFrom === tlTo;
            // FY / Month — wahi list aur wahi label jo poore app me hai
            // (`fhYears` = /api/maintenance-kpi/financial-years, `fyMonthsList`
            // = "Apr 2026" wale labels).  Alag list banana bhram paida karta.
            const tlFyOpts    = fhYears.map((y) => ({ value: y.fy, label: (y.label || y.fy) + (y.is_current ? "  (current)" : "") }));
            const tlMonthOpts = fyMonthsList(tlFy || (fhYears.find((y) => y.is_current) || fhYears[0] || {}).fy || "");
            // Zone — sirf PRODUCTION zones (PROD_ZONES), jaisa baaki app me.
            // Line uske andar Machine Master se.
            const tlZoneOpts = PROD_ZONES.map((z) => ({ value: z, label: z }));
            const tlLineOpts = tlZone
              ? [...new Set(master.filter((m) => m.zone_name === tlZone).map((m) => m.line_name).filter(Boolean))]
                  .sort().map((l) => ({ value: l, label: l }))
              : [];
            const overlap = tlData ? Math.max(0, (tlData.raw_sum_seconds || 0) - (tlData.total_loss_seconds || 0)) : 0;
            return (
            <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
              {/* Total Loss card */}
              <div style={{ background:"#fff", border:"1px solid #e2e8f0", borderRadius:16,
                            boxShadow:"0 1px 3px rgba(0,0,0,.06)", overflow:"hidden", maxWidth:820 }}>
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
                    <button onClick={() => { setTlFy(""); setTlMonth("");
                              loadTotalLoss(tlFrom, tlTo, { zone: tlZone, line: tlLine }); }}
                            style={{ border:"none", background:"#1e40af", color:"#fff", borderRadius:8,
                                     padding:"6px 14px", fontWeight:700, fontSize:12.5, cursor:"pointer" }}>View</button>
                  </div>

                  {/* ── FY · Month · Zone · Line ──
                      Zone/Line ke option MACHINE MASTER se (project ka niyam).
                      FY ya Month chuno to From-To ki jagah wahi window chalti hai. */}
                  <div style={{ display:"flex", alignItems:"flex-end", gap:10, flexWrap:"wrap", marginTop:12 }}>
                    {[["Financial Year", tlFy, (v) => { setTlFy(v); setTlMonth("");
                          loadTotalLoss(null, null, { fy: v, zone: tlZone, line: tlLine }); },
                       [{ value:"", label:"All FY" }, ...tlFyOpts]],
                      ["Month", tlMonth, (v) => { setTlMonth(v);
                          loadTotalLoss(null, null, { fy: v ? "" : tlFy, month: v, zone: tlZone, line: tlLine }); },
                       [{ value:"", label:"All Months" }, ...tlMonthOpts]],
                      ["Zone", tlZone, (v) => { setTlZone(v); setTlLine("");
                          loadTotalLoss(tlFy || tlMonth ? null : tlFrom, tlFy || tlMonth ? null : tlTo,
                                        { fy: tlFy, month: tlMonth, zone: v }); },
                       [{ value:"", label:"All Zones" }, ...tlZoneOpts]],
                      ["Line", tlLine, (v) => { setTlLine(v);
                          loadTotalLoss(tlFy || tlMonth ? null : tlFrom, tlFy || tlMonth ? null : tlTo,
                                        { fy: tlFy, month: tlMonth, zone: tlZone, line: v }); },
                       [{ value:"", label:"All Lines" }, ...tlLineOpts]],
                    ].map(([lbl, val, on, opts]) => (
                      <div key={lbl} style={{ display:"flex", flexDirection:"column", gap:4 }}>
                        <label style={{ fontSize:10.5, fontWeight:800, letterSpacing:".04em",
                                        textTransform:"uppercase", color:"#94a3b8" }}>{lbl}</label>
                        <select value={val} onChange={(e) => on(e.target.value)}
                                disabled={lbl === "Line" && !tlZone}
                                style={{ padding:"6px 9px", border:"1px solid #cbd5e1", borderRadius:7,
                                         fontSize:12.5, fontWeight:600, minWidth:132,
                                         background: (lbl === "Line" && !tlZone) ? "#f1f5f9" : "#fff" }}>
                          {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </div>
                    ))}
                    {(tlFy || tlMonth || tlZone || tlLine) && (
                      <button onClick={() => { setTlFy(""); setTlMonth(""); setTlZone(""); setTlLine("");
                                               loadTotalLoss(tlFrom, tlTo); }}
                              style={{ border:"1px solid #cbd5e1", background:"#fff", borderRadius:8,
                                       padding:"6px 12px", fontWeight:700, fontSize:12.5, cursor:"pointer",
                                       color:"#475569" }}>✕ Clear</button>
                    )}
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

                      {/* Department-wise — jo call BAAD me dabi wo us lamhe ki
                          maalik.  Purani call, agar abhi khuli hai, nayi ke
                          khatam hote hi phir se ginne lagti hai — isliye in
                          tukdon ka JOD upar wale TOTAL ke barabar rehta hai. */}
                      {(tlData?.by_department || []).length > 0 && (
                        <div style={{ marginTop:18, borderTop:"1px solid #f1f5f9", paddingTop:14 }}>
                          <div style={{ fontSize:11, color:"#94a3b8", fontWeight:700,
                                        textTransform:"uppercase", marginBottom:8 }}>
                            Department-wise (time counted against each)
                          </div>
                          <table style={{ width:"100%", borderCollapse:"collapse" }}>
                            <tbody>
                              {tlData.by_department.map((d) => {
                                const pct = tlData.total_loss_seconds
                                  ? Math.round((d.seconds / tlData.total_loss_seconds) * 100) : 0;
                                return (
                                  <tr key={d.department}>
                                    <td style={{ padding:"5px 0", fontSize:13, fontWeight:700, color:"#334155",
                                                 whiteSpace:"nowrap", width:150 }}>{d.department}</td>
                                    <td style={{ padding:"5px 8px", width:"100%" }}>
                                      <div style={{ background:"#f1f5f9", borderRadius:99, height:8 }}>
                                        <div style={{ width:`${pct}%`, background:"#dc2626",
                                                      height:8, borderRadius:99 }} />
                                      </div>
                                    </td>
                                    <td style={{ padding:"5px 0", fontSize:13, fontWeight:800, color:"#0f172a",
                                                 textAlign:"right", whiteSpace:"nowrap",
                                                 fontVariantNumeric:"tabular-nums" }}>{fmtClock(d.seconds)}</td>
                                    <td style={{ padding:"5px 0 5px 10px", fontSize:11.5, color:"#94a3b8",
                                                 textAlign:"right", width:44 }}>{pct}%</td>
                                  </tr>
                                );
                              })}
                              <tr>
                                <td style={{ paddingTop:9, fontSize:13, fontWeight:800, color:"#0f172a",
                                             borderTop:"1px solid #e2e8f0" }}>Total</td>
                                <td style={{ borderTop:"1px solid #e2e8f0" }} />
                                <td style={{ paddingTop:9, fontSize:13, fontWeight:900, color:"#dc2626",
                                             textAlign:"right", borderTop:"1px solid #e2e8f0",
                                             fontVariantNumeric:"tabular-nums" }}>
                                  {fmtClock(tlData.by_department.reduce((a, b) => a + b.seconds, 0))}
                                </td>
                                <td style={{ borderTop:"1px solid #e2e8f0" }} />
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      )}

                      {/* ── Date x Zone x Line ──
                          HAR LINE apni alag hai: ek line ki call doosri line ko
                          nahi rokti, isliye preemption har line ke ANDAR alag
                          lagti hai aur yahan ka Total un sab ka JOD hai.  Kal
                          naye ANDON jude to unki line apne aap is table me
                          aa jayegi — kuch badalna nahi padega. */}
                      {(tlData?.by_line || []).length > 0 && (
                        <div style={{ marginTop:18, borderTop:"1px solid #f1f5f9", paddingTop:14 }}>
                          <div style={{ fontSize:11, color:"#94a3b8", fontWeight:700,
                                        textTransform:"uppercase", marginBottom:8 }}>
                            Line-wise loss
                          </div>
                          <div style={{ overflowX:"auto" }}>
                            <table style={{ width:"100%", borderCollapse:"collapse", minWidth:420 }}>
                              <thead>
                                <tr>
                                  {["Date","Zone","Line","Calls","Total Loss"].map((h,i) => (
                                    <th key={h} style={{ textAlign: i>2 ? "right" : "left",
                                                         padding:"6px 8px", fontSize:10.5, fontWeight:800,
                                                         letterSpacing:".04em", textTransform:"uppercase",
                                                         color:"#64748b", background:"#f8fafc",
                                                         borderBottom:"1px solid #e2e8f0", whiteSpace:"nowrap" }}>{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {tlData.by_line.map((r, i) => (
                                  <tr key={`${r.date}|${r.zone}|${r.line}`}
                                      style={{ background: i % 2 ? "#fafbfc" : "#fff" }}>
                                    <td style={{ padding:"6px 8px", fontSize:12.5, whiteSpace:"nowrap" }}>{r.date}</td>
                                    <td style={{ padding:"6px 8px", fontSize:12.5 }}>{r.zone}</td>
                                    <td style={{ padding:"6px 8px", fontSize:12.5, fontWeight:700, color:"#334155" }}>{r.line}</td>
                                    <td style={{ padding:"6px 8px", fontSize:12.5, textAlign:"right", color:"#64748b" }}>{r.calls}</td>
                                    <td style={{ padding:"6px 8px", fontSize:13, fontWeight:800, color:"#0f172a",
                                                 textAlign:"right", fontVariantNumeric:"tabular-nums" }}>{fmtClock(r.seconds)}</td>
                                  </tr>
                                ))}
                                <tr>
                                  <td colSpan={3} style={{ padding:"9px 8px", fontSize:13, fontWeight:800,
                                                           color:"#0f172a", borderTop:"1.5px solid #cbd5e1" }}>Total</td>
                                  <td style={{ padding:"9px 8px", fontSize:12.5, textAlign:"right", color:"#64748b",
                                               borderTop:"1.5px solid #cbd5e1" }}>
                                    {tlData.by_line.reduce((a,b) => a + (b.calls || 0), 0)}
                                  </td>
                                  <td style={{ padding:"9px 8px", fontSize:14, fontWeight:900, color:"#dc2626",
                                               textAlign:"right", borderTop:"1.5px solid #cbd5e1",
                                               fontVariantNumeric:"tabular-nums" }}>
                                    {fmtClock(tlData.by_line.reduce((a,b) => a + b.seconds, 0))}
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
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
      {/* ── "Read now" ka natija ────────────────────────────────────────
          Yahan teen cheezein ek saath dikhti hain, jo pehle kahin nahi
          dikhti thin: kaunsa protocol SACH ME chala, har bit ka asli Modbus
          pata, aur us pate par ABHI ki value.  "Data aa raha hai par alarm
          nahi" jaisi dikkat isi table se ek nazar me pakdi jaati hai. */}
      {readOut && (
        <div onClick={() => setReadOut(null)}
             style={{ position:"fixed", inset:0, background:"rgba(15,23,42,.55)",
                      display:"flex", alignItems:"center", justifyContent:"center",
                      zIndex:1000, padding:20 }}>
          <div onClick={(e) => e.stopPropagation()}
               style={{ background:"#fff", borderRadius:16, width:"min(760px,96vw)",
                        maxHeight:"88vh", display:"flex", flexDirection:"column",
                        boxShadow:"0 20px 60px rgba(0,0,0,.35)", overflow:"hidden" }}>
            <div style={{ padding:"16px 20px", borderBottom:"1px solid #e2e8f0",
                          display:"flex", alignItems:"center", justifyContent:"space-between" }}>
              <div>
                <div style={{ fontSize:15, fontWeight:800, color:"#0f172a" }}>
                  Live read — {readOut.name || "PLC"}
                </div>
                {readOut.ip && (
                  <div style={{ fontSize:11.5, color:"#64748b", marginTop:2 }}>
                    {/* PLC band ho to sabse pehle yahi dikhna chahiye — poller
                        aisi PLC ko chhod deta hai, chahe value kuch bhi ho. */}
                    {readOut.enabled === false && (
                      <span style={{ background:"#fee2e2", color:"#b91c1c", fontWeight:800,
                                     padding:"1px 6px", borderRadius:4, marginRight:6 }}>
                        PLC is OFF
                      </span>
                    )}
                    {readOut.ip}:{readOut.port} · {readOut.series || "?"} ·
                    {" "}protocol <b>{readOut.protocol_used}</b>
                    {readOut.protocol_asked !== readOut.protocol_used
                      ? ` (set to ${readOut.protocol_asked})` : ""}
                    {readOut.protocol_used === "MODBUS" ? ` · unit ${readOut.unit_id}` : ""}
                  </div>
                )}
              </div>
              <button className="an-btn gh sm" onClick={() => setReadOut(null)}>Close</button>
            </div>

            <div style={{ padding:"14px 20px", overflowY:"auto" }}>
              {readOut.error && (
                <div style={{ background:"#fef2f2", border:"1px solid #fecaca", color:"#991b1b",
                              borderRadius:8, padding:"10px 12px", fontSize:12.5,
                              fontWeight:600, lineHeight:1.5, marginBottom:10,
                              /* do sandesh ek saath aa sakte hain (asli wajah +
                                 read ki galti) -- dono alag dikhne chahiye */
                              whiteSpace:"pre-line" }}>
                  {readOut.error}
                </div>
              )}
              {readOut.hint && (
                <div style={{ background:"#fffbeb", border:"1px solid #fde68a", color:"#92400e",
                              borderRadius:8, padding:"10px 12px", fontSize:12.5,
                              fontWeight:600, lineHeight:1.5, marginBottom:10 }}>
                  {readOut.hint}
                </div>
              )}

              {!!(readOut.rows || []).length && (
                /* Phone par chaar column tang padte hain -- table ko apne
                   dabbe me side se khisakne dete hain, page ko nahi. */
                <div style={{ overflowX:"auto" }}>
                <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12.5,
                                minWidth:760 }}>
                  <thead>
                    <tr style={{ textAlign:"left", color:"#64748b", fontSize:11 }}>
                      <th style={{ padding:"6px 8px" }}>Output</th>
                      <th style={{ padding:"6px 8px" }}>Device</th>
                      <th style={{ padding:"6px 8px" }}>Address read</th>
                      <th style={{ padding:"6px 8px" }}>Department</th>
                      <th style={{ padding:"6px 8px", textAlign:"center" }}>Value</th>
                      <th style={{ padding:"6px 8px" }}>What the poller does</th>
                    </tr>
                  </thead>
                  <tbody>
                    {readOut.rows.map((r) => (
                      <tr key={r.do_index} style={{ borderTop:"1px solid #f1f5f9" }}>
                        <td style={{ padding:"7px 8px", fontWeight:700 }}>
                          {r.name}
                          <div style={{ fontSize:10.5, fontWeight:600, color:"#94a3b8" }}>OUT{r.do_index}</div>
                        </td>
                        <td style={{ padding:"7px 8px", fontFamily:"monospace" }}>
                          {r.bit_type}{r.bit_no}
                        </td>
                        <td style={{ padding:"7px 8px", fontFamily:"monospace", color:"#475569" }}>
                          {r.addr || "—"}
                        </td>
                        {/* Department khali ho to ye output CALL nahi rehta — pichhle
                            output ka ACKNOWLEDGE bit ban jaata hai, aur uska bit ON
                            karne par call kabhi banti hi nahi. */}
                        <td style={{ padding:"7px 8px" }}>
                          {r.department
                            ? r.department
                            : <span style={{ color:"#b45309" }}>— none —</span>}
                          {r.role === "ack" && (
                            <div style={{ fontSize:10.5, fontWeight:700, color:"#b45309" }}>
                              acknowledge bit for OUT{r.ack_of}
                            </div>
                          )}
                          {r.open_call && (
                            <div style={{ fontSize:10.5, color:"#15803d" }}>call #{r.open_call} already open</div>
                          )}
                        </td>
                        <td style={{ padding:"7px 8px", textAlign:"center" }}>
                          {r.error
                            ? <span style={{ color:"#b91c1c", fontWeight:700, fontSize:11.5 }}>{r.error}</span>
                            : r.value === null || r.value === undefined
                              ? <span style={{ color:"#94a3b8" }}>—</span>
                              : <span style={{ fontWeight:800,
                                               color: r.on ? "#15803d" : "#94a3b8" }}>
                                  {r.on ? "ON" : "off"} ({r.value})
                                </span>}
                        </td>
                        {/* Value dikhna kaafi nahi tha — poller uske baad jo
                            faisla leta hai, wahi batata hai ki ruk kahan raha hai. */}
                        <td style={{ padding:"7px 8px", fontSize:11.5,
                                     color: (r.would || "").startsWith("would OPEN") ? "#15803d"
                                          : (r.would || "").startsWith("off") ? "#94a3b8" : "#b45309",
                                     fontWeight: (r.would || "").startsWith("off") ? 500 : 700 }}>
                          {r.would || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              )}

              {!readOut.error && !(readOut.rows || []).length && (
                <div style={{ color:"#94a3b8", fontSize:12.5 }}>Nothing to show.</div>
              )}

              {/* "Read now" seedha padhta hai; POLLER alag dhaage me chalta hai.
                  Dono ka haal alag ho sakta hai — isliye poller ka apna haal
                  yahan alag se dikhate hain. */}
              {readOut.poller && (
                <div style={{ marginTop:12, padding:"8px 10px", background:"#f8fafc",
                              border:"1px solid #e2e8f0", borderRadius:8,
                              fontSize:11.5, color:"#475569", lineHeight:1.6 }}>
                  <b>Poller</b> — the part that actually raises calls:{" "}
                  {/* Ye backend khud poll karta bhi hai ya nahi — bina iske
                      "never checked" padh kar galat nateeje par pahunch jaate
                      hain, jabki usse yahan poll karna hi nahi tha. */}
                  {readOut.poller.enabled_here === false
                    ? <span style={{ color:"#b45309", fontWeight:700 }}>
                        this backend does not poll — only the production server raises calls
                      </span>
                    : readOut.poller.last_checked
                      ? <>last checked <b>{readOut.poller.last_checked}</b></>
                      : <span style={{ color:"#b91c1c", fontWeight:700 }}>has never checked this PLC</span>}
                  {/* Ye line KISI BHI server ke baare me hai (DB ke nishaan se) —
                      upar wali sirf isi backend ki baat karti hai. */}
                  <div style={{ marginTop:3 }}>
                    Any server:{" "}
                    {readOut.poller.any_last_at
                      ? <>last poll <b>{readOut.poller.any_last_at}</b>
                          {readOut.poller.any_last_by ? ` by ${readOut.poller.any_last_by}` : ""}
                          {readOut.poller.any_stale_s > 120
                            ? <span style={{ color:"#b91c1c", fontWeight:700 }}> — stale</span> : ""}</>
                      : <span style={{ color:"#b91c1c", fontWeight:700 }}>
                          no server has ever polled this PLC
                        </span>}
                    {/* Koshish ka nishaan alag hai — isse pata chalta hai ki
                        poller ZINDA hai, bas jud/padh nahi paa raha. */}
                    {readOut.poller.others_total > 0 && (
                      <div style={{ marginTop:2 }}>
                        Other PLCs: <b>{readOut.poller.others_fresh}</b> of{" "}
                        {readOut.poller.others_total} polled in the last 2 minutes
                      </div>
                    )}
                    {readOut.poller.any_error && (
                      <div style={{ color:"#b91c1c", fontWeight:700, marginTop:2 }}>
                        last try {readOut.poller.any_try_at} failed: {readOut.poller.any_error}
                      </div>
                    )}
                  </div>
                  {readOut.poller.error && (
                    <div style={{ color:"#b91c1c", fontWeight:700, marginTop:3 }}>
                      failing: {readOut.poller.error}
                      {readOut.poller.error_count > 1 ? ` ×${readOut.poller.error_count}` : ""}
                    </div>
                  )}
                  {readOut.poller.no_bits && (
                    <div style={{ color:"#b45309", fontWeight:700, marginTop:3 }}>
                      the poller sees no bit addresses on this PLC
                    </div>
                  )}
                </div>
              )}

              <div style={{ marginTop:12, fontSize:11.5, color:"#64748b", lineHeight:1.6 }}>
                A bit shows <b>ON</b> only while the PLC is actually holding that output on.
                If you raise a call on the machine and the value here stays <b>off</b>, the
                address is pointing somewhere else — compare it with the PLC’s own device list.
                {" "}If the value is <b>ON</b> but no call appears, check the <b>Department</b>
                {" "}column: an output with no department is treated as the acknowledge bit for
                {" "}the output above it, so it can never raise a call.
              </div>
            </div>
          </div>
        </div>
      )}

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
                  No {histDept} calls in this date range.
                </div>
              ) : (
                <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
                  <thead>
                    <tr style={{ background:"#f8fafc", position:"sticky", top:0 }}>
                      {["Date","Zone","Line","Start","End","Duration (loss)", ...(showResp?["Response"]:[]), ...(isAdmin?[""]:[])].map((h) => (
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
                        {isAdmin && (
                          <td style={{ padding:"9px 14px", whiteSpace:"nowrap", textAlign:"right" }}>
                            <button onClick={() => deleteHistRow(r)} disabled={histDel === r.id}
                                    title="Remove this call from history"
                                    style={{ border:"1px solid #fecaca", background:"#fff", color:"#dc2626",
                                             borderRadius:7, cursor:"pointer", padding:"3px 9px",
                                             fontSize:12, fontWeight:800,
                                             opacity: histDel === r.id ? .5 : 1 }}>
                              {histDel === r.id ? "…" : "🗑"}
                            </button>
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
                One IP can belong to only ONE PLC. If two boards share an IP,
                both boards' data lands on the same line and no one will notice.
              </div>
            </div>
            <div style={{ padding:"0 20px 18px", textAlign:"right" }}>
              <button onClick={() => setAlertBox(null)}
                      style={{ border:"none", background:"#dc2626", color:"#fff",
                               borderRadius:9, padding:"9px 22px", fontSize:13,
                               fontWeight:800, cursor:"pointer", fontFamily:"inherit" }}>
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
