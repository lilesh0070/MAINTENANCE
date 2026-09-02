/* AppUpdate.jsx — app ke andar hi "naya version hai kya?" wala option.
 *
 * SIRF APK ME DIKHTA HAI.  Website par ye component pehli line par hi `null`
 * laut jaata hai — na koi button, na koi request.  (Website ko to har refresh
 * par naya code mil hi jaata hai, use update check ki zaroorat hi nahi.)
 *
 * KAAM
 * ----
 *   • Upar ek chhota sa button
 *   • Dabao -> server se poochho: `GET /api/app/version`
 *   • Naya version ho -> "Download" dikhta hai
 *   • Dabate hi APK utarti hai aur Android khud install kar deta hai
 *
 * Har baar app khulte hi CHUP-CHAAP ek baar bhi check karta hai — naya ho to
 * button laal ho jaata hai, taaki kisi ko roz dabana na pade.
 */
import { useCallback, useEffect, useState } from "react";

const MY_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "0.0.0";

/** APK ke andar hain ya browser me? */
function isApp() {
  if (typeof window === "undefined") return false;
  const c = window.Capacitor;
  if (c && typeof c.isNativePlatform === "function") return c.isNativePlatform();
  return /^(capacitor|ionic|file):$/.test(window.location.protocol);
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

export default function AppUpdate() {
  const NATIVE = isApp();
  const [open, setOpen]     = useState(false);
  const [busy, setBusy]     = useState(false);
  const [info, setInfo]     = useState(null);   // server ka jawab
  const [err, setErr]       = useState("");
  const [naya, setNaya]     = useState(false);  // naya version padа hai?

  const check = useCallback(async (chupchap) => {
    if (!chupchap) { setBusy(true); setErr(""); }
    try {
      const r = await fetch("/api/app/version", { cache: "no-store" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const d = await r.json();
      setInfo(d);
      setNaya(!!d.apk_ready && isNewer(d.version, MY_VERSION));
      return d;
    } catch (e) {
      if (!chupchap) setErr("Server se baat nahi ho payi — " + (e?.message || e));
      return null;
    } finally { if (!chupchap) setBusy(false); }
  }, []);

  // app khulte hi ek baar chup-chaap dekh lo
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

  const btn = {
    position: "fixed", top: 8, left: "50%", transform: "translateX(-50%)",
    zIndex: 9999, padding: "5px 12px", borderRadius: 99,
    border: "1px solid " + (naya ? "#b91c1c" : "#cbd5e1"),
    background: naya ? "#fee2e2" : "rgba(255,255,255,.92)",
    color: naya ? "#b91c1c" : "#475569",
    fontWeight: 800, fontSize: 11.5, cursor: "pointer",
    boxShadow: "0 2px 8px rgba(15,23,42,.14)",
  };

  return (
    <>
      <button style={btn} onClick={() => { setOpen(true); check(false); }}>
        {naya ? "● Naya version aa gaya" : `v${MY_VERSION} · Update dekho`}
      </button>

      {open && (
        <div onClick={() => setOpen(false)}
             style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.5)",
                      zIndex: 10000, display: "flex", alignItems: "flex-start",
                      justifyContent: "center", padding: "56px 16px" }}>
          <div onClick={(e) => e.stopPropagation()}
               style={{ background: "#fff", borderRadius: 14, padding: 18,
                        width: "100%", maxWidth: 380, boxShadow: "0 12px 40px rgba(0,0,0,.3)" }}>
            <div style={{ fontWeight: 800, fontSize: 15, color: "#0f172a", marginBottom: 12 }}>
              App ka version
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6 }}>
              <span style={{ color: "#64748b" }}>Aapke phone me</span>
              <b>v{MY_VERSION}</b>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 12 }}>
              <span style={{ color: "#64748b" }}>Server par</span>
              <b>{busy ? "dekh rahe hain…" : (info?.version ? "v" + info.version : "—")}</b>
            </div>

            {err && <div style={{ fontSize: 12, color: "#b91c1c", fontWeight: 700, marginBottom: 10 }}>{err}</div>}

            {!busy && !err && info && (
              naya ? (
                <>
                  <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10,
                                padding: 10, fontSize: 12.5, color: "#b91c1c", fontWeight: 700, marginBottom: 10 }}>
                    Naya version aa gaya hai{info.size_mb ? ` — ${info.size_mb} MB` : ""}
                    {info.notes ? <div style={{ fontWeight: 500, marginTop: 5, color: "#7f1d1d" }}>{info.notes}</div> : null}
                  </div>
                  <button onClick={download}
                          style={{ width: "100%", padding: "11px 0", borderRadius: 10, border: "none",
                                   background: "#b91c1c", color: "#fff", fontWeight: 800, fontSize: 14,
                                   cursor: "pointer" }}>
                    Download karke update karo
                  </button>
                  <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 8, lineHeight: 1.5 }}>
                    Download hote hi Android install ka poochhega. Pehli baar
                    "unknown apps" ki ijazat maang sakta hai — de dijiye.
                  </div>
                </>
              ) : (
                <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10,
                              padding: 10, fontSize: 12.5, color: "#15803d", fontWeight: 700 }}>
                  {info.apk_ready ? "Aap latest version par ho ✓" : "Server par abhi koi APK rakhi hi nahi hai"}
                </div>
              )
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button onClick={() => check(false)} disabled={busy}
                      style={{ flex: 1, padding: "9px 0", borderRadius: 9, border: "1px solid #cbd5e1",
                               background: "#fff", color: "#475569", fontWeight: 700, fontSize: 12.5,
                               cursor: "pointer" }}>
                {busy ? "…" : "Phir se dekho"}
              </button>
              <button onClick={() => setOpen(false)}
                      style={{ flex: 1, padding: "9px 0", borderRadius: 9, border: "1px solid #cbd5e1",
                               background: "#fff", color: "#475569", fontWeight: 700, fontSize: 12.5,
                               cursor: "pointer" }}>
                Band karo
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
