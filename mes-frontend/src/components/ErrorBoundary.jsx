import { Component } from "react";

/* ─── KHAALI SCREEN KI JAGAH KUCH TO DIKHE ────────────────────────────
 *
 * React ka niyam hai: render ke beech kahin bhi koi galti phati aur use
 * pakadne wala koi na ho, to React **poora tree hata deta hai**.  Screen
 * bilkul khaali (safed/kaali) reh jaati hai -- na koi sandesh, na koi
 * raasta.  Bahar se ye "app khul hi nahi rahi" jaisa lagta hai, jabki app
 * chal rahi hoti hai; bas ek chhoti si galti ne sab kuch mita diya hota hai.
 *
 * Do jagah laga hai: `main.jsx` (sabse upar) aur `Layout.jsx` (har page ka,
 * `key={pathname}` -- page badalte hi saaf).
 *
 * ⚠ Ye SIRF render ke waqt ki galtiyan pakadta hai.  Event handler ke andar
 * (button dabane par) ya `setTimeout`/`fetch` ke andar ki galtiyan React ko
 * pata hi nahi chaltin -- unke liye alag se try/catch chahiye.
 *
 * ─── APNE AAP THEEK (user 2026-09-26) ──────────────────────────────────
 * User: "koi API call na hui ya page par click karne par page load na hua to
 * 'Dashboard par jao / dobara dabao' aata hai."  Teen tarah ki galti:
 *   load  -- page ki FILE hi nahi aayi (net / Cloudflare tunnel ek pal atka,
 *            server update ho raha tha).  `lazyRetry` 2 baar pehle hi koshish
 *            kar chuka hota hai.  Server tak pahunch ho to turant reload;
 *            nahi to "connection ka intezaar" -- lautte hi apne aap reload.
 *   stale -- React ki DO copy: server update / Vite ke packages dobara jodne
 *            ke baad purana khula tab naya page khole (2026-09-26 laptop par
 *            khud dekha: "Cannot read properties of null (reading 'useRef')").
 *            Ek baar turant reload.
 *   crash -- asli bug (jaise API ka ulta jawab page na sambhal paaya).  Apne
 *            aap kuch nahi -- screen + laal sandesh (photo bhejo, theek karenge).
 * Loop nahi: 30 s me dobara apne-aap reload nahi (sessionStorage); tab `load`
 * par sirf tab reload jab connection TOOT kar LAUTE -- warna server par hi
 * page ki file kharab ho to reload ka chakkar chalta rehta.
 * Dikhne wala text English (user ka niyam).
 */

