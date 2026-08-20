/* admin/breakdownmail.jsx — Breakdown Escalation Mail.

   Admin ek seedhi (ladder) banata hai: breakdown jitna lamba khichta jaayega,
   utne upar tak apne aap mail chala jaayega.

       Engineer      15 min -> a@x.com
       Sr. Engineer  30 min -> b@x.com
       ...
       Plant Head   240 min

   Ek level ka mail ek breakdown me SIRF EK BAAR jaata hai (backend log se).
   Backend: /api/breakdown-mail  (config / test / log) */
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../api/client";
import { Card, Btn, Input, Select, EmptyState, Spinner } from "./ui";
import { PROD_ZONES } from "../../constants/zones";

const lbl = { fontSize: 11, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase",
              color: "#64748b", marginBottom: 5, display: "block" };
const th  = { padding: "9px 10px", textAlign: "left", fontSize: 10.5, fontWeight: 800,
              letterSpacing: ".06em", textTransform: "uppercase", color: "#64748b",
              borderBottom: "2px solid #e2e8f0", whiteSpace: "nowrap" };
const td  = { padding: "8px 10px", fontSize: 13, color: "#334155", borderBottom: "1px solid #f1f5f9" };

// FY Apr->Mar; list 2025-26 se abhi tak
const FY_START = 2025;
const CUR_FY_Y = (() => { const d = new Date(); return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; })();
const FY_LIST  = Array.from({ length: Math.max(1, CUR_FY_Y - FY_START + 1) },
                            (_, i) => { const y = FY_START + i; return `${y}-${y + 1}`; }).reverse();
const FY_MONTHS = ["Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar"];

const fmtWhen = (t) => {
  if (!t) return "—";
  const d = new Date(t);
  return isNaN(d) ? String(t).slice(0, 16).replace("T", " ")
                  : `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} ` +
                    d.toTimeString().slice(0, 5);
};

