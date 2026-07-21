/* pokayoke/shared.jsx — shared api + helpers/counters for the PY drilldown. */
export const API = "";
export const api = {
  async get(path, token) {
    const r = await fetch(API + path, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
    return r.json();
  },
};

function fmtAgo(ts) {
  if (!ts) return "—";
  const ms = Date.now() - new Date(ts).getTime();
  if (ms < 0) return "just now";
  const s = Math.floor(ms / 1000);
  if (s < 60)   return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60)   return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)   return `${h}h ${m % 60}m ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function PYCounters({ total, active, inactive, bypass, compact }) {
  const items = [
    { label: "TOTAL",    value: total,    color: "#0f172a" },
    { label: "ACTIVE",   value: active,   color: "#16a34a" },
    { label: "INACTIVE", value: inactive, color: "#94a3b8" },
    { label: "BYPASS",   value: bypass,   color: bypass > 0 ? "#dc2626" : "#0f172a" },
  ];
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(4, 1fr)",
      gap: compact ? 6 : 10,
      width: "100%",
    }}>
      {items.map(i => (
        <div key={i.label} style={{
          background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8,
          padding: compact ? "6px 8px" : "10px 12px", textAlign: "center",
        }}>
          <div style={{ fontSize: compact ? 9 : 10, fontWeight: 700,
                         letterSpacing: ".08em", color: "#64748b" }}>
            {i.label}
          </div>
          <div style={{ fontSize: compact ? 18 : 22, fontWeight: 800,
                         color: i.color, fontFamily: "'Barlow Condensed',sans-serif",
                         lineHeight: 1, marginTop: 2 }}>
            {i.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function computePYStats(pys) {
  const total  = pys.length;
  const bypass = pys.filter(p => p.is_bypassed).length;
  const active = total - bypass;
  return { total, active, bypass };
}

function Breadcrumb({ crumbs }) {
  return (
    <div style={{
      display:"flex", alignItems:"center", gap:8, marginBottom:14,
      fontSize:12, color:"#64748b",
    }}>
      {crumbs.map((c, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <span key={i} style={{ display:"flex", alignItems:"center", gap:8 }}>
            {c.onClick && !isLast ? (
              <button onClick={c.onClick}
                      style={{
                        background:"transparent", border:"none", padding:0,
                        cursor:"pointer", color:"#dc2626", fontWeight:600,
                        fontSize:12, fontFamily:"inherit",
                      }}>
                {c.label}
              </button>
            ) : (
              <span style={{ color:"#0f172a", fontWeight:700 }}>{c.label}</span>
            )}
            {!isLast && <span style={{ color:"#cbd5e1" }}>/</span>}
          </span>
        );
      })}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// LEVEL 1 — Zones grid
// ════════════════════════════════════════════════════════════════════

export { fmtAgo, PYCounters, computePYStats, Breadcrumb };
