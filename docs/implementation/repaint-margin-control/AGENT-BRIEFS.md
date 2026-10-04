# Agent Swarm Handoff

Read [plan](README.md), [checklist](CHECKLIST.md), and [mobile design contract](MOBILE-DESIGN.md) first. These briefs are instructions for future dispatch; no agents have been launched by this documentation task.

## 1. Coordinator Protocol

Coordinator identity: **INT**. INT owns integration branch, accepted contracts, schema/migrations, root manifests/lockfile, workflow files, core exports, route registration, release gates, and the checklist evidence register.

Before work, create an assignment record for each dispatched agent with baseline SHA, worktree/branch, task IDs, owned files, dependencies, permitted test environment, and expected artifacts. Agent acceptance requires an independent review; an agent cannot check its own checklist box.

### Exclusive Ownership

| Agent | Owned code area | Must not independently modify |
| --- | --- | --- |
| EST: estimation | New estimation domain modules; estimator/rate/template adapters; estimate calculation validation | Shared finance modules, issued totals, schema/migrations, shared CSS/components |
| FIN: finance | Finance domain/services; billing/invoice/payment/change-order/handoff lifecycle; report aggregation and financial-summary API | OCR parsing/review component files, pricebook estimation engine, global design CSS |
| SUP: supplier | Supplier-import service/parsing/evaluation; supplier-review extracted components | General customer invoicing/payment paths in the same large invoices route; finance summaries |
| DS: shared design | Shared UI components, design-system/mobile CSS, shared shell/layout/gallery | Screen-specific finance math, API behavior, schema, workflow page files assigned below |
| FIELD: field/product UX | Time/crew time components, jobs list/detail, Reports/Dashboard presentation, photo workflow adapters | Shared primitives/CSS, financial-summary calculation, whole Settings file |
| QBO: accounting | Accounting services, QuickBooks helper/routes, sync-specific components | Billing/webhook side effects in FIN-owned files, payment truth, generic schema/migrations |
| ACT: activation | Onboarding/Settings/setup/plan capability adapters, analytics adapter, pilot docs | Stripe collection/refund logic, wholesale shared styling, unapproved billing price changes |
| QA: verification | Test harness, cross-domain fixtures, test suites, visual scripts, evidence/runbook proposals | Product fixes owned by other streams; root CI/package changes without INT integration |

Ownership is finalized against actual files at G03. For files spanning domains, **one writer at a time**:

- `apps/api/src/routes/invoices.ts`: FIN owns the route file; SUP submits a focused service/component extraction patch for INT/FIN to integrate before concurrent work.
- `apps/web/src/pages/Invoices.tsx`: FIN owns customer invoicing; SUP owns newly extracted supplier-review components; INT/FIN integrates wiring.
- `apps/web/src/pages/estimates/EstimateProduction.tsx`: EST owns adapters; DS supplies primitive components/specs rather than editing the page concurrently.
- `apps/web/src/pages/Settings.tsx`: ACT owns the page; FIELD/QBO supply isolated section components or requested patches.
- `apps/api/src/routes/reports.ts`: FIN owns aggregation; FIELD owns Reports UI and consumes the agreed DTO.
- `packages/core/src/plans.ts`: ACT proposes policy reconciliation; INT integrates shared exports and pricing approval.
- `apps/api/src/index.ts`, `packages/db/src/schema.ts`, migrations/journal, workflows/manifests/lockfile: INT integrates every patch.

Shared-file requests identify the exact symbols/lines and desired change. INT schedules serialization or extracts a real ownership boundary; agents must not solve conflicts by copying the same business logic into their own folder.

### Merge Rules

1. All agent branches originate at the agreed baseline, not a random remote branch. Do not include unrelated worktree changes.
2. Submit small commits/PRs using `fix(<scope>): ...`, `feat(<scope>): ...`, or `test(<scope>): ...`, following the repo convention. Each includes checklist IDs.
3. Domain contracts/tests merge before adapters depending on them. Database changes merge through the steward in compatible order.
4. INT resolves version/ownership conflicts; do not blindly choose ours/theirs or revert another agent's edits.
5. QA validates merged behavior on the coordinator branch. Green tests on isolated agent branches are not a full integrated acceptance.
6. No agent merges/promotes production, performs live charges/refunds, modifies secrets, or repairs production records without explicit authorization outside this pack.

## 2. Universal Dispatch Prompt

Copy this prompt and fill the assignment fields; attach the relevant brief below.

