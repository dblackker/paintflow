# Mobile UX Audit

PaintFlow is field software first: a contractor should be able to add leads, review the pipeline, log time, check jobs, and send estimates from a phone without fighting desktop-density layouts.

## Fixed This Pass

- Global shell: notification popover now becomes a bounded mobile panel instead of a desktop dropdown that can overflow the viewport.
- Global shell: notification badge is smaller on phones and no longer clips against the icon button.
- Dashboard: primary actions are compact four-across icon actions on phones.
- Dashboard: KPI cards are compact three-across tiles on phones, keeping the important counts above the fold.
- Dashboard: cards and activity rows have reduced padding on phones.

## Screen Notes

- Dashboard: top KPIs should remain dense on mobile. Keep deeper explanations off the mobile KPI tiles and use the linked destination for details.
- Leads: lead list should stay card based, but filters/search need to remain single-column and sticky action affordances should be considered once the list grows.
- Pipeline: columns should not try to mimic desktop kanban on narrow screens. Prefer stage sections with compact cards and clear counts.
- Estimates list: customer, address, status, and total should be the primary line items. Hide secondary metadata behind detail pages.
- Production estimator: the quick-scope controls should remain above scope items, but surface rows need compact edit states and bottom-placed add actions.
- Estimate proposal: public view should keep a customer-first summary; avoid contractor-only activity/photos unless explicitly shared.
- Jobs: job cards need compact status/address/customer summaries, with time/photo/change-order actions grouped as secondary actions.
- Job detail: mobile should prioritize jobsite, customer contact, schedule/status, then today's actions. Costing and history can sit lower.
- Time: day/job/employee grouping is the right mobile pattern. Expanded rows should stay single-row where possible and hide descriptions unless present.
- Team: member rows should surface role and contact first; pay/burden rates belong in edit/detail contexts.
- Materials and production rates: dense editable tables should become compact list rows with edit sheets on phones.
- Reports: charts need mobile-specific summaries first; tables should not be the first mobile surface.
- Settings/onboarding: forms should remain single-column with input-specific keyboards and short helper copy behind info controls.
