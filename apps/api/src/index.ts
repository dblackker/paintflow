import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { tenantMiddleware } from './middleware/tenant';
import authRoutes from './routes/auth';

const app = new Hono();

app.use('*', cors({
  origin: ['http://localhost:4321', 'https://paintflow.app'],
  credentials: true,
}));

app.use('*', tenantMiddleware);

// Public routes
app.route('/v1/auth', authRoutes);

// Health check
app.get('/health', (c) => {
  return c.json({ 
    status: 'ok', 
    service: 'paintflow-api', 
    timestamp: new Date().toISOString(),
    orgId: c.get('orgId')
  });
});

// Protected routes (TODO: add auth middleware)
app.get('/v1/leads', (c) => {
  return c.json({ data: [], meta: { total: 0 } });
});

export default app;
