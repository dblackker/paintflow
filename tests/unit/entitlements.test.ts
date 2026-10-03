import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PLAN_DEFINITIONS,
  checkCapability,
  checkPlanLimit,
  hasPlanFeature,
  normalizePlanKey,
  parsePlanKey,
  planFeaturesPayload,
  resolvePlanCapabilities,
} from '../../packages/core/src/plans.ts';

const now = new Date('2026-10-03T12:00:00.000Z');
const future = '2026-11-03T12:00:00.000Z';
const past = '2026-10-02T12:00:00.000Z';

test('plan keys, published prices, and Stripe environment keys stay stable', () => {
  assert.deepEqual(Object.keys(PLAN_DEFINITIONS), ['starter', 'pro', 'enterprise']);
  assert.deepEqual(Object.values(PLAN_DEFINITIONS).map((plan) => [plan.displayName, plan.price, plan.stripeEnvKey]), [
    ['Starter', '79.00', 'STRIPE_STARTER_PRICE_ID'],
    ['Growth', '199.00', 'STRIPE_PRO_PRICE_ID'],
    ['Pro', '399.00', 'STRIPE_ENTERPRISE_PRICE_ID'],
  ]);
  assert.equal(normalizePlanKey(undefined), 'pro');
  assert.equal(parsePlanKey(undefined), null);
  assert.equal(parsePlanKey('growth'), null);
  assert.equal(parsePlanKey('PRO'), null);
  assert.equal(hasPlanFeature(undefined, 'ocrInvoiceImport'), false);
  assert.equal(hasPlanFeature('typo', 'teamTimeBasic'), false);
});

test('Starter field seats include basic time without commercial GPS/approval access', () => {
  const capabilities = resolvePlanCapabilities({ plan: 'starter', status: 'active', now });
  assert.equal(checkCapability(capabilities, 'teamTimeBasic').allowed, true);
  assert.equal(checkCapability(capabilities, 'gpsTimeTracking').allowed, false);
  assert.equal(checkCapability(capabilities, 'timeApprovals').allowed, false);
  assert.equal(checkCapability(capabilities, 'ocrInvoiceImport').allowed, false);
  assert.equal(capabilities.limits.fieldUsers, 3);
  assert.equal(capabilities.limits.adminUsers, 1);
  assert.equal(capabilities.limits.monthlyOcrDocuments, 0);
  assert.ok(planFeaturesPayload('starter').features.includes('teamTimeBasic'));
});

test('Growth includes OCR and its 100-document allowance; Pro preserves 100', () => {
  for (const plan of ['pro', 'enterprise']) {
    const capabilities = resolvePlanCapabilities({ plan, status: 'active', now });
    assert.deepEqual(checkCapability(capabilities, 'ocrInvoiceImport'), { allowed: true });
    assert.equal(capabilities.limits.monthlyOcrDocuments, 100);
    assert.deepEqual(checkPlanLimit(capabilities, 'monthlyOcrDocuments', 99), { allowed: true, remaining: 0 });
    assert.equal(checkPlanLimit(capabilities, 'monthlyOcrDocuments', 100).allowed, false);
  }
  assert.equal(PLAN_DEFINITIONS.pro.limits.monthlyAiEstimatedCents, 2000);
  assert.equal(PLAN_DEFINITIONS.enterprise.limits.monthlyAiEstimatedCents, 10000);
});

test('plan capabilities are cumulative and copied, not shared mutable snapshots', () => {
  for (const feature of PLAN_DEFINITIONS.starter.features) assert.ok(PLAN_DEFINITIONS.pro.features.includes(feature));
  for (const feature of PLAN_DEFINITIONS.pro.features) assert.ok(PLAN_DEFINITIONS.enterprise.features.includes(feature));
  const capabilities = resolvePlanCapabilities({ plan: 'pro', status: 'active', now });
  capabilities.features.length = 0;
  capabilities.limits.monthlyOcrDocuments = 1;
  const later = resolvePlanCapabilities({ plan: 'pro', status: 'active', now });
  assert.ok(later.features.includes('ocrInvoiceImport'));
  assert.equal(later.limits.monthlyOcrDocuments, 100);
  const payload = planFeaturesPayload('pro');
  payload.features.length = 0;
  payload.featureCopy.length = 0;
  payload.limits.monthlyOcrDocuments = 1;
  assert.ok(planFeaturesPayload('pro').features.includes('ocrInvoiceImport'));
  assert.ok(planFeaturesPayload('pro').featureCopy.length > 0);
  assert.equal(planFeaturesPayload('pro').limits.monthlyOcrDocuments, 100);
});

