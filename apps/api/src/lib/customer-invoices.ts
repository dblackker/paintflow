import { and, eq, notInArray } from 'drizzle-orm';
import {
  auditLogs,
  changeOrders,
  customerInvoices,
  customerPayments,
  estimates,
  jobs,
  leads,
  orgSettings,
} from '@crewmodo/db/schema';
import type { DbClient } from '@crewmodo/db/client';
import { estimateContractValue } from './estimate-handoff';
import { estimatePaymentSchedule, nextPayableMilestone } from './payment-schedule';
import { z } from 'zod';
import {
  add,
  compare,
  decimal,
  divide,
  exact,
  minor,
  moneyText,
  multiply,
  round,
  boundedMinor,
  EstimationInputError,
} from '../../../../packages/core/src/estimation-decimal';
import type { ResolvedEstimationTax } from '../../../../packages/core/src/estimation-tax';

export type ChangeOrderTaxSnapshot = ResolvedEstimationTax & {
  version: 'change-order-tax-v1';
  capturedAt: string;
  orgId: string;
  jobsite: {
    jobId: string;
    streetAddress: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
  };
};

export function changeOrderCommercialBreakdown(
  amount: string | number,
  tax: Pick<ResolvedEstimationTax, 'value'>,
) {
  const totalMinor = minor(decimal(amount, 'amount', { scale: 2 }), 'amount');
  const fraction = decimal(tax.value, 'taxRate', { scale: 8 });
  if (compare(fraction, exact(1n)) > 0)
    throw new EstimationInputError('taxRate', 'Sales tax must be between zero and 100%.');
  const subtotalMinor = boundedMinor(
    round(divide(exact(BigInt(totalMinor)), add(exact(1n), fraction))),
    'subtotal',
  );
  return {
    version: 'change-order-commercial-v1' as const,
    amountBasis: 'gross_inclusive' as const,
    currency: 'USD' as const,
    subtotalMinor,
    taxMinor: totalMinor - subtotalMinor,
    totalMinor,
  };
}

const taxSnapshotSchema = z.object({
  version: z.literal('change-order-tax-v1'),
  capturedAt: z.string().datetime(),
  orgId: z.string().uuid(),
  kind: z.literal('fraction'),
  value: z.string(),
  source: z.enum(['organization', 'jobsite_rule', 'override']),
  postalCode: z.string().nullable(),
  label: z.string(),
  overrideReason: z.string().nullable(),
  actorId: z.string().uuid().nullable(),
  jobsite: z.object({
    jobId: z.string().uuid(),
    streetAddress: z.string().nullable(),
    city: z.string().nullable(),
    state: z.string().nullable(),
    postalCode: z.string().nullable(),
  }),
});
const commercialSchema = z.object({
  version: z.literal('change-order-commercial-v1'),
  amountBasis: z.literal('gross_inclusive'),
  currency: z.literal('USD'),
  subtotalMinor: z.number().int().nonnegative(),
  taxMinor: z.number().int().nonnegative(),
  totalMinor: z.number().int().nonnegative(),
});

export function readChangeOrderCommercial(
  order: Pick<typeof changeOrders.$inferSelect, 'orgId' | 'jobId' | 'amount' | 'scopeDetails'>,
) {
  const scope = order.scopeDetails as Record<string, unknown> | null;
  if (!scope || !Object.prototype.hasOwnProperty.call(scope, 'taxSnapshot')) return null;
  const snapshot = taxSnapshotSchema.parse(scope.taxSnapshot) as ChangeOrderTaxSnapshot;
  const commercial = commercialSchema.parse(scope.commercialBreakdown);
  const expected = changeOrderCommercialBreakdown(order.amount, snapshot);
  if (
    snapshot.orgId !== order.orgId ||
    snapshot.jobsite.jobId !== order.jobId ||
    commercial.subtotalMinor !== expected.subtotalMinor ||
    commercial.taxMinor !== expected.taxMinor ||
    commercial.totalMinor !== expected.totalMinor
  )
    throw new Error('Change order tax snapshot does not match its agreement.');
  return { snapshot, commercial };
}

