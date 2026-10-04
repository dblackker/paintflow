import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { connectionForOrg, connectionForRealm, createQBCustomer, createQBInvoice, createQBPayment,
  getCompanyInfo, getQbBase, getValidAccessToken, parseQBPaymentResponse, parseQbWebhook, QuickBooksTrustError,
  readQBPayment, requireQbId, validateQbTokens, verifyQbWebhook } from '../../apps/api/src/lib/quickbooks.ts';

const requireApi = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const { PgDialect } = requireApi('drizzle-orm/pg-core');
const dialect = new PgDialect();
const env = { DATABASE_URL: 'unused', QB_CLIENT_ID: 'test-client', QB_CLIENT_SECRET: 'test-secret', QB_ENV: 'sandbox' };
const now = Date.parse('2026-10-01T12:00:00Z');
const connection = { id: 'connection-a', orgId: 'org-a', realmId: '123', accessToken: 'access-a', refreshToken: 'refresh-a',
  tokenExpiresAt: new Date(now + 3600000), companyName: 'Synthetic company' };
const trust = (code: string, status?: number) => (error: unknown) => {
  assert.ok(error instanceof QuickBooksTrustError);
  assert.equal(error.code, code);
  if (status !== undefined) assert.equal(error.status, status);
  return true;
};
function fakeDb(rows: any[] = [connection], updated: any[] = [{ id: connection.id }]) {
  const filters: { method: string; params: unknown[]; text: string }[] = [];
  let writes = 0;
  const capture = (method: string, filter: any) => {
    const query = dialect.sqlToQuery(filter);
    filters.push({ method, params: query.params, text: query.sql });
    return query.params;
  };
  const db = {
    query: { quickbooksConnections: {
      findFirst: async ({ where }: any) => rows.find((row) => row.orgId === capture('findFirst', where)[0]),
      findMany: async ({ where, limit }: any) => rows.filter((row) => row.realmId === capture('findMany', where)[0]).slice(0, limit),
    } },
    update: () => { writes++; return { set: () => ({ where: (filter: any) => {
      capture('update', filter); return { returning: async () => updated };
    } }) }; },
  };
  return { db: db as any, filters, get writes() { return writes; } };
}

test('webhook HMAC covers the exact raw UTF-8 bytes and rejects altered payloads', async () => {
  const raw = new TextEncoder().encode('{ "name": "caf\u00e9" }\n').buffer;
  const secret = 'synthetic-verifier';
  const signature = createHmac('sha256', secret).update(Buffer.from(raw)).digest('base64');
  assert.equal(await verifyQbWebhook(raw, signature, secret), true);
  assert.equal(await verifyQbWebhook(new TextEncoder().encode('{"name":"caf\u00e9"}').buffer, signature, secret), false);
  assert.equal(await verifyQbWebhook(raw, signature, 'wrong'), false);
  assert.equal(await verifyQbWebhook(raw, undefined, secret), false);
  assert.equal(await verifyQbWebhook(raw, 'not-base64', secret), false);
  await assert.rejects(() => verifyQbWebhook(raw, signature, undefined), trust('QB_WEBHOOK_NOT_CONFIGURED', 503));
});

test('webhook parser supports legacy notifications and current Intuit CloudEvents', () => {
  assert.deepEqual(parseQbWebhook({ eventNotifications: [{ realmId: '123', dataChangeEvent: { entities: [
    { id: '456', name: 'Payment', operation: 'Create' }, { id: '789', name: 'Invoice', operation: 'Update' },
  ] } }] }), [
    { realmId: '123', entityId: '456', entity: 'payment', operation: 'create' },
    { realmId: '123', entityId: '789', entity: 'invoice', operation: 'update' },
  ]);
  assert.deepEqual(parseQbWebhook([{ id: 'event-1', specversion: '1.0', type: 'qbo.payment.created.v1',
    intuitaccountid: '123', intuitentityid: '456' }]), [{ realmId: '123', entityId: '456', entity: 'payment', operation: 'created', eventId: 'event-1' }]);
  assert.deepEqual(parseQbWebhook([]), []);
  assert.throws(() => parseQbWebhook({}), trust('QB_INVALID_WEBHOOK', 400));
  assert.throws(() => parseQbWebhook([{ specversion: '1.0', id: '1', type: 'qbo.payment.created.v1', intuitaccountid: '../other', intuitentityid: '1' }]), trust('QB_INVALID_ID', 400));
  assert.throws(() => parseQbWebhook(new Array(1001).fill({})), trust('QB_INVALID_WEBHOOK', 400));
});

