import { Hono } from 'hono';
import { z } from 'zod';
import { createDb } from '@paintflow/db';
import { jobs, timeEntries, expenses } from '@paintflow/db/schema';
import { eq, and, sql, desc } from 'drizzle-orm';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';

const jobsApp = new Hono<{ Bindings: Env; Variables: Variables }>();

jobsApp.use('*', authMiddleware);

jobsApp.get('/', async (c) => {
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);
  
  const results = await db
    .select()
    .from(jobs)
    .where(eq(jobs.orgId, orgId));
  
  return c.json({ data: results });
});

jobsApp.post('/', async (c) => {
  const orgId = c.get('orgId');
  const { leadId, estimateId, name, budget } = await c.req.json();
  
  const db = createDb(c.env.DATABASE_URL);
  
  const [job] = await db.insert(jobs).values({
    orgId,
    leadId,
    estimateId,
    name,
    budget,
  }).returning();
  
  return c.json({ data: job }, 201);
});

jobsApp.get('/:id/costs', async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  const db = createDb(c.env.DATABASE_URL);
  
  const [job] = await db.select().from(jobs).where(
    and(eq(jobs.id, id), eq(jobs.orgId, orgId))
  );
  
  if (!job) return c.json({ error: 'Not found' }, 404);
  
  // Get time entries
  const timeList = await db
    .select()
    .from(timeEntries)
    .where(and(eq(timeEntries.jobId, id), eq(timeEntries.orgId, orgId)))
    .orderBy(desc(timeEntries.date));
  
  // Get expenses
  const expenseList = await db
    .select()
    .from(expenses)
    .where(and(eq(expenses.jobId, id), eq(expenses.orgId, orgId)))
    .orderBy(desc(expenses.date));
  
  // Aggregate costs
  const laborCost = timeList.reduce((sum, t) => sum + Number(t.cost), 0);
  const materialCost = expenseList.reduce((sum, e) => sum + Number(e.amount), 0);
  const totalCost = laborCost + materialCost;
  const budget = Number(job.budget || 0);
  const margin = budget > 0 ? ((budget - totalCost) / budget * 100).toFixed(1) : 0;
  
  return c.json({
    data: {
      job,
      costs: {
        labor: laborCost,
        materials: materialCost,
        total: totalCost,
      },
      budget,
      margin: `${margin}%`,
      profit: budget - totalCost,
      timeEntries: timeList,
      expenses: expenseList,
    }
  });
});

// Time entries
const timeEntrySchema = z.object({
  hours: z.number().positive(),
  rate: z.number().positive(),
  description: z.string().optional(),
  date: z.string(),
});

jobsApp.post('/:id/time-entries', async (c) => {
  const orgId = c.get('orgId');
  const jobId = c.req.param('id');
  const body = await c.req.json();
  
  const parsed = timeEntrySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed' }, 400);
  }
  
  const { hours, rate, description, date } = parsed.data;
  const cost = hours * rate;
  const userId = c.get('userId') || '00000000-0000-0000-0000-000000000000';
  
  const db = createDb(c.env.DATABASE_URL);
  const [entry] = await db.insert(timeEntries).values({
    orgId,
    jobId,
    userId,
    hours: hours.toString(),
    rate: rate.toString(),
    cost: cost.toString(),
    description,
    date: new Date(date),
  }).returning();
  
  return c.json({ data: entry }, 201);
});

jobsApp.delete('/:id/time-entries/:entryId', async (c) => {
  const orgId = c.get('orgId');
  const entryId = c.req.param('entryId');
  
  const db = createDb(c.env.DATABASE_URL);
  await db.delete(timeEntries)
    .where(and(eq(timeEntries.id, entryId), eq(timeEntries.orgId, orgId)));
  
  return c.json({ success: true });
});

export default jobsApp;

// Update job
jobsApp.patch('/:id', async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  const { status, completedAt } = await c.req.json();
  
  const db = createDb(c.env.DATABASE_URL);
  const [job] = await db
    .update(jobs)
    .set({ 
      status, 
      completedAt: completedAt ? new Date(completedAt) : undefined,
      updatedAt: new Date()
    })
    .where(and(eq(jobs.id, id), eq(jobs.orgId, orgId)))
    .returning();
  
  if (!job) return c.json({ error: 'Not found' }, 404);
  
  return c.json({ data: job });
});
