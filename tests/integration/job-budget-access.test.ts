import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import jobs from '../../apps/api/src/routes/jobs';
import { bridgeNeonToPostgres, disposableDatabase, migrateDisposableDatabase } from './local-db';

const pool = disposableDatabase();
const restore = bridgeNeonToPostgres(pool);
const org = randomUUID(), other = randomUUID(), owner = randomUUID(), crew = randomUUID();
const lead = randomUUID(), job = randomUUID();
const sessions = new Map<string, string>();
const env = { DATABASE_URL: 'postgresql://synthetic:synthetic@localhost:5432/crewmodo_access_test', ENVIRONMENT: 'test',
  KV: { get: async (key: string) => sessions.get(key) || null, delete: async (key: string) => { sessions.delete(key); } } };

before(async () => {
  await migrateDisposableDatabase(pool);
  await pool.query('INSERT INTO organizations(id,name,slug) VALUES($1,$2,$2),($3,$4,$4)', [org, `access-${org}`, other, `other-${other}`]);
  await pool.query('INSERT INTO users(id,email) VALUES($1,$2),($3,$4)', [owner, `${owner}@example.invalid`, crew, `${crew}@example.invalid`]);
  await pool.query("INSERT INTO memberships(org_id,user_id,role) VALUES($1,$2,'owner'),($1,$3,'member')", [org, owner, crew]);
  await pool.query("INSERT INTO leads(id,org_id,name) VALUES($1,$2,'Synthetic customer')", [lead, org]);
  await pool.query("INSERT INTO jobs(id,org_id,lead_id,name,status,budget,estimation_budget) VALUES($1,$2,$3,'Synthetic job','scheduled',100,$4)",
    [job, org, lead, JSON.stringify({ private: 'supplier-cost-and-burden' })]);
  for (const [token, orgId, userId] of [['owner', org, owner], ['crew', org, crew], ['foreign', other, owner]]) {
    sessions.set(`session:${token}`, JSON.stringify({ orgId, userId, email: 'synthetic@example.invalid', expiresAt: Date.now() + 3600000 }));
  }
});
after(async () => { restore(); await pool.end(); });

function call(path: string, token = 'crew', method = 'GET', body?: unknown) {
  return jobs.fetch(new Request(`http://localhost${path}`, { method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), env as never);
}

test('crew detail and list responses exclude frozen costing and commercial totals', async () => {
  for (const path of [`/${job}`, '/']) {
    const response = await call(path);
    assert.equal(response.status, 200, await response.clone().text());
    const result = (await response.json() as any).data;
    const rows = Array.isArray(result) ? result : [result];
    assert.equal(rows.length, 1);
    for (const row of rows) for (const key of ['estimationBudget', 'budget', 'actualCost', 'financialSummary', 'costing']) assert.equal(row[key], undefined);
    assert.equal(JSON.stringify(result).includes('supplier-cost-and-burden'), false);
  }
});

test('owner retains costing and foreign tenants cannot read a job budget', async () => {
  const response = await call(`/${job}`, 'owner');
  assert.equal(response.status, 200);
  const row = (await response.json() as any).data;
  assert.equal(row.estimationBudget.private, 'supplier-cost-and-burden');
  assert.equal(row.budget, '100.00');
  assert.equal((await call(`/${job}`, 'foreign')).status, 404);
});

test('crew edits cannot write or echo a private budget', async () => {
  assert.equal((await call(`/${job}`, 'crew', 'PATCH', { budget: 999 })).status, 403);
  const response = await call(`/${job}`, 'crew', 'PATCH', { name: 'Updated operational label' });
  assert.equal(response.status, 200, await response.clone().text());
  const row = (await response.json() as any).data;
  assert.equal(row.name, 'Updated operational label');
  assert.equal(row.estimationBudget, undefined);
  assert.equal(row.budget, undefined);
  assert.equal(row.actualCost, undefined);
});

test('crew cannot use cost endpoints or the legacy rate-priced time endpoint', async () => {
  for (const [path, method, body] of [[`/${job}/costs`, 'GET', undefined], [`/${job}/costs`, 'POST', {}],
    [`/${job}/costs/${randomUUID()}`, 'PATCH', {}], [`/${job}/costs/${randomUUID()}`, 'DELETE', undefined],
    [`/${job}/time-entries`, 'POST', { hours: 8, rate: 100 }]] as const) {
    const response = await call(path, 'crew', method, body);
    assert.equal(response.status, 403, await response.clone().text());
    assert.equal((await response.json() as any).code, 'JOB_COSTS_FORBIDDEN');
  }
  assert.equal((await call(`/${job}/costs`, 'owner')).status, 200);
});
