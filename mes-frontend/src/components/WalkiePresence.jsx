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
 * Jinhe admin ne joda hi nahi, unke liye ye kuch nahi karta — na socket, na
 * service, na koi parda, na permission ka sawaal.
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { walkieLink, walkieWsBase } from "../constants/walkieLink";
import { walkieNative } from "../constants/walkieNative";

export default function WalkiePresence() {
  const { token } = useAuth();
  const nav = useNavigate();
  const [buzz, setBuzz] = useState(null);      // { ev, from:{id,name}, target }

  // ── socket + service, har page par ─────────────────────────────
  useEffect(() => {
    if (!token) { walkieLink.stop(); return undefined; }
    let ruk = false;
    let ghadi = null;

    (async () => {
      // Jude hue hain ya nahi — ye poochhe bina socket kholna bekaar hai,
      // server waise bhi 4403 de kar band kar dega.
      let mera = false;
      try {
        const r = await fetch("/api/walkie/roster", { headers: { Authorization: `Bearer ${token}` } });
        if (r.ok) mera = !!(await r.json())?.me?.enabled;
      } catch { /* server band ho to chup rah jao — baaki app chalti rahe */ }
      if (ruk || !mera) return;

      walkieLink.start(token);

      if (walkieNative.hai()) {
        /* Phone par sunne ka kaam service ka hai — page ko bajane se rok do,
           warna ek hi aawaz do baar aati hai.  Service kabhi mar jaye to
           `running` false ho jaata hai aur page khud bajane lagta hai. */
        const taaza = () => walkieNative.status()
          .then((s) => { if (!ruk) walkieLink.setPlayHere(!s?.running); })
          .catch(() => {});
        await walkieNative.requestPerms().catch(() => {});
        await walkieNative.start(walkieWsBase(), token).catch(() => {});
        taaza();
        ghadi = setInterval(taaza, 8000);
      }
    })();

    return () => { ruk = true; if (ghadi) clearInterval(ghadi); };
  }, [token]);

  // ── buzz ka parda ──────────────────────────────────────────────
  useEffect(() => walkieLink.on((d) => {
    if (d.t === "buzz") {
      setBuzz(d);
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

  if (!buzz) return null;

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
