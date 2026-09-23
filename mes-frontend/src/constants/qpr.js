/* qpr.js — Breakdown QPR ka SAAJHA hisaab.
 *
 * Do page ise istemal karte hain:
 *   BreakdownQPR.jsx         -- Pareto (machine-wise jod)
 *   BreakdownQprMachine.jsx  -- ek machine ki wahi slips jo us jod me gini gayi
 *
 * Chhaanne ka niyam (`qprSlips`) EK hi jagah isliye hai ki dono page kabhi
 * alag na chalein -- QPR par YSD_RC_05 = 195 min dikhe aur uske page par
 * slips ka jod kuch aur aaye, ye sabse buri galti hoti.
 *
 * Filter URL me rehte hain (`?fy=&month=&date=&zone=&line=&mc=`) -- machine
 * ke page se wapas aane par QPR wahi filter ke saath khulta hai, phone ke
 * back se bhi.
 */

export const QPR_PATH = "/maintenance-breakdown/breakdown-qpr";
export const QPR_MACHINE_PATH = `${QPR_PATH}/machine`;
export const QPR_DEFAULT_MIN = 55;      // server par kuch save na ho / na mile to

export const pad2 = (n) => String(n).padStart(2, "0");
export const MON = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/* "2026-09" -> "2026-09-30" (us mahine ka aakhri din) */
export const mahineKaAnt = (ym) => {
  const [y, m] = String(ym).split("-").map(Number);
  return y && m ? `${ym}-${pad2(new Date(y, m, 0).getDate())}` : "";
};

/* FY Apr -> Mar ke 12 mahine -- BD History / History Card jaisa hi. */
export function fyMonths(fy) {
  const y = parseInt(String(fy).split("-")[0], 10);
  if (isNaN(y)) return [];
  const out = [];
  for (let i = 0; i < 12; i++) {
    const mo = ((3 + i) % 12) + 1;
    const yr = mo >= 4 ? y : y + 1;
    out.push({ value: `${yr}-${pad2(mo)}`, label: `${MON[mo]} ${yr}` });
  }
  return out;
}

/* FY ki khidki: start (shamil), end (agle FY ka pehla din, shamil NAHI),
   last (31 March -- API ka date_to shamil hota hai). */
export function fyWindow(fy) {
  const y = parseInt(String(fy).split("-")[0], 10);
  if (isNaN(y)) return null;
  return { start: `${y}-04-01`, end: `${y + 1}-04-01`, last: `${y + 1}-03-31` };
}

/* Sheet ke naam me samay -- kaagaz par "OF Dec -2025" tha. */
export function kabLabel({ fy, month, date }) {
  if (date)  { const [y, m, d] = String(date).split("-"); return `${d}-${MON[Number(m)]}-${y}`; }
  if (month) { const [y, m] = String(month).split("-");   return `${MON[Number(m)]}-${y}`; }
  if (fy) return `FY ${fy}`;
  return "All Years";
}

/* API se kitni khidki maangni hai -- sabse tang jo filter se banti ho. */
export function apiWindow({ fy, month, date }) {
  if (date)  return { from: date, to: date };
  if (month) return { from: `${month}-01`, to: mahineKaAnt(month) };
  const w = fy ? fyWindow(fy) : null;
  return w ? { from: w.start, to: w.last } : { from: "", to: "" };
}

/* ── HADD (minute) -- default + MAHINE-WISE ──────────────────────────────
   User: "default 55 rahegi sab month ke liye, lekin koi aur month select
   karke set kar sakta hoon."  Server se { min_down_time_min, months:
   {"2026-10": 60} } aata hai.  Har slip APNE mahine ki hadd se parkhi jaati
   hai -- isliye poore saal ka Pareto bhi sahi banta hai. */

/* Server ka jawab -> { def, months }.  Na mile to 55, koi mahina alag nahi. */
export function haddCfg(c) {
  const def = Number.isFinite(Number(c?.min_down_time_min)) ? Number(c.min_down_time_min) : QPR_DEFAULT_MIN;
  const months = {};
  for (const [k, v] of Object.entries(c?.months || {})) {
    if (Number.isFinite(Number(v))) months[k] = Number(v);
  }
  return { def, months };
}

