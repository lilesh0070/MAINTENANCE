import { useLocation } from "react-router-dom";
import SlideNav from "./SlideNav";
import FullscreenButton from "./FullscreenButton";
import DisplayToolbar from "./DisplayToolbar";
import AIAssistant from "./AIAssistant";
import AppSettings from "./AppSettings";
import { isNativeApp } from "../constants/apiBase";

// The wall-dashboard pages get the full display toolbar (Light/Dark + aspect +
// fullscreen); every other page keeps just the plain full-screen button.
const DISPLAY_ROUTES = new Set(["/maintenance-overview", "/maintenance-dashboard"]);

export default function Layout({ children }) {
  const { pathname } = useLocation();
  const isDisplay = DISPLAY_ROUTES.has(pathname);
  return (
    <div style={{
      minHeight: "100vh",
      background: "var(--bg-primary, #f8fafc)",
      color: "var(--text-primary, #0f172a)",
      fontFamily: "'Segoe UI', system-ui, sans-serif",
      fontSize: 14,
    }}>
      {/* Page content */}
      <div style={{ minHeight: "100vh" }}>
        {children}
      </div>

      {/* Floating nav — always visible on top */}
      <SlideNav />

      {/* App ka ⚙ Settings — upar daayen.  SIRF APK me dikhta hai; website
          par ye component pehli line par hi null laut jaata hai, isliye wahan
          na button aata hai na koi request jaati hai.
          Andar: kaun logged in hai, app ka version + update, aur logout. */}
      <AppSettings />

      {/* Maintenance AI assistant — ek hi jagah lagi hai, isliye HAR page par
          milti hai: Breakdown, ANDON, CAPA, PM, Spare, KPI, wall-display, sab.
          (Pehle wall-display do page chhode the, par user ne saaf kaha "saare
          page par", isliye chhoot hata di.)  Bottom-RIGHT par baithti hai. */}
      <AIAssistant pageContext={{ page: pathname }} />

      {/* Display controls — full toolbar on the wall-dashboard pages,
          otherwise just the full-screen toggle. */}
      {pathname === "/maintenance-dashboard"
        ? null   /* dashboard has its own topbar ⛶ Fullscreen — no floating control */
        : isDisplay
          ? <DisplayToolbar showTheme={pathname === "/maintenance-overview"} />
          /* APK me fullscreen bemaani hai — app khud poori screen par hai —
             aur wo upar-daayen wahi jagah ghera hai jahan ⚙ Settings baithta
             hai.  Isliye app me use chhod dete hain; website par jaisa tha
             waisa hi. */
          : isNativeApp() ? null : <FullscreenButton />}
    </div>
  );
}
