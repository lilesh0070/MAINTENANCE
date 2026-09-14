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
 * Backend: GET  /api/audit  (date_from · date_to · action | actions · username · q · limit · offset)
 *          GET  /api/audit/actions  — kaunse kaam darj hue hain
 *          GET  /api/audit/users    — kaun-kaun users hain
 *          DEL  /api/audit          — poori tareekh ki range saaf karo (admin)
 *          POST /api/audit/delete   — tick ki hui qatarein hatao (admin)
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
  ANDON_HISTORY_DELETE: { c: "#b91c1c", bg: "#fee2e2", t: "ANDON call deleted" },
  AUTO_SLIP_DELETE:     { c: "#b91c1c", bg: "#fee2e2", t: "Auto slip deleted" },
  SLIP_DELETE:          { c: "#b91c1c", bg: "#fee2e2", t: "Slip deleted" },
  POINT_DELETE:         { c: "#b91c1c", bg: "#fee2e2", t: "Check point deleted" },
  PM_REV_STEPDOWN:      { c: "#b45309", bg: "#fef3c7", t: "PM revision removed" },
  DMC_REV_STEPDOWN:     { c: "#b45309", bg: "#fef3c7", t: "DMC revision removed" },
  PM_REV_EDIT:          { c: "#b45309", bg: "#fef3c7", t: "PM revision edited" },
  DMC_REV_EDIT:         { c: "#b45309", bg: "#fef3c7", t: "DMC revision edited" },
  PM_REV_RENUMBER:      { c: "#b45309", bg: "#fef3c7", t: "PM revisions renumbered" },
  DMC_REV_RENUMBER:     { c: "#b45309", bg: "#fef3c7", t: "DMC revisions renumbered" },
  AUTH_LOGIN:           { c: "#15803d", bg: "#dcfce7", t: "Login" },
  AUTH_LOGOUT:          { c: "#475569", bg: "#f1f5f9", t: "Logout" },
  AUDIT_CLEAR:          { c: "#6d28d9", bg: "#ede9fe", t: "History cleared" },
};
const look = (a) => LOOK[a] || { c: "#334155", bg: "#e2e8f0", t: a };

// Wo pankti jo safai ke baad peechhe chhodi jaati hai.  Ye kabhi nahi
// hatti -- na range se, na tick karke (backend bhi rokta hai).
const CLEAR_ACTION = "AUDIT_CLEAR";

