import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./responsive.css";   // global mobile/tablet layer (desktop untouched)
import { installApiBase } from "./constants/apiBase";

// APK me API ka pura pata jodta hai.  WEBSITE PAR KUCH NAHI KARTA — wahan
// API_BASE khali rehta hai aur `/api/...` bilkul pehle jaisa proxy se jaata hai.
installApiBase();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// Splash hatao — par tabhi jab page SACH ME chhap chuka ho.  `render()` ke
// turant baad hataate to ek pal ko khaali screen jhalakti (React ne DOM to
// bana diya hota hai, browser ne paint nahi kiya hota).  Do frame rukne se wo
// jhalak nahi aati.  Fade CSS me hai, isliye yahan sirf class lagani hai.
// Website par ye kuch nahi karta — wahan splash hai hi nahi.
(function splashHatao() {
  const sp = document.getElementById("boot-splash");
  if (!sp) return;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    sp.classList.add("ja-raha");
    setTimeout(() => sp.remove(), 500);      // CSS ka fade 450ms ka hai
  }));
})();