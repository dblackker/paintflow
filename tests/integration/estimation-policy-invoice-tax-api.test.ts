import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import settings from '../../apps/api/src/routes/settings';
import invoices from '../../apps/api/src/routes/invoices';
import { bridgeNeonToPostgres, disposableDatabase, migrateDisposableDatabase } from './local-db';

const pool = disposableDatabase();
const restore = bridgeNeonToPostgres(pool);
const kv = new Map<string, string>();
const env = {
  DATABASE_URL: 'postgresql://synthetic:synthetic@localhost/crewmodo_taxfix_test',
  ENVIRONMENT: 'test',
  KV: { get: async (key: string) => kv.get(key) || null },
};
const originalFetch = globalThis.fetch;
before(async () => {
  await migrateDisposableDatabase(pool);
  globalThis.fetch = async () => {
    throw new Error('Unexpected external provider call in tax tests.');
  };
});
after(async () => {
  restore();
  globalThis.fetch = originalFetch;
  await pool.end();
});

async function fixture() {
  const orgId = randomUUID(),
    actorId = randomUUID(),
    crewId = randomUUID();
  await pool.query('insert into organizations(id,name,slug) values($1,$2,$2)', [orgId, `tax-${orgId}`]);
  await pool.query('insert into users(id,email) values($1,$2),($3,$4)', [
    actorId,
    `${actorId}@example.invalid`,
    crewId,
    `${crewId}@example.invalid`,
  ]);
  await pool.query("insert into memberships(org_id,user_id,role) values($1,$2,'owner'),($1,$3,'member')", [
    orgId,
    actorId,
    crewId,
  ]);
  for (const userId of [actorId, crewId])
    kv.set(
      `session:${userId}`,
      JSON.stringify({ orgId, userId, email: 'synthetic@example.invalid', expiresAt: Date.now() + 3600000 }),
    );
  const leadId = (
    await pool.query(
      "insert into leads(org_id,name,postal_code) values($1,'Synthetic client','90210') returning id",
      [orgId],
    )
  ).rows[0].id;
  const estimateId = (
    await pool.query(
      "insert into estimates(org_id,lead_id,status,total,packages) values($1,$2,'accepted',100,'[]') returning id",
      [orgId, leadId],
    )
  ).rows[0].id;
  const jobId = (
    await pool.query(
      "insert into jobs(org_id,lead_id,estimate_id,name,postal_code) values($1,$2,$3,'Synthetic job','98101') returning id",
      [orgId, leadId, estimateId],
    )
  ).rows[0].id;
  return { orgId, actorId, crewId, leadId, estimateId, jobId };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function call(
  app: typeof settings,
  f: Fixture,
  path: string,
  body?: unknown,
  method = 'GET',
  actor = f.actorId,
) {
  return app.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${actor}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': randomUUID(),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    env as never,
  );
}
async function data(response: Response, status = 200): Promise<any> {
  assert.equal(response.status, status, await response.clone().text());
  return ((await response.json()) as any).data;
}
function policy(expectedUpdatedAt: string | null, ratePercent = '7.25') {
  return {
    expectedUpdatedAt,
    rules: [
      { postalCode: '98101', label: 'Reviewed jobsite', ratePercent },
      { postalCode: '90210', label: 'Reviewed billing district', ratePercent: '9.5' },
    ],
    defaultBurdenedRate: '32.50',
    priceStaleDays: 90,
  };
}
async function savePolicy(f: Fixture, rate = '7.25') {
  const current = await data(await call(settings, f, '/estimation-policy'));
  return data(await call(settings, f, '/estimation-policy', policy(current.updatedAt, rate), 'PUT'));
}
async function createInvoice(f: Fixture, patch = {}) {
  return call(
    invoices,
    f,
    '/customer',
    { leadId: f.leadId, jobId: f.jobId, description: 'Synthetic repaint', amount: '100', ...patch },
    'POST',
  );
}

