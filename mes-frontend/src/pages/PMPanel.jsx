/* ───────────────────────────────────────────────────────────────────
 * PMPanel.jsx — Preventive Maintenance (schedule + dashboard)
 * ───────────────────────────────────────────────────────────────────
 * 2026-07-02 — the CHECK SHEET option was removed entirely (its backend
 * logic and tables were deleted; a new check-sheet module will be added
 * later).  Two surfaces remain:
 *   • Schedule  : plan PMs (machine from the Machine Master List),
 *                 calendar, KPIs, reminder mail config
 *   • Dashboard : schedule-driven due this month / next month
 *
 * DB-backed via /api/pm/* (pm_schedule + pm_mail_config).
 * ─────────────────────────────────────────────────────────────────── */
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useAuth } from "../context/AuthContext";
import { FormatSheet } from "./pm/FormatSheet";
import YearlyPmTab from "./pm/YearlyPmTab";
import { SignPad } from "./pm/SignPad";

const monthISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; };
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

// PM tab (view) → permission key.  Har tab ki apni key; parent `maintenance-pm`
// se inherit hoti hai (AuthContext.SUBPAGE_PARENT).
const PM_TAB_KEY = {
  schedule:  "maintenance-pm-schedule",
  fillpend:  "maintenance-pm-fill",
  engverify: "maintenance-pm-engverify",
  incverify: "maintenance-pm-incverify",
  format:    "maintenance-pm-format",
  yearlypm:  "maintenance-pm-yearly",
};
const PM_TAB_ORDER = ["schedule", "fillpend", "engverify", "incverify", "format", "yearlypm"];

