/* ───────────────────────────────────────────────────────────────────
 * MaintenanceCAPA.jsx  —  CAPA / Quality Problem Report (QPR)
 * ───────────────────────────────────────────────────────────────────
 * Format = capa.xlsx (TOYOTA BOSHOKU DEVICE INDIA — QUALITY PROBLEM
 * REPORT / QPR, 8D style).  The full sheet grid is generated cell-for-cell
 * from the Excel (exact merged-cell colspan/rowspan) into `capaGrid.js`;
 * this page renders that grid as a faithful on-screen replica.
 *
 * NOTE: abhi ye SIRF format (layout same-2-same) hai — fillable inputs +
 * save/backend baad me ("us par kaam karege").  Grid regenerate karna ho to:
 *   Phase2\.venv\Scripts\python.exe <scratchpad>\gen_capa_html.py
 *
 * Routing: /maintenance-capa
 */
import { useAuth } from "../context/AuthContext";
import { CAPA_QPR_GRID } from "./capaGrid";

export default function MaintenanceCAPA() {
  const { theme, user } = useAuth();
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700;800&family=Barlow+Condensed:wght@700;800&display=swap');
        .cp-root { min-height:100vh; background:#e5e7eb; font-family:'Barlow',sans-serif; padding-bottom:40px; }
        .cp-top { background:#fff; border-bottom:1px solid #e2e8f0; height:60px; padding:0 40px 0 96px;
                  display:flex; align-items:center; justify-content:space-between; position:sticky; top:0; z-index:50; box-shadow:0 1px 3px rgba(0,0,0,.06); }
        .cp-top::after { content:''; position:absolute; bottom:0; left:0; right:0; height:2px; background:${theme.gradient}; }
        .cp-title { font-family:'Barlow Condensed',sans-serif; font-size:30px; font-weight:800; color:#0f172a; }
        .cp-title span { color:${theme.accent}; }
        .cp-hint { font-size:12px; color:#64748b; }

        .cp-scroll { max-width:1180px; margin:18px auto; overflow-x:auto; }
        /* the A4-style sheet */
        .cp-sheet { background:#fff; padding:10px; box-shadow:0 3px 16px rgba(15,23,42,.18); min-width:1000px; }
        .qpr { width:100%; border-collapse:collapse; table-layout:fixed; font-family:Arial, sans-serif; color:#111; }
        .qpr td { overflow:hidden; word-wrap:break-word; line-height:1.15; }
      `}</style>

      <div className="cp-root">
        <div className="cp-top">
          <div className="cp-title">CA<span>PA</span> <span style={{ fontFamily:"'Barlow',sans-serif", fontSize:15, color:"#64748b", fontWeight:700 }}>· QPR</span></div>
          <span className="cp-hint">{user?.username ? <>Signed in as <b>{user.username}</b></> : ""}</span>
        </div>

        <div className="cp-scroll">
          <div className="cp-sheet" dangerouslySetInnerHTML={{ __html: CAPA_QPR_GRID }} />
        </div>
      </div>
    </>
  );
}
