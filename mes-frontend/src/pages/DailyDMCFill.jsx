/* ───────────────────────────────────────────────────────────────────
 * DailyDMCFill.jsx — "Daily DMC Fill" (Maintenance)
 * ───────────────────────────────────────────────────────────────────
 * The shop-floor operator's daily fill surface for the Daily Machine Check
 * Sheet (DMC).  Flow:
 *   • pick zone → line → machine + Month
 *   • the machine's CURRENT check points render as a fillable monthly sheet
 *   • click a day-cell to cycle blank → ✓ (OK) → ✗ (NG) → blank
 *   • enter the three sign-off names
 *   • Save → one row per (machine, month) in machine_dmc_filled (upsert), so
 *     the operator keeps ticking through the month and re-saves.  Re-opening a
 *     month resumes the saved ticks.
 *
 * Routing: /maintenance-daily-dmc — canAccess('maintenance-daily-dmc').
 * Uses the shared DmcSheet renderer in `editable` mode.
 * ─────────────────────────────────────────────────────────────────── */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { DmcSheet, groupDmcPoints, freqClass, monthDays, RESP_STAGE,
         isPointDue } from "./DmcSheet";

const todayISO = () => new Date().toISOString().slice(0, 10);  // YYYY-MM-DD
const dateLabel = (iso) => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  const names = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${parseInt(d, 10)} ${names[parseInt(m, 10)] || m} ${y}`;
};
const monthLabel = (ym) => {
  if (!ym) return "";
  const [y, m] = ym.split("-");
  const names = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[parseInt(m, 10)] || m} ${y}`;
};

// ── frequency scheduling ──────────────────────────────────────────────────
// Week blocks (WK1=1-7 … WK5=29-31), the month-length clamping and the
// "is this point still due?" rule all live in DmcSheet now — imported here so
// the sheet's column grouping and this page's scheduling can never drift, and
// so the supervisor / maintenance screens schedule identically.

