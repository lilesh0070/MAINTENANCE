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
// Naam saath me isliye rakha hai ki Settings me "Ethernet" / "Wi-Fi" dikhana
// hai, aur pata + naam do alag jagah rakhne par ek din wo aapas me na milte.
const SERVERS = [
  { url: "http://192.168.30.15:8892",  naam: "Ethernet" },   // plant server
  { url: "http://192.168.100.24:8892", naam: "Wi-Fi" },      // plant server
];

/* ── TEESRA RAASTA: INTERNET (2026-09-28) ─────────────────────────────────
 * User: "maintenance.dxtbdi.com wala app par kar do ... setting do ki us se
 * connection rakhna hai ki nahi; off kar de to phir na chale, chahe net on ho."
 * Wajah: server ka Wi-Fi hata diya gaya, aur TBDI-DX Wi-Fi seedha internet
 * par jaata hai (router ke baad agla hop ISP 103.81.15.241) -- plant ke 30.x
 * tak koi raasta nahi.  Phone ki app dono LAN pate aazma kar haar jaati thi.
 *
 * Raasta: Cloudflare tunnel -> server ki website (Vite 9965) -> `/api` proxy
 * -> backend 8892.  Laptop se naapa (origin https://localhost, jaisa APK):
 * `/api/auth/me` 401 + ACAO, login ka preflight 204, APK download 200, walkie
 * socket ka upgrade backend tak (403 bina token) -- sab chalte hain.
 *
 * SERVERS me isliye NAHI rakha:
 *   1. user ise band kar sake (login page ke upar + Settings ka switch) --
 *      band ho to internet se KABHI nahi judti;
 *   2. LAN mile to LAN hi jeete -- neeche `tatolo()` internet ke jawab par
 *      LAN ko thodi der (LAN_PEHLE_MS) ki chhoot deta hai;
 *   3. "pichhla server yaad" wala shortcut sirf LAN ke liye -- internet yaad
 *      rakhte to plant LAN par lautne ke baad bhi app internet par hi atki
 *      rehti. */
const INTERNET = { url: "https://maintenance.dxtbdi.com", naam: "Internet" };
export const INTERNET_URL = INTERNET.url;
const NET_KEY = "mes_net_internet";   // "0" = band; kuch bhi aur (ya khaali) = chalu
const NET_PROBE_MS = 12000;           // DNS + TLS + Cloudflare -- neeche tatolo() ki tippani
const LAN_PEHLE_MS = 400;             // internet pehle bole to bhi LAN ka itna intezaar

/** Internet wala raasta chalu hai?  (Default CHALU -- warna Wi-Fi par app
 *  chalegi hi nahi, jiske liye ye bana hai.) */
export function internetChalu() {
  try { return localStorage.getItem(NET_KEY) !== "0"; } catch { return true; }
}
/** Switch se badlo.  Asar agle tatolne se -- bulane wala `reprobeServer()`
 *  khud chalata hai. */
export function setInternetChalu(on) {
  try { localStorage.setItem(NET_KEY, on ? "1" : "0"); } catch { /* ignore */ }
}

/** Kis raaste par jude hain, aam bhasha me.  Settings isi se likhta hai. */
export const serverKaNaam = (base) =>
  ([...SERVERS, INTERNET].find((s) => s.url === base) || {}).naam || base || "—";

/** Aakhri tatolne me koi server mila tha ya nahi.  Settings ko ye batana
 *  zaroori hai: "jud gaye" aur "koi nahi mila" do alag baatein hain, aur
 *  dono par user ko alag kaam karna hota hai. */