// `AUDIT_CLEAR` bhi isi list me hai -- warna default "Deletions only" me
// nishaan CHHUP JAATA, aur safai ke baad page bilkul khaali dikhta jaise
// kuch hua hi na ho.  Nishaan ka poora matlab hi dikhte rehne me hai.
const isDelete = (a) => /DELETE|STEPDOWN|AUDIT_CLEAR/.test(String(a || ""));

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

  /* ── Purani qatarein hatane ka intezaam ─────────────────────────
     Default 6 mahine se 3 mahine purana -- jaan-boojh kar AAJ tak nahi.
     Safai purane record ki hoti hai; abhi-abhi hua kaam mitana hi nahi
     chahiye, aur default me "aaj" rakhne se ek galat tap me wo bhi chala
     jaata. */
  const [safai, setSafai]       = useState(false);
  const [sFrom, setSFrom]       = useState(daysAgo(180));
  const [sTo,   setSTo]         = useState(daysAgo(90));
  const [sBusy, setSBusy]       = useState(false);
  const [sKehna, setSKehna]     = useState("");

  /* ── Tick karke hatana ────────────────────────────────────────────
     User ne maanga: "select karke bhi delete kar sake."
     Range wali safai se ek farak hai -- ismein koi APNA HI ek khaas
     record chun kar hata sakta hai aur baaki sab waisa dikhta rahega.
     Isliye backend nishaan me sirf ginti nahi, HAR HATAYI GAYI QATAR ka
     byora likhta hai (#id, kaam, kab, kisne).  Chun-kar hatana chhupta
     nahi. */
  const [chune, setChune]   = useState(() => new Set());
  const [cBusy, setCBusy]   = useState(false);
  const [cKehna, setCKehna] = useState("");

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
      // Nayi list aayi -- purana chunaav saaf.  Warna doosre page/filter ki
      // wo id chuni rehti jo ab dikh bhi nahi rahi, aur "Delete selected"
      // chup-chaap kuch aur hata deta.
      setChune(new Set());
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
  // AUDIT_CLEAR ki pankti chuni hi nahi ja sakti -- wo nishaan hai.
  const chunneYogya = useMemo(() => rows.filter((r) => r.action !== CLEAR_ACTION), [rows]);
  const sabChune = !!chunneYogya.length && chunneYogya.every((r) => chune.has(r.id));

  const palto = (id) => setChune((purana) => {
    const naya = new Set(purana);
    if (naya.has(id)) naya.delete(id); else naya.add(id);
    return naya;
  });

  const mitaoChune = async () => {
    const ids = [...chune];
    if (!ids.length) return;
    const ok = window.confirm(
      `Permanently remove ${ids.length} selected ${ids.length === 1 ? "entry" : "entries"}?\n\n` +
      "This cannot be undone. One line will stay behind listing exactly what was removed.");
    if (!ok) return;
    setCBusy(true); setCKehna("");
    try {
      const r = await api.post("/api/audit/delete", { ids }, token);
      setCKehna(`${r?.deleted ?? 0} removed.`);
      load();
    } catch (e) {
      setCKehna(String(e?.message || e).slice(0, 140));
    } finally { setCBusy(false); }
  };

  /* Mitane se pehle GINTI dikhate hain -- "kitni jaayengi" jaane bina
     haan kehna theek nahi, aur ye wapas nahi aata. */
  const safaiKaro = async () => {
    setSKehna("");
    if (sTo < sFrom) { setSKehna("\u201cTo\u201d date cannot be before \u201cFrom\u201d."); return; }
    setSBusy(true);
    try {
      const q = new URLSearchParams({ date_from: sFrom, date_to: sTo, limit: "1" });
      const peek = await api.get(`/api/audit?${q.toString()}`, token);
      const kitni = peek?.total ?? 0;
      if (!kitni) { setSKehna("Nothing to clear in that range."); setSBusy(false); return; }
      const ok = window.confirm(
        `Permanently remove ${kitni} ${kitni === 1 ? "entry" : "entries"} ` +
        `from ${sFrom} to ${sTo}?\n\n` +
        "This cannot be undone. One line will stay behind recording that you cleared them.");
      if (!ok) { setSBusy(false); return; }
      const r = await api.delete(`/api/audit?date_from=${sFrom}&date_to=${sTo}`, token);
      setSKehna(`${r?.deleted ?? 0} removed.`);
      setPage(0);
      load();
    } catch (e) {
      setSKehna(String(e?.message || e).slice(0, 140));
    } finally { setSBusy(false); }
  };


  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

      {/* ── filter bar ── */}
      <div style={{ ...card, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div>
          <div style={lbl}>Show</div>
          <select style={{ ...sel, minWidth: 210 }} value={mode}
                  onChange={(e) => { setMode(e.target.value); setPage(0); }}>
            <option value="delete">Deletions only</option>
            <option value="all">Everything</option>
            {allActions.map((a) => <option key={a} value={a}>{look(a).t} ({a})</option>)}
          </select>
        </div>
        <div>
          <div style={lbl}>From date</div>
          <input type="date" style={sel} value={from} onChange={(e) => { setFrom(e.target.value); setPage(0); }} />
        </div>
        <div>
          <div style={lbl}>To date</div>
          <input type="date" style={sel} value={to} onChange={(e) => { setTo(e.target.value); setPage(0); }} />
        </div>
        <div>
          <div style={lbl}>Done by</div>
          <select style={{ ...sel, minWidth: 140 }} value={uname}
                  onChange={(e) => { setUname(e.target.value); setPage(0); }}>
            <option value="">All users</option>
            {users.map((u) => <option key={u.username} value={u.username}>{u.username}</option>)}
          </select>
        </div>
        <div style={{ flex: "1 1 220px" }}>
          <div style={lbl}>Search (machine, slip no, anything)</div>
          <input style={{ ...sel, width: "100%", fontWeight: 500 }} value={qLive}
                 placeholder="e.g.  YHB_SS_05  or  Maintenance"
                 onChange={(e) => setQLive(e.target.value)} />
        </div>
        <button onClick={reset}
                style={{ padding: "9px 16px", borderRadius: 8, border: "1px solid #cbd5e1",
                         background: "#fff", color: "#475569", fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>
          Reset filters
        </button>
        <button onClick={() => { setSafai((v) => !v); setSKehna(""); }}
                style={{ padding: "9px 16px", borderRadius: 8, border: "1px solid #fecaca",
                         background: "#fff", color: "#b91c1c", fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>
          {safai ? "Close" : "\u{1F9F9} Clear old entries"}
        </button>
      </div>

      {/* ── purani qatarein hatao ───────────────────────────────────
          Ek saath bahut si purani qatarein hatane ka raasta.  Tick karke
          hatana alag hai (neeche table me) -- wo thodi-si chuni hui ke liye.
          Dono me EK PANKTI ruk jaati hai aur wo khud kabhi nahi mitti:
            • range se    → kisne, kaunsi range, kitni qatarein
            • tick karke  → kisne, aur POORI SOOCHI kya-kya hataya
          Tick wale me soochi isliye, kyunki wahan cherry-pick mumkin hai. */}
      {safai && (
        <div style={{ ...card, padding: 16, borderColor: "#fecaca", background: "#fffbfb" }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#b91c1c", marginBottom: 4 }}>
            Clear old entries
          </div>
          <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.55, marginBottom: 12 }}>
            This is the audit trail — once an entry is gone there is no other record
            of what was deleted. Only whole date ranges can be cleared, and one line
            always stays behind saying who cleared what.
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div>
              <div style={lbl}>From date</div>
              <input type="date" style={sel} value={sFrom} max={sTo}
                     onChange={(e) => setSFrom(e.target.value)} />
            </div>
            <div>
              <div style={lbl}>To date</div>
              <input type="date" style={sel} value={sTo} min={sFrom} max={today()}
                     onChange={(e) => setSTo(e.target.value)} />
            </div>
            <button onClick={safaiKaro} disabled={sBusy}
                    style={{ padding: "9px 18px", borderRadius: 8, border: "none",
                             background: sBusy ? "#fca5a5" : "#dc2626", color: "#fff",
                             fontWeight: 800, fontSize: 12.5,
                             cursor: sBusy ? "default" : "pointer" }}>
              {sBusy ? "Working\u2026" : "Delete permanently"}
            </button>
          </div>
          {sKehna && (
            <div style={{ marginTop: 10, fontSize: 12.5, fontWeight: 700, color: "#b91c1c" }}>
              {sKehna}
            </div>
          )}
        </div>
      )}

      {/* ── ginti ── */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ ...card, padding: "10px 16px", display: "flex", alignItems: "baseline", gap: 8 }}>
          <b style={{ fontSize: 22, color: "#0f172a" }}>{total}</b>
          <span style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>
            {mode === "delete" ? "deletions" : mode === "all" ? "total entries" : "entry"} — in this filter
          </span>
        </div>
        {!!chune.size && (
          <div style={{ ...card, padding: "8px 12px", display: "flex", gap: 10, alignItems: "center",
                        flexWrap: "wrap", borderColor: "#fecaca", background: "#fffbfb" }}>
            <b style={{ fontSize: 13, color: "#b91c1c" }}>{chune.size} selected</b>
            <button onClick={mitaoChune} disabled={cBusy}
                    style={{ padding: "7px 14px", borderRadius: 8, border: "none",
                             background: cBusy ? "#fca5a5" : "#dc2626", color: "#fff",
                             fontWeight: 800, fontSize: 12.5,
                             cursor: cBusy ? "default" : "pointer" }}>
              {cBusy ? "Working\u2026" : "\u{1F5D1} Delete selected"}
            </button>
            <button onClick={() => setChune(new Set())}
                    style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid #cbd5e1",
                             background: "#fff", color: "#475569", fontWeight: 700,
                             fontSize: 12.5, cursor: "pointer" }}>
              Clear selection
            </button>
          </div>
        )}
        {cKehna && <span style={{ fontSize: 12.5, color: "#b91c1c", fontWeight: 700 }}>{cKehna}</span>}
        {busy && <span style={{ fontSize: 12, color: "#64748b" }}>Loading…</span>}
        {err && <span style={{ fontSize: 12, color: "#b91c1c", fontWeight: 700 }}>{err}</span>}
      </div>

      {/* ── table ── */}
      <div style={{ ...card, padding: 0, overflowX: "auto" }}>
        {/* `ap-stack` -- phone par har qatar ek chhota card.  `minWidth: 820`
            desktop ke liye hai; stack wale niyam use `min-width: 0` kar dete
            hain, warna phone par 820px ki table kabhi fit hi nahi hoti. */}
        <table className="ap-stack" style={{ width: "100%", borderCollapse: "collapse", minWidth: 860 }}>
          <thead style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
            <tr>
              <th style={{ ...th, width: 34 }}>
                <input type="checkbox" title="Select all on this page"
                       checked={sabChune}
                       onChange={(e) => setChune(e.target.checked
                         ? new Set(chunneYogya.map((r) => r.id)) : new Set())} />
              </th>
              <th style={th}>When</th>
              <th style={th}>Action</th>
              <th style={th}>By</th>
              <th style={th}>Details</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const L = look(r.action);
              return (
                <tr key={r.id} style={{ borderBottom: "1px solid #f1f5f9",
                                        background: chune.has(r.id) ? "#fef2f2" : undefined }}>
                  <td data-lbl="Select" style={{ ...td, width: 34 }}>
                    {r.action === CLEAR_ACTION
                      ? <span title="This is the trail line — it can never be removed"
                              style={{ color: "#cbd5e1" }}>—</span>
                      : <input type="checkbox" checked={chune.has(r.id)}
                               onChange={() => palto(r.id)} />}
                  </td>
                  <td data-lbl="When" style={{ ...td, whiteSpace: "nowrap", color: "#0f172a", fontWeight: 600 }}>{fmtDT(r.created_at)}</td>
                  <td className="an-stk-hdr" style={{ ...td, whiteSpace: "nowrap" }}>
                    <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 99,
                                   background: L.bg, color: L.c, fontSize: 11.5, fontWeight: 800 }}>{L.t}</span>
                    <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 3, fontFamily: "monospace" }}>{r.action}</div>
                  </td>
                  <td data-lbl="By" style={{ ...td, whiteSpace: "nowrap", fontWeight: 700 }}>{r.username || "—"}</td>
                  <td data-lbl="Details" style={td}>{r.details || <span style={{ color: "#94a3b8" }}>—</span>}</td>
                </tr>
              );
            })}
            {!rows.length && !busy && (
              <tr><td colSpan={5} style={{ padding: "26px 14px", textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
                {waiting ? "Loading…" : "Nothing found for this filter."}
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
                           fontWeight: 700, fontSize: 12.5, cursor: page === 0 ? "not-allowed" : "pointer" }}>← Previous</button>
          <span style={{ fontSize: 12.5, color: "#64748b", fontWeight: 600 }}>Page {page + 1} / {pages}</span>
          <button disabled={page + 1 >= pages || busy} onClick={() => setPage((p) => p + 1)}
                  style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid #cbd5e1",
                           background: "#fff", color: page + 1 >= pages ? "#cbd5e1" : "#475569",
                           fontWeight: 700, fontSize: 12.5, cursor: page + 1 >= pages ? "not-allowed" : "pointer" }}>Next →</button>
        </div>
      )}

      <div style={{ fontSize: 11.5, color: "#94a3b8", lineHeight: 1.6 }}>
        This log is written automatically. An admin can remove entries — a whole date
        range, or just the rows ticked above — but every removal leaves one line behind
        saying who did it, and the ticked-row version lists exactly what was taken out.
        Those lines can never be removed.
      </div>
    </div>
  );
}
