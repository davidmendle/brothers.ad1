const applicationContractVersion = 1;

const brothersApplications = [
  {
    id: "command-governance",
    label: "Command and Governance",
    description: "Owner control plane for security, access, configuration, branches, integrations, and global oversight.",
    dataNamespace: "applications/command-governance",
    defaultModuleKey: "daily",
    moduleKeys: [
      "daily", "accessadmin", "launchcenter", "globalindexes", "settings",
      "securitycenter", "auditlog", "datamodel", "sessiondevices", "trustsafety",
      "branches", "moduletoggles", "featuregates", "setupwizard", "integrations"
    ],
    capabilities: ["tenant administration", "identity and access", "global indexes", "configuration"],
    connections: [
      { applicationId: "general-contracting", events: ["application.enabled", "policy.changed"] },
      { applicationId: "restoration-claims", events: ["policy.changed", "global-index.requested"] },
      { applicationId: "finance-and-reporting", events: ["global-index.requested", "subscription.changed"] },
      { applicationId: "workforce", events: ["access.changed", "policy.changed"] },
      { applicationId: "contractor-network", events: ["access.changed", "policy.changed"] },
      { applicationId: "property-and-crm", events: ["policy.changed", "global-index.requested"] },
      { applicationId: "communications-intelligence", events: ["policy.changed", "risk.signal-raised"] }
    ]
  },
  {
    id: "general-contracting",
    label: "General Contracting",
    description: "Reusable operating application for jobs, work orders, dispatch, crews, field evidence, closeout, and warranty service.",
    dataNamespace: "applications/general-contracting",
    defaultModuleKey: "jobs",
    moduleKeys: [
      "jobs", "workorders", "dispatch", "routeplanner", "fieldmobile", "time",
      "equipment", "photos", "sketch", "forms", "closeout", "warranty",
      "maintenance", "notifications", "nextaction"
    ],
    capabilities: ["job execution", "field operations", "crew dispatch", "closeout"],
    connections: [
      { applicationId: "workforce", events: ["task.assigned", "time.logged", "evidence.uploaded"] },
      { applicationId: "restoration-claims", events: ["loss.documented", "scope.measured", "job.ready-for-estimate"] },
      { applicationId: "finance-and-reporting", events: ["job.billable", "work.completed"] },
      { applicationId: "contractor-network", events: ["contractor.assigned", "contractor.invoice-submitted"] }
    ]
  },
  {
    id: "restoration-claims",
    label: "Restoration and Claims",
    description: "Restoration-specific intake, drying, estimating, supplements, evidence, standards, and claim defensibility.",
    dataNamespace: "applications/restoration-claims",
    defaultModuleKey: "insurance",
    moduleKeys: [
      "universalintake", "insurance", "drylogs", "pricing", "defensibility",
      "supplement", "revenueengine", "proofvalue", "justification", "evidencechain",
      "nationalcodes", "safetyintel", "compliance", "reviews"
    ],
    capabilities: ["claim intake", "drying documentation", "estimating", "supplements", "defensibility"],
    connections: [
      { applicationId: "general-contracting", events: ["claim.accepted", "scope.approved"] },
      { applicationId: "finance-and-reporting", events: ["estimate.approved", "supplement.approved"] },
      { applicationId: "property-and-crm", events: ["claim-property.linked", "customer.updated"] },
      { applicationId: "communications-intelligence", events: ["review.requested", "source-check.requested"] }
    ]
  },
  {
    id: "finance-and-reporting",
    label: "Finance and Reporting",
    description: "Revenue, contractor payables, accounting handoff, subscription billing, and business performance reporting.",
    dataNamespace: "applications/finance-and-reporting",
    defaultModuleKey: "payments",
    moduleKeys: ["payments", "accounting", "reports", "businesshealth", "subscriptionbilling"],
    capabilities: ["customer invoices", "contractor invoices", "accounting", "portfolio reporting"],
    connections: [
      { applicationId: "general-contracting", events: ["invoice.issued", "payment.received"] },
      { applicationId: "restoration-claims", events: ["receivable.updated", "claim-payment.received"] },
      { applicationId: "command-governance", events: ["global-metric.updated"] }
    ]
  },
  {
    id: "workforce",
    label: "Workforce",
    description: "Employee and contractor-team profiles, onboarding, training, certifications, SOPs, and assignment readiness.",
    dataNamespace: "applications/workforce",
    defaultModuleKey: "team",
    moduleKeys: ["team", "training", "sops", "certbadge"],
    capabilities: ["employee profiles", "onboarding", "training", "certification"],
    connections: [
      { applicationId: "general-contracting", events: ["worker.activated", "worker.assignment-changed"] },
      { applicationId: "contractor-network", events: ["contractor.employee-added", "credential.updated"] },
      { applicationId: "communications-intelligence", events: ["worker-message.posted", "training-question.asked"] }
    ]
  },
  {
    id: "contractor-network",
    label: "Contractor Network",
    description: "Contractor portals, vendor qualification, contracts, licensing, partner performance, and contractor billing readiness.",
    dataNamespace: "applications/contractor-network",
    defaultModuleKey: "contractorportal",
    moduleKeys: ["contractorportal", "vendors", "marketplace", "partnerscore", "contracts", "liens", "licensing"],
    capabilities: ["contractor portal", "vendor qualification", "contracts", "licensing"],
    connections: [
      { applicationId: "workforce", events: ["employee.invited", "employee.access-changed"] },
      { applicationId: "general-contracting", events: ["contractor.available", "work.accepted"] },
      { applicationId: "finance-and-reporting", events: ["contractor.invoice-ready"] }
    ]
  },
  {
    id: "property-and-crm",
    label: "Property and CRM",
    description: "Leads, customers, properties, relationships, service territories, maps, and campaign attribution.",
    dataNamespace: "applications/property-and-crm",
    defaultModuleKey: "relationships",
    moduleKeys: ["relationships", "properties", "maps", "leads", "campaigns"],
    capabilities: ["lead management", "customer records", "property records", "territory intelligence"],
    connections: [
      { applicationId: "general-contracting", events: ["lead.converted", "service-request.accepted"] },
      { applicationId: "finance-and-reporting", events: ["customer.created", "property-account.updated"] }
    ]
  },
  {
    id: "communications-intelligence",
    label: "Communications and Intelligence",
    description: "Contractor discussions, email workflows, AI review, operating plans, and cross-application decision support.",
    dataNamespace: "applications/communications-intelligence",
    defaultModuleKey: "communications",
    moduleKeys: ["communications", "email", "aicopilots", "aireview", "planmatrix"],
    capabilities: ["discussion board", "email coordination", "AI review", "decision support"],
    connections: [
      { applicationId: "general-contracting", events: ["job-message.posted", "field-question.answered"] },
      { applicationId: "restoration-claims", events: ["claim-review.completed", "source-check.completed"] },
      { applicationId: "command-governance", events: ["risk.signal-raised"] }
    ]
  }
];

