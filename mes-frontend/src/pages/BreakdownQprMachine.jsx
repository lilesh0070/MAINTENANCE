/* ───────────────────────────────────────────────────────────────────
 * BreakdownQprMachine.jsx  —  Breakdown QPR → ek machine ke breakdown
 * ───────────────────────────────────────────────────────────────────
 * QPR ke filter me Machine No. ke aage "View" dabane se khulta hai.  Machine
 * chuni ho to uski, warna us Zone / Line / sab ki -- WAHI slips jo QPR ke jod
 * me gini gayi (har slip apne mahine ki hadd se) -- wahi table
 * (`maintenance_breakdown_data`, GET /api/breakdowns/log), wahi filter
 * (FY / Month / Date / Zone / Line), wahi hadd (M/C DOWN TIME >= admin ki
 * hadd).  Chhaanna `constants/qpr.js` ka `qprSlips` karta hai -- QPR bhi
 * wahi, isliye yahan ka jod aur QPR ka number kabhi alag nahi aata.
 *
 * ⚠ `/log` ka `machine` param machine_NAME se milata hai, machine_no se
 * NAHI -- isliye server se sirf samay ki khidki maangte hain aur machine_no
 * yahin milate hain.
 *
 * Column (user ke kram me): # · Breakdown Date (Slip Date) · Zone · Line ·
 * machine_no · Problem Observed by Production · Actual Problem by
 * Maintenance · Action Taken · Start Time · BD Received Time · Response
 * Time · BD OK Time · Total Time (min) · CAPA.
 *
 * Kram (2026-09-20): SABSE ZYADA down time sabse UPAR (barabar ho to naya
 * pehle).  Aakhri khaana "CAPA": jis breakdown ki down time CAPA ki hadd
 * (`/api/capa-lb/min-config` -- QPR wali se ALAG setting) poori karti hai,
 * uske aage "View" -- seedha USI breakdown ki CAPA khulti hai
 * (`/maintenance-capa?bd=<id>`), list se hokar nahi.  Khaana sirf usko
 * dikhta hai jiske paas `maintenance-capa` ki ijazat ho.
 *
 * Styling: patti BD History ki `bh-` class se (phone/tablet/TV ke niyam
 * pehle se); sheet ki apni `bqm-` class, phone ke niyam responsive.css me.
 *
 * Routing:    /maintenance-breakdown/breakdown-qpr/machine?machine=..&fy=..&month=..
 * Permission: maintenance-breakdown-qpr (QPR wali hi -- ye usi ka hissa hai)
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import {
  QPR_PATH, kabLabel, apiWindow, qprSlips, qprQuery, qprFromQuery,
  haddCfg, haddOf, haddBayan,
} from "../constants/qpr";

const api = {
  async get(path, token) {
    const r = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
    return r.json();
  },
};

const khali = (v) => (v === null || v === undefined || String(v).trim() === "" ? "—" : v);
const minute = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 10) / 10 : "—"; };

// [header, value, kism]  -- kism "txt" = lamba text (lipatne do, baayen se)
const COLS = [
  ["Breakdown Date (Slip Date)",      (r) => String(r.bd_date || "").slice(0, 10)],
  ["Zone",                            (r) => r.zone_code],
  ["Line",                            (r) => r.line_code],
  ["machine_no",                      (r) => r.machine_no],
  ["Problem Observed by Production",  (r) => r.problem_production,  "txt"],
  ["Actual Problem by Maintenance",   (r) => r.problem_maintenance, "txt"],
  ["Action Taken",                    (r) => r.action_taken,        "txt"],
  ["Start Time",                      (r) => r.bd_start_time],
  ["BD Received Time",                (r) => r.bd_received_time],
  ["Response Time (min)",             (r) => r.bd_response_time],
  ["BD OK Time",                      (r) => r.bd_ok_time],
  ["Total Time (min)",                (r) => minute(r.solve_time_min)],
];

export default function BreakdownQprMachine() {
  const { token, theme, user, canAccess } = useAuth();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  // QPR ke filter + kaunsi machine.  `sp` badle (naya link) to naya hisaab.
  const q = sp.toString();
  const f = useMemo(() => qprFromQuery(new URLSearchParams(q)), [q]);
  // Machine QPR ke filter (`mc`) se; purane link me `machine` bhi chalta hai.
  // Khaali ho to us Zone / Line / sab ki slips (View ab bina machine ke bhi).
  const machine = new URLSearchParams(q).get("machine") || f.mc || "";

  // Hadd -- QPR wali hi (server se, mahine-wise); na mile to 55.
  const [cfg, setCfg] = useState(null);
  useEffect(() => {
    if (!token) return;
    api.get("/api/breakdowns/qpr-config", token)
      .then((c) => setCfg(haddCfg(c)))
      .catch(() => setCfg(haddCfg(null)));
  }, [token]);

  /* CAPA ki apni hadd -- QPR wali se ALAG setting hai (Settings me dono alag
     rakhi ja sakti hain).  Aakhri column ka "View" isi par aata hai, taaki jo
     bhi CAPA banti hai uske aage raasta mile -- koi chhoote na. */
  const [capaCfg, setCapaCfg] = useState(null);
  useEffect(() => {
    if (!token) return;
    api.get("/api/capa-lb/min-config", token)
      .then((c) => setCapaCfg(haddCfg(c)))
      .catch(() => setCapaCfg(haddCfg(null)));
  }, [token]);
  const capaHadd = useMemo(() => haddOf(capaCfg || haddCfg(null)), [capaCfg]);
  // CAPA ka khaana sirf usko jisko CAPA ki ijazat hai
  const capaDikhe = canAccess("maintenance-capa");
  const capaHai = (r) => (Number(r.solve_time_min) || 0) >= capaHadd(String(r.bd_date || "").slice(0, 7));

  // Slips -- sirf samay ki khidki server se; baaki `qprSlips` yahin.
  const win = apiWindow(f);
  const reqKey = `${win.from}|${win.to}`;
  const [got, setGot] = useState({ key: null, rows: [], err: "" });
  useEffect(() => {
    if (!token) return;
    let band = false;
    const qs = new URLSearchParams({ limit: "3000" });
    if (win.from) qs.set("date_from", win.from);
    if (win.to)   qs.set("date_to", win.to);
    api.get(`/api/breakdowns/log?${qs.toString()}`, token)
      .then((r) => { if (!band) setGot({ key: reqKey, rows: (r?.rows || []).filter((x) => x.bd_date), err: "" }); })
      .catch((e) => { if (!band) setGot({ key: reqKey, rows: [], err: e?.message || "Could not load breakdowns" }); });
    return () => { band = true; };
  }, [token, reqKey, win.from, win.to]);
  const loading = cfg === null || got.key !== reqKey;
  const hadd = useMemo(() => haddOf(cfg || haddCfg(null)), [cfg]);   // (ym) => minute
  const bayan = cfg ? haddBayan(cfg, f) : null;

  /* Kram: SABSE ZYADA down time sabse UPAR (user 2026-09-20).  Barabar minute
     ho to naya breakdown pehle -- warna har baar kram badalta rehta. */
  const rows = useMemo(() => {
    const list = qprSlips(got.rows, { ...f, mc: machine }, hadd);
    return [...list].sort((a, b) => {
      const d = (Number(b.solve_time_min) || 0) - (Number(a.solve_time_min) || 0);
      if (d) return d;
      return String(b.bd_date || "").localeCompare(String(a.bd_date || ""));
    });
  }, [got.rows, f, machine, hadd]);
  const kulMin = rows.reduce((s, r) => s + (Number(r.solve_time_min) || 0), 0);
  // Machine ka naam sirf jab EK machine ho
  const naam = machine ? (rows.find((r) => r.machine_name)?.machine_name || "") : "";
  // Sheet kiski hai: machine, warna Zone / Line, warna sab
  const kiski = machine || [f.zone || "ALL ZONES", f.line].filter(Boolean).join(" / ");
  const haddText = !bayan ? "…" : bayan.ek ? `${bayan.min} min` : `month-wise limit (default ${bayan.min} min)`;

  // Wapas QPR par -- app ke andar se aaye the to history ka back (URL me
  // filter hain, wahi lautenge); seedha link se khula ho to QPR ka URL.
  const qprUrl = `${QPR_PATH}?${qprQuery(f).toString()}`;
  const pichhe = () => (window.history.state?.idx > 0 ? nav(-1) : nav(qprUrl, { replace: true }));

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

        .bqm-sheet { background:#fff; border:2px solid #111827; }
        .bqm-title { background:#e5e7eb; border-bottom:2px solid #111827; padding:10px 16px; text-align:center;
                     font-family:'Barlow Condensed',sans-serif; font-size:22px; font-weight:800; color:#111827; }
        .bqm-sub { display:flex; flex-wrap:wrap; justify-content:center; gap:6px 18px; padding:8px 14px;
                   border-bottom:1px solid #111827; font-size:13px; font-weight:700; color:#334155; }
        .bqm-sub b { color:#0f172a; }
        .bqm-scroll { overflow-x:auto; }
        .bqm-table { width:100%; border-collapse:collapse; font-size:13px; color:#111827; }
        .bqm-table th, .bqm-table td { border:1px solid #111827; padding:6px 8px; text-align:center; vertical-align:top; }
        .bqm-table th { background:#f3f4f6; font-weight:800; font-size:12px; white-space:normal; }
        .bqm-table td { white-space:nowrap; }
        /* 180px: teen text column ka farsh.  220 par table 1366 wali screen par
           8px chaudi padti thi aur bekaar ka scrollbar aata tha (naapa). */
        .bqm-table td.txt { white-space:normal; text-align:left; min-width:180px; }
        .bqm-table td.mc { font-weight:700; }
        .bqm-table th.sno, .bqm-table td.sno { width:34px; font-weight:700; }
        /* aakhri khaana -- usi breakdown ki CAPA kholne ka button */
        .bqm-table td.capa { vertical-align:middle; color:#94a3b8; }
        .bqm-capa { border:1.5px solid #1d4ed8; background:#2563eb; color:#fff; border-radius:8px;
                    padding:5px 14px; font-size:12px; font-weight:800; cursor:pointer;
                    font-family:'Barlow',sans-serif; white-space:nowrap; }
        .bqm-capa:hover { background:#1d4ed8; }
        @media print { .bqm-table td.capa, .bqm-table th.capa { display:none; } }
        .bqm-table tbody tr:nth-child(even) td { background:#f8fafc; }
        .bqm-empty { padding:50px 16px; text-align:center; color:#64748b; font-size:13.5px; font-weight:600; }
      `}</style>

      <div className="bh-root">
        <div className="bh-top">
          <div style={{ display:"flex", alignItems:"center", gap:14 }}>
            <button className="bh-back" onClick={pichhe}>← Back</button>
            <div className="bh-title">Machine <span>Breakdowns</span></div>
          </div>
          <div className="bq-topright" style={{ display:"flex", alignItems:"center", gap:12 }}>
            {user?.username && <span className="app-user" style={{ fontSize:12, color:"#64748b", fontWeight:600 }}>{user.username}</span>}
          </div>
        </div>

        <div className="bh-body bq-body">
          <div className="bqm-sheet">
            <div className="bqm-title">
              BREAKDOWNS OF {kiski} — {kabLabel(f)}
            </div>
            <div className="bqm-sub">
              {naam && <span>{naam}</span>}
              <span>Down time ≥ <b>{haddText}</b></span>
              {!loading && !got.err && (
                <span><b>{rows.length}</b> breakdown{rows.length === 1 ? "" : "s"} · <b>{minute(kulMin)}</b> min total</span>
              )}
            </div>

            {loading ? (
              <div className="bqm-empty">Loading…</div>
            ) : got.err ? (
              <div className="bqm-empty" style={{ color:"#b91c1c" }}>Could not load breakdowns — {got.err}</div>
            ) : rows.length === 0 ? (
              <div className="bqm-empty">No breakdown of {haddText} or more in this period.</div>
            ) : (
              <div className="bqm-scroll">
                <table className="bqm-table">
                  <thead><tr>
                    <th className="sno">#</th>
                    {COLS.map(([h]) => <th key={h}>{h}</th>)}
                    {capaDikhe && <th className="capa">CAPA</th>}
                  </tr></thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={r.id}>
                        {/* Serial number -- jaisa table saja hai (down time,
                            bada upar) waise hi 1,2,3 (user 2026-09-20). */}
                        <td className="sno">{i + 1}</td>
                        {COLS.map(([h, v, kism]) => (
                          <td key={h} className={kism === "txt" ? "txt" : h === "machine_no" ? "mc" : undefined}>
                            {khali(v(r))}
                          </td>
                        ))}
                        {/* CAPA ki hadd poori karne walon ke aage hi "View" --
                            seedha USI breakdown ki CAPA khulti hai. */}
                        {capaDikhe && (
                          <td className="capa">
                            {capaHai(r) ? (
                              <button type="button" className="bqm-capa"
                                      title="Open this breakdown's CAPA"
                                      onClick={() => nav(`/maintenance-capa?bd=${r.id}`)}>
                                View
                              </button>
                            ) : "—"}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
