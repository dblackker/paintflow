import { Hono } from 'hono';
import { createDb } from '@paintflow/db';
import { saasPlans, subscriptions } from '@paintflow/db/schema';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';
import { eq, and } from 'drizzle-orm';
import Stripe from 'stripe';

const billing = new Hono<{ Bindings: Env; Variables: Variables }>();

const planPriceIds = (env: Env) => ({
  starter: env.STRIPE_STARTER_PRICE_ID,
  pro: env.STRIPE_PRO_PRICE_ID,
  enterprise: env.STRIPE_ENTERPRISE_PRICE_ID,
});

// POST /v1/billing/webhook
billing.post('/webhook', async (c) => {
  const sig = c.req.header('stripe-signature');
  if (!sig) {
    return c.json({ error: 'Missing signature' }, 400);
  }

  const body = await c.req.text();
  const stripe = new Stripe(c.env.STRIPE_SECRET_KEY);
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, c.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Stripe webhook signature verification failed:', err);
    return c.json({ error: 'Invalid signature' }, 400);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const orgId = session.metadata?.orgId;
    const plan = session.metadata?.plan;

    if (!orgId || !plan || typeof session.subscription !== 'string') {
      return c.json({ error: 'Missing subscription metadata' }, 400);
    }

    const db = createDb(c.env.DATABASE_URL);
    const [planRecord] = await db.select().from(saasPlans).where(eq(saasPlans.name, plan));
    if (!planRecord) {
      return c.json({ error: 'Unknown plan' }, 400);
    }

    await db.insert(subscriptions).values({
      orgId,
      planId: planRecord.id,
      stripeCustomerId: typeof session.customer === 'string' ? session.customer : undefined,
      stripeSubscriptionId: session.subscription,
      status: 'active',
    });
  }

  return c.json({ received: true });
});

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
  
  const priceIds = planPriceIds(c.env);
  const priceId = priceIds[plan as keyof ReturnType<typeof planPriceIds>];
  if (!priceId) {
    return c.json({ error: 'Unknown or unconfigured plan' }, 400);
  }
  
  const stripe = new Stripe(c.env.STRIPE_SECRET_KEY);
  
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${c.env.PUBLIC_URL}/billing?success=true`,
    cancel_url: `${c.env.PUBLIC_URL}/billing?canceled=true`,
    metadata: { orgId, plan },
  });
  
  return c.json({ url: session.url });
});

// POST /v1/billing/portal
billing.post('/portal', async (c) => {
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.orgId, orgId));
  
  if (!sub?.stripeCustomerId) {
    return c.json({ error: 'No subscription found' }, 404);
  }
  
  const stripe = new Stripe(c.env.STRIPE_SECRET_KEY);
  const session = await stripe.billingPortal.sessions.create({
    customer: sub.stripeCustomerId,
    return_url: `${c.env.PUBLIC_URL}/billing`,
  });
  
  return c.json({ url: session.url });
});

export default billing;
