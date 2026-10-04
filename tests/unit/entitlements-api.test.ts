import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkCapability } from '../../packages/core/src/plans.ts';
import { orgCapabilityGrants, readOrgCapabilities } from '../../apps/api/src/lib/entitlements.ts';

const now = new Date('2026-10-03T12:00:00.000Z');
const orgId = 'synthetic-org-a';
const otherOrgId = 'synthetic-org-b';
const planFeatures = {
  // Historical display snapshots must not override the corrected central policy.
  features: ['apiAccess'],
  capabilityGrants: { features: { apiAccess: true } },
  capabilityGrantsByOrg: {
    [orgId]: { features: { ocrInvoiceImport: true }, limits: { monthlyOcrDocuments: 150 } },
  },
};

function fakeDb(rows: unknown[]) {
  let tenantFilter: unknown;
  let limit: number;
  let ordering: unknown[];
  const query = {
    from() { return query; },
    leftJoin() { return query; },
    where(filter: unknown) { tenantFilter = filter; return query; },
    orderBy(...values: unknown[]) { ordering = values; return query; },
    async limit(value: number) { limit = value; return rows; },
  };
  return {
    db: { select: () => query } as unknown as Parameters<typeof readOrgCapabilities>[0],
    queryShape: () => ({ tenantFilter, limit, ordering }),
  };
}

test('persistent capability grants are keyed to one tenant, not the shared plan', () => {
  assert.deepEqual(orgCapabilityGrants(planFeatures, orgId), planFeatures.capabilityGrantsByOrg[orgId]);
  assert.equal(orgCapabilityGrants(planFeatures, otherOrgId), undefined);
  assert.equal(orgCapabilityGrants(planFeatures, '__proto__'), undefined);
  assert.equal(orgCapabilityGrants({ capabilityGrants: { features: { apiAccess: true } } }, orgId), undefined);
  assert.equal(orgCapabilityGrants({ capabilityGrantsByOrg: [] }, orgId), undefined);
  assert.equal(orgCapabilityGrants(null, orgId), undefined);
});

test('tenant capability lookup preserves individual grants and queries one latest subscription', async () => {
  const { db, queryShape } = fakeDb([{
    planName: 'starter', status: 'active', currentPeriodEnd: new Date('2026-11-03T12:00:00.000Z'), planFeatures,
  }]);
  const result = await readOrgCapabilities(db, orgId, now);
  assert.equal(checkCapability(result, 'ocrInvoiceImport').allowed, true);
  assert.equal(checkCapability(result, 'apiAccess').allowed, false);
  assert.equal(result.limits.monthlyOcrDocuments, 150);
  const shape = queryShape();
  assert.equal(shape.limit, 1);
  assert.equal(shape.ordering.length, 2);
  const filter = shape.tenantFilter as { queryChunks: Array<{ value?: unknown }> };
  assert.ok(filter.queryChunks.some((chunk) => chunk.value === orgId));
});

test('another tenant on the same plan never receives negotiated OCR grants', async () => {
  const { db } = fakeDb([{ planName: 'starter', status: 'active', currentPeriodEnd: null, planFeatures }]);
  const result = await readOrgCapabilities(db, otherOrgId, now);
  assert.equal(result.grantsApplied, false);
  assert.equal(checkCapability(result, 'ocrInvoiceImport').allowed, false);
  assert.equal(result.limits.monthlyOcrDocuments, 0);
});

test('a missing or unmapped subscription fails closed without database mutations', async () => {
  const { db } = fakeDb([]);
  const missing = await readOrgCapabilities(db, orgId, now);
  assert.equal(missing.denialCode, 'SUBSCRIPTION_REQUIRED');
  const unmappedDb = fakeDb([{ planName: null, status: 'active', currentPeriodEnd: null }]).db;
  assert.equal((await readOrgCapabilities(unmappedDb, orgId, now)).denialCode, 'UNKNOWN_PLAN');
  await assert.rejects(() => readOrgCapabilities(db, '', now), /Organization context is required/);
});
