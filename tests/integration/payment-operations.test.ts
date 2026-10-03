import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import billing from '../../apps/api/src/routes/billing';
import { bridgeNeonToPostgres, disposableDatabase, migrateDisposableDatabase } from './local-db';

// The shared helper rejects remote/non-_test URLs and requires explicit reset permission.
const pool = disposableDatabase();
const restoreBridge = bridgeNeonToPostgres(pool);
const originalFetch = globalThis.fetch;
const org = randomUUID();
const foreignOrg = randomUUID();
const actor = randomUUID();
const secondActor = randomUUID();
const crew = randomUUID();
const account = 'acct_synthetic_never_live';
let lead: string;
let foreignLead: string;
let providerCalls = 0;
const kv = new Map<string, string>();
const env = {
  DATABASE_URL: 'postgresql://synthetic:synthetic@localhost:5432/crewmodo_payment_operations_test',
  ENVIRONMENT: 'test', STRIPE_SECRET_KEY: 'sk_test_synthetic_never_live', STRIPE_CONNECT_WEBHOOK_SECRET: 'whsec_synthetic',
  EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'synthetic_never_live', EMAIL_FROM: 'receipts@example.invalid', PUBLIC_URL: 'http://localhost:5173',
  KV: { get: async (key: string) => kv.get(key) || null, delete: async (key: string) => { kv.delete(key); } },
};

