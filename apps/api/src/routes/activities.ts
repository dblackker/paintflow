import { Hono } from 'hono';
import { z } from 'zod';
import { createDb } from '@paintflow/db';
import { activities, estimates, jobs, leads } from '@paintflow/db/schema';
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
