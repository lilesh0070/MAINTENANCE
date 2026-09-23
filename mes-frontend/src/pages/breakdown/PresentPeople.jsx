import { useState, useEffect, useCallback } from "react";
import { api } from "./shared";

/* ════════════════════════════════════════════════════════════════════
 * 1.6) Today Present Person — Maintenance Dashboard ke daayin taraf wale
 *      (30%) khaane me.  User 2026-09-23:
 *        "subah 7 baje se shaam 6 baje tak G aur A shift wale person ka
 *         naam aayega, aur shaam 6 baje se doosre din ki subah 7 baje tak
 *         B walon ka naam.  Upar TODAY PRESENT PERSON, uske aage shift,
 *         aur neeche naam."
 *
 *      Source: GET /api/attendance/on-duty
 *        { shift, slots[], day, now, count, people:[{id,name,emp_code,
 *          designation,slot}] }
 *
 *      ⚠ Shift ka faisla SERVER par hota hai, yahan nahi -- TV, phone aur
 *        website sab ki apni ghadi hoti hai, aur TV to kabhi-kabhi galat
 *        waqt par chalti hai.  Isliye yahan sirf dikhana hai.
 *      ⚠ Is endpoint me sirf naam jaate hain (contact/photo nahi), isliye
 *        Attendance Dashboard ki permission na hone par bhi ye dikhta hai.
 * ════════════════════════════════════════════════════════════════════ */

function PresentPeople({ token }) {
  const [d, setD]     = useState(null);
  const [err, setErr] = useState(false);

  const load = useCallback(() => {
    if (!token) return;
    api.get("/api/attendance/on-duty", token)
      .then((r) => { setD(r); setErr(false); })
      .catch(() => setErr(true));
  }, [token]);

  useEffect(() => { load(); }, [load]);
  /* Har 2 minute par taaza: shift 7 aur 18 baje badalti hai, aur board din
     me kabhi bhi badal sakta hai.  Sirf timer -- koi lagataar chalne wali
     animation nahi (app me wo bhaari padti hai). */
  useEffect(() => {
    const t = setInterval(load, 120_000);
    return () => clearInterval(t);
  }, [load]);

  const khaali = { padding: "26px 16px", textAlign: "center", color: "#94a3b8",
                   fontSize: 12.5, fontStyle: "italic" };

  return (
    <div style={{ background: "#fff", border: "1px solid #e8edf3", borderRadius: 14,
                  overflow: "hidden", boxShadow: "0 1px 3px rgba(15,23,42,.05)" }}>
      {/* header — naam, ginti aur shift */}
      <div style={{ padding: "13px 16px", borderBottom: "1px solid #eef2f7",
                    display: "flex", alignItems: "center", gap: 11 }}>
        <span style={{ width: 34, height: 34, borderRadius: 9, background: "#0f766e", color: "#fff",
                       display: "inline-flex", alignItems: "center", justifyContent: "center",
                       fontSize: 16, flexShrink: 0 }}>👷</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 19, fontWeight: 800,
                        color: "#0f172a", lineHeight: 1.1 }}>Today Present Person</div>
          <div style={{ fontSize: 10.5, color: "#8a94a6", fontWeight: 600 }}>
            {d ? `${d.count} ${d.count === 1 ? "person" : "persons"} · ${d.day}` : "…"}
          </div>
        </div>
        {d && (
          <span style={{ flexShrink: 0, background: "#ecfdf5", color: "#0f766e",
                         border: "1px solid #a7f3d0", borderRadius: 99,
                         padding: "5px 12px", fontSize: 11, fontWeight: 800,
                         letterSpacing: ".06em", whiteSpace: "nowrap" }}>
            {d.shift} SHIFT
          </span>
        )}
      </div>

      {/* naam */}
      {err ? (
        <div style={{ ...khaali, color: "#dc2626", fontStyle: "normal" }}>
          Could not load attendance.
        </div>
      ) : !d ? (
        <div style={khaali}>Loading…</div>
      ) : d.people.length === 0 ? (
        <div style={khaali}>No one is marked in this shift yet.</div>
      ) : (
        <div style={{ maxHeight: 520, overflowY: "auto" }}>
          {d.people.map((p, i) => (
            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10,
                                     padding: "10px 16px",
                                     borderTop: i === 0 ? "none" : "1px solid #f2f5f9" }}>
              <span style={{ flexShrink: 0, width: 22, fontSize: 11, fontWeight: 700,
                             color: "#b6bfcc" }}>{i + 1}</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: "#0f172a",
                             overflow: "hidden", textOverflow: "ellipsis",
                             whiteSpace: "nowrap" }}>{p.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default PresentPeople;
