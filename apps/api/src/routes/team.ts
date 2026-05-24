import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { createDb } from '@paintflow/db';
import { teamMembers, timeEntries, jobCosts, userRoles, memberships, jobs, users, orgSettings, timePunchSessions, timePunchEvents, leads } from '@paintflow/db/schema';
import { eq, and, desc, gte, inArray, lte } from 'drizzle-orm';
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
  const canViewTeam = await hasPermission(c, 'manage_team')
    || await hasPermission(c, 'log_time_for_others')
    || await hasPermission(c, 'view_all_time');

  if (!canViewTeam) {
    const resolved = await resolvePunchMember(c);
    if ('error' in resolved) return c.json({ data: [] });
    return c.json({ data: [resolved.member] });
  }
  
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

teamApp.get('/punch/status', async (c) => {
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);
  const settings = await getTimeClockSettings(c);
  const canManage = await hasPermission(c, 'log_time_for_others') || await hasPermission(c, 'view_all_time');
  const resolved = await resolvePunchMember(c, c.req.query('teamMemberId') || undefined);

  const [jobList, memberList] = await Promise.all([
    db.select({
      id: jobs.id,
      orgId: jobs.orgId,
      leadId: jobs.leadId,
      estimateId: jobs.estimateId,
      name: jobs.name,
      status: jobs.status,
      budget: jobs.budget,
      scheduledStartAt: jobs.scheduledStartAt,
      scheduledEndAt: jobs.scheduledEndAt,
      completedAt: jobs.completedAt,
      createdAt: jobs.createdAt,
      updatedAt: jobs.updatedAt,
      leadName: leads.name,
      leadPhone: leads.phone,
      leadEmail: leads.email,
      leadStreetAddress: leads.streetAddress,
      leadCity: leads.city,
      leadState: leads.state,
      leadPostalCode: leads.postalCode,
    })
      .from(jobs)
      .leftJoin(leads, and(eq(jobs.leadId, leads.id), eq(leads.orgId, orgId)))
      .where(and(eq(jobs.orgId, orgId), inArray(jobs.status, ['scheduled', 'in_progress'])))
      .orderBy(desc(jobs.createdAt)),
    canManage
      ? db.query.teamMembers.findMany({ where: and(eq(teamMembers.orgId, orgId), eq(teamMembers.isActive, true)) })
      : Promise.resolve([]),
  ]);

  let member = 'member' in resolved ? resolved.member : null;
  const activeSession = member ? await db.query.timePunchSessions.findFirst({
    where: and(
      eq(timePunchSessions.orgId, orgId),
      eq(timePunchSessions.teamMemberId, member.id),
      inArray(timePunchSessions.status, ['active', 'missed_clock_out']),
    ),
  }) : null;

  const reviewRows = canManage
    ? (await db.query.timePunchSessions.findMany({
        where: eq(timePunchSessions.orgId, orgId),
        orderBy: (timePunchSessions, { desc }) => [desc(timePunchSessions.updatedAt)],
        limit: 100,
      })).filter((row) => row.reviewRequired || ['missed_clock_out', 'manual_override'].includes(row.status))
    : [];

  const reviewMemberIds = Array.from(new Set(reviewRows.map((row) => row.teamMemberId)));
  const reviewJobIds = Array.from(new Set(reviewRows.map((row) => row.jobId).filter(Boolean)));
  const [reviewMembers, reviewJobs] = await Promise.all([
    reviewMemberIds.length ? db.query.teamMembers.findMany({ where: and(eq(teamMembers.orgId, orgId), inArray(teamMembers.id, reviewMemberIds)) }) : Promise.resolve([]),
    reviewJobIds.length ? db.query.jobs.findMany({ where: and(eq(jobs.orgId, orgId), inArray(jobs.id, reviewJobIds)) }) : Promise.resolve([]),
  ]);
  const membersById = new Map([...memberList, ...reviewMembers].map((item) => [item.id, item]));
  const jobsById = new Map([...jobList, ...reviewJobs].map((item) => [item.id, item]));

  return c.json({
    data: {
      settings,
      canManage,
      member,
      members: canManage ? memberList : [],
      jobs: jobList,
      activeSession: activeSession ? {
        ...activeSession,
        jobName: activeSession.jobId ? jobsById.get(activeSession.jobId)?.name || 'Job' : 'Unassigned job',
        teamMemberName: membersById.get(activeSession.teamMemberId)?.name || member?.name || 'Crew member',
      } : null,
      reviewQueue: reviewRows.map((row) => ({
        ...row,
        teamMemberName: membersById.get(row.teamMemberId)?.name || 'Crew member',
        jobName: row.jobId ? jobsById.get(row.jobId)?.name || 'Job' : 'Unassigned job',
        reviewLabel: reviewLabel(row.reviewReason),
      })),
      memberResolutionError: 'error' in resolved ? resolved.error : null,
    },
  });
});

