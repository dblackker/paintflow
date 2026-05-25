# React Migration Parity Audit

Last updated: 2026-05-25

This tracks whether each React route preserves the core behavior from the Astro implementation. "Parity" means the route uses the same API-backed data, supports the same primary actions, and uses the shared React layout/design system. Minor styling differences are acceptable.

## Status Key

- `Parity`: React route is API-backed and covers the core Astro workflow.
- `Partial`: React route has some live data or layout parity, but important actions or details are missing.
- `Stub`: React route exists but is mostly static, mock, or materially thinner than Astro.

## Route Matrix

| Route | Status | Notes |
| --- | --- | --- |
| `/` | Stub | React landing is much thinner than Astro landing. Needs full marketing/mobile content parity. |
| `/dashboard` | Partial | API-backed stats/feed exist. Needs smart recommendations and full quick action parity audit. |
| `/leads` | Partial | API-backed list, search, status, contact details. Add-lead modal/event still needs full React implementation. |
| `/leads/:id` | Partial | Replaced mock data with live customer, estimates, jobs, payments, messages, activity. Edit/status/archive actions still need parity. |
| `/estimates` | Partial | API-backed list and preview links. Estimate action menu/cancel/payment actions need full parity. |
| `/estimates/new` | Stub | Still contains local/mock create flow. Needs customer API, create API, validation, redirect/toast parity. |
| `/estimates/production` | Stub | Astro production estimator is the largest business workflow. React route is not yet parity. |
| `/estimates/:id` | Partial | Customer-facing detail exists but needs full signing/payment/terms parity review. |
| `/estimates/:id/details` | Stub | Thin contractor detail compared with Astro. |
| `/estimates/:id/photos` | Partial | React route is larger than Astro but still needs API verification. |
| `/jobs` | Partial | API-backed list with real jobs and customer/address data. List actions need parity. |
| `/jobs/:id` | Partial | Replaced mock data with live costing, revenue, costs, change orders, materials. Add/edit/delete cost, photo upload, bulk timecard, and change-order workflows still need parity. |
| `/calendar` | Stub | Astro has scheduling, drag/drop, unschedule, add-job flows. React is static calendar mock. |
| `/time` | Stub | Astro time tracking is a major workflow. React is static demo rows. |
| `/team` | Stub | Astro supports crew activation and management. React is static demo rows. |
| `/pipeline` | Stub | Astro has drag/drop pipeline/state transitions. React is thin static pipeline. |
| `/activity` | Stub | Astro has searchable/paginated activity feed. React lacks API feed. |
| `/settings` | Stub | Astro has setup checklist, review links, business/payment/terms settings. React is thin. |
| `/production-rates` | Stub | Astro has editable rates/material products. React lacks API-backed CRUD. |
| `/email-templates` | Stub | Astro has template management. React lacks API-backed CRUD/preview. |
| `/notifications` | Stub | Astro has notification actions and push upsell. React lacks live notification actions. |
| `/sms` | Stub | Astro has threaded messaging. React lacks live conversation and sticky composer. |
| `/billing` | Stub | Astro has Stripe checkout/API flow. React lacks provider flow. |
| `/payments/stripe` | Stub | Astro has Stripe Connect state/actions. React lacks full connect flow. |
| `/reports` | Stub | Astro reports are API-backed. React uses static values. |
| `/reporting` | Parity | Astro route is only a redirect/compatibility route; React route can remain simple if it points users to reports. |
| `/reporting/lead-sources` | Stub | Needs reporting API parity. |
| `/materials` | Stub | Needs material/product API parity. |
| `/invoices` | Stub | Needs invoice upload/processing parity. |
| `/payroll` | Stub | Needs payroll API parity. |
| `/roles` | Stub | Needs role management API parity. |
| `/templates` | Stub | Needs estimate template API parity. |
| `/reviews` | Stub | Needs review request/reporting parity or route deprecation decision. |
| `/help` | Partial | Static help content is acceptable, but needs content parity pass. |
| `/onboarding` | Stub | Needs full onboarding/setup journey parity. |
| `/portal/:token` | Partial | Needs approval/payment flow parity verification. |
| `/review/:id` | Stub | Needs public review capture parity. |
| `/dev/design-system` | Partial | Useful dev route exists; should be reconciled with current Material 3 tokens/components. |

## Highest-Risk Gaps

1. Production estimator, time tracking, calendar, pipeline, job detail, settings, and SMS are not yet React parity.
2. Several React routes still use mock timers or static data and should not be treated as production-ready.
3. API-backed routes should use the shared `apiJson` helper so auth redirects, CORS, and error handling stay consistent.
4. Routes with write operations need idempotency key handling before they can replace Astro.

## Work Completed In This Pass

- Fixed React Tailwind/PostCSS compilation so migrated styling actually loads.
- Made `/estimates`, `/leads`, and `/jobs` API-backed.
- Made `/leads/:id` API-backed and removed hardcoded customer data.
- Made `/jobs/:id` API-backed using job costing data and removed hardcoded job data.
