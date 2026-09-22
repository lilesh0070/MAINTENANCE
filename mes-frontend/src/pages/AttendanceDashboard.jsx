/* ───────────────────────────────────────────────────────────────────
 * AttendanceDashboard.jsx — "Attendance Dashboard" (sidebar, Maintenance)
 * ───────────────────────────────────────────────────────────────────
 * Kaun kis shift me hai -- user ki Excel wali format (2026-09-22):
 *     G SHIFT / A SHIFT / B SHIFT / WEEK OFF / LEAVE / WORK FROM HOME
 * har kataar me logon ke card: photo, naam, emp code, designation, contact.
 *
 *   • Upar "Add Member" (aur har kataar ka "+") -> daayein side panel:
 *     photo, naam, emp code, designation, contact, date of joining, kataar.
 *   • Card ghaseet kar doosri kataar me (ya usi me aage-peeche).
 *       mouse  : pakad kar kheencho
 *       touch  : card ko thoda dabaye rakho (ya ⠿ pakdo), fir kheencho --
 *                seedha ungli chalane par page scroll hota hai, card nahi
 *   • Tareekh badal kar pichhla board dekho (sirf dekhna) ya aage ke din
 *     ki planning karo.  "Aage chalta hai" niyam backend me hai:
 *     Phase2/routers/attendance.py (upar ki tippani).
 *
 * HTML5 drag-drop (`draggable`) JAAN-BOOJH KAR NAHI: wo touch par chalta
 * hi nahi, aur ye page app (phone / tablet / TV) me bhi khulta hai.
 * Isliye apna pointer-events wala ghaseetna.
 *
 * ⚠ Ghaseetne ke dauraan pakda hua card DOM se HATAANA NAHI, sirf chhupana
 *   (`att-away`).  Touch ke saare touchmove usi element par aate hain jahan
 *   ungli padi thi -- wo DOM se hata to event board tak pahunchte hi nahi,
 *   preventDefault nahi ho paata, page scroll hone lagta hai aur browser
 *   pointercancel karke ghaseetna tod deta hai.
 *
 * App me koi lagataar (infinite) animation nahi, aur panel ke peeche blur
 * nahi -- TV par ANR ki wajah yahi dono the (v1.4.103).
 *
 * Header ki class `bd-*` (Breakdown wali) -- responsive.css ke phone /
 * tablet / TV header niyam inhi par hain.
 *
 * Routing: /maintenance-attendance · Access: "maintenance-attendance"
 * (likhna = full).  Backend: /api/attendance
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "../context/AuthContext";
import { api } from "../api/client";
import { isNativeApp } from "../constants/apiBase";

const NATIVE = isNativeApp();
const PAGE_KEY = "maintenance-attendance";
// ungli wala device (phone / tablet) -- sirf samjhaane wali line ke liye
const COARSE = typeof window !== "undefined" && !!window.matchMedia
  && window.matchMedia("(pointer: coarse)").matches;
const REFRESH_MS = 60_000;          // doosra supervisor badle to TV / doosre phone par bhi aaye

/* c = rang, d = gehra (gradient ka doosra sira), soft = halka pichhwada.
   `d` alag likha hai, CSS `color-mix()` se nahi: plant TV ki WebView purani
   hai, aur `var()` wali declaration me anjaan function ho to browser pichhli
   line par wapas NAHI jaata -- poori property khaali (safed par safed likhawat). */
const SLOTS = [
  { key: "G",     label: "G Shift",        badge: "G",   c: "#2563eb", d: "#1e3a8a", soft: "#eff6ff" },
  { key: "A",     label: "A Shift",        badge: "A",   c: "#059669", d: "#065f46", soft: "#ecfdf5" },
  { key: "B",     label: "B Shift",        badge: "B",   c: "#d97706", d: "#92400e", soft: "#fffbeb" },
  { key: "WO",    label: "Week Off",       badge: "WO",  c: "#64748b", d: "#334155", soft: "#f1f5f9" },
  { key: "LEAVE", label: "Leave",          badge: "L",   c: "#dc2626", d: "#991b1b", soft: "#fef2f2" },
  { key: "WFH",   label: "Work From Home", badge: "WFH", c: "#7c3aed", d: "#5b21b6", soft: "#f5f3ff", short: "WFH" },
];
const vars = (s) => ({ "--c": s.c, "--d": s.d, "--soft": s.soft });
const SLOT = Object.fromEntries(SLOTS.map((s) => [s.key, s]));
const ON_DUTY = ["G", "A", "B"];

/* ── chhote helper ─────────────────────────────────────────────────── */
const pad = (n) => String(n).padStart(2, "0");
const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dateOf = (s) => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, m - 1, d); };
const shiftDay = (s, n) => { const d = dateOf(s); d.setDate(d.getDate() + n); return isoOf(d); };
const longDay = (s) => dateOf(s).toLocaleDateString("en-GB",
  { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const shortDay = (s) => dateOf(s).toLocaleDateString("en-GB",
  { day: "2-digit", month: "short", year: "numeric" });
const whenText = (ts) => {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("en-GB",
    { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit", hour12: true });
};
const initials = (name) => (name || "").replace(/^(mr|mrs|ms|dr)\.?\s+/i, "").trim()
  .split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";
const telHref = (c) => `tel:${String(c).replace(/[^0-9+]/g, "")}`;

function tenure(doj, onDay) {
  if (!doj) return "";
  const a = dateOf(doj), b = dateOf(onDay);
  let m = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  if (b.getDate() < a.getDate()) m -= 1;
  if (b < a) return "Not joined yet";
  if (m < 1) return "Less than a month";
  const y = Math.floor(m / 12), mm = m % 12;
  return [y ? `${y} yr${y > 1 ? "s" : ""}` : "", mm ? `${mm} mo${mm > 1 ? "s" : ""}` : ""]
    .filter(Boolean).join(" ");
}

// Kataar -> log (pos ke kram me).  Server kram me hi deta hai; yahan dobara
// isliye ki ghaseetne ke baad hum khud pos badalte hain.
function groupLanes(people) {
  const L = Object.fromEntries(SLOTS.map((s) => [s.key, []]));
  for (const p of people) (L[p.slot] || L.G).push(p);
  for (const k of Object.keys(L)) {
    L[k].sort((a, b) => a.pos - b.pos || a.name.localeCompare(b.name) || a.id - b.id);
  }
  return L;
}

/* Photo: beech ka chaukor tukda, 240px JPEG (~15 KB).  Khadi photo me chehra
   upar hota hai, isliye wahan tukda upar ki taraf se (20%) -- beech se kaatne
   par sir kat jaata tha. */
function squarePhoto(file) {
  return new Promise((resolve, reject) => {
    if (!file) { reject(new Error("No file chosen.")); return; }
    if (file.type && !/^image\//.test(file.type)) { reject(new Error("Please choose an image file.")); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const S = 240, w = img.naturalWidth, h = img.naturalHeight, s = Math.min(w, h);
        const cv = document.createElement("canvas");
        cv.width = S; cv.height = S;
        const g = cv.getContext("2d");
        g.fillStyle = "#ffffff";                       // PNG ka khaali hissa kaala na ho
        g.fillRect(0, 0, S, S);
        g.drawImage(img, (w - s) / 2, h > w ? (h - s) * 0.2 : (h - s) / 2, s, s, 0, 0, S, S);
        resolve(cv.toDataURL("image/jpeg", 0.85));
      } catch (e) {
        reject(e);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("This image could not be read.")); };
    img.src = url;
  });
}

/* Pointer ke neeche kaunsi kataar, aur us kataar me kis jagah (index).
   Index = pakde hue card ke BINA us kataar me pointer se pehle kitne card.
   Card padhne ke kram me hain (baayein->daayein, fir agli line), isliye
   "pehle hai?" pehle haan-haan fir naa-naa hota hai -- pehla "naa" mila to ruk.
   `skip` = pakda hua card: React ne use abhi chhupaya na ho (tez chhodne par
   frame se pehle hi pointerup) to bhi ginti me na aaye. */
function hitLane(x, y, skip) {
  const el = document.elementFromPoint(x, y);
  const lane = el && el.closest ? el.closest("[data-att-lane]") : null;
  if (!lane) return null;
  const slot = lane.getAttribute("data-att-lane");
  const cards = lane.querySelectorAll("[data-att-card]");
  if (el.closest("[data-att-head]")) {                                       // kataar ke naam par = aakhir me
    let n = 0;
    for (const c of cards) if (c.getAttribute("data-att-id") !== String(skip)) n += 1;
    return { slot, index: n };
  }
  let index = 0;
  for (const c of cards) {
    if (c.getAttribute("data-att-id") === String(skip)) continue;
    const r = c.getBoundingClientRect();
    const pehle = y > r.bottom ? true : y < r.top ? false : x > r.left + r.width / 2;
    if (!pehle) break;
    index += 1;
  }
  return { slot, index };
}

function scrollerOf(el) {
  for (let n = el ? el.parentElement : null; n && n !== document.body; n = n.parentElement) {
    const oy = getComputedStyle(n).overflowY;
    if ((oy === "auto" || oy === "scroll") && n.scrollHeight > n.clientHeight + 4) return n;
  }
  return document.scrollingElement || document.documentElement;
}

const ghostXf = (st) => `translate3d(${st.x - st.offX}px, ${st.y - st.offY}px, 0) rotate(2deg) scale(1.04)`;

/* ── chhote icon (SVG -- TV ke font me emoji / braille bharose ke nahi) ── */
const IcoPhone = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" />
  </svg>
);
const IcoGrip = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <circle cx="9" cy="5" r="1.8" /><circle cx="15" cy="5" r="1.8" />
    <circle cx="9" cy="12" r="1.8" /><circle cx="15" cy="12" r="1.8" />
    <circle cx="9" cy="19" r="1.8" /><circle cx="15" cy="19" r="1.8" />
  </svg>
);
const IcoCal = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
  </svg>
);
const IcoCam = () => (
  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
    <circle cx="12" cy="13" r="4" />
  </svg>
);

