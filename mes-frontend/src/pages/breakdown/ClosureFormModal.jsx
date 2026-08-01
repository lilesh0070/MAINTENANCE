import { useState, useEffect, useMemo } from "react";
import { Btn, api, fmtDuration, fmtDateTime } from "./shared";

// One spare row — SAME shape the Log Book uses, so spare data is consistent
// across both features.
const EMPTY_SPARE = { spare_name: "", spare_model_no: "", spare_cnmm_no: "", spare_qty: "" };
// Spare ERP Number mask — first 4 ALPHABETIC letters + last 4 NUMERIC digits
// (e.g. ABCD1234).  Formats as you type; ignores anything out of place.
const fmtErp = (raw) => {
  const s = String(raw || "").toUpperCase();
  let out = "";
  for (const ch of s) {
    if (out.length < 4) { if (ch >= "A" && ch <= "Z") out += ch; }
    else if (out.length < 8) { if (ch >= "0" && ch <= "9") out += ch; }
  }
  return out;
};

// Manual slip (pickLine) — the ZONE dropdown is restricted to these zones only,
// in this order.  Values must match the mes_machines master zone_name exactly.
// (Temporary allow-list — add/remove here to change what's offered.)
const MANUAL_SLIP_ZONES = [
  "SEAT_SLIDER", "RECLINER", "PRESS_SHOP", "THIN_RECLINER", "LOOP_PIPE", "SUB_ASSEMBLY",
];
// A readable one-line summary of the spare rows → kept in the legacy
// `spares_used` text field so old readers / the flat column still show them.
const spareSummary = (spares) => (spares || [])
  .filter(s => Object.values(s).some(v => String(v ?? "").trim()))
  .map(s => {
    const bits = [s.spare_name, s.spare_model_no && `[${s.spare_model_no}]`,
                  s.spare_cnmm_no, s.spare_qty && `×${s.spare_qty}`].filter(Boolean);
    return bits.join(" ");
  })
  .join(" ; ");

// Minutes between two "HH:MM" (24h, from <input type=time>) values.
// If the end is earlier than the start we assume it crossed midnight (+24h).
// Returns "" when either time is missing/invalid — so the box stays blank.
const diffMins = (startHHMM, endHHMM) => {
  const p = (t) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || "").trim());
    return m ? (+m[1]) * 60 + (+m[2]) : null;
  };
  const a = p(startHHMM), b = p(endHHMM);
  if (a == null || b == null) return "";
  let d = b - a;
  if (d < 0) d += 24 * 60;              // crossed midnight (same-day fallback)
  return String(d);
};

// Minutes between two FULL date+time points — each = ("YYYY-MM-DD", "HH:MM").
// Unlike diffMins() this uses the DATES too, so a breakdown that is OK'd on a
// LATER day is counted in full (e.g. 27th 03:14 → 29th 03:14 = 2880 min), not
// wrapped at 24h.  Returns "" when any part is missing/invalid, and "" (blank,
// never a negative) when the end point is before the start — that signals the
// dates/times are inconsistent and need fixing.
const diffMinsDT = (startDate, startHHMM, endDate, endHHMM) => {
  const parse = (dstr, tstr) => {
    const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dstr || "").trim());
    const tm = /^(\d{1,2}):(\d{2})$/.exec(String(tstr || "").trim());
    if (!dm || !tm) return null;
    // UTC epoch → no DST / timezone drift, purely arithmetic.
    return Date.UTC(+dm[1], +dm[2] - 1, +dm[3], +tm[1], +tm[2]);
  };
  const a = parse(startDate, startHHMM), b = parse(endDate, endHHMM);
  if (a == null || b == null) return "";
  const mins = Math.round((b - a) / 60000);
  return mins >= 0 ? String(mins) : "";
};

/* ════════════════════════════════════════════════════════════════════
 * Closure form modal — Toyota Boshoku BREAK DOWN SLIP
 * (TBDI/MAINT/F/001 · REV. 00 · 20/03/2024)
 * ════════════════════════════════════════════════════════════════════
 * Layout matches the paper form one-to-one.  Fields auto-populated from
 * the breakdown record (date / shift / line / start time / end time /
 * down time minutes) are pre-filled but stay editable in case the
 * filer wants to override.  Everything else is typed by the user.
 *
 * Submitted payload shape.  The collector-driven close stores it in
 * mes_breakdowns (production_data / maintenance_data); the manual New-Slip
 * (pickLine) flow instead flattens it into the standalone mes_breakdown_data
 * table and never touches mes_breakdowns:
 *   {
 *     zone, line, machine_no, machine_name, date,
 *     shift, line_leader_name, model_no, machine_operator_name,
 *     category, // 'A' | 'B' | 'C'
 *     bd_start_time, bd_received_time, bd_ok_time,
 *     bd_start_date, bd_end_date, mc_down_time_minutes,
 *     problem_reported_by_production,
 *     problem_related_to, // { maintenance: bool, tool_room: bool }
 *     problem_observed_by_maintenance,
 *     action_taken_on_problem,
 *     spares_used,
 *     bd_attended_by,
 *     prepared_by:        { name },
 *     received_by:        { name },
 *     line_leader_operator: { name },
 *     quality_engineer:   { name },
 *   }
 * (Older slips kept a `sign` sibling — preserved in JSONB, no longer
 * displayed in the form since virtual signatures aren't meaningful.)
 *
 * Auto-fill behaviour:
 *   • ZONE / LINE / DATE / SHIFT / B/D times / Down time
 *     → from the breakdown record itself.
 *   • MACHINE NAME ← lookup in mes_machines by (zone, line, machine_no).
 *     We pull the machine list once on open via
 *     /api/machines/by-line/{line_id} and match client-side, so typing
 *     is instantaneous and works offline of the lookup endpoint after
 *     the first fetch.
 */
