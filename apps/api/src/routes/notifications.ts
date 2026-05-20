import { Hono } from 'hono';
import { z } from 'zod';
import { createDb } from '@paintflow/db';
import { auditLogs, estimates, leads, messages } from '@paintflow/db/schema';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';

const notifications = new Hono<{ Bindings: Env; Variables: Variables }>();

notifications.use('*', authMiddleware);

const markReadSchema = z.object({
  messageIds: z.array(z.string().uuid()).optional(),
  allMessages: z.boolean().optional(),
});

const importantAuditActions = [
  'estimate.accepted',
  'estimate.sent',
  'estimate.email.sent',
  'estimate.portal_link.created',
];

function estimateEventTitle(action: string) {
  const labels: Record<string, string> = {
    'estimate.accepted': 'Estimate accepted',
    'estimate.sent': 'Estimate sent',
    'estimate.email.sent': 'Estimate email sent',
    'estimate.portal_link.created': 'Estimate portal link created',
  };
  return labels[action] || action.replace(/[._-]/g, ' ');
}

notifications.get('/', async (c) => {
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);

  const [messageRows, auditRows] = await Promise.all([
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
        : `Estimate ${event.entityId.slice(0, 8)} was updated.`,
      createdAt: event.createdAt,
      read: false,
      priority: event.action === 'estimate.accepted' ? 'high' : 'normal',
      href: jobId ? `/jobs/${jobId}` : `/estimates/${event.entityId}`,
      customer: event.estimateLeadId ? {
        id: event.estimateLeadId,
        name: event.leadName || 'Customer',
      } : null,
    };
  });

  const data = [...messageNotifications, ...auditNotifications]
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
  if (parsed.data.allMessages) {
    await db.update(messages)
      .set({ read: true })
      .where(and(eq(messages.orgId, orgId), eq(messages.direction, 'inbound')));
    return c.json({ data: { updated: true } });
  }

  const ids = parsed.data.messageIds || [];
  if (ids.length) {
    await db.update(messages)
      .set({ read: true })
      .where(and(eq(messages.orgId, orgId), inArray(messages.id, ids)));
  }

  return c.json({ data: { updated: true } });
});

export default notifications;
