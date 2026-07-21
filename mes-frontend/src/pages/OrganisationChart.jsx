/* ───────────────────────────────────────────────────────────────────
 * OrganisationChart.jsx  —  Skill & Training → Organisation Chart
 * ───────────────────────────────────────────────────────────────────
 * Drag-and-drop organization chart with monthly version history.
 *
 *   • Two view modes (no manual zoom):
 *       Fit View        — the whole chart auto-fits the screen.
 *       Responsive View — natural size, smooth scroll up/down/left/right.
 *   • Clear circular employee photos (seeded from the Excel), name,
 *     designation, department.  Spacious, professional layout.
 *   • Edit mode — drag cards, edit fields + reporting manager, upload /
 *     replace / remove / preview photo, add/delete employees, editable
 *     connectors, Man-Power boxes and coloured Stars.
 *   • Month filter — each save is stored under the current month.
 *
 * Seed: src/data/orgChartSeed.js   Backend: /api/org-chart
 * Routing: /skill-training/org-chart
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { ORG_SEED, ORG_SEED_MONTH } from "../data/orgChartSeed";

const api = {
  async get(path, token) {
    const r = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
    return r.json();
  },
  async post(path, body, token) {
    const r = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
    return r.json();
  },
};

const NODE_W = 214, NODE_H = 96;
const SCROLL_ZOOM = 1;                 // natural size in Responsive view
const STAR_COLORS = ["#dc2626", "#f59e0b", "#16a34a", "#2563eb", "#7c3aed"];
const clone = (o) => JSON.parse(JSON.stringify(o));
const curMonth = () => new Date().toISOString().slice(0, 7);
const monthLabel = (m) => {
  const [y, mm] = (m || "").split("-");
  const N = ["", "January", "February", "March", "April", "May", "June", "July",
             "August", "September", "October", "November", "December"];
  return mm ? `${N[+mm]} ${y}` : m;
};
const initials = (n) => (n || "").replace(/^(Mr|Mrs|Ms)\.?\s*/i, "").trim()
  .split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";

function downscale(file, cb) {
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const max = 260;
      const s = Math.min(img.width, img.height);
      const cv = document.createElement("canvas");
      cv.width = max; cv.height = max;
      cv.getContext("2d").drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, max, max);
      cb(cv.toDataURL("image/jpeg", 0.85));
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

