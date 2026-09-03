/* admin/mailconfig.jsx — Users page ke saanjhe constants.

   ROLE_PILL          role ka rang (admin / production / operator …)
   PAGE_PERM_GROUPS   kaunse page par permission set ki ja sakti hai
   PERM_LEVELS        none / read / write

   admin/org.jsx (Users page) inhi teeno ko import karta hai. */
import { useState, useEffect, useRef, useCallback, useMemo, Fragment } from "react";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../api/client";
import {
  PageHeading, Card, Pill, Btn, FF, Input, Select,
  Modal, ModalActions, Toast, EmptyState, Spinner, ExcelImportButton,
  inputStyle,
} from "./ui";

// ─── USERS PAGE ───────────────────────────────────────────────
// Roles = ek designation-ladder.  Sirf `admin` ke paas full access hai;
// baaki sab (supervisor … senior manager) ko admin per-page permissions
// deta hai (Permissions button).  ROLE_OPTIONS = dropdown ka single source.
export const ROLE_OPTIONS = [
  { value: "admin",             label: "Admin" },
  { value: "supervisor",        label: "Supervisor" },
  { value: "engineer",          label: "Engineer" },
  { value: "senior_engineer",   label: "Senior Engineer" },
  { value: "assistant_manager", label: "Assistant Manager" },
  { value: "deputy_manager",    label: "Deputy Manager" },
  { value: "senior_manager",    label: "Senior Manager" },
];

export const ROLE_PILL = {
  admin:             { bg:"rgba(30,64,175,.10)",  fg:"#1e40af" },
  supervisor:        { bg:"rgba(13,148,136,.10)", fg:"#0d9488" },
  engineer:          { bg:"rgba(22,163,74,.10)",  fg:"#16a34a" },
  senior_engineer:   { bg:"rgba(5,150,105,.12)",  fg:"#047857" },
  assistant_manager: { bg:"rgba(124,58,237,.10)", fg:"#6d28d9" },
  deputy_manager:    { bg:"rgba(79,70,229,.10)",  fg:"#4f46e5" },
  senior_manager:    { bg:"rgba(217,119,6,.12)",  fg:"#b45309" },
};

