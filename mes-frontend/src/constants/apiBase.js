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

// Wahi server, do raaste.  Kram maayne nahi rakhta — sab ek saath tatolte hain
// aur jo pehle jawab de wahi chun liya jaata hai, isliye ek pata aur jodne se
// koi der nahi hoti.
const SERVERS = [
  "http://192.168.30.15:8892",     // plant server — Ethernet
  "http://192.168.100.24:8892",    // plant server — WiFi
];

const PROBE_MS = 2500;
// Har API request ki hadd -- par DO alag, kyunki dono haalat bahut alag hain:
//
//   server mil gaya    -> 20s.  Plant me sab kuch LAN par hai aur ~15ms me
//                         aata hai; ye lambi hadd sirf kisi bhaari report ke
//                         liye hai, taaki wo bewajah fail na ho.
//   server nahi mila   -> 3.5s.  Shuru me hi dono raaste tatol liye gaye the
//                         aur koi nahi mila -- ab 15 second aur rukne ka koi
//                         matlab nahi, jawab aana hi nahi hai.  Jaldi fail ho
//                         to page ka apna catch chal jaata hai aur user ko
//                         khaali screen ki jagah error dikhta hai.
//
// (Bina iske Maintenance Dashboard 16 SECOND tak khaali 'Loading...' dikhata
//  tha -- itna koi nahi rukta, log samajhte hain app hi kharab hai.)
const REQ_TIMEOUT_OK   = 20000;
const REQ_TIMEOUT_DOWN = 3500;
let serverMila = false;          // pickServer() ise sach batata hai
const reqTimeout = () => (serverMila ? REQ_TIMEOUT_OK : REQ_TIMEOUT_DOWN);             // itni der me jawab na aaye to us raaste ko chhod do

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

/**
 * Status bar ko app ke upar se hatao.
 *
 * Android 15 (SDK 35) se app apne aap edge-to-edge chalti hai -- yaani page
 * status bar ke NEECHE chala jaata hai aur time/battery content par chadh
 * jaate hain.
 *
 * Iska CSS wala ilaaj `env(safe-area-inset-top)` hai, PAR wo yahan bharosemand
 * nahi nikla: bilkul wahi build emulator me kabhi 52px deta tha aur kabhi 0.
 * Matlab dikkat bina kisi wajah ke kabhi bhi wapas aa sakti thi.  Isliye CSS
 * par chhodne ke bajaye Android se hi kehte hain ki WebView ko status bar ke
 * neeche se hata de -- phir naap ka andaza lagana hi nahi padta.
 *
 * WEBSITE PAR KUCH NAHI: NATIVE false hone par ye pehli line par laut jaata
 * hai, aur `import` bhi andar hai to plugin ka code website ke bundle me
 * jaata hi nahi.
 */
async function setupStatusBar() {
  if (!NATIVE) return;
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setOverlaysWebView({ overlay: false });   // app ko neeche khisko
    await StatusBar.setBackgroundColor({ color: '#ffffff' }); // header jaisa safed
    await StatusBar.setStyle({ style: Style.Light });         // safed par gehre icon
  } catch {
    // Plugin na mile (purani APK) to app pehle jaisi hi chalti rahe --
    // status bar chadha rahega, par kuch tootega nahi.
  }
}
/* ─── Phone ka BACK button ─────────────────────────────────────
 * Bina `@capacitor/app` ke phone ka back JS tak pahunchta hi nahi --
 * Capacitor seedha activity band kar deta hai, yaani APP MINIMISE ho jaati
 * hai.  Jaancha tha: dashboard -> Breakdown -> BD History (history 3) ke
 * baad back dabane par launcher aa gaya, page peeche nahi gaya.
 *
 * Ab: pehle koi khula hua modal band karo; phir peeche jaane laayak history
 * ho to peeche jao; aur ghar (dashboard/login) par ho to app se bahar.
 *
 * Sirf APK me -- website par ye import chalta hi nahi (NATIVE false hai).
 */
async function setupBackButton() {
  if (!NATIVE) return;
  try {
    const { App } = await import('@capacitor/app');
    App.addListener('backButton', () => {
      // 1) Break Down Slip jaisa modal khula ho to pehle wahi band karo,
      //    warna bhara hua form bina bataye chala jayega.
      const x = document.querySelector('.bds-close-x');
      if (x && x.getBoundingClientRect().width > 0) { x.click(); return; }

      // 2) peeche jaane laayak jagah hai?
      const p = window.location.pathname;
      const ghar = p === '/' || p === '/login' || p === '/dashboard';
      if (!ghar && window.history.length > 1) { window.history.back(); return; }

      // 3) ghar par hain -- ab back ka matlab app se bahar
      App.exitApp();
    });
  } catch {
    // Plugin na mile (purani APK) to pehle jaisa hi chalta rahe.
  }
}