function api(path: string, body: unknown, key = randomUUID(), token = 'owner') {
  return billing.fetch(new Request(`http://localhost${path}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify(body),
  }), env as never);
}
function noProvider() {
  globalThis.fetch = async () => { throw new Error('Unexpected external request: this suite never calls a live provider'); };
}
function provider(status: string, fail = false) {
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), 'https://api.stripe.com/v1/refunds');
    const headers = new Headers(options?.headers);
    assert.equal(headers.get('Authorization'), 'Bearer sk_test_synthetic_never_live');
    assert.equal(headers.get('Stripe-Account'), account);
    assert.match(headers.get('Idempotency-Key')!, /^crewmodo:refund:[a-f0-9-]{36}$/);
    assert.ok(options?.signal, 'Provider calls have a bounded timeout');
    providerCalls++;
    if (fail) throw new Error('Synthetic connection lost after possible provider commit');
    const body = new URLSearchParams(String(options?.body));
    return Response.json({ id: `re_${body.get('metadata[crewmodo_refund_operation]')}`, status,
      amount: Number(body.get('amount')), currency: 'usd',
      payment_intent: body.get('payment_intent'), charge: body.get('charge'),
    });
  };
}

before(async () => {
  noProvider();
  await migrateDisposableDatabase(pool);
  // Coordinator registers the journal; still test the owned migration before registration.
  if (!(await pool.query("SELECT to_regclass('payment_refund_operations') AS relation")).rows[0].relation) {
    const migration = await readFile(new URL('../../packages/db/migrations/0031_payment_operation_safety.sql', import.meta.url), 'utf8');
    for (const statement of migration.split('--> statement-breakpoint')) if (statement.trim()) await pool.query(statement);
  }
  await pool.query('INSERT INTO organizations (id,name,slug) VALUES ($1,$2,$2),($3,$4,$4)', [org, `payments-${org}`, foreignOrg, `foreign-${foreignOrg}`]);
  for (const id of [actor, secondActor, crew]) await pool.query('INSERT INTO users(id,email) VALUES ($1,$2)', [id, `${id}@example.invalid`]);
  await pool.query("INSERT INTO memberships(org_id,user_id,role) VALUES ($1,$2,'owner'),($1,$3,'owner'),($1,$4,'member'),($5,$2,'owner')", [org, actor, secondActor, crew, foreignOrg]);
  lead = (await pool.query('INSERT INTO leads(org_id,name) VALUES ($1,$2) RETURNING id', [org, 'Synthetic customer'])).rows[0].id;
  foreignLead = (await pool.query('INSERT INTO leads(org_id,name) VALUES ($1,$2) RETURNING id', [foreignOrg, 'Private customer'])).rows[0].id;
  await pool.query('INSERT INTO stripe_connections(org_id,stripe_account_id) VALUES ($1,$2)', [org, account]);
  for (const [token, userId, orgId] of [['owner', actor, org], ['second', secondActor, org], ['crew', crew, org], ['foreign', actor, foreignOrg]]) {
    kv.set(`session:${token}`, JSON.stringify({ userId, orgId, email: 'synthetic@example.invalid', expiresAt: Date.now() + 3600000 }));
  }
});
after(async () => { globalThis.fetch = originalFetch; restoreBridge(); await pool.end(); });

async function invoice(total = '100.00', tenant = org, estimateId: string | null = null, status = 'sent') {
  return (await pool.query('INSERT INTO customer_invoices(org_id,lead_id,estimate_id,invoice_number,description,line_items,subtotal,total,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8) RETURNING id',
    [tenant, tenant === org ? lead : foreignLead, estimateId, randomUUID(), 'Synthetic invoice', '[]', total, status])).rows[0].id as string;
}
async function estimate(total = '100.00', status = 'accepted') {
  return (await pool.query('INSERT INTO estimates(org_id,lead_id,packages,total,status) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [org, lead, JSON.stringify([{ name: 'proposal', total }]), total, status])).rows[0].id as string;
}
function manual(invoiceId: string, amount = '100.00', extra = {}) {
  return { invoiceId, amount, source: 'check', sendReceipt: false, receivedAt: '2020-01-01T12:00:00Z', ...extra };
}
async function pay(invoiceId: string, amount = '100.00') {
  const response = await api('/manual', manual(invoiceId, amount));
  assert.equal(response.status, 201, await response.clone().text());
  return (await response.json() as any).data;
}
function refund(amount = '100.00', extra = {}) {
  return { amount, reason: 'Customer-approved credit', method: 'check', confirmManualRefund: true,
    refundedAt: '2021-01-01T12:00:00Z', disposition: 'credit', ...extra };
}
async function cardPayment(invoiceId: string) {
  return (await pool.query("INSERT INTO customer_payments(org_id,lead_id,invoice_id,source,status,amount,currency,stripe_payment_intent_id) VALUES ($1,$2,$3,'stripe','succeeded',100,'usd',$4) RETURNING *",
    [org, lead, invoiceId, `pi_${randomUUID()}`])).rows[0];
}
function reserve(paymentId: string, body: unknown, key = randomUUID(), tenant = org) {
  return pool.query('SELECT reserve_payment_refund($1,$2,$3,$4,$5,$6,$7) AS result', [tenant, actor, key, paymentId, body, account, false]);
}
async function balance(invoiceId: string | null, estimateId: string | null = null) {
  return (await pool.query('SELECT payment_obligation_balance($1,$2,$3) AS result', [org, invoiceId, estimateId])).rows[0].result;
}
async function webhook(operation: any, payment: any, status = 'succeeded', overrides = {}, envelope = {}) {
  const event = { id: `evt_${randomUUID()}`, type: 'refund.updated', account, livemode: false,
    data: { object: { id: `re_${operation.id}`, status, amount: 10000, currency: 'usd',
      payment_intent: payment.stripe_payment_intent_id, metadata: { orgId: org, crewmodo_refund_operation: operation.id }, ...overrides } }, ...envelope };
  const body = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const signature = createHmac('sha256', env.STRIPE_CONNECT_WEBHOOK_SECRET).update(`${t}.${body}`).digest('hex');
  return billing.fetch(new Request('http://localhost/webhook', { method: 'POST', headers: {
    'stripe-signature': `t=${t},v1=${signature}`, 'Content-Type': 'application/json',
  }, body }), env as never);
}

test('actual Hono/Drizzle manual payment authentication, exact money and tenant guards', async () => {
  const id = await invoice();
  assert.equal((await api('/manual', manual(id), undefined, 'missing')).status, 401);
  assert.equal((await api('/manual', manual(id), undefined, 'crew')).status, 403);
  assert.equal((await api('/manual', manual(id), undefined, 'foreign')).status, 404);
  for (const amount of [0, -1, '1.005', '1e2', 'NaN', '100000000.00']) {
    assert.equal((await api('/manual', manual(id, amount as any))).status, 400);
  }
  assert.equal((await pool.query('SELECT count(*) FROM customer_payments WHERE invoice_id=$1', [id])).rows[0].count, '0');
});

test('job-cost permission cannot move customer money; combined invoice roles are honored', async () => {
  const costRole = randomUUID(); const invoiceRole = randomUUID();
  const id = await invoice();
  const ownerPayment = await pay(await invoice());
  await pool.query('INSERT INTO roles(id,org_id,name,permissions) VALUES ($1,$2,$3,$4),($5,$2,$6,$7)',
    [costRole, org, 'Cost reviewer', JSON.stringify(['manage_job_costs']), invoiceRole, 'Invoice manager', JSON.stringify(['manage_invoices'])]);
  try {
    await pool.query('INSERT INTO user_roles(org_id,user_id,role_id) VALUES ($1,$2,$3)', [org, crew, costRole]);
    assert.equal((await api('/manual', manual(id), undefined, 'crew')).status, 403);
    assert.equal((await api(`/${ownerPayment.id}/refund`, refund(), undefined, 'crew')).status, 403);
    await pool.query('INSERT INTO user_roles(org_id,user_id,role_id) VALUES ($1,$2,$3)', [org, crew, invoiceRole]);
    assert.equal((await api('/manual', manual(id), undefined, 'crew')).status, 201);
    assert.equal((await api(`/${ownerPayment.id}/refund`, refund(), undefined, 'crew')).status, 200);
  } finally {
    await pool.query('DELETE FROM user_roles WHERE org_id=$1 AND user_id=$2', [org, crew]);
    await pool.query('DELETE FROM roles WHERE org_id=$1 AND id IN ($2,$3)', [org, costRole, invoiceRole]);
  }
});

test('eight concurrent full manual payments cannot overallocate an invoice', async () => {
  const id = await invoice();
  const responses = await Promise.all(Array.from({ length: 8 }, () => api('/manual', manual(id))));
  assert.equal(responses.filter((response) => response.status === 201).length, 1);
  assert.equal(responses.filter((response) => response.status === 409).length, 7);
  assert.equal((await pool.query('SELECT sum(amount),count(*) FROM customer_payments WHERE invoice_id=$1', [id])).rows[0].sum, '100.00');
});

test('durable scope keys replay one result and changed amount/reference/receipt payload conflicts', async () => {
  const id = await invoice('200.00'); const key = randomUUID(); const body = manual(id);
  const outcomes = await Promise.all(Array.from({ length: 6 }, () => api('/manual', body, key)));
  assert.equal(outcomes.filter((response) => response.status === 201).length, 1);
  assert.equal(outcomes.filter((response) => response.status === 200).length, 5);
  const ids = await Promise.all(outcomes.map(async (response) => (await response.json() as any).data.id));
  assert.equal(new Set(ids).size, 1);
  for (const extra of [{ amount: '99.00' }, { reference: 'different' }, { sendReceipt: true }]) {
    assert.equal((await api('/manual', { ...body, ...extra }, key)).status, 409);
  }
  assert.equal((await api('/manual', body)).status, 409, 'Different key still requires additional-payment confirmation');
  assert.equal((await api('/manual', { ...body, confirmAdditionalPayment: true }, key, 'second')).status, 201, 'Keys are actor-scoped');
});

test('estimate balance lock and related invoice allocation cannot be bypassed', async () => {
  const id = await estimate();
  const body = { estimateId: id, amount: '100.00', source: 'cash', sendReceipt: false };
  const outcomes = await Promise.all(Array.from({ length: 6 }, () => api('/manual', body)));
  assert.equal(outcomes.filter((response) => response.status === 201).length, 1);
  assert.equal(outcomes.filter((response) => response.status === 409).length, 5);
  const linked = await estimate(); const a = await invoice('100.00', org, linked); const b = await invoice('100.00', org, linked);
  assert.equal((await api('/manual', { ...body, estimateId: linked })).status, 409, 'Use the issued invoice');
  const parallel = await Promise.all([api('/manual', manual(a)), api('/manual', manual(b))]);
  assert.equal(parallel.filter((response) => response.status === 201).length, 1);
  assert.equal(parallel.filter((response) => response.status === 409).length, 1);
  assert.equal((await balance(null, linked)).remaining, '0.00');
});

test('later audit failure rolls back payment, invoice update and durable result together', async () => {
  const id = await invoice(); const key = randomUUID();
  await pool.query(`CREATE FUNCTION test_payment_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.metadata->>'invoiceId' = '${id}' THEN RAISE EXCEPTION 'Synthetic audit failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER test_payment_audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION test_payment_audit_failure();`);
  try { assert.equal((await api('/manual', manual(id), key)).status, 503); }
  finally { await pool.query('DROP TRIGGER test_payment_audit_failure ON audit_logs; DROP FUNCTION test_payment_audit_failure();'); }
  assert.equal((await pool.query('SELECT count(*) FROM customer_payments WHERE invoice_id=$1', [id])).rows[0].count, '0');
  assert.equal((await pool.query('SELECT status FROM customer_invoices WHERE id=$1', [id])).rows[0].status, 'sent');
  assert.equal((await pool.query('SELECT count(*) FROM operation_results WHERE operation_key=$1', [key])).rows[0].count, '0');
  assert.equal((await api('/manual', manual(id), key)).status, 201);
});

test('manual refund never invokes Stripe even with a stale provider reference; evidence is required and retained', async () => {
  noProvider(); const id = await invoice(); const payment = await pay(id);
  await pool.query('UPDATE customer_payments SET stripe_payment_intent_id=$1 WHERE id=$2', [`pi_stale_${randomUUID()}`, payment.id]);
  for (const extra of [{ confirmManualRefund: false }, { method: undefined }, { method: 'credit' }, { reason: '' }]) {
    assert.equal((await api(`/${payment.id}/refund`, refund('100.00', extra))).status, 400);
  }
  const key = randomUUID(); const body = refund('100.00', { reference: 'CHECK-RETURN-42' });
  assert.equal((await api(`/${payment.id}/refund`, body, key)).status, 200);
  assert.equal((await api(`/${payment.id}/refund`, body, key)).status, 200);
  assert.equal((await api(`/${payment.id}/refund`, { ...body, reason: 'Changed' }, key)).status, 409);
  const operation = (await pool.query('SELECT * FROM payment_refund_operations WHERE payment_id=$1', [payment.id])).rows[0];
  assert.equal(operation.source, 'check'); assert.equal(operation.method, 'check'); assert.equal(operation.state, 'succeeded');
  assert.equal(operation.reference, 'CHECK-RETURN-42'); assert.equal(operation.reason, body.reason);
  assert.equal(operation.effective_at.toISOString(), '2021-01-01T12:00:00.000Z');
  assert.equal(operation.provider_refund_id, null); assert.equal(operation.settlement_evidence.manualReturnAcknowledged, true);
  assert.equal((await pool.query('SELECT count(*) FROM audit_logs WHERE entity_id=$1 AND action=$2', [payment.id, 'payment.refunded'])).rows[0].count, '1');
  assert.equal((await api('/manual', manual(id))).status, 409);
  assert.equal((await balance(id)).closed, true);
});

test('partial credited refund preserves issued total and does not reopen collectible balance', async () => {
  const id = await invoice(); const payment = await pay(id);
  assert.equal((await api(`/${payment.id}/refund`, refund('25.10'))).status, 200);
  const result = await balance(id);
  assert.equal(result.remaining, '0.00'); assert.equal(result.credits, '25.10'); assert.equal(result.netCollected, '74.90');
  assert.equal((await pool.query('SELECT total,status FROM customer_invoices WHERE id=$1', [id])).rows[0].total, '100.00');
  assert.equal((await api('/manual', manual(id, '25.10', { confirmAdditionalPayment: true }))).status, 409);
  const partial = await invoice(); const partialPayment = await pay(partial, '60.00');
  assert.equal((await api(`/${partialPayment.id}/refund`, refund('10.00'))).status, 200);
  assert.equal((await balance(partial)).remaining, '40.00', 'Only the previously unpaid portion remains collectible');
  assert.equal((await api('/manual', manual(partial, '40.00', { confirmAdditionalPayment: true }))).status, 201);
});

test('canceled/refunded/historical uncertain obligations and unresolved online checkout fail closed', async () => {
  for (const status of ['canceled', 'voided', 'refunded']) assert.equal((await api('/manual', manual(await invoice('100.00', org, null, status)))).status, 409);
  const id = await invoice(); const payment = await pay(id, '50.00');
  await pool.query("UPDATE customer_payments SET refunded_amount=10,status='partially_refunded' WHERE id=$1", [payment.id]);
  assert.equal((await balance(id)).needsReview, true);
  assert.equal((await api('/manual', manual(id, '10.00', { confirmAdditionalPayment: true }))).status, 409);
  assert.equal((await api(`/${payment.id}/refund`, refund('10.00'))).status, 409);
  const online = await invoice(); await pool.query('UPDATE customer_invoices SET stripe_checkout_session_id=$1 WHERE id=$2', ['cs_unresolved', online]);
  assert.equal((await api('/manual', manual(online))).status, 409);
});

test('pending provider refund retains reservation, retries do not call provider, verified webhook settles once', async () => {
  provider('pending'); const before = providerCalls; const id = await invoice(); const payment = await cardPayment(id); const key = randomUUID();
  const body = { amount: '100.00', reason: 'Customer request', disposition: 'credit' };
  const response = await api(`/${payment.id}/refund`, body, key);
  assert.equal(response.status, 202, await response.clone().text());
  assert.equal(providerCalls - before, 1);
  const op = (await pool.query('SELECT * FROM payment_refund_operations WHERE payment_id=$1', [payment.id])).rows[0];
  assert.equal(op.state, 'pending'); assert.equal(op.provider_key, `crewmodo:refund:${op.id}`);
  assert.equal((await pool.query('SELECT refunded_amount FROM customer_payments WHERE id=$1', [payment.id])).rows[0].refunded_amount, '0.00');
  assert.equal((await api(`/${payment.id}/refund`, body, key)).status, 202);
  assert.equal((await api(`/${payment.id}/refund`, { ...body, amount: '99.00' }, key)).status, 409);
  assert.equal((await api(`/${payment.id}/refund`, body)).status, 409);
  assert.equal(providerCalls - before, 1);
  assert.equal((await webhook(op, payment, 'succeeded', { currency: 'eur' })).status, 409);
  assert.equal((await webhook(op, payment, 'succeeded', { payment_intent: 'pi_not_original' })).status, 409);
  assert.equal((await webhook(op, payment)).status, 200);
  assert.equal((await webhook(op, payment)).status, 200);
  assert.equal((await webhook(op, payment, 'pending')).status, 200, 'Late pending event cannot undo confirmed success');
  assert.equal((await pool.query('SELECT refunded_amount FROM customer_payments WHERE id=$1', [payment.id])).rows[0].refunded_amount, '100.00');
  assert.equal((await pool.query('SELECT count(*) FROM audit_logs WHERE entity_id=$1 AND action=$2', [payment.id, 'payment.refunded'])).rows[0].count, '1');
  assert.equal((await balance(id)).closed, true);
  noProvider();
});

test('concurrent full refund reservations across actors/keys cannot exceed original payment', async () => {
  const payment = await cardPayment(await invoice());
  const outcomes = await Promise.allSettled(Array.from({ length: 8 }, () => reserve(payment.id, { amount: '100.00', reason: 'Synthetic refund', disposition: 'credit' })));
  assert.equal(outcomes.filter((row) => row.status === 'fulfilled').length, 1);
  for (const row of outcomes) if (row.status === 'rejected') assert.equal(row.reason.code, 'P0409');
  assert.equal((await pool.query("SELECT sum(amount) FROM payment_refund_operations WHERE payment_id=$1 AND state='reserved'", [payment.id])).rows[0].sum, '100.00');
});

test('ambiguous provider failure is retained and cannot be retried with any new key', async () => {
  provider('succeeded', true); const before = providerCalls; const payment = await cardPayment(await invoice()); const key = randomUUID();
  const body = { amount: '100.00', reason: 'Synthetic request', disposition: 'credit' };
  assert.equal((await api(`/${payment.id}/refund`, body, key)).status, 202);
  assert.equal((await api(`/${payment.id}/refund`, body, key)).status, 202);
  assert.equal((await api(`/${payment.id}/refund`, body)).status, 409);
  assert.equal(providerCalls - before, 1);
  assert.equal((await pool.query('SELECT state FROM payment_refund_operations WHERE payment_id=$1', [payment.id])).rows[0].state, 'unknown');
  assert.equal((await pool.query('SELECT refunded_amount FROM customer_payments WHERE id=$1', [payment.id])).rows[0].refunded_amount, '0.00');
  noProvider();
});

test('provider success followed by failed local ledger update recovers by webhook without another Stripe call', async () => {
  provider('succeeded'); const before = providerCalls; const payment = await cardPayment(await invoice()); const key = randomUUID();
  await pool.query(`CREATE FUNCTION test_refund_commit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.id = '${payment.id}'::uuid THEN RAISE EXCEPTION 'Synthetic ledger failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER test_refund_commit_failure BEFORE UPDATE OF refunded_amount ON customer_payments FOR EACH ROW EXECUTE FUNCTION test_refund_commit_failure();`);
  const body = { amount: '100.00', reason: 'Synthetic recovery request', disposition: 'credit' };
  try { assert.equal((await api(`/${payment.id}/refund`, body, key)).status, 202); }
  finally { await pool.query('DROP TRIGGER test_refund_commit_failure ON customer_payments; DROP FUNCTION test_refund_commit_failure();'); }
  const op = (await pool.query('SELECT * FROM payment_refund_operations WHERE payment_id=$1', [payment.id])).rows[0];
  assert.equal(op.state, 'unknown');
  assert.equal((await api(`/${payment.id}/refund`, body, key)).status, 202);
  assert.equal((await webhook(op, payment)).status, 200);
  assert.equal(providerCalls - before, 1);
  assert.equal((await pool.query('SELECT refunded_amount FROM customer_payments WHERE id=$1', [payment.id])).rows[0].refunded_amount, '100.00');
  noProvider();
});

test('refund tenant isolation, operation payload conflicts, and RLS prevent foreign disclosure', async () => {
  const payment = await cardPayment(await invoice()); const key = randomUUID();
  assert.equal((await api(`/${payment.id}/refund`, { amount: '100', reason: 'Synthetic' }, undefined, 'foreign')).status, 404);
  await reserve(payment.id, { amount: '50.00', reason: 'Synthetic', disposition: 'credit' }, key);
  await assert.rejects(reserve(payment.id, { amount: '51.00', reason: 'Synthetic', disposition: 'credit' }, key), { code: 'P0409' });
  await assert.rejects(reserve(payment.id, { amount: '50.00', reason: 'Synthetic', disposition: 'credit' }, randomUUID(), foreignOrg), { code: 'P0404' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('CREATE ROLE crewmodo_payment_isolation_test NOLOGIN');
    await client.query('GRANT USAGE ON SCHEMA public TO crewmodo_payment_isolation_test');
    await client.query('GRANT SELECT ON payment_refund_operations TO crewmodo_payment_isolation_test');
    await client.query('SET LOCAL ROLE crewmodo_payment_isolation_test');
    await client.query("SELECT set_config('app.current_org_id',$1,true)", [foreignOrg]);
    assert.equal((await client.query('SELECT count(*) FROM payment_refund_operations')).rows[0].count, '0');
  } finally { await client.query('ROLLBACK'); client.release(); }
});

test('provider-confirmed success settles directly, while confirmed failure releases only its reservation', async () => {
  const payment = await cardPayment(await invoice()); const key = randomUUID();
  const body = { amount: '25.10', reason: 'Synthetic credit', disposition: 'credit' };
  provider('failed'); const before = providerCalls;
  const failed = await api(`/${payment.id}/refund`, body, key);
  assert.equal(failed.status, 409, await failed.clone().text());
  assert.equal((await failed.json() as any).code, 'REFUND_NOT_COMPLETED');
  assert.equal((await api(`/${payment.id}/refund`, body, key)).status, 409);
  assert.equal(providerCalls - before, 1);
  assert.equal((await pool.query('SELECT refunded_amount FROM customer_payments WHERE id=$1', [payment.id])).rows[0].refunded_amount, '0.00');
  provider('succeeded');
  assert.equal((await api(`/${payment.id}/refund`, body)).status, 200);
  assert.equal(providerCalls - before, 2);
  assert.equal((await pool.query('SELECT refunded_amount FROM customer_payments WHERE id=$1', [payment.id])).rows[0].refunded_amount, '25.10');
  assert.equal((await pool.query("SELECT count(*) FROM payment_refund_operations WHERE payment_id=$1 AND state IN ('reserved','pending','unknown')", [payment.id])).rows[0].count, '0');
  noProvider();
});

test('mandatory raw webhook signature, account and mode verification fail closed', async () => {
  const payment = await cardPayment(await invoice());
  const op = (await reserve(payment.id, { amount: '100.00', reason: 'Synthetic credit', disposition: 'credit' })).rows[0].result.operation;
  const empty = new Request('http://localhost/webhook', { method: 'POST', body: '{}' });
  assert.equal((await billing.fetch(empty, env as never)).status, 400);
  const forged = new Request('http://localhost/webhook', { method: 'POST', headers: {
    'stripe-signature': `t=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}`,
  }, body: JSON.stringify({ type: 'refund.updated' }) });
  assert.equal((await billing.fetch(forged.clone(), env as never)).status, 400);
  assert.equal((await billing.fetch(forged.clone(), { ...env, STRIPE_CONNECT_WEBHOOK_SECRET: undefined } as never)).status, 503);
  assert.equal((await webhook(op, payment, 'succeeded', {}, { account: 'acct_wrong' })).status, 409);
  assert.equal((await webhook(op, payment, 'succeeded', {}, { livemode: true })).status, 400);
  assert.equal((await webhook(op, payment, 'succeeded', { amount: 9999 })).status, 409);
  assert.equal((await webhook(op, payment, 'future_unsupported_status', {}, { account: 'acct_wrong' })).status, 409);
  assert.equal((await pool.query('SELECT refunded_amount FROM customer_payments WHERE id=$1', [payment.id])).rows[0].refunded_amount, '0.00');
  assert.equal((await pool.query('SELECT state FROM payment_refund_operations WHERE id=$1', [op.id])).rows[0].state, 'reserved');
});

test('pre-migration keys cannot be reused to duplicate a historical manual payment', async () => {
  const id = await invoice('200.00'); const key = randomUUID();
  await pool.query("INSERT INTO customer_payments(org_id,lead_id,invoice_id,source,status,amount,metadata) VALUES ($1,$2,$3,'check','succeeded',50,$4)",
    [org, lead, id, { idempotencyKey: key, recordedByUserId: actor }]);
  assert.equal((await api('/manual', manual(id, '50.00', { confirmAdditionalPayment: true }), key)).status, 409);
  assert.equal((await pool.query('SELECT count(*) FROM customer_payments WHERE invoice_id=$1', [id])).rows[0].count, '1');
});

test('requires-action provider refund stays reserved as pending until a verified terminal outcome', async () => {
  provider('requires_action'); const payment = await cardPayment(await invoice()); const key = randomUUID(); const before = providerCalls;
  const body = { amount: '100.00', reason: 'Synthetic action required', disposition: 'credit' };
  assert.equal((await api(`/${payment.id}/refund`, body, key)).status, 202);
  const op = (await pool.query('SELECT * FROM payment_refund_operations WHERE payment_id=$1', [payment.id])).rows[0];
  assert.equal(op.state, 'pending');
  assert.equal((await webhook(op, payment, 'requires_action', {}, { account: 'acct_wrong' })).status, 409);
  assert.equal((await webhook(op, payment, 'requires_action')).status, 200);
  assert.equal((await api(`/${payment.id}/refund`, body)).status, 409);
  assert.equal(providerCalls - before, 1);
  assert.equal((await pool.query('SELECT refunded_amount FROM customer_payments WHERE id=$1', [payment.id])).rows[0].refunded_amount, '0.00');
  noProvider();
});

test('existing confirmManualRefund UI payload remains compatible without fabricating an actual return date', async () => {
  noProvider(); const payment = await pay(await invoice()); const key = randomUUID();
  const body = { amount: 100, reason: 'Returned check outside Stripe', method: 'check', reference: 'RETURN-84', confirmManualRefund: true };
  assert.equal((await api(`/${payment.id}/refund`, body, key)).status, 200);
  const operation = (await pool.query('SELECT * FROM payment_refund_operations WHERE payment_id=$1', [payment.id])).rows[0];
  assert.equal(operation.request.refundedAt, null);
  assert.equal(operation.settlement_evidence.manualReturnAcknowledged, true);
  assert.equal(operation.settlement_evidence.refundDateSource, 'recording_time');
  assert.equal((await api(`/${payment.id}/refund`, body, key)).status, 200);
  const stored = (await pool.query('SELECT metadata FROM customer_payments WHERE id=$1', [payment.id])).rows[0].metadata;
  assert.equal(stored.lastRefundDateSource, 'recording_time');
  assert.equal(stored.refundHistory[0].refundDateSource, 'recording_time');
  assert.equal((await pool.query('SELECT count(*) FROM payment_refund_operations WHERE payment_id=$1', [payment.id])).rows[0].count, '1');
});

function checkoutProvider(id: string, sessionId: string, status: string, extra = {}, afterRead?: () => Promise<void>) {
  let reads = 0;
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), `https://api.stripe.com/v1/checkout/sessions/${sessionId}`);
    assert.equal(options?.method || 'GET', 'GET', 'Manual collection never initiates or expires a Stripe charge');
    assert.equal(new Headers(options?.headers).get('Stripe-Account'), account);
    assert.equal(new Headers(options?.headers).get('Authorization'), `Bearer ${env.STRIPE_SECRET_KEY}`);
    assert.ok(options?.signal);
    reads++;
    if (afterRead) await afterRead();
    return Response.json({ id: sessionId, status, payment_status: 'unpaid', amount_total: 10000,
      currency: 'usd', livemode: false, metadata: { orgId: org, invoiceId: id }, ...extra });
  };
  return () => reads;
}
async function attachCheckout(id: string) {
  const sessionId = `cs_synthetic_${randomUUID().replaceAll('-', '')}`;
  await pool.query('UPDATE customer_invoices SET stripe_checkout_session_id=$1 WHERE id=$2', [sessionId, id]);
  return sessionId;
}