```text
You are implementing one scoped workstream in Crewmodo, a React/Vite + Hono/Cloudflare Workers + Neon/Drizzle contractor SaaS.

Assignment:
- Agent identity: <identity>
- Baseline SHA and branch/worktree: <agreed values>
- Checklist IDs: <assigned IDs>
- Exclusive files/modules: <agreed paths>
- Dependencies already accepted: <IDs + contract version>
- Permitted test environment: <isolated dev/test environment>

Read AGENTS.md, CLAUDE.md, docs/action-copy-guidelines.md, and all four documents in docs/implementation/repaint-margin-control before editing. Reinspect current code; the strategy assessment is evidence, not a guarantee that files remain unchanged.

Implement only the assigned IDs, preserving other work and historical financial/signature records. Use existing patterns/components. No separate money logic, generic UI kit, icon pack, pricing policy, or migration scheme. Do not edit shared/co-owned files without coordinator approval. Propose needed shared changes with exact scope.

Every mutation needs appropriate authorization, tenant scoping, durable idempotency/business uniqueness, validation, and a clear UI outcome. Add repository-required PostHog action instrumentation through the agreed privacy-aware adapter. Never log secrets, payment instruments, document text, exact GPS, or public access tokens.

Mobile design is an acceptance requirement: 360px usability, 48px touch-layout targets, no horizontal scroll, current design tokens/Lucide, reachable task actions, accessible bottom sheets, preserved drafts/context, and meaningful loading/failure states. Do not add cards inside cards or competing primary actions. Prove UI changes with viewport screenshots and interaction checks.

Write tests alongside implementation. Run actual available checks; document commands and failures. Mock UI tests do not prove database/provider behavior. Use only synthetic data/test keys; no production reseed, live charge/refund, customer email, credential change, or deployment.

Deliver: assigned task IDs and changed files, small commits/PR, contract/schema proposals, test results, screenshots/traces when relevant, migration/recovery implications, remaining risks/dependencies, and a concise handoff. Do not mark the master checklist complete yourself.
```

## 3. Scoped Briefs

### INT: Integration And Database Steward

Tasks: G00-G03, shared integration for F11, V08-V10; coordinate all release gates.

Start by reconciling dirty/local/remote work and isolating tests. Freeze the contract registry, policy examples, exact arithmetic choice, source identities, DTO/event versions, and historical migration rules. Assign shared files explicitly. Use supported Neon transaction behavior; prove atomic boundaries instead of promising them based on an ORM method name.

Deliver staged migrations/backfill, collision report, rollback-compatible deploy order, required CI checks, release identity, and synthetic/reconciliation runbooks. Integrate provider/analytics configuration proposals without exposing secrets. Refuse release with financial/tenant invariant failures or unsupported mobile claims.

### EST: Exact Estimation And Budget Snapshots

Tasks: E01-E07.

Reproduce early material rounding and calculation drift. Implement a pure versioned engine with explicit units, acquisition versus selling cost, compatible purchase groups, exact allocation and tax, snapshots, and server authority. Preserve signed/issued amounts. Adapters use the same engine and existing templates.

Deliver golden fixtures including 0.4-gallon grouping, color incompatibility, zero area, linear-foot/count conversion, optional scope, decimal tax, signed snapshot, and current template round-trip. Show the estimator at phone/tablet/desktop widths using DS primitives. Do not rewrite invoice/refund truth.

### FIN: Money, Lifecycle, And Financial Summaries

Tasks: F01-F11; source route/component ownership from section 1.

Reproduce report fan-out and lifecycle risks. Implement one auditable source for payments/allocations/refunds/credits/cost origins, durable operations, provider inbox/outbox, atomic local commit, and recovery after external success. Preserve checkout attempt versus provider processing, manual refund versus electronic transfer, and signing versus invoicing.

Deliver replay/concurrency/failure-injection fixtures; shared summaries and errors; corrected per-entity aggregation; immutable agreement handling; closed/refunded collectibility behavior; timestamp/timeline/detail parity. Coordinate outbox IDs/mappings with QBO and sender templates with ACT. Avoid treating tax, estimates, invoices, and cash as interchangeable revenue.

### SUP: Supplier Intake, OCR, And Review Quality

Tasks: S01-S08.

Start with the extraction boundary negotiated in the large invoices files. Implement exact-document claim before OCR, contextual invoice business identity, approval/source cost atomicity, date preservation, contractor price history, and concurrency-safe usage reservation. Structured document parsing is untrusted data, not instructions.

Deliver labeled anonymized fixtures, changed-format/return/fee examples, duplicate/concurrent/date tests, sender spoof/quarantine tests, spend-cap tests, retained-file access checks, and compact review screenshots. Approval must require a legitimate job and be safe after retry. Do not silently discard fuzzy duplicates or claim model learning from approval counts.

### DS: Shared Mobile Design Foundation

Tasks: D01-D07.

