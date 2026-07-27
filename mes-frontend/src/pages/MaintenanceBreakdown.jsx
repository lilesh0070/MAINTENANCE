/* ───────────────────────────────────────────────────────────────────
 * MaintenanceBreakdown.jsx
 * ───────────────────────────────────────────────────────────────────
 * "Breakdown" landing page.  Opens from the sidebar (Breakdown) and shows
 * a grid of action buttons.  Each button's destination/content is wired up
 * later — for now they surface a "coming soon" note so the click registers.
 *
 * Routing: /maintenance-breakdown — gated via canAccess('maintenance-breakdown').
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { NewBreakdownSlip } from "./breakdown/NewBreakdownSlip";

// The breakdown action buttons (label + icon).  `path` opens a dedicated
// page; `action` runs an in-page handler (the blank slip launcher).
const BUTTONS = [
  { key: "new-slip",     label: "Breakdown Slip",        icon: "🧾", action: "new-slip" },
  { key: "bd-history",   label: "BD History",            icon: "📜", path: "/maintenance-breakdown/bd-history" },
  { key: "bd-analysis",  label: "BD Analysis",           icon: "📊", path: "/maintenance-breakdown/bd-analysis" },
  { key: "pareto",       label: "Pareto Analysis",       icon: "📈", path: "/maintenance-breakdown/pareto-analysis" },
  { key: "top-10",       label: "Top 10 BD",             icon: "🏆", path: "/maintenance-breakdown/top-10" },
];

export default function MaintenanceBreakdown() {
  const { theme, user, token } = useAuth();
  const nav = useNavigate();
  const [active, setActive] = useState(null);
  const [newSlip, setNewSlip] = useState(false);   // blank Break Down Slip launcher
  const [toast, setToast]     = useState("");

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700;800&family=Barlow+Condensed:wght@600;700;800&display=swap');
        .bd-root { min-height:100vh; background:#f8fafc; font-family:'Barlow',sans-serif; padding-bottom:60px; }
        .bd-topbar {
          background:#fff; border-bottom:1px solid #e2e8f0;
          padding:0 40px 0 88px; height:60px;
          display:flex; align-items:center; justify-content:space-between;
          position:sticky; top:0; z-index:100; box-shadow:0 1px 3px rgba(0,0,0,.06);
        }
        .bd-topbar::after { content:''; position:absolute; bottom:0; left:0; right:0;
                            height:2px; background:${theme.gradient}; }
        .bd-title { position:absolute; left:50%; transform:translateX(-50%);
                    font-family:'Barlow Condensed',sans-serif;
                    font-size:34px; font-weight:800; color:#0f172a;
                    letter-spacing:-.01em; pointer-events:none; white-space:nowrap; }
        .bd-title span { color:${theme.accent}; }
        .bd-user-pill { display:flex; align-items:center; gap:10px; padding:6px 14px;
                        border-radius:99px; border:1.5px solid #e2e8f0; background:#f8fafc;
                        font-size:12px; font-weight:600; color:#334155; white-space:nowrap; }
        .bd-user-pill b { color:#0f172a; font-weight:800; }
        .bd-body { padding:28px 40px 0; max-width:1180px; margin:0 auto; }
        .bd-heading { font-family:'Barlow Condensed',sans-serif; font-size:20px;
                      font-weight:800; color:#0f172a; text-transform:uppercase;
                      letter-spacing:.04em; margin-bottom:4px; }
        .bd-sub { font-size:12px; color:#64748b; margin-bottom:22px; }

        .bd-grid { display:grid; gap:18px;
                   grid-template-columns:repeat(auto-fill, minmax(230px, 1fr)); }
        .bd-btn { display:flex; align-items:center; gap:14px; text-align:left;
                  background:#fff; border:1px solid #e2e8f0; border-radius:16px;
                  padding:20px 20px; cursor:pointer; font-family:'Barlow',sans-serif;
                  box-shadow:0 1px 3px rgba(15,23,42,.05);
                  transition:transform .15s ease, box-shadow .15s ease, border-color .15s ease; }
        .bd-btn:hover { transform:translateY(-3px); box-shadow:0 12px 28px rgba(15,23,42,.10);
                        border-color:${theme.accent}; }
        .bd-btn.active { border-color:${theme.accent}; box-shadow:0 0 0 3px ${theme.soft}; }
        .bd-ico { width:46px; height:46px; flex-shrink:0; border-radius:12px;
                  display:flex; align-items:center; justify-content:center; font-size:22px;
                  background:${theme.soft}; }
        .bd-btn-label { font-size:16px; font-weight:800; color:#0f172a; line-height:1.2; }
        .bd-btn-go { font-size:11px; font-weight:600; color:#94a3b8; margin-top:3px; }

        .bd-note { margin-top:24px; background:#fff; border:1px solid #e2e8f0;
                   border-radius:14px; padding:22px 24px; box-shadow:0 1px 3px rgba(15,23,42,.05); }
        .bd-note-title { font-weight:800; font-size:15px; color:#0f172a; }
        .bd-note-sub { font-size:12px; color:#64748b; margin-top:4px; }
      `}</style>

      <div className="bd-root">
        <div className="bd-topbar">
          <div />
          <div className="bd-title">Break<span>down</span></div>
          {user?.username && (
            <div className="bd-user-pill">Signed in as <b>{user.username}</b></div>
          )}
        </div>

        <div className="bd-body">
          <div className="bd-heading">Breakdown</div>
          <div className="bd-sub">Choose an action below.</div>

          <div className="bd-grid">
            {BUTTONS.map((b) => (
              <button key={b.key}
                      className={`bd-btn${active === b.key ? " active" : ""}`}
                      onClick={() => b.action === "new-slip" ? setNewSlip(true)
                                   : b.path ? nav(b.path) : setActive(b.key)}>
                <span className="bd-ico">{b.icon}</span>
                <span>
                  <div className="bd-btn-label">{b.label}</div>
                  <div className="bd-btn-go">
                    {b.action ? "Fill from scratch →" : b.path ? "Open →" : "Coming soon"}
                  </div>
                </span>
              </button>
            ))}
          </div>

          {active && (
            <div className="bd-note">
              <div className="bd-note-title">
                {BUTTONS.find((b) => b.key === active)?.label}
              </div>
              <div className="bd-note-sub">
                Coming soon — this section will be wired up next.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* blank Break Down Slip — pick a line, fill the whole slip, save */}
      {newSlip && (
        <NewBreakdownSlip token={token}
                          onClose={() => setNewSlip(false)}
                          onSaved={() => { setToast("✓ Break Down Slip save ho gayi."); }} />
      )}

      {toast && (
        <div onClick={() => setToast("")}
             style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
                      background: "#0f172a", color: "#fff", padding: "12px 22px", borderRadius: 10,
                      fontSize: 13.5, fontWeight: 700, zIndex: 900, cursor: "pointer",
                      boxShadow: "0 10px 30px rgba(0,0,0,.3)" }}>
          {toast}
        </div>
      )}
    </>
  );
}
