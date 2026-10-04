# Implemented Contracts

Version 1, October 3, 2026. This registry records implemented behavior, not approval to release the entire program.

## Baseline And Ownership

- Integration branch: `codex/repaint-margin-control`, based on `origin/main` commit `fee1885594fd62bb1619d0f2ab294c40c71e65bc`.
- Original checkout and other contributors' changes were preserved. Five agents edited disjoint assigned paths in a separate managed worktree; the coordinator integrated shared contracts, schema, migration ordering, and CI.
- Disposable PostgreSQL 16 database only. No live financial operation, production reseed, provider credential change, or remote database repair occurred.

## Calculation

- Pure bounded scaled-decimal/rational arithmetic lives in `packages/core/src/estimation-decimal.ts` and `estimation.ts`. USD money outputs are safe integer cents. Quantities/rates/percentages have explicit supported scales; invalid values throw field-specific errors rather than becoming zero.
- `repaint-v1` production previews and unsigned saves resolve current same-workspace production rates, settings, and paint products on the server. Browser totals and calculation snapshots are not trusted.
- Compatible product/pack/sheen/color groups aggregate theoretical volume before purchasing whole packs. Purchased cost is allocated deterministically to scope lines; allocated cents reconcile exactly.
- Included and optional scope, discounts, and tax are calculated separately. Store source inputs, resolved rates/products, purchase groups, and calculation snapshot with the proposal.
- `estimate.save` is scoped by workspace, authenticated actor, and operation key. The unchanged payload replays its original result; changed payload returns 409. Create/save/audit/lead transition commit together in one database call.
- Editing requires `expectedUpdatedAt`; unsigned sent proposals remain sent, not draft. Signed/closed proposals cannot be edited. Signing also compares the version read before writing. Historical signatures and contract totals are never repriced.
- Counter-signature metadata records the agreement version. An unsigned proposal edited after counter-signing needs a new contractor signature.

## Financial Position

- Contracted work means the accepted historical proposal subtotal, after its recorded discount, plus approved change-order scope, excluding customer sales tax.
- Recorded actual cost comes from `job_costs`. Do not add time-entry cost again where time is already materialized in that ledger.
- Received cash, refunded cash, customer credit, and contractual scope are different concepts. A refunded amount credited to the customer does not reopen that amount as collectible debt or silently reduce the signed face value.
- `payment_obligation_balance` is the authority for invoice/estimate collection. Display history can be paginated/truncated without changing a balance. Invoice list, invoice detail, customer detail, and customer portal consume the authoritative result.
- Missing cost capture or unresolved accepted scope yields unknown margin, not final 100% profitability. Current recorded margin is explicitly incomplete, never a forecast.
- Historical refunds without recorded disposition pause collection for review. Do not infer credit/rebilling from net cash alone.

## Manual Payments And Refunds

- Customer payment/refund access requires owner or an invoice/settings grant. A job-cost grant permits supplier review, not customer-money operations. All same-tenant assigned roles are considered; another tenant's grants never apply.
- Manual payment recording uses one tenant-level database lock for balance checking, row creation, invoice update, audit, and durable replay result. Concurrent attempts cannot overallocate the current obligation.
- An additional payment requires explicit duplicate confirmation. A failed response retains the UI operation key for unchanged retry.
- An existing online Checkout must be reconciled with Stripe before manual collection. Open, processing, unknown, mismatched-account/environment, or changed-session cases fail closed.
- Manual refunds require confirmation that the return was handled outside Crewmodo. These are ledger records, not an instruction to move money; manual sources never call Stripe, even if stale provider identifiers exist.
- Card refunds reserve amount and a stable provider idempotency key before contacting Stripe. Pending, requires-action, or unknown results retain the reservation. Replays cannot dispatch a second refund.
- Verified matching account/mode/currency/amount/provider references are required before settlement. Only confirmed success affects settled refunded totals. Pending and failed operations are not settled cash movements.
- Partial and full refunds preserve payment and document history. Collection pauses during unresolved refund operations.
- Receipt delivery is not proof of payment. Delivery failure must not make committed money appear unrecorded. Durable notification dispatch remains an unfinished release requirement.
- Manual return methods are cash, check, ACH, or other actual external money return. The old "Account credit" choice was removed: a credit-only adjustment is not a refund of money and needs its own ledger/workflow before it can be offered.
- Manual return date/time is required in the refund form and recorded independently of the entry creation time. Every refund requires a reason. Receipt outcomes distinguish provider acceptance, failure, not requested, and replay without resend; they never claim delivery confirmation.

## Supplier Intake