test('active checkout blocks manual collection even when a ledger row claims success', async () => {
  const id = await invoice('200.00'); const payment = await cardPayment(id); const sessionId = await attachCheckout(id);
  await pool.query('UPDATE customer_payments SET stripe_checkout_session_id=$1 WHERE id=$2', [sessionId, payment.id]);
  const reads = checkoutProvider(id, sessionId, 'open', { payment_intent: payment.stripe_payment_intent_id });
  assert.equal((await api('/manual', manual(id, '50.00', { confirmAdditionalPayment: true }))).status, 409);
  assert.equal(reads(), 1);
  assert.equal((await pool.query('SELECT count(*) FROM customer_payments WHERE invoice_id=$1', [id])).rows[0].count, '1');
  noProvider();
});

test('provider-confirmed expired checkout permits atomic manual payment and durable replay performs no provider request', async () => {
  const id = await invoice(); const sessionId = await attachCheckout(id); const key = randomUUID();
  const reads = checkoutProvider(id, sessionId, 'expired');
  const response = await api('/manual', manual(id), key);
  assert.equal(response.status, 201, await response.clone().text());
  const payment = (await response.json() as any).data;
  assert.equal(payment.metadata.checkoutVerification.id, sessionId);
  assert.equal(payment.metadata.checkoutVerification.status, 'expired');
  assert.equal(reads(), 1);
  assert.equal((await api('/manual', manual(id), key)).status, 200);
  assert.equal(reads(), 1, 'Replays return the committed result even if provider becomes unavailable');
  noProvider();
});

