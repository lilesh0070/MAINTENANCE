/* ───────────────────────────────────────────────────────────────────
 * DmcSheet.jsx — TBDI Daily Machine Check Sheet (DMC) FORMAT renderer.
 * ───────────────────────────────────────────────────────────────────
 * Pure presentational (no state / no api).  Extracted from MachineDMC so the
 * Machine DMC page AND the Maintenance Panel → Machine DMC admin (View Sheet
 * tab) share ONE implementation — a layout change (e.g. removing the Japanese
 * category column) then shows identically in both places.
 *
 * Props:
 *   • hdr    — { zone, line, machine_no, machine_name, rev_no, rev_date, month }
 *   • groups — [{ eng, points:[pointRow|null] }]  (category-grouped rows;
 *              `null` points render a blank line for the blank format)
 *   • footer — { format_no, rev_no, rev_date }  optional doc-control footer
 *
 * Fill mode (Daily DMC Fill) — all optional, read-only path is untouched:
 *   • editable — when true, the 31 day cells become click-toggle (√/✗) and the
 *                sign-off rows become name inputs
 *   • values   — { `${point.id}_${day}`: "OK" | "NG" | "" }  current tick state
 *   • onToggle — (pointId, day) => void   cycles blank → OK → NG → blank
 *   • signs    — { operator, supervisor, maintenance }  sign-off CODES (each
 *                person types their own code; shown read-only when viewing)
 *   • onSign   — (key, value) => void
 *   • signableKeys — which sign-off codes are editable at this stage
 * ─────────────────────────────────────────────────────────────────── */
import { useState } from "react";

const DAYS  = Array.from({ length: 31 }, (_, i) => i + 1);

// How many days a YYYY-MM month actually has (28 / 29 / 30 / 31).  The sheet
// must render exactly that many day columns — Feb has no 29-31, April no 31.
export const monthDays = (ym) => {
  if (!ym) return 31;
  const [y, m] = String(ym).split("-").map((x) => parseInt(x, 10));
  if (!y || !m) return 31;
  return new Date(y, m, 0).getDate();
};
export const monthDayList = (ym) => Array.from({ length: monthDays(ym) }, (_, i) => i + 1);

// DMC sheet week blocks: WK1=1-7, WK2=8-14, WK3=15-21, WK4=22-28, WK5=29-31.
const WEEK_OF = (d) => (d <= 7 ? 1 : d <= 14 ? 2 : d <= 21 ? 3 : d <= 28 ? 4 : 5);
// Fortnight blocks used by 2W points: 1-14, 15-28, 29-31.
const BIWEEK_OF = (d) => (d <= 14 ? 1 : d <= 28 ? 2 : 3);

// Normalise the (English/Hindi) freq text into D / W / 2W / M.  SINGLE SOURCE —
// the fill page imports this too so the two can never drift apart.
export const freqClass = (freq) => {
  const f = (freq || "").trim();
  const lf = f.toLowerCase();
  if (lf === "2w" || f.includes("2 सप्तह") || f.includes("2सप्तह")) return "2W";
  if (lf === "w"  || f.includes("साप्ताहिक")) return "W";
  if (lf === "m"  || f.includes("प्रतिमाह")) return "M";
  return "D";   // D / प्रति दिन / प्रति दिन (CHANGE OVER…)
};

// ── FREQUENCY SCHEDULING ─────────────────────────────────────────────
// Which days make up the period a given day belongs to, and whether a point
// is still DUE on that day.  SINGLE SOURCE: the operator fill, the supervisor
// screen and the maintenance screen all import this, so the three stages can
// never disagree about when a W / 2W / M point is owed.
const _range = (a, b) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);
export const periodDays = (fc, d, ym) => {
  const L = monthDays(ym);
  if (fc === "W") {
    const wb = WEEK_OF(d);
    return _range((wb - 1) * 7 + 1, Math.min(wb === 5 ? L : wb * 7, L));
  }
  if (fc === "2W") {
    return d <= 14 ? _range(1, Math.min(14, L))
         : d <= 28 ? _range(15, Math.min(28, L))
         : _range(29, L);
  }
  return _range(1, L);                       // M — the whole month
};
// A ✗ never satisfies a period: the point keeps coming back until it is OK.
export const satisfiedMark = (v) => !!v && String(v).toUpperCase() !== "NG";
// `valueAt(pointId, day)` returns the SUBMITTED mark (history), not the draft.
export const isPointDue = (p, d, ym, valueAt) => {
  const fc = freqClass(p && p.freq);
  if (fc === "D") return true;
  return !periodDays(fc, d, ym).some((x) => x < d && satisfiedMark(valueAt(p.id, x)));
};

