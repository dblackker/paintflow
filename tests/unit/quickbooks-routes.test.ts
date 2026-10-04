import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { canManageQuickBooks, createQuickBooksRoutes, quickBooksSettingsRedirect } from '../../apps/api/src/routes/quickbooks.ts';

const requireApi = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const { PgDialect } = requireApi('drizzle-orm/pg-core');
const dialect = new PgDialect();
const env = { DATABASE_URL: 'synthetic-no-database', PUBLIC_URL: 'https://app.example.test', APP_URL: 'https://api.example.test',
  QB_CLIENT_ID: 'test-client', QB_CLIENT_SECRET: 'test-secret', QB_WEBHOOK_VERIFIER_TOKEN: 'test-verifier' } as any;
const connection = { id: 'connection-a', orgId: 'org-a', realmId: '123', refreshToken: 'synthetic-refresh',
  accessToken: 'synthetic-access', tokenExpiresAt: new Date(Date.now() + 3600000), companyName: 'Synthetic company' };
function fixtures(options: { connections?: any[]; role?: string; roles?: any[]; uniqueRealm?: boolean; settings?: any; legacyCustomer?: any; saved?: any[] } = {}) {
  const connections = options.connections ?? [connection];
  const filters: { method: string; text: string; params: unknown[] }[] = [];
  const mutations: string[] = [];
  let providerCalls = 0;
  let databaseCalls = 0;
  let consumed = 0;
  const capture = (method: string, filter: any) => {
    const query = dialect.sqlToQuery(filter);
    filters.push({ method, text: query.sql, params: query.params });
    return query.params;
  };
  const db = {
    query: {
      memberships: { findFirst: async ({ where }: any) => {
        const [orgId, userId] = capture('membership', where);
        return { orgId, userId, role: options.role ?? 'owner' };
      } },
      userRoles: { findMany: async ({ where }: any) => { capture('role', where); return options.roles ?? []; } },
      quickbooksConnections: {
        findFirst: async ({ where }: any) => { const [org] = capture('orgConnection', where); return connections.find((row) => row.orgId === org); },
        findMany: async ({ where, limit }: any) => { const [realm] = capture('realmConnection', where); return connections.filter((row) => row.realmId === realm).slice(0, limit); },
      },
      orgSettings: { findFirst: async ({ where }: any) => { capture('settings', where); return options.settings; } },
      leads: { findFirst: async ({ where }: any) => { capture('legacyCustomer', where); return options.legacyCustomer; } },
      estimates: { findFirst: async ({ where }: any) => { capture('legacyInvoice', where); return undefined; } },
    },
    execute: async () => [{ unique_realm: options.uniqueRealm === true }],
    delete: () => ({ where: async (where: any) => { capture('delete', where); mutations.push('delete'); } }),
    update: () => ({ set: () => ({ where: (where: any) => { capture('update', where); mutations.push('update');
      return { returning: async () => options.saved ?? [{ id: connection.id }] }; } }) }),
    insert: () => ({ values: () => ({
      onConflictDoNothing: () => ({ returning: async () => { mutations.push('insert'); return options.saved ?? [{ id: 'new-connection' }]; } }),
      onConflictDoUpdate: async () => { mutations.push('settings'); },
    }) }),
  };
  const dependencies = {
    db: () => { databaseCalls++; return db as any; },
    request: (async () => { providerCalls++; assert.fail('Unexpected provider call'); }) as typeof fetch,
    authenticate: (async (c: any, next: any) => { c.set('orgId', 'org-a'); c.set('userId', 'user-a'); await next(); }) as any,
    createState: (async () => 'test-state') as any,
    consumeState: (async () => { consumed++; return { orgId: 'org-a', userId: 'user-a' }; }) as any,
  };
  return { db, dependencies, filters, mutations, get providerCalls() { return providerCalls; },
    get databaseCalls() { return databaseCalls; }, get consumed() { return consumed; } };
}
const legacy = (realm = '123') => JSON.stringify({ eventNotifications: [{ realmId: realm,
  dataChangeEvent: { entities: [{ id: '456', name: 'Payment', operation: 'Create' }] } }] });
const signed = (body: string) => ({ method: 'POST', body, headers: {
  'Content-Type': 'application/json', 'intuit-signature': createHmac('sha256', env.QB_WEBHOOK_VERIFIER_TOKEN).update(body).digest('base64'),
} });

