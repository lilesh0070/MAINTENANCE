/* walkieNative.js — Android ki Walkie service se baat karne ka ek hi darwaza.
 *
 * Service ka kaam: phone jeb me ho, app band ho, tab bhi socket pakde rakhna
 * aur aane wali call bajana / vibrate karna.  WebView ye kar hi nahi sakta —
 * background me jaate hi use rok diya jaata hai (isi app me naapa ja chuka
 * hai: background me PDF banana beech me ruk jaata tha).
 *
 * Website par (aur jab tak plugin APK me na ho) har call chup-chaap
 * `{ running:false }` laut aati hai — page tab khud aawaz bajata hai.  Yahi
 * wajah hai ki ye patla wrapper alag file me hai: page ko kahin bhi
 * `Capacitor.Plugins` ki maujoodgi jaanchni na pade.
 */
const pul = () =>
  (typeof window !== "undefined" ? window.Capacitor?.Plugins?.Walkie : null) || null;

export const walkieNative = {
  /** Plugin hai ya nahi (yaani APK me chal rahe hain aur service bani hui hai) */
  hai() { return !!pul(); },

  /** { running: bool, connected: bool } — plugin na ho to running:false */
  async status() {
    const P = pul();
    if (!P?.status) return { running: false, connected: false };
    try { return await P.status(); } catch { return { running: false, connected: false }; }
  },

  /** Service chalu karo.  `url` = ws://...  `token` = JWT
   *  `andon`  = isi socket par nayi ANDON call bhi suno (app band ho tab bhi)
   *  `walkie` = walkie chahiye (false = sirf ANDON) */
  async start(url, token, { andon = false, walkie = true } = {}) {
    const P = pul();
    if (!P?.start) return { running: false };
    try { return await P.start({ url, token, andon: !!andon, walkie: walkie !== false }); }
    catch { return { running: false }; }
  },

  /** Service ke paas jo aakhri ANDON haal hai: `{ andon, run, seq, rows }`.
   *  `andon` = server ye list isi socket par bhej raha hai.  `seq` har nayi
   *  list par badhta hai (`run` = service ka ye janam) -- purani chhodo. */
  async andonHaal() {
    const P = pul();
    if (!P?.andonHaal) return { andon: false, rows: null };
    try { return await P.andonHaal(); } catch { return { andon: false, rows: null }; }
  },

  /** Nayi ANDON list aate hi `fn({ run, seq, rows })`.  Lautaya function
   *  bulao to sunna band. */
  onAndon(fn) {
    const P = pul();
    if (!P?.addListener) return () => {};
    let h = null, band = false;
    Promise.resolve(P.addListener("andon", (e) => { if (!band) fn(e); }))
      .then((x) => { h = x; if (band) h?.remove?.(); })
      .catch(() => {});
    return () => { band = true; try { h?.remove?.(); } catch { /* pehle se hata */ } };
  },

  /** Notification ki ijazat (Android 13+).  Service chalu karne se pehle. */
  async requestPerms() {
    const P = pul();
    if (!P?.requestPerms) return { canNotify: true };
    try { return await P.requestPerms(); } catch { return { canNotify: false }; }
  },

  /** Ring/vibration band + server par "jawab mil gaya". */
  async ack() {
    const P = pul();
    if (!P?.ack) return false;
    try { await P.ack(); return true; } catch { return false; }
  },

  async stop() {
    const P = pul();
    if (!P?.stop) return { running: false };
    try { return await P.stop(); } catch { return { running: false }; }
  },

  /** Android ka "is app ko background me mat maaro" wala parda kholo.
   *  Xiaomi/Oppo/Vivo par iske bina service kuch der me mar jaati hai. */
  async batterySetting() {
    const P = pul();
    if (!P?.batterySetting) return false;
    try { await P.batterySetting(); return true; } catch { return false; }
  },
};