export default function OrganisationChart() {
  const { token, theme, user } = useAuth();
  const nav = useNavigate();
  const vpRef = useRef(null);      // scroll viewport / stage
  const worldRef = useRef(null);   // transformed world (for coord math)
  const idc = useRef(1);
  const genId = (p) => `${p}x${idc.current++}`;

  const [months, setMonths]   = useState([]);
  const [month, setMonth]     = useState(curMonth());
  const [data, setData]       = useState(null);
  const [edit, setEdit]       = useState(false);
  const [view, setView]       = useState("fit");    // fit | scroll
  const [zoom, setZoom]       = useState(0.7);
  const [sel, setSel]         = useState(null);
  const [dirty, setDirty]     = useState(false);
  const [toast, setToast]     = useState(null);
  const [linkPos, setLinkPos] = useState(null);
  const drag = useRef(null);
  const flash = (m) => { setToast(m); setTimeout(() => setToast(null), 2800); };

  // world footprint (for fit + scroll sizing)
  const world = useMemo(() => {
    let w = 800, h = 600;
    if (data) {
      data.nodes.forEach((n) => { w = Math.max(w, n.x + NODE_W); h = Math.max(h, n.y + NODE_H); });
      (data.manpower || []).forEach((b) => { w = Math.max(w, b.x + (b.w || 230)); h = Math.max(h, b.y + (b.h || 160)); });
      (data.stars || []).forEach((s) => { w = Math.max(w, s.x + 190); h = Math.max(h, s.y + 40); });
    }
    return { w: w + 60, h: h + 60 };
  }, [data]);

  // ── load ────────────────────────────────────────────────────────────
  const loadChart = useCallback(async (m, savedMonths) => {
    if (!token) return;
    try {
      const res = await api.get(`/api/org-chart/?month=${m}`, token);
      if (res.exists && res.data) setData(res.data);
      else {
        const newest = (savedMonths || months).find((x) => x.month !== m);
        if (newest) {
          const prev = await api.get(`/api/org-chart/?month=${newest.month}`, token);
          setData(prev.data ? clone(prev.data) : clone(ORG_SEED));
        } else setData(clone(ORG_SEED));
      }
    } catch { setData(clone(ORG_SEED)); }
    setSel(null); setDirty(false); setEdit(false);
  }, [token, months]);

  useEffect(() => {
    if (!token) return;
    api.get("/api/org-chart/months", token).then((ms) => {
      const list = Array.isArray(ms) ? ms : [];
      setMonths(list);
      const start = list.length ? list[0].month : curMonth();
      setMonth(start); loadChart(start, list);
    }).catch(() => setData(clone(ORG_SEED)));
  }, [token]);  // eslint-disable-line

  const monthOpts = useMemo(() => {
    const map = new Map();
    months.forEach((m) => map.set(m.month, m.label));
    [curMonth(), ORG_SEED_MONTH].forEach((m) => { if (!map.has(m)) map.set(m, monthLabel(m)); });
    return [...map.entries()].map(([m, l]) => ({ month: m, label: l })).sort((a, b) => b.month.localeCompare(a.month));
  }, [months]);

  // ── fit / view ───────────────────────────────────────────────────────
  const fit = useCallback(() => {
    const r = vpRef.current?.getBoundingClientRect();
    if (!r) return;
    const z = Math.min((r.width - 40) / world.w, (r.height - 40) / world.h, 1.35);
    setZoom(z > 0.1 ? z : 0.4);
  }, [world]);

  useEffect(() => {
    if (view === "fit") fit(); else setZoom(SCROLL_ZOOM);
  }, [view, world, fit]);
  useEffect(() => {
    const h = () => { if (view === "fit") fit(); };
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, [view, fit]);

  // ── geometry / mutations ──────────────────────────────────────────────
  const nodeById = (id) => data?.nodes.find((n) => n.id === id);
  const toWorld = (e) => {
    const r = worldRef.current.getBoundingClientRect();
    return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom };
  };
  const mut = (fn) => setData((d) => { const nd = clone(d); fn(nd); return nd; });
  const touch = () => setDirty(true);
  const updNode = (id, patch) => { touch(); mut((d) => { const n = d.nodes.find((x) => x.id === id); if (n) Object.assign(n, patch); }); };
  const delNode = (id) => { touch(); setSel(null); mut((d) => { d.nodes = d.nodes.filter((n) => n.id !== id); d.edges = d.edges.filter((e) => e.from !== id && e.to !== id); }); };
  const addNode = () => {
    const id = genId("n");
    touch(); mut((d) => d.nodes.push({ id, name: "New Employee", designation: "Designation", department: "", photo: "", x: 80, y: 80 }));
    setSel(id);
  };
  const managerOf = (id) => data?.edges.find((e) => e.to === id)?.from || "";
  const setManager = (id, mgr) => { touch(); mut((d) => { d.edges = d.edges.filter((e) => e.to !== id); if (mgr) d.edges.push({ id: genId("e"), from: mgr, to: id }); }); };
  const addEdge = (from, to) => { if (from === to) return; touch(); mut((d) => { if (!d.edges.some((e) => e.from === from && e.to === to)) d.edges.push({ id: genId("e"), from, to }); }); };
  const delEdge = (eid) => { touch(); mut((d) => { d.edges = d.edges.filter((e) => e.id !== eid); }); };
  const addManpower = () => { touch(); mut((d) => { d.manpower = d.manpower || []; d.manpower.push({ id: genId("mp"), title: "Man Power", x: 60, y: 60, w: 230, h: 160, rows: [{ label: "Dept", value: "0" }] }); }); };
  const updManpower = (id, patch) => { touch(); mut((d) => { const b = d.manpower.find((x) => x.id === id); if (b) Object.assign(b, patch); }); };
  const delManpower = (id) => { touch(); mut((d) => { d.manpower = d.manpower.filter((b) => b.id !== id); }); };
  const mpRow = (id, i, patch) => { touch(); mut((d) => { const b = d.manpower.find((x) => x.id === id); if (b) Object.assign(b.rows[i], patch); }); };
  const mpAddRow = (id) => { touch(); mut((d) => { const b = d.manpower.find((x) => x.id === id); if (b) b.rows.push({ label: "Dept", value: "0" }); }); };
  const mpDelRow = (id, i) => { touch(); mut((d) => { const b = d.manpower.find((x) => x.id === id); if (b) b.rows.splice(i, 1); }); };
  const addStar = () => { touch(); mut((d) => { d.stars = d.stars || []; d.stars.push({ id: genId("s"), color: STAR_COLORS[0], label: "Star", x: 70, y: 70 }); }); };
  const updStar = (id, patch) => { touch(); mut((d) => { const s = d.stars.find((x) => x.id === id); if (s) Object.assign(s, patch); }); };
  const delStar = (id) => { touch(); mut((d) => { d.stars = d.stars.filter((s) => s.id !== id); }); };

  // ── drag / link ───────────────────────────────────────────────────────
  const startDrag = (e, type, id) => {
    if (!edit) return;
    e.stopPropagation();
    const w = toWorld(e);
    if (type === "node") { const n = nodeById(id); drag.current = { type, id, ox: w.x - n.x, oy: w.y - n.y }; setSel(id); }
    else if (type === "manpower") { const b = data.manpower.find((x) => x.id === id); drag.current = { type, id, ox: w.x - b.x, oy: w.y - b.y }; }
    else if (type === "resize") { const b = data.manpower.find((x) => x.id === id); drag.current = { type, id, ow: b.w, oh: b.h, sx: w.x, sy: w.y }; }
    else if (type === "star") { const s = data.stars.find((x) => x.id === id); drag.current = { type, id, ox: w.x - s.x, oy: w.y - s.y }; }
    else if (type === "link") { drag.current = { type, id }; setLinkPos(w); }
  };
  const onMove = (e) => {
    const dg = drag.current; if (!dg) return;
    const w = toWorld(e);
    if (dg.type === "node") updNode(dg.id, { x: Math.round(w.x - dg.ox), y: Math.round(w.y - dg.oy) });
    else if (dg.type === "manpower") updManpower(dg.id, { x: Math.round(w.x - dg.ox), y: Math.round(w.y - dg.oy) });
    else if (dg.type === "resize") updManpower(dg.id, { w: Math.max(150, Math.round(dg.ow + (w.x - dg.sx))), h: Math.max(100, Math.round(dg.oh + (w.y - dg.sy))) });
    else if (dg.type === "star") updStar(dg.id, { x: Math.round(w.x - dg.ox), y: Math.round(w.y - dg.oy) });
    else if (dg.type === "link") setLinkPos(w);
  };
  const onUp = () => { if (drag.current?.type === "link") setLinkPos(null); drag.current = null; };
  const onNodeUp = (id) => { const dg = drag.current; if (dg?.type === "link" && dg.id !== id) addEdge(dg.id, id); };
  const onPhoto = (id, e) => { const f = e.target.files?.[0]; if (f) downscale(f, (url) => updNode(id, { photo: url })); };

  const save = async () => {
    try {
      const target = curMonth();
      await api.post("/api/org-chart/", { month: target, title: data.title, data }, token);
      const ms = await api.get("/api/org-chart/months", token);
      setMonths(Array.isArray(ms) ? ms : []);
      setMonth(target); setEdit(false); setDirty(false);
      flash(`Saved ✓ under ${monthLabel(target)}`);
    } catch (e) { flash("Save failed: " + (e.message || "error")); }
  };

  const selNode = sel ? nodeById(sel) : null;
  if (!data) return <div style={{ padding: 60, fontFamily: "Barlow, sans-serif", color: "#64748b" }}>Loading organization chart…</div>;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700;800&family=Barlow+Condensed:wght@700;800&display=swap');
        .oc-root { height:100vh; display:flex; flex-direction:column; background:#eef2f6; font-family:'Barlow',sans-serif; overflow:hidden; }
        .oc-bar { background:#fff; border-bottom:1px solid #e2e8f0; flex-shrink:0; padding:10px 20px 10px 96px;
                  display:flex; align-items:center; gap:12px; flex-wrap:wrap; position:relative; z-index:20; box-shadow:0 1px 3px rgba(0,0,0,.06); }
        .oc-bar::after { content:''; position:absolute; bottom:0; left:0; right:0; height:2px; background:${theme.gradient}; }
        .oc-back,.oc-btn { display:inline-flex; align-items:center; gap:6px; border:1.5px solid #e2e8f0; background:#f8fafc;
                   border-radius:9px; padding:8px 14px; cursor:pointer; font-size:13px; font-weight:700; color:#334155; font-family:'Barlow',sans-serif; }
        .oc-btn:hover { border-color:${theme.accent}; color:${theme.accent}; }
        .oc-btn.pri { background:${theme.accent}; color:#fff; border-color:${theme.accent}; }
        .oc-btn.pri:hover { filter:brightness(1.05); color:#fff; }
        .oc-btn.dng { border-color:#fecaca; color:#dc2626; background:#fff; }
        .oc-title { font-family:'Barlow Condensed',sans-serif; font-size:19px; font-weight:800; color:#0f172a; margin-right:auto; }
        .oc-title span { color:${theme.accent}; }
        .oc-sel { border:1.5px solid #cbd5e1; border-radius:9px; padding:8px 12px; font-size:13px; font-weight:700;
                  color:#0f172a; background:#fff; outline:none; font-family:'Barlow',sans-serif; }
        .oc-toggle { display:flex; border:1px solid #cbd5e1; border-radius:99px; overflow:hidden; }
        .oc-toggle button { border:none; background:#fff; color:#64748b; font-weight:700; font-size:12.5px; padding:8px 16px; cursor:pointer; }
        .oc-toggle button.on { background:${theme.accent}; color:#fff; }

        .oc-stage { flex:1; min-height:0; position:relative; scroll-behavior:smooth;
                    background:#eef2f6 radial-gradient(circle, #dbe3ec 1px, transparent 1px); background-size:26px 26px; }
        .oc-stage.fit { overflow:hidden; display:flex; align-items:center; justify-content:center; }
        .oc-stage.scroll { overflow:auto; }
        .oc-wrap { position:relative; }
        .oc-world { position:absolute; top:0; left:0; transform-origin:0 0; }

        .oc-node { position:absolute; width:${NODE_W}px; min-height:${NODE_H}px; box-sizing:border-box; background:#fff;
                   border:1px solid #dbe3ec; border-top:3px solid ${theme.accent}; border-radius:14px;
                   box-shadow:0 4px 14px rgba(15,23,42,.10); display:flex; align-items:center; gap:13px; padding:12px 15px; }
        .oc-node.edit { cursor:move; }
        .oc-node.sel { outline:2.5px solid ${theme.accent}; outline-offset:2px; }
        .oc-photo { width:62px; height:62px; border-radius:50%; object-fit:cover; flex-shrink:0;
                    border:2.5px solid ${theme.soft}; box-shadow:0 2px 6px rgba(15,23,42,.15); background:#f1f5f9; }
        .oc-ph-ph { display:flex; align-items:center; justify-content:center; font-size:19px; font-weight:800; color:#1e3a8a; background:#dbeafe; }
        .oc-nname { font-size:14.5px; font-weight:800; color:#0f172a; line-height:1.18; }
        .oc-ndesig { font-size:11px; color:#475569; margin-top:3px; line-height:1.25; }
        .oc-ndept { display:inline-block; font-size:9px; color:${theme.accentDark}; margin-top:5px; font-weight:800;
                    text-transform:uppercase; letter-spacing:.03em; background:${theme.soft}; padding:2px 7px; border-radius:99px; }
        .oc-handle { position:absolute; bottom:-9px; left:50%; transform:translateX(-50%); width:16px; height:16px; border-radius:50%;
                     background:${theme.accent}; border:2px solid #fff; cursor:crosshair; box-shadow:0 1px 4px rgba(0,0,0,.3); }
        .oc-star { position:absolute; display:flex; align-items:center; gap:6px; font-size:12.5px; font-weight:700; color:#334155; }
        .oc-star .sy { font-size:24px; line-height:1; text-shadow:0 1px 2px rgba(0,0,0,.15); }
        .oc-star.edit { cursor:move; }
        .oc-star-tools { display:flex; gap:3px; margin-left:4px; }
        .oc-star-tools button { border:none; background:#fff; border:1px solid #e2e8f0; border-radius:5px; cursor:pointer; font-size:10px; padding:2px 5px; }

        .oc-mp { position:absolute; background:#fff; border:2px solid ${theme.accent}; border-radius:12px; box-sizing:border-box;
                 box-shadow:0 4px 14px rgba(15,23,42,.12); overflow:hidden; display:flex; flex-direction:column; }
        .oc-mp.edit { cursor:move; }
        .oc-mp-h { background:${theme.soft}; color:${theme.accentDark}; font-weight:800; font-size:13.5px; padding:8px 12px; text-align:center; border-bottom:1px solid ${theme.accent}; }
        .oc-mp-h input { width:100%; border:none; background:transparent; text-align:center; font-weight:800; font-size:13.5px; color:${theme.accentDark}; outline:none; font-family:'Barlow',sans-serif; }
        .oc-mp-body { padding:8px 10px; flex:1; overflow:auto; }
        .oc-mp-row { display:flex; align-items:center; gap:6px; padding:4px 0; border-bottom:1px dotted #e2e8f0; font-size:12.5px; }
        .oc-mp-row .lbl { flex:1; color:#334155; font-weight:600; }
        .oc-mp-row .val { font-weight:800; color:#0f172a; }
        .oc-mp-row input { border:none; border-bottom:1px solid #e2e8f0; background:transparent; font-size:12.5px; font-family:'Barlow',sans-serif; outline:none; }
        .oc-mp-row input.lbl { width:auto; } .oc-mp-row input.val { width:46px; text-align:center; color:${theme.accentDark}; font-weight:800; }
        .oc-mp-resize { position:absolute; right:2px; bottom:2px; width:15px; height:15px; cursor:nwse-resize; color:${theme.accent}; }
        .oc-mp-x { position:absolute; right:5px; top:5px; border:none; background:transparent; cursor:pointer; color:#dc2626; font-size:12px; }

        .oc-editor { position:absolute; top:0; right:0; width:300px; height:100%; background:#fff; border-left:1px solid #e2e8f0;
                     box-shadow:-4px 0 18px rgba(15,23,42,.10); z-index:30; padding:18px; overflow-y:auto; }
        .oc-editor h4 { margin:0 0 12px; font-size:15px; font-weight:800; color:#0f172a; }
        .oc-fld { display:flex; flex-direction:column; gap:4px; margin-bottom:12px; }
        .oc-fld label { font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:.04em; color:#64748b; }
        .oc-fld input, .oc-fld select { border:1.5px solid #cbd5e1; border-radius:8px; padding:8px 10px; font-size:13px; font-family:'Barlow',sans-serif; outline:none; }
        .oc-fld input:focus, .oc-fld select:focus { border-color:${theme.accent}; }
        .oc-editor-photo { display:flex; align-items:center; gap:12px; margin-bottom:12px; }
        .oc-editor-photo img, .oc-editor-photo .pl { width:70px; height:70px; border-radius:50%; object-fit:cover; background:#dbeafe;
                     display:flex; align-items:center; justify-content:center; font-weight:800; color:#1e3a8a; border:2px solid ${theme.soft}; }
        .oc-help { font-size:11.5px; color:#94a3b8; background:#f8fafc; border:1px dashed #cbd5e1; border-radius:8px; padding:8px 10px; margin-bottom:10px; }
        .oc-toast { position:fixed; bottom:26px; left:50%; transform:translateX(-50%); background:#0f172a; color:#fff;
                    padding:12px 22px; border-radius:10px; font-size:13px; font-weight:600; z-index:1200; box-shadow:0 8px 24px rgba(0,0,0,.3); }
      `}</style>

      <div className="oc-root">
        <div className="oc-bar">
          <button className="oc-back" onClick={() => nav("/skill-training")}>← Back</button>
          <div className="oc-title">Organisation <span>Chart</span></div>

          <select className="oc-sel" value={month} onChange={(e) => { setMonth(e.target.value); loadChart(e.target.value); }}>
            {monthOpts.map((m) => <option key={m.month} value={m.month}>{m.label}</option>)}
          </select>

          <div className="oc-toggle">
            <button className={view === "fit" ? "on" : ""} onClick={() => setView("fit")}>⤢ Fit View</button>
            <button className={view === "scroll" ? "on" : ""} onClick={() => setView("scroll")}>↕ Responsive</button>
          </div>

          {!edit ? (
            <button className="oc-btn pri" onClick={() => setEdit(true)}>✎ Edit</button>
          ) : (
            <>
              <button className="oc-btn" onClick={addNode}>+ Employee</button>
              <button className="oc-btn" onClick={addManpower}>+ Man Power</button>
              <button className="oc-btn" onClick={addStar}>+ Star</button>
              <button className="oc-btn pri" onClick={save}>💾 Save</button>
              <button className="oc-btn dng" onClick={() => loadChart(month)}>Cancel</button>
            </>
          )}
        </div>

        <div ref={vpRef} className={`oc-stage ${view}`}
             onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}
             onMouseDown={() => { if (!drag.current) setSel(null); }}>
          <div className="oc-wrap" style={{ width: world.w * zoom, height: world.h * zoom, flex: "0 0 auto" }}>
            <div ref={worldRef} className="oc-world" style={{ width: world.w, height: world.h, transform: `scale(${zoom})` }}>
              {/* connectors */}
              <svg style={{ position: "absolute", top: 0, left: 0, width: world.w, height: world.h, overflow: "visible", pointerEvents: "none" }}>
                {data.edges.map((e) => {
                  const a = nodeById(e.from), b = nodeById(e.to);
                  if (!a || !b) return null;
                  const sx = a.x + NODE_W / 2, sy = a.y + NODE_H;
                  const ex = b.x + NODE_W / 2, ey = b.y;
                  const my = (sy + ey) / 2;
                  return (
                    <g key={e.id}>
                      <path d={`M ${sx} ${sy} V ${my} H ${ex} V ${ey}`} fill="none" stroke="#94a3b8" strokeWidth={1.8} markerEnd="url(#oc-arrow)" />
                      {edit && (
                        <g style={{ pointerEvents: "all", cursor: "pointer" }} onClick={() => delEdge(e.id)}>
                          <circle cx={ex} cy={my} r={9} fill="#fff" stroke="#dc2626" />
                          <text x={ex} y={my + 3.5} textAnchor="middle" fontSize={11} fill="#dc2626" fontWeight="800">×</text>
                        </g>
                      )}
                    </g>
                  );
                })}
                {linkPos && drag.current?.type === "link" && (() => {
                  const a = nodeById(drag.current.id); if (!a) return null;
                  return <line x1={a.x + NODE_W / 2} y1={a.y + NODE_H} x2={linkPos.x} y2={linkPos.y} stroke={theme.accent} strokeWidth={2.4} strokeDasharray="6 4" />;
                })()}
                <defs>
                  <marker id="oc-arrow" markerWidth="9" markerHeight="9" refX="6" refY="3" orient="auto" markerUnits="strokeWidth">
                    <path d="M0,0 L6,3 L0,6 Z" fill="#94a3b8" />
                  </marker>
                </defs>
              </svg>

              {/* manpower */}
              {(data.manpower || []).map((b) => (
                <div key={b.id} className={`oc-mp${edit ? " edit" : ""}`} style={{ left: b.x, top: b.y, width: b.w || 230, height: b.h || 160 }}
                     onMouseDown={(e) => startDrag(e, "manpower", b.id)}>
                  <div className="oc-mp-h">
                    {edit ? <input value={b.title} onMouseDown={(e) => e.stopPropagation()} onChange={(e) => updManpower(b.id, { title: e.target.value })} /> : b.title}
                  </div>
                  <div className="oc-mp-body" onMouseDown={(e) => edit && e.stopPropagation()}>
                    {(b.rows || []).map((rw, i) => (
                      <div className="oc-mp-row" key={i}>
                        {edit ? (
                          <>
                            <input className="lbl" value={rw.label} onChange={(e) => mpRow(b.id, i, { label: e.target.value })} />
                            <input className="val" value={rw.value} onChange={(e) => mpRow(b.id, i, { value: e.target.value })} />
                            <button style={{ border: "none", background: "transparent", cursor: "pointer", color: "#dc2626" }} onClick={() => mpDelRow(b.id, i)}>×</button>
                          </>
                        ) : (<><span className="lbl">{rw.label}</span><span className="val">{rw.value}</span></>)}
                      </div>
                    ))}
                    {edit && <button className="oc-btn" style={{ marginTop: 6, padding: "4px 10px", fontSize: 11 }} onClick={() => mpAddRow(b.id)}>+ Row</button>}
                  </div>
                  {edit && <button className="oc-mp-x" onMouseDown={(e) => e.stopPropagation()} onClick={() => delManpower(b.id)}>🗑</button>}
                  {edit && <svg className="oc-mp-resize" viewBox="0 0 14 14" onMouseDown={(e) => startDrag(e, "resize", b.id)}><path d="M14 0 L14 14 L0 14 Z" fill="currentColor" opacity=".55" /></svg>}
                </div>
              ))}

              {/* stars */}
              {(data.stars || []).map((s) => (
                <div key={s.id} className={`oc-star${edit ? " edit" : ""}`} style={{ left: s.x, top: s.y }} onMouseDown={(e) => startDrag(e, "star", s.id)}>
                  <span className="sy" style={{ color: s.color }}>★</span>
                  {edit ? <input value={s.label} onMouseDown={(e) => e.stopPropagation()} style={{ border: "none", borderBottom: "1px solid #e2e8f0", background: "transparent", fontSize: 12.5, width: 110, outline: "none" }} onChange={(e) => updStar(s.id, { label: e.target.value })} /> : <span>{s.label}</span>}
                  {edit && (
                    <span className="oc-star-tools" onMouseDown={(e) => e.stopPropagation()}>
                      <button title="Colour" onClick={() => updStar(s.id, { color: STAR_COLORS[(STAR_COLORS.indexOf(s.color) + 1) % STAR_COLORS.length] })} style={{ color: s.color }}>●</button>
                      <button title="Delete" onClick={() => delStar(s.id)}>🗑</button>
                    </span>
                  )}
                </div>
              ))}

              {/* nodes */}
              {data.nodes.map((n) => (
                <div key={n.id} className={`oc-node${edit ? " edit" : ""}${sel === n.id ? " sel" : ""}`} style={{ left: n.x, top: n.y }}
                     onMouseDown={(e) => startDrag(e, "node", n.id)} onMouseUp={() => onNodeUp(n.id)} onDoubleClick={() => edit && setSel(n.id)}>
                  {n.photo ? <img className="oc-photo" src={n.photo} alt="" /> : <div className="oc-photo oc-ph-ph">{initials(n.name)}</div>}
                  <div style={{ minWidth: 0 }}>
                    <div className="oc-nname">{n.name}</div>
                    <div className="oc-ndesig">{n.designation}</div>
                    {n.department && <div className="oc-ndept">{n.department}</div>}
                  </div>
                  {edit && <div className="oc-handle" title="Drag to another card to connect" onMouseDown={(e) => startDrag(e, "link", n.id)} />}
                </div>
              ))}
            </div>
          </div>

          {edit && selNode && (
            <div className="oc-editor" onMouseDown={(e) => e.stopPropagation()}>
              <h4>Edit Employee</h4>
              <div className="oc-editor-photo">
                {selNode.photo ? <img src={selNode.photo} alt="" /> : <div className="pl">{initials(selNode.name)}</div>}
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <label className="oc-btn" style={{ fontSize: 12 }}>
                    {selNode.photo ? "Replace" : "Upload"} Photo
                    <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => onPhoto(selNode.id, e)} />
                  </label>
                  {selNode.photo && <button className="oc-btn dng" style={{ fontSize: 12 }} onClick={() => updNode(selNode.id, { photo: "" })}>Remove Photo</button>}
                </div>
              </div>
              <div className="oc-fld"><label>Name</label><input value={selNode.name} onChange={(e) => updNode(selNode.id, { name: e.target.value })} /></div>
              <div className="oc-fld"><label>Designation</label><input value={selNode.designation} onChange={(e) => updNode(selNode.id, { designation: e.target.value })} /></div>
              <div className="oc-fld"><label>Department</label><input value={selNode.department || ""} onChange={(e) => updNode(selNode.id, { department: e.target.value })} /></div>
              <div className="oc-fld">
                <label>Reporting Manager</label>
                <select value={managerOf(selNode.id)} onChange={(e) => setManager(selNode.id, e.target.value)}>
                  <option value="">— None (top) —</option>
                  {data.nodes.filter((x) => x.id !== selNode.id).map((x) => <option key={x.id} value={x.id}>{x.name} — {x.designation}</option>)}
                </select>
              </div>
              <div className="oc-help">Tip: drag the blue dot under a card onto another card to add a reporting line. Click the red × on a line to delete it.</div>
              <button className="oc-btn dng" style={{ width: "100%" }} onClick={() => delNode(selNode.id)}>🗑 Delete Employee</button>
              <button className="oc-btn" style={{ width: "100%", marginTop: 8 }} onClick={() => setSel(null)}>Close</button>
            </div>
          )}
        </div>

        {edit && <div style={{ position: "absolute", bottom: 10, left: "50%", transform: "translateX(-50%)", fontSize: 12, color: "#64748b", background: "#fff", padding: "5px 14px", borderRadius: 99, border: "1px solid #e2e8f0", zIndex: 25 }}>
          Editing · saves under <b>{monthLabel(curMonth())}</b> · double-click a card to edit
        </div>}
      </div>

      {toast && <div className="oc-toast">{toast}</div>}
    </>
  );
}
