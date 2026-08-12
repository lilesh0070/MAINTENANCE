/* ───────────────────────────────────────────────────────────────────
 * PlcConfigure.jsx — Sidebar → PLC Integration → ⚙ Configure
 * ───────────────────────────────────────────────────────────────────
 * Ek PLC par flat mapping DEFINE karo — ek hi row me:
 *   Machine No · Device (D1016) · PLC Value · Model Name  → + Add
 * "Read live values" → PLC se abhi ki value + us value ka matched model.
 * Value WRITE nahi hoti.  Added row delete ho sakti hai.
 * Route: /maintenance-plc/:pid   ·   Backend: /api/plc/*
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function PlcConfigure() {
  const { pid } = useParams();
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

  const [plc, setPlc]   = useState(null);
  const [devs, setDevs] = useState([]);      // [{id,device_type,device_no,is_bit,models:[{id,plc_value,model_name}]}]
  const [devTypes, setDevTypes] = useState([]);   // dropdown: D / M / L / X / Y …
  const [vals, setVals] = useState({});      // device_id -> {value, model_name, error}
  const [reading, setReading] = useState(false);
  const [msg, setMsg]   = useState(null);
  const flash = (t, ok = false) => { setMsg({ t, ok }); setTimeout(() => setMsg(null), 4000); };

  // single add-row (flat sequence) — device type dropdown se, number alag
  const [row, setRow] = useState({ device_type: "D", device_no: "", value: "", model: "" });

  const loadPlc = useCallback(() => {
    api("/").then((d) => { setDevTypes(d.device_types || []); setPlc((d.rows || []).find((r) => String(r.id) === String(pid)) || null); }).catch(() => {});
  }, [api, pid]);
  const loadDevs = useCallback(() => {
    api(`/${pid}/devices`).then((d) => setDevs(Array.isArray(d) ? d : [])).catch(() => setDevs([]));
  }, [api, pid]);
  useEffect(() => { if (token) { loadPlc(); loadDevs(); } }, [token, loadPlc, loadDevs]);

  // saari mappings ek flat list me (har row = device + value + model)
  const flatRows = devs.flatMap((d) =>
    (d.models || []).map((m) => ({ ...m, device_type: d.device_type, device_no: d.device_no, device_id: d.id })));

  // Add: type dropdown + number → device find-or-create, phir value→model mapping add
  const addFlat = async () => {
    const dtype = (row.device_type || "").toUpperCase().trim();
    const dno = String(row.device_no || "").trim();
    if (!dtype || !dno) { flash("Device: type chuno + number bharo", false); return; }
    if (row.value === "" || !row.model.trim()) { flash("Value aur Model Name — dono bharo", false); return; }
    try {
      let dev = devs.find((d) => d.device_type === dtype && String(d.device_no) === String(dno));
      let did = dev?.id;
      if (!did) {
        const r = await api(`/${pid}/devices`, { method: "POST", body: JSON.stringify({ label: "", device_type: dtype, device_no: dno }) });
        did = r.id;
      }
      await api(`/devices/${did}/models`, { method: "POST", body: JSON.stringify({ plc_value: Number(row.value), model_name: row.model.trim() }) });
      setRow({ device_type: dtype, device_no: "", value: "", model: "" });
      loadDevs(); flash("Added ✓", true);
    } catch (e) { flash(String(e.message || e).slice(0, 140), false); }
  };
  const delRow = async (mid) => {
    try { await api(`/models/${mid}`, { method: "DELETE" }); loadDevs(); }
    catch (e) { flash(String(e.message || e).slice(0, 120), false); }
  };
  const readAll = async () => {
    setReading(true);
    try { const r = await api(`/${pid}/read`, { method: "POST" });
      const m = {}; (r.values || []).forEach((v) => { m[v.id] = v; }); setVals(m); }
    catch (e) { flash(String(e.message || e).slice(0, 160), false); }
    finally { setReading(false); }
  };

  const card = { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 18, marginBottom: 16 };
  const inp = { padding: "8px 10px", borderRadius: 8, border: "1px solid #cbd5e1", fontSize: 13, background: "#fff" };
  const th = { textAlign: "left", padding: "9px 12px", fontSize: 11, fontWeight: 800, color: "#fff", background: accent };
  const td = { padding: "8px 12px", fontSize: 12.5, color: "#334155", borderBottom: "1px solid #eef2f7", verticalAlign: "middle" };
  const btn = (bg) => ({ border: "none", background: bg, color: "#fff", borderRadius: 7, padding: "6px 12px", fontSize: 12, fontWeight: 800, cursor: "pointer" });

  return (
    <div style={{ padding: "18px 22px", maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
        <button onClick={() => nav("/maintenance-plc")}
                style={{ border: "1px solid #e2e8f0", background: "#f1f5f9", color: "#475569", borderRadius: 8, padding: "8px 14px", fontWeight: 700, cursor: "pointer" }}>← PLC List</button>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#0f172a" }}>⚙ PLC <span style={{ color: accent }}>Configure</span></div>
          <div style={{ fontSize: 12, color: "#64748b" }}>
            {plc ? <>{plc.machine_no || "—"} · <span style={{ fontFamily: "monospace" }}>{plc.plc_ip}:{plc.plc_port}</span> ({plc.series})</> : "…"}
            {"  ·  value → model define (write nahi)"}
          </div>
        </div>
        <button onClick={readAll} disabled={reading} style={{ ...btn(accent), padding: "9px 16px", fontSize: 13, marginLeft: "auto" }}>
          {reading ? "Reading…" : "🔄 Read live values"}</button>
      </div>

      <div style={{ ...card, borderLeft: `4px solid ${accent}` }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: "#0f172a", marginBottom: 12 }}>🧩 Machine · Device · Value · Model</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 780 }}>
            <thead><tr>
              <th style={th}>Machine No</th><th style={th}>Device</th><th style={th}>PLC Value</th>
              <th style={th}>Model Name</th><th style={th}>Live</th><th style={th}>Action</th>
            </tr></thead>
            <tbody>
              {flatRows.length === 0 &&
                <tr><td colSpan={6} style={{ ...td, textAlign: "center", color: "#94a3b8" }}>Koi mapping nahi — niche row me bhar ke Add karein.</td></tr>}
              {flatRows.map((r) => {
                const live = vals[r.device_id];
                const active = live && live.value === r.plc_value;
                return (
                  <tr key={r.id} style={{ background: active ? "#dcfce7" : "#fff" }}>
                    <td style={td}>{plc?.machine_no || "—"}</td>
                    <td style={{ ...td, fontFamily: "monospace", fontWeight: 700 }}>{r.device_type}{r.device_no}</td>
                    <td style={{ ...td, fontFamily: "monospace", fontWeight: 800 }}>{r.plc_value}</td>
                    <td style={{ ...td, fontWeight: 700, color: "#0f172a" }}>{r.model_name}</td>
                    <td style={td}>
                      {active ? <span style={{ color: "#16a34a", fontWeight: 800 }}>● ACTIVE</span>
                        : (live && live.value != null) ? <span style={{ color: "#cbd5e1" }}>—</span> : ""}
                    </td>
                    <td style={td}><button onClick={() => delRow(r.id)} style={btn("#dc2626")}>🗑 Delete</button></td>
                  </tr>
                );
              })}
              {/* add row — Machine No (auto) · Device · Value · Model · Add */}
              <tr style={{ background: "#f8fafc" }}>
                <td style={td}><span style={{ color: "#64748b", fontWeight: 700 }}>{plc?.machine_no || "—"}</span></td>
                <td style={td}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <select value={row.device_type} onChange={(e) => setRow((s) => ({ ...s, device_type: e.target.value }))}
                            style={{ ...inp, minWidth: 78, fontWeight: 700 }}>
                      {devTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <input value={row.device_no} placeholder="No. (e.g. 1016)" style={{ ...inp, width: 120 }}
                           onChange={(e) => setRow((s) => ({ ...s, device_no: e.target.value }))} />
                  </div>
                </td>
                <td style={td}><input type="number" value={row.value} placeholder="e.g. 10" style={{ ...inp, width: 100 }}
                                      onChange={(e) => setRow((s) => ({ ...s, value: e.target.value }))} /></td>
                <td style={td}><input value={row.model} placeholder="model name (e.g. YHB 4WAY OTR)" style={{ ...inp, width: "100%", maxWidth: 320 }}
                                      onChange={(e) => setRow((s) => ({ ...s, model: e.target.value.toUpperCase() }))}
                                      onKeyDown={(e) => { if (e.key === "Enter") addFlat(); }} /></td>
                <td style={td}></td>
                <td style={td}><button onClick={addFlat} style={btn("#16a34a")}>+ Add</button></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 11.5, color: "#94a3b8", marginTop: 10, lineHeight: 1.5 }}>
          <b>Device</b> = register (jaise D1016) · <b>PLC Value</b> = us register ki value · <b>Model Name</b> = us value ka model.
          &nbsp;<b>Read live values</b> dabao → PLC se abhi ka value aata hai aur matching model row <span style={{ color: "#16a34a", fontWeight: 700 }}>● ACTIVE</span> ho jaati hai.
        </div>
      </div>

      {msg && (
        <div style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", zIndex: 900,
                      background: msg.ok ? "#16a34a" : "#dc2626", color: "#fff", padding: "10px 18px",
                      borderRadius: 10, fontSize: 13, fontWeight: 700, boxShadow: "0 8px 24px rgba(0,0,0,.25)" }}>{msg.t}</div>
      )}
    </div>
  );
}
