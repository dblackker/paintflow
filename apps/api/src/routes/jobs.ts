import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { createDb } from '@crewmodo/db';
import {
  auditLogs,
  changeOrders,
  estimateMaterials,
  estimates,
  jobCosts,
  jobs,
  leads,
  materialPurchases,
  memberships,
  roles,
  teamMembers,
  timeEntries,
  userRoles,
} from '@crewmodo/db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import { jobFinancialPosition } from "../../../../packages/core/src/job-financial-position";
import {
  reportingAddMinor,
  reportingMoneyMinor,
  type ReportingAcceptance,
} from "../../../../packages/core/src/reporting";
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';

const jobsApp = new Hono<{ Bindings: Env; Variables: Variables }>();
jobsApp.use('*', authMiddleware);

const money = (value: unknown) => Number(value || 0);

function dateValue(value: unknown) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function selectedEstimatePackage(
  estimate: typeof estimates.$inferSelect | undefined,
  acceptance?: ReportingAcceptance | null,
) {
  const packages = Array.isArray(estimate?.packages)
    ? (estimate.packages as any[])
    : [];
  return acceptance?.packageName
    ? packages.find((pkg) => pkg.name === acceptance.packageName)
    : packages.length === 1
      ? packages[0]
      : undefined;
}

function estimatedLaborHoursFromPackage(
  estimate: typeof estimates.$inferSelect | undefined,
  acceptance?: ReportingAcceptance | null,
) {
  const pkg = selectedEstimatePackage(estimate, acceptance);
  if (!pkg) return null;
  const items = Array.isArray(pkg?.items) ? pkg.items : Array.isArray(pkg?.lineItems) ? pkg.lineItems : [];
  const hours = items.reduce((total: number, item: any) => {
    const lineHours = money(item?.labor?.hours);
    if (lineHours > 0) return total + lineHours;
    return total + money(item?.laborHours) * Math.max(money(item?.qty) || 1, 1);
  }, 0);
  return Number(hours.toFixed(2));
}

async function getJobForOrg(db: ReturnType<typeof createDb>, orgId: string, jobId: string) {
  return db.query.jobs.findFirst({
    where: and(eq(jobs.id, jobId), eq(jobs.orgId, orgId)),
  });
}

async function canViewJobFinancials(
  c: Context<{ Bindings: Env; Variables: Variables }>,
) {
  const db = createDb(c.env.DATABASE_URL);
  const orgId = c.get('orgId');
  const userId = c.get("userId");
  const member = await db.query.memberships.findFirst({
    where: and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)),
  });
  if (member?.role === "owner") return true;
  if (!member) return false;
  const [assignment] = await db
    .select({ permissions: roles.permissions })
    .from(userRoles)
    .innerJoin(
      roles,
      and(eq(roles.id, userRoles.roleId), eq(roles.orgId, orgId)),
    )
    .where(and(eq(userRoles.orgId, orgId), eq(userRoles.userId, userId)))
    .limit(1);
  return (
    Array.isArray(assignment?.permissions) &&
    (assignment.permissions.includes("all") ||
      assignment.permissions.includes("view_reports"))
  );
}

