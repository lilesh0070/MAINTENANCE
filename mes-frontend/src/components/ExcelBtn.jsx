/* ExcelBtn.jsx — "Excel" ka button jo table ko .xlsx bana kar de deta hai.
 *
 * Chaar jagah lagta hai — History Card, Log Book, Daily Assign Work aur
 * Sunday Plan Work.  Ek hi component isliye ki chaaron jagah ek jaisa dikhe
 * aur galti ki soorat me ek jaisa hi bataye.
 *
 * `banao` ek function hai jo chalne par { headers, rows, naam, sheet }
 * lautata hai.  Function isliye (seedha data nahi) ki:
 *   • data tabhi bane jab button DABE — har render par nahi.  Kuch page par
 *     hazaron qatarein hoti hain; unhe har baar banate rehna page ko sust
 *     kar deta hai aur file to tab bhi nahi banti jab tak koi dabaye na.
 *   • naye filter lagne par button ko kuch batana nahi padta — dabate waqt
 *     wo khud tazaa qatarein utha leta hai.
 *
 * DHYAN: file khali bhi ho sakti hai (sab filter ke baad koi qatar na bache).
 * Aisi soorat me file banti hi nahi, seedha bata dete hain — warna user ko
 * khali Excel milti hai aur wo samajhta hai ki data gum ho gaya.
 */
import { useState } from "react";
import { excelNikalo } from "../constants/sheetTools";

export default function ExcelBtn({ banao, label = "Excel", title = "Download this table as Excel", style = {} }) {
  const [chal, setChal] = useState(false);
  const [kehna, setKehna] = useState("");     // { theek } ya galti ka sandesh

  const dabaya = async () => {
    if (chal) return;                         // do baar dabane se do file
    setChal(true); setKehna("");
    try {
      const d = (await banao()) || {};
      if (!d.rows || d.rows.length === 0) {
        setKehna("No rows to export — try changing the filters");
        setTimeout(() => setKehna(""), 4000);
        return;
      }
      const r = await excelNikalo(d);
      setKehna(r.theek ? (r.kahan ? "✓ Saved to " + r.kahan : "✓ Done") : r.kyun);
      setTimeout(() => setKehna(""), r.theek ? 3000 : 6000);
    } catch (e) {
      setKehna(e?.message || "Could not create the Excel file");
      setTimeout(() => setKehna(""), 6000);
    } finally {
      setChal(false);
    }
  };

  const theekHai = kehna.startsWith("✓");

  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 8 }}>
      <button
        type="button"
        onClick={dabaya}
        disabled={chal}
        title={title}
        className="tb-noprint"
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "7px 14px", fontSize: 12.5, fontWeight: 800,
          border: "1px solid #15803d", borderRadius: 7,
          background: chal ? "#86efac" : "#16a34a", color: "#fff",
          cursor: chal ? "default" : "pointer", whiteSpace: "nowrap",
          fontFamily: "inherit",
          ...style,
        }}
      >
        <span aria-hidden="true">⤓</span> {chal ? "Preparing…" : label}
      </button>
      {kehna && (
        <span style={{
          fontSize: 11.5, fontWeight: 700, whiteSpace: "nowrap",
          color: theekHai ? "#15803d" : "#b91c1c",
        }}>{kehna}</span>
      )}
    </span>
  );
}
