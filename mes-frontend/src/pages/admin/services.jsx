/* admin/services.jsx — "Services" tab (Maintenance Panel, sirf admin).
 *
 * Kaunsi service WEBSITE par aur kaunsi APP (phone / tablet / TV) par chale —
 * dono ke ALAG switch.  User 2026-09-19: "admin panel me naya tab, har service
 * ka option website aur app ke liye alag; abhi website ke liye sab band,
 * zaroorat hogi tab chalu kar lenge."
 *
 * Backend: GET / PUT /api/client-services (routers/client_services.py).
 * Save ke baad ISI device par turant lag jaata hai (`setServices`); baaki
 * devices par jab app / tab dobara saamne aaye ya page khule.
 */
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../api/client";
import { Card, Btn } from "./ui";
import { SERVICE_DEFAULTS, setServices } from "../../constants/clientServices";

const ROWS = [
  { key: "andon_alert", label: "ANDON alert",
    desc: "Popup and beep on every page when a new maintenance ANDON call comes (the app also vibrates). Checks for new calls every 2.5 seconds." },
  { key: "walkie", label: "Walkie-Talkie",
    desc: "Walkie-Talkie connection: shows the user online, the buzz call screen, chat messages and live voice. Off = no connection at all." },
  { key: "walkie_background", label: "Background listening", appOnly: true, needs: "walkie",
    desc: "The app keeps listening for buzz, chat and voice even when it is closed (Android background service with a \"Listening\" notification). Uses more battery." },
];

const fmtDT = (s) => {
  if (!s) return "";
  const d = new Date(s);
  return isNaN(d.getTime()) ? String(s)
    : d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true });
};

function Switch({ on, disabled, onChange, title }) {
  return (
    <button type="button" role="switch" aria-checked={on} disabled={disabled} title={title}
            onClick={() => !disabled && onChange(!on)}
            style={{ display: "inline-flex", alignItems: "center", gap: 8, border: "none", background: "transparent",
                     cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.45 : 1, padding: 4,
                     fontFamily: "inherit" }}>
      <span style={{ width: 40, height: 22, borderRadius: 99, position: "relative", transition: "background .15s",
                     background: on ? "#16a34a" : "#cbd5e1", flex: "none" }}>
        <span style={{ position: "absolute", top: 3, left: on ? 21 : 3, width: 16, height: 16, borderRadius: "50%",
                       background: "#fff", boxShadow: "0 1px 2px rgba(0,0,0,.25)", transition: "left .15s" }} />
      </span>
      <span style={{ fontSize: 12, fontWeight: 800, color: on ? "#15803d" : "#64748b", minWidth: 26, textAlign: "left" }}>
        {on ? "ON" : "OFF"}
      </span>
    </button>
  );
}

export function ServicesPage({ toast }) {
  const { token } = useAuth();
  const [svc, setSvc]       = useState(SERVICE_DEFAULTS);
  const [orig, setOrig]     = useState(SERVICE_DEFAULTS);
  const [meta, setMeta]     = useState({ by: null, at: null });
  const [loading, setLoad]  = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoad(true);
    try {
      const r = await api.get("/api/client-services/", token);
      const s = r?.services || SERVICE_DEFAULTS;
      setSvc(s); setOrig(s); setMeta({ by: r?.updated_by || null, at: r?.updated_at || null });
    } catch { toast?.("Could not load services", "err"); }
    finally { setLoad(false); }
  }, [token, toast]);
  useEffect(() => { load(); }, [load]);

  const flip = (key, where, v) => setSvc((s) => ({ ...s, [key]: { ...s[key], [where]: v } }));
  const dirty = JSON.stringify(svc) !== JSON.stringify(orig);

  const save = async () => {
    setSaving(true);
    try {
      const r = await api.put("/api/client-services/", { services: svc }, token);
      const s = r?.services || svc;
      setSvc(s); setOrig(s);
      setServices(s);                       // isi device par turant
      toast?.("Saved ✓  Other devices pick it up when the app or tab is opened again.");
      load();
    } catch (e) { toast?.(e.message || "Save failed", "err"); }
    finally { setSaving(false); }
  };

  const lbl = { fontSize: 10.5, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase",
               color: "#64748b", marginBottom: 2, paddingLeft: 4 };

  return (
    <Card style={{ padding: 24, maxWidth: 860 }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: "#0f172a" }}>Website &amp; App Services</div>
      <div style={{ fontSize: 12, color: "#64748b", margin: "4px 0 18px" }}>
        Choose which service runs on the <b>website</b> (browser) and which runs in the <b>app</b> (phone, tablet and TV).
      </div>

      {loading ? (
        <div style={{ color: "#94a3b8", fontSize: 13 }}>Loading…</div>
      ) : (
        <>
          {/* Table nahi -- har service ek row: chaudi screen par switch daayein,
              patli (phone app) par description ke NEECHE aa jaate hain. */}
          <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden" }}>
            {ROWS.map((row, i) => {
              const cur = svc[row.key] || SERVICE_DEFAULTS[row.key];
              const needOff = row.needs && !(svc[row.needs] || {}).app;
              return (
                <div key={row.key} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14,
                                            padding: "14px 16px", borderTop: i ? "1px solid #eef2f7" : "none" }}>
                  <div style={{ flex: "1 1 260px", minWidth: 0 }}>
                    <div style={{ fontWeight: 800, color: "#0f172a", fontSize: 13.5 }}>{row.label}</div>
                    <div style={{ fontSize: 11.5, color: "#64748b", marginTop: 3, lineHeight: 1.4 }}>{row.desc}</div>
                  </div>
                  <div style={{ display: "flex", gap: 22, flex: "0 0 auto" }}>
                    <div style={{ minWidth: 86 }}>
                      <div style={lbl}>Website</div>
                      {row.appOnly
                        ? <div style={{ fontSize: 12, color: "#94a3b8", padding: "6px 4px" }} title="Only for the app">—</div>
                        : <Switch on={!!cur.web} onChange={(v) => flip(row.key, "web", v)} />}
                    </div>
                    <div style={{ minWidth: 86 }}>
                      <div style={lbl}>App</div>
                      <Switch on={!!cur.app} disabled={needOff} onChange={(v) => flip(row.key, "app", v)}
                              title={needOff ? "Turn on Walkie-Talkie in the app first" : undefined} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 20, flexWrap: "wrap" }}>
            <Btn variant="primary" onClick={save} disabled={saving || !dirty}>
              {saving ? "Saving…" : "Save"}
            </Btn>
            {dirty && <span style={{ fontSize: 11.5, color: "#b45309" }}>unsaved changes</span>}
            {!dirty && meta.at && (
              <span style={{ fontSize: 11.5, color: "#94a3b8" }}>
                Last changed {meta.by ? `by ${meta.by} ` : ""}on {fmtDT(meta.at)}
              </span>
            )}
          </div>
        </>
      )}
    </Card>
  );
}
