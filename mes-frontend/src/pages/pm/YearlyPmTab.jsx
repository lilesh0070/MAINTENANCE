/* pm/YearlyPmTab.jsx — Yearly PM Schedule grid (P/A rows, 48-week marks,
 * FY selector). Extracted from PMPanel. Props: ypm data + FY selector state.
 * Sign-off (Prepared By / Approved By) supports a drawn signature per role,
 * stored PER FY via PUT /yearly-signoff.
 */
import { useState, useEffect, useRef } from "react";
import { SignPad } from "./SignPad";
import { chhapoNode, pdfNikalo } from "../../constants/sheetTools";

export default function YearlyPmTab({ ypm, ypmFy, setYpmFy, ypmYears, api }) {
        // Print / PDF ke liye sheet ke root ka pata.
        const boxRef = useRef(null);
        const [pdfBusy, setPdfBusy] = useState(false);
        const [pdfMsg,  setPdfMsg]  = useState("");
        /* Print ke waqt do cheezein badalni padti hain:
             • upar wali patti (FY chunna + ye khud button) kaagaz par nahi jaani
             • grid `maxHeight:70vh; overflow:auto` me baithi hai -- use kholna
               padta hai, warna print me sirf dikhta hua hissa aata hai aur
               baaki kat jaata hai (aur wo galti kaagaz nikalne par hi pata
               chalti hai). */
        const PRINT_CSS = `
          .ypm-tools { display:none !important; }
          .ypm-scroll { max-height:none !important; overflow:visible !important; }
        `;
        const naamDo = () => `Yearly-PM-Schedule_${(ypmFy || "").replace(/[^\w-]+/g, "-")}`;
        const chhapo = () => chhapoNode(boxRef.current, { naam: naamDo(), css: PRINT_CSS });
        const pdfDo = async () => {
          if (pdfBusy) return;
          setPdfBusy(true); setPdfMsg("");
          try {
            await pdfNikalo(boxRef.current, { naam: naamDo(), css: PRINT_CSS });
            // Dono jagah print ka parda khulta hai (app me Android ka, site par
            // browser ka) aur PDF wahin "Save as PDF" se banti hai.  "Ho gaya"
            // kehna jhooth hoga -- file abhi bani hi nahi.
            setPdfMsg("Print window me “Save as PDF” chunein");
            setTimeout(() => setPdfMsg(""), 6000);
          } catch (e) {
            setPdfMsg(e?.message || "PDF nahi ban payi");
            setTimeout(() => setPdfMsg(""), 6000);
          } finally { setPdfBusy(false); }
        };
        const [signImgs, setSignImgs] = useState([]);
        const [signPad, setSignPad] = useState(null);
        useEffect(() => { setSignImgs((ypm && ypm.signoff_imgs) || []); }, [ypm]);
        const SIGN_ROLES = ["Prepared By (Engineer - Maintenance)", "Approved By (In-Charge Maintenance)"];
        const saveSign = (imgs) => {
          setSignImgs(imgs);
          if (api) api(`/yearly-signoff`, { method:"PUT", body: JSON.stringify({ fy: ypmFy, sign_imgs: imgs }) }).catch(()=>{});
        };
        const onSign = (i, clear) => {
          if (clear) { const n=[...signImgs]; n[i]=null; saveSign(n); return; }
          setSignPad({ title: SIGN_ROLES[i], apply: (url) => { const n=[...signImgs]; n[i]=url; saveSign(n); } });
        };
        if (!ypm) return <div style={{ color:"#64748b", padding:20 }}>Loading yearly PM schedule…</div>;
        const sb = "1px solid #000";
        const sth = { border:sb, padding:"3px 4px", fontSize:9.5, fontWeight:800, background:"#f3f4f6", textAlign:"center", whiteSpace:"nowrap" };
        const td  = { border:sb, padding:"2px 5px", fontSize:10.5, verticalAlign:"middle" };
        const wk  = { border:sb, width:20, minWidth:20, height:18, padding:0 };
        const MARK_BG = { due:"#fef08a", done:"#86efac", slip:"#fca5a5" };
        const curFy = (() => { const d=new Date(); const s=d.getMonth()>=3?d.getFullYear():d.getFullYear()-1; return `${s}-${String(s+1).slice(-2)}`; })();
        return (
          <div ref={boxRef} style={{ background:"#fff", boxShadow:"0 4px 16px rgba(0,0,0,.12)", padding:10, color:"#111827" }}>
            {/* ── Financial Year selector + Print / PDF ── */}
            <div className="ypm-tools" style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10, flexWrap:"wrap" }}>
              <label style={{ fontSize:12.5, fontWeight:800, color:"#334155" }}>Financial Year:</label>
              <select value={ypmFy} onChange={(e) => setYpmFy(e.target.value)}
                      style={{ fontSize:13.5, fontWeight:700, padding:"7px 14px", border:"1.5px solid #cbd5e1",
                               borderRadius:8, background:"#fff", color:"#0f172a", cursor:"pointer" }}>
                {ypmYears.map((y) => <option key={y} value={y}>{y}{y===curFy ? "  (current)" : ""}</option>)}
              </select>
              {ypmFy && ypmFy !== curFy && (
                <span style={{ fontSize:11.5, fontWeight:700, color:"#b45309" }}>
                  ⓘ New FY — the plan is blank; fill it from Update Plan → Preventive Yearly.
                </span>
              )}
              <span style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:8 }}>
                <button type="button" onClick={chhapo} title="Poori schedule ka print"
                        style={{ padding:"7px 14px", fontSize:12.5, fontWeight:800, borderRadius:7,
                                 border:"1px solid #b91c1c", background:"#dc2626", color:"#fff",
                                 cursor:"pointer", fontFamily:"inherit", whiteSpace:"nowrap" }}>
                  🖨 Print
                </button>
                <button type="button" onClick={pdfDo} disabled={pdfBusy} title="PDF ke liye — print window me &quot;Save as PDF&quot; chunein"
                        style={{ padding:"7px 14px", fontSize:12.5, fontWeight:800, borderRadius:7,
                                 border:"1px solid #1d4ed8",
                                 background: pdfBusy ? "#93c5fd" : "#2563eb", color:"#fff",
                                 cursor: pdfBusy ? "default" : "pointer", fontFamily:"inherit",
                                 whiteSpace:"nowrap" }}>
                  {pdfBusy ? "Khul raha…" : "⤓ PDF"}
                </button>
                {pdfMsg && (
                  <span style={{ fontSize:11.5, fontWeight:700,
                                 color: pdfMsg.startsWith("✓") ? "#15803d" : "#b45309" }}>{pdfMsg}</span>
                )}
              </span>
            </div>
            {/* title band */}
            <table style={{ width:"100%", borderCollapse:"collapse", tableLayout:"fixed" }}><tbody><tr>
              <td style={{ border:sb, width:110, textAlign:"center" }}>
                <img src="/logo.jpg" alt="Toyota Boshoku" style={{ maxWidth:"100%", maxHeight:50, objectFit:"contain", display:"block", margin:"0 auto" }} />
              </td>
              <td style={{ border:sb, textAlign:"center", padding:"4px 8px" }}>
                <div style={{ fontSize:15, fontWeight:900 }}>{ypm.company}</div>
                <div style={{ fontSize:12.5, fontWeight:800, marginTop:2 }}>{ypm.title} — {ypm.year_label}</div>
              </td>
            </tr></tbody></table>

            {/* the schedule grid */}
            <div className="ypm-scroll" style={{ overflow:"auto", maxHeight:"70vh" }}>
              <table style={{ borderCollapse:"collapse", minWidth:1500 }}>
                <thead>
                  <tr>
                    <th style={{ ...sth, position:"sticky", top:0, zIndex:3 }} rowSpan={3}>S.NO.</th>
                    <th style={{ ...sth, position:"sticky", top:0, zIndex:3, minWidth:100 }} rowSpan={3}>ZONE</th>
                    <th style={{ ...sth, position:"sticky", top:0, zIndex:3, minWidth:100 }} rowSpan={3}>Line</th>
                    <th style={{ ...sth, position:"sticky", top:0, zIndex:3, minWidth:110 }} rowSpan={3}>M/C CODE NO.</th>
                    <th style={{ ...sth, position:"sticky", top:0, zIndex:3, minWidth:220 }} rowSpan={3}>MACHINE / EQUIPMENT NAME</th>
                    <th style={{ ...sth, position:"sticky", top:0, zIndex:3 }} rowSpan={3}>PM<br/>FREQUENCY</th>
                    <th style={{ ...sth, position:"sticky", top:0, zIndex:3 }} rowSpan={3}>PLAN /<br/>ACTUAL</th>
                    <th style={{ ...sth, position:"sticky", top:0, zIndex:3 }} colSpan={48}>SCHEDULE</th>
                  </tr>
                  <tr>
                    {ypm.months.map((mo) => (
                      <th key={mo} style={{ ...sth, position:"sticky", top:22, zIndex:2 }} colSpan={4}>{mo}</th>
                    ))}
                  </tr>
                  <tr>
                    {ypm.months.map((mo) => ypm.weeks.map((w) => (
                      <th key={mo+w} style={{ ...sth, position:"sticky", top:44, zIndex:2, fontSize:8.5, padding:"2px 1px" }}>{w}</th>
                    )))}
                  </tr>
                </thead>
                <tbody>
                  {ypm.rows.map((r) => (
                    ["P","A"].map((pa) => (
                      <tr key={`${r.id}-${pa}`}>
                        {pa === "P" && <>
                          <td style={{ ...td, textAlign:"center", fontWeight:700 }} rowSpan={2}>{r.s_no}</td>
                          <td style={td} rowSpan={2}>{r.zone_name}</td>
                          <td style={td} rowSpan={2}>{r.line}</td>
                          <td style={td} rowSpan={2}>{r.machine_code}</td>
                          <td style={{ ...td, maxWidth:260 }} rowSpan={2}>{r.machine_name}</td>
                          <td style={{ ...td, textAlign:"center", fontWeight:700 }} rowSpan={2}>{r.pm_frequency}</td>
                        </>}
                        <td style={{ ...td, textAlign:"center", fontWeight:800, background: pa==="P" ? "#eff6ff" : "#fefce8" }}>{pa}</td>
                        {Array.from({ length: 48 }, (_, wi) => {
                          const mk = (pa === "P" ? r.plan_weeks : r.actual_weeks)?.[String(wi)];
                          return <td key={wi} style={{ ...wk, background: MARK_BG[mk] || "#fff" }} title={mk || ""} />;
                        })}
                      </tr>
                    ))
                  ))}
                </tbody>
              </table>
            </div>

            {/* footer summary rows */}
            <table style={{ width:"100%", borderCollapse:"collapse", marginTop:6 }}><tbody>
              {ypm.footer_rows.map((fr) => (
                <tr key={fr}>
                  <td style={{ border:sb, padding:"4px 8px", fontSize:11, fontWeight:800, width:280 }}>{fr}</td>
                  <td style={{ border:sb }} />
                </tr>
              ))}
            </tbody></table>

            {/* legends */}
            <div style={{ display:"flex", gap:26, flexWrap:"wrap", alignItems:"center", padding:"10px 4px" }}>
              {ypm.freq_legend.map(([k, txt]) => (
                <span key={k} style={{ fontSize:11.5, fontWeight:700, color:"#334155" }}><b>{k}</b> — {txt}</span>
              ))}
              <span style={{ width:20 }} />
              {ypm.mark_legend.map(([k, txt]) => (
                <span key={k} style={{ display:"inline-flex", alignItems:"center", gap:6, fontSize:11.5, fontWeight:700, color:"#334155" }}>
                  <span style={{ width:16, height:16, border:sb, background:MARK_BG[k] }} /> {txt}
                </span>
              ))}
            </div>

            {/* sign-off — each role can put its own SIGNATURE (stored per FY) */}
            <table style={{ width:"100%", borderCollapse:"collapse" }}><tbody>
              <tr>{ypm.signoff.map((s, i) => (
                <td key={s.label} style={{ border:sb, padding:"4px 8px", fontSize:11.5, fontWeight:800, verticalAlign:"top" }}>
                  <div>{s.label}</div>
                  <div style={{ height:44, display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
                    {signImgs[i]
                      ? <img src={signImgs[i]} alt="signature" style={{ maxHeight:42, maxWidth:"88%", objectFit:"contain" }} />
                      : <span style={{ fontSize:9.5, color:"#cbd5e1", fontWeight:600 }} />}
                    <span style={{ display:"inline-flex", gap:4 }}>
                      <button type="button" onClick={() => onSign(i)}
                              style={{ padding:"3px 9px", borderRadius:6, border:"none", background:"#1d4ed8", color:"#fff", fontSize:10.5, fontWeight:800, cursor:"pointer", whiteSpace:"nowrap" }}>
                        ✍ {signImgs[i] ? "Re-sign" : "Sign"}</button>
                      {signImgs[i] && <button type="button" onClick={() => onSign(i, true)}
                              style={{ padding:"3px 7px", borderRadius:6, border:"1px solid #cbd5e1", background:"#fff", color:"#64748b", fontSize:10.5, fontWeight:800, cursor:"pointer" }}>✕</button>}
                    </span>
                  </div>
                </td>
              ))}</tr>
              <tr>{ypm.signoff.map((s) => (
                <td key={s.label} style={{ border:sb, padding:"2px 8px 6px", fontSize:10.5, textAlign:"center", color:"#334155" }}>{s.caption}</td>
              ))}</tr>
            </tbody></table>
            {/* document-control footer — format no / rev no / rev date (bottom) */}
            {ypm.doc_footer && ypm.doc_footer.format_no && (
              <div style={{ textAlign:"center", fontSize:11, fontWeight:700, color:"#111827", padding:"8px 6px 2px", letterSpacing:".02em" }}>
                FORMAT NO.:- {ypm.doc_footer.format_no}
                <span style={{ display:"inline-block", width:28 }} />REV. NO.:- {ypm.doc_footer.rev_no}
                <span style={{ display:"inline-block", width:20 }} />REV. DATE:- {ypm.doc_footer.rev_date}
              </div>
            )}
            {signPad && (
              <SignPad title={signPad.title}
                       onSave={(url) => { signPad.apply(url); setSignPad(null); }}
                       onClose={() => setSignPad(null)} />
            )}
          </div>
        );

}
