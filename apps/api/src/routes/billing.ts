import { Hono } from 'hono';
import { z } from 'zod';
import { createDb } from '@crewmodo/db';
import { auditLogs, changeOrders, customerInvoices, customerPayments, estimates, jobs, leads, orgSettings, quickbooksConnections, stripeConnections } from '@crewmodo/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';
import { createCheckoutSession, createRefund, verifyWebhookSignature } from '../lib/stripe';
import { createQBInvoice, createQBPayment } from '../lib/quickbooks';
import { createJobFromAcceptedEstimate, estimateContractValue } from '../lib/estimate-handoff';
import { estimatePaymentSchedule, nextPayableMilestone } from '../lib/payment-schedule';

const billing = new Hono<{ Bindings: Env; Variables: Variables }>();

const refundSchema = z.object({
  amount: z.coerce.number().positive(),
  reason: z.string().trim().max(500).optional(),
});

const manualPaymentSchema = z.object({
  estimateId: z.string().uuid().optional(),
  invoiceId: z.string().uuid().optional(),
  amount: z.coerce.number().positive(),
  source: z.enum(['cash', 'check', 'ach', 'other']).default('check'),
  reference: z.string().trim().max(120).optional().nullable(),
  description: z.string().trim().max(255).optional().nullable(),
  receivedAt: z.string().datetime().optional().nullable(),
  confirmAdditionalPayment: z.boolean().optional(),
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

billing.use('/manual', authMiddleware);

billing.post('/manual', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) return c.json({ error: 'Unauthorized' }, 401);
  const idempotencyKey = c.req.header('Idempotency-Key')?.trim();
  if (!idempotencyKey) {
    return c.json({ error: 'Idempotency-Key is required when recording payments.' }, 400);
  }

  const parsed = manualPaymentSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'Invalid payment request', details: parsed.error.flatten() }, 400);
  }

  const db = createDb(c.env.DATABASE_URL);
  if (parsed.data.invoiceId) {
    const invoice = await db.query.customerInvoices.findFirst({
      where: and(eq(customerInvoices.id, parsed.data.invoiceId), eq(customerInvoices.orgId, orgId)),
    });
    if (!invoice) return c.json({ error: 'Invoice not found' }, 404);
    if (['canceled', 'voided'].includes(invoice.status)) return c.json({ error: 'Cannot record payment on an inactive invoice.' }, 409);

    const existingPayments = await db.select().from(customerPayments)
      .where(and(eq(customerPayments.invoiceId, invoice.id), eq(customerPayments.orgId, orgId)));
    const duplicate = existingPayments.find((payment) => metadataObject(payment.metadata).idempotencyKey === idempotencyKey);
    if (duplicate) return c.json({ data: duplicate, duplicate: true });

    const invoiceTotal = roundMoney(Number(invoice.total || 0));
    const paidAmount = roundMoney(existingPayments.reduce((sum, payment) => sum + netPaymentAmount(payment), 0));
    const remaining = roundMoney(Math.max(invoiceTotal - paidAmount, 0));
    const amount = roundMoney(parsed.data.amount);
    if (paidAmount > 0.005 && !parsed.data.confirmAdditionalPayment) {
      return c.json({ error: `This invoice already has ${paidAmount.toFixed(2)} recorded. Confirm this is an additional payment before saving.` }, 409);
    }
    if (remaining <= 0) {
      return c.json({ error: 'This invoice is already paid in full.' }, 409);
    }
    if (amount > remaining + 0.005) {
      return c.json({ error: `Payment cannot exceed the remaining balance of ${remaining.toFixed(2)}.` }, 409);
    }

    const receivedAt = parsed.data.receivedAt ? new Date(parsed.data.receivedAt) : new Date();
    const description = parsed.data.description || `${parsed.data.source.toUpperCase()} payment`;
    const [payment] = await db.insert(customerPayments).values({
      orgId,
      leadId: invoice.leadId,
      invoiceId: invoice.id,
      jobId: invoice.jobId || null,
      source: parsed.data.source,
      status: 'succeeded',
      amount: amount.toFixed(2),
      currency: 'usd',
      description,
      receivedAt,
      metadata: {
        idempotencyKey,
        reference: parsed.data.reference || null,
        confirmedAdditionalPayment: paidAmount > 0.005,
        recordedByUserId: c.get('userId') || null,
        note: 'Manual payment recorded by contractor. No Stripe charge was created.',
      },
    }).returning();

    const remainingAfterPayment = roundMoney(remaining - amount);
    await db.update(customerInvoices)
      .set({
        status: remainingAfterPayment <= 0.005 ? 'paid' : 'partially_paid',
        paidAt: remainingAfterPayment <= 0.005 ? receivedAt : null,
        updatedAt: new Date(),
      })
      .where(and(eq(customerInvoices.id, invoice.id), eq(customerInvoices.orgId, orgId)));

    if (remainingAfterPayment <= 0.005 && invoice.changeOrderId) {
      await db.update(changeOrders)
        .set({ paymentStatus: 'paid', paidAt: receivedAt })
        .where(and(eq(changeOrders.id, invoice.changeOrderId), eq(changeOrders.orgId, orgId)));
    }
    if (remainingAfterPayment <= 0.005 && invoice.jobId && invoice.estimateId) {
      await db.update(jobs)
        .set({ status: 'scheduled', updatedAt: new Date() })
        .where(and(eq(jobs.id, invoice.jobId), eq(jobs.orgId, orgId), eq(jobs.status, 'deposit_pending')));
    }

    await db.insert(auditLogs).values({
      orgId,
      userId: c.get('userId'),
      action: 'payment.manual_recorded',
      entityType: 'payment',
      entityId: payment.id,
      metadata: {
        leadId: invoice.leadId,
        invoiceId: invoice.id,
        jobId: invoice.jobId || null,
        amount,
        source: parsed.data.source,
        reference: parsed.data.reference || null,
        remainingAfterPayment,
      },
    });

    return c.json({ data: payment }, 201);
  }

  if (!parsed.data.estimateId) return c.json({ error: 'Estimate is required.' }, 400);
  const estimate = await db.query.estimates.findFirst({
    where: and(eq(estimates.id, parsed.data.estimateId), eq(estimates.orgId, orgId)),
  });
  if (!estimate) return c.json({ error: 'Estimate not found' }, 404);
  if (['canceled', 'voided', 'superseded'].includes(estimate.status)) return c.json({ error: 'Cannot record payment on an inactive estimate.' }, 409);

  const existingPayments = await db.select().from(customerPayments)
    .where(and(eq(customerPayments.estimateId, estimate.id), eq(customerPayments.orgId, orgId)));
  const duplicate = existingPayments.find((payment) => metadataObject(payment.metadata).idempotencyKey === idempotencyKey);
  if (duplicate) return c.json({ data: duplicate, duplicate: true });

  const contractTotal = roundMoney(estimateContractValue(estimate));
  const paidAmount = roundMoney(existingPayments.reduce((sum, payment) => sum + netPaymentAmount(payment), 0));
  const remaining = roundMoney(Math.max(contractTotal - paidAmount, 0));
  const amount = roundMoney(parsed.data.amount);
  if (paidAmount > 0.005 && !parsed.data.confirmAdditionalPayment) {
    return c.json({ error: `This estimate already has ${paidAmount.toFixed(2)} recorded. Confirm this is an additional payment before saving.` }, 409);
  }
  if (remaining <= 0) {
    return c.json({ error: 'This estimate is already paid in full.' }, 409);
  }
  if (amount > remaining + 0.005) {
    return c.json({ error: `Payment cannot exceed the remaining balance of ${remaining.toFixed(2)}.` }, 409);
  }

  const job = await db.query.jobs.findFirst({
    where: and(eq(jobs.orgId, orgId), eq(jobs.estimateId, estimate.id)),
  }).catch(() => null);
  const receivedAt = parsed.data.receivedAt ? new Date(parsed.data.receivedAt) : new Date();
  const description = parsed.data.description || `${parsed.data.source.toUpperCase()} payment`;
  const [payment] = await db.insert(customerPayments).values({
    orgId,
    leadId: estimate.leadId,
    estimateId: estimate.id,
    jobId: job?.id || null,
    source: parsed.data.source,
    status: 'succeeded',
    amount: amount.toFixed(2),
    currency: 'usd',
    description,
    receivedAt,
    metadata: {
      idempotencyKey,
      reference: parsed.data.reference || null,
      confirmedAdditionalPayment: paidAmount > 0.005,
      recordedByUserId: c.get('userId') || null,
      note: 'Manual payment recorded by contractor. No Stripe charge was created.',
    },
  }).returning();

  await db.insert(auditLogs).values({
    orgId,
    userId: c.get('userId'),
    action: 'payment.manual_recorded',
    entityType: 'payment',
    entityId: payment.id,
    metadata: {
      leadId: estimate.leadId,
      estimateId: estimate.id,
      jobId: job?.id || null,
      amount,
      source: parsed.data.source,
      reference: parsed.data.reference || null,
      remainingAfterPayment: roundMoney(remaining - amount),
    },
  });

  return c.json({ data: payment }, 201);
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
    const [settings, existingPayments] = await Promise.all([
      db.query.orgSettings.findFirst({ where: eq(orgSettings.orgId, estimate.orgId) }),
      db.select().from(customerPayments)
        .where(and(eq(customerPayments.estimateId, estimate.id), eq(customerPayments.orgId, estimate.orgId))),
    ]);
    const paidAmount = existingPayments
      .filter((payment) => ['succeeded', 'paid'].includes(payment.status))
      .reduce((sum, payment) => sum + Number(payment.amount || 0) - Number(payment.refundedAmount || 0), 0);
    const schedule = estimatePaymentSchedule(settings || {}, packageTotal, paidAmount);
    const milestone = nextPayableMilestone(schedule, milestoneKey);
    if (!milestone) {
      return c.json({ error: 'No online payment is due for this estimate right now' }, 409);
    }
    const amountDue = Math.round((milestone.amount - milestone.paidAmount) * 100) / 100;
    if (!Number.isFinite(amountDue) || amountDue <= 0) {
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
  
  try {
    const isValid = await verifyWebhookSignature(
      body,
      sig,
      c.env.STRIPE_CONNECT_WEBHOOK_SECRET || c.env.STRIPE_WEBHOOK_SECRET
    );
    
    if (!isValid) {
      return c.json({ error: 'Invalid signature' }, 400);
    }
    
    const event = JSON.parse(body) as {
      type?: string;
      data?: { object?: {
        id?: string;
        metadata?: Record<string, string>;
        amount_total?: number;
        currency?: string;
        payment_intent?: string;
        payment_status?: string;
        customer_details?: { email?: string };
      } };
    };
    
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

billing.use('/history', authMiddleware);
billing.use('/:id/refund', authMiddleware);

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
  if (!orgId) return c.json({ error: 'Unauthorized' }, 401);
  const paymentId = c.req.param('id');
  const parsed = refundSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'Invalid refund request', details: parsed.error.flatten() }, 400);
  }

  const db = createDb(c.env.DATABASE_URL);
  const payment = await db.query.customerPayments.findFirst({
    where: and(eq(customerPayments.id, paymentId), eq(customerPayments.orgId, orgId)),
  });
  if (!payment) {
    return c.json({ error: 'Payment not found' }, 404);
  }

  const paidAmount = Number(payment.amount || 0);
  const refundedAmount = Number(payment.refundedAmount || 0);
  const refundableAmount = Math.max(paidAmount - refundedAmount, 0);
  if (refundableAmount <= 0) {
    return c.json({ error: 'Payment is already fully refunded' }, 409);
  }
  if (parsed.data.amount > refundableAmount) {
    return c.json({ error: `Refund cannot exceed ${refundableAmount.toFixed(2)}` }, 400);
  }

  const hasStripeReference = Boolean(payment.stripePaymentIntentId || payment.stripeChargeId);
  const refund = hasStripeReference
    ? await createRefund(c.env, {
      paymentIntentId: payment.stripePaymentIntentId,
      chargeId: payment.stripeChargeId,
      amount: parsed.data.amount,
      reason: parsed.data.reason,
      connectedAccountId: (await db.query.stripeConnections.findFirst({ where: eq(stripeConnections.orgId, orgId) }))?.stripeAccountId,
    })
    : {
      id: null,
      status: 'manual_credit_recorded',
    };

  const nextRefundedAmount = refundedAmount + parsed.data.amount;
  const nextStatus = nextRefundedAmount >= paidAmount - 0.005 ? 'refunded' : 'partially_refunded';
  const [updated] = await db.update(customerPayments)
    .set({
      refundedAmount: nextRefundedAmount.toFixed(2),
      status: nextStatus,
      stripeRefundId: refund.id,
      refundedAt: new Date(),
      updatedAt: new Date(),
      metadata: {
        ...metadataObject(payment.metadata),
        lastRefundReason: parsed.data.reason || null,
        lastRefundStatus: refund.status || null,
        lastRefundMode: hasStripeReference ? 'stripe' : 'manual',
      },
    })
    .where(and(eq(customerPayments.id, paymentId), eq(customerPayments.orgId, orgId)))
    .returning();

  await db.insert(auditLogs).values({
    orgId,
    userId: c.get('userId'),
    action: 'payment.refunded',
    entityType: 'payment',
    entityId: payment.id,
    metadata: {
      leadId: payment.leadId,
      estimateId: payment.estimateId,
      jobId: payment.jobId,
      amount: parsed.data.amount,
      refundedAmount: nextRefundedAmount,
      status: nextStatus,
      reason: parsed.data.reason,
      stripeRefundId: refund.id,
      refundMode: hasStripeReference ? 'stripe' : 'manual',
    },
  });

  return c.json({ data: updated });
});

export default billing;