teamApp.post('/punch/in', async (c) => {
  const orgId = c.get('orgId');
  const parsed = punchInSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const data = parsed.data;
  const resolved = await resolvePunchMember(c, data.teamMemberId);
  if ('error' in resolved) return c.json({ error: resolved.error }, resolved.status);

  const db = createDb(c.env.DATABASE_URL);
  const job = data.jobId
    ? await db.query.jobs.findFirst({ where: and(eq(jobs.id, data.jobId), eq(jobs.orgId, orgId)) })
    : null;
  if (data.jobId && !job) return c.json({ error: 'Job not found' }, 404);

  const existing = await db.query.timePunchSessions.findFirst({
    where: and(
      eq(timePunchSessions.orgId, orgId),
      eq(timePunchSessions.teamMemberId, resolved.member.id),
      inArray(timePunchSessions.status, ['active', 'missed_clock_out']),
    ),
  });
  if (existing) {
    return c.json({ error: 'This crew member is already punched in. Clock out or close the previous shift first.' }, 409);
  }

  const settings = await getTimeClockSettings(c);
  const startedAtActual = data.startedAt ? new Date(data.startedAt) : new Date();
  const now = new Date();
  const missingJob = !data.jobId;
  const reviewRequired = Boolean(data.forgotPunchIn || data.startedAt || missingJob);
  const reviewReason = missingJob ? 'missing_job_assignment' : reviewRequired ? 'forgot_clock_in' : null;
  if (startedAtActual.getTime() > now.getTime() + 60_000) {
    return c.json({ error: 'Clock-in time cannot be in the future' }, 400);
  }

  const [session] = await db.insert(timePunchSessions).values({
    orgId,
    jobId: data.jobId || null,
    teamMemberId: resolved.member.id,
    status: 'active',
    startedAtActual,
    startedAtRounded: roundToNearest(startedAtActual, settings.roundingIncrementMinutes),
    roundingIncrementMinutes: settings.roundingIncrementMinutes,
    startLatitude: decimal(data.latitude)!,
    startLongitude: decimal(data.longitude)!,
    startAccuracyMeters: meters(data.accuracyMeters),
    reviewRequired,
    reviewReason,
    crewNote: data.note,
    createdByUserId: c.get('userId'),
  }).returning();

  await insertPunchEvent(c, session.id, reviewRequired ? 'forgot_clock_in' : 'clock_in', data, {
    jobId: data.jobId,
    teamMemberId: resolved.member.id,
    note: data.note || (missingJob ? 'Crew did not select a job at clock-in; lead must assign the job.' : undefined),
  });

  return c.json({ data: session }, 201);
});

