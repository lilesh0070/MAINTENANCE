/* ───────────────────────────────────────────────────────────────────
 * capa/CapaAttach.jsx — CAPA ke aakhir me juda hua saamaan.
 * ───────────────────────────────────────────────────────────────────
 * User 2026-09-20:
 *   • "CAPA ke last me jaise koi check sheet add karni ho (DMC, PMC)" —
 *     par CAPA me jo MACHINE NO hai USI ki sheet aayegi.
 *   • "Sirf CHECK POINT aayenge FORMAT ke saath, fill wali check sheet
 *     nahi" — yaani KHAALI sheet (points + format), bhari hui nahi.
 *   • "Jo attach ho gayi wo phir change na ho" — isliye jo points us waqt
 *     the unki POORI NAQAL (snapshot) CAPA ke apne data me chali jaati hai.
 *     Kal ko admin check sheet me naya point jode ya revision badle, is CAPA
 *     me judi sheet waisi ki waisi rahegi.
 *   • "Button type me de do jisse view kar sake" — list me ek-ek button;
 *     dabao to poori sheet parde me khulti hai (print ka button uske andar).
 *   • OJT form yahan jud kar YAHIN bharta hai; CAPA save par wo Skill &
 *     Training → OJT ki list me bhi record ban jaata hai (`ojt_id`).
 *
 * Saara saamaan CAPA ke apne JSONB blob me `attachments` key par jaata hai --
 * koi nayi table nahi, aur CAPA ki copy / delete / history sab pehle jaisi.
 * ─────────────────────────────────────────────────────────────────── */
import { useCallback, useEffect, useState } from "react";
import { DmcSheet, groupDmcPoints } from "../DmcSheet";
import { FormatSheet } from "../pm/FormatSheet";
import { OjtForm, ojtBlank } from "../skill/OjtForm";

const KIND = {
  dmc: { label: "DMC Check Sheet", icon: "📋" },
  pm:  { label: "PM Check Sheet",  icon: "🛠" },
  ojt: { label: "OJT Form",        icon: "🎓" },
};

