import { Hono } from 'hono';
import { z } from 'zod';
import { createDb } from '@paintflow/db';
import { estimates } from '@paintflow/db/schema';
import { eq, desc } from 'drizzle-orm';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';

const estimatesApp = new Hono<{ Bindings: Env; Variables: Variables }>();

estimatesApp.use('*', authMiddleware);

const lineItemSchema = z.object({
  desc: z.string(),
  qty: z.number().positive(),
  rate: z.number().positive(),
});

const packageSchema = z.object({
  name: z.enum(['good', 'better', 'best']),
  items: z.array(lineItemSchema),
  total: z.number(),
});

const createEstimateSchema = z.object({
  leadId: z.string().uuid(),
  packages: z.array(packageSchema).min(1),
});

estimatesApp.get('/', async (c) => {
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);
  
  const results = await db
    .select()
    .from(estimates)
    .where(eq(estimates.orgId, orgId))
    .orderBy(desc(estimates.createdAt))
    .limit(50);
  
  return c.json({ data: results });
});

estimatesApp.post('/', async (c) => {
  const orgId = c.get('orgId');
  const body = await c.req.json();
  const parsed = createEstimateSchema.safeParse(body);
  
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error }, 400);
  }
  
  const db = createDb(c.env.DATABASE_URL);
  
  const total = Math.max(...parsed.data.packages.map(p => p.total));
  
  const [estimate] = await db.insert(estimates).values({
    orgId,
    leadId: parsed.data.leadId,
    packages: parsed.data.packages,
    total: total.toString(),
    status: 'draft',
  }).returning();
  
  return c.json({ data: estimate }, 201);
});

estimatesApp.post('/:id/send', async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  
  const db = createDb(c.env.DATABASE_URL);
  
  // TODO: Update status to 'sent', trigger drip enrollment
  await db.update(estimates)
    .set({ status: 'sent', sentAt: new Date() })
    .where(eq(estimates.id, id));
  
  // TODO: Enqueue drip follow-up job
  // await c.env.QUEUE.send({ type: 'estimate_sent', estimateId: id });
  
  return c.json({ success: true });
});

export default estimatesApp;
