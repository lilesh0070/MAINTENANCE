import { useState, useEffect, useMemo, useCallback } from "react";
import { onlyProdZones } from "../../constants/zones";
import { Btn, api, todayLocalISO, fmtDuration, fmtClock } from "./shared";

/* ════════════════════════════════════════════════════════════════════
 * 2.5) Maintenance KPI panel (auto-computed + target compare + CSV
 *      download).  Sits between History and Zone&Line Stats.
 * ════════════════════════════════════════════════════════════════════ */
function KpiPanel({ token, lines, onViewSlip, onFillSlip, refreshKey }) {
  // Filters — same style as every other page: a Date (default TODAY, but
  // freely changeable) + Zone → Line cascade from the Machine Master.
  const [fDate,   setFDate]   = useState(todayLocalISO());
  const [fZone,   setFZone]   = useState("");
  const [fLine,   setFLine]   = useState("");
  const [zoneSel, setZoneSel] = useState("SEAT_SLIDER");   // clicked zone tile → shows its slips
  const [master,  setMaster]  = useState([]);
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [err,     setErr]     = useState(null);

  // Machine Master List for the zone/line dropdowns (standing rule: all
  // filters derive from mes_machines).
  useEffect(() => {
    if (!token) return;
    api.get("/api/machines/", token).then((m) => setMaster(Array.isArray(m) ? m : [])).catch(() => setMaster([]));
  }, [token]);

  const zoneOpts = useMemo(
    () => onlyProdZones([...new Set(master.map((m) => m.zone_name).filter(Boolean))]), [master]);
  const lineOpts = useMemo(
    () => fZone
      ? [...new Set(master.filter((m) => m.zone_name === fZone).map((m) => m.line_name).filter(Boolean))].sort()
      : [], [master, fZone]);
  const onZone = (v) => { setFZone(v); setFLine(""); };

  const reload = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const qs = new URLSearchParams();
      // A single date → a one-day window (period=custom, from=to=date).
      // No date = fall back to today so the panel is never empty on load.
      const d = fDate || todayLocalISO();
      qs.set("period", "custom"); qs.set("date_from", d); qs.set("date_to", d);
      if (fZone) qs.set("zone_name", fZone);
      if (fLine) qs.set("line_name", fLine);
      const r = await api.get(`/api/maintenance-kpi/?${qs.toString()}`, token);
      setData(r);
    } catch (e) { setErr(e.message || "Load failed"); }
    finally    { setLoading(false); }
  }, [fDate, fZone, fLine, token, refreshKey]);   // refreshKey bump → refetch after a slip is filled

  useEffect(() => { reload(); }, [reload]);
  // Refresh every 60 s — KPIs don't move every second so this is plenty.
  useEffect(() => {
    const t = setInterval(reload, 60_000);
    return () => clearInterval(t);
  }, [reload]);

  return (
    <div style={{
      background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14,
      overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,.04)",
    }}>
      {/* Header bar with filters + download */}
      <div style={{
        padding: "12px 18px", borderBottom: "1px solid #e2e8f0",
        background: "#fafbfc",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        flexWrap: "wrap", gap: 12,
      }}>
        <div>
          <div style={{ fontFamily: "'Barlow Condensed',sans-serif",
                          fontSize: 18, fontWeight: 800, color: "#0f172a" }}>
            Pending Breakdown
          </div>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
            {fDate || "Today"} · {fZone || "All zones"}{fLine ? ` · ${fLine}` : ""}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input type="date" value={fDate} onChange={(e) => setFDate(e.target.value)}
                 style={kpiSelect} title="Breakdown date" />
          <select value={fZone} onChange={(e) => onZone(e.target.value)} style={kpiSelect}>
            <option value="">All Zones</option>
            {zoneOpts.map(z => <option key={z} value={z}>{z}</option>)}
          </select>
          <select value={fLine} onChange={(e) => setFLine(e.target.value)} style={kpiSelect} disabled={!fZone}>
            <option value="">All Lines</option>
            {lineOpts.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
          <Btn size="sm" onClick={reload} disabled={loading}>{loading?"…":"↻"}</Btn>
        </div>
      </div>

      {/* Pending Closures + zone-wise pending sections */}
      <div style={{ padding: 18 }}>
        {err ? (
          <div style={{ padding: 16, color: "#dc2626", fontSize: 13 }}>
            Failed to load: {err}
          </div>
        ) : !data ? (
          <div style={{ padding: 24, textAlign: "center", color: "#94a3b8",
                          fontStyle: "italic" }}>
            Computing…
          </div>
        ) : (() => {
          // zone name from tickets ("SEAT SLIDER" / "Recliner") → section key
          const norm = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
          // per-zone TOTAL breakdowns (all states) so tile-sum = Total card
          const counts = {};
          (data.zone_totals || []).forEach((z) => {
            const k = norm(z.zone_name);
            counts[k] = (counts[k] || 0) + Number(z.total || 0);
          });
          // individual breakdown "slips" grouped by zone (shown on tile click)
          const bdByZone = {};
          (data.breakdowns || []).forEach((b) => {
            const k = norm(b.zone_name);
            (bdByZone[k] = bdByZone[k] || []).push(b);
          });
          const ZONES = [
            ["SEAT_SLIDER",   "Seat Slider"],
            ["RECLINER",      "Recliner"],
            ["PRESS_SHOP",    "Press Shop"],
            ["THIN_RECLINER", "Thin Recliner"],
            ["SUB_ASSEMBLY",  "Sub Assembly"],
            ["LOOP_PIPE",     "Loop Pipe"],
          ];
          const pendingCard = data.kpis.find((c) => c.kpi_key === "pending_closures");
          const totalBdCard = data.kpis.find((c) => c.kpi_key === "breakdowns_count");
          const selLabel = (ZONES.find(([k]) => k === zoneSel) || [null, zoneSel === "_OTHER" ? "Other / Unzoned" : zoneSel])[1];
          // One continuous S.No for the whole zone (not per-line serials):
          // order chronologically by start time, then number 1..N in the table.
          const selSlips = (bdByZone[zoneSel] || []).slice().sort((a, b) =>
            String(a.started_at || "").localeCompare(String(b.started_at || "")));
          return (
            <>
              <div style={{ display: "grid",
                            gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 14 }}>
                {totalBdCard && <KpiCard card={totalBdCard} />}
                {pendingCard && <KpiCard card={pendingCard} />}
              </div>
              <div style={{ margin: "16px 0 10px", fontSize: 11, fontWeight: 800,
                            letterSpacing: ".07em", textTransform: "uppercase", color: "#64748b" }}>
                Zone-wise Breakdowns
                <span style={{ fontWeight: 600, textTransform: "none", letterSpacing: 0, color: "#94a3b8" }}>
                  &nbsp;— click a zone to see its slips
                </span>
              </div>
              <div style={{ display: "grid",
                            gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12 }}>
                {(() => {
                  const zoneKeys = ZONES.map(([k]) => k);
                  const mapped = zoneKeys.reduce((s, k) => s + (counts[k] || 0), 0);
                  const totalBd = Number(totalBdCard?.value || 0);
                  const other = Math.max(0, totalBd - mapped);   // anything not in the 6 zones
                  const tiles = ZONES.map(([key, label]) => [key, label, counts[key] || 0]);
                  if (other > 0) tiles.push(["_OTHER", "Other / Unzoned", other]);
                  return tiles.map(([key, label, n]) => {
                    const accent = n > 0 ? "#dc2626" : "#16a34a";
                    const active = zoneSel === key;
                    return (
                      <button key={key} onClick={() => setZoneSel(key)} style={{
                        textAlign: "left", cursor: "pointer", fontFamily: "inherit",
                        background: active ? "rgba(220,38,38,.06)" : "#fff",
                        border: "1px solid #e2e8f0", borderLeft: `4px solid ${accent}`,
                        outline: active ? `2px solid ${accent}` : "none",
                        borderRadius: 10, padding: "12px 14px", boxShadow: "0 1px 2px rgba(0,0,0,.03)" }}>
                        <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".06em",
                                      textTransform: "uppercase", color: "#64748b" }}>{label}</div>
                        <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 30,
                                      fontWeight: 800, color: accent, lineHeight: 1.15 }}>{n}</div>
                        <div style={{ fontSize: 10.5, color: "#94a3b8" }}>breakdowns</div>
                      </button>
                    );
                  });
                })()}
              </div>

              {/* selected zone's breakdown slips */}
              <div style={{ marginTop: 18 }}>
                <style>{`@keyframes blinkDot { 0%,100% { opacity: 1 } 50% { opacity: 0.35 } }`}</style>
                <div style={{ fontSize: 12, fontWeight: 800, color: "#0f172a", marginBottom: 8 }}>
                  🧾 {selLabel} — Breakdown Slips
                  <span style={{ color: "#94a3b8", fontWeight: 600 }}> ({selSlips.length})</span>
                </div>
                {selSlips.length === 0 ? (
                  <div style={{ padding: "22px", textAlign: "center", color: "#94a3b8", fontSize: 12.5,
                                fontStyle: "italic", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10 }}>
                    No breakdown slips for {selLabel} in this window.
                  </div>
                ) : (
                  <div style={{ overflowX: "auto", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10,
                                // more than 10 slips → cap the height and scroll the rest
                                ...(selSlips.length > 10 ? { maxHeight: 430, overflowY: "auto" } : {}) }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                      <thead>
                        <tr>
                          {["S.No", "Line", "Shift", "Start", "End", "Status", "Duration", "Reason", "Slip"].map((h) => (
                            <th key={h} style={{ textAlign: "left", padding: "9px 12px", fontSize: 9.5, fontWeight: 800,
                                                 letterSpacing: ".05em", textTransform: "uppercase", color: "#64748b",
                                                 borderBottom: "2px solid #e2e8f0", whiteSpace: "nowrap",
                                                 position: "sticky", top: 0, background: "#f8fafc", zIndex: 1 }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {selSlips.map((b, i) => {
                          const durSec = b.ended_at
                            ? Math.max(0, Math.floor((new Date(b.ended_at) - new Date(b.started_at)) / 1000))
                            : Math.max(0, Math.floor((Date.now() - new Date(b.started_at)) / 1000));
                          const stColor = b.state === "OPEN" ? "#dc2626" : b.state === "RESOLVED" ? "#b45309" : "#16a34a";
                          const over60 = durSec > 60 * 60;   // > 1 hour → blink (like ANDON)
                          return (
                            <tr key={b.id} style={{ borderBottom: "1px solid #f1f5f9",
                                                    background: over60 ? "rgba(220,38,38,.05)" : "transparent" }}>
                              <td style={{ padding: "8px 12px", fontWeight: 800, color: "#dc2626" }}>
                                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                                  {over60 && (
                                    <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#dc2626",
                                                   boxShadow: "0 0 0 3px rgba(220,38,38,.25)", flexShrink: 0,
                                                   animation: "blinkDot 0.8s infinite" }} />
                                  )}
                                  {i + 1}
                                </span>
                              </td>
                              <td style={{ padding: "8px 12px", fontWeight: 700, color: "#0f172a" }}>{b.line_name || "—"}</td>
                              <td style={{ padding: "8px 12px" }}>{b.shift_name || "—"}</td>
                              <td style={{ padding: "8px 12px", fontFamily: "monospace", color: "#475569" }}>{fmtClock(b.started_at)}</td>
                              <td style={{ padding: "8px 12px", fontFamily: "monospace", color: "#475569" }}>{b.ended_at ? fmtClock(b.ended_at) : "—"}</td>
                              <td style={{ padding: "8px 12px" }}>
                                <span style={{ padding: "2px 9px", borderRadius: 99, fontSize: 10.5, fontWeight: 800,
                                               background: `${stColor}1a`, color: stColor }}>{b.state}</span>
                              </td>
                              <td style={{ padding: "8px 12px", fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 800,
                                           color: durSec > 30 * 60 ? "#dc2626" : "#334155" }}>{fmtDuration(durSec)}</td>
                              <td style={{ padding: "8px 12px", color: "#64748b", maxWidth: 260 }}>{b.reason || "—"}</td>
                              <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>
                                {b.state === "RESOLVED" && onFillSlip ? (
                                  /* form pending → fill it here (View appears once filled) */
                                  <button onClick={() => onFillSlip(b.id)} style={{
                                    border: "none", background: "#dc2626", color: "#fff",
                                    borderRadius: 7, padding: "4px 12px", fontSize: 11.5, fontWeight: 800,
                                    cursor: "pointer", fontFamily: "inherit" }}>✏ Fill Slip</button>
                                ) : b.state === "CLOSED" && onViewSlip ? (
                                  /* already filled → view the filled slip */
                                  <button onClick={() => onViewSlip(b.id)} style={{
                                    border: "1px solid #cbd5e1", background: "#fff", color: "#334155",
                                    borderRadius: 7, padding: "4px 12px", fontSize: 11.5, fontWeight: 800,
                                    cursor: "pointer", fontFamily: "inherit" }}>🧾 View Slip</button>
                                ) : <span style={{ color: "#cbd5e1" }}>—</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          );
        })()}
      </div>
    </div>
  );
}

const kpiSelect = {
  padding: "6px 10px", fontSize: 12, fontFamily: "inherit",
  borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff",
  cursor: "pointer", color: "#334155", fontWeight: 600,
};

function KpiCard({ card }) {
  const v = card.verdict;          // 'pass' | 'fail' | 'na'
  const accent = v === "pass" ? "#16a34a" : v === "fail" ? "#dc2626" : "#94a3b8";
  const arrow  = card.direction === "higher" ? "↑" : "↓";
  const fmtVal = (x) => {
    if (x == null) return "—";
    if (typeof x !== "number") return String(x);
    return Number.isInteger(x) ? x.toString() : x.toFixed(2);
  };
  return (
    <div style={{
      background: "#fff", border: `1px solid ${v === "fail" ? "rgba(220,38,38,.25)" : "#e2e8f0"}`,
      borderLeft: `4px solid ${accent}`,
      borderRadius: 10, padding: "14px 16px",
      boxShadow: "0 1px 2px rgba(0,0,0,.03)",
      position: "relative",
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b",
                       letterSpacing: ".08em", textTransform: "uppercase" }}>
        {card.label}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 6 }}>
        <div style={{ fontFamily: "'Barlow Condensed',sans-serif",
                          fontSize: 32, fontWeight: 800, color: "#0f172a", lineHeight: 1 }}>
          {fmtVal(card.value)}
        </div>
        <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>
          {card.unit}
        </div>
      </div>
      <div style={{ fontSize: 11, color: "#64748b", marginTop: 10, display: "flex",
                       alignItems: "center", gap: 6, justifyContent: "space-between" }}>
        <span>
          Target {arrow} <b style={{ color: "#334155" }}>{fmtVal(card.target)} {card.unit}</b>
        </span>
        <span style={{
          fontSize: 9, fontWeight: 800, letterSpacing: ".08em",
          textTransform: "uppercase",
          padding: "2px 8px", borderRadius: 99,
          background: v === "pass" ? "rgba(22,163,74,.10)"
                    : v === "fail" ? "rgba(220,38,38,.10)" : "#f1f5f9",
          color: accent,
        }}>
          {v === "pass" ? "✓ on target" : v === "fail" ? "✗ off target" : "—"}
        </span>
      </div>
    </div>
  );
}


export default KpiPanel;
