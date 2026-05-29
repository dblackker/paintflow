import { Hono } from 'hono';
import { z } from 'zod';
import { createDb } from '@crewmodo/db';
import { activities, estimates, jobs, leads, messages } from '@crewmodo/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';

const activitiesApp = new Hono<{ Bindings: Env; Variables: Variables }>();
activitiesApp.use('*', authMiddleware);

const activityTypes = ['call', 'text', 'email', 'site_visit', 'follow_up', 'task', 'note', 'schedule', 'production', 'payment', 'review'] as const;
const activityStatuses = ['open', 'done', 'skipped'] as const;

const createActivitySchema = z.object({
  leadId: z.string().uuid().optional().nullable(),
  estimateId: z.string().uuid().optional().nullable(),
  jobId: z.string().uuid().optional().nullable(),
  type: z.enum(activityTypes).default('task'),
  title: z.string().trim().min(1).max(255),
  notes: z.string().trim().max(5000).optional().nullable(),
  status: z.enum(activityStatuses).default('open'),
  dueAt: z.string().datetime().optional().nullable(),
  metadata: z.record(z.unknown()).optional().nullable(),
});

const updateActivitySchema = createActivitySchema.partial().extend({
  completedAt: z.string().datetime().optional().nullable(),
});

async function verifyRelatedRecord(db: ReturnType<typeof createDb>, orgId: string, data: { leadId?: string | null; estimateId?: string | null; jobId?: string | null }) {
  const checks = await Promise.all([
    data.leadId ? db.query.leads.findFirst({ where: and(eq(leads.id, data.leadId), eq(leads.orgId, orgId)) }) : Promise.resolve(true),
    data.estimateId ? db.query.estimates.findFirst({ where: and(eq(estimates.id, data.estimateId), eq(estimates.orgId, orgId)) }) : Promise.resolve(true),
    data.jobId ? db.query.jobs.findFirst({ where: and(eq(jobs.id, data.jobId), eq(jobs.orgId, orgId)) }) : Promise.resolve(true),
  ]);
  return checks.every(Boolean);
}

function toDate(value?: string | null) {
  return value ? new Date(value) : null;
}

type FeedEvent = {
  id: string;
  source: 'activity' | 'lead' | 'estimate' | 'job' | 'message';
  type: string;
  title: string;
  body?: string | null;
  status?: string | null;
  occurredAt: Date;
  href: string;
  leadId?: string | null;
  estimateId?: string | null;
  jobId?: string | null;
  clientName?: string | null;
  leadPhone?: string | null;
  leadEmail?: string | null;
  leadStreetAddress?: string | null;
  leadCity?: string | null;
  leadState?: string | null;
  leadPostalCode?: string | null;
};

