/* admin/ui.jsx — shared visual primitives for every Admin page
 * (headings, cards, buttons, form fields, modal, toast, excel importer).
 * Extracted from AdminPanel so each admin page file can import just these.
 */
import { useState, useEffect, useRef, useCallback } from "react";

function PageHeading({ title, sub }) {
  return (
    <div style={{ textAlign: "center", marginBottom: 36 }}>
      <h1 style={{
        fontFamily: "'Barlow Condensed',sans-serif",
        fontSize: 38, fontWeight: 800, color: "#0f172a", letterSpacing: "-.01em",
      }}>
        {title.split(" ").map((w, i, arr) =>
          i === arr.length - 1
            ? <span key={i} style={{ color: "#2563eb" }}>{w}</span>
            : <span key={i}>{w} </span>
        )}
      </h1>
      {sub && <p style={{ fontSize: 13, color: "#94a3b8", marginTop: 6 }}>{sub}</p>}
    </div>
  );
}

function Card({ children, style }) {
  return (
    <div style={{
      background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14,
      padding: 28, boxShadow: "0 1px 3px rgba(0,0,0,.05)", ...style,
    }}>
      {children}
    </div>
  );
}

function Pill({ label, color = "blue" }) {
  const colors = {
    green:  { bg: "rgba(22,163,74,.1)",   border: "rgba(22,163,74,.25)",   text: "#16a34a" },
    red:    { bg: "rgba(220,38,38,.1)",    border: "rgba(220,38,38,.25)",   text: "#dc2626" },
    blue:   { bg: "rgba(30,64,175,.1)",    border: "rgba(30,64,175,.2)",    text: "#1e40af" },
    amber:  { bg: "rgba(217,119,6,.1)",    border: "rgba(217,119,6,.25)",   text: "#d97706" },
    gray:   { bg: "#f1f5f9",               border: "#e2e8f0",               text: "#64748b" },
  };
  const c = colors[color] || colors.blue;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "3px 10px", borderRadius: 99,
      background: c.bg, border: `1px solid ${c.border}`,
      fontSize: 11, fontWeight: 600, color: c.text,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: c.text }} />
      {label}
    </span>
  );
}

function Btn({ children, onClick, variant = "ghost", size = "md", disabled = false, style: s }) {
  const [h, setH] = useState(false);
  const pad = size === "sm" ? "5px 12px" : "9px 18px";
  const fs  = size === "sm" ? 11 : 13;
  const styles = {
    primary: { background: h ? "#1d3fa8" : "linear-gradient(135deg,#1e40af,#2563eb)", color: "#fff", border: "none", boxShadow: "0 2px 8px rgba(30,64,175,.3)" },
    danger:  { background: h ? "rgba(220,38,38,.12)" : "rgba(220,38,38,.06)", color: "#dc2626", border: "1px solid rgba(220,38,38,.3)" },
    success: { background: h ? "rgba(22,163,74,.12)"  : "rgba(22,163,74,.06)",  color: "#16a34a", border: "1px solid rgba(22,163,74,.3)"  },
    ghost:   { background: h ? "#f1f5f9" : "#f8fafc", color: h ? "#0f172a" : "#334155", border: `1px solid ${h ? "#3b82f6" : "#e2e8f0"}` },
  };
  return (
    <button
      onClick={onClick} disabled={disabled}
      data-variant={variant}
      onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: pad, borderRadius: 8, cursor: disabled ? "not-allowed" : "pointer",
        fontSize: fs, fontWeight: 600, fontFamily: "'Barlow',sans-serif",
        transition: "all .12s", opacity: disabled ? .55 : 1,
        ...styles[variant], ...s,
      }}
    >{children}</button>
  );
}

function FF({ label, children, hint }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
      <label style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "#64748b" }}>{label}</label>
      {children}
      {hint && <span style={{ fontSize: 10, color: "#94a3b8" }}>{hint}</span>}
    </div>
  );
}

export const inputStyle = {
  background: "#f8fafc", border: "1.5px solid #e2e8f0", borderRadius: 8,
  padding: "10px 12px", color: "#0f172a", fontFamily: "'Barlow',sans-serif",
  fontSize: 13, outline: "none", width: "100%", boxSizing: "border-box",
  transition: "border-color .15s, box-shadow .15s",
};

