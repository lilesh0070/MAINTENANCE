/* ───────────────────────────────────────────────────────────────────
 * MachineDMCAdmin.jsx — Maintenance Panel → Machine DMC
 * ───────────────────────────────────────────────────────────────────
 * Admin manager for the Daily Machine Check Sheet points (machine_dmc):
 *   • Check Points — pick zone → line → machine; ADD / EDIT / DELETE points
 *     on the CURRENT revision, and bump the revision (old points archived to
 *     machine_dmc_rev, viewable via the Revision dropdown).
 *   • View Sheet   — the machine's DMC sheet, read-only (shared DmcSheet).
 *   • Format       — Format No. / Rev No. / Rev Date shown at the sheet foot.
 *
 * Mirrors PMCheckSheetAdmin, adapted to the DMC data model (category /
 * criteria / method / resp / freq / type instead of judgement_standard).
 * The Machine DMC page always shows the CURRENT revision, so edits here
 * appear there immediately.
 * ─────────────────────────────────────────────────────────────────── */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { DmcSheet, DMC_CAT_ORDER, groupDmcPoints } from "./DmcSheet";

// RESP / FREQ / TYPE are not free text any more: each one drives real behaviour
//   resp → which stage (operator / line leader / maintenance) may fill the point
//   freq → the D / W / 2W / M schedule  (typing "Monthly" used to silently
//          classify as DAILY — the exact code is what freqClass understands)
//   type → ✓/✗ tick vs a typed numeric reading
// A value already on an old row is kept as an extra option so editing an
// unusual legacy point never rewrites it by accident.
const RESP_OPTS = ["OPERATOR", "LINE LEADER", "MAINTENANCE"];
const FREQ_OPTS = ["D", "W", "2W", "M"];
const TYPE_OPTS = ["ok", "value"];
const withCurrent = (opts, v) => (v && !opts.includes(v) ? [v, ...opts] : opts);


const EMPTY_ADD = { category: "Inspection", s_no: "", check_point: "", criteria: "", method: "", resp: "", freq: "", type: "" };

const WEEK_OF = (d) => (d <= 7 ? 1 : d <= 14 ? 2 : d <= 21 ? 3 : d <= 28 ? 4 : 5);

// Only data from MAINTENANCE-SIGNED weeks is final History data (a week can be
// signed only after the supervisor verified every date in it).
const signedWeeks = (weekMeta) => new Set(
  Object.entries(weekMeta || {})
    .filter(([, m]) => String((m || {}).status || "").toUpperCase() === "SIGNED")
    .map(([w]) => String(w)));
// A date is FINAL only if it is itself supervisor-VERIFIED *and* its week has
// been maintenance-SIGNED — both links of the chain, not just the week.
const finalDays = (dayMeta, weekMeta) => {
  const wk = signedWeeks(weekMeta);
  return new Set(Object.entries(dayMeta || {})
    .filter(([d, m]) => wk.has(String(WEEK_OF(parseInt(d, 10))))
                     && String((m || {}).status || "").toUpperCase() === "VERIFIED")
    .map(([d]) => String(d)));
};
// sign-off codes for the grid: per-day (operator / supervisor) + per-week (maintenance)
const fillDayCodes = (dayMeta, weekMeta) => {
  const ok = finalDays(dayMeta, weekMeta);
  const out = { operator: {}, supervisor: {} };
  Object.entries(dayMeta || {}).forEach(([d, m]) => {
    if (!ok.has(String(d))) return;
    if ((m || {}).operator_code)   out.operator[String(d)]   = m.operator_code;
    if ((m || {}).supervisor_code) out.supervisor[String(d)] = m.supervisor_code;
  });
  return out;
};
const fillWeekCodes = (weekMeta) => {
  const out = {};
  Object.entries(weekMeta || {}).forEach(([w, m]) => {
    if (String((m || {}).status || "").toUpperCase() === "SIGNED" && m.maintenance_code)
      out[String(w)] = m.maintenance_code;
  });
  return out;
};

