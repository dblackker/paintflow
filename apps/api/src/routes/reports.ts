import { Hono } from 'hono';
import { createDb } from '@crewmodo/db';
import { estimates, jobs, leads, jobCosts, timeEntries, teamMembers } from '@crewmodo/db/schema';
import { eq, and, gte, lte, sql, desc } from 'drizzle-orm';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';

const reportsApp = new Hono<{ Bindings: Env; Variables: Variables }>();
reportsApp.use('*', authMiddleware);

reportsApp.get('/dashboard', async (c) => {
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);
  
  const [stats] = await db.select({
    totalEstimates: sql<number>`count(distinct ${estimates.id})`,
    approvedEstimates: sql<number>`count(distinct ${estimates.id}) filter (where ${estimates.status} = 'accepted')`,
    totalRevenue: sql<number>`coalesce(sum(${estimates.total}), 0)`,
    totalCosts: sql<number>`coalesce(sum(${jobCosts.totalCost}), 0)`,
  }).from(estimates)
  .leftJoin(jobs, eq(jobs.estimateId, estimates.id))
  .leftJoin(jobCosts, eq(jobCosts.jobId, jobs.id))
  .where(eq(estimates.orgId, orgId));
  
  const winRate = stats.totalEstimates > 0 ? (stats.approvedEstimates / stats.totalEstimates * 100) : 0;
  const profit = Number(stats.totalRevenue) - Number(stats.totalCosts);
  const margin = stats.totalRevenue > 0 ? (profit / stats.totalRevenue * 100) : 0;
  
  return c.json({ data: {
    ...stats,
    winRate: Math.round(winRate),
    profit: Math.round(profit),
    margin: Math.round(margin),
  }});
});

reportsApp.get('/win-rate-by-source', async (c) => {
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);
  
  const results = await db.select({
    source: leads.source,
    total: sql<number>`count(*)`,
    won: sql<number>`count(*) filter (where ${estimates.status} = 'accepted')`,
  }).from(leads)
  .leftJoin(estimates, eq(estimates.leadId, leads.id))
  .where(eq(leads.orgId, orgId))
  .groupBy(leads.source);
  
  const data = results.map(r => ({
    source: r.source || 'Unknown',
    total: Number(r.total),
    won: Number(r.won),
    winRate: r.total > 0 ? Math.round(Number(r.won) / Number(r.total) * 100) : 0,
  }));
  
  return c.json({ data });
});

reportsApp.get('/crew-performance', async (c) => {
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);
  
  const results = await db.select({
    memberId: teamMembers.id,
    name: teamMembers.name,
    totalHours: sql<number>`coalesce(sum(${timeEntries.hours}), 0)`,
    jobsWorked: sql<number>`count(distinct ${timeEntries.jobId})`,
    totalCost: sql<number>`coalesce(sum(${timeEntries.totalCost}), 0)`,
  }).from(teamMembers)
  .leftJoin(timeEntries, eq(timeEntries.teamMemberId, teamMembers.id))
  .where(eq(teamMembers.orgId, orgId))
  .groupBy(teamMembers.id, teamMembers.name)
  .orderBy(desc(sql`coalesce(sum(${timeEntries.hours}), 0)`));
  
  return c.json({ data: results });
});

reportsApp.get('/profit-margins', async (c) => {
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);
  
  const results = await db.select({
    jobId: jobs.id,
    title: jobs.name,
    revenue: jobs.budget,
    costs: sql<number>`coalesce(sum(${jobCosts.totalCost}), 0)`,
  }).from(jobs)
  .leftJoin(jobCosts, eq(jobCosts.jobId, jobs.id))
  .where(eq(jobs.orgId, orgId))
  .groupBy(jobs.id, jobs.name, jobs.budget)
  .orderBy(desc(jobs.createdAt))
  .limit(20);
  
  const data = results.map(r => {
    const revenue = Number(r.revenue || 0);
    const costs = Number(r.costs || 0);
    const profit = revenue - costs;
    return {
      ...r,
      revenue,
      costs,
      profit,
      margin: revenue > 0 ? Math.round(profit / revenue * 100) : 0,
    };
  });
  
  return c.json({ data });
});

export default reportsApp;
