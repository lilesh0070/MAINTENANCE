/* ───────────────────────────────────────────────────────────────────
 * slipType.js — "Slip Type" ki ek hi paribhasha (user 2026-09-23)
 * ───────────────────────────────────────────────────────────────────
 *   manual = maintenance_breakdown_data       (haath se bhari Break Down Slip)
 *   auto   = maintenance_auto_breakdown_slip  (ANDON call se bani slip)
 *   all    = dono
 *
 * Ye value jyon ki tyon server ke `src` me jaati hai (Phase2/bd_source.py).
 * ⚠ Auto slip sirf POORI BHAR KAR SUBMIT hone ke baad aati hai -- wo chhant
 *   server par hoti hai, yahan kuch nahi karna.
 * ⚠ DEFAULT har page par "manual" (user: "default sabme abhi manual slip ka
 *   rahega").  Badalna ho to sirf yahan badlega.
 *
 * Dikhne wala switch: components/SlipTypeTabs.jsx
 */
export const SLIP_TYPES = [
  ["manual", "Manual Slip"],
  ["auto",   "Auto Slip"],
  ["all",    "All"],
];

export const SLIP_DEFAULT = "manual";

/* Page ke subtitle me dikhane wala chhota naam (UI ka text angrezi me). */
export const SLIP_SUB = {
  manual: "manual slip",
  auto:   "auto slip",
  all:    "manual + auto slips",
};
