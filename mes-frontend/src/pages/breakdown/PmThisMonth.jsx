import { useState, useEffect, useMemo, useRef } from "react";
import { api } from "./shared";

/* ════════════════════════════════════════════════════════════════════
 * 1.5) PM This Month — is mahine kis machine ka Preventive Maintenance
 *      due hai, kaunse hafte me, aur kya haalat hai.
 *
 *      Source: GET /api/pm/yearly-plan-month?month=YYYY-MM
 *        row: {machine_code, machine_name, zone_name, line, pm_frequency,
 *              week_index, done, done_date, sheet_filled}
 *        top: {total, done, pending, sheet_pending}
 *
 *      Dashboard par ye ek PATLI column (380-500px) me baithta hai, isliye
 *      card compact rakha hai; poora chaudA table "Full view" me khulta hai.
 *
 *      Status / days-left / window% sab ISI data se nikalte hain (week ka
 *      din-range vs aaj) — kahin koi banaya hua number nahi.
 * ════════════════════════════════════════════════════════════════════ */

const S = {
  COMPLETED: { label: "COMPLETED", fg: "#1d4ed8", bg: "#eff6ff", bar: "#2563eb", dot: "#2563eb" },
  OVERDUE:   { label: "OVERDUE",   fg: "#b91c1c", bg: "#fef2f2", bar: "#dc2626", dot: "#dc2626" },
  DUE:       { label: "DUE",       fg: "#a16207", bg: "#fefce8", bar: "#eab308", dot: "#eab308" },
  DUE_SOON:  { label: "DUE SOON",  fg: "#c2410c", bg: "#fff7ed", bar: "#f97316", dot: "#f97316" },
  ON_TRACK:  { label: "ON TRACK",  fg: "#15803d", bg: "#f0fdf4", bar: "#22c55e", dot: "#22c55e" },
};
const ORDER = ["OVERDUE", "DUE", "DUE_SOON", "ON_TRACK", "COMPLETED"];

