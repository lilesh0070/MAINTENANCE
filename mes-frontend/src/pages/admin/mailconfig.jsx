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
export const PAGE_PERM_GROUPS = [
  { group: "Maintenance — Pages", items: [
    { key: "dashboard",                  label: "Dashboard (home / landing)" },
    { key: "maintenance-overview",       label: "Overview" },
    { key: "andon-system",               label: "ANDON", children: [
      { key: "andon-board",   label: "Live Board" },
      { key: "andon-config",  label: "Configuration" },
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
      { key: "maintenance-breakdown-slip",     label: "Breakdown Slip" },
      { key: "maintenance-breakdown-history",  label: "BD History" },
      { key: "maintenance-breakdown-analysis", label: "BD Analysis" },
      { key: "maintenance-breakdown-pareto",   label: "Pareto Analysis" },
      { key: "maintenance-breakdown-top10",    label: "Top 10 BD" },
    ]},
    { key: "skill-training",             label: "Skill & Training", children: [
      { key: "skill-ojt",         label: "OJT" },
      { key: "skill-matrix",      label: "Skill Matrix" },
      { key: "skill-org-chart",   label: "Organisation Chart" },
      { key: "skill-upgradation", label: "Skill Upgradation Plan" },
    ]},
    { key: "maintenance-historical",     label: "Historical Data" },
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
    { key: "maintenance-machine-dmc",    label: "Machine DMC", children: [
      { key: "maintenance-daily-dmc",  label: "Operator DMC Fill" },
      { key: "maintenance-dmc-verify", label: "Supervisor Verify" },
      { key: "maintenance-dmc-weekly", label: "Maintenance Weekly" },
      { key: "maintenance-dmc-ng",     label: "DMC NG Point" },
    ]},
    { key: "maintenance-spare",          label: "Spare" },
  ]},
  // Admin config panel.  Grant se sidebar me "Maintenance Panel" dikhega
  // (KPI Targets / Slip Threshold / PM Check Sheet / Machine DMC config).
  // NOTE: iske andar "Users & Access" tab HAMESHA admin-only rehta hai —
  // grant milne par bhi non-admin ko user-management nahi dikhta.
  { group: "Admin Panel", items: [
    { key: "admin-maintenance", label: "Maintenance Panel (config — Users tab admin-only)" },
  ]},
];

export const PERM_LEVELS = [
  { key: "none", label: "No Access",  bg: "#fee2e2", color: "#b91c1c" },
  { key: "read", label: "Read-only",  bg: "#fef3c7", color: "#a16207" },
  { key: "full", label: "Full CRUD",  bg: "#dcfce7", color: "#15803d" },
];



