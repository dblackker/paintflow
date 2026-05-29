# Mobile UX Audit

Crewmodo is field software first: a contractor should be able to add leads, review the pipeline, log time, check jobs, and send estimates from a phone without fighting desktop-density layouts.

## Fixed

- Global shell: notification popover now becomes a bounded mobile panel instead of a desktop dropdown that can overflow the viewport.
- Global shell: notification badge is smaller on phones and no longer clips against the icon button.
- Dashboard: primary actions are compact four-across icon actions on phones.
- Dashboard: KPI cards are compact three-across tiles on phones, keeping the important counts above the fold.
- Dashboard: cards and activity rows have reduced padding on phones.
- Global mobile system: compact summary grids, sticky filter panels, bottom-sheet forms, sticky form actions, and horizontal action rows now have shared helpers.
- Leads: filters stay reachable under the app bar; lead cards are denser and add-lead uses a bottom-sheet form with sticky actions.
- Pipeline: desktop kanban becomes stacked stage sections with compact cards and filter chips on phones.
- Estimates list: setup choices hide explanatory copy on phones, filters are sticky, and estimate cards prioritize customer, address, status, and total.
- Production estimator: room cards, quick-scope assumptions, substrate rows, scope actions, and summary panels compress on narrow screens.
- Estimate proposal: public proposal shell and acceptance actions are tightened for customer mobile review.
- Jobs: job cards now prioritize title/status/contact, compact financial metrics, and grouped secondary actions.
- Job detail: mobile prioritizes the job header, compact KPIs, today-facing sections, bottom-sheet modals, and denser costing/history rows.
- Time: week controls, grouping tabs, summary tiles, groups, and expanded rows use a tighter mobile layout.
- Team: member rows surface name, role, contact, and compact rate context; edit forms use bottom-sheet behavior.
- Materials and production rates: editable rows are compact cards with mobile bottom-sheet edit flows.
- Reports: KPI summaries come first, report panels and rows are tighter on phones.
- Settings/onboarding: forms are single-column on phones, setup copy is reduced, and primary actions remain anchored near the user's thumb.

## Remaining Design Watchpoints

- Test real customer data with very long names, addresses, and product names before demoing on small Android devices.
- If lists grow past 100 rows, add pagination or infinite loading per screen instead of relying on denser cards alone.
