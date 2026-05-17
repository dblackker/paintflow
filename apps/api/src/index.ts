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
import calendarRoutes from './routes/calendar';
import uploadsRoutes from './routes/uploads';
import settingsRoutes from './routes/settings';
import quickbooksRoutes from './routes/quickbooks';
import productionRatesRoutes from './routes/production-rates';
import dashboardRoutes from './routes/dashboard';
import reviewsRoutes from './routes/reviews';

import templatesRoutes from './routes/templates';
const app = new Hono();

app.use('*', cors({
  origin: ['http://localhost:4321', 'https://paintflow.app'],
  credentials: true,
}));

app.use('*', tenantMiddleware);

app.route('/v1/auth', authRoutes);
app.route('/v1/billing/webhook', billingRoutes);
app.route('/v1/sms', smsRoutes);

app.get('/health', (c) => {
  return c.json({ 
    status: 'ok', 
    service: 'paintflow-api', 
    timestamp: new Date().toISOString(),
    orgId: c.get('orgId')
  });
});

app.route('/v1/leads', leadsRoutes);
app.route('/v1/estimates', estimatesRoutes);
app.route('/v1/billing', billingRoutes);
app.route('/v1/jobs', jobsRoutes);
app.route('/v1/pdf', pdfRoutes);
app.route('/v1/calendar', calendarRoutes);
app.route('/v1/uploads', uploadsRoutes);
app.route('/v1/settings', settingsRoutes);
app.route('/v1/quickbooks', quickbooksRoutes);
app.route('/v1/production-rates', productionRatesRoutes);
app.route('/v1/dashboard', dashboardRoutes);
app.route('/v1/reviews', reviewsRoutes);
app.route('/v1/templates', templatesRoutes);

