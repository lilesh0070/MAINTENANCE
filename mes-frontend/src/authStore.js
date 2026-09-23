/* Login kahan yaad rehta hai -- SIRF YAHAN.
 *
 * Pehle teen jagah alag-alag likha tha (AuthContext, api/client, AIAssistant)
 * aur teeno seedha `sessionStorage` bulate the.  Ek jagah badalte to baaki do
 * peechhe reh jaate -- token ek jagah se mitta, doosri jagah se nahi.  Isliye
 * ab ek hi ghar.
 *
 * 2026-09-23 se DONO (website aur app) localStorage par.  User: "browser close
 * karke kholo to bhi logged in rahe."
 *
 * PEHLE kya tha: website par sessionStorage -- har naya tab fresh login
 * maangta tha ("URL-only access should NEVER reach a page" wala purana niyam).
 * Wo niyam ab NAHI raha, aur ye majboori hai: jo cheez browser band hone par
 * bachti hai wo ussi browser ke naye tab me bhi apne aap mil jaati hai --
 * browser me aisi koi jagah hai hi nahi jo ek ko bachaye aur doosre ko roke.
 * Matlab shared computer par ab "Sign out" dabana ZAROORI hai.
 *
 * Pehra phir bhi kaayam hai:
 *   - token 30 din (TOKEN_EXPIRE_HOURS=720) me khud mar jaata hai,
 *   - admin ka force-logout / password change har 10 second wali `/me` jaanch
 *     me pakda jaata hai (AuthContext),
 *   - band (inactive) khaate ka token turant bekaar (auth.py).
 */

export const AUTH_KEYS = ["mes_token", "mes_username", "user_role", "user_id", "user_dept_slug"];

/* Jo abhi logged in hain unka session sessionStorage me pada hai.  Ek baar
   utha kar localStorage me rakh dete hain -- warna is release ke din sabko
   bina wajah dobara login karna padta. */
(function sessionSeUthaLo() {
  try {
    if (localStorage.getItem("mes_token")) return;      // pehle se hai, chhedo mat
    if (!sessionStorage.getItem("mes_token")) return;   // purana session hai hi nahi
    for (const k of AUTH_KEYS) {
      const v = sessionStorage.getItem(k);
      if (v !== null) localStorage.setItem(k, v);
    }
  } catch { /* private window / storage band -- chhod do */ }
})();

export const authStore = {
  get:    (k)    => { try { return localStorage.getItem(k); } catch { return null; } },
  set:    (k, v) => { try { localStorage.setItem(k, String(v)); } catch { /* storage bhara/band */ } },
  remove: (k)    => { try { localStorage.removeItem(k); } catch { /* storage band */ } },
  /* Logout: dono jagah se saaf karo.  sessionStorage isliye ki kisi purane
     tab me abhi bhi wahan padi ho -- warna wo tab logged-in dikhta rehta. */
  clear:  () => {
    for (const k of AUTH_KEYS) {
      try { localStorage.removeItem(k); } catch { /* storage band */ }
      try { sessionStorage.removeItem(k); } catch { /* storage band */ }
    }
  },
};
