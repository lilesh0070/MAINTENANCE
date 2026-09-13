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

  /** Service chalu karo.  `url` = ws://...  `token` = JWT */
  async start(url, token) {
    const P = pul();
    if (!P?.start) return { running: false };
    try { return await P.start({ url, token }); } catch { return { running: false }; }
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
