/* pm/FormatSheet.jsx — TBDI Preventive-Maintenance check-sheet FORMAT renderer.
 * Extracted from PMPanel so the Schedule/Check-Sheet tabs and the Historical
 * Data page can share one implementation. Pure presentational (no state/api).
 */
// Renders the TBDI PM check-sheet FORMAT (from maintenance_pm_check_sheet_format).
// `hdr` pre-fills the header fields; `points` (maintenance_pm_check_point rows)
// fills the check-point grid; `rev` fills the revision box.
// Fill support: each point may carry observation / action_taken / spares_used /
// status / sign — displayed in the 5 result columns.  With `editable` those
// cells become inputs and onEdit(i, key, value) reports changes.  `signVals`
// = [prepared_by, checked_by, approved_by] shown in the sign-off band.
// `signable` = which sign-off cells may be signed RIGHT NOW (indices into the
// signoff band, e.g. [1] on the Engineer Verify tab).  Omit it and the sign
// buttons follow `editable`, i.e. the fill form's old behaviour.
// A signable cell shows its own CODE box right next to the role label, so the
// signer types their code and signs in the same place (onSignVal reports it).
// (Exported — the Historical Data page reuses it to show saved sheets.)
// Spreadsheet-style cell selection over the five FILL columns (Observation /
// Action Taken / Spares Used / Status / Sign): drag or shift-click to mark a
// rectangle, which the caller can then copy / paste / fill-down.  `cellSel` is
// {r1,r2,c1,c2} over point index and FILL column index.  The S.No column is
// untouched — it stays a plain serial number.
export function FormatSheet({ f, hdr = {}, points = [], rev = {}, editable = false, onEdit = null, signVals = [], signImgs = [], onSign = null, onSignVal = null, signable = null,
                              cellSel = null, onCellDown = null, onCellEnter = null }) {
  const canSign = (i) => (signable ? signable.includes(i) : editable);
  const inSel = (r, c) => !!cellSel && r >= cellSel.r1 && r <= cellSel.r2 && c >= cellSel.c1 && c <= cellSel.c2;
  if (!f) return <div style={{ color:"#64748b", padding:20 }}>Loading format…</div>;
  const sb = "1px solid #000";
  const lbl = { border:sb, padding:"4px 8px", fontSize:11.5, fontWeight:800, background:"#f3f4f6", whiteSpace:"nowrap", width:"16%" };
  const val = { border:sb, padding:"4px 8px", fontSize:12, background:"#fff", width:"34%" };
  const sth = { border:sb, padding:"5px 6px", fontSize:10.5, fontWeight:800, background:"#f3f4f6", textAlign:"center" };
  const pairs = [];
  const hf = f.header_fields || [];
  for (let i = 0; i < hf.length; i += 2) pairs.push([hf[i], hf[i + 1]]);
  return (
    <div style={{ background:"#fff", boxShadow:"0 4px 16px rgba(0,0,0,.12)", padding:10, color:"#111827" }}>
      {/* title band */}
      <table style={{ width:"100%", borderCollapse:"collapse", tableLayout:"fixed" }}><tbody><tr>
        <td style={{ border:sb, width:110, textAlign:"center" }}>
          <img src="/logo.jpg" alt="Toyota Boshoku" style={{ maxWidth:"100%", maxHeight:54, objectFit:"contain", display:"block", margin:"0 auto" }} />
        </td>
        <td style={{ border:sb, textAlign:"center", padding:"4px 8px" }}>
          <div style={{ fontSize:16, fontWeight:900 }}>{f.company}</div>
          <div style={{ fontSize:13, fontWeight:800, marginTop:2 }}>{f.title}</div>
        </td>
        <td style={{ border:sb, width:200, padding:0, verticalAlign:"top", fontSize:10.5 }}>
          <div style={{ borderBottom:sb, padding:"2px 5px", fontWeight:700, textAlign:"center" }}>{f.rev_box?.title}</div>
          {(f.rev_box?.fields || []).map((x, i) => (
            <div key={x} style={{ borderBottom: i < (f.rev_box.fields.length - 1) ? sb : "none", padding:"3px 5px" }}>
              <b>{x}</b> {i === 0 ? (rev.rev_no || "") : (rev.rev_date || "")}
            </div>
          ))}
        </td>
      </tr></tbody></table>
      {/* header fields */}
      <table style={{ width:"100%", borderCollapse:"collapse", tableLayout:"fixed", borderTop:"none" }}><tbody>
        {pairs.map(([a, b], i) => (
          <tr key={i}>
            <td style={lbl}>{a?.label}</td><td style={val}>{hdr[a?.key] ?? a?.default ?? ""}</td>
            <td style={lbl}>{b?.label}</td><td style={val}>{hdr[b?.key] ?? b?.default ?? ""}</td>
          </tr>
        ))}
      </tbody></table>
      {/* check-points grid (blank — the points module comes later) */}
      <div style={{ overflowX:"auto" }}>
        <table style={{ width:"100%", minWidth:1000, borderCollapse:"collapse", tableLayout:"fixed", borderTop:"none" }}>
          <colgroup>
            <col style={{ width:"4%" }} /><col style={{ width:"20%" }} /><col style={{ width:"14%" }} /><col style={{ width:"10%" }} />
            <col style={{ width:"16%" }} /><col style={{ width:"13%" }} /><col style={{ width:"9%" }} /><col style={{ width:"6%" }} /><col style={{ width:"8%" }} />
          </colgroup>
          <thead><tr>{(f.columns || []).map((c) => <th key={c} style={sth}>{c}</th>)}</tr></thead>
          <tbody>
            {points.length > 0 ? points.map((p, i) => {
              const inp = { width:"100%", border:"none", outline:"none", fontSize:11,
                            fontFamily:"inherit", background:"#fefce8", padding:"3px 4px", boxSizing:"border-box" };
              const FILL = ["observation", "action_taken", "spares_used", "status", "sign"];
              return (
                <tr key={i}>
                  <td style={{ border:sb, fontSize:11, textAlign:"center", padding:"3px 5px", verticalAlign:"top" }}>{p.s_no || i + 1}</td>
                  <td style={{ border:sb, fontSize:11, padding:"3px 6px", verticalAlign:"top" }}>{p.check_point || ""}</td>
                  <td style={{ border:sb, fontSize:11, padding:"3px 6px", verticalAlign:"top" }}>{p.judgement_standard || ""}</td>
                  <td style={{ border:sb, fontSize:11, padding:"3px 6px", verticalAlign:"top" }}>{p.method || ""}</td>
                  {FILL.map((k, ci) => {
                    const sel = editable && inSel(i, ci);
                    const cellInp = sel ? { ...inp, background:"#dbeafe" } : inp;
                    return (
                    <td key={k}
                        onMouseDown={editable ? (e) => onCellDown && onCellDown(i, ci, e.shiftKey) : undefined}
                        onMouseOver={editable ? () => onCellEnter && onCellEnter(i, ci) : undefined}
                        style={{ border: sel ? "1px solid #2563eb" : sb, fontSize:11,
                                 padding: editable ? 0 : "3px 6px", verticalAlign:"top",
                                 background: sel ? "#dbeafe" : undefined,
                                 textAlign: k === "status" ? "center" : "left",
                                 fontWeight: k === "status" ? 800 : 400,
                                 color: k === "status" ? (p[k] === "NG" ? "#dc2626" : "#15803d") : "#111827" }}>
                      {editable ? (
                        k === "status" ? (
                          <select style={{ ...cellInp, textAlign:"center" }} value={p[k] || ""}
                                  onChange={(e) => onEdit && onEdit(i, k, e.target.value)}>
                            <option value=""></option><option value="OK">OK</option><option value="NG">NG</option>
                          </select>
                        ) : (
                          <input style={cellInp} value={p[k] || ""}
                                 onChange={(e) => onEdit && onEdit(i, k, e.target.value)} />
                        )
                      ) : (p[k] || "")}
                    </td>
                    );
                  })}
                </tr>
              );
            }) : Array.from({ length: f.blank_rows || 15 }, (_, i) => (
              <tr key={i}>{(f.columns || []).map((c, j) => (
                <td key={j} style={{ border:sb, height:24, fontSize:11, textAlign:j === 0 ? "center" : "left", padding:"2px 6px" }}>{j === 0 ? i + 1 : ""}</td>
              ))}</tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* sign-off — each role can put its own SIGNATURE in the sign space */}
      <table style={{ width:"100%", borderCollapse:"collapse", borderTop:"none" }}><tbody>
        <tr>{(f.signoff || []).map((s, i) => (
          <td key={s.label} style={{ border:sb, padding:"4px 8px", fontSize:11.5, fontWeight:800, verticalAlign:"top" }}>
            <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
              <span>{s.label}</span>
              {canSign(i)
                ? <input value={signVals[i] || ""} placeholder="Code"
                         onChange={(e) => onSignVal && onSignVal(i, e.target.value)}
                         style={{ width:90, padding:"2px 6px", borderRadius:5, border:"1px solid #1d4ed8",
                                  background:"#eff6ff", fontSize:11.5, fontWeight:800, fontFamily:"inherit",
                                  color:"#1d4ed8", outline:"none", boxSizing:"border-box" }} />
                : <span style={{ fontWeight:700, color:"#1d4ed8" }}>{signVals[i] || ""}</span>}
            </div>
            <div style={{ height:44, display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
              {signImgs[i]
                ? <img src={signImgs[i]} alt="signature" style={{ maxHeight:42, maxWidth:"88%", objectFit:"contain" }} />
                : <span style={{ fontSize:9.5, color:"#cbd5e1", fontWeight:600 }}>{canSign(i) ? "" : "— not signed —"}</span>}
              {canSign(i) && (
                <span style={{ display:"inline-flex", gap:4 }}>
                  <button type="button" onClick={() => onSign && onSign(i)}
                          style={{ padding:"3px 9px", borderRadius:6, border:"none", background:"#1d4ed8", color:"#fff", fontSize:10.5, fontWeight:800, cursor:"pointer", whiteSpace:"nowrap" }}>
                    ✍ {signImgs[i] ? "Re-sign" : "Sign"}</button>
                  {signImgs[i] && <button type="button" onClick={() => onSign && onSign(i, true)}
                          style={{ padding:"3px 7px", borderRadius:6, border:"1px solid #cbd5e1", background:"#fff", color:"#64748b", fontSize:10.5, fontWeight:800, cursor:"pointer" }}>✕</button>}
                </span>
              )}
            </div>
          </td>
        ))}</tr>
        <tr>{(f.signoff || []).map((s) => <td key={s.label} style={{ border:sb, padding:"2px 8px 6px", fontSize:10.5, textAlign:"center", color:"#334155" }}>{s.caption}</td>)}</tr>
      </tbody></table>
      {/* document-control footer — format no / rev no / rev date (bottom of sheet) */}
      {(() => {
        const df = f.doc_footer || { format_no: "TBDI / MAINT. / F / 011", rev_no: "00", rev_date: "20/3/2024" };
        return (
          <div style={{ textAlign:"center", fontSize:11, fontWeight:700, color:"#111827", padding:"8px 6px 2px", letterSpacing:".02em" }}>
            FORMAT NO.:- {df.format_no}
            <span style={{ display:"inline-block", width:28 }} />REV. NO.:- {df.rev_no}
            <span style={{ display:"inline-block", width:20 }} />REV. DATE:- {df.rev_date}
          </div>
        );
      })()}
    </div>
  );
}