teamApp.post('/punch/out', async (c) => {
  const orgId = c.get('orgId');
  const parsed = punchOutSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const data = parsed.data;
  const resolved = await resolvePunchMember(c, data.teamMemberId);
  if ('error' in resolved) return c.json({ error: resolved.error }, resolved.status);

  const db = createDb(c.env.DATABASE_URL);
  const session = await db.query.timePunchSessions.findFirst({
    where: and(
      eq(timePunchSessions.orgId, orgId),
      eq(timePunchSessions.teamMemberId, resolved.member.id),
      inArray(timePunchSessions.status, ['active', 'missed_clock_out']),
    ),
  });
  if (!session) return c.json({ error: 'No active punch session found. Use forgot clock-in if this shift was not started.' }, 404);

  const settings = await getTimeClockSettings(c);
  const endedAtActual = data.endedAt ? new Date(data.endedAt) : new Date();
  if (endedAtActual <= session.startedAtActual) {
    return c.json({ error: 'Clock-out time must be after clock-in time' }, 400);
  }

  const elapsedActualHours = hoursBetween(session.startedAtActual, endedAtActual);
  const lateOverride = Boolean(data.endedAt || session.status === 'missed_clock_out');
  const longShift = elapsedActualHours > settings.maxShiftHours;
  const reviewRequired = session.reviewRequired || lateOverride || longShift;
  const reviewReason = session.reviewReason || (lateOverride ? 'late_clock_out' : longShift ? 'long_shift' : null);
  const roundedStart = session.startedAtRounded;
  const roundedEnd = roundToNearest(endedAtActual, session.roundingIncrementMinutes || settings.roundingIncrementMinutes);
  const roundedHours = Math.max(0.25, hoursBetween(roundedStart, roundedEnd));
  const burdenRate = parseFloat(resolved.member.burdenRate || '30');
  const baseRate = parseFloat(resolved.member.hourlyRate);
  const burdenedRate = baseRate * (1 + burdenRate / 100);
  const totalCost = roundedHours * burdenedRate;
  const description = data.note || data.overrideReason || 'Punch clock labor';

  const [entry] = await db.insert(timeEntries).values({
    orgId,
    jobId: session.jobId,
    teamMemberId: resolved.member.id,
    hours: roundedHours.toFixed(2),
    description,
    hourlyRate: burdenedRate.toFixed(2),
    totalCost: totalCost.toFixed(2),
    date: roundedStart,
    source: 'punch_clock',
    reviewStatus: reviewRequired ? 'flagged' : 'approved',
    reviewReason,
    actualStartAt: session.startedAtActual,
    actualEndAt: endedAtActual,
    roundedStartAt: roundedStart,
    roundedEndAt: roundedEnd,
    startLatitude: session.startLatitude,
    startLongitude: session.startLongitude,
    startAccuracyMeters: session.startAccuracyMeters,
    endLatitude: decimal(data.latitude),
    endLongitude: decimal(data.longitude),
    endAccuracyMeters: meters(data.accuracyMeters),
  }).returning();

  await createLaborCostForEntry(db, orgId, session.jobId, resolved.member.name, description, roundedHours, burdenedRate, totalCost);

  const [updated] = await db.update(timePunchSessions)
    .set({
      timeEntryId: entry.id,
      status: reviewRequired ? 'manual_override' : 'completed',
      endedAtActual,
      endedAtRounded: roundedEnd,
      endLatitude: decimal(data.latitude),
      endLongitude: decimal(data.longitude),
      endAccuracyMeters: meters(data.accuracyMeters),
      reviewRequired,
      reviewReason,
      crewNote: data.note || data.overrideReason || session.crewNote,
      updatedAt: new Date(),
    })
    .where(and(eq(timePunchSessions.id, session.id), eq(timePunchSessions.orgId, orgId)))
    .returning();

  await insertPunchEvent(c, session.id, reviewRequired ? 'manual_clock_out' : 'clock_out', data, {
    timeEntryId: entry.id,
    endedAt: endedAtActual.toISOString(),
    overrideReason: data.overrideReason,
  });

  return c.json({ data: { session: updated, entry } });
});