export const serverMilaKya = () => serverMila;

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
//
// ─── PHONE vs TABLET vs TV ──────────────────────────────────────────────
// TV aur tablet bhi Android hain, yaani wahan bhi yahi APK chal sakti hai —
// aur tab `NATIVE` sach hota hai.  Par `in-app` ke peeche jo ~220 rule hain
// wo SAB 412px ke phone ke liye likhe gaye hain (padding 52px, title 19px,
// card 2-2, chart 1-1, Back chhupa hua).  Bina jaanche laga dete to TV ko
// phone samajh liya jaata aur poora board bigad jaata — bilkul wahi galti jo
// shuru me thi jab phone ko TV samjha ja raha tha, bas ulti.
//
// TV ka layout ALAG hai aur pehle se ho chuka hai — `.md-portrait` /
// `.mk-portrait` (MaintenanceDashboard.jsx + MaintenanceKPI.jsx), jo asli TV
// ki photo dekh kar 1350x2400 par tune hue the.  Use kuch nahi chahiye.
//
// Isliye teen nishaan hain:
//   phone  -> `in-app`      = wahi ~220 rule
//   tablet -> `in-app-tab`  = phone wale rule NAHI lagte (chaudai kaafi hai,
//                             website ka apna layout theek baithta hai),
//                             sirf app ki apni thodi si sudhaar
//   TV     -> `in-app-tv`   = koi rule nahi, board waisa hi jaisa aaj
//                             browser me dikhta hai
//
// ⚠ SHAK KI HAALAT ME PHONE HI MAANO.  Do galtiyon me se ek bahut buri hai:
//   TV ko phone samjha  -> board bhadda lagega, scroll karna padega (chalega)
//   phone ko TV samjha  -> 412px par website ka layout = app hi bekaar
// Isliye kism pata na chale to bhi `in-app` hi lagta hai.
//
// FAISLA YAHAN NAHI HOTA — `index.html` ki chhoti script me hota hai (jo
// khud `MainActivity.java` se poochhti hai), aur wahi `data-dev` laga deti
// hai.  Wahan isliye ki TV ke liye viewport React se PEHLE set karna padta
// hai; do jagah alag-alag faisla karte to kabhi na kabhi wo aapas me na
// milte.  Yahan bas wahi padh lete hain.
//
// `data-tv` bhi abhi tak lagta hai — purane bartaav ke liye — aur `data-dev`
// na mile to usi se kaam chal jaata hai.
if (typeof document !== "undefined" && NATIVE) {
  const de = document.documentElement;
  const kism = de.getAttribute("data-dev")
            || (de.getAttribute("data-tv") === "1" ? "tv" : "phone");
  const nishaan = kism === "tv" ? "in-app-tv" : kism === "tab" ? "in-app-tab" : "in-app";
  de.classList.add(nishaan);
  if (document.body) document.body.classList.add(nishaan);
  else document.addEventListener("DOMContentLoaded", () => document.body.classList.add(nishaan));

  /* POORI SCREEN -- upar ka status bar aur neeche ka navigation bar hata do.
   *
   * TV par: board deewar par lagta hai, wahan ghadi/battery/back-button ka
   * koi kaam nahi -- wo sirf ek kaali patti bana dete hain.
   * PHONE/TABLET par: user ne saaf kaha ki wahan bhi na aaye.
   *
   * ⚠ 2026-09-07 se PHONE PAR BHI.  Pehle ye sirf TV par tha aur phone par
   * status bar jaan-boojh kar rakha gaya tha (`capacitor.config.json` ka
   * `adjustMarginsForEdgeToEdge: auto` usi ke liye laga tha).  User ne baad
   * me kaha "mobile version me bhi status bar na aana chahiye", isliye ab
   * har jagah.  Wo config wali setting chhedi NAHI -- bar chhupte hi uska
   * margin apne aap shoonya ho jaata hai, aur kabhi wapas laana ho to sirf
   * ye ek shart hatani padegi.
   *
   * Kinare se swipe karne par bar thodi der ko aa jaati hai (Android ka
   * apna niyam) -- phone par yahi chahiye bhi, warna waqt/battery dekhne ka
   * koi raasta hi na bache.
   *
   * Faisla YAHI se jaata hai, Java me dobara nahi liya jaata -- warna do
   * jagah do alag jawab ban jaate aur kabhi na kabhi wo aapas me na milte.
   *
   * Do baar koshish: bridge kabhi-kabhi zara baad me taiyaar hota hai. */
  {
    const poorScreen = () => {
      try {
        const P = window.Capacitor?.Plugins?.ScreenMode;
        if (P?.immersive) { P.immersive({ on: true }); return true; }
      } catch { /* chhod do -- patti reh jaayegi, app chalti rahegi */ }
      return false;
    };
    if (!poorScreen()) setTimeout(poorScreen, 800);
  }
}

