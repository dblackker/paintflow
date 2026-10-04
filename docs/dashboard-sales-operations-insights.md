# Dashboard Sales & Operations Insights

## Product Basis

- [Jobber Insights](https://help.getjobber.com/en/articles/insights-dashboard/) follows newly created leads through sent quotes and jobs, counting unique leads rather than documents. It keeps operational scheduling insights separate from conversion.
- [Pipedrive conversion reports](https://support.pipedrive.com/en/article/insights-reports-deal-conversion) distinguish progression through a funnel from win/loss outcomes and make reporting periods explicit.
- [PaintScout CRM](https://www.paintscout.com/crm) emphasizes stage visibility, stalled opportunities, and actionable scheduling/follow-up.

Crewmodo adapts these patterns for short mobile sessions: weekly intake, a compact cohort funnel, and an actionable current production queue. It does not pretend that a customer, proposal, job, or payment are interchangeable units.

## Counting Contract

- Select 4, 8, or 12 calendar weeks, including the current partial week. Weeks begin Monday in the viewer's IANA timezone. UTC database instants are converted explicitly; daylight-saving transitions and zero-intake weeks are handled.
- The sales cohort is customers created from the first Monday through the response's `asOf` instant. Later estimates for those customers count through `asOf`; old customers' new proposals do not inflate this cohort.
- **Leads:** each customer once, including lost customers so the denominator is not artificially improved.
- **Estimate created:** at least one saved estimate, including drafts and earlier revisions.
- **Estimate sent:** evidence of sending, or a sent/accepted/declined legacy state. Previously sent documents still count after cancellation, revision, or voiding because that stage was reached.
- **Won:** at least one currently accepted, non-voided estimate. Payment is not required. Manual lead wins without an accepted proposal are displayed separately, not silently fabricated as signed proposals.
- Ratios use unique customers, not estimate totals. Lead-to-win = won / cohort leads. Each later stage also shows its conversion from the preceding stage. Zero denominators display `Not yet`, not `NaN` or a misleading 0% win rate. Recent cohorts naturally include customers still deciding; this is not a closed-deals-only win rate.
- The operations queue counts all existing jobs, independent of lead-cohort dates. Awaiting deposit, missing dates, scheduled, in production, and punch list are disjoint. Completed counts only jobs with a completion timestamp in the selected period. A legacy `scheduled` job without dates needs scheduling.
- Existing Active leads now includes new, contacted, and estimate-sent states; won and lost customers are excluded.

## Technical & UX Boundaries

- `GET /v1/dashboard/insights?weeks=8&timeZone=America%2FLos_Angeles` requires a workspace owner or sales/jobs/reporting permissions. Invalid periods/timezones are rejected before querying. Response caching is private/no-store.
- One aggregate query returns bounded weekly counts and summaries. `EXISTS` avoids revision/join fanout; every tenant-owned row and foreign side is explicitly scoped. No provider call, money calculation, schema migration, or new table is needed.
- A separate React component loads insights without blocking dashboard actions. Refresh preserves the prior chart's dimensions, aborts superseded requests, labels stale results on failure, and offers retry. Empty and skeleton states are explicit.
- Mobile uses one column, readable labels, accessible chart descriptions, 48px period/definition controls, and design-system typography/colors. No horizontal scrolling, nested cards, chart-only color meanings, or new chart library.
- Operations drilldowns link to server-filtered, cursor-paginated job lists or the calendar's scheduling queue. Filters persist on subsequent pages, rather than filtering only the first 50 loaded jobs.
- The optional PostHog `dashboard.insights.viewed` milestone uses existing opaque tenant/actor IDs. It sends no names, addresses, lead counts, money, or timezone values; telemetry failure never blocks the report.

## Follow-Ups

Customer records are the current lead unit. A future opportunity/project entity would allow repeat customers' distinct projects to have their own cohort and conversion history. Historical point-in-time funnels, staff/source comparisons, targets, and true stage-duration reports require stable event history and should not be inferred from `updated_at`.

## Validation

- 288 unit tests and 117 real PostgreSQL integration tests passed, including tenant isolation, empty weeks, revisions, DST boundaries, authentication, invalid ranges, and job-filter pagination.
- 24 dashboard browser checks passed across Chromium, mobile Chromium, and WebKit, at 360/390/768/1440px. Tests cover period changes, stable refreshing, outage recovery, empty cohorts, accessible chart descriptions, no horizontal overflow, and filtered-job navigation.
- API/web type checks, the full build, typography lint (unchanged 310-warning budget), button lint (unchanged 21-warning budget), and diff checks passed.
- A separate unmocked local demo-login smoke test rendered both charts and the operations queue against the dev database with zero page errors and no mobile overflow. Existing demo customers outside the recent date window correctly produce zero new leads; no records were altered to fabricate recent activity.