const nayaId = () => `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const dt = (s) => {
  if (!s) return "";
  const d = new Date(s);
  return isNaN(d.getTime()) ? String(s)
    : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

/** Ek line ka naam jo button par likha jaata hai. */
const attLabel = (a) => {
  if (!a) return "";
  if (a.k === "ojt") {
    const s = (a.form?.training_subjects || "").trim();
    return `OJT Form · ${s || "not filled yet"}${a.form?.date_of_training ? ` · ${dt(a.form.date_of_training)}` : ""}`;
  }
  const rev = a.rev_no ? `Rev ${a.rev_no}` : "";
  const pts = a.n ? `${a.n} point${a.n === 1 ? "" : "s"}` : "";
  const mk = (a.mark || []).length ? `${a.mark.length} marked` : "";
  return [KIND[a.k]?.label || a.k, a.machine_no, rev, pts, mk].filter(Boolean).join(" · ");
};

export function CapaAttach({ value = [], onChange = null, token, getMachine,
                             viewOnly = false, accent = "#1d4ed8", soft = "#eff6ff" }) {
  const list = Array.isArray(value) ? value : [];
  /* Kaun si cheez pehle se lagi hui hai -- uska "+" button neeche nahi dikhta
     (user 2026-09-20: "check sheet add ho gayi to option hat jaye; cancel
     kare to wapas aaye").  Hatate hi `list` chhoti ho jaati hai, to button
     apne aap wapas. */
  const lagi = { dmc: false, pm: false, ojt: false };
  list.forEach((a) => { if (a && a.k in lagi) lagi[a.k] = true; });
  /* Har badlaav TAAZA list par -- do row jaldi-jaldi dabane par dono nishaan
     lagne chahiye.  Seedha `list` par hisaab karte to pehla mit jaata (dono
     click ek hi render ke purane `list` ko dekhte).  CAPA ka `onChange`
     function bhi le leta hai (React ke setState jaisa). */
  const badlo = (fn) => onChange?.((prev) => fn(Array.isArray(prev) ? prev : []));
  const [pick, setPick]   = useState(null);   // { k, machine, revs, rev, busy, err }
  const [show, setShow]   = useState(null);   // jo attachment parde par khuli hai
  const [err, setErr]     = useState("");

  const get = useCallback(async (path) => {
    const r = await fetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }, [token]);

  /* Sheet chunne ka parda: pehle us machine ke revision la lo (current +
     purane).  "Apne hisaab se chun sakte hain" -- user ne yahi kaha. */
  const kholo = async (k) => {
    const m = getMachine ? getMachine() : {};
    if (!m.machine_no) { setErr("Fill the machine number in the CAPA first."); setTimeout(() => setErr(""), 4000); return; }
    setPick({ k, machine: m, revs: null, rev: "", busy: true, err: "" });
    try {
      const q = `machine_no=${encodeURIComponent(m.machine_no)}&zone=${encodeURIComponent(m.zone || "")}&line=${encodeURIComponent(m.line || "")}`;
      const d = k === "dmc" ? await get(`/api/machine-dmc/revs?${q}`)
                            : await get(`/api/pm/check-point-revs?${q}`);
      const revs = [...(d.current ? [{ ...d.current, cur: true }] : []), ...(d.history || [])];
      setPick((p) => p && { ...p, revs, rev: revs[0]?.rev_no ?? "", busy: false,
                            err: revs.length ? "" : `No ${KIND[k].label} points for ${m.machine_no}.` });
    } catch {
      setPick((p) => p && { ...p, busy: false, err: "Could not read the check sheet." });
    }
  };

  /* Chuni hui revision ke POINTS + FORMAT ki naqal CAPA me rakh do. */
  const jodo = async () => {
    if (!pick || pick.busy) return;
    const { k, machine: m, rev } = pick;
    setPick((p) => ({ ...p, busy: true, err: "" }));
    try {
      const curRev = pick.revs?.find((r) => r.cur)?.rev_no;
      const revQ = rev && String(rev) !== String(curRev) ? `&rev_no=${encodeURIComponent(rev)}` : "";
      const q = `machine_no=${encodeURIComponent(m.machine_no)}&zone=${encodeURIComponent(m.zone || "")}&line=${encodeURIComponent(m.line || "")}`;
      let snap;
      if (k === "dmc") {
        const d = await get(`/api/machine-dmc/points?${q}${revQ}`);
        const f = await get("/api/machine-dmc/format").catch(() => null);
        if (!d.points?.length) throw new Error("no points");
        snap = { k, hdr: d.header || {}, points: d.points, footer: (f && f.format && f.format.doc_footer) || null,
                 rev_no: d.header?.rev_no || rev || "", rev_date: d.header?.rev_date || "",
                 machine_name: d.header?.machine_name || m.machine_name || "" };
      } else {
        const d = await get(`/api/pm/check-points?${q}${revQ}`);
        const f = await get("/api/pm/check-sheet-format").catch(() => null);
        if (!d.points?.length) throw new Error("no points");
        snap = { k, points: d.points, fmt: (f && f.format) || null,
                 rev_no: d.rev?.rev_no || rev || "", rev_date: d.rev?.rev_date || "",
                 machine_name: m.machine_name || "" };
      }
      badlo((prev) => [...prev, {
        id: nayaId(), at: new Date().toISOString(),
        machine_no: m.machine_no, zone: m.zone || "", line: m.line || "",
        n: snap.points.length, ...snap,
      }]);
      setPick(null);
    } catch (e) {
      setPick((p) => p && { ...p, busy: false,
        err: String(e.message) === "no points" ? "This machine has no check points in that revision." : "Could not attach the sheet." });
    }
  };

  const ojtJodo = () => {
    badlo((prev) => [...prev, { k: "ojt", id: nayaId(), at: new Date().toISOString(), ojt_id: null, form: ojtBlank() }]);
  };
  const hatao = (id) => {
    if (!window.confirm("Remove this attachment from the CAPA?")) return;
    badlo((prev) => prev.filter((a) => a.id !== id));
    setShow((s) => (s && s.id === id ? null : s));
  };
  const ojtBadlo = (id, form) =>
    badlo((prev) => prev.map((a) => (a.id === id ? { ...a, form, changed: true } : a)));

  /* Sheet ke kisi point ki row par rang -- audit me dikhane ke liye ki "ye
     point add kiya tha" (user 2026-09-20).  Dobara dabao to rang hat jaata
     hai.  Ye nishaan usi judi hui naqal ke saath CAPA me save hota hai. */
  const rangBadlo = (attId, pid) => badlo((prev) => prev.map((a) => {
    if (a.id !== attId) return a;
    const mk = a.mark || [];
    return { ...a, mark: mk.includes(pid) ? mk.filter((x) => x !== pid) : [...mk, pid] };
  }));

  // parda khula ho to peeche ka page scroll na ho
  useEffect(() => {
    if (!show && !pick) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [show, pick]);

  const showAtt = show ? list.find((a) => a.id === show.id) || show : null;

  return (
    <>
      <style>{`
        .ca-wrap { margin:14px 0 4px; border:1px solid #cbd5e1; border-radius:10px; background:#fff; }
        .ca-hd { display:flex; align-items:center; gap:10px; flex-wrap:wrap; padding:10px 14px; border-bottom:1px solid #e2e8f0; }
        .ca-hd b { font-size:13.5px; color:#0f172a; }
        .ca-note { font-size:11.5px; color:#64748b; }
        .ca-body { padding:12px 14px; display:flex; flex-direction:column; gap:8px; }
        .ca-row { display:flex; align-items:center; gap:8px; }
        .ca-view { flex:1; text-align:left; border:1px solid #cbd5e1; background:#f8fafc; border-radius:8px; padding:9px 12px;
                   font-size:12.5px; font-weight:700; color:#0f172a; cursor:pointer; font-family:inherit;
                   overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .ca-view:hover { border-color:${accent}; background:${soft}; }
        .ca-view .ca-when { font-weight:600; color:#94a3b8; }
        .ca-del { border:1px solid #fecaca; background:#fef2f2; color:#b91c1c; border-radius:8px; padding:9px 11px;
                  font-size:12px; font-weight:800; cursor:pointer; font-family:inherit; }
        .ca-add { display:flex; gap:8px; flex-wrap:wrap; padding:0 14px 12px; }
        .ca-add button { border:1px solid ${accent}; background:#fff; color:${accent}; border-radius:8px; padding:8px 13px;
                         font-size:12.5px; font-weight:800; cursor:pointer; font-family:inherit; }
        .ca-add button:hover { background:${soft}; }
        .ca-none { font-size:12.5px; color:#94a3b8; }
        .ca-err { font-size:12px; font-weight:700; color:#dc2626; padding:0 14px 10px; }
        .ca-ov { position:fixed; inset:0; background:rgba(15,23,42,.55); z-index:9600; display:flex; align-items:flex-start;
                 justify-content:center; overflow-y:auto; padding:26px 14px; }
        .ca-modal { background:#fff; border-radius:12px; width:100%; max-width:1250px; }
        .ca-mhd { display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap;
                  padding:11px 16px; border-bottom:1px solid #e2e8f0; }
        .ca-mhd b { font-size:14px; color:#0f172a; }
        .ca-mbody { padding:14px 16px 20px; }
        .ca-close { border:1px solid #cbd5e1; background:#fff; border-radius:8px; padding:7px 13px; font-size:12.5px;
                    font-weight:800; color:#334155; cursor:pointer; font-family:inherit; }
        .ca-pick { max-width:560px; }
        .ca-revs { display:flex; flex-direction:column; gap:6px; margin-top:10px; max-height:260px; overflow:auto; }
        .ca-rev { display:flex; align-items:center; gap:9px; border:1px solid #e2e8f0; border-radius:8px; padding:8px 11px;
                  font-size:12.5px; color:#0f172a; cursor:pointer; }
        .ca-rev.on { border-color:${accent}; background:${soft}; }
        .ca-rev small { color:#64748b; font-weight:600; }
        .ca-go { border:none; background:${accent}; color:#fff; border-radius:8px; padding:9px 18px; font-size:13px;
                 font-weight:800; cursor:pointer; font-family:inherit; }
        .ca-go:disabled { opacity:.55; cursor:default; }
        .ca-tip { font-size:12px; color:#475569; background:#fffbeb; border:1px solid #fde68a;
                  border-radius:8px; padding:8px 11px; margin-bottom:10px; }
        .ca-tip-box { display:inline-block; width:12px; height:12px; border:1px solid #d97706;
                      background:#fde68a; border-radius:3px; vertical-align:-1px; }
        /* Jis point ki row par nishaan hai -- uske khaane peele.  Category wala
           khaana (rowSpan) chhod dete hain, wo kai row ka saanjha hai. */
        .ca-mbody tr.sheet-mark > td:not([rowspan]) { background:#fde68a !important; }
        @media print { .ca-wrap { display:none; } }
      `}</style>

      <div className="ca-wrap">
        <div className="ca-hd">
          <b>Attachments</b>
          <span className="ca-note">
            Check sheet = the machine's check points with its format (blank). Once attached it never changes,
            even if points are added later.
          </span>
        </div>
        <div className="ca-body">
          {!list.length && <div className="ca-none">Nothing attached yet.</div>}
          {list.map((a) => (
            <div className="ca-row" key={a.id}>
              <button type="button" className="ca-view" onClick={() => setShow(a)}>
                {KIND[a.k]?.icon || "📎"} {attLabel(a)}
                {a.at ? <span className="ca-when">  ·  added {dt(a.at)}</span> : null}
              </button>
              {!viewOnly && (
                <button type="button" className="ca-del" title="Remove" onClick={() => hatao(a.id)}>✕</button>
              )}
            </div>
          ))}
        </div>
        {/* Jo cheez ek baar lag gayi, uska button neeche se hat jaata hai
            (user 2026-09-20) -- ek CAPA me ek hi DMC sheet, ek PM sheet aur
            ek OJT form.  Upar se ✕ karke hatao to button wapas aa jaata hai.
            Teeno lag gaye to poori patti hi nahi dikhti. */}
        {!viewOnly && !(lagi.dmc && lagi.pm && lagi.ojt) && (
          <div className="ca-add">
            {!lagi.dmc && <button type="button" onClick={() => kholo("dmc")}>+ DMC Check Sheet</button>}
            {!lagi.pm  && <button type="button" onClick={() => kholo("pm")}>+ PM Check Sheet</button>}
            {!lagi.ojt && <button type="button" onClick={ojtJodo}>+ OJT Form</button>}
          </div>
        )}
        {err && <div className="ca-err">{err}</div>}
      </div>

      {/* ── sheet chuno ── */}
      {pick && (
        <div className="ca-ov" onClick={() => setPick(null)}>
          <div className="ca-modal ca-pick" onClick={(e) => e.stopPropagation()}>
            <div className="ca-mhd">
              <b>Attach {KIND[pick.k].label}</b>
              <button type="button" className="ca-close" onClick={() => setPick(null)}>✕ Cancel</button>
            </div>
            <div className="ca-mbody">
              <div style={{ fontSize:12.5, color:"#334155" }}>
                Machine <b>{pick.machine.machine_no}</b>
                {pick.machine.machine_name ? ` · ${pick.machine.machine_name}` : ""}
                {pick.machine.zone ? ` · ${pick.machine.zone}` : ""}{pick.machine.line ? ` / ${pick.machine.line}` : ""}
              </div>
              {pick.busy && !pick.revs && <div style={{ marginTop:12, color:"#94a3b8", fontSize:12.5 }}>Loading…</div>}
              {pick.err && <div style={{ marginTop:12, color:"#dc2626", fontSize:12.5, fontWeight:700 }}>{pick.err}</div>}
              {!!pick.revs?.length && (<>
                <div style={{ marginTop:14, fontSize:11.5, fontWeight:800, letterSpacing:".05em",
                              textTransform:"uppercase", color:"#64748b" }}>
                  Which revision
                </div>
                <div className="ca-revs">
                  {pick.revs.map((r) => (
                    <label key={`${r.rev_no}-${r.cur ? "c" : "h"}`}
                           className={`ca-rev${String(pick.rev) === String(r.rev_no) ? " on" : ""}`}>
                      <input type="radio" checked={String(pick.rev) === String(r.rev_no)}
                             onChange={() => setPick((p) => ({ ...p, rev: r.rev_no }))} />
                      <span><b>Rev {r.rev_no}</b>{r.rev_date ? <small>  ·  {dt(r.rev_date)}</small> : null}
                        {r.count != null || r.n != null ? <small>  ·  {r.count ?? r.n} points</small> : null}
                        {r.cur ? <small>  ·  current</small> : null}</span>
                    </label>
                  ))}
                </div>
                <div style={{ marginTop:16, display:"flex", gap:10, alignItems:"center" }}>
                  <button type="button" className="ca-go" onClick={jodo} disabled={pick.busy}>
                    {pick.busy ? "Attaching…" : "Attach"}
                  </button>
                  <span style={{ fontSize:11.5, color:"#64748b" }}>A copy is kept inside this CAPA.</span>
                </div>
              </>)}
            </div>
          </div>
        </div>
      )}

      {/* ── judi hui sheet / OJT dekho ── */}
      {showAtt && (
        <div className="ca-ov" onClick={() => setShow(null)}>
          <div className="ca-modal" onClick={(e) => e.stopPropagation()}>
            <div className="ca-mhd">
              <b>{KIND[showAtt.k]?.icon} {attLabel(showAtt)}</b>
              <button type="button" className="ca-close" onClick={() => setShow(null)}>✕ Close</button>
            </div>
            <div className="ca-mbody">
              {(showAtt.k === "dmc" || showAtt.k === "pm") && (
                <div className="ca-tip">
                  {viewOnly
                    ? `${(showAtt.mark || []).length} point marked.`
                    : <>Click a check point row to mark it (e.g. a point that was added) — it turns
                       {" "}<span className="ca-tip-box" /> yellow. Click again to clear.
                       {" "}<b>{(showAtt.mark || []).length} marked</b> · saves with the CAPA.</>}
                </div>
              )}
              {showAtt.k === "dmc" && (
                <DmcSheet printable hdr={showAtt.hdr || {}} groups={groupDmcPoints(showAtt.points || [])}
                          footer={showAtt.footer} signGrid
                          markIds={showAtt.mark || []}
                          onMarkPoint={viewOnly ? null : (pid) => rangBadlo(showAtt.id, pid)} />
              )}
              {showAtt.k === "pm" && (
                <FormatSheet printable f={showAtt.fmt} points={showAtt.points || []}
                             rev={{ rev_no: showAtt.rev_no, rev_date: showAtt.rev_date }}
                             hdr={{ zone: showAtt.zone, line: showAtt.line,
                                    machine_no: showAtt.machine_no, machine_name: showAtt.machine_name }}
                             markIds={showAtt.mark || []}
                             onMarkPoint={viewOnly ? null : (pid) => rangBadlo(showAtt.id, pid)} />
              )}
              {showAtt.k === "ojt" && (
                <OjtForm value={showAtt.form} readOnly={viewOnly} accent={accent} soft={soft}
                         onChange={(f) => ojtBadlo(showAtt.id, f)}
                         actions={viewOnly ? null : (
                           <span style={{ fontSize:11, fontWeight:700, color:"#64748b" }}>
                             Saves with the CAPA
                           </span>
                         )} />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
