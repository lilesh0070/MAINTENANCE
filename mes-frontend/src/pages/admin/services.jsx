/* admin/services.jsx — "Services" tab (Maintenance Panel, sirf admin).
 *
 * Kaunsi service WEBSITE par aur kaunsi APP (phone / tablet / TV) par chale —
 * dono ke ALAG switch.  User 2026-09-19: "admin panel me naya tab, har service
 * ka option website aur app ke liye alag; abhi website ke liye sab band,
 * zaroorat hogi tab chalu kar lenge."
 *
 * Neeche "ANDON ring — by user ID": kis ID par ANDON popup ki ring baje
 * (user 2026-09-19: maint par band, baaki sab par; naye ID par default ON).
 *
 * Backend: GET / PUT /api/client-services (routers/client_services.py).
 * Save ke baad ISI device par turant lag jaata hai (`setServices`); baaki
 * devices par jab app / tab dobara saamne aaye ya page khule.
 */
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../api/client";
import { Card, Btn } from "./ui";
import { SERVICE_DEFAULTS, setServices, loadServices } from "../../constants/clientServices";

const ROWS = [
  { key: "andon_alert", label: "ANDON alert",
    desc: "Popup and beep on every page when a new maintenance ANDON call comes (the app also vibrates). With Background listening on, the app hears about new calls straight away and rings even when it is closed; otherwise it checks for new calls every 2.5 seconds." },
  { key: "walkie", label: "Walkie-Talkie",
    desc: "Walkie-Talkie connection: shows the user online, the buzz call screen, chat messages and live voice. Off = no connection at all." },
  // Background ab ANDON bhi laata hai -- walkie band ho par ANDON chalu, tab bhi chahiye
  { key: "walkie_background", label: "Background listening", appOnly: true, needs: ["andon_alert", "walkie"],
    desc: "The app keeps one connection open so that ANDON calls, buzz, chat and voice reach the phone even when the app is closed (Android background service with a \"Listening\" notification)." },
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

/* "senior_engineer" -> "Senior engineer" */
const padNaam = (r) => {
  const s = String(r || "").replace(/_/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : "";
};

export function ServicesPage({ toast }) {
  const { token } = useAuth();
  const [svc, setSvc]       = useState(SERVICE_DEFAULTS);
  const [orig, setOrig]     = useState(SERVICE_DEFAULTS);
  const [meta, setMeta]     = useState({ by: null, at: null });
  const [loading, setLoad]  = useState(true);
  const [saving, setSaving] = useState(false);
  /* ANDON ring -- ID ke hisaab se (user 2026-09-19: "kis ID par ANDON popup
     ki ring bajegi").  Server sirf BAND wali ID rakhta hai; list me na ho =
     ring bajti hai (default ON). */
  const [users, setUsers]         = useState([]);
  const [ringOff, setRingOff]     = useState([]);
  const [ringOrig, setRingOrig]   = useState([]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoad(true);
    try {
      const r = await api.get("/api/client-services/", token);
      const s = r?.services || SERVICE_DEFAULTS;
      setSvc(s); setOrig(s); setMeta({ by: r?.updated_by || null, at: r?.updated_at || null });
      const band = Array.isArray(r?.andon_ring_off) ? [...r.andon_ring_off].sort((a, b) => a - b) : [];
      setRingOff(band); setRingOrig(band);
      setUsers(Array.isArray(r?.users) ? r.users : []);
    } catch { toast?.("Could not load services", "err"); }
    finally { setLoad(false); }
  }, [token, toast]);
  useEffect(() => { load(); }, [load]);

  const flip = (key, where, v) => setSvc((s) => ({ ...s, [key]: { ...s[key], [where]: v } }));
  const ringFlip = (id, on) => setRingOff((b) => {
    const s = new Set(b);
    if (on) s.delete(id); else s.add(id);
    return [...s].sort((a, x) => a - x);
  });
  const dirty = JSON.stringify(svc) !== JSON.stringify(orig)
             || JSON.stringify(ringOff) !== JSON.stringify(ringOrig);

  const save = async () => {
    setSaving(true);
    try {
      const r = await api.put("/api/client-services/", { services: svc, andon_ring_off: ringOff }, token);
      const s = r?.services || svc;
      setSvc(s); setOrig(s);
      setServices(s);                       // isi device par turant
      loadServices(token);                  // apni ANDON ring bhi taaza
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
              const needOff = row.needs && !row.needs.some((k) => (svc[k] || {}).app);
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
                              title={needOff ? "Turn on ANDON alert or Walkie-Talkie in the app first" : undefined} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── ANDON ring: kis ID par baje ── */}
          <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, marginTop: 16, padding: "14px 16px" }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "4px 12px" }}>
              <div style={{ fontWeight: 800, color: "#0f172a", fontSize: 13.5 }}>ANDON ring — by user ID</div>
              <div style={{ fontSize: 11.5, color: "#64748b" }}>
                {users.length - users.filter((u) => ringOff.includes(u.id)).length} of {users.length} ring
              </div>
            </div>
            <div style={{ fontSize: 11.5, color: "#64748b", marginTop: 3, lineHeight: 1.4 }}>
              Which user IDs hear a sound when an ANDON popup comes (the popup beep in the app or website, and the phone ring when the app is closed).
              Off = the popup and notification still come and the phone still vibrates, only the sound is off.
              New IDs ring until you turn them off here.
            </div>
            {!users.length ? (
              <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 10 }}>No users found.</div>
            ) : (
              /* Chaudi screen par kai khaane, phone par ek -- har ID ek patti */
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))",
                            gap: 8, marginTop: 12 }}>
                {users.map((u) => {
                  const on = !ringOff.includes(u.id);
                  return (
                    <div key={u.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 6px 6px 10px",
                                             border: "1px solid #eef2f7", borderRadius: 8,
                                             background: on ? "#fff" : "#f8fafc" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, color: "#0f172a", fontSize: 12.5, whiteSpace: "nowrap",
                                      overflow: "hidden", textOverflow: "ellipsis" }}
                             title={u.full_name ? `${u.full_name} (${u.username})` : u.username}>
                          {u.full_name ? `${u.full_name} (${u.username})` : u.username}
                        </div>
                        <div style={{ fontSize: 10.5, color: "#94a3b8" }}>{padNaam(u.role)}</div>
                      </div>
                      <Switch on={on} onChange={(v) => ringFlip(u.id, v)}
                              title={on ? "Ring is on for this ID" : "Ring is off for this ID"} />
                    </div>
                  );
                })}
              </div>
            )}
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
