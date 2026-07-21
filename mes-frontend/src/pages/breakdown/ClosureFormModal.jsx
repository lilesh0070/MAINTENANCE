import { useState, useEffect, useMemo } from "react";
import { Btn, api, fmtDuration, fmtDateTime } from "./shared";

/* ════════════════════════════════════════════════════════════════════
 * Closure form modal — Toyota Boshoku BREAK DOWN SLIP
 * (TBDI/MAINT/F/001 · REV. 00 · 20/03/2024)
 * ════════════════════════════════════════════════════════════════════
 * Layout matches the paper form one-to-one.  Fields auto-populated from
 * the breakdown record (date / shift / line / start time / end time /
 * down time minutes) are pre-filled but stay editable in case the
 * filer wants to override.  Everything else is typed by the user.
 *
 * Submitted payload shape (stored as mes_breakdowns.closure_data JSONB):
 *   {
 *     zone, line, machine_no, machine_name, date,
 *     shift, line_leader_name, model_no, machine_operator_name,
 *     category, // 'A' | 'B' | 'C'
 *     bd_start_time, bd_received_time, bd_ok_time,
 *     bd_start_date, bd_end_date, mc_down_time_minutes,
 *     problem_reported_by_production,
 *     problem_related_to, // { maintenance: bool, tool_room: bool }
 *     actual_problem_observed,
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
export function ClosureFormModal({ ticket, mode, phase = "maintenance", onClose, onSave, token }) {
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
  ]);
  const MAINT_FIELDS = new Set([
    // Machine No. is selectable (dropdown) + saved in the maintenance half
    // too, so a maintenance-driven close still captures the machine.
    "machine_no", "machine_name",
    "problem_related_to", "type_of_problem",
    "actual_problem_observed", "action_taken_on_problem",
    "spares_used", "bd_attended_by",
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
      bd_received_time:      prod.bd_received_time   ?? legacy.bd_received_time   ?? "",
      problem_reported_by_production:
        prod.problem_reported_by_production ?? legacy.problem_reported_by_production ?? "",

      // Times/dates/down-time — default from the collector, but editable &
      // saved (read the saved value first if the slip was already filled).
      bd_start_time:        prod.bd_start_time        ?? legacy.bd_start_time        ?? fmtTime(start),
      bd_ok_time:           prod.bd_ok_time           ?? legacy.bd_ok_time           ?? fmtTime(end),
      bd_start_date:        prod.bd_start_date        ?? legacy.bd_start_date        ?? fmtDate(start),
      bd_end_date:          prod.bd_end_date          ?? legacy.bd_end_date          ?? fmtDate(end),
      mc_down_time_minutes: prod.mc_down_time_minutes ?? legacy.mc_down_time_minutes ?? (downMin != null ? String(downMin) : ""),

      // Maintenance half (or carried-over)
      problem_related_to:      maint.problem_related_to      ?? legacy.problem_related_to      ?? { maintenance: true, tool_room: false },
      // 2026-05-20 — Multi-select (electrical and/or mechanical can both
      // be ticked, unlike problem_related_to which is single-pick).
      type_of_problem:         maint.type_of_problem         ?? legacy.type_of_problem         ?? { electrical: false, mechanical: false },
      actual_problem_observed: maint.actual_problem_observed ?? legacy.actual_problem_observed ?? "",
      action_taken_on_problem: maint.action_taken_on_problem ?? legacy.action_taken_on_problem ?? "",
      spares_used:             maint.spares_used             ?? legacy.spares_used             ?? "",
      bd_attended_by:          maint.bd_attended_by          ?? legacy.bd_attended_by          ?? "",
      prepared_by:             maint.prepared_by             ?? legacy.prepared_by             ?? { name: "" },
      received_by:             maint.received_by             ?? legacy.received_by             ?? { name: "" },
      line_leader_operator:    maint.line_leader_operator    ?? legacy.line_leader_operator    ?? { name: "" },
      quality_engineer:        maint.quality_engineer        ?? legacy.quality_engineer        ?? { name: "" },
    });
  }, [ticket?.id, readOnly, phase]);

  // ── Pull the machine master list for this line (one fetch on open) ──
  // The Machine Master (mes_machines) is the SINGLE source for Zone / Line /
  // Machine — /api/machines/by-line/{line_id} resolves this line to its
  // master (zone_name, line_name) + machine rows.  We auto-fill Zone + Line
  // from the master here (overriding whatever the ticket/production blob had),
  // exactly like Machine No./Name auto-fill from the Serial No.  So the slip
  // always shows the mes_machines names, decided automatically.
  useEffect(() => {
    if (!ticket?.line_id || !token) return;
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
  }, [ticket?.line_id, token]);

  if (!ticket) return null;

  const set    = (k, v) => setData(d => ({ ...d, [k]: v }));
  const setSub = (parent, k, v) =>
    setData(d => ({ ...d, [parent]: { ...(d[parent] || {}), [k]: v } }));

  // Machine No. is a dropdown of this (zone, line)'s machines (from
  // /api/machines/by-line → mes_machines).  Picking a Machine No. auto-fills
  // the Machine Name.  No Serial No. needed.
  const onPickMachine = (mno) => {
    setData(d => {
      const hit = machines.find(m => String(m.machine_no) === String(mno));
      return { ...d, machine_no: mno, machine_name: hit ? hit.machine_name : "" };
    });
  };

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
    const slice = subsetForPhase();
    const checkVal = (v) => {
      if (v == null) return false;
      if (typeof v === "string") return v.trim().length > 0;
      if (typeof v === "object") {
        // For radio (problem_related_to) — require one true.
        // For multi-select (type_of_problem) — require at least one true.
        // For sigs (prepared_by etc) — require a name (sign optional).
        if ("maintenance" in v && "tool_room" in v) return v.maintenance || v.tool_room;
        if ("electrical" in v && "mechanical" in v) return v.electrical || v.mechanical;
        if ("name" in v) return !!(v.name && String(v.name).trim());
        return Object.keys(v).length > 0;
      }
      return true;
    };
    return Object.values(slice).every(checkVal);
  };

  const submit = async () => {
    setSaving(true);
    try {
      // In the maintenance fill the whole slip is editable, so also send the
      // Production-half fields the user filled (saved into production_data).
      const prodExtra = isMaintenance
        ? Object.fromEntries(Object.entries(data).filter(([k]) => PROD_FIELDS.has(k)))
        : null;
      await onSave(subsetForPhase(), phase, prodExtra);
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
                     onChange={v => set("zone", v)}/>
            <BdsCell label="MACHINE NO."
                     value={data.machine_no}          readOnly={!fieldEditable("machine_no")}
                     options={machines.map(m => m.machine_no).filter(Boolean)}
                     onChange={onPickMachine}/>
            <BdsCell label="DATE" type="date"
                     value={data.date}             readOnly={!fieldEditable("date")}
                     onChange={v => set("date", v)}/>

            <BdsCell label="LINE"
                     value={data.line}             readOnly={!fieldEditable("line")}
                     onChange={v => set("line", v)}/>
            <BdsCell label="SHIFT"
                     value={data.shift}            readOnly={!fieldEditable("shift")}
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

          {/* ── Time + date + downtime row ─────────────────────── */}
          <div className="bds-grid bds-grid-3">
            <BdsCell label="B/D START TIME" type="time"
                     value={data.bd_start_time}    readOnly={!fieldEditable("bd_start_time")}
                     onChange={v => set("bd_start_time", v)}/>
            <BdsCell label="B/D RECEIVED TIME" type="time"
                     value={data.bd_received_time} readOnly={!fieldEditable("bd_received_time")}
                     onChange={v => set("bd_received_time", v)}/>
            <BdsCell label="B/D OK TIME" type="time"
                     value={data.bd_ok_time}       readOnly={!fieldEditable("bd_ok_time")}
                     onChange={v => set("bd_ok_time", v)}/>

            <BdsCell label="B/D START DATE" type="date"
                     value={data.bd_start_date}    readOnly={!fieldEditable("bd_start_date")}
                     onChange={v => set("bd_start_date", v)}/>
            <BdsCell label="B/D END DATE" type="date"
                     value={data.bd_end_date}      readOnly={!fieldEditable("bd_end_date")}
                     onChange={v => set("bd_end_date", v)}/>
            <BdsCell label="M/C DOWN TIME IN MINUTES" type="number"
                     value={data.mc_down_time_minutes} readOnly={!fieldEditable("mc_down_time_minutes")}
                     onChange={v => set("mc_down_time_minutes", v)}/>
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
                  value={data.actual_problem_observed}
                  readOnly={!fieldEditable("actual_problem_observed")}
                  onChange={v => set("actual_problem_observed", v)}/>
          <BdsRow label="ACTION TAKEN ON PROBLEM"
                  value={data.action_taken_on_problem}
                  readOnly={!fieldEditable("action_taken_on_problem")}
                  onChange={v => set("action_taken_on_problem", v)}/>
          <BdsRow label="SPARES USED ( IF ANY )"
                  value={data.spares_used}
                  readOnly={!fieldEditable("spares_used")}
                  onChange={v => set("spares_used", v)}/>
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
            {(isMaintenance || (readOnly && phase === "maintenance")) && ticket?.id && (
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
                      reason:       data.actual_problem_observed || "",
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
function BdsCell({ label, value, type = "text", readOnly, onChange, options }) {
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

