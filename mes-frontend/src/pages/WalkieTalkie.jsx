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
import { API_BASE, isNativeApp } from "../constants/apiBase";
import { micShuru, speakerBanao } from "../constants/walkieAudio";
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

/* `http://1.2.3.4:8892` -> `ws://1.2.3.4:8892`.  Website par API_BASE khali
   hota hai, to page ka apna pata lete hain (https ho to wss). */
function wsBase() {
  const base = API_BASE || window.location.origin;
  return base.replace(/^http/i, (m) => (m === "https" || m === "HTTPS" ? "wss" : "ws"))
         + "/api/walkie/ws";
}
function wsUrl(token) {
  return `${wsBase()}?role=rx&kind=web&token=${encodeURIComponent(token)}`;
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

  const [tab, setTab] = useState("talk");
  const [roster, setRoster] = useState({ me: null, people: [], channels: [] });
  const [online, setOnline] = useState([]);
  const [conn, setConn] = useState("connecting");      // connecting | on | off | denied
  const [pick, setPick] = useState(null);              // {type:"user"|"channel", id, name}
  const [talking, setTalking] = useState(false);
  const [level, setLevel] = useState(0);
  const [rxFrom, setRxFrom] = useState(null);          // kaun abhi bol raha hai
  const [kehna, setKehna] = useState("");
  const [busy, setBusy] = useState(false);

  const ws = useRef(null);
  const mic = useRef(null);
  const spk = useRef(null);
  const retry = useRef(0);

  /* Service chal rahi ho to page aawaz NA bajaye — warna do baar sunayi
     deti hai.  (Service abhi lagi na ho to `false` aata hai aur page khud
     baja deta hai.) */
  const [svcOn, setSvcOn] = useState(false);
  /* ⚠ Ye faisla ek REF me rakhte hain, socket-effect ki dependency me NAHI.
     Pehle `bajaoYahan` seedha effect ki list me tha -- aur `svcOn` false se
     true hote hi (service ka haal aate hi, page khulne ke ~1s baad) poora
     effect dobara chalta tha: purana socket band, naya khula.  Socket band
     hote hi server FLOOR chhod deta hai, aur uske baad bheji hui saari aawaz
     chup-chaap gir jaati thi.
     Asar dikhta aisa tha: page kholne ke baad PEHLI baar bolne par aawaz
     aadhe second me kat jaati thi.  Naapa: 7 second dabaya, doosri taraf
     sirf 0.44s (11 frame) pahuncha aur beech me hi `rx_stop` aa gaya. */
  const bajaoRef = useRef(true);
  useEffect(() => { bajaoRef.current = !isNativeApp() || !svcOn; }, [svcOn]);

  const bolo = useCallback((o) => {
    try { ws.current?.readyState === 1 && ws.current.send(JSON.stringify(o)); } catch { /* socket gir gaya */ }
  }, []);

  // ── roster ──────────────────────────────────────────────────────
  const loadRoster = useCallback(() => {
    if (!token) return;
    api.get("/api/walkie/roster", token)
      .then((d) => setRoster(d || { me: null, people: [], channels: [] }))
      .catch(() => {});
  }, [token]);
  useEffect(() => { loadRoster(); }, [loadRoster]);

  // ── socket ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!token) return undefined;
    /* ⚠ Ye jhanda EFFECT KE ANDAR hai, `useRef` me NAHI -- aur ye farak
       bahut mehnga pada tha.  Ref saare mount me saajha hota hai, to purane
       socket ka `onclose` NAYE mount ke baad chalta hai, `zinda.current`
       tab tak dobara `true` ho chuka hota hai, aur wo ek AUR socket jod
       deta hai.  Dev me StrictMode har effect do baar chalata hai, isliye
       ye turant dikh gaya: server ne "2 listeners" bataya aur bheja hua
       har frame DO BAAR aaya (25 bheje, 50 aaye -- naapa).  Production me
       bhi jab bhi ye effect dobara chalta (token badla, service ka haal
       badla) wahi zombie socket ban jaate.
       Local jhande se har run apna hi socket sambhalta hai. */
    let alive = true;
    spk.current = speakerBanao();

    const jodo = () => {
      if (!alive) return;
      let s;
      try { s = new WebSocket(wsUrl(token)); } catch { setConn("off"); return; }
      s.binaryType = "arraybuffer";
      ws.current = s;

      s.onopen = () => { retry.current = 0; setConn("on"); };

      s.onmessage = (e) => {
        if (typeof e.data !== "string") {
          if (bajaoRef.current) spk.current?.push(e.data);
          return;
        }
        let d; try { d = JSON.parse(e.data); } catch { return; }
        if (d.t === "presence") setOnline(d.online || []);
        else if (d.t === "ready") setOnline(d.online || []);
        else if (d.t === "rx_start") { spk.current?.reset(); setRxFrom(d.from); }
        else if (d.t === "rx_stop") setRxFrom(null);
        else if (d.t === "buzz") {
          setKehna(`${d.from?.name || "Someone"} is buzzing you`);
          try { navigator.vibrate?.([260, 120, 260]); } catch { /* nahi hua to nahi */ }
          setTimeout(() => setKehna(""), 4000);
        } else if (d.t === "floor") {
          if (d.ok) {
            setKehna(d.listeners ? "" : "No one is listening right now");
          } else if (d.why && d.why !== "stopped") {
            setKehna(d.why);
            rukJao(false);
          }
        } else if (d.t === "floor_lost") {
          setKehna("Talk time limit reached");
          rukJao(false);
        } else if (d.t === "buzz_sent") {
          setKehna(d.listeners ? "Buzz sent" : "Nobody is online to buzz");
          setTimeout(() => setKehna(""), 3000);
        }
      };

      s.onclose = (ev) => {
        if (ws.current === s) ws.current = null;
        if (!alive) return;
        // 4403 = admin ne walkie se hata diya.  Dobara jodne ki koshish
        // bekaar hai — user ko saaf batao.
        if (ev.code === 4403) { setConn("denied"); return; }
        setConn("off");
        retry.current = Math.min(retry.current + 1, 6);
        setTimeout(jodo, 500 * 2 ** (retry.current - 1));   // 0.5s → 16s
      };
      s.onerror = () => { try { s.close(); } catch { /* band ho hi raha hai */ } };
    };

    jodo();
    return () => {
      alive = false;
      try { ws.current?.close(); } catch { /* pehle se band */ }
      try { mic.current?.band(); } catch { /* chal hi nahi raha tha */ }
      try { spk.current?.band(); } catch { /* chal hi nahi raha tha */ }
      ws.current = null; mic.current = null; spk.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // presence badle to roster ka online dot bhi taaza ho
  useEffect(() => {
    setRoster((r) => ({
      ...r,
      people: (r.people || []).map((p) => ({ ...p, online: online.includes(p.id) })),
    }));
  }, [online]);

  /* Native service: page khulte hi chalu kar dete hain.
     Ye "chupke se" nahi hai — service apni permanent notification dikhati hai
     ("Walkie-Talkie · Listening"), to user ko hamesha pata rehta hai.  Aur
     yahi ek tareeqa hai jisse jeb me pade phone par call pahunche.
     Page band karne par band NAHI karte — wahi to poora maqsad hai. */
  const [svc, setSvc] = useState({ running: false, connected: false, error: "", ignoringBattery: false });
  useEffect(() => {
    if (!token || !walkieNative.hai()) return undefined;
    let stop = false;
    const taaza = () => walkieNative.status().then((x) => {
      if (stop) return;
      setSvc(x || {}); setSvcOn(!!x?.running);
    }).catch(() => {});
    // Pehle notification ki ijazat, PHIR service -- ulta karne par service
    // chal to jaati hai par uski patti dikhti hi nahi, aur user ko lagta hai
    // kuch hua hi nahi.
    walkieNative.requestPerms()
      .then(() => walkieNative.start(wsBase(), token))
      .then(taaza).catch(taaza);
    const t = setInterval(taaza, 4000);
    return () => { stop = true; clearInterval(t); };
  }, [token]);

  // ── bolna ───────────────────────────────────────────────────────
  const boloShuru = async () => {
    if (talking || !pick || conn !== "on") return;
    setKehna("");
    spk.current?.jagao();
    setTalking(true);
    bolo({ t: "ptt_start", target: { type: pick.type, id: pick.id } });
    try {
      mic.current = await micShuru({
        onFrame: (buf) => {
          try { ws.current?.readyState === 1 && ws.current.send(buf); } catch { /* socket gir gaya */ }
        },
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
  const [events, setEvents] = useState([]);
  const loadSetup = useCallback(() => {
    if (!token || !isAdmin) return;
    api.get("/api/walkie/members", token).then(setMembers).catch(() => setMembers([]));
    api.get("/api/walkie/channels", token).then(setChans).catch(() => setChans([]));
    api.get("/api/walkie/events?limit=60", token).then(setEvents).catch(() => setEvents([]));
  }, [token, isAdmin]);
  useEffect(() => { if (tab === "setup") loadSetup(); }, [tab, loadSetup]);

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
    try { await api.send("POST", "/api/walkie/channels", { name: nm }, token); setNewCh(""); loadSetup(); }
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
                 font-family:inherit; outline:none; }
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
                      <button className="wk-mini" onClick={(e) => { e.stopPropagation(); buzz({ type:"channel", id:c.id }); }}>
                        📳 Buzz
                      </button>
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
                      <button className="wk-mini" disabled={!p.online}
                              onClick={(e) => { e.stopPropagation(); buzz({ type:"user", id:p.id }); }}>
                        📳 Buzz
                      </button>
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
                        disabled={!pick || conn !== "on"}
                        onPointerDown={(e) => { e.currentTarget.setPointerCapture?.(e.pointerId); boloShuru(); }}
                        onPointerUp={() => talking && rukJao()}
                        onPointerCancel={() => talking && rukJao()}
                        onContextMenu={(e) => e.preventDefault()}>
                  {talking ? "● ON AIR — release to stop" : "🎙 PRESS AND HOLD TO TALK"}
                </button>
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
                <button className="wk-mini" style={{ padding:"8px 16px" }} disabled={busy} onClick={addChannel}>
                  + Add
                </button>
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

            <div className="wk-card">
              <div className="wk-h">Recent activity</div>
              <table className="wk-tbl">
                <thead><tr><th>When</th><th>Who</th><th>What</th><th>To</th><th>Length</th></tr></thead>
                <tbody>
                  {!events.length && <tr><td colSpan={5} className="wk-empty">Nothing yet.</td></tr>}
                  {events.map((e) => (
                    <tr key={e.id}>
                      <td style={{ whiteSpace:"nowrap" }}>{fmtWhen(e.at)}</td>
                      <td style={{ fontWeight:700 }}>{e.from_name || "—"}</td>
                      <td>{e.kind === "buzz" ? "📳 Buzz" : "🎙 Voice"}</td>
                      <td>{e.target_name || "—"}</td>
                      <td>{e.secs == null ? "—" : `${e.secs}s`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>)}
        </div>
      </div>
    </>
  );
}