test('company/resource IDs and environment reject unsafe routing values', () => {
  for (const id of ['', '0', '../1', '123?realm=456', ' 123', 123, '1'.repeat(51)]) {
    assert.throws(() => requireQbId(id), trust('QB_INVALID_ID', 400));
  }
  assert.equal(getQbBase({}), 'https://sandbox-quickbooks.api.intuit.com');
  assert.equal(getQbBase({ QB_ENV: 'production' }), 'https://quickbooks.api.intuit.com');
  assert.throws(() => getQbBase({ QB_ENV: 'prod' }), trust('QB_INVALID_ENVIRONMENT'));
});

test('realm routing rejects unknown, duplicate and cross-tenant company bindings', async () => {
  await assert.rejects(() => connectionForRealm(fakeDb([]).db, '123'), trust('QB_UNKNOWN_REALM', 404));
  await assert.rejects(() => connectionForRealm(fakeDb([connection, { ...connection, id: 'b', orgId: 'org-b' }]).db, '123'), trust('QB_AMBIGUOUS_REALM', 409));
  await assert.rejects(() => connectionForOrg(fakeDb().db, 'org-b'), trust('QB_NOT_CONNECTED', 409));
  await assert.rejects(() => connectionForOrg(fakeDb().db, 'org-a', '999'), trust('QB_REALM_MISMATCH', 409));
  const fixture = fakeDb();
  assert.equal((await connectionForOrg(fixture.db, 'org-a', '123')).id, connection.id);
  assert.deepEqual(fixture.filters.map((row) => row.params), [['org-a'], ['123']]);
});

test('direct Payment read parses Payment, not QueryResponse, and includes every linked invoice', () => {
  const Payment = { Id: '456', TotalAmt: 150, Line: [
    { Amount: 100, LinkedTxn: [{ TxnId: '10', TxnType: 'Invoice' }, { TxnId: '11', TxnType: 'CreditMemo' }] },
    { Amount: 50, LinkedTxn: [{ TxnId: '12', TxnType: 'Invoice' }, { TxnId: '10', TxnType: 'Invoice' }] },
  ] };
  assert.deepEqual(parseQBPaymentResponse({ Payment }, '456'), { payment: Payment, invoiceIds: ['10', '12'] });
  assert.deepEqual(parseQBPaymentResponse({ Payment: { Id: '456', TotalAmt: 15 } }, '456').invoiceIds, []);
  assert.throws(() => parseQBPaymentResponse({ QueryResponse: { Payment: [Payment] } }, '456'), trust('QB_INVALID_PAYMENT'));
  assert.throws(() => parseQBPaymentResponse({ Payment }, '999'), trust('QB_INVALID_PAYMENT'));
  assert.throws(() => parseQBPaymentResponse({ Payment: { Id: '456', TotalAmt: -1 } }, '456'), trust('QB_INVALID_PAYMENT'));
  assert.throws(() => parseQBPaymentResponse({ Payment: { Id: '456', TotalAmt: 15, Line: [{ LinkedTxn: {} }] } }, '456'), trust('QB_INVALID_PAYMENT'));
});

