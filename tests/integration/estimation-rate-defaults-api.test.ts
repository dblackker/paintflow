import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createDb } from '../../packages/db/src/client';
import { productionRates } from '../../packages/db/src/schema';
import { STARTER_PRODUCTION_RATES } from '../../packages/core/src/estimation-rate-defaults';
import { goldenSeed } from '../../packages/db/src/seeds/golden-data';
import rates from '../../apps/api/src/routes/production-rates';
import estimates from '../../apps/api/src/routes/estimates';
import { bridgeNeonToPostgres, disposableDatabase, migrateDisposableDatabase } from './local-db';

const pool = disposableDatabase();
const restore = bridgeNeonToPostgres(pool);
const sessions = new Map<string, string>();
const env = { DATABASE_URL: 'postgresql://synthetic:synthetic@localhost/crewmodo_rate_test', ENVIRONMENT: 'test',
  KV: { get: async (key: string) => sessions.get(key) || null }, PUBLIC_URL: 'https://example.invalid' };
const originalFetch = globalThis.fetch;
before(async () => {
  await migrateDisposableDatabase(pool);
  globalThis.fetch = async () => { throw new Error('Unexpected external provider call'); };
});
after(async () => { restore(); globalThis.fetch = originalFetch; await pool.end(); });

async function fixture() {
  const orgId = randomUUID(), actorId = randomUUID();
  await pool.query('insert into organizations(id,name,slug) values($1,$2,$2)', [orgId, `rates-${orgId}`]);
  await pool.query('insert into users(id,email) values($1,$2)', [actorId, `${actorId}@example.invalid`]);
  await pool.query("insert into memberships(org_id,user_id,role) values($1,$2,'owner')", [orgId, actorId]);
  await pool.query('insert into org_settings(org_id,default_labor_rate,sales_tax_rate) values($1,91,0)', [orgId]);
  const leadId = (await pool.query("insert into leads(org_id,name) values($1,'Synthetic client') returning id", [orgId])).rows[0].id;
  sessions.set(`session:${actorId}`, JSON.stringify({ orgId, userId: actorId, email: 'synthetic@example.invalid', expiresAt: Date.now() + 3600000 }));
  return { orgId, actorId, leadId };
}
async function call(app: typeof rates, f: Awaited<ReturnType<typeof fixture>>, path: string, body: unknown) {
  return app.fetch(new Request(`http://localhost${path}`, { method: 'POST', headers: {
    Authorization: `Bearer ${f.actorId}`, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID(),
  }, body: JSON.stringify(body) }), env as never);
}

test('database-default empty legacy table previews and creates an authoritative draft without rate edits', async () => {
  const f = await fixture();
  const row = (await pool.query(`insert into production_rates(org_id,category,surface_type,unit,rate_per_hour,hourly_rate,coats)
    values($1,'walls','drywall','sqft',400,65,2) returning *`, [f.orgId])).rows[0];
  assert.deepEqual(row.coat_rates, {});
  assert.equal(row.rate_basis, 'legacy_per_coat');
  const input = { calculationVersion: 'repaint-v2', items: [{ id: 'wall', productionRateId: row.id, quantity: '400', coats: 2 }] };
  const response = await call(rates, f, '/calculate', input);
  assert.equal(response.status, 200, await response.clone().text());
  const preview = (await response.json() as any).data;
  assert.equal(preview.calculation.totals.hours, '2');
  assert.equal(preview.calculation.totals.laborMinor, 13000);
  const saved = await call(estimates, f, '/', { leadId: f.leadId, status: 'draft', packages: [{
    name: 'Proposal', calculationVersion: 'repaint-v2', productionInput: input,
    items: [{ calculationItemId: 'wall', desc: 'Bedroom: Walls', qty: 1, rate: 1, productionRateId: row.id }],
  }] });
  assert.equal(saved.status, 201, await saved.clone().text());
  const estimate = (await saved.json() as any).data;
  assert.equal(Number(estimate.total), 130);
  assert.equal(estimate.packages[0].calculationSnapshot.totals.laborMinor, 13000);
  assert.deepEqual((await pool.query('select coat_rates from production_rates where id=$1', [row.id])).rows[0].coat_rates, {});
});

test('new-company and demo seed rows survive real JSON storage and preview every coating count', async () => {
  for (const book of [STARTER_PRODUCTION_RATES, goldenSeed.productionRates]) {
    const f = await fixture();
    const rows = await createDb(env.DATABASE_URL).insert(productionRates).values(book.map((rate) => ({ orgId: f.orgId, ...rate }))).returning();
    for (const coats of [1, 2, 3]) {
      const response = await call(rates, f, '/calculate', { calculationVersion: 'repaint-v2', items: rows.map((rate) => ({
        id: rate.id, productionRateId: rate.id, quantity: rate.unit === 'each' ? '1' : '100', coats,
      })) });
      assert.equal(response.status, 200, await response.clone().text());
      const preview = (await response.json() as any).data;
      assert.equal(preview.calculation.items.length, book.length);
      assert.ok(preview.calculation.items.every((item: any) => Number(item.hours) > 0));
      if (book === STARTER_PRODUCTION_RATES) assert.ok(preview.calculation.items.every((item: any) => item.operations[0].sellingRate === '91'));
    }
  }
});

test('incomplete custom pass tables produce actionable errors and cannot create an estimate', async () => {
  const f = await fixture();
  const row = (await pool.query(`insert into production_rates(org_id,category,surface_type,unit,rate_per_hour,coat_rates)
    values($1,'walls','drywall','sqft',400,'{"1":"400"}') returning id`, [f.orgId])).rows[0];
  const input = { calculationVersion: 'repaint-v2', items: [{ id: 'wall', productionRateId: row.id, quantity: '400', coats: 2 }] };
  const preview = await call(rates, f, '/calculate', input);
  assert.equal(preview.status, 400);
  assert.match((await preview.json() as any).error, /application pass 2.*Production Rates/);
  const response = await call(estimates, f, '/', { leadId: f.leadId, status: 'draft', packages: [{
    name: 'Proposal', calculationVersion: 'repaint-v2', productionInput: input,
    items: [{ calculationItemId: 'wall', desc: 'Bedroom: Walls', qty: 1, rate: 1, productionRateId: row.id }],
  }] });
  assert.equal(response.status, 400);
  assert.match((await response.json() as any).error, /application pass 2.*Production Rates/);
  assert.equal((await pool.query('select count(*) from estimates where org_id=$1', [f.orgId])).rows[0].count, '0');
});