// Which STAGE of the chain owns a check point, from its RESP column.
// SINGLE SOURCE — the fill page, the supervisor page and the maintenance page
// all import this, so a point can never be fillable in two places at once.
//   OPERATOR     → operator     (Daily DMC Fill)
//   LINE LEADER  → supervisor   (Supervisor Verify — he fills his own points)
//   MAINTENANCE  → maintenance  (Maintenance Weekly — fills, then final submit)
// Anything unrecognised falls back to `operator`, so a point is never orphaned.
export const RESP_STAGE = (resp) => {
  const r = String(resp || "").trim().toUpperCase();
  if (r.includes("MAINT") || r.includes("मेंटेनेंस") || r.includes("मेन्टेनेंस")) return "maintenance";
  if (r.includes("LINE") || r.includes("LEADER") || r.includes("लाइन")) return "supervisor";
  return "operator";                       // OPERATOR / ऑपरेटर / blank
};
export const STAGE_LABEL = { operator: "Operator", supervisor: "Line Leader", maintenance: "Maintenance" };

// Canonical DMC category order (matches the paper format).
export const DMC_CAT_ORDER = ["Inspection", "Cleaning", "Lubrication", "Tightness"];

// Group flat check-point rows into the { eng, points } shape DmcSheet expects,
// known categories first (in DMC_CAT_ORDER), then any others.  Shared so the
// Machine DMC page and the admin View-Sheet tab group identically.
export function groupDmcPoints(points) {
  const by = {};
  (points || []).forEach((p) => {
    const c = p.category || "Uncategorized";
    (by[c] = by[c] || []).push(p);
  });
  const cats = [
    ...DMC_CAT_ORDER.filter((c) => by[c]),
    ...Object.keys(by).filter((c) => !DMC_CAT_ORDER.includes(c)),
  ];
  return cats.map((c) => ({ eng: c, points: by[c] }));
}

