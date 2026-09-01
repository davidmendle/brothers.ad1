# Brothers OS Application Architecture

## Decision

Brothers OS remains a Next.js and Node.js application. Rewriting the web product in C++ would not improve record accuracy, authorization, or workflow reliability. Correctness is improved through explicit contracts, server-enforced authorization, transaction boundaries, durable storage, validation, and automated tests.

The product is being converted incrementally from a browser monolith into a modular monolith with bounded applications. Each application owns its modules and data namespace, and the server enforces explicit contracts for persisted cross-application record links. A bounded application can later become an independently deployed Vercel microfrontend or service without changing its IDs or contracts.

## Applications

| Application | Primary responsibility |
| --- | --- |
| Command and Governance | Super Admin access, security, branches, settings, global indexes, and integrations |
| General Contracting | Jobs, work orders, dispatch, field work, time, equipment, photos, closeout, and warranty |
| Restoration and Claims | Insurance intake, dry logs, pricing, supplements, standards, evidence, and defensibility |
| Finance and Reporting | Customer invoices, contractor invoices, accounting, subscriptions, and business reporting |
| Workforce | Employee profiles, onboarding, tasks, training, SOPs, and certifications |
| Contractor Network | Contractor portals, vendors, contracts, licensing, liens, and partner performance |
| Property and CRM | Leads, customers, relationships, properties, maps, and campaigns |
| Communications and Intelligence | Contractor discussions, email, AI review, source checks, and operating plans |

`application-registry.js` is the shared contract. Every module has exactly one owner, and connections define which application boundaries a persisted record may cross. Event names describe future asynchronous extraction points; they do not imply that a separate message bus is already running.

## Access Model

1. Super Admin can access every application and the combined global index.
2. Contractor and employee invitations store explicit module grants plus a server-derived application-access summary.
3. Selecting an application grants its modules; individual modules can still be removed for least-privilege access.
4. The server derives application IDs from trusted module definitions. Clients cannot move records into another application by submitting a different application ID.
5. Company, franchise, contractor, employee, job, and task scope checks remain mandatory inside every application.

## Data Contract

Durable records use these shared fields where applicable:

- `applicationId`: owning application derived by the server.
- `linkedApplicationIds`: connected applications derived from linked modules.
- `applicationContractVersion`: schema version for extraction and migration.
- `companyId`, `franchiseId`, `contractorId`: tenant and operational scope.
- `moduleKey`, `linkedModuleKeys`: owning module and explicit workflow links.
- `recordId`, `updatedAt`, `updatedByUid`: identity and audit metadata.

## Extraction Rules

An application is eligible for an independent deployment only after it has:

1. A stable API contract and application ID.
2. Server-side authorization tests for each role and tenant boundary.
3. Durable storage with migration and rollback procedures.
4. Idempotent events for every cross-application write.
5. Browser tests for its complete primary workflow.
6. Global-index projections that do not query another application's private tables directly.

General Contracting is the first extraction candidate because it can run ordinary service work independently while consuming workforce, contractor, restoration, and finance events.
