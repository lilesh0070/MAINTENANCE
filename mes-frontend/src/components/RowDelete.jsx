/* RowDelete.jsx — Historical Data ki har table me "🗑 Delete" ka button,
 * apni pushti (confirm) ke saath.
 *
 * KYUN EK SAJHA COMPONENT
 * -----------------------
 * Delete paanch jagah lag raha hai (Breakdown Slip · Auto Slip · PM sheet ·
 * DMC sheet · CAPA).  Har jagah alag likhne ka matlab hota paanch jagah wahi
 * galtiyan dohrana — aur delete wapas nahi aata, isliye yahan ek galti bhi
 * mehngi hai.
 *
 * `window.confirm` JAAN-BOOJH KAR NAHI
 * ------------------------------------
 * Do wajah:
 *   1. APK me `window.confirm` Android ka apna sada parda kholta hai jo app
 *      se alag dikhta hai, aur kai WebView me wo BLOCK ho jaata hai — yaani
 *      button dabta hai aur kuch nahi hota.  (Yahi jaal print/download me
 *      bhi mila tha.)
 *   2. Usme sirf ek line aati hai.  Yahan hume batana hota hai ki SAATH ME
 *      KYA-KYA jayega (spare, NG point, corrective action) — wo ek line me
 *      nahi samata, aur bina bataye mitana sabse bura hai.
 *
 * Backend jo 409 bhejta hai (jaise "is slip par CAPA judi hai") wo seedha
 * yahin dikhta hai — user ko wahi wajah milti hai jo asli hai.
 */
import { useState } from "react";

export default function RowDelete({
  onDelete,                 // async () => …  — asli delete
  kya,                      // "Breakdown Slip #12" — kis cheez ki baat hai
  saath = [],               // ["3 spare entries", "5 NG point"] — aur kya jayega
  onDone,                   // delete ke baad (list refresh)
  chhota = false,           // table ke andar chhota button
}) {
  const [poochh, setPoochh] = useState(false);
  const [chal, setChal]     = useState(false);
  const [ruk, setRuk]       = useState("");

  const karo = async () => {
    setChal(true); setRuk("");
    try {
      await onDelete();
      setPoochh(false);
      onDone?.();
    } catch (e) {
      // Backend ka sandesh hi dikhao — "Delete failed" se kuch pata nahi chalta.
      setRuk(e?.message || "Delete nahi ho paya");
    } finally {
      setChal(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="tb-noprint"
        title={"Mitao — " + kya}
        onClick={() => { setPoochh(true); setRuk(""); }}
        style={{
          padding: chhota ? "3px 9px" : "5px 12px",
          fontSize: chhota ? 11 : 12, fontWeight: 800,
          border: "1px solid #b91c1c", borderRadius: 6,
          background: "#fff", color: "#b91c1c", cursor: "pointer",
          whiteSpace: "nowrap", fontFamily: "inherit",
        }}
      >🗑 Delete</button>

      {poochh && (
        <div
          onClick={() => !chal && setPoochh(false)}
          style={{
            position: "fixed", inset: 0, zIndex: 4000,
            background: "rgba(15,23,42,.55)",
            display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff", borderRadius: 12, maxWidth: 460, width: "100%",
              boxShadow: "0 12px 40px rgba(0,0,0,.3)", overflow: "hidden",
              fontFamily: "'Barlow', sans-serif", color: "#0f172a",
            }}
          >
            <div style={{ background: "#b91c1c", color: "#fff", padding: "12px 18px",
                          fontWeight: 800, fontSize: 14, letterSpacing: ".04em" }}>
              PAKKA MITANA HAI?
            </div>
            <div style={{ padding: "16px 18px" }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{kya}</div>

              {saath.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "#b45309" }}>
                    Iske saath ye bhi hat jayega:
                  </div>
                  <ul style={{ margin: "6px 0 0", paddingLeft: 20, fontSize: 12.5, color: "#334155" }}>
                    {saath.map((s, i) => <li key={i} style={{ marginTop: 2 }}>{s}</li>)}
                  </ul>
                </div>
              )}

              <div style={{ marginTop: 12, fontSize: 12, color: "#64748b" }}>
                Mitaya hua wapas nahi aata. Record audit me likha jayega.
              </div>

              {ruk && (
                <div style={{
                  marginTop: 12, padding: "8px 10px", fontSize: 12.5, fontWeight: 700,
                  background: "#fef2f2", color: "#991b1b",
                  border: "1px solid #fecaca", borderRadius: 6,
                }}>{ruk}</div>
              )}
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end",
                          padding: "12px 18px", borderTop: "1px solid #e2e8f0", background: "#f8fafc" }}>
              <button type="button" disabled={chal} onClick={() => setPoochh(false)}
                      style={{ padding: "8px 18px", fontSize: 12.5, fontWeight: 800,
                               border: "1px solid #cbd5e1", borderRadius: 7,
                               background: "#fff", color: "#334155",
                               cursor: chal ? "default" : "pointer", fontFamily: "inherit" }}>
                Rehne do
              </button>
              <button type="button" disabled={chal} onClick={karo}
                      style={{ padding: "8px 18px", fontSize: 12.5, fontWeight: 800,
                               border: "none", borderRadius: 7,
                               background: chal ? "#fca5a5" : "#b91c1c", color: "#fff",
                               cursor: chal ? "default" : "pointer", fontFamily: "inherit" }}>
                {chal ? "Mit raha…" : "Haan, mitao"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
