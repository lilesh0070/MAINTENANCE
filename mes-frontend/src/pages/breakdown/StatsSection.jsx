import { useMemo } from "react";

/* ════════════════════════════════════════════════════════════════════
 * 3) Stats — per-zone summary + drill-down by line
 * ════════════════════════════════════════════════════════════════════ */
function StatsSection({ stats }) {
  const zones = stats?.zones || [];
  const lines = stats?.lines || [];

  // Group lines by their zone for the drill-down rendering.
  const linesByZone = useMemo(() => {
    const m = {};
    for (const l of lines) {
      const k = l.zone_id ?? 0;
      (m[k] = m[k] || []).push(l);
    }
    return m;
  }, [lines]);

  if (zones.length === 0 && lines.length === 0) {
    return (
      <div style={{ background: "#fff", border: "1px solid #e2e8f0",
                     borderRadius: 14, padding: "32px 24px",
                     textAlign: "center", color: "#94a3b8", fontStyle: "italic" }}>
        No breakdown stats yet — once tickets accumulate over a few days,
        zone-level LTTR and per-line MTTR / MTBF will appear here.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {zones.map((z) => {
        const zoneLines = linesByZone[z.zone_id] || [];
        return (
          <div key={z.zone_id ?? "unzoned"} style={{
            background: "#fff", border: "1px solid #e2e8f0",
            borderRadius: 14, overflow: "hidden",
            boxShadow: "0 1px 3px rgba(0,0,0,.04)",
          }}>
            <div style={{
              padding: "14px 20px",
              background: "linear-gradient(135deg,#1e3a8a,#1e40af)",
              color: "#fff",
              display: "flex", alignItems: "center", justifyContent: "space-between",
              flexWrap: "wrap", gap: 12,
            }}>
              <div style={{ fontFamily: "'Barlow Condensed',sans-serif",
                             fontSize: 22, fontWeight: 800, letterSpacing: ".02em" }}>
                {z.zone_name || "(unzoned)"}
              </div>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                <div title="Longest repair time seen on any closed breakdown in this zone over the window">
                  <div style={{ fontSize: 9, fontWeight: 700, opacity: 0.8,
                                  letterSpacing: ".1em", textTransform: "uppercase" }}>
                    LTTR (longest)
                  </div>
                  <div style={{ fontFamily: "'Barlow Condensed',sans-serif",
                                  fontSize: 22, fontWeight: 800 }}>
                    {z.lttr_minutes != null ? `${z.lttr_minutes} min` : "—"}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, opacity: 0.8,
                                  letterSpacing: ".1em", textTransform: "uppercase" }}>
                    Breakdowns
                  </div>
                  <div style={{ fontFamily: "'Barlow Condensed',sans-serif",
                                  fontSize: 22, fontWeight: 800 }}>
                    {z.breakdowns_count}
                  </div>
                </div>
              </div>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#fafbfc" }}>
                    {["Line", "MTBF", "MTTR", "Breakdowns"].map((h) => (
                      <th key={h} style={{ padding: "8px 14px", textAlign: "left",
                                              fontSize: 9, fontWeight: 800,
                                              letterSpacing: ".08em",
                                              textTransform: "uppercase",
                                              color: "#64748b",
                                              borderBottom: "1px solid #e2e8f0" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {zoneLines.length === 0 ? (
                    <tr><td colSpan={4} style={{ padding: 16, textAlign: "center",
                                                    color: "#cbd5e1", fontStyle: "italic" }}>
                      No line-level breakdowns recorded yet.
                    </td></tr>
                  ) : zoneLines.map((l) => (
                    <tr key={l.line_id} style={{ borderBottom: "1px solid #f8fafc" }}>
                      <td style={{ padding: "8px 14px", fontWeight: 700, color: "#0f172a" }}>
                        {l.line_name || `Line ${l.line_id}`}
                      </td>
                      <td style={{ padding: "8px 14px",
                                      fontFamily: "'Barlow Condensed',sans-serif",
                                      fontSize: 16, fontWeight: 800, color: "#dc2626" }}>
                        {l.mtbf_hours != null ? `${l.mtbf_hours} h` : "—"}
                      </td>
                      <td style={{ padding: "8px 14px",
                                      fontFamily: "'Barlow Condensed',sans-serif",
                                      fontSize: 16, fontWeight: 800, color: "#d97706" }}>
                        {l.mttr_minutes != null ? `${l.mttr_minutes} min` : "—"}
                      </td>
                      <td style={{ padding: "8px 14px", color: "#475569",
                                      fontFamily: "monospace", fontSize: 11, fontWeight: 700 }}>
                        {l.breakdowns_count}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      {/* Lines without a recorded zone fall through here */}
      {(linesByZone[0] || linesByZone[null] || []).length > 0 && zones.length === 0 && (
        <div style={{ fontSize: 11, color: "#94a3b8", fontStyle: "italic" }}>
          (Lines below have no zone assigned — assign zones in Admin Panel → Lines.)
        </div>
      )}
    </div>
  );
}


export default StatsSection;
