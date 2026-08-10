/* ───────────────────────────────────────────────────────────────────
 * PMCheckSheetAdmin.jsx — Maintenance Panel → PM Check Sheet
 * ───────────────────────────────────────────────────────────────────
 * Admin manager for the PM check-sheet points (maintenance_pm_check_point):
 *   • pick a machine (zone → line → machine no, from the points data)
 *   • ADD / DELETE check points on the CURRENT revision
 *   • update Rev No + Rev Date — the new rev no must be GREATER; the old
 *     revision's points are archived (maintenance_pm_check_point_rev)
 *   • a Rev selector lets you open any PREVIOUS revision read-only to see
 *     exactly which points it had
 *
 * The PM page's Check Sheet tab always shows the CURRENT revision, so
 * updates here appear there immediately.
 * ─────────────────────────────────────────────────────────────────── */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { FormatSheet } from "./pm/FormatSheet";

// Financial year (Apr→Mar) a YYYY-MM-DD date belongs to, e.g. "2026-27".
const fyOf = (dateStr) => {
  if (!dateStr) return "";
  const [y, m] = String(dateStr).split("-").map((x) => parseInt(x, 10));
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String(start + 1).slice(2)}`;
};

export default function PMCheckSheetAdmin({ toast, readOnly = false }) {
  const { token } = useAuth();
  const api = useCallback(async (path, opts = {}) => {
    const r = await fetch(`/api/pm${path}`, {
      ...opts,
      headers: { "Content-Type": "application/json",
                 ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) },
    });
    if (!r.ok) { let m; try { m = JSON.parse(await r.text()).detail; } catch { m = null; }
      throw new Error(m || `HTTP ${r.status}`); }
    return r.json();
  }, [token]);
  const say = (msg, kind = "ok") => (toast ? toast(msg, kind) : alert(msg));

  const [tab, setTab] = useState("points");     // 'points' | 'format'
  const [machines, setMachines] = useState([]);
  const [zone, setZone] = useState("");
  const [line, setLine] = useState("");
  const [mno, setMno]   = useState("");
  const [revs, setRevs] = useState({ current: null, history: [] });
  const [selRev, setSelRev] = useState("");            // "" = current
  const [points, setPoints] = useState([]);
  const [rev, setRev]       = useState({});
  const [busy, setBusy]     = useState(false);
  // add-point form
  const [npSno, setNpSno] = useState("");
  const [npCp, setNpCp]   = useState("");
  const [npJs, setNpJs]   = useState("");
  const [npMe, setNpMe]   = useState("");
  const [pending, setPending] = useState([]);   // staged naye points — rev bump par hi commit
  // rev bump form
  const [nrNo, setNrNo]     = useState("");
  const [nrDate, setNrDate] = useState(() => new Date().toISOString().slice(0, 10));
  // ── FORMAT document-control (Format No / Rev No / Rev Date) — per format ──
  const [formatDocs, setFormatDocs] = useState([]);       // [{name,label,doc_footer}]
  const [selFormat, setSelFormat]   = useState("PM CHECK SHEET FORMAT");
  const [fmtDoc, setFmtDoc] = useState({ format_no: "", rev_no: "", rev_date: "" });
  const [fmtSaving, setFmtSaving] = useState(false);

  const loadFormatDocs = useCallback(() => {
    api(`/format-docs`).then((d) => setFormatDocs(Array.isArray(d) ? d : [])).catch(() => {});
  }, [api]);

  useEffect(() => {
    api(`/check-point-machines`).then((d) => setMachines(Array.isArray(d) ? d : [])).catch(() => {});
    loadFormatDocs();
  }, [api, loadFormatDocs]);

  // show the selected format's footer whenever the selection or list changes
  useEffect(() => {
    const f = formatDocs.find((x) => x.name === selFormat);
    const df = (f && f.doc_footer) || {};
    setFmtDoc({ format_no: df.format_no || "", rev_no: df.rev_no || "", rev_date: df.rev_date || "" });
  }, [selFormat, formatDocs]);

  const saveFmtDoc = async () => {
    if (!fmtDoc.format_no.trim()) { say("Format No. required", "err"); return; }
    setFmtSaving(true);
    try {
      await api(`/check-sheet-format-doc`, { method: "PUT",
        body: JSON.stringify({ ...fmtDoc, format_name: selFormat }) });
      say("Format No. updated ✓ — shows on that sheet");
      loadFormatDocs();
    } catch (e) { say(String(e.message || e), "err"); }
    finally { setFmtSaving(false); }
  };

  // ── HISTORY tab: filled check sheets + check-point revisions ──
  const [histFmt, setHistFmt]     = useState(null);       // live format layout (for viewing)
  const [histSheets, setHistSheets] = useState([]);       // filled sheets for the machine
  const [histFy, setHistFy]         = useState("");       // History: filter by financial year (Apr→Mar)
  const [histRevs, setHistRevs]   = useState({ current: null, history: [] });
  const [viewFill, setViewFill]   = useState(null);       // opened filled sheet (full)
  const [revView, setRevView]     = useState(null);       // { rev_no, points } at a rev

  useEffect(() => {   // format layout, loaded once (to render a saved sheet)
    api(`/check-sheet-format`).then((d) => setHistFmt(d && d.format ? d.format : null)).catch(() => {});
  }, [api]);

  useEffect(() => {
    if (tab !== "history" || !mno) { setHistSheets([]); setHistRevs({ current: null, history: [] }); return; }
    const q = `zone=${encodeURIComponent(zone)}&line=${encodeURIComponent(line)}&machine_no=${encodeURIComponent(mno)}`;
    // History shows a sheet ONLY after the full chain is done: Team Member
    // filled → Engineer verified → In-Charge approved (stage = APPROVED).
    api(`/check-sheet-fills?${q}&stage=APPROVED`).then((d) => setHistSheets(d.rows || [])).catch(() => setHistSheets([]));
    api(`/check-point-revs?${q}`).then(setHistRevs).catch(() => setHistRevs({ current: null, history: [] }));
  }, [api, tab, zone, line, mno]);

  const openFill = (id) => api(`/check-sheet-fill/${id}`).then(setViewFill).catch((e) => say(String(e.message || e), "err"));
  const openRevPoints = (rno) => {
    const q = `zone=${encodeURIComponent(zone)}&line=${encodeURIComponent(line)}&machine_no=${encodeURIComponent(mno)}` +
              (rno ? `&rev_no=${encodeURIComponent(rno)}` : "");
    api(`/check-points?${q}`).then((d) => setRevView({ rev_no: rno || (histRevs.current?.rev_no || ""), points: d.points || [], rev: d.rev || {} }))
      .catch((e) => say(String(e.message || e), "err"));
  };

  const zoneOpts = useMemo(() => [...new Set(machines.map((m) => m.zone_name).filter(Boolean))].sort(), [machines]);
  const lineOpts = useMemo(() => zone
    ? [...new Set(machines.filter((m) => m.zone_name === zone).map((m) => m.line_name).filter(Boolean))].sort() : [], [machines, zone]);
  const mcOpts = useMemo(() => (zone && line)
    ? machines.filter((m) => m.zone_name === zone && m.line_name === line && m.machine_no)
              .sort((a, b) => String(a.machine_no).localeCompare(String(b.machine_no))) : [], [machines, zone, line]);
  const mcSel = mcOpts.find((m) => String(m.machine_no) === String(mno)) || null;

  const loadRevs = useCallback(() => {
    if (!mno) { setRevs({ current: null, history: [] }); return; }
    api(`/check-point-revs?zone=${encodeURIComponent(zone)}&line=${encodeURIComponent(line)}&machine_no=${encodeURIComponent(mno)}`)
      .then(setRevs).catch(() => setRevs({ current: null, history: [] }));
  }, [api, zone, line, mno]);

  const loadPoints = useCallback(() => {
    if (!mno) { setPoints([]); setRev({}); return; }
    const q = `zone=${encodeURIComponent(zone)}&line=${encodeURIComponent(line)}&machine_no=${encodeURIComponent(mno)}` +
              (selRev ? `&rev_no=${encodeURIComponent(selRev)}` : "");
    api(`/check-points?${q}`)
      .then((d) => { setPoints(d.points || []); setRev(d.rev || {}); })
      .catch(() => { setPoints([]); setRev({}); });
  }, [api, zone, line, mno, selRev]);

  useEffect(() => { setSelRev(""); loadRevs(); }, [loadRevs]);
  useEffect(() => { loadPoints(); }, [loadPoints]);

  const onZone = (v) => { setZone(v); setLine(""); setMno(""); };
  const onLine = (v) => { setLine(v); setMno(""); };
  const isCurrent = !selRev || (revs.current && String(selRev) === String(revs.current.rev_no));
  const canEdit = !readOnly && isCurrent && !!mno;
  const fyOpts = [...new Set(histSheets.map((s) => fyOf(s.pm_date)).filter(Boolean))].sort().reverse();
  const shownSheets = histFy ? histSheets.filter((s) => fyOf(s.pm_date) === histFy) : histSheets;

  // Naya point SEEDHE save nahi hota — pehle "pending" me stage hota hai, aur
  // rev bump (Update Revision) par hi commit hota hai.  Bina rev bump ke chhod
  // do to (reload/page change par) ye hat jaata hai.
  const addPoint = () => {
    if (!npCp.trim()) { say("Check point required", "err"); return; }
    setPending((ps) => [...ps, { s_no: npSno, check_point: npCp, judgement_standard: npJs,
                                 method: npMe, machine_name: mcSel?.machine_name || "" }]);
    setNpSno(""); setNpCp(""); setNpJs(""); setNpMe("");
    say("Point staged — rev update karne par hi save hoga");
  };
  const removePending = (i) => setPending((ps) => ps.filter((_, x) => x !== i));

  const delPoint = async (p) => {
    if (!window.confirm(`Delete point ${p.s_no}?\n"${(p.check_point || "").slice(0, 60)}"`)) return;
    try { await api(`/check-points/${p.id}`, { method: "DELETE" }); say("Point deleted"); loadPoints(); loadRevs(); }
    catch (e) { say(String(e.message || e), "err"); }
  };

  const bumpRev = async () => {
    const cur = parseInt(revs.current?.rev_no || "0", 10);
    const nxt = parseInt(nrNo, 10);
    if (!nxt || nxt <= cur) { say(`New rev no. must be greater than the current rev (${revs.current?.rev_no || "—"})`, "err"); return; }
    if (!nrDate) { say("Pick a rev date", "err"); return; }
    const extra = pending.length ? `\n${pending.length} naya point is nayi rev me add hoga.` : "";
    if (!window.confirm(`Update revision ${revs.current?.rev_no} → ${nxt}?\nCurrent points Rev ${revs.current?.rev_no} me archive honge.${extra}`)) return;
    setBusy(true);
    try {
      const r = await api(`/check-point-rev`, { method: "PUT", body: JSON.stringify({
        zone, line, machine_no: mno, rev_no: String(nxt), rev_date: nrDate, new_points: pending }) });
      say(`Rev ${r.new_rev} ✓ — ${r.added_points || 0} naye point add, Rev ${r.old_rev} archived`);
      setPending([]); setNrNo(""); setSelRev(""); loadRevs(); loadPoints();
    } catch (e) { say(String(e.message || e), "err"); }
    finally { setBusy(false); }
  };

  // ── styles (match the sheet look) ──
  const card = { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 16 };
  const bd = "1px solid #cbd5e1";
  const sel = { padding: "8px 10px", borderRadius: 8, border: bd, fontSize: 13, fontWeight: 600, minWidth: 170, background: "#fff" };
  const label = { fontSize: 10.5, fontWeight: 800, color: "#64748b", marginBottom: 4 };
  const sb = "1px solid #000";
  const sth = { border: sb, padding: "5px 6px", fontSize: 10.5, fontWeight: 800, background: "#f3f4f6", textAlign: "center" };
  const inp = { width: "100%", boxSizing: "border-box", border: "none", outline: "none", background: "#fffbeb", fontSize: 12, padding: "5px 6px", fontFamily: "inherit" };
  const tdc = { border: bd, padding: "6px 10px", fontSize: 12, color: "#334155" };
  const viewBtn = { padding: "4px 12px", borderRadius: 6, border: bd, background: "#fff", cursor: "pointer", fontSize: 11.5, fontWeight: 700, color: "#2563eb" };
  const modalOverlay = { position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 600, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "30px 16px", overflowY: "auto" };
  const modalHead = { display: "flex", justifyContent: "space-between", alignItems: "center", background: "#fff", borderRadius: "10px 10px 0 0", padding: "10px 16px", borderBottom: "1px solid #e2e8f0", fontSize: 13, color: "#0f172a" };
  const closeBtn = { border: "none", background: "transparent", color: "#64748b", cursor: "pointer", fontWeight: 800, fontSize: 14 };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* ── tab switch: Check Points editor  vs  Format (document control) ── */}
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

      {/* ── FORMAT tab: document control (Format No / Rev No / Rev Date) ── */}
      {tab === "format" && (
      <div style={{ ...card, borderLeft: "4px solid #7c3aed" }}>
        <div style={{ fontWeight: 800, fontSize: 13, color: "#0f172a", marginBottom: 10 }}>
          📄 Check Sheet Format — Document Control <span style={{ fontWeight: 600, color: "#94a3b8" }}>(shows at the bottom of every sheet)</span>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div><div style={label}>FORMAT</div>
            <select style={{ ...sel, minWidth: 210, fontWeight: 700 }} value={selFormat}
                    onChange={(e) => setSelFormat(e.target.value)}>
              {formatDocs.map((f) => <option key={f.name} value={f.name}>{f.label}</option>)}
            </select></div>
          <div><div style={label}>FORMAT NO.</div>
            <input style={{ ...sel, minWidth: 220 }} value={fmtDoc.format_no}
                   onChange={(e) => setFmtDoc((s) => ({ ...s, format_no: e.target.value }))}
                   placeholder="TBDI / MAINT. / F / 011" disabled={readOnly} /></div>
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

      {/* ── CHECK POINTS tab: machine picker + rev bump + the sheet ── */}
      {tab === "points" && (<>
      {/* machine picker + rev selector */}
      <div style={{ ...card, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div><div style={{ fontSize: 10.5, fontWeight: 800, color: "#64748b", marginBottom: 4 }}>ZONE</div>
          <select style={sel} value={zone} onChange={(e) => onZone(e.target.value)}>
            <option value="">— zone —</option>
            {zoneOpts.map((z) => <option key={z} value={z}>{z}</option>)}
          </select></div>
        <div><div style={{ fontSize: 10.5, fontWeight: 800, color: "#64748b", marginBottom: 4 }}>LINE</div>
          <select style={sel} value={line} onChange={(e) => onLine(e.target.value)} disabled={!zone}>
            <option value="">— line —</option>
            {lineOpts.map((l) => <option key={l} value={l}>{l}</option>)}
          </select></div>
        <div><div style={{ fontSize: 10.5, fontWeight: 800, color: "#64748b", marginBottom: 4 }}>MACHINE NO</div>
          <select style={{ ...sel, minWidth: 180 }} value={mno} onChange={(e) => setMno(e.target.value)} disabled={!line}>
            <option value="">— machine no —</option>
            {mcOpts.map((m) => <option key={m.machine_no} value={m.machine_no}>{m.machine_no}</option>)}
          </select></div>
        <div><div style={{ fontSize: 10.5, fontWeight: 800, color: "#64748b", marginBottom: 4 }}>MACHINE NAME</div>
          <input readOnly value={mcSel?.machine_name || ""} placeholder="— auto —"
                 style={{ ...sel, minWidth: 230, background: "#f8fafc", color: "#334155", cursor: "default" }} /></div>
        {mno && revs.current && (
          <div><div style={{ fontSize: 10.5, fontWeight: 800, color: "#64748b", marginBottom: 4 }}>REVISION</div>
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
            {points.length} points{isCurrent ? " · current (editable)" : " · old revision (read-only)"}
          </span>
        )}
      </div>

      {/* rev bump */}
      {canEdit && (
        <div style={{ ...card, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", borderLeft: "4px solid #2563eb" }}>
          <div style={{ fontWeight: 800, fontSize: 13, color: "#0f172a", alignSelf: "center" }}>
            ↑ Update Revision — current: <span style={{ color: "#2563eb" }}>Rev {revs.current?.rev_no}</span> ({revs.current?.rev_date})
          </div>
          <div><div style={{ fontSize: 10.5, fontWeight: 800, color: "#64748b", marginBottom: 4 }}>NEW REV NO. (&gt; {revs.current?.rev_no})</div>
            <input type="number" min={parseInt(revs.current?.rev_no || "0", 10) + 1} value={nrNo}
                   onChange={(e) => setNrNo(e.target.value)} style={{ ...sel, minWidth: 110 }} /></div>
          <div><div style={{ fontSize: 10.5, fontWeight: 800, color: "#64748b", marginBottom: 4 }}>NEW REV DATE</div>
            <input type="date" value={nrDate} onChange={(e) => setNrDate(e.target.value)} style={{ ...sel, minWidth: 150 }} /></div>
          <button onClick={bumpRev} disabled={busy}
                  style={{ padding: "9px 18px", borderRadius: 8, border: "none", background: "#2563eb", color: "#fff",
                           fontWeight: 800, fontSize: 13, cursor: "pointer" }}>
            {busy ? "…" : "Update Revision"}</button>
          <span style={{ fontSize: 11, color: "#94a3b8" }}>Old revision's points are archived and stay viewable from the Revision dropdown.</span>
        </div>
      )}

      {canEdit && pending.length > 0 && (
        <div style={{ ...card, marginTop: 10, borderLeft: "4px solid #d97706", background: "#fffbeb", color: "#92400e", fontSize: 12.5, fontWeight: 700, lineHeight: 1.5 }}>
          ⚠ {pending.length} naya point <b>PENDING</b> hai — save karne ke liye upar <b>Update Revision</b> (naya rev no + date) dabao.
          Rev bump kiye bina page chhoda / reload kiya to ye <b>hat jayenge</b>.
        </div>
      )}

      {/* the sheet (points grid, same format) */}
      {!mno ? (
        <div style={{ ...card, textAlign: "center", color: "#64748b", padding: 40 }}>
          Select zone → line → machine to open its check sheet.
        </div>
      ) : (
        <div style={{ background: "#fff", boxShadow: "0 4px 16px rgba(0,0,0,.12)", padding: 10, color: "#111827" }}>
          {/* title band */}
          <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}><tbody><tr>
            <td style={{ border: sb, width: 110, textAlign: "center" }}>
              <img src="/logo.jpg" alt="Toyota Boshoku" style={{ maxWidth: "100%", maxHeight: 54, objectFit: "contain", display: "block", margin: "0 auto" }} />
            </td>
            <td style={{ border: sb, textAlign: "center", padding: "4px 8px" }}>
              <div style={{ fontSize: 16, fontWeight: 900 }}>TOYOTA BOSHOKU DEVICE INDIA PVT LTD</div>
              <div style={{ fontSize: 13, fontWeight: 800, marginTop: 2 }}>PREVENTIVE MAINTENANCE CHECK SHEET</div>
            </td>
            <td style={{ border: sb, width: 200, padding: 0, verticalAlign: "top", fontSize: 10.5 }}>
              <div style={{ borderBottom: sb, padding: "2px 5px", fontWeight: 700, textAlign: "center" }}>Check Sheet Points Revision History</div>
              <div style={{ borderBottom: sb, padding: "3px 5px" }}><b>Rev No.</b> {rev.rev_no || ""}</div>
              <div style={{ padding: "3px 5px" }}><b>Rev Date</b> {rev.rev_date || ""}</div>
            </td>
          </tr></tbody></table>
          {/* machine band */}
          <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", borderTop: "none" }}><tbody>
            <tr>
              <td style={{ border: sb, padding: "3px 8px", fontSize: 11.5, fontWeight: 800, background: "#f3f4f6", width: "14%" }}>ZONE</td>
              <td style={{ border: sb, padding: "3px 8px", fontSize: 12, width: "20%" }}>{zone}</td>
              <td style={{ border: sb, padding: "3px 8px", fontSize: 11.5, fontWeight: 800, background: "#f3f4f6", width: "14%" }}>LINE</td>
              <td style={{ border: sb, padding: "3px 8px", fontSize: 12, width: "18%" }}>{line}</td>
              <td style={{ border: sb, padding: "3px 8px", fontSize: 11.5, fontWeight: 800, background: "#f3f4f6", width: "14%" }}>MACHINE_NO</td>
              <td style={{ border: sb, padding: "3px 8px", fontSize: 12 }}>{mno}</td>
            </tr>
            <tr>
              <td style={{ border: sb, padding: "3px 8px", fontSize: 11.5, fontWeight: 800, background: "#f3f4f6" }}>MACHINE_NAME</td>
              <td style={{ border: sb, padding: "3px 8px", fontSize: 12 }} colSpan={3}>{mcSel?.machine_name || ""}</td>
              <td style={{ border: sb, padding: "3px 8px", fontSize: 11.5, fontWeight: 800, background: "#f3f4f6" }}>Deptt:-</td>
              <td style={{ border: sb, padding: "3px 8px", fontSize: 12 }}>Maintenance</td>
            </tr>
          </tbody></table>
          {/* points */}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", minWidth: 900, borderCollapse: "collapse", tableLayout: "fixed", borderTop: "none" }}>
              <colgroup>
                <col style={{ width: "6%" }} /><col style={{ width: "38%" }} /><col style={{ width: "26%" }} />
                <col style={{ width: "22%" }} />{canEdit && <col style={{ width: "8%" }} />}
              </colgroup>
              <thead><tr>
                <th style={sth}>S.NO.</th>
                <th style={sth}>CHECK POINTS / DETAIL OF WORK</th>
                <th style={sth}>JUDGEMENT STANDARD</th>
                <th style={sth}>METHOD</th>
                {canEdit && <th style={{ ...sth, background: "#fee2e2" }}>ACTION</th>}
              </tr></thead>
              <tbody>
                {points.map((p, i) => (
                  <tr key={p.id ?? i}>
                    <td style={{ border: sb, fontSize: 11, textAlign: "center", padding: "3px 5px", verticalAlign: "top" }}>{p.s_no || i + 1}</td>
                    <td style={{ border: sb, fontSize: 11, padding: "3px 6px", verticalAlign: "top" }}>{p.check_point}</td>
                    <td style={{ border: sb, fontSize: 11, padding: "3px 6px", verticalAlign: "top" }}>{p.judgement_standard}</td>
                    <td style={{ border: sb, fontSize: 11, padding: "3px 6px", verticalAlign: "top" }}>{p.method}</td>
                    {canEdit && (
                      <td style={{ border: sb, textAlign: "center" }}>
                        <button onClick={() => delPoint(p)}
                                style={{ border: "none", background: "transparent", color: "#dc2626", cursor: "pointer", fontWeight: 800, fontSize: 14 }}
                                title="Delete point">🗑</button>
                      </td>
                    )}
                  </tr>
                ))}
                {/* staged (pending) naye points — rev bump par commit honge */}
                {pending.map((p, i) => (
                  <tr key={`pending-${i}`} style={{ background: "#fef9c3" }}>
                    <td style={{ border: sb, fontSize: 11, textAlign: "center", padding: "3px 5px", verticalAlign: "top", color: "#a16207", fontWeight: 800 }}>new</td>
                    <td style={{ border: sb, fontSize: 11, padding: "3px 6px", verticalAlign: "top" }}>{p.check_point}
                      <span style={{ fontSize: 9.5, fontWeight: 800, color: "#92400e", background: "#fde68a", borderRadius: 4, padding: "1px 5px", marginLeft: 5 }}>PENDING</span></td>
                    <td style={{ border: sb, fontSize: 11, padding: "3px 6px", verticalAlign: "top" }}>{p.judgement_standard}</td>
                    <td style={{ border: sb, fontSize: 11, padding: "3px 6px", verticalAlign: "top" }}>{p.method}</td>
                    {canEdit && (
                      <td style={{ border: sb, textAlign: "center" }}>
                        <button onClick={() => removePending(i)} style={{ border: "none", background: "transparent", color: "#dc2626", cursor: "pointer", fontWeight: 800, fontSize: 14 }} title="Remove from pending">🗑</button>
                      </td>
                    )}
                  </tr>
                ))}
                {points.length === 0 && pending.length === 0 && (
                  <tr><td colSpan={canEdit ? 5 : 4} style={{ border: sb, padding: 20, textAlign: "center", color: "#94a3b8", fontSize: 12 }}>No points.</td></tr>
                )}
                {/* add-point row */}
                {canEdit && (
                  <tr style={{ background: "#fffbeb" }}>
                    <td style={{ border: sb, padding: 0 }}><input style={{ ...inp, textAlign: "center" }} placeholder="auto" value={npSno} onChange={(e) => setNpSno(e.target.value)} /></td>
                    <td style={{ border: sb, padding: 0 }}><input style={inp} placeholder="New check point / detail of work…" value={npCp} onChange={(e) => setNpCp(e.target.value)} /></td>
                    <td style={{ border: sb, padding: 0 }}><input style={inp} placeholder="Judgement standard" value={npJs} onChange={(e) => setNpJs(e.target.value)} /></td>
                    <td style={{ border: sb, padding: 0 }}><input style={inp} placeholder="Method" value={npMe} onChange={(e) => setNpMe(e.target.value)} /></td>
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

      {/* ── HISTORY tab: filled check sheets + check-point revisions ── */}
      {tab === "history" && (<>
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
          <div><div style={label}>FINANCIAL YEAR</div>
            <select style={{ ...sel, minWidth: 140 }} value={histFy} onChange={(e) => setHistFy(e.target.value)}>
              <option value="">— all FY —</option>
              {fyOpts.map((f) => <option key={f} value={f}>FY {f}</option>)}
            </select></div>
        </div>

        {!mno ? (
          <div style={{ ...card, textAlign: "center", color: "#64748b", padding: 40 }}>
            Select zone → line → machine to see its check-sheet & revision history.
          </div>
        ) : (<>
          {/* filled check sheets — which FORMAT each sheet was filled under */}
          <div style={card}>
            <div style={{ fontWeight: 800, fontSize: 13, color: "#0f172a", marginBottom: 10 }}>
              📋 Filled Check Sheets — {mno}{histFy ? ` · FY ${histFy}` : ""} <span style={{ fontWeight: 600, color: "#94a3b8" }}>({shownSheets.length})</span>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>{["PM Date", "Format No.", "Point Rev", "Points", "Filled By", ""].map((h) => (
                  <th key={h} style={{ ...sth, textAlign: "left" }}>{h}</th>))}</tr></thead>
                <tbody>
                  {shownSheets.map((s) => (
                    <tr key={s.id}>
                      <td style={tdc}>{s.pm_date}</td>
                      <td style={tdc}><b>{s.format_no || "—"}</b></td>
                      <td style={tdc}>Rev {s.rev_no || "—"}</td>
                      <td style={{ ...tdc, textAlign: "center" }}>{s.n_points}</td>
                      <td style={tdc}>{s.filled_by || "—"}</td>
                      <td style={tdc}><button onClick={() => openFill(s.id)} style={viewBtn}>View Sheet</button></td>
                    </tr>
                  ))}
                  {shownSheets.length === 0 && <tr><td colSpan={6} style={{ ...tdc, textAlign: "center", color: "#94a3b8" }}>{histFy ? "No filled sheet for the selected financial year." : "No filled sheets yet for this machine."}</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {/* check-point revisions — which REV had which points */}
          <div style={card}>
            <div style={{ fontWeight: 800, fontSize: 13, color: "#0f172a", marginBottom: 10 }}>
              🔁 Check-Point Revisions — {mno}
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>{["Rev No.", "Rev Date", "Points", "Status", ""].map((h) => (
                  <th key={h} style={{ ...sth, textAlign: "left" }}>{h}</th>))}</tr></thead>
                <tbody>
                  {[...(histRevs.current ? [{ ...histRevs.current, _cur: true }] : []),
                    ...histRevs.history.filter((h) => String(h.rev_no) !== String(histRevs.current?.rev_no))]
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
                  {!histRevs.current && histRevs.history.length === 0 && <tr><td colSpan={5} style={{ ...tdc, textAlign: "center", color: "#94a3b8" }}>No revisions.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>)}
      </>)}

      {/* ── VIEW SHEET tab: select a machine → view its check sheet READ-ONLY ── */}
      {tab === "viewsheet" && (<>
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
          {mno && <span style={{ fontSize: 12, fontWeight: 700, color: "#64748b" }}>{points.length} points · read-only</span>}
        </div>
        {!mno ? (
          <div style={{ ...card, textAlign: "center", color: "#64748b", padding: 40 }}>
            Select zone → line → machine no to open that machine's check sheet (read-only).
          </div>
        ) : (
          <FormatSheet f={histFmt} points={points} editable={false}
                       rev={rev}
                       hdr={{ zone, line, machine_no: mno, machine_name: mcSel?.machine_name || "",
                              month: new Date().toLocaleString("en-GB", { month: "short", year: "numeric" }) }} />
        )}
      </>)}

      {/* view a saved filled sheet (snapshot — its own format number + points) */}
      {viewFill && (
        <div onClick={() => setViewFill(null)} style={modalOverlay}>
          <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: 1150, width: "100%" }}>
            <div style={modalHead}>
              <b>PM Check Sheet · {viewFill.machine_no} · {viewFill.pm_date}
                <span style={{ fontWeight: 600, color: "#64748b" }}>  (filled by {viewFill.filled_by || "—"})</span></b>
              <button onClick={() => setViewFill(null)} style={closeBtn}>✕ Close</button>
            </div>
            <FormatSheet
              f={histFmt ? { ...histFmt, doc_footer: viewFill.doc_footer || histFmt.doc_footer } : histFmt}
              points={viewFill.entries || []}
              rev={{ rev_no: viewFill.rev_no, rev_date: viewFill.rev_date }}
              signVals={[viewFill.prepared_by, viewFill.checked_by, viewFill.approved_by]}
              signImgs={viewFill.sign_imgs || []}
              hdr={{ zone: viewFill.zone_name, line: viewFill.line_name, machine_no: viewFill.machine_no,
                     machine_name: viewFill.machine_name, pm_date: viewFill.pm_date }} />
          </div>
        </div>
      )}

      {/* view the points that existed at a given revision */}
      {revView && (
        <div onClick={() => setRevView(null)} style={modalOverlay}>
          <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: 950, width: "100%", background: "#fff", borderRadius: 10, overflow: "hidden" }}>
            <div style={modalHead}>
              <b>Rev {revView.rev_no || "—"} points · {mno}
                <span style={{ fontWeight: 600, color: "#64748b" }}>  ({revView.points.length} points)</span></b>
              <button onClick={() => setRevView(null)} style={closeBtn}>✕ Close</button>
            </div>
            <div style={{ maxHeight: "72vh", overflowY: "auto", padding: 12 }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>{["S.NO.", "CHECK POINT / DETAIL OF WORK", "JUDGEMENT STANDARD", "METHOD"].map((h) => (
                  <th key={h} style={sth}>{h}</th>))}</tr></thead>
                <tbody>
                  {revView.points.map((p, i) => (
                    <tr key={i}>
                      <td style={{ ...tdc, textAlign: "center" }}>{p.s_no || i + 1}</td>
                      <td style={tdc}>{p.check_point}</td>
                      <td style={tdc}>{p.judgement_standard}</td>
                      <td style={tdc}>{p.method}</td>
                    </tr>
                  ))}
                  {revView.points.length === 0 && <tr><td colSpan={4} style={{ ...tdc, textAlign: "center", color: "#94a3b8" }}>No points at this revision.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
