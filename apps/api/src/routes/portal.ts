import { Hono } from 'hono';
import { createDb } from '@crewmodo/db';
import { auditLogs, changeOrders, customerInvoices, customerPayments, estimates, jobs, leads, notificationEvents, portalTokens, stripeConnections } from '@crewmodo/db/schema';
import { and, desc, eq, inArray, isNotNull, isNull, notInArray, or } from 'drizzle-orm';
import type { Context } from 'hono';
import type { Env, Variables } from '../types';
import { createCheckoutSession } from '../lib/stripe';
import { createInvoiceForChangeOrder } from '../lib/customer-invoices';
import { sendInvoiceEmail } from '../lib/invoice-emails';
import { PaymentOperationError, readPaymentBalance, usdMinor, type ObligationBalance } from '../lib/payment-operations';
import { decimal, minor, moneyText } from '../../../../packages/core/src/estimation-decimal';
import { publicEstimatePackages } from '../../../../packages/core/src/estimation-public';
import { estimateContractValue } from '../lib/estimate-handoff';

type Db = ReturnType<typeof createDb>;
type PortalContext = Context<{ Bindings: Env; Variables: Variables }>;
type Invoice = typeof customerInvoices.$inferSelect;
type PortalToken = typeof portalTokens.$inferSelect;
type PortalDependencies = {
  db: typeof createDb;
  balance: typeof readPaymentBalance;
  checkout: typeof createCheckoutSession;
};

export class PortalPaymentError extends Error {
  constructor(message: string, public code: string, public status: 409 | 503 = 409) { super(message); }
}

function isValidSignatureData(value: unknown) {
  return typeof value === 'string' && value.startsWith('data:image/') && value.length > 100 && value.length < 100000;
}

function leadNameFromApproval(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 80) : 'Customer';
}

function balanceMinor(value: string | number) {
  const amount = minor(decimal(value, 'balance', { scale: 2 }), 'balance');
  if (amount < 0) throw new PortalPaymentError('Payment balance needs review.', 'PAYMENT_BALANCE_UNAVAILABLE', 503);
  return amount;
}

function checkedBalance(balance: ObligationBalance) {
  try {
    if (typeof balance.closed !== 'boolean' || typeof balance.needsReview !== 'boolean'
      || !Number.isSafeInteger(balance.pendingRefunds) || balance.pendingRefunds < 0) throw new Error();
    for (const value of [balance.remaining, balance.total, balance.allocated, balance.credits, balance.netCollected]) balanceMinor(value);
    return { ...balance, remaining: moneyText(balanceMinor(balance.remaining)), total: moneyText(balanceMinor(balance.total)),
      allocated: moneyText(balanceMinor(balance.allocated)), credits: moneyText(balanceMinor(balance.credits)), netCollected: moneyText(balanceMinor(balance.netCollected)) };
  } catch {
    throw new PortalPaymentError('Payment balance could not be verified. Try again later.', 'PAYMENT_BALANCE_UNAVAILABLE', 503);
  }
}

