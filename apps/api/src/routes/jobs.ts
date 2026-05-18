import { Hono } from 'hono';
import { z } from 'zod';
import { createDb } from '@paintflow/db';
import { jobs, jobCosts } from '@paintflow/db/schema';
import { eq, and } from 'drizzle-orm';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';

const jobsApp = new Hono<{ Bindings: Env; Variables: Variables }>();
jobsApp.use('*', authMiddleware);

jobsApp.get('/', async (c) => {
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);
  
  const allJobs = await db.query.jobs.findMany({
    where: eq(jobs.orgId, orgId),
    orderBy: (jobs, { desc }) => [desc(jobs.createdAt)],
    limit: 50,
  });
  
  return c.json({ data: allJobs });
});

jobsApp.get('/:id', async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  const db = createDb(c.env.DATABASE_URL);
  
  const job = await db.query.jobs.findFirst({
    where: and(eq(jobs.id, id), eq(jobs.orgId, orgId)),
  });
  
  if (!job) return c.json({ error: 'Not found' }, 404);
  return c.json({ data: job });
});

jobsApp.get('/:id/costs', async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  const db = createDb(c.env.DATABASE_URL);
  
  const costs = await db.query.jobCosts.findMany({
    where: and(eq(jobCosts.jobId, id), eq(jobCosts.orgId, orgId)),
    orderBy: (jobCosts, { desc }) => [desc(jobCosts.createdAt)],
  });
  
  return c.json({ data: costs });
});

const createCostSchema = z.object({
  category: z.enum(['labor', 'materials', 'supplies']),
  description: z.string().min(1),
  quantity: z.number().positive(),
  unitCost: z.number().positive(),
});

jobsApp.post('/:id/costs', async (c) => {
  const orgId = c.get('orgId');
  const jobId = c.req.param('id');
  const body = await c.req.json();
  const data = createCostSchema.parse(body);
  const db = createDb(c.env.DATABASE_URL);
  
  const totalCost = data.quantity * data.unitCost;
  
  const [cost] = await db.insert(jobCosts).values({
    jobId,
    orgId,
    category: data.category,
    description: data.description,
    quantity: data.quantity.toString(),
    unitCost: data.unitCost.toString(),
    totalCost: totalCost.toString(),
  }).returning();
  
  return c.json({ data: cost }, 201);
});

export default jobsApp;
