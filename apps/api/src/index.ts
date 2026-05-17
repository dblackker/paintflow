import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { tenantMiddleware } from './middleware/tenant';

const app = new Hono();

app.use('*', cors({
  origin: ['http://localhost:4321', 'https://paintflow.app'],
  credentials: true,
}));

app.use('*', tenantMiddleware);

app.get('/health', (c) => {
  return c.json({ 
    status: 'ok', 
    service: 'paintflow-api', 
    timestamp: new Date().toISOString(),
    orgId: c.get('orgId')
  });
});

app.get('/v1/leads', (c) => {
  // TODO: Implement with RLS
  // const orgId = c.get('orgId');
  // const leads = await db.select().from(leads).where(eq(leads.orgId, orgId));
  return c.json({ data: [], meta: { total: 0 } });
});

export default app;
