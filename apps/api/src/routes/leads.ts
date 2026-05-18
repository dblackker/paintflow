import { Hono } from 'hono';
import { z } from 'zod';
import { createDb } from '@paintflow/db';
import { leads, quickbooksConnections } from '@paintflow/db/schema';
import { and, desc, eq, ilike, or } from 'drizzle-orm';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';
import { createQBCustomer } from '../lib/quickbooks';
import { formatPhoneNumber } from '../lib/twilio';

const leadsApp = new Hono<{ Bindings: Env; Variables: Variables }>();

// All routes require auth
leadsApp.use('*', authMiddleware);

const leadStatusSchema = z.enum(['new', 'contacted', 'estimate_sent', 'won', 'lost']);

const leadBaseSchema = z.object({
  name: z.string().trim().min(1).max(255),
  phone: z.string().trim().max(50).optional(),
  email: z.preprocess(
    (value) => typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.string().trim().email().max(255).optional()
  ),
  source: z.string().trim().max(100).optional(),
  status: leadStatusSchema.optional(),
});

const leadInputSchema = leadBaseSchema.refine((value) => value.phone || value.email, {
  message: 'A phone number or email is required',
  path: ['phone'],
});

const updateLeadSchema = leadBaseSchema.partial().extend({
  status: leadStatusSchema.optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: 'At least one field is required',
});

function normalizePhone(phone?: string) {
  if (!phone) return undefined;
  try {
    return formatPhoneNumber(phone);
  } catch {
    return phone.replace(/[^\d+]/g, '');
  }
}

leadsApp.get('/', async (c) => {
  const orgId = c.get('orgId');
  const status = c.req.query('status');
  const source = c.req.query('source');
  const q = c.req.query('q');
  const db = createDb(c.env.DATABASE_URL);

  const filters = [eq(leads.orgId, orgId)];
  if (status && status !== 'all' && leadStatusSchema.safeParse(status).success) {
    filters.push(eq(leads.status, status as typeof leads.$inferSelect.status));
  }
  if (source && source !== 'all') {
    filters.push(eq(leads.source, source));
  }
  if (q) {
    filters.push(or(
      ilike(leads.name, `%${q}%`),
      ilike(leads.email, `%${q}%`),
      ilike(leads.phone, `%${q}%`)
    )!);
  }
  
  const results = await db
    .select()
    .from(leads)
    .where(and(...filters))
    .orderBy(desc(leads.createdAt))
    .limit(Math.min(Number(c.req.query('limit') || 100), 200));
  
  return c.json({
    data: results,
    meta: { total: results.length }
  });
});

leadsApp.post('/', async (c) => {
  const orgId = c.get('orgId');
  const body = await c.req.json();
  const parsed = leadInputSchema.safeParse(body);
  
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error }, 400);
  }
  
  const db = createDb(c.env.DATABASE_URL);
  const phone = normalizePhone(parsed.data.phone);
  
  const [lead] = await db.insert(leads).values({
    orgId,
    name: parsed.data.name,
    phone,
    email: parsed.data.email,
    source: parsed.data.source,
    status: parsed.data.status ?? 'new',
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

leadsApp.patch('/:id', async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  const body = await c.req.json();
  const parsed = updateLeadSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const patch: Record<string, unknown> = { ...parsed.data, updatedAt: new Date() };
  if (parsed.data.phone !== undefined) {
    patch.phone = normalizePhone(parsed.data.phone);
  }

  const db = createDb(c.env.DATABASE_URL);
  const [lead] = await db.update(leads)
    .set(patch)
    .where(and(eq(leads.id, id), eq(leads.orgId, orgId)))
    .returning();

  if (!lead) {
    return c.json({ error: 'Lead not found' }, 404);
  }

  return c.json({ data: lead });
});

export default leadsApp;
