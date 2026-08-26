/* ───────────────────────────────────────────────────────────────────
 * MachineMaster.jsx — Machine Master (sidebar → Machine Master)
 * ───────────────────────────────────────────────────────────────────
 * `maintenance_machines` ka aamne-saamne wala roop.  Ye poore app ka
 * master hai — har zone/line/machine dropdown, har filter, har report
 * isi table se chalti hai.  Isliye yahan jo jud'ta ya badalta hai, wo
 * turant har jagah dikh jaata hai; koi doosri jagah alag se nahi bharni.
 *
 * DELETE jaan-boojh kar nahi hai.  Machine ki poori history (breakdown,
 * PM, DMC, spare, KPI) `machine_no` se judi hoti hai — machine mita
 * denge to wo sab anaath ho jayegi.  Uski jagah DISABLE hai: machine har
 * dropdown se hat jaati hai par uska record aur history bani rehti hai,
 * aur baad me chahe to wapas chalu ho jaati hai.
 *
 * Machine No badalne par backend us machine ki poori history bhi SAATH
 * badal deta hai (ek hi transaction me), isliye rename se kuch tootta
 * nahi.  Save se pehle hum bata dete hain ki kitne records saath
 * chalenge — taaki ye badlaav andhera na lage.
 *
 * Likhne ka haq sirf ADMIN ko (backend bhi wahi maanta hai); baaki sab
 * dekh sakte hain.
 * ─────────────────────────────────────────────────────────────────── */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";

const api = {
  async req(path, token, opts = {}) {
    const r = await fetch(path, {
      ...opts,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(opts.body ? { "Content-Type": "application/json" } : {}),
      },
    });
    const txt = await r.text();
    if (!r.ok) {
      // FastAPI apni galti {"detail": "..."} me bhejta hai — wahi dikhana
      // chahiye, poora JSON nahi.
      let msg = txt;
      try { msg = JSON.parse(txt).detail || txt; } catch { /* plain text */ }
      throw new Error(msg || `HTTP ${r.status}`);
    }
    return txt ? JSON.parse(txt) : null;
  },
  get(p, t)        { return api.req(p, t); },
  post(p, b, t)    { return api.req(p, t, { method: "POST", body: JSON.stringify(b) }); },
  put(p, b, t)     { return api.req(p, t, { method: "PUT",  body: JSON.stringify(b) }); },
};

const BLANK = { zone_name: "", line_name: "", machine_no: "", machine_name: "", ip: "" };

/* ── chhote tukde MODULE level par ──────────────────────────────────
   Inhe component ke andar banate to har render par ye naye ban'te aur
   React unhe nayi cheez maan kar poora dobara mount karta — jisse form
   ka focus aur khula hua dropdown ud jaata. */
const Pill = ({ on }) => (
  <span style={{
    fontSize: 10.5, fontWeight: 800, letterSpacing: ".03em", padding: "2px 9px",
    borderRadius: 99, whiteSpace: "nowrap",
    background: on ? "#dcfce7" : "#fee2e2", color: on ? "#15803d" : "#b91c1c",
  }}>{on ? "ACTIVE" : "DISABLED"}</span>
);

const Field = ({ label, hint, children }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
    <label style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".05em",
                    textTransform: "uppercase", color: "#64748b" }}>{label}</label>
    {children}
    {hint && <div style={{ fontSize: 10.5, color: "#94a3b8" }}>{hint}</div>}
  </div>
);

