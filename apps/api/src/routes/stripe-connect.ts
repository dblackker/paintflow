import { Hono } from 'hono';
import { createDb } from '@paintflow/db';
import { organizations, orgSettings, stripeConnections } from '@paintflow/db/schema';
import { eq } from 'drizzle-orm';
import Stripe from 'stripe';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';

const stripeConnect = new Hono<{ Bindings: Env; Variables: Variables }>();
stripeConnect.use('*', authMiddleware);

function stripeClient(env: Env) {
  return new Stripe(env.STRIPE_SECRET_KEY);
}

function hasConfiguredStripeKey(env: Env) {
  return Boolean(env.STRIPE_SECRET_KEY?.startsWith('sk_') && !env.STRIPE_SECRET_KEY.includes('replace_me'));
}

function connectionPayload(connection: typeof stripeConnections.$inferSelect | null) {
  return {
    connected: Boolean(connection?.stripeAccountId),
    accountId: connection?.stripeAccountId,
    chargesEnabled: Boolean(connection?.chargesEnabled),
    payoutsEnabled: Boolean(connection?.payoutsEnabled),
    detailsSubmitted: Boolean(connection?.detailsSubmitted),
    onboardingComplete: Boolean(connection?.onboardingComplete),
    connectedAt: connection?.connectedAt,
    updatedAt: connection?.updatedAt,
  };
}

async function syncStripeConnection(env: Env, orgId: string, accountId: string) {
  const stripe = stripeClient(env);
  const account = await stripe.accounts.retrieve(accountId);
  const onboardingComplete = Boolean(account.details_submitted && account.charges_enabled && account.payouts_enabled);
  const db = createDb(env.DATABASE_URL);
  const [connection] = await db.update(stripeConnections)
    .set({
      chargesEnabled: Boolean(account.charges_enabled),
      payoutsEnabled: Boolean(account.payouts_enabled),
      detailsSubmitted: Boolean(account.details_submitted),
      onboardingComplete,
      updatedAt: new Date(),
    })
    .where(eq(stripeConnections.orgId, orgId))
    .returning();

  return connection;
}

stripeConnect.get('/status', async (c) => {
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);
  const connection = await db.query.stripeConnections.findFirst({
    where: eq(stripeConnections.orgId, orgId),
  });

  if (!connection) {
    return c.json({ data: connectionPayload(null) });
  }

  try {
    const synced = await syncStripeConnection(c.env, orgId, connection.stripeAccountId);
    return c.json({ data: connectionPayload(synced) });
  } catch (err) {
    console.error('Failed to sync Stripe account status:', err);
    return c.json({ data: connectionPayload(connection) });
  }
});

stripeConnect.post('/connect', async (c) => {
  const orgId = c.get('orgId');
  if (!hasConfiguredStripeKey(c.env)) {
    return c.json({ error: 'Stripe is not configured. Add a valid Stripe secret key to STRIPE_SECRET_KEY, then restart the API.' }, 503);
  }

  const db = createDb(c.env.DATABASE_URL);
  const stripe = stripeClient(c.env);

  let connection = await db.query.stripeConnections.findFirst({
    where: eq(stripeConnections.orgId, orgId),
  });

  try {
    if (!connection) {
      const org = await db.query.organizations.findFirst({
        where: eq(organizations.id, orgId),
      });
      const settings = await db.query.orgSettings.findFirst({
        where: eq(orgSettings.orgId, orgId),
      });

      const account = await stripe.accounts.create({
        type: 'express',
        country: 'US',
        email: settings?.email || undefined,
        business_type: 'company',
        business_profile: {
          name: settings?.companyName || org?.name,
          product_description: 'Residential and commercial painting services',
          url: settings?.website || undefined,
        },
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        metadata: { orgId },
      });

      [connection] = await db.insert(stripeConnections).values({
        orgId,
        stripeAccountId: account.id,
        chargesEnabled: Boolean(account.charges_enabled),
        payoutsEnabled: Boolean(account.payouts_enabled),
        detailsSubmitted: Boolean(account.details_submitted),
        onboardingComplete: Boolean(account.details_submitted && account.charges_enabled && account.payouts_enabled),
      }).returning();
    }

    const accountLink = await stripe.accountLinks.create({
      account: connection.stripeAccountId,
      refresh_url: `${c.env.PUBLIC_URL}/payments/stripe?refresh=true`,
      return_url: `${c.env.PUBLIC_URL}/payments/stripe?return=true`,
      type: 'account_onboarding',
    });

    return c.json({ url: accountLink.url });
  } catch (err) {
    console.error('Failed to start Stripe Connect onboarding:', err);
    return c.json({ error: 'Stripe setup could not start. Check your Stripe API key and Connect platform settings.' }, 502);
  }
});

stripeConnect.post('/dashboard', async (c) => {
  const orgId = c.get('orgId');
  if (!hasConfiguredStripeKey(c.env)) {
    return c.json({ error: 'Stripe is not configured. Add a valid Stripe secret key to STRIPE_SECRET_KEY, then restart the API.' }, 503);
  }

  const db = createDb(c.env.DATABASE_URL);
  const connection = await db.query.stripeConnections.findFirst({
    where: eq(stripeConnections.orgId, orgId),
  });

  if (!connection) {
    return c.json({ error: 'Stripe is not connected' }, 404);
  }

  const stripe = stripeClient(c.env);
  const loginLink = await stripe.accounts.createLoginLink(connection.stripeAccountId);
  return c.json({ url: loginLink.url });
});

stripeConnect.post('/disconnect', async (c) => {
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);
  await db.delete(stripeConnections).where(eq(stripeConnections.orgId, orgId));
  return c.json({ success: true });
});

export default stripeConnect;
