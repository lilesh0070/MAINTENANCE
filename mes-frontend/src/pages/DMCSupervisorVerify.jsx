/* ───────────────────────────────────────────────────────────────────
 * DMCSupervisorVerify.jsx — "Supervisor Verify" (Machine DMC)
 * ───────────────────────────────────────────────────────────────────
 * Stage 2 of the Daily DMC workflow:
 *   1. Operator fills a date + signs  → status PENDING  (DailyDMCFill)
 *   2. Supervisor opens this page, reviews that date's sheet (read-only),
 *      signs, and clicks Verify → status VERIFIED = finally submitted.
 *
 * Verification is PER DATE and lives in machine_dmc_filled.day_meta.
 * Routing: /maintenance-dmc-verify — canAccess('maintenance-dmc-verify').
 * ─────────────────────────────────────────────────────────────────── */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { DmcSheet, groupDmcPoints, RESP_STAGE, isPointDue } from "./DmcSheet";

const monthNow = () => new Date().toISOString().slice(0, 7);
const MON = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (ym) => { if (!ym) return ""; const [y, m] = ym.split("-"); return `${MON[parseInt(m, 10)] || m} ${y}`; };
const dateLabel = (iso) => { if (!iso) return ""; const [y, m, d] = iso.split("-"); return `${parseInt(d, 10)} ${MON[parseInt(m, 10)] || m} ${y}`; };

