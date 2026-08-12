import { useState, useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

// Static nav structure.  The Department Panel item is injected
// dynamically below because its label depends on the logged-in
// department user's department name.
// Static nav structure.  The "Department" / "Maintenance" sections are
// injected dynamically below depending on the logged-in user's role.
//
// "Production" gathers the Production-side flow: live dashboard + the
// historical record browser + bulk Excel import/export.  The old
// "Overview" + "Data" sections were merged into this single Production
// section so the slide-nav reads as a clean role-grouped list.
const NAV_ITEMS = [
  // Maintenance-only deployment.  "Maintenance" section (saare maintenance
  // pages) navItems ke andar inject hoti hai; yahan sirf Admin section hai.
  {
    // adminOnly hata diya — ab "Maintenance Panel" `canAccess("admin-maintenance")`
    // se filter hota hai: admin ko hamesha, aur jis non-admin ko admin ne grant
    // kiya usko bhi dikhta hai.  (Users & Access tab andar admin-only hi rehta hai.)
    section: "Admin",
    items: [
      { key: "admin-maintenance", label: "Maintenance Panel", icon: "🛠", path: "/admin/maintenance" },
    ],
  },
];

export default function SlideNav() {
  const [open, setOpen] = useState(false);
  const { user, logout, canAccess, isAdmin, theme } = useAuth();
  const navigate  = useNavigate();
  const location  = useLocation();
  const panelRef  = useRef(null);

  // Admin-only app: NAV_ITEMS ke saath ek "Maintenance" section inject
  // karte hain jisme saare maintenance pages hote hain.
  const navItems = (() => {
    if (isAdmin) {
      const adminMaint = {
        section: "Maintenance",
        items: [
          { key: "maintenance-overview",    label: "Overview",             icon: "📈",                   path: "/maintenance-overview" },
          { key: "andon-system",            label: "ANDON",                icon: "🚦",                   path: "/andon-system" },
          { key: "maintenance-update-plan", label: "Update Plan",           icon: "📝",                   path: "/maintenance-update-plan" },
          { key: "maintenance-dashboard",   label: "Maintenance Dashboard", icon: "/dashboard-icon.png",  iconImg: true, path: "/maintenance-dashboard" },
          { key: "maintenance-kpi",         label: "Maintenance KPI",       icon: "📊",                   path: "/maintenance-kpi" },
          { key: "maintenance-breakdown",   label: "Breakdown",             icon: "🚨",                   path: "/maintenance-breakdown" },
          // "Breakdown Slip" sidebar item removed — the manual slip is opened
          // from the Breakdown page itself (its own button), so a separate
          // sidebar entry was a duplicate.  Route /maintenance-breakdown/new-slip
          // still works if reached directly.
          { key: "skill-training",          label: "Skill & Training",      icon: "🎓",                   path: "/skill-training" },
          { key: "maintenance-historical",  label: "Historical Data",       icon: "/historical-icon.png", iconImg: true, path: "/maintenance-historical" },
          { key: "maintenance-capa",        label: "CAPA",                  icon: "🛡",                   path: "/maintenance-capa" },
          { key: "maintenance-deviations",  label: "Deviations",            icon: "⚠",                    path: "/maintenance-deviations" },
          { key: "maintenance-logbook",     label: "Log Book",              icon: "📒",                   path: "/maintenance-logbook" },
          { key: "maintenance-history-card", label: "History Card",         icon: "🗂",                   path: "/maintenance-history-card" },
          { key: "maintenance-pm",          label: "Preventive Maint.",     icon: "🛠",                   path: "/maintenance-pm" },
          { key: "maintenance-machine-manual", label: "Machine Manual",     icon: "📖",                   path: "/maintenance-machine-manual" },
          { key: "maintenance-machine-dmc",    label: "Machine DMC",        icon: "🏷",                   path: "/maintenance-machine-dmc" },
          { key: "maintenance-spare",          label: "Spare",              icon: "🔩",                   path: "/maintenance-spare" },
          { key: "maintenance-plc",            label: "PLC Integration",    icon: "🔌",                   path: "/maintenance-plc" },
        ],
      };
      return [adminMaint, ...NAV_ITEMS];
    }
    // Non-admin (supervisor/engineer/…) ko bhi poori Maintenance section milti
    // hai — har item `canAccess(item.key)` se filter hota hai (line ~252), to
    // sirf granted pages hi dikhte hain.  Pehle ye `if (isAdmin)` ke andar tha
    // jisse non-admin ko koi maintenance page hi nahi milta tha (bug).
    const adminMaint = {
      section: "Maintenance",
      items: [
        { key: "maintenance-overview",    label: "Overview",             icon: "📈",                   path: "/maintenance-overview" },
        { key: "andon-system",            label: "ANDON",                icon: "🚦",                   path: "/andon-system" },
        { key: "maintenance-update-plan", label: "Update Plan",           icon: "📝",                   path: "/maintenance-update-plan" },
        { key: "maintenance-dashboard",   label: "Maintenance Dashboard", icon: "/dashboard-icon.png",  iconImg: true, path: "/maintenance-dashboard" },
        { key: "maintenance-kpi",         label: "Maintenance KPI",       icon: "📊",                   path: "/maintenance-kpi" },
        { key: "maintenance-breakdown",   label: "Breakdown",             icon: "🚨",                   path: "/maintenance-breakdown" },
        { key: "skill-training",          label: "Skill & Training",      icon: "🎓",                   path: "/skill-training" },
        { key: "maintenance-historical",  label: "Historical Data",       icon: "/historical-icon.png", iconImg: true, path: "/maintenance-historical" },
        { key: "maintenance-capa",        label: "CAPA",                  icon: "🛡",                   path: "/maintenance-capa" },
        { key: "maintenance-deviations",  label: "Deviations",            icon: "⚠",                    path: "/maintenance-deviations" },
        { key: "maintenance-logbook",     label: "Log Book",              icon: "📒",                   path: "/maintenance-logbook" },
        { key: "maintenance-history-card", label: "History Card",         icon: "🗂",                   path: "/maintenance-history-card" },
        { key: "maintenance-pm",          label: "Preventive Maint.",     icon: "🛠",                   path: "/maintenance-pm" },
        { key: "maintenance-machine-manual", label: "Machine Manual",     icon: "📖",                   path: "/maintenance-machine-manual" },
        { key: "maintenance-machine-dmc",    label: "Machine DMC",        icon: "🏷",                   path: "/maintenance-machine-dmc" },
        { key: "maintenance-spare",          label: "Spare",              icon: "🔩",                   path: "/maintenance-spare" },
        { key: "maintenance-plc",            label: "PLC Integration",    icon: "🔌",                   path: "/maintenance-plc" },
      ],
    };
    return [adminMaint, ...NAV_ITEMS];
  })();

  // Close on outside click
  useEffect(() => {
    function handler(e) {
      if (open && panelRef.current && !panelRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    function handler(e) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const go = (path) => { navigate(path); setOpen(false); };

  const isActive = (path) => {
    // The four /admin/* panels each get their own slide-nav row, so we
    // need *exact* path matches there — otherwise "/admin/production"
    // would also light up the bare "Admin Panel" row (since it
    // startsWith "/admin").
    if (path === "/admin")                   return location.pathname === "/admin";
    if (path === "/admin/production")        return location.pathname === "/admin/production";
    if (path === "/admin/maintenance")       return location.pathname === "/admin/maintenance";
    if (path === "/admin/quality")           return location.pathname === "/admin/quality";
    if (path === "/department-panel")        return location.pathname.startsWith("/department-panel");
    if (path === "/maintenance-dashboard")   return location.pathname.startsWith("/maintenance-dashboard");
    if (path === "/maintenance-kpi")         return location.pathname.startsWith("/maintenance-kpi");
    if (path === "/maintenance-historical")  return location.pathname.startsWith("/maintenance-historical");
    if (path === "/maintenance-capa")        return location.pathname.startsWith("/maintenance-capa");
    if (path === "/maintenance-deviations")  return location.pathname.startsWith("/maintenance-deviations");
    if (path === "/process-graphs")          return location.pathname.startsWith("/process-graphs");
    if (path === "/quality-dashboard")       return location.pathname.startsWith("/quality-dashboard");
    if (path === "/quality-deviations")      return location.pathname.startsWith("/quality-deviations");
    if (path === "/comments-history")        return location.pathname.startsWith("/comments-history");
    return location.pathname === path;
  };

  const roleLabel = () => {
   if (!user) return "";
   if (user.role === "admin")      return "Administrator";
   if (user.role === "plant_head") return "Plant Head";
   if (user.role === "department") return user.departmentName
                                            ? `${user.departmentName} Department`
                                            : "Department";
   if (user.role === "production") return "Production User";
   if (user.role === "operator")   return "Operator";
   return user.role;
  };

  return (
    <>
      {/* ── Floating Logo Button ── */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: open ? "none" : "flex",
          position: "fixed",
          top: 13,
          left: 30,
          width: 45,
          height: 45,
          borderRadius: "40%",
          border: "none",
          padding: 0,
          cursor: "pointer",
          zIndex: 1000,
          boxShadow: open
            ? `0 0 0 3px ${theme.accent}, 0 8px 32px rgba(0,0,0,0.2)`
            : "0 2px 12px rgba(0,0,0,0.15)",
          transition: "box-shadow 0.2s ease, transform 0.2s ease",
          transform: open ? "scale(1.08)" : "scale(1)",
          overflow: "hidden",
          background: "#ffffff",
        }}
        aria-label="Toggle navigation"
      >
        <img
          src="/logo.jpg"
          alt=""
          style={{ width: "100%", height: "100%", objectFit: "contain" }}
          onError={e => { e.target.style.display = "none"; }}
        />
      </button>

      {/* ── Backdrop ── */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: "fixed", inset: 0,
            background: "rgba(0,0,0,0.4)",
            backdropFilter: "blur(2px)",
            zIndex: 998,
            animation: "fadeIn 0.15s ease",
          }}
        />
      )}

      {/* ── Slide Panel ── */}
      <div
        ref={panelRef}
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: 260,
          height: "calc(100vh - 0px)",
          background: "var(--bg-secondary, #ffffff)",
          borderRight: "1px solid var(--border, #e2e8f0)",
          boxShadow: "4px 0 32px rgba(0,0,0,0.15)",
          zIndex: 999,
          display: "flex",
          flexDirection: "column",
          transform: open ? "translateX(0)" : "translateX(-100%)",
          transition: "transform 0.28s cubic-bezier(0.16,1,0.3,1)",
        }}
      >
        {/* Header */}
        <div style={{
          padding: "24px 20px 16px",
          borderBottom: "1px solid var(--border, #e2e8f0)",
          background: `linear-gradient(135deg, ${theme.accentDark}, ${theme.accent})`,
          flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
            <div style={{
              width: 45, height: 45, borderRadius: 10,
              background: "rgba(255,255,255,0.15)",
              border: "1px solid rgba(255,255,255,0.25)",
              overflow: "hidden", flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <img src="/logo.jpg" alt="logo"
                style={{ width: "100%", height: "100%", objectFit: "contain" }}
                onError={e => { e.target.style.display="none"; }}
              />
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>Toyota Boshoku</div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.65)", lineHeight: 1.4 }}>
                Device India
              </div>
            </div>
          </div>

          {/* User info */}
          <div style={{
            background: "rgba(255,255,255,0.1)",
            borderRadius: 8,
            padding: "10px 12px",
            display: "flex", alignItems: "center", gap: 10,
          }}>
            <div style={{
              width: 32, height: 32, borderRadius: "50%",
              background: "rgba(255,255,255,0.2)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 13, fontWeight: 700, color: "#fff", flexShrink: 0,
            }}>
              {user?.username?.[0]?.toUpperCase() || "?"}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {user?.username || "—"}
              </div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.6)" }}>
                {roleLabel()}
              </div>
            </div>
          </div>
        </div>

        {/* Nav items */}
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 0" }}>
          {navItems.map(group => {
            // Hide admin section from non-admins (plant_head is admin-equivalent).
            if (group.adminOnly && !isAdmin) return null;

            // Filter items by role
            const visibleItems = group.items.filter(item => canAccess(item.key));
            if (visibleItems.length === 0) return null;

            return (
              <div key={group.section}>
                <div style={{
                  padding: "12px 20px 6px",
                  fontSize: 10, fontWeight: 700,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: "var(--text-muted, #64748b)",
                }}>
                  {group.section}
                </div>
                {visibleItems.map(item => {
                  const active = isActive(item.path);
                  return (
                    <button
                      key={item.key}
                      onClick={() => go(item.path)}
                      style={{
                        display: "flex", alignItems: "center", gap: 12,
                        width: "calc(100% - 24px)",
                        margin: "2px 12px",
                        padding: "10px 16px",
                        borderRadius: 8,
                        border: active ? `1px solid ${theme.soft.replace(/\.0?\d+\)/, '.25)')}` : "1px solid transparent",
                        background: active ? theme.soft : "transparent",
                        color: active ? theme.accentDark : "var(--text-secondary, #334155)",
                        cursor: "pointer",
                        fontSize: 13, fontWeight: active ? 600 : 500,
                        textAlign: "left",
                        transition: "all 0.12s ease",
                      }}
                      onMouseEnter={e => {
                        if (!active) {
                          e.currentTarget.style.background = "var(--bg-primary, #f8fafc)";
                          e.currentTarget.style.color = "var(--text-primary, #0f172a)";
                        }
                      }}
                      onMouseLeave={e => {
                        if (!active) {
                          e.currentTarget.style.background = "transparent";
                          e.currentTarget.style.color = "var(--text-secondary, #334155)";
                        }
                      }}
                    >
                      <span style={{ width: 20, height: 20, textAlign: "center", fontSize: 15, flexShrink: 0, display:"inline-flex", alignItems:"center", justifyContent:"center" }}>
                        {item.iconImg
                          ? <img src={item.icon} alt="" style={{ width:18, height:18, objectFit:"contain" }}/>
                          : item.icon}
                      </span>
                      {item.label}
                      {active && (
                        <span style={{
                          marginLeft: "auto",
                          width: 6, height: 6, borderRadius: "50%",
                          background: theme.accentDark, flexShrink: 0,
                        }} />
                      )}
                    </button>
                  );
                })}
                <div style={{ height: 1, background: "var(--border, #e2e8f0)", margin: "8px 16px" }} />
              </div>
            );
          })}
        </div>

        {/* Footer — Sign out */}
        <div style={{
          padding: "12px 16px 24px",
          borderTop: "1px solid var(--border, #e2e8f0)",
          flexShrink: 0,
        }}>
          <button
            onClick={logout}
            style={{
              width: "100%", padding: "10px 16px",
              display: "flex", alignItems: "center", gap: 10,
              background: "rgba(220,38,38,0.06)",
              border: "1px solid rgba(220,38,38,0.2)",
              borderRadius: 8, cursor: "pointer",
              color: "#dc2626", fontSize: 13, fontWeight: 500,
              transition: "all 0.12s",
            }}
            onMouseEnter={e => e.currentTarget.style.background = "rgba(220,38,38,0.12)"}
            onMouseLeave={e => e.currentTarget.style.background = "rgba(220,38,38,0.06)"}
          >
            <span style={{ fontSize: 15 }}>↩</span>
            Sign out
          </button>
        </div>
      </div>

      <style>{`
        @keyframes fadeIn { from { opacity:0 } to { opacity:1 } }
      `}</style>
    </>
  );
}
