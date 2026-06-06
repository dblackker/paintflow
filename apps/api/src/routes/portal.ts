import { Hono } from 'hono';
import { createDb } from '@crewmodo/db';
import { auditLogs, changeOrders, customerInvoices, customerPayments, estimates, jobs, leads, notificationEvents, portalTokens, stripeConnections } from '@crewmodo/db/schema';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Env, Variables } from '../types';
import { createCheckoutSession } from '../lib/stripe';
import { createInvoiceForChangeOrder } from '../lib/customer-invoices';
import { sendInvoiceEmail } from '../lib/invoice-emails';

const portalApp = new Hono<{ Bindings: Env; Variables: Variables }>();

function isValidSignatureData(value: unknown) {
  return typeof value === 'string' && value.startsWith('data:image/') && value.length > 100 && value.length < 100000;
}

function leadNameFromApproval(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 80) : 'Customer';
}

function netPayment(payment: typeof customerPayments.$inferSelect) {
  if (!['succeeded', 'paid', 'partially_refunded', 'refunded'].includes(payment.status)) return 0;
  return Number(payment.amount || 0) - Number(payment.refundedAmount || 0);
}

function effectiveInvoiceStatus(invoice: typeof customerInvoices.$inferSelect, payments: Array<typeof customerPayments.$inferSelect>) {
  if (['canceled', 'voided'].includes(invoice.status)) return invoice.status;
  const payable = payments.filter((payment) => ['succeeded', 'paid', 'partially_refunded', 'refunded'].includes(payment.status));
  const grossPaid = payable.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const refunded = payable.reduce((sum, payment) => sum + Number(payment.refundedAmount || 0), 0);
  const netPaid = Math.max(grossPaid - refunded, 0);
  const total = Number(invoice.total || 0);
  if (grossPaid > 0.005 && refunded >= grossPaid - 0.005) return 'refunded';
  if (refunded > 0.005) return 'partially_refunded';
  if (netPaid >= total - 0.005) return 'paid';
  if (netPaid > 0.005) return 'partially_paid';
  return invoice.status === 'payment_pending' && total - netPaid > 0.005 ? 'sent' : invoice.status;
}

portalApp.get('/:token', async (c) => {
  const token = c.req.param('token');
  const changeOrderId = c.req.query('changeOrderId');
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
  
  const focusedChangeOrder = changeOrderId
    ? await db.query.changeOrders.findFirst({
      where: and(eq(changeOrders.id, changeOrderId), eq(changeOrders.orgId, portalToken.orgId)),
    })
    : null;
  const estimate = focusedChangeOrder ? null : await db.query.estimates.findFirst({
    where: and(
      eq(estimates.leadId, portalToken.leadId),
      eq(estimates.orgId, portalToken.orgId),
      inArray(estimates.status, ['sent', 'accepted'])
    ),
    orderBy: [desc(estimates.createdAt)],
  });
  const job = focusedChangeOrder
    ? await db.query.jobs.findFirst({
      where: and(eq(jobs.id, focusedChangeOrder.jobId), eq(jobs.orgId, portalToken.orgId), eq(jobs.leadId, portalToken.leadId)),
    })
    : await db.query.jobs.findFirst({
      where: and(eq(jobs.leadId, portalToken.leadId), eq(jobs.orgId, portalToken.orgId)),
    });

  const orders = job
    ? await db.query.changeOrders.findMany({
      where: focusedChangeOrder
        ? and(eq(changeOrders.id, focusedChangeOrder.id), eq(changeOrders.orgId, portalToken.orgId))
        : and(eq(changeOrders.jobId, job.id), eq(changeOrders.orgId, portalToken.orgId)),
      orderBy: [desc(changeOrders.createdAt)],
    })
    : [];

  const invoiceRows = await db.query.customerInvoices.findMany({
    where: focusedChangeOrder
      ? and(eq(customerInvoices.orgId, portalToken.orgId), eq(customerInvoices.leadId, portalToken.leadId), eq(customerInvoices.changeOrderId, focusedChangeOrder.id))
      : and(eq(customerInvoices.orgId, portalToken.orgId), eq(customerInvoices.leadId, portalToken.leadId)),
    orderBy: (table, { desc }) => [desc(table.createdAt)],
    limit: 25,
  });
  const invoicePayments = invoiceRows.length
    ? await db.query.customerPayments.findMany({
      where: and(eq(customerPayments.orgId, portalToken.orgId), eq(customerPayments.leadId, portalToken.leadId)),
      orderBy: (table, { desc }) => [desc(table.receivedAt)],
      limit: 100,
    })
    : [];
  const paymentsByInvoice = new Map<string, Array<typeof customerPayments.$inferSelect>>();
  invoicePayments.forEach((payment) => {
    if (!payment.invoiceId) return;
    const list = paymentsByInvoice.get(payment.invoiceId) || [];
    list.push(payment);
    paymentsByInvoice.set(payment.invoiceId, list);
  });
  
  return c.json({ 
    data: {
      customer: lead,
      estimate,
      job,
      changeOrders: orders,
      invoices: invoiceRows
        .filter((invoice) => !['voided', 'canceled'].includes(invoice.status))
        .map((invoice) => {
          const payments = paymentsByInvoice.get(invoice.id) || [];
          const paidAmount = payments.reduce((sum, payment) => sum + netPayment(payment), 0);
          const balanceDue = Math.max(Number(invoice.total || 0) - paidAmount, 0);
          const status = effectiveInvoiceStatus(invoice, payments);
          return {
            ...invoice,
            status,
            payments,
            paidAmount,
            balanceDue,
          };
        }),
    }
  });
});

