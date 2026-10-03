/* ───────────────────────────────────────────────────────────────────
 * DisplayContext.jsx — display setting for the wall-dashboard pages.
 * ───────────────────────────────────────────────────────────────────
 *   • aspect  — "fill" | "16:9" | "4:3"  (how TvFit frames the page)
 * Persists in localStorage so the TV keeps its setting across reloads.
 * (Light/Dark `theme` sirf Overview ke liye tha -- Overview hata to wo bhi
 *  hata, 2026-10-03.  Aspect TvFit padhta hai, isliye wo rakha.)
 * ─────────────────────────────────────────────────────────────────── */
import { createContext, useContext, useEffect, useState } from "react";

const DisplayContext = createContext(null);

export const ASPECTS = ["fill", "16:9", "4:3"];

export function DisplayProvider({ children }) {
  const [aspect, setAspect] = useState(() => {
    try { return localStorage.getItem("mes_display_aspect") || "fill"; } catch { return "fill"; }
  });

  useEffect(() => { try { localStorage.setItem("mes_display_aspect", aspect); } catch { /* ignore */ } }, [aspect]);

  const cycleAspect = () => setAspect((a) => ASPECTS[(ASPECTS.indexOf(a) + 1) % ASPECTS.length]);

  return (
    <DisplayContext.Provider value={{ aspect, setAspect, cycleAspect }}>
      {children}
    </DisplayContext.Provider>
  );
}

// Safe default so a component outside the provider still works.
export const useDisplay = () =>
  useContext(DisplayContext) || {
    aspect: "fill",
    setAspect() {}, cycleAspect() {},
  };
