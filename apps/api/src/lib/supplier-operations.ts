import { sql } from 'drizzle-orm';
import type { DbClient } from '@crewmodo/db';

export class SupplierOperationError extends Error {
  constructor(message: string, public readonly status: 400 | 404 | 409 | 429, public readonly code: string) {
    super(message);
  }
}

// JSON from stored functions uses column names; nested document content stays untouched.
export function camelRecord<T>(row: Record<string, unknown>): T {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [
    key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()), value,
  ])) as T;
}

export async function supplierCall<T>(db: DbClient, query: ReturnType<typeof sql>): Promise<T> {
  try {
    const result = await db.execute(query);
    return (result.rows as Array<{ result: T }>)[0].result;
  } catch (error) {
    const cause = error as { code?: string; message?: string; cause?: { code?: string; message?: string } };
    const code = cause.code || cause.cause?.code;
    const statuses = { P0400: 400, P0404: 404, P0409: 409, P0429: 429 } as const;
    if (code && code in statuses) {
      throw new SupplierOperationError(cause.cause?.message || cause.message || 'Supplier invoice could not be processed.',
        statuses[code as keyof typeof statuses], code === 'P0429' ? 'OCR_ALLOWANCE_EXCEEDED' : 'SUPPLIER_OPERATION_CONFLICT');
    }
    throw error;
  }
}

export type OcrClaim = {
  state: 'reserved' | 'duplicate' | 'extracted' | 'processing' | 'unknown';
  token?: string;
  importId?: string;
  parsed?: unknown;
};

export async function reserveOcr(db: DbClient, input: {
  orgId: string; hash: string; token: string; reserveUsd: string;
  burst: number; daily: number; monthly: number; budgetUsd: string;
}) {
  return supplierCall<OcrClaim>(db, sql`select reserve_supplier_ocr(
    ${input.orgId}::uuid, ${input.hash}, ${input.token}::uuid, ${input.reserveUsd}::numeric,
    ${input.burst}::integer, ${input.daily}::integer, ${input.monthly}::integer, ${input.budgetUsd}::numeric
  ) as result`);
}

export async function retainExtraction(db: DbClient, input: {
  orgId: string; hash: string; token: string; parsed: unknown; actualUsd: string;
}) {
  const result = await db.execute(sql`update supplier_document_claims set status = 'extracted',
    parsed = ${JSON.stringify(input.parsed)}::jsonb, actual_usd = ${input.actualUsd}::numeric, updated_at = now()
    where org_id = ${input.orgId}::uuid and document_hash = ${input.hash} and token = ${input.token}::uuid
      and status = 'processing' returning token`);
  if (!result.rows.length) throw new SupplierOperationError('Document processing changed. Refresh before retrying.', 409, 'OCR_CLAIM_CHANGED');
}

export async function markExtractionUnknown(db: DbClient, orgId: string, hash: string, token: string) {
  await db.execute(sql`update supplier_document_claims set status = 'unknown', updated_at = now()
    where org_id = ${orgId}::uuid and document_hash = ${hash} and token = ${token}::uuid and status = 'processing'`);
}
