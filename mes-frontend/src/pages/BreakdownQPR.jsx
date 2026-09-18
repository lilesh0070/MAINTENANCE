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
 * Filter ki line me Machine No. ke THEEK aage "View" (user ne yahi jagah
 * batayi -- table ki har row me nahi) -> BreakdownQprMachine.jsx: chuni hui
 * machine ki WAHI slips jo yahan gini gayi.  Chhaanne ka niyam dono ka ek
 * (`constants/qpr.js`).  Filter URL me rehte hain, isliye wahan se lautne par
 * yahi filter wapas.
 *
 * Styling: page ki patti/filter BD History ki `bh-` class se (responsive.css
 * me unke phone/tablet/TV niyam pehle se hain); sheet ki apni `bq-` class.
 *
 * Routing:    /maintenance-breakdown/breakdown-qpr
 * Permission: maintenance-breakdown-qpr (set na ho to Breakdown se milti hai)
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, LabelList,
} from "recharts";
import { useAuth } from "../context/AuthContext";
import { onlyProdZones } from "../constants/zones";
import {
  QPR_DEFAULT_MIN, QPR_MACHINE_PATH, pad2, mahineKaAnt, fyMonths, fyWindow,
  kabLabel, qprSlips, qprQuery, qprFromQuery,
} from "../constants/qpr";

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

// Rang wahi jo Pareto Analysis page par hain (Excel jaise).
const BAR_T = "#1f4e79", LINE_T = "#c0392b";     // down time
const BAR_F = "#5b9bd5", LINE_F = "#70ad47";     // frequency
/* Legend me pehle bar, phir CUMM% -- kaagaz jaisa.  recharts khud A-Z
   sort karta hai, to "CUMM%" "LOSSES (MIN.)" se pehle aa jaata tha. */
const barPehle = (it) => (it.value === "CUMM%" ? 1 : 0);

/* Bar wali (baayen) axis: upar ~25% khaali, aur GOL ginti par.
   Khaali jagah isliye ki sabse bada bar CUMM% ki 100 wali line tak na
   pahunche -- warna dono ke number ek-doosre par chadh jaate (ek machine par
   "195" aur "100" ek hi jagah).  Kaagaz par bhi bar line se neeche the.
   Ticks khud dete hain: recharts ko sirf max dene par axis 0/65/130/195/244
   jaisa ajeeb banta tha.  ~5 khaane; 2.5 wala kadam sirf 10 se upar (ginti
   wali axis par 2.5 bemaani hai). */
function barAxis(data) {
  const m = Math.max(0, ...data.map((d) => Number(d.val) || 0));
  const v = Math.max(1, m * 1.25);
  const kachcha = v / 5;
  const p = Math.pow(10, Math.floor(Math.log10(kachcha)));
  const kram = p >= 10 ? [1, 2, 2.5, 5, 10] : [1, 2, 5, 10];
  const step = Math.max(1, kram.map((x) => x * p).find((s) => s >= kachcha) || 10 * p);
  const max = step * Math.ceil(v / step);
  const ticks = [];
  for (let t = 0; t <= max + 1e-9; t += step) ticks.push(Math.round(t * 100) / 100);
  return { max, ticks };
}

