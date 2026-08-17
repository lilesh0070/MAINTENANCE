import { useLocation } from "react-router-dom";
import SlideNav from "./SlideNav";
import FullscreenButton from "./FullscreenButton";
import DisplayToolbar from "./DisplayToolbar";

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

      {/* Display controls — full toolbar on the wall-dashboard pages,
          otherwise just the full-screen toggle. */}
      {pathname === "/maintenance-dashboard"
        ? null   /* dashboard has its own topbar ⛶ Fullscreen — no floating control */
        : isDisplay
          ? <DisplayToolbar showTheme={pathname === "/maintenance-overview"} />
          : <FullscreenButton />}
    </div>
  );
}
