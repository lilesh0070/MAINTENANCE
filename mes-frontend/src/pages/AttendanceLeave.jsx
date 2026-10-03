/* ───────────────────────────────────────────────────────────────────
 * AttendanceLeave.jsx — "Leave" (Attendance Dashboard ke NEECHE; jinke paas
 * board ka haq nahi unke liye yahi akela -- AttendanceDashboard.jsx).
 *
 * User 2026-10-03 (pehli baar): "attendance ke neeche leave ka option do --
 * apna naam select karke kab se kab tak leave par rahega apni ID se daal
 * dega; leave section me dikhega; assistant manager approve karega, date
 * change kar sakta hai."
 * Usi din (doosri baar): "jisko leave apply karni hai wo apni ID se apply
 * karega aur use apni leave dikhegi bas; maint wali ID par sabki.  Supervisor
 * / DET / Engineer / Senior Engineer ki AM, AM ki DM, DM ki Manager, Manager
 * apni khud; admin ke paas sab + leave ki row delete.  Leave ka proper record
 * rahe -- AM / DM / Manager purana record check kar sakein."
 *
 *   • "＋ Apply Leave": apne hi naam ki (naam badalta nahi); sanjha "maint"
 *     ID / admin kisi ka bhi naam chunte hain.  Arzi LOGIN ID se jaati hai.
 *   • Pending: jo dekhne wale ke daayre me hain (server chhaant kar deta hai).
 *   • Records: tareekh (From–To) se purana / aage ka record, naam + haal ki
 *     chhanti, ginti, Excel.
 *   • Har row ke button SERVER ke `can_*` se (us pad ka approver hi Approve /
 *     Change dates / Reject; Cancel apni PENDING; Delete sirf admin).
 * Hisaab + haq SERVER par: Phase2/routers/attendance.py (LEAVE wala hissa);
 * yahan ki jaanch sirf jaldi bataane ke liye.
 * TV par ye section hai hi nahi (TV ka layout band).  Koi lagataar animation nahi.
 * ─────────────────────────────────────────────────────────────────── */
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import { isNativeApp } from "../constants/apiBase";
import ExcelBtn from "../components/ExcelBtn";
import { aajKaNaam } from "../constants/sheetTools";

const NATIVE = isNativeApp();

/* ── tareekh ke chhote helper (History jaise) ── */
const pad = (n) => String(n).padStart(2, "0");
const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dateOf = (s) => { const [y, m, d] = String(s).slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = dateOf(s); d.setDate(d.getDate() + n); return isoOf(d); };
const spanDays = (a, b) => Math.round((dateOf(b) - dateOf(a)) / 86400000) + 1;
const dayTxt = (s) => (s ? dateOf(s).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "");
const whenTxt = (ts) => {
  if (!ts) return "";
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ""
    : d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit", hour12: true });
};
const nDays = (n) => `${n} day${n === 1 ? "" : "s"}`;
// Records ki shuruaati khidki: do mahine pehle ki 1 tareekh -> aaj + 92 din
const monthStart = (s, back) => { const d = dateOf(s); d.setDate(1); d.setMonth(d.getMonth() - back); return isoOf(d); };

const STATUS = {
  PENDING:   { label: "Pending",   c: "#b45309", bg: "#fffbeb", bd: "#fde68a" },
  APPROVED:  { label: "Approved",  c: "#15803d", bg: "#f0fdf4", bd: "#bbf7d0" },
  REJECTED:  { label: "Rejected",  c: "#b91c1c", bg: "#fef2f2", bd: "#fecaca" },
  CANCELLED: { label: "Cancelled", c: "#64748b", bg: "#f1f5f9", bd: "#e2e8f0" },
};

/* Date + tareekh ki jaanch -- server bhi yahi karta hai (LEAVE_MAX_DAYS /
   LEAVE_BACK_DAYS); yahan bas button dabane se pehle bata dete hain. */