// Master list of pages admins can grant per-user permissions on.
// Grouped by area for the permission matrix modal.  page_key MUST
// match the canAccess() keys in AuthContext.jsx so explicit overrides
// resolve correctly.
//
// ─────────────────────────────────────────────────────────────────────────
// NAYA PAGE YA SUB-PAGE JOD RAHE HO?  TEENO JAGAH KARNA ZAROORI HAI:
//
//   1. YAHAN (PAGE_PERM_GROUPS)  — warna admin use grant hi nahi kar payega
//   2. AuthContext.jsx ke SUBPAGE_PARENT me (sirf sub-page ke liye)
//                                 — warna wo apne parent se inherit nahi hoga
//   3. Jahan use hota hai: App.jsx ka requiredAccess, ya page ka
//      canAccess(...) / TAB_KEY
//
// Ek bhi chhoot gayi to gadbad CHUP-CHAAP hoti hai:
//   • canAccess(undefined) hamesha FALSE lautata hai — to non-admin ko wo
//     page/tab dikhta hi nahi, aur admin ko dikhta hai, isliye testing me
//     sab theek lagta hai.  (ANDON ka "Call History" tab isi tarah galti se
//     kuch der admin-only reh gaya tha.)
//   • Yahan se chhoot gaya to key kaam to karti hai, par admin ki permission
//     list me dikhti hi nahi — grant karne ka koi tareeqa hi nahi bachta.
//
// Milaan karne ka tareeqa (frontend folder se):
//   App.jsx ke requiredAccess, code ke canAccess(...), aur is list ko
//   aapas me mila lo — teeno ka farak khali hona chahiye.
// ─────────────────────────────────────────────────────────────────────────
export const PAGE_PERM_GROUPS = [
  { group: "Maintenance — Pages", items: [
    { key: "dashboard",                  label: "Dashboard (home / landing)" },
    { key: "maintenance-overview",       label: "Overview" },
    { key: "andon-system",               label: "ANDON", children: [
      /* Kram wahi jo ANDON page ke tabs ka hai, taaki dono milte-julte lagein. */
      { key: "andon-board",   label: "Live Board" },
      { key: "andon-monitor", label: "Monitor" },
      { key: "andon-faults",  label: "Fault History" },
      { key: "andon-calls",   label: "Call History (delete admin-only)" },
      { key: "andon-config",  label: "Configuration" },
      { key: "andon-callout", label: "Call → Output" },
      { key: "andon-reports", label: "Reports" },
    ]},
    { key: "maintenance-update-plan",    label: "Update Plan", children: [
      { key: "maintenance-plan-yearly",     label: "Preventive Yearly Plan" },
      { key: "maintenance-plan-monthly",    label: "Preventive Monthly Plan" },
      { key: "maintenance-plan-predictive", label: "Predictive Plan" },
      { key: "maintenance-plan-sunday",     label: "Sunday Plan Work" },
      { key: "maintenance-plan-shutdown",   label: "Shutdown Plan Work" },
      { key: "maintenance-plan-daily",      label: "Daily Work Assign" },
    ]},
    { key: "maintenance-dashboard",      label: "Maintenance Dashboard" },
    { key: "maintenance-kpi",            label: "Maintenance KPI" },
    { key: "maintenance-breakdown",      label: "Breakdown", children: [
      { key: "maintenance-breakdown-slip",     label: "Breakdown Slip (manual, from the Breakdown page)" },
      { key: "maintenance-breakdown-history",  label: "BD History" },
      { key: "maintenance-breakdown-analysis", label: "BD Analysis" },
      { key: "maintenance-breakdown-pareto",   label: "Pareto Analysis" },
      { key: "maintenance-breakdown-top10",    label: "Top 10 BD" },
    ]},
    { key: "production-breakdown-slip",  label: "Production Breakdown Slip", children: [
      /* Chaaron tab alag grant ho sakte hain — production wale ko sirf apna
         tab, tool room wale ko sirf apna.  Kram wahi jo page par hai. */
      { key: "prod-slip-production",  label: "Production (fill production half)" },
      { key: "prod-slip-maintenance", label: "Maintenance (complete slip)" },
      { key: "prod-slip-toolroom",    label: "Tool Room (complete slip)" },
      { key: "prod-slip-status",      label: "Status (view only)" },
    ]},
    { key: "skill-training",             label: "Skill & Training", children: [
      { key: "skill-ojt",         label: "OJT" },
      { key: "skill-matrix",      label: "Skill Matrix" },
      { key: "skill-org-chart",   label: "Organisation Chart" },
      { key: "skill-upgradation", label: "Skill Upgradation Plan" },
    ]},
    { key: "maintenance-historical",     label: "Historical Data", children: [
      /* Kram wahi jo page ke section buttons ka hai. */
      { key: "hist-bd",   label: "Breakdown Slips" },
      { key: "hist-auto", label: "Auto Slips (ANDON)" },
      { key: "hist-pm",   label: "PM Check Sheets" },
      { key: "hist-dmc",  label: "DMC Check Sheets" },
      { key: "hist-sun",  label: "Sunday Plan Work" },
      { key: "hist-day",  label: "Daily Work Assign" },
      { key: "hist-capa", label: "CAPA (Closed)" },
      { key: "hist-log",  label: "Log Book" },
    ]},
    { key: "maintenance-capa",           label: "CAPA" },
    { key: "maintenance-deviations",     label: "Deviations" },
    { key: "maintenance-logbook",        label: "Log Book" },
    { key: "maintenance-history-card",   label: "History Card" },
    { key: "maintenance-pm",             label: "Preventive Maint.", children: [
      { key: "maintenance-pm-schedule",  label: "Schedule" },
      { key: "maintenance-pm-fill",      label: "Fill Check Sheets" },
      { key: "maintenance-pm-engverify", label: "Engineer Verify" },
      { key: "maintenance-pm-incverify", label: "In-Charge Approve" },
      { key: "maintenance-pm-format",    label: "Format" },
      { key: "maintenance-pm-yearly",    label: "Yearly PM Schedule" },
    ]},
    { key: "maintenance-machine-manual", label: "Machine Manual" },
    { key: "maintenance-study-material", label: "Study Material (writes are admin-only)" },
    { key: "maintenance-machine-dmc",    label: "Machine DMC", children: [
      { key: "maintenance-daily-dmc",  label: "Operator DMC Fill" },
      { key: "maintenance-dmc-verify", label: "Supervisor Verify" },
      { key: "maintenance-dmc-weekly", label: "Maintenance Weekly" },
      { key: "maintenance-dmc-ng",     label: "DMC NG Point" },
    ]},
    { key: "maintenance-spare",          label: "Spare" },
    { key: "machine-master",             label: "Machine Master (writes are admin-only)" },
    // Document Update: KPI Targets / Slip Threshold / PM Check Sheet /
    // Machine DMC / Breakdown Mail.  Ye paanch pehle Maintenance Panel ke tab
    // the, isliye jinke paas "admin-maintenance" tha unhe ab ALAG se dena hoga.
    { key: "document-update",            label: "Document Update (KPI Targets · Slip Threshold · PM Check Sheet · Machine DMC · Breakdown Mail)" },
  ]},
  // Admin config panel.  Grant se sidebar me "Maintenance Panel" dikhega.
  // NOTE: iske andar "Users & Access" aur "Login History" HAMESHA admin-only
  // hain — grant milne par bhi non-admin ko user-management nahi dikhta.
  { group: "Admin Panel", items: [
    { key: "admin-maintenance", label: "Maintenance Panel (Users & Login History — admin-only)" },
  ]},
];

export const PERM_LEVELS = [
  { key: "none", label: "No Access",  bg: "#fee2e2", color: "#b91c1c" },
  { key: "read", label: "Read-only",  bg: "#fef3c7", color: "#a16207" },
  { key: "full", label: "Full CRUD",  bg: "#dcfce7", color: "#15803d" },
];



