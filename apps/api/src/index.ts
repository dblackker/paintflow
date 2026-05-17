import { Hono } from 'hono';
import { cors } from 'hono/cors';

const app = new Hono();

app.use('*', cors());

app.get('/health', (c) => {
  return c.json({ status: 'ok', service: 'paintflow-api', timestamp: new Date().toISOString() });
});

app.get('/v1/leads', (c) => {
  // TODO: Implement with RLS
  return c.json({ data: [], meta: { total: 0 } });
});

export default app;
