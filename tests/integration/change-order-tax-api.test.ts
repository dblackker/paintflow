import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { createDb } from '../../packages/db/src/index';
import route from '../../apps/api/src/routes/change-orders';
import { createInvoiceForChangeOrder } from '../../apps/api/src/lib/customer-invoices';
import { bridgeNeonToPostgres, disposableDatabase, migrateDisposableDatabase } from './local-db';

const pool = disposableDatabase();
const restore = bridgeNeonToPostgres(pool);
const orgId = randomUUID(),
  otherOrg = randomUUID(),
  actorId = randomUUID(),
  crewId = randomUUID(),
  otherActor = randomUUID();
const kv = new Map<string, string>();
const env = {
  DATABASE_URL: 'postgresql://synthetic:synthetic@localhost:5432/crewmodo_co_tax_test',
  ENVIRONMENT: 'test',
  PUBLIC_URL: 'https://example.invalid',
  KV: { get: async (key: string) => kv.get(key) || null },
};
const db = createDb(env.DATABASE_URL);
const originalFetch = globalThis.fetch;

before(async () => {
  await migrateDisposableDatabase(pool);
  await pool.query('insert into organizations(id,name,slug) values($1,$2,$2),($3,$4,$4)', [
    orgId,
    `co-${orgId}`,
    otherOrg,
    `co-${otherOrg}`,
  ]);
  await pool.query('insert into users(id,email) values($1,$2),($3,$4),($5,$6)', [
    actorId,
    `${actorId}@example.invalid`,
    crewId,
    `${crewId}@example.invalid`,
    otherActor,
    `${otherActor}@example.invalid`,
  ]);
  await pool.query(
    "insert into memberships(org_id,user_id,role) values($1,$2,'owner'),($1,$3,'member'),($4,$5,'owner')",
    [orgId, actorId, crewId, otherOrg, otherActor],
  );
  await pool.query(
    "insert into org_settings(org_id,company_name,sales_tax_rate,business_hours) values($1,'Synthetic contractor',0.041,$2),($3,'Other contractor',0.05,'{}')",
    [
      orgId,
      JSON.stringify({
        estimationTax: {
          rules: [
            { postalCode: '98101', label: 'Reviewed jobsite district', ratePercent: '10.3525' },
            { postalCode: '90210', label: 'Billing district', ratePercent: '9.5' },
          ],
        },
      }),
      otherOrg,
    ],
  );
  for (const [token, org, user] of [
    ['owner', orgId, actorId],
    ['crew', orgId, crewId],
    ['other', otherOrg, otherActor],
  ]) {
    kv.set(
      `session:${token}`,
      JSON.stringify({
        orgId: org,
        userId: user,
        email: 'synthetic@example.invalid',
        expiresAt: Date.now() + 3600000,
      }),
    );
  }
  globalThis.fetch = async () => {
    throw new Error('A change order test attempted external provider access.');
  };
});
after(async () => {
  restore();
  globalThis.fetch = originalFetch;
  await pool.end();
});