export function BreakdownMailPage({ toast }) {
  const { token } = useAuth();
  const [auto, setAuto]     = useState(false);
  const [cc, setCc]         = useState("");
  const [levels, setLevels] = useState([]);
  const [log, setLog]       = useState([]);
  const [loading, setLoad]  = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTest]  = useState(null);
  // log ke filter
  const [master, setMaster] = useState([]);        // machine master (line/machine dropdown)
  const [f, setF] = useState({ fy: `${CUR_FY_Y}-${CUR_FY_Y + 1}`, month: "", zone: "", line: "", machine_no: "", role: "" });

  const load = useCallback(async () => {
    if (!token) return;
    setLoad(true);
    try {
      const q = new URLSearchParams({ limit: "200" });
      Object.entries(f).forEach(([k, v]) => { if (v) q.set(k, v); });
      const [c, l] = await Promise.all([
        api.get("/api/breakdown-mail/config", token),
        api.get(`/api/breakdown-mail/log?${q}`, token).catch(() => []),
      ]);
      setAuto(!!c.auto_enabled);
      setCc(c.cc || "");
      setLevels((c.levels || []).map((x) => ({ ...x, emails: x.emails || "" })));
      setLog(Array.isArray(l) ? l : []);
    } catch (e) { toast?.(e.message || "Load failed", "err"); }
    finally { setLoad(false); }
  }, [token, toast, f]);
  useEffect(() => { load(); }, [load]);

  // Machine Master ALAG se — pehle ye teeno ek hi Promise.all me the, to config
  // ke fail hote hi master bhi khali reh jaata aur Line/Machine ke dropdown
  // kabhi bharte hi nahi the.
  useEffect(() => {
    if (!token) return;
    api.get("/api/machines/", token)
       .then((m) => setMaster(Array.isArray(m) ? m : []))
       .catch(() => setMaster([]));
  }, [token]);

  const setLv = (i, k, v) => setLevels((p) => p.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const addLv = () => setLevels((p) => [...p, {
    id: null, seq: (p.length ? Math.max(...p.map((x) => x.seq || 0)) : 0) + 1,
    role_label: "", after_minutes: 30, emails: "", enabled: true }]);
  const delLv = (i) => setLevels((p) => p.filter((_, j) => j !== i));

  const save = async () => {
    // seq hamesha upar-se-neeche ke hisaab se, taaki ladder ka kram wahi rahe jo dikh raha hai
    const body = { auto_enabled: auto, cc,
                   levels: levels.map((l, i) => ({ ...l, seq: i + 1,
                                                   after_minutes: Number(l.after_minutes) || 0 })) };
    setSaving(true);
    try {
      await api.put("/api/breakdown-mail/config", body, token);
      toast?.("Saved ✓");
      load();
    } catch (e) { toast?.(e.message || "Save failed", "err"); }
    finally { setSaving(false); }
  };

  const test = async (lv) => {
    setTest(lv.id);
    try {
      const r = await api.post("/api/breakdown-mail/test", { level_id: lv.id }, token);
      toast?.(`Test mail gaya: ${(r.sent_to || []).join(", ")}`);
      load();
    } catch (e) { toast?.(e.message || "Test mail fail", "err"); }
    finally { setTest(null); }
  };

  if (loading) return <Spinner />;

  const sorted = [...levels];
  const anyEmail = levels.some((l) => (l.emails || "").includes("@"));
  // Line / Machine ke option Machine Master se — zone chunne par hi bharte hain
  const lineOpts = f.zone
    ? [...new Set(master.filter((m) => m.zone_name === f.zone).map((m) => m.line_name).filter(Boolean))].sort()
    : [];
  const machineOpts = (f.zone && f.line)
    ? [...new Set(master.filter((m) => m.zone_name === f.zone && m.line_name === f.line)
                        .map((m) => m.machine_no).filter(Boolean))].sort()
    : [];

  return (
    <div>
      {/* header + master switch */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end",
                    gap: 16, marginBottom: 14, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: "#0f172a" }}>Breakdown Escalation Mail</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 9, cursor: "pointer",
                          padding: "9px 14px", borderRadius: 10, fontWeight: 700, fontSize: 13,
                          border: `1.5px solid ${auto ? "#16a34a" : "#e2e8f0"}`,
                          background: auto ? "#dcfce7" : "#fff",
                          color: auto ? "#15803d" : "#475569" }}>
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)}
                   style={{ width: 16, height: 16, accentColor: "#16a34a", cursor: "pointer" }} />
            {auto ? "Auto-mail CHALU" : "Auto-mail BAND"}
          </label>
          <Btn variant="primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Btn>
        </div>
      </div>

      {!auto && (
        <div style={{ background: "#fff7ed", border: "1px solid #fed7aa", color: "#9a3412",
                      borderRadius: 10, padding: "10px 14px", fontSize: 12.5, fontWeight: 600,
                      marginBottom: 14 }}>
          Auto-mail band hai.
        </div>
      )}
      {auto && !anyEmail && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c",
                      borderRadius: 10, padding: "10px 14px", fontSize: 12.5, fontWeight: 600,
                      marginBottom: 14 }}>
          Kisi level me email nahi bhara.
        </div>
      )}

      {/* ladder */}
      <Card>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
            <thead><tr>
              {["#", "Kis level ko", "Kitne minute baad", "Email (comma se alag)", "Chalu", ""]
                .map((h, i) => <th key={i} style={th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {sorted.map((l, i) => (
                <tr key={i} style={{ opacity: l.enabled ? 1 : 0.5 }}>
                  <td style={{ ...td, fontWeight: 800, color: "#b45309", width: 34 }}>{i + 1}</td>
                  <td style={{ ...td, width: 170 }}>
                    <Input value={l.role_label} placeholder="Engineer"
                           onChange={(e) => setLv(i, "role_label", e.target.value)} />
                  </td>
                  <td style={{ ...td, width: 140 }}>
                    <Input type="number" min="1" value={l.after_minutes}
                           onChange={(e) => setLv(i, "after_minutes", e.target.value)} />
                  </td>
                  <td style={td}>
                    <Input value={l.emails} placeholder="name@toyota-boshoku.com"
                           onChange={(e) => setLv(i, "emails", e.target.value)} />
                  </td>
                  <td style={{ ...td, textAlign: "center", width: 60 }}>
                    <input type="checkbox" checked={!!l.enabled}
                           onChange={(e) => setLv(i, "enabled", e.target.checked)}
                           style={{ width: 16, height: 16, accentColor: "#16a34a", cursor: "pointer" }} />
                  </td>
                  <td style={{ ...td, whiteSpace: "nowrap", width: 150 }}>
                    <Btn size="sm" onClick={() => test(l)}
                         disabled={!l.id || testing === l.id || !(l.emails || "").includes("@")}>
                      {testing === l.id ? "…" : "✉ Test"}
                    </Btn>{" "}
                    <Btn size="sm" variant="danger" onClick={() => delLv(i)}>🗑</Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <Btn size="sm" onClick={addLv}>+ Level add karo</Btn>
        </div>
      </Card>

      {/* CC */}
      <div style={{ marginTop: 16, maxWidth: 520 }}>
        <label style={lbl}>CC — har mail me (optional)</label>
        <Input value={cc} placeholder="head@toyota-boshoku.com, ..." onChange={(e) => setCc(e.target.value)} />
      </div>

      {/* bheje gaye mail */}
      <div style={{ margin: "22px 0 10px", fontWeight: 800, fontSize: 13, color: "#b45309",
                    textTransform: "uppercase", letterSpacing: ".05em" }}>
        Pichhle bheje gaye mail
      </div>

      {/* filter — FY / month / zone / line / machine / level */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}>
        <div><label style={lbl}>Financial Year</label>
          <Select value={f.fy} onChange={(e) => setF({ ...f, fy: e.target.value })}>
            <option value="">All</option>
            {FY_LIST.map((y) => <option key={y} value={y}>{y}</option>)}
          </Select></div>
        <div><label style={lbl}>Month</label>
          <Select value={f.month} onChange={(e) => setF({ ...f, month: e.target.value })}>
            <option value="">All months</option>
            {FY_MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
          </Select></div>
        <div><label style={lbl}>Zone</label>
          <Select value={f.zone} onChange={(e) => setF({ ...f, zone: e.target.value, line: "", machine_no: "" })}>
            <option value="">All Zones</option>
            {PROD_ZONES.map((z) => <option key={z} value={z}>{z}</option>)}
          </Select></div>
        <div><label style={lbl}>Line</label>
          <Select value={f.line} disabled={!f.zone}
                  onChange={(e) => setF({ ...f, line: e.target.value, machine_no: "" })}>
            <option value="">All Lines</option>
            {lineOpts.map((l) => <option key={l} value={l}>{l}</option>)}
          </Select></div>
        <div><label style={lbl}>Machine No.</label>
          <Select value={f.machine_no} disabled={!f.line}
                  onChange={(e) => setF({ ...f, machine_no: e.target.value })}>
            <option value="">All Machine No.</option>
            {machineOpts.map((m) => <option key={m} value={m}>{m}</option>)}
          </Select></div>
        <div><label style={lbl}>Level</label>
          <Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
            <option value="">All levels</option>
            {levels.map((l) => <option key={l.id || l.role_label} value={l.role_label}>{l.role_label}</option>)}
          </Select></div>
        <Btn size="sm" onClick={() => setF({ fy: "", month: "", zone: "", line: "", machine_no: "", role: "" })}>
          ✕ Clear
        </Btn>
      </div>

      <Card>
        {log.length === 0 ? (
          <EmptyState text="Abhi tak koi escalation mail nahi gaya" />
        ) : (
          <div style={{ overflowX: "auto", maxHeight: 300, overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
              <thead><tr>
                {["Kab", "Level", "Zone", "Line", "Machine", "Minute", "Kise gaya", "Status"]
                  .map((h, i) => <th key={i} style={{ ...th, position: "sticky", top: 0, background: "#fff" }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {log.map((r) => (
                  <tr key={r.id}>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>{fmtWhen(r.sent_at)}</td>
                    <td style={{ ...td, fontWeight: 700 }}>{r.role_label || "—"}</td>
                    <td style={td}>{r.zone || "—"}</td>
                    <td style={td}>{r.line || "—"}</td>
                    <td style={td}>{r.machine_no || "—"}</td>
                    <td style={{ ...td, fontWeight: 700 }}>{r.minutes != null ? `${r.minutes} min` : "—"}</td>
                    <td style={{ ...td, maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis",
                                 whiteSpace: "nowrap" }}>{r.to_emails || "—"}</td>
                    <td style={td}>
                      <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 99,
                                     fontSize: 11, fontWeight: 800,
                                     background: r.ok ? "#dcfce7" : "#fee2e2",
                                     color: r.ok ? "#15803d" : "#b91c1c" }}
                            title={r.err || ""}>
                        {r.ok ? "GAYA" : "FAIL"}
                      </span>
                    </td>
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
