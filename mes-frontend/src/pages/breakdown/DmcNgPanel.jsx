/* ───────────────────────────────────────────────────────────────────
 * DmcNgPanel.jsx — Maintenance Dashboard → "DMC NG Points (Open)"
 * ───────────────────────────────────────────────────────────────────
 * Machine-no wise count of OPEN ✗ points from the Daily DMC fills, with the
 * machine name beside it and a GRAND TOTAL pinned as the last row.
 * Source: GET /api/machine-dmc/ng-summary   (open = not yet actioned/closed
 * on Machine DMC → DMC NG Point).
 * ─────────────────────────────────────────────────────────────────── */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

export default function DmcNgPanel({ token, refreshKey }) {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    fetch(`/api/machine-dmc/ng-summary`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => { setRows(d.rows || []); setTotal(d.total_open || 0); })
      .catch(() => { setRows([]); setTotal(0); })
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => { load(); }, [load, refreshKey]);
  useEffect(() => {                       // keep it live like the rest of the board
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [load]);

  const th = { padding: "7px 10px", fontSize: 10.5, fontWeight: 800, color: "#64748b",
               textAlign: "left", borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" };
  const td = { padding: "7px 10px", fontSize: 12.5, color: "#334155", borderBottom: "1px solid #f1f5f9" };

  return (
    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14,
                  boxShadow: "0 2px 10px rgba(15,23,42,.05)", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "12px 16px", borderBottom: "1px solid #e2e8f0" }}>
        <div style={{ fontWeight: 800, fontSize: 13.5, color: "#0f172a" }}>
          ✗ DMC NG Points <span style={{ color: "#94a3b8", fontWeight: 600 }}>· open</span>
        </div>
        <button onClick={() => navigate("/maintenance-dmc-ng")}
                style={{ border: "1px solid #cbd5e1", background: "#fff", color: "#2563eb",
                         borderRadius: 7, padding: "4px 12px", cursor: "pointer",
                         fontWeight: 800, fontSize: 11.5, fontFamily: "inherit" }}>
          Open register →
        </button>
      </div>

      <div style={{ maxHeight: 320, overflowY: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead style={{ position: "sticky", top: 0, background: "#f8fafc", zIndex: 1 }}>
            <tr>
              <th style={th}>Machine No</th>
              <th style={th}>Machine Name</th>
              <th style={{ ...th, textAlign: "center" }}>Open NG</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={3} style={{ ...td, textAlign: "center", color: "#94a3b8" }}>Loading…</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={3} style={{ ...td, textAlign: "center", color: "#16a34a", fontWeight: 700 }}>
                No open NG points 🎉</td></tr>
            )}
            {rows.map((r) => (
              <tr key={`${r.zone_name}_${r.line_name}_${r.machine_no}`}>
                <td style={{ ...td, fontWeight: 800, color: "#0f172a", whiteSpace: "nowrap" }}>{r.machine_no}</td>
                <td style={td}>{r.machine_name || "—"}</td>
                <td style={{ ...td, textAlign: "center" }}>
                  <span style={{ display: "inline-block", minWidth: 26, padding: "2px 8px", borderRadius: 999,
                                 background: "#fef2f2", border: "1px solid #fecaca",
                                 color: "#dc2626", fontWeight: 800, fontSize: 12 }}>
                    {r.open_count}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
          {/* grand total — always the LAST row */}
          <tfoot>
            <tr>
              <td colSpan={2} style={{ padding: "9px 10px", fontSize: 12.5, fontWeight: 800,
                                       color: "#0f172a", borderTop: "2px solid #0f172a", background: "#f8fafc" }}>
                TOTAL
              </td>
              <td style={{ padding: "9px 10px", textAlign: "center", borderTop: "2px solid #0f172a",
                           background: "#f8fafc" }}>
                <span style={{ display: "inline-block", minWidth: 30, padding: "3px 10px", borderRadius: 999,
                               background: total ? "#dc2626" : "#16a34a", color: "#fff",
                               fontWeight: 800, fontSize: 12.5 }}>
                  {total}
                </span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