let installed = false;
let realFetch = null;

// Pichhli baar jo server chala tha uska pata yahan yaad rehta hai.
// (localStorage app me tikta hai -- `androidScheme: https` ke baad.)
const PICKED_KEY = "mes_last_server";

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
  // Pichhli baar jo server mila tha, use PEHLE akela aazmao.  Plant me raasta
  // roz wahi rehta hai, aur tab dono ko tatolne me lagne wale ~700ms har baar
  // app khulne par bach jaate hain (naapa gaya).  Wo na mile to neeche wala
  // poora race chalta hai, yaani network badle to bhi app khud sambhal leti hai.
  let yaad = null;
  try { yaad = localStorage.getItem(PICKED_KEY); } catch { /* ignore */ }
  if (yaad && SERVERS.includes(yaad)) {
    try {
      API_BASE = await tryOne(yaad);
      serverMila = true;
      return API_BASE;
    } catch { /* nahi mila -- neeche sabko aazmate hain */ }
  }

  try {
    const winner = await Promise.any(SERVERS.map(tryOne));
    API_BASE = winner;
    serverMila = true;            // ab lambi hadd theek hai (bhaari report chal sake)
    try { localStorage.setItem(PICKED_KEY, winner); } catch { /* ignore */ }
  } catch {
    API_BASE = SERVERS[0];        // koi nahi mila — pehla hi rakho, error saaf aayega
    serverMila = false;           // ab jaldi fail karo, 15s rukna bekaar hai
    try { localStorage.removeItem(PICKED_KEY); } catch { /* ignore */ }
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
  //
  // TIMEOUT bhi yahin lagta hai.  Jab server pahunch me na ho (WiFi gaya, ya
  // phone doosre network par hai), to connection na safal hota hai na fail --
  // wo bas LATKA reh jaata hai.  Aisi request ka `await` kabhi lautta hi nahi,
  // isliye jo page `loading` par gate karte hain wo HAMESHA ke liye
  // "Loading..." par atak jaate hain, error tak nahi dikhta.  (Maintenance
  // Dashboard par yahi hua tha: har second nayi call jaati rahi, ek bhi lauti
  // nahi, aur `finally { setLoading(false) }` kabhi chala hi nahi.)
  //
  // Jis call ne apna `signal` diya hai use haath nahi lagate -- wo apna intezaam
  // khud kar rahi hai.
  const withTimeout = (url, opts) => {
    if (opts && opts.signal) return realFetch(url, opts);
    if (typeof AbortController === "undefined") return realFetch(url, opts);
    const ctl = new AbortController();
    // abort() ko WAJAH dena zaroori hai.  Bina wajah ke browser khud ka
    // sandesh deta hai -- "signal is aborted without reason" -- aur wahi
    // seedha screen par laal me chhap jaata tha.  User ke liye uska koi
    // matlab nahi.  Apni wajah dene se page ke catch me yahi sandesh aata hai.
    const t = setTimeout(() => {
      try { ctl.abort(new Error("Could not reach the server — please check the network")); }
      catch { try { ctl.abort(); } catch { /* ignore */ } }
    }, reqTimeout());
    return realFetch(url, { ...(opts || {}), signal: ctl.signal })
      .finally(() => clearTimeout(t));
  };
  window.fetch = (input, init) => {
    if (typeof input === "string") return withTimeout(withBase(input), init);
    // Request object aaya ho to uska url badal kar naya banao
    if (input && typeof input === "object" && typeof input.url === "string"
        && input.url.startsWith("/")) {
      return withTimeout(new Request(withBase(input.url), input), init);
    }
    return withTimeout(input, init);
  };

  // 2) XMLHttpRequest (axios isi par chalta hai)
  const XHR = window.XMLHttpRequest;
  if (XHR && XHR.prototype && XHR.prototype.open) {
    const realOpen = XHR.prototype.open;
    XHR.prototype.open = function (method, url, ...rest) {
      // axios/XHR par bhi wahi hadd -- warna wahan bhi request latki reh jaati.
      if (!this.timeout) this.timeout = reqTimeout();
      return realOpen.call(this, method, withBase(url), ...rest);
    };
  }

  // 3) shuru me hi tay kar lo ki kaunsa raasta chalu hai.  App ko rokte nahi —
  //    pehli request tab tak SERVERS[0] par jayegi; jawab aate hi base badal
  //    jaata hai aur aage ki saari request sahi raaste par jaati hain.
  pickServer();

  // 4) status bar ko app ke upar se hata do (upar wali tippani dekhein)
  setupStatusBar();
  setupBackButton();
}
