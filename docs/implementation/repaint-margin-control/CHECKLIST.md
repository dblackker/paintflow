# Implementation Checklist

Use with the [technical plan](README.md), [mobile spec](MOBILE-DESIGN.md), and [agent briefs](AGENT-BRIEFS.md).

Updated October 3, 2026 for the foundation tranche on `codex/repaint-margin-control`. Checked IDs have coordinator-reviewed evidence in [EVIDENCE.md](EVIDENCE.md); larger tasks remain unchecked if only part is implemented. No provider sandbox, production migration, or pilot acceptance is implied. See [RUNBOOK.md](RUNBOOK.md) before promotion.

## Baseline And Contracts: G0

- [x] **G00 - Coordinator:** agree source baseline, preserve dirty work, isolate branches/worktrees/test database, record live revisions. Accept: no unrelated changes lost and no test connection to production.
- [x] **G01 - Finance + estimation:** freeze definitions for contracted value, budget/actual cost, tax, allocations, refunds/credits, deposit/scheduling, signatures, and history preservation. Accept: reviewed contract registry and deterministic example results.
- [ ] **G02 - QA:** create synthetic two-tenant fixtures and baseline reproductions for report fan-out, material pack rounding, stale checkout state, repeated approvals, and skipped lifecycle coverage. Accept: failing regression tests or documented reproductions before fixes.
- [x] **G03 - Coordinator:** approve file ownership, schema proposals/migration ordering, DTOs/events/errors, exact-arithmetic approach, and test runner. Accept: every stream can identify its interfaces and exclusive files.

## Estimation And Calculation: E

Dependencies: G0; UI adapters depend on D primitives; money semantics depend on G01.

- [x] **E01:** exact bounded money/quantity/rate/tax parsing and serialization in the shared calculation contract. Accept: invalid scales/currency/signs rejected and no unsafe float conversions.
- [x] **E02:** normalized room/substrate unit conversions and labor calculation. Accept: square-foot, linear-foot, count, coats/prep/method fixtures reconcile or fail explicitly.
- [x] **E03:** product/variant/sheen/color-aware volume aggregation and purchasable-pack rounding. Accept: 0.4 + 0.4 + 0.4 compatible gallons purchase two one-gallon packs; incompatible colors do not merge.
- [x] **E04:** deterministic purchase-cost allocation, optional scope, discount, and tax calculation. Accept: allocated lines sum exactly to stored totals; selected options taxed under recorded policy.
- [x] **E05:** calculation/rate/product snapshots and historical signed-version protection. Accept: pricebook changes do not change issued agreement or approved job budget.
- [x] **E06:** replace web/API/template calculation drift with the same authoritative engine. Accept: preview and persisted result match for golden corpus; client-supplied totals cannot bypass validation.
- [ ] **E07:** regression coverage and estimator mobile acceptance. Accept: zero-area contributes zero; drafts/revisions recover; summaries and preview fit 360px; all E tests pass.

## Financial Truth And Reliability: F

Dependencies: G0; atomic persistence/schema work is coordinator-integrated; UI adapters depend on D.

- [ ] **F01:** inventory/implement auditable payment/allocation/refund/credit source model. Accept: one cost/payment movement has one authority; history is preserved.
- [ ] **F02:** durable scoped idempotency and source/business uniqueness. Accept: repeated and concurrent requests cannot duplicate logical operations; changed payload under one key yields typed conflict.
- [ ] **F03:** database-backed atomic operations and recoverable external-provider intent/reservations. Accept: failure injection at each boundary leaves safe resumable state, not half an approval or second refund.
- [ ] **F04:** durable provider inbox/outbox with verified intake, leases, retry, and ambiguous delivery handling. Accept: duplicate/out-of-order events reconcile; no unpersisted-success acknowledgements.
- [ ] **F05:** Stripe checkout abandonment/back-navigation/processing/success flows. Accept: opening Checkout does not mark payment pending; abandoned attempt returns to an enabled correct pay action; stale links cannot collect superseded balances.
- [ ] **F06:** manual payment entry with remaining balance check, duplicate confirmation, contextual invoice, and optional receipt. Accept: two simultaneous full payments cannot overallocate; mixed Stripe/check attempts reconcile; genuine excess is auditable credit; money received date is preserved.
- [ ] **F07:** partial/full refund and credit disposition across Stripe/manual flows. Accept: manual refund never calls Stripe; simultaneous refunds stay within remaining refundable amount; closed/refunded obligation not accidentally collectible.
- [ ] **F08:** proposal/countersignature/job/milestone/change-order handoff and invoice cancellation. Accept: each logical handoff occurs once, customer notifications queue after commit, and issued documents remain immutable.
- [x] **F09:** fix reports using separate per-entity aggregates and named financial concepts. Accept: $1,000 contract + two $100 costs shows $1,000/$200; draft/revised proposals do not inflate contracted revenue or lead win rate.
- [ ] **F10:** shared financial summary, timeline/detail adapters, and pagination. Accept: job/invoice/payment/client/portal views agree, refunds appear, and annual data remains bounded.
- [ ] **F11:** coordinator-reviewed historical collision/backfill plan. Accept: preserved provider IDs/signed totals, tenant-level before/after reconciliation, resumable dry run, safe rollback compatibility.

