/* ───────────────────────────────────────────────────────────────────
 * DeviationForm.jsx
 * ───────────────────────────────────────────────────────────────────
 * Modal used to RAISE a new Online Deviation (or VIEW an existing one).
 *
 * This file was reconstructed for the standalone Maintenance slice — the
 * original was dropped during extraction.  It is driven entirely by the
 * props the two callers pass:
 *
 *   <DeviationForm
 *      deviation={obj}                    // {} for blank, or seed / existing row
 *      token={token}                      // bearer token
 *      mode="raise" | "view"              // raise = editable, view = read-only
 *      onClose={() => ...}                // close without saving
 *      onSaved={() => ...}                // called after a successful save
 *   />
 *
 * Backend contract (Phase2/routers/quality.py):
 *   POST /api/quality/deviations          create  (Maintenance raises)
 *   PUT  /api/quality/deviations/{id}     edit    (only while PENDING_QA)
 *
 * Field names below mirror the DeviationCreate pydantic model 1:1.
 */
import { useEffect, useMemo, useState } from "react";
import { onlyProdZones } from "../constants/zones";

const API = "";

async function save(path, method, token, body) {
  const r = await fetch(API + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
  // create returns 201 with the row; edit may return 200/204
  try { return await r.json(); } catch { return null; }
}

// Field groups → mirror DeviationCreate.  [key, label, type]
const SECTIONS = [
  {
    title: "Location",
    fields: [
      /* Kram aur kism dono user ke kehne par badle:
         pehle Zone -> Line -> Machine No., phir Machine Name.
         Teeno MACHINE MASTER (`maintenance_machines`, `/api/machines/`) se
         aate hain -- jaise baaki poori app me aate hain -- taaki haath se
         likhne par naam/number aapas me na bigdein.
         Machine Name khud bhar jaata hai (master me machine no. ke saath
         1:1 juda hai), isliye wo likha nahi jaata. */
      ["zone_name",    "Zone",         "zone"],
      ["line_name",    "Line",         "line"],
      ["machine_no",   "Machine No.",  "mno"],
      ["machine_name", "Machine Name", "mname"],
      ["process_name", "Process",      "text"],
      ["process_no",   "Process No.",  "text"],
      ["category",     "Category",     "text"],
      ["srv_no",       "SRV No.",      "text"],
    ],
  },
  {
    title: "Deviation scope",
    fields: [
      ["deviation_qty",       "Deviation Qty",     "number"],
      ["deviation_upto_qty",  "Deviation Upto Qty","number"],
      ["deviation_upto_date", "Deviation Upto Date","date"],
      ["initiated_by",        "Initiated By",      "text"],
    ],
  },
  {
    title: "Details",
    fields: [
      ["reason",                  "Reason",                  "area"],
      ["requirement",             "Requirement / Spec",      "area"],
      ["observation",             "Observation",             "area"],
      ["root_cause_occurrence",   "Root Cause (Occurrence)", "area"],
      ["root_cause_detection",    "Root Cause (Detection)",  "area"],
      ["potential_consequences",  "Potential Consequences",  "area"],
    ],
  },
];

const lbl = {
  fontSize: 10, color: "#64748b", fontWeight: 700,
  letterSpacing: ".06em", textTransform: "uppercase", marginBottom: 4,
  display: "block",
};
const inp = {
  width: "100%", boxSizing: "border-box", padding: "8px 10px",
  border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 13,
  fontFamily: "inherit", background: "#fff", color: "#0f172a",
};

export default function DeviationForm({ deviation = {}, token, mode = "raise", onClose, onSaved }) {
  const readOnly = mode === "view";
  const [form, setForm] = useState(() => ({ ...deviation }));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  /* ── Machine master ─────────────────────────────────────────────
     Wahi ek jagah jahan se poori app ke zone/line/machine aate hain.
     View mode me lane ki zaroorat nahi -- wahan sab saada text hai. */
  const [master, setMaster] = useState([]);
  useEffect(() => {
    if (readOnly || !token) return;
    let ruk = false;
    fetch("/api/machines/", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : []))
      .then((m) => { if (!ruk) setMaster(Array.isArray(m) ? m : []); })
      .catch(() => {});
    return () => { ruk = true; };
  }, [readOnly, token]);

  const zoneOpts = useMemo(
    () => onlyProdZones([...new Set(master.map((m) => m.zone_name).filter(Boolean))]),
    [master]);
  const lineOpts = useMemo(
    () => (form.zone_name
      ? [...new Set(master.filter((m) => m.zone_name === form.zone_name)
                          .map((m) => m.line_name).filter(Boolean))].sort()
      : []), [master, form.zone_name]);
  const mnoOpts = useMemo(
    () => (form.zone_name && form.line_name
      ? [...new Set(master.filter((m) => m.zone_name === form.zone_name
                                      && m.line_name === form.line_name)
                          .map((m) => m.machine_no).filter(Boolean))].sort()
      : []), [master, form.zone_name, form.line_name]);

  /* Zone badla to line/machine dono bekaar ho gaye -- warna purani line
     nayi zone ke saath chipki reh jaati hai aur galat jodi ban jaati. */
  const setZone = (v) => setForm((f) => ({ ...f, zone_name: v, line_name: "",
                                           machine_no: "", machine_name: "" }));
  const setLine = (v) => setForm((f) => ({ ...f, line_name: v,
                                           machine_no: "", machine_name: "" }));
  /* Machine no. chunte hi naam KHUD bhar jaata hai (master me 1:1 hai). */
  const setMno = (v) => {
    const hit = master.find((m) => m.zone_name === form.zone_name
                                && m.line_name === form.line_name
                                && String(m.machine_no) === String(v));
    setForm((f) => ({ ...f, machine_no: v, machine_name: hit?.machine_name || "" }));
  };

  /* Purani deviation me jo value padi ho wo master me na mile to bhi list me
     dikhni chahiye -- warna kholte hi khaali dikhega aur lagega data ud gaya. */
  const withCur = (opts, cur) =>
    (cur && !opts.includes(cur)) ? [cur, ...opts] : opts;

  const submit = async () => {
    setErr("");
    setSaving(true);
    try {
      // Strip read-only/server-managed fields before sending.
      const { id, dev_no, status, created_at, updated_at, _new, ...rest } = form;
      // Coerce numeric fields (empty string → null).
      ["deviation_qty", "deviation_upto_qty", "line_id", "zone_id", "breakdown_id"].forEach((k) => {
        if (rest[k] === "" || rest[k] === undefined) rest[k] = null;
        else if (rest[k] != null) rest[k] = Number(rest[k]);
      });
      if (id) {
        await save(`/api/quality/deviations/${id}`, "PUT", token, rest);
      } else {
        await save("/api/quality/deviations", "POST", token, rest);
      }
      onSaved && onSaved();
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose && onClose(); }}
      style={{
        position: "fixed", inset: 0, background: "rgba(15,23,42,.45)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        zIndex: 9999, padding: "40px 16px", overflowY: "auto",
      }}
    >
      <div style={{
        background: "#f8fafc", borderRadius: 14, width: "min(820px, 100%)",
        boxShadow: "0 20px 60px rgba(0,0,0,.25)", overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 22px", background: "#0f172a", color: "#fff",
        }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, fontFamily: "'Barlow Condensed',sans-serif" }}>
              {readOnly ? "Deviation Details" : form.id ? "Edit Deviation" : "Raise Deviation"}
            </div>
            <div style={{ fontSize: 11, opacity: .7 }}>
              {form.dev_no ? `No. ${form.dev_no}` : "New online deviation"}
              {form.status ? ` · ${form.status}` : ""}
            </div>
          </div>
          <button onClick={onClose} style={{
            background: "transparent", border: "none", color: "#fff",
            fontSize: 22, cursor: "pointer", lineHeight: 1,
          }}>×</button>
        </div>

        {/* Body */}
        <div style={{ padding: 22, maxHeight: "70vh", overflowY: "auto" }}>
          {SECTIONS.map((sec) => (
            <div key={sec.title} style={{ marginBottom: 22 }}>
              <div style={{
                fontSize: 12, fontWeight: 800, color: "#0f172a",
                borderBottom: "2px solid #e2e8f0", paddingBottom: 6, marginBottom: 12,
              }}>
                {sec.title}
              </div>
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))",
                gap: 14,
              }}>
                {sec.fields.map(([k, label, type]) => (
                  <div key={k} style={type === "area" ? { gridColumn: "1 / -1" } : null}>
                    <label style={lbl}>{label}</label>
                    {/* View mode me sab saada text -- neeche wale select sirf
                        naya banate/badalte waqt aate hain. */}
                    {!readOnly && (type === "zone" || type === "line" || type === "mno") ? (
                      <select
                        value={form[k] ?? ""}
                        onChange={(e) => (type === "zone" ? setZone(e.target.value)
                                        : type === "line" ? setLine(e.target.value)
                                        : setMno(e.target.value))}
                        disabled={type === "line" ? !form.zone_name
                                : type === "mno" ? !form.line_name : false}
                        style={{ ...inp,
                                 background: (type === "line" && !form.zone_name)
                                          || (type === "mno" && !form.line_name)
                                   ? "#f1f5f9" : "#fff" }}>
                        <option value="">— select —</option>
                        {(type === "zone" ? withCur(zoneOpts, form.zone_name)
                        : type === "line" ? withCur(lineOpts, form.line_name)
                        : withCur(mnoOpts, form.machine_no)
                        ).map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : type === "mname" ? (
                      /* Machine no. ke saath KHUD bhar jaata hai -- haath se
                         likhne ki jagah nahi, warna naam aur number aapas me
                         alag ho jaate hain. */
                      <input
                        value={form[k] ?? ""} readOnly disabled
                        placeholder={readOnly ? "" : "Machine No. chunte hi aa jayega"}
                        style={{ ...inp, background: "#f1f5f9", color: "#334155" }}
                      />
                    ) : type === "area" ? (
                      <textarea
                        value={form[k] ?? ""} onChange={set(k)} disabled={readOnly}
                        rows={2} style={{ ...inp, resize: "vertical",
                          background: readOnly ? "#f1f5f9" : "#fff" }}
                      />
                    ) : (
                      <input
                        type={type} value={form[k] ?? ""} onChange={set(k)} disabled={readOnly}
                        style={{ ...inp, background: readOnly ? "#f1f5f9" : "#fff" }}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}

          {form.status === "REJECTED" && form.rejection_reason && (
            <div style={{
              background: "rgba(220,38,38,.08)", border: "1px solid rgba(220,38,38,.25)",
              borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#b91c1c",
            }}>
              <b>QA Rejection:</b> {form.rejection_reason}
            </div>
          )}

          {err && (
            <div style={{
              background: "rgba(220,38,38,.08)", border: "1px solid rgba(220,38,38,.25)",
              borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#b91c1c",
              marginTop: 6,
            }}>
              {err}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          display: "flex", justifyContent: "flex-end", gap: 10,
          padding: "14px 22px", background: "#fff", borderTop: "1px solid #e2e8f0",
        }}>
          <button onClick={onClose} disabled={saving} style={{
            padding: "9px 18px", borderRadius: 8, border: "1px solid #cbd5e1",
            background: "#fff", color: "#475569", fontWeight: 700, fontSize: 13,
            cursor: "pointer",
          }}>
            {readOnly ? "Close" : "Cancel"}
          </button>
          {!readOnly && (
            <button onClick={submit} disabled={saving} style={{
              padding: "9px 22px", borderRadius: 8, border: "none",
              background: saving ? "#94a3b8" : "#0f172a", color: "#fff",
              fontWeight: 700, fontSize: 13, cursor: saving ? "default" : "pointer",
            }}>
              {saving ? "Saving…" : form.id ? "Update" : "Submit Deviation"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