test('policy initialization and concurrent revision writes are guarded; unrelated org settings survive', async () => {
  const f = await fixture();
  const empty = await data(await call(settings, f, '/estimation-policy'));
  assert.equal(empty.updatedAt, null);
  const initial = await savePolicy(f);
  assert.equal(initial.defaultBurdenedRate, '32.50');
  assert.ok(initial.updatedAt);
  assert.equal((await call(settings, f, '/estimation-policy', policy(null), 'PUT')).status, 409);
  await pool.query(
    'update org_settings set company_name=\'Keep this company\',business_hours=business_hours || \'{"unrelated":{"preserved":true}}\'::jsonb where org_id=$1',
    [f.orgId],
  );
  const responses = await Promise.all(
    ['8.25', '9.25'].map((rate) =>
      call(settings, f, '/estimation-policy', policy(initial.updatedAt, rate), 'PUT'),
    ),
  );
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  const current = await data(await call(settings, f, '/estimation-policy'));
  assert.notEqual(current.updatedAt, initial.updatedAt);
  const stored = (
    await pool.query('select company_name,business_hours from org_settings where org_id=$1', [f.orgId])
  ).rows[0];
  assert.equal(stored.company_name, 'Keep this company');
  assert.deepEqual(stored.business_hours.unrelated, { preserved: true });
  await data(await call(settings, f, '/org', { companyName: 'Other form edit' }, 'PATCH'));
  assert.equal((await call(settings, f, '/estimation-policy', policy(current.updatedAt), 'PUT')).status, 409);
  assert.equal(
    (
      await pool.query(
        "select count(*) from audit_logs where org_id=$1 and action='estimation.policy.updated'",
        [f.orgId],
      )
    ).rows[0].count,
    '2',
  );
});

test('unsupported numeric precision, missing revisions and crew writes leave policy unchanged', async () => {
  const f = await fixture();
  const initial = await savePolicy(f);
  for (const body of [
    { ...policy(initial.updatedAt), defaultBurdenedRate: '1.005' },
    policy(initial.updatedAt, '9.12345'),
    { ...policy(initial.updatedAt), expectedUpdatedAt: undefined },
    { ...policy(initial.updatedAt), defaultBurdenedRate: '1000.01' },
  ]) {
    assert.equal((await call(settings, f, '/estimation-policy', body, 'PUT')).status, 400);
  }
  assert.equal(
    (await call(settings, f, '/estimation-policy', policy(initial.updatedAt), 'PUT', f.crewId)).status,
    403,
  );
  assert.deepEqual(await data(await call(settings, f, '/estimation-policy')), initial);
});

test('automatic invoice resolves the current jobsite policy and persists its exact fraction', async () => {
  const f = await fixture();
  await savePolicy(f, '7.25');
  await savePolicy(f, '10.3525');
  const invoice = await data(await createInvoice(f, { amount: '100000', tax: 1 }), 201);
  assert.equal(invoice.tax, '10352.50');
  assert.equal(invoice.total, '110352.50');
  assert.equal(invoice.taxRate, '0.10352500');
  const audit = (
    await pool.query("select metadata from audit_logs where entity_id=$1 and action='invoice.created'", [
      invoice.id,
    ])
  ).rows[0].metadata;
  assert.equal(audit.taxSnapshot.source, 'jobsite_rule');
  assert.equal(audit.taxSnapshot.postalCode, '98101');
  assert.equal(audit.taxSnapshot.actorId, f.actorId);
  assert.equal(audit.taxSnapshot.overrideReason, null);
  const column = (
    await pool.query(
      "select numeric_precision,numeric_scale from information_schema.columns where table_name='customer_invoices' and column_name='tax_rate'",
    )
  ).rows[0];
  assert.deepEqual(column, { numeric_precision: 11, numeric_scale: 8 });
  await pool.query('update jobs set postal_code=null where id=$1', [f.jobId]);
  await pool.query('update org_settings set sales_tax_rate=0.04 where org_id=$1', [f.orgId]);
  const noJobZip = await data(await createInvoice(f), 201);
  assert.equal(noJobZip.tax, '4.00');
  const noJob = await data(await createInvoice(f, { jobId: null }), 201);
  assert.equal(noJob.tax, '9.50');
});