test('completed checkout cannot permit manual payment until the matching actual Stripe payment is reconciled', async () => {
  const id = await invoice('200.00'); const sessionId = await attachCheckout(id); const intent = `pi_${randomUUID()}`;
  checkoutProvider(id, sessionId, 'complete', { payment_status: 'paid', payment_intent: intent });
  assert.equal((await api('/manual', manual(id, '50.00', { confirmAdditionalPayment: true }))).status, 409);
  const payment = await cardPayment(id);
  await pool.query('UPDATE customer_payments SET stripe_checkout_session_id=$1,stripe_payment_intent_id=$2 WHERE id=$3', [sessionId, intent, payment.id]);
  assert.equal((await api('/manual', manual(id, '50.00', { confirmAdditionalPayment: true }))).status, 201);
  assert.equal((await pool.query('SELECT sum(amount) FROM customer_payments WHERE invoice_id=$1', [id])).rows[0].sum, '150.00');
  noProvider();
});

test('checkout identity, mode, processing and changed-session races fail closed', async () => {
  const id = await invoice(); const sessionId = await attachCheckout(id);
  for (const extra of [{ livemode: true }, { metadata: { orgId: foreignOrg, invoiceId: id } }, { currency: 'eur' }, { payment_status: 'unpaid' }]) {
    const reads = checkoutProvider(id, sessionId, 'complete', extra);
    assert.equal((await api('/manual', manual(id))).status, 409);
    assert.equal(reads(), 1, 'Identity failures are exercised against a provider response');
  }
  checkoutProvider(id, sessionId, 'expired', {}, async () => {
    await pool.query('UPDATE customer_invoices SET stripe_checkout_session_id=$1 WHERE id=$2', ['cs_changed_during_read', id]);
  });
  assert.equal((await api('/manual', manual(id))).status, 409);
  assert.equal((await pool.query('SELECT count(*) FROM customer_payments WHERE invoice_id=$1', [id])).rows[0].count, '0');
  noProvider();
});

