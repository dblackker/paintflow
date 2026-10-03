import { Hono } from "hono";
import { createDb } from "@crewmodo/db";
import {
  auditLogs,
  changeOrders,
  customerPayments,
  estimates,
  jobs,
  leads,
  jobCosts,
  memberships,
  roles,
  timeEntries,
  teamMembers,
  userRoles,
} from "@crewmodo/db/schema";
import { eq, and, sql, type SQL } from "drizzle-orm";
import {
  reportingAddMinor,
  reportingContractSubtotalMinor,
  reportingCostPosition,
  reportingDashboard,
  reportingMoneyMinor,
  type ReportingAcceptance,
  type ReportingAggregate,
} from "../../../../packages/core/src/reporting";
import type { Env, Variables } from "../types";
import { authMiddleware } from "../middleware/tenant";

const reportsApp = new Hono<{ Bindings: Env; Variables: Variables }>();
reportsApp.use("*", authMiddleware);
reportsApp.use("*", async (c, next) => {
  const db = createDb(c.env.DATABASE_URL);
  const orgId = c.get("orgId");
  const userId = c.get("userId");
  const membership = await db.query.memberships.findFirst({
    where: and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)),
  });
  if (membership?.role !== "owner") {
    const [assignment] = await db
      .select({ permissions: roles.permissions })
      .from(userRoles)
      .innerJoin(
        roles,
        and(eq(roles.id, userRoles.roleId), eq(roles.orgId, orgId)),
      )
      .where(and(eq(userRoles.orgId, orgId), eq(userRoles.userId, userId)))
      .limit(1);
    const permissions = Array.isArray(assignment?.permissions)
      ? assignment.permissions
      : [];
    if (
      !membership ||
      (!permissions.includes("all") && !permissions.includes("view_reports"))
    ) {
      return c.json(
        {
          error: "You do not have permission to view reports.",
          code: "REPORTS_FORBIDDEN",
        },
        403,
      );
    }
  }
  await next();
});

function safeDecimal(value: SQL, scale = 2) {
  return sql`case when length(${value}) <= 32 and ${value} ~ ${`^[0-9]+([.][0-9]{1,${scale}})?$`}
    then (${value})::numeric else null end`;
}

// Reduce each proposal to its signed selection before aggregating. Never join raw costs into this scope.
function acceptedScopes(orgId: string) {
  const total = safeDecimal(sql`pkg->>'total'`);
  const tax = safeDecimal(sql`pkg->>'tax'`);
  const subtotal = safeDecimal(sql`pkg->>'subtotal'`);
  const discount = safeDecimal(sql`coalesce(pkg->>'discount', '0')`);
  const quantity = safeDecimal(sql`coalesce(option->>'qty', '1')`, 6);
  const rate = safeDecimal(sql`option->>'rate'`);
  return sql`accepted_scopes as (
    select e.id, e.lead_id,
      case when pkg is null or (acceptance is not null and jsonb_typeof(acceptance) <> 'object') or
        ((jsonb_path_exists(pkg, '$.items[*] ? (@.optional == true)') or jsonb_path_exists(pkg, '$.lineItems[*] ? (@.optional == true)'))
          and jsonb_typeof(acceptance->'selectedOptions') is distinct from 'array')
        or (acceptance ? 'selectedOptions' and jsonb_typeof(acceptance->'selectedOptions') is distinct from 'array')
        then null
        when ${total} >= ${tax} and ${tax} >= 0 then
          case when ${subtotal} is not null and ${discount} is not null
            and greatest(${subtotal} - ${discount}, 0) <> ${total} - ${tax} then null
            else ${total} - ${tax} end
        when ${subtotal} is not null and ${discount} is not null then greatest(${subtotal} - ${discount}, 0)
        else null end + option_totals.amount as subtotal
    from ${estimates} e
    inner join ${leads} l on l.id = e.lead_id and l.org_id = ${orgId}
    left join lateral (
      select a.metadata as acceptance from ${auditLogs} a
      where a.org_id = ${orgId} and a.entity_type = 'estimate' and a.entity_id = e.id
        and a.action in ('estimate.signed', 'estimate.accepted')
      order by a.created_at desc, a.id desc limit 1
    ) accepted on true
    left join lateral (
      select value as pkg from jsonb_array_elements(case when jsonb_typeof(e.packages) = 'array' then e.packages else '[]'::jsonb end)
      where (nullif(acceptance->>'packageName', '') is not null and value->>'name' = acceptance->>'packageName')
        or (nullif(acceptance->>'packageName', '') is null and jsonb_array_length(case when jsonb_typeof(e.packages) = 'array' then e.packages else '[]'::jsonb end) = 1)
      limit 1
    ) selected on true
    left join lateral (
      select case when count(*) filter (where ${quantity} is null or ${rate} is null) > 0 then null
        else round(coalesce(sum(${quantity} * ${rate}), 0), 2) end as amount
      from jsonb_array_elements(case when jsonb_typeof(acceptance->'selectedOptions') = 'array' then acceptance->'selectedOptions' else '[]'::jsonb end) option
    ) option_totals on true
    where e.org_id = ${orgId} and e.status = 'accepted'
  )`;
}