// Each lateral aggregate returns one row per job. Time entries indicate review only;
// their labor is already in job_costs and must not be added a second time.
export function buildJobFinancialQuery(
  orgId: string,
  options: {
    jobId?: string;
    limit?: number;
    cursor?: { timestamp: string; id: string };
  } = {},
) {
  const filter = options.jobId ? sql`j.id = ${options.jobId}::uuid` : sql`true`;
  const cursor = options.cursor
    ? sql`(j.created_at, j.id) < (${options.cursor.timestamp}::timestamp, ${options.cursor.id}::uuid)`
    : sql`true`;
  return sql`select to_jsonb(j) as job,
    l.name as "leadName", l.phone as "leadPhone", l.email as "leadEmail",
    l.street_address as "leadStreetAddress", l.city as "leadCity", l.state as "leadState", l.postal_code as "leadPostalCode",
    e.status as "estimateStatus", e.packages, accepted.acceptance,
    to_char(j.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.US') as "createdAtCursor",
    coalesce(costs.total, 0)::text as "recordedCost", costs.records as "costRecordCount", costs.positive as "positiveCostCount",
    costs.labor::text, costs.materials::text, costs.supplies::text, costs.expenses::text, costs.hours::text as "laborHours",
    costs.material_records as "materialCostRecordCount",
    reviews.unreviewed as "unreviewedTimeCount", coalesce(changes.amount, 0)::text as "approvedChanges",
    expected.amount::text as "estimatedMaterials"
    from ${jobs} j
    inner join ${leads} l on l.id = j.lead_id and l.org_id = ${orgId}
    left join ${estimates} e on e.id = j.estimate_id and e.org_id = ${orgId} and e.lead_id = j.lead_id
    left join lateral (
      select a.metadata as acceptance from ${auditLogs} a
      where a.org_id = ${orgId} and a.entity_type = 'estimate' and a.entity_id = e.id
        and a.action in ('estimate.signed', 'estimate.accepted')
      order by a.created_at desc, a.id desc limit 1
    ) accepted on true
    left join lateral (
      select coalesce(sum(cost.total_cost), 0) as total, count(*) as records,
        count(*) filter (where cost.total_cost > 0) as positive,
        count(*) filter (where cost.category = 'materials' and cost.total_cost > 0) as material_records,
        coalesce(sum(cost.total_cost) filter (where cost.category = 'labor'), 0) as labor,
        coalesce(sum(cost.total_cost) filter (where cost.category = 'materials'), 0) as materials,
        coalesce(sum(cost.total_cost) filter (where cost.category = 'supplies'), 0) as supplies,
        coalesce(sum(cost.total_cost) filter (where cost.category not in ('labor', 'materials', 'supplies')), 0) as expenses,
        coalesce(sum(cost.quantity) filter (where cost.category = 'labor'), 0) as hours
      from ${jobCosts} cost where cost.job_id = j.id and cost.org_id = ${orgId}
    ) costs on true
    left join lateral (
      select count(*) as unreviewed from ${timeEntries} entry
      inner join ${teamMembers} member on member.id = entry.team_member_id and member.org_id = ${orgId}
      where entry.job_id = j.id and entry.org_id = ${orgId} and entry.review_status <> 'approved'
    ) reviews on true
    left join lateral (
      select sum(co.amount) as amount from ${changeOrders} co
      where co.job_id = j.id and co.org_id = ${orgId} and co.estimate_id = e.id
        and e.status = 'accepted' and co.status in ('approved', 'completed')
    ) changes on true
    left join lateral (
      select sum(material.total_cost) as amount from ${estimateMaterials} material
      where material.estimate_id = e.id and e.org_id = ${orgId} and e.status = 'accepted'
        and jsonb_array_length(case when jsonb_typeof(e.packages) = 'array' then e.packages else '[]'::jsonb end) = 1
        and not jsonb_path_exists(e.packages, '$[*].items[*] ? (@.optional == true)')
        and not jsonb_path_exists(e.packages, '$[*].lineItems[*] ? (@.optional == true)')
    ) expected on true
    where j.org_id = ${orgId} and ${filter} and ${cursor}
    order by j.created_at desc, j.id desc limit ${options.jobId ? 1 : (options.limit ?? 50) + 1}`;
}

interface JobFinancialRow {
  job: Record<string, unknown>;
  leadName: string;
  leadPhone: string | null;
  leadEmail: string | null;
  leadStreetAddress: string | null;
  leadCity: string | null;
  leadState: string | null;
  leadPostalCode: string | null;
  estimateStatus: string | null;
  packages: unknown;
  acceptance: ReportingAcceptance | null;
  recordedCost: string;
  costRecordCount: string;
  positiveCostCount: string;
  labor: string;
  materials: string;
  supplies: string;
  expenses: string;
  laborHours: string;
  unreviewedTimeCount: string;
  approvedChanges: string;
  estimatedMaterials: string | null;
  materialCostRecordCount: string;
  createdAtCursor: string;
}

