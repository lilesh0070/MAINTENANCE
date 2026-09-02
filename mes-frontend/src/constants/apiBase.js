/* apiBase.js — APK ke liye API ka pata jodne wala ek hi jagah ka intezaam.
 *
 * DIKKAT KYA HAI
 * --------------
 * Poore app me 183 jagah (50 file me) seedha `/api/...` likha hai.  Website par
 * ye chalta hai kyunki Vite ka dev-proxy `/api` ko `localhost:8892` par bhej
 * deta hai, aur deploy par site + API ek hi jagah se aate hain.
 *
 * Par APK me na proxy hota hai na server — app `http://localhost` (WebView ke
 * andar) se khulti hai, aur wahan `/api/...` kahin nahi jaata.  Use poora pata
 * chahiye: `http://192.168.30.15:8892/api/...`
 *
 * HAL
 * ---
 * Un 183 jagah ko haath lagane ke bajaye `fetch` aur `axios` ko EK BAAR beech
 * me pakad lete hain:
 *
 *   • APK me chal raha ho   -> aage se server ka pura pata jod do
 *   • Website me chal raha ho -> kuch mat jodo, jaisa hai waisa jaane do
 *
 * Isliye WEBSITE PAR ISKA KOI ASAR NAHI HAI — wahan `API_BASE` khali rehta hai
 * aur `/api/...` bilkul pehle jaisa proxy se jaata hai.
 *
 * Server ka pata badalna ho to sirf `SERVER` badlein (ya build ke waqt
 * VITE_API_BASE de dein) — baaki app ko chhune ki zaroorat nahi.
 */

// Plant ka server.  APK sirf isi par jayegi.
const SERVER = "http://192.168.30.15:8892";

/** APK ke andar chal rahe hain ya browser me? */
function isNativeApp() {
  if (typeof window === "undefined") return false;
  // Capacitor 7 window par `Capacitor` rakhta hai; native par isNativePlatform() true.
  const c = window.Capacitor;
  if (c && typeof c.isNativePlatform === "function") return c.isNativePlatform();
  // Capacitor abhi load na hua ho to bhi pehchan lo — WebView ka apna scheme.
  return /^(capacitor|ionic|file):$/.test(window.location.protocol);
}

/** Website par "" (kuch nahi jodo), APK par server ka pura pata. */
export const API_BASE =
  (import.meta.env && import.meta.env.VITE_API_BASE) ||
  (isNativeApp() ? SERVER : "");

/** `/api/...` ko poora pata bana do — sirf jab zaroorat ho. */
export function withBase(url) {
  if (!API_BASE) return url;                       // website — kuch mat karo
  if (typeof url !== "string") return url;
  if (!url.startsWith("/")) return url;            // pehle se poora URL hai
  return API_BASE + url;
}

let installed = false;

/**
 * Network ke DONO raaste ek baar lapet do.  `main.jsx` me sabse upar ek baar
 * bulao.  Website par ye kuch karta hi nahi (API_BASE khali hai), isliye
 * chalti hui site par asar SHOONYA hai.
 *
 * Dono kyun: app me `fetch` bhi chalta hai aur `axios` bhi.  axios browser me
 * XMLHttpRequest use karta hai, `fetch` nahi — isliye sirf fetch lapetne se
 * axios wali call chhoot jaati.  Dono lapetne se kisi bhi page ko haath nahi
 * lagana padta.
 */
export function installApiBase() {
  if (installed || !API_BASE) return;              // website par yahin ruk jaata hai
  installed = true;

  // 1) fetch
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    if (typeof input === "string") return realFetch(withBase(input), init);
    // Request object aaya ho to uska url badal kar naya banao
    if (input && typeof input === "object" && typeof input.url === "string"
        && input.url.startsWith("/")) {
      return realFetch(new Request(withBase(input.url), input), init);
    }
    return realFetch(input, init);
  };

  // 2) XMLHttpRequest (axios isi par chalta hai)
  const XHR = window.XMLHttpRequest;
  if (XHR && XHR.prototype && XHR.prototype.open) {
    const realOpen = XHR.prototype.open;
    XHR.prototype.open = function (method, url, ...rest) {
      return realOpen.call(this, method, withBase(url), ...rest);
    };
  }
}
