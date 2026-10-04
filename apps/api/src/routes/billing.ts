import { Hono } from 'hono';
import { z } from 'zod';
import { createDb } from '@crewmodo/db';
import { auditLogs, changeOrders, customerInvoices, customerPayments, estimates, jobs, leads, orgSettings, quickbooksConnections, stripeConnections } from '@crewmodo/db/schema';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';
import { financialAccess } from '../middleware/financial-access';
import { createCheckoutSession, createRefund, readCheckoutForManualPayment, verifyWebhookSignature } from '../lib/stripe';
import { createQBInvoice, createQBPayment } from '../lib/quickbooks';
import { createJobFromAcceptedEstimate, estimateContractValue } from '../lib/estimate-handoff';
import { estimatePaymentSchedule, nextPayableMilestone } from '../lib/payment-schedule';
import { sendInvoiceEmail } from '../lib/invoice-emails';
import { exactUsd, usdMinor, paymentCall, paymentRecord, PaymentOperationError, readPaymentBalance, type RefundResult } from '../lib/payment-operations';

const billing = new Hono<{ Bindings: Env; Variables: Variables }>();

const usdAmount = z.union([z.string(), z.number()]).transform((value, ctx) => {
  try { return exactUsd(value); }
  catch { ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a positive amount with at most two decimal places.' }); return z.NEVER; }
});

const refundSchema = z.object({
  amount: usdAmount,
  reason: z.string().trim().min(1).max(500),
  method: z.enum(['cash', 'check', 'ach', 'other']).optional(),
  reference: z.string().trim().max(120).optional().nullable(),
  confirmManualRefund: z.boolean().optional(),
  refundedAt: z.string().datetime({ offset: true }).optional(),
  disposition: z.literal('credit').default('credit'),
});

const manualPaymentSchema = z.object({
  estimateId: z.string().uuid().optional(),
  invoiceId: z.string().uuid().optional(),
  amount: usdAmount,
  source: z.enum(['cash', 'check', 'ach', 'other']).default('check'),
  reference: z.string().trim().max(120).optional().nullable(),
  description: z.string().trim().max(255).optional().nullable(),
  receivedAt: z.string().datetime({ offset: true }).optional().nullable(),
  confirmAdditionalPayment: z.boolean().optional(),
  sendReceipt: z.boolean().optional(),
}).refine((data) => Boolean(data.estimateId) !== Boolean(data.invoiceId), {
  message: 'Select either an estimate or an invoice.',
  path: ['estimateId'],
});

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function metadataObject(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function netPaymentAmount(payment: typeof customerPayments.$inferSelect) {
  if (!['succeeded', 'paid', 'partially_refunded', 'refunded'].includes(payment.status)) return 0;
  return Number(payment.amount || 0) - Number(payment.refundedAmount || 0);
}

function operationFailure(c: Parameters<typeof financialAccess>[0], error: unknown) {
  const correlationId = crypto.randomUUID();
  if (error instanceof PaymentOperationError) {
    return c.json({ error: error.message, message: error.message, code: error.code, retryable: false, correlationId }, error.status);
  }
  console.error('Payment operation requires review', { correlationId });
  return c.json({ error: 'Payment could not be confirmed. Refresh before retrying.', code: 'PAYMENT_CONFIRMATION_UNAVAILABLE', retryable: false, correlationId }, 503);
}

async function paymentAlreadyRecorded(db: ReturnType<typeof createDb>, stripeCheckoutSessionId?: string) {
  if (!stripeCheckoutSessionId) return false;
  const existing = await db.query.customerPayments.findFirst({
    where: eq(customerPayments.stripeCheckoutSessionId, stripeCheckoutSessionId),
  });
  return Boolean(existing);
}

function selectedOptionsForPackage(pkg: { items?: unknown[]; lineItems?: unknown[] }, selectedOptions: unknown[]) {
  const optionalItems = (Array.isArray(pkg.items) ? pkg.items : Array.isArray(pkg.lineItems) ? pkg.lineItems : []) as Array<{
    desc?: string;
    qty?: number;
    rate?: number;
    category?: string;
    optional?: boolean;
    customerVisible?: boolean;
  }>;
  const allowed = new Map(optionalItems
    .filter((item) => item.optional && item.customerVisible !== false)
    .map((item) => [`${item.desc}|${Number(item.qty || 1)}|${Number(item.rate || 0)}`, item]));

  return selectedOptions
    .slice(0, 20)
    .map((option) => {
      const candidate = option as { desc?: unknown; qty?: unknown; rate?: unknown };
      return allowed.get(`${String(candidate?.desc || '')}|${Number(candidate?.qty || 1)}|${Number(candidate?.rate || 0)}`);
    })
    .filter((option): option is NonNullable<typeof option> => Boolean(option))
    .map((option) => ({
      desc: String(option.desc),
      qty: Number(option.qty || 1),
      rate: Number(option.rate || 0),
      category: String(option.category || 'option'),
    }));
}

billing.use('/manual', authMiddleware, financialAccess);

billing.post('/manual', async (c) => {
  const orgId = c.get('orgId');
  const actor = c.get('userId');
  if (!orgId || !actor) return c.json({ error: 'Unauthorized' }, 401);
  const idempotencyKey = c.req.header('Idempotency-Key')?.trim();
  if (!idempotencyKey || idempotencyKey.length > 200) {
    return c.json({ error: 'A valid Idempotency-Key is required.', code: 'INVALID_OPERATION_KEY' }, 400);
  }
  const parsed = manualPaymentSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'Invalid manual payment', code: 'INVALID_PAYMENT', details: parsed.error.flatten() }, 400);
  const request = {
    invoiceId: parsed.data.invoiceId || null, estimateId: parsed.data.estimateId || null,
    amount: parsed.data.amount, source: parsed.data.source,
    reference: parsed.data.reference || null, description: parsed.data.description || null,
    receivedAt: parsed.data.receivedAt ? new Date(parsed.data.receivedAt).toISOString() : null,
    confirmAdditionalPayment: parsed.data.confirmAdditionalPayment || false, sendReceipt: parsed.data.sendReceipt !== false,
  };
  const db = createDb(c.env.DATABASE_URL);
  try {
    // One SQL call owns the balance lock, payment, status, audit and replay result.
    type ManualResult = { payment: Record<string, unknown>; remaining: string; replayed: boolean };
    const commit = (checkout: Record<string, unknown> | null) => paymentCall<ManualResult>(db,
      sql`select record_manual_payment(${orgId}::uuid,${actor}::uuid,${idempotencyKey},${JSON.stringify(request)}::jsonb,
        ${checkout ? JSON.stringify(checkout) : null}::jsonb) as result`);
    let result: ManualResult;
    try { result = await commit(null); }
    catch (error) {
      if (!(error instanceof PaymentOperationError) || error.code !== 'CHECKOUT_REVIEW_REQUIRED' || !request.invoiceId) throw error;
      const invoice = await db.query.customerInvoices.findFirst({
        where: and(eq(customerInvoices.id, request.invoiceId), eq(customerInvoices.orgId, orgId)),
      });
      const connection = await db.query.stripeConnections.findFirst({ where: eq(stripeConnections.orgId, orgId) });
      const mode = /^(?:sk|rk)_(test|live)_/.exec(c.env.STRIPE_SECRET_KEY || '')?.[1];
      if (!invoice?.stripeCheckoutSessionId || !connection || !mode) throw error;
      let session: Awaited<ReturnType<typeof readCheckoutForManualPayment>>;
      try { session = await readCheckoutForManualPayment(c.env, invoice.stripeCheckoutSessionId, connection.stripeAccountId); }
      catch { throw new PaymentOperationError('Online checkout status is unavailable. No manual payment was recorded. Try again after reconciliation.', 409, 'CHECKOUT_REVIEW_REQUIRED'); }
      if (session.id !== invoice.stripeCheckoutSessionId || session.livemode !== (mode === 'live')
        || session.metadata?.orgId !== orgId || session.metadata?.invoiceId !== invoice.id
        || !Number.isSafeInteger(session.amount_total) || session.amount_total < 0) {
        throw new PaymentOperationError('The online checkout identity or environment needs review.', 409, 'CHECKOUT_REVIEW_REQUIRED');
      }
      result = await commit({ id: session.id, status: session.status, paymentStatus: session.payment_status,
        amountMinor: session.amount_total, currency: session.currency, livemode: session.livemode,
        orgId, invoiceId: invoice.id, accountId: connection.stripeAccountId, paymentIntentId: session.payment_intent || null,
        verifiedAt: new Date().toISOString() });
    }
    const payment = paymentRecord<typeof customerPayments.$inferSelect>(result.payment);
    let receiptStatus: 'not_requested' | 'sent' | 'failed' | 'not_retried' = request.sendReceipt
      ? result.replayed ? 'not_retried' : 'failed' : 'not_requested';
    if (!result.replayed && payment.invoiceId && request.sendReceipt) {
      try {
        const invoice = await db.query.customerInvoices.findFirst({
          where: and(eq(customerInvoices.id, payment.invoiceId), eq(customerInvoices.orgId, orgId)),
        });
        if (invoice) {
          const receipt = await sendInvoiceEmail(c.env, db, { orgId, invoice, templateKey: 'invoice.payment.receipt',
            payment, balanceDue: Number(result.remaining), sentBy: actor });
          // Provider acceptance only; there is no durable email queue or delivery confirmation.
          if (receipt.sent) receiptStatus = 'sent';
        }
      } catch {
        // Receipt failures cannot undo a committed payment or invite a second money operation.
        console.error('Manual payment receipt delivery failed', { paymentId: payment.id });
      }
    }
    return c.json({ data: payment, duplicate: result.replayed, balanceDue: result.remaining, receiptStatus }, result.replayed ? 200 : 201);
  } catch (error) { return operationFailure(c, error); }
});

