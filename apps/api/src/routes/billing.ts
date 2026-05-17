import { Hono } from 'hono';
import { createDb } from '@paintflow/db';
import { estimates } from '@paintflow/db/schema';
import { eq } from 'drizzle-orm';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';
import { createCheckoutSession, verifyWebhookSignature } from '../lib/stripe';

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
      const { estimateId } = event.data.object.metadata;
      
      const db = createDb(c.env.DATABASE_URL);
      await db.update(estimates)
        .set({ status: 'accepted' })
        .where(eq(estimates.id, estimateId));
      
      console.log(`Estimate ${estimateId} marked as accepted`);
    }
    
    return c.json({ received: true });
  } catch (err) {
    console.error('Webhook error:', err);
    return c.json({ error: 'Webhook handler failed' }, 500);
  }
});

export default billing;
