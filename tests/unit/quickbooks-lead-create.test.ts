import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import leadsApp, { createLeadHandler } from '../../apps/api/src/routes/leads.ts';

const requireApi = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const { Hono } = requireApi('hono');
const { PgDialect } = requireApi('drizzle-orm/pg-core');
const { getTableName } = requireApi('drizzle-orm');
const dialect = new PgDialect();
const env = { DATABASE_URL: 'synthetic-no-database' } as any;
const input = { name: 'Synthetic customer', email: 'customer@example.test', orgId: 'untrusted-org' };

function fixture(options: {
  connected?: boolean;
  lookupError?: Error;
  insertError?: Error;
  sync?: 'blocked' | 'succeeds' | 'fails';
} = {}) {
  const events: string[] = [];
  const inserted: any[] = [];
  const filters: unknown[][] = [];
  let databaseCalls = 0;
  let syncCalls = 0;
  const db = {
    insert: (table: any) => {
      assert.equal(getTableName(table), 'leads');
      return { values: (values: any) => ({ returning: async () => {
        events.push('save');
        if (options.insertError) throw options.insertError;
        const lead = { id: 'lead-a', ...values };
        inserted.push(lead);
        return [lead];
      } }) };
    },
    query: { quickbooksConnections: { findFirst: async ({ where }: any) => {
      events.push('lookup');
      filters.push(dialect.sqlToQuery(where).params);
      assert.equal(inserted.length, 1, 'QBO lookup must run after the business save');
      if (options.lookupError) throw options.lookupError;
      return options.connected === false ? undefined : { id: 'connection-a', orgId: 'org-a', realmId: '123' };
    } } },
  };
  const dependencies = {
    db: (() => { databaseCalls++; return db; }) as any,
    ...(options.sync && options.sync !== 'blocked' ? {
      syncCustomer: (async (_env: any, orgId: string, lead: any) => {
        syncCalls++;
        events.push('export');
        assert.equal(orgId, 'org-a');
        assert.equal(lead, inserted[0]);
        if (options.sync === 'fails') throw new Error('private provider token or database details');
        return '789';
      }) as any,
    } : {}),
  };
  const app = new Hono();
  app.use('*', async (c: any, next: any) => {
    c.set('orgId', 'org-a');
    c.set('userId', 'user-a');
    await next();
  });
  app.onError((_error: unknown, c: any) => c.json({ error: 'Save failed' }, 500));
  app.post('/', createLeadHandler(dependencies));
  const request = (body: any = input) => app.request('/', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'synthetic-test' },
    body: JSON.stringify(body),
  }, env);
  return { request, events, inserted, filters,
    get databaseCalls() { return databaseCalls; }, get syncCalls() { return syncCalls; } };
}

test('actual disabled QBO export preserves a saved lead and returns a safe unavailable status', async () => {
  const f = fixture();
  const response = await f.request();
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.equal(result.data.id, 'lead-a');
  assert.equal(result.data.orgId, 'org-a');
  assert.equal(result.data.name, input.name);
  assert.equal(result.data.email, input.email);
  assert.equal(result.data.status, 'new');
  assert.deepEqual(result.meta.quickbooksSync, {
    status: 'unavailable', code: 'QB_EXPORT_NOT_READY',
    message: 'Customer saved. QuickBooks sync is unavailable.',
  });
  assert.equal(f.inserted.length, 1);
  assert.deepEqual(f.events, ['save', 'lookup']);
  assert.deepEqual(f.filters, [['org-a']]);
});

test('QBO connection lookup failure after save still returns 201 without retrying the insert', async () => {
  const f = fixture({ lookupError: new Error('private database connection details'), sync: 'succeeds' });
  const response = await f.request();
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.equal(result.data.id, 'lead-a');
  assert.equal(result.meta.quickbooksSync.code, 'QB_SYNC_UNAVAILABLE');
  assert.equal(result.meta.quickbooksSync.status, 'unavailable');
  assert.equal(JSON.stringify(result).includes('private'), false);
  assert.equal(f.inserted.length, 1);
  assert.equal(f.syncCalls, 0);
  assert.deepEqual(f.events, ['save', 'lookup']);
});

test('unexpected QBO export failure preserves customer success and never exposes raw provider errors', async () => {
  const f = fixture({ sync: 'fails' });
  const response = await f.request();
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.equal(result.data.id, 'lead-a');
  assert.equal(result.meta.quickbooksSync.code, 'QB_SYNC_UNAVAILABLE');
  assert.equal(JSON.stringify(result).includes('private'), false);
  assert.equal(f.inserted.length, 1);
  assert.equal(f.syncCalls, 1);
  assert.deepEqual(f.events, ['save', 'lookup', 'export']);
});

test('customers without a connected QBO company are saved without attempting export', async () => {
  const f = fixture({ connected: false, sync: 'succeeds' });
  const response = await f.request();
  assert.equal(response.status, 201);
  assert.deepEqual((await response.json()).meta.quickbooksSync, { status: 'not_connected' });
  assert.equal(f.syncCalls, 0);
  assert.equal(f.inserted.length, 1);
});

test('successful best-effort export reports success without changing the saved lead', async () => {
  const f = fixture({ sync: 'succeeds' });
  const response = await f.request();
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.deepEqual(result.meta.quickbooksSync, { status: 'synced' });
  assert.equal(result.data.id, 'lead-a');
  assert.equal(result.data.orgId, 'org-a');
  assert.equal(f.inserted.length, 1);
  assert.equal(f.syncCalls, 1);
});

test('invalid customer input is rejected before database access or QBO work', async () => {
  const f = fixture({ sync: 'succeeds' });
  const response = await f.request({ name: 'Customer without contact information' });
  assert.equal(response.status, 400);
  assert.equal(f.databaseCalls, 0);
  assert.equal(f.syncCalls, 0);
  assert.deepEqual(f.events, []);
});

test('business save failure is not swallowed or reported as a saved customer', async () => {
  const f = fixture({ insertError: new Error('save failed'), sync: 'succeeds' });
  const response = await f.request();
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'Save failed' });
  assert.equal(f.inserted.length, 0);
  assert.equal(f.syncCalls, 0);
  assert.deepEqual(f.events, ['save']);
});

test('the registered lead creation route still requires a session before saving or syncing', async () => {
  const response = await leadsApp.request('/', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  }, env);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'Unauthorized', code: 'NO_SESSION' });
});
