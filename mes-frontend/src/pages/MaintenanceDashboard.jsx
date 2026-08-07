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
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { api, StatCard, fmtDuration } from "./breakdown/shared";
import AndonTable from "./breakdown/AndonTable";
import PmThisMonth from "./breakdown/PmThisMonth";
import KpiPanel from "./breakdown/KpiPanel";
import DmcNgPanel from "./breakdown/DmcNgPanel";
import { ClosureFormModal } from "./breakdown/ClosureFormModal";
import TvFit from "../components/TvFit";

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
  // Is dashboard ka saara breakdown data ab ANDON se aata hai — `mes_breakdowns`
  // wale purane states (active / recent / stats) hata diye, unka data kahin
  // dikhta hi nahi tha.
  const [andonRows, setAndonRows]   = useState([]);   // ANDON table ki rows
  const [andonStats, setAndonStats] = useState({});   // 4 stat cards
  const [lines,  setLines]        = useState([]);  // kept so historical line lookups stay possible
  const [loading, setLoading]     = useState(true);

  const [closureModal, setClosureModal]     = useState(null); // { ticket, mode }

  const [showToast, toastNode]    = useToast();

  // Fullscreen control for the ANDON section — INDEPENDENT of the page-level
  // full-screen button.  isFs is true ONLY when the ANDON element itself is the
  // fullscreen element, so the page's own full-screen (documentElement) never
  // flips the ANDON table into its fullscreen layout.
  const andonRef = useRef(null);
  const [isFs, setIsFs] = useState(false);
  useEffect(() => {
    const onChange = () => setIsFs(document.fullscreenElement === andonRef.current);
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, []);
  const toggleFullscreen = () => {
    const el = andonRef.current;
    if (!el) return;
    // only exit if the ANDON is the one in fullscreen; otherwise request it
    // (switches from a page-level fullscreen straight to the ANDON view).
    if (document.fullscreenElement === el) document.exitFullscreen?.();
    else el.requestFullscreen?.();
  };

  // Har 10s refresh.
  //
  // 2026-08-06: is dashboard ka saara breakdown-related data ab ANDON se aata
  // hai.  `/api/breakdowns/*` ke purane fetches (active / recent / history /
  // stats) hata diye — unka data ab kahin dikhta hi nahi tha:
  //   • ANDON table  → /api/andon/dashboard (rows)
  //   • 4 stat cards → /api/andon/dashboard (stats)
  //   • zone slip list (KpiPanel) → AUTO slips, /api/maintenance-kpi/ se
  //   • View/Fill Slip → /api/breakdown-slips/auto/{id}
  const reload = useCallback(async () => {
    try {
      // Sirf ANDON ka data — ye har 2 second aata hai (neeche dekho), isliye
      // ismein sirf wahi rakha hai jo sach me badalta rehta hai.
      const andon = await api.get("/api/andon/dashboard", token).catch(() => ({}));
      // /api/andon/dashboard {rows, stats} deta hai
      setAndonRows(Array.isArray(andon?.rows) ? andon.rows : []);
      setAndonStats((andon && andon.stats) || {});
    } catch {
      showToast("Failed to load dashboard", "err");
    } finally {
      setLoading(false);
    }
  }, [token]);

  // ANDON ka data HAR 2 SECOND — button dabte hi dashboard par dikhna chahiye.
  // Pehle 10 sec tha, isliye call aane me 5-10 second lag jaate the (ESP turant
  // bhejta hai aur backend 7 ms me jawab deta hai — saari der yahin thi).
  // 2 sec wahi hai jo ANDON System page ka Live Board use karta hai.
  useEffect(() => {
    reload();
    const t = setInterval(reload, 2000);
    return () => clearInterval(t);
  }, [reload]);

  // Lines ka master EK BAAR — ye machine master se aata hai, har 2 second
  // dobara maangne ka koi matlab nahi (pehle har chakkar me aata tha).
  useEffect(() => {
    let dead = false;
    api.get("/api/lines/", token)
      .then((l) => { if (!dead) setLines(Array.isArray(l) ? l : []); })
      .catch(() => { if (!dead) setLines([]); });
    return () => { dead = true; };
  }, [token]);

  useEffect(() => {
    document.title = "Maintenance Dashboard";
  }, []);

  // Breakdowns are opened + resolved automatically by the collector based
  // on the line's status bit — no manual buttons on this dashboard.  The
  // only manual step left is filling the closure form for a RESOLVED
  // ticket from the History table below.

  // Zone-wise list ki slips ab AUTO slips hain (ANDON ke Maintenance call se).
  // Wo `mes_breakdowns` ke tickets NAHI hain, isliye unhe server se uthate hain
  // — backend wahi `ticket` shape deta hai jo form samajhta hai.
  const openAutoSlip = async (id, mode) => {
    try {
      const t = await api.get(`/api/breakdown-slips/auto/${id}`, token);
      setClosureModal({ ticket: t, mode, phase: "maintenance" });
    } catch (e) {
      showToast(e.message || "Slip khul nahi payi", "err");
    }
  };
  const onViewSlip = (id) => openAutoSlip(id, "view");
  // Pending slip → form FILL mode me khulega; save usi slip row par hoga.
  const onFillSlip = (id) => openAutoSlip(id, "fill");

  // Bumped after a closure save so the zone slip list refetches — the just-
  // filled slip flips RESOLVED → CLOSED and its button becomes "View Slip".
  const [slipRefreshKey, setSlipRefreshKey] = useState(0);

  // ClosureFormModal (slice, phase) wapas deta hai — slice sirf wahi half hai
  // jo user ne bhara.  Is dashboard ki saari slips AUTO hain (ANDON se), to
  // save hamesha usi slip ki row par jaata hai.  Purana breakdown-ticket wala
  // raasta (/production-fill + /close) hata diya — wo yahan se ab kabhi chalta
  // hi nahi tha.
  const onSubmitClosure = async (slice, phase, prodExtra) => {
    try {
      const id = closureModal.ticket.id;
      await api.post(`/api/breakdown-slips/auto/${id}/fill`,
                     { maintenance_data: phase === "maintenance" ? slice : undefined,
                       production_data:  phase === "production" ? slice : (prodExtra || undefined) },
                     token);
      showToast("Slip saved ✓");
      setClosureModal(null);
      reload();
      setSlipRefreshKey((k) => k + 1);   // zone slip list refetch ho jaye
    } catch (e) {
      showToast(e.message || "Submit failed", "err");
      throw e;
    }
  };

  // KPI tiles at top — ab ye chaaron ANDON (andon_system + andon_history) se
  // aate hain, mes_breakdowns se NAHI.  Server hi ginti karta hai (stats), taaki
  // "24 ghante" / "chalu" ki definition backend aur cards me ek jaisi rahe.
  const andonActive   = andonStats.active   ?? 0;   // abhi chalu calls
  const andonAwaiting = andonStats.awaiting ?? 0;   // chalu, par jawab nahi aaya
  const andonToday    = andonStats.today    ?? 0;   // pichhle 24h ke calls
  const longestActive = andonStats.longest_seconds ?? 0;

  return (
    <TvFit designWidth={1280} bg="#f8fafc">
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
                    <StatCard label="Active calls"       value={andonActive}                color={andonActive ? "#dc2626" : "#16a34a"}/>
                    <StatCard label="Today"              value={andonToday}                 color="#1e40af" sub="7 AM – 6:30 AM (plant day)"/>
                    <StatCard label="Awaiting response"  value={andonAwaiting}              color="#b45309" sub="Call open, no ack yet"/>
                    <StatCard label="Longest active"     value={fmtDuration(longestActive)} color="#7c3aed"/>
                  </div>
                  <AndonTable
                    rows={andonRows}
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
    </TvFit>
  );
}
