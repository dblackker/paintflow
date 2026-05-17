import { Hono } from 'hono';
import { createDb } from '@paintflow/db';
import { estimates } from '@paintflow/db/schema';
import { eq } from 'drizzle-orm';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';

const billing = new Hono<{ Bindings: Env; Variables: Variables }>();

billing.use('*', authMiddleware);

// POST /v1/billing/checkout
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
  
  // Create Stripe Checkout Session
  // const session = await stripe.checkout.sessions.create({
  //   mode: 'payment',
  //   line_items: [{
  //     price_data: {
  //       currency: 'usd',
  //       product_data: { name: `${packageName} Package` },
  //       unit_amount: Math.round(pkg.total * 100),
  //     },
  //     quantity: 1,
  //   }],
  //   success_url: `${c.env.APP_URL}/estimates/${estimateId}/success`,
  //   cancel_url: `${c.env.APP_URL}/estimates/${estimateId}`,
  //   metadata: { estimateId, orgId },
  // });
  
  // For now, return mock
  return c.json({ 
    checkoutUrl: `https://checkout.stripe.com/pay/mock_${estimateId}`,
    amount: pkg.total,
  });
});

// POST /v1/billing/webhook
billing.post('/webhook', async (c) => {
  // Verify Stripe signature
  // const sig = c.req.header('stripe-signature');
  // const body = await c.req.text();
  
  // const event = stripe.webhooks.constructEvent(body, sig, env.STRIPE_WEBHOOK_SECRET);
  
  // if (event.type === 'checkout.session.completed') {
  //   const { estimateId } = event.data.object.metadata;
  //   await db.update(estimates).set({ status: 'accepted' }).where(eq(estimates.id, estimateId));
  // }
  
  return c.json({ received: true });
});

export default billing;