export function jobCostingFromRow(row: JobFinancialRow, asOf: string) {
  const financialSummary = jobFinancialPosition({
    estimate: row.estimateStatus
      ? { status: row.estimateStatus, packages: row.packages }
      : null,
    acceptance: row.acceptance,
    approvedChanges: row.approvedChanges,
    recordedCost: row.recordedCost,
    costRecordCount: Number(row.costRecordCount),
    positiveCostCount: Number(row.positiveCostCount),
    unreviewedTimeCount: Number(row.unreviewedTimeCount),
    estimatedMaterials: row.estimatedMaterials,
    asOf,
  });
  const j = row.job;
  const dollars = (amount: { minor: number } | null) =>
    amount === null ? null : amount.minor / 100;
  const laborHours = Number(row.laborHours);
  const materialsMinor = reportingMoneyMinor(row.materials);
  const expectedMinor = financialSummary.estimatedMaterialCost?.minor ?? null;
  return {
    job: {
      id: j.id as string,
      orgId: j.org_id,
      jobNumber: j.job_number as string | null,
      name: j.name as string,
      status: j.status as string,
      budget: j.budget,
      estimateId: j.estimate_id as string | null,
      leadId: j.lead_id as string,
      streetAddress: j.street_address as string | null,
      city: j.city as string | null,
      state: j.state as string | null,
      postalCode: j.postal_code as string | null,
      scheduledStartAt: j.scheduled_start_at,
      scheduledEndAt: j.scheduled_end_at,
      completedAt: j.completed_at,
      createdAt: j.created_at,
      updatedAt: j.updated_at,
      leadName: row.leadName,
      leadEmail: row.leadEmail,
      leadPhone: row.leadPhone,
      leadStreetAddress: row.leadStreetAddress,
      leadCity: row.leadCity,
      leadState: row.leadState,
      leadPostalCode: row.leadPostalCode,
    },
    financialSummary,
    // Legacy DTO keys remain, but mean pre-tax contracted scope and current recorded cost position.
    revenue: {
      contract: dollars(financialSummary.contractBaseSubtotal),
      approvedChangeOrders: dollars(
        financialSummary.approvedChangeOrdersSubtotal,
      ),
      total: dollars(financialSummary.contractedSubtotal),
    },
    costs: {
      labor: reportingMoneyMinor(row.labor) / 100,
      materials: materialsMinor / 100,
      supplies: reportingMoneyMinor(row.supplies) / 100,
      expenses: reportingMoneyMinor(row.expenses) / 100,
      total: financialSummary.recordedActualCost.minor / 100,
    },
    production: {
      laborHours,
      averageLaborRate:
        laborHours > 0
          ? reportingMoneyMinor(row.labor) / 100 / laborHours
          : null,
    },
    budget: {
      estimatedMaterials: dollars(financialSummary.estimatedMaterialCost),
      materialVariance:
        expectedMinor === null || !Number(row.materialCostRecordCount)
          ? null
          : reportingAddMinor(materialsMinor, -expectedMinor) / 100,
      remainingGrossProfit: dollars(financialSummary.currentCostPosition),
    },
    profitability: {
      grossProfit: dollars(financialSummary.currentCostPosition),
      grossMargin: financialSummary.recordedMarginPercent,
      costToRevenue:
        financialSummary.currentCostPosition === null ||
        !financialSummary.contractedSubtotal?.minor
          ? null
          : Number(
              (
                (financialSummary.recordedActualCost.minor /
                  financialSummary.contractedSubtotal.minor) *
                100
              ).toFixed(1),
            ),
    },
  };
}

jobsApp.get('/', async (c) => {
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);

  const limit = Number(c.req.query("limit") ?? 50);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    return c.json(
      { error: "Use a limit between 1 and 100.", code: "INVALID_JOB_LIMIT" },
      400,
    );
  let cursor: { timestamp: string; id: string } | undefined;
  if (c.req.query("cursor")) {
    const [timestamp, id, extra] = c.req.query("cursor")!.split("|");
    if (
      extra ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[.]\d{6}$/.test(timestamp ?? '') ||
      !z.string().uuid().safeParse(id).success ||
      Number.isNaN(Date.parse(`${timestamp}Z`)) ||
      new Date(`${timestamp}Z`).toISOString().slice(0, 19) !==
        timestamp.slice(0, 19)
    )
      return c.json(
        { error: "Invalid job cursor.", code: "INVALID_JOB_CURSOR" },
        400,
      );
    cursor = { timestamp, id };
  }
  const result = await db.execute(
    buildJobFinancialQuery(orgId, { limit, cursor }),
  );
  const rows = result.rows as unknown as JobFinancialRow[];
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  const asOf = new Date().toISOString();
  const canViewFinancials = await canViewJobFinancials(c);

  return c.json({
    data: page.map((row) => {
      const costing = jobCostingFromRow(row, asOf);
      return {
        ...costing.job,
        ...(canViewFinancials
          ? { financialSummary: costing.financialSummary, costing: { revenue: costing.revenue, costs: costing.costs, production: costing.production, profitability: costing.profitability, budget: costing.budget } }
          : {}),
        estimatedLaborHours: estimatedLaborHoursFromPackage(
          row.packages
            ? ({ packages: row.packages } as typeof estimates.$inferSelect)
            : undefined,
          row.acceptance,
        ),
      };
    }),
    nextCursor:
      rows.length > limit && last
        ? `${last.createdAtCursor}|${last.job.id}`
        : null,
    limit,
  });
});

jobsApp.get('/:id', async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  const db = createDb(c.env.DATABASE_URL);
  
  const job = await getJobForOrg(db, orgId, id);
  
  if (!job) return c.json({ error: 'Not found' }, 404);
  return c.json({ data: job });
});