teamApp.post('/punch/switch-job', async (c) => {
  const orgId = c.get('orgId');
  const parsed = switchJobSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const data = parsed.data;
  const resolved = await resolvePunchMember(c, data.teamMemberId);
  if ('error' in resolved) return c.json({ error: resolved.error }, resolved.status);

  const db = createDb(c.env.DATABASE_URL);
  const nextJob = await db.query.jobs.findFirst({ where: and(eq(jobs.id, data.jobId), eq(jobs.orgId, orgId)) });
  if (!nextJob) return c.json({ error: 'Job not found' }, 404);

  const session = await db.query.timePunchSessions.findFirst({
    where: and(
      eq(timePunchSessions.orgId, orgId),
      eq(timePunchSessions.teamMemberId, resolved.member.id),
      inArray(timePunchSessions.status, ['active', 'missed_clock_out']),
    ),
  });
  if (!session) return c.json({ error: 'No active punch session found' }, 404);
  if (session.jobId === data.jobId) return c.json({ error: 'Select a different job before switching' }, 400);

  const settings = await getTimeClockSettings(c);
  const switchedAt = new Date();
  if (switchedAt <= session.startedAtActual) {
    return c.json({ error: 'Switch time must be after clock-in time' }, 400);
  }

  const elapsedActualHours = hoursBetween(session.startedAtActual, switchedAt);
  const longShift = elapsedActualHours > settings.maxShiftHours;
  const reviewRequired = session.reviewRequired || longShift || !session.jobId;
  const reviewReason = session.reviewReason || (longShift ? 'long_shift' : !session.jobId ? 'missing_job_assignment' : null);
  const roundedStart = session.startedAtRounded;
  const roundedEnd = roundToNearest(switchedAt, session.roundingIncrementMinutes || settings.roundingIncrementMinutes);
  const roundedHours = Math.max(0.25, hoursBetween(roundedStart, roundedEnd));
  const burdenRate = parseFloat(resolved.member.burdenRate || '30');
  const baseRate = parseFloat(resolved.member.hourlyRate);
  const burdenedRate = baseRate * (1 + burdenRate / 100);
  const totalCost = roundedHours * burdenedRate;
  const description = data.note || 'Punch clock labor';

  const [entry] = await db.insert(timeEntries).values({
    orgId,
    jobId: session.jobId,
    teamMemberId: resolved.member.id,
    hours: roundedHours.toFixed(2),
    description,
    hourlyRate: burdenedRate.toFixed(2),
    totalCost: totalCost.toFixed(2),
    date: roundedStart,
    source: 'punch_clock',
    reviewStatus: reviewRequired ? 'flagged' : 'approved',
    reviewReason,
    actualStartAt: session.startedAtActual,
    actualEndAt: switchedAt,
    roundedStartAt: roundedStart,
    roundedEndAt: roundedEnd,
    startLatitude: session.startLatitude,
    startLongitude: session.startLongitude,
    startAccuracyMeters: session.startAccuracyMeters,
    endLatitude: decimal(data.latitude),
    endLongitude: decimal(data.longitude),
    endAccuracyMeters: meters(data.accuracyMeters),
  }).returning();

  await createLaborCostForEntry(db, orgId, session.jobId, resolved.member.name, description, roundedHours, burdenedRate, totalCost);

  await db.update(timePunchSessions)
    .set({
      timeEntryId: entry.id,
      status: reviewRequired ? 'manual_override' : 'switched',
      endedAtActual: switchedAt,
      endedAtRounded: roundedEnd,
      endLatitude: decimal(data.latitude),
      endLongitude: decimal(data.longitude),
      endAccuracyMeters: meters(data.accuracyMeters),
      reviewRequired,
      reviewReason,
      crewNote: data.note || session.crewNote,
      updatedAt: new Date(),
    })
    .where(and(eq(timePunchSessions.id, session.id), eq(timePunchSessions.orgId, orgId)));

  await insertPunchEvent(c, session.id, reviewRequired ? 'manual_job_switch' : 'job_switch', data, {
    timeEntryId: entry.id,
    fromJobId: session.jobId,
    toJobId: data.jobId,
  });

  const [nextSession] = await db.insert(timePunchSessions).values({
    orgId,
    jobId: data.jobId,
    teamMemberId: resolved.member.id,
    status: 'active',
    startedAtActual: switchedAt,
    startedAtRounded: roundedEnd,
    roundingIncrementMinutes: session.roundingIncrementMinutes || settings.roundingIncrementMinutes,
    startLatitude: decimal(data.latitude)!,
    startLongitude: decimal(data.longitude)!,
    startAccuracyMeters: meters(data.accuracyMeters),
    createdByUserId: c.get('userId'),
  }).returning();

  await insertPunchEvent(c, nextSession.id, 'clock_in', data, {
    jobId: data.jobId,
    teamMemberId: resolved.member.id,
    switchedFromJobId: session.jobId,
  });

  return c.json({ data: { closedSessionId: session.id, session: nextSession, entry } });
});

teamApp.patch('/punch/review/:id', async (c) => {
  if (!await hasPermission(c, 'view_all_time') && !await hasPermission(c, 'log_time_for_others')) {
    return c.json({ error: 'Cannot review crew time' }, 403);
  }
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  const parsed = reviewPunchSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }
  const db = createDb(c.env.DATABASE_URL);
  const session = await db.query.timePunchSessions.findFirst({
    where: and(eq(timePunchSessions.id, id), eq(timePunchSessions.orgId, orgId)),
  });
  if (!session) return c.json({ error: 'Punch session not found' }, 404);
  const assignedJobId = parsed.data.jobId || session.jobId;
  if (assignedJobId) {
    const job = await db.query.jobs.findFirst({ where: and(eq(jobs.id, assignedJobId), eq(jobs.orgId, orgId)) });
    if (!job) return c.json({ error: 'Job not found' }, 404);
  }
  if (parsed.data.reviewStatus === 'approved' && !assignedJobId) {
    return c.json({ error: 'Assign a job before approving this punch' }, 400);
  }
  if (parsed.data.reviewStatus === 'approved' && !session.endedAtActual) {
    return c.json({ error: 'Crew member must clock out before this punch can be approved' }, 400);
  }

  const [updated] = await db.update(timePunchSessions)
    .set({
      jobId: assignedJobId,
      reviewRequired: false,
      status: parsed.data.reviewStatus === 'approved' ? 'completed' : 'rejected',
      crewNote: parsed.data.note || session.crewNote,
      updatedAt: new Date(),
    })
    .where(and(eq(timePunchSessions.id, id), eq(timePunchSessions.orgId, orgId)))
    .returning();

  if (session.timeEntryId) {
    const existingEntry = await db.query.timeEntries.findFirst({
      where: and(eq(timeEntries.id, session.timeEntryId), eq(timeEntries.orgId, orgId)),
    });
    await db.update(timeEntries)
      .set({
        jobId: assignedJobId,
        reviewStatus: parsed.data.reviewStatus,
        reviewReason: parsed.data.note || session.reviewReason,
      })
      .where(and(eq(timeEntries.id, session.timeEntryId), eq(timeEntries.orgId, orgId)));

    if (parsed.data.reviewStatus === 'approved' && assignedJobId && existingEntry && !existingEntry.jobId) {
      const member = await db.query.teamMembers.findFirst({
        where: and(eq(teamMembers.id, existingEntry.teamMemberId), eq(teamMembers.orgId, orgId)),
      });
      await createLaborCostForEntry(
        db,
        orgId,
        assignedJobId,
        member?.name || 'Crew member',
        existingEntry.description || 'Punch clock labor',
        Number(existingEntry.hours || 0),
        Number(existingEntry.hourlyRate || 0),
        Number(existingEntry.totalCost || 0),
      );
    }
  }

  await insertPunchEvent(c, id, parsed.data.reviewStatus === 'approved' ? 'approved' : 'rejected', undefined, {
    note: parsed.data.note,
    jobId: assignedJobId,
  });

  return c.json({ data: updated });
});

