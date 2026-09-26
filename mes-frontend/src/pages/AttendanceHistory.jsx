/* ───────────────────────────────────────────────────────────────────
 * AttendanceHistory.jsx — Attendance Dashboard ka "History" (user
 * 2026-09-26: "history ka option bhi de de, history check kar sakein jisme
 * sab ho").
 *
 *   • Register: har aadmi x har din ki kataar (G / A / B / WO / L / WFH),
 *     daayein har aadmi ki ginti; neeche har din kitne duty par / leave par.
 *     Tareekh (column ka sira) dabao -> us din ka board.  Naam dabao -> us
 *     aadmi ke badlav.
 *   • Changes: kisne kab kya badla -- kataar badli, joda, hataya, details.
 *   • Dono ka Excel (ExcelBtn: website par download, APK me Downloads).
 *
 * Ek aadmi = ek qatar (emp code se) -- purana record hata kar naya joda ho
 * to bhi.  Ginti sirf AAJ tak; aage ke din "planned" (halke, ginti me nahi).
 * Hisaab backend me: Phase2/routers/attendance.py -> GET /api/attendance/history.
 *
 * TV par ye khulta hi nahi (button chhupa -- TV ka layout band hai).  App me
 * koi lagataar animation nahi.  Android ka Back -> `data-back-close` wala ×
 * (apiBase.js setupBackButton).
 * ─────────────────────────────────────────────────────────────────── */
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import ExcelBtn from "../components/ExcelBtn";

/* ── tareekh ke chhote helper (dashboard jaise) ── */
const pad = (n) => String(n).padStart(2, "0");
const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dateOf = (s) => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = dateOf(s); d.setDate(d.getDate() + n); return isoOf(d); };
const monthStart = (s) => `${String(s).slice(0, 7)}-01`;
const spanDays = (a, b) => Math.round((dateOf(b) - dateOf(a)) / 86400000) + 1;
const fmt = (s, o) => dateOf(s).toLocaleDateString("en-GB", o);
const longDay = (s) => fmt(s, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const shortDay = (s) => fmt(s, { day: "2-digit", month: "short", year: "numeric" });
const timeOf = (ts) => {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true });
};
const MAX_DAYS = 93;                 // backend ki HIST_MAX_DAYS jaisa

const ACTION = { move: "Shift changed", add: "Added", remove: "Removed", delete: "Deleted", edit: "Details changed" };