test('trial and Stripe trialing grant the selected plan only before a known expiry', () => {
  for (const status of ['trial', 'trialing']) {
    const trial = resolvePlanCapabilities({ plan: 'pro', status, currentPeriodEnd: future, now });
    assert.equal(trial.accessState, 'trial');
    assert.equal(checkCapability(trial, 'ocrInvoiceImport').allowed, true);
    assert.equal(trial.accessUntil, future);
    for (const currentPeriodEnd of [past, now, undefined, null, 'bad-date']) {
      const denied = resolvePlanCapabilities({ plan: 'pro', status, currentPeriodEnd, now });
      assert.equal(checkCapability(denied, 'ocrInvoiceImport').allowed, false);
      assert.equal(denied.features.length, 0);
    }
  }
});

test('inactive, incomplete, unpaid, paused, and unknown statuses fail closed', () => {
  for (const status of ['trial_pending_payment', 'incomplete', 'incomplete_expired', 'unpaid', 'paused', 'unknown', null]) {
    const capabilities = resolvePlanCapabilities({ plan: 'enterprise', status, currentPeriodEnd: future, now });
    assert.equal(capabilities.accessState, 'inactive');
    assert.equal(checkCapability(capabilities, 'leadPipeline').allowed, false);
    assert.equal(checkPlanLimit(capabilities, 'fieldUsers', 0).allowed, false);
    assert.equal(capabilities.limits.monthlyAiEstimatedCents, 0);
  }
});

test('missing subscriptions and unknown plans cannot inherit Growth or explicit grants', () => {
  const grants = { features: { ocrInvoiceImport: true }, limits: { monthlyOcrDocuments: 1000 } };
  const missing = resolvePlanCapabilities({ now, grants });
  assert.equal(missing.plan, null);
  assert.equal(missing.denialCode, 'SUBSCRIPTION_REQUIRED');
  assert.equal(missing.grantsApplied, false);
  const unknown = resolvePlanCapabilities({ plan: 'custom-typo', status: 'active', now, grants });
  assert.equal(unknown.denialCode, 'UNKNOWN_PLAN');
  assert.equal(unknown.features.length, 0);
});

test('active subscriptions preserve legacy missing-period data but expire known paid-through dates', () => {
  assert.equal(resolvePlanCapabilities({ plan: 'starter', status: 'active', now }).accessState, 'active');
  assert.equal(resolvePlanCapabilities({ plan: 'starter', status: 'active', currentPeriodEnd: future, now }).accessState, 'active');
  assert.equal(resolvePlanCapabilities({ plan: 'starter', status: 'active', currentPeriodEnd: past, now }).denialCode, 'SUBSCRIPTION_EXPIRED');
  assert.equal(resolvePlanCapabilities({ plan: 'starter', status: 'active', currentPeriodEnd: now, now }).denialCode, 'SUBSCRIPTION_EXPIRED');
  assert.equal(resolvePlanCapabilities({ plan: 'starter', status: 'active', currentPeriodEnd: 'invalid', now }).denialCode, 'SUBSCRIPTION_INACTIVE');
});

test('canceled subscriptions retain access until paid-through boundary, not forever', () => {
  const retained = resolvePlanCapabilities({ plan: 'pro', status: 'canceled', currentPeriodEnd: future, now });
  assert.equal(retained.accessState, 'canceled_until_period_end');
  assert.equal(checkCapability(retained, 'ocrInvoiceImport').allowed, true);
  for (const currentPeriodEnd of [past, now, null, undefined]) {
    const ended = resolvePlanCapabilities({ plan: 'pro', status: 'canceled', currentPeriodEnd, now });
    assert.equal(checkCapability(ended, 'ocrInvoiceImport').allowed, false);
  }
});

test('past-due period-end dates do not prove payment or grant premium access', () => {
  for (const currentPeriodEnd of [future, past, now, undefined]) {
    const ended = resolvePlanCapabilities({ plan: 'pro', status: 'past_due', currentPeriodEnd, now });
    assert.equal(checkCapability(ended, 'productionEstimator').allowed, false);
    assert.equal(checkCapability(ended, 'ocrInvoiceImport').allowed, false);
    assert.equal(ended.accessState, 'inactive');
  }
});

