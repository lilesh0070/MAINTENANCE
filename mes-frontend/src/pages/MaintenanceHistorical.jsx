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
import { slipPayload } from "./breakdown/slipPayload";
import { FormatSheet } from "./pm/FormatSheet";
import { DmcSheet, groupDmcPoints } from "./DmcSheet";
import { onlyProdZones } from "../constants/zones";
import ExcelBtn from "../components/ExcelBtn";
import RowDelete from "../components/RowDelete";
import { useNavigate } from "react-router-dom";
import { aajKaNaam } from "../constants/sheetTools";

/* Backend ki galti ka SANDESH nikalo, JSON ka kachra nahi.
 *
 * FastAPI galti ko {"detail": "..."} me bhejta hai.  Pehle yahan seedha
 * `r.text()` phenka jaata tha, to user ko `{"detail":"Is slip par 1 CAPA
 * judi hai..."}` aisa dikhta -- asli baat brackets me chhup jaati.  Delete
 * ke jawab me wajah SAAF dikhni chahiye, warna user samjhega hi nahi ki
 * mitane se roka kyun gaya. */
async function _galti(r) {
  const t = await r.text();
  try {
    const j = JSON.parse(t);
    const d = j?.detail ?? j?.message;
    if (typeof d === "string") return d;
    if (Array.isArray(d)) return d.map((x) => x?.msg || JSON.stringify(x)).join(" · ");
  } catch { /* JSON nahi tha -- neeche saada text hi chala jayega */ }
  return t || `HTTP ${r.status}`;
}