const updateJobSchema = z.object({
  name: z.string().min(1).optional(),
  status: z.enum(['deposit_pending', 'scheduled', 'in_progress', 'completed', 'cancelled']).optional(),
  budget: z.coerce.number().min(0).optional(),
  streetAddress: z.string().trim().max(255).nullable().optional(),
  city: z.string().trim().max(100).nullable().optional(),
  state: z.string().trim().max(50).nullable().optional(),
  postalCode: z.string().trim().max(20).nullable().optional(),
  scheduledStartAt: z.string().datetime().nullable().optional(),
  scheduledEndAt: z.string().datetime().nullable().optional(),
  completedAt: z.string().datetime().nullable().optional(),
});

jobsApp.patch('/:id', async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  const parsed = updateJobSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const db = createDb(c.env.DATABASE_URL);
  const existing = await getJobForOrg(db, orgId, id);
  if (!existing) return c.json({ error: 'Not found' }, 404);

  const [job] = await db.update(jobs)
    .set({
      ...('name' in parsed.data ? { name: parsed.data.name } : {}),
      ...('status' in parsed.data ? { status: parsed.data.status } : {}),
      ...('budget' in parsed.data ? { budget: parsed.data.budget?.toString() } : {}),
      ...('streetAddress' in parsed.data ? { streetAddress: parsed.data.streetAddress || null } : {}),
      ...('city' in parsed.data ? { city: parsed.data.city || null } : {}),
      ...('state' in parsed.data ? { state: parsed.data.state || null } : {}),
      ...('postalCode' in parsed.data ? { postalCode: parsed.data.postalCode || null } : {}),
      ...('scheduledStartAt' in parsed.data ? { scheduledStartAt: parsed.data.scheduledStartAt ? new Date(parsed.data.scheduledStartAt) : null } : {}),
      ...('scheduledEndAt' in parsed.data ? { scheduledEndAt: parsed.data.scheduledEndAt ? new Date(parsed.data.scheduledEndAt) : null } : {}),
      ...('completedAt' in parsed.data ? { completedAt: parsed.data.completedAt ? new Date(parsed.data.completedAt) : null } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(jobs.id, id), eq(jobs.orgId, orgId)))
    .returning();

  return c.json({ data: job });
});

jobsApp.get('/:id/costs', async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  const db = createDb(c.env.DATABASE_URL);
  const job = await getJobForOrg(db, orgId, id);
  if (!job) return c.json({ error: 'Not found' }, 404);
  
  const costs = await db.query.jobCosts.findMany({
    where: and(eq(jobCosts.jobId, id), eq(jobCosts.orgId, orgId)),
    orderBy: () => [desc(sql`coalesce(${jobCosts.costDate}, ${jobCosts.createdAt})`)],
  });
  
  return c.json({ data: costs });
});

jobsApp.get('/:id/costing', async (c) => {
  if (!(await canViewJobFinancials(c)))
    return c.json(
      {
        error: "You do not have permission to view job costs.",
        code: "JOB_COSTS_FORBIDDEN",
      },
      403,
    );
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  const db = createDb(c.env.DATABASE_URL);
  const job = await getJobForOrg(db, orgId, id);
  if (!job) return c.json({ error: 'Not found' }, 404);

  const [financialRows, costs, orders, purchases] = await Promise.all([
    db.execute(buildJobFinancialQuery(orgId, { jobId: id })),
    db.query.jobCosts.findMany({
    where: and(eq(jobCosts.jobId, id), eq(jobCosts.orgId, orgId)),
    orderBy: () => [desc(sql`coalesce(${jobCosts.costDate}, ${jobCosts.createdAt})`)],
  }),
    db.query.changeOrders.findMany({
      where: and(eq(changeOrders.jobId, id), eq(changeOrders.orgId, orgId)),
      orderBy: (changeOrders, { desc }) => [desc(changeOrders.createdAt)],
    }),
    db.query.materialPurchases.findMany({
      where: and(eq(materialPurchases.jobId, id), eq(materialPurchases.orgId, orgId)),
      orderBy: (materialPurchases, { desc }) => [desc(materialPurchases.createdAt)],
    }),
  ]);
  const row = financialRows.rows[0] as unknown as JobFinancialRow | undefined;
  if (!row) return c.json({ error: 'Not found' }, 404);

  return c.json({
    data: {
      ...jobCostingFromRow(row, new Date().toISOString()),
      lists: {
        costs,
        changeOrders: orders,
        materialPurchases: purchases,
      },
    },
  });
});

