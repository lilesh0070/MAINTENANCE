/* ───────────────────────────────────────────────────────────────────
 * MaintenanceCAPA.jsx  —  CAPA / Quality Problem Report (QPR)
 * ───────────────────────────────────────────────────────────────────
 * Every manual-slip breakdown that reaches the CAPA down-time limit
 * (maintenance_breakdown_data.mc_down_time_minutes; 55 min by default, an admin
 * can set a different limit for any one month) is a CAPA.  This page has two views:
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
import { useNavigate, useSearchParams } from "react-router-dom";
import { CAPA_QPR_GRID } from "./capaGrid";
import { CapaAttach } from "./capa/CapaAttach";
import { ojtBhara } from "./skill/OjtForm";

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
  // 5W1H + Interim -- user (2026-09-18): What? = wahi jo Reported Problem me,
  // Where? = machine_no, Who? = slip ka LINE LEADER NAME, Interim Containment
  // Action = slip ka action taken.
  f_18_4:  bd.problem_maintenance || bd.problem || "",   // What?
  f_18_8:  bd.machine_no       || "",                    // Where?
  f_19_8:  bd.line_leader_name || "",                    // Who?
  f_24_3:  bd.action_taken     || "",                    // Interim Containment Action
  f_44_11: bd.problem_maintenance || bd.problem || "",   // Fish bone ka ISSUE
});

// What? / ISSUE / Where? apne SROT ke peeche chalte hain -- srot badlo to ye
// bhi badlein, jab tak inhe alag se likh kar badla na gaya ho.
const MIRROR = { f_16_3: ["f_18_4", "f_44_11"], f_mno: ["f_18_8"] };

// `__html` wala object EK hi baar -- React 19 har render par naya object dekh
// kar innerHTML dobara likh deta hai (andar ki string nahi milata).  Yaani
// form khula ho aur koi bhi state badle (sandesh, Save ke baad, camera / sign
// ka parda) to poora QPR khaali ho jaata tha -- bhara hua sab, photo, sign.
// Wahi object rahe to React us div ko chhoota hi nahi.
const GRID_HTML = { __html: CAPA_QPR_GRID };

/* ANNEXURE-A ki row: sirf KAAM KI dikhao (user 2026-09-20: "isme row bahut
   jyada hain -- bas EK row default, baaki point ke hisaab se aati rahengi").
   Bhari hui row + bharne wale mode me EK khaali (usi me naya cause likha jaata
   hai); sirf-dekhne me bas bhari hui.  Value KABHI nahi mitate -- sirf
   `display` -- isliye cause hat-te hi row apne aap wapas aa jaati hai, aur
   Data Validation se aane wala hisaab jyon ka tyon chalta hai. */
function axRowsDikhao(sab, khaaliBhi) {
  let aakhri = -1;
  sab.forEach((el, i) => { if ((el.value || "").trim()) aakhri = i; });
  const kitni = Math.max(1, aakhri + 1 + (khaaliBhi ? 1 : 0));
  sab.forEach((el, i) => {
    const tr = el.closest("tr");
    if (tr) tr.style.display = i < kitni ? "" : "none";
  });
}

/** Annexure ke saare cause khaane (DV wale + apne se likhne wale), kram me. */
const axSabCause = (form) =>
  [...form.querySelectorAll("input.ax-cause, input.ax-cause-free")]
    .sort((a, b) => a.dataset.row - b.dataset.row);

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/* ── HADD (minute) -- default + MAHINE-WISE ──────────────────────────────
   User 2026-09-20: "jaise Breakdown QPR me hai ki kitne minute se upar ka
   breakdown aayega -- default 55 sab month ke liye, baad me badalna ho to
   kar sakte hain -- wahi CAPA me bhi, upar."  Server: GET/PUT/DELETE
   /api/capa-lb/min-config -> { min_down_time_min, months: {"2026-10": 60} }.
   Har breakdown APNE mahine ki hadd se parkha jaata hai (chhant server par
   hoti hai, isliye hadd badalte hi list dobara maangi jaati hai). */
const CAPA_MIN_DEFAULT = 55;

/* Server ka jawab -> { def, months }.  Na mile (purana backend) to 55 -- page
   phir bhi chalta rahe. */
function minCfgOf(c) {
  const def = Number.isFinite(Number(c?.min_down_time_min)) ? Number(c.min_down_time_min) : CAPA_MIN_DEFAULT;
  const months = {};
  for (const [k, v] of Object.entries(c?.months || {})) {
    if (Number.isFinite(Number(v))) months[k] = Number(v);
  }
  return { def, months };
}

/* "2026-09" -> "Sep 2026" */
const mahinaNaam = (ym) => { const [y, m] = String(ym).split("-"); return `${MONTHS[Number(m) - 1]} ${y}`; };

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

/* `viewId` diya ho to SIRF DEKHNE ka mode (Historical Data → CAPA (Closed) →
   "View", user 2026-09-19) -- wahi QPR form, par `<fieldset disabled>` me:
   kuch badal / save / close nahi hota; list, Save, Close, Print nahi; upar
   sirf "✕ Close" (`onClose`).  Bharne / badalne wale effect is mode me chalte
   hi nahi -- jo save hua tha wahi dikhe, jyon ka tyon. */
