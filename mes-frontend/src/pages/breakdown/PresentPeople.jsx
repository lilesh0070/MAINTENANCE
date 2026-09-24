import { useState, useEffect, useCallback, useMemo } from "react";
import { api } from "./shared";
import { walkieLink } from "../../constants/walkieLink";

/* ════════════════════════════════════════════════════════════════════
 * 1.6) Today Present Person — Maintenance Dashboard ke daayin taraf wale
 *      (30%) khaane me.  User 2026-09-23:
 *        "subah 7 baje se shaam 6 baje tak G aur A shift wale person ka
 *         naam aayega, aur shaam 6 baje se doosre din ki subah 7 baje tak
 *         B walon ka naam.  Upar TODAY PRESENT PERSON, uske aage shift,
 *         aur neeche naam."
 *
 *      Source: GET /api/attendance/on-duty
 *        { shift, slots[], day, now, count, people:[{id,name,emp_code,
 *          designation,slot}] }
 *
 *      ⚠ Shift ka faisla SERVER par hota hai, yahan nahi -- TV, phone aur
 *        website sab ki apni ghadi hoti hai, aur TV to kabhi-kabhi galat
 *        waqt par chalti hai.  Isliye yahan sirf dikhana hai.
 *      ⚠ Is endpoint me sirf naam jaate hain (contact/photo nahi), isliye
 *        Attendance Dashboard ki permission na hone par bhi ye dikhta hai.
 *
 *      ── Naam ke aage online ka nishaan + Buzz (2026-09-24) ──
 *      User: "naam ke aage buzz ka option do, walkie-talkie se jaisa jaata tha
 *      waise hi jaayega; online ho to aage green aaye, jaise walkie me aata hai."
 *      Isliye Walkie-Talkie page wala hi raasta -- nayi cheez kuch nahi:
 *        * Buzz  = `walkieLink.send({t:"buzz", target:{type:"user", id}})`.
 *          Server wahi jaanch karta hai (walkie-buzz ki ijazat + buzz ki jodi),
 *          aur itihaas me bhi wahi entry jaati hai.
 *        * Button wahi dikhta hai jahan walkie page par dikhta -- `can_buzz`
 *          aur Setup ki jodi (`can_buzz_ids`).  Offline par disabled.
 *      Attendance ka aadmi aur app user sirf EMP CODE se judte hain; jiski
 *      app ID nahi (ya walkie par nahi), uske aage na nishaan na button.
 *      ⚠ Website par walkie service default BAND hai (Services) -- tab socket
 *        nahi chalta, to online ki khabar roster (server) se aati hai aur Buzz
 *        disabled rehta hai.  Isi liye roster har 30 sec taaza hota hai.
 * ════════════════════════════════════════════════════════════════════ */

// Emp code ka ek hi roop -- dono taraf se aise hi milaate hain.
const saafCode = (c) => String(c || "").trim().toUpperCase();

/* Shift ka faisla YAHAN sirf PURANE server ke liye hai (neeche `board` wala
   raasta).  Naya server khud batata hai -- wahi sahi hai, kyunki TV / phone
   ki apni ghadi aksar galat chalti hai. */
const pad2 = (n) => String(n).padStart(2, "0");
function abKiShift() {
  const now = new Date();
  const h = now.getHours();
  const raat = h < 7 || h >= 18;
  const d = new Date(now);
  if (h < 7) d.setDate(d.getDate() - 1);   // aadhi raat ke baad = kal ki raat
  return {
    slots: raat ? ["B"] : ["G", "A"],
    shift: raat ? "B" : "G + A",
    day: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
  };
}

