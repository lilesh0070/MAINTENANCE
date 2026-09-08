/* SheetPrintBtn.jsx — sheet ke kone me baithne wala "Print" ka button.
 *
 * Chaar jagah lagta hai — Historical Data ka PM aur DMC, aur Document
 * Update ka wahi do format-view.  Ek hi component isliye ki chaaron jagah
 * ek jaisa dikhe aur kal ko badalna ho to ek hi jagah badle.
 *
 * Button chhapi hui sheet ke ANDAR hi rehta hai (sheet ke root div me
 * absolute), par print me nahi aata — `sheetTools` ki print-CSS me
 * `.tb-print-btn { display:none }` likha hai.
 *
 * Sheet TV par bhi khulti hai aur wahan aksar koi printer nahi hota.
 * Android ka print parda phir bhi "PDF me save karein" deta hai, isliye
 * button chhupaya nahi hai — par galti ki soorat me user ko khamoshi ke
 * bajaye saaf sandesh milta hai (`ruk` state).
 */
import { useState } from "react";
import { chhapoNode } from "../constants/sheetTools";

export default function SheetPrintBtn({ boxRef, naam = "Sheet", khada = false, css = "" }) {
  const [chal, setChal] = useState(false);
  const [ruk, setRuk] = useState("");

  const dabaya = async () => {
    if (chal) return;                       // do baar dabane se do print job
    setChal(true); setRuk("");
    try {
      await chhapoNode(boxRef?.current, { naam, khada, css });
    } catch (e) {
      setRuk(e?.message || "Could not print");
      setTimeout(() => setRuk(""), 4000);
    } finally {
      setChal(false);
    }
  };

  return (
    /* Saamaanya bahaav me, daayen kone par.  `absolute` JAAN-BOOJH KAR
       nahi rakha — sheet ke upar-daayen kone me pehle se revision-box
       (REV NO / REV DATE) baitha hai aur button uske upar chadh jaata. */
    <div className="tb-print-btn" style={{ textAlign: "right", marginBottom: 6 }}>
      <button
        type="button"
        onClick={dabaya}
        disabled={chal}
        title="Print this sheet"
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "6px 12px", fontSize: 12, fontWeight: 800,
          border: "1px solid #b91c1c", borderRadius: 6,
          background: chal ? "#fca5a5" : "#dc2626", color: "#fff",
          cursor: chal ? "default" : "pointer",
          boxShadow: "0 1px 4px rgba(0,0,0,.2)",
        }}
      >
        <span aria-hidden="true">🖨</span> {chal ? "Printing…" : "Print"}
      </button>
      {ruk && (
        <div style={{
          marginTop: 4, padding: "4px 8px", fontSize: 11, fontWeight: 700,
          background: "#fef2f2", color: "#991b1b",
          border: "1px solid #fecaca", borderRadius: 5,
          maxWidth: 260, marginLeft: "auto",   // block hai — warna baayen chala jata
        }}>{ruk}</div>
      )}
    </div>
  );
}
