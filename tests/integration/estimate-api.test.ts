import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import estimates from '../../apps/api/src/routes/estimates';
import productionRates from '../../apps/api/src/routes/production-rates';
import { bridgeNeonToPostgres, disposableDatabase, migrateDisposableDatabase } from './local-db';

const pool = disposableDatabase();
const restoreBridge = bridgeNeonToPostgres(pool);
const org = randomUUID();
const foreignOrg = randomUUID();
const actor = randomUUID();
const crew = randomUUID();
let leadId: string;
let rateId: string;
let materialId: string;
let foreignRate: string;
const kv = new Map<string, string>();
const env = {
  DATABASE_URL: 'postgresql://synthetic:synthetic@localhost:5432/crewmodo_api_test', ENVIRONMENT: 'test',
  KV: { get: async (key: string) => kv.get(key) || null, delete: async (key: string) => { kv.delete(key); } },
};
function call(path: string, body: unknown, key = randomUUID(), method = 'POST', token = 'owner') {
  return estimates.fetch(new Request(`http://localhost${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(body),
  }), env as never);
}
function scope(rate = rateId) {
  return { items: [{ id: 'wall-1', productionRateId: rate, quantity: '500', coats: 1, prepLevel: 'light', materialId, colorCode: 'SW7551' }] };
}
function body(rate = rateId) {
  return { leadId, status: 'draft', packages: [{ name: 'proposal', calculationVersion: 'repaint-v1', productionInput: scope(rate),
    calculationInput: { surfaces: [{ labor: { sellingRate: 0 }, material: { costPerPack: 0 } }] },
    subtotal: 1, tax: 0, total: 1, items: [{ calculationItemId: 'wall-1', desc: 'Living room: Walls', qty: 1, rate: 1, kind: 'surface' }] }] };
}
before(async () => {
  await migrateDisposableDatabase(pool);
  await pool.query('INSERT INTO organizations (id,name,slug) VALUES ($1,$2,$2),($3,$4,$4)', [org, `estimate-${org}`, foreignOrg, `foreign-${foreignOrg}`]);
  await pool.query('INSERT INTO users (id,email) VALUES ($1,$2),($3,$4)', [actor, `${actor}@example.invalid`, crew, `${crew}@example.invalid`]);
  await pool.query("INSERT INTO memberships (org_id,user_id,role) VALUES ($1,$2,'owner'),($1,$3,'member')", [org, actor, crew]);
  await pool.query('INSERT INTO org_settings (org_id,sales_tax_rate,material_markup_percent) VALUES ($1,0.092,30)', [org]);
  leadId = (await pool.query("INSERT INTO leads (org_id,name) VALUES ($1,'Synthetic client') RETURNING id", [org])).rows[0].id;
  rateId = (await pool.query("INSERT INTO production_rates (org_id,category,surface_type,unit,rate_per_hour,hourly_rate) VALUES ($1,'walls','drywall','sqft',400,50) RETURNING id", [org])).rows[0].id;
  foreignRate = (await pool.query("INSERT INTO production_rates (org_id,category,surface_type,unit,rate_per_hour,hourly_rate) VALUES ($1,'walls','drywall','sqft',400,50) RETURNING id", [foreignOrg])).rows[0].id;
  materialId = (await pool.query("INSERT INTO materials (org_id,name,category,unit,cost_per_unit,coverage_sq_ft) VALUES ($1,'Synthetic paint','paint','gallon',40,400) RETURNING id", [org])).rows[0].id;
  for (const [token, userId] of [['owner', actor], ['crew', crew]]) kv.set(`session:${token}`, JSON.stringify({ userId, orgId: org, email: 'synthetic@example.invalid', expiresAt: Date.now() + 3600000 }));
});
after(async () => { restoreBridge(); await pool.end(); });

test('preview and persisted totals agree; submitted totals and snapshots cannot bypass pricebook', async () => {
  const preview = await productionRates.fetch(new Request('http://localhost/calculate', {
    method: 'POST', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() }, body: JSON.stringify(scope()),
  }), env as never);
  assert.equal(preview.status, 200, await preview.clone().text());
  const calculation = (await preview.json() as any).data.calculation;
  const saved = await call('/', body());
  assert.equal(saved.status, 201, await saved.clone().text());
  const data = (await saved.json() as any).data;
  assert.equal(Number(data.total) * 100, calculation.totals.totalMinor);
  assert.equal(data.packages[0].total, 181.82);
  assert.equal(data.packages[0].calculationInput.surfaces[0].material.costPerPack, '40.00');
  assert.equal(data.packages[0].calculationSnapshot.purchaseGroups[0].packCount, 2);
});

test('concurrent create retries produce one estimate and one creation activity', async () => {
  const key = randomUUID();
  const payload = body();
  const results = await Promise.all(Array.from({ length: 6 }, () => call('/', payload, key)));
  assert.equal(results.filter((response) => response.status === 201).length, 1);
  const outcomes = await Promise.all(results.map(async (response) => { assert.ok([200,201].includes(response.status), await response.clone().text()); return (await response.json() as any).data; }));
  assert.equal(new Set(outcomes.map((row) => row.id)).size, 1);
  const count = await pool.query("SELECT count(*) FROM audit_logs WHERE entity_id=$1 AND action='estimate.created'", [outcomes[0].id]);
  assert.equal(count.rows[0].count, '1');
  assert.equal((await call('/', { ...payload, city: 'Changed' }, key)).status, 409);
});

test('current pricing is used for unsigned revisions, while stale or signed versions cannot change', async () => {
  const original = (await (await call('/', body())).json() as any).data;
  const edit = { ...body(), expectedUpdatedAt: original.updatedAt };
  const saved = await call(`/${original.id}`, edit, randomUUID(), 'PATCH');
  assert.equal(saved.status, 200, await saved.clone().text());
  assert.equal((await call(`/${original.id}`, edit, randomUUID(), 'PATCH')).status, 409);
  const newVersion = (await saved.json() as any).data;
  await pool.query("UPDATE estimates SET signed_at=now(),status='accepted' WHERE id=$1", [original.id]);
  await pool.query('UPDATE materials SET cost_per_unit=90 WHERE id=$1', [materialId]);
  assert.equal((await call(`/${original.id}`, { ...edit, expectedUpdatedAt: newVersion.updatedAt }, randomUUID(), 'PATCH')).status, 409);
  assert.equal((await pool.query('SELECT total FROM estimates WHERE id=$1', [original.id])).rows[0].total, '181.82');
});

test('crew permission, foreign pricebook entries, missing keys and missing versions fail closed', async () => {
  assert.equal((await call('/', body(), randomUUID(), 'POST', 'crew')).status, 403);
  assert.equal((await call('/', body(foreignRate))).status, 400);
  assert.equal((await call('/', body(), '')).status, 400);
  const original = (await (await call('/', body())).json() as any).data;
  assert.equal((await call(`/${original.id}`, body(), randomUUID(), 'PATCH')).status, 409);
});
