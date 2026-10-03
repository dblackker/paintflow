import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePlanCapabilities } from '../../packages/core/src/plans.ts';
import { requireFeatureAccess } from '../../apps/api/src/middleware/feature-access.ts';
import type { Env } from '../../apps/api/src/types.ts';

const now = new Date('2026-10-03T12:00:00.000Z');

type FeatureContext = Parameters<ReturnType<typeof requireFeatureAccess>>[0];

function contextFor(authenticated = true, env = {} as Env) {
  const values = authenticated ? {
    userId: 'synthetic-user', orgId: 'synthetic-org',
    session: { userId: 'synthetic-user', orgId: 'synthetic-org' },
    permissions: ['log_own_time'],
  } : {};
  return {
    env,
    get: (key: string) => values[key],
    json: (body: unknown, status: number) => Response.json(body, { status }),
  } as FeatureContext;
}

function guardFor(plan: string, status: string) {
  let calls = 0;
  const guard = requireFeatureAccess('ocrInvoiceImport', async () => {
    calls += 1;
    return resolvePlanCapabilities({ plan, status, currentPeriodEnd: '2026-11-03T12:00:00.000Z', now });
  });
  return { guard, calls: () => calls };
}

test('feature middleware allows Growth OCR after authenticated context exists', async () => {
  const { guard, calls } = guardFor('pro', 'trial');
  let nextCalls = 0;
  const response = await guard(contextFor(), async () => { nextCalls += 1; });
  assert.equal(response, undefined);
  assert.equal(nextCalls, 1);
  assert.equal(calls(), 1);
});

test('feature middleware fails closed for Starter and incomplete subscriptions', async () => {
  for (const [plan, status, code] of [
    ['starter', 'active', 'FEATURE_NOT_INCLUDED'],
    ['pro', 'trial_pending_payment', 'SUBSCRIPTION_INACTIVE'],
    ['typo', 'active', 'UNKNOWN_PLAN'],
  ]) {
    const { guard } = guardFor(plan, status);
    let nextCalls = 0;
    const response = await guard(contextFor(), async () => { nextCalls += 1; }) as Response;
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.code, code);
    assert.equal(body.feature, 'ocrInvoiceImport');
    assert.equal(body.ok, undefined);
    assert.equal(nextCalls, 0);
  }
});

test('environment or invoice-automation flags never grant sessionless feature access', async () => {
  const { guard, calls } = guardFor('pro', 'active');
  const context = contextFor(false, {
    ENVIRONMENT: 'development', INVOICE_AUTOMATION_ENABLED: 'true',
  } as Env);
  const response = await guard(context, async () => assert.fail('Sessionless requests cannot continue.')) as Response;
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, 'NO_SESSION');
  assert.equal(calls(), 0);
});

test('partial auth context never reaches the subscription lookup', async () => {
  for (const missing of ['orgId', 'userId', 'session']) {
    const context = contextFor();
    const get = context.get;
    context.get = ((key: string) => key === missing ? undefined : get(key as never)) as typeof context.get;
    const { guard, calls } = guardFor('pro', 'active');
    const response = await guard(context, async () => assert.fail('Partial authentication cannot continue.')) as Response;
    assert.equal(response.status, 401);
    assert.equal(calls(), 0);
  }
});

test('subscription lookup failure blocks the handler with a safe retryable service response', async () => {
  const guard = requireFeatureAccess('ocrInvoiceImport', async () => { throw new Error('private database connection'); });
  const response = await guard(contextFor(), async () => assert.fail('An unverified subscription cannot continue.')) as Response;
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: 'Subscription access could not be checked. Try again.', code: 'ENTITLEMENTS_UNAVAILABLE',
  });
});

test('feature access alone allows an entitled field user; the route must separately enforce RBAC', async () => {
  const context = contextFor();
  const { guard } = guardFor('pro', 'active');
  let authorized = false;
  let nextCalls = 0;
  await guard(context, async () => {
    nextCalls += 1;
    authorized = Boolean(context.get('permissions')?.includes('manage_settings'));
  });
  assert.equal(nextCalls, 1);
  assert.equal(authorized, false);
  assert.deepEqual(context.get('permissions'), ['log_own_time']);
});
