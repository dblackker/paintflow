# Repaint Margin Control: Technical Implementation Plan

Prepared October 3, 2026. Status: foundation implementation on `codex/repaint-margin-control`; the full program and production release are not complete. See [implementation evidence](EVIDENCE.md), [implemented contracts](CONTRACTS.md), and [release/recovery runbook](RUNBOOK.md) before promoting this branch.

## Start Here

This pack converts the [strategy assessment](../../product-strategy-assessment-2026-10.md) into a coordinated implementation program. The objective is a dependable, exceptionally usable estimate-to-actual workflow for owner-led residential repaint companies, not another general CRM expansion.

Read in this order:

1. This plan: architecture, contracts, financial policies, execution order, and release gates.
2. [Checklist](CHECKLIST.md): stable task IDs, dependencies, acceptance requirements, and evidence tracking.
3. [Mobile design spec](MOBILE-DESIGN.md): interaction, visual hierarchy, screen designs, and measurable acceptance.
4. [Agent briefs](AGENT-BRIEFS.md): assignments, exclusive file ownership, handoff prompts, and integration rules.

The coordinator owns the checklist. Agents deliver code, tests, screenshots, migration notes, and handoff evidence against their assigned IDs. A checked box means verified acceptance, not "code was written."

For the next estimating tranche, see the [painting estimator comparison and improvement plan](../../painting-estimator-comparison-and-plan-2026-10.md). It compares current PaintScout, DripJobs, and Estimate Rocket documentation against the merged calculation foundation, with additional PE task IDs. Its tasks are proposals, not newly completed checklist items.

### Product Outcome

An owner can create an accurate repaint estimate, obtain the required signatures, schedule under the company's deposit policy, capture crew time and supplier purchases, collect or refund payments safely, and understand the job's cost position. A completed job produces a useful lesson for the next bid.

The short-term release should deliver financial truth and easy capture. Forecasting and rate recommendations follow only when the underlying data qualifies. Do not wait for predictive features to repair current reporting or material calculation defects.

### Boundaries

- Preserve working CRM, proposal, standalone invoice, calendar, messaging, crew, and customer-portal behavior.
- Keep legal agreements, invoices, payments, and accounting exports related but distinct.
- No payroll processor, full accounting ledger, autonomous purchasing/payments, general marketing builder, all-trade rewrite, or restored customer-color workflow.
- Do not reintroduce the removed color-selection feature flag or build a general feature-flag platform. Use existing environment controls and controlled release promotion where sufficient.
- No live charges, refunds, customer email campaigns, production reseeding, credential changes, or production data repair from an agent's test suite.
- This document defines implementation defaults. Material changes to existing signed agreements or historical financial records require explicit review, not silent reinterpretation.

## 1. Establish A Safe Starting Point

The preceding assessment found an extensively modified worktree and differences between local and remote `main`. Before dispatching agents:

1. Record the actual branch, commit, working-tree changes, and deployment revision again. Do not assume the assessment snapshot is still current.
2. Identify the work that should be included in the agreed implementation baseline. Preserve other contributors' edits; do not reset, clean, or commit them indiscriminately.
3. Include this pack and the referenced strategy assessment in the committed baseline, then create a coordinator integration branch named `codex/repaint-margin-control`. Agent branches use `codex/repaint-<stream>`, all from that agreed baseline. Untracked documents do not automatically follow new worktrees; separate worktrees are preferable to simultaneous edits in one checkout.
4. Verify dev/staging database separation. Provision an isolated disposable test database or test branch; never seed the production database from CI.
5. Capture current behavior and financial fixtures before changing semantics. Identify immutable documents and reconcile schema migration history with the actual database.

Use the repository's Windows/WSL preference. Preserve React/Vite, Hono/Workers, Neon/Drizzle, and the established design system. Read [AGENTS.md](../../../AGENTS.md), [CLAUDE.md](../../../CLAUDE.md), and [action-copy guidelines](../../action-copy-guidelines.md). Where architecture documentation conflicts with code, record the discrepancy and follow verified runtime behavior.

## 2. Execution Waves And Dependencies

