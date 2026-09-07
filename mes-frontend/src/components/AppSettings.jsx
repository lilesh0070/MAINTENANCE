/* AppSettings.jsx — app ke andar upar-daayen ⚙ Settings.
 *
 * SIRF APK ME DIKHTA HAI.  Website par ye component pehli line par hi `null`
 * laut jaata hai — na button, na koi request.  (Website par fullscreen wala
 * button pehle jaisa hi rehta hai; app me wo bemaani hai kyunki app khud hi
 * poori screen par chalti hai, isliye uski jagah ye baithta hai.)
 *
 * ANDAR KYA HAI
 * -------------
 *   • Kaun logged in hai (naam + role)
 *   • App ka version, aur "naya version hai kya" ka check + download
 *   • Logout
 *
 * Update ka intezaam:  app khulte hi CHUP-CHAAP ek baar dekh leta hai; naya
 * pada ho to gear par laal nishaan aa jaata hai, taaki kisi ko roz kholna na
 * pade.
 */
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { isNativeApp } from "../constants/apiBase";

const MY_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "0.0.0";

/* ─── ARZI — UPDATE ABHI LAPTOP SE AATA HAI ───────────────────────────
 * Plant server par abhi purani APK padi hai aur wahan file rakhne ka koi
 * raasta nahi hai (SSH/SMB/FTP band).  Tab tak SIRF UPDATE laptop se le
 * lete hain.
 *
 * DHYAN — ye `SERVERS` me nahi daala jaan-boojh kar.  `pickServer()` jo
 * pehle jawab de use hi POORA API_BASE bana deta hai, yaani laptop jeet
 * jaata to app ka SAARA data laptop se jaata aur laptop band hote hi app
 * ruk jaati.  Yahan sirf ye do call laptop par jaati hain -- version
 * dekhna aur APK utaarna.  Baaki har request plant server par hi jaati hai.
 *
 * Laptop na mile to chup-chaap plant server se poochh lete hain (neeche
 * `""` wahi hai) -- kuch tootta nahi.
 *
 * ⚠ Plant server par do file rakhte hi ye poora block hata dena hai.
 */
// Laptop ka WiFi IP DHCP se milta hai aur badalta rehta hai, isliye jitne
// pate ab tak dekhe hain sab yahan pade hain.  Kram maayne nahi rakhta --
// neeche sab EK SAATH aazmaye jaate hain.
const UPDATE_HOSTS = [
  "http://10.101.19.14:8892",         // laptop — abhi wali WiFi
  "http://192.168.1.100:8892",        // laptop — ghar wali WiFi
  "http://192.168.100.30:8892",       // laptop — plant WiFi
  "http://192.168.30.68:8892",        // laptop — plant Ethernet (static)
  "http://pc-maint-019.local:8892",   // laptop — naam se
  "",                                 // plant server (jaisa pehle tha)
];

/** Sab pate EK SAATH poochho, aur jiske paas SABSE NAYA version ho wahi lo.
 *
 *  ⚠ PEHLE YAHAN `Promise.any` THA -- "jo pehle jawab de wahi le lo" -- aur
 *  wo GALAT tha.  Ek se zyada machine jawab deti hain aur unke version ALAG
 *  ho sakte hain: laptop par nayi APK padi hoti hai, plant server par purani.
 *  `Promise.any` sirf tezi dekhta hai, sahi-galat nahi.
 *
 *  Emulator par naap kar dekha (laptop 1.4.6, plant server 1.0.2):
 *      192.168.100.30 -> 1.4.6  (148ms)
 *      192.168.30.68  -> 1.4.6  (146ms)
 *      ""  (plant)    -> 1.0.2  (173ms)
 *      dus baar chala kar dekha -> PURANA 3/10 baar JEET GAYA
 *
 *  Jab purana jeetta tha to `isNewer(1.0.2, 1.4.2)` false aata aur app kehti
 *  "You are on the latest version" -- yaani jo aadmi chaar version peeche
 *  hai use update KABHI dikhta hi nahi.  Aur ye har baar alag nateeja deta
 *  hai, isliye ek baar test karke "theek hai" maan lena aasan tha.
 *
 *  Ab `allSettled` -- sab ka jawab aane do, phir `isNewer` se sabse naya
 *  chuno.  Iska daam: pehle sabse tez jawab par hi laut aata tha (~150ms),
 *  ab jo pate maujood NAHI hain unke 3 second poore lagte hain.  Update
 *  check khulte hi chup-chaap hota hai, aur button wale me "checking…"
 *  likha aata hai -- to 3 second dena sahi jawab ke saamne sasta hai.
 *
 *  Ye `apiBase.js` ke `pickServer()` se ALAG maamla hai -- wahan sach me
 *  "jo pehle bole" chahiye (data kisi bhi chalte server se le sakte hain),
 *  yahan "jiske paas sabse nayi APK ho" chahiye. */