const createTimeEntrySchema = z.object({
  jobId: z.string().uuid(),
  teamMemberId: z.string().uuid(),
  hours: z.coerce.number().positive(),
  date: z.string().datetime(),
  description: z.string().optional(),
});

const updateTimeEntrySchema = z.object({
  jobId: z.string().uuid().optional(),
  teamMemberId: z.string().uuid().optional(),
  hours: z.coerce.number().positive().max(24).optional(),
  date: z.string().datetime().optional(),
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

const locationSchema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  accuracyMeters: z.coerce.number().min(0).max(10000).optional(),
});

const punchInSchema = locationSchema.extend({
  jobId: z.string().uuid().optional().nullable(),
  teamMemberId: z.string().uuid().optional(),
  startedAt: z.string().datetime().optional(),
  note: z.string().trim().max(500).optional(),
  forgotPunchIn: z.boolean().optional(),
});

const punchOutSchema = locationSchema.extend({
  teamMemberId: z.string().uuid().optional(),
  endedAt: z.string().datetime().optional(),
  note: z.string().trim().max(500).optional(),
  overrideReason: z.string().trim().max(500).optional(),
});

const switchJobSchema = locationSchema.extend({
  jobId: z.string().uuid(),
  teamMemberId: z.string().uuid().optional(),
  note: z.string().trim().max(500).optional(),
});

const reviewPunchSchema = z.object({
  reviewStatus: z.enum(['approved', 'rejected']),
  jobId: z.string().uuid().optional().nullable(),
  note: z.string().trim().max(500).optional(),
});

type TimeClockSettings = {
  roundingIncrementMinutes: number;
  maxShiftHours: number;
  reminderWindowStartHour: number;
  reminderWindowEndHour: number;
};

const defaultTimeClockSettings: TimeClockSettings = {
  roundingIncrementMinutes: 15,
  maxShiftHours: 12,
  reminderWindowStartHour: 18,
  reminderWindowEndHour: 22,
};

function parseTimecardDate(value: string) {
  return new Date(value.includes('T') ? value : `${value}T12:00:00`);
}

function readObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeTimeClockSettings(value: unknown): TimeClockSettings {
  const raw = readObject(value);
  const timeClock = readObject(raw.timeClock);
  const increment = Number(timeClock.roundingIncrementMinutes);
  const maxShift = Number(timeClock.maxShiftHours);
  const start = Number(timeClock.reminderWindowStartHour);
  const end = Number(timeClock.reminderWindowEndHour);
  return {
    roundingIncrementMinutes: [1, 5, 6, 15].includes(increment) ? increment : defaultTimeClockSettings.roundingIncrementMinutes,
    maxShiftHours: maxShift >= 4 && maxShift <= 24 ? maxShift : defaultTimeClockSettings.maxShiftHours,
    reminderWindowStartHour: start >= 0 && start <= 23 ? start : defaultTimeClockSettings.reminderWindowStartHour,
    reminderWindowEndHour: end >= 1 && end <= 24 ? end : defaultTimeClockSettings.reminderWindowEndHour,
  };
}

async function getTimeClockSettings(c: Context<{ Bindings: Env; Variables: Variables }>) {
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);
  const settings = await db.query.orgSettings.findFirst({
    where: eq(orgSettings.orgId, orgId),
  });
  return normalizeTimeClockSettings(settings?.businessHours);
}

function roundToNearest(date: Date, incrementMinutes: number) {
  const incrementMs = incrementMinutes * 60 * 1000;
  return new Date(Math.round(date.getTime() / incrementMs) * incrementMs);
}

function hoursBetween(start: Date, end: Date) {
  return Math.max(0, (end.getTime() - start.getTime()) / 36e5);
}

function decimal(value: number | undefined) {
  return value === undefined ? undefined : value.toFixed(7);
}

