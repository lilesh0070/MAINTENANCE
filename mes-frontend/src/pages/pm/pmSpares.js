/* pm/pmSpares.js — PM sheet ke neeche wali "Spares Used (this sheet)" list ke
 * kaam, aur Format 2 ke "SPARES USED" (YES / NO) column se uska jod.
 *
 * User (2026-10-03): "naye format me status ke aage spare ka column -- pehli
 * click YES, doosri NO; YES kiya to neeche spare wali list me Where Used me
 * point no. apne aap aa jaye, wahan spare ki detail bhar de; aur spare chahiye
 * to Add spare se kar le."
 *
 * Jod Where Used ke LIKHE text se hai ("Point 5 - ...") -- koi chhupi key nahi.
 * Isliye wapas aayi (returned) sheet, History ka admin edit -- sab jagah wahi
 * niyam chalta hai; server where_used jyon ka tyon rakhta / lautata hai.
 *
 * Component file se ALAG -- Fast Refresh ka niyam (sirf component export).
 */
export const EMPTY_SPARE = { spare_name: "", spare_model_no: "", spare_cnmm_no: "", spare_qty: "" };

// Spare ERP Number mask — 4 alphabetic letters + 4 numeric digits (ABCD1234).
export const fmtErp = (raw) => {
  const s = String(raw || "").toUpperCase();
  let out = "";
  for (const ch of s) {
    if (out.length < 4) { if (ch >= "A" && ch <= "Z") out += ch; }
    else if (out.length < 8) { if (ch >= "0" && ch <= "9") out += ch; }
  }
  return out;
};

/** List ki ek cell badlo: ERP mask; jaana-pehchana Spare Name -> Model / ERP
 *  master se khud bhar do.  `master` = /api/maintenance-spare/ ki list. */
export function editSpareRow(rows, ri, key, val, master) {
  const next = (rows || []).map((r, j) =>
    (j === ri ? { ...r, [key]: (key === "spare_cnmm_no" ? fmtErp(val) : val) } : r));
  if (key === "spare_name" && next[ri]) {
    const m = (master || []).find((x) => (x.spare_name || "").toLowerCase() === String(val || "").toLowerCase());
    if (m) next[ri] = { ...next[ri],
      spare_model_no: m.spare_model_no || next[ri].spare_model_no,
      spare_cnmm_no:  m.spare_cnmm_no  || next[ri].spare_cnmm_no };
  }
  return next;
}

/** Tap: khaali -> YES -> NO -> khaali (Status jaisa). */
export const nextSpare = (s) => (s === "YES" ? "NO" : s === "NO" ? "" : "YES");

export const isSpareYes = (p) => String((p && p.spares_used) || "").trim().toUpperCase() === "YES";

/** Point ka number -- sheet ka S.NO. (na ho to kram). */
export const spareNo = (p, i) => String((p && p.s_no) || i + 1).trim();

/** YES par bani row ka Where Used: "Point 5 - PLC panel". */
export const spareWhere = (p, i) => {
  const cp = String((p && p.check_point) || "").replace(/\s+/g, " ").trim();
  return cp ? `Point ${spareNo(p, i)} - ${cp}` : `Point ${spareNo(p, i)}`;
};

/** Ye row is point ki hai?  "Point 5", "point 5 - x" haan; "Point 50" nahi. */
export const isPointRow = (r, no) => {
  const esc = String(no).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^\\s*point\\s*0*${esc}(?![0-9])`, "i").test(String((r && r.where_used) || ""));
};

/** Row me spare ki koi detail bhari hai? (Where Used ke alawa) */
export const spareRowBhari = (r) =>
  Object.keys(EMPTY_SPARE).some((k) => String((r && r[k]) || "").trim());

/** YES wale point jinki neeche ek bhi row me Spare Name nahi -- save rokne ke liye. */
export const spareMissing = (points, rows) =>
  (points || []).map((p, i) => (isSpareYes(p) ? spareNo(p, i) : null)).filter(Boolean)
    .filter((no) => !(rows || []).some((r) => isPointRow(r, no) && String(r.spare_name || "").trim()));

/** YES points ki kunji -- sirf isi ke badalne par list milani hai (har akshar par nahi). */
export const spareYesKey = (points) =>
  (points || []).map((p, i) => (isSpareYes(p) ? spareNo(p, i) : "")).filter(Boolean).join(",");

/** List ko YES points se milao: YES point ki koi row nahi -> nayi row (Where
 *  Used bhara, baaki khaali); jo point ab YES nahi uski ANCHHUI row (Where Used
 *  wahi jo humne likha tha, baaki khaali) hata do.  Bhari row kabhi nahi
 *  hatti.  Kuch na badle to WAHI array -- re-render ka chakkar nahi. */
export function syncSpareRows(points, rows) {
  const list = rows || [];
  const anchhui = new Set();
  (points || []).forEach((p, i) => { if (!isSpareYes(p)) anchhui.add(spareWhere(p, i)); });
  const out = list.filter((r) => !(anchhui.has(String(r.where_used || "")) && !spareRowBhari(r)));
  const add = [];
  (points || []).forEach((p, i) => {
    if (!isSpareYes(p)) return;
    const no = spareNo(p, i);
    if (!out.some((r) => isPointRow(r, no)) && !add.some((r) => isPointRow(r, no)))
      add.push({ where_used: spareWhere(p, i), ...EMPTY_SPARE });
  });
  if (!add.length && out.length === list.length) return list;
  return [...out, ...add];
}

/** YES hataya: is point ki saari rows hatao.  `bhari` = kitni me detail thi --
 *  bulane wala tab pehle poochhe (galti ki tap par likha hua na jaaye). */
export function spareHatao(rows, p, i) {
  const no = spareNo(p, i);
  const mine = (rows || []).filter((r) => isPointRow(r, no));
  return { rows: (rows || []).filter((r) => !isPointRow(r, no)), bhari: mine.filter(spareRowBhari).length };
}

/** Haan / naa poochne ki line (English -- UI). */
export const spareHataoSawal = (p, i, nayi, bhari) =>
  `Point ${spareNo(p, i)} has ${bhari} spare ${bhari === 1 ? "row" : "rows"} filled in “Spares Used” below.\n`
  + `Remove ${bhari === 1 ? "it" : "them"} and set Spares Used to ${nayi || "blank"}?`;
