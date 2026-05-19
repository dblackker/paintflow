import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { createDb } from '@paintflow/db';
import { teamMembers, timeEntries, jobCosts, userRoles, memberships, jobs } from '@paintflow/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';

const teamApp = new Hono<{ Bindings: Env; Variables: Variables }>();
teamApp.use('*', authMiddleware);

async function hasPermission(c: Context<{ Bindings: Env; Variables: Variables }>, permission: string) {
  const userId = c.get('userId');
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);

  const membership = await db.query.memberships.findFirst({
    where: and(eq(memberships.userId, userId), eq(memberships.orgId, orgId)),
  });

  if (membership?.role === 'owner') return true;
  
  const userRole = await db.query.userRoles.findFirst({
    where: and(eq(userRoles.userId, userId), eq(userRoles.orgId, orgId)),
    with: { role: true },
  });
  
  if (!userRole) return false;
  const permissions = userRole.role.permissions as string[];
  return permissions.includes(permission) || permissions.includes('all');
}

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
  hourlyRate: z.coerce.number().positive(),
  burdenRate: z.coerce.number().min(0).max(100).default(30),
  email: z.string().email().optional(),
});

teamApp.post('/members', async (c) => {
  if (!await hasPermission(c, 'manage_team')) {
    return c.json({ error: 'Insufficient permissions' }, 403);
  }
  
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
    email: data.email,
  }).returning();
  
  return c.json({ data: member }, 201);
});

const createTimeEntrySchema = z.object({
  jobId: z.string().uuid(),
  teamMemberId: z.string().uuid(),
  hours: z.coerce.number().positive(),
  date: z.string().datetime(),
  description: z.string().optional(),
});

const createTimecardSchema = z.object({
  jobId: z.string().uuid(),
  date: z.string().min(1),
  notes: z.string().trim().max(500).optional(),
  entries: z.array(z.object({
    teamMemberId: z.string().uuid(),
    hours: z.coerce.number().positive().max(24),
    description: z.string().trim().max(255).optional(),
  })).min(1).max(50),
});

function parseTimecardDate(value: string) {
  return new Date(value.includes('T') ? value : `${value}T12:00:00`);
}

