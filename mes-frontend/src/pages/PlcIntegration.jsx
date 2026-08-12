/* ───────────────────────────────────────────────────────────────────
 * PlcIntegration.jsx — Sidebar → PLC Integration
 * ───────────────────────────────────────────────────────────────────
 * Mitsubishi PLC (Q series / FX5U CPU) se MC-Protocol (SLMP) par connect
 * karke device padhna-likhna.
 *   1. Connection add: zone/line/machine (Machine Master se) + IP + port + series
 *   2. Test connection (CPU type)
 *   3. Us PLC ke devices/"models": D / M / L / X / Y … add karo (type + address)
 *   4. Read → live values;  Write → word value ya bit ON/OFF
 * Backend: /api/plc/*
 */
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const SERIES = ["Q", "FX5U", "iQ-R", "L", "QnA"];

export default function PlcIntegration() {
  const { token, theme } = useAuth();
  const nav = useNavigate();
  const accent = theme?.accent || "#2563eb";

  const api = useCallback(async (path, opts = {}) => {
    const r = await fetch(`/api/plc${path}`, {
      ...opts,
      headers: { "Content-Type": "application/json",
                 ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) },
    });
    if (!r.ok) { const t = await r.text().catch(() => ""); throw new Error(t || `HTTP ${r.status}`); }
    return r.status === 204 ? null : r.json();
  }, [token]);

  const [master, setMaster] = useState([]);
  const [plcs, setPlcs]     = useState([]);
  const [status, setStatus] = useState({});   // id -> connected(bool), live TCP probe
  const [devTypes, setDevTypes] = useState([]);
  const [bitTypes, setBitTypes] = useState([]);
  const [msg, setMsg]       = useState(null);
  const flash = (t, ok = false) => { setMsg({ t, ok }); setTimeout(() => setMsg(null), 4000); };

  // add-PLC form
  const [f, setF] = useState({ zone: "", line: "", machine_no: "", machine_name: "", plc_ip: "", plc_port: 5007, series: "Q" });
  const [busy, setBusy] = useState(false);

  // selected PLC + its devices
  const [sel, setSel]       = useState(null);   // selected plc row
  const [devs, setDevs]     = useState([]);      // [{id,label,device_type,device_no,is_bit}]
  const [vals, setVals]     = useState({});      // id -> {value, error}
  const [reading, setReading] = useState(false);
  const [nd, setNd] = useState({ label: "", device_type: "D", device_no: "" });

  const loadMaster = useCallback(() => {
    fetch("/api/machines/", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : [])).then((m) => setMaster(Array.isArray(m) ? m : [])).catch(() => {});
  }, [token]);
  const loadPlcs = useCallback(() => {
    api("/").then((d) => { setPlcs(d.rows || []); setDevTypes(d.device_types || []); setBitTypes(d.bit_devices || []); }).catch(() => {});
  }, [api]);
  useEffect(() => { if (token) { loadMaster(); loadPlcs(); } }, [token, loadMaster, loadPlcs]);
  // live connected/offline — har 15s (quick TCP probe backend par)
  useEffect(() => {
    if (!token) return;
    const pull = () => api("/status").then(setStatus).catch(() => {});
    pull();
    const t = setInterval(pull, 15000);
    return () => clearInterval(t);
  }, [token, api, plcs.length]);

  // zone → line → machine cascade (Machine Master se — har page jaisa)
  const zones = useMemo(() => [...new Set(master.map((m) => m.zone_name).filter(Boolean))].sort(), [master]);
  const lines = useMemo(() => f.zone ? [...new Set(master.filter((m) => m.zone_name === f.zone).map((m) => m.line_name).filter(Boolean))].sort() : [], [master, f.zone]);
  const machines = useMemo(() => (f.zone && f.line) ? [...new Set(master.filter((m) => m.zone_name === f.zone && m.line_name === f.line).map((m) => m.machine_no).filter(Boolean))].sort() : [], [master, f.zone, f.line]);
  const onMachine = (v) => {
    const m = master.find((x) => x.zone_name === f.zone && x.line_name === f.line && String(x.machine_no) === String(v));
    setF((s) => ({ ...s, machine_no: v, machine_name: m?.machine_name || "" }));
  };

  const addPlc = async () => {
    if (!f.plc_ip.trim()) { flash("PLC IP daalein", false); return; }
    setBusy(true);
    try {
      await api("/", { method: "POST", body: JSON.stringify({
        zone_name: f.zone, line_name: f.line, machine_no: f.machine_no, machine_name: f.machine_name,
        plc_ip: f.plc_ip.trim(), plc_port: Number(f.plc_port) || 5007, series: f.series }) });
      setF({ zone: "", line: "", machine_no: "", machine_name: "", plc_ip: "", plc_port: 5007, series: "Q" });
      flash("PLC connection added ✓", true); loadPlcs();
    } catch (e) { flash(String(e.message || e).slice(0, 140), false); }
    finally { setBusy(false); }
  };
  const testPlc = async (p) => {
    setBusy(true);
    try { const r = await api(`/${p.id}/test`, { method: "POST" }); flash(`Connected ✓  CPU: ${r.cpu}`, true); }
    catch (e) { flash(String(e.message || e).slice(0, 160), false); }
    finally { setBusy(false); }
  };
  const delPlc = async (p) => {
    if (!window.confirm(`PLC ${p.plc_ip} hata dein?`)) return;
    try { await api(`/${p.id}`, { method: "DELETE" }); if (sel?.id === p.id) setSel(null); flash("PLC removed", true); loadPlcs(); }
    catch (e) { flash(String(e.message || e).slice(0, 140), false); }
  };

  // devices of the selected PLC
  const loadDevs = useCallback((pid) => {
    api(`/${pid}/devices`).then((d) => setDevs(Array.isArray(d) ? d : [])).catch(() => setDevs([]));
  }, [api]);
  const openPlc = (p) => { setSel(p); setVals({}); loadDevs(p.id); };
  const addDev = async () => {
    if (!nd.device_no.trim()) { flash("device address daalein", false); return; }
    try {
      await api(`/${sel.id}/devices`, { method: "POST", body: JSON.stringify(nd) });
      setNd({ label: "", device_type: "D", device_no: "" }); loadDevs(sel.id); flash("Device added ✓", true);
    } catch (e) { flash(String(e.message || e).slice(0, 140), false); }
  };
  const delDev = async (d) => {
    try { await api(`/devices/${d.id}`, { method: "DELETE" }); loadDevs(sel.id); }
    catch (e) { flash(String(e.message || e).slice(0, 120), false); }
  };
  const readAll = async () => {
    setReading(true);
    try {
      const r = await api(`/${sel.id}/read`, { method: "POST" });
      const map = {}; (r.values || []).forEach((v) => { map[v.id] = { value: v.value, error: v.error }; });
      setVals(map);
    } catch (e) { flash(String(e.message || e).slice(0, 160), false); }
    finally { setReading(false); }
  };
  const write = async (d, value) => {
    try {
      await api(`/devices/${d.id}/write`, { method: "POST", body: JSON.stringify({ value: Number(value) }) });
      flash(`${d.device_type}${d.device_no} ← ${value} ✓`, true); readAll();
    } catch (e) { flash(String(e.message || e).slice(0, 160), false); }
  };

  // ── styles ──
  const card = { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 18, marginBottom: 16 };
  const sel_ = { padding: "8px 10px", borderRadius: 8, border: "1px solid #cbd5e1", fontSize: 13, fontWeight: 600, background: "#fff", minWidth: 150 };
  const lab = { fontSize: 10.5, fontWeight: 800, color: "#64748b", marginBottom: 4, textTransform: "uppercase", letterSpacing: .3 };
  const th = { textAlign: "left", padding: "9px 12px", fontSize: 11, fontWeight: 800, color: "#fff", background: accent };
  const td = { padding: "8px 12px", fontSize: 12.5, color: "#334155", borderBottom: "1px solid #eef2f7" };
  const btn = (bg) => ({ border: "none", background: bg, color: "#fff", borderRadius: 7, padding: "6px 12px", fontSize: 12, fontWeight: 800, cursor: "pointer" });

  return (
    <div style={{ padding: "18px 22px", maxWidth: 1200, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
        <button onClick={() => nav("/dashboard")}
                style={{ border: "1px solid #e2e8f0", background: "#f1f5f9", color: "#475569", borderRadius: 8, padding: "8px 14px", fontWeight: 700, cursor: "pointer" }}>← Back</button>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#0f172a" }}>🔌 PLC <span style={{ color: accent }}>Integration</span></div>
          <div style={{ fontSize: 12, color: "#64748b" }}>Mitsubishi Q series / FX5U CPU · MC Protocol (SLMP) over TCP</div>
        </div>
      </div>

      {/* ── Add PLC connection ── */}
      <div style={{ ...card, borderLeft: `4px solid ${accent}` }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: "#0f172a", marginBottom: 12 }}>➕ Add PLC Connection</div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div><div style={lab}>Zone</div>
            <select style={sel_} value={f.zone} onChange={(e) => setF((s) => ({ ...s, zone: e.target.value, line: "", machine_no: "", machine_name: "" }))}>
              <option value="">— zone —</option>{zones.map((z) => <option key={z} value={z}>{z}</option>)}
            </select></div>
          <div><div style={lab}>Line</div>
            <select style={sel_} value={f.line} onChange={(e) => setF((s) => ({ ...s, line: e.target.value, machine_no: "", machine_name: "" }))}>
              <option value="">— line —</option>{lines.map((l) => <option key={l} value={l}>{l}</option>)}
            </select></div>
          <div><div style={lab}>Machine No.</div>
            <select style={sel_} value={f.machine_no} onChange={(e) => onMachine(e.target.value)}>
              <option value="">— machine —</option>{machines.map((m) => <option key={m} value={m}>{m}</option>)}
            </select></div>
          <div><div style={lab}>Machine Name</div>
            <input style={{ ...sel_, background: "#f8fafc" }} value={f.machine_name} readOnly placeholder="auto" /></div>
          <div><div style={lab}>PLC IP</div>
            <input style={sel_} value={f.plc_ip} placeholder="192.168.30.50" onChange={(e) => setF((s) => ({ ...s, plc_ip: e.target.value }))} /></div>
          <div><div style={lab}>Port</div>
            <input type="number" style={{ ...sel_, minWidth: 90 }} value={f.plc_port} onChange={(e) => setF((s) => ({ ...s, plc_port: e.target.value }))} /></div>
          <div><div style={lab}>Series</div>
            <select style={{ ...sel_, minWidth: 100 }} value={f.series} onChange={(e) => setF((s) => ({ ...s, series: e.target.value }))}>
              {SERIES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select></div>
          <button onClick={addPlc} disabled={busy} style={{ ...btn("#16a34a"), padding: "9px 18px", fontSize: 13 }}>{busy ? "…" : "✔ Add & Connect"}</button>
        </div>
      </div>

      {/* ── PLC list ── */}
      <div style={card}>
        <div style={{ fontSize: 14, fontWeight: 800, color: "#0f172a", marginBottom: 12 }}>🔌 PLC Connections <span style={{ color: "#94a3b8", fontWeight: 600 }}>({plcs.length})</span></div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
            <thead><tr>
              <th style={th}>Zone / Line</th><th style={th}>Machine</th><th style={th}>IP : Port</th><th style={th}>Series</th>
              <th style={th}>Status</th><th style={th}>Configure</th><th style={th}>Action</th>
            </tr></thead>
            <tbody>
              {plcs.length === 0 && <tr><td style={{ ...td, textAlign: "center", color: "#94a3b8" }} colSpan={7}>Koi PLC nahi — upar se add karein.</td></tr>}
              {plcs.map((p) => {
                const online = status[String(p.id)];
                return (
                <tr key={p.id} style={{ background: "#fff" }}>
                  <td style={td}>{p.zone_name || "—"} / {p.line_name || "—"}</td>
                  <td style={td}><b>{p.machine_no || "—"}</b> {p.machine_name ? `· ${p.machine_name}` : ""}</td>
                  <td style={{ ...td, fontFamily: "monospace" }}>{p.plc_ip} : {p.plc_port}</td>
                  <td style={td}>{p.series}</td>
                  <td style={td}>
                    {online === undefined
                      ? <span style={{ fontSize: 11.5, color: "#94a3b8", fontWeight: 700 }}>… checking</span>
                      : online
                        ? <span style={{ fontSize: 12, color: "#16a34a", fontWeight: 800 }}>● Connected</span>
                        : <span style={{ fontSize: 12, color: "#dc2626", fontWeight: 800 }}>○ Offline</span>}
                  </td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    <button onClick={() => nav(`/maintenance-plc/${p.id}`)} style={btn(accent)}>⚙ Configure</button>
                  </td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    <button onClick={() => delPlc(p)} style={btn("#dc2626")}>🗑 Delete</button>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {msg && (
        <div style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", zIndex: 900,
                      background: msg.ok ? "#16a34a" : "#dc2626", color: "#fff", padding: "10px 18px",
                      borderRadius: 10, fontSize: 13, fontWeight: 700, boxShadow: "0 8px 24px rgba(0,0,0,.25)" }}>
          {msg.t}
        </div>
      )}
    </div>
  );
}

function WordWrite({ onWrite }) {
  const [v, setV] = useState("");
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <input type="number" value={v} onChange={(e) => setV(e.target.value)} placeholder="value"
             style={{ width: 90, padding: "5px 8px", borderRadius: 7, border: "1px solid #cbd5e1", fontSize: 12.5 }} />
      <button onClick={() => { if (v !== "") onWrite(v); }}
              style={{ border: "none", background: "#2563eb", color: "#fff", borderRadius: 7, padding: "6px 12px", fontSize: 12, fontWeight: 800, cursor: "pointer" }}>Write</button>
    </span>
  );
}
