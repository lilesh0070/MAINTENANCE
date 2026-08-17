/* admin/MtbfRunningHours.jsx — MTBF Calculation (simple).

   Opened from the KPI Targets page.  Pick a Financial Year + a machine, type
   its running (operating) hours, Save.  Breakdown count comes automatically
   from the register, and MTBF = running_hours / breakdowns.  Saved rows list
   below with a Delete. */
import { useState, useEffect, useCallback, useMemo } from "react";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../api/client";
import { Card, Btn, Select, Input, Spinner, EmptyState } from "./ui";

// 2025-2026 up to the current FY (Apr–Mar) — same rule as KPI Targets.
const FY_START = 2025;
const CUR_FY_START = (() => {
  const d = new Date();
  return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
})();
const FYS = Array.from({ length: Math.max(1, CUR_FY_START - FY_START + 1) },
                      (_, i) => { const y = FY_START + i; return `${y}-${y + 1}`; });
const DEFAULT_FY = `${CUR_FY_START}-${CUR_FY_START + 1}`;

const lbl = { display: "block", fontSize: 10, fontWeight: 800, letterSpacing: ".08em",
              textTransform: "uppercase", color: "#64748b", marginBottom: 5 };
const th  = { padding: "8px 10px", whiteSpace: "nowrap", textAlign: "left" };
const td  = { padding: "8px 10px", whiteSpace: "nowrap", color: "#0f172a" };

