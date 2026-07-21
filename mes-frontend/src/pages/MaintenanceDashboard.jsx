/* ───────────────────────────────────────────────────────────────────
 * MaintenanceDashboard.jsx
 * ───────────────────────────────────────────────────────────────────
 * Dedicated dashboard for the Maintenance user (route = /dashboard
 * when user.departmentSlug === 'maintenance').  Three sections:
 *
 *   1) ANDON live table  — every breakdown still in state='OPEN'.
 *      Has a Fullscreen button that flips the table to the browser
 *      fullscreen API (uses screen aspect-ratio; sizes to viewport).
 *
 *   2) Recent History (last 2 days) — RESOLVED + CLOSED tickets.
 *      Each row has a "Fill Closure Form" action that opens the
 *      Toyota Boshoku BREAK DOWN SLIP modal (see ClosureFormModal).
 *
 *   3) Zone + Line stats — LTTR (longest repair) per zone + MTTR/MTBF
 *      per line, grouped by zone.
 *
 * Closure form is now fixed to the Toyota Boshoku format
 * (TBDI/MAINT/F/001) — admin no longer configures fields.  Auto-fills
 * the date/shift/line/start/end/duration cells from the breakdown
 * record so the user only types the manual portions.
 *
 * Not built here: the rule that auto-detects when a line goes from
 * Running → Breakdown.  For now, breakdowns are opened manually
 * (via "+ Open Breakdown" button) — the wiring to existing status
 * detection comes when the Maintenance ↔ Quality flow is finalized.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { api, StatCard, fmtDuration } from "./breakdown/shared";
import AndonTable from "./breakdown/AndonTable";
import PmThisMonth from "./breakdown/PmThisMonth";
import KpiPanel from "./breakdown/KpiPanel";
import DmcNgPanel from "./breakdown/DmcNgPanel";
import { ClosureFormModal } from "./breakdown/ClosureFormModal";

/* ════════════════════════════════════════════════════════════════════
 * Toast
 * ════════════════════════════════════════════════════════════════════ */
function useToast() {
  const [t, setT] = useState(null);
  const show = (msg, kind = "ok") => {
    setT({ msg, kind });
    setTimeout(() => setT(null), 2800);
  };
  const node = t ? (
    <div style={{ position: "fixed", bottom: 22, right: 22, zIndex: 9999,
                    padding: "10px 16px", borderRadius: 8,
                    background: t.kind === "err"
                      ? "linear-gradient(135deg,#dc2626,#b91c1c)"
                      : "linear-gradient(135deg,#16a34a,#15803d)",
                    color: "#fff", fontSize: 12, fontWeight: 700,
                    boxShadow: "0 8px 24px rgba(0,0,0,.18)" }}>
      {t.msg}
    </div>
  ) : null;
  return [show, node];
}

/* ════════════════════════════════════════════════════════════════════
 * Page shell
 * ════════════════════════════════════════════════════════════════════ */
