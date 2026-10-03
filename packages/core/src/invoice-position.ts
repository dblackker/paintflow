import { decimal, minor } from './estimation-decimal';

export interface InvoiceBalance {
  remaining: string;
  closed: boolean;
  needsReview: boolean;
  pendingRefunds: number;
  allocated: string;
  credits: string;
  netCollected: string;
  total: string;
}

type Invoice = { total?: string | number | null; status?: string | null; balance?: InvoiceBalance };
type Payment = { amount?: string | number | null; refundedAmount?: string | number | null; status?: string | null };

function cents(value: string | number | null | undefined) {
  return minor(decimal(value ?? '0', 'invoice amount', { scale: 2 }), 'invoice amount');
}

// Cash returned as a credit does not become a new payment obligation. The server's
// disposition-aware ledger is authoritative; legacy refunds require review.
export function invoiceCollectionPosition(invoice: Invoice, payments: Payment[] = []) {
  if (invoice.balance) {
    const balance = invoice.balance;
    return { remaining: balance.closed || balance.needsReview || balance.pendingRefunds > 0 ? 0 : cents(balance.remaining) / 100,
      closed: balance.closed, needsReview: balance.needsReview, pendingRefunds: balance.pendingRefunds };
  }
  const settled = payments.filter((payment) => ['paid', 'succeeded', 'refunded', 'partially_refunded'].includes(payment.status || ''));
  const needsReview = settled.some((payment) => cents(payment.refundedAmount) > 0);
  const closed = ['paid', 'refunded', 'canceled', 'voided'].includes(invoice.status || '');
  const allocated = settled.reduce((total, payment) => total + cents(payment.amount), 0);
  return { remaining: closed || needsReview ? 0 : Math.max(cents(invoice.total) - allocated, 0) / 100,
    closed, needsReview, pendingRefunds: 0 };
}
