import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  parseProductionEstimationInput, resolveProductionEstimation,
  productionEstimationFieldErrors, ProductionEstimationValidationError,
} from '../../apps/api/src/lib/production-estimation';
import { EstimationInputError } from '../../packages/core/src/estimation';

const requireApi = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const { PgDialect } = requireApi('drizzle-orm/pg-core');
const orgId = '11111111-1111-4111-8111-111111111111';
const otherOrg = '22222222-2222-4222-8222-222222222222';
const rateId = '33333333-3333-4333-8333-333333333333';
const materialId = '44444444-4444-4444-8444-444444444444';

function request() {
  return {
    items: ['a', 'b', 'c'].map((id) => ({
      id, productionRateId: rateId, materialId, quantity: '80',
      unit: 'sqft', coats: 2, prepLevel: 'light', applicationMethod: 'brush_roll',
      colorName: 'Swiss Coffee', colorCode: '7002-16',
    })),
    discount: '0',
  };
}

function mockDatabase() {
  const rate = { id: rateId, orgId, unit: 'sqft', ratePerHour: '400', hourlyRate: '50', prepMultiplier: '1', coats: 2, isActive: true };
  const material = { id: materialId, orgId, category: 'paint', brand: 'Supplier', sku: 'satin-base', unit: 'gallon', costPerUnit: '10.01', coverageSqFt: '400', markupPercent: '30', isActive: true };
  const settings = { orgId, salesTaxRate: '0.092', defaultLaborRate: '65', materialMarkupPercent: '30' };
  const queries: Array<{ table: string; sql: string; params: unknown[] }> = [];
  const dialect = new PgDialect();
  const query = (table: string, where: unknown) => {
    const compiled = dialect.sqlToQuery(where);
    queries.push({ table, sql: compiled.sql, params: compiled.params });
    return compiled.params.includes(orgId);
  };
  const raw = {
    query: {
      productionRates: { findMany: async ({ where }: { where: unknown }) => query('production_rates', where) ? [rate] : [] },
      materials: { findMany: async ({ where }: { where: unknown }) => query('materials', where) ? [material] : [] },
      orgSettings: { findFirst: async ({ where }: { where: unknown }) => query('org_settings', where) ? settings : undefined },
    },
  };
  return { db: raw as unknown as Parameters<typeof resolveProductionEstimation>[0], queries, rate, material, settings };
}

test('authoritative save adapter ignores submitted rate, price, productivity, and tax snapshots', async () => {
  const fixture = mockDatabase();
  const input = request();
  const result = await resolveProductionEstimation(fixture.db, orgId, {
    ...input, taxRate: '0', calculationInput: { taxRate: '0' },
    items: input.items.map((item) => ({ ...item, ratePerHour: '999999', costPerPack: '0', hourlyRate: '0', productivity: '999' })),
  });
  assert.equal(result.calculation.purchaseGroups[0].packCount, 2);
  assert.equal(result.calculation.totals.laborMinor, 6000);
  assert.equal(result.calculation.totals.materialCostMinor, 2002);
  assert.equal(result.calculation.totals.materialMinor, 2603);
  assert.equal(result.calculation.totals.taxMinor, 791);
  assert.equal(result.calculation.totals.totalMinor, 9394);
  assert.deepEqual(result.resolvedInput.taxRate, { value: '0.092', kind: 'fraction' });
  assert.ok(!('hourlyRate' in result.productionInput.items[0]));
  assert.ok(!('calculationInput' in result.productionInput));
  assert.equal(result.rates[0].id, rateId);
  assert.equal(result.materials[0].id, materialId);
});

test('each pricebook query scopes tenant and IDs; unavailable and inactive references fail', async () => {
  const fixture = mockDatabase();
  await resolveProductionEstimation(fixture.db, orgId, request());
  assert.deepEqual(fixture.queries.map((query) => query.table).sort(), ['materials', 'org_settings', 'production_rates']);
  for (const query of fixture.queries) {
    assert.match(query.sql, /"org_id" = \$\d+/);
    assert.ok(query.params.includes(orgId));
    assert.ok(!query.params.includes(otherOrg));
  }
  assert.deepEqual(fixture.queries.find((query) => query.table === 'production_rates')?.params, [orgId, rateId]);
  assert.deepEqual(fixture.queries.find((query) => query.table === 'materials')?.params, [orgId, materialId]);
  await assert.rejects(resolveProductionEstimation(fixture.db, otherOrg, request()), /production rate is unavailable/);
  fixture.rate.isActive = false;
  await assert.rejects(resolveProductionEstimation(fixture.db, orgId, request()), /production rate is unavailable/);
  fixture.rate.isActive = true;
  fixture.material.isActive = false;
  await assert.rejects(resolveProductionEstimation(fixture.db, orgId, request()), /product is unavailable/);
});

test('invalid shape fails before querying and exposes exact field errors', async () => {
  const fixture = mockDatabase();
  await assert.rejects(resolveProductionEstimation(fixture.db, orgId, {
    items: [{ productionRateId: 'foreign-or-missing', coats: 4 }],
  }), (error: unknown) => {
    assert.ok(error instanceof ProductionEstimationValidationError);
    assert.ok(productionEstimationFieldErrors(error)['items.0.productionRateId']);
    assert.ok(productionEstimationFieldErrors(error)['items.0.coats']);
    return true;
  });
  assert.equal(fixture.queries.length, 0);
  const parsed = parseProductionEstimationInput({ items: [{ productionRateId: rateId }] });
  assert.equal(parsed.items[0].id, 'item-0');
  assert.equal(parsed.items[0].productionRateId, rateId);
});

test('quantity, unit, and decimals remain validated after price resolution; zero cannot produce cost', async () => {
  const fixture = mockDatabase();
  const source = request().items[0];
  for (const patch of [{ quantity: '-1' }, { quantity: '1,000' }, { quantity: '0.1234567' }, { unit: 'each' }]) {
    await assert.rejects(resolveProductionEstimation(fixture.db, orgId, { items: [{ ...source, ...patch }] }), EstimationInputError);
  }
  const zero = await resolveProductionEstimation(fixture.db, orgId, {
    items: [{ ...source, quantity: '0', width: '20', height: '20', paintAdjustmentHours: '5' }],
  });
  assert.equal(zero.calculation.totals.totalMinor, 0);
  assert.equal(zero.calculation.totals.hours, '0');
  assert.equal(zero.calculation.purchaseGroups[0].packCount, 0);
});

test('unsigned save intentionally reprices current catalog rather than accepting an older snapshot', async () => {
  const fixture = mockDatabase();
  const old = await resolveProductionEstimation(fixture.db, orgId, request());
  fixture.material.costPerUnit = '20.01';
  fixture.rate.hourlyRate = '60';
  fixture.settings.salesTaxRate = '0.1';
  const repriced = await resolveProductionEstimation(fixture.db, orgId, { ...request(), calculationInput: old.resolvedInput, calculation: old.calculation });
  assert.equal(repriced.calculation.totals.laborMinor, 7200);
  assert.equal(repriced.calculation.totals.materialCostMinor, 4002);
  assert.equal(repriced.calculation.totals.materialMinor, 5203);
  assert.equal(repriced.calculation.totals.taxMinor, 1240);
  assert.equal(repriced.calculation.totals.totalMinor, 13643);
  assert.notDeepEqual(repriced.resolvedInput, old.resolvedInput);
  assert.equal(old.calculation.totals.totalMinor, 9394);
});