export function buildReportingDashboardQuery(orgId: string) {
  // job_costs already includes labor and its reversals. Adding time_entries would count labor twice.
  return sql`with ${acceptedScopes(orgId)},
    proposal_counts as (
      select count(*) filter (where e.status not in ('superseded', 'voided', 'canceled')) as total_estimates
      from ${estimates} e inner join ${leads} l on l.id = e.lead_id and l.org_id = ${orgId}
      where e.org_id = ${orgId}
    ),
    scope_totals as (
      select coalesce(sum(subtotal), 0) as amount, count(*) as approved, count(*) filter (where subtotal is null) as unresolved from accepted_scopes
    ),
    change_totals as (
      select coalesce(sum(co.amount), 0) as amount from ${changeOrders} co
      inner join ${jobs} j on j.id = co.job_id and j.org_id = ${orgId}
      inner join accepted_scopes scope on scope.id = co.estimate_id and scope.id = j.estimate_id and scope.lead_id = j.lead_id
      where co.org_id = ${orgId} and co.status in ('approved', 'completed')
    ),
    lead_totals as (
      select count(*) as total, count(*) filter (where exists (select 1 from accepted_scopes scope where scope.lead_id = l.id)) as won
      from ${leads} l where l.org_id = ${orgId}
    ),
    cost_totals as (
      select coalesce(sum(cost.total_cost), 0) as amount, count(*) filter (where cost.total_cost > 0) as positive,
        count(distinct j.id) filter (where not exists (select 1 from accepted_scopes scope where scope.id = j.estimate_id and scope.lead_id = j.lead_id)) as unmatched
      from ${jobCosts} cost inner join ${jobs} j on j.id = cost.job_id and j.org_id = ${orgId}
      where cost.org_id = ${orgId}
    ),
    review_totals as (
      select count(*) as unreviewed from ${timeEntries} entry
      inner join ${teamMembers} member on member.id = entry.team_member_id and member.org_id = ${orgId}
      where entry.org_id = ${orgId} and entry.review_status <> 'approved'
        and (entry.job_id is null or exists (select 1 from ${jobs} j where j.id = entry.job_id and j.org_id = ${orgId}))
    ),
    payment_totals as (
      select coalesce(sum(p.amount) filter (where lower(p.currency) = 'usd'), 0) as received,
        coalesce(sum(p.refunded_amount) filter (where lower(p.currency) = 'usd'), 0) as refunded,
        count(*) filter (where lower(p.currency) <> 'usd') as unsupported,
        count(*) filter (where lower(p.currency) = 'usd' and p.refunded_amount > 0
          and (p.metadata->>'lastRefundStatus' in ('pending', 'requires_action', 'failed', 'canceled')
            or p.metadata->>'lastRefundMethod' = 'credit')) as unresolved
      from ${customerPayments} p inner join ${leads} l on l.id = p.lead_id and l.org_id = ${orgId}
      where p.org_id = ${orgId} and p.status in ('succeeded', 'paid', 'partially_refunded', 'refunded')
    )
    select proposal_counts.total_estimates as "totalEstimates", scope_totals.approved as "approvedEstimates",
      lead_totals.total as "totalLeads", lead_totals.won as "wonLeads",
      round((scope_totals.amount + change_totals.amount) * 100)::text as "contractedSubtotalMinor",
      scope_totals.unresolved as "unresolvedContracts", round(cost_totals.amount * 100)::text as "recordedCostMinor",
      cost_totals.positive as "positiveCostCount", cost_totals.unmatched as "unmatchedCostJobs", review_totals.unreviewed as "unreviewedTimeCount",
      round(payment_totals.received * 100)::text as "collectedGrossMinor",
      round(payment_totals.refunded * 100)::text as "refundedGrossMinor",
      payment_totals.unresolved as "unresolvedRefunds", payment_totals.unsupported as "unsupportedCurrencyPayments"
    from proposal_counts cross join scope_totals cross join change_totals cross join lead_totals cross join cost_totals cross join review_totals cross join payment_totals`;
}