billing.post('/checkout', async (c) => {
  const { estimateId, packageName, selectedOptions = [], milestoneKey } = await c.req.json();
  
  const db = createDb(c.env.DATABASE_URL);
  
  const estimate = await db.query.estimates.findFirst({
    where: eq(estimates.id, estimateId),
  });
  
  if (!estimate) {
    return c.json({ error: 'Estimate not found' }, 404);
  }
  if (['canceled', 'voided', 'superseded'].includes(estimate.status)) {
    return c.json({ error: 'This estimate is no longer active' }, 409);
  }

  const stripeConnection = await db.query.stripeConnections.findFirst({
    where: eq(stripeConnections.orgId, estimate.orgId),
  });
  if (!stripeConnection?.onboardingComplete) {
    return c.json({ error: 'Stripe payments are not ready for this workspace' }, 409);
  }
  
  const packages = estimate.packages as Array<{ name: string; total: number; subtotal?: number; tax?: number; discount?: number; items?: unknown[]; lineItems?: unknown[] }>;
  const pkg = packages.find((p) => p.name === packageName);
  if (!pkg) {
    return c.json({ error: 'Package not found' }, 404);
  }
  
  try {
    const balance = await readPaymentBalance(db, estimate.orgId, null, estimate.id);
    if (balance.closed || balance.needsReview || balance.pendingRefunds > 0) {
      return c.json({ error: 'This balance is closed or needs payment review.', code: 'PAYMENT_OPERATION_CONFLICT' }, 409);
    }
    const issuedInvoice = await db.query.customerInvoices.findFirst({
      where: and(eq(customerInvoices.orgId, estimate.orgId), eq(customerInvoices.estimateId, estimate.id)),
    });
    if (issuedInvoice) return c.json({ error: 'Pay the related invoice from your client portal.', code: 'USE_INVOICE_PAYMENT' }, 409);
    const cleanOptions = Array.isArray(selectedOptions) ? selectedOptionsForPackage(pkg, selectedOptions) : [];
    const optionTotal = cleanOptions.reduce((sum, option) => sum + option.qty * option.rate, 0);
    const selectedOptionsMetadata = JSON.stringify(cleanOptions);
    const baseTotal = Number(pkg.total || 0);
    const baseTax = Number(pkg.tax || 0);
    const discount = Number(pkg.discount || 0);
    const rawSubtotal = Number(pkg.subtotal || 0);
    const baseSubtotal = rawSubtotal > 0 && Math.abs((rawSubtotal - discount + baseTax) - baseTotal) < 0.02
      ? rawSubtotal
      : Math.max(baseTotal - baseTax + discount, 0);
    const taxableBase = Math.max(baseSubtotal - discount, 0);
    const taxRate = taxableBase > 0 ? baseTax / taxableBase : 0;
    const optionTax = Math.round(optionTotal * taxRate * 100) / 100;
    const packageTotal = baseTotal + optionTotal + optionTax;
    if (!Number.isFinite(packageTotal) || packageTotal <= 0) {
      return c.json({ error: 'Invalid package total' }, 400);
    }
    const settings = await db.query.orgSettings.findFirst({ where: eq(orgSettings.orgId, estimate.orgId) });
    // A confirmed credited refund does not reopen the original obligation.
    const paidAmount = Number(balance.allocated);
    const schedule = estimatePaymentSchedule(settings || {}, packageTotal, paidAmount);
    const milestone = nextPayableMilestone(schedule, milestoneKey);
    if (!milestone) {
      return c.json({ error: 'No online payment is due for this estimate right now' }, 409);
    }
    const amountDue = Math.round((milestone.amount - milestone.paidAmount) * 100) / 100;
    if (!Number.isFinite(amountDue) || amountDue <= 0 || amountDue > Number(balance.remaining)) {
      return c.json({ error: 'No online payment is due for this estimate right now' }, 409);
    }

    const session = await createCheckoutSession(c.env, {
      amount: amountDue,
      successUrl: `${c.env.PUBLIC_URL}/estimates/${estimateId}/success`,
      cancelUrl: `${c.env.PUBLIC_URL}/estimates/${estimateId}`,
      metadata: {
        estimateId,
        orgId: estimate.orgId,
        packageName,
        milestoneKey: milestone.key,
        milestoneLabel: milestone.label,
        optionTotal: optionTotal.toFixed(2),
        optionTax: optionTax.toFixed(2),
        selectedOptions: selectedOptionsMetadata.length <= 450 ? selectedOptionsMetadata : '[]',
      },
      connectedAccountId: stripeConnection.stripeAccountId,
    });
    
    return c.json({ 
      checkoutUrl: session.url,
      sessionId: session.id,
    });
  } catch (err) {
    console.error('Checkout error:', err);
    return c.json({ error: 'Failed to create checkout session' }, 500);
  }
});

