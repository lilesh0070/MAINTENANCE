import { useState, useEffect, useRef, useCallback, useMemo, Fragment } from "react";
import { useAuth } from "../context/AuthContext";
import { api } from "../api/client";
import AIAssistant from "../components/AIAssistant";
import PMCheckSheetAdmin from "./PMCheckSheetAdmin";
import MachineDMCAdmin from "./MachineDMCAdmin";
import {
  PageHeading, Card, Pill, Btn, FF, Input, Select,
  Modal, ModalActions, Toast, EmptyState, Spinner, ExcelImportButton, useToast,
} from "./admin/ui";
// mailconfig.jsx ab sirf Users page ke permission-constants ke liye zinda hai
// (ROLE_PILL / PAGE_PERM_GROUPS / PERM_LEVELS — org.jsx unhe import karta hai).
import { UsersPage } from "./admin/org";
import { KpiTargetsPage } from "./admin/mail-kpi";
import { ADMIN_SECTIONS } from "./admin/system";
import { SlipThresholdPage } from "./admin/slipthreshold";
import { LoginHistoryPage } from "./admin/loginhistory";

// Render a tab's body.  Centralised so AdminPanel and DepartmentPanel
// stay perfectly in sync — DepartmentPanel re-uses this same dispatch.
export function renderAdminTab(sectionKey, tabKey, props) {
  const t = props || {};
  switch (`${sectionKey}/${tabKey}`) {
    case "maintenance/kpitarget":    return <KpiTargetsPage  {...t} readOnly={false} />;
    case "maintenance/slipthreshold": return <SlipThresholdPage {...t} />;
    case "maintenance/pmchecksheet": return <PMCheckSheetAdmin {...t} />;
    case "maintenance/machinedmc":   return <MachineDMCAdmin   {...t} />;
    case "admin/users":
    case "maintenance/users": return <UsersPage       {...t} />;
    case "maintenance/loginhistory": return <LoginHistoryPage {...t} />;
    default: return null;
  }
}

function _QualityPlaceholder() {
  return (
    <Card>
      <div style={{padding:"40px 30px",textAlign:"center"}}>
        <div style={{fontSize:48,marginBottom:14}}>🛠</div>
        <div style={{fontSize:16,fontWeight:700,color:"#0f172a",marginBottom:6}}>
          Quality Panel — coming soon
        </div>
        <div style={{fontSize:12,color:"#64748b",maxWidth:480,margin:"0 auto"}}>
          The Quality department's interaction surface (CTQ / NCR / dock-audit / 5S etc.)
          will be wired up once the workflow is finalised.
        </div>
      </div>
    </Card>
  );
}


