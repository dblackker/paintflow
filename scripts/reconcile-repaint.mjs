import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import pg from 'pg';

export function reconciliationTarget(connection, orgId, allowRemote = false) {
  if (!connection) throw new Error('Set RECONCILE_DATABASE_URL explicitly.');
  const url = new URL(connection);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Use a PostgreSQL connection.');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orgId || '')) throw new Error('Specify one workspace UUID with --org.');
  const local = !url.hostname || ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname);
  if (!local && !allowRemote) throw new Error('Remote read-only reconciliation requires --allow-remote.');
  return { connection, orgId };
}

export async function reconcileRepaint(client, orgId) {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    await client.query("SELECT set_config('app.current_org_id',$1,true)", [orgId]);
    const historical = (await client.query(`SELECT id,total,status,signed_name,signed_at,packages,signature_data
      FROM estimates WHERE org_id=$1 AND signed_at IS NOT NULL ORDER BY id`, [orgId])).rows;
    const fingerprint = createHash('sha256').update(JSON.stringify(historical)).digest('hex');
    const counts = (await client.query(`SELECT
      (SELECT count(*) FROM supplier_invoice_imports WHERE org_id=$1 AND status='needs_review') as imports_waiting,
      (SELECT count(*) FROM supplier_document_claims WHERE org_id=$1 AND status='unknown') as ocr_unknown,
      (SELECT count(*) FROM supplier_document_claims WHERE org_id=$1 AND status='processing' AND updated_at<now()-interval '3 minutes') as ocr_stale,
      (SELECT count(*) FROM payment_refund_operations WHERE org_id=$1 AND state IN ('reserved','pending','unknown')) as refunds_unresolved,
      (SELECT count(*) FROM customer_invoices WHERE org_id=$1 AND (payment_obligation_balance(org_id,id,null)->>'needsReview')::boolean) as invoice_dispositions_need_review,
      (SELECT count(*) FROM (SELECT document_hash FROM material_purchases WHERE org_id=$1 AND document_hash IS NOT NULL GROUP BY document_hash HAVING count(*)>1) d) as duplicate_purchase_hashes,
      (SELECT count(*) FROM (SELECT stripe_checkout_session_id FROM customer_payments WHERE org_id=$1 AND stripe_checkout_session_id IS NOT NULL GROUP BY stripe_checkout_session_id HAVING count(*)>1) d) as duplicate_checkout_sessions`, [orgId])).rows[0];
    const money = (await client.query(`SELECT
      (SELECT coalesce(sum(amount),0)::text FROM customer_payments WHERE org_id=$1 AND status IN ('paid','succeeded','partially_refunded','refunded')) as receipts_gross,
      (SELECT coalesce(sum(refunded_amount),0)::text FROM customer_payments WHERE org_id=$1 AND status IN ('paid','succeeded','partially_refunded','refunded')) as refunds_recorded,
      (SELECT coalesce(sum(amount),0)::text FROM payment_refund_operations WHERE org_id=$1 AND state='succeeded') as credits_confirmed,
      (SELECT coalesce(sum(total_cost),0)::text FROM job_costs WHERE org_id=$1) as job_costs_recorded`, [orgId])).rows[0];
    await client.query('COMMIT');
    return { schemaVersion: 1, readOnly: true, orgId, signedEstimateCount: historical.length,
      signedHistoryFingerprint: fingerprint, counts, money };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function main() {
  const { values } = parseArgs({ options: { org: { type: 'string' }, 'allow-remote': { type: 'boolean', default: false } } });
  const target = reconciliationTarget(process.env.RECONCILE_DATABASE_URL, values.org, values['allow-remote']);
  const client = new pg.Client({ connectionString: target.connection, connectionTimeoutMillis: 10000, statement_timeout: 30000 });
  try {
    await client.connect();
    console.log(JSON.stringify(await reconcileRepaint(client, target.orgId), null, 2));
  } finally { await client.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error('Read-only reconciliation failed.', { code: error.code || 'CHECK_CONFIGURATION' }); process.exitCode = 1; });
}
