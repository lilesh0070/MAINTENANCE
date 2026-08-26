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
import { slipPayload } from "./slipPayload";

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
    const payload = slipPayload(all);
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
