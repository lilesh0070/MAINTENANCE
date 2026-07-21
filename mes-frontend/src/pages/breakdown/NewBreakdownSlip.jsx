/* ───────────────────────────────────────────────────────────────────
 * NewBreakdownSlip.jsx — open a BLANK Break Down Slip and fill it from
 * scratch (Breakdown page → "Breakdown Slip" button).
 * ───────────────────────────────────────────────────────────────────
 * Normal slips are filled against a breakdown the collector opened
 * automatically.  This lets a user raise one MANUALLY:
 *   1. pick the Line (gives the numeric line_id the slip needs — the
 *      Machine No. dropdown inside the slip resolves from it)
 *   2. the full Break Down Slip opens blank (maintenance phase = whole
 *      slip editable); the user types the B/D times themselves
 *   3. on Save it becomes a REAL breakdown record:
 *        POST /api/breakdowns            → create (state OPEN)
 *        POST /api/breakdowns/{id}/resolve  → stamp end time (if given)
 *        POST /api/breakdowns/{id}/close    → save both halves, CLOSED
 *      so it lands in BD History with every other breakdown.
 *
 * No new route / no new table — it reuses the existing ClosureFormModal
 * and the breakdowns endpoints.
 * ─────────────────────────────────────────────────────────────────── */
import { useEffect, useMemo, useState } from "react";
import { api } from "./shared";
import { ClosureFormModal } from "./ClosureFormModal";

// "YYYY-MM-DD" + "HH:MM" → ISO string, or null if either is missing/bad.
function toISO(dateStr, timeStr) {
  if (!dateStr) return null;
  const t = (timeStr && /^\d{1,2}:\d{2}$/.test(timeStr)) ? timeStr : "00:00";
  const d = new Date(`${dateStr}T${t}:00`);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

export function NewBreakdownSlip({ token, onClose, onSaved }) {
  const [lines, setLines] = useState([]);
  const [zone, setZone]   = useState("");
  const [lineId, setLineId] = useState("");
  const [ticket, setTicket] = useState(null);   // synthetic (id:null) → the slip
  const [err, setErr] = useState("");

  useEffect(() => {
    api.get("/api/lines/", token)
      .then((rows) => setLines(Array.isArray(rows) ? rows : []))
      .catch(() => setLines([]));
  }, [token]);

  const zones = useMemo(
    () => [...new Set(lines.map((l) => l.zone_name).filter(Boolean))].sort(), [lines]);
  const zoneLines = useMemo(
    () => (zone ? lines.filter((l) => l.zone_name === zone)
                       .sort((a, b) => String(a.line_name).localeCompare(String(b.line_name))) : []),
    [lines, zone]);

  // open the blank slip for the chosen line
  const openSlip = () => {
    const l = lines.find((x) => String(x.id) === String(lineId));
    if (!l) { setErr("Pehle line chuno."); return; }
    setErr("");
    setTicket({
      id: null,                               // blank — no DB row yet
      line_id: l.id,
      line_name: l.line_name,
      zone_name: l.zone_name,
      started_at: new Date().toISOString(),   // time defaults; user edits them
      ended_at: null,
      production_data: {},
      maintenance_data: {},
    });
  };

  // Save = create the breakdown, stamp its end, then close it with both halves.
  const onSave = async (maintSlice, _phase, prodExtra) => {
    const p = prodExtra || {};
    const startedISO = toISO(p.bd_start_date, p.bd_start_time) || new Date().toISOString();
    const endedISO   = toISO(p.bd_end_date, p.bd_ok_time);
    // 1) create (OPEN)
    const created = await api.post("/api/breakdowns/",
      { line_id: ticket.line_id, started_at: startedISO }, token);
    const id = created?.id;
    if (!id) throw new Error("Breakdown create failed");
    // 2) stamp the end time so the history duration is right (best-effort)
    if (endedISO) {
      try { await api.post(`/api/breakdowns/${id}/resolve`, { ended_at: endedISO }, token); }
      catch { /* close still stamps ended_at = now as a fallback */ }
    }
    // 3) close with both halves → CLOSED, lands in BD History
    await api.post(`/api/breakdowns/${id}/close`,
      { maintenance_data: maintSlice, production_data: prodExtra || undefined }, token);
    setTicket(null);
    onSaved && onSaved();
    onClose && onClose();
  };

  // once a line is chosen, the real slip takes over
  if (ticket) {
    return (
      <ClosureFormModal
        ticket={ticket} mode="fill" phase="maintenance" token={token}
        onSave={onSave} onClose={() => setTicket(null)} />
    );
  }

  // ── line-pick step ──
  const sel = { padding: "10px 12px", borderRadius: 9, border: "1.5px solid #cbd5e1",
                fontSize: 14, fontWeight: 600, minWidth: 240, background: "#fff", fontFamily: "inherit" };
  return (
    <div onClick={onClose}
         style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 800,
                  display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()}
           style={{ background: "#fff", borderRadius: 14, padding: 24, width: 460, maxWidth: "100%",
                    boxShadow: "0 20px 50px rgba(0,0,0,.3)" }}>
        <div style={{ fontSize: 18, fontWeight: 900, color: "#0f172a", marginBottom: 4 }}>
          🧾 New Break Down Slip
        </div>
        <div style={{ fontSize: 12.5, color: "#64748b", marginBottom: 18 }}>
          Line chuno — phir poori slip blank khulegi, jise suru se bhar sakte ho.
          Save karte hi ye ek breakdown record ban ke BD History me aa jayegi.
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <label style={{ fontSize: 12, fontWeight: 800, color: "#475569" }}>
            Zone
            <div><select style={{ ...sel, marginTop: 5, width: "100%" }} value={zone}
                         onChange={(e) => { setZone(e.target.value); setLineId(""); }}>
              <option value="">— zone —</option>
              {zones.map((z) => <option key={z} value={z}>{z}</option>)}
            </select></div>
          </label>
          <label style={{ fontSize: 12, fontWeight: 800, color: "#475569" }}>
            Line
            <div><select style={{ ...sel, marginTop: 5, width: "100%" }} value={lineId} disabled={!zone}
                         onChange={(e) => setLineId(e.target.value)}>
              <option value="">— line —</option>
              {zoneLines.map((l) => <option key={l.id} value={l.id}>{l.line_name}</option>)}
            </select></div>
          </label>
        </div>

        {err && <div style={{ marginTop: 12, color: "#dc2626", fontSize: 12.5, fontWeight: 700 }}>{err}</div>}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 22 }}>
          <button onClick={onClose}
                  style={{ padding: "10px 18px", borderRadius: 9, border: "1px solid #cbd5e1",
                           background: "#fff", color: "#64748b", fontWeight: 800, fontSize: 13, cursor: "pointer" }}>
            Cancel
          </button>
          <button onClick={openSlip} disabled={!lineId}
                  style={{ padding: "10px 22px", borderRadius: 9, border: "none",
                           background: lineId ? "#dc2626" : "#94a3b8", color: "#fff",
                           fontWeight: 800, fontSize: 13, cursor: lineId ? "pointer" : "not-allowed" }}>
            Open Slip →
          </button>
        </div>
      </div>
    </div>
  );
}
