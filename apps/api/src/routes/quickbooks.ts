import { Hono, type MiddlewareHandler } from 'hono';
import { createDb } from '@crewmodo/db';
import { quickbooksConnections, orgSettings, memberships, userRoles, leads, estimates } from '@crewmodo/db/schema';
import { and, eq, isNotNull, or, sql } from 'drizzle-orm';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';
import { createOAuthState, consumeOAuthState } from '../auth';
import { connectionForOrg, connectionForRealm, denyLegacyQbExport, getCompanyInfo, getTaxCodes, getItems,
  parseQbWebhook, QuickBooksTrustError, requestQbTokens, requireQbId, verifyQbWebhook } from '../lib/quickbooks';

type Db = ReturnType<typeof createDb>;
type App = { Bindings: Env; Variables: Variables };
type Dependencies = {
  db: (url: string) => Db;
  request: typeof fetch;
  authenticate: MiddlewareHandler<App>;
  createState: typeof createOAuthState;
  consumeState: typeof consumeOAuthState;
};

export async function canManageQuickBooks(db: Db, orgId: string, userId: string): Promise<boolean> {
  if (!orgId || !userId) return false;
  const membership = await db.query.memberships.findFirst({
    where: and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)),
  });
  if (!membership || membership.orgId !== orgId || membership.userId !== userId) return false;
  if (membership.role === 'owner') return true;
  const assigned = await db.query.userRoles.findMany({
    where: and(eq(userRoles.orgId, orgId), eq(userRoles.userId, userId)), with: { role: true },
  });
  return assigned.some((assignment) => {
    const role = assignment.role;
    return assignment.orgId === orgId && assignment.userId === userId && role?.orgId === orgId
      && Array.isArray(role.permissions) && role.permissions.some((permission) => ['*', 'all', 'manage_settings'].includes(String(permission)));
  });
}

export function quickBooksSettingsRedirect(publicUrl: string, status: string): string {
  const url = new URL('/settings', publicUrl);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new QuickBooksTrustError('QB_INVALID_RETURN_URL', 'QuickBooks return URL is not configured.');
  }
  url.searchParams.set('qb_status', status);
  if (status === 'connected') url.searchParams.set('qb_connected', 'true');
  return url.toString();
}

async function assertSafeAttachment(db: Db, orgId: string, realmId: string) {
  const attached = await db.query.quickbooksConnections.findMany({ where: eq(quickbooksConnections.realmId, realmId), limit: 2 });
  const existing = await db.query.quickbooksConnections.findFirst({ where: eq(quickbooksConnections.orgId, orgId) });
  if (attached.length > 1 || attached.some((connection) => connection.orgId !== orgId)) {
    throw new QuickBooksTrustError('QB_COMPANY_ALREADY_ATTACHED', 'This QuickBooks company is already attached to another organization.', 409);
  }
  if (existing && existing.realmId !== realmId) {
    throw new QuickBooksTrustError('QB_COMPANY_SWITCH_REQUIRES_REVIEW', 'Disconnecting or changing accounting companies requires mapping review.', 409);
  }
  if (existing) {
    await connectionForOrg(db, orgId, realmId);
    return existing;
  }
  // Preflight alone cannot prevent concurrent attachments. Require a database invariant before inserting.
  const result = await db.execute(sql`select exists (
    select 1 from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
    where i.indrelid = to_regclass('quickbooks_connections') and i.indisunique and i.indisvalid
      and i.indpred is null and i.indexprs is null and i.indnkeyatts = 1 and a.attname = 'realm_id'
  ) as unique_realm`);
  const rows = Array.isArray(result) ? result : (result as any).rows;
  if (rows?.[0]?.unique_realm !== true) {
    throw new QuickBooksTrustError('QB_REALM_CONSTRAINT_REQUIRED', 'QuickBooks connection requires a database safety update. Contact support.');
  }
  const staleCustomer = await db.query.leads.findFirst({ where: and(eq(leads.orgId, orgId), isNotNull(leads.qboCustomerId)), columns: { id: true } });
  const staleInvoice = await db.query.estimates.findFirst({ where: and(eq(estimates.orgId, orgId),
    or(isNotNull(estimates.qboInvoiceId), isNotNull(estimates.qboPaymentId))), columns: { id: true } });
  const mappings = await db.query.orgSettings.findFirst({ where: eq(orgSettings.orgId, orgId) });
  if (staleCustomer || staleInvoice || mappings?.qbItemId || mappings?.qbTaxCode) {
    throw new QuickBooksTrustError('QB_RECONNECT_REQUIRES_REVIEW', 'Previous QuickBooks mappings require review before reconnecting.', 409);
  }
  return undefined;
}

