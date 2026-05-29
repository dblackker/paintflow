import { Hono } from 'hono';
import { z } from 'zod';
import { createDb } from '@crewmodo/db';
import { auditLogs, leads, messages } from '@crewmodo/db/schema';
import { and, desc, eq, or } from 'drizzle-orm';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';
import { sendSMS, formatPhoneNumber } from '../lib/twilio';
import { createNotificationAndPush } from '../lib/web-push';

const sms = new Hono<{ Bindings: Env; Variables: Variables }>();

sms.use('/inbox', authMiddleware);
sms.use('/thread/*', authMiddleware);
sms.use('/send', authMiddleware);

const sendSchema = z.object({
  leadId: z.string().uuid(),
  body: z.string().trim().min(1).max(1000),
  to: z.string().trim().optional(),
});

sms.post('/inbound', async (c) => {
  const formData = await c.req.formData();
  const from = formData.get('From') as string;
  const body = formData.get('Body') as string;
  const sid = formData.get('MessageSid') as string;
  
  const db = createDb(c.env.DATABASE_URL);
  
  // Find lead by phone
  const lead = await db.query.leads.findFirst({
    where: or(
      eq(leads.phone, from),
      eq(leads.phone, from.replace('+1', ''))
    ),
  });
  
  // Store inbound message
  if (lead) {
    const [message] = await db.insert(messages).values({
      orgId: lead.orgId,
      leadId: lead.id,
      direction: 'inbound',
      fromNumber: from,
      toNumber: c.env.TWILIO_PHONE_NUMBER,
      body,
      twilioSid: sid,
    }).returning();

    await createNotificationAndPush(c.env, {
      orgId: lead.orgId,
      type: 'message.inbound',
      title: `New message from ${lead.name}`,
      body,
      href: `/sms?leadId=${lead.id}`,
      priority: 'high',
      sourceType: 'message',
      sourceId: message.id,
      leadId: lead.id,
      metadata: { from },
    }).catch((err) => console.error('Push notification failed:', err));

    if (lead.status === 'new') {
      await db.update(leads)
        .set({ status: 'contacted', updatedAt: new Date() })
        .where(and(eq(leads.id, lead.id), eq(leads.orgId, lead.orgId)));
      await db.insert(auditLogs).values({
        orgId: lead.orgId,
        action: 'lead.stage.changed',
        entityType: 'lead',
        entityId: lead.id,
        metadata: {
          fromStage: 'new_lead',
          targetStage: 'contacted',
          reason: 'Customer replied by SMS.',
          leadName: lead.name,
          source: 'sms_inbound',
        },
      });
    }
    
    console.log(`SMS from ${lead.name}: ${body}`);
  }
  
  return c.text('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', 200, {
    'Content-Type': 'text/xml',
  });
});

sms.get('/inbox', async (c) => {
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);
  
  const rows = await db
    .select({
      id: messages.id,
      orgId: messages.orgId,
      leadId: messages.leadId,
      direction: messages.direction,
      fromNumber: messages.fromNumber,
      toNumber: messages.toNumber,
      body: messages.body,
      twilioSid: messages.twilioSid,
      read: messages.read,
      createdAt: messages.createdAt,
      leadName: leads.name,
      leadPhone: leads.phone,
      leadEmail: leads.email,
      leadStatus: leads.status,
    })
    .from(messages)
    .leftJoin(leads, and(eq(messages.leadId, leads.id), eq(leads.orgId, orgId)))
    .where(eq(messages.orgId, orgId))
    .orderBy(desc(messages.createdAt))
    .limit(200);
  
  return c.json({ data: rows });
});

sms.get('/thread/:leadId', async (c) => {
  const orgId = c.get('orgId');
  const leadId = c.req.param('leadId');
  const db = createDb(c.env.DATABASE_URL);

  const lead = await db.query.leads.findFirst({
    where: and(eq(leads.id, leadId), eq(leads.orgId, orgId)),
  });

  if (!lead) {
    return c.json({ error: 'Lead not found' }, 404);
  }

  const thread = await db.select()
    .from(messages)
    .where(and(eq(messages.orgId, orgId), eq(messages.leadId, leadId)))
    .orderBy(messages.createdAt)
    .limit(300);

  await db.update(messages)
    .set({ read: true })
    .where(and(eq(messages.orgId, orgId), eq(messages.leadId, leadId), eq(messages.direction, 'inbound')));

  return c.json({ data: { lead, messages: thread } });
});

sms.post('/send', async (c) => {
  const orgId = c.get('orgId');
  const parsed = sendSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }
  const { body, leadId } = parsed.data;
  
  const db = createDb(c.env.DATABASE_URL);
  const lead = await db.query.leads.findFirst({
    where: and(eq(leads.id, leadId), eq(leads.orgId, orgId)),
  });

  if (!lead) {
    return c.json({ error: 'Lead not found' }, 404);
  }

  const to = parsed.data.to || lead.phone;
  if (!to) {
    return c.json({ error: 'Lead does not have a phone number' }, 400);
  }
  
  try {
    const formattedTo = formatPhoneNumber(to);
    const result = await sendSMS(c.env, formattedTo, body) as { sid: string };
    
    // Log outbound message
    await db.insert(messages).values({
      orgId,
      leadId,
      direction: 'outbound',
      fromNumber: c.env.TWILIO_PHONE_NUMBER,
      toNumber: formattedTo,
      body,
      twilioSid: result.sid,
    });

    if (lead.status === 'new') {
      await db.update(leads)
        .set({ status: 'contacted', updatedAt: new Date() })
        .where(and(eq(leads.id, leadId), eq(leads.orgId, orgId)));
      await db.insert(auditLogs).values({
        orgId,
        action: 'lead.stage.changed',
        entityType: 'lead',
        entityId: leadId,
        metadata: {
          fromStage: 'new_lead',
          targetStage: 'contacted',
          reason: 'SMS sent to customer.',
          leadName: lead.name,
          source: 'sms_outbound',
        },
      });
    }
    
    return c.json({ success: true, messageId: result.sid });
  } catch (err) {
    console.error('SMS send error:', err);
    return c.json({ error: 'Failed to send SMS' }, 500);
  }
});

export default sms;
