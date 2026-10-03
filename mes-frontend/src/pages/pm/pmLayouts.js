/* pm/pmLayouts.js — PM check sheet ke do LAYOUT (user 2026-10-03).
 *
 * "update wale option me preventive wale me option do kaunsa format use karna
 *  hai -- ek format aur banayenge, jo chahiye wo save kar lunga to wahi aayega.
 *  Status ko Method ke baad le aao; status ka OK/NG dropdown hata do -- pehli
 *  click par OK, doosri par NG, teesri par khaali; OK par Observation aur
 *  Action Taken nahi dikhega, NG par dikhega; Spares aur Sign column hata do
 *  kyunki sign neeche hai hi."
 * Phir (usi din): "status ke aage spare ka column -- pehli click YES, doosri
 *  NO; YES par neeche spare list me Where Used me point no. apne aap" -- Format
 *  2 me SPARES USED (YES / NO) wapas aaya, `spares_used` key me hi.  Neeche ki
 *  list se jod: ./pmSpares.js.
 *
 *   classic       -- purana (9 column) jaisa tha waisa; column ke naam DB ke
 *                    format (`f.columns`) se
 *   status_first  -- naya (8 column)
 *
 * Chuna hua layout format JSON ki `layout` key me (Document Update -> PM Check
 * Sheet -> Format, sirf admin).  Bhari hui sheet apna layout `doc_footer.layout`
 * snapshot me rakhti hai -- purani (bina layout) = classic.  Backend wahi niyam:
 * Phase2/routers/pm.py `_PM_LAYOUTS` / `_layout_saaf`.
 *
 * Component file se ALAG -- warna Fast Refresh ka niyam (sirf component export)
 * toot-ta.
 */
export const PM_LAYOUTS = {
  classic: {
    key: "classic",
    name: "Format 1 — Standard",
    desc: "9 columns: Observation, Action Taken, Spares Used, Status (OK / NG list) and Sign on every row.",
    columns: null,                         // DB ke format wale naam
    widths: ["4%", "20%", "14%", "10%", "16%", "13%", "9%", "6%", "8%"],
    fill: ["observation", "action_taken", "spares_used", "status", "sign"],
    fillLbl: ["Observation", "Action Taken", "Spares Used", "Status", "Sign"],
    statusClick: false,
    spareClick: false,                     // Spares Used ka per-row khaana khaali hi rehta
    ngOnly: [],
  },
  status_first: {
    key: "status_first",
    name: "Format 2 — Status after Method",
    desc: "8 columns: Status right after Method (tap: OK → NG → clear), then Spares Used (tap: YES → NO → clear) — YES adds that point to the “Spares Used” list below. Observation and Action Taken open only for NG points. No Sign column — signatures stay at the bottom.",
    columns: ["S.NO.", "CHECK POINTS / DETAIL OF WORK", "JUDGEMENT STANDARD", "METHOD",
              "STATUS", "SPARES USED", "OBSERVATION OF CHECK POINTS", "ACTION TAKEN"],
    widths: ["4%", "23%", "15%", "11%", "7%", "8%", "17%", "15%"],
    fill: ["status", "spares_used", "observation", "action_taken"],
    fillLbl: ["Status", "Spares Used", "Observation", "Action Taken"],
    statusClick: true,
    spareClick: true,                      // tap: khaali -> YES -> NO -> khaali
    ngOnly: ["observation", "action_taken"],
  },
};

export const PM_LAYOUT_KEYS = Object.keys(PM_LAYOUTS);

/** Format (`f`) ka layout -- anjaan / khaali = classic. */
export const pmLayout = (f) => PM_LAYOUTS[f?.layout] || PM_LAYOUTS.classic;

/** Bhari hui sheet ka layout uske snapshot se (purani = classic). */
export const sheetLayoutKey = (docFooter) =>
  (docFooter && PM_LAYOUTS[docFooter.layout] ? docFooter.layout : "classic");

/** Status ki click: khaali -> OK -> NG -> khaali. */
export const nextStatus = (s) => (s === "OK" ? "NG" : s === "NG" ? "" : "OK");

/** Save se pehle: status_first me OK / khaali point ka Observation / Action
 *  aur har row ka sign nahi jaata; Spares Used sirf YES / NO (server bhi yahi
 *  karta hai). */
export function layoutSaaf(entries, layoutKey) {
  if (layoutKey !== "status_first") return entries;
  return (entries || []).map((e) => {
    const ng = String(e.status || "").trim().toUpperCase() === "NG";
    const sp = String(e.spares_used || "").trim().toUpperCase();
    return { ...e, observation: ng ? (e.observation || "") : "", action_taken: ng ? (e.action_taken || "") : "",
             sign: "", spares_used: sp === "YES" || sp === "NO" ? sp : "" };
  });
}