// Inline shared CSS used by both AdminPanel (full-write) and DepartmentPanel
// (read-only mirror).  Kept here so the two shells render identically.
export const ADMIN_PANEL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700;800&family=Barlow+Condensed:wght@700;800&display=swap');
  .admin-root { min-height:100vh; background:#f8fafc; font-family:'Barlow',sans-serif; padding-bottom:60px; }
  .admin-topbar { background:#fff; border-bottom:1px solid #e2e8f0; padding:0 40px 0 88px; height:60px; display:flex; align-items:center; justify-content:space-between; position:sticky; top:0; z-index:100; box-shadow:0 1px 3px rgba(0,0,0,.06); }
  .admin-topbar::after { content:''; position:absolute; bottom:0; left:0; right:0; height:2px; }
  .admin-logo { font-family:'Barlow Condensed',sans-serif; font-size:22px; font-weight:800; color:#0f172a; }

  /* Section bar — Production / Maintenance / Quality / Admin */
  .admin-sections { background:#fff; border-bottom:1px solid #e2e8f0; padding:0 40px 0 88px; display:flex; gap:0; position:sticky; top:60px; z-index:99; }
  .admin-section-btn { padding:14px 22px; font-family:'Barlow Condensed',sans-serif; font-size:14px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; cursor:pointer; border:none; background:none; color:#94a3b8; border-bottom:3px solid transparent; margin-bottom:-1px; transition:all .12s; display:flex; align-items:center; gap:8px; white-space:nowrap; }
  .admin-section-btn:hover { color:#334155; }
  .admin-section-btn.active { color:#0f172a; }
  .admin-section-btn .pip { width:8px; height:8px; border-radius:99px; background:#cbd5e1; }
  .admin-section-btn.active .pip { background: var(--sec-color, #1e40af); }

  /* Sub-tabs strip */
  .admin-tabs { background:#fff; border-bottom:1px solid #e2e8f0; padding:0 40px 0 88px; display:flex; gap:0; overflow-x:auto; position:sticky; top:114px; z-index:98; }
  .admin-tab { padding:11px 18px; font-family:'Barlow',sans-serif; font-size:12.5px; font-weight:600; cursor:pointer; border:none; background:none; color:#64748b; border-bottom:2px solid transparent; margin-bottom:-1px; transition:all .12s; display:flex; align-items:center; gap:7px; white-space:nowrap; }
  .admin-tab:hover { color:#334155; }
  .admin-tab.active { color: var(--sec-color, #1e40af); border-bottom-color: var(--sec-color, #1e40af); }
  .admin-body { padding:30px 40px 0; max-width:1180px; margin:0 auto; }

  /* Read-only mode — Department / Production users see the same panels
     but every create/update/delete affordance is hidden so they truly
     can't trigger any mutation. Three rules cover ~all CUD UI:
       1. Btn variant primary/danger/success (Add / Save / Delete)
       2. Every button inside a tbody row (Edit / Deactivate / Acknowledge)
          — always row-level mutations in this app
       3. Header-area "Add" / "+ New" buttons in flex-end toolbars are
          variant=primary so rule 1 catches them.
     Inputs are pointer-events:none so even the rare button that slips
     through can't actually mutate; SELECT / CHECKBOX / RADIO are also
     locked.  Tab-bar and modal-close buttons (raw <button>, no Btn)
     stay clickable.                                                  */
  .ap-readonly button[data-variant="primary"],
  .ap-readonly button[data-variant="danger"],
  .ap-readonly button[data-variant="success"] { display: none !important; }
  .ap-readonly tbody button,
  .ap-readonly tbody a[role="button"],
  .ap-readonly tbody input[type="button"],
  .ap-readonly tbody input[type="submit"] { display: none !important; }
  .ap-readonly input:not([type="checkbox"]):not([type="radio"]),
  .ap-readonly select,
  .ap-readonly textarea { pointer-events: none !important; background:#f8fafc !important; color:#475569 !important; }
  .ap-readonly input[type="checkbox"],
  .ap-readonly input[type="radio"] { pointer-events: none !important; opacity: .55; }
  /* Common file-upload / Excel-import buttons render as <label> instead
     of <button> — hide those too so dept users can't push data in. */
  .ap-readonly label[role="button"],
  .ap-readonly .excel-import-btn,
  .ap-readonly .excel-import-label { display: none !important; }
`;

// Shared shell renderer — used by AdminPanel (full-write) and
// DepartmentPanel (read-only).  `sections` lets DepartmentPanel filter
// to just the section(s) the user's department is allowed to see.
export function AdminShell({
  title,
  accent = "#1e40af",
  sections: rawSections = ADMIN_SECTIONS,
  readOnly = false,
  rightTopbar = null,
}) {
  const { isAdmin } = useAuth();
  const [showToast, toastEl] = useToast();

  // adminOnly tabs (jaise "Users & Access") sirf admin ko dikhte hain.  Agar
  // koi non-admin ko "Maintenance Panel" grant ho jaye, tab bhi user-management
  // tab hidden rahe — warna wo khud ko admin bana sakta tha (privilege hole).
  const sections = rawSections.map(s => ({
    ...s, tabs: s.tabs.filter(t => !t.adminOnly || isAdmin),
  }));

  // URL hash format: #<section>/<tab> e.g. "#maintenance/pokayoke"
  const parseHash = () => {
    const h = (typeof window !== "undefined" ? window.location.hash : "").replace(/^#/, "");
    const [s, t] = h.split("/");
    const sec = sections.find(x => x.key === s) || sections[0];
    const tab = sec.tabs.find(x => x.key === t) || sec.tabs[0];
    return { section: sec.key, tab: tab.key };
  };
  const [active, setActive] = useState(parseHash);

  useEffect(() => { document.title = title; }, [title]);

  useEffect(() => {
    const want = `#${active.section}/${active.tab}`;
    if (window.location.hash !== want) {
      window.history.replaceState(null, "", window.location.pathname + want);
    }
  }, [active]);

  useEffect(() => {
    const onHash = () => {
      const next = parseHash();
      setActive(prev => (prev.section !== next.section || prev.tab !== next.tab) ? next : prev);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [sections]); // eslint-disable-line

  const sec = sections.find(s => s.key === active.section) || sections[0];
  // Always prefer the caller-supplied accent (which is theme.accent —
  // role-aware) over the section's hardcoded color.  Admin's blue then
  // overrides green/red/yellow when admin views a Production /
  // Maintenance / Quality panel; dept users on their own panel still
  // get their dept colour because their theme.accent is the dept colour.
  const secColor = accent || sec.color;
  const cssVars = { "--sec-color": secColor };

  const onPickSection = (k) => {
    const newSec = sections.find(s => s.key === k);
    if (!newSec) return;
    setActive({ section: k, tab: newSec.tabs[0].key });
  };

  // When the shell is rendered with exactly ONE section we hide the
  // section bar — the slide-nav already routed the user to a dedicated
  // page (Production / Maintenance / Quality / Admin) so the second
  // level of grouping is redundant.  The sub-tabs strip stays.
  const showSectionBar = sections.length > 1;

  return (
    <>
      <style>{ADMIN_PANEL_CSS}</style>

      <div className={`admin-root${readOnly ? " ap-readonly" : ""}`} style={cssVars}>
        <div className="admin-topbar" style={{ borderBottomColor:"#e2e8f0" }}>
          <div className="admin-logo">
            <span style={{ color: secColor }}>{title}</span>
          </div>
          {rightTopbar}
          <div style={{
            position:"absolute", bottom:0, left:0, right:0, height:2,
            background:`linear-gradient(90deg, ${secColor}, ${secColor}aa, ${secColor}55)`
          }}/>
        </div>

        {showSectionBar && (
          <div className="admin-sections">
            {sections.map(s => (
              <button
                key={s.key}
                className={`admin-section-btn${active.section === s.key ? " active" : ""}`}
                style={active.section === s.key ? { "--sec-color": s.color } : undefined}
                onClick={() => onPickSection(s.key)}
              >
                <span className="pip" style={active.section === s.key ? { background:s.color } : undefined}/>
                {s.label}
              </button>
            ))}
          </div>
        )}

        <div className="admin-tabs" style={!showSectionBar ? { top: 60 } : undefined}>
          {sec.tabs.map(t => (
            <button
              key={t.key}
              className={`admin-tab${active.tab === t.key ? " active" : ""}`}
              onClick={() => setActive(a => ({ ...a, tab: t.key }))}
            >
              <span>{t.icon}</span> {t.label}
            </button>
          ))}
        </div>

        <div className="admin-body">
          {renderAdminTab(active.section, active.tab, { toast: showToast, readOnly })}
        </div>
      </div>

      {toastEl}
    </>
  );
}

// ─── Per-section dedicated panel pages ────────────────────────
// Each is its own slide-nav entry / route so the user picks the panel
// up front and lands directly on its sub-tabs.  Internally they all
// reuse AdminShell with a single section in `sections`, which hides
// the section bar (only the sub-tab strip shows).
//
// Access matrix (also enforced by canAccess + Protected):
//   admin / plant_head : sees all 4 panels, full write, blue theme
//                        (because theme.accent = blue for admin)
//   production user    : sees Production Panel, read-only, green theme
//   maintenance dept   : sees Maintenance Panel, read-only, red theme
//   quality dept       : sees Quality Panel, read-only, yellow theme
//
// The accent is taken from `theme.accent` so each role gets its own
// colouring automatically; admin's blue overrides the section's hard-
// coded color since theme always wins.

// Wrap a per-section AdminShell with role-aware theme + readOnly.
// `sectionKey` picks which slice of ADMIN_SECTIONS to render.
// `editable` forces full-write for everyone who can reach this panel (not
// just admins).  Used by the Maintenance Panel so department maintenance
// users can edit, while Production / Quality stay read-only for non-admins.
function _RoleScopedShell({ title, sectionKey, page, editable = false, accessKey }) {
  const { theme, isAdmin, canWrite } = useAuth();
  const sec = ADMIN_SECTIONS.filter(s => s.key === sectionKey);
  // editable panel (Maintenance): admin → full edit; jis non-admin ko panel
  // grant hua uski level (full=edit, read=read-only).  Baaki panels: non-admin read-only.
  const readOnly = editable ? (!isAdmin && !(accessKey && canWrite(accessKey))) : !isAdmin;
  return (
    <>
      <AdminShell
        title={title}
        accent={theme.accent}
        sections={sec}
        readOnly={readOnly}
        rightTopbar={readOnly ? (
          <span style={{
            padding:"3px 10px", background:"#fef3c7", color:"#854d0e",
            borderRadius:99, fontSize:10, fontWeight:700,
            letterSpacing:".1em", textTransform:"uppercase",
          }}>Read-only</span>
        ) : null}
      />
      <AIAssistant pageContext={{ page }} />
    </>
  );
}

export function ProductionAdminPanel() {
  return <_RoleScopedShell title="Production Panel"  sectionKey="production"  page="ProductionAdminPanel" />;
}
export function MaintenanceAdminPanel() {
  return <_RoleScopedShell title="Maintenance Panel" sectionKey="maintenance" page="MaintenanceAdminPanel" editable accessKey="admin-maintenance" />;
}
export function QualityAdminPanel() {
  return <_RoleScopedShell title="Quality Panel"     sectionKey="quality"     page="QualityAdminPanel" />;
}

// Default export = the "Admin core" panel (System Map / Departments /
// Users).  Strictly admin-only — the route gate (requiredAccess="admin")
// already blocks non-admins, so we never show readOnly state here.
export default function AdminPanel() {
  const { theme } = useAuth();
  const sec = ADMIN_SECTIONS.filter(s => s.key === "admin");
  return (
    <>
      <AdminShell title="Admin Panel" accent={theme.accent} sections={sec} />
      <AIAssistant pageContext={{ page: "AdminPanel" }} />
    </>
  );
}
