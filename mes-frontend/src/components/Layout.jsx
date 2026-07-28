import SlideNav from "./SlideNav";
import FullscreenButton from "./FullscreenButton";

export default function Layout({ children }) {
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

      {/* Full-screen toggle — on every page (handy for the TV wall-display) */}
      <FullscreenButton />
    </div>
  );
}