| Wave | Parallel streams | Required output | Exit gate |
| --- | --- | --- | --- |
| 0: Baseline and contracts | Coordinator + QA; specialist review from finance/estimation/design | Baseline, fixtures, contract registry, risk reproductions, ownership map | G0: contracts and historical preservation policy accepted. |
| 1: Trust foundations | Estimation, finance, supplier ingestion, design primitives | Money/calculation engine, atomic operation primitives, import/usage safeguards, accessible responsive components | G1: unit and database invariants pass; shared APIs/components stable. |
| 2: Integrated workflows | Field UX, accounting, activation; finance/estimation adapters finish | Updated estimating/job/time/invoice/portal journeys, QBO handoff, consistent entitlements/setup | G2: real API-backed lifecycle and mobile scenarios pass. |
| 3: Controlled release | QA + coordinator with stream owners | CI gates, migrations/backfill dry run, provider sandbox evidence, staging visual checks | G3: release checks complete and rollback/recovery rehearsed. |
| 4: Pilot and differentiation | Field UX/estimation/activation, guided by pilot evidence | Cost completeness, forecast, reviewed rate suggestions, implementation playbook | G4: paid users demonstrate a repeatable outcome. |

Limit simultaneous cross-domain implementation to the coordinator's review capacity, initially four delivery streams. More agents do not make unreviewed shared-schema changes safe. Investigations and independent test writing can run in parallel with delivery work.

Do not start accounting adapters against invented events or frontend screens against invented totals. Use contract fixtures while dependencies are in progress, then replace fixtures with real API-backed tests before acceptance.

## 3. Ownership And Shared Contracts

The coordinator is the only writer of shared schema/migration files, root manifests/lockfile, workflow files, core export barrel, route registration, and cross-stream contract definitions. Specialists propose patches and tests; the coordinator integrates them. This is a file-ownership rule, not a prohibition on collaboration.

Proposed module locations, to be reconciled with existing helpers before creation:

| Location | Purpose | Primary owner |
| --- | --- | --- |
| `packages/core/src/estimation/` | Exact quantities, units, coverage, purchase grouping, versioned estimate calculation | Estimation |
| `packages/core/src/finance/` | Invoice/payment/refund rules, financial summaries, lifecycle transitions | Finance |
| `packages/core/src/contracts/` | Shared DTOs, event envelopes, typed errors, calculation versions | Coordinator |
| `apps/api/src/services/finance/` | Database-backed atomic operations, provider adapters, reconciliation | Finance |
| `apps/api/src/services/supplier-imports/` | Intake, deduplication, approval, OCR reservations, evaluation | Supplier |
| `apps/api/src/services/accounting/` | QBO mapping, dispatch, reconciliation | Accounting |
| `apps/web/src/components/` | Shared actions, fields, sheets, menus, async states | Design |
| `tests/unit/`, `tests/integration/`, `tests/e2e/` | Domain, real-database/API, and browser coverage | QA, with stream-local fixtures |

Use pure domain functions in `packages/core`; do not import Hono, database clients, browser globals, or provider SDKs there. Endpoint handlers validate, authorize, invoke services, and map errors. Avoid moving entire thousand-line route files merely to rename them.

### Contract Registry

During Wave 0, commit a contract registry within this folder containing the actual accepted DTOs and policy decisions. This file is an implementation deliverable, not something this planning task has already created. Freeze version 1 before specialist adapters merge.

Illustrative shape, not an already implemented API:

```ts
type Money = { currency: 'USD'; minor: number };
type Quantity = { value: string; unit: 'sq_ft' | 'linear_ft' | 'each' | 'gallon' };

interface JobFinancialSummaryV1 {
  schemaVersion: 1;
  calculationVersion: string;
  asOf: string;
  approvedScopeVersion: string;
  contractedSubtotal: Money;
  invoicedGross: Money;
  collectedGross: Money;
  refundedGross: Money;
  outstandingGross: Money;
  actualCost: Money;
  estimatedCost: Money | null;
  costCompleteness: 'unknown' | 'incomplete' | 'reviewed';
  costCoverage: { laborReviewed: boolean; purchasesReviewed: boolean };
  forecastCost: Money | null;
  forecastMarginPercent: string | null;
  warnings: Array<{ code: string; message: string; action?: string }>;
}
```

Currency is deliberately USD-only for the first release. Reject unsupported currency rather than quietly treating it as USD. Minor amounts are safe bounded integers on the wire; exact decimal strings/scaled arithmetic handle intermediate quantities and tax. Existing Postgres decimal columns can remain decimal columns with exact conversion at the boundary. Do not perform money math by multiplying parsed floating-point dollars by 100 and rounding opportunistically.

Validate integer bounds, decimal scale, sign, and currency. Use the existing toolchain where possible; the calculation owner must select and document one exact arithmetic approach before adapters are written. Do not let agents independently add competing money libraries.

### API Rules

