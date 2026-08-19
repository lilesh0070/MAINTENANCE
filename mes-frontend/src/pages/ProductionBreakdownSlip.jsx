/* ProductionBreakdownSlip.jsx — 2-stage breakdown slip (Production → Maintenance).

   ANDON threshold ek HALF slip banata hai (stage=PENDING_PRODUCTION).  Production
   apni half bharke "Half Breakdown Submit" kare → stage=PENDING_MAINTENANCE (tab hi
   MAIN DASHBOARD pe maintenance ko dikhe).  Maintenance yahan (ya main dashboard pe)
   complete kare → stage=COMPLETED → data maintenance_auto_breakdown_slip me.

   Do tab:  Production  = PENDING_PRODUCTION slips (production fill kare)
            Maintenance = PENDING_MAINTENANCE slips (maintenance complete kare)
   Dono ek hi ClosureFormModal reuse karte hain — bas phase alag. */
import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { api, Btn, fmtClock } from "./breakdown/shared";
import { ClosureFormModal } from "./breakdown/ClosureFormModal";

const TABS = [
  { key: "PRODUCTION",  label: "🏭 Production",  stage: "PENDING_PRODUCTION",  phase: "production",  accent: "#1e40af",
    hint: "Production apni half bhare — machine, operator, category, problem." },
  { key: "MAINTENANCE", label: "🔧 Maintenance", stage: "PENDING_MAINTENANCE", phase: "maintenance", accent: "#0e7490",
    hint: "Production ke baad — maintenance problem/action/spares bharke complete kare." },
];