## Supplier Intake And OCR: S

Dependencies: G0; S03/S04 require F02/F03; review UI depends on D.

- [ ] **S01:** claim canonical tenant-scoped file identity before OCR, with recoverable processing leases. Accept: two simultaneous identical documents do not incur duplicate extraction/purchase; cross-tenant hashes reveal nothing.
- [ ] **S02:** exact/business duplicate handling including revised files and supplier/store/account context. Accept: legitimate repeated invoice numbers retained; similarity prompts review rather than silently discarding.
- [x] **S03:** atomic approval with required same-tenant job, transaction date, source costs, and pricing history. Accept: approved twice still creates one purchase/cost outcome; interrupted approval safely resumes.
- [x] **S04:** concurrency-safe OCR document/spend reservations and settlement. Accept: simultaneous uploads stay under tenant/day/month cap; timeout/unknown outcome cannot release unlimited retries.
- [ ] **S05:** paint/gallon/pack/variant/fee/tax/credit/return extraction and validated provenance. Accept: curated corpus distinguishes paint quantities from fees and returns, with reconciled totals.
- [ ] **S06:** held-out supplier matching/extraction evaluation and feedback versioning. Accept: metrics separate correction, matching precision, extraction accuracy, and approval; no unsupported learning claim.
- [ ] **S07:** file upload/R2 retention/view authorization and sender-forwarding hardening. Accept: reviewed document remains viewable when retained; spoofed/unauthorized sender quarantined; missing retention stated truthfully.
- [x] **S08:** compact document-first review UI, job selection, duplicates, pending/error/retry states. Accept: upload-to-stage requires no CSV/text copy; blocked approval explains correction inline before submission.

## Shared Design System: D

Dependencies: G0; does not wait for final finance adapters. Exclusive ownership of shared components/styles.

- [ ] **D01:** normalize touch targets, type roles, semantic colors, spacing, and density. Accept: 48x48 CSS-pixel app targets, nonoverlap, Inter/current font stack, no ad hoc type or new one-hue card theme.
- [ ] **D02:** clear button hierarchy/action menu/icon-button behavior. Accept: one primary task action, loading/disabled anchors behave correctly, destruction last, icon names accessible.
- [ ] **D03:** accessible bottom-sheet/desktop-dialog primitive. Accept: portal/layering, trapped/restored focus, inert background, reference-counted scroll lock, Escape/back, keyboard and safe-area tested.
- [ ] **D04:** consistent field, helper, unique error association, tooltip/popover, numeric and address behavior. Accept: one error per field; tap info always works; labels do not vertically misalign adjacent fields.
- [ ] **D05:** shell/public-portal/action-dock behavior. Accept: title once, authenticated nav only, no sticky composer/footer behind nav, action dock consumes measured inset and does not cover fields.
- [ ] **D06:** shared skeleton/service-error/offline/sync/timeline/completeness components. Accept: stable layout, retry preserves context, critical outage never appears as empty business data.
- [ ] **D07:** dev component gallery and lint improvements. Accept: actual token variants/states documented; touched-code violations caught without increasing warning baselines.

## Field, Job, And Cost-Control UX: T

Dependencies: D02-D06; persisted cost views require F10/E05; forecasting follows G3.