export function portalInvoicePaymentState(invoice: Pick<Invoice, 'status' | 'dueDate'>, supplied: ObligationBalance,
  options: { agreement?: ObligationBalance; processing?: boolean; now?: Date } = {}) {
  const balance = checkedBalance(supplied);
  const agreement = options.agreement ? checkedBalance(options.agreement) : undefined;
  const remainingMinor = Math.min(balanceMinor(balance.remaining), agreement ? balanceMinor(agreement.remaining) : Number.MAX_SAFE_INTEGER);
  const closed = balance.closed || Boolean(agreement?.closed) || ['canceled', 'voided', 'refunded'].includes(invoice.status);
  const needsReview = balance.needsReview || Boolean(agreement?.needsReview)
    || (invoice.status === 'paid' && remainingMinor > 0)
    || !['draft', 'sent', 'open', 'overdue', 'partially_paid', 'payment_pending', 'processing', 'paid', 'partially_refunded', 'refunded', 'canceled', 'voided'].includes(invoice.status);
  const refundPending = balance.pendingRefunds > 0 || (agreement?.pendingRefunds ?? 0) > 0;
  const processing = Boolean(options.processing);
  const credits = balanceMinor(balance.credits);
  let status = invoice.status;
  let paymentUnavailableReason: string | null = null;
  if (needsReview) {
    status = 'needs_review';
    paymentUnavailableReason = 'Your contractor needs to review this payment balance.';
  } else if (closed) {
    status = ['canceled', 'voided'].includes(invoice.status) ? invoice.status : credits > 0 || invoice.status === 'refunded' ? 'refunded' : 'closed';
    paymentUnavailableReason = 'This invoice is closed to further payments.';
  } else if (refundPending) {
    status = 'refund_pending';
    paymentUnavailableReason = 'A refund is being reviewed. No payment is needed now.';
  } else if (processing) {
    status = 'processing';
    paymentUnavailableReason = 'Your submitted payment is processing. Please do not pay again.';
  } else if (remainingMinor === 0) {
    status = credits > 0 ? 'partially_refunded' : 'paid';
  } else if (invoice.status === 'draft') {
    paymentUnavailableReason = 'Your contractor has not issued this invoice yet.';
  } else {
    const due = invoice.dueDate ? new Date(invoice.dueDate).toISOString().slice(0, 10) : '';
    status = due && due < (options.now ?? new Date()).toISOString().slice(0, 10) ? 'overdue' : 'due';
  }
  return { status, paidAmount: moneyText(balanceMinor(balance.netCollected)), allocatedAmount: moneyText(balanceMinor(balance.allocated)),
    creditedAmount: moneyText(balanceMinor(balance.credits)), balance, agreementBalance: agreement ?? null,
    balanceDue: needsReview ? null : closed ? '0.00' : moneyText(remainingMinor),
    needsReview, closed, processing, refundPending, payable: !needsReview && !closed && !refundPending && !processing
      && invoice.status !== 'draft' && remainingMinor > 0, paymentUnavailableReason };
}