export function ClosureFormModal({ ticket, mode, phase = "maintenance", onClose, onSave, token, pickLine = false }) {
  // mode  : "fill" | "view"
  // phase : "production" → user can edit only the upper half (Production)
  //         "maintenance" → user can edit only the lower half (Maintenance)
  //         B/D Start/End Time + Date + Down-Time minutes are LOCKED for
  //         both phases (collector stamps these from started_at / ended_at).
  const readOnly      = mode === "view";
  const isProduction  = phase === "production" && !readOnly;
  const isMaintenance = phase === "maintenance" && !readOnly;

  // Cell-level lock helpers: each cell consults whether the active phase
  // is allowed to edit *that field*.
  const PROD_FIELDS = new Set([
    "zone", "line", "machine_no", "machine_name", "date", "shift",
    "line_leader_name", "model_no", "machine_operator_name",
    "category", "bd_received_time", "problem_reported_by_production",
    // times/dates/down-time are now editable + saved too (default from collector)
    "bd_start_time", "bd_ok_time", "bd_start_date", "bd_end_date", "mc_down_time_minutes",
    // auto-computed response time (Start→Received) + the breakdown frequency
    "response_time_minutes", "frequency",
  ]);
  const MAINT_FIELDS = new Set([
    // Machine No. is selectable (dropdown) + saved in the maintenance half
    // too, so a maintenance-driven close still captures the machine.
    "machine_no", "machine_name",
    "problem_related_to", "type_of_problem",
    "problem_observed_by_maintenance", "action_taken_on_problem",
    "spare_used", "spares_used", "spares", "bd_attended_by",
    "prepared_by", "received_by", "line_leader_operator", "quality_engineer",
  ]);
  // (Previously the collector-stamped times/dates were always-locked; they
  // are now editable + saved, defaulting to the collector's values.)
  const LOCKED_FIELDS = new Set([]);
  const fieldEditable = (key) => {
    if (readOnly) return false;
    if (LOCKED_FIELDS.has(key)) return false;   // collector-stamped times/dates stay locked
    if (isProduction)  return PROD_FIELDS.has(key);
    // Maintenance-driven fill = the WHOLE slip is editable (both the upper
    // Production half + the Maintenance half), so a single user can fill it.
    if (isMaintenance) return true;
    return false;
  };

  const [data, setData] = useState({});
  const [saving, setSaving] = useState(false);
  const [machines, setMachines] = useState([]);  // [{serial_no, machine_no(code), machine_name}]
  // Manual "New Break Down Slip" (opened blank from the sidebar): ZONE / LINE /
  // MACHINE NO. / MACHINE NAME all come from the Machine Master (mes_machines)
  // via /api/machines/ — the SAME source every other Zone/Line/Machine filter
  // in the app uses.  The slip saves to the standalone mes_breakdown_data table,
  // so no mes_lines.line_id is needed.
  const [masterRows, setMasterRows]     = useState([]);
  const [spareMaster, setSpareMaster]   = useState([]);   // spare picker (maintenance_spare)

  // ── Auto-fill on first open from the breakdown record ─────────────
  useEffect(() => {
    if (!ticket) return;
    const start = ticket.started_at ? new Date(ticket.started_at) : null;
    const end   = ticket.ended_at   ? new Date(ticket.ended_at)   : null;
    const fmtDate = (d) => d ? d.toISOString().slice(0,10) : "";
    const fmtTime = (d) => d ? d.toTimeString().slice(0,5)  : "";
    const downMin = ticket.duration_seconds
      ? Math.round(ticket.duration_seconds / 60)
      : null;

    // Pull existing halves from the breakdown record (so re-opening shows
    // what's already filled).  In "view" mode we also fall back to the
    // legacy single closure_data blob for older rows.
    const prod  = ticket.production_data  || {};
    const maint = ticket.maintenance_data || {};
    const legacy = readOnly ? (ticket.closure_data || {}) : {};

    // Resolved times (used both for the raw cells AND the auto-computed
    // Response Time / Down Time below).
    const _st  = prod.bd_start_time    ?? legacy.bd_start_time    ?? fmtTime(start);
    const _rcv = prod.bd_received_time ?? legacy.bd_received_time ?? "";
    const _ok  = prod.bd_ok_time       ?? legacy.bd_ok_time       ?? fmtTime(end);
    // Resolved dates — needed for the DATE-AWARE down-time (Start → OK can span
    // several days), so compute them here alongside the times.
    const _sd  = prod.bd_start_date    ?? legacy.bd_start_date    ?? fmtDate(start);
    // Default END DATE to the START DATE (never blank) so the down-time is
    // always DATE-AWARE and END ≥ START holds from the start — the user just
    // bumps END to the next day for an overnight breakdown.  (Both slips.)
    const _ed  = prod.bd_end_date      ?? legacy.bd_end_date      ?? (fmtDate(end) || _sd);

    // Auto-locked timestamps always sourced from collector — never from
    // any saved blob — so they reflect the live record.
    setData({
      // Production half (or carried-over)
      zone:                  prod.zone               ?? legacy.zone               ?? ticket.zone_name ?? "",
      line:                  prod.line               ?? legacy.line               ?? ticket.line_name ?? "",
      machine_no:            prod.machine_no         ?? legacy.machine_no         ?? "",
      machine_name:          prod.machine_name       ?? legacy.machine_name       ?? "",
      date:                  prod.date               ?? legacy.date               ?? fmtDate(start),
      shift:                 prod.shift              ?? legacy.shift              ?? ticket.shift_name ?? "",
      line_leader_name:      prod.line_leader_name   ?? legacy.line_leader_name   ?? "",
      model_no:              prod.model_no           ?? legacy.model_no           ?? "",
      machine_operator_name: prod.machine_operator_name ?? legacy.machine_operator_name ?? "",
      category:              prod.category           ?? legacy.category           ?? "",
      bd_received_time:      _rcv,
      // Response time (auto: Start → Received) + Frequency — now on BOTH the
      // manual and the auto/dashboard slip so the format is identical.
      response_time_minutes: prod.response_time_minutes ?? legacy.response_time_minutes ?? diffMins(_st, _rcv),
      frequency:             prod.frequency ?? legacy.frequency ?? "1",
      problem_reported_by_production:
        prod.problem_reported_by_production ?? legacy.problem_reported_by_production ?? "",

      // Times/dates/down-time — default from the collector, but editable &
      // saved (read the saved value first if the slip was already filled).
      bd_start_time:        _st,
      bd_ok_time:           _ok,
      bd_start_date:        _sd,
      bd_end_date:          _ed,
      // M/C Down Time — auto-computed from Start → OK using the DATES too (so a
      // next-day / multi-day OK is counted in full) on BOTH slips; falls back
      // to the saved / collector value when the times aren't both set.
      mc_down_time_minutes:
        (_sd && _ed ? diffMinsDT(_sd, _st, _ed, _ok) : diffMins(_st, _ok))
        || prod.mc_down_time_minutes || legacy.mc_down_time_minutes
        || (downMin != null ? String(downMin) : ""),

      // Maintenance half (or carried-over)
      problem_related_to:      maint.problem_related_to      ?? legacy.problem_related_to      ?? { maintenance: true, tool_room: false },
      // 2026-05-20 — Multi-select (electrical and/or mechanical can both
      // be ticked, unlike problem_related_to which is single-pick).
      type_of_problem:         maint.type_of_problem         ?? legacy.type_of_problem         ?? { electrical: false, mechanical: false },
      problem_observed_by_maintenance: maint.problem_observed_by_maintenance ?? legacy.problem_observed_by_maintenance ?? "",
      action_taken_on_problem: maint.action_taken_on_problem ?? legacy.action_taken_on_problem ?? "",
      spares_used:             maint.spares_used             ?? legacy.spares_used             ?? "",
      // Repeatable Spare Details (same shape as the Log Book): one breakdown
      // can consume several spares.  `spares_used` above is kept as a derived
      // text summary so old readers / the flat column still get something.
      spares: (Array.isArray(maint.spares) && maint.spares.length ? maint.spares
             : Array.isArray(legacy.spares) && legacy.spares.length ? legacy.spares
             : [{ ...EMPTY_SPARE }]).map(s => ({ ...EMPTY_SPARE, ...s })),
      // "Spare used?" Yes/No — Yes reveals the Spare Details grid (all columns
      // then mandatory).  Default: infer from any already-filled spare, else No.
      spare_used: maint.spare_used ?? legacy.spare_used ?? (
        (maint.spares || legacy.spares || [])
          .some(s => Object.values(s || {}).some(v => String(v ?? "").trim())) ? "yes" : "no"),
      bd_attended_by:          maint.bd_attended_by          ?? legacy.bd_attended_by          ?? "",
      prepared_by:             maint.prepared_by             ?? legacy.prepared_by             ?? { name: "" },
      received_by:             maint.received_by             ?? legacy.received_by             ?? { name: "" },
      line_leader_operator:    maint.line_leader_operator    ?? legacy.line_leader_operator    ?? { name: "" },
      quality_engineer:        maint.quality_engineer        ?? legacy.quality_engineer        ?? { name: "" },
    });
  }, [ticket?.id, readOnly, phase]);

  // Effective line id — only a collector-opened ticket carries one.  The
  // manual New-Slip flow saves to a standalone table and needs no line_id.
  const effLineId = ticket?.line_id ?? null;

  // Manual mode: pull the whole Machine Master once (same source & row shape
  // the app's other Zone/Line/Machine filters use) to drive the dropdowns.
  useEffect(() => {
    if (!pickLine || !token) return;
    let cancelled = false;
    api.get("/api/machines/", token)
      .then(rows => { if (!cancelled) setMasterRows(Array.isArray(rows) ? rows : []); })
      .catch(() => { if (!cancelled) setMasterRows([]); });
    return () => { cancelled = true; };
  }, [pickLine, token]);

  // Spare master (maintenance_spare) → Spare Name autocomplete + auto-fill.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    api.get("/api/maintenance-spare/", token)
      .then(rows => { if (!cancelled) setSpareMaster(Array.isArray(rows) ? rows : []); })
      .catch(() => { if (!cancelled) setSpareMaster([]); });
    return () => { cancelled = true; };
  }, [token]);

  // ── Collector-opened slip: pull the machine list for the ticket's line and
  // auto-fill Zone + Line from the master.  (Manual mode gets its machines
  // from `masterRows` via `machineRows` below, so this is skipped there.)
  useEffect(() => {
    if (pickLine || !ticket?.line_id || !token) return;
    let cancelled = false;
    api.get(`/api/machines/by-line/${ticket.line_id}`, token)
      .then(res => {
        if (cancelled) return;
        setMachines(res?.machines || []);
        if (res?.zone_name || res?.line_name) {
          setData(d => ({
            ...d,
            zone: res.zone_name ?? d.zone,
            line: res.line_name ?? d.line,
          }));
        }
      })
      .catch(() => {});  // empty list — manual entry still works
    return () => { cancelled = true; };
  }, [ticket?.line_id, token, pickLine]);

  // Manual (pickLine) dropdown option lists — all sourced from the Machine
  // Master (mes_machines): distinct ZONE → LINE in that zone → MACHINE NO. for
  // that (zone, line).  MACHINE NAME auto-fills from the picked machine row.
  const zoneOptions = useMemo(() => {
    // Only the allow-listed zones that actually exist in the master, in the
    // MANUAL_SLIP_ZONES order (restricted per request).
    const present = new Set(masterRows.map(m => m.zone_name).filter(Boolean));
    return MANUAL_SLIP_ZONES.filter(z => present.has(z));
  }, [masterRows]);
  const lineOptions = useMemo(
    () => [...new Set(masterRows.filter(m => m.zone_name === data.zone)
                               .map(m => m.line_name).filter(Boolean))]
           .sort((a, b) => String(a).localeCompare(String(b))),
    [masterRows, data.zone]);
  // Machine rows for the current (zone, line): master-filtered in manual mode,
  // or the by-line list in the collector flow.  Feeds MACHINE NO. options and
  // the MACHINE NAME auto-fill in both.
  const machineRows = useMemo(
    () => pickLine
      ? masterRows.filter(m => m.zone_name === data.zone && m.line_name === data.line)
      : machines,
    [pickLine, masterRows, machines, data.zone, data.line]);

  if (!ticket) return null;

  const set    = (k, v) => setData(d => ({ ...d, [k]: v }));
  const setSub = (parent, k, v) =>
    setData(d => ({ ...d, [parent]: { ...(d[parent] || {}), [k]: v } }));

  // Re-derive the two auto totals from a full data slice (manual slip only):
  //   RESPONSE TIME  = Received − Start        (same-day, minutes-scale)
  //   M/C DOWN TIME  = (End date + OK) − (Start date + Start)  — DATE-AWARE, so
  //                    an OK on a later day is counted in full.
  const recalcTotals = (d) => ({
    ...d,
    response_time_minutes: diffMins(d.bd_start_time, d.bd_received_time),
    mc_down_time_minutes:
      (d.bd_start_date && d.bd_end_date)
        ? diffMinsDT(d.bd_start_date, d.bd_start_time, d.bd_end_date, d.bd_ok_time)
        : diffMins(d.bd_start_time, d.bd_ok_time),
  });

  // Changing any of the 3 times re-computes both auto totals.
  const setTime = (k, v) => setData(d => recalcTotals({ ...d, [k]: v }));

  // ── Date handlers with the "END ≥ START" rule ──────────────────────
  // END DATE can never be before START DATE.  ISO "YYYY-MM-DD" strings sort
  // lexically, so a plain `<` is a valid date comparison here.
  // Manual slip: START moves → bump END up if it would fall behind; recompute
  // the auto down-time.  Dashboard slip: same guard, but no auto-recompute
  // (down-time is entered manually there).
  const setStartDate = (v, recompute) => setData(d => {
    const ed = (d.bd_end_date && v && d.bd_end_date < v) ? v : d.bd_end_date;
    const nd = { ...d, bd_start_date: v, bd_end_date: ed };
    return recompute ? recalcTotals(nd) : nd;
  });
  const setEndDate = (v, recompute) => setData(d => {
    if (d.bd_start_date && v && v < d.bd_start_date) return d;   // reject: END < START
    const nd = { ...d, bd_end_date: v };
    return recompute ? recalcTotals(nd) : nd;
  });

  // ── repeatable Spare Details (same as the Log Book) ──
  // Every change keeps `spares` (structured) AND `spares_used` (text summary)
  // in sync, so both the new JSONB column and the legacy text column stay right.
  const withSpares = (d, spares) => ({ ...d, spares, spares_used: spareSummary(spares) });
  const setSpare = (i, k, v) => setData(d =>
    withSpares(d, (d.spares || []).map((s, idx) => idx === i ? { ...s, [k]: v } : s)));
  // Spare Name picker (from maintenance_spare): choosing a known spare auto-fills
  // its Model No. / CNMM No.; a new name is kept (and added to the master on save).
  const onSpareName = (i, v) => setData(d => withSpares(d,
    (d.spares || []).map((s, idx) => {
      if (idx !== i) return s;
      const hit = spareMaster.find(m => String(m.spare_name || "").toLowerCase() === String(v).trim().toLowerCase());
      return hit
        ? { ...s, spare_name: v, spare_model_no: hit.spare_model_no || s.spare_model_no, spare_cnmm_no: hit.spare_cnmm_no || s.spare_cnmm_no }
        : { ...s, spare_name: v };
    })));
  const addSpare = () => setData(d => withSpares(d, [...(d.spares || []), { ...EMPTY_SPARE }]));
  const removeSpare = (i) => setData(d => {
    const next = (d.spares || []).filter((_, idx) => idx !== i);
    return withSpares(d, next.length ? next : [{ ...EMPTY_SPARE }]);
  });

  // Machine No. is a dropdown of this (zone, line)'s machines (from the Machine
  // Master, mes_machines).  Picking a Machine No. auto-fills the Machine Name
  // from the same master row.  No Serial No. needed.
  const onPickMachine = (mno) => {
    const hit = machineRows.find(m => String(m.machine_no) === String(mno));
    setData(d => ({ ...d, machine_no: mno, machine_name: hit ? hit.machine_name : "" }));
  };

  // Manual mode: picking a ZONE resets the line + machine below it; picking a
  // LINE resets the machine.  (Values are stored as text — the standalone
  // slip table needs no line_id, so any master line works.)
  const onPickZone = (z) =>
    setData(d => ({ ...d, zone: z, line: "", machine_no: "", machine_name: "" }));
  const onPickLine = (ln) =>
    setData(d => ({ ...d, line: ln, machine_no: "", machine_name: "" }));

  // Extract just the slice of `data` that the active phase is responsible
  // for.  The parent passes this to its API call so the *other* half
  // doesn't get overwritten.
  const subsetForPhase = () => {
    const pick = (set) => Object.fromEntries(
      Object.entries(data).filter(([k]) => set.has(k)),
    );
    if (isProduction)  return pick(PROD_FIELDS);
    if (isMaintenance) return pick(MAINT_FIELDS);
    return data;
  };

  // Required-field gate: per-phase Submit button only enables once every
  // *editable* field has a non-empty value.  Locked + other-phase fields
  // are ignored.
  const phaseComplete = () => {
    const pick = (set) => Object.fromEntries(Object.entries(data).filter(([k]) => set.has(k)));
    // Manual slip fills the WHOLE slip in one go → validate BOTH the Production +
    // Maintenance halves before submit.  The collector/dashboard slip validates
    // only the active phase's fields (each half is filled separately there).
    const slice = pickLine ? { ...pick(PROD_FIELDS), ...pick(MAINT_FIELDS) } : subsetForPhase();
    const checkVal = (v) => {
      if (v == null) return false;
      if (typeof v === "string") return v.trim().length > 0;
      if (Array.isArray(v)) return true;    // spares handled by their own rule below
      if (typeof v === "object") {
        // radio (problem_related_to) → one true; multi (type_of_problem) → ≥1 true;
        // signatures (prepared_by …) → require a name.
        if ("maintenance" in v && "tool_room" in v) return v.maintenance || v.tool_room;
        if ("electrical" in v && "mechanical" in v) return v.electrical || v.mechanical;
        if ("name" in v) return !!(v.name && String(v.name).trim());
        return Object.keys(v).length > 0;
      }
      return true;
    };
    // Auto-computed (response_time / mc_down_time) + the raw spare fields never
    // block via the generic check — spares get their own rule right below.
    const OPTIONAL = new Set(["spares", "spares_used",
                              "response_time_minutes", "mc_down_time_minutes"]);
    if (!Object.entries(slice).every(([k, v]) => OPTIONAL.has(k) || checkVal(v))) return false;
    // SPARE USED = YES → at least one spare row, and EVERY filled row must have
    // ALL 4 columns.  (When NO, the grid is hidden and spares don't block.)
    if (data.spare_used === "yes") {
      const cols = ["spare_name", "spare_model_no", "spare_cnmm_no", "spare_qty"];
      const rows = (data.spares || []).filter(s => cols.some(c => String(s[c] ?? "").trim()));
      if (!rows.length || !rows.every(s => cols.every(c => String(s[c] ?? "").trim()))) return false;
    }
    return true;
  };

  const submit = async () => {
    setSaving(true);
    try {
      // In the maintenance fill the whole slip is editable, so also send the
      // Production-half fields the user filled (saved into production_data).
      const prodExtra = isMaintenance
        ? Object.fromEntries(Object.entries(data).filter(([k]) => PROD_FIELDS.has(k)))
        : null;
      await onSave(subsetForPhase(), phase, prodExtra, effLineId);
    } finally { setSaving(false); }
  };

  // ── Print the slip via a hidden iframe ────────────────────────────
  // Why an iframe instead of `window.print()` directly?
  //   1. The whole app's DOM (slide nav, dashboard topbar, ANDON tables,
  //      etc.) sits inside <body>.  Even with `visibility: hidden`
  //      everywhere, those elements still occupy layout space — so the
  //      printer ends up emitting the slip on page 1 and an empty page
  //      where the rest of the app *would* be on page 2.
  //   2. window.print() uses the host page's title + URL for the browser-
  //      injected header band ("Historical Data" / "192.168.10.185:9965/…").
  //      An iframe with an empty title and no surrounding chrome side-steps
  //      both — combined with @page margin:0 we get a clean single-sheet
  //      print of just the slip.
  const printSlip = () => {
    const node = document.querySelector(".bds-modal");
    if (!node) return;
    const slipHtml = node.outerHTML;
    // Pull all the <style> blocks the host page has injected so the slip
    // looks identical inside the iframe (font, table grid, colours).
    const styles = Array.from(document.querySelectorAll("style"))
      .map(s => s.innerHTML).join("\n");

    // Build a minimal printable document.  The slip is wrapped in a
    // fixed-A4-landscape container with overflow hidden — after layout,
    // we measure the natural size and apply a CSS scale so it fits the
    // page exactly with no scroll-bars or page breaks.
    //
    // Two-layer fit strategy:
    //   1. Aggressive shrink CSS (small fonts, tight padding) — usually
    //      enough on its own.
    //   2. JS-driven `transform: scale()` fallback for outlier cases
    //      where the shrunk version still overflows the A4 page.
    const html = `
<!doctype html>
<html><head><title></title>
<style>${styles}</style>
<style>
  @page { size: A4 landscape; margin: 0; }
  html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; overflow: hidden; }

  /* Page-sized container — exactly one A4 landscape sheet.  Anything
     that doesn't fit gets clipped; the JS pass below scales the inner
     down so nothing actually clips. */
  .bds-print-page {
    width: 297mm; height: 210mm;
    margin: 0; padding: 0; box-sizing: border-box;
    overflow: hidden; position: relative;
    background: #fff;
  }
  .bds-print-fit {
    transform-origin: top left;
    /* transform: scale(N) injected by JS after layout */
  }

  .bds-modal {
    position: static !important; box-shadow: none !important;
    border-radius: 0 !important; max-width: none !important;
    width: 297mm !important;
    margin: 0 !important; padding: 6mm !important; box-sizing: border-box !important;
  }
  .bds-close-x, .bds-print-btn, .bds-footer { display: none !important; }
  .bds-body { max-height: none !important; overflow: visible !important; padding: 0 !important; }

  /* ── Print-only size shrink ─────────────────────────────────────────
     Tighter padding + smaller fonts than the on-screen modal so the
     full slip fits on a single A4 landscape page.  The JS scale-to-fit
     handles edge cases where it's still slightly too tall. */
  .bds-letterhead { border-bottom-width: 1.5px !important; }
  .bds-logo { width: 90px !important; padding: 4px 6px !important; }
  .bds-logo img { max-height: 50px !important; }
  .bds-logo-sub { font-size: 7px !important; }
  .bds-company { font-size: 14px !important; }
  .bds-doc-title { font-size: 11px !important; margin-top: 1px !important; }

  .bds-cell { min-height: 22px !important; }
  .bds-cell-label { font-size: 8px !important; padding: 3px 6px !important; min-width: 110px !important; }
  .bds-cell-input input { font-size: 10px !important; padding: 2px 6px !important; min-height: 20px !important; }

  .bds-cat-head { padding: 3px 8px !important; font-size: 9px !important; }
  .bds-cat-tickdown { font-size: 7px !important; }
  .bds-cat-row { min-height: 20px !important; }
  .bds-cat-cell-code { font-size: 9px !important; padding: 3px 8px !important; }
  .bds-cat-cell-desc { font-size: 9px !important; padding: 3px 8px !important; }
  .bds-cat-cell-tick input { width: 14px !important; height: 14px !important; }

  .bds-row { min-height: 36px !important; }
  .bds-row-label { font-size: 8px !important; padding: 3px 6px !important; }
  .bds-row-input textarea { font-size: 10px !important; padding: 3px 6px !important; min-height: 36px !important; }

  .bds-divider { padding: 3px 8px !important; font-size: 9px !important; }
  .bds-relto-row { padding: 4px 8px !important; gap: 16px !important; }
  .bds-relto-label { font-size: 9px !important; }
  .bds-relto-opt { font-size: 9px !important; }
  .bds-relto-opt input { width: 13px !important; height: 13px !important; }

  .bds-sign-head { padding: 3px 8px !important; font-size: 9px !important; }
  .bds-sign-head .bds-sign-sub { font-size: 8px !important; }
  .bds-sign-cell { padding: 3px 6px !important; }
  .bds-sign-line { font-size: 8px !important; padding: 2px 0 !important; }
  .bds-sign-line input { font-size: 10px !important; padding: 1px 4px !important; }

  /* Inputs print as plain text on a thin baseline (no input boxes) */
  .bds-cell-input input, .bds-row-input textarea, .bds-sign-line input {
    border: none !important; outline: none !important;
    background: transparent !important;
    color: #000 !important; -webkit-text-fill-color: #000 !important;
    opacity: 1 !important;
  }
  .bds-cell, .bds-row, .bds-cat-row, .bds-sign-grid > * { page-break-inside: avoid; }
</style>
</head><body><div class="bds-print-page"><div class="bds-print-fit">${slipHtml}</div></div></body></html>`;

    const iframe = document.createElement("iframe");
    Object.assign(iframe.style, {
      position: "fixed", right: "0", bottom: "0",
      width: "0", height: "0", border: "0", visibility: "hidden",
    });
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) { document.body.removeChild(iframe); return; }
    doc.open();  doc.write(html);  doc.close();

    // Give the iframe a tick to lay out, measure, fit-to-page, then print.
    setTimeout(() => {
      try {
        const win = iframe.contentWindow;
        const idoc = win?.document;
        const page = idoc?.querySelector(".bds-print-page");
        const fit  = idoc?.querySelector(".bds-print-fit");
        if (page && fit) {
          // Available landscape print area, in pixels (the iframe doc
          // sized .bds-print-page in mm — we use its measured pixel size
          // so we don't have to know the browser's DPI).
          const targetW = page.clientWidth;
          const targetH = page.clientHeight;
          const naturalW = fit.scrollWidth;
          const naturalH = fit.scrollHeight;
          // Pick the smaller axis ratio so neither dimension overflows.
          // Never scale UP (only down) — full-size content prints
          // unmodified; oversize content shrinks to fit.
          const sx = targetW / naturalW;
          const sy = targetH / naturalH;
          const s  = Math.min(sx, sy, 1);
          if (s < 0.999) fit.style.transform = `scale(${s})`;
        }
        win?.focus();
        win?.print();
      } catch {}
      // Cleanup after the print dialog returns.
      setTimeout(() => {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      }, 1500);
    }, 300);
  };

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(15,23,42,.55)",
      backdropFilter: "blur(2px)", zIndex: 9000,
      display: "flex", alignItems: "flex-start", justifyContent: "center",
      overflowY: "auto", padding: "24px 12px",
    }}>
      <div className="bds-modal" onClick={(e) => e.stopPropagation()} style={{
        width: "100%", maxWidth: 980, background: "#fff",
        borderRadius: 12, boxShadow: "0 20px 60px rgba(0,0,0,.35)",
        overflow: "hidden",
      }}>
        {/* Header — matches the paper form's letterhead */}
        <div className="bds-letterhead">
          <div className="bds-logo">
              <img src="/logo.jpg" alt="logo"
                style={{ width: "70%", height: "70%", objectFit: "contain" }}
                onError={e => { e.target.style.display="none"; }}
              />            <div className="bds-logo-sub">TOYOTA BOSHOKU</div>
          </div>
          <div className="bds-letter-title">
            <div className="bds-company">TOYOTA BOSHOKU DEVICE INDIA PVT. LTD.</div>
            <div className="bds-doc-title">BREAK DOWN SLIP</div>
          </div>
          {/* Print button — only meaningful in read-only view.  Renders
              the slip into a hidden iframe and prints THAT, so we never
              show the surrounding app on paper and the browser-injected
              header/footer (date / URL / page-number band) is dropped
              by the @page margin:0 the iframe carries inside. */}
          {readOnly && (
            <div className="bds-print-btn" onClick={() => printSlip()} title="Print this slip">
              🖨 Print
            </div>
          )}
          <div className="bds-close-x" onClick={onClose} title="Close">×</div>
        </div>

        {/* Body — scrolls inside the modal */}
        <div className="bds-body">
          {/* ── Header grid (3×3) ─────────────────────────────── */}
          {/* ZONE / LINE auto-filled from the Machine Master (by-line).
              MACHINE NO. is a dropdown of that (zone, line)'s machines;
              picking one auto-fills MACHINE NAME.  (Serial No. removed.) */}
          <div className="bds-grid bds-grid-3">
            <BdsCell label="ZONE"
                     value={data.zone}             readOnly={!fieldEditable("zone")}
                     options={pickLine ? zoneOptions : undefined}
                     onChange={pickLine ? onPickZone : (v => set("zone", v))}/>
            <BdsCell label="MACHINE NO."
                     value={data.machine_no}          readOnly={!fieldEditable("machine_no")}
                     options={machineRows.map(m => m.machine_no).filter(Boolean)}
                     onChange={onPickMachine}/>
            <BdsCell label="DATE" type="date"
                     value={data.date}             readOnly={!fieldEditable("date")}
                     onChange={v => set("date", v)}/>

            <BdsCell label="LINE"
                     value={data.line}             readOnly={!fieldEditable("line")}
                     options={pickLine ? lineOptions : undefined}
                     onChange={pickLine ? onPickLine : (v => set("line", v))}/>
            <BdsCell label="SHIFT"
                     value={data.shift}            readOnly={!fieldEditable("shift")}
                     options={pickLine ? ["A", "B"] : undefined}
                     onChange={v => set("shift", v)}/>
            <BdsCell label="LINE LEADER NAME"
                     value={data.line_leader_name} readOnly={!fieldEditable("line_leader_name")}
                     onChange={v => set("line_leader_name", v)}/>

            <BdsCell label="MACHINE OPERATOR NAME"
                     value={data.machine_operator_name} readOnly={!fieldEditable("machine_operator_name")}
                     onChange={v => set("machine_operator_name", v)}/>
            <BdsCell label="MACHINE NAME"
                     value={data.machine_name}        readOnly
                     onChange={() => {}}/>
            <BdsCell label="MODEL NO."
                     value={data.model_no}            readOnly={!fieldEditable("model_no")}
                     onChange={v => set("model_no", v)}/>
          </div>

          {/* ── Break-down category ────────────────────────────── */}
          <div className="bds-cat-head">
            <div>BREAK DOWN TYPE ( CATEGORY ) :-</div>
            <div className="bds-cat-tickdown">TICK DOWN<br/>(✓)</div>
          </div>
          {[
            { code: "A", desc: "MACHINE OR LINE HAS STOPPED AND PRODUCTION LOSS DIRECTLY" },
            { code: "B", desc: "MACHINE RUNNING WITH PRODUCTION LOSS ( PRODUCTION EFFECTED )" },
            { code: "C", desc: "WORK DONE WHEN MACHINE IDEAL I.E - DURING LUNCH & AFTER SHIFT END TIME." },
          ].map(c => (
            <div key={c.code} className="bds-cat-row">
              <div className="bds-cat-cell-code">{c.code} CATEGORY B/D :-</div>
              <div className="bds-cat-cell-desc">{c.desc}</div>
              <div className="bds-cat-cell-tick">
                <input type="checkbox"
                       disabled={!fieldEditable("category")}
                       checked={data.category === c.code}
                       onChange={e => set("category", e.target.checked ? c.code : "")}/>
              </div>
            </div>
          ))}

          {/* ── Time + date + downtime row ───────────────────────
              SAME format for BOTH the manual (pickLine) and the auto/dashboard
              slip: auto RESPONSE TIME (Start→Received), auto DATE-AWARE M/C DOWN
              TIME (Start→OK), and a FREQUENCY field.  Any time/date change
              re-computes the two auto totals via setTime / setStartDate. */}
          <div className="bds-grid bds-grid-3">
            <BdsCell label="B/D START TIME" type="time"
                     value={data.bd_start_time}    readOnly={!fieldEditable("bd_start_time")}
                     onChange={v => setTime("bd_start_time", v)}/>
            <BdsCell label="B/D RECEIVED TIME" type="time"
                     value={data.bd_received_time} readOnly={!fieldEditable("bd_received_time")}
                     onChange={v => setTime("bd_received_time", v)}/>
            {/* AUTO: Start → Received (maintenance response time), read-only */}
            <BdsCell label="RESPONSE TIME ( MIN )" type="number" readOnly
                     value={data.response_time_minutes}/>

            <BdsCell label="B/D OK TIME" type="time"
                     value={data.bd_ok_time}       readOnly={!fieldEditable("bd_ok_time")}
                     onChange={v => setTime("bd_ok_time", v)}/>
            {/* AUTO: Start → OK (total machine down time), read-only */}
            <BdsCell label="M/C DOWN TIME ( MIN )" type="number" readOnly
                     value={data.mc_down_time_minutes}/>
            <BdsCell label="FREQUENCY" type="number"
                     value={data.frequency}        readOnly={!fieldEditable("frequency")}
                     onChange={v => set("frequency", v)}/>

            <BdsCell label="B/D START DATE" type="date"
                     value={data.bd_start_date}    readOnly={!fieldEditable("bd_start_date")}
                     onChange={v => setStartDate(v, true)}/>
            <BdsCell label="B/D END DATE" type="date" min={data.bd_start_date}
                     value={data.bd_end_date}      readOnly={!fieldEditable("bd_end_date")}
                     onChange={v => setEndDate(v, true)}/>
            <div />
          </div>

          {/* ── Reported by Production ─────────────────────────── */}
          <BdsRow label="PROBLEM REPORTED BY PRODUCTION"
                  value={data.problem_reported_by_production}
                  readOnly={!fieldEditable("problem_reported_by_production")}
                  onChange={v => set("problem_reported_by_production", v)}/>

          {/* Production users only see + fill the upper half — the entire
              Maintenance / Tool Room block (divider, related-to, problem
              observed, action, spares, attended-by, signatures) is hidden
              for them.  Maintenance phase + read-only "view" mode show
              the lower half with the rules already configured above. */}
          {/* Lower half visibility — gated on the *phase* (not isProduction)
              so that view-mode callers can ALSO suppress it.  Production
              user opening a slip from Historical → Breakdown Slips passes
              phase="production" and sees only what they filled (upper
              half); maintenance + admin pass phase="maintenance" and see
              the full slip including this lower half. */}
          {phase !== "production" && <>
          {/* ── Maintenance / Tool Room block divider ──────────── */}
          <div className="bds-divider">TO BE FILLED BY MAINTENANCE/TOOL ROOM:-</div>

{/* ── Problem related to (radio-style: only one of Maintenance /
                 Tool Room can be selected at a time) ──────────────── */}
          <div className="bds-relto-row">
            <div className="bds-relto-label">PROBLEM RELATED TO ( PLEASE TICK ☑ )</div>
            <label className="bds-relto-opt">
  <input type="radio" name="problem_related_to"
                     disabled={!fieldEditable("problem_related_to")}
                     checked={!!data.problem_related_to?.maintenance}
                      onChange={() => set("problem_related_to",
                                         { maintenance: true, tool_room: false })}/>
              MAINTENANCE
            </label>
    <label className="bds-relto-opt">
              <input type="radio" name="problem_related_to"
                     disabled={!fieldEditable("problem_related_to")}
                     checked={!!data.problem_related_to?.tool_room}
 onChange={() => set("problem_related_to",
                                         { maintenance: false, tool_room: true })}/>
              TOOL ROOM
            </label>
          </div>

          {/* ── Type of problem (multi-select: electrical / mechanical
                 can BOTH be ticked at the same time, unlike the radio
                 above).  Added 2026-05-20 on operator request — slip
                 needed an explicit electrical-vs-mechanical bucket so
                 the CAPA report can group by failure category. ─── */}
          <div className="bds-relto-row">
            <div className="bds-relto-label">TYPE OF PROBLEM ( TICK ALL THAT APPLY )</div>
            <label className="bds-relto-opt">
              <input type="checkbox"
                     disabled={!fieldEditable("type_of_problem")}
                     checked={!!data.type_of_problem?.electrical}
                     onChange={e => set("type_of_problem", {
                       ...(data.type_of_problem || {}),
                       electrical: e.target.checked,
                     })}/>
              ELECTRICAL
            </label>
            <label className="bds-relto-opt">
              <input type="checkbox"
                     disabled={!fieldEditable("type_of_problem")}
                     checked={!!data.type_of_problem?.mechanical}
                     onChange={e => set("type_of_problem", {
                       ...(data.type_of_problem || {}),
                       mechanical: e.target.checked,
                     })}/>
              MECHANICAL
            </label>
          </div>

          {/* ── Investigation + action ─────────────────────────── */}
          <BdsRow label="ACTUAL PROBLEM OBSERVED BY MAINTENANCE / TOOL ROOM"
                  value={data.problem_observed_by_maintenance}
                  readOnly={!fieldEditable("problem_observed_by_maintenance")}
                  onChange={v => set("problem_observed_by_maintenance", v)}/>
          <BdsRow label="ACTION TAKEN ON PROBLEM"
                  value={data.action_taken_on_problem}
                  readOnly={!fieldEditable("action_taken_on_problem")}
                  onChange={v => set("action_taken_on_problem", v)}/>
          {/* ── SPARE USED?  YES reveals the (mandatory) Spare Details grid ── */}
          <div className="bds-relto-row">
            <div className="bds-relto-label">SPARE USED ?</div>
            <label className="bds-relto-opt">
              <input type="radio" name="spare_used"
                     disabled={!fieldEditable("spare_used")}
                     checked={data.spare_used === "yes"}
                     onChange={() => set("spare_used", "yes")}/>
              YES
            </label>
            <label className="bds-relto-opt">
              <input type="radio" name="spare_used"
                     disabled={!fieldEditable("spare_used")}
                     checked={data.spare_used === "no"}
                     onChange={() => setData(d => withSpares({ ...d, spare_used: "no" }, [{ ...EMPTY_SPARE }]))}/>
              NO
            </label>
          </div>
          {/* ── SPARE DETAILS (repeatable) — only shown when SPARE USED = YES;
                 then every column of every row is mandatory (see phaseComplete). ── */}
          {data.spare_used === "yes" && (() => {
            const spEdit = fieldEditable("spares");
            const rows = data.spares && data.spares.length ? data.spares : [{ ...EMPTY_SPARE }];
            const cell = { flex: "1 1 0", minWidth: 0, borderRight: "1px solid #cbd5e1",
                           display: "flex", flexDirection: "column" };
            const lbl = { padding: "3px 8px", background: "#f1f5f9", fontWeight: 800, fontSize: 9,
                          color: "#0f172a", letterSpacing: ".02em", borderBottom: "1px solid #cbd5e1", whiteSpace: "nowrap" };
            const inp = { width: "100%", border: "none", outline: "none", background: "transparent",
                          padding: "5px 8px", fontSize: 12, fontWeight: 500, color: "#0f172a",
                          fontFamily: "inherit", boxSizing: "border-box" };
            return (
              <div style={{ borderLeft: "1.5px solid #0f172a", borderRight: "1.5px solid #0f172a",
                            borderTop: "1.5px solid #0f172a" }}>
                <div style={{ padding: "6px 10px", background: "#f1f5f9", fontWeight: 800,
                              fontSize: 10, color: "#0f172a", letterSpacing: ".02em",
                              borderBottom: "1px solid #cbd5e1", display: "flex", alignItems: "center", gap: 8 }}>
                  🔧 SPARE DETAILS ( IF ANY )
                  {rows.filter(s => Object.values(s).some(v => String(v ?? "").trim())).length > 1 && (
                    <span style={{ fontWeight: 600, color: "#94a3b8", fontSize: 9.5 }}>
                      · {rows.filter(s => Object.values(s).some(v => String(v ?? "").trim())).length} spares
                    </span>
                  )}
                </div>
                <datalist id="bds-spare-names">
                  {spareMaster.map((m, idx) => <option key={idx} value={m.spare_name} />)}
                </datalist>
                {rows.map((sp, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "stretch",
                                        borderBottom: "1px solid #cbd5e1" }}>
                    {[["spare_name", "SPARE NAME"], ["spare_model_no", "MODEL NUMBER"],
                      ["spare_cnmm_no", "SPARE ERP NUMBER"], ["spare_qty", "QUANTITY"]].map(([k, l], ci) => (
                      <div key={k} style={{ ...cell, borderRight: ci === 3 && !spEdit ? "none" : cell.borderRight }}>
                        <div style={lbl}>{l}{rows.length > 1 && ci === 0 ? ` ${i + 1}` : ""}</div>
                        <input style={inp} value={sp[k] || ""} disabled={!spEdit}
                               type={k === "spare_qty" ? "number" : "text"}
                               list={k === "spare_name" ? "bds-spare-names" : undefined}
                               maxLength={k === "spare_cnmm_no" ? 8 : undefined}
                               placeholder={k === "spare_name" ? "Pick or type" : k === "spare_cnmm_no" ? "ABCD1234" : undefined}
                               onChange={(e) => k === "spare_name"
                                 ? onSpareName(i, e.target.value)
                                 : setSpare(i, k, k === "spare_cnmm_no" ? fmtErp(e.target.value) : e.target.value)} />
                      </div>
                    ))}
                    {spEdit && (
                      <button type="button" onClick={() => removeSpare(i)}
                              title={rows.length > 1 ? "Remove this spare" : "Clear this spare"}
                              style={{ width: 40, border: "none", borderLeft: "1px solid #cbd5e1",
                                       background: "#fff", color: "#dc2626", cursor: "pointer",
                                       fontSize: 15, fontWeight: 800 }}>🗑</button>
                    )}
                  </div>
                ))}
                {spEdit && (
                  <div style={{ padding: 6 }}>
                    <button type="button" onClick={addSpare}
                            style={{ padding: "6px 14px", borderRadius: 7, border: "1px dashed #94a3b8",
                                     background: "#f8fafc", color: "#0f172a", cursor: "pointer",
                                     fontSize: 12, fontWeight: 800, fontFamily: "inherit" }}>
                      ＋ Add another spare
                    </button>
                  </div>
                )}
              </div>
            );
          })()}
          <BdsRow label="B/D ATTENDED BY"
                  value={data.bd_attended_by}
                  readOnly={!fieldEditable("bd_attended_by")}
                  onChange={v => set("bd_attended_by", v)}/>

          {/* ── Signatures (4 columns) ─────────────────────────── */}
          <div className="bds-sign-head">
            <div>PREPARED BY :-</div>
            <div>RECEIVED BY :-</div>
            <div>HANDOVER TO :-<br/><span className="bds-sign-sub">LINE LEADER / OPERATOR</span></div>
            <div>HANDOVER TO :-<br/><span className="bds-sign-sub">QUALITY ENGINEER</span></div>
          </div>
          <div className="bds-sign-grid">
            {[
              { key: "prepared_by",          obj: data.prepared_by },
              { key: "received_by",          obj: data.received_by },
              { key: "line_leader_operator", obj: data.line_leader_operator },
              { key: "quality_engineer",     obj: data.quality_engineer },
            ].map(({ key, obj }) => (
              <div key={key} className="bds-sign-cell">
                {/* Only NAME — there's no clean way to capture a real
                    handwritten signature in a web form, so we drop the
                    SIGN row entirely.  Older slips that already saved
                    a `sign` field are unaffected (data preserved in
                    the JSONB blob, just no longer displayed). */}
                <div className="bds-sign-line">
                  <span>NAME :-</span>
                  <input type="text" disabled={!fieldEditable(key)}
                         value={obj?.name || ""}
                         onChange={e => setSub(key, "name", e.target.value)}/>
                </div>
              </div>
            ))}
          </div>
          </>}{/* /lower-half (hidden whenever phase==="production") */}

        </div>

        {/* Footer — Cancel + Submit */}
        <div className="bds-footer">
          <div className="bds-footer-meta">
            {ticket.line_name || `Line ${ticket.line_id}`}
            {ticket.zone_name && <> · {ticket.zone_name}</>}
            <> · {fmtDateTime(ticket.started_at)} → {fmtDateTime(ticket.ended_at)} · {fmtDuration(ticket.duration_seconds)}</>
          </div>
          <div style={{ display:"flex", gap: 10 }}>
            <Btn variant="ghost" onClick={onClose}>{readOnly ? "Close" : "Cancel"}</Btn>
            {/* Maintenance can request a Deviation when the fix needs more
                than 24h.  Available in maintenance fill / view modes; the
                Quality user takes it from there. */}
            {(isMaintenance || (readOnly && phase === "maintenance")) && ticket?.id && !pickLine && (
              <Btn variant="ghost" onClick={() => {
                // Lazy-load Deviation form so the closure modal stays small.
                import("../DeviationForm").then(m => {
                  const DevForm = m.default;
                  // Mount as transient overlay
                  const root = document.createElement("div");
                  document.body.appendChild(root);
                  import("react-dom/client").then(({ createRoot }) => {
                    const r = createRoot(root);
                    const seed = {
                      breakdown_id: ticket.id,
                      line_id:      ticket.line_id,
                      line_name:    ticket.line_name,
                      zone_id:      ticket.zone_id,
                      zone_name:    ticket.zone_name,
                      machine_no:   ticket.production_data?.machine_no || "",
                      machine_name: ticket.production_data?.machine_name || "",
                      reason:       data.problem_observed_by_maintenance || "",
                      observation:  data.action_taken_on_problem || "",
                    };
                    const close = () => { r.unmount(); root.remove(); };
                    r.render(
                      <DevForm
                        deviation={seed}
                        token={token}
                        mode="raise"
                        onClose={close}
                        onSaved={close}
                      />
                    );
                  });
                });
              }} title="Request a deviation when the fix needs >24h">
                ⚠ Request Deviation
              </Btn>
            )}
            {!readOnly && (
              <Btn variant="primary" onClick={submit}
                   disabled={saving || !phaseComplete()}
                   title={phaseComplete()
                     ? ""
                     : "Fill every field in your half before submitting"}>
                {saving
                   ? "Submitting…"
                   : isProduction  ? "Submit Production Half"
                   : isMaintenance ? "Submit Maintenance Half"
                                   : "Submit"}
              </Btn>
            )}
          </div>
        </div>
      </div>

      {/* ── Toyota Boshoku BREAK DOWN SLIP styles ────────────────── */}
      <style>{`
        .bds-letterhead {
          display:flex; align-items:stretch;
          background:#fff; border-bottom:2px solid #0f172a;
          position:relative;
        }
        .bds-logo {
          width:120px; padding:8px 10px; border-right:1.5px solid #0f172a;
          display:flex; flex-direction:column; align-items:center; gap:2px;
          background:#fff;
        }
        .bds-logo-tb {
          font-family:'Barlow Condensed',sans-serif;
          font-size:34px; font-weight:900; color:#dc2626;
          line-height:1;
        }
        .bds-logo-sub {
          font-size:8px; font-weight:700; color:#0f172a;
          letter-spacing:.05em; text-align:center; line-height:1.2;
        }
        .bds-letter-title { flex:1; padding:6px 12px; text-align:center;
                            display:flex; flex-direction:column; justify-content:center; }
        .bds-company { font-size:18px; font-weight:800; color:#0f172a;
                       letter-spacing:.04em; }
        .bds-doc-title { font-size:14px; font-weight:700; color:#0f172a;
                         letter-spacing:.06em; margin-top:2px; }
        .bds-close-x {
          width:46px; cursor:pointer; display:flex; align-items:center;
          justify-content:center; font-size:30px; color:#64748b;
          border-left:1.5px solid #0f172a;
          font-family:Arial; line-height:1;
        }
        .bds-close-x:hover { background:#fee2e2; color:#dc2626; }

        .bds-print-btn {
          padding:0 16px; cursor:pointer; display:flex; align-items:center;
          gap:8px; font-size:12px; font-weight:700; color:#1e40af;
          border-left:1.5px solid #0f172a; background:#f8fafc;
          letter-spacing:.04em; user-select:none;
          font-family:'Barlow',sans-serif;
        }
        .bds-print-btn:hover { background:rgba(30,64,175,.08); color:#1e3a8a; }

        /* Print is handled via a sandboxed iframe by printSlip() in
           ClosureFormModal.  The host page intentionally has no @media
           print rules, so a stray Ctrl+P from the user prints the
           visible page (not the slip), avoiding two-page bugs caused
           by the surrounding app's layout boxes. */

        .bds-body {
          padding:0; max-height:74vh; overflow-y:auto;
          background:#fff;
          font-family:'Barlow',sans-serif; color:#0f172a; font-size:11px;
        }

        /* Header / time grids — 3 columns of label+input pairs */
        .bds-grid {
          display:grid; border-top:1.5px solid #0f172a;
          border-left:1.5px solid #0f172a;
        }
        .bds-grid-3 { grid-template-columns: 1fr 1fr 1fr; }

        .bds-cell {
          display:flex; align-items:stretch;
          border-right:1.5px solid #0f172a; border-bottom:1.5px solid #0f172a;
          min-height:36px;
        }
        .bds-cell-label {
          background:#f1f5f9; padding:6px 8px;
          font-size:10px; font-weight:800; color:#0f172a;
          letter-spacing:.02em; min-width:140px;
          display:flex; align-items:center;
          border-right:1px solid #cbd5e1;
        }
        .bds-cell-input { flex:1; padding:0; }
        .bds-cell-input input {
          width:100%; height:100%; min-height:34px;
          border:none; outline:none; background:transparent;
          padding:6px 10px; font-size:12px; font-weight:600;
          color:#0f172a; font-family:inherit; box-sizing:border-box;
        }
        .bds-cell-input input:disabled { color:#0f172a; opacity:1; }

        /* Category section */
        .bds-cat-head {
          display:grid; grid-template-columns: 1fr 110px;
          background:#f1f5f9;
          border-left:1.5px solid #0f172a; border-right:1.5px solid #0f172a;
          padding:6px 10px; font-weight:800; font-size:11px; color:#0f172a;
          align-items:center;
        }
        .bds-cat-tickdown { text-align:center; font-size:9px;
                             border-left:1px solid #cbd5e1; padding-left:8px; }
        .bds-cat-row {
          display:grid; grid-template-columns: 160px 1fr 110px;
          border-left:1.5px solid #0f172a; border-right:1.5px solid #0f172a;
          border-top:1.5px solid #0f172a;
          min-height:30px;
        }
        .bds-cat-cell-code {
          padding:6px 10px; font-weight:800; font-size:11px;
          background:#f8fafc; border-right:1px solid #cbd5e1;
          display:flex; align-items:center;
        }
        .bds-cat-cell-desc {
          padding:6px 10px; font-size:11px; color:#0f172a;
          border-right:1px solid #cbd5e1; display:flex; align-items:center;
        }
        .bds-cat-cell-tick {
          display:flex; align-items:center; justify-content:center;
        }
        .bds-cat-cell-tick input { width:18px; height:18px; cursor:pointer; }

        /* Full-width row (textarea) */
        .bds-row {
          display:grid; grid-template-columns: 220px 1fr;
          border-left:1.5px solid #0f172a; border-right:1.5px solid #0f172a;
          border-top:1.5px solid #0f172a;
          min-height:60px;
        }
        .bds-row-label {
          padding:6px 10px; background:#f1f5f9; font-weight:800;
          font-size:10px; color:#0f172a; letter-spacing:.02em;
          border-right:1px solid #cbd5e1;
          display:flex; align-items:center;
        }
        .bds-row-input { padding:0; }
        .bds-row-input textarea {
          width:100%; height:100%; min-height:60px;
          border:none; outline:none; background:transparent;
          padding:6px 10px; font-size:12px; font-weight:500;
          color:#0f172a; font-family:inherit; resize:vertical;
          box-sizing:border-box;
        }

        /* Maintenance/Tool Room divider */
        .bds-divider {
          padding:6px 10px; background:#fee2e2; color:#991b1b;
          font-weight:800; font-size:11px; letter-spacing:.04em;
          border-left:1.5px solid #0f172a; border-right:1.5px solid #0f172a;
          border-top:1.5px solid #0f172a;
        }
        .bds-relto-row {
          display:flex; align-items:center; gap:24px;
          padding:8px 10px;
          border-left:1.5px solid #0f172a; border-right:1.5px solid #0f172a;
          border-top:1.5px solid #0f172a;
          font-size:11px; font-weight:700;
        }
        .bds-relto-label { color:#0f172a; }
        .bds-relto-opt {
          display:flex; align-items:center; gap:6px;
          cursor:pointer; user-select:none;
        }
        .bds-relto-opt input { width:16px; height:16px; cursor:pointer; }

        /* Signatures */
        .bds-sign-head {
          display:grid; grid-template-columns: 1fr 1fr 1fr 1fr;
          background:#f1f5f9; padding:6px 10px;
          border-left:1.5px solid #0f172a; border-right:1.5px solid #0f172a;
          border-top:1.5px solid #0f172a;
          font-size:11px; font-weight:800;
        }
        .bds-sign-head > div { padding:0 6px; }
        .bds-sign-head .bds-sign-sub { font-size:9px; color:#475569; font-weight:700; }
        .bds-sign-grid {
          display:grid; grid-template-columns: 1fr 1fr 1fr 1fr;
          border-left:1.5px solid #0f172a; border-right:1.5px solid #0f172a;
          border-top:1.5px solid #0f172a; border-bottom:1.5px solid #0f172a;
        }
        .bds-sign-cell {
          padding:6px 8px;
          border-right:1px solid #cbd5e1;
        }
        .bds-sign-cell:last-child { border-right:none; }
        .bds-sign-line {
          display:flex; align-items:center; gap:6px; padding:3px 0;
          font-size:10px; font-weight:700; color:#0f172a;
        }
        .bds-sign-line span { min-width:42px; }
        .bds-sign-line input {
          flex:1; border:none; border-bottom:1px solid #94a3b8;
          padding:2px 4px; font-size:11px; font-weight:600; outline:none;
          background:transparent; font-family:inherit; color:#0f172a;
        }
        .bds-sign-line input:disabled { opacity:1; color:#0f172a; }

        .bds-format {
          padding:8px 10px; text-align:center; font-size:10px;
          color:#475569; font-weight:600;
          background:#fff;
        }

        .bds-footer {
          display:flex; align-items:center; justify-content:space-between;
          gap:14px; padding:12px 18px;
          background:#f8fafc; border-top:1px solid #e2e8f0;
          flex-wrap:wrap;
        }
        .bds-footer-meta {
          font-size:11px; color:#64748b; font-weight:600;
        }
      `}</style>
    </div>
  );
}

