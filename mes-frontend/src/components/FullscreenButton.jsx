/* ───────────────────────────────────────────────────────────────────
 * FullscreenButton.jsx — floating "full screen" toggle, on every page.
 * ───────────────────────────────────────────────────────────────────
 * Uses the browser Fullscreen API to put the whole app into full screen
 * (like F11) and back.  Rendered from Layout, so it appears on all pages.
 * Handy on the 65" TV wall-display: one tap → true full screen.
 * ─────────────────────────────────────────────────────────────────── */
import { useEffect, useState } from "react";

const fsElement = () =>
  document.fullscreenElement || document.webkitFullscreenElement || null;

export default function FullscreenButton() {
  const [on, setOn] = useState(false);

  useEffect(() => {
    const onChange = () => setOn(!!fsElement());
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    onChange();
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, []);

  const toggle = async () => {
    try {
      if (!fsElement()) {
        const el = document.documentElement;
        const req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
        if (req) await req.call(el);
      } else {
        const exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
        if (exit) await exit.call(document);
      }
    } catch {
      /* user dismissed / not allowed in this context — ignore */
    }
  };

  return (
    <button
      onClick={toggle}
      title={on ? "Exit full screen (Esc)" : "Full screen"}
      aria-label={on ? "Exit full screen" : "Enter full screen"}
      style={{
        position: "fixed", right: 18, bottom: 18, zIndex: 10000,
        width: 46, height: 46, borderRadius: 11,
        border: "1px solid rgba(148,163,184,.4)",
        background: "rgba(15,23,42,.78)", color: "#fff",
        display: "grid", placeItems: "center", cursor: "pointer",
        boxShadow: "0 6px 18px rgba(0,0,0,.28)", WebkitBackdropFilter: "blur(4px)",
        backdropFilter: "blur(4px)",
      }}
    >
      {on ? (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 3v3a2 2 0 0 1-2 2H4M20 9h-3a2 2 0 0 1-2-2V4M4 15h3a2 2 0 0 1 2 2v3M15 20v-3a2 2 0 0 1 2-2h3" />
        </svg>
      ) : (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 0-1 1h-4" />
        </svg>
      )}
    </button>
  );
}