function Input({ ...props }) {
  const [f, setF] = useState(false);
  return (
    <input
      {...props}
      onFocus={() => setF(true)} onBlur={() => setF(false)}
      style={{ ...inputStyle, borderColor: f ? "#3b82f6" : "#e2e8f0", boxShadow: f ? "0 0 0 3px rgba(59,130,246,.1)" : "none", ...props.style }}
    />
  );
}

function Select({ children, ...props }) {
  const [f, setF] = useState(false);
  return (
    <select
      {...props}
      onFocus={() => setF(true)} onBlur={() => setF(false)}
      style={{ ...inputStyle, appearance: "none", borderColor: f ? "#3b82f6" : "#e2e8f0", boxShadow: f ? "0 0 0 3px rgba(59,130,246,.1)" : "none", ...props.style }}
    >{children}</select>
  );
}

function Modal({ open, onClose, title, children, wide }) {
  useEffect(() => {
    const h = e => { if (e.key === "Escape") onClose(); };
    if (open) document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div onClick={e => e.target === e.currentTarget && onClose()}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", backdropFilter: "blur(4px)", zIndex: 500, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "48px 16px", overflowY: "auto" }}>
      <div style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: wide ? 860 : 560, boxShadow: "0 24px 80px rgba(0,0,0,.2)", animation: "slideUp .22s cubic-bezier(.16,1,.3,1)", marginBottom: 40, overflow: "hidden" }}>
        <div style={{ padding: "18px 24px", background: "linear-gradient(135deg,#1e40af,#2563eb)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: "#fff", textTransform: "capitalize" }}>{title}</div>
          <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: 7, background: "rgba(255,255,255,.15)", border: "1px solid rgba(255,255,255,.25)", color: "#fff", cursor: "pointer", fontSize: 15, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
        </div>
        <div style={{ padding: 24 }}>{children}</div>
      </div>
      <style>{`
        @keyframes slideUp   { from { transform:translateY(18px);opacity:0 } to { transform:none;opacity:1 } }
        @keyframes slideDown { from { transform:translateY(-18px);opacity:0 } to { transform:none;opacity:1 } }
      `}</style>
    </div>
  );
}

function ModalActions({ children }) {
  return <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 24, paddingTop: 20, borderTop: "1px solid #f1f5f9" }}>{children}</div>;
}

function Toast({ msg, type, onDone }) {
  useEffect(() => { const t = setTimeout(onDone, 3000); return () => clearTimeout(t); }, []);
  const colors = { ok: "#16a34a", err: "#dc2626", info: "#1e40af" };
  return (
    <div style={{
      // Moved to top-right so it no longer overlaps with the floating AI
      // Assistant button in the bottom-right corner.
      position: "fixed", top: 24, right: 24, zIndex: 10001,
      padding: "12px 18px", borderRadius: 9, fontSize: 13, fontWeight: 500,
      background: "#fff", borderLeft: `4px solid ${colors[type] || colors.info}`,
      boxShadow: "0 8px 30px rgba(0,0,0,.15)", color: colors[type] || colors.info,
      animation: "slideDown .2s ease", maxWidth: 340,
    }}>{msg}</div>
  );
}

export function useToast() {
  const [toast, setToast] = useState(null);
  // useCallback ZAROORI hai: pages `toast` ko useCallback/useEffect ki deps me
  // rakhte hain.  Agar ye har render par naya function bane, to ek failed load
  // -> toast -> parent re-render -> naya toast fn -> load dobara -> phir fail...
  // yani anant loop (page hamesha ghoomta rehta, request bhi bar-bar jaati).
  const show = useCallback((msg, type = "ok") => setToast({ msg, type }), []);
  const el = toast ? <Toast msg={toast.msg} type={toast.type} onDone={() => setToast(null)} /> : null;
  return [show, el];
}

