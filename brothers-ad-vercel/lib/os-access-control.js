const fs = require("fs");
const path = require("path");

const moduleDataPath = path.join(__dirname, "..", "module-data.js");

const systemRoles = {
  super_admin: {
    id: "super_admin",
    label: "Super Admin",
    rank: 100,
    system: true,
    description: "Full access to users, permissions, page editing, company settings, and audit controls."
  },
  business_owner: {
    id: "business_owner",
    label: "Business Owner",
    rank: 70,
    system: true,
    description: "Company-level access to reports, users, locations, and settings as allowed by Super Admin."
  },
  franchise_owner: {
    id: "franchise_owner",
    label: "Franchise Owner",
    rank: 50,
    system: true,
    description: "Franchise-scoped access to workers, jobs, tasks, reports, and settings."
  },
  contractor: {
    id: "contractor",
    label: "Contractor",
    rank: 30,
    system: true,
    description: "Contractor portal access to assigned jobs, contractor invoices, and the communication board."
  },
  worker: {
    id: "worker",
    label: "Worker",
    rank: 10,
    system: true,
    description: "Assigned task and field workflow access only."
  }
};

const systemPermissions = {
  super_admin: {
    tabs: { mode: "all", allowed: [], hidden: [] },
    pages: { mode: "all", allowed: [], hidden: [] },
    sections: { mode: "all", allowed: [], hidden: [] },
    actions: {
      manageUsers: true,
      removeUsers: true,
      changeRoles: true,
      disableAccounts: true,
      resetPermissions: true,
      manageRolePermissions: true,
      manageTabs: true,
      managePages: true,
      manageSections: true,
      manageButtons: true,
      uploadImages: true,
      editCompanySettings: true,
      editFranchiseSettings: true,
      viewCompanyReports: true,
      viewFranchiseReports: true,
      viewAuditLogs: true,
      viewCustomerDirectory: true,
      viewRevenueData: true,
      viewContractorInvoices: true,
      viewGlobalIndexes: true,
      manageAccessGrants: true,
      issueContractorCodes: true,
      postCommunityMessages: true,
      moderateCommunityMessages: true,
      editAssignedTasks: true,
      editAllTasks: true
    },
    dataAccess: {
      company: "all",
      franchises: "all",
      workers: "all",
      auditLogs: "all",
      customers: "all",
      revenue: "all",
      contractorInvoices: "all",
      globalIndexes: "all",
      community: "all"
    }
  },
  business_owner: {
    tabs: { mode: "allow", allowed: ["daily", "launchcenter", "contractorportal", "team", "jobs", "payments", "pricing", "accounting", "reports", "relationships", "branches", "insurance", "communications", "settings"], hidden: [] },
    pages: { mode: "allow", allowed: ["daily", "launchcenter", "contractorportal", "team", "jobs", "payments", "pricing", "accounting", "reports", "relationships", "branches", "insurance", "communications", "settings"], hidden: [] },
    sections: { mode: "all", allowed: [], hidden: [] },
    actions: {
      manageUsers: true,
      removeUsers: false,
      changeRoles: true,
      disableAccounts: true,
      resetPermissions: false,
      manageRolePermissions: false,
      manageTabs: false,
      managePages: false,
      manageSections: false,
      manageButtons: false,
      uploadImages: false,
      editCompanySettings: true,
      editFranchiseSettings: true,
      viewCompanyReports: true,
      viewFranchiseReports: true,
      viewAuditLogs: true,
      viewCustomerDirectory: true,
      viewRevenueData: true,
      viewContractorInvoices: true,
      viewGlobalIndexes: false,
      manageAccessGrants: false,
      issueContractorCodes: false,
      postCommunityMessages: true,
      moderateCommunityMessages: true,
      editAssignedTasks: true,
      editAllTasks: true
    },
    dataAccess: {
      company: "assigned",
      franchises: "assigned",
      workers: "assigned",
      auditLogs: "assigned",
      customers: "assigned",
      revenue: "assigned",
      contractorInvoices: "assigned",
      globalIndexes: "none",
      community: "all"
    }
  },
  franchise_owner: {
    tabs: { mode: "allow", allowed: ["daily", "contractorportal", "jobs", "drylogs", "time", "equipment", "team", "payments", "reports", "relationships", "communications", "settings"], hidden: [] },
    pages: { mode: "allow", allowed: ["daily", "contractorportal", "jobs", "drylogs", "time", "equipment", "team", "payments", "reports", "relationships", "communications", "settings"], hidden: [] },
    sections: { mode: "all", allowed: [], hidden: [] },
    actions: {
      manageUsers: true,
      removeUsers: false,
      changeRoles: false,
      disableAccounts: false,
      resetPermissions: false,
      manageRolePermissions: false,
      manageTabs: false,
      managePages: false,
      manageSections: false,
      manageButtons: false,
      uploadImages: false,
      editCompanySettings: false,
      editFranchiseSettings: true,
      viewCompanyReports: false,
      viewFranchiseReports: true,
      viewAuditLogs: false,
      viewCustomerDirectory: true,
      viewRevenueData: true,
      viewContractorInvoices: true,
      viewGlobalIndexes: false,
      manageAccessGrants: false,
      issueContractorCodes: false,
      postCommunityMessages: true,
      moderateCommunityMessages: false,
      editAssignedTasks: true,
      editAllTasks: true
    },
    dataAccess: {
      company: "none",
      franchises: "assigned",
      workers: "assigned",
      auditLogs: "assigned",
      customers: "assigned",
      revenue: "assigned",
      contractorInvoices: "assigned",
      globalIndexes: "none",
      community: "all"
    }
  },
  contractor: {
    tabs: { mode: "allow", allowed: ["contractorportal", "daily", "jobs", "time", "equipment", "payments", "communications", "settings"], hidden: [] },
    pages: { mode: "allow", allowed: ["contractorportal", "daily", "jobs", "time", "equipment", "payments", "communications", "settings"], hidden: [] },
    sections: { mode: "allow", allowed: ["contractorportal-hero", "contractorportal-fast-actions", "contractorportal-work", "contractorportal-invoices", "contractorportal-board", "daily-hero", "daily-service-requests", "jobs-hero", "jobs-timeline", "time-hero", "time-clock", "time-entries", "equipment-hero", "equipment-list", "payments-hero", "payments-contractor-invoices", "communications-hero", "communications-board", "communications-composer"], hidden: [] },
    actions: {
      manageUsers: false,
      removeUsers: false,
      changeRoles: false,
      disableAccounts: false,
      resetPermissions: false,
      manageRolePermissions: false,
      manageTabs: false,
      managePages: false,
      manageSections: false,
      manageButtons: false,
      uploadImages: true,
      editCompanySettings: false,
      editFranchiseSettings: false,
      viewCompanyReports: false,
      viewFranchiseReports: false,
      viewAuditLogs: false,
      viewCustomerDirectory: false,
      viewRevenueData: false,
      viewContractorInvoices: true,
      viewGlobalIndexes: false,
      manageAccessGrants: false,
      issueContractorCodes: false,
      postCommunityMessages: true,
      moderateCommunityMessages: false,
      editAssignedTasks: true,
      editAllTasks: false
    },
    dataAccess: {
      company: "none",
      franchises: "assigned",
      workers: "self",
      auditLogs: "none",
      customers: "assigned",
      revenue: "none",
      contractorInvoices: "self",
      globalIndexes: "none",
      community: "all"
    }
  },
  worker: {
    tabs: { mode: "allow", allowed: ["time", "jobs", "drylogs", "equipment", "photos", "forms", "communications"], hidden: [] },
    pages: { mode: "allow", allowed: ["time", "jobs", "drylogs", "equipment", "photos", "forms", "communications"], hidden: [] },
    sections: { mode: "allow", allowed: ["time-hero", "time-entries", "jobs-hero", "drylogs-hero", "equipment-hero"], hidden: [] },
    actions: {
      manageUsers: false,
      removeUsers: false,
      changeRoles: false,
      disableAccounts: false,
      resetPermissions: false,
      manageRolePermissions: false,
      manageTabs: false,
      managePages: false,
      manageSections: false,
      manageButtons: false,
      uploadImages: true,
      editCompanySettings: false,
      editFranchiseSettings: false,
      viewCompanyReports: false,
      viewFranchiseReports: false,
      viewAuditLogs: false,
      viewCustomerDirectory: false,
      viewRevenueData: false,
      viewContractorInvoices: false,
      viewGlobalIndexes: false,
      manageAccessGrants: false,
      issueContractorCodes: false,
      postCommunityMessages: true,
      moderateCommunityMessages: false,
      editAssignedTasks: true,
      editAllTasks: false
    },
    dataAccess: {
      company: "none",
      franchises: "assigned",
      workers: "self",
      auditLogs: "self",
      customers: "none",
      revenue: "none",
      contractorInvoices: "none",
      globalIndexes: "none",
      community: "all"
    }
  }
};

