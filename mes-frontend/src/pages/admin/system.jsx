/* admin/system.jsx — Admin Panel ka tab-dhancha.

   ADMIN_SECTIONS: Maintenance (KPI Targets · PM Check Sheet · Machine DMC)
                   + Admin (Users)
   AdminPanel.jsx aur DepartmentPanel dono isi list se tab banate hain. */
import { useState, useEffect, useRef, useCallback, useMemo, Fragment } from "react";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../api/client";
import {
  PageHeading, Card, Pill, Btn, FF, Input, Select,
  Modal, ModalActions, Toast, EmptyState, Spinner, ExcelImportButton,
} from "./ui";


export const ADMIN_SECTIONS = [
  {
    key: "maintenance", label: "Maintenance", color: "#dc2626",
    tabs: [
      { key: "kpitarget",  label: "KPI Targets",      icon: "🎯" },
      { key: "pmchecksheet", label: "PM Check Sheet", icon: "📋" },
      { key: "machinedmc",   label: "Machine DMC",    icon: "🏷" },
    ],
  },
  {
    key: "admin", label: "Admin", color: "#1e40af",
    tabs: [
      { key: "users",       label: "Users",        icon: "👥" },
    ],
  },
];
