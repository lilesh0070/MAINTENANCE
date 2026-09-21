/* ───────────────────────────────────────────────────────────────────
 * ThreeDView.jsx — "3D View" (sidebar, Maintenance section)
 * ───────────────────────────────────────────────────────────────────
 * 3D model ki list -- abhi ek: Cylinder (double-acting cylinder + 5/2
 * solenoid valve, user ki apni three.js file, 2026-09-21).  Card dabao to
 * wahi model poori jagah me khulta hai.
 *
 * Model ek STATIC HTML hai (`public/3d/*.html`) jo <iframe> me chalta hai --
 * React me dobara NAHI likha.  Wajah:
 *   • code wahi rehta hai jo user ne diya (sirf CDN ke 3 link local kiye)
 *   • three.js / Tailwind sirf isi page par aate hain, baaki app halki rehti
 *   • page chhodte hi iframe hat-ta hai -> WebGL + animation band (battery)
 *
 * Plant ka LAN internet se kata hai, isliye library `public/3d/lib/` me hain
 * (kahan se aayi, CSS dobara kaise banti hai: `public/3d/lib/README.txt`).
 *
 * Naya model: HTML `public/3d/` me rakho, uske CDN link `lib/` par karo, aur
 * neeche MODELS me ek line.  Permission alag nahi -- sab isi page ki key par.
 *
 * Header / card ki class Breakdown page wali (`bd-*`) hi hain -- JAAN-BOOJH
 * KAR.  `responsive.css` me phone / tablet / TV ke saare header-niyam (logo
 * aur ⚙ ki jagah, title beech me, naam ki pill chhupi) inhi class par likhe
 * hain, to ye page bina naye niyam ke hi har screen par sahi baithta hai.
 *
 * Routing: /maintenance-3d-view (list) · /maintenance-3d-view/:model (model)
 * Access:  canAccess("maintenance-3d-view") -- dono raaste isi ek key par.
 */
import { useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const MODELS = [
  { key: "cylinder", label: "Cylinder", icon: "🛢️",
    desc: "Double-acting cylinder with 5/2 solenoid valve",
    file: "/3d/cylinder.html" },
];

export default function ThreeDView() {
  const { theme, user } = useAuth();
  const nav = useNavigate();
  const { model } = useParams();
  const m = model ? MODELS.find((x) => x.key === model) : null;

  // Galat / purana link (jaise /maintenance-3d-view/xyz) -- list par wapas
  if (model && !m) return <Navigate to="/maintenance-3d-view" replace />;

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
        .bd-ico { width:46px; height:46px; flex-shrink:0; border-radius:12px;
                  display:flex; align-items:center; justify-content:center; font-size:22px;
                  background:${theme.soft}; }
        .bd-btn-label { font-size:16px; font-weight:800; color:#0f172a; line-height:1.2; }
        .bd-btn-go { font-size:11px; font-weight:600; color:#94a3b8; margin-top:3px; }
        .tdv-desc { font-size:12px; font-weight:500; color:#64748b; margin-top:2px; line-height:1.3; }

        /* Model khula ho: header + neeche poori jagah 3D.  Fixed isliye ki
           page kabhi scroll na ho -- 3D me ungli ghumane par page na khiske.
           z-index 5: slide-nav (998+), AI (10000), ANDON popup sab iske UPAR. */
        .tdv-shell { position:fixed; inset:0; z-index:5; display:flex; flex-direction:column;
                     background:#050911; font-family:'Barlow',sans-serif; }
        .tdv-shell .bd-topbar { flex-shrink:0; }
        .tdv-back { display:flex; align-items:center; gap:6px; font-size:13px; font-weight:700; color:#475569;
                    background:#f1f5f9; border:1px solid #e2e8f0; border-radius:8px; padding:7px 14px;
                    cursor:pointer; font-family:'Barlow',sans-serif; }
        .tdv-back:hover { background:#e2e8f0; color:#0f172a; }
        .tdv-stage { position:relative; flex:1; min-height:0; }
        .tdv-frame { position:absolute; inset:0; width:100%; height:100%; border:0; display:block;
                     background:#050911; }
        .tdv-loading { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
                       background:#050911; color:#94a3b8; font-size:13px; font-weight:700;
                       letter-spacing:.06em; pointer-events:none; }
        /* Neeche ki patti sirf chhoti screen par: AI ka button neeche-daayen
           kone me taerta hai, aur wahan 3D ke control (X-Ray, Explode) poori
           chaudai me hote hain -- bina patti ke button unhe dhak leta.
           Website: button 56px + 24 kinara = 80, +8 kyunki button 4px upar-
           neeche tairta hai (naapa: 655 par, patti 659 se).  App: 44 + 12 = 64. */
        .tdv-foot { display:none; flex-shrink:0; align-items:center; padding:0 72px 0 16px;
                    background:#0b1220; border-top:1px solid rgba(56,189,248,.2);
                    color:#94a3b8; font-size:12px; font-weight:600; }
        @media (max-width: 760px) { .tdv-foot { display:flex; height:88px; } }
        body.in-app .tdv-foot { display:flex; height:64px; padding-right:64px; }
        /* Phone ka apna back hai (baaki page jaisa -- responsive.css ka "IN-APP
           Back" niyam), isliye app me ye button nahi. */
        body.in-app .tdv-back { display:none !important; }
        /* WEBSITE patli khidki me (phone ka browser): beech wala absolute title
           Back aur logo par chadh jaata tha (360px par naapa).  Wahan title ko
           Back ke baad line me rakho, naam ki pill hatao.  App (in-app*) par
           ye niyam NAHI -- wahan responsive.css ke apne niyam hain. */
        @media (max-width: 760px) {
          body:not(.in-app):not(.in-app-tab):not(.in-app-tv) .tdv-shell .bd-topbar
            { justify-content:flex-start; gap:10px; padding-left:84px; }
          body:not(.in-app):not(.in-app-tab):not(.in-app-tv) .tdv-shell .bd-title
            { position:static; transform:none; font-size:24px; min-width:0;
              overflow:hidden; text-overflow:ellipsis; }
          /* list wale page par bhi -- beech ka title pill se takraata tha */
          body:not(.in-app):not(.in-app-tab):not(.in-app-tv) .bd-user-pill { display:none; }
        }
      `}</style>

      {m ? <ModelViewer m={m} user={user} onBack={() => nav("/maintenance-3d-view")} /> : (
        <div className="bd-root">
          <div className="bd-topbar">
            <div />
            <div className="bd-title">3D <span>View</span></div>
            {user?.username && (
              <div className="bd-user-pill">Signed in as <b>{user.username}</b></div>
            )}
          </div>

          <div className="bd-body">
            <div className="bd-heading">3D View</div>
            <div className="bd-sub">Interactive 3D models — choose one to open.</div>

            <div className="bd-grid">
              {MODELS.map((x) => (
                <button key={x.key} className="bd-btn"
                        onClick={() => nav(`/maintenance-3d-view/${x.key}`)}>
                  <span className="bd-ico">{x.icon}</span>
                  <span>
                    <div className="bd-btn-label">{x.label}</div>
                    <div className="tdv-desc">{x.desc}</div>
                    <div className="bd-btn-go">Open 3D →</div>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ModelViewer({ m, user, onBack }) {
  // iframe ka `load` tab aata hai jab andar ki module script (three.js) bhi
  // chal chuki hoti hai -- tab tak "Loading" dikhao, khaali kaala dabba nahi.
  const [chala, setChala] = useState(false);

  // Body ka 8px margin + Layout ka 100vh = page 16px scroll hota tha, aur
  // daayein scrollbar 3D ki chaudai kha jaata (naapa: 1280 me frame 1265).
  // Model khula hai tab tak page ka scroll band, jaate hi pehle jaisa.
  useEffect(() => {
    const h = document.documentElement, b = document.body;
    const pehle = [h.style.overflow, b.style.overflow];
    h.style.overflow = "hidden"; b.style.overflow = "hidden";
    return () => { h.style.overflow = pehle[0]; b.style.overflow = pehle[1]; };
  }, []);
  return (
    <div className="tdv-shell">
      <div className="bd-topbar">
        <button className="tdv-back" onClick={onBack}>← Back</button>
        <div className="bd-title">3D <span>{m.label}</span></div>
        {user?.username
          ? <div className="bd-user-pill">Signed in as <b>{user.username}</b></div>
          : <div />}
      </div>
      <div className="tdv-stage">
        {/* src ek hi baar -- badalne par iframe history me entry banata, aur
            phone ka back pehle iframe ko peechhe le jaata, page ko nahi. */}
        <iframe className="tdv-frame" src={m.file} title={`${m.label} — 3D view`}
                onLoad={() => setChala(true)} />
        {!chala && <div className="tdv-loading">Loading 3D model…</div>}
      </div>
      <div className="tdv-foot">Drag to rotate · Pinch or scroll to zoom</div>
    </div>
  );
}