test('legacy metadata-only unresolved refunds and missing dispositions fail closed without historical edits', async () => {
  noProvider();
  for (const metadata of [
    { lastRefundStatus: 'pending', refundHistory: [] },
    { refundHistory: [{ status: 'succeeded', amount: 25 }] },
    { refundHistory: [{ amount: 25, reason: 'Historical outcome unknown' }] },
  ]) {
    const id = await invoice(); const payment = await pay(id, '50.00');
    await pool.query('UPDATE customer_payments SET metadata=$1 WHERE id=$2', [metadata, payment.id]);
    assert.equal((await balance(id)).needsReview, true);
    assert.equal((await api('/manual', manual(id, '25.00', { confirmAdditionalPayment: true }))).status, 409);
    assert.equal((await api(`/${payment.id}/refund`, refund('25.00'))).status, 409);
    const stored = (await pool.query('SELECT metadata,refunded_amount FROM customer_payments WHERE id=$1', [payment.id])).rows[0];
    assert.deepEqual(stored.metadata, metadata);
    assert.equal(stored.refunded_amount, '0.00');
  }
});

test('manual payment receipt reports not requested or missing-email failure without implying a queue', async () => {
  noProvider();
  const withoutReceipt = await api('/manual', manual(await invoice()));
  assert.equal(withoutReceipt.status, 201);
  assert.equal((await withoutReceipt.json() as any).receiptStatus, 'not_requested');
  const id = await invoice(); const key = randomUUID(); const body = manual(id, '100.00', { sendReceipt: true });
  const missingEmail = await api('/manual', body, key);
  assert.equal(missingEmail.status, 201, 'The money operation remains successful when no receipt can be sent');
  assert.equal((await missingEmail.json() as any).receiptStatus, 'failed');
  const replay = await api('/manual', body, key);
  assert.equal(replay.status, 200);
  assert.equal((await replay.json() as any).receiptStatus, 'not_retried');
  assert.equal((await pool.query('SELECT count(*) FROM customer_payments WHERE invoice_id=$1', [id])).rows[0].count, '1');
});