const sectionTemplates = {
  daily: [
    ["daily-hero", "Daily dashboard hero"],
    ["daily-dashboard-grid", "Daily KPI grid"],
    ["daily-module-directory", "Task-type module directory"],
    ["daily-service-requests", "Service requests"],
    ["daily-action-dashboard", "Action dashboard"],
    ["daily-investor-panel", "Institutional review"],
    ["daily-skills-vaults", "Skills and databases"],
    ["daily-import-launcher", "Invoice import launcher"],
    ["daily-industry-plan", "Industry plan"],
    ["daily-performance", "Performance tracker"]
  ],
  team: [
    ["team-hero", "Team hero"],
    ["team-access-panel", "Access model"],
    ["team-logins", "User management"],
    ["team-tasks", "Task assignment"]
  ],
  accessadmin: [
    ["accessadmin-hero", "Admin access hero"],
    ["accessadmin-status", "Login and access status"],
    ["accessadmin-module-map", "Module visibility map"],
    ["accessadmin-rbac", "User, role, and contractor code controls"]
  ],
  launchcenter: [
    ["launchcenter-hero", "Launch Center hero"],
    ["launchcenter-readiness", "brothers.ad readiness board"],
    ["launchcenter-steps", "Production launch sequence"],
    ["launchcenter-auth-status", "Firebase and Google login status"]
  ],
  contractorportal: [
    ["contractorportal-hero", "Contractor portal hero"],
    ["contractorportal-fast-actions", "Fast action dock"],
    ["contractorportal-work", "Assigned work and documentation"],
    ["contractorportal-invoices", "Contractor invoice status"],
    ["contractorportal-board", "Contractor communication board"]
  ],
  globalindexes: [
    ["globalindexes-hero", "Global indexes hero"],
    ["globalindexes-skills", "Skill packs and data vaults"],
    ["globalindexes-sources", "Hard-source index"]
  ],
  insurance: [
    ["insurance-hero", "Insurance hero"],
    ["insurance-signin", "Insurance access"],
    ["insurance-submissions", "Insurance submissions"],
    ["insurance-detail", "Insurance submission detail"]
  ],
  jobs: [
    ["jobs-hero", "Jobs hero"],
    ["jobs-timeline", "Job timeline"],
    ["jobs-form", "Job intake form"],
    ["jobs-gates", "Job gate tracker"]
  ],
  drylogs: [
    ["drylogs-hero", "Dry logs hero"],
    ["drylogs-jobs", "Dry log jobs"],
    ["drylogs-form", "Dry log form"],
    ["drylogs-table", "Dry log table"]
  ],
  time: [
    ["time-hero", "Time hero"],
    ["time-clock", "Clock controls"],
    ["time-entries", "Time entries"]
  ],
  equipment: [
    ["equipment-hero", "Equipment hero"],
    ["equipment-map", "Equipment map"],
    ["equipment-form", "Equipment form"],
    ["equipment-list", "Equipment deployments"]
  ],
  payments: [
    ["payments-hero", "Payments hero"],
    ["payments-rails", "Payment rails"],
    ["payments-revenue", "Revenue invoices"],
    ["payments-contractor-invoices", "Contractor invoices"]
  ],
  communications: [
    ["communications-hero", "Communication board hero"],
    ["communications-board", "Contractor discussion board"],
    ["communications-composer", "Post composer"]
  ]
};

