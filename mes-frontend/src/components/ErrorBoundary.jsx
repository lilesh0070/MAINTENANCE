import { Component } from "react";

/* ─── KHAALI SCREEN KI JAGAH KUCH TO DIKHE ────────────────────────────
 *
 * React ka niyam hai: render ke beech kahin bhi koi galti phati aur use
 * pakadne wala koi na ho, to React **poora tree hata deta hai**.  Screen
 * bilkul khaali (safed/kaali) reh jaati hai -- na koi sandesh, na koi
 * raasta.  Bahar se ye "app khul hi nahi rahi" jaisa lagta hai, jabki app
 * chal rahi hoti hai; bas ek chhoti si galti ne sab kuch mita diya hota hai.
 *
 * Is app me aisa pakadne wala KOI NAHI THA (poore src me ek bhi
 * `componentDidCatch` nahi mila).  Yaani kisi ek page ki ek line bhi
 * bigadti to poori app khaali ho jaati.
 *
 * Ab ye sabse upar baitha hai.  Iska kaam app ko theek karna nahi hai --
 * uska kaam ye hai ki **khaali screen kabhi na aaye**: kya hua wo saaf
 * likha aaye, aur nikalne ka ek raasta rahe.
 *
 * ⚠ Ye SIRF render ke waqt ki galtiyan pakadta hai.  Event handler ke andar
 * (button dabane par) ya `setTimeout`/`fetch` ke andar ki galtiyan React ko
 * pata hi nahi chaltin -- unke liye alag se try/catch chahiye.  Ye jaan lena
 * zaroori hai, warna galat bharosa ho jaata hai.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { galti: null };
  }

  static getDerivedStateFromError(err) {
    return { galti: err };
  }

  componentDidCatch(err, info) {
    // Console me poora nishaan chhod do -- USB laga kar `adb logcat` me
    // ya Chrome DevTools me yahi dekh kar asli wajah pakdi jaayegi.
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary] app me galti:", err, info?.componentStack);
  }

  render() {
    const { galti } = this.state;
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

    return (
      <div style={box}>
        <div style={{ maxWidth: 460, width: "100%" }}>
          <div style={{ fontSize: 34, marginBottom: 10 }}>⚠</div>
          <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>
            App me kuch gadbad ho gayi
          </div>
          <div style={{ fontSize: 13.5, color: "#94a3b8", lineHeight: 1.6, marginBottom: 14 }}>
            Ye screen isliye aayi hai taaki aapko khaali page na dikhe.
            Neeche wala button dabaiye — zyadatar baar isi se kaam ban jaata hai.
          </div>

          {/* Asli galti — bina iske batana namumkin hota hai ki hua kya */}
          <div style={{ fontSize: 11.5, color: "#f87171", background: "#1e1b1b",
                        border: "1px solid #4c1d1d", borderRadius: 8, padding: 10,
                        marginBottom: 16, wordBreak: "break-word", lineHeight: 1.5,
                        maxHeight: 160, overflow: "auto" }}>
            {String(galti?.message || galti)}
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button style={btn} onClick={() => window.location.reload()}>
              ↻ Dobara kholo
            </button>
            <button style={btn}
                    onClick={() => { window.location.href = "/dashboard"; }}>
              Dashboard par jao
            </button>
          </div>
        </div>
      </div>
    );
  }
}
