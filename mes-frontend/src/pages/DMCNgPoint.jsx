/* ───────────────────────────────────────────────────────────────────
 * DMCNgPoint.jsx — "DMC NG Point" (Machine DMC)
 * ───────────────────────────────────────────────────────────────────
 * Every ✗ (Not-OK) raised in a Daily DMC fill, zone / line / machine wise,
 * with its reason.  The maintenance team records the CORRECTIVE ACTION here
 * and closes the point once it is fixed.  Totals (open / closed) sit on top.
 *
 * Data: machine_dmc_fill_ng_point — populated automatically on every DMC save
 * (actions survive the rebuild).  The admin History sheet keeps showing the ✗
 * and now surfaces the action in its reason popup.
 *
 * Routing: /maintenance-dmc-ng — canAccess('maintenance-dmc-ng').
 * ─────────────────────────────────────────────────────────────────── */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const monthNow = () => new Date().toISOString().slice(0, 7);
const MON = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dateLabel = (iso) => { if (!iso) return ""; const [y, m, d] = String(iso).split("-");
  return `${parseInt(d, 10)} ${MON[parseInt(m, 10)] || m} ${y}`; };

export default function DMCNgPoint() {
  const { theme, token } = useAuth();
  const navigate = useNavigate();
  const [machines, setMachines] = useState([]);
  const [zone, setZone] = useState("");
  const [line, setLine] = useState("");
  const [mno, setMno]   = useState("");
  const [month, setMonth] = useState(monthNow);
  const [status, setStatus] = useState("OPEN");        // "" | OPEN | CLOSED
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({ open: 0, closed: 0, total: 0 });
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  const [draft, setDraft] = useState({});              // { ngId: "action text" } — typed inline
  const [saving, setSaving] = useState(null);          // id being saved

  const api = useCallback(async (path, opts = {}) => {
    const r = await fetch(`/api/machine-dmc${path}`, {
      ...opts,
      headers: { "Content-Type": "application/json",
                 ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) },
    });
    if (!r.ok) { let m; try { m = JSON.parse(await r.text()).detail; } catch { m = null; }
      throw new Error(m || `HTTP ${r.status}`); }
    return r.json();
  }, [token]);

  useEffect(() => { api(`/machines`).then((d) => setMachines(Array.isArray(d) ? d : [])).catch(() => {}); }, [api]);

  const zoneOpts = useMemo(() => [...new Set(machines.map((m) => m.zone).filter(Boolean))].sort(), [machines]);
  const lineOpts = useMemo(() => zone
    ? [...new Set(machines.filter((m) => m.zone === zone).map((m) => m.line).filter(Boolean))].sort() : [], [machines, zone]);
  const mcOpts = useMemo(() => (zone && line)
    ? machines.filter((m) => m.zone === zone && m.line === line && m.machine_no)
              .sort((a, b) => String(a.machine_no).localeCompare(String(b.machine_no))) : [], [machines, zone, line]);
  const mcSel = mcOpts.find((m) => String(m.machine_no) === String(mno)) || null;

  const load = useCallback(() => {
    setLoading(true);
    const q = new URLSearchParams();
    if (zone) q.set("zone", zone);
    if (line) q.set("line", line);
    if (mno)  q.set("machine_no", mno);
    if (month) q.set("month", month);
    if (status) q.set("status", status);
    api(`/ng-points?${q.toString()}`)
      .then((d) => { setRows(d.rows || []); setCounts(d.counts || { open: 0, closed: 0, total: 0 }); })
      .catch(() => { setRows([]); setCounts({ open: 0, closed: 0, total: 0 }); })
      .finally(() => setLoading(false));
  }, [api, zone, line, mno, month, status]);
  useEffect(() => { load(); }, [load]);

  // action is typed straight into the row's "Action Taken" cell
  const submitAction = async (r) => {
    const text = (draft[r.id] || "").trim();
    if (!text) { alert("Type the action taken in the Action Taken box first."); return; }
    setSaving(r.id);
    try {
      await api(`/ng-point/${r.id}/action`, { method: "PUT",
        body: JSON.stringify({ action_taken: text }) });
      setMsg(`✅ NG point closed — ${r.machine_no} · ${dateLabel(r.ng_date)} · #${r.s_no}`);
      setDraft((s) => { const n = { ...s }; delete n[r.id]; return n; });
      load();
    } catch (e) { alert(String(e.message || e)); }
    finally { setSaving(null); }
  };

  const reopen = async (r) => {
    if (!window.confirm(`Reopen this NG point?\n${r.machine_no} · #${r.s_no}`)) return;
    try {
      await api(`/ng-point/${r.id}/action`, { method: "PUT",
        body: JSON.stringify({ action_taken: "", reopen: true }) });
      setMsg("↩ NG point reopened."); load();
    } catch (e) { alert(String(e.message || e)); }
  };

  const sels = { padding: "8px 10px", borderRadius: 8, border: "1px solid #cbd5e1", fontSize: 13, fontWeight: 600, minWidth: 170, background: "#fff" };
  const lab = { fontSize: 10.5, fontWeight: 800, color: "#64748b", marginBottom: 4 };
  const card = { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 16 };
  const th = { border: "1px solid #cbd5e1", padding: "6px 10px", fontSize: 11, fontWeight: 800, background: "#f3f4f6", textAlign: "left" };
  const td = { border: "1px solid #cbd5e1", padding: "6px 10px", fontSize: 12, color: "#334155", verticalAlign: "top" };
  const onZone = (v) => { setZone(v); setLine(""); setMno(""); };
  const onLine = (v) => { setLine(v); setMno(""); };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700;800&family=Barlow+Condensed:wght@600;700;800&display=swap');
        .ng-root { min-height:100vh; background:#f8fafc; font-family:'Barlow',sans-serif; padding-bottom:80px; }
        .ng-topbar { background:#fff; border-bottom:1px solid #e2e8f0; padding:0 40px 0 88px; height:60px;
          display:flex; align-items:center; justify-content:space-between; position:sticky; top:0; z-index:100;
          box-shadow:0 1px 3px rgba(0,0,0,.06); }
        .ng-topbar::after { content:''; position:absolute; bottom:0; left:0; right:0; height:2px; background:${theme.gradient}; }
        .ng-title { position:absolute; left:50%; transform:translateX(-50%); font-family:'Barlow Condensed',sans-serif;
          font-size:32px; font-weight:800; color:#0f172a; pointer-events:none; white-space:nowrap; }
        .ng-title span { color:${theme.accent}; }
        .ng-body { padding:20px; max-width:1700px; margin:0 auto; }
      `}</style>
      <div className="ng-root">
        <div className="ng-topbar"><div /><div className="ng-title">✗ DMC <span>NG Point</span></div><div /></div>

        <div className="ng-body">
          <button onClick={() => navigate("/maintenance-machine-dmc")}
            style={{ marginBottom: 14, padding: "8px 16px", borderRadius: 8, border: "1px solid #cbd5e1",
                     background: "#fff", cursor: "pointer", fontWeight: 800, fontSize: 13, color: "#334155" }}>← Machine DMC</button>

          {/* filters */}
          <div style={{ ...card, marginBottom: 14, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div><div style={lab}>ZONE</div>
              <select style={sels} value={zone} onChange={(e) => onZone(e.target.value)}>
                <option value="">— all zones —</option>{zoneOpts.map((z) => <option key={z} value={z}>{z}</option>)}
              </select></div>
            <div><div style={lab}>LINE</div>
              <select style={sels} value={line} onChange={(e) => onLine(e.target.value)} disabled={!zone}>
                <option value="">— all lines —</option>{lineOpts.map((l) => <option key={l} value={l}>{l}</option>)}
              </select></div>
            <div><div style={lab}>MACHINE NO</div>
              <select style={{ ...sels, minWidth: 190 }} value={mno} onChange={(e) => setMno(e.target.value)} disabled={!line}>
                <option value="">— all machines —</option>
                {mcOpts.map((m) => <option key={m.machine_no} value={m.machine_no}>{m.machine_no}</option>)}
              </select></div>
            <div><div style={lab}>MACHINE NAME</div>
              <input readOnly value={mcSel?.machine_name || ""} placeholder="— auto —"
                     style={{ ...sels, minWidth: 220, background: "#f8fafc", color: "#334155", cursor: "default" }} /></div>
            <div><div style={lab}>MONTH</div>
              <input type="month" style={{ ...sels, minWidth: 150 }} value={month} onChange={(e) => setMonth(e.target.value)} /></div>
            <div><div style={lab}>STATUS</div>
              <select style={{ ...sels, minWidth: 140 }} value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">— all —</option>
                <option value="OPEN">Open only</option>
                <option value="CLOSED">Closed only</option>
              </select></div>
          </div>

          {msg && <div style={{ ...card, marginBottom: 14, borderLeft: "4px solid #16a34a", color: "#15803d", fontWeight: 700, fontSize: 13 }}>{msg}</div>}

          {/* totals */}
          <div style={{ display: "flex", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
            {[["✗ Open NG points", counts.open, "#dc2626", "#fef2f2", "#fecaca"],
              ["✅ Closed", counts.closed, "#16a34a", "#f0fdf4", "#bbf7d0"],
              ["Σ Total NG", counts.total, "#334155", "#f8fafc", "#e2e8f0"]].map(([t, n, c, bg, bd]) => (
              <div key={t} style={{ flex: "1 1 180px", background: bg, border: `1px solid ${bd}`, borderRadius: 12, padding: "14px 18px" }}>
                <div style={{ fontSize: 28, fontWeight: 800, color: c, lineHeight: 1.1 }}>{n}</div>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: "#64748b", marginTop: 2 }}>{t}</div>
              </div>
            ))}
          </div>

          {/* list */}
          <div style={card}>
            <div style={{ fontWeight: 800, fontSize: 13, color: "#0f172a", marginBottom: 10 }}>
              ✗ NG points <span style={{ fontWeight: 600, color: "#94a3b8" }}>({rows.length})</span>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>{["Date", "Zone", "Line", "Machine No", "S.No", "Check Point", "Reason", "Status", "Action Taken", ""]
                  .map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
                <tbody>
                  {loading && <tr><td colSpan={10} style={{ ...td, textAlign: "center", color: "#94a3b8" }}>Loading…</td></tr>}
                  {!loading && rows.length === 0 && (
                    <tr><td colSpan={10} style={{ ...td, textAlign: "center", color: "#94a3b8" }}>
                      {status === "OPEN" ? "No open NG points 🎉" : "No NG points for this filter."}</td></tr>)}
                  {rows.map((r) => {
                    const closed = String(r.status || "OPEN").toUpperCase() === "CLOSED";
                    return (
                      <tr key={r.id} style={{ background: closed ? "#f8fafc" : "#fff" }}>
                        <td style={{ ...td, fontWeight: 800, whiteSpace: "nowrap" }}>{dateLabel(r.ng_date)}</td>
                        <td style={td}>{r.zone_name}</td>
                        <td style={td}>{r.line_name}</td>
                        <td style={{ ...td, fontWeight: 700 }}>{r.machine_no}</td>
                        <td style={{ ...td, textAlign: "center" }}>{r.s_no}</td>
                        <td style={{ ...td, minWidth: 240 }}>{r.check_point}</td>
                        <td style={{ ...td, minWidth: 180, color: "#b91c1c" }}>{r.reason || "—"}</td>
                        <td style={{ ...td, fontWeight: 800, whiteSpace: "nowrap",
                                     color: closed ? "#16a34a" : "#dc2626" }}>
                          {closed ? "✅ Closed" : "✗ Open"}
                        </td>
                        <td style={{ ...td, minWidth: 260 }}>
                          {closed ? (<>
                            <div style={{ color: "#15803d" }}>{r.action_taken}</div>
                            <div style={{ fontSize: 10.5, color: "#94a3b8", marginTop: 2 }}>
                              {r.closed_by || "—"}{r.closed_at ? ` · ${String(r.closed_at).replace("T", " ")}` : ""}
                            </div>
                          </>) : (
                            /* type the action straight here — no popup needed */
                            <input value={draft[r.id] ?? ""} placeholder="Type action taken…"
                                   onChange={(e) => setDraft((s) => ({ ...s, [r.id]: e.target.value }))}
                                   onKeyDown={(e) => { if (e.key === "Enter") submitAction(r); }}
                                   style={{ width: "100%", boxSizing: "border-box", padding: "6px 9px",
                                            borderRadius: 7, border: "1px solid #cbd5e1", fontSize: 12.5,
                                            fontFamily: "inherit", outline: "none", background: "#fffbeb" }} />
                          )}
                        </td>
                        <td style={{ ...td, whiteSpace: "nowrap" }}>
                          {closed
                            ? <button onClick={() => reopen(r)}
                                      style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff",
                                               cursor: "pointer", fontSize: 11.5, fontWeight: 700, color: "#64748b" }}>↩ Reopen</button>
                            : <button onClick={() => submitAction(r)} disabled={saving === r.id}
                                      style={{ padding: "5px 14px", borderRadius: 6, border: "none",
                                               background: (draft[r.id] || "").trim() ? "#16a34a" : "#cbd5e1",
                                               color: "#fff", cursor: "pointer", fontSize: 11.5, fontWeight: 800 }}>
                                {saving === r.id ? "Saving…" : "✅ Close"}</button>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

    </>
  );
}
