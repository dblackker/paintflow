import { Hono } from 'hono';
import { createDb } from '@paintflow/db';
import { estimates, leads, quickbooksConnections } from '@paintflow/db/schema';
import { eq } from 'drizzle-orm';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';
import { createCheckoutSession, verifyWebhookSignature } from '../lib/stripe';
import { createQBInvoice } from '../lib/quickbooks';

const billing = new Hono<{ Bindings: Env; Variables: Variables }>();

billing.use('/checkout', authMiddleware);

billing.post('/checkout', async (c) => {
  const orgId = c.get('orgId');
  const { estimateId, packageName } = await c.req.json();
  
  const db = createDb(c.env.DATABASE_URL);
  
  const estimate = await db.query.estimates.findFirst({
    where: eq(estimates.id, estimateId),
  });
  
  if (!estimate || estimate.orgId !== orgId) {
    return c.json({ error: 'Estimate not found' }, 404);
  }
  
  const pkg = estimate.packages.find((p: any) => p.name === packageName);
  if (!pkg) {
    return c.json({ error: 'Package not found' }, 404);
  }
  
  try {
    const session = await createCheckoutSession(c.env, {
      amount: pkg.total,
      successUrl: `${c.env.APP_URL}/estimates/${estimateId}/success`,
      cancelUrl: `${c.env.APP_URL}/estimates/${estimateId}`,
      metadata: { estimateId, orgId, packageName },
    });
    
    return c.json({ 
      checkoutUrl: session.url,
      sessionId: session.id,
    });
  } catch (err) {
    console.error('Checkout error:', err);
    return c.json({ error: 'Failed to create checkout session' }, 500);
  }
});

billing.post('/webhook', async (c) => {
  const sig = c.req.header('stripe-signature');
  const body = await c.req.text();
  
  if (!sig) {
    return c.json({ error: 'Missing signature' }, 400);
  }
  
  try {
    const isValid = await verifyWebhookSignature(
      body,
      sig,
      c.env.STRIPE_WEBHOOK_SECRET
    );
    
    if (!isValid) {
      return c.json({ error: 'Invalid signature' }, 400);
    }
    
    const event = JSON.parse(body);
    
    if (event.type === 'checkout.session.completed') {
      const { estimateId, orgId } = event.data.object.metadata;
      
      const db = createDb(c.env.DATABASE_URL);
      
      // Mark estimate as accepted
      await db.update(estimates)
        .set({ status: 'accepted' })
        .where(eq(estimates.id, estimateId));
      
      console.log(`Estimate ${estimateId} marked as accepted`);
      
      // Auto-sync to QuickBooks if connected
      const qbConnection = await db.query.quickbooksConnections.findFirst({
        where: eq(quickbooksConnections.orgId, orgId),
      });
      
      if (qbConnection) {
        try {
          const estimate = await db.query.estimates.findFirst({
            where: eq(estimates.id, estimateId),
          });
          
          const lead = await db.query.leads.findFirst({
            where: eq(leads.id, estimate!.leadId),
          });
          
          const invoiceId = await createQBInvoice(c.env, orgId, estimate, lead);
          console.log(`Auto-synced invoice ${invoiceId} to QuickBooks`);
        } catch (qbErr) {
          console.error('QB auto-sync failed:', qbErr);
          // Don't fail webhook if QB sync fails
        }
      }
    }
    
    return c.json({ received: true });
  } catch (err) {
    console.error('Webhook error:', err);
    return c.json({ error: 'Webhook handler failed' }, 500);
  }
});

export default billing;
