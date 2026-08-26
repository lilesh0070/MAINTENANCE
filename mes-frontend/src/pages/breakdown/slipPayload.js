/* ───────────────────────────────────────────────────────────────────
 * slipPayload.js — ClosureFormModal ke form-fields se
 * maintenance_breakdown_data ki flat row banata hai.
 *
 * Ye alag file isliye hai ki DO jagah bilkul ek jaisi row chahiye:
 *   • NewBreakdownSlip  → POST /api/breakdown-slips/      (nayi slip)
 *   • MaintenanceHistorical → PUT /api/breakdown-slips/:id (admin edit)
 * Pehle ye mapping sirf NewBreakdownSlip ke andar thi.  Copy karke doosri
 * jagah rakhne par dono aage chal kar alag ho jaati (ek me naya khaana
 * jud jaata, doosri me nahi) aur edit chupchaap kuch fields gira deta.
 *
 * Form ke naam aur DB ke column kai jagah alag hain — `date`→`slip_date`,
 * `prepared_by.name`→`prepared_by_name`, checkbox object→bool, waghairah.
 * Wahi tarjuma yahan ek hi jagah likha hai.
 * ─────────────────────────────────────────────────────────────────── */

/** @param all  prodExtra + maintSlice ka mila hua object (ClosureFormModal se) */
export function slipPayload(all) {
  return {
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
    problem_observed_by_maintenance: all.problem_observed_by_maintenance || null,
    action_taken_on_problem:         all.action_taken_on_problem || null,
    spares_used:                     all.spares_used || null,
    // repeatable Spare Details (bilkul khali rows hata do) — JSONB me jaata hai
    spares: (all.spares || []).filter(s => Object.values(s).some(v => String(v ?? "").trim())),
    bd_attended_by:            all.bd_attended_by || null,
    prepared_by_name:          all.prepared_by?.name || null,
    received_by_name:          all.received_by?.name || null,
    line_leader_operator_name: all.line_leader_operator?.name || null,
    quality_engineer_name:     all.quality_engineer?.name || null,
  };
}