export function DmcSheet({ hdr = {}, groups = [], footer = null,
                           editable: editableProp = false, values = {}, onToggle = null, onSetValue = null,
                           signs = {}, onSign = null, reasons = {}, actions = {},
                           signableKeys = ["operator", "supervisor", "maintenance"],
                           signGrid = false, dayCodes = {}, weekCodes = {},
                           sheetMonth = "",
                           fillDay = null,          // the date this stage is writing to

                           days = sheetMonth ? monthDayList(sheetMonth) : DAYS,
                           dayBandLabel = "" }) {
  // `days` lets a caller show a subset of the 31 day columns — the Daily DMC
  // Fill page passes only today's day so the operator fills a single column.
  // "full month" = a whole month's worth of columns (28/29/30/31), not just 31.
  const fullMonth = days.length >= 28;
  // read-only reason viewer: click a ✗ cell (that has a reason) to see it
  const [reasonPop, setReasonPop] = useState(null);   // { text, sno, cp, x, y }
  const sb  = "1px solid #000";
  const signInp = { border: "none", borderBottom: "1px solid #cbd5e1", outline: "none", fontSize: 11.5,
                    fontWeight: 700, fontFamily: "inherit", padding: "1px 4px", minWidth: 240,
                    background: "#fffbeb", color: "#1d4ed8" };
  // Single source for the sign-off rows: [key, label, colour].  Both the simple
  // rows and the column grid read this, so the wording can never drift apart.
  const SIGN_ROWS = [
    ["operator",    "Checked By Machine Operator (Code):-",                      "#1d4ed8"],
    ["supervisor",  "Verified by Production Suprevisor (Code):-",                "#7c3aed"],
    ["maintenance", "Checked by (Maint/Utility/Tool Room/Area Incharge-Code):-", "#15803d"],
  ];
  // Sign-off is captured as a short CODE per person (not a drawn signature —
  // images bloat the record badly).  Callers narrow which codes are editable by
  // stage: the operator fill passes ["operator","maintenance"], the supervisor
  // verify passes ["supervisor"].
  const CAN_SIGN = new Set(signableKeys);
  // `editable` is either a BOOLEAN (whole sheet) or a PREDICATE (point) => bool.
  // The verify screens pass a predicate so one stage can fill its own rows while
  // the earlier stages' rows stay read-only on the very same sheet.
  const isEditable  = (p) => (typeof editableProp === "function" ? !!editableProp(p) : !!editableProp);
  const anyEditable = !!editableProp;      // the sign-off band is not per-point
  // consecutive runs of `days` that belong to the same week — the maintenance
  // sign-off spans a whole week, so its cell colSpans that run.
  const weekGroups = [];
  days.forEach((d) => {
    const wk = WEEK_OF(d);
    const last = weekGroups[weekGroups.length - 1];
    if (last && last.wk === wk) last.days.push(d);
    else weekGroups.push({ wk, days: [d] });
  });

  // A point's day cells are grouped by ITS OWN frequency, matching the paper
  // sheet: D → one box per day, W → one box per week, 2W → per fortnight,
  // M → a single box across the month.
  const cellGroups = (p) => {
    const fc = freqClass(p && p.freq);
    if (fc === "D") return days.map((d) => ({ days: [d] }));
    const keyOf = fc === "W" ? WEEK_OF : fc === "2W" ? BIWEEK_OF : () => 1;
    const out = [];
    days.forEach((d) => {
      const k = keyOf(d);
      const last = out[out.length - 1];
      if (last && last.k === k) last.days.push(d);
      else out.push({ k, days: [d] });
    });
    return out;
  };
  const lbl = { border: sb, padding: "3px 6px", fontSize: 11, fontWeight: 800, background: "#f3f4f6", whiteSpace: "nowrap" };
  const val = { border: sb, padding: "3px 6px", fontSize: 11.5, background: "#fff" };
  const th  = { border: sb, padding: "3px 4px", fontSize: 10, fontWeight: 800, background: "#f3f4f6", textAlign: "center" };
  const dayTh  = { ...th, width: 20, minWidth: 20, padding: "3px 1px", fontSize: 9 };
  const dcell  = { border: sb, height: 20, minWidth: 20, width: 20 };
  const detail = { border: sb, fontSize: 10.5, padding: "2px 5px", verticalAlign: "top" };
  const catCell = { ...detail, textAlign: "center", fontWeight: 800, background: "#f8fafc", verticalAlign: "middle" };

  return (
    <div style={{ background: "#fff", boxShadow: "0 4px 16px rgba(0,0,0,.12)", padding: 10, color: "#111827" }}>
      {/* title band */}
      <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}><tbody><tr>
        <td style={{ border: sb, width: 100, textAlign: "center" }}>
          <img src="/logo.jpg" alt="Toyota Boshoku" style={{ maxWidth: "100%", maxHeight: 48, objectFit: "contain", display: "block", margin: "0 auto" }} />
        </td>
        <td style={{ border: sb, textAlign: "center", padding: "4px 8px" }}>
          <div style={{ fontSize: 16, fontWeight: 900 }}>TOYOTA BOSHOKU DEVICE INDIA PVT LTD</div>
          <div style={{ fontSize: 13, fontWeight: 800, marginTop: 2 }}>Daily Machine Check Sheet (DMC)</div>
        </td>
        <td style={{ border: sb, width: 210, padding: 0, verticalAlign: "top", fontSize: 10.5 }}>
          <div style={{ borderBottom: sb, padding: "2px 5px", fontWeight: 700, textAlign: "center" }}>Check Sheet Points Revision history</div>
          <div style={{ borderBottom: sb, padding: "3px 5px" }}><b>Rev no.</b> {hdr.rev_no || ""}</div>
          <div style={{ padding: "3px 5px" }}><b>Rev date</b> {hdr.rev_date || ""}</div>
        </td>
      </tr></tbody></table>

      {/* header fields */}
      <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", borderTop: "none" }}><tbody>
        <tr>
          <td style={{ ...lbl, width: "12%" }}>Month</td><td style={{ ...val, width: "12%" }}>{hdr.month || ""}</td>
          <td style={{ ...lbl, width: "10%" }}>ZONE</td><td style={{ ...val, width: "14%" }}>{hdr.zone || ""}</td>
          <td style={{ ...lbl, width: "10%" }}>LINE</td><td style={{ ...val, width: "12%" }}>{hdr.line || ""}</td>
          <td style={{ ...lbl, width: "12%" }}>MACHINE_NO</td><td style={val}>{hdr.machine_no || ""}</td>
        </tr>
        <tr>
          <td style={lbl}>MACHINE_NAME</td><td style={val} colSpan={3}>{hdr.machine_name || ""}</td>
          <td style={lbl}>Date</td><td style={val} colSpan={3}>{hdr.date || ""}</td>
        </tr>
      </tbody></table>

      {/* the daily grid */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", tableLayout: "fixed", ...(fullMonth ? { minWidth: 1400 } : { width: "100%" }), borderTop: "none" }}>
          <colgroup>
            <col style={{ width: 70 }} /><col style={{ width: 200 }} />
            <col style={{ width: 120 }} /><col style={{ width: 90 }} /><col style={{ width: 44 }} /><col style={{ width: 44 }} />
            {days.map((d) => <col key={d} style={{ width: fullMonth ? 20 : days.length > 3 ? 46 : 140 }} />)}
          </colgroup>
          <thead>
            <tr>
              <td colSpan={6} style={{ ...lbl, background: "#fff", fontWeight: 700 }}>Note:- Please read legends before filling this sheet.</td>
              <td colSpan={days.length} style={{ ...th, background: "#fff" }}>Date</td>
            </tr>
            <tr>
              <td colSpan={2} style={{ ...lbl, background: "#fff", fontWeight: 700 }}>{hdr.zone ? `Zone:-   ${hdr.zone}` : "Zone:-"}</td>
              <td colSpan={4} style={th}>Standard</td>
              {fullMonth
                ? weekGroups.map((g) => <th key={g.wk} colSpan={g.days.length} style={th}>WK{g.wk}</th>)
                : <th colSpan={days.length} style={th}>{dayBandLabel || "Date"}</th>}
            </tr>
            <tr>
              <th colSpan={2} style={th}>Check Points</th>
              <th style={th}>Criteria</th><th style={th}>Method</th><th style={th}>Resp</th><th style={th}>Freq</th>
              {days.map((d) => <th key={d} style={dayTh}>{d}</th>)}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) =>
              g.points.map((p, i) => (
                <tr key={g.eng + i}>
                  {i === 0 && <td rowSpan={g.points.length} style={catCell}>{g.eng}</td>}
                  <td style={detail}>{p ? p.check_point : ""}</td>
                  <td style={detail}>{p ? p.criteria : ""}</td>
                  <td style={detail}>{p ? p.method : ""}</td>
                  <td style={{ ...detail, textAlign: "center" }}>{p ? p.resp : ""}</td>
                  <td style={{ ...detail, textAlign: "center", fontWeight: 700 }}>{p ? p.freq : ""}</td>
                  {!p
                    ? days.map((d) => <td key={d} style={dcell} />)
                    : cellGroups(p).map((grp) => {
                    const span = grp.days.length;
                    // A W/2W/M box spans several days.  Show the LATEST mark in
                    // the box (the final state — so an ✗ that was later fixed to
                    // ✓ reads correctly), but keep any ✗ reason from the box
                    // reachable so the remediation history isn't lost.
                    const marked = grp.days.filter((x) => values[`${p.id}_${x}`]);
                    // Which day this box writes to when it is still empty: the
                    // date actually being filled, never blindly the 1st of the
                    // period (a W box opened on the 20th must record the 20th).
                    const openDay = (fillDay != null && grp.days.includes(Number(fillDay)))
                      ? Number(fillDay) : grp.days[0];
                    const d = marked.length ? marked[marked.length - 1] : openDay;
                    // where inside a multi-day box the mark is drawn — under its
                    // own date column, not floating in the middle of the span
                    const slot = grp.days.indexOf(d);
                    const v = values[`${p.id}_${d}`] || "";
                    const dNg = grp.days.find((x) => values[`${p.id}_${x}`] === "NG"
                                                  && reasons[`${p.id}_${x}`]);
                    const isVal = (p.type || "").toLowerCase() === "value";
                    const dcellS = span > 1 ? { ...dcell, width: "auto", minWidth: 0 } : dcell;
                    // `editable` may be a BOOLEAN (whole sheet) or a PREDICATE
                    // (point) => bool.  The verify screens pass a predicate so a
                    // stage can fill its own rows while the earlier stages' rows
                    // stay read-only on the very same sheet.
                    const editable = isEditable(p);
                    // READ-ONLY (view / locked filled sheet): show the stored mark or value.
                    // A ✗ that carries a reason is clickable → shows the reason.
                    if (!editable) {
                      if (!v) return <td key={d} colSpan={span} style={dcellS} />;
                      const rKey = reasons[`${p.id}_${d}`] ? d : dNg;
                      const reason = rKey ? reasons[`${p.id}_${rKey}`] : "";
                      const action = rKey ? actions[`${p.id}_${rKey}`] : null;
                      const hasReason = !!reason;
                      // A ✗ whose NG has a corrective action recorded is CLOSED →
                      // keep the ✗ but show it YELLOW (amber) instead of red.  An
                      // open ✗ (no action yet) stays red.
                      const ngClosed = v === "NG" && !!action;
                      const tint = isVal ? "#eff6ff" : v === "OK" ? "#dcfce7"
                                 : v === "NG" ? (ngClosed ? "#fef9c3" : "#fee2e2") : "#fff";
                      const ink  = isVal ? "#1d4ed8" : v === "OK" ? "#16a34a"
                                 : v === "NG" ? (ngClosed ? "#a16207" : "#dc2626") : "#111827";
                      const glyph = isVal ? v : v === "OK" ? "✓" : v === "NG" ? "✗" : v;
                      return (
                        <td key={d} colSpan={span} title={hasReason ? reason : undefined}
                            onClick={hasReason ? (e) => setReasonPop({ text: reason, action, sno: p.s_no, cp: p.check_point, x: e.clientX, y: e.clientY }) : undefined}
                            style={{ ...dcellS, padding: 0, textAlign: "center", fontWeight: 800,
                                     height: fullMonth ? 20 : 30, fontSize: fullMonth ? 11 : days.length > 3 ? 13 : 15,
                                     cursor: hasReason ? "pointer" : "default",
                                     textDecoration: hasReason ? "underline" : "none",
                                     background: span > 1 ? "#fff" : tint,
                                     color: ink }}>
                          {span > 1 ? (
                            /* the box still spans the whole period (one box per
                               W / 2W / M), but the mark sits in the slot of the
                               DATE it was filled on — not centred across the span */
                            <div style={{ display: "flex", width: "100%", height: "100%" }}>
                              {grp.days.map((x, i) => (
                                <div key={x} style={{ flex: "1 1 0", minWidth: 0, display: "flex",
                                                      alignItems: "center", justifyContent: "center",
                                                      background: i === slot ? tint : "transparent" }}>
                                  {i === slot ? glyph : ""}
                                </div>
                              ))}
                            </div>
                          ) : glyph}
                        </td>
                      );
                    }
                    // EDITABLE "value" points: operator types the actual numeric reading
                    // (criteria e.g. "0.4Mpa to 0.6Mpa") — no ✓/✗ tick.
                    if (isVal) {
                      const inp = (
                        <input value={v} inputMode="decimal" placeholder="—"
                               onChange={(e) => onSetValue && onSetValue(p.id, d, e.target.value)}
                               style={{ width: "100%", height: "100%", boxSizing: "border-box", border: "none",
                                        outline: "none", textAlign: "center", background: "transparent",
                                        fontSize: fullMonth ? 10 : 15, fontWeight: 700, color: "#1d4ed8", fontFamily: "inherit" }} />
                      );
                      return (
                        <td key={d} colSpan={span}
                            style={{ ...dcellS, height: fullMonth ? 20 : 30, padding: 0,
                                     background: span > 1 ? "#fff" : (v ? "#eff6ff" : "#fff") }}>
                          {span > 1 ? (
                            /* the reading is typed under the date it belongs to */
                            <div style={{ display: "flex", width: "100%", height: "100%" }}>
                              {grp.days.map((x, i) => (
                                <div key={x} style={{ flex: "1 1 0", minWidth: 0,
                                                      background: i === slot && v ? "#eff6ff" : "transparent" }}>
                                  {i === slot ? inp : null}
                                </div>
                              ))}
                            </div>
                          ) : inp}
                        </td>
                      );
                    }
                    // EDITABLE "ok" points: ✓ / ✗ click-toggle
                    const tintE = v === "OK" ? "#dcfce7" : v === "NG" ? "#fee2e2" : "#fff";
                    const inkE  = v === "OK" ? "#16a34a" : v === "NG" ? "#dc2626" : "#cbd5e1";
                    const glyphE = v === "OK" ? "✓" : v === "NG" ? "✗" : "";
                    return (
                      <td key={d} colSpan={span} onClick={(e) => onToggle && onToggle(p.id, d, e)}
                          style={{ ...dcellS, cursor: "pointer", textAlign: "center", fontWeight: 800,
                                   padding: 0, height: fullMonth ? 20 : 30, fontSize: fullMonth ? 11 : 16,
                                   background: span > 1 ? "#fff" : tintE, color: inkE }}>
                        {span > 1 ? (
                          <div style={{ display: "flex", width: "100%", height: "100%" }}>
                            {grp.days.map((x, i) => (
                              <div key={x} style={{ flex: "1 1 0", minWidth: 0, display: "flex",
                                                    alignItems: "center", justifyContent: "center",
                                                    background: i === slot ? tintE : "transparent" }}>
                                {i === slot ? glyphE : ""}
                              </div>
                            ))}
                          </div>
                        ) : glyphE}
                      </td>
                    );
                  })}
                </tr>

              ))
            )}
          </tbody>
        </table>

        {/* sign-off — column grid, INSIDE the same scroll box as the day grid so
            there is only ONE scrollbar and the columns stay aligned while
            scrolling.  A single bold rule separates it from the points. */}
        {signGrid && (
          <table style={{ borderCollapse: "collapse", tableLayout: "fixed",
                          ...(fullMonth ? { minWidth: 1400 } : { width: "100%" }),
                          borderTop: "2px solid #000" }}>
            <colgroup>
              <col style={{ width: 70 }} /><col style={{ width: 200 }} />
              <col style={{ width: 120 }} /><col style={{ width: 90 }} /><col style={{ width: 44 }} /><col style={{ width: 44 }} />
              {days.map((d) => <col key={d} style={{ width: fullMonth ? 20 : days.length > 3 ? 46 : 140 }} />)}
            </colgroup>
            <tbody>
              {SIGN_ROWS.slice(0, 2).map(([k, label, col]) => (
                <tr key={k}>
                  <td colSpan={6} style={{ border: sb, padding: "7px 8px", fontSize: 11.5, fontWeight: 800 }}>{label}</td>
                  {days.map((d) => (
                    <td key={d} style={{ ...dcell, height: 22, textAlign: "center", overflow: "hidden",
                                         fontWeight: 800, color: col,
                                         fontSize: fullMonth ? 7.5 : days.length > 3 ? 10 : 12 }}>
                      {(dayCodes[k] || {})[String(d)] || ""}
                    </td>
                  ))}
                </tr>
              ))}
              <tr>
                <td colSpan={6} style={{ border: sb, padding: "7px 8px", fontSize: 11.5, fontWeight: 800 }}>
                  {SIGN_ROWS[2][1]}
                </td>
                {weekGroups.map((g) => (
                  <td key={g.wk} colSpan={g.days.length}
                      style={{ ...dcell, width: "auto", minWidth: 0, height: 22, textAlign: "center",
                               fontWeight: 800, color: SIGN_ROWS[2][2],
                               fontSize: fullMonth ? 9 : 11 }}>
                    {weekCodes[String(g.wk)] || ""}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        )}
      </div>

      {!signGrid && (
      <table style={{ width: "100%", borderCollapse: "collapse", borderTop: "2px solid #000" }}><tbody>
        {SIGN_ROWS.map(([k, label, col]) => {
          const canEditThis = anyEditable && CAN_SIGN.has(k);
          return (
            <tr key={k}><td style={{ border: sb, padding: "9px 8px 7px", fontSize: 11.5, fontWeight: 800 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span>{label}</span>
                {canEditThis
                  ? <input value={signs[k] || ""} maxLength={20} placeholder="Enter code"
                           onChange={(e) => onSign && onSign(k, e.target.value)} style={signInp} />
                  : <span style={{ fontWeight: 800, color: col, letterSpacing: ".06em" }}>{signs[k] || ""}</span>}
              </span>
            </td></tr>
          );
        })}
      </tbody></table>
      )}

      {/* legends */}
      <table style={{ width: "100%", borderCollapse: "collapse", borderTop: "none", tableLayout: "fixed" }}><tbody>
        <tr>
          <td style={{ ...lbl, width: "10%", textAlign: "center" }}>Legends</td>
          <td style={{ ...val, textAlign: "center", fontWeight: 800 }}>Tick (√)</td><td style={val}>If "OK"</td>
          <td style={{ ...val, textAlign: "center", fontWeight: 800 }}>Tick (X)</td><td style={val}>If "Not OK"</td>
          <td style={{ ...val, textAlign: "center", fontWeight: 800 }}>M</td><td style={val}>Monthly</td>
          <td style={{ ...val, textAlign: "center", fontWeight: 800 }}>W</td><td style={val}>Weekly</td>
          <td style={{ ...val, width: "26%", fontWeight: 700 }} rowSpan={2}>Note:- In case of any "Not OK" or abnormality, inform to Production suprevisor immediatley.</td>
        </tr>
        <tr>
          <td style={{ ...val, textAlign: "center", fontWeight: 800 }}>*</td>
          <td style={val} colSpan={4}>Please write actual value. Dont tick mark</td>
          <td style={{ ...val, textAlign: "center", fontWeight: 800 }}>D</td><td style={val}>Daily</td>
          <td style={val} colSpan={2} />
        </tr>
      </tbody></table>

      {/* document-control footer (bottom of sheet) — ALWAYS shown, like the PM
          check sheet.  Priority: admin-set format doc → a built-in default.
          We deliberately do NOT use the per-row machine_dmc.format_no here: in
          the imported data that column often holds the whole footer mashed into
          one string, which renders cramped.  Admins set a clean value via
          Maintenance Panel → Machine DMC → Format. */}
      {(() => {
        const DEFAULT_FOOTER = { format_no: "TBDI / MAINT. / F / 002", rev_no: "00", rev_date: "20/03/2024" };
        const f = (footer && (footer.format_no || footer.rev_no || footer.rev_date))
          ? footer
          : DEFAULT_FOOTER;
        return (
          <div style={{ textAlign: "center", fontSize: 11, fontWeight: 700, color: "#111827", padding: "8px 6px 2px", letterSpacing: ".02em" }}>
            FORMAT NO.:- {f.format_no || ""}
            <span style={{ display: "inline-block", width: 28 }} />REV. NO.:- {f.rev_no || ""}
            <span style={{ display: "inline-block", width: 20 }} />REV. DATE:- {f.rev_date || ""}
          </div>
        );
      })()}

      {/* reason popup — opens when a ✗ cell with a reason is clicked (view mode) */}
      {reasonPop && (
        <>
          <div onClick={() => setReasonPop(null)} style={{ position: "fixed", inset: 0, zIndex: 950 }} />
          <div onClick={(e) => e.stopPropagation()}
               style={{ position: "fixed", zIndex: 951, width: 290,
                        left: Math.max(12, Math.min(reasonPop.x, (typeof window !== "undefined" ? window.innerWidth : 1200) - 306)),
                        top: Math.min(reasonPop.y + 12, (typeof window !== "undefined" ? window.innerHeight : 800) - 170),
                        background: "#fff", borderRadius: 10, border: "1px solid #e2e8f0",
                        boxShadow: "0 12px 34px rgba(15,23,42,.28)", padding: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#b91c1c", marginBottom: 3 }}>✗ Not OK — reason</div>
            <div style={{ fontSize: 11.5, color: "#334155", marginBottom: 8 }}>#{reasonPop.sno} · {reasonPop.cp}</div>
            <div style={{ fontSize: 12.5, color: "#111827", background: "#f8fafc", border: "1px solid #e2e8f0",
                          borderRadius: 8, padding: "8px 10px", whiteSpace: "pre-wrap" }}>{reasonPop.text}</div>
            {reasonPop.action ? (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: "#15803d", marginBottom: 3 }}>✅ Action taken</div>
                <div style={{ fontSize: 12.5, color: "#111827", background: "#f0fdf4", border: "1px solid #bbf7d0",
                              borderRadius: 8, padding: "8px 10px", whiteSpace: "pre-wrap" }}>{reasonPop.action}</div>
              </div>
            ) : (
              <div style={{ fontSize: 11.5, color: "#b45309", fontWeight: 700, marginTop: 8 }}>
                ⏳ Not yet actioned — close it from Machine DMC → DMC NG Point.
              </div>
            )}
            <div style={{ textAlign: "right", marginTop: 10 }}>
              <button onClick={() => setReasonPop(null)}
                      style={{ padding: "5px 16px", borderRadius: 7, border: "none", background: "#334155",
                               color: "#fff", fontSize: 12, fontWeight: 800, cursor: "pointer" }}>Close</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default DmcSheet;