const api = {
  async get(path, token) {
    const r = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(await _galti(r));
    return r.json();
  },
  // admin slip edit ke liye
  async put(path, body, token) {
    const r = await fetch(path, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(await _galti(r));
    return r.json();
  },
  // admin delete ke liye
  async del(path, token) {
    const r = await fetch(path, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) throw new Error(await _galti(r));
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
  const { token, theme, user, isAdmin, canAccess } = useAuth();
  const nav = useNavigate();   // CAPA edit ke liye -- uska form apne page par khulta hai
  // ── filters (Machine Master List + FY/Month + exact Date) ──
  // Upar ke buttons me se kaunsa chuna hua hai — ek waqt me wahi section dikhta
  const [sec, setSec]       = useState("BD");
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
  const [autoReload, setAutoReload]   = useState(0);   // admin edit ke baad list taaza ho
  const [autoLoading, setAutoLoading] = useState(true);
  const [viewAuto, setViewAuto]       = useState(null);   // fetched auto slip ticket (view)
  // ── the filled PM check sheets ──
  const [pmFmt, setPmFmt]         = useState(null);   // sheet format (layout)
  const [pmRows, setPmRows]       = useState([]);
  const [pmReload, setPmReload]   = useState(0);    // admin edit ke baad taaza
  const [pmLoading, setPmLoading] = useState(true);
  const [viewSheet, setViewSheet] = useState(null);   // full filled sheet (entries incl.)
  // ── the filled DMC check sheets ──
  const [dmcRows, setDmcRows]       = useState([]);
  const [dmcReload, setDmcReload]   = useState(0);  // admin edit ke baad taaza
  const [dmcLoading, setDmcLoading] = useState(true);
  const [viewDmc, setViewDmc]       = useState(null);   // full filled DMC sheet (entries incl.)
  // ── sunday plan work + daily work assign ──
  const [sunRows, setSunRows]       = useState([]);
  const [sunLoading, setSunLoading] = useState(true);
  // CAPA jo CLOSE ho chuki hain (khuli hui yahan NAHI aati — user ki shart)
  const [capaRows, setCapaRows]       = useState([]);
  const [capaLoading, setCapaLoading] = useState(true);
  const [dayRows, setDayRows]       = useState([]);
  const [dayLoading, setDayLoading] = useState(true);
  // Break Down Log Book — maintenance_logbook_db_history
  const [lbRows, setLbRows]         = useState([]);
  const [lbLoading, setLbLoading]   = useState(true);

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

  // PM Check Sheet + DMC monthly/periodic hain — inpar exact DATE filter NAHI
  // lagana; sirf Month/FY window (fDate ignore).
  const winNoDate = useMemo(() => {
    if (fMonth) return monthDates(fMonth);
    if (fFy)    return fyDates(fFy);
    return null;
  }, [fFy, fMonth]);

  // Admin slip edit save hone par breakdown list dobara mangwane ke liye.
  // Ye us effect se UPAR hona zaroori hai jo ise deps me padhta hai — `const`
  // ka TDZ hai, aur deps array RENDER ke waqt padha jaata hai.  Neeche rakha
  // to page hi ReferenceError se blank ho jaata (build/eslint ise pakadte
  // bhi nahi, kyunki naam file me maujood to hai).
  const [bdReload, setBdReload] = useState(0);

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
  }, [token, win, bdReload]);

  // filled PM check sheets (maintenance_pm_check_sheet_filled) + the sheet layout
  useEffect(() => {
    if (!token) return;
    api.get("/api/pm/check-sheet-format", token).then((d) => setPmFmt(d.format)).catch(() => {});
  }, [token]);
  useEffect(() => {
    if (!token) return;
    let ignore = false;   // race fix — same as breakdown-log effect above
    // PM Check Sheet: exact DATE ignore — sirf Month/FY (winNoDate).
    const pmP = new URLSearchParams();
    if (winNoDate) { pmP.set("date_from", winNoDate.start); pmP.set("date_to", winNoDate.end); }
    // only sheets that cleared the full chain (Team Member → Engineer → In-Charge)
    pmP.set("stage", "APPROVED");
    setPmLoading(true);
    api.get(`/api/pm/check-sheet-fills?${pmP.toString()}`, token)
      .then((d) => { if (!ignore) setPmRows(Array.isArray(d?.rows) ? d.rows : []); })
      .catch(() => { if (!ignore) setPmRows([]); })
      .finally(() => { if (!ignore) setPmLoading(false); });
    // sunday plan work + daily work assign — day-based, to `win` (exact date bhi).
    const p = new URLSearchParams();
    if (win) { p.set("date_from", win.start); p.set("date_to", win.end); }
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
  }, [token, win, winNoDate, pmReload]);

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
  }, [token, win, dmcReload]);

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
  }, [token, win, autoReload]);

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
    // DMC monthly — exact DATE ignore, sirf Month/FY window (winNoDate).
    if (winNoDate && !(r.sheet_month >= winNoDate.start.slice(0, 7) && r.sheet_month <= winNoDate.end.slice(0, 7))) return false;
    return true;
  }), [dmcRows, winNoDate, fZone, fLine, fMachineNo, fMachineName]);

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

  /* ── Admin edit — bhari hui MANUAL slip ko wahin theek karo ────────
     Slip khulti read-only hi hai; admin ko header me "✎ Edit" milta hai,
     dabate hi wahi modal fill-mode me chala jaata hai.  Sirf admin ko:
     `onEdit` tabhi bhejte hain jab isAdmin ho, isliye faisla ek jagah
     rehta hai aur modal har doosri jagah pehle jaisa hi hai.
     AUTO (ANDON) slip ka edit ALAG raaste se hota hai (`saveAutoEdit` →
     PUT /api/breakdown-slips/auto/{id}), kyunki ye wala PUT sirf MANUAL
     table me likhta hai.  Wahan bhi ANDON ke naape hue khaane (date/time/
     downtime/response) lock rehte hain — UI me bhi aur server par bhi. */
  const [editing, setEditing] = useState(false);
  const [editErr, setEditErr] = useState("");
  // AUTO slip ka apna edit-flag — uska modal alag hai (viewAuto), isliye
  // `editing` share nahi kar sakte: ek hi flag hota to ek slip edit karte hi
  // doosri bhi edit-mode me khul jaati.
  const [editingAuto, setEditingAuto] = useState(false);

  const saveSlipEdit = async (maintSlice, _phase, prodExtra) => {
    const id = viewTicket?.id;
    if (!id) return;
    setEditErr("");
    try {
      const all = { ...(prodExtra || {}), ...(maintSlice || {}) };
      await api.put(`/api/breakdown-slips/${id}`, slipPayload(all), token);
      setEditing(false);
      setViewTicket(null);
      setBdReload((k) => k + 1);    // table turant nayi value dikhaye
    } catch (e) {
      setEditErr(e?.message || "Save failed");
      throw e;                      // modal ka saving-flag reset ho jaye
    }
  };

  /* AUTO slip ka admin edit.
     Manual slip se ALAG endpoint isliye ki `PUT /api/breakdown-slips/{id}`
     sirf MANUAL table me likhta hai — usi se auto slip save karna data
     galat table me daal deta.  Auto ka apna `PUT /auto/{id}` hai, jo stage
     ko haath nahi lagata aur ANDON ke naape hue khaane (date/time/downtime)
     server par bhi lock rakhta hai. */
  const saveAutoEdit = async (maintSlice, _phase, prodExtra) => {
    const t = viewAuto;
    if (!t?.id) return;
    setEditErr("");
    try {
      await api.put(`/api/breakdown-slips/auto/${t.id}`, {
        maintenance_data: maintSlice || {},
        production_data:  prodExtra  || {},
        src: t.src || "maintenance",
      }, token);
      setEditingAuto(false);
      setViewAuto(null);
      setAutoReload((k) => k + 1);
    } catch (e) {
      setEditErr(e?.message || "Save failed");
      throw e;                      // modal ka saving-flag reset ho jaye
    }
  };

  /* ── ADMIN: PM sheet ka edit ─────────────────────────────────────────
     Sheet khulti READ-ONLY hi hai; admin ko header me "✎ Edit" milta hai.
     Edit karte waqt asli `viewSheet.entries` ko HAATH NAHI LAGATE — uski
     ek alag copy (`pmDraft`) par kaam hota hai.  Isse "Cancel" sach me
     cancel karta hai, aur save fail ho jaye to screen par purana data hi
     rehta hai (adhoora nahi).

     Save `/admin` wale endpoint par jaata hai, `PUT /check-sheet-fill/{id}`
     par NAHI — wo "wapas bheji gayi sheet dobara jama karo" hai aur wo
     checked/approved ke dastakhat mita deta hai. */
  const [pmEdit,  setPmEdit]  = useState(false);
  const [pmDraft, setPmDraft] = useState([]);
  const [pmBusy,  setPmBusy]  = useState(false);
  const [pmErr,   setPmErr]   = useState("");

  const pmEditShuru = () => {
    // gehri copy — warna draft badalne par asli entries bhi badal jaatin
    setPmDraft(JSON.parse(JSON.stringify(viewSheet?.entries || [])));
    setPmErr(""); setPmEdit(true);
  };
  const pmEditBand = () => { setPmEdit(false); setPmDraft([]); setPmErr(""); };
  const pmSave = async () => {
    if (!viewSheet?.id) return;
    setPmBusy(true); setPmErr("");
    try {
      await api.put(`/api/pm/check-sheet-fill/${viewSheet.id}/admin`, {
        zone_name:    viewSheet.zone_name || "",
        line_name:    viewSheet.line_name || "",
        machine_no:   viewSheet.machine_no || "",
        machine_name: viewSheet.machine_name || "",
        pm_date:      String(viewSheet.pm_date || "").slice(0, 10),
        entries:      pmDraft,
        sheet_spares: viewSheet.sheet_spares || [],
      }, token);
      setPmEdit(false); setPmDraft([]);
      setViewSheet(null);
      setPmReload((k) => k + 1);
    } catch (e) {
      setPmErr(e?.message || "Could not save");
    } finally { setPmBusy(false); }
  };

  /* ── ADMIN: DMC sheet ka edit ────────────────────────────────────────
     Grid me cell dabane par nishaan badalta hai (khali → ✓ → ✗ → khali).
     `dmcDraft` me SIRF WAHI cell rakhte hain jo badle — poori sheet nahi.
     Do faayde:
       • server ko sirf badla hua bhejte hain, aur wahan merge hota hai —
         to jo point/din client ne dekhe hi nahi wo kabhi nahi udte;
       • "kya badla" ginna aasaan rehta hai, jo pushti me dikhana hai.

     ⚠ Backend jis din ki value badalti hai, us din ki supervisor
     VERIFICATION hata deta hai (aur uske hafte ka maintenance sign) —
     kyunki wo dastakhat purane data par tha.  Save ke jawab me kitne din
     dobara khule, wo user ko dikhate hain. */
  const [dmcEdit,  setDmcEdit]  = useState(false);
  const [dmcDraft, setDmcDraft] = useState({});
  const [dmcBusy,  setDmcBusy]  = useState(false);
  const [dmcErr,   setDmcErr]   = useState("");
  const [dmcInfo,  setDmcInfo]  = useState("");

  const dmcBase = useMemo(
    () => (viewDmc ? fillValues(viewDmc.entries, viewDmc.day_meta, viewDmc.week_meta) : {}),
    [viewDmc]);
  const dmcShow = useMemo(() => ({ ...dmcBase, ...dmcDraft }), [dmcBase, dmcDraft]);

  const dmcToggle = (pid, d) => {
    const k = `${pid}_${d}`;
    setDmcDraft((prev) => {
      const ab = (k in prev ? prev[k] : dmcBase[k]) || "";
      const naya = ab === "" ? "OK" : ab === "OK" ? "NG" : "";
      return { ...prev, [k]: naya };
    });
  };
  const dmcEditBand = () => { setDmcEdit(false); setDmcDraft({}); setDmcErr(""); };
  const dmcSave = async () => {
    if (!viewDmc?.id) return;
    const badle = Object.keys(dmcDraft).filter((k) => (dmcDraft[k] || "") !== (dmcBase[k] || ""));
    if (!badle.length) { dmcEditBand(); return; }     // kuch badla hi nahi
    setDmcBusy(true); setDmcErr("");
    try {
      // key "pointId_day" -> { id, days: {day: status} }
      const perPoint = {};
      badle.forEach((k) => {
        const i = k.lastIndexOf("_");
        const pid = k.slice(0, i), d = k.slice(i + 1);
        (perPoint[pid] ||= { id: isNaN(Number(pid)) ? pid : Number(pid), days: {} });
        perPoint[pid].days[d] = dmcDraft[k] || "";
      });
      const r = await api.put(`/api/machine-dmc/check-sheet-fill/${viewDmc.id}/admin`, {
        zone:         viewDmc.zone_name || "",
        line:         viewDmc.line_name || "",
        machine_no:   viewDmc.machine_no || "",
        machine_name: viewDmc.machine_name || "",
        sheet_month:  viewDmc.sheet_month || "",
        entries:      Object.values(perPoint),
      }, token);
      const khule = (r?.verification_cleared || []).length;
      setDmcEdit(false); setDmcDraft({});
      setViewDmc(null);
      setDmcReload((k) => k + 1);
      setDmcInfo(khule
        ? `Sheet saved. Verification was cleared for ${khule} day(s) — they need to be verified again.`
        : "Sheet saved.");
      setTimeout(() => setDmcInfo(""), 8000);
    } catch (e) {
      setDmcErr(e?.message || "Could not save");
    } finally { setDmcBusy(false); }
  };

  /* ── ADMIN: mitao ────────────────────────────────────────────────
     Har raasta backend par `require_admin` ke peeche hai; yahan button bhi
     `isAdmin &&` ke peeche hai.  DONO jagah rok isliye ki UI ki rok asli
     rok nahi hoti -- koi seedha API bhi maar sakta hai.

     Delete hone ke baad row ko list se NIKAL dete hain (dobara fetch nahi
     karte): turant dikhta hai, ek server call kam, aur filter/scroll ki
     jagah waise ki waisi rehti hai.

     AUTO tab par `src=maintenance` isliye pakka hai ki is tab ka data
     `/api/maintenance-kpi/` se aata hai, jo sirf `maintenance_auto_breakdown_slip`
     padhta hai -- toolroom ki slip yahan aati hi nahi (naap kar dekha). */
  const hatao = {
    bd:   (id) => api.del(`/api/breakdown-slips/${id}`, token)
                     .then(() => setRows((x) => x.filter((r) => r.id !== id))),
    auto: (id) => api.del(`/api/breakdown-slips/auto/${id}?src=maintenance`, token)
                     .then(() => setAutoRows((x) => x.filter((r) => r.id !== id))),
    pm:   (id) => api.del(`/api/pm/check-sheet-fill/${id}`, token)
                     .then(() => setPmRows((x) => x.filter((r) => r.id !== id))),
    dmc:  (id) => api.del(`/api/machine-dmc/check-sheet-fill/${id}`, token)
                     .then(() => setDmcRows((x) => x.filter((r) => r.id !== id))),
    capa: (id) => api.del(`/api/capa-lb/sheet/${id}`, token)
                     .then(() => setCapaRows((x) => x.filter((r) => r.id !== id))),
    sun:  (id) => api.del(`/api/sunday-plan/${id}`, token)
                     .then(() => setSunRows((x) => x.filter((r) => r.id !== id))),
    day:  (id) => api.del(`/api/daily-plan/${id}`, token)
                     .then(() => setDayRows((x) => x.filter((r) => r.id !== id))),
    // Log Book ka delete `/api/breakdown-logbook/` par hai, `/api/logbook/` par
    // NAHI -- dono ek hi table par hain, par doosra Log Book PAGE ka apna
    // delete hai jise aam user bhi kar sakta hai.  Historical wala admin-only
    // rakhna tha, isliye alag raasta.
    log:  (id) => api.del(`/api/breakdown-logbook/${id}`, token)
                     .then(() => setLbRows((x) => x.filter((r) => r.id !== id))),
  };

  // Log Book — apna alag effect (baaki section ki tarah, taaki ek call fail ho
  // to doosre na rukein).  NOTE: table me column `zone`/`line` hain, par is page
  // ka planMatch `zone_name`/`line_name` dekhta hai — isliye yahin map kar dete
  // hain.  Backend nahi chheda kyunki wahi endpoint Log Book page bhi use karti hai.
  useEffect(() => {
    if (!token) return;
    let ignore = false;
    setLbLoading(true);
    api.get(`/api/breakdown-logbook/`, token)
      .then((d) => {
        if (ignore) return;
        const rows = Array.isArray(d) ? d : (Array.isArray(d?.rows) ? d.rows : []);
        setLbRows(rows.map((r) => ({ ...r, zone_name: r.zone, line_name: r.line })));
      })
      .catch(() => { if (!ignore) setLbRows([]); })
      .finally(() => { if (!ignore) setLbLoading(false); });
    return () => { ignore = true; };
  }, [token]);

  // Closed CAPA — apna alag effect, taaki kisi doosri call ka fail hona ise na roke
  useEffect(() => {
    if (!token) return;
    let ignore = false;
    setCapaLoading(true);
    api.get(`/api/capa-lb/closed`, token)
      .then((d) => { if (!ignore) setCapaRows(Array.isArray(d?.rows) ? d.rows : []); })
      .catch(() => { if (!ignore) setCapaRows([]); })
      .finally(() => { if (!ignore) setCapaLoading(false); });
    return () => { ignore = true; };
  }, [token]);

  const planMatch = (r) => {
    if (fZone && norm(r.zone_name) !== norm(fZone)) return false;
    if (fLine && norm(r.line_name) !== norm(fLine)) return false;
    if (fMachineNo && norm(r.machine_no) !== norm(fMachineNo)) return false;
    if (fMachineName && norm(r.machine_name) !== norm(fMachineName)) return false;
    return true;
  };
  // Historical Data: sirf DONE (action liya hua) plan aaye — pending nahi.
  const sunList = useMemo(() => sunRows.filter((r) => r.status === "DONE" && planMatch(r)),
    [sunRows, fZone, fLine, fMachineNo, fMachineName]);   // eslint-disable-line react-hooks/exhaustive-deps
  const dayList = useMemo(() => dayRows.filter((r) => r.status === "DONE" && planMatch(r)),
    [dayRows, fZone, fLine, fMachineNo, fMachineName]);   // eslint-disable-line react-hooks/exhaustive-deps

  /* CAPA ki date breakdown ki hoti hai (jab dikkat hui) — sheet kab save hui
     wo nahi.  Baaki section bhi kaam ki date par chalte hain. */
  const capaList = useMemo(() => capaRows.filter((r) => {
    const d = String(r.bd_date || "").slice(0, 10);
    if (fDate) { if (d !== fDate) return false; }
    else if (win && d) { if (d < win.start || d > win.end) return false; }
    return planMatch(r);
  }), [capaRows, win, fDate, fZone, fLine, fMachineNo, fMachineName]);   // eslint-disable-line react-hooks/exhaustive-deps

  /* Log Book ki date bhi kaam ki date hai (bd_date) — entry kab bani wo nahi. */
  const lbList = useMemo(() => lbRows.filter((r) => {
    const d = String(r.bd_date || "").slice(0, 10);
    if (fDate) { if (d !== fDate) return false; }
    else if (win && d) { if (d < win.start || d > win.end) return false; }
    return planMatch(r);
  }), [lbRows, win, fDate, fZone, fLine, fMachineNo, fMachineName]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Upar ke chunav-buttons — naam, rang aur kitne record hain (filter ke hisaab se)
  // Har section ka apna permission key — admin chahe to kisi user ko sirf
  // Breakdown Slips de, ya sirf PM.  Sab `maintenance-historical` se inherit
  // karte hain, isliye jisko poora page mila hua hai use aathon section pehle
  // jaise hi dikhte hain.  Naya section jodo to key bhi teen jagah jodna:
  // yahan, AuthContext ke SUBPAGE_PARENT me, aur PAGE_PERM_GROUPS me.
  const SECTIONS = [
    { key: "BD",   perm: "hist-bd",   label: "Breakdown Slips",    color: "#16a34a", count: () => list.length },
    { key: "AUTO", perm: "hist-auto", label: "Auto Slips (ANDON)", color: "#dc2626", count: () => autoList.length },
    { key: "PM",   perm: "hist-pm",   label: "PM Check Sheets",    color: "#2563eb", count: () => pmList.length },
    { key: "DMC",  perm: "hist-dmc",  label: "DMC Check Sheets",   color: "#0d9488", count: () => dmcList.length },
    { key: "SUN",  perm: "hist-sun",  label: "Sunday Plan Work",   color: "#d97706", count: () => sunList.length },
    { key: "DAY",  perm: "hist-day",  label: "Daily Work Assign",  color: "#7c3aed", count: () => dayList.length },
    { key: "CAPA", perm: "hist-capa", label: "CAPA (Closed)",      color: "#be185d", count: () => capaList.length },
    { key: "LOG",  perm: "hist-log",  label: "Log Book",           color: "#0891b2", count: () => lbList.length },
  ];

  // Jis section par ho uski permission na ho to pehle allowed par bhej do —
  // warna page khula rehta par andar kuch dikhta hi nahi.
  useEffect(() => {
    if (canAccess(SECTIONS.find((x) => x.key === sec)?.perm)) return;
    const first = SECTIONS.find((x) => canAccess(x.perm));
    if (first) setSec(first.key);
  }, [sec, canAccess]);   // eslint-disable-line react-hooks/exhaustive-deps

  const fmtD = (iso) => (iso ? String(iso).slice(0, 10) : "—");
  // Excel ke liye: khali cell KHALI rahe, "—" nahi -- Excel me "—" par
  // na sort chalta hai na filter, aur wo asli data jaisa dikhne lagta hai.
  const xl = (v) => (v == null || v === "" ? "" : v);
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
        /* Upar ke chunav-buttons — filter lagao, phir jo dekhna hai us par click.
           Ek waqt me sirf USI ka data dikhta hai (pehle saare ek saath niche
           lage rehte the, jo bhara-bhara lagta tha). */
        /* Saare section-button EK hi line me.  nowrap ke saath thoda tight
           padding/gap, taaki saaton aaram se aa jayein.  Bahut chhoti screen
           par ye row side me scroll hoti hai — button kate nahi, aur page ka
           apna horizontal scroll bhi nahi aata (overflow-x yahin par hai).
           NOTE: is CSS template-literal ke andar BACKTICK mat likhna —
           literal wahin band ho jaata hai aur build tootti hai. */
        .hd-picks { max-width:1500px; margin:16px auto 0; padding:0 22px 2px;
                    display:flex; gap:7px; flex-wrap:nowrap;
                    overflow-x:auto; scrollbar-width:thin; }
        .hd-pick { display:inline-flex; align-items:center; gap:7px; cursor:pointer;
                   padding:8px 12px; border-radius:10px; font-family:inherit; font-size:12.5px;
                   font-weight:700; color:#334155; background:#fff; border:1.5px solid #e2e8f0;
                   box-shadow:0 1px 2px rgba(15,23,42,.04); transition:all .14s;
                   white-space:nowrap; flex:0 0 auto; }
        .hd-pick .n { min-width:20px; height:18px; border-radius:99px; padding:0 6px; display:inline-flex;
                      align-items:center; justify-content:center; font-size:11px; font-weight:800;
                      background:#f1f5f9; color:#94a3b8; }
        .hd-sec { background:#fff; border:1px solid #e2e8f0; border-radius:14px;
                  box-shadow:0 1px 4px rgba(15,23,42,.06); overflow:hidden; }
        .hd-sec-h { display:flex; align-items:center; gap:10px; padding:14px 20px; border-bottom:1px solid #eef2f7; flex-wrap:wrap; }
        .hd-sec-dot { width:10px; height:10px; border-radius:3px; background:#16a34a; }
        .hd-sec-t { font-size:15px; font-weight:800; color:#0f172a; }
        .hd-sec-c { font-size:12px; font-weight:700; color:#fff; background:#16a34a; border-radius:99px; padding:2px 10px; }

        .hd-scroll { max-height:270px; overflow-y:auto; }   /* ≈ 4 rows + header */
        /* Log Book ki table chaudi hai (saare column), isliye ise side-scroll
           chahiye — warna page hi daayen-baayen khisakne lagta. */
        .hd-scroll-x { overflow-x:auto; }
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
          {user?.username && <span className="app-user" style={{ fontSize:12, color:"#64748b", fontWeight:600 }}>{user.username}</span>}
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

        {/* ── kya dekhna hai — upar ke buttons (ek waqt me ek) ── */}
        <div className="hd-picks">
          {SECTIONS.filter((x) => canAccess(x.perm)).map((x) => {
            const on = sec === x.key, n = x.count();
            return (
              <button key={x.key} className="hd-pick" onClick={() => setSec(x.key)}
                style={on ? { borderColor: x.color, background: x.color, color: "#fff",
                              boxShadow: `0 3px 10px ${x.color}33` } : undefined}>
                <span style={{ width: 9, height: 9, borderRadius: 3,
                               background: on ? "rgba(255,255,255,.85)" : x.color }} />
                {x.label}
                <span className="n" style={on ? { background: "rgba(255,255,255,.24)", color: "#fff" }
                                              : (n ? { color: x.color } : undefined)}>{n}</span>
              </button>
            );
          })}
        </div>

        {/* ── filled slips ── */}
        <div className="hd-body">
          <div className="hd-sec" style={{ display: sec === "BD" ? undefined : "none" }}>
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
                        <span style={{ display:"inline-flex", gap:6, alignItems:"center" }}>
                          <button className="hd-view" onClick={() => setViewTicket(r)}>View Slip</button>
                          {isAdmin && (
                            <RowDelete
                              chhota
                              kya={`Breakdown Slip #${r.id} — ${r.machine_no || "?"} · ${fmtD(r.bd_date || r.slip_date)}`}
                              saath={["All spares recorded on this slip (they will also disappear from the Spare report)"]}
                              onDelete={() => hatao.bd(r.id)} />
                          )}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── filled AUTO breakdown slips (ANDON) ── */}
          <div className="hd-sec" style={{ marginTop:22, display: sec === "AUTO" ? undefined : "none" }}>
            <div className="hd-sec-h">
              <span className="hd-sec-dot" style={{ background:"#dc2626" }} />
              <span className="hd-sec-t">Filled Auto Breakdown Slips (ANDON)</span>
              <span className="hd-sec-c" style={{ background:"#dc2626" }}>{autoList.length}</span>
              <span style={{ marginLeft:"auto", fontSize:11.5, color:"#94a3b8" }}>
                Auto-generated from ANDON — click View Slip (read-only)
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
                        <span style={{ display:"inline-flex", gap:6, alignItems:"center" }}>
                          <button className="hd-view" style={{ background:"#dc2626" }}
                                  onClick={() => openAuto(r.id)}>View Slip</button>
                          {isAdmin && (
                            <RowDelete
                              chhota
                              kya={`Auto Slip #${r.id} — ${r.machine_no || "?"} · ${fmtD(r.bd_date || r.date)}`}
                              saath={["All spares recorded on this slip",
                                      "Its row in the Status tab"]}
                              onDelete={() => hatao.auto(r.id)} />
                          )}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── filled PM check sheets ── */}
          <div className="hd-sec" style={{ marginTop:22, display: sec === "PM" ? undefined : "none" }}>
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
                        <span style={{ display:"inline-flex", gap:6, alignItems:"center" }}>
                          <button className="hd-view" style={{ background:"#2563eb" }}
                                  onClick={() => openSheet(r.id)}>View Sheet</button>
                          {isAdmin && (
                            <RowDelete
                              chhota
                              kya={`PM Check Sheet #${r.id} — ${r.machine_no || "?"} · ${r.pm_date || "?"}`}
                              saath={["PM spares from this sheet (only if no other sheet remains for the same machine and date)"]}
                              onDelete={() => hatao.pm(r.id)} />
                          )}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── filled DMC check sheets ── */}
          <div className="hd-sec" style={{ marginTop:22, display: sec === "DMC" ? undefined : "none" }}>
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
                        <span style={{ display:"inline-flex", gap:6, alignItems:"center" }}>
                          <button className="hd-view" style={{ background:"#0d9488" }}
                                  onClick={() => openDmc(r.id)}>View Sheet</button>
                          {isAdmin && (
                            <RowDelete
                              chhota
                              kya={`DMC Sheet #${r.id} — ${r.machine_no || "?"} · ${r.sheet_month || "?"}`}
                              saath={["All NG points on this sheet",
                                      "Corrective actions maintenance recorded against those NG points"]}
                              onDelete={() => hatao.dmc(r.id)} />
                          )}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── sunday plan work ── */}
          <div className="hd-sec" style={{ marginTop:22, display: sec === "SUN" ? undefined : "none" }}>
            <div className="hd-sec-h">
              <span className="hd-sec-dot" style={{ background:"#d97706" }} />
              <span className="hd-sec-t">Sunday Plan Work</span>
              <span className="hd-sec-c" style={{ background:"#d97706" }}>{sunList.length}</span>
              <span style={{ marginLeft:"auto", fontSize:11.5, color:"#94a3b8" }}>
                assigned on Update Plan → Sunday Plan Work
              </span>
              <span style={{ marginLeft:10 }}><ExcelBtn banao={() => ({
                naam: `Sunday-Plan-Work_${aajKaNaam()}`,
                sheet: "Sunday Plan Work",
                headers: ["#", "Sunday", "Zone", "Line", "M/C No", "Machine", "Problem / Work",
                          "Status", "Action Taken", "Done By", "Start", "End", "Total (min)", "Spares"],
                rows: sunList.map((r, i) => [
                  i + 1, xl(r.plan_date), xl(r.zone_name), xl(r.line_name), xl(r.machine_no),
                  xl(r.machine_name), xl(r.problem), r.status === "DONE" ? "Done" : "Pending",
                  r.status === "DONE" ? xl(r.work_done) : "", r.status === "DONE" ? xl(r.done_by) : "",
                  xl(r.start_time), xl(r.end_time), xl(r.duration_minutes), xl(r.spares_used),
                ]),
              })} /></span>
            </div>
            <div className={sunList.length > 4 ? "hd-scroll" : undefined}>
              <table className="hd-tbl">
                <thead>
                  <tr>
                    <th>#</th><th>Sunday</th><th>Zone</th><th>Line</th>
                    <th>M/C No</th><th>Machine</th><th>Problem / Work</th>
                    <th style={{ textAlign:"center" }}>Status</th><th>Action Taken</th><th>Done By</th>
                    <th>Start</th><th>End</th><th>Total</th><th>Spares</th>
                    {isAdmin && <th style={{ textAlign:"center" }}>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {sunLoading && <tr><td colSpan={isAdmin ? 15 : 14} className="hd-empty">Loading…</td></tr>}
                  {!sunLoading && sunList.length === 0 &&
                    <tr><td colSpan={isAdmin ? 15 : 14} className="hd-empty">No Sunday work for this filter.</td></tr>}
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
                      {isAdmin && (
                        <td style={{ textAlign:"center" }}>
                          <RowDelete chhota
                            kya={`Sunday Plan Work #${r.id} — ${r.machine_no || "?"} · ${r.plan_date || "?"}`}
                            saath={["The full record of this work (who did it, when, and which spares were used)"]}
                            onDelete={() => hatao.sun(r.id)} />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── daily work assign ── */}
          <div className="hd-sec" style={{ marginTop:22, display: sec === "DAY" ? undefined : "none" }}>
            <div className="hd-sec-h">
              <span className="hd-sec-dot" style={{ background:"#0d9488" }} />
              <span className="hd-sec-t">Daily Work Assign</span>
              <span className="hd-sec-c" style={{ background:"#0d9488" }}>{dayList.length}</span>
              <span style={{ marginLeft:"auto", fontSize:11.5, color:"#94a3b8" }}>
                assigned on Update Plan → Daily Work Assign
              </span>
              <span style={{ marginLeft:10 }}><ExcelBtn banao={() => ({
                naam: `Daily-Work-Assign_${aajKaNaam()}`,
                sheet: "Daily Work Assign",
                headers: ["#", "Date", "Zone", "Line", "M/C No", "Machine", "Problem / Work",
                          "Status", "Action Taken", "Done By"],
                rows: dayList.map((r, i) => [
                  i + 1, xl(r.plan_date), xl(r.zone_name), xl(r.line_name), xl(r.machine_no),
                  xl(r.machine_name), xl(r.problem), r.status === "DONE" ? "Done" : "Pending",
                  r.status === "DONE" ? xl(r.work_done) : "", r.status === "DONE" ? xl(r.done_by) : "",
                ]),
              })} /></span>
            </div>
            <div className={dayList.length > 4 ? "hd-scroll" : undefined}>
              <table className="hd-tbl">
                <thead>
                  <tr>
                    <th>#</th><th>Date</th><th>Zone</th><th>Line</th>
                    <th>M/C No</th><th>Machine</th><th>Problem / Work</th>
                    <th style={{ textAlign:"center" }}>Status</th><th>Action Taken</th><th>Done By</th>
                    {isAdmin && <th style={{ textAlign:"center" }}>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {dayLoading && <tr><td colSpan={isAdmin ? 11 : 10} className="hd-empty">Loading…</td></tr>}
                  {!dayLoading && dayList.length === 0 &&
                    <tr><td colSpan={isAdmin ? 11 : 10} className="hd-empty">No daily work for this filter.</td></tr>}
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
                      {isAdmin && (
                        <td style={{ textAlign:"center" }}>
                          <RowDelete chhota
                            kya={`Daily Work Assign #${r.id} — ${r.machine_no || "?"} · ${r.plan_date || "?"}`}
                            saath={["The full record of this work (who did it and when)"]}
                            onDelete={() => hatao.day(r.id)} />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── CAPA (Closed) ──────────────────────────────────────────
              Sirf wo CAPA jinki QPR sheet CLOSE kar di gayi ho.  Khuli /
              draft CAPA yahan NAHI aati — wo CAPA page par hi rehti hai. */}
          <div className="hd-sec" style={{ display: sec === "CAPA" ? undefined : "none" }}>
            <div className="hd-sec-h">
              <span className="hd-sec-dot" style={{ background:"#be185d" }} />
              <span className="hd-sec-t">CAPA (Closed)</span>
              <span className="hd-sec-c" style={{ background:"#be185d" }}>{capaList.length}</span>
              <span style={{ marginLeft:"auto", fontSize:11.5, color:"#94a3b8" }}>
                closed on CAPA → QPR (Close CAPA)
              </span>
            </div>
            <div className={capaList.length > 4 ? "hd-scroll" : undefined}>
              <table className="hd-tbl">
                <thead><tr>
                  <th>#</th><th>Date</th><th>Zone</th><th>Line</th><th>M/C No</th><th>Machine</th>
                  <th>QPR No</th><th>Problem</th>
                  <th style={{ textAlign:"center" }}>Down Time (min)</th>
                  <th>Closed By</th><th>Closed On</th>
                  {isAdmin && <th style={{ textAlign:"center" }}>Actions</th>}
                </tr></thead>
                <tbody>
                  {capaLoading && <tr><td colSpan={isAdmin ? 12 : 11} className="hd-empty">Loading…</td></tr>}
                  {!capaLoading && capaList.length === 0 &&
                    <tr><td colSpan={isAdmin ? 12 : 11} className="hd-empty">
                      {capaRows.length ? "No closed CAPA for this filter."
                                       : "No CAPA closed yet — close one on the CAPA page and it will show here."}
                    </td></tr>}
                  {!capaLoading && capaList.map((r, i) => (
                    <tr key={r.id}>
                      <td>{i + 1}</td>
                      <td>{fmtD(r.bd_date)}</td>
                      <td>{r.zone_name || "—"}</td>
                      <td>{r.line_name || "—"}</td>
                      <td className="hd-mno">{r.machine_no || "—"}</td>
                      <td>{r.machine_name || "—"}</td>
                      <td style={{ fontWeight:700, color:"#334155" }}>{r.qpr_no || `#${r.id}`}</td>
                      <td style={{ maxWidth:240 }}>{r.problem || "—"}</td>
                      <td style={{ textAlign:"center", fontWeight:800 }}>{r.duration_min ?? "—"}</td>
                      <td style={{ fontWeight:700, color:"#334155" }}>{r.closed_by || "—"}</td>
                      <td style={{ whiteSpace:"nowrap" }}>{fmtD(r.closed_at)}</td>
                      {isAdmin && (
                        <td style={{ textAlign:"center" }}>
                          <span style={{ display:"inline-flex", gap:6, alignItems:"center" }}>
                            {/* CAPA ka form apne page ke andar khulta hai (alag route nahi),
                                isliye wahan `?sheet=` ke saath bhejte hain -- wo page use
                                khol kar seedha form dikha deta hai. */}
                            <button className="hd-view" style={{ background:"#be185d" }}
                                    onClick={() => nav(`/maintenance-capa?sheet=${r.id}`)}>✎ Edit</button>
                            <RowDelete
                              chhota
                              kya={`CAPA ${r.qpr_no || "#" + r.id} — ${r.machine_no || "?"}`}
                              saath={["All data filled in on this QPR sheet"]}
                              onDelete={() => hatao.capa(r.id)} />
                          </span>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {/* ── Log Book ─────────────────────────────────────────
              maintenance_logbook_db_history — jo kaam Log Book me likha gaya.
              Isme saare column dikhate hain, isliye table chaudi hai aur
              hd-scroll-x se side me khisakti hai. */}
          <div className="hd-sec" style={{ display: sec === "LOG" ? undefined : "none" }}>
            <div className="hd-sec-h">
              <span className="hd-sec-dot" style={{ background:"#0891b2" }} />
              <span className="hd-sec-t">Break Down Log Book</span>
              <span className="hd-sec-c" style={{ background:"#0891b2" }}>{lbList.length}</span>
              <span style={{ marginLeft:"auto", fontSize:11.5, color:"#94a3b8" }}>
                scroll sideways for more columns
              </span>
              <span style={{ marginLeft:10 }}><ExcelBtn banao={() => ({
                naam: `Log-Book_${aajKaNaam()}`,
                sheet: "Log Book",
                headers: ["#", "Date", "Shift", "Zone", "Line", "M/C No", "Machine",
                          "Problem Observed", "Action Taken", "Start", "OK Time",
                          "Down Time (min)", "Solve (hr)", "Spares Used", "Attended By", "Created By"],
                rows: lbList.map((r, i) => [
                  i + 1, xl(String(r.bd_date || "").slice(0, 10)), xl(r.shift), xl(r.zone), xl(r.line),
                  xl(r.machine_no), xl(r.machine_name), xl(r.problem_observed_by_maintenance),
                  xl(r.action_taken_on_problem), xl(r.bd_start_time), xl(r.bd_ok_time),
                  xl(r.mc_down_time_minutes), xl(r.solve_time_hours), xl(r.spares_used),
                  xl(r.bd_attended_by), xl(r.created_by),
                ]),
              })} /></span>
            </div>
            <div className={"hd-scroll-x" + (lbList.length > 4 ? " hd-scroll" : "")}>
              <table className="hd-tbl">
                <thead><tr>
                  <th>#</th><th>Date</th><th>Shift</th><th>Zone</th><th>Line</th>
                  <th>M/C No</th><th>Machine</th>
                  <th>Problem Observed</th><th>Action Taken</th>
                  <th>Start</th><th>OK Time</th>
                  <th style={{ textAlign:"center" }}>Down Time (min)</th>
                  <th style={{ textAlign:"center" }}>Solve (hr)</th>
                  <th>Spares Used</th><th>Attended By</th><th>Created By</th>
                  {isAdmin && <th style={{ textAlign:"center" }}>Actions</th>}
                </tr></thead>
                <tbody>
                  {lbLoading && <tr><td colSpan={isAdmin ? 17 : 16} className="hd-empty">Loading…</td></tr>}
                  {!lbLoading && lbList.length === 0 &&
                    <tr><td colSpan={isAdmin ? 17 : 16} className="hd-empty">
                      {lbRows.length ? "No log book entries for this filter."
                                     : "No log book entries yet."}
                    </td></tr>}
                  {!lbLoading && lbList.map((r, i) => (
                    <tr key={r.id}>
                      <td>{i + 1}</td>
                      <td style={{ whiteSpace:"nowrap" }}>{fmtD(r.bd_date)}</td>
                      <td>{r.shift || "—"}</td>
                      <td>{r.zone || "—"}</td>
                      <td>{r.line || "—"}</td>
                      <td className="hd-mno">{r.machine_no || "—"}</td>
                      <td>{r.machine_name || "—"}</td>
                      <td style={{ maxWidth:240 }}>{r.problem_observed_by_maintenance || "—"}</td>
                      <td style={{ maxWidth:240 }}>{r.action_taken_on_problem || "—"}</td>
                      <td style={{ whiteSpace:"nowrap" }}>{r.bd_start_time || "—"}</td>
                      <td style={{ whiteSpace:"nowrap" }}>{r.bd_ok_time || "—"}</td>
                      <td className="hd-min">{r.mc_down_time_minutes || "—"}</td>
                      <td style={{ textAlign:"center" }}>{r.solve_time_hours || "—"}</td>
                      <td style={{ maxWidth:200 }}>{r.spares_used || "—"}</td>
                      <td>{r.bd_attended_by || "—"}</td>
                      <td>{r.created_by || "—"}</td>
                      {isAdmin && (
                        <td style={{ textAlign:"center" }}>
                          <RowDelete chhota
                            kya={`Log Book entry #${r.id} — ${r.machine_no || "?"} · ${String(r.bd_date || "").slice(0, 10)}`}
                            saath={["Spares recorded on this entry (spares on entries created before 2026-09-08 are left alone — they were never linked to an entry id)"]}
                            onDelete={() => hatao.log(r.id)} />
                        </td>
                      )}
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
              <span style={{ display:"flex", gap:8, alignItems:"center" }}>
                {isAdmin && !pmEdit && (
                  <button onClick={pmEditShuru}
                          style={{ padding:"6px 14px", fontSize:12, fontWeight:800, borderRadius:6,
                                   cursor:"pointer", fontFamily:"inherit",
                                   border:"1px solid #1d4ed8", background:"#2563eb", color:"#fff" }}>
                    ✎ Edit
                  </button>
                )}
                {pmEdit && (<>
                  <button onClick={pmSave} disabled={pmBusy}
                          style={{ padding:"6px 14px", fontSize:12, fontWeight:800, borderRadius:6,
                                   cursor:pmBusy ? "default" : "pointer", fontFamily:"inherit",
                                   border:"none", background:pmBusy ? "#86efac" : "#16a34a", color:"#fff" }}>
                    {pmBusy ? "Saving…" : "💾 Save"}
                  </button>
                  <button onClick={pmEditBand} disabled={pmBusy}
                          style={{ padding:"6px 14px", fontSize:12, fontWeight:800, borderRadius:6,
                                   cursor:"pointer", fontFamily:"inherit",
                                   border:"1px solid #cbd5e1", background:"#fff", color:"#334155" }}>
                    Cancel
                  </button>
                </>)}
                <button className="hd-clear"
                        onClick={() => { pmEditBand(); setViewSheet(null); }}>✕ Close</button>
              </span>
            </div>
            {pmErr && (
              <div style={{ background:"#fef2f2", color:"#991b1b", border:"1px solid #fecaca",
                            padding:"8px 16px", fontSize:12.5, fontWeight:700 }}>{pmErr}</div>
            )}
            {pmEdit && (
              <div style={{ background:"#eff6ff", color:"#1e40af", borderBottom:"1px solid #bfdbfe",
                            padding:"7px 16px", fontSize:12, fontWeight:600 }}>
                Editing — type directly into the cells. Signatures and approvals stay as they are;
                the audit log will record that an admin edited this sheet.
              </div>
            )}
            <FormatSheet
              printable
              editable={pmEdit}
              onEdit={(i, key, val) =>
                setPmDraft((d) => d.map((e, ix) => (ix === i ? { ...e, [key]: val } : e)))}
              f={pmFmt ? { ...pmFmt, doc_footer: viewSheet.doc_footer || pmFmt.doc_footer } : pmFmt}
              points={pmEdit ? pmDraft : (viewSheet.entries || [])}
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
              <span style={{ display:"flex", gap:8, alignItems:"center" }}>
                {isAdmin && !dmcEdit && (
                  <button onClick={() => { setDmcDraft({}); setDmcErr(""); setDmcEdit(true); }}
                          style={{ padding:"6px 14px", fontSize:12, fontWeight:800, borderRadius:6,
                                   cursor:"pointer", fontFamily:"inherit",
                                   border:"1px solid #0f766e", background:"#0d9488", color:"#fff" }}>
                    ✎ Edit
                  </button>
                )}
                {dmcEdit && (<>
                  <button onClick={dmcSave} disabled={dmcBusy}
                          style={{ padding:"6px 14px", fontSize:12, fontWeight:800, borderRadius:6,
                                   cursor:dmcBusy ? "default" : "pointer", fontFamily:"inherit",
                                   border:"none", background:dmcBusy ? "#86efac" : "#16a34a", color:"#fff" }}>
                    {dmcBusy ? "Saving…" : "💾 Save"}
                  </button>
                  <button onClick={dmcEditBand} disabled={dmcBusy}
                          style={{ padding:"6px 14px", fontSize:12, fontWeight:800, borderRadius:6,
                                   cursor:"pointer", fontFamily:"inherit",
                                   border:"1px solid #cbd5e1", background:"#fff", color:"#334155" }}>
                    Cancel
                  </button>
                </>)}
                <button className="hd-clear"
                        onClick={() => { dmcEditBand(); setViewDmc(null); }}>✕ Close</button>
              </span>
            </div>
            {dmcErr && (
              <div style={{ background:"#fef2f2", color:"#991b1b", border:"1px solid #fecaca",
                            padding:"8px 16px", fontSize:12.5, fontWeight:700 }}>{dmcErr}</div>
            )}
            {dmcEdit && (
              <div style={{ background:"#f0fdfa", color:"#115e59", borderBottom:"1px solid #99f6e4",
                            padding:"7px 16px", fontSize:12, fontWeight:600 }}>
                Editing — click a day cell to change its mark (blank → ✓ → ✗ → blank).
                {" "}<b>Note:</b> for every day whose mark you change, the supervisor’s verification
                {" "}will be cleared (that signature was given on the old data) — it must be verified again.
                {Object.keys(dmcDraft).length > 0 && (
                  <span style={{ marginLeft:8, fontWeight:800 }}>
                    · {Object.keys(dmcDraft).filter((k) => (dmcDraft[k] || "") !== (dmcBase[k] || "")).length} cell(s) changed so far
                  </span>
                )}
              </div>
            )}
            <DmcSheet printable
                      editable={dmcEdit}
                      onToggle={dmcEdit ? dmcToggle : null}
                      groups={groupDmcPoints(viewDmc.entries || [])} footer={viewDmc.doc_footer || null}
                      values={dmcShow}
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
          mode={editing ? "fill" : "view"}
          phase="maintenance"
          onEdit={isAdmin && !viewTicket.auto_slip ? () => setEditing(true) : null}
          onClose={() => { setEditing(false); setEditErr(""); setViewTicket(null); }}
          onSave={saveSlipEdit}
          token={token}
        />
      )}
      {editErr && (
        <div style={{ position: "fixed", left: "50%", bottom: 24, transform: "translateX(-50%)",
                      zIndex: 9600, background: "#fee2e2", color: "#991b1b",
                      border: "1px solid #fecaca", borderRadius: 10, padding: "10px 16px",
                      fontSize: 12.5, fontWeight: 700 }}
             onClick={() => setEditErr("")}>
          {editErr}
        </div>
      )}

      {/* DMC edit ke baad ka sandesh — sabse zaroori baat ye batani hai ki
          kitne din dobara verify hone ke liye khul gaye.  Wo modal band hone
          ke BAAD dikhna chahiye, isliye yahan page-level par hai. */}
      {dmcInfo && (
        <div style={{ position: "fixed", left: "50%", bottom: 24, transform: "translateX(-50%)",
                      zIndex: 9600, background: "#ecfdf5", color: "#065f46",
                      border: "1px solid #a7f3d0", borderRadius: 10, padding: "10px 16px",
                      fontSize: 12.5, fontWeight: 700, maxWidth: 460, textAlign: "center" }}
             onClick={() => setDmcInfo("")}>
          {dmcInfo}
        </div>
      )}

      {viewAuto && (
        <ClosureFormModal
          ticket={viewAuto}
          mode={editingAuto ? "fill" : "view"}
          onEdit={isAdmin ? () => setEditingAuto(true) : null}
          onClose={() => { setEditingAuto(false); setEditErr(""); setViewAuto(null); }}
          onSave={saveAutoEdit}
          token={token}
        />
      )}
    </>
  );
}