function meters(value: number | undefined) {
  return value === undefined ? undefined : value.toFixed(2);
}

function reviewLabel(reason?: string | null) {
  const labels: Record<string, string> = {
    forgot_clock_in: 'Forgot clock-in',
    late_clock_out: 'Late clock-out',
    long_shift: 'Long shift',
    missing_job_assignment: 'Missing job assignment',
  };
  return (reason && labels[reason]) || 'Review required';
}

async function resolvePunchMember(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  requestedTeamMemberId?: string,
) {
  const db = createDb(c.env.DATABASE_URL);
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const canLogForOthers = await hasPermission(c, 'log_time_for_others');
  const canViewAll = await hasPermission(c, 'view_all_time');

  if (requestedTeamMemberId) {
    if (!canLogForOthers && !canViewAll) {
      return { error: 'Cannot punch time for other team members' as const, status: 403 as const };
    }
    const member = await db.query.teamMembers.findFirst({
      where: and(eq(teamMembers.id, requestedTeamMemberId), eq(teamMembers.orgId, orgId)),
    });
    if (!member) return { error: 'Team member not found' as const, status: 404 as const };
    if (member.isActive === false) return { error: 'Team member is deactivated' as const, status: 409 as const };
    return { member, canManage: true };
  }

  let member = userId
    ? await db.query.teamMembers.findFirst({ where: and(eq(teamMembers.userId, userId), eq(teamMembers.orgId, orgId)) })
    : null;
  if (!member && userId) {
    const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
    if (user?.email) {
      member = await db.query.teamMembers.findFirst({ where: and(eq(teamMembers.email, user.email), eq(teamMembers.orgId, orgId)) });
    }
  }
  if (!member && (canLogForOthers || canViewAll)) {
    member = await db.query.teamMembers.findFirst({
      where: and(eq(teamMembers.orgId, orgId), eq(teamMembers.isActive, true)),
      orderBy: (teamMembers, { desc }) => [desc(teamMembers.createdAt)],
    });
  }
  if (!member) return { error: 'No active crew member is linked to your login' as const, status: 404 as const };
  if (member.isActive === false) return { error: 'Team member is deactivated' as const, status: 409 as const };
  return { member, canManage: canLogForOthers || canViewAll };
}

async function insertPunchEvent(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  sessionId: string,
  eventType: string,
  location?: { latitude?: number; longitude?: number; accuracyMeters?: number },
  metadata?: Record<string, unknown>,
) {
  const db = createDb(c.env.DATABASE_URL);
  await db.insert(timePunchEvents).values({
    orgId: c.get('orgId'),
    punchSessionId: sessionId,
    eventType,
    actorUserId: c.get('userId'),
    latitude: decimal(location?.latitude),
    longitude: decimal(location?.longitude),
    accuracyMeters: meters(location?.accuracyMeters),
    metadata,
  });
}

async function createLaborCostForEntry(
  db: ReturnType<typeof createDb>,
  orgId: string,
  jobId: string | null,
  memberName: string,
  description: string,
  hours: number,
  burdenedRate: number,
  totalCost: number,
) {
  if (!jobId) return;
  await db.insert(jobCosts).values({
    jobId,
    orgId,
    category: 'labor',
    description: `${memberName} - ${description}`,
    quantity: hours.toFixed(2),
    unitCost: burdenedRate.toFixed(2),
    totalCost: totalCost.toFixed(2),
  });
}

async function assertCanModifyTimeEntry(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  entry: typeof timeEntries.$inferSelect,
) {
  const userId = c.get('userId');
  const canLogForOthers = await hasPermission(c, 'log_time_for_others');
  if (canLogForOthers) return true;

  const db = createDb(c.env.DATABASE_URL);
  const member = await db.query.teamMembers.findFirst({
    where: and(eq(teamMembers.id, entry.teamMemberId), eq(teamMembers.orgId, entry.orgId)),
  });

  return member?.userId === userId;
}

function laborCostAdjustmentRow(
  orgId: string,
  jobId: string,
  description: string,
  hours: number,
  hourlyRate: number,
  totalCost: number,
) {
  return {
    orgId,
    jobId,
    category: 'labor',
    description,
    quantity: hours.toFixed(2),
    unitCost: hourlyRate.toFixed(2),
    totalCost: totalCost.toFixed(2),
  };
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
  if (member.isActive === false) {
    return c.json({ error: 'Team member is deactivated and cannot receive new time entries' }, 409);
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
    jobId: data.jobId || null,
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
  const jobId = c.req.query('jobId');
  const db = createDb(c.env.DATABASE_URL);
  
  const canViewAll = await hasPermission(c, 'view_all_time');
  
  let where;
  if (!canViewAll) {
    const resolved = await resolvePunchMember(c);
    if ('error' in resolved) return c.json({ data: [] });
    where = jobId
      ? and(eq(timeEntries.orgId, orgId), eq(timeEntries.teamMemberId, resolved.member.id), eq(timeEntries.jobId, jobId))
      : and(eq(timeEntries.orgId, orgId), eq(timeEntries.teamMemberId, resolved.member.id));
  } else if (jobId) {
    where = and(eq(timeEntries.orgId, orgId), eq(timeEntries.jobId, jobId));
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
      jobName: entry.jobId ? jobsById.get(entry.jobId)?.name ?? 'Job' : 'Unassigned job',
    })),
  });
});

