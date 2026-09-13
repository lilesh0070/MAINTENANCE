/* walkieLink.js — Walkie ka EK socket, poori app ke liye.
 *
 * KYUN ALAG FILE ME
 * -----------------
 * Pehle socket `WalkieTalkie.jsx` ke andar khulta tha.  Nateeja: banda tabhi
 * "online" dikhta tha jab wo WALKIE KA PAGE khole baitha ho — kisi aur page
 * par jaate hi doosron ko wo offline lagne lagta tha, jabki app khuli hi thi.
 * Aur agar page se socket kholte aur saath me Layout se bhi, to ek hi browser
 * me DO socket ban jaate aur har aawaz DO BAAR bajti.
 *
 * Isliye socket ab yahan ek hi jagah rehta hai:
 *   • `WalkiePresence` (Layout me) ise app khulte hi chalu kar deta hai
 *   • `WalkieTalkie` page isi ko istemal karta hai, apna alag nahi kholta
 *
 * PHONE PAR SUNNE KA KAAM PHIR BHI JAVA KI SERVICE KA HAI — ye socket wahan
 * sirf "main online hoon" aur page ke UI (kaun bol raha hai) ke liye hai.
 * Isliye service chal rahi ho to ye aawaz BAJATA NAHI (`playHere = false`),
 * warna ek hi aawaz do baar aati.
 */
import { API_BASE } from "./apiBase";
import { speakerBanao } from "./walkieAudio";

/** `http://1.2.3.4:8892` -> `ws://1.2.3.4:8892/api/walkie/ws`.
 *  Java ki service ko bhi YAHI pata jaata hai (role/kind/token wo khud
 *  jodti hai), taaki dono jagah ek hi jagah se bane. */
export const walkieWsBase = () => {
  const b = API_BASE || window.location.origin;
  return b.replace(/^http/i, (m) => (m === "https" || m === "HTTPS" ? "wss" : "ws")) + "/api/walkie/ws";
};
const base = walkieWsBase;

let ws = null;
let alive = false;            // "judne ki koshish karte raho"
let retry = 0;
let tok = "";
let spk = null;
let playHere = true;
const subs = new Set();

const state = {
  conn: "off",                // off | connecting | on | denied
  online: [],
  me: null,
  rxFrom: null,
  maxTalk: 60,
};

const batao = (msg) => { for (const f of [...subs]) { try { f(msg, state); } catch { /* ek sunne wale ki galti baaki ko na rokey */ } } };

function jodo() {
  if (!alive || !tok) return;
  state.conn = "connecting";
  batao({ t: "conn" });
  let s;
  try {
    s = new WebSocket(`${base()}?role=rx&kind=web&token=${encodeURIComponent(tok)}`);
  } catch { state.conn = "off"; batao({ t: "conn" }); return; }
  s.binaryType = "arraybuffer";
  ws = s;

  s.onopen = () => { retry = 0; state.conn = "on"; batao({ t: "conn" }); };

  s.onmessage = (e) => {
    if (typeof e.data !== "string") {
      if (playHere) { if (!spk) spk = speakerBanao(); spk.push(e.data); }
      return;
    }
    let d; try { d = JSON.parse(e.data); } catch { return; }
    if (d.t === "ready") { state.me = d.me; state.online = d.online || []; state.maxTalk = d.max_talk || 60; }
    else if (d.t === "presence") state.online = d.online || [];
    else if (d.t === "rx_start") { spk?.reset(); state.rxFrom = d.from; }
    else if (d.t === "rx_stop") state.rxFrom = null;
    batao(d);
  };

  s.onclose = (ev) => {
    if (ws === s) ws = null;
    if (!alive) return;
    // 4403 = admin ne walkie se hata diya.  Dobara jodne ki koshish bekaar hai.
    if (ev.code === 4403) { state.conn = "denied"; batao({ t: "conn" }); return; }
    state.conn = "off";
    batao({ t: "conn" });
    retry = Math.min(retry + 1, 6);
    setTimeout(jodo, 500 * 2 ** (retry - 1));       // 0.5s → 16s
  };
  s.onerror = () => { try { s.close(); } catch { /* band ho hi raha hai */ } };
}

export const walkieLink = {
  /** Idempotent — dobara bulane par kuch nahi hota (jab tak token wahi hai). */
  start(token) {
    if (!token) return;
    if (alive && tok === token) return;
    if (alive) this.stop();
    tok = token; alive = true; retry = 0;
    if (!spk) spk = speakerBanao();
    jodo();
  },

  stop() {
    alive = false; tok = "";
    try { ws?.close(); } catch { /* pehle se band */ }
    ws = null;
    try { spk?.band(); } catch { /* chal hi nahi raha tha */ }
    spk = null;
    state.conn = "off"; state.online = []; state.rxFrom = null;
    batao({ t: "conn" });
  },

  /** Phone par service bajati hai, page nahi — warna aawaz do baar aati. */
  setPlayHere(v) { playHere = !!v; },

  /** Browser ka niyam: bina user ke chhue aawaz nahi baj sakti. */
  jagao() { if (!spk) spk = speakerBanao(); spk.jagao(); },

  send(o) {
    try { if (ws && ws.readyState === 1) { ws.send(JSON.stringify(o)); return true; } } catch { /* socket gir gaya */ }
    return false;
  },

  sendAudio(buf) {
    try { if (ws && ws.readyState === 1) ws.send(buf); } catch { /* socket gir gaya */ }
  },

  get state() { return state; },

  /** `fn(msg, state)` — har message aur har connection-badlav par.
   *  Lautaya hua function bulao to sunna band. */
  on(fn) { subs.add(fn); return () => subs.delete(fn); },
};