test('webhook refuses absent verifier with 503, before reading database or provider', async () => {
  const f = fixtures();
  const response = await createQuickBooksRoutes(f.dependencies).request('/webhook', signed(legacy()), { ...env, QB_WEBHOOK_VERIFIER_TOKEN: undefined });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, 'QB_WEBHOOK_NOT_CONFIGURED');
  assert.equal(f.databaseCalls, 0);
  assert.equal(f.providerCalls, 0);
});

test('webhook rejects absent, forged or payload-mismatched signatures with 401', async () => {
  const f = fixtures();
  const app = createQuickBooksRoutes(f.dependencies);
  for (const init of [{ method: 'POST', body: legacy() }, { ...signed(legacy()), body: legacy('999') },
    { method: 'POST', body: legacy(), headers: { 'intuit-signature': 'invalid' } }]) {
    assert.equal((await app.request('/webhook', init, env)).status, 401);
  }
  assert.equal(f.databaseCalls, 0);
  assert.equal(f.mutations.length, 0);
});

test('signed webhook for unknown or multiply attached realm fails closed', async () => {
  for (const [connections, expectedStatus, expectedCode] of [
    [[], 404, 'QB_UNKNOWN_REALM'],
    [[connection, { ...connection, id: 'connection-b', orgId: 'org-b' }], 409, 'QB_AMBIGUOUS_REALM'],
  ] as const) {
    const f = fixtures({ connections: [...connections] });
    const response = await createQuickBooksRoutes(f.dependencies).request('/webhook', signed(legacy()), env);
    assert.equal(response.status, expectedStatus);
    assert.equal((await response.json()).code, expectedCode);
    assert.equal(f.providerCalls, 0);
    assert.deepEqual(f.mutations, []);
  }
});

test('known-company events are not silently acknowledged or used to sign proposals without a durable inbox', async () => {
  const f = fixtures();
  const app = createQuickBooksRoutes(f.dependencies);
  const response = await app.request('/webhook', signed(legacy()), env);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, 'QB_RECONCILIATION_NOT_READY');
  assert.deepEqual(f.mutations, []);
  assert.equal(f.providerCalls, 0);
  const empty = await app.request('/webhook', signed('[]'), env);
  assert.equal(empty.status, 200);
});

test('CloudEvents batches validate every company rather than selecting the first tenant', async () => {
  const f = fixtures();
  const payload = JSON.stringify(['123', '999'].map((realm, index) => ({ id: `event-${index}`, specversion: '1.0',
    type: 'qbo.payment.created.v1', intuitaccountid: realm, intuitentityid: '456' })));
  const response = await createQuickBooksRoutes(f.dependencies).request('/webhook', signed(payload), env);
  assert.equal(response.status, 404);
  assert.deepEqual(f.filters.map((row) => row.params), [['123'], ['999']]);
  assert.deepEqual(f.mutations, []);
});

test('malformed signed payload and oversized input are rejected with no ledger writes', async () => {
  const f = fixtures();
  const app = createQuickBooksRoutes(f.dependencies);
  assert.equal((await app.request('/webhook', signed('not-json'), env)).status, 400);
  assert.equal((await app.request('/webhook', signed(JSON.stringify({ eventNotifications: [{ realmId: '../evil' }] })), env)).status, 400);
  const tooLarge = await app.request('/webhook', signed(' '.repeat(256 * 1024 + 1)), env);
  assert.equal(tooLarge.status, 400);
  assert.equal((await tooLarge.json()).code, 'QB_WEBHOOK_TOO_LARGE');
  assert.equal(f.databaseCalls, 0);
});

test('OAuth cancellation consumes trusted state and redirects to Settings without token exchange', async () => {
  const f = fixtures();
  const response = await createQuickBooksRoutes(f.dependencies).request('/callback?error=access_denied&state=test-state', {}, env);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), 'https://app.example.test/settings?qb_status=canceled');
  assert.equal(f.consumed, 1);
  assert.equal(f.providerCalls, 0);
  assert.equal(f.databaseCalls, 0);
});

test('OAuth missing/expired/replayed state and provider errors use only static safe status codes', async () => {
  const f = fixtures();
  const app = createQuickBooksRoutes({ ...f.dependencies, consumeState: (async () => null) as any });
  for (const url of ['/callback?error=access_denied', '/callback?error=access_denied&state=expired', '/callback?code=secret&realmId=123&state=replay']) {
    const response = await app.request(url, {}, env);
    assert.equal(response.headers.get('location'), 'https://app.example.test/settings?qb_status=invalid_state');
  }
  const error = await createQuickBooksRoutes(f.dependencies).request('/callback?error=secret-token&state=valid', {}, env);
  assert.equal(error.headers.get('location'), 'https://app.example.test/settings?qb_status=authorization_failed');
  assert.equal(f.databaseCalls, 0);
});

