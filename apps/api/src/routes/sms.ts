import { Hono } from 'hono';
import { createDb } from '@paintflow/db';
import { leads, messages } from '@paintflow/db/schema';
import { eq, or, desc } from 'drizzle-orm';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';
import { sendSMS, formatPhoneNumber } from '../lib/twilio';

const sms = new Hono<{ Bindings: Env; Variables: Variables }>();

sms.use('/inbox', authMiddleware);
sms.use('/send', authMiddleware);

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
    await db.insert(messages).values({
      orgId: lead.orgId,
      leadId: lead.id,
      direction: 'inbound',
      fromNumber: from,
      toNumber: c.env.TWILIO_PHONE_NUMBER,
      body,
      twilioSid: sid,
    });
    
    console.log(`SMS from ${lead.name}: ${body}`);
  }
  
  return c.text('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', 200, {
    'Content-Type': 'text/xml',
  });
});

sms.get('/inbox', async (c) => {
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);
  
  const msgs = await db
    .select()
    .from(messages)
    .where(eq(messages.orgId, orgId))
    .orderBy(desc(messages.createdAt))
    .limit(50);
  
  return c.json({ data: msgs });
});

sms.post('/send', async (c) => {
  const orgId = c.get('orgId');
  const { to, body, leadId } = await c.req.json();
  
  const db = createDb(c.env.DATABASE_URL);
  
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
    
    return c.json({ success: true, messageId: result.sid });
  } catch (err) {
    console.error('SMS send error:', err);
    return c.json({ error: 'Failed to send SMS' }, 500);
  }
});

export default sms;