billing.post('/webhook', async (c) => {
  const sig = c.req.header('stripe-signature');
  const body = await c.req.text();
  
  if (!sig) {
    return c.json({ error: 'Missing signature' }, 400);
  }
  const webhookSecret = c.env.STRIPE_CONNECT_WEBHOOK_SECRET || c.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) return c.json({ error: 'Webhook verification is not configured' }, 503);
  
  try {
    const isValid = await verifyWebhookSignature(
      body,
      sig,
      webhookSecret
    );
    
    if (!isValid) {
      return c.json({ error: 'Invalid signature' }, 400);
    }
    
    const event = JSON.parse(body) as {
      type?: string;
      account?: string;
      livemode?: boolean;
      data?: { object?: {
        id?: string;
        metadata?: Record<string, string>;
        amount_total?: number;
        currency?: string;
        payment_intent?: string;
        payment_status?: string;
        customer_details?: { email?: string };
        amount?: number;
        status?: string;
        charge?: string;
      } };
    };

    if (['refund.created', 'refund.updated', 'refund.failed'].includes(event.type || '')) {
      const refund = event.data?.object;
      const orgId = refund?.metadata?.orgId;
      const operationId = refund?.metadata?.crewmodo_refund_operation;
      if (!operationId) return c.json({ received: true, ignored: true });
      if (!z.string().uuid().safeParse(orgId).success || !z.string().uuid().safeParse(operationId).success) {
        return c.json({ error: 'Invalid refund operation identity' }, 400);
      }
      const mode = /^(?:sk|rk)_(test|live)_/.exec(c.env.STRIPE_SECRET_KEY || '')?.[1];
      if (!mode || event.livemode !== (mode === 'live') || !event.account) return c.json({ error: 'Refund environment mismatch' }, 400);
      const state = refund?.status === 'requires_action' ? 'pending'
        : ['succeeded', 'pending', 'failed', 'canceled'].includes(refund?.status || '') ? refund!.status! : 'unknown';
      if (state === 'unknown') return c.json({ error: 'Unsupported refund status requires reconciliation' }, 409);
      const evidence = { status: refund?.status, amountMinor: refund?.amount, currency: refund?.currency,
        livemode: event.livemode, accountId: event.account, paymentIntentId: refund?.payment_intent || null, chargeId: refund?.charge || null };
      const db = createDb(c.env.DATABASE_URL);
      try {
        await paymentCall<RefundResult>(db, sql`select settle_payment_refund(
          ${orgId!}::uuid,${operationId}::uuid,${state},${refund?.id},${JSON.stringify(evidence)}::jsonb) as result`);
        return c.json({ received: true });
      } catch (error) { return operationFailure(c, error); }
    }
    
    if (event.type === 'checkout.session.completed') {
      const metadata = event.data?.object?.metadata;
      const changeOrderId = metadata?.changeOrderId;
      const estimateId = metadata?.estimateId;
      const invoiceId = metadata?.invoiceId;
      const orgId = metadata?.orgId;
      const packageName = metadata?.packageName;
      const milestoneLabel = metadata?.milestoneLabel;
      const selectedOptions = metadata?.selectedOptions ? JSON.parse(metadata.selectedOptions) : [];
      const amountTotal = (event.data?.object?.amount_total ?? 0) / 100;

      if (invoiceId && orgId && amountTotal > 0) {
        const db = createDb(c.env.DATABASE_URL);
        if (await paymentAlreadyRecorded(db, event.data?.object?.id)) {
          return c.json({ received: true, duplicate: true });
        }
        const invoice = await db.query.customerInvoices.findFirst({
          where: and(eq(customerInvoices.id, invoiceId), eq(customerInvoices.orgId, orgId)),
        });
        if (!invoice) {
          return c.json({ error: 'Invoice metadata mismatch' }, 400);
        }

        const existingPayments = await db.select().from(customerPayments)
          .where(and(eq(customerPayments.invoiceId, invoice.id), eq(customerPayments.orgId, orgId)));
        const paidBefore = existingPayments.reduce((sum, payment) => sum + netPaymentAmount(payment), 0);
        const remainingAfterPayment = roundMoney(Math.max(Number(invoice.total || 0) - paidBefore - amountTotal, 0));
        const paidAt = new Date();

        const [payment] = await db.insert(customerPayments).values({
          orgId,
          leadId: invoice.leadId,
          estimateId: invoice.estimateId || null,
          jobId: invoice.jobId || null,
          changeOrderId: invoice.changeOrderId || null,
          invoiceId: invoice.id,
          source: 'stripe',
          status: 'succeeded',
          amount: amountTotal.toFixed(2),
          currency: event.data?.object?.currency || 'usd',
          description: invoice.description || 'Invoice payment',
          stripeCheckoutSessionId: event.data?.object?.id || null,
          stripePaymentIntentId: event.data?.object?.payment_intent || null,
          metadata: {
            paymentStatus: event.data?.object?.payment_status,
            customerEmail: event.data?.object?.customer_details?.email,
          },
        }).returning();

        await db.update(customerInvoices)
          .set({
            status: remainingAfterPayment <= 0.005 ? 'paid' : 'partially_paid',
            paidAt: remainingAfterPayment <= 0.005 ? paidAt : null,
            updatedAt: paidAt,
          })
          .where(and(eq(customerInvoices.id, invoice.id), eq(customerInvoices.orgId, orgId)));

        if (remainingAfterPayment <= 0.005 && invoice.changeOrderId) {
          await db.update(changeOrders)
            .set({ paymentStatus: 'paid', paidAt })
            .where(and(eq(changeOrders.id, invoice.changeOrderId), eq(changeOrders.orgId, orgId)));
        }

        if (remainingAfterPayment <= 0.005 && invoice.jobId && invoice.estimateId) {
          await db.update(jobs)
            .set({ status: 'scheduled', updatedAt: paidAt })
            .where(and(eq(jobs.id, invoice.jobId), eq(jobs.orgId, orgId), eq(jobs.status, 'deposit_pending')));
        }

        await db.insert(auditLogs).values({
          orgId,
          action: 'invoice.payment_received',
          entityType: 'invoice',
          entityId: invoice.id,
          metadata: {
            leadId: invoice.leadId,
            estimateId: invoice.estimateId,
            jobId: invoice.jobId,
            changeOrderId: invoice.changeOrderId,
            paymentId: payment.id,
            amount: amountTotal,
            remainingAfterPayment,
          },
        });

        try {
          await sendInvoiceEmail(c.env, db, {
            orgId,
            invoice,
            templateKey: 'invoice.payment.receipt',
            payment,
            balanceDue: remainingAfterPayment,
          });
        } catch (error) {
          console.error('Failed to send invoice payment receipt:', error);
        }

        return c.json({ received: true });
      }

      if (changeOrderId && orgId && amountTotal > 0) {
        const db = createDb(c.env.DATABASE_URL);
        if (await paymentAlreadyRecorded(db, event.data?.object?.id)) {
          return c.json({ received: true, duplicate: true });
        }
        const order = await db.query.changeOrders.findFirst({
          where: and(eq(changeOrders.id, changeOrderId), eq(changeOrders.orgId, orgId)),
        });
        if (!order) {
          return c.json({ error: 'Change order metadata mismatch' }, 400);
        }

        const paidAt = new Date();
        const [updated] = await db.update(changeOrders)
          .set({
            status: 'approved',
            approvedAt: order.approvedAt || paidAt,
            paymentStatus: 'paid',
            paidAt,
            stripeCheckoutSessionId: event.data?.object?.id || order.stripeCheckoutSessionId,
          })
          .where(and(eq(changeOrders.id, changeOrderId), eq(changeOrders.orgId, orgId)))
          .returning();

        await db.insert(auditLogs).values({
          orgId,
          action: 'change_order.payment_received',
          entityType: 'change_order',
          entityId: changeOrderId,
          metadata: {
            jobId: updated.jobId,
            estimateId: updated.estimateId,
            amount: amountTotal,
          },
        });

        const job = await db.query.jobs.findFirst({
          where: and(eq(jobs.id, updated.jobId), eq(jobs.orgId, orgId)),
        }).catch(() => null);
        if (job) {
          await db.insert(customerPayments).values({
            orgId,
            leadId: job.leadId,
            estimateId: updated.estimateId,
            jobId: updated.jobId,
            changeOrderId,
            source: 'stripe',
            status: 'succeeded',
            amount: amountTotal.toFixed(2),
            currency: event.data?.object?.currency || 'usd',
            description: `Change order payment`,
            stripeCheckoutSessionId: event.data?.object?.id || null,
            stripePaymentIntentId: event.data?.object?.payment_intent || null,
            metadata: { paymentStatus: event.data?.object?.payment_status },
          }).onConflictDoNothing();
        }

        return c.json({ received: true });
      }

      if (!estimateId || !orgId || amountTotal <= 0) {
        return c.json({ error: 'Missing checkout metadata' }, 400);
      }
      
      const db = createDb(c.env.DATABASE_URL);
      if (await paymentAlreadyRecorded(db, event.data?.object?.id)) {
        return c.json({ received: true, duplicate: true });
      }
      const estimate = await db.query.estimates.findFirst({
        where: eq(estimates.id, estimateId),
      });

      if (!estimate || estimate.orgId !== orgId) {
        return c.json({ error: 'Estimate metadata mismatch' }, 400);
      }
      
      const [acceptedEstimate] = await db.update(estimates)
        .set({ status: 'accepted' })
        .where(eq(estimates.id, estimateId))
        .returning();

      const job = await createJobFromAcceptedEstimate(db, acceptedEstimate, { packageName, selectedOptions });
      await db.insert(customerPayments).values({
        orgId,
        leadId: estimate.leadId,
        estimateId: estimate.id,
        jobId: job.id,
        source: 'stripe',
        status: 'succeeded',
        amount: amountTotal.toFixed(2),
        currency: event.data?.object?.currency || 'usd',
        description: milestoneLabel || (packageName ? `${packageName} estimate payment` : 'Estimate payment'),
        stripeCheckoutSessionId: event.data?.object?.id || null,
        stripePaymentIntentId: event.data?.object?.payment_intent || null,
        metadata: {
          packageName,
          milestoneKey: metadata?.milestoneKey,
          milestoneLabel,
          selectedOptions,
          paymentStatus: event.data?.object?.payment_status,
          customerEmail: event.data?.object?.customer_details?.email,
        },
      }).onConflictDoNothing();
      
      console.log(`Estimate ${estimateId} marked as accepted and job ${job.id} is ready`);
      
      // Auto-sync to QuickBooks if connected
      const qbConnection = await db.query.quickbooksConnections.findFirst({
        where: eq(quickbooksConnections.orgId, orgId),
      });
      
      if (qbConnection) {
        try {
          const lead = await db.query.leads.findFirst({
            where: eq(leads.id, estimate.leadId),
          });
          if (!lead || lead.orgId !== orgId) {
            throw new Error('Lead metadata mismatch');
          }
          
          // Sync invoice
          const invoiceId = await createQBInvoice(c.env, orgId, estimate, lead);
          console.log(`Auto-synced invoice ${invoiceId} to QuickBooks`);
          
          // Sync payment
          const paymentDate = new Date().toISOString().split('T')[0];
          const paymentId = await createQBPayment(c.env, orgId, { ...estimate, qboInvoiceId: invoiceId }, amountTotal, paymentDate);
          console.log(`Auto-synced payment ${paymentId} to QuickBooks`);
        } catch (qbErr) {
          console.error('QB auto-sync failed:', qbErr);
          // Don't fail webhook if QB sync fails
        }
      }
    }
    
    return c.json({ received: true });
  } catch (err) {
    console.error('Webhook error:', err);
    return c.json({ error: 'Webhook handler failed' }, 500);
  }
});

