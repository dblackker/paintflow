import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import estimates from '../../apps/api/src/routes/estimates';
import portal from '../../apps/api/src/routes/portal';
import { bridgeNeonToPostgres, disposableDatabase, migrateDisposableDatabase } from './local-db';
import { deliverAcceptedEstimate } from '../../apps/api/src/lib/accepted-estimate-delivery';

const pool = disposableDatabase();
const restore = bridgeNeonToPostgres(pool);
const org = randomUUID();
const foreign = randomUUID();
const lead = randomUUID();
const actor = randomUUID();
const env = { DATABASE_URL: 'postgresql://synthetic:synthetic@localhost:5432/crewmodo_api_test', ENVIRONMENT: 'test', PUBLIC_URL: 'https://example.invalid' };
const originalFetch = globalThis.fetch;
let estimateId: string;
before(async () => {
  await migrateDisposableDatabase(pool);
  await pool.query('INSERT INTO organizations (id,name,slug) VALUES ($1,$2,$2),($3,$4,$4)', [org, `accept-${org}`, foreign, `foreign-${foreign}`]);
  await pool.query('INSERT INTO users (id,email) VALUES ($1,$2)', [actor, `${actor}@example.invalid`]);
  await pool.query("INSERT INTO leads (id,org_id,name,email,street_address) VALUES ($1,$2,'Synthetic customer','client@example.invalid','123 Synthetic St')", [lead, org]);
  await pool.query("INSERT INTO org_settings (org_id,deposit_percent,business_hours) VALUES ($1,50,'{}')", [org]);
  globalThis.fetch = async () => { throw new Error('A test attempted external provider access'); };
});
after(async () => { restore(); globalThis.fetch = originalFetch; await pool.end(); });

async function sentEstimate() {
  const id = randomUUID();
  const pkg = { name: 'proposal', total: 109.2, subtotal: 100, tax: 9.2, calculationVersion: 'repaint-v2', calculationInput: { taxRate: { kind: 'fraction', value: '0.092' } },
    items: [{ desc: 'Bedroom: Walls', qty: 1, rate: 100, labor: { hours: 2, coats: 2, burdenedRate: 30 }, material: { name: 'Finish', costPerUnit: 50 } }] };
  const record = (await pool.query("INSERT INTO estimates (id,org_id,lead_id,status,total,packages,street_address) VALUES ($1,$2,$3,'sent',109.2,$4,'123 Jobsite St') RETURNING updated_at", [id, org, lead, JSON.stringify([pkg])])).rows[0];
  await pool.query("INSERT INTO audit_logs (org_id,action,entity_type,entity_id,metadata) VALUES ($1,'estimate.email.sent','estimate',$2,$3)", [org, id, JSON.stringify({ contractorSignature: { name: 'Synthetic owner', signedAt: new Date().toISOString(), companyName: 'Synthetic org' } })]);
  return { id, updatedAt: record.updated_at.toISOString() };
}
async function sign(id: string, updatedAt: string, key: string, reviewedTermsVersion?: string, selectedOptions: unknown[] = []) {
  const preview = await estimates.fetch(new Request(`http://localhost/${id}/public`), env as never);
  const termsVersion = reviewedTermsVersion || (await preview.json() as any).data.termsVersion;
  return estimates.fetch(new Request(`http://localhost/${id}/sign`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify({ expectedUpdatedAt: updatedAt, expectedTermsVersion: termsVersion, selectedOptions, name: 'Synthetic signer', signatureData: 'data:image/png;base64,' + 'A'.repeat(200), packageName: 'proposal' }) }), env as never);
}

