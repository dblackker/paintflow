import { Hono } from 'hono';
import { createDb } from '@paintflow/db';
import { leads, estimates, jobs } from '@paintflow/db/schema';
import { eq, and, gte, count, desc } from 'drizzle-orm';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';

const dashboard = new Hono<{ Bindings: Env; Variables: Variables }>();

dashboard.use('*', authMiddleware);

// GET /v1/dashboard/stats
dashboard.get('/stats', async (c) => {
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);
  
  // Active leads (not converted)
  const activeLeads = await db
    .select({ count: count() })
    .from(leads)
    .where(and(eq(leads.orgId, orgId), eq(leads.status, 'new')));
  
  // Estimates sent this month
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  
  const estimatesSent = await db
    .select({ count: count() })
    .from(estimates)
    .where(and(eq(estimates.orgId, orgId), gte(estimates.sentAt, startOfMonth)));
  
  // Jobs this month
  const jobsThisMonth = await db
    .select({ count: count() })
    .from(jobs)
    .where(and(eq(jobs.orgId, orgId), gte(jobs.createdAt, startOfMonth)));
  
  // Recent activity (last 5 estimates)
  const recentEstimates = await db
    .select({
      id: estimates.id,
      leadId: estimates.leadId,
      status: estimates.status,
      total: estimates.total,
      createdAt: estimates.createdAt,
      sentAt: estimates.sentAt,
      clientName: leads.name,
      leadPhone: leads.phone,
      leadEmail: leads.email,
      leadStreetAddress: leads.streetAddress,
      leadCity: leads.city,
      leadState: leads.state,
      leadPostalCode: leads.postalCode,
    })
    .from(estimates)
    .leftJoin(leads, and(eq(estimates.leadId, leads.id), eq(leads.orgId, orgId)))
    .where(eq(estimates.orgId, orgId))
    .orderBy(desc(estimates.createdAt))
    .limit(5);
  
  return c.json({
    data: {
      activeLeads: activeLeads[0]?.count || 0,
      estimatesSent: estimatesSent[0]?.count || 0,
      jobsThisMonth: jobsThisMonth[0]?.count || 0,
      recentActivity: recentEstimates,
    }
  });
});

export default dashboard;
