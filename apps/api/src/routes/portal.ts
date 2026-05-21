import { Hono } from 'hono';
import { createDb } from '@paintflow/db';
import { auditLogs, changeOrders, estimates, jobs, leads, portalTokens, stripeConnections } from '@paintflow/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import type { Env, Variables } from '../types';
import { createJobFromAcceptedEstimate } from '../lib/estimate-handoff';
import { createCheckoutSession } from '../lib/stripe';

const portalApp = new Hono<{ Bindings: Env; Variables: Variables }>();

portalApp.get('/:token', async (c) => {
  const token = c.req.param('token');
  const db = createDb(c.env.DATABASE_URL);
  
  const portalToken = await db.query.portalTokens.findFirst({
    where: eq(portalTokens.token, token),
  });
  
  if (!portalToken || new Date() > portalToken.expiresAt) {
    return c.json({ error: 'Invalid or expired token' }, 404);
  }

  const lead = await db.query.leads.findFirst({
    where: and(eq(leads.id, portalToken.leadId), eq(leads.orgId, portalToken.orgId)),
  });
  
  const estimate = await db.query.estimates.findFirst({
    where: and(
      eq(estimates.leadId, portalToken.leadId),
      eq(estimates.orgId, portalToken.orgId),
      eq(estimates.status, 'sent')
    ),
    orderBy: [desc(estimates.createdAt)],
  });
  
  const job = await db.query.jobs.findFirst({
    where: and(eq(jobs.leadId, portalToken.leadId), eq(jobs.orgId, portalToken.orgId)),
  });

  const orders = job
    ? await db.query.changeOrders.findMany({
      where: and(eq(changeOrders.jobId, job.id), eq(changeOrders.orgId, portalToken.orgId)),
      orderBy: [desc(changeOrders.createdAt)],
    })
    : [];
  
  return c.json({ 
    data: {
      customer: lead,
      estimate,
      job,
      changeOrders: orders,
    }
  });
});

portalApp.post('/:token/approve', async (c) => {
  const token = c.req.param('token');
  const db = createDb(c.env.DATABASE_URL);
  
  const portalToken = await db.query.portalTokens.findFirst({
    where: eq(portalTokens.token, token),
  });
  
  if (!portalToken || new Date() > portalToken.expiresAt) {
    return c.json({ error: 'Invalid token' }, 404);
  }
  
  const estimate = await db.query.estimates.findFirst({
    where: and(
      eq(estimates.leadId, portalToken.leadId),
      eq(estimates.orgId, portalToken.orgId),
      eq(estimates.status, 'sent')
    ),
    orderBy: [desc(estimates.createdAt)],
  });
  
  let jobId: string | undefined;
  if (estimate) {
    const [acceptedEstimate] = await db.update(estimates)
      .set({ status: 'accepted', signedAt: new Date() })
      .where(eq(estimates.id, estimate.id))
      .returning();

    const job = await createJobFromAcceptedEstimate(db, acceptedEstimate);
    jobId = job.id;
  }
  
  return c.json({ success: true, jobId });
});

portalApp.post('/:token/change-orders/:id/approve', async (c) => {
  const token = c.req.param('token');
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const db = createDb(c.env.DATABASE_URL);

  const portalToken = await db.query.portalTokens.findFirst({
    where: eq(portalTokens.token, token),
  });
  if (!portalToken || new Date() > portalToken.expiresAt) {
    return c.json({ error: 'Invalid token' }, 404);
  }

  const order = await db.query.changeOrders.findFirst({
    where: and(eq(changeOrders.id, id), eq(changeOrders.orgId, portalToken.orgId)),
  });
  if (!order) return c.json({ error: 'Change order not found' }, 404);

  const job = await db.query.jobs.findFirst({
    where: and(eq(jobs.id, order.jobId), eq(jobs.orgId, portalToken.orgId), eq(jobs.leadId, portalToken.leadId)),
  });
  if (!job) return c.json({ error: 'Change order not available for this customer' }, 404);

  const approvedAt = new Date();
  const paymentRequired = Boolean(order.paymentRequired);
  const [updated] = await db.update(changeOrders)
    .set({
      status: 'approved',
      approvedAt: order.approvedAt || approvedAt,
      approvedBy: typeof body.approvedBy === 'string' && body.approvedBy.trim() ? body.approvedBy.trim().slice(0, 255) : 'customer',
      signedIp: c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || null,
      signedUserAgent: c.req.header('user-agent') || null,
      paymentStatus: paymentRequired ? (order.paymentStatus === 'paid' ? 'paid' : 'pending') : 'not_requested',
    })
    .where(and(eq(changeOrders.id, id), eq(changeOrders.orgId, portalToken.orgId)))
    .returning();

  await db.insert(auditLogs).values({
    orgId: portalToken.orgId,
    action: 'change_order.approved',
    entityType: 'change_order',
    entityId: id,
    metadata: {
      jobId: job.id,
      leadId: portalToken.leadId,
      amount: order.amount,
      paymentRequired,
    },
    ipAddress: c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || undefined,
    userAgent: c.req.header('user-agent') || undefined,
  });

  return c.json({ data: updated });
});