// page ki file nahi aayi -- browser ke hisaab se alag-alag shabd
const LOAD_ERR = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Failed to load module script|Unable to preload CSS|ChunkLoadError|Loading (?:CSS )?chunk [\w-]+ failed/i;
// React ki do copy -- hook ka "dispatcher" null
const STALE_REACT = /reading ['"]use[A-Z]\w*['"]|dispatcher(?:\.use[A-Z]\w*| is null)|Invalid hook call/;

const KEY = "eb_auto_reload_at";
const GAP_MS = 30000;               // itne me dobara apne-aap reload nahi
const POLL_MS = 4000;               // connection ka intezaar -- har 4 s
const POLL_MAX_MS = 10 * 60 * 1000; // 10 min baad poochhna band

const kismOf = (err) => {
  const m = String((err && err.message) || err || "");
  if (STALE_REACT.test(m)) return "stale";
  if (LOAD_ERR.test(m)) return "load";
  return "crash";
};
const abhiReloadHua = () => {
  try { return Date.now() - Number(sessionStorage.getItem(KEY) || 0) < GAP_MS; } catch { return false; }
};
const nishaan = () => {
  try { sessionStorage.setItem(KEY, String(Date.now())); } catch { /* storage band */ }
};

let preloadSuna = false;

export default class ErrorBoundary extends Component {
  // Test inhe badal kar bina asli reload / network ke jaanch sakta hai
  static kismOf = kismOf;
  static reload = () => window.location.reload();
  static ping = async () => {
    try {
      const r = await fetch(`/?eb-ping=${Date.now()}`, { method: "HEAD", cache: "no-store" });
      return r.ok;
    } catch {
      return false;
    }
  };

  constructor(props) {
    super(props);
    // haal: jaanch | reload | intezaar | haath (khud kuch nahi -- button se)
    this.state = { galti: null, kism: null, haal: "jaanch" };
    this.band = false;
    this.t = 0;
    this.onOnline = null;
  }

  static getDerivedStateFromError(err) {
    const kism = kismOf(err);
    // crash par pehli jhalak me bhi "Opening again…" na chamke
    return { galti: err, kism, haal: kism === "crash" ? "haath" : "jaanch" };
  }

  componentDidMount() {
    // Build (APK) me Vite page ki file pehle se maang leta hai (preload); wo
    // fail ho to `vite:preloadError` -- ek baar reload (Vite docs ka tareeqa).
    // Do boundary hain, sunna ek hi baar.
    if (!preloadSuna && typeof window !== "undefined") {
      preloadSuna = true;
      window.addEventListener("vite:preloadError", (e) => {
        if (abhiReloadHua()) return;
        e.preventDefault();
        nishaan();
        ErrorBoundary.reload();
      });
    }
  }

  componentDidCatch(err, info) {
    // Console me poora nishaan -- `adb logcat` / Chrome DevTools me asli wajah
    console.error("[ErrorBoundary] app me galti:", err, info?.componentStack);
    const kism = kismOf(err);
    if (kism === "crash") { this.setState({ haal: "haath" }); return; }
    if (abhiReloadHua()) {
      if (kism === "load") this.intezaar(true);
      else this.setState({ haal: "haath" });
      return;
    }
    if (kism === "stale") { this.dobara(); return; }
    this.setState({ haal: "jaanch" });
    ErrorBoundary.ping().then((up) => {
      if (this.band) return;
      if (up) this.dobara();
      else this.intezaar(false);
    });
  }

  componentWillUnmount() {
    this.band = true;
    clearTimeout(this.t);
    if (this.onOnline) window.removeEventListener("online", this.onOnline);
  }

  dobara() {
    this.setState({ haal: "reload" });
    nishaan();
    ErrorBoundary.reload();
  }

  // sirfLautne: abhi-abhi reload ho chuka -- ab SIRF tab jab connection toot kar laute
  intezaar(sirfLautne) {
    this.setState({ haal: "intezaar" });
    const shuru = Date.now();
    let tuta = !sirfLautne;
    const dekho = async () => {
      clearTimeout(this.t);
      if (this.band || Date.now() - shuru > POLL_MAX_MS) return;
      const up = await ErrorBoundary.ping();
      if (this.band) return;
      if (!up) tuta = true;
      else if (tuta) { this.dobara(); return; }
      this.t = setTimeout(dekho, POLL_MS);
    };
    this.onOnline = () => { dekho(); };
    window.addEventListener("online", this.onOnline);
    this.t = setTimeout(dekho, POLL_MS);
  }

  render() {
    const { galti, kism, haal } = this.state;
    if (!galti) return this.props.children;

    const box = {
      minHeight: "100vh", background: "#0b1220", color: "#e2e8f0",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 20, fontFamily: "'Segoe UI', system-ui, sans-serif",
      boxSizing: "border-box",
    };
    const btn = {
      padding: "11px 18px", borderRadius: 10, border: "1px solid #334155",
      background: "#1e293b", color: "#e2e8f0", fontWeight: 700, fontSize: 14,
      cursor: "pointer",
    };

    const khud = haal === "jaanch" || haal === "reload";
    const [icon, title, text] = khud
      ? ["↻", "Opening the page again…", "One moment."]
      : haal === "intezaar"
        ? ["⚠", "This page could not load",
            "The connection to the server dropped for a moment. The page will open again by itself as soon as the connection is back."]
        : kism === "stale"
          ? ["↻", "The app was just updated", "Please reload once to use the new version."]
          : ["⚠", "Something went wrong on this page",
              "Reloading usually fixes it. If it keeps coming back, send a photo of this screen (with the red message) so it can be fixed."];

    return (
      <div style={box} data-eb-haal={haal} data-eb-kism={kism}>
        <div style={{ maxWidth: 460, width: "100%" }}>
          <div style={{ fontSize: 34, marginBottom: 10 }}>{icon}</div>
          <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>{title}</div>
          <div style={{ fontSize: 13.5, color: "#94a3b8", lineHeight: 1.6, marginBottom: 14 }}>{text}</div>

          {haal === "intezaar" && (
            <div style={{ fontSize: 12.5, color: "#fbbf24", fontWeight: 700, marginBottom: 14 }}>
              Waiting for the connection…
            </div>
          )}

          {/* Asli galti — bina iske batana namumkin hota hai ki hua kya */}
          {!khud && (
            <div style={{ fontSize: 11.5, color: "#f87171", background: "#1e1b1b",
                          border: "1px solid #4c1d1d", borderRadius: 8, padding: 10,
                          marginBottom: 16, wordBreak: "break-word", lineHeight: 1.5,
                          maxHeight: 160, overflow: "auto" }}>
              {String(galti?.message || galti)}
            </div>
          )}

          {!khud && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button style={btn} onClick={() => { nishaan(); ErrorBoundary.reload(); }}>
                ↻ Reload
              </button>
              <button style={btn}
                      onClick={() => { window.location.href = "/dashboard"; }}>
                Go to Dashboard
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }
}