const applicationById = new Map();
const applicationIdByModuleKey = new Map();

brothersApplications.forEach((application) => {
  if (applicationById.has(application.id)) {
    throw new Error(`Duplicate Brothers OS application ID: ${application.id}`);
  }
  applicationById.set(application.id, application);
  application.moduleKeys.forEach((moduleKey) => {
    if (applicationIdByModuleKey.has(moduleKey)) {
      throw new Error(`Brothers OS module ${moduleKey} belongs to more than one application.`);
    }
    applicationIdByModuleKey.set(moduleKey, application.id);
  });
});

function normalizeIdList(value) {
  const values = Array.isArray(value) ? value : String(value || "").split(",");
  return [...new Set(values.map((item) => String(item || "").trim()).filter(Boolean))];
}

const workspaceFileSourceModules = Object.freeze({
  branch: "branches",
  contact: "relationships",
  contractorinvoice: "payments",
  defensibilityreview: "defensibility",
  drylog: "drylogs",
  drylogpacket: "drylogs",
  employeeticketsignoff: "time",
  equipmentdeployment: "equipment",
  equipmentinvoice: "payments",
  estimateinvoice: "payments",
  floorplan: "sketch",
  institutionalreview: "daily",
  job: "jobs",
  jobnote: "jobs",
  jobpacket: "jobs",
  pastedpriceimport: "pricing",
  paymentrail: "payments",
  paymentrequest: "payments",
  photoevidence: "photos",
  pricecsvimport: "pricing",
  priceitem: "pricing",
  quickbookssetup: "accounting",
  samplepriceimport: "pricing",
  servicerequest: "universalintake",
  sketchroom: "sketch",
  supplementpacket: "supplement",
  teammember: "team",
  timeentry: "time",
  xactimateimport: "pricing"
});