portalApp.post('/:token/change-orders/:id/checkout', async (c) => {
  const token = c.req.param('token');
  const id = c.req.param('id');
  const db = createDb(c.env.DATABASE_URL);

  const portalToken = await db.query.portalTokens.findFirst({
    where: eq(portalTokens.token, token),
  });
  if (!portalToken || new Date() > portalToken.expiresAt) {
    return c.json({ error: 'Invalid token' }, 404);
  }

  const order = await db.query.changeOrders.findFirst({
    where: and(eq(changeOrders.id, id), eq(changeOrders.orgId, portalToken.orgId)),
  });
  if (!order) return c.json({ error: 'Change order not found' }, 404);

  const job = await db.query.jobs.findFirst({
    where: and(eq(jobs.id, order.jobId), eq(jobs.orgId, portalToken.orgId), eq(jobs.leadId, portalToken.leadId)),
  });
  if (!job) return c.json({ error: 'Change order not available for this customer' }, 404);
  if (!order.paymentRequired) return c.json({ error: 'Payment is not required for this change order' }, 400);
  if (order.paymentStatus === 'paid') return c.json({ error: 'This change order is already paid' }, 400);

  const stripeConnection = await db.query.stripeConnections.findFirst({
    where: eq(stripeConnections.orgId, portalToken.orgId),
  });
  if (!stripeConnection?.onboardingComplete) {
    return c.json({ error: 'Online payments are not ready for this contractor' }, 409);
  }

  const amount = Number(order.paymentDueAmount || 0) || Math.round(Number(order.amount || 0) * (Number(order.depositPercent || 100) / 100) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) {
    return c.json({ error: 'Invalid payment amount' }, 400);
  }

  const baseUrl = c.env.PUBLIC_URL || 'https://paintflow.app';
  const session = await createCheckoutSession(c.env, {
    amount,
    successUrl: `${baseUrl}/portal/${token}?changeOrderPaid=${id}`,
    cancelUrl: `${baseUrl}/portal/${token}?changeOrderPaymentCanceled=${id}`,
    productName: 'Painting Change Order',
    connectedAccountId: stripeConnection.stripeAccountId,
    metadata: {
      orgId: portalToken.orgId,
      leadId: portalToken.leadId,
      jobId: job.id,
      changeOrderId: id,
      portalToken: token,
    },
  });

  await db.update(changeOrders)
    .set({
      paymentStatus: 'pending',
      stripeCheckoutSessionId: session.id,
    })
    .where(and(eq(changeOrders.id, id), eq(changeOrders.orgId, portalToken.orgId)));

  return c.json({ data: { checkoutUrl: session.url, sessionId: session.id } });
});

portalApp.post('/:token/pay', async (c) => {
  const token = c.req.param('token');
  const body = await c.req.json();
  const { amount } = body;
  const db = createDb(c.env.DATABASE_URL);
  
  const portalToken = await db.query.portalTokens.findFirst({
    where: eq(portalTokens.token, token),
  });
  
  if (!portalToken || new Date() > portalToken.expiresAt) {
    return c.json({ error: 'Invalid token' }, 404);
  }

  const stripeConnection = await db.query.stripeConnections.findFirst({
    where: eq(stripeConnections.orgId, portalToken.orgId),
  });
  if (!stripeConnection?.onboardingComplete) {
    return c.json({ error: 'Online payments are not ready for this contractor' }, 409);
  }
  
  // Create Stripe payment intent
  const stripe = new (await import('stripe')).default(c.env.STRIPE_SECRET_KEY);
  
  const paymentIntent = await stripe.paymentIntents.create({
    amount: Math.round(amount * 100),
    currency: 'usd',
    metadata: {
      leadId: portalToken.leadId,
      orgId: portalToken.orgId,
      portalToken: token,
    },
  }, {
    stripeAccount: stripeConnection.stripeAccountId,
  });
  
  return c.json({ data: { clientSecret: paymentIntent.client_secret } });
});

export default portalApp;
