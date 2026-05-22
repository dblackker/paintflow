import { createDb } from '@paintflow/db';
import { notificationEvents, orgSettings, teamMembers, timePunchEvents, timePunchSessions } from '@paintflow/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import type { Env } from '../types';
import { sendEmail } from '../lib/email';

type TimeClockSettings = {
  maxShiftHours: number;
  reminderWindowStartHour: number;
  reminderWindowEndHour: number;
};

function readObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function timeClockSettings(value: unknown): TimeClockSettings {
  const raw = readObject(readObject(value).timeClock);
  const maxShift = Number(raw.maxShiftHours);
  const start = Number(raw.reminderWindowStartHour);
  const end = Number(raw.reminderWindowEndHour);
  return {
    maxShiftHours: maxShift >= 4 && maxShift <= 24 ? maxShift : 12,
    reminderWindowStartHour: start >= 0 && start <= 23 ? start : 18,
    reminderWindowEndHour: end >= 1 && end <= 24 ? end : 22,
  };
}

function losAngelesHour(date = new Date()) {
  const hour = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    hour12: false,
    timeZone: 'America/Los_Angeles',
  }).format(date);
  return Number(hour);
}

function isWithinReminderWindow(settings: TimeClockSettings, date = new Date()) {
  const hour = losAngelesHour(date);
  return hour >= settings.reminderWindowStartHour && hour < settings.reminderWindowEndHour;
}

function missedPunchEmail(name: string, hours: number, publicUrl: string) {
  const safeName = name.replace(/[&<>"']/g, '');
  return `
    <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;padding:24px;">
      <h1 style="font-size:22px;margin:0 0 12px;">You may still be clocked in</h1>
      <p>Hi ${safeName},</p>
      <p>Your PaintFlow time clock has been running for about ${hours.toFixed(1)} hours.</p>
      <p>If you forgot to clock out, open Time Tracking, clock out, and enter the time you actually finished. Your crew lead will review the correction.</p>
      <p><a href="${publicUrl}/time" style="display:inline-block;background:#0b57d0;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;">Open time clock</a></p>
    </div>
  `;
}

export async function processMissedPunches(env: Env) {
  const db = createDb(env.DATABASE_URL);
  const activeSessions = await db.query.timePunchSessions.findMany({
    where: inArray(timePunchSessions.status, ['active']),
    limit: 500,
  });

  if (!activeSessions.length) return { checked: 0, flagged: 0, skipped: 'no-active-punches' };

  const orgIds = Array.from(new Set(activeSessions.map((session) => session.orgId)));
  const [settingsRows, members] = await Promise.all([
    db.query.orgSettings.findMany(),
    db.query.teamMembers.findMany({
      where: inArray(teamMembers.id, Array.from(new Set(activeSessions.map((session) => session.teamMemberId)))),
    }),
  ]);
  const orgIdSet = new Set(orgIds);
  const settingsByOrg = new Map(settingsRows
    .filter((row) => orgIdSet.has(row.orgId as string))
    .map((row) => [row.orgId as string, timeClockSettings(row.businessHours)]));
  const membersById = new Map(members.map((member) => [member.id, member]));
  const now = new Date();
  let flagged = 0;
  let emailed = 0;

  for (const session of activeSessions) {
    const settings = settingsByOrg.get(session.orgId) || timeClockSettings(null);
    if (!isWithinReminderWindow(settings, now)) continue;
    const hours = (now.getTime() - session.startedAtActual.getTime()) / 36e5;
    if (hours < settings.maxShiftHours || session.reminderSentAt) continue;

    const member = membersById.get(session.teamMemberId);
    await db.update(timePunchSessions)
      .set({
        status: 'missed_clock_out',
        reviewRequired: true,
        reviewReason: 'late_clock_out',
        reminderSentAt: now,
        updatedAt: now,
      })
      .where(and(eq(timePunchSessions.id, session.id), eq(timePunchSessions.orgId, session.orgId)));

    await db.insert(timePunchEvents).values({
      orgId: session.orgId,
      punchSessionId: session.id,
      eventType: 'missed_clock_out_reminder',
      occurredAt: now,
      metadata: { hours, maxShiftHours: settings.maxShiftHours },
    });

    await db.insert(notificationEvents).values({
      orgId: session.orgId,
      type: 'time_clock',
      title: `${member?.name || 'Crew member'} may have missed clock-out`,
      body: `Punch session has been open for ${hours.toFixed(1)} hours and needs review.`,
      href: '/time',
      priority: 'high',
      sourceType: 'time_punch',
      sourceId: session.id,
      metadata: { teamMemberId: session.teamMemberId, hours, reviewReason: 'late_clock_out' },
    }).onConflictDoNothing();

    flagged += 1;
    if (member?.email) {
      await sendEmail(env, member.email, 'PaintFlow time clock reminder', missedPunchEmail(member.name, hours, env.PUBLIC_URL));
      emailed += 1;
    }
  }

  return { checked: activeSessions.length, flagged, emailed };
}
