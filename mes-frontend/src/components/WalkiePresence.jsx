/* WalkiePresence.jsx — walkie ka "hamesha chalne wala" hissa.
 *
 * `Layout` me baithta hai, yaani HAR page par.  Teen kaam:
 *   1. Poochho ki is user ko admin ne walkie par joda hai ya nahi
 *   2. Joda ho to socket chalu (aur phone par Java ki service bhi)
 *   3. Buzz aaye to POORI SCREEN par parda — chahe user kisi bhi page par ho
 *
 * KYUN HAR PAGE PAR
 * -----------------
 * Pehle ye sab walkie ke PAGE me tha.  Isliye banda tabhi "online" dikhta
 * tha jab wo wahi page khole baitha ho, aur buzz ka pata bhi wahin chalta
 * tha.  Ab app khuli ho — koi bhi page ho — dono cheezein chalti hain.
 *
 * Jinhe admin ne joda hi nahi, unke liye walkie ka kuch nahi — na socket, na
 * parda.  Par APP me background service ab ANDON bhi sunti hai (2026-09-19),
 * isliye wo unke liye bhi chalti hai — "sirf ANDON" ban kar.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { walkieLink, walkieWsBase } from "../constants/walkieLink";
import { walkieNative } from "../constants/walkieNative";
import { useServiceOn } from "../constants/clientServices";

export default function WalkiePresence() {
  const { token, user } = useAuth();
  const nav = useNavigate();
  const [buzz, setBuzz] = useState(null);      // { ev, from:{id,name}, target }
  /* Chat ki ijazat USI roster wale jawab se aati hai jo neeche pehle se
     maanga jaata hai -- iske liye ek bhi extra request nahi jaati. */
  const [canChat, setCanChat] = useState(false);
  const [jawab, setJawab]     = useState("");
  const [bhejRahe, setBhejRahe] = useState(false);
  /* Aayi hui chat ki chhoti patti.
     Phone par jab app BAND ho to Java ki service notification dikha deti
     hai -- par app KHULI ho aur banda kisi aur page par ho, to use kuch
     pata hi nahi chalta (buzz ka to poore screen par parda aata hai).
     Wahi khaali jagah ye patti bharti hai. */
  const [aayi, setAayi] = useState(null);   // { from, body, convo }

  /* Admin → Maintenance Panel → Services: is device (website / app) par
     walkie chale ya nahi, aur app me background service chale ya nahi.
     Website par default BAND, app par CHALU (`constants/clientServices`). */
  const walkieOn = useServiceOn("walkie");
  const bgOn     = useServiceOn("walkie_background");
  /* ANDON bhi ab isi background service se aata hai (app band ho tab bhi).
     Admin ka "ANDON alert" switch + user ki ANDON ijazat -- AndonAlert.jsx
     jaisa hi niyam: sirf saaf-saaf "none" band karta hai. */
  const andonOn  = useServiceOn("andon_alert");
  const andonSuno = andonOn && user?.permissions?.["andon-alert"] !== "none";

  /* Service chal rahi hai aur WALKIE sun rahi hai? -- app peechhe jaane par
     page ka socket band karne ke liye (neeche). */
  const sevaWalkie = useRef(false);

  // ── socket + service, har page par ─────────────────────────────
  useEffect(() => {
    if (!token) { walkieLink.stop(); return undefined; }
    let ruk = false;
    let ghadi = null;
    let phir = null;

    const chalao = async () => {
      /* Walkie par jude hue hain ya nahi -- ye poochhe bina socket kholna
         bekaar hai, server mana kar deta.  Server na mile to KUCH mat
         badlo (galat andaze par service ko "sirf ANDON" bana dena bura
         hota) -- 15 sec baad phir poochho.  Pehle yahan dobara poochna tha
         hi nahi: app khulte waqt Wi-Fi abhi jud raha ho to service kabhi
         chalti hi nahi thi -- aur ab ANDON bhi usi par tika hai. */
      let mera = false;
      if (walkieOn) {
        let pata = false;
        try {
          const r = await fetch("/api/walkie/roster", { headers: { Authorization: `Bearer ${token}` } });
          if (r.ok) {
            const me = (await r.json())?.me;
            mera = !!me?.enabled;
            pata = true;
            if (!ruk) setCanChat(me?.can_chat !== false);
          }
        } catch { /* server band ho to chup rah jao — baaki app chalti rahe */ }
        if (!pata) { if (!ruk) phir = setTimeout(chalao, 15000); return; }
      }
      if (ruk) return;

      /* Walkie is device par BAND (admin ne) ya member nahi -- na socket, na
         online, na parda, na aawaz. */
      const walkieHai = walkieOn && mera;
      if (walkieHai) walkieLink.start(token); else walkieLink.stop();

      if (!walkieNative.hai()) return;           // website -- service hai hi nahi

      /* TV board hamesha saamne khula rehta hai aur bijli par chalta hai --
         wahan SIRF ANDON ke liye background service (aur uski notification
         wali ijazat ka dialog board ke upar) nahi chahiye.  Page wahan
         pehle jaisa khud poochta hai.  (Walkie ka member ho to service
         pehle ki tarah chalti hai.) */
      const tv = document.documentElement.classList.contains("in-app-tv");
      if (!bgOn || (!walkieHai && !(andonSuno && !tv))) {
        /* Background listening BAND (admin ne), ya sunne ko kuch nahi --
           service mat chalao (chal rahi ho to rok do).  Tab app khuli ho
           tabhi page khud sunta aur bajata hai; band app me kuch nahi. */
        sevaWalkie.current = false;
        await walkieNative.stop().catch(() => {});
        if (!ruk) walkieLink.setPlayHere(true);
        return;
      }
      /* Phone par sunne ka kaam service ka hai (walkie + ANDON) — page ko
         bajane se rok do, warna ek hi aawaz do baar aati hai.  Service kabhi
         mar jaye to `running` false ho jaata hai aur page khud bajane lagta
         hai. */
      const taaza = () => walkieNative.status()
        .then((s) => {
          if (ruk) return;
          sevaWalkie.current = !!s?.running && walkieHai;
          walkieLink.setPlayHere(!s?.running);
        })
        .catch(() => {});
      await walkieNative.requestPerms().catch(() => {});
      if (ruk) return;
      await walkieNative.start(walkieWsBase(), token, { andon: andonSuno, walkie: walkieHai }).catch(() => {});
      taaza();
      ghadi = setInterval(taaza, 8000);
    };
    chalao();

    return () => { ruk = true; if (ghadi) clearInterval(ghadi); if (phir) clearTimeout(phir); };
  }, [token, walkieOn, bgOn, andonSuno]);

  /* App PEECHHE gayi aur service walkie sun rahi hai -- page ka apna socket
     band (wapas aate hi phir jud jaata hai).  Warna wo socket bhi har 20 sec
     server ka ping aur har online/offline ka message khaata, aur jeb me pada
     phone bina kaam jaagta -- service ka ping lamba karne ka faayda hi na
     hota.  (User 2026-09-19: battery.)  Service na chal rahi ho to kuch
     nahi badalta -- tab yahi socket akela sunne wala hai. */
  useEffect(() => {
    if (!token || !walkieNative.hai()) return undefined;
    const badlo = () => {
      if (document.visibilityState === "hidden") {
        if (sevaWalkie.current) walkieLink.pause();
      } else {
        walkieLink.resume();
      }
    };
    document.addEventListener("visibilitychange", badlo);
    return () => document.removeEventListener("visibilitychange", badlo);
  }, [token]);

  // ── buzz ka parda ──────────────────────────────────────────────
  useEffect(() => walkieLink.on((d) => {
    if (d.t === "chat") {
      /* Apna hi bheja hua wapas aata hai (doosre device ke liye) -- uspar
         apne aap ko khabar dena bemtlab hai.  Aur walkie ka page khud khula
         ho to bhi nahi: wahan baat pehle se saamne hai.  (Native
         notification ka bhi yahi niyam hai -- `APP_FOREGROUND`.) */
      const mera = walkieLink.state?.me?.id;
      if (mera && Number(d.from?.id) === Number(mera)) return;
      /* Patti SIRF tab nahi dikhti jab WAHI baat-cheet saamne khuli ho.
         Pehle yahan "walkie ka page khula hai kya" dekha jaata tha -- us
         wajah se Talk / Setup / History tab par baithe bande ko message ki
         koi khabar hi nahi milti thi (device par naapa gaya). */
      if (d.convo && walkieLink.khulaConvo === d.convo) return;
      setAayi({ from: d.from?.name || "Someone", body: d.body || "", convo: d.convo });
      return;
    }
    if (d.t === "buzz") {
      setBuzz(d);
      setJawab("");
      try { navigator.vibrate?.([260, 120, 260, 120, 260]); } catch { /* nahi hua to nahi */ }
    } else if (d.t === "rx_start") {
      // Koi bolne laga — bulawa apne aap poora ho gaya.
      setBuzz(null);
    }
  }), []);

  /* "OK" — teen kaam ek saath:
       1. server par likh do ki jawab mil gaya (history me dikhega)
       2. phone par baj rahi ring/vibration band karo
       3. parda hatao                                                */
  const theekHai = useCallback(async (kholo) => {
    const ev = buzz?.ev;
    setBuzz(null);
    try { await walkieNative.ack(); } catch { /* app me nahi hain */ }
    if (ev && token) {
      try {
        await fetch(`/api/walkie/events/${ev}/ack`, {
          method: "POST", headers: { Authorization: `Bearer ${token}` },
        });
      } catch { /* net gaya to bhi parda to hat hi gaya */ }
    }
    if (kholo) nav("/walkie-talkie");
  }, [buzz, token, nav]);

  /* Jawab bhejna = jawab dena.  Isliye bhejte hi wahi teen kaam ho jaate
     hain jo "OK" karta hai (ring band, server par ack, parda hatao) --
     bande ko do baar tap karne ki zaroorat nahi.

     Kahan jaata hai: buzz agar GROUP par tha to usi group me (taaki sabko
     pata chale), aur seedha buzz tha to BULANE WALE ko -- `buzz.target`
     us soorat me "main" hoon, isliye wo nahi chalega. */
  const jawabDo = async () => {
    const b = jawab.trim();
    if (!b || bhejRahe) return;
    const target = buzz?.target?.type === "channel"
      ? { type: "channel", id: buzz.target.id }
      : { type: "user", id: buzz?.from?.id };
    if (!target.id) return;
    setBhejRahe(true);
    try {
      // Socket khula ho to wahi -- ek bhi HTTP request nahi.
      if (!(walkieLink.state.conn === "on" && walkieLink.send({ t: "chat", target, body: b }))) {
        await fetch("/api/walkie/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json",
                     Authorization: `Bearer ${token}` },
          body: JSON.stringify({ target_type: target.type, target_id: target.id, body: b }),
        });
      }
    } catch { /* net gaya -- parda phir bhi hat jayega, ring band ho jayegi */ }
    setBhejRahe(false);
    setJawab("");
    theekHai(false);
  };

  if (!buzz) {
    if (!aayi) return null;
    /* Sirf patti -- buzz jaisa poora parda NAHI.  Message aana kaam rokne
       ki wajah nahi hai; buzz hai. */
    return (
      <div style={{ position:"fixed", left:12, right:12, bottom:16, zIndex:19000,
                    display:"flex", justifyContent:"center", pointerEvents:"none" }}>
        <div onClick={() => {
               /* Tap -> wahi baat-cheet kholni hai.  Walkie ka page ise
                  uthata hai (chahe wo pehle se khula ho). */
               walkieLink.jaoConvo = aayi.convo || null;
               setAayi(null);
               nav("/walkie-talkie");
             }}
             style={{ pointerEvents:"auto", cursor:"pointer", maxWidth:420, width:"100%",
                      background:"#0f172a", color:"#fff", borderRadius:12,
                      padding:"11px 13px", display:"flex", gap:10, alignItems:"flex-start",
                      boxShadow:"0 10px 30px rgba(0,0,0,.35)",
                      fontFamily:"'Barlow',sans-serif" }}>
          <span style={{ fontSize:18, lineHeight:1.1 }}>💬</span>
          <span style={{ minWidth:0, flex:1 }}>
            <span style={{ display:"block", fontSize:13, fontWeight:800 }}>{aayi.from}</span>
            <span style={{ display:"block", fontSize:12.5, opacity:.9,
                           overflow:"hidden", textOverflow:"ellipsis",
                           whiteSpace:"nowrap" }}>{aayi.body}</span>
          </span>
          <button onClick={(e) => { e.stopPropagation(); setAayi(null); }}
                  style={{ background:"none", border:"none", color:"#94a3b8",
                           fontSize:16, cursor:"pointer", padding:"0 2px",
                           fontFamily:"inherit" }}>✕</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 20000,
                  background: "rgba(15,23,42,.6)", display: "flex",
                  alignItems: "center", justifyContent: "center", padding: 18 }}>
      <div style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 340,
                    padding: "22px 20px", textAlign: "center",
                    boxShadow: "0 18px 50px rgba(0,0,0,.35)",
                    fontFamily: "'Barlow',sans-serif" }}>
        <div style={{ fontSize: 34, lineHeight: 1 }}>📳</div>
        <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a", marginTop: 10 }}>
          {buzz.from?.name || "Someone"} is buzzing you
        </div>
        <div style={{ fontSize: 12.5, color: "#64748b", marginTop: 5, lineHeight: 1.5 }}>
          {buzz.target?.type === "channel"
            ? "Sent to your channel"
            : "Sent to you directly"}
        </div>
        <button onClick={() => theekHai(false)}
                style={{ width: "100%", marginTop: 18, padding: "13px 0", borderRadius: 11,
                         border: "none", background: "#16a34a", color: "#fff",
                         fontWeight: 800, fontSize: 15, cursor: "pointer",
                         fontFamily: "inherit" }}>
          OK
        </button>
        {/* Likh kar jawab -- taaki bulane wale ko TURANT pata chal jaye
            ("5 min me aata hoon"), bina walkie ka page khole. */}
        {canChat && (
          <div style={{ display: "flex", gap: 7, marginTop: 10 }}>
            <input value={jawab} maxLength={1000} autoComplete="off"
                   placeholder="Reply…"
                   onChange={(e) => setJawab(e.target.value)}
                   onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); jawabDo(); } }}
                   style={{ flex: 1, minWidth: 0, padding: "11px 12px", borderRadius: 11,
                            border: "1px solid #cbd5e1", fontSize: 14,
                            fontFamily: "inherit", background: "#fff" }} />
            <button onClick={jawabDo} disabled={!jawab.trim() || bhejRahe}
                    style={{ padding: "11px 15px", borderRadius: 11, border: "none",
                             background: jawab.trim() ? "#1e40af" : "#cbd5e1",
                             color: "#fff", fontWeight: 800, fontSize: 13.5,
                             cursor: jawab.trim() ? "pointer" : "default",
                             fontFamily: "inherit", flex: "0 0 auto" }}>
              {bhejRahe ? "…" : "Send"}
            </button>
          </div>
        )}
        <button onClick={() => theekHai(true)}
                style={{ width: "100%", marginTop: 9, padding: "11px 0", borderRadius: 11,
                         border: "1px solid #cbd5e1", background: "#f8fafc", color: "#334155",
                         fontWeight: 800, fontSize: 13.5, cursor: "pointer",
                         fontFamily: "inherit" }}>
          🎙 Open Walkie-Talkie
        </button>
      </div>
    </div>
  );
}
