/* ───────────────────────────────────────────────────────────────────
 * AndonMonitor.jsx — "ANDON Monitor"
 * ───────────────────────────────────────────────────────────────────
 * Simple all-department live monitor.  Top: 3 stats (Total today · Active
 * now · Longest active).  Then one button per department (6) — each lights
 * up + shows a count when that department has an active call.  Click a
 * button to see ONLY that department's live calls (zone / line + running
 * timer), just like the main dashboard's ANDON.  Data: GET /api/andon/monitor
 * (andon_system OPEN calls).  Read-only.
 * Routing: /andon-monitor — canAccess('andon-system').
 * ─────────────────────────────────────────────────────────────────── */
import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { fmtDuration } from "./breakdown/shared";

export default function AndonMonitor({ embedded = false }) {
  const { token, theme, user } = useAuth();
  const nav = useNavigate();
  const accent = theme?.accent || "#dc2626";

  const [data, setData]   = useState(null);
  const fetchedAt         = useRef(Date.now());
  const [sel, setSel]     = useState("");
  const touched           = useRef(false);
  const [, setTick]       = useState(0);

  const load = useCallback(() => {
    fetch("/api/andon/monitor", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) { setData(d); fetchedAt.current = Date.now(); } })
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    if (!token) return;
    load();
    const poll = setInterval(load, 1500);                       // fresh data
    const tick = setInterval(() => setTick((t) => t + 1), 1000); // smooth timer
    return () => { clearInterval(poll); clearInterval(tick); };
  }, [token, load]);

  const depts = data?.departments || [];
  const rows  = data?.rows || [];
  const stats = data?.stats || {};

  // auto-pick the first ACTIVE department (else the first) until the user clicks
  useEffect(() => {
    if (touched.current || !depts.length) return;
    const act = depts.find((d) => d.active > 0);
    setSel((act || depts[0]).name);
  }, [depts]);

  const pick = (name) => { touched.current = true; setSel(name); };
  const drift = () => (Date.now() - fetchedAt.current) / 1000;
  const liveElapsed = (r) => Math.max(0, Math.round((r.elapsed_seconds || 0) + drift()));
  const longest = Math.max(0, Math.round((stats.longest_seconds || 0) + (rows.length ? drift() : 0)));
  const selRows = rows.filter((r) => (r.department || "") === sel);

  const STAT = [
    ["Total Calls",   stats.today ?? "—",                        "#1e40af", "today · 7 AM–6:30 AM"],
    ["Active Calls",  stats.active ?? 0,                         (stats.active ? "#dc2626" : "#16a34a"), "abhi chalu"],
    ["Longest Active", rows.length ? fmtDuration(longest) : "0s", "#7c3aed", "sabse lambi chalu call"],
  ];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700;800&family=Barlow+Condensed:wght@600;700;800&display=swap');
        .am-root { min-height:100vh; background:#f8fafc; font-family:'Barlow',sans-serif; padding-bottom:50px; }
        .am-top { background:#fff; border-bottom:1px solid #e2e8f0; padding:0 34px; height:60px;
          display:flex; align-items:center; justify-content:space-between; position:sticky; top:0; z-index:50;
          box-shadow:0 1px 3px rgba(0,0,0,.06); }
        .am-top::after { content:''; position:absolute; bottom:0; left:0; right:0; height:2px; background:${accent}; }
        .am-title { font-family:'Barlow Condensed',sans-serif; font-size:26px; font-weight:800; color:#0f172a; }
        .am-title span { color:${accent}; }
        .am-back { border:1px solid #cbd5e1; background:#fff; color:#334155; font-weight:700; font-size:13px;
                   border-radius:8px; padding:8px 14px; cursor:pointer; }
        .am-body { max-width:1500px; margin:20px auto 0; padding:0 24px; }
        .am-stats { display:grid; grid-template-columns:repeat(3,1fr); gap:16px; margin-bottom:22px; }
        .am-stat { background:#fff; border:1px solid #e2e8f0; border-radius:16px; padding:16px 20px; box-shadow:0 1px 4px rgba(15,23,42,.05); }
        .am-stat .l { font-size:11px; font-weight:800; letter-spacing:.06em; text-transform:uppercase; color:#64748b; }
        .am-stat .v { font-family:'Barlow Condensed',sans-serif; font-weight:800; font-size:44px; line-height:1.05; }
        .am-stat .s { font-size:11px; color:#94a3b8; font-weight:600; }
        .am-h { font-size:13px; font-weight:800; letter-spacing:.05em; text-transform:uppercase; color:#64748b; margin:0 0 10px; }
        .am-btns { display:grid; grid-template-columns:repeat(3,1fr); gap:14px; margin-bottom:24px; }
        @media (min-width:1100px){ .am-btns { grid-template-columns:repeat(6,1fr); } }
        .am-btn { position:relative; border:2px solid #e2e8f0; background:#fff; border-radius:14px;
                  padding:16px 14px; cursor:pointer; text-align:left; transition:all .12s; font-family:inherit; }
        .am-btn:hover { transform:translateY(-2px); box-shadow:0 8px 20px rgba(15,23,42,.08); }
        .am-btn .nm { font-family:'Barlow Condensed',sans-serif; font-size:19px; font-weight:800; color:#0f172a; }
        .am-btn .st { font-size:11.5px; font-weight:700; margin-top:3px; }
        .am-badge { position:absolute; top:10px; right:12px; min-width:24px; height:24px; border-radius:99px;
                    display:inline-flex; align-items:center; justify-content:center; font-size:12px; font-weight:800;
                    color:#fff; padding:0 7px; }
        .am-call { background:#fff; border:1px solid #e2e8f0; border-left:6px solid ${accent}; border-radius:14px;
                   padding:16px 20px; margin-bottom:12px; box-shadow:0 1px 4px rgba(15,23,42,.05); }
        .am-empty { background:#fff; border:1px dashed #cbd5e1; border-radius:14px; padding:40px; text-align:center; color:#94a3b8; }
      `}</style>

      <div className={embedded ? "" : "am-root"}>
        {!embedded && (
          <div className="am-top">
            <button className="am-back" onClick={() => nav(-1)}>← Back</button>
            <div className="am-title">🔔 ANDON <span>Monitor</span></div>
            <div style={{ fontSize:12, color:"#64748b", fontWeight:600 }}>{user?.username || ""}</div>
          </div>
        )}

        <div className="am-body" style={embedded ? { margin:"4px auto 0", padding:0 } : undefined}>
          {/* ── top stats ── */}
          <div className="am-stats">
            {STAT.map(([l, v, c, s]) => (
              <div key={l} className="am-stat" style={{ borderTop:`3px solid ${c}` }}>
                <div className="l">{l}</div>
                <div className="v" style={{ color:c }}>{v}</div>
                <div className="s">{s}</div>
              </div>
            ))}
          </div>

          {/* ── department buttons ── */}
          <div className="am-h">Department — click karke uska live call dekho</div>
          <div className="am-btns">
            {depts.map((d) => {
              const on = d.active > 0;
              const isSel = d.name === sel;
              return (
                <button key={d.id} className="am-btn" onClick={() => pick(d.name)}
                        style={{ borderColor: isSel ? accent : on ? "#fecaca" : "#e2e8f0",
                                 background: isSel ? "#fff" : on ? "#fff7f7" : "#fff",
                                 boxShadow: isSel ? `0 0 0 3px ${accent}22` : undefined }}>
                  <div className="nm">{d.name}</div>
                  <div className="st" style={{ color: on ? "#dc2626" : "#16a34a" }}>
                    {on ? `● ${d.active} active` : "clear"}
                  </div>
                  {on && <span className="am-badge" style={{ background:"#dc2626" }}>{d.active}</span>}
                </button>
              );
            })}
            {!depts.length && <div style={{ color:"#94a3b8" }}>Loading departments…</div>}
          </div>

          {/* ── selected department's live calls ── */}
          <div className="am-h">{sel || "—"} — live calls</div>
          {selRows.length === 0 ? (
            <div className="am-empty">
              <div style={{ fontSize:34 }}>✅</div>
              <div style={{ fontWeight:700, color:"#334155", marginTop:6 }}>{sel} me abhi koi active call nahi.</div>
            </div>
          ) : selRows.map((r) => {
            const el = liveElapsed(r);
            const acked = r.acknowledged_at != null;
            return (
              <div key={r.id} className="am-call" style={{ borderLeftColor: acked ? "#b45309" : "#dc2626" }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:12 }}>
                  <div>
                    <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:22, fontWeight:800, color:"#0f172a" }}>
                      📍 {r.zone || "—"} / {r.line || "—"}{r.machine_no ? ` / ${r.machine_no}` : ""}
                    </div>
                    <div style={{ fontSize:12.5, color:"#64748b", fontWeight:600, marginTop:2 }}>
                      {r.department}{r.display_name && r.display_name !== r.department ? ` · ${r.display_name}` : ""}
                    </div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:34, fontWeight:800,
                                  color: acked ? "#b45309" : "#dc2626", lineHeight:1 }}>{fmtDuration(el)}</div>
                    <div style={{ fontSize:11.5, fontWeight:700, marginTop:3,
                                  color: acked ? "#16a34a" : "#b45309" }}>
                      {acked ? `✓ responded (${fmtDuration(r.response_seconds || 0)})` : "● waiting for response…"}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