export function changeOrderInvoiceCommercial(
  order: Pick<typeof changeOrders.$inferSelect, 'orgId' | 'jobId' | 'amount' | 'scopeDetails'>,
  amountDue: string | number,
) {
  const recorded = readChangeOrderCommercial(order);
  if (!recorded) return null;
  const totalMinor = minor(decimal(amountDue, 'paymentDueAmount', { scale: 2 }), 'paymentDueAmount');
  if (totalMinor > recorded.commercial.totalMinor)
    throw new Error('Change order payment exceeds its agreement.');
  // Allocate the frozen contract tax to this payment, never recompute it from current settings.
  const taxMinor =
    recorded.commercial.totalMinor === 0
      ? 0
      : boundedMinor(
          round(
            divide(
              multiply(exact(BigInt(totalMinor)), exact(BigInt(recorded.commercial.taxMinor))),
              exact(BigInt(recorded.commercial.totalMinor)),
            ),
          ),
          'tax',
        );
  return {
    snapshot: recorded.snapshot,
    commercial: { ...recorded.commercial, subtotalMinor: totalMinor - taxMinor, taxMinor, totalMinor },
  };
}

type SelectedOption = {
  desc?: string;
  qty?: number | string;
  rate?: number | string;
  category?: string;
};

type EstimateInvoiceInput = {
  packageName?: string | null;
  selectedOptions?: SelectedOption[];
  jobId?: string | null;
  userId?: string | null;
};

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function netPayment(payment: typeof customerPayments.$inferSelect) {
  if (!['succeeded', 'paid', 'partially_refunded', 'refunded'].includes(payment.status)) return 0;
  return Number(payment.amount || 0) - Number(payment.refundedAmount || 0);
}

function invoiceDateToken() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

function invoiceNumber(prefix: string, id: string, suffix?: string | null) {
  const cleanSuffix = suffix
    ? `-${String(suffix)
        .replace(/[^a-z0-9]+/gi, '')
        .slice(0, 16)
        .toUpperCase()}`
    : '';
  return `${prefix}-${invoiceDateToken()}-${id.slice(0, 8).toUpperCase()}${cleanSuffix}`;
}

async function activeInvoiceByNumber(db: DbClient, orgId: string, number: string) {
  return db.query.customerInvoices.findFirst({
    where: and(
      eq(customerInvoices.orgId, orgId),
      eq(customerInvoices.invoiceNumber, number),
      notInArray(customerInvoices.status, ['voided', 'canceled']),
    ),
  });
}

export async function createDepositInvoiceForEstimate(
  db: DbClient,
  estimate: typeof estimates.$inferSelect,
  input: EstimateInvoiceInput = {},
) {
  const [settings, existingPayments] = await Promise.all([
    db.query.orgSettings.findFirst({ where: eq(orgSettings.orgId, estimate.orgId) }),
    db
      .select()
      .from(customerPayments)
      .where(and(eq(customerPayments.orgId, estimate.orgId), eq(customerPayments.estimateId, estimate.id))),
  ]);
  const contractValue = roundMoney(
    estimateContractValue(estimate, input.packageName, input.selectedOptions || []),
  );
  const paidAmount = roundMoney(existingPayments.reduce((sum, payment) => sum + netPayment(payment), 0));
  const schedule = estimatePaymentSchedule(settings || {}, contractValue, paidAmount);
  const milestone = nextPayableMilestone(schedule);
  if (!milestone) return null;

  const amountDue = roundMoney(milestone.amount - milestone.paidAmount);
  if (!Number.isFinite(amountDue) || amountDue <= 0.005) return null;

  const number = invoiceNumber('DEP', estimate.id, milestone.key);
  const existing = await activeInvoiceByNumber(db, estimate.orgId, number);
  if (existing) return existing;

  const [invoice] = await db
    .insert(customerInvoices)
    .values({
      orgId: estimate.orgId,
      leadId: estimate.leadId,
      estimateId: estimate.id,
      jobId: input.jobId || null,
      invoiceNumber: number,
      description: `${milestone.label || 'Deposit'} for signed proposal`,
      lineItems: [
        {
          description: milestone.label || 'Deposit',
          quantity: 1,
          unitPrice: amountDue,
          total: amountDue,
          category: 'deposit',
          milestoneKey: milestone.key,
          milestoneDue: milestone.due,
          estimateId: estimate.id,
        },
      ],
      subtotal: amountDue.toFixed(2),
      tax: '0.00',
      total: amountDue.toFixed(2),
      status: 'sent',
      dueLabel: milestone.due || 'Due now to reserve the schedule',
      reminderCadence: 'due_date',
      note: 'Generated automatically after the proposal was signed.',
      createdBy: input.userId || null,
    })
    .returning();

  await db.insert(auditLogs).values({
    orgId: estimate.orgId,
    userId: input.userId || null,
    action: 'invoice.deposit_created',
    entityType: 'invoice',
    entityId: invoice.id,
    metadata: {
      leadId: estimate.leadId,
      estimateId: estimate.id,
      jobId: input.jobId || null,
      milestoneKey: milestone.key,
      amountDue,
      contractValue,
    },
  });

  return invoice;
}