function parseModuleDefinitions() {
  const raw = fs.readFileSync(moduleDataPath, "utf8");
  const match = raw.match(/window\.BROTHERS_MODULES\s*=\s*(\[[\s\S]*\]);?\s*$/);
  if (!match) {
    throw new Error("Unable to parse module-data.js for default tab/page seeds.");
  }
  return JSON.parse(match[1]);
}

function buildSeedTabsPagesSections() {
  const modules = parseModuleDefinitions();
  const tabs = modules.map((module, index) => ({
    id: module.key,
    key: module.key,
    pageId: module.key,
    moduleKey: module.key,
    label: module.label,
    category: module.category,
    purpose: module.purpose,
    visible: true,
    order: index,
    updatedAt: new Date().toISOString()
  }));

  const pages = modules.map((module, index) => ({
    id: module.key,
    tabId: module.key,
    routeKey: module.key,
    moduleKey: module.key,
    title: module.label,
    purpose: module.purpose,
    visible: true,
    order: index,
    updatedAt: new Date().toISOString()
  }));

  const sections = [];
  modules.forEach((module) => {
    const template = sectionTemplates[module.key] || [
      [`${module.key}-hero`, `${module.label} hero`],
      [`${module.key}-content`, `${module.label} content`]
    ];
    template.forEach(([id, title], index) => {
      sections.push({
        id,
        pageId: module.key,
        moduleKey: module.key,
        title,
        visible: true,
        order: index,
        content: {
          heading: title,
          body: module.purpose,
          buttons: []
        },
        imageUrl: "",
        updatedAt: new Date().toISOString()
      });
    });
  });

  return { modules, tabs, pages, sections };
}

function getDefaultCompanySettings() {
  return {
    id: "default",
    brandName: "Brothers OS",
    brandLogoUrl: "/assets/brothers-logo.png",
    editModeEnabled: true,
    allowUserSelfService: false,
    trialAccessTtlHours: 48,
    updatedAt: new Date().toISOString()
  };
}