export default function DMCSupervisorVerify() {
  const { theme, token, user } = useAuth();
  const navigate = useNavigate();
  const [machines, setMachines] = useState([]);
  const [zone, setZone] = useState("");
  const [line, setLine] = useState("");
  const [mno, setMno]   = useState("");
  const [month, setMonth] = useState(monthNow);
  const [onDate, setOnDate] = useState("");      // optional single-date filter
  const [onlyPending, setOnlyPending] = useState(true);
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({ pending: 0, verified: 0, total: 0 });
  const [loading, setLoading] = useState(false);

  // the date being reviewed
  const [sel, setSel] = useState(null);          // row from the list
  const [sheet, setSheet] = useState(null);      // { points, values, reasons, meta, footer }
  const [sheetBusy, setSheetBusy] = useState(false);
  const [supCode, setSupCode] = useState("");   // supervisor's sign-off code
  const [saving, setSaving] = useState(false);
  const [ngPop, setNgPop] = useState(null);      // {id, day, x, y} — reason entry for a ✗
  const [msg, setMsg] = useState("");

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

  useEffect(() => { api(`/machines`).then((d) => setMachines(Array.isArray(d) ? d : [])).catch(() => {}); }, [api]);

  const zoneOpts = useMemo(() => [...new Set(machines.map((m) => m.zone).filter(Boolean))].sort(), [machines]);
  const lineOpts = useMemo(() => zone
    ? [...new Set(machines.filter((m) => m.zone === zone).map((m) => m.line).filter(Boolean))].sort() : [], [machines, zone]);
  const mcOpts = useMemo(() => (zone && line)
    ? machines.filter((m) => m.zone === zone && m.line === line && m.machine_no)
              .sort((a, b) => String(a.machine_no).localeCompare(String(b.machine_no))) : [], [machines, zone, line]);
  const mcSel = mcOpts.find((m) => String(m.machine_no) === String(mno)) || null;

  // ── pending / verified list ──
  const loadList = useCallback(() => {
    setLoading(true);
    const q = new URLSearchParams();
    if (zone) q.set("zone", zone);
    if (line) q.set("line", line);
    if (mno)  q.set("machine_no", mno);
    if (month) q.set("month", month);
    if (onDate) q.set("on_date", onDate);
    if (onlyPending) q.set("only_pending", "true");
    api(`/pending-verify?${q.toString()}`)
      .then((d) => { setRows(d.rows || []); setCounts(d.counts || { pending: 0, verified: 0, total: 0 }); })
      .catch(() => { setRows([]); setCounts({ pending: 0, verified: 0, total: 0 }); })
      .finally(() => setLoading(false));
  }, [api, zone, line, mno, month, onDate, onlyPending]);
  useEffect(() => { loadList(); }, [loadList]);

  // ── open one date's sheet for review ──
  const openDate = async (row) => {
    setSel(row); setSheet(null); setMsg("");
    setSupCode("");
    setSheetBusy(true);
    try {
      const q = `zone=${encodeURIComponent(row.zone_name)}&line=${encodeURIComponent(row.line_name)}&machine_no=${encodeURIComponent(row.machine_no)}`;
      const [fill, fmt, live] = await Promise.all([
        api(`/check-sheet-fill-current?${q}&month=${encodeURIComponent(row.sheet_month)}`),
        api(`/format`).catch(() => null),
        // the Line Leader's OWN points come from the live master — the operator
        // never submitted them, so they cannot be in the saved snapshot
        api(`/points?machine_no=${encodeURIComponent(row.machine_no)}`).catch(() => null),
      ]);
      // Render from the SAVED entries snapshot (not live /points): point ids in
      // `values` are the fill-time ids, so a later add/delete of a check point
      // would otherwise blank out the marks the operator actually submitted.
      const d0 = String(row.day);
      const v = {}, r = {};
      (fill?.entries || []).forEach((e) => {
        Object.entries(e.days || {}).forEach(([d, val]) => { if (val) v[`${e.id}_${d}`] = val; });
        Object.entries(e.reasons || {}).forEach(([d, val]) => { if (val) r[`${e.id}_${d}`] = val; });
      });
      const pts = (fill?.entries || []).filter((e) => (e.days || {})[d0]);   // only what was filled that date
      const meta = (fill?.day_meta || {})[d0] || {};
      // The Line Leader's own points for this date: his stage's points that are
      // still DUE (same W / 2W / M rule the operator screen uses).  Any already
      // saved on this sheet are skipped — they're in `pts` already.
      const have = new Set(pts.map((e) => String(e.id)));
      const llPts = ((live?.points) || [])
        .filter((p) => RESP_STAGE(p.resp) === "supervisor")
        .filter((p) => !have.has(String(p.id)))
        .filter((p) => isPointDue(p, Number(d0), row.sheet_month, (pid, x) => v[`${pid}_${x}`]));
      setSheet({
        points: [...pts, ...llPts], ownIds: new Set(llPts.map((p) => String(p.id))),
        header: { rev_no: fill?.rev_no, rev_date: fill?.rev_date },
        values: v, reasons: r, meta,
        footer: (fmt && fmt.format && fmt.format.doc_footer) || null,
      });
      if (meta.supervisor_code) setSupCode(meta.supervisor_code);
    } catch (e) { setMsg(String(e.message || e)); }
    finally { setSheetBusy(false); }
  };

  // the Line Leader ticks / types into HIS OWN rows only
  const setMark = (pid, d, val) =>
    setSheet((s) => s ? { ...s, values: { ...s.values, [`${pid}_${d}`]: val } } : s);
  const onToggle = (pid, d, e) => {
    const next = { "": "OK", OK: "NG", NG: "" }[String(sheet?.values?.[`${pid}_${d}`] || "")];
    setMark(pid, d, next);
    // a ✗ must carry a reason — ask for it right at the cell, same as the fill page
    if (next === "NG") setNgPop({ id: pid, day: d, x: e?.clientX || 300, y: e?.clientY || 200 });
  };
  const onSetValue = (pid, d, val) => setMark(pid, d, val);
  const onReason = (pid, d, txt) =>
    setSheet((s) => s ? { ...s, reasons: { ...s.reasons, [`${pid}_${d}`]: txt } } : s);

  // his own points, in the shape the API merges add-only
  const ownEntries = () => {
    if (!sheet || !sel) return [];
    const d0 = String(sel.day);
    return sheet.points.filter((p) => sheet.ownIds.has(String(p.id)))
      .map((p) => ({
        id: p.id, s_no: p.s_no, category: p.category, check_point: p.check_point,
        criteria: p.criteria, method: p.method, resp: p.resp, freq: p.freq, type: p.type,
        days: sheet.values[`${p.id}_${d0}`] ? { [d0]: sheet.values[`${p.id}_${d0}`] } : {},
        reasons: sheet.reasons[`${p.id}_${d0}`] ? { [d0]: sheet.reasons[`${p.id}_${d0}`] } : {},
      }))
      .filter((e) => Object.keys(e.days).length);
  };
  const ownPending = () => {
    if (!sheet || !sel) return [];
    const d0 = String(sel.day);
    return sheet.points.filter((p) => sheet.ownIds.has(String(p.id)) && !sheet.values[`${p.id}_${d0}`]);
  };
  // OPERATOR ke ✗ (NG) points is date par — operator ab reason bina ✗ chhod deta,
  // Line Leader yahin unka reason bharega.  (ownIds = Line Leader ke apne points;
  // baaki NG operator ke maane jaate.)
  const operatorNg = () => {
    if (!sheet || !sel) return [];
    const d0 = String(sel.day);
    return sheet.points.filter((p) => !sheet.ownIds.has(String(p.id))
      && String(sheet.values[`${p.id}_${d0}`] || "").toUpperCase() === "NG");
  };

  const verify = async () => {
    if (!supCode.trim()) { alert("Enter your supervisor code before verifying."); return; }
    const missing = ownPending();
    if (missing.length) {
      alert(`Fill your own (Line Leader) points first — ${missing.length} still empty.`);
      return;
    }
    const d0 = String(sel.day);
    const noReason = ownEntries().filter((e) => e.days[d0] === "NG" && !(e.reasons[d0] || "").trim());
    if (noReason.length) { alert(`A ✗ needs a reason — ${noReason.length} point(s) without one.`); return; }
    // operator ke har ✗ ka reason bhi bharna zaroori — warna verify block.
    const opNg = operatorNg();
    const opMissing = opNg.filter((p) => !(sheet.reasons[`${p.id}_${d0}`] || "").trim());
    if (opMissing.length) {
      alert(`Operator ne ${opMissing.length} point(s) Not-OK (✗) kiye hain — pehle unka reason bharo, phir verify.`);
      return;
    }
    // { point_id: reason } — operator NG points ke reason backend ko bhejo
    const reason_patch = {};
    opNg.forEach((p) => { reason_patch[String(p.id)] = (sheet.reasons[`${p.id}_${d0}`] || "").trim(); });
    setSaving(true);
    try {
      await api(`/verify-day`, { method: "PUT", body: JSON.stringify({
        zone: sel.zone_name, line: sel.line_name, machine_no: sel.machine_no,
        sheet_month: sel.sheet_month, day: sel.day,
        supervisor_code: supCode.trim().toUpperCase(),
        entries: ownEntries(), reason_patch }) });
      setMsg(`✅ ${dateLabel(sel.date)} verified & submitted.`);
      setSel(null); setSheet(null);
      loadList();
    } catch (e) { alert(String(e.message || e)); }
    finally { setSaving(false); }
  };

  const sels = { padding: "8px 10px", borderRadius: 8, border: "1px solid #cbd5e1", fontSize: 13, fontWeight: 600, minWidth: 170, background: "#fff" };
  const lab = { fontSize: 10.5, fontWeight: 800, color: "#64748b", marginBottom: 4 };
  const card = { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 16 };
  const th = { border: "1px solid #cbd5e1", padding: "6px 10px", fontSize: 11, fontWeight: 800, background: "#f3f4f6", textAlign: "left" };
  const td = { border: "1px solid #cbd5e1", padding: "6px 10px", fontSize: 12, color: "#334155" };

  const onZone = (v) => { setZone(v); setLine(""); setMno(""); setSel(null); setSheet(null); };
  const onLine = (v) => { setLine(v); setMno(""); setSel(null); setSheet(null); };

  // operator NG points (is date par) + jinke reason abhi bhare nahi
  const opNgList    = (sheet && sel && sel.status !== "VERIFIED") ? operatorNg() : [];
  const opNgPending = opNgList.filter((p) => !(sheet?.reasons?.[`${p.id}_${String(sel?.day)}`] || "").trim());

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700;800&family=Barlow+Condensed:wght@600;700;800&display=swap');
        .sv-root { min-height:100vh; background:#f8fafc; font-family:'Barlow',sans-serif; padding-bottom:80px; }
        .sv-topbar { background:#fff; border-bottom:1px solid #e2e8f0; padding:0 40px 0 88px; height:60px;
          display:flex; align-items:center; justify-content:space-between; position:sticky; top:0; z-index:100;
          box-shadow:0 1px 3px rgba(0,0,0,.06); }
        .sv-topbar::after { content:''; position:absolute; bottom:0; left:0; right:0; height:2px; background:${theme.gradient}; }
        .sv-title { position:absolute; left:50%; transform:translateX(-50%); font-family:'Barlow Condensed',sans-serif;
          font-size:32px; font-weight:800; color:#0f172a; pointer-events:none; white-space:nowrap; }
        .sv-title span { color:${theme.accent}; }
        .sv-body { padding:20px; max-width:1600px; margin:0 auto; }
      `}</style>
      <div className="sv-root">
        <div className="sv-topbar"><div /><div className="sv-title">✅ Supervisor <span>Verify</span></div><div /></div>

        <div className="sv-body">
          <button onClick={() => navigate("/maintenance-machine-dmc")}
            style={{ marginBottom: 14, padding: "8px 16px", borderRadius: 8, border: "1px solid #cbd5e1",
                     background: "#fff", cursor: "pointer", fontWeight: 800, fontSize: 13, color: "#334155" }}>← Machine DMC</button>

          {/* filters */}
          <div style={{ ...card, marginBottom: 14, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div><div style={lab}>ZONE</div>
              <select style={sels} value={zone} onChange={(e) => onZone(e.target.value)}>
                <option value="">— all zones —</option>{zoneOpts.map((z) => <option key={z} value={z}>{z}</option>)}
              </select></div>
            <div><div style={lab}>LINE</div>
              <select style={sels} value={line} onChange={(e) => onLine(e.target.value)} disabled={!zone}>
                <option value="">— all lines —</option>{lineOpts.map((l) => <option key={l} value={l}>{l}</option>)}
              </select></div>
            <div><div style={lab}>MACHINE NO</div>
              <select style={{ ...sels, minWidth: 190 }} value={mno} onChange={(e) => { setMno(e.target.value); setSel(null); setSheet(null); }} disabled={!line}>
                <option value="">— all machines —</option>
                {mcOpts.map((m) => <option key={m.machine_no} value={m.machine_no}>{m.machine_no}</option>)}
              </select></div>
            <div><div style={lab}>MACHINE NAME</div>
              <input readOnly value={mcSel?.machine_name || ""} placeholder="— auto —"
                     style={{ ...sels, minWidth: 230, background: "#f8fafc", color: "#334155", cursor: "default" }} /></div>
            <div><div style={lab}>MONTH</div>
              <input type="month" style={{ ...sels, minWidth: 150 }} value={month}
                     onChange={(e) => { setMonth(e.target.value); setOnDate(""); setSel(null); setSheet(null); }} /></div>
            <div><div style={lab}>DATE (optional)</div>
              <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                <input type="date" style={{ ...sels, minWidth: 160 }} value={onDate}
                       onChange={(e) => { const v = e.target.value; setOnDate(v);
                                          if (v) setMonth(v.slice(0, 7)); setSel(null); setSheet(null); }} />
                {onDate && (
                  <button onClick={() => { setOnDate(""); setSel(null); setSheet(null); }} title="Clear date"
                          style={{ border: "1px solid #cbd5e1", background: "#fff", color: "#64748b", borderRadius: 7,
                                   padding: "8px 10px", cursor: "pointer", fontWeight: 800, fontSize: 12 }}>✕</button>
                )}
              </span></div>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700, color: "#334155", marginBottom: 8 }}>
              <input type="checkbox" checked={onlyPending} onChange={(e) => setOnlyPending(e.target.checked)} />
              Only pending
            </label>
          </div>

          {msg && (
            <div style={{ ...card, marginBottom: 14, borderLeft: "4px solid #16a34a", color: "#15803d", fontWeight: 700, fontSize: 13 }}>{msg}</div>
          )}

          {/* counts for the current filter */}
          <div style={{ display: "flex", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
            {[["⏳ Pending", counts.pending, "#b45309", "#fffbeb", "#fde68a"],
              ["✅ Verified", counts.verified, "#16a34a", "#f0fdf4", "#bbf7d0"],
              ["📋 Total submitted", counts.total, "#334155", "#f8fafc", "#e2e8f0"]].map(([t, n, c, bg, bd2]) => (
              <div key={t} style={{ flex: "1 1 180px", background: bg, border: `1px solid ${bd2}`,
                                    borderRadius: 12, padding: "14px 18px" }}>
                <div style={{ fontSize: 28, fontWeight: 800, color: c, lineHeight: 1.1 }}>{n}</div>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: "#64748b", marginTop: 2 }}>{t}</div>
              </div>
            ))}
          </div>

          {/* pending list */}
          <div style={{ ...card, marginBottom: 14 }}>
            <div style={{ fontWeight: 800, fontSize: 13, color: "#0f172a", marginBottom: 10 }}>
              {onlyPending ? "⏳ Awaiting my verification" : "📋 All submitted dates"}
              <span style={{ fontWeight: 600, color: "#94a3b8" }}> ({rows.length})</span>
              <span style={{ fontWeight: 600, color: "#94a3b8" }}> · {onDate ? dateLabel(onDate) : monthLabel(month)}</span>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>{["Date", "Zone", "Line", "Machine No", "Machine Name", "Points", "NG", "Operator", "Status", ""]
                  .map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
                <tbody>
                  {loading && <tr><td colSpan={10} style={{ ...td, textAlign: "center", color: "#94a3b8" }}>Loading…</td></tr>}
                  {!loading && rows.length === 0 && (
                    <tr><td colSpan={10} style={{ ...td, textAlign: "center", color: "#94a3b8" }}>
                      {onlyPending ? "Nothing pending — all submitted dates are verified. 🎉" : "No submitted dates for this filter."}
                    </td></tr>
                  )}
                  {rows.map((r) => (
                    <tr key={`${r.fill_id}_${r.day}`} style={{ background: sel && sel.fill_id === r.fill_id && sel.day === r.day ? "#eff6ff" : "#fff" }}>
                      <td style={{ ...td, fontWeight: 800 }}>{dateLabel(r.date)}</td>
                      <td style={td}>{r.zone_name}</td>
                      <td style={td}>{r.line_name}</td>
                      <td style={{ ...td, fontWeight: 700 }}>{r.machine_no}</td>
                      <td style={td}>{r.machine_name}</td>
                      <td style={{ ...td, textAlign: "center" }}>{r.points_filled}</td>
                      <td style={{ ...td, textAlign: "center", fontWeight: 800, color: r.ng_count ? "#dc2626" : "#94a3b8" }}>{r.ng_count || "—"}</td>
                      <td style={{ ...td, letterSpacing: ".05em", fontWeight: 700 }}>{r.operator_code || r.filled_by || "—"}</td>
                      <td style={td}>{r.status === "VERIFIED"
                        ? <span style={{ color: "#16a34a", fontWeight: 800 }}>✅ Verified</span>
                        : <span style={{ color: "#b45309", fontWeight: 800 }}>⏳ Pending</span>}</td>
                      <td style={td}>
                        <button onClick={() => openDate(r)}
                                style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff",
                                         cursor: "pointer", fontSize: 11.5, fontWeight: 700, color: "#2563eb" }}>
                          {r.status === "VERIFIED" ? "View" : "Review & Sign"}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* the selected date's sheet + supervisor sign-off */}
          {sel && (
            sheetBusy ? (
              <div style={{ ...card, textAlign: "center", color: "#64748b", padding: 40 }}>Loading sheet…</div>
            ) : sheet ? (<>
              <div style={{ ...card, marginBottom: 12, display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
                <div style={{ fontWeight: 800, fontSize: 14, color: "#0f172a" }}>
                  {sel.machine_no} · {dateLabel(sel.date)}
                </div>
                {sel.status === "VERIFIED" ? (
                  <span style={{ fontSize: 12.5, fontWeight: 800, color: "#16a34a" }}>
                    ✅ Verified — code <b style={{ letterSpacing: ".06em" }}>{sheet.meta.supervisor_code || "—"}</b>
                    {sheet.meta.verified_by ? ` · ${sheet.meta.verified_by}` : ""}
                    {sheet.meta.verified_at ? ` · ${String(sheet.meta.verified_at).replace("T", " ")}` : ""}
                  </span>
                ) : (<>
                  <div><div style={lab}>SUPERVISOR CODE</div>
                    <input value={supCode} maxLength={20} placeholder="Enter your code"
                           onChange={(e) => setSupCode(e.target.value.toUpperCase())}
                           style={{ ...sels, minWidth: 200, letterSpacing: ".06em", fontWeight: 800 }} /></div>
                  {opNgPending.length > 0 && (
                    <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 800, color: "#b45309",
                                   background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "7px 11px" }}>
                      ⚠ {opNgPending.length} operator ✗ reason pending — neeche bharo
                    </span>
                  )}
                  <button onClick={verify} disabled={saving || opNgPending.length > 0}
                          title={opNgPending.length > 0 ? "Pehle operator ke NG points ka reason bharo" : ""}
                          style={{ marginLeft: opNgPending.length > 0 ? 10 : "auto", padding: "10px 24px", borderRadius: 8, border: "none",
                                   background: "#16a34a", color: "#fff", fontWeight: 800, fontSize: 14,
                                   opacity: opNgPending.length > 0 ? 0.5 : 1,
                                   cursor: opNgPending.length > 0 ? "not-allowed" : "pointer" }}>
                    {saving ? "Verifying…" : "✅ Verify & Submit"}</button>
                </>)}
                <button onClick={() => { setSel(null); setSheet(null); }}
                        style={{ padding: "9px 16px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff", color: "#64748b", fontWeight: 800, fontSize: 13, cursor: "pointer" }}>Close</button>
              </div>

              {/* operator rows are read-only; only the Line Leader's own rows
                  are fillable here — one predicate decides it per point */}
              <DmcSheet groups={groupDmcPoints(sheet.points)} days={[sel.day]} dayBandLabel={dateLabel(sel.date)}
                        editable={(p) => sheet.ownIds.has(String(p.id))} fillDay={sel.day}
                        onToggle={onToggle} onSetValue={onSetValue}
                        values={sheet.values} reasons={sheet.reasons} footer={sheet.footer}
                        signs={{ operator: sheet.meta.operator_code || "",
                                 supervisor: supCode || sheet.meta.supervisor_code || "",
                                 maintenance: sheet.meta.maintenance_code || "" }}
                        signableKeys={[]}
                        hdr={{ zone: sel.zone_name, line: sel.line_name, machine_no: sel.machine_no,
                               machine_name: sel.machine_name, month: monthLabel(sel.sheet_month),
                               date: dateLabel(sel.date), rev_no: sheet.header.rev_no, rev_date: sheet.header.rev_date }} />

              {/* operator ke ✗ points — Line Leader inka reason bhare (verify se pehle) */}
              {sel.status !== "VERIFIED" && opNgList.length > 0 && (
                <div style={{ ...card, marginTop: 12, borderLeft: "4px solid #dc2626" }}>
                  <div style={{ fontWeight: 800, fontSize: 14, color: "#b91c1c", marginBottom: 3 }}>
                    ✗ Operator Not-OK points — fill reason
                    <span style={{ fontWeight: 700, color: opNgPending.length ? "#b45309" : "#16a34a" }}>
                      {" "}({opNgPending.length ? `${opNgPending.length} pending` : "all filled ✓"})
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: "#64748b", marginBottom: 10 }}>
                    Operator ne ye points ✗ (Not-OK) mark kiye — har ek ka reason bharo. Reason bhare bina ye date verify nahi hogi.
                  </div>
                  {opNgList.map((p) => {
                    const rk = `${p.id}_${String(sel.day)}`;
                    const filled = (sheet.reasons[rk] || "").trim().length > 0;
                    return (
                      <div key={p.id} style={{ display: "flex", gap: 10, alignItems: "flex-start",
                                               padding: "9px 0", borderTop: "1px solid #f1f5f9" }}>
                        <div style={{ flex: "0 0 auto", width: 22, height: 22, borderRadius: 6, marginTop: 2,
                                      background: filled ? "#dcfce7" : "#fee2e2", color: filled ? "#16a34a" : "#dc2626",
                                      fontWeight: 800, fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          {filled ? "✓" : "✗"}
                        </div>
                        <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                          <div style={{ fontSize: 12.5, fontWeight: 700, color: "#0f172a" }}>#{p.s_no} · {p.check_point}</div>
                          {p.criteria && <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 5 }}>{p.criteria}</div>}
                          <textarea rows={2} value={sheet.reasons[rk] || ""} placeholder="Reason for ✗ (Not OK)…"
                                    onChange={(e) => onReason(p.id, sel.day, e.target.value)}
                                    style={{ width: "100%", boxSizing: "border-box", borderRadius: 8,
                                             border: `1px solid ${filled ? "#cbd5e1" : "#fca5a5"}`,
                                             padding: "7px 9px", fontSize: 12.5, fontFamily: "inherit", resize: "vertical" }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>) : null
          )}
        </div>
      </div>

      {/* ✗ reason — anchored at the cell that was just marked NG */}
      {ngPop && (() => {
        const p = sheet?.points.find((pt) => String(pt.id) === String(ngPop.id));
        const key = `${ngPop.id}_${ngPop.day}`;
        return (
          // reason bhare bina bahar-click se band NAHI hoga — ya reason bharo ya "Cancel ✗"
          <div style={{ position: "fixed", inset: 0, zIndex: 900 }}
               onClick={() => { if ((sheet?.reasons?.[key] || "").trim()) setNgPop(null); }}>
            <div onClick={(e) => e.stopPropagation()}
                 style={{ position: "fixed", width: 320,
                          left: Math.max(12, Math.min(ngPop.x, window.innerWidth - 336)),
                          top: Math.min(ngPop.y + 14, window.innerHeight - 210),
                          background: "#fff", border: "1px solid #fecaca", borderRadius: 10,
                          boxShadow: "0 12px 30px rgba(15,23,42,.25)", padding: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#b91c1c", marginBottom: 6 }}>
                ✗ Not-OK — reason zaroori hai
              </div>
              {p && <div style={{ fontSize: 11, color: "#475569", marginBottom: 8 }}>#{p.s_no} · {p.check_point}</div>}
              <textarea autoFocus rows={3} value={sheet?.reasons?.[key] || ""}
                        onChange={(e) => onReason(ngPop.id, ngPop.day, e.target.value)}
                        placeholder="Kya problem hai?"
                        style={{ width: "100%", boxSizing: "border-box", border: "1px solid #cbd5e1",
                                 borderRadius: 8, padding: 8, fontSize: 12.5, fontFamily: "inherit", resize: "vertical" }} />
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
                <button onClick={() => { setMark(ngPop.id, ngPop.day, ""); onReason(ngPop.id, ngPop.day, ""); setNgPop(null); }}
                        style={{ padding: "6px 12px", borderRadius: 7, border: "1px solid #cbd5e1", background: "#fff",
                                 fontSize: 12, fontWeight: 700, color: "#64748b", cursor: "pointer" }}>Cancel ✗</button>
                <button onClick={() => setNgPop(null)}
                        disabled={!(sheet?.reasons?.[key] || "").trim()}
                        style={{ padding: "6px 14px", borderRadius: 7, border: "none",
                                 background: (sheet?.reasons?.[key] || "").trim() ? "#dc2626" : "#94a3b8",
                                 color: "#fff", fontSize: 12, fontWeight: 800,
                                 cursor: (sheet?.reasons?.[key] || "").trim() ? "pointer" : "not-allowed" }}>Save reason</button>
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
}
