import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { DisplayProvider } from "./context/DisplayContext";
import Layout from "./components/Layout";
import AndonAlert from "./components/AndonAlert";
import { NewBreakdownSlip } from "./pages/breakdown/NewBreakdownSlip";
import ProductionBreakdownSlip from "./pages/ProductionBreakdownSlip";

// ─── Pages — MAINTENANCE-ONLY SLICE ─────────────────────────────────────────
// This is a standalone copy of the Maintenance department UI extracted from
// the full MES.  Only the maintenance pages (+ Login + the Maintenance admin
// panel) are bundled here.  The shared SlideNav still lists every department,
// but only maintenance routes exist — other links bounce back to /dashboard.
import Login                 from "./pages/Login";
import MaintenanceDashboard  from "./pages/MaintenanceDashboard";
import MaintenanceHistorical from "./pages/MaintenanceHistorical";
import MaintenanceCAPA       from "./pages/MaintenanceCAPA";
import MaintenanceDeviations from "./pages/MaintenanceDeviations";
import PMPanel               from "./pages/PMPanel";
import MaintenanceKPI        from "./pages/MaintenanceKPI";
import MaintenanceOverview   from "./pages/MaintenanceOverview";
import AndonSystem           from "./pages/AndonSystem";
import MaintenanceBreakdown  from "./pages/MaintenanceBreakdown";
import BDHistory             from "./pages/BDHistory";
import BreakdownLogBook      from "./pages/BreakdownLogBook";
import BDAnalysis            from "./pages/BDAnalysis";
import HistoryCard           from "./pages/HistoryCard";
import QPRForm               from "./pages/QPRForm";
import ParetoAnalysis        from "./pages/ParetoAnalysis";
import TopBreakdowns         from "./pages/TopBreakdowns";
import UpdatePlan, { UpdatePlanSection } from "./pages/UpdatePlan";
import SkillTraining         from "./pages/SkillTraining";
import OJT                   from "./pages/OJT";
import SkillMatrix           from "./pages/SkillMatrix";
import OrganisationChart     from "./pages/OrganisationChart";
import SkillUpgradation      from "./pages/SkillUpgradation";
import MachineManual         from "./pages/MachineManual";
import MachineDMC            from "./pages/MachineDMC";
import DailyDMCFill          from "./pages/DailyDMCFill";
import DMCSupervisorVerify   from "./pages/DMCSupervisorVerify";
import DMCMaintenanceVerify  from "./pages/DMCMaintenanceVerify";
import DMCNgPoint            from "./pages/DMCNgPoint";
import Spare                 from "./pages/Spare";
import { MaintenanceAdminPanel } from "./pages/AdminPanel";

// ─── Protected Route ───────────────────────────────────────────────────────
// Redirects to /login if not authenticated, or to /dashboard if the role
// doesn't have access to the page.  (Unchanged from the full app.)
function Protected({ children, requiredAccess, bare = false }) {
  const { token, loading, canAccess } = useAuth();
  const location = useLocation();

  if (loading) return (
    <div style={{
      height: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "#f8fafc", color: "#64748b", fontSize: 14,
    }}>
      <div style={{ textAlign: "center" }}>
        <div className="spinner" style={{
          width: 32, height: 32, borderRadius: "50%",
          border: "3px solid #e2e8f0", borderTopColor: "#1e40af",
          animation: "spin 0.6s linear infinite",
          margin: "0 auto 12px",
        }} />
        Loading…
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );

  if (!token) return <Navigate to="/login" state={{ from: location }} replace />;

  if (requiredAccess && !canAccess(requiredAccess)) {
    // "dashboard" hi fallback target hai — agar wahi allowed nahi to redirect
    // loop na ho: friendly "no access" dikhao (sidebar ke saath, taaki jo
    // pages user ko mile hain unpar wo jaa sake).
    if (requiredAccess === "dashboard") {
      return <Layout><div style={{ padding: 48, textAlign: "center", color: "#64748b" }}>
        <div style={{ fontSize: 44, marginBottom: 12 }}>🔒</div>
        <h2 style={{ color: "#0f172a", margin: "0 0 8px" }}>Koi page assign nahi</h2>
        <p style={{ maxWidth: 460, margin: "0 auto" }}>Aapko abhi koi page assign nahi hua. Admin se apne pages
          assign karwayein (Maintenance Panel → Admin → Users). Jo pages milenge wo left sidebar me dikhenge.</p>
      </div></Layout>;
    }
    return <Navigate to="/dashboard" replace />;
  }

  return bare ? children : <Layout>{children}</Layout>;
}

