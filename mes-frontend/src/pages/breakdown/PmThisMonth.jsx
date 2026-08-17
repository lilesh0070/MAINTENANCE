import { useState, useEffect } from "react";
import { api } from "./shared";

/* ════════════════════════════════════════════════════════════════════
 * 1.5) PM This Month — which line's Preventive Maintenance is due this
 *      month + on which date (from the Yearly PM Schedule).  Sits beside
 *      the ANDON.  Source: GET /api/pm/yearly-plan-month?month=YYYY-MM
 *      (weeks 1-4 → day ranges 1-7 / 8-14 / 15-21 / 22-end).
 * ════════════════════════════════════════════════════════════════════ */
function PmThisMonth({ token }) {
  const [data, setData] = useState(null);
  const [err,  setErr]  = useState(false);
  const now       = new Date();
  const ym        = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const monAbbr   = now.toLocaleString("en-GB", { month: "short" });
  const monthLbl  = now.toLocaleString("en-GB", { month: "short", year: "numeric" });
  const lastDay   = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

  useEffect(() => {
    if (!token) return;
    let alive = true;
    api.get(`/api/pm/yearly-plan-month?month=${ym}`, token)
      .then((d) => { if (alive) setData(d); })
      .catch(() => { if (alive) setErr(true); });
    return () => { alive = false; };
  }, [token, ym]);

  // Week 1 = 1-7, 2 = 8-14, 3 = 15-21, 4 = 22-end → a readable date range.
  const weekRange = (wno) => {
    const s = (wno - 1) * 7 + 1;
    const e = wno === 4 ? lastDay : wno * 7;
    return `${String(s).padStart(2, "0")}–${String(e).padStart(2, "0")} ${monAbbr}`;
  };

  const rows = [];
  if (data?.weeks) {
    ["1", "2", "3", "4"].forEach((wno) =>
      (data.weeks[wno] || []).forEach((m) => rows.push({ ...m, wno: Number(wno) })));
    rows.sort((a, b) => a.wno - b.wno
      || String(a.zone_name || "").localeCompare(String(b.zone_name || ""))
      || String(a.line || "").localeCompare(String(b.line || "")));
  }

  return (
    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14,
                  overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,.04)" }}>
      <div style={{ padding: "14px 18px", borderBottom: "1px solid #e2e8f0", background: "#f8fafc" }}>
        <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 18, fontWeight: 800, color: "#0f172a" }}>
          🛠 PM This Month
        </div>
        <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
          {monthLbl} · {rows.length} planned
        </div>
      </div>
      <div>
        {err ? (
          <div style={{ padding: 20, color: "#dc2626", fontSize: 12.5 }}>Could not load PM schedule.</div>
        ) : !data ? (
          <div style={{ padding: 20, color: "#94a3b8", fontSize: 12.5 }}>Loading…</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: "#94a3b8", fontSize: 12.5, fontStyle: "italic" }}>
            No PM planned for {monthLbl}.
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
            <thead>
              <tr>{["Zone", "Line", "Machine No.", "Date", "Status"].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: "9px 10px", fontSize: 9, fontWeight: 800,
                                     letterSpacing: ".05em", textTransform: "uppercase", color: "#64748b",
                                     borderBottom: "2px solid #e2e8f0", position: "sticky", top: 0,
                                     background: "#f1f5f9", whiteSpace: "nowrap", zIndex: 1 }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {rows.map((m, i) => (
                <tr key={i} style={{ borderBottom: "1px solid #f1f5f9",
                                     background: i % 2 ? "#fafbfc" : "#fff" }}>
                  <td style={{ padding: "8px 10px", fontWeight: 700, color: "#1e40af", whiteSpace: "nowrap" }}>
                    {m.zone_name || "—"}
                  </td>
                  <td style={{ padding: "8px 10px", color: "#0f172a", fontWeight: 600, whiteSpace: "nowrap" }}>
                    {m.line || "—"}
                  </td>
                  <td style={{ padding: "8px 10px", color: "#334155", fontFamily: "monospace", fontWeight: 600,
                               maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                      title={m.machine_name || ""}>
                    {m.machine_code || "—"}
                  </td>
                  <td style={{ padding: "8px 10px", fontFamily: "monospace", color: "#475569", whiteSpace: "nowrap" }}>
                    {weekRange(m.wno)}
                  </td>
                  <td style={{ padding: "8px 10px" }}>
                    <span style={{ display: "inline-block", padding: "2px 9px", borderRadius: 99,
                                   fontSize: 9.5, fontWeight: 800, letterSpacing: ".03em",
                                   background: m.done ? "#dcfce7" : "#fef3c7",
                                   color: m.done ? "#15803d" : "#b45309",
                                   border: `1px solid ${m.done ? "#86efac" : "#fcd34d"}` }}>
                      {m.done ? "✓ DONE" : "DUE"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}


export default PmThisMonth;