- Claim a canonical file SHA-256 within the workspace before paid OCR. Concurrent identical uploads make one provider request. Other workspaces with the same bytes remain independent.
- OCR reservations enforce concurrent burst/day/month-document and estimated-spend limits. Unknown/expired provider outcomes retain their reservation and require review; they are not a free retry loop.
- Only known priced OCR models are allowed. Reserve conservative worst-case context/output cost; settle observed usage where available. Missing usage retains the reservation, not zero cost. These are estimates, not the provider's bill.
- Detect supported PDF/PNG/JPEG/WebP from file signatures before paid extraction. Retained files have workspace-specific R2 keys and authenticated, permission-checked, private/no-store, nosniff responses.
- Extraction keeps paint quantities, package size, total gallons, price/gallon, colors, supplier identifiers, fees, credits, and returns separate. Invalid numbers fail review instead of silently inventing quantity or discarding credits.
- Approval requires a job in the workspace. Purchase, job-cost lines, price history, approval state, and replay result are one atomic database operation. Cost date is the transaction date, not upload/approval date.
- Five-gallon pricing does not overwrite one-gallon product coverage; source history retains unit/price/date. Older invoices do not overwrite a newer recorded price.
- A similar supplier/invoice number requires comparison and explicit separate-purchase confirmation. Exact files cannot create a second purchase. This is deterministic safety, not an autonomous learning claim.
- Similarity is checked again under the approval lock, not only when the file is staged. Review refreshes newly discovered duplicates while retaining the selected job and original file access.
- Per-gallon price is derived from extended price and validated gallons; contradictory pack/volume/price metadata is rejected. SQL approval independently derives recorded product pricing instead of trusting extracted price-per-gallon metadata.
- OCR must reconcile original invoice grand totals, or per-invoice charge totals for statement bundles, against extracted lines. Statement account balances are not purchase totals. Missing/unreconciled totals block approval with an inline explanation; Crewmodo does not invent omitted fees to make totals match.
- File retention is optional and stated truthfully. Original supplier PDFs and a held-out OCR corpus have not been evaluated in this implementation.

## Entitlements And Integrations

- Server capabilities distinguish basic field time from advanced time, OCR, and accounting. Starter includes basic crew time; Growth (`pro` legacy key) allows 100 OCR documents/month. Expired/unpaid/incomplete access fails closed.
- Exceptions are workspace-scoped, not blanket modifications to a shared plan. Atomic seat reservation and complete frontend policy adaptation remain unfinished.
- QBO OAuth/refresh/disconnect and webhook signatures are tenant/realm scoped. Missing verification key rejects intake. Unsafe legacy hardcoded-item and estimate-package invoice export is blocked, not presented as a functioning accounting sync.
- QBO sandbox export/reconciliation, provider inbox/outbox, durable checkout reservation, and recovery workers remain release blockers for those capabilities.

## Privacy And Telemetry

`action-telemetry.ts` adds opt-in estimate-save and supplier-approval milestones. Configure `POSTHOG_ENABLED=true`, `POSTHOG_PROJECT_TOKEN`, and optionally the US/EU `POSTHOG_HOST` only after approving the privacy policy/consent posture. Default is off. Events include pseudonymous workspace/actor IDs and schema version, not names, emails, addresses, GPS, document content, amounts, or provider identifiers. Analytics is best-effort and cannot block a successful operation.

Replayed outcomes keep event UUID/name/timestamp/distinct ID stable for eventual deduplication, following [PostHog's capture contract](https://github.com/PostHog/posthog.com/blob/master/contents/docs/api/capture.mdx) and [deduplication rules](https://github.com/PostHog/posthog.com/blob/master/contents/docs/data/events.mdx). This is not a durable delivery guarantee or an operational audit replacement.

## Database Contract

Neon HTTP does not support the application's interactive transaction pattern. Atomic business operations therefore use parameterized, security-invoker PostgreSQL functions with explicit tenant filters and fixed search paths. New tenant tables have RLS policies and non-owner isolation tests.

Additive migrations: `0030_supplier_atomic_operations`, `0031_payment_operation_safety`, `0032_unsigned_estimate_operations`. No historical money/signatures were automatically reclassified. Migration generation must preserve these callable functions and policies; do not use schema push as a substitute for the checked-in migration journal.

## Mobile Components And Loading

- Shared dialogs render in a body portal above the shell, as bottom sheets on phones. Focus is trapped/restored; background content is inert and scrolling is reference-count locked, including nested dialogs and Strict Mode cleanup.
- Dialog footers stay in normal document flow, never overlay the last field. Long sheets scroll; actions remain reachable without horizontal scrolling. Info help uses a separate high-layer popover rather than hidden inline text.
- Shared disabled/loading buttons also prevent anchor navigation. Stable labels/icons preserve button dimensions. Field errors have unique IDs and deduplicated descriptions; native validation does not erase React-owned server errors.
- Invoice create/cancel/manual-payment dialogs now use the same primitive as supplier review. Job list uses a compact version of the same cost summary shown on job detail, without long repeated warnings on every row.
- React Router lazy route modules keep unrelated screens out of the signup bundle. Initial route loading has a stable skeleton. Production entry JavaScript is approximately 264 kB / 83 kB gzip; this is a build measurement, not a claim of measured field latency.
