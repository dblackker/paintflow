import { Hono } from 'hono';
import { securityHeaders } from './middleware/security';
import { tenantMiddleware } from './middleware/tenant';
import { requestLogging } from './middleware/request-logging';
import { processDrips } from './cron/drips';
import { processReviewRequests } from './cron/reviewRequests';
import { processMissedPunches } from './cron/missedPunches';
import type { Env, Variables } from './types';
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
import estimateTemplatesRoutes from './routes/estimate-templates';
import estimatePhotosRoutes from './routes/estimate-photos';
import stripeConnectRoutes from './routes/stripe-connect';
import dashboardRoutes from './routes/dashboard';
import reviewsRoutes from './routes/reviews';
import changeOrdersRoute from './routes/change-orders';
import templatesRoutes from './routes/templates';
import leadSourcesRoute from './routes/lead-sources';
import saasBillingRoutes from './routes/saas-billing';
import materialsRoutes from './routes/materials';
import invoicesRoutes from './routes/invoices';
import teamRoutes from './routes/team';
import portalRoutes from './routes/portal';
import reportsRoutes from './routes/reports';
import payrollRoutes from './routes/payroll';
import rolesRoutes from './routes/roles';
import notificationsRoutes from './routes/notifications';
import pushRoutes from './routes/push';
import activitiesRoutes from './routes/activities';
import pipelineRoutes from './routes/pipeline';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

const defaultOrigins = ['http://localhost:4321', 'http://127.0.0.1:4321', 'https://app.paintflow.app', 'https://paintflow.app'];

function isAllowedOrigin(origin: string | undefined, configuredOrigins: string[], environment?: string) {
  if (!origin) return null;
  if (configuredOrigins.includes(origin)) return origin;

  if (environment !== 'production') {
    try {
      const url = new URL(origin);
      const isLocalHost = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      const port = Number(url.port || 0);
      if (isLocalHost && port >= 4321 && port <= 4399) {
        return origin;
      }
    } catch {
      return null;
    }
  }

  return null;
}

app.use('*', async (c, next) => {
  const origin = c.req.raw.headers.get('Origin') || undefined;
  const configuredOrigins = c.env.CORS_ORIGINS
    ? c.env.CORS_ORIGINS.split(',').map((value) => value.trim()).filter(Boolean)
    : defaultOrigins;
  const allowedOrigin = isAllowedOrigin(origin, configuredOrigins, c.env.ENVIRONMENT);

  if (allowedOrigin) {
    c.header('Access-Control-Allow-Origin', allowedOrigin);
    c.header('Access-Control-Allow-Credentials', 'true');
    c.header('Vary', 'Origin', { append: true });
  }

  if (c.req.method === 'OPTIONS') {
    const requestHeaders = c.req.raw.headers.get('Access-Control-Request-Headers');
    c.header('Access-Control-Allow-Methods', 'GET,HEAD,PUT,POST,DELETE,PATCH');
    if (requestHeaders) {
      c.header('Access-Control-Allow-Headers', requestHeaders);
      c.header('Vary', 'Access-Control-Request-Headers', { append: true });
    }
    return c.body(null, 204);
  }

  await next();

  if (allowedOrigin) {
    c.header('Access-Control-Allow-Origin', allowedOrigin);
    c.header('Access-Control-Allow-Credentials', 'true');
    c.header('Vary', 'Origin', { append: true });
  }
});

app.use('*', securityHeaders);
app.use('*', tenantMiddleware);
app.use('*', requestLogging);

app.route('/v1/auth', authRoutes);
app.route('/v1/sms', smsRoutes);
app.route('/v1/portal', portalRoutes);

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
app.route('/v1/payments', billingRoutes);
app.route('/v1/jobs', jobsRoutes);
app.route('/v1/pdf', pdfRoutes);
app.route('/v1/calendar', calendarRoutes);
app.route('/v1/uploads', uploadsRoutes);
app.route('/v1/settings', settingsRoutes);
app.route('/v1/quickbooks', quickbooksRoutes);
app.route('/v1/stripe', stripeConnectRoutes);
app.route('/v1/production-rates', productionRatesRoutes);
app.route('/v1/estimate-templates', estimateTemplatesRoutes);
app.route('/v1/estimate-photos', estimatePhotosRoutes);
app.route('/v1/dashboard', dashboardRoutes);
app.route('/v1/reviews', reviewsRoutes);
app.route('/v1/templates', templatesRoutes);
app.route('/v1/change-orders', changeOrdersRoute);
app.route('/v1/billing', saasBillingRoutes);
app.route('/v1/lead-sources', leadSourcesRoute);
app.route('/v1/materials', materialsRoutes);
app.route('/v1/invoices', invoicesRoutes);
app.route('/v1/team', teamRoutes);
app.route('/v1/reports', reportsRoutes);
app.route('/v1/payroll', payrollRoutes);
app.route('/v1/roles', rolesRoutes);
app.route('/v1/notifications', notificationsRoutes);
app.route('/v1/push', pushRoutes);
app.route('/v1/activities', activitiesRoutes);
app.route('/v1/pipeline', pipelineRoutes);

app.get('/api/cron/drips', async (c) => {
  const authHeader = c.req.header('authorization');
  if (!authHeader || authHeader !== `Bearer ${c.env.CRON_SECRET}`) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const result = await processDrips(c.env);
  return c.json(result);
});

app.get('/api/cron/reviews', async (c) => {
  const authHeader = c.req.header('authorization');
  if (!authHeader || authHeader !== `Bearer ${c.env.CRON_SECRET}`) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const result = await processReviewRequests(c.env);
  return c.json(result);
});

app.get('/api/cron/missed-punches', async (c) => {
  const authHeader = c.req.header('authorization');
  if (!authHeader || authHeader !== `Bearer ${c.env.CRON_SECRET}`) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const result = await processMissedPunches(c.env);
  return c.json(result);
});

async function runScheduledJobs(env: Env) {
  const [drips, reviews, missedPunches] = await Promise.allSettled([
    processDrips(env),
    processReviewRequests(env),
    processMissedPunches(env),
  ]);

  return {
    drips: drips.status === 'fulfilled' ? drips.value : { error: drips.reason?.message || 'Drip processing failed' },
    reviews: reviews.status === 'fulfilled' ? reviews.value : { error: reviews.reason?.message || 'Review processing failed' },
    missedPunches: missedPunches.status === 'fulfilled' ? missedPunches.value : { error: missedPunches.reason?.message || 'Missed punch processing failed' },
  };
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return app.fetch(request, env, ctx);
  },
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runScheduledJobs(env));
  },
};
