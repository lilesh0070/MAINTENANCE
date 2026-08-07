import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { Btn, fmtDuration, fmtClock } from "./shared";

/* ════════════════════════════════════════════════════════════════════
 * 1) ANDON Live Table
 * ════════════════════════════════════════════════════════════════════ */
// Dashboard par table itni hi rows tak badhta hai; usse zyada calls hon to
// baaki SCROLL me chale jaate hain — card nahi badhta, warna neeche ka poora
// layout niche khisak jaata hai.  Saari rows dekhni hon to Fullscreen.
const MAX_ROWS = 7;
function AndonTable({ rows, fullscreenRef, isFullscreen, toggleFullscreen }) {
  // ── 7 row ke baad scroll ──────────────────────────────────────────
  // Height ko fixed number se nahi baandh sakte: row ki oonchai content par
  // badalti hai (jawab aaya hua row aur "waiting" wala row alag height ke
  // hote hain, 52 se 77 px tak).  Isliye render ke baad ASLI rows naap kar
  // pehli MAX_ROWS + header jitni height set karte hain — hamesha theek 7
  // poori rows dikhti hain, aadhi row kabhi nahi.
  const boxRef = useRef(null);
  const [maxH, setMaxH] = useState(null);
  useLayoutEffect(() => {
    if (isFullscreen) { setMaxH(null); return; }          // fullscreen me koi cap nahi
    const box = boxRef.current;
    if (!box) return;
    const trs = box.querySelectorAll("tbody tr");
    if (trs.length <= MAX_ROWS) { setMaxH(null); return; } // sab waise hi dikh jaate hain
    const head = box.querySelector("thead");
    let h = head ? head.getBoundingClientRect().height : 0;
    for (let i = 0; i < MAX_ROWS; i++) h += trs[i].getBoundingClientRect().height;
    const next = Math.round(h);
    setMaxH((cur) => (cur === next ? cur : next));         // bewajah re-render se bacho
  }, [rows, isFullscreen]);

  // Tick at 1Hz so duration column stays live without re-fetch.
  const [, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Call band ho chuka ho to uska jama hua time hi dikhao (badhta na rahe);
  // chalu call ka time har second live badhta hai.
  const live = (r) => {
    if (r.duration_seconds != null) return r.duration_seconds;
    if (!r.started_at) return 0;
    return Math.floor((Date.now() - new Date(r.started_at).getTime()) / 1000);
  };
  // is_live sirf naye ANDON data me aata hai; purane data me hota hi nahi,
  // isliye "field hai hi nahi" ko bhi chalu maano (purana behaviour na toote).
  const isOpen = (r) => r.is_live !== false && r.ended_at == null;
  const liveCount = rows.filter(isOpen).length;

  return (
    <div ref={fullscreenRef} style={{
      background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14,
      overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,.04)",
      // When fullscreen, fill the screen and centre vertically.
      ...(isFullscreen ? {
        height: "100vh", width: "100vw", display: "flex",
        flexDirection: "column", borderRadius: 0, border: "none",
      } : {}),
    }}>
      <div style={{
        padding: "14px 20px",
        background: "linear-gradient(135deg,#dc2626,#b91c1c)",
        color: "#fff", display: "flex", alignItems: "center",
        justifyContent: "space-between", gap: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 22, animation: liveCount ? "blinkDot 1.2s infinite" : "none" }}>🔔</span>
          <div>
            <div style={{ fontFamily: "'Barlow Condensed',sans-serif",
                          fontSize: 22, fontWeight: 800, letterSpacing: ".02em" }}>
              MAINTENANCE ANDON
            </div>
            <div style={{ fontSize: 11, opacity: 0.9, fontWeight: 600 }}>
              {liveCount === 0 ? "All lines running ✓" : `${liveCount} active call${liveCount>1?"s":""}`}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          {/* No manual "Open Breakdown" — entries arrive automatically
              from the collector when the line's status bit goes to
              BREAKDOWN.  Auto-resolves when status returns to RUNNING. */}
          <Btn variant="ghost" size="sm" onClick={toggleFullscreen}
               style={{ background: "rgba(255,255,255,.18)", color: "#fff", borderColor: "rgba(255,255,255,.35)" }}
               title={isFullscreen ? "Exit fullscreen" : "Fullscreen view"}>
            {isFullscreen ? "🗗 Exit Fullscreen" : "⛶ Fullscreen"}
          </Btn>
        </div>
      </div>

      {/* Dashboard par table 7 row tak hi badhta hai; usse zyada calls hon to
          baaki SCROLL me chale jaate hain.  Pehle card badhta hi jaata tha aur
          poora layout bigad jaata tha.  Saari rows ek saath dekhni hon to
          upar wala Fullscreen button hai — usme koi cap nahi lagti. */}
      <div ref={boxRef} style={{ flex: 1, overflowY: "auto",
                     ...(maxH ? { maxHeight: maxH } : {}),
                     fontSize: isFullscreen ? "1.6vmin" : 13,
                     padding: isFullscreen ? "1vmin 2vmin" : 0 }}>
        <table style={{ width: "100%", borderCollapse: "collapse",
                         fontSize: isFullscreen ? "inherit" : 13 }}>
          <thead>
            <tr style={{ background: "#f8fafc" }}>
              {["S.No", "Zone", "Line Name", "Start Time", "Response Time", "Duration"].map((h, i) => (
                <th key={i} style={{
                  padding: isFullscreen ? "1.4vmin 1.6vmin" : "12px 16px",
                  textAlign: "left",
                  fontSize: isFullscreen ? "1.2vmin" : 10,
                  fontWeight: 800, letterSpacing: ".1em",
                  textTransform: "uppercase", color: "#64748b",
                  borderBottom: "2px solid #e2e8f0",
                  whiteSpace: "nowrap",
                  // 7 se zyada rows par table scroll hota hai — header upar
                  // chipka rehta hai taaki column ke naam dikhte rahein.
                  // background zaroori hai, warna rows header ke peeche se
                  // jhalakti hain.
                  position: "sticky", top: 0, zIndex: 1, background: "#f8fafc",
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: isFullscreen ? "8vmin" : "60px 20px",
                                            textAlign: "center", color: "#94a3b8",
                                            fontStyle: "italic",
                                            fontSize: isFullscreen ? "2vmin" : 14 }}>
                  No active breakdowns — all lines running smoothly. ✨
                </td>
              </tr>
            ) : rows.map((r) => {
              // Laal sirf CHALU call ke liye (30 min se zyada = urgent).
              // Band ho chuka call chahe kitna bhi lamba ho, ab urgent nahi.
              const open  = isOpen(r);
              const isRed = open && live(r) > 30*60;
              return (
              <tr key={r.id} style={{
                borderBottom: "1px solid #f1f5f9",
                background: isRed ? "rgba(220,38,38,.09)" : "transparent",
              }}>
                <td style={{ padding: isFullscreen ? "1.4vmin 1.6vmin" : "12px 16px",
                              fontFamily: "'Barlow Condensed',sans-serif",
                              fontSize: isFullscreen ? "2.2vmin" : 18,
                              fontWeight: 800, color: "#dc2626" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
                    {isRed && (
                      <span style={{
                        width: isFullscreen ? "1.6vmin" : 11, height: isFullscreen ? "1.6vmin" : 11,
                        borderRadius: "50%", background: "#dc2626", flexShrink: 0,
                        boxShadow: "0 0 0 3px rgba(220,38,38,.25)",
                        animation: "blinkDot 0.8s infinite",
                      }} />
                    )}
                    {r.serial_in_shift ?? "—"}
                  </span>
                </td>
                <td style={{ padding: isFullscreen ? "1.4vmin 1.6vmin" : "12px 16px",
                              fontWeight: 600, color: "#0f172a" }}>
                  {r.zone_name ? (
                    <span style={{ display: "inline-block", padding: "3px 10px",
                                    borderRadius: 99,
                                    background: "rgba(30,64,175,.1)",
                                    color: "#1e40af", fontSize: isFullscreen ? "1.4vmin" : 11,
                                    fontWeight: 700 }}>
                      {r.zone_name}
                    </span>
                  ) : <span style={{ color: "#cbd5e1" }}>—</span>}
                </td>
                <td style={{ padding: isFullscreen ? "1.4vmin 1.6vmin" : "12px 16px",
                              fontWeight: 700, color: "#0f172a" }}>
                  {r.line_name || `Line ${r.line_id}`}
                  {r.line_code && <span style={{ marginLeft: 6, fontSize: isFullscreen ? "1.2vmin" : 10,
                                                    color: "#94a3b8", fontFamily: "monospace" }}>
                    {r.line_code}
                  </span>}
                </td>
                <td style={{ padding: isFullscreen ? "1.4vmin 1.6vmin" : "12px 16px",
                              fontFamily: "monospace", color: "#475569" }}>
                  {fmtClock(r.started_at)}
                </td>
                {/* RESPONSE TIME — call ON se acknowledge (OUT2) tak ka time.
                    Abhi tak acknowledge nahi hua to "waiting…" dikhao. */}
                <td style={{ padding: isFullscreen ? "1.4vmin 1.6vmin" : "12px 16px",
                              fontFamily: "'Barlow Condensed',sans-serif",
                              fontSize: isFullscreen ? "2vmin" : 16,
                              fontWeight: 800,
                              color: r.response_seconds != null ? "#16a34a" : "#b45309" }}>
                  {r.response_seconds != null
                    ? fmtDuration(r.response_seconds)
                    : <span style={{ fontSize: isFullscreen ? "1.4vmin" : 11,
                                     fontWeight: 700, fontFamily: "inherit" }}>● waiting…</span>}
                </td>
                <td style={{ padding: isFullscreen ? "1.4vmin 1.6vmin" : "12px 16px",
                              fontFamily: "'Barlow Condensed',sans-serif",
                              fontSize: isFullscreen ? "2.2vmin" : 18,
                              fontWeight: 800,
                              // chalu = laal/amber (chal raha hai), band ho chuka = slate
                              color: isRed ? "#dc2626" : (open ? "#b45309" : "#64748b") }}>
                  {fmtDuration(live(r))}
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <style>{`
        @keyframes blinkDot { 0%,100% { opacity: 1 } 50% { opacity: 0.35 } }
      `}</style>
    </div>
  );
}


export default AndonTable;
