import { Hono } from 'hono';
import { z } from 'zod';
import { createDb } from '@paintflow/db';
import { leadSources } from '@paintflow/db/schema';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';
import { and, eq } from 'drizzle-orm';

const leadSourcesRoute = new Hono<{ Bindings: Env; Variables: Variables }>();
leadSourcesRoute.use('*', authMiddleware);

const sourceSchema = z.object({
  name: z.string().trim().min(1).max(100),
  type: z.string().trim().min(1).max(50),
  cost: z.coerce.number().min(0).max(1000000).default(0),
  isActive: z.boolean().optional(),
});

// GET /v1/lead-sources
leadSourcesRoute.get('/', async (c) => {
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);
  const data = await db.select().from(leadSources).where(eq(leadSources.orgId, orgId));
  return c.json({ data });
});

// POST /v1/lead-sources
leadSourcesRoute.post('/', async (c) => {
  const orgId = c.get('orgId');
  const body = await c.req.json();
  const parsed = sourceSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const db = createDb(c.env.DATABASE_URL);
  const [source] = await db.insert(leadSources).values({
    orgId,
    name: parsed.data.name,
    type: parsed.data.type,
    cost: parsed.data.cost.toFixed(2),
    isActive: parsed.data.isActive ?? true,
  }).returning();
  return c.json({ data: source });
});

leadSourcesRoute.patch('/:id', async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  const body = await c.req.json();
  const parsed = sourceSchema.partial().safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const patch: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.cost !== undefined) {
    patch.cost = parsed.data.cost.toFixed(2);
  }

  const db = createDb(c.env.DATABASE_URL);
  const [source] = await db.update(leadSources)
    .set(patch)
    .where(and(eq(leadSources.id, id), eq(leadSources.orgId, orgId)))
    .returning();

  if (!source) {
    return c.json({ error: 'Lead source not found' }, 404);
  }

  return c.json({ data: source });
});

export default leadSourcesRoute;