export async function createInvoiceForChangeOrder(
  db: DbClient,
  order: typeof changeOrders.$inferSelect,
  leadId: string,
  input: { userId?: string | null } = {},
) {
  if (!order.paymentRequired) return null;
  const recorded = readChangeOrderCommercial(order);
  const amountDue = recorded
    ? Number(order.paymentDueAmount ?? order.amount)
    : roundMoney(Number(order.paymentDueAmount || 0) || Number(order.amount || 0));
  if (!Number.isFinite(amountDue) || amountDue <= 0.005) return null;

  const number = invoiceNumber('CO', order.id);
  const existing = await activeInvoiceByNumber(db, order.orgId, number);
  if (existing) {
    if (existing.leadId !== leadId || existing.jobId !== order.jobId || existing.changeOrderId !== order.id) {
      throw new Error('Change order invoice does not match this customer and job.');
    }
    return existing;
  }
  const job = await db.query.jobs.findFirst({
    where: and(eq(jobs.id, order.jobId), eq(jobs.orgId, order.orgId)),
  });
  const customer = await db.query.leads.findFirst({
    where: and(eq(leads.id, leadId), eq(leads.orgId, order.orgId)),
  });
  const estimate = await db.query.estimates.findFirst({
    where: and(
      eq(estimates.id, order.estimateId),
      eq(estimates.orgId, order.orgId),
      eq(estimates.leadId, leadId),
    ),
  });
  if (!job || !customer || !estimate || job.leadId !== leadId || job.estimateId !== order.estimateId) {
    throw new Error('Change order invoice customer and job do not match.');
  }

  const breakdown = changeOrderInvoiceCommercial(order, order.paymentDueAmount ?? order.amount);
  const subtotal = breakdown ? moneyText(breakdown.commercial.subtotalMinor) : amountDue.toFixed(2);
  const tax = breakdown ? moneyText(breakdown.commercial.taxMinor) : '0.00';
  const total = breakdown ? moneyText(breakdown.commercial.totalMinor) : amountDue.toFixed(2);

  const [invoice] = await db
    .insert(customerInvoices)
    .values({
      orgId: order.orgId,
      leadId,
      estimateId: order.estimateId,
      jobId: order.jobId,
      changeOrderId: order.id,
      invoiceNumber: number,
      description: 'Approved change order payment',
      lineItems: [
        {
          description: order.description || 'Change order',
          quantity: 1,
          unitPrice: Number(subtotal),
          total: Number(subtotal),
          category: 'change_order',
          changeOrderId: order.id,
          ...(breakdown
            ? { taxSnapshot: breakdown.snapshot, commercialBreakdown: breakdown.commercial }
            : {}),
        },
      ],
      subtotal,
      tax,
      total,
      // The legacy numeric(7,4) column cannot store every policy fraction exactly.
      // Exact fraction/provenance is retained in the line-item snapshot instead.
      taxRate: null,
      status: 'sent',
      dueLabel: 'Due after change order approval',
      reminderCadence: 'due_date',
      note: 'Generated automatically after the change order was approved.',
      createdBy: input.userId || null,
    })
    .returning();

  await db.insert(auditLogs).values({
    orgId: order.orgId,
    userId: input.userId || null,
    action: 'invoice.change_order_created',
    entityType: 'invoice',
    entityId: invoice.id,
    metadata: {
      leadId,
      estimateId: order.estimateId,
      jobId: order.jobId,
      changeOrderId: order.id,
      amountDue,
      ...(breakdown ? { taxSnapshot: breakdown.snapshot, commercialBreakdown: breakdown.commercial } : {}),
    },
  });

  return invoice;
}