const createCostSchema = z.object({
  category: z.enum(['labor', 'materials', 'supplies', 'subcontractor', 'equipment', 'other']),
  description: z.string().min(1),
  quantity: z.coerce.number().positive(),
  unitCost: z.coerce.number().positive(),
  costDate: z.string().optional().nullable(),
});

const updateCostSchema = createCostSchema.partial().refine((value) => Object.keys(value).length > 0, {
  message: 'At least one field is required',
});

jobsApp.post('/:id/costs', async (c) => {
  const orgId = c.get('orgId');
  const jobId = c.req.param('id');
  const body = await c.req.json();
  const parsed = createCostSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }
  const data = parsed.data;
  const db = createDb(c.env.DATABASE_URL);
  const job = await getJobForOrg(db, orgId, jobId);
  if (!job) return c.json({ error: 'Not found' }, 404);
  
  const totalCost = data.quantity * data.unitCost;
  
  const [cost] = await db.insert(jobCosts).values({
    jobId,
    orgId,
    category: data.category,
    description: data.description,
    quantity: data.quantity.toString(),
    unitCost: data.unitCost.toString(),
    totalCost: totalCost.toString(),
    costDate: dateValue(data.costDate) || new Date(),
  }).returning();
  
  return c.json({ data: cost }, 201);
});

jobsApp.patch('/:id/costs/:costId', async (c) => {
  const orgId = c.get('orgId');
  const jobId = c.req.param('id');
  const costId = c.req.param('costId');
  const parsed = updateCostSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const db = createDb(c.env.DATABASE_URL);
  const job = await getJobForOrg(db, orgId, jobId);
  if (!job) return c.json({ error: 'Not found' }, 404);

  const existing = await db.query.jobCosts.findFirst({
    where: and(eq(jobCosts.id, costId), eq(jobCosts.jobId, jobId), eq(jobCosts.orgId, orgId)),
  });
  if (!existing) return c.json({ error: 'Cost not found' }, 404);

  const quantity = parsed.data.quantity ?? money(existing.quantity);
  const unitCost = parsed.data.unitCost ?? money(existing.unitCost);
  const [cost] = await db.update(jobCosts)
    .set({
      ...('category' in parsed.data ? { category: parsed.data.category } : {}),
      ...('description' in parsed.data ? { description: parsed.data.description } : {}),
      ...('quantity' in parsed.data ? { quantity: quantity.toString() } : {}),
      ...('unitCost' in parsed.data ? { unitCost: unitCost.toString() } : {}),
      ...('costDate' in parsed.data ? { costDate: dateValue(parsed.data.costDate) } : {}),
      totalCost: (quantity * unitCost).toString(),
    })
    .where(and(eq(jobCosts.id, costId), eq(jobCosts.jobId, jobId), eq(jobCosts.orgId, orgId)))
    .returning();

  return c.json({ data: cost });
});

jobsApp.delete('/:id/costs/:costId', async (c) => {
  const orgId = c.get('orgId');
  const jobId = c.req.param('id');
  const costId = c.req.param('costId');
  const db = createDb(c.env.DATABASE_URL);
  const job = await getJobForOrg(db, orgId, jobId);
  if (!job) return c.json({ error: 'Not found' }, 404);

  const [cost] = await db.delete(jobCosts)
    .where(and(eq(jobCosts.id, costId), eq(jobCosts.jobId, jobId), eq(jobCosts.orgId, orgId)))
    .returning();

  if (!cost) return c.json({ error: 'Cost not found' }, 404);
  return c.json({ data: { deleted: true, id: cost.id } });
});

const manualTimeSchema = z.object({
  hours: z.coerce.number().positive(),
  rate: z.coerce.number().positive(),
  date: z.string().optional(),
  description: z.string().optional(),
});

jobsApp.post('/:id/time-entries', async (c) => {
  const orgId = c.get('orgId');
  const jobId = c.req.param('id');
  const parsed = manualTimeSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const db = createDb(c.env.DATABASE_URL);
  const job = await getJobForOrg(db, orgId, jobId);
  if (!job) return c.json({ error: 'Not found' }, 404);

  const totalCost = parsed.data.hours * parsed.data.rate;
  const [cost] = await db.insert(jobCosts).values({
    jobId,
    orgId,
    category: 'labor',
    description: parsed.data.description || `Labor ${parsed.data.date || ''}`.trim(),
    quantity: parsed.data.hours.toString(),
    unitCost: parsed.data.rate.toString(),
    totalCost: totalCost.toString(),
    costDate: dateValue(parsed.data.date) || new Date(),
  }).returning();

  return c.json({ data: cost }, 201);
});

export default jobsApp;