export default function MaintenanceDashboard() {
  const { token, user, theme, isAdmin } = useAuth();
  // Admin sees the explicit name ("Maintenance Dashboard") so they can
  // tell at a glance which dept's view they're on.  Department users only
  // see "Dashboard" — they only ever land on their own.
  const titleLeft  = isAdmin ? "Maintenance " : "";
  const titleRight = "Dashboard";
  const [active, setActive]       = useState([]);
  const [recent, setRecent]       = useState([]);
  const [stats,  setStats]        = useState({ zones: [], lines: [] });
  const [lines,  setLines]        = useState([]);  // kept so historical line lookups stay possible
  const [loading, setLoading]     = useState(true);

  const [closureModal, setClosureModal]     = useState(null); // { ticket, mode }

  const [showToast, toastNode]    = useToast();

  // Fullscreen control for the ANDON section
  const andonRef = useRef(null);
  const [isFs, setIsFs] = useState(false);
  useEffect(() => {
    const onChange = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const toggleFullscreen = () => {
    const el = andonRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen?.();
  };

  // Refresh ANDON + history + stats every 10s while the page is mounted.
  //
  // Two-fetch merge into `recent` (the id→full-ticket source the Pending-
  // Breakdown slip list uses to open View/Fill Slip):
  //   • /recent?days=2          → last 2 days of RESOLVED + CLOSED context
  //   • /history?days=180&state=RESOLVED → ANY pending-closure ticket up
  //                                         to 6 months old still awaiting
  //                                         its closure form.
  // The two lists are deduped by id and merged so the same ticket never
  // appears twice.  (The standalone "Recent Breakdowns" table was removed —
  // view/fill now happens from the zone slip list.)
  const reload = useCallback(async () => {
    try {
      const [a, r, pending, s, l] = await Promise.all([
        api.get("/api/breakdowns/active", token).catch(() => []),
        api.get("/api/breakdowns/recent?days=2", token).catch(() => []),
        api.get("/api/breakdowns/history?days=180&state=RESOLVED&limit=500", token).catch(() => ({ rows: [] })),
        api.get("/api/breakdowns/stats?days=30", token).catch(() => ({ zones: [], lines: [] })),
        api.get("/api/lines/", token).catch(() => []),
      ]);
      setActive(Array.isArray(a) ? a : []);

      // Merge recent (last 2 days, both RESOLVED + CLOSED) with all
      // long-pending RESOLVED tickets (those still awaiting closure
      // form).  Dedupe by id — pending may already be inside recent if
      // it's young enough.  Sort by started_at descending.
      const recentArr  = Array.isArray(r) ? r : [];
      const pendArr    = (pending && Array.isArray(pending.rows)) ? pending.rows : [];
      const byId       = new Map();
      [...pendArr, ...recentArr].forEach(row => { if (row && row.id != null) byId.set(row.id, row); });
      const merged = Array.from(byId.values()).sort((x, y) => {
        const xs = x.started_at || ""; const ys = y.started_at || "";
        return ys.localeCompare(xs);
      });
      setRecent(merged);

      setStats(s || { zones: [], lines: [] });
      setLines(Array.isArray(l) ? l : []);
    } catch {
      showToast("Failed to load dashboard", "err");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    reload();
    const t = setInterval(reload, 10000);
    return () => clearInterval(t);
  }, [reload]);

  useEffect(() => {
    document.title = "Maintenance Dashboard";
  }, []);

  // Breakdowns are opened + resolved automatically by the collector based
  // on the line's status bit — no manual buttons on this dashboard.  The
  // only manual step left is filling the closure form for a RESOLVED
  // ticket from the History table below.

  // From the Pending-Breakdown zone slip list: "View Slip" opens that
  // breakdown's BREAK DOWN SLIP.  The KpiPanel rows are lightweight, so we
  // look the FULL ticket up by id in the active + recent (pending-closure)
  // sets the dashboard already holds (recent includes every RESOLVED ticket
  // still awaiting closure, up to 180 days).
  const ticketById = useMemo(() => {
    const m = new Map();
    [...active, ...recent].forEach((t) => { if (t && t.id != null) m.set(t.id, t); });
    return m;
  }, [active, recent]);
  const onViewSlip = (id) => {
    const t = ticketById.get(id);
    if (t) setClosureModal({ ticket: t, mode: "view", phase: "maintenance" });
    else showToast("Slip not loaded yet — hit refresh (↻) and try again", "err");
  };
  // Pending (RESOLVED) slip → open the closure form in FILL mode so it can be
  // filled right here (same as the Recent-Breakdowns "Fill Closure Form").
  const onFillSlip = (id) => {
    const t = ticketById.get(id);
    if (t) setClosureModal({ ticket: t, mode: "fill", phase: "maintenance" });
    else showToast("Slip not loaded yet — hit refresh (↻) and try again", "err");
  };

  // Bumped after a closure save so the zone slip list refetches — the just-
  // filled slip flips RESOLVED → CLOSED and its button becomes "View Slip".
  const [slipRefreshKey, setSlipRefreshKey] = useState(0);

  // ClosureFormModal calls back with (slice, phase) — slice is just the
  // half the user filled.  Production phase POSTs to /production-fill;
  // maintenance phase POSTs to /close (which also flips state to CLOSED).
  const onSubmitClosure = async (slice, phase, prodExtra) => {
    try {
      const id = closureModal.ticket.id;
      if (phase === "production") {
        await api.post(`/api/breakdowns/${id}/production-fill`,
                       { production_data: slice }, token);
        showToast("Production half saved ✓");
      } else {
        // Maintenance fill saves both halves: maintenance_data + the
        // Production-half fields the user edited (production_data).
        await api.post(`/api/breakdowns/${id}/close`,
                       { maintenance_data: slice,
                         production_data: prodExtra || undefined }, token);
        showToast("Slip saved ✓");
      }
      setClosureModal(null);
      reload();
      setSlipRefreshKey((k) => k + 1);   // make the zone slip list refetch
    } catch (e) {
      showToast(e.message || "Submit failed", "err");
      throw e;
    }
  };

  // KPI tiles at top
  const todayCount = recent.filter((r) => {
    const d = new Date(r.started_at);
    const t = new Date();
    return d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate();
  }).length;
  const pendingClosure = recent.filter((r) => r.state === "RESOLVED").length;
  const longestActive = active.reduce((max, r) => {
    if (!r.started_at) return max;
    const sec = Math.floor((Date.now() - new Date(r.started_at).getTime()) / 1000);
    return sec > max ? sec : max;
  }, 0);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700;800&family=Barlow+Condensed:wght@600;700;800&display=swap');
        .md-root { min-height:100vh; background:#f8fafc; font-family:'Barlow',sans-serif; padding-bottom:60px; }
        .md-topbar {
          background:#fff; border-bottom:1px solid #e2e8f0;
          padding:0 40px 0 88px; height:60px;
          display:flex; align-items:center; justify-content:space-between;
          position:sticky; top:0; z-index:100;
          box-shadow:0 1px 3px rgba(0,0,0,.06);
        }
        .md-topbar::after { content:''; position:absolute; bottom:0; left:0; right:0; height:2px;
                            background:${theme.gradient}; }
        .md-logo { font-family:'Barlow Condensed',sans-serif; font-size:22px; font-weight:800; color:#0f172a; }
        .md-logo span { color:${theme.accent}; }
        .md-title { position:absolute; left:50%; transform:translateX(-50%);
                    font-family:'Barlow Condensed',sans-serif;
                    font-size:37px; font-weight:800; color:#0f172a; letter-spacing:-.01em;
                    pointer-events:none; white-space:nowrap; }
        .md-title span { color:${theme.accent}; }
        .md-user-pill { display:flex; align-items:center; gap:10px;
                         padding:6px 14px; border-radius:99px;
                         border:1.5px solid #e2e8f0; background:#f8fafc;
                         font-size:12px; font-weight:600; color:#334155;
                         white-space:nowrap; }
        .md-user-pill b { color:#0f172a; font-weight:800; }
        .md-body { padding:28px 40px 0; max-width:1280px; margin:0 auto; }
        .md-tiles { display:flex; gap:14px; flex-wrap:wrap; margin-bottom:18px; }
        .md-section { margin-bottom:22px; }
        .md-section h3 { margin:0 0 10px; font-family:'Barlow Condensed',sans-serif;
                          font-size:18px; font-weight:800; color:#0f172a;
                          letter-spacing:.02em; text-transform:uppercase; }
      `}</style>

      <div className="md-root">
        {/* Production-Dashboard-style topbar (red accent for Maintenance) */}
        <div className="md-topbar">
          <div className="md-logo" />
          <div className="md-title">
            {titleLeft}<span>{titleRight}</span>
          </div>
          {user?.username && (
            <div className="md-user-pill">
              Signed in as <b>{user.username}</b>
            </div>
          )}
        </div>

        <div className="md-body">
          {loading ? (
            <div style={{ padding: "60px 20px", textAlign: "center", color: "#94a3b8" }}>
              Loading maintenance dashboard…
            </div>
          ) : (
            <>
              <div style={{ display: "flex", gap: 16, alignItems: "flex-start",
                            flexWrap: "wrap", marginBottom: 22 }}>
                {/* left column: stat tiles + ANDON */}
                <div style={{ flex: "1 1 620px", minWidth: 0 }}>
                  <div className="md-tiles">
                    <StatCard label="Active breakdowns"  value={active.length}              color={active.length ? "#dc2626" : "#16a34a"}/>
                    <StatCard label="Today (24h)"        value={todayCount}                 color="#1e40af"/>
                    <StatCard label="Pending closure"    value={pendingClosure}             color="#b45309" sub="Resolved but form pending"/>
                    <StatCard label="Longest active"     value={fmtDuration(longestActive)} color="#7c3aed"/>
                  </div>
                  <AndonTable
                    rows={active}
                    fullscreenRef={andonRef}
                    isFullscreen={isFs}
                    toggleFullscreen={toggleFullscreen}
                  />
                </div>
                {/* right column: PM This Month — aligned to the very top */}
                <div style={{ flex: "1 1 380px", minWidth: 320, maxWidth: 500 }}>
                  <PmThisMonth token={token} />
                </div>
              </div>

              <div className="md-section">
                <KpiPanel token={token} lines={lines} onViewSlip={onViewSlip} onFillSlip={onFillSlip} refreshKey={slipRefreshKey} />
              </div>

              {/* machine-no wise OPEN DMC NG points — grand total is the last row */}
              <div className="md-section">
                <DmcNgPanel token={token} refreshKey={slipRefreshKey} />
              </div>
            </>
          )}
        </div>
      </div>

      {closureModal && (
        <ClosureFormModal
          ticket={closureModal.ticket}
          mode={closureModal.mode}
          phase={closureModal.phase || "maintenance"}
          token={token}
          onClose={() => setClosureModal(null)}
          onSave={onSubmitClosure}
        />
      )}

      {toastNode}
    </>
  );
}
