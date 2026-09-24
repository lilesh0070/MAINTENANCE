/* ───────────────────────────────────────────────────────────────────
 * WorkRecords.jsx — "Work Records"  (/work-records)
 * ───────────────────────────────────────────────────────────────────
 * User 2026-09-24: "ek page banao jiska access sab ke paas rahega ... upar se
 * neeche tak 4 me divide kar do page ko 25% me -- upar Log Book, uske neeche
 * Breakdown (manual aur auto dono), uske neeche Daily Assign Work, Holiday Plan
 * Work.  Upar ek baar filter laga dena -- wahi jaisa History Card me hai
 * (zone, line, machine no vagairah)."
 *
 * SABKE LIYE KHULA: koi permission key NAHI (App.jsx me `requiredAccess`
 * nahi, SlideNav me `open: true`).  Isliye ye page Page Permissions ki list
 * (admin/mailconfig.jsx) me bhi JAAN-BOOJH KAR nahi hai -- wahan ka toggle
 * yahan kuch karta hi nahi, bas bhram deta.  Charon GET endpoint bhi sirf
 * login maangte hain (get_current_user), kisi page ki ijazat nahi.
 *
 * Data (sirf padhna, koi likhna/mitana nahi):
 *   Log Book          GET /api/breakdown-logbook/?date_from&date_to
 *   Breakdown         GET /api/breakdowns/log?src=all   (manual + auto;
 *                     auto sirf COMPLETED -- bd_source.py ka niyam)
 *   Daily Work Assign GET /api/daily-plan/
 *   Holiday Plan Work GET /api/sunday-plan/
 * ZONE TAB NAHI (user 2026-09-24: "upar zone wala hata do") -- charon hisse
 * SAB zone ka data ek saath dikhate hain, har table me Zone ka column.
 * Tareekh ki khidki server par jaati hai; Line / Machine No / Machine Name
 * yahin chhante jaate hain (bina dobara maange), options POORE machine master
 * se (ek line ka naam do zone me kabhi nahi aata -- DB me jaancha, 50 line).
 * Tareekh bhi yahin DOBARA jaanchte hain -- purana backend Log Book ke naye
 * param nahi samajhta, tab bhi galat qatar na dikhe.
 *
 * Filter bar History Card wala hi hai -- wahi `hc-*` class, taaki app/tablet/
 * TV ke header ke jo niyam responsive.css me hain wo yahan bhi lagein.
 * "✕ Clear" ki class alag (`wr-clear`): phone par `.hc-back` chhupa diya
 * jaata hai (responsive.css), aur Clear phone par bhi chahiye.  Header ka
 * "← Back" = `DashBack` (main Dashboard par wapas; website + TV par dikhta,
 * phone/tablet app me chhupa).
 *
 * ⚠ TV ka WebView purana hai: rang `rgba()` me, `color-mix` / `inset` /
 *   8-ank hex nahi; section ke beech ki doori margin se (flex `gap` ke bharose
 *   nahi).  Koi lagataar animation nahi.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import DashBack from "../components/DashBack";
import { isNativeApp } from "../constants/apiBase";

const NATIVE = isNativeApp();
const IcoCal = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
  </svg>
);

const MONTHS = ["January", "February", "March", "April", "May", "June",
                "July", "August", "September", "October", "November", "December"];
// aaj -- YYYY-MM-DD (Date filter ka default, History Card jaisa)
function todayLocalISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
/* "2026-09" -> "2026-09-30" (us mahine ka aakhri din) */
function mahineKaAnt(ym) {
  const [y, m] = String(ym).split("-").map(Number);
  return y && m ? `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}` : "";
}
// FY ke mahine: [{value:"2025-04", label:"Apr 2025"}, …]  (April → March)
function fyMonths(fy) {
  const y = parseInt(String(fy).split("-")[0], 10);
  if (isNaN(y)) return [];
  const out = [];
  for (let i = 0; i < 12; i++) {
    const mo = ((3 + i) % 12) + 1;
    const yr = mo >= 4 ? y : y + 1;
    out.push({ value: `${yr}-${String(mo).padStart(2, "0")}`, label: `${MONTHS[mo - 1].slice(0, 3)} ${yr}` });
  }
  return out;
}
// Filter → tareekh ki khidki.  Sabse sankri jeetti hai: Date > Month > FY.
// (Date hamesha chune hue mahine ke andar hi hoti hai -- calendar min/max se.)
function khidki(fy, month, date) {
  if (date) return { from: date, to: date };
  if (month) return { from: `${month}-01`, to: mahineKaAnt(month) };
  const y = parseInt(String(fy).split("-")[0], 10);
  if (fy && !isNaN(y)) return { from: `${y}-04-01`, to: `${y + 1}-03-31` };
  return { from: "", to: "" };
}
const qs = (o) => Object.entries(o)
  .filter(([, v]) => v !== "" && v != null)
  .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
