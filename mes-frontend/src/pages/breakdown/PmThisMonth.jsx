import { useState, useEffect, useMemo } from "react";
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
 *      Table ab LINE-WISE hai (user 2026-09-23): Zone / Line / Date / Status /
 *      Days Left / Sheet.  Machine No. ka apna khaana NAHI -- LINE par click
 *      karo to usi ke neeche us line ki saari machine khul jaati hai, har ek ka
 *      apna date, status, days-left aur sheet.  Ek waqt me ek hi line khulti
 *      hai (accordion), warna table lamba ho kar dashboard kha jaata hai.
 *
 *      "Window" wala khaana HATA diya gaya.  Wo sirf batata tha ki khidki ka
 *      kitna samay beet chuka -- log use "kaam 100% ho gaya" samajh lete the,
 *      jabki wo waqt ka hisaab tha.  Jo kaam ka haal hai wo Status aur Days
 *      Left pehle se bata dete hain.
 *
 *      Status aur days-left dono ISI data se nikalte hain (hafte ka din-range
 *      vs aaj) -- kahin koi banaya hua number nahi.  Days Left ka rang: din
 *      bache hon to HARA, nikal chuke hon to LAAL.
 * ════════════════════════════════════════════════════════════════════ */

const S = {
  COMPLETED: { label: "COMPLETED", fg: "#1d4ed8", bg: "#eff6ff", bar: "#2563eb", dot: "#2563eb" },
  OVERDUE:   { label: "OVERDUE",   fg: "#b91c1c", bg: "#fef2f2", bar: "#dc2626", dot: "#dc2626" },
  DUE:       { label: "DUE",       fg: "#a16207", bg: "#fefce8", bar: "#eab308", dot: "#eab308" },
  DUE_SOON:  { label: "DUE SOON",  fg: "#c2410c", bg: "#fff7ed", bar: "#f97316", dot: "#f97316" },
  ON_TRACK:  { label: "ON TRACK",  fg: "#15803d", bg: "#f0fdf4", bar: "#22c55e", dot: "#22c55e" },
};
const ORDER = ["OVERDUE", "DUE", "DUE_SOON", "ON_TRACK", "COMPLETED"];

/* Mahine ka chhota naam KHUD ka -- `toLocaleString("en-GB")` September ke liye
   "Sept" deta hai (4 akshar), baaki sab ke liye 3.  Table me wo tedha dikhta
   tha, isliye yahi list. */
const MON3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
              "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Days Left ka rang: din bache hon (ya kaam ho chuka ho) to hara, nikal gaye
// to laal.  Ek hi jagah tay hai -- line ki qatar aur machine ki qatar dono yahi
// use karti hain.
const DAYS_GREEN = "#15803d", DAYS_RED = "#b91c1c";
const daysColor = (days, done) => (done || days >= 0 ? DAYS_GREEN : DAYS_RED);

// Ye chhote tukde MODULE level par hain — render ke andar banate to React
// har render par inhe naya component maanta aur andar ke <select> remount ho
// kar focus/khula-hua-dropdown kho dete.

function _ZoneTag({ z }) { return (
  <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 6, background: "#eff6ff",
                 color: "#1d4ed8", fontSize: 10.5, fontWeight: 800, whiteSpace: "nowrap" }}>
    {z || "—"}
  </span>
); }

function _Pill({ k }) { return (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px",
                 borderRadius: 99, background: S[k].bg, color: S[k].fg,
                 fontSize: 10, fontWeight: 800, letterSpacing: ".03em", whiteSpace: "nowrap" }}>
    <span style={{ width: 5, height: 5, borderRadius: 99, background: S[k].dot }} />
    {S[k].label}
  </span>
); }

function _Sheet({ filled }) { return filled
  ? <span style={{ color: "#15803d", fontWeight: 800, fontSize: 11.5 }}>✓ Filled</span>
  : <span style={{ color: "#94a3b8", fontWeight: 700, fontSize: 11.5 }}>—</span>;
}

