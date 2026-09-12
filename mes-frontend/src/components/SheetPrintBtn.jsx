/* SheetPrintBtn.jsx — sheet ke kone me baithne wale "Print" aur "PDF" button.
 *
 * Chaar jagah lagta hai — Historical Data ka PM aur DMC, aur Document
 * Update ka wahi do format-view.  Ek hi component isliye ki chaaron jagah
 * ek jaisa dikhe aur kal ko badalna ho to ek hi jagah badle.
 *
 * Button chhapi hui sheet ke ANDAR hi rehte hain (sheet ke root div me),
 * par print/PDF me nahi aate — `sheetTools` ki print-CSS me
 * `.tb-print-btn { display:none }` likha hai.
 *
 * DO BUTTON KYUN, EK KYUN NAHI
 * ----------------------------
 * Dono alag cheez dete hain, aur dono ki apni jagah hai:
 *
 *   Print — printer ka parda kholta hai.  Wahan "Save as PDF" bhi hota
 *           hai, aur us raaste se banne wali PDF me text VECTOR rehta hai
 *           (copy/search ho jaata hai).  Ek tap zyada lagta hai.
 *   PDF   — ek tap me SEEDHA file deta hai (app me Downloads me girti hai,
 *           site par download ho jaati hai).  Us file me sheet tasveer ki
 *           tarah baithti hai — text copy nahi hoga.
 *
 * Sheet TV par bhi khulti hai aur wahan aksar koi printer nahi hota;
 * wahan PDF wala button hi kaam aata hai.
 *
 * Galti hone par khamoshi nahi — `ruk` me saaf sandesh dikhta hai.
 */
import { useState } from "react";
import { chhapoNode, pdfNikalo } from "../constants/sheetTools";

export default function SheetPrintBtn({ boxRef, naam = "Sheet", khada = false, css = "" }) {
  const [chal, setChal] = useState("");        // "" | "print" | "pdf"
  const [ruk, setRuk]   = useState("");
  const [thik, setThik] = useState("");

  const bolo = (set, msg, ms = 5000) => { set(msg); setTimeout(() => set(""), ms); };

  const chhapo = async () => {
    if (chal) return;                          // do baar dabane se do print job
    setChal("print"); setRuk(""); setThik("");
    try {
      await chhapoNode(boxRef?.current, { naam, khada, css });
    } catch (e) {
      bolo(setRuk, e?.message || "Could not print", 4000);
    } finally {
      setChal("");
    }
  };

  const pdf = async () => {
    if (chal) return;
    setChal("pdf"); setRuk(""); setThik("");
    try {
      const r = await pdfNikalo(boxRef?.current, { naam, khada, css });
      // `pdfNikalo` phekta nahi, jawab me batata hai ki kya hua — isliye
      // dono soorat yahin sambhalte hain.  "Ho gaya" tabhi likhna hai jab
      // sach me file bani ho.
      if (!r?.theek) { bolo(setRuk, r?.kyun || "Could not create the PDF"); return; }
      const panne = r.panne ? ` (${r.panne} page${r.panne > 1 ? "s" : ""})` : "";
      bolo(setThik, r.native ? `Saved to ${r.kahan}${panne}` : `Downloaded${panne}`);
    } catch (e) {
      bolo(setRuk, e?.message || "Could not create the PDF", 4000);
    } finally {
      setChal("");
    }
  };

  const btn = (bg, bd) => ({
    display: "inline-flex", alignItems: "center", gap: 6,
    padding: "6px 12px", fontSize: 12, fontWeight: 800,
    border: "1px solid " + bd, borderRadius: 6,
    background: bg, color: "#fff",
    cursor: chal ? "default" : "pointer",
    boxShadow: "0 1px 4px rgba(0,0,0,.2)",
    fontFamily: "inherit",
  });

  return (
    /* Saamaanya bahaav me, daayen kone par.  `absolute` JAAN-BOOJH KAR
       nahi rakha — sheet ke upar-daayen kone me pehle se revision-box
       (REV NO / REV DATE) baitha hai aur button uske upar chadh jaata. */
    <div className="tb-print-btn"
         style={{ display: "flex", justifyContent: "flex-end", alignItems: "center",
                  gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
      {thik && (
        <span style={{ fontSize: 11.5, fontWeight: 800, color: "#15803d" }}>
          &#10003; {thik}
        </span>
      )}
      <button type="button" onClick={chhapo} disabled={!!chal}
              title="Open the print dialog for this sheet"
              style={btn(chal === "print" ? "#fca5a5" : "#dc2626", "#b91c1c")}>
        <span aria-hidden="true">&#128424;</span> {chal === "print" ? "Printing…" : "Print"}
      </button>
      <button type="button" onClick={pdf} disabled={!!chal}
              title="Download this sheet as a PDF file"
              style={btn(chal === "pdf" ? "#93c5fd" : "#2563eb", "#1d4ed8")}>
        <span aria-hidden="true">&#10515;</span> {chal === "pdf" ? "Making…" : "PDF"}
      </button>
      {ruk && (
        <div style={{
          flex: "1 1 100%", marginTop: 4, padding: "4px 8px",
          fontSize: 11, fontWeight: 700,
          background: "#fef2f2", color: "#991b1b",
          border: "1px solid #fecaca", borderRadius: 5,
          maxWidth: 320, marginLeft: "auto",
        }}>{ruk}</div>
      )}
    </div>
  );
}