async function fixture(org = orgId, postalCode: string | null = '98101-1234') {
  const leadId = (
    await pool.query(
      "insert into leads(org_id,name,postal_code) values($1,'Synthetic customer','90210') returning id",
      [org],
    )
  ).rows[0].id;
  const estimateId = (
    await pool.query(
      "insert into estimates(org_id,lead_id,status,total,packages) values($1,$2,'accepted',100,'[]') returning id",
      [org, leadId],
    )
  ).rows[0].id;
  const jobId = (
    await pool.query(
      "insert into jobs(org_id,lead_id,estimate_id,name,street_address,city,state,postal_code) values($1,$2,$3,'Synthetic job','123 Jobsite St','Synthetic','WA',$4) returning id",
      [org, leadId, estimateId, postalCode],
    )
  ).rows[0].id;
  return { leadId, estimateId, jobId };
}
async function call(
  path: string,
  body?: unknown,
  method = 'POST',
  token = 'owner',
  key: string | null = randomUUID(),
) {
  return route.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(key ? { 'Idempotency-Key': key } : {}),
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
async function draft(f: Awaited<ReturnType<typeof fixture>>, patch = {}) {
  return data(
    await call('/', {
      ...f,
      description: 'Synthetic added walls',
      amount: '110.35',
      status: 'draft',
      paymentRequired: true,
      depositPercent: 50,
      ...patch,
    }),
  );
}
async function selected(id: string) {
  const order = await db.query.changeOrders.findFirst({
    where: (table, { and, eq }) => and(eq(table.id, id), eq(table.orgId, orgId)),
  });
  assert.ok(order);
  return order;
}

test('new gross CO resolves jobsite rather than billing ZIP, and strips injected snapshots', async () => {
  const f = await fixture();
  const order = await draft(f, {
    scopeDetails: {
      items: [{ area: 'Added wall', coats: 2 }],
      taxSnapshot: { value: '0', actorId: otherActor },
      commercialBreakdown: { totalMinor: 1 },
    },
  });
  assert.equal(order.amount, '110.35');
  assert.equal(order.paymentDueAmount, '55.18');
  assert.equal(order.scopeDetails.taxSnapshot.value, '0.103525');
  assert.equal(order.scopeDetails.taxSnapshot.source, 'jobsite_rule');
  assert.equal(order.scopeDetails.taxSnapshot.actorId, actorId);
  assert.equal(order.scopeDetails.taxSnapshot.orgId, orgId);
  assert.equal(order.scopeDetails.taxSnapshot.jobsite.jobId, f.jobId);
  assert.equal(order.scopeDetails.taxSnapshot.jobsite.streetAddress, '123 Jobsite St');
  assert.equal(order.scopeDetails.commercialBreakdown.subtotalMinor, 10000);
  assert.equal(order.scopeDetails.commercialBreakdown.taxMinor, 1035);
  assert.equal(order.scopeDetails.commercialBreakdown.totalMinor, 11035);
  const noZip = await draft(await fixture(orgId, null));
  assert.equal(noZip.scopeDetails.taxSnapshot.source, 'organization');
  assert.equal(noZip.scopeDetails.taxSnapshot.value, '0.041');
  assert.equal(noZip.scopeDetails.taxSnapshot.postalCode, null);
});

test('unsigned edits preserve snapshots and additive scope data; override review is explicit', async () => {
  const f = await fixture();
  const order = await draft(f);
  const snapshot = order.scopeDetails.taxSnapshot;
  await pool.query('update org_settings set business_hours=$2 where org_id=$1', [
    orgId,
    JSON.stringify({
      estimationTax: { rules: [{ postalCode: '98101', label: 'Changed rule', ratePercent: '20' }] },
    }),
  ]);
  await pool.query(
    'update change_orders set scope_details=scope_details || \'{"estimationBudget":{"retained":true}}\'::jsonb where id=$1',
    [order.id],
  );
  const changed = await data(
    await call(
      `/${order.id}`,
      { amount: '220.70', scopeDetails: { items: [{ area: 'Second wall' }] } },
      'PATCH',
    ),
  );
  assert.deepEqual(changed.scopeDetails.taxSnapshot, snapshot);
  assert.equal(changed.scopeDetails.commercialBreakdown.totalMinor, 22070);
  assert.deepEqual(changed.scopeDetails.estimationBudget, { retained: true });
  const override = await data(
    await call(
      `/${order.id}`,
      { taxOverride: { ratePercent: '7.25', reason: 'Owner reviewed jurisdiction exception' } },
      'PATCH',
    ),
  );
  assert.equal(override.amount, '220.70');
  assert.equal(override.scopeDetails.taxSnapshot.value, '0.0725');
  assert.equal(override.scopeDetails.taxSnapshot.source, 'override');
  assert.equal(override.scopeDetails.taxSnapshot.actorId, actorId);
  assert.equal(override.scopeDetails.taxSnapshot.overrideReason, 'Owner reviewed jurisdiction exception');
  const cleared = await data(await call(`/${order.id}`, { taxOverride: null }, 'PATCH'));
  assert.equal(cleared.scopeDetails.taxSnapshot.value, '0.2');
  assert.equal(cleared.scopeDetails.taxSnapshot.source, 'jobsite_rule');
  await pool.query('update org_settings set business_hours=$2 where org_id=$1', [
    orgId,
    JSON.stringify({
      estimationTax: {
        rules: [{ postalCode: '98101', label: 'Reviewed jobsite district', ratePercent: '10.3525' }],
      },
    }),
  ]);
});

test('invalid precision/reason, crew access and cross-tenant/job-estimate binding fail without writes', async () => {
  const f = await fixture();
  const other = await fixture(otherOrg);
  const input = { ...f, description: 'Synthetic walls', amount: '110.35', status: 'draft' };
  assert.equal(
    (await call('/', { ...input, taxOverride: { ratePercent: '9.12345', reason: 'Reviewed' } })).status,
    400,
  );
  assert.equal((await call('/', { ...input, taxOverride: { ratePercent: 7.25, reason: '' } })).status, 400);
  assert.equal((await call('/', { ...input, amount: '1.005' })).status, 400);
  assert.equal((await call('/', input, 'POST', 'owner', null)).status, 400);
  assert.equal((await call('/', input, 'POST', 'crew')).status, 403);
  assert.equal((await call('/', { ...input, jobId: other.jobId })).status, 404);
  assert.equal((await call('/', { ...input, estimateId: other.estimateId })).status, 404);
  assert.equal(
    (await pool.query('select count(*) from change_orders where job_id=$1', [f.jobId])).rows[0].count,
    '0',
  );
  await pool.query('update jobs set estimate_id=$2 where id=$1', [f.jobId, other.estimateId]);
  assert.equal((await call('/', { ...input, estimateId: other.estimateId })).status, 404);
  await pool.query('update jobs set estimate_id=$2 where id=$1', [f.jobId, f.estimateId]);
  const order = await draft(f);
  assert.equal((await call(`/${order.id}`, { amount: '120' }, 'PATCH', 'other')).status, 404);
  assert.equal((await call(`/${order.id}`, { amount: '120' }, 'PATCH', 'crew')).status, 403);
});

test('signed and approved scope/financial terms freeze while completion remains available', async () => {
  const f = await fixture();
  const order = await draft(f);
  await pool.query("update change_orders set customer_signed_at=now(),status='approved' where id=$1", [
    order.id,
  ]);
  const before = await selected(order.id);
  for (const patch of [
    { amount: '110.35' },
    { description: 'Changed' },
    { scopeDetails: { items: [] } },
    { paymentRequired: false },
    { depositPercent: 100 },
    { createdBy: 'customer' },
    { taxOverride: { ratePercent: 0, reason: 'Reviewed exemption' } },
    { taxOverride: null },
    { status: 'draft' },
    { status: 'rejected' },
  ]) {
    assert.equal((await call(`/${order.id}`, patch, 'PATCH')).status, 409, JSON.stringify(patch));
  }
  assert.deepEqual(await selected(order.id), before);
  const completed = await data(await call(`/${order.id}`, { status: 'completed' }, 'PATCH'));
  assert.equal(completed.status, 'completed');
  assert.deepEqual(completed.scopeDetails, order.scopeDetails);
  const approvedUnsigned = await draft(f, { status: 'approved' });
  assert.equal((await call(`/${approvedUnsigned.id}`, { amount: 200 }, 'PATCH')).status, 409);
});

test('a customer signature captured between read and update rejects the stale price mutation', async () => {
  const order = await draft(await fixture());
  const requireDb = createRequire(new URL('../../packages/db/package.json', import.meta.url));
  const { neonConfig } = requireDb('@neondatabase/serverless');
  const previous = neonConfig.fetchFunction;
  let intercepted = false;
  neonConfig.fetchFunction = async (url: string, options: RequestInit) => {
    const payload = JSON.parse(String(options.body));
    if (!intercepted && /^update "change_orders" set/.test(payload.query)) {
      intercepted = true;
      await pool.query("update change_orders set customer_signed_at=now(),status='approved' where id=$1", [
        order.id,
      ]);
    }
    return previous(url, options);
  };
  try {
    assert.equal((await call(`/${order.id}`, { amount: '220.70' }, 'PATCH')).status, 409);
  } finally {
    neonConfig.fetchFunction = previous;
  }
  assert.equal(intercepted, true);
  const stored = await selected(order.id);
  assert.equal(stored.amount, '110.35');
  assert.deepEqual(stored.scopeDetails, order.scopeDetails);
});

test('CO invoice freezes exact gross/payment cents and original provenance, without provider calls', async () => {
  const f = await fixture();
  const order = await draft(f);
  await pool.query("update change_orders set customer_signed_at=now(),status='approved' where id=$1", [
    order.id,
  ]);
  await pool.query('update org_settings set sales_tax_rate=0.99 where org_id=$1', [orgId]);
  const stored = await selected(order.id);
  const invoice = await createInvoiceForChangeOrder(db, stored, f.leadId, { userId: actorId });
  assert.ok(invoice);
  assert.equal(invoice.total, '55.18');
  assert.equal(invoice.subtotal, '50.00');
  assert.equal(invoice.tax, '5.18');
  assert.equal(invoice.taxRate, null);
  const line = (invoice.lineItems as any[])[0];
  assert.equal(line.total, 50);
  assert.equal(line.taxSnapshot.value, '0.103525');
  assert.deepEqual(line.taxSnapshot, order.scopeDetails.taxSnapshot);
  assert.equal(line.commercialBreakdown.totalMinor, 5518);
  assert.equal((await createInvoiceForChangeOrder(db, stored, f.leadId))!.id, invoice.id);
  const other = await fixture(otherOrg);
  await assert.rejects(createInvoiceForChangeOrder(db, stored, other.leadId), /match/);
  const zero = await draft(f, { depositPercent: 0 });
  assert.equal(await createInvoiceForChangeOrder(db, await selected(zero.id), f.leadId), null);
  assert.equal((await pool.query('select count(*) from email_sends')).rows[0].count, '0');
  assert.equal((await pool.query('select count(*) from customer_payments')).rows[0].count, '0');
});

test('legacy CO keeps original unknown tax behavior and is never backfilled or repriced', async () => {
  const f = await fixture();
  const id = (
    await pool.query(
      "insert into change_orders(org_id,job_id,estimate_id,description,amount,status,created_by,payment_required,payment_due_amount) values($1,$2,$3,'Legacy extra scope',110.35,'pending','contractor',true,55.18) returning id",
      [orgId, f.jobId, f.estimateId],
    )
  ).rows[0].id;
  await data(await call(`/${id}`, { description: 'Legacy scope correction' }, 'PATCH'));
  assert.equal((await selected(id)).scopeDetails, null);
  await data(await call(`/${id}`, { amount: '115.00' }, 'PATCH'));
  assert.equal((await selected(id)).scopeDetails, null);
  assert.equal(
    (await call(`/${id}`, { taxOverride: { ratePercent: 7.25, reason: 'Reviewed jurisdiction' } }, 'PATCH'))
      .status,
    409,
  );
  await data(
    await call(
      `/${id}`,
      { amount: '120.00', scopeDetails: { items: [{ area: 'Legacy correction' }] } },
      'PATCH',
    ),
  );
  const current = await selected(id);
  assert.equal((current.scopeDetails as any).taxSnapshot, undefined);
  await pool.query("update change_orders set customer_signed_at=now(),status='approved' where id=$1", [id]);
  const invoice = await createInvoiceForChangeOrder(db, await selected(id), f.leadId);
  assert.ok(invoice);
  assert.equal(invoice.tax, '0.00');
  assert.equal(invoice.subtotal, invoice.total);
  assert.equal((invoice.lineItems as any[])[0].taxSnapshot, undefined);
  assert.equal((await call(`/${id}`, { amount: 200 }, 'PATCH')).status, 409);
});
