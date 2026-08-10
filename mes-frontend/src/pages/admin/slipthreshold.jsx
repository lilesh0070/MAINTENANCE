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
  const [val, setVal]       = useState(2);
  const [orig, setOrig]     = useState(2);
  const [loading, setLoad]  = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoad(true);
    try {
      const r = await api.get("/api/andon/slip-config", token);
      const v = r?.slip_threshold_min ?? 2;
      setVal(v); setOrig(v);
    } catch { toast?.("Threshold load nahi hua", "err"); }
    finally { setLoad(false); }
  }, [token, toast]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    const v = Math.max(1, Math.min(60, parseInt(val, 10) || 1));
    setSaving(true);
    try {
      const r = await api.put("/api/andon/slip-config", { slip_threshold_min: v }, token);
      const nv = r?.slip_threshold_min ?? v;
      setVal(nv); setOrig(nv);
      toast?.(`Slip threshold ${nv} min set ho gaya ✓`);
    } catch (e) { toast?.(e.message || "Save fail", "err"); }
    finally { setSaving(false); }
  };

  const dirty = String(val) !== String(orig);

  return (
    <Card style={{ padding: 24, maxWidth: 560 }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: "#0f172a", marginBottom: 20 }}>
        AUTO Breakdown Slip — Threshold
      </div>

      {loading ? (
        <div style={{ color: "#94a3b8", fontSize: 13 }}>Loading…</div>
      ) : (
        <div style={{ display: "flex", alignItems: "flex-end", gap: 14 }}>
          <FF label="Threshold (minute)"
              hint="1 se 60 min. Default 2. Call itne min se zyada khuli rahe to slip banegi.">
            <Input type="number" min="1" max="60" value={val}
                   onChange={(e) => setVal(e.target.value)}
                   style={{ width: 130 }} />
          </FF>
          <Btn variant="primary" onClick={save} disabled={saving || !dirty}>
            {saving ? "Saving…" : "Save"}
          </Btn>
          {dirty && <span style={{ fontSize: 11.5, color: "#b45309", paddingBottom: 10 }}>
            unsaved — pehle {orig} min tha
          </span>}
        </div>
      )}
    </Card>
  );
}
