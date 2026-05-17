import { Hono } from 'hono';
import { createDb } from '@paintflow/db';
import { messageTemplates } from '@paintflow/db/schema';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';
import { eq, and } from 'drizzle-orm';

const templates = new Hono<{ Bindings: Env; Variables: Variables }>();
templates.use('*', authMiddleware);

// GET /v1/templates
templates.get('/', async (c) => {
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);
  const data = await db.select().from(messageTemplates).where(eq(messageTemplates.orgId, orgId));
  return c.json({ data });
});

// POST /v1/templates
templates.post('/', async (c) => {
  const orgId = c.get('orgId');
  const body = await c.req.json();
  const db = createDb(c.env.DATABASE_URL);
  const [template] = await db.insert(messageTemplates).values({ ...body, orgId }).returning();
  return c.json({ data: template });
});

// PATCH /v1/templates/:id
templates.patch('/:id', async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  const body = await c.req.json();
  const db = createDb(c.env.DATABASE_URL);
  const [template] = await db.update(messageTemplates)
    .set({ ...body, updatedAt: new Date() })
    .where(and(eq(messageTemplates.id, id), eq(messageTemplates.orgId, orgId)))
    .returning();
  return c.json({ data: template });
});

export default templates;
