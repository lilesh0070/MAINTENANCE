/* ───────────────────────────────────────────────────────────────────
 * WalkieTalkie.jsx — plant ke andar push-to-talk.
 * ───────────────────────────────────────────────────────────────────
 * Do tab:
 *   Talk   — kisko bulana hai chuno, button DABAYE RAKHO aur bolo.  Ya
 *            sirf "Buzz" — saamne wale ka phone vibrate kar dega.
 *   Setup  — SIRF ADMIN.  Kaun-kaun walkie use karega, aur channel.
 *
 * Aawaz WebSocket par jaati hai (`/api/walkie/ws`), raw PCM16 @16kHz.
 * Kyun aisa — `constants/walkieAudio.js` ke upar poora likha hai.
 *
 * APK ME KAUN BAJATA HAI
 * ----------------------
 * Phone par aawaz Java ki foreground service bajati hai, ye page nahi --
 * warna app khuli ho to EK HI aawaz do baar aati.  Service band ho (ya
 * abhi tak lagi hi na ho) to page khud baja deta hai, taaki kam se kam
 * khuli app par call sunayi de.  Website par hamesha page hi bajata hai.
 *
 * Routing: /walkie-talkie
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { micShuru } from "../constants/walkieAudio";
import { walkieLink } from "../constants/walkieLink";
import { walkieNative } from "../constants/walkieNative";

const api = {
  async get(path, token) {
    const r = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
    return r.json();
  },
  async send(method, path, body, token) {
    const r = await fetch(path, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
    return r.status === 204 ? null : r.json();
  },
};

const MON3 = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad2 = (n) => String(n).padStart(2, "0");
const aajISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const mahineKaAnt = (ym) => {
  const [y, m] = String(ym).split("-").map(Number);
  return y && m ? `${ym}-${pad2(new Date(y, m, 0).getDate())}` : "";
};
/* FY Apr->Mar — bilkul wahi jo BD History / History Card me hai. */
function fyMonths(fy) {
  const y = parseInt(String(fy).split("-")[0], 10);
  if (isNaN(y)) return [];
  const out = [];
  for (let i = 0; i < 12; i++) {
    const mo = ((3 + i) % 12) + 1;
    const yr = mo >= 4 ? y : y + 1;
    out.push({ value: `${yr}-${pad2(mo)}`, label: `${MON3[mo]} ${yr}` });
  }
  return out;
}

