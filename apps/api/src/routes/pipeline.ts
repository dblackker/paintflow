import { Hono } from 'hono';
import { createDb } from '@paintflow/db';
import { activities, estimates, jobs, leads } from '@paintflow/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';

const pipeline = new Hono<{ Bindings: Env; Variables: Variables }>();
pipeline.use('*', authMiddleware);

const stages = [
  { id: 'new_lead', label: 'New lead', group: 'sales' },
  { id: 'contacted', label: 'Contacted', group: 'sales' },
  { id: 'estimate_scheduled', label: 'Estimate scheduled', group: 'sales' },
  { id: 'estimate_in_progress', label: 'Estimate in progress', group: 'sales' },
  { id: 'estimate_sent', label: 'Estimate sent', group: 'sales' },
  { id: 'won_deposit_pending', label: 'Won / deposit pending', group: 'handoff' },
  { id: 'ready_to_schedule', label: 'Ready to schedule', group: 'handoff' },
  { id: 'scheduled', label: 'Scheduled', group: 'production' },
  { id: 'in_production', label: 'In production', group: 'production' },
  { id: 'punch_list', label: 'Punch list', group: 'production' },
  { id: 'completed_review', label: 'Completed / review requested', group: 'closeout' },
  { id: 'lost', label: 'Lost / archived', group: 'closeout' },
];

function money(value: unknown) {
  return Number(value || 0);
}

function latestByDate<T extends { createdAt: Date | string; updatedAt?: Date | string | null }>(items: T[]) {
  return [...items].sort((a, b) => {
    const bTime = new Date(b.updatedAt || b.createdAt).getTime();
    const aTime = new Date(a.updatedAt || a.createdAt).getTime();
    return bTime - aTime;
  })[0];
}

function stageFor(lead: typeof leads.$inferSelect, estimate?: typeof estimates.$inferSelect, job?: typeof jobs.$inferSelect) {
  if (lead.status === 'lost') return 'lost';
  if (job) {
    if (job.status === 'completed') return 'completed_review';
    if (job.status === 'in_progress') return 'in_production';
    if (job.status === 'punch_list') return 'punch_list';
    if (job.status === 'scheduled') return 'scheduled';
    return 'ready_to_schedule';
  }
  if (estimate) {
    if (estimate.status === 'declined') return 'lost';
    if (estimate.status === 'accepted') return 'won_deposit_pending';
    if (estimate.status === 'sent') return 'estimate_sent';
    return 'estimate_in_progress';
  }
  if (lead.status === 'contacted') return 'contacted';
  if (lead.status === 'estimate_sent') return 'estimate_sent';
  if (lead.status === 'won') return 'ready_to_schedule';
  return 'new_lead';
}

function stageDate(lead: typeof leads.$inferSelect, estimate?: typeof estimates.$inferSelect, job?: typeof jobs.$inferSelect) {
  return job?.updatedAt || job?.createdAt || estimate?.updatedAt || estimate?.createdAt || lead.updatedAt || lead.createdAt;
}

function daysSince(value: Date | string) {
  const diff = Date.now() - new Date(value).getTime();
  return Math.max(0, Math.floor(diff / 86_400_000));
}

function cardWarnings(stage: string, lead: typeof leads.$inferSelect, estimate: typeof estimates.$inferSelect | undefined, job: typeof jobs.$inferSelect | undefined, nextActivity: typeof activities.$inferSelect | undefined) {
  const warnings: string[] = [];
  const staleDays = daysSince(stageDate(lead, estimate, job));
  if (['new_lead', 'contacted'].includes(stage) && !estimate && staleDays >= 2) warnings.push('No estimate started');
  if (['new_lead', 'contacted', 'estimate_sent'].includes(stage) && !nextActivity) warnings.push('No follow-up scheduled');
  if (stage === 'estimate_sent' && staleDays >= 3) warnings.push('Estimate follow-up due');
  if (stage === 'won_deposit_pending' && !job) warnings.push('Needs job handoff');
  if (['scheduled', 'in_production'].includes(stage) && !lead.phone) warnings.push('Missing customer phone');
  return warnings;
}