function _Stat({ n, label, color, sub }) { return (
  <div style={{ minWidth: 0, background: "#fff", border: "1px solid #e8edf3",
                borderRadius: 10, padding: "8px 10px" }}>
    <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 22, fontWeight: 800,
                  lineHeight: 1.05, color }}>{n}{sub}</div>
    <div style={{ fontSize: 9.5, fontWeight: 700, color: "#8a94a6", letterSpacing: ".04em",
                  textTransform: "uppercase", marginTop: 1 }}>{label}</div>
  </div>
); }


function PmThisMonth({ token }) {
  const [data, setData] = useState(null);
  const [err,  setErr]  = useState(false);
  const [fZone, setFZone]     = useState("");
  const [fLine, setFLine]     = useState("");
  const [fStatus, setFStatus] = useState("");
  const [page, setPage]       = useState(1);
  // Kis line ka POPUP khula hai (khaali = koi nahi).  Pehle qatar usi jagah
  // khul jaati thi, par usse table lamba ho kar dashboard kha jaata tha --
  // user 2026-09-23: "line par click karne par pop jaisa aana chahiye".
  const [modalGid, setModalGid] = useState("");
  const PER = 10;
  // Har jagah POORA table (saare column).  Jagah kam padi to table apne aap
  // side me scroll ho jaata hai — pehle width ke hisaab se column chhupte the
  // aur TV par "column kahan gaya?" wali dikkat aa jaati thi.
  const wide = true;

  const now      = new Date();
  const ym       = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const monAbbr  = MON3[now.getMonth()];
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

  // Esc se popup band (website ki aadat).  App me peechhe wala button apna
  // kaam karta hai, isliye wahan ye chalta hi nahi -- nuksaan koi nahi.
  useEffect(() => {
    if (!modalGid) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setModalGid(""); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalGid]);

  const rows = useMemo(() => {
    if (!data?.weeks) return [];
    // Week 1 = 1-7, 2 = 8-14, 3 = 15-21, 4 = 22-end  (yahin rakha hai taaki
    // useMemo ki dependency list poori rahe)
    const winOf = (wno) => ({ start: (wno - 1) * 7 + 1, end: wno === 4 ? lastDay : wno * 7 });
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
        out.push({ ...m, wno: Number(wno), win: w, daysLeft, key });
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

  /* Ek LINE = ek qatar.  Us line ki saari machine uske andar.
     - status  : jo sabse bura ho (ORDER ka pehla)
     - days    : jo machine sabse jaldi wali ho (sabse chhota daysLeft);
                 saari ho chuki hon to "done"
     - date    : us line ki khidkiyon ka jod (sabse pehla din – sabse aakhri)
     - sheet   : kitni sheet bhari / kul  */
  const groups = useMemo(() => {
    const m = new Map();
    shown.forEach((r) => {
      const gid = `${r.zone_name || "—"}||${r.line || "—"}`;
      if (!m.has(gid)) m.set(gid, { gid, zone_name: r.zone_name, line: r.line, items: [] });
      m.get(gid).items.push(r);
    });
    const out = [];
    m.forEach((g) => {
      const items = [...g.items].sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key)
        || a.win.start - b.win.start
        || String(a.machine_code || "").localeCompare(String(b.machine_code || "")));
      const pend = items.filter((x) => x.key !== "COMPLETED");
      out.push({
        ...g,
        items,
        n: items.length,
        key: items.reduce((a, b) => (ORDER.indexOf(a.key) <= ORDER.indexOf(b.key) ? a : b)).key,
        allDone: pend.length === 0,
        daysLeft: pend.length ? Math.min(...pend.map((x) => x.daysLeft)) : 0,
        win: { start: Math.min(...items.map((x) => x.win.start)),
               end:   Math.max(...items.map((x) => x.win.end)) },
        filled: items.filter((x) => x.sheet_filled).length,
      });
    });
    return out.sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key)
      || String(a.zone_name || "").localeCompare(String(b.zone_name || ""))
      || String(a.line || "").localeCompare(String(b.line || "")));
  }, [shown]);

  const pages = Math.max(1, Math.ceil(groups.length / PER));
  const pageGroups = groups.slice((Math.min(page, pages) - 1) * PER, Math.min(page, pages) * PER);

  /* Popup me kaun si line.  Har render par dhoondte hain (id yaad rakhte hain,
     poora group nahi) -- warna filter badalne ya data refresh hone par popup
     purana data dikhata rehta.  Group na mile to popup apne aap band. */
  const modalGroup = modalGid ? groups.find((g) => g.gid === modalGid) : null;

  // "01–07 Sep" / ek hi din ho to "05 Sep"
  const dateTxt = (w) => w.start === w.end
    ? `${String(w.start).padStart(2, "0")} ${monAbbr}`
    : `${String(w.start).padStart(2, "0")}–${String(w.end).padStart(2, "0")} ${monAbbr}`;
  const daysTxt = (days, done) => done ? "done"
    : days < 0 ? `${days} days`
    : days === 0 ? "today"
    : days === 1 ? "1 day" : `${days} days`;

  const th = { textAlign: "left", padding: "9px 10px", fontSize: 9.5, fontWeight: 800,
               letterSpacing: ".07em", textTransform: "uppercase", color: "#8a94a6",
               borderBottom: "1px solid #e8edf3", whiteSpace: "nowrap" };
  const td = { padding: "9px 10px", fontSize: 12.5, color: "#334155",
               borderBottom: "1px solid #f2f5f9", whiteSpace: "nowrap" };
  const selSt = { border: "1px solid #e2e8f0", borderRadius: 9, padding: "7px 10px", fontSize: 12,
                  fontWeight: 600, color: "#334155", background: "#fff", fontFamily: "inherit" };


  // Filters + table + paging + legend — EK hi jagah likha.
  const fullBlock = (inModal) => (
    <>
      <div style={{ display: "flex", gap: 10, padding: inModal ? "13px 22px" : "12px 16px",
                    borderBottom: "1px solid #eef2f7", flexWrap: "wrap", alignItems: "center" }}>
        <select style={selSt} value={fZone}
                onChange={(e) => { setFZone(e.target.value); setFLine(""); setPage(1); setModalGid(""); }}>
          <option value="">All Zones</option>
          {zones.map((z) => <option key={z} value={z}>{z}</option>)}
        </select>
        <select style={selSt} value={fLine} disabled={!fZone}
                onChange={(e) => { setFLine(e.target.value); setPage(1); setModalGid(""); }}>
          <option value="">All Lines</option>
          {lines.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <select style={selSt} value={fStatus}
                onChange={(e) => { setFStatus(e.target.value); setPage(1); setModalGid(""); }}>
          <option value="">All Status</option>
          {ORDER.map((k) => <option key={k} value={k}>{S[k].label}</option>)}
        </select>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "#8a94a6", fontWeight: 600 }}>
          {groups.length} {groups.length === 1 ? "line" : "lines"} · {shown.length} of {rows.length} machines
        </span>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
          <thead><tr style={{ background: "#f8fafc" }}>
            {["Zone", "Line", "Date", "Status", "Days Left", "Sheet"]
              .map((h) => <th key={h} style={{ ...th, padding: inModal ? "9px 10px" : "9px 16px" }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {pageGroups.map((g) => (
              /* LINE ki qatar — click par uski machine POPUP me khulti hain */
              <tr key={g.gid} onClick={() => setModalGid(g.gid)}
                  title="Open this line's machines"
                  style={{ cursor: "pointer" }}>
                <td style={{ ...td, paddingLeft: inModal ? 10 : 16 }}><_ZoneTag z={g.zone_name} /></td>
                <td style={{ ...td, fontWeight: 700, color: "#0f172a" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                    {g.line || "—"}
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: "#8a94a6",
                                   background: "#f1f5f9", borderRadius: 6, padding: "1px 7px" }}>
                      {g.n} m/c
                    </span>
                    <span style={{ color: "#94a3b8", fontSize: 13, fontWeight: 800 }}>›</span>
                  </span>
                </td>
                <td style={td}>{dateTxt(g.win)}</td>
                <td style={td}><_Pill k={g.key} /></td>
                <td style={{ ...td, fontWeight: 800, color: daysColor(g.daysLeft, g.allDone) }}>
                  {daysTxt(g.daysLeft, g.allDone)}
                </td>
                <td style={{ ...td, fontWeight: 700, color: g.filled === g.n ? "#15803d" : "#8a94a6" }}>
                  {g.filled}/{g.n}
                </td>
              </tr>
            ))}
            {pageGroups.length === 0 && (
              <tr><td colSpan={6} style={{ ...td, textAlign: "center", color: "#94a3b8",
                                           padding: 26 }}>Nothing matches this filter.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12,
                    padding: inModal ? "12px 22px" : "12px 16px",
                    borderTop: "1px solid #eef2f7", flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: "#8a94a6", fontWeight: 600 }}>
          {groups.length === 0 ? "0 lines"
            : `Showing ${(Math.min(page, pages) - 1) * PER + 1} to ` +
              `${Math.min(Math.min(page, pages) * PER, groups.length)} of ${groups.length} lines`}
        </span>
        <div style={{ display: "flex", gap: 5, marginLeft: "auto", alignItems: "center" }}>
          <button onClick={() => { setPage((p) => Math.max(1, p - 1)); setModalGid(""); }} disabled={page <= 1}
                  style={{ ...selSt, padding: "6px 11px", cursor: page <= 1 ? "default" : "pointer",
                           opacity: page <= 1 ? .45 : 1 }}>‹</button>
          {Array.from({ length: pages }, (_, i) => i + 1).slice(0, 7).map((p) => (
            <button key={p} onClick={() => { setPage(p); setModalGid(""); }}
                    style={{ ...selSt, padding: "6px 11px", cursor: "pointer",
                             ...(p === Math.min(page, pages)
                                 ? { background: "#2563eb", color: "#fff", borderColor: "#2563eb" } : {}) }}>
              {p}
            </button>
          ))}
          <button onClick={() => { setPage((p) => Math.min(pages, p + 1)); setModalGid(""); }} disabled={page >= pages}
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
      <div style={{ background: "#fff", border: "1px solid #e8edf3", borderRadius: 14,
                    overflow: "hidden", boxShadow: "0 1px 3px rgba(15,23,42,.05)" }}>
        {/* header */}
        <div className="pm-head" style={{ padding: "13px 16px", borderBottom: "1px solid #eef2f7",
                      display: "flex", alignItems: "center", gap: 11 }}>
          <span style={{ width: 34, height: 34, borderRadius: 9, background: "#2563eb", color: "#fff",
                         display: "inline-flex", alignItems: "center", justifyContent: "center",
                         fontSize: 17, flexShrink: 0 }}>🛠</span>
          <div className="pm-headtext" style={{ minWidth: 0 }}>
            <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 19, fontWeight: 800,
                          color: "#0f172a", lineHeight: 1.1 }}>PM This Month</div>
            <div style={{ fontSize: 10.5, color: "#8a94a6", fontWeight: 600 }}>
              {monthLbl} · {stats.total} Planned
            </div>
          </div>

        </div>

        {/* stats */}
        <div className="pm-stats" style={{ display: "grid", gap: 8, padding: "12px 14px", background: "#f8fafc",
                      borderBottom: "1px solid #eef2f7",
                      /* paanchon HAMESHA ek line me — warna "Compliance" akela
                         agli line me chala jaata tha aur adhoora lagta tha */
                      gridTemplateColumns: "repeat(5, minmax(0, 1fr))" }}>
          <_Stat n={stats.total}   label="Planned"    color="#0f172a" sub="" />
          <_Stat n={stats.due}     label="Due"        color="#c2410c" sub="" />
          <_Stat n={stats.done}    label="Completed"  color="#15803d" sub="" />
          <_Stat n={stats.overdue} label="Overdue"    color="#b91c1c" sub="" />
          <_Stat n={stats.pct}     label="Compliance" color="#2563eb" sub="%" />
        </div>

        {/* Chaudi jagah -> wahi poora table yahin; patli -> compact list */}
        {wide && data && !err && rows.length > 0 && fullBlock(false)}

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
          ) : null}
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

      {/* ── LINE ka POPUP — us line ki saari machine ──────────────────
          Bahar kahin bhi click, ✕, ya Esc se band.  `inset` jaan-boojh kar
          nahi (purana plant TV ka WebView use nahi samajhta) -- left/top/
          right/bottom alag-alag likhe hain. */}
      {modalGroup && (
        <div onClick={() => setModalGid("")}
             style={{ position: "fixed", left: 0, top: 0, right: 0, bottom: 0,
                      background: "rgba(15,23,42,.55)", display: "flex",
                      alignItems: "center", justifyContent: "center",
                      zIndex: 9999, padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()}
               style={{ background: "#fff", borderRadius: 16, width: "min(880px, 96vw)",
                        maxHeight: "86vh", display: "flex", flexDirection: "column",
                        boxShadow: "0 20px 60px rgba(0,0,0,.3)", overflow: "hidden" }}>
            <div style={{ padding: "14px 20px", borderBottom: "1px solid #e2e8f0",
                          background: "#f8fafc", display: "flex", alignItems: "center",
                          justifyContent: "space-between", gap: 12 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                  <_ZoneTag z={modalGroup.zone_name} />
                  <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 21,
                                 fontWeight: 800, color: "#0f172a" }}>{modalGroup.line || "—"}</span>
                  <_Pill k={modalGroup.key} />
                </div>
                <div style={{ fontSize: 11.5, color: "#8a94a6", fontWeight: 600, marginTop: 3 }}>
                  {modalGroup.n} {modalGroup.n === 1 ? "machine" : "machines"} · {monthLbl}
                  {" · "}{modalGroup.filled}/{modalGroup.n} sheet filled
                </div>
              </div>
              <button onClick={() => setModalGid("")} title="Close"
                      style={{ border: "1px solid #cbd5e1", background: "#fff", borderRadius: 8,
                               width: 34, height: 34, cursor: "pointer", fontSize: 16,
                               color: "#475569", flexShrink: 0, fontFamily: "inherit" }}>✕</button>
            </div>
            <div style={{ overflow: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
                <thead><tr>
                  {["Machine No.", "Machine Name", "Date", "Status", "Days Left", "Sheet"].map((h) => (
                    <th key={h} style={{ ...th, padding: "9px 14px", position: "sticky", top: 0,
                                         background: "#f1f5f9" }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {modalGroup.items.map((r, i) => (
                    <tr key={r.machine_code || i}>
                      <td style={{ ...td, padding: "9px 14px", fontWeight: 800, color: "#0f172a" }}>
                        {r.machine_code || "—"}
                      </td>
                      <td style={{ ...td, padding: "9px 14px", whiteSpace: "normal", color: "#475569" }}>
                        {r.machine_name || "—"}
                      </td>
                      <td style={{ ...td, padding: "9px 14px" }}>{dateTxt(r.win)}</td>
                      <td style={{ ...td, padding: "9px 14px" }}><_Pill k={r.key} /></td>
                      <td style={{ ...td, padding: "9px 14px", fontWeight: 800,
                                   color: daysColor(r.daysLeft, r.key === "COMPLETED") }}>
                        {daysTxt(r.daysLeft, r.key === "COMPLETED")}
                      </td>
                      <td style={{ ...td, padding: "9px 14px" }}><_Sheet filled={r.sheet_filled} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default PmThisMonth;