test('concurrent approval creates one signature, job, immutable budget, invoice and durable email', async () => {
  const draft = await sentEstimate(); estimateId = draft.id;
  const version = (await pool.query("SELECT date_trunc('milliseconds',updated_at)=$2::timestamp as matches,updated_at::text as stored,$2::timestamp::text as expected FROM estimates WHERE id=$1", [draft.id, draft.updatedAt])).rows[0];
  assert.equal(version.matches, true, JSON.stringify(version));
  const key = randomUUID();
  const responses = await Promise.all(Array.from({ length: 5 }, () => sign(draft.id, draft.updatedAt, key)));
  const results = [];
  for (const response of responses) { assert.equal(response.status, 200, await response.clone().text()); results.push((await response.json() as any).data); }
  assert.equal(new Set(results.map((row) => row.jobId)).size, 1);
  const jobs = await pool.query('SELECT * FROM jobs WHERE estimate_id=$1 AND org_id=$2', [draft.id, org]);
  assert.equal(jobs.rowCount, 1); assert.equal(jobs.rows[0].status, 'deposit_pending');
  assert.equal(jobs.rows[0].estimation_budget.contractTotalMinor, 10920);
  assert.equal((await pool.query('SELECT * FROM customer_invoices WHERE estimate_id=$1 AND org_id=$2', [draft.id, org])).rowCount, 1);
  assert.equal((await pool.query('SELECT * FROM accepted_estimate_deliveries WHERE estimate_id=$1 AND org_id=$2', [draft.id, org])).rowCount, 1);
  assert.equal((await pool.query("SELECT * FROM audit_logs WHERE entity_id=$1 AND action='estimate.signed'", [draft.id])).rowCount, 1);
  await assert.rejects(pool.query("UPDATE jobs SET estimation_budget='{}' WHERE id=$1", [jobs.rows[0].id]), /immutable/);
});

test('stale public approval is rejected without financial side effects', async () => {
  const draft = await sentEstimate();
  await pool.query("UPDATE estimates SET updated_at=updated_at+interval '1 second' WHERE id=$1", [draft.id]);
  const response = await sign(draft.id, draft.updatedAt, randomUUID());
  assert.equal(response.status, 409, await response.clone().text());
  assert.equal((await pool.query('SELECT * FROM jobs WHERE estimate_id=$1', [draft.id])).rowCount, 0);
});

test('a terms change cannot bypass the reviewed proposal version on old sent proposals', async () => {
  const draft = await sentEstimate();
  const publicResponse = await estimates.fetch(new Request(`http://localhost/${draft.id}/public`), env as never);
  const termsVersion = (await publicResponse.json() as any).data.termsVersion;
  await pool.query("UPDATE org_settings SET payment_terms='Changed payment timing' WHERE org_id=$1", [org]);
  const response = await sign(draft.id, draft.updatedAt, randomUUID(), termsVersion);
  assert.equal(response.status, 409, await response.clone().text());
  assert.equal((await response.json() as any).code, 'ESTIMATE_TERMS_CONFLICT');
  assert.equal((await pool.query('SELECT * FROM jobs WHERE estimate_id=$1', [draft.id])).rowCount, 0);
  await pool.query('UPDATE org_settings SET payment_terms=NULL WHERE org_id=$1', [org]);
});

test('frozen sent terms survive settings changes and reset only after unsigned scope revision', async () => {
  const draft = await sentEstimate();
  const publicResponse = await estimates.fetch(new Request(`http://localhost/${draft.id}/public`), env as never);
  const before = (await publicResponse.json() as any).data;
  await pool.query('UPDATE estimates SET proposal_terms_snapshot=$2 WHERE id=$1', [draft.id, JSON.stringify({ legal: before.legal, paymentTerms: before.paymentTerms, paymentSchedule: before.paymentSchedule })]);
  const frozenResponse = await estimates.fetch(new Request(`http://localhost/${draft.id}/public`), env as never);
  const frozen = (await frozenResponse.json() as any).data;
  await pool.query("UPDATE org_settings SET deposit_percent=75,payment_terms='New terms for new proposals' WHERE org_id=$1", [org]);
  const after = (await (await estimates.fetch(new Request(`http://localhost/${draft.id}/public`), env as never)).json() as any).data;
  assert.equal(after.termsVersion, frozen.termsVersion);
  assert.equal(after.paymentSchedule[0].percent, before.paymentSchedule[0].percent);
  assert.equal((await sign(draft.id, draft.updatedAt, randomUUID(), frozen.termsVersion)).status, 200);
  const edited = await sentEstimate();
  await pool.query('UPDATE estimates SET proposal_terms_snapshot=$2 WHERE id=$1', [edited.id, JSON.stringify({ legal: before.legal, paymentTerms: before.paymentTerms, paymentSchedule: before.paymentSchedule })]);
  await pool.query("UPDATE estimates SET street_address='Changed jobsite',updated_at=now() WHERE id=$1", [edited.id]);
  assert.equal((await pool.query('SELECT proposal_terms_snapshot FROM estimates WHERE id=$1', [edited.id])).rows[0].proposal_terms_snapshot, null);
  await pool.query('UPDATE org_settings SET deposit_percent=50,payment_terms=NULL WHERE org_id=$1', [org]);
});

