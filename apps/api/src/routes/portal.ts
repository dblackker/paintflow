import { Hono } from 'hono';
import { createDb } from '@paintflow/db';
import { customers, estimates, jobs, portalTokens } from '@paintflow/db/schema';
import { eq, and } from 'drizzle-orm';
import type { Env, Variables } from '../types';

const portalApp = new Hono<{ Bindings: Env; Variables: Variables }>();

portalApp.get('/:token', async (c) => {
  const token = c.req.param('token');
  const db = createDb(c.env.DATABASE_URL);
  
  const portalToken = await db.query.portalTokens.findFirst({
    where: eq(portalTokens.token, token),
    with: {
      customer: true,
    },
  });
  
  if (!portalToken || new Date() > portalToken.expiresAt) {
    return c.json({ error: 'Invalid or expired token' }, 404);
  }
  
  const estimate = await db.query.estimates.findFirst({
    where: and(
      eq(estimates.customerId, portalToken.customerId),
      eq(estimates.status, 'sent')
    ),
  });
  
  const job = await db.query.jobs.findFirst({
    where: eq(jobs.customerId, portalToken.customerId),
  });
  
  return c.json({ 
    data: {
      customer: portalToken.customer,
      estimate,
      job,
    }
  });
});

portalApp.post('/:token/approve', async (c) => {
  const token = c.req.param('token');
  const db = createDb(c.env.DATABASE_URL);
  
  const portalToken = await db.query.portalTokens.findFirst({
    where: eq(portalTokens.token, token),
  });
  
  if (!portalToken) return c.json({ error: 'Invalid token' }, 404);
  
  const estimate = await db.query.estimates.findFirst({
    where: eq(estimates.customerId, portalToken.customerId),
  });
  
  if (estimate) {
    await db.update(estimates)
      .set({ status: 'approved', signedAt: new Date(), signedBy: portalToken.customerId })
      .where(eq(estimates.id, estimate.id));
  }
  
  return c.json({ success: true });
});

export default portalApp;

portalApp.post('/:token/pay', async (c) => {
  const token = c.req.param('token');
  const body = await c.req.json();
  const { amount } = body;
  const db = createDb(c.env.DATABASE_URL);
  
  const portalToken = await db.query.portalTokens.findFirst({
    where: eq(portalTokens.token, token),
    with: { customer: true },
  });
  
  if (!portalToken || new Date() > portalToken.expiresAt) {
    return c.json({ error: 'Invalid token' }, 404);
  }
  
  // Create Stripe payment intent
  const stripe = new (await import('stripe')).default(c.env.STRIPE_SECRET_KEY, {
    apiVersion: '2024-06-20',
  });
  
  const paymentIntent = await stripe.paymentIntents.create({
    amount: Math.round(amount * 100),
    currency: 'usd',
    metadata: {
      customerId: portalToken.customerId,
      portalToken: token,
    },
  });
  
  return c.json({ data: { clientSecret: paymentIntent.client_secret } });
});
