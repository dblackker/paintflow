import { and, eq, notInArray } from 'drizzle-orm';
import { auditLogs, changeOrders, customerInvoices, customerPayments, estimates, orgSettings } from '@crewmodo/db/schema';
import type { DbClient } from '@crewmodo/db/client';
import { estimateContractValue } from './estimate-handoff';
import { estimatePaymentSchedule, nextPayableMilestone } from './payment-schedule';

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
  const cleanSuffix = suffix ? `-${String(suffix).replace(/[^a-z0-9]+/gi, '').slice(0, 16).toUpperCase()}` : '';
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
    db.select().from(customerPayments).where(and(eq(customerPayments.orgId, estimate.orgId), eq(customerPayments.estimateId, estimate.id))),
  ]);
  const contractValue = roundMoney(estimateContractValue(estimate, input.packageName, input.selectedOptions || []));
  const paidAmount = roundMoney(existingPayments.reduce((sum, payment) => sum + netPayment(payment), 0));
  const schedule = estimatePaymentSchedule(settings || {}, contractValue, paidAmount);
  const milestone = nextPayableMilestone(schedule);
  if (!milestone) return null;

  const amountDue = roundMoney(milestone.amount - milestone.paidAmount);
  if (!Number.isFinite(amountDue) || amountDue <= 0.005) return null;

  const number = invoiceNumber('DEP', estimate.id, milestone.key);
  const existing = await activeInvoiceByNumber(db, estimate.orgId, number);
  if (existing) return existing;

  const [invoice] = await db.insert(customerInvoices).values({
    orgId: estimate.orgId,
    leadId: estimate.leadId,
    estimateId: estimate.id,
    jobId: input.jobId || null,
    invoiceNumber: number,
    description: `${milestone.label || 'Deposit'} for signed proposal`,
    lineItems: [{
      description: milestone.label || 'Deposit',
      quantity: 1,
      unitPrice: amountDue,
      total: amountDue,
      category: 'deposit',
      milestoneKey: milestone.key,
      milestoneDue: milestone.due,
      estimateId: estimate.id,
    }],
    subtotal: amountDue.toFixed(2),
    tax: '0.00',
    total: amountDue.toFixed(2),
    status: 'sent',
    dueLabel: milestone.due || 'Due now to reserve the schedule',
    reminderCadence: 'due_date',
    note: 'Generated automatically after the proposal was signed.',
    createdBy: input.userId || null,
  }).returning();

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
  const amountDue = roundMoney(Number(order.paymentDueAmount || 0) || Number(order.amount || 0));
  if (!Number.isFinite(amountDue) || amountDue <= 0.005) return null;

  const number = invoiceNumber('CO', order.id);
  const existing = await activeInvoiceByNumber(db, order.orgId, number);
  if (existing) return existing;

  const [invoice] = await db.insert(customerInvoices).values({
    orgId: order.orgId,
    leadId,
    estimateId: order.estimateId,
    jobId: order.jobId,
    changeOrderId: order.id,
    invoiceNumber: number,
    description: 'Approved change order payment',
    lineItems: [{
      description: order.description || 'Change order',
      quantity: 1,
      unitPrice: amountDue,
      total: amountDue,
      category: 'change_order',
      changeOrderId: order.id,
    }],
    subtotal: amountDue.toFixed(2),
    tax: '0.00',
    total: amountDue.toFixed(2),
    status: 'sent',
    dueLabel: 'Due after change order approval',
    reminderCadence: 'due_date',
    note: 'Generated automatically after the change order was approved.',
    createdBy: input.userId || null,
  }).returning();

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
    },
  });

  return invoice;
}
