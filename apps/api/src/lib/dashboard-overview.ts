import { sql } from 'drizzle-orm';
import type { DashboardRange } from '../../../../packages/core/src/dashboard-insights';

export function buildDashboardOverviewQuery(
  orgId: string,
  range: DashboardRange,
) {
  return sql`with bounds as (
    select ${range.endDate}::date as today,
      (${range.endDate}::timestamp at time zone ${range.timeZone} at time zone 'UTC') as day_start,
      ((${range.endDate}::date + 1)::timestamp at time zone ${range.timeZone} at time zone 'UTC') as day_end
  ), owned_jobs as (
    select j.id, j.name, j.status, l.name as customer_name,
      case when nullif(trim(j.street_address), '') is not null then j.street_address else l.street_address end as street_address,
      case when nullif(trim(j.street_address), '') is not null then j.city else l.city end as city,
      case when nullif(trim(j.street_address), '') is not null then j.state else l.state end as state,
      (j.scheduled_start_at at time zone 'UTC' at time zone ${range.timeZone})::date as first_day,
      (coalesce(j.scheduled_end_at, j.scheduled_start_at) at time zone 'UTC' at time zone ${range.timeZone})::date as last_day
    from jobs j join leads l on l.id = j.lead_id and l.org_id = ${orgId}::uuid
    where j.org_id = ${orgId}::uuid and j.status in ('scheduled', 'in_progress', 'punch_list')
      and j.scheduled_start_at is not null
  ), today_jobs as (
    select j.* from owned_jobs j cross join bounds b
    where first_day <= b.today and last_day >= b.today
      and (extract(isodow from b.today) < 6 or
        (first_day = b.today and last_day - first_day <= 1 and extract(isodow from last_day) >= 6))
  ), due_tasks as (
    select a.id, a.title, a.due_at, l.name as customer_name, a.due_at < b.day_start as overdue,
      case when a.lead_id is not null then '/leads/' || a.lead_id || '#customer-activity'
        when a.job_id is not null then '/jobs/' || a.job_id else '/activity' end as href
    from activities a cross join bounds b
    left join leads l on l.id = a.lead_id and l.org_id = ${orgId}::uuid
    left join jobs j on j.id = a.job_id and j.org_id = ${orgId}::uuid
    left join leads jl on jl.id = j.lead_id and jl.org_id = ${orgId}::uuid
    where a.org_id = ${orgId}::uuid and a.status = 'open' and a.due_at < b.day_end
      and (a.lead_id is null or l.id is not null)
      and (a.job_id is null or (j.id is not null and jl.id is not null))
  ) select
    (select count(*) from leads where org_id = ${orgId}::uuid) as "totalCustomers",
    (select count(*) from leads where org_id = ${orgId}::uuid and status = 'new') as "newLeads",
    (select count(*) from estimates e join leads l on l.id = e.lead_id and l.org_id = ${orgId}::uuid
      where e.org_id = ${orgId}::uuid and e.status = 'sent') as "awaitingApproval",
    (select count(*) from due_tasks where overdue) as "overdueTasks",
    (select count(*) from due_tasks where not overdue) as "dueToday",
    (select count(*) from today_jobs) as "todayJobCount",
    coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'status', status, 'customerName', customer_name,
      'streetAddress', street_address, 'city', city, 'state', state) order by first_day, id)
      from (select * from today_jobs order by first_day, id limit 4) j), '[]'::jsonb) as "todayJobs",
    coalesce((select jsonb_agg(jsonb_build_object('id', id, 'title', title, 'customerName', customer_name,
      'dueAt', to_char(due_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'overdue', overdue, 'href', href) order by due_at, id)
      from (select * from due_tasks order by due_at, id limit 4) a), '[]'::jsonb) as tasks`;
}

export function buildDashboardCollectionsQuery(orgId: string, today: string) {
  // Reuse the disposition-aware ledger. Credits and uncertain refunds must not
  // become new receivables, nor may multiple payment rows multiply an invoice.
  return sql`with positions as (
    select i.status, i.due_date, payment_obligation_balance(i.org_id, i.id, null) as balance
    from customer_invoices i join leads l on l.id = i.lead_id and l.org_id = ${orgId}::uuid
    where i.org_id = ${orgId}::uuid and i.status not in ('draft', 'canceled', 'voided', 'refunded')
  ), collectible as (
    select *, (balance->>'remaining')::numeric as remaining from positions
    where status <> 'paid' and not (balance->>'closed')::boolean and not (balance->>'needsReview')::boolean
      and (balance->>'pendingRefunds')::integer = 0 and (balance->>'remaining')::numeric > 0
  ) select count(*) as "invoiceCount", coalesce(sum(remaining), 0)::text as outstanding,
    count(*) filter (where due_date::date < ${today}::date) as "overdueCount",
    coalesce(sum(remaining) filter (where due_date::date < ${today}::date), 0)::text as overdue,
    (select count(*) from positions where (balance->>'needsReview')::boolean or (balance->>'pendingRefunds')::integer > 0
      or (status = 'paid' and (balance->>'remaining')::numeric > 0)) as "reviewCount"
    from collectible`;
}