test('read Payment uses the tenant company and configured sandbox, never production by default', async () => {
  const fixture = fakeDb();
  const calls: string[] = [];
  const request = async (url: any, init: any) => {
    calls.push(String(url));
    assert.equal(init.headers.Authorization, 'Bearer access-a');
    return Response.json({ Payment: { Id: '456', TotalAmt: 20 } });
  };
  assert.deepEqual((await readQBPayment(env, 'org-a', '123', '456', { db: fixture.db, request: request as any, now: () => now })).invoiceIds, []);
  assert.deepEqual(calls, ['https://sandbox-quickbooks.api.intuit.com/v3/company/123/payment/456']);
  await assert.rejects(() => readQBPayment(env, 'org-a', '999', '456', { db: fixture.db, request: request as any }), trust('QB_REALM_MISMATCH'));
  assert.equal(calls.length, 1);
  assert.equal(fixture.writes, 0);
});

test('refresh update scopes tenant, company, connection and previous refresh token', async () => {
  const fixture = fakeDb([{ ...connection, tokenExpiresAt: new Date(now - 1) }]);
  let calls = 0;
  const request = async (url: any, init: any) => {
    calls++;
    assert.equal(String(url), 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer');
    assert.equal(init.body.get('refresh_token'), 'refresh-a');
    return Response.json({ access_token: 'access-new', refresh_token: 'refresh-new', expires_in: 3600 });
  };
  assert.equal(await getValidAccessToken(env, 'org-a', { db: fixture.db, request: request as any, now: () => now }), 'access-new');
  assert.equal(calls, 1);
  const update = fixture.filters.find((row) => row.method === 'update')!;
  assert.deepEqual(update.params, ['connection-a', 'org-a', '123', 'refresh-a']);
  assert.match(update.text, /"org_id"/);
  assert.match(update.text, /"realm_id"/);
  assert.match(update.text, /"refresh_token"/);
});

test('refresh conflict fails instead of overwriting a reconnect; invalid expiration forces refresh', async () => {
  const fixture = fakeDb([{ ...connection, tokenExpiresAt: 'invalid-date' }], []);
  await assert.rejects(() => getValidAccessToken(env, 'org-a', { db: fixture.db, now: () => now,
    request: (async () => Response.json({ access_token: 'new', refresh_token: 'next', expires_in: 3600 })) as any }), trust('QB_CONNECTION_CHANGED', 409));
});

test('invalid or rejected token responses never persist and do not expose provider secrets', async () => {
  for (const tokens of [{}, { access_token: 'a', refresh_token: 'b', expires_in: 0 }, { access_token: 'a', refresh_token: '', expires_in: 3600 }]) {
    assert.throws(() => validateQbTokens(tokens), trust('QB_INVALID_TOKENS'));
  }
  const fixture = fakeDb([{ ...connection, tokenExpiresAt: new Date(0) }]);
  await assert.rejects(() => getValidAccessToken(env, 'org-a', { db: fixture.db,
    request: (async () => new Response('secret-provider-token', { status: 400 })) as any }), (error: any) => {
    assert.equal(error.code, 'QB_AUTHORIZATION_FAILED');
    assert.equal(error.message.includes('secret-provider-token'), false);
    return true;
  });
  assert.equal(fixture.writes, 0);
});

test('CompanyInfo is fetched from the requested realm without assuming its entity ID equals the realm', async () => {
  const company = await getCompanyInfo(env, 'synthetic-token', '123', (async (url: any) => {
    assert.equal(String(url), 'https://sandbox-quickbooks.api.intuit.com/v3/company/123/companyinfo/123');
    return Response.json({ CompanyInfo: { Id: '1', CompanyName: 'Synthetic company' } });
  }) as any);
  assert.equal(company.CompanyInfo.Id, '1');
});

test('legacy customer/invoice/payment exports stop before any database or provider access', async () => {
  const inaccessible = new Proxy({}, { get() { assert.fail('Legacy export accessed credentials'); } }) as any;
  await assert.rejects(() => createQBCustomer(inaccessible, 'org-a', {}), trust('QB_EXPORT_NOT_READY', 409));
  await assert.rejects(() => createQBInvoice(inaccessible, 'org-a', { packages: [{ total: 200 }, { total: 400 }] }, {}), trust('QB_EXPORT_NOT_READY', 409));
  await assert.rejects(() => createQBPayment(inaccessible, 'org-a', {}, 10, '2026-10-01'), trust('QB_EXPORT_NOT_READY', 409));
});
