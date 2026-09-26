/* lazyRetry.js — page ki file (lazy chunk) na aaye to chup-chaap dobara koshish.
 *
 * User 2026-09-26: "koi API call na hui ya page par click karne par page load
 * na hua to 'Dashboard par jao / dobara dabao' aata hai."  Har page apni alag
 * file se khulta hai (App.jsx -- `lazy`), jo click ke PAL utarti hai.  Us pal
 * Wi-Fi / Cloudflare tunnel ek pal atka, ya server update ho raha tha, to file
 * nahi aati aur page gir jaata tha (ErrorBoundary).
 *
 * Ab 2 baar aur (0.8 s aur 1.6 s baad).  Phir bhi na aaye to galti upar
 * ErrorBoundary tak -- wo ise pehchaan kar connection lautte hi page apne aap
 * dobara kholta hai (components/ErrorBoundary.jsx).
 *
 * `load` wahi jo `lazy()` ko dete -- `() => import("./pages/X")`.
 */
import { lazy } from "react";

const ruko = (ms) => new Promise((r) => setTimeout(r, ms));

export default function lazyRetry(load, tries = 2) {
  return lazy(async () => {
    let last;
    for (let i = 0; i <= tries; i += 1) {
      try {
        return await load();
      } catch (e) {
        last = e;
        if (i < tries) await ruko(800 * (i + 1));
      }
    }
    throw last;
  });
}