billing.use('/history', authMiddleware, financialAccess);
billing.use('/:id/refund', authMiddleware, financialAccess);

billing.get('/history', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) return c.json({ error: 'Unauthorized' }, 401);
  const estimateId = c.req.query('estimateId');
  const invoiceId = c.req.query('invoiceId');
  const leadId = c.req.query('leadId');
  const db = createDb(c.env.DATABASE_URL);
  const filters = [eq(customerPayments.orgId, orgId)];
  if (estimateId) filters.push(eq(customerPayments.estimateId, estimateId));
  if (invoiceId) filters.push(eq(customerPayments.invoiceId, invoiceId));
  if (leadId) filters.push(eq(customerPayments.leadId, leadId));

  try {
    const rows = await db.select().from(customerPayments)
      .where(and(...filters))
      .orderBy(desc(customerPayments.receivedAt))
      .limit(100);

    return c.json({ data: rows });
  } catch (err) {
    const error = err as { code?: string; message?: string };
    if (error.code === '42P01' || /relation .* does not exist/i.test(error.message || '')) {
      return c.json({ data: [] });
    }
    console.error('Failed to load payment history:', err);
    return c.json({ error: 'Failed to load payment history' }, 500);
  }
});

billing.post('/:id/refund', async (c) => {
  const orgId = c.get('orgId');
  const actor = c.get('userId');
  if (!orgId || !actor) return c.json({ error: 'Unauthorized' }, 401);
  const paymentId = c.req.param('id');
  if (!z.string().uuid().safeParse(paymentId).success) return c.json({ error: 'Invalid payment ID' }, 400);
  const idempotencyKey = c.req.header('Idempotency-Key')?.trim();
  if (!idempotencyKey || idempotencyKey.length > 200) return c.json({ error: 'A valid Idempotency-Key is required.', code: 'INVALID_OPERATION_KEY' }, 400);
  const parsed = refundSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'Invalid refund request', code: 'INVALID_REFUND', details: parsed.error.flatten() }, 400);
  const request = {
    amount: parsed.data.amount, reason: parsed.data.reason, disposition: parsed.data.disposition,
    method: parsed.data.method || null, reference: parsed.data.reference || null,
    confirmManualRefund: parsed.data.confirmManualRefund || false,
    refundedAt: parsed.data.refundedAt ? new Date(parsed.data.refundedAt).toISOString() : null,
  };
  const db = createDb(c.env.DATABASE_URL);
  try {
    const payment = await db.query.customerPayments.findFirst({
      where: and(eq(customerPayments.id, paymentId), eq(customerPayments.orgId, orgId)),
    });
    if (!payment) return c.json({ error: 'Payment not found', code: 'PAYMENT_NOT_FOUND' }, 404);
    const stripe = payment.source === 'stripe';
    const connection = stripe ? await db.query.stripeConnections.findFirst({ where: eq(stripeConnections.orgId, orgId) }) : null;
    const original = metadataObject(payment.metadata);
    const accountId = typeof original.stripeAccountId === 'string' ? original.stripeAccountId : connection?.stripeAccountId || null;
    const keyMode = /^(?:sk|rk)_(test|live)_/.exec(c.env.STRIPE_SECRET_KEY || '')?.[1];
    const livemode = keyMode ? keyMode === 'live' : null;
    let result = await paymentCall<RefundResult>(db, sql`select reserve_payment_refund(
      ${orgId}::uuid,${actor}::uuid,${idempotencyKey},${paymentId}::uuid,${JSON.stringify(request)}::jsonb,
      ${accountId},${livemode}::boolean) as result`);
    if (result.dispatch) {
      const operation = result.operation;
      let observed: Record<string, unknown> = { status: 'unknown' };
      try {
        const refund = await createRefund(c.env, {
          paymentIntentId: operation.provider_payment_intent_id, chargeId: operation.provider_charge_id,
          amountMinor: usdMinor(operation.amount), reason: request.reason,
          connectedAccountId: operation.provider_account_id!, idempotencyKey: operation.provider_key,
          operationId: operation.id, orgId,
        });
        const state = refund.status === 'requires_action' ? 'pending'
          : ['succeeded', 'pending', 'failed', 'canceled'].includes(refund.status) ? refund.status : 'unknown';
        const evidence = { status: refund.status, amountMinor: refund.amount, currency: refund.currency,
          livemode: operation.provider_livemode, accountId: operation.provider_account_id,
          paymentIntentId: refund.payment_intent || null, chargeId: refund.charge || null, providerRefundId: refund.id };
        observed = evidence;
        result = await paymentCall<RefundResult>(db, sql`select settle_payment_refund(
          ${orgId}::uuid,${operation.id}::uuid,${state},${state === 'unknown' ? null : refund.id},
          ${JSON.stringify(evidence)}::jsonb) as result`);
      } catch {
        // Preserve the intent on every ambiguous external/commit failure. A second
        // client key cannot bypass it, and replay never dispatches another refund.
        result = await paymentCall<RefundResult>(db, sql`select settle_payment_refund(
          ${orgId}::uuid,${operation.id}::uuid,'unknown',null,
          ${JSON.stringify({ ...observed, providerStatus: observed.status, status: 'unknown' })}::jsonb) as result`);
      }
    }
    const unresolved = ['reserved', 'pending', 'unknown'].includes(result.operation.state);
    if (['failed', 'canceled'].includes(result.operation.state)) {
      return c.json({ error: 'Stripe did not complete this refund. No refund has been recorded.', code: 'REFUND_NOT_COMPLETED',
        data: paymentRecord<typeof customerPayments.$inferSelect>(result.payment),
        refundOperation: { id: result.operation.id, status: result.operation.state } }, 409);
    }
    return c.json({ data: paymentRecord<typeof customerPayments.$inferSelect>(result.payment),
      refundOperation: { id: result.operation.id, status: result.operation.state, disposition: 'credit' },
      duplicate: result.replayed,
      ...(unresolved ? { message: 'Refund awaiting confirmation. Do not submit another refund.', code: 'REFUND_AWAITING_CONFIRMATION' } : {}),
    }, unresolved ? 202 : 200);
  } catch (error) { return operationFailure(c, error); }
});

export default billing;