/* Kisi mahine ('YYYY-MM') ki hadd: alag rakhi ho to wo, warna default. */
export const haddOf = (cfg) => (ym) => (cfg.months[ym] ?? cfg.def);

/* Admin kis mahine ki hadd badal raha hai -- chuna hua mahina (ya date ka).
   Khaali = default (sab mahine jinki alag nahi rakhi). */
export const haddMahina = (f) => f.month || (f.date ? String(f.date).slice(0, 7) : "");

/* "2026-09" -> "Sep 2026" */
export const mahinaNaam = (ym) => { const [y, m] = String(ym).split("-"); return `${MON[Number(m)]} ${y}`; };

/* Is filter ki slips par kaunsi hadd lagi -- ek number (`ek`), ya mahine-wise
   (jab dikh rahe samay me kisi mahine ki alag hadd ho). */
export function haddBayan(cfg, f) {
  const m = haddMahina(f);
  if (m) return { ek: true, min: haddOf(cfg)(m) };
  const w = f.fy ? fyWindow(f.fy) : null;
  const alag = Object.keys(cfg.months)
    .filter((k) => !w || (k >= w.start.slice(0, 7) && k < w.end.slice(0, 7)));
  return alag.length ? { ek: false, min: cfg.def, alag } : { ek: true, min: cfg.def };
}

/* Wo slips jo QPR me GINI jaati hain: filter + M/C DOWN TIME >= hadd.
   `f` = { fy, month, date, zone, line, mc } -- khaali ho to wo filter nahi.
   `hadd` = number, ya (ym) => number (mahine-wise; `haddOf(cfg)`).
   Machine khaali ho (DB me abhi ek bhi nahi) to wo "—" ke naam se chalti hai,
   jaise Pareto me. */
export function qprSlips(rows, f, hadd) {
  const h = typeof hadd === "function" ? hadd : () => hadd;
  const w = f.fy ? fyWindow(f.fy) : null;
  return (rows || []).filter((r) => {
    const d = String(r.bd_date || "").slice(0, 10);
    if (!d) return false;
    if (w && !(d >= w.start && d < w.end)) return false;
    if (f.month && d.slice(0, 7) !== f.month) return false;
    if (f.date && d !== f.date) return false;
    if (f.zone && r.zone_code !== f.zone) return false;
    if (f.line && r.line_code !== f.line) return false;
    if (f.mc && (r.machine_no || "—") !== f.mc) return false;
    return (Number(r.solve_time_min) || 0) >= h(d.slice(0, 7));
  });
}

/* Filter -> URL ka query.  `fy` hamesha jaata hai (khaali = "All Financial
   Years" -- warna wapas aane par page apna default FY thop deta). */
export function qprQuery(f) {
  const p = new URLSearchParams();
  p.set("fy", f.fy || "");
  if (f.month) p.set("month", f.month);
  if (f.date)  p.set("date", f.date);
  if (f.zone)  p.set("zone", f.zone);
  if (f.line)  p.set("line", f.line);
  if (f.mc)    p.set("mc", f.mc);
  // Slip Type sirf tab URL me jaata hai jab manual se alag ho -- purane link
  // (jinme src hai hi nahi) waise ke waise manual par khulte hain.
  if (f.src && f.src !== "manual") p.set("src", f.src);
  return p;
}

/* URL -> filter.  `fromUrl` = URL me filter the ya nahi (tab default mat thopo). */
export function qprFromQuery(sp) {
  return {
    fromUrl: sp.has("fy"),
    fy: sp.get("fy") ?? "", month: sp.get("month") ?? "", date: sp.get("date") ?? "",
    zone: sp.get("zone") ?? "", line: sp.get("line") ?? "", mc: sp.get("mc") ?? "",
    src: sp.get("src") || "manual",
  };
}
