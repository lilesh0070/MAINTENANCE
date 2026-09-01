/* admin/deletehistory.jsx — "Delete History" tab (Maintenance Panel).
 *
 * Yahan wo saara kaam dikhta hai jo audit-log me darj hota hai — sabse pehle
 * DELETE, kyunki mitayi hui cheez wapas nahi aati aur baad me sirf yahi record
 * bachta hai ki kisne kab kya hataya.
 *
 * Pehle ye kahin dikhta hi nahi tha: darj `maintenance_audit_log` me hota tha,
 * backend ka `/api/audit` bhi maujood tha, par koi page use bulata hi nahi tha —
 * dekhne ka ek hi raasta tha, seedha database.
 *
 * Backend: GET /api/audit  (date_from · date_to · action | actions · username · q · limit · offset)
 *          GET /api/audit/actions   — kaunse kaam darj hue hain
 *          GET /api/audit/users     — kaun-kaun users hain
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../api/client";

const pad = (n) => String(n).padStart(2, "0");
const dstr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => dstr(new Date());
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return dstr(d); };

const fmtDT = (s) => {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d.getTime())) return String(s);
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric",
                                     hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true });
};

// Har action ka apna rang + seedha-sada naam.  Jo yahan na ho wo apne raw naam
// se dikhega — nayi action jodne par page apne aap use dikha dega, khali nahi.
const LOOK = {
  ANDON_HISTORY_DELETE: { c: "#b91c1c", bg: "#fee2e2", t: "ANDON call hatai" },
  AUTO_SLIP_DELETE:     { c: "#b91c1c", bg: "#fee2e2", t: "Auto slip hatai" },
  SLIP_DELETE:          { c: "#b91c1c", bg: "#fee2e2", t: "Slip hatai" },
  POINT_DELETE:         { c: "#b91c1c", bg: "#fee2e2", t: "Check point hataya" },
  PM_REV_STEPDOWN:      { c: "#b45309", bg: "#fef3c7", t: "PM rev hatai" },
  DMC_REV_STEPDOWN:     { c: "#b45309", bg: "#fef3c7", t: "DMC rev hatai" },
  PM_REV_EDIT:          { c: "#b45309", bg: "#fef3c7", t: "PM rev badli" },
  DMC_REV_EDIT:         { c: "#b45309", bg: "#fef3c7", t: "DMC rev badli" },
  PM_REV_RENUMBER:      { c: "#b45309", bg: "#fef3c7", t: "PM rev number badle" },
  DMC_REV_RENUMBER:     { c: "#b45309", bg: "#fef3c7", t: "DMC rev number badle" },
  AUTH_LOGIN:           { c: "#15803d", bg: "#dcfce7", t: "Login" },
  AUTH_LOGOUT:          { c: "#475569", bg: "#f1f5f9", t: "Logout" },
};
const look = (a) => LOOK[a] || { c: "#334155", bg: "#e2e8f0", t: a };
const isDelete = (a) => /DELETE|STEPDOWN/.test(String(a || ""));

const PAGE = 50;

export function DeleteHistoryPage() {
  const { token } = useAuth();

  const [allActions, setAllActions] = useState([]);
  const [users, setUsers] = useState([]);
  // Default: pichhle 30 din ke SAARE delete — page ka naam yahi kehta hai.
  const [mode, setMode]   = useState("delete");     // delete | all | <ek action>
  const [from, setFrom]   = useState(daysAgo(30));
  const [to, setTo]       = useState(today());
  const [uname, setUname] = useState("");
  const [q, setQ]         = useState("");
  const [qLive, setQLive] = useState("");           // typing ke dauraan
  const [page, setPage]   = useState(0);

  const [rows, setRows]   = useState([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy]   = useState(false);
  const [err, setErr]     = useState("");

  useEffect(() => {
    if (!token) return;
    api.get("/api/audit/actions", token).then((a) => setAllActions(Array.isArray(a) ? a : [])).catch(() => setAllActions([]));
    api.get("/api/audit/users", token).then((u) => setUsers(Array.isArray(u) ? u : [])).catch(() => setUsers([]));
  }, [token]);

  // search box par har akshar ki request nahi — thoda ruk kar
  useEffect(() => { const t = setTimeout(() => { setQ(qLive); setPage(0); }, 350); return () => clearTimeout(t); }, [qLive]);

  const deleteActions = useMemo(() => allActions.filter(isDelete), [allActions]);

  const load = useCallback(async () => {
    if (!token) return;
    setBusy(true); setErr("");
    try {
      const p = new URLSearchParams({ limit: String(PAGE), offset: String(page * PAGE) });
      if (from)  p.set("date_from", from);
      if (to)    p.set("date_to", to);
      if (uname) p.set("username", uname);
      if (q)     p.set("q", q);
      if (mode === "delete") { if (deleteActions.length) p.set("actions", deleteActions.join(",")); }
      else if (mode !== "all") p.set("action", mode);
      const d = await api.get(`/api/audit?${p.toString()}`, token);
      setRows(Array.isArray(d?.logs) ? d.logs : []);
      setTotal(Number(d?.total) || 0);
    } catch (e) {
      setErr(String(e?.message || e)); setRows([]); setTotal(0);
    } finally { setBusy(false); }
  }, [token, page, from, to, uname, q, mode, deleteActions]);

  useEffect(() => { load(); }, [load]);

  // "delete" mode tab tak ruke jab tak action list na aa jaye — warna bina
  // `actions` ke SAB kuch aa jaata hai aur delete-page par login bhi dikh jaate.
  const waiting = mode === "delete" && !allActions.length;

  const pages = Math.max(1, Math.ceil(total / PAGE));
  const reset = () => { setMode("delete"); setFrom(daysAgo(30)); setTo(today()); setUname(""); setQLive(""); setQ(""); setPage(0); };

  const card = { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 16 };
  const lbl  = { fontSize: 10.5, fontWeight: 800, color: "#64748b", marginBottom: 4, textTransform: "uppercase", letterSpacing: ".04em" };
  const sel  = { padding: "8px 10px", borderRadius: 8, border: "1px solid #cbd5e1", fontSize: 13, fontWeight: 600, background: "#fff", fontFamily: "inherit" };
  const th   = { padding: "10px 14px", textAlign: "left", fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em", color: "#64748b", fontWeight: 700, whiteSpace: "nowrap" };
  const td   = { padding: "9px 14px", fontSize: 12.5, color: "#334155", verticalAlign: "top" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

      {/* ── filter bar ── */}
      <div style={{ ...card, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div>
          <div style={lbl}>Kya dekhna hai</div>
          <select style={{ ...sel, minWidth: 210 }} value={mode}
                  onChange={(e) => { setMode(e.target.value); setPage(0); }}>
            <option value="delete">Sirf DELETE / hatane wale</option>
            <option value="all">Sab kuch</option>
            {allActions.map((a) => <option key={a} value={a}>{look(a).t} ({a})</option>)}
          </select>
        </div>
        <div>
          <div style={lbl}>Kis din se</div>
          <input type="date" style={sel} value={from} onChange={(e) => { setFrom(e.target.value); setPage(0); }} />
        </div>
        <div>
          <div style={lbl}>Kis din tak</div>
          <input type="date" style={sel} value={to} onChange={(e) => { setTo(e.target.value); setPage(0); }} />
        </div>
        <div>
          <div style={lbl}>Kisne kiya</div>
          <select style={{ ...sel, minWidth: 140 }} value={uname}
                  onChange={(e) => { setUname(e.target.value); setPage(0); }}>
            <option value="">Sab log</option>
            {users.map((u) => <option key={u.username} value={u.username}>{u.username}</option>)}
          </select>
        </div>
        <div style={{ flex: "1 1 220px" }}>
          <div style={lbl}>Dhoondho (machine, slip no, kuch bhi)</div>
          <input style={{ ...sel, width: "100%", fontWeight: 500 }} value={qLive}
                 placeholder="jaise  YHB_SS_05  ya  Maintenance"
                 onChange={(e) => setQLive(e.target.value)} />
        </div>
        <button onClick={reset}
                style={{ padding: "9px 16px", borderRadius: 8, border: "1px solid #cbd5e1",
                         background: "#fff", color: "#475569", fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>
          Filter hatao
        </button>
      </div>

      {/* ── ginti ── */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ ...card, padding: "10px 16px", display: "flex", alignItems: "baseline", gap: 8 }}>
          <b style={{ fontSize: 22, color: "#0f172a" }}>{total}</b>
          <span style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>
            {mode === "delete" ? "delete/hatane wale kaam" : mode === "all" ? "kul entry" : "entry"} — is filter me
          </span>
        </div>
        {busy && <span style={{ fontSize: 12, color: "#64748b" }}>load ho raha hai…</span>}
        {err && <span style={{ fontSize: 12, color: "#b91c1c", fontWeight: 700 }}>{err}</span>}
      </div>

      {/* ── table ── */}
      <div style={{ ...card, padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 820 }}>
          <thead style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
            <tr>
              <th style={th}>Kab</th>
              <th style={th}>Kya hua</th>
              <th style={th}>Kisne</th>
              <th style={th}>Byora</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const L = look(r.action);
              return (
                <tr key={r.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <td style={{ ...td, whiteSpace: "nowrap", color: "#0f172a", fontWeight: 600 }}>{fmtDT(r.created_at)}</td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 99,
                                   background: L.bg, color: L.c, fontSize: 11.5, fontWeight: 800 }}>{L.t}</span>
                    <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 3, fontFamily: "monospace" }}>{r.action}</div>
                  </td>
                  <td style={{ ...td, whiteSpace: "nowrap", fontWeight: 700 }}>{r.username || "—"}</td>
                  <td style={td}>{r.details || <span style={{ color: "#94a3b8" }}>—</span>}</td>
                </tr>
              );
            })}
            {!rows.length && !busy && (
              <tr><td colSpan={4} style={{ padding: "26px 14px", textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
                {waiting ? "load ho raha hai…" : "Is filter me kuch nahi mila."}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── page badlo ── */}
      {pages > 1 && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "center" }}>
          <button disabled={page === 0 || busy} onClick={() => setPage((p) => Math.max(0, p - 1))}
                  style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid #cbd5e1",
                           background: "#fff", color: page === 0 ? "#cbd5e1" : "#475569",
                           fontWeight: 700, fontSize: 12.5, cursor: page === 0 ? "not-allowed" : "pointer" }}>← Pichhla</button>
          <span style={{ fontSize: 12.5, color: "#64748b", fontWeight: 600 }}>Page {page + 1} / {pages}</span>
          <button disabled={page + 1 >= pages || busy} onClick={() => setPage((p) => p + 1)}
                  style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid #cbd5e1",
                           background: "#fff", color: page + 1 >= pages ? "#cbd5e1" : "#475569",
                           fontWeight: 700, fontSize: 12.5, cursor: page + 1 >= pages ? "not-allowed" : "pointer" }}>Agla →</button>
        </div>
      )}

      <div style={{ fontSize: 11.5, color: "#94a3b8", lineHeight: 1.6 }}>
        Ye record apne aap banta hai aur ise yahan se mitaya nahi ja sakta — mitayi hui cheez
        wapas nahi aati, isliye "kisne kab kya hataya" ka nishaan bacha rehna zaroori hai.
      </div>
    </div>
  );
}
