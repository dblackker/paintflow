import { Hono } from 'hono';
import { createDb } from '@paintflow/db';
import { activities, emailSends, estimates, jobs, leads, messages, timeEntries } from '@paintflow/db/schema';
import { eq, and, gte, count, desc } from 'drizzle-orm';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';

const dashboard = new Hono<{ Bindings: Env; Variables: Variables }>();

dashboard.use('*', authMiddleware);

function estimateActivityLabel(status: string, sentAt?: Date | null) {
  if (status === 'accepted') return 'Estimate accepted';
  if (status === 'declined') return 'Estimate declined';
  if (status === 'sent') return 'Estimate sent';
  if (status === 'draft') return 'Draft estimate created';
  return sentAt ? 'Estimate sent' : 'Estimate updated';
}

function estimateActivityAt(status: string, createdAt: Date, sentAt?: Date | null) {
  if (['sent', 'accepted', 'declined'].includes(status) && sentAt) return sentAt;
  return createdAt;
}

function daysSince(value: Date | string | null | undefined) {
  if (!value) return 0;
  const diff = Date.now() - new Date(value).getTime();
  return Math.max(0, Math.floor(diff / 86_400_000));
}

function todayAt(hour = 17) {
  const date = new Date();
  date.setHours(hour, 0, 0, 0);
  return date;
}

function tomorrowAt(hour = 9) {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(hour, 0, 0, 0);
  return date;
}

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
      recentActivity: recentEstimates.map((estimate) => ({
        ...estimate,
        activityType: 'estimate',
        activityLabel: estimateActivityLabel(estimate.status, estimate.sentAt),
        activityAt: estimateActivityAt(estimate.status, estimate.createdAt, estimate.sentAt),
        href: `/estimates/${estimate.id}`,
      })),
    }
  });
});