export default function MachineMaster() {
  const { token, theme, user, isAdmin } = useAuth();

  const [rows, setRows]   = useState([]);
  const [busy, setBusy]   = useState(true);
  const [err, setErr]     = useState("");
  const [msg, setMsg]     = useState("");

  const [fZone, setFZone] = useState("");
  const [fLine, setFLine] = useState("");
  const [q, setQ]         = useState("");
  const [showOff, setShowOff] = useState(true);

  // form: null = band | {mode:"add"} | {mode:"edit", row}
  const [form, setForm]   = useState(null);
  const [draft, setDraft] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [usage, setUsage] = useState(null);   // rename par kitni history saath chalegi

  const load = useCallback(() => {
    if (!token) return;
    setBusy(true); setErr("");
    api.get("/api/machines/master", token)
      .then((d) => setRows(Array.isArray(d) ? d : []))
      .catch((e) => { setErr(String(e.message || e).slice(0, 250)); setRows([]); })
      .finally(() => setBusy(false));
  }, [token]);

  useEffect(() => { load(); }, [load]);

  // toast apne aap gayab
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(""), 4000);
    return () => clearTimeout(t);
  }, [msg]);

  const zones = useMemo(
    () => [...new Set(rows.map(r => r.zone_name).filter(Boolean))].sort(), [rows]);
  const lines = useMemo(
    () => [...new Set(rows.filter(r => !fZone || r.zone_name === fZone)
                          .map(r => r.line_name).filter(Boolean))].sort(), [rows, fZone]);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (!showOff && !r.is_active) return false;
      if (fZone && r.zone_name !== fZone) return false;
      if (fLine && r.line_name !== fLine) return false;
      if (needle) {
        const hay = `${r.machine_no || ""} ${r.machine_name || ""} ${r.ip || ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [rows, fZone, fLine, q, showOff]);

  const openAdd = () => { setUsage(null); setDraft(BLANK); setForm({ mode: "add" }); };
  const openEdit = (r) => {
    setUsage(null);
    setDraft({
      zone_name: r.zone_name || "", line_name: r.line_name || "",
      machine_no: r.machine_no || "", machine_name: r.machine_name || "", ip: r.ip || "",
    });
    setForm({ mode: "edit", row: r });
  };
  const closeForm = () => { setForm(null); setUsage(null); setErr(""); };
  const setD = (k, v) => setDraft(d => ({ ...d, [k]: v }));

  // Machine No badla ja raha hai — pehle dikhao kitni history saath chalegi.
  // Ye sirf padhne wali call hai, kuch badalti nahi.
  const renaming = form?.mode === "edit"
    && draft.machine_no.trim() && draft.machine_no.trim() !== form.row.machine_no;

  useEffect(() => {
    if (!renaming || !form?.row?.id) { setUsage(null); return; }
    let ignore = false;
    api.get(`/api/machines/master/${form.row.id}/usage`, token)
      .then((u) => { if (!ignore) setUsage(u); })
      .catch(() => { if (!ignore) setUsage(null); });
    return () => { ignore = true; };
  }, [renaming, form, token]);

  const save = async () => {
    setSaving(true); setErr("");
    try {
      if (form.mode === "add") {
        await api.post("/api/machines/master", draft, token);
        setMsg(`Machine "${draft.machine_no.trim()}" added`);
      } else {
        const res = await api.put(`/api/machines/master/${form.row.id}`, draft, token);
        setMsg(res.cascaded_total
          ? `Saved — ${res.cascaded_total} history records moved to the new Machine No`
          : "Saved");
      }
      closeForm();
      load();
    } catch (e) {
      setErr(String(e.message || e).slice(0, 250));
    } finally { setSaving(false); }
  };

  const toggleActive = async (r) => {
    setErr("");
    try {
      await api.put(`/api/machines/master/${r.id}`, { is_active: !r.is_active }, token);
      setMsg(r.is_active
        ? `"${r.machine_no}" disabled — it will no longer appear in any dropdown`
        : `"${r.machine_no}" enabled`);
      load();
    } catch (e) { setErr(String(e.message || e).slice(0, 250)); }
  };

  const th = { border: "1px solid #cbd5e1", padding: "8px 10px", fontSize: 10.5, fontWeight: 800,
               background: "#f1f5f9", color: "#1e293b", textAlign: "left",
               position: "sticky", top: 0, zIndex: 1, whiteSpace: "nowrap",
               letterSpacing: ".04em", textTransform: "uppercase" };
  const td = { border: "1px solid #e2e8f0", padding: "7px 10px", fontSize: 12.5, color: "#334155" };
  const inp = { border: "1.5px solid #cbd5e1", borderRadius: 9, padding: "9px 12px",
                fontSize: 13, fontWeight: 600, color: "#0f172a", outline: "none",
                fontFamily: "'Barlow',sans-serif", background: "#fff", width: "100%" };

  const canSave = draft.zone_name.trim() && draft.line_name.trim()
               && draft.machine_no.trim() && draft.machine_name.trim();

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700;800&family=Barlow+Condensed:wght@600;700;800&display=swap');
        .mm-root { min-height:100vh; background:#f8fafc; font-family:'Barlow',sans-serif; padding-bottom:60px; }
        .mm-top { background:#fff; border-bottom:1px solid #e2e8f0; padding:0 40px 0 88px; height:60px;
          display:flex; align-items:center; justify-content:space-between; position:sticky; top:0; z-index:100;
          box-shadow:0 1px 3px rgba(0,0,0,.06); }
        .mm-top::after { content:''; position:absolute; bottom:0; left:0; right:0; height:2px; background:${theme.gradient}; }
        .mm-title { font-family:'Barlow Condensed',sans-serif; font-size:22px; font-weight:800; color:#0f172a; }
        .mm-title span { color:${theme.accent}; }
        .mm-sub { font-size:11px; color:#94a3b8; margin-top:-2px; }
        .mm-filters { max-width:1600px; margin:16px auto 0; padding:0 22px;
                      display:flex; gap:12px; flex-wrap:wrap; align-items:flex-end; }
        .mm-sel { border:1.5px solid #cbd5e1; border-radius:9px; padding:9px 12px; font-size:13px; font-weight:600;
                  color:#0f172a; outline:none; font-family:'Barlow',sans-serif; background:#fff; min-width:150px; }
        .mm-sel:focus { border-color:${theme.accent}; }
        .mm-sel:disabled { background:#f1f5f9; color:#94a3b8; cursor:not-allowed; }
        .mm-btn { display:flex; align-items:center; gap:6px; font-size:13px; font-weight:700; color:#475569;
                  background:#f1f5f9; border:1px solid #e2e8f0; border-radius:9px; padding:9px 16px; cursor:pointer;
                  font-family:'Barlow',sans-serif; }
        .mm-btn.primary { background:${theme.accent}; color:#fff; border-color:${theme.accent}; }
        .mm-btn:disabled { opacity:.5; cursor:not-allowed; }
        .mm-body { max-width:1600px; margin:16px auto 0; padding:0 22px; }
        .mm-card { background:#fff; border:1px solid #e2e8f0; border-radius:14px;
                   box-shadow:0 1px 4px rgba(15,23,42,.06); padding:16px 18px; }
        .mm-row:nth-child(even) { background:#fafbfc; }
        .mm-act { font-size:11.5px; font-weight:800; border-radius:7px; padding:4px 10px;
                  cursor:pointer; border:1px solid #e2e8f0; background:#fff; color:#475569;
                  font-family:'Barlow',sans-serif; }
      `}</style>

      <div className="mm-root">
        <div className="mm-top">
          <div>
            <div className="mm-title">🏭 <span>Machine Master</span></div>
            <div className="mm-sub">Zone · Line · Machine No · Machine Name · IP — the single source for every dropdown</div>
          </div>
          {user?.username && <span style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>{user.username}</span>}
        </div>

        <div className="mm-filters">
          <Field label="Zone">
            <select className="mm-sel" value={fZone}
                    onChange={(e) => { setFZone(e.target.value); setFLine(""); }}>
              <option value="">All Zones</option>
              {zones.map(z => <option key={z} value={z}>{z}</option>)}
            </select>
          </Field>
          <Field label="Line">
            <select className="mm-sel" value={fLine} onChange={(e) => setFLine(e.target.value)}
                    disabled={!fZone}>
              <option value="">All Lines</option>
              {lines.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </Field>
          <Field label="Search">
            <input className="mm-sel" style={{ minWidth: 220 }} value={q}
                   placeholder="Machine No, name or IP"
                   onChange={(e) => setQ(e.target.value)} />
          </Field>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <label style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".05em",
                            textTransform: "uppercase", color: "#64748b" }}>Disabled</label>
            <button className="mm-btn" onClick={() => setShowOff(v => !v)}>
              {showOff ? "☑ Showing" : "☐ Hidden"}
            </button>
          </div>
          <button className="mm-btn" onClick={() => { setFZone(""); setFLine(""); setQ(""); }}>✕ Clear</button>
          {isAdmin && (
            <button className="mm-btn primary" onClick={openAdd}>+ Add Machine</button>
          )}
        </div>

        <div className="mm-body">
          {err && !form && (
            <div className="mm-card" style={{ marginBottom: 12, color: "#b91c1c", fontWeight: 700, fontSize: 12.5 }}>
              {err}
            </div>
          )}
          {msg && (
            <div className="mm-card" style={{ marginBottom: 12, color: "#15803d", fontWeight: 700,
                                              fontSize: 12.5, background: "#f0fdf4", borderColor: "#bbf7d0" }}>
              {msg}
            </div>
          )}

          <div className="mm-card">
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between",
                          marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
              <div>
                <h3 style={{ fontSize: 14, fontWeight: 800, color: "#0f172a", margin: 0 }}>
                  Machines <span style={{ color: theme.accent }}>{list.length}</span>
                  {list.length !== rows.length && (
                    <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 700 }}> of {rows.length}</span>
                  )}
                </h3>
                <div style={{ fontSize: 11, color: "#94a3b8" }}>
                  {rows.filter(r => r.is_active).length} active · {rows.filter(r => !r.is_active).length} disabled
                  · {rows.filter(r => r.ip).length} with IP
                </div>
              </div>
              {!isAdmin && (
                <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 700 }}>
                  Read-only — only an admin can add or change machines
                </div>
              )}
            </div>

            {busy ? (
              <div style={{ padding: "26px 0", textAlign: "center", color: "#94a3b8", fontSize: 12.5 }}>Loading…</div>
            ) : (
              <div style={{ overflowX: "auto", maxHeight: "68vh", overflowY: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
                  <thead>
                    <tr>
                      {["#", "Zone", "Line", "Machine No", "Machine Name", "IP", "Status",
                        ...(isAdmin ? ["Actions"] : [])].map(h => <th key={h} style={th}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((r) => (
                      <tr key={r.id} className="mm-row" style={{ opacity: r.is_active ? 1 : .6 }}>
                        <td style={{ ...td, textAlign: "center", color: "#94a3b8" }}>{r.serial_no}</td>
                        <td style={td}>{r.zone_name}</td>
                        <td style={td}>{r.line_name}</td>
                        <td style={{ ...td, fontWeight: 800, whiteSpace: "nowrap" }}>{r.machine_no}</td>
                        <td style={td}>{r.machine_name}</td>
                        <td style={{ ...td, whiteSpace: "nowrap",
                                     color: r.ip ? "#0f172a" : "#cbd5e1",
                                     fontWeight: r.ip ? 700 : 400 }}>
                          {r.ip || "— not set —"}
                        </td>
                        <td style={td}><Pill on={r.is_active} /></td>
                        {isAdmin && (
                          <td style={{ ...td, whiteSpace: "nowrap" }}>
                            <button className="mm-act" onClick={() => openEdit(r)}>✎ Edit</button>{" "}
                            <button className="mm-act"
                                    style={{ color: r.is_active ? "#b91c1c" : "#15803d" }}
                                    onClick={() => toggleActive(r)}>
                              {r.is_active ? "⊘ Disable" : "✓ Enable"}
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                    {!list.length && (
                      <tr><td colSpan={isAdmin ? 8 : 7}
                              style={{ ...td, textAlign: "center", color: "#94a3b8",
                                       padding: "26px 0", fontStyle: "italic" }}>
                        No machines match these filters.
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Add / Edit ─────────────────────────────────────────────── */}
      {form && (
        <div onClick={closeForm}
             style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.55)",
                      backdropFilter: "blur(2px)", zIndex: 9000, display: "flex",
                      alignItems: "flex-start", justifyContent: "center",
                      overflowY: "auto", padding: "40px 12px" }}>
          <div onClick={(e) => e.stopPropagation()}
               style={{ width: "100%", maxWidth: 620, background: "#fff", borderRadius: 12,
                        boxShadow: "0 20px 60px rgba(0,0,0,.35)", overflow: "hidden" }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid #e2e8f0",
                          display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 22,
                              fontWeight: 800, color: "#0f172a" }}>
                  {form.mode === "add" ? "Add Machine" : "Edit Machine"}
                </div>
                <div style={{ fontSize: 11, color: "#94a3b8" }}>
                  {form.mode === "add"
                    ? "Saved into the machine master — it appears in every dropdown right away"
                    : `Serial ${form.row.serial_no} · saved into the machine master`}
                </div>
              </div>
              <button className="mm-act" onClick={closeForm}>✕</button>
            </div>

            <div style={{ padding: "16px 20px", display: "grid",
                          gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <Field label="Zone">
                <input style={inp} value={draft.zone_name} list="mm-zones"
                       onChange={(e) => setD("zone_name", e.target.value)} />
                <datalist id="mm-zones">{zones.map(z => <option key={z} value={z} />)}</datalist>
              </Field>
              <Field label="Line">
                <input style={inp} value={draft.line_name} list="mm-lines"
                       onChange={(e) => setD("line_name", e.target.value)} />
                <datalist id="mm-lines">
                  {[...new Set(rows.map(r => r.line_name).filter(Boolean))].sort()
                    .map(l => <option key={l} value={l} />)}
                </datalist>
              </Field>
              <Field label="Machine No">
                <input style={inp} value={draft.machine_no}
                       onChange={(e) => setD("machine_no", e.target.value)} />
              </Field>
              <Field label="Machine Name">
                <input style={inp} value={draft.machine_name}
                       onChange={(e) => setD("machine_name", e.target.value)} />
              </Field>
              <Field label="IP Address" hint="Optional — leave blank if the machine has none">
                <input style={inp} value={draft.ip} placeholder="192.168.30.10"
                       onChange={(e) => setD("ip", e.target.value)} />
              </Field>
            </div>

            {/* Rename par saaf-saaf batao ki kitni history saath jayegi */}
            {renaming && (
              <div style={{ margin: "0 20px 14px", padding: "10px 14px", borderRadius: 10,
                            background: "#fffbeb", border: "1px solid #fde68a",
                            fontSize: 12, color: "#92400e", fontWeight: 600 }}>
                <b>Machine No is changing</b> — “{form.row.machine_no}” → “{draft.machine_no.trim()}”.
                {usage === null ? " Checking how much history is linked…" : (
                  usage.total
                    ? ` ${usage.total} existing records (breakdowns, PM, DMC, spares…) will be moved to the new number in the same save, so nothing is orphaned.`
                    : " No existing records are linked to this machine yet."
                )}
              </div>
            )}

            {err && (
              <div style={{ margin: "0 20px 14px", padding: "10px 14px", borderRadius: 10,
                            background: "#fee2e2", border: "1px solid #fecaca",
                            fontSize: 12, color: "#991b1b", fontWeight: 700 }}>{err}</div>
            )}

            <div style={{ padding: "12px 20px", borderTop: "1px solid #e2e8f0",
                          display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button className="mm-btn" onClick={closeForm}>Cancel</button>
              <button className="mm-btn primary" onClick={save} disabled={!canSave || saving}>
                {saving ? "Saving…" : form.mode === "add" ? "Add Machine" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
