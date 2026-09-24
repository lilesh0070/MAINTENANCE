import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

/* ════════════════════════════════════════════════════════════════════
 * "← Back" -- page se WAPAS main Dashboard par.
 * User 2026-09-25: "Quick Access ke 4 button se jo page khulte hain, un
 * charon par back ka button lagao -- TV APK aur site ke liye -- ki back
 * dabate hi wapas main dashboard par aa jaaye."  (Work Records, Maintenance
 * KPI, Attendance Dashboard, 3D View.)
 *
 * KAHAN JAATA HAI: Quick Access `state.from` me bhejta hai ki kis dashboard
 * se aaye (`/dashboard` ya `/maintenance-dashboard` -- dono par wahi page
 * hai), to wahi wapas.  Sidebar / seedhe link se aaye to jo dashboard is user
 * ko mila hai (`dashboard` warna `maintenance-dashboard`).
 * `navigate(-1)` JAAN-BOOJH KAR nahi: seedha link kholne par history khaali
 * hoti hai -- app me wo app hi band kar deta.
 *
 * KAHAN DIKHTA HAI: website + TV app.  Phone (`in-app`) aur tablet
 * (`in-app-tab`) par CHHUPA -- wahan Android ka apna back hai, aur baaki page
 * ke Back bhi wahan chhupe hain.  Dikhawat + chhupana: responsive.css me
 * `.dash-back`.
 *
 * Header ki khaali baayi jagah (`<div />`) me ise us div ke ANDAR rakho, div
 * ki jagah nahi -- phone par button chhupe to bhi `space-between` wala
 * dhaancha (daayein naam ki pill) na khiske.
 * ════════════════════════════════════════════════════════════════════ */
const DASH = ["/dashboard", "/maintenance-dashboard"];

export default function DashBack() {
  const nav = useNavigate();
  const { state } = useLocation();
  const { canAccess } = useAuth();
  const apna = !canAccess("dashboard") && canAccess("maintenance-dashboard")
    ? "/maintenance-dashboard" : "/dashboard";
  const to = DASH.includes(state?.from) ? state.from : apna;
  return (
    <button type="button" className="dash-back" onClick={() => nav(to)} title="Back to Dashboard">
      ← Back
    </button>
  );
}