export default function DailyDMCFill() {
  const { theme, token } = useAuth();
  const navigate = useNavigate();
  const [machines, setMachines] = useState([]);
  const [zone, setZone] = useState("");
  const [line, setLine] = useState("");
  const [mno, setMno]   = useState("");
  const [fillDate, setFillDate] = useState(todayISO);   // YYYY-MM-DD (the day being filled)
  const month = fillDate.slice(0, 7);                   // storage bucket (per month)
  const day   = parseInt(fillDate.slice(8, 10), 10);    // the single day column shown
  const [points, setPoints] = useState([]);
  const [header, setHeader] = useState({});      // rev info from /points
  const [values, setValues] = useState({});      // `${id}_${day}` -> OK|NG|<numeric>  (editable)
  const [savedValues, setSavedValues] = useState({});  // submitted history — drives frequency scheduling
  const [reasons, setReasons] = useState({});    // `${id}_${day}` -> reason (for ✗ NG)
  const [reasonPopup, setReasonPopup] = useState(null);  // { id, day, x, y } — reason entry popup
  const [lockedDays, setLockedDays] = useState({});      // { dayNum: true } — dates already submitted (view-only)
  const [signs, setSigns]   = useState({});      // {operator, supervisor, maintenance} — sign-off CODES
  const [dayMeta, setDayMeta]   = useState({});  // per-date sign-off + approval state
  const [footer, setFooter] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [status, setStatus]   = useState("");    // "resumed" | "saved" | ""

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

  useEffect(() => {
    api(`/machines`).then((d) => setMachines(Array.isArray(d) ? d : [])).catch(() => {});
    api(`/format`).then((d) => setFooter((d && d.format && d.format.doc_footer) || null)).catch(() => {});
  }, [api]);

  const zoneOpts = useMemo(() => [...new Set(machines.map((m) => m.zone).filter(Boolean))].sort(), [machines]);
  const lineOpts = useMemo(() => zone
    ? [...new Set(machines.filter((m) => m.zone === zone).map((m) => m.line).filter(Boolean))].sort() : [], [machines, zone]);
  const mcOpts = useMemo(() => (zone && line)
    ? machines.filter((m) => m.zone === zone && m.line === line && m.machine_no)
              .sort((a, b) => String(a.machine_no).localeCompare(String(b.machine_no))) : [], [machines, zone, line]);
  const mcSel = mcOpts.find((m) => String(m.machine_no) === String(mno)) || null;

  // Load the machine's check points — by machine_no only (machine_no is unique
  // in machine_dmc).  DECOUPLED from the fill-resume below so that a resume
  // failure (e.g. endpoint 404 on an un-restarted backend) can NEVER clear the
  // points — that was dropping the whole sheet.
  useEffect(() => {
    if (!mno) { setPoints([]); setHeader({}); return; }
    setLoading(true);
    api(`/points?machine_no=${encodeURIComponent(mno)}`)
      // STAGE 1 — the operator only ever sees his OWN points (resp = OPERATOR).
      // Line-Leader points appear on the Supervisor screen, Maintenance points
      // on the Maintenance screen; each stage fills only what it owns.
      .then((pts) => {
        setPoints((pts.points || []).filter((p) => RESP_STAGE(p.resp) === "operator"));
        setHeader(pts.header || {});
      })
      .catch(() => { setPoints([]); setHeader({}); })
      .finally(() => setLoading(false));
  }, [api, mno]);

  // Resume any saved fill for this (machine, month) — independent; on failure we
  // just start blank, the points stay loaded.
  useEffect(() => {
    if (!mno || !month) { setValues({}); setSavedValues({}); setReasons({}); setDayMeta({}); setLockedDays({}); setStatus(""); return; }
    const q = `zone=${encodeURIComponent(zone)}&line=${encodeURIComponent(line)}&machine_no=${encodeURIComponent(mno)}`;
    api(`/check-sheet-fill-current?${q}&month=${encodeURIComponent(month)}`)
      .then((fill) => {
        const v = {}, r = {}, ld = {};
        if (fill && Array.isArray(fill.entries)) {
          fill.entries.forEach((e) => {
            const days = e.days || {};
            Object.keys(days).forEach((d) => { if (days[d]) { v[`${e.id}_${d}`] = days[d]; ld[parseInt(d, 10)] = true; } });
            const rz = e.reasons || {};
            Object.keys(rz).forEach((d) => { if (rz[d]) r[`${e.id}_${d}`] = rz[d]; });
          });
        }
        setValues(v);
        setSavedValues(v);   // the submitted history that frequency scheduling reads
        setReasons(r);
        setLockedDays(ld);   // any day already present in the saved record = locked (view-only)
        setDayMeta((fill && fill.day_meta) || {});   // per-date signs/status
        setStatus(fill ? "resumed" : "");
      })
      .catch(() => { setValues({}); setSavedValues({}); setReasons({}); setDayMeta({}); setLockedDays({}); setStatus(""); });
  }, [api, zone, line, mno, month]);

  // Sign-off is PER DATE — pull the shown day's names/signatures out of day_meta.
  useEffect(() => {
    const m = dayMeta[String(day)] || {};
    setSigns({ operator: m.operator_code || "", supervisor: m.supervisor_code || "",
               maintenance: m.maintenance_code || "" });
  }, [dayMeta, day]);

  const dayStatus = (dayMeta[String(day)] || {}).status || "";   // "" | PENDING | VERIFIED

  const onZone = (v) => { setZone(v); setLine(""); setMno(""); };
  const onLine = (v) => { setLine(v); setMno(""); };

  const onToggle = (id, day, e) => {
    setStatus("");
    const k = `${id}_${day}`;
    const cur = values[k] || "";
    const next = cur === "" ? "OK" : cur === "OK" ? "NG" : "";   // cycle blank→OK→NG→blank
    setValues((s) => { const n = { ...s }; if (next) n[k] = next; else delete n[k]; return n; });
    if (next === "NG") {
      // ✗ → open the reason popup right at the clicked cell
      setReasonPopup({ id, day, x: (e && e.clientX) || 200, y: (e && e.clientY) || 200 });
    } else {
      // no longer NG → drop its reason + close any popup
      setReasonPopup(null);
      setReasons((r) => { if (!(k in r)) return r; const n = { ...r }; delete n[k]; return n; });
    }
  };
  // "value"-type points: store the numeric reading the operator types
  const onSetValue = (id, day, raw) => {
    setStatus("");
    const val = (raw || "").replace(/[^0-9.]/g, "");   // numeric only
    setValues((s) => {
      const k = `${id}_${day}`;
      const n = { ...s };
      if (val) n[k] = val; else delete n[k];
      return n;
    });
  };
  const onReason = (id, day, val) => { setStatus(""); setReasons((r) => ({ ...r, [`${id}_${day}`]: val })); };
  const onSign = (k, val) => { setStatus(""); setSigns((s) => ({ ...s, [k]: String(val).toUpperCase() })); };

  // ── which points are DUE on this date (frequency scheduling) ──
  // D: every day.  W/2W/M: shown until OK'd once in the period; a ✗ keeps it
  // showing on later days until OK; after OK it hides for the rest of the period.
  // A period is satisfied by any non-blank mark that isn't ✗ — i.e. an "OK"
  // tick OR a recorded numeric reading (type='value' points never store "OK",
  // so matching the literal string alone made them due forever).
  // scheduling reads the SUBMITTED history (savedValues), never the draft
  const isDue = (p, d) => isPointDue(p, d, month, (pid, x) => savedValues[`${pid}_${x}`]);
  const visiblePoints = points.filter((p) => isDue(p, day));
  const filledToday = visiblePoints.reduce((n, p) => n + (values[`${p.id}_${day}`] ? 1 : 0), 0);
  const dayLocked = !!lockedDays[day];   // this date already submitted → view-only

  const save = async () => {
    if (!points.length) { alert("No check points for this machine."); return; }
    // all DUE daily points must be filled (OK / ✗) before submit
    const dueDaily = visiblePoints.filter((p) => freqClass(p.freq) === "D");
    const dailyMissing = dueDaily.filter((p) => !values[`${p.id}_${day}`]);
    if (dailyMissing.length) {
      alert(`All daily points must be filled before submit — ${dailyMissing.length} of ${dueDaily.length} still empty.`);
      return;
    }
    // the operator MUST enter their code before submitting for verification
    if (!(signs.operator || "").trim()) {
      alert("Enter the Machine Operator code in the sign-off row before submitting.");
      return;
    }
    // every ✗ (Not OK) mark on this day MUST carry a reason before saving
    const ngMissing = points.filter((p) => values[`${p.id}_${day}`] === "NG"
                                        && !(reasons[`${p.id}_${day}`] || "").trim());
    if (ngMissing.length) {
      const first = ngMissing[0];   // pop the reason box for the first one to guide the operator
      setReasonPopup({ id: first.id, day, x: window.innerWidth / 2 - 160, y: 150 });
      alert(`Enter a reason for ${ngMissing.length} Not-OK (✗) point(s) before saving.`);
      return;
    }
    setSaving(true);
    try {
      const entries = points.map((p) => {
        const days = {}, rz = {};
        for (let d = 1; d <= monthDays(month); d++) {
          const v = values[`${p.id}_${d}`]; if (v) days[String(d)] = v;
          const r = reasons[`${p.id}_${d}`]; if (r && String(r).trim()) rz[String(d)] = String(r).trim();
        }
        return { id: p.id, s_no: p.s_no, category: p.category, check_point: p.check_point,
                 criteria: p.criteria, method: p.method, resp: p.resp, freq: p.freq, type: p.type,
                 days, reasons: rz };
      });
      // stamp THIS date's sign-off; supervisor verification still pending
      const nextMeta = {
        ...dayMeta,
        [String(day)]: {
          ...(dayMeta[String(day)] || {}),
          status: "PENDING",
          operator_code: (signs.operator || "").trim(),
          // supervisor_code is stamped by Supervisor Verify; maintenance signs
          // the whole WEEK from Maintenance Weekly (week_meta) — not here.
        },
      };
      await api(`/check-sheet-fill`, { method: "POST", body: JSON.stringify({
        zone, line, machine_no: mno, machine_name: mcSel?.machine_name || header.machine_name || "",
        sheet_month: month, rev_no: header.rev_no || "", rev_date: header.rev_date || "",
        entries, signs, day_meta: nextMeta }) });
      setDayMeta(nextMeta);
      setStatus("saved");
      setLockedDays((ld) => ({ ...ld, [day]: true }));   // lock this date after submit
      setSavedValues((sv) => {   // fold today's marks into the history so next dates schedule correctly
        const n = { ...sv };
        points.forEach((p) => { const k = `${p.id}_${day}`; if (values[k]) n[k] = values[k]; });
        return n;
      });
    } catch (e) { alert(String(e.message || e)); }
    finally { setSaving(false); }
  };

  const sel = { padding: "8px 10px", borderRadius: 8, border: "1px solid #cbd5e1", fontSize: 13, fontWeight: 600, minWidth: 180, background: "#fff" };
  const lab = { fontSize: 10.5, fontWeight: 800, color: "#64748b", marginBottom: 4 };
  const groups = groupDmcPoints(visiblePoints);   // only the points due on this date

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700;800&family=Barlow+Condensed:wght@600;700;800&display=swap');
        .ddf-root { min-height:100vh; background:#f8fafc; font-family:'Barlow',sans-serif; padding-bottom:80px; }
        .ddf-topbar { background:#fff; border-bottom:1px solid #e2e8f0; padding:0 40px 0 88px; height:60px;
          display:flex; align-items:center; justify-content:space-between; position:sticky; top:0; z-index:100;
          box-shadow:0 1px 3px rgba(0,0,0,.06); }
        .ddf-topbar::after { content:''; position:absolute; bottom:0; left:0; right:0; height:2px; background:${theme.gradient}; }
        .ddf-title { position:absolute; left:50%; transform:translateX(-50%); font-family:'Barlow Condensed',sans-serif;
          font-size:32px; font-weight:800; color:#0f172a; pointer-events:none; white-space:nowrap; }
        .ddf-title span { color:${theme.accent}; }
        .ddf-body { padding:20px; max-width:1600px; margin:0 auto; }
      `}</style>
      <div className="ddf-root">
        <div className="ddf-topbar"><div /><div className="ddf-title">📝 Operator <span>DMC Fill</span></div><div /></div>

        <div className="ddf-body">
          <button onClick={() => navigate("/maintenance-machine-dmc")}
            style={{ marginBottom: 14, padding: "8px 16px", borderRadius: 8, border: "1px solid #cbd5e1",
                     background: "#fff", cursor: "pointer", fontWeight: 800, fontSize: 13, color: "#334155" }}>← Machine DMC</button>
          {/* picker */}
          <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 16, marginBottom: 14,
                        display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div><div style={lab}>ZONE</div>
              <select style={sel} value={zone} onChange={(e) => onZone(e.target.value)}>
                <option value="">— zone —</option>{zoneOpts.map((z) => <option key={z} value={z}>{z}</option>)}
              </select></div>
            <div><div style={lab}>LINE</div>
              <select style={sel} value={line} onChange={(e) => onLine(e.target.value)} disabled={!zone}>
                <option value="">— line —</option>{lineOpts.map((l) => <option key={l} value={l}>{l}</option>)}
              </select></div>
            <div><div style={lab}>MACHINE NO</div>
              <select style={{ ...sel, minWidth: 190 }} value={mno} onChange={(e) => setMno(e.target.value)} disabled={!line}>
                <option value="">— machine no —</option>
                {mcOpts.map((m) => <option key={m.machine_no} value={m.machine_no}>{m.machine_no}</option>)}
              </select></div>
            <div><div style={lab}>MACHINE NAME</div>
              <input readOnly value={mcSel?.machine_name || ""} placeholder="— auto —"
                     style={{ ...sel, minWidth: 240, background: "#f8fafc", color: "#334155", cursor: "default" }} /></div>
            <div><div style={lab}>DATE</div>
              <input type="date" style={{ ...sel, minWidth: 160 }} value={fillDate} onChange={(e) => setFillDate(e.target.value)} /></div>
            {mno && (
              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 14 }}>
                {dayLocked ? (
                  dayStatus === "VERIFIED" ? (
                    <span style={{ fontSize: 13, fontWeight: 800, color: "#16a34a" }}>✅ Verified by supervisor — submitted</span>
                  ) : (
                    <span style={{ fontSize: 13, fontWeight: 800, color: "#b45309" }}>⏳ Awaiting supervisor verification</span>
                  )
                ) : (<>
                  <span style={{ fontSize: 12, fontWeight: 800, color: "#334155" }}>{filledToday}/{visiblePoints.length} due today</span>
                  {status === "resumed" && <span style={{ fontSize: 12, fontWeight: 700, color: "#b45309" }}>↩ resumed saved sheet</span>}
                  {status === "saved"   && <span style={{ fontSize: 12, fontWeight: 800, color: "#16a34a" }}>✓ saved</span>}
                  <button onClick={save} disabled={saving || !points.length}
                          style={{ padding: "10px 22px", borderRadius: 8, border: "none",
                                   background: theme.accent, color: "#fff", fontWeight: 800, fontSize: 14,
                                   cursor: points.length ? "pointer" : "not-allowed", opacity: points.length ? 1 : 0.5 }}>
                    {saving ? "Saving…" : "💾 Save Sheet"}</button>
                </>)}
              </div>
            )}
          </div>

          {/* locked notice (view-only dates) */}
          {mno && points.length > 0 && dayLocked && (
            <div style={{ fontSize: 12.5, fontWeight: 700, color: "#b91c1c", background: "#fef2f2",
                          border: "1px solid #fecaca", borderRadius: 8, padding: "8px 12px", marginBottom: 10 }}>
              {dayStatus === "VERIFIED"
                ? "✅ This date's DMC is verified by the supervisor and finally submitted — view-only."
                : "⏳ This date's DMC is submitted by the operator and is waiting for the Production Supervisor to verify & sign (Machine DMC → Supervisor Verify). It is view-only here."}
            </div>
          )}

          {loading ? (
            <div style={{ background: "#fff", borderRadius: 12, padding: 40, textAlign: "center", color: "#64748b" }}>Loading…</div>
          ) : !mno ? (
            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 40, textAlign: "center", color: "#64748b" }}>
              Select zone → line → machine no and a month to open the daily check sheet.
            </div>
          ) : points.length === 0 ? (
            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 40, textAlign: "center", color: "#94a3b8" }}>
              No DMC check points for this machine yet. Add them in Maintenance Panel → Machine DMC.
            </div>
          ) : visiblePoints.length === 0 && !dayLocked ? (
            <div style={{ background: "#fff", border: "1px solid #bbf7d0", borderLeft: "4px solid #16a34a", borderRadius: 12, padding: 40, textAlign: "center", color: "#15803d", fontWeight: 700 }}>
              ✓ Nothing due on this date — all weekly / monthly points are already completed for their period, and there are no daily points pending.
            </div>
          ) : (
            <DmcSheet editable={!dayLocked} groups={groups} footer={footer} days={[day]} dayBandLabel={dateLabel(fillDate)}
                      values={values} onToggle={onToggle} onSetValue={onSetValue} signs={signs} onSign={onSign} reasons={reasons}
                      signableKeys={["operator"]}
                      hdr={{ zone, line, machine_no: mno, machine_name: mcSel?.machine_name || header.machine_name || "",
                             month: monthLabel(month), date: dateLabel(fillDate),
                             rev_no: header.rev_no, rev_date: header.rev_date }} />
          )}

        </div>
      </div>

      {/* Not-OK reason popup — MANDATORY: reason bhare bina band nahi hota;
          cancel karna ho to "Remove ✗" se cross hatao. */}
      {reasonPopup && (() => {
        const p = points.find((pt) => pt.id === reasonPopup.id);
        if (!p) return null;
        const rk = `${reasonPopup.id}_${reasonPopup.day}`;
        const hasReason = (reasons[rk] || "").trim().length > 0;
        const close = () => setReasonPopup(null);
        // ✗ poori tarah hatao (cross + reason dono) — NG cancel
        const removeNg = () => {
          setValues((s) => { const n = { ...s }; delete n[rk]; return n; });
          setReasons((r) => { const n = { ...r }; delete n[rk]; return n; });
          close();
        };
        return (
          <>
            {/* overlay: reason bhara ho tabhi bahar-click se band, warna mandatory */}
            <div onClick={() => { if (hasReason) close(); }} style={{ position: "fixed", inset: 0, zIndex: 900 }} />
            <div onClick={(e) => e.stopPropagation()}
                 style={{ position: "fixed", zIndex: 901, width: 320,
                          left: Math.max(12, Math.min(reasonPopup.x, window.innerWidth - 336)),
                          top: Math.min(reasonPopup.y + 14, window.innerHeight - 240),
                          background: "#fff", borderRadius: 10, border: "1px solid #e2e8f0",
                          boxShadow: "0 12px 34px rgba(15,23,42,.28)", padding: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#b91c1c", marginBottom: 3 }}>✗ Not OK — reason</div>
              <div style={{ fontSize: 11.5, color: "#334155", marginBottom: 9 }}>#{p.s_no} · {p.check_point}</div>
              <textarea autoFocus rows={3} value={reasons[rk] || ""} placeholder="Why is this Not OK?"
                        onChange={(e) => onReason(reasonPopup.id, reasonPopup.day, e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (hasReason) close(); } }}
                        style={{ width: "100%", boxSizing: "border-box", borderRadius: 8, border: "1px solid #cbd5e1",
                                 padding: "7px 9px", fontSize: 12.5, fontFamily: "inherit", outline: "none", resize: "vertical" }} />
              {!hasReason && (
                <div style={{ fontSize: 11, color: "#b45309", marginTop: 6, lineHeight: 1.4 }}>
                  Reason likhna zaroori hai — warna <b>Remove ✗</b> se cross hatayein.
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 10 }}>
                <button onClick={removeNg}
                        style={{ padding: "6px 12px", borderRadius: 7, border: "1px solid #cbd5e1", background: "#fff",
                                 color: "#64748b", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Remove ✗</button>
                <button onClick={() => { if (hasReason) close(); }} disabled={!hasReason}
                        style={{ padding: "6px 18px", borderRadius: 7, border: "none",
                                 background: hasReason ? "#dc2626" : "#fca5a5", color: "#fff",
                                 fontSize: 12, fontWeight: 800,
                                 cursor: hasReason ? "pointer" : "not-allowed", opacity: hasReason ? 1 : 0.7 }}>Done</button>
              </div>
            </div>
          </>
        );
      })()}
    </>
  );
}