reportsApp.get("/dashboard", async (c) => {
  const db = createDb(c.env.DATABASE_URL);
  const result = await db.execute(buildReportingDashboardQuery(c.get("orgId")));
  return c.json({
    data: reportingDashboard(
      result.rows[0] as unknown as ReportingAggregate,
      new Date().toISOString(),
    ),
  });
});

reportsApp.get("/win-rate-by-source", async (c) => {
  const orgId = c.get("orgId");
  const db = createDb(c.env.DATABASE_URL);
  const results = await db
    .select({
      source: leads.source,
      total: sql<number>`count(distinct ${leads.id})`,
      won: sql<number>`count(distinct ${leads.id}) filter (where exists (
      select 1 from ${estimates} e where e.lead_id = ${leads.id} and e.org_id = ${orgId} and e.status = 'accepted'
    ))`,
    })
    .from(leads)
    .where(eq(leads.orgId, orgId))
    .groupBy(leads.source);
  return c.json({
    data: results.map((row) => ({
      source: row.source || "Unknown",
      total: Number(row.total),
      won: Number(row.won),
      winRate: Number(row.total)
        ? Math.round((Number(row.won) / Number(row.total)) * 100)
        : 0,
    })),
  });
});

reportsApp.get("/crew-performance", async (c) => {
  const orgId = c.get("orgId");
  const db = createDb(c.env.DATABASE_URL);
  const results = await db
    .select({
      memberId: teamMembers.id,
      name: teamMembers.name,
      totalHours: sql<string>`coalesce(sum(${timeEntries.hours}), 0)`,
      jobsWorked: sql<number>`count(distinct ${timeEntries.jobId})`,
      totalCost: sql<string>`coalesce(sum(${timeEntries.totalCost}), 0)`,
    })
    .from(teamMembers)
    .leftJoin(
      timeEntries,
      and(
        eq(timeEntries.teamMemberId, teamMembers.id),
        eq(timeEntries.orgId, orgId),
        eq(timeEntries.reviewStatus, "approved"),
        sql`(${timeEntries.jobId} is null or exists (select 1 from ${jobs} j where j.id = ${timeEntries.jobId} and j.org_id = ${orgId}))`,
      ),
    )
    .where(eq(teamMembers.orgId, orgId))
    .groupBy(teamMembers.id, teamMembers.name)
    .orderBy(
      sql`coalesce(sum(${timeEntries.hours}), 0) desc, ${teamMembers.id}`,
    );
  return c.json({ data: results });
});