portalApp.post('/:token/approve', async (c) => {
  return c.json({ error: 'Open the proposal and complete e-signature before payment or scheduling.' }, 410);
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
  if (['canceled', 'rejected'].includes(order.status)) {
    return c.json({ error: 'This change order is no longer available for approval.' }, 409);
  }
  if (order.status === 'completed') {
    return c.json({ error: 'This change order is already complete.' }, 409);
  }

  const job = await db.query.jobs.findFirst({
    where: and(eq(jobs.id, order.jobId), eq(jobs.orgId, portalToken.orgId), eq(jobs.leadId, portalToken.leadId)),
  });
  if (!job) return c.json({ error: 'Change order not available for this customer' }, 404);

  const approvedAt = new Date();
  const paymentRequired = Boolean(order.paymentRequired);
  const approvedBy = typeof body.approvedBy === 'string' && body.approvedBy.trim() ? body.approvedBy.trim().slice(0, 255) : '';
  const signatureData = typeof body.signatureData === 'string' ? body.signatureData : '';
  if (!order.contractorSignature) {
    return c.json({ error: 'The contractor has not countersigned this change order yet. Ask them to send or update the approval link.' }, 409);
  }
  if (order.customerSignedAt) {
    return c.json({ error: 'This change order has already been signed.' }, 409);
  }
  if (!approvedBy) {
    return c.json({ error: 'Please enter the customer signature name.' }, 400);
  }
  if (!isValidSignatureData(signatureData)) {
    return c.json({ error: 'Please add your signature.' }, 400);
  }
  const [updated] = await db.update(changeOrders)
    .set({
      status: 'approved',
      approvedAt: order.approvedAt || approvedAt,
      approvedBy,
      customerSignatureName: approvedBy,
      customerSignatureData: signatureData,
      customerSignedAt: approvedAt,
      signedIp: c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || null,
      signedUserAgent: c.req.header('user-agent') || null,
      paymentStatus: paymentRequired ? (order.paymentStatus === 'paid' ? 'paid' : 'pending') : 'not_requested',
    })
    .where(and(eq(changeOrders.id, id), eq(changeOrders.orgId, portalToken.orgId)))
    .returning();

  const invoice = await createInvoiceForChangeOrder(db, updated, portalToken.leadId);
  if (invoice) {
    try {
      await sendInvoiceEmail(c.env, db, {
        orgId: portalToken.orgId,
        invoice,
        templateKey: 'invoice.change_order.created',
      });
    } catch (error) {
      console.error('Failed to send change order invoice email:', error);
    }
  }

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
      invoiceId: invoice?.id || null,
    },
    ipAddress: c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || undefined,
    userAgent: c.req.header('user-agent') || undefined,
  });

  await db.insert(notificationEvents).values({
    orgId: portalToken.orgId,
    type: 'change_order.approved',
    title: 'Change order approved',
    body: `${leadNameFromApproval(body.approvedBy)} approved a ${Number(order.amount || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' })} change order.`,
    href: `/jobs/${job.id}`,
    priority: 'high',
    sourceType: 'change_order',
    sourceId: id,
    leadId: portalToken.leadId,
    metadata: {
      jobId: job.id,
      amount: order.amount,
      paymentRequired,
      invoiceId: invoice?.id || null,
    },
  });

  return c.json({ data: { ...updated, invoiceId: invoice?.id || null } });
});

