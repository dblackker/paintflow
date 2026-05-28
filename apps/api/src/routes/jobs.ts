import { Hono } from 'hono';
import { z } from 'zod';
import { createDb } from '@paintflow/db';
import { changeOrders, estimateMaterials, estimates, jobCosts, jobs, leads, materialPurchases } from '@paintflow/db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';
import { estimateColorReadiness } from '../lib/color-readiness';

const jobsApp = new Hono<{ Bindings: Env; Variables: Variables }>();
jobsApp.use('*', authMiddleware);

const money = (value: unknown) => Number(value || 0);

function sumBy<T>(items: T[], pick: (item: T) => unknown) {
  return items.reduce((total, item) => total + money(pick(item)), 0);
}

function dateValue(value: unknown) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function selectedEstimatePackage(estimate: typeof estimates.$inferSelect | undefined) {
  const packages = Array.isArray(estimate?.packages) ? estimate.packages as any[] : [];
  return packages.find((pkg) => pkg.name === 'proposal') ??
    packages.find((pkg) => /better|recommended/i.test(String(pkg.name))) ??
    packages[0];
}

function estimatedMaterialsFromPackage(estimate: typeof estimates.$inferSelect | undefined) {
  const pkg = selectedEstimatePackage(estimate);
  const items = Array.isArray(pkg?.items) ? pkg.items : Array.isArray(pkg?.lineItems) ? pkg.lineItems : [];
  return items.reduce((total: number, item: any) => total + money(item?.material?.price), 0);
}

function estimatedLaborHoursFromPackage(estimate: typeof estimates.$inferSelect | undefined) {
  const pkg = selectedEstimatePackage(estimate);
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

jobsApp.get('/', async (c) => {
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);
  
  const allJobs = await db
    .select({
      id: jobs.id,
      orgId: jobs.orgId,
      leadId: jobs.leadId,
      estimateId: jobs.estimateId,
      jobNumber: jobs.jobNumber,
      name: jobs.name,
      streetAddress: jobs.streetAddress,
      city: jobs.city,
      state: jobs.state,
      postalCode: jobs.postalCode,
      status: jobs.status,
      budget: jobs.budget,
      scheduledStartAt: jobs.scheduledStartAt,
      scheduledEndAt: jobs.scheduledEndAt,
      completedAt: jobs.completedAt,
      createdAt: jobs.createdAt,
      updatedAt: jobs.updatedAt,
      leadName: leads.name,
      leadPhone: leads.phone,
      leadEmail: leads.email,
      leadStreetAddress: leads.streetAddress,
      leadCity: leads.city,
      leadState: leads.state,
      leadPostalCode: leads.postalCode,
      estimatePackages: estimates.packages,
    })
    .from(jobs)
    .leftJoin(leads, and(eq(jobs.leadId, leads.id), eq(leads.orgId, orgId)))
    .leftJoin(estimates, and(eq(jobs.estimateId, estimates.id), eq(estimates.orgId, orgId)))
    .where(eq(jobs.orgId, orgId))
    .orderBy(desc(jobs.createdAt))
    .limit(50);
  
  return c.json({
    data: allJobs.map(({ estimatePackages, ...job }) => ({
      ...job,
      estimatedLaborHours: estimatedLaborHoursFromPackage(estimatePackages ? { packages: estimatePackages } as typeof estimates.$inferSelect : undefined),
      colorReadiness: estimateColorReadiness(estimatePackages),
    })),
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
  status: z.enum(['scheduled', 'in_progress', 'completed', 'cancelled']).optional(),
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
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  const db = createDb(c.env.DATABASE_URL);
  const job = await getJobForOrg(db, orgId, id);
  if (!job) return c.json({ error: 'Not found' }, 404);

  const [lead, estimate] = await Promise.all([
    db.query.leads.findFirst({ where: and(eq(leads.id, job.leadId), eq(leads.orgId, orgId)) }),
    job.estimateId
      ? db.query.estimates.findFirst({ where: and(eq(estimates.id, job.estimateId), eq(estimates.orgId, orgId)) })
      : Promise.resolve(undefined),
  ]);

  const [costs, orders, purchases, estimatedMaterials] = await Promise.all([
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
    job.estimateId
      ? db.query.estimateMaterials.findMany({ where: eq(estimateMaterials.estimateId, job.estimateId) })
      : Promise.resolve([]),
  ]);

  const laborCosts = costs.filter((cost) => cost.category === 'labor');
  const materialCosts = costs.filter((cost) => cost.category === 'materials');
  const supplyCosts = costs.filter((cost) => cost.category === 'supplies');
  const expenseCosts = costs.filter((cost) => !['labor', 'materials', 'supplies'].includes(cost.category));
  const approvedChangeOrders = orders.filter((order) => order.status === 'approved' || order.status === 'completed');

  const contractValue = money(estimate?.total || job.budget);
  const approvedChangeOrderRevenue = sumBy(approvedChangeOrders, (order) => order.amount);
  const totalRevenue = contractValue + approvedChangeOrderRevenue;
  const laborTotal = sumBy(laborCosts, (cost) => cost.totalCost);
  const materialsTotal = sumBy(materialCosts, (cost) => cost.totalCost);
  const suppliesTotal = sumBy(supplyCosts, (cost) => cost.totalCost);
  const expensesTotal = sumBy(expenseCosts, (cost) => cost.totalCost);
  const actualCost = laborTotal + materialsTotal + suppliesTotal + expensesTotal;
  const estimatedMaterialCost = sumBy(estimatedMaterials, (material) => material.totalCost) || estimatedMaterialsFromPackage(estimate);
  const grossProfit = totalRevenue - actualCost;
  const grossMargin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;
  const costToRevenue = totalRevenue > 0 ? (actualCost / totalRevenue) * 100 : 0;
  const laborHours = sumBy(laborCosts, (cost) => cost.quantity);
  const materialVariance = estimatedMaterialCost > 0 ? materialsTotal - estimatedMaterialCost : null;

  return c.json({
    data: {
      job: {
        id: job.id,
        jobNumber: job.jobNumber,
        name: job.name,
        status: job.status,
        budget: money(job.budget),
        streetAddress: job.streetAddress,
        city: job.city,
        state: job.state,
        postalCode: job.postalCode,
        scheduledStartAt: job.scheduledStartAt,
        scheduledEndAt: job.scheduledEndAt,
        completedAt: job.completedAt,
        estimateId: job.estimateId,
        leadId: job.leadId,
        leadName: lead?.name,
        leadEmail: lead?.email,
        leadPhone: lead?.phone,
        leadStreetAddress: lead?.streetAddress,
        leadCity: lead?.city,
        leadState: lead?.state,
        leadPostalCode: lead?.postalCode,
        colorReadiness: estimateColorReadiness(estimate?.packages),
      },
      revenue: {
        contract: contractValue,
        approvedChangeOrders: approvedChangeOrderRevenue,
        total: totalRevenue,
      },
      costs: {
        labor: laborTotal,
        materials: materialsTotal,
        supplies: suppliesTotal,
        expenses: expensesTotal,
        total: actualCost,
      },
      production: {
        laborHours,
        averageLaborRate: laborHours > 0 ? laborTotal / laborHours : 0,
      },
      budget: {
        estimatedMaterials: estimatedMaterialCost || null,
        materialVariance,
        remainingGrossProfit: grossProfit,
      },
      profitability: {
        grossProfit,
        grossMargin,
        costToRevenue,
      },
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