test('return URL rejects unsafe protocols and always stays on the configured origin', () => {
  assert.equal(quickBooksSettingsRedirect('https://app.example.test/other?next=evil', 'canceled'), 'https://app.example.test/settings?qb_status=canceled');
  assert.throws(() => quickBooksSettingsRedirect('javascript:evil', 'canceled'));
  assert.throws(() => quickBooksSettingsRedirect('https://username:password@app.example.test', 'canceled'));
});

test('connection callback rejects duplicate company, company switching and absent database uniqueness before contacting Intuit', async () => {
  for (const [options, code] of [
    [{ connections: [{ ...connection, orgId: 'org-b' }] }, 'QB_COMPANY_ALREADY_ATTACHED'],
    [{ connections: [{ ...connection, realmId: '999' }] }, 'QB_COMPANY_SWITCH_REQUIRES_REVIEW'],
    [{ connections: [] }, 'QB_REALM_CONSTRAINT_REQUIRED'],
    [{ connections: [], uniqueRealm: true, legacyCustomer: { id: 'stale' } }, 'QB_RECONNECT_REQUIRES_REVIEW'],
  ] as const) {
    const f = fixtures(options as any);
    const response = await createQuickBooksRoutes(f.dependencies).request('/callback?code=test-code&state=valid&realmId=123', {}, env);
    assert.equal((await response.json()).code, code);
    assert.equal(f.providerCalls, 0);
    assert.deepEqual(f.mutations, []);
  }
});

test('reauthorization checks initiating membership and scopes the saved credentials by tenant/realm/previous token', async () => {
  const f = fixtures();
  let requests = 0;
  const response = await createQuickBooksRoutes({ ...f.dependencies, request: (async () => {
    requests++;
    return requests === 1 ? Response.json({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 })
      : Response.json({ CompanyInfo: { Id: '1', CompanyName: 'Synthetic company' } });
  }) as any }).request('/callback?code=test-code&state=valid&realmId=123', {}, env);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), 'https://app.example.test/settings?qb_status=connected&qb_connected=true');
  assert.deepEqual(f.filters.find((row) => row.method === 'update')?.params, ['connection-a', 'org-a', '123', 'synthetic-refresh']);
  assert.equal(f.filters.filter((row) => row.method === 'membership').length, 2);
  assert.deepEqual(f.mutations, ['update']);
});

test('crew session cannot manage accounting; role grant from a different tenant never authorizes', async () => {
  const f = fixtures({ role: 'member', roles: [{ orgId: 'org-a', userId: 'user-a', role: { orgId: 'org-b', permissions: ['*'] } }] });
  assert.equal(await canManageQuickBooks(f.db as any, 'org-a', 'user-a'), false);
  const app = createQuickBooksRoutes(f.dependencies);
  for (const [url, method] of [['/status', 'GET'], ['/settings', 'GET'], ['/connect', 'GET'], ['/disconnect', 'POST'],
    ['/items', 'GET'], ['/tax-codes', 'GET'], ['/sync/invoice/estimate-a', 'POST'], ['/sync/customer/lead-a', 'POST']]) {
    assert.equal((await app.request(url, { method }, env)).status, 403);
  }
  assert.equal(f.providerCalls, 0);
  assert.deepEqual(f.mutations, []);
  const callback = await app.request('/callback?code=test&realmId=123&state=valid', {}, env);
  assert.equal(callback.headers.get('location'), 'https://app.example.test/settings?qb_status=forbidden');
});

test('default authentication is still mandatory; there is no header-based tenant bypass', async () => {
  const f = fixtures();
  const { authenticate: _authenticate, ...deps } = f.dependencies;
  const response = await createQuickBooksRoutes(deps).request('/status', { headers: { 'x-org-id': 'org-a' } }, env);
  assert.equal(response.status, 401);
  assert.equal(f.databaseCalls, 0);
});

test('legacy direct export routes deny before querying estimates/customers or contacting provider', async () => {
  const f = fixtures();
  const app = createQuickBooksRoutes(f.dependencies);
  for (const url of ['/sync/customer/lead-a', '/sync/invoice/estimate-a']) {
    const response = await app.request(url, { method: 'POST' }, env);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, 'QB_EXPORT_NOT_READY');
  }
  assert.equal(f.filters.every((row) => row.method === 'membership'), true);
  assert.equal(f.providerCalls, 0);
  assert.deepEqual(f.mutations, []);
});

