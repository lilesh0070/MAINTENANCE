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
import { api, Btn, StatCard } from "./breakdown/shared";
import { ClosureFormModal } from "./breakdown/ClosureFormModal";

const TABS = [
  // Production tab me DONO taraf (maintenance + tool room) ki pending slips
  // ek saath aati hain — production dono bharti hai.  Submit ke baad har slip
  // apni hi taraf jaati hai (ANDON ne jis department ko bulaya tha).
  { key: "PRODUCTION",  icon: "🏭", label: "Production",
    stage: "PENDING_PRODUCTION",  phase: "production",  src: "all",         accent: "#1e40af" },
  { key: "MAINTENANCE", icon: "🔧", label: "Maintenance",
    stage: "PENDING_MAINTENANCE", phase: "maintenance", src: "maintenance", accent: "#0e7490" },
  { key: "TOOLROOM",    icon: "🧰", label: "Tool Room",
    stage: "PENDING_MAINTENANCE", phase: "maintenance", src: "toolroom",    accent: "#b45309" },
  // Status = sirf dekhne ke liye — har breakdown ki ek line (resolve hua ya
  // nahi, aur kisne apni slip submit ki).  `breakdown_status` view se.
  { key: "STATUS",      icon: "📊", label: "Status", status: true, accent: "#7c3aed" },
];

// Slip kitni purani hai.  Production bhare BINA slip maintenance ko dikhti hi
// nahi (chahe kitni bhi purani ho) — isliye production ko saaf dikhna chahiye ki
// kya latka pada hai.  1+ din purani → laal.
// 24 ghante tak GHANTE me (2h, 17h), uske baad DIN me (1 day, 2 day).
const ageMs = (d, t) => {
  if (!d) return null;
  const day  = String(d).slice(0, 10);
  const time = /^\d{1,2}:\d{2}/.test(String(t || "")) ? String(t).slice(0, 5) : "00:00";
  const at = new Date(`${day}T${time}:00`);
  return isNaN(at) ? null : Math.max(0, Date.now() - at.getTime());
};
const ageHours = (d, t) => { const ms = ageMs(d, t); return ms == null ? 0 : ms / 3600000; };
const ageLabel = (d, t) => {
  const ms = ageMs(d, t);
  if (ms == null) return "—";
  const h = Math.floor(ms / 3600000);
  if (h < 24) return h < 1 ? `${Math.floor(ms / 60000)}m` : `${h}h`;
  const days = Math.floor(h / 24);
  return `${days} day`;
};
const fmtDate = (d) => {
  if (!d) return "—";
  const s = String(d).slice(0, 10).split("-");
  return s.length === 3 ? `${s[2]}/${s[1]}/${s[0]}` : String(d);
};

// ── Financial year (Apr→Mar) + month filter ─────────────────────────────
const FY_START = 2025;
const CUR_FY_Y = (() => { const d = new Date(); return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; })();
const FY_LIST = Array.from({ length: Math.max(1, CUR_FY_Y - FY_START + 1) },
                           (_, i) => { const y = FY_START + i; return `${y}-${y + 1}`; }).reverse();
const FY_MONTHS = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];

// Status ka chhota rang-badge: ho gaya = hara, baaki hai = amber, laagu nahi = grey
function Tag({ v }) {
  const s = String(v || "-");
  const C = { SUBMITTED: ["#dcfce7", "#15803d"], RESOLVED: ["#dcfce7", "#15803d"],
              PENDING: ["#fef3c7", "#b45309"],   OPEN: ["#fee2e2", "#b91c1c"] };
  const [bg, fg] = C[s] || ["#f1f5f9", "#94a3b8"];
  return (
    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 99, background: bg,
                   color: fg, fontSize: 11, fontWeight: 800, whiteSpace: "nowrap" }}>
      {s === "-" ? "—" : s}
    </span>
  );
}