/* ═══════════════════════════════════════════════════════════════════ */
export default function AttendanceDashboard() {
  const { token, user, theme, canWrite } = useAuth();
  const mayWrite = canWrite(PAGE_KEY);

  const [day, setDay]           = useState(null);    // null = aaj (server ka) -- raat 12 baad khud agla din
  const [board, setBoard]       = useState(null);
  const [err, setErr]           = useState("");
  const [reloadKey, setReload]  = useState(0);
  const [photoMap, setPhotoMap] = useState({});      // id -> {ver, url}
  const [q, setQ]               = useState("");
  const [panel, setPanel]       = useState(null);    // {mode:"add", slot} | {mode:"edit"|"view", id}
  const [drag, setDrag]         = useState(null);    // {id, slot, index, w, h}
  const [toast, setToast]       = useState(null);    // {text, kind}

  const boardRef   = useRef(null);
  const boardEl    = useRef(null);
  const reqNo      = useRef(0);
  const localVer   = useRef(0);                      // apna badlav -- beech ka purana GET na chadhe
  const saveQ      = useRef(Promise.resolve());
  const saveNo     = useRef(0);
  const saving     = useRef(0);
  const tried      = useRef(new Set());
  const dragRef    = useRef(null);
  const ghostRef   = useRef(null);
  const startRef   = useRef(null);
  const dropRef    = useRef(null);
  const clickBlock = useRef(0);
  const toastT     = useRef(0);

  useEffect(() => { boardRef.current = board; }, [board]);

  const editable = !!(board && board.editable && mayWrite);
  const wantDay = day || board?.today || null;
  const loading = !board || (day === null ? board.day !== board.today : board.day !== day);

  const showToast = useCallback((text, kind = "ok") => {
    clearTimeout(toastT.current);
    setToast({ text, kind });
    toastT.current = setTimeout(() => setToast(null), kind === "err" ? 5000 : 2600);
  }, []);
  useEffect(() => () => clearTimeout(toastT.current), []);

  const reload = useCallback(() => setReload((k) => k + 1), []);

  /* ── board laao ── */
  useEffect(() => {
    let off = false;
    const n = ++reqNo.current;
    const v = localVer.current;
    api.get(`/api/attendance/board${day ? `?day=${day}` : ""}`, token)
      .then((b) => {
        if (off || n !== reqNo.current) return;
        // usi din ka taaza-karna, aur beech me apna ghaseetna hua -- ye jawab
        // purana hai, chhodo (save ka jawab sahi haal laayega).  Doosre din ka
        // jawab hamesha lagao, warna din badalte waqt ghaseetne par page atka rehta.
        if (v !== localVer.current && boardRef.current && boardRef.current.day === b.day) return;
        setBoard(b);
        setErr("");
      })
      .catch((e) => { if (!off && n === reqNo.current) setErr(e.message || "Could not load the board."); });
    return () => { off = true; };
  }, [day, token, reloadKey]);

  /* ── har minute taaza (TV / doosra phone) -- ghaseette ya save karte waqt nahi ── */
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== "visible" || dragRef.current || saving.current) return;
      setReload((k) => k + 1);
    };
    const t = setInterval(tick, REFRESH_MS);
    const vis = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", vis); };
  }, []);

  /* ── photo: sirf jinki nayi / badli hai (photo_ver) ──
     `tried` me "id:ver" jo ek baar maang liya -- mile ya na mile, dobara
     nahi (warna server par na mili photo har render par maangi jaati).
     Network toota ho to hi wapas hatate hain -- agle taaze board par phir. */
  useEffect(() => {
    if (!board) return;
    const need = board.people.filter((p) => p.photo_ver && !tried.current.has(`${p.id}:${p.photo_ver}`));
    for (const p of need) tried.current.add(`${p.id}:${p.photo_ver}`);
    for (let i = 0; i < need.length; i += 60) {
      const chunk = need.slice(i, i + 60);
      api.get(`/api/attendance/photos?ids=${chunk.map((p) => p.id).join(",")}`, token)
        .then((got) => setPhotoMap((m) => {
          let nm = m;
          for (const p of chunk) {
            if (!got || !got[p.id]) continue;
            if (nm === m) nm = { ...m };
            nm[p.id] = { ver: p.photo_ver, url: got[p.id] };
          }
          return nm;
        }))
        .catch(() => { for (const p of chunk) tried.current.delete(`${p.id}:${p.photo_ver}`); });
    }
  }, [board, token]);

  const photoOf = (p) => (p && p.photo_ver ? photoMap[p.id]?.url || null : null);

  const lanes = useMemo(() => groupLanes(board?.people || []), [board]);

  // ghaseette waqt: pakda card apni jagah chhupa (att-away), nayi jagah khaali khaana
  const view = useMemo(() => {
    const V = {};
    for (const s of SLOTS) V[s.key] = lanes[s.key].map((p) => ({ p, away: !!drag && p.id === drag.id }));
    if (drag && V[drag.slot]) {
      const t = V[drag.slot];
      let seen = 0, at = t.length;
      for (let i = 0; i < t.length; i += 1) {
        if (t[i].away) continue;
        if (seen === drag.index) { at = i; break; }
        seen += 1;
      }
      t.splice(at, 0, { hole: true });
    }
    return V;
  }, [lanes, drag]);

  const ql = q.trim().toLowerCase();
  const match = (p) => !ql || [p.name, p.emp_code, p.designation, p.contact]
    .some((v) => (v || "").toLowerCase().includes(ql));
  const hits = ql ? (board?.people || []).filter(match).length : 0;

  const counts = useMemo(() => {
    const c = Object.fromEntries(SLOTS.map((s) => [s.key, lanes[s.key].length]));
    c.total = (board?.people || []).length;
    c.duty = ON_DUTY.reduce((a, k) => a + c[k], 0);
    return c;
  }, [lanes, board]);

  const designations = useMemo(() => [...new Set((board?.people || [])
    .map((p) => p.designation).filter(Boolean))].sort(), [board]);

  /* ── ghaseetne ke baad: turant screen par, fir server (kram se, ek-ek karke) ── */
  const saveLanes = useCallback((d, lanesIds) => {
    saving.current += 1;
    const my = ++saveNo.current;
    saveQ.current = saveQ.current.then(async () => {
      try {
        const nb = await api.put("/api/attendance/board", { day: d, lanes: lanesIds }, token);
        if (my === saveNo.current && boardRef.current && boardRef.current.day === nb.day) {
          localVer.current += 1;
          setBoard(nb);
        }
      } catch (e) {
        showToast(e.message || "Could not save the change.", "err");
        localVer.current += 1;
        setReload((k) => k + 1);
      } finally {
        saving.current -= 1;
      }
    });
  }, [token, showToast]);

  const dropTo = useCallback((id, slot, index) => {
    const b = boardRef.current;
    if (!b || !SLOT[slot]) return;
    const person = b.people.find((p) => p.id === id);
    if (!person) return;
    const L = groupLanes(b.people);
    const from = L[person.slot] ? person.slot : "G";
    const before = L[from].map((p) => p.id);
    const src = before.filter((x) => x !== id);
    const dst = from === slot ? src.slice() : L[slot].map((p) => p.id);
    dst.splice(Math.min(Math.max(index, 0), dst.length), 0, id);
    if (from === slot && dst.join() === before.join()) return;          // wahin chhoda
    const lanesIds = from === slot ? { [slot]: dst } : { [from]: src, [slot]: dst };
    localVer.current += 1;
    setBoard((ob) => ob && ({
      ...ob,
      people: ob.people.map((p) => {
        for (const [k, ids] of Object.entries(lanesIds)) {
          const i = ids.indexOf(p.id);
          if (i >= 0) return { ...p, slot: k, pos: i };
        }
        return p;
      }),
    }));
    saveLanes(b.day, lanesIds);
    if (from !== slot) showToast(`${person.name} → ${SLOT[slot].label}`);
  }, [saveLanes, showToast]);

  useEffect(() => { dropRef.current = dropTo; }, [dropTo]);

  /* ── ghaseetna (pointer events) ── */
  useEffect(() => {
    if (!editable) { startRef.current = null; return undefined; }
    const el = boardEl.current;
    let raf = 0;

    const place = () => {                 // ek frame: ghost, auto-scroll, nishana
      raf = 0;
      const st = dragRef.current;
      if (!st || !st.active) return;
      if (ghostRef.current) ghostRef.current.style.transform = ghostXf(st);
      const sc = st.scroller;
      const doc = sc === document.scrollingElement || sc === document.documentElement;
      const top = doc ? 0 : sc.getBoundingClientRect().top;
      const bottom = doc ? window.innerHeight : sc.getBoundingClientRect().bottom;
      const EDGE = 72;
      let dy = 0;
      if (st.y < top + EDGE) dy = -Math.ceil((top + EDGE - st.y) / 5);
      else if (st.y > bottom - EDGE) dy = Math.ceil((st.y - (bottom - EDGE)) / 5);
      let chala = false;
      if (dy) { const pehle = sc.scrollTop; sc.scrollTop += dy; chala = sc.scrollTop !== pehle; }
      const hit = hitLane(st.x, st.y, st.id);
      if (hit && (hit.slot !== st.slot || hit.index !== st.index)) {
        st.slot = hit.slot;
        st.index = hit.index;
        setDrag((d) => (d ? { ...d, slot: hit.slot, index: hit.index } : d));
      }
      // kinare par ungli ruki ho to bhi scroll chalta rahe -- par page ke sire par
      // pahunch kar ruk jao (warna har frame bekaar chakkar, jab tak ungli kinare par)
      if (chala) raf = requestAnimationFrame(place);
    };
    const kick = () => { if (!raf) raf = requestAnimationFrame(place); };

    const begin = (st) => {
      st.active = true;
      clearTimeout(st.timer);
      st.scroller = scrollerOf(el);
      st.slot = st.from;
      st.index = st.fromIndex;
      document.body.classList.add("att-dragging");
      if (st.type !== "mouse" && navigator.vibrate) { try { navigator.vibrate(12); } catch { /* koi baat nahi */ } }
      setDrag({ id: st.id, slot: st.from, index: st.fromIndex, w: st.w, h: st.h });
      kick();
    };

    const finish = (drop) => {
      const st = dragRef.current;
      dragRef.current = null;
      if (!st) return;
      clearTimeout(st.timer);
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      if (!st.active) return;
      document.body.classList.remove("att-dragging");
      clickBlock.current = performance.now();
      if (drop) {
        // aakhri frame ke baad bhi pointer chala ho sakta hai -- chhodne ki jagah abhi naapo
        // (kataar ke bahar chhoda to aakhri sahi nishana hi)
        const hit = hitLane(st.x, st.y, st.id);
        if (hit) { st.slot = hit.slot; st.index = hit.index; }
      }
      setDrag(null);
      if (drop && dropRef.current) dropRef.current(st.id, st.slot, st.index);
    };

    startRef.current = (e, p, index) => {
      if (e.button > 0 || dragRef.current) return;         // right-click / doosri ungli
      const card = e.currentTarget;
      const r = card.getBoundingClientRect();
      const handle = !!(e.target.closest && e.target.closest("[data-att-grip]"));
      const st = {
        id: p.id, from: p.slot, fromIndex: index, pid: e.pointerId, type: e.pointerType || "mouse",
        handle, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY,
        offX: e.clientX - r.left, offY: e.clientY - r.top, w: r.width, h: r.height,
        active: false, timer: 0,
      };
      dragRef.current = st;
      if (st.type !== "mouse" && handle) begin(st);        // ⠿ pakda = turant
      else if (st.type !== "mouse") {
        st.timer = setTimeout(() => { if (dragRef.current === st && !st.active) begin(st); }, 330);
      }
    };

    const onMove = (e) => {
      const st = dragRef.current;
      if (!st || e.pointerId !== st.pid) return;
      st.x = e.clientX;
      st.y = e.clientY;
      if (!st.active) {
        const moved = Math.hypot(st.x - st.x0, st.y - st.y0);
        if (st.type === "mouse") { if (moved >= 5) begin(st); }
        else if (moved > 10) finish(false);                 // ungli chali = scroll, ghaseetna nahi
        return;
      }
      kick();
    };
    const onUp = (e) => { const st = dragRef.current; if (st && e.pointerId === st.pid) finish(true); };
    const onCancel = (e) => { const st = dragRef.current; if (st && e.pointerId === st.pid) finish(false); };
    const onKey = (e) => { if (e.key === "Escape" && dragRef.current && dragRef.current.active) finish(false); };
    const onTouchMove = (e) => { if (dragRef.current && dragRef.current.active && e.cancelable) e.preventDefault(); };
    const onScroll = () => { if (dragRef.current && dragRef.current.active) kick(); };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    if (el) el.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      finish(false);
      startRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      if (el) el.removeEventListener("touchmove", onTouchMove);
      document.body.classList.remove("att-dragging");
    };
  }, [editable]);

  const setGhost = useCallback((g) => {
    ghostRef.current = g;
    if (g && dragRef.current) g.style.transform = ghostXf(dragRef.current);
  }, []);

  const openCard = (p) => {
    if (performance.now() - clickBlock.current < 400) return;   // abhi ghaseeta tha -- click nahi
    setPanel({ mode: editable ? "edit" : "view", id: p.id });
  };

  const pickDay = (v) => {
    if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
    setDay(board && v === board.today ? null : v);
  };
  const stepDay = (n) => { if (wantDay) pickDay(shiftDay(wantDay, n)); };

  const panelPerson = panel && panel.id ? (board?.people || []).find((p) => p.id === panel.id) : null;
  const shownDay = board ? (loading ? (day || board.today) : board.day) : day;   // maanga hua din turant
  const status = !board ? "" : board.day === board.today ? "today" : board.day < board.today ? "past" : "future";
  const ghostPerson = drag ? (board?.people || []).find((p) => p.id === drag.id) : null;

  const scrollToLane = (k) => {
    const lane = document.querySelector(`[data-att-lane="${k}"]`);
    if (lane) lane.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700;800&family=Barlow+Condensed:wght@600;700;800&display=swap');
        .bd-root { min-height:100vh; background:#f1f5f9; font-family:'Barlow',sans-serif; padding-bottom:96px; }
        .bd-topbar {
          background:#fff; border-bottom:1px solid #e2e8f0;
          padding:0 40px 0 88px; height:60px;
          display:flex; align-items:center; justify-content:space-between;
          position:sticky; top:0; z-index:100; box-shadow:0 1px 3px rgba(0,0,0,.06);
        }
        .bd-topbar::after { content:''; position:absolute; bottom:0; left:0; right:0;
                            height:2px; background:${theme.gradient}; }
        .bd-title { position:absolute; left:50%; transform:translateX(-50%);
                    font-family:'Barlow Condensed',sans-serif;
                    font-size:34px; font-weight:800; color:#0f172a;
                    letter-spacing:-.01em; pointer-events:none; white-space:nowrap; }
        .bd-title span { color:${theme.accent}; }
        .bd-user-pill { display:flex; align-items:center; gap:10px; padding:6px 14px;
                        border-radius:99px; border:1.5px solid #e2e8f0; background:#f8fafc;
                        font-size:12px; font-weight:600; color:#334155; white-space:nowrap; }
        .bd-user-pill b { color:#0f172a; font-weight:800; }

        .att-body { padding:22px 32px 0; max-width:1500px; margin:0 auto; }

        /* ── upar: tareekh + khoj + Add ── */
        .att-top { display:flex; align-items:center; gap:14px; flex-wrap:wrap;
                   background:#fff; border:1px solid #e2e8f0; border-radius:16px;
                   padding:14px 16px; box-shadow:0 1px 3px rgba(15,23,42,.05); }
        .att-nav { display:flex; align-items:center; gap:6px; }
        .att-ibtn { width:36px; height:36px; border-radius:10px; border:1px solid #e2e8f0; background:#f8fafc;
                    color:#334155; font-size:18px; font-weight:800; cursor:pointer; display:flex;
                    align-items:center; justify-content:center; padding:0; font-family:inherit; }
        .att-ibtn:hover { background:#e2e8f0; color:#0f172a; }
        .att-date { height:36px; border:1px solid #e2e8f0; border-radius:10px; padding:0 10px;
                    font-family:inherit; font-size:14px; font-weight:700; color:#0f172a; background:#fff;
                    min-width:0; }
        .att-date:focus, .att-fld input:focus, .att-search input:focus { outline:none; border-color:${theme.accent};
                    box-shadow:0 0 0 3px ${theme.soft}; }
        .att-today { height:36px; padding:0 14px; border-radius:10px; border:1px solid ${theme.accent};
                     background:#fff; color:${theme.accent}; font-weight:800; font-size:13px; cursor:pointer;
                     font-family:inherit; }
        .att-today:hover { background:${theme.soft}; }
        .att-today:disabled { opacity:.45; cursor:default; }
        .att-dayinfo { min-width:0; flex:1 1 220px; }
        .att-dayname { font-family:'Barlow Condensed',sans-serif; font-size:22px; font-weight:800; color:#0f172a;
                       line-height:1.1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .att-daysub { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-top:3px;
                      font-size:12px; font-weight:600; color:#64748b; }
        .att-chip { display:inline-flex; align-items:center; gap:5px; padding:2px 9px; border-radius:99px;
                    font-size:11px; font-weight:800; letter-spacing:.03em; text-transform:uppercase; }
        .att-chip.today  { background:#dcfce7; color:#15803d; }
        .att-chip.past   { background:#f1f5f9; color:#475569; }
        .att-chip.future { background:#ede9fe; color:#6d28d9; }
        .att-search { position:relative; flex:0 1 280px; min-width:180px; }
        .att-search input { width:100%; height:38px; border:1px solid #e2e8f0; border-radius:10px;
                            padding:0 12px 0 34px; font-family:inherit; font-size:14px; background:#f8fafc;
                            box-sizing:border-box; }
        .att-search svg { position:absolute; left:11px; top:50%; transform:translateY(-50%); color:#94a3b8; }
        .att-add { height:40px; padding:0 18px; border:none; border-radius:11px; cursor:pointer;
                   background:${theme.gradient}; color:#fff; font-family:inherit; font-size:14px; font-weight:800;
                   display:flex; align-items:center; gap:8px; box-shadow:0 6px 16px rgba(37,99,235,.28);
                   white-space:nowrap; }
        .att-add:hover { filter:brightness(1.06); }
        .att-add b { font-size:20px; line-height:1; margin-top:-2px; }

        /* ── ginti ── */
        .att-stats { display:grid; grid-template-columns:repeat(8, minmax(0,1fr)); gap:10px; margin:14px 0 6px; }
        .att-stat { background:#fff; border:1px solid #e2e8f0; border-radius:14px; padding:10px 12px;
                    display:flex; flex-direction:column; gap:2px; cursor:pointer; text-align:left;
                    font-family:inherit; border-top:3px solid var(--c, #e2e8f0); min-width:0; }
        .att-stat:hover { box-shadow:0 6px 16px rgba(15,23,42,.08); }
        .att-stat .n { font-family:'Barlow Condensed',sans-serif; font-size:26px; font-weight:800; color:#0f172a; line-height:1; }
        .att-stat .l { font-size:11px; font-weight:700; color:#64748b; text-transform:uppercase; letter-spacing:.04em;
                       white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .att-stat .ls { display:none; }
        .att-stat.big { background:linear-gradient(135deg,#0f172a,#1e3a8a); border-color:transparent; border-top-color:transparent; cursor:default; }
        .att-stat.big .n { color:#fff; }
        .att-stat.big .l { color:#bfdbfe; }
        .att-stat.big.duty { background:linear-gradient(135deg,#065f46,#059669); }
        .att-stat.big.duty .l { color:#bbf7d0; }

        .att-note { margin:10px 0 0; padding:10px 14px; border-radius:12px; font-size:13px; font-weight:600;
                    display:flex; align-items:center; gap:8px; }
        .att-note.past   { background:#fff7ed; color:#9a3412; border:1px solid #fed7aa; }
        .att-note.future { background:#f5f3ff; color:#5b21b6; border:1px solid #ddd6fe; }
        .att-note.err    { background:#fef2f2; color:#b91c1c; border:1px solid #fecaca; }
        .att-note.tip    { background:transparent; color:#64748b; padding:6px 2px 0; font-weight:500; font-size:12px; }
        .att-note button { margin-left:auto; border:1px solid currentColor; background:#fff; color:inherit;
                           border-radius:8px; padding:4px 12px; font-weight:800; cursor:pointer; font-family:inherit; }

        /* ── kataar ── */
        .att-board { display:flex; flex-direction:column; gap:14px; margin-top:14px; transition:opacity .15s; }
        .att-board.dim { opacity:.55; pointer-events:none; }
        .att-lane { display:flex; background:#fff; border:1px solid #e2e8f0; border-radius:18px; overflow:hidden;
                    box-shadow:0 1px 3px rgba(15,23,42,.05); transition:border-color .12s, box-shadow .12s;
                    scroll-margin-top:72px; }
        .att-lane.over { border-color:var(--c); box-shadow:0 0 0 3px var(--soft), 0 10px 26px rgba(15,23,42,.10); }
        .att-lane-head { width:150px; flex-shrink:0; background:linear-gradient(160deg,var(--c),var(--d));
                         color:#fff; padding:16px 14px; display:flex; flex-direction:column; align-items:flex-start;
                         gap:10px; position:relative; }
        .att-badge { min-width:46px; height:46px; padding:0 8px; border-radius:14px; background:rgba(255,255,255,.18);
                     border:1.5px solid rgba(255,255,255,.35); display:flex; align-items:center; justify-content:center;
                     font-family:'Barlow Condensed',sans-serif; font-size:24px; font-weight:800; box-sizing:border-box; }
        .att-lane-name { font-family:'Barlow Condensed',sans-serif; font-size:20px; font-weight:800; line-height:1.05;
                         text-transform:uppercase; letter-spacing:.02em; }
        .att-lane-count { font-size:12px; font-weight:700; opacity:.85; margin-top:2px; }
        .att-lane-add { position:absolute; right:10px; top:12px; width:30px; height:30px; min-height:0 !important;
                        border-radius:9px; border:1.5px solid rgba(255,255,255,.45); background:rgba(255,255,255,.12);
                        color:#fff; font-size:20px; font-weight:700; line-height:1; cursor:pointer; padding:0;
                        display:flex; align-items:center; justify-content:center; font-family:inherit; }
        .att-lane-add:hover { background:rgba(255,255,255,.28); }
        .att-lane-body { flex:1; min-width:0; padding:14px; display:grid; gap:12px; align-content:start;
                         grid-template-columns:repeat(auto-fill, minmax(150px, 1fr)); background:var(--soft);
                         min-height:120px; }
        .att-empty { grid-column:1 / -1; align-self:center; justify-self:stretch; border:2px dashed #cbd5e1;
                     border-radius:14px; padding:22px 12px; text-align:center; font-size:13px; font-weight:600;
                     color:#94a3b8; }

        /* ── card ── */
        .att-card { position:relative; background:#fff; border:1px solid #e2e8f0; border-radius:14px;
                    padding:14px 10px 12px; display:flex; flex-direction:column; align-items:center; text-align:center;
                    gap:3px; cursor:pointer; user-select:none; -webkit-user-select:none; -webkit-touch-callout:none;
                    box-shadow:0 1px 2px rgba(15,23,42,.05); transition:box-shadow .15s, transform .15s, opacity .15s;
                    min-width:0; outline:none; }
        .att-card:hover { box-shadow:0 10px 22px rgba(15,23,42,.10); transform:translateY(-2px); }
        .att-card:focus-visible { box-shadow:0 0 0 3px ${theme.accent}; }
        .att-card.edit { cursor:grab; }
        .att-card.away { display:none; }
        .att-card.dim { opacity:.25; }
        .att-card.hit { box-shadow:0 0 0 2px #f59e0b, 0 8px 20px rgba(245,158,11,.25); }
        .att-hole { border:2px dashed var(--c); background:var(--soft); border-radius:14px;
                    min-height:150px; }
        .att-ph { width:68px; height:68px; border-radius:50%; flex-shrink:0; margin-bottom:6px; position:relative;
                  box-shadow:0 0 0 3px #fff, 0 0 0 5px var(--c); background:var(--soft); overflow:hidden;
                  display:flex; align-items:center; justify-content:center; }
        .att-ph img { width:100%; height:100%; object-fit:cover; display:block; -webkit-user-drag:none; pointer-events:none; }
        .att-ph span { font-family:'Barlow Condensed',sans-serif; font-size:26px; font-weight:800; color:var(--c); }
        .att-name { font-size:14px; font-weight:800; color:#0f172a; line-height:1.2; max-width:100%;
                    display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;
                    word-break:break-word; }
        .att-code { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:11px; font-weight:700;
                    color:var(--c); background:var(--soft); border-radius:6px; padding:1px 7px; margin-top:2px;
                    max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .att-desig { font-size:12px; font-weight:600; color:#64748b; line-height:1.25; max-width:100%;
                     overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .att-tel { display:flex; align-items:center; gap:4px; font-size:12px; font-weight:700; color:#334155;
                   max-width:100%; overflow:hidden; white-space:nowrap; margin-top:1px; }
        .att-tel svg { flex-shrink:0; color:#94a3b8; }
        .att-grip { position:absolute; top:6px; right:6px; width:26px; height:26px; border-radius:8px;
                    display:flex; align-items:center; justify-content:center; color:#94a3b8; touch-action:none;
                    cursor:grab; }
        .att-card:hover .att-grip { color:#475569; background:#f1f5f9; }

        /* ghaseette waqt hawa me card */
        .att-ghost { position:fixed; left:0; top:0; z-index:10050; pointer-events:none; margin:0;
                     box-shadow:0 22px 44px rgba(15,23,42,.28) !important; border-color:var(--c) !important;
                     cursor:grabbing; }
        body.att-dragging, body.att-dragging * { cursor:grabbing !important; user-select:none !important;
                     -webkit-user-select:none !important; }

        /* ── side panel ── */
        .att-back { position:fixed; top:0; right:0; bottom:0; left:0; background:rgba(15,23,42,.38); z-index:10040; }
        .att-panel { position:fixed; top:0; right:0; bottom:0; width:430px; max-width:100%; background:#fff;
                     z-index:10041; display:flex; flex-direction:column; box-shadow:-18px 0 40px rgba(15,23,42,.18);
                     font-family:'Barlow',sans-serif; animation:att-in .22s ease-out 1; }
        @keyframes att-in { from { transform:translateX(40px); opacity:0; } to { transform:none; opacity:1; } }
        .att-ph-head { padding:18px 20px 16px; color:#fff; display:flex; align-items:center; gap:12px;
                       background:linear-gradient(135deg,var(--c),var(--d)); }
        .att-ph-title { font-family:'Barlow Condensed',sans-serif; font-size:24px; font-weight:800; line-height:1.05; }
        .att-ph-sub { font-size:12px; font-weight:600; opacity:.85; margin-top:2px; }
        .att-x { margin-left:auto; width:36px; height:36px; border-radius:10px; border:1.5px solid rgba(255,255,255,.4);
                 background:rgba(255,255,255,.12); color:#fff; font-size:20px; cursor:pointer; padding:0;
                 display:flex; align-items:center; justify-content:center; flex-shrink:0; font-family:inherit; }
        .att-x:hover { background:rgba(255,255,255,.25); }
        .att-pbody { flex:1; overflow-y:auto; padding:18px 20px 8px; -webkit-overflow-scrolling:touch; }
        .att-pick { display:flex; align-items:center; gap:16px; margin-bottom:16px; }
        .att-bigph { width:104px; height:104px; border-radius:50%; flex-shrink:0; overflow:hidden; position:relative;
                     box-shadow:0 0 0 4px #fff, 0 0 0 6px var(--c); background:var(--soft); color:var(--c);
                     display:flex; align-items:center; justify-content:center; }
        .att-bigph img { width:100%; height:100%; object-fit:cover; display:block; }
        .att-bigph span { font-family:'Barlow Condensed',sans-serif; font-size:40px; font-weight:800; }
        .att-pick-btns { display:flex; flex-direction:column; gap:8px; align-items:flex-start; min-width:0; }
        .att-sbtn { display:inline-flex; align-items:center; gap:6px; height:34px; padding:0 14px; border-radius:9px;
                    border:1px solid #cbd5e1; background:#fff; color:#0f172a; font-size:13px; font-weight:700;
                    cursor:pointer; font-family:inherit; position:relative; overflow:hidden; }
        .att-sbtn:hover { background:#f8fafc; }
        .att-sbtn.red { color:#b91c1c; border-color:#fecaca; }
        .att-sbtn input { position:absolute; top:0; right:0; bottom:0; left:0; opacity:0; cursor:pointer; font-size:0; }
        .att-hint { font-size:11px; color:#94a3b8; font-weight:600; }
        .att-fld { display:block; margin-bottom:13px; }
        .att-fld > span { display:block; font-size:11px; font-weight:800; color:#475569; text-transform:uppercase;
                          letter-spacing:.05em; margin-bottom:5px; }
        .att-fld > span i { color:#dc2626; font-style:normal; }
        .att-fld input { width:100%; height:42px; box-sizing:border-box; border:1px solid #cbd5e1; border-radius:10px;
                         padding:0 12px; font-family:inherit; font-size:15px; color:#0f172a; background:#fff; }
        .att-fld input:disabled { background:#f8fafc; color:#334155; -webkit-text-fill-color:#334155; opacity:1; }
        .att-dwrap { position:relative; }
        .att-dph { position:absolute; left:13px; top:50%; transform:translateY(-50%); color:#94a3b8;
                   font-size:15px; pointer-events:none; }
        .att-dico { position:absolute; right:12px; top:50%; transform:translateY(-50%); color:#64748b; pointer-events:none;
                    display:flex; }
        .att-seg { display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); gap:7px; }
        .att-seg button { height:38px; border-radius:10px; border:1.5px solid #e2e8f0; background:#fff; cursor:pointer;
                          font-family:inherit; font-size:12px; font-weight:800; color:#334155; padding:0 4px;
                          white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .att-seg button.on { border-color:var(--c); background:var(--soft); color:var(--c);
                             box-shadow:inset 0 0 0 1px var(--c); }
        .att-seg button:disabled { cursor:default; }
        .att-info { display:grid; grid-template-columns:auto 1fr; gap:6px 12px; font-size:13px; margin:4px 0 14px;
                    padding:12px 14px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; }
        .att-info b { color:#64748b; font-weight:700; }
        .att-info span { color:#0f172a; font-weight:700; }
        .att-call { display:inline-flex; align-items:center; gap:6px; margin-left:8px; padding:2px 10px; border-radius:99px;
                    background:#dcfce7; color:#15803d; font-size:12px; font-weight:800; text-decoration:none; }
        .att-perr { background:#fef2f2; border:1px solid #fecaca; color:#b91c1c; border-radius:10px; padding:9px 12px;
                    font-size:13px; font-weight:700; margin-bottom:10px; }
        .att-pfoot { padding:14px 20px; border-top:1px solid #e2e8f0; display:flex; align-items:center; gap:10px;
                     flex-wrap:wrap; background:#fff; }
        .att-btn { height:42px; padding:0 18px; border-radius:11px; font-family:inherit; font-size:14px; font-weight:800;
                   cursor:pointer; border:1px solid #cbd5e1; background:#fff; color:#334155; }
        .att-btn:hover { background:#f8fafc; }
        .att-btn.pri { border:none; color:#fff; background:linear-gradient(135deg,var(--c),var(--d));
                       box-shadow:0 6px 14px rgba(15,23,42,.18); }
        .att-btn.pri:hover { filter:brightness(1.06); }
        .att-btn.del { color:#b91c1c; border-color:#fecaca; }
        .att-btn.delyes { border:none; background:#dc2626; color:#fff; }
        .att-btn:disabled { opacity:.55; cursor:default; }
        .att-confirm { width:100%; font-size:13px; font-weight:600; color:#7f1d1d; background:#fef2f2;
                       border:1px solid #fecaca; border-radius:10px; padding:10px 12px; line-height:1.35; }

        .att-toast { position:fixed; left:50%; bottom:28px; transform:translateX(-50%); z-index:10060;
                     background:#0f172a; color:#fff; padding:11px 18px; border-radius:12px; font-size:14px; font-weight:700;
                     box-shadow:0 12px 30px rgba(15,23,42,.3); max-width:calc(100vw - 32px); font-family:'Barlow',sans-serif; }
        .att-toast.err { background:#b91c1c; }

        /* app me koi lagataar animation nahi; panel bina sarakne ke (TV par halka) */
        body.in-app-tv .att-panel { animation:none; }

        /* ── tablet / patli khidki ── */
        @media (max-width: 1100px) {
          .att-stats { grid-template-columns:repeat(4, minmax(0,1fr)); }
        }
        /* "Attendance Dashboard" lamba title hai: 34px par phone (website 375 aur
           app 412 dono) me logo / ⛶ / ⚙ par chadh jaata tha.  responsive.css
           bd-title ko sirf beech me bithata hai, naap nahi ghatata. */
        @media (max-width: 760px) { .bd-title { font-size:20px; } }
        @media (max-width: 360px) { .bd-title { font-size:18px; } }
        @media (max-width: 760px) {
          .att-body { padding:14px 12px 0; }
          .att-top { padding:12px; gap:10px; }
          .att-dayinfo { flex-basis:100%; order:-1; }
          .att-nav { flex:1 1 100%; }
          .att-date { flex:1; }
          .att-search { flex:1 1 100%; min-width:0; }
          .att-add { flex:1 1 100%; justify-content:center; }
          .att-stats { grid-template-columns:repeat(4, minmax(0,1fr)); gap:7px; }
          .att-stat { padding:8px 9px; border-radius:12px; }
          .att-stat .n { font-size:22px; }
          .att-stat .l { font-size:10px; letter-spacing:0; }
          .att-stat .lf { display:none; }          /* patli screen: "WORK FROM H…" ki jagah WFH */
          .att-stat .ls { display:inline; }
          .att-lane { flex-direction:column; border-radius:16px; }
          .att-lane-head { width:auto; flex-direction:row; align-items:center; padding:10px 12px; gap:10px; }
          .att-badge { min-width:38px; height:38px; font-size:20px; border-radius:11px; }
          .att-lane-add { position:static; margin-left:auto; width:34px; height:34px; }
          .att-lane-body { padding:10px; gap:9px; grid-template-columns:repeat(2, minmax(0,1fr)); min-height:90px; }
          .att-card { padding:12px 8px 10px; }
          .att-ph { width:58px; height:58px; }
          .att-hole { min-height:130px; }
          .att-panel { width:100%; }
          .att-toast { bottom:20px; }
          body:not(.in-app):not(.in-app-tab):not(.in-app-tv) .bd-user-pill { display:none; }
        }
        @media (max-width: 380px) {
          .att-stats { grid-template-columns:repeat(3, minmax(0,1fr)); }
        }
        ${NATIVE ? `.att-date, .att-fld input[type=date] { -webkit-appearance:none; appearance:none; }` : ""}
      `}</style>

      <div className="bd-root">
        <div className="bd-topbar">
          <div />
          <div className="bd-title">Attendance <span>Dashboard</span></div>
          {user?.username && <div className="bd-user-pill">Signed in as <b>{user.username}</b></div>}
        </div>

        <div className="att-body">
          <div className="att-top">
            <div className="att-dayinfo">
              <div className="att-dayname">{shownDay ? longDay(shownDay) : "Loading…"}</div>
              <div className="att-daysub">
                {status === "today" && <span className="att-chip today">Today</span>}
                {status === "past" && <span className="att-chip past">Past · view only</span>}
                {status === "future" && <span className="att-chip future">Planning</span>}
                {board?.last_change && (
                  <span>Last updated {whenText(board.last_change.at)}{board.last_change.by ? ` by ${board.last_change.by}` : ""}</span>
                )}
              </div>
            </div>

            <div className="att-nav">
              <button className="att-ibtn" onClick={() => stepDay(-1)} title="Previous day" aria-label="Previous day">‹</button>
              <input type="date" className="att-date" value={shownDay || ""} onChange={(e) => pickDay(e.target.value)}
                     aria-label="Date" />
              <button className="att-ibtn" onClick={() => stepDay(1)} title="Next day" aria-label="Next day">›</button>
              <button className="att-today" onClick={() => setDay(null)} disabled={day === null}>Today</button>
            </div>

            <label className="att-search">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"
                   strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, emp code, designation…"
                     aria-label="Search" />
            </label>

            {editable && (
              <button className="att-add" onClick={() => setPanel({ mode: "add", slot: "G" })}>
                <b>+</b> Add Member
              </button>
            )}
          </div>

          <div className="att-stats">
            <div className="att-stat big"><span className="n">{counts.total}</span><span className="l">Total</span></div>
            <div className="att-stat big duty"><span className="n">{counts.duty}</span><span className="l">On duty</span></div>
            {SLOTS.map((s) => (
              <button key={s.key} className="att-stat" style={{ "--c": s.c }} onClick={() => scrollToLane(s.key)}
                      title={`Go to ${s.label}`}>
                <span className="n">{counts[s.key]}</span>
                <span className="l">{s.short ? (<><span className="lf">{s.label}</span><span className="ls">{s.short}</span></>) : s.label}</span>
              </button>
            ))}
          </div>

          {err && (
            <div className="att-note err">⚠ {err}<button onClick={reload}>Retry</button></div>
          )}
          {status === "past" && (
            <div className="att-note past">This is a past date — the board is view-only. Go to Today to make changes.</div>
          )}
          {status === "future" && editable && (
            <div className="att-note future">
              Planning for {shortDay(board.day)} — changes apply from this date onward (until changed again).
            </div>
          )}
          {ql && <div className="att-note tip">{hits} match{hits === 1 ? "" : "es"} for “{q.trim()}”.</div>}
          {!ql && editable && counts.total > 0 && (
            <div className="att-note tip">
              {COARSE
                ? "Tip: press and hold a card (or its ⋮⋮ handle), then drag it to another row. Tap a card to edit."
                : "Tip: drag a card to another row to change the shift. Click a card to edit."}
            </div>
          )}
          {!loading && !err && counts.total === 0 && (
            <div className="att-note tip">
              {editable
                ? "No members yet. Use Add Member to add your team (photo, name, emp code, designation, contact, date of joining), then drag them into shifts."
                : "No members on the board for this date."}
            </div>
          )}

          <div ref={boardEl} className={`att-board${loading && board ? " dim" : ""}`}>
            {SLOTS.map((s) => {
              const items = view[s.key];
              const n = lanes[s.key].length;
              return (
                <section key={s.key} className={`att-lane${drag && drag.slot === s.key ? " over" : ""}`}
                         data-att-lane={s.key} style={vars(s)}>
                  <div className="att-lane-head" data-att-head="">
                    <div className="att-badge">{s.badge}</div>
                    <div>
                      <div className="att-lane-name">{s.label}</div>
                      <div className="att-lane-count">{n} {n === 1 ? "person" : "people"}</div>
                    </div>
                    {editable && (
                      <button className="att-lane-add" onClick={() => setPanel({ mode: "add", slot: s.key })}
                              title={`Add to ${s.label}`} aria-label={`Add to ${s.label}`}>+</button>
                    )}
                  </div>
                  <div className="att-lane-body">
                    {items.map((it) => {
                      if (it.hole) return <div key="hole" className="att-hole" style={{ minHeight: drag?.h || undefined }} />;
                      const p = it.p;
                      const idx = lanes[s.key].indexOf(p);
                      const found = ql && match(p);
                      return (
                        <Card key={p.id} p={p} url={photoOf(p)} editable={editable}
                              away={it.away} dim={!!ql && !found} hit={!!found}
                              onPointerDown={(e) => { if (startRef.current) startRef.current(e, p, idx); }}
                              onOpen={() => openCard(p)} />
                      );
                    })}
                    {n === 0 && !(drag && drag.slot === s.key) && (
                      <div className="att-empty">{editable ? "Drag someone here" : "No one"}</div>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      </div>

      {drag && ghostPerson && createPortal(
        <div ref={setGhost} className="att-card att-ghost"
             style={{ width: drag.w, ...vars(SLOT[drag.slot] || SLOT.G) }}>
          <CardBody p={ghostPerson} url={photoOf(ghostPerson)} />
        </div>,
        document.body,
      )}

      {panel && (panel.mode === "add" || panelPerson) && (
        <MemberPanel
          key={`${panel.mode}-${panel.id || panel.slot}`}
          mode={panel.mode} slot0={panel.mode === "add" ? panel.slot : panelPerson.slot}
          person={panelPerson} photo0={photoOf(panelPerson)}
          day={board.day} today={board.today} editable={editable}
          designations={designations} token={token}
          onClose={() => setPanel(null)}
          onDone={(msg) => { setPanel(null); showToast(msg); localVer.current += 1; reload(); }}
        />
      )}

      {toast && <div className={`att-toast${toast.kind === "err" ? " err" : ""}`} role="status">{toast.text}</div>}
    </>
  );
}

/* ── card ───────────────────────────────────────────────────────────── */
function CardBody({ p, url }) {
  return (
    <>
      <div className="att-ph">{url ? <img src={url} alt="" draggable={false} /> : <span>{initials(p.name)}</span>}</div>
      <div className="att-name" title={p.name}>{p.name}</div>
      {p.emp_code && <div className="att-code">{p.emp_code}</div>}
      {p.designation && <div className="att-desig" title={p.designation}>{p.designation}</div>}
      {p.contact && <div className="att-tel"><IcoPhone />{p.contact}</div>}
    </>
  );
}

function Card({ p, url, editable, away, dim, hit, onPointerDown, onOpen }) {
  return (
    <div className={`att-card${editable ? " edit" : ""}${away ? " away" : ""}${dim ? " dim" : ""}${hit ? " hit" : ""}`}
         data-att-card={away ? undefined : ""} data-att-id={p.id} role="button" tabIndex={0}
         aria-label={`${p.name}${p.emp_code ? `, ${p.emp_code}` : ""}${p.designation ? `, ${p.designation}` : ""}`}
         onPointerDown={editable ? onPointerDown : undefined}
         onClick={onOpen}
         onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
         onContextMenu={editable ? (e) => e.preventDefault() : undefined}>
      {editable && <span className="att-grip" data-att-grip="" title="Drag"><IcoGrip /></span>}
      <CardBody p={p} url={url} />
    </div>
  );
}

/* ── date of joining: app (Android WebView) me khaali date BLANK dikhti hai,
      website jaisa "mm/dd/yyyy" + calendar upar se (dekho KpiPanel.jsx) ── */
function DateField({ value, onChange, disabled }) {
  return (
    <div className="att-dwrap">
      <input type="date" value={value || ""} onChange={(e) => onChange(e.target.value)} disabled={disabled}
             max="2100-12-31" min="1950-01-01" />
      {NATIVE && !value && <span className="att-dph">mm/dd/yyyy</span>}
      {NATIVE && <span className="att-dico"><IcoCal /></span>}
    </div>
  );
}

/* ── side panel: add / edit / dekhna ─────────────────────────────────── */
function MemberPanel({ mode, slot0, person, photo0, day, today, editable, designations, token, onClose, onDone }) {
  const view = mode === "view" || !editable;
  const [f, setF] = useState(() => ({
    name: person?.name || "", emp_code: person?.emp_code || "", designation: person?.designation || "",
    contact: person?.contact || "", doj: person?.doj || "", slot: slot0 || "G",
  }));
  const [photo, setPhoto] = useState(photo0 || null);
  const [photoChanged, setPhotoChanged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [perr, setPerr] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);
  const s = SLOT[f.slot] || SLOT.G;
  const set = (k) => (e) => setF((o) => ({ ...o, [k]: e && e.target ? e.target.value : e }));

  // Esc = band
  useEffect(() => {
    const k = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const pickPhoto = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";                 // wahi file dobara chune to bhi chale
    if (!file) return;
    try {
      setPhoto(await squarePhoto(file));
      setPhotoChanged(true);
      setPerr("");
    } catch (x) {
      setPerr(x.message || "This image could not be read.");
    }
  };

  const save = async () => {
    const name = f.name.trim();
    if (!name) { setPerr("Name is required."); return; }
    if (f.contact.trim() && !/^[0-9+\-()/, ]{3,40}$/.test(f.contact.trim())) {
      setPerr("Contact number can only have digits, spaces and + - ( ) / ,");
      return;
    }
    setBusy(true);
    setPerr("");
    const body = {
      name, emp_code: f.emp_code.trim(), designation: f.designation.trim(), contact: f.contact.trim(),
      doj: f.doj || null, day,
    };
    try {
      if (mode === "add") {
        await api.post("/api/attendance/staff", { ...body, photo, slot: f.slot }, token);
        onDone(`${name} added to ${SLOT[f.slot].label}`);
      } else {
        await api.put(`/api/attendance/staff/${person.id}`, {
          ...body, photo, photo_change: photoChanged,
          ...(f.slot !== person.slot ? { slot: f.slot } : {}),
        }, token);
        onDone(f.slot !== person.slot ? `${name} → ${SLOT[f.slot].label}` : `${name} saved`);
      }
    } catch (x) {
      setPerr(x.message || "Could not save.");
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setPerr("");
    try {
      const r = await api.delete(`/api/attendance/staff/${person.id}?day=${day}`, token);
      onDone(r && r.mode === "deleted" ? `${person.name} deleted` : `${person.name} removed from ${shortDay(day)}`);
    } catch (x) {
      setPerr(x.message || "Could not remove.");
      setBusy(false);
      setConfirmDel(false);
    }
  };

  const title = mode === "add" ? "Add Member" : view ? (person?.name || "Member") : "Edit Member";
  const sub = mode === "add"
    ? (day === today ? "Adds to today's board" : `Appears on the board from ${shortDay(day)}`)
    : view ? [person?.designation, person?.emp_code].filter(Boolean).join(" · ") || s.label
      : `Changes to the shift apply from ${day === today ? "today" : shortDay(day)}`;

  return (
    <>
      <div className="att-back" onClick={busy ? undefined : onClose} />
      <aside className="att-panel" style={vars(s)} role="dialog" aria-modal="true"
             aria-label={title}>
        <div className="att-ph-head">
          <div style={{ minWidth: 0 }}>
            <div className="att-ph-title">{title}</div>
            <div className="att-ph-sub">{sub}</div>
          </div>
          <button className="att-x" onClick={onClose} disabled={busy} aria-label="Close">×</button>
        </div>

        <div className="att-pbody">
          <div className="att-pick">
            <div className="att-bigph">
              {photo ? <img src={photo} alt="" /> : f.name.trim() ? <span>{initials(f.name)}</span> : <IcoCam />}
            </div>
            {!view && (
              <div className="att-pick-btns">
                <label className="att-sbtn">
                  {photo ? "Change photo" : "Choose photo"}
                  <input type="file" accept="image/*" onChange={pickPhoto} />
                </label>
                {photo && (
                  <button className="att-sbtn red" onClick={() => { setPhoto(null); setPhotoChanged(true); }}>
                    Remove photo
                  </button>
                )}
                <div className="att-hint">A square from the middle of the picture is kept.</div>
              </div>
            )}
          </div>

          {view && (
            <div className="att-info">
              <b>Shift</b><span>{s.label}</span>
              {person?.emp_code && (<><b>Emp code</b><span>{person.emp_code}</span></>)}
              {person?.designation && (<><b>Designation</b><span>{person.designation}</span></>)}
              {person?.contact && (<><b>Contact</b><span>{person.contact}
                {(NATIVE || COARSE) && <a className="att-call" href={telHref(person.contact)}><IcoPhone /> Call</a>}
              </span></>)}
              {person?.doj && (<><b>Joined</b><span>{shortDay(person.doj)} · {tenure(person.doj, day)}</span></>)}
            </div>
          )}

          {!view && (
            <>
              <label className="att-fld"><span>Name <i>*</i></span>
                <input value={f.name} onChange={set("name")} maxLength={120} placeholder="Full name"
                       autoFocus={!NATIVE && mode === "add"} />
              </label>
              <label className="att-fld"><span>Emp Code</span>
                <input value={f.emp_code} onChange={set("emp_code")} maxLength={40} placeholder="e.g. 10234" />
              </label>
              <label className="att-fld"><span>Designation</span>
                <input value={f.designation} onChange={set("designation")} maxLength={120} list="att-desig-list"
                       placeholder="e.g. Technician" />
                <datalist id="att-desig-list">{designations.map((d) => <option key={d} value={d} />)}</datalist>
              </label>
              <label className="att-fld"><span>Contact Number</span>
                <input value={f.contact} onChange={set("contact")} maxLength={40} type="tel" inputMode="tel"
                       placeholder="e.g. 98765 43210" />
              </label>
              <div className="att-fld"><span>Date of Joining</span>
                <DateField value={f.doj} onChange={set("doj")} />
                {f.doj && <div className="att-hint" style={{ marginTop: 5 }}>{tenure(f.doj, today)}</div>}
              </div>
              <div className="att-fld"><span>Shift / Status</span>
                <div className="att-seg">
                  {SLOTS.map((x) => (
                    <button key={x.key} type="button" className={f.slot === x.key ? "on" : ""}
                            style={vars(x)} onClick={() => setF((o) => ({ ...o, slot: x.key }))}>
                      {x.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
          {perr && <div className="att-perr">{perr}</div>}
        </div>

        <div className="att-pfoot">
          {confirmDel ? (
            <>
              <div className="att-confirm">
                Remove <b>{person.name}</b> from the board from {shortDay(day)} onward? Earlier dates are not changed.
              </div>
              <div style={{ flex: 1 }} />
              <button className="att-btn" onClick={() => setConfirmDel(false)} disabled={busy}>Cancel</button>
              <button className="att-btn delyes" onClick={remove} disabled={busy}>{busy ? "Removing…" : "Yes, remove"}</button>
            </>
          ) : view ? (
            <>
              <div style={{ flex: 1 }} />
              <button className="att-btn" onClick={onClose}>Close</button>
            </>
          ) : (
            <>
              {mode === "edit" && (
                <button className="att-btn del" onClick={() => setConfirmDel(true)} disabled={busy}>Remove</button>
              )}
              <div style={{ flex: 1 }} />
              <button className="att-btn" onClick={onClose} disabled={busy}>Cancel</button>
              <button className="att-btn pri" onClick={save} disabled={busy}>
                {busy ? "Saving…" : mode === "add" ? "Add Member" : "Save"}
              </button>
            </>
          )}
        </div>
      </aside>
    </>
  );
}