/* Ek Pareto chart -- bar = value (baayen), tooti line = CUMM% (daayen 0-100). */
function ParetoChart({ title, data, barName, yLabel, barColor, lineColor, unit }) {
  const tircha = data.length > 6;      // zyada machine ho to naam tirchhe
  const ax = barAxis(data);
  // Tirchhe (35°) naam ke liye neeche kitni jagah -- sabse LAMBE naam se.
  // 72px pakka rakha tha to SA_4W_YSD_PWM_24 jaisa naam legend par 4px
  // chadh jaata tha (naapa); ~7.5px har akshar (TV ke 11px tak), sin 35° = 0.574.
  const lamba = Math.max(4, ...data.map((d) => String(d.mc).length));
  const xH = tircha ? Math.min(140, Math.ceil(lamba * 7.5 * 0.574) + 22) : 28;
  // Oonchai CSS se (`.bq-plot`) -- number wali height recharts CSS se badalne
  // nahi deta, aur TV par graph bada chahiye (responsive.css).  Tirchhe naam
  // neeche ~44px zyada lete hain, isliye `tircha` par 344, warna plot chhota
  // ho kar baayen ka "FREQUENCY NUMBER" kat jaata tha.
  // `--bq-min`: har machine ko ~26px.  Sirf PHONE ka CSS ise lagata hai
  // (responsive.css) -- 368px me 26 machine ke naam/number ek-doosre par
  // chadh jaate the, isliye wahan graph apne dabbe me side me khisakta hai.
  // Website aur TV par ye khaali naap hai, kuch nahi badalta.
  return (
    <div className="bq-chart">
      <div className="bq-chart-title">{title}</div>
      <div className="bq-plot-scroll">
      <div className={`bq-plot${tircha ? " tircha" : ""}`}
           style={{ "--bq-min": `${data.length * 26 + 90}px` }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 26, right: 8, left: 6, bottom: 2 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
          <XAxis dataKey="mc" interval={0} angle={tircha ? -35 : 0}
                 textAnchor={tircha ? "end" : "middle"} height={xH}
                 tick={{ fontSize: 10.5, fontWeight: 700, fill: "#334155" }} />
          <YAxis yAxisId="v" allowDecimals={false} tick={{ fontSize: 11, fill: "#475569" }}
                 domain={[0, ax.max]} ticks={ax.ticks}
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
      </div>
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
  // Filter URL se shuru hote hain -- machine ke page se (ya phone ke back se)
  // lautne par wahi filter wapas.  URL khaali ho to neeche wala default.
  const [sp, setSp] = useSearchParams();
  const [shuru] = useState(() => qprFromQuery(sp));
  const [years, setYears]   = useState([]);
  const [fFy, setFFy]       = useState(shuru.fy);
  const [fMonth, setFMonth] = useState(shuru.month);
  // Date khaali -- Pareto MAHINE ka banta hai (kaagaz: "... OF Dec-2025").
  // Aaj ka din default rakhte to zyadatar din sheet khaali khulti.
  const [fDate, setFDate]   = useState(shuru.date);
  const [fZone, setFZone]   = useState(shuru.zone);
  const [fLine, setFLine]   = useState(shuru.line);
  const [fMachineNo, setFMachineNo] = useState(shuru.mc);
  const [master, setMaster] = useState([]);
  const [ready, setReady]   = useState(false);   // FY/Month tay hone ke BAAD hi data maango
  const booted = useRef(shuru.fromUrl);           // FY/Month ka default sirf EK baar (URL ho to bilkul nahi)

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

  const filters = { fy: fFy, month: fMonth, date: fDate, zone: fZone, line: fLine, mc: fMachineNo };
  const query = qprQuery(filters).toString();
  // Filter badle to URL bhi (`replace` -- har chuni cheez ki history me alag
  // entry nahi chahiye).  Boot se PEHLE nahi, warna default FY aane se pehle
  // khaali `fy=` likh jaata aur page "All Financial Years" par atak jaata.
  // Barabar ho to kuch nahi -- warna har render par naya navigate.
  useEffect(() => {
    if (ready && query !== sp.toString()) setSp(query, { replace: true });
  }, [ready, query, sp, setSp]);

  /* Machine ka page -- QPR ke filter saath jaate hain (wahi slips dikhen jo
     yahan gini gayi, aur wapas aane par yahi filter lautein). */
  const kholo = (mc) => {
    const q = qprQuery(filters);
    q.set("machine", mc);
    nav(`${QPR_MACHINE_PATH}?${q.toString()}`);
  };

  // Filter + hadd ke baad machine-wise Pareto (dono -- minute aur ginti).
  // Chhaanna `qprSlips` karta hai -- machine wala page bhi wahi, taaki jod
  // dono jagah ek hi aaye.
  const { timeRows, freqRows } = useMemo(() => {
    const by = new Map();
    const chhan = { fy: fFy, month: fMonth, date: fDate, zone: fZone, line: fLine, mc: fMachineNo };
    for (const r of qprSlips(got.rows, chhan, hadd)) {
      const mins = Number(r.solve_time_min) || 0;
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
  const kab = kabLabel({ fy: fFy, month: fMonth, date: fDate });

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
        /* Machine No. ke aage "View" -- select jitna hi ooncha */
        .bq-viewbtn { border:1.5px solid #1d4ed8; background:#2563eb; color:#fff; border-radius:9px;
                      padding:9px 18px; font-size:13px; font-weight:800; cursor:pointer;
                      font-family:'Barlow',sans-serif; }
        .bq-viewbtn:disabled { background:#e2e8f0; border-color:#cbd5e1; color:#94a3b8; cursor:not-allowed; }
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
        .bq-plot { height:300px; }
        .bq-plot.tircha { height:344px; }
        .bq-empty { padding:50px 16px; text-align:center; color:#64748b; font-size:13.5px; font-weight:600; }
      `}</style>

      <div className="bh-root">
        <div className="bh-top">
          <div style={{ display:"flex", alignItems:"center", gap:14 }}>
            <button className="bh-back" onClick={() => nav("/maintenance-breakdown")}>← Back</button>
            <div className="bh-title">Breakdown <span>QPR</span></div>
          </div>
          <div className="bq-topright" style={{ display:"flex", alignItems:"center", gap:12 }}>
            {user?.username && <span className="app-user" style={{ fontSize:12, color:"#64748b", fontWeight:600 }}>{user.username}</span>}
          </div>
        </div>

        <div className="bh-body bq-body">
          {/* `bq-filters` -- phone par isi page ki grid (responsive.css); BD
              History ki `bh-filters` par koi asar nahi. */}
          <div className="bh-filters bq-filters">
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
            {/* Machine No. ke THEEK aage -- chuni hui machine ki wahi slips
                kholta hai jo is QPR me gini gayi.  Machine chune bina band. */}
            <div className="bh-fld bq-viewfld">
              <label>&nbsp;</label>
              <button type="button" className="bq-viewbtn" disabled={!fMachineNo}
                      onClick={() => kholo(fMachineNo)}
                      title={fMachineNo ? `Show the breakdowns of ${fMachineNo}`
                                        : "Choose Zone → Line → Machine No. first"}>
                View
              </button>
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
