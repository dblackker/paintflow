import { Hono } from 'hono';
import { createDb } from '@paintflow/db';
import { leadSources } from '@paintflow/db/schema';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';
import { eq } from 'drizzle-orm';

const leadSourcesRoute = new Hono<{ Bindings: Env; Variables: Variables }>();
leadSourcesRoute.use('*', authMiddleware);

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
  const db = createDb(c.env.DATABASE_URL);
  const [source] = await db.insert(leadSources).values({ ...body, orgId }).returning();
  return c.json({ data: source });
});

export default leadSourcesRoute;
