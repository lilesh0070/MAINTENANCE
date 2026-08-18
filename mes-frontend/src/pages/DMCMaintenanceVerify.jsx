/* ───────────────────────────────────────────────────────────────────
 * DMCMaintenanceVerify.jsx — "Maintenance Weekly" (Machine DMC)
 * ───────────────────────────────────────────────────────────────────
 * Stage 3 (final) of the Daily DMC approval chain:
 *   1. Operator fills a date + code        → day PENDING
 *   2. Supervisor verifies each date + code→ day VERIFIED
 *   3. Maintenance signs the WHOLE WEEK    → week SIGNED   ← this page
 *
 * A week (WK1=1-7 … WK5=29-31) becomes signable only once EVERY filled date
 * in it is supervisor-verified.  The reviewer sees the entire week's data at
 * once and signs it with their maintenance code.
 *
 * Routing: /maintenance-dmc-weekly — canAccess('maintenance-dmc-weekly').
 * ─────────────────────────────────────────────────────────────────── */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { DmcSheet, groupDmcPoints, monthDays, RESP_STAGE, isPointDue } from "./DmcSheet";

const monthNow = () => new Date().toISOString().slice(0, 7);
const MON = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (ym) => { if (!ym) return ""; const [y, m] = ym.split("-"); return `${MON[parseInt(m, 10)] || m} ${y}`; };
// Week days clamped to the month's real length (Feb has no 29-31, April no 31).
const WEEK_DAYS = (wk, ym) => {
  const last = monthDays(ym);
  const a = (wk - 1) * 7 + 1, b = Math.min(wk === 5 ? last : wk * 7, last);
  const r = []; for (let i = a; i <= b; i++) r.push(i); return r;
};
const WEEK_LABEL = (wk, ym) => {
  const d = WEEK_DAYS(wk, ym);
  return d.length ? `WK${wk} (${d[0]}–${d[d.length - 1]})` : `WK${wk}`;
};

const STATUS_UI = {
  SIGNED:             { t: "✅ Signed",              c: "#16a34a" },
  READY:              { t: "🔧 Ready to sign",       c: "#b45309" },
  PENDING_SUPERVISOR: { t: "⏳ Supervisor pending",  c: "#94a3b8" },
};

