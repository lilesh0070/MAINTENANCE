/* ───────────────────────────────────────────────────────────────────
 * FullscreenButton.jsx — floating "full screen" toggle, on every page.
 * ───────────────────────────────────────────────────────────────────
 * Uses the browser Fullscreen API to put the whole app into full screen
 * (like F11) and back.  Rendered from Layout, so it appears on all pages.
 * Handy on the 65" TV wall-display: one tap → true full screen.
 *
 * 2026-10-03 (user): laptop aur mobile WEBSITE par nahi -- sirf TV ke
 * browser me.  TV = bina touch ki badi khadi screen (Attendance ka
 * `tvWebNow` wala hi niyam) ya 2000px+ (4K TV, TvFit jaisa).  Jagah:
 * upar-daayen kone me fix, logo ki seedh (6..48px) -- sabse chhota sticky
 * header 56.7px ka hai, aur headers daayein 78px chhodte hain, isliye
 * koi naam iske neeche nahi aata.  APK me Layout ise render hi nahi karta.
 * ─────────────────────────────────────────────────────────────────── */
import { useEffect, useState } from "react";

const COARSE = typeof window !== "undefined" && !!window.matchMedia
  && window.matchMedia("(pointer: coarse)").matches;
const isTvScreen = () => typeof window !== "undefined" && !COARSE
  && ((window.innerWidth >= 700 && window.innerHeight >= window.innerWidth * 1.3)
      || window.innerWidth >= 2000);

const fsElement = () =>
  document.fullscreenElement || document.webkitFullscreenElement || null;

export default function FullscreenButton() {
  const [on, setOn] = useState(false);
  const [tv, setTv] = useState(isTvScreen);

  useEffect(() => {
    const r = () => setTv(isTvScreen());
    window.addEventListener("resize", r);
    return () => window.removeEventListener("resize", r);
  }, []);
  // html par `fs-tv` -- responsive.css isi se header ke daayein button ki jagah chhodta hai
  useEffect(() => {
    document.documentElement.classList.toggle("fs-tv", tv);
    return () => document.documentElement.classList.remove("fs-tv");
  }, [tv]);

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

  if (!tv) return null;   // laptop / mobile website

  return (
    <button
      onClick={toggle}
      title={on ? "Exit full screen (Esc)" : "Full screen"}
      aria-label={on ? "Exit full screen" : "Enter full screen"}
      style={{
        position: "fixed", right: 8, top: 6, zIndex: 10000,
        width: 42, height: 42, borderRadius: 10,
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