- [ ] **T01:** simplify crew clock into status/current address/one next action, retaining forgotten-punch and location policy. Accept: one-handed normal flow; corrections optional; network failure says not recorded.
- [ ] **T02:** reuse bulk time by job across time/jobs/detail, including hidden selections and decimal numeric input. Accept: hours inline with truncated name, select-on-focus, employee count/average visible, repeated save safe.
- [ ] **T03:** coherent approval audit/location map, pagination, exceptions, assignment, approval/rejection. Accept: missing job can be assigned in review; actual/rounded times clear; map/list equivalent and collapsible preference preserved.
- [ ] **T04:** safe tenant/user-scoped draft recovery and stale-version conflict UI. Accept: interrupted forms recover/discard; sign-out clears local drafts; financial/punch actions are not silently offline-successful.
- [ ] **T05:** photo/gallery/camera and upload progress/error/retry on relevant job/estimate screens. Accept: phone gallery available; actual uploaded image renders; queued/failed/uploaded states differ.
- [x] **T06:** coherent job list/detail cost position and next actions. Accept: address first, quick menu, cost-completeness warning, no final 100% margin for uncaptured costs, linked detail navigation works.
- [ ] **T07:** dashboard/reports exception-first view with no duplicate actions and affected-record refresh. Accept: report totals use F definitions; next actions route contextually; mobile lists are not horizontally scrolling tables.
- [ ] **T08:** after G3, lightweight remaining-work and cost-closeout inputs. Accept: unknown completeness/remaining work are not zero; late costs reopen cost review only.
- [ ] **T09:** after T08, explainable forecast-at-completion. Accept: actual plus remaining cost, approved scope, timestamp, uncertainty, and source drilldowns visible; no estimate when evidence missing.
- [ ] **T10:** after reviewed pilot history, owner-approved rate recommendations. Accept: sample/comparability evidence, insufficient-data fallback, versioned approval, no old-document mutation.

## Accounting Handoff: Q

Dependencies: F01-F04/F07/F10; may use approved contract fixtures during development.

- [ ] **Q01:** tenant/realm-safe OAuth, refresh, disconnect, and configuration status. Accept: isolated sandbox credentials, realm scoping, recoverable expired token.
- [ ] **Q02:** current invoice/customer/item/tax/payment mappings and source-of-truth rules. Accept: no generic hardcoded item or estimate-package invoice export; unsupported mappings blocked clearly.
- [ ] **Q03:** idempotent invoice/payment/credit/refund export through durable work. Accept: retries reuse external reference, invoice association/tax/balances reconcile.
- [ ] **Q04:** mandatory webhook verification, durable inbound processing, polling/reconciliation, conflicts. Accept: fake webhook rejected, cross-tenant realm cannot mutate records, divergence requires review.
- [ ] **Q05:** visible sync health/retry/details and sandbox acceptance evidence. Accept: disconnected QBO does not block Crewmodo; supported cases reconcile in the test company.

## Activation, Entitlements, And Pilot: A

Dependencies: G01; analytics/schema changes coordinator-owned; capture outcome requires G3.

- [ ] **A01:** one authoritative server capability/seat/usage policy. Accept: Starter field access, Growth OCR, legacy keys, trial/paid/canceled/grandfathered states consistent across UI/API; no unauthorized paid action via direct request.
- [ ] **A02:** progressive onboarding with useful first-job setup and preserved return step/draft. Accept: no card/Connect/organization confusion; setup links land correctly and return to prior context.
- [ ] **A03:** context-specific repaint templates and pricebook/import setup. Accept: template/rate/product snapshots match engine; no irrelevant starter-builder prompts when already using a complete template.
- [ ] **A04:** privacy-aware PostHog milestone/action adapter and operational correlation. Accept: no sensitive document/GPS/payment content; retry emits one logical outcome; analytics failure cannot block action.
- [ ] **A05:** human-led paid pilot plan, migration/support checklist, and capture baseline admin effort. Accept: named consenting design partners and actual payment/fit evidence, not seed records.
- [ ] **A06:** human-led thirty/ninety-day activation/retention and decision review. Accept: complete cost-reviewed jobs, measured recurring use/support costs, reasons for loss, and go/no-go decision before expansion.

## Verification And Release: V

Dependencies: tests written in parallel; release requires all applicable G0-G3 work, not future T08-T10/A06.