reportsApp.get("/job-mix", async (c) => {
  const orgId = c.get("orgId");
  const db = createDb(c.env.DATABASE_URL);
  const result = await db.execute(sql`with ${acceptedScopes(orgId)},
    approved_changes as (
      select co.job_id, sum(co.amount) as amount from ${changeOrders} co
      inner join ${jobs} j on j.id = co.job_id and j.org_id = ${orgId}
      inner join accepted_scopes scope on scope.id = co.estimate_id and scope.id = j.estimate_id and scope.lead_id = j.lead_id
      where co.org_id = ${orgId} and co.status in ('approved', 'completed') group by co.job_id
    ),
    job_mix as (
      select j.status, coalesce(nullif(concat_ws(', ', nullif(j.city, ''), nullif(j.state, '')), ''), 'Unassigned city') as city,
        scope.subtotal + coalesce(changes.amount, 0) as subtotal
      from ${jobs} j
      left join accepted_scopes scope on scope.id = j.estimate_id and scope.lead_id = j.lead_id
      left join approved_changes changes on changes.job_id = j.id
      where j.org_id = ${orgId} and exists (select 1 from ${leads} l where l.org_id = ${orgId} and l.id = j.lead_id)
    ),
    cities as (
      select city as label, count(*) as jobs, coalesce(sum(subtotal), 0)::text as "knownContractedSubtotal",
        count(*) filter (where subtotal is null) as "unresolvedJobs"
      from job_mix group by city order by coalesce(sum(subtotal), 0) desc, city limit 6
    ),
    statuses as (select status, count(*) as count from job_mix group by status order by count(*) desc, status)
    select coalesce((select jsonb_agg(cities) from cities), '[]'::jsonb) as cities,
      coalesce((select jsonb_agg(statuses) from statuses), '[]'::jsonb) as statuses`);
  const [row] = result.rows as Array<{
    cities: Array<{
      label: string;
      jobs: number;
      knownContractedSubtotal: string;
      unresolvedJobs: number;
    }>;
    statuses: Array<{ status: string; count: number }>;
  }>;
  return c.json({
    data: {
      cities: row.cities.map((city) => ({
        ...city,
        jobs: Number(city.jobs),
        unresolvedJobs: Number(city.unresolvedJobs),
        knownContractedSubtotal:
          reportingMoneyMinor(city.knownContractedSubtotal) / 100,
        contractedSubtotal: Number(city.unresolvedJobs)
          ? null
          : reportingMoneyMinor(city.knownContractedSubtotal) / 100,
      })),
      statuses: row.statuses.map((status) => ({
        ...status,
        count: Number(status.count),
      })),
    },
  });
});