pipeline.get('/', async (c) => {
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);
  const [leadRows, estimateRows, jobRows, activityRows] = await Promise.all([
    db.query.leads.findMany({ where: eq(leads.orgId, orgId), orderBy: (leads, { desc }) => [desc(leads.updatedAt)] }),
    db.query.estimates.findMany({ where: eq(estimates.orgId, orgId), orderBy: (estimates, { desc }) => [desc(estimates.updatedAt)] }),
    db.query.jobs.findMany({ where: eq(jobs.orgId, orgId), orderBy: (jobs, { desc }) => [desc(jobs.updatedAt)] }),
    db.select().from(activities)
      .where(and(eq(activities.orgId, orgId), eq(activities.status, 'open')))
      .orderBy(desc(activities.createdAt))
      .limit(500),
  ]);

  const estimatesByLead = new Map<string, typeof estimateRows>();
  const jobsByLead = new Map<string, typeof jobRows>();
  const activitiesByLead = new Map<string, typeof activityRows>();
  for (const estimate of estimateRows) estimatesByLead.set(estimate.leadId, [...(estimatesByLead.get(estimate.leadId) || []), estimate]);
  for (const job of jobRows) jobsByLead.set(job.leadId, [...(jobsByLead.get(job.leadId) || []), job]);
  for (const activity of activityRows) {
    if (!activity.leadId) continue;
    activitiesByLead.set(activity.leadId, [...(activitiesByLead.get(activity.leadId) || []), activity]);
  }

  const cards = leadRows.map((lead) => {
    const estimate = latestByDate(estimatesByLead.get(lead.id) || []);
    const job = latestByDate(jobsByLead.get(lead.id) || []);
    const openActivities = activitiesByLead.get(lead.id) || [];
    const nextActivity = [...openActivities].sort((a, b) => {
      const aTime = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
      const bTime = b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
      return aTime - bTime;
    })[0];
    const stage = stageFor(lead, estimate, job);
    const enteredAt = stageDate(lead, estimate, job);
    const value = money(job?.budget || estimate?.total);
    const href = job?.id
      ? `/jobs/${job.id}`
      : estimate?.id
        ? (estimate.status === 'draft' ? `/estimates/production?estimateId=${estimate.id}` : `/estimates/${estimate.id}`)
        : `/leads/${lead.id}`;

    return {
      id: lead.id,
      leadId: lead.id,
      name: lead.name,
      phone: lead.phone,
      email: lead.email,
      address: {
        street: lead.streetAddress,
        city: lead.city,
        state: lead.state,
        postalCode: lead.postalCode,
      },
      source: lead.source,
      stage,
      stageEnteredAt: enteredAt,
      daysInStage: daysSince(enteredAt),
      value,
      href,
      estimate: estimate ? { id: estimate.id, status: estimate.status, total: money(estimate.total), createdAt: estimate.createdAt, updatedAt: estimate.updatedAt } : null,
      job: job ? { id: job.id, name: job.name, status: job.status, budget: money(job.budget), createdAt: job.createdAt, updatedAt: job.updatedAt } : null,
      nextActivity: nextActivity ? {
        id: nextActivity.id,
        type: nextActivity.type,
        title: nextActivity.title,
        dueAt: nextActivity.dueAt,
      } : null,
      warnings: cardWarnings(stage, lead, estimate, job, nextActivity),
    };
  });

  return c.json({
    data: {
      stages,
      cards,
      summary: {
        totalValue: cards.reduce((sum, card) => sum + card.value, 0),
        openActivities: activityRows.length,
        staleCount: cards.filter((card) => card.daysInStage >= 3 || card.warnings.length).length,
        activeCustomers: cards.filter((card) => card.stage !== 'lost' && card.stage !== 'completed_review').length,
      },
    },
  });
});

export default pipeline;
