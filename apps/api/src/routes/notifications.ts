import { Hono } from 'hono';
import { z } from 'zod';
import { createDb } from '@crewmodo/db';
import { auditLogs, estimates, leads, messages, notificationEvents, notificationReads } from '@crewmodo/db/schema';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';

const notifications = new Hono<{ Bindings: Env; Variables: Variables }>();

notifications.use('*', authMiddleware);

const markReadSchema = z.object({
  notificationIds: z.array(z.string().uuid()).optional(),
  messageIds: z.array(z.string().uuid()).optional(),
  allMessages: z.boolean().optional(),
  allNotifications: z.boolean().optional(),
});

const importantAuditActions = [
  'estimate.accepted',
  'estimate.sent',
  'estimate.updated',
  'estimate.email.sent',
  'estimate.email.updated',
  'estimate.client_viewed',
  'estimate.revision.created',
  'estimate.agreement.superseded',
  'estimate.agreement.voided',
  'estimate.portal_link.created',
];

function estimateEventTitle(action: string) {
  const labels: Record<string, string> = {
    'estimate.accepted': 'Estimate accepted',
    'estimate.sent': 'Estimate sent',
    'estimate.updated': 'Estimate updated',
    'estimate.email.sent': 'Estimate email sent',
    'estimate.email.updated': 'Estimate update emailed',
    'estimate.client_viewed': 'Client viewed estimate',
    'estimate.revision.created': 'Estimate revision created',
    'estimate.agreement.superseded': 'Estimate agreement superseded',
    'estimate.agreement.voided': 'Estimate agreement voided',
    'estimate.portal_link.created': 'Estimate portal link created',
  };
  return labels[action] || action.replace(/[._-]/g, ' ');
}

