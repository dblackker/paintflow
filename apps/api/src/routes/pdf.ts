import { Hono } from 'hono';
import { createDb } from '@paintflow/db';
import { estimates, leads } from '@paintflow/db/schema';
import { eq } from 'drizzle-orm';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';

const pdf = new Hono<{ Bindings: Env; Variables: Variables }>();

pdf.use('*', authMiddleware);

// POST /v1/pdf/estimate/:id
pdf.post('/estimate/:id', async (c) => {
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
  
  const html = generateEstimateHTML(estimate, lead);
  
  // const response = await fetch(
  //   `https://api.cloudflare.com/client/v4/accounts/${c.env.CF_ACCOUNT_ID}/browser-rendering/pdf`,
  //   {
  //     method: 'POST',
  //     headers: {
  //       'Authorization': `Bearer ${c.env.CF_API_TOKEN}`,
  //       'Content-Type': 'application/json',
  //     },
  //     body: JSON.stringify({ html, format: 'A4', printBackground: true }),
  //   }
  // );
  
  return c.json({ 
    success: true, 
    pdfUrl: `https://example.com/estimates/${id}.pdf`,
    html,
  });
});

function generateEstimateHTML(estimate: any, lead: any) {
  const packages = estimate.packages;
  const isSigned = !!estimate.signedAt;
  
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 40px; color: #111; }
    h1 { color: #2563eb; border-bottom: 2px solid #2563eb; padding-bottom: 10px; margin-bottom: 30px; }
    .header { margin-bottom: 30px; }
    .package { border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin-bottom: 20px; }
    .package.recommended { border-color: #2563eb; box-shadow: 0 0 0 1px #2563eb; }
    .package h2 { margin-top: 0; display: flex; justify-content: space-between; }
    .total { font-size: 24px; font-weight: bold; color: #2563eb; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th, td { text-align: left; padding: 8px; border-bottom: 1px solid #e5e7eb; }
    th { background: #f9fafb; font-weight: 600; }
    .terms { margin-top: 40px; padding: 20px; background: #f9fafb; border-radius: 8px; font-size: 12px; line-height: 1.6; }
    .terms h3 { margin-top: 0; }
    .signature { margin-top: 40px; padding: 20px; border: 2px solid #e5e7eb; border-radius: 8px; }
    .signature img { max-width: 300px; border-bottom: 1px solid #000; }
    .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 12px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Painting Estimate & Agreement</h1>
    <p><strong>Customer:</strong> ${lead?.name || 'Customer'}</p>
    <p><strong>Email:</strong> ${lead?.email || ''}</p>
    <p><strong>Phone:</strong> ${lead?.phone || ''}</p>
    <p><strong>Date:</strong> ${new Date(estimate.createdAt).toLocaleDateString()}</p>
    <p><strong>Estimate #:</strong> ${estimate.id.slice(0, 8).toUpperCase()}</p>
  </div>
  
  ${packages.map((pkg: any) => `
    <div class="package ${pkg.name === 'better' ? 'recommended' : ''}">
      <h2>
        ${pkg.name.charAt(0).toUpperCase() + pkg.name.slice(1)} Package
        <span class="total">$${pkg.total.toFixed(2)}</span>
      </h2>
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
  `).join('')}
  
  <div class="terms">
    <h3>Terms & Conditions</h3>
    <p><strong>Scope of Work:</strong> Contractor agrees to perform painting services as described above. All work will be completed in a professional manner using quality materials.</p>
    <p><strong>Payment Terms:</strong> 50% deposit required to schedule work. Final payment due upon completion. We accept credit cards, checks, and cash.</p>
    <p><strong>Change Orders:</strong> Any changes to scope must be approved in writing and may affect price and timeline.</p>
    <p><strong>Warranty:</strong> We warranty our workmanship for 2 years. Paint manufacturer warranties apply to materials.</p>
    <p><strong>Cancellation:</strong> Customer may cancel within 3 business days of signing for full refund of deposit.</p>
    <p><strong>Access:</strong> Customer agrees to provide reasonable access to property during business hours.</p>
  </div>
  
  ${isSigned ? `
  <div class="signature">
    <h3>Customer Acceptance</h3>
    <p><strong>Signed by:</strong> ${estimate.signedName}</p>
    <p><strong>Date:</strong> ${new Date(estimate.signedAt).toLocaleDateString()}</p>
    ${estimate.signatureData ? `<img src="${estimate.signatureData}" alt="Signature" />` : ''}
    <p style="margin-top: 20px; font-style: italic;">By signing above, customer agrees to the terms and conditions and authorizes work to begin upon receipt of deposit.</p>
  </div>
  ` : ''}
  
  <div class="footer">
    <p>This estimate is valid for 30 days from date issued. Prices subject to change after expiration.</p>
    <p>Thank you for your business!</p>
  </div>
</body>
</html>
  `;
}

export default pdf;
