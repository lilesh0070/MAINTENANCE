import { useRef } from "react";

// Signature pad — draw with mouse/touch, returns a PNG dataURL.
// ── Signature pad — draw a signature with mouse/touch, returns a PNG dataURL.
//    Used in the check-sheet sign-off (PREPARED / CHECKED / APPROVED BY).
export function SignPad({ title, onSave, onClose }) {
  const ref = useRef(null);
  const drawing = useRef(false);
  const dirty = useRef(false);
  const pos = (e) => { const c = ref.current; const r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) }; };
  const down = (e) => { e.preventDefault(); drawing.current = true; const ctx = ref.current.getContext("2d");
    const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); };
  const move = (e) => { if (!drawing.current) return; const ctx = ref.current.getContext("2d");
    const p = pos(e); ctx.lineTo(p.x, p.y); ctx.strokeStyle = "#1d4ed8"; ctx.lineWidth = 2.2; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.stroke(); dirty.current = true; };
  const up = () => { drawing.current = false; };
  const clear = () => { const c = ref.current; c.getContext("2d").clearRect(0, 0, c.width, c.height); dirty.current = false; };
  const save = () => { if (!dirty.current) { onClose(); return; } onSave(ref.current.toDataURL("image/png")); };
  const bd = "1px solid #cbd5e1";
  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(15,23,42,.55)", zIndex:800,
        display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background:"#fff", borderRadius:12, padding:16, width:440, maxWidth:"100%" }}>
        <div style={{ fontWeight:800, fontSize:14, color:"#0f172a", marginBottom:8 }}>✍ {title}</div>
        <canvas ref={ref} width={408} height={150}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}
          style={{ width:"100%", height:150, border:"1px dashed #94a3b8", borderRadius:8, background:"#fff", touchAction:"none", cursor:"crosshair", display:"block" }} />
        <div style={{ fontSize:11, color:"#94a3b8", marginTop:6 }}>Mouse/finger se yahan sign karo.</div>
        <div style={{ display:"flex", gap:8, marginTop:10, justifyContent:"flex-end" }}>
          <button onClick={clear} style={{ padding:"7px 14px", borderRadius:8, border:bd, background:"#fff", fontWeight:700, fontSize:12, cursor:"pointer", color:"#64748b" }}>Clear</button>
          <button onClick={onClose} style={{ padding:"7px 14px", borderRadius:8, border:bd, background:"#fff", fontWeight:700, fontSize:12, cursor:"pointer", color:"#64748b" }}>Cancel</button>
          <button onClick={save} style={{ padding:"7px 16px", borderRadius:8, border:"none", background:"#1d4ed8", color:"#fff", fontWeight:800, fontSize:12, cursor:"pointer" }}>Save Signature</button>
        </div>
      </div>
    </div>
  );
}
