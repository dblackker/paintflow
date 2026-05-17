import { Hono } from 'hono';
import { createDb } from '@paintflow/db';
import { saasPlans, subscriptions } from '@paintflow/db/schema';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';
import { eq, and } from 'drizzle-orm';
import Stripe from 'stripe';

const billing = new Hono<{ Bindings: Env; Variables: Variables }>();
billing.use('*', authMiddleware);

// GET /v1/billing/subscription
billing.get('/subscription', async (c) => {
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.orgId, orgId));
  
  if (!sub) return c.json({ data: null });
  
  const [plan] = await db.select().from(saasPlans).where(eq(saasPlans.id, sub.planId));
  return c.json({ data: { ...sub, plan } });
});

// POST /v1/billing/create-checkout
billing.post('/create-checkout', async (c) => {
  const orgId = c.get('orgId');
  const { plan } = await c.req.json();
  
  const stripe = new Stripe(c.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
  
  const priceIds = {
    starter: 'price_starter_49',
    pro: 'price_pro_149',
    enterprise: 'price_enterprise_399',
  };
  
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: priceIds[plan], quantity: 1 }],
    success_url: 'https://paintflow.app/billing?success=true',
    cancel_url: 'https://paintflow.app/billing?canceled=true',
    metadata: { orgId, plan },
  });
  
  return c.json({ url: session.url });
});

// POST /v1/billing/portal
billing.post('/portal', async (c) => {
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.orgId, orgId));
  
  if (!sub?.stripeSubscriptionId) {
    return c.json({ error: 'No subscription found' }, 404);
  }
  
  const stripe = new Stripe(c.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
  const session = await stripe.billingPortal.sessions.create({
    customer: sub.stripeSubscriptionId,
    return_url: 'https://paintflow.app/billing',
  });
  
  return c.json({ url: session.url });
});

// POST /v1/billing/webhook
billing.post('/webhook', async (c) => {
  const sig = c.req.header('stripe-signature');
  const body = await c.req.text();
  
  const stripe = new Stripe(c.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
  const event = stripe.webhooks.constructEvent(body, sig, c.env.STRIPE_WEBHOOK_SECRET);
  
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { orgId, plan } = session.metadata;
    
    const db = createDb(c.env.DATABASE_URL);
    const [planRecord] = await db.select().from(saasPlans).where(eq(saasPlans.name, plan));
    
    await db.insert(subscriptions).values({
      orgId,
      planId: planRecord.id,
      stripeSubscriptionId: session.subscription,
      status: 'active',
    });
  }
  
  return c.json({ received: true });
});

export default billing;