test('transaction failure rolls back signature and job instead of leaving a half-accepted proposal', async () => {
  const draft = await sentEstimate();
  const payload = { signedName: 'Signer', signatureData: 'synthetic', contractValue: '100.00', jobNumber: 'JOB-FAIL', jobName: 'x'.repeat(256), budget: {}, portalToken: randomUUID(), portalUrl: 'https://example.invalid', audit: {}, acceptance: {} };
  await assert.rejects(pool.query('SELECT accept_estimate_budget($1,$2,$3,$4,$5,$6)', [org, draft.id, randomUUID(), draft.updatedAt, '{}', JSON.stringify(payload)]), /too long/);
  assert.equal((await pool.query('SELECT status FROM estimates WHERE id=$1', [draft.id])).rows[0].status, 'sent');
  assert.equal((await pool.query('SELECT * FROM jobs WHERE estimate_id=$1', [draft.id])).rowCount, 0);
  await assert.rejects(pool.query('SELECT accept_estimate_budget($1,$2,$3,$4,$5,$6)', [foreign, draft.id, randomUUID(), draft.updatedAt, '{}', JSON.stringify(payload)]), /not found/);
});

test('atomic acceptance rejects changed scope and jobsite even when the timestamp is unchanged', async () => {
  for (const kind of ['scope', 'jobsite']) {
    const draft = await sentEstimate();
    const source = (await pool.query('SELECT * FROM estimates WHERE id=$1', [draft.id])).rows[0];
    const payload = { reviewedPackages: source.packages,
      reviewedJobsite: { leadId: source.lead_id, streetAddress: source.street_address, city: source.city, state: source.state, postalCode: source.postal_code } };
    if (kind === 'scope') await pool.query("UPDATE estimates SET packages=jsonb_set(packages,'{0,total}','110') WHERE id=$1", [draft.id]);
    else await pool.query("UPDATE estimates SET street_address='Different project site' WHERE id=$1", [draft.id]);
    await assert.rejects(pool.query('SELECT accept_estimate_budget($1,$2,$3,$4,$5,$6)',
      [org, draft.id, randomUUID(), draft.updatedAt, '{}', JSON.stringify(payload)]), /reviewed proposal scope changed|reviewed jobsite changed/);
    assert.equal((await pool.query('SELECT status FROM estimates WHERE id=$1', [draft.id])).rows[0].status, 'sent');
    assert.equal((await pool.query('SELECT * FROM jobs WHERE estimate_id=$1', [draft.id])).rowCount, 0);
  }
});

test('public proposal redacts costs and uses the frozen legal/payment assumptions', async () => {
  await pool.query("UPDATE org_settings SET deposit_percent=10,business_hours=$2 WHERE org_id=$1", [org, JSON.stringify({ legal: { contractTerms: 'Changed after acceptance' } })]);
  const response = await estimates.fetch(new Request(`http://localhost/${estimateId}/public`), env as never);
  assert.equal(response.status, 200, await response.clone().text());
  const data = (await response.json() as any).data;
  assert.equal(data.packages[0].calculationInput, undefined);
  assert.equal(data.packages[0].items[0].material.costPerUnit, undefined);
  assert.equal(data.packages[0].items[0].labor.burdenedRate, undefined);
  assert.equal(data.paymentSchedule[0].percent, 50);
  assert.notEqual(data.legal.contractTerms, 'Changed after acceptance');
});

test('signed public copy and portal include only the uniquely selected option and its tax', async () => {
  await pool.query('UPDATE org_settings SET deposit_percent=50 WHERE org_id=$1', [org]);
  const draft = await sentEstimate();
  const stored = (await pool.query('SELECT packages FROM estimates WHERE id=$1', [draft.id])).rows[0].packages;
  stored[0].items.push({ desc: 'Trim', qty: 1, rate: 10, optional: true, calculationItemId: 'trim-a' },
    { desc: 'Trim', qty: 1, rate: 20, optional: true, calculationItemId: 'trim-b' });
  await pool.query('UPDATE estimates SET packages=$2 WHERE id=$1', [draft.id, JSON.stringify(stored)]);
  const response = await sign(draft.id, draft.updatedAt, randomUUID(), undefined, [{ desc: 'Trim', qty: 1, rate: 20, calculationItemId: 'trim-b', optionIndex: 1 }]);
  assert.equal(response.status, 200, await response.clone().text());
  const approval = (await response.json() as any).data;
  const publicCopy = (await (await estimates.fetch(new Request(`http://localhost/${draft.id}/public`), env as never)).json() as any).data;
  assert.equal(publicCopy.total, '131.04');
  assert.equal(publicCopy.packages[0].total, 131.04);
  assert.equal(publicCopy.packages[0].tax, 11.04);
  assert.deepEqual(publicCopy.packages[0].items.map((item: any) => item.calculationItemId).filter(Boolean), ['trim-b']);
  assert.ok(publicCopy.packages[0].items.every((item: any) => item.optional === false));
  const token = (await pool.query('SELECT token FROM portal_tokens WHERE org_id=$1 AND lead_id=$2 ORDER BY created_at DESC LIMIT 1', [org, lead])).rows[0].token;
  const portalCopy = (await (await portal.fetch(new Request(`http://localhost/${token}`), env as never)).json() as any).data;
  assert.equal(portalCopy.estimate.id, draft.id);
  assert.equal(portalCopy.estimate.total, '131.04');
  assert.equal(portalCopy.estimate.packages[0].items.length, 2);
  assert.equal((await pool.query('SELECT total FROM customer_invoices WHERE id=$1', [approval.depositInvoiceId])).rows[0].total, '65.52');
});

