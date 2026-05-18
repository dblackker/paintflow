import { Hono } from 'hono';
import { z } from 'zod';
import { createDb } from '@paintflow/db';
import { teamMembers, timeEntries, jobCosts } from '@paintflow/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';

const teamApp = new Hono<{ Bindings: Env; Variables: Variables }>();
teamApp.use('*', authMiddleware);

teamApp.get('/members', async (c) => {
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);
  
  const members = await db.query.teamMembers.findMany({
    where: and(eq(teamMembers.orgId, orgId), eq(teamMembers.isActive, true)),
    orderBy: (teamMembers, { desc }) => [desc(teamMembers.createdAt)],
  });
  
  return c.json({ data: members });
});

const createMemberSchema = z.object({
  name: z.string().min(1),
  role: z.string().min(1),
  hourlyRate: z.number().positive(),
  burdenRate: z.number().min(0).max(100).default(30),
});

teamApp.post('/members', async (c) => {
  const orgId = c.get('orgId');
  const body = await c.req.json();
  const data = createMemberSchema.parse(body);
  const db = createDb(c.env.DATABASE_URL);
  
  const [member] = await db.insert(teamMembers).values({
    orgId,
    name: data.name,
    role: data.role,
    hourlyRate: data.hourlyRate.toString(),
    burdenRate: data.burdenRate.toString(),
  }).returning();
  
  return c.json({ data: member }, 201);
});

const createTimeEntrySchema = z.object({
  jobId: z.string().uuid(),
  teamMemberId: z.string().uuid(),
  hours: z.number().positive(),
  date: z.string().datetime(),
  description: z.string().optional(),
});

teamApp.post('/time', async (c) => {
  const orgId = c.get('orgId');
  const body = await c.req.json();
  const data = createTimeEntrySchema.parse(body);
  const db = createDb(c.env.DATABASE_URL);
  
  const member = await db.query.teamMembers.findFirst({
    where: eq(teamMembers.id, data.teamMemberId),
  });
  
  if (!member) return c.json({ error: 'Team member not found' }, 404);
  
  const hourlyRate = parseFloat(member.hourlyRate);
  const burdenRate = parseFloat(member.burdenRate || '30');
  const burdenedRate = hourlyRate * (1 + burdenRate / 100);
  const totalCost = data.hours * burdenedRate;
  
  const [entry] = await db.insert(timeEntries).values({
    orgId,
    ...data,
    hourlyRate: burdenedRate.toString(),
    totalCost: totalCost.toString(),
    date: new Date(data.date),
  }).returning();
  
  // Also create job cost entry
  await db.insert(jobCosts).values({
    jobId: data.jobId,
    orgId,
    category: 'labor',
    description: `${member.name} - ${data.description || 'Labor'}`,
    quantity: data.hours.toString(),
    unitCost: burdenedRate.toString(),
    totalCost: totalCost.toString(),
  });
  
  return c.json({ data: entry }, 201);
});

teamApp.get('/time', async (c) => {
  const orgId = c.get('orgId');
  const jobId = c.req.query('jobId');
  const db = createDb(c.env.DATABASE_URL);
  
  const entries = await db.query.timeEntries.findMany({
    where: jobId 
      ? and(eq(timeEntries.orgId, orgId), eq(timeEntries.jobId, jobId))
      : eq(timeEntries.orgId, orgId),
    orderBy: (timeEntries, { desc }) => [desc(timeEntries.date)],
    limit: 100,
  });
  
  return c.json({ data: entries });
});

export default teamApp;
