# Customer Detail and Photo Workflow Spec

## Goal

PaintFlow should treat a lead/customer as the account record for a painting contractor. The detail page should answer: who is this customer, what has happened, what is next, what estimates/jobs are attached, and what field media exists for selling, production, proof, and future marketing.

## Customer Detail Page

The customer page should be available from the lead list and become the primary CRM workspace for one homeowner or property manager.

### Header

- Customer name, status, lead source, created date, and last updated date.
- Primary phone and email with tap-friendly call, text, and email actions.
- Primary next action: create estimate, open active job, or follow up on a sent estimate.

### CRM Snapshot

- Contact information and lifecycle state.
- Estimate rollup: draft, sent, accepted, declined, and latest total.
- Job rollup: scheduled, in progress, completed, and current job budget.
- Media rollup: estimate photos, job progress photos, before/after photos.

### Related Work

- Estimates: status, total, created date, sent date, signed date, and actions to edit drafts or open the proposal.
- Jobs: status, budget, completed date, and link to job costing/production.
- Communication history: inbound/outbound messages with newest first.
- Follow-up guidance: simple operational next steps such as follow up on sent estimates, schedule accepted work, or request a review after completion.
- Activity timeline: audit log entries for created, sent, accepted, signed, status changes, and future automation events.

### Future Enhancements

- Address/property records separate from the contact when one customer has multiple properties.
- Notes, tasks, reminders, and assigned owner.
- Follow-up automation enrollment and unsubscribe state.
- Customer portal activity such as viewed proposal, accepted option, paid deposit, and requested changes.
- Document attachments for insurance, contracts, paint schedules, change orders, and invoices.

## Photo Uploads

Photos should be attached to the work object where they are created.

### Estimate Photos

- Used during site visits for existing conditions, room/substrate documentation, damage, prep complexity, and customer preference notes.
- Available from the estimate/proposal workspace.
- Later candidates for production handoff and customer-facing context, but not automatically shown on the proposal unless deliberately selected.

### Job Photos

- Used during production for before, progress, after, punch list, and quality control.
- Available from the job detail page.
- Before/after photos become the source for review requests and marketing posts after job completion.

### Marketing Readiness

Later workflow should mark photos as:

- Before, progress, after, or detail.
- Room/area/substrate.
- Customer-approved for marketing.
- Included in generated social post drafts, review requests, or portfolio pages.

The first implementation adds upload and gallery foundations so the data model is ready for these next steps.