export function createPortalRoutes(overrides: Partial<PortalDependencies> = {}) {
const deps: PortalDependencies = { db: createDb, balance: readPaymentBalance, checkout: createCheckoutSession, ...overrides };
const portalApp = new Hono<{ Bindings: Env; Variables: Variables }>();
portalApp.onError((error, c) => {
  if (error instanceof PortalPaymentError || error instanceof PaymentOperationError) {
    return c.json({ error: error.message, code: error.code }, error.status);
  }
  return c.json({ error: 'The customer portal is temporarily unavailable. Try again later.', code: 'PORTAL_UNAVAILABLE' }, 503);
});

async function invoicePaymentState(db: Db, token: PortalToken, invoice: Invoice) {
  let balance = await deps.balance(db, token.orgId, invoice.id, null);
  if (invoice.changeOrderId) {
    const legacyPayment = await db.query.customerPayments.findFirst({
      where: and(eq(customerPayments.orgId, token.orgId), eq(customerPayments.leadId, token.leadId),
        eq(customerPayments.changeOrderId, invoice.changeOrderId), isNull(customerPayments.invoiceId),
        inArray(customerPayments.status, ['succeeded', 'paid', 'partially_refunded', 'refunded', 'processing'])),
    });
    const order = await db.query.changeOrders.findFirst({ where: and(eq(changeOrders.id, invoice.changeOrderId), eq(changeOrders.orgId, token.orgId)) });
    if (legacyPayment || (order?.paymentStatus === 'paid' && balanceMinor(balance.remaining) > 0)) {
      balance = { ...balance, needsReview: true };
    }
  }
  // Legacy payments recorded against the signed agreement must cap its linked invoices too.
  const agreement = invoice.estimateId && !invoice.changeOrderId
    ? await deps.balance(db, token.orgId, null, invoice.estimateId) : undefined;
  const processing = await db.query.customerPayments.findFirst({
    where: and(eq(customerPayments.orgId, token.orgId), eq(customerPayments.leadId, token.leadId),
      or(eq(customerPayments.invoiceId, invoice.id), invoice.estimateId && !invoice.changeOrderId ? eq(customerPayments.estimateId, invoice.estimateId) : undefined),
      eq(customerPayments.source, 'stripe'), eq(customerPayments.status, 'processing'), isNotNull(customerPayments.stripePaymentIntentId)),
  });
  return portalInvoicePaymentState(invoice, balance, { agreement, processing: Boolean(processing) });
}

async function startInvoiceCheckout(c: PortalContext, db: Db, token: PortalToken, invoice: Invoice) {
  if (invoice.changeOrderId) {
    const order = await db.query.changeOrders.findFirst({ where: and(eq(changeOrders.id, invoice.changeOrderId), eq(changeOrders.orgId, token.orgId)) });
    const job = order ? await db.query.jobs.findFirst({ where: and(eq(jobs.id, order.jobId), eq(jobs.orgId, token.orgId), eq(jobs.leadId, token.leadId)) }) : null;
    if (!order || !job || (invoice.jobId && invoice.jobId !== job.id) || !['approved', 'completed'].includes(order.status)) {
      throw new PortalPaymentError('Approve this change order before paying its invoice.', 'CHANGE_ORDER_NOT_APPROVED');
    }
  }
  const state = await invoicePaymentState(db, token, invoice);
  if (!state.payable || state.balanceDue === null) {
    throw new PortalPaymentError(state.paymentUnavailableReason || 'This invoice has no balance due.',
      state.needsReview ? 'PAYMENT_REVIEW_REQUIRED' : state.processing ? 'PAYMENT_PROCESSING' : 'INVOICE_NOT_PAYABLE');
  }
  const stripeConnection = await db.query.stripeConnections.findFirst({ where: eq(stripeConnections.orgId, token.orgId) });
  if (!stripeConnection?.onboardingComplete || !stripeConnection.stripeAccountId) {
    throw new PortalPaymentError('Online payments are not ready for this contractor', 'ONLINE_PAYMENTS_UNAVAILABLE');
  }
  const returnUrl = new URL(`/portal/${encodeURIComponent(token.token)}`, c.env.PUBLIC_URL || 'https://crewmodo.com');
  returnUrl.searchParams.set('invoiceId', invoice.id);
  if (invoice.changeOrderId) returnUrl.searchParams.set('changeOrderId', invoice.changeOrderId);
  const successUrl = new URL(returnUrl);
  successUrl.searchParams.set('invoicePaid', invoice.id);
  const cancelUrl = new URL(returnUrl);
  cancelUrl.searchParams.set('invoicePaymentCanceled', invoice.id);
  const session = await deps.checkout(c.env, {
    amount: usdMinor(state.balanceDue) / 100, successUrl: successUrl.toString(), cancelUrl: cancelUrl.toString(),
    productName: invoice.description || invoice.invoiceNumber || 'Crewmodo Invoice', connectedAccountId: stripeConnection.stripeAccountId,
    metadata: { orgId: token.orgId, leadId: token.leadId, invoiceId: invoice.id, estimateId: invoice.estimateId || '',
      jobId: invoice.jobId || '', changeOrderId: invoice.changeOrderId || '', portalToken: token.token },
  });
  if (!session.url) throw new PortalPaymentError('Unable to start payment. Try again later.', 'CHECKOUT_UNAVAILABLE', 503);
  // Checkout is an attempt, not a submitted payment. Provider events own processing/paid states.
  return c.json({ data: { checkoutUrl: session.url, sessionId: session.id, invoiceId: invoice.id, amountDue: state.balanceDue } });
}

portalApp.get('/:token', async (c) => {
  const token = c.req.param('token');
  const changeOrderId = c.req.query('changeOrderId');
  const db = deps.db(c.env.DATABASE_URL);
  
  const portalToken = await db.query.portalTokens.findFirst({
    where: eq(portalTokens.token, token),
  });
  
  if (!portalToken || !Number.isFinite(new Date(portalToken.expiresAt).getTime()) || Date.now() >= new Date(portalToken.expiresAt).getTime()) {
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
      where: and(eq(customerPayments.orgId, portalToken.orgId), eq(customerPayments.leadId, portalToken.leadId), inArray(customerPayments.invoiceId, invoiceRows.map((invoice) => invoice.id))),
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
  const invoices = await Promise.all(invoiceRows
    .filter((invoice) => !['voided', 'canceled', 'draft'].includes(invoice.status))
    .map(async (invoice) => {
      try {
        return { ...invoice, ...await invoicePaymentState(db, portalToken, invoice), payments: paymentsByInvoice.get(invoice.id) || [] };
      } catch {
        // Keep signed documents available when the payment ledger cannot be verified.
        return { ...invoice, status: 'needs_review', balanceDue: null, paidAmount: null, balance: null, agreementBalance: null, payable: false,
          needsReview: true, paymentUnavailableReason: 'Payment balance is unavailable. Try again later.', payments: paymentsByInvoice.get(invoice.id) || [] };
      }
    }));
  
  return c.json({ 
    data: {
      customer: lead ? { name: lead.name, email: lead.email, phone: lead.phone, streetAddress: lead.streetAddress,
        city: lead.city, state: lead.state, postalCode: lead.postalCode } : null,
      estimate: estimate ? { id: estimate.id, status: estimate.status, total: estimateContractValue(estimate).toFixed(2),
        signedAt: estimate.signedAt, packages: publicEstimatePackages(estimate.packages, estimate.acceptanceSnapshot) } : null,
      job: job ? { id: job.id, jobNumber: job.jobNumber, name: job.name, status: job.status, streetAddress: job.streetAddress,
        city: job.city, state: job.state, postalCode: job.postalCode, scheduledStartAt: job.scheduledStartAt, scheduledEndAt: job.scheduledEndAt } : null,
      changeOrders: orders.map((order) => ({ id: order.id, description: order.description, amount: order.amount, status: order.status,
        paymentRequired: order.paymentRequired, paymentStatus: order.paymentStatus, paymentDueAmount: order.paymentDueAmount,
        contractorSignature: order.contractorSignature, customerSignatureName: order.customerSignatureName, customerSignedAt: order.customerSignedAt })),
      invoices,
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
  const db = deps.db(c.env.DATABASE_URL);

  const portalToken = await db.query.portalTokens.findFirst({
    where: eq(portalTokens.token, token),
  });
  if (!portalToken || !Number.isFinite(new Date(portalToken.expiresAt).getTime()) || Date.now() >= new Date(portalToken.expiresAt).getTime()) {
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
      paymentStatus: paymentRequired ? (order.paymentStatus === 'paid' ? 'paid' : 'due') : 'not_requested',
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
  const db = deps.db(c.env.DATABASE_URL);

  const portalToken = await db.query.portalTokens.findFirst({
    where: eq(portalTokens.token, token),
  });
  if (!portalToken || !Number.isFinite(new Date(portalToken.expiresAt).getTime()) || Date.now() >= new Date(portalToken.expiresAt).getTime()) {
    return c.json({ error: 'Invalid token' }, 404);
  }

  const invoice = await db.query.customerInvoices.findFirst({
    where: and(eq(customerInvoices.id, id), eq(customerInvoices.orgId, portalToken.orgId), eq(customerInvoices.leadId, portalToken.leadId)),
  });
  if (!invoice) return c.json({ error: 'Invoice not found' }, 404);
  return startInvoiceCheckout(c, db, portalToken, invoice);
});

portalApp.post('/:token/change-orders/:id/checkout', async (c) => {
  const token = c.req.param('token');
  const id = c.req.param('id');
  const db = deps.db(c.env.DATABASE_URL);

  const portalToken = await db.query.portalTokens.findFirst({
    where: eq(portalTokens.token, token),
  });
  if (!portalToken || !Number.isFinite(new Date(portalToken.expiresAt).getTime()) || Date.now() >= new Date(portalToken.expiresAt).getTime()) {
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
  const invoices = await db.query.customerInvoices.findMany({
    where: and(eq(customerInvoices.orgId, portalToken.orgId), eq(customerInvoices.leadId, portalToken.leadId),
      eq(customerInvoices.changeOrderId, id), eq(customerInvoices.jobId, job.id), notInArray(customerInvoices.status, ['canceled', 'voided'])), limit: 2,
  });
  if (invoices.length !== 1) {
    throw new PortalPaymentError(invoices.length ? 'Open the specific change order invoice to pay.'
      : 'Ask your contractor to issue an invoice for this change order.', 'CHANGE_ORDER_INVOICE_REQUIRED');
  }
  return startInvoiceCheckout(c, db, portalToken, invoices[0]);
});

portalApp.post('/:token/pay', async (c) => {
  return c.json({ error: 'Open an invoice to pay its verified balance.', code: 'INVOICE_REQUIRED' }, 410);
});

return portalApp;
}

export default createPortalRoutes();
