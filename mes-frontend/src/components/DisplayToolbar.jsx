/* ───────────────────────────────────────────────────────────────────
 * DisplayToolbar.jsx — top-right "display controls" pill for the wall
 * dashboard pages (Overview + Dashboard): Light/Dark · Aspect · Fullscreen.
 * ─────────────────────────────────────────────────────────────────── */
import { useEffect, useState } from "react";
import { useDisplay } from "../context/DisplayContext";

const fsElement = () =>
  document.fullscreenElement || document.webkitFullscreenElement || null;

// `showTheme` — the Light/Dark toggle only applies to the Overview (its dark
// wall-display look).  The Dashboard is always light, so it hides the toggle.
export default function DisplayToolbar({ showTheme = true }) {
  const { theme, toggleTheme, aspect, cycleAspect } = useDisplay();
  const [fs, setFs] = useState(false);

  useEffect(() => {
    const onChange = () => setFs(!!fsElement());
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    onChange();
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, []);

  const toggleFs = async () => {
    try {
      if (!fsElement()) {
        const el = document.documentElement;
        const req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
        if (req) await req.call(el);
      } else {
        const exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
        if (exit) await exit.call(document);
      }
    } catch { /* ignored */ }
  };

  const light = theme === "light";
  const aspectLabel = aspect === "fill" ? "Fill" : aspect;

  const btn = {
    display: "inline-flex", alignItems: "center", gap: 6,
    height: 34, padding: "0 12px", borderRadius: 8,
    border: "1px solid rgba(148,163,184,.28)", background: "rgba(30,41,59,.9)",
    color: "#e2e8f0", font: "700 12.5px/1 'Barlow',system-ui,sans-serif",
    letterSpacing: ".04em", cursor: "pointer", whiteSpace: "nowrap",
  };
  const iconBtn = { ...btn, padding: "0 10px", width: 40, justifyContent: "center" };

  return (
    <div
      style={{
        position: "fixed", right: 16, top: 14, zIndex: 10000,
        display: "flex", alignItems: "center", gap: 6, padding: 6,
        borderRadius: 12, background: "rgba(15,23,42,.82)",
        border: "1px solid rgba(148,163,184,.22)",
        boxShadow: "0 8px 22px rgba(0,0,0,.32)",
        backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
      }}
    >
      {/* Light / Dark — Overview only */}
      {showTheme && (
      <button style={btn} onClick={toggleTheme}
              title="Toggle light / dark (Overview)">
        {light ? (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </svg>
        ) : (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
          </svg>
        )}
        {light ? "LIGHT" : "DARK"}
      </button>
      )}

      {/* Aspect ratio */}
      <button style={btn} onClick={cycleAspect}
              title="Aspect ratio for the display (Fill / 16:9 / 4:3)">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="6" width="20" height="12" rx="2" />
        </svg>
        {aspectLabel}
      </button>

      {/* Fullscreen */}
      <button style={iconBtn} onClick={toggleFs}
              title={fs ? "Exit full screen (Esc)" : "Full screen"}
              aria-label={fs ? "Exit full screen" : "Enter full screen"}>
        {fs ? (
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 3v3a2 2 0 0 1-2 2H4M20 9h-3a2 2 0 0 1-2-2V4M4 15h3a2 2 0 0 1 2 2v3M15 20v-3a2 2 0 0 1 2-2h3" />
          </svg>
        ) : (
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 0-1 1h-4" />
          </svg>
        )}
      </button>
    </div>
  );
}
