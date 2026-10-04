# Repaint Foundation: Test, Release, And Recovery

Status: feature-branch implementation. Do not treat this runbook as approval for production financial changes. See [EVIDENCE.md](EVIDENCE.md) for unclosed gates.

## Local Verification

Use Node 22 and the pinned pnpm version. Run from the repository root:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm test:unit
corepack pnpm type-check
corepack pnpm lint:typography
corepack pnpm lint:buttons
corepack pnpm build
corepack pnpm exec playwright install --with-deps chromium webkit firefox
corepack pnpm test:e2e --workers=2 --reporter=line
```

The browser suite starts/stops its Vite server on port 5173. Do not accidentally reuse a server from a different checkout: stop that server or run in a clean CI environment. All browser API calls in the new scenarios are intercepted. No email/payment/OCR provider keys are required.

### Disposable Database Only

Provision a separate PostgreSQL 16 database and role, for example `crewmodo_repaint_test`. Then:

```bash
export TEST_DATABASE_URL='postgresql://test_role:local_password@127.0.0.1:5432/crewmodo_repaint_test'
export CREWMODO_RESET_TEST_DB=1
corepack pnpm test:integration
```

The runner drops and recreates the test database's `public` schema. It rejects remote targets, names not ending `_test`, and missing reset permission. Never copy a production connection string into this variable. Integration files run serially; concurrency is exercised deliberately inside individual tests. CI uses a disposable Postgres service, not Neon organization databases.

## Migration Order

1. Check the actual target's migration journal and backup/restore capability. Record the release SHA and environment; verify dev/staging/production point to different databases.
2. Restore representative data into an isolated staging copy. Test old consumers and the new code before any public promotion.
3. Apply checked-in migrations, in journal order: `0030_supplier_atomic_operations`, `0031_payment_operation_safety`, then `0032_unsigned_estimate_operations`. Numeric filenames intentionally follow the existing journal; do not invent or insert a missing legacy migration.
4. Keep tenant tables, RLS policies, callable security-invoker functions, checks, and source uniqueness together. Use `db:migrate`, not schema push; schema-only generation does not reproduce function bodies.
5. Run tenant reconciliation before/after promotion. Keep signed document totals/signatures/provider IDs unchanged. Ambiguous historical records need reviewed mappings, not automatic reclassification.
6. Deploy the API and matching React build from the same verified SHA. Do not deploy the UI against an API without these functions. Retain previous build artifacts for a controlled rollback.

The migrations have been tested against disposable PostgreSQL, including the full repository migration journal. Restored real data, actual Neon migration execution, and old-version compatibility have not been accepted yet.

## Read-Only Reconciliation

```bash
export RECONCILE_DATABASE_URL='<explicit reviewed connection>'
corepack pnpm reconcile:repaint --org '<workspace UUID>'
# Remote connections also require explicit --allow-remote.
```

This opens a repeatable-read, read-only transaction. Output includes signed-history fingerprint, unresolved OCR/refund counts, duplicate source counts, gross receipts/refunds/confirmed credits, and recorded job costs. It does not dump customer documents or mutate records. Store financial diagnostics privately, not in a public PR or analytics payload. Compare fingerprints and totals across repeat runs and release revisions.

## Financial Recovery

- A lost manual-payment response: retry the unchanged request with the same operation key. Do not generate a new key just because the browser did not receive the first response.
- Changed replay payload: 409 is intentional. Verify history before starting a genuinely different operation.
- Receipt failure: payment is still recorded. Inspect email history/provider result and use the receipt action; a payment replay will not automatically send a second email.
- Unknown card-refund result: reservation stays held and collection is paused. Reconcile the exact provider refund, account, mode, currency, and amount before settling. Never delete the reservation or blindly request another refund.
- Manual refund: confirm money was returned outside Crewmodo, record actual return time and reason. This does not move money and must never call Stripe.
- Old refunds with no disposition: leave collection paused until reviewed. Do not derive collectible debt from net cash or reopen a refunded invoice automatically.
- Cancellation and sign-to-invoice orchestration remain release dependencies. A database restore after new money movements would discard real history; prefer forward repair to data rollback.

## Supplier Recovery

- Identical file: use the existing import/purchase record, not a second extraction.
- Similar invoice identity: compare original documents and explicitly confirm a separate purchase. The check repeats under the approval lock.
- Missing/mismatched original charge totals: approval is blocked. View the file and upload a complete corrected document; do not invent lines or edit database totals to bypass reconciliation.
- Approved/rejected elsewhere: refresh the specific review record. The review sheet explains the resolved state and preserves original-file access.
- Unknown/expired OCR claim: keep the cost reservation. The provider may have processed the request even if Crewmodo lost the response. No unattended reset/retry worker exists yet; require operator reconciliation.
- Older purchase dates: price history is retained without replacing newer current costs. Fees and returns are not material price updates.
- R2 absent: processing can still stage a document, but the UI must state that the original was not retained. Do not promise later file access without a retained object.

## CI And Promotion

`ci.yml` runs build/types, ratcheted lint, unit, real PostgreSQL invariants, and browser regressions. The dev, staging, and production workflows require its reusable quality job before migration/deployment. Production resolves the approved ref to one SHA and uses that same SHA for testing/deployment. Browser screenshots/traces are retained as CI artifacts for 14 days.

Workflow gates are implemented, but live GitHub branch-protection configuration and a successful remote CI/promotion run are separate verification. Never merge/promote solely because local mocked browser tests passed. Complete provider sandboxes, restored-data checks, physical-device acceptance, and the unclosed release dependencies in EVIDENCE first.

## Rollback Policy

Rollback application artifacts only after checking the prior version can read the new schema and financial states. Do not drop additive operation/claim/history tables or erase idempotency/provider references. Freeze affected mutations when interpretation is uncertain, reconcile, and forward-fix. Record the exact deployed SHA, migration journal, paused capabilities, unresolved operation counts, and responsible operator before reopening collection/imports.

## Optional Analytics

`POSTHOG_ENABLED=true` plus `POSTHOG_PROJECT_TOKEN` enables the two implemented pseudonymous milestones. Only approved HTTPS US/EU ingestion hosts are allowed. Default is off; analytics failures never prevent a successful save/approval. This is not durable operational monitoring, notification delivery, or complete funnel instrumentation. No user/document/GPS/payment-content payload should be added without privacy review.
