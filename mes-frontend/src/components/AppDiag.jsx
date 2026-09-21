/* AppDiag.jsx — app ki atak ka log server tak (2026-09-21).
 *
 * User: "TV me din bhar 'Close app / Wait' aata hai -- log bana de, aaye to
 * log bhej de jisse tu dekh sake."
 *
 * Asli kaam Java me hai (`AnrLog.java`): main thread 4 sec se zyada atke to
 * uska stack + memory file me, aur Android 11+ par Android ka apna ANR record
 * bhi.  Ye component bas DAKIYA hai:
 *   • har page badalne par Java ko batata hai ki app kahan hai (report me jaata)
 *   • har minute (aur app saamne aate hi) padi reports utha kar
 *     `POST /api/app/diag` (login ke saath) -- server ne le li to Java se
 *     file mitwa deta hai.  Server na mile / login na ho to file padi rehti
 *     hai, agli baar.
 *   • page ke apne LAMBE KAAM (JS long tasks, 50ms+) ka chhota hisaab rakhta
 *     hai, aur report ke waqt ke aas-paas wale uske saath jod deta hai --
 *     taaki pata chale atak ke waqt page khud to busy nahi tha.
 *
 * UI kuch nahi.  WEBSITE PAR KUCH NAHI -- wahan plugin hi nahi hota.
 */
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { isNativeApp } from "../constants/apiBase";

const MY_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "0.0.0";
const NATIVE = isNativeApp();
const pul = () => (typeof window !== "undefined" ? window.Capacitor?.Plugins?.AnrLog : null);

const kism = () => {
  const c = document.documentElement.classList;
  return c.contains("in-app-tv") ? "tv" : c.contains("in-app-tab") ? "tab" : "phone";
};

/* Page ke lambe kaam -- aakhri 80 (module me, taaki page badalne par na khoye). */
const lambe = [];
if (NATIVE) {
  try {
    if (typeof PerformanceObserver !== "undefined"
        && (PerformanceObserver.supportedEntryTypes || []).includes("longtask")) {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) {
          lambe.push({ t: Math.round(performance.timeOrigin + e.startTime), ms: Math.round(e.duration) });
          if (lambe.length > 80) lambe.shift();
        }
      }).observe({ type: "longtask", buffered: true });
    }
  } catch { /* purana WebView -- bina iske bhi report jaati hai */ }
}

/* Report ke waqt se 2 min pehle se 30 sec baad tak ke lambe kaam. */
function saathJodo(r) {
  const at = Number(r?.at_ms) || 0;
  const paas = at ? lambe.filter((x) => x.t >= at - 120000 && x.t <= at + 30000) : [];
  if (!paas.length) return r?.detail || "";
  const rows = paas.map((x) => `    ${new Date(x.t).toLocaleTimeString("en-IN", { hour12: false })}  ${x.ms} ms`);
  return `${r?.detail || ""}\n== PAGE (JS) KE LAMBE KAAM, aas-paas ==\n${rows.join("\n")}\n`;
}

let chalRaha = false;
async function bhejo(token) {
  const P = pul();
  if (!P || !token || chalRaha) return;
  chalRaha = true;
  try {
    for (let i = 0; i < 10; i++) {                       // ek baar me 20 tak
      const r = await P.pending();
      const reps = Array.isArray(r?.reports) ? r.reports : [];
      if (!reps.length) break;
      const res = await fetch("/api/app/diag", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          reports: reps.map((x) => ({
            kind: x.kind, at_ms: x.at_ms, summary: x.summary,
            detail: saathJodo(x), path: x.path || "",
          })),
          app_version: MY_VERSION,
          device: kism(),
          path: window.location.pathname,
        }),
      });
      if (!res.ok) break;                                 // login gaya / server band -- baad me
      await P.done({ ids: reps.map((x) => x.id) });
      if (!r.baaki) break;
    }
  } catch { /* net nahi -- file padi hai, agli baar */ }
  finally { chalRaha = false; }
}

export default function AppDiag() {
  const { token } = useAuth();
  const { pathname } = useLocation();

  useEffect(() => {
    const P = pul();
    if (P) P.jagah({ path: pathname }).catch(() => {});
  }, [pathname]);

  useEffect(() => {
    if (!pul() || !token) return undefined;
    const chalao = () => { bhejo(token); };
    // App khulte hi nahi -- pehle page aaram se ban jaaye
    const pehla = setTimeout(chalao, 8000);
    const id = setInterval(chalao, 60000);
    const jago = () => { if (document.visibilityState === "visible") chalao(); };
    document.addEventListener("visibilitychange", jago);
    return () => {
      clearTimeout(pehla);
      clearInterval(id);
      document.removeEventListener("visibilitychange", jago);
    };
  }, [token]);

  return null;
}