- Reuse current public routes and add backward-compatible fields first. New route names below are proposals and must be registered/documented centrally.
- Every user mutation uses `Idempotency-Key`; webhook intake uses the provider's verified event identity. Keys are scoped by organization, action, and actor/public-token scope as appropriate.
- Same key plus identical canonical payload returns the original logical result. Same key plus different payload returns a typed conflict. Different keys still must not bypass natural/business uniqueness.
- Revision-bearing mutations reject stale versions with `409`, preserving entered values for review/retry.
- Standard errors include stable `code`, safe user-facing `message`, optional keyed `fieldErrors`, retryability, and a correlation ID. Do not leak another tenant's existence.
- Lists use bounded limits and stable cursor ordering, with server-side filters. Never make a mobile page download all years of financial/time records to filter locally.
- Finance/provider operations are not optimistically shown as succeeded. After confirmed mutation, update the affected record/query rather than clearing and reloading the entire screen.

Separate civil dates from timestamps. Invoice/purchase transaction dates retain their original business date; processing/creation timestamps do not replace them. Calendar/work dates use the organization's configured time zone. Punch/provider timestamps remain precise instants with an explicitly formatted local display. Test midnight, daylight-saving changes, missing source date, and backdated manual transactions.

Keep a logical operation key stable across network retry, resume, and double tap; create a new key only for a genuinely new user operation. Natural uniqueness applies to real source identities such as provider object, canonical purchase, or shift allocation. Do not impose uniqueness on payment amount/date or employee/job/day: two legitimate identical-value payments or separate same-day work segments can exist. Similarity produces an explicit duplicate warning/review, not an arbitrary ban.

## 4. Financial And Lifecycle Rules

These rules are release-blocking contracts.

### 4.1 Definitions

| Term | Definition |
| --- | --- |
| Contracted value | Base accepted scope plus approved signed changes, before sales tax; exclude canceled/superseded/voided obligations according to recorded policy. |
| Invoiced amount | Valid invoice obligations, including allocated tax; not another copy of contracted revenue. |
| Collected cash | Confirmed successful payments; refunds are separate movements. |
| Outstanding balance | Collectible obligation less valid allocations and credits; not a raw `total - payment clicks` calculation. |
| Estimated cost | Frozen approved budget assumptions, excluding selling markup and customer sales tax. |
| Actual cost | Approved attributable labor/purchases/other costs, with recorded reversals and exactly one origin per economic cost. |
| Current cost position | Contracted value minus recorded actual costs; explicitly incomplete while work/cost capture is incomplete. |
| Forecast margin | Approved scope subtotal less actual cost and estimated remaining cost; null when inputs cannot support it. |

Keep supplier tax/fees and customer sales tax distinct. Supplier acquisition tax may be an actual cost under the recorded cost policy; customer sales tax is not job operating revenue. Do not call this a full accounting P&L or silently change cash/accrual treatment.

### 4.2 Required Transitions

| Event | Required behavior |
| --- | --- |
| Unsigned proposal edited | Save a version/revision; preserve sent-state semantics; existing public link uses the intended current unsigned version; required update email is queued. |
| Proposal signed/countersigned | Capture authorized parties and immutable signed version; handoff happens once when the signature requirements are satisfied. No change to historical signed scope on recalculation. |
| Job generated | Linked job and configured milestone invoices are created once. Signature does not invent scheduled dates; deposit booking policy is explicit. |
| Change order accepted | Add approved scope/budget delta once. Create or update the intended unpaid billing obligation without rewriting an already issued/paid invoice invisibly. |
| Standalone invoice created | No proposal or signature requirement invented; link customer and optional job, calculate tax, queue email, show invoice detail. |
| Checkout started/abandoned | Track checkout attempt separately; invoice remains payable unless the provider confirms a processing payment or valid collection reservation. Browser back clears stale loading state. |
| Stripe payment succeeds | Verified account/mode/object identity creates or reconciles one payment and allocation; queue one receipt. Redirect URL alone never proves payment. |
| Manual payment recorded | Permission, amount/date/reference, current balance check, duplicate warning/confirmation, and atomic record/allocation. Optional receipt toggle queues a templated email. |
| Refund recorded | Original payment remains; refund is a separate auditable movement. Card refund calls Stripe with stable idempotency. Manual refund records money returned externally and never calls Stripe. |
| Invoice canceled/voided | Explicit permitted transition/reason; stop collection/reminders and queue template notification. Existing payments are not erased or refunded implicitly. |
| Import approved | Verify same-tenant job, record purchase and attributed costs atomically, update pricing/history under explicit rules, and store one review outcome. |

### 4.3 Refund And Credit Policy

