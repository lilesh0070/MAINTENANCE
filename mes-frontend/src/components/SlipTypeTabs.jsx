/* ───────────────────────────────────────────────────────────────────
 * SlipTypeTabs.jsx
 * ───────────────────────────────────────────────────────────────────
 * "Slip Type" — Manual Slip / Auto Slip / All.
 *
 * User (2026-09-23): BD History, BD Analysis, Pareto Analysis, Top 10 BD,
 * Breakdown QPR, CAPA aur Maintenance KPI — sab par upar yahi ek jaisa
 * switch chahiye.  Isliye look yahin ek jagah hai; koi page apna alag
 * banata nahi, warna teen page par teen tarah ka dikhne lagta.
 *
 *   manual = maintenance_breakdown_data       (haath se bhari Break Down Slip)
 *   auto   = maintenance_auto_breakdown_slip  (ANDON call se bani slip)
 *   all    = dono
 *
 * ⚠ Auto slip sirf POORI BHAR KAR SUBMIT hone ke baad aati hai — ye chhant
 *   server par hoti hai (`Phase2/bd_source.py`), yahan kuch nahi karna.
 * ⚠ DEFAULT har page par "manual" (user: "default sabme abhi manual slip ka
 *   rahega").  Isi liye `SLIP_DEFAULT` yahan se aata hai — kal badalna ho to
 *   ek hi jagah badlega.
 *
 * Value / default alag file me hain (`constants/slipType.js`) -- ek file se
 * component aur constants dono export karne par Vite ka fast-refresh toot-ta
 * hai (eslint react-refresh/only-export-components).
 *
 * Rangai JAAN-BOOJH KAR inline hai: har page ki apni class (bh-fld / pa-fld /
 * ba-fld / cp-fld) alag hai, aur purane plant TV ka WebView `color-mix()`
 * jaisi cheezein nahi samajhta.  Inline style har jagah jeetti hai, to switch
 * sab jagah hu-ba-hu ek jaisa dikhta hai.
 */
import { useAuth } from "../context/AuthContext";
import { SLIP_TYPES, SLIP_DEFAULT } from "../constants/slipType";

const WRAP = { display: "flex", flexDirection: "column", gap: 5 };
const LBL  = { fontSize: 10.5, fontWeight: 800, letterSpacing: ".05em",
               textTransform: "uppercase", color: "#64748b" };
const BOX  = { display: "flex", border: "1.5px solid #cbd5e1", borderRadius: 9,
               overflow: "hidden", background: "#fff" };

export default function SlipTypeTabs({ value, onChange, label = "Slip Type", cls, style }) {
  const { theme } = useAuth();
  const chosen = value || SLIP_DEFAULT;
  return (
    <div className={cls} style={{ ...WRAP, ...style }}>
      {label ? <label style={LBL}>{label}</label> : null}
      <div style={BOX}>
        {SLIP_TYPES.map(([v, txt], i) => {
          const on = chosen === v;
          return (
            <button key={v} type="button" onClick={() => onChange(v)}
                    aria-pressed={on}
                    style={{
                      border: 0,
                      borderRight: i === SLIP_TYPES.length - 1 ? 0 : "1px solid #e2e8f0",
                      background: on ? theme.accent : "#fff",
                      color: on ? "#fff" : "#475569",
                      fontFamily: "'Barlow',sans-serif",
                      fontSize: 13, fontWeight: 700,
                      padding: "9px 14px", cursor: "pointer", whiteSpace: "nowrap",
                    }}>
              {txt}
            </button>
          );
        })}
      </div>
    </div>
  );
}
