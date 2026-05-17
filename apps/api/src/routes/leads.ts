import { Hono } from 'hono';
import { z } from 'zod';
import { createDb } from '@paintflow/db';
import { leads, quickbooksConnections } from '@paintflow/db/schema';
import { eq, desc } from 'drizzle-orm';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';
import { createQBCustomer } from '../lib/quickbooks';

const leadsApp = new Hono<{ Bindings: Env; Variables: Variables }>();

// All routes require auth
leadsApp.use('*', authMiddleware);

const createLeadSchema = z.object({
  name: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  source: z.string().optional(),
});

leadsApp.get('/', async (c) => {
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);
  
  const results = await db
    .select()
    .from(leads)
    .where(eq(leads.orgId, orgId))
    .orderBy(desc(leads.createdAt))
    .limit(50);
  
  return c.json({
    data: results,
    meta: { total: results.length }
  });
});

leadsApp.post('/', async (c) => {
  const orgId = c.get('orgId');
  const body = await c.req.json();
  const parsed = createLeadSchema.safeParse(body);
  
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error }, 400);
  }
  
  const db = createDb(c.env.DATABASE_URL);
  
  const [lead] = await db.insert(leads).values({
    orgId,
    ...parsed.data,
    status: 'new',
  }).returning();
  
  // Auto-sync to QuickBooks if connected
  const qbConnection = await db.query.quickbooksConnections.findFirst({
    where: eq(quickbooksConnections.orgId, orgId),
  });
  
  if (qbConnection) {
    try {
      await createQBCustomer(c.env, orgId, lead);
      console.log(`Auto-synced lead ${lead.id} to QuickBooks`);
    } catch (qbErr) {
      console.error('QB auto-sync failed:', qbErr);
      // Don't fail lead creation if QB sync fails
    }
  }
  
  return c.json({ data: lead }, 201);
});

export default leadsApp;