test('grandfathered grants preserve approved features and limits independently of price', () => {
  const capabilities = resolvePlanCapabilities({
    plan: 'starter', status: 'active', currentPeriodEnd: future, now,
    grants: {
      features: { ocrInvoiceImport: true, quickEstimates: false },
      limits: { monthlyOcrDocuments: 250, adminUsers: 2, fieldUsers: null },
      expiresAt: future,
    },
  });
  assert.equal(capabilities.grantsApplied, true);
  assert.equal(checkCapability(capabilities, 'ocrInvoiceImport').allowed, true);
  assert.equal(checkCapability(capabilities, 'quickEstimates').allowed, false);
  assert.equal(capabilities.limits.monthlyOcrDocuments, 250);
  assert.equal(capabilities.limits.adminUsers, 2);
  assert.equal(capabilities.limits.fieldUsers, null);
  assert.deepEqual(checkPlanLimit(capabilities, 'fieldUsers', 10000), { allowed: true, remaining: null });
  assert.equal(PLAN_DEFINITIONS.starter.price, '79.00');
});

test('invalid grants are ignored and cannot create negative or unbounded spend allowances', () => {
  const capabilities = resolvePlanCapabilities({
    plan: 'pro', status: 'active', now,
    grants: {
      features: { arbitraryFeature: true, apiAccess: 'true' },
      limits: {
        adminUsers: -1,
        fieldUsers: '100',
        monthlyOcrDocuments: null,
        monthlyAiEstimatedCents: Infinity,
        monthlySmsIncluded: 10.5,
      },
    },
  });
  assert.equal(capabilities.grantsApplied, false);
  assert.deepEqual(capabilities.limits, PLAN_DEFINITIONS.pro.limits);
  assert.equal(checkCapability(capabilities, 'apiAccess').allowed, false);
  for (const expiresAt of [past, now, 'invalid', 123]) {
    const expired = resolvePlanCapabilities({ plan: 'starter', status: 'active', now, grants: {
      expiresAt, features: { ocrInvoiceImport: true }, limits: { monthlyOcrDocuments: 999 },
    } });
    assert.equal(expired.grantsApplied, false);
    assert.equal(checkCapability(expired, 'ocrInvoiceImport').allowed, false);
  }
});

test('grandfathered plan metadata cannot reactivate expired or incomplete subscriptions', () => {
  for (const status of ['incomplete', 'trial_pending_payment', 'canceled']) {
    const capabilities = resolvePlanCapabilities({ plan: 'starter', status, currentPeriodEnd: past, now,
      grants: { features: { ocrInvoiceImport: true }, limits: { monthlyOcrDocuments: 1000 } },
    });
    assert.equal(capabilities.grantsApplied, false);
    assert.equal(checkCapability(capabilities, 'ocrInvoiceImport').allowed, false);
  }
});

test('seat, document, and estimated spend boundaries use safe integer preflight checks', () => {
  const capabilities = resolvePlanCapabilities({ plan: 'pro', status: 'active', now });
  assert.deepEqual(checkPlanLimit(capabilities, 'adminUsers', 2), { allowed: true, remaining: 0 });
  assert.equal(checkPlanLimit(capabilities, 'adminUsers', 3).allowed, false);
  assert.deepEqual(checkPlanLimit(capabilities, 'fieldUsers', 8, 2), { allowed: true, remaining: 0 });
  assert.equal(checkPlanLimit(capabilities, 'fieldUsers', 9, 2).allowed, false);
  assert.deepEqual(checkPlanLimit(capabilities, 'monthlyAiEstimatedCents', 1999), { allowed: true, remaining: 0 });
  assert.equal(checkPlanLimit(capabilities, 'monthlyAiEstimatedCents', 1999, 2).allowed, false);
  for (const used of [-1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    const decision = checkPlanLimit(capabilities, 'monthlyOcrDocuments', used);
    assert.ok(!decision.allowed && decision.code === 'INVALID_USAGE');
  }
  for (const requested of [-1, 0, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const decision = checkPlanLimit(capabilities, 'monthlyOcrDocuments', 0, requested);
    assert.ok(!decision.allowed && decision.code === 'INVALID_USAGE');
  }
});

test('invalid test clock is rejected rather than granting an unbounded subscription', () => {
  assert.throws(() => resolvePlanCapabilities({ plan: 'pro', status: 'active', now: new Date('invalid') }), RangeError);
});