teamApp.get('/time/map', async (c) => {
  const orgId = c.get('orgId');
  const canViewMap = await hasPermission(c, 'view_all_time') || await hasPermission(c, 'log_time_for_others');
  if (!canViewMap) return c.json({ error: 'Cannot view crew location history' }, 403);

  const start = new Date(c.req.query('start') || '');
  const end = new Date(c.req.query('end') || '');
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return c.json({ error: 'Valid start and end query parameters are required' }, 400);
  }

  const db = createDb(c.env.DATABASE_URL);
  const events = await db.query.timePunchEvents.findMany({
    where: and(
      eq(timePunchEvents.orgId, orgId),
      gte(timePunchEvents.occurredAt, start),
      lte(timePunchEvents.occurredAt, end),
    ),
    orderBy: (timePunchEvents, { asc }) => [asc(timePunchEvents.occurredAt)],
  });

  const locatedEvents = events.filter((event) => event.latitude && event.longitude);
  if (!locatedEvents.length) {
    return c.json({ data: { events: [], summary: { clockIns: 0, clockOuts: 0, employees: 0, jobs: 0 } } });
  }

  const sessionIds = Array.from(new Set(locatedEvents.map((event) => event.punchSessionId)));
  const sessions = await db.query.timePunchSessions.findMany({
    where: and(eq(timePunchSessions.orgId, orgId), inArray(timePunchSessions.id, sessionIds)),
  });
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  const memberIds = Array.from(new Set(sessions.map((session) => session.teamMemberId).filter(Boolean)));
  const jobIds = Array.from(new Set(sessions.map((session) => session.jobId).filter(Boolean))) as string[];

  const [members, jobList] = await Promise.all([
    memberIds.length
      ? db.query.teamMembers.findMany({ where: and(eq(teamMembers.orgId, orgId), inArray(teamMembers.id, memberIds)) })
      : Promise.resolve([]),
    jobIds.length
      ? db.query.jobs.findMany({ where: and(eq(jobs.orgId, orgId), inArray(jobs.id, jobIds)) })
      : Promise.resolve([]),
  ]);

  const leadIds = Array.from(new Set(jobList.map((job) => job.leadId)));
  const leadList = leadIds.length
    ? await db.query.leads.findMany({ where: and(eq(leads.orgId, orgId), inArray(leads.id, leadIds)) })
    : [];
  const membersById = new Map(members.map((member) => [member.id, member]));
  const jobsById = new Map(jobList.map((job) => [job.id, job]));
  const leadsById = new Map(leadList.map((lead) => [lead.id, lead]));
  const employeeSet = new Set<string>();
  const jobSet = new Set<string>();
  let clockIns = 0;
  let clockOuts = 0;

  const data = locatedEvents.map((event) => {
    const session = sessionsById.get(event.punchSessionId);
    const member = session ? membersById.get(session.teamMemberId) : undefined;
    const job = session?.jobId ? jobsById.get(session.jobId) : undefined;
    const lead = job ? leadsById.get(job.leadId) : undefined;
    if (member?.id) employeeSet.add(member.id);
    if (job?.id) jobSet.add(job.id);
    if (event.eventType.includes('clock_in')) clockIns += 1;
    if (event.eventType.includes('clock_out')) clockOuts += 1;
    return {
      id: event.id,
      type: event.eventType,
      occurredAt: event.occurredAt,
      latitude: Number(event.latitude),
      longitude: Number(event.longitude),
      accuracyMeters: event.accuracyMeters ? Number(event.accuracyMeters) : null,
      teamMemberId: member?.id || session?.teamMemberId || null,
      teamMemberName: member?.name || 'Crew member',
      jobId: job?.id || session?.jobId || null,
      jobName: job?.name || 'Unassigned job',
      address: lead ? {
        streetAddress: lead.streetAddress,
        city: lead.city,
        state: lead.state,
        postalCode: lead.postalCode,
      } : null,
      reviewRequired: Boolean(session?.reviewRequired),
      reviewReason: session?.reviewReason || null,
    };
  });

  return c.json({
    data: {
      events: data,
      summary: {
        clockIns,
        clockOuts,
        employees: employeeSet.size,
        jobs: jobSet.size,
      },
    },
  });
});

