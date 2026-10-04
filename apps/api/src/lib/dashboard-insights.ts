import { sql } from 'drizzle-orm';
import { estimates, jobs, leads } from '@crewmodo/db/schema';
import type { DashboardRange } from '../../../../packages/core/src/dashboard-insights';

export function buildDashboardInsightsQuery(orgId: string, range: DashboardRange) {
  const asOf = range.asOf.replace('T', ' ').replace('Z', '');
  return sql`with bounds as (
    select ${range.startDate}::date as first_week,
      (${range.startDate}::timestamp at time zone ${range.timeZone} at time zone 'UTC') as start_at,
      ${asOf}::timestamp as as_of
  ), cohort as (
    select l.id, l.created_at, l.status from ${leads} l cross join bounds b
    where l.org_id = ${orgId} and l.created_at >= b.start_at and l.created_at <= b.as_of
  ), progress as (
    select l.*,
      exists (select 1 from ${estimates} e cross join bounds b
        where e.org_id = ${orgId} and e.lead_id = l.id and e.created_at <= b.as_of) as estimated,
      exists (select 1 from ${estimates} e cross join bounds b
        where e.org_id = ${orgId} and e.lead_id = l.id and e.created_at <= b.as_of
          and ((e.sent_at is not null and e.sent_at <= b.as_of) or e.status in ('sent', 'accepted', 'declined'))) as sent,
      exists (select 1 from ${estimates} e cross join bounds b
        where e.org_id = ${orgId} and e.lead_id = l.id and e.created_at <= b.as_of
          and e.status = 'accepted' and (e.signed_at is null or e.signed_at <= b.as_of)) as won
    from cohort l
  ), weeks as (
    select generate_series(first_week, first_week + (${range.weeks} - 1) * 7, interval '7 days')::date as week_start from bounds
  ), weekly as (
    select w.week_start, count(l.id) as count from weeks w
    left join cohort l on date_trunc('week', l.created_at at time zone 'UTC' at time zone ${range.timeZone})::date = w.week_start
    group by w.week_start
  ), sales as (
    select count(*) as leads, count(*) filter (where estimated) as estimated, count(*) filter (where sent) as sent,
      count(*) filter (where won) as won, count(*) filter (where status = 'lost' and not won) as lost,
      count(*) filter (where status = 'won' and not won) as manual_wins from progress
  ), operations as (
    select count(*) filter (where j.status = 'deposit_pending') as deposit_pending,
      count(*) filter (where j.status not in ('deposit_pending', 'in_progress', 'punch_list', 'completed', 'cancelled', 'canceled', 'voided') and j.scheduled_start_at is null) as needs_scheduling,
      count(*) filter (where j.status not in ('deposit_pending', 'in_progress', 'punch_list', 'completed', 'cancelled', 'canceled', 'voided') and j.scheduled_start_at is not null) as scheduled,
      count(*) filter (where j.status = 'in_progress') as in_production,
      count(*) filter (where j.status = 'punch_list') as punch_list,
      count(*) filter (where j.status = 'completed' and j.completed_at >= b.start_at and j.completed_at <= b.as_of) as completed
    from ${jobs} j cross join bounds b
    inner join ${leads} l on l.id = j.lead_id and l.org_id = ${orgId}
    where j.org_id = ${orgId} and j.created_at <= b.as_of
  )
  select sales.leads, sales.estimated, sales.sent, sales.won, sales.lost, sales.manual_wins as "manualWins",
    (select jsonb_agg(jsonb_build_object('weekStart', to_char(week_start, 'YYYY-MM-DD'), 'count', count) order by week_start) from weekly) as "weeklyLeads",
    operations.deposit_pending as "depositPending", operations.needs_scheduling as "needsScheduling",
    operations.scheduled, operations.in_production as "inProduction", operations.punch_list as "punchList", operations.completed
  from sales cross join operations`;
}
