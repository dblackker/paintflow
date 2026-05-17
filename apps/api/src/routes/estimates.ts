import { Hono } from 'hono';
import { z } from 'zod';
import { createDb } from '@paintflow/db';
import { estimates, leads } from '@paintflow/db/schema';
import { eq, desc } from 'drizzle-orm';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';
import { sendEmail, estimateEmailTemplate } from '../lib/email';

const estimatesApp = new Hono<{ Bindings: Env; Variables: Variables }>();

estimatesApp.get('/:id/public', async (c) => {
  const id = c.req.param('id');
  const db = createDb(c.env.DATABASE_URL);
  
  const estimate = await db.query.estimates.findFirst({
    where: eq(estimates.id, id),
  });
  
  if (!estimate) {
    return c.json({ error: 'Not found' }, 404);
  }
  
  return c.json({ 
    data: {
      id: estimate.id,
      packages: estimate.packages,
      total: estimate.total,
      status: estimate.status,
      createdAt: estimate.createdAt,
    }
  });
});

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
  
  const estimate = await db.query.estimates.findFirst({
    where: eq(estimates.id, id),
  });
  
  if (!estimate || estimate.orgId !== orgId) {
    return c.json({ error: 'Not found' }, 404);
  }
  
  const lead = await db.query.leads.findFirst({
    where: eq(leads.id, estimate.leadId),
  });
  
  await db.update(estimates)
    .set({ status: 'sent', sentAt: new Date() })
    .where(eq(estimates.id, id));
  
  if (lead?.email) {
    try {
      const html = estimateEmailTemplate(estimate.id, lead.name, estimate.total);
      await sendEmail(c.env, lead.email, 'Your Painting Estimate', html);
    } catch (err) {
      console.error('Failed to send email:', err);
    }
  }
  
  return c.json({ success: true });
});

export default estimatesApp;
