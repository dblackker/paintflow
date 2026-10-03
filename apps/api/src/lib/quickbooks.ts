import { createDb } from '@crewmodo/db';
import { quickbooksConnections } from '@crewmodo/db/schema';
import { and, eq } from 'drizzle-orm';

export const QB_SANDBOX_BASE = 'https://sandbox-quickbooks.api.intuit.com';
export const QB_PROD_BASE = 'https://quickbooks.api.intuit.com';
export const QB_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
type Db = ReturnType<typeof createDb>;
type Connection = typeof quickbooksConnections.$inferSelect;
export type QbDependencies = { db?: Db; request?: typeof fetch; now?: () => number };
type QbEnv = { DATABASE_URL: string; QB_CLIENT_ID: string; QB_CLIENT_SECRET: string; QB_ENV?: string };

export class QuickBooksTrustError extends Error {
  constructor(public code: string, message: string, public status: 400 | 401 | 403 | 404 | 409 | 503 = 503) {
    super(message);
    this.name = 'QuickBooksTrustError';
  }
}

export function requireQbId(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9]\d{0,49}$/.test(value)) {
    throw new QuickBooksTrustError('QB_INVALID_ID', 'Invalid QuickBooks company or resource ID.', 400);
  }
  return value;
}

export function getQbBase(env: { QB_ENV?: string }): string {
  if (env.QB_ENV && env.QB_ENV !== 'production' && env.QB_ENV !== 'sandbox') {
    throw new QuickBooksTrustError('QB_INVALID_ENVIRONMENT', 'QuickBooks environment is not configured correctly.');
  }
  return env.QB_ENV === 'production' ? QB_PROD_BASE : QB_SANDBOX_BASE;
}

export async function connectionForRealm(db: Db, realmId: string): Promise<Connection> {
  requireQbId(realmId);
  const rows = await db.query.quickbooksConnections.findMany({
    where: eq(quickbooksConnections.realmId, realmId), limit: 2,
  });
  if (!rows.length) throw new QuickBooksTrustError('QB_UNKNOWN_REALM', 'QuickBooks company is not connected.', 404);
  if (rows.length !== 1) throw new QuickBooksTrustError('QB_AMBIGUOUS_REALM', 'QuickBooks company connection needs administrator review.', 409);
  return rows[0];
}

export async function connectionForOrg(db: Db, orgId: string, expectedRealm?: string): Promise<Connection> {
  if (!orgId) throw new QuickBooksTrustError('QB_TENANT_REQUIRED', 'Organization is required.', 403);
  const connection = await db.query.quickbooksConnections.findFirst({ where: eq(quickbooksConnections.orgId, orgId) });
  if (!connection) throw new QuickBooksTrustError('QB_NOT_CONNECTED', 'Connect QuickBooks first.', 409);
  if (connection.orgId !== orgId || (expectedRealm !== undefined && connection.realmId !== expectedRealm)) {
    throw new QuickBooksTrustError('QB_REALM_MISMATCH', 'QuickBooks company does not match this organization.', 409);
  }
  const routed = await connectionForRealm(db, connection.realmId);
  if (routed.id !== connection.id || routed.orgId !== orgId) {
    throw new QuickBooksTrustError('QB_REALM_MISMATCH', 'QuickBooks company does not match this organization.', 409);
  }
  return connection;
}

export function validateQbTokens(value: unknown) {
  const tokens = value as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown } | null;
  if (!tokens || typeof tokens.access_token !== 'string' || !tokens.access_token.trim()
    || typeof tokens.refresh_token !== 'string' || !tokens.refresh_token.trim()
    || typeof tokens.expires_in !== 'number' || !Number.isInteger(tokens.expires_in)
    || tokens.expires_in <= 0 || tokens.expires_in > 86400) {
    throw new QuickBooksTrustError('QB_INVALID_TOKENS', 'QuickBooks returned an invalid authorization response.');
  }
  return { access_token: tokens.access_token, refresh_token: tokens.refresh_token, expires_in: tokens.expires_in };
}

export async function requestQbTokens(env: QbEnv, body: URLSearchParams, request: typeof fetch = fetch) {
  if (!env.QB_CLIENT_ID || !env.QB_CLIENT_SECRET) {
    throw new QuickBooksTrustError('QB_NOT_CONFIGURED', 'QuickBooks authorization is not configured.');
  }
  const response = await request(QB_TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + btoa(`${env.QB_CLIENT_ID}:${env.QB_CLIENT_SECRET}`),
      'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body, signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new QuickBooksTrustError('QB_AUTHORIZATION_FAILED', 'QuickBooks authorization failed. Reconnect from Settings.');
  return validateQbTokens(await response.json());
}

export async function refreshAccessToken(env: QbEnv, refreshToken: string, request: typeof fetch = fetch) {
  return requestQbTokens(env, new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }), request);
}

