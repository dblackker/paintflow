import { Hono } from 'hono';
import { createDb } from '@paintflow/db';
import { auditLogs, changeOrders, jobs, leads, portalTokens } from '@paintflow/db/schema';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';
import { eq, and, desc } from 'drizzle-orm';
import { z } from 'zod';

const changeOrdersRoute = new Hono<{ Bindings: Env; Variables: Variables }>();
changeOrdersRoute.use('*', authMiddleware);

const changeOrderSchema = z.object({
  jobId: z.string().uuid(),
  estimateId: z.string().uuid(),
  description: z.string().trim().min(1).max(2000),
  amount: z.coerce.number().positive(),
  status: z.enum(['pending', 'approved', 'rejected', 'completed']).default('pending'),
  createdBy: z.enum(['contractor', 'customer']).default('contractor'),
  paymentRequired: z.coerce.boolean().default(false),
  depositPercent: z.coerce.number().min(0).max(100).default(100),
});

const updateChangeOrderSchema = z.object({
  description: z.string().trim().min(1).max(2000).optional(),
  amount: z.coerce.number().positive().optional(),
  status: z.enum(['pending', 'approved', 'rejected', 'completed']).optional(),
  createdBy: z.enum(['contractor', 'customer']).optional(),
  paymentRequired: z.coerce.boolean().optional(),
  depositPercent: z.coerce.number().min(0).max(100).optional(),
  paymentStatus: z.enum(['not_requested', 'pending', 'paid', 'waived']).optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: 'At least one field is required',
});

function paymentDueAmount(amount: number, paymentRequired: boolean, depositPercent: number) {
  return paymentRequired ? Math.round(amount * (depositPercent / 100) * 100) / 100 : null;
}

function portalToken() {
  const tokenBytes = new Uint8Array(32);
  crypto.getRandomValues(tokenBytes);
  return Array.from(tokenBytes, b => b.toString(16).padStart(2, '0')).join('');
}

// GET /v1/change-orders?jobId=xxx
changeOrdersRoute.get('/', async (c) => {
  const orgId = c.get('orgId');
  const jobId = c.req.query('jobId');
  const db = createDb(c.env.DATABASE_URL);
  
  const where = jobId
    ? and(eq(changeOrders.orgId, orgId), eq(changeOrders.jobId, jobId))
    : eq(changeOrders.orgId, orgId);
  
  const data = await db.select().from(changeOrders).where(where).orderBy(desc(changeOrders.createdAt));
  return c.json({ data });
});

// POST /v1/change-orders
changeOrdersRoute.post('/', async (c) => {
  const orgId = c.get('orgId');
  const body = await c.req.json();
  const parsed = changeOrderSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }
  const data = parsed.data;
  const db = createDb(c.env.DATABASE_URL);

  const job = await db.query.jobs.findFirst({
    where: and(eq(jobs.id, data.jobId), eq(jobs.orgId, orgId)),
  });
  if (!job || job.estimateId !== data.estimateId) {
    return c.json({ error: 'Job not found for estimate' }, 404);
  }

  const [order] = await db.insert(changeOrders).values({
    jobId: data.jobId,
    estimateId: data.estimateId,
    description: data.description,
    status: data.status,
    createdBy: data.createdBy,
    paymentRequired: data.paymentRequired,
    orgId,
    amount: data.amount.toFixed(2),
    depositPercent: data.depositPercent.toFixed(2),
    paymentDueAmount: paymentDueAmount(data.amount, data.paymentRequired, data.depositPercent)?.toFixed(2) ?? null,
    paymentStatus: data.paymentRequired ? 'pending' : 'not_requested',
    approvedAt: data.status === 'approved' ? new Date() : undefined,
  }).returning();
  return c.json({ data: order });
});

changeOrdersRoute.post('/:id/portal-link', async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  const db = createDb(c.env.DATABASE_URL);

  const order = await db.query.changeOrders.findFirst({
    where: and(eq(changeOrders.id, id), eq(changeOrders.orgId, orgId)),
  });
  if (!order) return c.json({ error: 'Not found' }, 404);

  const job = await db.query.jobs.findFirst({
    where: and(eq(jobs.id, order.jobId), eq(jobs.orgId, orgId)),
  });
  if (!job) return c.json({ error: 'Job not found' }, 404);

  const lead = await db.query.leads.findFirst({
    where: and(eq(leads.id, job.leadId), eq(leads.orgId, orgId)),
  });
  if (!lead) return c.json({ error: 'Customer not found' }, 404);

  const token = portalToken();
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  await db.insert(portalTokens).values({ leadId: lead.id, orgId, token, expiresAt });

  const [updated] = await db.update(changeOrders)
    .set({ sentAt: new Date() })
    .where(and(eq(changeOrders.id, id), eq(changeOrders.orgId, orgId)))
    .returning();

  await db.insert(auditLogs).values({
    orgId,
    userId: c.get('userId'),
    action: 'change_order.portal_link.created',
    entityType: 'change_order',
    entityId: id,
    metadata: {
      jobId: job.id,
      leadId: lead.id,
      expiresAt: expiresAt.toISOString(),
    },
  });

  const baseUrl = c.env.PUBLIC_URL || 'https://paintflow.app';
  return c.json({ data: { link: `${baseUrl}/portal/${token}`, token, expiresAt, changeOrder: updated } });
});

// PATCH /v1/change-orders/:id
changeOrdersRoute.patch('/:id', async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  const body = await c.req.json();
  const parsed = updateChangeOrderSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }
  const data = parsed.data;
  const db = createDb(c.env.DATABASE_URL);

  const existing = await db.query.changeOrders.findFirst({
    where: and(eq(changeOrders.id, id), eq(changeOrders.orgId, orgId)),
  });
  if (!existing) return c.json({ error: 'Not found' }, 404);
  
  const nextAmount = data.amount ?? Number(existing.amount);
  const nextPaymentRequired = data.paymentRequired ?? Boolean(existing.paymentRequired);
  const nextDepositPercent = data.depositPercent ?? Number(existing.depositPercent || 100);
  const update: Record<string, unknown> = {
    ...data,
    amount: data.amount == null ? undefined : data.amount.toFixed(2),
    depositPercent: data.depositPercent == null ? undefined : data.depositPercent.toFixed(2),
    paymentDueAmount: paymentDueAmount(nextAmount, nextPaymentRequired, nextDepositPercent)?.toFixed(2) ?? null,
  };

  if (data.paymentRequired !== undefined || data.depositPercent !== undefined || data.amount !== undefined) {
    update.paymentStatus = nextPaymentRequired ? (existing.paymentStatus === 'paid' ? 'paid' : 'pending') : 'not_requested';
  }

  if (data.status === 'approved' && !existing.approvedAt) {
    update.approvedAt = new Date();
    update.approvedBy = 'contractor';
  }
  
  const [order] = await db.update(changeOrders)
    .set(update)
    .where(and(eq(changeOrders.id, id), eq(changeOrders.orgId, orgId)))
    .returning();
  
  return c.json({ data: order });
});

export default changeOrdersRoute;