export default function MaintenanceCAPA({ viewId = null, onClose = null } = {}) {
  const viewOnly = viewId != null;
  const { token, theme, user, isAdmin, canWrite } = useAuth();
  /* User Access me CAPA ko "Read-only" diya ho to sirf DEKH sakta hai --
     bhar / save / close / attachment kuch nahi (user 2026-09-20).  `canWrite`
     admin ko hamesha true deta hai.  `sirfDekho` = ya to Historical ke andar
     khuli hai, ya permission read-only hai. */
  const likhSakta = canWrite("maintenance-capa");
  const sirfDekho = viewOnly || !likhSakta;
  const formRef = useRef(null);
  const videoRef = useRef(null);
  const [cam, setCam] = useState(null);   // {box} while the live-camera modal is open
  const [sign, setSign] = useState(null); // {box} while the signature-pad modal is open
  const sigCanvasRef = useRef(null);
  const drawing = useRef(false);
  const [view, setView]   = useState("list");      // "list" | "form"
  const [qs, setQs]       = useSearchParams();
  const nav = useNavigate();
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

  /* Hadd (minute): `null` = abhi server se aayi nahi.  `minDraft.k` = kis
     mahine/hadd ke liye likha gaya -- mahina badalte hi box apne aap us
     mahine ki hadd dikhata hai, bina kisi effect ke. */
  const [minCfg, setMinCfg]       = useState(null);
  const [minDraft, setMinDraft]   = useState({ k: "", t: "" });
  const [minSaving, setMinSaving] = useState(false);
  const [minKehna, setMinKehna]   = useState(null);   // { text, ok }

  /* CAPA ke aakhir me juda saamaan: DMC / PM ki KHAALI check sheet (points +
     format ki naqal) aur OJT form.  CAPA ke apne blob me `attachments` par
     save hota hai -- `capa/CapaAttach.jsx` dekho. */
  const [att, setAtt] = useState([]);
  const [sid, setSid] = useState(null);            // current saved-sheet id
  const [sStatus, setSStatus] = useState("DRAFT"); // khuli hui sheet ka status
  const [bdId, setBdId] = useState(null);          // current breakdown id
  const [prefill, setPrefill] = useState({});      // {cell: value} to apply on open
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [msgBad, setMsgBad] = useState(false);     // true = laal (mana / galti)
  const flash = (m, bad = false) => { setMsg(m); setMsgBad(bad); setTimeout(() => setMsg(""), 3000); };

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
  useEffect(() => { if (!viewOnly) loadPending(); }, [loadPending, viewOnly]);

  // Hadd -- sirf list wale mode me chahiye (sirf-dekhne me list hai hi nahi).
  useEffect(() => {
    if (viewOnly || !token) return;
    let chalu = true;
    api(`/min-config`)
      .then((c) => { if (chalu) setMinCfg(minCfgOf(c)); })
      .catch(() => { if (chalu) setMinCfg(minCfgOf(null)); });
    return () => { chalu = false; };
  }, [api, token, viewOnly]);

  // sirf-dekhne ka mode: wahi ek sheet kholo
  useEffect(() => {
    if (!viewOnly) return;
    let chalu = true;
    api(`/sheet/${viewId}`)
      .then((d) => {
        if (!chalu) return;
        setPrefill(d.data || {}); setSid(d.id);
        setSStatus((d.status || "DRAFT").toUpperCase());
        setView("form");
      })
      .catch((e) => { if (chalu) { setMsg("Could not open the CAPA: " + (e.message || "")); setMsgBad(true); } });
    return () => { chalu = false; };
  }, [viewOnly, viewId, api]);

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

  // sirf-dekhne me Data Validation ka Sr. No. (wo save nahi hota, `span` hai;
  // aam taur par neeche wala DV effect lagata hai jo is mode me chalta nahi)
  useEffect(() => {
    if (!viewOnly || view !== "form" || !formRef.current) return;
    const form = formRef.current;
    let n = 0;
    [...form.querySelectorAll(".dv-cause")]
      .sort((a, b) => a.dataset.row - b.dataset.row)
      .forEach((c) => {
        const sp = form.querySelector(`.dv-srno[data-row="${c.dataset.row}"]`);
        if (sp) sp.textContent = c.value.trim() ? String(++n) : "";
      });
    // Annexure: sirf bhari hui row (yahan kuch likha nahi ja sakta, isliye
    // khaali row bhi nahi)
    axRowsDikhao(axSabCause(form), false);
  }, [viewOnly, view, prefill]);

  // Data Validation: auto Sr. No. + row-by-row lock (next row typeable only after the
  // previous cause is filled) + compact on clear.  readOnly (not disabled) → clicks
  // always land instantly; render runs ONLY when a row's filled-state flips → typing is
  // zero-cost otherwise.
  // + (2026-09-19, user) Possible cause me DATA ANALYSIS (fish bone) ke "Machine"
  //   column (f_44_5 … f_50_5) ke point APNE AAP aate hain -- sabse upar, fish
  //   bone ke kram me, yahan badal nahi sakte (`dv-auto`, `data-src` = Machine
  //   ki row) -- aur unke neeche user khud bhi cause likh sakta hai.  Har row ek
  //   record hai (cause + method + result + remarks): Machine ka point judne /
  //   hatne par rows khisakti hain to method / result / remarks bhi saath.
  //   Machine khaana likhte waqt beech me khaali ho jaaye to row turant nahi
  //   hat-ti (blur par hi) -- warna uska method / result mit jaata.
  //   Rows badalne ke baad "dv-rebuilt" event -- Result / Annexure wala effect
  //   usi par apna hisaab dobara karta hai.
  useEffect(() => {
    if (view !== "form" || !formRef.current || viewOnly) return;   // sirf-dekhne me kuch na badle
    const form = formRef.current;
    const COLS = [4, 8, 10, 12];   // cause, verification, result, remarks
    const rows = [...form.querySelectorAll(".dv-cause")].map((c) => +c.dataset.row).sort((a, b) => a - b);
    const cell = {}, srno = {}, state = {};   // cache element refs + last-known filled state ONCE
    rows.forEach((r) => {
      cell[r] = {}; COLS.forEach((c) => { cell[r][c] = form.querySelector('[name="f_' + r + '_' + c + '"]'); });
      srno[r] = form.querySelector('.dv-srno[data-row="' + r + '"]');
    });
    const MACH = [44, 45, 46, 47, 48, 49, 50].map((r) => form.elements[`f_${r}_5`]).filter(Boolean);
    const machSet = new Set(MACH);
    const machRow = (el) => el.name.split("_")[1];
    const txt = (v) => String(v || "").replace(/\s+/g, " ").trim();
    const warn = (m) => { setMsg(m); setMsgBad(true); setTimeout(() => setMsg(""), 3000); };
    const filled = (r) => { const c = cell[r][4]; return !!(c && String(c.value).trim() !== ""); };
    const render = () => {                     // Sr.No + lock the rows below the first empty one
      let n = 0, prev = true, own = 0;
      rows.forEach((r) => {
        const f = filled(r);
        const sr = srno[r]; if (f) { n += 1; if (sr) sr.textContent = n; } else if (sr) sr.textContent = "";
        const auto = !!cell[r][4].dataset.src;  // Machine se aaya cause -- yahan nahi badalta
        // Apna (haath se likha) cause sirf EK (user 2026-09-19) -- wo bhar
        // gaya to aage ki khaali row band.  Baaki cause Machine se hi aate hain.
        const full = !auto && !f && own >= 1;
        const lock = !prev || full;
        COLS.forEach((c) => {
          const el = cell[r][c]; if (!el) return;
          const ro = lock || (c === 4 && auto);
          if (el.readOnly !== ro) el.readOnly = ro;
        });
        cell[r][4].classList.toggle("dv-auto", auto);
        cell[r][4].title = auto ? "Comes from Data Analysis → Machine"
                         : full ? "Only one own cause — the rest come from Data Analysis → Machine" : "";
        if (f && !auto) own += 1;
        state[r] = f; prev = prev && f;
      });
    };
    // Machine ke point upar (fish bone ke kram me, purana method / result
    // saath), phir user ke apne cause (khaali hat jaate hain = compact).
    // `keepEmpty` -- Machine khaana likhte waqt khaali hua ho to bhi row rakho.
    // `data-uid` = row ki pehchaan (Machine wali "m44", apni "u1"…) -- Annexure
    // ke score isi se apne cause ke saath chalte hain
    let uidSeq = 0;
    const rebuild = (keepEmpty) => {
      const cur = rows.map((r) => ({ src: cell[r][4].dataset.src || "", uid: cell[r][4].dataset.uid || "",
                                     v: COLS.map((c) => (cell[r][c] ? cell[r][c].value : "")) }));
      const bySrc = {};
      cur.forEach((x) => { if (x.src) bySrc[x.src] = x; });
      const list = [];
      MACH.forEach((m) => {
        const s = machRow(m), t = txt(m.value);
        if (!t && !(keepEmpty && bySrc[s])) return;
        // naya Machine point: method "Gemba", result "OK" pehle se (user
        // 2026-09-19) -- baad me badal sakte hain; purana ho to jo bhara hai wahi
        list.push({ src: s, uid: "m" + s, v: [t, ...(bySrc[s] ? bySrc[s].v.slice(1) : ["Gemba", "OK", ""])] });
      });
      cur.forEach((x) => { if (!x.src && txt(x.v[0])) list.push({ ...x, uid: x.uid || `u${++uidSeq}` }); });
      if (list.length > rows.length) {
        const lost = list.splice(rows.length).map((x) => txt(x.v[0]));
        warn(`Data Validation has only ${rows.length} rows — not added: ${lost.join(", ")}.`);
      }
      rows.forEach((r, i) => {
        const x = list[i] || { src: "", uid: "", v: ["", "", "", ""] };
        COLS.forEach((c, j) => { const el = cell[r][c]; if (el && el.value !== x.v[j]) el.value = x.v[j]; });
        cell[r][4].dataset.src = x.src;
        cell[r][4].dataset.uid = x.uid;
      });
      render();
      form.dispatchEvent(new CustomEvent("dv-rebuilt"));
    };
    const onInput = (e) => {        // re-render ONLY when this row's filled-state actually flips
      const t = e.target;
      // Machine likha -- bada akshar wala listener CAPTURE me pehle hi chal chuka
      if (machSet.has(t)) { rebuild(true); return; }
      if (!t.classList || !t.classList.contains("dv-cause")) return;
      const r = +t.dataset.row;
      if (filled(r) !== state[r]) {
        // apna cause abhi likhna shuru kiya: method "Gemba", result "NG" pehle
        // se (user 2026-09-19) -- khaali hon tabhi; NG kahin aur ho to NG nahi
        // (poori table me NG ek hi).  Result/Annexure wala effect isi input par
        // baad me `sync()` karta hai, to 2nd Why bhi turant.
        if (filled(r) && !cell[r][4].dataset.src) {
          const vm = cell[r][8], rs = cell[r][10];
          if (vm && !vm.value) vm.value = "Gemba";
          if (rs && !rs.value && !rows.some((x) => x !== r && cell[x][10] && cell[x][10].value === "NG")) rs.value = "NG";
        }
        render();
      }
    };
    const onChange = (e) => {
      const t = e.target;
      if (machSet.has(t) || (t.classList && t.classList.contains("dv-cause"))) rebuild(false);
    };
    // khula / save hua sheet: jis row ka cause kisi Machine point jaisa ho
    // (pehla bacha hua) wahi us point ki row maano
    const used = new Set();
    rows.forEach((r) => {
      const c = txt(cell[r][4].value);
      const m = c ? MACH.find((mm) => !used.has(mm) && txt(mm.value) === c) : null;
      if (m) used.add(m);
      cell[r][4].dataset.src = m ? machRow(m) : "";
      cell[r][4].dataset.uid = m ? "m" + machRow(m) : (c ? `u${++uidSeq}` : "");
    });
    form.addEventListener("input", onInput);
    form.addEventListener("change", onChange);
    rebuild(false);
    return () => { form.removeEventListener("input", onInput); form.removeEventListener("change", onChange); };
  }, [view, prefill, viewOnly]);

  // ── Data Validation: Verification method + Result -- sirf tay kiye naam ──
  // User (2026-09-19): dropdown nahi, likhne wala khaana hi -- par tay naam ke
  // siwa kuch likha to bharta hi nahi.
  //   Verification method (dv-vm, f_r_8): Gemba / Inspection / Statistical
  //     test / Experiment -- G / I / S / E dabao to poora naam.
  //   Result (dv-res, f_r_10): OK / NG -- O / N dabao.  NG poori table me EK
  //     hi baar.  NG wali row ka "Possible cause" -> ROOT CAUSE "For
  //     Occurrence" ka **2nd Why** (f_74_5; 1st Why nahi -- user ne sudhaara).
  //     MIRROR jaisa: 2nd Why khud alag likha ho to nahi chhedte, NG hata to
  //     (agar badla nahi tha) khaali.
  // (Pehle OK / NG galti se Verification method par laga tha -- user ne saaf
  // kiya ki OK / NG Result me, method me upar wale chaar naam.)
  // Naam bhar jaane ke baad usi naam ke akshar (poora shabd likhna) chup-chaap
  // chhod dete hain; paste / phone keyboard me poora naam ho to wahi.
  // ANNEXURE-A (ranking, user 2026-09-19):
  //   Possible Causes (ax-cause, row 138..145) = Data Validation ke cause
  //     (row 63..70) usi kram me -- wahan bharte hi yahan; yahan badal nahi
  //     sakte.  S.No. (ax-sno, saari 11 row) tabhi jab row me cause ho;
  //     row 9-11 ka cause (ax-cause-free) khula hai -- DV me sirf 8 row.
  //   Team member ke neeche score (ax-score) = sirf 1 / 3 / 9.
  //   Total Score (ax-total) = row ke bhare score ka GUNA.
  // JAGAH MAT BADLO: Data Validation wale effect ke BAAD -- khaali row hatne
  // (compact, `change` par) ke baad hi 2nd Why / Annexure milaana hai.
  useEffect(() => {
    if (view !== "form" || !formRef.current || viewOnly) return;   // sirf-dekhne me kuch na badle
    const form = formRef.current;
    const KINDS = {
      "dv-vm":  { opts: ["Gemba", "Inspection", "Statistical test", "Experiment"],
                  bad: "Verification method takes only Gemba, Inspection, Statistical test or Experiment." },
      "dv-res": { opts: ["OK", "NG"], bad: "Result takes only OK or NG." },
      "ax-score": { opts: ["1", "3", "9"], bad: "Score takes only 1, 3 or 9." },
    };
    const fields = [...form.querySelectorAll("input.dv-vm, input.dv-res, input.ax-score")];
    if (!fields.length) return;
    const res = fields.filter((f) => f.classList.contains("dv-res"));
    const kindOf = (t) => t.classList && Object.keys(KINDS).find((k) => t.classList.contains(k));
    const WHY2 = "f_74_5";                   // For Occurrence -> 2nd Why
    const causeOf = (f) => (form.elements[`f_${f.dataset.row}_4`]?.value || "").trim();
    const warn = (m) => { setMsg(m); setMsgBad(true); setTimeout(() => setMsg(""), 3000); };
    const norm = (s) => String(s || "").toUpperCase().replace(/\s+/g, " ").trim();
    // Annexure: DV ki n-vi row ka cause -> Annexure ki n-vi row (DV compact
    // rehta hai, isliye kram wahi -- S.No. bhi wahi)
    const dvRows = [...form.querySelectorAll(".dv-cause")].map((c) => +c.dataset.row).sort((a, b) => a - b);
    const axCause = [...form.querySelectorAll("input.ax-cause")].sort((a, b) => a.dataset.row - b.dataset.row);
    const axTotal = [...form.querySelectorAll("input.ax-total")];
    const axSno = [...form.querySelectorAll("input.ax-sno")].sort((a, b) => a.dataset.row - b.dataset.row);
    const axSab = axSabCause(form);          // DV wale + apne se likhne wale cause
    const put = (el, v) => { if (el && el.value !== v) el.value = v; };
    const SC = [6, 7, 8, 9, 10, 11, 12];     // Annexure: 7 team member ke score
    const dvEl = (i) => (dvRows[i] ? form.elements[`f_${dvRows[i]}_4`] : null);
    // khulte waqt: Annexure ki n-vi row = DV ki n-vi row (save bhi isi kram me hua tha)
    axCause.forEach((el, i) => { el.dataset.uid = dvEl(i)?.dataset.uid || ""; });
    let lastNg = "";                         // pichhli baar NG wali row ka cause
    const sync = () => {
      // Annexure: DV ki n-vi row ka cause -> n-vi row.  SCORE apne cause
      // (DV ka `data-uid`) ke saath chalte hain -- Machine ka naya point beech
      // me juda to neeche ke cause ke score bhi neeche khiskein, galat cause
      // ke aage na reh jaayein.  Cause likhte / badalte waqt uid wahi rehta hai.
      const old = axCause.map((el) => ({ uid: el.dataset.uid || "",
        s: SC.map((c) => form.elements[`f_${el.dataset.row}_${c}`]?.value || "") }));
      const byUid = {};
      old.forEach((o) => { if (o.uid) byUid[o.uid] = o.s; });
      axCause.forEach((el, i) => {
        const d = dvEl(i);
        const uid = d ? (d.dataset.uid || "") : "";
        put(el, d ? (d.value || "").replace(/\s+/g, " ").trim() : "");
        if (uid === old[i].uid) return;
        // naya uid: kahin aur se khiska ho to wahan ke score; row pehle bina
        // cause ki thi to jo score likhe the wahi; warna khaali
        const s = (uid && byUid[uid]) || (!old[i].uid && uid ? old[i].s : SC.map(() => ""));
        SC.forEach((c, j) => put(form.elements[`f_${el.dataset.row}_${c}`], s[j]));
        el.dataset.uid = uid;
      });
      let ng = "";
      fields.forEach((f) => { f.dataset.last = f.value; });
      res.forEach((f) => { if (f.value === "NG" && !ng) ng = causeOf(f); });
      const why = form.elements[WHY2];
      if (why && (why.value.trim() === "" || why.value.trim() === lastNg) && why.value !== ng) why.value = ng;
      lastNg = ng;
      // S.No. sirf jis row me cause ho (user: "serial number bhi uski ke
      // hisaab se") -- pehle 1-5 pakke chhape the, khaali row par bhi
      axSno.forEach((el, i) => {
        put(el, (form.elements[`f_${el.dataset.row}_3`]?.value || "").trim() ? String(i + 1) : "");
      });
      axTotal.forEach((el) => {
        const r = el.dataset.row;
        const nums = [6, 7, 8, 9, 10, 11, 12].map((c) => form.elements[`f_${r}_${c}`]?.value)
          .filter((v) => /^\d+$/.test(v || ""));
        put(el, nums.length ? String(nums.reduce((a, v) => a * Number(v), 1)) : "");
      });
      // bhari hui row + ek khaali (upar `axRowsDikhao` dekho)
      axRowsDikhao(axSab, true);
    };
    // `del` = mitaya gaya; `typed` = abhi daba ek akshar (bada), warna ""
    const fix = (f, kind, del, typed) => {
      const { opts, bad } = KINDS[kind];
      const prev = f.dataset.last || "";
      const exact = opts.find((o) => norm(o) === norm(f.value));
      const pehla = (c) => opts.find((o) => o[0].toUpperCase() === c);
      // `fresh` = poora khaana isi ek akshar se badla (khaali tha, ya select karke likha)
      const fresh = norm(f.value) === typed;
      let next;
      if (norm(f.value) === "") next = "";
      else if (exact) next = exact;
      else if (del) next = "";                               // aadha mitaya -> poora khaali
      else if (typed && !fresh && (/\s/.test(typed) || norm(prev).includes(typed))) next = prev;   // poora shabd likh rahe
      else if (typed && pehla(typed)) next = pehla(typed);
      else { next = prev; warn(bad); }
      if (kind === "dv-res" && next === "NG" && prev !== "NG") {
        const other = res.find((o) => o !== f && o.value === "NG");
        if (other) {
          next = prev;
          const sr = form.querySelector(`.dv-srno[data-row="${other.dataset.row}"]`)?.textContent || "";
          warn(`Only one NG is allowed in Data Validation${sr ? ` — Sr. No. ${sr} already has NG` : ""}.`);
        }
      }
      if (f.value !== next) f.value = next;
    };
    const onInput = (e) => {
      const t = e.target, kind = kindOf(t);
      if (kind) {
        if (e.isComposing) return;                            // phone ka keyboard: compositionend par
        const one = e.inputType === "insertText" && e.data && e.data.length === 1;
        fix(t, kind, /^delete/.test(e.inputType || ""), one ? e.data.toUpperCase() : "");
        sync();
      } else if (t.classList && (t.classList.contains("dv-cause") || t.classList.contains("ax-cause-free"))) sync();
    };
    const onCompEnd = (e) => {
      const kind = kindOf(e.target);
      if (!kind) return;
      fix(e.target, kind, false, String(e.data || "").trim().slice(0, 1).toUpperCase());
      sync();
    };
    const onChange = (e) => {
      const t = e.target, kind = kindOf(t);
      if (kind) { fix(t, kind, false, ""); sync(); }
      else if (t.classList && t.classList.contains("dv-cause")) sync();   // compact ke baad
    };
    form.addEventListener("input", onInput);
    form.addEventListener("compositionend", onCompEnd);
    form.addEventListener("change", onChange);
    form.addEventListener("dv-rebuilt", sync);   // Machine se DV ki rows badli
    sync();
    return () => {
      form.removeEventListener("input", onInput);
      form.removeEventListener("compositionend", onCompEnd);
      form.removeEventListener("change", onChange);
      form.removeEventListener("dv-rebuilt", sync);
    };
  }, [view, prefill, viewOnly]);

  /* Data Validation ka Result: "NG" LAAL dikhe (user 2026-09-20).
     Alag effect isliye ki ye SIRF-DEKHNE wale mode me bhi chale -- upar wala
     Result / Annexure wala effect wahan chalta hi nahi.  Rang CSS se
     (`.dv-res.ng`), yahan sirf class lagti-hat-ti hai. */
  useEffect(() => {
    if (view !== "form" || !formRef.current) return;
    const form = formRef.current;
    const rango = () => form.querySelectorAll("input.dv-res").forEach((el) => {
      el.classList.toggle("ng", el.value.trim().toUpperCase() === "NG");
    });
    rango();
    // `input` / `change` upar wale effect ke BAAD chalte hain (wo pehle juda
    // hai), yaani value theek hone ke baad rang lagta hai.
    form.addEventListener("input", rango);
    form.addEventListener("change", rango);
    form.addEventListener("dv-rebuilt", rango);     // Machine se DV ki rows badli
    return () => {
      form.removeEventListener("input", rango);
      form.removeEventListener("change", rango);
      form.removeEventListener("dv-rebuilt", rango);
    };
  }, [view, prefill]);

  // wire the photo upload / camera widgets (uncontrolled → data-URL into a hidden input)
  useEffect(() => {
    if (view !== "form" || !formRef.current || viewOnly) return;   // sirf-dekhne me kuch na badle
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
  }, [view, viewOnly]);

  // auto sentence-case: capitalize the first letter, and the first letter after a
  // full-stop / ! / ? (with or without a space) — rest stays as typed, comma doesn't
  // count.  Skips date / code / number fields (label says No./Code/Date/Qty/Model/…).
  useEffect(() => {
    if (view !== "form" || !formRef.current || viewOnly) return;   // sirf-dekhne me kuch na badle
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
    // CAPTURE me -- baaki sab listener (Machine → Data Validation → Annexure,
    // Reported Problem → What? …) isse PEHLE chalte to copy me chhota akshar
    // chala jaata (asli typing me har listener ke beech microtask bhi chal
    // jaata hai, isliye queueMicrotask se bhi nahi bachta).
    form.addEventListener("input", onInput, true);
    return () => form.removeEventListener("input", onInput, true);
  }, [view, viewOnly]);

  // Reported Problem likho to What? + ISSUE me wahi, MACHINE_NO likho to
  // Where? me wahi (MIRROR).  Copy tabhi badalti hai jab wo khaali ho ya ab
  // tak srot ke barabar ho -- user ne copy ko khud alag likha ho to use nahi
  // chhedte.
  // JAGAH MAT BADLO: prefill wale effect ke baad (taaki `last` bhare form se
  // bane) aur sentence-case ke baad (taaki copy me bada akshar bhi jaaye).
  useEffect(() => {
    if (view !== "form" || !formRef.current || viewOnly) return;   // sirf-dekhne me kuch na badle
    const form = formRef.current;
    const last = {};
    Object.keys(MIRROR).forEach((src) => { last[src] = form.elements[src]?.value || ""; });
    const onInput = (e) => {
      const src = e.target.name;
      if (!MIRROR[src]) return;
      MIRROR[src].forEach((name) => {
        const dst = form.elements[name];
        if (!dst) return;
        if (dst.value.trim() === "" || dst.value.trim() === last[src].trim()) dst.value = e.target.value;
      });
      last[src] = e.target.value;
    };
    form.addEventListener("input", onInput);
    return () => form.removeEventListener("input", onInput);
  }, [view, prefill, viewOnly]);

  // BADE KHAANE (ISSUE, For Occurrence, Countermeasure …): likhne ka dabba
  // sirf ek line ka hota hai aur khaane ke beech baitha rehta hai -- baaki
  // khaane me dabane par kuch nahi hota tha (user, 2026-09-18: "box bada hai
  // par andar likhne ki jagah chhoti").  Dabba khinch kar poora nahi karte,
  // warna text UPAR chala jaata aur user ko text BEECH me chahiye (ec59bbe).
  // Isliye poora khaana hi dabba: jis khaane me SIRF ek field hai (label
  // nahi) use `fbox` -- kahin bhi dabao to wahi field, caret aakhir me; focus
  // par poora khaana neela (CSS).
  useEffect(() => {
    if (view !== "form" || !formRef.current || viewOnly) return;   // sirf-dekhne me kuch na badle
    const form = formRef.current;
    form.querySelectorAll(".qpr td").forEach((td) => {
      const kids = td.children;
      if (kids.length !== 1 || !kids[0].matches("textarea.fta, input.fin")) return;
      const label = [...td.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!label) td.classList.add("fbox");
    });
    const onDown = (e) => {
      const td = e.target;                       // field par seedha dabaya -> browser khud
      if (!td.classList || !td.classList.contains("fbox")) return;
      const f = td.firstElementChild;
      e.preventDefault();
      f.focus({ preventScroll: true });          // khaana dikh hi raha hai -- page na khiske
      if (f.type !== "date") { const n = f.value.length; try { f.setSelectionRange(n, n); } catch { /* purana browser */ } }
    };
    form.addEventListener("mousedown", onDown);
    return () => form.removeEventListener("mousedown", onDown);
  }, [view, viewOnly]);

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

  /* Grid ke khaane FormData se, aur uske saath juda hua saamaan.
     `attachments` koi form ka khaana nahi -- seedha blob me jaata hai (usme
     check sheet ke points ki poori naqal hoti hai). */
  const collect = (attNow = att) => {
    const data = {};
    if (formRef.current) new FormData(formRef.current).forEach((v, k) => { if (String(v).trim() !== "") data[k] = v; });
    if (attNow && attNow.length) data.attachments = attNow;
    return data;
  };

  // khuli hui CAPA ka juda saamaan wapas state me
  useEffect(() => {
    setAtt(Array.isArray(prefill?.attachments) ? prefill.attachments : []);
  }, [prefill]);

  /* CAPA me bhari OJT Skill & Training → OJT ki list me bhi jaati hai (user
     2026-09-20: "CAPA + OJT list dono me").  Pehli baar POST, baad me usi
     record ka PUT -- isliye us record ki id (`ojt_id`) CAPA me sambhaal kar
     rakhte hain.  Na ja paye to CAPA ka save phir bhi hota hai; agli baar
     dobara koshish ho jaati hai. */
  const ojtSync = async (arr) => {
    let gadbad = false;
    const out = [];
    for (const a of arr) {
      if (a.k !== "ojt" || !ojtBhara(a.form)) { out.push(a); continue; }
      if (a.ojt_id && a.changed === false) { out.push(a); continue; }
      const body = { section: "ojt", title: (a.form.training_subjects || "").trim() || "OJT record", payload: a.form };
      try {
        const r = await fetch(a.ojt_id ? `/api/skill-training/${a.ojt_id}` : "/api/skill-training/", {
          method: a.ojt_id ? "PUT" : "POST",
          headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = await r.json().catch(() => ({}));
        out.push({ ...a, ojt_id: a.ojt_id || d.id || null, changed: false });
      } catch { gadbad = true; out.push(a); }
    }
    return { arr: out, gadbad };
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

  /* Historical Data → CAPA (Closed) → "✎ Edit" yahan `?sheet=<id>` ke saath
     bhejta hai.  CAPA ka form apne page ke ANDAR khulta hai (uska koi alag
     route nahi), isliye seedhe link se nahi khulta — ye effect wahi kaam
     karta hai: sheet load karke form dikha deta hai.

     Param uthate hi URL se HATA dete hain, warna:
       • "Back to list" dabane ke baad bhi param URL me pada rehta, aur
       • page refresh karte hi form dobara khul jaata — jo user ne chaha hi
         nahi tha.
     `khola` isliye ki React 18 ke strict mode me effect do baar chalta hai
     aur do fetch na chalein. */
  const khola = useRef(false);
  useEffect(() => {
    if (viewOnly) return;                  // Historical ke andar khula -- uska URL mat chhedo
    const sheet = qs.get("sheet");
    // `?bd=<breakdown id>` -- Breakdown QPR ki table ke "View" se aata hai:
    // seedha USI breakdown ki CAPA kholo (bhari ho to wahi, warna nayi jisme
    // machine / date / problem pehle se bhare hon).
    const bd = qs.get("bd");
    if ((!sheet && !bd) || khola.current) return;
    khola.current = true;
    setQs({}, { replace: true });
    (async () => {
      try {
        if (sheet) {
          const d = await api(`/sheet/${sheet}`);
          setPrefill(d.data || {}); setSid(d.id); setBdId(d.breakdown_id || null);
          setSStatus((d.status || "DRAFT").toUpperCase());
          setView("form");
          return;
        }
        // Pending ki list me se wahi breakdown dhoondo -- `fillQpr` dono
        // haalat (sheet hai / nahi) khud sambhal leta hai.
        const d = await api(`/pending`);
        const row = (d.rows || []).find((x) => String(x.bd_id) === String(bd));
        if (!row) { flash("That breakdown is not a CAPA.", true); return; }
        setRows(d.rows || []);        // list bhi taaza rahe (Back par wahi dikhe)
        await fillQpr(row);
      } catch (e) {
        flash("Could not open the CAPA: " + (e.message || ""));
      }
    })();
  }, [qs]);          // eslint-disable-line react-hooks/exhaustive-deps

  /* `status` ab hamesha bheja jaata hai.  Pehle nahi bhejte the, isliye backend
     har sheet ko DRAFT kar deta tha aur CAPA kabhi CLOSE ho hi nahi sakti thi —
     Historical ka "CAPA (Closed)" section hamesha khali rehta. */
  const saveWith = async (status) => {
    // Do taala: button to chhipa hi hai, par kisi aur raaste se yahan pahunche
    // to bhi read-only wale ka kuch save na ho.
    if (sirfDekho) { flash("You have view-only access to CAPA.", true); return false; }
    setSaving(true);
    try {
      // OJT pehle (uski id CAPA ke blob me jaani chahiye), phir CAPA
      const { arr, gadbad } = await ojtSync(att);
      setAtt(arr);
      const r = await api(`/sheet`, { method: "POST",
        body: JSON.stringify({ id: sid, breakdown_id: bdId, data: collect(arr), status }) });
      setSid(r.id); setSStatus(status);
      if (gadbad) flash(`Saved ✓ (QPR #${r.id}) — but the OJT record could not be sent to Skill & Training`, true);
      else flash(status === "CLOSED" ? `Closed ✓ (QPR #${r.id})` : `Saved ✓ (QPR #${r.id})`);
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
    if (!token || viewOnly) return;        // sirf-dekhne me list / filter hai hi nahi
    fetch("/api/machines/", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setMaster(Array.isArray(d) ? d : []))
      .catch(() => setMaster([]));
  }, [token, viewOnly]);

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

  /* ── Hadd (minute) — sirf admin badalta hai, baaki ko sirf dikhti hai ──
     Mahina chuna ho to SIRF us mahine ki; "Full year" par default (sab mahine
     jinki alag nahi rakhi).  Chhant server par hoti hai, isliye save ke baad
     list dobara maangte hain. */
  const minM    = fMonth || "";
  const minVal  = minCfg ? (minM ? (minCfg.months[minM] ?? minCfg.def) : minCfg.def) : null;
  const minApni = !!(minCfg && minM && minCfg.months[minM] != null);   // is mahine ki ALAG hadd?
  /* Dikhne wala bayan: "Full year" par agar is FY ke kisi mahine ki hadd alag
     rakhi ho to ek number likhna galat hoga -- tab mahine-wise kehte hain. */
  const minAlag = !!(minCfg && !minM
    && fyMonthList(fFy).some((m) => minCfg.months[m.value] != null));
  const minTile   = !minCfg ? "—"
    : minAlag ? "Breakdowns above each month's limit" : `Breakdowns of ${minVal} min or more`;
  const minKhaali = !minCfg ? "No breakdowns yet."
    : minAlag ? "No breakdown above any month's limit." : `No breakdowns of ${minVal} min or more.`;
  const minK    = `${minM}|${minVal}`;
  const minT    = minDraft.k === minK ? minDraft.t : String(minVal ?? "");
  const minBadla = minT.trim() !== String(minVal ?? "");

  // Jawab me poori hadd lautti hai -- wahi rakh lo, box apne aap naya dikhayega.
  const minLaga = (r, text) => {
    setMinCfg(minCfgOf(r)); setMinDraft({ k: "", t: "" });
    setMinKehna({ text, ok: true }); loadPending();
    setTimeout(() => setMinKehna(null), 4000);
  };
  const minSambhalo = async () => {
    if (minSaving) return;
    const n = Number(minT);
    if (minT.trim() === "" || !Number.isInteger(n) || n < 0) {
      setMinKehna({ text: "Enter whole minutes (0 or more)", ok: false });
      setTimeout(() => setMinKehna(null), 4000);
      return;
    }
    setMinSaving(true); setMinKehna(null);
    try {
      const r = await api(`/min-config`, { method: "PUT",
        body: JSON.stringify({ min_down_time_min: n, month: minM || null }) });
      minLaga(r, "Saved");
    } catch {
      setMinKehna({ text: "Could not save", ok: false });
      setTimeout(() => setMinKehna(null), 4000);
    } finally { setMinSaving(false); }
  };
  // Is mahine ki alag hadd hatao -- wapas default par.
  const minDefaultPar = async () => {
    if (minSaving || !minM) return;
    setMinSaving(true); setMinKehna(null);
    try {
      const r = await api(`/min-config/${minM}`, { method: "DELETE" });
      minLaga(r, "Back to default");
    } catch {
      setMinKehna({ text: "Could not reset", ok: false });
      setTimeout(() => setMinKehna(null), 4000);
    } finally { setMinSaving(false); }
  };

  /* Card dabao to neeche ki table me SIRF us card ki CAPA (user 2026-09-19).
       stat: "TOTAL" (filter wali sab, pehle jaisa) | "OPEN" | "CLOSED" |
             "ALL" (filter ke BINA sab -- card par yahi likha hai)
       zone: Zone-wise card ka zone ("" = koi nahi).  Zone card data se bante
             hain, isliye kal naya zone aaye to uska card bhi apne aap chalega.
     Wahi card dobara dabao = wapas Total.  Filter badla to "ALL" aur zone
     chhoot jaate hain (warna table filter maanti hi nahi / zone badal chuke). */
  const [pick, setPick] = useState({ stat: "TOTAL", zone: "" });
  useEffect(() => {
    setPick((p) => (p.stat === "ALL" || p.zone ? { stat: p.stat === "ALL" ? "TOTAL" : p.stat, zone: "" } : p));
  }, [fFy, fMonth, fZone, fLine, fMno]);
  const tableRows = useMemo(() => {
    let list = pick.stat === "ALL" ? rows : shown;
    if (pick.stat === "OPEN")   list = list.filter((r) => !isClosed(r));
    if (pick.stat === "CLOSED") list = list.filter((r) => isClosed(r));
    if (pick.zone) list = list.filter((r) => (r.zone_name || "—") === pick.zone);
    return list;
  }, [rows, shown, pick]);
  const pickLabel = pick.zone ? `${pick.zone} zone`
    : { OPEN: "Open CAPA", CLOSED: "Closed CAPA", ALL: "All CAPA (ignoring the filters)" }[pick.stat] || "";

  const tile = (label, val, color, sub, key) => {
    const on = pick.stat === key && !pick.zone;
    return (
      <div className="cp-tile" title="Click to see these CAPA in the table below"
           onClick={() => setPick(on || key === "TOTAL" ? { stat: "TOTAL", zone: "" } : { stat: key, zone: "" })}
           style={{ background: on ? `${color}0d` : "#fff", border:"1px solid #e2e8f0", borderTop:`3px solid ${color}`,
                    outline: on ? `2px solid ${color}` : "none", borderRadius:14, padding:"14px 18px", minWidth:150,
                    cursor:"pointer" }}>
        <div style={{ fontSize:11.5, fontWeight:800, letterSpacing:".05em", textTransform:"uppercase", color:"#64748b" }}>{label}</div>
        <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontSize:38, fontWeight:800, color, lineHeight:1 }}>{loading ? "…" : val}</div>
        <div style={{ fontSize:11, color:"#94a3b8", marginTop:3 }}>{sub}</div>
      </div>
    );
  };

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
        .cp-msg.bad { color:#dc2626; }
        .cp-body { max-width:1280px; margin:16px auto; padding:0 24px; }
        .cp-fld { display:flex; flex-direction:column; gap:5px; }
        .cp-fld label { font-size:10.5px; font-weight:800; letter-spacing:.05em;
                        text-transform:uppercase; color:#64748b; }
        .cp-sel { border:1.5px solid #cbd5e1; border-radius:9px; padding:8px 11px; font-size:13px;
                  font-weight:600; color:#0f172a; outline:none; background:#fff;
                  font-family:'Barlow',sans-serif; min-width:140px; }
        .cp-sel:focus { border-color:${theme.accent}; }
        .cp-sel:disabled { background:#f1f5f9; color:#94a3b8; cursor:not-allowed; }

        /* hadd (minute) -- filter ki line me SABSE DAAYEN (Breakdown QPR jaisa) */
        .cp-hadd { margin-left:auto; }
        .cp-hadd-row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
        .cp-hadd-in { min-width:0; width:92px; }
        .cp-hadd-ro { min-width:0; width:92px; background:#f8fafc; color:#0f172a;
                      border:1.5px solid #cbd5e1; border-radius:9px; padding:8px 11px;
                      font-size:13px; font-weight:700; }
        .cp-hadd-save { border:1px solid #1d4ed8; background:#2563eb; color:#fff; border-radius:9px;
                        padding:8px 16px; font-size:13px; font-weight:800; cursor:pointer;
                        font-family:'Barlow',sans-serif; }
        .cp-hadd-save:disabled { background:#93c5fd; border-color:#93c5fd; cursor:default; }
        .cp-hadd-reset { border:1px solid #cbd5e1; background:#fff; color:#475569; border-radius:9px;
                         padding:8px 12px; font-size:12px; font-weight:800; cursor:pointer;
                         font-family:'Barlow',sans-serif; white-space:nowrap; }
        .cp-hadd-reset:hover { border-color:#2563eb; color:#1d4ed8; }
        .cp-hadd-kehna { font-size:11.5px; font-weight:800; }
        /* phone par poori chaudai -- warna box aur Save alag-alag line me girte hain */
        @media (max-width:640px) { .cp-hadd { margin-left:0; width:100%; } .cp-hadd-in { flex:1; } }

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
        /* Label aur uska jawab EK line me (Reported Problem :- ____).  Pehle
           box width:100% tha, isliye jawab label ke NEECHE chala jaata tha.
           Lamba jawab label ke daayein hi lipatta hai. */
        .qpr .lblrow { display:flex; align-items:center; gap:6px; }
        .qpr .lblrow > b { flex:none; white-space:nowrap; }
        .qpr .lblrow > textarea.fta { flex:1 1 0; min-width:0; width:auto; height:auto; }
        /* td.fbox = poora khaana hi likhne ka dabba (JS lagata hai) -- kahin
           bhi dabao, likhna shuru; focus par poora khaana neela. */
        .qpr td.fbox { cursor:text; }
        .qpr td.fbox:focus-within:not(:has(> [readonly])) { background:#eff6ff; }
        /* Annexure-A: apne aap bharne wale khaane (cause / S.No. / Total) --
           badal nahi sakte, par dikhne me saadhe (DV ki band row jaise gray nahi) */
        .qpr input.fin.ax-auto[readonly] { background:transparent; cursor:default; }
        /* DV ka cause jo fish bone "Machine" se aaya -- yahan badal nahi sakte, par band row jaisa gray nahi */
        .qpr textarea.fta.dv-auto[readonly] { background:transparent; cursor:default; }
        .qpr input.ax-score, .qpr input.ax-total, .qpr input.ax-sno { text-align:center; }
        .qpr input.ax-sno { color:#111; }          /* pehle jaisa kaala -- DV ke Sr. No. jaisa */
        /* Data Validation ka Result: NG LAAL (user 2026-09-20).  Baaki khaane
           ke neele rang se alag -- NG hi wo row hai jispar aage ka kaam hai. */
        .qpr input.dv-res.ng { color:#dc2626; font-weight:800; }
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
        /* sirf-dekhne wala fieldset: apna koi kinara / jagah nahi; Upload /
           Camera / Sign / ✕ ke button dikhane ka matlab nahi */
        .cp-fs { border:0; padding:0; margin:0; min-width:0; }
        .cp-fs:disabled .pbtns, .cp-fs:disabled .pclr { display:none !important; }
        .cp-fs:disabled .qpr td { cursor:default; }
      `}</style>

      <div className="cp-root">
        <div className="cp-top">
          <div className="cp-title">CA<span>PA</span> <span style={{ fontFamily:"'Barlow',sans-serif", fontSize:14, color:"#64748b", fontWeight:700 }}>· QPR</span></div>
          {viewOnly ? (<>
            {/* sirf dekhna: na Save, na Close, na Print -- bas band karo */}
            <button style={btn} onClick={() => onClose && onClose()}>✕ Close</button>
            <span style={{ fontSize:12, fontWeight:800, color:"#be185d", background:"#fdf2f8",
                           border:"1px solid #fbcfe8", borderRadius:99, padding:"3px 10px" }}>View only</span>
            {sid && <span style={{ fontSize:12, color:"#64748b", fontWeight:700 }}>QPR #{sid}</span>}
          </>) : view === "form" ? (<>
            <button style={btn} onClick={backToList}>← Pending CAPA</button>
            {/* Read-only wale ko Save / Close / Reopen nahi -- sirf dekhna aur
                chhaapna.  Patti par saaf likh bhi dete hain, taaki "button
                kahan gaya" na poochhna pade. */}
            {!likhSakta && (
              <span style={{ fontSize:12, fontWeight:800, color:"#be185d", background:"#fdf2f8",
                             border:"1px solid #fbcfe8", borderRadius:99, padding:"3px 10px" }}>
                View only
              </span>
            )}
            {likhSakta && (
              <button className="cp-save" onClick={save} disabled={saving}>{saving ? "Saving…" : (sid ? "💾 Update" : "💾 Save")}</button>
            )}
            {!likhSakta ? null : sStatus === "CLOSED" ? (
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
          </>) : (<>
            {/* CAPA ab Breakdown page ka ek card hai -- wahin wapas jaane ka
                raasta, bilkul BD History / Breakdown QPR jaisa.  Sirf list
                me; form aur sirf-dekhne wale mode ke apne button hain. */}
            <button style={btn} onClick={() => nav("/maintenance-breakdown")}>← Back</button>
            {/* Nayi khaali QPR banana bhi "likhna" hai -- read-only ko nahi */}
            {likhSakta ? (
              <button className="cp-blank" style={btn} onClick={() => { setPrefill({}); setSid(null); setBdId(null); setSStatus("DRAFT"); setView("form"); }}>+ Blank QPR</button>
            ) : (
              <span style={{ fontSize:12, fontWeight:800, color:"#be185d", background:"#fdf2f8",
                             border:"1px solid #fbcfe8", borderRadius:99, padding:"3px 10px" }}>
                View only
              </span>
            )}
          </>)}
          {msg && <span className={`cp-msg${msgBad ? " bad" : ""}`}>{msg}</span>}
          <span className="app-user" style={{ marginLeft:"auto", fontSize:12, color:"#64748b", fontWeight:600 }}>{user?.username ? <>Signed in as <b>{user.username}</b></> : ""}</span>
        </div>

        {viewOnly && view !== "form" ? (
          /* sirf-dekhne me list kabhi nahi -- sheet aane tak bas intezaar */
          <div className="cp-body" style={{ textAlign:"center", color:"#94a3b8", padding:40, fontSize:13 }}>
            {msg ? "" : "Loading…"}
          </div>
        ) : view === "list" ? (
          <div className="cp-body">
            {/* ── Filters — default CHAALU MAHINA.  Zone/Line/Machine ke
                   option Machine Master se aate hain. ── */}
            <div className="cp-filters" style={{ display:"flex", gap:12, flexWrap:"wrap", alignItems:"flex-end", marginBottom:16 }}>
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

              {/* Hadd -- kitne minute (ya zyada) ka breakdown CAPA me aayega.
                  Sirf admin badalta hai; baaki ko sirf dikhti hai.  Mahina
                  chuna ho to SIRF us mahine ki, warna default (sab mahine
                  jinki alag nahi rakhi). */}
              <div className="cp-fld cp-hadd">
                <label>Down time ≥ (min) · {minM ? mahinaNaam(minM) : "Default"}</label>
                {isAdmin ? (
                  <div className="cp-hadd-row">
                    <input type="number" min={0} max={1440} step={1} className="cp-sel cp-hadd-in"
                           value={minT} disabled={minCfg === null}
                           onChange={(e) => setMinDraft({ k: minK, t: e.target.value })}
                           onKeyDown={(e) => { if (e.key === "Enter") minSambhalo(); }} />
                    <button type="button" className="cp-hadd-save" onClick={minSambhalo}
                            disabled={minSaving || minCfg === null || !minBadla}>
                      {minSaving ? "Saving…" : "Save"}
                    </button>
                    {/* Is mahine ki alag hadd rakhi ho to wapas default par laane
                        ka raasta -- warna ek baar alag rakhi hadd kabhi hatti hi nahi. */}
                    {minApni && (
                      <button type="button" className="cp-hadd-reset" onClick={minDefaultPar} disabled={minSaving}
                              title={`Remove the ${mahinaNaam(minM)} limit — use the default (${minCfg.def} min)`}>
                        Use default ({minCfg.def})
                      </button>
                    )}
                    {minKehna && (
                      <span className="cp-hadd-kehna" style={{ color: minKehna.ok ? "#15803d" : "#b91c1c" }}>
                        {minKehna.ok ? "✓ " : ""}{minKehna.text}
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="cp-hadd-ro" title="Set by admin">
                    {minVal === null ? "…" : `${minVal} min`}
                  </div>
                )}
              </div>
            </div>

            {/* Cards ab FILTER ke hisaab se — upar ki ginti aur neeche ki
                list hamesha ek hi baat kahein. */}
            {/* `cp-tiles`/`cp-tile` sirf NAAM hain -- style yahin inline hi
                rehti hai.  Phone par chaar card ek-ek karke aate the (har ek
                188px, aur do ke liye 390px chahiye jabki jagah 364px), isliye
                app me inhe do-do kiya jaata hai. */}
            <div className="cp-tiles" style={{ display:"flex", gap:14, marginBottom:16, flexWrap:"wrap" }}>
              {tile("Total CAPA", shown.length, "#2563eb", minTile, "TOTAL")}
              {tile("Open", open, "#dc2626", "QPR not closed yet", "OPEN")}
              {tile("Closed", closed, "#16a34a", "QPR filled and closed", "CLOSED")}
              {tile("All CAPA", rows.length, "#64748b", "Ignoring the filters above", "ALL")}
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
                    <div key={z.zone} title="Click to see this zone's CAPA in the table below"
                         onClick={() => setPick((p) => (p.zone === z.zone ? { stat: "TOTAL", zone: "" } : { stat: "TOTAL", zone: z.zone }))}
                         style={{ border:"1px solid #e8edf3", borderRadius:11, cursor:"pointer",
                                  padding:"9px 13px", minWidth:150,
                                  background: pick.zone === z.zone ? "#eef2ff" : "#fafbfc",
                                  outline: pick.zone === z.zone ? "2px solid #334155" : "none" }}>
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
            {/* card chuna ho to batao ki table me kya dikh raha hai + wapas sab */}
            {pickLabel && (
              <div style={{ display:"flex", alignItems:"center", gap:10, margin:"0 0 8px", fontSize:12.5,
                            fontWeight:700, color:"#334155", flexWrap:"wrap" }}>
                <span>Showing: <b>{pickLabel}</b> — {tableRows.length} CAPA</span>
                <button style={{ ...btn, padding:"4px 10px", fontSize:12 }}
                        onClick={() => setPick({ stat: "TOTAL", zone: "" })}>✕ Show all</button>
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
                  {!loading && tableRows.length === 0 && <tr><td colSpan={11} style={{ textAlign:"center", color:"#94a3b8", padding:30 }}>{rows.length ? "No CAPA matches these filters." : minKhaali}</td></tr>}
                  {!loading && tableRows.map((r, i) => (
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
                          ? <button className="cp-open" onClick={(e) => { e.stopPropagation(); fillQpr(r); }}>{likhSakta ? "Open" : "View"}</button>
                          /* read-only ko "Fill" kehna galat hoga -- wo bhar nahi sakta, sirf dekh sakta hai */
                          : <button className="cp-fill" onClick={(e) => { e.stopPropagation(); fillQpr(r); }}>{likhSakta ? "Fill QPR" : "View"}</button>}
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
                {/* sirf-dekhne me `disabled` -- andar ka koi khaana / button chalta hi nahi */}
                <fieldset className="cp-fs" disabled={sirfDekho}>
                  <div className="cp-sheet">
                    <div dangerouslySetInnerHTML={GRID_HTML} />
                    <div className="cp-format">FORMAT NO.:- TBDI / QA / F / 006 &nbsp;&nbsp;&nbsp; REV. NO.:- 00 &nbsp;&nbsp;&nbsp; REV. DATE:- 20/03/2024</div>
                  </div>
                </fieldset>
                {/* Juda hua saamaan fieldset ke BAAHAR -- sirf-dekhne wale mode
                    me bhi "View" ka button chalna chahiye (fieldset disabled
                    andar ke har button ko band kar deta hai). */}
                <CapaAttach
                  value={att}
                  /* seedha value ya "purane se naya" wala function -- dono chalte
                     hain (do row ek saath dabne par dono nishaan lagein) */
                  onChange={(next) => setAtt((prev) => (typeof next === "function" ? next(prev) : next))}
                  token={token}
                  viewOnly={sirfDekho}
                  accent={theme?.accent}
                  soft={theme?.soft}
                  getMachine={() => {
                    const el = formRef.current?.elements;
                    return { machine_no: (el?.f_mno?.value || "").trim(),
                             machine_name: (el?.f_mname?.value || "").trim(),
                             zone: (el?.f_zone?.value || "").trim(),
                             line: (el?.f_line?.value || "").trim() };
                  }}
                />
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