test('disconnect deletes only the authenticated tenant/company connection, with no claim of provider revocation', async () => {
  const f = fixtures({ connections: [connection, { ...connection, id: 'connection-b', orgId: 'org-b', realmId: '999' }] });
  const response = await createQuickBooksRoutes(f.dependencies).request('/disconnect', { method: 'POST' }, env);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).authorizationRevoked, false);
  const deletion = f.filters.find((row) => row.method === 'delete')!;
  assert.deepEqual(deletion.params, ['connection-a', 'org-a', '123']);
  assert.match(deletion.text, /"org_id"/);
  assert.match(deletion.text, /"realm_id"/);
  assert.equal(f.providerCalls, 0);
});

test('QuickBooks settings read never returns unrelated tenant business settings', async () => {
  const f = fixtures({ settings: { qbTaxCode: 'TAX', qbItemId: '8', privateBusinessField: 'not-for-QBO' } });
  const response = await createQuickBooksRoutes(f.dependencies).request('/settings', {}, env);
  assert.deepEqual(await response.json(), { data: { qbTaxCode: 'TAX', qbItemId: '8' }, exportReady: false });
});

test('invalid item mappings cannot be stored even for an owner', async () => {
  const f = fixtures();
  const response = await createQuickBooksRoutes({ ...f.dependencies,
    request: (async () => Response.json({ QueryResponse: { Item: [{ Id: '8', Active: false, Type: 'Service' }] } })) as any,
  }).request('/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ qbItemId: '8', qbTaxCode: 'TAX' }) }, env);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, 'QB_INVALID_ITEM_MAPPING');
  assert.deepEqual(f.mutations, []);
});

test('invalid tax mappings are rejected; validated Service/TAX mappings remain explicitly non-export-ready', async () => {
  for (const valid of [false, true]) {
    const f = fixtures();
    const response = await createQuickBooksRoutes({ ...f.dependencies, request: (async (url: any) => {
      const query = new URL(String(url)).searchParams.get('query') ?? '';
      return query.includes('FROM Item')
        ? Response.json({ QueryResponse: { Item: [{ Id: '8', Active: true, Type: 'Service' }] } })
        : Response.json({ QueryResponse: { TaxCode: [{ Id: 'TAX', Active: valid }] } });
    }) as any }).request('/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qbItemId: '8', qbTaxCode: 'TAX' }) }, env);
    assert.equal(response.status, valid ? 200 : 400);
    const body = await response.json();
    if (valid) {
      assert.deepEqual(body, { data: { qbItemId: '8', qbTaxCode: 'TAX' }, exportReady: false });
      assert.deepEqual(f.mutations, ['settings']);
    } else {
      assert.equal(body.code, 'QB_INVALID_TAX_MAPPING');
      assert.deepEqual(f.mutations, []);
    }
  }
});

test('missing membership or foreign role assignment does not authorize accounting management', async () => {
  const missing = fixtures();
  missing.db.query.memberships.findFirst = async () => undefined as any;
  assert.equal(await canManageQuickBooks(missing.db as any, 'org-a', 'user-a'), false);
  assert.equal(await canManageQuickBooks(missing.db as any, '', 'user-a'), false);
  for (const permissions of [['*'], ['all'], ['manage_settings']]) {
    const f = fixtures({ role: 'member', roles: [{ orgId: 'org-a', userId: 'user-a', role: { orgId: 'org-a', permissions } }] });
    assert.equal(await canManageQuickBooks(f.db as any, 'org-a', 'user-a'), true);
  }
});

test('ambiguous company disconnect refuses deletion, and disconnected retry is locally idempotent', async () => {
  const f = fixtures({ connections: [connection, { ...connection, id: 'duplicate', orgId: 'org-b' }] });
  const response = await createQuickBooksRoutes(f.dependencies).request('/disconnect', { method: 'POST' }, env);
  assert.equal(response.status, 409);
  assert.deepEqual(f.mutations, []);
  const disconnected = fixtures({ connections: [] });
  const retry = await createQuickBooksRoutes(disconnected.dependencies).request('/disconnect', { method: 'POST' }, env);
  assert.equal(retry.status, 200);
  assert.deepEqual(disconnected.mutations, []);
});

test('callback cannot overwrite a concurrently changed connection', async () => {
  const f = fixtures({ saved: [] });
  let requests = 0;
  const response = await createQuickBooksRoutes({ ...f.dependencies, request: (async () => {
    requests++;
    return requests === 1 ? Response.json({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 })
      : Response.json({ CompanyInfo: { Id: '1', CompanyName: 'Synthetic company' } });
  }) as any }).request('/callback?code=test&state=valid&realmId=123', {}, env);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'QB_CONNECTION_CHANGED');
});
