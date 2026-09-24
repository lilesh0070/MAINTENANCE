import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";

/* ════════════════════════════════════════════════════════════════════
 * Quick Access — Maintenance Dashboard par ANDON ke bagal wala 30% card.
 * User 2026-09-24: "is naye card me heading apne hisaab se do, phir isme 4
 * button banao ... 2 upar, 2 neeche."  (Pehle Log Book / Breakdown / Daily /
 * Holiday the -- baad me user ne charon badal diye, neeche LINKS dekho.)
 *
 * Har button seedha us page par le jaata hai.  Jis page ki permission nahi,
 * uska button DISABLED dikhta hai (chhupate nahi -- 2x2 ka dhaancha na toote).
 * `keys` = wahi jo App.jsx ka route maangta hai.  Kisi page ko DO key
 * chahiye hon (jaise UpdatePlan ka section: route + section ki key) to dono
 * likho, warna button dabane par bhi page mana kar deta.
 *
 * ⚠ Rang `rgba(...)` me, 8-ank wale hex (#rrggbbaa) me NAHI -- plant ke TV ka
 *   WebView purana hai (`color-mix`, `inset` wahan nahi chalte).  Koi
 *   animation nahi (app/TV me lagataar animation mana hai).
 * ════════════════════════════════════════════════════════════════════ */
// User 2026-09-24 (baad me): charon badle -- "pehla Work Records,
// Maintenance KPI, Attendance Dashboard", phir "4th ka naam 3D View wala".
// Rang jagah ke hisaab se wahi rakhe.  3D View seedha `/maintenance-3d-view`
// (model ki list wahi page dikhata hai), key sidebar wali hi.
// Work Records SABKE LIYE khula hai (koi permission key nahi) -- `keys: []`
// par `every()` hamesha true, yaani button kabhi disabled nahi.
const LINKS = [
  { label: "Work Records",         icon: "🧾", to: "/work-records",
    keys: [],
    bg: "rgba(13,148,136,.07)",  bd: "rgba(13,148,136,.30)" },
  { label: "Maintenance KPI",      icon: "📊", to: "/maintenance-kpi",
    keys: ["maintenance-kpi"],
    bg: "rgba(220,38,38,.06)",   bd: "rgba(220,38,38,.28)" },
  { label: "Attendance Dashboard", icon: "👥", to: "/maintenance-attendance",
    keys: ["maintenance-attendance"],
    bg: "rgba(37,99,235,.06)",   bd: "rgba(37,99,235,.28)" },
  { label: "3D View",              icon: "🧊", to: "/maintenance-3d-view",
    keys: ["maintenance-3d-view"],
    bg: "rgba(217,119,6,.07)",   bd: "rgba(217,119,6,.30)" },
];

function QuickAccess() {
  const nav = useNavigate();
  // Kis dashboard se gaye (`/dashboard` ya `/maintenance-dashboard`) -- us
  // page ka "← Back" (DashBack) wapas wahi laata hai.
  const { pathname } = useLocation();
  const { canAccess } = useAuth();

  return (
    <div style={{ flex: 1, minHeight: 120, display: "flex", flexDirection: "column",
                  background: "#fff", border: "1px solid #e8edf3", borderRadius: 14,
                  overflow: "hidden", boxShadow: "0 1px 3px rgba(15,23,42,.05)" }}>
      {/* header — Today Present Person jaisa hi */}
      <div style={{ padding: "13px 16px", borderBottom: "1px solid #eef2f7",
                    display: "flex", alignItems: "center", gap: 11 }}>
        <span style={{ width: 34, height: 34, borderRadius: 9, background: "#1e3a8a", color: "#fff",
                       display: "inline-flex", alignItems: "center", justifyContent: "center",
                       fontSize: 16, flexShrink: 0 }}>⚡</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 19, fontWeight: 800,
                        color: "#0f172a", lineHeight: 1.1 }}>Quick Access</div>
          <div style={{ fontSize: 10.5, color: "#8a94a6", fontWeight: 600 }}>Open a page in one tap</div>
        </div>
      </div>

      {/* 2 upar, 2 neeche.  Card ANDON jitna lamba hota hai (stretch), to
          khaane `1fr` -- jitni jagah mile utne bade. */}
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gridAutoRows: "1fr",
                    gap: 10, padding: 12 }}>
        {LINKS.map((l) => {
          const ok = l.keys.every((k) => canAccess(k));
          return (
            <button key={l.to} type="button" disabled={!ok} onClick={() => nav(l.to, { state: { from: pathname } })}
                    title={ok ? `Open ${l.label}` : "You don't have access to this page"}
                    style={{ display: "flex", flexDirection: "column", alignItems: "center",
                             justifyContent: "center", gap: 6, minHeight: 64, padding: "10px 8px",
                             borderRadius: 11, fontFamily: "inherit",
                             border: `1.5px solid ${ok ? l.bd : "#e2e8f0"}`,
                             background: ok ? l.bg : "#f8fafc",
                             color: ok ? "#0f172a" : "#94a3b8",
                             cursor: ok ? "pointer" : "not-allowed" }}>
              <span style={{ fontSize: 22, lineHeight: 1,
                             filter: ok ? "none" : "grayscale(1)", opacity: ok ? 1 : 0.5 }}>{l.icon}</span>
              <span style={{ fontSize: 12.5, fontWeight: 800, textAlign: "center", lineHeight: 1.2 }}>
                {l.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default QuickAccess;
