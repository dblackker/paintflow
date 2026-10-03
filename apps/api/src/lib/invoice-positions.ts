import type { DbClient } from '@crewmodo/db';
import { sql } from 'drizzle-orm';
import type { InvoiceBalance } from '../../../../packages/core/src/invoice-position';

// Bound the selected invoices first, then obtain complete balances without a
// truncated payment-history page or one network round trip per invoice.
export async function readInvoiceBalances(db: DbClient, orgId: string, ids: string[]) {
  if (!ids.length) return new Map<string, InvoiceBalance>();
  const result = await db.execute(sql`select id, payment_obligation_balance(org_id, id, null) as balance
    from customer_invoices where org_id = ${orgId}::uuid
      and id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})`);
  return new Map((result.rows as Array<{ id: string; balance: InvoiceBalance }>).map((row) => [row.id, row.balance]));
}
