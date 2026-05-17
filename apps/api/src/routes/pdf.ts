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
  
  // Generate HTML for PDF
  const html = generateEstimateHTML(estimate, lead);
  
  // Use Cloudflare Browser Rendering to generate PDF
  // const response = await fetch(
  //   `https://api.cloudflare.com/client/v4/accounts/${c.env.CF_ACCOUNT_ID}/browser-rendering/pdf`,
  //   {
  //     method: 'POST',
  //     headers: {
  //       'Authorization': `Bearer ${c.env.CF_API_TOKEN}`,
  //       'Content-Type': 'application/json',
  //     },
  //     body: JSON.stringify({
  //       html,
  //       format: 'A4',
  //       printBackground: true,
  //     }),
  //   }
  // );
  
  // const pdfBuffer = await response.arrayBuffer();
  
  // For now, return mock
  return c.json({ 
    success: true, 
    pdfUrl: `https://example.com/estimates/${id}.pdf`,
    html, // For debugging
  });
});

function generateEstimateHTML(estimate: any, lead: any) {
  const packages = estimate.packages;
  
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 40px; }
    h1 { color: #2563eb; border-bottom: 2px solid #2563eb; padding-bottom: 10px; }
    .header { margin-bottom: 30px; }
    .package { border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin-bottom: 20px; }
    .package.recommended { border-color: #2563eb; box-shadow: 0 0 0 1px #2563eb; }
    .package h2 { margin-top: 0; display: flex; justify-content: space-between; }
    .total { font-size: 24px; font-weight: bold; color: #2563eb; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th, td { text-align: left; padding: 8px; border-bottom: 1px solid #e5e7eb; }
    th { background: #f9fafb; }
    .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e7eb; color: #6b7280; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Painting Estimate</h1>
    <p><strong>For:</strong> ${lead?.name || 'Customer'}</p>
    <p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
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
            <th>Qty</th>
            <th>Rate</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          ${pkg.items.map((item: any) => `
            <tr>
              <td>${item.desc}</td>
              <td>${item.qty}</td>
              <td>$${item.rate.toFixed(2)}</td>
              <td>$${(item.qty * item.rate).toFixed(2)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `).join('')}
  
  <div class="footer">
    <p>Thank you for considering our services. This estimate is valid for 30 days.</p>
    <p>Questions? Reply to this email or call us.</p>
  </div>
</body>
</html>
  `;
}

export default pdf;