async function updateVersionLao() {
  const ek = (base) => new Promise((mila, nahi) => {
    const ctl = new AbortController();
    const t = setTimeout(() => { try { ctl.abort(); } catch { /* ignore */ } nahi(new Error("timeout")); }, 3000);
    fetch(base + "/api/app/version", { cache: "no-store", signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
      .then((j) => { clearTimeout(t); mila(j); })
      .catch((e) => { clearTimeout(t); nahi(e); });
  });
  const har = await Promise.allSettled(UPDATE_HOSTS.map(ek));
  const mile = har.filter((r) => r.status === "fulfilled").map((r) => r.value);
  if (!mile.length) throw new Error("koi server nahi mila");
  return mile.reduce((sabseNaya, x) => (isNewer(x.version, sabseNaya.version) ? x : sabseNaya));
}

/** "1.2.10" > "1.2.9" — hissa-hissa milao, seedhi string se nahi. */
function isNewer(server, mine) {
  const a = String(server || "").split(".").map((x) => parseInt(x, 10) || 0);
  const b = String(mine || "").split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0, y = b[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

export default function AppSettings() {
  const NATIVE = isNativeApp();
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState(null);
  const [err, setErr]   = useState("");
  const [naya, setNaya] = useState(false);

  const check = useCallback(async (chupchap) => {
    if (!chupchap) { setBusy(true); setErr(""); }
    try {
      const d = await updateVersionLao();
      setInfo(d);
      setNaya(!!d.apk_ready && isNewer(d.version, MY_VERSION));
    } catch (e) {
      if (!chupchap) setErr("Could not reach the server — " + (e?.message || e));
    } finally { if (!chupchap) setBusy(false); }
  }, []);

  useEffect(() => { if (NATIVE) check(true); }, [NATIVE, check]);

  if (!NATIVE) return null;                       // WEBSITE PAR KUCH NAHI

  const download = async () => {
    const url = info?.apk_url;
    if (!url) return;
    // Bahar ke browser me kholte hain — WebView khud APK download nahi karta,
    // aur Android ka installer bhi bahar se hi khulta hai.
    try {
      const B = window.Capacitor?.Plugins?.Browser;
      if (B && B.open) { await B.open({ url }); return; }
    } catch { /* neeche wala tareeqa */ }
    window.open(url, "_blank");
  };

  const row = { display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "10px 0", borderBottom: "1px solid #f1f5f9", fontSize: 13 };
  const lbl = { color: "#64748b" };

  return (
    <>
      {/* gear — upar daayen */}
      <button onClick={() => { setOpen(true); check(false); }}
              aria-label="Settings"
              style={{ position: "fixed", right: 14, top: 12, zIndex: 10000,
                       width: 40, height: 40, borderRadius: "50%",
                       border: "1px solid #cbd5e1", background: "rgba(255,255,255,.94)",
                       boxShadow: "0 2px 10px rgba(15,23,42,.18)", cursor: "pointer",
                       fontSize: 19, lineHeight: 1, padding: 0 }}>
        ⚙
        {naya && <span style={{ position: "absolute", top: 3, right: 3, width: 10, height: 10,
                                borderRadius: "50%", background: "#dc2626",
                                border: "2px solid #fff" }} />}
      </button>

      {open && (
        <div onClick={() => setOpen(false)}
             style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)",
                      zIndex: 10001, display: "flex", alignItems: "flex-start",
                      justifyContent: "flex-end", padding: "60px 12px 12px" }}>
          <div onClick={(e) => e.stopPropagation()}
               style={{ background: "#fff", borderRadius: 14, padding: "16px 18px",
                        width: "100%", maxWidth: 340,
                        boxShadow: "0 14px 44px rgba(0,0,0,.32)" }}>

            <div style={{ fontWeight: 800, fontSize: 15, color: "#0f172a", marginBottom: 4 }}>
              Settings
            </div>

            {/* kaun logged in hai */}
            <div style={row}>
              <span style={lbl}>Signed in</span>
              <b>{user?.username || "—"}</b>
            </div>
            <div style={row}>
              <span style={lbl}>Role</span>
              <b style={{ textTransform: "capitalize" }}>{user?.role || "—"}</b>
            </div>

            {/* version */}
            <div style={row}>
              <span style={lbl}>App version</span>
              <b>v{MY_VERSION}</b>
            </div>
            <div style={{ ...row, borderBottom: "none" }}>
              <span style={lbl}>On server</span>
              <b>{busy ? "checking…" : (info?.version ? "v" + info.version : "—")}</b>
            </div>

            {err && (
              <div style={{ fontSize: 12, color: "#b91c1c", fontWeight: 700, margin: "4px 0 10px" }}>
                {err}
              </div>
            )}

            {!busy && !err && info && (
              naya ? (
                <>
                  <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10,
                                padding: 10, fontSize: 12.5, color: "#b91c1c", fontWeight: 700,
                                margin: "6px 0 10px" }}>
                    New version available{info.size_mb ? ` — ${info.size_mb} MB` : ""}
                    {info.notes ? <div style={{ fontWeight: 500, marginTop: 5, color: "#7f1d1d" }}>{info.notes}</div> : null}
                  </div>
                  <button onClick={download}
                          style={{ width: "100%", padding: "11px 0", borderRadius: 10, border: "none",
                                   background: "#b91c1c", color: "#fff", fontWeight: 800, fontSize: 14,
                                   cursor: "pointer" }}>
                    Download and update
                  </button>
                  <div style={{ fontSize: 11, color: "#94a3b8", margin: "8px 0 4px", lineHeight: 1.5 }}>
                    Android will ask to install once downloaded. The first time it may ask for
                    "unknown apps" permission — allow it.
                  </div>
                </>
              ) : (
                <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10,
                              padding: 9, fontSize: 12.5, color: "#15803d", fontWeight: 700,
                              margin: "6px 0 10px" }}>
                  {info.apk_ready ? "You are on the latest version ✓" : "No APK on the server yet"}
                </div>
              )
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button onClick={() => check(false)} disabled={busy}
                      style={{ flex: 1, padding: "9px 0", borderRadius: 9, border: "1px solid #cbd5e1",
                               background: "#fff", color: "#475569", fontWeight: 700, fontSize: 12.5,
                               cursor: "pointer" }}>
                {busy ? "…" : "Check for update"}
              </button>
              <button onClick={() => setOpen(false)}
                      style={{ flex: 1, padding: "9px 0", borderRadius: 9, border: "1px solid #cbd5e1",
                               background: "#fff", color: "#475569", fontWeight: 700, fontSize: 12.5,
                               cursor: "pointer" }}>
                Close
              </button>
            </div>

            <button onClick={() => { setOpen(false); logout(); }}
                    style={{ width: "100%", marginTop: 8, padding: "10px 0", borderRadius: 9,
                             border: "1px solid #fecaca", background: "#fef2f2", color: "#b91c1c",
                             fontWeight: 800, fontSize: 13, cursor: "pointer" }}>
              ⏻ Logout
            </button>
          </div>
        </div>
      )}
    </>
  );
}
