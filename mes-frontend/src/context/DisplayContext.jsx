/* ───────────────────────────────────────────────────────────────────
 * DisplayContext.jsx — display controls for the wall-dashboard pages.
 * ───────────────────────────────────────────────────────────────────
 * Holds the two "display" settings the top-right toolbar exposes:
 *   • theme   — "dark" | "light"     (applies to Overview + Dashboard)
 *   • aspect  — "fill" | "16:9" | "4:3"  (how TvFit frames the page)
 * Both persist in localStorage so the TV keeps its setting across reloads.
 * ─────────────────────────────────────────────────────────────────── */
import { createContext, useContext, useEffect, useState } from "react";

const DisplayContext = createContext(null);

export const ASPECTS = ["fill", "16:9", "4:3"];

export function DisplayProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem("mes_display_theme") || "light"; } catch { return "light"; }
  });
  const [aspect, setAspect] = useState(() => {
    try { return localStorage.getItem("mes_display_aspect") || "fill"; } catch { return "fill"; }
  });

  useEffect(() => { try { localStorage.setItem("mes_display_theme", theme); } catch { /* ignore */ } }, [theme]);
  useEffect(() => { try { localStorage.setItem("mes_display_aspect", aspect); } catch { /* ignore */ } }, [aspect]);

  const toggleTheme = () => setTheme((t) => (t === "light" ? "dark" : "light"));
  const cycleAspect = () => setAspect((a) => ASPECTS[(ASPECTS.indexOf(a) + 1) % ASPECTS.length]);

  return (
    <DisplayContext.Provider value={{ theme, setTheme, toggleTheme, aspect, setAspect, cycleAspect }}>
      {children}
    </DisplayContext.Provider>
  );
}

// Safe default so a component outside the provider still works.
export const useDisplay = () =>
  useContext(DisplayContext) || {
    theme: "dark", aspect: "fill",
    setTheme() {}, setAspect() {}, toggleTheme() {}, cycleAspect() {},
  };
