/* clientServices.js — kaunsi service IS device par chale (Website ya App).
 *
 * Admin tay karta hai: Maintenance Panel → "Services" tab
 * (GET/PUT /api/client-services).  User 2026-09-19: "har service ka option
 * website aur app ke liye alag; abhi website ke liye sab band, zaroorat hogi
 * tab chalu kar lenge."
 *
 *   andon_alert        nayi ANDON call par popup + beep (app me vibration)
 *   walkie             walkie ka socket: online, buzz ka parda, chat patti, aawaz
 *   walkie_background  (sirf app) app band hone par bhi sunna — Android service.
 *                      2026-09-19 se ANDON bhi isi service ke socket se aata hai.
 *
 * "App" = APK (phone / tablet / TV), "Website" = browser.
 *
 * DEFAULT — server na mile / purana backend ho: website par BAND, app par
 * CHALU.  Wahi jo backend ka DEFAULT hai, taaki pehli request aane se pehle
 * bhi website kuch na chalaye aur app pehle jaisi chale.
 */
import { useSyncExternalStore } from "react";
import { isNativeApp } from "./apiBase";

export const PLATFORM = isNativeApp() ? "app" : "web";

export const SERVICE_DEFAULTS = {
  andon_alert:       { web: false, app: true },
  walkie:            { web: false, app: true },
  walkie_background: { web: false, app: true },
};

let cfg = SERVICE_DEFAULTS;
/* IS user ke device par ANDON popup ki ring bajegi?  Admin → Services →
   "ANDON ring" (ID ke hisaab se).  Default HAAN -- purana server ye bhejta hi
   nahi, tab bhi pehle jaisa bajta rahe. */
let ring = true;
const subs = new Set();

/** Poora haal badlo (server se aaya, ya admin ne abhi save kiya). */
export function setServices(s) {
  const next = {};
  Object.keys(SERVICE_DEFAULTS).forEach((k) => {
    next[k] = { ...SERVICE_DEFAULTS[k], ...((s && s[k]) || {}) };
  });
  cfg = next;
  subs.forEach((f) => f());
}

/** Server se taaza haal.  Fail ho to jo hai wahi (pehli baar = DEFAULT). */
export async function loadServices(token) {
  if (!token) return;
  try {
    const r = await fetch("/api/client-services/", { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) return;
    const d = await r.json();
    if (d) ring = d.andon_ring !== false;
    if (d && d.services) setServices(d.services);
    else subs.forEach((f) => f());
  } catch { /* server na mile to jo tha wahi chalne do */ }
}

/** Is device (website / app) par ye service chalu hai? */
export const serviceOn = (key) => !!(cfg[key] && cfg[key][PLATFORM]);

/** React ke liye — haal badalte hi component dobara bane. */
export function useServiceOn(key) {
  return useSyncExternalStore(
    (f) => { subs.add(f); return () => subs.delete(f); },
    () => serviceOn(key),
  );
}

/** Is user par ANDON popup ki ring (beep) baje? — admin → Services → "ANDON ring". */
export function useAndonRing() {
  return useSyncExternalStore(
    (f) => { subs.add(f); return () => subs.delete(f); },
    () => ring,
  );
}