export default function ProductionBreakdownSlip() {
  const { token } = useAuth();
  const nav = useNavigate();
  const [tab, setTab]     = useState("PRODUCTION");
  const [rows, setRows]   = useState([]);
  const [count, setCount] = useState({ PRODUCTION: 0, MAINTENANCE: 0, TOOLROOM: 0 });
  const [loading, setLoad]= useState(true);
  const [modal, setModal] = useState(null);   // { ticket, phase }
  const [err, setErr]     = useState("");
  const [zoneSel, setZone]= useState("");     // zone card click -> list filter
  const [fy, setFy]       = useState(`${CUR_FY_Y}-${CUR_FY_Y + 1}`);   // FY filter
  const [month, setMonth] = useState("");     // "" = poora FY

  const T = TABS.find((t) => t.key === tab);

  // Zone-wise open count (is tab ke stage ki slips me se)
  const zoneCount = {};
  PROD_ZONES.forEach((z) => { zoneCount[z] = 0; });
  rows.forEach((r) => { const z = r.zone; if (z in zoneCount) zoneCount[z] += 1; });
  const shown = zoneSel ? rows.filter((r) => r.zone === zoneSel) : rows;

  // FY + month har request me jaata hai — tab counts bhi usi filter ke hisaab se
  const fq = `&fy=${encodeURIComponent(fy)}${month ? `&month=${month}` : ""}`;

  const loadCounts = useCallback(async () => {
    try {
      const q = `&fy=${encodeURIComponent(fy)}${month ? `&month=${month}` : ""}`;
      const [p, m, t] = await Promise.all([
        api.get(`/api/breakdown-slips/stage/PENDING_PRODUCTION?src=all${q}`,          token),
        api.get(`/api/breakdown-slips/stage/PENDING_MAINTENANCE?src=maintenance${q}`, token),
        api.get(`/api/breakdown-slips/stage/PENDING_MAINTENANCE?src=toolroom${q}`,    token),
      ]);
      setCount({ PRODUCTION: (p || []).length, MAINTENANCE: (m || []).length,
                 TOOLROOM: (t || []).length });
    } catch { /* ignore */ }
  }, [token, fy, month]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoad(true); setErr("");
    try {
      const url = T.status ? `/api/breakdown-slips/status?limit=500${fq}`
                           : `/api/breakdown-slips/stage/${T.stage}?src=${T.src}${fq}`;
      const r = await api.get(url, token);
      setRows(Array.isArray(r) ? r : []);
    } catch (e) { setErr(e.message || "Load failed"); }
    finally { setLoad(false); loadCounts(); }
  }, [token, T.stage, T.src, T.status, fq, loadCounts]);
  useEffect(() => { load(); }, [load]);

  const openFill = async (row) => {
    try {
      const src = row.src || T.src || "maintenance";
      const ticket = await api.get(`/api/breakdown-slips/auto/${row.id}?src=${src}`, token);
      setModal({ ticket, phase: T.phase, src });
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
        src: modal.src || "maintenance",   // slip apni hi table me update ho
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
  const sel = { border: "1.5px solid #e2e8f0", borderRadius: 10, padding: "7px 10px", fontSize: 12.5,
                fontWeight: 700, color: "#334155", background: "#fff", fontFamily: "inherit", cursor: "pointer" };

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
        {/* tabs + FY/month filter (filter saare tabs par lagta hai) */}
        <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
          {TABS.map((t) => {
            const on = t.key === tab;
            return (
              <button key={t.key} onClick={() => { setTab(t.key); setZone(""); }}
                style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer",
                         padding: "7px 13px", borderRadius: 10, fontFamily: "inherit", textAlign: "left",
                         transition: "all .14s",
                         border: `1.5px solid ${on ? t.accent : "#e2e8f0"}`,
                         background: on ? t.accent : "#fff",
                         boxShadow: on ? `0 3px 10px ${t.accent}33` : "0 1px 2px rgba(15,23,42,.04)" }}>
                <span style={{ fontSize: 14, lineHeight: 1, filter: on ? "none" : "grayscale(.35)" }}>{t.icon}</span>
                <span style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: ".01em",
                               color: on ? "#fff" : "#334155" }}>{t.label}</span>
                {!t.status && (
                  <span style={{ minWidth: 20, height: 18, borderRadius: 99, padding: "0 6px",
                                 display: "inline-flex", alignItems: "center", justifyContent: "center",
                                 fontSize: 11, fontWeight: 800,
                                 background: on ? "rgba(255,255,255,.24)" : "#f1f5f9",
                                 color: on ? "#fff" : count[t.key] > 0 ? t.accent : "#94a3b8" }}>
                    {count[t.key]}
                  </span>
                )}
              </button>
            );
          })}

          {/* FY + Month — saare tabs (aur unke counts) par lagta hai */}
          <div style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 8 }}>
            <select style={sel} value={fy} onChange={(e) => { setFy(e.target.value); setZone(""); }}>
              {FY_LIST.map((y) => <option key={y} value={y}>FY {y}</option>)}
            </select>
            <select style={sel} value={month} onChange={(e) => { setMonth(e.target.value); setZone(""); }}>
              <option value="">All months</option>
              {FY_MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </div>

        {/* Zone cards — app ka standard StatCard (click = us zone ki list) */}
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 18 }}>
          {PROD_ZONES.map((z) => {
            const n  = zoneCount[z];
            const on = zoneSel === z;
            return (
              <div key={z} style={{ display: "flex", flex: "1 1 130px", minWidth: 0, borderRadius: 12,
                                    boxShadow: on ? `0 0 0 3px ${T.accent}` : undefined }}>
                <StatCard
                  label={z.replace(/_/g, " ")}
                  value={n}
                  sub={n > 0 ? "open" : "clear"}
                  color={n > 0 ? "#dc2626" : "#16a34a"}
                  onClick={() => setZone(on ? "" : z)}
                />
              </div>
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
                  ? `${zoneSel.replace(/_/g, " ")} me kuch nahi.`
                  : tab === "PRODUCTION" ? "Koi production-pending slip nahi."
                  : tab === "TOOLROOM"   ? "Koi tool room-pending slip nahi."
                  : tab === "STATUS"     ? "Abhi koi breakdown record nahi."
                                         : "Koi maintenance-pending slip nahi."}
              </div>
            </div>
          ) : T.status ? (
            /* ── STATUS: har breakdown ki ek line (breakdown_status view) ── */
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
                <thead><tr>
                  {["S.No", "Date", "Start", "Zone", "Line", "Machine", "Shift",
                    "Downtime", "State", "Production", "Maintenance", "Tool Room"]
                    .map((h, i) => <th key={i} style={th}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {shown.map((r, i) => (
                    <tr key={`${r.bd_for}-${r.slip_id}`}>
                      <td style={{ ...td, fontWeight: 800, color: T.accent }}>{i + 1}</td>
                      <td style={{ ...td, fontFamily: "monospace", whiteSpace: "nowrap" }}>{fmtDate(r.bd_start_date)}</td>
                      <td style={{ ...td, fontFamily: "monospace" }}>{r.bd_start_time || "—"}</td>
                      <td style={{ ...td, fontWeight: 700, color: "#0f172a" }}>{r.zone || "—"}</td>
                      <td style={td}>{r.line || "—"}</td>
                      <td style={td}>{r.machine_no || "—"}</td>
                      <td style={td}>{r.shift || "—"}</td>
                      <td style={{ ...td, fontWeight: 700, whiteSpace: "nowrap" }}>
                        {r.total_downtime_min != null ? `${r.total_downtime_min} min` : "—"}</td>
                      <td style={td}><Tag v={r.state} /></td>
                      <td style={td}><Tag v={r.prod} /></td>
                      <td style={td}><Tag v={r.maint} /></td>
                      <td style={td}><Tag v={r.toolroom} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 800 }}>
                <thead><tr>
                  {["S.No", "Zone", "Line", "Machine"]
                    .concat(tab === "PRODUCTION" ? ["Related To"] : [])
                    .concat(["Date", "Start", "Pending", "Category", "Problem (Production)", ""])
                    .map((h, i) => <th key={i} style={th}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {shown.map((r, i) => (
                    <tr key={`${r.src || ""}-${r.id}`}>
                      <td style={{ ...td, fontWeight: 800, color: T.accent }}>{i + 1}</td>
                      <td style={{ ...td, fontWeight: 700, color: "#0f172a" }}>{r.zone || "—"}</td>
                      <td style={td}>{r.line || "—"}</td>
                      <td style={td}>{r.machine_no || "—"}</td>
                      {tab === "PRODUCTION" && (
                        /* ANDON ne kise bulaya — submit ke baad slip isi taraf jaayegi */
                        <td style={td}>
                          <span style={{ display: "inline-block", padding: "2px 9px", borderRadius: 99,
                                         fontSize: 11, fontWeight: 800, whiteSpace: "nowrap",
                                         background: r.src === "toolroom" ? "#fef3c7" : "#e0f2fe",
                                         color:      r.src === "toolroom" ? "#b45309" : "#0e7490" }}>
                            {r.src === "toolroom" ? "🧰 Tool Room" : "🔧 Maintenance"}
                          </span>
                        </td>
                      )}
                      <td style={{ ...td, fontFamily: "monospace", whiteSpace: "nowrap" }}>{fmtDate(r.bd_start_date)}</td>
                      <td style={{ ...td, fontFamily: "monospace" }}>{r.bd_start_time || "—"}</td>
                      <td style={{ ...td, fontWeight: 700, whiteSpace: "nowrap",
                                   color: ageHours(r.bd_start_date, r.bd_start_time) >= 24 ? "#dc2626" : "#16a34a" }}>
                        {ageLabel(r.bd_start_date, r.bd_start_time)}
                      </td>
                      <td style={td}>{r.category || "—"}</td>
                      <td style={{ ...td, maxWidth: 240, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {r.problem_reported_by_production || "—"}</td>
                      <td style={{ ...td, textAlign: "right" }}>
                        <Btn variant="primary" size="sm" onClick={() => openFill(r)}>
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
