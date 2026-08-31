import { createContext, useContext, useState, useEffect, useCallback } from "react";

const AuthContext = createContext(null);

const API = "";

// Sub-page → parent page mapping.  Har sub-page ki apni permission key hai, PAR
// agar admin ne us sub-key ko explicitly set NAHI kiya, to wo parent page ki
// access inherit kar leta hai.  Isse "parent grant karo → saare sub-pages mil
// jaayein" bhi chalta hai, aur kisi ek sub-page ko `none` set karke sirf usko
// rok bhi sakte ho.  (canAccess / canWrite dono is map ko dekhte hain.)
export const SUBPAGE_PARENT = {
  // Machine DMC
  "maintenance-daily-dmc":  "maintenance-machine-dmc",
  "maintenance-dmc-verify": "maintenance-machine-dmc",
  "maintenance-dmc-weekly": "maintenance-machine-dmc",
  "maintenance-dmc-ng":     "maintenance-machine-dmc",
  // Breakdown
  "maintenance-breakdown-slip":     "maintenance-breakdown",
  "maintenance-breakdown-history":  "maintenance-breakdown",
  "maintenance-breakdown-analysis": "maintenance-breakdown",
  "maintenance-breakdown-pareto":   "maintenance-breakdown",
  "maintenance-breakdown-top10":    "maintenance-breakdown",
  // Update Plan
  "maintenance-plan-yearly":     "maintenance-update-plan",
  "maintenance-plan-monthly":    "maintenance-update-plan",
  "maintenance-plan-predictive": "maintenance-update-plan",
  "maintenance-plan-sunday":     "maintenance-update-plan",
  "maintenance-plan-shutdown":   "maintenance-update-plan",
  "maintenance-plan-daily":      "maintenance-update-plan",
  // ANDON
  "andon-board":   "andon-system",
  "andon-monitor": "andon-system",
  "andon-faults":  "andon-system",
  "andon-calls":   "andon-system",
  "andon-config":  "andon-system",
  "andon-callout": "andon-system",
  "andon-reports": "andon-system",
  // Historical Data (aathon section)
  "hist-bd":   "maintenance-historical",
  "hist-auto": "maintenance-historical",
  "hist-pm":   "maintenance-historical",
  "hist-dmc":  "maintenance-historical",
  "hist-sun":  "maintenance-historical",
  "hist-day":  "maintenance-historical",
  "hist-capa": "maintenance-historical",
  "hist-log":  "maintenance-historical",
  // Production Breakdown Slip (do-stage slip ke chaar tab)
  "prod-slip-production":  "production-breakdown-slip",
  "prod-slip-maintenance": "production-breakdown-slip",
  "prod-slip-toolroom":    "production-breakdown-slip",
  "prod-slip-status":      "production-breakdown-slip",
  // Skill & Training
  "skill-ojt":          "skill-training",
  "skill-matrix":       "skill-training",
  "skill-org-chart":    "skill-training",
  "skill-upgradation":  "skill-training",
  // Preventive Maintenance (PM Panel tabs)
  "maintenance-pm-schedule":  "maintenance-pm",
  "maintenance-pm-fill":      "maintenance-pm",
  "maintenance-pm-engverify": "maintenance-pm",
  "maintenance-pm-incverify": "maintenance-pm",
  "maintenance-pm-format":    "maintenance-pm",
  "maintenance-pm-yearly":    "maintenance-pm",
};

// ── Auth storage ───────────────────────────────────────────────────
// Operator's policy (DEFAULT, badla nahi gaya): "har naya browser tab →
// fresh login mandatory.  URL-only access without id/password should NEVER
// reach a page."  sessionStorage token ko EK TAB tak rakhta hai — tab band =
// logout, naya tab = phir login.
//
// 2026-08-31 — Ek APNI-MARZI ki chhoot jodi gayi: "Remember me".  Zaroorat ye
// thi ki kuch screen hamesha khuli rehti hain — doosre app me iframe se laga
// hua page, ya deewar par lagi TV — aur wahan roz-roz login maangna bekaar
// hai.  User KHUD tick kare tabhi token localStorage me jaata hai (30 din).
// Bina tick ke sab kuch pehle jaisa hi hai, yaani upar wali policy sirf tab
// dheeli hoti hai jab koi jaan-boojh kar chune.
const AUTH_KEYS = ["mes_token","mes_username","user_role","user_id","user_dept_slug"];
(function migrateOldLocalStorage() {
  try {
    // Remember kiya hua login ho to localStorage ko HAATH MAT LAGAO — warna
    // har page-load par wahi token mit jaata jise bachana tha.
    if (localStorage.getItem("mes_remember") === "1") return;
    for (const k of AUTH_KEYS) {
      if (localStorage.getItem(k) !== null) localStorage.removeItem(k);
    }
  } catch {}
})();