function money(value: unknown) {
  return Number(value || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function estimateTitle(status: string, clientName?: string | null, total?: unknown) {
  const name = clientName || 'customer';
  const amount = Number(total || 0) > 0 ? ` - ${money(total)}` : '';
  if (status === 'accepted') return `Estimate accepted for ${name}${amount}`;
  if (status === 'declined') return `Estimate declined for ${name}${amount}`;
  if (status === 'sent') return `Estimate sent to ${name}${amount}`;
  if (status === 'superseded') return `Estimate agreement superseded for ${name}${amount}`;
  if (status === 'voided') return `Estimate agreement voided for ${name}${amount}`;
  if (status === 'draft') return `Draft estimate created for ${name}`;
  return `Estimate updated for ${name}${amount}`;
}

function estimateOccurredAt(status: string, createdAt: Date, sentAt?: Date | null, signedAt?: Date | null) {
  if (status === 'accepted' && signedAt) return signedAt;
  if (['sent', 'declined', 'superseded', 'voided'].includes(status) && sentAt) return sentAt;
  return createdAt;
}

function matchesFeedFilters(event: FeedEvent, filters: { cursor?: string; q?: string; type?: string; status?: string }) {
  if (filters.cursor && event.occurredAt.getTime() >= new Date(filters.cursor).getTime()) return false;
  if (filters.type && filters.type !== 'all' && event.source !== filters.type && event.type !== filters.type) return false;
  if (filters.status && filters.status !== 'all' && event.status !== filters.status) return false;
  if (filters.q) {
    const haystack = [
      event.title,
      event.body,
      event.clientName,
      event.leadPhone,
      event.leadEmail,
      event.leadStreetAddress,
      event.leadCity,
      event.leadState,
      event.leadPostalCode,
    ].filter(Boolean).join(' ').toLowerCase();
    if (!haystack.includes(filters.q.toLowerCase())) return false;
  }
  return true;
}

activitiesApp.get('/feed', async (c) => {
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);
  const limit = Math.min(Math.max(Number(c.req.query('limit') || 25), 1), 50);
  const filters = {
    cursor: c.req.query('cursor'),
    q: c.req.query('q')?.trim(),
    type: c.req.query('type'),
    status: c.req.query('status'),
  };
  const fetchLimit = Math.max(limit * 4, 100);

  const [activityRows, leadRows, estimateRows, jobRows, messageRows] = await Promise.all([
    db.select({
      id: activities.id,
      leadId: activities.leadId,
      estimateId: activities.estimateId,
      jobId: activities.jobId,
      type: activities.type,
      title: activities.title,
      notes: activities.notes,
      status: activities.status,
      createdAt: activities.createdAt,
      updatedAt: activities.updatedAt,
      clientName: leads.name,
      leadPhone: leads.phone,
      leadEmail: leads.email,
      leadStreetAddress: leads.streetAddress,
      leadCity: leads.city,
      leadState: leads.state,
      leadPostalCode: leads.postalCode,
    })
      .from(activities)
      .leftJoin(leads, and(eq(activities.leadId, leads.id), eq(leads.orgId, orgId)))
      .where(eq(activities.orgId, orgId))
      .orderBy(desc(activities.createdAt))
      .limit(fetchLimit),
    db.select({
      id: leads.id,
      status: leads.status,
      createdAt: leads.createdAt,
      clientName: leads.name,
      leadPhone: leads.phone,
      leadEmail: leads.email,
      leadStreetAddress: leads.streetAddress,
      leadCity: leads.city,
      leadState: leads.state,
      leadPostalCode: leads.postalCode,
    })
      .from(leads)
      .where(eq(leads.orgId, orgId))
      .orderBy(desc(leads.createdAt))
      .limit(fetchLimit),
    db.select({
      id: estimates.id,
      leadId: estimates.leadId,
      status: estimates.status,
      total: estimates.total,
      createdAt: estimates.createdAt,
      sentAt: estimates.sentAt,
      signedAt: estimates.signedAt,
      clientName: leads.name,
      leadPhone: leads.phone,
      leadEmail: leads.email,
      leadStreetAddress: leads.streetAddress,
      leadCity: leads.city,
      leadState: leads.state,
      leadPostalCode: leads.postalCode,
    })
      .from(estimates)
      .leftJoin(leads, and(eq(estimates.leadId, leads.id), eq(leads.orgId, orgId)))
      .where(eq(estimates.orgId, orgId))
      .orderBy(desc(estimates.createdAt))
      .limit(fetchLimit),
    db.select({
      id: jobs.id,
      leadId: jobs.leadId,
      estimateId: jobs.estimateId,
      name: jobs.name,
      status: jobs.status,
      budget: jobs.budget,
      createdAt: jobs.createdAt,
      updatedAt: jobs.updatedAt,
      completedAt: jobs.completedAt,
      clientName: leads.name,
      leadPhone: leads.phone,
      leadEmail: leads.email,
      leadStreetAddress: leads.streetAddress,
      leadCity: leads.city,
      leadState: leads.state,
      leadPostalCode: leads.postalCode,
    })
      .from(jobs)
      .leftJoin(leads, and(eq(jobs.leadId, leads.id), eq(leads.orgId, orgId)))
      .where(eq(jobs.orgId, orgId))
      .orderBy(desc(jobs.createdAt))
      .limit(fetchLimit),
    db.select({
      id: messages.id,
      leadId: messages.leadId,
      direction: messages.direction,
      body: messages.body,
      read: messages.read,
      createdAt: messages.createdAt,
      clientName: leads.name,
      leadPhone: leads.phone,
      leadEmail: leads.email,
      leadStreetAddress: leads.streetAddress,
      leadCity: leads.city,
      leadState: leads.state,
      leadPostalCode: leads.postalCode,
    })
      .from(messages)
      .leftJoin(leads, and(eq(messages.leadId, leads.id), eq(leads.orgId, orgId)))
      .where(eq(messages.orgId, orgId))
      .orderBy(desc(messages.createdAt))
      .limit(fetchLimit),
  ]);

  const events: FeedEvent[] = [
    ...activityRows.map((row): FeedEvent => ({
      id: `activity:${row.id}`,
      source: 'activity',
      type: row.type,
      title: row.title,
      body: row.notes,
      status: row.status,
      occurredAt: row.createdAt,
      href: row.jobId ? `/jobs/${row.jobId}` : row.estimateId ? `/estimates/${row.estimateId}` : row.leadId ? `/leads/${row.leadId}` : '/activity',
      leadId: row.leadId,
      estimateId: row.estimateId,
      jobId: row.jobId,
      clientName: row.clientName,
      leadPhone: row.leadPhone,
      leadEmail: row.leadEmail,
      leadStreetAddress: row.leadStreetAddress,
      leadCity: row.leadCity,
      leadState: row.leadState,
      leadPostalCode: row.leadPostalCode,
    })),
    ...leadRows.map((row): FeedEvent => ({
      id: `lead:${row.id}`,
      source: 'lead',
      type: 'lead_created',
      title: `Lead created for ${row.clientName}`,
      status: row.status,
      occurredAt: row.createdAt,
      href: `/leads/${row.id}`,
      leadId: row.id,
      clientName: row.clientName,
      leadPhone: row.leadPhone,
      leadEmail: row.leadEmail,
      leadStreetAddress: row.leadStreetAddress,
      leadCity: row.leadCity,
      leadState: row.leadState,
      leadPostalCode: row.leadPostalCode,
    })),
    ...estimateRows.map((row): FeedEvent => ({
      id: `estimate:${row.id}:${row.status}`,
      source: 'estimate',
      type: `estimate_${row.status}`,
      title: estimateTitle(row.status, row.clientName, row.total),
      status: row.status,
      occurredAt: estimateOccurredAt(row.status, row.createdAt, row.sentAt, row.signedAt),
      href: `/estimates/${row.id}`,
      leadId: row.leadId,
      estimateId: row.id,
      clientName: row.clientName,
      leadPhone: row.leadPhone,
      leadEmail: row.leadEmail,
      leadStreetAddress: row.leadStreetAddress,
      leadCity: row.leadCity,
      leadState: row.leadState,
      leadPostalCode: row.leadPostalCode,
    })),
    ...jobRows.map((row): FeedEvent => ({
      id: `job:${row.id}:${row.status}`,
      source: 'job',
      type: row.status === 'completed' ? 'job_completed' : 'job_created',
      title: row.status === 'completed'
        ? `Job completed: ${row.name}`
        : `Job scheduled: ${row.name}`,
      status: row.status,
      occurredAt: row.status === 'completed' && row.completedAt ? row.completedAt : row.createdAt,
      href: `/jobs/${row.id}`,
      leadId: row.leadId,
      estimateId: row.estimateId,
      jobId: row.id,
      clientName: row.clientName,
      leadPhone: row.leadPhone,
      leadEmail: row.leadEmail,
      leadStreetAddress: row.leadStreetAddress,
      leadCity: row.leadCity,
      leadState: row.leadState,
      leadPostalCode: row.leadPostalCode,
    })),
    ...messageRows.map((row): FeedEvent => ({
      id: `message:${row.id}`,
      source: 'message',
      type: row.direction === 'inbound' ? 'message_received' : 'message_sent',
      title: row.direction === 'inbound'
        ? `Message received from ${row.clientName || 'customer'}`
        : `Message sent to ${row.clientName || 'customer'}`,
      body: row.body,
      status: row.direction === 'inbound' && !row.read ? 'unread' : 'read',
      occurredAt: row.createdAt,
      href: row.leadId ? `/sms?leadId=${row.leadId}` : '/sms',
      leadId: row.leadId,
      clientName: row.clientName,
      leadPhone: row.leadPhone,
      leadEmail: row.leadEmail,
      leadStreetAddress: row.leadStreetAddress,
      leadCity: row.leadCity,
      leadState: row.leadState,
      leadPostalCode: row.leadPostalCode,
    })),
  ]
    .filter((event) => matchesFeedFilters(event, filters))
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());

  const page = events.slice(0, limit);
  const nextCursor = events.length > limit ? page[page.length - 1]?.occurredAt.toISOString() : null;

  return c.json({
    data: page.map((event) => ({ ...event, occurredAt: event.occurredAt.toISOString() })),
    nextCursor,
  });
});