export default function PMPanel() {
  const { token, canAccess, user } = useAuth();

  const api = useCallback(async (path, opts = {}) => {
    const r = await fetch(`/api/pm${path}`, {
      ...opts,
      headers: { "Content-Type": "application/json",
                 ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) },
    });
    if (!r.ok) throw new Error((await r.text().catch(()=> "")) || `HTTP ${r.status}`);
    return r.json();
  }, [token]);

  // 'schedule' | 'fillpend' | 'engverify' | 'incverify' | 'format' | 'yearlypm'
  const [view,   setView]   = useState("schedule");
  // Agar current tab ka access nahi, to pehle accessible tab par switch (no-loop guard).
  useEffect(() => {
    if (canAccess(PM_TAB_KEY[view])) return;
    const firstOk = PM_TAB_ORDER.find((t) => canAccess(PM_TAB_KEY[t]));
    if (firstOk && firstOk !== view) setView(firstOk);
  }, [view, user]);   // eslint-disable-line react-hooks/exhaustive-deps
  const [month,  setMonth]  = useState(monthISO());
  const [busy,   setBusy]   = useState(false);
  const [msg,    setMsg]    = useState("");
  // ── check-sheet format (maintenance_pm_check_sheet_format) ──
  const [fmt, setFmt]       = useState(null);
  const [csMaster, setCsMaster] = useState([]);         // machines that HAVE points
  const [csZone, setCsZone] = useState("");
  const [csLine, setCsLine] = useState("");
  const [csMachine, setCsMachine] = useState("");       // machine_no
  const [csPoints, setCsPoints] = useState([]);         // that machine's check points
  const [csRev, setCsRev]   = useState({});             // {rev_no, rev_date}
  // ── filling the sheet (observation/action/spares/status/sign per point) ──
  const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
  const [csFill, setCsFill] = useState({});              // {pointIndex: {observation,…}}
  const [csDate, setCsDate] = useState(todayISO());      // PM date of this fill
  const [csSign, setCsSign] = useState({ prepared:"", checked:"", approved:"" });
  const [csSignImgs, setCsSignImgs] = useState([null, null, null]);   // drawn signatures
  const [csSaving, setCsSaving] = useState(false);
  const [signPad, setSignPad] = useState(null);          // { title, apply(dataURL) } | null
  const SIGN_ROLES = ["Prepared By (Team Member - Maintenance)",
                      "Checked By (Engineer - Maintenance)",
                      "Approved By (In-Charge Maintenance)"];
  const onCsSign = (i, clear) => {
    if (clear) { setCsSignImgs(a => { const n=[...a]; n[i]=null; return n; }); return; }
    setSignPad({ title: SIGN_ROLES[i], apply: (url) => setCsSignImgs(a => { const n=[...a]; n[i]=url; return n; }) });
  };
  const onCalSign = (i, clear) => {
    const put = (val) => setCalSheet(s => s ? { ...s, signImgs: (s.signImgs || [null,null,null]).map((v,j) => j===i ? val : v) } : s);
    if (clear) { put(null); return; }
    setSignPad({ title: SIGN_ROLES[i], apply: (url) => put(url) });
  };
  // the signer's CODE, typed in the sign-off cell itself (next to the ✍ Sign
  // button) — stage 1 only ever owns cell 0 (Prepared By).
  const SIGN_KEYS = ["prepared", "checked", "approved"];
  const onCalSignVal = (i, v) =>
    setCalSheet(s => s ? { ...s, sign: { ...s.sign, [SIGN_KEYS[i]]: v } } : s);

  // ── yearly PM schedule format (maintenance_yearly_pm_shedule) ──
  const [ypm, setYpm]       = useState(null);
  const [ypmFy, setYpmFy]   = useState("");         // selected financial year for the sheet
  const [ypmYears, setYpmYears] = useState([]);     // FY options (current + next)
  // yearly-plan overlay on the Schedule calendar: which machines have a
  // PM PLAN mark in each week of the shown month (+ the hover tooltip)
  const [ypmMonth, setYpmMonth] = useState(null);   // {weeks:{1..4:[…]}, total, done}
  const [ypmNext, setYpmNext]   = useState(null);   // next month's plan (grid tail cells)
  const [wkTip, setWkTip] = useState(null);         // {week, items, x, y, mLabel}
  const [selWeek, setSelWeek] = useState(null);     // clicked week -> machine list panel {mLabel, week}
  const [showPend, setShowPend] = useState(false);  // "Check Sheet Pending" list (all weeks) toggle
  const [pendData, setPendData] = useState(null);   // FY-wide pending sheets {total, by_month, items}
  const [pendRefresh, setPendRefresh] = useState(0);// bump to refetch after a fill
  const [pendMonth, setPendMonth]   = useState("");  // month-chip filter ("" = all months)
  const [retData, setRetData] = useState(null);      // sheets sent back for correction
  const [calSheet, setCalSheet] = useState(null);   // DONE-flow check sheet {code, mLabel, week, cp, points, rev, fill, sign, date}
  const [calSaving, setCalSaving] = useState(false);

  // ── per-point SPARES (opened from a "SPARES USED = Yes" check-point cell) ──
  // Each point can carry a `spares` array [{spare_name, spare_model_no,
  // spare_cnmm_no, spare_qty}] — exactly like the Break Down Slip.  On save they
  // go into maintenance_spare (source 'PM') keyed by machine_no.
  const EMPTY_SP = { spare_name: "", spare_model_no: "", spare_cnmm_no: "", spare_qty: "" };
  const [spareEdit, setSpareEdit] = useState(null);      // { i } point index (in calSheet) | null
  const [spareMaster, setSpareMaster] = useState([]);    // maintenance_spare distinct names (datalist)
  useEffect(() => {
    if (!token) return;
    fetch("/api/maintenance-spare/", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : [])).then((d) => setSpareMaster(Array.isArray(d) ? d : []))
      .catch(() => setSpareMaster([]));
  }, [token]);
  const pointSpares = (i) => {
    const arr = calSheet?.fill?.[i]?.spares;
    return (Array.isArray(arr) && arr.length) ? arr : [{ ...EMPTY_SP }];
  };
  const setPointSpares = (i, arr) => setCalSheet((s) => s
    ? ({ ...s, fill: { ...s.fill, [i]: { ...(s.fill[i] || {}), spares: arr } } }) : s);
  const onSpareCell = (i, ri, key, val) => {
    const arr = pointSpares(i).map((r, j) => (j === ri ? { ...r, [key]: val } : r));
    if (key === "spare_name") {                       // known name → auto-fill model / cnmm
      const m = spareMaster.find((x) => (x.spare_name || "").toLowerCase() === val.toLowerCase());
      if (m) arr[ri] = { ...arr[ri], spare_model_no: m.spare_model_no || arr[ri].spare_model_no,
                         spare_cnmm_no: m.spare_cnmm_no || arr[ri].spare_cnmm_no };
    }
    setPointSpares(i, arr);
  };
  const addSpareRow = (i) => setPointSpares(i, [...pointSpares(i), { ...EMPTY_SP }]);
  const delSpareRow = (i, ri) => {
    const arr = pointSpares(i).filter((_, j) => j !== ri);
    setPointSpares(i, arr.length ? arr : [{ ...EMPTY_SP }]);
  };

  // ── CELL SELECTION over the fill columns (Excel-style) ─────────────
  // Observation / Action Taken / Spares Used / Status / Sign ko drag ya
  // shift+click se select karo, phir Copy → Paste ya Fill Down.  Har cell me
  // alag se type karna pehle ki tarah chalta rahega.
  // NOTE: this block must stay BELOW the `calSheet` useState above — it reads
  // calSheet during render, and reading a `const` before its declaration
  // throws (temporal dead zone), which blanks the whole PM page.
  const FILL_KEYS = ["observation", "action_taken", "spares_used", "status", "sign"];
  const FILL_LBL  = ["Observation", "Action Taken", "Spares Used", "Status", "Sign"];
  const [cs, setCs]     = useState(null);      // {ar, ac, r, c} anchor + current
  const [clip, setClip] = useState(null);      // copied rectangle (2-D array)
  const dragRef = useRef(false);
  const box = cs && { r1: Math.min(cs.ar, cs.r), r2: Math.max(cs.ar, cs.r),
                      c1: Math.min(cs.ac, cs.c), c2: Math.max(cs.ac, cs.c) };
  const nCells = box ? (box.r2 - box.r1 + 1) * (box.c2 - box.c1 + 1) : 0;
  const onCellDown  = (r, c, shift) => { dragRef.current = true;
    setCs(p => (shift && p) ? { ...p, r, c } : { ar: r, ac: c, r, c }); };
  const onCellEnter = (r, c) => { if (dragRef.current) setCs(p => p ? { ...p, r, c } : p); };
  useEffect(() => {                            // drag ends wherever the mouse goes up
    const up = () => { dragRef.current = false; };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);

  const valAt = (s, r, c) => {
    const p = { ...(s.points[r] || {}), ...(s.fill[r] || {}) };
    return p[FILL_KEYS[c]] || "";
  };
  const copyCells = () => {
    if (!box || !calSheet) return;
    const out = [];
    for (let r = box.r1; r <= box.r2; r++) {
      const row = [];
      for (let c = box.c1; c <= box.c2; c++) row.push(valAt(calSheet, r, c));
      out.push(row);
    }
    setClip({ cells: out, c1: box.c1 });
  };
  const pasteCells = () => setCalSheet(s => {
    if (!s || !clip || !box) return s;
    const single = box.r1 === box.r2 && box.c1 === box.c2;
    // one cell selected → drop the whole copied block starting there;
    // a range selected → tile the block over the range
    const rEnd = Math.min(single ? box.r1 + clip.cells.length - 1 : box.r2, s.points.length - 1);
    const cEnd = Math.min(single ? box.c1 + clip.cells[0].length - 1 : box.c2, FILL_KEYS.length - 1);
    const fill = { ...s.fill };
    for (let r = box.r1; r <= rEnd; r++)
      for (let c = box.c1; c <= cEnd; c++) {
        const v = clip.cells[(r - box.r1) % clip.cells.length][(c - box.c1) % clip.cells[0].length];
        fill[r] = { ...(fill[r] || {}), [FILL_KEYS[c]]: v };
      }
    return { ...s, fill };
  });
  const fillDown = () => setCalSheet(s => {
    if (!s || !box || box.r1 === box.r2) return s;
    const fill = { ...s.fill };
    for (let c = box.c1; c <= box.c2; c++) {
      const src = valAt(s, box.r1, c);
      for (let r = box.r1 + 1; r <= box.r2; r++) fill[r] = { ...(fill[r] || {}), [FILL_KEYS[c]]: src };
    }
    return { ...s, fill };
  });
  // Ctrl+C / Ctrl+V / Ctrl+D on the selection.  If the caret is inside a box
  // WITH text highlighted, the browser's own copy/paste wins — we never steal
  // a plain text copy out from under the user.
  useEffect(() => {
    if (!calSheet) return;
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || !box) return;
      const ae = document.activeElement;
      if (ae && /^(INPUT|TEXTAREA)$/.test(ae.tagName) &&
          ae.selectionStart != null && ae.selectionStart !== ae.selectionEnd) return;
      const k = e.key.toLowerCase();
      if (k === "c") { e.preventDefault(); copyCells(); }
      else if (k === "v" && clip) { e.preventDefault(); pasteCells(); }
      else if (k === "d") { e.preventDefault(); fillDown(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [calSheet, cs, clip]);   // eslint-disable-line react-hooks/exhaustive-deps
  // ── verification chain (stage 2 = Engineer, stage 3 = In-Charge) ──
  const [verList,  setVerList]  = useState(null);   // {role, rows, total} pending at this stage
  const [verSheet, setVerSheet] = useState(null);   // opened sheet + {vName, vSign}
  const [verSaving, setVerSaving] = useState(false);
  const verStage = view === "engverify" ? "engineer" : view === "incverify" ? "incharge" : null;
  const verSlot  = verStage === "engineer" ? 1 : 2;  // sign-off cell this stage owns
  // ── schedule / planner / mail ──
  const [schedule, setSchedule] = useState([]);
  const [mailCfg,  setMailCfg]  = useState({ recipient:"", cc:"", auto_enabled:true });
  // planner machine picker — Machine Master List cascade
  const [master,    setMaster]    = useState([]);
  const [plZone,    setPlZone]    = useState("");
  const [plLine,    setPlLine]    = useState("");
  const [plMachine, setPlMachine] = useState("");        // machine_no
  const [plDate,    setPlDate]    = useState("");
  const [plRepeat,  setPlRepeat]  = useState(false);

  // Machine Master List (same source as the Log Book / KPI pages).
  useEffect(() => {
    if (!token) return;
    fetch("/api/machines/", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : [])
      .then(m => setMaster(Array.isArray(m) ? m : []))
      .catch(() => setMaster([]));
  }, [token]);

  const shiftMonth = (m0, d) => {
    const [a, b] = m0.split("-").map(Number);
    const t = a * 12 + (b - 1) + d;
    return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
  };
  // yearly-plan overlay for the shown month + the next (grid tail cells)
  const reloadPlan = useCallback(() => {
    api(`/yearly-plan-month?month=${month}`).then(setYpmMonth).catch(() => setYpmMonth(null));
    api(`/yearly-plan-month?month=${shiftMonth(month, 1)}`).then(setYpmNext).catch(() => setYpmNext(null));
  }, [month, api]);

  // schedule + mail config
  useEffect(() => {
    if (view === "schedule") {
      api(`/schedule?month=${month}`).then(d => setSchedule(d.schedule || [])).catch(()=>{});
      api(`/mail-config`).then(setMailCfg).catch(()=>{});
      reloadPlan();
      setWkTip(null); setSelWeek(null); setCalSheet(null);
    } else if (view === "fillpend") {
      setCalSheet(null);
    }
  }, [view, month, api, reloadPlan]);

  // FY-wide pending check sheets (all months) for the "Fill Check Sheets" tab
  useEffect(() => {
    if (view !== "fillpend") return;
    api(`/pending-sheets`).then(setPendData).catch(() => setPendData({ total:0, by_month:[], items:[] }));
  }, [view, pendRefresh, api]);

  // sheets an Engineer / In-Charge sent back for correction — they sit on top
  // of the Fill tab with the reason, data intact and editable
  useEffect(() => {
    if (view !== "fillpend") { return; }
    api(`/check-sheet-returned`).then(setRetData).catch(() => setRetData({ rows: [], total: 0 }));
  }, [view, pendRefresh, api]);

  // open a sent-back sheet for EDITING — points come from the saved snapshot
  // (entries), so the machine's later point revisions cannot alter an old sheet
  const openReturned = async (id) => {
    setMsg("");
    try {
      const r = await api(`/check-sheet-fill/${id}`);
      setCalSheet({
        fillId: r.id,                                   // → PUT (same row) instead of POST
        code: r.machine_no, mLabel: String(r.pm_date || "").slice(0, 7), week: 0,
        cp: { zone: r.zone_name, line: r.line_name, machine_no: r.machine_no, machine_name: r.machine_name },
        points: r.entries || [], rev: { rev_no: r.rev_no, rev_date: r.rev_date },
        fill: {}, docFooter: r.doc_footer || null,
        rejectReason: r.reject_reason || "", rejectedFrom: r.rejected_from || "",
        rejectedBy: r.rejected_by || "",
        sign: { prepared: r.prepared_by || "", checked: "", approved: "" },
        signImgs: [(r.sign_imgs || [])[0] || null, null, null],
        date: r.pm_date,
      });
      setCs(null); setClip(null);
    } catch (e) { setMsg(String(e.message || e).slice(0, 160)); }
  };

  // ── Calendar DONE flow (decoupled per user):
  //    "✔ Done"       → marks the PM done directly (A-row 'done').
  //    "📋 Fill Sheet" → opens the machine's check sheet below to fill;
  //                      saving it clears the "Check Sheet Pending" state.
  //    A done PM whose sheet is not filled counts as Check-Sheet-Pending. ──
  const markDone = async (item, mLabel, week, action) => {
    setMsg("");
    try {
      const r = await api(`/yearly-actual-mark`, { method:"POST", body: JSON.stringify({
        machine_code: item.machine_code, month: mLabel, week, action }) });
      reloadPlan();                                   // refresh calendar overlay + week panel
      // keep the Yearly PM Schedule sheet (A-row 'done' mark) in sync immediately —
      // its FY may differ from the marked month's FY, so refetch that FY too.
      const [my, mm2] = String(mLabel).split("-").map(Number);
      const markFy = `${mm2 >= 4 ? my : my - 1}-${String((mm2 >= 4 ? my : my - 1) + 1).slice(-2)}`;
      const fyToLoad = ypmFy || markFy;
      api(`/yearly-schedule?fy=${encodeURIComponent(fyToLoad)}`).then(setYpm).catch(()=>{});
      setMsg(action === "set"
        ? `✓ ${item.machine_code} PM marked DONE — updated in Yearly PM Schedule (${markFy}, A-row)`
        : `↩ ${item.machine_code} PM done-mark cleared in Yearly PM Schedule`);
      void r;
    } catch (e) { setMsg(String(e.message || e).slice(0, 140)); }
  };
  const openSheet = async (item, mLabel, week) => {
    setMsg("");
    try {
      const r = await api(`/check-points-by-code?code=${encodeURIComponent(item.machine_code)}`);
      if (!r.found) {
        window.alert(`${item.machine_code} has no check-sheet points in the check-point master — nothing to fill.`);
        return;
      }
      const d = await api(`/check-points?zone=${encodeURIComponent(r.zone || "")}&line=${encodeURIComponent(r.line || "")}&machine_no=${encodeURIComponent(r.machine_no)}`);
      // default PM Date = the date the PM was marked DONE (auto).  Fallback:
      // today if it falls in that week+month, else the week's 1st day.
      const [wy, wm] = mLabel.split("-").map(Number);
      const t = new Date();
      const inWeek = t.getFullYear() === wy && t.getMonth() + 1 === wm
        && Math.min(4, Math.floor((t.getDate() - 1) / 7) + 1) === week;
      const defDate = (item.done_date && /^\d{4}-\d{2}-\d{2}$/.test(item.done_date))
        ? item.done_date
        : (inWeek ? todayISO()
                  : `${wy}-${String(wm).padStart(2, "0")}-${String((week - 1) * 7 + 1).padStart(2, "0")}`);
      setCalSheet({ code: item.machine_code, mLabel, week, cp: r,
                    points: d.points || [], rev: d.rev || {}, fill: {},
                    sign: { prepared:"", checked:"", approved:"" }, signImgs: [null, null, null], date: defDate });
      setCs(null); setClip(null);
    } catch (e) { setMsg(String(e.message || e).slice(0, 140)); }
  };
  const saveCalSheet = async () => {
    if (!calSheet) return;
    const merged = calSheet.points.map((p, i) => ({ ...p, ...(calSheet.fill[i] || {}) }));
    if (!(merged.length && merged.every(p => String(p.status || "").trim()))) {
      setMsg("Har check point ka STATUS (OK/NG) bharna zaroori hai"); return;
    }
    if (!calSheet.sign.prepared.trim() || !(calSheet.signImgs || [])[0]) {
      setMsg("Prepared By (Team Member - Maintenance) ka naam aur signature zaroori hai"); return;
    }
    setCalSaving(true); setMsg("");
    try {
      // a sent-back sheet is EDITED in place (PUT, same row) so a correction
      // never creates a duplicate; a fresh one is a new record (POST)
      await api(calSheet.fillId ? `/check-sheet-fill/${calSheet.fillId}` : `/check-sheet-fill`,
                { method: calSheet.fillId ? "PUT" : "POST", body: JSON.stringify({
        zone_name: calSheet.cp.zone || "", line_name: calSheet.cp.line || "",
        machine_no: calSheet.cp.machine_no, machine_name: calSheet.cp.machine_name || "",
        pm_date: calSheet.date, rev_no: String(calSheet.rev.rev_no ?? ""), rev_date: String(calSheet.rev.rev_date ?? ""),
        entries: merged.map(p => ({
          s_no: p.s_no, check_point: p.check_point,
          judgement_standard: p.judgement_standard, method: p.method,
          observation: p.observation || "", action_taken: p.action_taken || "",
          spares_used: p.spares_used || "", status: p.status || "", sign: p.sign || "",
          // structured spares only when this point's SPARES USED = Yes
          spares: (String(p.spares_used || "").toLowerCase() === "yes" && Array.isArray(p.spares))
            ? p.spares.filter(s => (s?.spare_name || "").trim()) : [],
        })),
        // stage 1 only — Engineer / In-Charge sign on their own tabs
        prepared_by: calSheet.sign.prepared, checked_by: "", approved_by: "",
        sign_imgs: [(calSheet.signImgs || [])[0] || null, null, null],
      }) });
      const wasEdit = !!calSheet.fillId;
      setCalSheet(null); reloadPlan(); setPendRefresh(k => k + 1);
      setMsg(wasEdit
        ? "✓ Correction save ho gayi — sheet dobara Engineer (Maintenance) ke verify ke liye gayi"
        : "✓ Check sheet saved — ab Engineer (Maintenance) ke verify ke liye gayi");
    } catch (e) { setMsg(String(e.message || e).slice(0, 160)); }
    finally { setCalSaving(false); }
  };

  // ── VERIFICATION CHAIN ─────────────────────────────────────────────
  //   Team Member fills → Engineer verifies+signs → In-Charge signs.
  //   Only after the In-Charge signs does the sheet reach History.
  //   Each stage is enforced on the server, so the tabs cannot be skipped.
  useEffect(() => {
    if (!verStage) { setVerList(null); setVerSheet(null); return; }
    // clear the OLD stage's queue too — otherwise, for the whole duration of
    // the fetch, the new stage's chrome renders around the previous stage's
    // rows and "Open & Verify" would 409 on a sheet that isn't at this stage.
    setVerList(null); setVerSheet(null);
    api(`/check-sheet-pending-verify?stage=${verStage}`)
      .then(setVerList).catch(() => setVerList({ rows: [], total: 0, role: "" }));
  }, [verStage, api]);

  // pending counts for BOTH stages, so a sheet stranded mid-chain is visible
  // from any tab (the Schedule tab counts a FILLED sheet as done-and-filled).
  const [verCounts, setVerCounts] = useState({ engineer: 0, incharge: 0 });
  useEffect(() => {
    if (!token) return;
    let live = true;
    Promise.all([api(`/check-sheet-pending-verify?stage=engineer`).catch(() => null),
                 api(`/check-sheet-pending-verify?stage=incharge`).catch(() => null)])
      // the Engineer badge counts new sheets PLUS the ones the In-Charge sent back
      .then(([e, i]) => { if (live) setVerCounts({
        engineer: (e?.total || 0) + (e?.returned_total || 0),
        incharge: i?.total || 0 }); });
    return () => { live = false; };
  }, [api, token, view, verList]);

  const reloadVer = useCallback(() => {
    if (!verStage) return;
    api(`/check-sheet-pending-verify?stage=${verStage}`)
      .then(setVerList).catch(() => {});
  }, [verStage, api]);

  const openVerify = async (id) => {
    setMsg("");
    try {
      const row = await api(`/check-sheet-fill/${id}`);
      setVerSheet({ ...row, vName: "", vSign: null, vReason: "", rejecting: false });
    } catch (e) { setMsg(String(e.message || e).slice(0, 160)); }
  };
  // send a sheet back for correction — reason is mandatory and the filled
  // entries are left untouched (the Team Member edits the same row)
  const submitReject = async () => {
    if (!verSheet || !verStage) return;
    if (!verSheet.vName.trim() || verSheet.vReason.trim().length < 3) return;
    setVerSaving(true); setMsg("");
    try {
      await api(`/check-sheet-reject`, { method: "POST", body: JSON.stringify({
        fill_id: verSheet.id, stage: verStage,
        name: verSheet.vName.trim(), reason: verSheet.vReason.trim() }) });
      setVerSheet(null); reloadVer();
      setMsg(`↩ ${verSheet.machine_no} wapas bhej di — ${verStage === "engineer"
        ? "Team Member (Fill Check Sheets)" : "Engineer (Maintenance)"} ke paas. Data safe hai.`);
    } catch (e) { setMsg(String(e.message || e).slice(0, 200)); }
    finally { setVerSaving(false); }
  };
  const onVerSign = (i, clear) => {
    if (i !== verSlot) return;                       // this stage owns one cell only
    if (clear) { setVerSheet(s => s ? { ...s, vSign: null } : s); return; }
    setSignPad({ title: SIGN_ROLES[i], apply: (url) => setVerSheet(s => s ? { ...s, vSign: url } : s) });
  };
  const onVerSignVal = (i, v) => {
    if (i !== verSlot) return;
    setVerSheet(s => s ? { ...s, vName: v } : s);
  };
  const submitVerify = async () => {
    if (!verSheet || !verStage) return;
    if (!verSheet.vName.trim() || !verSheet.vSign) return;
    setVerSaving(true); setMsg("");
    try {
      const r = await api(`/check-sheet-verify`, { method: "POST", body: JSON.stringify({
        fill_id: verSheet.id, stage: verStage,
        name: verSheet.vName.trim(), sign_img: verSheet.vSign }) });
      setVerSheet(null); reloadVer();
      setMsg(r.final
        ? `✓ ${verSheet.machine_no} — In-Charge ne sign kar diya. Sheet ab History me submit ho gayi.`
        : `✓ ${verSheet.machine_no} verified — ab In-Charge Maintenance ke approve ke liye gayi.`);
    } catch (e) { setMsg(String(e.message || e).slice(0, 200)); }
    finally { setVerSaving(false); }
  };

  // load the check-sheet format (from maintenance_pm_check_sheet_format) —
  // also needed by the calendar's DONE-flow sheet and the verify tabs
  useEffect(() => {
    if ((view === "checksheet" || view === "format" || calSheet || verStage) && !fmt) {
      api(`/check-sheet-format`).then(d => setFmt(d.format)).catch(()=>{});
    }
  }, [view, fmt, api, calSheet, verStage]);
  // machines that have points (maintenance_pm_check_point) — cascade source
  useEffect(() => {
    if (view === "checksheet" && csMaster.length === 0) {
      api(`/check-point-machines`).then(d => setCsMaster(Array.isArray(d) ? d : [])).catch(()=>{});
    }
  }, [view, csMaster.length, api]);
  // yearly PM schedule — FY options (current + next) + default to current FY
  useEffect(() => {
    if (view !== "yearlypm") return;
    if (ypmYears.length === 0)
      api(`/yearly-plan-years`).then(y => setYpmYears(Array.isArray(y) ? y : [])).catch(()=>{});
    if (!ypmFy) {
      const d = new Date();
      const s = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;   // Apr-anchored
      setYpmFy(`${s}-${String(s + 1).slice(-2)}`);
    }
  }, [view, ypmYears.length, ypmFy, api]);
  // load the sheet for the selected FY — refetches whenever the FY changes.
  useEffect(() => {
    if (view === "yearlypm" && ypmFy)
      api(`/yearly-schedule?fy=${encodeURIComponent(ypmFy)}`).then(setYpm).catch(()=>{});
  }, [view, ypmFy, api]);
  // load the selected machine's points (and reset any half-filled sheet)
  useEffect(() => {
    setCsFill({}); setCsSign({ prepared:"", checked:"", approved:"" }); setCsSignImgs([null, null, null]);
    if (view === "checksheet" && csMachine) {
      api(`/check-points?zone=${encodeURIComponent(csZone)}&line=${encodeURIComponent(csLine)}&machine_no=${encodeURIComponent(csMachine)}`)
        .then(d => { setCsPoints(d.points || []); setCsRev(d.rev || {}); })
        .catch(() => { setCsPoints([]); setCsRev({}); });
    } else { setCsPoints([]); setCsRev({}); }
  }, [view, csZone, csLine, csMachine, api]);

  // points merged with the in-progress fill values (what the sheet shows)
  const csMerged = useMemo(
    () => csPoints.map((p, i) => ({ ...p, ...(csFill[i] || {}) })), [csPoints, csFill]);
  const onCsEdit = (i, k, v) => setCsFill(f => ({ ...f, [i]: { ...(f[i] || {}), [k]: v } }));

  // the sheet saves ONLY when every check point is filled (STATUS chosen)
  const csFilledCount = useMemo(
    () => csMerged.filter(p => String(p.status || "").trim()).length, [csMerged]);
  const csAllFilled = csPoints.length > 0 && csFilledCount === csPoints.length;

  const saveCheckSheet = async () => {
    if (!csMachine || !csDate) { setMsg("Pick machine + PM date"); return; }
    if (!csAllFilled) {
      setMsg(`Fill ALL check points first — ${csPoints.length - csFilledCount} of ${csPoints.length} still without STATUS (OK/NG)`);
      return;
    }
    setCsSaving(true); setMsg("");
    try {
      const sel = csMachineOpts.find(m => String(m.machine_no) === String(csMachine));
      await api(`/check-sheet-fill`, { method:"POST", body: JSON.stringify({
        zone_name: csZone, line_name: csLine,
        machine_no: csMachine, machine_name: sel?.machine_name || "",
        pm_date: csDate, rev_no: String(csRev.rev_no ?? ""), rev_date: String(csRev.rev_date ?? ""),
        entries: csMerged.map(p => ({
          s_no: p.s_no, check_point: p.check_point,
          judgement_standard: p.judgement_standard, method: p.method,
          observation: p.observation || "", action_taken: p.action_taken || "",
          spares_used: p.spares_used || "", status: p.status || "", sign: p.sign || "",
        })),
        prepared_by: csSign.prepared, checked_by: csSign.checked, approved_by: csSign.approved,
        sign_imgs: csSignImgs,
      }) });
      setCsFill({}); setCsSign({ prepared:"", checked:"", approved:"" }); setCsSignImgs([null, null, null]);
      setMsg("✓ Check sheet saved — view it on the Historical Data page");
    } catch (e) { setMsg(String(e.message || e).slice(0, 140)); }
    finally { setCsSaving(false); }
  };

  // cascade options from the master list
  const zoneOpts = useMemo(() => [...new Set(master.map(m => m.zone_name).filter(Boolean))].sort(), [master]);
  const lineOpts = useMemo(() => plZone
    ? [...new Set(master.filter(m => m.zone_name === plZone).map(m => m.line_name).filter(Boolean))].sort() : [], [master, plZone]);
  const machineOpts = useMemo(() => (plZone && plLine)
    ? master.filter(m => m.zone_name === plZone && m.line_name === plLine && m.machine_no)
            .sort((a, b) => (a.serial_no || 0) - (b.serial_no || 0)) : [], [master, plZone, plLine]);
  const onPlZone = (v) => { setPlZone(v); setPlLine(""); setPlMachine(""); };
  const onPlLine = (v) => { setPlLine(v); setPlMachine(""); };

  // check-sheet machine cascade — from the CHECK-POINT data itself, so
  // every option opens a sheet that really has points.
  const csZoneOpts = useMemo(() => [...new Set(csMaster.map(m => m.zone_name).filter(Boolean))].sort(), [csMaster]);
  const csLineOpts = useMemo(() => csZone
    ? [...new Set(csMaster.filter(m => m.zone_name === csZone).map(m => m.line_name).filter(Boolean))].sort() : [], [csMaster, csZone]);
  const csMachineOpts = useMemo(() => (csZone && csLine)
    ? csMaster.filter(m => m.zone_name === csZone && m.line_name === csLine && m.machine_no)
              .sort((a, b) => String(a.machine_no).localeCompare(String(b.machine_no))) : [], [csMaster, csZone, csLine]);
  const csSel = csMachineOpts.find(m => String(m.machine_no) === String(csMachine)) || null;
  const onCsZone = (v) => { setCsZone(v); setCsLine(""); setCsMachine(""); };
  const onCsLine = (v) => { setCsLine(v); setCsMachine(""); };

  // ── schedule / planner / mail handlers ──
  const reloadSchedule = () => api(`/schedule?month=${month}`).then(d => setSchedule(d.schedule || [])).catch(()=>{});
  const addPlan = async () => {
    if (!plMachine || !plDate) { setMsg("Pick machine + date"); return; }
    const m = machineOpts.find(x => String(x.machine_no) === String(plMachine));
    setBusy(true); setMsg("");
    try {
      await api(`/schedule`, { method:"POST", body: JSON.stringify({
        zone: plZone, line: plLine,
        machine_no: m?.machine_no || plMachine, machine_name: m?.machine_name || "",
        due_date: plDate, repeat_12m: plRepeat }) });
      setPlDate(""); setPlRepeat(false); setMsg("✓ Scheduled"); reloadSchedule();
    } catch (e) { setMsg(String(e.message||e).slice(0,140)); }
    finally { setBusy(false); }
  };
  const togglePlan = async (s) => {
    await api(`/schedule/${s.id}`, { method:"PATCH",
      body: JSON.stringify({ status: (s.status||"").toLowerCase()==="done" ? "Pending" : "Done" }) });
    reloadSchedule();
  };
  const delPlan = async (id) => { await api(`/schedule/${id}`, { method:"DELETE" }); reloadSchedule(); };
  const saveMail = async () => {
    try { await api(`/mail-config`, { method:"PUT", body: JSON.stringify(mailCfg) }); setMsg("✓ Mail recipient saved"); }
    catch (e) { setMsg(String(e.message||e).slice(0,140)); }
  };
  const sendMail = async (type) => {
    setBusy(true); setMsg("");
    try { const r = await api(`/send-reminder?type=${type}`, { method:"POST" });
          setMsg(r.sent ? `✓ Reminder sent (${r.count} PM)` : `Not sent: ${r.reason||"—"}`); }
    catch (e) { setMsg(String(e.message||e).slice(0,140)); }
    finally { setBusy(false); }
  };

  // ── styles ──
  const card = { background:"#fff", border:"1px solid #e2e8f0", borderRadius:10, padding:14 };
  const bd = "1px solid #cbd5e1";
  const th = { border:bd, padding:"5px 6px", fontSize:11, fontWeight:800, background:"#f1f5f9", color:"#1e293b", textAlign:"center" };
  const miniBtn = { padding:"5px 11px", borderRadius:6, border:bd, background:"#fff", color:"#334155",
                    fontSize:11.5, fontWeight:800, cursor:"pointer", fontFamily:"inherit", whiteSpace:"nowrap" };

  // machines whose PM is DONE but the check sheet is not yet filled (all weeks)
  const pendListOf = (src) => {
    const out = [];
    Object.entries(src?.weeks || {}).forEach(([w, arr]) =>
      (arr || []).forEach(x => { if (x.done && !x.sheet_filled) out.push({ ...x, week: Number(w) }); }));
    return out;
  };

  // the DONE-flow fill form (opened via openSheet) — shared by the Schedule tab
  // and the "Fill Check Sheets" tab, so filling works from either place.
  const calSheetForm = () => {
    if (!calSheet) return null;
    const merged = calSheet.points.map((p, i) => ({ ...p, ...(calSheet.fill[i] || {}) }));
    const filledN = merged.filter(p => String(p.status || "").trim()).length;
    const pointsDone = merged.length > 0 && filledN === merged.length;
    // stage 1 also needs the Team Member's name + signature — Engineer and
    // In-Charge sign later, on their own tabs.
    const hasPrepared = !!calSheet.sign.prepared.trim() && !!(calSheet.signImgs || [])[0];
    const allFilled = pointsDone && hasPrepared;
    const gateHint = !pointsDone
      ? "Save unlocks after every check point has a STATUS (OK/NG)"
      : !calSheet.sign.prepared.trim() ? "Prepared By (Team Member) ka naam daalo"
      : "Prepared By ka signature baaki hai";
    const onEditCal = (i, k, v) => setCalSheet(s => s ? ({ ...s, fill: { ...s.fill, [i]: { ...(s.fill[i] || {}), [k]: v } } }) : s);
    return (
      <div style={{marginTop:14}}>
        <div style={{...card, marginBottom:14, display:"flex", gap:10, flexWrap:"wrap", alignItems:"center"}}>
          <b style={{fontSize:13, color:"#0f172a"}}>
            PM Check Sheet — {calSheet.cp.machine_no}
            {calSheet.fillId ? " · correction" : ` (${calSheet.mLabel} · Week ${calSheet.week})`}
          </b>
          <label style={{fontSize:11.5, fontWeight:700, color:"#475569"}}>PM Date
            <input type="date" value={calSheet.date}
                   onChange={e=>setCalSheet(s=>s?{...s, date:e.target.value}:s)}
                   style={{marginLeft:6, padding:6, borderRadius:6, border:bd, fontSize:12}} /></label>
          <span style={{fontSize:12, fontWeight:800, color: pointsDone ? "#16a34a" : "#d97706"}}>
            {filledN}/{merged.length} points filled
          </span>
          <span style={{fontSize:11.5, fontWeight:800, color: hasPrepared ? "#16a34a" : "#d97706"}}>
            {hasPrepared ? "✓ Code + sign done" : "✍ Sheet ke niche PREPARED BY me code + sign karo"}
          </span>
          <button onClick={saveCalSheet} disabled={calSaving || !allFilled}
                  title={allFilled ? "" : gateHint}
                  style={{padding:"8px 20px", borderRadius:8, border:"none",
                          cursor: allFilled ? "pointer" : "not-allowed",
                          background: allFilled ? "#16a34a" : "#94a3b8",
                          color:"#fff", fontSize:12.5, fontWeight:800}}>
            {calSaving ? "Saving…" : "💾 Save Check Sheet"}
          </button>
          <button onClick={()=>setCalSheet(null)}
                  style={{padding:"8px 14px", borderRadius:8, border:bd, background:"#fff", cursor:"pointer", fontSize:12, fontWeight:700, color:"#64748b"}}>✕ Cancel</button>
          {calSheet.rejectReason ? (
            <div style={{flexBasis:"100%", fontSize:11.5, color:"#b91c1c", background:"#fef2f2",
                         border:"1px solid #fecaca", borderRadius:8, padding:"8px 10px"}}>
              ↩ <b>{calSheet.rejectedFrom || "Verifier"}</b> (code <b>{calSheet.rejectedBy || "—"}</b>) ne wapas bheji:
              <b> “{calSheet.rejectReason}”</b>
              <span style={{display:"block", color:"#7f1d1d", fontWeight:600, marginTop:2}}>
                Purana data waisa hi load hua hai — theek karke dobara sign karo. Wahi sheet update hogi, nayi nahi banegi.
              </span>
            </div>
          ) : (
            <div style={{flexBasis:"100%", fontSize:11, color:"#64748b"}}>
              Stage 1 of 3 — save karte hi sheet <b>Engineer (Maintenance)</b> ke verify ke liye jayegi,
              uske baad <b>In-Charge Maintenance</b> ke approve ke liye. Dono sign ke baad hi History me submit hogi.
            </div>
          )}
        </div>

        {/* ── CELL TOOLBAR — Observation / Action Taken / Spares / Status /
             Sign wale cells ko drag ya shift+click se select karo, phir yahan
             se Copy → Paste ya Fill Down.  Type karna pehle jaisa hi hai. ── */}
        <div style={{...card, marginBottom:14, display:"flex", gap:8, flexWrap:"wrap", alignItems:"center",
                     borderLeft:`4px solid ${nCells ? "#2563eb" : "#cbd5e1"}`}}>
          <span style={{fontSize:12, fontWeight:800, color: nCells ? "#2563eb" : "#94a3b8", minWidth:150}}>
            {nCells
              ? `⬚ ${nCells} cell${nCells>1?"s":""} — ${FILL_LBL.slice(box.c1, box.c2+1).join(", ")} · row ${box.r1+1}${box.r2>box.r1?`–${box.r2+1}`:""}`
              : "⬚ Koi cell select nahi"}
          </span>
          <button onClick={copyCells} disabled={!nCells} style={miniBtn}
                  title="Selected cells copy karo (Ctrl+C)">📋 Copy</button>
          <button onClick={pasteCells} disabled={!nCells || !clip} style={miniBtn}
                  title={clip ? "Copied cells yahan paste karo (Ctrl+V)" : "Pehle kuch copy karo"}>
            📄 Paste{clip ? ` (${clip.cells.length}×${clip.cells[0].length})` : ""}</button>
          <button onClick={fillDown} disabled={!nCells || box.r1 === box.r2} style={miniBtn}
                  title="Sabse upar wale cell ki value poori selection me bhar do (Ctrl+D)">⬇ Fill Down</button>
          <button onClick={()=>setCs(null)} disabled={!nCells} style={miniBtn}>✕ Clear</button>

          <div style={{flexBasis:"100%", fontSize:10.5, color:"#94a3b8"}}>
            Kisi fill cell pe <b>drag</b> karo ya ek cell click karke dusre pe <b>shift+click</b> — beech ke saare cells select ho jayenge.
            Phir <b>Ctrl+C / Ctrl+V</b> se copy-paste, ya <b>Ctrl+D</b> se upar wali value poori selection me.
            Ek hi cell select karke Paste karoge to poora copied block wahin se bhar jayega.
          </div>
        </div>
        {/* a re-opened sheet keeps the footer it was originally filled under */}
        <FormatSheet f={fmt ? { ...fmt, doc_footer: calSheet.docFooter || fmt.doc_footer } : fmt}
                     points={merged} rev={calSheet.rev} editable onEdit={onEditCal} signable={[0]}
                     onSpares={(i) => setSpareEdit({ i })}
                     cellSel={box} onCellDown={onCellDown} onCellEnter={onCellEnter}
                     signVals={[calSheet.sign.prepared, calSheet.sign.checked, calSheet.sign.approved]}
                     signImgs={calSheet.signImgs || [null,null,null]} onSign={onCalSign} onSignVal={onCalSignVal}
                     hdr={{ zone: calSheet.cp.zone, line: calSheet.cp.line,
                            machine_no: calSheet.cp.machine_no, machine_name: calSheet.cp.machine_name,
                            pm_date: calSheet.date }} />
      </div>
    );
  };

  return (
    <div style={{ padding:18, background:"#f1f5f9", minHeight:"100%" }}>
      <style>{`
        /* PM calendar — CURRENT week's plan date pulses + in/out-month contrast */
        @keyframes pmPulseAmber {
          0%   { box-shadow: inset 0 3px 0 #facc15, 0 0 0 0 rgba(245,158,11,.7); }
          70%  { box-shadow: inset 0 3px 0 #facc15, 0 0 0 10px rgba(245,158,11,0); }
          100% { box-shadow: inset 0 3px 0 #facc15, 0 0 0 0 rgba(245,158,11,0); }
        }
        @keyframes pmBlink { 0%,100% { opacity:1 } 50% { opacity:.3 } }
        .pm-week-now { animation: pmPulseAmber 1.5s infinite; border-color:#f59e0b !important; }
        .pm-week-now .pm-plan-badge { animation: pmBlink 1.2s infinite; background:#f59e0b !important; color:#fff !important; }
        .pm-cell-in { transition: transform .12s, box-shadow .12s; }
        .pm-cell-in:hover { transform: translateY(-1px); box-shadow: 0 4px 10px rgba(15,23,42,.12) !important; }
      `}</style>
      {/* header */}
      <div style={{ display:"flex", alignItems:"center", gap:12, flexWrap:"wrap", marginBottom:14 }}>
        <span style={{ fontSize:18, fontWeight:900, color:"#0f172a" }}>🛠 Preventive Maintenance</span>
        <div style={{ display:"flex", gap:4, background:"#e2e8f0", borderRadius:8, padding:3 }}>
          {[["schedule","Schedule",0],["fillpend","🖊 Fill Check Sheets",retData?.total || 0],
            ["engverify","✅ Engineer Verify",verCounts.engineer],
            ["incverify","🏁 In-Charge Approve",verCounts.incharge],
            ["format","Format",0],["yearlypm","Yearly PM Schedule",0]]
            .filter(([k]) => canAccess(PM_TAB_KEY[k])).map(([k,l,n]) => (
            <button key={k} onClick={()=>{ setView(k); setMsg(""); }} style={{
              padding:"5px 14px", borderRadius:6, border:"none", cursor:"pointer", fontWeight:700, fontSize:12,
              display:"inline-flex", alignItems:"center", gap:6,
              background: view===k ? "#2563eb" : "transparent", color: view===k ? "#fff" : "#475569" }}>
              {l}
              {n > 0 && (
                <span style={{ fontSize:10, fontWeight:900, borderRadius:99, padding:"0 6px", lineHeight:"15px",
                               background: view===k ? "#fff" : "#dc2626", color: view===k ? "#2563eb" : "#fff" }}>{n}</span>
              )}
            </button>
          ))}
        </div>
        <span style={{ flex:1 }} />
        <label style={{ fontSize:12, color:"#334155", fontWeight:600 }}>Month{" "}
          <input type="month" value={month} onChange={e=>setMonth(e.target.value)}
            style={{ padding:"4px 6px", borderRadius:6, border:bd }} />
        </label>
      </div>

      {/* ── DASHBOARD (schedule-driven) ── */}

      {/* ── FILL CHECK SHEETS — PM done but sheet pending, ALL months of the FY ── */}
      {view==="fillpend" && (() => {
        const all    = pendData?.items || [];
        const byMon  = pendData?.by_month || [];
        const total  = pendData?.total || 0;
        const items  = pendMonth ? all.filter(x => x.month === pendMonth) : all;
        const chip = (active) => ({padding:"4px 12px", borderRadius:99, fontWeight:800, fontSize:12, cursor:"pointer",
          border:"1px solid "+(active?"#7c3aed":"#cbd5e1"), background:active?"#7c3aed":"#fff", color:active?"#fff":"#475569"});
        return (
        <>
          {/* total pending (top) */}
          <div style={{...card, marginBottom:14, display:"flex", alignItems:"center", gap:12, flexWrap:"wrap"}}>
            <span style={{fontWeight:800, fontSize:15, color:"#7c3aed"}}>🖊 Fill Check Sheets{pendData?.fy?` — FY ${pendData.fy}`:""}</span>
            <span style={{fontSize:13, fontWeight:800, background:"#ede9fe", color:"#6d28d9", borderRadius:99, padding:"3px 14px"}}>
              Total {total} pending
            </span>
            {!pendData && <span style={{fontSize:12, color:"#94a3b8"}}>Loading…</span>}
          </div>

          {/* this tab's own status line — save/validation errors land in `msg`
              and were previously invisible here */}
          {msg && <div style={{...card, marginBottom:14, fontSize:12, fontWeight:700,
                               color: msg.startsWith("✓") ? "#16a34a" : "#dc2626"}}>{msg}</div>}

          {/* ── SENT BACK FOR CORRECTION — sabse upar, kyunki ye pehle nipatani h ── */}
          {(retData?.rows || []).length > 0 && (
            <div style={{...card, padding:0, overflow:"hidden", marginBottom:14, borderLeft:"4px solid #dc2626"}}>
              <div style={{padding:"10px 14px", fontWeight:800, fontSize:13, color:"#b91c1c",
                           borderBottom:bd, background:"#fef2f2"}}>
                ↩ Engineer (Maintenance) ne wapas bheji — correction karke dobara submit karo
                <span style={{marginLeft:8, fontSize:11, fontWeight:800, background:"#fee2e2",
                              color:"#b91c1c", borderRadius:99, padding:"1px 10px"}}>{retData.total}</span>
                <span style={{marginLeft:10, fontSize:11, fontWeight:600, color:"#7f1d1d"}}>
                  Bhara hua data waisa hi hai — sirf jo theek karna hai wo badlo.
                </span>
              </div>
              <table style={{width:"100%", borderCollapse:"collapse"}}>
                <thead><tr>{["#","Machine No.","Machine","PM Date","Kisne wapas bheji","Code","Reason","Points","Action"].map(h=>(
                  <th key={h} style={{border:bd, padding:"6px 8px", fontSize:10.5, fontWeight:800, background:"#f3f4f6", textAlign:"left"}}>{h}</th>))}</tr></thead>
                <tbody>
                  {retData.rows.map((x,i)=>(
                    <tr key={x.id} style={{background: calSheet?.fillId===x.id ? "#fee2e2" : "#fffbfb"}}>
                      <td style={{border:bd, padding:"6px 8px", fontSize:12}}>{i+1}</td>
                      <td style={{border:bd, padding:"6px 8px", fontSize:12, fontWeight:800}}>{x.machine_no}</td>
                      <td style={{border:bd, padding:"6px 8px", fontSize:12}}>{x.machine_name || "—"}</td>
                      <td style={{border:bd, padding:"6px 8px", fontSize:12, fontFamily:"monospace"}}>{x.pm_date}</td>
                      <td style={{border:bd, padding:"6px 8px", fontSize:12}}>{x.rejected_from || "—"}</td>
                      <td style={{border:bd, padding:"6px 8px", fontSize:12, fontWeight:700}}>{x.rejected_by || "—"}</td>
                      <td style={{border:bd, padding:"6px 8px", fontSize:12, color:"#b91c1c", fontWeight:600, maxWidth:320}}>{x.reject_reason || "—"}</td>
                      <td style={{border:bd, padding:"6px 8px", fontSize:12, textAlign:"center"}}>{x.n_points}</td>
                      <td style={{border:bd, padding:"6px 8px", whiteSpace:"nowrap"}}>
                        <button onClick={()=>openReturned(x.id)}
                                style={{padding:"5px 16px", borderRadius:6, border:"none", background:"#dc2626",
                                        color:"#fff", cursor:"pointer", fontSize:11.5, fontWeight:800}}>✏ Edit &amp; Re-submit</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* which months have pending — clickable chips */}
          {byMon.length>0 && (
            <div style={{...card, marginBottom:14, display:"flex", gap:8, flexWrap:"wrap", alignItems:"center"}}>
              <span style={{fontSize:12, fontWeight:800, color:"#64748b"}}>Months pending:</span>
              <button onClick={()=>setPendMonth("")} style={chip(pendMonth==="")}>All ({total})</button>
              {byMon.map(b => (
                <button key={b.month} onClick={()=>setPendMonth(b.month)} style={chip(pendMonth===b.month)}>{b.label}: {b.count}</button>
              ))}
            </div>
          )}

          <div style={{...card, padding:0, overflow:"hidden"}}>
            <div style={{padding:"10px 14px", fontWeight:800, fontSize:13, color:"#0f172a", borderBottom:bd}}>
              Jis machine ka PM ho gaya par check sheet abhi bhari nahi — yaha se fill karo
            </div>
            {items.length===0 ? (
              <div style={{padding:26, textAlign:"center", color:"#16a34a", fontSize:13, fontWeight:700}}>
                ✓ Koi pending nahi{pendMonth?" is month me":""} — done PMs ki check sheet bhar chuki hai.
              </div>
            ) : (
              <table style={{width:"100%", borderCollapse:"collapse"}}>
                <thead><tr>{["#","Zone","Line","Machine No.","Month","Week","PM Status","Check Sheet","Action"].map(h=>(
                  <th key={h} style={{border:bd, padding:"6px 8px", fontSize:10.5, fontWeight:800, background:"#f3f4f6", textAlign:"left"}}>{h}</th>))}</tr></thead>
                <tbody>
                  {items.map((x,i)=>(
                    <tr key={x.machine_code+"-"+x.month+"-"+x.week} style={{background:"#faf5ff"}}>
                      <td style={{border:bd, padding:"6px 8px", fontSize:12}}>{i+1}</td>
                      <td style={{border:bd, padding:"6px 8px", fontSize:12}}>{x.zone_name || "—"}</td>
                      <td style={{border:bd, padding:"6px 8px", fontSize:12}}>{x.line || "—"}</td>
                      <td style={{border:bd, padding:"6px 8px", fontSize:12, fontWeight:800}}>{x.machine_code}</td>
                      <td style={{border:bd, padding:"6px 8px", fontSize:12, whiteSpace:"nowrap"}}>{x.month_label}</td>
                      <td style={{border:bd, padding:"6px 8px", fontSize:12, textAlign:"center"}}>W{x.week}</td>
                      <td style={{border:bd, padding:"6px 8px"}}><span style={{padding:"2px 10px", borderRadius:99, fontSize:11, fontWeight:800, background:"#dcfce7", color:"#15803d"}}>✓ PM DONE</span></td>
                      <td style={{border:bd, padding:"6px 8px"}}><span style={{padding:"2px 10px", borderRadius:99, fontSize:11, fontWeight:800, background:"#ede9fe", color:"#6d28d9"}}>Sheet Pending</span></td>
                      <td style={{border:bd, padding:"6px 8px", whiteSpace:"nowrap"}}>
                        <button onClick={()=>openSheet(x, x.month, x.week)}
                                style={{padding:"5px 16px", borderRadius:6, border:"none", background:"#7c3aed", color:"#fff", cursor:"pointer", fontSize:11.5, fontWeight:800}}>📋 Fill Check Sheet</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* the fill form opens right below when a machine is picked */}
          {calSheet && calSheetForm()}
        </>
        );
      })()}

      {/* ── VERIFY STAGES — Engineer (2 of 3) and In-Charge (3 of 3) ──
           Both tabs share this block; `verStage` decides which queue is
           shown, which sign-off cell may be signed and where it goes next. */}
      {verStage && (() => {
        const rows   = verList?.rows || [];
        const role   = verList?.role || (verStage === "engineer" ? "Engineer (Maintenance)" : "In-Charge Maintenance");
        const accent = verStage === "engineer" ? "#0891b2" : "#15803d";
        const stepNo = verStage === "engineer" ? "2" : "3";
        const nextTxt = verStage === "engineer"
          ? "Sign karte hi sheet In-Charge Maintenance ke paas jayegi."
          : "Sign karte hi sheet FINAL ho jayegi aur History me submit hogi.";
        const cols = verStage === "engineer"
          ? ["#","Zone","Line","Machine No.","Machine","PM Date","Points","Prepared By","Action"]
          : ["#","Zone","Line","Machine No.","Machine","PM Date","Points","Prepared By","Checked By","Action"];
        const cell = { border:bd, padding:"6px 8px", fontSize:12 };
        return (
        <>
          <div style={{...card, marginBottom:14, display:"flex", alignItems:"center", gap:12, flexWrap:"wrap"}}>
            <span style={{fontWeight:800, fontSize:15, color:accent}}>
              {verStage === "engineer" ? "✅" : "🏁"} {role} — Verify &amp; Sign
            </span>
            <span style={{fontSize:11.5, fontWeight:800, background:"#f1f5f9", color:"#475569", borderRadius:99, padding:"3px 12px"}}>
              Step {stepNo} of 3
            </span>
            <span style={{fontSize:13, fontWeight:800, background:"#f1f5f9", color:accent, borderRadius:99, padding:"3px 14px"}}>
              Total {verList?.total ?? 0} pending
            </span>
            {(verList?.returned_total || 0) > 0 && (
              <span style={{fontSize:12.5, fontWeight:800, background:"#fee2e2", color:"#b91c1c", borderRadius:99, padding:"3px 12px"}}>
                ↩ {verList.returned_total} wapas aayi
              </span>
            )}
            {!verList && <span style={{fontSize:12, color:"#94a3b8"}}>Loading…</span>}
            <span style={{flex:1}} />
            <span style={{fontSize:11, color:"#64748b"}}>{nextTxt}</span>
          </div>

          {msg && <div style={{...card, marginBottom:14, fontSize:12, fontWeight:700,
                               color: msg.startsWith("✓") ? "#16a34a" : "#dc2626"}}>{msg}</div>}

          {/* ── In-Charge ne jo sheets wapas bheji — Engineer tab pe alag,
               sabse upar, kyunki ye pehle nipatani hain ── */}
          {(verList?.returned || []).length > 0 && (
            <div style={{...card, padding:0, overflow:"hidden", marginBottom:14, borderLeft:"4px solid #dc2626"}}>
              <div style={{padding:"10px 14px", fontWeight:800, fontSize:13, color:"#b91c1c",
                           borderBottom:bd, background:"#fef2f2"}}>
                ↩ In-Charge Maintenance ne wapas bheji — dobara check karke sign karo
                <span style={{marginLeft:8, fontSize:11, fontWeight:800, background:"#fee2e2",
                              color:"#b91c1c", borderRadius:99, padding:"1px 10px"}}>{verList.returned_total}</span>
                <span style={{marginLeft:10, fontSize:11, fontWeight:600, color:"#7f1d1d"}}>
                  Data waisa hi hai. Theek lage to sign karo, warna aage Team Member ko wapas bhej do.
                </span>
              </div>
              <table style={{width:"100%", borderCollapse:"collapse"}}>
                <thead><tr>{["#","Zone","Line","Machine No.","PM Date","Reason (In-Charge)","Code","Points","Action"].map(h=>(
                  <th key={h} style={{border:bd, padding:"6px 8px", fontSize:10.5, fontWeight:800, background:"#f3f4f6", textAlign:"left"}}>{h}</th>))}</tr></thead>
                <tbody>
                  {verList.returned.map((x,i)=>(
                    <tr key={x.id} style={{background: verSheet?.id===x.id ? "#fee2e2" : "#fffbfb"}}>
                      <td style={{border:bd, padding:"6px 8px", fontSize:12}}>{i+1}</td>
                      <td style={{border:bd, padding:"6px 8px", fontSize:12}}>{x.zone_name || "—"}</td>
                      <td style={{border:bd, padding:"6px 8px", fontSize:12}}>{x.line_name || "—"}</td>
                      <td style={{border:bd, padding:"6px 8px", fontSize:12, fontWeight:800}}>{x.machine_no}</td>
                      <td style={{border:bd, padding:"6px 8px", fontSize:12, fontFamily:"monospace"}}>{x.pm_date}</td>
                      <td style={{border:bd, padding:"6px 8px", fontSize:12, color:"#b91c1c", fontWeight:600, maxWidth:300}}>{x.reject_reason || "—"}</td>
                      <td style={{border:bd, padding:"6px 8px", fontSize:12, fontWeight:700}}>{x.rejected_by || "—"}</td>
                      <td style={{border:bd, padding:"6px 8px", fontSize:12, textAlign:"center"}}>{x.n_points}</td>
                      <td style={{border:bd, padding:"6px 8px", whiteSpace:"nowrap"}}>
                        <button onClick={()=>openVerify(x.id)}
                                style={{padding:"5px 16px", borderRadius:6, border:"none", background:"#dc2626",
                                        color:"#fff", cursor:"pointer", fontSize:11.5, fontWeight:800}}>🔁 Dobara check karo</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div style={{...card, padding:0, overflow:"hidden"}}>
            <div style={{padding:"10px 14px", fontWeight:800, fontSize:13, color:"#0f172a", borderBottom:bd}}>
              {verStage === "engineer"
                ? "Team Member ne jo check sheet bhari hain — yaha verify karke sign karo"
                : "Engineer verify kar chuka hai — yaha final approve karke sign karo"}
            </div>
            {rows.length === 0 ? (
              <div style={{padding:26, textAlign:"center", color:"#16a34a", fontSize:13, fontWeight:700}}>
                ✓ Koi sheet pending nahi — sab verify ho chuki hain.
              </div>
            ) : (
              <table style={{width:"100%", borderCollapse:"collapse"}}>
                <thead><tr>{cols.map(h=>(
                  <th key={h} style={{border:bd, padding:"6px 8px", fontSize:10.5, fontWeight:800, background:"#f3f4f6", textAlign:"left"}}>{h}</th>))}</tr></thead>
                <tbody>
                  {rows.map((x,i)=>(
                    <tr key={x.id} style={{background: verSheet?.id === x.id ? "#eff6ff" : "transparent"}}>
                      <td style={cell}>{i+1}</td>
                      <td style={cell}>{x.zone_name || "—"}</td>
                      <td style={cell}>{x.line_name || "—"}</td>
                      <td style={{...cell, fontWeight:800}}>{x.machine_no}</td>
                      <td style={cell}>{x.machine_name || "—"}</td>
                      <td style={{...cell, fontFamily:"monospace"}}>{x.pm_date}</td>
                      <td style={{...cell, textAlign:"center"}}>{x.n_points}</td>
                      <td style={cell}>{x.prepared_by || "—"}</td>
                      {verStage === "incharge" && <td style={cell}>{x.checked_by || "—"}</td>}
                      <td style={{...cell, whiteSpace:"nowrap"}}>
                        <button onClick={()=>openVerify(x.id)}
                                style={{padding:"5px 16px", borderRadius:6, border:"none", background:accent,
                                        color:"#fff", cursor:"pointer", fontSize:11.5, fontWeight:800}}>
                          🔍 Open &amp; Verify</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* the opened sheet — points are READ-ONLY here, only this stage's
              sign-off cell can be signed */}
          {verSheet && (() => {
            const imgs = [...(verSheet.sign_imgs || [])];
            while (imgs.length < 3) imgs.push(null);
            if (verSheet.vSign) imgs[verSlot] = verSheet.vSign;
            const vals = [verSheet.prepared_by || "", verSheet.checked_by || "", verSheet.approved_by || ""];
            vals[verSlot] = verSheet.vName;          // this stage's code box is driven by vName
            const ready = !!verSheet.vName.trim() && !!verSheet.vSign;
            return (
              <div style={{marginTop:14}}>
                <div style={{...card, marginBottom:14, display:"flex", gap:10, flexWrap:"wrap", alignItems:"center"}}>
                  <b style={{fontSize:13, color:"#0f172a"}}>
                    PM Check Sheet — {verSheet.machine_no} · {verSheet.pm_date}
                  </b>
                  <span style={{fontSize:11.5, fontWeight:800, color: ready ? "#16a34a" : "#d97706"}}>
                    {ready ? "✓ Code + sign done"
                           : `✍ Sheet ke niche ${role} me apna code + sign karo`}
                  </span>
                  <button onClick={submitVerify} disabled={verSaving || !ready}
                          title={ready ? "" : "Code aur signature dono zaroori hain"}
                          style={{padding:"8px 20px", borderRadius:8, border:"none",
                                  cursor: ready ? "pointer" : "not-allowed",
                                  background: ready ? accent : "#94a3b8",
                                  color:"#fff", fontSize:12.5, fontWeight:800}}>
                    {verSaving ? "Saving…" : (verStage === "engineer" ? "✔ Verify & Sign" : "🏁 Approve & Submit")}
                  </button>
                  <button onClick={()=>setVerSheet(s=>s?{...s, rejecting:!s.rejecting, vReason:""}:s)}
                          title={`Sheet ${verList?.reject_who || ""} ke paas wapas jayegi`}
                          style={{padding:"8px 16px", borderRadius:8, border:"1px solid #fca5a5",
                                  background: verSheet.rejecting ? "#fee2e2" : "#fff", color:"#b91c1c",
                                  cursor:"pointer", fontSize:12, fontWeight:800}}>
                    ↩ {verSheet.rejecting ? "Reject cancel"
                        : `Wapas bhejo → ${verStage === "engineer" ? "Team Member" : "Engineer"}`}</button>
                  <button onClick={()=>setVerSheet(null)}
                          style={{padding:"8px 14px", borderRadius:8, border:bd, background:"#fff", cursor:"pointer", fontSize:12, fontWeight:700, color:"#64748b"}}>✕ Close</button>

                  {/* RET_ENGINEER = abhi In-Charge ne wapas bheji hai (live reason);
                      warna sirf context ki pehle kabhi wapas gayi thi */}
                  {verSheet.reject_reason && !verSheet.rejecting && (
                    verSheet.stage === "RET_ENGINEER" ? (
                      <div style={{flexBasis:"100%", fontSize:12, color:"#b91c1c", background:"#fef2f2",
                                   border:"1px solid #fecaca", borderRadius:8, padding:"8px 10px"}}>
                        ↩ <b>{verSheet.rejected_from || "In-Charge Maintenance"}</b> (code <b>{verSheet.rejected_by || "—"}</b>) ne wapas bheji:
                        <b> “{verSheet.reject_reason}”</b>
                        <span style={{display:"block", color:"#7f1d1d", fontWeight:600, marginTop:2}}>
                          Data waisa hi hai. Theek lage to code + sign karke aage bhejo, warna Team Member ko wapas bhej do.
                        </span>
                      </div>
                    ) : (
                      <div style={{flexBasis:"100%", fontSize:11.5, color:"#92400e", background:"#fffbeb",
                                   border:"1px solid #fde68a", borderRadius:8, padding:"7px 10px"}}>
                        ⓘ Ye sheet pehle <b>{verSheet.rejected_from || "—"}</b> ne wapas bheji thi
                        (code <b>{verSheet.rejected_by || "—"}</b>): “{verSheet.reject_reason}” — ab correction ke baad dobara aayi hai.
                      </div>
                    )
                  )}

                  {verSheet.rejecting && (
                    <div style={{flexBasis:"100%", display:"flex", gap:8, flexWrap:"wrap", alignItems:"center",
                                 background:"#fef2f2", border:"1px solid #fecaca", borderRadius:8, padding:10}}>
                      <span style={{fontSize:12, fontWeight:800, color:"#b91c1c"}}>Wapas bhejne ka reason:</span>
                      <input value={verSheet.vReason} autoFocus
                             placeholder="Kya theek karna hai? (zaroori)"
                             onChange={e=>setVerSheet(s=>s?{...s, vReason:e.target.value}:s)}
                             onKeyDown={e=>{ if(e.key==="Enter" && verSheet.vName.trim() && verSheet.vReason.trim().length>=3) submitReject(); }}
                             style={{flex:"1 1 320px", padding:7, borderRadius:6, border:"1px solid #fca5a5", fontSize:12}} />
                      <button onClick={submitReject}
                              disabled={verSaving || !verSheet.vName.trim() || verSheet.vReason.trim().length < 3}
                              title={!verSheet.vName.trim() ? "Pehle apna code daalo (sheet ke niche)" : "Reason likhna zaroori hai"}
                              style={{padding:"7px 18px", borderRadius:8, border:"none",
                                      cursor: (verSheet.vName.trim() && verSheet.vReason.trim().length>=3) ? "pointer" : "not-allowed",
                                      background: (verSheet.vName.trim() && verSheet.vReason.trim().length>=3) ? "#dc2626" : "#94a3b8",
                                      color:"#fff", fontSize:12.5, fontWeight:800}}>
                        {verSaving ? "…" : "↩ Wapas bhejo"}</button>
                      <span style={{flexBasis:"100%", fontSize:10.5, color:"#b91c1c"}}>
                        Sheet <b>{verList?.reject_who || "—"}</b> ke paas jayegi — ek hi step peeche, poore niche nahi.
                        Bhara hua data <b>clear nahi hoga</b>. Reject ke liye bhi apna code (sheet ke niche) daalna zaroori hai.
                      </span>
                    </div>
                  )}
                </div>
                {/* the sheet's OWN document-control footer (snapshotted at fill
                    time) — not the live format's, so approvers sign exactly
                    the document that History will archive */}
                <FormatSheet f={fmt ? { ...fmt, doc_footer: verSheet.doc_footer || fmt.doc_footer } : fmt}
                             points={verSheet.entries || []}
                             rev={{ rev_no: verSheet.rev_no, rev_date: verSheet.rev_date }}
                             signable={[verSlot]} signVals={vals} signImgs={imgs}
                             onSign={onVerSign} onSignVal={onVerSignVal}
                             hdr={{ zone: verSheet.zone_name, line: verSheet.line_name,
                                    machine_no: verSheet.machine_no, machine_name: verSheet.machine_name,
                                    pm_date: verSheet.pm_date }} />
              </div>
            );
          })()}
        </>
        );
      })()}

      {/* ── FORMAT (the blank saved format) ── */}
      {view==="format" && <FormatSheet f={fmt} />}

      {/* ── YEARLY PM SCHEDULE FORMAT (maintenance_yearly_pm_shedule) ── */}
      {view==="yearlypm" && <YearlyPmTab ypm={ypm} ypmFy={ypmFy} setYpmFy={setYpmFy} ypmYears={ypmYears} api={api} />}

      {/* ── SCHEDULE / PLANNER / CALENDAR / MAIL ── */}
      {view==="schedule" && (() => {
        const today = new Date(); today.setHours(0,0,0,0);
        // bounds of TODAY's calendar week (Sun→Sat) — used for the blink AND to
        // decide which plan-weeks have already PASSED (→ overdue).
        const todayWkStart = new Date(today); todayWkStart.setHours(0,0,0,0);
        todayWkStart.setDate(today.getDate() - today.getDay());
        const todayWkEnd = new Date(todayWkStart); todayWkEnd.setDate(todayWkStart.getDate()+6);
        todayWkEnd.setHours(23,59,59,999);
        const isDone = (s) => (s.status||"").toLowerCase()==="done";
        const isOverdue = (s) => !isDone(s) && s.due_date && new Date(s.due_date+"T00:00:00") < today;
        const [yy, mm] = month.split("-").map(Number);
        // KPI tiles from the YEARLY PLAN of this month (how many PM planned /
        // done / pending / overdue) — not from the manual planner list.
        let total = 0, done = 0, overdue = 0, sheetPend = 0;
        const pendList = [];   // PM DONE but check sheet not yet filled (all weeks)
        Object.entries(ypmMonth?.weeks || {}).forEach(([w, arr]) => {
          // a plan-week has PASSED (→ overdue if not done) once its start day
          // (1 / 8 / 15 / 22) falls BEFORE today's calendar week (Sun→Sat).
          const wkStart = new Date(yy, mm-1, (Number(w)-1) * 7 + 1); wkStart.setHours(0,0,0,0);
          const passed = wkStart < todayWkStart;
          arr.forEach((x) => {
            total++;
            if (x.done) { done++; if (!x.sheet_filled) { sheetPend++; pendList.push({ ...x, week: Number(w) }); } }
            else if (passed) overdue++;
          });
        });
        const pending = total - done;
        const compliance = total ? Math.round(done/total*100) : 0;
        const first = new Date(yy, mm-1, 1);
        const gridStart = new Date(yy, mm-1, 1 - first.getDay());
        const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
        const byDay = {}; schedule.forEach(s => { (byDay[s.due_date] = byDay[s.due_date]||[]).push(s); });
        const cells = Array.from({length:42},(_,i)=>{ const d=new Date(gridStart); d.setDate(gridStart.getDate()+i); return d; });
        const todayY = ymd(today);
        const kpi = (l,n,c,onClick,hint) => (<div onClick={onClick}
            style={{...card,minWidth:118,borderTop:`3px solid ${c}`,cursor:onClick?"pointer":"default",
                    outline:(onClick && showPend)?`2px solid ${c}`:"none"}}>
          <div style={{fontSize:11,color:"#64748b",fontWeight:700}}>{l}</div>
          <div style={{fontSize:24,fontWeight:900,color:c}}>{n}</div>
          {hint && <div style={{fontSize:9.5,color:c,fontWeight:700,marginTop:1}}>{hint}</div>}</div>);
        return (
        <>
          <div style={{display:"flex",gap:12,flexWrap:"wrap",marginBottom:14}}>
            {kpi("PM Planned (month)",total,"#2563eb")}{kpi("PM Done",done,"#16a34a")}{kpi("Pending",pending,"#d97706")}
            {kpi("Overdue",overdue,"#dc2626")}
            {kpi("Check Sheet Pending",sheetPend,"#7c3aed",
                 ()=>{ setShowPend(p=>!p); setSelWeek(null); },
                 sheetPend?"▼ click to fill":"")}
            {kpi("Compliance",compliance+"%",compliance>=90?"#16a34a":"#d97706")}
          </div>

          {/* ── Check Sheet Pending — all DONE PMs whose sheet is not yet filled ── */}
          {showPend && (
            <div style={{...card, marginBottom:14, padding:0, overflow:"hidden", borderTop:"3px solid #7c3aed"}}>
              <div style={{padding:"10px 14px", display:"flex", alignItems:"center", gap:10, borderBottom:bd}}>
                <span style={{fontWeight:800, fontSize:13, color:"#7c3aed"}}>
                  📋 Check Sheet Pending — {month}
                  <span style={{marginLeft:8, fontSize:11, fontWeight:800, background:"#ede9fe", color:"#6d28d9", borderRadius:99, padding:"1px 10px"}}>
                    {pendList.length} pending
                  </span>
                </span>
                <button onClick={()=>setShowPend(false)}
                        style={{marginLeft:"auto", border:"none", background:"transparent", color:"#64748b", cursor:"pointer", fontWeight:800}}>✕ Close</button>
              </div>
              {pendList.length===0 ? (
                <div style={{padding:20, textAlign:"center", color:"#16a34a", fontSize:12.5, fontWeight:700}}>✓ No pending — every done PM's check sheet is filled.</div>
              ) : (
                <table style={{width:"100%", borderCollapse:"collapse"}}>
                  <thead><tr>{["#","M/C Code","Machine","Line","Freq","Week","Action"].map(h=>(
                    <th key={h} style={{border:bd, padding:"5px 8px", fontSize:10.5, fontWeight:800, background:"#f3f4f6", textAlign:"left"}}>{h}</th>))}</tr></thead>
                  <tbody>
                    {pendList.map((x,i)=>(
                      <tr key={x.machine_code+"-"+x.week} style={{background:"#faf5ff"}}>
                        <td style={{border:bd, padding:"5px 8px", fontSize:12}}>{i+1}</td>
                        <td style={{border:bd, padding:"5px 8px", fontSize:12, fontWeight:800}}>{x.machine_code}</td>
                        <td style={{border:bd, padding:"5px 8px", fontSize:12}}>{x.machine_name}</td>
                        <td style={{border:bd, padding:"5px 8px", fontSize:12}}>{x.line || "—"}</td>
                        <td style={{border:bd, padding:"5px 8px", fontSize:12, textAlign:"center", fontWeight:700}}>{x.pm_frequency || "—"}</td>
                        <td style={{border:bd, padding:"5px 8px", fontSize:12, textAlign:"center"}}>W{x.week}</td>
                        <td style={{border:bd, padding:"5px 8px", whiteSpace:"nowrap"}}>
                          <button onClick={()=>{ openSheet(x, month, x.week); }}
                                  style={{padding:"4px 14px", borderRadius:6, border:"none", background:"#7c3aed", color:"#fff", cursor:"pointer", fontSize:11.5, fontWeight:800}}>📋 Fill Check Sheet</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div style={{padding:"8px 14px", fontSize:11, color:"#94a3b8"}}>
                Jis machine ka PM ho gaya par check sheet nahi bhari — sab yahan. Fill karte hi list se hat jayegi.
              </div>
            </div>
          )}

          <div style={{display:"grid",gridTemplateColumns:"1fr 320px",gap:14,alignItems:"start"}}>
            {/* calendar */}
            <div style={card}>
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
                <span style={{fontWeight:800,fontSize:14,color:"#0f172a"}}>📅 PM Calendar — {(() => { const [y,m]=month.split("-").map(Number); return new Date(y,m-1,1).toLocaleString("en-US",{month:"long",year:"numeric"}); })()}</span>
                <span style={{marginLeft:"auto",display:"inline-flex",gap:6}}>
                  <button onClick={()=>setMonth(shiftMonth(month,-1))}
                          style={{padding:"4px 12px",borderRadius:7,border:bd,background:"#fff",cursor:"pointer",fontSize:12,fontWeight:800,color:"#334155"}}>◀ Prev</button>
                  <button onClick={()=>setMonth(monthISO())}
                          style={{padding:"4px 12px",borderRadius:7,border:bd,background:"#fff",cursor:"pointer",fontSize:12,fontWeight:700,color:"#64748b"}}>Today</button>
                  <button onClick={()=>setMonth(shiftMonth(month,1))}
                          style={{padding:"4px 12px",borderRadius:7,border:bd,background:"#fff",cursor:"pointer",fontSize:12,fontWeight:800,color:"#334155"}}>Next ▶</button>
                </span>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4}}>
                {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d=>(
                  <div key={d} style={{textAlign:"center",fontSize:10.5,fontWeight:800,letterSpacing:".05em",
                      background:"#1e3a8a",color:d==="Sun"?"#fca5a5":"#fff",borderRadius:6,padding:"4px 0"}}>{d}</div>))}
                {cells.map((d,i)=>{
                  const k=ymd(d), inMonth=d.getMonth()===mm-1, items=byDay[k]||[], isToday=k===todayY;
                  // Yearly-plan overlay — ONE indication per plan-week, on the
                  // week's START date (1 / 8 / 15 / 22), not on every day.
                  // Grid tail cells from the NEXT month show its plan too.
                  const wkNo = Math.min(4, Math.floor((d.getDate()-1)/7)+1);
                  const isNextMonth = !inMonth && (d.getFullYear() > yy || (d.getFullYear() === yy && d.getMonth() > mm-1));
                  const src = inMonth ? ypmMonth : (isNextMonth ? ypmNext : null);
                  const isWkStart = [1, 8, 15, 22].includes(d.getDate());
                  const planned = (src && isWkStart) ? (src.weeks?.[String(wkNo)] || []) : [];
                  const mLabel = src?.month || "";
                  // this plan-week has PASSED (chips → red/overdue) if its start day
                  // is before today's calendar week — same rule as the Overdue KPI.
                  const wkPassed = d < todayWkStart;
                  return (<div key={i}
                    onMouseEnter={planned.length ? (e)=>setWkTip({week:wkNo, items:planned, x:e.clientX, y:e.clientY, mLabel}) : undefined}
                    onMouseMove={planned.length ? (e)=>setWkTip(t=>t?{...t,x:e.clientX,y:e.clientY}:t) : undefined}
                    onMouseLeave={planned.length ? ()=>setWkTip(null) : undefined}
                    onClick={planned.length ? ()=>{ setSelWeek({ mLabel, week: wkNo }); setCalSheet(null); setShowPend(false); } : undefined}
                    className={[inMonth ? "pm-cell-in" : "",
                                // the plan-cell inside TODAY's calendar week (Sun→Sat)
                                // blinks/pulses; it moves to the next week automatically.
                                (planned.length && d>=todayWkStart && d<=todayWkEnd)
                                  ? "pm-week-now" : ""].join(" ").trim() || undefined}
                    style={{minHeight:60,borderRadius:8,padding:3,
                      cursor: planned.length ? "pointer" : "default",
                      // in-month days POP; other-month days fade back
                      border: inMonth ? "1px solid #cbd5e1" : "1px dashed #e2e8f0",
                      opacity: inMonth ? 1 : .5,
                      background: inMonth
                        ? (isToday ? "#eff6ff" : "#fff")
                        : "#eef2f7",
                      outline: isToday ? "2px solid #2563eb" : "none",
                      boxShadow: planned.length
                        ? "inset 0 3px 0 #facc15"
                        : (inMonth ? "0 1px 2px rgba(15,23,42,.06)" : "none")}}>
                    <div style={{display:"flex",alignItems:"center",gap:4}}>
                      <span style={{fontSize:10,fontWeight:inMonth?800:600,color:inMonth?"#0f172a":"#b6c2d1"}}>{d.getDate()}</span>
                      {planned.length>0 &&
                        <span className="pm-plan-badge"
                              style={{marginLeft:"auto",fontSize:8.5,fontWeight:800,background:"#fef08a",
                                      color:"#854d0e",borderRadius:99,padding:"0 5px",whiteSpace:"nowrap"}}>
                          {wkNo}W · {planned.length} PM</span>}
                    </div>
                    {/* PM entries come from the YEARLY PM SCHEDULE — each planned
                        week is shown once, on that week's start day (1/8/15/22). */}
                    {planned.slice(0,3).map((p,j)=>{
                      const over = !p.done && wkPassed;
                      return (
                      <div key={j} title={`${p.zone_name||"—"} · ${p.line||"—"} · ${p.machine_code||"—"}`}
                          style={{fontSize:9,marginTop:2,padding:"1px 3px",borderRadius:3,
                          background:p.done?"#dcfce7":over?"#fee2e2":"#fef3c7",
                          color:p.done?"#15803d":over?"#b91c1c":"#b45309",
                          whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{p.machine_code||"PM"}</div>);
                    })}
                    {planned.length>3 && <div style={{fontSize:9,color:"#94a3b8"}}>+{planned.length-3} more</div>}
                  </div>);
                })}
              </div>
              <div style={{display:"flex",gap:14,marginTop:8,fontSize:10,color:"#64748b"}}>
                <span>🟨 Pending</span><span>🟩 Done</span><span>🟥 Overdue</span>
                <span style={{display:"inline-flex",alignItems:"center",gap:5}}>
                  <span style={{width:14,height:8,background:"#facc15",borderRadius:2,display:"inline-block"}} />
                  PM PLAN (from Yearly PM Schedule) — each planned week shown on its start day (1 / 8 / 15 / 22); current week pulses; hover for machines
                </span>
              </div>
              {/* hover tooltip: the lines/machines planned in that week */}
              {wkTip && (
                <div style={{position:"fixed", left:Math.min(wkTip.x+14, window.innerWidth-330), top:Math.min(wkTip.y+12, window.innerHeight-300),
                             zIndex:500, width:310, maxHeight:280, overflowY:"auto", background:"#0f172a",
                             color:"#fff", borderRadius:10, padding:"10px 12px", boxShadow:"0 10px 30px rgba(0,0,0,.35)",
                             pointerEvents:"none"}}>
                  <div style={{fontSize:11, fontWeight:800, color:"#facc15", marginBottom:6}}>
                    PM PLAN — {wkTip.mLabel || month} · Week {wkTip.week} ({wkTip.items.length} machine{wkTip.items.length===1?"":"s"})
                  </div>
                  {wkTip.items.slice(0,30).map((p,j)=>(
                    <div key={j} style={{fontSize:10.5, padding:"2px 0", borderBottom:"1px solid rgba(255,255,255,.08)"}}>
                      <span style={{color:"#cbd5e1"}}>{p.zone_name || "—"}  ·  {p.line || "—"}  ·  </span>
                      <b style={{color:"#fff"}}>{p.machine_code || "—"}</b>
                    </div>
                  ))}
                  {wkTip.items.length>30 && <div style={{fontSize:10, color:"#94a3b8", marginTop:4}}>+{wkTip.items.length-30} more…</div>}
                </div>
              )}
            </div>

            {/* mail */}
            <div style={{display:"flex",flexDirection:"column",gap:14}}>
              {msg && <div style={{...card,fontSize:11,fontWeight:700,color:msg.startsWith("✓")?"#16a34a":"#dc2626"}}>{msg}</div>}
              <div style={card}>
                <div style={{fontWeight:800,fontSize:14,marginBottom:8,color:"#0f172a"}}>✉ Reminder Mail</div>
                <input value={mailCfg.recipient||""} onChange={e=>setMailCfg(c=>({...c,recipient:e.target.value}))}
                  placeholder="recipient@tbdi.com" style={{width:"100%",padding:6,borderRadius:6,border:bd,marginBottom:8,fontSize:12,boxSizing:"border-box"}} />
                <label style={{display:"flex",alignItems:"center",gap:6,fontSize:11,color:"#334155",marginBottom:8}}>
                  <input type="checkbox" checked={!!mailCfg.auto_enabled} onChange={e=>setMailCfg(c=>({...c,auto_enabled:e.target.checked}))} /> Auto (Mon→this-week, Sat→next-week)
                </label>
                <div style={{display:"flex",gap:6}}>
                  <button onClick={saveMail} style={{flex:1,padding:6,borderRadius:6,border:bd,background:"#fff",fontWeight:700,fontSize:11,cursor:"pointer"}}>Save</button>
                  <button onClick={()=>sendMail("current-week")} disabled={busy} style={{flex:1,padding:6,borderRadius:6,border:"none",background:"#16a34a",color:"#fff",fontWeight:700,fontSize:11,cursor:"pointer"}}>This week</button>
                  <button onClick={()=>sendMail("next-week")} disabled={busy} style={{flex:1,padding:6,borderRadius:6,border:"none",background:"#0891b2",color:"#fff",fontWeight:700,fontSize:11,cursor:"pointer"}}>Next week</button>
                </div>
              </div>
            </div>
          </div>

          {/* ── clicked week: the planned machines + DONE actions ── */}
          {selWeek && (() => {
            const src = selWeek.mLabel === month ? ypmMonth : ypmNext;
            const items = src?.weeks?.[String(selWeek.week)] || [];
            const doneN = items.filter(x=>x.done).length;
            return (
              <div style={{...card, marginTop:14, padding:0, overflow:"hidden"}}>
                <div style={{padding:"10px 14px", display:"flex", alignItems:"center", gap:10, borderBottom:bd}}>
                  <span style={{fontWeight:800, fontSize:13, color:"#0f172a"}}>
                    🗓 PM Plan — {selWeek.mLabel} · Week {selWeek.week}
                  </span>
                  <span style={{fontSize:11, fontWeight:800, background:"#fef08a", color:"#854d0e", borderRadius:99, padding:"1px 10px"}}>
                    {items.length} planned · {doneN} done
                  </span>
                  <button onClick={()=>{ setSelWeek(null); setCalSheet(null); }}
                          style={{marginLeft:"auto", border:"none", background:"transparent", color:"#64748b", cursor:"pointer", fontWeight:800}}>✕ Close</button>
                </div>
                <table style={{width:"100%", borderCollapse:"collapse"}}>
                  <thead><tr>{["#","M/C Code","Machine","Line","Freq","PM Status","Check Sheet","Action"].map(h=>(
                    <th key={h} style={{...th, textAlign:"left"}}>{h}</th>))}</tr></thead>
                  <tbody>
                    {items.map((x, i)=>(
                      <tr key={x.machine_code + i} style={{background: x.done ? "#f0fdf4" : "transparent"}}>
                        <td style={{border:bd, padding:"5px 8px", fontSize:12}}>{i+1}</td>
                        <td style={{border:bd, padding:"5px 8px", fontSize:12, fontWeight:800}}>{x.machine_code}</td>
                        <td style={{border:bd, padding:"5px 8px", fontSize:12}}>{x.machine_name}</td>
                        <td style={{border:bd, padding:"5px 8px", fontSize:12}}>{x.line || "—"}</td>
                        <td style={{border:bd, padding:"5px 8px", fontSize:12, textAlign:"center", fontWeight:700}}>{x.pm_frequency || "—"}</td>
                        <td style={{border:bd, padding:"5px 8px"}}>
                          <span style={{padding:"2px 10px", borderRadius:99, fontSize:11, fontWeight:800,
                                        background: x.done ? "#dcfce7" : "#fef3c7", color: x.done ? "#15803d" : "#b45309"}}>
                            {x.done ? "✓ PM DONE" : "Pending"}
                          </span>
                        </td>
                        <td style={{border:bd, padding:"5px 8px"}}>
                          {/* the sheet becomes relevant only AFTER the PM is done */}
                          {!x.done ? (
                            <span style={{fontSize:11, color:"#94a3b8", fontWeight:700}}>—</span>
                          ) : (
                            <span style={{padding:"2px 10px", borderRadius:99, fontSize:11, fontWeight:800,
                                          background: x.sheet_filled ? "#dcfce7" : "#ede9fe",
                                          color: x.sheet_filled ? "#15803d" : "#6d28d9"}}>
                              {x.sheet_filled ? "✓ Filled" : "Sheet Pending"}
                            </span>
                          )}
                        </td>
                        <td style={{border:bd, padding:"5px 8px", whiteSpace:"nowrap"}}>
                          {x.done ? (
                            <button onClick={()=>markDone(x, selWeek.mLabel, selWeek.week, "clear")}
                                    style={{padding:"3px 10px", borderRadius:6, border:bd, background:"#fff", cursor:"pointer", fontSize:11, fontWeight:700, color:"#64748b"}}>↩ Undo</button>
                          ) : (
                            <button onClick={()=>markDone(x, selWeek.mLabel, selWeek.week, "set")}
                                    style={{padding:"3px 14px", borderRadius:6, border:"none", background:"#16a34a", color:"#fff", cursor:"pointer", fontSize:11.5, fontWeight:800}}>✔ Done</button>
                          )}
                          {x.done && !x.sheet_filled && (
                            <button onClick={()=>openSheet(x, selWeek.mLabel, selWeek.week)}
                                    style={{marginLeft:6, padding:"3px 12px", borderRadius:6, border:"none", background:"#7c3aed", color:"#fff", cursor:"pointer", fontSize:11.5, fontWeight:800}}>📋 Fill Check Sheet</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{padding:"8px 14px", fontSize:11, color:"#94a3b8"}}>
                  ✔ Done marks the PM done — THEN the 📋 Fill Check Sheet option appears. Until the sheet is
                  saved (every point needs a STATUS, same as the Check Sheet tab) the machine shows
                  <b> Sheet Pending</b> and counts in the "Check Sheet Pending" tile above.
                </div>
              </div>
            );
          })()}

          {/* ── the DONE-flow check sheet (fill + save = PM DONE) ── */}
          {calSheet && calSheetForm()}

          {/* schedule table */}
          <div style={{...card,marginTop:14,padding:0,overflow:"hidden"}}>
            <div style={{padding:"10px 14px",fontWeight:800,fontSize:13,color:"#0f172a",borderBottom:bd}}>Scheduled PMs — {month}</div>
            {schedule.length===0 ? <div style={{padding:16,color:"#64748b",fontSize:12}}>No PM scheduled this month. Use "Plan a PM" above.</div> : (
              <table style={{width:"100%",borderCollapse:"collapse"}}>
                <thead><tr>{["Machine","Zone / Line","Due","Status",""].map(h=>(<th key={h} style={{...th,textAlign:"left"}}>{h}</th>))}</tr></thead>
                <tbody>
                  {schedule.map(s=>(
                    <tr key={s.id} style={{background:isOverdue(s)?"#fff1f2":"transparent"}}>
                      <td style={{border:bd,padding:"5px 8px",fontSize:12,fontWeight:600}}>{s.machine_name||s.machine_no||"—"}</td>
                      <td style={{border:bd,padding:"5px 8px",fontSize:12}}>{s.zone||"—"} / {s.line||"—"}</td>
                      <td style={{border:bd,padding:"5px 8px",fontSize:12,fontFamily:"monospace",color:isOverdue(s)?"#dc2626":"#475569"}}>{s.due_date}{isOverdue(s)?" ⚠":""}</td>
                      <td style={{border:bd,padding:"5px 8px"}}>
                        <button onClick={()=>togglePlan(s)} style={{padding:"2px 10px",borderRadius:99,border:"none",cursor:"pointer",fontSize:11,fontWeight:700,
                          background:isDone(s)?"#dcfce7":"#fef3c7",color:isDone(s)?"#15803d":"#b45309"}}>{isDone(s)?"✓ Done":"Pending"}</button>
                      </td>
                      <td style={{border:bd,padding:"5px 8px",textAlign:"center"}}>
                        <button onClick={()=>delPlan(s.id)} style={{border:"none",background:"transparent",color:"#dc2626",cursor:"pointer",fontWeight:800}}>×</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
        );
      })()}

      {signPad && (
        <SignPad title={signPad.title}
                 onSave={(url) => { signPad.apply(url); setSignPad(null); }}
                 onClose={() => setSignPad(null)} />
      )}

      {/* Per-point SPARES editor (Break Down Slip–style grid) — opens from a
          check point whose "SPARES USED" cell is set to Yes. */}
      {spareEdit && calSheet && (() => {
        const i = spareEdit.i;
        const pt = calSheet.points[i] || {};
        const inpS = { width:"100%", border:"1px solid #cbd5e1", borderRadius:6, padding:"6px 8px",
                       fontSize:12.5, fontFamily:"inherit", boxSizing:"border-box", outline:"none" };
        return (
          <div onClick={() => setSpareEdit(null)}
               style={{ position:"fixed", inset:0, background:"rgba(15,23,42,.5)", display:"grid",
                        placeItems:"center", zIndex:9999 }}>
            <div onClick={(e) => e.stopPropagation()}
                 style={{ background:"#fff", borderRadius:12, padding:18, width:"min(700px,94vw)",
                          maxHeight:"86vh", overflow:"auto", boxShadow:"0 20px 60px rgba(0,0,0,.35)" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
                <div style={{ fontWeight:800, fontSize:15, color:"#0f172a" }}>
                  Spares Used — Point {pt.s_no || (i + 1)}
                </div>
                <button onClick={() => setSpareEdit(null)}
                        style={{ border:"none", background:"transparent", fontSize:22, cursor:"pointer", color:"#64748b" }}>×</button>
              </div>
              <div style={{ fontSize:11.5, color:"#64748b", marginBottom:6 }}>{pt.check_point || ""}</div>
              <div style={{ fontSize:11.5, color:"#334155", marginBottom:12, fontWeight:600 }}>
                {calSheet.cp?.machine_no} · {calSheet.cp?.machine_name} — ye spares maintenance_spare me machine_no ke saath (source “PM”) save honge.
              </div>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12.5 }}>
                <thead><tr>{["Spare Name","Model No.","Spare ERP No.","Qty",""].map((h) =>
                  <th key={h} style={{ textAlign:"left", padding:"6px 6px", fontSize:10, fontWeight:800,
                                       color:"#64748b", borderBottom:"1px solid #e2e8f0", textTransform:"uppercase" }}>{h}</th>)}</tr></thead>
                <tbody>
                  {pointSpares(i).map((r, ri) => (
                    <tr key={ri}>
                      <td style={{ padding:"4px 4px" }}><input list="pm-spare-names" value={r.spare_name}
                          onChange={(e) => onSpareCell(i, ri, "spare_name", e.target.value)} style={inpS} /></td>
                      <td style={{ padding:"4px 4px" }}><input value={r.spare_model_no}
                          onChange={(e) => onSpareCell(i, ri, "spare_model_no", e.target.value)} style={inpS} /></td>
                      <td style={{ padding:"4px 4px" }}><input value={r.spare_cnmm_no} maxLength={8} placeholder="ABCD1234"
                          onChange={(e) => onSpareCell(i, ri, "spare_cnmm_no", fmtErp(e.target.value))} style={inpS} /></td>
                      <td style={{ padding:"4px 4px", width:72 }}><input value={r.spare_qty}
                          onChange={(e) => onSpareCell(i, ri, "spare_qty", e.target.value)} style={inpS} /></td>
                      <td style={{ padding:"4px 4px", width:34, textAlign:"center" }}>
                        <button onClick={() => delSpareRow(i, ri)} title="Remove"
                                style={{ border:"none", background:"transparent", color:"#dc2626", cursor:"pointer", fontWeight:800, fontSize:17 }}>×</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <datalist id="pm-spare-names">{spareMaster.map((s, k) => <option key={k} value={s.spare_name} />)}</datalist>
              <div style={{ display:"flex", justifyContent:"space-between", marginTop:14 }}>
                <button onClick={() => addSpareRow(i)}
                        style={{ border:"1px dashed #94a3b8", background:"#f8fafc", color:"#334155",
                                 borderRadius:8, padding:"7px 12px", fontWeight:700, cursor:"pointer" }}>+ Add spare</button>
                <button onClick={() => setSpareEdit(null)}
                        style={{ border:"none", background:"#1d4ed8", color:"#fff", borderRadius:8,
                                 padding:"7px 18px", fontWeight:800, cursor:"pointer" }}>Done</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
