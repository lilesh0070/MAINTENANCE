/* ───────────────────────────────────────────────────────────────────
 * NewBreakdownSlip.jsx — open a BLANK Break Down Slip and fill it from
 * scratch (sidebar → "Breakdown Slip", or Breakdown page → same button).
 * ───────────────────────────────────────────────────────────────────
 * The full slip opens BLANK straight away.  ZONE / LINE / MACHINE NO. /
 * MACHINE NAME are picked INSIDE the slip from the Machine Master
 * (pickLine mode of ClosureFormModal).
 *
 * On Save the whole slip is stored as a STANDALONE row in
 * `maintenance_breakdown_data` (POST /api/breakdown-slips/).  This is fully
 * decoupled — it does not touch
 * the collector / ANDON / BD History, and keeps no link back to them.
 * ─────────────────────────────────────────────────────────────────── */
import { useState } from "react";
import { api } from "./shared";
import { ClosureFormModal } from "./ClosureFormModal";

export function NewBreakdownSlip({ token, onClose, onSaved }) {
  // A blank ticket (no DB row).  line_id stays null — the standalone slip
  // table needs no MES line_id, so every master machine can be filled.
  const [ticket] = useState(() => ({
    id: null,
    line_id: null,
    line_name: "",
    zone_name: "",
    started_at: new Date().toISOString(),   // date/time defaults; user edits them
    ended_at: null,
    production_data: {},
    maintenance_data: {},
  }));

  // Save = flatten both halves into one row and POST to the standalone table.
  const onSave = async (maintSlice, _phase, prodExtra) => {
    const all = { ...(prodExtra || {}), ...(maintSlice || {}) };
    const payload = {
      // Upper half (Production)
      zone:                  all.zone || null,
      line:                  all.line || null,
      machine_no:            all.machine_no || null,
      machine_name:          all.machine_name || null,
      slip_date:             all.date || null,
      shift:                 all.shift || null,
      line_leader_name:      all.line_leader_name || null,
      model_no:              all.model_no || null,
      machine_operator_name: all.machine_operator_name || null,
      category:              all.category || null,
      bd_start_time:         all.bd_start_time || null,
      bd_received_time:      all.bd_received_time || null,
      bd_ok_time:            all.bd_ok_time || null,
      bd_start_date:         all.bd_start_date || null,
      bd_end_date:           all.bd_end_date || null,
      mc_down_time_minutes:  all.mc_down_time_minutes ? Number(all.mc_down_time_minutes) : null,
      response_time_minutes: all.response_time_minutes ? Number(all.response_time_minutes) : null,
      frequency:             all.frequency ? Number(all.frequency) : 1,
      problem_reported_by_production: all.problem_reported_by_production || null,
      // Lower half (Maintenance / Tool Room)
      problem_related_to:    all.problem_related_to?.maintenance ? "maintenance"
                           : all.problem_related_to?.tool_room   ? "tool_room" : null,
      type_electrical:       !!all.type_of_problem?.electrical,
      type_mechanical:       !!all.type_of_problem?.mechanical,
      problem_observed_by_maintenance:   all.problem_observed_by_maintenance || null,
      action_taken_on_problem:   all.action_taken_on_problem || null,
      spares_used:               all.spares_used || null,
      // repeatable Spare Details (drop completely-blank rows) — stored as JSONB
      spares: (all.spares || []).filter(s => Object.values(s).some(v => String(v ?? "").trim())),
      bd_attended_by:            all.bd_attended_by || null,
      prepared_by_name:          all.prepared_by?.name || null,
      received_by_name:          all.received_by?.name || null,
      line_leader_operator_name: all.line_leader_operator?.name || null,
      quality_engineer_name:     all.quality_engineer?.name || null,
    };
    await api.post("/api/breakdown-slips/", payload, token);
    onSaved && onSaved();
    onClose && onClose();
  };

  // The full slip opens blank right away — Zone/Line/Machine picked inside.
  return (
    <ClosureFormModal
      ticket={ticket} mode="fill" phase="maintenance" pickLine token={token}
      onSave={onSave} onClose={onClose} />
  );
}
