import { Hono } from 'hono';
import { z } from 'zod';
import { createDb } from '@paintflow/db';
import { productionRates } from '@paintflow/db/schema';
import { eq, asc } from 'drizzle-orm';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use('*', authMiddleware);

app.get('/', async (c) => {
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);
  
  const rates = await db
    .select()
    .from(productionRates)
    .where(eq(productionRates.orgId, orgId))
    .orderBy(asc(productionRates.category), asc(productionRates.task));
  
  return c.json({ data: rates });
});

const createSchema = z.object({
  task: z.string().min(1),
  unit: z.string().min(1),
  hoursPerUnit: z.number().positive(),
  category: z.string().optional(),
});

app.post('/', async (c) => {
  const orgId = c.get('orgId');
  const body = await c.req.json();
  const parsed = createSchema.safeParse(body);
  
  if (!parsed.success) {
    return c.json({ error: 'Validation failed' }, 400);
  }
  
  const db = createDb(c.env.DATABASE_URL);
  const [rate] = await db.insert(productionRates).values({
    orgId,
    ...parsed.data,
    hoursPerUnit: parsed.data.hoursPerUnit.toString(),
  }).returning();
  
  return c.json({ data: rate }, 201);
});

app.put('/:id', async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  const body = await c.req.json();
  const parsed = createSchema.safeParse(body);
  
  if (!parsed.success) {
    return c.json({ error: 'Validation failed' }, 400);
  }
  
  const db = createDb(c.env.DATABASE_URL);
  const [rate] = await db.update(productionRates)
    .set({
      ...parsed.data,
      hoursPerUnit: parsed.data.hoursPerUnit.toString(),
      updatedAt: new Date(),
    })
    .where(eq(productionRates.id, id))
    .returning();
  
  if (!rate || rate.orgId !== orgId) {
    return c.json({ error: 'Not found' }, 404);
  }
  
  return c.json({ data: rate });
});

app.delete('/:id', async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  const db = createDb(c.env.DATABASE_URL);
  
  const [rate] = await db.delete(productionRates)
    .where(eq(productionRates.id, id))
    .returning();
  
  if (!rate || rate.orgId !== orgId) {
    return c.json({ error: 'Not found' }, 404);
  }
  
  return c.json({ success: true });
});

export default app;
