/* ───────────────────────────────────────────────────────────────────
 * TvFit.jsx — "fit to page" for a big display (65" 4K TV).
 * ───────────────────────────────────────────────────────────────────
 * Wraps a page so that, on a LARGE screen (a 4K TV), the whole page is
 * scaled to fit the viewport with NO scrolling — a proper wall-dashboard.
 * On normal laptops/monitors it is a pure pass-through (renders children
 * exactly as before), so day-to-day use is untouched.
 *
 * How: the content is laid out at a fixed `designWidth`; we measure its
 * natural height and apply transform:scale( min(vw/w, vh/h) ) so it fits
 * both dimensions.  overflow:hidden guarantees no scrollbars.
 *
 * Only activates at/above TV_MIN_WIDTH so it targets 4K TVs (effective
 * CSS width 2560 @150% or 3840 @100%) and never normal laptops.  For the
 * biggest fill, set the TV's Windows display scaling to 100%.
 * ─────────────────────────────────────────────────────────────────── */
import { useState, useLayoutEffect, useRef, useCallback } from "react";
import { useDisplay } from "../context/DisplayContext";

const TV_MIN_WIDTH = 2000;   // >= this viewport width → TV fit-mode

// Largest box of the given aspect that fits inside vw×vh (fill = the viewport).
function aspectBox(vw, vh, aspect) {
  if (aspect !== "16:9" && aspect !== "4:3") return { w: vw, h: vh };
  const r = aspect === "4:3" ? 4 / 3 : 16 / 9;
  let w = vw, h = vw / r;
  if (h > vh) { h = vh; w = vh * r; }
  return { w, h };
}

export default function TvFit({ children, designWidth = 1500, bg = "#0a1120" }) {
  const { aspect } = useDisplay();
  const isBig = () => typeof window !== "undefined" && window.innerWidth >= TV_MIN_WIDTH;
  const [tv, setTv]       = useState(isBig);
  const [scale, setScale] = useState(1);
  const stage = useRef(null);

  const recompute = useCallback(() => {
    const big = isBig();
    setTv(big);
    if (!big || !stage.current) return;
    const h = stage.current.scrollHeight || 1;
    const box = aspectBox(window.innerWidth, window.innerHeight, aspect);
    setScale(Math.min(box.w / designWidth, box.h / h));
  }, [designWidth, aspect]);

  useLayoutEffect(() => {
    recompute();
    // Re-fit a few times after mount: charts / web-fonts / async data settle
    // the height AFTER first paint, and a single measure would lock a stale
    // (too-tall) scale.  rAF + a couple of timeouts catch those late reflows.
    const raf = requestAnimationFrame(recompute);
    const t1 = setTimeout(recompute, 250);
    const t2 = setTimeout(recompute, 800);
    window.addEventListener("resize", recompute);
    const ro = new ResizeObserver(recompute);
    if (stage.current) ro.observe(stage.current);
    return () => {
      cancelAnimationFrame(raf); clearTimeout(t1); clearTimeout(t2);
      window.removeEventListener("resize", recompute); ro.disconnect();
    };
  }, [recompute]);

  // While TV fit-mode is on, lock the page from scrolling at all.
  useLayoutEffect(() => {
    if (!tv) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [tv]);

  if (!tv) return children;   // laptop / normal monitor → untouched

  return (
    <div style={{ position: "fixed", inset: 0, overflow: "hidden", background: bg,
                  display: "flex", justifyContent: "center", alignItems: "flex-start" }}>
      {/* the page root uses min-height:100vh — neutralize it so the measured
          height is the content's INTRINSIC height, not a forced full screen */}
      <style>{`.tvfit-stage > * { min-height: 0 !important; }`}</style>
      <div ref={stage} className="tvfit-stage"
           style={{ width: designWidth, transform: `scale(${scale})`, transformOrigin: "top center" }}>
        {children}
      </div>
    </div>
  );
}
