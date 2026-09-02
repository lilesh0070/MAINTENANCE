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