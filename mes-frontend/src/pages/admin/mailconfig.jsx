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
export const ROLE_PILL = {
  admin:      { bg:"rgba(30,64,175,.10)",  fg:"#1e40af" },
  plant_head: { bg:"rgba(30,64,175,.10)",  fg:"#1e40af" },
  department: { bg:"rgba(220,38,38,.10)",  fg:"#dc2626" },
  production: { bg:"rgba(22,163,74,.10)",  fg:"#16a34a" },
  operator:   { bg:"rgba(124,58,237,.10)", fg:"#6d28d9" },
};

// Master list of pages admins can grant per-user permissions on.
// Grouped by area for the permission matrix modal.  page_key MUST
// match the canAccess() keys in AuthContext.jsx so explicit overrides
// resolve correctly.
export const PAGE_PERM_GROUPS = [
  { group: "Production", items: [
    { key: "dashboard",         label: "Production Dashboard" },
    { key: "historical",        label: "Historical Data" },
    { key: "import",            label: "Import / Export" },
    { key: "process-graphs",    label: "Process Graphs" },
    { key: "admin-production",  label: "Admin → Production Panel" },
  ]},
  { group: "Maintenance", items: [
    { key: "maintenance-dashboard",  label: "Maintenance Dashboard" },
    { key: "maintenance-historical", label: "Maintenance Historical Data" },
    { key: "maintenance-capa",       label: "Maintenance CAPA" },
    { key: "maintenance-deviations", label: "Maintenance Deviations" },
    { key: "maintenance-poka-yoke",  label: "Maintenance Poka Yoke" },
    { key: "maintenance-logbook",    label: "Maintenance Log Book" },
    { key: "maintenance-pm",         label: "Preventive Maintenance" },
    { key: "admin-maintenance",      label: "Admin → Maintenance Panel" },
  ]},
  { group: "Quality", items: [
    { key: "quality-dashboard",  label: "Quality Dashboard" },
    { key: "quality-deviations", label: "Quality Deviation" },
    { key: "admin-quality",      label: "Admin → Quality Panel" },
  ]},
  { group: "System", items: [
    { key: "department-panel",   label: "Department Panel" },
    { key: "settings",           label: "Settings" },
    { key: "audit",              label: "Audit Log" },
    { key: "admin",              label: "Admin Core (System Map / Departments / Users)" },
  ]},
];

export const PERM_LEVELS = [
  { key: "none", label: "No Access",  bg: "#fee2e2", color: "#b91c1c" },
  { key: "read", label: "Read-only",  bg: "#fef3c7", color: "#a16207" },
  { key: "full", label: "Full CRUD",  bg: "#dcfce7", color: "#15803d" },
];



