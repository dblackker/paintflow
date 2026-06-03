# QuickBooks Integration Plan

Crewmodo should remain the operating system for contractors while QuickBooks Online remains the accounting ledger. The integration goal is to avoid duplicate entry, keep job costing and margins live, and preserve accounting correctness.

## Product Positioning

Crewmodo owns sales, estimating, change orders, schedule, time, field workflow, supplier invoice OCR, customer communication, and live job margin.

QuickBooks owns the accounting ledger, accounts receivable, accounts payable, chart of accounts, sales tax filing support, bank reconciliation, payroll finalization, and financial statements.

The product promise is: run the business in Crewmodo, keep the books clean in QuickBooks.

## API Surface

QuickBooks Online has OAuth 2.0 and REST APIs for core accounting entities including Customer, Invoice, Payment, Item, TaxCode, Vendor, Bill, Purchase, TimeActivity, RefundReceipt, and webhooks. Payroll and QuickBooks Time are separate, more specialized surfaces and should be treated as later integrations.

Current Crewmodo foundation:

- `/v1/quickbooks/connect`
- `/v1/quickbooks/callback`
- `/v1/quickbooks/status`
- `/v1/quickbooks/settings`
- Customer sync
- Invoice sync
- Payment webhook handling
- `quickbooks_connections`
- Basic QBO IDs on estimates

## Connector Points

### 1. Connection and Settings

Build a dedicated QuickBooks settings surface.

Required mappings:

- Income account
- Materials expense account
- Labor/payroll clearing account
- Stripe fees account
- Deposit/undeposited funds account
- Default service item
- Default material item
- Sales tax codes
- Payment method mappings

Required controls:

- Manual sync only
- Auto-sync accepted invoices
- Auto-sync payments
- Auto-sync approved supplier invoices
- Auto-sync approved timecards
- Disconnect
- Sync health and retry queue

### 2. Customer Sync

Sync customers when they become financially relevant, not when they are only a lead.

Trigger points:

- Estimate sent
- Estimate accepted
- Quick invoice created
- Payment recorded
- Manual sync

Matching order:

1. Stored `qboCustomerId`
2. Exact email match suggestion
3. Name/phone suggestion
4. Create new QBO customer

Do not automatically merge customers based only on fuzzy match.

### 3. Invoice Sync

Crewmodo should create or update QuickBooks invoices for:

- Accepted estimates
- Payment schedule milestones
- Approved change orders
- Quick invoices
- Manual sync requests

Default line strategy:

- One summarized service line per invoice or milestone
- Optional detailed mode by room/scope/category

Do not sync internal measurements, production hours, or margin details to customer-facing QBO invoice lines by default.

Store:

- `qboInvoiceId`
- `qboInvoiceNumber`
- `qboSyncToken`
- `qboInvoiceStatus`
- `lastSyncStatus`
- `lastSyncError`
- `lastSyncedAt`

### 4. Payment Sync

Crewmodo to QuickBooks:

- Stripe payments
- Manual cash/check/ACH payments
- Partial payments
- Refunds and partial refunds
- Change order payments
- Deposit, progress, and final payments

QuickBooks to Crewmodo:

- Payments manually entered in QBO
- Invoice marked paid in QBO
- Refunds or credit memo signals where practical

Rules:

- If payment originated in Crewmodo, Crewmodo pushes it to QBO.
- If payment originated in QBO, webhook imports it into Crewmodo as an external payment.
- Never create a duplicate payment if a QBO reference exists.

### 5. Supplier Invoices, Bills, Purchases, and Job Cost

Crewmodo OCR should remain the operational entry point.

Flow:

1. Supplier invoice arrives by upload or email forwarding.
2. OCR extracts supplier, invoice number, invoice date, product lines, gallons, unit cost, and total.
3. Crewmodo stages the import for review.
4. Contractor approves and assigns a job.
5. Crewmodo updates job costs immediately.
6. Crewmodo syncs a QBO Bill or Purchase with vendor, expense account, and job/customer reference where supported.

This keeps live job margins accurate before the books are closed.

### 6. Time and Payroll

Do not start by running payroll from Crewmodo.

Phase one should sync approved timecards to QBO `TimeActivity`:

- Employee/vendor
- Date
- Hours
- Customer/job reference
- Payroll item if mapped
- Billable flag if applicable
- Sync status and error

Later integrations:

- QuickBooks Time
- QuickBooks Payroll
- Pay item mapping
- Overtime and burden reconciliation
- Payroll approval batch export

## Sync Architecture

Add a durable sync layer before expanding automation.

Recommended tables:

- `sync_events`
- `external_refs`
- optional `connector_settings`

`sync_events` fields:

- `org_id`
- `connector`
- `entity_type`
- `entity_id`
- `external_entity_type`
- `external_entity_id`
- `direction`
- `status`
- `payload_hash`
- `error`
- `retry_count`
- `created_at`
- `updated_at`

`external_refs` fields:

- `org_id`
- `entity_type`
- `entity_id`
- `connector`
- `external_id`
- `sync_token`
- `last_synced_at`
- `last_seen_remote_at`

## Webhooks

QuickBooks webhooks should:

- Verify Intuit signature.
- Store raw event metadata.
- Resolve by `realmId`.
- Process only mapped entities.
- Update local accounting status, not signed contract scope.
- Queue retries for failures.

## Conflict Rules

Allowed two-way updates:

- Payment status
- QBO invoice number/status
- Customer accounting ID
- Tax code/item/account metadata
- TimeActivity sync status

Blocked or review-required updates:

- QBO changes to signed proposal scope
- QBO edits that change accepted total
- QBO customer merge that conflicts with Crewmodo customer
- Supplier costs imported from QBO without review

## MVP Sequence

1. Harden QuickBooks connection and settings.
2. Customer sync on financial events.
3. Invoice sync for accepted estimates, change orders, and quick invoices.
4. Payment sync from Stripe/manual payments to QBO.
5. QBO payment webhook back into Crewmodo.
6. Approved timecard sync to QBO TimeActivity.
7. Supplier invoice approval to QBO Bill/Purchase.
8. Sync dashboard and retry queue.
9. Optional QuickBooks Time/Payroll deep integration.

## Design Principle

Crewmodo should not ask contractors to enter the same customer, invoice, payment, supplier receipt, or timecard twice. If a sync cannot happen automatically, it should be staged with a clear reason and a retry action.