function datesGalti(from, to, maxDays, minFrom) {
  if (!from || !to) return "Choose both dates.";
  if (to < from) return "The To date must be on or after the From date.";
  if (spanDays(from, to) > maxDays) return `A leave can be at most ${maxDays} days.`;
  if (minFrom && from < minFrom) return "This start date is too far in the past.";
  return "";
}

// <style> ka text MODULE me -- har render par naya string nahi.
const CSS = `
  .alv { margin:22px 0 0; background:#fff; border:1px solid #e2e8f0; border-radius:16px;
         box-shadow:0 1px 4px rgba(15,23,42,.06); overflow:hidden; font-family:'Barlow',sans-serif; }
  .alv * { box-sizing:border-box; }
  .alv-head { display:flex; align-items:center; gap:12px; flex-wrap:wrap; padding:14px 18px;
              border-bottom:1px solid #eef2f7; background:linear-gradient(180deg,#fff,#fafbfc); }
  .alv-badge { width:38px; height:38px; border-radius:11px; background:#fef2f2; color:#dc2626;
               display:flex; align-items:center; justify-content:center; font-weight:900; font-size:15px;
               border:1px solid #fecaca; flex-shrink:0; }
  .alv-title { font-family:'Barlow Condensed',sans-serif; font-size:21px; font-weight:800; color:#0f172a; line-height:1.1; }
  .alv-sub { font-size:12px; color:#64748b; font-weight:600; margin-top:1px; }
  .alv-tabs { display:flex; border:1px solid #cbd5e1; border-radius:10px; overflow:hidden; margin-left:auto; }
  .alv-tabs button { border:none; background:#fff; color:#64748b; font:700 12px 'Barlow',sans-serif;
                     padding:8px 14px; cursor:pointer; }
  .alv-tabs button.on { background:#0f172a; color:#fff; }
  .alv-apply { height:38px; padding:0 16px; border-radius:10px; border:none; background:#dc2626; color:#fff;
               font:800 13px 'Barlow',sans-serif; cursor:pointer; white-space:nowrap; }
  .alv-apply:disabled { opacity:.55; cursor:default; }
  .alv-msg { margin:12px 18px 0; padding:9px 13px; border-radius:10px; font-size:12.5px; font-weight:700; }
  .alv-msg.ok  { background:#f0fdf4; color:#15803d; border:1px solid #bbf7d0; }
  .alv-msg.err { background:#fef2f2; color:#b91c1c; border:1px solid #fecaca; }
  .alv-msg.info { background:#f8fafc; color:#475569; border:1px solid #e2e8f0; }
  .alv-msg button { margin-left:8px; border:1px solid currentColor; background:#fff; color:inherit;
                    border-radius:7px; padding:2px 9px; font-weight:800; cursor:pointer; }
  .alv-form { margin:14px 18px 4px; padding:14px; border:1px dashed #fca5a5; border-radius:12px; background:#fffafa; }
  .alv-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(170px, 1fr)); gap:12px 14px; }
  .alv-fld { display:flex; flex-direction:column; gap:5px; min-width:0; }
  .alv-fld.wide { grid-column:1/-1; }
  .alv-lbl { font-size:10.5px; font-weight:800; letter-spacing:.06em; text-transform:uppercase; color:#475569; }
  .alv-in { font:500 14px 'Barlow',sans-serif; color:#0f172a; border:1px solid #cbd5e1; border-radius:9px;
            padding:9px 11px; background:#fff; width:100%; outline:none; min-height:40px; }
  .alv-in:focus { border-color:#dc2626; box-shadow:0 0 0 3px rgba(220,38,38,.12); }
  .alv-fixed { font:700 14px 'Barlow',sans-serif; color:#0f172a; border:1px solid #e2e8f0; border-radius:9px;
               padding:9px 11px; background:#f8fafc; min-height:40px; display:flex; align-items:center; gap:6px; }
  .alv-fixed small { color:#64748b; font-weight:700; }
  .alv-hint { font-size:12px; font-weight:700; color:#64748b; margin-top:10px; }
  .alv-hint.bad { color:#b91c1c; }
  .alv-actions { display:flex; gap:10px; justify-content:flex-end; margin-top:12px; flex-wrap:wrap; }
  .alv-btn { height:36px; padding:0 14px; border-radius:9px; border:1px solid #cbd5e1; background:#fff; color:#334155;
             font:800 12.5px 'Barlow',sans-serif; cursor:pointer; white-space:nowrap; }
  .alv-btn:disabled { opacity:.5; cursor:default; }
  .alv-btn.go   { background:#dc2626; border-color:#dc2626; color:#fff; }
  .alv-btn.ok   { background:#16a34a; border-color:#16a34a; color:#fff; }
  .alv-btn.no   { background:#fff; border-color:#fecaca; color:#b91c1c; }
  .alv-btn.edit { background:#eff6ff; border-color:#bfdbfe; color:#1d4ed8; }
  .alv-btn.del  { background:#fff; border-color:#e2e8f0; color:#64748b; }
  .alv-filters { display:flex; gap:10px 12px; flex-wrap:wrap; align-items:flex-end; padding:12px 18px 2px; }
  .alv-filters .alv-fld { flex:1 1 140px; max-width:220px; }
  .alv-sum { display:flex; gap:10px; flex-wrap:wrap; align-items:center; padding:10px 18px 0;
             font-size:12.5px; font-weight:700; color:#475569; }
  .alv-sum b { color:#0f172a; }
  .alv-list { padding:10px 18px 16px; display:flex; flex-direction:column; gap:10px; }
  .alv-empty { padding:22px 8px; text-align:center; color:#94a3b8; font-size:13px; font-weight:600; }
  .alv-row { border:1px solid #e2e8f0; border-left:4px solid var(--c); border-radius:12px; padding:11px 13px;
             background:#fff; display:flex; gap:12px; align-items:flex-start; flex-wrap:wrap; }
  .alv-main { flex:1 1 260px; min-width:0; }
  .alv-name { font-weight:800; font-size:15px; color:#0f172a; }
  .alv-name small { font-weight:700; color:#64748b; font-size:12px; margin-left:6px; }
  .alv-desig { display:inline-block; margin-left:8px; font-size:10.5px; font-weight:800; letter-spacing:.04em;
               color:#475569; background:#f1f5f9; border-radius:6px; padding:1px 7px; vertical-align:2px; }
  .alv-dates { font-size:13.5px; font-weight:700; color:#334155; margin-top:2px; }
  .alv-was { font-size:11.5px; color:#92400e; font-weight:700; margin-top:2px; }
  .alv-wait { font-size:11.5px; color:#b45309; font-weight:800; margin-top:3px; }
  .alv-reason { font-size:12.5px; color:#475569; margin-top:4px; word-break:break-word; }
  .alv-meta { font-size:11.5px; color:#94a3b8; font-weight:600; margin-top:5px; line-height:1.5; }
  .alv-chip { display:inline-block; font-size:11px; font-weight:800; letter-spacing:.04em; text-transform:uppercase;
              padding:3px 9px; border-radius:99px; border:1px solid var(--bd); background:var(--bg); color:var(--c); }
  .alv-side { display:flex; flex-direction:column; align-items:flex-end; gap:8px; margin-left:auto; }
  .alv-btns { display:flex; gap:6px; flex-wrap:wrap; justify-content:flex-end; }
  .alv-sub-form { flex-basis:100%; border-top:1px dashed #e2e8f0; padding-top:10px; margin-top:2px; }
  @media (max-width: 640px) {
    .alv-head { padding:12px; }
    .alv-tabs { margin-left:0; }
    .alv-apply { flex:1 1 100%; }
    .alv-list { padding:10px 12px 14px; }
    .alv-filters { padding:12px 12px 2px; }
    .alv-filters .alv-fld { max-width:none; flex:1 1 45%; }
    .alv-sum { padding:10px 12px 0; }
    .alv-form, .alv-msg { margin-left:12px; margin-right:12px; }
    .alv-side { align-items:flex-start; margin-left:0; flex-basis:100%; }
    .alv-btns { justify-content:flex-start; }
  }
  ${NATIVE ? ".alv-in[type=date] { -webkit-appearance:none; appearance:none; }" : ""}
`;

