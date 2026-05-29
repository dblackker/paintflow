import { Hono } from 'hono';
import { createDb } from '@crewmodo/db';
import { saasPlans, subscriptions } from '@crewmodo/db/schema';
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

const planDefaults = {
  starter: { price: '49.00', displayName: 'Starter', userLimit: 3 },
  pro: { price: '149.00', displayName: 'Pro', userLimit: 10 },
  enterprise: { price: '399.00', displayName: 'Enterprise', userLimit: null },
} as const;

type PlanKey = keyof typeof planDefaults;

function normalizePlan(value: unknown): PlanKey {
  return value === 'starter' || value === 'enterprise' ? value : 'pro';
}

async function ensurePlan(db: ReturnType<typeof createDb>, env: Env, plan: PlanKey) {
  const [existing] = await db.select().from(saasPlans).where(eq(saasPlans.name, plan));
  if (existing) return existing;
  const defaults = planDefaults[plan];
  const [created] = await db.insert(saasPlans).values({
    name: plan,
    price: defaults.price,
    interval: 'month',
    stripePriceId: planPriceIds(env)[plan],
    features: defaults,
  }).returning();
  return created;
}

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
    const planKey = normalizePlan(plan);
    const planRecord = await ensurePlan(db, c.env, planKey);
    const stripe = new Stripe(c.env.STRIPE_SECRET_KEY);
    const subscription = await stripe.subscriptions.retrieve(session.subscription);
    const status = subscription.status === 'trialing' ? 'trial' : subscription.status;

    const existing = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.orgId, orgId),
    });
    const values = {
      orgId,
      planId: planRecord.id,
      stripeCustomerId: typeof session.customer === 'string' ? session.customer : undefined,
      stripeSubscriptionId: session.subscription,
      status,
      currentPeriodStart: new Date(subscription.current_period_start * 1000),
      currentPeriodEnd: new Date(subscription.current_period_end * 1000),
    };
    if (existing) {
      await db.update(subscriptions)
        .set(values)
        .where(and(eq(subscriptions.orgId, orgId), eq(subscriptions.id, existing.id)));
    } else {
      await db.insert(subscriptions).values(values);
    }
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
  const planKey = normalizePlan(plan);
  
  const priceIds = planPriceIds(c.env);
  const priceId = priceIds[planKey];
  if (!priceId) {
    return c.json({ error: 'Unknown or unconfigured plan' }, 400);
  }
  if (priceId.startsWith('price_replace')) {
    return c.json({ error: 'Stripe subscription price IDs are not configured yet.' }, 503);
  }
  
  const stripe = new Stripe(c.env.STRIPE_SECRET_KEY);
  await ensurePlan(createDb(c.env.DATABASE_URL), c.env, planKey);
  
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${c.env.PUBLIC_URL}/billing?success=true`,
    cancel_url: `${c.env.PUBLIC_URL}/billing?canceled=true`,
    metadata: { orgId, plan: planKey },
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