function resolveWorkspaceFilePrimaryModule(record = {}) {
  const sourceType = String(record.sourceType || "").trim().toLowerCase();
  if (["modulerecord", "standardsoutput"].includes(sourceType)) {
    return String(record.moduleKey || "").trim();
  }
  if (sourceType === "taskassignment") {
    return String(record.taskModuleKey || "jobs").trim();
  }
  const sourceModule = workspaceFileSourceModules[sourceType] || "";
  if (sourceModule) return sourceModule;
  if ([record.relatedJob, record.jobId, record.job].some((value) => String(value || "").trim())) {
    return "jobs";
  }
  return String(record.moduleKey || "").trim();
}

function getApplications() {
  return brothersApplications.map((application) => ({
    ...application,
    moduleKeys: [...application.moduleKeys],
    capabilities: [...application.capabilities],
    connections: application.connections.map((connection) => ({
      ...connection,
      events: [...connection.events]
    }))
  }));
}

function getApplicationById(applicationId) {
  return applicationById.get(String(applicationId || "").trim()) || null;
}

function getApplicationForModule(moduleKey) {
  return getApplicationById(applicationIdByModuleKey.get(String(moduleKey || "").trim()));
}

function getApplicationIdsForModuleKeys(moduleKeys) {
  return [...new Set(normalizeIdList(moduleKeys)
    .map((moduleKey) => applicationIdByModuleKey.get(moduleKey))
    .filter(Boolean))];
}

function getModuleKeysForApplicationIds(applicationIds) {
  return [...new Set(normalizeIdList(applicationIds)
    .flatMap((applicationId) => getApplicationById(applicationId)?.moduleKeys || []))];
}

function areApplicationsConnected(sourceApplicationId, targetApplicationId) {
  const sourceId = String(sourceApplicationId || "").trim();
  const targetId = String(targetApplicationId || "").trim();
  if (!sourceId || !targetId) return false;
  if (sourceId === targetId) return true;
  const source = getApplicationById(sourceId);
  const target = getApplicationById(targetId);
  return Boolean(source?.connections.some((connection) => connection.applicationId === targetId)
    || target?.connections.some((connection) => connection.applicationId === sourceId));
}

function summarizeApplicationAccess(moduleKeys, options = {}) {
  const selectedModules = new Set(normalizeIdList(moduleKeys));
  const includeEmpty = options.includeEmpty === true;
  return brothersApplications
    .map((application) => {
      const allowedModuleKeys = application.moduleKeys.filter((moduleKey) => selectedModules.has(moduleKey));
      return {
        applicationId: application.id,
        label: application.label,
        mode: allowedModuleKeys.length === application.moduleKeys.length ? "full" : "partial",
        allowedModuleKeys,
        moduleCount: application.moduleKeys.length
      };
    })
    .filter((entry) => includeEmpty || entry.allowedModuleKeys.length);
}

function validateApplicationRegistry(moduleDefinitions = []) {
  const errors = [];
  const knownModuleKeys = new Set((Array.isArray(moduleDefinitions) ? moduleDefinitions : [])
    .map((moduleDefinition) => String(moduleDefinition?.key || "").trim())
    .filter(Boolean));
  if (knownModuleKeys.size) {
    knownModuleKeys.forEach((moduleKey) => {
      if (!applicationIdByModuleKey.has(moduleKey)) errors.push(`Module ${moduleKey} has no application owner.`);
    });
    applicationIdByModuleKey.forEach((_applicationId, moduleKey) => {
      if (!knownModuleKeys.has(moduleKey)) errors.push(`Application registry references unknown module ${moduleKey}.`);
    });
  }
  brothersApplications.forEach((application) => {
    if (!application.moduleKeys.includes(application.defaultModuleKey)) {
      errors.push(`Application ${application.id} default module is not owned by that application.`);
    }
    application.connections.forEach((connection) => {
      if (!applicationById.has(connection.applicationId)) {
        errors.push(`Application ${application.id} connects to unknown application ${connection.applicationId}.`);
      }
    });
  });
  return {
    ok: errors.length === 0,
    errors,
    applicationCount: brothersApplications.length,
    moduleCount: applicationIdByModuleKey.size,
    contractVersion: applicationContractVersion
  };
}

const browserRegistry = {
  contractVersion: applicationContractVersion,
  areApplicationsConnected,
  getApplicationById,
  getApplicationForModule,
  getApplicationIdsForModuleKeys,
  getModuleKeysForApplicationIds,
  resolveWorkspaceFilePrimaryModule,
  summarizeApplicationAccess,
  validateApplicationRegistry
};

if (typeof window !== "undefined") {
  window.BROTHERS_APPLICATIONS = getApplications();
  window.BROTHERS_APPLICATION_REGISTRY = browserRegistry;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    ...browserRegistry,
    getApplications
  };
}
