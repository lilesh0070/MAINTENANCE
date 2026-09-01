/* admin/system.jsx — Admin Panel ka tab-dhancha (sirf constant, koi component nahi).

   ADMIN_SECTIONS:
     • Document Update — KPI Targets · Slip Threshold · PM Check Sheet ·
                         Machine DMC · Breakdown Mail
       (2026-08-31: ye paanch pehle "Maintenance" section me the.  Inhe
        apni alag sidebar entry "Document Update" me nikala gaya — inka
        code, data aur behaviour bilkul waisa hi hai, sirf ye kis section
        ke neeche dikhte hain wo badla hai.)
     • Maintenance — sirf admin-only tabs (Users & Access · Login History)
     • Admin — Users

   AdminShell (AdminPanel.jsx) isi list se tab banata hai. */

export const ADMIN_SECTIONS = [
  {
    key: "documentupdate", label: "Document Update", color: "#dc2626",
    tabs: [
      { key: "kpitarget",     label: "KPI Targets",     icon: "🎯" },
      { key: "slipthreshold", label: "Slip Threshold",  icon: "⏱" },
      { key: "pmchecksheet",  label: "PM Check Sheet",  icon: "📋" },
      { key: "machinedmc",    label: "Machine DMC",     icon: "🏷" },
      { key: "breakdownmail", label: "Breakdown Mail",  icon: "✉" },
    ],
  },
  {
    key: "maintenance", label: "Maintenance", color: "#dc2626",
    tabs: [
      // adminOnly: panel kisi non-admin ko grant ho jaye tab bhi user-management
      // sirf admin ko dikhe (AdminShell tab-filter isko hide karta hai).
      { key: "users",        label: "Users & Access", icon: "👥", adminOnly: true },
      { key: "loginhistory", label: "Login History",  icon: "🔐", adminOnly: true },
      // Delete History — audit-log ka wo hissa jo pehle kahin dikhta hi nahi tha.
      // adminOnly: mitane ka record dekhna oversight ka kaam hai.
      { key: "deletehistory", label: "Delete History", icon: "🗑", adminOnly: true },
    ],
  },
  {
    key: "admin", label: "Admin", color: "#1e40af",
    tabs: [
      { key: "users",       label: "Users",        icon: "👥" },
    ],
  },
];