test('manual payment receipt is sent only after provider acceptance and replay never sends again', async () => {
  const id = await invoice(); const customer = randomUUID(); const key = randomUUID();
  await pool.query('INSERT INTO leads(id,org_id,name,email) VALUES ($1,$2,$3,$4)', [customer, org, 'Receipt customer', 'receipt@example.invalid']);
  await pool.query('UPDATE customer_invoices SET lead_id=$1 WHERE id=$2', [customer, id]);
  let sends = 0;
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), 'https://api.resend.com/emails');
    assert.equal(options?.method, 'POST');
    assert.equal(new Headers(options?.headers).get('Authorization'), `Bearer ${env.RESEND_API_KEY}`);
    const message = JSON.parse(String(options?.body));
    assert.deepEqual(message.to, ['receipt@example.invalid']);
    assert.match(message.html, /\/portal\//);
    sends++;
    return Response.json({ id: 'synthetic_receipt_accepted' });
  };
  try {
    const body = manual(id, '100.00', { sendReceipt: true });
    const original = await api('/manual', body, key);
    assert.equal(original.status, 201, await original.clone().text());
    assert.equal((await original.json() as any).receiptStatus, 'sent');
    assert.equal(sends, 1);
    const replay = await api('/manual', body, key);
    assert.equal(replay.status, 200);
    assert.equal((await replay.json() as any).receiptStatus, 'not_retried');
    assert.equal(sends, 1);
    assert.equal((await pool.query('SELECT count(*) FROM customer_payments WHERE invoice_id=$1', [id])).rows[0].count, '1');
  } finally { noProvider(); }
});