function PmThisMonth({ token }) {
  const [data, setData] = useState(null);
  const [err,  setErr]  = useState(false);
  const [full, setFull] = useState(false);          // full-view modal
  const [fZone, setFZone]     = useState("");
  const [fLine, setFLine]     = useState("");
  const [fStatus, setFStatus] = useState("");
  const [page, setPage]       = useState(1);
  const PER = 10;
  // Card ko jitni jagah milti hai usi hisaab se layout: chaudi jagah -> poora
  // table (filters + pagination), patli -> compact list.  Dashboard me kabhi ye
  // saath wali column me hota hai, kabhi poori chaudai me — isliye naap kar tay
  // karte hain, andaaze se nahi.
  const boxRef = useRef(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    setW(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);
  const wide = w >= 760;              // itni jagah me poora table theek baithta hai

  const now      = new Date();
  const ym       = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const monAbbr  = now.toLocaleString("en-GB", { month: "short" });
  const monthLbl = now.toLocaleString("en-GB", { month: "long", year: "numeric" });
  const lastDay  = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const today    = now.getDate();

  useEffect(() => {
    if (!token) return;
    let alive = true;
    api.get(`/api/pm/yearly-plan-month?month=${ym}`, token)
      .then((d) => { if (alive) setData(d); })
      .catch(() => { if (alive) setErr(true); });
    return () => { alive = false; };
  }, [token, ym]);

  // Week 1 = 1-7, 2 = 8-14, 3 = 15-21, 4 = 22-end
  const winOf = (wno) => ({ start: (wno - 1) * 7 + 1, end: wno === 4 ? lastDay : wno * 7 });

  const rows = useMemo(() => {
    if (!data?.weeks) return [];
    const out = [];
    ["1", "2", "3", "4"].forEach((wno) =>
      (data.weeks[wno] || []).forEach((m) => {
        const w = winOf(Number(wno));
        const daysLeft = w.end - today;                       // window khatm hone me
        let key;
        if (m.done)            key = "COMPLETED";
        else if (daysLeft < 0) key = "OVERDUE";
        else if (daysLeft === 0) key = "DUE";
        else if (daysLeft <= 7)  key = "DUE_SOON";
        else key = "ON_TRACK";
        // window kitna beet chuka (0-100) — done ho to poora
        const span = w.end - w.start + 1;
        const used = m.done ? 100
          : Math.max(0, Math.min(100, Math.round(((today - w.start + 1) / span) * 100)));
        out.push({ ...m, wno: Number(wno), win: w, daysLeft, key, used });
      }));
    return out.sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key)
      || a.wno - b.wno
      || String(a.zone_name || "").localeCompare(String(b.zone_name || "")));
  }, [data, today, lastDay]);

  const stats = useMemo(() => {
    const c = { total: rows.length, done: 0, overdue: 0, due: 0 };
    rows.forEach((r) => {
      if (r.key === "COMPLETED") c.done++;
      else if (r.key === "OVERDUE") c.overdue++;
      else c.due++;                                   // DUE + DUE SOON + ON TRACK
    });
    c.pct = c.total ? Math.round((c.done / c.total) * 100) : 0;
    return c;
  }, [rows]);

  const zones = useMemo(() => [...new Set(rows.map((r) => r.zone_name).filter(Boolean))].sort(), [rows]);
  const lines = useMemo(() => [...new Set(rows.filter((r) => !fZone || r.zone_name === fZone)
                                              .map((r) => r.line).filter(Boolean))].sort(), [rows, fZone]);
  const shown = useMemo(() => rows.filter((r) =>
    (!fZone || r.zone_name === fZone) && (!fLine || r.line === fLine) &&
    (!fStatus || r.key === fStatus)), [rows, fZone, fLine, fStatus]);
  const pages = Math.max(1, Math.ceil(shown.length / PER));
  const pageRows = shown.slice((Math.min(page, pages) - 1) * PER, Math.min(page, pages) * PER);

  const dateTxt = (r) => r.win.start === r.win.end
    ? `${String(r.win.start).padStart(2, "0")} ${monAbbr}`
    : `${String(r.win.start).padStart(2, "0")}–${String(r.win.end).padStart(2, "0")} ${monAbbr}`;
  const daysTxt = (r) => r.key === "COMPLETED" ? "done"
    : r.daysLeft < 0 ? `${r.daysLeft} days`
    : r.daysLeft === 0 ? "today"
    : r.daysLeft === 1 ? "1 day" : `${r.daysLeft} days`;

  const Pill = ({ k }) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px",
                   borderRadius: 99, background: S[k].bg, color: S[k].fg,
                   fontSize: 10, fontWeight: 800, letterSpacing: ".03em", whiteSpace: "nowrap" }}>
      <span style={{ width: 5, height: 5, borderRadius: 99, background: S[k].dot }} />
      {S[k].label}
    </span>
  );
  const Bar = ({ r }) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
      <span style={{ width: 62, height: 5, borderRadius: 99, background: "#eef2f7", overflow: "hidden" }}>
        <span style={{ display: "block", height: "100%", width: `${r.used}%`, background: S[r.key].bar }} />
      </span>
      <span style={{ fontSize: 10.5, fontWeight: 700, color: "#64748b", minWidth: 26 }}>{r.used}%</span>
    </span>
  );

  const Stat = ({ n, label, color, sub }) => (
    <div style={{ flex: "1 1 82px", minWidth: 76, background: "#fff", border: "1px solid #e8edf3",
                  borderRadius: 10, padding: "8px 10px" }}>
      <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 22, fontWeight: 800,
                    lineHeight: 1.05, color }}>{n}{sub}</div>
      <div style={{ fontSize: 9.5, fontWeight: 700, color: "#8a94a6", letterSpacing: ".04em",
                    textTransform: "uppercase", marginTop: 1 }}>{label}</div>
    </div>
  );

  const th = { textAlign: "left", padding: "9px 10px", fontSize: 9.5, fontWeight: 800,
               letterSpacing: ".07em", textTransform: "uppercase", color: "#8a94a6",
               borderBottom: "1px solid #e8edf3", whiteSpace: "nowrap" };
  const td = { padding: "9px 10px", fontSize: 12.5, color: "#334155",
               borderBottom: "1px solid #f2f5f9", whiteSpace: "nowrap" };
  const selSt = { border: "1px solid #e2e8f0", borderRadius: 9, padding: "7px 10px", fontSize: 12,
                  fontWeight: 600, color: "#334155", background: "#fff", fontFamily: "inherit" };

  const ZoneTag = ({ z }) => (
    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 6, background: "#eff6ff",
                   color: "#1d4ed8", fontSize: 10.5, fontWeight: 800, whiteSpace: "nowrap" }}>
      {z || "—"}
    </span>
  );

  // Filters + table + paging + legend — EK hi jagah likha, inline (chaudi jagah)
  // aur modal dono yahi use karte hain.
  const FullBlock = ({ inModal }) => (
    <>
      <div style={{ display: "flex", gap: 10, padding: inModal ? "13px 22px" : "12px 16px",
                    borderBottom: "1px solid #eef2f7", flexWrap: "wrap", alignItems: "center" }}>
        <select style={selSt} value={fZone}
                onChange={(e) => { setFZone(e.target.value); setFLine(""); setPage(1); }}>
          <option value="">All Zones</option>
          {zones.map((z) => <option key={z} value={z}>{z}</option>)}
        </select>
        <select style={selSt} value={fLine} disabled={!fZone}
                onChange={(e) => { setFLine(e.target.value); setPage(1); }}>
          <option value="">All Lines</option>
          {lines.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <select style={selSt} value={fStatus}
                onChange={(e) => { setFStatus(e.target.value); setPage(1); }}>
          <option value="">All Status</option>
          {ORDER.map((k) => <option key={k} value={k}>{S[k].label}</option>)}
        </select>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "#8a94a6", fontWeight: 600 }}>
          {shown.length} of {rows.length}
        </span>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 880 }}>
          <thead><tr style={{ background: "#f8fafc" }}>
            {["Zone", "Line", "Machine No.", "Date", "Status", "Days Left", "Window", "Sheet"]
              .map((h) => <th key={h} style={{ ...th, padding: inModal ? "9px 10px" : "9px 16px" }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {pageRows.map((r, i) => (
              <tr key={i}>
                <td style={{ ...td, paddingLeft: inModal ? 10 : 16 }}><ZoneTag z={r.zone_name} /></td>
                <td style={{ ...td, fontWeight: 700, color: "#0f172a" }}>{r.line || "—"}</td>
                <td style={{ ...td, fontWeight: 700, color: "#0f172a" }}
                    title={r.machine_name || ""}>{r.machine_code || "—"}</td>
                <td style={td}>{dateTxt(r)}</td>
                <td style={td}><Pill k={r.key} /></td>
                <td style={{ ...td, fontWeight: 700, color: S[r.key].fg }}>{daysTxt(r)}</td>
                <td style={td}><Bar r={r} /></td>
                <td style={td}>
                  {r.sheet_filled
                    ? <span style={{ color: "#15803d", fontWeight: 800, fontSize: 11.5 }}>✓ Filled</span>
                    : <span style={{ color: "#94a3b8", fontWeight: 700, fontSize: 11.5 }}>—</span>}
                </td>
              </tr>
            ))}
            {pageRows.length === 0 && (
              <tr><td colSpan={8} style={{ ...td, textAlign: "center", color: "#94a3b8",
                                           padding: 26 }}>Nothing matches this filter.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12,
                    padding: inModal ? "12px 22px" : "12px 16px",
                    borderTop: "1px solid #eef2f7", flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: "#8a94a6", fontWeight: 600 }}>
          {shown.length === 0 ? "0 entries"
            : `Showing ${(Math.min(page, pages) - 1) * PER + 1} to ` +
              `${Math.min(Math.min(page, pages) * PER, shown.length)} of ${shown.length}`}
        </span>
        <div style={{ display: "flex", gap: 5, marginLeft: "auto", alignItems: "center" }}>
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}
                  style={{ ...selSt, padding: "6px 11px", cursor: page <= 1 ? "default" : "pointer",
                           opacity: page <= 1 ? .45 : 1 }}>‹</button>
          {Array.from({ length: pages }, (_, i) => i + 1).slice(0, 7).map((p) => (
            <button key={p} onClick={() => setPage(p)}
                    style={{ ...selSt, padding: "6px 11px", cursor: "pointer",
                             ...(p === Math.min(page, pages)
                                 ? { background: "#2563eb", color: "#fff", borderColor: "#2563eb" } : {}) }}>
              {p}
            </button>
          ))}
          <button onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page >= pages}
                  style={{ ...selSt, padding: "6px 11px", cursor: page >= pages ? "default" : "pointer",
                           opacity: page >= pages ? .45 : 1 }}>›</button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 20, flexWrap: "wrap",
                    padding: inModal ? "11px 22px" : "11px 16px",
                    background: "#f8fafc", borderTop: "1px solid #eef2f7" }}>
        {[["ON_TRACK", "PM will be completed on time"], ["DUE_SOON", "PM due within 7 days"],
          ["DUE", "PM is due now"], ["OVERDUE", "PM window has passed"],
          ["COMPLETED", "PM completed"]].map(([k, txt]) => (
          <span key={k} style={{ display: "inline-flex", alignItems: "flex-start", gap: 7 }}>
            <span style={{ width: 7, height: 7, borderRadius: 99, background: S[k].dot, marginTop: 4 }} />
            <span>
              <div style={{ fontSize: 11.5, fontWeight: 800, color: "#334155" }}>{S[k].label}</div>
              <div style={{ fontSize: 10.5, color: "#8a94a6" }}>{txt}</div>
            </span>
          </span>
        ))}
      </div>
    </>
  );

  return (
    <>
      <div ref={boxRef}
           style={{ background: "#fff", border: "1px solid #e8edf3", borderRadius: 14,
                    overflow: "hidden", boxShadow: "0 1px 3px rgba(15,23,42,.05)" }}>
        {/* header */}
        <div style={{ padding: "13px 16px", borderBottom: "1px solid #eef2f7",
                      display: "flex", alignItems: "center", gap: 11 }}>
          <span style={{ width: 34, height: 34, borderRadius: 9, background: "#2563eb", color: "#fff",
                         display: "inline-flex", alignItems: "center", justifyContent: "center",
                         fontSize: 17, flexShrink: 0 }}>🛠</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 19, fontWeight: 800,
                          color: "#0f172a", lineHeight: 1.1 }}>PM This Month</div>
            <div style={{ fontSize: 10.5, color: "#8a94a6", fontWeight: 600 }}>
              {monthLbl} · {stats.total} Planned
            </div>
          </div>
          {!wide && <button onClick={() => { setFull(true); setPage(1); }}
                  style={{ marginLeft: "auto", border: "1px solid #e2e8f0", background: "#fff",
                           color: "#475569", borderRadius: 8, padding: "6px 11px", fontSize: 11.5,
                           fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>
            ⤢ Full view
          </button>}
        </div>

        {/* stats */}
        <div style={{ display: "flex", gap: 8, padding: "12px 14px", background: "#f8fafc",
                      borderBottom: "1px solid #eef2f7", flexWrap: "wrap" }}>
          <Stat n={stats.total}   label="Planned"    color="#0f172a" sub="" />
          <Stat n={stats.due}     label="Due"        color="#c2410c" sub="" />
          <Stat n={stats.done}    label="Completed"  color="#15803d" sub="" />
          <Stat n={stats.overdue} label="Overdue"    color="#b91c1c" sub="" />
          <Stat n={stats.pct}     label="Compliance" color="#2563eb" sub="%" />
        </div>

        {/* Chaudi jagah -> wahi poora table yahin; patli -> compact list */}
        {wide && data && !err && rows.length > 0 && <FullBlock inModal={false} />}

        {/* rows (compact) */}
        {!(wide && data && !err && rows.length > 0) &&
        <div style={{ maxHeight: 292, overflowY: "auto" }}>
          {err ? (
            <div style={{ padding: 20, color: "#dc2626", fontSize: 12.5 }}>Could not load PM schedule.</div>
          ) : !data ? (
            <div style={{ padding: 20, color: "#94a3b8", fontSize: 12.5 }}>Loading…</div>
          ) : rows.length === 0 ? (
            <div style={{ padding: 24, color: "#94a3b8", fontSize: 12.5, textAlign: "center" }}>
              No PM planned this month.
            </div>
          ) : rows.map((r, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px",
                                  borderBottom: "1px solid #f2f5f9" }}>
              <div style={{ minWidth: 0, flex: "1 1 auto" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: "#0f172a",
                                 overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                        title={r.machine_name || ""}>{r.machine_code || "—"}</span>
                  {r.done && r.sheet_filled && (
                    <span title="Check sheet filled" style={{ fontSize: 10, color: "#15803d" }}>✓ sheet</span>
                  )}
                </div>
                <div style={{ fontSize: 10.5, color: "#8a94a6", marginTop: 2, overflow: "hidden",
                              textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.zone_name || "—"} · {r.line || "—"} · {dateTxt(r)}
                </div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <Pill k={r.key} />
                <div style={{ fontSize: 10.5, fontWeight: 700, marginTop: 3, color: S[r.key].fg }}>
                  {daysTxt(r)}
                </div>
              </div>
            </div>
          ))}
        </div>}

        {/* legend — sirf compact view me (FullBlock ka apna legend hai) */}
        {!(wide && data && !err && rows.length > 0) &&
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", padding: "9px 14px",
                      background: "#f8fafc", borderTop: "1px solid #eef2f7" }}>
          {ORDER.map((k) => (
            <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 5,
                                   fontSize: 10, fontWeight: 700, color: "#64748b" }}>
              <span style={{ width: 6, height: 6, borderRadius: 99, background: S[k].dot }} />
              {S[k].label}
            </span>
          ))}
        </div>}
      </div>

      {/* ── FULL VIEW ─────────────────────────────────────────────── */}
      {full && (
        <div onClick={() => setFull(false)}
             style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)", zIndex: 1000,
                      display: "flex", alignItems: "flex-start", justifyContent: "center",
                      padding: "34px 18px", overflowY: "auto" }}>
          <div onClick={(e) => e.stopPropagation()}
               style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 1180,
                        boxShadow: "0 18px 50px rgba(15,23,42,.28)", overflow: "hidden" }}>
            {/* head */}
            <div style={{ display: "flex", alignItems: "center", gap: 13, padding: "16px 22px",
                          borderBottom: "1px solid #eef2f7", flexWrap: "wrap" }}>
              <span style={{ width: 40, height: 40, borderRadius: 11, background: "#2563eb", color: "#fff",
                             display: "inline-flex", alignItems: "center", justifyContent: "center",
                             fontSize: 20 }}>🛠</span>
              <div>
                <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 24, fontWeight: 800,
                              color: "#0f172a", lineHeight: 1.1 }}>PM This Month</div>
                <div style={{ fontSize: 12, color: "#8a94a6", fontWeight: 600 }}>
                  {monthLbl} · {stats.total} Planned
                </div>
              </div>
              <div style={{ marginLeft: "auto", display: "flex", gap: 9, flexWrap: "wrap" }}>
                <Stat n={stats.total}   label="Total Planned" color="#0f172a" sub="" />
                <Stat n={stats.due}     label="Due"           color="#c2410c" sub="" />
                <Stat n={stats.done}    label="Completed"     color="#15803d" sub="" />
                <Stat n={stats.overdue} label="Overdue"       color="#b91c1c" sub="" />
                <Stat n={stats.pct}     label="Compliance"    color="#2563eb" sub="%" />
              </div>
              <button onClick={() => setFull(false)}
                      style={{ border: "none", background: "#f1f5f9", color: "#475569", borderRadius: 9,
                               width: 32, height: 32, cursor: "pointer", fontSize: 16, fontWeight: 700 }}>×</button>
            </div>

            <FullBlock inModal />
          </div>
        </div>
      )}
    </>
  );
}

export default PmThisMonth;
