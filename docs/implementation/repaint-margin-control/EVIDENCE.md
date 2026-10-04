# Implementation Evidence

October 3, 2026. Branch: `codex/repaint-margin-control`. Baseline: `fee1885594fd62bb1619d0f2ab294c40c71e65bc` from `origin/main`; planning commit: `4c5795d`.

This is a reviewed foundation tranche, not completion of the 68-task program or authorization to enable unverified accounting/payment capabilities in production. The original working tree and its contributors' edits were left untouched. Five agents delivered estimation, financial operations/design primitives, job/report summaries, entitlements/QBO/portal safety, and supplier review with an adversarial review. The coordinator integrated migrations, shared contracts, API adapters, regression suites, and documentation.

## Verification

| Check | Result | Scope and limitations |
| --- | --- | --- |
| `pnpm test:unit` | 146 passed, zero skipped | Exact estimation/money, template mapping, entitlements, financial position, provider boundaries, supplier normalization, privacy, reconciliation guards. |
| `TEST_DATABASE_URL=... CREWMODO_RESET_TEST_DB=1 pnpm test:integration` | 62 passed, zero skipped | Disposable PostgreSQL 16; real Hono/Drizzle SQL via a replaced Neon transport, concurrency, rollback injection, tenant permissions/RLS, full migration journal. External providers are deterministic test adapters. |
| `pnpm type-check` | Passed | API TypeScript and React TypeScript. |
| `pnpm build` | Passed | API, React/Vite, supplier ingestion tooling. Entry JS 263.61 kB / 82.83 kB gzip, versus approximately 1,035 kB / 279 kB before route splitting. |
| `pnpm lint:typography` | 310 warnings; new budget 310 | Legacy warnings remain; previous budget was 798. No claim of zero warnings. |
| `pnpm lint:buttons` | 21 warnings; new budget 21 | Legacy warnings remain; previous budget was 47. |
| `pnpm test:e2e --workers=2 --reporter=line` | 137 passed, zero skipped, 3.6 minutes | Chromium desktop, mobile Chromium, WebKit, and Firefox signup smoke. Browser API/provider responses are intercepted; these tests do not prove live provider processing. |
| `actionlint` 1.7.12 | Passed for all four changed workflows | Binary downloaded from the official release and checksum verified. Workflow/expressions checked; optional shellcheck/pyflakes integrations disabled. No claim of remote CI success. |

Test connections must be loopback/local-socket PostgreSQL, database names ending `_test`, with explicit reset permission. Tests refuse remote or non-test targets. No live Neon changes, real emails, OCR requests, Stripe charges/refunds, QBO exports, or production reseeds were performed.

### Database Invariants Exercised

- Concurrent estimate creation produces one proposal and one activity; altered replay payloads conflict. Stale versions and signed agreements cannot be changed.
- Browser-calculated totals and pricebook snapshots cannot override current same-tenant server inputs. Preview and persisted totals agree on the calculation corpus.
- Concurrent full manual payments cannot overallocate one obligation. Failed audit writes roll back the whole operation. Provider account/mode/session proof is required for mixed online/manual collection.
- Manual refunds never dispatch to Stripe. Concurrent card refund reservations cannot exceed refundable amount; uncertain responses preserve reservations; verified settlement is applied once.
- Job-cost-only staff can review supplier costs but cannot collect/refund customer payments or read customer invoices. Multiple same-tenant role grants are honored without treating another tenant's role as authority.
- Invoice list, invoice detail, client detail, and portal use the same authoritative credit-aware collectible balance. Unknown historical refund disposition pauses collection.
- Concurrent supplier approval creates one purchase, its source job costs, pricing history, audit result, and approval state. A later-line failure rolls everything back. Transaction dates are preserved.
- Two byte-distinct copies staged before the first approval require a fresh similarity confirmation on the second approval.
- Contradictory five-gallon pricing cannot inflate one-gallon contractor prices. Older invoices retain history without overwriting newer costs.
- Missing original invoice charges cannot be approved. Statement balances are distinguished from per-invoice charges.
- Concurrent same-file OCR claims reserve once; simultaneous distinct files cannot exceed estimated spend/document limits. Expired ambiguous requests are not freely retried.
- Separate job/report aggregates prevent scope/cost join fan-out and labor double counting. Missing costs never imply final 100% margin.
- New tenant tables are tested with a non-owner RLS role, not just owner queries with filters.
- Reconciliation is read-only and repeatable; historical signed-content fingerprints remain unchanged across repeated runs.