Audit touched shared primitives and current token inconsistencies. Normalize 48px touch targets, semantic type/spacing/status roles, button hierarchy, icon targets, inline errors, information popovers, menus, skeletons, and accessible modal-sheet focus/layering. Fix real primitives rather than broad unsafe CSS overrides.

Deliver dev-gallery examples for all states and a component-interface handoff to screen owners. Provide phone/tablet/desktop and keyboard/zoom proofs. Keep current brand calm and operational; do not create a new visual theme or new fonts simply because a complex screen exists. All intentional new variants are centrally defined and lintable.

### FIELD: Crew And Owner Workflow UX

Tasks: T01-T07 first; T08-T10 only after the plan's data/release gates.

Use DS components and FIN/E domain outputs. Implement restricted crew clock, address-first context, rare exception sheets, bulk time reuse/hidden-selection summary, approval audit, collapsible map and pagination, safe draft recovery, photos, job cost coverage, and exception-first dashboard/reports.

Deliver normal/failure/slow/offline/stale-session/keyboard/history screenshots and tests. Do not display success for unsent punches or financial writes, and do not infer final profit from incomplete costs. Later forecasts/recommendations explain evidence and uncertainty and require approval to update pricebooks.

### QBO: Accounting Handoff And Reconciliation

Tasks: Q01-Q05.

Use current invoice/payment/refund entities and accepted domain events. Agree field ownership and accountant-reviewed refund/credit/tax mappings. Implement realm-safe OAuth and mappings, durable exports, verified inbound processing, conflict review, sync status, and bounded reconciliation.

Deliver sandbox invoice/partial payment/manual payment/refund/credit/retry examples with verified external references/balances; malformed webhook and cross-tenant realm tests. Do not create invoices from every legacy estimate package or hardcode an item ID. If a mapping isn't supported, make it explicit rather than inventing a financial posting.

### ACT: Activation, Plan Coherence, And Evidence

Tasks: A01-A04; prepare A05-A06 for human execution.

Reconcile server capability and seat/usage enforcement with central plans and checkout UI, preserving existing approved prices and customers. Resolve Growth OCR/Starter field access/internal-name inconsistencies with recorded policy rather than changing monthly charges. Improve task-based setup and return-to-step behavior, template pricebook readiness, and privacy-aware PostHog instrumentation.

Deliver role/entitlement/subscription-state tests, short setup walkthroughs, event schema/deduplication/privacy checks, and a paid-pilot implementation/support worksheet. Humans recruit/charge/interview pilots; agents must not fabricate traction or complete outcome boxes using demo records.

### QA: Independent Verification

Tasks: G02, V01-V07; propose CI integration to INT for V08.

Build synthetic two-tenant domain/database/API fixtures early. Test real persistence/concurrency/recovery, then browser flows across Chromium/WebKit/Firefox, visual boundaries, accessibility, browser history, and provider sandboxes. Track test quality: mocks for UI logic, actual database for atomicity, provider evidence for external contracts.

Deliver a test-to-task matrix, failing reproductions before fixes, integrated evidence, sanitized artifacts, and explicit residual gaps. Flag failures to owning agents instead of editing their modules unilaterally. No skipped lifecycle tests, production URLs/keys, real financial actions, or screenshots accepted without inspection.

## 4. Required Agent Completion Format

```text
Agent / branch / baseline:
Assigned IDs:
Implemented IDs (pending independent acceptance):
Changed files and exclusive ownership observed:
Contracts added/changed and consumers:
Schema/migration proposals for INT:
Tests: actual commands, environment, results, and remaining gaps:
Visual/interaction evidence: viewport, fixture, screenshot/trace links:
Provider evidence: sandbox identities and verified state, with secrets redacted:
Historical data and rollback/recovery implications:
Known risks / unresolved dependencies:
Commits or PR:
Next integrator action:
```

An implementation handoff is incomplete if it only says "done" or "build passes." It must identify the state/money/mobile invariants actually proved.

## 5. Parallel Dispatch Sequence

First dispatch: INT + QA baseline, with EST/FIN/DS contract review. Then EST, FIN, SUP, and DS run Wave 1 on scoped files.

Second dispatch: FIELD, QBO, ACT, and QA against accepted contracts/primitives. EST/FIN/SUP finish adapters and resolve integrated findings without reclaiming other agents' files.

Third dispatch: INT + QA consolidate migration, provider, visual, security, and deployment evidence for G3. Bring the founder into pilot recruitment/outcome work; no agent can substitute for paying-customer evidence.

If shared contracts change, pause only the affected adapters, version the contract and fixtures, and document consumer updates. Do not leave agents guessing about whether an invoice balance or material quantity means the old or new thing.
