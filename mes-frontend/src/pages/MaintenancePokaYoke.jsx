/* ───────────────────────────────────────────────────────────────────
 * MaintenancePokaYoke.jsx
 * ───────────────────────────────────────────────────────────────────
 * Maintenance team's deep PY view — full technical detail at every
 * level.  Quality only sees counts + bypass log; Maintenance owns
 * the actual fix so they get bit numbers, machine names, expected
 * vs. actual values, model assignments, etc.
 *
 *   Level 1  ZONES        ← grid of zone tiles with PY counters
 *     │  click a zone tile
 *     ▼
 *   Level 2  LINES        ← all lines in the chosen zone
 *     │  click a line tile
 *     ▼
 *   Level 3  MODELS       ← all models configured on the chosen line
 *                           (each model expands to show its PY table
 *                            with PY no / name / side / machine /
 *                            bit / expected value / live OK-vs-BYPASS)
 *
 * Data sources:
 *   GET /api/zones/                              zone list
 *   GET /api/zones/{zone_id}/lines               lines per zone
 *   GET /api/lines/{line_id}/realtime            running model + status
 *   GET /api/config/py-models/{line_id}          all models on line
 *   GET /api/poka-yoke/live/{line_id}            current model PY+bypass
 *   GET /api/poka-yoke/live/{line_id}?model_bit=N PY for any model
 *
 * Polling: 10 s (only the live PY + realtime; structural data
 * fetched once on level entry).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { api } from "./pokayoke/shared";
import { ZonesView, LinesView, ModelsView } from "./pokayoke/views";

export default function MaintenancePokaYoke() {
  const { token, theme, isAdmin, user } = useAuth();

  // Navigation state
  const [level, setLevel]               = useState("zones");
  const [pickedZone, setPickedZone]     = useState(null);
  const [pickedLine, setPickedLine]     = useState(null);

  // Cache
  const [zones, setZones]               = useState([]);
  const [linesByZone, setLinesByZone]   = useState({});
  const [livePYByLine, setLivePYByLine] = useState({});
  const [realtimeByLine, setRealtimeByLine] = useState({});
  const [modelsByLine, setModelsByLine] = useState({});

  // Level 3 lazy caches
  const [modelPYs, setModelPYs]         = useState({});
  const [loadingModelIds, setLoadingModelIds] = useState(new Set());
  const [errorModelIds, setErrorModelIds]   = useState({});
  const [expandedModelId, setExpandedModelId] = useState(null);

  useEffect(() => {
    document.title = isAdmin ? "Maintenance · Poka Yoke" : "Poka Yoke";
  }, [isAdmin]);

  // Initial load — zones + lines per zone
  useEffect(() => {
    if (!token) return;
    let alive = true;
    (async () => {
      try {
        const zs = await api.get("/api/zones/", token);
        if (!alive) return;
        const list = Array.isArray(zs) ? zs : [];
        setZones(list);
        const linesEntries = await Promise.all(list.map(async (z) => {
          try {
            const ls = await api.get(`/api/zones/${z.id}/lines`, token);
            return [z.id, Array.isArray(ls) ? ls : []];
          } catch { return [z.id, []]; }
        }));
        if (!alive) return;
        const map = {};
        for (const [zid, ls] of linesEntries) map[zid] = ls;
        setLinesByZone(map);
      } catch (e) {
        console.warn("[MaintenancePokaYoke] zones load failed:", e);
      }
    })();
    return () => { alive = false; };
  }, [token]);

  // Live PY + realtime poll (10s)
  // Realtime fetched first to get current model_bit / model_name —
  // those are then passed explicitly to /api/poka-yoke/live so we
  // bypass the backend's flaky auto-detect (matches Fullscreen).
  const refreshLive = useCallback(async () => {
    if (!token) return;
    const allLines = Object.values(linesByZone).flat();
    if (!allLines.length) return;

    // Step 1: realtime (model bit + name)
    const rtResults = await Promise.all(allLines.map(async (l) => {
      try {
        const data = await api.get(`/api/lines/${l.id}/realtime`, token);
        return [l.id, data || {}];
      } catch { return [l.id, {}]; }
    }));
    const rtMap = Object.fromEntries(rtResults);
    setRealtimeByLine(rtMap);

    // Step 2: live PY with model context
    const pyResults = await Promise.all(allLines.map(async (l) => {
      try {
        const rt        = rtMap[l.id] || {};
        const modelBit  = rt.current_model_number;
        const modelName = rt.current_model_name || "";
        const params    = new URLSearchParams();
        if (modelBit != null && modelBit !== 0) params.append("model_bit",  String(modelBit));
        if (modelName)                          params.append("model_name", modelName);
        const qs   = params.toString();
        const url  = `/api/poka-yoke/live/${l.id}${qs ? `?${qs}` : ""}`;
        const data = await api.get(url, token);
        return [l.id, Array.isArray(data) ? data : []];
      } catch { return [l.id, []]; }
    }));
    setLivePYByLine(Object.fromEntries(pyResults));
  }, [token, linesByZone]);

  useEffect(() => {
    refreshLive();
    const t = setInterval(refreshLive, 10000);
    return () => clearInterval(t);
  }, [refreshLive]);

  // Lazy: fetch models for a line on Level 3 entry
  useEffect(() => {
    if (level !== "models" || !pickedLine) return;
    if (modelsByLine[pickedLine.id]) return;
    let alive = true;
    (async () => {
      try {
        const ms = await api.get(`/api/config/py-models/${pickedLine.id}`, token);
        if (!alive) return;
        setModelsByLine(prev => ({ ...prev, [pickedLine.id]: Array.isArray(ms) ? ms : [] }));
      } catch (e) {
        if (!alive) return;
        setModelsByLine(prev => ({ ...prev, [pickedLine.id]: [] }));
      }
    })();
    return () => { alive = false; };
  }, [level, pickedLine, modelsByLine, token]);

  // Lazy: fetch model-specific PYs on expand
  const handleToggleModel = (model) => {
    if (expandedModelId === model.id) { setExpandedModelId(null); return; }
    setExpandedModelId(model.id);
    if (modelPYs[model.id]) return;

    setLoadingModelIds(prev => new Set([...prev, model.id]));
    setErrorModelIds(prev => { const n = { ...prev }; delete n[model.id]; return n; });
    api.get(`/api/poka-yoke/live/${pickedLine.id}?model_bit=${model.bitNumber}`, token)
      .then(data => {
        setModelPYs(prev => ({ ...prev, [model.id]: Array.isArray(data) ? data : [] }));
      })
      .catch(e => {
        setErrorModelIds(prev => ({ ...prev, [model.id]: e.message || String(e) }));
      })
      .finally(() => {
        setLoadingModelIds(prev => { const n = new Set(prev); n.delete(model.id); return n; });
      });
  };

  // Stats roll-up
  const statsByLine = useMemo(() => {
    const out = {};
    for (const ls of Object.values(linesByZone)) {
      for (const l of ls) {
        const pys = livePYByLine[l.id] || [];
        const rt  = realtimeByLine[l.id] || {};
        const total  = pys.length;
        const bypass = pys.filter(p => p.is_bypassed).length;
        out[l.id] = {
          total, active: total - bypass, inactive: 0, bypass,
          currentModelBit: rt.current_model_number ?? null,
          currentModelName: rt.current_model_name || "—",
          modelCount: (modelsByLine[l.id] || []).length || 0,
        };
      }
    }
    return out;
  }, [linesByZone, livePYByLine, realtimeByLine, modelsByLine]);

  const statsByZone = useMemo(() => {
    const out = {};
    for (const z of zones) {
      const ls = linesByZone[z.id] || [];
      let total=0, active=0, inactive=0, bypass=0;
      for (const l of ls) {
        const s = statsByLine[l.id] || {};
        total    += s.total    || 0;
        active   += s.active   || 0;
        inactive += s.inactive || 0;
        bypass   += s.bypass   || 0;
      }
      out[z.id] = { total, active, inactive, bypass, lineCount: ls.length };
    }
    return out;
  }, [zones, linesByZone, statsByLine]);

  // Drill-down handlers
  const goZones = () => { setLevel("zones");  setPickedZone(null); setPickedLine(null); setExpandedModelId(null); };
  const goLines = (z) => { setLevel("lines");  setPickedZone(z);   setPickedLine(null); setExpandedModelId(null); };
  const goModels= (l) => { setLevel("models"); setPickedLine(l);   setExpandedModelId(null); };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700;800&family=Barlow+Condensed:wght@600;700;800&display=swap');
        .mp-root { min-height:100vh; background:#f8fafc; font-family:'Barlow',sans-serif; padding-bottom:48px; }
        .mp-topbar {
          background:#fff; border-bottom:1px solid #e2e8f0;
          padding:0 40px 0 88px; height:60px;
          display:flex; align-items:center; justify-content:space-between;
          position:sticky; top:0; z-index:50; box-shadow:0 1px 3px rgba(0,0,0,.06);
        }
        .mp-topbar::after { content:''; position:absolute; bottom:0; left:0; right:0;
                            height:2px; background:${theme.gradient}; }
        .mp-title { position:absolute; left:50%; transform:translateX(-50%);
                    font-family:'Barlow Condensed',sans-serif; font-size:34px;
                    font-weight:800; color:#0f172a; letter-spacing:-.01em;
                    pointer-events:none; white-space:nowrap; }
        .mp-title span { color:${theme.accent}; }
        .mp-pill { display:flex; align-items:center; gap:10px;
                    padding:6px 14px; border-radius:99px;
                    border:1.5px solid #e2e8f0; background:#f8fafc;
                    font-size:12px; font-weight:600; color:#334155; white-space:nowrap; }
        .mp-pill b { color:#0f172a; font-weight:800; }
        .mp-body { padding:20px 32px 0; max-width:1500px; margin:0 auto; }
        .mp-zone-grid { display:grid;
                         grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
                         gap:16px; align-items:start; }
        .mp-card-btn {
          width:100%; text-align:left; cursor:pointer;
          border:2px solid #e2e8f0; border-radius:14px;
          padding:18px 20px; font-family:'Barlow',sans-serif;
          background:#fff; box-shadow:0 1px 3px rgba(0,0,0,.04);
          transition:all .15s ease;
        }
        .mp-card-btn:hover { transform: translateY(-2px);
                              box-shadow: 0 8px 22px rgba(0,0,0,.10); }
      `}</style>

      <div className="mp-root">
        <div className="mp-topbar">
          <div />
          <div className="mp-title">
            {isAdmin ? "Maintenance " : ""}<span>Poka Yoke</span>
          </div>
          {user?.username && (
            <div className="mp-pill">Signed in as <b>{user.username}</b></div>
          )}
        </div>

        <div className="mp-body">
          {level === "zones" && (
            <ZonesView zones={zones} statsByZone={statsByZone}
                       onPick={goLines} theme={theme}/>
          )}
          {level === "lines" && pickedZone && (
            <LinesView zone={pickedZone}
                       lines={linesByZone[pickedZone.id] || []}
                       statsByLine={statsByLine}
                       onPick={goModels}
                       onBack={goZones}
                       theme={theme}/>
          )}
          {level === "models" && pickedZone && pickedLine && (
            <ModelsView zone={pickedZone}
                        line={pickedLine}
                        lineId={pickedLine.id}
                        models={modelsByLine[pickedLine.id] || []}
                        currentModelBit={
                          (realtimeByLine[pickedLine.id] || {}).current_model_number
                        }
                        modelPYs={modelPYs}
                        loadingModelIds={loadingModelIds}
                        errorModelIds={errorModelIds}
                        expandedModelId={expandedModelId}
                        onToggleModel={handleToggleModel}
                        onBack={() => goLines(pickedZone)}
                        onBackToZones={goZones}
                        theme={theme}/>
          )}
        </div>
      </div>
    </>
  );
}
