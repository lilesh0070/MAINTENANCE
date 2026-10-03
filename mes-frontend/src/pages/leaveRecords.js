/* leaveRecords.js — Leave ke RECORDS ka hisaab (AttendanceLeave.jsx ka Records
 * tab + Excel).  User 2026-10-03: "leave ka month wise, yearly sab kuch record
 * download kar sake -- maint ID se bhi; dikhe kisne apply ki, kiski approve
 * hui, kiski reject".
 *
 * Sirf saade function (React nahi) -- alag isliye ki node se seedha jaancha ja
 * sake, aur Fast Refresh ka niyam (component file se sirf component) na toote.
 * Tareekh hamesha "YYYY-MM-DD" string (local), Date ka UTC chakkar nahi.
 */
import { rankOf } from "../constants/hierarchy";

export const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n) => String(n).padStart(2, "0");
const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dateOf = (s) => { const [y, m, d] = String(s).slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = dateOf(s); d.setDate(d.getDate() + n); return isoOf(d); };
const spanDays = (a, b) => Math.round((dateOf(b) - dateOf(a)) / 86400000) + 1;
const lastDay = (y, m) => new Date(y, m, 0).getDate();            // m = 1..12

/** Period -> [from, to].  month = ek mahina · fy = Apr–Mar · year = Jan–Dec ·
 *  custom (ya anjaan) = null (bulane wala apni tareekh rakhe). */
export function periodRange(per, mon, yr, fy) {
  if (per === "month") return [`${yr}-${pad(mon)}-01`, `${yr}-${pad(mon)}-${pad(lastDay(yr, mon))}`];
  if (per === "fy") return [`${fy}-04-01`, `${fy + 1}-03-31`];
  if (per === "year") return [`${yr}-01-01`, `${yr}-12-31`];
  return null;
}

/** [from, to] ke beech ke mahine -- Summary sheet ke column (36 tak). */
export function monthsIn(from, to) {
  const out = [];
  let y = Number(from.slice(0, 4)), m = Number(from.slice(5, 7));
  const ey = Number(to.slice(0, 4)), em = Number(to.slice(5, 7));
  while ((y < ey || (y === ey && m <= em)) && out.length < 36) {
    out.push({ key: `${y}-${pad(m)}`, label: `${MON[m - 1]} ${y}` });
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

/** Leave ke kitne din [from, to] ke andar. */
export const daysWithin = (r, from, to) => {
  const a = r.from_date > from ? r.from_date : from;
  const b = r.to_date < to ? r.to_date : to;
  return b < a ? 0 : spanDays(a, b);
};

/** Haal ki ginti (PENDING / APPROVED / REJECTED / CANCELLED). */
export function statusCounts(rows) {
  const c = { PENDING: 0, APPROVED: 0, REJECTED: 0, CANCELLED: 0 };
  (rows || []).forEach((r) => { if (r.status in c) c[r.status] += 1; });
  return c;
}

/** Excel ki "Summary" sheet: har aadmi x mahina -- APPROVED din (sirf period ke
 *  andar, har din apne mahine me) + har haal ki arziyon ki ginti.  Log hierarchy
 *  kram me (Manager pehle), phir naam. */
export function leaveSummary(rows, from, to) {
  const months = monthsIn(from, to);
  const log = new Map();
  for (const r of rows || []) {
    const k = r.staff_id != null ? `s${r.staff_id}` : `n${r.staff_name}`;
    if (!log.has(k)) {
      log.set(k, { name: r.staff_name, emp: r.emp_code || "", desig: r.designation || "",
                   m: Object.fromEntries(months.map((x) => [x.key, 0])),
                   c: { PENDING: 0, APPROVED: 0, REJECTED: 0, CANCELLED: 0 } });
    }
    const p = log.get(k);
    if (r.status in p.c) p.c[r.status] += 1;
    if (r.status !== "APPROVED") continue;
    const a = r.from_date > from ? r.from_date : from;
    const b = r.to_date < to ? r.to_date : to;
    for (let d = a; d <= b; d = addDays(d, 1)) {
      const mk = d.slice(0, 7);
      if (mk in p.m) p.m[mk] += 1;
    }
  }
  const list = [...log.values()].sort((x, y) => rankOf({ designation: x.desig }) - rankOf({ designation: y.desig })
    || String(x.name).localeCompare(String(y.name)));
  return {
    sheet: "Summary",
    headers: ["#", "Name", "Emp Code", "Designation", ...months.map((x) => x.label), "Approved days",
              "Pending", "Approved", "Rejected", "Cancelled"],
    rows: list.map((p, i) => [i + 1, p.name, p.emp, p.desig, ...months.map((x) => p.m[x.key] || 0),
                              months.reduce((n, x) => n + (p.m[x.key] || 0), 0),
                              p.c.PENDING, p.c.APPROVED, p.c.REJECTED, p.c.CANCELLED]),
  };
}
