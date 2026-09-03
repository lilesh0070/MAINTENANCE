/* ───────────────────────────────────────────────────────────────────
 * MaintenanceCAPA.jsx  —  CAPA / Quality Problem Report (QPR)
 * ───────────────────────────────────────────────────────────────────
 * Every manual-slip breakdown with a ≥60-min repair (maintenance_breakdown_data,
 * mc_down_time_minutes ≥ 60) is a CAPA.  This page has two views:
 *   • LIST  — the pending / filled CAPAs (Machine No / Name / Date / Model /
 *             Duration / Problem) from /api/capa-lb/pending.
 *   • FORM  — the full QPR sheet (capa.xlsx format, grid from capaGrid.js, every
 *             blank cell an <input name="f_row_col">).  Opening a breakdown
 *             pre-fills machine/date/model/problem; Save stores one JSONB blob
 *             (POST /api/capa-lb/sheet) linked to the breakdown.
 *
 * Regenerate the grid from the xlsx:  <scratchpad>\gen_capa_html.py
 * Routing: /maintenance-capa
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { CAPA_QPR_GRID } from "./capaGrid";

// breakdown field  →  QPR grid cell (input name)
const PREFILL = (bd) => ({
  f_mno:   bd.machine_no   || "",   // MACHINE_NO
  f_mname: bd.machine_name || "",   // MACHINE_NAME
  f_10_4:  bd.model_no     || "",   // Model
  f_2_13:  bd.bd_date      || "",   // QPR DATE
  // Reported Problem — MAINTENANCE ne jo dekha wahi.  QPR ek technical
  // analysis hai, isliye yahan maintenance ka observation chahiye, production
  // ka symptom nahi.  Pehle yahan `bd.problem` tha jo backend me
  // COALESCE(maintenance, production) hai — nateeja aaj wahi aata hai, par wo
  // fallback tha, pakki baat nahi.  Ab saaf-saaf maintenance ka khaana pehle;
  // wo sach me khali ho tabhi production ka, taaki QPR khali na khule.
  f_16_3:  bd.problem_maintenance || bd.problem || "",
  f_zone:  bd.zone_name    || "",   // ZONE
  f_line:  bd.line_name    || "",   // LINE
});

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/* FY Apr→Mar.  "2026-27" ka matlab 1-Apr-2026 se 31-Mar-2027. */
const fyOf = (ymd) => {
  const m = /^(\d{4})-(\d{2})/.exec(String(ymd || ""));
  if (!m) return "";
  const y = +m[1], mo = +m[2];
  const start = mo >= 4 ? y : y - 1;
  return `${start}-${String(start + 1).slice(2)}`;
};
const fyMonthList = (fy) => {
  const y = parseInt(String(fy).split("-")[0], 10);
  if (isNaN(y)) return [];
  const out = [];
  for (let i = 0; i < 12; i++) {
    const mo = ((3 + i) % 12) + 1;            // 4,5,…,12,1,2,3
    const yr = mo >= 4 ? y : y + 1;
    out.push({ value: `${yr}-${String(mo).padStart(2, "0")}`, label: `${MONTHS[mo - 1]} ${yr}` });
  }
  return out;
};

