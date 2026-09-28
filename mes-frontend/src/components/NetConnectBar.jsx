/* NetConnectBar.jsx — login page ke UPAR ki patti: internet wala raasta
 * (maintenance.dxtbdi.com) chalu/band + abhi kis raaste se jude hain.
 *
 * User 2026-09-28: "app me setting me option do ki maintenance.dxtbdi.com se
 * connection rakhna hai ki nahi; off kar de to phir na chale, chahe net on
 * ho.  Ye setting login page me hi upar do, kyunki login page bina internet
 * ke khul jaata hai."  (Settings ka ⚙ login ke BAAD hi dikhta hai, isliye
 * wahan wala switch login se pehle kaam ka nahi.)
 *
 * SIRF APK ME -- website par `null` (wahan site khud domain/LAN se hi aati hai).
 * Koi lagataar animation NAHI (TV par ANR ka sabak) -- "Connecting…" bas text.
 */
import { useEffect, useState } from "react";
import { isNativeApp, internetChalu, setInternetChalu, reprobeServer, serverHaal,
         INTERNET_URL } from "../constants/apiBase";

const DOMAIN = INTERNET_URL.replace(/^https?:\/\//, "");

export default function NetConnectBar() {
  const NATIVE = isNativeApp();
  const [on, setOn] = useState(internetChalu);
  const [haal, setHaal] = useState(serverHaal);

  useEffect(() => {
    if (!NATIVE) return undefined;
    const taaza = () => setHaal(serverHaal());
    window.addEventListener("mes-server", taaza);
    // render aur yahan ke beech koi khabar chhoot gayi ho to ek baar aur padho
    const t = setTimeout(taaza, 0);
    return () => { clearTimeout(t); window.removeEventListener("mes-server", taaza); };
  }, [NATIVE]);

  if (!NATIVE) return null;

  const badlo = () => {
    const naya = !on;
    setInternetChalu(naya);
    setOn(naya);
    reprobeServer();                           // haal "mes-server" event se aata hai
  };

  let rang = "#f59e0b", matn = "Connecting…";
  if (!haal.chal) {
    if (haal.mila) {
      rang = "#22c55e";
      matn = "Connected over " + haal.naam;
    } else {
      // Chhota hi rakho -- phone par "(internet is off)" jodne se kat jaata tha
      // (emulator par naapa); band hai ye switch khud "Internet off" batata hai.
      rang = "#ef4444";
      matn = "No server found";
    }
  }

  return (
    <div className="ncb">
      <style>{`
        .ncb { position: relative; z-index: 2; width: min(460px, calc(100vw - 24px));
               box-sizing: border-box; display: flex; align-items: center; gap: 10px;
               padding: 8px 10px 8px 12px; border-radius: 12px;
               background: rgba(15,24,41,.92); border: 1px solid rgba(255,255,255,.10);
               box-shadow: 0 6px 22px rgba(0,0,0,.35); font-family: 'Barlow', sans-serif; }
        .ncb * { box-sizing: border-box; }
        .ncb-haal { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px;
                    background: none; border: none; padding: 4px 0; cursor: pointer;
                    color: rgba(255,255,255,.82); font: 600 12.5px 'Barlow', sans-serif;
                    text-align: left; }
        .ncb-haal:disabled { cursor: default; }
        .ncb-dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
        .ncb-matn { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .ncb-retry { color: #93c5fd; font-weight: 700; flex-shrink: 0; }
        .ncb-sw { flex-shrink: 0; display: flex; align-items: center; gap: 8px;
                  background: none; border: none; padding: 4px 0; cursor: pointer;
                  color: rgba(255,255,255,.9); font: 700 12.5px 'Barlow', sans-serif; }
        .ncb-sw small { display: block; font-size: 9.5px; font-weight: 600;
                        color: rgba(255,255,255,.38); letter-spacing: .02em; }
        .ncb-track { width: 38px; height: 22px; border-radius: 99px; position: relative;
                     background: rgba(255,255,255,.18); transition: background .15s; }
        .ncb-track.on { background: #2563eb; }
        .ncb-knob { position: absolute; top: 3px; left: 3px; width: 16px; height: 16px;
                    border-radius: 50%; background: #fff; transition: left .15s; }
        .ncb-track.on .ncb-knob { left: 19px; }
      `}</style>

      {/* Haal -- na mila ho to isi par dabakar dobara dhoondho (login page par
          Settings ka "Reconnect" hota hi nahi). */}
      <button type="button" className="ncb-haal" disabled={haal.chal || haal.mila}
              onClick={() => reprobeServer()}
              title={haal.mila ? "" : "Tap to search for the server again"}>
        <span className="ncb-dot" style={{ background: rang }} />
        <span className="ncb-matn">{matn}</span>
        {!haal.chal && !haal.mila && <span className="ncb-retry">↻ Retry</span>}
      </button>

      <button type="button" className="ncb-sw" role="switch" aria-checked={on}
              onClick={badlo} title={DOMAIN}>
        <span style={{ textAlign: "right", lineHeight: 1.15 }}>
          Internet {on ? "on" : "off"}
          <small>{DOMAIN}</small>
        </span>
        <span className={"ncb-track" + (on ? " on" : "")}><span className="ncb-knob" /></span>
      </button>
    </div>
  );
}