Do not conflate sending money back with forgiving an invoice obligation. Preserve the existing intended customer experience: a fully refunded/closed invoice is not automatically payable again.

Version-1 defaults:

- A full refund closes the refunded obligation from collection. Rebilling requires a new explicit invoice/obligation, not a hidden reopened pay button.
- Partial refunds require an explicit disposition: credit/reduce the obligation, or retain/reissue a collectible obligation with clear confirmation. Default to credit, not accidental recharging.
- Separate pending, succeeded, and failed refund operations. Do not lower net collected cash before provider confirmation unless displaying a separately labeled pending movement.
- Manual refund wording: `Record refund`, with method, amount, actual refund date/reference, reason, and confirmation that money has already been returned. It is a record, not an electronic transfer.
- Compute remaining refundable amount under a lock/reservation, including pending refunds. Two concurrent requests cannot refund more than the original payment.
- Disputes/chargebacks are distinct from refunds and appear as exceptions. Unsupported handling must be visible, not counted as an ordinary successful refund.
- Timeline, invoice detail, payment detail, client portal, reminders, reports, and QBO mapping consume the same disposition result.

Finance and accounting owners must verify compatibility with current records and QBO mappings in G0. Preserve imported/historical exceptions with an explicit review state rather than fabricating credits retroactively.

### 4.4 Mixed Manual And Stripe Collections

An old Checkout link must not collect a superseded balance after a check is recorded. Enforce one active collection attempt per obligation/version and validate the current collectible amount before creating or reusing Checkout. A collection attempt is not an actual payment, and its lease/expiry must not leave an abandoned invoice indefinitely disabled.

When recording manual money against an invoice with an active online attempt, resolve/expire that attempt and reconcile provider state before assuming the remaining balance. If an online payment is processing or the outcome cannot be established, explain the conflict and require review rather than creating another charge. Test manual payment while Checkout is open, successful card payment before a delayed webhook, changed invoice balance, simultaneous clicks, and multiple browser tabs.

Unexpected money received must still be accounted for. Preserve genuine excess funds as explicit unapplied credit/overpayment under the approved policy, not a negative hidden balance, deleted payment, silent second allocation, or automatic refund. The invariant is no double collection initiated by Crewmodo and no overallocated obligation; externally received funds must remain auditable even when they need reconciliation.

## 5. Technical Workstreams

### 5.1 Estimation And Reporting Accuracy

Entry points: [production estimator](../../../apps/web/src/pages/estimates/EstimateProduction.tsx), [core rates](../../../packages/core/src/rates.ts), [rate routes](../../../apps/api/src/routes/production-rates.ts), [estimate routes](../../../apps/api/src/routes/estimates.ts), [reports](../../../apps/api/src/routes/reports.ts).

Implement:

1. Normalize room/substrate/measurement/rate inputs with explicit units and calculation version. Linear feet and counts require defensible coating-area/conversion rules; reject unsupported conversions rather than treating them as square feet.
2. Calculate labor and material cost with exact arithmetic. Separate labor selling rate from burdened labor budget cost, and acquisition cost from material selling markup.
3. Group compatible paint needs by product variant, sheen, color identity, primer/finish, and relevant substrate restrictions. Unknown color identity does not imply compatible colors.
4. Sum theoretical volume first, then round purchasable packs per compatible group. Explicitly store allowance/waste factor and pack-size choice. Allocate group cost back to scope deterministically so line totals reconcile; do not round each substrate to one gallon.
5. For unsigned documents, derive server-authoritative totals. Client previews use the same pure engine. Signed/historical totals remain frozen; discrepancies receive an audit finding, not automatic recomputation.
6. Fix report fan-out aggregation using separately aggregated one-row-per-entity data before joining. Report accepted contracted value, invoices, collections, and costs as distinct concepts. Ensure lead-based win rate counts leads, not revisions as separate leads.
7. Save estimate inputs, resolved rate/product snapshots, approved budget version, and calculation output. A later pricebook edit cannot silently change an old job's budget.

Required golden examples:

- One $1,000 accepted estimate plus two $100 costs reports $1,000 contracted subtotal, $200 cost, $800 current difference, not $2,000 revenue.
- Three compatible substrates consuming 0.4 gallons each result in 1.2 theoretical gallons and two one-gallon packs, not three packs.
- The same quantities with different colors remain separate purchase groups.
- A zero-area/omitted substrate contributes zero; optional unselected scope does not inflate budget or tax.
- $100 subtotal at a configured 9.2% tax produces $9.20 tax, not $0.092 or $920; persisted fractional versus percentage representations are explicitly converted.
- Material tax, discount, optional scope, change-order adjustment, and pack allocation obey the same rounding order across web/API.

