import { useState, useEffect, useCallback, useMemo } from "react";
import { useAuth } from "../../context/AuthContext";
import { fmtAgo, PYCounters, Breadcrumb, computePYStats } from "./shared";
import { RemarksCell, ImageCell } from "./cells";

function ZonesView({ zones, statsByZone, onPick, theme }) {
  if (zones.length === 0) {
    return (
      <div style={{
        background:"#fff", border:"1px solid #e2e8f0", borderRadius:12,
        padding:"48px 20px", textAlign:"center",
        color:"#94a3b8", fontStyle:"italic", fontSize:13,
      }}>
        No zones configured.
      </div>
    );
  }
  return (
    <div className="mp-zone-grid">
      {zones.map(z => {
        const s = statsByZone[z.id] || { total:0, active:0, inactive:0, bypass:0, lineCount:0 };
        const tileColor = s.bypass > 0 ? "#dc2626"
                        : s.active > 0 ? "#16a34a"
                        :                "#94a3b8";
        const tileBg    = s.bypass > 0 ? "rgba(220,38,38,.06)"
                        : s.active > 0 ? "rgba(22,163,74,.06)"
                        :                "#f8fafc";
        return (
          <button key={z.id} onClick={() => onPick(z)}
                  className="mp-card-btn"
                  style={{ borderColor: tileColor, background: tileBg }}>
            <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:14 }}>
              <span style={{
                width:14, height:14, borderRadius:"50%", background: tileColor,
                boxShadow: s.bypass > 0 ? "0 0 0 4px rgba(220,38,38,.18)" : "none",
                flexShrink:0,
              }}/>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{
                  fontSize:18, fontWeight:800, color:"#0f172a",
                  fontFamily:"'Barlow Condensed',sans-serif", letterSpacing:".01em",
                  lineHeight:1.1,
                }}>
                  {z.zone_name}
                </div>
                <div style={{ fontSize:11, color:"#64748b", marginTop:3 }}>
                  {z.zone_code}{z.plant_name ? ` · ${z.plant_name}` : ""}
                </div>
              </div>
              <div style={{
                fontSize:11, fontWeight:700, color:"#64748b",
                background:"#fff", border:"1px solid #e2e8f0",
                borderRadius:99, padding:"3px 10px", whiteSpace:"nowrap",
              }}>
                {s.lineCount} {s.lineCount === 1 ? "line" : "lines"}
              </div>
            </div>
            <PYCounters total={s.total} active={s.active}
                         inactive={s.inactive} bypass={s.bypass}/>
            <div style={{
              fontSize:11, fontWeight:700, color:theme.accent, marginTop:14,
              textAlign:"right",
            }}>
              Click to see lines →
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// LEVEL 2 — Lines in selected zone
// ════════════════════════════════════════════════════════════════════
function LinesView({ zone, lines, statsByLine, onPick, onBack, theme }) {
  return (
    <>
      <Breadcrumb crumbs={[
        { label: "Zones", onClick: onBack },
        { label: zone.zone_name },
      ]}/>
      {lines.length === 0 ? (
        <div style={{
          background:"#fff", border:"1px solid #e2e8f0", borderRadius:12,
          padding:"48px 20px", textAlign:"center",
          color:"#94a3b8", fontStyle:"italic", fontSize:13,
        }}>
          No lines assigned to this zone.
        </div>
      ) : (
        <div className="mp-zone-grid">
          {lines.map(l => {
            const s = statsByLine[l.id] || { total:0, active:0, inactive:0, bypass:0,
                                              currentModelName:"—", modelCount:0 };
            const tileColor = s.bypass > 0 ? "#dc2626"
                            : s.active > 0 ? "#16a34a"
                            :                "#94a3b8";
            const tileBg    = s.bypass > 0 ? "rgba(220,38,38,.06)"
                            : s.active > 0 ? "rgba(22,163,74,.06)"
                            :                "#f8fafc";
            return (
              <button key={l.id} onClick={() => onPick(l)}
                      className="mp-card-btn"
                      style={{ borderColor: tileColor, background: tileBg }}>
                <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:10 }}>
                  <span style={{
                    width:14, height:14, borderRadius:"50%", background: tileColor,
                    boxShadow: s.bypass > 0 ? "0 0 0 4px rgba(220,38,38,.18)" : "none",
                    flexShrink:0,
                  }}/>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{
                      fontSize:16, fontWeight:800, color:"#0f172a",
                      fontFamily:"'Barlow Condensed',sans-serif", lineHeight:1.1,
                    }}>
                      {l.line_name || `Line ${l.id}`}
                    </div>
                    <div style={{ fontSize:11, color:"#64748b", marginTop:3 }}>
                      {l.line_code || "—"}{l.plant_name ? ` · ${l.plant_name}` : ""}
                    </div>
                  </div>
                </div>
                <div style={{
                  background:"#fff", border:"1px solid #e2e8f0", borderRadius:8,
                  padding:"8px 10px", marginBottom:10,
                }}>
                  <div style={{ fontSize:9, fontWeight:700, letterSpacing:".08em",
                                 color:"#64748b" }}>
                    NOW RUNNING
                  </div>
                  <div style={{ fontSize:13, fontWeight:700, color:"#0f172a",
                                 marginTop:2, whiteSpace:"nowrap", overflow:"hidden",
                                 textOverflow:"ellipsis" }}>
                    {s.currentModelName || "— no model —"}
                  </div>
                </div>
                <PYCounters total={s.total} active={s.active}
                             inactive={s.inactive} bypass={s.bypass}/>
                <div style={{
                  fontSize:11, fontWeight:700, color:theme.accent, marginTop:14,
                  display:"flex", justifyContent:"space-between", alignItems:"center",
                }}>
                  <span style={{ color:"#64748b" }}>{s.modelCount} models configured</span>
                  <span>Click for models →</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

// ════════════════════════════════════════════════════════════════════
// LEVEL 3 — Models with full PY tables
// ════════════════════════════════════════════════════════════════════
function ModelCard({ model, isRunning, isExpanded, onToggle, pys, loading, error, theme, lineId }) {
  const modelBit = model?.bitNumber;
  const stats     = computePYStats(pys || []);
  const tileColor = !isRunning ? "#94a3b8"
                  : stats.bypass > 0 ? "#dc2626"
                  : stats.total  > 0 ? "#16a34a"
                  :                    "#94a3b8";
  return (
    <div style={{
      background:"#fff",
      border: `2px solid ${isExpanded ? tileColor : "#e2e8f0"}`,
      borderRadius:14, overflow:"hidden",
      boxShadow: isExpanded ? "0 6px 20px rgba(0,0,0,.10)" : "0 1px 3px rgba(0,0,0,.04)",
      transition:"all .18s ease",
    }}>
      <button onClick={onToggle}
              style={{
                width:"100%", border:"none",
                background: isRunning ? "rgba(22,163,74,.04)" : "#fff",
                padding:"14px 18px", cursor:"pointer", textAlign:"left",
              }}>
        <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:10 }}>
          <span style={{
            width:12, height:12, borderRadius:"50%", background:tileColor,
            boxShadow: stats.bypass > 0 ? "0 0 0 3px rgba(220,38,38,.18)" : "none",
            flexShrink:0,
          }}/>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{
              fontSize:14, fontWeight:800, color:"#0f172a",
              fontFamily:"'Barlow Condensed',sans-serif", lineHeight:1.15,
            }}>
              {model.modelName || `Model #${model.bitNumber}`}
            </div>
            <div style={{ fontSize:10, color:"#64748b", marginTop:2 }}>
              bit {model.bitNumber ?? "—"}
              {model.type   ? ` · ${model.type}`   : ""}
              {model.model  ? ` · ${model.model}`  : ""}
            </div>
          </div>
          {isRunning && (
            <span style={{
              fontSize:10, fontWeight:800, padding:"3px 9px", borderRadius:99,
              background:"rgba(22,163,74,.14)", color:"#15803d",
              whiteSpace:"nowrap", letterSpacing:".05em",
            }}>
              RUNNING
            </span>
          )}
        </div>
        <PYCounters total={stats.total} active={stats.active}
                     inactive={0} bypass={stats.bypass} compact/>
        <div style={{
          fontSize:11, fontWeight:700, color: theme.accent,
          marginTop:10, textAlign:"right",
        }}>
          {isExpanded ? "click to collapse ▲" : "click to see PY list ▼"}
        </div>
      </button>

      {isExpanded && (
        <div style={{ borderTop:`1px solid ${tileColor}22`, padding:"10px 0" }}>
          {loading ? (
            <div style={{ padding:"20px", textAlign:"center",
                           color:"#94a3b8", fontStyle:"italic", fontSize:12 }}>
              Loading PY list…
            </div>
          ) : error ? (
            <div style={{ padding:"20px", textAlign:"center",
                           color:"#dc2626", fontSize:12 }}>
              Failed: {String(error).slice(0, 80)}
            </div>
          ) : !pys?.length ? (
            <div style={{ padding:"20px", textAlign:"center",
                           color:"#94a3b8", fontStyle:"italic", fontSize:12 }}>
              No PY assignments for this model.
            </div>
          ) : (
            <div style={{ overflowX:"auto" }}>
              <table style={{ width:"100%", borderCollapse:"collapse" }}>
                <thead>
                  <tr style={{ borderBottom:"2px solid #e2e8f0", background:"#f8fafc" }}>
                    {["", "PY No.", "Name", "Side", "Sensor (X-bit) / Fixture",
                       "Bit", "Expected", "Live", "Image", "Remarks"].map((h,i) =>
                      <th key={i} style={{
                        padding:"8px 12px", fontSize:9, fontWeight:700,
                        letterSpacing:".08em", color:"#64748b",
                        textAlign: i >= 5 && i !== 9 ? "center" : "left", whiteSpace:"nowrap",
                      }}>{h}</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {pys.map((p, i) => {
                    const isBy = !!p.is_bypassed;
                    return (
                      <tr key={i} style={{ borderBottom:"1px solid #f1f5f9" }}>
                        <td style={{ padding:"8px 12px", width:14 }}>
                          <span style={{
                            display:"inline-block", width:10, height:10, borderRadius:"50%",
                            background: isBy ? "#dc2626" : "#16a34a",
                          }}/>
                        </td>
                        <td style={{ padding:"8px 12px", fontFamily:"monospace",
                                       fontSize:11, fontWeight:700 }}>
                          {p.poka_yoke_no}
                        </td>
                        <td style={{ padding:"8px 12px", fontSize:12 }}>
                          {p.poka_yoke_name || "—"}
                        </td>
                        <td style={{ padding:"8px 12px", fontSize:11, color:"#64748b" }}>
                          {p.side || "ALL"}
                        </td>
                        <td style={{ padding:"8px 12px", fontSize:11, color:"#475569",
                                       fontFamily:"monospace", fontWeight:600 }}>
                          {/* 2026-05-21 — Show sensor X-bit primarily, with
                              machine_name as secondary line.  Operator's
                              spec: "iska sensor name add kr ok x15 etc". */}
                          {p.sensing_bits
                            ? <span style={{ color:"#0369a1" }}>{p.sensing_bits}</span>
                            : <span>{p.machine_name || "—"}</span>}
                          {p.sensing_bits && p.machine_name && (
                            <div style={{ fontSize:9, color:"#94a3b8",
                                           fontWeight:400, marginTop:1 }}>
                              {p.machine_name}
                            </div>
                          )}
                        </td>
                        <td style={{ padding:"8px 12px", textAlign:"center",
                                       fontSize:11, fontFamily:"monospace" }}>
                          {p.bit ?? "—"}
                        </td>
                        <td style={{ padding:"8px 12px", textAlign:"center",
                                       fontSize:11, fontFamily:"monospace" }}>
                          {String(p.value ?? "—")}
                        </td>
                        <td style={{ padding:"8px 12px", textAlign:"center" }}>
                          {isBy ? (
                            <div>
                              <span style={{
                                fontSize:10, fontWeight:800, padding:"3px 9px",
                                borderRadius:99, background:"rgba(220,38,38,.12)",
                                color:"#b91c1c", whiteSpace:"nowrap",
                              }}>
                                BYPASS
                              </span>
                              {p.last_bypass_at && (
                                <div style={{ fontSize:9, color:"#94a3b8", marginTop:2 }}>
                                  {fmtAgo(p.last_bypass_at)}
                                </div>
                              )}
                              {p.last_plc_value !== null && p.last_plc_value !== undefined && (
                                <div style={{ fontSize:9, color:"#94a3b8" }}>
                                  read: {String(p.last_plc_value)}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span style={{
                              fontSize:10, fontWeight:800, padding:"3px 9px",
                              borderRadius:99, background:"rgba(22,163,74,.12)",
                              color:"#15803d", whiteSpace:"nowrap",
                            }}>
                              OK
                            </span>
                          )}
                        </td>
                        {/* 2026-05-21 — Image button column.  Click -> modal
                            shows uploaded reference images for this PY.
                            Admins also see upload UI inside the modal. */}
                        <td style={{ padding:"6px 8px", textAlign:"center" }}>
                          <ImageCell
                            py={p}
                            lineId={lineId}
                          />
                        </td>
                        {/* 2026-05-21 — Remarks input column.  Operator can
                            type any maintenance note / change request for
                            this PY and submit -> lands in mes_py_requests
                            audit table.  Admin sees them on "New Requests"
                            panel. */}
                        <td style={{ padding:"6px 8px" }}>
                          <RemarksCell
                            py={p}
                            lineId={lineId}
                            modelBit={modelBit}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ModelsView({ zone, line, models, currentModelBit, modelPYs,
                      loadingModelIds, errorModelIds,
                      expandedModelId, onToggleModel, onBack, onBackToZones, theme, lineId }) {
  return (
    <>
      <Breadcrumb crumbs={[
        { label: "Zones",        onClick: onBackToZones },
        { label: zone.zone_name, onClick: onBack },
        { label: line.line_name || `Line ${line.id}` },
      ]}/>
      {models.length === 0 ? (
        <div style={{
          background:"#fff", border:"1px solid #e2e8f0", borderRadius:12,
          padding:"48px 20px", textAlign:"center",
          color:"#94a3b8", fontStyle:"italic", fontSize:13,
        }}>
          No PY models configured for this line.
        </div>
      ) : (
        <div className="mp-zone-grid" style={{ gridTemplateColumns:"1fr" }}>
          {models.map(m => (
            <ModelCard key={m.id}
                       model={m}
                       isRunning={Number(m.bitNumber) === Number(currentModelBit)}
                       isExpanded={expandedModelId === m.id}
                       onToggle={() => onToggleModel(m)}
                       pys={modelPYs[m.id]}
                       loading={loadingModelIds.has(m.id)}
                       error={errorModelIds[m.id]}
                       theme={theme}
                       lineId={lineId}/>
          ))}
        </div>
      )}
    </>
  );
}

// ════════════════════════════════════════════════════════════════════
// Main component

export { ZonesView, LinesView, ModelCard, ModelsView };
