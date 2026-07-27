import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./responsive.css";   // global mobile/tablet layer (desktop untouched)

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);