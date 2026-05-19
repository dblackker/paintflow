import { Hono } from 'hono';
import { createDb } from '@paintflow/db';
import { estimates, leads, quickbooksConnections, stripeConnections } from '@paintflow/db/schema';
import { eq } from 'drizzle-orm';
import type { Env, Variables } from '../types';
import { createCheckoutSession, verifyWebhookSignature } from '../lib/stripe';
import { createQBInvoice, createQBPayment } from '../lib/quickbooks';
import { createJobFromAcceptedEstimate } from '../lib/estimate-handoff';

const billing = new Hono<{ Bindings: Env; Variables: Variables }>();

billing.post('/checkout', async (c) => {
  const { estimateId, packageName } = await c.req.json();
  
  const db = createDb(c.env.DATABASE_URL);
  
  const estimate = await db.query.estimates.findFirst({
    where: eq(estimates.id, estimateId),
  });
  
  if (!estimate) {
    return c.json({ error: 'Estimate not found' }, 404);
  }

  const stripeConnection = await db.query.stripeConnections.findFirst({
    where: eq(stripeConnections.orgId, estimate.orgId),
  });
  if (!stripeConnection?.onboardingComplete) {
    return c.json({ error: 'Stripe payments are not ready for this workspace' }, 409);
  }
  
  const packages = estimate.packages as Array<{ name: string; total: number }>;
  const pkg = packages.find((p) => p.name === packageName);
  if (!pkg) {
    return c.json({ error: 'Package not found' }, 404);
  }
  
  try {
    const packageTotal = Number(pkg.total);
    if (!Number.isFinite(packageTotal) || packageTotal <= 0) {
      return c.json({ error: 'Invalid package total' }, 400);
    }

    const session = await createCheckoutSession(c.env, {
      amount: Math.round(packageTotal * 0.5 * 100) / 100,
      successUrl: `${c.env.PUBLIC_URL}/estimates/${estimateId}/success`,
      cancelUrl: `${c.env.PUBLIC_URL}/estimates/${estimateId}`,
      metadata: { estimateId, orgId: estimate.orgId, packageName },
      connectedAccountId: stripeConnection.stripeAccountId,
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
    
    const event = JSON.parse(body) as {
      type?: string;
      data?: { object?: { metadata?: Record<string, string>; amount_total?: number } };
    };
    
    if (event.type === 'checkout.session.completed') {
      const metadata = event.data?.object?.metadata;
      const estimateId = metadata?.estimateId;
      const orgId = metadata?.orgId;
      const packageName = metadata?.packageName;
      const amountTotal = (event.data?.object?.amount_total ?? 0) / 100;
      if (!estimateId || !orgId || amountTotal <= 0) {
        return c.json({ error: 'Missing checkout metadata' }, 400);
      }
      
      const db = createDb(c.env.DATABASE_URL);
      const estimate = await db.query.estimates.findFirst({
        where: eq(estimates.id, estimateId),
      });

      if (!estimate || estimate.orgId !== orgId) {
        return c.json({ error: 'Estimate metadata mismatch' }, 400);
      }
      
      const [acceptedEstimate] = await db.update(estimates)
        .set({ status: 'accepted' })
        .where(eq(estimates.id, estimateId))
        .returning();

      const job = await createJobFromAcceptedEstimate(db, acceptedEstimate, { packageName });
      
      console.log(`Estimate ${estimateId} marked as accepted and job ${job.id} is ready`);
      
      // Auto-sync to QuickBooks if connected
      const qbConnection = await db.query.quickbooksConnections.findFirst({
        where: eq(quickbooksConnections.orgId, orgId),
      });
      
      if (qbConnection) {
        try {
          const lead = await db.query.leads.findFirst({
            where: eq(leads.id, estimate.leadId),
          });
          if (!lead || lead.orgId !== orgId) {
            throw new Error('Lead metadata mismatch');
          }
          
          // Sync invoice
          const invoiceId = await createQBInvoice(c.env, orgId, estimate, lead);
          console.log(`Auto-synced invoice ${invoiceId} to QuickBooks`);
          
          // Sync payment
          const paymentDate = new Date().toISOString().split('T')[0];
          const paymentId = await createQBPayment(c.env, orgId, { ...estimate, qboInvoiceId: invoiceId }, amountTotal, paymentDate);
          console.log(`Auto-synced payment ${paymentId} to QuickBooks`);
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