test('email retry uses a stable provider idempotency key and does not redeliver sent messages', async () => {
  const delivery = (await pool.query('SELECT id FROM accepted_estimate_deliveries WHERE estimate_id=$1', [estimateId])).rows[0].id;
  let sends = 0;
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), 'https://api.resend.com/emails');
    assert.equal(new Headers(options?.headers).get('Idempotency-Key'), `accepted-estimate/${delivery}`);
    sends++; return Response.json({ id: `synthetic_${delivery}` });
  };
  const emailEnv = { ...env, EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'synthetic_never_live' };
  await Promise.all([deliverAcceptedEstimate(emailEnv as never, org, delivery), deliverAcceptedEstimate(emailEnv as never, org, delivery)]);
  await deliverAcceptedEstimate(emailEnv as never, org, delivery);
  assert.equal(sends, 1);
  assert.equal((await pool.query('SELECT status FROM accepted_estimate_deliveries WHERE id=$1', [delivery])).rows[0].status, 'sent');
});

test('customer portal never returns internal job budgets or proposal acquisition prices', async () => {
  const token = (await pool.query('SELECT token FROM portal_tokens WHERE org_id=$1 AND lead_id=$2 ORDER BY created_at DESC LIMIT 1', [org, lead])).rows[0].token;
  const response = await portal.fetch(new Request(`http://localhost/${token}`), env as never);
  assert.equal(response.status, 200, await response.clone().text());
  const data = (await response.json() as any).data;
  assert.equal(data.job.estimationBudget, undefined);
  assert.equal(data.estimate.packages[0].calculationInput, undefined);
  assert.equal(data.estimate.packages[0].items[0].material.costPerUnit, undefined);
  assert.equal(data.estimate.packages[0].items[0].labor.burdenedRate, undefined);
  assert.equal(data.customer.notes, undefined);
  assert.equal(data.job.streetAddress, '123 Jobsite St');
});

test('delivery records enforce child tenancy and RLS for an unprivileged account', async () => {
  const row = (await pool.query('SELECT invoice_id FROM accepted_estimate_deliveries WHERE org_id=$1 AND estimate_id=$2', [org, estimateId])).rows[0];
  await assert.rejects(pool.query('INSERT INTO accepted_estimate_deliveries (org_id,estimate_id,invoice_id,portal_url) VALUES ($1,$2,$3,$4)', [foreign, estimateId, row.invoice_id, 'https://example.invalid']), /foreign key/);
  const client = await pool.connect();
  const role = 'accept_rls_' + randomUUID().replace(/-/g, '');
  try {
    await client.query('BEGIN');
    await client.query(`CREATE ROLE ${role} NOLOGIN`);
    await client.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
    await client.query(`GRANT SELECT ON accepted_estimate_deliveries TO ${role}`);
    await client.query(`SET LOCAL ROLE ${role}`);
    await client.query("SELECT set_config('app.current_org_id',$1,true)", [org]);
    assert.equal((await client.query('SELECT * FROM accepted_estimate_deliveries WHERE estimate_id=$1', [estimateId])).rowCount, 1);
    await client.query("SELECT set_config('app.current_org_id',$1,true)", [foreign]);
    assert.equal((await client.query('SELECT * FROM accepted_estimate_deliveries WHERE estimate_id=$1', [estimateId])).rowCount, 0);
  } finally { await client.query('ROLLBACK'); client.release(); }
});