// Default: sessionStorage — token sirf USI TAB me, tab band = logout.  Ye
// jaan-boojh kar hai (shared PC par koi doosra aakar khuli hui screen na paaye).
//
// "Remember me" chuna ho to localStorage — tab/browser band hone par bhi login
// bacha rehta hai.  Ye un jagahon ke liye hai jahan screen hamesha khuli rehti
// hai: doosre app me iframe se laga hua page, ya deewar par lagi TV.  Wahan har
// baar login maangna bekaar hai.
//
// Padhte waqt DONO dekhte hain (session pehle) — isliye remember kiya hua login
// naye tab me bhi chal jaata hai.
const REMEMBER_FLAG = "mes_remember";
const ss = {
  get:    (k) => { try { return sessionStorage.getItem(k) ?? localStorage.getItem(k); }
                   catch { return null; } },
  set:    (k, v, remember) => {
    try {
      if (remember) { localStorage.setItem(k, v); sessionStorage.removeItem(k); }
      else          { sessionStorage.setItem(k, v); localStorage.removeItem(k); }
    } catch { /* private mode */ }
  },
  remove: (k) => { try { sessionStorage.removeItem(k); localStorage.removeItem(k); } catch {} },
};
const isRemembered = () => { try { return localStorage.getItem(REMEMBER_FLAG) === "1"; }
                             catch { return false; } };
