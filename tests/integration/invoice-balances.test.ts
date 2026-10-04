import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import invoices from '../../apps/api/src/routes/invoices';
import leads from '../../apps/api/src/routes/leads';
import { reconcileRepaint } from '../../scripts/reconcile-repaint.mjs';
import { bridgeNeonToPostgres, disposableDatabase, migrateDisposableDatabase } from './local-db';

const pool = disposableDatabase();
const restore = bridgeNeonToPostgres(pool);
const org = randomUUID();
const otherOrg = randomUUID();
const actor = randomUUID();
let customer: string;
let invoice: string;
const env = { DATABASE_URL: 'postgresql://synthetic:synthetic@localhost/crewmodo_api_test', KV: {
  get: async (key: string) => key === 'session:owner' ? JSON.stringify({ userId: actor, orgId: org, email: 'synthetic@example.invalid', expiresAt: Date.now() + 3600000 }) : null,
  delete: async () => undefined,
} };
function get(app: typeof invoices, path: string) {
  return app.fetch(new Request(`http://localhost${path}`, { headers: { Authorization: 'Bearer owner' } }), env as never);
}

before(async () => {
  await migrateDisposableDatabase(pool);
  await pool.query('INSERT INTO organizations (id,name,slug) VALUES ($1,$2,$2),($3,$4,$4)', [org, `balance-${org}`, otherOrg, `foreign-${otherOrg}`]);
  await pool.query('INSERT INTO users (id,email) VALUES ($1,$2)', [actor, `${actor}@example.invalid`]);
  await pool.query("INSERT INTO memberships (org_id,user_id,role) VALUES ($1,$2,'owner')", [org, actor]);
  customer = (await pool.query("INSERT INTO leads (org_id,name) VALUES ($1,'Synthetic client') RETURNING id", [org])).rows[0].id;
  invoice = (await pool.query("INSERT INTO customer_invoices (org_id,lead_id,invoice_number,description,line_items,subtotal,tax,total,status) VALUES ($1,$2,'SYNTHETIC','Fixture','[]',100,0,100,'sent') RETURNING id", [org, customer])).rows[0].id;
  const payment = (await pool.query(`SELECT record_manual_payment($1,$2,$3,$4::jsonb,null) as result`, [org, actor, randomUUID(), JSON.stringify({ invoiceId: invoice, amount: '50.00', source: 'check', sendReceipt: false })])).rows[0].result.payment;
  await pool.query(`SELECT reserve_payment_refund($1,$2,$3,$4,$5::jsonb,null,null)`, [org, actor, randomUUID(), payment.id,
    JSON.stringify({ amount: '25.00', reason: 'Synthetic partial credit', disposition: 'credit', method: 'check', reference: 'synthetic', confirmManualRefund: true })]);
});
after(async () => { restore(); await pool.end(); });

test('invoice list, invoice detail and customer detail expose the same credited balance', async () => {
  for (const [app, path, select] of [
    [invoices, '/customer', (body: any) => body.data[0]],
    [invoices, `/customer/${invoice}`, (body: any) => body.data],
    [leads, `/${customer}`, (body: any) => body.data.invoices[0]],
  ] as const) {
    const response = await get(app, path);
    assert.equal(response.status, 200, await response.clone().text());
    const balance = select(await response.json()).balance;
    assert.equal(Number(balance.remaining), 50);
    assert.equal(Number(balance.netCollected), 25);
    assert.equal(Number(balance.credits), 25);
    assert.equal(balance.needsReview, false);
  }
});

test('read-only reconciliation preserves data and signed history fingerprint across repeated runs', async () => {
  const client = await pool.connect();
  try {
    const first = await reconcileRepaint(client, org);
    const second = await reconcileRepaint(client, org);
    assert.deepEqual(first, second);
    assert.equal(first.readOnly, true);
    assert.equal(first.money.receipts_gross, '50.00');
    assert.equal(first.money.refunds_recorded, '25.00');
    assert.equal(first.counts.duplicate_checkout_sessions, '0');
  } finally { client.release(); }
});
