import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../api/client";
import { Card, Btn, FF, Input } from "./ui";


/* ── Slip Threshold ──────────────────────────────────────────────────
   AUTO breakdown slip tabhi banti hai jab maintenance ANDON call itne
   minute se ZYADA khuli rahe.  Chhoti breakdown (threshold se kam) ki
   koi slip nahi banti.  Time (response / down-time) hamesha asli rehta
   hai — button press hone se — threshold sirf "slip banani hai ya nahi"
   tay karta hai.  Backend: GET/PUT /api/andon/slip-config. */
export function SlipThresholdPage({ toast }) {
  const { token } = useAuth();
  const [val, setVal]             = useState(2);
  const [orig, setOrig]           = useState(2);
  const [tBd, setTBd]             = useState(10);   // Total Breakdowns target
  const [tBdOrig, setTBdOrig]     = useState(10);
  const [tPend, setTPend]         = useState(0);    // Pending Closures target
  const [tPendOrig, setTPendOrig] = useState(0);
  const [loading, setLoad]  = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoad(true);
    try {
      const r = await api.get("/api/andon/slip-config", token);
      const v = r?.slip_threshold_min ?? 2;
      const b = r?.target_breakdowns  ?? 10;
      const p = r?.target_pending     ?? 0;
      setVal(v); setOrig(v); setTBd(b); setTBdOrig(b); setTPend(p); setTPendOrig(p);
    } catch { toast?.("Config load nahi hua", "err"); }
    finally { setLoad(false); }
  }, [token, toast]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    const v = Math.max(1, Math.min(60, parseInt(val, 10) || 1));
    const b = Math.max(0, parseInt(tBd, 10) || 0);
    const p = Math.max(0, parseInt(tPend, 10) || 0);
    setSaving(true);
    try {
      const r = await api.put("/api/andon/slip-config",
        { slip_threshold_min: v, target_breakdowns: b, target_pending: p }, token);
      const nv = r?.slip_threshold_min ?? v;
      const nb = r?.target_breakdowns  ?? b;
      const np = r?.target_pending     ?? p;
      setVal(nv); setOrig(nv); setTBd(nb); setTBdOrig(nb); setTPend(np); setTPendOrig(np);
      toast?.(`Save ho gaya ✓  (threshold ${nv} min · target ${nb}/${np})`);
    } catch (e) { toast?.(e.message || "Save fail", "err"); }
    finally { setSaving(false); }
  };

  const dirty = String(val)   !== String(orig)
             || String(tBd)   !== String(tBdOrig)
             || String(tPend) !== String(tPendOrig);

  return (
    <Card style={{ padding: 24, maxWidth: 640 }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: "#0f172a", marginBottom: 20 }}>
        AUTO Breakdown Slip — Threshold &amp; Targets
      </div>

      {loading ? (
        <div style={{ color: "#94a3b8", fontSize: 13 }}>Loading…</div>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 14, flexWrap: "wrap" }}>
            <FF label="Threshold (minute)"
                hint="1 se 60 min. Default 2. Call itne min se zyada khuli rahe to slip banegi.">
              <Input type="number" min="1" max="60" value={val}
                     onChange={(e) => setVal(e.target.value)}
                     style={{ width: 130 }} />
            </FF>
          </div>

          <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a", margin: "24px 0 4px" }}>
            Pending Breakdown — Dashboard Target
          </div>
          <div style={{ fontSize: 11.5, color: "#94a3b8", marginBottom: 12 }}>
            "Pending Breakdown" panel ke ON/OFF TARGET is hisaab se dikhta hai (count iske ≤ ho to ON TARGET).
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 14, flexWrap: "wrap" }}>
            <FF label="Total Breakdowns target (≤)" hint="Iske andar ho to ON TARGET. Default 10.">
              <Input type="number" min="0" value={tBd}
                     onChange={(e) => setTBd(e.target.value)} style={{ width: 170 }} />
            </FF>
            <FF label="Pending Closures target (≤)" hint="Iske andar ho to ON TARGET. Default 0.">
              <Input type="number" min="0" value={tPend}
                     onChange={(e) => setTPend(e.target.value)} style={{ width: 170 }} />
            </FF>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 22 }}>
            <Btn variant="primary" onClick={save} disabled={saving || !dirty}>
              {saving ? "Saving…" : "Save"}
            </Btn>
            {dirty && <span style={{ fontSize: 11.5, color: "#b45309" }}>unsaved changes</span>}
          </div>
        </>
      )}
    </Card>
  );
}