teamApp.patch('/time/:id', async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  const parsed = updateTimeEntrySchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const db = createDb(c.env.DATABASE_URL);
  const existing = await db.query.timeEntries.findFirst({
    where: and(eq(timeEntries.id, id), eq(timeEntries.orgId, orgId)),
  });
  if (!existing) {
    return c.json({ error: 'Time entry not found' }, 404);
  }
  if (!await assertCanModifyTimeEntry(c, existing)) {
    return c.json({ error: 'Cannot edit this time entry' }, 403);
  }

  const data = parsed.data;
  const jobId = data.jobId ?? existing.jobId;
  const teamMemberId = data.teamMemberId || existing.teamMemberId;
  const hours = data.hours ?? Number(existing.hours);

  if (!jobId) {
    return c.json({ error: 'Assign a job before approving this time entry' }, 400);
  }

  const [job, member] = await Promise.all([
    db.query.jobs.findFirst({ where: and(eq(jobs.id, jobId), eq(jobs.orgId, orgId)) }),
    db.query.teamMembers.findFirst({ where: and(eq(teamMembers.id, teamMemberId), eq(teamMembers.orgId, orgId)) }),
  ]);
  if (!job) return c.json({ error: 'Job not found' }, 404);
  if (!member) return c.json({ error: 'Team member not found' }, 404);
  if (data.teamMemberId && data.teamMemberId !== existing.teamMemberId && member.isActive === false) {
    return c.json({ error: 'Team member is deactivated and cannot receive new time entries' }, 409);
  }

  const baseRate = parseFloat(member.hourlyRate);
  const burdenRate = parseFloat(member.burdenRate || '30');
  const burdenedRate = baseRate * (1 + burdenRate / 100);
  const totalCost = hours * burdenedRate;
  const oldTotalCost = Number(existing.totalCost);
  const oldHourlyRate = Number(existing.hourlyRate);
  const oldHours = Number(existing.hours);

  const [entry] = await db.update(timeEntries)
    .set({
      jobId,
      teamMemberId,
      hours: hours.toFixed(2),
      description: data.description ?? existing.description,
      hourlyRate: burdenedRate.toFixed(2),
      totalCost: totalCost.toFixed(2),
      date: data.date ? new Date(data.date) : existing.date,
    })
    .where(and(eq(timeEntries.id, id), eq(timeEntries.orgId, orgId)))
    .returning();

  if (existing.jobId !== jobId) {
    const adjustments = [
      existing.jobId ? laborCostAdjustmentRow(orgId, existing.jobId, 'Time entry moved out', -oldHours, oldHourlyRate, -oldTotalCost) : null,
      laborCostAdjustmentRow(orgId, jobId, `Time entry moved in - ${member.name}`, hours, burdenedRate, totalCost),
    ].filter(Boolean);
    if (adjustments.length) await db.insert(jobCosts).values(adjustments);
  } else {
    const delta = totalCost - oldTotalCost;
    if (Math.abs(delta) >= 0.01) {
      const deltaHours = burdenedRate ? delta / burdenedRate : 0;
      await db.insert(jobCosts).values(
        laborCostAdjustmentRow(orgId, jobId, `Time entry adjusted - ${member.name}`, deltaHours, burdenedRate, delta),
      );
    }
  }

  return c.json({ data: entry });
});

teamApp.delete('/time/:id', async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  const db = createDb(c.env.DATABASE_URL);
  const existing = await db.query.timeEntries.findFirst({
    where: and(eq(timeEntries.id, id), eq(timeEntries.orgId, orgId)),
  });
  if (!existing) {
    return c.json({ error: 'Time entry not found' }, 404);
  }
  if (!await assertCanModifyTimeEntry(c, existing)) {
    return c.json({ error: 'Cannot remove this time entry' }, 403);
  }

  const member = await db.query.teamMembers.findFirst({
    where: and(eq(teamMembers.id, existing.teamMemberId), eq(teamMembers.orgId, orgId)),
  });

  await db.delete(timeEntries).where(and(eq(timeEntries.id, id), eq(timeEntries.orgId, orgId)));
  if (existing.jobId) {
    await db.insert(jobCosts).values(
      laborCostAdjustmentRow(
        orgId,
        existing.jobId,
        `Time entry removed - ${member?.name || 'Crew member'}`,
        -Number(existing.hours),
        Number(existing.hourlyRate),
        -Number(existing.totalCost),
      ),
    );
  }

  return c.json({ success: true });
});

export default teamApp;