Do not automatically claim jurisdictional tax compliance from a ZIP lookup. Record rate source, effective date, override, and exact selected rate. Customer tax rules can differ from supplier acquisition tax.

### 5.2 Atomic Persistence And Provider Work

Entry points: [database client](../../../packages/db/src/client.ts), [schema](../../../packages/db/src/schema.ts), [billing](../../../apps/api/src/routes/billing.ts), [invoice routes](../../../apps/api/src/routes/invoices.ts), [handoff](../../../apps/api/src/lib/estimate-handoff.ts).

Inventory existing columns/tables/indexes before proposing new ones. Reuse `customerInvoices`, `customerPayments`, `jobCosts`, `supplierInvoiceImports`, purchase links, transaction dates, and existing provider IDs.

Proposed additions, only where the inventory proves they are missing:

- Durable idempotent operation records: tenant/action/key uniqueness, canonical request hash, status, result reference, retry/recovery information.
- Provider event inbox: provider/account/mode/event identity, received/processed status, attempts, safe error, and correlation ID.
- Outbox: event identity, entity/version, destination, available time, lease, attempts, state, and external reference. Financial commits enqueue outbound communication/accounting work atomically.
- Append-only refund/allocation/credit records with original payment/document references and actor/date/reason, if current payment metadata cannot provide a stable auditable representation.
- Source linkage for labor/purchase job costs, allowing exactly one active cost representation per source and attributable line/allocation.
- Budget snapshots and job progress/closeout attestations, without an unnecessary wholesale schema rewrite.