export default function ProductionBreakdownSlip() {
  const { token } = useAuth();
  const nav = useNavigate();
  const [tab, setTab]     = useState("PRODUCTION");
  const [rows, setRows]   = useState([]);
  const [count, setCount] = useState({ PRODUCTION: 0, MAINTENANCE: 0 });
  const [loading, setLoad]= useState(true);
  const [modal, setModal] = useState(null);   // { ticket, phase }
  const [err, setErr]     = useState("");

  const T = TABS.find((t) => t.key === tab);

  const loadCounts = useCallback(async () => {
    try {
      const [p, m] = await Promise.all([
        api.get("/api/breakdown-slips/stage/PENDING_PRODUCTION",  token),
        api.get("/api/breakdown-slips/stage/PENDING_MAINTENANCE", token),
      ]);
      setCount({ PRODUCTION: (p || []).length, MAINTENANCE: (m || []).length });
    } catch { /* ignore */ }
  }, [token]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoad(true); setErr("");
    try {
      const r = await api.get(`/api/breakdown-slips/stage/${T.stage}`, token);
      setRows(Array.isArray(r) ? r : []);
    } catch (e) { setErr(e.message || "Load failed"); }
    finally { setLoad(false); loadCounts(); }
  }, [token, T.stage, loadCounts]);
  useEffect(() => { load(); }, [load]);

  const openFill = async (id) => {
    try {
      const ticket = await api.get(`/api/breakdown-slips/auto/${id}`, token);
      setModal({ ticket, phase: T.phase });
    } catch (e) { setErr(e.message || "Open failed"); }
  };

  // ClosureFormModal onSave(slice, phase, prodExtra) → fill + stage transition
  const onSave = async (slice, phase, prodExtra) => {
    const id = modal.ticket.id;
    const stage = phase === "production" ? "PENDING_MAINTENANCE" : "COMPLETED";
    await api.post(`/api/breakdown-slips/auto/${id}/fill`, {
      maintenance_data: phase === "maintenance" ? slice : undefined,
      production_data:  phase === "production"  ? slice : (prodExtra || undefined),
      stage,
    }, token);
    setModal(null);
    load();
  };

  const th = { padding: "9px 12px", textAlign: "left", fontSize: 10.5, fontWeight: 800,
               letterSpacing: ".06em", textTransform: "uppercase", color: "#64748b",
               borderBottom: "2px solid #e2e8f0", whiteSpace: "nowrap" };
  const td = { padding: "9px 12px", fontSize: 13, color: "#334155", borderBottom: "1px solid #f1f5f9" };

  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9", fontFamily: "'Barlow',sans-serif", paddingBottom: 50 }}>
      {/* top bar */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "0 30px", height: 60,
                    display: "flex", alignItems: "center", gap: 16, position: "sticky", top: 0, zIndex: 40,
                    boxShadow: "0 1px 3px rgba(0,0,0,.06)" }}>
        <button onClick={() => nav(-1)} style={{ border: "1px solid #cbd5e1", background: "#fff", color: "#334155",
                fontWeight: 700, fontSize: 13, borderRadius: 8, padding: "7px 14px", cursor: "pointer" }}>← Back</button>
        <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 24, fontWeight: 800, color: "#0f172a" }}>
          Production <span style={{ color: T.accent }}>Breakdown Slip</span>
        </div>
      </div>

      <div style={{ maxWidth: 1300, margin: "20px auto 0", padding: "0 24px" }}>
        {/* tabs */}
        <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
          {TABS.map((t) => {
            const on = t.key === tab;
            return (
              <button key={t.key} onClick={() => setTab(t.key)}
                style={{ padding: "12px 22px", borderRadius: 12, cursor: "pointer", fontFamily: "'Barlow Condensed',sans-serif",
                         fontWeight: 800, fontSize: 17, letterSpacing: ".02em", display: "inline-flex", alignItems: "center", gap: 10,
                         border: `2px solid ${on ? t.accent : "#e2e8f0"}`, background: on ? t.accent : "#fff",
                         color: on ? "#fff" : "#334155" }}>
                {t.label}
                <span style={{ minWidth: 22, height: 22, borderRadius: 99, background: on ? "rgba(255,255,255,.25)" : t.accent,
                               color: "#fff", fontSize: 12, fontWeight: 800, display: "inline-flex",
                               alignItems: "center", justifyContent: "center", padding: "0 6px" }}>
                  {count[t.key]}
                </span>
              </button>
            );
          })}
        </div>

        <div style={{ fontSize: 12.5, color: "#64748b", fontWeight: 600, marginBottom: 12 }}>{T.hint}</div>

        {err && <div style={{ color: "#dc2626", fontWeight: 700, marginBottom: 10 }}>⚠ {err}</div>}

        {/* list */}
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, overflow: "hidden",
                      boxShadow: "0 1px 4px rgba(15,23,42,.05)" }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Loading…</div>
          ) : rows.length === 0 ? (
            <div style={{ padding: 44, textAlign: "center", color: "#94a3b8" }}>
              <div style={{ fontSize: 34 }}>✅</div>
              <div style={{ fontWeight: 700, color: "#334155", marginTop: 6 }}>
                {tab === "PRODUCTION" ? "Koi production-pending slip nahi." : "Koi maintenance-pending slip nahi."}
              </div>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 800 }}>
                <thead><tr>
                  {["S.No", "Zone", "Line", "Machine", "Start", "Category", "Problem (Production)", ""].map((h, i) =>
                    <th key={i} style={th}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.id}>
                      <td style={{ ...td, fontWeight: 800, color: T.accent }}>{i + 1}</td>
                      <td style={{ ...td, fontWeight: 700, color: "#0f172a" }}>{r.zone || "—"}</td>
                      <td style={td}>{r.line || "—"}</td>
                      <td style={td}>{r.machine_no || "—"}</td>
                      <td style={{ ...td, fontFamily: "monospace" }}>{r.bd_start_time || "—"}</td>
                      <td style={td}>{r.category || "—"}</td>
                      <td style={{ ...td, maxWidth: 240, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {r.problem_reported_by_production || "—"}</td>
                      <td style={{ ...td, textAlign: "right" }}>
                        <Btn variant="primary" size="sm" onClick={() => openFill(r.id)}>
                          {tab === "PRODUCTION" ? "✏ Fill Production Half" : "🔧 Complete"}
                        </Btn>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {modal && (
        <ClosureFormModal
          ticket={modal.ticket}
          mode="fill"
          phase={modal.phase}
          token={token}
          onClose={() => setModal(null)}
          onSave={onSave}
        />
      )}
    </div>
  );
}
