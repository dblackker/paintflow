import { Hono } from 'hono';
import { createDb } from '@crewmodo/db';
import { saasPlans, subscriptions } from '@crewmodo/db/schema';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';
import { eq, and } from 'drizzle-orm';
import Stripe from 'stripe';
import { PLAN_DEFINITIONS, normalizePlanKey, planFeaturesPayload, type PlanKey } from '@crewmodo/core';

const billing = new Hono<{ Bindings: Env; Variables: Variables }>();

const planPriceIds = (env: Env) => ({
  starter: env.STRIPE_STARTER_PRICE_ID,
  pro: env.STRIPE_PRO_PRICE_ID,
  enterprise: env.STRIPE_ENTERPRISE_PRICE_ID,
});

function normalizePlan(value: unknown): PlanKey {
  return normalizePlanKey(value);
}

function normalizeStripeStatus(status: Stripe.Subscription.Status | string | null | undefined) {
  if (status === 'trialing') return 'trial';
  if (status === 'canceled') return 'canceled';
  if (status === 'past_due' || status === 'unpaid') return 'past_due';
  if (status === 'incomplete' || status === 'incomplete_expired') return status;
  return status || 'active';
}

function dateFromStripe(seconds: number | null | undefined) {
  return seconds ? new Date(seconds * 1000) : undefined;
}

function planFromStripeSubscription(env: Env, subscription: Stripe.Subscription): PlanKey | null {
  const metadataPlan = subscription.metadata?.plan;
  if (metadataPlan) return normalizePlan(metadataPlan);

  const priceId = subscription.items.data[0]?.price?.id;
  const priceIds = planPriceIds(env);
  const match = (Object.entries(priceIds) as Array<[PlanKey, string | undefined]>)
    .find(([, configuredPriceId]) => configuredPriceId && configuredPriceId === priceId);
  return match?.[0] || null;
}

async function ensurePlan(db: ReturnType<typeof createDb>, env: Env, plan: PlanKey) {
  const [existing] = await db.select().from(saasPlans).where(eq(saasPlans.name, plan));
  if (existing) return existing;
  const defaults = PLAN_DEFINITIONS[plan];
  const [created] = await db.insert(saasPlans).values({
    name: plan,
    price: defaults.price,
    interval: 'month',
    stripePriceId: planPriceIds(env)[plan],
    features: planFeaturesPayload(plan),
  }).returning();
  return created;
}

async function upsertSubscriptionFromStripe(
  db: ReturnType<typeof createDb>,
  env: Env,
  stripeSubscription: Stripe.Subscription,
  fallback?: { orgId?: string; plan?: PlanKey; stripeCustomerId?: string },
) {
  const existingByStripeId = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.stripeSubscriptionId, stripeSubscription.id),
  });
  const orgId = stripeSubscription.metadata?.orgId || fallback?.orgId || existingByStripeId?.orgId;
  const planKey = planFromStripeSubscription(env, stripeSubscription) || fallback?.plan;
  if (!orgId || !planKey) {
    if (orgId && existingByStripeId) {
      await db.update(subscriptions)
        .set({
          stripeCustomerId: typeof stripeSubscription.customer === 'string'
            ? stripeSubscription.customer
            : fallback?.stripeCustomerId || existingByStripeId.stripeCustomerId,
          stripeSubscriptionId: stripeSubscription.id,
          status: normalizeStripeStatus(stripeSubscription.status),
          currentPeriodStart: dateFromStripe(stripeSubscription.current_period_start),
          currentPeriodEnd: dateFromStripe(stripeSubscription.current_period_end),
        })
        .where(and(eq(subscriptions.orgId, orgId), eq(subscriptions.id, existingByStripeId.id)));
      return;
    }
    console.warn('Skipping Stripe subscription sync without org or plan context', {
      subscriptionId: stripeSubscription.id,
      hasOrgId: Boolean(orgId),
      hasPlan: Boolean(planKey),
    });
    return;
  }

  const planRecord = await ensurePlan(db, env, planKey);
  const stripeCustomerId = typeof stripeSubscription.customer === 'string'
    ? stripeSubscription.customer
    : fallback?.stripeCustomerId;
  const values = {
    orgId,
    planId: planRecord.id,
    stripeCustomerId,
    stripeSubscriptionId: stripeSubscription.id,
    status: normalizeStripeStatus(stripeSubscription.status),
    currentPeriodStart: dateFromStripe(stripeSubscription.current_period_start),
    currentPeriodEnd: dateFromStripe(stripeSubscription.current_period_end),
  };

  const existing = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.orgId, orgId),
  }) || existingByStripeId;
  if (existing) {
    await db.update(subscriptions)
      .set(values)
      .where(and(eq(subscriptions.orgId, orgId), eq(subscriptions.id, existing.id)));
  } else {
    await db.insert(subscriptions).values(values);
  }
}

async function syncSubscriptionById(db: ReturnType<typeof createDb>, env: Env, stripe: Stripe, subscriptionId: string) {
  const stripeSubscription = await stripe.subscriptions.retrieve(subscriptionId);
  const existing = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.stripeSubscriptionId, subscriptionId),
  });
  await upsertSubscriptionFromStripe(db, env, stripeSubscription, {
    orgId: existing?.orgId,
    stripeCustomerId: existing?.stripeCustomerId || undefined,
  });
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

  const db = createDb(c.env.DATABASE_URL);
  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const orgId = session.metadata?.orgId;
      const plan = session.metadata?.plan ? normalizePlan(session.metadata.plan) : undefined;

      if (!orgId || !plan || typeof session.subscription !== 'string') {
        return c.json({ error: 'Missing subscription metadata' }, 400);
      }

      const stripeSubscription = await stripe.subscriptions.retrieve(session.subscription);
      await upsertSubscriptionFromStripe(db, c.env, stripeSubscription, {
        orgId,
        plan,
        stripeCustomerId: typeof session.customer === 'string' ? session.customer : undefined,
      });
    } else if (
      event.type === 'customer.subscription.created'
      || event.type === 'customer.subscription.updated'
      || event.type === 'customer.subscription.deleted'
    ) {
      await upsertSubscriptionFromStripe(db, c.env, event.data.object);
    } else if (event.type === 'invoice.payment_succeeded' || event.type === 'invoice.payment_failed') {
      const invoice = event.data.object;
      const subscriptionId = typeof invoice.subscription === 'string' ? invoice.subscription : undefined;
      if (subscriptionId) {
        await syncSubscriptionById(db, c.env, stripe, subscriptionId);
      }
    }
  } catch (err) {
    console.error('Stripe subscription webhook sync failed:', { eventType: event.type, eventId: event.id, err });
    return c.json({ error: 'Webhook received, but subscription sync failed.' }, 500);
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

// GET /v1/billing/entitlements
billing.get('/entitlements', async (c) => {
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.orgId, orgId));
  if (!sub) {
    const fallback = planFeaturesPayload('starter');
    return c.json({
      data: {
        plan: 'starter',
        status: 'trial_pending_payment',
        features: fallback.features,
        limits: fallback.limits,
      },
    });
  }

  const [plan] = await db.select().from(saasPlans).where(eq(saasPlans.id, sub.planId));
  const planKey = normalizePlan(plan?.name);
  const payload = planFeaturesPayload(planKey);
  return c.json({
    data: {
      plan: planKey,
      displayName: payload.displayName,
      status: sub.status,
      features: payload.features,
      limits: payload.limits,
    },
  });
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
    subscription_data: {
      metadata: { orgId, plan: planKey },
    },
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