Postgres, not KV, is the authority for money, business uniqueness, operation state, and OCR reservations. The Neon HTTP driver supports non-interactive transactions; a sequential series of unrelated awaited requests is not a transaction. Prove the required checks, conditional mutations, and inserts are atomic using supported transactional SQL. Where dependencies cannot be represented safely in that mode, isolate a transaction-capable adapter rather than pretending `db.transaction` supports the current HTTP client. Document and test the selected implementation. [Neon driver transaction reference](https://github.com/neondatabase/serverless/blob/main/CONFIG.md).

External APIs cannot join a database transaction. Use intent/reservation, stable provider idempotency, confirmation, and reconciliation. Return success only for the committed logical stage. A worker crash after provider success but before local confirmation must be recoverable without another charge/refund.

An outbox is at-least-once delivery, not magical exactly-once email. Use provider-supported idempotency/deduplication and stored external references where available. If delivery outcome is ambiguous and the provider cannot deduplicate, mark it for reconciliation instead of promising zero duplicates or blind immediate resend.

Webhook handlers verify raw payload/signature, environment, connected account, and mapped entity. Acknowledge only after durable intake, then process asynchronously with replay. Do not require event order; retrieve/reconcile provider object state when necessary. [Stripe webhook guidance](https://docs.stripe.com/webhooks), [Stripe idempotency](https://docs.stripe.com/api/idempotent_requests).

### 5.3 Supplier Imports And AI Spend Protection

Entry point: [invoice routes](../../../apps/api/src/routes/invoices.ts); existing schema includes hashes, purchase/job links, feedback, sender rules, and AI usage. These are foundations to strengthen, not features to recreate.

Implement:

- Hash canonical file bytes at intake and claim a tenant-scoped document identity before expensive OCR. Different tenants are never told another tenant uploaded the same file.
- Use hash equality for exact duplicates. Supplier/account/invoice-number/date/store context supplies a second business identity for revised PDFs/scans. Do not use supplier name plus invoice number alone if numbers can repeat across stores/accounts. Fuzzy similarity only raises review; never silently discards a legitimate invoice.
- Add appropriate partial unique indexes/source identities after a collision report and migration dry run. Preserve duplicate artifacts linked to the accepted canonical purchase; do not delete history to make an index succeed.
- Claims have leases, attempts, and recoverable failures. Two uploads/forwarded copies may retain separate intake audit records but only one OCR execution/purchase approval per canonical document generation.
- Approval locks/checks version and state, requires a same-tenant job, preserves invoice transaction date, and atomically writes purchase/cost attribution. Product price changes append history with supplier/variant/pack/unit/date, not only overwrite a field.
- Reserve tenant/day/month document and spend allowance before provider calls, then settle actual usage. Include concurrency, timeout, unknown-provider-outcome, and abandoned-reservation recovery tests. Unknown OCR outcome cannot release a reservation and start unlimited duplicate calls.
- Count retries and extraction attempts under a documented usage policy; show clear remaining quota and limits, not a generic premium box.
- Parse quantities, gallons, pack size, paint SKU/variant, fees, taxes, credits, and returns separately. Do not pretend gallons bought equal paint consumed or waste.
- Retain original file in R2 when configured, authorize later viewing, and show missing-retention truthfully. Limit file size/page count/type, sanitize names, constrain processing, and never fetch arbitrary invoice-supplied URLs.
- Treat document/email text as untrusted extraction data, not instructions. Use structured output validation and provenance; no document content can request a payment or change authorization.
- Supplier forwarding whitelist remains explicit. Validate authenticated sender/routing information supplied by the inbound mail system; a spoofable `From` string alone is not adequate authorization. Quarantine unverifiable forwarded originals; do not pretend forwarding reveals cryptographically verified original sender identity.

Build an anonymized labeled supplier fixture corpus with the existing Sherwin-Williams examples only if use/retention is authorized. Private files must not be committed raw. Include changed layout, multi-invoice statement, same-number/different-account, return/credit, tint lines, non-paint fees, ambiguous job, and duplicate document cases. Report extraction accuracy separately from match accuracy and reviewer acceptance. No self-improving claim until held-out evaluation improves.

### 5.4 Field Capture And Cost-Control UI

Entry points: [Time](../../../apps/web/src/pages/Time.tsx), [crew time dialog](../../../apps/web/src/components/CrewTimecardModal.tsx), [job detail](../../../apps/web/src/pages/jobs/JobDetail.tsx), [jobs list](../../../apps/web/src/pages/jobs/JobsList.tsx), [reports](../../../apps/web/src/pages/Reports.tsx), [dashboard](../../../apps/web/src/pages/Dashboard.tsx).

Follow the mobile spec, not new page-specific styling.

- Crew: obvious clocked-in/out status, address-first current job, one primary next action, rare corrections behind a sheet. Keep geolocation and exception-review semantics.
- Preserve raw punch instants alongside rounded values. Use the existing configurable policy, with five-minute defaults for new organizations as previously requested; never silently replace a company's explicit policy or historical entries. Payroll/legal compliance is not implied by a rounding setting.
- Crew lead: one reusable job-contextual bulk-time flow, selected employee count, hidden selection/hours indicator, role filters, numeric keyboard, and value selection on focus.
- Preserve legitimate split-job shifts and separate same-day entries. Flag overlapping/duplicate-looking manual-versus-punch entries for review, and count each approved economic labor source once; do not sum both a time entry and its derived job-cost record as two costs.
- Owner: compact job summary with contracted subtotal, current costs, collection status, and data-completeness state. Put cost coverage/next action above advanced reports. Never advertise 100% final margin because no costs were entered.
- Receipt review: document-first, plausible job suggestions, explicit job selection, date/total reconciliation, exceptions, and approve. No pasted CSV/text requirement.
- Job photos: capture or gallery, progress/error/retry state per file, continued access and annotation where existing; never force camera-only behavior.
- Dashboard: one prioritized action per exception, suppress resolved/dismissed/irrelevant suggestions, no duplicate quick-entry bands.
- Financial activity: shared readable timeline for received/refunded/credited/voided events, with timestamp and detail link. Color accompanies icon/text, not a color-only signal.

Offline phase 1 is **draft recovery**, not silent financial sync. Save non-final estimate/manual-time form drafts locally under tenant/user scope, with a short retention limit and sign-out purge. On return, offer restore/discard and validate current server versions. Local storage is not a guarantee against OS eviction and is not an appropriate place for auth secrets or unrestricted sensitive files.

Payments, refunds, approval, and normal punches need acknowledged server state. If connectivity prevents a punch, show `Not recorded` and preserve the attempted timestamp/context for an explicit review/correction flow; never show `Clocked in` based only on an unsent local intent. A future offline punch queue requires its own policy and tests. Receipt/photo offline retry can follow with explicit queued/uploaded states, quota handling, and user-controlled local retention.

### 5.5 Forecast And Rate Calibration: After Trust

Add only after G3 and sufficient pilot data:

- Owner/lead records lightweight remaining effort or completion per relevant work category. Avoid mandatory per-substrate daily reporting.
- Forecast uses approved cost to date plus remaining cost estimate, showing inputs, date, completeness, and uncertainty. Missing inputs yield `Not enough data`, not zero remaining cost.
- Closeout requires confirmation that labor/purchases/credits are captured. Newly arriving costs can reopen cost review without reopening customer collection automatically.
- Suggest future production rates only from comparable reviewed jobs, with sample size, method/prep/scope normalization, exclusions, and an explanation. Insufficient comparable data yields no recommendation.
- Suggestions require owner approval and create a new pricebook version. Never mutate sent/signed proposals or old budgets.
- Use customer-local history first. No cross-tenant benchmarks or data sharing in this release.

### 5.6 QuickBooks Minimum Handoff

Use the existing [integration plan](../../quickbooks-integration-plan.md), but implement a narrow launch subset against current customer invoices/payments, not legacy estimate packages.

Define ownership before sync: Crewmodo owns operational scope, job/time capture, and its issued customer obligations; QBO is the accounting system. Imported QBO changes become reconciled updates or review exceptions under explicit field ownership, not a last-write-wins loop.

Version-1 scope:

1. Tenant/realm-safe OAuth, token refresh, disconnect, and status/errors.
2. Customer, item/account, tax, payment-method, invoice, and job/project mappings as needed for the agreed use cases; no hardcoded generic item ID.
3. Export issued invoices once; export/allocate confirmed payments once; map credits/refunds through reviewed QBO transaction rules.
4. Signed/verifiable inbound webhook intake with durable processing, replay, and bounded reconciliation polling. Cross-tenant realm IDs cannot update another company. [Intuit webhook configuration](https://static.developer.intuit.com/output_html/qbo/docs/develop/webhooks/configure-webhooks.html).
5. Show queued/synced/needs-review/failed state, last sync, detail and retry. A disconnected account does not break the main CRM.
6. Reconciliation compares mapped invoice amounts, balances, payment allocations, and credits; reports unexplained differences. If a given QBO tax/refund workflow is not supported yet, block it clearly instead of fabricating a posting.

Do not implement payroll, general two-way bills, bank feeds, or full inventory in this handoff. Use an isolated QBO sandbox and provider contract fixtures. No promise of "two-way accounting" until supported changes and conflict rules are verified.

### 5.7 Activation, Entitlements, And Analytics

Reconcile [plan definitions](../../../packages/core/src/plans.ts), server checks, subscription records, and UI. Preserve approved pricing and existing customers; do not automatically increase charges or change Stripe price IDs.

Publish one server-derived capability/usage result for the UI. Central guards enforce permissions, entitlement, seats, and usage; hiding a button is not security. Test Growth OCR, Starter field access, trial/active/past-due/canceled/grandfathered cases and field-only users. Public client-portal capabilities are token-scoped, not internal employee entitlements.

Onboarding is task-based progressive setup: import/create one customer, choose a useful template, verify rates/products, invite crew, connect payments if needed, then run one job. Preserve step/scroll/draft when a user returns from setup destinations. Advanced settings remain available without blocking first value. Subscription checkout, email verification, and contractor Stripe Connect are different concepts; label them clearly.

Implement PostHog user-action events through a shared privacy-aware adapter, satisfying repository policy. Do not send addresses, email bodies, supplier document text, exact GPS, keys, or payment instrument details. Analytics failure never blocks a transaction. Capture operation result and duration once per logical operation, not each network retry; disable external analytics in isolated tests.

Pilot instrumentation follows the strategy's activation milestones and cost-reviewed-job outcome. Track consented support load and time-to-value. Only a human owner can mark paid-pilot recruitment, retention, and business outcome tasks complete.

## 6. Migration And Historical Safety

The database coordinator must own a written migration/backfill plan before G1:

1. Inventory actual migration journal/constraints and existing financial/import records. Do not assume a migration file is applied because it exists locally.
2. Dry-run collision reports, orphan links, tax/total discrepancies, missing transaction dates, duplicate costs, and historical refund dispositions.
3. Add nullable/backward-compatible fields and constraints in stages. Preserve issued/signed totals and provider identifiers. Require approved repair mappings for ambiguous records.
4. Backfill deterministic source references and versions in bounded resumable batches; log counts and checksums, not personal document contents.
5. Validate on an isolated restored copy. Reconcile before/after totals by tenant and document; constraints cannot be enabled by deleting inconvenient records.
6. Deploy compatible schema before consumers; keep the previous app version usable during rollback. Prefer forward repair for irreversible migrations; restoring an old database after new payments would lose real financial history.
7. Have explicit recovery for pending provider operations, outbox leases, and reservations after rollback. Never erase inbox/idempotency records to rerun a deployment.

## 7. Tests And CI/CD

The QA owner delivers test fixtures early; feature owners add tests alongside changes. Mocked browser tests validate presentation but do not prove SQL transactions or real provider behavior.

### Required Layers

- Unit: money/decimal parsing, quantity conversions, group rounding/allocation, tax, lifecycle transitions, refund disposition, cost completeness, forecast, entitlements.
- Database integration: isolated Postgres/Neon schema with tenant fixtures, concurrent mutations, rollback/failure injection, uniqueness, migration/backfill tests.
- API integration: Hono routes with real persisted records, RBAC/tenant/public-token boundaries, signed provider events, retry/out-of-order delivery, pagination.
- Browser: active signup plus proposal-to-job-to-invoice, manual collection/refund, supplier approval, crew time, customer portal, history/back navigation, expired/sessionless state.
- Visual/accessibility: screenshot baselines, overflow/touch-target/occlusion assertions, focus traps/restore, screen-reader semantics, text zoom, safe-area/keyboard behavior.
- Provider sandbox: Stripe connected account/test-mode payment + abandonment + refund; Resend adapter evidence without customer recipients; QBO sandbox mappings and reconciliation. Keep live keys out of test runs.

Use a supported existing runner where appropriate. Select a unit/API runner centrally, then add proposed root scripts such as `test:unit`, `test:integration`, and `test:e2e:critical`. Those scripts do not exist merely because this plan names them. Do not mark tasks done with nonexistent or skipped commands.

Current baseline checks available now:

```bash
corepack pnpm build
corepack pnpm lint:typography
corepack pnpm lint:buttons
corepack pnpm --filter @crewmodo/web type-check
corepack pnpm test:e2e:signup --config=tests/playwright.config.ts
```

The current lint scripts allow baselines, so a passing baseline is not zero warnings. New/touched code must add no violations; ratchet measured baselines downward rather than raising them. Replace obsolete skipped lifecycle tests with current requirements; do not simply unskip assertions for removed Good/Better/Best behavior.

CI must gate merges/promotions on build/types, nonregressing lint, unit/database/API tests, and critical browser tests. Run Chromium and WebKit with representative phone/tablet projects; a Playwright WebKit run is useful but not proof of real iPad Safari behavior. Include Firefox smoke coverage and on-device staging verification.

Required safety: ephemeral test databases, synthetic tenants, test-only provider adapters/secrets, outbound-email sink, no production URLs/data, and a fail-closed environment guard. Upload traces, screenshots, and sanitized diagnostics on failure. Avoid full financial/PII payload dumps in artifacts.

Isolation tests exercise real sessions, roles, and scoped public tokens, not just trusted `x-org-id` fixtures. Verify that development/demo helpers cannot grant production access and that environment configuration cannot accidentally expose them on a public deployment.

## 8. Release Gates

| Gate | Acceptance | Evidence owner |
| --- | --- | --- |
| G0 | Baseline, file ownership, accepted financial/refund contracts, fixture corpus, historical policy | Coordinator + domain owners |
| G1 | Golden calculations; concurrency/idempotency; supplier approval and budget reservation; shared UI primitives | Estimation/finance/supplier/design + QA |
| G2 | API-backed end-to-end workflows; correct reports; token/RBAC isolation; no mobile overlap/overflow | QA + all workflow owners |
| G3 | Sandbox providers, staged migrations/backfill, visual/device checks, reconciliation, rollback/runbooks, monitored release | Coordinator + QA |
| G4 | Paid companies complete cost-reviewed jobs and repeat useful use within the pilot | Founder/activation; human evidence |

Any double collection/refund/import, cross-tenant access, signed-document mutation, unexplained financial discrepancy, or falsely acknowledged financial/clock action is release-blocking. Mobile horizontal overflow, obscured actions, inaccessible sheets, and competing primary actions on critical workflows also block acceptance.

Performance targets are test budgets, not claims of current performance: warm cached views remain usable while refreshing; ordinary forms respond immediately; capture stable skeletons on first load; measure critical API p95 with a representative dataset and report it. Do not invent a sub-200ms guarantee for OCR/external-provider calls. Expensive work returns durable queued state and progress/retry information.

## 9. First Dispatch

1. Coordinator and QA execute G00-G03 first; estimation/finance/design specialists review contracts and fixtures.
2. Dispatch E01-E06, F01-F04, S01-S04, and D01-D04 from the agreed baseline, respecting ownership.
3. Freeze shared contract/component interfaces at G1, then begin field, accounting, activation, and adapter work.
4. Merge small verified changes into the coordinator branch in dependency order. Maintain a coherent staging release; do not deploy half a financial migration independently.
5. Complete the checklist's release gate before promoting `main` to staging or staging to production. This handoff does not authorize live financial operations or production data repair.