/* ── Single label+input cell (for the 3×3 header & time grids) ──── */
function BdsCell({ label, value, type = "text", readOnly, onChange, options, min }) {
  return (
    <div className="bds-cell">
      <div className="bds-cell-label">{label} :-</div>
      <div className="bds-cell-input">
        {options ? (
          <select value={value || ""} disabled={readOnly}
                  onChange={(e) => onChange?.(e.target.value)}
                  style={{ width: "100%", border: "none", background: "transparent",
                           font: "inherit", color: "inherit", outline: "none",
                           cursor: readOnly ? "default" : "pointer" }}>
            <option value="">— select —</option>
            {options.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : (
          <input type={type}
                 value={value || ""}
                 disabled={readOnly}
                 min={min}
                 onChange={(e) => onChange?.(e.target.value)}/>
        )}
      </div>
    </div>
  );
}

/* ── Full-width labelled textarea (for free-text rows) ──────────── */
function BdsRow({ label, value, readOnly, onChange }) {
  return (
    <div className="bds-row">
      <div className="bds-row-label">{label}</div>
      <div className="bds-row-input">
        <textarea value={value || ""}
                  disabled={readOnly}
                  rows={2}
                  onChange={(e) => onChange?.(e.target.value)}/>
      </div>
    </div>
  );
}