/** Website par "" (kuch nahi jodo), APK par abhi jo raasta chal raha hai. */
export let API_BASE =
  (import.meta.env && import.meta.env.VITE_API_BASE) ||
  (NATIVE ? SERVERS[0].url : "");

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
      //    warna bhara hua form bina bataye chala jayega.  `data-back-close`
      //    = aisa hi koi aur parda (jaise Attendance ki History) -- uska ×.
      const x = document.querySelector('.bds-close-x, [data-back-close]');
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

/* Abhi chal raha tatolna.  `fetch` isi ka intezaar karta hai (neeche
 * installApiBase), aur login page ki patti "Connecting…" isi se dikhati hai.
 * `pickNo`: switch dabte hi naya tatolna shuru hota hai -- purana baad me
 * laute to uska nateeja PHENK do (warna band kiya internet phir se chun
 * liya jaata). */
let pickChal = null;
let pickNo = 0;
const ruko = (ms) => new Promise((r) => setTimeout(r, ms));

/** Login page ki patti ko khabar: tatolna shuru / khatam. */
const bataao = () => {
  try { window.dispatchEvent(new CustomEvent("mes-server")); } catch { /* ignore */ }
};

/** Abhi ka haal -- login page ki patti ke liye. */
export const serverHaal = () => ({
  base: API_BASE, mila: serverMila, chal: !!pickChal, naam: serverKaNaam(API_BASE),
});

/** Saare raaston ko EK SAATH tatolo; jo pehle jawab de wahi le lo. */
function pickServer() {
  if (!NATIVE || !realFetch) return Promise.resolve(API_BASE);
  const mera = ++pickNo;
  const p = tatolo(mera).finally(() => {
    if (pickChal === p) { pickChal = null; bataao(); }
  });
  pickChal = p;
  bataao();
  return p;
}

async function tatolo(mera) {
  /* Build ne saaf-saaf ek server bataya ho (`VITE_API_BASE=...`) to use hi
     rakho -- tatolna nahi.  Bina iske wo sirf SHURUAATI value banti thi aur
     ye function use turant `SERVERS` me se kisi par badal deta tha, yaani
     build ka bataya pata chup-chaap bekaar ho jaata tha.  (Device par jaanch
     karte waqt ye pakda: app plant server par chali gayi thi aur naye
     endpoint 404 de rahe the.)
     Asli release me ye env var set hota hi nahi, isliye plant ka bartaav
     bilkul pehle jaisa rehta hai. */
  const thopa = import.meta.env && import.meta.env.VITE_API_BASE;
  if (thopa) { API_BASE = thopa; serverMila = true; return API_BASE; }
  const tryOne = (base, ms = PROBE_MS) => new Promise((resolve, reject) => {
    const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const t = setTimeout(() => { try { ctl && ctl.abort(); } catch { /* ignore */ } reject(new Error("timeout")); }, ms);
    // /api/auth/me bina token 401 deta hai — yahi kaafi hai ye jaanne ko ki
    // server zinda hai.  200 ka intezaar nahi karte.
    realFetch(base + "/api/auth/me", ctl ? { signal: ctl.signal } : undefined)
      .then(() => { clearTimeout(t); resolve(base); })
      .catch((e) => { clearTimeout(t); reject(e); });
  });
  // Nateeja tabhi lagao jab beech me naya tatolna shuru na hua ho.
  const lagao = (base, mila) => {
    if (mera !== pickNo) return false;
    API_BASE = base;
    serverMila = mila;
    return true;
  };
  // Pichhli baar jo server mila tha, use PEHLE akela aazmao.  Plant me raasta
  // roz wahi rehta hai, aur tab dono ko tatolne me lagne wale ~700ms har baar
  // app khulne par bach jaate hain (naapa gaya).  Wo na mile to neeche wala
  // poora race chalta hai, yaani network badle to bhi app khud sambhal leti hai.
  // (Sirf LAN pate -- internet kabhi yaad nahi rakha jaata, upar INTERNET dekho.)
  let yaad = null;
  try { yaad = localStorage.getItem(PICKED_KEY); } catch { /* ignore */ }
  if (yaad && SERVERS.some((s) => s.url === yaad)) {
    try {
      lagao(await tryOne(yaad), true);
      return API_BASE;
    } catch { /* nahi mila -- neeche sabko aazmate hain */ }
  }

  // LAN sab ek saath; internet (switch chalu ho to) saath me, par uske jawab
  // ke baad bhi LAN ko LAN_PEHLE_MS ki chhoot -- plant me LAN hi jeete.
  const daud = SERVERS.map((s) => tryOne(s.url));
  if (internetChalu()) {
    // App THANDI khule to pehli HTTPS (DNS + TLS + Cloudflare) dheemi hoti hai.
    // Phone emulator par naapa (laptop CPU 65-93%): kabhi 3.4s, kabhi 6s ki
    // hadd bhi paar -- jabki garam app me wahi 0.4-0.6s.  Beech me kaat kar
    // dobara shuru karne se aadha hua TLS bhi phir se hota hai, isliye EK
    // lambi koshish (12s).  Haan, JALDI fail hui ho (network abhi taiyaar
    // nahi tha / DNS) to 1.5s ruk kar ek baar aur.
    const shuru = Date.now();
    const net = () => tryOne(INTERNET.url, NET_PROBE_MS);
    daud.push(net()
      .catch((e) => (Date.now() - shuru < 4000 ? ruko(1500).then(net) : Promise.reject(e)))
      .then((u) => ruko(LAN_PEHLE_MS).then(() => u)));
  }
  try {
    const winner = await Promise.any(daud);
    // ab lambi hadd theek hai (bhaari report chal sake)
    if (lagao(winner, true)) {
      try {
        // Internet jeeta to purana LAN pata bhool jao -- warna agli baar
        // khulte hi wo shortcut 2.5s khaata (phone ab bhi Wi-Fi par hai).
        if (winner === INTERNET.url) localStorage.removeItem(PICKED_KEY);
        else localStorage.setItem(PICKED_KEY, winner);
      } catch { /* ignore */ }
    }
  } catch {
    // koi nahi mila — pehla hi rakho, error saaf aayega; aur ab jaldi fail
    // karo, 15s rukna bekaar hai
    if (lagao(SERVERS[0].url, false)) {
      try { localStorage.removeItem(PICKED_KEY); } catch { /* ignore */ }
    }
  }
  return API_BASE;
}