// Build the DmcSheet `values` map from a saved fill's entries so a filled sheet
// renders (read-only) across the full monthly (31-day) format.  Dates still
// awaiting supervisor verification are left blank — History shows final data only.
const fillValues = (entries, dayMeta, weekMeta) => {
  const ok = finalDays(dayMeta, weekMeta);
  const v = {};
  (entries || []).forEach((e) => {
    const days = e.days || {};
    Object.keys(days).forEach((d) => { if (days[d] && ok.has(String(d))) v[`${e.id}_${d}`] = days[d]; });
  });
  return v;
};
// Same, for the ✗ reasons — so a Not-OK cell shows its reason on click.
const fillReasons = (entries, dayMeta, weekMeta) => {
  const ok = finalDays(dayMeta, weekMeta);
  const r = {};
  (entries || []).forEach((e) => {
    const rz = e.reasons || {};
    Object.keys(rz).forEach((d) => { if (rz[d] && ok.has(String(d))) r[`${e.id}_${d}`] = rz[d]; });
  });
  return r;
};
const _MON = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fillMonthLabel = (ym) => { if (!ym) return ""; const [y, m] = ym.split("-"); return `${_MON[parseInt(m, 10)] || m} ${y}`; };
// Financial year (Apr→Mar) that a YYYY-MM month belongs to, e.g. "2026-27".
const fyOf = (ym) => {
  if (!ym) return "";
  const [y, m] = ym.split("-").map((x) => parseInt(x, 10));
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String(start + 1).slice(2)}`;
};

export default function MachineDMCAdmin({ toast, readOnly = false }) {
  const { token, isAdmin } = useAuth();
  const api = useCallback(async (path, opts = {}) => {
    const r = await fetch(`/api/machine-dmc${path}`, {
      ...opts,
      headers: { "Content-Type": "application/json",
                 ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) },
    });
    if (!r.ok) { let m; try { m = JSON.parse(await r.text()).detail; } catch { m = null; }
      throw new Error(m || `HTTP ${r.status}`); }
    return r.json();
  }, [token]);
  const say = (msg, kind = "ok") => (toast ? toast(msg, kind) : alert(msg));

  const [tab, setTab] = useState("points");        // 'points' | 'viewsheet' | 'format'
  const [machines, setMachines] = useState([]);
  const [zone, setZone] = useState("");
  const [line, setLine] = useState("");
  const [mno, setMno]   = useState("");
  const [revs, setRevs] = useState({ current: null, history: [] });
  const [selRev, setSelRev] = useState("");         // "" = current
  const [points, setPoints] = useState([]);
  const [busy, setBusy]     = useState(false);
  // add-point form
  const [add, setAdd] = useState(EMPTY_ADD);
  const [pending, setPending] = useState([]);   // staged naye points — rev bump par hi commit
  // inline edit
  const [editId, setEditId]     = useState(null);
  const [editVals, setEditVals] = useState({});
  // rev bump — rev number AUTO (current+1); sirf date settable
  const [nrDate, setNrDate] = useState(() => new Date().toISOString().slice(0, 10));
  // ── Rev no./date theek karne ke khaane ───────────────────────────────
  // Machine ya revision badalte hi inme CHALU wali value bhar deta hoon —
  // taaki "kya laga hua hai" aur "kya lagana hai" ek hi jagah dikhe, aur
  // sirf wahi khaana chhedna pade jo galat hai.
  const [fixRev,    setFixRev]    = useState("");
  const [fixDate,   setFixDate]   = useState("");
  const [fixFilled, setFixFilled] = useState(false);
  // format doc-control
  const [fmtDoc, setFmtDoc] = useState({ format_no: "", rev_no: "", rev_date: "" });
  const [fmtSaving, setFmtSaving] = useState(false);
  // history
  const [histSheets, setHistSheets] = useState([]);
  const [histMonth, setHistMonth]   = useState("");   // History tab: filter filled sheets by month
  const [histFy, setHistFy]         = useState("");   // History tab: filter by financial year (Apr→Mar)
  const [viewFill, setViewFill]     = useState(null);   // opened filled sheet (full)
  const [revView, setRevView]       = useState(null);   // { rev_no, points } at a rev

  useEffect(() => {
    api(`/machines`).then((d) => setMachines(Array.isArray(d) ? d : [])).catch(() => {});
    api(`/format`).then((d) => {
      const df = (d && d.format && d.format.doc_footer) || {};
      setFmtDoc({ format_no: df.format_no || "", rev_no: df.rev_no || "", rev_date: df.rev_date || "" });
    }).catch(() => {});
  }, [api]);

  const zoneOpts = useMemo(() => [...new Set(machines.map((m) => m.zone).filter(Boolean))].sort(), [machines]);
  const lineOpts = useMemo(() => zone
    ? [...new Set(machines.filter((m) => m.zone === zone).map((m) => m.line).filter(Boolean))].sort() : [], [machines, zone]);
  const mcOpts = useMemo(() => (zone && line)
    ? machines.filter((m) => m.zone === zone && m.line === line && m.machine_no)
              .sort((a, b) => String(a.machine_no).localeCompare(String(b.machine_no))) : [], [machines, zone, line]);
  const mcSel = mcOpts.find((m) => String(m.machine_no) === String(mno)) || null;

  const loadRevs = useCallback(() => {
    if (!mno) { setRevs({ current: null, history: [] }); return; }
    api(`/revs?zone=${encodeURIComponent(zone)}&line=${encodeURIComponent(line)}&machine_no=${encodeURIComponent(mno)}`)
      .then((d) => setRevs(d || { current: null, history: [] })).catch(() => setRevs({ current: null, history: [] }));
  }, [api, zone, line, mno]);

  const loadPoints = useCallback(() => {
    if (!mno) { setPoints([]); return; }
    const q = `zone=${encodeURIComponent(zone)}&line=${encodeURIComponent(line)}&machine_no=${encodeURIComponent(mno)}` +
              (selRev ? `&rev_no=${encodeURIComponent(selRev)}` : "");
    api(`/points?${q}`).then((d) => setPoints(d.points || [])).catch(() => setPoints([]));
  }, [api, zone, line, mno, selRev]);

  useEffect(() => { setSelRev(""); setEditId(null); loadRevs(); }, [loadRevs]);
  useEffect(() => { setEditId(null); loadPoints(); }, [loadPoints]);

  useEffect(() => {   // History tab: filled sheets for the picked machine
    if (tab !== "history" || !mno) { setHistSheets([]); return; }
    const q = `zone=${encodeURIComponent(zone)}&line=${encodeURIComponent(line)}&machine_no=${encodeURIComponent(mno)}`;
    api(`/check-sheet-fills?${q}`).then((d) => setHistSheets(d.rows || [])).catch(() => setHistSheets([]));
  }, [api, tab, zone, line, mno]);

  // open a filled sheet + the corrective actions recorded against its ✗ points,
  // so the reason popup can show "reason + action taken".
  const openFill = async (id) => {
    try {
      const fill = await api(`/check-sheet-fill/${id}`);
      let acts = {};
      try {
        const q = `zone=${encodeURIComponent(fill.zone_name)}&line=${encodeURIComponent(fill.line_name)}`
                + `&machine_no=${encodeURIComponent(fill.machine_no)}&month=${encodeURIComponent(fill.sheet_month)}`;
        const ng = await api(`/ng-points?${q}`);
        (ng.rows || []).forEach((r) => {
          if (r.action_taken) acts[`${r.point_id}_${parseInt(String(r.ng_date).slice(8, 10), 10)}`] = r.action_taken;
        });
      } catch { acts = {}; }
      setViewFill({ ...fill, _actions: acts });
    } catch (e) { say(String(e.message || e), "err"); }
  };
  const openRevPoints = (rno) => {
    const q = `zone=${encodeURIComponent(zone)}&line=${encodeURIComponent(line)}&machine_no=${encodeURIComponent(mno)}` +
              (rno ? `&rev_no=${encodeURIComponent(rno)}` : "");
    api(`/points?${q}`).then((d) => setRevView({ rev_no: rno || (revs.current?.rev_no || ""), points: d.points || [] }))
      .catch((e) => say(String(e.message || e), "err"));
  };

  const onZone = (v) => { setZone(v); setLine(""); setMno(""); };
  const onLine = (v) => { setLine(v); setMno(""); };
  const isCurrent = !selRev || (revs.current && String(selRev) === String(revs.current.rev_no));
  const canEdit = !readOnly && isCurrent && !!mno;

  // Naya point SEEDHE save nahi hota — pehle "pending" me stage hota hai, aur
  // rev bump (Update Revision) par hi commit hota hai.  Bina rev bump ke chhod
  // do to (reload/page change par) ye hat jaata hai.
  const addPoint = () => {
    if (!add.check_point.trim()) { say("Check point required", "err"); return; }
    setPending((ps) => [...ps, { ...add, machine_name: mcSel?.machine_name || "" }]);
    setAdd(EMPTY_ADD);
    say("Point staged — saved only when you update the revision");
  };
  const removePending = (i) => setPending((ps) => ps.filter((_, x) => x !== i));

  // Bump tabhi chalu ho jab SACH ME kuch badla ho.  Pehle wo hamesha dabta
  // tha, isliye galti se khali revision chadh jaati thi — wahi wajah thi ki
  // step-down banana pada.  Naye point `pending` me dikh jaate hain; edit aur
  // delete turant lag jaate hain, isliye unke liye ye nishaan rakhte hain.
  const [touched, setTouched] = useState(false);
  const revChanged = pending.length > 0 || touched;
  // MACHINE BADLE TO SAAF: pehle staged points machine badalne par bhi pade
  // rehte the — yaani machine A par jodа point machine B par save ho jaata
  // (galat sheet par galat point), aur bump wahan bina wajah chalu dikhta.
  useEffect(() => { setPending([]); setTouched(false); }, [zone, line, mno]);


  const startEdit = (p) => {
    setEditId(p.id);
    setEditVals({ category: p.category || "", s_no: p.s_no || "", check_point: p.check_point || "",
                  criteria: p.criteria || "", method: p.method || "", resp: p.resp || "",
                  freq: p.freq || "", type: p.type || "" });
  };
  const saveEdit = async () => {
    if (!editVals.check_point.trim()) { say("Check point required", "err"); return; }
    setBusy(true);
    try {
      await api(`/points/${editId}`, { method: "PUT", body: JSON.stringify(editVals) });
      setEditId(null); setTouched(true); say("Point updated ✓"); loadPoints();
    } catch (e) { say(String(e.message || e), "err"); }
    finally { setBusy(false); }
  };

  const delPoint = async (p) => {
    if (!window.confirm(`Delete point ${p.s_no}?\n"${(p.check_point || "").slice(0, 60)}"`)) return;
    try { await api(`/points/${p.id}`, { method: "DELETE" }); setTouched(true); say("Point deleted"); loadPoints(); loadRevs(); }
    catch (e) { say(String(e.message || e), "err"); }
  };

  // ── Chalu revision HATAO — pichhli wapas chalu ho jaye (admin only) ─
  // Ye bump ka ulta hai.  Number badalne se "Rev 2 hataana" hota nahi tha —
  // uska naam badal jaata aur points wahi ke wahi rehte.  Yahan Rev 2 sach me
  // chala jaata hai aur Rev 1 hu-ba-hu wapas aa jaati hai.  Ek baar me ek
  // kadam, aur sabse purani revision kabhi nahi hatti.
  const prevRev = () => {
    const cur = String(revs.current?.rev_no ?? "");
    const old = (revs.history || []).filter((h) => String(h.rev_no) !== cur);
    if (!old.length) return null;
    return old.reduce((a, b) => (parseInt(a.rev_no, 10) >= parseInt(b.rev_no, 10) ? a : b));
  };
  // Chalu revision badle (ya machine badle) to khaane phir se bhar do.
  useEffect(() => {
    setFixRev(String(revs.current?.rev_no ?? ""));
    setFixDate(String(revs.current?.rev_date ?? "").slice(0, 10));
    setFixFilled(false);
    // `revs` poora dep me hai (sirf uske do khaane nahi) -- eslint ka niyam
    // yahi maangta hai, aur yahan sahi bhi hai: `revs` tabhi badalta hai jab
    // machine badle ya save ke baad dobara load ho.  Dono soorat me khaane
    // phir se bharna hi chahiye.  Koi polling nahi hai, isliye type karte
    // waqt ye beech me nahi chalega.
  }, [revs, mno]);

  // Sirf LABEL theek karna — points ko haath nahi lagta, na koi revision
  // banti/hatti hai.  (Bump aur stepdown se farak neeche wale card par
  // saaf likha hai.)
  const setRevNow = async () => {
    const cur = revs.current;
    const rn  = String(fixRev || "").trim();
    const rd  = String(fixDate || "").trim();
    const curRev  = String(cur?.rev_no ?? "");
    const curDate = String(cur?.rev_date ?? "").slice(0, 10);
    if (!rn || !rd) { say("Enter both the revision number and the revision date", "err"); return; }
    if (rn === curRev && rd === curDate) {
      say("That is already the current revision — nothing to change", "err"); return;
    }
    if (!window.confirm([
      "Correct this machine's revision label?", "",
      `   Rev ${curRev} (${curDate})   →   Rev ${rn} (${rd})`, "",
      `• ${cur?.count ?? "?"} check point(s) get the new label — none are added, changed or removed`,
      "• No new revision is created and nothing is archived",
      fixFilled
        ? `• Filled check sheets on Rev ${curRev} WILL also be re-stamped`
        : `• Filled check sheets keep Rev ${curRev} — that is the record for that day`,
    ].join("\n"))) return;
    setBusy(true);
    try {
      const r = await api(`/rev-set`, { method: "PUT", body: JSON.stringify({
        zone, line, machine_no: mno, rev_no: rn, rev_date: rd, restamp_filled: fixFilled }) });
      say(`Rev ${r.old_rev} → Rev ${r.new_rev} ✓ — ${r.points} check point(s) re-stamped` +
          (r.filled_restamped ? `, ${r.filled_restamped} filled sheet(s) updated` : "") +
          (r.filled_left ? ` · ${r.filled_left} filled sheet(s) still on Rev ${r.old_rev}` : ""));
      loadRevs(); loadPoints();
    } catch (e) { say(String(e.message || e), "err"); }
    finally { setBusy(false); }
  };

  const stepDownRev = async () => {
    const p = prevRev();
    if (!p) return;
    const cur = revs.current;
    const l1 = `• The ${cur?.count ?? "?"} points of Rev ${cur?.rev_no} will be REMOVED`;
    const l2 = `• Rev ${p.rev_no} (${p.count ?? "?"} points) will be restored exactly as it was`;
    const l3 = `Filled check sheets will still show Rev ${cur?.rev_no} — that is the record for that day.`;
    if (!window.confirm([`Remove Rev ${cur?.rev_no}?`, "", l1, l2, "", l3].join("\n"))) return;
    setBusy(true);
    try {
      const r = await api(`/rev-stepdown`, { method: "PUT", body: JSON.stringify({
        zone, line, machine_no: mno }) });
      say(`Rev ${r.removed_rev} removed ✓ Rev ${r.now_current} is now current (${r.restored_points} points)` +
          (r.filled_sheets_on_removed_rev ? ` — note: Rev ${r.removed_rev} has ${r.filled_sheets_on_removed_rev} filled sheet(s)` : ""));
      loadRevs(); loadPoints();
    } catch (e) { say(String(e.message || e), "err"); }
    finally { setBusy(false); }
  };

  const bumpRev = async () => {
    const nxt = parseInt(revs.current?.rev_no || "0", 10) + 1;   // AUTO — rev khud current + 1
    const q = pending.length
      ? `Save ${pending.length} new point(s) as Rev ${nxt}?\nThe current points will be archived as Rev ${revs.current?.rev_no || 0}.`
      : `Bump the revision only, Rev ${revs.current?.rev_no || 0} → Rev ${nxt}? (no new points)`;
    if (!window.confirm(q)) return;
    setBusy(true);
    try {
      // rev_no khaali bhejte hain → backend khud current+1 karta (single source of truth)
      const r = await api(`/rev`, { method: "PUT", body: JSON.stringify({
        zone, line, machine_no: mno, rev_no: "", rev_date: nrDate || "", new_points: pending }) });
      say(`Rev ${r.new_rev} ✓ — ${r.added_points || 0} new point(s) added${r.old_rev ? `, Rev ${r.old_rev} archived` : ""}`);
      setPending([]); setTouched(false); setSelRev(""); loadRevs(); loadPoints();
    } catch (e) { say(String(e.message || e), "err"); }
    finally { setBusy(false); }
  };

  const saveFmtDoc = async () => {
    setFmtSaving(true);
    try {
      await api(`/format-doc`, { method: "PUT", body: JSON.stringify(fmtDoc) });
      say("Format No. updated ✓ — shows at the foot of the sheet");
    } catch (e) { say(String(e.message || e), "err"); }
    finally { setFmtSaving(false); }
  };

  // ── styles (match PMCheckSheetAdmin) ──
  const card = { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 16 };
  const bd = "1px solid #cbd5e1";
  const sel = { padding: "8px 10px", borderRadius: 8, border: bd, fontSize: 13, fontWeight: 600, minWidth: 170, background: "#fff" };
  const label = { fontSize: 10.5, fontWeight: 800, color: "#64748b", marginBottom: 4 };
  const sb = "1px solid #000";
  const sth = { border: sb, padding: "5px 6px", fontSize: 10.5, fontWeight: 800, background: "#f3f4f6", textAlign: "center" };
  const inp = { width: "100%", boxSizing: "border-box", border: "none", outline: "none", background: "#fffbeb", fontSize: 12, padding: "5px 6px", fontFamily: "inherit" };
  const cellTxt = { border: sb, fontSize: 11, padding: "3px 6px", verticalAlign: "top" };
  const iconBtn = (color) => ({ border: "none", background: "transparent", color, cursor: "pointer", fontWeight: 800, fontSize: 14 });
  const tdc = { border: bd, padding: "6px 10px", fontSize: 12, color: "#334155" };
  const viewBtn = { padding: "4px 12px", borderRadius: 6, border: bd, background: "#fff", cursor: "pointer", fontSize: 11.5, fontWeight: 700, color: "#2563eb" };
  const modalOverlay = { position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 600, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "30px 16px", overflowY: "auto" };
  const modalHead = { display: "flex", justifyContent: "space-between", alignItems: "center", background: "#fff", borderRadius: "10px 10px 0 0", padding: "10px 16px", borderBottom: "1px solid #e2e8f0", fontSize: 13, color: "#0f172a" };
  const closeBtn = { border: "none", background: "transparent", color: "#64748b", cursor: "pointer", fontWeight: 800, fontSize: 14 };

  // category <select> — standard 4 + whatever value the row already holds
  const catOptions = (v) => {
    const opts = [...DMC_CAT_ORDER];
    if (v && !opts.includes(v)) opts.push(v);
    return opts;
  };

  const fyOpts = [...new Set(histSheets.map((s) => fyOf(s.sheet_month)).filter(Boolean))].sort().reverse();
  const shownSheets = histSheets.filter((s) =>
    (!histFy || fyOf(s.sheet_month) === histFy) &&
    (!histMonth || String(s.sheet_month) === histMonth));

  const machinePicker = (
    <div style={{ ...card, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
      <div><div style={label}>ZONE</div>
        <select style={sel} value={zone} onChange={(e) => onZone(e.target.value)}>
          <option value="">— zone —</option>
          {zoneOpts.map((z) => <option key={z} value={z}>{z}</option>)}
        </select></div>
      <div><div style={label}>LINE</div>
        <select style={sel} value={line} onChange={(e) => onLine(e.target.value)} disabled={!zone}>
          <option value="">— line —</option>
          {lineOpts.map((l) => <option key={l} value={l}>{l}</option>)}
        </select></div>
      <div><div style={label}>MACHINE NO</div>
        <select style={{ ...sel, minWidth: 180 }} value={mno} onChange={(e) => setMno(e.target.value)} disabled={!line}>
          <option value="">— machine no —</option>
          {mcOpts.map((m) => <option key={m.machine_no} value={m.machine_no}>{m.machine_no}</option>)}
        </select></div>
      <div><div style={label}>MACHINE NAME</div>
        <input readOnly value={mcSel?.machine_name || ""} placeholder="— auto —"
               style={{ ...sel, minWidth: 230, background: "#f8fafc", color: "#334155", cursor: "default" }} /></div>
      {tab === "history" && (
        <div><div style={label}>FINANCIAL YEAR</div>
          <select style={{ ...sel, minWidth: 140 }} value={histFy} onChange={(e) => setHistFy(e.target.value)}>
            <option value="">— all FY —</option>
            {fyOpts.map((f) => <option key={f} value={f}>FY {f}</option>)}
          </select></div>
      )}
      {tab === "history" && (
        <div><div style={label}>MONTH</div>
          <input type="month" style={{ ...sel, minWidth: 150 }} value={histMonth} onChange={(e) => setHistMonth(e.target.value)} /></div>
      )}
      {tab === "points" && mno && revs.current && (
        <div><div style={label}>REVISION</div>
          <select style={{ ...sel, minWidth: 210, borderColor: isCurrent ? "#16a34a" : "#d97706" }}
                  value={selRev} onChange={(e) => setSelRev(e.target.value)}>
            <option value="">Current — Rev {revs.current.rev_no} ({revs.current.rev_date})</option>
            {revs.history.filter((h) => String(h.rev_no) !== String(revs.current.rev_no)).map((h) => (
              <option key={h.rev_no} value={h.rev_no}>Old — Rev {h.rev_no} ({h.rev_date}) · {h.count} points</option>
            ))}
          </select></div>
      )}
      {mno && (
        <span style={{ fontSize: 12, fontWeight: 800, color: isCurrent ? "#16a34a" : "#b45309" }}>
          {points.length} points{tab === "points" ? (isCurrent ? " · current (editable)" : " · old revision (read-only)") : " · read-only"}
        </span>
      )}
    </div>
  );

  const colCount = canEdit ? 9 : 8;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* tab switch */}
      <div style={{ display: "flex", gap: 8 }}>
        {[["points", "📋 Check Points"], ["viewsheet", "👁 View Sheet"], ["format", "📄 Format"], ["history", "🕘 History"]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            style={{ padding: "9px 20px", borderRadius: 9,
                     border: "1px solid " + (tab === k ? "#7c3aed" : "#cbd5e1"),
                     background: tab === k ? "#7c3aed" : "#fff",
                     color: tab === k ? "#fff" : "#475569",
                     fontWeight: 800, fontSize: 13, cursor: "pointer" }}>{l}</button>
        ))}
      </div>

      {/* ── FORMAT tab ── */}
      {tab === "format" && (
        <div style={{ ...card, borderLeft: "4px solid #7c3aed" }}>
          <div style={{ fontWeight: 800, fontSize: 13, color: "#0f172a", marginBottom: 10 }}>
            📄 DMC Check Sheet Format — Document Control <span style={{ fontWeight: 600, color: "#94a3b8" }}>(shows at the bottom of every DMC sheet)</span>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div><div style={label}>FORMAT NO.</div>
              <input style={{ ...sel, minWidth: 220 }} value={fmtDoc.format_no}
                     onChange={(e) => setFmtDoc((s) => ({ ...s, format_no: e.target.value }))}
                     placeholder="TBDI / MAINT. / F / 0XX" disabled={readOnly} /></div>
            <div><div style={label}>REV. NO.</div>
              <input style={{ ...sel, minWidth: 90 }} value={fmtDoc.rev_no}
                     onChange={(e) => setFmtDoc((s) => ({ ...s, rev_no: e.target.value }))}
                     placeholder="00" disabled={readOnly} /></div>
            <div><div style={label}>REV. DATE</div>
              <input style={{ ...sel, minWidth: 150 }} value={fmtDoc.rev_date}
                     onChange={(e) => setFmtDoc((s) => ({ ...s, rev_date: e.target.value }))}
                     placeholder="20/3/2024" disabled={readOnly} /></div>
            {!readOnly && (
              <button onClick={saveFmtDoc} disabled={fmtSaving}
                      style={{ padding: "9px 18px", borderRadius: 8, border: "none", background: "#7c3aed", color: "#fff", fontWeight: 800, fontSize: 13, cursor: "pointer" }}>
                {fmtSaving ? "…" : "💾 Save Format No."}</button>
            )}
          </div>
        </div>
      )}

      {/* ── VIEW SHEET tab ── */}
      {tab === "viewsheet" && (<>
        {machinePicker}
        {!mno ? (
          <div style={{ ...card, textAlign: "center", color: "#64748b", padding: 40 }}>
            Select zone → line → machine no to open that machine's DMC sheet (read-only).
          </div>
        ) : points.length === 0 ? (
          <div style={{ ...card, textAlign: "center", color: "#94a3b8", padding: 40 }}>No DMC check points for this machine.</div>
        ) : (
          <DmcSheet printable groups={groupDmcPoints(points)} footer={fmtDoc} signGrid
                    hdr={{ zone, line, machine_no: mno, machine_name: mcSel?.machine_name || "",
                           rev_no: revs.current?.rev_no, rev_date: revs.current?.rev_date }} />
        )}
      </>)}

      {/* ── CHECK POINTS tab ── */}
      {tab === "points" && (<>
        {machinePicker}

        {/* rev bump — rev number AUTO current+1 (manual type nahi) */}
        {canEdit && (
          <div style={{ ...card, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", borderLeft: "4px solid #2563eb" }}>
            <div style={{ fontWeight: 800, fontSize: 13, color: "#0f172a", alignSelf: "center" }}>
              ↑ Save Revision — <span style={{ color: "#2563eb" }}>Rev {revs.current?.rev_no ?? "—"}</span>
              {" → "}<span style={{ color: "#16a34a" }}>Rev {parseInt(revs.current?.rev_no || "0", 10) + 1}</span>
              <span style={{ fontWeight: 600, color: "#94a3b8" }}> (auto)</span>
            </div>
            <div><div style={label}>REV DATE</div>
              <input type="date" value={nrDate} onChange={(e) => setNrDate(e.target.value)} style={{ ...sel, minWidth: 150 }} /></div>
            <button onClick={bumpRev} disabled={busy || !revChanged}
                    title={revChanged ? "" : "Add, edit or delete a point first — nothing has changed to save"}
                    style={{ padding: "9px 18px", borderRadius: 8, border: "none",
                             background: revChanged ? "#2563eb" : "#cbd5e1",
                             color: revChanged ? "#fff" : "#64748b",
                             fontWeight: 800, fontSize: 13,
                             cursor: revChanged ? "pointer" : "not-allowed" }}>
              {busy ? "…" : (pending.length
                ? `Save ${pending.length} point → Rev ${parseInt(revs.current?.rev_no || "0", 10) + 1}`
                : `Bump to Rev ${parseInt(revs.current?.rev_no || "0", 10) + 1}`)}</button>
            <span style={{ fontSize: 11, color: revChanged ? "#94a3b8" : "#b45309", fontWeight: revChanged ? 400 : 700 }}>
              {revChanged
                ? "The revision auto-increments by 1; the old one is archived and shown in the Revision dropdown."
                : "Add, edit or delete a point first — nothing has changed to save."}
            </span>
          </div>
        )}

        {/* ── Rev number theek karo — SIRF ADMIN ──────────────────────────
            Upar wala bump rev aage badhata hai aur purane points archive karta
            hai.  Ye uske liye hai jab rev GALAT chadh gayi ho — number/date
            seedha theek kar dete hain, points ko chhue bina. */}
        {isAdmin && mno && isCurrent && prevRev() && (
        <div style={{ ...card, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center",
                      borderLeft: "4px solid #b45309", background: "#fffbeb" }}>
          <div style={{ fontWeight: 800, fontSize: 12.5, color: "#92400e" }}>
            Wrong revision applied? Remove <b>Rev {revs.current?.rev_no}</b> and bring back{" "}
            <b>Rev {prevRev()?.rev_no}</b> as the current revision.
          </div>
          <button onClick={stepDownRev} disabled={busy}
                  style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "#b45309",
                           color: "#fff", fontWeight: 800, fontSize: 12.5, cursor: "pointer" }}>
            {busy ? "…" : `Remove Rev ${revs.current?.rev_no} → Rev ${prevRev()?.rev_no}`}</button>
          <span style={{ fontSize: 11, color: "#b45309", opacity: .85, lineHeight: 1.5 }}>
            Admin only. One step at a time — press again to go back one more.
            The oldest revision is never removed.
          </span>
        </div>
      )}

        {/* ── Rev no./date SEEDHA theek karo — SIRF ADMIN ──────────────────
            Upar wale do khaane revision ko AAGE (bump) ya PEECHHE (stepdown)
            le jaate hain.  Ye teesra uske liye hai jab revision khud sahi ho
            par uspar laga LABEL galat ho — jaise shuruat me har machine par
            JAAN-BOOJHKAR Rev 0 daal diya gaya tha, kyunki asli number tab
            haath me nahi the.  Bump se ye kaam nahi hota: wo number 1 aage
            badha dega aur ek jhootha archive bhi bana dega.
            Yahan points ko haath nahi lagta — sirf label badalta hai. */}
        {isAdmin && mno && isCurrent && (
          <div style={{ ...card, borderLeft: "4px solid #7c3aed", background: "#faf5ff" }}>
            <div style={{ fontWeight: 800, fontSize: 13, color: "#5b21b6", marginBottom: 3 }}>
              Correct the revision number / date
            </div>
            <div style={{ fontSize: 11.5, color: "#6b21a8", opacity: .9, lineHeight: 1.5, marginBottom: 11 }}>
              Use this when the points are right but the label is wrong. It only
              re-stamps this machine's {revs.current?.count ?? "—"} check point(s) —
              nothing is added, archived or removed.
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div>
                <div style={label}>CURRENT</div>
                <div style={{ ...sel, minWidth: 150, background: "#f1f5f9", color: "#475569",
                              display: "flex", alignItems: "center" }}>
                  Rev {revs.current?.rev_no ?? "—"} ({String(revs.current?.rev_date ?? "—").slice(0, 10)})
                </div>
              </div>
              <div style={{ alignSelf: "center", fontSize: 18, color: "#a78bfa", fontWeight: 800,
                            paddingBottom: 6 }}>→</div>
              <div><div style={label}>NEW REV NO</div>
                <input value={fixRev} onChange={(e) => setFixRev(e.target.value)}
                       placeholder="e.g. 2" inputMode="numeric"
                       style={{ ...sel, minWidth: 100 }} /></div>
              <div><div style={label}>NEW REV DATE</div>
                <input type="date" value={fixDate} onChange={(e) => setFixDate(e.target.value)}
                       style={{ ...sel, minWidth: 150 }} /></div>
              <button onClick={setRevNow} disabled={busy}
                      style={{ padding: "9px 18px", borderRadius: 8, border: "none",
                               background: "#7c3aed", color: "#fff", fontWeight: 800,
                               fontSize: 13, cursor: busy ? "not-allowed" : "pointer" }}>
                {busy ? "…" : "Update revision"}</button>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 11,
                            fontSize: 11.5, color: "#6b21a8", fontWeight: 700, cursor: "pointer" }}>
              <input type="checkbox" checked={fixFilled}
                     onChange={(e) => setFixFilled(e.target.checked)} />
              Also re-stamp filled check sheets that carry the old revision
              <span style={{ fontWeight: 500, opacity: .8 }}>
                — leave this off unless the old label was wrong on those sheets too;
                a filled sheet is the record of the day it was filled.
              </span>
            </label>
            <div style={{ fontSize: 11, color: "#7c3aed", opacity: .8, marginTop: 7, lineHeight: 1.5 }}>
              Admin only. A number already used in this machine's revision history
              is refused — two revisions cannot share one number.
            </div>
          </div>
        )}

        {canEdit && pending.length > 0 && (
          <div style={{ ...card, borderLeft: "4px solid #d97706", background: "#fffbeb", color: "#92400e", fontSize: 12.5, fontWeight: 700, lineHeight: 1.5 }}>
            ⚠ {pending.length} new point(s) <b>PENDING</b> — press <b>Save … → Rev {parseInt(revs.current?.rev_no || "0", 10) + 1}</b> above to save them under the new revision number.
            If you leave or reload the page without saving, they will be <b>lost</b>.
          </div>
        )}

        {!mno ? (
          <div style={{ ...card, textAlign: "center", color: "#64748b", padding: 40 }}>
            Select zone → line → machine to open its check points.
          </div>
        ) : (
          <div style={{ background: "#fff", boxShadow: "0 4px 16px rgba(0,0,0,.12)", padding: 10, color: "#111827" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", minWidth: 1000, borderCollapse: "collapse", tableLayout: "fixed" }}>
                <colgroup>
                  <col style={{ width: "5%" }} /><col style={{ width: "13%" }} /><col style={{ width: "26%" }} />
                  <col style={{ width: "18%" }} /><col style={{ width: "14%" }} /><col style={{ width: "8%" }} />
                  <col style={{ width: "6%" }} /><col style={{ width: "6%" }} />{canEdit && <col style={{ width: "8%" }} />}
                </colgroup>
                <thead><tr>
                  <th style={sth}>S.NO.</th><th style={sth}>CATEGORY</th><th style={sth}>CHECK POINT / DETAIL OF WORK</th>
                  <th style={sth}>CRITERIA</th><th style={sth}>METHOD</th><th style={sth}>RESP</th>
                  <th style={sth}>FREQ</th><th style={sth}>TYPE</th>
                  {canEdit && <th style={{ ...sth, background: "#fee2e2" }}>ACTION</th>}
                </tr></thead>
                <tbody>
                  {points.map((p, i) => (editId === p.id ? (
                    /* edit row */
                    <tr key={p.id} style={{ background: "#fffbeb" }}>
                      <td style={{ border: sb, padding: 0 }}><input style={{ ...inp, textAlign: "center" }} value={editVals.s_no} onChange={(e) => setEditVals((s) => ({ ...s, s_no: e.target.value }))} /></td>
                      <td style={{ border: sb, padding: 0 }}>
                        <select style={{ ...inp }} value={editVals.category} onChange={(e) => setEditVals((s) => ({ ...s, category: e.target.value }))}>
                          {catOptions(editVals.category).map((c) => <option key={c} value={c}>{c}</option>)}
                        </select></td>
                      <td style={{ border: sb, padding: 0 }}><input style={inp} value={editVals.check_point} onChange={(e) => setEditVals((s) => ({ ...s, check_point: e.target.value }))} /></td>
                      <td style={{ border: sb, padding: 0 }}><input style={inp} value={editVals.criteria} onChange={(e) => setEditVals((s) => ({ ...s, criteria: e.target.value }))} /></td>
                      <td style={{ border: sb, padding: 0 }}><input style={inp} value={editVals.method} onChange={(e) => setEditVals((s) => ({ ...s, method: e.target.value }))} /></td>
                      <td style={{ border: sb, padding: 0 }}><select style={{ ...inp }} value={editVals.resp} onChange={(e) => setEditVals((s) => ({ ...s, resp: e.target.value }))}>{withCurrent(RESP_OPTS, editVals.resp).map((o) => <option key={o} value={o}>{o}</option>)}</select></td>
                      <td style={{ border: sb, padding: 0 }}><select style={{ ...inp }} value={editVals.freq} onChange={(e) => setEditVals((s) => ({ ...s, freq: e.target.value }))}>{withCurrent(FREQ_OPTS, editVals.freq).map((o) => <option key={o} value={o}>{o}</option>)}</select></td>
                      <td style={{ border: sb, padding: 0 }}><select style={{ ...inp }} value={editVals.type} onChange={(e) => setEditVals((s) => ({ ...s, type: e.target.value }))}>{withCurrent(TYPE_OPTS, editVals.type).map((o) => <option key={o} value={o}>{o}</option>)}</select></td>
                      <td style={{ border: sb, textAlign: "center", whiteSpace: "nowrap" }}>
                        <button onClick={saveEdit} disabled={busy} style={iconBtn("#16a34a")} title="Save">✔</button>
                        <button onClick={() => setEditId(null)} style={iconBtn("#64748b")} title="Cancel">✕</button>
                      </td>
                    </tr>
                  ) : (
                    /* display row */
                    <tr key={p.id ?? i}>
                      <td style={{ ...cellTxt, textAlign: "center" }}>{p.s_no || i + 1}</td>
                      <td style={cellTxt}>{p.category}</td>
                      <td style={cellTxt}>{p.check_point}</td>
                      <td style={cellTxt}>{p.criteria}</td>
                      <td style={cellTxt}>{p.method}</td>
                      <td style={{ ...cellTxt, textAlign: "center" }}>{p.resp}</td>
                      <td style={{ ...cellTxt, textAlign: "center", fontWeight: 700 }}>{p.freq}</td>
                      <td style={{ ...cellTxt, textAlign: "center" }}>{p.type}</td>
                      {canEdit && (
                        <td style={{ border: sb, textAlign: "center", whiteSpace: "nowrap" }}>
                          <button onClick={() => startEdit(p)} style={iconBtn("#2563eb")} title="Edit point">✎</button>
                          <button onClick={() => delPoint(p)} style={iconBtn("#dc2626")} title="Delete point">🗑</button>
                        </td>
                      )}
                    </tr>
                  )))}
                  {/* staged (pending) naye points — rev bump par commit honge */}
                  {pending.map((p, i) => (
                    <tr key={`pending-${i}`} style={{ background: "#fef9c3" }}>
                      <td style={{ ...cellTxt, textAlign: "center", color: "#a16207", fontWeight: 800 }}>new</td>
                      <td style={cellTxt}>{p.category}</td>
                      <td style={cellTxt}>{p.check_point}
                        <span style={{ fontSize: 9.5, fontWeight: 800, color: "#92400e", background: "#fde68a", borderRadius: 4, padding: "1px 5px", marginLeft: 5 }}>PENDING</span></td>
                      <td style={cellTxt}>{p.criteria}</td>
                      <td style={cellTxt}>{p.method}</td>
                      <td style={{ ...cellTxt, textAlign: "center" }}>{p.resp}</td>
                      <td style={{ ...cellTxt, textAlign: "center", fontWeight: 700 }}>{p.freq}</td>
                      <td style={{ ...cellTxt, textAlign: "center" }}>{p.type}</td>
                      {canEdit && (
                        <td style={{ border: sb, textAlign: "center" }}>
                          <button onClick={() => removePending(i)} style={iconBtn("#dc2626")} title="Remove from pending">🗑</button>
                        </td>
                      )}
                    </tr>
                  ))}
                  {points.length === 0 && pending.length === 0 && (
                    <tr><td colSpan={colCount} style={{ border: sb, padding: 20, textAlign: "center", color: "#94a3b8", fontSize: 12 }}>No points.</td></tr>
                  )}
                  {/* add-point row */}
                  {canEdit && (
                    <tr style={{ background: "#fffbeb" }}>
                      <td style={{ border: sb, padding: 0 }}><input style={{ ...inp, textAlign: "center" }} placeholder="auto" value={add.s_no} onChange={(e) => setAdd((s) => ({ ...s, s_no: e.target.value }))} /></td>
                      <td style={{ border: sb, padding: 0 }}>
                        <select style={{ ...inp }} value={add.category} onChange={(e) => setAdd((s) => ({ ...s, category: e.target.value }))}>
                          {catOptions(add.category).map((c) => <option key={c} value={c}>{c}</option>)}
                        </select></td>
                      <td style={{ border: sb, padding: 0 }}><input style={inp} placeholder="New check point / detail of work…" value={add.check_point} onChange={(e) => setAdd((s) => ({ ...s, check_point: e.target.value }))} /></td>
                      <td style={{ border: sb, padding: 0 }}><input style={inp} placeholder="Criteria" value={add.criteria} onChange={(e) => setAdd((s) => ({ ...s, criteria: e.target.value }))} /></td>
                      <td style={{ border: sb, padding: 0 }}><input style={inp} placeholder="Method" value={add.method} onChange={(e) => setAdd((s) => ({ ...s, method: e.target.value }))} /></td>
                      <td style={{ border: sb, padding: 0 }}><select style={{ ...inp }} value={add.resp} onChange={(e) => setAdd((s) => ({ ...s, resp: e.target.value }))}><option value="">Resp…</option>{withCurrent(RESP_OPTS, add.resp).map((o) => <option key={o} value={o}>{o}</option>)}</select></td>
                      <td style={{ border: sb, padding: 0 }}><select style={{ ...inp }} value={add.freq} onChange={(e) => setAdd((s) => ({ ...s, freq: e.target.value }))}><option value="">Freq…</option>{withCurrent(FREQ_OPTS, add.freq).map((o) => <option key={o} value={o}>{o}</option>)}</select></td>
                      <td style={{ border: sb, padding: 0 }}><select style={{ ...inp }} value={add.type} onChange={(e) => setAdd((s) => ({ ...s, type: e.target.value }))}><option value="">Type…</option>{withCurrent(TYPE_OPTS, add.type).map((o) => <option key={o} value={o}>{o}</option>)}</select></td>
                      <td style={{ border: sb, textAlign: "center", padding: 2 }}>
                        <button onClick={addPoint} disabled={busy}
                                style={{ padding: "4px 10px", borderRadius: 6, border: "none", background: "#16a34a", color: "#fff", fontWeight: 800, fontSize: 12, cursor: "pointer" }}>
                          + Add</button>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </>)}

      {/* ── HISTORY tab: filled sheets + check-point revisions ── */}
      {tab === "history" && (<>
        {machinePicker}
        {!mno ? (
          <div style={{ ...card, textAlign: "center", color: "#64748b", padding: 40 }}>
            Select zone → line → machine to see its check-sheet & revision history.
          </div>
        ) : (<>
          {/* filled DMC sheets table yahan se HATAYA gaya — ab wo Historical Data
              page pe hai (Filled Auto/DMC sections).  History tab sirf revisions. */}

          {/* check-point revisions */}
          <div style={card}>
            <div style={{ fontWeight: 800, fontSize: 13, color: "#0f172a", marginBottom: 10 }}>
              🔁 Check-Point Revisions — {mno}
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>{["Rev No.", "Rev Date", "Points", "Status", ""].map((h) => (
                  <th key={h} style={{ ...sth, textAlign: "left" }}>{h}</th>))}</tr></thead>
                <tbody>
                  {[...(revs.current ? [{ ...revs.current, _cur: true }] : []),
                    ...revs.history.filter((h) => String(h.rev_no) !== String(revs.current?.rev_no))]
                    .map((r) => (
                    <tr key={r.rev_no}>
                      <td style={tdc}><b>Rev {r.rev_no}</b></td>
                      <td style={tdc}>{r.rev_date || "—"}</td>
                      <td style={{ ...tdc, textAlign: "center" }}>{r.count}</td>
                      <td style={tdc}>{r._cur
                        ? <span style={{ color: "#16a34a", fontWeight: 800 }}>CURRENT</span>
                        : <span style={{ color: "#94a3b8" }}>archived</span>}</td>
                      <td style={tdc}><button onClick={() => openRevPoints(r._cur ? "" : r.rev_no)} style={viewBtn}>View Points</button></td>
                    </tr>
                  ))}
                  {!revs.current && revs.history.length === 0 && <tr><td colSpan={5} style={{ ...tdc, textAlign: "center", color: "#94a3b8" }}>No revisions.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>)}
      </>)}

      {/* view a saved filled DMC sheet (snapshot) */}
      {viewFill && (
        <div onClick={() => setViewFill(null)} style={modalOverlay}>
          <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: 1250, width: "100%" }}>
            <div style={modalHead}>
              <b>DMC Sheet · {viewFill.machine_no} · {viewFill.sheet_month || "—"}
                <span style={{ fontWeight: 600, color: "#64748b" }}>  (filled by {viewFill.filled_by || "—"})</span></b>
              <button onClick={() => setViewFill(null)} style={closeBtn}>✕ Close</button>
            </div>
            <DmcSheet printable
                      groups={groupDmcPoints(viewFill.entries || [])} footer={viewFill.doc_footer || fmtDoc}
                      values={fillValues(viewFill.entries, viewFill.day_meta, viewFill.week_meta)}
                      reasons={fillReasons(viewFill.entries, viewFill.day_meta, viewFill.week_meta)}
                      actions={viewFill._actions || {}}
                      signGrid dayCodes={fillDayCodes(viewFill.day_meta, viewFill.week_meta)}
                      weekCodes={fillWeekCodes(viewFill.week_meta)} signableKeys={[]}
                      sheetMonth={viewFill.sheet_month}
                      hdr={{ zone: viewFill.zone_name, line: viewFill.line_name, machine_no: viewFill.machine_no,
                             machine_name: viewFill.machine_name, month: fillMonthLabel(viewFill.sheet_month),
                             rev_no: viewFill.rev_no, rev_date: viewFill.rev_date }} />
          </div>
        </div>
      )}

      {/* view the points that existed at a given revision */}
      {revView && (
        <div onClick={() => setRevView(null)} style={modalOverlay}>
          <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: 1050, width: "100%", background: "#fff", borderRadius: 10, overflow: "hidden" }}>
            <div style={modalHead}>
              <b>Rev {revView.rev_no || "—"} points · {mno}
                <span style={{ fontWeight: 600, color: "#64748b" }}>  ({revView.points.length} points)</span></b>
              <button onClick={() => setRevView(null)} style={closeBtn}>✕ Close</button>
            </div>
            <div style={{ maxHeight: "72vh", overflowY: "auto", padding: 12 }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>{["S.NO.", "CATEGORY", "CHECK POINT", "CRITERIA", "METHOD", "RESP", "FREQ", "TYPE"].map((h) => (
                  <th key={h} style={sth}>{h}</th>))}</tr></thead>
                <tbody>
                  {revView.points.map((p, i) => (
                    <tr key={i}>
                      <td style={{ ...tdc, textAlign: "center" }}>{p.s_no || i + 1}</td>
                      <td style={tdc}>{p.category}</td>
                      <td style={tdc}>{p.check_point}</td>
                      <td style={tdc}>{p.criteria}</td>
                      <td style={tdc}>{p.method}</td>
                      <td style={{ ...tdc, textAlign: "center" }}>{p.resp}</td>
                      <td style={{ ...tdc, textAlign: "center" }}>{p.freq}</td>
                      <td style={{ ...tdc, textAlign: "center" }}>{p.type}</td>
                    </tr>
                  ))}
                  {revView.points.length === 0 && <tr><td colSpan={8} style={{ ...tdc, textAlign: "center", color: "#94a3b8" }}>No points at this revision.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