const fmtWhen = (s) => {
  if (!s) return "—";
  const d = new Date(String(s).replace(" ", "T"));
  if (isNaN(d)) return String(s).slice(0, 16);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}-${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()]} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default function WalkieTalkie() {
  const { token, theme, user } = useAuth();
  const nav = useNavigate();
  const isAdmin = user?.role === "admin";

  const [roster, setRoster] = useState({ me: null, people: [], channels: [] });
  const [tab, setTab] = useState("talk");

  /* Buzz aur Voice ki ijazat SERVER se aati hai (`roster.me`), frontend ke
     apne hisaab se nahi -- warna dono jagah do alag jawab ho sakte the.
     Server WS par bhi yahi jaanchta hai; yahan sirf dikhane ke liye.
     ⚠ Ye lines `roster` ke BAAD hi aa sakti hain -- pehle rakhne par
     "Cannot access 'roster' before initialization" aata hai (error-boundary
     ne hi pakda tha). */
  const canVoice = roster?.me?.can_voice !== false;
  const canBuzz  = roster?.me?.can_buzz  !== false;
  const [online, setOnline] = useState([]);
  const [conn, setConn] = useState("connecting");      // connecting | on | off | denied
  const [pick, setPick] = useState(null);              // {type:"user"|"channel", id, name}
  const [talking, setTalking] = useState(false);
  const [level, setLevel] = useState(0);
  const [rxFrom, setRxFrom] = useState(null);          // kaun abhi bol raha hai
  const [kehna, setKehna] = useState("");
  const [busy, setBusy] = useState(false);

  const mic = useRef(null);


  const bolo = useCallback((o) => walkieLink.send(o), []);

  // ── roster ──────────────────────────────────────────────────────
  const loadRoster = useCallback(() => {
    if (!token) return;
    api.get("/api/walkie/roster", token)
      .then((d) => setRoster(d || { me: null, people: [], channels: [] }))
      .catch(() => {});
  }, [token]);
  useEffect(() => { loadRoster(); }, [loadRoster]);

  /* ── socket ─────────────────────────────────────────────────────
     Page apna socket NAHI kholta.  Poori app ka ek hi socket
     `walkieLink` me rehta hai aur use `WalkiePresence` (Layout me) app
     khulte hi chala deta hai — isi wajah se banda har page par online
     dikhta hai, sirf is page par nahi.  Yahan bas usi ko sunte hain. */
  useEffect(() => {
    const lagao = () => {
      const st = walkieLink.state;
      setConn(st.conn);
      setOnline(st.online || []);
      setRxFrom(st.rxFrom);
    };
    lagao();
    return walkieLink.on((d) => {
      lagao();
      if (d.t === "buzz") {
        setKehna(`${d.from?.name || "Someone"} is buzzing you`);
        try { navigator.vibrate?.([260, 120, 260]); } catch { /* nahi hua to nahi */ }
        setTimeout(() => setKehna(""), 4000);
      } else if (d.t === "floor") {
        if (d.ok) setKehna(d.listeners ? "" : "No one is listening right now");
        else if (d.why && d.why !== "stopped") { setKehna(d.why); rukJao(false); }
      } else if (d.t === "floor_lost") {
        setKehna("Talk time limit reached");
        rukJao(false);
      } else if (d.t === "buzz_sent") {
        setKehna(d.why || (d.listeners ? "Buzz sent" : "Nobody is online to buzz"));
        setTimeout(() => setKehna(""), 3000);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Page chhodte waqt mic khula na reh jaye
  useEffect(() => () => { try { mic.current?.band(); } catch { /* chal hi nahi raha tha */ } mic.current = null; }, []);

  // presence badle to roster ka online dot bhi taaza ho
  useEffect(() => {
    setRoster((r) => ({
      ...r,
      people: (r.people || []).map((p) => ({ ...p, online: online.includes(p.id) })),
    }));
  }, [online]);

  /* Service ka haal — chalane ka kaam `WalkiePresence` karta hai (app
     khulte hi, har page par).  Yahan sirf dikhane ke liye padhte hain. */
  const [svc, setSvc] = useState({ running: false, connected: false, error: "", ignoringBattery: false });
  useEffect(() => {
    if (!walkieNative.hai()) return undefined;
    let stop = false;
    const taaza = () => walkieNative.status().then((x) => {
      if (stop) return;
      setSvc(x || {});
    }).catch(() => {});
    taaza();
    const t = setInterval(taaza, 4000);
    return () => { stop = true; clearInterval(t); };
  }, []);

  // ── bolna ───────────────────────────────────────────────────────
  const boloShuru = async () => {
    if (talking || !pick || conn !== "on") return;
    setKehna("");
    walkieLink.jagao();          // browser: bina user ke chhue aawaz nahi bajti
    setTalking(true);
    bolo({ t: "ptt_start", target: { type: pick.type, id: pick.id } });
    try {
      mic.current = await micShuru({
        onFrame: (buf) => walkieLink.sendAudio(buf),
        onLevel: setLevel,
      });
    } catch (e) {
      setKehna(e?.message || "Microphone is not available");
      rukJao(true);
    }
  };

  const rukJao = (bhejo = true) => {
    try { mic.current?.band(); } catch { /* chal hi nahi raha tha */ }
    mic.current = null;
    setLevel(0);
    setTalking(false);
    if (bhejo) bolo({ t: "ptt_stop" });
  };

  const buzz = (t) => {
    if (conn !== "on") return;
    bolo({ t: "buzz", target: { type: t.type, id: t.id } });
  };

  // ── admin setup ─────────────────────────────────────────────────
  const [members, setMembers] = useState([]);
  const [chans, setChans] = useState([]);
  const [newCh, setNewCh] = useState("");
  const [newChWho, setNewChWho] = useState([]);   // naya channel banate waqt hi log

  /* ── History (admin) ────────────────────────────────────────────
     Default: chaalu FY + chaalu mahina + AAJ ka din — bilkul waise hi
     jaise BD History aur History Card me hai, taaki teeno jagah ek jaisa
     lage.  Date khali karte hi poora mahina dikh jaata hai. */
  const [years, setYears]   = useState([]);
  const [hFy, setHFy]       = useState("");
  const [hMonth, setHMonth] = useState("");
  const [hDate, setHDate]   = useState(aajISO());
  const [hWho, setHWho]     = useState("");
  const [hKind, setHKind]   = useState("");
  const [hRows, setHRows]   = useState([]);
  const [hSel, setHSel]     = useState(new Set());   // mitane ke liye chuni hui qatarein
  const [hBusy, setHBusy]   = useState(false);
  const booted = useRef(false);

  useEffect(() => {
    if (!token || !isAdmin) return;
    api.get("/api/maintenance-kpi/financial-years", token).then((y) => {
      const list = Array.isArray(y) ? y : [];
      setYears(list);
      if (!booted.current && list.length) {
        booted.current = true;
        const cur = (list.find((v) => v.is_current) || list[list.length - 1]).fy;
        setHFy(cur);
        const now = new Date();
        const cm = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
        if (fyMonths(cur).some((m) => m.value === cm)) setHMonth(cm);
      }
    }).catch(() => setYears([]));
  }, [token, isAdmin]);

  const loadHist = useCallback(() => {
    if (!token || !isAdmin) return;
    const p = new URLSearchParams({ limit: "500" });
    if (hFy) p.set("fy", hFy);
    if (hMonth) p.set("month", hMonth);
    if (hDate) p.set("date", hDate);
    if (hWho) p.set("user_id", hWho);
    if (hKind) p.set("kind", hKind);
    setHBusy(true);
    setHSel(new Set());
    api.get(`/api/walkie/events?${p.toString()}`, token)
      .then((d) => setHRows(Array.isArray(d) ? d : []))
      .catch(() => setHRows([]))
      .finally(() => setHBusy(false));
  }, [token, isAdmin, hFy, hMonth, hDate, hWho, hKind]);
  useEffect(() => { if (tab === "hist") loadHist(); }, [tab, loadHist]);

  /* Mahina badla aur chuna hua din us mahine ka nahi — to din hata do,
     warna table khali dikhti hai aur wajah kahin likhi nahi hoti. */
  const onHMonth = (v) => { setHMonth(v); if (hDate && v && hDate.slice(0, 7) !== v) setHDate(""); };
  const onHFy = (v) => { setHFy(v); setHMonth(""); setHDate(""); };

  const histChuno = (id) => setHSel((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  /* Mitana wapas nahi aata, isliye ek baar poochh lete hain -- aur ginti
     saath me dikhate hain taaki galti se poori list na chali jaye. */
  const histMitao = async () => {
    const ids = [...hSel];
    if (!ids.length) return;
    if (!window.confirm(`Delete ${ids.length} ${ids.length === 1 ? "entry" : "entries"} from the history? This cannot be undone.`)) return;
    setHBusy(true);
    try {
      await api.send("POST", "/api/walkie/events/delete", { ids }, token);
      setHSel(new Set());
      loadHist();
    } catch (e) { setKehna(e?.message || "Could not delete"); }
    finally { setHBusy(false); }
  };
  const histSaaf = () => { setHFy(""); setHMonth(""); setHDate(""); setHWho(""); setHKind(""); };
  const loadSetup = useCallback(() => {
    if (!token || !isAdmin) return;
    api.get("/api/walkie/members", token).then(setMembers).catch(() => setMembers([]));
    api.get("/api/walkie/channels", token).then(setChans).catch(() => setChans([]));
  }, [token, isAdmin]);
  /* History wale tab ko bhi member ki list chahiye (Person ka dropdown),
     isliye dono par load karte hain -- warna seedha History kholne par
     wo dropdown khali rehta tha. */
  useEffect(() => { if (tab === "setup" || tab === "hist") loadSetup(); }, [tab, loadSetup]);

  const toggleMember = async (m) => {
    setBusy(true);
    try {
      await api.send("PUT", `/api/walkie/members/${m.id}`, { enabled: !m.enabled }, token);
      loadSetup(); loadRoster();
    } catch (e) { setKehna(e?.message || "Could not save"); }
    finally { setBusy(false); }
  };

  const addChannel = async () => {
    const nm = newCh.trim();
    if (!nm) return;
    setBusy(true);
    try {
      const r = await api.send("POST", "/api/walkie/channels", { name: nm }, token);
      // Channel banate hi usme log daal do -- warna banane ke baad alag se
      // jaakar chunna padta tha, aur wahi sabse aam bhool thi (khali channel
      // par buzz karo to "Nobody is online" aata hai aur wajah samajh nahi
      // aati).
      if (r?.id && newChWho.length) {
        await api.send("PUT", `/api/walkie/channels/${r.id}/members`, { user_ids: newChWho }, token);
      }
      setNewCh(""); setNewChWho([]); loadSetup(); loadRoster();
    }
    catch (e) { setKehna(String(e.message || e).slice(0, 120)); }
    finally { setBusy(false); }
  };

  const delChannel = async (c) => {
    setBusy(true);
    try { await api.send("DELETE", `/api/walkie/channels/${c.id}`, undefined, token); loadSetup(); loadRoster(); }
    catch (e) { setKehna(e?.message || "Could not delete"); }
    finally { setBusy(false); }
  };

  const toggleChanMember = async (c, uid) => {
    const have = (c.members || []).includes(uid);
    const ids = have ? c.members.filter((x) => x !== uid) : [...(c.members || []), uid];
    setBusy(true);
    try { await api.send("PUT", `/api/walkie/channels/${c.id}/members`, { user_ids: ids }, token); loadSetup(); loadRoster(); }
    catch (e) { setKehna(e?.message || "Could not save"); }
    finally { setBusy(false); }
  };

  const connTxt = { connecting: "Connecting…", on: "Connected", off: "Disconnected — retrying",
                    denied: "You are not on the walkie-talkie list" }[conn];
  const connCol = { connecting: "#b45309", on: "#16a34a", off: "#dc2626", denied: "#dc2626" }[conn];

  const enabledMembers = useMemo(() => members.filter((m) => m.enabled), [members]);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700;800&family=Barlow+Condensed:wght@700;800&display=swap');
        .wk-root { min-height:100vh; background:#eef2f7; font-family:'Barlow',sans-serif; padding-bottom:50px; }
        .wk-top { background:#fff; border-bottom:1px solid #e2e8f0; height:56px; padding:0 28px 0 96px;
                  display:flex; align-items:center; justify-content:space-between;
                  position:sticky; top:0; z-index:50; box-shadow:0 1px 3px rgba(0,0,0,.06); }
        .wk-top::after { content:''; position:absolute; bottom:0; left:0; right:0; height:2px; background:${theme.gradient}; }
        .wk-ttl { font-family:'Barlow Condensed',sans-serif; font-size:22px; font-weight:800; color:#0f172a; }
        .wk-ttl span { color:${theme.accent}; }
        .wk-sub { font-size:11px; color:#94a3b8; margin-top:-2px; }
        .wk-back { display:flex; align-items:center; gap:6px; font-size:13px; font-weight:700; color:#475569;
                   background:#f1f5f9; border:1px solid #e2e8f0; border-radius:8px; padding:7px 14px; cursor:pointer; }
        .wk-body { max-width:1000px; margin:18px auto 0; padding:0 22px; }
        .wk-tabs { display:flex; gap:8px; margin-bottom:14px; }
        .wk-tab { border:1px solid #cbd5e1; background:#fff; color:#334155; font-weight:700; font-size:13px;
                  padding:8px 18px; border-radius:99px; cursor:pointer; font-family:inherit; }
        .wk-tab.on { background:${theme.accent}; color:#fff; border-color:${theme.accent}; }
        .wk-card { background:#fff; border:1px solid #e2e8f0; border-radius:13px; padding:16px;
                   box-shadow:0 1px 4px rgba(15,23,42,.05); margin-bottom:14px; }
        .wk-h { font-size:14px; font-weight:800; color:#0f172a; }
        .wk-dot { width:9px; height:9px; border-radius:50%; flex:0 0 auto; display:inline-block; }
        .wk-row { display:flex; align-items:center; gap:10px; padding:9px 10px; border-radius:10px;
                  border:1.5px solid #e2e8f0; margin-top:8px; cursor:pointer; background:#fff; }
        .wk-row.on { border-color:${theme.accent}; background:${theme.soft}; }
        .wk-row-name { font-weight:700; font-size:13.5px; color:#0f172a; }
        .wk-row-sub { font-size:11px; color:#94a3b8; }
        .wk-mini { border:1px solid #cbd5e1; background:#fff; color:#334155; font-weight:700; font-size:11.5px;
                   padding:5px 11px; border-radius:7px; cursor:pointer; font-family:inherit; }
        .wk-ptt { width:100%; margin-top:6px; border:none; border-radius:16px; padding:26px 16px;
                  font-family:inherit; font-size:17px; font-weight:800; letter-spacing:.03em; color:#fff;
                  background:#334155; cursor:pointer; user-select:none; -webkit-user-select:none;
                  touch-action:none; -webkit-touch-callout:none; }
        .wk-ptt.live { background:#dc2626; box-shadow:0 0 0 6px rgba(220,38,38,.18); }
        .wk-ptt:disabled { background:#cbd5e1; cursor:not-allowed; box-shadow:none; }
        .wk-meter { height:6px; border-radius:99px; background:#e2e8f0; overflow:hidden; margin-top:10px; }
        .wk-meter > i { display:block; height:100%; background:#16a34a; transition:width .08s linear; }
        .wk-note { font-size:12px; font-weight:700; margin-top:10px; }
        .wk-empty { padding:26px; text-align:center; color:#94a3b8; font-size:13px; }
        .wk-tbl { width:100%; border-collapse:collapse; font-size:12.5px; margin-top:6px; }
        .wk-tbl th { text-align:left; padding:7px 9px; font-size:10px; font-weight:800; letter-spacing:.04em;
                     text-transform:uppercase; color:#64748b; border-bottom:1px solid #e2e8f0; }
        .wk-tbl td { padding:8px 9px; border-bottom:1px solid #f1f5f9; color:#334155; }
        .wk-in { border:1.5px solid #cbd5e1; border-radius:8px; padding:8px 11px; font-size:13px;
                 font-family:inherit; outline:none; background:#fff; color:#0f172a; min-width:140px; }
        .wk-in:disabled { background:#f1f5f9; color:#94a3b8; }
        .wk-fld { display:flex; flex-direction:column; gap:5px; }
        .wk-fld label { font-size:10.5px; font-weight:800; letter-spacing:.05em;
                        text-transform:uppercase; color:#64748b; }
      `}</style>

      <div className="wk-root">
        <div className="wk-top">
          <div style={{ display:"flex", alignItems:"center", gap:14 }}>
            <button className="wk-back" onClick={() => nav("/dashboard")}>← Back</button>
            <div>
              <div className="wk-ttl">Walkie <span>Talkie</span></div>
              <div className="wk-sub">Press and hold to talk · plant network only</div>
            </div>
          </div>
          <span style={{ display:"flex", alignItems:"center", gap:7, fontSize:12, fontWeight:700, color:connCol }}>
            <span className="wk-dot" style={{ background:connCol }} />{connTxt}
          </span>
        </div>

        <div className="wk-body">
          {isAdmin && (
            <div className="wk-tabs">
              <button className={`wk-tab${tab === "talk" ? " on" : ""}`} onClick={() => setTab("talk")}>🎙 Talk</button>
              <button className={`wk-tab${tab === "setup" ? " on" : ""}`} onClick={() => setTab("setup")}>⚙ Setup</button>
              <button className={`wk-tab${tab === "hist" ? " on" : ""}`} onClick={() => setTab("hist")}>🕘 History</button>
            </div>
          )}

          {kehna && (
            <div className="wk-card" style={{ padding:"10px 14px", borderColor:"#fde68a", background:"#fffbeb" }}>
              <b style={{ fontSize:12.5, color:"#92400e" }}>{kehna}</b>
            </div>
          )}

          {/* ══════════════ TALK ══════════════ */}
          {tab === "talk" && (<>
            {conn === "denied" && (
              <div className="wk-card"><div className="wk-empty">
                You are not on the walkie-talkie list yet. Ask an administrator to add you.
              </div></div>
            )}

            {rxFrom && (
              <div className="wk-card" style={{ borderColor:"#16a34a", background:"#f0fdf4" }}>
                <b style={{ fontSize:14, color:"#166534" }}>🔊 {rxFrom.name} is speaking…</b>
              </div>
            )}

            {conn !== "denied" && (<>
              <div className="wk-card">
                <div className="wk-h">Channels</div>
                {!roster.channels?.length && <div className="wk-empty">You are not in any channel.</div>}
                {(roster.channels || []).map((c) => {
                  const on = pick?.type === "channel" && pick.id === c.id;
                  return (
                    <div key={`c${c.id}`} className={`wk-row${on ? " on" : ""}`}
                         onClick={() => setPick({ type:"channel", id:c.id, name:c.name })}>
                      <span style={{ fontSize:16 }}>📢</span>
                      <span style={{ flex:1, minWidth:0 }}>
                        <div className="wk-row-name">{c.name}</div>
                        <div className="wk-row-sub">{c.online} of {c.size} online</div>
                      </span>
                      {canBuzz && (
                        <button className="wk-mini" onClick={(e) => { e.stopPropagation(); buzz({ type:"channel", id:c.id }); }}>
                          📳 Buzz
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="wk-card">
                <div className="wk-h">People</div>
                {!roster.people?.length && <div className="wk-empty">Nobody else is on the walkie-talkie list yet.</div>}
                {(roster.people || []).map((p) => {
                  const on = pick?.type === "user" && pick.id === p.id;
                  return (
                    <div key={`u${p.id}`} className={`wk-row${on ? " on" : ""}`}
                         onClick={() => setPick({ type:"user", id:p.id, name:p.name })}>
                      <span className="wk-dot" style={{ background: p.online ? "#16a34a" : "#cbd5e1" }} />
                      <span style={{ flex:1, minWidth:0 }}>
                        <div className="wk-row-name">{p.name}</div>
                        <div className="wk-row-sub">{p.online ? "Online" : "Offline"}</div>
                      </span>
                      {canBuzz && (
                        <button className="wk-mini" disabled={!p.online}
                                onClick={(e) => { e.stopPropagation(); buzz({ type:"user", id:p.id }); }}>
                          📳 Buzz
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="wk-card">
                <div className="wk-h">
                  {pick ? <>Talking to <span style={{ color:theme.accent }}>{pick.name}</span></>
                        : "Pick someone above first"}
                </div>
                {/* Pointer events hi use kar rahe hain — mouse, touch aur pen
                    teeno inhi se aate hain, to alag-alag touch/mouse handler
                    likhne ki zaroorat nahi (aur dono ek saath chalne se
                    button do baar dabta tha). */}
                <button className={`wk-ptt${talking ? " live" : ""}`}
                        disabled={!pick || conn !== "on" || !canVoice}
                        onPointerDown={(e) => { e.currentTarget.setPointerCapture?.(e.pointerId); boloShuru(); }}
                        onPointerUp={() => talking && rukJao()}
                        onPointerCancel={() => talking && rukJao()}
                        onContextMenu={(e) => e.preventDefault()}>
                  {!canVoice ? "🔇 Voice is not enabled for you"
                    : talking ? "● ON AIR — release to stop"
                    : "🎙 PRESS AND HOLD TO TALK"}
                </button>
                {!canVoice && (
                  <div className="wk-note" style={{ color:"#64748b" }}>
                    You can still buzz people. Ask an administrator if you need to talk.
                  </div>
                )}
                <div className="wk-meter"><i style={{ width: `${Math.round(level * 100)}%` }} /></div>
              </div>

              {/* Background listening ka haal sirf EK LINE me — aur wo bhi tabhi
                  jab wo BAND ho.  Use chalu karne ka intezaam yahan JAAN-BOOJH
                  KAR nahi hai: wo app ki apni Settings (⚙) me hai, kyunki wo
                  poori app ki property hai, sirf walkie ki nahi. */}
              {walkieNative.hai() && !svc.connected && (
                <div className="wk-note" style={{ color:"#b45309", marginTop:-4 }}>
                  {svc.running
                    ? `Background listening is starting…${svc.error ? ` (${svc.error})` : ""}`
                    : "Background listening is off — open Settings ⚙ to turn it on."}
                </div>
              )}
            </>)}
          </>)}

          {/* ══════════════ HISTORY (admin) ══════════════ */}
          {tab === "hist" && isAdmin && (<>
            <div className="wk-card">
              <div className="wk-h">Who buzzed whom</div>
              <div className="wk-row-sub" style={{ marginTop:3 }}>
                Every buzz and every voice call, and whether the other side answered.
              </div>
              <div style={{ display:"flex", gap:10, flexWrap:"wrap", alignItems:"flex-end", marginTop:12 }}>
                <div className="wk-fld">
                  <label>Financial Year</label>
                  <select className="wk-in" value={hFy} onChange={(e) => onHFy(e.target.value)}>
                    <option value="">All Financial Years</option>
                    {years.map((y) => <option key={y.fy} value={y.fy}>{y.fy}{y.is_current ? "  (current)" : ""}</option>)}
                  </select>
                </div>
                <div className="wk-fld">
                  <label>Month</label>
                  <select className="wk-in" value={hMonth} onChange={(e) => onHMonth(e.target.value)} disabled={!hFy}>
                    <option value="">All Months</option>
                    {fyMonths(hFy).map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
                <div className="wk-fld">
                  <label>Date</label>
                  <input type="date" className="wk-in" value={hDate}
                         min={hMonth ? `${hMonth}-01` : undefined}
                         max={hMonth ? mahineKaAnt(hMonth) : undefined}
                         onChange={(e) => setHDate(e.target.value)} />
                </div>
                <div className="wk-fld">
                  <label>Person</label>
                  <select className="wk-in" value={hWho} onChange={(e) => setHWho(e.target.value)}>
                    <option value="">Everyone</option>
                    {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </div>
                <div className="wk-fld">
                  <label>Type</label>
                  <select className="wk-in" value={hKind} onChange={(e) => setHKind(e.target.value)}>
                    <option value="">Buzz and voice</option>
                    <option value="buzz">Buzz only</option>
                    <option value="voice">Voice only</option>
                  </select>
                </div>
                <div className="wk-fld">
                  <label>&nbsp;</label>
                  <button className="wk-mini" style={{ padding:"9px 16px" }} onClick={histSaaf}>✕ Clear</button>
                </div>
              </div>
            </div>

            <div className="wk-card">
              <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
                <span className="wk-h">
                  {hBusy ? "Loading…" : `${hRows.length} ${hRows.length === 1 ? "entry" : "entries"}`}
                </span>
                {!!hSel.size && (
                  <>
                    <span className="wk-row-sub">{hSel.size} selected</span>
                    <button className="wk-mini" disabled={hBusy} onClick={histMitao}
                            style={{ color:"#dc2626", borderColor:"#fecaca" }}>
                      🗑 Delete selected
                    </button>
                    <button className="wk-mini" onClick={() => setHSel(new Set())}>Clear selection</button>
                  </>
                )}
              </div>
              <div style={{ overflowX:"auto" }}>
                <table className="wk-tbl">
                  <thead><tr>
                    <th style={{ width:30 }}>
                      <input type="checkbox" title="Select all shown"
                             checked={!!hRows.length && hSel.size === hRows.length}
                             onChange={(e) => setHSel(e.target.checked
                               ? new Set(hRows.map((r) => r.id)) : new Set())} />
                    </th>
                    <th>When</th><th>Who</th><th>What</th><th>To</th><th>Answered</th><th>Length</th>
                  </tr></thead>
                  <tbody>
                    {!hBusy && !hRows.length && <tr><td colSpan={7} className="wk-empty">Nothing for this filter.</td></tr>}
                    {hRows.map((e) => (
                      <tr key={e.id} style={{ background: hSel.has(e.id) ? "#fef2f2" : undefined }}>
                        <td><input type="checkbox" checked={hSel.has(e.id)}
                                   onChange={() => histChuno(e.id)} /></td>
                        <td style={{ whiteSpace:"nowrap" }}>{fmtWhen(e.at)}</td>
                        <td style={{ fontWeight:700 }}>{e.from_name || "—"}</td>
                        <td style={{ whiteSpace:"nowrap" }}>{e.kind === "buzz" ? "📳 Buzz" : "🎙 Voice"}</td>
                        <td>{e.target_name || "—"}{e.target_type === "channel" ? " (channel)" : ""}</td>
                        <td style={{ whiteSpace:"nowrap" }}>
                          {e.kind !== "buzz"
                            ? <span style={{ color:"#94a3b8" }}>—</span>
                            : e.acked_at
                              ? <span style={{ color:"#16a34a", fontWeight:700 }}>
                                  ✓ {e.acked_name || "—"} · {fmtWhen(e.acked_at)}
                                </span>
                              : <span style={{ color:"#b45309", fontWeight:700 }}>No answer</span>}
                        </td>
                        <td>{e.secs == null ? "—" : `${e.secs}s`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>)}

          {/* ══════════════ SETUP (admin) ══════════════ */}
          {tab === "setup" && isAdmin && (<>
            <div className="wk-card">
              <div className="wk-h">Who can use the walkie-talkie</div>
              <div className="wk-row-sub" style={{ marginTop:2 }}>
                Only the people you tick here can talk or be called.
              </div>
              {members.map((m) => (
                <div key={m.id} className="wk-row" onClick={() => !busy && toggleMember(m)}>
                  <input type="checkbox" checked={!!m.enabled} readOnly />
                  <span style={{ flex:1, minWidth:0 }}>
                    <div className="wk-row-name">{m.name}</div>
                    <div className="wk-row-sub">{m.username} · {m.role}{m.online ? " · online" : ""}</div>
                  </span>
                </div>
              ))}
            </div>

            <div className="wk-card">
              <div className="wk-h">Channels</div>
              <div className="wk-row-sub" style={{ marginTop:2 }}>
                A channel lets one person talk to everybody in it at once.
              </div>
              <div style={{ display:"flex", gap:8, marginTop:10 }}>
                <input className="wk-in" style={{ flex:1 }} placeholder="New channel name"
                       value={newCh} onChange={(e) => setNewCh(e.target.value)} />
                <button className="wk-mini" style={{ padding:"8px 16px" }} disabled={busy || !newCh.trim()}
                        onClick={addChannel}>
                  + Add
                </button>
              </div>
              {/* Log YAHIN chun lo -- channel banate waqt.  Baad me bhi
                  badle ja sakte hain (neeche har channel ke apne chips). */}
              <div style={{ marginTop:8 }}>
                <div className="wk-row-sub" style={{ marginBottom:6 }}>
                  Who will be in it{newChWho.length ? ` — ${newChWho.length} selected` : ""}
                </div>
                <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
                  {enabledMembers.map((m) => {
                    const on = newChWho.includes(m.id);
                    return (
                      <button key={m.id} className="wk-mini"
                              style={on ? { background:theme.soft, borderColor:theme.accent, color:"#0f172a" } : undefined}
                              onClick={() => setNewChWho((x) => on ? x.filter((i) => i !== m.id) : [...x, m.id])}>
                        {on ? "✓ " : ""}{m.name}
                      </button>
                    );
                  })}
                  {!enabledMembers.length && <span className="wk-row-sub">Add people above first.</span>}
                </div>
              </div>
              {chans.map((c) => (
                <div key={c.id} style={{ marginTop:12, borderTop:"1px dashed #e2e8f0", paddingTop:10 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                    <b style={{ fontSize:13.5 }}>📢 {c.name}</b>
                    <span className="wk-row-sub">{(c.members || []).length} members</span>
                    <button className="wk-mini" style={{ marginLeft:"auto", color:"#dc2626", borderColor:"#fecaca" }}
                            disabled={busy} onClick={() => delChannel(c)}>Delete</button>
                  </div>
                  <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginTop:8 }}>
                    {enabledMembers.map((m) => {
                      const inCh = (c.members || []).includes(m.id);
                      return (
                        <button key={m.id} className="wk-mini" disabled={busy}
                                style={inCh ? { background:theme.soft, borderColor:theme.accent, color:"#0f172a" } : undefined}
                                onClick={() => toggleChanMember(c, m.id)}>
                          {inCh ? "✓ " : ""}{m.name}
                        </button>
                      );
                    })}
                    {!enabledMembers.length && <span className="wk-row-sub">Add people above first.</span>}
                  </div>
                </div>
              ))}
            </div>

          </>)}
        </div>
      </div>
    </>
  );
}
