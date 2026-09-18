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

/* Wo slips jo QPR me GINI jaati hain: filter + M/C DOWN TIME >= hadd.
   `f` = { fy, month, date, zone, line, mc } -- khaali ho to wo filter nahi.
   Machine khaali ho (DB me abhi ek bhi nahi) to wo "—" ke naam se chalti hai,
   jaise Pareto me. */
export function qprSlips(rows, f, hadd) {
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
    return (Number(r.solve_time_min) || 0) >= hadd;
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
  return p;
}

/* URL -> filter.  `fromUrl` = URL me filter the ya nahi (tab default mat thopo). */
export function qprFromQuery(sp) {
  return {
    fromUrl: sp.has("fy"),
    fy: sp.get("fy") ?? "", month: sp.get("month") ?? "", date: sp.get("date") ?? "",
    zone: sp.get("zone") ?? "", line: sp.get("line") ?? "", mc: sp.get("mc") ?? "",
  };
}
