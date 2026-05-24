import { Hono } from 'hono';
import { z } from 'zod';
import { createDb } from '@paintflow/db';
import { activities, auditLogs, customerPayments, emailSends, estimatePhotos, estimates, jobPhotos, jobs, leads, messages, quickbooksConnections } from '@paintflow/db/schema';
import { and, desc, eq, ilike, inArray, or } from 'drizzle-orm';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';
import { createQBCustomer } from '../lib/quickbooks';
import { formatPhoneNumber } from '../lib/twilio';

const leadsApp = new Hono<{ Bindings: Env; Variables: Variables }>();

// All routes require auth
leadsApp.use('*', authMiddleware);

const leadStatusSchema = z.enum(['new', 'contacted', 'estimate_sent', 'won', 'lost']);

const leadBaseSchema = z.object({
  name: z.string().trim().min(1).max(255),
  phone: z.string().trim().max(50).optional(),
  email: z.preprocess(
    (value) => typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.string().trim().email().max(255).optional()
  ),
  streetAddress: z.string().trim().max(255).optional(),
  city: z.string().trim().max(100).optional(),
  state: z.string().trim().max(50).optional(),
  postalCode: z.string().trim().max(20).optional(),
  source: z.string().trim().max(100).optional(),
  status: leadStatusSchema.optional(),
});

const leadInputSchema = leadBaseSchema.refine((value) => value.phone || value.email, {
  message: 'A phone number or email is required',
  path: ['phone'],
});

const updateLeadSchema = leadBaseSchema.partial().extend({
  status: leadStatusSchema.optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: 'At least one field is required',
});

function normalizePhone(phone?: string) {
  if (!phone) return undefined;
  try {
    return formatPhoneNumber(phone);
  } catch {
    return phone.replace(/[^\d+]/g, '');
  }
}

function publicEstimateUrl(baseUrl: string, id: string) {
  return `${baseUrl.replace(/\/$/, '')}/estimates/${id}`;
}

function isMissingRelation(error: unknown) {
  const err = error as { code?: string; message?: string };
  return err?.code === '42P01' || /relation .* does not exist/i.test(err?.message || '');
}

async function optionalRows<T>(query: Promise<T[]>, label: string) {
  try {
    return await query;
  } catch (error) {
    if (isMissingRelation(error)) {
      console.warn(`${label} unavailable; run the latest database migration.`);
      return [];
    }
    throw error;
  }
}

leadsApp.get('/', async (c) => {
  const orgId = c.get('orgId');
  const status = c.req.query('status');
  const source = c.req.query('source');
  const q = c.req.query('q');
  const db = createDb(c.env.DATABASE_URL);

  const filters = [eq(leads.orgId, orgId)];
  if (status && status !== 'all' && leadStatusSchema.safeParse(status).success) {
    filters.push(eq(leads.status, status as typeof leads.$inferSelect.status));
  }
  if (source && source !== 'all') {
    filters.push(eq(leads.source, source));
  }
  if (q) {
    filters.push(or(
      ilike(leads.name, `%${q}%`),
      ilike(leads.email, `%${q}%`),
      ilike(leads.phone, `%${q}%`),
      ilike(leads.streetAddress, `%${q}%`),
      ilike(leads.city, `%${q}%`),
      ilike(leads.postalCode, `%${q}%`)
    )!);
  }
  
  const results = await db
    .select()
    .from(leads)
    .where(and(...filters))
    .orderBy(desc(leads.createdAt))
    .limit(Math.min(Number(c.req.query('limit') || 100), 200));
  
  return c.json({
    data: results,
    meta: { total: results.length }
  });
});

leadsApp.post('/', async (c) => {
  const orgId = c.get('orgId');
  const body = await c.req.json();
  const parsed = leadInputSchema.safeParse(body);
  
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error }, 400);
  }
  
  const db = createDb(c.env.DATABASE_URL);
  const phone = normalizePhone(parsed.data.phone);
  
  const [lead] = await db.insert(leads).values({
    orgId,
    name: parsed.data.name,
    phone,
    email: parsed.data.email,
    streetAddress: parsed.data.streetAddress,
    city: parsed.data.city,
    state: parsed.data.state,
    postalCode: parsed.data.postalCode,
    source: parsed.data.source,
    status: parsed.data.status ?? 'new',
  }).returning();
  
  // Auto-sync to QuickBooks if connected
  const qbConnection = await db.query.quickbooksConnections.findFirst({
    where: eq(quickbooksConnections.orgId, orgId),
  });
  
  if (qbConnection) {
    try {
      await createQBCustomer(c.env, orgId, lead);
      console.log(`Auto-synced lead ${lead.id} to QuickBooks`);
    } catch (qbErr) {
      console.error('QB auto-sync failed:', qbErr);
      // Don't fail lead creation if QB sync fails
    }
  }
  
  return c.json({ data: lead }, 201);
});