// Naam ki tulna me faaltu space na atkaye (master me kuch naam do-space /
// newline wale hain).
const saaf = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const din = (v) => (v ? String(v).slice(0, 10) : "");
const ginti = (v) => {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(v);
  return Number.isFinite(n) ? String(Math.round(n * 10) / 10) : String(v);
};

async function getJson(path, token) {
  const r = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try { const j = await r.json(); if (j?.detail) msg = String(j.detail); } catch { /* text nahi */ }
    throw new Error(msg);
  }
  return r.json();
}

/* ── Chaar hisse ──────────────────────────────────────────────────────
   `d/l/mno/mnm` = us source me tareekh / line / machine no /
   machine name ka khaana (har table ke naam alag hain).
   Column: h = heading, k = khaana, wrap = lamba text, fn = khud banao. */
const STATUS_BADGE = (st) => (
  <span className={`wr-badge ${st === "DONE" ? "ok" : "pend"}`}>{st === "DONE" ? "✓ Done" : "Pending"}</span>
);
const PLAN_COLS = (withAssignee) => [
  { h: "Date",           k: "plan_date", fn: (r) => din(r.plan_date), b: true },
  { h: "Zone",           k: "zone_name" },
  { h: "Line",           k: "line_name" },
  { h: "M/C No",         k: "machine_no", b: true },
  { h: "Machine",        k: "machine_name", wrap: true },
  { h: "Problem / Work", k: "problem", wrap: true },
  ...(withAssignee ? [{ h: "Assigned To", k: "assigned_to", b: true }] : []),
  { h: "Status",         k: "status", fn: (r) => STATUS_BADGE(r.status) },
  { h: "Action Taken",   k: "work_done", wrap: true, fn: (r) => (r.status === "DONE" ? r.work_done : "") },
  { h: "Done By",        k: "done_by", fn: (r) => (r.status === "DONE" ? r.done_by : "") },
  { h: "Start",          k: "start_time" },
  { h: "End",            k: "end_time" },
  { h: "Total (min)",    k: "duration_minutes", fn: (r) => ginti(r.duration_minutes) },
  { h: "Spares Used",    k: "spares_used", wrap: true },
];

