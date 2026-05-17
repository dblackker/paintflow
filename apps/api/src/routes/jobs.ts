import { Hono } from 'hono';
import { z } from 'zod';
import { createDb } from '@paintflow/db';
import { jobs, timeEntries, expenses } from '@paintflow/db/schema';
import { eq, and, sql } from 'drizzle-orm';
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
  
  // Aggregate costs
  const timeResult = await db
    .select({ total: sql<number>`SUM(cost)` })
    .from(timeEntries)
    .where(and(eq(timeEntries.jobId, id), eq(timeEntries.orgId, orgId)));
  
  const expenseResult = await db
    .select({ total: sql<number>`SUM(amount)` })
    .from(expenses)
    .where(and(eq(expenses.jobId, id), eq(expenses.orgId, orgId)));
  
  const laborCost = timeResult[0]?.total || 0;
  const materialCost = expenseResult[0]?.total || 0;
  const totalCost = Number(laborCost) + Number(materialCost);
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
    }
  });
});

export default jobsApp;