function EmptyState({ icon = "⬡", text, sub }) {
  return (
    <div style={{ textAlign: "center", padding: "60px 40px", color: "#94a3b8" }}>
      <div style={{ fontSize: 44, opacity: .25, marginBottom: 14 }}>{icon}</div>
      <div style={{ fontSize: 15, fontWeight: 600, color: "#64748b" }}>{text}</div>
      {sub && <div style={{ fontSize: 13, marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

function Spinner() {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 60 }}>
      <div style={{ width: 32, height: 32, borderRadius: "50%", border: "3px solid #e2e8f0", borderTopColor: "#1e40af", animation: "spin .6s linear infinite" }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

// ─── EXCEL IMPORT BUTTON ──────────────────────────────────────
function ExcelImportButton({ label, templateUrl, importFn, requiredCols, token }) {
  const [file,    setFile]    = useState(null);
  const [parsed,  setParsed]  = useState(null);
  const [open,    setOpen]    = useState(false);
  const [loading, setLoading] = useState(false);
  const fileRef = useRef(null);

  const loadSheetJS = () => new Promise((res, rej) => {
    if (window.XLSX) return res();
    const s = document.createElement("script");
    s.src = "/xlsx.full.min.js";  // local copy for air-gapped LAN
    s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });

  const parse = async (f) => {
    try {
      await loadSheetJS();
      const buf = await f.arrayBuffer();
      const wb  = window.XLSX.read(buf, { type: "array" });
      const ws  = wb.Sheets[wb.SheetNames[0]];
      const raw = window.XLSX.utils.sheet_to_json(ws, { header: 1 });
      // Find header row
      let hi = 0;
      for (let i = 0; i < Math.min(raw.length, 5); i++) {
        if (requiredCols.some(c => raw[i]?.includes(c))) { hi = i; break; }
      }
      const headers = raw[hi].map(h => String(h || "").trim());
      const rows = raw.slice(hi + 1)
        .filter(r => r.some(v => v !== null && v !== undefined && v !== ""))
        .map(r => { const o = {}; headers.forEach((h, i) => o[h] = r[i] ?? ""); return o; });
      setFile(f); setParsed({ headers, rows }); setOpen(true);
    } catch (e) {
      alert("Failed to parse file: " + e.message);
    }
  };

  const doImport = async () => {
    if (!parsed) return;
    setLoading(true);
    try {
      await importFn(parsed.rows);
      setOpen(false); setFile(null); setParsed(null);
    } catch(e) {
      alert("Import failed: " + e.message);
    } finally { setLoading(false); }
  };

  const downloadTemplate = async () => {
    try {
      const res = await fetch(templateUrl, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error("Failed to download template");
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = templateUrl.split("/").pop() + ".xlsx";
      a.click();
      URL.revokeObjectURL(a.href);
    } catch(e) { alert(e.message); }
  };

  return (
    <>
      <div style={{ display: "flex", gap: 8 }}>
        <Btn size="sm" onClick={downloadTemplate}>⬇ Template</Btn>
        <Btn size="sm" variant="primary" onClick={() => fileRef.current?.click()}>📥 {label}</Btn>
        <input
          ref={fileRef} type="file" accept=".xlsx,.csv"
          style={{ display: "none" }}
          onChange={e => { const f = e.target.files[0]; if (f) parse(f); e.target.value = ""; }}
        />
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={`Preview — ${parsed?.rows?.length || 0} rows to import`} wide>
        <p style={{ fontSize: 12, color: "#64748b", marginBottom: 16 }}>
          Review the data below before importing. This will add or update records in the database.
        </p>
        <div style={{ overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden", marginBottom: 16, maxHeight: 320, overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr>
                {parsed?.headers?.map(h => (
                  <th key={h} style={{ padding: "8px 12px", background: "#1e40af", color: "#fff", fontWeight: 700, fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {parsed?.rows?.slice(0, 10).map((r, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? "#fff" : "#f8fafc", borderBottom: "1px solid #f1f5f9" }}>
                  {parsed.headers.map(h => (
                    <td key={h} style={{ padding: "8px 12px", color: "#334155", fontFamily: "monospace", fontSize: 11 }}>{String(r[h] ?? "")}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {parsed?.rows?.length > 10 && (
          <p style={{ fontSize: 11, color: "#94a3b8", marginBottom: 16 }}>
            Showing 10 of {parsed.rows.length} rows — all {parsed.rows.length} will be imported
          </p>
        )}
        <ModalActions>
          <Btn onClick={() => setOpen(false)}>Cancel</Btn>
          <Btn variant="primary" onClick={doImport} disabled={loading}>
            {loading
              ? <><div style={{ width: 14, height: 14, borderRadius: "50%", border: "2px solid rgba(255,255,255,.3)", borderTopColor: "#fff", animation: "spin .6s linear infinite" }} /> Importing…</>
              : `⬆ Import ${parsed?.rows?.length || 0} Records →`
            }
          </Btn>
        </ModalActions>
      </Modal>
    </>
  );
}

// ─── PLANTS PAGE ──────────────────────────────────────────────

export {
  PageHeading, Card, Pill, Btn, FF, Input, Select,
  Modal, ModalActions, Toast, EmptyState, Spinner, ExcelImportButton,
};