export default function AttendanceHistory({ token, theme, slots, today, native, onClose, onOpenDay }) {
  const SLOT = useMemo(() => Object.fromEntries(slots.map((s) => [s.key, s])), [slots]);
  const [start, setStart] = useState(() => monthStart(today));
  const [end, setEnd] = useState(today);
  const [tab, setTab] = useState("register");
  const [q, setQ] = useState("");
  const [rev, setRev] = useState(0);
  // Jawab kis maang ka hai (`key`) -- "load ho raha hai" usi se nikalta hai,
  // alag state nahi (effect me seedha setState React ka niyam todta hai).
  const [got, setGot] = useState({ key: null, data: null, err: "" });
  const gridRef = useRef(null);

  const bad = !start || !end ? "Choose both dates."
    : start > end ? "The From date must be on or before the To date."
      : spanDays(start, end) > MAX_DAYS ? `Please choose at most ${MAX_DAYS} days at a time.` : "";
  const want = `${start}|${end}|${rev}`;

  useEffect(() => {
    if (bad) return undefined;
    let off = false;                 // range badli / band hua -> purana jawab chhodo
    api.get(`/api/attendance/history?start=${start}&end=${end}`, token)
      .then((d) => { if (!off) setGot({ key: want, data: d, err: "" }); })
      .catch((e) => { if (!off) setGot((g) => ({ ...g, key: want, err: e.message || "Could not load the history." })); });
    return () => { off = true; };
  }, [want, start, end, token, bad]);

  // galat range par purana jawab mat dikhao (upar tareekh kuch, neeche kuch)
  const data = bad ? null : got.data;
  const err = got.key === want ? got.err : "";
  const busy = !bad && got.key !== want;          // naya range maanga, jawab abhi nahi aaya

  // naya data: grid ko itna daayein ki AAJ (range me na ho to aakhri din) ka
  // column daayein kinare par dikhe -- haal ke din pehle.  Seedha aakhir tak
  // nahi: phone par tab sirf ginti wale column dikhte the, ek bhi din nahi.
  useEffect(() => {
    const g = gridRef.current;
    const th = g && data ? g.querySelector("[data-ah-focus]") : null;
    if (th) g.scrollLeft = Math.max(0, th.offsetLeft + th.offsetWidth - g.clientWidth + 6);
  }, [data, tab]);

  useEffect(() => {
    const k = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const ql = q.trim().toLowerCase();
  const people = useMemo(() => {
    const all = data ? data.people : [];
    return ql ? all.filter((p) => [p.name, p.emp_code, p.designation]
      .some((v) => (v || "").toLowerCase().includes(ql))) : all;
  }, [data, ql]);
  const changes = useMemo(() => {
    const all = data ? data.changes : [];
    return ql ? all.filter((c) => [c.name, c.emp_code, c.by, c.detail]
      .some((v) => (v || "").toLowerCase().includes(ql))) : all;
  }, [data, ql]);
  const sums = useMemo(() => {
    const s = Object.fromEntries(slots.map((x) => [x.key, 0]));
    s.duty = 0;
    for (const p of people) {
      for (const x of slots) s[x.key] += p.totals[x.key] || 0;
      s.duty += p.totals.duty || 0;
    }
    return s;
  }, [people, slots]);
  const byDay = useMemo(() => {
    const g = [];
    for (const c of changes) {
      if (!g.length || g[g.length - 1].day !== c.day) g.push({ day: c.day, items: [] });
      g[g.length - 1].items.push(c);
    }
    return g;
  }, [changes]);

  const quick = [
    ["This month", monthStart(today), today],
    ["Last month", monthStart(addDays(monthStart(today), -1)), addDays(monthStart(today), -1)],
    ["Last 7 days", addDays(today, -6), today],
    ["Last 30 days", addDays(today, -29), today],
  ];
  const setRange = (a, b) => { setStart(a); setEnd(b); };

  const label = (k) => (k ? (SLOT[k]?.label || k) : "");
  const badge = (k) => (k ? (SLOT[k]?.badge || k) : "");
  const chip = (k) => (k ? (
    <span className="ah-chip" style={{ "--c": SLOT[k]?.c || "#64748b", "--soft": SLOT[k]?.soft || "#f1f5f9" }}>
      {label(k)}
    </span>
  ) : null);

  const whatOf = (c) => {
    if (c.action === "move") return <>{chip(c.from)}<span className="ah-arrow">→</span>{chip(c.to)}</>;
    if (c.action === "add") return <>Added to {chip(c.to)}</>;
    if (c.action === "remove") return <>Removed from the board{c.from ? <> (was in {chip(c.from)})</> : null}</>;
    if (c.action === "delete") return <>Deleted (it had been added by mistake)</>;
    if (c.action === "edit") return <>Details changed: <b>{c.detail || "—"}</b></>;
    return c.action;
  };

  /* ── Excel ── */
  const regExcel = () => {
    if (!data) return { rows: [] };
    const heads = data.days.map((d) => `${fmt(d, { day: "2-digit", month: "short" })} ${fmt(d, { weekday: "short" })}`
      + (d > data.today ? " (planned)" : ""));
    const rows = people.map((p) => [
      p.name, p.emp_code, p.designation,
      ...p.slots.map((s) => badge(s)),
      ...slots.map((x) => p.totals[x.key] || 0), p.totals.duty || 0,
      p.removed_on ? `Removed ${shortDay(p.removed_on)}` : "",
    ]);
    if (rows.length) {
      const pick = (f) => data.day_totals.map(f);
      rows.push([]);
      rows.push(["On duty (G + A + B)", "", "", ...pick((t) => t.duty)]);
      rows.push(["Leave", "", "", ...pick((t) => t.LEAVE)]);
      rows.push(["Week Off", "", "", ...pick((t) => t.WO)]);
      rows.push(["On the board", "", "", ...pick((t) => t.total)]);
    }
    return {
      naam: `Attendance_Register_${data.start}_to_${data.end}`, sheet: "Register",
      headers: ["Name", "Emp Code", "Designation", ...heads, ...slots.map((x) => x.label), "On duty", "Status"],
      rows,
    };
  };
  const chExcel = () => ({
    naam: `Attendance_Changes_${data?.start}_to_${data?.end}`, sheet: "Changes",
    headers: ["Date", "Time", "Name", "Emp Code", "Change", "From", "To", "Details", "By", "Source"],
    rows: changes.map((c) => [
      shortDay(c.day), c.at ? timeOf(c.at) : "", c.name, c.emp_code, ACTION[c.action] || c.action,
      label(c.from), label(c.to), c.detail || "", c.by || "",
      c.source === "log" ? "Change log" : "Daily board record",
    ]),
  });

  const accent = theme?.accent || "#2563eb";
  const soft = theme?.soft || "#eff6ff";
  const onlyBoard = data && (!data.log_since || data.start < data.log_since.slice(0, 10));

  return (
    <>
      <style>{`
        .ah-back { position:fixed; top:0; right:0; bottom:0; left:0; background:rgba(15,23,42,.42); z-index:10032; }
        .ah-wrap { position:fixed; top:16px; right:16px; bottom:16px; left:16px; z-index:10033; background:#f1f5f9;
                   border-radius:18px; display:flex; flex-direction:column; overflow:hidden;
                   box-shadow:0 30px 60px rgba(15,23,42,.30); font-family:'Barlow',sans-serif; }
        .ah-head { padding:16px 20px; color:#fff; display:flex; align-items:center; gap:12px;
                   background:linear-gradient(135deg,#0f172a,#1e3a8a); flex-shrink:0; }
        .ah-title { font-family:'Barlow Condensed',sans-serif; font-size:24px; font-weight:800; line-height:1.05; }
        .ah-sub { font-size:12px; font-weight:600; opacity:.85; margin-top:2px; }
        .ah-x { margin-left:auto; width:38px; height:38px; min-height:0 !important; border-radius:10px;
                border:1.5px solid rgba(255,255,255,.4); background:rgba(255,255,255,.12); color:#fff; font-size:22px;
                cursor:pointer; padding:0; display:flex; align-items:center; justify-content:center; flex-shrink:0;
                font-family:inherit; }
        .ah-x:hover { background:rgba(255,255,255,.25); }

        .ah-tools { display:flex; align-items:flex-end; gap:12px; flex-wrap:wrap; padding:12px 16px;
                    background:#fff; border-bottom:1px solid #e2e8f0; flex-shrink:0; }
        .ah-fld { display:flex; flex-direction:column; gap:4px; }
        .ah-fld > span { font-size:10.5px; font-weight:800; color:#475569; text-transform:uppercase; letter-spacing:.05em; }
        .ah-fld input { height:38px; border:1px solid #cbd5e1; border-radius:10px; padding:0 10px; font-family:inherit;
                        font-size:14px; font-weight:700; color:#0f172a; background:#fff; min-width:0; box-sizing:border-box; }
        .ah-fld input:focus, .ah-q input:focus { outline:none; border-color:${accent}; box-shadow:0 0 0 3px ${soft}; }
        ${native ? ".ah-fld input[type=date] { -webkit-appearance:none; appearance:none; }" : ""}
        .ah-quick { display:flex; gap:6px; flex-wrap:wrap; }
        .ah-quick button { height:38px; min-height:0 !important; padding:0 12px; border-radius:10px; border:1px solid #e2e8f0;
                           background:#f8fafc; color:#334155; font-weight:800; font-size:12.5px; cursor:pointer;
                           font-family:inherit; white-space:nowrap; }
        .ah-quick button:hover { border-color:${accent}; color:${accent}; }
        .ah-quick button.on { background:${soft}; border-color:${accent}; color:${accent}; }
        .ah-q { flex:1 1 220px; min-width:180px; position:relative; }
        .ah-q input { width:100%; height:38px; box-sizing:border-box; border:1px solid #cbd5e1; border-radius:10px;
                      padding:0 32px 0 12px; font-family:inherit; font-size:14px; background:#f8fafc; }
        .ah-q button { position:absolute; right:6px; top:50%; transform:translateY(-50%); width:24px; height:24px;
                       min-height:0 !important; border:none; border-radius:50%; background:#e2e8f0; color:#475569;
                       font-size:16px; line-height:1; cursor:pointer; padding:0; font-family:inherit; }

        .ah-tabs { display:flex; align-items:center; gap:8px; padding:10px 16px 0; flex-shrink:0; flex-wrap:wrap; }
        .ah-tab { height:36px; min-height:0 !important; padding:0 16px; border-radius:10px 10px 0 0; border:1px solid #e2e8f0;
                  border-bottom:none; background:#e2e8f0; color:#475569; font-weight:800; font-size:13.5px; cursor:pointer;
                  font-family:inherit; display:flex; align-items:center; gap:7px; }
        .ah-tab.on { background:#fff; color:#0f172a; box-shadow:0 -2px 0 ${accent} inset; }
        .ah-tab .n { background:#cbd5e1; color:#0f172a; border-radius:99px; padding:1px 8px; font-size:11px; }
        .ah-tab.on .n { background:${soft}; color:${accent}; }
        .ah-grow { flex:1; }
        .ah-tabs .ah-excel { margin-bottom:6px; }

        .ah-body { flex:1; min-height:0; display:flex; flex-direction:column; padding:0 16px 16px; }
        .ah-panel { flex:1; min-height:0; display:flex; flex-direction:column; background:#fff; border:1px solid #e2e8f0;
                    border-radius:0 14px 14px 14px; overflow:hidden; }
        .ah-note { padding:9px 14px; font-size:12.5px; font-weight:600; color:#475569; background:#f8fafc;
                   border-bottom:1px solid #eef2f7; display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
        .ah-note.err { background:#fef2f2; color:#b91c1c; }
        .ah-note button { margin-left:auto; border:1px solid currentColor; background:#fff; color:inherit; border-radius:8px;
                          padding:3px 12px; font-weight:800; cursor:pointer; font-family:inherit; }
        .ah-empty { padding:40px 14px; text-align:center; color:#94a3b8; font-weight:700; font-size:13.5px; }
        .ah-dim { opacity:.55; }

        /* ── Register ── */
        .ah-legend { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
        .ah-legend .ah-b { cursor:default; }
        .ah-sums { display:flex; gap:10px; flex-wrap:wrap; margin-left:auto; font-size:12px; font-weight:700; color:#475569; }
        .ah-sums b { color:#0f172a; }
        .ah-gridwrap { flex:1; min-height:0; overflow:auto; -webkit-overflow-scrolling:touch; }
        /* responsive.css (<=900px) har table ko display:block + apna scroll deta
           hai -- tab scroll table ke andar hota aur upar ki tareekh wali line /
           baayein naam chipakte nahi.  Yahan scroll sirf .ah-gridwrap kare. */
        .ah-grid { display:table; max-width:none; overflow:visible; }
        .ah-grid { border-collapse:separate; border-spacing:0; font-size:12px; }
        .ah-grid th, .ah-grid td { border-bottom:1px solid #eef2f7; border-right:1px solid #f1f5f9; padding:0;
                                   text-align:center; white-space:nowrap; }
        .ah-grid thead th { position:sticky; top:0; z-index:2; background:#f8fafc; }
        .ah-grid .ah-nm { position:sticky; left:0; z-index:1; background:#fff; text-align:left; padding:6px 12px;
                          min-width:170px; max-width:230px; border-right:2px solid #e2e8f0; }
        .ah-grid thead .ah-nm { z-index:3; background:#f8fafc; font-size:11px; font-weight:800; color:#475569;
                                text-transform:uppercase; letter-spacing:.04em; vertical-align:bottom; }
        .ah-nm .n { font-weight:800; color:#0f172a; font-size:13px; overflow:hidden; text-overflow:ellipsis; }
        .ah-nm .s { color:#64748b; font-weight:600; font-size:11px; overflow:hidden; text-overflow:ellipsis; margin-top:1px; }
        .ah-nm .s code { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-weight:700; color:#1e3a8a;
                         background:#eff6ff; border-radius:5px; padding:0 5px; margin-right:5px; }
        .ah-nm .r { display:inline-block; margin-top:3px; font-size:10.5px; font-weight:800; color:#991b1b;
                    background:#fef2f2; border-radius:99px; padding:1px 8px; }
        .ah-nm.link { cursor:pointer; }
        .ah-nm.link:hover .n { color:${accent}; text-decoration:underline; }
        .ah-day { min-width:34px; padding:5px 2px !important; cursor:pointer; line-height:1.15; }
        .ah-day:hover { background:${soft} !important; }
        .ah-day .m { display:block; font-size:9.5px; font-weight:800; color:${accent}; text-transform:uppercase; min-height:11px; }
        .ah-day .d { display:block; font-size:13px; font-weight:800; color:#0f172a; }
        .ah-day .w { display:block; font-size:9.5px; font-weight:700; color:#94a3b8; }
        .ah-day.sun .w { color:#dc2626; }
        .ah-day.today { background:${accent} !important; }
        .ah-day.today .m, .ah-day.today .d, .ah-day.today .w { color:#fff; }
        .ah-day.fut .d { color:#94a3b8; }
        .ah-c { height:34px; min-width:34px; }
        .ah-c.today { background:${soft}; }
        .ah-c.fut .ah-b { opacity:.4; }
        .ah-b { display:inline-flex; align-items:center; justify-content:center; min-width:22px; height:22px; padding:0 4px;
                box-sizing:border-box; border-radius:6px; font-weight:800; font-size:10.5px; color:#fff;
                background:var(--c); letter-spacing:.02em; }
        .ah-none { color:#cbd5e1; font-weight:800; }
        .ah-tot { min-width:36px; font-weight:800; color:#0f172a; background:#fcfcfd; }
        .ah-tot.duty { background:#ecfdf5; color:#065f46; }
        thead .ah-tot { padding:6px 3px !important; }
        .ah-grid tfoot td { background:#f8fafc; font-weight:800; color:#334155; height:30px; }
        .ah-grid tfoot .ah-nm { background:#f8fafc; font-size:11.5px; color:#475569; }
        .ah-grid tfoot tr:first-child td { border-top:2px solid #e2e8f0; }

        /* ── Changes ── */
        .ah-list { flex:1; min-height:0; overflow-y:auto; -webkit-overflow-scrolling:touch; padding:4px 0 14px; }
        .ah-dh { position:sticky; top:0; z-index:1; background:#f8fafc; padding:8px 14px; font-size:12.5px; font-weight:800;
                 color:#0f172a; border-bottom:1px solid #eef2f7; display:flex; gap:8px; align-items:center; }
        .ah-dh span { color:#94a3b8; font-weight:700; }
        .ah-ch { display:grid; grid-template-columns:78px minmax(150px, 1.1fr) minmax(200px, 2fr) minmax(90px, .8fr);
                 gap:10px; align-items:center; padding:9px 14px; border-bottom:1px solid #f1f5f9; font-size:13px; }
        .ah-ch .t { color:#64748b; font-weight:700; font-size:12px; }
        .ah-ch .p b { color:#0f172a; }
        .ah-ch .p code { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:11px; font-weight:700;
                         color:#1e3a8a; background:#eff6ff; border-radius:5px; padding:0 5px; margin-left:6px; }
        .ah-ch .w { color:#334155; font-weight:600; display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
        .ah-ch .by { color:#64748b; font-size:12px; font-weight:600; text-align:right; }
        .ah-chip { display:inline-block; padding:2px 9px; border-radius:99px; font-size:11.5px; font-weight:800;
                   color:var(--c); background:var(--soft); white-space:nowrap; }
        .ah-arrow { color:#94a3b8; font-weight:800; }

        @media (max-width: 760px) {
          .ah-wrap { top:0; right:0; bottom:0; left:0; border-radius:0; }
          .ah-head { padding:12px 14px; }
          .ah-title { font-size:21px; }
          .ah-tools { padding:10px 12px; gap:9px; }
          .ah-fld { flex:1 1 0; min-width:0; }
          .ah-fld input { width:100%; }
          .ah-quick { flex:1 1 100%; flex-wrap:nowrap; overflow-x:auto; -webkit-overflow-scrolling:touch; }
          .ah-q { flex:1 1 100%; }
          .ah-tabs { padding:8px 12px 0; }
          .ah-body { padding:0 12px 12px; }
          .ah-grid .ah-nm { min-width:118px; max-width:140px; padding:5px 8px; }
          .ah-nm .s { display:none; }
          .ah-sums { margin-left:0; }
          .ah-ch { grid-template-columns:62px 1fr; gap:4px 10px; }
          .ah-ch .w { grid-column:2; }
          .ah-ch .by { grid-column:2; text-align:left; }
        }
      `}</style>

      <div className="ah-back" onClick={onClose} />
      <div className="ah-wrap" role="dialog" aria-modal="true" aria-label="Attendance history">
        <div className="ah-head">
          <div style={{ minWidth: 0 }}>
            <div className="ah-title">Attendance History</div>
            <div className="ah-sub">
              {data ? `${shortDay(data.start)} – ${shortDay(data.end)} · ${data.people.length} ${data.people.length === 1 ? "person" : "people"}`
                : bad ? "Choose a valid date range" : "Loading…"}
            </div>
          </div>
          <button className="ah-x" data-back-close="" onClick={onClose} aria-label="Close" title="Close">×</button>
        </div>

        <div className="ah-tools">
          <label className="ah-fld">
            <span>From</span>
            <input type="date" value={start} max={end || undefined} onChange={(e) => e.target.value && setStart(e.target.value)} />
          </label>
          <label className="ah-fld">
            <span>To</span>
            <input type="date" value={end} min={start || undefined} onChange={(e) => e.target.value && setEnd(e.target.value)} />
          </label>
          <div className="ah-quick">
            {quick.map(([l, a, b]) => (
              <button key={l} type="button" className={start === a && end === b ? "on" : ""} onClick={() => setRange(a, b)}>{l}</button>
            ))}
          </div>
          <div className="ah-q">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, emp code…"
                   aria-label="Search name or emp code" autoComplete="off" />
            {q && <button type="button" onClick={() => setQ("")} aria-label="Clear search">×</button>}
          </div>
        </div>

        <div className="ah-tabs">
          <button type="button" className={`ah-tab${tab === "register" ? " on" : ""}`} onClick={() => setTab("register")}>
            Register <span className="n">{people.length}</span>
          </button>
          <button type="button" className={`ah-tab${tab === "changes" ? " on" : ""}`} onClick={() => setTab("changes")}>
            Changes <span className="n">{changes.length}</span>
          </button>
          <span className="ah-grow" />
          {data && (
            <span className="ah-excel">
              <ExcelBtn key={tab} banao={tab === "register" ? regExcel : chExcel}
                        title={tab === "register" ? "Download the register as Excel" : "Download the changes as Excel"} />
            </span>
          )}
        </div>

        <div className="ah-body">
          <div className="ah-panel">
            {bad && <div className="ah-note err">{bad}</div>}
            {!bad && err && <div className="ah-note err">⚠ {err}<button onClick={() => setRev((r) => r + 1)}>Retry</button></div>}
            {!data && !err && !bad && <div className="ah-empty">Loading…</div>}

            {data && tab === "register" && (
              <>
                <div className="ah-note">
                  <span className="ah-legend">
                    {slots.map((s) => (
                      <span key={s.key} className="ah-b" style={{ "--c": s.c }} title={s.label}>{s.badge}</span>
                    ))}
                    <span>= {slots.map((s) => s.label).join(" · ")}</span>
                  </span>
                  <span className="ah-sums">
                    <span>On duty <b>{sums.duty}</b></span>
                    <span>Leave <b>{sums.LEAVE || 0}</b></span>
                    <span>Week off <b>{sums.WO || 0}</b></span>
                    <span>WFH <b>{sums.WFH || 0}</b></span>
                    <span style={{ color: "#94a3b8" }}>(person-days up to today)</span>
                  </span>
                </div>
                {people.length === 0 ? (
                  <div className="ah-empty">
                    {ql ? `No one matches “${q.trim()}”.` : "No one was on the board in these dates."}
                  </div>
                ) : (
                  <div ref={gridRef} className={`ah-gridwrap${busy ? " ah-dim" : ""}`}>
                    <table className="ah-grid">
                      <thead>
                        <tr>
                          <th className="ah-nm">Name</th>
                          {data.days.map((d, i) => {
                            const dt = dateOf(d);
                            const cls = ["ah-day", d === data.today ? "today" : "", d > data.today ? "fut" : "",
                              dt.getDay() === 0 ? "sun" : ""].filter(Boolean).join(" ");
                            const focus = d === (data.today >= data.start && data.today <= data.end ? data.today : data.end);
                            return (
                              <th key={d} className={cls} onClick={() => onOpenDay(d)}
                                  data-ah-focus={focus ? "" : undefined}
                                  title={`${longDay(d)}${d > data.today ? " (planned)" : ""} — open the board for this day`}>
                                <span className="m">{i === 0 || dt.getDate() === 1 ? fmt(d, { month: "short" }) : ""}</span>
                                <span className="d">{dt.getDate()}</span>
                                <span className="w">{fmt(d, { weekday: "short" }).slice(0, 2)}</span>
                              </th>
                            );
                          })}
                          {slots.map((s) => (
                            <th key={s.key} className="ah-tot" title={`${s.label} — days up to today`}>
                              <span className="ah-b" style={{ "--c": s.c }}>{s.badge}</span>
                            </th>
                          ))}
                          <th className="ah-tot duty" title="On duty (G + A + B) — days up to today">Duty</th>
                        </tr>
                      </thead>
                      <tbody>
                        {people.map((p) => (
                          <tr key={p.key}>
                            <td className="ah-nm link" title="Show this person's changes"
                                onClick={() => { setQ(p.emp_code || p.name); setTab("changes"); }}>
                              <div className="n">{p.name}</div>
                              <div className="s">{p.emp_code && <code>{p.emp_code}</code>}{p.designation}</div>
                              {p.removed_on && <div className="r">Removed {shortDay(p.removed_on)}</div>}
                            </td>
                            {p.slots.map((s, i) => {
                              const d = data.days[i];
                              return (
                                <td key={d} className={`ah-c${d === data.today ? " today" : ""}${d > data.today ? " fut" : ""}`}
                                    title={s ? `${p.name} — ${label(s)} — ${shortDay(d)}${d > data.today ? " (planned)" : ""}` : `${p.name} — not on the board — ${shortDay(d)}`}>
                                  {s ? <span className="ah-b" style={{ "--c": SLOT[s]?.c || "#64748b" }}>{badge(s)}</span>
                                    : <span className="ah-none">·</span>}
                                </td>
                              );
                            })}
                            {slots.map((s) => <td key={s.key} className="ah-tot">{p.totals[s.key] || 0}</td>)}
                            <td className="ah-tot duty">{p.totals.duty || 0}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        {[["On duty (G+A+B)", "duty"], ["Leave", "LEAVE"], ["Week off", "WO"], ["On the board", "total"]].map(([l, k]) => (
                          <tr key={k}>
                            <td className="ah-nm">{l}</td>
                            {data.day_totals.map((t, i) => (
                              <td key={data.days[i]} className={data.days[i] > data.today ? "ah-dim" : ""}>{t[k] || 0}</td>
                            ))}
                            <td colSpan={slots.length + 1} />
                          </tr>
                        ))}
                      </tfoot>
                    </table>
                  </div>
                )}
              </>
            )}

            {data && tab === "changes" && (
              <>
                <div className="ah-note">
                  {onlyBoard
                    ? (data.log_since
                      ? `Every change is logged (who and when) from ${shortDay(data.log_since.slice(0, 10))} ${timeOf(data.log_since)}. Before that, changes come from the daily board records (the final shift of each day).`
                      : "These changes come from the daily board records (the final shift of each day). From now on, every change is also logged with who made it and when.")
                    : "Every change is logged — who made it and when."}
                </div>
                {changes.length === 0 ? (
                  <div className="ah-empty">{ql ? `No change matches “${q.trim()}”.` : "No changes in these dates."}</div>
                ) : (
                  <div className={`ah-list${busy ? " ah-dim" : ""}`}>
                    {byDay.map((g) => (
                      <div key={g.day}>
                        <div className="ah-dh">{longDay(g.day)} <span>· {g.items.length} change{g.items.length === 1 ? "" : "s"}</span></div>
                        {g.items.map((c, i) => (
                          <div key={`${g.day}-${i}`} className="ah-ch">
                            <div className="t">{c.at ? timeOf(c.at) : "—"}</div>
                            <div className="p"><b>{c.name || "—"}</b>{c.emp_code && <code>{c.emp_code}</code>}</div>
                            <div className="w">{whatOf(c)}</div>
                            <div className="by">{c.by ? `by ${c.by}` : ""}</div>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