teamApp.post('/time', async (c) => {
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const body = await c.req.json();
  const data = createTimeEntrySchema.parse(body);
  const db = createDb(c.env.DATABASE_URL);
  
  const member = await db.query.teamMembers.findFirst({
    where: eq(teamMembers.id, data.teamMemberId),
  });
  
  if (!member || member.orgId !== orgId) {
    return c.json({ error: 'Team member not found' }, 404);
  }

  const job = await db.query.jobs.findFirst({
    where: and(eq(jobs.id, data.jobId), eq(jobs.orgId, orgId)),
  });

  if (!job) {
    return c.json({ error: 'Job not found' }, 404);
  }
  
  // Check permission: can log for self or has log_time_for_others permission
  const canLogForOthers = await hasPermission(c, 'log_time_for_others');
  if (member.userId !== userId && !canLogForOthers) {
    return c.json({ error: 'Cannot log time for other team members' }, 403);
  }
  
  const hourlyRate = parseFloat(member.hourlyRate);
  const burdenRate = parseFloat(member.burdenRate || '30');
  const burdenedRate = hourlyRate * (1 + burdenRate / 100);
  const totalCost = data.hours * burdenedRate;
  
  const [entry] = await db.insert(timeEntries).values({
    orgId,
    jobId: data.jobId,
    teamMemberId: data.teamMemberId,
    hours: data.hours.toString(),
    description: data.description,
    hourlyRate: burdenedRate.toString(),
    totalCost: totalCost.toString(),
    date: new Date(data.date),
  }).returning();
  
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

teamApp.post('/timecards', async (c) => {
  if (!await hasPermission(c, 'log_time_for_others')) {
    return c.json({ error: 'Cannot create crew timecards' }, 403);
  }

  const orgId = c.get('orgId');
  const parsed = createTimecardSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const data = parsed.data;
  const db = createDb(c.env.DATABASE_URL);
  const job = await db.query.jobs.findFirst({
    where: and(eq(jobs.id, data.jobId), eq(jobs.orgId, orgId)),
  });

  if (!job) {
    return c.json({ error: 'Job not found' }, 404);
  }

  const members = await db.query.teamMembers.findMany({
    where: and(eq(teamMembers.orgId, orgId), eq(teamMembers.isActive, true)),
  });
  const membersById = new Map(members.map((member) => [member.id, member]));
  const missingMember = data.entries.find((entry) => !membersById.has(entry.teamMemberId));
  if (missingMember) {
    return c.json({ error: 'One or more team members were not found' }, 404);
  }

  const date = parseTimecardDate(data.date);
  const timeRows = data.entries.map((entry) => {
    const member = membersById.get(entry.teamMemberId)!;
    const baseRate = parseFloat(member.hourlyRate);
    const burdenRate = parseFloat(member.burdenRate || '30');
    const burdenedRate = baseRate * (1 + burdenRate / 100);
    const totalCost = entry.hours * burdenedRate;
    return {
      orgId,
      jobId: data.jobId,
      teamMemberId: entry.teamMemberId,
      hours: entry.hours.toFixed(2),
      description: entry.description || data.notes || 'Crew labor',
      hourlyRate: burdenedRate.toFixed(2),
      totalCost: totalCost.toFixed(2),
      date,
    };
  });

  const inserted = await db.insert(timeEntries).values(timeRows).returning();
  await db.insert(jobCosts).values(timeRows.map((row) => {
    const member = membersById.get(row.teamMemberId)!;
    return {
      jobId: data.jobId,
      orgId,
      category: 'labor',
      description: `${member.name} - ${row.description}`,
      quantity: row.hours,
      unitCost: row.hourlyRate,
      totalCost: row.totalCost,
    };
  }));

  return c.json({
    data: {
      entries: inserted,
      totalHours: data.entries.reduce((sum, entry) => sum + entry.hours, 0),
      totalCost: timeRows.reduce((sum, row) => sum + Number(row.totalCost), 0),
    },
  }, 201);
});

teamApp.get('/time', async (c) => {
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const jobId = c.req.query('jobId');
  const db = createDb(c.env.DATABASE_URL);
  
  const canViewAll = await hasPermission(c, 'view_all_time');
  
  let where;
  if (jobId) {
    where = and(eq(timeEntries.orgId, orgId), eq(timeEntries.jobId, jobId));
  } else if (!canViewAll) {
    // Only show own time entries
    const member = await db.query.teamMembers.findFirst({
      where: and(eq(teamMembers.userId, userId), eq(teamMembers.orgId, orgId)),
    });
    if (member) {
      where = and(eq(timeEntries.orgId, orgId), eq(timeEntries.teamMemberId, member.id));
    } else {
      return c.json({ data: [] });
    }
  } else {
    where = eq(timeEntries.orgId, orgId);
  }
  
  const entries = await db.query.timeEntries.findMany({
    where,
    orderBy: (timeEntries, { desc }) => [desc(timeEntries.date)],
    limit: 100,
  });
  
  const [members, jobList] = await Promise.all([
    db.query.teamMembers.findMany({ where: eq(teamMembers.orgId, orgId) }),
    db.query.jobs.findMany({ where: eq(jobs.orgId, orgId) }),
  ]);
  const membersById = new Map(members.map((member) => [member.id, member]));
  const jobsById = new Map(jobList.map((job) => [job.id, job]));

  return c.json({
    data: entries.map((entry) => ({
      ...entry,
      teamMemberName: membersById.get(entry.teamMemberId)?.name ?? 'Crew member',
      jobName: jobsById.get(entry.jobId)?.name ?? 'Job',
    })),
  });
});

export default teamApp;