export async function getValidAccessToken(env: QbEnv, orgId: string, deps: QbDependencies = {}, expectedRealm?: string): Promise<string> {
  const db = deps.db ?? createDb(env.DATABASE_URL);
  const connection = await connectionForOrg(db, orgId, expectedRealm);
  const now = (deps.now ?? Date.now)();
  const expiresAt = new Date(connection.tokenExpiresAt).getTime();
  if (Number.isFinite(expiresAt) && expiresAt - now >= 5 * 60 * 1000 && connection.accessToken) return connection.accessToken;
  const tokens = await refreshAccessToken(env, connection.refreshToken, deps.request);
  // A concurrent refresh/reconnect must not be overwritten with stale credentials.
  const updated = await db.update(quickbooksConnections).set({
    accessToken: tokens.access_token, refreshToken: tokens.refresh_token,
    tokenExpiresAt: new Date(now + tokens.expires_in * 1000), updatedAt: new Date(now),
  }).where(and(eq(quickbooksConnections.id, connection.id), eq(quickbooksConnections.orgId, orgId),
    eq(quickbooksConnections.realmId, connection.realmId), eq(quickbooksConnections.refreshToken, connection.refreshToken)))
    .returning({ id: quickbooksConnections.id });
  if (updated.length !== 1) throw new QuickBooksTrustError('QB_CONNECTION_CHANGED', 'QuickBooks connection changed. Retry the request.', 409);
  return tokens.access_token;
}

async function readQbResource(env: QbEnv, orgId: string, path: string, deps: QbDependencies = {}, expectedRealm?: string) {
  const db = deps.db ?? createDb(env.DATABASE_URL);
  const connection = await connectionForOrg(db, orgId, expectedRealm);
  const token = await getValidAccessToken(env, orgId, { ...deps, db }, connection.realmId);
  const response = await (deps.request ?? fetch)(`${getQbBase(env)}/v3/company/${connection.realmId}/${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new QuickBooksTrustError('QB_READ_FAILED', 'QuickBooks could not be reached. Retry later.');
  // Recheck after the external read; a disconnected/switched company is not trusted.
  const current = await connectionForOrg(db, orgId, connection.realmId);
  if (current.id !== connection.id) throw new QuickBooksTrustError('QB_CONNECTION_CHANGED', 'QuickBooks connection changed. Retry the request.', 409);
  return await response.json() as any;
}

export function parseQBPaymentResponse(body: unknown, expectedId: string) {
  requireQbId(expectedId);
  const payment = (body as any)?.Payment;
  if (!payment || payment.Id !== expectedId || !Number.isFinite(payment.TotalAmt) || payment.TotalAmt < 0
    || (payment.Line !== undefined && !Array.isArray(payment.Line))) {
    throw new QuickBooksTrustError('QB_INVALID_PAYMENT', 'QuickBooks returned an invalid payment response.');
  }
  const invoiceIds = new Set<string>();
  for (const line of payment.Line ?? []) {
    if (!line || typeof line !== 'object' || Array.isArray(line)
      || (line.LinkedTxn !== undefined && !Array.isArray(line.LinkedTxn))) {
      throw new QuickBooksTrustError('QB_INVALID_PAYMENT', 'QuickBooks returned invalid payment allocations.');
    }
    for (const linked of line.LinkedTxn ?? []) {
      if (!linked || typeof linked !== 'object' || typeof linked.TxnType !== 'string') {
        throw new QuickBooksTrustError('QB_INVALID_PAYMENT', 'QuickBooks returned invalid payment allocations.');
      }
      if (linked.TxnType === 'Invoice') invoiceIds.add(requireQbId(linked.TxnId));
    }
  }
  return { payment, invoiceIds: [...invoiceIds] };
}

export async function readQBPayment(env: QbEnv, orgId: string, realmId: string, paymentId: string, deps: QbDependencies = {}) {
  requireQbId(realmId);
  requireQbId(paymentId);
  return parseQBPaymentResponse(await readQbResource(env, orgId, `payment/${paymentId}`, deps, realmId), paymentId);
}

export async function getCompanyInfo(env: QbEnv, accessToken: string, realmId: string, request: typeof fetch = fetch) {
  requireQbId(realmId);
  const response = await request(`${getQbBase(env)}/v3/company/${realmId}/companyinfo/${realmId}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }, signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new QuickBooksTrustError('QB_COMPANY_READ_FAILED', 'QuickBooks company could not be verified.');
  const body = await response.json() as any;
  const name = body?.CompanyInfo?.CompanyName;
  if (typeof name !== 'string' || !name.trim() || name.length > 255) {
    throw new QuickBooksTrustError('QB_INVALID_COMPANY', 'QuickBooks company information needs administrator review.');
  }
  return body;
}