activitiesApp.get('/', async (c) => {
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);
  const leadId = c.req.query('leadId');
  const estimateId = c.req.query('estimateId');
  const jobId = c.req.query('jobId');
  const status = c.req.query('status');
  const limit = Math.min(Math.max(Number(c.req.query('limit') || 100), 1), 250);

  const filters = [eq(activities.orgId, orgId)];
  if (leadId) filters.push(eq(activities.leadId, leadId));
  if (estimateId) filters.push(eq(activities.estimateId, estimateId));
  if (jobId) filters.push(eq(activities.jobId, jobId));
  if (status) filters.push(eq(activities.status, status));

  const data = await db.select({
    id: activities.id,
    orgId: activities.orgId,
    leadId: activities.leadId,
    estimateId: activities.estimateId,
    jobId: activities.jobId,
    userId: activities.userId,
    type: activities.type,
    title: activities.title,
    notes: activities.notes,
    status: activities.status,
    dueAt: activities.dueAt,
    completedAt: activities.completedAt,
    metadata: activities.metadata,
    createdAt: activities.createdAt,
    updatedAt: activities.updatedAt,
    leadName: leads.name,
    jobName: jobs.name,
  })
    .from(activities)
    .leftJoin(leads, and(eq(activities.leadId, leads.id), eq(leads.orgId, orgId)))
    .leftJoin(jobs, and(eq(activities.jobId, jobs.id), eq(jobs.orgId, orgId)))
    .where(and(...filters))
    .orderBy(desc(activities.createdAt))
    .limit(limit);

  return c.json({ data });
});

