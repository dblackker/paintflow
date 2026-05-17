import { Hono } from 'hono';
import { z } from 'zod';

const leads = new Hono();

const createLeadSchema = z.object({
  name: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  source: z.string().optional(),
});

leads.get('/', async (c) => {
  // TODO: Get orgId from context, query DB with RLS
  // const orgId = c.get('orgId');
  // const leads = await db.select().from(leads).where(eq(leads.orgId, orgId));
  
  return c.json({
    data: [],
    meta: { total: 0 }
  });
});

leads.post('/', async (c) => {
  const body = await c.req.json();
  const parsed = createLeadSchema.safeParse(body);
  
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error }, 400);
  }
  
  // TODO: Insert into DB
  // const lead = await db.insert(leads).values({ ...parsed.data, orgId }).returning();
  
  return c.json({ 
    data: { id: 'temp-id', ...parsed.data, status: 'new' }
  }, 201);
});

export default leads;