test('rate and amount overrides require explicit reasons and record authenticated provenance', async () => {
  const f = await fixture();
  await savePolicy(f);
  for (const patch of [
    { taxRate: '7.25' },
    { taxRate: '9.12345', taxOverrideReason: 'Reviewed' },
    { taxOverride: true, tax: 0 },
    { taxOverride: true, tax: '1.005', taxOverrideReason: 'Reviewed' },
    { taxRate: '7.25', taxOverride: true, tax: 2, taxOverrideReason: 'Reviewed' },
  ]) {
    assert.equal((await createInvoice(f, patch)).status, 400);
  }
  assert.equal(
    (await pool.query('select count(*) from customer_invoices where org_id=$1', [f.orgId])).rows[0].count,
    '0',
  );
  const rate = await data(
    await createInvoice(f, { taxRate: '10.3525', taxOverrideReason: 'Reviewed district exception' }),
    201,
  );
  assert.equal(rate.tax, '10.35');
  assert.equal(rate.taxRate, '0.10352500');
  const amount = await data(
    await createInvoice(f, {
      taxOverride: true,
      tax: '2.25',
      taxOverrideReason: 'Reviewed accounting correction',
    }),
    201,
  );
  assert.equal(amount.tax, '2.25');
  assert.equal(amount.total, '102.25');
  assert.equal(amount.taxRate, null);
  for (const [invoice, source, reason] of [
    [rate, 'override', 'Reviewed district exception'],
    [amount, 'manual_amount', 'Reviewed accounting correction'],
  ]) {
    const snapshot = (
      await pool.query(
        "select metadata->'taxSnapshot' as snapshot from audit_logs where entity_id=$1 and action='invoice.created'",
        [invoice.id],
      )
    ).rows[0].snapshot;
    assert.equal(snapshot.source, source);
    assert.equal(snapshot.overrideReason, reason);
    assert.equal(snapshot.actorId, f.actorId);
  }
});

test('invoice job/customer and tenant permissions stay bound without financial writes', async () => {
  const f = await fixture(),
    other = await fixture();
  await savePolicy(f);
  const mismatch = (
    await pool.query("insert into leads(org_id,name) values($1,'Other local customer') returning id", [
      f.orgId,
    ])
  ).rows[0].id;
  assert.equal((await createInvoice(f, { leadId: mismatch })).status, 400);
  assert.equal((await createInvoice(f, { jobId: other.jobId })).status, 404);
  assert.equal((await createInvoice(f, { leadId: other.leadId })).status, 404);
  assert.equal(
    (
      await call(
        invoices,
        f,
        '/customer',
        { leadId: f.leadId, amount: 100, description: 'Crew attempt' },
        'POST',
        f.crewId,
      )
    ).status,
    403,
  );
  assert.equal(
    (await pool.query('select count(*) from customer_invoices where org_id=$1', [f.orgId])).rows[0].count,
    '0',
  );
});

test('atomic acceptance rejects a stale reviewed-terms payload without signing or creating a job', async () => {
  const f = await fixture();
  const estimate = (
    await pool.query(
      "insert into estimates(org_id,lead_id,status,total,packages,proposal_terms_snapshot) values($1,$2,'sent',100,'[]',$3) returning id,updated_at",
      [f.orgId, f.leadId, JSON.stringify({ contractTerms: 'Current frozen terms' })],
    )
  ).rows[0];
  for (const reviewedTerms of [undefined, { contractTerms: 'Previously reviewed terms' }]) {
    await assert.rejects(
      pool.query('select accept_estimate_budget($1,$2,$3,$4,$5,$6)', [
        f.orgId,
        estimate.id,
        randomUUID(),
        estimate.updated_at.toISOString(),
        '{}',
        JSON.stringify({ reviewedTerms }),
      ]),
      (error: any) => error.code === 'P0409' && /terms changed/.test(error.message),
    );
  }
  const stored = (await pool.query('select status,signed_at from estimates where id=$1', [estimate.id]))
    .rows[0];
  assert.equal(stored.status, 'sent');
  assert.equal(stored.signed_at, null);
  assert.equal(
    (await pool.query('select count(*) from jobs where estimate_id=$1', [estimate.id])).rows[0].count,
    '0',
  );
  assert.equal(
    (await pool.query('select count(*) from customer_invoices where estimate_id=$1', [estimate.id])).rows[0]
      .count,
    '0',
  );
});