notifications.get('/', async (c) => {
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  const db = createDb(c.env.DATABASE_URL);

  const [eventRows, messageRows, auditRows] = await Promise.all([
    db.select({
      id: notificationEvents.id,
      type: notificationEvents.type,
      title: notificationEvents.title,
      body: notificationEvents.body,
      href: notificationEvents.href,
      priority: notificationEvents.priority,
      sourceType: notificationEvents.sourceType,
      sourceId: notificationEvents.sourceId,
      leadId: notificationEvents.leadId,
      metadata: notificationEvents.metadata,
      createdAt: notificationEvents.createdAt,
      readAt: notificationReads.readAt,
      leadName: leads.name,
      leadPhone: leads.phone,
    })
      .from(notificationEvents)
      .leftJoin(notificationReads, and(
        eq(notificationReads.notificationId, notificationEvents.id),
        eq(notificationReads.orgId, orgId),
        eq(notificationReads.userId, userId || '00000000-0000-0000-0000-000000000000'),
      ))
      .leftJoin(leads, and(eq(notificationEvents.leadId, leads.id), eq(leads.orgId, orgId)))
      .where(eq(notificationEvents.orgId, orgId))
      .orderBy(desc(notificationEvents.createdAt))
      .limit(100),
    db.select({
      id: messages.id,
      leadId: messages.leadId,
      direction: messages.direction,
      body: messages.body,
      read: messages.read,
      createdAt: messages.createdAt,
      leadName: leads.name,
      leadPhone: leads.phone,
    })
      .from(messages)
      .leftJoin(leads, and(eq(messages.leadId, leads.id), eq(leads.orgId, orgId)))
      .where(eq(messages.orgId, orgId))
      .orderBy(desc(messages.createdAt))
      .limit(80),
    db.select({
      id: auditLogs.id,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      metadata: auditLogs.metadata,
      createdAt: auditLogs.createdAt,
      estimateTotal: estimates.total,
      estimateLeadId: estimates.leadId,
      leadName: leads.name,
    })
      .from(auditLogs)
      .leftJoin(estimates, and(eq(auditLogs.entityId, estimates.id), eq(auditLogs.entityType, 'estimate'), eq(estimates.orgId, orgId)))
      .leftJoin(leads, and(eq(estimates.leadId, leads.id), eq(leads.orgId, orgId)))
      .where(and(eq(auditLogs.orgId, orgId), inArray(auditLogs.action, importantAuditActions)))
      .orderBy(desc(auditLogs.createdAt))
      .limit(80),
  ]);

  const persistentNotifications = eventRows.map((event) => ({
    id: event.id,
    source: 'notification',
    sourceId: event.id,
    type: event.type,
    title: event.title,
    body: event.body || '',
    createdAt: event.createdAt,
    read: Boolean(event.readAt),
    priority: event.priority,
    href: event.href || '/notifications',
    customer: event.leadId ? {
      id: event.leadId,
      name: event.leadName || 'Customer',
      phone: event.leadPhone,
    } : null,
  }));
  const persistentSourceKeys = new Set(eventRows
    .filter((event) => event.sourceType && event.sourceId)
    .map((event) => `${event.sourceType}:${event.sourceId}`));

  const messageNotifications = messageRows.map((message) => ({
    id: `message:${message.id}`,
    source: 'message',
    sourceId: message.id,
    title: message.direction === 'inbound' ? `New message from ${message.leadName || 'customer'}` : `Message sent to ${message.leadName || 'customer'}`,
    body: message.body,
    createdAt: message.createdAt,
    read: message.direction === 'outbound' ? true : Boolean(message.read),
    priority: message.direction === 'inbound' && !message.read ? 'high' : 'normal',
    href: message.leadId ? `/sms?leadId=${message.leadId}` : '/sms',
    customer: message.leadId ? {
      id: message.leadId,
      name: message.leadName || 'Customer',
      phone: message.leadPhone,
    } : null,
  }));

  const auditNotifications = auditRows.map((event) => {
    const metadata = event.metadata as Record<string, unknown> | null;
    const jobId = typeof metadata?.jobId === 'string' ? metadata.jobId : null;
    return {
      id: `audit:${event.id}`,
      source: 'audit',
      sourceId: event.id,
      title: event.leadName ? `${estimateEventTitle(event.action)} for ${event.leadName}` : estimateEventTitle(event.action),
      body: event.action === 'estimate.accepted'
        ? `Contract value ${event.estimateTotal ? `$${Number(event.estimateTotal).toLocaleString()}` : 'recorded'}${jobId ? ' and job created.' : '.'}`
        : event.action === 'estimate.client_viewed'
          ? `Estimate ${event.entityId.slice(0, 8)} was opened from the customer preview link.`
          : `Estimate ${event.entityId.slice(0, 8)} was updated.`,
      createdAt: event.createdAt,
      read: false,
      priority: ['estimate.accepted', 'estimate.client_viewed'].includes(event.action) ? 'high' : 'normal',
      href: jobId ? `/jobs/${jobId}` : event.estimateLeadId ? `/leads/${event.estimateLeadId}#customer-estimates` : `/estimates/${event.entityId}`,
      customer: event.estimateLeadId ? {
        id: event.estimateLeadId,
        name: event.leadName || 'Customer',
      } : null,
    };
  });

  const legacyNotifications = [...messageNotifications, ...auditNotifications]
    .filter((item) => !persistentSourceKeys.has(`${item.source}:${item.sourceId}`));

  const data = [...persistentNotifications, ...legacyNotifications]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 120);

  return c.json({
    data,
    meta: {
      unreadMessages: messageNotifications.filter((item) => item.source === 'message' && !item.read).length,
      unreadHighPriority: data.filter((item) => item.priority === 'high' && !item.read).length,
    },
  });
});

notifications.post('/mark-read', async (c) => {
  const orgId = c.get('orgId');
  const parsed = markReadSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const db = createDb(c.env.DATABASE_URL);
  const userId = c.get('userId');
  if (parsed.data.allMessages) {
    await db.update(messages)
      .set({ read: true })
      .where(and(eq(messages.orgId, orgId), eq(messages.direction, 'inbound')));
  }

  const ids = parsed.data.messageIds || [];
  if (ids.length) {
    await db.update(messages)
      .set({ read: true })
      .where(and(eq(messages.orgId, orgId), inArray(messages.id, ids)));
  }

  const eventIds = parsed.data.allNotifications
    ? (await db.select({ id: notificationEvents.id }).from(notificationEvents).where(eq(notificationEvents.orgId, orgId))).map((row) => row.id)
    : parsed.data.notificationIds || [];

  if (userId && eventIds.length) {
    await db.insert(notificationReads)
      .values(eventIds.map((notificationId) => ({ orgId, userId, notificationId })))
      .onConflictDoNothing();
  }

  return c.json({ data: { updated: true } });
});

export default notifications;