const SECTIONS = [
  {
    key: "lb", title: "Log Book", icon: "📒", color: "#0f766e", soft: "rgba(13,148,136,.08)",
    empty: "No Log Book entries",
    url: (w) => `/api/breakdown-logbook/?${qs({ date_from: w.from, date_to: w.to })}`,
    pick: (res) => (Array.isArray(res) ? res : []),
    d: "bd_date", l: "line", mno: "machine_no", mnm: "machine_name",
    cols: [
      { h: "Date",             k: "bd_date", fn: (r) => din(r.bd_date), b: true },
      { h: "Shift",            k: "shift" },
      { h: "Zone",             k: "zone" },
      { h: "Line",             k: "line" },
      { h: "M/C No",           k: "machine_no", b: true },
      { h: "Machine",          k: "machine_name", wrap: true },
      { h: "Problem Observed", k: "problem_observed_by_maintenance", wrap: true },
      { h: "Action Taken",     k: "action_taken_on_problem", wrap: true },
      { h: "Start",            k: "bd_start_time" },
      { h: "End",              k: "bd_ok_time" },
      { h: "Total (min)",      k: "mc_down_time_minutes", fn: (r) => ginti(r.mc_down_time_minutes) },
      { h: "Spares Used",      k: "spares_used", wrap: true },
      { h: "Attended By",      k: "bd_attended_by" },
    ],
  },
  {
    key: "bd", title: "Breakdown", sub: "Manual + Auto slips", icon: "🚨", color: "#b91c1c",
    soft: "rgba(220,38,38,.07)", empty: "No breakdown slips",
    url: (w) => `/api/breakdowns/log?${qs({ src: "all", date_from: w.from, date_to: w.to, limit: 3000 })}`,
    pick: (res) => (Array.isArray(res?.rows) ? res.rows : []),
    d: "bd_date", l: "line_code", mno: "machine_no", mnm: "machine_name",
    cols: [
      { h: "Slip Type",           k: "source",
        fn: (r) => (String(r.source || "").toLowerCase().startsWith("auto")
          ? <span className="wr-badge auto">Auto</span>
          : <span className="wr-badge man">Manual</span>) },
      { h: "Date",                k: "bd_date", fn: (r) => din(r.bd_date), b: true },
      { h: "Shift",               k: "shift" },
      { h: "Zone",                k: "zone_code" },
      { h: "Line",                k: "line_code" },
      { h: "M/C No",              k: "machine_no", b: true },
      { h: "Machine",             k: "machine_name", wrap: true },
      { h: "Problem (Production)",  k: "problem_production", wrap: true },
      { h: "Problem (Maintenance)", k: "problem_maintenance", wrap: true },
      { h: "Action Taken",        k: "action_taken", wrap: true },
      { h: "BD Start",            k: "bd_start_time" },
      { h: "BD OK",               k: "bd_ok_time" },
      { h: "Down Time (min)",     k: "solve_time_min", fn: (r) => ginti(r.solve_time_min) },
      { h: "Attended By",         k: "attended_by" },
      { h: "Category",            k: "category" },
    ],
  },
  {
    key: "daily", title: "Daily Work Assign", icon: "📋", color: "#1d4ed8", soft: "rgba(37,99,235,.07)",
    empty: "No daily work assigned",
    url: (w) => `/api/daily-plan/?${qs({ date_from: w.from, date_to: w.to, limit: 2000 })}`,
    pick: (res) => (Array.isArray(res?.rows) ? res.rows : []),
    d: "plan_date", l: "line_name", mno: "machine_no", mnm: "machine_name",
    cols: PLAN_COLS(true),
  },
  {
    key: "hol", title: "Holiday Plan Work", icon: "☀️", color: "#b45309", soft: "rgba(217,119,6,.08)",
    empty: "No holiday plan work",
    url: (w) => `/api/sunday-plan/?${qs({ date_from: w.from, date_to: w.to, limit: 2000 })}`,
    pick: (res) => (Array.isArray(res?.rows) ? res.rows : []),
    d: "plan_date", l: "line_name", mno: "machine_no", mnm: "machine_name",
    cols: PLAN_COLS(false),
  },
];

// Har hissa apne aap taaza -- TV par ye page din bhar khula reh sakta hai.
// Sirf data dobara aata hai (koi animation nahi), aur tab tabhi jab screen
// saamne ho.
const TAAZA_MS = 60000;

