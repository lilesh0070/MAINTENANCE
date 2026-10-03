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
    desc: "8 columns: Status right after Method (tap: OK → NG → clear), then Spares Used (tap: NO → YES → clear) — YES adds that point to the “Spares Used” list below. Observation and Action Taken open only for NG points. No Sign column — signatures stay at the bottom.",
    columns: ["S.NO.", "CHECK POINTS / DETAIL OF WORK", "JUDGEMENT STANDARD", "METHOD",
              "STATUS", "SPARES USED", "OBSERVATION OF CHECK POINTS", "ACTION TAKEN"],
    widths: ["4%", "23%", "15%", "11%", "7%", "8%", "17%", "15%"],
    fill: ["status", "spares_used", "observation", "action_taken"],
    fillLbl: ["Status", "Spares Used", "Observation", "Action Taken"],
    statusClick: true,
    spareClick: true,                      // tap: khaali -> NO -> YES -> khaali
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

/* ── Check point ka TYPE (user 2026-10-03) ─────────────────────────────
 * "jo number hai wahan number fill karenge, OK / NG nahi" -- point ka `type`
 * (master `maintenance_pm_check_point.type`): ALPHABET = OK / NG (pehle jaisa),
 * NUMBER = reading (jaise 3ph/210 Vac ±10 -- multimeter ki value).  NUMBER par
 * STATUS ke khaane me hi reading jaati hai; Observation / Action wahan hamesha
 * khule (OK / NG hai hi nahi).  Ye `type` check sheet par koi column NAHI --
 * sirf bharne ka tareeqa badalta hai.  Server bhi yahi jaanchta hai
 * (Phase2/routers/pm.py `_number_jaanch`, `_layout_saaf`). */
export const isNumPoint = (p) => String((p && p.type) || "").trim().toUpperCase() === "NUMBER";

/** Reading: PEHLE number, uske baad jo chahe (user 2026-10-03: "number daalne
 *  ke baad koi kuch likhna chahe to likh de -- jaise 8AMP, 120 VAC").  Shuru ke
 *  akshar (number se pehle) nahi lete; number aa gaya to aage sab chalta hai. */
export function numOnly(v) {
  const s = String(v || "").replace(/^\s+/, "");
  if (s === "" || s === "-") return s;                 // abhi likhna shuru kiya
  if (/^-?\d/.test(s)) return s.slice(0, 30);          // number se shuru -- aage kuch bhi
  const i = s.search(/\d/);
  if (i < 0) return "";                                // koi ank hi nahi -- kuch nahi
  const neg = i > 0 && s[i - 1] === "-";
  return ((neg ? "-" : "") + s.slice(i)).slice(0, 30);
}

const NUM_RE = /^-?\d+(\.\d+)?/;                      // SHURU me number (aage kuch bhi)
/** Point bhara hua hai?  ALPHABET = koi bhi STATUS; NUMBER = number se shuru. */
export const statusFilled = (p) => (isNumPoint(p)
  ? NUM_RE.test(String((p && p.status) || "").trim())
  : !!String((p && p.status) || "").trim());

/* ── OK point ka default (user 2026-10-03) ─────────────────────────────
 * "jis status me OK aa raha hai uske observation of check point me default
 *  FOUND OK aa jaye aur action taken me - likha aa jaye".  Server bhi yahi
 *  lagata hai (pm.py `OK_OBS` / `OK_ACT`, `_layout_saaf`). */
export const OK_OBS = "FOUND OK";
export const OK_ACT = "-";

/** STATUS badla -- fill me kya-kya badle (patch).  OK aaya: khaali Observation
 *  / Action me default; OK se hata: default hi pada ho to saaf (NG par asli
 *  likhna hai).  NUMBER point par kuch nahi (wahan OK / NG hai hi nahi). */
export function statusPatch(prev, nayi) {
  const patch = { status: nayi };
  if (isNumPoint(prev)) return patch;
  const isOk = String(nayi || "").trim().toUpperCase() === "OK";
  const wasOk = String((prev && prev.status) || "").trim().toUpperCase() === "OK";
  if (isOk) {
    if (!String((prev && prev.observation) || "").trim()) patch.observation = OK_OBS;
    if (!String((prev && prev.action_taken) || "").trim()) patch.action_taken = OK_ACT;
  } else if (wasOk) {
    if ((prev && prev.observation) === OK_OBS) patch.observation = "";
    if ((prev && prev.action_taken) === OK_ACT) patch.action_taken = "";
  }
  return patch;
}

/** Save se pehle: status_first me OK / khaali point ka Observation / Action
 *  aur har row ka sign nahi jaata; Spares Used sirf YES / NO (server bhi yahi
 *  karta hai). */
export function layoutSaaf(entries, layoutKey) {
  return (entries || []).map((e) => {
    const ok = !isNumPoint(e) && String(e.status || "").trim().toUpperCase() === "OK";
    if (layoutKey !== "status_first") {
      // classic: OK par khaali ho tabhi default (likha hua nahi chhedte)
      return ok ? { ...e, observation: String(e.observation || "").trim() ? e.observation : OK_OBS,
                    action_taken: String(e.action_taken || "").trim() ? e.action_taken : OK_ACT } : e;
    }
    // NUMBER point par OK / NG nahi -- Observation / Action hamesha rakho
    const ng = isNumPoint(e) || String(e.status || "").trim().toUpperCase() === "NG";
    const sp = String(e.spares_used || "").trim().toUpperCase();
    return { ...e,
             observation: ok ? OK_OBS : ng ? (e.observation || "") : "",
             action_taken: ok ? OK_ACT : ng ? (e.action_taken || "") : "",
             sign: "", spares_used: sp === "YES" || sp === "NO" ? sp : "" };
  });
}