reportsApp.get("/profit-margins", async (c) => {
  const orgId = c.get("orgId");
  const limitText = c.req.query("limit") ?? "20";
  if (
    !/^\d+$/.test(limitText) ||
    Number(limitText) < 1 ||
    Number(limitText) > 100
  )
    return c.json(
      {
        error: "Use a report limit between 1 and 100.",
        code: "INVALID_REPORT_LIMIT",
      },
      400,
    );
  const limit = Number(limitText);
  const cursor = c.req.query("cursor");
  let cursorFilter = sql`true`;
  if (cursor) {
    const [timestamp, id, extra] = cursor.split("|");
    if (
      extra ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[.]\d{6}$/.test(timestamp ?? "") ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
        id ?? "",
      ) ||
      Number.isNaN(Date.parse(`${timestamp}Z`)) ||
      new Date(`${timestamp}Z`).toISOString().slice(0, 19) !==
        timestamp.slice(0, 19)
    )
      return c.json(
        { error: "Invalid report cursor.", code: "INVALID_REPORT_CURSOR" },
        400,
      );
    cursorFilter = sql`(j.created_at, j.id) < (${timestamp}::timestamp, ${id}::uuid)`;
  }
  const db = createDb(c.env.DATABASE_URL);
  const result =
    await db.execute(sql`select j.id as "jobId", j.name as title, j.status,
      to_char(j.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.US') as "createdAtCursor",
      j.city, j.state, e.status as "estimateStatus", e.packages, accepted.acceptance,
      coalesce(costs.amount, 0)::text as costs, coalesce(costs.positive, 0) as "positiveCostCount",
      coalesce(reviews.unreviewed, 0) as "unreviewedTimeCount", coalesce(changes.amount, 0)::text as "approvedChanges"
    from ${jobs} j
    left join ${estimates} e on e.id = j.estimate_id and e.org_id = ${orgId} and e.lead_id = j.lead_id
    left join lateral (
      select a.metadata as acceptance from ${auditLogs} a where a.org_id = ${orgId} and a.entity_type = 'estimate'
        and a.entity_id = e.id and a.action in ('estimate.signed', 'estimate.accepted')
      order by a.created_at desc, a.id desc limit 1
    ) accepted on true
    left join lateral (
      select sum(cost.total_cost) as amount, count(*) filter (where cost.total_cost > 0) as positive
      from ${jobCosts} cost where cost.job_id = j.id and cost.org_id = ${orgId}
    ) costs on true
    left join lateral (
      select count(*) as unreviewed from ${timeEntries} entry
      inner join ${teamMembers} member on member.id = entry.team_member_id and member.org_id = ${orgId}
      where entry.job_id = j.id and entry.org_id = ${orgId} and entry.review_status <> 'approved'
    ) reviews on true
    left join lateral (
      select sum(co.amount) as amount from ${changeOrders} co where co.org_id = ${orgId} and co.job_id = j.id
        and co.estimate_id = e.id and e.status = 'accepted' and co.status in ('approved', 'completed')
    ) changes on true
    where j.org_id = ${orgId} and ${cursorFilter}
      and exists (select 1 from ${leads} l where l.id = j.lead_id and l.org_id = ${orgId})
    order by j.created_at desc, j.id desc limit ${limit + 1}`);
  const rows = result.rows as Array<{
    jobId: string;
    title: string;
    status: string;
    createdAtCursor: string;
    city: string | null;
    state: string | null;
    estimateStatus: string | null;
    packages: unknown;
    acceptance: ReportingAcceptance | null;
    costs: string;
    positiveCostCount: string;
    unreviewedTimeCount: string;
    approvedChanges: string;
  }>;
  const page = rows.slice(0, limit);
  const data = page.map((row) => {
    const baseMinor =
      row.estimateStatus === "accepted"
        ? reportingContractSubtotalMinor(
            { status: row.estimateStatus, packages: row.packages },
            row.acceptance,
          )
        : null;
    const contractedMinor =
      baseMinor === null
        ? null
        : reportingAddMinor(
            baseMinor,
            reportingMoneyMinor(row.approvedChanges),
          );
    const costMinor = reportingMoneyMinor(row.costs);
    const unreviewedTimeCount = Number(row.unreviewedTimeCount);
    const position = reportingCostPosition({
      contractedSubtotalMinor: contractedMinor,
      recordedCostMinor: costMinor,
      positiveCostCount: Number(row.positiveCostCount),
      unreviewedTimeCount,
    });
    return {
      jobId: row.jobId,
      title: row.title,
      status: row.status,
      city: row.city,
      state: row.state,
      revenue: contractedMinor === null ? null : contractedMinor / 100,
      costs: costMinor / 100,
      profit:
        position.positionMinor === null ? null : position.positionMinor / 100,
      margin: position.margin,
      costCompleteness: position.costCompleteness,
      finalMargin: null,
      unreviewedTimeCount,
      contractNeedsReview: baseMinor === null,
    };
  });
  const last = page[page.length - 1];
  return c.json({
    data,
    nextCursor:
      rows.length > limit && last
        ? `${last.createdAtCursor}|${last.jobId}`
        : null,
    limit,
    asOf: new Date().toISOString(),
  });
});

export default reportsApp;