/** Kabhi bhi dobara tatolna ho (jaise request fail hone par, ya internet ka
 *  switch badla).  Hamesha NAYA tatolna -- chalta hua purana ho to uska
 *  nateeja phenk diya jaata hai. */
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
  const bhejo = (input, init) => {
    if (typeof input === "string") return withTimeout(withBase(input), init);
    // Request object aaya ho to uska url badal kar naya banao
    if (input && typeof input === "object" && typeof input.url === "string"
        && input.url.startsWith("/")) {
      return withTimeout(new Request(withBase(input.url), input), init);
    }
    return withTimeout(input, init);
  };
  window.fetch = (input, init) => {
    // Server abhi tay ho raha ho (app abhi khuli, ya internet ka switch daba)
    // to apni `/api/...` request uske BAAD bhejo -- warna wo pehle (LAN) pate
    // par jaakar 3.5s baad fail hoti: Wi-Fi par khulte hi login dabaya to
    // "Cannot reach server".  LAN par tatolna ~10-50ms ka hai, farak nahi
    // padta.  Poore URL wali call (jaise update check ke pate) nahi rukti.
    if (pickChal && typeof input === "string" && input.startsWith("/")) {
      return pickChal.then(() => bhejo(input, init), () => bhejo(input, init));
    }
    return bhejo(input, init);
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
  //    `fetch` wali request tay hone tak ruk jaati hai (upar), axios/XHR wali
  //    tab tak SERVERS[0] par jaati hai; jawab aate hi base badal jaata hai
  //    aur aage ki saari request sahi raaste par jaati hain.
  //    Khulte waqt KUCH na mila to 3s baad EK baar aur (thandi app ki pehli
  //    HTTPS / Wi-Fi abhi juda na ho -- emulator par pakda).  Isse zyada apne
  //    aap nahi (polling nahi); uske baad login ki patti ka "Retry" ya Settings
  //    ka "Reconnect".  Beech me user ne khud dabaya ho to ye nahi chalta.
  pickServer().then(() => {
    if (serverMila) return;
    setTimeout(() => { if (!serverMila && !pickChal) pickServer(); }, 3000);
  });

  // 4) status bar ko app ke upar se hata do (upar wali tippani dekhein)
  setupStatusBar();
  setupBackButton();
}