export function MtbfRunningHours({ toast, readOnly = false, onBack }) {
  const { token } = useAuth();
  const [fy, setFy]   = useState(FYS.includes(DEFAULT_FY) ? DEFAULT_FY : FYS[FYS.length - 1]);
  const [master, setMaster] = useState([]);
  const [zone, setZone] = useState("");
  const [line, setLine] = useState("");
  const [machineNo, setMachineNo] = useState("");
  const [hours, setHours] = useState("");
  const [rows, setRows] = useState([]);          // saved rows for the FY
  const [loading, setLoading] = useState(false);
  const [saving, setSaving]   = useState(false);

  useEffect(() => {
    if (!token) return;
    api.get("/api/machines/", token).then(m => setMaster(Array.isArray(m) ? m : [])).catch(() => {});
  }, [token]);

  const zoneOpts = useMemo(
    () => [...new Set(master.map(m => m.zone_name).filter(Boolean))].sort(), [master]);
  const lineOpts = useMemo(
    () => zone ? [...new Set(master.filter(m => m.zone_name === zone).map(m => m.line_name).filter(Boolean))].sort() : [],
    [master, zone]);
  const machineOpts = useMemo(
    () => (zone && line)
      ? master.filter(m => m.zone_name === zone && m.line_name === line)
              .sort((a, b) => (a.serial_no || 0) - (b.serial_no || 0))
      : [], [master, zone, line]);

  const load = useCallback(async () => {
    if (!fy) { setRows([]); return; }
    setLoading(true);
    try {
      const r = await api.get(`/api/machine-running-hours/?fy=${encodeURIComponent(fy)}`, token);
      setRows(Array.isArray(r?.rows) ? r.rows : []);
    } catch (e) { toast?.(e.message || "Load failed", "err"); }
    finally     { setLoading(false); }
  }, [fy, token, toast]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!machineNo) { toast?.("Pehle machine chuno", "err"); return; }
    if (hours === "" || isNaN(parseFloat(hours))) { toast?.("Running hours daalo", "err"); return; }
    const m = machineOpts.find(x => String(x.machine_no) === String(machineNo));
    setSaving(true);
    try {
      await api.post("/api/machine-running-hours/", {
        fy,
        entries: [{
          zone_name: zone, line_name: line, serial_no: m?.serial_no ?? null,
          machine_no: machineNo, machine_name: m?.machine_name ?? null,
          running_hours: parseFloat(hours),
        }],
      }, token);
      toast?.("Saved", "ok");
      setHours("");
      await load();
    } catch (e) { toast?.(e.message || "Save failed", "err"); }
    finally     { setSaving(false); }
  };

  const del = async (id) => {
    try { await api.delete(`/api/machine-running-hours/${id}`, token); await load(); }
    catch (e) { toast?.(e.message || "Delete failed", "err"); }
  };

  return (
    <div>
      {/* Header — back + title + FY */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end",
                    marginBottom: 14, gap: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Btn size="sm" onClick={onBack}>← Back</Btn>
            <div style={{ fontWeight: 700, fontSize: 15, color: "#0f172a" }}>MTBF Calculation</div>
          </div>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 6, maxWidth: 720, lineHeight: 1.5 }}>
            Machine chuno, uske <b>running (operating) hours</b> daalo aur Save karo.
            MTBF = running hours ÷ breakdowns (breakdowns register se automatic).
          </div>
        </div>
        <div>
          <label style={lbl}>Financial Year *</label>
          <Select value={fy} onChange={e => setFy(e.target.value)} style={{ minWidth: 150, fontWeight: 700 }}>
            {FYS.map(y => <option key={y} value={y}>{y}</option>)}
          </Select>
        </div>
      </div>

      {/* Entry form: Zone → Line → Machine + Running Hours + Save */}
      {!readOnly && (
        <Card>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div>
              <label style={lbl}>Zone</label>
              <Select value={zone} onChange={e => { setZone(e.target.value); setLine(""); setMachineNo(""); }}
                      style={{ minWidth: 160 }}>
                <option value="">Select zone…</option>
                {zoneOpts.map(z => <option key={z} value={z}>{z}</option>)}
              </Select>
            </div>
            <div>
              <label style={lbl}>Line</label>
              <Select value={line} onChange={e => { setLine(e.target.value); setMachineNo(""); }}
                      style={{ minWidth: 160 }} disabled={!zone}>
                <option value="">Select line…</option>
                {lineOpts.map(l => <option key={l} value={l}>{l}</option>)}
              </Select>
            </div>
            <div>
              <label style={lbl}>Machine</label>
              <Select value={machineNo} onChange={e => setMachineNo(e.target.value)}
                      style={{ minWidth: 200 }} disabled={!line}>
                <option value="">Select machine…</option>
                {machineOpts.map(m => (
                  <option key={m.machine_no} value={m.machine_no}>
                    {m.machine_no}{m.machine_name ? ` — ${m.machine_name}` : ""}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label style={lbl}>Running Hours *</label>
              <Input type="number" min="0" step="any" value={hours} placeholder="e.g. 1200"
                     onChange={e => setHours(e.target.value)} style={{ width: 140 }} />
            </div>
            <Btn variant="primary" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Btn>
          </div>
        </Card>
      )}

      {/* Saved rows */}
      <div style={{ margin: "18px 0 8px", fontSize: 12, fontWeight: 800, color: "#1e40af" }}>
        SAVED · FY {fy}
      </div>
      <Card>
        {loading ? <Spinner /> : rows.length === 0 ? (
          <EmptyState text="Abhi kuch save nahi hua" sub={`FY ${fy} ke liye machine + running hours daalo`} />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ color: "#64748b", fontSize: 10, fontWeight: 800, letterSpacing: ".06em",
                             textTransform: "uppercase", borderBottom: "2px solid #eef2f7" }}>
                  <th style={th}>Machine No</th>
                  <th style={th}>Machine Name</th>
                  <th style={{ ...th, textAlign: "right" }}>Running Hours</th>
                  <th style={{ ...th, textAlign: "right" }}>Breakdowns</th>
                  <th style={{ ...th, textAlign: "right" }}>MTBF (hrs)</th>
                  {!readOnly && <th style={{ ...th, textAlign: "right" }}>Action</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} style={{ borderTop: "1px solid #eef2f7" }}>
                    <td style={{ ...td, fontWeight: 700 }}>{r.machine_no}</td>
                    <td style={{ ...td, color: "#475569", whiteSpace: "normal" }}>{r.machine_name}</td>
                    <td style={{ ...td, textAlign: "right" }}>{r.running_hours}</td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 700,
                                 color: r.breakdowns > 0 ? "#dc2626" : "#94a3b8" }}>{r.breakdowns}</td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 800,
                                 color: r.mtbf != null ? "#16a34a" : "#94a3b8" }}>
                      {r.mtbf != null ? r.mtbf : "—"}
                    </td>
                    {!readOnly && (
                      <td style={{ ...td, textAlign: "right" }}>
                        <Btn size="sm" variant="danger" onClick={() => del(r.id)}>Delete</Btn>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

export default MtbfRunningHours;
