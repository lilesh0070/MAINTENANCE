import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import "./responsive.css";   // global mobile/tablet layer (desktop untouched)
import { installApiBase } from "./constants/apiBase";

// APK me API ka pura pata jodta hai.  WEBSITE PAR KUCH NAHI KARTA — wahan
// API_BASE khali rehta hai aur `/api/...` bilkul pehle jaisa proxy se jaata hai.
installApiBase();

/* `ErrorBoundary` SABSE UPAR -- kisi bhi page ki koi galti poori app ko
   khaali na kar de.  Iske bina React galti par poora tree hata deta hai aur
   sirf khaali screen bachti hai, jo bahar se "app khul hi nahi rahi" lagti
   hai. */
createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);

/* Splash hatao — par tabhi jab ASLI PAGE aa jaye.
 *
 * Pehle `render()` ke do frame baad hata dete the.  Wo bahut jaldi tha:
 * React ne DOM bana diya hota hai par app abhi bhi `loading` me hoti hai
 * (`/api/auth/me` ka intezaar), aur us beech ek khaali/spinner wali screen
 * dikhti thi.  User ne yahi kaha -- "splash bas ek pal ko aata hai".
 *
 * Ab intezaar karte hain ki page par SACH ME kuch chhap jaye: `#root` me
 * kuch dikhne laayak aa jaye (login form ho ya dashboard).  Har frame par
 * dekhte hain, aur mil jaane par fade karke hata dete hain.
 *
 * SURAKSHA: 12 second ki hadd.  Kuch bhi atak jaye (server, koi error) to
 * bhi splash hamesha ke liye chipka na rah jaye -- warna app hi bekaar.
 *
 * Website par ye kuch nahi karta -- wahan splash hai hi nahi. */
(function splashHatao() {
  const sp = document.getElementById("boot-splash");
  if (!sp) return;
  const shuru = Date.now();
  const HADD = 12000;

  const hatao = () => {
    sp.classList.add("ja-raha");
    setTimeout(() => sp.remove(), 500);       // CSS ka fade 450ms ka hai
  };

  const dekho = () => {
    if (Date.now() - shuru > HADD) { hatao(); return; }
    const root = document.getElementById("root");
    // "asli page" = root me kuch chhap chuka hai aur wo sirf spinner nahi
    const taiyaar = root && root.firstElementChild
      && root.getBoundingClientRect().height > 80
      && (root.innerText || "").trim().length > 20;
    if (taiyaar) { requestAnimationFrame(hatao); return; }   // ek frame aur, paint ho jaye
    requestAnimationFrame(dekho);
  };
  requestAnimationFrame(dekho);
})();