export async function getTaxCodes(env: QbEnv, orgId: string, deps: QbDependencies = {}) {
  const body = await readQbResource(env, orgId, `query?query=${encodeURIComponent('SELECT * FROM TaxCode WHERE Active = true MAXRESULTS 1000')}`, deps);
  return body.QueryResponse?.TaxCode ?? [];
}

export async function getItems(env: QbEnv, orgId: string, deps: QbDependencies = {}) {
  const body = await readQbResource(env, orgId, `query?query=${encodeURIComponent("SELECT * FROM Item WHERE Active = true AND Type = 'Service' MAXRESULTS 1000")}`, deps);
  return body.QueryResponse?.Item ?? [];
}

export function denyLegacyQbExport(): never {
  throw new QuickBooksTrustError('QB_EXPORT_NOT_READY', 'QuickBooks export is unavailable until invoice, customer, item and tax mappings are configured safely.', 409);
}

// Preserve existing consumers, but never post proposal packages or guess accounting mappings.
export async function createQBCustomer(_env: QbEnv, _orgId: string, _lead: any): Promise<string> { return denyLegacyQbExport(); }
export async function createQBInvoice(_env: QbEnv, _orgId: string, _estimate: any, _lead: any): Promise<string> { return denyLegacyQbExport(); }
export async function createQBPayment(_env: QbEnv, _orgId: string, _estimate: any, _amount: number, _paymentDate: string): Promise<string> { return denyLegacyQbExport(); }

export async function verifyQbWebhook(raw: ArrayBuffer, signature: string | undefined, verifier: string | undefined): Promise<boolean> {
  if (!verifier?.trim()) throw new QuickBooksTrustError('QB_WEBHOOK_NOT_CONFIGURED', 'QuickBooks webhook verification is not configured.');
  if (!signature || !/^[A-Za-z0-9+/]{43}=$/.test(signature)) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(verifier), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const bytes = Uint8Array.from(atob(signature), (character) => character.charCodeAt(0));
  return crypto.subtle.verify('HMAC', key, bytes, raw);
}

export type QbEvent = { realmId: string; entityId: string; entity: string; operation: string; eventId?: string };
export function parseQbWebhook(body: unknown): QbEvent[] {
  const events: QbEvent[] = [];
  const invalid = () => { throw new QuickBooksTrustError('QB_INVALID_WEBHOOK', 'Invalid QuickBooks webhook payload.', 400); };
  if (Array.isArray(body)) {
    if (body.length > 1000) invalid();
    for (const event of body) {
      const parts = typeof event?.type === 'string' ? /^qbo\.([a-z]+)\.([a-z]+)\.v\d+$/.exec(event.type) : null;
      if (!parts || event.specversion !== '1.0' || typeof event.id !== 'string' || !event.id || event.id.length > 255) invalid();
      events.push({ realmId: requireQbId(event.intuitaccountid), entityId: requireQbId(event.intuitentityid),
        entity: parts![1], operation: parts![2], eventId: event.id });
    }
  } else {
    const notifications = (body as any)?.eventNotifications;
    if (!Array.isArray(notifications) || notifications.length > 1000) invalid();
    for (const notification of notifications) {
      const realmId = requireQbId(notification?.realmId);
      const entities = notification?.dataChangeEvent?.entities;
      if (!Array.isArray(entities)) invalid();
      for (const entity of entities) {
        if (typeof entity?.name !== 'string' || !/^[A-Za-z]{1,50}$/.test(entity.name)
          || typeof entity.operation !== 'string' || !/^[A-Za-z]{1,50}$/.test(entity.operation)) invalid();
        events.push({ realmId, entityId: requireQbId(entity.id), entity: entity.name.toLowerCase(), operation: entity.operation.toLowerCase() });
        if (events.length > 1000) invalid();
      }
    }
  }
  return events;
}
