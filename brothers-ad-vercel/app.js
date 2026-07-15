import {
  addClientCommunityComment,
  createClientAccessGrant,
  createClientAccessRequest,
  createClientCommunityPost,
  fetchClientBusinessRecords,
  fetchClientCommunityPosts,
  fetchOsSession,
  loadFirebaseConfig,
  loginWithFirebaseGoogle,
  loginWithFirebasePassword,
  logoutFirebaseSession
} from "./firebase-client.js";
import { brothersLogoDataUrl } from "./logo-data.js";
import { normalizeSectionButtonUrl } from "./ui-security.js";

const modules = Array.isArray(window.BROTHERS_MODULES) ? window.BROTHERS_MODULES : [];
const storageKey = "brothers-os-workspace-v2";
const workerAccessCode = "BROS-TIME";
const adminAccessCode = "Issued by Super Admin";
const employeeAllowedModuleKeys = ["time", "drylogs", "jobs", "photos", "equipment", "communications"];
const brandLogoPath = brothersLogoDataUrl;
const insuranceStatuses = ["all", "new", "reviewed", "in-progress", "completed", "rejected"];
const rbacActionKeys = [
  "manageUsers",
  "removeUsers",
  "changeRoles",
  "disableAccounts",
  "resetPermissions",
  "manageRolePermissions",
  "manageTabs",
  "managePages",
  "manageSections",
  "manageButtons",
  "uploadImages",
  "editCompanySettings",
  "editFranchiseSettings",
  "viewCompanyReports",
  "viewFranchiseReports",
  "viewAuditLogs",
  "viewCustomerDirectory",
  "viewRevenueData",
  "viewContractorInvoices",
  "viewGlobalIndexes",
  "manageAccessGrants",
  "issueContractorCodes",
  "postCommunityMessages",
  "moderateCommunityMessages",
  "editAssignedTasks",
  "editAllTasks"
];

const app = document.getElementById("app");
const today = new Date();

const categoryLabels = {
  ai: "AI",
  automation: "Automation",
  branch: "Branch",
  compliance: "Compliance",
  core: "Core",
  dispatch: "Dispatch",
  documents: "Documents",
  field: "Field",
  finance: "Finance",
  jobs: "Jobs",
  legal: "Legal",
  licensing: "Licensing",
  marketing: "Marketing",
  platform: "Platform",
  property: "Property",
  real_estate: "Real estate",
  reports: "Reports",
  revenue: "Revenue",
  security: "Security",
  strategy: "Strategy",
  training: "Training",
  vendors: "Vendors"
};

const taskTypeGroups = [
  {
    id: "command",
    label: "Command, Access, and Admin",
    description: "Owner-only controls, launch status, security, user access, and global visibility.",
    categories: ["core", "security", "platform"],
    keys: ["daily", "launchcenter", "accessadmin", "globalindexes", "settings", "securitycenter", "auditlog", "datamodel", "sessiondevices", "trustsafety"]
  },
  {
    id: "jobs-field",
    label: "Jobs, Field, and Dispatch",
    description: "Intake, job tracking, drying, routes, equipment, photos, properties, and field execution.",
    categories: ["jobs", "field", "dispatch", "property"],
    keys: ["universalintake", "insurance", "jobs", "workorders", "dispatch", "routeplanner", "drylogs", "time", "equipment", "photos", "fieldmobile", "properties", "sketch"]
  },
  {
    id: "money",
    label: "Money, Pricing, and Invoices",
    description: "Pricing, supplements, revenue files, payments, accounting, and proof of value.",
    categories: ["revenue", "finance"],
    keys: ["pricing", "supplement", "revenueengine", "justification", "evidencechain", "payments", "accounting", "proofvalue"]
  },
  {
    id: "people",
    label: "People, Contractors, and Board",
    description: "Team access, contractor portals, internal posts, vendors, training, contracts, and liens.",
    categories: ["training", "vendors", "legal"],
    keys: ["team", "contractorportal", "communications", "vendors", "marketplace", "partnerscore", "training", "sops", "certbadge", "contracts", "liens"]
  },
  {
    id: "compliance",
    label: "Compliance, Documents, and Closeout",
    description: "Defensibility, standards, code checks, forms, closeout, reviews, safety, and warranty.",
    categories: ["compliance", "documents"],
    keys: ["defensibility", "compliance", "nationalcodes", "safetyintel", "forms", "closeout", "reviews", "warranty"]
  },
  {
    id: "growth",
    label: "Growth, Reports, and Strategy",
    description: "Business health, licensing, subscriptions, branches, AI review, reports, and integrations.",
    categories: ["reports", "strategy", "marketing", "ai", "branch"],
    keys: ["reports", "businesshealth", "licensing", "subscriptionbilling", "featuregates", "planmatrix", "setupwizard", "leads", "campaigns", "aicopilots", "aireview", "branches", "moduletoggles", "integrations"]
  }
];

const basePinnedKeys = ["daily", "contractorportal", "accessadmin", "launchcenter", "globalindexes", "team", "communications", "payments", "accounting", "insurance", "sketch", "drylogs", "jobs", "pricing", "defensibility", "supplement", "compliance", "aicopilots", "time", "dispatch", "reports"];

const industryProfiles = {
  restoration: {
    label: "Restoration",
    keys: ["daily", "team", "sketch", "drylogs", "jobs", "pricing", "defensibility", "supplement", "compliance", "equipment", "time", "dispatch", "reports"]
  },
  property: {
    label: "Property management",
    keys: ["daily", "team", "properties", "relationships", "workorders", "approvals", "payments", "maintenance", "vendors", "reports", "settings"]
  },
  specialty: {
    label: "Specialty trade",
    keys: ["daily", "team", "universalintake", "jobs", "drylogs", "pricing", "dispatch", "time", "payments", "vendors", "reports", "settings"]
  },
  general: {
    label: "General contractor",
    keys: ["daily", "team", "jobs", "drylogs", "contracts", "pricing", "defensibility", "supplement", "vendors", "payments", "reports", "settings"]
  },
  handyman: {
    label: "Handyman / self-employed",
    keys: ["daily", "team", "universalintake", "jobs", "pricing", "payments", "time", "reports", "settings"]
  }
};

const standardsSources = [
  {
    id: "iicrc",
    name: "IICRC / ANSI restoration standards",
    authority: "IICRC, ANSI-accredited standards developer",
    url: "https://iicrc.gilmoreglobal.com/en",
    access: "Licensed webstore or subscription",
    freshness: "Check standard edition, reaffirmation, revision, or withdrawal before relying on it.",
    scope: "ANSI/IICRC S100, S220, S300, S400, S410, S500, S520, S540, S590, S700, S800, S900 and field guides.",
    topics: ["water", "mold", "fire", "restoration", "cleaning", "containment", "drying", "remediation", "inspection"],
    integration: "Connector stores licensed metadata, section pointers, edition, and short permitted excerpts only when the business has rights."
  },
  {
    id: "ansi-ibr",
    name: "ANSI Incorporated by Reference portal",
    authority: "ANSI IBR portal",
    url: "https://ibr.ansi.org/",
    access: "Read-only access for standards incorporated by reference in the CFR",
    freshness: "Use as a discovery and verification layer for IBR-ed standards.",
    scope: "Federally referenced SDO standards including ICC, NFPA, ASHRAE, IAPMO, AISC, AWWA, ULSE, and others where hosted.",
    topics: ["ansi", "incorporated", "reference", "federal", "cfr", "standard", "read only"],
    integration: "Connector records source URL, SDO, designation, IBR status, and access restrictions without bulk copying copyrighted text."
  },
  {
    id: "ansi-webstore",
    name: "ANSI Webstore / Standards Connect",
    authority: "ANSI Webstore",
    url: "https://webstore.ansi.org/",
    access: "Purchased individual standards or multi-user Standards Connect subscriptions",
    freshness: "Use alerts/subscription data to flag replaced, revised, or withdrawn standards.",
    scope: "Large standards catalog and subscription access for standards packages and publisher content.",
    topics: ["ansi", "standard", "subscription", "license", "catalog", "package"],
    integration: "Connector keeps license seat, publisher, edition, update alert, and permitted citation metadata."
  },
  {
    id: "osha-standards",
    name: "OSHA regulations and standards",
    authority: "U.S. Department of Labor OSHA",
    url: "https://www.osha.gov/laws-regs/regulations/standardnumber/",
    access: "Public OSHA standards search",
    freshness: "Check OSHA page and effective date before external use.",
    scope: "29 CFR Parts 1904, 1910, 1915, 1917, 1918, 1926, 1928, state plan references, and related enforcement material.",
    topics: ["osha", "safety", "1926", "1910", "ppe", "respiratory", "fall", "hazard", "lead", "asbestos", "silica"],
    integration: "Connector indexes standard number, subpart, title, effective date, topic, and OSHA URL."
  },
  {
    id: "osha-interpretations",
    name: "OSHA interpretation letters",
    authority: "U.S. Department of Labor OSHA",
    url: "https://www.osha.gov/laws-regs/interpretations",
    access: "Public interpretation letters",
    freshness: "Interpretations can be affected by rule changes and may not apply to every state plan.",
    scope: "Official OSHA interpretation letters tied to standard numbers and specific fact patterns.",
    topics: ["osha", "interpretation", "letter", "enforcement", "guidance", "state plan"],
    integration: "Connector links standard number, date, fact pattern, and limitation note for legal review."
  },
  {
    id: "ecfr-title29",
    name: "eCFR Title 29",
    authority: "Electronic Code of Federal Regulations",
    url: "https://www.ecfr.gov/current/title-29",
    access: "Public current eCFR",
    freshness: "eCFR is continuously updated; verify display date and amendment history.",
    scope: "Current Title 29 labor regulations, including OSHA 1910 and 1926 text.",
    topics: ["ecfr", "title 29", "cfr", "1910", "1926", "regulation", "federal"],
    integration: "Connector records CFR citation, current display date, amendment date, and section permalink."
  },
  {
    id: "icc-digital-codes",
    name: "ICC Digital Codes",
    authority: "International Code Council",
    url: "https://codes.iccsafe.org/?site_type=public",
    access: "Public and premium digital code platform",
    freshness: "Verify model-code year, local adoption, amendments, errata, and subscription terms.",
    scope: "IBC, IRC, IFC, IMC, IPC, IECC, existing building, fuel gas, accessibility, and adopted code publications.",
    topics: ["ibc", "irc", "icc", "building", "fire", "mechanical", "plumbing", "energy", "existing"],
    integration: "Connector stores model code, edition, chapter/section pointer, jurisdiction adoption, and official ICC URL."
  },
  {
    id: "icc-icodes",
    name: "ICC I-Codes overview",
    authority: "International Code Council",
    url: "https://www.iccsafe.org/products-and-services/i-codes/the-i-codes/",
    access: "Public code family reference",
    freshness: "I-Codes update every three years; always pair model code with local adoption.",
    scope: "Coordinated family of International Codes used as model building safety codes.",
    topics: ["i-codes", "ibc", "irc", "icc", "model code", "adoption"],
    integration: "Connector helps identify which model code family should be searched before jurisdiction verification."
  },
  {
    id: "local-ahj",
    name: "State, county, municipal, and AHJ code records",
    authority: "Local authority having jurisdiction",
    url: "https://www.iccsafe.org/adoptions/",
    access: "Jurisdiction-specific adopted codes, amendments, permits, bulletins, and inspector notes",
    freshness: "Required for every job because model codes are adopted and amended locally.",
    scope: "Adopted code year, amendments, permits, licensing, notices, and inspection requirements.",
    topics: ["state", "county", "city", "municipal", "permit", "ahj", "jurisdiction", "adoption"],
    integration: "Connector stores jurisdiction, adopted code edition, amendment URL, permit source, date checked, and reviewer."
  }
];

const adjusterJargonLibrary = [
  {
    phrase: "not warranted",
    intent: "Denies that the work was necessary.",
    responseFrame: "Anchor the response in observed conditions, the work actually performed, and the evidence that made the action reasonable at the time.",
    proofNeeded: ["before photos", "moisture readings", "room notes", "scope note", "technician time"]
  },
  {
    phrase: "excessive",
    intent: "Challenges quantity, duration, or rate.",
    responseFrame: "Break the charge into quantity, unit, duration, location, and documented reason so the reviewer has to dispute facts instead of adjectives.",
    proofNeeded: ["quantity takeoff", "equipment log", "daily readings", "room dimensions", "photos"]
  },
  {
    phrase: "industry standard",
    intent: "Uses a vague standard without identifying an edition, section, or factual basis.",
    responseFrame: "Ask for the specific source relied on and provide your source map with edition, section pointer, jurisdiction, and date checked.",
    proofNeeded: ["source pointer", "date checked", "reviewer", "job facts", "photos"]
  },
  {
    phrase: "pre-existing",
    intent: "Attempts to shift damage or scope outside the covered event.",
    responseFrame: "Separate pre-loss condition from event-created condition and tie each disputed item to timeline, photos, readings, and customer/tenant statements.",
    proofNeeded: ["loss timeline", "cause note", "photo sequence", "customer statement", "inspection note"]
  },
  {
    phrase: "wear and tear",
    intent: "Frames the item as maintenance instead of loss-related work.",
    responseFrame: "Respond with the loss-specific condition and explain why the work addressed that condition rather than ordinary maintenance.",
    proofNeeded: ["affected-area photos", "loss description", "scope note", "measurements"]
  },
  {
    phrase: "duplication",
    intent: "Claims two line items cover the same labor, material, or equipment.",
    responseFrame: "Define each line item by task, location, time, and evidence so separate work is visible.",
    proofNeeded: ["line item notes", "room tags", "time entries", "photos", "invoice mapping"]
  },
  {
    phrase: "code upgrade not owed",
    intent: "Rejects code or safety work without verifying local adoption.",
    responseFrame: "Move the discussion to adopted code, local amendment, permit/AHJ requirement, and the condition that triggered the work.",
    proofNeeded: ["AHJ source", "adopted code year", "permit note", "inspection note", "scope line"]
  },
  {
    phrase: "equipment days",
    intent: "Reduces drying, filtration, dehumidification, or generator duration.",
    responseFrame: "Tie each equipment day to placement, readings, affected materials, room conditions, photos, and pickup time.",
    proofNeeded: ["equipment GPS", "daily readings", "photos", "pickup log", "invoice line"]
  },
  {
    phrase: "ppe not necessary",
    intent: "Challenges safety costs.",
    responseFrame: "Tie PPE to the site hazard, task exposure, worker protection requirement, and job-specific condition.",
    proofNeeded: ["hazard note", "task note", "photos", "safety checklist", "OSHA source pointer"]
  },
  {
    phrase: "insufficient documentation",
    intent: "Requests more proof or uses missing support to reduce payment.",
    responseFrame: "Respond with a concise evidence index: fact, file, timestamp, linked line item, and what the evidence proves.",
    proofNeeded: ["photo index", "time log", "equipment log", "estimate notes", "communication history"]
  }
];

const defaultJargonTerms = adjusterJargonLibrary.map((entry, index) => ({
  id: `JG-${String(index + 1).padStart(3, "0")}`,
  phrase: entry.phrase,
  intent: entry.intent,
  responseFrame: entry.responseFrame,
  proofNeeded: entry.proofNeeded,
  count: 1,
  source: "seed",
  lastSeen: "2026-06-06T09:00:00.000Z"
}));

const defaultStandardsOutputs = [
  {
    id: "AI-CODE-1001",
    moduleKey: "compliance",
    mode: "rebuttal",
    title: "Water-loss compliance source map",
    jurisdiction: "Verify local AHJ",
    trade: "Restoration",
    jobType: "Water damage mitigation",
    issue: "Find standards and code sources for moisture documentation, drying, safety, and invoice support.",
    generatedAt: "2026-06-06T09:00:00.000Z",
    sourceIds: standardsSources.map((source) => source.id),
    draft: [
      "Search IICRC restoration standards first for industry language and technical process support, then verify OSHA safety requirements for worker exposure, PPE, respiratory protection, fall hazards, electrical hazards, silica, lead, asbestos, or other site-specific hazards.",
      "For code-related assertions, confirm the adopted IBC/IRC/IFC/IMC/IPC edition and local amendments with the AHJ before using the language externally.",
      "Use the output as a review packet: cite source, edition, section pointer, jurisdiction, date checked, and reviewer before sending a rebuttal or justification."
    ],
    review: ["Human review required", "Verify local adoption", "Do not copy restricted standard text without license"]
  }
];

const defaultFiles = [
  {
    id: "F-1001",
    moduleKey: "jobs",
    title: "Maple Street water loss",
    type: "Job",
    owner: "Office",
    status: "Needs review",
    priority: "High",
    due: "2026-06-03",
    relatedJob: "J-2048",
    notes: "Missing final photos and equipment pull confirmation.",
    createdAt: "2026-06-01T14:15:00.000Z",
    updatedAt: "2026-06-01T14:15:00.000Z",
    history: ["Created demo job file"]
  },
  {
    id: "F-1002",
    moduleKey: "revenueengine",
    title: "Oak Avenue supplement packet",
    type: "Revenue packet",
    owner: "Estimator",
    status: "Drafting",
    priority: "High",
    due: "2026-06-04",
    relatedJob: "J-2039",
    notes: "Tie line items to photos, room notes, time, and material receipts.",
    createdAt: "2026-06-01T15:05:00.000Z",
    updatedAt: "2026-06-01T15:05:00.000Z",
    history: ["Created demo revenue packet"]
  },
  {
    id: "F-1003",
    moduleKey: "properties",
    title: "North Ridge Apartments",
    type: "Property",
    owner: "Property desk",
    status: "Active",
    priority: "Medium",
    due: "2026-06-07",
    relatedJob: "Portfolio",
    notes: "Permanent property file with owners, tenants, vendors, claims, photos, and service history.",
    createdAt: "2026-05-30T11:30:00.000Z",
    updatedAt: "2026-05-30T11:30:00.000Z",
    history: ["Created demo property file"]
  },
  {
    id: "F-1004",
    moduleKey: "daily",
    title: "Owner morning review",
    type: "Dashboard review",
    owner: "Owner",
    status: "Open",
    priority: "High",
    due: "2026-06-02",
    relatedJob: "Workspace",
    notes: "Review money due, risk, dispatch, missing documents, and today's priorities.",
    createdAt: "2026-06-02T08:00:00.000Z",
    updatedAt: "2026-06-02T08:00:00.000Z",
    history: ["Created demo dashboard file"]
  },
  {
    id: "F-1005",
    moduleKey: "payments",
    title: "INV-2039 Oak Avenue equipment billing",
    type: "Invoice",
    owner: "Bookkeeping",
    status: "Drafting",
    priority: "High",
    due: "2026-06-05",
    relatedJob: "J-2039",
    notes: "Draft invoice waiting for equipment deployment locations and rental-day support.",
    createdAt: "2026-06-02T09:30:00.000Z",
    updatedAt: "2026-06-02T09:30:00.000Z",
    history: ["Created demo invoice file"]
  }
];

const defaultQueue = [
  {
    id: "Q-101",
    moduleKey: "jobs",
    label: "Confirm final photos for Maple Street",
    detail: "Field QC is blocking invoice closeout.",
    priority: "High"
  },
  {
    id: "Q-102",
    moduleKey: "revenueengine",
    label: "Draft Oak Avenue supplement",
    detail: "Carrier reduction needs photo-backed rebuttal.",
    priority: "High"
  },
  {
    id: "Q-103",
    moduleKey: "payments",
    label: "Collect two deposit promises",
    detail: "Payment plan terms need owner approval.",
    priority: "Medium"
  }
];

const defaultActivity = [
  {
    time: "2026-06-02T08:15:00.000Z",
    text: "Workspace loaded with owner dashboard, module files, and employee time access."
  }
];

const defaultEquipmentDeployments = [
  {
    id: "EQ-1001",
    equipmentName: "Dri-Eaz LGR Dehumidifier",
    assetTag: "DEHU-014",
    job: "J-2039 Oak Avenue",
    room: "Unit 2B living room",
    status: "Deployed",
    invoiceId: "F-1005",
    invoiceNumber: "INV-2039",
    dailyRate: 95,
    rentalDays: 3,
    billable: true,
    latitude: 42.4501,
    longitude: -73.2454,
    gpsLabel: "42.45010, -73.24540 (12m)",
    address: "Oak Avenue, Pittsfield MA",
    notes: "Placed near affected flooring. Tie rental days to equipment photos and invoice line.",
    createdAt: "2026-06-02T09:35:00.000Z",
    updatedAt: "2026-06-02T09:35:00.000Z"
  }
];

const defaultJobBoards = [
  {
    id: "JOB-1001",
    jobId: "J-2048",
    title: "Maple Street water loss",
    branchId: "BR-1001",
    customer: "Lena Ortiz",
    property: "18 Maple Street",
    stage: "Dry-out",
    owner: "Field PM",
    start: "2026-06-01",
    end: "2026-06-07",
    nextAction: "Collect final photos and confirm equipment pull.",
    blockers: "Final photos and equipment return are blocking invoice closeout.",
    gates: [
      { id: "authorization", label: "Signed authorization", status: "Done" },
      { id: "deposit", label: "Deposit / deductible", status: "Done" },
      { id: "photos", label: "Required photos", status: "Blocked" },
      { id: "time", label: "Labor time matched", status: "Open" },
      { id: "equipment", label: "Equipment return", status: "Open" },
      { id: "drylogs", label: "Dry logs current", status: "Blocked" },
      { id: "invoice", label: "Invoice ready", status: "Open" }
    ],
    linkedModules: ["photos", "time", "drylogs", "equipment", "payments", "closeout"]
  },
  {
    id: "JOB-1002",
    jobId: "J-2039",
    title: "Oak Avenue mitigation",
    branchId: "BR-1001",
    customer: "North Ridge Apartments",
    property: "Oak Avenue Unit 2B",
    stage: "Invoice support",
    owner: "Estimator",
    start: "2026-06-02",
    end: "2026-06-09",
    nextAction: "Attach equipment GPS support and draft supplement.",
    blockers: "Carrier reduction needs source-backed justification.",
    gates: [
      { id: "authorization", label: "Signed authorization", status: "Done" },
      { id: "deposit", label: "Deposit / deductible", status: "Open" },
      { id: "photos", label: "Required photos", status: "Done" },
      { id: "time", label: "Labor time matched", status: "Open" },
      { id: "equipment", label: "Equipment invoice support", status: "Blocked" },
      { id: "drylogs", label: "Dry logs current", status: "Open" },
      { id: "invoice", label: "Invoice ready", status: "Open" }
    ],
    linkedModules: ["revenueengine", "drylogs", "equipment", "justification", "payments", "compliance"]
  }
];

const defaultDryLogs = [
  {
    id: "DRY-1001",
    jobId: "J-2039",
    jobTitle: "Oak Avenue mitigation",
    room: "Unit 2B living room",
    material: "Wood flooring",
    readingDate: "2026-06-02",
    technician: "Field Lead",
    moisture: 17.8,
    targetMoisture: 12,
    relativeHumidity: 42,
    temperature: 72,
    equipmentIds: ["EQ-1001"],
    photoRef: "IMG-2039-LR-001",
    status: "Drying",
    notes: "Initial affected floor reading. LGR and air movement set before daily monitoring.",
    createdAt: "2026-06-02T10:10:00.000Z"
  },
  {
    id: "DRY-1002",
    jobId: "J-2039",
    jobTitle: "Oak Avenue mitigation",
    room: "Unit 2B living room",
    material: "Wood flooring",
    readingDate: "2026-06-04",
    technician: "Field Lead",
    moisture: 12.9,
    targetMoisture: 12,
    relativeHumidity: 36,
    temperature: 73,
    equipmentIds: ["EQ-1001"],
    photoRef: "IMG-2039-LR-014",
    status: "Monitor",
    notes: "Trending down; keep equipment through next reading and attach photos to invoice support.",
    createdAt: "2026-06-04T09:20:00.000Z"
  }
];

const defaultContacts = [
  {
    id: "CON-1001",
    name: "Marta Green",
    role: "Property manager",
    organization: "North Ridge Apartments",
    phone: "(413) 555-0144",
    email: "marta@example.com",
    property: "Oak Avenue Unit 2B",
    relationship: "Decision maker",
    status: "Active",
    lastTouch: "2026-06-02T10:20:00.000Z",
    nextAction: "Send equipment invoice support and ETA.",
    linkedIds: ["CON-1002", "CON-1003"],
    notes: "Approves tenant access, service windows, and payment plan communication.",
    history: ["Confirmed unit access window."]
  },
  {
    id: "CON-1002",
    name: "Dana Rowe",
    role: "Carrier adjuster",
    organization: "Harbor Mutual",
    phone: "(617) 555-0188",
    email: "drowe@example.com",
    property: "Oak Avenue Unit 2B",
    relationship: "Claim reviewer",
    status: "Needs response",
    lastTouch: "2026-06-01T15:40:00.000Z",
    nextAction: "Send rebuttal with photos, readings, and standards source map.",
    linkedIds: ["CON-1001"],
    notes: "Reduced equipment days and requested additional justification.",
    history: ["Carrier requested support for equipment charges."]
  },
  {
    id: "CON-1003",
    name: "Evan Blair",
    role: "Tenant",
    organization: "Oak Avenue Unit 2B",
    phone: "(413) 555-0199",
    email: "evan@example.com",
    property: "Oak Avenue Unit 2B",
    relationship: "Site access",
    status: "Active",
    lastTouch: "2026-06-02T08:50:00.000Z",
    nextAction: "Confirm equipment pickup path.",
    linkedIds: ["CON-1001"],
    notes: "Coordinate entry, pets, and room access before crew dispatch.",
    history: ["Tenant approved morning access."]
  }
];

const defaultBranches = [
  {
    id: "BR-1001",
    name: "Pittsfield Operations",
    accessCode: "PIT-OPS-26",
    territory: "Berkshire County",
    manager: "David",
    status: "Active",
    linkedBranchIds: ["BR-1002"],
    modules: ["jobs", "dispatch", "time", "equipment", "payments"],
    notes: "Primary dispatch, mitigation, equipment, billing, and employee time access."
  },
  {
    id: "BR-1002",
    name: "Emergency Response Pod",
    accessCode: "ER-POD-24",
    territory: "After-hours overflow",
    manager: "On-call lead",
    status: "Limited access",
    linkedBranchIds: ["BR-1001"],
    modules: ["universalintake", "dispatch", "time", "fieldmobile"],
    notes: "Employee-only access code can be shared for time and dispatch without opening owner screens."
  }
];

const defaultPriceItems = [
  {
    id: "PB-1001",
    code: "WTR-AIRMOVER",
    name: "Air mover rental",
    category: "Equipment",
    unit: "day",
    rate: 35,
    cost: 12,
    branch: "All branches",
    justification: "Air movement required to support drying goals and documented affected-area airflow."
  },
  {
    id: "PB-1002",
    code: "WTR-LGR",
    name: "LGR dehumidifier rental",
    category: "Equipment",
    unit: "day",
    rate: 95,
    cost: 28,
    branch: "All branches",
    justification: "Dehumidification required to reduce moisture load and support drying documentation."
  },
  {
    id: "PB-1003",
    code: "DOC-PACKET",
    name: "Claim documentation packet",
    category: "Admin",
    unit: "each",
    rate: 185,
    cost: 55,
    branch: "Office",
    justification: "Photo, time, equipment, room-note, and invoice support assembled for customer or carrier review."
  }
];

const defaultEstimateDraft = {
  estimateNo: "EST-2039",
  customer: "North Ridge Apartments",
  job: "J-2039 Oak Avenue Unit 2B",
  branch: "Pittsfield Operations",
  preparedBy: "Estimator",
  terms: "Due upon receipt. Scope, quantities, and pricing are subject to owner approval and site conditions.",
  logoDataUrl: "",
  lines: [
    { id: "EL-1001", priceItemId: "PB-1002", qty: 3, note: "Three documented billable equipment days." },
    { id: "EL-1002", priceItemId: "PB-1003", qty: 1, note: "Evidence packet for invoice support." }
  ]
};

const defaultXactimateImports = [
  {
    id: "XI-1001",
    fileName: "Oak Avenue adjuster estimate.esx",
    importedAt: "2026-06-02T10:00:00.000Z",
    lineCount: 2,
    total: 470,
    status: "Imported",
    notes: "Demo Xactimate pricing import for equipment and documentation lines."
  }
];

const defaultQuickBooksConnection = {
  connected: false,
  companyName: "",
  realmId: "",
  scopes: ["com.intuit.quickbooks.accounting", "openid", "email"],
  lastSync: "",
  mode: "Sandbox-ready"
};

const defaultTeamMembers = [
  {
    id: "TM-1001",
    name: "David",
    email: "owner@example.com",
    role: "Owner / Administrator",
    accountType: "Administrator",
    access: "Full access, billing, users, exports, AI, security, integrations",
    permissions: ["owner-dashboard", "user-management", "billing", "exports", "ai-admin", "security"],
    accessCode: "OWNER-ADMIN",
    assignedJobIds: [],
    assignedTaskIds: [],
    status: "Active",
    lastLogin: "2026-06-06T08:30:00.000Z"
  },
  {
    id: "TM-1002",
    name: "Field Lead",
    email: "field@example.com",
    role: "Field manager",
    accountType: "Employee",
    access: "Jobs, dry logs, time, photos, equipment, communication board",
    permissions: ["jobs", "drylogs", "time", "photos", "equipment", "communications"],
    accessCode: "FIELD-2039",
    assignedJobIds: ["J-2039"],
    assignedTaskIds: ["TASK-1001"],
    status: "Invited",
    lastLogin: ""
  }
];

const defaultAccountProfile = {
  activeRole: "Administrator",
  adminAccount: {
    name: "David",
    email: "owner@example.com",
    accessCode: adminAccessCode,
    mfa: "Google required",
    scope: "Full Super Admin dashboard, every user, customer, revenue invoice, contractor invoice, billing, exports, security, integrations, and deletion controls."
  },
  employeePortal: {
    accessCode: workerAccessCode,
    modules: employeeAllowedModuleKeys,
    scope: "Restricted worker and contractor portals for assigned jobs, GPS time, dry logs, photos, equipment notes, contractor invoices, and board discussions without global indexes or owner controls."
  }
};

const defaultTasks = [
  {
    id: "TASK-1001",
    title: "Upload Oak Avenue final photos",
    assigneeId: "TM-1002",
    assigneeName: "Field Lead",
    assigneeEmail: "field@example.com",
    moduleKey: "photos",
    relatedJob: "J-2039",
    due: "2026-06-07",
    status: "Open",
    priority: "High"
  },
  {
    id: "TASK-1002",
    title: "Review supplement rebuttal",
    assigneeId: "TM-1001",
    assigneeName: "David",
    assigneeEmail: "owner@example.com",
    moduleKey: "supplement",
    relatedJob: "J-2039",
    due: "2026-06-08",
    status: "Open",
    priority: "High"
  }
];

const defaultPhotoRecords = [
  {
    id: "PHOTO-1001",
    jobId: "J-2039",
    room: "Living room",
    category: "Completion",
    photoRef: "IMG-2039-LR-014",
    notes: "Final floor condition attached to closeout support.",
    taskId: "TASK-1001",
    workerId: "TM-1002",
    workerName: "Field Lead",
    workerEmail: "field@example.com",
    createdAt: "2026-06-06T13:30:00.000Z"
  }
];

const defaultSketchRooms = [
  {
    id: "ROOM-1001",
    name: "Living room",
    assignedJob: "J-2039",
    width: 22,
    height: 16,
    x: 8,
    y: 12,
    w: 34,
    h: 28,
    notes: "Affected flooring, two air movers, one LGR dehumidifier.",
    scribble: "living rm 22x16 affected floor equip near window"
  },
  {
    id: "ROOM-1002",
    name: "Hall",
    assignedJob: "J-2039",
    width: 12,
    height: 5,
    x: 44,
    y: 24,
    w: 18,
    h: 12,
    notes: "Moisture point at transition.",
    scribble: "hall 12x5 moisture transition"
  }
];

const defaultPerformanceMetrics = {
  cashIn: 18450,
  invoicesDelayed: 4,
  openReceivables: 32800,
  jobProfit: 38,
  unbilledItems: 7,
  quickBooksExpenses: 12425
};

const defaultActionDashboard = {
  title: "Owner action dashboard",
  selectedKeys: ["jobs", "drylogs", "pricing", "payments", "team", "compliance", "equipment", "time"],
  maxCards: 12
};

const defaultSkillPacks = [
  {
    id: "SKILL-EST",
    name: "Estimator and Scope Builder",
    category: "Revenue",
    status: "Active",
    capability: "Turns price book, Xactimate imports, sketches, job facts, and proof gaps into estimate/supplement actions.",
    databases: ["pricebook", "xactimate", "sketch", "jobs"]
  },
  {
    id: "SKILL-REB",
    name: "Adjuster Rebuttal Strategist",
    category: "Compliance",
    status: "Active",
    capability: "Uses learned jargon, standards source targets, evidence checklists, and job facts to draft rebuttal strategy.",
    databases: ["standards", "jargon", "files", "drylogs"]
  },
  {
    id: "SKILL-DRY",
    name: "Drying Analyst",
    category: "Field",
    status: "Active",
    capability: "Reads moisture/RH/temp trends, job gates, equipment, and photo references to flag drying documentation risk.",
    databases: ["drylogs", "equipment", "photos", "jobs"]
  },
  {
    id: "SKILL-CFO",
    name: "CFO / Investor Lens",
    category: "Finance",
    status: "Active",
    capability: "Summarizes receivables, delayed invoices, unbilled work, expenses, equipment revenue, and readiness score.",
    databases: ["payments", "accounting", "performance", "pricebook"]
  },
  {
    id: "SKILL-DISP",
    name: "Dispatch and Field Ops Optimizer",
    category: "Operations",
    status: "Active",
    capability: "Connects jobs, crews, time entries, equipment, routes, blockers, and next actions.",
    databases: ["jobs", "time", "equipment", "tasks"]
  },
  {
    id: "SKILL-QA",
    name: "Quality and Closeout Auditor",
    category: "Operations",
    status: "Active",
    capability: "Checks closeout proof, file status, missing photos, dry logs, authorizations, and invoice readiness.",
    databases: ["files", "jobs", "drylogs", "payments"]
  },
  {
    id: "SKILL-SEC",
    name: "Admin, Roles, and Trust Gatekeeper",
    category: "Security",
    status: "Active",
    capability: "Separates owner/admin powers from employee field portal access and tracks permission coverage.",
    databases: ["team", "account", "audit"]
  },
  {
    id: "SKILL-INT",
    name: "Integration Readiness Architect",
    category: "Platform",
    status: "Staged",
    capability: "Maps QuickBooks, payment rails, Maps/GPS, ESX imports, document extraction, and future hosted APIs.",
    databases: ["quickbooks", "payments", "maps", "xactimate"]
  },
  {
    id: "SKILL-SVC",
    name: "Service Callout Coordinator",
    category: "Operations",
    status: "Active",
    capability: "Turns website/service-button requests into owner email notifications, intake files, dispatch tasks, and scheduled callouts.",
    databases: ["serviceRequests", "calloutSchedule", "dispatch", "tasks"]
  }
];

const defaultDataVaults = [
  { id: "jobs", name: "Jobs and Gates", type: "Operational database", status: "Live", owner: "Operations", records: "jobBoards", coverage: "Stages, blockers, Gantt, gates, linked modules, packets." },
  { id: "insuranceIntake", name: "Insurance Intake", type: "Claim intake database", status: "Live", owner: "Office", records: "insuranceSubmissions", coverage: "Website insurance submissions, uploaded files, claim details, statuses, and internal notes." },
  { id: "drylogs", name: "Dry Logs", type: "Field evidence database", status: "Live", owner: "Field", records: "dryLogs", coverage: "Moisture, target, RH, temp, room, equipment, photo ref, job gate." },
  { id: "pricebook", name: "Price Book and Xactimate Pricing", type: "Revenue database", status: "Live", owner: "Estimating", records: "priceItems", coverage: "Highest-rate policy, history rows, manual pricing, imported line items." },
  { id: "standards", name: "Standards and Code Source Targets", type: "Knowledge database", status: "Connector-ready", owner: "Compliance", records: "standardsSources", coverage: "IICRC, ANSI, OSHA, eCFR, ICC, AHJ source targets and source-check notes." },
  { id: "jargon", name: "Adjuster Jargon Memory", type: "Language database", status: "Live", owner: "AI", records: "learnedJargon", coverage: "Denial phrases, intent, response frame, proof required, usage counts." },
  { id: "payments", name: "Payments and Receivables", type: "Finance database", status: "Live", owner: "Accounting", records: "files", coverage: "Payment requests, rails, receivables, invoice status, collection workflow." },
  { id: "equipment", name: "Equipment GPS and Billing", type: "Asset database", status: "Live", owner: "Field", records: "equipmentDeployments", coverage: "Assets, GPS, rental days, invoice links, charges, job tie." },
  { id: "team", name: "Team, Roles, and Tasks", type: "Identity/workflow database", status: "Live", owner: "Admin", records: "teamMembers", coverage: "Admin/employee split, permissions, tasks, assignees, due dates." },
  { id: "quickbooks", name: "QuickBooks Gateway", type: "Integration database", status: "OAuth-ready", owner: "Finance", records: "quickBooksConnection", coverage: "Company connection, scopes, last sync, job profit inputs." },
  { id: "serviceRequests", name: "Service Requests and Callouts", type: "Intake/schedule database", status: "Live", owner: "Dispatch", records: "serviceRequests", coverage: "Request button intake, owner email handoff, dispatch queue, task creation, and callout schedule." },
  { id: "audit", name: "Activity and Export Audit", type: "Trust database", status: "Live", owner: "Admin", records: "activity", coverage: "Workspace activity, exports, created files, generated packets, changes." }
];

const defaultInstitutionalReview = {
  lastRun: "",
  score: 0,
  verdict: "Not run",
  focus: "Investor diligence",
  notes: []
};

const defaultServiceSettings = {
  ownerEmail: "owner@example.com",
  notifyName: "Owner dispatch",
  notificationMode: "Email gateway ready",
  backendEndpoint: "/api/service-requests",
  defaultCalloutMinutes: 60
};

const defaultServiceRequests = [];
const defaultCalloutSchedule = [];

const defaultAiCopilotMessages = [
  {
    id: "AI-MSG-1001",
    role: "assistant",
    text: "I am Brother Copilot. Ask me about this OS, jobs, dry logs, money, pricing, rebuttals, modules, tasks, or calculations.",
    time: "2026-06-06T09:00:00.000Z"
  }
];

const defaultAiCopilotProfile = {
  nickname: "Brother Copilot",
  mode: "OS-aware discussion assistant",
  contextCapacity: "Indexes local workspace modules, files, jobs, dry logs, pricing, payments, equipment, standards outputs, jargon, tasks, team, and performance metrics.",
  computationCapacity: "Runs local summaries for job progress, drying trends, equipment charges, logged hours, receivables, margins, and active highest pricing.",
  backendStatus: "Frontend connector-ready; hosted deployment should connect this prompt/context package to a secured LLM endpoint."
};

const defaultState = {
  activeKey: "daily",
  category: "all",
  search: "",
  files: defaultFiles,
  queue: defaultQueue,
  activity: defaultActivity,
  standardsOutputs: defaultStandardsOutputs,
  learnedJargon: defaultJargonTerms,
  equipmentDeployments: defaultEquipmentDeployments,
  dryLogs: defaultDryLogs,
  jobBoards: defaultJobBoards,
  contacts: defaultContacts,
  branches: defaultBranches,
  priceItems: defaultPriceItems,
  xactimateImports: defaultXactimateImports,
  estimateDraft: defaultEstimateDraft,
  quickBooksConnection: defaultQuickBooksConnection,
  accountProfile: defaultAccountProfile,
  teamMembers: defaultTeamMembers,
  tasks: defaultTasks,
  photoRecords: defaultPhotoRecords,
  sketchRooms: defaultSketchRooms,
  performanceMetrics: defaultPerformanceMetrics,
  actionDashboard: defaultActionDashboard,
  skillPacks: defaultSkillPacks,
  dataVaults: defaultDataVaults,
  institutionalReview: defaultInstitutionalReview,
  serviceSettings: defaultServiceSettings,
  serviceRequests: defaultServiceRequests,
  calloutSchedule: defaultCalloutSchedule,
  insuranceSubmissions: [],
  insuranceFilters: {
    search: "",
    status: "all"
  },
  insuranceLoading: false,
  insuranceLoaded: false,
  insuranceError: "",
  insuranceAuthLoading: false,
  insuranceAuthChecked: false,
  insuranceAdminSession: null,
  selectedInsuranceId: "",
  industryProfile: "restoration",
  aiCopilotProfile: defaultAiCopilotProfile,
  aiCopilotMemory: [],
  aiCopilotOpen: false,
  aiCopilotQuery: "",
  aiCopilotMessages: defaultAiCopilotMessages,
  firebase: {
    enabled: false,
    ready: false
  },
  authSession: null,
  accessContext: null,
  authLoading: false,
  authChecked: false,
  authError: "",
  loginForm: {
    email: "",
    password: "",
    accessCode: ""
  },
  accessRequestStatus: null,
  lastAccessGrant: null,
  businessData: [],
  communityPosts: [],
  adminEditMode: false,
  adminEditAssetUrl: "",
  timeEntries: [],
  clockSession: null,
  employeeMode: false,
  worker: null,
  mobileOpen: false,
  modal: null,
  selectedFileId: null,
  toast: ""
};

let state = loadState();
state.activeKey = getRouteKey() || state.activeKey || "daily";
applyHighestPricingPolicy();

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeDefaultsById(current, defaults) {
  const currentIds = new Set(current.map((item) => item.id));
  return [...current, ...defaults.filter((item) => !currentIds.has(item.id)).map((item) => clone(item))];
}

function normalizeModuleKeyList(value, primaryKey = "") {
  const rawKeys = Array.isArray(value) ? value : String(value || "").split(/[\s,|]+/);
  return [...new Set(rawKeys.map((key) => String(key || "").trim()).filter(Boolean))]
    .filter((key) => key !== primaryKey && moduleByKey(key));
}

function fileLinkedModules(file) {
  return normalizeModuleKeyList(file.linkedModuleKeys || file.linkedModules || [], file.moduleKey);
}

function normalizeFileRecord(file) {
  return {
    ...file,
    linkedModuleKeys: fileLinkedModules(file),
    sourceType: file.sourceType || "",
    sourceId: file.sourceId || "",
    customer: file.customer || "",
    amount: parseAmount(file.amount)
  };
}

function normalizeJobRecord(job) {
  const gates = Array.isArray(job.gates) ? [...job.gates] : [];
  if (!gates.some((gate) => gate.id === "drylogs")) {
    gates.splice(Math.max(0, gates.length - 1), 0, { id: "drylogs", label: "Dry logs current", status: "Open" });
  }
  const linkedModules = Array.isArray(job.linkedModules) ? [...job.linkedModules] : ["photos", "time", "equipment", "payments"];
  if (!linkedModules.includes("drylogs")) linkedModules.splice(Math.min(2, linkedModules.length), 0, "drylogs");
  return { ...job, gates, linkedModules };
}

function normalizeListValue(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean)
    : String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function fallbackAccessCodeForMember(member, accountType) {
  if (/admin/i.test(accountType)) return "OWNER-ADMIN";
  const seed = String(member.id || member.email || member.name || "worker")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .slice(0, 8)
    .padEnd(8, "X");
  return `EMP-${seed.slice(0, 4)}-${seed.slice(4, 8)}`;
}

function normalizeTeamMember(member) {
  const accountType = member.accountType || (/owner|admin/i.test(`${member.role} ${member.access}`) ? "Administrator" : "Employee");
  const permissions = Array.isArray(member.permissions)
    ? member.permissions.map(String).filter(Boolean)
    : String(member.access || "").split(",").map((item) => item.trim()).filter(Boolean);
  const defaultPermissions = /admin/i.test(accountType)
    ? ["owner-dashboard", "user-management", "billing", "exports", "ai-admin", "security"]
    : ["time", "drylogs", "jobs", "photos", "equipment", "communications"];
  return {
    ...member,
    accountType,
    permissions: permissions.length ? permissions : defaultPermissions,
    accessCode: String(member.accessCode || fallbackAccessCodeForMember(member, accountType)).trim().toUpperCase(),
    assignedJobIds: normalizeListValue(member.assignedJobIds || member.assignedJobs || ""),
    assignedTaskIds: normalizeListValue(member.assignedTaskIds || member.tasks || ""),
    status: member.status || "Invited",
    lastLogin: member.lastLogin || ""
  };
}

function normalizeTaskRecord(task, teamMembers = []) {
  const assignee = teamMembers.find((member) => member.id === task.assigneeId || member.email === task.assigneeEmail);
  return {
    ...task,
    assigneeName: task.assigneeName || assignee?.name || "",
    assigneeEmail: task.assigneeEmail || assignee?.email || "",
    status: task.status || "Open",
    priority: task.priority || "Medium"
  };
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
    if (!saved || typeof saved !== "object") return clone(defaultState);
    return normalizeState({ ...clone(defaultState), ...saved });
  } catch {
    return clone(defaultState);
  }
}

function normalizeState(next) {
  next.files = Array.isArray(next.files) ? mergeDefaultsById(next.files, defaultFiles) : clone(defaultFiles);
  next.files = next.files.map(normalizeFileRecord);
  next.queue = Array.isArray(next.queue) ? next.queue : clone(defaultQueue);
  next.activity = Array.isArray(next.activity) ? next.activity : clone(defaultActivity);
  next.standardsOutputs = Array.isArray(next.standardsOutputs) ? next.standardsOutputs : clone(defaultStandardsOutputs);
  next.learnedJargon = Array.isArray(next.learnedJargon) ? mergeDefaultsById(next.learnedJargon, defaultJargonTerms) : clone(defaultJargonTerms);
  next.equipmentDeployments = Array.isArray(next.equipmentDeployments) ? mergeDefaultsById(next.equipmentDeployments, defaultEquipmentDeployments) : clone(defaultEquipmentDeployments);
  next.dryLogs = Array.isArray(next.dryLogs) ? mergeDefaultsById(next.dryLogs, defaultDryLogs) : clone(defaultDryLogs);
  next.jobBoards = Array.isArray(next.jobBoards) ? mergeDefaultsById(next.jobBoards, defaultJobBoards) : clone(defaultJobBoards);
  next.jobBoards = next.jobBoards.map(normalizeJobRecord);
  next.contacts = Array.isArray(next.contacts) ? mergeDefaultsById(next.contacts, defaultContacts) : clone(defaultContacts);
  next.branches = Array.isArray(next.branches) ? mergeDefaultsById(next.branches, defaultBranches) : clone(defaultBranches);
  next.priceItems = Array.isArray(next.priceItems) ? mergeDefaultsById(next.priceItems, defaultPriceItems) : clone(defaultPriceItems);
  next.xactimateImports = Array.isArray(next.xactimateImports) ? mergeDefaultsById(next.xactimateImports, defaultXactimateImports) : clone(defaultXactimateImports);
  next.estimateDraft =
    next.estimateDraft && typeof next.estimateDraft === "object"
      ? { ...clone(defaultEstimateDraft), ...next.estimateDraft, lines: Array.isArray(next.estimateDraft.lines) ? next.estimateDraft.lines : clone(defaultEstimateDraft.lines) }
      : clone(defaultEstimateDraft);
  next.quickBooksConnection =
    next.quickBooksConnection && typeof next.quickBooksConnection === "object" ? { ...clone(defaultQuickBooksConnection), ...next.quickBooksConnection } : clone(defaultQuickBooksConnection);
  next.accountProfile =
    next.accountProfile && typeof next.accountProfile === "object" ? { ...clone(defaultAccountProfile), ...next.accountProfile } : clone(defaultAccountProfile);
  next.accountProfile.adminAccount = { ...clone(defaultAccountProfile.adminAccount), ...(next.accountProfile.adminAccount || {}) };
  next.accountProfile.employeePortal = { ...clone(defaultAccountProfile.employeePortal), ...(next.accountProfile.employeePortal || {}) };
  next.teamMembers = Array.isArray(next.teamMembers) ? mergeDefaultsById(next.teamMembers, defaultTeamMembers) : clone(defaultTeamMembers);
  next.teamMembers = next.teamMembers.map(normalizeTeamMember);
  next.tasks = Array.isArray(next.tasks) ? mergeDefaultsById(next.tasks, defaultTasks) : clone(defaultTasks);
  next.tasks = next.tasks.map((task) => normalizeTaskRecord(task, next.teamMembers));
  next.photoRecords = Array.isArray(next.photoRecords) ? mergeDefaultsById(next.photoRecords, defaultPhotoRecords) : clone(defaultPhotoRecords);
  next.sketchRooms = Array.isArray(next.sketchRooms) ? mergeDefaultsById(next.sketchRooms, defaultSketchRooms) : clone(defaultSketchRooms);
  next.performanceMetrics =
    next.performanceMetrics && typeof next.performanceMetrics === "object" ? { ...clone(defaultPerformanceMetrics), ...next.performanceMetrics } : clone(defaultPerformanceMetrics);
  next.actionDashboard =
    next.actionDashboard && typeof next.actionDashboard === "object" ? { ...clone(defaultActionDashboard), ...next.actionDashboard } : clone(defaultActionDashboard);
  next.actionDashboard.selectedKeys = Array.isArray(next.actionDashboard.selectedKeys)
    ? next.actionDashboard.selectedKeys.filter((key) => moduleByKey(key))
    : clone(defaultActionDashboard.selectedKeys);
  if (!next.actionDashboard.selectedKeys.length) next.actionDashboard.selectedKeys = clone(defaultActionDashboard.selectedKeys);
  next.skillPacks = Array.isArray(next.skillPacks) ? mergeDefaultsById(next.skillPacks, defaultSkillPacks) : clone(defaultSkillPacks);
  next.dataVaults = Array.isArray(next.dataVaults) ? mergeDefaultsById(next.dataVaults, defaultDataVaults) : clone(defaultDataVaults);
  next.institutionalReview =
    next.institutionalReview && typeof next.institutionalReview === "object" ? { ...clone(defaultInstitutionalReview), ...next.institutionalReview } : clone(defaultInstitutionalReview);
  next.serviceSettings =
    next.serviceSettings && typeof next.serviceSettings === "object" ? { ...clone(defaultServiceSettings), ...next.serviceSettings } : clone(defaultServiceSettings);
  next.serviceRequests = Array.isArray(next.serviceRequests) ? next.serviceRequests : clone(defaultServiceRequests);
  next.calloutSchedule = Array.isArray(next.calloutSchedule) ? next.calloutSchedule : clone(defaultCalloutSchedule);
  next.insuranceSubmissions = Array.isArray(next.insuranceSubmissions) ? next.insuranceSubmissions : [];
  next.insuranceFilters =
    next.insuranceFilters && typeof next.insuranceFilters === "object"
      ? {
          search: String(next.insuranceFilters.search || ""),
          status: insuranceStatuses.includes(next.insuranceFilters.status) ? next.insuranceFilters.status : "all"
        }
      : { search: "", status: "all" };
  next.insuranceLoading = false;
  next.insuranceLoaded = false;
  next.insuranceError = "";
  next.insuranceAuthLoading = false;
  next.insuranceAuthChecked = false;
  next.insuranceAdminSession = null;
  next.selectedInsuranceId = typeof next.selectedInsuranceId === "string" ? next.selectedInsuranceId : "";
  next.industryProfile = industryProfiles[next.industryProfile] ? next.industryProfile : "restoration";
  next.aiCopilotProfile =
    next.aiCopilotProfile && typeof next.aiCopilotProfile === "object" ? { ...clone(defaultAiCopilotProfile), ...next.aiCopilotProfile } : clone(defaultAiCopilotProfile);
  next.aiCopilotMemory = Array.isArray(next.aiCopilotMemory) ? next.aiCopilotMemory : [];
  next.aiCopilotOpen = next.aiCopilotOpen === true;
  next.aiCopilotQuery = next.aiCopilotQuery || "";
  next.aiCopilotMessages = Array.isArray(next.aiCopilotMessages) ? mergeDefaultsById(next.aiCopilotMessages, defaultAiCopilotMessages) : clone(defaultAiCopilotMessages);
  next.firebase = { enabled: false, ready: false };
  next.authSession = null;
  next.accessContext = null;
  next.authLoading = false;
  next.authChecked = false;
  next.authError = "";
  next.loginForm = { email: "", password: "", accessCode: "" };
  next.accessRequestStatus = null;
  next.lastAccessGrant = null;
  next.businessData = [];
  next.communityPosts = [];
  next.adminEditMode = false;
  next.adminEditAssetUrl = "";
  next.timeEntries = Array.isArray(next.timeEntries) ? next.timeEntries : [];
  next.clockSession = next.clockSession || null;
  next.employeeMode = Boolean(next.employeeMode);
  next.worker = next.worker || null;
  next.mobileOpen = Boolean(next.mobileOpen);
  next.modal = null;
  next.selectedFileId = next.selectedFileId || null;
  next.toast = "";
  if (!moduleByKey(next.activeKey)) next.activeKey = "daily";
  return next;
}

function persist() {
  const persisted = {
    activeKey: state.activeKey,
    category: state.category,
    search: state.search,
    files: state.files,
    queue: state.queue,
    activity: state.activity,
    standardsOutputs: state.standardsOutputs,
    learnedJargon: state.learnedJargon,
    equipmentDeployments: state.equipmentDeployments,
    dryLogs: state.dryLogs,
    jobBoards: state.jobBoards,
    contacts: state.contacts,
    branches: state.branches,
    priceItems: state.priceItems,
    xactimateImports: state.xactimateImports,
    estimateDraft: state.estimateDraft,
    quickBooksConnection: state.quickBooksConnection,
    accountProfile: state.accountProfile,
    teamMembers: state.teamMembers,
    tasks: state.tasks,
    photoRecords: state.photoRecords,
    sketchRooms: state.sketchRooms,
    performanceMetrics: state.performanceMetrics,
    actionDashboard: state.actionDashboard,
    skillPacks: state.skillPacks,
    dataVaults: state.dataVaults,
    institutionalReview: state.institutionalReview,
    serviceSettings: state.serviceSettings,
    serviceRequests: state.serviceRequests,
    calloutSchedule: state.calloutSchedule,
    insuranceFilters: state.insuranceFilters,
    selectedInsuranceId: state.selectedInsuranceId,
    industryProfile: state.industryProfile,
    aiCopilotProfile: state.aiCopilotProfile,
    aiCopilotMemory: state.aiCopilotMemory,
    aiCopilotOpen: state.aiCopilotOpen,
    aiCopilotQuery: state.aiCopilotQuery,
    aiCopilotMessages: state.aiCopilotMessages,
    timeEntries: state.timeEntries,
    clockSession: state.clockSession,
    employeeMode: state.employeeMode,
    worker: state.worker,
    selectedFileId: state.selectedFileId
  };
  try {
    localStorage.setItem(storageKey, JSON.stringify(persisted));
  } catch (error) {
    const leanPersisted = {
      ...persisted,
      activity: state.activity.slice(0, 25),
      standardsOutputs: state.standardsOutputs.slice(0, 10),
      learnedJargon: state.learnedJargon.slice(0, 50),
      estimateDraft: {
        ...state.estimateDraft,
        logoDataUrl: ""
      }
    };
    try {
      localStorage.setItem(storageKey, JSON.stringify(leanPersisted));
      state.estimateDraft.logoDataUrl = "";
      state.toast = "Saved a compact copy after browser storage filled up";
    } catch (retryError) {
      console.warn("Brothers OS could not persist local browser state.", retryError || error);
      state.toast = "Browser storage is full; export or clear old local data";
    }
  }
}

function moduleByKey(key) {
  return modules.find((module) => module.key === key);
}

function getRouteKey() {
  const match = window.location.hash.match(/^#module\/([A-Za-z0-9_-]+)/);
  return match ? match[1] : "";
}

function getAccessTokenFromRoute() {
  const match = window.location.hash.match(/^#access\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

function getLoginAccessOptions() {
  const accessCodeInput = document.querySelector("[data-field='login-access-code']");
  return {
    accessCode: String(accessCodeInput?.value || state.loginForm.accessCode || "").trim(),
    accessToken: getAccessTokenFromRoute()
  };
}

function isModuleAllowedByAccess(key) {
  if (state.employeeMode) return employeeModuleKeys().includes(key);
  if (state.firebase.enabled && state.accessContext?.tabs?.length) {
    const tab = tabConfigByKey(key);
    return Boolean(tab && tab.visible !== false);
  }
  return true;
}

function routeToModule(key) {
  if (state.employeeMode && !employeeModuleKeys().includes(key)) {
    state.activeKey = employeeModuleKeys()[0] || "time";
    setToast("Employee portal is restricted to field modules");
    persist();
    render();
    return;
  }
  const module = moduleByKey(key);
  if (!module) return;
  if (!isModuleAllowedByAccess(key)) {
    const fallback = modules.find((item) => isModuleAllowedByAccess(item.key))?.key || "daily";
    state.activeKey = fallback;
    setToast("This module is restricted for your current access.");
    persist();
    render();
    return;
  }
  state.activeKey = key;
  state.mobileOpen = false;
  state.selectedFileId = state.files.find((file) => file.moduleKey === key)?.id || null;
  persist();
  if (window.location.hash !== `#module/${key}`) {
    window.location.hash = `module/${key}`;
  }
  render();
  if (key === "insurance") loadInsuranceWorkspace();
}

function formatDate(value) {
  if (!value) return "No date";
  const text = String(value);
  const dateOnly = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const date = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function durationLabel(start, end) {
  const startDate = new Date(start);
  const endDate = end ? new Date(end) : new Date();
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return "0.00";
  const hours = Math.max(0, endDate - startDate) / 1000 / 60 / 60;
  return hours.toFixed(2);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function addActivity(text) {
  state.activity = [{ time: new Date().toISOString(), text }, ...state.activity].slice(0, 60);
}

function setToast(text) {
  state.toast = text;
  window.clearTimeout(setToast.timer);
  setToast.timer = window.setTimeout(() => {
    state.toast = "";
    render();
  }, 2600);
}

function insuranceStatusLabel(status) {
  return String(status || "new")
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function selectedInsuranceSubmission() {
  return state.insuranceSubmissions.find((submission) => submission.id === state.selectedInsuranceId) || null;
}

function insuranceRequiresLogin() {
  return !state.insuranceAdminSession && state.insuranceAuthChecked && !state.insuranceAuthLoading;
}

async function fetchInsuranceAdminSession(force = false) {
  if (state.insuranceAuthLoading) return state.insuranceAdminSession;
  if (state.insuranceAuthChecked && !force) return state.insuranceAdminSession;

  state.insuranceAuthLoading = true;
  render();

  try {
    const response = await fetch("/api/admin/session");
    const result = await response.json();

    if (response.status === 401) {
      state.insuranceAdminSession = null;
      state.insuranceAuthChecked = true;
      state.insuranceAuthLoading = false;
      state.insuranceError = "";
      render();
      return null;
    }

    if (!response.ok || !result.success) {
      throw new Error(result.message || "Unable to verify the admin session.");
    }

    state.insuranceAdminSession = result.session || null;
    state.insuranceAuthChecked = true;
    state.insuranceAuthLoading = false;
    state.insuranceError = "";
    render();
    return state.insuranceAdminSession;
  } catch (error) {
    state.insuranceAdminSession = null;
    state.insuranceAuthChecked = true;
    state.insuranceAuthLoading = false;
    state.insuranceError = error.message || "Unable to verify the admin session.";
    render();
    return null;
  }
}

async function loadInsuranceWorkspace(force = false) {
  const session = await fetchInsuranceAdminSession(force);
  if (!session) return;
  return fetchInsuranceSubmissions(force);
}

async function loginInsuranceAdmin(formData) {
  state.insuranceAuthLoading = true;
  state.insuranceError = "";
  render();

  try {
    const response = await fetch("/api/admin/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email: String(formData.get("email") || "").trim(),
        password: String(formData.get("password") || "")
      })
    });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.message || "Unable to sign in.");

    state.insuranceAdminSession = result.session || null;
    state.insuranceAuthChecked = true;
    state.insuranceAuthLoading = false;
    state.insuranceError = "";
    setToast("Insurance admin signed in.");
    return fetchInsuranceSubmissions(true);
  } catch (error) {
    state.insuranceAdminSession = null;
    state.insuranceAuthChecked = true;
    state.insuranceAuthLoading = false;
    state.insuranceError = error.message || "Unable to sign in.";
    render();
  }
}

async function logoutInsuranceAdmin() {
  state.insuranceAuthLoading = true;
  render();

  try {
    const response = await fetch("/api/admin/logout", {
      method: "POST"
    });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.message || "Unable to sign out.");
  } catch (error) {
    state.insuranceError = error.message || "Unable to sign out.";
  } finally {
    state.insuranceAdminSession = null;
    state.insuranceSubmissions = [];
    state.selectedInsuranceId = "";
    state.insuranceLoaded = false;
    state.insuranceAuthChecked = true;
    state.insuranceAuthLoading = false;
    render();
  }
}

async function fetchInsuranceSubmissions(force = false) {
  if (state.insuranceLoading) return;
  if (state.insuranceLoaded && !force) return;
  if (!state.insuranceAdminSession) return;
  state.insuranceLoading = true;
  state.insuranceError = "";
  render();

  try {
    const params = new URLSearchParams();
    if (state.insuranceFilters.search.trim()) params.set("search", state.insuranceFilters.search.trim());
    if (state.insuranceFilters.status && state.insuranceFilters.status !== "all") params.set("status", state.insuranceFilters.status);
    const query = params.toString();
    const response = await fetch(`/api/insurance-intake${query ? `?${query}` : ""}`);
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.message || "Unable to load insurance submissions.");

    state.insuranceSubmissions = Array.isArray(result.submissions) ? result.submissions : [];
    state.insuranceLoaded = true;
    state.insuranceLoading = false;
    state.insuranceError = "";

    if (!state.insuranceSubmissions.some((submission) => submission.id === state.selectedInsuranceId)) {
      state.selectedInsuranceId = state.insuranceSubmissions[0]?.id || "";
    }

    persist();
    render();
  } catch (error) {
    state.insuranceLoading = false;
    state.insuranceLoaded = true;
    if (String(error.message || "").includes("Authentication required")) {
      state.insuranceAdminSession = null;
      state.insuranceAuthChecked = true;
      state.insuranceError = "";
    } else {
      state.insuranceError = error.message || "Unable to load insurance submissions.";
    }
    render();
  }
}

async function refreshSelectedInsuranceSubmission() {
  if (!state.selectedInsuranceId || !state.insuranceAdminSession) return;

  try {
    const response = await fetch(`/api/insurance-intake/${state.selectedInsuranceId}`);
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.message || "Unable to load insurance submission details.");

    state.insuranceSubmissions = state.insuranceSubmissions.map((submission) =>
      submission.id === result.submission.id ? result.submission : submission
    );
    persist();
    render();
  } catch (error) {
    if (String(error.message || "").includes("Authentication required")) {
      state.insuranceAdminSession = null;
      state.insuranceAuthChecked = true;
      state.insuranceError = "";
    } else {
      state.insuranceError = error.message || "Unable to load insurance submission details.";
    }
    render();
  }
}

async function updateInsuranceSubmissionStatus(submissionId, status) {
  if (!state.insuranceAdminSession) return;
  try {
    const response = await fetch(`/api/insurance-intake/${submissionId}/status`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ status })
    });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.message || "Unable to update insurance status.");

    state.insuranceSubmissions = state.insuranceSubmissions.map((submission) =>
      submission.id === submissionId ? result.submission : submission
    );
    setToast("Insurance status updated.");
    addActivity(`Insurance intake ${submissionId} moved to ${status}.`);
    persist();
    render();
  } catch (error) {
    setToast(error.message || "Unable to update insurance status.");
  }
}

async function updateInsuranceSubmissionNotes(submissionId, notes) {
  if (!state.insuranceAdminSession) return;
  try {
    const response = await fetch(`/api/insurance-intake/${submissionId}/notes`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ notes })
    });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.message || "Unable to update insurance notes.");

    state.insuranceSubmissions = state.insuranceSubmissions.map((submission) =>
      submission.id === submissionId ? result.submission : submission
    );
    setToast("Insurance notes saved.");
    addActivity(`Insurance intake notes saved for ${submissionId}.`);
    persist();
    render();
  } catch (error) {
    setToast(error.message || "Unable to save insurance notes.");
  }
}

function activeModule() {
  if (state.employeeMode && !employeeModuleKeys().includes(state.activeKey)) {
    return moduleByKey(employeeModuleKeys()[0] || "time") || modules[0];
  }
  if (!isModuleAllowedByAccess(state.activeKey)) {
    return modules.find((module) => isModuleAllowedByAccess(module.key)) || modules[0];
  }
  return moduleByKey(state.activeKey) || modules[0];
}

function pinnedKeys() {
  if (state.firebase.enabled && state.accessContext?.tabs?.length) {
    return state.accessContext.tabs.map((tab) => tab.key || tab.id).filter((key) => moduleByKey(key)).slice(0, 14);
  }
  const profile = industryProfiles[state.industryProfile] || industryProfiles.restoration;
  return [...new Set([...(profile.keys || []), ...basePinnedKeys])].filter((key) => moduleByKey(key)).slice(0, 14);
}

function filteredModules() {
  const query = state.search.trim().toLowerCase();
  return modules.filter((module) => {
    if (!isModuleAllowedByAccess(module.key)) return false;
    const categoryMatch = state.category === "all" || module.category === state.category;
    const label = tabConfigByKey(module.key)?.label || module.label;
    const text = `${label} ${module.category} ${module.purpose}`.toLowerCase();
    return categoryMatch && (!query || text.includes(query));
  });
}

function availableModulesForDirectory() {
  return modules.filter((module) => isModuleAllowedByAccess(module.key));
}

function modulesForTaskGroup(group, availableModules, usedKeys) {
  const availableByKey = new Map(availableModules.map((module) => [module.key, module]));
  const groupCategories = new Set(group.categories || []);
  const picked = [];
  (group.keys || []).forEach((key) => {
    const module = availableByKey.get(key);
    if (module && !usedKeys.has(module.key)) {
      picked.push(module);
      usedKeys.add(module.key);
    }
  });
  availableModules.forEach((module) => {
    if (groupCategories.has(module.category) && !usedKeys.has(module.key)) {
      picked.push(module);
      usedKeys.add(module.key);
    }
  });
  return picked.sort((left, right) => left.label.localeCompare(right.label));
}

function renderTaskTypeModuleDirectory() {
  const available = availableModulesForDirectory();
  const usedKeys = new Set();
  const groups = taskTypeGroups
    .map((group) => ({ ...group, modules: modulesForTaskGroup(group, available, usedKeys) }))
    .filter((group) => group.modules.length);
  const remaining = available.filter((module) => !usedKeys.has(module.key)).sort((left, right) => left.label.localeCompare(right.label));
  if (remaining.length) {
    groups.push({ id: "other", label: "Other Workflows", modules: remaining });
  }

  return `
    <section class="module-directory-panel">
      <div class="panel-head">
        <div>
          <h2>Module map</h2>
          <p>All available modules are grouped by task type so owners, admins, and contractors can find the right workspace without hunting through the sidebar.</p>
        </div>
        <div class="source-status">
          <span>${available.length} modules</span>
          <span>${groups.length} task groups</span>
        </div>
      </div>
      <div class="module-directory-grid">
        ${groups.map(renderTaskTypeGroup).join("")}
      </div>
    </section>
  `;
}

function renderTaskTypeGroup(group) {
  return `
    <article class="task-type-group">
      <div class="task-type-head">
        <strong>${escapeHtml(group.label)}</strong>
        <span>${group.modules.length}</span>
      </div>
      ${group.description ? `<p class="task-type-description">${escapeHtml(group.description)}</p>` : ""}
      <div class="module-tile-grid">
        ${group.modules.map(renderDirectoryModuleTile).join("")}
      </div>
    </article>
  `;
}

function renderDirectoryModuleTile(module) {
  const fileCount = filesForModule(module.key).length;
  const queueCount = queueForModule(module.key).length;
  const label = tabConfigByKey(module.key)?.label || module.label;
  return `
    <a class="module-directory-tile${state.activeKey === module.key ? " active" : ""}" href="#module/${module.key}" data-action="set-active" data-key="${module.key}">
      <strong>${escapeHtml(label)}</strong>
      <span>${escapeHtml(categoryLabels[module.category] || module.category)}</span>
      <small>${fileCount} files / ${queueCount} queue</small>
    </a>
  `;
}

function filesForModule(key) {
  return state.files.filter((file) => fileBelongsToModule(file, key)).filter(fileVisibleToCurrentWorker);
}

function fileBelongsToModule(file, key) {
  return file.moduleKey === key || fileLinkedModules(file).includes(key);
}

function queueForModule(key) {
  return key === "daily" ? state.queue : state.queue.filter((item) => item.moduleKey === key);
}

function renderBrandLogo(className = "brand-logo", alt = "Brothers logo") {
  const configuredPath = state.accessContext?.companySettings?.brandLogoUrl || brandLogoPath;
  return `<img class="${escapeHtml(className)}" src="${escapeHtml(configuredPath)}" alt="${escapeHtml(alt)}" />`;
}

function renderTopbarMeta(module) {
  const files = filesForModule(module.key).length;
  const queue = queueForModule(module.key).length;
  const category = categoryLabels[module.category] || module.category;
  return `
    <div class="topbar-meta" aria-label="Current module summary">
      <span>${escapeHtml(category)}</span>
      <span>${files} file${files === 1 ? "" : "s"}</span>
      <span>${queue} queued</span>
    </div>
  `;
}

function actionDashboardKeys() {
  const maxCards = Math.max(1, Number(state.actionDashboard?.maxCards || defaultActionDashboard.maxCards));
  const keys = Array.isArray(state.actionDashboard?.selectedKeys) ? state.actionDashboard.selectedKeys : defaultActionDashboard.selectedKeys;
  return keys.filter((key) => moduleByKey(key)).slice(0, maxCards);
}

function actionDashboardPickerModules() {
  const priorityKeys = [
    ...actionDashboardKeys(),
    ...pinnedKeys(),
    "payments",
    "equipment",
    "accounting",
    "relationships",
    "dispatch",
    "reports",
    "revenueengine",
    "evidencechain",
    "closeout"
  ];
  return [...new Set(priorityKeys)].map((key) => moduleByKey(key)).filter(Boolean);
}

function latestFileForModule(key) {
  return filesForModule(key).sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0))[0] || null;
}

function actionPreviewForModule(module) {
  const generic = () => {
    const latest = latestFileForModule(module.key);
    return {
      metrics: [
        { label: "Files", value: filesForModule(module.key).length },
        { label: "Queue", value: state.queue.filter((item) => item.moduleKey === module.key).length },
        { label: "Open", value: state.files.filter((file) => file.moduleKey === module.key && file.status !== "Complete").length }
      ],
      primary: latest ? latest.title : "No files yet",
      secondary: latest ? `${latest.status} - ${latest.owner}` : module.purpose,
      links: linkedModuleKeys(module).slice(0, 3)
    };
  };
  if (module.key === "jobs") {
    const counts = jobGateCounts();
    const latest = state.jobBoards[0];
    const avg = state.jobBoards.length ? Math.round(state.jobBoards.reduce((sum, job) => sum + jobGateCompletion(job), 0) / state.jobBoards.length) : 0;
    return {
      metrics: [
        { label: "Jobs", value: state.jobBoards.length },
        { label: "Blocked gates", value: counts.blocked },
        { label: "Avg progress", value: `${avg}%` }
      ],
      primary: latest ? `${latest.jobId} ${latest.title}` : "No tracked jobs",
      secondary: latest ? latest.nextAction || latest.blockers || "No next action" : "Add a job to start the board.",
      links: ["drylogs", "time", "equipment", "payments"]
    };
  }
  if (module.key === "drylogs") {
    const latest = state.dryLogs[0];
    const openReadings = state.dryLogs.filter((log) => dryLogGap(log) > 0).length;
    return {
      metrics: [
        { label: "Readings", value: state.dryLogs.length },
        { label: "Above target", value: openReadings },
        { label: "At target", value: state.dryLogs.length - openReadings }
      ],
      primary: latest ? `${latest.jobId} ${latest.room}` : "No dry logs yet",
      secondary: latest ? `${latest.moisture}% vs target ${latest.targetMoisture}% - ${dryLogStatus(latest)}` : "Add moisture/RH/temp readings tied to a job.",
      links: ["jobs", "equipment", "photos", "defensibility"]
    };
  }
  if (module.key === "pricing") {
    return {
      metrics: [
        { label: "Active prices", value: activePriceItems().length },
        { label: "Imports", value: state.xactimateImports.length },
        { label: "Estimate", value: formatMoney(estimateSubtotal()) }
      ],
      primary: "Highest-rate price policy active",
      secondary: "Imported Xactimate lines feed estimate builder while lower duplicate rates stay as history.",
      links: ["revenueengine", "payments", "accounting"]
    };
  }
  if (module.key === "payments") {
    return {
      metrics: [
        { label: "Receivables", value: formatMoney(state.performanceMetrics.openReceivables) },
        { label: "Delayed", value: state.performanceMetrics.invoicesDelayed },
        { label: "Payment files", value: filesForModule("payments").length }
      ],
      primary: "Payment collection queue",
      secondary: `${state.performanceMetrics.unbilledItems} unbilled item(s) and ${state.performanceMetrics.invoicesDelayed} delayed invoice(s).`,
      links: ["accounting", "pricing", "jobs"]
    };
  }
  if (module.key === "team") {
    const openTasks = state.tasks.filter((task) => task.status !== "Complete");
    return {
      metrics: [
        { label: "Users", value: state.teamMembers.length },
        { label: "Open tasks", value: openTasks.length },
        { label: "High", value: openTasks.filter((task) => task.priority === "High").length }
      ],
      primary: openTasks[0]?.title || "No open tasks",
      secondary: openTasks[0] ? `${state.teamMembers.find((member) => member.id === openTasks[0].assigneeId)?.name || "Unassigned"} - ${openTasks[0].relatedJob || "No job"}` : "Create assignments and account permissions.",
      links: ["jobs", "time", "settings"]
    };
  }
  if (module.key === "compliance" || module.key === "aicopilots") {
    return {
      metrics: [
        { label: "Sources", value: standardsSources.length },
        { label: "Drafts", value: state.standardsOutputs.length },
        { label: "Jargon", value: state.learnedJargon.length }
      ],
      primary: state.standardsOutputs[0]?.title || "No source draft yet",
      secondary: "Source targets and learned adjuster jargon are ready for rebuttal and code-search workflows.",
      links: ["defensibility", "supplement", "reports"]
    };
  }
  if (module.key === "equipment") {
    const deployed = state.equipmentDeployments.filter((deployment) => deployment.status === "Deployed").length;
    return {
      metrics: [
        { label: "Deployed", value: deployed },
        { label: "Assets", value: state.equipmentDeployments.length },
        { label: "Revenue", value: formatMoney(state.equipmentDeployments.reduce((sum, item) => sum + equipmentCharge(item), 0)) }
      ],
      primary: state.equipmentDeployments[0]?.equipmentName || "No equipment tracked",
      secondary: state.equipmentDeployments[0] ? `${state.equipmentDeployments[0].job} - ${state.equipmentDeployments[0].gpsLabel || "No GPS"}` : "Add deployed equipment and invoice links.",
      links: ["drylogs", "payments", "jobs"]
    };
  }
  if (module.key === "time") {
    const hours = state.timeEntries.reduce((sum, entry) => sum + Number(entry.hours || 0), 0);
    return {
      metrics: [
        { label: "Entries", value: state.timeEntries.length },
        { label: "Hours", value: hours.toFixed(2) },
        { label: "Clock", value: state.clockSession ? "On" : "Off" }
      ],
      primary: state.clockSession ? `${state.clockSession.worker} is clocked in` : state.timeEntries[0]?.worker || "No active clock",
      secondary: state.clockSession ? `${state.clockSession.job} - ${state.clockSession.task}` : "Employee portal can log time with GPS.",
      links: ["jobs", "drylogs", "equipment"]
    };
  }
  if (module.key === "sketch") {
    const area = state.sketchRooms.reduce((sum, room) => sum + Number(room.width || 0) * Number(room.height || 0), 0);
    return {
      metrics: [
        { label: "Rooms", value: state.sketchRooms.length },
        { label: "Sq ft", value: area },
        { label: "Moisture", value: state.sketchRooms.filter((room) => room.notes.toLowerCase().includes("moisture")).length }
      ],
      primary: state.sketchRooms[0]?.name || "No rooms yet",
      secondary: state.sketchRooms[0] ? state.sketchRooms[0].notes : "Build rooms and connect them to larger plans.",
      links: ["drylogs", "photos", "pricing"]
    };
  }
  if (module.key === "accounting" || module.key === "reports") {
    return {
      metrics: [
        { label: "Cash in", value: formatMoney(state.performanceMetrics.cashIn) },
        { label: "Expenses", value: formatMoney(state.performanceMetrics.quickBooksExpenses) },
        { label: "Profit", value: `${state.performanceMetrics.jobProfit}%` }
      ],
      primary: state.quickBooksConnection.connected ? "QuickBooks connected" : "QuickBooks gateway ready",
      secondary: `${formatMoney(state.performanceMetrics.openReceivables)} open receivables across owner metrics.`,
      links: ["payments", "pricing", "jobs"]
    };
  }
  return generic();
}

function createId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

function usesStandardsAI(module) {
  return [
    "compliance",
    "aicompliance",
    "compliancepacket",
    "nationalcodes",
    "regalerts",
    "safetyintel",
    "justification",
    "supplement",
    "revenueengine",
    "defensibility",
    "aicopilots",
    "aireview",
    "aiexplain",
    "reports"
  ].includes(module.key);
}

function sourceById(id) {
  return standardsSources.find((source) => source.id === id);
}

function tokenize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function scoreStandardsSource(source, query, mode) {
  const tokens = tokenize(`${query} ${mode}`);
  const haystack = `${source.name} ${source.authority} ${source.scope} ${source.topics.join(" ")}`.toLowerCase();
  let score = tokens.reduce((sum, token) => sum + (haystack.includes(token) ? 2 : 0), 0);
  if (mode === "rebuttal" && ["iicrc", "ansi-ibr", "icc-digital-codes"].includes(source.id)) score += 3;
  if (mode === "justification" && ["iicrc", "osha-standards", "local-ahj"].includes(source.id)) score += 3;
  if (mode === "code-search" && ["icc-digital-codes", "osha-standards", "ecfr-title29", "local-ahj"].includes(source.id)) score += 3;
  if (mode === "checklist" && ["osha-standards", "iicrc", "local-ahj"].includes(source.id)) score += 3;
  return score;
}

function rankedStandardsSources(query, mode, selectedIds = []) {
  const selected = selectedIds.length ? standardsSources.filter((source) => selectedIds.includes(source.id)) : standardsSources;
  return selected
    .map((source) => ({ source, score: scoreStandardsSource(source, query, mode) }))
    .sort((a, b) => b.score - a.score || a.source.name.localeCompare(b.source.name))
    .slice(0, 6)
    .map((item) => item.source);
}

function detectAdjusterJargon(query) {
  const haystack = String(query || "").toLowerCase();
  const tokens = new Set(tokenize(query));
  const liveTerms = Array.isArray(state?.learnedJargon)
    ? state.learnedJargon.map((term) => ({
        phrase: term.phrase,
        intent: term.intent || "Learned reviewer phrase from pasted response.",
        responseFrame: term.responseFrame || "Respond with job facts, support files, and a request for the specific contrary basis.",
        proofNeeded: term.proofNeeded || ["photos", "estimate line", "reviewer response"]
      }))
    : [];
  const library = [...adjusterJargonLibrary, ...liveTerms];
  const hits = library
    .map((entry) => {
      const phraseTokens = tokenize(entry.phrase);
      const exact = haystack.includes(entry.phrase);
      const tokenScore = phraseTokens.reduce((sum, token) => sum + (tokens.has(token) ? 1 : 0), 0);
      return { ...entry, score: exact ? 10 : tokenScore };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
  return hits.length
    ? hits
    : [
        {
          phrase: "general reduction",
          intent: "Reviewer language does not match a known pattern yet.",
          responseFrame: "Keep the response fact-based: identify the disputed item, cite the job condition, attach support, and ask for the specific contrary basis.",
          proofNeeded: ["photos", "scope note", "estimate line", "reviewer response"]
        }
      ];
}

function sourceCheckStatus(source, query) {
  const topicHits = source.topics.filter((topic) => String(query || "").toLowerCase().includes(topic.toLowerCase())).slice(0, 4);
  const guidance =
    source.id === "local-ahj"
      ? "Verify adopted code year, amendments, permit notes, and AHJ bulletins for the job address."
      : source.id.includes("osha") || source.id === "ecfr-title29"
        ? "Verify current federal or state-plan safety language, effective date, and task-specific exposure."
        : source.id.includes("icc")
          ? "Verify model code year, local adoption, amendments, errata, and applicable chapter/section pointer."
          : "Verify edition, status, license access, section pointer, and permitted citation use.";
  return {
    id: source.id,
    name: source.name,
    url: source.url,
    authority: source.authority,
    checkedAt: new Date().toISOString(),
    status: "Live source target",
    guidance,
    matches: topicHits.length ? topicHits : ["manual review"]
  };
}

function buildEvidenceChecklist(jargonHits, sources) {
  const proof = jargonHits.flatMap((hit) => hit.proofNeeded || []);
  const sourceProof = sources.map((source) => `${source.name} pointer`);
  return [...new Set([...proof, ...sourceProof, "reviewer/date checked", "linked estimate or invoice line"])].slice(0, 12);
}

function learnJargonFromText(text, hits = []) {
  const now = new Date().toISOString();
  const phrases = new Set();
  hits.forEach((hit) => phrases.add(hit.phrase.toLowerCase()));
  String(text || "")
    .split(/[,.;:\n]/)
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length >= 4 && part.length <= 70)
    .forEach((part) => {
      if (/not |excess|warrant|standard|pre-existing|wear|tear|duplicate|code|ppe|equipment|documentation|unsupported|reasonable|necessary/.test(part)) {
        phrases.add(part);
      }
    });
  state.learnedJargon = [...phrases].reduce((terms, phrase) => {
    const existing = terms.find((term) => term.phrase.toLowerCase() === phrase);
    if (existing) {
      existing.count = Number(existing.count || 0) + 1;
      existing.lastSeen = now;
      existing.source = existing.source || "learned";
      return terms;
    }
    const seeded = adjusterJargonLibrary.find((entry) => entry.phrase.toLowerCase() === phrase);
    terms.unshift({
      id: createId("JG"),
      phrase,
      intent: seeded?.intent || "Learned reviewer phrase from pasted response.",
      responseFrame: seeded?.responseFrame || "Use facts, source-check targets, and evidence mapping to answer the phrase.",
      proofNeeded: seeded?.proofNeeded || ["photos", "estimate line", "reviewer response"],
      count: 1,
      source: "learned",
      lastSeen: now
    });
    return terms;
  }, [...state.learnedJargon]).slice(0, 80);
}

function buildRebuttalDraft({ issue, facts, jurisdiction, trade, jobType, requestedOutcome, jargonHits, sources, evidenceChecklist }) {
  const sourceNames = sources.map((source) => source.name).join(", ");
  const jargonSummary = jargonHits.map((hit) => `${hit.phrase}: ${hit.intent}`).join("; ");
  const proofSummary = evidenceChecklist.slice(0, 7).join(", ");
  return [
    `Position: We do not agree with the reduction as stated. The reviewer language appears to be ${jargonSummary}. The response should be decided from job-specific facts, documented conditions, and source-checked support rather than unsupported shorthand.`,
    `Job facts: ${facts || "Add photos, readings, scope notes, time, equipment, measurements, and communications before sending."} The disputed issue is: ${issue}. Requested outcome: ${requestedOutcome || "restore the supported line item, quantity, duration, or scope."}`,
    `Source path: Check ${sourceNames}. For code or safety claims, verify ${jurisdiction}; for restoration or trade practice claims, verify the applicable standard edition and permitted citation use. Record section pointer, edition, URL/source, reviewer, and date checked.`,
    `Evidence index to attach: ${proofSummary}. Each disputed charge should show fact observed, task performed, quantity/duration, location, supporting file, and invoice or estimate line connection.`,
    `Sendable response: Please identify the specific source, section, estimate line, measurement, or job fact used to support the reduction. Our file supports the disputed item through the attached evidence index and source-check path. Unless a contrary job-specific basis is provided, the supported amount should be restored or reviewed with the documented facts listed above.`,
    "Review gate: owner/estimator approval is required before this is sent externally."
  ];
}

function modeLabel(mode) {
  const labels = {
    rebuttal: "Rebuttal draft",
    "code-search": "Code search",
    justification: "Justification response",
    checklist: "Compliance checklist"
  };
  return labels[mode] || "AI standards response";
}

function buildStandardsOutput(formData) {
  const moduleKey = String(formData.get("moduleKey") || state.activeKey);
  const mode = String(formData.get("mode") || "code-search");
  const issue = String(formData.get("issue") || "").trim() || "Standards-backed support request";
  const facts = String(formData.get("facts") || "").trim();
  const adjusterJargon = String(formData.get("adjusterJargon") || "").trim();
  const requestedOutcome = String(formData.get("requestedOutcome") || "").trim();
  const jurisdiction = String(formData.get("jurisdiction") || "").trim() || "Verify local AHJ";
  const trade = String(formData.get("trade") || "").trim() || "Building services";
  const jobType = String(formData.get("jobType") || "").trim() || "Job file";
  const selectedIds = formData.getAll("sourceIds").map(String);
  const query = `${issue} ${adjusterJargon} ${facts} ${jurisdiction} ${trade} ${jobType} ${requestedOutcome}`;
  const sources = rankedStandardsSources(query, mode, selectedIds);
  const jargonHits = detectAdjusterJargon(query);
  const sourceChecks = sources.map((source) => sourceCheckStatus(source, query));
  const evidenceChecklist = buildEvidenceChecklist(jargonHits, sources);
  learnJargonFromText(query, jargonHits);
  const title = `${modeLabel(mode)} - ${issue.slice(0, 54)}`;
  const sourceNames = sources.map((source) => source.name).join(", ");
  const draftLead =
    mode === "rebuttal"
      ? "Draft rebuttal position"
      : mode === "justification"
        ? "Draft justification response"
        : mode === "checklist"
          ? "Draft compliance checklist"
          : "Draft code search map";
  const draft =
    mode === "rebuttal"
      ? buildRebuttalDraft({ issue, facts, jurisdiction, trade, jobType, requestedOutcome, jargonHits, sources, evidenceChecklist })
      : [
          `${draftLead}: Based on the stated facts, search and cite ${sourceNames} before external use. Tie each charge, scope item, or safety step to the job condition, photos, measurements, time entries, equipment logs, and the official source pointer.`,
          `Adjuster/reviewer language detected: ${jargonHits.map((hit) => `${hit.phrase} (${hit.intent})`).join("; ")}.`,
          `Jurisdiction handling: ${jurisdiction}. Confirm adopted model-code year, local amendments, permits, and AHJ guidance before making a code claim.`,
          `Recommended response structure: fact observed, work performed, source searched, section pointer, why the item was necessary, cost or invoice connection, reviewer, and date checked.${facts ? ` Job facts supplied: ${facts}` : ""}`,
          `Evidence checklist: ${evidenceChecklist.join(", ")}.`,
          "Guardrail: this draft is not legal advice and does not replace a licensed professional, code official, industrial hygienist, safety professional, or attorney review."
        ];

  return {
    id: createId("AI-CODE"),
    moduleKey,
    mode,
    title,
    jurisdiction,
    trade,
    jobType,
    issue,
    facts,
    adjusterJargon,
    requestedOutcome,
    generatedAt: new Date().toISOString(),
    sourceIds: sources.map((source) => source.id),
    sourceChecks,
    jargonHits,
    evidenceChecklist,
    draft,
    review: [
      "Verify official source, section, edition, and date checked",
      "Confirm jurisdiction and local amendments",
      "Use only licensed/permitted standard text",
      "Human approval required before sending"
    ]
  };
}

function standardsOutputText(output) {
  const sources = output.sourceIds.map(sourceById).filter(Boolean);
  return [
    output.title,
    `Generated: ${formatTime(output.generatedAt)}`,
    `Mode: ${modeLabel(output.mode)}`,
    `Jurisdiction: ${output.jurisdiction}`,
    `Trade: ${output.trade}`,
    `Job type: ${output.jobType}`,
    "",
    "Draft:",
    ...output.draft.map((line) => `- ${line}`),
    "",
    "Adjuster language:",
    ...((output.jargonHits || []).map((hit) => `- ${hit.phrase}: ${hit.intent}`)),
    "",
    "Evidence checklist:",
    ...((output.evidenceChecklist || []).map((item) => `- ${item}`)),
    "",
    "Live source check targets:",
    ...((output.sourceChecks || []).map((check) => `- ${check.name}: ${check.url} (${check.guidance})`)),
    "",
    "Sources:",
    ...sources.map((source) => `- ${source.name}: ${source.url} (${source.access})`),
    "",
    "Review gates:",
    ...output.review.map((line) => `- ${line}`)
  ].join("\n");
}

function saveStandardsOutputAsFile(id) {
  const output = state.standardsOutputs.find((item) => item.id === id);
  if (!output) return;
  createFile({
    moduleKey: output.moduleKey || state.activeKey,
    linkedModuleKeys: ["compliance", "defensibility", "supplement", "evidencechain"],
    sourceType: "standardsOutput",
    sourceId: output.id,
    title: output.title,
    type: "AI standards draft",
    owner: "Compliance AI",
    status: "Needs review",
    priority: "High",
    due: today.toISOString().slice(0, 10),
    relatedJob: output.jobType,
    notes: standardsOutputText(output)
  });
}

async function copyStandardsOutput(id) {
  const output = state.standardsOutputs.find((item) => item.id === id);
  if (!output) return;
  const text = standardsOutputText(output);
  try {
    await navigator.clipboard.writeText(text);
    setToast("Draft copied");
    render();
  } catch {
    state.modal = { type: "export" };
    setToast("Clipboard blocked; use export");
    render();
  }
}

function saveGeneratedStandardsOutput(output, toastText = "AI source draft generated") {
  state.standardsOutputs = [output, ...state.standardsOutputs].slice(0, 24);
  addActivity(`Generated ${modeLabel(output.mode)} from standards sources for ${output.issue}.`);
  persist();
  setToast(toastText);
  render();
}

function generateStandardsFromButton(button, forcedMode, toastText) {
  const form = button.closest('form[data-form="standards-ai"]');
  if (!form) return;
  if (forcedMode && form.elements.mode) form.elements.mode.value = forcedMode;
  if (form.reportValidity && !form.reportValidity()) return;
  const output = buildStandardsOutput(new FormData(form));
  saveGeneratedStandardsOutput(output, toastText);
}

function workflowTaskKey(task) {
  if (!task.sourceId) return "";
  return [task.sourceType || "workflow", task.sourceId, task.moduleKey, task.title].join(":");
}

function ensureWorkflowTask(taskData) {
  const module = moduleByKey(taskData.moduleKey);
  if (!module) return null;
  const task = {
    id: createId("TASK"),
    title: String(taskData.title || `${module.label} follow-up`).trim(),
    assigneeId: taskData.assigneeId || state.teamMembers[0]?.id || "",
    moduleKey: module.key,
    relatedJob: String(taskData.relatedJob || "").trim(),
    due: taskData.due || today.toISOString().slice(0, 10),
    status: taskData.status || "Open",
    priority: taskData.priority || "Medium",
    sourceType: taskData.sourceType || "workflow",
    sourceId: taskData.sourceId || "",
    workflowKey: ""
  };
  task.workflowKey = workflowTaskKey(task);
  if (task.workflowKey && state.tasks.some((item) => item.workflowKey === task.workflowKey && item.status !== "Complete")) {
    return null;
  }
  state.tasks = [task, ...state.tasks];
  return task;
}

function ensureWorkflowTasks(tasks) {
  return tasks.map(ensureWorkflowTask).filter(Boolean);
}

function createFile(data) {
  const module = moduleByKey(data.moduleKey || state.activeKey) || activeModule();
  const now = new Date().toISOString();
  const linkedModuleKeys = normalizeModuleKeyList(data.linkedModuleKeys || data.linkedModules || [], module.key);
  const linkedLabels = linkedModuleKeys.map((key) => moduleByKey(key)?.label || key);
  const file = {
    id: createId("F"),
    moduleKey: module.key,
    linkedModuleKeys,
    sourceType: data.sourceType || "",
    sourceId: data.sourceId || "",
    customer: String(data.customer || "").trim(),
    amount: parseAmount(data.amount),
    title: data.title?.trim() || `${module.label} file`,
    type: data.type || suggestedFileType(module),
    owner: data.owner?.trim() || (state.worker?.name || "Office"),
    status: data.status || "Open",
    priority: data.priority || "Medium",
    due: data.due || "",
    relatedJob: data.relatedJob?.trim() || "",
    notes: data.notes?.trim() || "",
    createdAt: now,
    updatedAt: now,
    history: [`Created in ${module.label}`, ...(linkedLabels.length ? [`Visible in ${linkedLabels.join(", ")}`] : [])]
  };
  state.files = [file, ...state.files];
  state.selectedFileId = file.id;
  addActivity(`Created ${file.title} in ${module.label}.`);
  persist();
  setToast("File created");
  closeModal();
  return file;
}

function suggestedFileType(module) {
  const map = {
    jobs: "Job",
    property: "Property file",
    revenue: "Revenue packet",
    field: "Field record",
    finance: "Finance record",
    dispatch: "Dispatch item",
    documents: "Document",
    compliance: "Compliance file",
    vendors: "Vendor file",
    marketing: "Campaign",
    reports: "Report",
    security: "Security review",
    licensing: "License file",
    ai: "AI review",
    automation: "Automation rule"
  };
  return map[module.category] || "Workspace file";
}

function openCreateFile(moduleKey = state.activeKey) {
  state.modal = { type: "create-file", moduleKey };
  render();
}

function closeModal() {
  if (state.modal?.type === "admin-edit") {
    state.adminEditMode = false;
  }
  state.modal = null;
  render();
}

function updateFileStatus(fileId, status) {
  const file = state.files.find((item) => item.id === fileId);
  if (!file) {
    setToast("That file is no longer available.");
    return render();
  }
  file.status = status;
  file.updatedAt = new Date().toISOString();
  file.history = [`Status changed to ${status}`, ...(file.history || [])];
  addActivity(`${file.title} moved to ${status}.`);
  persist();
  setToast("File updated");
  render();
}

function duplicateFile(fileId) {
  const file = state.files.find((item) => item.id === fileId);
  if (!file) {
    setToast("That file is no longer available.");
    return render();
  }
  const now = new Date().toISOString();
  const copy = {
    ...file,
    id: createId("F"),
    title: `${file.title} copy`,
    status: "Open",
    createdAt: now,
    updatedAt: now,
    history: [`Duplicated from ${file.id}`]
  };
  state.files = [copy, ...state.files];
  state.selectedFileId = copy.id;
  addActivity(`Duplicated ${file.title}.`);
  persist();
  setToast("File duplicated");
  render();
}

function deleteFile(fileId) {
  const file = state.files.find((item) => item.id === fileId);
  if (!file) {
    setToast("That file is no longer available.");
    return render();
  }
  state.files = state.files.filter((item) => item.id !== fileId);
  if (state.selectedFileId === fileId) state.selectedFileId = null;
  addActivity(`Deleted ${file.title}.`);
  persist();
  setToast("File deleted");
  render();
}

function completeQueue(id) {
  const item = state.queue.find((entry) => entry.id === id);
  if (!item) {
    setToast("That queue item is no longer available.");
    return render();
  }
  state.queue = state.queue.filter((entry) => entry.id !== id);
  addActivity(`Completed queue item: ${item.label}.`);
  persist();
  setToast("Queue item cleared");
  render();
}

function requestGps() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve({ label: "GPS unavailable", latitude: null, longitude: null, accuracy: null });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        resolve({
          label: `${latitude.toFixed(5)}, ${longitude.toFixed(5)} (${Math.round(accuracy)}m)`,
          latitude,
          longitude,
          accuracy
        });
      },
      () => resolve({ label: "GPS permission not granted", latitude: null, longitude: null, accuracy: null }),
      { enableHighAccuracy: true, maximumAge: 60000, timeout: 7000 }
    );
  });
}

function invoiceFileOptions() {
  return state.files.filter((file) => {
    const haystack = `${file.moduleKey} ${file.title} ${file.type} ${file.notes}`.toLowerCase();
    return haystack.includes("invoice") || file.moduleKey === "payments";
  });
}

function equipmentCharge(deployment) {
  const days = Number(deployment.rentalDays || 0);
  const rate = Number(deployment.dailyRate || 0);
  return Math.max(0, days * rate);
}

function jobByJobId(jobId) {
  const target = String(jobId || "").toLowerCase();
  return state.jobBoards.find((job) => [job.id, job.jobId, job.title].some((value) => String(value || "").toLowerCase() === target));
}

function jobByLog(log) {
  return jobByJobId(log.jobId) || state.jobBoards.find((job) => String(log.jobTitle || "").toLowerCase().includes(String(job.title || "").toLowerCase()));
}

function dryLogsForJob(jobId) {
  const target = String(jobId || "").toLowerCase();
  return state.dryLogs
    .filter((log) => String(log.jobId || "").toLowerCase() === target || String(log.jobTitle || "").toLowerCase().includes(target))
    .sort((a, b) => new Date(b.readingDate || b.createdAt || 0) - new Date(a.readingDate || a.createdAt || 0));
}

function latestDryLogForJob(jobId) {
  return dryLogsForJob(jobId)[0] || null;
}

function dryLogGap(log) {
  return Math.max(0, Number(log.moisture || 0) - Number(log.targetMoisture || 0));
}

function dryLogStatus(log) {
  if (!log) return "No logs";
  if (dryLogGap(log) <= 0) return "At target";
  if (dryLogGap(log) <= 2) return "Monitor";
  return "Drying";
}

function dryLogEquipmentNames(log) {
  const ids = Array.isArray(log.equipmentIds) ? log.equipmentIds : String(log.equipmentIds || "").split(",").map((item) => item.trim()).filter(Boolean);
  return ids
    .map((id) => state.equipmentDeployments.find((deployment) => deployment.id === id || deployment.assetTag === id || deployment.equipmentName === id))
    .filter(Boolean)
    .map((deployment) => `${deployment.equipmentName} (${deployment.assetTag || deployment.id})`);
}

function dryLogSummaryForJob(job) {
  const logs = dryLogsForJob(job.jobId);
  const latest = logs[0];
  const openReadings = logs.filter((log) => dryLogGap(log) > 0).length;
  const avgMoisture = logs.length ? logs.reduce((sum, log) => sum + Number(log.moisture || 0), 0) / logs.length : 0;
  const avgTarget = logs.length ? logs.reduce((sum, log) => sum + Number(log.targetMoisture || 0), 0) / logs.length : 0;
  return {
    logs,
    latest,
    status: dryLogStatus(latest),
    openReadings,
    avgMoisture,
    avgTarget,
    gap: latest ? dryLogGap(latest) : 0
  };
}

function updateDryLogGate(jobId) {
  const job = jobByJobId(jobId);
  const gate = job?.gates?.find((item) => item.id === "drylogs");
  if (!gate || !job) return;
  job.linkedModules = Array.isArray(job.linkedModules) ? job.linkedModules : [];
  const summary = dryLogSummaryForJob(job);
  if (!summary.logs.length) gate.status = "Blocked";
  else if (summary.gap <= 0) gate.status = "Done";
  else gate.status = "Open";
  if (!job.linkedModules.includes("drylogs")) job.linkedModules = ["drylogs", ...job.linkedModules];
}

function copilotMetrics() {
  applyHighestPricingPolicy();
  const hours = state.timeEntries.reduce((sum, entry) => sum + Number(entry.hours || 0), 0);
  const equipmentRevenue = state.equipmentDeployments.reduce((sum, deployment) => sum + equipmentCharge(deployment), 0);
  const openTasks = state.tasks.filter((task) => task.status !== "Complete").length;
  const blockedGates = jobGateCounts().blocked;
  const activePrices = activePriceItems().length;
  const dryOpen = state.dryLogs.filter((log) => dryLogGap(log) > 0).length;
  return {
    modules: modules.length,
    files: state.files.length,
    jobs: state.jobBoards.length,
    openTasks,
    blockedGates,
    hours,
    equipmentRevenue,
    activePrices,
    dryOpen,
    receivables: Number(state.performanceMetrics.openReceivables || 0),
    delayedInvoices: Number(state.performanceMetrics.invoicesDelayed || 0),
    unbilledItems: Number(state.performanceMetrics.unbilledItems || 0),
    profit: Number(state.performanceMetrics.jobProfit || 0)
  };
}

function workspaceSearch(query) {
  const tokens = tokenize(query);
  if (!tokens.length) return [];
  const records = [
    ...modules.map((module) => ({ type: "Module", title: module.label, detail: module.purpose, key: module.key })),
    ...state.files.map((file) => ({ type: "File", title: file.title, detail: `${file.moduleKey} ${file.type} ${file.status} ${file.notes}`, key: file.moduleKey })),
    ...state.jobBoards.map((job) => ({ type: "Job", title: `${job.jobId} ${job.title}`, detail: `${job.customer} ${job.property} ${job.stage} ${job.nextAction} ${job.blockers}`, key: "jobs" })),
    ...state.tasks.map((task) => ({ type: "Task", title: task.title, detail: `${task.moduleKey} ${task.relatedJob} ${task.priority} ${task.status}`, key: task.moduleKey })),
    ...state.priceItems.map((item) => ({ type: "Price", title: `${item.code} ${item.name}`, detail: `${item.category} ${item.unit} ${item.rate} ${item.justification}`, key: "pricing" })),
    ...state.dryLogs.map((log) => ({ type: "Dry log", title: `${log.jobId} ${log.room}`, detail: `${log.material} ${log.moisture}/${log.targetMoisture} ${log.status} ${log.notes}`, key: "drylogs" })),
    ...state.contacts.map((contact) => ({ type: "Contact", title: contact.name, detail: `${contact.role} ${contact.organization} ${contact.property} ${contact.notes}`, key: "relationships" }))
  ];
  return records
    .map((record) => {
      const haystack = `${record.type} ${record.title} ${record.detail}`.toLowerCase();
      const score = tokens.reduce((sum, token) => sum + (haystack.includes(token) ? 1 : 0), 0);
      return { ...record, score };
    })
    .filter((record) => record.score > 0)
    .sort((a, b) => b.score - a.score || a.type.localeCompare(b.type))
    .slice(0, 6);
}

function parseMathExpression(expression) {
  const tokens = String(expression || "").replace(/[$,]/g, "").match(/\d+(?:\.\d+)?|[()+\-*/]/g);
  if (!tokens?.length) return null;
  let index = 0;
  const peek = () => tokens[index];
  const take = () => tokens[index++];
  const factor = () => {
    const token = take();
    if (token === "(") {
      const value = expr();
      if (peek() === ")") take();
      return value;
    }
    if (token === "-") return -factor();
    const number = Number(token);
    if (!Number.isFinite(number)) throw new Error("Bad number");
    return number;
  };
  const term = () => {
    let value = factor();
    while (peek() === "*" || peek() === "/") {
      const op = take();
      const next = factor();
      value = op === "*" ? value * next : value / next;
    }
    return value;
  };
  const expr = () => {
    let value = term();
    while (peek() === "+" || peek() === "-") {
      const op = take();
      const next = term();
      value = op === "+" ? value + next : value - next;
    }
    return value;
  };
  try {
    const value = expr();
    return index >= tokens.length && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function extractMathQuestion(query) {
  const cleaned = String(query || "").replace(/x/gi, "*");
  const explicit = cleaned.match(/(?:calculate|calc|math|what is|what's)\s+([0-9$,.+\-*/()\s]+)/i);
  if (explicit) return explicit[1];
  const loose = cleaned.match(/([0-9$,.]+(?:\s*[+\-*/]\s*[0-9$,.]+){1,})/);
  return loose ? loose[1] : "";
}

function recordCountForVault(vault) {
  const key = vault.records;
  if (key === "standardsSources") return standardsSources.length;
  if (key === "quickBooksConnection") return state.quickBooksConnection.connected ? 1 : 0;
  const value = state[key];
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object") return Object.keys(value).length;
  return 0;
}

function readinessBand(score) {
  if (score >= 88) return "Institutional-grade prototype";
  if (score >= 76) return "Investable with integration diligence";
  if (score >= 62) return "Promising but needs hardening";
  return "Early platform risk";
}

function calculateInstitutionalReadiness() {
  const specializedModules = ["jobs", "drylogs", "pricing", "payments", "team", "sketch", "defensibility", "supplement", "accounting", "equipment", "relationships", "branches"]
    .filter((key) => moduleByKey(key)).length;
  const moduleCoverage = Math.min(100, Math.round((modules.length / 130) * 74 + specializedModules * 2));
  const activeSkills = state.skillPacks.filter((skill) => skill.status === "Active").length;
  const liveVaults = state.dataVaults.filter((vault) => /live|ready|connector/i.test(vault.status)).length;
  const dataDepth = Math.min(
    100,
    Math.round(
      state.files.length * 1.5 +
        state.priceItems.length * 0.6 +
        state.dryLogs.length * 7 +
        state.jobBoards.length * 6 +
        state.equipmentDeployments.length * 5 +
        state.learnedJargon.length * 2 +
        standardsSources.length * 2
    )
  );
  const workflowProof = Math.min(100, Math.round((state.files.length + state.tasks.length + state.queue.length + state.standardsOutputs.length + state.xactimateImports.length + state.serviceRequests.length + state.calloutSchedule.length) * 3.2));
  const monetization = Math.min(
    100,
    Math.round(
      (state.performanceMetrics.openReceivables > 0 ? 24 : 0) +
        (state.performanceMetrics.cashIn > 0 ? 22 : 0) +
        (state.priceItems.length > 4 ? 18 : 0) +
        (state.quickBooksConnection.connected ? 18 : 8) +
        (state.performanceMetrics.jobProfit > 0 ? 18 : 0)
    )
  );
  const trust = Math.min(
    100,
    Math.round(
      (state.accountProfile?.adminAccount ? 18 : 0) +
        (state.accountProfile?.employeePortal ? 18 : 0) +
        (state.teamMembers.some((member) => member.accountType === "Administrator") ? 16 : 0) +
        (state.activity.length > 5 ? 16 : 0) +
        (state.standardsOutputs.length > 0 ? 16 : 0) +
        (state.files.some((file) => /packet|invoice|dry log|compliance/i.test(`${file.type} ${file.title}`)) ? 16 : 0)
    )
  );
  const performance = Math.min(
    100,
    Math.round(
      30 +
        (modules.length <= 150 ? 18 : 8) +
        (JSON.stringify(state).length < 750000 ? 18 : 8) +
        (state.actionDashboard.selectedKeys.length <= 12 ? 12 : 7) +
        (activeSkills >= 6 ? 12 : activeSkills * 2) +
        (liveVaults >= 8 ? 10 : liveVaults)
    )
  );
  const aiData = Math.min(100, Math.round(activeSkills * 8 + liveVaults * 4 + state.aiCopilotMemory.length * 1.5 + state.learnedJargon.length * 1.5));
  const score = Math.round(moduleCoverage * 0.16 + workflowProof * 0.18 + dataDepth * 0.17 + monetization * 0.14 + trust * 0.14 + performance * 0.11 + aiData * 0.1);
  const categories = [
    { label: "Module coverage", score: moduleCoverage, detail: `${modules.length} modules with ${specializedModules} high-value custom workspaces.` },
    { label: "Workflow proof", score: workflowProof, detail: `${state.files.length} files, ${state.tasks.length} tasks, ${state.standardsOutputs.length} AI/source outputs, ${state.xactimateImports.length} imports, ${state.serviceRequests.length} service requests.` },
    { label: "Data depth", score: dataDepth, detail: `${liveVaults} data vaults, ${state.priceItems.length} price rows, ${state.dryLogs.length} dry readings, ${state.learnedJargon.length} jargon terms.` },
    { label: "Monetization", score: monetization, detail: `${formatMoney(state.performanceMetrics.openReceivables)} receivables, ${state.performanceMetrics.invoicesDelayed} delayed invoices, ${formatMoney(estimateSubtotal())} estimate draft.` },
    { label: "Trust and admin", score: trust, detail: "Administrator account, employee portal, activity trail, compliance outputs, and packet files are present." },
    { label: "Performance readiness", score: performance, detail: `${modules.length} modules, ${Math.round(JSON.stringify(state).length / 1024)}KB local workspace, ${state.actionDashboard.selectedKeys.length} action cards.` },
    { label: "AI/data engine", score: aiData, detail: `${activeSkills} active skill packs, ${state.dataVaults.length} data vaults, ${state.aiCopilotMemory.length} Copilot memories.` }
  ];
  const risks = [
    !state.quickBooksConnection.connected ? "QuickBooks is gateway-ready but not connected to a real OAuth backend." : "",
    "Hosted multi-tenant backend, database migrations, API security, and production auth still need a real server implementation.",
    "Browser-local storage is useful for prototype speed but not enough for institutional scale or compliance retention.",
    "Document/PDF/ESX extraction should be moved to a hardened backend worker for large-file throughput and provenance.",
    "Live licensed standards access should use customer-owned subscriptions and citation-safe excerpts."
  ].filter(Boolean);
  const strengths = [
    "Strong restoration-specific wedge: Xactimate pricing, dry logs, rebuttals, equipment billing, GPS time, and job gates are connected.",
    "Action dashboard compresses the operating system into investor-readable live previews.",
    "Brother Copilot is state-aware and can reason over jobs, pricing, dry logs, money, tasks, and compliance source targets.",
    "Admin/employee split and module permissions make the field portal safer than a full-software login.",
    "The product direction supports both owner workflow and defensible revenue recovery."
  ];
  return {
    score,
    verdict: readinessBand(score),
    categories,
    risks,
    strengths,
    activeSkills,
    liveVaults,
    generatedAt: new Date().toISOString()
  };
}

function runInstitutionalReview() {
  const review = calculateInstitutionalReadiness();
  state.institutionalReview = {
    lastRun: review.generatedAt,
    score: review.score,
    verdict: review.verdict,
    focus: "Institutional investor diligence",
    notes: [...review.strengths, ...review.risks]
  };
  addActivity(`Ran institutional investor diligence: ${review.score}/100 ${review.verdict}.`);
  persist();
  setToast(`Investor readiness ${review.score}/100`);
  render();
}

function investorReportText(review = calculateInstitutionalReadiness()) {
  return [
    `Institutional Investor Diligence - Brothers OS`,
    `Generated: ${formatTime(review.generatedAt)}`,
    `Verdict: ${review.verdict}`,
    `Score: ${review.score}/100`,
    "",
    "Category scores:",
    ...review.categories.map((item) => `- ${item.label}: ${item.score}/100. ${item.detail}`),
    "",
    "Strengths:",
    ...review.strengths.map((item) => `- ${item}`),
    "",
    "Risks / diligence items:",
    ...review.risks.map((item) => `- ${item}`),
    "",
    "Data vaults:",
    ...state.dataVaults.map((vault) => `- ${vault.name}: ${vault.status}, ${recordCountForVault(vault)} records/signals. ${vault.coverage}`),
    "",
    "Skill packs:",
    ...state.skillPacks.map((skill) => `- ${skill.name}: ${skill.status}. ${skill.capability}`)
  ].join("\n");
}

function createInvestorReport() {
  const review = calculateInstitutionalReadiness();
  state.institutionalReview = {
    lastRun: review.generatedAt,
    score: review.score,
    verdict: review.verdict,
    focus: "Institutional investor diligence",
    notes: [...review.strengths, ...review.risks]
  };
  createFile({
    moduleKey: "daily",
    linkedModuleKeys: ["globalindexes", "reports", "businesshealth", "proofvalue"],
    sourceType: "institutionalReview",
    sourceId: review.generatedAt,
    title: `Institutional diligence report ${today.toISOString().slice(0, 10)}`,
    type: "Investor diligence",
    owner: "Owner",
    status: "Needs review",
    priority: review.score >= 76 ? "Medium" : "High",
    due: today.toISOString().slice(0, 10),
    relatedJob: "Platform",
    notes: investorReportText(review)
  });
}

function toggleSkillPack(skillId) {
  const skill = state.skillPacks.find((item) => item.id === skillId);
  if (!skill) return;
  skill.status = skill.status === "Active" ? "Staged" : "Active";
  addActivity(`${skill.name} moved to ${skill.status}.`);
  persist();
  setToast("Skill pack updated");
  render();
}

function toggleDataVault(vaultId) {
  const vault = state.dataVaults.find((item) => item.id === vaultId);
  if (!vault) return;
  vault.status = /live/i.test(vault.status) ? "Connector-ready" : "Live";
  addActivity(`${vault.name} data vault moved to ${vault.status}.`);
  persist();
  setToast("Data vault updated");
  render();
}

function servicePriority(urgency = "") {
  const text = String(urgency || "").toLowerCase();
  if (text.includes("emergency") || text.includes("same day")) return "High";
  if (text.includes("week")) return "Medium";
  return "Medium";
}

function serviceEmailSubject(request) {
  return `Service request: ${request.urgency} - ${request.name}`;
}

function serviceEmailBody(request) {
  return [
    `New service request ${request.id}`,
    "",
    `Name: ${request.name}`,
    `Phone: ${request.phone || "Not provided"}`,
    `Email: ${request.email || "Not provided"}`,
    `Address: ${request.address || "Not provided"}`,
    `Service type: ${request.serviceType}`,
    `Urgency: ${request.urgency}`,
    `Preferred callout: ${formatDate(request.preferredDate)} ${request.preferredTime || ""}`,
    "",
    "Notes:",
    request.notes || "No notes entered.",
    "",
    `Created: ${formatTime(request.createdAt)}`,
    "Source: Brothers OS request service button"
  ].join("\n");
}

function serviceEmailHref(request) {
  const email = state.serviceSettings.ownerEmail || state.accountProfile.adminAccount.email || "owner@example.com";
  const safeEmail = String(email).replace(/[^\w.@+\-]/g, "");
  return `mailto:${safeEmail}?subject=${encodeURIComponent(serviceEmailSubject(request))}&body=${encodeURIComponent(serviceEmailBody(request))}`;
}

function addServiceRequest(formData) {
  const notifyEmail = String(formData.get("notifyEmail") || state.serviceSettings.ownerEmail || state.accountProfile.adminAccount.email || "").trim();
  if (notifyEmail) state.serviceSettings.ownerEmail = notifyEmail;
  const request = {
    id: createId("SR"),
    name: String(formData.get("name") || "Service request").trim(),
    phone: String(formData.get("phone") || "").trim(),
    email: String(formData.get("email") || "").trim(),
    address: String(formData.get("address") || "").trim(),
    serviceType: String(formData.get("serviceType") || "General service"),
    urgency: String(formData.get("urgency") || "Call back"),
    preferredDate: String(formData.get("preferredDate") || today.toISOString().slice(0, 10)),
    preferredTime: String(formData.get("preferredTime") || "09:00"),
    notes: String(formData.get("notes") || "").trim(),
    sourceModule: state.activeKey,
    status: "New - email prepared",
    notificationEmail: notifyEmail || "owner@example.com",
    createdAt: new Date().toISOString()
  };
  const schedule = {
    id: createId("CALL"),
    requestId: request.id,
    title: `${request.name} callout`,
    date: request.preferredDate,
    time: request.preferredTime,
    durationMinutes: Number(state.serviceSettings.defaultCalloutMinutes || 60),
    status: "Requested",
    assignee: state.serviceSettings.notifyName || "Owner dispatch",
    address: request.address,
    contact: request.phone || request.email,
    notes: request.notes
  };
  state.serviceRequests = [request, ...state.serviceRequests];
  state.calloutSchedule = [schedule, ...state.calloutSchedule];
  state.queue = [
    {
      id: createId("Q"),
      moduleKey: "dispatch",
      label: `Callout request: ${request.name}`,
      detail: `${request.urgency} ${request.serviceType} at ${request.address || "address pending"}. Email prepared for ${request.notificationEmail}.`,
      priority: servicePriority(request.urgency)
    },
    ...state.queue
  ];
  state.tasks = [
    {
      id: createId("TASK"),
      title: `Call ${request.name} for service request`,
      assigneeId: state.teamMembers.find((member) => /owner|admin/i.test(`${member.role} ${member.accountType}`))?.id || state.teamMembers[0]?.id || "",
      moduleKey: "dispatch",
      relatedJob: request.id,
      due: request.preferredDate,
      status: "Open",
      priority: servicePriority(request.urgency),
      sourceType: "serviceRequest",
      sourceId: request.id,
      workflowKey: `serviceRequest:${request.id}:dispatch:Call ${request.name} for service request`
    },
    ...state.tasks
  ];
  addActivity(`Service request ${request.id} created for ${request.name}; email prepared for ${request.notificationEmail} and callout added to schedule.`);
  createFile({
    moduleKey: "universalintake",
    linkedModuleKeys: ["dispatch", "communications", "relationships", "properties", "jobs"],
    sourceType: "serviceRequest",
    sourceId: request.id,
    customer: request.name,
    title: `${request.name} service request`,
    type: "Service request",
    owner: "Dispatch",
    status: request.status,
    priority: servicePriority(request.urgency),
    due: request.preferredDate,
    relatedJob: request.id,
    notes: [
      serviceEmailBody(request),
      "",
      `Notification mode: ${state.serviceSettings.notificationMode}`,
      `Backend endpoint target: ${state.serviceSettings.backendEndpoint}`,
      `Email link: ${serviceEmailHref(request)}`
    ].join("\n")
  });
}

function markCalloutScheduled(calloutId) {
  const callout = state.calloutSchedule.find((item) => item.id === calloutId);
  if (!callout) return;
  callout.status = "Scheduled";
  const request = state.serviceRequests.find((item) => item.id === callout.requestId);
  if (request) request.status = "Scheduled";
  addActivity(`${callout.title} marked scheduled.`);
  persist();
  setToast("Callout scheduled");
  render();
}

function completeServiceRequest(requestId) {
  const request = state.serviceRequests.find((item) => item.id === requestId);
  if (request) request.status = "Closed";
  state.calloutSchedule = state.calloutSchedule.map((item) => (item.requestId === requestId ? { ...item, status: "Complete" } : item));
  addActivity(`Service request ${requestId} closed.`);
  persist();
  setToast("Service request closed");
  render();
}

function formatMoney(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value || 0));
}

function parseAmount(value) {
  const number = Number(String(value || "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function normalizePriceToken(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function priceKeyForItem(item) {
  const code = normalizePriceToken(item.code);
  if (code) return code;
  return [item.category, item.name, item.unit].map(normalizePriceToken).filter(Boolean).join("|");
}

function inferPricingDate(sourceName = "", fallback = new Date().toISOString()) {
  const text = String(sourceName || "").toLowerCase();
  const yearMatch = text.match(/(20\d{2})/);
  const shortYearMatch = text.match(/(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*[-_ ]?(\d{2})(?!\d)/i);
  const monthNames = {
    jan: "01",
    feb: "02",
    mar: "03",
    apr: "04",
    may: "05",
    jun: "06",
    jul: "07",
    aug: "08",
    sep: "09",
    oct: "10",
    nov: "11",
    dec: "12"
  };
  const monthMatch = text.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i);
  const compactDate = text.match(/(20\d{2})[-_ ]?([01]\d)[-_ ]?([0-3]\d)/);
  if (compactDate) return `${compactDate[1]}-${compactDate[2]}-${compactDate[3]}`;
  if (yearMatch || shortYearMatch) {
    const year = yearMatch ? yearMatch[1] : `20${shortYearMatch[1]}`;
    const month = monthMatch ? monthNames[monthMatch[1].slice(0, 3)] : "01";
    return `${year}-${month}-01`;
  }
  return new Date(fallback).toISOString().slice(0, 10);
}

function applyHighestPricingPolicy() {
  const now = new Date().toISOString();
  const groups = new Map();
  state.priceItems = state.priceItems.map((item) => {
    const next = {
      ...item,
      rate: parseAmount(item.rate),
      cost: parseAmount(item.cost),
      unit: item.unit || "each",
      importedAt: item.importedAt || item.createdAt || now,
      pricingDate: item.pricingDate || inferPricingDate(`${item.sourceFile || ""} ${item.branch || ""}`, item.importedAt || now)
    };
    next.priceKey = next.priceKey || priceKeyForItem(next);
    next.pricePolicy = next.pricePolicy || "highest-rate-wins";
    if (!groups.has(next.priceKey)) groups.set(next.priceKey, []);
    groups.get(next.priceKey).push(next);
    return next;
  });
  const activeIds = new Set();
  groups.forEach((items) => {
    const winner = [...items].sort((a, b) => {
      const rateDelta = Number(b.rate || 0) - Number(a.rate || 0);
      if (rateDelta !== 0) return rateDelta;
      return new Date(b.pricingDate || b.importedAt || 0) - new Date(a.pricingDate || a.importedAt || 0);
    })[0];
    if (winner) activeIds.add(winner.id);
  });
  state.priceItems = state.priceItems.map((item) => {
    const group = groups.get(item.priceKey) || [item];
    const highest = Math.max(...group.map((entry) => Number(entry.rate || 0)));
    const latest = group
      .map((entry) => entry.pricingDate || entry.importedAt || "")
      .filter(Boolean)
      .sort()
      .at(-1);
    return {
      ...item,
      activePrice: activeIds.has(item.id),
      highestKnownRate: highest,
      latestKnownPricingDate: latest || item.pricingDate || item.importedAt,
      priceHistoryCount: group.length
    };
  });
}

function activePriceItems() {
  applyHighestPricingPolicy();
  return state.priceItems.filter((item) => item.activePrice !== false);
}

function branchById(id) {
  return state.branches.find((branch) => branch.id === id);
}

function priceItemById(id) {
  applyHighestPricingPolicy();
  const item = state.priceItems.find((entry) => entry.id === id);
  if (!item) return null;
  if (item.activePrice !== false) return item;
  return state.priceItems.find((entry) => entry.priceKey === item.priceKey && entry.activePrice !== false) || item;
}

function estimateLines() {
  return state.estimateDraft.lines
    .map((line) => ({ ...line, item: priceItemById(line.priceItemId) }))
    .filter((line) => line.item);
}

function estimateLineTotal(line) {
  return Number(line.qty || 0) * Number(line.item?.rate || 0);
}

function estimateLineCost(line) {
  return Number(line.qty || 0) * Number(line.item?.cost || 0);
}

function estimateSubtotal() {
  return estimateLines().reduce((sum, line) => sum + estimateLineTotal(line), 0);
}

function jobGateCompletion(job) {
  const gates = Array.isArray(job.gates) ? job.gates : [];
  if (!gates.length) return 0;
  const done = gates.filter((gate) => gate.status === "Done").length;
  return Math.round((done / gates.length) * 100);
}

function jobGateCounts(jobs = state.jobBoards) {
  return jobs.reduce(
    (counts, job) => {
      (job.gates || []).forEach((gate) => {
        counts.total += 1;
        if (gate.status === "Done") counts.done += 1;
        if (gate.status === "Blocked") counts.blocked += 1;
      });
      return counts;
    },
    { total: 0, done: 0, blocked: 0 }
  );
}

function jobTimelineBounds(jobs = state.jobBoards) {
  const dates = jobs
    .flatMap((job) => [job.start, job.end])
    .map((value) => new Date(value))
    .filter((date) => !Number.isNaN(date.getTime()));
  if (!dates.length) {
    return { start: new Date("2026-06-01"), end: new Date("2026-06-15") };
  }
  const start = new Date(Math.min(...dates.map((date) => date.getTime())));
  const end = new Date(Math.max(...dates.map((date) => date.getTime())));
  start.setDate(start.getDate() - 1);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function jobTimelinePosition(job, bounds) {
  const start = new Date(job.start);
  const end = new Date(job.end);
  const range = bounds.end - bounds.start || 1;
  const left = Math.max(0, ((start - bounds.start) / range) * 100);
  const width = Math.max(8, ((end - start) / range) * 100);
  return { left: Math.min(92, left), width: Math.min(100 - left, width) };
}

function toggleJobGate(jobId, gateId) {
  const job = state.jobBoards.find((item) => item.id === jobId);
  const gate = job?.gates?.find((item) => item.id === gateId);
  if (!gate) return;
  const nextStatus = gate.status === "Done" ? "Open" : gate.status === "Open" ? "Blocked" : "Done";
  gate.status = nextStatus;
  addActivity(`${job.jobId} gate "${gate.label}" moved to ${nextStatus}.`);
  persist();
  setToast("Job gate updated");
  render();
}

function addJobRecord(formData) {
  const gates = ["authorization", "deposit", "photos", "time", "equipment", "drylogs", "invoice"].map((id) => ({
    id,
    label:
      {
        authorization: "Signed authorization",
        deposit: "Deposit / deductible",
        photos: "Required photos",
        time: "Labor time matched",
        equipment: "Equipment accounted for",
        drylogs: "Dry logs current",
        invoice: "Invoice ready"
      }[id] || id,
    status: id === "authorization" ? "Done" : "Open"
  }));
  const job = {
    id: createId("JOB"),
    jobId: String(formData.get("jobId") || createId("J")).trim(),
    title: String(formData.get("title") || "New job").trim(),
    branchId: String(formData.get("branchId") || state.branches[0]?.id || ""),
    customer: String(formData.get("customer") || "").trim(),
    property: String(formData.get("property") || "").trim(),
    stage: String(formData.get("stage") || "Intake"),
    owner: String(formData.get("owner") || "Office").trim(),
    start: String(formData.get("start") || today.toISOString().slice(0, 10)),
    end: String(formData.get("end") || today.toISOString().slice(0, 10)),
    nextAction: String(formData.get("nextAction") || "").trim(),
    blockers: String(formData.get("blockers") || "").trim(),
    gates,
    linkedModules: ["universalintake", "photos", "time", "drylogs", "equipment", "payments"]
  };
  state.jobBoards = [job, ...state.jobBoards];
  createFile({
    moduleKey: "jobs",
    linkedModuleKeys: job.linkedModules,
    sourceType: "job",
    sourceId: job.id,
    customer: job.customer,
    title: `${job.jobId} ${job.title}`,
    type: "Job",
    owner: job.owner,
    status: "Active",
    priority: job.blockers ? "High" : "Medium",
    due: job.end,
    relatedJob: job.jobId,
    notes: `Stage: ${job.stage}\nCustomer: ${job.customer}\nProperty: ${job.property}\nNext action: ${job.nextAction}\nBlockers: ${job.blockers || "None"}`
  });
  ensureWorkflowTasks([
    {
      title: `Collect required photos for ${job.jobId}`,
      moduleKey: "photos",
      relatedJob: job.jobId,
      due: job.end,
      priority: "High",
      sourceType: "job",
      sourceId: job.id
    },
    {
      title: `Add first moisture log for ${job.jobId}`,
      moduleKey: "drylogs",
      relatedJob: job.jobId,
      due: job.start,
      priority: "High",
      sourceType: "job",
      sourceId: job.id
    },
    {
      title: `Confirm equipment plan for ${job.jobId}`,
      moduleKey: "equipment",
      relatedJob: job.jobId,
      due: job.start,
      priority: "Medium",
      sourceType: "job",
      sourceId: job.id
    },
    {
      title: `Track labor time for ${job.jobId}`,
      moduleKey: "time",
      relatedJob: job.jobId,
      due: job.start,
      priority: "Medium",
      sourceType: "job",
      sourceId: job.id
    },
    {
      title: `Prepare deposit and invoice path for ${job.jobId}`,
      moduleKey: "payments",
      relatedJob: job.jobId,
      due: job.end,
      priority: job.blockers ? "High" : "Medium",
      sourceType: "job",
      sourceId: job.id
    }
  ]);
  addActivity(`Added job tracker record for ${job.jobId}.`);
  persist();
  render();
}

function currentRoleId() {
  return state.authSession?.roleId || "";
}

function currentPermissions() {
  return state.authSession?.permissions || {};
}

function canDo(action) {
  return Boolean(currentPermissions().actions?.[action]);
}

function tabConfigByKey(key) {
  return state.accessContext?.tabs?.find((tab) => tab.key === key || tab.id === key) || null;
}

function pageSectionById(id) {
  return state.accessContext?.pageSections?.find((section) => section.id === id) || null;
}

function sectionTitle(id, fallback) {
  return pageSectionById(id)?.content?.heading || pageSectionById(id)?.title || fallback;
}

function sectionBody(id, fallback) {
  return pageSectionById(id)?.content?.body || fallback;
}

function sectionButtons(id) {
  return Array.isArray(pageSectionById(id)?.content?.buttons) ? pageSectionById(id).content.buttons : [];
}

function sectionImage(id) {
  return pageSectionById(id)?.imageUrl || "";
}

function allowedModuleKeysForActions() {
  return modules.filter((module) => isModuleAllowedByAccess(module.key)).map((module) => module.key);
}

function canShowModuleAction(key) {
  return Boolean(moduleByKey(key) && isModuleAllowedByAccess(key));
}

function moduleActionLabel(key, fallback = "") {
  const module = moduleByKey(key);
  return fallback || tabConfigByKey(key)?.label || module?.label || key;
}

function renderModuleButton(key, fallback = "") {
  if (!canShowModuleAction(key)) return "";
  return `<button type="button" data-action="set-active" data-key="${escapeHtml(key)}">${escapeHtml(moduleActionLabel(key, fallback))}</button>`;
}

function renderModuleTextLink(key, fallback = "", className = "text-link") {
  if (!canShowModuleAction(key)) return "";
  return `<a class="${escapeHtml(className)}" href="#module/${escapeHtml(key)}" data-action="set-active" data-key="${escapeHtml(key)}">${escapeHtml(moduleActionLabel(key, fallback))}</a>`;
}

function renderSectionButtons(id) {
  const buttons = sectionButtons(id);
  if (!buttons.length) return "";
  const allowedModuleKeys = allowedModuleKeysForActions();
  return buttons
    .map((button) => {
      const label = escapeHtml(button.label || "Open");
      const url = normalizeSectionButtonUrl(button.url, { allowedModuleKeys });
      if (!url) return "";
      if (url.startsWith("#module/")) {
        const key = url.replace(/^#module\//, "");
        return `<a href="${escapeHtml(url)}" data-action="set-active" data-key="${escapeHtml(key)}">${label}</a>`;
      }
      return `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${label}</a>`;
    })
    .filter(Boolean)
    .join("");
}

function renderManagedSection(id, content) {
  const config = pageSectionById(id);
  if (state.firebase.enabled && state.authChecked && config && config.visible === false) {
    return "";
  }
  const heading = String(config?.content?.heading || "").trim();
  const body = String(config?.content?.body || "").trim();
  const imageUrl = String(config?.imageUrl || "").trim();
  const buttons = renderSectionButtons(id);
  if (heading || body || imageUrl || buttons) {
    const override = `
      <div class="managed-section-override">
        ${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(heading || config?.title || "Section image")}" />` : ""}
        <div>
          ${heading ? `<h2>${escapeHtml(heading)}</h2>` : ""}
          ${body ? `<p>${escapeHtml(body)}</p>` : ""}
          ${buttons ? `<div class="hero-actions">${buttons}</div>` : ""}
        </div>
      </div>
    `;
    return content.replace(/(<(?:section|div)\b[^>]*>)/, `$1${override}`);
  }
  return content;
}

function currentSessionUser() {
  return state.authSession?.user || state.accessContext?.user || null;
}

function currentUserUid() {
  return currentSessionUser()?.uid || currentSessionUser()?.id || state.authSession?.uid || "";
}

function currentUserName() {
  return currentSessionUser()?.displayName || currentSessionUser()?.name || state.worker?.name || "";
}

function currentUserFranchiseIds() {
  const ids = state.authSession?.franchiseIds || currentSessionUser()?.franchiseIds || [];
  return Array.isArray(ids) ? ids : [];
}

function canViewAllCompanyData() {
  return !state.authSession || ["super_admin", "business_owner"].includes(currentRoleId());
}

function isFranchiseScopedRole() {
  return currentRoleId() === "franchise_owner";
}

function isWorkerScopedRole() {
  return currentRoleId() === "worker";
}

function isContractorScopedRole() {
  return currentRoleId() === "contractor";
}

function currentContractorId() {
  return state.authSession?.contractorId || currentSessionUser()?.contractorId || "";
}

function normalizeLocalAccessCode(value) {
  return String(value || "").trim().toUpperCase().replace(/[\s-]+/g, "");
}

function employeeAccessCodeFor(member) {
  return String(member?.accessCode || fallbackAccessCodeForMember(member || {}, member?.accountType || "Employee")).trim().toUpperCase();
}

function assignableTeamMembers() {
  const secureUsers = (state.accessContext?.users || []).map(mapUserToTeamMember);
  return mergeById(state.teamMembers || [], secureUsers).map(normalizeTeamMember);
}

function mergeSessionTeamMembers(users = []) {
  if (!Array.isArray(users) || !users.length) return;
  state.teamMembers = mergeById(state.teamMembers || [], users.map(mapUserToTeamMember)).map(normalizeTeamMember);
}

function currentWorkerMember() {
  const worker = state.worker || {};
  const workerId = String(worker.id || "").trim();
  const workerEmail = String(worker.email || "").trim().toLowerCase();
  const workerName = String(worker.name || "").trim().toLowerCase();
  return assignableTeamMembers().find((member) => {
    return (workerId && member.id === workerId)
      || (workerEmail && String(member.email || "").toLowerCase() === workerEmail)
      || (workerName && String(member.name || "").toLowerCase() === workerName);
  }) || null;
}

function currentWorkerProfile() {
  const member = currentWorkerMember();
  return {
    ...(member || {}),
    ...(state.worker || {}),
    permissions: state.worker?.permissions?.length ? state.worker.permissions : (member?.permissions || []),
    assignedJobIds: state.worker?.assignedJobIds?.length ? state.worker.assignedJobIds : (member?.assignedJobIds || []),
    assignedTaskIds: state.worker?.assignedTaskIds?.length ? state.worker.assignedTaskIds : (member?.assignedTaskIds || [])
  };
}

function employeeModuleKeys() {
  const profile = currentWorkerProfile();
  const requestedKeys = Array.isArray(profile.permissions) && profile.permissions.length ? profile.permissions : employeeAllowedModuleKeys;
  return [...new Set(requestedKeys)]
    .filter((key) => employeeAllowedModuleKeys.includes(key))
    .filter((key) => moduleByKey(key));
}

function taskMatchesCurrentWorker(task) {
  const profile = currentWorkerProfile();
  const assignedTaskIds = new Set(normalizeListValue(profile.assignedTaskIds));
  const workerId = String(profile.id || "").trim();
  const workerEmail = String(profile.email || "").trim().toLowerCase();
  const workerName = String(profile.name || "").trim().toLowerCase();
  return assignedTaskIds.has(task.id)
    || (workerId && task.assigneeId === workerId)
    || (workerEmail && String(task.assigneeEmail || task.contractorEmail || "").toLowerCase() === workerEmail)
    || (workerName && String(task.assigneeName || "").toLowerCase() === workerName);
}

function jobReferenceValues(job) {
  return [job?.id, job?.jobId, job?.title, job?.customer, job?.property, job?.owner]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function currentWorkerAllowedJobRefs() {
  const profile = currentWorkerProfile();
  const refs = new Set(normalizeListValue(profile.assignedJobIds));
  state.tasks.filter(taskMatchesCurrentWorker).forEach((task) => {
    if (task.relatedJob) refs.add(String(task.relatedJob).trim());
  });
  if (state.clockSession?.job) refs.add(String(state.clockSession.job).trim());
  [...refs].forEach((ref) => {
    const job = jobByJobId(ref);
    if (job) jobReferenceValues(job).forEach((value) => refs.add(value));
  });
  return refs;
}

function jobMatchesCurrentWorker(job) {
  const refs = currentWorkerAllowedJobRefs();
  const workerName = String(currentWorkerProfile().name || "").trim().toLowerCase();
  return jobReferenceValues(job).some((value) => refs.has(value))
    || (workerName && String(job.owner || "").trim().toLowerCase() === workerName);
}

function timeEntryMatchesCurrentWorker(entry) {
  const profile = currentWorkerProfile();
  const workerId = String(profile.id || "").trim();
  const workerEmail = String(profile.email || "").trim().toLowerCase();
  const workerName = String(profile.name || "").trim().toLowerCase();
  const allowedJobs = currentWorkerAllowedJobRefs();
  const entryJob = String(entry.job || entry.relatedJob || "").trim();
  return (workerId && entry.workerId === workerId)
    || (workerEmail && String(entry.workerEmail || "").toLowerCase() === workerEmail)
    || (workerName && String(entry.worker || "").toLowerCase() === workerName)
    || (entryJob && allowedJobs.has(entryJob));
}

function fileVisibleToCurrentWorker(file) {
  if (!state.employeeMode) return true;
  const profile = currentWorkerProfile();
  const workerName = String(profile.name || "").trim().toLowerCase();
  const workerEmail = String(profile.email || "").trim().toLowerCase();
  const allowedJobs = currentWorkerAllowedJobRefs();
  const relatedJob = String(file.relatedJob || "").trim();
  return (relatedJob && allowedJobs.has(relatedJob))
    || (workerName && String(file.owner || "").toLowerCase() === workerName)
    || (workerEmail && String(file.ownerEmail || file.contractorEmail || "").toLowerCase() === workerEmail)
    || (!relatedJob && fileLinkedModules(file).some((key) => employeeModuleKeys().includes(key)));
}

function visiblePhotoRecords() {
  if (!state.employeeMode && (canViewAllCompanyData() || isFranchiseScopedRole())) return state.photoRecords || [];
  const allowedJobs = new Set(visibleJobBoards().flatMap(jobReferenceValues));
  const profile = currentWorkerProfile();
  const workerId = String(profile.id || "").trim();
  const workerEmail = String(profile.email || "").trim().toLowerCase();
  const workerName = String(profile.name || "").trim().toLowerCase();
  return (state.photoRecords || []).filter((record) => {
    const jobId = String(record.jobId || record.relatedJob || "").trim();
    return (jobId && allowedJobs.has(jobId))
      || (workerId && record.workerId === workerId)
      || (workerEmail && String(record.workerEmail || "").toLowerCase() === workerEmail)
      || (workerName && String(record.workerName || "").toLowerCase() === workerName);
  });
}

function taskMatchesCurrentContractor(task) {
  const assignedTaskIds = Array.isArray(currentSessionUser()?.assignedTaskIds) ? currentSessionUser().assignedTaskIds : [];
  const uid = currentUserUid();
  const contractorId = currentContractorId();
  const email = String(state.authSession?.email || currentSessionUser()?.email || "").toLowerCase();
  return assignedTaskIds.includes(task.id)
    || (uid && task.assigneeId === uid)
    || (contractorId && task.contractorId === contractorId)
    || (email && String(task.contractorEmail || "").toLowerCase() === email);
}

function visibleTasks() {
  if (state.employeeMode) return state.tasks.filter(taskMatchesCurrentWorker);
  if (!state.authSession) return state.tasks;
  if (canViewAllCompanyData()) return state.tasks;
  if (isFranchiseScopedRole()) {
    const jobIds = new Set(visibleJobBoards().map((job) => job.jobId));
    return state.tasks.filter((task) => !task.relatedJob || jobIds.has(task.relatedJob));
  }
  if (isContractorScopedRole()) {
    return state.tasks.filter(taskMatchesCurrentContractor);
  }
  if (isWorkerScopedRole()) {
    const assignedTaskIds = Array.isArray(currentSessionUser()?.assignedTaskIds) ? currentSessionUser().assignedTaskIds : [];
    const uid = currentUserUid();
    const email = String(state.authSession?.email || currentSessionUser()?.email || "").toLowerCase();
    const name = currentUserName().toLowerCase();
    return state.tasks.filter((task) => assignedTaskIds.includes(task.id)
      || (uid && task.assigneeId === uid)
      || (email && String(task.assigneeEmail || "").toLowerCase() === email)
      || (name && String(task.assigneeName || "").toLowerCase() === name));
  }
  return state.tasks;
}

function visibleJobBoards() {
  if (state.employeeMode) return state.jobBoards.filter(jobMatchesCurrentWorker);
  if (!state.authSession) return state.jobBoards;
  if (canViewAllCompanyData()) return state.jobBoards;
  if (isFranchiseScopedRole()) {
    const allowedBranches = new Set(currentUserFranchiseIds());
    return state.jobBoards.filter((job) => !allowedBranches.size || allowedBranches.has(job.branchId));
  }
  if (isContractorScopedRole()) {
    const contractorId = currentContractorId();
    const email = String(state.authSession?.email || currentSessionUser()?.email || "").toLowerCase();
    const taskJobRefs = new Set(state.tasks.filter(taskMatchesCurrentContractor).map((task) => String(task.relatedJob || "").trim()).filter(Boolean));
    return state.jobBoards.filter((job) => {
      const jobRefs = [job.jobId, job.title, job.id].map((value) => String(value || "").trim());
      return (contractorId && job.contractorId === contractorId)
        || (email && String(job.contractorEmail || "").toLowerCase() === email)
        || jobRefs.some((value) => taskJobRefs.has(value));
    });
  }
  if (isWorkerScopedRole()) {
    const taskJobRefs = new Set(visibleTasks().map((task) => String(task.relatedJob || "").trim()).filter(Boolean));
    const workerName = currentUserName().toLowerCase();
    return state.jobBoards.filter((job) => {
      const jobRefs = [job.jobId, job.title, job.owner].map((value) => String(value || "").trim());
      return jobRefs.some((value) => taskJobRefs.has(value)) || String(job.owner || "").toLowerCase() === workerName;
    });
  }
  return state.jobBoards;
}

function visibleTimeEntries() {
  if (state.employeeMode) return state.timeEntries.filter(timeEntryMatchesCurrentWorker);
  if (!state.authSession) return state.timeEntries;
  if (canViewAllCompanyData() || isFranchiseScopedRole()) return state.timeEntries;
  if (isContractorScopedRole()) {
    const allowedJobs = new Set(visibleJobBoards().map((job) => String(job.jobId || "").trim()));
    const contractorId = currentContractorId();
    const email = String(state.authSession?.email || currentSessionUser()?.email || "").toLowerCase();
    return state.timeEntries.filter((entry) => {
      const entryJob = String(entry.job || "").trim();
      return allowedJobs.has(entryJob)
        || (contractorId && entry.contractorId === contractorId)
        || (email && String(entry.contractorEmail || "").toLowerCase() === email);
    });
  }
  if (isWorkerScopedRole()) {
    const workerName = currentUserName().toLowerCase();
    const workerEmail = String(state.authSession?.email || currentSessionUser()?.email || "").toLowerCase();
    const allowedJobs = new Set(visibleJobBoards().map((job) => String(job.jobId || "").trim()));
    return state.timeEntries.filter((entry) => String(entry.worker || "").toLowerCase() === workerName
      || (workerEmail && String(entry.workerEmail || "").toLowerCase() === workerEmail)
      || allowedJobs.has(String(entry.job || "").trim()));
  }
  return state.timeEntries;
}

function visibleDryLogs() {
  if (!state.employeeMode && (canViewAllCompanyData() || isFranchiseScopedRole())) return state.dryLogs;
  const allowedJobs = new Set(visibleJobBoards().flatMap(jobReferenceValues));
  const workerName = String(currentWorkerProfile().name || currentUserName() || "").trim().toLowerCase();
  return state.dryLogs.filter((log) => {
    const jobId = String(log.jobId || "").trim();
    return (jobId && allowedJobs.has(jobId))
      || (workerName && String(log.technician || "").toLowerCase() === workerName);
  });
}

function businessRecordsByType(type) {
  return (state.businessData || []).filter((record) => record.type === type);
}

function localRevenueInvoiceRecords() {
  return state.files
    .filter((file) => file.sourceType === "estimateInvoice" || (file.moduleKey === "payments" && String(file.type || "").toLowerCase() === "invoice"))
    .map((file) => {
      const invoiceId = file.sourceId || file.title || file.id;
      return {
        id: `LOCAL-${normalizePriceToken(invoiceId || file.id)}`,
        type: "revenueInvoice",
        invoiceId,
        customerId: normalizePriceToken(file.customer || "customer"),
        customerName: file.customer || "Customer",
        amount: Number(file.amount || 0),
        balance: /paid|closed|complete/i.test(String(file.status || "")) ? 0 : Number(file.amount || 0),
        status: file.status || "Drafting",
        jobId: file.relatedJob || "",
        dueDate: file.due || "",
        source: "local-file",
        sourceFileId: file.id
      };
    });
}

function revenueInvoices() {
  const records = new Map();
  [...localRevenueInvoiceRecords(), ...businessRecordsByType("revenueInvoice")].forEach((record) => {
    const id = String(record.id || record.invoiceId || createId("invoice"));
    records.set(id, { ...record, id });
  });
  return Array.from(records.values());
}

function contractorInvoices() {
  return businessRecordsByType("contractorInvoice");
}

function customerRecords() {
  const records = new Map();
  businessRecordsByType("customer").forEach((record) => {
    const id = String(record.id || record.customerId || normalizePriceToken(record.name || "customer"));
    records.set(id, { ...record, id });
  });
  localRevenueInvoiceRecords().forEach((invoice) => {
    const id = invoice.customerId || normalizePriceToken(invoice.customerName || "customer");
    const current = records.get(id) || {
      id,
      type: "customer",
      customerId: id,
      name: invoice.customerName || "Customer",
      revenueTotal: 0,
      openBalance: 0,
      status: "Active",
      source: "local-file"
    };
    records.set(id, {
      ...current,
      revenueTotal: Number(current.revenueTotal || 0) + Number(invoice.amount || 0),
      openBalance: Number(current.openBalance || 0) + Number(invoice.balance || 0)
    });
  });
  return Array.from(records.values());
}

function sumRecords(records, key = "amount") {
  return records.reduce((sum, record) => sum + Number(record[key] || 0), 0);
}

function mergeById(existing = [], incoming = []) {
  const merged = new Map();
  [...existing, ...incoming].forEach((item) => {
    if (!item) return;
    const id = String(item.id || item.uid || item.invoiceId || item.customerId || createId("record"));
    merged.set(id, { ...item, id });
  });
  return Array.from(merged.values());
}

function isAdminCredentialGap(error) {
  const message = String(error?.message || error || "").toLowerCase();
  if (!message && state.firebase?.enabled && !state.firebase.adminConfigured) return true;
  return message.includes("firebase admin credentials")
    || message.includes("persistent user management")
    || message.includes("communication-board writes")
    || message.includes("server credentials");
}

function upsertAccessGrant(grant) {
  if (!grant) return;
  state.accessContext = state.accessContext || {};
  state.accessContext.accessGrants = mergeById([grant], state.accessContext.accessGrants || []);
}

function upsertAccessRequest(request) {
  if (!request) return;
  state.accessContext = state.accessContext || {};
  state.accessContext.accessRequests = mergeById([request], state.accessContext.accessRequests || []);
}

function upsertManagedUser(user) {
  if (!user) return;
  state.accessContext = state.accessContext || {};
  state.accessContext.users = mergeById(state.accessContext.users || [], [user]);
  state.teamMembers = mergeById(state.teamMembers || [], [mapUserToTeamMember(user)]).map(normalizeTeamMember);
}

function upsertLocalTeamMember(member) {
  if (!member) return null;
  const normalized = normalizeTeamMember(member);
  state.teamMembers = mergeById(state.teamMembers || [], [normalized]).map(normalizeTeamMember);
  return normalized;
}

function removeManagedUser(uid) {
  if (!uid) return;
  const matchesUid = (item) => String(item?.uid || item?.id || "") === String(uid);
  if (state.accessContext?.users) {
    state.accessContext.users = state.accessContext.users.filter((user) => !matchesUid(user));
  }
  state.teamMembers = (state.teamMembers || []).filter((member) => !matchesUid(member));
}

function localCommunityPost(payload) {
  const now = new Date().toISOString();
  const post = {
    id: createId("POST"),
    title: String(payload.title || "Contractor discussion").trim(),
    body: String(payload.body || "").trim(),
    tags: csvValues(payload.tags),
    visibility: "contractors",
    authorEmail: state.authSession?.email || "approved user",
    authorRoleId: currentRoleId() || "member",
    contractorId: currentContractorId(),
    comments: [],
    pinned: false,
    createdAt: now,
    updatedAt: now,
    source: "local-browser"
  };
  state.communityPosts = [post, ...(state.communityPosts || [])];
  persist();
  return post;
}

function localCommunityComment(postId, body) {
  const comment = {
    id: createId("COMMENT"),
    body: String(body || "").trim(),
    authorEmail: state.authSession?.email || "approved user",
    authorRoleId: currentRoleId() || "member",
    createdAt: new Date().toISOString(),
    source: "local-browser"
  };
  state.communityPosts = (state.communityPosts || []).map((post) => {
    if (post.id !== postId) return post;
    return {
      ...post,
      comments: [...(Array.isArray(post.comments) ? post.comments : []), comment],
      updatedAt: new Date().toISOString()
    };
  });
  persist();
  return comment;
}

function mergeCommunityComment(postId, comment) {
  if (!postId || !comment) return;
  state.communityPosts = (state.communityPosts || []).map((post) => {
    if (post.id !== postId) return post;
    return {
      ...post,
      comments: mergeById([comment], Array.isArray(post.comments) ? post.comments : []),
      updatedAt: comment.createdAt || new Date().toISOString()
    };
  });
  persist();
}

function optionalFirebaseRead(promise, fallback = []) {
  return Promise.race([
    promise,
    new Promise((resolve) => window.setTimeout(() => resolve(fallback), 2500))
  ]).catch(() => fallback);
}

async function hydrateClientFirebaseData() {
  if (!state.firebase.enabled || !state.authSession) return;
  try {
    const [businessData, communityPosts] = await Promise.all([
      optionalFirebaseRead(fetchClientBusinessRecords()),
      optionalFirebaseRead(fetchClientCommunityPosts())
    ]);
    if (businessData.length) {
      state.businessData = mergeById(state.businessData || [], businessData);
      if (state.accessContext) state.accessContext.businessData = state.businessData;
    }
    if (communityPosts.length) {
      state.communityPosts = mergeById(state.communityPosts || [], communityPosts)
        .sort((a, b) => String(b.pinned || "").localeCompare(String(a.pinned || "")) || new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      if (state.accessContext) state.accessContext.communityPosts = state.communityPosts;
    }
  } catch (_error) {
    // Server context remains the source of truth when Firestore browser reads are not available.
  }
}

async function bootstrapFirebaseAuth() {
  try {
    const firebaseConfig = await loadFirebaseConfig();
    state.firebase = {
      enabled: Boolean(firebaseConfig.enabled),
      ready: true,
      adminConfigured: Boolean(firebaseConfig.adminConfigured),
      webConfigured: Boolean(firebaseConfig.webConfigured),
      adminCredentialSource: firebaseConfig.adminCredentialSource || "",
      projectId: firebaseConfig.projectId || "",
      knownProjectId: firebaseConfig.knownProjectId || "",
      usingKnownProjectDefaults: Boolean(firebaseConfig.usingKnownProjectDefaults),
      restAuthFallback: Boolean(firebaseConfig.restAuthFallback),
      ownerOnlyLogin: Boolean(firebaseConfig.ownerOnlyLogin),
      allowedLoginEmails: Array.isArray(firebaseConfig.allowedLoginEmails) ? firebaseConfig.allowedLoginEmails : [],
      missingAdminEnv: firebaseConfig.missingAdminEnv || [],
      missingWebEnv: firebaseConfig.missingWebEnv || [],
      allowedSignInProviders: firebaseConfig.allowedSignInProviders || [],
      sessionTtlHours: firebaseConfig.sessionTtlHours || 48,
      inviteEmailConfigured: Boolean(firebaseConfig.inviteEmailConfigured)
    };
    if (!firebaseConfig.enabled) {
      state.authChecked = true;
      render();
      return;
    }
    state.authLoading = true;
    render();
    const session = await fetchOsSession();
    state.authSession = session?.session || null;
    state.accessContext = session ? {
      tabs: session.tabs || [],
      pages: session.pages || [],
      pageSections: session.pageSections || [],
      roles: session.roles || [],
      permissions: session.permissions || [],
      companySettings: session.companySettings || null,
      franchiseSettings: session.franchiseSettings || [],
      user: session.user || null,
      users: session.users || [],
      auditLogs: session.auditLogs || [],
      businessData: session.businessData || [],
      accessRequests: session.accessRequests || [],
      accessGrants: session.accessGrants || [],
      communityPosts: session.communityPosts || []
    } : null;
    state.businessData = session?.businessData || [];
    state.communityPosts = session?.communityPosts || [];
    mergeSessionTeamMembers(session?.users || []);
    await hydrateClientFirebaseData();
    state.authChecked = true;
    state.authError = "";
  } catch (error) {
    state.authChecked = true;
    state.authError = error.message || "Unable to initialize Firebase authentication.";
  } finally {
    state.authLoading = false;
    render();
  }
}

async function refreshAccessContext() {
  if (!state.firebase.enabled) return;
  const session = await fetchOsSession();
  state.authSession = session?.session || null;
  state.accessContext = session ? {
    tabs: session.tabs || [],
    pages: session.pages || [],
    pageSections: session.pageSections || [],
    roles: session.roles || [],
      permissions: session.permissions || [],
      companySettings: session.companySettings || null,
      franchiseSettings: session.franchiseSettings || [],
      user: session.user || null,
      users: session.users || [],
      auditLogs: session.auditLogs || [],
      businessData: session.businessData || [],
      accessRequests: session.accessRequests || [],
      accessGrants: session.accessGrants || [],
      communityPosts: session.communityPosts || []
    } : null;
  state.businessData = session?.businessData || [];
  state.communityPosts = session?.communityPosts || [];
  mergeSessionTeamMembers(session?.users || []);
  await hydrateClientFirebaseData();
}

async function submitFirebaseLogin(formData) {
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  const accessCode = String(formData.get("accessCode") || "").trim();
  state.authLoading = true;
  state.authError = "";
  render();
  try {
    await loginWithFirebasePassword(email, password, { ...getLoginAccessOptions(), accessCode });
    await refreshAccessContext();
  } catch (error) {
    state.authError = error.message || "Unable to sign in.";
  } finally {
    state.authLoading = false;
    state.authChecked = true;
    render();
  }
}

async function submitFirebaseGoogleLogin() {
  const accessOptions = getLoginAccessOptions();
  state.authLoading = true;
  state.authError = "";
  render();
  try {
    await loginWithFirebaseGoogle(accessOptions);
    await refreshAccessContext();
  } catch (error) {
    state.authError = error.message || "Unable to sign in with Google.";
  } finally {
    state.authLoading = false;
    state.authChecked = true;
    render();
  }
}

async function signOutFirebaseAuth() {
  state.authLoading = true;
  render();
  try {
    await logoutFirebaseSession();
    state.authSession = null;
    state.accessContext = null;
  } finally {
    state.authLoading = false;
    state.authChecked = true;
    render();
  }
}

function csvValues(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "content-type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.success === false) {
    throw new Error(result.message || `Request failed: ${response.status}`);
  }
  return result;
}

async function requestTrialAccess(formData) {
  const payload = {
    displayName: String(formData.get("displayName") || "").trim(),
    email: String(formData.get("email") || "").trim(),
    companyName: String(formData.get("companyName") || "").trim(),
    roleId: String(formData.get("roleId") || "contractor").trim()
  };
  state.authLoading = true;
  state.authError = "";
  render();
  try {
    const result = await apiRequest("/api/access/trial-request", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    state.accessRequestStatus = result.message || "Access request sent.";
    setToast("Access request sent");
  } catch (error) {
    if (!isAdminCredentialGap(error)) {
      state.authError = error.message || "Unable to request access.";
    } else {
      try {
        const result = await createClientAccessRequest(payload);
        state.accessRequestStatus = `${result.message} Stored in Firebase from the login dashboard.`;
        upsertAccessRequest(result.request);
        setToast("Access request stored in Firebase");
      } catch (fallbackError) {
        state.authError = fallbackError.message || "Unable to request access.";
      }
    }
  } finally {
    state.authLoading = false;
    render();
  }
}

async function createAccessGrant(formData) {
  const payload = {
    requestId: String(formData.get("requestId") || "").trim(),
    displayName: String(formData.get("displayName") || "").trim(),
    email: String(formData.get("email") || "").trim(),
    roleId: String(formData.get("roleId") || "contractor").trim(),
    companyId: String(formData.get("companyId") || "default-company").trim(),
    franchiseIds: csvValues(formData.get("franchiseIds")),
    contractorId: String(formData.get("contractorId") || "").trim(),
    ttlHours: Number(formData.get("ttlHours") || 48),
    sendEmail: formData.has("sendEmail")
  };
  let result;
  let usedClientGrant = false;
  try {
    result = await apiRequest("/api/access/grants", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  } catch (error) {
    if (!isAdminCredentialGap(error)) throw error;
    usedClientGrant = true;
    result = await createClientAccessGrant(payload);
  }
  state.lastAccessGrant = {
    email: payload.email,
    accessCode: result.accessCode,
    accessLink: result.accessLink,
    expiresAt: result.grant?.expiresAt || "",
    emailDelivery: result.emailDelivery || result.grant?.emailDelivery || null
  };
  upsertAccessGrant(result.grant);
  setToast(state.lastAccessGrant.emailDelivery?.status === "sent" ? "Invite email sent with access code" : "Access grant issued; send the link and code manually");
  if (usedClientGrant) {
    render();
  } else {
    await refreshAccessContext().catch(() => hydrateClientFirebaseData());
  }
}

async function createCommunityPost(formData) {
  const payload = {
    title: String(formData.get("title") || "").trim(),
    body: String(formData.get("body") || "").trim(),
    tags: csvValues(formData.get("tags")),
    roleId: currentRoleId(),
    contractorId: currentContractorId(),
    companyId: state.authSession?.companyId || "default-company",
    franchiseIds: currentUserFranchiseIds()
  };
  let usedLocalFallback = false;
  let updatedFromApi = false;
  try {
    const result = await apiRequest("/api/community/posts", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    if (result.post) {
      state.communityPosts = mergeById([result.post], state.communityPosts || []);
      updatedFromApi = true;
    }
  } catch (error) {
    if (!isAdminCredentialGap(error)) throw error;
    try {
      const result = await createClientCommunityPost(payload);
      state.communityPosts = mergeById([result.post], state.communityPosts || []);
      updatedFromApi = true;
    } catch (_fallbackError) {
      usedLocalFallback = true;
      localCommunityPost(payload);
    }
  }
  setToast("Board post published");
  if (usedLocalFallback || updatedFromApi) {
    render();
  } else {
    await refreshAccessContext().catch(() => hydrateClientFirebaseData());
  }
}

async function addCommunityComment(formData) {
  const postId = String(formData.get("postId") || "").trim();
  const body = String(formData.get("body") || "").trim();
  let usedLocalFallback = false;
  let updatedFromApi = false;
  try {
    const result = await apiRequest(`/api/community/posts/${encodeURIComponent(postId)}/comments`, {
      method: "POST",
      body: JSON.stringify({ body })
    });
    if (result.post) {
      state.communityPosts = mergeById([result.post], state.communityPosts || []);
      updatedFromApi = true;
    } else if (result.comment) {
      mergeCommunityComment(postId, result.comment);
      updatedFromApi = true;
    }
  } catch (error) {
    if (!isAdminCredentialGap(error)) throw error;
    try {
      const result = await addClientCommunityComment(postId, {
        body,
        roleId: currentRoleId()
      });
      if (result?.comment) mergeCommunityComment(postId, result.comment);
      updatedFromApi = Boolean(result?.comment);
    } catch (_fallbackError) {
      usedLocalFallback = true;
      localCommunityComment(postId, body);
    }
  }
  setToast("Comment added");
  if (usedLocalFallback || updatedFromApi) {
    render();
  } else {
    await refreshAccessContext().catch(() => hydrateClientFirebaseData());
  }
}

async function createSecureUser(formData) {
  const payload = {
    displayName: String(formData.get("displayName") || "").trim(),
    email: String(formData.get("email") || "").trim(),
    password: String(formData.get("password") || ""),
    roleId: String(formData.get("roleId") || "worker").trim(),
    companyId: String(formData.get("companyId") || "default-company").trim(),
    franchiseIds: csvValues(formData.get("franchiseIds")),
    contractorId: String(formData.get("contractorId") || "").trim(),
    accessCode: String(formData.get("accessCode") || "").trim(),
    accessExpiresAt: String(formData.get("accessExpiresAt") || "").trim(),
    accessScope: String(formData.get("accessScope") || "").trim()
  };
  try {
    const result = await apiRequest("/api/rbac/users", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    upsertManagedUser(result.user);
    setToast("Firebase user created and added to managed users");
    await refreshAccessContext().catch(() => render());
  } catch (error) {
    if (!isAdminCredentialGap(error)) throw error;
    const member = upsertLocalTeamMember({
      id: createId("TM"),
      name: payload.displayName || payload.email || "Worker",
      email: payload.email,
      role: payload.roleId.replace(/_/g, " "),
      accountType: payload.roleId === "contractor" ? "Contractor portal" : "Employee",
      access: "Local field access until Firebase Admin user creation is enabled",
      permissions: payload.roleId === "contractor" ? ["jobs", "time", "equipment", "photos", "communications"] : ["time", "drylogs", "jobs", "photos", "equipment", "communications"],
      accessCode: payload.accessCode || createId(payload.roleId === "contractor" ? "CON" : "EMP"),
      assignedJobIds: [],
      assignedTaskIds: [],
      status: "Local invite",
      lastLogin: ""
    });
    addActivity(`Created local employee access profile for ${member.name}.`);
    persist();
    setToast("Local employee profile created");
    render();
  }
}

async function saveRolePermissions(formData) {
  const roleId = String(formData.get("roleId") || "").trim();
  const payload = {
    tabs: {
      mode: "allow",
      allowed: csvValues(formData.get("allowedTabs")),
      hidden: []
    },
    pages: {
      mode: "allow",
      allowed: csvValues(formData.get("allowedPages")),
      hidden: []
    },
    sections: {
      mode: "all",
      allowed: [],
      hidden: csvValues(formData.get("hiddenSections"))
    },
    actions: Object.fromEntries(
      rbacActionKeys.map((action) => [action, formData.getAll("actions").includes(action)])
    )
  };
  await apiRequest(`/api/rbac/permissions/${encodeURIComponent(roleId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
  setToast("Role permissions updated");
  await refreshAccessContext();
}

async function saveTabConfig(formData) {
  await apiRequest(`/api/rbac/tabs/${encodeURIComponent(String(formData.get("id") || "").trim())}`, {
    method: "PATCH",
    body: JSON.stringify({
      label: String(formData.get("label") || "").trim(),
      order: Number(formData.get("order") || 0),
      visible: String(formData.get("visible") || "true") !== "false"
    })
  });
  setToast("Tab config saved");
  await refreshAccessContext();
}

async function savePageConfig(formData) {
  await apiRequest(`/api/rbac/pages/${encodeURIComponent(String(formData.get("id") || "").trim())}`, {
    method: "PATCH",
    body: JSON.stringify({
      title: String(formData.get("title") || "").trim(),
      purpose: String(formData.get("purpose") || "").trim(),
      order: Number(formData.get("order") || 0),
      visible: String(formData.get("visible") || "true") !== "false"
    })
  });
  setToast("Page config saved");
  await refreshAccessContext();
}

async function savePageSectionConfig(formData) {
  const id = String(formData.get("id") || "").trim();
  const buttonLabel = String(formData.get("buttonLabel") || "").trim();
  const rawButtonUrl = String(formData.get("buttonUrl") || "").trim();
  const buttonUrl = normalizeSectionButtonUrl(rawButtonUrl, { allowedModuleKeys: modules.map((module) => module.key) });
  if (rawButtonUrl && !buttonUrl) {
    setToast("Button URL must be an allowed module route or an HTTPS link.");
    return render();
  }
  await apiRequest(`/api/rbac/page-sections/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({
      title: String(formData.get("heading") || "").trim() || id,
      visible: String(formData.get("visible") || "true") !== "false",
      imageUrl: String(formData.get("imageUrl") || "").trim(),
      order: Number(formData.get("order") || 0),
      content: {
        heading: String(formData.get("heading") || "").trim(),
        body: String(formData.get("body") || "").trim(),
        buttons: buttonLabel || buttonUrl ? [{ label: buttonLabel || "Open", url: buttonUrl }] : []
      }
    })
  });
  setToast("Section config saved");
  await refreshAccessContext();
}

async function saveCompanyBrand(formData) {
  await apiRequest("/api/rbac/company-settings/default", {
    method: "PATCH",
    body: JSON.stringify({
      brandName: String(formData.get("brandName") || "").trim(),
      brandLogoUrl: String(formData.get("brandLogoUrl") || "").trim(),
      editModeEnabled: String(formData.get("editModeEnabled") || "true") !== "false"
    })
  });
  setToast("Brand settings saved");
  await refreshAccessContext();
}

function mapUserToTeamMember(member) {
  const roleId = member.roleId || member.role || "worker";
  return {
    id: member.uid || member.id,
    name: member.displayName || member.name || member.email || "User",
    email: member.email || "",
    role: roleId.replace(/_/g, " "),
    accountType: roleId,
    access: roleId,
    permissions: Object.keys(member.permissionsOverride?.actions || {}).filter((key) => member.permissionsOverride.actions[key]),
    accessCode: member.accessCode || "",
    assignedJobIds: Array.isArray(member.assignedJobIds) ? member.assignedJobIds : [],
    assignedTaskIds: Array.isArray(member.assignedTaskIds) ? member.assignedTaskIds : [],
    status: member.disabled ? "Disabled" : (member.status || "Active"),
    companyId: member.companyId || "",
    franchiseIds: Array.isArray(member.franchiseIds) ? member.franchiseIds : [],
    contractorId: member.contractorId || "",
    accessExpiresAt: member.accessExpiresAt || "",
    accessScope: member.accessScope || ""
  };
}

async function updateSecureUser(payload) {
  if (!payload.uid) throw new Error("User id is required.");
  const result = await apiRequest(`/api/rbac/users/${encodeURIComponent(payload.uid)}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
  upsertManagedUser(result.user || payload);
  setToast("User updated");
  await refreshAccessContext().catch(() => render());
}

async function resetSecureUserPermissions(uid) {
  await apiRequest(`/api/rbac/users/${encodeURIComponent(uid)}/reset-permissions`, {
    method: "POST",
    body: JSON.stringify({})
  });
  setToast("User permissions reset");
  await refreshAccessContext();
}

async function deleteSecureUser(uid) {
  await apiRequest(`/api/rbac/users/${encodeURIComponent(uid)}`, {
    method: "DELETE",
    body: JSON.stringify({})
  });
  removeManagedUser(uid);
  setToast("User removed");
  await refreshAccessContext().catch(() => render());
}

async function uploadAdminAssetFile(file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Unable to read the selected image."));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(file);
  });
  const base64 = dataUrl.split(",")[1] || "";
  const result = await apiRequest("/api/rbac/assets", {
    method: "POST",
    body: JSON.stringify({
      fileName: file.name,
      base64
    })
  });
  return result.assetUrl;
}

function createJobPacket(jobId) {
  const job = state.jobBoards.find((item) => item.id === jobId);
  if (!job) return;
  const drySummary = dryLogSummaryForJob(job);
  const branch = branchById(job.branchId);
  const notes = [
    `${job.jobId} - ${job.title}`,
    `Stage: ${job.stage}`,
    `Branch: ${branch?.name || "Unassigned"}`,
    `Customer: ${job.customer}`,
    `Property: ${job.property}`,
    `Schedule: ${formatDate(job.start)} to ${formatDate(job.end)}`,
    `Completion: ${jobGateCompletion(job)}%`,
    "",
    "Gates:",
    ...(job.gates || []).map((gate) => `- ${gate.label}: ${gate.status}`),
    "",
    "Dry logs:",
    drySummary.logs.length
      ? `- ${drySummary.status}; latest ${drySummary.latest.room} ${drySummary.latest.moisture}% vs target ${drySummary.latest.targetMoisture}% on ${formatDate(drySummary.latest.readingDate)}`
      : "- No dry logs attached",
    "",
    "Linked modules:",
    ...(job.linkedModules || []).map((key) => `- ${moduleByKey(key)?.label || key}`),
    "",
    `Next action: ${job.nextAction || "None"}`,
    `Blockers: ${job.blockers || "None"}`
  ].join("\n");
  createFile({
    moduleKey: "jobs",
    linkedModuleKeys: job.linkedModules,
    sourceType: "jobPacket",
    sourceId: job.id,
    customer: job.customer,
    title: `${job.jobId} job packet`,
    type: "Job packet",
    owner: job.owner,
    status: "Needs review",
    priority: (job.gates || []).some((gate) => gate.status === "Blocked") ? "High" : "Medium",
    due: job.end,
    relatedJob: job.jobId,
    notes
  });
}

function addDryLogRecord(formData) {
  const jobId = String(formData.get("jobId") || "").trim();
  const job = jobByJobId(jobId) || state.jobBoards.find((item) => item.jobId === jobId);
  const equipmentIds = formData.getAll("equipmentIds").map(String);
  const log = {
    id: createId("DRY"),
    jobId: job?.jobId || jobId || "Unassigned",
    jobTitle: job?.title || "",
    room: String(formData.get("room") || "Affected room").trim(),
    material: String(formData.get("material") || "Affected material").trim(),
    readingDate: String(formData.get("readingDate") || today.toISOString().slice(0, 10)),
    technician: String(formData.get("technician") || state.worker?.name || "Field tech").trim(),
    moisture: parseAmount(formData.get("moisture")),
    targetMoisture: parseAmount(formData.get("targetMoisture")) || 12,
    relativeHumidity: parseAmount(formData.get("relativeHumidity")),
    temperature: parseAmount(formData.get("temperature")),
    equipmentIds,
    photoRef: String(formData.get("photoRef") || "").trim(),
    status: String(formData.get("status") || "Drying"),
    notes: String(formData.get("notes") || "").trim(),
    createdAt: new Date().toISOString()
  };
  log.status = dryLogStatus(log);
  state.dryLogs = [log, ...state.dryLogs];
  if (job) updateDryLogGate(job.jobId);
  createFile({
    moduleKey: "drylogs",
    linkedModuleKeys: ["jobs", "equipment", "payments", "photos", "defensibility", "evidencechain"],
    sourceType: "dryLog",
    sourceId: log.id,
    title: `${log.jobId} ${log.room} dry log`,
    type: "Dry log",
    owner: log.technician,
    status: log.status,
    priority: dryLogGap(log) > 2 ? "High" : "Medium",
    due: log.readingDate,
    relatedJob: log.jobId,
    notes: [
      `Room/material: ${log.room} / ${log.material}`,
      `Moisture: ${log.moisture}% target ${log.targetMoisture}%`,
      `RH/temp: ${log.relativeHumidity}% / ${log.temperature}F`,
      `Equipment: ${dryLogEquipmentNames(log).join(", ") || "None linked"}`,
      `Photo: ${log.photoRef || "Not attached"}`,
      log.notes
    ].filter(Boolean).join("\n")
  });
  ensureWorkflowTasks([
    ...(dryLogGap(log) > 0
      ? [
          {
            title: `Recheck ${log.room} moisture for ${log.jobId}`,
            moduleKey: "drylogs",
            relatedJob: log.jobId,
            due: log.readingDate,
            priority: dryLogGap(log) > 2 ? "High" : "Medium",
            sourceType: "dryLog",
            sourceId: log.id
          }
        ]
      : []),
    ...(equipmentIds.length
      ? [
          {
            title: `Verify equipment billing support for ${log.jobId}`,
            moduleKey: "payments",
            relatedJob: log.jobId,
            due: log.readingDate,
            priority: "Medium",
            sourceType: "dryLog",
            sourceId: log.id
          }
        ]
      : [])
  ]);
  addActivity(`Added dry log for ${log.jobId} ${log.room}.`);
  persist();
  setToast("Dry log saved and job gate updated");
  render();
}

function selectedBrowserFile(formData, name) {
  const file = formData.get(name);
  return file && typeof file === "object" && file.name ? file : null;
}

function readImageDataUrl(file) {
  if (!file || typeof FileReader === "undefined") return Promise.resolve("");
  if (Number(file.size || 0) > 1800000) {
    throw new Error("Photo is too large for local field storage. Use a compressed image or paste an evidence link.");
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Unable to read the selected photo."));
    reader.readAsDataURL(file);
  });
}

function markJobGateDone(jobRef, gateId) {
  const job = jobByJobId(jobRef);
  const gate = job?.gates?.find((item) => item.id === gateId);
  if (gate) gate.status = "Done";
  const linkedModules = Array.isArray(job?.linkedModules) ? job.linkedModules : [];
  if (job && !linkedModules.includes(gateId)) job.linkedModules = [...linkedModules, gateId];
  return job;
}

async function addPhotoEvidence(formData) {
  const file = selectedBrowserFile(formData, "photoFile");
  const photoDataUrl = file ? await readImageDataUrl(file) : "";
  const worker = currentWorkerProfile();
  const taskId = String(formData.get("taskId") || "").trim();
  const task = state.tasks.find((item) => item.id === taskId);
  const record = {
    id: createId("PHOTO"),
    jobId: String(formData.get("jobId") || task?.relatedJob || "").trim(),
    room: String(formData.get("room") || "Field area").trim(),
    category: String(formData.get("category") || "Progress").trim(),
    photoRef: String(formData.get("photoRef") || file?.name || "").trim(),
    photoDataUrl,
    photoSize: file?.size || 0,
    photoType: file?.type || "",
    notes: String(formData.get("notes") || "").trim(),
    taskId,
    workerId: worker.id || "",
    workerName: worker.name || state.worker?.name || "Field worker",
    workerEmail: worker.email || "",
    createdAt: new Date().toISOString()
  };
  if (!record.jobId) {
    setToast("Select a job before saving photo evidence");
    return render();
  }
  state.photoRecords = [record, ...(state.photoRecords || [])];
  const job = markJobGateDone(record.jobId, "photos");
  if (task && task.moduleKey === "photos") {
    task.status = "Complete";
  }
  createFile({
    moduleKey: "photos",
    linkedModuleKeys: ["jobs", "drylogs", "time", "equipment", "payments", "defensibility", "closeout"],
    sourceType: "photoEvidence",
    sourceId: record.id,
    customer: job?.customer || "",
    title: `${record.jobId} ${record.room} ${record.category} photo`,
    type: "Photo evidence",
    owner: record.workerName,
    status: "Complete",
    priority: task?.priority || "Medium",
    due: today.toISOString().slice(0, 10),
    relatedJob: record.jobId,
    notes: [
      `Photo reference: ${record.photoRef || "Uploaded local image"}`,
      `Task: ${task?.title || "No task selected"}`,
      `Room: ${record.room}`,
      `Category: ${record.category}`,
      `Worker: ${record.workerName} ${record.workerEmail || ""}`.trim(),
      record.notes
    ].filter(Boolean).join("\n")
  });
  addActivity(`${record.workerName} saved photo evidence for ${record.jobId}.`);
  persist();
  setToast("Photo evidence saved");
  render();
}

function addJobNote(formData) {
  const worker = currentWorkerProfile();
  const jobId = String(formData.get("jobId") || "").trim();
  const noteType = String(formData.get("noteType") || "Field note").trim();
  const notes = String(formData.get("notes") || "").trim();
  const job = jobByJobId(jobId);
  if (!jobId || !notes) {
    setToast("Job and note are required");
    return render();
  }
  createFile({
    moduleKey: "jobs",
    linkedModuleKeys: ["photos", "time", "drylogs", "equipment", "communications", "closeout"],
    sourceType: "jobNote",
    sourceId: createId("NOTE"),
    customer: job?.customer || "",
    title: `${jobId} ${noteType}`,
    type: "Field note",
    owner: worker.name || state.worker?.name || "Field worker",
    status: "Open",
    priority: noteType === "Issue" ? "High" : "Medium",
    due: today.toISOString().slice(0, 10),
    relatedJob: jobId,
    notes
  });
  addActivity(`${worker.name || "Field worker"} added a job note for ${jobId}.`);
  persist();
  setToast("Job note saved");
  render();
}

function createDryLogPacket(jobId) {
  const job = jobByJobId(jobId);
  if (!job) return;
  const summary = dryLogSummaryForJob(job);
  const notes = [
    `${job.jobId} dry log packet`,
    `Job: ${job.title}`,
    `Customer/property: ${job.customer} / ${job.property}`,
    `Drying status: ${summary.status}`,
    summary.latest ? `Latest: ${summary.latest.room} ${summary.latest.moisture}% vs target ${summary.latest.targetMoisture}% on ${formatDate(summary.latest.readingDate)}` : "Latest: none",
    "",
    "Readings:",
    ...summary.logs.map((log) => `- ${formatDate(log.readingDate)} ${log.room} ${log.material}: ${log.moisture}% target ${log.targetMoisture}%, RH ${log.relativeHumidity}%, ${log.temperature}F, photos ${log.photoRef || "not attached"}`),
    "",
    "Equipment links:",
    ...summary.logs.flatMap((log) => dryLogEquipmentNames(log)).filter(Boolean).map((name) => `- ${name}`)
  ].join("\n");
  createFile({
    moduleKey: "drylogs",
    linkedModuleKeys: ["jobs", "equipment", "payments", "photos", "defensibility", "evidencechain"],
    sourceType: "dryLogPacket",
    sourceId: job.id,
    customer: job.customer,
    title: `${job.jobId} drying documentation packet`,
    type: "Dry log packet",
    owner: job.owner,
    status: summary.status === "At target" ? "Complete" : "Needs review",
    priority: summary.openReadings ? "High" : "Medium",
    due: today.toISOString().slice(0, 10),
    relatedJob: job.jobId,
    notes
  });
}

function addContactRecord(formData) {
  const contact = {
    id: createId("CON"),
    name: String(formData.get("name") || "New contact").trim(),
    role: String(formData.get("role") || "Contact").trim(),
    organization: String(formData.get("organization") || "").trim(),
    phone: String(formData.get("phone") || "").trim(),
    email: String(formData.get("email") || "").trim(),
    property: String(formData.get("property") || "").trim(),
    relationship: String(formData.get("relationship") || "Stakeholder").trim(),
    status: String(formData.get("status") || "Active"),
    lastTouch: new Date().toISOString(),
    nextAction: String(formData.get("nextAction") || "").trim(),
    linkedIds: state.contacts.slice(0, 2).map((item) => item.id),
    notes: String(formData.get("notes") || "").trim(),
    history: ["Contact added."]
  };
  state.contacts = [contact, ...state.contacts];
  addActivity(`Added contact ${contact.name} to relationship map.`);
  persist();
  setToast("Contact added");
  render();
}

function logContactTouch(contactId) {
  const contact = state.contacts.find((item) => item.id === contactId);
  if (!contact) return;
  contact.lastTouch = new Date().toISOString();
  contact.history = [`Touch logged: ${formatTime(contact.lastTouch)}`, ...(contact.history || [])].slice(0, 8);
  addActivity(`Logged contact touch for ${contact.name}.`);
  persist();
  setToast("Contact touch logged");
  render();
}

function createContactFile(contactId) {
  const contact = state.contacts.find((item) => item.id === contactId);
  if (!contact) return;
  createFile({
    moduleKey: "relationships",
    linkedModuleKeys: ["communications", "properties", "jobs", "payments"],
    sourceType: "contact",
    sourceId: contact.id,
    customer: contact.name,
    title: `${contact.name} relationship file`,
    type: "Contact record",
    owner: "Relationship desk",
    status: contact.status,
    priority: contact.status === "Needs response" ? "High" : "Medium",
    due: "",
    relatedJob: contact.property,
    notes: [
      `Role: ${contact.role}`,
      `Organization: ${contact.organization}`,
      `Phone: ${contact.phone}`,
      `Email: ${contact.email}`,
      `Relationship: ${contact.relationship}`,
      `Next action: ${contact.nextAction}`,
      `Notes: ${contact.notes}`
    ].join("\n")
  });
}

function addBranchRecord(formData) {
  const branch = {
    id: createId("BR"),
    name: String(formData.get("name") || "New branch").trim(),
    accessCode: String(formData.get("accessCode") || createId("ACCESS")).trim().toUpperCase(),
    territory: String(formData.get("territory") || "").trim(),
    manager: String(formData.get("manager") || "").trim(),
    status: String(formData.get("status") || "Active"),
    linkedBranchIds: state.branches.slice(0, 1).map((item) => item.id),
    modules: formData.getAll("modules").map(String),
    notes: String(formData.get("notes") || "").trim()
  };
  state.branches = [branch, ...state.branches];
  addActivity(`Added branch/access box for ${branch.name}.`);
  persist();
  setToast("Branch added");
  render();
}

async function copyBranchCode(branchId) {
  const branch = branchById(branchId);
  if (!branch) return;
  try {
    await navigator.clipboard.writeText(branch.accessCode);
    setToast("Access code copied");
  } catch {
    setToast(`Access code: ${branch.accessCode}`);
  }
  render();
}

function toggleBranchModule(branchId, moduleKey) {
  const branch = branchById(branchId);
  if (!branch) return;
  const modulesForBranch = new Set(branch.modules || []);
  if (modulesForBranch.has(moduleKey)) {
    modulesForBranch.delete(moduleKey);
  } else {
    modulesForBranch.add(moduleKey);
  }
  branch.modules = [...modulesForBranch];
  addActivity(`${moduleByKey(moduleKey)?.label || moduleKey} access toggled for ${branch.name}.`);
  persist();
  setToast("Branch module access updated");
  render();
}

function createBranchFile(branchId) {
  const branch = branchById(branchId);
  if (!branch) return;
  createFile({
    moduleKey: "branches",
    linkedModuleKeys: ["branchbench", "moduletoggles", "licensing", "globalindexes"],
    sourceType: "branch",
    sourceId: branch.id,
    title: `${branch.name} access profile`,
    type: "Branch access",
    owner: branch.manager,
    status: branch.status,
    priority: "Medium",
    due: "",
    relatedJob: branch.territory,
    notes: [
      `Access code: ${branch.accessCode}`,
      `Territory: ${branch.territory}`,
      `Modules: ${(branch.modules || []).map((key) => moduleByKey(key)?.label || key).join(", ")}`,
      `Linked branches: ${(branch.linkedBranchIds || []).map((id) => branchById(id)?.name || id).join(", ")}`,
      branch.notes
    ].filter(Boolean).join("\n")
  });
}

function addPriceItem(formData) {
  const now = new Date().toISOString();
  const item = {
    id: createId("PB"),
    code: String(formData.get("code") || createId("ITEM")).trim().toUpperCase(),
    name: String(formData.get("name") || "Price item").trim(),
    category: String(formData.get("category") || "General").trim(),
    unit: String(formData.get("unit") || "each").trim(),
    rate: parseAmount(formData.get("rate")),
    cost: parseAmount(formData.get("cost")),
    branch: String(formData.get("branch") || "All branches").trim(),
    justification: String(formData.get("justification") || "").trim(),
    sourceFile: "Manual price book",
    importedAt: now,
    pricingDate: today.toISOString().slice(0, 10),
    pricePolicy: "highest-rate-wins"
  };
  state.priceItems = [item, ...state.priceItems];
  applyHighestPricingPolicy();
  createFile({
    moduleKey: "pricing",
    linkedModuleKeys: ["revenueengine", "payments", "defensibility", "accounting"],
    sourceType: "priceItem",
    sourceId: item.id,
    amount: item.rate,
    title: `${item.code} ${item.name}`,
    type: "Price book item",
    owner: "Estimator",
    status: "Active",
    priority: item.rate > item.cost ? "Medium" : "High",
    due: "",
    relatedJob: item.branch,
    notes: [
      `Category: ${item.category}`,
      `Unit: ${item.unit}`,
      `Rate: ${formatMoney(item.rate)}`,
      `Cost: ${formatMoney(item.cost)}`,
      `Branch: ${item.branch}`,
      `Justification: ${item.justification || "Not entered"}`
    ].join("\n")
  });
  addActivity(`Added price book item ${item.code}.`);
  persist();
  setToast("Price item added");
  render();
}

function applyEstimateSettings(formData) {
  state.estimateDraft = {
    ...state.estimateDraft,
    estimateNo: String(formData.get("estimateNo") || state.estimateDraft.estimateNo).trim(),
    customer: String(formData.get("customer") || "").trim(),
    job: String(formData.get("job") || "").trim(),
    branch: String(formData.get("branch") || "").trim(),
    preparedBy: String(formData.get("preparedBy") || "").trim(),
    terms: String(formData.get("terms") || "").trim()
  };
  addActivity(`Updated estimate ${state.estimateDraft.estimateNo}.`);
  persist();
  setToast("Estimate updated");
  render();
}

function addEstimateLine(formData) {
  const priceItemId = String(formData.get("priceItemId") || "");
  if (!priceItemById(priceItemId)) {
    setToast("Choose a price item");
    render();
    return;
  }
  const line = {
    id: createId("EL"),
    priceItemId,
    qty: Math.max(0, parseAmount(formData.get("qty")) || 1),
    note: String(formData.get("note") || "").trim()
  };
  state.estimateDraft.lines = [line, ...state.estimateDraft.lines];
  addActivity(`Added ${priceItemById(priceItemId).name} to estimate.`);
  persist();
  setToast("Estimate line added");
  render();
}

function removeEstimateLine(lineId) {
  state.estimateDraft.lines = state.estimateDraft.lines.filter((line) => line.id !== lineId);
  addActivity("Removed estimate line.");
  persist();
  setToast("Estimate line removed");
  render();
}

function splitCsvLine(line) {
  const cells = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function parsePriceCsv(text) {
  const rows = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(splitCsvLine);
  if (!rows.length) return [];
  const headers = rows[0].map((header) => header.toLowerCase().replace(/[^a-z0-9]/g, ""));
  const hasHeader = headers.some((header) => ["code", "name", "item", "rate", "price", "unit", "cost"].includes(header));
  const body = hasHeader ? rows.slice(1) : rows;
  const headerAliases = {
    code: ["code", "selector", "catselector", "catsel", "lineitemcode", "act", "activity"],
    name: ["name", "item", "description", "desc", "lineitemdescription"],
    category: ["category", "cat", "trade", "group"],
    unit: ["unit", "uom", "unitofmeasure", "measure"],
    rate: ["rate", "price", "unitprice", "unitcost", "rcv", "amount", "total"],
    cost: ["cost", "laborcost", "materialcost"],
    branch: ["branch", "location", "market"],
    justification: ["justification", "notes", "note", "scope"],
    qty: ["qty", "quantity", "count"]
  };
  return body
    .map((row) => {
      const value = (name, fallbackIndex) => {
        const names = headerAliases[name] || [name];
        const index = names.map((alias) => headers.indexOf(alias)).find((aliasIndex) => aliasIndex >= 0);
        return row[index >= 0 ? index : fallbackIndex] || "";
      };
      return {
        id: createId("PB"),
        code: String(value("code", 0) || createId("ITEM")).trim().toUpperCase(),
        name: String(value("name", 1) || value("item", 1) || "Imported item").trim(),
        category: String(value("category", 2) || "Imported").trim(),
        unit: String(value("unit", 3) || "each").trim(),
        rate: parseAmount(value("rate", 4) || value("price", 4)),
        cost: parseAmount(value("cost", 5)),
        branch: String(value("branch", 6) || "All branches").trim(),
        justification: String(value("justification", 7) || value("notes", 7) || "").trim(),
        qty: Math.max(1, parseAmount(value("qty", 8)) || 1)
      };
    })
    .filter((item) => item.name);
}

function parseXactimateLines(text, fileName = "xactimate import") {
  const parsedItems = [];
  const textValue = String(text || "");
  const csvItems = parsePriceCsv(textValue)
    .filter((item) => item.rate || /xact|xm8|estimate|line/i.test(`${item.category} ${item.code} ${fileName}`))
    .map((item) => ({
      code: item.code,
      name: item.name,
      unit: item.unit,
      qty: item.qty || 1,
      rate: item.rate,
      source: fileName
    }));
  parsedItems.push(...csvItems);
  try {
    const xml = new DOMParser().parseFromString(textValue, "text/xml");
    const nodes = [...xml.querySelectorAll("lineItem, LineItem, item, Item, estimateItem, EstimateItem, rec, Rec, estimateLine, EstimateLine")];
    nodes.forEach((node) => {
      const attr = (name) => node.getAttribute(name) || node.querySelector(name)?.textContent || node.querySelector(name.toLowerCase())?.textContent || "";
      const code = attr("code") || attr("selector") || attr("catSel") || attr("lineItemCode") || attr("act") || attr("activity");
      const name = attr("description") || attr("desc") || attr("name") || attr("lineItemDescription") || node.textContent.trim().slice(0, 80);
      const unit = attr("unit") || attr("unitOfMeasure") || attr("uom") || "each";
      const qty = parseAmount(attr("quantity") || attr("qty") || "1") || 1;
      const rate = parseAmount(attr("unitPrice") || attr("price") || attr("rate") || attr("rcv") || attr("amount") || attr("unitcost"));
      if (name && (code || rate)) {
        parsedItems.push({ code: code || createId("XM8"), name, unit, qty, rate, source: fileName });
      }
    });
  } catch {
    // Fall through to text parsing.
  }
  if (!parsedItems.length) {
    textValue.split(/\r?\n/).forEach((line) => {
      const match = line.match(/^\s*([A-Z]{2,5}[.\-\s]?[A-Z0-9]{2,})\s+(.{8,}?)\s+(\d+(?:\.\d+)?)\s+(EA|SF|LF|HR|DAY|DAYS|SQ|YD|CY|ITEM|EACH)\s+\$?(\d+(?:\.\d{1,2})?)/i);
      if (match) {
        parsedItems.push({
          code: match[1].replace(/\s+/g, ".").toUpperCase(),
          name: match[2].trim(),
          qty: parseAmount(match[3]) || 1,
          unit: match[4].toLowerCase(),
          rate: parseAmount(match[5]),
          source: fileName
        });
      }
    });
  }
  const seen = new Set();
  return parsedItems.filter((item) => {
    const key = `${item.code}|${item.name}|${item.unit}|${item.rate}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return item.name && Number.isFinite(Number(item.rate));
  });
}

function pricingImportTotal(lines) {
  return lines.reduce((sum, line) => sum + Number(line.qty || 1) * Number(line.rate || 0), 0);
}

function parsePastedPricingImport(text, sourceName = "pasted pricing import") {
  const textValue = String(text || "").trim();
  if (!textValue) return [];
  const firstLines = textValue.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 3);
  if (firstLines.some((line) => line.includes(","))) {
    const csvLines = parsePriceCsv(textValue)
      .filter((item) => Number(item.rate || 0) > 0)
      .map((item) => ({
        ...item,
        qty: item.qty || 1,
        source: sourceName
      }));
    if (csvLines.length) return csvLines;
  }
  return parseXactimateLines(textValue, sourceName);
}

function importPricingLines(lines, sourceName, options = {}) {
  const now = new Date().toISOString();
  const normalizedLines = lines
    .map((line) => ({
      ...line,
      code: String(line.code || createId("ITEM")).trim().toUpperCase(),
      name: String(line.name || "Imported item").trim(),
      unit: String(line.unit || "each").trim(),
      rate: parseAmount(line.rate),
      cost: parseAmount(line.cost),
      qty: Math.max(1, parseAmount(line.qty) || 1)
    }))
    .filter((line) => line.name && Number(line.rate || 0) > 0);
  if (!normalizedLines.length) {
    return { items: [], total: 0 };
  }
  const category = options.category || "Xactimate pricing";
  const branch = options.branch || "Pricing import";
  const sourceType = options.sourceType || "pricingImport";
  const total = pricingImportTotal(normalizedLines);
  const importNotes = options.notes || "Imported into the Price Book and linked to billing, accounting, revenue, and defensibility workflows.";
  const items = normalizedLines.map((line) => ({
    id: createId("PB"),
    code: line.code,
    name: line.name,
    category: line.category || category,
    unit: line.unit,
    rate: line.rate,
    cost: line.cost,
    branch: line.branch || branch,
    sourceFile: sourceName,
    importedAt: now,
    pricingDate: inferPricingDate(sourceName, now),
    pricePolicy: "highest-rate-wins",
    justification: line.justification || `Imported from ${sourceName}. Quantity in estimate: ${line.qty}. Highest/latest pricing policy keeps the active rate at the highest known price for this line.`
  }));
  state.priceItems = [...items, ...state.priceItems];
  applyHighestPricingPolicy();
  state.xactimateImports = [
    {
      id: createId("XI"),
      fileName: sourceName,
      importedAt: now,
      lineCount: items.length,
      total,
      status: options.status || "Imported",
      notes: importNotes
    },
    ...state.xactimateImports
  ];
  createFile({
    moduleKey: "pricing",
    linkedModuleKeys: ["defensibility", "payments", "accounting", "revenueengine"],
    sourceType,
    sourceId: sourceName,
    amount: total,
    title: options.title || `${sourceName} pricing import`,
    type: options.type || "Pricing import",
    owner: "Estimator",
    status: options.status || "Imported",
    priority: "Medium",
    due: today.toISOString().slice(0, 10),
    relatedJob: state.estimateDraft.job,
    notes: [
      `${items.length} line items imported into the price book.`,
      `Total source value: ${formatMoney(total)}`,
      importNotes,
      "Linked modules: pricing, defensibility, payments, accounting, and revenue engine."
    ].join("\n")
  });
  addActivity(`${options.activityPrefix || "Imported"} ${items.length} pricing line items from ${sourceName}.`);
  return { items, total };
}

function importPastedPricing(formData) {
  const sourceName = String(formData.get("sourceName") || `Pasted pricing ${today.toISOString().slice(0, 10)}`).trim();
  const lines = parsePastedPricingImport(formData.get("importText"), sourceName);
  if (!lines.length) {
    setToast("No pricing lines detected");
    render();
    return;
  }
  const result = importPricingLines(lines, sourceName, {
    sourceType: "pastedPriceImport",
    title: `${sourceName} pasted pricing import`,
    notes: "Imported from pasted CSV, text, or Xactimate-style line items.",
    activityPrefix: "Imported pasted"
  });
  persist();
  setToast(`${result.items.length} pasted pricing lines imported`);
  routeToModule("pricing");
}

function importSamplePricing() {
  const sourceName = `Sample pricing ${today.toISOString().slice(0, 10)}`;
  const sampleText = [
    "WTR.LAB Water mitigation technician labor 4 HR 85.00",
    "EQP.DEH Commercial dehumidifier rental 3 DAYS 95.00",
    "DOC.PKT Photo and invoice support packet 1 EACH 185.00"
  ].join("\n");
  const lines = parsePastedPricingImport(sampleText, sourceName);
  const result = importPricingLines(lines, sourceName, {
    sourceType: "samplePriceImport",
    title: `${sourceName} starter price book`,
    notes: "Starter pricing loaded from the built-in sample so the estimate workflow can be tested without a file upload.",
    activityPrefix: "Loaded sample"
  });
  persist();
  setToast(`${result.items.length} sample pricing lines loaded`);
  routeToModule("pricing");
}

async function processXactimateFile(file) {
  try {
    const arrayBuffer = await readFileAsArrayBuffer(file);
    const extracted = await extractImportText(file, arrayBuffer);
    const lines = parseXactimateLines(extracted.text, file.name);
    if (!lines.length) {
      state.xactimateImports = [
        {
          id: createId("XI"),
          fileName: file.name,
          importedAt: new Date().toISOString(),
          lineCount: 0,
          total: 0,
          status: extracted.packageDetected ? "Captured package - needs line export" : "Needs review",
          notes: extracted.packageDetected
            ? `Captured ${extracted.entries.length || 1} ESX/PDF package entries. This file appears proprietary or image/compressed; upload a Xactimate line-item PDF/text/CSV/XML export for automatic line extraction.`
            : "No line items were detected. For PDFs, export a text, CSV, or ESX/XML line-item report when possible."
        },
        ...state.xactimateImports
      ];
      createFile({
        moduleKey: "pricing",
        linkedModuleKeys: ["defensibility", "payments", "accounting", "revenueengine"],
        sourceType: "xactimateImport",
        sourceId: file.name,
        title: `${file.name} import review`,
        type: "Xactimate import",
        owner: "Estimator",
        status: "Needs review",
        priority: "High",
        notes: `${file.name} was captured but no readable line items were found.\nDetected entries: ${extracted.entries.join(", ") || "none"}\nNext step: upload a line-item PDF/text/CSV/XML export or process this ESX through a backend extractor.`
      });
      return { fileName: file.name, imported: 0, captured: true };
    }
    const result = importPricingLines(lines, file.name, {
      sourceType: "xactimateImport",
      title: `${file.name} Xactimate pricing import`,
      type: "Xactimate import",
      branch: "Xactimate import",
      notes: "Imported into Price Book under Xactimate pricing.",
      activityPrefix: "Imported"
    });
    return { fileName: file.name, imported: result.items.length, captured: false };
  } catch {
    return { fileName: file.name, imported: 0, captured: false, failed: true };
  }
}

async function handleXactimateImport(input) {
  const files = [...(input.files || [])];
  if (!files.length) return;
  const results = [];
  for (const file of files) {
    results.push(await processXactimateFile(file));
  }
  applyHighestPricingPolicy();
  persist();
  const imported = results.reduce((sum, result) => sum + Number(result.imported || 0), 0);
  const captured = results.filter((result) => result.captured).length;
  const failed = results.filter((result) => result.failed).length;
  const summary = `${imported} lines imported${captured ? `, ${captured} captured for review` : ""}${failed ? `, ${failed} failed` : ""}`;
  addActivity(`Batch Xactimate import: ${summary}.`);
  setToast(summary);
  routeToModule("pricing");
}

function textFromBytes(bytes) {
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const latin = new TextDecoder("iso-8859-1", { fatal: false }).decode(bytes);
  return utf8.replace(/\u0000/g, " ").length >= latin.replace(/\u0000/g, " ").length ? utf8 : latin;
}

function looksLikeZip(bytes) {
  return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

async function parseZipEntries(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);
  const entries = [];
  let offset = 0;
  while (offset + 30 < bytes.length) {
    if (view.getUint32(offset, true) !== 0x04034b50) break;
    const method = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const uncompressedSize = view.getUint32(offset + 22, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > bytes.length) break;
    const name = new TextDecoder().decode(bytes.slice(nameStart, nameStart + nameLength));
    let data = bytes.slice(dataStart, dataEnd);
    if (method === 8 && "DecompressionStream" in window) {
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      data = new Uint8Array(await new Response(stream).arrayBuffer());
    }
    if (method === 0 || method === 8) {
      entries.push({ name, method, compressedSize, uncompressedSize, bytes: data, text: textFromBytes(data) });
    } else {
      entries.push({ name, method, compressedSize, uncompressedSize, bytes: new Uint8Array(), text: "" });
    }
    offset = dataEnd;
  }
  return entries;
}

function extractPdfLikeText(bytes) {
  const raw = textFromBytes(bytes);
  const literalStrings = [...raw.matchAll(/\(([^()]{3,180})\)/g)].map((match) => match[1].replace(/\\([()\\])/g, "$1"));
  const asciiRuns = [...raw.matchAll(/[A-Za-z0-9 .,$:/#()\-]{8,}/g)].map((match) => match[0]);
  return [...literalStrings, ...asciiRuns].join("\n");
}

async function extractImportText(file, arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const entries = [];
  const parts = [];
  let packageDetected = false;
  if (looksLikeZip(bytes)) {
    packageDetected = true;
    const zipEntries = await parseZipEntries(arrayBuffer);
    for (const entry of zipEntries) {
      entries.push(entry.name);
      parts.push(`\n--- ${entry.name} ---\n${entry.text}`);
      if (looksLikeZip(entry.bytes)) {
        const nested = await parseZipEntries(entry.bytes.buffer.slice(entry.bytes.byteOffset, entry.bytes.byteOffset + entry.bytes.byteLength));
        nested.forEach((nestedEntry) => {
          entries.push(`${entry.name}/${nestedEntry.name}`);
          parts.push(`\n--- ${entry.name}/${nestedEntry.name} ---\n${nestedEntry.text}`);
        });
      }
    }
  } else {
    const isPdf = file.name.toLowerCase().endsWith(".pdf") || bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
    parts.push(isPdf ? extractPdfLikeText(bytes) : textFromBytes(bytes));
    packageDetected = isPdf;
  }
  return { text: parts.join("\n"), packageDetected, entries };
}

function readFile(file, asDataUrl = false) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    if (asDataUrl) reader.readAsDataURL(file);
    else reader.readAsText(file);
  });
}

function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

async function handlePriceCsvUpload(input) {
  const file = input.files?.[0];
  if (!file) return;
  try {
    const text = await readFile(file);
    const items = parsePriceCsv(text);
    const result = importPricingLines(items, file.name, {
      sourceType: "priceCsvImport",
      category: "Imported pricing",
      branch: "CSV import",
      title: `${file.name} CSV price book import`,
      notes: "Imported from CSV into the active price book and linked to billing workflows.",
      activityPrefix: "Imported"
    });
    persist();
    setToast(`${result.items.length} price items imported`);
    render();
  } catch {
    setToast("Pricing upload failed");
    render();
  }
}

async function handleLogoUpload(input) {
  const file = input.files?.[0];
  if (!file) return;
  try {
    const dataUrl = await readFile(file, true);
    state.estimateDraft.logoDataUrl = String(dataUrl || "");
    addActivity(`Uploaded estimate logo ${file.name}.`);
    persist();
    setToast("Logo uploaded");
    render();
  } catch {
    setToast("Logo upload failed");
    render();
  }
}

function downloadBlob(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function estimateHtml() {
  const lines = estimateLines();
  const subtotal = estimateSubtotal();
  const cost = lines.reduce((sum, line) => sum + estimateLineCost(line), 0);
  const margin = subtotal ? Math.round(((subtotal - cost) / subtotal) * 100) : 0;
  const logo = state.estimateDraft.logoDataUrl
    ? `<img src="${state.estimateDraft.logoDataUrl}" alt="Company logo" style="max-width:160px;max-height:80px;object-fit:contain" />`
    : `<div style="width:64px;height:64px;border-radius:8px;background:#f4c04f;display:grid;place-items:center;font-weight:900;font-size:30px">B</div>`;
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(state.estimateDraft.estimateNo)} ${escapeHtml(state.estimateDraft.customer)}</title>
  <style>
    body{font-family:Arial,sans-serif;color:#17202a;margin:32px;line-height:1.45}
    header{display:flex;justify-content:space-between;gap:24px;align-items:flex-start;border-bottom:2px solid #17202a;padding-bottom:18px;margin-bottom:22px}
    h1{margin:0;font-size:28px}
    table{width:100%;border-collapse:collapse;margin-top:20px}
    th,td{border-bottom:1px solid #d9e0e8;padding:10px;text-align:left;vertical-align:top}
    th{font-size:12px;text-transform:uppercase;color:#687383}
    .right{text-align:right}
    .total{font-size:22px;font-weight:800}
    .terms{margin-top:24px;background:#f6f8fb;border:1px solid #d9e0e8;padding:14px;border-radius:8px}
  </style>
</head>
<body>
  <header>
    <div>${logo}<h1>${escapeHtml(state.estimateDraft.estimateNo)}</h1><p>${escapeHtml(state.estimateDraft.branch)}</p></div>
    <div>
      <strong>${escapeHtml(state.estimateDraft.customer)}</strong><br />
      ${escapeHtml(state.estimateDraft.job)}<br />
      Prepared by ${escapeHtml(state.estimateDraft.preparedBy)}<br />
      ${escapeHtml(formatDate(today.toISOString()))}
    </div>
  </header>
  <table>
    <thead><tr><th>Code</th><th>Description</th><th>Qty</th><th>Unit</th><th class="right">Rate</th><th class="right">Total</th></tr></thead>
    <tbody>
      ${lines
        .map(
          (line) => `<tr><td>${escapeHtml(line.item.code)}</td><td><strong>${escapeHtml(line.item.name)}</strong><br />${escapeHtml(line.note || line.item.justification || "")}</td><td>${escapeHtml(line.qty)}</td><td>${escapeHtml(line.item.unit)}</td><td class="right">${escapeHtml(formatMoney(line.item.rate))}</td><td class="right">${escapeHtml(formatMoney(estimateLineTotal(line)))}</td></tr>`
        )
        .join("")}
    </tbody>
  </table>
  <p class="total right">Total ${escapeHtml(formatMoney(subtotal))}</p>
  <p class="right">Estimated margin ${margin}%</p>
  <div class="terms"><strong>Terms</strong><br />${escapeHtml(state.estimateDraft.terms)}</div>
</body>
</html>`;
}

function downloadEstimate() {
  const filename = `${state.estimateDraft.estimateNo || "estimate"}-${today.toISOString().slice(0, 10)}.html`;
  downloadBlob(filename, estimateHtml(), "text/html");
  addActivity(`Downloaded estimate ${state.estimateDraft.estimateNo}.`);
  persist();
  setToast("Estimate downloaded");
  render();
}

function createEstimateInvoice() {
  const lines = estimateLines();
  if (!lines.length) {
    setToast("Add at least one estimate line before creating an invoice");
    render();
    return;
  }
  const notes = [
    `Estimate: ${state.estimateDraft.estimateNo}`,
    `Customer: ${state.estimateDraft.customer}`,
    `Job: ${state.estimateDraft.job}`,
    `Branch: ${state.estimateDraft.branch}`,
    `Total: ${formatMoney(estimateSubtotal())}`,
    "",
    "Lines:",
    ...lines.map((line) => `- ${line.item.code} ${line.item.name}: ${line.qty} ${line.item.unit} x ${formatMoney(line.item.rate)} = ${formatMoney(estimateLineTotal(line))}`),
    "",
    state.estimateDraft.terms
  ].join("\n");
  createFile({
    moduleKey: "payments",
    linkedModuleKeys: ["pricing", "accounting", "revenueengine", "defensibility", "jobs"],
    sourceType: "estimateInvoice",
    sourceId: state.estimateDraft.estimateNo,
    customer: state.estimateDraft.customer,
    amount: estimateSubtotal(),
    title: `${state.estimateDraft.estimateNo} invoice request`,
    type: "Invoice",
    owner: state.estimateDraft.preparedBy || "Bookkeeping",
    status: "Drafting",
    priority: "High",
    due: today.toISOString().slice(0, 10),
    relatedJob: state.estimateDraft.job,
    notes
  });
  ensureWorkflowTasks([
    {
      title: `Post ${state.estimateDraft.estimateNo} to accounting`,
      moduleKey: "accounting",
      relatedJob: state.estimateDraft.job,
      due: today.toISOString().slice(0, 10),
      priority: "High",
      sourceType: "estimateInvoice",
      sourceId: state.estimateDraft.estimateNo
    },
    {
      title: `Review defensibility support for ${state.estimateDraft.estimateNo}`,
      moduleKey: "defensibility",
      relatedJob: state.estimateDraft.job,
      due: today.toISOString().slice(0, 10),
      priority: "Medium",
      sourceType: "estimateInvoice",
      sourceId: state.estimateDraft.estimateNo
    }
  ]);
  persist();
  render();
}

function createPaymentRequest(formData) {
  const amount = parseAmount(formData.get("amount"));
  const method = String(formData.get("method") || "Card");
  const routeMap = {
    Card: "/api/payments/stripe/intent",
    PayPal: "/api/payments/paypal/order",
    Zelle: "/api/payments/zelle/instructions",
    Wire: "/api/payments/wire/instructions"
  };
  const customer = String(formData.get("customer") || "Customer").trim();
  const job = String(formData.get("job") || "").trim();
  const instructions =
    method === "Wire"
      ? "Generate secure wiring instructions from backend configuration and verify recipient before sending."
      : method === "Zelle"
        ? "Send Zelle instructions using the configured business email/phone."
        : method === "PayPal"
          ? "Create PayPal order from backend endpoint."
          : "Create card payment intent from payment processor backend.";
  createFile({
    moduleKey: "payments",
    linkedModuleKeys: ["accounting", "revenueengine", "jobs", "relationships"],
    sourceType: "paymentRequest",
    sourceId: `${method}-${customer}-${job}-${Date.now()}`,
    customer,
    amount,
    title: `${method} payment request - ${customer}`,
    type: "Payment request",
    owner: "Bookkeeping",
    status: "Open",
    priority: amount >= 1000 ? "High" : "Medium",
    due: String(formData.get("due") || today.toISOString().slice(0, 10)),
    relatedJob: job,
    notes: [
      `Amount: ${formatMoney(amount)}`,
      `Method: ${method}`,
      `Customer: ${customer}`,
      `Job: ${job}`,
      `Email/phone: ${String(formData.get("contact") || "").trim()}`,
      `Backend route: ${routeMap[method] || "/api/payments/manual-receipt"}`,
      instructions,
      "Security: never collect customer bank login credentials inside this app."
    ].join("\n")
  });
  ensureWorkflowTask({
    title: `Record ${method} payment status for ${customer}`,
    moduleKey: "accounting",
    relatedJob: job,
    due: String(formData.get("due") || today.toISOString().slice(0, 10)),
    priority: amount >= 1000 ? "High" : "Medium",
    sourceType: "paymentRequest",
    sourceId: `${method}-${customer}-${job}`
  });
  persist();
  render();
}

function createPaymentRailSetup(method, route, detail) {
  createFile({
    moduleKey: "payments",
    linkedModuleKeys: ["accounting", "integrations", "securitycenter"],
    sourceType: "paymentRail",
    sourceId: method,
    title: `${method} payment rail setup`,
    type: "Payment rail",
    owner: "Bookkeeping",
    status: route === "gateway-ready" ? "Planned" : "Needs configuration",
    priority: method === "Future rails" ? "Low" : "High",
    due: today.toISOString().slice(0, 10),
    relatedJob: "Payment operations",
    notes: [
      `Rail: ${method}`,
      `Backend route: ${route}`,
      `Purpose: ${detail}`,
      route === "gateway-ready"
        ? "Next step: choose the processor and add an approved backend connector before collecting money through this rail."
        : "Next step: add verified processor credentials and a server endpoint before sending live payment links.",
      "Security: keep processor secrets in Vercel environment variables only."
    ].join("\n")
  });
}

function connectQuickBooks() {
  state.quickBooksConnection = {
    ...state.quickBooksConnection,
    connected: false,
    companyName: state.quickBooksConnection.companyName || "Connected contractor company",
    realmId: state.quickBooksConnection.realmId || createId("QBO"),
    lastSync: new Date().toISOString(),
    mode: "OAuth setup file created"
  };
  createFile({
    moduleKey: "accounting",
    linkedModuleKeys: ["payments", "integrations", "reports", "globalindexes"],
    sourceType: "quickBooksSetup",
    sourceId: state.quickBooksConnection.realmId,
    title: "QuickBooks OAuth setup",
    type: "Integration setup",
    owner: "Bookkeeping",
    status: "Needs configuration",
    priority: "High",
    due: today.toISOString().slice(0, 10),
    relatedJob: "Accounting integration",
    notes: [
      "Connect QuickBooks through a secured OAuth backend before syncing invoices, expenses, projects, or profit data.",
      "Required production inputs: QuickBooks client id, client secret, redirect URI, company realm id, token storage, and webhook verification.",
      "No live accounting data is transmitted until those credentials and routes are configured."
    ].join("\n")
  });
  addActivity("Created QuickBooks OAuth setup file for invoice, expense, project, and profit tracking.");
  persist();
  setToast("QuickBooks setup file created");
  render();
}

function addTeamMember(formData) {
  const accountType = String(formData.get("accountType") || "Employee");
  const permissions = formData.getAll("permissions").map(String);
  const accessCode = String(formData.get("accessCode") || createId(accountType === "Contractor portal" ? "CON" : "EMP")).trim().toUpperCase();
  const assignedJobIds = csvValues(formData.get("assignedJobIds"));
  const member = normalizeTeamMember({
    id: createId("TM"),
    name: String(formData.get("name") || "Team member").trim(),
    email: String(formData.get("email") || "").trim(),
    role: String(formData.get("role") || "User").trim(),
    accountType,
    access: String(formData.get("access") || "Assigned modules").trim(),
    permissions: permissions.length ? permissions : accountType === "Administrator" ? ["owner-dashboard", "user-management", "billing", "exports", "ai-admin", "security"] : ["time", "drylogs", "jobs", "photos", "equipment", "communications"],
    accessCode,
    assignedJobIds,
    assignedTaskIds: [],
    status: "Invited",
    lastLogin: ""
  });
  state.teamMembers = [member, ...state.teamMembers.filter((item) => item.id !== member.id)];
  createFile({
    moduleKey: "team",
    linkedModuleKeys: ["jobs", "time", "photos", "communications"],
    sourceType: "teamMember",
    sourceId: member.id,
    title: `${member.name} employee access profile`,
    type: "User access",
    owner: "Super Admin",
    status: member.status,
    priority: assignedJobIds.length ? "Medium" : "High",
    due: today.toISOString().slice(0, 10),
    relatedJob: assignedJobIds[0] || "",
    notes: [
      `Email: ${member.email}`,
      `Role: ${member.role}`,
      `Portal code: ${member.accessCode}`,
      `Modules: ${(member.permissions || []).join(", ")}`,
      `Assigned jobs: ${assignedJobIds.join(", ") || "None yet"}`
    ].join("\n")
  });
  addActivity(`Created login invitation for ${member.name}.`);
  persist();
  setToast("Team login created");
  render();
}

function addTask(formData) {
  const assigneeId = String(formData.get("assigneeId") || assignableTeamMembers()[0]?.id || "");
  const assignee = assignableTeamMembers().find((member) => member.id === assigneeId);
  const relatedJob = String(formData.get("relatedJob") || "").trim();
  const task = {
    id: createId("TASK"),
    title: String(formData.get("title") || "Task").trim(),
    assigneeId,
    assigneeName: assignee?.name || "",
    assigneeEmail: assignee?.email || "",
    moduleKey: String(formData.get("moduleKey") || "jobs"),
    relatedJob,
    due: String(formData.get("due") || ""),
    status: "Open",
    priority: String(formData.get("priority") || "Medium")
  };
  state.tasks = [task, ...state.tasks];
  state.teamMembers = (state.teamMembers || []).map((member) => {
    if (member.id !== assigneeId) return member;
    const assignedTaskIds = [...new Set([task.id, ...normalizeListValue(member.assignedTaskIds)])];
    const assignedJobIds = [...new Set([...(relatedJob ? [relatedJob] : []), ...normalizeListValue(member.assignedJobIds)])];
    return normalizeTeamMember({ ...member, assignedTaskIds, assignedJobIds });
  });
  createFile({
    moduleKey: "team",
    linkedModuleKeys: ["jobs", task.moduleKey, "time", "photos"],
    sourceType: "taskAssignment",
    sourceId: task.id,
    title: `${assignee?.name || "Unassigned"} task - ${task.title}`,
    type: "Task assignment",
    owner: assignee?.name || "Dispatcher",
    status: task.status,
    priority: task.priority,
    due: task.due,
    relatedJob: task.relatedJob,
    notes: [
      `Task: ${task.title}`,
      `Assignee: ${assignee?.name || "Unassigned"} ${assignee?.email || ""}`.trim(),
      `Module: ${moduleByKey(task.moduleKey)?.label || task.moduleKey}`,
      `Related job: ${task.relatedJob || "None"}`
    ].join("\n")
  });
  addActivity(`Assigned task: ${task.title}.`);
  persist();
  setToast("Task assigned");
  render();
}

function fieldSessionForMember(member, accessCode) {
  return {
    id: member.id,
    name: member.name,
    email: member.email,
    code: employeeAccessCodeFor(member),
    accountType: member.accountType || "Employee",
    role: member.role || "Worker",
    permissions: (member.permissions || []).filter((key) => employeeAllowedModuleKeys.includes(key)),
    assignedJobIds: normalizeListValue(member.assignedJobIds),
    assignedTaskIds: normalizeListValue(member.assignedTaskIds),
    accessCodeEntered: String(accessCode || "").trim()
  };
}

function findEmployeeForPortalLogin(identifier, accessCode) {
  const normalizedCode = normalizeLocalAccessCode(accessCode);
  const normalizedIdentifier = String(identifier || "").trim().toLowerCase();
  return assignableTeamMembers().find((member) => {
    const codeMatches = normalizeLocalAccessCode(employeeAccessCodeFor(member)) === normalizedCode;
    if (!codeMatches) return false;
    if (!normalizedIdentifier) return true;
    return [member.id, member.email, member.name]
      .map((value) => String(value || "").trim().toLowerCase())
      .some((value) => value === normalizedIdentifier);
  }) || null;
}

function loginEmployeePortal(formData) {
  const identifier = String(formData.get("identifier") || formData.get("email") || formData.get("name") || "").trim();
  const code = String(formData.get("code") || "").trim();
  const member = findEmployeeForPortalLogin(identifier, code);
  if (!member) {
    setToast("Employee profile or access code was not accepted");
    return render();
  }
  state.teamMembers = (state.teamMembers || []).map((item) =>
    item.id === member.id ? normalizeTeamMember({ ...item, status: "Active", lastLogin: new Date().toISOString() }) : item
  );
  state.worker = fieldSessionForMember(member, code);
  state.employeeMode = true;
  state.modal = null;
  addActivity(`${member.name} entered employee field access.`);
  persist();
  routeToModule(employeeModuleKeys()[0] || "time");
}

function completeTask(taskId) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return;
  task.status = "Complete";
  addActivity(`Completed task: ${task.title}.`);
  persist();
  setToast("Task complete");
  render();
}

function addSketchRoom(formData) {
  const width = Math.max(4, parseAmount(formData.get("width")) || 12);
  const height = Math.max(4, parseAmount(formData.get("height")) || 10);
  const index = state.sketchRooms.length;
  const room = {
    id: createId("ROOM"),
    name: String(formData.get("name") || `Room ${index + 1}`).trim(),
    assignedJob: String(formData.get("assignedJob") || "").trim(),
    width,
    height,
    x: 6 + (index * 13) % 70,
    y: 10 + (index * 11) % 55,
    w: Math.min(36, Math.max(12, width * 1.4)),
    h: Math.min(34, Math.max(10, height * 1.4)),
    notes: String(formData.get("notes") || "").trim(),
    scribble: String(formData.get("scribble") || "").trim()
  };
  state.sketchRooms = [room, ...state.sketchRooms];
  addActivity(`Added sketch room ${room.name}.`);
  persist();
  setToast("Room added to sketch");
  render();
}

function professionalizeSketch() {
  state.sketchRooms = state.sketchRooms.map((room, index) => ({
    ...room,
    x: 6 + (index % 3) * 29,
    y: 10 + Math.floor(index / 3) * 24,
    w: Math.min(27, Math.max(14, Number(room.width || 10) * 1.1)),
    h: Math.min(22, Math.max(10, Number(room.height || 8) * 1.1)),
    notes: room.notes || `Professionalized from scribble: ${room.scribble || "room outline"}`
  }));
  addActivity("Professionalized sketch rooms into floor plan blocks.");
  persist();
  setToast("Sketch professionalized");
  render();
}

function generateDefensibilityReview(formData) {
  const photo = Number(formData.get("photoSupport") || 0);
  const quantity = Number(formData.get("quantitySupport") || 0);
  const time = Number(formData.get("timeSupport") || 0);
  const equipment = Number(formData.get("equipmentSupport") || 0);
  const compliance = Number(formData.get("complianceSupport") || 0);
  const score = Math.round((photo + quantity + time + equipment + compliance) / 5);
  const notes = [
    `Defensibility score: ${score}/100`,
    `Estimate: ${String(formData.get("estimateName") || "Estimate").trim()}`,
    `Weak points: ${String(formData.get("weakPoints") || "None entered").trim()}`,
    `Actions: attach missing photos, measurements, time, equipment logs, approvals, and compliance source pointers.`
  ].join("\n");
  createFile({
    moduleKey: "defensibility",
    linkedModuleKeys: ["pricing", "payments", "jobs", "supplement", "evidencechain"],
    sourceType: "defensibilityReview",
    sourceId: `${String(formData.get("estimateName") || "Estimate").trim()}-${String(formData.get("relatedJob") || "").trim()}`,
    title: `${String(formData.get("estimateName") || "Estimate")} defensibility review`,
    type: "Defensibility score",
    owner: "Estimator",
    status: score >= 80 ? "Active" : "Needs review",
    priority: score >= 80 ? "Medium" : "High",
    due: today.toISOString().slice(0, 10),
    relatedJob: String(formData.get("relatedJob") || ""),
    notes
  });
}

function generateSupplementPacket(formData) {
  const issue = String(formData.get("issue") || "Carrier reduction").trim();
  const disputed = String(formData.get("disputedLines") || "").trim();
  const facts = String(formData.get("facts") || "").trim();
  const response = buildStandardsOutput(
    new FormData(
      Object.assign(document.createElement("form"), {
        innerHTML: `
          <input name="moduleKey" value="supplement" />
          <input name="mode" value="rebuttal" />
          <input name="issue" value="${escapeHtml(issue)}" />
          <input name="adjusterJargon" value="${escapeHtml(disputed)}" />
          <input name="requestedOutcome" value="restore supplement line items" />
          <textarea name="facts">${escapeHtml(facts)}</textarea>
        `
      })
    )
  );
  saveGeneratedStandardsOutput(response, "Supplement rebuttal generated");
  createFile({
    moduleKey: "supplement",
    linkedModuleKeys: ["pricing", "payments", "jobs", "defensibility", "evidencechain"],
    sourceType: "supplementPacket",
    sourceId: `${issue}-${String(formData.get("relatedJob") || "").trim()}`,
    title: `${issue} supplement packet`,
    type: "Supplement packet",
    owner: "Estimator",
    status: "Needs review",
    priority: "High",
    due: today.toISOString().slice(0, 10),
    relatedJob: String(formData.get("relatedJob") || ""),
    notes: standardsOutputText(response)
  });
}

function updatePerformanceMetric(formData) {
  const key = String(formData.get("metric") || "");
  if (!key) return;
  state.performanceMetrics[key] = parseAmount(formData.get("value"));
  addActivity(`Updated performance metric ${key}.`);
  persist();
  setToast("Performance updated");
  render();
}

function copilotSearchText(hits) {
  if (!hits.length) return "";
  return `Best OS matches:\n${hits.map((hit) => `- ${hit.type}: ${hit.title} (${moduleByKey(hit.key)?.label || hit.key})`).join("\n")}`;
}

function copilotDryLogText(query) {
  const lower = String(query || "").toLowerCase();
  const matchedJob = state.jobBoards.find((job) => lower.includes(job.jobId.toLowerCase()) || lower.includes(job.title.toLowerCase()));
  const jobs = matchedJob ? [matchedJob] : state.jobBoards;
  const summaries = jobs.map((job) => ({ job, summary: dryLogSummaryForJob(job) })).filter((item) => item.summary.logs.length);
  if (!summaries.length) return "No dry logs are saved yet. Open Dry Logs / Moisture Tracking and add a reading tied to a job.";
  return summaries
    .slice(0, 4)
    .map(({ job, summary }) => {
      const latest = summary.latest;
      return `${job.jobId}: ${summary.status}. Latest ${latest.room} ${latest.moisture}% vs target ${latest.targetMoisture}% on ${formatDate(latest.readingDate)}. ${summary.openReadings} reading(s) still above target.`;
    })
    .join("\n");
}

function buildBrotherCopilotAnswer(query) {
  const lower = query.toLowerCase();
  const metrics = copilotMetrics();
  const segments = [];
  const mathExpression = extractMathQuestion(query);
  const mathResult = mathExpression ? parseMathExpression(mathExpression) : null;
  if (mathResult !== null) {
    segments.push(`Calculation: ${mathExpression.trim()} = ${formatMoney(mathResult).replace(".00", "")} (${Number(mathResult.toFixed(4))}).`);
  }
  if (/(who are you|nickname|what can you do|capabil|chat|discussion|ask ai|copilot|brother)/i.test(query)) {
    segments.push(
      `${state.aiCopilotProfile.nickname} is the OS-aware assistant for this workspace. I can discuss modules, search local files, summarize jobs, draft next actions, explain pricing, review dry logs, calculate revenue/time/equipment totals, and prepare rebuttal or code-search direction from the saved standards connector data.`
    );
    segments.push(`Current context: ${metrics.modules} modules, ${metrics.files} files, ${metrics.jobs} jobs, ${metrics.activePrices} active price lines, ${state.standardsOutputs.length} AI/code outputs, and ${state.learnedJargon.length} learned jargon terms.`);
  }
  if (/(action dashboard|custom dashboard|dashboard|pinned|preview)/i.test(query)) {
    const cards = actionDashboardKeys().map((key) => moduleByKey(key)?.label || key);
    segments.push(`Action dashboard: ${cards.length} live preview cards are selected: ${cards.join(", ")}. Use the checkbox builder on Daily Owner Dashboard to change the module set, save the title, and control the max preview count.`);
  }
  if (/(investor|institutional|investment|diligence|readiness|machine|platform quality|high performance)/i.test(query)) {
    const review = calculateInstitutionalReadiness();
    segments.push(
      `Institutional read: ${review.score}/100, ${review.verdict}. Strongest signals are ${review.strengths.slice(0, 2).join(" ")} Primary diligence items: ${review.risks.slice(0, 2).join(" ")}`
    );
  }
  if (/(skill|database|data vault|knowledge|dataset|source)/i.test(query)) {
    segments.push(
      `Skills/data engine: ${state.skillPacks.filter((skill) => skill.status === "Active").length} active skill packs and ${state.dataVaults.length} data vaults. Live coverage includes ${state.dataVaults.map((vault) => `${vault.name} (${recordCountForVault(vault)})`).slice(0, 6).join(", ")}.`
    );
  }
  if (/(money|invoice|receivable|profit|expense|cash|unbilled|payment)/i.test(query)) {
    segments.push(
      `Money snapshot: ${formatMoney(metrics.receivables)} open receivables, ${metrics.delayedInvoices} delayed invoice(s), ${metrics.unbilledItems} unbilled item(s), ${formatMoney(metrics.equipmentRevenue)} equipment revenue in tracked deployments, and ${metrics.profit}% current job-profit input.`
    );
  }
  if (/(service request|callout|call out|callback|schedule|help request)/i.test(query)) {
    const openRequests = state.serviceRequests.filter((request) => request.status !== "Closed");
    const pendingCallouts = state.calloutSchedule.filter((callout) => callout.status !== "Complete");
    segments.push(
      `Service request read: ${openRequests.length} open request(s), ${pendingCallouts.length} pending callout(s), notifications prepared for ${state.serviceSettings.ownerEmail}. Latest request: ${openRequests[0] ? `${openRequests[0].name} - ${openRequests[0].urgency} - ${openRequests[0].preferredDate} ${openRequests[0].preferredTime}` : "none yet"}.`
    );
  }
  if (/(dry|moisture|humidity|rh|dehumid|reading|equipment day)/i.test(query)) {
    segments.push(`Drying read:\n${copilotDryLogText(query)}`);
  }
  if (/(job|gate|blocker|schedule|gantt|task|next action)/i.test(query)) {
    const blocked = state.jobBoards
      .filter((job) => (job.gates || []).some((gate) => gate.status === "Blocked") || job.blockers)
      .slice(0, 4)
      .map((job) => `${job.jobId}: ${job.stage}, ${jobGateCompletion(job)}% gates, next: ${job.nextAction || "None"}`);
    segments.push(blocked.length ? `Job read:\n${blocked.join("\n")}` : `Job read: ${metrics.jobs} tracked jobs and no blocked gate text found.`);
  }
  if (/(admin|administrator|owner|employee|login|permission|role|2fa|mfa|access)/i.test(query)) {
    segments.push(
      `Access model: Administrator account is separate from employee logins. Admin scope is ${state.accountProfile.adminAccount.scope} Employee portal scope is ${state.accountProfile.employeePortal.scope} Current access is ${state.employeeMode ? "Employee portal" : state.accountProfile.activeRole}.`
    );
  }
  if (/(price|xactimate|estimate|line item|highest|rate|pricing)/i.test(query)) {
    segments.push(`Pricing policy: ${metrics.activePrices} active price rows use highest-rate-wins. Older or lower duplicate Xactimate imports stay in history but cannot lower the active price used in estimates.`);
  }
  if (/(rebuttal|adjuster|code|osha|iicrc|ansi|ibc|compliance|jargon|standard)/i.test(query)) {
    const jargonHits = detectAdjusterJargon(query).map((hit) => `${hit.phrase}: ${hit.responseFrame}`).slice(0, 3);
    segments.push(`Compliance/rebuttal read: ${standardsSources.length} source connectors are configured. Jargon framing:\n${jargonHits.join("\n")}`);
  }
  const hits = workspaceSearch(query);
  const searchText = copilotSearchText(hits);
  if (searchText) segments.push(searchText);
  if (!segments.length) {
    segments.push(
      `I searched the OS context and can keep discussing this. Try asking for "job blockers", "dry logs for J-2039", "calculate 95*3", "admin permissions", "highest Xactimate pricing", "delayed invoices", or "draft a rebuttal plan".`
    );
  }
  return segments.join("\n\n");
}

function rememberCopilotExchange(query, answer) {
  state.aiCopilotMemory = [
    {
      id: createId("AI-MEM"),
      topic: tokenize(query).slice(0, 8).join(" ") || "general",
      query,
      answer,
      savedAt: new Date().toISOString()
    },
    ...state.aiCopilotMemory
  ].slice(0, 80);
}

function askAiCopilot(promptText = "") {
  const query = String(promptText || state.aiCopilotQuery || "").trim();
  if (!query) return;
  const answer = buildBrotherCopilotAnswer(query);
  const targetModule = modules.find((module) => {
    const lower = query.toLowerCase();
    return lower.startsWith("open ") && (lower.includes(module.key.toLowerCase()) || lower.includes(module.label.toLowerCase()));
  });
  if (targetModule && (!state.employeeMode || employeeModuleKeys().includes(targetModule.key))) {
    state.activeKey = targetModule.key;
  }
  rememberCopilotExchange(query, answer);
  state.aiCopilotOpen = true;
  state.aiCopilotMessages = [
    { id: createId("AI-MSG"), role: "user", text: query, time: new Date().toISOString() },
    { id: createId("AI-MSG"), role: "assistant", text: answer, time: new Date().toISOString() },
    ...state.aiCopilotMessages
  ].slice(0, 60);
  state.aiCopilotQuery = "";
  persist();
  render();
}

function saveActionDashboard(formData) {
  const selectedKeys = formData.getAll("moduleKeys").map(String).filter((key) => moduleByKey(key));
  if (!selectedKeys.length) {
    setToast("Select at least one module");
    render();
    return;
  }
  const maxCards = Math.min(16, Math.max(3, parseAmount(formData.get("maxCards")) || defaultActionDashboard.maxCards));
  state.actionDashboard = {
    ...state.actionDashboard,
    title: String(formData.get("title") || defaultActionDashboard.title).trim() || defaultActionDashboard.title,
    selectedKeys: [...new Set(selectedKeys)].slice(0, maxCards),
    maxCards
  };
  addActivity(`Updated custom action dashboard with ${state.actionDashboard.selectedKeys.length} module previews.`);
  persist();
  setToast("Action dashboard saved");
  render();
}

function resetActionDashboard() {
  state.actionDashboard = clone(defaultActionDashboard);
  addActivity("Restored custom action dashboard defaults.");
  persist();
  setToast("Action dashboard restored");
  render();
}

function createWorkbenchRecord(formData) {
  const module = moduleByKey(String(formData.get("moduleKey") || state.activeKey)) || activeModule();
  const config = moduleWorkbenchConfig(module);
  const values = config.fields.map((field) => ({
    label: field.label,
    value: String(formData.get(field.name) || "").trim()
  }));
  const subject = values.find((item) => item.label === config.subjectLabel)?.value || String(formData.get("subject") || "").trim();
  const notes = [
    `${config.title}`,
    module.purpose,
    "",
    ...values.filter((item) => item.value).map((item) => `${item.label}: ${item.value}`),
    "",
    "Linked modules:",
    ...config.links.map((key) => `- ${moduleByKey(key)?.label || key}`),
    "",
    "Workflow checks:",
    ...config.tasks.map((task) => `- ${task}`)
  ].join("\n");
  createFile({
    moduleKey: module.key,
    linkedModuleKeys: config.links,
    sourceType: "moduleWorkbench",
    sourceId: `${module.key}-${Date.now()}`,
    title: subject || `${module.label} record`,
    type: config.fileType,
    owner: String(formData.get("owner") || "Office"),
    status: "Open",
    priority: String(formData.get("priority") || "Medium"),
    due: String(formData.get("due") || ""),
    relatedJob: String(formData.get("relatedJob") || ""),
    notes
  });
}

function pinPosition(deployment, bounds) {
  const lat = Number(deployment.latitude);
  const lng = Number(deployment.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { x: 50, y: 50 };
  const lngSpan = bounds.maxLng - bounds.minLng || 0.01;
  const latSpan = bounds.maxLat - bounds.minLat || 0.01;
  return {
    x: Math.min(94, Math.max(6, ((lng - bounds.minLng) / lngSpan) * 88 + 6)),
    y: Math.min(94, Math.max(6, 94 - ((lat - bounds.minLat) / latSpan) * 88))
  };
}

function equipmentMapBounds(deployments) {
  const points = deployments
    .map((deployment) => ({ lat: Number(deployment.latitude), lng: Number(deployment.longitude) }))
    .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
  if (!points.length) {
    return { minLat: 42.44, maxLat: 42.46, minLng: -73.26, maxLng: -73.23 };
  }
  const lats = points.map((point) => point.lat);
  const lngs = points.map((point) => point.lng);
  return {
    minLat: Math.min(...lats) - 0.002,
    maxLat: Math.max(...lats) + 0.002,
    minLng: Math.min(...lngs) - 0.002,
    maxLng: Math.max(...lngs) + 0.002
  };
}

async function captureEquipmentGps() {
  const form = document.querySelector('form[data-form="equipment-deployment"]');
  if (!form) return;
  const gps = await requestGps();
  if (gps.latitude !== null && gps.longitude !== null) {
    form.elements.latitude.value = gps.latitude.toFixed(5);
    form.elements.longitude.value = gps.longitude.toFixed(5);
  }
  form.elements.gpsLabel.value = gps.label;
  const status = form.querySelector(".gps-capture-status");
  if (status) status.textContent = `Captured ${gps.label}`;
  addActivity(`Captured equipment GPS: ${gps.label}.`);
  persist();
}

async function addEquipmentDeployment(formData) {
  let gps = {
    latitude: Number(formData.get("latitude")),
    longitude: Number(formData.get("longitude")),
    label: String(formData.get("gpsLabel") || "").trim()
  };
  if (!Number.isFinite(gps.latitude) || !Number.isFinite(gps.longitude)) {
    gps = await requestGps();
  }
  const invoiceId = String(formData.get("invoiceId") || "");
  const invoice = state.files.find((file) => file.id === invoiceId);
  const dailyRate = Number(formData.get("dailyRate") || 0);
  const rentalDays = Number(formData.get("rentalDays") || 0);
  const deployment = {
    id: createId("EQ"),
    equipmentName: String(formData.get("equipmentName") || "Equipment").trim(),
    assetTag: String(formData.get("assetTag") || "").trim(),
    job: String(formData.get("job") || "").trim(),
    room: String(formData.get("room") || "").trim(),
    status: String(formData.get("status") || "Deployed"),
    invoiceId,
    invoiceNumber: String(formData.get("invoiceNumber") || invoice?.title || "").trim(),
    dailyRate: Number.isFinite(dailyRate) ? dailyRate : 0,
    rentalDays: Number.isFinite(rentalDays) ? rentalDays : 0,
    billable: formData.get("billable") === "on",
    latitude: Number.isFinite(gps.latitude) ? gps.latitude : null,
    longitude: Number.isFinite(gps.longitude) ? gps.longitude : null,
    gpsLabel: gps.label || "Manual location",
    address: String(formData.get("address") || "").trim(),
    notes: String(formData.get("notes") || "").trim(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  state.equipmentDeployments = [deployment, ...state.equipmentDeployments];
  createFile({
    moduleKey: "equipment",
    linkedModuleKeys: ["jobs", "drylogs", "payments", "photos", "time"],
    sourceType: "equipmentDeployment",
    sourceId: deployment.id,
    amount: equipmentCharge(deployment),
    title: `${deployment.equipmentName} deployment - ${deployment.job || deployment.room || deployment.assetTag || "unassigned"}`,
    type: "Equipment deployment",
    owner: state.worker?.name || "Field operations",
    status: deployment.status,
    priority: deployment.billable ? "High" : "Medium",
    due: today.toISOString().slice(0, 10),
    relatedJob: deployment.job,
    notes: [
      `Asset tag: ${deployment.assetTag || "Not entered"}`,
      `Room/address: ${deployment.room || deployment.address || "Not specified"}`,
      `GPS: ${deployment.gpsLabel || "Not captured"}`,
      `Billable: ${deployment.billable ? "Yes" : "No"}`,
      `Rental support: ${deployment.rentalDays} days x ${formatMoney(deployment.dailyRate)} = ${formatMoney(equipmentCharge(deployment))}`,
      `Invoice: ${deployment.invoiceNumber || "Not attached"}`,
      deployment.notes
    ].filter(Boolean).join("\n")
  });
  if (deployment.billable) {
    ensureWorkflowTask({
      title: `Create equipment invoice for ${deployment.equipmentName}`,
      moduleKey: "payments",
      relatedJob: deployment.job,
      due: today.toISOString().slice(0, 10),
      priority: "High",
      sourceType: "equipmentDeployment",
      sourceId: deployment.id
    });
  }
  addActivity(`${deployment.equipmentName} added to equipment GPS map and tied to ${deployment.invoiceNumber || "invoice draft"}.`);
  persist();
  setToast("Equipment location added");
  render();
}

function createEquipmentInvoice(deploymentId) {
  const deployment = state.equipmentDeployments.find((item) => item.id === deploymentId);
  if (!deployment) return;
  const amount = equipmentCharge(deployment);
  const title = `${deployment.invoiceNumber || "INV-EQUIPMENT"} ${deployment.equipmentName}`;
  const file = createFile({
    moduleKey: "payments",
    linkedModuleKeys: ["equipment", "jobs", "accounting", "drylogs", "revenueengine"],
    sourceType: "equipmentInvoice",
    sourceId: deployment.id,
    amount,
    title,
    type: "Invoice",
    owner: "Bookkeeping",
    status: "Drafting",
    priority: deployment.billable ? "High" : "Medium",
    due: today.toISOString().slice(0, 10),
    relatedJob: deployment.job,
    notes: [
      `Equipment: ${deployment.equipmentName} (${deployment.assetTag || "no asset tag"})`,
      `Location: ${deployment.room || deployment.address || "Not specified"}`,
      `GPS: ${deployment.gpsLabel || "Not captured"}`,
      `Rental support: ${deployment.rentalDays} days x ${formatMoney(deployment.dailyRate)} = ${formatMoney(amount)}`,
      `Map link: ${deployment.latitude && deployment.longitude ? `https://www.google.com/maps/search/?api=1&query=${deployment.latitude},${deployment.longitude}` : "No GPS link"}`,
      deployment.notes
    ].filter(Boolean).join("\n")
  });
  if (file) {
    deployment.invoiceId = file.id;
    deployment.invoiceNumber = file.title;
    deployment.updatedAt = new Date().toISOString();
    persist();
    setToast("Invoice file created and attached");
    render();
  }
}

async function clockIn(formData) {
  const gps = await requestGps();
  const selectedTaskValue = String(formData.get("task") || "").trim();
  const selectedTask = state.tasks.find((task) => task.id === selectedTaskValue) || state.tasks.find((task) => task.title === selectedTaskValue);
  const worker = currentWorkerProfile();
  const job = String(formData.get("job") || selectedTask?.relatedJob || "Unassigned").trim();
  state.clockSession = {
    id: createId("T"),
    workerId: worker.id || "",
    workerEmail: worker.email || "",
    worker: worker.name || formData.get("worker") || "Employee",
    job,
    taskId: selectedTask?.id || "",
    task: selectedTask?.title || selectedTaskValue || "Field work",
    billable: formData.get("billable") === "on",
    start: new Date().toISOString(),
    startGps: gps
  };
  addActivity(`${state.clockSession.worker} clocked in with GPS.`);
  persist();
  setToast("Clocked in");
  render();
}

async function clockOut() {
  if (!state.clockSession) return;
  const gps = await requestGps();
  const entry = {
    ...state.clockSession,
    end: new Date().toISOString(),
    endGps: gps,
    hours: durationLabel(state.clockSession.start, new Date().toISOString())
  };
  state.timeEntries = [entry, ...state.timeEntries];
  state.clockSession = null;
  createFile({
    moduleKey: "time",
    linkedModuleKeys: ["jobs", "payments", "reports", "closeout", "photos"],
    sourceType: "timeEntry",
    sourceId: entry.id,
    title: `${entry.worker} labor time - ${entry.job}`,
    type: "Labor time",
    owner: entry.worker,
    status: entry.billable ? "Billable" : "Complete",
    priority: entry.billable ? "High" : "Medium",
    due: today.toISOString().slice(0, 10),
    relatedJob: entry.job,
    notes: [
      `Task: ${entry.task}`,
      `Hours: ${entry.hours}`,
      `Start GPS: ${entry.startGps?.label || "Not captured"}`,
      `End GPS: ${entry.endGps?.label || "Not captured"}`,
      `Billable: ${entry.billable ? "Yes" : "No"}`
    ].join("\n")
  });
  addActivity(`${entry.worker} clocked out with GPS.`);
  persist();
  setToast("Clocked out");
  render();
}

function render() {
  if (!state.authSession) {
    app.className = "app-root auth-shell";
    app.innerHTML = renderAuthGate();
    return;
  }

  const module = activeModule();
  app.className = `app-root${state.mobileOpen ? " nav-open" : ""}${state.modal ? " modal-open" : ""}`;
  app.innerHTML = `
    ${renderMobileBar()}
    <div class="app-shell">
      ${renderSidebar()}
      <main class="workspace">
        ${renderTrialBanner()}
        ${renderTopbar(module)}
        ${renderScreen(module)}
      </main>
    </div>
    ${renderMobileDrawer()}
    ${renderModal()}
    ${renderAICopilotBar()}
    ${renderSettingsDock()}
    ${state.toast ? `<div class="toast" role="status">${escapeHtml(state.toast)}</div>` : ""}
  `;
}

function renderAuthGate() {
  if (!state.firebase.ready) {
    return `<div class="app-loading"><div class="loading-card"><div class="loading-logo-wrap">${renderBrandLogo("loading-logo", "Brothers logo")}</div><div><strong>Loading authentication</strong><span>Connecting Brothers OS to Firebase Auth.</span></div></div></div>`;
  }

  if (!state.firebase.enabled) {
    const missingAdmin = (state.firebase.missingAdminEnv || []).join(", ") || "none";
    const missingWeb = (state.firebase.missingWebEnv || []).join(", ") || "none";
    const projectId = state.firebase.projectId || state.firebase.knownProjectId || "not detected";
    return `
      <div class="app-loading">
        <div class="loading-card auth-setup-card">
          <div class="loading-logo-wrap">${renderBrandLogo("loading-logo", "Brothers logo")}</div>
          <div>
            <strong>Authentication setup required</strong>
            <span>Brothers OS is locked until Firebase Google login is configured in Vercel.</span>
            <dl>
              <div><dt>Launch domain</dt><dd>https://brothers.ad</dd></div>
              <div><dt>Connected Firebase project</dt><dd>${escapeHtml(projectId)}</dd></div>
              <div><dt>Server credentials</dt><dd>${escapeHtml(missingAdmin)}</dd></div>
              <div><dt>Web app config</dt><dd>${escapeHtml(missingWeb)}</dd></div>
              <div><dt>Next action</dt><dd>Add Firebase Admin credentials in Vercel, authorize brothers.ad in Firebase Authentication, then redeploy production.</dd></div>
            </dl>
          </div>
        </div>
      </div>
    `;
  }

  const accessTokenPresent = Boolean(getAccessTokenFromRoute());
  const ttlLabel = state.firebase.sessionTtlHours ? `${state.firebase.sessionTtlHours} hours` : "48 hours";
  const passwordAllowed = (state.firebase.allowedSignInProviders || []).includes("password");
  const ownerEmails = (state.firebase.allowedLoginEmails || []).filter(Boolean);
  const ownerLabel = ownerEmails.length ? ownerEmails.join(", ") : "the Super Admin email";
  const adminCredentialWarning = state.firebase.restAuthFallback
    ? {
        title: "Firebase Admin credentials still needed for contractor codes",
        body: "Owner Google login can use secure Firebase REST token verification. Add FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY in Vercel to activate contractor code validation, invite management, Firestore-backed portals, and full admin datastore features."
      }
    : {
        title: "Contractor code validation needs Firebase Admin credentials",
        body: "Owner login and contractor code validation become live after FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY are added in Vercel."
      };
  return `
    <section class="auth-gate">
      <div class="auth-card">
        <div class="auth-logo-wrap">${renderBrandLogo("auth-logo", "Brothers logo")}</div>
        <span>Secure company access</span>
        <h1>Sign in to Brothers OS</h1>
        <p>Google verifies identity; Brothers OS authorizes access separately. Owner access is restricted to ${escapeHtml(ownerLabel)}. Every other Google account needs an active ${escapeHtml(ttlLabel)} invite link and an individual access code, or the session is denied.</p>
        <div class="empty-state warning-state"><strong>Unapproved accounts are denied</strong><span>The Google button may open for any Google account, but the OS session is created only after the server approves the email, invite link, and contractor code.</span></div>
        ${isAdminCredentialGap() ? `<div class="empty-state warning-state"><strong>${escapeHtml(adminCredentialWarning.title)}</strong><span>${escapeHtml(adminCredentialWarning.body)}</span></div>` : ""}
        ${accessTokenPresent ? `<div class="empty-state"><strong>Access link detected</strong><span>Sign in with the same Google email that requested access, then enter the contractor code if one was issued.</span></div>` : ""}
        <label><span>Contractor / trial access code</span><input data-field="login-access-code" name="accessCode" autocomplete="one-time-code" placeholder="CON-123ABC" /></label>
        <button type="button" data-action="firebase-google-login">${state.authLoading ? "Connecting..." : "Sign in with Google"}</button>
        ${passwordAllowed ? `
          <div class="auth-divider"><span>super admin fallback</span></div>
          <form class="stack-form" data-form="firebase-login">
            <label><span>Email</span><input name="email" type="email" autocomplete="username" placeholder="name@company.com" /></label>
            <label><span>Password</span><input name="password" type="password" autocomplete="current-password" placeholder="Enter your password" /></label>
            <label><span>Access code</span><input name="accessCode" autocomplete="one-time-code" placeholder="Optional code" /></label>
            <button type="submit">${state.authLoading ? "Signing in..." : "Sign in"}</button>
          </form>
        ` : ""}
        <form class="stack-form access-request-form" data-form="access-request">
          <h2>Request 48-hour trial access</h2>
          <label><span>Name</span><input name="displayName" required placeholder="Your name" /></label>
          <label><span>Google email</span><input name="email" type="email" required placeholder="name@company.com" /></label>
          <label><span>Company</span><input name="companyName" placeholder="Contractor company" /></label>
          <label><span>Access type</span><select name="roleId"><option value="contractor">Contractor portal</option><option value="worker">Worker portal</option><option value="franchise_owner">Franchise owner</option></select></label>
          <button type="submit">${state.authLoading ? "Sending..." : "Request access"}</button>
        </form>
        ${state.accessRequestStatus ? `<div class="empty-state"><strong>Request received</strong><span>${escapeHtml(state.accessRequestStatus)}</span></div>` : ""}
        ${state.authError ? `<div class="empty-state"><strong>Sign-in failed</strong><span>${escapeHtml(state.authError)}</span></div>` : ""}
      </div>
    </section>
  `;
}

function renderMobileBar() {
  return `
    <div class="mobile-bar">
      <button type="button" class="icon-button" data-action="mobile-open" aria-label="Open modules" aria-expanded="${state.mobileOpen ? "true" : "false"}">Menu</button>
      <a class="mobile-brand" href="#module/daily" data-action="set-active" data-key="daily">
        ${renderBrandLogo("mobile-brand-logo")}
        <span>
          <strong>Brothers OS</strong>
          <small>${state.employeeMode ? "Field workspace" : "Operations workspace"}</small>
        </span>
      </a>
      <button type="button" class="icon-button accent" data-action="open-create-file" aria-label="New file">New</button>
    </div>
  `;
}

function renderSidebar() {
  const visibleModules = filteredModules();
  const categories = [...new Set(modules.map((module) => module.category))].sort();
  return `
    <aside class="sidebar">
      <div class="sidebar-scroll">
        <a class="brand" href="#module/daily" data-action="set-active" data-key="daily">
          ${renderBrandLogo()}
          <span class="brand-copy">
            <small>Brothers restoration platform</small>
            <strong>Brothers OS</strong>
            <span>${state.employeeMode ? "Employee time access" : "Operations command center"}</span>
          </span>
        </a>
        <section class="sidebar-intro">
          <span>Live operating view</span>
          <strong>${state.employeeMode ? "Field worker portal" : "Executive command center"}</strong>
          <p>${state.employeeMode ? "Focused tools for time, jobs, dry logs, photos, and equipment." : "Track jobs, billing, field execution, and service requests from one branded workspace."}</p>
        </section>
        <div class="sidebar-controls">
          <label>
            <span>Search modules</span>
            <input data-field="search" type="search" value="${escapeHtml(state.search)}" placeholder="Find a module" ${state.employeeMode ? "disabled" : ""} />
          </label>
          <label>
            <span>Category</span>
            <select data-field="category" ${state.employeeMode ? "disabled" : ""}>
              <option value="all"${state.category === "all" ? " selected" : ""}>All categories</option>
              ${categories
                .map(
                  (category) =>
                    `<option value="${escapeHtml(category)}"${state.category === category ? " selected" : ""}>${escapeHtml(categoryLabels[category] || category)}</option>`
                )
                .join("")}
            </select>
          </label>
        </div>
        <div class="quick-grid">
          ${(state.employeeMode ? employeeModuleKeys() : pinnedKeys())
            .map((key) => moduleByKey(key))
            .filter(Boolean)
            .map(
              (module) => `
                <button type="button" class="quick-button${state.activeKey === module.key ? " active" : ""}" data-action="set-active" data-key="${module.key}">
                  <span>${escapeHtml(tabConfigByKey(module.key)?.label || module.label)}</span>
                  <small>${filesForModule(module.key).length} files</small>
                </button>
              `
            )
            .join("")}
        </div>
        <div class="sidebar-nav-shell">
          <div class="sidebar-nav-header">
            <span class="sidebar-section-label">All modules</span>
            <strong>${visibleModules.length}</strong>
          </div>
          <nav class="nav-list" aria-label="Modules">
          ${visibleModules
            .map(
              (module) => `
                <a class="nav-button${state.activeKey === module.key ? " active" : ""}" href="#module/${module.key}" data-action="set-active" data-key="${module.key}">
                  <span>${escapeHtml(tabConfigByKey(module.key)?.label || module.label)}</span>
                  <small>${escapeHtml(categoryLabels[module.category] || module.category)}</small>
                </a>
              `
            )
            .join("")}
          </nav>
        </div>
        <div class="sidebar-footer">
          <div class="sidebar-status">
            <span>Workspace mode</span>
            <strong>${state.employeeMode ? "Worker access" : "Owner command"}</strong>
          </div>
          <div class="sidebar-status">
            <span>Visible modules</span>
            <strong>${visibleModules.length}</strong>
          </div>
        </div>
      </div>
    </aside>
  `;
}

function renderTrialBanner() {
  if (state.employeeMode) {
    return `
      <section class="trial-banner">
        <div>
          <strong>Employee field portal</strong>
          <span>Restricted access: time, dry logs, jobs, photos, equipment, and communication board</span>
        </div>
        <div class="trial-actions">
          ${employeeModuleKeys()
            .map((key) => moduleByKey(key))
            .filter(Boolean)
            .map((module) => `<button type="button" data-action="set-active" data-key="${module.key}">${escapeHtml(module.label)}</button>`)
            .join("")}
          <button type="button" data-action="employee-logout">Owner/admin login</button>
        </div>
      </section>
    `;
  }
  const profile = industryProfiles[state.industryProfile] || industryProfiles.restoration;
  const trialActions = [
    `<button type="button" data-action="open-service-request">Request service</button>`,
    renderModuleButton("contractorportal", "Contractor Portal"),
    renderModuleButton("team", "Team"),
    renderModuleButton("accessadmin", "Admin Access"),
    renderModuleButton("communications", "Board"),
    renderModuleButton("daily", "Module map"),
    renderModuleButton("sketch", "Sketch"),
    renderModuleButton("pricing", "Import invoice"),
    renderModuleButton("settings", "Settings")
  ].filter(Boolean).join("");
  return `
    <section class="trial-banner">
      <div>
        <strong>Operations workspace</strong>
        <span>${escapeHtml(profile.label)} command profile active</span>
      </div>
      <label>
        <span>Industry</span>
        <select data-field="industry-profile">
          ${Object.entries(industryProfiles)
            .map(([key, profileItem]) => `<option value="${key}"${state.industryProfile === key ? " selected" : ""}>${escapeHtml(profileItem.label)}</option>`)
            .join("")}
        </select>
      </label>
      <div class="trial-actions">
        ${trialActions}
      </div>
    </section>
  `;
}

function renderTopbar(module) {
  const primaryActions = state.employeeMode
    ? `
        <button type="button" data-action="open-service-request">Request service</button>
        ${renderModuleTextLink("time", "Time")}
        ${renderModuleTextLink("jobs", "Jobs")}
      `
    : `
        <button type="button" data-action="open-service-request">Request service</button>
        <button type="button" data-action="open-create-file">New file</button>
        ${renderModuleTextLink("insurance", "Insurance intake")}
      `;

  const secondaryActions = state.employeeMode
    ? `
        ${renderModuleTextLink("drylogs", "Dry logs")}
        ${renderModuleTextLink("equipment", "Equipment")}
        <button type="button" data-action="employee-logout">Owner/admin login</button>
      `
    : `
        ${renderModuleTextLink("daily", "Module map", "text-link module-map-link")}
        ${renderModuleTextLink("jobs", "Open jobs")}
        ${renderModuleTextLink("contractorportal", "Contractor Portal")}
        ${renderModuleTextLink("pricing", "Import invoice")}
        ${renderModuleTextLink("accessadmin", "Admin Access")}
        ${!state.authSession || canDo("viewGlobalIndexes") ? renderModuleTextLink("launchcenter", "Launch Center") : ""}
        ${!state.authSession || canDo("viewGlobalIndexes") ? renderModuleTextLink("globalindexes", "Global Indexes") : ""}
        ${renderModuleTextLink("communications", "Board")}
        <button type="button" data-action="open-activity">Alerts</button>
        ${!state.authSession || canDo("viewGlobalIndexes") ? `<button type="button" data-action="open-export">Export</button>` : ""}
        <button type="button" data-action="open-employee-login">Employee time</button>
      `;
  return `
    <header class="topbar">
      <div class="topbar-lead">
        <div class="topbar-brand-chip">
          ${renderBrandLogo("topbar-logo", "Brothers mark")}
          <div>
            <strong>Brothers</strong>
            <span>${state.employeeMode ? "Field access" : "Ops control"}</span>
          </div>
        </div>
        <div class="screen-title">
          <span>${escapeHtml(categoryLabels[module.category] || module.category)}</span>
          <h1>${escapeHtml(tabConfigByKey(module.key)?.label || module.label)}</h1>
        </div>
        ${renderTopbarMeta(module)}
      </div>
      <div class="topbar-actions">
        <div class="topbar-actions-primary">
          ${primaryActions}
        </div>
        <div class="topbar-actions-secondary">
          ${secondaryActions}
          ${state.authSession && canDo("manageSections") ? `<button type="button" data-action="toggle-admin-edit">${state.adminEditMode ? "Exit edit mode" : "Admin edit mode"}</button>` : ""}
          ${state.authSession ? `<button type="button" data-action="firebase-logout">Sign out ${escapeHtml(state.authSession.email || "")}</button>` : ""}
        </div>
      </div>
    </header>
  `;
}

function renderScreen(module) {
  if (module.key === "time") return renderTimeModule(module);
  if (module.key === "equipment") return renderEquipmentModule(module);
  if (module.key === "drylogs") return renderDryLogsModule(module);
  if (module.key === "photos") return renderPhotosModule(module);
  if (module.key === "jobs") return renderJobTrackerModule(module);
  if (module.key === "insurance") return renderInsuranceModule(module);
  if (module.key === "relationships") return renderRelationshipModule(module);
  if (module.key === "branches") return renderBranchesModule(module);
  if (module.key === "pricing") return renderPriceBookModule(module);
  if (module.key === "payments") return renderPaymentsModule(module);
  if (module.key === "contractorportal") return renderContractorPortalModule(module);
  if (module.key === "accessadmin") return renderAccessAdminModule(module);
  if (module.key === "launchcenter") return renderLaunchCenterModule(module);
  if (module.key === "globalindexes") return renderGlobalIndexesModule(module);
  if (module.key === "team") return renderTeamModule(module);
  if (module.key === "communications") return renderCommunicationsModule(module);
  if (module.key === "sketch") return renderSketchModule(module);
  if (module.key === "defensibility") return renderDefensibilityModule(module);
  if (module.key === "supplement") return renderSupplementModule(module);
  if (module.key === "accounting") return renderAccountingModule(module);
  return `
    <section class="hero-band">
      <div>
        <span class="hero-eyebrow">Branded operating system</span>
        <h2>${escapeHtml(module.label)} workflow</h2>
        <p>${escapeHtml(module.purpose)}</p>
        <div class="hero-actions">
          <button type="button" data-action="open-create-file" data-key="${module.key}">Create ${escapeHtml(suggestedFileType(module))}</button>
          <button type="button" data-action="quick-note" data-key="${module.key}">Add quick note</button>
          <a href="#module/reports" data-action="set-active" data-key="reports">View reports</a>
        </div>
      </div>
      <div class="metric-strip">
        <div><strong>${filesForModule(module.key).length}</strong><span>Files</span></div>
        <div><strong>${queueForModule(module.key).length}</strong><span>Queue</span></div>
        <div><strong>${state.files.filter((file) => file.status !== "Complete").length}</strong><span>Open</span></div>
      </div>
    </section>
    ${module.key === "daily" ? renderDashboardSummary() : ""}
    ${usesStandardsAI(module) ? renderStandardsAI(module) : ""}
    ${module.key === "daily" ? "" : renderModuleWorkbench(module)}
    ${renderQueue(module.key)}
    ${renderModuleFiles(module)}
    ${renderFileDetail(module)}
  `;
}

function renderDashboardSummary() {
  const activeJobs = state.files.filter((file) => file.moduleKey === "jobs" && file.status !== "Complete").length;
  const revenueFiles = filesForModule("revenueengine").length;
  const openQueue = state.queue.length;
  const hours = state.timeEntries.reduce((sum, entry) => sum + Number(entry.hours || 0), 0).toFixed(2);
  return `
    ${renderManagedSection("daily-module-directory", renderTaskTypeModuleDirectory())}
    ${renderManagedSection("daily-dashboard-grid", `
    <section class="dashboard-grid">
      ${renderStatCard("Active jobs", activeJobs, "Jobs still moving through the operating loop.", "jobs")}
      ${renderStatCard("Revenue packets", revenueFiles, "Supplements, justifications, and recovery work.", "revenueengine")}
      ${renderStatCard("Dry log readings", state.dryLogs.length, "Moisture/RH/temperature records tied to jobs.", "drylogs")}
      ${renderStatCard("Work queue", openQueue, "Owner and office items waiting on action.", "daily")}
      ${renderStatCard("Logged hours", hours, "Employee GPS time entries saved locally.", "time")}
    </section>
    `)}
    ${renderManagedSection("daily-service-requests", renderServiceRequestPanel())}
    ${renderManagedSection("daily-action-dashboard", renderActionDashboard())}
    ${renderManagedSection("daily-investor-panel", renderInstitutionalInvestorPanel())}
    ${renderManagedSection("daily-skills-vaults", renderSkillsAndDatabasePanel())}
    ${renderManagedSection("daily-import-launcher", renderInvoiceImportLauncher())}
    ${renderManagedSection("daily-industry-plan", `<section class="workflow-band">
      <div>
        <h2>Operating loop</h2>
        <p>Intake, property, job, photos, scope, approvals, dispatch, invoice, evidence, payment, and closeout stay connected through module files.</p>
      </div>
      <div class="workflow-links">
        ${["universalintake", "properties", "jobs", "photos", "revenueengine", "payments", "closeout"]
          .map((key) => moduleByKey(key))
          .filter(Boolean)
          .map((module) => `<a href="#module/${module.key}" data-action="set-active" data-key="${module.key}">${escapeHtml(module.label)}</a>`)
          .join("")}
      </div>
    </section>`)}
    ${renderManagedSection("daily-industry-plan", renderIndustryPlan())}
    ${renderManagedSection("daily-performance", renderPerformanceTracker())}
  `;
}

function renderServiceRequestPanel() {
  const openRequests = state.serviceRequests.filter((request) => request.status !== "Closed");
  const pendingCallouts = state.calloutSchedule.filter((callout) => callout.status !== "Complete");
  return `
    <section class="service-request-panel">
      <div class="service-request-head">
        <div>
          <span>Request service</span>
          <h2>Service requests and callout schedule</h2>
          <p>Creates an intake record, prepares the owner email notification, adds a dispatch task, and places the callout onto the schedule.</p>
        </div>
        <div class="service-actions">
          <button type="button" data-action="open-service-request">Request service</button>
          <a href="mailto:${escapeHtml(state.serviceSettings.ownerEmail)}">Email owner</a>
        </div>
      </div>
      <div class="service-metrics">
        <div><strong>${state.serviceRequests.length}</strong><span>Total requests</span></div>
        <div><strong>${openRequests.length}</strong><span>Open</span></div>
        <div><strong>${pendingCallouts.length}</strong><span>Callouts</span></div>
        <div><strong>${escapeHtml(state.serviceSettings.ownerEmail)}</strong><span>Notify email</span></div>
      </div>
      <div class="service-layout">
        <div>
          <h3>Latest requests</h3>
          <div class="service-card-list">
            ${
              state.serviceRequests.length
                ? state.serviceRequests.slice(0, 4).map(renderServiceRequestCard).join("")
                : `<div class="empty-state"><strong>No service requests yet</strong><span>Use Request service to create the first intake and callout.</span></div>`
            }
          </div>
        </div>
        <div>
          <h3>Callout schedule</h3>
          <div class="service-card-list">
            ${
              pendingCallouts.length
                ? pendingCallouts.slice(0, 5).map(renderCalloutCard).join("")
                : `<div class="empty-state"><strong>No callouts pending</strong><span>New requests will appear here with preferred date and time.</span></div>`
            }
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderServiceRequestCard(request) {
  return `
    <article class="service-card">
      <div class="file-card-head"><span>${escapeHtml(request.urgency)}</span><strong>${escapeHtml(request.status)}</strong></div>
      <h4>${escapeHtml(request.name)}</h4>
      <p>${escapeHtml(request.serviceType)} - ${escapeHtml(request.address || "Address pending")}</p>
      <small>${escapeHtml(formatDate(request.preferredDate))} ${escapeHtml(request.preferredTime || "")} - ${escapeHtml(request.phone || request.email || "No contact")}</small>
      <div class="card-actions">
        <a href="${escapeHtml(serviceEmailHref(request))}">Email owner</a>
        <button type="button" data-action="complete-service-request" data-id="${request.id}">Close</button>
      </div>
    </article>
  `;
}

function renderCalloutCard(callout) {
  const request = state.serviceRequests.find((item) => item.id === callout.requestId);
  return `
    <article class="service-card">
      <div class="file-card-head"><span>${escapeHtml(callout.status)}</span><strong>${escapeHtml(callout.time || "Time TBD")}</strong></div>
      <h4>${escapeHtml(callout.title)}</h4>
      <p>${escapeHtml(callout.address || "Address pending")}</p>
      <small>${escapeHtml(formatDate(callout.date))} - ${escapeHtml(callout.contact || "No contact")} ${request ? `- ${escapeHtml(request.urgency)}` : ""}</small>
      <div class="card-actions">
        <button type="button" data-action="mark-callout-scheduled" data-id="${callout.id}">Mark scheduled</button>
        ${request ? `<a href="${escapeHtml(serviceEmailHref(request))}">Email</a>` : ""}
      </div>
    </article>
  `;
}

function renderInstitutionalInvestorPanel() {
  const review = calculateInstitutionalReadiness();
  const saved = state.institutionalReview?.lastRun ? state.institutionalReview : null;
  return `
    <section class="investor-panel">
      <div class="investor-hero">
        <div>
          <span>Institutional diligence mode</span>
          <h2>${escapeHtml(review.verdict)}</h2>
          <p>Investor-grade readout across marketable workflow depth, data assets, AI skills, functional proof, monetization, trust, and performance readiness.</p>
          <div class="hero-actions">
            <button type="button" data-action="run-institutional-review">Run full diligence</button>
            <button type="button" data-action="create-investor-report">Create investor report</button>
            <button type="button" data-action="ai-copilot-prompt" data-prompt="Give me the institutional investor view of this platform">Ask Brother</button>
          </div>
        </div>
        <div class="investor-score">
          <strong>${review.score}</strong>
          <span>/100 readiness</span>
          <small>${saved ? `Last saved ${formatTime(saved.lastRun)}` : "Live score, not saved yet"}</small>
        </div>
      </div>
      <div class="investor-score-grid">
        ${review.categories
          .map(
            (item) => `
              <article>
                <div><strong>${escapeHtml(item.score)}</strong><span>${escapeHtml(item.label)}</span></div>
                <meter min="0" max="100" value="${escapeHtml(item.score)}"></meter>
                <p>${escapeHtml(item.detail)}</p>
              </article>
            `
          )
          .join("")}
      </div>
      <div class="investor-readout">
        <div>
          <h3>Investment strengths</h3>
          ${review.strengths.map((item) => `<p>${escapeHtml(item)}</p>`).join("")}
        </div>
        <div>
          <h3>Diligence risks</h3>
          ${review.risks.map((item) => `<p>${escapeHtml(item)}</p>`).join("")}
        </div>
      </div>
    </section>
  `;
}

function renderSkillsAndDatabasePanel() {
  if (state.authSession && !canDo("viewGlobalIndexes")) {
    return `
      <section class="data-skill-panel restricted-panel">
        <div class="panel-head">
          <div>
            <h2>Global indexes restricted</h2>
            <p>Your current role can use assigned workflows, but platform-wide skill packs, source vaults, and global data indexes are Super Admin controlled.</p>
          </div>
        </div>
      </section>
    `;
  }
  const activeSkills = state.skillPacks.filter((skill) => skill.status === "Active").length;
  const liveVaults = state.dataVaults.filter((vault) => /live|ready|connector/i.test(vault.status)).length;
  return `
    <section class="data-skill-panel">
      <div class="panel-head">
        <div>
          <h2>Skills and database engine</h2>
          <p>AI skill packs and operating databases that make the platform feel like a machine instead of a file cabinet.</p>
        </div>
        <div class="source-status">
          <span>${activeSkills} active skills</span>
          <span>${liveVaults} data vaults online</span>
        </div>
      </div>
      <div class="skill-data-layout">
        <div>
          <h3>Skill packs</h3>
          <div class="skill-pack-grid">
            ${state.skillPacks.map(renderSkillPackCard).join("")}
          </div>
        </div>
        <div>
          <h3>Databases and source vaults</h3>
          <div class="data-vault-grid">
            ${state.dataVaults.map(renderDataVaultCard).join("")}
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderSkillPackCard(skill) {
  return `
    <article class="skill-pack-card">
      <div class="file-card-head"><span>${escapeHtml(skill.category)}</span><strong>${escapeHtml(skill.status)}</strong></div>
      <h4>${escapeHtml(skill.name)}</h4>
      <p>${escapeHtml(skill.capability)}</p>
      <small>${escapeHtml((skill.databases || []).join(", "))}</small>
      <button type="button" data-action="toggle-skill-pack" data-id="${skill.id}">${skill.status === "Active" ? "Stage" : "Activate"}</button>
    </article>
  `;
}

function renderDataVaultCard(vault) {
  return `
    <article class="data-vault-card">
      <div class="file-card-head"><span>${escapeHtml(vault.type)}</span><strong>${escapeHtml(vault.status)}</strong></div>
      <h4>${escapeHtml(vault.name)}</h4>
      <p>${escapeHtml(vault.coverage)}</p>
      <dl>
        <div><dt>Owner</dt><dd>${escapeHtml(vault.owner)}</dd></div>
        <div><dt>Records</dt><dd>${escapeHtml(recordCountForVault(vault))}</dd></div>
      </dl>
      <button type="button" data-action="toggle-data-vault" data-id="${vault.id}">${/live/i.test(vault.status) ? "Move to ready" : "Set live"}</button>
    </article>
  `;
}

function renderActionDashboard() {
  const keys = actionDashboardKeys();
  const selected = new Set(keys);
  const pickerModules = actionDashboardPickerModules();
  return `
    <section class="action-dashboard">
      <div class="action-dashboard-head">
        <div>
          <span>Custom command center</span>
          <h2>${escapeHtml(state.actionDashboard.title || defaultActionDashboard.title)}</h2>
          <p>Select the modules that matter most and keep their live previews on one dashboard.</p>
        </div>
        <div class="action-dashboard-controls">
          <button type="button" data-action="reset-action-dashboard">Restore defaults</button>
          <button type="button" data-action="ai-copilot-prompt" data-prompt="Summarize my custom action dashboard">Ask Brother</button>
        </div>
      </div>
      <form class="action-dashboard-builder" data-form="action-dashboard">
        <div class="form-grid compact-grid">
          <label><span>Dashboard name</span><input name="title" value="${escapeHtml(state.actionDashboard.title || defaultActionDashboard.title)}" /></label>
          <label><span>Max preview cards</span><input name="maxCards" type="number" min="3" max="16" value="${escapeHtml(state.actionDashboard.maxCards || defaultActionDashboard.maxCards)}" /></label>
        </div>
        <div class="action-picker-grid">
          ${pickerModules
            .map(
              (module) => `
                <label class="action-picker">
                  <input name="moduleKeys" type="checkbox" value="${module.key}" ${selected.has(module.key) ? "checked" : ""} />
                  <span><strong>${escapeHtml(module.label)}</strong><small>${escapeHtml(categoryLabels[module.category] || module.category)}</small></span>
                </label>
              `
            )
            .join("")}
        </div>
        <button type="submit">Save action dashboard</button>
      </form>
      <div class="action-card-grid">
        ${keys.map((key) => moduleByKey(key)).filter(Boolean).map(renderActionDashboardCard).join("")}
      </div>
    </section>
  `;
}

function renderActionDashboardCard(module) {
  const preview = actionPreviewForModule(module);
  return `
    <article class="action-card">
      <div class="file-card-head">
        <span>${escapeHtml(categoryLabels[module.category] || module.category)}</span>
        <a href="#module/${module.key}" data-action="set-active" data-key="${module.key}">Open</a>
      </div>
      <h3>${escapeHtml(module.label)}</h3>
      <div class="action-metrics">
        ${preview.metrics.map((metric) => `<div><strong>${escapeHtml(metric.value)}</strong><span>${escapeHtml(metric.label)}</span></div>`).join("")}
      </div>
      <div class="action-live-preview">
        <strong>${escapeHtml(preview.primary)}</strong>
        <span>${escapeHtml(preview.secondary)}</span>
      </div>
      <div class="workflow-links">
        ${preview.links.map((key) => moduleByKey(key)).filter(Boolean).map((linked) => `<a href="#module/${linked.key}" data-action="set-active" data-key="${linked.key}">${escapeHtml(linked.label)}</a>`).join("")}
      </div>
    </article>
  `;
}

function renderInvoiceImportLauncher() {
  return `
    <section class="import-launcher">
      <div>
        <span>Xactimate / invoice pricing import</span>
        <h2>Upload ESX, PDF, CSV, XML, or text estimate files</h2>
        <p>Imported line items flow into Price Book under Xactimate pricing while your custom charges stay separate.</p>
      </div>
      <div class="import-launcher-actions">
        <label class="big-upload-button">
          <input type="file" accept=".esx,.xml,.pdf,.txt,.csv" data-field="xactimate-import" multiple />
          <span>Upload Xactimate ESX / PDF invoices</span>
        </label>
        <a href="#module/pricing" data-action="set-active" data-key="pricing">Open Price Book</a>
      </div>
    </section>
  `;
}

function renderIndustryPlan() {
  const profile = industryProfiles[state.industryProfile] || industryProfiles.restoration;
  return `
    <section class="panel">
      <div class="panel-head">
        <div><h2>${escapeHtml(profile.label)} module plan</h2><p>Suggested operating layout for this account type.</p></div>
        <button type="button" data-action="set-active" data-key="settings">Account setup</button>
      </div>
      <div class="module-plan-grid">
        ${pinnedKeys()
          .map((key, index) => moduleByKey(key))
          .filter(Boolean)
          .map((module, index) => `<a href="#module/${module.key}" data-action="set-active" data-key="${module.key}"><strong>${index + 1}</strong><span>${escapeHtml(module.label)}</span><small>${escapeHtml(module.purpose)}</small></a>`)
          .join("")}
      </div>
    </section>
  `;
}

function renderPerformanceTracker() {
  const metrics = state.performanceMetrics;
  return `
    <section class="performance-panel">
      <div class="panel-head">
        <div><h2>Owner performance tracker</h2><p>Live inputs for receivables, delayed invoices, expenses, unbilled work, and profit.</p></div>
        <a class="text-link" href="#module/accounting" data-action="set-active" data-key="accounting">Open accounting</a>
      </div>
      <div class="performance-grid">
        <div><strong>${escapeHtml(formatMoney(metrics.cashIn))}</strong><span>Cash in</span></div>
        <div><strong>${escapeHtml(formatMoney(metrics.openReceivables))}</strong><span>Open receivables</span></div>
        <div><strong>${metrics.invoicesDelayed}</strong><span>Delayed invoices</span></div>
        <div><strong>${metrics.unbilledItems}</strong><span>Unbilled items</span></div>
        <div><strong>${escapeHtml(formatMoney(metrics.quickBooksExpenses))}</strong><span>Tracked expenses</span></div>
        <div><strong>${metrics.jobProfit}%</strong><span>Job profit</span></div>
      </div>
      <form class="performance-form" data-form="performance-metric">
        <label><span>Metric</span><select name="metric"><option value="cashIn">Cash in</option><option value="openReceivables">Open receivables</option><option value="invoicesDelayed">Delayed invoices</option><option value="unbilledItems">Unbilled items</option><option value="quickBooksExpenses">QuickBooks expenses</option><option value="jobProfit">Job profit %</option></select></label>
        <label><span>Value</span><input name="value" type="number" step="0.01" /></label>
        <button type="submit">Update metric</button>
      </form>
    </section>
  `;
}

function renderStandardsAI(module) {
  if (state.authSession && !canDo("viewGlobalIndexes")) {
    return `
      <section class="standards-workspace restricted-panel">
        <div class="panel-head">
          <div>
            <h2>Source index restricted</h2>
            <p>Standards, code, and global source indexes require Super Admin access.</p>
          </div>
        </div>
      </section>
    `;
  }
  const latest = state.standardsOutputs.find((output) => output.moduleKey === module.key) || state.standardsOutputs[0];
  const selectedIds = latest?.sourceIds?.length ? latest.sourceIds : standardsSources.map((source) => source.id);
  const selectedMode = latest?.id === "AI-CODE-1001" ? "rebuttal" : latest?.mode || "rebuttal";
  return `
    <section class="standards-workspace">
      <div class="panel-head">
        <div>
          <h2>AI standards, code, and rebuttal engine</h2>
          <p>Search official source connectors, draft rebuttals, and create justification responses with citation and human-review gates.</p>
        </div>
        <div class="source-status">
          <span>${standardsSources.length} sources</span>
          <span>Human review required</span>
        </div>
      </div>
      <div class="standards-layout">
        <form class="standards-form" data-form="standards-ai">
          <input type="hidden" name="moduleKey" value="${module.key}" />
          <div class="form-grid">
            <label>
              <span>Output type</span>
              <select name="mode">
                <option value="rebuttal"${selectedMode === "rebuttal" ? " selected" : ""}>Rebuttal draft</option>
                <option value="code-search"${selectedMode === "code-search" ? " selected" : ""}>Code search</option>
                <option value="justification"${selectedMode === "justification" ? " selected" : ""}>Justification response</option>
                <option value="checklist"${selectedMode === "checklist" ? " selected" : ""}>Compliance checklist</option>
              </select>
            </label>
            <label><span>Jurisdiction / AHJ</span><input name="jurisdiction" value="${escapeHtml(latest?.jurisdiction || "")}" placeholder="State, county, city, or AHJ" /></label>
            <label><span>Trade</span><input name="trade" value="${escapeHtml(latest?.trade || "")}" placeholder="Restoration, roofing, HVAC, plumbing" /></label>
            <label><span>Job type</span><input name="jobType" value="${escapeHtml(latest?.jobType || "")}" placeholder="Water loss, mold, fire, repair, maintenance" /></label>
          </div>
          <label><span>Issue or carrier/code objection</span><input name="issue" required value="${escapeHtml(latest?.issue || "")}" placeholder="Carrier denied containment, drying equipment, PPE, code upgrade, or safety step" /></label>
          <div class="form-grid">
            <label><span>Adjuster jargon / denial language</span><input name="adjusterJargon" value="${escapeHtml(latest?.adjusterJargon || "")}" placeholder="not warranted, excessive, industry standard, pre-existing, equipment days" /></label>
            <label><span>Requested outcome</span><input name="requestedOutcome" value="${escapeHtml(latest?.requestedOutcome || "")}" placeholder="restore line item, approve equipment days, reverse reduction" /></label>
          </div>
          <label><span>Job facts</span><textarea name="facts" rows="5" placeholder="Photos, measurements, room notes, hazards, line items, time, equipment, readings, permits, inspection notes">${escapeHtml(latest?.facts || "")}</textarea></label>
          <fieldset class="source-picker">
            <legend>Source databases and connectors</legend>
            ${standardsSources
              .map(
                (source) => `
                  <label class="source-check">
                    <input name="sourceIds" type="checkbox" value="${source.id}" ${selectedIds.includes(source.id) ? "checked" : ""} />
                    <span><strong>${escapeHtml(source.name)}</strong><small>${escapeHtml(source.access)}</small></span>
                  </label>
                `
              )
              .join("")}
          </fieldset>
          <div class="modal-actions">
            <button type="button" data-action="open-create-file" data-key="${module.key}">Manual file</button>
            <button type="button" data-action="run-live-source-check" data-key="${module.key}">Prepare source check</button>
            <button type="button" data-action="generate-rebuttal" data-key="${module.key}">Generate rebuttal</button>
            <button type="submit">Generate AI source draft</button>
          </div>
        </form>
        ${renderStandardsOutput(latest)}
      </div>
      <div class="source-grid">
        ${standardsSources.map(renderStandardsSourceCard).join("")}
      </div>
      ${renderLearnedJargonDatabase()}
    </section>
  `;
}

function renderLearnedJargonDatabase() {
  return `
    <div class="jargon-database">
      <div class="panel-head">
        <div><h2>Live adjuster jargon database</h2><p>Every pasted response teaches this local database for future rebuttals.</p></div>
        <span>${state.learnedJargon.length} terms</span>
      </div>
      <div class="jargon-term-grid">
        ${state.learnedJargon
          .slice(0, 18)
          .map((term) => `<div><strong>${escapeHtml(term.phrase)}</strong><span>${escapeHtml(term.intent || "Learned phrase")}</span><small>${Number(term.count || 0)} uses - ${escapeHtml(term.source || "learned")}</small></div>`)
          .join("")}
      </div>
    </div>
  `;
}

function renderStandardsOutput(output) {
  if (!output) {
    return `
      <div class="standards-output empty-state">
        <strong>No AI standards draft yet</strong>
        <span>Generate a rebuttal, code search, or justification response.</span>
      </div>
    `;
  }
  const sources = output.sourceIds.map(sourceById).filter(Boolean);
  return `
    <article class="standards-output">
      <div class="file-card-head">
        <span>${escapeHtml(modeLabel(output.mode))}</span>
        <strong>${escapeHtml(formatDate(output.generatedAt))}</strong>
      </div>
      <h3>${escapeHtml(output.title)}</h3>
      <div class="source-meta">
        <span>${escapeHtml(output.jurisdiction)}</span>
        <span>${escapeHtml(output.trade)}</span>
        <span>${escapeHtml(output.jobType)}</span>
      </div>
      <div class="draft-block">
        ${output.draft.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}
      </div>
      ${renderAdjusterJargonPanel(output)}
      ${renderEvidenceChecklist(output)}
      ${renderLiveSourceChecks(output)}
      <div class="citation-list">
        <h4>Source targets</h4>
        ${sources
          .map(
            (source) => `
              <a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">
                <strong>${escapeHtml(source.name)}</strong>
                <span>${escapeHtml(source.scope)}</span>
              </a>
            `
          )
          .join("")}
      </div>
      <div class="review-gates">
        ${output.review.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
      </div>
      <div class="card-actions">
        <button type="button" data-action="copy-standards-output" data-id="${output.id}">Copy draft</button>
        <button type="button" data-action="save-standards-output" data-id="${output.id}">Save as file</button>
      </div>
    </article>
  `;
}

function renderAdjusterJargonPanel(output) {
  const hits = output.jargonHits || [];
  if (!hits.length) return "";
  return `
    <div class="jargon-panel">
      <h4>Adjuster language read</h4>
      ${hits
        .map(
          (hit) => `
            <div>
              <strong>${escapeHtml(hit.phrase)}</strong>
              <span>${escapeHtml(hit.intent)}</span>
              <small>${escapeHtml(hit.responseFrame)}</small>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderEvidenceChecklist(output) {
  const checklist = output.evidenceChecklist || [];
  if (!checklist.length) return "";
  return `
    <div class="evidence-checklist">
      <h4>Evidence to attach</h4>
      <div>
        ${checklist.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
      </div>
    </div>
  `;
}

function renderLiveSourceChecks(output) {
  const checks = output.sourceChecks || [];
  if (!checks.length) return "";
  return `
    <div class="live-check-grid">
      <h4>Live source check targets</h4>
      ${checks
        .map(
          (check) => `
            <a href="${escapeHtml(check.url)}" target="_blank" rel="noreferrer">
              <strong>${escapeHtml(check.name)}</strong>
              <span>${escapeHtml(check.status)} - ${escapeHtml(formatTime(check.checkedAt))}</span>
              <small>${escapeHtml(check.guidance)}</small>
            </a>
          `
        )
        .join("")}
    </div>
  `;
}

function renderStandardsSourceCard(source) {
  return `
    <article class="source-card">
      <div class="file-card-head">
        <span>${escapeHtml(source.authority)}</span>
        <strong>${escapeHtml(source.access)}</strong>
      </div>
      <h3>${escapeHtml(source.name)}</h3>
      <p>${escapeHtml(source.scope)}</p>
      <dl>
        <div><dt>Freshness</dt><dd>${escapeHtml(source.freshness)}</dd></div>
        <div><dt>Integration</dt><dd>${escapeHtml(source.integration)}</dd></div>
      </dl>
      <a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">Open source</a>
    </article>
  `;
}

function renderStatCard(label, value, detail, key) {
  return `
    <a class="stat-card" href="#module/${key}" data-action="set-active" data-key="${key}">
      <strong>${escapeHtml(value)}</strong>
      <span>${escapeHtml(label)}</span>
      <small>${escapeHtml(detail)}</small>
    </a>
  `;
}

function renderQueue(moduleKey) {
  const queue = queueForModule(moduleKey);
  if (!queue.length) {
    return `
      <section class="panel">
        <div class="panel-head">
          <div><h2>Work queue</h2><p>No blocked items for this module.</p></div>
          <button type="button" data-action="seed-queue" data-key="${moduleKey}">Add check item</button>
        </div>
      </section>
    `;
  }
  return `
    <section class="panel">
      <div class="panel-head">
        <div><h2>Work queue</h2><p>Clear actions, then move the file forward.</p></div>
        <button type="button" data-action="seed-queue" data-key="${moduleKey}">Add check item</button>
      </div>
      <div class="queue-list">
        ${queue
          .map(
            (item) => `
              <div class="queue-item">
                <div>
                  <strong>${escapeHtml(item.label)}</strong>
                  <span>${escapeHtml(item.detail)}</span>
                </div>
                <div class="row-actions">
                  <a href="#module/${item.moduleKey}" data-action="set-active" data-key="${item.moduleKey}">Open</a>
                  <button type="button" data-action="complete-queue" data-id="${item.id}">Done</button>
                </div>
              </div>
            `
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderModuleFiles(module) {
  const files = filesForModule(module.key);
  return `
    <section class="panel">
      <div class="panel-head">
        <div>
          <h2>${escapeHtml(module.label)} files</h2>
          <p>Create, open, update, duplicate, and complete files inside this module.</p>
        </div>
        <button type="button" data-action="open-create-file" data-key="${module.key}">New file</button>
      </div>
      <div class="file-grid">
        ${
          files.length
            ? files.map(renderFileCard).join("")
            : `<div class="empty-state"><strong>No files yet</strong><span>Create the first file for this module.</span><button type="button" data-action="open-create-file" data-key="${module.key}">Create file</button></div>`
        }
      </div>
    </section>
  `;
}

function renderFileCard(file) {
  return `
    <article class="file-card${state.selectedFileId === file.id ? " selected" : ""}">
      <div class="file-card-head">
        <span>${escapeHtml(file.type)}</span>
        <strong>${escapeHtml(file.priority)}</strong>
      </div>
      <h3>${escapeHtml(file.title)}</h3>
      <p>${escapeHtml(file.notes || "No notes yet.")}</p>
      ${renderFileLinkedModuleChips(file)}
      <dl>
        <div><dt>Status</dt><dd>${escapeHtml(file.status)}</dd></div>
        <div><dt>Owner</dt><dd>${escapeHtml(file.owner)}</dd></div>
        <div><dt>Due</dt><dd>${escapeHtml(formatDate(file.due))}</dd></div>
      </dl>
      <div class="card-actions">
        <button type="button" data-action="select-file" data-id="${file.id}">Open</button>
        <button type="button" data-action="complete-file" data-id="${file.id}">Complete</button>
        <button type="button" data-action="duplicate-file" data-id="${file.id}">Copy</button>
      </div>
    </article>
  `;
}

function renderFileDetail(module) {
  const file = state.files.find((item) => item.id === state.selectedFileId && fileBelongsToModule(item, module.key));
  if (!file) return "";
  return `
    <section class="detail-panel">
      <div>
        <span>${escapeHtml(file.id)}</span>
        <h2>${escapeHtml(file.title)}</h2>
        <p>${escapeHtml(file.notes || "No notes yet.")}</p>
      </div>
      <div class="detail-grid">
        <div><strong>${escapeHtml(file.status)}</strong><span>Status</span></div>
        <div><strong>${escapeHtml(file.owner)}</strong><span>Owner</span></div>
        <div><strong>${escapeHtml(formatDate(file.due))}</strong><span>Due</span></div>
        <div><strong>${escapeHtml(file.relatedJob || "None")}</strong><span>Related</span></div>
      </div>
      ${renderFileLinkedModuleChips(file)}
      <div class="detail-actions">
        <button type="button" data-action="status-review" data-id="${file.id}">Needs review</button>
        <button type="button" data-action="status-active" data-id="${file.id}">Active</button>
        <button type="button" data-action="complete-file" data-id="${file.id}">Complete</button>
        <button type="button" data-action="delete-file" data-id="${file.id}">Delete</button>
      </div>
    </section>
  `;
}

function renderFileLinkedModuleChips(file) {
  const keys = fileLinkedModules(file);
  if (!keys.length) return "";
  return `
    <div class="file-module-links">
      <span>Also visible in</span>
      <div class="workflow-links">${renderLinkedModuleChips(keys)}</div>
    </div>
  `;
}

function renderLinkedModuleChips(keys) {
  return keys
    .map((key) => moduleByKey(key))
    .filter(Boolean)
    .map((module) => `<a href="#module/${module.key}" data-action="set-active" data-key="${module.key}">${escapeHtml(module.label)}</a>`)
    .join("");
}

function linkedModuleKeys(module) {
  const byCategory = {
    ai: ["aicopilots", "aireview", "compliance", "reports"],
    automation: ["jobs", "nextaction", "notifications", "auditlog"],
    branch: ["branches", "branchbench", "moduletoggles", "licensing"],
    compliance: ["nationalcodes", "safetyintel", "justification", "reports"],
    core: ["universalintake", "properties", "jobs", "reports"],
    dispatch: ["dispatch", "routeplanner", "time", "equipment"],
    documents: ["forms", "signature", "evidencechain", "closeout"],
    field: ["fieldmobile", "photos", "time", "drylogs", "equipment"],
    finance: ["accounting", "payments", "pricing", "reports"],
    jobs: ["properties", "photos", "time", "equipment", "payments"],
    legal: ["contracts", "liens", "communications", "auditlog"],
    licensing: ["licensing", "planmatrix", "featuregates", "subscriptionbilling"],
    marketing: ["leads", "campaigns", "partnerscore", "reports"],
    platform: ["integrations", "datamodel", "auditlog", "securitycenter"],
    property: ["properties", "relationships", "jobs", "maintenance"],
    real_estate: ["properties", "relationships", "workorders", "payments"],
    reports: ["dashboard", "businesshealth", "proofvalue", "accounting"],
    revenue: ["pricing", "evidencechain", "justification", "payments"],
    security: ["securitycenter", "sessiondevices", "auditlog", "trustsafety"],
    strategy: ["setupwizard", "moduletoggles", "businesshealth", "reports"],
    training: ["training", "certbadge", "sops", "auditlog"],
    vendors: ["vendors", "marketplace", "partnerscore", "contracts"]
  };
  const byKey = {
    operatingloop: ["universalintake", "properties", "jobs", "photos", "pricing", "payments", "closeout"],
    universalintake: ["relationships", "properties", "jobs", "dispatch"],
    evidencechain: ["photos", "time", "drylogs", "equipment", "justification", "payments"],
    closeout: ["payments", "equipment", "warranty", "reviews"],
    integrations: ["payments", "maps", "email", "accounting"],
    fieldmobile: ["time", "photos", "equipment", "safety"]
  };
  return [...new Set([...(byKey[module.key] || []), ...(byCategory[module.category] || [])])].filter((key) => key !== module.key && moduleByKey(key));
}

function moduleWorkflowTasks(module) {
  const byCategory = {
    ai: ["Choose source data", "Run review", "Require human approval", "Save output"],
    automation: ["Set trigger", "Pick target module", "Confirm exception path", "Log result"],
    branch: ["Choose branch", "Set role access", "Link territory", "Review audit log"],
    compliance: ["Pick jurisdiction", "Search source", "Attach reviewer", "Save citation trail"],
    core: ["Capture request", "Link contact/property", "Assign owner", "Create next action"],
    dispatch: ["Confirm urgency", "Assign crew", "Check equipment", "Send ETA"],
    documents: ["Choose packet", "Attach source files", "Set signer/reviewer", "Export"],
    field: ["Pick job/room", "Capture GPS/photo/time", "Mark safety", "Sync to file"],
    finance: ["Set amount", "Link job/customer", "Confirm approval", "Post to report"],
    jobs: ["Set stage", "Clear gates", "Attach evidence", "Create invoice path"],
    legal: ["Collect facts", "Attach contract", "Set deadline", "Review before send"],
    licensing: ["Pick plan/role", "Apply gate", "Set seats", "Record agreement"],
    marketing: ["Select channel", "Track spend", "Link lead", "Measure conversion"],
    platform: ["Select integration", "Map fields", "Test sync", "Monitor errors"],
    property: ["Confirm parties", "Link job/history", "Track access", "Schedule follow-up"],
    real_estate: ["Link property", "Assign party", "Track approval", "Close work order"],
    reports: ["Choose date range", "Pick metric", "Filter branch", "Export report"],
    revenue: ["Choose line item", "Attach proof", "Review margin", "Create estimate/invoice"],
    security: ["Identify user/device", "Set control", "Review risk", "Log decision"],
    strategy: ["Pick objective", "Assign owner", "Set milestone", "Measure outcome"],
    training: ["Assign course", "Track quiz", "Record certificate", "Renew on schedule"],
    vendors: ["Verify vendor", "Set scope", "Track insurance/W-9", "Score performance"]
  };
  const tasks = [...(byCategory[module.category] || ["Create record", "Assign owner", "Link related file", "Review status"])];
  const purpose = module.purpose.toLowerCase();
  if (purpose.includes("invoice") && !tasks.includes("Tie to invoice/payment")) tasks.push("Tie to invoice/payment");
  if (purpose.includes("photo") && !tasks.includes("Attach photo proof")) tasks.push("Attach photo proof");
  if (purpose.includes("equipment") && !tasks.includes("Check equipment link")) tasks.push("Check equipment link");
  if (purpose.includes("approval") && !tasks.includes("Capture approval")) tasks.push("Capture approval");
  return tasks.slice(0, 6);
}

function moduleWorkbenchConfig(module) {
  const byCategory = {
    ai: {
      subjectLabel: "AI review target",
      fileType: "AI review",
      fields: [
        { name: "dataSource", label: "Data source", placeholder: "Job file, price book, photos, compliance source" },
        { name: "approvalGate", label: "Approval gate", placeholder: "Owner, estimator, compliance reviewer" }
      ]
    },
    automation: {
      subjectLabel: "Automation rule",
      fileType: "Automation rule",
      fields: [
        { name: "trigger", label: "Trigger", placeholder: "When invoice is overdue, photo missing, lead arrives" },
        { name: "result", label: "Result", placeholder: "Create task, send alert, lock action" }
      ]
    },
    branch: {
      subjectLabel: "Branch item",
      fileType: "Branch record",
      fields: [
        { name: "branch", label: "Branch", placeholder: "Pittsfield, overflow, franchisee" },
        { name: "access", label: "Access / role", placeholder: "Owner, manager, employee-only, vendor" }
      ]
    },
    compliance: {
      subjectLabel: "Compliance issue",
      fileType: "Compliance review",
      fields: [
        { name: "jurisdiction", label: "Jurisdiction / AHJ", placeholder: "State, county, city, AHJ" },
        { name: "source", label: "Source / standard", placeholder: "IICRC, OSHA, IBC, local amendment" }
      ]
    },
    core: {
      subjectLabel: "Operating item",
      fileType: "Operating record",
      fields: [
        { name: "contact", label: "Contact / property", placeholder: "Customer, tenant, property, partner" },
        { name: "nextAction", label: "Next action", kind: "textarea", placeholder: "What happens next" }
      ]
    },
    dispatch: {
      subjectLabel: "Dispatch run",
      fileType: "Dispatch item",
      fields: [
        { name: "crew", label: "Crew / truck", placeholder: "Crew A, on-call tech, vendor" },
        { name: "eta", label: "ETA / window", placeholder: "Today 2-4 PM" }
      ]
    },
    documents: {
      subjectLabel: "Document packet",
      fileType: "Document",
      fields: [
        { name: "recipient", label: "Recipient", placeholder: "Customer, adjuster, attorney, vendor" },
        { name: "packet", label: "Packet contents", kind: "textarea", placeholder: "Contract, photos, estimate, invoice, signoff" }
      ]
    },
    field: {
      subjectLabel: "Field record",
      fileType: "Field record",
      fields: [
        { name: "worker", label: "Worker / crew", placeholder: "Tech or crew name" },
        { name: "room", label: "Room / location", placeholder: "Kitchen, unit 2B, roof, mechanical room" }
      ]
    },
    finance: {
      subjectLabel: "Finance item",
      fileType: "Finance record",
      fields: [
        { name: "amount", label: "Amount", type: "number", placeholder: "0.00" },
        { name: "paymentStatus", label: "Payment / approval status", placeholder: "Deposit due, paid, owner approval" }
      ]
    },
    legal: {
      subjectLabel: "Legal deadline",
      fileType: "Legal record",
      fields: [
        { name: "party", label: "Party", placeholder: "Customer, carrier, attorney, vendor" },
        { name: "deadline", label: "Deadline", type: "date" }
      ]
    },
    licensing: {
      subjectLabel: "License / plan item",
      fileType: "License record",
      fields: [
        { name: "plan", label: "Plan / role", placeholder: "Lite, Pro, Branch, employee, vendor" },
        { name: "seatCount", label: "Seats / users", type: "number", placeholder: "1" }
      ]
    },
    marketing: {
      subjectLabel: "Campaign / lead item",
      fileType: "Campaign",
      fields: [
        { name: "channel", label: "Channel", placeholder: "Google, email, broker, QR, partner" },
        { name: "spend", label: "Spend", type: "number", placeholder: "0.00" }
      ]
    },
    platform: {
      subjectLabel: "Platform setting",
      fileType: "Platform record",
      fields: [
        { name: "system", label: "System / integration", placeholder: "QuickBooks, Maps, Gmail, storage" },
        { name: "mapping", label: "Field mapping", kind: "textarea", placeholder: "What data moves where" }
      ]
    },
    property: {
      subjectLabel: "Property relationship",
      fileType: "Property record",
      fields: [
        { name: "property", label: "Property / unit", placeholder: "Address, unit, building" },
        { name: "access", label: "Access / relationship", placeholder: "Owner, tenant, manager, broker" }
      ]
    },
    real_estate: {
      subjectLabel: "Work order",
      fileType: "Real estate work order",
      fields: [
        { name: "property", label: "Property", placeholder: "Listing, unit, portfolio" },
        { name: "approval", label: "Approval path", placeholder: "Owner, agent, property manager" }
      ]
    },
    reports: {
      subjectLabel: "Report request",
      fileType: "Report",
      fields: [
        { name: "dateRange", label: "Date range", placeholder: "This week, June, Q2" },
        { name: "metric", label: "Metric / audience", placeholder: "Margin, receivables, owner, branch" }
      ]
    },
    revenue: {
      subjectLabel: "Revenue item",
      fileType: "Revenue packet",
      fields: [
        { name: "lineItem", label: "Line item / charge", placeholder: "Equipment, labor, admin, supplement" },
        { name: "support", label: "Proof / justification", kind: "textarea", placeholder: "Photos, time, measurements, readings, source language" }
      ]
    },
    security: {
      subjectLabel: "Security item",
      fileType: "Security review",
      fields: [
        { name: "userDevice", label: "User / device", placeholder: "Employee, vendor, device, session" },
        { name: "control", label: "Control", placeholder: "2FA, revoke, restrict, approve" }
      ]
    },
    strategy: {
      subjectLabel: "Strategy action",
      fileType: "Strategy record",
      fields: [
        { name: "objective", label: "Objective", placeholder: "Setup, upgrade, benchmark, health score" },
        { name: "measure", label: "Measure", placeholder: "Revenue, time saved, conversion, adoption" }
      ]
    },
    training: {
      subjectLabel: "Training item",
      fileType: "Training record",
      fields: [
        { name: "employee", label: "Employee / branch", placeholder: "Name or branch" },
        { name: "course", label: "Course / certificate", placeholder: "OSHA, IICRC, SOP, onboarding" }
      ]
    },
    vendors: {
      subjectLabel: "Vendor item",
      fileType: "Vendor file",
      fields: [
        { name: "vendor", label: "Vendor / trade", placeholder: "Plumber, roofer, electrician, supplier" },
        { name: "credential", label: "Credential / W-9 / COI", placeholder: "Verified, missing, expired, requested" }
      ]
    }
  };
  const config = byCategory[module.category] || {
    subjectLabel: `${module.label} item`,
    fileType: suggestedFileType(module),
    fields: [{ name: "details", label: "Details", kind: "textarea", placeholder: "Record details" }]
  };
  return {
    ...config,
    title: `${module.label} workbench`,
    fields: [
      { name: "subject", label: config.subjectLabel, placeholder: `${module.label} record`, required: true },
      ...config.fields,
      { name: "relatedJob", label: "Linked job / file", placeholder: "J-2039, property, invoice, claim" },
      { name: "owner", label: "Owner", placeholder: "Office, estimator, tech, branch manager" },
      { name: "priority", label: "Priority", kind: "select", options: ["High", "Medium", "Low"] },
      { name: "due", label: "Due date", type: "date" }
    ],
    tasks: moduleWorkflowTasks(module),
    links: linkedModuleKeys(module)
  };
}

function renderWorkbenchField(field) {
  const required = field.required ? " required" : "";
  if (field.kind === "textarea") {
    return `<label><span>${escapeHtml(field.label)}</span><textarea name="${escapeHtml(field.name)}" rows="3"${required} placeholder="${escapeHtml(field.placeholder || "")}"></textarea></label>`;
  }
  if (field.kind === "select") {
    return `
      <label>
        <span>${escapeHtml(field.label)}</span>
        <select name="${escapeHtml(field.name)}"${required}>
          ${(field.options || []).map((option) => `<option>${escapeHtml(option)}</option>`).join("")}
        </select>
      </label>
    `;
  }
  return `<label><span>${escapeHtml(field.label)}</span><input name="${escapeHtml(field.name)}" type="${escapeHtml(field.type || "text")}"${required} placeholder="${escapeHtml(field.placeholder || "")}" /></label>`;
}

function renderModuleWorkbench(module) {
  const config = moduleWorkbenchConfig(module);
  const recentFiles = filesForModule(module.key).slice(0, 3);
  return `
    <section class="module-workbench workbench-${escapeHtml(module.category)}">
      <div class="workbench-main">
        <div class="panel-head">
          <div>
            <h2>${escapeHtml(config.title)}</h2>
            <p>${escapeHtml(module.purpose)}</p>
          </div>
          <button type="button" data-action="seed-queue" data-key="${module.key}">Add check item</button>
        </div>
        <div class="task-grid">
          ${config.tasks.map((task, index) => `<div><strong>${index + 1}</strong><span>${escapeHtml(task)}</span></div>`).join("")}
        </div>
        <div class="linked-box">
          <h3>Linked modules</h3>
          <div class="workflow-links">${renderLinkedModuleChips(config.links)}</div>
        </div>
        <div class="mini-file-list">
          ${recentFiles.length ? recentFiles.map((file) => `<button type="button" data-action="select-file" data-id="${file.id}">${escapeHtml(file.title)}<span>${escapeHtml(file.status)}</span></button>`).join("") : `<span>No ${escapeHtml(module.label)} records yet.</span>`}
        </div>
      </div>
      <form class="workbench-form" data-form="module-workbench">
        <input type="hidden" name="moduleKey" value="${module.key}" />
        ${config.fields.map(renderWorkbenchField).join("")}
        <button type="submit">Create ${escapeHtml(config.fileType)}</button>
      </form>
    </section>
  `;
}

function renderInsuranceModule(module) {
  const submissions = state.insuranceSubmissions;
  const selected = selectedInsuranceSubmission();
  const statusCounts = insuranceStatuses
    .filter((status) => status !== "all")
    .reduce((counts, status) => ({ ...counts, [status]: submissions.filter((submission) => submission.status === status).length }), {});
  const requiresLogin = insuranceRequiresLogin();
  const setupError = state.insuranceError && state.insuranceError.includes("not configured");

  return `
    ${renderManagedSection("insurance-hero", `<section class="hero-band">
      <div>
        <span class="hero-eyebrow">Website intake</span>
        <h2>${escapeHtml(sectionTitle("insurance-hero", "Insurance submissions dashboard"))}</h2>
        <p>${escapeHtml(sectionBody("insurance-hero", "Review claim submissions from the public website, open uploaded files, update status, and save internal notes."))}</p>
        <div class="hero-actions">
          <button type="button" data-action="refresh-insurance-intake">${state.insuranceAdminSession ? "Refresh submissions" : "Check admin access"}</button>
          ${
            state.insuranceAdminSession
              ? `<button type="button" data-action="insurance-admin-logout">Sign out ${escapeHtml(state.insuranceAdminSession.email || "")}</button>`
              : `<span>${state.insuranceAuthLoading ? "Checking admin access..." : "Admin sign-in required to view submissions."}</span>`
          }
          <a href="#module/jobs" data-action="set-active" data-key="jobs">Link to jobs</a>
          <a href="#module/relationships" data-action="set-active" data-key="relationships">Open contacts</a>
          ${renderSectionButtons("insurance-hero")}
        </div>
      </div>
      <div class="metric-strip">
        <div><strong>${submissions.length}</strong><span>Total submissions</span></div>
        <div><strong>${statusCounts.new || 0}</strong><span>New</span></div>
        <div><strong>${statusCounts["in-progress"] || 0}</strong><span>In progress</span></div>
      </div>
    </section>`)}
    ${renderManagedSection("insurance-submissions", `<section class="panel insurance-panel">
      <div class="panel-head">
        <div>
          <h2>${escapeHtml(module.label)} queue</h2>
          <p>Search by customer, phone, email, claim number, or property address and filter by review status.</p>
        </div>
      </div>
      ${
        requiresLogin
          ? `
            <form class="insurance-notes-form" data-form="insurance-admin-login">
              <label><span>Admin email</span><input name="email" type="email" autocomplete="username" placeholder="owner@example.com" /></label>
              <label><span>Admin password</span><input name="password" type="password" autocomplete="current-password" placeholder="Enter admin password" /></label>
              <div class="modal-actions">
                <button type="submit">${state.insuranceAuthLoading ? "Signing in..." : "Sign in to insurance dashboard"}</button>
              </div>
            </form>
          `
          : ""
      }
      ${
        setupError
          ? `<div class="insurance-banner insurance-banner-error">Set <code>ADMIN_EMAILS</code>, <code>ADMIN_PASSWORD</code>, and <code>ADMIN_JWT_SECRET</code> in the OS environment, then redeploy.</div>`
          : ""
      }
      <div class="insurance-toolbar">
        <label><span>Search</span><input data-field="insurance-search" value="${escapeHtml(state.insuranceFilters.search)}" placeholder="Name, phone, email, claim, address" /></label>
        <label><span>Status</span>
          <select data-field="insurance-status">
            ${insuranceStatuses
              .map((status) => `<option value="${status}"${state.insuranceFilters.status === status ? " selected" : ""}>${escapeHtml(status === "all" ? "All statuses" : insuranceStatusLabel(status))}</option>`)
              .join("")}
          </select>
        </label>
        <div class="insurance-toolbar-actions">
          <button type="button" data-action="refresh-insurance-intake">Apply filters</button>
        </div>
      </div>
      ${state.insuranceError ? `<div class="insurance-banner insurance-banner-error">${escapeHtml(state.insuranceError)}</div>` : ""}
      ${state.insuranceLoading ? `<div class="insurance-banner">Loading insurance submissions...</div>` : ""}
      <div class="insurance-layout">
        <div class="insurance-list">
          ${
            requiresLogin
              ? `<div class="empty-state"><strong>Admin sign-in required</strong><span>Use the admin credentials configured on the OS backend to load live website submissions.</span></div>`
              : submissions.length
              ? submissions.map(renderInsuranceSubmissionCard).join("")
              : `<div class="empty-state"><strong>No insurance submissions found</strong><span>New website uploads will appear here after they are posted to <code>/api/insurance-intake</code>.</span></div>`
          }
        </div>
        ${
          requiresLogin
            ? `<div class="empty-state"><strong>Live intake is protected</strong><span>Once you sign in, this panel will show claim details, uploaded evidence, status changes, and internal notes.</span></div>`
            : selected
              ? renderManagedSection("insurance-detail", renderInsuranceSubmissionDetail(selected))
              : `<div class="empty-state"><strong>Select a submission</strong><span>Choose an insurance submission to review files, change status, and add internal notes.</span></div>`
        }
      </div>
    </section>`)}
  `;
}

function renderInsuranceSubmissionCard(submission) {
  return `
    <article class="insurance-card${state.selectedInsuranceId === submission.id ? " selected" : ""}">
      <div class="file-card-head">
        <span>${escapeHtml(submission.claimNumber)}</span>
        <strong>${escapeHtml(insuranceStatusLabel(submission.status))}</strong>
      </div>
      <h3>${escapeHtml(submission.fullName)}</h3>
      <p>${escapeHtml(submission.propertyAddress)}</p>
      <dl>
        <div><dt>Carrier</dt><dd>${escapeHtml(submission.insuranceCompanyName)}</dd></div>
        <div><dt>Phone</dt><dd>${escapeHtml(submission.phone)}</dd></div>
        <div><dt>Created</dt><dd>${escapeHtml(formatTime(submission.createdAt))}</dd></div>
      </dl>
      <div class="card-actions">
        <button type="button" data-action="select-insurance-submission" data-id="${submission.id}">Open</button>
      </div>
    </article>
  `;
}

function renderInsuranceSubmissionDetail(submission) {
  return `
    <section class="detail-panel insurance-detail-panel">
      <div>
        <span>${escapeHtml(submission.id)}</span>
        <h2>${escapeHtml(submission.fullName)}</h2>
        <p>${escapeHtml(submission.damageDescription)}</p>
      </div>
      <div class="detail-grid">
        <div><strong>${escapeHtml(insuranceStatusLabel(submission.status))}</strong><span>Status</span></div>
        <div><strong>${escapeHtml(submission.claimNumber)}</strong><span>Claim</span></div>
        <div><strong>${escapeHtml(submission.policyNumber)}</strong><span>Policy</span></div>
        <div><strong>${escapeHtml(formatTime(submission.createdAt))}</strong><span>Created</span></div>
      </div>
      <div class="insurance-detail-grid">
        <div class="insurance-detail-card">
          <h3>Contact and property</h3>
          <dl>
            <div><dt>Phone</dt><dd>${escapeHtml(submission.phone)}</dd></div>
            <div><dt>Email</dt><dd>${escapeHtml(submission.email)}</dd></div>
            <div><dt>Address</dt><dd>${escapeHtml(submission.propertyAddress)}</dd></div>
            <div><dt>Carrier</dt><dd>${escapeHtml(submission.insuranceCompanyName)}</dd></div>
          </dl>
        </div>
        <div class="insurance-detail-card">
          <h3>Uploaded files</h3>
          ${
            submission.uploadedFiles?.length
              ? `<div class="insurance-file-list">${submission.uploadedFiles
                  .map(
                    (file) => `
                      <a href="${escapeHtml(file.path)}" target="_blank" rel="noreferrer">
                        <strong>${escapeHtml(file.originalName || file.fileName)}</strong>
                        <span>${escapeHtml(file.mimeType || "file")} - ${escapeHtml(`${Math.max(1, Math.round((Number(file.size || 0) / 1024) * 10) / 10)} KB`)}</span>
                      </a>
                    `
                  )
                  .join("")}</div>`
              : `<p class="insurance-empty-copy">No uploaded files were included with this submission.</p>`
          }
        </div>
      </div>
      <form class="insurance-status-form" data-form="insurance-status">
        <input type="hidden" name="id" value="${escapeHtml(submission.id)}" />
        <label><span>Status</span>
          <select name="status">
            ${insuranceStatuses
              .filter((status) => status !== "all")
              .map((status) => `<option value="${status}"${submission.status === status ? " selected" : ""}>${escapeHtml(insuranceStatusLabel(status))}</option>`)
              .join("")}
          </select>
        </label>
        <div class="modal-actions">
          <button type="submit">Update status</button>
          <button type="button" data-action="refresh-selected-insurance">Refresh detail</button>
        </div>
      </form>
      <form class="insurance-notes-form" data-form="insurance-notes">
        <input type="hidden" name="id" value="${escapeHtml(submission.id)}" />
        <label><span>Internal notes</span><textarea name="notes" rows="6" placeholder="Operator notes, assignment details, next steps, or claim concerns">${escapeHtml(submission.internalNotes || "")}</textarea></label>
        <div class="modal-actions">
          <button type="submit">Save notes</button>
        </div>
      </form>
    </section>
  `;
}

function renderJobTrackerModule(module) {
  const jobs = visibleJobBoards();
  const counts = jobGateCounts(jobs);
  const average = jobs.length ? Math.round(jobs.reduce((sum, job) => sum + jobGateCompletion(job), 0) / jobs.length) : 0;
  return `
    <section class="hero-band job-hero">
      <div>
        <p>${escapeHtml(module.purpose)}</p>
        <div class="hero-actions">
          <button type="button" data-action="open-create-file" data-key="jobs">Manual job file</button>
          <a href="#module/dispatch" data-action="set-active" data-key="dispatch">Open dispatch</a>
          <a href="#module/drylogs" data-action="set-active" data-key="drylogs">Dry logs</a>
          <a href="#module/payments" data-action="set-active" data-key="payments">Open billing</a>
        </div>
      </div>
      <div class="metric-strip">
        <div><strong>${jobs.length}</strong><span>Tracked jobs</span></div>
        <div><strong>${average}%</strong><span>Gate progress</span></div>
        <div><strong>${counts.blocked}</strong><span>Blocked gates</span></div>
      </div>
    </section>
    <section class="job-layout">
      <div class="panel">
        <div class="panel-head">
          <div><h2>Job Gantt</h2><p>Stage timing, blockers, and branch ownership.</p></div>
          <a class="text-link" href="#module/routeplanner" data-action="set-active" data-key="routeplanner">Routes</a>
        </div>
        ${renderJobTimeline()}
      </div>
      <div class="panel">
        <div class="panel-head">
          <div><h2>Add job</h2><p>Create a job record with default gating.</p></div>
        </div>
        ${renderJobForm()}
      </div>
    </section>
    <section class="panel">
      <div class="panel-head">
        <div><h2>Gate board</h2><p>Click a gate to cycle Open, Blocked, and Done.</p></div>
        <div class="workflow-links">${renderLinkedModuleChips(["photos", "time", "drylogs", "equipment", "payments", "closeout"])}</div>
      </div>
      <div class="job-card-grid">
        ${jobs.map(renderJobGateCard).join("")}
      </div>
    </section>
    ${renderQueue(module.key)}
    ${renderModuleFiles(module)}
    ${renderFileDetail(module)}
  `;
}

function renderJobTimeline() {
  const jobs = visibleJobBoards();
  const bounds = jobTimelineBounds(jobs);
  return `
    <div class="gantt">
      <div class="gantt-scale">
        <span>${escapeHtml(formatDate(bounds.start.toISOString()))}</span>
        <span>${escapeHtml(formatDate(bounds.end.toISOString()))}</span>
      </div>
      ${jobs
        .map((job) => {
          const position = jobTimelinePosition(job, bounds);
          return `
            <div class="gantt-row">
              <div class="gantt-label">
                <strong>${escapeHtml(job.jobId)}</strong>
                <span>${escapeHtml(job.title)}</span>
              </div>
              <div class="gantt-track">
                <div class="gantt-bar" style="left:${position.left}%; width:${position.width}%;">
                  <span>${escapeHtml(job.stage)}</span>
                </div>
              </div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderJobGateCard(job) {
  const branch = branchById(job.branchId);
  const drySummary = dryLogSummaryForJob(job);
  return `
    <article class="job-card">
      <div class="file-card-head">
        <span>${escapeHtml(job.stage)}</span>
        <strong>${jobGateCompletion(job)}%</strong>
      </div>
      <h3>${escapeHtml(job.jobId)} ${escapeHtml(job.title)}</h3>
      <p>${escapeHtml(job.customer)} - ${escapeHtml(job.property)}</p>
      <dl>
        <div><dt>Branch</dt><dd>${escapeHtml(branch?.name || "Unassigned")}</dd></div>
        <div><dt>Owner</dt><dd>${escapeHtml(job.owner)}</dd></div>
        <div><dt>Dry log</dt><dd>${escapeHtml(drySummary.logs.length ? `${drySummary.status} - ${drySummary.latest.moisture}%/${drySummary.latest.targetMoisture}%` : "No readings")}</dd></div>
        <div><dt>Next</dt><dd>${escapeHtml(job.nextAction || "None")}</dd></div>
      </dl>
      <div class="gate-grid">
        ${(job.gates || [])
          .map(
            (gate) => `<button type="button" class="gate-chip gate-${escapeHtml(gate.status.toLowerCase().replace(/\s+/g, "-"))}" data-action="toggle-job-gate" data-id="${job.id}" data-gate="${gate.id}"><span>${escapeHtml(gate.label)}</span><strong>${escapeHtml(gate.status)}</strong></button>`
          )
          .join("")}
      </div>
      <div class="workflow-links">${renderLinkedModuleChips(job.linkedModules || [])}</div>
      <div class="card-actions">
        <button type="button" data-action="create-job-packet" data-id="${job.id}">Create job packet</button>
        <button type="button" data-action="create-drylog-packet" data-id="${job.jobId}">Dry log packet</button>
      </div>
    </article>
  `;
}

function renderJobForm() {
  return `
    <form class="stack-form" data-form="job-record">
      <div class="form-grid">
        <label><span>Job number</span><input name="jobId" placeholder="J-2050" required /></label>
        <label><span>Job title</span><input name="title" placeholder="Water loss, repair, inspection" required /></label>
        <label><span>Customer</span><input name="customer" placeholder="Customer or account" /></label>
        <label><span>Property</span><input name="property" placeholder="Address, unit, building" /></label>
        <label><span>Stage</span><select name="stage"><option>Intake</option><option>Inspection</option><option>Dry-out</option><option>Repair</option><option>Invoice support</option><option>Closeout</option></select></label>
        <label><span>Branch</span><select name="branchId">${state.branches.map((branch) => `<option value="${branch.id}">${escapeHtml(branch.name)}</option>`).join("")}</select></label>
        <label><span>Owner</span><input name="owner" placeholder="PM, estimator, office" /></label>
        <label><span>Start</span><input name="start" type="date" value="${today.toISOString().slice(0, 10)}" /></label>
        <label><span>End</span><input name="end" type="date" value="${today.toISOString().slice(0, 10)}" /></label>
      </div>
      <label><span>Next action</span><textarea name="nextAction" rows="2" placeholder="What moves this job next"></textarea></label>
      <label><span>Blockers</span><textarea name="blockers" rows="2" placeholder="Deposit, authorization, COI, photos, equipment, invoice"></textarea></label>
      <button type="submit">Add job to tracker</button>
    </form>
  `;
}

function renderDryLogsModule(module) {
  const dryLogs = visibleDryLogs();
  const jobs = visibleJobBoards();
  const openReadings = dryLogs.filter((log) => dryLogGap(log) > 0).length;
  const atTarget = dryLogs.filter((log) => dryLogGap(log) <= 0).length;
  const avgGap = dryLogs.length ? dryLogs.reduce((sum, log) => sum + dryLogGap(log), 0) / dryLogs.length : 0;
  return `
    <section class="hero-band drylog-hero">
      <div>
        <p>${escapeHtml(module.purpose)}</p>
        <div class="hero-actions">
          <button type="button" data-action="open-create-file" data-key="drylogs">Manual dry file</button>
          <a href="#module/jobs" data-action="set-active" data-key="jobs">Open jobs</a>
          <a href="#module/equipment" data-action="set-active" data-key="equipment">Equipment</a>
          <a href="#module/photos" data-action="set-active" data-key="photos">Photos</a>
        </div>
      </div>
      <div class="metric-strip">
        <div><strong>${dryLogs.length}</strong><span>Readings</span></div>
        <div><strong>${openReadings}</strong><span>Above target</span></div>
        <div><strong>${atTarget}</strong><span>At target</span></div>
        <div><strong>${avgGap.toFixed(1)}</strong><span>Avg gap</span></div>
      </div>
    </section>
    <section class="drylog-layout">
      <div class="panel">
        <div class="panel-head">
          <div><h2>Drying job status</h2><p>Moisture trends update the job dry-log gate.</p></div>
          <a class="text-link" href="#module/defensibility" data-action="set-active" data-key="defensibility">Defensibility</a>
        </div>
        <div class="drylog-job-grid">
          ${jobs.map(renderDryLogJobCard).join("")}
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><div><h2>Add reading</h2><p>Log moisture, RH, temperature, equipment, and photo proof.</p></div></div>
        ${renderDryLogForm()}
      </div>
    </section>
    <section class="panel">
      <div class="panel-head">
        <div><h2>Reading history</h2><p>All readings stay tied to jobs, rooms, equipment, and invoice support.</p></div>
        <button type="button" data-action="open-export">Export</button>
      </div>
      ${renderDryLogTable(dryLogs)}
    </section>
    ${renderQueue(module.key)}
    ${renderModuleFiles(module)}
    ${renderFileDetail(module)}
  `;
}

function renderDryLogJobCard(job) {
  const summary = dryLogSummaryForJob(job);
  return `
    <article class="drylog-job-card">
      <div class="file-card-head">
        <span>${escapeHtml(job.jobId)}</span>
        <strong>${escapeHtml(summary.status)}</strong>
      </div>
      <h3>${escapeHtml(job.title)}</h3>
      <p>${escapeHtml(job.property)} - ${escapeHtml(summary.logs.length ? `${summary.logs.length} reading(s)` : "No readings yet")}</p>
      <dl>
        <div><dt>Latest</dt><dd>${escapeHtml(summary.latest ? `${summary.latest.moisture}% / target ${summary.latest.targetMoisture}%` : "None")}</dd></div>
        <div><dt>Open readings</dt><dd>${escapeHtml(summary.openReadings)}</dd></div>
        <div><dt>Gap</dt><dd>${escapeHtml(summary.latest ? summary.gap.toFixed(1) : "0.0")}</dd></div>
      </dl>
      <div class="card-actions">
        <button type="button" data-action="create-drylog-packet" data-id="${job.jobId}">Create packet</button>
        <a href="#module/jobs" data-action="set-active" data-key="jobs">Job gates</a>
      </div>
    </article>
  `;
}

function renderDryLogForm() {
  const jobs = visibleJobBoards();
  return `
    <form class="stack-form" data-form="dry-log">
      <div class="form-grid">
        <label><span>Job</span><select name="jobId">${jobs.map((job) => `<option value="${job.jobId}">${escapeHtml(job.jobId)} - ${escapeHtml(job.title)}</option>`).join("")}</select></label>
        <label><span>Reading date</span><input name="readingDate" type="date" value="${today.toISOString().slice(0, 10)}" /></label>
        <label><span>Technician</span><input name="technician" value="${escapeHtml(state.worker?.name || "")}" placeholder="Field tech" /></label>
        <label><span>Room</span><input name="room" required placeholder="Living room, hall, unit 2B" /></label>
        <label><span>Material</span><input name="material" required placeholder="Wood floor, drywall, sill plate" /></label>
        <label><span>Moisture %</span><input name="moisture" type="number" step="0.1" required placeholder="15.2" /></label>
        <label><span>Target %</span><input name="targetMoisture" type="number" step="0.1" value="12" /></label>
        <label><span>RH %</span><input name="relativeHumidity" type="number" step="0.1" placeholder="40" /></label>
        <label><span>Temp F</span><input name="temperature" type="number" step="0.1" placeholder="72" /></label>
        <label><span>Status</span><select name="status"><option>Drying</option><option>Monitor</option><option>At target</option><option>Needs review</option></select></label>
      </div>
      <fieldset class="source-picker compact-picker">
        <legend>Equipment running in this area</legend>
        ${state.equipmentDeployments
          .map(
            (deployment) => `
              <label class="source-check">
                <input name="equipmentIds" type="checkbox" value="${deployment.id}" ${String(deployment.job || "").includes("2039") ? "checked" : ""} />
                <span><strong>${escapeHtml(deployment.equipmentName)}</strong><small>${escapeHtml(`${deployment.assetTag || deployment.id} - ${deployment.job}`)}</small></span>
              </label>
            `
          )
          .join("") || `<span>No equipment deployments yet.</span>`}
      </fieldset>
      <label><span>Photo reference</span><input name="photoRef" placeholder="Photo filename, room photo ID, or evidence link" /></label>
      <label><span>Notes</span><textarea name="notes" rows="3" placeholder="Reading location, material condition, equipment placement, next target, photo notes"></textarea></label>
      <button type="submit">Save dry log</button>
    </form>
  `;
}

function renderDryLogTable(logs = visibleDryLogs()) {
  if (!logs.length) {
    return `<div class="empty-state"><strong>No dry logs yet</strong><span>Add a reading to start job-connected drying documentation.</span></div>`;
  }
  return `
    <table class="data-table drylog-table">
      <thead><tr><th>Job</th><th>Room/material</th><th>Reading</th><th>RH/temp</th><th>Equipment/photos</th><th>Status</th></tr></thead>
      <tbody>
        ${logs
          .map(
            (log) => `
              <tr>
                <td><strong>${escapeHtml(log.jobId)}</strong><br /><span>${escapeHtml(formatDate(log.readingDate))}</span></td>
                <td>${escapeHtml(log.room)}<br /><span>${escapeHtml(log.material)}</span></td>
                <td><strong>${escapeHtml(`${log.moisture}%`)}</strong><br /><span>Target ${escapeHtml(`${log.targetMoisture}%`)}</span></td>
                <td>${escapeHtml(`${log.relativeHumidity || 0}% RH`)}<br /><span>${escapeHtml(`${log.temperature || 0}F`)}</span></td>
                <td>${escapeHtml(dryLogEquipmentNames(log).join(", ") || "No equipment")}<br /><span>${escapeHtml(log.photoRef || "No photo")}</span></td>
                <td><strong>${escapeHtml(dryLogStatus(log))}</strong><br /><span>${escapeHtml(log.technician || "Field")}</span></td>
              </tr>
            `
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderPhotosModule(module) {
  const photos = visiblePhotoRecords();
  const jobs = visibleJobBoards();
  const photoTasks = visibleTasks().filter((task) => task.moduleKey === "photos" && task.status !== "Complete");
  return `
    <section class="hero-band">
      <div>
        <span class="hero-eyebrow">Field evidence</span>
        <h2>${escapeHtml(module.label)}</h2>
        <p>Upload job photos, attach them to assigned tasks, and add job notes that flow into billing, defensibility, closeout, and the job gate board.</p>
        <div class="hero-actions">
          <a href="#module/jobs" data-action="set-active" data-key="jobs">Assigned jobs</a>
          <a href="#module/time" data-action="set-active" data-key="time">Time log</a>
          <a href="#module/drylogs" data-action="set-active" data-key="drylogs">Dry logs</a>
          <button type="button" data-action="open-create-file" data-key="photos">Manual photo file</button>
        </div>
      </div>
      <div class="metric-strip">
        <div><strong>${photos.length}</strong><span>Photos</span></div>
        <div><strong>${jobs.length}</strong><span>Assigned jobs</span></div>
        <div><strong>${photoTasks.length}</strong><span>Open photo tasks</span></div>
      </div>
    </section>
    <section class="team-layout">
      <div class="panel">
        <div class="panel-head"><div><h2>Upload job photo</h2><p>Save before, progress, completion, equipment, or invoice-support photos against a job and task.</p></div></div>
        ${renderPhotoEvidenceForm(jobs, photoTasks)}
      </div>
      <div class="panel">
        <div class="panel-head"><div><h2>Add job note</h2><p>Field notes become linked job files visible in related modules.</p></div></div>
        ${renderJobNoteForm(jobs)}
      </div>
    </section>
    <section class="panel">
      <div class="panel-head">
        <div><h2>Photo evidence board</h2><p>Photos are scoped to assigned jobs for workers and linked across the operating loop.</p></div>
        <div class="workflow-links">${renderLinkedModuleChips(["jobs", "time", "drylogs", "equipment", "payments", "defensibility", "closeout"])}</div>
      </div>
      ${photos.length ? `<div class="business-record-grid">${photos.map(renderPhotoRecordCard).join("")}</div>` : `<div class="empty-state"><strong>No photo evidence yet</strong><span>Upload a photo or save a field note for an assigned job.</span></div>`}
    </section>
    ${renderQueue(module.key)}
    ${renderModuleFiles(module)}
    ${renderFileDetail(module)}
  `;
}

function renderPhotoEvidenceForm(jobs, photoTasks) {
  return `
    <form class="stack-form" data-form="photo-evidence">
      <div class="form-grid">
        <label><span>Job</span><select name="jobId" required>${jobs.length ? jobs.map((job) => `<option value="${escapeHtml(job.jobId)}">${escapeHtml(job.jobId)} - ${escapeHtml(job.title)}</option>`).join("") : `<option value="">No assigned jobs</option>`}</select></label>
        <label><span>Task</span><select name="taskId"><option value="">No task selected</option>${photoTasks.map((task) => `<option value="${escapeHtml(task.id)}">${escapeHtml(task.title)}${task.relatedJob ? ` - ${escapeHtml(task.relatedJob)}` : ""}</option>`).join("")}</select></label>
        <label><span>Room / area</span><input name="room" required placeholder="Kitchen, hall, equipment room" /></label>
        <label><span>Category</span><select name="category"><option>Before</option><option>Progress</option><option>Completion</option><option>Equipment</option><option>Invoice support</option><option>Issue</option></select></label>
        <label><span>Photo file</span><input name="photoFile" type="file" accept="image/*" /></label>
        <label><span>Photo reference or link</span><input name="photoRef" placeholder="IMG_2042.jpg or cloud link" /></label>
      </div>
      <label><span>Notes</span><textarea name="notes" rows="3" placeholder="What this photo proves, affected material, location, equipment, or invoice support"></textarea></label>
      <button type="submit">Save photo evidence</button>
    </form>
  `;
}

function renderJobNoteForm(jobs) {
  return `
    <form class="stack-form" data-form="job-note">
      <div class="form-grid">
        <label><span>Job</span><select name="jobId" required>${jobs.length ? jobs.map((job) => `<option value="${escapeHtml(job.jobId)}">${escapeHtml(job.jobId)} - ${escapeHtml(job.title)}</option>`).join("") : `<option value="">No assigned jobs</option>`}</select></label>
        <label><span>Note type</span><select name="noteType"><option>Field note</option><option>Issue</option><option>Customer update</option><option>Scope note</option><option>Material note</option><option>Safety note</option></select></label>
      </div>
      <label><span>Note</span><textarea name="notes" rows="4" required placeholder="Add field update, condition note, customer communication, material issue, or next action"></textarea></label>
      <button type="submit">Save job note</button>
    </form>
  `;
}

function renderPhotoRecordCard(record) {
  const task = state.tasks.find((item) => item.id === record.taskId);
  return `
    <article class="business-card">
      <div class="file-card-head"><span>${escapeHtml(record.category || "Photo")}</span><strong>${escapeHtml(formatTime(record.createdAt))}</strong></div>
      ${record.photoDataUrl ? `<img src="${escapeHtml(record.photoDataUrl)}" alt="${escapeHtml(record.photoRef || record.room || "Job photo")}" style="width:100%;max-height:160px;object-fit:cover;border-radius:8px;" />` : ""}
      <h3>${escapeHtml(record.jobId)} ${escapeHtml(record.room || "")}</h3>
      <p>${escapeHtml(record.notes || record.photoRef || "Photo evidence saved")}</p>
      <dl>
        <div><dt>Worker</dt><dd>${escapeHtml(record.workerName || "Field")}</dd></div>
        <div><dt>Task</dt><dd>${escapeHtml(task?.title || "No task selected")}</dd></div>
        <div><dt>Reference</dt><dd>${escapeHtml(record.photoRef || "Uploaded image")}</dd></div>
      </dl>
    </article>
  `;
}

function renderRelationshipModule(module) {
  const needsResponse = state.contacts.filter((contact) => contact.status === "Needs response").length;
  return `
    <section class="hero-band relationships-hero">
      <div>
        <p>${escapeHtml(module.purpose)}</p>
        <div class="hero-actions">
          <button type="button" data-action="open-create-file" data-key="relationships">Manual contact file</button>
          <a href="#module/properties" data-action="set-active" data-key="properties">Open properties</a>
          <a href="#module/communications" data-action="set-active" data-key="communications">Open communications</a>
        </div>
      </div>
      <div class="metric-strip">
        <div><strong>${state.contacts.length}</strong><span>Contacts</span></div>
        <div><strong>${needsResponse}</strong><span>Need response</span></div>
        <div><strong>${new Set(state.contacts.map((contact) => contact.organization)).size}</strong><span>Organizations</span></div>
      </div>
    </section>
    <section class="relationship-layout">
      <div class="panel">
        <div class="panel-head">
          <div><h2>Relationship map</h2><p>Decision makers, access contacts, claim reviewers, and linked parties.</p></div>
        </div>
        ${renderContactMap()}
      </div>
      <div class="panel">
        <div class="panel-head">
          <div><h2>Add contact</h2><p>Track roles, next action, communication, and relationship context.</p></div>
        </div>
        ${renderContactForm()}
      </div>
    </section>
    <section class="panel">
      <div class="panel-head">
        <div><h2>Contact tracker</h2><p>Communication log and relationship details.</p></div>
        <div class="workflow-links">${renderLinkedModuleChips(["properties", "jobs", "communications", "payments"])}</div>
      </div>
      <div class="contact-grid">
        ${state.contacts.map(renderContactCard).join("")}
      </div>
    </section>
    ${renderModuleFiles(module)}
    ${renderFileDetail(module)}
  `;
}

function renderContactMap() {
  const positions = [
    { left: 44, top: 9 },
    { left: 12, top: 38 },
    { left: 66, top: 36 },
    { left: 30, top: 68 },
    { left: 72, top: 70 },
    { left: 48, top: 48 }
  ];
  return `
    <div class="contact-map">
      <div class="map-hub">Job</div>
      ${state.contacts
        .slice(0, 6)
        .map((contact, index) => {
          const position = positions[index % positions.length];
          return `
            <article class="contact-node" style="left:${position.left}%; top:${position.top}%;">
              <strong>${escapeHtml(contact.name)}</strong>
              <span>${escapeHtml(contact.role)}</span>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderContactForm() {
  return `
    <form class="stack-form" data-form="contact-record">
      <div class="form-grid">
        <label><span>Name</span><input name="name" required placeholder="Full name" /></label>
        <label><span>Role</span><input name="role" placeholder="Owner, tenant, adjuster, broker" /></label>
        <label><span>Organization</span><input name="organization" placeholder="Company or household" /></label>
        <label><span>Status</span><select name="status"><option>Active</option><option>Needs response</option><option>Waiting</option><option>Inactive</option></select></label>
        <label><span>Phone</span><input name="phone" placeholder="Phone" /></label>
        <label><span>Email</span><input name="email" type="email" placeholder="Email" /></label>
        <label><span>Property / job</span><input name="property" placeholder="Address, unit, job" /></label>
        <label><span>Relationship</span><input name="relationship" placeholder="Decision maker, site access, claim reviewer" /></label>
      </div>
      <label><span>Next action</span><textarea name="nextAction" rows="2" placeholder="Call, send packet, collect approval, schedule access"></textarea></label>
      <label><span>Notes</span><textarea name="notes" rows="2"></textarea></label>
      <button type="submit">Add contact</button>
    </form>
  `;
}

function renderContactCard(contact) {
  const linked = (contact.linkedIds || []).map((id) => state.contacts.find((item) => item.id === id)).filter(Boolean);
  return `
    <article class="contact-card">
      <div class="file-card-head">
        <span>${escapeHtml(contact.role)}</span>
        <strong>${escapeHtml(contact.status)}</strong>
      </div>
      <h3>${escapeHtml(contact.name)}</h3>
      <p>${escapeHtml(contact.organization)} - ${escapeHtml(contact.property)}</p>
      <dl>
        <div><dt>Phone</dt><dd>${escapeHtml(contact.phone || "None")}</dd></div>
        <div><dt>Email</dt><dd>${escapeHtml(contact.email || "None")}</dd></div>
        <div><dt>Last touch</dt><dd>${escapeHtml(formatTime(contact.lastTouch))}</dd></div>
        <div><dt>Next</dt><dd>${escapeHtml(contact.nextAction || "None")}</dd></div>
      </dl>
      <div class="relation-chips">
        ${linked.map((item) => `<span>${escapeHtml(item.name)}</span>`).join("") || `<span>No linked contacts</span>`}
      </div>
      <div class="activity-list compact">
        ${(contact.history || []).slice(0, 3).map((entry) => `<div>${escapeHtml(entry)}</div>`).join("")}
      </div>
      <div class="card-actions">
        <button type="button" data-action="log-contact-touch" data-id="${contact.id}">Log touch</button>
        <button type="button" data-action="create-contact-file" data-id="${contact.id}">Create file</button>
      </div>
    </article>
  `;
}

function renderBranchesModule(module) {
  return `
    <section class="hero-band branch-hero">
      <div>
        <p>${escapeHtml(module.purpose)}</p>
        <div class="hero-actions">
          <button type="button" data-action="open-create-file" data-key="branches">Manual branch file</button>
          <a href="#module/licensing" data-action="set-active" data-key="licensing">Licensing</a>
          <a href="#module/moduletoggles" data-action="set-active" data-key="moduletoggles">Module toggles</a>
        </div>
      </div>
      <div class="metric-strip">
        <div><strong>${state.branches.length}</strong><span>Branches</span></div>
        <div><strong>${state.branches.reduce((sum, branch) => sum + (branch.modules || []).length, 0)}</strong><span>Module grants</span></div>
        <div><strong>${state.branches.filter((branch) => branch.status === "Active").length}</strong><span>Active</span></div>
      </div>
    </section>
    <section class="branch-layout">
      <div class="panel">
        <div class="panel-head">
          <div><h2>Branch access boxes</h2><p>Linked branches, access codes, territory, and module grants.</p></div>
        </div>
        <div class="branch-grid">
          ${state.branches.map(renderBranchCard).join("")}
        </div>
      </div>
      <div class="panel">
        <div class="panel-head">
          <div><h2>Add branch / access</h2><p>Create a controlled branch profile.</p></div>
        </div>
        ${renderBranchForm()}
      </div>
    </section>
    ${renderModuleFiles(module)}
    ${renderFileDetail(module)}
  `;
}

function branchModuleChoices() {
  return ["universalintake", "jobs", "dispatch", "routeplanner", "time", "fieldmobile", "equipment", "payments", "reports", "relationships"]
    .map(moduleByKey)
    .filter(Boolean);
}

function renderBranchCard(branch) {
  const linked = (branch.linkedBranchIds || []).map(branchById).filter(Boolean);
  return `
    <article class="branch-card">
      <div class="file-card-head">
        <span>${escapeHtml(branch.status)}</span>
        <strong>${escapeHtml(branch.accessCode)}</strong>
      </div>
      <h3>${escapeHtml(branch.name)}</h3>
      <p>${escapeHtml(branch.territory)} - ${escapeHtml(branch.manager)}</p>
      <div class="linked-box">
        <h4>Linked branches</h4>
        <div class="relation-chips">${linked.map((item) => `<span>${escapeHtml(item.name)}</span>`).join("") || `<span>None</span>`}</div>
      </div>
      <div class="module-toggle-grid">
        ${branchModuleChoices()
          .map((module) => {
            const active = (branch.modules || []).includes(module.key);
            return `<button type="button" class="${active ? "active" : ""}" data-action="toggle-branch-module" data-id="${branch.id}" data-key="${module.key}">${escapeHtml(module.label)}</button>`;
          })
          .join("")}
      </div>
      <div class="card-actions">
        <button type="button" data-action="copy-branch-code" data-id="${branch.id}">Copy code</button>
        <button type="button" data-action="create-branch-file" data-id="${branch.id}">Create file</button>
      </div>
    </article>
  `;
}

function renderBranchForm() {
  return `
    <form class="stack-form" data-form="branch-record">
      <div class="form-grid">
        <label><span>Name</span><input name="name" required placeholder="Branch or access group" /></label>
        <label><span>Access code</span><input name="accessCode" placeholder="PIT-OPS-26" /></label>
        <label><span>Territory</span><input name="territory" placeholder="County, city, route, overflow" /></label>
        <label><span>Manager</span><input name="manager" placeholder="Manager or lead" /></label>
        <label><span>Status</span><select name="status"><option>Active</option><option>Limited access</option><option>Paused</option></select></label>
      </div>
      <fieldset class="source-picker">
        <legend>Module grants</legend>
        ${branchModuleChoices()
          .map((module) => `<label class="source-check"><input type="checkbox" name="modules" value="${module.key}" ${["jobs", "time", "dispatch"].includes(module.key) ? "checked" : ""} /><span><strong>${escapeHtml(module.label)}</strong><small>${escapeHtml(categoryLabels[module.category] || module.category)}</small></span></label>`)
          .join("")}
      </fieldset>
      <label><span>Notes</span><textarea name="notes" rows="3"></textarea></label>
      <button type="submit">Add branch</button>
    </form>
  `;
}

function renderPriceBookModule(module) {
  const subtotal = estimateSubtotal();
  const cost = estimateLines().reduce((sum, line) => sum + estimateLineCost(line), 0);
  const margin = subtotal ? Math.round(((subtotal - cost) / subtotal) * 100) : 0;
  const activeItems = activePriceItems();
  return `
    <section class="hero-band pricing-hero">
      <div>
        <p>${escapeHtml(module.purpose)}</p>
        <div class="hero-actions">
          <button type="button" data-action="download-estimate">Download estimate</button>
          <button type="button" data-action="create-estimate-invoice">Create invoice</button>
          <a href="#module/payments" data-action="set-active" data-key="payments">Open payments</a>
        </div>
      </div>
      <div class="metric-strip">
        <div><strong>${activeItems.length}</strong><span>Active prices</span></div>
        <div><strong>${escapeHtml(formatMoney(subtotal))}</strong><span>Estimate total</span></div>
        <div><strong>${state.priceItems.length}</strong><span>History rows</span></div>
      </div>
    </section>
    ${renderXactimateImportWorkstation()}
    <section class="pricebook-layout">
      <div class="panel">
        <div class="panel-head">
          <div><h2>Price book</h2><p>Upload, create, and maintain branch-ready pricing.</p></div>
          <div class="upload-actions">
            <label class="upload-button">
              <input type="file" accept=".csv,text/csv" data-field="price-csv" />
              <span>Upload CSV</span>
            </label>
            <label class="upload-button">
              <input type="file" accept=".esx,.xml,.pdf,.txt,.csv" data-field="xactimate-import" multiple />
              <span>Upload ESX/PDF invoices</span>
            </label>
          </div>
        </div>
        ${renderXactimateImportSummary()}
        ${renderPriceItemTable()}
        ${renderPriceItemForm()}
      </div>
      <div class="panel estimate-panel">
        <div class="panel-head">
          <div><h2>Estimate builder</h2><p>Build a branded estimate and send it to invoice/payment flow.</p></div>
          <label class="upload-button">
            <input type="file" accept="image/*" data-field="estimate-logo" />
            <span>Upload logo</span>
          </label>
        </div>
        ${renderEstimateSettingsForm()}
        ${renderEstimatePreview()}
      </div>
    </section>
    ${renderModuleFiles(module)}
    ${renderFileDetail(module)}
  `;
}

function renderXactimateImportWorkstation() {
  return `
    <section class="xactimate-workstation">
      <div>
        <span>Primary upload area</span>
        <h2>Upload Xactimate invoice / estimate pricing</h2>
        <p>Drop in one file or a batch of ESX packages, PDF invoices, XML, CSV, or text line-item exports. Readable line items are added to the price book under <strong>Xactimate pricing</strong>.</p>
      </div>
      <label class="xactimate-dropzone">
        <input type="file" accept=".esx,.xml,.pdf,.txt,.csv" data-field="xactimate-import" multiple />
        <strong>Choose ESX / PDF / invoice files</strong>
        <span>Use this for one estimate or a whole folder selection of ESX, PDF, XML, CSV, or text exports.</span>
      </label>
      <div class="pricing-policy">
        <strong>Pricing rule</strong>
        <span>For matching line items, Brothers OS uses the highest known rate. If rates tie, the latest pricing date/import wins. Older lower estimates stay in history and cannot lower the active price.</span>
      </div>
      <form class="pasted-pricing-import" data-form="pasted-pricing-import">
        <div>
          <strong>Paste pricing lines</strong>
          <span>Use CSV headers or Xactimate-style text when file upload is not available.</span>
        </div>
        <label><span>Source name</span><input name="sourceName" value="Manual pricing import ${escapeHtml(today.toISOString().slice(0, 10))}" /></label>
        <label><span>CSV, text, or Xactimate lines</span><textarea name="importText" rows="4" placeholder="Code,Description,Category,Unit,Rate,Cost&#10;WTR.LAB,Water mitigation labor,Labor,HR,85,42"></textarea></label>
        <div class="pricing-import-actions">
          <button type="submit">Import pasted pricing</button>
          <button type="button" data-action="import-sample-pricing">Load sample pricing</button>
        </div>
      </form>
    </section>
  `;
}

function renderXactimateImportSummary() {
  const activeXact = activePriceItems().filter((item) => item.category === "Xactimate pricing").length;
  return `
    <div class="xactimate-imports">
      <div><strong>${activeXact}</strong><span>Active Xactimate lines</span></div>
      <div><strong>${state.xactimateImports.length}</strong><span>Imports</span></div>
      <div><strong>${escapeHtml(formatMoney(state.xactimateImports.reduce((sum, item) => sum + Number(item.total || 0), 0)))}</strong><span>Imported total</span></div>
      ${state.xactimateImports.slice(0, 3).map((item) => `<div><strong>${escapeHtml(item.fileName)}</strong><span>${escapeHtml(item.status)} - ${item.lineCount} lines</span></div>`).join("")}
    </div>
  `;
}

function renderPriceItemTable() {
  applyHighestPricingPolicy();
  const sortedItems = [...state.priceItems].sort((a, b) => Number(b.activePrice === true) - Number(a.activePrice === true) || String(a.code).localeCompare(String(b.code)));
  return `
    <div class="price-table-wrap">
      <table class="data-table price-table">
        <thead><tr><th>Status</th><th>Code</th><th>Item</th><th>Unit</th><th>Rate</th><th>Source/date</th><th>History</th></tr></thead>
        <tbody>
          ${
            sortedItems.length
              ? sortedItems
                  .map((item) => {
                    const status = item.activePrice === false ? "History only" : "Active highest";
                    return `<tr class="${item.activePrice === false ? "price-history-row" : "price-active-row"}"><td><strong>${escapeHtml(status)}</strong></td><td>${escapeHtml(item.code)}</td><td><strong>${escapeHtml(item.name)}</strong><br /><span>${escapeHtml(item.justification || item.category)}</span></td><td>${escapeHtml(item.unit)}</td><td><strong>${escapeHtml(formatMoney(item.rate))}</strong><br /><span>Active ${escapeHtml(formatMoney(item.highestKnownRate || item.rate))}</span></td><td>${escapeHtml(item.sourceFile || item.branch || "Manual")}<br /><span>${escapeHtml(item.latestKnownPricingDate || item.pricingDate || "No date")}</span></td><td>${escapeHtml(`${item.priceHistoryCount || 1} record${Number(item.priceHistoryCount || 1) === 1 ? "" : "s"}`)}</td></tr>`;
                  })
                  .join("")
              : `<tr><td colspan="7"><div class="empty-state compact-empty"><strong>No price rows yet</strong><span>Import pricing, load sample pricing, or add a manual price item to start an estimate.</span></div></td></tr>`
          }
        </tbody>
      </table>
    </div>
  `;
}

function renderPriceItemForm() {
  return `
    <form class="stack-form inline-section" data-form="price-item">
      <h3>Add price item</h3>
      <div class="form-grid">
        <label><span>Code</span><input name="code" placeholder="WTR-LABOR" /></label>
        <label><span>Name</span><input name="name" required placeholder="Labor, equipment, material, admin" /></label>
        <label><span>Category</span><input name="category" placeholder="Labor, equipment, material" /></label>
        <label><span>Unit</span><input name="unit" placeholder="hour, day, each, sf" /></label>
        <label><span>Rate</span><input name="rate" type="number" step="0.01" required placeholder="0.00" /></label>
        <label><span>Cost</span><input name="cost" type="number" step="0.01" placeholder="0.00" /></label>
        <label><span>Branch</span><input name="branch" placeholder="All branches" /></label>
      </div>
      <label><span>Justification text</span><textarea name="justification" rows="2" placeholder="Why this charge exists and what support should be attached"></textarea></label>
      <button type="submit">Add price item</button>
    </form>
  `;
}

function renderEstimateSettingsForm() {
  return `
    <form class="stack-form" data-form="estimate-settings">
      <div class="estimate-brand-row">
        ${state.estimateDraft.logoDataUrl ? `<img src="${state.estimateDraft.logoDataUrl}" alt="Logo preview" />` : renderBrandLogo("estimate-brand-logo", "Brothers logo")}
        <div>
          <strong>${escapeHtml(state.estimateDraft.estimateNo)}</strong>
          <span>${escapeHtml(state.estimateDraft.customer)}</span>
        </div>
      </div>
      <div class="form-grid">
        <label><span>Estimate number</span><input name="estimateNo" value="${escapeHtml(state.estimateDraft.estimateNo)}" /></label>
        <label><span>Customer</span><input name="customer" value="${escapeHtml(state.estimateDraft.customer)}" /></label>
        <label><span>Job</span><input name="job" value="${escapeHtml(state.estimateDraft.job)}" /></label>
        <label><span>Branch</span><input name="branch" value="${escapeHtml(state.estimateDraft.branch)}" /></label>
        <label><span>Prepared by</span><input name="preparedBy" value="${escapeHtml(state.estimateDraft.preparedBy)}" /></label>
      </div>
      <label><span>Terms</span><textarea name="terms" rows="2">${escapeHtml(state.estimateDraft.terms)}</textarea></label>
      <button type="submit">Save estimate settings</button>
    </form>
  `;
}

function renderEstimatePreview() {
  const lines = estimateLines();
  const prices = activePriceItems();
  return `
    <div class="estimate-preview">
      <div class="estimate-head">
        <div>
          <span>Estimate</span>
          <h3>${escapeHtml(state.estimateDraft.estimateNo)}</h3>
          <p>${escapeHtml(state.estimateDraft.customer)} - ${escapeHtml(state.estimateDraft.job)}</p>
        </div>
        <strong>${escapeHtml(formatMoney(estimateSubtotal()))}</strong>
      </div>
      <form class="estimate-line-form" data-form="estimate-line">
        <label><span>Price item</span><select name="priceItemId" ${prices.length ? "" : "disabled"}>${prices.length ? prices.map((item) => `<option value="${item.id}">${escapeHtml(item.code)} - ${escapeHtml(item.name)} (${escapeHtml(formatMoney(item.highestKnownRate || item.rate))}/${escapeHtml(item.unit)})</option>`).join("") : `<option>No active price items</option>`}</select></label>
        <label><span>Qty</span><input name="qty" type="number" step="0.01" value="1" /></label>
        <label><span>Line note</span><input name="note" placeholder="Room, reason, photo, support" /></label>
        <button type="submit" ${prices.length ? "" : "disabled"}>Add line</button>
      </form>
      <div class="estimate-lines">
        ${
          lines.length
            ? lines
                .map(
                  (line) => `
                    <div class="estimate-line">
                      <div>
                        <strong>${escapeHtml(line.item.name)}</strong>
                        <span>${escapeHtml(line.item.code)} - ${escapeHtml(line.qty)} ${escapeHtml(line.item.unit)} x ${escapeHtml(formatMoney(line.item.rate))}</span>
                        ${line.note ? `<small>${escapeHtml(line.note)}</small>` : ""}
                      </div>
                      <div>
                        <strong>${escapeHtml(formatMoney(estimateLineTotal(line)))}</strong>
                        <button type="button" data-action="remove-estimate-line" data-id="${line.id}">Remove</button>
                      </div>
                    </div>
                  `
                )
                .join("")
            : `<div class="empty-state"><strong>No estimate lines</strong><span>Add a line from the price book.</span></div>`
        }
      </div>
      <div class="estimate-actions">
        <button type="button" data-action="download-estimate">Download estimate</button>
        <button type="button" data-action="create-estimate-invoice">Create invoice file</button>
      </div>
    </div>
  `;
}

function contractorPortalChecklist() {
  return [
    ["Job acceptance", "Confirm assignment, arrival window, contact, and site access before dispatch."],
    ["Photo proof", "Upload before, during, and completion photos tied to the room or work order."],
    ["Time and equipment", "Log labor, equipment placement, pickup, and billable support on the same day."],
    ["Invoice support", "Attach invoice notes, quantities, materials, and any change-order approvals."],
    ["Closeout", "Confirm cleanup, customer communication, open items, and final documentation."]
  ];
}

function renderContractorPortalModule(module) {
  const jobs = visibleJobBoards();
  const tasks = visibleTasks();
  const invoices = contractorInvoices();
  const posts = state.communityPosts || [];
  const openTasks = tasks.filter((task) => task.status !== "Complete");
  const unpaidInvoices = invoices.filter((invoice) => !/paid|closed|complete/i.test(String(invoice.status || "")));
  const accessLabel = state.authSession?.accessExpiresAt ? `Access expires ${formatTime(state.authSession.accessExpiresAt)}` : "Secure Google session required";
  return `
    <section class="hero-band">
      <div>
        <span class="hero-eyebrow">Contractor command center</span>
        <h2>${escapeHtml(module.label)}</h2>
        <p>Fast access to assigned jobs, invoice status, field documentation, equipment handoffs, and the contractor discussion board.</p>
        <div class="hero-actions">
          <a href="#module/jobs" data-action="set-active" data-key="jobs">Assigned jobs</a>
          <a href="#module/payments" data-action="set-active" data-key="payments">Invoices</a>
          <a href="#module/communications" data-action="set-active" data-key="communications">Discussion board</a>
          <a href="#module/time" data-action="set-active" data-key="time">Time</a>
          <a href="#module/equipment" data-action="set-active" data-key="equipment">Equipment</a>
        </div>
      </div>
      <div class="metric-strip">
        <div><strong>${jobs.length}</strong><span>Assigned jobs</span></div>
        <div><strong>${openTasks.length}</strong><span>Open tasks</span></div>
        <div><strong>${escapeHtml(formatMoney(sumRecords(invoices, "amount")))}</strong><span>Invoice value</span></div>
        <div><strong>${posts.length}</strong><span>Board posts</span></div>
      </div>
    </section>
    <section class="panel">
      <div class="panel-head">
        <div>
          <h2>Contractor status</h2>
          <p>${escapeHtml(accessLabel)}. Use the fast actions below to move from assignment to documentation to payment.</p>
        </div>
      </div>
      <div class="access-map-grid">
        <article><span>Identity</span><h3>${escapeHtml(state.authSession?.email || currentUserName() || "Not signed in")}</h3><p>${escapeHtml(currentContractorId() || "Contractor id appears after invite acceptance.")}</p></article>
        <article><span>Priority</span><h3>${openTasks[0] ? escapeHtml(openTasks[0].title) : "No open priority"}</h3><p>${escapeHtml(openTasks[0]?.relatedJob || "Open tasks will appear here as they are assigned.")}</p></article>
        <article><span>Invoice follow-up</span><h3>${unpaidInvoices.length}</h3><p>${unpaidInvoices.length ? "Open contractor invoices need review or payment status." : "No open contractor invoice issues."}</p></article>
      </div>
    </section>
    <section class="panel">
      <div class="panel-head">
        <div><h2>Fast action dock</h2><p>One-click routes for the highest-frequency contractor workflow.</p></div>
      </div>
      <div class="quick-grid">
        ${[
          ["jobs", "Review assigned jobs", `${jobs.length} active`],
          ["drylogs", "Add dry log support", "Readings and photos"],
          ["equipment", "Update equipment", "Placement and pickup"],
          ["time", "Log labor time", `${visibleTimeEntries().length} entries`],
          ["payments", "Check invoices", `${invoices.length} records`],
          ["communications", "Ask the board", `${posts.length} posts`]
        ].map(([key, label, detail]) => `
          <button type="button" class="quick-button" data-action="set-active" data-key="${key}">
            <span>${escapeHtml(label)}</span>
            <small>${escapeHtml(detail)}</small>
          </button>
        `).join("")}
      </div>
    </section>
    <section class="team-layout">
      <div class="panel">
        <div class="panel-head"><div><h2>Assigned work</h2><p>Jobs and tasks available to this contractor profile.</p></div></div>
        <div class="task-list">
          ${jobs.length ? jobs.slice(0, 6).map(renderContractorPortalJob).join("") : `<div class="empty-state"><strong>No assigned jobs</strong><span>Jobs appear here after the Super Admin or dispatcher assigns them to this contractor.</span></div>`}
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><div><h2>Documentation checklist</h2><p>Keep every invoice support package clean and defensible.</p></div></div>
        <div class="activity-list">
          ${contractorPortalChecklist().map(([title, body]) => `<div><strong>${escapeHtml(title)}</strong><span>${escapeHtml(body)}</span></div>`).join("")}
        </div>
      </div>
    </section>
    <section class="team-layout">
      <div class="panel">
        <div class="panel-head"><div><h2>Contractor invoices</h2><p>Scoped invoices returned by the secure business-data model.</p></div></div>
        ${invoices.length ? `<div class="business-record-grid">${invoices.slice(0, 6).map(renderContractorInvoiceCard).join("")}</div>` : `<div class="empty-state"><strong>No contractor invoices visible</strong><span>Invoice records appear after they are assigned to this contractor profile.</span></div>`}
      </div>
      <div class="panel">
        <div class="panel-head"><div><h2>Board activity</h2><p>Recent questions and coordination notes from approved users.</p></div></div>
        <div class="community-feed">
          ${posts.length ? posts.slice(0, 3).map(renderCommunityPost).join("") : `<div class="empty-state"><strong>No board activity yet</strong><span>Use the communication board to ask job, invoice, or field questions.</span></div>`}
        </div>
      </div>
    </section>
    ${renderModuleFiles(module)}
    ${renderFileDetail(module)}
  `;
}

function renderContractorPortalJob(job) {
  const completion = jobGateCompletion(job);
  return `
    <div class="task-item">
      <div>
        <strong>${escapeHtml(job.jobId || job.title)}</strong>
        <span>${escapeHtml(job.title || "")} - ${escapeHtml(job.stage || "Open")}</span>
        <small>${escapeHtml(job.property || job.customer || "No property listed")}</small>
      </div>
      <div class="row-actions">
        <span>${completion}% complete</span>
        <button type="button" data-action="set-active" data-key="jobs">Open</button>
      </div>
    </div>
  `;
}

function accessStatusItems() {
  const role = currentRoleId() || "not signed in";
  const ttlLabel = state.firebase.sessionTtlHours ? `${state.firebase.sessionTtlHours} hours` : "48 hours";
  const googleConfigured = state.firebase.enabled ? "Ready" : "Needs Firebase env";
  const globalAccess = canDo("viewGlobalIndexes") ? "Super Admin access" : "Restricted";
  return [
    ["Google login", googleConfigured, state.firebase.enabled ? "Google account sign-in and verified email are enforced by the server." : "Set the Firebase web/admin env vars in Vercel to activate the login screen."],
    ["Session window", ttlLabel, "Access grants and session cookies are capped at 48 hours."],
    ["Current role", role.replace(/_/g, " "), state.authSession?.email || "No secure Firebase session is active in this browser."],
    ["Global indexes", globalAccess, canDo("viewGlobalIndexes") ? "You can see platform standards, source vaults, and admin-only indexes." : "Only Super Admin can see platform-wide indexes."]
  ];
}

function renderAccessStatusPanel() {
  const missingAdmin = (state.firebase.missingAdminEnv || []).join(", ");
  const missingWeb = (state.firebase.missingWebEnv || []).join(", ");
  return `
    <section class="panel access-status-panel">
      <div class="panel-head">
        <div>
          <h2>Login and access status</h2>
          <p>Use this panel to verify whether Google login, contractor codes, 48-hour access, and Super Admin-only indexes are active.</p>
        </div>
        <div class="row-actions">
          ${state.authSession ? `<button type="button" data-action="firebase-logout">Sign out</button>` : state.firebase.enabled ? `<button type="button" data-action="firebase-google-login">Sign in with Google</button>` : `<a href="#module/settings" data-action="set-active" data-key="settings">Configure Firebase</a>`}
        </div>
      </div>
      ${!state.firebase.enabled ? `
        <div class="empty-state warning-state">
          <strong>Google login is not active in this deployment yet</strong>
          <span>Missing admin env: ${escapeHtml(missingAdmin || "none reported")} | Missing web env: ${escapeHtml(missingWeb || "none reported")}</span>
        </div>
      ` : ""}
      <div class="access-status-grid">
        ${accessStatusItems().map(([label, value, detail]) => `
          <article class="access-status-card">
            <span>${escapeHtml(label)}</span>
            <strong>${escapeHtml(value)}</strong>
            <p>${escapeHtml(detail)}</p>
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

function moduleNames(keys) {
  return keys
    .map((key) => tabConfigByKey(key)?.label || moduleByKey(key)?.label || key)
    .filter(Boolean)
    .join(", ");
}

function currentAccessModuleKeys() {
  if (state.employeeMode) return employeeModuleKeys();
  if (state.accessContext?.tabs?.length) return state.accessContext.tabs.map((tab) => tab.key || tab.id).filter((key) => moduleByKey(key));
  return filteredModules().map((module) => module.key);
}

function renderAccessModuleMap() {
  const currentKeys = currentAccessModuleKeys();
  const contractorKeys = ["contractorportal", "daily", "jobs", "time", "equipment", "payments", "communications", "settings"];
  const superAdminKeys = ["daily", "accessadmin", "launchcenter", "globalindexes", "team", "payments", "accounting", "communications", "auditlog", "datamodel", "securitycenter"];
  return `
    <section class="panel">
      <div class="panel-head">
        <div>
          <h2>Module visibility map</h2>
          <p>This shows which workspace areas are intended for you, contractors, and Super Admin only.</p>
        </div>
      </div>
      <div class="access-map-grid">
        <article>
          <span>Your current visible modules</span>
          <h3>${currentKeys.length}</h3>
          <p>${escapeHtml(moduleNames(currentKeys) || "Sign in to load your role-scoped modules.")}</p>
        </article>
        <article>
          <span>Contractor portal</span>
          <h3>Code gated</h3>
          <p>${escapeHtml(moduleNames(contractorKeys))}</p>
        </article>
        <article>
          <span>Super Admin only</span>
          <h3>Owner locked</h3>
          <p>${escapeHtml(moduleNames(superAdminKeys))}</p>
        </article>
      </div>
    </section>
  `;
}

function renderAdminLockedPanel() {
  const role = currentRoleId() || "not signed in";
  return `
    <section class="panel locked-access-panel">
      <div class="panel-head">
        <div>
          <h2>Super Admin controls locked</h2>
          <p>Contractor codes, access links, managed Firebase users, role permissions, and audit logs only appear after signing in as a Super Admin.</p>
        </div>
      </div>
      <div class="access-map-grid">
        <article>
          <span>Current role</span>
          <h3>${escapeHtml(role.replace(/_/g, " "))}</h3>
          <p>${state.authSession ? escapeHtml(state.authSession.email || "") : "No secure Google session is active."}</p>
        </article>
        <article>
          <span>Required role</span>
          <h3>super_admin</h3>
          <p>Set FIREBASE_ALLOWED_LOGIN_EMAILS and SUPER_ADMIN_EMAILS to david@brothersrestoration.org in Vercel before opening the hosted OS.</p>
        </article>
        <article>
          <span>Code issuing</span>
          <h3>${canDo("manageAccessGrants") ? "Allowed" : "Blocked"}</h3>
          <p>Only users with manageAccessGrants and issueContractorCodes can send 48-hour links and portal codes.</p>
        </article>
      </div>
    </section>
  `;
}

function getLaunchCenterItems() {
  const host = typeof window !== "undefined" ? window.location.hostname : "";
  const isBrothersDomain = host === "brothers.ad" || host === "www.brothers.ad";
  const missingAdmin = state.firebase.missingAdminEnv || [];
  const missingWeb = state.firebase.missingWebEnv || [];
  return [
    {
      label: "Domain route",
      status: isBrothersDomain ? "Live domain" : "Ready for brothers.ad",
      tone: isBrothersDomain ? "ready" : "pending",
      detail: isBrothersDomain
        ? "This browser is on the production domain."
        : "Code defaults public OS URLs to https://brothers.ad. Attach the domain in Vercel and redeploy."
    },
    {
      label: "DNS",
      status: "Pointed to Vercel",
      tone: "ready",
      detail: "Apex should use A 76.76.21.21 and www should use Vercel DNS. The latest local check matched that pattern."
    },
    {
      label: "Firebase Web",
      status: state.firebase.webConfigured ? "Ready" : "Missing config",
      tone: state.firebase.webConfigured ? "ready" : "blocked",
      detail: missingWeb.length ? `Missing: ${missingWeb.join(", ")}` : "brothers-restoration-website web config is present."
    },
    {
      label: "Firebase Admin",
      status: state.firebase.adminConfigured ? "Ready" : "Needs private credential",
      tone: state.firebase.adminConfigured ? "ready" : "blocked",
      detail: missingAdmin.length ? `Missing: ${missingAdmin.join(", ")}` : `Credential source: ${state.firebase.adminCredentialSource || "configured"}`
    },
    {
      label: "Google login",
      status: state.firebase.enabled ? "Unlock ready" : "Locked",
      tone: state.firebase.enabled ? "ready" : "blocked",
      detail: state.firebase.enabled
        ? "Google sign-in can verify users and role-gated modules."
        : "Add Firebase Admin credentials in Vercel before customer data, invoices, and global indexes can unlock."
    },
    {
      label: "Authorized domains",
      status: "Manual check",
      tone: "pending",
      detail: "Firebase Authentication must include brothers.ad and www.brothers.ad under Authorized domains."
    }
  ];
}

function renderLaunchCenterModule(module) {
  if (state.authSession && !canDo("viewGlobalIndexes")) {
    return `
      <section class="hero-band">
        <div>
          <span class="hero-eyebrow">Launch restricted</span>
          <h2>${escapeHtml(module.label)}</h2>
          <p>Production launch controls are restricted to Super Admin so contractors and workers cannot see global setup details.</p>
          <div class="hero-actions">
            <a href="#module/accessadmin" data-action="set-active" data-key="accessadmin">Check access</a>
            <a href="#module/contractorportal" data-action="set-active" data-key="contractorportal">Contractor Portal</a>
          </div>
        </div>
        <div class="metric-strip">
          <div><strong>Locked</strong><span>Launch controls</span></div>
          <div><strong>${escapeHtml(currentRoleId() || "none")}</strong><span>Current role</span></div>
          <div><strong>Super Admin</strong><span>Required</span></div>
        </div>
      </section>
      ${renderAdminLockedPanel()}
    `;
  }

  const items = getLaunchCenterItems();
  const readyCount = items.filter((item) => item.tone === "ready").length;
  const blockedCount = items.filter((item) => item.tone === "blocked").length;
  return `
    <section class="hero-band launch-hero">
      <div>
        <span class="hero-eyebrow">Production launch</span>
        <h2>${escapeHtml(module.label)}</h2>
        <p>Track the brothers.ad deployment, Firebase login gate, Vercel production settings, and final smoke tests from inside the OS.</p>
        <div class="hero-actions">
          <button type="button" data-action="copy-launch-env">Copy Vercel env</button>
          <a href="#module/accessadmin" data-action="set-active" data-key="accessadmin">Admin Access</a>
          <a href="#module/securitycenter" data-action="set-active" data-key="securitycenter">Security Center</a>
        </div>
      </div>
      <div class="metric-strip">
        <div><strong>${readyCount}</strong><span>Ready checks</span></div>
        <div><strong>${blockedCount}</strong><span>Blocked checks</span></div>
        <div><strong>brothers.ad</strong><span>Target domain</span></div>
      </div>
    </section>
    <section class="panel launch-board">
      <div class="panel-head">
        <div>
          <h2>Launch readiness</h2>
          <p>Use this board before every production redeploy. Blocked checks should be resolved before sharing the domain.</p>
        </div>
        <div class="row-actions">
          <a href="https://brothers.ad" target="_blank" rel="noreferrer">Open brothers.ad</a>
          <a href="/api/auth/config" target="_blank" rel="noreferrer">Auth config</a>
        </div>
      </div>
      <div class="launch-check-grid">
        ${items.map((item) => `
          <article class="launch-check-card ${escapeHtml(item.tone)}">
            <span>${escapeHtml(item.label)}</span>
            <strong>${escapeHtml(item.status)}</strong>
            <p>${escapeHtml(item.detail)}</p>
          </article>
        `).join("")}
      </div>
    </section>
    <section class="panel launch-steps">
      <div class="panel-head">
        <div>
          <h2>Production sequence</h2>
          <p>Follow these steps in order when moving the OS onto the public domain.</p>
        </div>
      </div>
      <ol>
        <li><strong>Deploy latest code.</strong><span>Push or upload this build to the Vercel project that owns the current OS deployment.</span></li>
        <li><strong>Attach domains.</strong><span>Add brothers.ad and www.brothers.ad under Vercel Project Settings, then set brothers.ad as production.</span></li>
        <li><strong>Add private Firebase Admin credentials.</strong><span>Use FIREBASE_SERVICE_ACCOUNT_JSON, or FIREBASE_CLIENT_EMAIL plus FIREBASE_PRIVATE_KEY.</span></li>
        <li><strong>Authorize Google login.</strong><span>Add brothers.ad and www.brothers.ad in Firebase Authentication authorized domains.</span></li>
        <li><strong>Redeploy and smoke test.</strong><span>Open /api/auth/config, sign in with a Super Admin Google account, and confirm contractors cannot see global indexes.</span></li>
      </ol>
    </section>
    ${renderAccessStatusPanel()}
    ${renderModuleFiles(module)}
    ${renderFileDetail(module)}
  `;
}

function renderAccessAdminModule(module) {
  return `
    <section class="hero-band team-hero">
      <div>
        <span class="hero-eyebrow">Super Admin workspace</span>
        <h2>${escapeHtml(module.label)}</h2>
        <p>Manage Google login, contractor access codes, 48-hour trial grants, user roles, and admin-only visibility from one place.</p>
        <div class="hero-actions">
          ${state.firebase.enabled ? `<button type="button" data-action="firebase-google-login">Sign in with Google</button>` : `<a href="#module/settings" data-action="set-active" data-key="settings">Configure Firebase login</a>`}
          <a href="#module/launchcenter" data-action="set-active" data-key="launchcenter">Launch Center</a>
          <a href="#module/team" data-action="set-active" data-key="team">Team roles</a>
          <a href="#module/globalindexes" data-action="set-active" data-key="globalindexes">Global indexes</a>
          <a href="#module/communications" data-action="set-active" data-key="communications">Contractor board</a>
        </div>
      </div>
      <div class="metric-strip">
        <div><strong>${state.accessContext?.users?.length || 0}</strong><span>Managed users</span></div>
        <div><strong>${state.accessContext?.accessRequests?.length || 0}</strong><span>Access requests</span></div>
        <div><strong>${state.accessContext?.accessGrants?.length || 0}</strong><span>Recent grants</span></div>
      </div>
    </section>
    ${renderAccessStatusPanel()}
    ${renderAccessModuleMap()}
    ${renderRbacAdminPanel({ showLocked: true })}
    ${renderAccountSeparationPanel()}
    ${renderModuleFiles(module)}
    ${renderFileDetail(module)}
  `;
}

function renderGlobalIndexesModule(module) {
  if (state.authSession && !canDo("viewGlobalIndexes")) {
    return `
      <section class="hero-band">
        <div>
          <span class="hero-eyebrow">Restricted index</span>
          <h2>${escapeHtml(module.label)}</h2>
          <p>Platform-wide standards, skill packs, data vaults, and source indexes are visible only to Super Admin.</p>
          <div class="hero-actions">
            <a href="#module/accessadmin" data-action="set-active" data-key="accessadmin">Check access</a>
            <a href="#module/communications" data-action="set-active" data-key="communications">Open contractor board</a>
          </div>
        </div>
        <div class="metric-strip">
          <div><strong>Locked</strong><span>Your role</span></div>
          <div><strong>${escapeHtml(currentRoleId() || "none")}</strong><span>Current access</span></div>
          <div><strong>No</strong><span>Global indexes</span></div>
        </div>
      </section>
      ${renderAdminLockedPanel()}
      ${renderAccessModuleMap()}
    `;
  }
  return `
    <section class="hero-band">
      <div>
        <span class="hero-eyebrow">Super Admin only</span>
        <h2>${escapeHtml(module.label)}</h2>
        <p>Platform-wide standards sources, skill packs, data vaults, source checks, and indexed operating knowledge.</p>
        <div class="hero-actions">
          <a href="#module/accessadmin" data-action="set-active" data-key="accessadmin">Admin Access</a>
          <a href="#module/compliance" data-action="set-active" data-key="compliance">Compliance</a>
          <a href="#module/datamodel" data-action="set-active" data-key="datamodel">Data model</a>
        </div>
      </div>
      <div class="metric-strip">
        <div><strong>${state.skillPacks.length}</strong><span>Skill packs</span></div>
        <div><strong>${state.dataVaults.length}</strong><span>Data vaults</span></div>
        <div><strong>${standardsSources.length}</strong><span>Hard sources</span></div>
      </div>
    </section>
    ${!state.firebase.enabled ? `<section class="panel"><div class="empty-state warning-state"><strong>Local preview note</strong><span>This preview is visible only because Firebase auth is not configured locally. On Vercel, Super Admin RBAC hides this module from contractors and workers.</span></div></section>` : ""}
    ${renderSkillsAndDatabasePanel()}
    ${renderGlobalBusinessIndexPanel()}
    <section class="panel">
      <div class="panel-head">
        <div>
          <h2>Hard-source index</h2>
          <p>Source locations used by the platform for standards, code, safety, and defensibility workflows.</p>
        </div>
      </div>
      <div class="source-grid">
        ${standardsSources.map(renderStandardsSourceCard).join("")}
      </div>
    </section>
    ${renderModuleFiles(module)}
    ${renderFileDetail(module)}
  `;
}

function renderGlobalBusinessIndexPanel() {
  const customers = customerRecords();
  const invoices = revenueInvoices();
  const contractorBills = contractorInvoices();
  const allRecords = [...customers, ...invoices, ...contractorBills];
  const revenueTotal = sumRecords(invoices, "amount");
  const openBalance = sumRecords(invoices, "balance");
  const contractorTotal = sumRecords(contractorBills, "amount");
  const sourceLabel = state.firebase.adminConfigured
    ? "Server Firebase Admin"
    : allRecords.some((record) => record.source === "client-firestore")
      ? "Browser Firestore fallback"
      : allRecords.some((record) => record.source === "local-file")
        ? "Local operating files plus secured defaults"
      : "Secure default seed / role-scoped API";
  return `
    <section class="panel global-business-index">
      <div class="panel-head">
        <div>
          <h2>Global customer, revenue, and contractor invoice index</h2>
          <p>Super Admin-only financial visibility across customer accounts, receivables, revenue invoices, and contractor bills.</p>
        </div>
        <div class="row-actions">
          <a href="#module/payments" data-action="set-active" data-key="payments">Payments</a>
          <a href="#module/accounting" data-action="set-active" data-key="accounting">Accounting</a>
        </div>
      </div>
      <div class="metric-strip">
        <div><strong>${customers.length}</strong><span>Customers</span></div>
        <div><strong>${escapeHtml(formatMoney(revenueTotal))}</strong><span>Revenue invoices</span></div>
        <div><strong>${escapeHtml(formatMoney(openBalance))}</strong><span>Open balance</span></div>
        <div><strong>${escapeHtml(formatMoney(contractorTotal))}</strong><span>Contractor invoices</span></div>
      </div>
      ${!state.firebase.adminConfigured ? `<div class="empty-state warning-state"><strong>Persistent Admin storage still needs Firebase service-account credentials</strong><span>The index is visible to Super Admin now, and browser Firestore can read/write allowed records, but server-side invite validation and durable admin writes require FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY in Vercel.</span></div>` : ""}
      <div class="empty-state compact-empty"><strong>Data source</strong><span>${escapeHtml(sourceLabel)}</span></div>
      ${allRecords.length ? `
        <div class="business-record-grid">
          ${customers.map(renderCustomerRecordCard).join("")}
          ${invoices.map(renderRevenueInvoiceCard).join("")}
          ${contractorBills.map(renderContractorInvoiceCard).join("")}
        </div>
      ` : `<div class="empty-state"><strong>No business records available</strong><span>Customer, revenue, and contractor invoice records appear here after Firebase returns records for your role.</span></div>`}
    </section>
  `;
}

function renderCustomerRecordCard(customer) {
  return `
    <article class="business-record-card">
      <div class="file-card-head"><span>Customer</span><strong>${escapeHtml(customer.status || "Active")}</strong></div>
      <h3>${escapeHtml(customer.name || customer.customerId || customer.id)}</h3>
      <p>${escapeHtml(customer.email || customer.phone || "No contact on file")}</p>
      <dl>
        <div><dt>Revenue</dt><dd>${escapeHtml(formatMoney(customer.revenueTotal || 0))}</dd></div>
        <div><dt>Open</dt><dd>${escapeHtml(formatMoney(customer.openBalance || 0))}</dd></div>
        <div><dt>Contractor</dt><dd>${escapeHtml(customer.contractorId || "Unassigned")}</dd></div>
      </dl>
    </article>
  `;
}

function renderPaymentsModule(module) {
  const paymentFiles = filesForModule("payments");
  const invoices = revenueInvoices();
  const contractorBills = contractorInvoices();
  const totalDraftInvoices = paymentFiles.filter((file) => `${file.type} ${file.title}`.toLowerCase().includes("invoice")).length;
  return `
    <section class="hero-band payments-hero">
      <div>
        <p>${escapeHtml(module.purpose)}</p>
        <div class="hero-actions">
          <button type="button" data-action="open-create-file" data-key="payments">Manual payment file</button>
          <a href="#module/pricing" data-action="set-active" data-key="pricing">Build estimate</a>
          <a href="#module/accounting" data-action="set-active" data-key="accounting">Accounting</a>
        </div>
      </div>
      <div class="metric-strip">
        <div><strong>${escapeHtml(formatMoney(sumRecords(invoices, "amount")))}</strong><span>Revenue invoices</span></div>
        <div><strong>${escapeHtml(formatMoney(sumRecords(contractorBills, "amount")))}</strong><span>Contractor invoices</span></div>
        <div><strong>${totalDraftInvoices}</strong><span>Local invoice files</span></div>
        <div><strong>4</strong><span>Rails</span></div>
      </div>
    </section>
    <section class="payments-layout">
      <div class="panel">
        <div class="panel-head">
          <div><h2>Payment rail window</h2><p>Card, PayPal, Zelle, wire, and manual receipt records.</p></div>
        </div>
        <div class="payment-rail-grid">
          ${renderPaymentRail("Card", "/api/payments/stripe/intent", "Hosted card or debit payment intent")}
          ${renderPaymentRail("PayPal", "/api/payments/paypal/order", "PayPal order and capture")}
          ${renderPaymentRail("Zelle", "/api/payments/zelle/instructions", "Business Zelle instructions")}
          ${renderPaymentRail("Wire", "/api/payments/wire/instructions", "Verified wiring instructions")}
          ${renderPaymentRail("QuickBooks", "/api/integrations/quickbooks/oauth/start", "QuickBooks invoice and expense sync")}
          ${renderPaymentRail("Future rails", "gateway-ready", "ACH, Plaid, Square, Venmo, check, financing")}
        </div>
        ${renderPaymentRequestForm()}
      </div>
      <div class="panel">
        <div class="panel-head">
          <div><h2>Invoice/payment queue</h2><p>Payment requests and invoices created from estimates and equipment.</p></div>
        </div>
        ${renderBusinessInvoicePanels()}
        <div class="file-grid compact-grid">
          ${paymentFiles.length ? paymentFiles.slice(0, 6).map(renderFileCard).join("") : `<div class="empty-state"><strong>No payment files</strong><span>Create a request or invoice.</span></div>`}
        </div>
      </div>
    </section>
    ${renderModuleFiles(module)}
    ${renderFileDetail(module)}
  `;
}

function renderBusinessInvoicePanels() {
  const invoices = revenueInvoices();
  const contractorBills = contractorInvoices();
  if (!invoices.length && !contractorBills.length) {
    return `<div class="empty-state"><strong>No scoped invoice records</strong><span>Invoice records appear here after the backend returns customer, revenue, or contractor invoice data for your role.</span></div>`;
  }
  return `
    <div class="business-record-grid">
      ${invoices.map(renderRevenueInvoiceCard).join("")}
      ${contractorBills.map(renderContractorInvoiceCard).join("")}
    </div>
  `;
}

function renderRevenueInvoiceCard(invoice) {
  return `
    <article class="business-record-card">
      <div class="file-card-head"><span>Revenue invoice</span><strong>${escapeHtml(invoice.status || "Open")}</strong></div>
      <h3>${escapeHtml(invoice.invoiceId || invoice.id)}</h3>
      <p>${escapeHtml(invoice.customerName || invoice.customerId || "Customer")}</p>
      <dl>
        <div><dt>Amount</dt><dd>${escapeHtml(formatMoney(invoice.amount || 0))}</dd></div>
        <div><dt>Balance</dt><dd>${escapeHtml(formatMoney(invoice.balance || 0))}</dd></div>
        <div><dt>Job</dt><dd>${escapeHtml(invoice.jobId || "Unassigned")}</dd></div>
      </dl>
    </article>
  `;
}

function renderContractorInvoiceCard(invoice) {
  return `
    <article class="business-record-card">
      <div class="file-card-head"><span>Contractor invoice</span><strong>${escapeHtml(invoice.status || "Open")}</strong></div>
      <h3>${escapeHtml(invoice.invoiceId || invoice.id)}</h3>
      <p>${escapeHtml(invoice.contractorName || invoice.contractorEmail || invoice.contractorId || "Contractor")}</p>
      <dl>
        <div><dt>Amount</dt><dd>${escapeHtml(formatMoney(invoice.amount || 0))}</dd></div>
        <div><dt>Due</dt><dd>${escapeHtml(formatDate(invoice.dueDate))}</dd></div>
        <div><dt>Job</dt><dd>${escapeHtml(invoice.jobId || "Unassigned")}</dd></div>
      </dl>
    </article>
  `;
}

function renderPaymentRail(method, route, detail) {
  return `
    <article class="payment-rail">
      <span>${escapeHtml(route)}</span>
      <h3>${escapeHtml(method)}</h3>
      <p>${escapeHtml(detail)}</p>
      <button type="button" data-action="create-payment-rail" data-method="${escapeHtml(method)}" data-route="${escapeHtml(route)}" data-detail="${escapeHtml(detail)}">Create setup file</button>
    </article>
  `;
}

function renderPaymentRequestForm() {
  return `
    <form class="stack-form inline-section" data-form="payment-request">
      <h3>Create payment request</h3>
      <div class="form-grid">
        <label><span>Customer</span><input name="customer" required placeholder="Customer or company" /></label>
        <label><span>Job / invoice</span><input name="job" placeholder="J-2039, INV-2039" /></label>
        <label><span>Amount</span><input name="amount" type="number" step="0.01" required placeholder="0.00" /></label>
        <label><span>Method</span><select name="method"><option>Card</option><option>PayPal</option><option>Zelle</option><option>Wire</option></select></label>
        <label><span>Email / phone</span><input name="contact" placeholder="Recipient contact" /></label>
        <label><span>Due</span><input name="due" type="date" value="${today.toISOString().slice(0, 10)}" /></label>
      </div>
      <button type="submit">Create payment file</button>
    </form>
  `;
}

function renderCommunicationsModule(module) {
  const posts = [...(state.communityPosts || [])].sort((a, b) => String(b.pinned || "").localeCompare(String(a.pinned || "")) || new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  const canPost = !state.authSession || canDo("postCommunityMessages");
  return `
    ${renderManagedSection("communications-hero", `<section class="hero-band">
      <div>
        <span class="hero-eyebrow">Contractor communication board</span>
        <h2>${escapeHtml(module.label)}</h2>
        <p>Ask questions, share field notes, discuss invoices, coordinate job handoffs, and keep contractor conversations in one moderated board.</p>
        <div class="hero-actions">
          <button type="button" data-action="open-create-file" data-key="communications">Communication file</button>
          <a href="#module/team" data-action="set-active" data-key="team">Access controls</a>
        </div>
      </div>
      <div class="metric-strip">
        <div><strong>${posts.length}</strong><span>Posts</span></div>
        <div><strong>${posts.reduce((sum, post) => sum + (Array.isArray(post.comments) ? post.comments.length : 0), 0)}</strong><span>Comments</span></div>
        <div><strong>${state.authSession?.roleId || "guest"}</strong><span>Role</span></div>
      </div>
    </section>`)}
    <section class="community-layout">
      ${renderManagedSection("communications-composer", `<div class="panel">
        <div class="panel-head"><div><h2>Start a discussion</h2><p>Post a question or update for contractors and approved team members.</p></div></div>
        ${canPost ? `
          <form class="stack-form inline-section" data-form="community-post">
            <label><span>Title</span><input name="title" required placeholder="Ask a question or share an update" /></label>
            <label><span>Details</span><textarea name="body" rows="5" required placeholder="Write the context, job issue, invoice question, or field note"></textarea></label>
            <label><span>Tags</span><input name="tags" placeholder="dryout, invoice, schedule" /></label>
            <button type="submit">Post to board</button>
          </form>
        ` : `<div class="empty-state"><strong>Posting restricted</strong><span>Your role can read assigned conversations, but cannot create posts.</span></div>`}
      </div>`)}
      ${renderManagedSection("communications-board", `<div class="panel">
        <div class="panel-head"><div><h2>Discussion board</h2><p>Recent contractor questions, answers, and coordination notes.</p></div></div>
        <div class="community-feed">
          ${posts.length ? posts.map(renderCommunityPost).join("") : `<div class="empty-state"><strong>No board posts yet</strong><span>Create the first contractor discussion.</span></div>`}
        </div>
      </div>`)}
    </section>
    ${renderModuleFiles(module)}
    ${renderFileDetail(module)}
  `;
}

function renderCommunityPost(post) {
  const comments = Array.isArray(post.comments) ? post.comments : [];
  const tags = Array.isArray(post.tags) ? post.tags : [];
  return `
    <article class="community-post">
      <div class="file-card-head"><span>${escapeHtml(post.authorRoleId || "member")}</span><strong>${escapeHtml(formatTime(post.createdAt))}</strong></div>
      <h3>${escapeHtml(post.title || "Untitled discussion")}</h3>
      <p>${escapeHtml(post.body || "")}</p>
      ${tags.length ? `<div class="tag-row">${tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>` : ""}
      <small>Posted by ${escapeHtml(post.authorEmail || "approved user")}</small>
      <div class="comment-thread">
        ${comments.length ? comments.map((comment) => `
          <div class="comment-item">
            <strong>${escapeHtml(comment.authorEmail || "member")}</strong>
            <span>${escapeHtml(comment.body || "")}</span>
            <small>${escapeHtml(formatTime(comment.createdAt))}</small>
          </div>
        `).join("") : `<div class="empty-state compact-empty"><strong>No comments yet</strong><span>Be the first to answer.</span></div>`}
      </div>
      <form class="stack-form inline-section compact-comment-form" data-form="community-comment">
        <input type="hidden" name="postId" value="${escapeHtml(post.id)}" />
        <label><span>Reply</span><input name="body" required placeholder="Add a comment" /></label>
        <button type="submit">Comment</button>
      </form>
    </article>
  `;
}

function renderTeamModule(module) {
  const displayedUsers = assignableTeamMembers();
  return `
    <section class="hero-band team-hero">
      <div>
        <h2>${escapeHtml(sectionTitle("team-hero", "Team, roles, and permissions"))}</h2>
        <p>${escapeHtml(sectionBody("team-hero", module.purpose))}</p>
        <div class="hero-actions">
          <button type="button" data-action="open-create-file" data-key="team">Team file</button>
          <a href="#module/settings" data-action="set-active" data-key="settings">User settings</a>
          <a href="#module/securitycenter" data-action="set-active" data-key="securitycenter">2FA</a>
          ${renderSectionButtons("team-hero")}
        </div>
      </div>
      <div class="metric-strip">
        <div><strong>${displayedUsers.length}</strong><span>Users</span></div>
        <div><strong>${state.tasks.filter((task) => task.status !== "Complete").length}</strong><span>Open tasks</span></div>
        <div><strong>${state.tasks.filter((task) => task.priority === "High").length}</strong><span>High priority</span></div>
      </div>
    </section>
    ${renderManagedSection("team-access-panel", renderAccountSeparationPanel())}
    ${renderRbacAdminPanel()}
    <section class="team-layout">
      <div class="panel">
        <div class="panel-head"><div><h2>Owner-created logins</h2><p>Create employees, issue individual portal codes, and assign field modules.</p></div></div>
        ${state.firebase.enabled && state.authSession ? `<div class="empty-state"><strong>Secure login manager is active</strong><span>The local roster below remains available for immediate field task assignment while Firebase Admin user creation is configured.</span></div>` : ""}
        ${renderTeamForm()}
        <div class="team-grid">${displayedUsers.map(renderTeamMemberCard).join("")}</div>
      </div>
      <div class="panel">
        <div class="panel-head"><div><h2>Task assignment</h2><p>Assign work to people, jobs, and modules.</p></div></div>
        ${renderTaskForm()}
        <div class="task-list">${visibleTasks().map(renderTaskItem).join("")}</div>
      </div>
    </section>
    ${renderModuleFiles(module)}
    ${renderFileDetail(module)}
  `;
}

function renderRbacAdminPanel(options = {}) {
  const canManageAnything = canDo("manageUsers") || canDo("manageRolePermissions") || canDo("manageAccessGrants");
  if (!state.authSession || !canManageAnything) return options.showLocked ? renderAdminLockedPanel() : "";
  const roles = state.accessContext?.roles || [];
  const permissionDocs = state.accessContext?.permissions || [];
  const editableRoles = roles.filter((role) => role.id && role.id !== "super_admin");
  const assignableRoles = editableRoles.length ? editableRoles : roles.filter((role) => role.id !== "super_admin");
  const managedUsers = (state.accessContext?.users || []).map(mapUserToTeamMember);
  const auditLogs = state.accessContext?.auditLogs || [];
  const accessRequests = state.accessContext?.accessRequests || [];
  const accessGrants = state.accessContext?.accessGrants || [];
  return `
    <section class="panel">
      <div class="panel-head">
        <div>
          <h2>User Login Manager</h2>
          <p>Super Admin can see every platform login, create users, invite contractors, change roles, disable accounts, reset permissions, and audit access.</p>
        </div>
        <div class="row-actions">
          ${canDo("manageSections") ? `<button type="button" data-action="open-admin-edit">Open edit overlay</button>` : ""}
        </div>
      </div>
      ${canDo("manageUsers") ? `
        <form class="stack-form inline-section" data-form="rbac-user">
          <h3>Create secure user</h3>
          <div class="form-grid">
            <label><span>Name</span><input name="displayName" required placeholder="Full name" /></label>
            <label><span>Email</span><input name="email" type="email" required placeholder="user@company.com" /></label>
            <label><span>Password</span><input name="password" type="password" required placeholder="Temporary password" /></label>
            <label><span>Role</span><select name="roleId">${assignableRoles.map((role) => `<option value="${role.id}">${escapeHtml(role.label || role.id)}</option>`).join("")}</select></label>
            <label><span>Company id</span><input name="companyId" placeholder="default-company" /></label>
            <label><span>Franchise ids</span><input name="franchiseIds" placeholder="franchise-a,franchise-b" /></label>
            <label><span>Contractor id</span><input name="contractorId" placeholder="contractor-company" /></label>
            <label><span>Access code</span><input name="accessCode" placeholder="CON-123ABC" /></label>
            <label><span>Access expires</span><input name="accessExpiresAt" type="datetime-local" /></label>
            <label><span>Access scope</span><input name="accessScope" placeholder="48_hour_access" /></label>
          </div>
          <button type="submit">Create Firebase user</button>
        </form>
      ` : ""}
      ${canDo("manageAccessGrants") ? renderAccessGrantPanel(accessRequests, accessGrants, assignableRoles) : ""}
      ${canDo("manageRolePermissions") ? renderRolePermissionForms(editableRoles, permissionDocs) : ""}
      ${canDo("manageUsers") ? `
        <div class="panel-head"><div><h3>Managed users</h3><p>Update roles, disable accounts, reset access, or remove users.</p></div></div>
        ${managedUsers.length ? `<div class="team-grid">${managedUsers.map(renderTeamMemberCard).join("")}</div>` : `<div class="empty-state"><strong>No managed users loaded yet</strong><span>Created Firebase users and accepted invite accounts will appear here after the server saves them.</span></div>`}
      ` : ""}
      ${auditLogs.length ? `
        <div class="panel-head"><div><h3>Audit logs</h3><p>Recent security, permissions, user, and content changes.</p></div></div>
        <div class="activity-list">
          ${auditLogs.slice(0, 20).map((entry) => `<div><strong>${escapeHtml(entry.eventType || "event")}</strong><span>${escapeHtml(entry.targetType || "target")} ${escapeHtml(entry.targetId || "")} by ${escapeHtml(entry.actorUid || "unknown")} at ${escapeHtml(formatTime(entry.createdAt))}</span></div>`).join("")}
        </div>
      ` : ""}
    </section>
  `;
}

function rolePermissionsFor(permissionDocs, roleId) {
  return permissionDocs.find((doc) => doc.roleId === roleId) || {};
}

function accessListValue(config, key) {
  return Array.isArray(config?.[key]) ? config[key].join(",") : "";
}

function renderRolePermissionForms(editableRoles, permissionDocs) {
  if (!editableRoles.length) {
    return `<div class="empty-state"><strong>No editable roles loaded</strong><span>Run RBAC bootstrap after Firebase Admin credentials are configured.</span></div>`;
  }
  return `
    <div class="inline-section">
      <div class="panel-head"><div><h3>Role permission editor</h3><p>Edit each role separately so module visibility, hidden sections, and actions save to the correct access level.</p></div></div>
      <div class="role-permission-grid">
        ${editableRoles.map((role) => {
          const permissions = rolePermissionsFor(permissionDocs, role.id);
          const actions = permissions.actions || {};
          return `
            <form class="stack-form inline-section" data-form="role-permissions">
              <h3>${escapeHtml(role.label || role.id)}</h3>
              <input type="hidden" name="roleId" value="${escapeHtml(role.id)}" />
              <div class="form-grid">
                <label><span>Visible tabs</span><input name="allowedTabs" value="${escapeHtml(accessListValue(permissions.tabs, "allowed"))}" placeholder="daily,team,jobs,reports" /></label>
                <label><span>Visible pages</span><input name="allowedPages" value="${escapeHtml(accessListValue(permissions.pages, "allowed"))}" placeholder="daily,team,jobs,reports" /></label>
                <label><span>Hidden sections</span><input name="hiddenSections" value="${escapeHtml(accessListValue(permissions.sections, "hidden"))}" placeholder="daily-performance,team-access-panel" /></label>
              </div>
              <fieldset class="source-picker compact-picker">
                <legend>${escapeHtml(role.label || role.id)} actions</legend>
                ${rbacActionKeys
                  .map((action) => `<label class="source-check"><input name="actions" type="checkbox" value="${action}" ${actions[action] ? "checked" : ""} /><span><strong>${escapeHtml(action)}</strong><small>Permission flag</small></span></label>`)
                  .join("")}
              </fieldset>
              <button type="submit">Save ${escapeHtml(role.label || role.id)} permissions</button>
            </form>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

function renderAccessGrantPanel(accessRequests, accessGrants, roles) {
  const last = state.lastAccessGrant;
  const delivery = last?.emailDelivery || null;
  const emailReady = Boolean(state.firebase.inviteEmailConfigured);
  return `
    <div class="access-grant-panel inline-section">
      <div class="panel-head">
        <div>
          <h3>Email invites, 48-hour links, and contractor codes</h3>
          <p>Send a single-email invite link and an individual portal code. Contractors sign in with Google and enter the code on the login screen.</p>
        </div>
      </div>
      <div class="empty-state ${emailReady ? "" : "warning-state"}">
        <strong>${emailReady ? "Invite email sending is configured" : "Invite email sending needs Vercel env vars"}</strong>
        <span>${emailReady ? "New grants will be emailed automatically when Send invite email is checked." : "Set RESEND_API_KEY and INVITE_FROM_EMAIL in Vercel. Until then, the link and code are generated here for manual sending."}</span>
      </div>
      ${last ? `
        <div class="empty-state grant-output">
          <strong>Issued for ${escapeHtml(last.email)}</strong>
          <span>Code: ${escapeHtml(last.accessCode)} | Expires: ${escapeHtml(formatTime(last.expiresAt))}</span>
          ${delivery ? `<span>Email delivery: ${escapeHtml(delivery.status || "unknown")}${delivery.message ? ` - ${escapeHtml(delivery.message)}` : ""}</span>` : ""}
          <code>${escapeHtml(last.accessLink)}</code>
        </div>
      ` : ""}
      <form class="stack-form inline-section" data-form="access-grant">
        <h3>Send invite</h3>
        <div class="form-grid">
          <label><span>Request id</span><input name="requestId" placeholder="Optional request id" /></label>
          <label><span>Name</span><input name="displayName" placeholder="Contractor name" /></label>
          <label><span>Google email</span><input name="email" type="email" required placeholder="contractor@company.com" /></label>
          <label><span>Role</span><select name="roleId">${roles.map((role) => `<option value="${role.id}"${role.id === "contractor" ? " selected" : ""}>${escapeHtml(role.label || role.id)}</option>`).join("")}</select></label>
          <label><span>Company id</span><input name="companyId" value="default-company" /></label>
          <label><span>Franchise ids</span><input name="franchiseIds" placeholder="default-franchise" /></label>
          <label><span>Contractor id</span><input name="contractorId" placeholder="contractor-company" /></label>
          <label><span>Hours</span><input name="ttlHours" type="number" min="1" max="48" value="48" /></label>
        </div>
        <label class="source-check"><input name="sendEmail" type="checkbox" checked /><span><strong>Send invite email</strong><small>Email includes the access link, code, expiration, and Google sign-in instructions.</small></span></label>
        <button type="submit">Send invite link and code</button>
      </form>
      <div class="access-request-grid">
        <div>
          <h4>Pending requests</h4>
          <div class="activity-list">
            ${accessRequests.length ? accessRequests.slice(0, 8).map((request) => `<div><strong>${escapeHtml(request.email)}</strong><span>${escapeHtml(request.status || "requested")} | ${escapeHtml(request.requestedRole || "contractor")} | id ${escapeHtml(request.id)}</span></div>`).join("") : `<div><strong>No pending requests</strong><span>Requests from the login dashboard will appear here.</span></div>`}
          </div>
        </div>
        <div>
          <h4>Recent grants</h4>
          <div class="activity-list">
            ${accessGrants.length ? accessGrants.slice(0, 8).map((grant) => `<div><strong>${escapeHtml(grant.email)}</strong><span>${escapeHtml(grant.status || "issued")} | ${escapeHtml(grant.roleId || "contractor")} | expires ${escapeHtml(formatTime(grant.expiresAt))}</span></div>`).join("") : `<div><strong>No grants issued</strong><span>Issued links and contractor codes will be logged here.</span></div>`}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderAdminEditModePanel() {
  if (!canDo("manageSections")) return "";
  const tabs = state.accessContext?.tabs || [];
  const pages = state.accessContext?.pages || [];
  const sections = (state.accessContext?.pageSections || []).filter((section) => section.pageId === state.activeKey);
  return `
    <section class="panel">
      <div class="panel-head">
        <div>
          <h2>Admin edit mode</h2>
          <p>Edit tab labels, page titles, section visibility, body copy, buttons, and brand settings without changing code.</p>
        </div>
      </div>
      <form class="stack-form inline-section" data-form="tab-config">
        <h3>Rename tab or page</h3>
        <div class="form-grid">
          <label><span>Tab</span><select name="id">${tabs.map((tab) => `<option value="${tab.id}">${escapeHtml(tab.label || tab.id)}</option>`).join("")}</select></label>
          <label><span>Label</span><input name="label" placeholder="New tab label" /></label>
          <label><span>Order</span><input name="order" type="number" min="0" step="1" placeholder="0" /></label>
          <label><span>Visible</span><select name="visible"><option value="true">Visible</option><option value="false">Hidden</option></select></label>
        </div>
        <button type="submit">Save tab config</button>
      </form>
      <form class="stack-form inline-section" data-form="page-config">
        <h3>Rename or reorder page</h3>
        <div class="form-grid">
          <label><span>Page</span><select name="id">${pages.map((page) => `<option value="${page.id}">${escapeHtml(page.title || page.id)}</option>`).join("")}</select></label>
          <label><span>Title</span><input name="title" placeholder="Page title" /></label>
          <label><span>Purpose</span><input name="purpose" placeholder="Short page description" /></label>
          <label><span>Order</span><input name="order" type="number" min="0" step="1" placeholder="0" /></label>
          <label><span>Visible</span><select name="visible"><option value="true">Visible</option><option value="false">Hidden</option></select></label>
        </div>
        <button type="submit">Save page config</button>
      </form>
      <form class="stack-form inline-section" data-form="page-section-config">
        <h3>Edit active page section</h3>
        <div class="form-grid">
          <label><span>Section</span><select name="id">${sections.map((section) => `<option value="${section.id}">${escapeHtml(section.title || section.id)}</option>`).join("")}</select></label>
          <label><span>Heading</span><input name="heading" placeholder="Section heading" /></label>
          <label><span>Body</span><input name="body" placeholder="Section body" /></label>
          <label><span>Visible</span><select name="visible"><option value="true">Visible</option><option value="false">Hidden</option></select></label>
          <label><span>Order</span><input name="order" type="number" min="0" step="1" placeholder="0" /></label>
          <label><span>Image URL</span><input name="imageUrl" value="${escapeHtml(state.adminEditAssetUrl || "")}" placeholder="/uploads/os-assets/..." /></label>
          <label><span>Primary button label</span><input name="buttonLabel" placeholder="Open jobs" /></label>
          <label><span>Primary button URL</span><input name="buttonUrl" placeholder="#module/jobs" /></label>
        </div>
        <label class="upload-button"><input type="file" accept="image/*" data-field="admin-image-file" /><span>Upload section image</span></label>
        <button type="submit">Save section config</button>
      </form>
      <form class="stack-form inline-section" data-form="company-brand">
        <h3>Brand and image settings</h3>
        <div class="form-grid">
          <label><span>Brand name</span><input name="brandName" placeholder="Brothers OS" /></label>
          <label><span>Brand logo URL</span><input name="brandLogoUrl" placeholder="/assets/brothers-logo.png" /></label>
          <label><span>Edit mode enabled</span><select name="editModeEnabled"><option value="true">Yes</option><option value="false">No</option></select></label>
        </div>
        <button type="submit">Save brand settings</button>
      </form>
    </section>
  `;
}

function renderAccountSeparationPanel() {
  const admin = state.accountProfile.adminAccount;
  const portal = state.accountProfile.employeePortal;
  return `
    <section class="access-model-panel">
      <article>
        <span>Administrator account</span>
        <h2>${escapeHtml(admin.name)}</h2>
        <p>${escapeHtml(admin.scope)}</p>
        <dl>
          <div><dt>Login type</dt><dd>Google account or controlled fallback</dd></div>
          <div><dt>2FA</dt><dd>Google account verification required</dd></div>
          <div><dt>Admin code</dt><dd>${escapeHtml(admin.accessCode)}</dd></div>
          <div><dt>Financial data</dt><dd>All users, customers, revenue invoices, and contractor invoices</dd></div>
        </dl>
      </article>
      <article>
        <span>Contractor and employee portals</span>
        <h2>48-hour code-gated access</h2>
        <p>Trial and contractor users receive a single-email access link plus an individual portal code. They cannot see global indexes or Super Admin controls.</p>
        <dl>
          <div><dt>Access code</dt><dd>${escapeHtml(portal.accessCode)}</dd></div>
          <div><dt>Modules</dt><dd>${portal.modules.map((key) => moduleByKey(key)?.label || key).join(", ")}</dd></div>
          <div><dt>Blocked</dt><dd>Global indexes, owner exports, user management, full revenue, and billing admin</dd></div>
        </dl>
      </article>
    </section>
  `;
}

function renderTeamForm() {
  return `
    <form class="stack-form inline-section" data-form="team-member">
      <h3>Create login</h3>
      <div class="form-grid">
        <label><span>Name</span><input name="name" required placeholder="Employee or contractor" /></label>
        <label><span>Email</span><input name="email" type="email" required placeholder="email@example.com" /></label>
        <label><span>Account type</span><select name="accountType"><option>Employee</option><option>Contractor portal</option><option>Manager</option><option>Administrator</option><option>Vendor portal</option></select></label>
        <label><span>Role</span><input name="role" placeholder="Estimator, field tech, admin, vendor" /></label>
        <label><span>Access summary</span><input name="access" placeholder="Jobs, dry logs, time, pricing, admin" /></label>
        <label><span>Individual portal code</span><input name="accessCode" placeholder="Auto-generated if blank" autocomplete="one-time-code" /></label>
        <label><span>Assigned job IDs</span><input name="assignedJobIds" list="team-job-options" placeholder="J-2039,J-2050" /></label>
      </div>
      <datalist id="team-job-options">
        ${state.jobBoards.map((job) => `<option value="${escapeHtml(job.jobId)}">${escapeHtml(job.title)}</option>`).join("")}
      </datalist>
      <fieldset class="source-picker compact-picker">
        <legend>Module permissions</legend>
        ${["jobs", "drylogs", "time", "equipment", "photos", "communications", "pricing", "payments", "reports", "settings"]
          .map((key) => moduleByKey(key))
          .filter(Boolean)
          .map((module) => `<label class="source-check"><input name="permissions" type="checkbox" value="${module.key}" ${employeeAllowedModuleKeys.includes(module.key) ? "checked" : ""} /><span><strong>${escapeHtml(module.label)}</strong><small>${escapeHtml(categoryLabels[module.category] || module.category)}</small></span></label>`)
          .join("")}
      </fieldset>
      <button type="submit">Create login invite</button>
    </form>
  `;
}

function renderTaskForm() {
  const teamMembers = assignableTeamMembers();
  return `
    <form class="stack-form inline-section" data-form="task">
      <h3>Assign task</h3>
      <label><span>Task</span><input name="title" required placeholder="What needs to be done" /></label>
      <div class="form-grid">
        <label><span>Assignee</span><select name="assigneeId">${teamMembers.map((member) => `<option value="${member.id}">${escapeHtml(member.name)}${member.email ? ` - ${escapeHtml(member.email)}` : ""}</option>`).join("")}</select></label>
        <label><span>Module</span><select name="moduleKey">${pinnedKeys().map((key) => moduleByKey(key)).filter(Boolean).map((item) => `<option value="${item.key}">${escapeHtml(item.label)}</option>`).join("")}</select></label>
        <label><span>Job/file</span><input name="relatedJob" list="task-job-options" placeholder="J-2039, invoice, property" /></label>
        <label><span>Due</span><input name="due" type="date" /></label>
        <label><span>Priority</span><select name="priority"><option>High</option><option>Medium</option><option>Low</option></select></label>
      </div>
      <datalist id="task-job-options">
        ${state.jobBoards.map((job) => `<option value="${escapeHtml(job.jobId)}">${escapeHtml(job.title)}</option>`).join("")}
      </datalist>
      <button type="submit">Assign task</button>
    </form>
  `;
}

function renderTeamMemberCard(member) {
  const canManage = canDo("manageUsers") && member.id;
  const assignedTaskIds = new Set(normalizeListValue(member.assignedTaskIds));
  const assignedTasks = state.tasks.filter((task) => {
    return assignedTaskIds.has(task.id)
      || task.assigneeId === member.id
      || (member.email && String(task.assigneeEmail || "").toLowerCase() === String(member.email).toLowerCase())
      || (member.name && String(task.assigneeName || "").toLowerCase() === String(member.name).toLowerCase());
  });
  const assignedJobs = [...new Set([...normalizeListValue(member.assignedJobIds), ...assignedTasks.map((task) => task.relatedJob).filter(Boolean)])];
  const cardActions = [
    canManage ? `<button type="button" data-action="open-user-manage" data-id="${member.id}">Manage</button>` : "",
    member.id && canDo("resetPermissions") ? `<button type="button" data-action="reset-user-permissions" data-id="${member.id}">Reset access</button>` : "",
    member.id && canDo("disableAccounts") ? `<button type="button" data-action="toggle-user-disabled" data-id="${member.id}" data-disabled="${member.status === "Disabled" ? "true" : "false"}">${member.status === "Disabled" ? "Enable" : "Disable"}</button>` : "",
    member.id && canDo("removeUsers") ? `<button type="button" data-action="delete-user" data-id="${member.id}">Delete</button>` : ""
  ].filter(Boolean).join("");
  return `
    <article class="team-card">
      <div class="file-card-head"><span>${escapeHtml(member.accountType || "Employee")}</span><strong>${escapeHtml(member.status)}</strong></div>
      <h3>${escapeHtml(member.name)}</h3>
      <p>${escapeHtml(member.email)}</p>
      <span>${escapeHtml(member.role)} - ${escapeHtml(member.access)}</span>
      <small>Portal code: ${escapeHtml(employeeAccessCodeFor(member))}</small>
      <small>${assignedTasks.length} assigned task${assignedTasks.length === 1 ? "" : "s"}${assignedJobs.length ? ` | Jobs: ${escapeHtml(assignedJobs.join(", "))}` : ""}</small>
      <small>${escapeHtml((member.permissions || []).join(", ") || "No permissions set")}</small>
      ${member.companyId ? `<small>Company: ${escapeHtml(member.companyId)}${member.franchiseIds?.length ? ` | Franchise: ${escapeHtml(member.franchiseIds.join(", "))}` : ""}</small>` : ""}
      ${cardActions ? `<div class="card-actions">${cardActions}</div>` : ""}
    </article>
  `;
}

function renderTaskItem(task) {
  const assignee = assignableTeamMembers().find((member) => member.id === task.assigneeId);
  const module = moduleByKey(task.moduleKey);
  return `
    <div class="task-item">
      <div>
        <strong>${escapeHtml(task.title)}</strong>
        <span>${escapeHtml(assignee?.name || task.assigneeName || "Unassigned")} - ${escapeHtml(module?.label || task.moduleKey)} - ${escapeHtml(task.relatedJob || "No job")}</span>
      </div>
      <div class="row-actions">
        <a href="#module/${task.moduleKey}" data-action="set-active" data-key="${task.moduleKey}">Open</a>
        <button type="button" data-action="complete-task" data-id="${task.id}">${task.status === "Complete" ? "Done" : "Complete"}</button>
      </div>
    </div>
  `;
}

function renderSketchModule(module) {
  return `
    <section class="hero-band sketch-hero">
      <div>
        <p>${escapeHtml(module.purpose)}</p>
        <div class="hero-actions">
          <button type="button" data-action="professionalize-sketch">Professionalize sketch</button>
          <button type="button" data-action="open-create-file" data-key="sketch">Sketch file</button>
        </div>
      </div>
      <div class="metric-strip">
        <div><strong>${state.sketchRooms.length}</strong><span>Rooms</span></div>
        <div><strong>${state.sketchRooms.reduce((sum, room) => sum + Number(room.width || 0) * Number(room.height || 0), 0)}</strong><span>Sq ft</span></div>
        <div><strong>${state.sketchRooms.filter((room) => room.notes.toLowerCase().includes("moisture")).length}</strong><span>Moisture zones</span></div>
      </div>
    </section>
    <section class="sketch-layout">
      <div class="panel">
        <div class="panel-head"><div><h2>Floor plan builder</h2><p>Rooms from scribbles become professional plan blocks.</p></div><button type="button" data-action="professionalize-sketch">Clean layout</button></div>
        <div class="floor-plan">
          ${state.sketchRooms.map((room) => `<button type="button" class="floor-room" style="left:${room.x}%;top:${room.y}%;width:${room.w}%;height:${room.h}%;" data-action="select-sketch-room" data-id="${room.id}"><strong>${escapeHtml(room.name)}</strong><span>${escapeHtml(room.width)} x ${escapeHtml(room.height)}</span></button>`).join("")}
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><div><h2>Room scribble intake</h2><p>Enter rough dimensions, notes, and room assignment.</p></div></div>
        <form class="stack-form" data-form="sketch-room">
          <div class="form-grid">
            <label><span>Room</span><input name="name" required placeholder="Kitchen, hall, bedroom" /></label>
            <label><span>Job</span><input name="assignedJob" placeholder="J-2039" /></label>
            <label><span>Width</span><input name="width" type="number" step="0.1" value="12" /></label>
            <label><span>Height</span><input name="height" type="number" step="0.1" value="10" /></label>
          </div>
          <label><span>Scribble notes</span><textarea name="scribble" rows="3" placeholder="rough sketch notes, moisture points, equipment placement"></textarea></label>
          <label><span>Professional notes</span><textarea name="notes" rows="3" placeholder="Affected materials, room assignment, line item support"></textarea></label>
          <button type="submit">Add room to plan</button>
        </form>
      </div>
    </section>
    ${renderModuleFiles(module)}
    ${renderFileDetail(module)}
  `;
}

function renderDefensibilityModule(module) {
  return `
    <section class="hero-band">
      <div><p>${escapeHtml(module.purpose)}</p><div class="hero-actions"><button type="button" data-action="open-create-file" data-key="defensibility">Manual review file</button><a href="#module/pricing" data-action="set-active" data-key="pricing">Price book</a><a href="#module/compliance" data-action="set-active" data-key="compliance">Compliance</a></div></div>
      <div class="metric-strip"><div><strong>${filesForModule("defensibility").length}</strong><span>Reviews</span></div><div><strong>${state.priceItems.filter((item) => item.category === "Xactimate pricing").length}</strong><span>Xact lines</span></div><div><strong>${state.standardsOutputs.length}</strong><span>Source drafts</span></div></div>
    </section>
    <section class="panel">
      <div class="panel-head"><div><h2>Estimate defensibility scorer</h2><p>Score proof strength before sending an invoice, supplement, or rebuttal.</p></div></div>
      <form class="stack-form" data-form="defensibility-review">
        <div class="form-grid">
          <label><span>Estimate name</span><input name="estimateName" required value="${escapeHtml(state.estimateDraft.estimateNo)}" /></label>
          <label><span>Job</span><input name="relatedJob" value="${escapeHtml(state.estimateDraft.job)}" /></label>
          <label><span>Photo support</span><input name="photoSupport" type="range" min="0" max="100" value="70" /></label>
          <label><span>Quantity support</span><input name="quantitySupport" type="range" min="0" max="100" value="65" /></label>
          <label><span>Time support</span><input name="timeSupport" type="range" min="0" max="100" value="60" /></label>
          <label><span>Equipment support</span><input name="equipmentSupport" type="range" min="0" max="100" value="80" /></label>
          <label><span>Compliance support</span><input name="complianceSupport" type="range" min="0" max="100" value="75" /></label>
        </div>
        <label><span>Weak points</span><textarea name="weakPoints" rows="3" placeholder="Missing photos, weak measurement, no equipment log, missing approval"></textarea></label>
        <button type="submit">Generate defensibility score</button>
      </form>
    </section>
    ${renderModuleFiles(module)}
    ${renderFileDetail(module)}
  `;
}

function renderSupplementModule(module) {
  return `
    <section class="hero-band">
      <div><p>${escapeHtml(module.purpose)}</p><div class="hero-actions"><button type="button" data-action="open-create-file" data-key="supplement">Manual supplement file</button><a href="#module/compliance" data-action="set-active" data-key="compliance">Rebuttal engine</a><a href="#module/defensibility" data-action="set-active" data-key="defensibility">Defensibility</a></div></div>
      <div class="metric-strip"><div><strong>${filesForModule("supplement").length}</strong><span>Packets</span></div><div><strong>${state.learnedJargon.length}</strong><span>Jargon terms</span></div><div><strong>${state.priceItems.filter((item) => item.category === "Xactimate pricing").length}</strong><span>Xactimate lines</span></div></div>
    </section>
    <section class="panel">
      <div class="panel-head"><div><h2>Supplement generator</h2><p>Build a packet from disputed lines, facts, imported estimate items, and rebuttal language.</p></div></div>
      <form class="stack-form" data-form="supplement-packet">
        <div class="form-grid">
          <label><span>Issue</span><input name="issue" required placeholder="Carrier reduced drying equipment days" /></label>
          <label><span>Job</span><input name="relatedJob" placeholder="J-2039" /></label>
        </div>
        <label><span>Disputed lines / adjuster language</span><textarea name="disputedLines" rows="3" placeholder="paste reduction, estimate comments, or line item dispute"></textarea></label>
        <label><span>Job facts and support</span><textarea name="facts" rows="4" placeholder="photos, readings, equipment logs, Xactimate lines, source checks"></textarea></label>
        <button type="submit">Generate supplement packet</button>
      </form>
    </section>
    ${renderModuleFiles(module)}
    ${renderFileDetail(module)}
  `;
}

function renderAccountingModule(module) {
  const qbo = state.quickBooksConnection;
  const customers = customerRecords();
  const invoices = revenueInvoices();
  const contractorBills = contractorInvoices();
  return `
    <section class="hero-band">
      <div><p>${escapeHtml(module.purpose)}</p><div class="hero-actions"><button type="button" data-action="connect-quickbooks">${qbo.connected ? "Sync QuickBooks" : "Create QuickBooks setup"}</button><a href="#module/payments" data-action="set-active" data-key="payments">Payments</a><a href="#module/reports" data-action="set-active" data-key="reports">Reports</a></div></div>
      <div class="metric-strip"><div><strong>${customers.length}</strong><span>Customers</span></div><div><strong>${escapeHtml(formatMoney(sumRecords(invoices, "amount")))}</strong><span>Revenue</span></div><div><strong>${escapeHtml(formatMoney(sumRecords(contractorBills, "amount")))}</strong><span>Contractors</span></div></div>
    </section>
    <section class="payments-layout">
      <div class="panel">
        <div class="panel-head"><div><h2>QuickBooks login gateway</h2><p>Create the OAuth setup file before syncing invoices, expenses, projects, and job profit.</p></div><button type="button" data-action="connect-quickbooks">${qbo.connected ? "Sync now" : "Create setup file"}</button></div>
        <div class="quickbooks-card">
          <strong>${escapeHtml(qbo.companyName || "No company connected")}</strong>
          <span>${escapeHtml(qbo.mode)} - ${qbo.lastSync ? `Last sync ${formatTime(qbo.lastSync)}` : "Waiting for OAuth setup"}</span>
          <small>Scopes: ${escapeHtml((qbo.scopes || []).join(", "))}</small>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><div><h2>Customer and invoice access</h2><p>Scoped customer, revenue invoice, and contractor invoice records from the secured data model.</p></div></div>
        ${renderCustomerDirectory(customers)}
        ${renderBusinessInvoicePanels()}
      </div>
    </section>
    <section class="payments-layout">
      <div class="panel">
        <div class="panel-head"><div><h2>Job expense/profit inputs</h2><p>Update live accounting metrics while QuickBooks is being connected.</p></div></div>
        ${renderPerformanceTracker()}
      </div>
    </section>
    ${renderModuleFiles(module)}
    ${renderFileDetail(module)}
  `;
}

function renderCustomerDirectory(customers) {
  if (!customers.length) {
    return `<div class="empty-state"><strong>No customer records available</strong><span>Your role does not currently include customer directory access, or no customer records have been synced yet.</span></div>`;
  }
  return `
    <div class="business-record-grid">
      ${customers.map((customer) => `
        <article class="business-record-card">
          <div class="file-card-head"><span>Customer</span><strong>${escapeHtml(customer.status || "Active")}</strong></div>
          <h3>${escapeHtml(customer.name || customer.customerId || customer.id)}</h3>
          <p>${escapeHtml(customer.email || customer.phone || "Contact pending")}</p>
          <dl>
            <div><dt>Revenue</dt><dd>${escapeHtml(formatMoney(customer.revenueTotal || 0))}</dd></div>
            <div><dt>Open</dt><dd>${escapeHtml(formatMoney(customer.openBalance || 0))}</dd></div>
            <div><dt>Contractor</dt><dd>${escapeHtml(customer.contractorId || "Unassigned")}</dd></div>
          </dl>
        </article>
      `).join("")}
    </div>
  `;
}

function renderEquipmentModule(module) {
  const deployments = state.equipmentDeployments;
  const totalBillable = deployments.reduce((sum, deployment) => sum + (deployment.billable ? equipmentCharge(deployment) : 0), 0);
  return `
    <section class="hero-band equipment-hero">
      <div>
        <p>${escapeHtml(module.purpose)}</p>
        <div class="hero-actions">
          <button type="button" data-action="capture-equipment-gps">Capture GPS</button>
          <a href="#module/payments" data-action="set-active" data-key="payments">Open invoices</a>
          <button type="button" data-action="open-create-file" data-key="equipment">Manual file</button>
        </div>
      </div>
      <div class="metric-strip">
        <div><strong>${deployments.length}</strong><span>Located</span></div>
        <div><strong>${deployments.filter((item) => item.billable).length}</strong><span>Billable</span></div>
        <div><strong>${escapeHtml(formatMoney(totalBillable))}</strong><span>Invoice support</span></div>
      </div>
    </section>
    <section class="equipment-layout">
      <div class="panel">
        <div class="panel-head">
          <div><h2>Equipment GPS map</h2><p>Visual map of equipment locations tied to invoices and jobs.</p></div>
          <button type="button" data-action="capture-equipment-gps">Use current GPS</button>
        </div>
        ${renderEquipmentMap(deployments)}
      </div>
      <div class="panel">
        <div class="panel-head">
          <div><h2>Equipment generator</h2><p>Add a location, attach an invoice, and create invoice-ready support.</p></div>
        </div>
        ${renderEquipmentForm()}
      </div>
    </section>
    <section class="panel">
      <div class="panel-head">
        <div><h2>Equipment invoice support</h2><p>Each deployment keeps GPS, room, invoice, rental days, and billable amount together.</p></div>
        <button type="button" data-action="open-create-file" data-key="equipment">New equipment file</button>
      </div>
      <div class="equipment-deployment-grid">
        ${deployments.map(renderEquipmentDeploymentCard).join("")}
      </div>
    </section>
    ${renderModuleFiles(module)}
    ${renderFileDetail(module)}
  `;
}

function renderEquipmentMap(deployments) {
  const bounds = equipmentMapBounds(deployments);
  if (!deployments.length) {
    return `<div class="equipment-map empty-map"><strong>No GPS locations yet</strong><span>Add equipment below or capture current GPS.</span></div>`;
  }
  return `
    <div class="equipment-map" aria-label="Equipment GPS map">
      <div class="map-grid"></div>
      ${deployments
        .map((deployment, index) => {
          const position = pinPosition(deployment, bounds);
          return `
            <a class="equipment-pin" style="left:${position.x}%; top:${position.y}%;" href="${deployment.latitude && deployment.longitude ? `https://www.google.com/maps/search/?api=1&query=${deployment.latitude},${deployment.longitude}` : "#module/equipment"}" target="_blank" rel="noreferrer" title="${escapeHtml(deployment.equipmentName)}">
              <span>${index + 1}</span>
            </a>
          `;
        })
        .join("")}
      <div class="map-legend">
        ${deployments
          .slice(0, 5)
          .map((deployment, index) => `<span><strong>${index + 1}</strong>${escapeHtml(deployment.assetTag || deployment.equipmentName)}</span>`)
          .join("")}
      </div>
    </div>
  `;
}

function renderEquipmentForm() {
  const invoices = invoiceFileOptions();
  const defaultInvoice = invoices[0];
  const defaultInvoiceNumber = defaultInvoice?.title?.match(/INV-[A-Za-z0-9-]+/)?.[0] || defaultInvoice?.title || "";
  return `
    <form class="stack-form equipment-form" data-form="equipment-deployment">
      <div class="form-grid">
        <label><span>Equipment</span><input name="equipmentName" required placeholder="Dehumidifier, air scrubber, fan, generator" /></label>
        <label><span>Asset tag</span><input name="assetTag" placeholder="DEHU-014" /></label>
        <label><span>Job / property</span><input name="job" required placeholder="J-2039 Oak Avenue" /></label>
        <label><span>Room / placement</span><input name="room" placeholder="Unit 2B living room" /></label>
        <label>
          <span>Status</span>
          <select name="status">
            <option>Deployed</option>
            <option>Picked up</option>
            <option>Needs pickup</option>
            <option>In repair</option>
            <option>Lost / review</option>
          </select>
        </label>
        <label>
          <span>Attach invoice</span>
          <select name="invoiceId">
            ${invoices.map((file) => `<option value="${file.id}">${escapeHtml(file.title)}</option>`).join("")}
            <option value="">Create or attach later</option>
          </select>
        </label>
        <label><span>Invoice number</span><input name="invoiceNumber" value="${escapeHtml(defaultInvoiceNumber)}" placeholder="INV-2039" /></label>
        <label><span>Address / site note</span><input name="address" placeholder="Street, unit, yard, roof, mechanical room" /></label>
        <label><span>Latitude</span><input name="latitude" inputmode="decimal" placeholder="42.45010" /></label>
        <label><span>Longitude</span><input name="longitude" inputmode="decimal" placeholder="-73.24540" /></label>
        <label><span>Rental days</span><input name="rentalDays" type="number" min="0" step="0.25" value="1" /></label>
        <label><span>Daily rate</span><input name="dailyRate" type="number" min="0" step="0.01" value="95" /></label>
      </div>
      <input name="gpsLabel" type="hidden" />
      <label class="check-row"><input name="billable" type="checkbox" checked /><span>Billable and should flow to invoice support</span></label>
      <label><span>Notes</span><textarea name="notes" rows="3" placeholder="Photo evidence, equipment condition, placement reason, pickup note, or invoice line details"></textarea></label>
      <div class="gps-capture-status">Use current GPS or enter coordinates manually.</div>
      <div class="modal-actions">
        <button type="button" data-action="capture-equipment-gps">Capture GPS</button>
        <button type="submit">Add equipment location</button>
      </div>
    </form>
  `;
}

function renderEquipmentDeploymentCard(deployment) {
  const invoice = state.files.find((file) => file.id === deployment.invoiceId);
  const mapUrl = deployment.latitude && deployment.longitude ? `https://www.google.com/maps/search/?api=1&query=${deployment.latitude},${deployment.longitude}` : "";
  return `
    <article class="equipment-card">
      <div class="file-card-head">
        <span>${escapeHtml(deployment.status)}</span>
        <strong>${escapeHtml(formatMoney(equipmentCharge(deployment)))}</strong>
      </div>
      <h3>${escapeHtml(deployment.equipmentName)}</h3>
      <p>${escapeHtml(deployment.assetTag || "No asset tag")} - ${escapeHtml(deployment.job || "No job")}</p>
      <dl>
        <div><dt>Location</dt><dd>${escapeHtml(deployment.room || deployment.address || "Not specified")}</dd></div>
        <div><dt>GPS</dt><dd>${escapeHtml(deployment.gpsLabel || "Not captured")}</dd></div>
        <div><dt>Invoice</dt><dd>${escapeHtml(invoice?.title || deployment.invoiceNumber || "Not attached")}</dd></div>
        <div><dt>Rate</dt><dd>${escapeHtml(`${deployment.rentalDays} days x ${formatMoney(deployment.dailyRate)}`)}</dd></div>
      </dl>
      <div class="card-actions">
        ${mapUrl ? `<a href="${mapUrl}" target="_blank" rel="noreferrer">Open map</a>` : ""}
        <button type="button" data-action="create-equipment-invoice" data-id="${deployment.id}">${invoice ? "Update invoice file" : "Create invoice file"}</button>
      </div>
    </article>
  `;
}

function renderTimeModule(module) {
  const timeEntries = visibleTimeEntries();
  const taskOptions = visibleTasks();
  return `
    <section class="hero-band time-hero">
      <div>
        <p>${escapeHtml(module.purpose)}</p>
        <div class="access-code">Employee field portal: <strong>individual codes issued in Team</strong></div>
      </div>
      <div class="metric-strip">
        <div><strong>${timeEntries.length}</strong><span>Entries</span></div>
        <div><strong>${state.clockSession ? "On" : "Off"}</strong><span>Clock</span></div>
        <div><strong>${state.employeeMode ? "Worker" : "Owner"}</strong><span>Access</span></div>
      </div>
    </section>
    <section class="time-layout">
      <div class="panel">
        <div class="panel-head">
          <div>
            <h2>GPS time clock</h2>
            <p>Workers can use employee-only access for GPS time, dry logs, job reference, photos, notes, equipment, and the communication board without opening owner/admin software.</p>
          </div>
          ${state.employeeMode ? `<button type="button" data-action="employee-logout">Owner view</button>` : `<button type="button" data-action="open-employee-login">Worker login</button>`}
        </div>
        ${state.clockSession ? renderClockSession() : renderClockInForm(taskOptions)}
      </div>
      <div class="panel">
        <div class="panel-head">
          <div><h2>Time log</h2><p>GPS-backed entries saved to this workspace.</p></div>
          <button type="button" data-action="open-export">Export</button>
        </div>
        ${renderTimeEntries(timeEntries)}
      </div>
    </section>
    ${renderQueue(module.key)}
    ${renderModuleFiles(module)}
    ${renderFileDetail(module)}
  `;
}

function renderClockInForm(taskOptions = []) {
  const visibleJobs = visibleJobBoards();
  return `
    <form class="stack-form" data-form="clock-in">
      <label>
        <span>Worker</span>
        <input name="worker" value="${escapeHtml(state.worker?.name || "")}" placeholder="Employee name" ${state.employeeMode ? "readonly" : ""} />
      </label>
      <label>
        <span>Job or property</span>
        <input name="job" list="visible-job-options" placeholder="Job number, property, or route" value="General field work" />
        <datalist id="visible-job-options">
          ${visibleJobs.map((job) => `<option value="${escapeHtml(job.jobId)}">${escapeHtml(job.title)}</option>`).join("")}
        </datalist>
      </label>
      <label>
        <span>Task</span>
        <select name="task">
          ${taskOptions.length
            ? taskOptions.map((task) => `<option value="${escapeHtml(task.id)}">${escapeHtml(task.title)}${task.relatedJob ? ` - ${escapeHtml(task.relatedJob)}` : ""}</option>`).join("")
            : `
              <option>Mitigation</option>
              <option>Inspection</option>
              <option>Pickup / supply run</option>
              <option>Admin / documentation</option>
              <option>Maintenance</option>
            `}
        </select>
      </label>
      <label class="check-row">
        <input name="billable" type="checkbox" checked />
        <span>Billable time</span>
      </label>
      <button type="submit">Clock in with GPS</button>
    </form>
  `;
}

function renderClockSession() {
  const session = state.clockSession;
  return `
    <div class="clock-card">
      <span>Clocked in</span>
      <h3>${escapeHtml(session.worker)}</h3>
      <p>${escapeHtml(session.job)} - ${escapeHtml(session.task)}</p>
      <dl>
        <div><dt>Started</dt><dd>${escapeHtml(formatTime(session.start))}</dd></div>
        <div><dt>GPS</dt><dd>${escapeHtml(session.startGps?.label || "Pending")}</dd></div>
        <div><dt>Hours</dt><dd>${escapeHtml(durationLabel(session.start))}</dd></div>
      </dl>
      <button type="button" data-action="clock-out">Clock out with GPS</button>
    </div>
  `;
}

function renderTimeEntries(entries = state.timeEntries) {
  if (!entries.length) {
    return `<div class="empty-state"><strong>No time entries yet</strong><span>Clock in to create the first GPS-backed entry.</span></div>`;
  }
  return `
    <table class="data-table">
      <thead>
        <tr><th>Worker</th><th>Job</th><th>Task</th><th>Start</th><th>End</th><th>Hours</th><th>GPS</th></tr>
      </thead>
      <tbody>
        ${entries
          .map(
            (entry) => `
              <tr>
                <td><strong>${escapeHtml(entry.worker)}</strong></td>
                <td>${escapeHtml(entry.job)}</td>
                <td>${escapeHtml(entry.task || "Field work")}</td>
                <td>${escapeHtml(formatTime(entry.start))}</td>
                <td>${escapeHtml(formatTime(entry.end))}</td>
                <td>${escapeHtml(entry.hours)}</td>
                <td>${escapeHtml(entry.startGps?.label || "Saved")}</td>
              </tr>
            `
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderMobileDrawer() {
  const visibleModules = filteredModules();
  const quickModules = (state.employeeMode ? employeeModuleKeys() : pinnedKeys())
    .map((key) => moduleByKey(key))
    .filter(Boolean)
    .slice(0, 6);
  return `
    <div class="mobile-drawer${state.mobileOpen ? " open" : ""}" aria-hidden="${state.mobileOpen ? "false" : "true"}">
      <div class="drawer-panel">
        <div class="drawer-brand">
          ${renderBrandLogo("mobile-brand-logo", "Brothers logo")}
          <div>
            <span>${state.employeeMode ? "Field access" : "Operations nav"}</span>
            <strong>Brothers OS</strong>
          </div>
        </div>
        <div class="panel-head">
          <div><h2>Modules</h2><p>${visibleModules.length} available in this workspace view</p></div>
          <button type="button" data-action="mobile-close">Close</button>
        </div>
        <div class="drawer-search">
          <label>
            <span>Search modules</span>
            <input data-field="search" type="search" value="${escapeHtml(state.search)}" placeholder="Find a module" ${state.employeeMode ? "disabled" : ""} />
          </label>
        </div>
        <div class="drawer-quick-grid">
          ${quickModules
            .map(
              (module) => `
                <button type="button" class="quick-button${state.activeKey === module.key ? " active" : ""}" data-action="set-active" data-key="${module.key}">
                  <span>${escapeHtml(module.label)}</span>
                  <small>${filesForModule(module.key).length} files</small>
                </button>
              `
            )
            .join("")}
        </div>
        <div class="drawer-list">
          ${visibleModules
            .map(
              (module) => `<a href="#module/${module.key}" data-action="set-active" data-key="${module.key}">${escapeHtml(module.label)}<span>${escapeHtml(categoryLabels[module.category] || module.category)}</span></a>`
            )
            .join("")}
        </div>
      </div>
    </div>
  `;
}

function renderAICopilotBar() {
  const metrics = copilotMetrics();
  return `
    <aside class="ai-copilot ${state.aiCopilotOpen ? "open" : "closed"}">
      <button type="button" class="copilot-toggle" data-action="toggle-ai-copilot">${state.aiCopilotOpen ? "Brother" : "Ask Brother"}</button>
      ${
        state.aiCopilotOpen
          ? `
            <div class="copilot-panel">
              <div class="copilot-head">
                <div>
                  <strong>${escapeHtml(state.aiCopilotProfile.nickname)}</strong>
                  <span>${escapeHtml(state.aiCopilotProfile.mode)}</span>
                </div>
                <button type="button" data-action="toggle-ai-copilot">Hide</button>
              </div>
              <div class="copilot-capacity">
                <span>${metrics.modules} modules</span>
                <span>${metrics.files} files</span>
                <span>${metrics.jobs} jobs</span>
                <span>${metrics.activePrices} prices</span>
                <span>${state.aiCopilotMemory.length} memories</span>
              </div>
              <div class="copilot-messages">
                ${state.aiCopilotMessages
                  .slice(0, 12)
                  .map((message) => `<div class="${message.role === "user" ? "user" : "assistant"}"><strong>${message.role === "user" ? "You" : "Brother"}</strong><span>${escapeHtml(message.text)}</span></div>`)
                  .join("")}
              </div>
              <div class="copilot-prompts">
                <button type="button" data-action="ai-copilot-prompt" data-prompt="What can you do inside Brothers OS?">OS</button>
                <button type="button" data-action="ai-copilot-prompt" data-prompt="Summarize job blockers and next actions">Jobs</button>
                <button type="button" data-action="ai-copilot-prompt" data-prompt="Summarize dry logs and moisture readings">Dry logs</button>
                <button type="button" data-action="ai-copilot-prompt" data-prompt="Show money, invoices, receivables, and profit">Money</button>
              </div>
              <div class="copilot-input">
                <textarea data-field="ai-copilot-query" rows="3" placeholder="Talk to Brother Copilot about any OS module, job, dry log, price, rebuttal, task, or calculation">${escapeHtml(state.aiCopilotQuery)}</textarea>
                <button type="button" data-action="ai-copilot-ask">Ask</button>
              </div>
              <p class="copilot-note">${escapeHtml(state.aiCopilotProfile.contextCapacity)}</p>
              <p class="copilot-note">${escapeHtml(`${state.aiCopilotProfile.computationCapacity} ${state.aiCopilotProfile.backendStatus}`)}</p>
            </div>
          `
          : ""
      }
    </aside>
  `;
}

function renderSettingsDock() {
  return `
    <aside class="settings-dock">
      <button type="button" data-action="set-active" data-key="settings">Settings</button>
      <span>${state.authSession ? `${escapeHtml(currentRoleId().replace(/_/g, " "))} / secure session` : "2FA / password / plan"}</span>
    </aside>
  `;
}

function renderModal() {
  if (!state.modal) return "";
  if (state.modal.type === "create-file") return renderCreateFileModal();
  if (state.modal.type === "activity") return renderActivityModal();
  if (state.modal.type === "export") return renderExportModal();
  if (state.modal.type === "employee-login") return renderEmployeeLoginModal();
  if (state.modal.type === "service-request") return renderServiceRequestModal();
  if (state.modal.type === "quick-note") return renderQuickNoteModal();
  if (state.modal.type === "admin-edit") return renderAdminEditOverlay();
  if (state.modal.type === "user-manage") return renderUserManageModal();
  return "";
}

function modalShell(content) {
  return `
    <div class="modal-backdrop" role="presentation" data-action="close-modal">
      <div class="modal-panel" role="dialog" aria-modal="true">
        ${content}
      </div>
    </div>
  `;
}

function renderCreateFileModal() {
  const module = moduleByKey(state.modal.moduleKey) || activeModule();
  return `
    <div class="modal-backdrop" role="presentation" data-action="close-modal">
      <form class="modal-panel" data-form="create-file" role="dialog" aria-modal="true">
        <div class="modal-head">
          <div><span>${escapeHtml(module.label)}</span><h2>Create module file</h2></div>
          <button type="button" data-action="close-modal" aria-label="Close">Close</button>
        </div>
        <input type="hidden" name="moduleKey" value="${module.key}" />
        <label><span>Title</span><input name="title" required placeholder="${escapeHtml(module.label)} file" /></label>
        <div class="form-grid">
          <label><span>Type</span><input name="type" value="${escapeHtml(suggestedFileType(module))}" /></label>
          <label><span>Owner</span><input name="owner" value="${escapeHtml(state.worker?.name || "Office")}" /></label>
          <label>
            <span>Status</span>
            <select name="status">
              <option>Open</option>
              <option>Active</option>
              <option>Needs review</option>
              <option>Drafting</option>
              <option>Complete</option>
            </select>
          </label>
          <label>
            <span>Priority</span>
            <select name="priority">
              <option>Medium</option>
              <option>High</option>
              <option>Low</option>
            </select>
          </label>
          <label><span>Due</span><input name="due" type="date" /></label>
          <label><span>Related job</span><input name="relatedJob" placeholder="J-0000 or property" /></label>
        </div>
        <label><span>Notes</span><textarea name="notes" rows="4" placeholder="Scope, risk, next step, missing docs, approvals, or GPS/time notes"></textarea></label>
        <div class="modal-actions">
          <button type="button" data-action="close-modal">Cancel</button>
          <button type="submit">Create file</button>
        </div>
      </form>
    </div>
  `;
}

function renderActivityModal() {
  return modalShell(`
    <div class="modal-head">
      <div><span>Workspace</span><h2 id="activity-title">Alerts and activity</h2></div>
      <button type="button" data-action="close-activity" aria-label="Close">Close</button>
    </div>
    <div class="activity-list">
      ${state.activity
        .map((item) => `<div><strong>${escapeHtml(formatTime(item.time))}</strong><span>${escapeHtml(item.text)}</span></div>`)
        .join("")}
    </div>
    <div class="modal-actions">
      <button type="button" data-action="clear-activity">Clear read alerts</button>
      <button type="button" data-action="close-activity">Done</button>
    </div>
  `).replace('class="modal-panel"', 'class="modal-panel" aria-labelledby="activity-title"');
}

function renderExportModal() {
  const summary = {
    modules: modules.length,
    files: state.files.length,
    queue: state.queue.length,
    timeEntries: state.timeEntries.length,
    photoRecords: (state.photoRecords || []).length,
    dryLogs: state.dryLogs.length,
    serviceRequests: state.serviceRequests.length,
    callouts: state.calloutSchedule.length,
    aiMemories: state.aiCopilotMemory.length,
    exportedAt: new Date().toISOString()
  };
  return modalShell(`
    <div class="modal-head">
      <div><span>Local workspace</span><h2 id="export-title">Export dashboard data</h2></div>
      <button type="button" data-action="close-export" aria-label="Close">Close</button>
    </div>
    <pre class="export-preview">${escapeHtml(JSON.stringify(summary, null, 2))}</pre>
    <div class="modal-actions">
      <button type="button" data-action="download-export">Download JSON</button>
      <button type="button" data-action="close-export">Done</button>
    </div>
  `).replace('class="modal-panel"', 'class="modal-panel" aria-labelledby="export-title"');
}

function renderEmployeeLoginModal() {
  return modalShell(`
    <form class="employee-login-panel" data-form="employee-login">
      <div class="modal-head">
        <div><span>Employee access</span><h2>Restricted field portal</h2></div>
        <button type="button" data-action="close-modal" aria-label="Close">Close</button>
      </div>
      <p>Employees can clock in/out with GPS, see only assigned jobs and tasks, upload photo evidence, and add job notes through approved field modules.</p>
      <label><span>Employee email or name</span><input name="identifier" required placeholder="worker@company.com" autocomplete="username" /></label>
      <label><span>Individual portal code</span><input name="code" required placeholder="FIELD-2039" autocomplete="one-time-code" /></label>
      <div class="modal-actions">
        <button type="button" data-action="close-modal">Cancel</button>
        <button type="submit">Enter field portal</button>
      </div>
    </form>
  `);
}

function renderAdminEditOverlay() {
  return modalShell(`
    <div class="modal-head">
      <div><span>Admin edit mode</span><h2>Live page editor overlay</h2></div>
      <button type="button" data-action="close-modal" aria-label="Close">Close</button>
    </div>
    ${renderAdminEditModePanel()}
  `);
}

function renderUserManageModal() {
  const member = (state.accessContext?.users || []).find((user) => (user.uid || user.id) === state.modal.userId);
  const roles = state.accessContext?.roles || [];
  const selectableRoles = roles.filter((role) => role.id !== "super_admin" || role.id === member?.roleId);
  if (!member) {
    return modalShell(`
      <div class="modal-head">
        <div><span>User</span><h2>User not found</h2></div>
        <button type="button" data-action="close-modal" aria-label="Close">Close</button>
      </div>
    `);
  }
  return modalShell(`
    <form class="stack-form" data-form="user-manage">
      <div class="modal-head">
        <div><span>Secure user</span><h2>${escapeHtml(member.displayName || member.email || member.uid)}</h2></div>
        <button type="button" data-action="close-modal" aria-label="Close">Close</button>
      </div>
      <input type="hidden" name="uid" value="${escapeHtml(member.uid || member.id)}" />
      <div class="form-grid">
        <label><span>Display name</span><input name="displayName" value="${escapeHtml(member.displayName || "")}" /></label>
        <label><span>Role</span><select name="roleId">${selectableRoles.map((role) => `<option value="${role.id}"${role.id === member.roleId ? " selected" : ""}>${escapeHtml(role.label || role.id)}</option>`).join("")}</select></label>
        <label><span>Company id</span><input name="companyId" value="${escapeHtml(member.companyId || "")}" /></label>
        <label><span>Franchise ids</span><input name="franchiseIds" value="${escapeHtml((member.franchiseIds || []).join(","))}" /></label>
        <label><span>Contractor id</span><input name="contractorId" value="${escapeHtml(member.contractorId || "")}" /></label>
        <label><span>Access expires</span><input name="accessExpiresAt" value="${escapeHtml(member.accessExpiresAt || "")}" /></label>
        <label><span>New access code</span><input name="accessCode" placeholder="Leave blank to keep current code" /></label>
        <label><span>Status</span><select name="disabled"><option value="false"${member.disabled ? "" : " selected"}>Active</option><option value="true"${member.disabled ? " selected" : ""}>Disabled</option></select></label>
      </div>
      <div class="modal-actions">
        <button type="button" data-action="close-modal">Cancel</button>
        <button type="submit">Save user</button>
      </div>
    </form>
  `);
}

function renderServiceRequestModal() {
  return modalShell(`
    <form class="service-request-form" data-form="service-request">
      <div class="modal-head">
        <div><span>Service request</span><h2>Request help / schedule callout</h2></div>
        <button type="button" data-action="close-modal" aria-label="Close">Close</button>
      </div>
      <p>Submitting this creates an intake file, dispatch task, owner email notification draft, and callout schedule item.</p>
      <div class="form-grid">
        <label><span>Name</span><input name="name" required placeholder="Customer or company" /></label>
        <label><span>Phone</span><input name="phone" type="tel" placeholder="Best callback number" /></label>
        <label><span>Email</span><input name="email" type="email" placeholder="customer@example.com" /></label>
        <label><span>Notify owner email</span><input name="notifyEmail" type="email" value="${escapeHtml(state.serviceSettings.ownerEmail)}" /></label>
        <label><span>Service type</span><select name="serviceType"><option>Emergency restoration</option><option>Water damage</option><option>Mold / indoor air</option><option>Rebuild / repair</option><option>Property management service</option><option>General service</option></select></label>
        <label><span>Urgency</span><select name="urgency"><option>Emergency / immediate</option><option>Same day callout</option><option>This week</option><option>Estimate / consultation</option></select></label>
        <label><span>Preferred date</span><input name="preferredDate" type="date" value="${today.toISOString().slice(0, 10)}" /></label>
        <label><span>Preferred time</span><input name="preferredTime" type="time" value="09:00" /></label>
      </div>
      <label><span>Service address</span><input name="address" placeholder="Street, city, state, unit" /></label>
      <label><span>What do they need help with?</span><textarea name="notes" rows="4" placeholder="Loss type, urgency, access notes, visible damage, preferred callback details"></textarea></label>
      <div class="email-ready-box">
        <strong>Email notification path</strong>
        <span>${escapeHtml(state.serviceSettings.notificationMode)} - ${escapeHtml(state.serviceSettings.ownerEmail)} - backend target ${escapeHtml(state.serviceSettings.backendEndpoint)}</span>
      </div>
      <div class="modal-actions">
        <button type="button" data-action="close-modal">Cancel</button>
        <button type="submit">Create request and schedule callout</button>
      </div>
    </form>
  `);
}

function renderQuickNoteModal() {
  const module = moduleByKey(state.modal.moduleKey) || activeModule();
  return modalShell(`
    <form data-form="quick-note" class="stack-form">
      <div class="modal-head">
        <div><span>${escapeHtml(module.label)}</span><h2>Add quick note</h2></div>
        <button type="button" data-action="close-modal" aria-label="Close">Close</button>
      </div>
      <input type="hidden" name="moduleKey" value="${module.key}" />
      <label><span>Note title</span><input name="title" required value="${escapeHtml(module.label)} note" /></label>
      <label><span>Note</span><textarea name="notes" rows="5" required placeholder="What changed, what is missing, or what needs owner review?"></textarea></label>
      <div class="modal-actions">
        <button type="button" data-action="close-modal">Cancel</button>
        <button type="submit">Save note</button>
      </div>
    </form>
  `);
}

function downloadExport() {
  if (state.authSession && !canDo("viewGlobalIndexes")) {
    setToast("Export is restricted to Super Admin access.");
    return;
  }
  const payload = {
    modules,
    files: state.files,
    queue: state.queue,
    timeEntries: state.timeEntries,
    photoRecords: state.photoRecords,
    standardsOutputs: state.standardsOutputs,
    learnedJargon: state.learnedJargon,
    equipmentDeployments: state.equipmentDeployments,
    dryLogs: state.dryLogs,
    jobBoards: state.jobBoards,
    contacts: state.contacts,
    branches: state.branches,
    priceItems: state.priceItems,
    xactimateImports: state.xactimateImports,
    estimateDraft: state.estimateDraft,
    quickBooksConnection: state.quickBooksConnection,
    accountProfile: state.accountProfile,
    teamMembers: state.teamMembers,
    tasks: state.tasks,
    sketchRooms: state.sketchRooms,
    performanceMetrics: state.performanceMetrics,
    actionDashboard: state.actionDashboard,
    skillPacks: state.skillPacks,
    dataVaults: state.dataVaults,
    institutionalReview: state.institutionalReview,
    serviceSettings: state.serviceSettings,
    serviceRequests: state.serviceRequests,
    calloutSchedule: state.calloutSchedule,
    industryProfile: state.industryProfile,
    aiCopilotProfile: state.aiCopilotProfile,
    aiCopilotMemory: state.aiCopilotMemory,
    aiCopilotMessages: state.aiCopilotMessages,
    activity: state.activity,
    exportedAt: new Date().toISOString()
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `brothers-os-export-${today.toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  addActivity("Exported local workspace JSON.");
  persist();
  setToast("Export downloaded");
}

async function copyLaunchEnv() {
  const envText = [
    "OS_BASE_URL=https://brothers.ad",
    "FIREBASE_ALLOWED_SIGN_IN_PROVIDERS=google.com",
    "FIREBASE_OWNER_ONLY_LOGIN=true",
    "FIREBASE_ALLOWED_LOGIN_EMAILS=david@brothersrestoration.org",
    "FIREBASE_SESSION_TTL_MS=172800000",
    "SUPER_ADMIN_EMAILS=david@brothersrestoration.org",
    "FIREBASE_SERVICE_ACCOUNT_JSON=<paste Firebase service-account JSON in Vercel>",
    "RESEND_API_KEY=<optional invite email provider key>",
    "INVITE_FROM_EMAIL=Brothers OS <access@brothers.ad>"
  ].join("\n");
  try {
    await navigator.clipboard.writeText(envText);
    setToast("Launch env copied");
  } catch (_error) {
    setToast("Launch env ready: OS_BASE_URL=https://brothers.ad");
  }
  render();
}

document.addEventListener("click", (event) => {
  const actionElement = event.target.closest("[data-action]");
  if (!actionElement) return;
  const action = actionElement.dataset.action;
  const key = actionElement.dataset.key;
  const id = actionElement.dataset.id;

  if (actionElement.classList.contains("modal-backdrop") && event.target !== actionElement) return;

  if (actionElement.tagName === "A" || actionElement.closest(".modal-backdrop")) {
    event.preventDefault();
  }

  if (action === "set-active") return routeToModule(key);
  if (action === "mobile-open") {
    state.mobileOpen = true;
    return render();
  }
  if (action === "mobile-close") {
    state.mobileOpen = false;
    return render();
  }
  if (action === "open-create-file") return openCreateFile(key || state.activeKey);
  if (action === "open-activity") {
    state.modal = { type: "activity" };
    return render();
  }
  if (action === "open-export") {
    if (state.authSession && !canDo("viewGlobalIndexes")) {
      setToast("Export is restricted to Super Admin access.");
      return render();
    }
    state.modal = { type: "export" };
    return render();
  }
  if (action === "open-service-request") {
    state.modal = { type: "service-request" };
    return render();
  }
  if (action === "open-employee-login") {
    state.modal = { type: "employee-login" };
    return render();
  }
  if (action === "open-admin-edit") {
    if (!canDo("manageSections")) {
      setToast("Admin edit mode is restricted.");
      return render();
    }
    state.adminEditMode = true;
    state.modal = { type: "admin-edit" };
    return render();
  }
  if (action === "open-user-manage") {
    state.modal = { type: "user-manage", userId: id };
    return render();
  }
  if (action === "firebase-logout") return signOutFirebaseAuth();
  if (action === "toggle-admin-edit") {
    if (!canDo("manageSections")) {
      setToast("Admin edit mode is restricted.");
      return render();
    }
    state.adminEditMode = !state.adminEditMode;
    state.modal = state.adminEditMode ? { type: "admin-edit" } : null;
    return render();
  }
  if (action === "reset-user-permissions") {
    return resetSecureUserPermissions(id).catch((error) => {
      setToast(error.message || "Unable to reset user permissions");
      render();
    });
  }
  if (action === "toggle-user-disabled") {
    return updateSecureUser({
      uid: id,
      disabled: String(actionElement.dataset.disabled || "false") !== "true"
    }).catch((error) => {
      setToast(error.message || "Unable to update user status");
      render();
    });
  }
  if (action === "delete-user") {
    return deleteSecureUser(id).catch((error) => {
      setToast(error.message || "Unable to delete user");
      render();
    });
  }
  if (action === "close-modal" || action === "close-activity" || action === "close-export") return closeModal();
  if (action === "clear-activity") {
    state.activity = [];
    persist();
    return render();
  }
  if (action === "download-export") return downloadExport();
  if (action === "copy-launch-env") return copyLaunchEnv();
  if (action === "reset-action-dashboard") return resetActionDashboard();
  if (action === "run-institutional-review") return runInstitutionalReview();
  if (action === "create-investor-report") return createInvestorReport();
  if (action === "toggle-skill-pack") return toggleSkillPack(id);
  if (action === "toggle-data-vault") return toggleDataVault(id);
  if (action === "mark-callout-scheduled") return markCalloutScheduled(id);
  if (action === "complete-service-request") return completeServiceRequest(id);
  if (action === "quick-note") {
    state.modal = { type: "quick-note", moduleKey: key || state.activeKey };
    return render();
  }
  if (action === "select-file") {
    state.selectedFileId = id;
    persist();
    return render();
  }
  if (action === "complete-file") return updateFileStatus(id, "Complete");
  if (action === "status-review") return updateFileStatus(id, "Needs review");
  if (action === "status-active") return updateFileStatus(id, "Active");
  if (action === "duplicate-file") return duplicateFile(id);
  if (action === "delete-file") return deleteFile(id);
  if (action === "capture-equipment-gps") return captureEquipmentGps();
  if (action === "create-equipment-invoice") return createEquipmentInvoice(id);
  if (action === "generate-rebuttal") return generateStandardsFromButton(actionElement, "rebuttal", "Rebuttal generated");
  if (action === "run-live-source-check") return generateStandardsFromButton(actionElement, "code-search", "Source-check file prepared");
  if (action === "toggle-job-gate") return toggleJobGate(id, actionElement.dataset.gate);
  if (action === "create-job-packet") return createJobPacket(id);
  if (action === "create-drylog-packet") return createDryLogPacket(id);
  if (action === "log-contact-touch") return logContactTouch(id);
  if (action === "create-contact-file") return createContactFile(id);
  if (action === "copy-branch-code") return copyBranchCode(id);
  if (action === "toggle-branch-module") return toggleBranchModule(id, key);
  if (action === "create-branch-file") return createBranchFile(id);
  if (action === "download-estimate") return downloadEstimate();
  if (action === "create-estimate-invoice") return createEstimateInvoice();
  if (action === "remove-estimate-line") return removeEstimateLine(id);
  if (action === "import-sample-pricing") return importSamplePricing();
  if (action === "connect-quickbooks") return connectQuickBooks();
  if (action === "create-payment-rail") return createPaymentRailSetup(actionElement.dataset.method || "Payment", actionElement.dataset.route || "gateway-ready", actionElement.dataset.detail || "Payment rail setup");
  if (action === "complete-task") return completeTask(id);
  if (action === "professionalize-sketch") return professionalizeSketch();
  if (action === "select-sketch-room") {
    const room = state.sketchRooms.find((item) => item.id === id);
    if (room) {
      createFile({
        moduleKey: "sketch",
        title: `${room.name} sketch room`,
        type: "Sketch room",
        owner: "Estimator",
        status: "Active",
        priority: "Medium",
        relatedJob: room.assignedJob,
        notes: `${room.width} x ${room.height}\n${room.notes}\nScribble: ${room.scribble}`
      });
    }
    return;
  }
  if (action === "toggle-ai-copilot") {
    state.aiCopilotOpen = !state.aiCopilotOpen;
    persist();
    return render();
  }
  if (action === "ai-copilot-ask") return askAiCopilot();
  if (action === "ai-copilot-prompt") return askAiCopilot(actionElement.dataset.prompt || "");
  if (action === "save-standards-output") return saveStandardsOutputAsFile(id);
  if (action === "copy-standards-output") return copyStandardsOutput(id);
  if (action === "complete-queue") return completeQueue(id);
  if (action === "refresh-insurance-intake") return loadInsuranceWorkspace(true);
  if (action === "refresh-selected-insurance") return refreshSelectedInsuranceSubmission();
  if (action === "insurance-admin-logout") return logoutInsuranceAdmin();
  if (action === "firebase-google-login") return submitFirebaseGoogleLogin();
  if (action === "select-insurance-submission") {
    state.selectedInsuranceId = id;
    persist();
    render();
    return refreshSelectedInsuranceSubmission();
  }
  if (action === "seed-queue") {
    const module = moduleByKey(key) || activeModule();
    state.queue = [
      {
        id: createId("Q"),
        moduleKey: module.key,
        label: `Review ${module.label}`,
        detail: "Generated checklist item for module follow-up.",
        priority: "Medium"
      },
      ...state.queue
    ];
    addActivity(`Added queue check for ${module.label}.`);
    persist();
    return render();
  }
  if (action === "clock-out") return clockOut();
  if (action === "employee-logout") {
    state.employeeMode = false;
    state.worker = null;
    state.activeKey = "daily";
    addActivity("Returned to owner view.");
    persist();
    return routeToModule("daily");
  }
});

document.addEventListener("submit", (event) => {
  const form = event.target.closest("form[data-form]");
  if (!form) return;
  event.preventDefault();
  const formData = new FormData(form);
  const type = form.dataset.form;
  if (type === "create-file") {
    createFile(Object.fromEntries(formData.entries()));
  }
  if (type === "quick-note") {
    createFile({
      moduleKey: formData.get("moduleKey"),
      title: formData.get("title"),
      type: "Quick note",
      status: "Open",
      priority: "Medium",
      notes: formData.get("notes")
    });
  }
  if (type === "standards-ai") {
    const output = buildStandardsOutput(formData);
    saveGeneratedStandardsOutput(output);
  }
  if (type === "equipment-deployment") {
    addEquipmentDeployment(formData);
  }
  if (type === "job-record") {
    addJobRecord(formData);
  }
  if (type === "dry-log") {
    addDryLogRecord(formData);
  }
  if (type === "photo-evidence") {
    return addPhotoEvidence(formData).catch((error) => {
      setToast(error.message || "Unable to save photo evidence");
      render();
    });
  }
  if (type === "job-note") {
    addJobNote(formData);
  }
  if (type === "contact-record") {
    addContactRecord(formData);
  }
  if (type === "branch-record") {
    addBranchRecord(formData);
  }
  if (type === "price-item") {
    addPriceItem(formData);
  }
  if (type === "pasted-pricing-import") {
    importPastedPricing(formData);
  }
  if (type === "estimate-settings") {
    applyEstimateSettings(formData);
  }
  if (type === "estimate-line") {
    addEstimateLine(formData);
  }
  if (type === "payment-request") {
    createPaymentRequest(formData);
  }
  if (type === "team-member") {
    addTeamMember(formData);
  }
  if (type === "task") {
    addTask(formData);
  }
  if (type === "sketch-room") {
    addSketchRoom(formData);
  }
  if (type === "defensibility-review") {
    generateDefensibilityReview(formData);
  }
  if (type === "supplement-packet") {
    generateSupplementPacket(formData);
  }
  if (type === "performance-metric") {
    updatePerformanceMetric(formData);
  }
  if (type === "service-request") {
    addServiceRequest(formData);
  }
  if (type === "action-dashboard") {
    saveActionDashboard(formData);
  }
  if (type === "module-workbench") {
    createWorkbenchRecord(formData);
  }
  if (type === "employee-login") {
    loginEmployeePortal(formData);
  }
  if (type === "insurance-admin-login") {
    return loginInsuranceAdmin(formData);
  }
  if (type === "firebase-login") {
    return submitFirebaseLogin(formData);
  }
  if (type === "access-request") {
    return requestTrialAccess(formData);
  }
  if (type === "rbac-user") {
    return createSecureUser(formData).catch((error) => {
      setToast(error.message || "Unable to create Firebase user");
      render();
    });
  }
  if (type === "access-grant") {
    return createAccessGrant(formData).catch((error) => {
      setToast(error.message || "Unable to issue access grant");
      render();
    });
  }
  if (type === "community-post") {
    return createCommunityPost(formData).catch((error) => {
      setToast(error.message || "Unable to publish post");
      render();
    });
  }
  if (type === "community-comment") {
    return addCommunityComment(formData).catch((error) => {
      setToast(error.message || "Unable to add comment");
      render();
    });
  }
  if (type === "user-manage") {
    return updateSecureUser({
      uid: String(formData.get("uid") || "").trim(),
      displayName: String(formData.get("displayName") || "").trim(),
      roleId: String(formData.get("roleId") || "worker").trim(),
      companyId: String(formData.get("companyId") || "").trim(),
      franchiseIds: csvValues(formData.get("franchiseIds")),
      contractorId: String(formData.get("contractorId") || "").trim(),
      accessExpiresAt: String(formData.get("accessExpiresAt") || "").trim(),
      accessCode: String(formData.get("accessCode") || "").trim(),
      disabled: String(formData.get("disabled") || "false") === "true"
    }).then(() => {
      state.modal = null;
      render();
    }).catch((error) => {
      setToast(error.message || "Unable to save user");
      render();
    });
  }
  if (type === "role-permissions") {
    return saveRolePermissions(formData).catch((error) => {
      setToast(error.message || "Unable to save role permissions");
      render();
    });
  }
  if (type === "tab-config") {
    return saveTabConfig(formData).catch((error) => {
      setToast(error.message || "Unable to save tab config");
      render();
    });
  }
  if (type === "page-config") {
    return savePageConfig(formData).catch((error) => {
      setToast(error.message || "Unable to save page config");
      render();
    });
  }
  if (type === "page-section-config") {
    return savePageSectionConfig(formData).catch((error) => {
      setToast(error.message || "Unable to save section config");
      render();
    });
  }
  if (type === "company-brand") {
    return saveCompanyBrand(formData).catch((error) => {
      setToast(error.message || "Unable to save company settings");
      render();
    });
  }
  if (type === "clock-in") {
    clockIn(formData);
  }
  if (type === "insurance-status") {
    updateInsuranceSubmissionStatus(String(formData.get("id") || ""), String(formData.get("status") || ""));
  }
  if (type === "insurance-notes") {
    updateInsuranceSubmissionNotes(String(formData.get("id") || ""), String(formData.get("notes") || ""));
  }
});

document.addEventListener("input", (event) => {
  const field = event.target.closest("[data-field]");
  if (!field) return;
  if (field.dataset.field === "search") {
    state.search = field.value;
    render();
  }
  if (field.dataset.field === "ai-copilot-query") {
    state.aiCopilotQuery = field.value;
    persist();
  }
  if (field.dataset.field === "insurance-search") {
    state.insuranceFilters.search = field.value;
    persist();
  }
});

document.addEventListener("change", (event) => {
  const field = event.target.closest("[data-field]");
  if (!field) return;
  if (field.dataset.field === "category") {
    state.category = field.value;
    persist();
    render();
  }
  if (field.dataset.field === "industry-profile") {
    state.industryProfile = field.value;
    addActivity(`Industry profile changed to ${industryProfiles[field.value]?.label || field.value}.`);
    persist();
    render();
  }
  if (field.dataset.field === "price-csv") {
    handlePriceCsvUpload(field);
  }
  if (field.dataset.field === "xactimate-import") {
    handleXactimateImport(field);
  }
  if (field.dataset.field === "estimate-logo") {
    handleLogoUpload(field);
  }
  if (field.dataset.field === "admin-image-file") {
    const [file] = field.files || [];
    if (!file) return;
    uploadAdminAssetFile(file)
      .then((assetUrl) => {
        state.adminEditAssetUrl = assetUrl;
        setToast("Section image uploaded");
        render();
      })
      .catch((error) => {
        setToast(error.message || "Unable to upload section image");
        render();
      });
  }
  if (field.dataset.field === "insurance-status") {
    state.insuranceFilters.status = field.value;
    persist();
  }
});

window.addEventListener("hashchange", () => {
  const key = getRouteKey();
  if (key && key !== state.activeKey && moduleByKey(key)) routeToModule(key);
});

if (!window.location.hash) {
  window.history.replaceState(null, "", "#module/daily");
}

render();
bootstrapFirebaseAuth();
if (state.activeKey === "insurance") {
  fetchInsuranceSubmissions();
}
