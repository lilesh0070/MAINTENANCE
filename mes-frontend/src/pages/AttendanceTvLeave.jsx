/* AttendanceTvLeave.jsx — TV par LEAVE: neeche ki KHAALI aadhi screen me.
 *
 * User 2026-10-03: "leave wala TV APK me nahi dikh raha" -> chuna "neeche ki
 * khaali aadhi me": Approved (aaj chhutti par + aage wali) aur Pending, sirf
 * DEKHNA (koi button nahi -- arzi / manzoori phone ya website se), bina scroll.
 *
 * Upar ka board BILKUL waisa (TV layout band hai): ye panel `.bd-root.att-tv`
 * ke `padding-bottom:50vh` wale hisse me ABSOLUTE baithta hai -- flex ke bahar,
 * isliye board ka naap / fit (`att-fitwrap`) nahi badalta.
 *
 * Bina scroll: board jaisa hi -- body ko W/s chaudai + scale(s); s binary
 * search se SEEDHA DOM par (React state nahi -- KPI page par naap -> state ->
 * naap se React #185 hang hua tha).  Zyada log hon to s chhota; MIN par bhi na
 * samaye to neeche kat jaata hai (scroll kabhi nahi).  Data badle to dobara
 * bithao (min-height ki wajah se ResizeObserver chhota hone par nahi bolta).
 *
 * TV ki WebView purani: color-mix / inset nahi; koi lagataar animation nahi
 * (TV ANR, v1.4.103).  Har 60 s taaza (board jaisa); chhupe page par nahi.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "../api/client";

const REFRESH_MS = 60_000;
const pad = (n) => String(n).padStart(2, "0");
const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dateOf = (s) => { const [y, m, d] = String(s).slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d); };
const dayTxt = (s) => (s ? dateOf(s).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : "");
const nDays = (n) => `${n} day${n === 1 ? "" : "s"}`;

// top:50vh = board wala aadha khatam; bottom 84px = AI button ki jagah
const CSS = `
.att-tvleave { position:absolute; left:0; right:0; top:50vh; bottom:84px; overflow:hidden; }
.atl-body { box-sizing:border-box; transform-origin:0 0; padding:6px 24px 0; display:flex; flex-direction:column; }
.atl-head { display:flex; align-items:center; gap:14px; flex-wrap:wrap; padding:10px 14px; background:#fff;
            border:1px solid #e2e8f0; border-radius:12px; }
.atl-title { font-size:20px; font-weight:800; color:#0f172a; letter-spacing:.02em; }
.atl-sum { display:flex; gap:8px; flex-wrap:wrap; margin-left:auto; }
.atl-sum span { font-size:13px; font-weight:700; border-radius:999px; padding:4px 12px; border:1px solid #e2e8f0; }
.atl-sum b { font-size:15px; margin-right:3px; }
.atl-sum .t { color:#15803d; background:#f0fdf4; border-color:#bbf7d0; }
.atl-sum .u { color:#1d4ed8; background:#eff6ff; border-color:#bfdbfe; }
.atl-sum .p { color:#b45309; background:#fffbeb; border-color:#fde68a; }
.atl-sec { margin-top:12px; }
.atl-sec-t { font-size:12px; font-weight:800; letter-spacing:.06em; text-transform:uppercase; color:#475569;
             margin:0 0 8px 2px; }
.atl-sec-t small { font-size:11px; font-weight:600; letter-spacing:0; text-transform:none; color:#94a3b8; margin-left:6px; }
.atl-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(300px, 1fr)); gap:8px; }
.atl-card { display:flex; align-items:center; gap:10px; background:#fff; border:1px solid #e2e8f0;
            border-left:5px solid #94a3b8; border-radius:10px; padding:8px 12px; min-width:0; }
.atl-card.t { border-left-color:#16a34a; }
.atl-card.u { border-left-color:#2563eb; }
.atl-card.p { border-left-color:#d97706; }
.atl-who { flex:1; min-width:0; }
.atl-name { font-size:16px; font-weight:800; color:#0f172a; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.atl-meta { font-size:12px; color:#64748b; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.atl-when { text-align:right; flex-shrink:0; }
.atl-dates { font-size:13px; font-weight:700; color:#334155; white-space:nowrap; }
.atl-tag { display:inline-block; margin-top:3px; font-size:11px; font-weight:800; border-radius:6px; padding:2px 8px;
           white-space:nowrap; }
.atl-card.t .atl-tag { color:#15803d; background:#f0fdf4; }
.atl-card.u .atl-tag { color:#1d4ed8; background:#eff6ff; }
.atl-card.p .atl-tag { color:#b45309; background:#fffbeb; }
.atl-empty { font-size:13px; color:#94a3b8; font-weight:600; background:#fff; border:1px dashed #e2e8f0;
             border-radius:10px; padding:10px 14px; }
`;

export default function AttendanceTvLeave({ token, today, tvApp = false }) {
  const [data, setData] = useState(null);
  const [galti, setGalti] = useState(false);
  const wrapRef = useRef(null);
  const bodyRef = useRef(null);

  // aaj ki tareekh ka record bas -- pending / approved server alag se poore deta hai
  useEffect(() => {
    let band = false;
    const lao = () => {
      const t = today || isoOf(new Date());
      api.get(`/api/attendance/leave?start=${t}&end=${t}`, token)
        .then((d) => { if (!band) { setData(d); setGalti(false); } })
        .catch(() => { if (!band) setGalti(true); });
    };
    lao();
    const id = setInterval(() => { if (document.visibilityState === "visible") lao(); }, REFRESH_MS);
    return () => { band = true; clearInterval(id); };
  }, [token, today]);

  /* aadhi screen me bithao (upar wali tippani) */
  useLayoutEffect(() => {
    const wrap = wrapRef.current, body = bodyRef.current;
    if (!wrap || !body) return undefined;
    const MAX = tvApp ? 1.2 : 1, MIN = 0.3;
    let t = 0;
    const fit = () => {
      t = 0;
      const W = wrap.clientWidth, H = wrap.clientHeight;
      if (!W || !H) return;
      body.style.minHeight = "0px";
      const tall = (sc) => { body.style.width = `${W / sc}px`; return body.offsetHeight * sc; };
      let sc = MAX;
      if (tall(MAX) > H) {
        let lo = MIN, hi = MAX;
        for (let i = 0; i < 9; i += 1) {
          const mid = (lo + hi) / 2;
          if (tall(mid) <= H) lo = mid; else hi = mid;
        }
        sc = lo;
      }
      body.style.width = `${W / sc}px`;
      body.style.minHeight = `${H / sc}px`;
      body.style.transform = `scale(${sc})`;
    };
    // timer (requestAnimationFrame nahi -- chhupe tab me wo chalta hi nahi)
    const kick = () => { if (!t) t = setTimeout(fit, 30); };
    fit();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(kick) : null;
    if (ro) { ro.observe(wrap); ro.observe(body); }
    window.addEventListener("resize", kick);
    return () => {
      clearTimeout(t);
      if (ro) ro.disconnect();
      window.removeEventListener("resize", kick);
      body.style.width = "";
      body.style.minHeight = "";
      body.style.transform = "";
    };
  }, [tvApp, data]);

  const aaj = data?.today || today || isoOf(new Date());
  // purana server (`approved` nahi bhejta) -- record se nikaalo
  const approved = !data ? [] : Array.isArray(data.approved) ? data.approved
    : (data.rows || []).filter((r) => r.status === "APPROVED" && r.to_date >= aaj);
  const pending = data?.pending || [];
  const nAaj = approved.filter((r) => r.from_date <= aaj).length;

  const card = (r) => {
    const kind = r.status === "PENDING" ? "p" : r.from_date <= aaj ? "t" : "u";
    return (
      <div key={r.id} className={`atl-card ${kind}`}>
        <div className="atl-who">
          <div className="atl-name">{r.staff_name}</div>
          <div className="atl-meta">{[r.emp_code, r.designation].filter(Boolean).join(" · ")}</div>
        </div>
        <div className="atl-when">
          <div className="atl-dates">
            {dayTxt(r.from_date)}{r.to_date !== r.from_date ? ` – ${dayTxt(r.to_date)}` : ""} · {nDays(r.days || 1)}
          </div>
          <div className="atl-tag">
            {kind === "p" ? "Waiting for approval" : kind === "t" ? "On leave today" : "Coming up"}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div ref={wrapRef} className="att-tvleave">
      <style>{CSS}</style>
      <div ref={bodyRef} className="atl-body">
        <div className="atl-head">
          <div className="atl-title">Leave</div>
          {data && (
            <div className="atl-sum">
              <span className="t"><b>{nAaj}</b> on leave today</span>
              <span className="u"><b>{approved.length - nAaj}</b> coming up</span>
              <span className="p"><b>{pending.length}</b> pending</span>
            </div>
          )}
        </div>
        {!data ? (
          <div className="atl-sec">
            <div className="atl-empty">{galti ? "Couldn't load leave — trying again every minute." : "Loading leave…"}</div>
          </div>
        ) : (
          <>
            <section className="atl-sec">
              <div className="atl-sec-t">Approved <small>on leave today and coming up</small></div>
              {approved.length ? <div className="atl-grid">{approved.map(card)}</div>
                : <div className="atl-empty">No one is on leave today or coming up.</div>}
            </section>
            <section className="atl-sec">
              <div className="atl-sec-t">Pending approval</div>
              {pending.length ? <div className="atl-grid">{pending.map(card)}</div>
                : <div className="atl-empty">No pending leave requests.</div>}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
