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
 * Point ka `type` (master `maintenance_pm_check_point.type`): ALPHABET /
 * NUMBER (jaise 3ph/210 Vac ±10 -- multimeter ki value).  Teesri baar user ne
 * tay kiya: STATUS sirf OK / NG -- HAR point par; NUMBER point ki READING
 * OBSERVATION me ("240VAC", "210 VAC" -- pehle number, aage kuch bhi), OK ho
 * ya NG dono me zaroori.  Ye `type` check sheet par koi column NAHI -- sirf
 * bharne ka tareeqa badalta hai.  Server bhi yahi jaanchta hai
 * (Phase2/routers/pm.py `_number_jaanch`, `_layout_saaf`). */
export const isNumPoint = (p) => String((p && p.type) || "").trim().toUpperCase() === "NUMBER";

/** Reading (NUMBER point ka Observation): PEHLE number, uske baad jo chahe (user 2026-10-03: "number daalne
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
/** NUMBER point ki reading (Observation) number se shuru hoti hai? */
export const readingOk = (p) => NUM_RE.test(String((p && p.observation) || "").trim());
/** NG point par Observation aur Action dono likhe hain?  ("-" = khaali -- wo
 *  sirf OK ka default hai; user: "jisko NG kar diya usme observation aur action
 *  dono fill hone chahiye, NG karne par - hat jayega") */
export const ngFilled = (p) => !!String((p && p.observation) || "").trim()
  && !["", "-"].includes(String((p && p.action_taken) || "").trim());
/** Point bhara hua hai?  STATUS (OK / NG) har point par; NUMBER par Observation
 *  me reading; NG par Observation + Action. */
export const statusFilled = (p) => {
  const st = String((p && p.status) || "").trim().toUpperCase();
  if (!st) return false;
  if (isNumPoint(p) && !readingOk(p)) return false;
  return st !== "NG" || ngFilled(p);
};

/* ── OK point ka default (user 2026-10-03) ─────────────────────────────
 * "jis status me OK aa raha hai uske observation of check point me default
 *  FOUND OK aa jaye aur action taken me - likha aa jaye".  Server bhi yahi
 *  lagata hai (pm.py `OK_OBS` / `OK_ACT`, `_layout_saaf`). */
export const OK_OBS = "FOUND OK";
export const OK_ACT = "-";

/** STATUS badla -- fill me kya-kya badle (patch).
 *  Action: OK aate hi khaali ho to "-" (user: "action me default - wala hi
 *    rahega, baad me change kar sakte"); NG ya status hata to wahi "-" saaf --
 *    NG par asli action likhna zaroori ("NG karne par - hat jayega").
 *  Observation (sirf ALPHABET): OK par khaali ho to "FOUND OK"; OK se hata to
 *    wahi default saaf.  NUMBER par Observation = reading -- chhedte nahi. */
export function statusPatch(prev, nayi) {
  const patch = { status: nayi };
  const st = String(nayi || "").trim().toUpperCase();
  const was = String((prev && prev.status) || "").trim().toUpperCase();
  const act = String((prev && prev.action_taken) || "").trim();
  if (st === "OK" && !act) patch.action_taken = OK_ACT;
  else if (st !== "OK" && act === OK_ACT) patch.action_taken = "";
  if (!isNumPoint(prev)) {
    if (st === "OK") {
      if (!String((prev && prev.observation) || "").trim()) patch.observation = OK_OBS;
    } else if (was === "OK" && (prev && prev.observation) === OK_OBS) {
      patch.observation = "";
    }
  }
  return patch;
}

/** Save se pehle: status_first me OK / khaali point ka Observation / Action
 *  aur har row ka sign nahi jaata; Spares Used sirf YES / NO (server bhi yahi
 *  karta hai). */
export function layoutSaaf(entries, layoutKey) {
  return (entries || []).map((e) => {
    const num = isNumPoint(e);
    const st = String(e.status || "").trim().toUpperCase();
    const has = st === "OK" || st === "NG";
    const ok = !num && st === "OK";
    // Action: OK par default "-" (khaali ho to) -- likha hua nahi chhedte; NG par
    // asli likha hona zaroori (save gate), default nahi
    const act = st === "OK" && !String(e.action_taken || "").trim() ? OK_ACT : (e.action_taken || "");
    if (layoutKey !== "status_first") {
      // classic: OK (alphabet) par khaali Observation me default
      return { ...e, action_taken: act,
               observation: ok && !String(e.observation || "").trim() ? OK_OBS : (e.observation || "") };
    }
    const sp = String(e.spares_used || "").trim().toUpperCase();
    return { ...e,
             // OK (alphabet) = pakka "FOUND OK"; NUMBER = reading; NG = likha; khaali status = saaf
             observation: ok ? OK_OBS : (num || st === "NG") ? (e.observation || "") : "",
             action_taken: (num || has) ? act : "",
             sign: "", spares_used: sp === "YES" || sp === "NO" ? sp : "" };
  });
}