portalApp.post('/:token/invoices/:id/checkout', async (c) => {
  const token = c.req.param('token');
  const id = c.req.param('id');
  const db = createDb(c.env.DATABASE_URL);

  const portalToken = await db.query.portalTokens.findFirst({
    where: eq(portalTokens.token, token),
  });
  if (!portalToken || new Date() > portalToken.expiresAt) {
    return c.json({ error: 'Invalid token' }, 404);
  }

  const invoice = await db.query.customerInvoices.findFirst({
    where: and(eq(customerInvoices.id, id), eq(customerInvoices.orgId, portalToken.orgId), eq(customerInvoices.leadId, portalToken.leadId)),
  });
  if (!invoice) return c.json({ error: 'Invoice not found' }, 404);
  if (['paid', 'refunded', 'voided', 'canceled'].includes(invoice.status)) {
    return c.json({ error: 'This invoice is not payable.' }, 409);
  }

  const stripeConnection = await db.query.stripeConnections.findFirst({
    where: eq(stripeConnections.orgId, portalToken.orgId),
  });
  if (!stripeConnection?.onboardingComplete) {
    return c.json({ error: 'Online payments are not ready for this contractor' }, 409);
  }

  const payments = await db.query.customerPayments.findMany({
    where: and(eq(customerPayments.orgId, portalToken.orgId), eq(customerPayments.invoiceId, invoice.id)),
    orderBy: (table, { desc }) => [desc(table.receivedAt)],
    limit: 100,
  });
  const paidAmount = payments.reduce((sum, payment) => sum + netPayment(payment), 0);
  const amountDue = Math.round(Math.max(Number(invoice.total || 0) - paidAmount, 0) * 100) / 100;
  if (!Number.isFinite(amountDue) || amountDue <= 0.005) {
    return c.json({ error: 'This invoice is already paid.' }, 409);
  }

  const baseUrl = c.env.PUBLIC_URL || 'https://crewmodo.com';
  const session = await createCheckoutSession(c.env, {
    amount: amountDue,
    successUrl: `${baseUrl}/portal/${token}?invoicePaid=${id}`,
    cancelUrl: `${baseUrl}/portal/${token}?invoicePaymentCanceled=${id}`,
    productName: invoice.description || invoice.invoiceNumber || 'Crewmodo Invoice',
    connectedAccountId: stripeConnection.stripeAccountId,
    metadata: {
      orgId: portalToken.orgId,
      leadId: portalToken.leadId,
      invoiceId: invoice.id,
      estimateId: invoice.estimateId || '',
      jobId: invoice.jobId || '',
      changeOrderId: invoice.changeOrderId || '',
      portalToken: token,
    },
  });

  return c.json({ data: { checkoutUrl: session.url, sessionId: session.id } });
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
  if (order.status !== 'approved' && order.status !== 'completed') return c.json({ error: 'Sign and approve this change order before paying.' }, 409);
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

  const baseUrl = c.env.PUBLIC_URL || 'https://crewmodo.com';
  const session = await createCheckoutSession(c.env, {
    amount,
    successUrl: `${baseUrl}/portal/${token}?changeOrderId=${id}&changeOrderPaid=${id}`,
    cancelUrl: `${baseUrl}/portal/${token}?changeOrderId=${id}&changeOrderPaymentCanceled=${id}`,
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