leadsApp.get('/:id', async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  const db = createDb(c.env.DATABASE_URL);
  const baseUrl = c.env.PUBLIC_URL || 'https://app.paintflow.app';

  const customer = await db.query.leads.findFirst({
    where: and(eq(leads.id, id), eq(leads.orgId, orgId)),
  });

  if (!customer) {
    return c.json({ error: 'Lead not found' }, 404);
  }

  const [customerEstimates, customerJobs, customerMessages, customerEmailSends, customerPaymentsRows, customerActivity, customerActivities] = await Promise.all([
    db.select().from(estimates)
      .where(and(eq(estimates.orgId, orgId), eq(estimates.leadId, id)))
      .orderBy(desc(estimates.createdAt)),
    db.select().from(jobs)
      .where(and(eq(jobs.orgId, orgId), eq(jobs.leadId, id)))
      .orderBy(desc(jobs.createdAt)),
    db.select().from(messages)
      .where(and(eq(messages.orgId, orgId), eq(messages.leadId, id)))
      .orderBy(desc(messages.createdAt))
      .limit(50),
    optionalRows(db.select().from(emailSends)
      .where(and(eq(emailSends.orgId, orgId), eq(emailSends.leadId, id)))
      .orderBy(desc(emailSends.sentAt))
      .limit(50), 'Email send history'),
    optionalRows(db.select().from(customerPayments)
      .where(and(eq(customerPayments.orgId, orgId), eq(customerPayments.leadId, id)))
      .orderBy(desc(customerPayments.receivedAt))
      .limit(100), 'Payment history'),
    db.select().from(auditLogs)
      .where(and(eq(auditLogs.orgId, orgId), eq(auditLogs.entityType, 'lead'), eq(auditLogs.entityId, id)))
      .orderBy(desc(auditLogs.createdAt))
      .limit(50),
    db.select().from(activities)
      .where(and(eq(activities.orgId, orgId), eq(activities.leadId, id)))
      .orderBy(desc(activities.createdAt))
      .limit(100),
  ]);

  const estimateIds = customerEstimates.map((estimate) => estimate.id);
  const jobIds = customerJobs.map((job) => job.id);

  const [photosForEstimates, photosForJobs, estimateViewRows] = await Promise.all([
    estimateIds.length
      ? db.select().from(estimatePhotos)
        .where(inArray(estimatePhotos.estimateId, estimateIds))
        .orderBy(desc(estimatePhotos.createdAt))
      : Promise.resolve([]),
    jobIds.length
      ? db.select().from(jobPhotos)
        .where(and(eq(jobPhotos.orgId, orgId), inArray(jobPhotos.jobId, jobIds)))
        .orderBy(desc(jobPhotos.createdAt))
      : Promise.resolve([]),
    estimateIds.length
      ? db.select().from(auditLogs)
        .where(and(
          eq(auditLogs.orgId, orgId),
          eq(auditLogs.entityType, 'estimate'),
          eq(auditLogs.action, 'estimate.client_viewed'),
          inArray(auditLogs.entityId, estimateIds),
        ))
        .orderBy(desc(auditLogs.createdAt))
      : Promise.resolve([]),
  ]);

  const estimateViewsById = estimateViewRows.reduce((acc, row) => {
    const current = acc.get(row.entityId) || { clientViewedAt: null as Date | null, clientViewCount: 0 };
    acc.set(row.entityId, {
      clientViewedAt: current.clientViewedAt || row.createdAt,
      clientViewCount: current.clientViewCount + 1,
    });
    return acc;
  }, new Map<string, { clientViewedAt: Date | null; clientViewCount: number }>());

  return c.json({
    data: {
      customer,
      estimates: customerEstimates.map((estimate) => ({
        ...estimate,
        ...(estimateViewsById.get(estimate.id) || { clientViewedAt: null, clientViewCount: 0 }),
        publicUrl: publicEstimateUrl(baseUrl, estimate.id),
        customerPreviewUrl: publicEstimateUrl(baseUrl, estimate.id),
      })),
      jobs: customerJobs,
      messages: customerMessages,
      emailSends: customerEmailSends,
      payments: customerPaymentsRows,
      activity: customerActivity,
      activities: customerActivities,
      photos: {
        estimates: photosForEstimates,
        jobs: photosForJobs,
      },
    },
  });
});

leadsApp.patch('/:id', async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  const body = await c.req.json();
  const parsed = updateLeadSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const patch: Record<string, unknown> = { ...parsed.data, updatedAt: new Date() };
  if (parsed.data.phone !== undefined) {
    patch.phone = normalizePhone(parsed.data.phone);
  }

  const db = createDb(c.env.DATABASE_URL);
  const [lead] = await db.update(leads)
    .set(patch)
    .where(and(eq(leads.id, id), eq(leads.orgId, orgId)))
    .returning();

  if (!lead) {
    return c.json({ error: 'Lead not found' }, 404);
  }

  return c.json({ data: lead });
});

export default leadsApp;
