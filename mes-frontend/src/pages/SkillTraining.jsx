/* ───────────────────────────────────────────────────────────────────
 * SkillTraining.jsx
 * ───────────────────────────────────────────────────────────────────
 * "Skill & Training" landing page.  Opens from the sidebar (Skill &
 * Training) and shows a grid of action buttons.  OJT opens a dedicated
 * page; the rest surface a "coming soon" note until wired up.
 *
 * Routing: /skill-training — gated via canAccess('skill-training').
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

// The Skill & Training action buttons (label + icon).  `path` (when set)
// opens a dedicated page; the rest are placeholders until wired up.
const BUTTONS = [
  { key: "ojt",            label: "OJT",                   icon: "🎓", path: "/skill-training/ojt" },
  { key: "skill-matrix",   label: "Skill Matrix",          icon: "🧮", path: "/skill-training/skill-matrix" },
  { key: "org-chart",      label: "Organisation Chart",    icon: "🏢", path: "/skill-training/org-chart" },
  { key: "skill-upgrade",  label: "Skill Upgradation Plan", icon: "📈", path: "/skill-training/skill-upgradation" },
];

export default function SkillTraining() {
  const { theme, user } = useAuth();
  const nav = useNavigate();
  const [active, setActive] = useState(null);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700;800&family=Barlow+Condensed:wght@600;700;800&display=swap');
        .st-root { min-height:100vh; background:#f8fafc; font-family:'Barlow',sans-serif; padding-bottom:60px; }
        .st-topbar {
          background:#fff; border-bottom:1px solid #e2e8f0;
          padding:0 40px 0 88px; height:60px;
          display:flex; align-items:center; justify-content:space-between;
          position:sticky; top:0; z-index:100; box-shadow:0 1px 3px rgba(0,0,0,.06);
        }
        .st-topbar::after { content:''; position:absolute; bottom:0; left:0; right:0;
                            height:2px; background:${theme.gradient}; }
        .st-title { position:absolute; left:50%; transform:translateX(-50%);
                    font-family:'Barlow Condensed',sans-serif;
                    font-size:34px; font-weight:800; color:#0f172a;
                    letter-spacing:-.01em; pointer-events:none; white-space:nowrap; }
        .st-title span { color:${theme.accent}; }
        .st-user-pill { display:flex; align-items:center; gap:10px; padding:6px 14px;
                        border-radius:99px; border:1.5px solid #e2e8f0; background:#f8fafc;
                        font-size:12px; font-weight:600; color:#334155; white-space:nowrap; }
        .st-user-pill b { color:#0f172a; font-weight:800; }
        .st-body { padding:28px 40px 0; max-width:1180px; margin:0 auto; }
        .st-heading { font-family:'Barlow Condensed',sans-serif; font-size:20px;
                      font-weight:800; color:#0f172a; text-transform:uppercase;
                      letter-spacing:.04em; margin-bottom:4px; }
        .st-sub { font-size:12px; color:#64748b; margin-bottom:22px; }

        .st-grid { display:grid; gap:18px;
                   grid-template-columns:repeat(auto-fill, minmax(230px, 1fr)); }
        .st-btn { display:flex; align-items:center; gap:14px; text-align:left;
                  background:#fff; border:1px solid #e2e8f0; border-radius:16px;
                  padding:20px 20px; cursor:pointer; font-family:'Barlow',sans-serif;
                  box-shadow:0 1px 3px rgba(15,23,42,.05);
                  transition:transform .15s ease, box-shadow .15s ease, border-color .15s ease; }
        .st-btn:hover { transform:translateY(-3px); box-shadow:0 12px 28px rgba(15,23,42,.10);
                        border-color:${theme.accent}; }
        .st-btn.active { border-color:${theme.accent}; box-shadow:0 0 0 3px ${theme.soft}; }
        .st-ico { width:46px; height:46px; flex-shrink:0; border-radius:12px;
                  display:flex; align-items:center; justify-content:center; font-size:22px;
                  background:${theme.soft}; }
        .st-btn-label { font-size:16px; font-weight:800; color:#0f172a; line-height:1.2; }
        .st-btn-go { font-size:11px; font-weight:600; color:#94a3b8; margin-top:3px; }

        .st-note { margin-top:24px; background:#fff; border:1px solid #e2e8f0;
                   border-radius:14px; padding:22px 24px; box-shadow:0 1px 3px rgba(15,23,42,.05); }
        .st-note-title { font-weight:800; font-size:15px; color:#0f172a; }
        .st-note-sub { font-size:12px; color:#64748b; margin-top:4px; }
      `}</style>

      <div className="st-root">
        <div className="st-topbar">
          <div />
          <div className="st-title">Skill &amp; <span>Training</span></div>
          {user?.username && (
            <div className="st-user-pill">Signed in as <b>{user.username}</b></div>
          )}
        </div>

        <div className="st-body">
          <div className="st-heading">Skill &amp; Training</div>
          <div className="st-sub">Choose an action below.</div>

          <div className="st-grid">
            {BUTTONS.map((b) => (
              <button key={b.key}
                      className={`st-btn${active === b.key ? " active" : ""}`}
                      onClick={() => b.path ? nav(b.path) : setActive(b.key)}>
                <span className="st-ico">{b.icon}</span>
                <span>
                  <div className="st-btn-label">{b.label}</div>
                  <div className="st-btn-go">{b.path ? "Open →" : "Coming soon"}</div>
                </span>
              </button>
            ))}
          </div>

          {active && (
            <div className="st-note">
              <div className="st-note-title">
                {BUTTONS.find((b) => b.key === active)?.label}
              </div>
              <div className="st-note-sub">
                Coming soon — this section will be wired up next.
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
