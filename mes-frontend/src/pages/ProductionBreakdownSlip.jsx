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
import { PROD_ZONES } from "../constants/zones";
import { api, Btn } from "./breakdown/shared";
import { ClosureFormModal } from "./breakdown/ClosureFormModal";

const TABS = [
  { key: "PRODUCTION",  label: "🏭 Production",  stage: "PENDING_PRODUCTION",  phase: "production",  accent: "#1e40af",
    hint: "Production apni half bhare — machine, operator, category, problem." },
  { key: "MAINTENANCE", label: "🔧 Maintenance", stage: "PENDING_MAINTENANCE", phase: "maintenance", accent: "#0e7490",
    hint: "Production ke baad — maintenance problem/action/spares bharke complete kare." },
];

// Slip kitni purani hai.  Production bhare BINA slip maintenance ko dikhti hi
// nahi (chahe kitni bhi purani ho) — isliye production ko saaf dikhna chahiye ki
// kya latka pada hai.  1+ din purani → laal.
const ageDays = (d) => {
  if (!d) return 0;
  const t = new Date(String(d).slice(0, 10) + "T00:00:00");
  if (isNaN(t)) return 0;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((today - t) / 86400000));
};
const ageLabel = (d) => {
  const n = ageDays(d);
  return n === 0 ? "aaj" : n === 1 ? "1 din" : `${n} din`;
};
const fmtDate = (d) => {
  if (!d) return "—";
  const s = String(d).slice(0, 10).split("-");
  return s.length === 3 ? `${s[2]}/${s[1]}/${s[0]}` : String(d);
};

export default function ProductionBreakdownSlip() {
  const { token } = useAuth();
  const nav = useNavigate();
  const [tab, setTab]     = useState("PRODUCTION");
  const [rows, setRows]   = useState([]);
  const [count, setCount] = useState({ PRODUCTION: 0, MAINTENANCE: 0 });
  const [loading, setLoad]= useState(true);
  const [modal, setModal] = useState(null);   // { ticket, phase }
  const [err, setErr]     = useState("");
  const [zoneSel, setZone]= useState("");     // zone card click -> list filter

  const T = TABS.find((t) => t.key === tab);

  // Zone-wise open count (is tab ke stage ki slips me se)
  const zoneCount = {};
  PROD_ZONES.forEach((z) => { zoneCount[z] = 0; });
  rows.forEach((r) => { const z = r.zone; if (z in zoneCount) zoneCount[z] += 1; });
  const shown = zoneSel ? rows.filter((r) => r.zone === zoneSel) : rows;

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
    try {
      await api.post(`/api/breakdown-slips/auto/${id}/fill`, {
        maintenance_data: phase === "maintenance" ? slice : undefined,
        production_data:  phase === "production"  ? slice : (prodExtra || undefined),
        stage,
      }, token);
      setModal(null);
      load();
    } catch (e) {
      // stage-conflict (409: koi aur pehle submit kar chuka) ya network — dikhao,
      // modal khula rehne do taaki bhara hua data na ude.
      setErr(e.message || "Submit failed");
      throw e;
    }
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
              <button key={t.key} onClick={() => { setTab(t.key); setZone(""); }}
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

        {/* ── Zone-wise open cards (click = us zone ki list) ───────────── */}
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase",
                      color: "#64748b", margin: "4px 0 8px" }}>
          {tab === "PRODUCTION"
            ? "Zone-wise — production ne abhi tak nahi bhari"
            : "Zone-wise — production submit ho chuki, maintenance pending"}
        </div>
        <div style={{ display: "grid", gap: 12, marginBottom: 18,
                      gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
          {PROD_ZONES.map((z) => {
            const n  = zoneCount[z];
            const on = zoneSel === z;
            return (
              <button key={z} onClick={() => setZone(on ? "" : z)}
                style={{ textAlign: "left", cursor: "pointer", padding: "12px 14px", borderRadius: 14,
                         background: "#fff", fontFamily: "inherit", transition: "all .12s",
                         border: `2px solid ${on ? T.accent : n > 0 ? "#fecaca" : "#e2e8f0"}`,
                         boxShadow: on ? `0 0 0 3px ${T.accent}22` : "0 1px 4px rgba(15,23,42,.05)" }}>
                <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".04em", color: "#64748b",
                              textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden",
                              textOverflow: "ellipsis" }}>{z.replace(/_/g, " ")}</div>
                <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 800, fontSize: 34,
                              lineHeight: 1.05, color: n > 0 ? T.accent : "#cbd5e1" }}>{n}</div>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: n > 0 ? "#dc2626" : "#16a34a" }}>
                  {n > 0 ? "open" : "clear"}
                </div>
              </button>
            );
          })}
        </div>

        {zoneSel && (
          <div style={{ marginBottom: 10, fontSize: 12.5, fontWeight: 700, color: T.accent }}>
            Filter: {zoneSel.replace(/_/g, " ")}
            <button onClick={() => setZone("")}
              style={{ marginLeft: 10, border: "1px solid #cbd5e1", background: "#fff", color: "#475569",
                       borderRadius: 8, padding: "3px 10px", fontSize: 11.5, fontWeight: 700,
                       cursor: "pointer", fontFamily: "inherit" }}>✕ clear</button>
          </div>
        )}

        {err && <div style={{ color: "#dc2626", fontWeight: 700, marginBottom: 10 }}>⚠ {err}</div>}

        {/* list */}
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, overflow: "hidden",
                      boxShadow: "0 1px 4px rgba(15,23,42,.05)" }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Loading…</div>
          ) : shown.length === 0 ? (
            <div style={{ padding: 44, textAlign: "center", color: "#94a3b8" }}>
              <div style={{ fontSize: 34 }}>✅</div>
              <div style={{ fontWeight: 700, color: "#334155", marginTop: 6 }}>
                {zoneSel
                  ? `${zoneSel.replace(/_/g, " ")} me koi pending slip nahi.`
                  : tab === "PRODUCTION" ? "Koi production-pending slip nahi." : "Koi maintenance-pending slip nahi."}
              </div>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 800 }}>
                <thead><tr>
                  {["S.No", "Zone", "Line", "Machine", "Date", "Start", "Pending", "Category", "Problem (Production)", ""]
                    .map((h, i) => <th key={i} style={th}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.id}>
                      <td style={{ ...td, fontWeight: 800, color: T.accent }}>{i + 1}</td>
                      <td style={{ ...td, fontWeight: 700, color: "#0f172a" }}>{r.zone || "—"}</td>
                      <td style={td}>{r.line || "—"}</td>
                      <td style={td}>{r.machine_no || "—"}</td>
                      <td style={{ ...td, fontFamily: "monospace", whiteSpace: "nowrap" }}>{fmtDate(r.bd_start_date)}</td>
                      <td style={{ ...td, fontFamily: "monospace" }}>{r.bd_start_time || "—"}</td>
                      <td style={{ ...td, fontWeight: 700, whiteSpace: "nowrap",
                                   color: ageDays(r.bd_start_date) >= 1 ? "#dc2626" : "#16a34a" }}>
                        {ageLabel(r.bd_start_date)}
                      </td>
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
