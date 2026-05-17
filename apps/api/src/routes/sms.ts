import { Hono } from 'hono';
import { createDb } from '@paintflow/db';
import { leads } from '@paintflow/db/schema';
import { eq, or, ilike } from 'drizzle-orm';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';

const sms = new Hono<{ Bindings: Env; Variables: Variables }>();

sms.use('/inbox', authMiddleware);

// POST /v1/sms/inbound - Twilio webhook
sms.post('/inbound', async (c) => {
  const formData = await c.req.formData();
  const from = formData.get('From') as string;
  const body = formData.get('Body') as string;
  
  // Find lead by phone
  const db = createDb(c.env.DATABASE_URL);
  const lead = await db.query.leads.findFirst({
    where: or(
      eq(leads.phone, from),
      eq(leads.phone, from.replace('+1', ''))
    ),
  });
  
  // Store message
  // TODO: Insert into messages table
  
  // Auto-respond or notify owner
  if (lead) {
    console.log(`SMS from ${lead.name}: ${body}`);
    // TODO: Create notification or auto-reply
  }
  
  return c.text('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', 200, {
    'Content-Type': 'text/xml',
  });
});

// GET /v1/sms/inbox
sms.get('/inbox', async (c) => {
  const orgId = c.get('orgId');
  // TODO: Fetch messages for org
  return c.json({ data: [] });
});

// POST /v1/sms/send
sms.post('/send', async (c) => {
  const { to, body, leadId } = await c.req.json();
  
  // TODO: Send via Twilio
  // await twilio.messages.create({
  //   to,
  //   from: c.env.TWILIO_PHONE_NUMBER,
  //   body,
  // });
  
  // Log in DB
  console.log(`SMS to ${to}: ${body}`);
  
  return c.json({ success: true, messageId: `mock_${Date.now()}` });
});

export default sms;
