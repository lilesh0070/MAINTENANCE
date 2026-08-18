/* ───────────────────────────────────────────────────────────────────
 * MaintenanceCAPA.jsx
 * ───────────────────────────────────────────────────────────────────
 * CAPA (Corrective Action / Preventive Action) — Maintenance.
 *
 * NOTE (2026-08-18): purana format (MES Breakdown Log se auto-driven —
 * Open/Closed/Total tiles + filter + "Pending CAPA" ≥60min breakdowns
 * "Start CAPA" → QPR + "CAPA Records") HATA diya gaya.  User naya format
 * dega, us par yahan naya UI banega.  Sidebar entry + route
 * (/maintenance-capa) + backend (/api/capa-lb, capa_logbook.py) waise ke
 * waise hain — sirf ye page ka format khaali hai.
 *
 * Routing: /maintenance-capa
 */
import { useAuth } from "../context/AuthContext";

export default function MaintenanceCAPA() {
  const { theme, user } = useAuth();
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700;800&family=Barlow+Condensed:wght@700;800&display=swap');
        .cp-root { min-height:100vh; background:#f1f5f9; font-family:'Barlow',sans-serif; }
        .cp-top { background:#fff; border-bottom:1px solid #e2e8f0; height:60px; padding:0 40px 0 96px;
                  display:flex; align-items:center; justify-content:space-between; position:sticky; top:0; z-index:50; box-shadow:0 1px 3px rgba(0,0,0,.06); }
        .cp-top::after { content:''; position:absolute; bottom:0; left:0; right:0; height:2px; background:${theme.gradient}; }
        .cp-title { font-family:'Barlow Condensed',sans-serif; font-size:30px; font-weight:800; color:#0f172a; }
        .cp-title span { color:${theme.accent}; }
        .cp-body { max-width:1280px; margin:0 auto; padding:22px 30px; }
        .cp-ph { background:#fff; border:1px dashed #cbd5e1; border-radius:16px; padding:60px 30px; text-align:center;
                 box-shadow:0 1px 3px rgba(15,23,42,.05); }
        .cp-ph-icon { font-size:52px; line-height:1; }
        .cp-ph-t { font-family:'Barlow Condensed',sans-serif; font-size:26px; font-weight:800; color:#0f172a; margin-top:14px; }
        .cp-ph-s { font-size:13.5px; color:#64748b; margin-top:8px; max-width:520px; margin-left:auto; margin-right:auto; line-height:1.5; }
      `}</style>

      <div className="cp-root">
        <div className="cp-top">
          <div className="cp-title">CA<span>PA</span></div>
          {user?.username && <span style={{ fontSize:12, color:"#64748b", fontWeight:600 }}>Signed in as <b>{user.username}</b></span>}
        </div>

        <div className="cp-body">
          <div className="cp-ph">
            <div className="cp-ph-icon">🛡</div>
            <div className="cp-ph-t">CAPA — naya format banega</div>
            <div className="cp-ph-s">
              Purana format hata diya gaya hai. Naya CAPA format bhej do — usi ke hisaab se yahan naya page bana denge.
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