// ─── Root redirect ──────────────────────────────────────────────────────────
function RootRedirect() {
  const { token, loading } = useAuth();
  if (loading) return null;
  if (!token) return <Navigate to="/login" replace />;
  return <Navigate to="/dashboard" replace />;
}

function BreakdownSlipRoute() {
  const { token } = useAuth();
  const nav = useNavigate();
  return (
    <NewBreakdownSlip
      token={token}
      onSaved={() => alert("✓ Break Down Slip save ho gayi.")}
      onClose={() => nav("/maintenance-breakdown", { replace: true })}
    />
  );
}

// ─── Routes ───────────────────────────────────────────────────────────────
function AppRoutes() {
  return (
    <>
      <AndonAlert />
      <Routes>
      {/* Public */}
      <Route path="/login" element={<Login />} />

      {/* Root → smart redirect */}
      <Route path="/" element={<RootRedirect />} />

      {/* Maintenance landing dashboard (ANDON, history, stats). */}
      <Route path="/dashboard" element={
        <Protected requiredAccess="dashboard"><MaintenanceDashboard /></Protected>
      } />
      <Route path="/maintenance-dashboard" element={
        <Protected requiredAccess="maintenance-dashboard"><MaintenanceDashboard /></Protected>
      } />

      {/* Update Plan — landing with the six plan sections. */}
      <Route path="/maintenance-update-plan" element={
        <Protected requiredAccess="maintenance-update-plan"><UpdatePlan /></Protected>
      } />
      {/* Update Plan → one section (Preventive Yearly/Monthly, Predictive,
          Sunday, Shutdown, Daily Work Assign) — placeholders for now. */}
      <Route path="/maintenance-update-plan/:section" element={
        <Protected requiredAccess="maintenance-update-plan"><UpdatePlanSection /></Protected>
      } />
      {/* Maintenance Historical Data — slip archive + MTTR / MTBF / LTTR. */}
      <Route path="/maintenance-historical" element={
        <Protected requiredAccess="maintenance-historical"><MaintenanceHistorical /></Protected>
      } />

      {/* Log Book — maintenance log-book entry form (rebuilt). */}
      <Route path="/maintenance-logbook" element={
        <Protected requiredAccess="maintenance-logbook"><BreakdownLogBook /></Protected>
      } />
      {/* History Card — zone-wise machine history (now a top-level sidebar page). */}
      <Route path="/maintenance-history-card" element={
        <Protected requiredAccess="maintenance-history-card"><HistoryCard /></Protected>
      } />

      {/* Preventive Maintenance check sheets (/api/pm/*). */}
      <Route path="/maintenance-pm" element={
        <Protected requiredAccess="maintenance-pm"><PMPanel /></Protected>
      } />

      {/* Maintenance Overview — management dashboard (KPI tiles + charts, our data). */}
      <Route path="/maintenance-overview" element={
        <Protected requiredAccess="maintenance-overview"><MaintenanceOverview /></Protected>
      } />

      {/* ANDON Management System — standalone module (config · live board · reports). */}
      <Route path="/andon-system" element={
        <Protected requiredAccess="andon-system"><AndonSystem /></Protected>
      } />

      {/* Maintenance KPI — financial-year headline cards (MTTR/MTBF/LTTR…). */}
      <Route path="/maintenance-kpi" element={
        <Protected requiredAccess="maintenance-kpi"><MaintenanceKPI /></Protected>
      } />

      {/* Breakdown — landing page with BD History / Analysis / Log Book / … buttons. */}
      <Route path="/maintenance-breakdown" element={
        <Protected requiredAccess="maintenance-breakdown"><MaintenanceBreakdown /></Protected>
      } />
      {/* Breakdown Slip — direct sidebar entry: opens the blank fillable slip. */}
      <Route path="/maintenance-breakdown/new-slip" element={
        <Protected requiredAccess="maintenance-breakdown-slip"><BreakdownSlipRoute /></Protected>
      } />
      {/* Production Breakdown Slip — 2-stage (Production half → Maintenance complete). */}
      <Route path="/production-breakdown-slip" element={
        <Protected requiredAccess="maintenance-breakdown-slip"><ProductionBreakdownSlip /></Protected>
      } />
      {/* Breakdown → BD History — read-only list of "Breakdown" entries. */}
      <Route path="/maintenance-breakdown/bd-history" element={
        <Protected requiredAccess="maintenance-breakdown-history"><BDHistory /></Protected>
      } />
      {/* Breakdown → BD Analysis — auto-generated breakdown charts from the log book. */}
      <Route path="/maintenance-breakdown/bd-analysis" element={
        <Protected requiredAccess="maintenance-breakdown-analysis"><BDAnalysis /></Protected>
      } />
      {/* Breakdown → Pareto Analysis — machine down-time Pareto (losses + CUMM%). */}
      <Route path="/maintenance-breakdown/pareto-analysis" element={
        <Protected requiredAccess="maintenance-breakdown-pareto"><ParetoAnalysis /></Protected>
      } />
      {/* Breakdown → Top 10 BD — ranked worst offenders (same filter bar). */}
      <Route path="/maintenance-breakdown/top-10" element={
        <Protected requiredAccess="maintenance-breakdown-top10"><TopBreakdowns /></Protected>
      } />
      {/* CAPA → QPR sheet (full fillable format) — opened by "Start CAPA" /
          "View" on the CAPA page; the standalone QPR register was removed. */}
      <Route path="/maintenance-breakdown/qpr/:id" element={
        <Protected requiredAccess="maintenance-breakdown"><QPRForm /></Protected>
      } />

      {/* Skill & Training — landing page with OJT / Skill Matrix / Org Chart / … buttons. */}
      <Route path="/skill-training" element={
        <Protected requiredAccess="skill-training"><SkillTraining /></Protected>
      } />
      {/* Skill & Training → OJT — On-the-Job Training record sheet. */}
      <Route path="/skill-training/ojt" element={
        <Protected requiredAccess="skill-ojt"><OJT /></Protected>
      } />
      {/* Skill & Training → Skill Matrix — maintenance flexibility chart. */}
      <Route path="/skill-training/skill-matrix" element={
        <Protected requiredAccess="skill-matrix"><SkillMatrix /></Protected>
      } />
      {/* Skill & Training → Organisation Chart — department org chart. */}
      <Route path="/skill-training/org-chart" element={
        <Protected requiredAccess="skill-org-chart"><OrganisationChart /></Protected>
      } />
      {/* Skill & Training → Skill Upgradation Plan — tooling training plan. */}
      <Route path="/skill-training/skill-upgradation" element={
        <Protected requiredAccess="skill-upgradation"><SkillUpgradation /></Protected>
      } />

      {/* Maintenance CAPA — threshold breaches + 8D corrective/preventive. */}
      <Route path="/maintenance-capa" element={
        <Protected requiredAccess="maintenance-capa"><MaintenanceCAPA /></Protected>
      } />

      {/* Maintenance Deviations — raise + track deviation requests. */}
      <Route path="/maintenance-deviations" element={
        <Protected requiredAccess="maintenance-deviations"><MaintenanceDeviations /></Protected>
      } />

      {/* Machine Manual — pick a machine → view / upload its PDF manual. */}
      <Route path="/maintenance-machine-manual" element={
        <Protected requiredAccess="maintenance-machine-manual"><MachineManual /></Protected>
      } />
      <Route path="/maintenance-machine-dmc" element={
        <Protected requiredAccess="maintenance-machine-dmc"><MachineDMC /></Protected>
      } />
      {/* Daily DMC Fill — operator fills the monthly DMC check sheet. */}
      <Route path="/maintenance-daily-dmc" element={
        <Protected requiredAccess="maintenance-daily-dmc"><DailyDMCFill /></Protected>
      } />
      {/* Machine DMC → Supervisor Verify — stage 2: supervisor signs off a date. */}
      <Route path="/maintenance-dmc-verify" element={
        <Protected requiredAccess="maintenance-dmc-verify"><DMCSupervisorVerify /></Protected>
      } />
      {/* Machine DMC → Maintenance Weekly — stage 3: maintenance signs a week. */}
      <Route path="/maintenance-dmc-weekly" element={
        <Protected requiredAccess="maintenance-dmc-weekly"><DMCMaintenanceVerify /></Protected>
      } />
      {/* Machine DMC → DMC NG Point — ✗ register with corrective action / close. */}
      <Route path="/maintenance-dmc-ng" element={
        <Protected requiredAccess="maintenance-dmc-ng"><DMCNgPoint /></Protected>
      } />
      {/* Spare — spare details (placeholder; content TBD). */}
      <Route path="/maintenance-spare" element={
        <Protected requiredAccess="maintenance-spare"><Spare /></Protected>
      } />

      {/* Maintenance admin panel (KPI targets, mail config, PY master, etc.). */}
      <Route path="/admin/maintenance" element={
        <Protected requiredAccess="admin-maintenance"><MaintenanceAdminPanel /></Protected>
      } />

      {/* Catch-all → root (other-department links from SlideNav land here). */}
      <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <DisplayProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </DisplayProvider>
    </AuthProvider>
  );
}
