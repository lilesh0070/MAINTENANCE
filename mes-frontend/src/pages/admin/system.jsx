/* admin/system.jsx — Admin Panel ka tab-dhancha (sirf constant, koi component nahi).

   ADMIN_SECTIONS: Maintenance (KPI Targets · Slip Threshold · PM Check Sheet ·
                   Machine DMC) + Admin (Users)
   AdminPanel.jsx aur DepartmentPanel dono isi list se tab banate hain. */

export const ADMIN_SECTIONS = [
  {
    key: "maintenance", label: "Maintenance", color: "#dc2626",
    tabs: [
      { key: "kpitarget",  label: "KPI Targets",      icon: "🎯" },
      { key: "slipthreshold", label: "Slip Threshold", icon: "⏱" },
      { key: "pmchecksheet", label: "PM Check Sheet", icon: "📋" },
      { key: "machinedmc",   label: "Machine DMC",    icon: "🏷" },
      // adminOnly: panel kisi non-admin ko grant ho jaye tab bhi user-management
      // sirf admin ko dikhe (AdminShell tab-filter isko hide karta hai).
      { key: "users",        label: "Users & Access", icon: "👥", adminOnly: true },
    ],
  },
  {
    key: "admin", label: "Admin", color: "#1e40af",
    tabs: [
      { key: "users",       label: "Users",        icon: "👥" },
    ],
  },
];