export default function MaintenanceCAPA() {
  const { token, theme, user } = useAuth();
  const formRef = useRef(null);
  const videoRef = useRef(null);
  const [cam, setCam] = useState(null);   // {box} while the live-camera modal is open
  const [sign, setSign] = useState(null); // {box} while the signature-pad modal is open
  const sigCanvasRef = useRef(null);
  const drawing = useRef(false);
  const [view, setView]   = useState("list");      // "list" | "form"
  const [rows, setRows]   = useState([]);
  const [loading, setLoading] = useState(true);

  /* ── Filters ──────────────────────────────────────────────────
     Zone / Line / Machine ke option MACHINE MASTER se aate hain (data se
     nahi) — poore app ka yahi niyam hai, taaki jis machine par abhi tak
     koi CAPA nahi bani wo bhi list me dikhe.
     Default: CHAALU MAHINA. */
  const nowYm = (() => { const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; })();
  const [fFy, setFFy]     = useState(fyOf(nowYm));
  const [fMonth, setFMonth] = useState(nowYm);
  const [fZone, setFZone] = useState("");
  const [fLine, setFLine] = useState("");
  const [fMno, setFMno]   = useState("");
  const [master, setMaster] = useState([]);

  const [sid, setSid] = useState(null);            // current saved-sheet id
  const [sStatus, setSStatus] = useState("DRAFT"); // khuli hui sheet ka status
  const [bdId, setBdId] = useState(null);          // current breakdown id
  const [prefill, setPrefill] = useState({});      // {cell: value} to apply on open
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(""), 3000); };

  const api = useCallback(async (path, opts = {}) => {
    const r = await fetch(`/api/capa-lb${path}`, {
      ...opts,
      headers: { "Content-Type": "application/json",
                 ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) },
    });
    if (!r.ok) { let m; try { m = JSON.parse(await r.text()).detail; } catch { m = null; }
      throw new Error(m || `HTTP ${r.status}`); }
    return r.json();
  }, [token]);

  const loadPending = useCallback(() => {
    setLoading(true);
    api(`/pending`)
      // ginti ab client par `shown` se banti hai (filter ke hisaab se), isliye
      // API ke total/pending/done ki zaroorat nahi rahi.
      .then((d) => setRows(d.rows || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [api]);
  useEffect(() => { loadPending(); }, [loadPending]);

  // apply the prefill / loaded data whenever the FORM view opens
  // (handles text inputs AND checkboxes)
  useEffect(() => {
    if (view !== "form" || !formRef.current) return;
    const els = formRef.current.elements;
    formRef.current.reset();
    Object.entries(prefill || {}).forEach(([k, v]) => {
      const el = els[k]; if (!el || v == null) return;
      if (el.type === "checkbox") el.checked = (v === true || v === "on" || v === "true" || v === 1 || v === "1");
      else el.value = v;
    });
    // reflect any loaded photo (hidden pdata value → <img>)
    formRef.current.querySelectorAll(".pbox").forEach((box) => {
      const d = box.querySelector(".pdata")?.value;
      const img = box.querySelector(".pimg");
      if (d) { if (img) img.src = d; box.classList.add("has"); }
      else { if (img) img.removeAttribute("src"); box.classList.remove("has"); }
    });
  }, [view, prefill]);

  // Data Validation: auto Sr. No. + row-by-row lock (next row typeable only after the
  // previous cause is filled) + compact on clear.  readOnly (not disabled) → clicks
  // always land instantly; render runs ONLY when a row's filled-state flips → typing is
  // zero-cost otherwise.
  useEffect(() => {
    if (view !== "form" || !formRef.current) return;
    const form = formRef.current;
    const COLS = [4, 8, 10, 12];   // cause, verification, result, remarks
    const rows = [...form.querySelectorAll(".dv-cause")].map((c) => +c.dataset.row).sort((a, b) => a - b);
    const cell = {}, srno = {}, state = {};   // cache element refs + last-known filled state ONCE
    rows.forEach((r) => {
      cell[r] = {}; COLS.forEach((c) => { cell[r][c] = form.querySelector('[name="f_' + r + '_' + c + '"]'); });
      srno[r] = form.querySelector('.dv-srno[data-row="' + r + '"]');
    });
    const filled = (r) => { const c = cell[r][4]; return !!(c && String(c.value).trim() !== ""); };
    const render = () => {                     // Sr.No + lock the rows below the first empty one
      let n = 0, prev = true;
      rows.forEach((r) => {
        const f = filled(r);
        const sr = srno[r]; if (f) { n += 1; if (sr) sr.textContent = n; } else if (sr) sr.textContent = "";
        const lock = !prev;
        COLS.forEach((c) => { const el = cell[r][c]; if (el && el.readOnly !== lock) el.readOnly = lock; });
        state[r] = f; prev = prev && f;
      });
    };
    const hasGap = () => {          // an empty row with a filled row below it
      let seenEmpty = false;
      for (const r of rows) { if (!filled(r)) seenEmpty = true; else if (seenEmpty) return true; }
      return false;
    };
    const compact = () => {         // clear a middle row → pull the rest up
      const kept = rows.filter(filled).map((r) => COLS.map((c) => (cell[r][c] ? cell[r][c].value : "")));
      rows.forEach((r, i) => { const row = kept[i] || ["", "", "", ""];
        COLS.forEach((c, j) => { const el = cell[r][c]; if (el && el.value !== row[j]) el.value = row[j]; }); });
      render();
    };
    const onInput = (e) => {        // re-render ONLY when this row's filled-state actually flips
      const t = e.target;
      if (!t.classList || !t.classList.contains("dv-cause")) return;
      const r = +t.dataset.row;
      if (filled(r) !== state[r]) render();
    };
    const onChange = (e) => { if (e.target.classList && e.target.classList.contains("dv-cause") && hasGap()) compact(); };
    form.addEventListener("input", onInput);
    form.addEventListener("change", onChange);
    render();
    return () => { form.removeEventListener("input", onInput); form.removeEventListener("change", onChange); };
  }, [view, prefill]);

  // wire the photo upload / camera widgets (uncontrolled → data-URL into a hidden input)
  useEffect(() => {
    if (view !== "form" || !formRef.current) return;
    const form = formRef.current;
    const onChange = (e) => {
      const inp = e.target;
      // Yes/No checkboxes → mutually exclusive within their data-radio group
      if (inp.type === "checkbox" && inp.dataset && inp.dataset.radio && inp.checked) {
        form.querySelectorAll('input.fcb[data-radio="' + inp.dataset.radio + '"]')
            .forEach((o) => { if (o !== inp) o.checked = false; });
        return;
      }
      if (inp.type !== "file" || !inp.closest || !inp.closest(".pbox")) return;
      const f = inp.files && inp.files[0]; if (!f) return;
      const box = inp.closest(".pbox");
      const rd = new FileReader();
      rd.onload = () => { const img = box.querySelector(".pimg");
        box.querySelector(".pdata").value = rd.result; if (img) img.src = rd.result; box.classList.add("has"); };
      rd.readAsDataURL(f); inp.value = "";
    };
    const onClick = (e) => {
      const camBtn = e.target.closest && e.target.closest(".pcam");
      if (camBtn) { const box = camBtn.closest(".pbox"); if (box) setCam({ box }); return; }
      const sigBtn = e.target.closest && e.target.closest(".ssign");
      if (sigBtn) { const box = sigBtn.closest(".pbox"); if (box) setSign({ box }); return; }
      if (!e.target.classList || !e.target.classList.contains("pclr")) return;
      const box = e.target.closest(".pbox");
      box.querySelector(".pdata").value = ""; const img = box.querySelector(".pimg");
      if (img) img.removeAttribute("src"); box.classList.remove("has");
    };
    form.addEventListener("change", onChange);
    form.addEventListener("click", onClick);
    return () => { form.removeEventListener("change", onChange); form.removeEventListener("click", onClick); };
  }, [view]);

  // auto sentence-case: capitalize the first letter, and the first letter after a
  // full-stop / ! / ? (with or without a space) — rest stays as typed, comma doesn't
  // count.  Skips date / code / number fields (label says No./Code/Date/Qty/Model/…).
  useEffect(() => {
    if (view !== "form" || !formRef.current) return;
    const form = formRef.current;
    const CODE_LABEL = /(\bcode\b|\bno\.?\b|\bnos\b|\bnumber\b|\bqty\b|\bquantity\b|\bdate\b|\btime\b|\bmodel\b|\bbatch\b|\brev\b|\bserial\b|\bzone\b|\bline\b|\bshift\b|\bsr\b)/i;
    const skipCap = (el) => {
      if (el.type === "date") return true;
      const td = el.closest("td");
      let lab = td ? (td.textContent || "") : "";
      if (td && td.previousElementSibling) lab += " " + (td.previousElementSibling.textContent || "");
      return CODE_LABEL.test(lab.replace(/_/g, " "));      // MACHINE_NO → MACHINE NO
    };
    const onInput = (e) => {
      if (e.isComposing) return;
      const el = e.target;
      const isText = el.classList && (el.classList.contains("fta") ||
                     (el.classList.contains("fin") && el.type !== "date"));
      if (!isText) return;
      if (el._capSkip === undefined) el._capSkip = skipCap(el);   // decide once per field
      if (el._capSkip) return;
      const v = el.value;
      const nv = v.replace(/(^\s*|[.!?]\s*)([a-z])/g, (_m, p, c) => p + c.toUpperCase());
      if (nv !== v) {
        const pos = el.selectionStart;                 // length unchanged → caret stays valid
        el.value = nv;
        try { el.setSelectionRange(pos, pos); } catch (_) { /* detached */ }
      }
    };
    form.addEventListener("input", onInput);
    return () => form.removeEventListener("input", onInput);
  }, [view]);

  // live camera — open the webcam when the modal is shown, stop it on close
  useEffect(() => {
    if (!cam) return;
    let stream;
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then((s) => { stream = s;
        if (videoRef.current) { videoRef.current.srcObject = s; videoRef.current.play().catch(() => {}); } })
      .catch((e) => { flash("Could not open the camera: " + (e?.message || e)); setCam(null); });
    return () => { if (stream) stream.getTracks().forEach((t) => t.stop()); };
  }, [cam]);

  const capture = () => {
    const v = videoRef.current; if (!v || !cam?.box) return;
    const cv = document.createElement("canvas");
    cv.width = v.videoWidth || 640; cv.height = v.videoHeight || 480;
    cv.getContext("2d").drawImage(v, 0, 0, cv.width, cv.height);
    const url = cv.toDataURL("image/jpeg", 0.85);
    const box = cam.box;
    box.querySelector(".pdata").value = url;
    const img = box.querySelector(".pimg"); if (img) img.src = url;
    box.classList.add("has");
    setCam(null);
  };

  // signature pad — draw with mouse / touch
  const sigPos = (e) => {
    const c = sigCanvasRef.current; const r = c.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return { x: (t.clientX - r.left) * (c.width / r.width), y: (t.clientY - r.top) * (c.height / r.height) };
  };
  const sigStart = (e) => { e.preventDefault(); drawing.current = true;
    const ctx = sigCanvasRef.current.getContext("2d"); const p = sigPos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); };
  const sigMove = (e) => { if (!drawing.current) return; e.preventDefault();
    const ctx = sigCanvasRef.current.getContext("2d"); const p = sigPos(e);
    ctx.lineTo(p.x, p.y); ctx.strokeStyle = "#0f172a"; ctx.lineWidth = 2; ctx.lineCap = "round"; ctx.stroke(); };
  const sigEnd = () => { drawing.current = false; };
  const clearSign = () => { const c = sigCanvasRef.current; if (c) c.getContext("2d").clearRect(0, 0, c.width, c.height); };
  const saveSign = () => {
    const c = sigCanvasRef.current; if (!c || !sign?.box) return;
    const url = c.toDataURL("image/png");
    const box = sign.box;
    box.querySelector(".pdata").value = url;
    const img = box.querySelector(".pimg"); if (img) img.src = url;
    box.classList.add("has");
    setSign(null);
  };

  const collect = () => {
    const data = {};
    if (formRef.current) new FormData(formRef.current).forEach((v, k) => { if (String(v).trim() !== "") data[k] = v; });
    return data;
  };

  const fillQpr = async (row) => {
    if (row.sheet_id) {                            // already started → load it
      try {
        const s = await api(`/sheet/${row.sheet_id}`);
        setPrefill(s.data || {}); setSid(s.id); setBdId(s.breakdown_id || row.bd_id);
        setSStatus((s.status || "DRAFT").toUpperCase());
      } catch (e) { flash("Open failed: " + (e.message || "")); return; }
    } else {                                       // fresh → pre-fill from the breakdown
      setPrefill(PREFILL(row)); setSid(null); setBdId(row.bd_id); setSStatus("DRAFT");
    }
    setView("form");
  };

  /* `status` ab hamesha bheja jaata hai.  Pehle nahi bhejte the, isliye backend
     har sheet ko DRAFT kar deta tha aur CAPA kabhi CLOSE ho hi nahi sakti thi —
     Historical ka "CAPA (Closed)" section hamesha khali rehta. */
  const saveWith = async (status) => {
    setSaving(true);
    try {
      const r = await api(`/sheet`, { method: "POST",
        body: JSON.stringify({ id: sid, breakdown_id: bdId, data: collect(), status }) });
      setSid(r.id); setSStatus(status);
      flash(status === "CLOSED" ? `Closed ✓ (QPR #${r.id})`
            : sid ? `Saved ✓ (QPR #${r.id})` : `Saved ✓ (QPR #${r.id})`);
      return true;
    } catch (e) { flash("Save failed: " + (e.message || "")); return false; }
    finally { setSaving(false); }
  };
  const save = () => saveWith(sStatus === "CLOSED" ? "CLOSED" : "DRAFT");
  const closeCapa = async () => {
    if (!window.confirm("Close this CAPA? It will move to Historical Data → CAPA (Closed).")) return;
    await saveWith("CLOSED");
  };
  const reopenCapa = async () => { await saveWith("DRAFT"); };

  const backToList = () => { setView("list"); setSid(null); setBdId(null); setSStatus("DRAFT"); setPrefill({}); loadPending(); };

  const btn = { border:"1px solid #cbd5e1", background:"#fff", cursor:"pointer", borderRadius:8, padding:"8px 14px", fontSize:13, fontWeight:700, color:"#334155" };
  // Machine master — zone/line/machine ke dropdown iske hi bharte hain.
  // Alag effect me hai: /pending fail ho jaye to bhi dropdown khali na rahein.
  useEffect(() => {
    if (!token) return;
    fetch("/api/machines/", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setMaster(Array.isArray(d) ? d : []))
      .catch(() => setMaster([]));
  }, [token]);

  const fyOpts = useMemo(() => {
    const set = new Set(rows.map((r) => fyOf(r.bd_date)).filter(Boolean));
    set.add(fyOf(nowYm));
    return [...set].sort().reverse();
  }, [rows, nowYm]);

  const zoneOpts = useMemo(
    () => [...new Set(master.map((m) => m.zone_name).filter(Boolean))].sort(), [master]);
  const lineOpts = useMemo(() => fZone
    ? [...new Set(master.filter((m) => m.zone_name === fZone).map((m) => m.line_name).filter(Boolean))].sort()
    : [], [master, fZone]);
  const mnoOpts = useMemo(() => (fZone && fLine)
    ? [...new Set(master.filter((m) => m.zone_name === fZone && m.line_name === fLine)
                        .map((m) => m.machine_no).filter(Boolean))].sort()
    : [], [master, fZone, fLine]);

  /* Filter lagne ke baad ki list — cards aur table DONO isi se bante hain,
     warna upar ki ginti aur neeche ki list alag-alag baat kehti. */
  const shown = useMemo(() => rows.filter((r) => {
    const d = r.bd_date || "";
    if (fMonth) { if (d.slice(0, 7) !== fMonth) return false; }
    else if (fFy && fyOf(d) !== fFy) return false;
    if (fZone && r.zone_name !== fZone) return false;
    if (fLine && r.line_name !== fLine) return false;
    if (fMno  && r.machine_no !== fMno) return false;
    return true;
  }), [rows, fFy, fMonth, fZone, fLine, fMno]);

  /* "Closed" ka matlab sheet ka status CLOSED hona hai — sirf sheet ban jaana
     nahi.  Ek DRAFT sheet abhi kaam baaki hai, isliye wo OPEN hi ginti hai
     (aur Historical me bhi nahi jaati). */
  const isClosed = (r) => String(r.sheet_status || "").toUpperCase() === "CLOSED";
  const open   = shown.filter((r) => !isClosed(r)).length;
  const closed = shown.length - open;

  /* Zone-wise open/close — sirf un zones ka jinme is filter par kuch hai. */
  const byZone = useMemo(() => {
    const m = new Map();
    shown.forEach((r) => {
      const k = r.zone_name || "—";
      const e = m.get(k) || { zone: k, open: 0, closed: 0 };
      if (isClosed(r)) e.closed += 1; else e.open += 1;
      m.set(k, e);
    });
    return [...m.values()].sort((a, b) => (b.open + b.closed) - (a.open + a.closed));
  }, [shown]);

  const clearFilters = () => { setFFy(fyOf(nowYm)); setFMonth(nowYm); setFZone(""); setFLine(""); setFMno(""); };

  const tile = (label, val, color, sub) => (
    <div style={{ background:"#fff", border:"1px solid #e2e8f0", borderTop:`3px solid ${color}`, borderRadius:14, padding:"14px 18px", minWidth:150 }}>
      <div style={{ fontSize:11.5, fontWeight:800, letterSpacing:".05em", textTransform:"uppercase", color:"#64748b" }}>{label}</div>
      <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:38, fontWeight:800, color, lineHeight:1 }}>{loading ? "…" : val}</div>
      <div style={{ fontSize:11, color:"#94a3b8", marginTop:3 }}>{sub}</div>
    </div>
  );

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700;800&family=Barlow+Condensed:wght@700;800&display=swap');
        .cp-root { min-height:100vh; background:#eef2f7; font-family:'Barlow',sans-serif; padding-bottom:40px; }
        .cp-top { background:#fff; border-bottom:1px solid #e2e8f0; min-height:60px; padding:8px 30px 8px 96px;
                  display:flex; align-items:center; gap:14px; flex-wrap:wrap; position:sticky; top:0; z-index:50; box-shadow:0 1px 3px rgba(0,0,0,.06); }
        .cp-top::after { content:''; position:absolute; bottom:0; left:0; right:0; height:2px; background:${theme.gradient}; }
        .cp-title { font-family:'Barlow Condensed',sans-serif; font-size:28px; font-weight:800; color:#0f172a; }
        .cp-title span { color:${theme.accent}; }
        .cp-save { border:none; background:${theme.accent}; color:#fff; cursor:pointer; border-radius:8px; padding:8px 20px; font-size:13.5px; font-weight:800; }
        .cp-save:disabled { opacity:.5; cursor:default; }
        .cp-msg { font-size:12.5px; font-weight:700; color:#16a34a; }
        .cp-body { max-width:1280px; margin:16px auto; padding:0 24px; }
        .cp-fld { display:flex; flex-direction:column; gap:5px; }
        .cp-fld label { font-size:10.5px; font-weight:800; letter-spacing:.05em;
                        text-transform:uppercase; color:#64748b; }
        .cp-sel { border:1.5px solid #cbd5e1; border-radius:9px; padding:8px 11px; font-size:13px;
                  font-weight:600; color:#0f172a; outline:none; background:#fff;
                  font-family:'Barlow',sans-serif; min-width:140px; }
        .cp-sel:focus { border-color:${theme.accent}; }
        .cp-sel:disabled { background:#f1f5f9; color:#94a3b8; cursor:not-allowed; }

        .cp-tbl-wrap { background:#fff; border:1px solid #e2e8f0; border-radius:14px; overflow-x:auto; box-shadow:0 1px 3px rgba(15,23,42,.05); }
        .cp-tbl { width:100%; border-collapse:collapse; }
        .cp-tbl th { background:#1e3a8a; color:#fff; font-size:11.5px; font-weight:700; padding:11px 14px; text-align:left; white-space:nowrap; }
        .cp-tbl td { border-bottom:1px solid #eef2f7; padding:10px 14px; font-size:12.5px; color:#334155; }
        .cp-tbl tbody tr { cursor:pointer; }
        .cp-tbl tr:hover td { background:#f8fafc; }
        /* long text columns clamped to ~3 lines so the QPR button stays visible */
        .cp-clamp { max-width:230px; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; line-height:1.3; }
        /* keep Status + QPR pinned to the right while scrolling wide rows */
        .cp-tbl th.cp-stick, .cp-tbl td.cp-stick { position:sticky; right:0; background:#fff; box-shadow:-6px 0 8px -6px rgba(0,0,0,.15); }
        .cp-tbl th.cp-stick { background:#1e3a8a; }
        .cp-tbl tr:hover td.cp-stick { background:#f8fafc; }
        .cp-dur { font-weight:800; color:#dc2626; text-align:center; }
        .cp-mno { font-weight:800; color:#0f172a; }
        .cp-fill { border:none; cursor:pointer; background:${theme.accent}; color:#fff; border-radius:8px; padding:7px 15px; font-size:12.5px; font-weight:800; }
        .cp-open { border:1.5px solid #cbd5e1; background:#fff; cursor:pointer; border-radius:8px; padding:6px 14px; font-size:12.5px; font-weight:700; color:#334155; }
        .cp-badge { padding:3px 10px; border-radius:99px; font-size:11px; font-weight:800; }

        .cp-scroll { overflow-x:auto; margin-top:12px; }
        .cp-sheet { background:#fff; padding:10px; box-shadow:0 3px 16px rgba(15,23,42,.18); min-width:1000px; }
        .cp-format { font-family:Arial, sans-serif; font-size:11.5px; font-weight:700; color:#7f1d1d; padding:8px 6px 3px; letter-spacing:.02em; }
        .qpr { width:100%; border-collapse:collapse; table-layout:fixed; font-family:Arial, sans-serif; color:#111; }
        .qpr td { overflow:hidden; word-wrap:break-word; line-height:1.15; }
        /* height:100% dono par.  Bina iske box sirf apne text jitna rehta hai,
           to lambe cell (Effective Batch Code / Resp. / Tgt. Date 272px, For
           Occurrence 88px) me box upar ek line ka reh jaata aur neeche ka poora
           hissa dabane par kuch nahi hota — dikhta bhara-poora khaana tha, par
           bhara nahi ja raha tha.  100% se box poori cell le leta hai; chhote
           khaano me kuch nahi badalta aur textarea ka auto-grow bhi chalta hai. */
        .qpr input.fin, .qpr textarea.fta { width:100%; height:100%; box-sizing:border-box; border:none; outline:none; background:transparent; font:inherit; color:#1d4ed8; padding:1px 3px; }
        /* height:100% zaroori hai.  field-sizing:content akela box ko sirf
           uske text jitna rakhta hai — to jo cell lambe hain (For
           Occurrence 88px, Effective Batch Code / Resp. 272px) unme box
           upar ek line ka reh jaata tha aur neeche ka poora hissa dabane
           par kuch nahi hota — dikhta bhara-poora box tha, par bhara nahi
           ja raha tha.  100% se box cell ki poori unchai le leta hai, aur
           chhote khaano me auto-grow pehle jaisa hi chalta rehta hai. */
        .qpr textarea.fta { resize:none; overflow:hidden; line-height:1.15; field-sizing:content; min-height:1.6em; }
        .qpr input.fin:focus, .qpr textarea.fta:focus { background:#eff6ff; }
        .qpr input.fin[readonly], .qpr textarea.fta[readonly] { background:#eef2f7; cursor:not-allowed; }
        .qpr input.fcb { width:14px; height:14px; margin-left:5px; vertical-align:middle; cursor:pointer; accent-color:#1d4ed8; }
        .qpr .pbox { position:relative; min-height:90px; height:100%; display:flex; align-items:center; justify-content:center; gap:8px; }
        .qpr .pbox .pimg { display:none; max-width:100%; max-height:230px; }
        .qpr .pbox.has .pimg { display:block; } .qpr .pbox.has .pbtns { display:none; }
        .qpr .pbtns { display:flex; gap:8px; flex-wrap:wrap; justify-content:center; }
        .qpr .pbtn { display:inline-flex; align-items:center; gap:4px; border:1px dashed #94a3b8; border-radius:8px; padding:6px 12px; font-size:11px; font-weight:700; color:#475569; cursor:pointer; background:#f8fafc; }
        .qpr .pbtn input[type=file] { display:none; }
        .qpr .pclr { display:none; position:absolute; top:3px; right:3px; border:none; background:#dc2626; color:#fff; border-radius:6px; width:20px; height:20px; cursor:pointer; font-weight:800; line-height:1; }
        .qpr .pbox.has .pclr { display:block; }
        .cam-ov { position:fixed; inset:0; background:rgba(15,23,42,.72); z-index:1000; display:flex; align-items:center; justify-content:center; }
        .cam-modal { background:#fff; border-radius:14px; padding:16px; box-shadow:0 20px 60px rgba(0,0,0,.4); max-width:92vw; }
        .cam-hd { font-weight:800; font-size:14px; color:#0f172a; margin-bottom:10px; }
        .cam-vid { display:block; width:520px; max-width:86vw; max-height:58vh; background:#000; border-radius:10px; object-fit:contain; }
        .cam-act { display:flex; gap:10px; justify-content:center; margin-top:12px; }
        .cam-shot { border:none; background:#16a34a; color:#fff; font-weight:800; font-size:14px; border-radius:8px; padding:10px 24px; cursor:pointer; }
        .cam-cxl { border:1px solid #cbd5e1; background:#fff; color:#334155; font-weight:700; font-size:13px; border-radius:8px; padding:10px 18px; cursor:pointer; }
        .sig-canvas { border:1px solid #cbd5e1; border-radius:8px; background:#fff; touch-action:none; cursor:crosshair; display:block; max-width:86vw; }
        .qpr .sbox { min-height:38px; }
        .qpr .sbox .pimg { max-height:44px; }
        .qpr .sbox .pbtn { padding:3px 10px; font-size:10.5px; }
        @media print { .cp-top { display:none; } .cp-root { background:#fff; } .cp-body { margin:0; padding:0; } .cp-sheet { box-shadow:none; } }
      `}</style>

      <div className="cp-root">
        <div className="cp-top">
          <div className="cp-title">CA<span>PA</span> <span style={{ fontFamily:"'Barlow',sans-serif", fontSize:14, color:"#64748b", fontWeight:700 }}>· QPR</span></div>
          {view === "form" ? (<>
            <button style={btn} onClick={backToList}>← Pending CAPA</button>
            <button className="cp-save" onClick={save} disabled={saving}>{saving ? "Saving…" : (sid ? "💾 Update" : "💾 Save")}</button>
            {sStatus === "CLOSED" ? (
              <button style={{ ...btn, color:"#15803d", borderColor:"#bbf7d0", background:"#f0fdf4" }}
                      onClick={reopenCapa} disabled={saving} title="Reopen this CAPA — it will be removed from Historical Data">
                ✓ Closed · Reopen
              </button>
            ) : (
              <button style={{ ...btn, color:"#15803d", borderColor:"#86efac" }}
                      onClick={closeCapa} disabled={saving}
                      title="Close this CAPA — it will appear in Historical Data">
                ✓ Close CAPA
              </button>
            )}
            <button style={btn} onClick={() => window.print()}>🖨 Print</button>
            {sid && <span style={{ fontSize:12, color:"#64748b", fontWeight:700 }}>QPR #{sid}</span>}
          </>) : (
            <button style={btn} onClick={() => { setPrefill({}); setSid(null); setBdId(null); setSStatus("DRAFT"); setView("form"); }}>+ Blank QPR</button>
          )}
          {msg && <span className="cp-msg">{msg}</span>}
          <span className="app-user" style={{ marginLeft:"auto", fontSize:12, color:"#64748b", fontWeight:600 }}>{user?.username ? <>Signed in as <b>{user.username}</b></> : ""}</span>
        </div>

        {view === "list" ? (
          <div className="cp-body">
            {/* ── Filters — default CHAALU MAHINA.  Zone/Line/Machine ke
                   option Machine Master se aate hain. ── */}
            <div style={{ display:"flex", gap:12, flexWrap:"wrap", alignItems:"flex-end", marginBottom:16 }}>
              <div className="cp-fld">
                <label>Financial Year</label>
                <select className="cp-sel" value={fFy}
                        onChange={(e) => { setFFy(e.target.value); setFMonth(""); }}>
                  {fyOpts.map((f) => <option key={f} value={f}>{f}{f === fyOf(nowYm) ? " (current)" : ""}</option>)}
                </select>
              </div>
              <div className="cp-fld">
                <label>Month</label>
                <select className="cp-sel" value={fMonth} onChange={(e) => setFMonth(e.target.value)}>
                  <option value="">Full year</option>
                  {fyMonthList(fFy).map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
              <div className="cp-fld">
                <label>Zone</label>
                <select className="cp-sel" value={fZone}
                        onChange={(e) => { setFZone(e.target.value); setFLine(""); setFMno(""); }}>
                  <option value="">All Zones</option>
                  {zoneOpts.map((z) => <option key={z} value={z}>{z}</option>)}
                </select>
              </div>
              <div className="cp-fld">
                <label>Line</label>
                <select className="cp-sel" value={fLine} disabled={!fZone}
                        onChange={(e) => { setFLine(e.target.value); setFMno(""); }}>
                  <option value="">All Lines</option>
                  {lineOpts.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
              <div className="cp-fld">
                <label>Machine No</label>
                <select className="cp-sel" value={fMno} disabled={!fLine}
                        onChange={(e) => setFMno(e.target.value)}>
                  <option value="">All Machines</option>
                  {mnoOpts.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <button style={btn} onClick={clearFilters}>✕ Reset</button>
            </div>

            {/* Cards ab FILTER ke hisaab se — upar ki ginti aur neeche ki
                list hamesha ek hi baat kahein. */}
            <div style={{ display:"flex", gap:14, marginBottom:16, flexWrap:"wrap" }}>
              {tile("Total CAPA", shown.length, "#2563eb", "Breakdowns of 60 min or more")}
              {tile("Open", open, "#dc2626", "QPR not closed yet")}
              {tile("Closed", closed, "#16a34a", "QPR filled and closed")}
              {tile("All CAPA", rows.length, "#64748b", "Ignoring the filters above")}
            </div>

            {/* ── Zone-wise open / close ── */}
            {byZone.length > 0 && (
              <div style={{ background:"#fff", border:"1px solid #e2e8f0", borderRadius:14,
                            padding:"14px 18px", marginBottom:16 }}>
                <div style={{ fontSize:13.5, fontWeight:800, color:"#0f172a" }}>Zone-wise</div>
                <div style={{ fontSize:11, color:"#94a3b8", marginBottom:10 }}>
                  Open and closed CAPA per zone, for the current filter
                </div>
                <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
                  {byZone.map((z) => (
                    <div key={z.zone} style={{ border:"1px solid #e8edf3", borderRadius:11,
                                               padding:"9px 13px", minWidth:150, background:"#fafbfc" }}>
                      <div style={{ fontSize:11.5, fontWeight:800, color:"#334155",
                                    whiteSpace:"nowrap" }}>{z.zone}</div>
                      <div style={{ display:"flex", gap:14, marginTop:5, alignItems:"baseline" }}>
                        <span style={{ fontSize:11, color:"#94a3b8", fontWeight:700 }}>
                          Open <b style={{ fontSize:17, color: z.open ? "#dc2626" : "#94a3b8" }}>{z.open}</b>
                        </span>
                        <span style={{ fontSize:11, color:"#94a3b8", fontWeight:700 }}>
                          Closed <b style={{ fontSize:17, color: z.closed ? "#16a34a" : "#94a3b8" }}>{z.closed}</b>
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="cp-tbl-wrap">
              <table className="cp-tbl">
                <thead><tr>
                  <th>#</th><th>Date</th><th>Zone</th><th>Line</th><th>Machine No</th>
                  <th>Problem by Maintenance</th><th>Action Taken</th>
                  <th style={{ textAlign:"center" }}>Total Time (min)</th><th>Attended By</th>
                  <th style={{ textAlign:"center" }}>Status</th>
                  <th className="cp-stick" style={{ textAlign:"center" }}>QPR</th>
                </tr></thead>
                <tbody>
                  {loading && <tr><td colSpan={11} style={{ textAlign:"center", color:"#94a3b8", padding:30 }}>Loading…</td></tr>}
                  {!loading && shown.length === 0 && <tr><td colSpan={11} style={{ textAlign:"center", color:"#94a3b8", padding:30 }}>{rows.length ? "No CAPA matches these filters." : "No breakdowns of 60 min or more."}</td></tr>}
                  {!loading && shown.map((r, i) => (
                    <tr key={r.bd_id} onClick={() => fillQpr(r)} title="Click to open QPR">
                      <td>{i + 1}</td>
                      <td style={{ whiteSpace:"nowrap" }}>{r.bd_date}</td>
                      <td>{r.zone_name}</td>
                      <td>{r.line_name}</td>
                      <td className="cp-mno">{r.machine_no}</td>
                      <td><div className="cp-clamp">{r.problem_maintenance}</div></td>
                      <td><div className="cp-clamp">{r.action_taken}</div></td>
                      <td className="cp-dur">{r.duration_min}</td>
                      <td style={{ whiteSpace:"nowrap" }}>{r.attended_by}</td>
                      <td style={{ textAlign:"center" }}>
                        {isClosed(r)
                          ? <span className="cp-badge" style={{ background:"#dcfce7", color:"#166534" }}>Closed</span>
                          : r.sheet_id
                            ? <span className="cp-badge" style={{ background:"#fef3c7", color:"#b45309" }}>Draft</span>
                            : <span className="cp-badge" style={{ background:"#fee2e2", color:"#b91c1c" }}>Pending</span>}
                      </td>
                      <td className="cp-stick" style={{ textAlign:"center" }}>
                        {r.sheet_id
                          ? <button className="cp-open" onClick={(e) => { e.stopPropagation(); fillQpr(r); }}>Open</button>
                          : <button className="cp-fill" onClick={(e) => { e.stopPropagation(); fillQpr(r); }}>Fill QPR</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="cp-body">
            <div className="cp-scroll">
              <form ref={formRef} onSubmit={(e) => e.preventDefault()}>
                <div className="cp-sheet">
                  <div dangerouslySetInnerHTML={{ __html: CAPA_QPR_GRID }} />
                  <div className="cp-format">FORMAT NO.:- TBDI / QA / F / 006 &nbsp;&nbsp;&nbsp; REV. NO.:- 00 &nbsp;&nbsp;&nbsp; REV. DATE:- 20/03/2024</div>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>

      {cam && (
        <div className="cam-ov" onClick={() => setCam(null)}>
          <div className="cam-modal" onClick={(e) => e.stopPropagation()}>
            <div className="cam-hd">📷 Camera — take a photo</div>
            <video ref={videoRef} autoPlay playsInline muted className="cam-vid" />
            <div className="cam-act">
              <button className="cam-shot" onClick={capture}>📸 Capture</button>
              <button className="cam-cxl" onClick={() => setCam(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {sign && (
        <div className="cam-ov" onClick={() => setSign(null)}>
          <div className="cam-modal" onClick={(e) => e.stopPropagation()}>
            <div className="cam-hd">✍ Signature — sign with mouse or finger</div>
            <canvas ref={sigCanvasRef} width={520} height={190} className="sig-canvas"
                    onMouseDown={sigStart} onMouseMove={sigMove} onMouseUp={sigEnd} onMouseLeave={sigEnd}
                    onTouchStart={sigStart} onTouchMove={sigMove} onTouchEnd={sigEnd} />
            <div className="cam-act">
              <button className="cam-shot" onClick={saveSign}>✓ Save Sign</button>
              <button className="cam-cxl" onClick={clearSign}>Clear</button>
              <button className="cam-cxl" onClick={() => setSign(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
