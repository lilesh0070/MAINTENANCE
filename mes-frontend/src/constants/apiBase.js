/* apiBase.js — APK ke liye server ka pata jodne wala ek hi jagah ka intezaam.
 *
 * DIKKAT KYA HAI
 * --------------
 * Poore app me 183 jagah (50 file me) seedha `/api/...` likha hai.  Website par
 * ye chalta hai kyunki Vite ka dev-proxy `/api` ko `localhost:8892` par bhej
 * deta hai, aur deploy par site + API ek hi jagah se aate hain.
 *
 * Par APK me na proxy hota hai na server — app WebView ke andar khulti hai aur
 * wahan `/api/...` kahin nahi jaata.  Use poora pata chahiye.
 *
 * HAL
 * ---
 * Un 183 jagah ko haath lagane ke bajaye `fetch` aur `XMLHttpRequest` dono ko
 * EK BAAR beech me pakad lete hain:
 *
 *   • APK me chal raha ho     -> aage se server ka pura pata jod do
 *   • Website me chal raha ho -> kuch mat jodo, jaisa hai waisa jaane do
 *
 * Isliye WEBSITE PAR ISKA KOI ASAR NAHI HAI — wahan `API_BASE` khali rehta hai,
 * `installApiBase()` pehli line par hi laut jaata hai, aur `fetch`/`XHR` chhue
 * tak nahi jaate.  (Browser me jaanch kar dekha gaya hai.)
 *
 * DO SERVER KYUN
 * --------------
 * Wahi server do network par hai — Ethernet aur WiFi.  Phone aam taur par WiFi
 * par hota hai aur tab wo Ethernet wale subnet tak pahunch hi nahi sakta; ulta
 * laptop Ethernet par ho sakta hai.  Isliye dono ko EK SAATH tatolte hain aur
 * jo pehle jawab de wahi le lete hain — app kisi bhi network par chal jaye.
 * (Yahi soch backend me DB ke liye bhi lagi hai: DB_HOST + DB_HOST_ALT.)
 */

// Wahi server, do raaste.  Kram maayne nahi rakhta — dono ek saath tatolte hain.
const SERVERS = [
  "http://192.168.30.15:8892",     // Ethernet
  "http://192.168.100.24:8892",    // WiFi
];

const PROBE_MS = 2500;             // itni der me jawab na aaye to us raaste ko chhod do

/** APK ke andar chal rahe hain ya browser me?  (Layout aur Settings
 *  dono yahi poochhte hain — do jagah do copy rakhna galat hota.) */
export function isNativeApp() {
  if (typeof window === "undefined") return false;
  const c = window.Capacitor;
  if (c && typeof c.isNativePlatform === "function") return c.isNativePlatform();
  // Capacitor abhi load na hua ho to bhi pehchan lo — WebView ka apna scheme.
  return /^(capacitor|ionic|file):$/.test(window.location.protocol);
}

const NATIVE = isNativeApp();

// APK me body par ek nishaan laga dete hain, taaki CSS sirf app ke liye kuch
// badal sake aur WEBSITE BILKUL NA CHHUE.  (Jaise browser ka default
// `body { margin: 8px }` — website par wo jaisa hai waisa rehta hai, app me
// hata dete hain warna phone par kinare safed patti dikhti hai.)
if (typeof document !== "undefined" && NATIVE) {
  document.documentElement.classList.add("in-app");
  if (document.body) document.body.classList.add("in-app");
  else document.addEventListener("DOMContentLoaded", () => document.body.classList.add("in-app"));
}

/** Website par "" (kuch nahi jodo), APK par abhi jo raasta chal raha hai. */
export let API_BASE =
  (import.meta.env && import.meta.env.VITE_API_BASE) ||
  (NATIVE ? SERVERS[0] : "");

/** `/api/...` ko poora pata bana do — sirf jab zaroorat ho. */
export function withBase(url) {
  if (!API_BASE) return url;                       // website — kuch mat karo
  if (typeof url !== "string") return url;
  if (!url.startsWith("/")) return url;            // pehle se poora URL hai
  return API_BASE + url;
}

let installed = false;
let realFetch = null;

/** Dono raaston ko EK SAATH tatolo; jo pehle jawab de wahi le lo. */
async function pickServer() {
  if (!NATIVE || !realFetch) return API_BASE;
  const tryOne = (base) => new Promise((resolve, reject) => {
    const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const t = setTimeout(() => { try { ctl && ctl.abort(); } catch { /* ignore */ } reject(new Error("timeout")); }, PROBE_MS);
    // /api/auth/me bina token 401 deta hai — yahi kaafi hai ye jaanne ko ki
    // server zinda hai.  200 ka intezaar nahi karte.
    realFetch(base + "/api/auth/me", ctl ? { signal: ctl.signal } : undefined)
      .then(() => { clearTimeout(t); resolve(base); })
      .catch((e) => { clearTimeout(t); reject(e); });
  });
  try {
    const winner = await Promise.any(SERVERS.map(tryOne));
    API_BASE = winner;
  } catch {
    API_BASE = SERVERS[0];        // koi nahi mila — pehla hi rakho, error saaf aayega
  }
  return API_BASE;
}

/** Kabhi bhi dobara tatolna ho (jaise request fail hone par). */
export function reprobeServer() { return pickServer(); }

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

  realFetch = window.fetch.bind(window);

  // 1) fetch
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

  // 3) shuru me hi tay kar lo ki kaunsa raasta chalu hai.  App ko rokte nahi —
  //    pehli request tab tak SERVERS[0] par jayegi; jawab aate hi base badal
  //    jaata hai aur aage ki saari request sahi raaste par jaati hain.
  pickServer();
}