function PresentPeople({ token }) {
  const [d, setD]     = useState(null);
  const [err, setErr] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    /* 1) Naya raasta: server khud shift aur naam de deta hai. */
    try {
      setD(await api.get("/api/attendance/on-duty", token));
      setErr(false);
      return;
    } catch {
      /* Server ka backend abhi purana hai (endpoint 2026-09-23 ko bana) --
         neeche wala raasta lete hain.  `git pull` ke baad site to turant nayi
         ho jaati hai, par backend tab tak purana rehta hai jab tak use restart
         na karo; tab tak ye panel khaali na dikhe, isliye ye intezaam. */
    }
    /* 2) Purana raasta: wahi board jo Attendance Dashboard padhta hai, aur
          chhant yahin.  Dhyan: yahan waqt BROWSER ka lagta hai. */
    try {
      const w = abKiShift();
      const b = await api.get(`/api/attendance/board?day=${w.day}`, token);
      const log = (b?.people || [])
        .filter((p) => w.slots.includes(p.slot))
        .map((p) => ({ id: p.id, name: p.name, emp_code: p.emp_code,
                       designation: p.designation, slot: p.slot }));
      setD({ shift: w.shift, day: w.day, count: log.length, people: log });
      setErr(false);
    } catch { setErr(true); }
  }, [token]);

  useEffect(() => { load(); }, [load]);
  /* Har 2 minute par taaza: shift 7 aur 18 baje badalti hai, aur board din
     me kabhi bhi badal sakta hai.  Sirf timer -- koi lagataar chalne wali
     animation nahi (app me wo bhaari padti hai). */
  useEffect(() => {
    const t = setInterval(load, 120_000);
    return () => clearInterval(t);
  }, [load]);

  // ── walkie: kaun online, kisko buzz kar sakte hain (Walkie page jaisa) ──
  const [roster, setRoster] = useState(null);
  const [conn, setConn]     = useState(walkieLink.state.conn);
  const [online, setOnline] = useState(walkieLink.state.online || []);
  const [kehna, setKehna]   = useState("");

  const loadRoster = useCallback(() => {
    if (!token) return;
    api.get("/api/walkie/roster", token).then(setRoster).catch(() => setRoster(null));
  }, [token]);
  useEffect(() => { loadRoster(); }, [loadRoster]);
  /* Socket band ho (website par walkie OFF) to online ki khabar sirf isi se
     milti hai.  Sirf timer -- koi lagataar animation nahi. */
  useEffect(() => {
    const t = setInterval(loadRoster, 30_000);
    return () => clearInterval(t);
  }, [loadRoster]);

  /* App ka EK hi socket (`walkieLink`, Layout ka WalkiePresence chalata hai)
     -- yahan bas usi ko sunte hain, apna nahi kholte. */
  useEffect(() => {
    const lagao = () => { setConn(walkieLink.state.conn); setOnline(walkieLink.state.online || []); };
    lagao();
    let ghadi = null;
    const hatao = walkieLink.on((m) => {
      lagao();
      if (m.t === "buzz_sent") {
        setKehna(m.why || (m.listeners ? "Buzz sent" : "Nobody is online to buzz"));
        clearTimeout(ghadi);
        ghadi = setTimeout(() => setKehna(""), 3000);
      }
    });
    return () => { hatao(); clearTimeout(ghadi); };
  }, []);

  const byCode = useMemo(() => {
    const m = new Map();
    for (const w of roster?.people || []) {
      const c = saafCode(w.emp_code);
      if (c) m.set(c, w);
    }
    return m;
  }, [roster]);
  const buzzKinko = useMemo(() => new Set((roster?.can_buzz_ids || []).map(Number)), [roster]);
  const canBuzz = roster?.me?.can_buzz === true;
  const meraCode = saafCode(roster?.me?.emp_code);
  const sockOn = conn === "on";
  // Socket chalu ho to uski LIVE list, warna roster ki (server wali) jaankari
  const isOnline = (w) => (sockOn ? online.includes(w.id) : !!w.online);

  const buzz = (w) => {
    if (!sockOn) return;
    walkieLink.send({ t: "buzz", target: { type: "user", id: w.id } });
  };

  const khaali = { padding: "26px 16px", textAlign: "center", color: "#94a3b8",
                   fontSize: 12.5, fontStyle: "italic" };

  return (
    <div style={{ background: "#fff", border: "1px solid #e8edf3", borderRadius: 14,
                  overflow: "hidden", boxShadow: "0 1px 3px rgba(15,23,42,.05)" }}>
      {/* header — naam, ginti aur shift */}
      <div style={{ padding: "13px 16px", borderBottom: "1px solid #eef2f7",
                    display: "flex", alignItems: "center", gap: 11 }}>
        <span style={{ width: 34, height: 34, borderRadius: 9, background: "#0f766e", color: "#fff",
                       display: "inline-flex", alignItems: "center", justifyContent: "center",
                       fontSize: 16, flexShrink: 0 }}>👷</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 19, fontWeight: 800,
                        color: "#0f172a", lineHeight: 1.1 }}>Today Present Person</div>
          <div style={{ fontSize: 10.5, color: "#8a94a6", fontWeight: 600 }}>
            {d ? `${d.count} ${d.count === 1 ? "person" : "persons"} · ${d.day}` : "…"}
          </div>
        </div>
        {d && (
          <span style={{ flexShrink: 0, background: "#ecfdf5", color: "#0f766e",
                         border: "1px solid #a7f3d0", borderRadius: 99,
                         padding: "5px 12px", fontSize: 11, fontWeight: 800,
                         letterSpacing: ".06em", whiteSpace: "nowrap" }}>
            {d.shift} SHIFT
          </span>
        )}
      </div>

      {/* naam */}
      {err ? (
        <div style={{ ...khaali, color: "#dc2626", fontStyle: "normal" }}>
          Could not load attendance.
        </div>
      ) : !d ? (
        <div style={khaali}>Loading…</div>
      ) : d.people.length === 0 ? (
        <div style={khaali}>No one is marked in this shift yet.</div>
      ) : (
        <div style={{ maxHeight: 520, overflowY: "auto" }}>
          {d.people.map((p, i) => {
            const code = saafCode(p.emp_code);
            const w    = code ? byCode.get(code) : null;      // walkie wala banda
            const main = !!code && code === meraCode;         // ye main khud hoon
            const on   = main ? sockOn : (w ? isOnline(w) : false);
            const dot  = main || !!w;                          // app ID + walkie par
            const buzzHai = !main && w && canBuzz && buzzKinko.has(Number(w.id));
            const band = !sockOn || !on;
            return (
              /* Buzz wali row ka padding kam -- button (26px) naam (17px) se
                 ooncha hai, aur bina iske wo row 46px ki ho jaati jabki baaki
                 37px.  TV ka layout locked hai: list ki lambai pehle jitni rahe. */
              <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10,
                                       padding: buzzHai ? "5.5px 16px" : "10px 16px",
                                       borderTop: i === 0 ? "none" : "1px solid #f2f5f9" }}>
                <span style={{ flexShrink: 0, width: 22, fontSize: 11, fontWeight: 700,
                               color: "#b6bfcc" }}>{i + 1}</span>
                {/* Walkie jaisa: hara = online, dhusar = offline.  App ID na ho
                    to khaali jagah (naam ek line me rahe). */}
                <span title={dot ? (on ? "Online" : "Offline") : "No app login / not on walkie-talkie"}
                      style={{ flexShrink: 0, width: 9, height: 9, borderRadius: 99,
                               background: dot ? (on ? "#16a34a" : "#cbd5e1") : "transparent" }} />
                <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700, color: "#0f172a",
                               overflow: "hidden", textOverflow: "ellipsis",
                               whiteSpace: "nowrap" }}>{p.name}</span>
                {buzzHai && (
                  <button type="button" disabled={band} onClick={() => buzz(w)}
                          title={!sockOn ? "Walkie-talkie is off on this device"
                                 : !on ? `${p.name} is offline` : `Buzz ${p.name}`}
                          style={{ flexShrink: 0, padding: "4px 10px", borderRadius: 7,
                                   border: "1.5px solid #c7d2fe", background: "#eef2ff",
                                   color: "#4338ca", fontSize: 11, fontWeight: 800,
                                   cursor: band ? "not-allowed" : "pointer",
                                   opacity: band ? 0.45 : 1, whiteSpace: "nowrap" }}>
                    📳 Buzz
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {kehna && (
        <div style={{ padding: "8px 16px", borderTop: "1px solid #eef2f7", fontSize: 12,
                      fontWeight: 700, color: "#4338ca", background: "#f5f7ff" }}>
          {kehna}
        </div>
      )}
    </div>
  );
}

export default PresentPeople;