activitiesApp.post('/', async (c) => {
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const parsed = createActivitySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }
  if (!parsed.data.leadId && !parsed.data.estimateId && !parsed.data.jobId) {
    return c.json({ error: 'Attach the activity to a customer, estimate, or job.' }, 400);
  }

  const db = createDb(c.env.DATABASE_URL);
  if (!(await verifyRelatedRecord(db, orgId, parsed.data))) {
    return c.json({ error: 'Related record not found' }, 404);
  }

  const completedAt = parsed.data.status === 'done' ? new Date() : null;
  const [activity] = await db.insert(activities).values({
    orgId,
    userId,
    leadId: parsed.data.leadId || null,
    estimateId: parsed.data.estimateId || null,
    jobId: parsed.data.jobId || null,
    type: parsed.data.type,
    title: parsed.data.title,
    notes: parsed.data.notes || null,
    status: parsed.data.status,
    dueAt: toDate(parsed.data.dueAt),
    completedAt,
    metadata: parsed.data.metadata || null,
  }).returning();

  return c.json({ data: activity }, 201);
});

activitiesApp.patch('/:id', async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  const parsed = updateActivitySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const db = createDb(c.env.DATABASE_URL);
  const existing = await db.query.activities.findFirst({ where: and(eq(activities.id, id), eq(activities.orgId, orgId)) });
  if (!existing) return c.json({ error: 'Not found' }, 404);
  if (!(await verifyRelatedRecord(db, orgId, parsed.data))) {
    return c.json({ error: 'Related record not found' }, 404);
  }

  const statusCompletedAt = parsed.data.status === 'done' && !existing.completedAt ? new Date() : existing.completedAt;
  const [activity] = await db.update(activities)
    .set({
      ...('leadId' in parsed.data ? { leadId: parsed.data.leadId || null } : {}),
      ...('estimateId' in parsed.data ? { estimateId: parsed.data.estimateId || null } : {}),
      ...('jobId' in parsed.data ? { jobId: parsed.data.jobId || null } : {}),
      ...('type' in parsed.data ? { type: parsed.data.type } : {}),
      ...('title' in parsed.data ? { title: parsed.data.title } : {}),
      ...('notes' in parsed.data ? { notes: parsed.data.notes || null } : {}),
      ...('status' in parsed.data ? { status: parsed.data.status } : {}),
      ...('dueAt' in parsed.data ? { dueAt: toDate(parsed.data.dueAt) } : {}),
      ...('completedAt' in parsed.data ? { completedAt: toDate(parsed.data.completedAt) } : { completedAt: statusCompletedAt }),
      ...('metadata' in parsed.data ? { metadata: parsed.data.metadata || null } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(activities.id, id), eq(activities.orgId, orgId)))
    .returning();

  return c.json({ data: activity });
});

activitiesApp.delete('/:id', async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  const db = createDb(c.env.DATABASE_URL);
  const [activity] = await db.delete(activities)
    .where(and(eq(activities.id, id), eq(activities.orgId, orgId)))
    .returning();
  if (!activity) return c.json({ error: 'Not found' }, 404);
  return c.json({ data: { deleted: true } });
});

export default activitiesApp;
