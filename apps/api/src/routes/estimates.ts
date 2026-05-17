import { Hono } from 'hono';
import { z } from 'zod';
import { createDb } from '@paintflow/db';
import { estimates, leads } from '@paintflow/db/schema';
import { eq, desc } from 'drizzle-orm';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';
import { sendEmail, estimateEmailTemplate } from '../lib/email';

const estimatesApp = new Hono<{ Bindings: Env; Variables: Variables }>();

estimatesApp.get('/:id/public', async (c) => {
  const id = c.req.param('id');
  const db = createDb(c.env.DATABASE_URL);
  
  const estimate = await db.query.estimates.findFirst({
    where: eq(estimates.id, id),
  });
  
  if (!estimate) {
    return c.json({ error: 'Not found' }, 404);
  }
  
  return c.json({ 
    data: {
      id: estimate.id,
      packages: estimate.packages,
      total: estimate.total,
      status: estimate.status,
      createdAt: estimate.createdAt,
      signedName: estimate.signedName,
      signedAt: estimate.signedAt,
    }
  });
});

estimatesApp.post('/:id/sign', async (c) => {
  const id = c.req.param('id');
  const { name, signatureData, packageName } = await c.req.json();
  
  if (!name || !signatureData) {
    return c.json({ error: 'Name and signature required' }, 400);
  }
  
  const db = createDb(c.env.DATABASE_URL);
  const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown';
  const userAgent = c.req.header('User-Agent') || 'unknown';
  
  const [estimate] = await db.update(estimates)
    .set({
      signedName: name,
      signatureData,
      signedAt: new Date(),
      status: 'accepted',
    })
    .where(eq(estimates.id, id))
    .returning();
  
  if (!estimate) {
    return c.json({ error: 'Not found' }, 404);
  }
  
  const lead = await db.query.leads.findFirst({
    where: eq(leads.id, estimate.leadId),
  });
  
  if (lead?.email) {
    try {
      const pkg = estimate.packages.find((p: any) => p.name === packageName) || estimate.packages[0];
      const html = `
<!DOCTYPE html>
<html>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h1 style="color: #2563eb;">Estimate Signed ✓</h1>
  <p>Hi ${lead.name},</p>
  <p>Thank you for signing your painting estimate!</p>
  
  <div style="background: #f9fafb; border-radius: 8px; padding: 20px; margin: 20px 0;">
    <h2 style="margin-top: 0;">Signed Details</h2>
    <p><strong>Package:</strong> ${pkg.name.charAt(0).toUpperCase() + pkg.name.slice(1)}</p>
    <p><strong>Total:</strong> $${pkg.total.toFixed(2)}</p>
    <p><strong>Signed by:</strong> ${name}</p>
    <p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
  </div>
  
  <p>We'll be in touch shortly to schedule your project. A deposit invoice will be sent separately.</p>
  
  <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">
    This agreement is legally binding. By signing, you agreed to our terms and conditions including payment terms (50% deposit), warranty (2 years workmanship), and cancellation policy (3 business days).
  </p>
  
  <p>Questions? Reply to this email.</p>
</body>
</html>
      `;
      await sendEmail(c.env, lead.email, 'Estimate Signed - Next Steps', html);
      console.log(`Signed estimate ${id} from IP ${ip}, UA: ${userAgent}`);
    } catch (err) {
      console.error('Failed to send signed confirmation:', err);
    }
  }
  
  return c.json({ data: estimate });
});

estimatesApp.use('*', authMiddleware);

const lineItemSchema = z.object({
  desc: z.string(),
  qty: z.number().positive(),
  rate: z.number().positive(),
});

const packageSchema = z.object({
  name: z.enum(['good', 'better', 'best']),
  items: z.array(lineItemSchema),
  total: z.number(),
});

const createEstimateSchema = z.object({
  leadId: z.string().uuid(),
  packages: z.array(packageSchema).min(1),
});

estimatesApp.get('/', async (c) => {
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);
  
  const results = await db
    .select()
    .from(estimates)
    .where(eq(estimates.orgId, orgId))
    .orderBy(desc(estimates.createdAt))
    .limit(50);
  
  return c.json({ data: results });
});

estimatesApp.post('/', async (c) => {
  const orgId = c.get('orgId');
  const body = await c.req.json();
  const parsed = createEstimateSchema.safeParse(body);
  
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error }, 400);
  }
  
  const db = createDb(c.env.DATABASE_URL);
  const total = Math.max(...parsed.data.packages.map(p => p.total));
  
  const [estimate] = await db.insert(estimates).values({
    orgId,
    leadId: parsed.data.leadId,
    packages: parsed.data.packages,
    total: total.toString(),
    status: 'draft',
  }).returning();
  
  return c.json({ data: estimate }, 201);
});

estimatesApp.post('/:id/send', async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  
  const db = createDb(c.env.DATABASE_URL);
  
  const estimate = await db.query.estimates.findFirst({
    where: eq(estimates.id, id),
  });
  
  if (!estimate || estimate.orgId !== orgId) {
    return c.json({ error: 'Not found' }, 404);
  }
  
  const lead = await db.query.leads.findFirst({
    where: eq(leads.id, estimate.leadId),
  });
  
  await db.update(estimates)
    .set({ status: 'sent', sentAt: new Date() })
    .where(eq(estimates.id, id));
  
  if (lead?.email) {
    try {
      const html = estimateEmailTemplate(estimate.id, lead.name, estimate.total);
      await sendEmail(c.env, lead.email, 'Your Painting Estimate', html);
    } catch (err) {
      console.error('Failed to send email:', err);
    }
  }
  
  return c.json({ success: true });
});

export default estimatesApp;
