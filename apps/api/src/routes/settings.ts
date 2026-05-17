import { Hono } from 'hono';
import { createDb } from '@paintflow/db';
import { organizations } from '@paintflow/db/schema';
import { eq } from 'drizzle-orm';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';

const settings = new Hono<{ Bindings: Env; Variables: Variables }>();

settings.use('*', authMiddleware);

// GET /v1/settings/company
settings.get('/company', async (c) => {
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);
  
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
  });
  
  return c.json({ data: org });
});

// PUT /v1/settings/company
settings.put('/company', async (c) => {
  const orgId = c.get('orgId');
  const body = await c.req.json();
  const db = createDb(c.env.DATABASE_URL);
  
  const [org] = await db.update(organizations)
    .set({
      name: body.name,
      // TODO: Add more fields to schema
    })
    .where(eq(organizations.id, orgId))
    .returning();
  
  return c.json({ data: org });
});

// GET /v1/settings/pricing
settings.get('/pricing', async (c) => {
  // TODO: Fetch from org settings table
  return c.json({ 
    data: {
      hourlyRate: 65.00,
      markup: 20,
      deposit: 50,
    }
  });
});

// PUT /v1/settings/pricing
settings.put('/pricing', async (c) => {
  const body = await c.req.json();
  // TODO: Save to org settings table
  return c.json({ data: body });
});

export default settings;
