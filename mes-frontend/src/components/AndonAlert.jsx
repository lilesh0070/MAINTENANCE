/* ───────────────────────────────────────────────────────────────────
 * AndonAlert.jsx — global "MAINTENANCE ANDON call aayi" popup.
 * ───────────────────────────────────────────────────────────────────
 * App me ek hi baar mount hota hai (App.jsx → AppRoutes).  Har ~2.5s
 * /api/andon/dashboard (sirf MAINTENANCE ke open calls) poll karta hai;
 * jaise hi koi NAYI maintenance call aaye — chahe user kisi bhi page par
 * ho — top-center ek laal popup + beep aata hai (dismiss tak rehta hai).
 * Admin panel (/admin/*) par NAHI aata.  Page load par jo calls pehle se
 * open hain unpar alert nahi (sirf naye par).
 * ─────────────────────────────────────────────────────────────────── */
import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

// short attention beep (two tones) via Web Audio — best-effort (browser
// pehli user-interaction se pehle audio block kar sakta, visual alert phir bhi aata).
function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const tone = (t0, freq) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.type = "square"; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.22, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.34);
      o.start(t0); o.stop(t0 + 0.35);
    };
    tone(ctx.currentTime, 880);
    tone(ctx.currentTime + 0.42, 1046);
    setTimeout(() => { try { ctx.close(); } catch { /* ignore */ } }, 1100);
  } catch { /* ignore */ }
}

export default function AndonAlert() {
  const { token } = useAuth();
  const { pathname } = useLocation();
  const muted = !token || pathname.startsWith("/admin");   // admin panel → alert band

  const [alerts, setAlerts] = useState([]);   // [{id, zone, line, started_at}]
  const seen   = useRef(new Set());           // maintenance call-ids already handled
  const booted = useRef(false);               // pehla poll = sirf seed, alert nahi

  const poll = useCallback(() => {
    fetch("/api/andon/dashboard", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        const rows = Array.isArray(d.rows) ? d.rows : [];   // MAINTENANCE open calls
        const open = new Set(rows.map((r) => r.id));
        if (!booted.current) {                              // load par jo already open — un par alert nahi
          rows.forEach((r) => seen.current.add(r.id));
          booted.current = true;
          return;
        }
        const fresh = rows.filter((r) => !seen.current.has(r.id));
        rows.forEach((r) => seen.current.add(r.id));
        for (const id of [...seen.current]) if (!open.has(id)) seen.current.delete(id);  // band → dobara aaye to phir alert
        if (fresh.length) {
          setAlerts((prev) => {
            const have = new Set(prev.map((p) => p.id));
            const add = fresh.filter((r) => !have.has(r.id))
                             .map((r) => ({ id: r.id, zone: r.zone_name, line: r.line_name, started_at: r.started_at }));
            return add.length ? [...prev, ...add] : prev;
          });
          beep();
        }
      })
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    if (muted) return;
    poll();
    const id = setInterval(poll, 2500);
    return () => clearInterval(id);
  }, [muted, poll]);

  if (muted || !alerts.length) return null;
  const dismiss = (id) => setAlerts((prev) => prev.filter((a) => a.id !== id));

  return (
    <div style={{ position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)", zIndex: 99999,
                  display: "flex", flexDirection: "column", gap: 10, width: "min(540px,94vw)" }}>
      <style>{`@keyframes andonAlertPulse{0%,100%{box-shadow:0 10px 30px rgba(220,38,38,.30),0 0 0 0 rgba(220,38,38,.5)}50%{box-shadow:0 10px 30px rgba(220,38,38,.30),0 0 0 10px rgba(220,38,38,0)}}`}</style>
      {alerts.map((a) => (
        <div key={a.id} style={{ background: "#fff", border: "2px solid #dc2626", borderRadius: 14,
                                 padding: "14px 16px", display: "flex", alignItems: "center", gap: 14,
                                 fontFamily: "'Barlow',sans-serif", animation: "andonAlertPulse 1.5s ease-out infinite" }}>
          <div style={{ fontSize: 30, lineHeight: 1 }}>🔔</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 800, color: "#dc2626", fontSize: 14, letterSpacing: ".03em" }}>MAINTENANCE ANDON CALL</div>
            <div style={{ fontWeight: 800, color: "#0f172a", fontSize: 18, fontFamily: "'Barlow Condensed',sans-serif" }}>
              📍 {a.zone || "—"} / {a.line || "—"}
            </div>
            <div style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>
              {a.started_at ? new Date(a.started_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : ""} · waiting for response
            </div>
          </div>
          <button onClick={() => dismiss(a.id)}
                  style={{ border: "none", background: "#dc2626", color: "#fff", fontWeight: 800, fontSize: 13,
                           borderRadius: 9, padding: "10px 16px", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}>
            OK, dekh liya
          </button>
        </div>
      ))}
    </div>
  );
}