### Browser Acceptance

Checked layouts include 320, 360, 390, 430, 768, 1280, and 1440 CSS pixels; 200% root text scale; a short viewport; nested dialogs; focus restoration; disabled anchors; repeated validation; tap-help layering; and reachable sheet actions. Job list/detail, quick draft, supplier review/duplicates, quick invoice, portal back-navigation/processing, and signup are included.

Playwright screenshots and traces are generated under ignored `test-results/` and `playwright-report/`; CI uploads them for 14 days. WebKit emulation is not physical iPad/iPhone certification. Native software keyboards, screen-reader traversal, full app contrast audits, offline recovery, and actual field performance still need staging/on-device acceptance.

The old skipped legacy lead-to-pay scenarios were replaced with active current portal tests. Their file name is historical: they remain browser-only tests, not a complete persisted proposal-to-deposit lifecycle.

## Task Acceptance

The checked IDs in [CHECKLIST.md](CHECKLIST.md) are the fully evidenced subset. Larger tasks remain unchecked when only one part is implemented. In particular, database replay/refund/supplier safety is implemented, but the entire provider inbox/outbox and document handoff is not.

| Stream | Fully verified IDs | Implemented parts of unchecked work |
| --- | --- | --- |
| Coordination/contracts | G00, G01, G03 | G02 synthetic fixtures reproduce targeted failure modes; no comprehensive before/after baseline for every legacy route. |
| Estimation | E01-E06 | E07 responsive previews and stale-version handling tested; persistent interrupted draft recovery is missing. A03 template mappings reconcile, but full activation journey has not been reworked. |
| Finance/reporting | F09 | F01-F03/F06-F07 atomic payment/refund/source operations; F05 portal abandonment; F10 invoice balance and job summary adapters/pagination. Checkout creation reservation, full durable intake, and handoff remain missing. |
| Supplier | S03, S04, S08 | S01 safe canonical claims with unknown-state fail-closed handling but no recovery worker; S02 live identity comparison lacks a held-out store/account corpus; S05 normalized/reconciled synthetic extraction; S07 file retention/authorization, not full mail authentication. |
| Design/field | T06 | D01-D04 shared controls/sheets; D06 route loading and supplier errors; D07 existing lint budgets ratcheted. Not an app-wide UX rewrite or physical-device acceptance. |
| Integrations/activation | None fully closed | Q01/Q04 OAuth/realm/signature safety; Q02 unsafe legacy export blocked; A01 shared server capabilities; A04 two opt-in privacy-aware milestones. No sandbox accounting sync or atomic seat reservation. |
| Verification | V01, V08 | V02/V03 database/API subsets; V04/V05 browser/visual subsets; V07 supplier/finance abuse boundary subsets. V06/V09/V10 provider/staged-release acceptance not done. |

## Outstanding Release Dependencies

1. **F04/F08:** durable provider inbox/outbox, recoverable sign/countersign/job/milestone handoff, notification dispatch after commit, and cancellation/payment race handling. Current receipt emails are best-effort with honest failure feedback.
2. **F05/F06:** durable reservation around creation of a new online Checkout, not just reconciliation of an already stored session. Never market this tranche as proving every online/manual race safe.
3. **F10/F11:** complete legacy estimate/change-order collection adapters and reviewed historical refund/duplicate repairs on a restored copy. Read-only inventory exists; no silent backfill is authorized.
4. **Q02-Q05:** current invoice/item/tax/payment/credit mappings, durable exports/intake/reconciliation, and QBO sandbox evidence. Old hardcoded-item exports are deliberately blocked.
5. **S05-S07:** retained real/held-out invoice corpus evaluation, forwarding SPF/DKIM/sender proof/quarantine, and a controlled unknown-OCR recovery process. Approval is conservative until extraction reconciles.
6. **A01/T04:** atomic seat reservations, full UI capability adaptation, and tenant/user-scoped draft recovery cleared at sign-out.
7. **G3:** restored staging migration compatibility, verified provider sandboxes, physical-device review, reconciliation and rollback drill. No staging/production deployment performed in this tranche.
8. **T08-T10/A05-A06:** cost closeout, evidence-based forecasts/rate recommendations, and real consenting paid pilots. Seed data is not pilot evidence.

Follow [RUNBOOK.md](RUNBOOK.md) for test execution, migration order, conservative recovery, and promotion prerequisites.
