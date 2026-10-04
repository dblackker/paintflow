import { sql } from 'drizzle-orm';
import type { DbClient } from '@crewmodo/db';
import { decimal, minor, moneyText } from '../../../../packages/core/src/estimation-decimal';

export function exactUsd(value: string | number): string {
  return moneyText(usdMinor(value));
}

export function usdMinor(value: string | number): number {
  return minor(decimal(value, 'amount', { scale: 2, positive: true }), 'amount');
}

export function paymentRecord<T>(row: Record<string, unknown>): T {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [
    key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()),
    ['amount', 'refunded_amount'].includes(key) && value !== null
      ? moneyText(minor(decimal(value as string | number, key, { scale: 2 }), key)) : value,
  ])) as T;
}

export class PaymentOperationError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409, readonly code: string) { super(message); }
}

export async function paymentCall<T>(db: DbClient, query: ReturnType<typeof sql>): Promise<T> {
  try {
    const response = await db.execute(query);
    return (response.rows as Array<{ result: T }>)[0].result;
  } catch (error) {
    const cause = error as { code?: string; message?: string; cause?: { code?: string; message?: string } };
    const code = cause.code || cause.cause?.code;
    const statuses = { P0400: 400, P0404: 404, P0409: 409, P0412: 409 } as const;
    if (code && code in statuses) throw new PaymentOperationError(cause.cause?.message || cause.message || 'Payment could not be saved.',
      statuses[code as keyof typeof statuses], code === 'P0412' ? 'CHECKOUT_REVIEW_REQUIRED'
        : code === 'P0409' ? 'PAYMENT_OPERATION_CONFLICT' : code === 'P0404' ? 'PAYMENT_NOT_FOUND' : 'INVALID_PAYMENT');
    throw error;
  }
}

export type RefundOperation = {
  id: string; org_id: string; payment_id: string; state: string; amount: string; source: string;
  provider_key: string; provider_account_id: string | null; provider_livemode: boolean | null;
  provider_payment_intent_id: string | null; provider_charge_id: string | null;
};

export type RefundResult = {
  operation: RefundOperation; payment: Record<string, unknown>; dispatch?: boolean; replayed: boolean;
};

export type ObligationBalance = {
  remaining: string; closed: boolean; needsReview: boolean; pendingRefunds: number;
  allocated: string; credits: string; netCollected: string; total: string;
};

// These callable summaries are also the integration point for portal, reminder,
// and invoice checkout owners; net cash alone is not a collectible balance.
export function readPaymentBalance(db: DbClient, orgId: string, invoiceId: string | null, estimateId: string | null) {
  return paymentCall<ObligationBalance>(db, sql`select payment_obligation_balance(
    ${orgId}::uuid, ${invoiceId}::uuid, ${estimateId}::uuid) as result`);
}