export default function AttendanceLeave({ token, today: today0 }) {
  const t0 = today0 || isoOf(new Date());
  const [data, setData]   = useState(null);    // GET /leave ka jawab
  const [err, setErr]     = useState("");
  const [rev, setRev]     = useState(0);
  const [form, setForm]   = useState(null);    // null = band; {staff_id, from, to, reason}
  const [busy, setBusy]   = useState(false);
  const [msg, setMsg]     = useState(null);    // {kind, text}
  const [edit, setEdit]   = useState(null);    // {id, mode:"dates"|"reject", from, to, note}
  const [tab, setTab]     = useState("pending");   // "pending" | "records"
  const tabTay            = useRef(false);         // pehli baar data aane par tab ek hi baar chuno
  // Records ki chhanti -- tareekh server par, naam / haal yahin
  const [rFrom, setRFrom] = useState(() => monthStart(t0, 2));
  const [rTo, setRTo]     = useState(() => addDays(t0, 92));
  const [rStatus, setRStatus] = useState("");
  const [rStaff, setRStaff]   = useState("");

  const rangeGalti = !rFrom || !rTo ? "Choose both dates." : rTo < rFrom ? "The To date must be on or after the From date." : "";

  useEffect(() => {
    if (rangeGalti) return undefined;
    let off = false;
    api.get(`/api/attendance/leave?start=${rFrom}&end=${rTo}`, token)
      .then((d) => {
        if (off) return;
        setData(d); setErr("");
        if (!tabTay.current) {
          tabTay.current = true;
          setTab(d.pending && d.pending.length ? "pending" : "records");
        }
      })
      .catch((e) => { if (!off) setErr(e.message || "Could not load leave requests."); });
    return () => { off = true; };
  }, [token, rev, rFrom, rTo, rangeGalti]);

  useEffect(() => {
    if (!msg) return undefined;
    const t = setTimeout(() => setMsg(null), msg.kind === "err" ? 6000 : 3200);
    return () => clearTimeout(t);
  }, [msg]);

  const today = data?.today || t0;
  const maxDays = data?.max_days || 92;
  const minFrom = addDays(today, -(data?.back_days ?? 7));
  const me = data?.me || null;
  const anyApply = !!data?.can_apply_any;
  const people = useMemo(() => data?.people || [], [data]);
  const pending = useMemo(() => data?.pending || [], [data]);
  const rows = useMemo(() => data?.rows || [], [data]);
  const seesOthers = !!data && (data.see_all || (data.approves || []).length > 0);
  const canApply = anyApply || !!me;
  // Backend abhi purana (restart / server update baaki) -- naye khaane (pending,
  // me, can_*) aate hi nahi.  Tab "login juda nahi" jaisa galat sandesh na dikhe.
  // (2026-10-03: laptop par yahi hua -- site nayi, backend 9:27 wala.)
  const purana = !!data && !Array.isArray(data.pending);

  // Records: naam ki list (is khidki ki arziyon se) + haal / naam ki chhanti
  const naamOpts = useMemo(() => {
    const m = new Map();
    for (const r of rows) if (r.staff_id != null && !m.has(r.staff_id)) m.set(r.staff_id, r.staff_name);
    return [...m.entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  }, [rows]);
  const recRows = useMemo(() => rows.filter((r) =>
    (!rStatus || r.status === rStatus) && (!rStaff || String(r.staff_id) === rStaff)), [rows, rStatus, rStaff]);
  const recApprovedDays = recRows.filter((r) => r.status === "APPROVED").reduce((n, r) => n + r.days, 0);
  const shown = tab === "pending" ? pending : recRows;

  const kholo = () => {
    setEdit(null);
    setForm({ staff_id: anyApply ? "" : String(me?.staff_id || ""), from: today, to: today, reason: "" });
  };
  const chuna = anyApply ? people.find((p) => String(p.id) === String(form?.staff_id)) : me;
  const formGalti = !form ? "" : !form.staff_id ? "Choose a name."
    : datesGalti(form.from, form.to, maxDays, minFrom);
  const formDin = form && !formGalti ? spanDays(form.from, form.to) : 0;

  const karo = async (fn, okText, after) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      if (after) after();
      setMsg({ kind: "ok", text: okText });
      setRev((r) => r + 1);
    } catch (e) {
      setMsg({ kind: "err", text: e.message || "Could not save." });
    } finally {
      setBusy(false);
    }
  };

  const bhejo = () => {
    if (formGalti) return;
    karo(() => api.post("/api/attendance/leave",
      { staff_id: Number(form.staff_id), from_date: form.from, to_date: form.to, reason: form.reason }, token),
    `Leave request sent — it now waits for the ${chuna?.waiting_for || "approver"}'s approval.`,
    () => { setForm(null); setTab("pending"); });
  };
  const approve = (r) => karo(() => api.post(`/api/attendance/leave/${r.id}/approve`, {}, token),
    `Approved — ${r.staff_name}, ${nDays(r.days)}.`);
  const saveDates = (r) => karo(() => api.put(`/api/attendance/leave/${r.id}`,
    { from_date: edit.from, to_date: edit.to, note: edit.note }, token), "Dates changed.", () => setEdit(null));
  const reject = (r) => karo(() => api.post(`/api/attendance/leave/${r.id}/reject`, { note: edit?.note || "" }, token),
    "Request rejected.", () => setEdit(null));
  const cancel = (r) => {
    if (!window.confirm(`Cancel the leave request for ${r.staff_name} (${dayTxt(r.from_date)} – ${dayTxt(r.to_date)})?`)) return;
    karo(() => api.post(`/api/attendance/leave/${r.id}/cancel`, {}, token), "Request cancelled.");
  };
  const mitao = (r) => {
    if (!window.confirm(`Delete this leave record permanently?\n\n${r.staff_name} · ${dayTxt(r.from_date)} – ${dayTxt(r.to_date)} · ${STATUS[r.status]?.label || r.status}\n\nThis cannot be undone.`)) return;
    karo(() => api.delete(`/api/attendance/leave/${r.id}`, token), "Leave record deleted.");
  };

  const editGalti = edit && edit.mode === "dates" ? datesGalti(edit.from, edit.to, maxDays, null) : "";

  const subText = !data ? "Loading…"
    : purana ? "The server is still running the old Leave version."
    : data.can_delete ? "Everyone's leave — apply, approve, change dates or delete records."
    : anyApply ? "Everyone's leave — apply for any member and check the records."
    : (data.approves || []).length ? "Apply for your own leave, approve your team's requests and check the records."
    : me ? `Apply for your own leave — it goes to the ${me.waiting_for} for approval.`
    : "Your login is not linked to anyone on the attendance list.";

  const excel = () => ({
    naam: `Leave-Records_${aajKaNaam()}`,
    sheet: "Leave",
    headers: ["#", "Name", "Emp Code", "Designation", "From", "To", "Days", "Status", "Reason",
              "Applied By", "Applied At", "Decided By", "Decided At", "Note", "Requested From", "Requested To"],
    rows: recRows.map((r, i) => [
      i + 1, r.staff_name, r.emp_code || "", r.designation || "", dayTxt(r.from_date), dayTxt(r.to_date), r.days,
      STATUS[r.status]?.label || r.status, r.reason || "", r.applied_by || "", whenTxt(r.applied_at),
      r.status === "PENDING" ? "" : (r.decided_by || ""), r.status === "PENDING" ? "" : whenTxt(r.decided_at),
      r.note || "", r.orig_from ? dayTxt(r.orig_from) : "", r.orig_to ? dayTxt(r.orig_to) : "",
    ]),
  });

  return (
    <section className="alv" aria-label="Leave">
      <style>{CSS}</style>

      <div className="alv-head">
        <div className="alv-badge" aria-hidden="true">L</div>
        <div style={{ minWidth: 0 }}>
          <div className="alv-title">Leave</div>
          <div className="alv-sub">{subText}</div>
        </div>
        <div className="alv-tabs" role="tablist">
          <button className={tab === "pending" ? "on" : ""} onClick={() => setTab("pending")}>
            Pending{pending.length ? ` (${pending.length})` : ""}
          </button>
          <button className={tab === "records" ? "on" : ""} onClick={() => setTab("records")}>Records</button>
        </div>
        {!form && (
          <button className="alv-apply" onClick={kholo} disabled={!data || !canApply}
                  title={data && !canApply ? "Ask admin to add your Emp code to the attendance list" : ""}>
            ＋ Apply Leave
          </button>
        )}
      </div>

      {msg && <div className={`alv-msg ${msg.kind}`} role="status">{msg.text}</div>}
      {err && (
        <div className="alv-msg err">⚠ {err}<button onClick={() => setRev((r) => r + 1)}>Retry</button></div>
      )}
      {purana && (
        <div className="alv-msg err">
          The server is still running the old Leave version — restart the backend (or update the server),
          then reload this page to get the new Leave options.
        </div>
      )}
      {data && !purana && !canApply && (
        <div className="alv-msg info">
          Your login is not linked to anyone on the attendance list, so you can't apply for leave yet —
          ask admin to add your Emp code to the attendance list.
        </div>
      )}

      {form && (
        <div className="alv-form">
          <div className="alv-grid">
            <div className="alv-fld">
              <span className="alv-lbl">Name</span>
              {anyApply ? (
                <select className="alv-in" value={form.staff_id}
                        onChange={(e) => setForm((f) => ({ ...f, staff_id: e.target.value }))}>
                  <option value="">— Select a name —</option>
                  {people.map((m) => (
                    <option key={m.id} value={String(m.id)}>
                      {m.name}{m.emp_code ? ` (${m.emp_code})` : ""}{m.designation ? ` · ${m.designation}` : ""}
                    </option>
                  ))}
                </select>
              ) : (
                // apne hi naam ki arzi -- naam badalta nahi (user ka kaha)
                <div className="alv-fixed">
                  {me?.name}{me?.emp_code ? <small>({me.emp_code})</small> : null}
                </div>
              )}
            </div>
            <div className="alv-fld">
              <span className="alv-lbl">From</span>
              <input className="alv-in" type="date" value={form.from} min={minFrom}
                     onChange={(e) => {
                       const v = e.target.value;
                       // To pehle se peechhe reh jaaye to usse bhi aage kar do
                       setForm((f) => ({ ...f, from: v, to: f.to && f.to < v ? v : f.to }));
                     }} />
            </div>
            <div className="alv-fld">
              <span className="alv-lbl">To</span>
              <input className="alv-in" type="date" value={form.to} min={form.from || minFrom}
                     onChange={(e) => setForm((f) => ({ ...f, to: e.target.value }))} />
            </div>
            <div className="alv-fld wide">
              <span className="alv-lbl">Reason (optional)</span>
              <input className="alv-in" value={form.reason} maxLength={300} placeholder="e.g. family function, medical"
                     onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} />
            </div>
          </div>
          <div className={`alv-hint${formGalti ? " bad" : ""}`}>
            {formGalti || `${nDays(formDin)} · ${dayTxt(form.from)} – ${dayTxt(form.to)}`
              + (chuna?.waiting_for ? ` · goes to the ${chuna.waiting_for} for approval` : "")}
          </div>
          <div className="alv-actions">
            <button className="alv-btn" onClick={() => setForm(null)} disabled={busy}>Cancel</button>
            <button className="alv-btn go" onClick={bhejo} disabled={busy || !!formGalti}>
              {busy ? "Sending…" : "Send request"}
            </button>
          </div>
        </div>
      )}

      {tab === "records" && (
        <>
          <div className="alv-filters">
            <div className="alv-fld">
              <span className="alv-lbl">From</span>
              <input className="alv-in" type="date" value={rFrom}
                     onChange={(e) => { const v = e.target.value; setRFrom(v); if (v && rTo && rTo < v) setRTo(v); }} />
            </div>
            <div className="alv-fld">
              <span className="alv-lbl">To</span>
              <input className="alv-in" type="date" value={rTo} min={rFrom || undefined}
                     onChange={(e) => setRTo(e.target.value)} />
            </div>
            {seesOthers && (
              <div className="alv-fld">
                <span className="alv-lbl">Name</span>
                <select className="alv-in" value={rStaff} onChange={(e) => setRStaff(e.target.value)}>
                  <option value="">All</option>
                  {naamOpts.map(([id, nm]) => <option key={id} value={String(id)}>{nm}</option>)}
                </select>
              </div>
            )}
            <div className="alv-fld">
              <span className="alv-lbl">Status</span>
              <select className="alv-in" value={rStatus} onChange={(e) => setRStatus(e.target.value)}>
                <option value="">All</option>
                {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
          </div>
          <div className="alv-sum">
            {rangeGalti
              ? <span style={{ color: "#b91c1c" }}>{rangeGalti}</span>
              : <>
                  <span><b>{recRows.length}</b> {recRows.length === 1 ? "request" : "requests"}</span>
                  <span>·</span>
                  <span><b>{recApprovedDays}</b> approved {recApprovedDays === 1 ? "day" : "days"}</span>
                  <span>· {dayTxt(rFrom)} – {dayTxt(rTo)}</span>
                  <span style={{ marginLeft: "auto" }}><ExcelBtn banao={excel} /></span>
                </>}
          </div>
        </>
      )}

      <div className="alv-list">
        {!data && !err && <div className="alv-empty">Loading…</div>}
        {data && shown.length === 0 && (
          <div className="alv-empty">
            {tab === "pending" ? "No pending leave requests." : "No leave requests in these dates."}
          </div>
        )}
        {shown.map((r) => {
          const st = STATUS[r.status] || STATUS.PENDING;
          const khula = edit && edit.id === r.id ? edit : null;
          const badla = r.orig_from && (r.orig_from !== r.from_date || r.orig_to !== r.to_date);
          const chalu = r.status === "PENDING" || r.status === "APPROVED";
          return (
            <div key={r.id} className="alv-row" style={{ "--c": st.c }}>
              <div className="alv-main">
                <div className="alv-name">
                  {r.staff_name}{r.emp_code ? <small>{r.emp_code}</small> : null}
                  {r.designation ? <span className="alv-desig">{r.designation}</span> : null}
                </div>
                <div className="alv-dates">
                  {dayTxt(r.from_date)} – {dayTxt(r.to_date)} · {nDays(r.days)}
                </div>
                {badla && (
                  <div className="alv-was">Requested {dayTxt(r.orig_from)} – {dayTxt(r.orig_to)} · dates changed</div>
                )}
                {r.status === "PENDING" && r.waiting_for && (
                  <div className="alv-wait">Waiting for the {r.waiting_for}</div>
                )}
                {r.reason && <div className="alv-reason">“{r.reason}”</div>}
                <div className="alv-meta">
                  Applied by {r.applied_by || "—"}{r.applied_at ? ` · ${whenTxt(r.applied_at)}` : ""}
                  {r.decided_by && r.status !== "PENDING" && (
                    <><br />{st.label} by {r.decided_by}{r.decided_at ? ` · ${whenTxt(r.decided_at)}` : ""}</>
                  )}
                  {r.note && <><br />Note: {r.note}</>}
                </div>
              </div>

              <div className="alv-side">
                <span className="alv-chip" style={{ "--c": st.c, "--bg": st.bg, "--bd": st.bd }}>{st.label}</span>
                <div className="alv-btns">
                  {r.can_approve && r.status === "PENDING" && !khula && (
                    <button className="alv-btn ok" disabled={busy} onClick={() => approve(r)}>✓ Approve</button>
                  )}
                  {r.can_approve && chalu && !khula && (
                    <button className="alv-btn edit" disabled={busy}
                            onClick={() => setEdit({ id: r.id, mode: "dates", from: r.from_date, to: r.to_date, note: "" })}>
                      ✎ Change dates
                    </button>
                  )}
                  {r.can_approve && chalu && !khula && (
                    <button className="alv-btn no" disabled={busy}
                            onClick={() => setEdit({ id: r.id, mode: "reject", note: "" })}>✕ Reject</button>
                  )}
                  {r.can_cancel && !khula && (
                    <button className="alv-btn" disabled={busy} onClick={() => cancel(r)}>Cancel request</button>
                  )}
                  {r.can_delete && !khula && (
                    <button className="alv-btn del" disabled={busy} onClick={() => mitao(r)}
                            title="Delete this leave record (admin)">🗑 Delete</button>
                  )}
                </div>
              </div>

              {khula && khula.mode === "dates" && (
                <div className="alv-sub-form">
                  <div className="alv-grid">
                    <div className="alv-fld">
                      <span className="alv-lbl">From</span>
                      <input className="alv-in" type="date" value={khula.from}
                             onChange={(e) => {
                               const v = e.target.value;
                               setEdit((x) => ({ ...x, from: v, to: x.to && x.to < v ? v : x.to }));
                             }} />
                    </div>
                    <div className="alv-fld">
                      <span className="alv-lbl">To</span>
                      <input className="alv-in" type="date" value={khula.to} min={khula.from || undefined}
                             onChange={(e) => setEdit((x) => ({ ...x, to: e.target.value }))} />
                    </div>
                    <div className="alv-fld">
                      <span className="alv-lbl">Note (optional)</span>
                      <input className="alv-in" value={khula.note} maxLength={300}
                             onChange={(e) => setEdit((x) => ({ ...x, note: e.target.value }))} />
                    </div>
                  </div>
                  <div className={`alv-hint${editGalti ? " bad" : ""}`}>
                    {editGalti || `${nDays(spanDays(khula.from, khula.to))} · ${dayTxt(khula.from)} – ${dayTxt(khula.to)}`}
                  </div>
                  <div className="alv-actions">
                    <button className="alv-btn" onClick={() => setEdit(null)} disabled={busy}>Cancel</button>
                    <button className="alv-btn edit" onClick={() => saveDates(r)} disabled={busy || !!editGalti}>
                      {busy ? "Saving…" : "Save dates"}
                    </button>
                  </div>
                </div>
              )}

              {khula && khula.mode === "reject" && (
                <div className="alv-sub-form">
                  <div className="alv-fld">
                    <span className="alv-lbl">Reason for rejecting (optional)</span>
                    <input className="alv-in" value={khula.note} maxLength={300}
                           onChange={(e) => setEdit((x) => ({ ...x, note: e.target.value }))} />
                  </div>
                  <div className="alv-actions">
                    <button className="alv-btn" onClick={() => setEdit(null)} disabled={busy}>Back</button>
                    <button className="alv-btn no" onClick={() => reject(r)} disabled={busy}>
                      {busy ? "Saving…" : "Reject request"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
