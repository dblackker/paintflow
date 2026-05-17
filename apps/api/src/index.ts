import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { tenantMiddleware } from './middleware/tenant';
import { processDrips } from './cron/drips';
import authRoutes from './routes/auth';
import leadsRoutes from './routes/leads';
import estimatesRoutes from './routes/estimates';
import billingRoutes from './routes/billing';
import jobsRoutes from './routes/jobs';
import smsRoutes from './routes/sms';
import pdfRoutes from './routes/pdf';

const app = new Hono();

app.use('*', cors({
  origin: ['http://localhost:4321', 'https://paintflow.app'],
  credentials: true,
}));

app.use('*', tenantMiddleware);

// Public routes
app.route('/v1/auth', authRoutes);
app.route('/v1/billing/webhook', billingRoutes);
app.route('/v1/sms', smsRoutes);

// Health check
app.get('/health', (c) => {
  return c.json({ 
    status: 'ok', 
    service: 'paintflow-api', 
    timestamp: new Date().toISOString(),
    orgId: c.get('orgId')
  });
});

// Protected routes
app.route('/v1/leads', leadsRoutes);
app.route('/v1/estimates', estimatesRoutes);
app.route('/v1/billing', billingRoutes);
app.route('/v1/jobs', jobsRoutes);
app.route('/v1/pdf', pdfRoutes);

// Scheduled events
export async function scheduled(event: ScheduledEvent, env: any, ctx: ExecutionContext) {
  ctx.waitUntil(processDrips(env));
}

export default app;