// Login ke saare nishan hatao — session, localStorage, aur remember ka flag.
// Teen jagah se bulaya jaata hai (do 401-handler + logout); ek jagah bhi
// flag reh jaata to safai wala block khud ko rok deta aur purane keys pade
// reh jaate.
const clearAuthStorage = (keys) => {
  for (const k of keys) { try { sessionStorage.removeItem(k); localStorage.removeItem(k); } catch { /* private mode */ } }
  try { localStorage.removeItem(REMEMBER_FLAG); } catch { /* private mode */ }
};

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => ss.get("mes_token") || "");
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const authHdr = useCallback(() => ({
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  }), [token]);

  const _setUserFromMe = (me) => {
    setUser({
      id:             me.id,
      username:       me.username,
      role:           me.role,
      departmentId:   me.department_id || null,
      departmentName: me.department_name || null,
      departmentSlug: me.department_slug || null,
      // Explicit per-page permission overrides set by admin from
      // Admin → Users → "Page Permissions".  Shape: { page_key: 'none'|'read'|'full' }
      // When a page isn't in this map, fall back to the role/dept defaults
      // baked into canAccess() below.
      permissions:    me.permissions || {},
    });
    const rem = isRemembered();
    ss.set("user_role", me.role, rem);
    ss.set("user_id", me.id, rem);
    if (me.department_slug) ss.set("user_dept_slug", me.department_slug, rem);
    else ss.remove("user_dept_slug");
  };

  useEffect(() => {
    if (!token) { setLoading(false); return; }
    let cancelled = false;
    // Load /me with retry.  Only a 401 (token really invalid) logs out; a
    // transient failure (500/503/network) RETRIES instead of clearing the
    // session — otherwise a DB hiccup would flash "Koi page assign nahi" or
    // bounce the user to /login even though their access is fine.
    const loadMe = async (tries = 0) => {
      try {
        const r = await fetch(`${API}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
        if (r.status === 401) {                       // genuine auth failure → logout
          if (!cancelled) { setToken(""); clearAuthStorage(AUTH_KEYS); setLoading(false); }
          return;
        }
        if (!r.ok) throw new Error(`me ${r.status}`); // transient → retry (keep session)
        const me = await r.json();
        if (!cancelled) { _setUserFromMe(me); setLoading(false); }
      } catch {
        if (cancelled) return;
        if (tries < 5) setTimeout(() => loadMe(tries + 1), 700 * (tries + 1));  // backoff retry
        else setLoading(false);                       // give up (rare true outage)
      }
    };
    loadMe();
    return () => { cancelled = true; };
  }, []);

  // ── Force-logout / password-change detect karo (har 10s) ──
  // JWT stateless hai: admin kisi ko force-logout kare (ya password badle) to
  // token server par TURANT invalid ho jaata hai, par is browser ko tab tak
  // pata nahi chalta jab tak wo koi request na kare.  Isliye har 10s `/me` se
  // token validate karte hain — 401 aate hi yahin se session clear + login page.
  useEffect(() => {
    if (!token) return;
    const check = () => {
      fetch(`${API}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => {
          if (r.status === 401) {                 // token invalid (force-logout / pw change)
            setToken(""); setUser(null);
            clearAuthStorage(AUTH_KEYS);
            if (typeof window !== "undefined" && window.location) window.location.replace("/login");
          }
        })
        .catch(() => {});                          // network error → ignore (offline etc.)
    };
    const id = setInterval(check, 10000);   // har 10s token validate
    return () => clearInterval(id);
  }, [token]);

  const login = async (username, password, remember = false) => {
    const fd = new FormData();
    fd.append("username", username);
    fd.append("password", password);
    fd.append("remember", remember ? "true" : "false");
    const res = await fetch(`${API}/api/auth/login`, { method: "POST", body: fd });
    if (!res.ok) {
      let msg = "Invalid credentials";
      try { const j = await res.json(); msg = j.detail || msg; } catch {}
      throw new Error(msg);
    }
    const data = await res.json();
    setToken(data.access_token);
    // Login response only carries id/username/role; department info comes
    // from /me — fetch it eagerly so the slide-nav can render the right
    // "{DeptName} Panel" label on the very first render.
    let me = null;
    try {
      const r = await fetch(`${API}/api/auth/me`, {
        headers: { Authorization: `Bearer ${data.access_token}` },
      });
      if (r.ok) me = await r.json();
    } catch {}
    if (me) _setUserFromMe(me);
    else setUser({ id: data.user_id, username: data.username, role: data.role,
                   departmentId: null, departmentName: null, departmentSlug: null });
    // remember hone par sab kuch localStorage me, warna session me (default)
    try {
      if (remember) localStorage.setItem(REMEMBER_FLAG, "1");
      else          localStorage.removeItem(REMEMBER_FLAG);
    } catch { /* private mode */ }
    ss.set("mes_token",    data.access_token, remember);
    ss.set("mes_username", data.username,     remember);
    ss.set("user_role",    data.role,         remember);
    ss.set("user_id",      data.user_id,      remember);
    return data;
  };

  const logout = () => {
    // best-effort AUTH_LOGOUT audit (JWT stateless — server-side session nahi).
    // Token clear karne se PEHLE bhejo taaki request me abhi wala token jaye.
    if (token) {
      fetch(`${API}/api/auth/logout`, { method: "POST", headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
    }
    setToken("");
    setUser(null);
    clearAuthStorage(AUTH_KEYS);
  };

  // Sirf `admin` → sab pages ka poora access.  Baaki designations
  // (supervisor … senior manager) ko SIRF woh pages dikhte hain jo admin ne
  // "User Access" me di hain (maintenance_user_permissions → /me →
  // user.permissions, page_key → level).
  const isAdmin = user?.role === "admin";
  const canAccess = (page) => {
    if (!user) return false;
    if (isAdmin) return true;
    const p = user?.permissions?.[page];
    if (p === "read" || p === "full") return true;
    if (p === "none") return false;                    // explicit deny
    const parent = SUBPAGE_PARENT[page];               // set nahi → sub-page ho to parent inherit
    if (parent) return canAccess(parent);
    return false;                                      // top-level page, set nahi → chhupa
  };
  const canWrite = (page) => {
    if (isAdmin) return true;
    const p = user?.permissions?.[page];
    if (p === "full") return true;
    if (p === "read" || p === "none") return false;
    const parent = SUBPAGE_PARENT[page];
    if (parent) return canWrite(parent);
    return false;
  };

  // Theme — admin ka universal blue (single-role app).
  const themeKey = "blue";
  const theme = {
    accent: "#2563eb", accentDark: "#1e40af",
    gradient: "linear-gradient(90deg,#1e40af,#2563eb,#60a5fa)",
    soft: "rgba(30,64,175,.08)", key: themeKey,
  };

  return (
    <AuthContext.Provider value={{
      token, user, loading, login, logout,
      authHdr, isAdmin,
      canAccess, canWrite, API,
      theme, themeKey,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