// GET /v1/dashboard/recommendations
dashboard.get('/recommendations', async (c) => {
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);

  const [leadRows, estimateRows, jobRows, activityRows, messageRows, emailRows, timeRows] = await Promise.all([
    db.query.leads.findMany({ where: eq(leads.orgId, orgId), orderBy: (leads, { desc }) => [desc(leads.updatedAt)], limit: 250 }),
    db.query.estimates.findMany({ where: eq(estimates.orgId, orgId), orderBy: (estimates, { desc }) => [desc(estimates.updatedAt)], limit: 250 }),
    db.query.jobs.findMany({ where: eq(jobs.orgId, orgId), orderBy: (jobs, { desc }) => [desc(jobs.updatedAt)], limit: 250 }),
    db.query.activities.findMany({ where: and(eq(activities.orgId, orgId), eq(activities.status, 'open')), orderBy: (activities, { desc }) => [desc(activities.createdAt)], limit: 500 }),
    db.query.messages.findMany({ where: eq(messages.orgId, orgId), orderBy: (messages, { desc }) => [desc(messages.createdAt)], limit: 500 }),
    db.query.emailSends.findMany({ where: eq(emailSends.orgId, orgId), orderBy: (emailSends, { desc }) => [desc(emailSends.sentAt)], limit: 500 }),
    db.query.timeEntries.findMany({ where: eq(timeEntries.orgId, orgId), orderBy: (timeEntries, { desc }) => [desc(timeEntries.date)], limit: 500 }),
  ]);

  const estimatesByLead = new Map<string, typeof estimateRows>();
  const jobsByLead = new Map<string, typeof jobRows>();
  const activitiesByLead = new Map<string, typeof activityRows>();
  const outboundMessagesByLead = new Map<string, typeof messageRows>();
  const emailsByLead = new Map<string, typeof emailRows>();
  const hoursByJob = new Map<string, number>();
  const latestTimeByJob = new Map<string, Date | string>();

  for (const estimate of estimateRows) estimatesByLead.set(estimate.leadId, [...(estimatesByLead.get(estimate.leadId) || []), estimate]);
  for (const job of jobRows) jobsByLead.set(job.leadId, [...(jobsByLead.get(job.leadId) || []), job]);
  for (const activity of activityRows) {
    if (activity.leadId) activitiesByLead.set(activity.leadId, [...(activitiesByLead.get(activity.leadId) || []), activity]);
  }
  for (const message of messageRows) {
    if (message.leadId && message.direction === 'outbound') outboundMessagesByLead.set(message.leadId, [...(outboundMessagesByLead.get(message.leadId) || []), message]);
  }
  for (const email of emailRows) {
    if (email.leadId) emailsByLead.set(email.leadId, [...(emailsByLead.get(email.leadId) || []), email]);
  }
  for (const entry of timeRows) {
    if (!entry.jobId) continue;
    hoursByJob.set(entry.jobId, (hoursByJob.get(entry.jobId) || 0) + Number(entry.hours || 0));
    const previous = latestTimeByJob.get(entry.jobId);
    if (!previous || new Date(entry.date).getTime() > new Date(previous).getTime()) latestTimeByJob.set(entry.jobId, entry.date);
  }

  const recommendations: Array<Record<string, unknown>> = [];

  for (const lead of leadRows) {
    const hasJob = Boolean(jobsByLead.get(lead.id)?.length);
    const hasEstimate = Boolean(estimatesByLead.get(lead.id)?.some((estimate) => !['canceled', 'voided', 'superseded'].includes(estimate.status)));
    const hasOutbound = Boolean(outboundMessagesByLead.get(lead.id)?.length || emailsByLead.get(lead.id)?.length);
    const hasOpenFollowUp = Boolean(activitiesByLead.get(lead.id)?.some((activity) => ['email', 'follow_up', 'call', 'task'].includes(activity.type)));
    const staleDays = daysSince(lead.updatedAt || lead.createdAt);

    if (!hasJob && !hasEstimate && !hasOutbound && !hasOpenFollowUp && ['new', 'contacted'].includes(lead.status) && staleDays >= 2 && lead.email) {
      recommendations.push({
        id: `stale-lead-email:${lead.id}`,
        priority: 92 - Math.min(staleDays, 14),
        type: 'stale_lead_email',
        title: `Reach out to ${lead.name}`,
        body: `${lead.name} has been sitting for ${staleDays} days with no outbound email, text, or follow-up task.`,
        impact: 'Keeps new inquiries from going cold.',
        entityLabel: lead.name,
        href: `/leads/${lead.id}#customer-activity`,
        primaryAction: {
          label: 'Create email follow-up',
          method: 'POST',
          path: '/v1/activities',
          successMessage: 'Email follow-up created',
          body: {
            leadId: lead.id,
            type: 'email',
            title: `Email ${lead.name} about their painting project`,
            notes: `Suggested email angle: thank them for reaching out, confirm the jobsite and scope, and ask for the best time to schedule an estimate visit.\n\nStarter copy:\nHi ${lead.name}, thanks for reaching out about your painting project. I wanted to confirm a few details and find a convenient time to look at the project so we can prepare an accurate estimate.`,
            status: 'open',
            dueAt: todayAt().toISOString(),
            metadata: { source: 'dashboard_recommendation', recommendationType: 'stale_lead_email' },
          },
        },
        secondaryAction: { label: 'Open customer', href: `/leads/${lead.id}` },
      });
    }
  }

  const estimateFollowUpLeadIds = new Set<string>();
  for (const estimate of estimateRows) {
    if (estimate.status !== 'sent' || !estimate.sentAt) continue;
    if (estimateFollowUpLeadIds.has(estimate.leadId)) continue;
    const lead = leadRows.find((item) => item.id === estimate.leadId);
    if (!lead) continue;
    estimateFollowUpLeadIds.add(estimate.leadId);
    const openFollowUps = activitiesByLead.get(lead.id)?.filter((activity) => activity.estimateId === estimate.id || activity.leadId === lead.id) || [];
    const staleDays = daysSince(estimate.sentAt);
    if (staleDays >= 3 && !openFollowUps.length && lead.email) {
      recommendations.push({
        id: `estimate-follow-up:${estimate.id}`,
        priority: 80 - Math.min(staleDays, 14),
        type: 'estimate_follow_up',
        title: `Follow up on ${lead.name}'s estimate`,
        body: `Estimate was sent ${staleDays} days ago and has no open follow-up task.`,
        impact: 'Improves close rate and keeps decisions moving.',
        entityLabel: lead.name,
        href: `/estimates/${estimate.id}`,
        primaryAction: {
          label: 'Create follow-up',
          method: 'POST',
          path: '/v1/activities',
          successMessage: 'Estimate follow-up created',
          body: {
            leadId: lead.id,
            estimateId: estimate.id,
            type: 'follow_up',
            title: `Follow up on estimate with ${lead.name}`,
            notes: 'Suggested touchpoint: confirm they received the proposal, ask whether the scope looks right, and offer to answer questions before approval.',
            status: 'open',
            dueAt: tomorrowAt().toISOString(),
            metadata: { source: 'dashboard_recommendation', recommendationType: 'estimate_follow_up' },
          },
        },
        secondaryAction: { label: 'View estimate', href: `/estimates/${estimate.id}` },
      });
    }
  }

  for (const job of jobRows) {
    const hours = hoursByJob.get(job.id) || 0;
    if (job.status === 'scheduled' && hours > 0) {
      const lead = leadRows.find((item) => item.id === job.leadId);
      recommendations.push({
        id: `job-in-production:${job.id}`,
        priority: 96,
        type: 'job_in_production',
        title: `Move ${job.name} to in production`,
        body: `${hours.toFixed(hours % 1 ? 2 : 0)} crew hour${hours === 1 ? '' : 's'} logged while the job is still scheduled.`,
        impact: 'Keeps pipeline, calendar, and reports aligned with field activity.',
        entityLabel: lead?.name || job.name,
        href: `/jobs/${job.id}`,
        primaryAction: {
          label: 'Mark in production',
          method: 'PATCH',
          path: `/v1/jobs/${job.id}`,
          successMessage: 'Job moved to in production',
          body: { status: 'in_progress' },
        },
        secondaryAction: { label: 'Open job', href: `/jobs/${job.id}` },
        evidence: latestTimeByJob.get(job.id) ? `Last time logged ${new Date(latestTimeByJob.get(job.id) as Date | string).toLocaleDateString()}` : null,
      });
    }
  }

  recommendations.sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0));

  return c.json({
    data: recommendations.slice(0, 6).map(({ priority: _priority, ...recommendation }) => recommendation),
  });
});

export default dashboard;