export default function DMCMaintenanceVerify() {
  const { theme, token } = useAuth();
  const navigate = useNavigate();
  const [machines, setMachines] = useState([]);
  const [zone, setZone] = useState("");
  const [line, setLine] = useState("");
  const [mno, setMno]   = useState("");
  const [month, setMonth] = useState(monthNow);
  const [onlyReady, setOnlyReady] = useState(false);
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({ ready: 0, signed: 0, waiting: 0, total: 0 });
  const [loading, setLoading] = useState(false);

  const [sel, setSel] = useState(null);        // selected week row
  const [sheet, setSheet] = useState(null);
  const [sheetBusy, setSheetBusy] = useState(false);
  const [ngPop, setNgPop] = useState(null);      // {id, day, x, y} — reason entry for a ✗
  const [maintCode, setMaintCode] = useState("");
  const [saving, setSaving] = useState(false);
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

  const loadList = useCallback(() => {
    setLoading(true);
    const q = new URLSearchParams();
    if (zone) q.set("zone", zone);
    if (line) q.set("line", line);
    if (mno)  q.set("machine_no", mno);
    if (month) q.set("month", month);
    if (onlyReady) q.set("only_ready", "true");
    api(`/pending-maint?${q.toString()}`)
      .then((d) => { setRows(d.rows || []); setCounts(d.counts || { ready: 0, signed: 0, waiting: 0, total: 0 }); })
      .catch(() => { setRows([]); setCounts({ ready: 0, signed: 0, waiting: 0, total: 0 }); })
      .finally(() => setLoading(false));
  }, [api, zone, line, mno, month, onlyReady]);
  useEffect(() => { loadList(); }, [loadList]);

  // open one WEEK — the whole week's data in one sheet
  const openWeek = async (row) => {
    setSel(row); setSheet(null); setMsg(""); setMaintCode(row.maintenance_code || "");
    setSheetBusy(true);
    try {
      const q = `zone=${encodeURIComponent(row.zone_name)}&line=${encodeURIComponent(row.line_name)}&machine_no=${encodeURIComponent(row.machine_no)}`;
      const [fill, fmt, live] = await Promise.all([
        api(`/check-sheet-fill-current?${q}&month=${encodeURIComponent(row.sheet_month)}`),
        api(`/format`).catch(() => null),
        // Maintenance's OWN points — never submitted by the earlier stages, so
        // they come from the live master, not the saved snapshot
        api(`/points?machine_no=${encodeURIComponent(row.machine_no)}`).catch(() => null),
      ]);
      const wk = new Set(WEEK_DAYS(row.week, row.sheet_month).map(String));
      const v = {}, r = {};
      (fill?.entries || []).forEach((e) => {
        Object.entries(e.days || {}).forEach(([d, val]) => { if (val && wk.has(String(d))) v[`${e.id}_${d}`] = val; });
        Object.entries(e.reasons || {}).forEach(([d, val]) => { if (val && wk.has(String(d))) r[`${e.id}_${d}`] = val; });
      });
      const dmeta = fill?.day_meta || {};
      // codes across the week (operator/supervisor may differ per day — show the last)
      let opCode = "", supCode = "";
      WEEK_DAYS(row.week, row.sheet_month).forEach((d) => {
        const m = dmeta[String(d)] || {};
        if (m.operator_code) opCode = m.operator_code;
        if (m.supervisor_code) supCode = m.supervisor_code;
      });
      // render from the SAVED entries (fill-time point ids), limited to points
      // actually filled somewhere in this week
      const pts = (fill?.entries || []).filter((e) =>
        Object.keys(e.days || {}).some((d) => wk.has(String(d))));
      // Maintenance writes on ONE date of the week — it must be a date the
      // supervisor already VERIFIED (the server rejects anything else), so use
      // the last verified day of the week.
      const fillDay = WEEK_DAYS(row.week, row.sheet_month)
        .filter((d) => String((dmeta[String(d)] || {}).status || "").toUpperCase() === "VERIFIED")
        .pop() || null;
      const have = new Set(pts.map((e) => String(e.id)));
      const mtPts = fillDay == null ? [] : ((live?.points) || [])
        .filter((p) => RESP_STAGE(p.resp) === "maintenance")
        .filter((p) => !have.has(String(p.id)))
        .filter((p) => isPointDue(p, Number(fillDay), row.sheet_month, (pid, x) => v[`${pid}_${x}`]));
      setSheet({ points: [...pts, ...mtPts], ownIds: new Set(mtPts.map((p) => String(p.id))),
                 fillDay,
                 header: { rev_no: fill?.rev_no, rev_date: fill?.rev_date },
                 values: v, reasons: r,
                 opCode, supCode, footer: (fmt && fmt.format && fmt.format.doc_footer) || null });
    } catch (e) { setMsg(String(e.message || e)); }
    finally { setSheetBusy(false); }
  };

  // maintenance ticks / types into ITS OWN rows only
  const setMark = (pid, d, val) =>
    setSheet((s) => s ? { ...s, values: { ...s.values, [`${pid}_${d}`]: val } } : s);
  const onReason = (pid, d, txt) =>
    setSheet((s) => s ? { ...s, reasons: { ...s.reasons, [`${pid}_${d}`]: txt } } : s);
  const onToggle = (pid, d, e) => {
    const next = { "": "OK", OK: "NG", NG: "" }[String(sheet?.values?.[`${pid}_${d}`] || "")];
    setMark(pid, d, next);
    if (next === "NG") setNgPop({ id: pid, day: d, x: e?.clientX || 300, y: e?.clientY || 200 });
  };
  const onSetValue = (pid, d, val) => setMark(pid, d, val);

  const ownEntries = () => {
    if (!sheet || sheet.fillDay == null) return [];
    const d0 = String(sheet.fillDay);
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
    if (!sheet || sheet.fillDay == null) return [];
    const d0 = String(sheet.fillDay);
    return sheet.points.filter((p) => sheet.ownIds.has(String(p.id)) && !sheet.values[`${p.id}_${d0}`]);
  };

  const signWeek = async () => {
    if (!maintCode.trim()) { alert("Enter your maintenance code before signing the week."); return; }
    const missing = ownPending();
    if (missing.length) {
      alert(`Fill your own (Maintenance) points first — ${missing.length} still empty.`);
      return;
    }
    const d0 = String(sheet?.fillDay);
    const noReason = ownEntries().filter((e) => e.days[d0] === "NG" && !(e.reasons[d0] || "").trim());
    if (noReason.length) { alert(`A ✗ needs a reason — ${noReason.length} point(s) without one.`); return; }
    setSaving(true);
    try {
      await api(`/maint-sign-week`, { method: "PUT", body: JSON.stringify({
        zone: sel.zone_name, line: sel.line_name, machine_no: sel.machine_no,
        sheet_month: sel.sheet_month, week: sel.week,
        maintenance_code: maintCode.trim().toUpperCase(),
        entries: ownEntries() }) });
      setMsg(`✅ ${sel.machine_no} · ${WEEK_LABEL(sel.week, sel.sheet_month)} signed.`);
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
  const clr = () => { setSel(null); setSheet(null); };
  const onZone = (v) => { setZone(v); setLine(""); setMno(""); clr(); };
  const onLine = (v) => { setLine(v); setMno(""); clr(); };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700;800&family=Barlow+Condensed:wght@600;700;800&display=swap');
        .mw-root { min-height:100vh; background:#f8fafc; font-family:'Barlow',sans-serif; padding-bottom:80px; }
        .mw-topbar { background:#fff; border-bottom:1px solid #e2e8f0; padding:0 40px 0 88px; height:60px;
          display:flex; align-items:center; justify-content:space-between; position:sticky; top:0; z-index:100;
          box-shadow:0 1px 3px rgba(0,0,0,.06); }
        .mw-topbar::after { content:''; position:absolute; bottom:0; left:0; right:0; height:2px; background:${theme.gradient}; }
        .mw-title { position:absolute; left:50%; transform:translateX(-50%); font-family:'Barlow Condensed',sans-serif;
          font-size:32px; font-weight:800; color:#0f172a; pointer-events:none; white-space:nowrap; }
        .mw-title span { color:${theme.accent}; }
        .mw-body { padding:20px; max-width:1600px; margin:0 auto; }
      `}</style>
      <div className="mw-root">
        <div className="mw-topbar"><div /><div className="mw-title">🔧 Maintenance <span>Weekly</span></div><div /></div>

        <div className="mw-body">
          <button onClick={() => navigate("/maintenance-machine-dmc")}
            style={{ marginBottom: 14, padding: "8px 16px", borderRadius: 8, border: "1px solid #cbd5e1",
                     background: "#fff", cursor: "pointer", fontWeight: 800, fontSize: 13, color: "#334155" }}>← Machine DMC</button>

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
              <select style={{ ...sels, minWidth: 190 }} value={mno} onChange={(e) => { setMno(e.target.value); clr(); }} disabled={!line}>
                <option value="">— all machines —</option>
                {mcOpts.map((m) => <option key={m.machine_no} value={m.machine_no}>{m.machine_no}</option>)}
              </select></div>
            <div><div style={lab}>MACHINE NAME</div>
              <input readOnly value={mcSel?.machine_name || ""} placeholder="— auto —"
                     style={{ ...sels, minWidth: 230, background: "#f8fafc", color: "#334155", cursor: "default" }} /></div>
            <div><div style={lab}>MONTH</div>
              <input type="month" style={{ ...sels, minWidth: 150 }} value={month}
                     onChange={(e) => { setMonth(e.target.value); clr(); }} /></div>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700, color: "#334155", marginBottom: 8 }}>
              <input type="checkbox" checked={onlyReady} onChange={(e) => setOnlyReady(e.target.checked)} />
              Only ready to sign
            </label>
          </div>

          {msg && <div style={{ ...card, marginBottom: 14, borderLeft: "4px solid #16a34a", color: "#15803d", fontWeight: 700, fontSize: 13 }}>{msg}</div>}

          <div style={{ display: "flex", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
            {[["🔧 Ready to sign", counts.ready, "#b45309", "#fffbeb", "#fde68a"],
              ["✅ Signed", counts.signed, "#16a34a", "#f0fdf4", "#bbf7d0"],
              ["⏳ Supervisor pending", counts.waiting, "#64748b", "#f8fafc", "#e2e8f0"]].map(([t, n, c, bg, bd]) => (
              <div key={t} style={{ flex: "1 1 180px", background: bg, border: `1px solid ${bd}`, borderRadius: 12, padding: "14px 18px" }}>
                <div style={{ fontSize: 28, fontWeight: 800, color: c, lineHeight: 1.1 }}>{n}</div>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: "#64748b", marginTop: 2 }}>{t}</div>
              </div>
            ))}
          </div>

          <div style={{ ...card, marginBottom: 14 }}>
            <div style={{ fontWeight: 800, fontSize: 13, color: "#0f172a", marginBottom: 10 }}>
              📅 Weeks <span style={{ fontWeight: 600, color: "#94a3b8" }}>({rows.length}) · {monthLabel(month)}</span>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>{["Week", "Zone", "Line", "Machine No", "Machine Name", "Dates", "Verified", "NG", "Status", ""]
                  .map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
                <tbody>
                  {loading && <tr><td colSpan={10} style={{ ...td, textAlign: "center", color: "#94a3b8" }}>Loading…</td></tr>}
                  {!loading && rows.length === 0 && (
                    <tr><td colSpan={10} style={{ ...td, textAlign: "center", color: "#94a3b8" }}>
                      No weeks for this filter yet.</td></tr>)}
                  {rows.map((r) => {
                    const ui = STATUS_UI[r.status] || STATUS_UI.PENDING_SUPERVISOR;
                    const isSel = sel && sel.fill_id === r.fill_id && sel.week === r.week;
                    return (
                      <tr key={`${r.fill_id}_${r.week}`} style={{ background: isSel ? "#eff6ff" : "#fff" }}>
                        <td style={{ ...td, fontWeight: 800 }}>{WEEK_LABEL(r.week, r.sheet_month)}</td>
                        <td style={td}>{r.zone_name}</td>
                        <td style={td}>{r.line_name}</td>
                        <td style={{ ...td, fontWeight: 700 }}>{r.machine_no}</td>
                        <td style={td}>{r.machine_name}</td>
                        <td style={{ ...td, textAlign: "center" }}>{r.dates_filled}</td>
                        <td style={{ ...td, textAlign: "center" }}>{r.dates_verified}/{r.dates_filled}</td>
                        <td style={{ ...td, textAlign: "center", fontWeight: 800, color: r.ng_count ? "#dc2626" : "#94a3b8" }}>{r.ng_count || "—"}</td>
                        <td style={{ ...td, fontWeight: 800, color: ui.c }}>{ui.t}
                          {r.status === "SIGNED" && r.maintenance_code
                            ? <span style={{ fontWeight: 700, color: "#64748b", letterSpacing: ".05em" }}> · {r.maintenance_code}</span> : null}</td>
                        <td style={td}>
                          <button onClick={() => openWeek(r)}
                                  style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff",
                                           cursor: "pointer", fontSize: 11.5, fontWeight: 700, color: "#2563eb" }}>
                            {r.status === "READY" ? "Review & Sign" : "View week"}</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {sel && (sheetBusy ? (
            <div style={{ ...card, textAlign: "center", color: "#64748b", padding: 40 }}>Loading week…</div>
          ) : sheet ? (<>
            <div style={{ ...card, marginBottom: 12, display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
              <div style={{ fontWeight: 800, fontSize: 14, color: "#0f172a" }}>
                {sel.machine_no} · {WEEK_LABEL(sel.week, sel.sheet_month)} · {monthLabel(sel.sheet_month)}
              </div>
              {sel.status === "SIGNED" ? (
                <span style={{ fontSize: 12.5, fontWeight: 800, color: "#16a34a" }}>
                  ✅ Signed — code <b style={{ letterSpacing: ".06em" }}>{sel.maintenance_code || "—"}</b>
                  {sel.signed_at ? ` · ${String(sel.signed_at).replace("T", " ")}` : ""}
                </span>
              ) : sel.status === "READY" ? (<>
                <div><div style={lab}>MAINTENANCE CODE</div>
                  <input value={maintCode} maxLength={20} placeholder="Enter your code"
                         onChange={(e) => setMaintCode(e.target.value.toUpperCase())}
                         style={{ ...sels, minWidth: 200, letterSpacing: ".06em", fontWeight: 800 }} /></div>
                <button onClick={signWeek} disabled={saving}
                        style={{ marginLeft: "auto", padding: "10px 24px", borderRadius: 8, border: "none",
                                 background: "#16a34a", color: "#fff", fontWeight: 800, fontSize: 14, cursor: "pointer" }}>
                  {saving ? "Signing…" : "🔧 Sign this week"}</button>
              </>) : (
                <span style={{ fontSize: 12.5, fontWeight: 800, color: "#b45309" }}>
                  ⏳ {sel.dates_filled - sel.dates_verified} date(s) still awaiting supervisor verification — cannot sign yet.
                </span>
              )}
              <button onClick={clr}
                      style={{ padding: "9px 16px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff", color: "#64748b", fontWeight: 800, fontSize: 13, cursor: "pointer" }}>Close</button>
            </div>

            {/* earlier stages' rows are read-only; only Maintenance's own rows fill here */}
            <DmcSheet editable={(p) => sheet.ownIds.has(String(p.id))} fillDay={sheet.fillDay}
                      onToggle={onToggle} onSetValue={onSetValue}
                      groups={groupDmcPoints(sheet.points)} days={WEEK_DAYS(sel.week, sel.sheet_month)} dayBandLabel={WEEK_LABEL(sel.week, sel.sheet_month)}
                      values={sheet.values} reasons={sheet.reasons} footer={sheet.footer} signableKeys={[]}
                      signs={{ operator: sheet.opCode, supervisor: sheet.supCode,
                               maintenance: maintCode || sel.maintenance_code || "" }}
                      hdr={{ zone: sel.zone_name, line: sel.line_name, machine_no: sel.machine_no,
                             machine_name: sel.machine_name, month: monthLabel(sel.sheet_month),
                             rev_no: sheet.header.rev_no, rev_date: sheet.header.rev_date }} />
          </>) : null)}
        </div>
      </div>

      {/* ✗ reason — anchored at the cell that was just marked NG */}
      {ngPop && (() => {
        const p = sheet?.points.find((pt) => String(pt.id) === String(ngPop.id));
        const key = `${ngPop.id}_${ngPop.day}`;
        const has = (sheet?.reasons?.[key] || "").trim();
        return (
          // reason bhare bina bahar-click se band NAHI hoga — ya reason bharo ya "Cancel ✗"
          <div style={{ position: "fixed", inset: 0, zIndex: 900 }} onClick={() => { if (has) setNgPop(null); }}>
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
                <button onClick={() => setNgPop(null)} disabled={!has}
                        style={{ padding: "6px 14px", borderRadius: 7, border: "none",
                                 background: has ? "#dc2626" : "#94a3b8", color: "#fff", fontSize: 12,
                                 fontWeight: 800, cursor: has ? "pointer" : "not-allowed" }}>Save reason</button>
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
}