function getDefaultFranchiseSettings() {
  return {
    id: "default-franchise",
    displayName: "Default Franchise",
    visible: true,
    updatedAt: new Date().toISOString()
  };
}

function getDefaultBusinessRecords() {
  const now = new Date().toISOString();
  return [
    {
      id: "customer-demo-oak-avenue",
      type: "customer",
      customerId: "CUST-1001",
      name: "Oak Avenue Homeowner",
      email: "owner@example.com",
      phone: "(412) 555-0198",
      companyId: "default-company",
      franchiseId: "default-franchise",
      contractorId: "contractor-demo",
      revenueTotal: 18450,
      openBalance: 4250,
      status: "Active",
      updatedAt: now
    },
    {
      id: "revenue-invoice-demo-oak",
      type: "revenueInvoice",
      invoiceId: "INV-2039",
      customerId: "CUST-1001",
      customerName: "Oak Avenue Homeowner",
      jobId: "J-2039",
      amount: 18450,
      balance: 4250,
      status: "Partially paid",
      dueDate: "2026-06-15",
      companyId: "default-company",
      franchiseId: "default-franchise",
      contractorId: "contractor-demo",
      updatedAt: now
    },
    {
      id: "contractor-invoice-demo-dryout",
      type: "contractorInvoice",
      invoiceId: "CON-7781",
      contractorId: "contractor-demo",
      contractorEmail: "contractor@example.com",
      contractorName: "Demo Dryout Contractor",
      jobId: "J-2039",
      amount: 3200,
      status: "Ready for review",
      dueDate: "2026-06-20",
      companyId: "default-company",
      franchiseId: "default-franchise",
      updatedAt: now
    }
  ];
}

function deepMerge(base, overrides) {
  if (!overrides || typeof overrides !== "object") return JSON.parse(JSON.stringify(base));
  const next = Array.isArray(base) ? [...base] : { ...base };
  Object.entries(overrides).forEach(([key, value]) => {
    if (value && typeof value === "object" && !Array.isArray(value) && next[key] && typeof next[key] === "object" && !Array.isArray(next[key])) {
      next[key] = deepMerge(next[key], value);
      return;
    }
    next[key] = value;
  });
  return next;
}

function normalizeUserRecord(uid, authUser, data = {}) {
  return {
    id: uid,
    uid,
    email: authUser?.email || data.email || "",
    displayName: authUser?.displayName || data.displayName || data.email || "",
    roleId: data.roleId || "worker",
    disabled: Boolean(authUser?.disabled || data.disabled),
    companyId: data.companyId || "default-company",
    franchiseIds: Array.isArray(data.franchiseIds) ? data.franchiseIds : [],
    contractorId: data.contractorId || "",
    accessGrantId: data.accessGrantId || "",
    accessCodeId: data.accessCodeId || "",
    accessExpiresAt: data.accessExpiresAt || "",
    accessScope: data.accessScope || "",
    portalCodeHash: data.portalCodeHash || "",
    assignedTaskIds: Array.isArray(data.assignedTaskIds) ? data.assignedTaskIds : [],
    permissionsOverride: data.permissionsOverride && typeof data.permissionsOverride === "object" ? data.permissionsOverride : {},
    visibleTabIds: Array.isArray(data.visibleTabIds) ? data.visibleTabIds : [],
    visiblePageIds: Array.isArray(data.visiblePageIds) ? data.visiblePageIds : [],
    sectionOverrides: data.sectionOverrides && typeof data.sectionOverrides === "object" ? data.sectionOverrides : {},
    status: data.status || (authUser?.disabled ? "disabled" : "active"),
    createdAt: data.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function getSystemRoles() {
  return Object.values(systemRoles);
}

function getSystemPermissions() {
  return systemPermissions;
}

function buildEffectivePermissions(roleId, overrides = {}) {
  return deepMerge(systemPermissions[roleId] || systemPermissions.worker, overrides);
}

function filterCollectionByPermission(items, permissionSet, permissionKey, idKey = "id") {
  const config = permissionSet[permissionKey];
  if (!config || config.mode === "all") {
    return items.filter((item) => !config?.hidden?.includes(item[idKey]));
  }
  const allowed = new Set(config.allowed || []);
  const hidden = new Set(config.hidden || []);
  return items.filter((item) => allowed.has(item[idKey]) && !hidden.has(item[idKey]));
}

module.exports = {
  buildEffectivePermissions,
  buildSeedTabsPagesSections,
  filterCollectionByPermission,
  getDefaultBusinessRecords,
  getDefaultCompanySettings,
  getDefaultFranchiseSettings,
  getSystemPermissions,
  getSystemRoles,
  normalizeUserRecord,
  parseModuleDefinitions,
  systemRoles
};