export default function WorkRecords() {
  const { token, theme, user } = useAuth();

  const [master, setMaster] = useState([]);
  const [years, setYears]   = useState([]);
  const [fFy, setFFy]       = useState("");
  const [fMonth, setFMonth] = useState("");
  // Page khulte hi AAJ ka din (History Card jaisa); Clear karke mahina/FY dekho.
  const [fDate, setFDate]   = useState(todayLocalISO());
  const [fLine, setFLine]   = useState("");
  const [fMno, setFMno]     = useState("");
  const [fMname, setFMname] = useState("");

  // key = kis from|to ka jawab hai; secs = { lb: {rows, err}, bd: …, … }.
  // "Loading…" alag state nahi -- key abhi ke filter se na mile tab tak loading.
  const [data, setData] = useState({ key: "", secs: {} });
  const booted = useRef(false);
  const reqNo = useRef(0);

  // FY list + machine master (Line / Machine ke option isi se)
  useEffect(() => {
    if (!token) return;
    getJson("/api/maintenance-kpi/financial-years", token)
      .then((y) => {
        const list = Array.isArray(y) ? y : [];
        setYears(list);
        if (!booted.current && list.length) {
          booted.current = true;
          const cur = (list.find((v) => v.is_current) || list[list.length - 1]).fy;
          setFFy(cur);
          const cm = todayLocalISO().slice(0, 7);
          if (fyMonths(cur).some((m) => m.value === cm)) setFMonth(cm);
        }
      }).catch(() => setYears([]));
    getJson("/api/machines/", token)
      .then((m) => setMaster(Array.isArray(m) ? m : [])).catch(() => setMaster([]));
  }, [token]);

  const monthOpts = useMemo(() => (fFy ? fyMonths(fFy) : []), [fFy]);
  const lineOpts = useMemo(
    () => [...new Set(master.map((m) => m.line_name).filter(Boolean))].sort(), [master]);
  const machineNoOpts = useMemo(
    () => (fLine
      ? [...new Set(master.filter((m) => m.line_name === fLine).map((m) => m.machine_no).filter(Boolean))].sort()
      : []), [master, fLine]);
  const machineNameOpts = useMemo(
    () => (fLine
      ? [...new Set(master.filter((m) => m.line_name === fLine).map((m) => m.machine_name).filter(Boolean))].sort()
      : []), [master, fLine]);

  // FY chuno → mahina apne aap: chalu FY me abhi ka mahina, warna April.
  const onFy = (v) => {
    setFDate("");
    if (!v) { setFFy(""); setFMonth(""); return; }
    setFFy(v);
    const yObj = years.find((y) => y.fy === v);
    if (yObj?.is_current) setFMonth(todayLocalISO().slice(0, 7));
    else setFMonth(`${parseInt(String(v).split("-")[0], 10)}-04`);
  };
  // Mahina badla aur chuna hua din us mahine ka nahi → din hatao (warna sab khaali).
  const onMonth = (v) => { setFMonth(v); if (fDate && v && fDate.slice(0, 7) !== v) setFDate(""); };
  const onFLine  = (v) => { setFLine(v); setFMno(""); setFMname(""); };
  // Machine No chuno → uska naam master se apne aap
  const onFMno = (v) => {
    setFMno(v);
    const m = master.find((x) => x.line_name === fLine && String(x.machine_no) === String(v));
    setFMname(m?.machine_name || "");
  };
  const clearFilters = () => {
    setFFy(""); setFMonth(""); setFDate(""); setFLine(""); setFMno(""); setFMname("");
  };

  const w = useMemo(() => khidki(fFy, fMonth, fDate), [fFy, fMonth, fDate]);

  const reqKey = `${w.from}|${w.to}`;
  const loading = data.key !== reqKey;

  // Chaaron ek saath.  `chup` = taaza karna: ek source ka ek baar ka jhatka
  // ho to uski purani qatarein rehne do.  Purana jawab baad me aaye to phenk
  // do (reqNo).  setState sirf jawab aane ke BAAD (`then` me) -- effect se
  // seedha nahi (react-hooks/set-state-in-effect).
  const load = useCallback((chup = false) => {
    if (!token) return;
    const key = `${w.from}|${w.to}`;
    const no = ++reqNo.current;
    Promise.allSettled(SECTIONS.map((s) => getJson(s.url(w), token))).then((res) => {
      if (no !== reqNo.current) return;
      setData((d) => ({
        key,
        secs: Object.fromEntries(SECTIONS.map((s, i) => {
          const r = res[i];
          if (r.status === "fulfilled") return [s.key, { rows: s.pick(r.value), err: "" }];
          if (chup && d.key === key && d.secs[s.key]) return [s.key, d.secs[s.key]];
          return [s.key, { rows: [], err: r.reason?.message || "Could not load" }];
        })),
      }));
    });
  }, [token, w]);

  useEffect(() => { load(false); }, [load]);
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") load(true); }, TAAZA_MS);
    const jago = () => { if (document.visibilityState === "visible") load(true); };
    document.addEventListener("visibilitychange", jago);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", jago); };
  }, [load]);

  // Line / Machine yahin chhaante; tareekh bhi dobara (upar note).
  const rowsOf = useCallback((s) => {
    const all = data.secs[s.key]?.rows || [];
    const mno = saaf(fMno), mnm = saaf(fMname);
    return all.filter((r) => {
      const d = din(r[s.d]);
      if (w.from && d < w.from) return false;
      if (w.to && d > w.to) return false;
      if (fLine && r[s.l] !== fLine) return false;
      if (mno && saaf(r[s.mno]) !== mno) return false;
      if (mnm && saaf(r[s.mnm]) !== mnm) return false;
      return true;
    });
  }, [data, w, fLine, fMno, fMname]);

  const kya = fDate ? fDate : fMonth
    ? (monthOpts.find((m) => m.value === fMonth)?.label || fMonth)
    : fFy ? `FY ${fFy}` : "All dates";

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700;800&family=Barlow+Condensed:wght@700;800&display=swap');
        /* 100vh hi -- website par body ka 8px margin + Layout ka apna
           min-height:100vh har page ko 16px khiskata hai (sab page par
           aisa hi hai); yahan kam karne se sirf neeche halki patti aati. */
        .wr-root { min-height:100vh; display:flex; flex-direction:column; background:#eef2f7;
                   font-family:'Barlow',sans-serif; }
        .hc-top { background:#fff; border-bottom:1px solid #e2e8f0; height:56px; padding:0 28px 0 96px;
                  display:flex; align-items:center; justify-content:space-between; flex:none;
                  position:sticky; top:0; z-index:50; box-shadow:0 1px 3px rgba(0,0,0,.06); }
        .hc-top::after { content:''; position:absolute; bottom:0; left:0; right:0; height:2px; background:${theme.gradient}; }
        .hc-title { font-family:'Barlow Condensed',sans-serif; font-size:22px; font-weight:800; color:#0f172a; }
        .hc-title span { color:${theme.accent}; }
        .hc-sub { font-size:11px; color:#94a3b8; margin-top:-2px; }
        .wr-clear { display:flex; align-items:center; gap:6px; font-size:13px; font-weight:700; color:#475569;
                   background:#f1f5f9; border:1px solid #e2e8f0; border-radius:8px; padding:7px 14px; cursor:pointer;
                   font-family:inherit; }
        .wr-body { flex:1 0 0px; display:flex; flex-direction:column; width:100%; max-width:1900px;
                   margin:14px auto 0; padding:0 22px 16px; box-sizing:border-box; }
        .hc-filters { display:flex; gap:12px; flex-wrap:wrap; align-items:flex-end; margin-bottom:12px; flex:none; }
        .hc-fld { display:flex; flex-direction:column; gap:5px; }
        .hc-fld label { font-size:10.5px; font-weight:800; letter-spacing:.05em; text-transform:uppercase; color:#64748b; }
        .hc-fsel { border:1.5px solid #cbd5e1; border-radius:9px; padding:9px 12px; font-size:13px; font-weight:600;
                   color:#0f172a; outline:none; font-family:'Barlow',sans-serif; background:#fff; min-width:150px; }
        .hc-fsel:focus { border-color:${theme.accent}; }
        .hc-fsel:disabled { background:#f1f5f9; color:#94a3b8; cursor:not-allowed; }
        .wr-clear { padding:9px 16px; }
        .wr-dwrap { position:relative; }
        .wr-dwrap > input { width:100%; box-sizing:border-box; }
        .wr-dph { position:absolute; left:13px; top:50%; transform:translateY(-50%); color:#94a3b8;
                  font-size:13px; font-weight:600; pointer-events:none; }
        .wr-dico { position:absolute; right:11px; top:50%; transform:translateY(-50%); color:#64748b;
                   pointer-events:none; display:flex; }
        ${NATIVE ? ".wr-dwrap > input[type=date] { -webkit-appearance:none; appearance:none; }" : ""}

        /* Chaar barabar hisse: stack bachi hui poori oonchai leta hai, aur
           har hissa usme se 1/4 (flex 1 1 0) -- page screen me hi fit.
           Naapa: 1440x900 laptop par bachi jagah ~690px (har hissa ~165).
           Bahut chhoti screen par kam se kam 560px (har hissa ~140, heading
           + 2-3 qatar) -- tab page khud neeche khisakta hai.  Table apne
           dabbe ke andar hi scroll hoti hai. */
        .wr-stack { flex:1 0 0px; min-height:560px; display:flex; flex-direction:column; }
        .wr-sec { flex:1 1 0px; min-height:0; display:flex; flex-direction:column; background:#fff;
                  border:1px solid #e2e8f0; border-radius:12px; overflow:hidden;
                  box-shadow:0 1px 4px rgba(15,23,42,.06); }
        .wr-sec + .wr-sec { margin-top:12px; }
        .wr-head { flex:none; display:flex; align-items:center; flex-wrap:wrap; padding:8px 14px;
                   border-bottom:1px solid #e2e8f0; border-left:5px solid #64748b; }
        .wr-head > * { margin-right:12px; }
        .wr-ttl { font-family:'Barlow Condensed',sans-serif; font-size:18px; font-weight:800; color:#0f172a;
                  display:flex; align-items:center; white-space:nowrap; }
        .wr-ttl .ic { font-size:17px; margin-right:7px; }
        .wr-tsub { font-size:11px; font-weight:700; color:#64748b; white-space:nowrap; }
        .wr-chip { font-size:11px; font-weight:800; padding:3px 10px; border-radius:99px; white-space:nowrap;
                   background:#f1f5f9; color:#334155; border:1px solid #e2e8f0; }
        .wr-chip.ok   { background:#dcfce7; color:#15803d; border-color:#bbf7d0; }
        .wr-chip.pend { background:#fef3c7; color:#b45309; border-color:#fde68a; }
        .wr-chip.man  { background:rgba(220,38,38,.07); color:#b91c1c; border-color:rgba(220,38,38,.25); }
        .wr-chip.auto { background:rgba(124,58,237,.08); color:#6d28d9; border-color:rgba(124,58,237,.25); }
        .wr-when { margin-left:auto; margin-right:0 !important; font-size:11px; font-weight:700; color:#94a3b8;
                   white-space:nowrap; }
        .wr-scroll { flex:1 1 0px; min-height:0; overflow:auto; -webkit-overflow-scrolling:touch; }
        /* responsive.css chhoti screen par har <table> ko display:block + apna
           scroll de deta hai -- tab sticky heading dabbe me nahi chipakti.
           Yahan scroll dabba (wr-scroll) karta hai, table nahi. */
        .wr-scroll > table.wr-table { display:table; max-width:none; overflow:visible; }
        .wr-table { width:100%; border-collapse:collapse; font-size:12.5px; }
        .wr-table th { text-align:left; padding:8px 11px; font-size:10.5px; font-weight:800; letter-spacing:.02em;
                       color:#475569; border-bottom:2px solid #e2e8f0; white-space:nowrap; background:#f8fafc;
                       position:sticky; top:0; z-index:1; }
        .wr-table td { padding:7px 11px; border-bottom:1px solid #f1f5f9; color:#334155; vertical-align:top;
                       white-space:nowrap; }
        .wr-table td.wrap { white-space:normal; min-width:160px; max-width:280px; line-height:1.35; }
        /* Laptop par har hissa ~165px ka -- lamba text (problem / action) ek
           qatar ko 4-5 line ka bana deta tha aur dabbe me 1 hi qatar dikhti.
           Isliye SIRF website ke bade screen par 2 line + "…" (poora text
           mouse le jaane par, title se).  Phone / tablet / TV par mouse hai
           hi nahi -- wahan poora text. */
        @media (min-width: 641px) {
          body:not(.in-app):not(.in-app-tab):not(.in-app-tv) .wr-table td.wrap .clamp {
            display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
        }
        .wr-table td.b { font-weight:700; color:#0f172a; }
        .wr-table td.sno { font-weight:700; color:#94a3b8; }
        .wr-table tr:hover td { background:#f8fafc; }
        .wr-badge { display:inline-block; padding:2px 9px; border-radius:99px; font-size:10.5px; font-weight:800; }
        .wr-badge.ok   { background:#dcfce7; color:#15803d; }
        .wr-badge.pend { background:#fef3c7; color:#b45309; }
        .wr-badge.man  { background:rgba(220,38,38,.08); color:#b91c1c; }
        .wr-badge.auto { background:rgba(124,58,237,.10); color:#6d28d9; }
        /* khaali / loading: sandesh dabbe ke theek beech */
        .wr-scroll.khali { display:flex; flex-direction:column; }
        .wr-empty { flex:1 0 auto; min-height:70px; display:flex; align-items:center; justify-content:center;
                    color:#94a3b8; font-size:13px; font-weight:600; padding:14px; text-align:center; box-sizing:border-box; }
        .wr-empty.err { color:#b91c1c; }

        /* PHONE (website ≤640px, aur app ka in-app): 4 x 25% phone par
           100-100px ke dabbe bana deta -- kaam ka nahi.  Yahan har hissa
           apni qatar jitna, par 70% screen se lamba nahi (andar scroll),
           aur page neeche khisakta hai.  Filter 2-2 ki jodi me. */
        @media (max-width: 640px) {
          /* website ko phone par kholo to header: lamba subtitle 5 line me
             toot kar neeche ki cheezon par chadh jaata tha (naapa 375px).  App me ye
             kaam responsive.css ke in-app niyam pehle se karte hain. */
          .wr-root .hc-top { height:auto; min-height:56px; padding-top:6px; padding-bottom:6px; padding-left:88px; }
          .wr-root .hc-sub, .wr-root .hc-top .app-user { display:none; }
          .wr-root .hc-title { white-space:nowrap; font-size:20px; }
          .wr-body { padding:0 10px 14px; margin-top:10px; }
          .wr-stack { flex:none; min-height:0; }
          .wr-sec { flex:none; max-height:70vh; }
          .wr-scroll { flex:0 1 auto; }
          .wr-root .hc-filters { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
          .wr-root .hc-fsel { min-width:0; width:100%; box-sizing:border-box; }
          .wr-when { margin-left:0; width:100%; margin-top:2px; }
        }
        body.in-app .wr-body { padding:0 10px 14px; margin-top:10px; }
        body.in-app .wr-stack { flex:none; min-height:0; }
        body.in-app .wr-sec { flex:none; max-height:70vh; }
        body.in-app .wr-scroll { flex:0 1 auto; }
      `}</style>

      <div className="wr-root">
        <div className="hc-top">
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <DashBack />
            <div>
              <div className="hc-title">Work <span>Records</span></div>
              <div className="hc-sub">Log Book · Breakdown · Daily Work Assign · Holiday Plan Work</div>
            </div>
          </div>
          {user?.username && <span className="app-user" style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>{user.username}</span>}
        </div>

        <div className="wr-body">
          {/* History Card jaisa hi filter: FY · Month · Date · Line · Machine No · Machine Name */}
          <div className="hc-filters">
            <div className="hc-fld">
              <label>Financial Year</label>
              <select className="hc-fsel" value={fFy} onChange={(e) => onFy(e.target.value)}>
                <option value="">All FY</option>
                {years.map((y) => <option key={y.fy} value={y.fy}>{y.fy}{y.is_current ? " (current)" : ""}</option>)}
              </select>
            </div>
            <div className="hc-fld">
              <label>Month</label>
              <select className="hc-fsel" value={fMonth} onChange={(e) => onMonth(e.target.value)} disabled={!fFy}>
                <option value="">All Months</option>
                {monthOpts.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            <div className="hc-fld">
              <label>Date</label>
              {/* App (Android WebView) me khaali date BLANK + teer dikhti hai --
                  website jaisa "mm/dd/yyyy" + calendar upar se (KpiPanel.jsx
                  wala hi tareeqa).  Tap seedha input par jaata hai. */}
              <div className="wr-dwrap">
                <input className="hc-fsel" type="date" value={fDate}
                       min={fMonth ? `${fMonth}-01` : undefined}
                       max={fMonth ? mahineKaAnt(fMonth) : undefined}
                       onChange={(e) => setFDate(e.target.value)} />
                {NATIVE && !fDate && <span className="wr-dph">mm/dd/yyyy</span>}
                {NATIVE && <span className="wr-dico"><IcoCal /></span>}
              </div>
            </div>
            <div className="hc-fld">
              <label>Line</label>
              <select className="hc-fsel" value={fLine} onChange={(e) => onFLine(e.target.value)}>
                <option value="">All Lines</option>
                {lineOpts.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div className="hc-fld">
              <label>Machine No.</label>
              <select className="hc-fsel" value={fMno} onChange={(e) => onFMno(e.target.value)} disabled={!fLine}>
                <option value="">All Machine No.</option>
                {machineNoOpts.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div className="hc-fld">
              <label>Machine Name</label>
              <select className="hc-fsel" value={fMname} onChange={(e) => setFMname(e.target.value)} disabled={!fLine}>
                <option value="">All Machine Names</option>
                {machineNameOpts.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div className="hc-fld">
              <label>&nbsp;</label>
              <button className="wr-clear" onClick={clearFilters}>✕ Clear</button>
            </div>
          </div>

          <div className="wr-stack">
            {SECTIONS.map((s) => {
              const st = data.secs[s.key] || { rows: [], err: "" };
              const rows = rowsOf(s);
              const done = s.key === "daily" || s.key === "hol"
                ? rows.filter((r) => r.status === "DONE").length : 0;
              const auto = s.key === "bd"
                ? rows.filter((r) => String(r.source || "").toLowerCase().startsWith("auto")).length : 0;
              return (
                <section key={s.key} className="wr-sec">
                  <div className="wr-head" style={{ borderLeftColor: s.color, background: s.soft }}>
                    <span className="wr-ttl" style={{ color: s.color }}>
                      <span className="ic">{s.icon}</span>{s.title}
                    </span>
                    {s.sub && <span className="wr-tsub">{s.sub}</span>}
                    <span className="wr-chip">{rows.length} {rows.length === 1 ? "entry" : "entries"}</span>
                    {s.key === "bd" && rows.length > 0 && (<>
                      <span className="wr-chip man">Manual {rows.length - auto}</span>
                      <span className="wr-chip auto">Auto {auto}</span>
                    </>)}
                    {(s.key === "daily" || s.key === "hol") && rows.length > 0 && (<>
                      <span className="wr-chip ok">Done {done}</span>
                      <span className="wr-chip pend">Pending {rows.length - done}</span>
                    </>)}
                    <span className="wr-when">All zones · {kya}</span>
                  </div>
                  <div className={`wr-scroll${rows.length === 0 ? " khali" : ""}`}>
                    {loading && rows.length === 0 ? (
                      <div className="wr-empty">Loading…</div>
                    ) : !loading && st.err ? (
                      <div className="wr-empty err">Could not load {s.title}: {st.err}</div>
                    ) : rows.length === 0 ? (
                      <div className="wr-empty">{s.empty} for this filter.</div>
                    ) : (
                      <table className="wr-table">
                        <thead>
                          <tr>
                            <th>#</th>
                            {s.cols.map((c) => <th key={c.h}>{c.h}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r, i) => (
                            <tr key={`${r.source || s.key}-${r.id}`}>
                              <td className="sno">{i + 1}</td>
                              {s.cols.map((c) => {
                                const v = c.fn ? c.fn(r) : r[c.k];
                                const khali = v === null || v === undefined || v === "";
                                return (
                                  <td key={c.h} className={`${c.wrap ? "wrap" : ""} ${c.b ? "b" : ""}`}>
                                    {khali ? <span style={{ color: "#cbd5e1" }}>—</span>
                                      : (c.wrap && typeof v === "string")
                                        ? <span className="clamp" title={v}>{v}</span> : v}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