test('receipt provider rejection or ambiguous transport failure preserves the payment and reports failed', async () => {
  for (const rejection of [true, false]) {
    const id = await invoice(); const customer = randomUUID(); const key = randomUUID();
    await pool.query('INSERT INTO leads(id,org_id,name,email) VALUES ($1,$2,$3,$4)', [customer, org, 'Receipt customer', 'receipt@example.invalid']);
    await pool.query('UPDATE customer_invoices SET lead_id=$1 WHERE id=$2', [customer, id]);
    let sends = 0;
    globalThis.fetch = async (url) => {
      assert.equal(String(url), 'https://api.resend.com/emails');
      sends++;
      if (rejection) return Response.json({ error: 'Synthetic rejection' }, { status: 503 });
      throw new Error('Synthetic connection lost; delivery outcome unknown');
    };
    try {
      const body = manual(id, '100.00', { sendReceipt: true });
      const original = await api('/manual', body, key);
      assert.equal(original.status, 201, await original.clone().text());
      assert.equal((await original.json() as any).receiptStatus, 'failed');
      assert.equal(sends, 1);
      const replay = await api('/manual', body, key);
      assert.equal(replay.status, 200);
      assert.equal((await replay.json() as any).receiptStatus, 'not_retried');
      assert.equal(sends, 1, 'An ambiguous receipt outcome never causes automatic duplicate sends');
      assert.equal((await pool.query('SELECT count(*) FROM customer_payments WHERE invoice_id=$1', [id])).rows[0].count, '1');
      assert.equal((await pool.query('SELECT status FROM customer_invoices WHERE id=$1', [id])).rows[0].status, 'paid');
    } finally { noProvider(); }
  }
});