async function boundedWebhookBody(request: Request): Promise<ArrayBuffer> {
  const maximum = 256 * 1024;
  if (Number(request.headers.get('content-length')) > maximum) {
    throw new QuickBooksTrustError('QB_WEBHOOK_TOO_LARGE', 'QuickBooks webhook is too large.', 400);
  }
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maximum) {
          await reader.cancel();
          throw new QuickBooksTrustError('QB_WEBHOOK_TOO_LARGE', 'QuickBooks webhook is too large.', 400);
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes.buffer;
}

// Explicit dependencies let unit tests exercise real Hono middleware without any provider/database traffic.
export function createQuickBooksRoutes(overrides: Partial<Dependencies> = {}) {
  const deps: Dependencies = { db: createDb, request: fetch, authenticate: authMiddleware,
    createState: createOAuthState, consumeState: consumeOAuthState, ...overrides };
  const qb = new Hono<App>();
  qb.onError((error, c) => {
    if (error instanceof QuickBooksTrustError) return c.json({ error: error.message, code: error.code }, error.status);
    return c.json({ error: 'QuickBooks is temporarily unavailable. Retry later.', code: 'QB_UNAVAILABLE' }, 503);
  });
  const manage: MiddlewareHandler<App> = async (c, next) => {
    if (!await canManageQuickBooks(deps.db(c.env.DATABASE_URL), c.get('orgId'), c.get('userId'))) {
      return c.json({ error: 'You do not have permission to manage QuickBooks.', code: 'QB_FORBIDDEN' }, 403);
    }
    await next();
  };
  for (const path of ['/connect', '/status', '/sync/*', '/disconnect', '/tax-codes', '/items', '/settings']) {
    qb.use(path, deps.authenticate, manage);
  }

  qb.get('/connect', async (c) => {
    if (!c.env.QB_CLIENT_ID || !c.env.QB_CLIENT_SECRET) throw new QuickBooksTrustError('QB_NOT_CONFIGURED', 'QuickBooks authorization is not configured.');
    const state = await deps.createState(c.env, 'quickbooks', c.get('orgId'), c.get('userId'));
    const url = new URL('https://appcenter.intuit.com/connect/oauth2');
    url.search = new URLSearchParams({ client_id: c.env.QB_CLIENT_ID, scope: 'com.intuit.quickbooks.accounting',
      redirect_uri: `${c.env.APP_URL}/v1/quickbooks/callback`, response_type: 'code', state }).toString();
    return c.redirect(url.toString());
  });

  qb.get('/callback', async (c) => {
    const finish = (status: string) => c.redirect(quickBooksSettingsRedirect(c.env.PUBLIC_URL, status));
    const state = c.req.query('state');
    if (!state || state.length > 255) return finish('invalid_state');
    const stateData = await deps.consumeState(c.env, 'quickbooks', state);
    if (!stateData?.orgId || !stateData.userId) return finish('invalid_state');
    const error = c.req.query('error');
    if (error) return finish(error === 'access_denied' ? 'canceled' : 'authorization_failed');
    const code = c.req.query('code');
    const realmId = c.req.query('realmId');
    if (!code || code.length > 4096 || !realmId) return finish('invalid_response');
    requireQbId(realmId);
    const db = deps.db(c.env.DATABASE_URL);
    if (!await canManageQuickBooks(db, stateData.orgId, stateData.userId)) return finish('forbidden');
    const existing = await assertSafeAttachment(db, stateData.orgId, realmId);
    const tokens = await requestQbTokens(c.env, new URLSearchParams({ grant_type: 'authorization_code', code,
      redirect_uri: `${c.env.APP_URL}/v1/quickbooks/callback` }), deps.request);
    const company = await getCompanyInfo(c.env, tokens.access_token, realmId, deps.request);
    if (!await canManageQuickBooks(db, stateData.orgId, stateData.userId)) return finish('forbidden');
    const current = await assertSafeAttachment(db, stateData.orgId, realmId);
    if (current?.id !== existing?.id) throw new QuickBooksTrustError('QB_CONNECTION_CHANGED', 'QuickBooks connection changed. Retry from Settings.', 409);
    const values = { accessToken: tokens.access_token, refreshToken: tokens.refresh_token,
      tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000), companyName: company.CompanyInfo.CompanyName, updatedAt: new Date() };
    const saved = existing
      ? await db.update(quickbooksConnections).set(values).where(and(eq(quickbooksConnections.id, existing.id),
        eq(quickbooksConnections.orgId, stateData.orgId), eq(quickbooksConnections.realmId, realmId),
        eq(quickbooksConnections.refreshToken, existing.refreshToken))).returning({ id: quickbooksConnections.id })
      : await db.insert(quickbooksConnections).values({ orgId: stateData.orgId, realmId, ...values })
        .onConflictDoNothing().returning({ id: quickbooksConnections.id });
    if (saved.length !== 1) throw new QuickBooksTrustError('QB_CONNECTION_CHANGED', 'QuickBooks company attachment changed. Retry from Settings.', 409);
    return finish('connected');
  });

  qb.get('/status', async (c) => {
    const db = deps.db(c.env.DATABASE_URL);
    const existing = await db.query.quickbooksConnections.findFirst({ where: eq(quickbooksConnections.orgId, c.get('orgId')) });
    if (!existing) return c.json({ connected: false, exportReady: false });
    const connection = await connectionForOrg(db, c.get('orgId'));
    return c.json({ connected: true, companyName: connection.companyName, connectedAt: connection.connectedAt, exportReady: false });
  });
  qb.get('/tax-codes', async (c) => c.json({ data: await getTaxCodes(c.env, c.get('orgId'), { db: deps.db(c.env.DATABASE_URL), request: deps.request }) }));
  qb.get('/items', async (c) => c.json({ data: await getItems(c.env, c.get('orgId'), { db: deps.db(c.env.DATABASE_URL), request: deps.request }) }));
  qb.get('/settings', async (c) => {
    const settings = await deps.db(c.env.DATABASE_URL).query.orgSettings.findFirst({ where: eq(orgSettings.orgId, c.get('orgId')) });
    return c.json({ data: { qbTaxCode: settings?.qbTaxCode ?? null, qbItemId: settings?.qbItemId ?? null }, exportReady: false });
  });
  qb.put('/settings', async (c) => {
    let body: any;
    try { body = await c.req.json(); } catch { throw new QuickBooksTrustError('QB_INVALID_SETTINGS', 'Enter valid QuickBooks mappings.', 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body) || !Object.hasOwn(body, 'qbItemId') || !Object.hasOwn(body, 'qbTaxCode')) {
      throw new QuickBooksTrustError('QB_INVALID_SETTINGS', 'Select a QuickBooks service item and tax code.', 400);
    }
    const itemId = body.qbItemId === null ? null : requireQbId(body.qbItemId);
    const taxCode = body.qbTaxCode === null ? null : body.qbTaxCode;
    if (taxCode !== null && (typeof taxCode !== 'string' || !/^[A-Za-z0-9_-]{1,50}$/.test(taxCode))) {
      throw new QuickBooksTrustError('QB_INVALID_TAX_MAPPING', 'Select a valid QuickBooks tax code.', 400);
    }
    const db = deps.db(c.env.DATABASE_URL);
    const orgId = c.get('orgId');
    const connection = await connectionForOrg(db, orgId);
    const reads = { db, request: deps.request };
    if (itemId && !(await getItems(c.env, orgId, reads)).some((item: any) => item.Id === itemId && item.Active === true && item.Type === 'Service')) {
      throw new QuickBooksTrustError('QB_INVALID_ITEM_MAPPING', 'Select an active service item from the connected company.', 400);
    }
    if (taxCode && !(await getTaxCodes(c.env, orgId, reads)).some((tax: any) => tax.Id === taxCode && tax.Active === true)) {
      throw new QuickBooksTrustError('QB_INVALID_TAX_MAPPING', 'Select an active tax code from the connected company.', 400);
    }
    const current = await connectionForOrg(db, orgId, connection.realmId);
    if (current.id !== connection.id) throw new QuickBooksTrustError('QB_CONNECTION_CHANGED', 'QuickBooks connection changed. Retry.', 409);
    await db.insert(orgSettings).values({ orgId, qbItemId: itemId, qbTaxCode: taxCode }).onConflictDoUpdate({
      target: orgSettings.orgId, set: { qbItemId: itemId, qbTaxCode: taxCode, updatedAt: new Date() },
    });
    return c.json({ data: { qbItemId: itemId, qbTaxCode: taxCode }, exportReady: false });
  });
  qb.post('/sync/customer/:leadId', () => denyLegacyQbExport());
  qb.post('/sync/invoice/:estimateId', () => denyLegacyQbExport());
  qb.post('/disconnect', async (c) => {
    const db = deps.db(c.env.DATABASE_URL);
    const orgId = c.get('orgId');
    const existing = await db.query.quickbooksConnections.findFirst({ where: eq(quickbooksConnections.orgId, orgId) });
    if (existing) {
      const connection = await connectionForOrg(db, orgId);
      await db.delete(quickbooksConnections).where(and(eq(quickbooksConnections.id, connection.id),
        eq(quickbooksConnections.orgId, orgId), eq(quickbooksConnections.realmId, connection.realmId)));
    }
    return c.json({ success: true, authorizationRevoked: false });
  });
  qb.post('/webhook', async (c) => {
    // Fail closed before reading/parsing data if no verifier is deployed.
    if (!c.env.QB_WEBHOOK_VERIFIER_TOKEN?.trim()) throw new QuickBooksTrustError('QB_WEBHOOK_NOT_CONFIGURED', 'QuickBooks webhook verification is not configured.');
    const raw = await boundedWebhookBody(c.req.raw);
    if (!await verifyQbWebhook(raw, c.req.header('intuit-signature'), c.env.QB_WEBHOOK_VERIFIER_TOKEN)) {
      return c.json({ error: 'Invalid QuickBooks webhook signature.', code: 'QB_INVALID_SIGNATURE' }, 401);
    }
    let body: unknown;
    try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); }
    catch { throw new QuickBooksTrustError('QB_INVALID_WEBHOOK', 'Invalid QuickBooks webhook payload.', 400); }
    const events = parseQbWebhook(body);
    if (!events.length) return c.json({ received: true });
    const db = deps.db(c.env.DATABASE_URL);
    for (const realm of new Set(events.map((event) => event.realmId))) await connectionForRealm(db, realm);
    // No durable inbox or current-invoice mappings exist yet. Never acknowledge lost events or sign a proposal from a payment.
    throw new QuickBooksTrustError('QB_RECONCILIATION_NOT_READY', 'QuickBooks event reconciliation is not available yet.');
  });
  return qb;
}

export const quickbooksRoutes = createQuickBooksRoutes();
export default quickbooksRoutes;
