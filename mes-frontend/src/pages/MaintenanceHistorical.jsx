/* ───────────────────────────────────────────────────────────────────
 * MaintenanceHistorical.jsx
 * ───────────────────────────────────────────────────────────────────
 * Historical Data — the archive of FILLED breakdown slips (rebuilt
 * 2026-07-03; the old KPI roll-ups / register logic were removed).
 *
 *   • Filter bar — same as every other page (Financial Year · Month ·
 *     Zone · Line · Machine No · Machine Name from the Machine Master
 *     List `maintenance_machines`) PLUS an exact Date picker.
 *   • Slip list — every CLOSED (fully filled) breakdown slip in the
 *     window, ANY date — not just the Dashboard's last-2-days view.
 *     "View Slip" opens the same read-only BREAK DOWN SLIP modal the
 *     Dashboard uses.
 *
 * Data: GET /api/breakdowns/log  (maintenance_breakdown_data — jahan
 * slip form production/maintenance/closure JSONB bharti hai).
 * Routing: /maintenance-historical
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { ClosureFormModal } from "./breakdown/ClosureFormModal";
import { FormatSheet } from "./pm/FormatSheet";
import { DmcSheet, groupDmcPoints } from "./DmcSheet";
import { onlyProdZones } from "../constants/zones";

const api = {
  async get(path, token) {
    const r = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
    return r.json();
  },
};

const MONTHS = ["January", "February", "March", "April", "May", "June",
                "July", "August", "September", "October", "November", "December"];
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
// "2025-26" → {start:"2025-04-01", end:"2026-03-31"} (inclusive dates)
function fyDates(fy) {
  const y = parseInt(String(fy).split("-")[0], 10);
  if (isNaN(y)) return null;
  return { start: `${y}-04-01`, end: `${y + 1}-03-31` };
}
// "2026-01" → {start:"2026-01-01", end:"2026-01-31"}
function monthDates(ym) {
  const [y, m] = String(ym).split("-").map(Number);
  if (!y || !m) return null;
  const last = new Date(y, m, 0).getDate();   // local — no toISOString (IST shift)
  return { start: `${ym}-01`, end: `${ym}-${String(last).padStart(2, "0")}` };
}
// Ticket zone/line names ("SEAT SLIDER", "YNC-SS") vs master codes
// ("SEAT_SLIDER", "YNC_SS") — compare normalized.
const norm = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");

// ── DMC filled-sheet helpers (copied verbatim from MachineDMCAdmin.jsx so the
//    read-only DmcSheet renders identically here) ───────────────────────────
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

export default function MaintenanceHistorical() {
  const { token, theme, user } = useAuth();
  // ── filters (Machine Master List + FY/Month + exact Date) ──
  const [years, setYears]   = useState([]);
  const [master, setMaster] = useState([]);
  const [fFy, setFFy]       = useState("");
  const [fMonth, setFMonth] = useState("");
  const [fDate, setFDate]   = useState("");
  const [fZone, setFZone]   = useState("");
  const [fLine, setFLine]   = useState("");
  const [fMachineNo, setFMachineNo]     = useState("");
  const [fMachineName, setFMachineName] = useState("");
  // ── the slips ──
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewTicket, setViewTicket] = useState(null);
  // ── filled AUTO breakdown slips (ANDON se) — maintenance_auto_breakdown_slip ──
  const [autoRows, setAutoRows]       = useState([]);
  const [autoLoading, setAutoLoading] = useState(true);
  const [viewAuto, setViewAuto]       = useState(null);   // fetched auto slip ticket (view)
  // ── the filled PM check sheets ──
  const [pmFmt, setPmFmt]         = useState(null);   // sheet format (layout)
  const [pmRows, setPmRows]       = useState([]);
  const [pmLoading, setPmLoading] = useState(true);
  const [viewSheet, setViewSheet] = useState(null);   // full filled sheet (entries incl.)
  // ── the filled DMC check sheets ──
  const [dmcRows, setDmcRows]       = useState([]);
  const [dmcLoading, setDmcLoading] = useState(true);
  const [viewDmc, setViewDmc]       = useState(null);   // full filled DMC sheet (entries incl.)
  // ── sunday plan work + daily work assign ──
  const [sunRows, setSunRows]       = useState([]);
  const [sunLoading, setSunLoading] = useState(true);
  const [dayRows, setDayRows]       = useState([]);
  const [dayLoading, setDayLoading] = useState(true);

  const booted = useRef(false);
  useEffect(() => {
    if (!token) return;
    api.get("/api/maintenance-kpi/financial-years", token).then((y) => {
      const list = Array.isArray(y) ? y : [];
      setYears(list);
      if (!booted.current && list.length) {
        booted.current = true;
        const cur = (list.find((v) => v.is_current) || list[0]).fy;
        setFFy(cur);
        // Month default = abhi ka current month (agar wo current FY me aata hai).
        const now = new Date();
        const cm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
        if (fyMonths(cur).some((m) => m.value === cm)) setFMonth(cm);
        // DATE default = aaj ki date (win me Date > Month, to default aaj dikhega).
        // Date clear karte hi wapas month-view — "jaise abhi hai" — dikhega.
        setFDate(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`);
      }
    }).catch(() => setYears([]));
    api.get("/api/machines/", token).then((m) => setMaster(Array.isArray(m) ? m : [])).catch(() => setMaster([]));
  }, [token]);

  const zoneOpts = useMemo(() => onlyProdZones([...new Set(master.map((m) => m.zone_name).filter(Boolean))]), [master]);
  const lineOpts = useMemo(() => fZone
    ? [...new Set(master.filter((m) => m.zone_name === fZone).map((m) => m.line_name).filter(Boolean))].sort() : [], [master, fZone]);
  const machineNoOpts = useMemo(() => (fZone && fLine)
    ? [...new Set(master.filter((m) => m.zone_name === fZone && m.line_name === fLine)
                        .map((m) => m.machine_no).filter(Boolean))].sort() : [], [master, fZone, fLine]);
  const machineNameOpts = useMemo(() => (fZone && fLine)
    ? [...new Set(master.filter((m) => m.zone_name === fZone && m.line_name === fLine)
                        .map((m) => m.machine_name).filter(Boolean))].sort() : [], [master, fZone, fLine]);
  // Machine Name ab machine_no se AUTO-fill (alag select nahi) — master se derive.
  const effMname = useMemo(() => (fMachineNo
    ? (master.find((m) => m.zone_name === fZone && m.line_name === fLine && String(m.machine_no) === String(fMachineNo))?.machine_name || "")
    : ""), [master, fZone, fLine, fMachineNo]);
  const monthOpts = useMemo(() => fFy ? fyMonths(fFy) : [], [fFy]);
  const onZone = (v) => { setFZone(v); setFLine(""); setFMachineNo(""); setFMachineName(""); };
  const onLine = (v) => { setFLine(v); setFMachineNo(""); setFMachineName(""); };
  const clearFilters = () => { setFFy(""); setFMonth(""); setFDate(""); setFZone(""); setFLine(""); setFMachineNo(""); setFMachineName(""); };

  // Effective server window: exact Date > Month > FY > everything (730d cap).
  const win = useMemo(() => {
    if (fDate)  return { start: fDate, end: fDate };
    if (fMonth) return monthDates(fMonth);
    if (fFy)    return fyDates(fFy);
    return null;
  }, [fFy, fMonth, fDate]);

  useEffect(() => {
    if (!token) return;
    // `ignore`: jab `win` badalta hai (jaise boot pe null → current-month window),
    // purani in-flight request ka jawab naye ko overwrite na kare (race fix).
    let ignore = false;
    const p = new URLSearchParams({ state: "CLOSED", limit: "2000" });
    if (win) { p.set("from_date", win.start); p.set("to_date", win.end); }
    else     { p.set("days", "730"); }
    setLoading(true);
    api.get(`/api/breakdowns/log?${p.toString()}`, token)
      .then((d) => { if (!ignore) setRows(Array.isArray(d?.rows) ? d.rows : []); })
      .catch(() => { if (!ignore) setRows([]); })
      .finally(() => { if (!ignore) setLoading(false); });
    return () => { ignore = true; };
  }, [token, win]);

  // filled PM check sheets (maintenance_pm_check_sheet_filled) + the sheet layout
  useEffect(() => {
    if (!token) return;
    api.get("/api/pm/check-sheet-format", token).then((d) => setPmFmt(d.format)).catch(() => {});
  }, [token]);
  useEffect(() => {
    if (!token) return;
    let ignore = false;   // race fix — same as breakdown-log effect above
    const p = new URLSearchParams();
    if (win) { p.set("date_from", win.start); p.set("date_to", win.end); }
    // only sheets that cleared the full chain (Team Member → Engineer → In-Charge)
    p.set("stage", "APPROVED");
    setPmLoading(true);
    api.get(`/api/pm/check-sheet-fills?${p.toString()}`, token)
      .then((d) => { if (!ignore) setPmRows(Array.isArray(d?.rows) ? d.rows : []); })
      .catch(() => { if (!ignore) setPmRows([]); })
      .finally(() => { if (!ignore) setPmLoading(false); });
    // sunday plan work + daily work assign (same window on plan_date)
    setSunLoading(true);
    api.get(`/api/sunday-plan/?${p.toString()}`, token)
      .then((d) => { if (!ignore) setSunRows(Array.isArray(d?.rows) ? d.rows : []); })
      .catch(() => { if (!ignore) setSunRows([]); })
      .finally(() => { if (!ignore) setSunLoading(false); });
    setDayLoading(true);
    api.get(`/api/daily-plan/?${p.toString()}`, token)
      .then((d) => { if (!ignore) setDayRows(Array.isArray(d?.rows) ? d.rows : []); })
      .catch(() => { if (!ignore) setDayRows([]); })
      .finally(() => { if (!ignore) setDayLoading(false); });
    return () => { ignore = true; };
  }, [token, win]);

  // filled DMC check sheets (machine_dmc_filled) — server returns only
  // maintenance-signed sheets; the month window is applied client-side (no date
  // param on this endpoint), so fetch all and filter in `dmcList`.
  useEffect(() => {
    if (!token) return;
    let ignore = false;   // race fix — same as the PM effect above
    setDmcLoading(true);
    api.get(`/api/machine-dmc/check-sheet-fills`, token)
      .then((d) => { if (!ignore) setDmcRows(Array.isArray(d?.rows) ? d.rows : []); })
      .catch(() => { if (!ignore) setDmcRows([]); })
      .finally(() => { if (!ignore) setDmcLoading(false); });
    return () => { ignore = true; };
  }, [token, win]);

  // filled AUTO breakdown slips (ANDON se) — /api/maintenance-kpi/ ke `breakdowns`
  // me se sirf COMPLETED (bhari hui) slips.  (Ye BD History/manual slip se alag hai.)
  useEffect(() => {
    if (!token) return;
    let ignore = false;
    const p = new URLSearchParams({ period: "custom" });
    if (win) { p.set("date_from", win.start); p.set("date_to", win.end); }
    else {
      const t = new Date(), pad = (n) => String(n).padStart(2, "0");
      const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      p.set("date_from", iso(new Date(t.getTime() - 730 * 864e5))); p.set("date_to", iso(t));
    }
    setAutoLoading(true);
    api.get(`/api/maintenance-kpi/?${p.toString()}`, token)
      .then((d) => { if (!ignore) setAutoRows(Array.isArray(d?.breakdowns) ? d.breakdowns.filter((b) => b.state === "COMPLETED") : []); })
      .catch(() => { if (!ignore) setAutoRows([]); })
      .finally(() => { if (!ignore) setAutoLoading(false); });
    return () => { ignore = true; };
  }, [token, win]);

  // Zone/Line/Machine matching is client-side (slip zone names like
  // "SEAT SLIDER" vs master "SEAT_SLIDER" — normalized comparison).
  const rowZone = (r) => r.zone_name || r.production_data?.zone || r.closure_data?.zone || "";
  const rowLine = (r) => r.line_name || r.production_data?.line || r.closure_data?.line || "";
  const rowMno  = (r) => r.production_data?.machine_no || r.closure_data?.machine_no || "";
  const rowMnm  = (r) => r.production_data?.machine_name || r.closure_data?.machine_name || "";
  const rowProblem = (r) => r.production_data?.problem_reported_by_production
    || r.closure_data?.problem_reported_by_production || r.reason || "";
  const rowMin = (r) => r.duration_seconds != null ? Math.round(r.duration_seconds / 60)
    : (r.closure_data?.mc_down_time_minutes ?? "");

  const list = useMemo(() => rows.filter((r) => {
    if (fZone && norm(rowZone(r)) !== norm(fZone)) return false;
    if (fLine && norm(rowLine(r)) !== norm(fLine)) return false;
    if (fMachineNo && norm(rowMno(r)) !== norm(fMachineNo)) return false;
    if (fMachineName && norm(rowMnm(r)) !== norm(fMachineName)) return false;
    return true;
  }), [rows, fZone, fLine, fMachineNo, fMachineName]);

  const pmList = useMemo(() => pmRows.filter((r) => {
    if (fZone && norm(r.zone_name) !== norm(fZone)) return false;
    if (fLine && norm(r.line_name) !== norm(fLine)) return false;
    if (fMachineNo && norm(r.machine_no) !== norm(fMachineNo)) return false;
    if (fMachineName && norm(r.machine_name) !== norm(fMachineName)) return false;
    return true;
  }), [pmRows, fZone, fLine, fMachineNo, fMachineName]);

  const openSheet = (id) =>
    api.get(`/api/pm/check-sheet-fill/${id}`, token).then(setViewSheet).catch(() => {});

  // Same zone/line/machine match as pmList, PLUS a month-window filter: this
  // endpoint has no date param, so keep rows whose sheet_month (YYYY-MM) falls
  // inside the FY/Month/Date window (string compare of the YYYY-MM prefix).
  const dmcList = useMemo(() => dmcRows.filter((r) => {
    if (fZone && norm(r.zone_name) !== norm(fZone)) return false;
    if (fLine && norm(r.line_name) !== norm(fLine)) return false;
    if (fMachineNo && norm(r.machine_no) !== norm(fMachineNo)) return false;
    if (fMachineName && norm(r.machine_name) !== norm(fMachineName)) return false;
    if (win && !(r.sheet_month >= win.start.slice(0, 7) && r.sheet_month <= win.end.slice(0, 7))) return false;
    return true;
  }), [dmcRows, win, fZone, fLine, fMachineNo, fMachineName]);

  const openDmc = (id) =>
    api.get(`/api/machine-dmc/check-sheet-fill/${id}`, token).then(setViewDmc).catch(() => {});

  // AUTO slips line-level hoti hain (machine khali) — zone/line se hi filter.
  const autoList = useMemo(() => autoRows.filter((r) => {
    if (fZone && norm(r.zone_name) !== norm(fZone)) return false;
    if (fLine && norm(r.line_name) !== norm(fLine)) return false;
    return true;
  }), [autoRows, fZone, fLine]);

  // View: dashboard jaisa hi — auto slip fetch karke ClosureFormModal (read-only).
  const openAuto = (id) =>
    api.get(`/api/breakdown-slips/auto/${id}`, token).then(setViewAuto).catch(() => {});

  const planMatch = (r) => {
    if (fZone && norm(r.zone_name) !== norm(fZone)) return false;
    if (fLine && norm(r.line_name) !== norm(fLine)) return false;
    if (fMachineNo && norm(r.machine_no) !== norm(fMachineNo)) return false;
    if (fMachineName && norm(r.machine_name) !== norm(fMachineName)) return false;
    return true;
  };
  const sunList = useMemo(() => sunRows.filter(planMatch),
    [sunRows, fZone, fLine, fMachineNo, fMachineName]);   // eslint-disable-line react-hooks/exhaustive-deps
  const dayList = useMemo(() => dayRows.filter(planMatch),
    [dayRows, fZone, fLine, fMachineNo, fMachineName]);   // eslint-disable-line react-hooks/exhaustive-deps

  const fmtD = (iso) => (iso ? String(iso).slice(0, 10) : "—");
  const fmtT = (iso) => { const d = iso ? new Date(iso) : null; return d ? d.toTimeString().slice(0, 5) : "—"; };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700;800&family=Barlow+Condensed:wght@700;800&display=swap');
        .hd-root { min-height:100vh; background:#eef2f7; font-family:'Barlow',sans-serif; padding-bottom:50px; }
        .hd-top { background:#fff; border-bottom:1px solid #e2e8f0; height:56px; padding:0 28px 0 96px;
                  display:flex; align-items:center; justify-content:space-between;
                  position:sticky; top:0; z-index:50; box-shadow:0 1px 3px rgba(0,0,0,.06); }
        .hd-top::after { content:''; position:absolute; bottom:0; left:0; right:0; height:2px; background:${theme.gradient}; }
        .hd-title { font-family:'Barlow Condensed',sans-serif; font-size:22px; font-weight:800; color:#0f172a; }
        .hd-title span { color:${theme.accent}; }
        .hd-sub { font-size:11px; color:#94a3b8; margin-top:-2px; }

        .hd-filters { max-width:1500px; margin:16px auto 0; padding:0 22px;
                      display:flex; gap:12px; flex-wrap:wrap; align-items:flex-end; }
        .hd-fld { display:flex; flex-direction:column; gap:5px; }
        .hd-fld label { font-size:10.5px; font-weight:800; letter-spacing:.05em; text-transform:uppercase; color:#64748b; }
        .hd-sel { border:1.5px solid #cbd5e1; border-radius:9px; padding:9px 12px; font-size:13px; font-weight:600;
                  color:#0f172a; outline:none; font-family:'Barlow',sans-serif; background:#fff; min-width:148px; }
        .hd-sel:focus { border-color:${theme.accent}; }
        .hd-sel:disabled { background:#f1f5f9; color:#94a3b8; cursor:not-allowed; }
        .hd-clear { display:flex; align-items:center; gap:6px; font-size:13px; font-weight:700; color:#475569;
                    background:#f1f5f9; border:1px solid #e2e8f0; border-radius:8px; padding:9px 16px; cursor:pointer; }

        .hd-body { max-width:1500px; margin:18px auto 0; padding:0 22px; }
        .hd-sec { background:#fff; border:1px solid #e2e8f0; border-radius:14px;
                  box-shadow:0 1px 4px rgba(15,23,42,.06); overflow:hidden; }
        .hd-sec-h { display:flex; align-items:center; gap:10px; padding:14px 20px; border-bottom:1px solid #eef2f7; }
        .hd-sec-dot { width:10px; height:10px; border-radius:3px; background:#16a34a; }
        .hd-sec-t { font-size:15px; font-weight:800; color:#0f172a; }
        .hd-sec-c { font-size:12px; font-weight:700; color:#fff; background:#16a34a; border-radius:99px; padding:2px 10px; }

        .hd-scroll { max-height:270px; overflow-y:auto; }   /* ≈ 4 rows + header */
        .hd-tbl { width:100%; border-collapse:collapse; }
        .hd-tbl th { background:#1e3a8a; color:#fff; font-size:11.5px; font-weight:700; padding:11px 14px;
                     text-align:left; white-space:nowrap; position:sticky; top:0; z-index:2; }
        .hd-tbl td { border-bottom:1px solid #eef2f7; padding:11px 14px; font-size:12.5px; color:#334155; }
        .hd-tbl tr:hover td { background:#f8fafc; }
        .hd-mno { font-weight:800; color:#0f172a; }
        .hd-min { font-weight:800; color:#dc2626; text-align:center; }
        .hd-view { border:none; cursor:pointer; background:${theme.accent}; color:#fff; border-radius:8px;
                   padding:8px 16px; font-size:12.5px; font-weight:800; font-family:'Barlow',sans-serif; }
        .hd-view:hover { filter:brightness(1.05); }
        .hd-empty { text-align:center; color:#94a3b8; padding:38px; font-size:13.5px; }
      `}</style>

      <div className="hd-root">
        <div className="hd-top">
          <div>
            <div className="hd-title">Historical <span>Data</span></div>
            <div className="hd-sub">Filled breakdown slips — any date</div>
          </div>
          {user?.username && <span style={{ fontSize:12, color:"#64748b", fontWeight:600 }}>{user.username}</span>}
        </div>

        {/* ── the filter bar (same as everywhere + exact Date) ── */}
        <div className="hd-filters">
          <div className="hd-fld">
            <label>Financial Year</label>
            <select className="hd-sel" value={fFy} onChange={(e) => { setFFy(e.target.value); setFMonth(""); setFDate(""); }}>
              <option value="">All Financial Years</option>
              {years.map((y) => <option key={y.fy} value={y.fy}>{y.fy}{y.is_current ? "  (current)" : ""}</option>)}
            </select>
          </div>
          <div className="hd-fld">
            <label>Month</label>
            <select className="hd-sel" value={fMonth} onChange={(e) => { setFMonth(e.target.value); setFDate(""); }} disabled={!fFy}>
              <option value="">All Months</option>
              {monthOpts.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <div className="hd-fld">
            <label>Date</label>
            <input className="hd-sel" type="date" value={fDate} onChange={(e) => setFDate(e.target.value)} />
          </div>
          <div className="hd-fld">
            <label>Zone</label>
            <select className="hd-sel" value={fZone} onChange={(e) => onZone(e.target.value)}>
              <option value="">All Zones</option>
              {zoneOpts.map((z) => <option key={z} value={z}>{z}</option>)}
            </select>
          </div>
          <div className="hd-fld">
            <label>Line</label>
            <select className="hd-sel" value={fLine} onChange={(e) => onLine(e.target.value)} disabled={!fZone}>
              <option value="">All Lines</option>
              {lineOpts.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <div className="hd-fld">
            <label>Machine No.</label>
            <select className="hd-sel" value={fMachineNo} onChange={(e) => setFMachineNo(e.target.value)} disabled={!fLine}>
              <option value="">All Machine No.</option>
              {machineNoOpts.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="hd-fld">
            <label>Machine Name</label>
            <input className="hd-sel" readOnly value={effMname} placeholder="Auto from Machine No."
                   style={{ background:"#f8fafc", color:"#334155" }} />
          </div>
          <div className="hd-fld">
            <label>&nbsp;</label>
            <button className="hd-clear" onClick={clearFilters}>✕ Clear</button>
          </div>
        </div>

        {/* ── filled slips ── */}
        <div className="hd-body">
          <div className="hd-sec">
            <div className="hd-sec-h">
              <span className="hd-sec-dot" />
              <span className="hd-sec-t">Filled Breakdown Slips</span>
              <span className="hd-sec-c">{list.length}</span>
              <span style={{ marginLeft:"auto", fontSize:11.5, color:"#94a3b8" }}>
                click View Slip to open the filled slip (read-only)
              </span>
            </div>
            <div className={list.length > 4 ? "hd-scroll" : undefined}>
              <table className="hd-tbl">
                <thead>
                  <tr>
                    <th>#</th><th>Date</th><th>Time</th><th>Zone</th><th>Line</th>
                    <th>M/C No</th><th>Machine</th><th>Problem</th>
                    <th style={{ textAlign:"center" }}>Down Time (min)</th>
                    <th style={{ textAlign:"center" }}>Slip</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && <tr><td colSpan={10} className="hd-empty">Loading…</td></tr>}
                  {!loading && list.length === 0 &&
                    <tr><td colSpan={10} className="hd-empty">No filled slips for this filter.</td></tr>}
                  {!loading && list.map((r, i) => (
                    <tr key={r.id}>
                      <td>{i + 1}</td>
                      <td>{fmtD(r.started_at)}</td>
                      <td>{fmtT(r.started_at)}</td>
                      <td>{rowZone(r) || "—"}</td>
                      <td>{rowLine(r) || "—"}</td>
                      <td className="hd-mno">{rowMno(r) || "—"}</td>
                      <td>{rowMnm(r) || "—"}</td>
                      <td style={{ maxWidth:280 }}>{rowProblem(r)}</td>
                      <td className="hd-min">{rowMin(r)}</td>
                      <td style={{ textAlign:"center" }}>
                        <button className="hd-view" onClick={() => setViewTicket(r)}>View Slip</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── filled AUTO breakdown slips (ANDON) ── */}
          <div className="hd-sec" style={{ marginTop:22 }}>
            <div className="hd-sec-h">
              <span className="hd-sec-dot" style={{ background:"#dc2626" }} />
              <span className="hd-sec-t">Filled Auto Breakdown Slips (ANDON)</span>
              <span className="hd-sec-c" style={{ background:"#dc2626" }}>{autoList.length}</span>
              <span style={{ marginLeft:"auto", fontSize:11.5, color:"#94a3b8" }}>
                ANDON se auto-generated — click View Slip (read-only)
              </span>
            </div>
            <div className={autoList.length > 4 ? "hd-scroll" : undefined}>
              <table className="hd-tbl">
                <thead>
                  <tr>
                    <th>#</th><th>Date</th><th>Time</th><th>Shift</th><th>Zone</th><th>Line</th>
                    <th style={{ textAlign:"center" }}>Down Time (min)</th><th>Reason</th>
                    <th style={{ textAlign:"center" }}>Slip</th>
                  </tr>
                </thead>
                <tbody>
                  {autoLoading && <tr><td colSpan={9} className="hd-empty">Loading…</td></tr>}
                  {!autoLoading && autoList.length === 0 &&
                    <tr><td colSpan={9} className="hd-empty">No filled auto slips for this filter.</td></tr>}
                  {!autoLoading && autoList.map((r, i) => (
                    <tr key={r.id}>
                      <td>{i + 1}</td>
                      <td>{fmtD(r.started_at)}</td>
                      <td>{fmtT(r.started_at)}</td>
                      <td>{r.shift_name || "—"}</td>
                      <td>{r.zone_name || "—"}</td>
                      <td>{r.line_name || "—"}</td>
                      <td className="hd-min">{r.mc_down_time_minutes ?? "—"}</td>
                      <td style={{ maxWidth:280 }}>{r.reason || "—"}</td>
                      <td style={{ textAlign:"center" }}>
                        <button className="hd-view" style={{ background:"#dc2626" }}
                                onClick={() => openAuto(r.id)}>View Slip</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── filled PM check sheets ── */}
          <div className="hd-sec" style={{ marginTop:22 }}>
            <div className="hd-sec-h">
              <span className="hd-sec-dot" style={{ background:"#2563eb" }} />
              <span className="hd-sec-t">Filled PM Check Sheets</span>
              <span className="hd-sec-c" style={{ background:"#2563eb" }}>{pmList.length}</span>
              <span style={{ marginLeft:"auto", fontSize:11.5, color:"#94a3b8" }}>
                filled on the Preventive → Check Sheet tab — click View Sheet
              </span>
            </div>
            <div className={pmList.length > 4 ? "hd-scroll" : undefined}>
              <table className="hd-tbl">
                <thead>
                  <tr>
                    <th>#</th><th>PM Date</th><th>Zone</th><th>Line</th>
                    <th>M/C No</th><th>Machine</th>
                    <th style={{ textAlign:"center" }}>Points</th><th>Rev</th>
                    <th>Filled By</th><th style={{ textAlign:"center" }}>Sheet</th>
                  </tr>
                </thead>
                <tbody>
                  {pmLoading && <tr><td colSpan={10} className="hd-empty">Loading…</td></tr>}
                  {!pmLoading && pmList.length === 0 &&
                    <tr><td colSpan={10} className="hd-empty">No filled check sheets for this filter.</td></tr>}
                  {!pmLoading && pmList.map((r, i) => (
                    <tr key={r.id}>
                      <td>{i + 1}</td>
                      <td>{r.pm_date || "—"}</td>
                      <td>{r.zone_name || "—"}</td>
                      <td>{r.line_name || "—"}</td>
                      <td className="hd-mno">{r.machine_no || "—"}</td>
                      <td>{r.machine_name || "—"}</td>
                      <td style={{ textAlign:"center", fontWeight:800 }}>{r.n_points}</td>
                      <td>{r.rev_no || "—"}</td>
                      <td>{r.filled_by || "—"}</td>
                      <td style={{ textAlign:"center" }}>
                        <button className="hd-view" style={{ background:"#2563eb" }}
                                onClick={() => openSheet(r.id)}>View Sheet</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── filled DMC check sheets ── */}
          <div className="hd-sec" style={{ marginTop:22 }}>
            <div className="hd-sec-h">
              <span className="hd-sec-dot" style={{ background:"#0d9488" }} />
              <span className="hd-sec-t">Filled DMC Check Sheets</span>
              <span className="hd-sec-c" style={{ background:"#0d9488" }}>{dmcList.length}</span>
              <span style={{ marginLeft:"auto", fontSize:11.5, color:"#94a3b8" }}>
                filled on Machine DMC → Daily Fill — click View Sheet
              </span>
            </div>
            <div className={dmcList.length > 4 ? "hd-scroll" : undefined}>
              <table className="hd-tbl">
                <thead>
                  <tr>
                    <th>#</th><th>Month</th><th>Zone</th><th>Line</th>
                    <th>M/C No</th><th>Machine</th>
                    <th style={{ textAlign:"center" }}>Points</th><th>Rev</th>
                    <th>Filled By</th><th style={{ textAlign:"center" }}>Sheet</th>
                  </tr>
                </thead>
                <tbody>
                  {dmcLoading && <tr><td colSpan={10} className="hd-empty">Loading…</td></tr>}
                  {!dmcLoading && dmcList.length === 0 &&
                    <tr><td colSpan={10} className="hd-empty">No filled DMC sheets for this filter.</td></tr>}
                  {!dmcLoading && dmcList.map((r, i) => (
                    <tr key={r.id}>
                      <td>{i + 1}</td>
                      <td>{fillMonthLabel(r.sheet_month)}</td>
                      <td>{r.zone_name || "—"}</td>
                      <td>{r.line_name || "—"}</td>
                      <td className="hd-mno">{r.machine_no || "—"}</td>
                      <td>{r.machine_name || "—"}</td>
                      <td style={{ textAlign:"center", fontWeight:800 }}>{r.n_points}</td>
                      <td>{r.rev_no || "—"}</td>
                      <td>{r.filled_by || "—"}</td>
                      <td style={{ textAlign:"center" }}>
                        <button className="hd-view" style={{ background:"#0d9488" }}
                                onClick={() => openDmc(r.id)}>View Sheet</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── sunday plan work ── */}
          <div className="hd-sec" style={{ marginTop:22 }}>
            <div className="hd-sec-h">
              <span className="hd-sec-dot" style={{ background:"#d97706" }} />
              <span className="hd-sec-t">Sunday Plan Work</span>
              <span className="hd-sec-c" style={{ background:"#d97706" }}>{sunList.length}</span>
              <span style={{ marginLeft:"auto", fontSize:11.5, color:"#94a3b8" }}>
                assigned on Update Plan → Sunday Plan Work
              </span>
            </div>
            <div className={sunList.length > 4 ? "hd-scroll" : undefined}>
              <table className="hd-tbl">
                <thead>
                  <tr>
                    <th>#</th><th>Sunday</th><th>Zone</th><th>Line</th>
                    <th>M/C No</th><th>Machine</th><th>Problem / Work</th>
                    <th style={{ textAlign:"center" }}>Status</th><th>Action Taken</th><th>Done By</th>
                    <th>Start</th><th>End</th><th>Total</th><th>Spares</th>
                  </tr>
                </thead>
                <tbody>
                  {sunLoading && <tr><td colSpan={14} className="hd-empty">Loading…</td></tr>}
                  {!sunLoading && sunList.length === 0 &&
                    <tr><td colSpan={14} className="hd-empty">No Sunday work for this filter.</td></tr>}
                  {!sunLoading && sunList.map((r, i) => (
                    <tr key={r.id}>
                      <td>{i + 1}</td>
                      <td>{r.plan_date}</td>
                      <td>{r.zone_name || "—"}</td>
                      <td>{r.line_name || "—"}</td>
                      <td className="hd-mno">{r.machine_no || "—"}</td>
                      <td>{r.machine_name || "—"}</td>
                      <td style={{ maxWidth:220 }}>{r.problem}</td>
                      <td style={{ textAlign:"center" }}>
                        <span style={{ padding:"2px 10px", borderRadius:99, fontSize:11, fontWeight:800,
                                       background: r.status === "DONE" ? "#dcfce7" : "#fef3c7",
                                       color: r.status === "DONE" ? "#15803d" : "#b45309" }}>
                          {r.status === "DONE" ? "✓ Done" : "Pending"}
                        </span>
                      </td>
                      <td style={{ maxWidth:220 }}>{r.status === "DONE" ? r.work_done : "—"}</td>
                      <td style={{ fontWeight:700, color:"#334155" }}>{r.status === "DONE" ? r.done_by : "—"}</td>
                      <td style={{ fontFamily:"monospace", color:"#475569" }}>{r.start_time || "—"}</td>
                      <td style={{ fontFamily:"monospace", color:"#475569" }}>{r.end_time || "—"}</td>
                      <td style={{ fontWeight:700, color:"#334155" }}>{r.duration_minutes != null ? `${r.duration_minutes} min` : "—"}</td>
                      <td style={{ maxWidth:200, color:"#64748b" }}>{r.spares_used || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── daily work assign ── */}
          <div className="hd-sec" style={{ marginTop:22 }}>
            <div className="hd-sec-h">
              <span className="hd-sec-dot" style={{ background:"#0d9488" }} />
              <span className="hd-sec-t">Daily Work Assign</span>
              <span className="hd-sec-c" style={{ background:"#0d9488" }}>{dayList.length}</span>
              <span style={{ marginLeft:"auto", fontSize:11.5, color:"#94a3b8" }}>
                assigned on Update Plan → Daily Work Assign
              </span>
            </div>
            <div className={dayList.length > 4 ? "hd-scroll" : undefined}>
              <table className="hd-tbl">
                <thead>
                  <tr>
                    <th>#</th><th>Date</th><th>Zone</th><th>Line</th>
                    <th>M/C No</th><th>Machine</th><th>Problem / Work</th>
                    <th style={{ textAlign:"center" }}>Status</th><th>Action Taken</th><th>Done By</th>
                  </tr>
                </thead>
                <tbody>
                  {dayLoading && <tr><td colSpan={10} className="hd-empty">Loading…</td></tr>}
                  {!dayLoading && dayList.length === 0 &&
                    <tr><td colSpan={10} className="hd-empty">No daily work for this filter.</td></tr>}
                  {!dayLoading && dayList.map((r, i) => (
                    <tr key={r.id}>
                      <td>{i + 1}</td>
                      <td>{r.plan_date}</td>
                      <td>{r.zone_name || "—"}</td>
                      <td>{r.line_name || "—"}</td>
                      <td className="hd-mno">{r.machine_no || "—"}</td>
                      <td>{r.machine_name || "—"}</td>
                      <td style={{ maxWidth:220 }}>{r.problem}</td>
                      <td style={{ textAlign:"center" }}>
                        <span style={{ padding:"2px 10px", borderRadius:99, fontSize:11, fontWeight:800,
                                       background: r.status === "DONE" ? "#dcfce7" : "#fef3c7",
                                       color: r.status === "DONE" ? "#15803d" : "#b45309" }}>
                          {r.status === "DONE" ? "✓ Done" : "Pending"}
                        </span>
                      </td>
                      <td style={{ maxWidth:220 }}>{r.status === "DONE" ? r.work_done : "—"}</td>
                      <td style={{ fontWeight:700, color:"#334155" }}>{r.status === "DONE" ? r.done_by : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* read-only filled check sheet (same TBDI format) */}
      {viewSheet && (
        <div style={{ position:"fixed", inset:0, background:"rgba(15,23,42,.55)", zIndex:200,
                      display:"flex", alignItems:"flex-start", justifyContent:"center",
                      overflowY:"auto", padding:"30px 16px" }}
             onClick={() => setViewSheet(null)}>
          <div style={{ maxWidth:1150, width:"100%" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
                          background:"#fff", borderRadius:"10px 10px 0 0", padding:"10px 16px",
                          borderBottom:"1px solid #e2e8f0" }}>
              <b style={{ fontSize:14, color:"#0f172a", fontFamily:"'Barlow',sans-serif" }}>
                PM Check Sheet · {viewSheet.machine_no} · {viewSheet.pm_date}
                <span style={{ fontWeight:600, color:"#64748b" }}>  (filled by {viewSheet.filled_by || "—"})</span>
              </b>
              <button className="hd-clear" onClick={() => setViewSheet(null)}>✕ Close</button>
            </div>
            <FormatSheet
              f={pmFmt ? { ...pmFmt, doc_footer: viewSheet.doc_footer || pmFmt.doc_footer } : pmFmt}
              points={viewSheet.entries || []}
              rev={{ rev_no: viewSheet.rev_no, rev_date: viewSheet.rev_date }}
              signVals={[viewSheet.prepared_by, viewSheet.checked_by, viewSheet.approved_by]}
              signImgs={viewSheet.sign_imgs || []}
              hdr={{ zone: viewSheet.zone_name, line: viewSheet.line_name,
                     machine_no: viewSheet.machine_no, machine_name: viewSheet.machine_name,
                     pm_date: viewSheet.pm_date }}
            />
          </div>
        </div>
      )}

      {/* read-only filled DMC sheet (shared DmcSheet renderer) */}
      {viewDmc && (
        <div style={{ position:"fixed", inset:0, background:"rgba(15,23,42,.55)", zIndex:200,
                      display:"flex", alignItems:"flex-start", justifyContent:"center",
                      overflowY:"auto", padding:"30px 16px" }}
             onClick={() => setViewDmc(null)}>
          <div style={{ maxWidth:1250, width:"100%" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
                          background:"#fff", borderRadius:"10px 10px 0 0", padding:"10px 16px",
                          borderBottom:"1px solid #e2e8f0" }}>
              <b style={{ fontSize:14, color:"#0f172a", fontFamily:"'Barlow',sans-serif" }}>
                DMC Sheet · {viewDmc.machine_no} · {fillMonthLabel(viewDmc.sheet_month)}
                <span style={{ fontWeight:600, color:"#64748b" }}>  (filled by {viewDmc.filled_by || "—"})</span>
              </b>
              <button className="hd-clear" onClick={() => setViewDmc(null)}>✕ Close</button>
            </div>
            <DmcSheet groups={groupDmcPoints(viewDmc.entries || [])} footer={viewDmc.doc_footer || null}
                      values={fillValues(viewDmc.entries, viewDmc.day_meta, viewDmc.week_meta)}
                      reasons={fillReasons(viewDmc.entries, viewDmc.day_meta, viewDmc.week_meta)}
                      actions={viewDmc._actions || {}}
                      signGrid dayCodes={fillDayCodes(viewDmc.day_meta, viewDmc.week_meta)}
                      weekCodes={fillWeekCodes(viewDmc.week_meta)} signableKeys={[]}
                      sheetMonth={viewDmc.sheet_month}
                      hdr={{ zone: viewDmc.zone_name, line: viewDmc.line_name, machine_no: viewDmc.machine_no,
                             machine_name: viewDmc.machine_name, month: fillMonthLabel(viewDmc.sheet_month),
                             rev_no: viewDmc.rev_no, rev_date: viewDmc.rev_date }} />
          </div>
        </div>
      )}

      {viewTicket && (
        <ClosureFormModal
          ticket={viewTicket}
          mode="view"
          onClose={() => setViewTicket(null)}
          onSave={() => {}}
          token={token}
        />
      )}

      {viewAuto && (
        <ClosureFormModal
          ticket={viewAuto}
          mode="view"
          onClose={() => setViewAuto(null)}
          onSave={() => {}}
          token={token}
        />
      )}
    </>
  );
}
