/* admin/loginhistory.jsx — "Login History" tab (Maintenance Panel, User & Access ke aage).
   Do view:
     • Currently Logged In — abhi kaun-kaun active hai (latest login, token-window ke andar, logout nahi)
     • History — kisne kab login/logout kiya (filters FY/Month/Date/User, default current)
   Backend: GET /api/audit/logins (pairing) · GET /api/audit/active-logins (active). */
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../api/client";

const MON = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fyMonthsList(fy) {
  const y = parseInt(String(fy).split("-")[0], 10);
  if (isNaN(y)) return [];
  const out = [];
  for (let i = 0; i < 12; i++) {
    const mo = ((3 + i) % 12) + 1;
    const yr = mo >= 4 ? y : y + 1;
    out.push({ value: `${yr}-${String(mo).padStart(2, "0")}`, label: `${MON[mo]} ${yr}` });
  }
  return out;
}
const pad = (n) => String(n).padStart(2, "0");
const todayStr = () => { const n = new Date(); return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`; };
const curMonthStr = () => { const n = new Date(); return `${n.getFullYear()}-${pad(n.getMonth() + 1)}`; };
const fmtDT = (s) => {
  if (!s) return null;
  const d = new Date(s);
  if (isNaN(d.getTime())) return String(s);
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true });
};
const spanTxt = (ms) => {
  if (isNaN(ms) || ms < 0) return null;
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
};
const dur = (a, b) => (a && b ? spanTxt(new Date(b).getTime() - new Date(a).getTime()) : null);
const sinceNow = (a) => (a ? spanTxt(Date.now() - new Date(a).getTime()) : null);

export function LoginHistoryPage() {
  const { token } = useAuth();
  const [mode, setMode] = useState("active");            // "active" | "history"  (default: current logins)
  const [fy, setFy] = useState("");
  const [month, setMonth] = useState(curMonthStr());     // default current month
  const [date, setDate] = useState(todayStr());          // default current date
  const [uname, setUname] = useState("");
  const [rows, setRows] = useState([]);
  const [users, setUsers] = useState([]);
  const [years, setYears] = useState([]);
  const [active, setActive] = useState([]);
  const [loading, setLoading] = useState(false);

  // FY list + default current FY
  useEffect(() => {
    if (!token) return;
    api.get("/api/maintenance-kpi/financial-years", token).then((list) => {
      const arr = Array.isArray(list) ? list : [];
      setYears(arr);
      const cur = arr.find((v) => v.is_current) || arr[0];
      if (cur) setFy(cur.fy);
    }).catch(() => {});
  }, [token]);

  // History load (sirf history mode me)
  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    const qs = new URLSearchParams();
    for (const [k, v] of [["fy", fy], ["month", month], ["date", date], ["username", uname]]) if (v) qs.set(k, v);
    try {
      const d = await api.get(`/api/audit/logins?${qs.toString()}`, token);
      setRows(d?.rows || []); setUsers(d?.users || []);
    } catch { setRows([]); }
    setLoading(false);
  }, [token, fy, month, date, uname]);
  useEffect(() => { if (mode === "history") load(); }, [mode, load]);

  // Active load — mount pe (toggle ka count) + active mode me har 30s
  const loadActive = useCallback(async () => {
    if (!token) return;
    try { const d = await api.get("/api/audit/active-logins", token); setActive(d?.rows || []); } catch {}
  }, [token]);
  useEffect(() => {
    loadActive();
    if (mode !== "active") return;
    const id = setInterval(loadActive, 30000);
    return () => clearInterval(id);
  }, [mode, loadActive]);

  const sel = { padding: "7px 9px", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 13, background: "#fff", minWidth: 132, color: "#0f172a" };
  const lbl = { display: "flex", flexDirection: "column", gap: 4, fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: ".03em" };
  const th = { padding: "10px 14px", textAlign: "left", fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em", color: "#64748b", fontWeight: 700 };
  const td = { padding: "9px 14px" };
  const tabBtn = (on) => ({
    padding: "8px 16px", borderRadius: 9, border: "1px solid " + (on ? "#1d4ed8" : "#cbd5e1"),
    background: on ? "#1d4ed8" : "#fff", color: on ? "#fff" : "#475569",
    fontSize: 12.5, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 7,
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* View toggle */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button style={tabBtn(mode === "active")} onClick={() => setMode("active")}>
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: mode === "active" ? "#4ade80" : "#22c55e" }} />
          Currently Logged In ({active.length})
        </button>
        <button style={tabBtn(mode === "history")} onClick={() => setMode("history")}>🕑 History</button>
      </div>

      {mode === "active" ? (
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden" }}>
          <div style={{ padding: "12px 14px", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", gap: 8 }}>
            <b style={{ fontSize: 14, color: "#0f172a" }}>Abhi Logged-In IDs</b>
            <span style={{ fontSize: 11.5, color: "#94a3b8", fontWeight: 600 }}>· {active.length} active · har 30s refresh</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead><tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                <th style={{ ...th, width: 44 }}>#</th><th style={th}>User</th><th style={th}>Role</th>
                <th style={th}>Login</th><th style={th}>Since</th>
              </tr></thead>
              <tbody>
                {active.map((r, i) => (
                  <tr key={i} style={{ borderTop: "1px solid #f1f5f9" }}>
                    <td style={{ ...td, color: "#94a3b8" }}>{i + 1}</td>
                    <td style={{ ...td, fontWeight: 700, color: "#0f172a" }}>
                      <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "#22c55e", marginRight: 8, boxShadow: "0 0 0 3px rgba(34,197,94,.18)" }} />
                      {r.username}
                    </td>
                    <td style={{ ...td, color: "#64748b" }}>{r.role || "—"}</td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>{fmtDT(r.login_at) || "—"}</td>
                    <td style={{ ...td, color: "#16a34a", fontWeight: 600 }}>{sinceNow(r.login_at) || "—"}</td>
                  </tr>
                ))}
                {!active.length && <tr><td colSpan={5} style={{ padding: "22px 14px", color: "#94a3b8", textAlign: "center" }}>Abhi koi logged-in nahi.</td></tr>}
              </tbody>
            </table>
          </div>
          <div style={{ padding: "8px 14px", fontSize: 11, color: "#94a3b8", borderTop: "1px solid #f1f5f9" }}>
            JWT stateless — "active" = latest login jiska token abhi valid hai (12h) aur logout nahi hua. Bina logout ke browser band kiya to token expiry tak dikhta rahega.
          </div>
        </div>
      ) : (
        <>
          {/* Filters */}
          <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 16 }}>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
              <label style={lbl}>Financial Year
                <select style={sel} value={fy} onChange={(e) => { setFy(e.target.value); setMonth(""); }}>
                  <option value="">All</option>
                  {years.map((y) => <option key={y.fy} value={y.fy}>{y.label || y.fy}</option>)}
                </select></label>
              <label style={lbl}>Month
                <select style={sel} value={month} onChange={(e) => setMonth(e.target.value)}>
                  <option value="">All</option>
                  {fyMonthsList(fy).map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select></label>
              <label style={lbl}>Date
                <input type="date" style={sel} value={date} onChange={(e) => setDate(e.target.value)} /></label>
              <label style={lbl}>User
                <select style={sel} value={uname} onChange={(e) => setUname(e.target.value)}>
                  <option value="">All</option>
                  {users.map((u) => <option key={u} value={u}>{u}</option>)}
                </select></label>
              <button onClick={() => { setMonth(""); setDate(""); setUname(""); }}
                      style={{ padding: "8px 14px", border: "1px solid #cbd5e1", borderRadius: 8, background: "#f8fafc", fontSize: 12.5, fontWeight: 700, cursor: "pointer", color: "#475569" }}>Reset</button>
              <span style={{ marginLeft: "auto", fontSize: 12, color: "#94a3b8", fontWeight: 600 }}>{rows.length} session{rows.length === 1 ? "" : "s"}</span>
            </div>
          </div>
          {/* Table */}
          <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead><tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                  <th style={{ ...th, width: 44 }}>#</th><th style={th}>User</th><th style={th}>Role</th>
                  <th style={th}>Login</th><th style={th}>Logout</th><th style={th}>Duration</th>
                </tr></thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} style={{ borderTop: "1px solid #f1f5f9" }}>
                      <td style={{ ...td, color: "#94a3b8" }}>{i + 1}</td>
                      <td style={{ ...td, fontWeight: 700, color: "#0f172a" }}>{r.username}</td>
                      <td style={{ ...td, color: "#64748b" }}>{r.role || "—"}</td>
                      <td style={{ ...td, color: "#16a34a", fontWeight: 600, whiteSpace: "nowrap" }}>{fmtDT(r.login_at) || "—"}</td>
                      <td style={{ ...td, color: r.logout_at ? "#b45309" : "#94a3b8", fontWeight: 600, whiteSpace: "nowrap" }}>
                        {fmtDT(r.logout_at) || "— (logout nahi hua)"}
                      </td>
                      <td style={{ ...td, color: "#64748b" }}>{dur(r.login_at, r.logout_at) || "—"}</td>
                    </tr>
                  ))}
                  {!loading && !rows.length && <tr><td colSpan={6} style={{ padding: "22px 14px", color: "#94a3b8", textAlign: "center" }}>Is range me koi login record nahi.</td></tr>}
                  {loading && <tr><td colSpan={6} style={{ padding: "22px 14px", color: "#94a3b8", textAlign: "center" }}>Loading…</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default LoginHistoryPage;
