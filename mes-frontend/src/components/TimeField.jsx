/* TimeField.jsx — 12-ghante ka time khaana:  [hh] : [mm]  [AM | PM]
 *
 * User 2026-10-03 (Log Book): "default AM/PM current uthaye, abhi PM utha raha
 * hai".  Native <input type="time"> desktop (Chrome / Edge) par ghanta-minute
 * bharne ke baad AM/PM KHAALI chhodta hai (value "" hi rehti hai) aur teer /
 * scroll par pehle PM deta hai.  Isliye apna khaana: khaali ho to AM/PM ABHI ka
 * (dopahar 12 se pehle AM, baad me PM); user badle to uski pasand.
 *
 * value / onChange: "HH:MM" (24 ghante) ya "" -- native jaisa hi, isliye page
 * ka baaki hisaab (Total time, save) waisa hi rehta hai.  Adhoora / galat = "".
 * Ghanta 13-23 ya 00 likha to 24-ghante wala samajh kar AM/PM khud.  Ghanta /
 * minute me "a" / "p" dabao to AM / PM.
 *
 * Bahar ka dabba `className` se (page ka .lb-in jaisa) -- naap wahi rahe.
 */
import { useRef, useState } from "react";

const abhiKa = () => (new Date().getHours() >= 12 ? "PM" : "AM");
const pad2 = (n) => String(n).padStart(2, "0");

// "HH:MM" -> { h: "09", m: "30", ap: "AM" };  khaali / galat -> null
function tod(v) {
  const x = /^(\d{1,2}):(\d{2})/.exec(String(v || ""));
  if (!x || Number(x[1]) > 23 || Number(x[2]) > 59) return null;
  const H = Number(x[1]);
  return { h: pad2(H % 12 === 0 ? 12 : H % 12), m: x[2], ap: H >= 12 ? "PM" : "AM" };
}

// ghanta (1-12) + minute + AM/PM -> "HH:MM";  adhoora / galat -> ""
function joro(h, m, ap) {
  if (!/^\d{1,2}$/.test(h) || !/^\d{1,2}$/.test(m)) return "";
  const H = Number(h), M = Number(m);
  if (H < 1 || H > 12 || M > 59) return "";
  return `${pad2(ap === "PM" ? (H % 12) + 12 : H % 12)}:${pad2(M)}`;
}

const CSS = `
.tf { display:flex; align-items:center; gap:2px; }
.tf .tf-n { width:1.9em; min-width:0; border:none; outline:none; background:transparent; padding:0;
            font:inherit; color:inherit; text-align:center; }
.tf .tf-n::placeholder { color:#94a3b8; }
.tf .tf-c { color:#64748b; font-weight:700; }
.tf .tf-ap { display:inline-flex; margin-left:auto; border:1px solid #cbd5e1; border-radius:6px;
             overflow:hidden; flex-shrink:0; }
.tf .tf-ap button { border:none; background:#fff; color:#64748b; font:inherit; font-size:11px;
                    font-weight:800; letter-spacing:.03em; padding:0 6px; line-height:16px; cursor:pointer; }
.tf .tf-ap button + button { border-left:1px solid #cbd5e1; }
.tf .tf-ap button:disabled { cursor:not-allowed; }
.tf.bad { border-color:#dc2626 !important; }
`;

// value -> khaane ki haalat;  sent = parent ke paas abhi kaunsi value hai
const haalat = (v) => ({ ...(tod(v) || { h: "", m: "", ap: null }), sent: v || "" });

export default function TimeField({ value, onChange, className = "", disabled = false,
                                    accent = "#2563eb", label = "Time" }) {
  const [st, setSt] = useState(() => haalat(value));
  const minRef = useRef(null);
  const hrRef = useRef(null);

  // bahar se value badli (edit kholna / save ke baad khaali) -- apna bheja hua
  // nahi.  Render me hi (effect me setState lint mana karta hai, aur ek render
  // ka jhatka bhi bachta hai).
  const cur = (value || "") === st.sent ? st : haalat(value);
  if (cur !== st) setSt(cur);
  const { h, m } = cur;
  const apNow = cur.ap || abhiKa();               // null = khaali khaana -> abhi ka

  const rakho = (nh, nm, nap) => {
    const v = joro(nh, nm, nap);
    setSt({ h: nh, m: nm, ap: nap, sent: v });
    if (v !== cur.sent) onChange(v);
  };

  const ghanta = (raw) => {
    let t = raw.replace(/\D/g, "").slice(0, 2);
    let nap = apNow;
    if (t.length === 2) {
      const n = Number(t);
      if (n === 0) { t = "12"; nap = "AM"; }                         // 00 = raat 12 (AM)
      else if (n >= 13 && n <= 23) { t = pad2(n - 12); nap = "PM"; } // 24-ghante wala
    }
    rakho(t, m, nap);
    // do ank, ya pehla ank 2-9 (aage ank nahi ho sakta) -> minute par
    if (t.length === 2 || (t.length === 1 && Number(t) >= 2)) minRef.current?.focus();
  };
  const minute = (raw) => rakho(h, raw.replace(/\D/g, "").slice(0, 2), apNow);
  const chuno = (x) => { if (!disabled) rakho(h, m, x); };
  // a / p se AM / PM;  khaali minute me Backspace -> ghante par
  const keys = (e, kaun) => {
    const k = e.key.toLowerCase();
    if (k === "a" || k === "p") { e.preventDefault(); chuno(k === "a" ? "AM" : "PM"); return; }
    if (kaun === "m" && e.key === "Backspace" && !m) { e.preventDefault(); hrRef.current?.focus(); }
  };
  // blur par ek ank -> do ank (9 -> 09);  value wahi rehti hai.  Functional --
  // ghante se minute par focus usi event me jaata hai, closure purana hota hai.
  const bharo = (k) => setSt((s) => (/^\d$/.test(s[k]) && (k === "m" || Number(s[k]) >= 1)
    ? { ...s, [k]: pad2(s[k]) } : s));
  // dabbe ki khaali jagah par click/tap -> andar ka khaana (native jaisa)
  const dabba = (e) => {
    if (disabled || e.target.closest("input, button")) return;
    (h && !m ? minRef : hrRef).current?.focus();
  };
  const bad = !!h && !!m && !joro(h, m, apNow);

  return (
    <div className={`${className} tf${bad ? " bad" : ""}`} role="group" aria-label={label} onClick={dabba}>
      <style>{CSS}</style>
      <input ref={hrRef} className="tf-n" inputMode="numeric" autoComplete="off" placeholder="hh"
             aria-label={`${label} hour`} value={h} disabled={disabled}
             onChange={(e) => ghanta(e.target.value)} onKeyDown={(e) => keys(e, "h")}
             onBlur={() => bharo("h")} />
      <span className="tf-c">:</span>
      <input ref={minRef} className="tf-n" inputMode="numeric" autoComplete="off" placeholder="mm"
             aria-label={`${label} minute`} value={m} disabled={disabled}
             onChange={(e) => minute(e.target.value)} onKeyDown={(e) => keys(e, "m")}
             onBlur={() => bharo("m")} />
      <span className="tf-ap" role="radiogroup" aria-label={`${label} AM or PM`}>
        {["AM", "PM"].map((x) => (
          <button key={x} type="button" role="radio" aria-checked={apNow === x} disabled={disabled}
                  onClick={() => chuno(x)}
                  style={apNow === x ? { background: accent, color: "#fff" } : undefined}>{x}</button>
        ))}
      </span>
    </div>
  );
}
