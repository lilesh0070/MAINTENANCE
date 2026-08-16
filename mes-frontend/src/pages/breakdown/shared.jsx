/* ───────────────────────────────────────────────────────────────────
 * breakdown/shared.jsx
 * ───────────────────────────────────────────────────────────────────
 * Cross-cutting helpers & visual primitives shared by every Maintenance
 * (Breakdown) dashboard section: AndonTable, PmThisMonth, KpiPanel,
 * StatsSection and ClosureFormModal.  Keep only things used by 2+
 * sections here — section-specific code lives in that section's file.
 */

export const API = "";

// today as YYYY-MM-DD (the Pending Breakdown panel's date filter defaults here)
export function todayLocalISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/* ── Tiny fetch helpers ───────────────────────────────────────────── */
export const api = {
  async get(path, token) {
    const r = await fetch(API + path, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(await r.text() || `HTTP ${r.status}`);
    return r.json();
  },
  async post(path, body, token) {
    const r = await fetch(API + path, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
    return r.json();
  },
  async delete(path, token) {
    const r = await fetch(API + path, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
    return r.json();
  },
};

/* ── Visual primitives ────────────────────────────────────────────── */
export function Btn({ children, onClick, variant = "default", size = "md", disabled, style, title }) {
  const base = {
    border: "none", borderRadius: 8, cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: "inherit", fontWeight: 700, transition: "all .15s",
    opacity: disabled ? 0.55 : 1,
    fontSize: size === "sm" ? 11 : 13,
    padding: size === "sm" ? "5px 10px" : "9px 16px",
  };
  const variants = {
    default: { background: "#fff", color: "#1e40af", border: "1px solid #cbd5e1" },
    primary: { background: "linear-gradient(135deg,#1e40af,#2563eb)", color: "#fff", boxShadow: "0 2px 8px rgba(30,64,175,.25)" },
    danger:  { background: "linear-gradient(135deg,#dc2626,#b91c1c)", color: "#fff" },
    ghost:   { background: "transparent", color: "#475569", border: "1px solid #e2e8f0" },
    success: { background: "linear-gradient(135deg,#16a34a,#15803d)", color: "#fff" },
  };
  return (
    <button onClick={onClick} disabled={disabled} title={title}
            style={{ ...base, ...variants[variant], ...style }}>
      {children}
    </button>
  );
}

export function StatCard({ label, value, sub, color = "#1e40af" }) {
  return (
    <div style={{
      background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12,
      padding: "14px 18px",
      // Pehle `flex: 0 0 auto` + minWidth 140 tha — card apne CONTENT jitna
      // chaudा ho jaata tha aur sikudta hi nahi.  Jiska sub-text lamba (jaise
      // "Call open, no ack yet") wo card mota ho jaata, aur thodi si sankri
      // screen par chaaron ki chaudai jama ho kar jagah se zyada ho jaati —
      // isliye 3 + 1 me lipat jaate the.  (Dev machine ki screen chaudi thi
      // isliye wahan nahi dikhta tha, production par dikha.)
      //
      // Ab chaaron BARABAR jagah baant lete hain aur zaroorat par sikud jaate
      // hain.  `border-box` isliye ki basis me padding+border bhi gine jaayein
      // (content-box me 140 ka basis asal me 178px ban jaata tha, aur chaaron
      // ko 754px chahiye hote the — production ke column se zyada).
      // Ab: 4 x 130 + 3 x 14 gap = 562px — itni jagah me bhi ek line.
      // Isse neeche (asli mobile) hi 2x2 me jaate hain, jo theek hai.
      // `minWidth: 0` zaroori hai — warna flex item apne content se chhota
      // nahi ho sakta aur sikudna bekaar ho jaata.
      boxSizing: "border-box", flex: "1 1 130px", minWidth: 0,
      boxShadow: "0 1px 3px rgba(0,0,0,.04)",
    }}>
      <div style={{ fontSize: 10, color: "#64748b", fontWeight: 700,
                     letterSpacing: ".08em", textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800, color, marginTop: 2,
                     fontFamily: "'Barlow Condensed',sans-serif" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 1 }}>{sub}</div>}
    </div>
  );
}

/* ── Duration / time helpers ──────────────────────────────────────── */
export function fmtDuration(seconds) {
  // ANDON timer / breakdown duration — ab SECONDS bhi dikhte hain (minute-only nahi),
  // taaki live timer har second visibly tick kare.  Format:
  //   45s · 5m 03s · 1h 05m 03s   (seconds/minutes 2-digit padded, width stable).
  if (seconds == null) return "—";
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const p = (n) => String(n).padStart(2, "0");
  if (h > 0) return `${h}h ${p(m)}m ${p(sec)}s`;
  if (m > 0) return `${m}m ${p(sec)}s`;
  return `${sec}s`;
}

export function fmtClock(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch { return "—"; }
}

export function fmtDateTime(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-IN", {
      day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
    });
  } catch { return "—"; }
}
