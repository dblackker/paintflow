import { createDb } from '@crewmodo/db';
import { customerInvoices } from '@crewmodo/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import type { Env } from '../types';
import { prepareInvoiceEmail, sendPreparedInvoiceEmail, type PreparedInvoiceEmail } from './invoice-emails';

/** Provider idempotency protects the crash boundary after send but before marking delivered. */
export async function deliverAcceptedEstimate(env: Env, orgId: string, deliveryId: string) {
  if ((env.EMAIL_PROVIDER && env.EMAIL_PROVIDER !== 'resend') || !env.RESEND_API_KEY) return;
  const db = createDb(env.DATABASE_URL);
  const claimed = await db.execute(sql`update accepted_estimate_deliveries set status='sending', attempts=attempts+1,
    first_attempt_at=coalesce(first_attempt_at,now()),lease_until=now()+interval '5 minutes'
    where id=${deliveryId}::uuid and org_id=${orgId}::uuid and status in ('pending','sending')
      and (lease_until is null or lease_until < now()) and attempts < 8
      and (first_attempt_at is null or first_attempt_at > now()-interval '23 hours')
    returning invoice_id,portal_url,attempts,prepared_email`);
  const row = claimed.rows[0] as { invoice_id: string; portal_url: string; attempts: number; prepared_email: PreparedInvoiceEmail | null } | undefined;
  if (!row) return;
  try {
    const invoice = await db.query.customerInvoices.findFirst({ where: and(eq(customerInvoices.id, row.invoice_id), eq(customerInvoices.orgId, orgId)) });
    if (!invoice) throw new Error('INVOICE_NOT_FOUND');
    let prepared = row.prepared_email;
    if (!prepared) {
      prepared = await prepareInvoiceEmail(env, db, { orgId, invoice, templateKey: 'invoice.deposit.created', portalUrl: row.portal_url,
        idempotencyKey: `accepted-estimate/${deliveryId}` });
      if (prepared) {
        const frozen = await db.execute(sql`update accepted_estimate_deliveries set prepared_email=coalesce(prepared_email,${JSON.stringify(prepared)}::jsonb)
          where id=${deliveryId}::uuid and org_id=${orgId}::uuid and status='sending' and attempts=${row.attempts} returning prepared_email`);
        if (!frozen.rows[0]) return;
        prepared = (frozen.rows[0] as { prepared_email: PreparedInvoiceEmail }).prepared_email;
      }
    }
    const outcome = prepared ? await sendPreparedInvoiceEmail(env, db, prepared, `accepted-estimate/${deliveryId}`) : { sent: false };
    await db.execute(sql`update accepted_estimate_deliveries set status=${outcome.sent ? 'sent' : 'needs_attention'},
      sent_at=${outcome.sent ? new Date() : null},lease_until=null,last_error=${outcome.sent ? null : 'Customer email is missing.'}
      where id=${deliveryId}::uuid and org_id=${orgId}::uuid and status='sending' and attempts=${row.attempts}`);
  } catch {
    await db.execute(sql`update accepted_estimate_deliveries set status='pending',lease_until=now()+interval '30 minutes',
      last_error='Deposit email could not be delivered. The signed agreement and invoice are saved.'
      where id=${deliveryId}::uuid and org_id=${orgId}::uuid and status='sending' and attempts=${row.attempts}`);
    console.warn('accepted_estimate_delivery_failed', { deliveryId });
  }
}

export async function retryAcceptedEstimateDeliveries(env: Env) {
  const db = createDb(env.DATABASE_URL);
  await db.execute(sql`update accepted_estimate_deliveries set status='needs_attention',lease_until=null
    where status in ('pending','sending') and (attempts >= 8 or first_attempt_at < now()-interval '23 hours')`);
  const pending = await db.execute(sql`select id,org_id from accepted_estimate_deliveries where status in ('pending','sending')
    and (lease_until is null or lease_until < now()) order by created_at limit 20`);
  for (const row of pending.rows as Array<{ id: string; org_id: string }>) await deliverAcceptedEstimate(env, row.org_id, row.id);
}
