import { Hono } from 'hono';
import { z } from 'zod';
import { createDb } from '@paintflow/db';
import { estimates, leads, orgBranding } from '@paintflow/db/schema';
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
  
  const branding = await db.query.orgBranding.findFirst({
    where: eq(orgBranding.orgId, estimate.orgId),
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
      branding: branding ? {
        logoUrl: branding.logoUrl,
        primaryColor: branding.primaryColor,
        companyName: branding.companyName,
      } : null,
    }
  });
});

estimatesApp.post('/:id/sign', async (c) => {
  const id = c.req.param('id');
  const { name, signatureData, packageName } = await c.req.json();
  
  if (!name || !signatureData) {
estimatesApp.get('/:id/public', async (c) => {
  const id = c.req.param('id');
  const db = createDb(c.env.DATABASE_URL);
  
  const estimate = await db.query.estimates.findFirst({
    where: eq(estimates.id, id),
  });
  
  if (!estimate) {
    return c.json({ error: 'Not found' }, 404);
  }
  
  const branding = await db.query.orgBranding.findFirst({
    where: eq(orgBranding.orgId, estimate.orgId),
  });
  
  return c.json({ 
    data: {
      id: estimate.id,
  if (!estimate) {
    return c.json({ error: 'Not found' }, 404);
  }
  
  const lead = await db.query.leads.findFirst({
    where: eq(leads.id, estimate.leadId),
  });
  
  // Auto-create job from accepted estimate
  const pkg = estimate.packages.find((p: any) => p.name === packageName) || estimate.packages[0];
  await db.insert(jobs).values({
    orgId: estimate.orgId,
    leadId: estimate.leadId,
    estimateId: estimate.id,
    name: `${lead?.name || 'Customer'} - ${pkg.name} Package`,
    status: 'scheduled',
    budget: pkg.total.toString(),
  }).onConflictDoNothing();

  if (lead?.email) {
    try {
      const pkg = estimate.packages.find((p: any) => p.name === packageName) || estimate.packages[0];
      
      const pdfHtml = generateSignedEstimateHTML(estimate, lead, pkg, name);
      let pdfAttachment = null;
      
      if (c.env.CF_ACCOUNT_ID && c.env.CF_API_TOKEN) {
        try {
          const pdfRes = await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${c.env.CF_ACCOUNT_ID}/browser-rendering/pdf`,
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${c.env.CF_API_TOKEN}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                html: pdfHtml,
                format: 'A4',
                printBackground: true,
              }),
            }
          );
          
          if (pdfRes.ok) {
            const pdfBuffer = await pdfRes.arrayBuffer();
            const pdfBase64 = Buffer.from(pdfBuffer).toString('base64');
            pdfAttachment = {
              filename: `estimate-${estimate.id.slice(0,8)}.pdf`,
              content: pdfBase64,
            };
          }
        } catch (pdfErr) {
          console.error('PDF generation failed:', pdfErr);
        }
      }
      
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
  <p><strong>Attached:</strong> Signed copy of your estimate</p>
  
  <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">
    This agreement is legally binding. By signing, you agreed to our terms and conditions including payment terms (50% deposit), warranty (2 years workmanship), and cancellation policy (3 business days).
  </p>
  
  <p>Questions? Reply to this email.</p>
</body>
</html>
      `;
      
      await sendEmail(c.env, lead.email, 'Estimate Signed - Next Steps', html, pdfAttachment);
      console.log(`Signed estimate ${id} from IP ${ip}`);
    } catch (err) {
      console.error('Failed to send signed confirmation:', err);
    }
  }
  
  return c.json({ data: estimate });
});

function generateSignedEstimateHTML(estimate: any, lead: any, pkg: any, signerName: string) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 40px; color: #111; }
    h1 { color: #2563eb; border-bottom: 2px solid #2563eb; padding-bottom: 10px; }
    .header { margin-bottom: 30px; }
    .package { border: 2px solid #2563eb; border-radius: 8px; padding: 20px; margin-bottom: 20px; }
    .total { font-size: 24px; font-weight: bold; color: #2563eb; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th, td { text-align: left; padding: 8px; border-bottom: 1px solid #e5e7eb; }
    th { background: #f9fafb; }
    .terms { margin-top: 40px; padding: 20px; background: #f9fafb; border-radius: 8px; font-size: 12px; }
    .signature { margin-top: 40px; padding: 20px; border: 2px solid #e5e7eb; border-radius: 8px; }
    .signature img { max-width: 300px; border-bottom: 1px solid #000; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Painting Estimate & Agreement</h1>
    <p><strong>Customer:</strong> ${lead?.name || 'Customer'}</p>
    <p><strong>Estimate #:</strong> ${estimate.id.slice(0, 8).toUpperCase()}</p>
    <p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
  </div>
  
  <div class="package">
    <h2>${pkg.name.charAt(0).toUpperCase() + pkg.name.slice(1)} Package <span class="total">$${pkg.total.toFixed(2)}</span></h2>
    <table>
      <thead>
        <tr>
          <th>Description</th>
          <th style="text-align: right;">Qty</th>
          <th style="text-align: right;">Rate</th>
          <th style="text-align: right;">Total</th>
        </tr>
      </thead>
      <tbody>
        ${pkg.items.map((item: any) => `
          <tr>
            <td>${item.desc}</td>
            <td style="text-align: right;">${item.qty}</td>
            <td style="text-align: right;">$${item.rate.toFixed(2)}</td>
            <td style="text-align: right;">$${(item.qty * item.rate).toFixed(2)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  </div>
  
  <div class="terms">
    <h3>Terms & Conditions</h3>
    <p><strong>Scope:</strong> Professional painting services as described.</p>
    <p><strong>Payment:</strong> 50% deposit required, balance on completion.</p>
    <p><strong>Warranty:</strong> 2 years workmanship.</p>
    <p><strong>Cancellation:</strong> 3 business days for full refund.</p>
  </div>
  
  <div class="signature">
    <h3>Customer Acceptance</h3>
    <p><strong>Signed by:</strong> ${signerName}</p>
    <p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
    ${estimate.signatureData ? `<img src="${estimate.signatureData}" alt="Signature" />` : ''}
    <p style="margin-top: 20px; font-style: italic;">By signing, customer agrees to terms and authorizes work.</p>
  </div>
</body>
</html>
  `;
}

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
