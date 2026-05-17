import { Hono } from 'hono';
import { createDb } from '@paintflow/db';
import { changeOrders } from '@paintflow/db/schema';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';
import { eq, and, desc } from 'drizzle-orm';

const changeOrdersRoute = new Hono<{ Bindings: Env; Variables: Variables }>();
changeOrdersRoute.use('*', authMiddleware);

// GET /v1/change-orders?jobId=xxx
changeOrdersRoute.get('/', async (c) => {
  const orgId = c.get('orgId');
  const jobId = c.req.query('jobId');
  const db = createDb(c.env.DATABASE_URL);
  
  let query = db.select().from(changeOrders).where(eq(changeOrders.orgId, orgId));
  if (jobId) {
    query = query.where(and(eq(changeOrders.orgId, orgId), eq(changeOrders.jobId, jobId)));
  }
  
  const data = await query.orderBy(desc(changeOrders.createdAt));
  return c.json({ data });
});

// POST /v1/change-orders
changeOrdersRoute.post('/', async (c) => {
  const orgId = c.get('orgId');
  const body = await c.req.json();
  const db = createDb(c.env.DATABASE_URL);
  const [order] = await db.insert(changeOrders).values({ ...body, orgId }).returning();
  return c.json({ data: order });
});

// PATCH /v1/change-orders/:id
changeOrdersRoute.patch('/:id', async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  const body = await c.req.json();
  const db = createDb(c.env.DATABASE_URL);
  
  if (body.status === 'approved' && !body.approvedAt) {
    body.approvedAt = new Date();
  }
  
  const [order] = await db.update(changeOrders)
    .set(body)
    .where(and(eq(changeOrders.id, id), eq(changeOrders.orgId, orgId)))
    .returning();
  
  return c.json({ data: order });
});

export default changeOrdersRoute;