- [x] **V01 - QA:** unit golden/property/boundary tests for money/estimation/finance/entitlements. Accept: all applicable fixtures and invalid inputs covered, no disabled failure cases.
- [ ] **V02 - QA + coordinator:** real database concurrency, tenant isolation, failure injection, migration/backfill tests. Accept: disposable environment, no half-writes/overallocations, old version compatibility.
- [ ] **V03 - QA:** API lifecycle/permissions/public-token/replay/pagination suite. Accept: durable state verified, not only mocked HTTP response.
- [ ] **V04 - QA:** active critical E2E journeys in Chromium/WebKit plus Firefox smoke. Accept: signup/sign/countersign/handoff/manual payment/refund/import/time/portal and browser-back checks pass.
- [ ] **V05 - QA + design:** visual/accessibility acceptance at 360/390/430/768/1280/1440 widths, zoom and keyboard scenarios. Accept: screenshots, no overflow/occlusion, targets, focus, labels, contrast, reduced motion.
- [ ] **V06 - QA + provider owners:** isolated Stripe/Resend/QBO sandbox verification. Accept: confirmed persisted provider state, abandoned flow, refund, replay, no live recipients/charges.
- [ ] **V07 - QA + coordinator:** security/cost-abuse review. Accept: sender/file/token/tenant/RBAC boundary cases and concurrent OCR caps; safe redacted artifacts/logs.
- [x] **V08 - Coordinator:** CI merge/promotion gates and artifacts. Accept: required suites cannot be skipped by the deployment workflow; baseline lint not raised; test-data/secrets guard fails closed.
- [ ] **V09 - Coordinator:** staged deploy, immutable release ID, dependency-aware synthetic check, outbox/reconciliation monitoring, runbooks/recovery drill. Accept: migrations/backfill verified and rollback cannot lose new money history.
- [ ] **V10 - Coordinator + founder:** sign G3 limited-pilot release and record residual risks; sign G4 only after actual pilot outcomes. Accept: explicit scope and evidence, no blanket "production ready" claim.

## Evidence Register

Add one row when work starts. A task cannot be checked without test evidence or the designated human outcome. Record actual commands/results, not an unsupported summary.

| Task IDs | Agent/branch | State | PR or commit | Tests/results | Screenshot/trace/fixture | Migration/provider notes | Reviewer |
| --- | --- | --- | --- | --- | --- | --- | --- |
| G00/G01/G03 | Coordinator, integration branch | verified | Feature PR | Preserved original checkout; contracts and migration ordering reviewed | CONTRACTS.md | Disposable local PostgreSQL only | Coordinator |
| E01-E06 | Estimation agent + coordinator | verified | Feature PR | Unit calculation corpus; four persisted estimate API tests | estimator-current.spec.ts; 360px preview | Signed history unchanged; stale versions fail closed | Coordinator |
| F01-F03/F05-F07/F10 | Finance agent + coordinator | in-review | Feature PR | Concurrent manual payments, refund reservations, matching invoice balances | payment API tests; portal browser suite | Full Checkout creation reservation/inbox/outbox still missing | Coordinator |
| F09/T06 | Job/report agent | verified | Feature PR | Exact aggregate fixtures; ten Postgres SQL-builder tests | job-financial.spec.ts; six widths | Current recorded costs, not forecast or final closeout | Coordinator |
| S03/S04/S08 | Supplier coordinator + review agent | verified | Feature PR | Atomic approval, rollback, live duplicate and spend reservations | supplier-review.spec.ts | Original-charge reconciliation; job and source date required | Coordinator |
| S01/S02/S05/S07 | Supplier coordinator | in-review | Feature PR | Claims, normalization, retained-file authorization | Synthetic invoices; no held-out supplier PDFs | Sender proof/recovery worker and real corpus not complete | Coordinator |
| D01-D04/D06-D07 | Design agent + coordinator | in-review | Feature PR | 45 primitive browser checks; quick invoice/supplier sheets | 320-1440px, text scale, focus/overflow screenshots | Physical-device keyboard/accessibility review remains | Coordinator |
| Q01/Q02/Q04/A01/A04 | Integrations agent + coordinator | in-review | Feature PR | Realm/signature/entitlement/privacy boundaries | Unit provider adapters; no real sandbox | Legacy unsafe export blocked; seat reservations/outbox missing | Coordinator |
| V01/V08 | Coordinator | verified | Feature PR | 146 unit tests; quality prerequisites before deploy | CI browser artifact upload | Lint limits reduced to 310/21; no live promotion claim | Coordinator |
| V02-V07/V09-V10 | Coordinator | in-review | Feature PR | 62 local database tests; 137 browser tests in EVIDENCE.md | Ignored test-results and CI artifacts | Complete lifecycle/provider sandbox/staging/device gates still open | Coordinator |

States: planned, in-progress, awaiting-dependency, in-review, verified, or blocked. Record a concrete missing dependency for blocked work. Every PR lists completed IDs, affected contracts, remaining risks, and rollback/recovery implications.
