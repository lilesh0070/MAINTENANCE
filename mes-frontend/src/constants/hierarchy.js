/* constants/hierarchy.js — maintenance ki HIERARCHY (user 2026-10-03):
 *   "attendance me hierarchy ke hisaab se naam aaye upar se neeche -- main
 *    dashboard me shift ke hisaab se, aur attendance panel me bhi."
 * Upar se: Manager, Deputy Manager, Assistant Manager, Senior Engineer,
 * Engineer, Supervisor, DET; anjaan sabse neeche.  (User ne theek kiya:
 * "supervisor pehle aana tha, DET baad me".)
 *
 * Server (Phase2/routers/attendance.py `_RANK`) har aadmi ke saath `rank`
 * bhejta hai -- wahi pehle maana jaata hai.  Purana server na bheje to
 * designation ke naam se (board par designation = role ka naam).  Kram
 * dono jagah EK hi rakhna.
 */
export const RANK = {
  senior_manager: 0, manager: 1, deputy_manager: 2, assistant_manager: 3,
  senior_engineer: 4, engineer: 5, supervisor: 6, det: 7,
};
export const RANK_BAAKI = 9;

const kunji = (s) => String(s || "").trim().toLowerCase().replace(/[^a-z]+/g, "_").replace(/^_+|_+$/g, "");

/** Aadmi ({rank?, role?, designation?}) ka kram -- chhota = upar. */
export function rankOf(p) {
  if (p && typeof p.rank === "number" && Number.isFinite(p.rank)) return p.rank;
  const r = kunji(p && p.role);
  if (r in RANK) return RANK[r];
  const d = kunji(p && p.designation);
  return d in RANK ? RANK[d] : RANK_BAAKI;
}

/** Hierarchy kram me naya array -- barabar pad par pehle wala kram hi (purane
 *  TV WebView ka sort "stable" nahi hota, isliye index bhi saath). */
export function byRank(list) {
  return (list || []).map((p, i) => [p, i])
    .sort((a, b) => rankOf(a[0]) - rankOf(b[0]) || a[1] - b[1])
    .map((x) => x[0]);
}
