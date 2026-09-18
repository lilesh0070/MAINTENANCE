/* ───────────────────────────────────────────────────────────────────
 * BreakdownQPR.jsx  —  Breakdown → Breakdown QPR
 * ───────────────────────────────────────────────────────────────────
 * Kaagaz wala format "LOSSES AGAINST MACHINE B/D, PARETO ANALYSIS OF <mahina>"
 * (user ki photo se), filter ke neeche:
 *   upar  -- machine_no | LOSSES (MIN.) | CUM | CUMM%  +  "MACHINE DOWN TIMEWISE"
 *   neeche -- M/C NO    | B/D FREQ      | CUMM | CUMM% +  "Machine Down Freq wise"
 * (Kaagaz par pehla khaana "DESCRIPTION" tha -- user ne kaha wahan
 * "machine_no" likho.)
 *
 * DATA -- sirf manual Break Down Slip wali table (`maintenance_breakdown_data`,
 * GET /api/breakdowns/log -- BD History ka hi source).  Usme se SIRF wo slip
 * jinka M/C DOWN TIME (min) hadd ke BARABAR ya UPAR ho.  Hadd default 55;
 * use SIRF ADMIN badalta hai (filter ki line me daayen) -- baaki sab sirf
 * dekhte hain.  Hadd server par rehti hai (GET/PUT /api/breakdowns/qpr-config),
 * isliye admin ka badla hua number sabke liye ek saath lagta hai.
 *
 * Pareto: machine-wise jod (minute / ginti), bade se chhota; CUM = chalta
 * jod, CUMM% = chalta jod / kul * 100 (gol).  Ginti ke barabar hone par jiske
 * minute zyada wo pehle -- kaagaz par bhi yahi kram tha.
 *
 * Zone / Line / Machine No. -- Machine Master (`GET /api/machines/`) se, zone
 * me sirf 6 production zone -- baaki breakdown page jaisa.
 *
 * Styling: page ki patti/filter BD History ki `bh-` class se (responsive.css
 * me unke phone/tablet/TV niyam pehle se hain); sheet ki apni `bq-` class.
 *
 * Routing:    /maintenance-breakdown/breakdown-qpr
 * Permission: maintenance-breakdown-qpr (set na ho to Breakdown se milti hai)
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, LabelList,
} from "recharts";
import { useAuth } from "../context/AuthContext";
import { onlyProdZones } from "../constants/zones";

const api = {
  async req(method, path, token, body) {
    const r = await fetch(path, {
      method,
      headers: { Authorization: `Bearer ${token}`,
                 ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
    return r.json();
  },
  get(path, token)       { return this.req("GET", path, token); },
  put(path, token, body) { return this.req("PUT", path, token, body); },
};

const QPR_DEFAULT_MIN = 55;      // server par kuch save na ho / na mile to

const pad2 = (n) => String(n).padStart(2, "0");
/* "2026-09" -> "2026-09-30" (us mahine ka aakhri din) */
const mahineKaAnt = (ym) => {
  const [y, m] = String(ym).split("-").map(Number);
  return y && m ? `${ym}-${pad2(new Date(y, m, 0).getDate())}` : "";
};
const MON = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/* FY Apr -> Mar ke 12 mahine -- BD History / History Card jaisa hi. */
function fyMonths(fy) {
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
function fyWindow(fy) {
  const y = parseInt(String(fy).split("-")[0], 10);
  if (isNaN(y)) return null;
  return { start: `${y}-04-01`, end: `${y + 1}-04-01`, last: `${y + 1}-03-31` };
}

// Rang wahi jo Pareto Analysis page par hain (Excel jaise).
const BAR_T = "#1f4e79", LINE_T = "#c0392b";     // down time
const BAR_F = "#5b9bd5", LINE_F = "#70ad47";     // frequency
/* Legend me pehle bar, phir CUMM% -- kaagaz jaisa.  recharts khud A-Z
   sort karta hai, to "CUMM%" "LOSSES (MIN.)" se pehle aa jaata tha. */
const barPehle = (it) => (it.value === "CUMM%" ? 1 : 0);

/* Ek Pareto chart -- bar = value (baayen), tooti line = CUMM% (daayen 0-100). */
function ParetoChart({ title, data, barName, yLabel, barColor, lineColor, unit }) {
  const tircha = data.length > 6;      // zyada machine ho to naam tirchhe
  return (
    <div className="bq-chart">
      <div className="bq-chart-title">{title}</div>
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={data} margin={{ top: 26, right: 8, left: 6, bottom: 2 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
          <XAxis dataKey="mc" interval={0} angle={tircha ? -35 : 0}
                 textAnchor={tircha ? "end" : "middle"} height={tircha ? 72 : 28}
                 tick={{ fontSize: 10.5, fontWeight: 700, fill: "#334155" }} />
          <YAxis yAxisId="v" allowDecimals={false} tick={{ fontSize: 11, fill: "#475569" }}
                 label={{ value: yLabel, angle: -90, position: "insideLeft",
                          style: { fontSize: 10.5, fontWeight: 800, fill: "#334155" } }} />
          <YAxis yAxisId="pct" orientation="right" domain={[0, 100]}
                 ticks={[0, 20, 40, 60, 80, 100]} tick={{ fontSize: 11, fill: "#475569" }} />
          <Tooltip formatter={(v, n) => (n === "CUMM%" ? [`${v}%`, "CUMM%"] : [`${v}${unit}`, barName])}
                   contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0",
                                   fontFamily: "'Barlow',sans-serif", fontSize: 12.5, fontWeight: 600 }} />
          <Legend itemSorter={barPehle} wrapperStyle={{ fontSize: 11.5, fontWeight: 700 }} />
          <Bar yAxisId="v" dataKey="val" name={barName} fill={barColor} maxBarSize={56}>
            <LabelList dataKey="val" position="top"
                       style={{ fontSize: 11.5, fontWeight: 800, fill: "#0f172a" }} />
          </Bar>
          <Line yAxisId="pct" dataKey="pct" name="CUMM%" type="linear"
                stroke={lineColor} strokeWidth={2.5} strokeDasharray="7 6"
                dot={{ r: 3, fill: lineColor }} activeDot={{ r: 5 }}>
            {/* Safed kinara (halo) -- line ka number aksar gaadhe bar ke UPAR
                padta hai (pehli machine par hamesha), bina iske padha nahi jaata. */}
            <LabelList dataKey="pct" position="top" offset={10}
                       style={{ fontSize: 11.5, fontWeight: 800, fill: "#334155",
                                stroke: "#fff", strokeWidth: 3, paintOrder: "stroke" }} />
          </Line>
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/* Kaagaz jaisi table -- pehla khaana machine, phir value / chalta jod / %. */
function ParetoTable({ head, rows }) {
  return (
    <table className="bq-table">
      <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.mc}><td>{r.mc}</td><td>{r.val}</td><td>{r.cum}</td><td>{r.pct}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

export default function BreakdownQPR() {
  const { token, theme, user, isAdmin } = useAuth();
  const nav = useNavigate();
  const [years, setYears]   = useState([]);
  const [fFy, setFFy]       = useState("");
  const [fMonth, setFMonth] = useState("");
  // Date khaali -- Pareto MAHINE ka banta hai (kaagaz: "... OF Dec-2025").
  // Aaj ka din default rakhte to zyadatar din sheet khaali khulti.
  const [fDate, setFDate]   = useState("");
  const [fZone, setFZone]   = useState("");
  const [fLine, setFLine]   = useState("");
  const [fMachineNo, setFMachineNo] = useState("");
  const [master, setMaster] = useState([]);
  const [ready, setReady]   = useState(false);   // FY/Month tay hone ke BAAD hi data maango
  const booted = useRef(false);                   // FY/Month ka default sirf EK baar

  // QPR ki hadd (minute) -- server se.  `null` = abhi aayi nahi.
  const [minDown, setMinDown] = useState(null);
  const [draft, setDraft]     = useState("");     // admin ka likha hua (save se pehle)
  const [saving, setSaving]   = useState(false);
  const [kehna, setKehna]     = useState(null);   // { text, ok }

  useEffect(() => {
    if (!token) return;
    api.get("/api/maintenance-kpi/financial-years", token).then((y) => {
      const list = Array.isArray(y) ? y : [];
      setYears(list);
      if (!booted.current && list.length) {
        booted.current = true;
        const cur = (list.find((v) => v.is_current) || list[list.length - 1]).fy;
        setFFy(cur);
        // Month default = abhi ka mahina (agar wo is FY me aata ho).
        const now = new Date();
        const cm = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
        if (fyMonths(cur).some((m) => m.value === cm)) setFMonth(cm);
      }
      setReady(true);
    }).catch(() => { setYears([]); setReady(true); });
    api.get("/api/machines/", token).then((m) => setMaster(Array.isArray(m) ? m : [])).catch(() => setMaster([]));
    // Hadd na mile (jaise purana backend) to 55 -- page phir bhi sahi chale.
    api.get("/api/breakdowns/qpr-config", token)
      .then((c) => {
        const v = Number.isFinite(Number(c?.min_down_time_min)) ? Number(c.min_down_time_min) : QPR_DEFAULT_MIN;
        setMinDown(v); setDraft(String(v));
      })
      .catch(() => { setMinDown(QPR_DEFAULT_MIN); setDraft(String(QPR_DEFAULT_MIN)); });
  }, [token]);

  // Slips FY ki khidki ke hisaab se aati hain (BD History jaisa); baaki
  // filter aur hadd yahin lagte hain.  `key` se pata chalta hai ki jo data
  // haath me hai wo ABHI wali FY ka hai ya purana -- isi se "Loading…".
  const reqKey = ready ? (fFy || "ALL") : "";
  const [got, setGot] = useState({ key: "", rows: [], err: "" });
  useEffect(() => {
    if (!token || !reqKey) return;
    let band = false;
    const qs = new URLSearchParams({ limit: "3000" });
    const w = fFy ? fyWindow(fFy) : null;
    if (w) { qs.set("date_from", w.start); qs.set("date_to", w.last); }
    api.get(`/api/breakdowns/log?${qs.toString()}`, token)
      .then((r) => { if (!band) setGot({ key: reqKey, rows: (r?.rows || []).filter((x) => x.bd_date), err: "" }); })
      .catch((e) => { if (!band) setGot({ key: reqKey, rows: [], err: e?.message || "Could not load breakdowns" }); });
    return () => { band = true; };
  }, [token, reqKey, fFy]);
  const loading = minDown === null || !reqKey || got.key !== reqKey;
  const hadd = minDown ?? QPR_DEFAULT_MIN;

  const monthOpts = useMemo(() => (fFy ? fyMonths(fFy) : []), [fFy]);
  const zoneOpts = useMemo(() => onlyProdZones([...new Set(master.map((m) => m.zone_name).filter(Boolean))]), [master]);
  const lineOpts = useMemo(() => fZone
    ? [...new Set(master.filter((m) => m.zone_name === fZone).map((m) => m.line_name).filter(Boolean))].sort() : [], [master, fZone]);
  const machineNoOpts = useMemo(() => (fZone && fLine)
    ? [...new Set(master.filter((m) => m.zone_name === fZone && m.line_name === fLine)
                        .map((m) => m.machine_no).filter(Boolean))].sort() : [], [master, fZone, fLine]);

  const onFy = (v) => { setFFy(v); setFMonth(""); setFDate(""); };
  /* Mahina badla aur chuna hua din us mahine ka nahi -- to din hata do. */
  const onMonth = (v) => { setFMonth(v); if (fDate && v && fDate.slice(0, 7) !== v) setFDate(""); };
  const onZone = (v) => { setFZone(v); setFLine(""); setFMachineNo(""); };
  const onLine = (v) => { setFLine(v); setFMachineNo(""); };

  // Filter + hadd ke baad machine-wise Pareto (dono -- minute aur ginti).
  const { timeRows, freqRows } = useMemo(() => {
    const w = fFy ? fyWindow(fFy) : null;
    const by = new Map();
    for (const r of got.rows) {
      const d = String(r.bd_date).slice(0, 10);
      if (w && !(d >= w.start && d < w.end)) continue;
      if (fMonth && d.slice(0, 7) !== fMonth) continue;
      if (fDate && d !== fDate) continue;
      if (fZone && r.zone_code !== fZone) continue;
      if (fLine && r.line_code !== fLine) continue;
      if (fMachineNo && r.machine_no !== fMachineNo) continue;
      const mins = Number(r.solve_time_min) || 0;
      if (mins < hadd) continue;                      // hadd ke BARABAR ya upar hi
      const k = r.machine_no || "—";
      const o = by.get(k) || { mc: k, min: 0, freq: 0 };
      o.min += mins; o.freq += 1;
      by.set(k, o);
    }
    const all = [...by.values()];
    const kulMin  = all.reduce((s, o) => s + o.min, 0);
    const kulFreq = all.reduce((s, o) => s + o.freq, 0);
    let c = 0;
    const t = [...all]
      .sort((a, b) => b.min - a.min || b.freq - a.freq || a.mc.localeCompare(b.mc))
      .map((o) => { c += o.min; return { mc: o.mc, val: o.min, cum: c, pct: kulMin ? Math.round((c / kulMin) * 100) : 0 }; });
    let f = 0;
    const fr = [...all]
      .sort((a, b) => b.freq - a.freq || b.min - a.min || a.mc.localeCompare(b.mc))
      .map((o) => { f += o.freq; return { mc: o.mc, val: o.freq, cum: f, pct: kulFreq ? Math.round((f / kulFreq) * 100) : 0 }; });
    return { timeRows: t, freqRows: fr };
  }, [got.rows, fFy, fMonth, fDate, fZone, fLine, fMachineNo, hadd]);

  /* Sheet ke naam me samay -- kaagaz par "OF Dec -2025" tha. */
  const kab = fDate ? (() => { const [y, m, d] = fDate.split("-"); return `${d}-${MON[Number(m)]}-${y}`; })()
            : fMonth ? (() => { const [y, m] = fMonth.split("-"); return `${MON[Number(m)]}-${y}`; })()
            : fFy ? `FY ${fFy}` : "All Years";

  const badla = draft.trim() !== String(minDown ?? "");
  const haddSambhalo = async () => {
    if (saving) return;
    const n = Number(draft);
    if (draft.trim() === "" || !Number.isInteger(n) || n < 0) {
      setKehna({ text: "Enter whole minutes (0 or more)", ok: false });
      return;
    }
    setSaving(true); setKehna(null);
    try {
      const r = await api.put("/api/breakdowns/qpr-config", token, { min_down_time_min: n });
      const v = Number(r?.min_down_time_min);
      setMinDown(v); setDraft(String(v));
      setKehna({ text: "Saved", ok: true });
    } catch {
      setKehna({ text: "Could not save", ok: false });
    } finally {
      setSaving(false);
      setTimeout(() => setKehna(null), 4000);
    }
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700;800&family=Barlow+Condensed:wght@700;800&display=swap');
        .bh-root { min-height:100vh; background:#eef2f7; font-family:'Barlow',sans-serif; padding-bottom:50px; }
        .bh-top { background:#fff; border-bottom:1px solid #e2e8f0; height:56px; padding:0 28px 0 96px;
                  display:flex; align-items:center; justify-content:space-between;
                  position:sticky; top:0; z-index:50; box-shadow:0 1px 3px rgba(0,0,0,.06); }
        .bh-top::after { content:''; position:absolute; bottom:0; left:0; right:0; height:2px; background:${theme.gradient}; }
        .bh-title { font-family:'Barlow Condensed',sans-serif; font-size:22px; font-weight:800; color:#0f172a; }
        .bh-title span { color:${theme.accent}; }
        .bh-back { display:flex; align-items:center; gap:6px; font-size:13px; font-weight:700; color:#475569;
                   background:#f1f5f9; border:1px solid #e2e8f0; border-radius:8px; padding:7px 14px; cursor:pointer; }
        .bh-body { max-width:1500px; margin:18px auto 0; padding:0 22px; }
        .bh-filters { display:flex; gap:12px; flex-wrap:wrap; align-items:flex-end; margin-bottom:16px; }
        .bh-fld { display:flex; flex-direction:column; gap:5px; }
        .bh-fld label { font-size:10.5px; font-weight:800; letter-spacing:.05em; text-transform:uppercase; color:#64748b; }
        .bh-sel { border:1.5px solid #cbd5e1; border-radius:9px; padding:9px 12px; font-size:13px; font-weight:600;
                  color:#0f172a; outline:none; font-family:'Barlow',sans-serif; background:#fff; min-width:150px; }
        .bh-sel:focus { border-color:${theme.accent}; }
        .bh-sel:disabled { background:#f1f5f9; color:#94a3b8; cursor:not-allowed; }
        .bh-date { min-width:150px; }

        /* hadd -- filter ki line me SABSE DAAYEN */
        .bq-hadd { margin-left:auto; }
        .bq-hadd-row { display:flex; align-items:center; gap:8px; }
        .bq-hadd-in { min-width:0; width:92px; }
        .bq-hadd-ro { min-width:0; width:92px; background:#f8fafc; color:#0f172a; }
        .bq-save { border:1px solid #1d4ed8; background:#2563eb; color:#fff; border-radius:9px; padding:9px 16px;
                   font-size:13px; font-weight:800; cursor:pointer; font-family:'Barlow',sans-serif; }
        .bq-save:disabled { background:#93c5fd; border-color:#93c5fd; cursor:default; }
        .bq-kehna { font-size:11.5px; font-weight:800; }

        /* kaagaz jaisa sheet */
        .bq-sheet { background:#fff; border:2px solid #111827; }
        .bq-title { background:#e5e7eb; border-bottom:2px solid #111827; padding:10px 16px; text-align:center;
                    font-family:'Barlow Condensed',sans-serif; font-size:22px; font-weight:800; color:#111827; }
        .bq-row { display:flex; flex-wrap:wrap; gap:16px; padding:14px; align-items:flex-start; }
        .bq-row + .bq-row { border-top:2px solid #111827; }
        .bq-tbl { flex:0 1 430px; min-width:280px; }
        .bq-table { width:100%; border-collapse:collapse; font-size:13px; color:#111827; }
        .bq-table th, .bq-table td { border:1px solid #111827; padding:5px 8px; text-align:center; }
        .bq-table th { background:#f3f4f6; font-weight:800; font-size:12px; }
        .bq-table td:first-child { font-weight:700; }
        .bq-chart { flex:1 1 440px; min-width:0; border:1.5px solid #111827; padding:6px 8px 0; }
        .bq-chart-title { text-align:center; font-size:14px; font-weight:700; color:#111827; }
        .bq-empty { padding:50px 16px; text-align:center; color:#64748b; font-size:13.5px; font-weight:600; }
      `}</style>

      <div className="bh-root">
        <div className="bh-top">
          <div style={{ display:"flex", alignItems:"center", gap:14 }}>
            <button className="bh-back" onClick={() => nav("/maintenance-breakdown")}>← Back</button>
            <div className="bh-title">Breakdown <span>QPR</span></div>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            {user?.username && <span className="app-user" style={{ fontSize:12, color:"#64748b", fontWeight:600 }}>{user.username}</span>}
          </div>
        </div>

        <div className="bh-body">
          <div className="bh-filters">
            <div className="bh-fld">
              <label>Financial Year</label>
              <select className="bh-sel" value={fFy} onChange={(e) => onFy(e.target.value)}>
                <option value="">All Financial Years</option>
                {years.map((y) => <option key={y.fy} value={y.fy}>{y.fy}{y.is_current ? "  (current)" : ""}</option>)}
              </select>
            </div>
            <div className="bh-fld">
              <label>Month</label>
              <select className="bh-sel" value={fMonth} onChange={(e) => onMonth(e.target.value)} disabled={!fFy}>
                <option value="">All Months</option>
                {monthOpts.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            <div className="bh-fld">
              <label>Date</label>
              {/* Mahina chuna ho to calendar usi mahine tak simit. */}
              <input type="date" className="bh-sel bh-date" value={fDate}
                     min={fMonth ? `${fMonth}-01` : undefined}
                     max={fMonth ? mahineKaAnt(fMonth) : undefined}
                     onChange={(e) => setFDate(e.target.value)} />
            </div>
            <div className="bh-fld">
              <label>Zone</label>
              <select className="bh-sel" value={fZone} onChange={(e) => onZone(e.target.value)}>
                <option value="">All Zones</option>
                {zoneOpts.map((z) => <option key={z} value={z}>{z}</option>)}
              </select>
            </div>
            <div className="bh-fld">
              <label>Line</label>
              <select className="bh-sel" value={fLine} onChange={(e) => onLine(e.target.value)} disabled={!fZone}>
                <option value="">All Lines</option>
                {lineOpts.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div className="bh-fld">
              <label>Machine No.</label>
              <select className="bh-sel" value={fMachineNo} onChange={(e) => setFMachineNo(e.target.value)} disabled={!fLine}>
                <option value="">All Machine No.</option>
                {machineNoOpts.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>

            {/* Hadd -- sirf admin badalta hai; baaki ko sirf dikhti hai. */}
            <div className="bh-fld bq-hadd">
              <label>Down time ≥ (min)</label>
              {isAdmin ? (
                <div className="bq-hadd-row">
                  <input type="number" min={0} max={1440} step={1} className="bh-sel bq-hadd-in"
                         value={draft} disabled={minDown === null}
                         onChange={(e) => setDraft(e.target.value)}
                         onKeyDown={(e) => { if (e.key === "Enter") haddSambhalo(); }} />
                  <button type="button" className="bq-save" onClick={haddSambhalo}
                          disabled={saving || minDown === null || !badla}>
                    {saving ? "Saving…" : "Save"}
                  </button>
                  {kehna && (
                    <span className="bq-kehna" style={{ color: kehna.ok ? "#15803d" : "#b91c1c" }}>
                      {kehna.ok ? "✓ " : ""}{kehna.text}
                    </span>
                  )}
                </div>
              ) : (
                <div className="bh-sel bq-hadd-ro" title="Set by admin">
                  {minDown === null ? "…" : `${minDown} min`}
                </div>
              )}
            </div>
          </div>

          <div className="bq-sheet">
            <div className="bq-title">LOSSES AGAINST MACHINE B/D, PARETO ANALYSIS OF {kab}</div>
            {loading ? (
              <div className="bq-empty">Loading…</div>
            ) : got.err ? (
              <div className="bq-empty" style={{ color: "#b91c1c" }}>Could not load breakdowns — {got.err}</div>
            ) : timeRows.length === 0 ? (
              <div className="bq-empty">No breakdown of {hadd} min or more for this filter.</div>
            ) : (
              <>
                {/* upar -- down time (minute) */}
                <div className="bq-row">
                  <div className="bq-tbl">
                    <ParetoTable head={["machine_no", "LOSSES (MIN.)", "CUM", "CUMM%"]} rows={timeRows} />
                  </div>
                  <ParetoChart title="MACHINE DOWN TIMEWISE" data={timeRows}
                               barName="LOSSES (MIN.)" yLabel="TIME IN MINUTES" unit=" min"
                               barColor={BAR_T} lineColor={LINE_T} />
                </div>
                {/* neeche -- frequency (kitni baar) */}
                <div className="bq-row">
                  <div className="bq-tbl">
                    <ParetoTable head={["M/C NO", "B/D FREQ", "CUMM", "CUMM%"]} rows={freqRows} />
                  </div>
                  <ParetoChart title="Machine Down Freq wise" data={freqRows}
                               barName="B/D FREQ" yLabel="FREQUENCY NUMBER" unit=""
                               barColor={BAR_F} lineColor={LINE_F} />
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
