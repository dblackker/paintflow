import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  normalizeProductionRate,
  productionRateSchema,
  productionPricebookOperationKey,
  SAMPLE_PRODUCTION_RATES,
} from '../../apps/api/src/routes/production-rates';

const legacy = {
  category: 'exterior_siding',
  surfaceType: 'wood',
  unit: 'sqft',
  ratePerHour: '200.00',
  hourlyRate: '65.00',
  prepMultiplier: '1.20',
  coats: 2,
  description: 'Exterior siding - spray',
};
const complete = {
  ...legacy,
  rateBasis: 'complete_system',
  coatRates: { '1': '100', '2': '80.000000', '3': '60' },
  applicationMethod: 'spray_only',
  sellingRateSource: 'inherit',
  burdenedRate: '32.50',
};

test('old clients and legacy spray descriptions keep their explicit per-coat/override semantics', () => {
  const rate = normalizeProductionRate(legacy);
  assert.equal(rate.rateBasis, 'legacy_per_coat');
  assert.equal(rate.sellingRateSource, 'override');
  assert.equal(rate.applicationMethod, null);
  assert.deepEqual(rate.coatRates, {});
  assert.equal(rate.ratePerHour, '200');
  assert.equal(rate.hourlyRate, '65');
  assert.equal(rate.prepMultiplier, '1.2');
  assert.equal(rate.burdenedRate, null);
  assert.equal(rate.reviewedAt, null);
  assert.equal(rate.description, legacy.description);
});

test('complete-system tables normalize decimals without multiplying coats or inferring methods', () => {
  const rate = normalizeProductionRate(complete);
  assert.equal(rate.rateBasis, 'complete_system');
  assert.deepEqual(rate.coatRates, { '1': '100', '2': '80', '3': '60' });
  assert.equal(rate.applicationMethod, 'spray_only');
  assert.equal(rate.sellingRateSource, 'inherit');
  assert.equal(rate.burdenedRate, '32.5');
  assert.equal(normalizeProductionRate({ ...complete, applicationMethod: null }).applicationMethod, null);
});

test('hours/item needs each and an explicit rate for the selected complete coat count', () => {
  const rate = normalizeProductionRate({
    ...complete,
    unit: 'each',
    rateBasis: 'hours_per_item',
    coatRates: { '2': '0.750000' },
  });
  assert.equal(rate.coatRates['2'], '0.75');
  assert.equal(rate.rateBasis, 'hours_per_item');
  assert.equal(productionRateSchema.safeParse({ ...complete, rateBasis: 'hours_per_item' }).success, false);
  for (const coatRates of [
    {},
    { '1': '100' },
    { '2': '0' },
    { '2': '-1' },
    { '2': 'Infinity' },
    { '4': '80' },
    { '2': '0.1234567' },
  ]) {
    assert.equal(productionRateSchema.safeParse({ ...complete, coatRates }).success, false);
  }
});

test('legacy rate writes allow an empty table but reject incomplete custom passes', () => {
  assert.equal(productionRateSchema.safeParse({ ...legacy, coatRates: {} }).success, true);
  assert.equal(productionRateSchema.safeParse({ ...legacy, coatRates: { '1': '200' } }).success, false);
  assert.equal(productionRateSchema.safeParse({ ...legacy, coatRates: { '1': '200', '2': '250' } }).success, true);
});

test('invalid numbers, null/blank/overflow prices, precision, enums and coat counts fail validation', () => {
  const patches = [
    { category: ' ' },
    { surfaceType: 'x'.repeat(101) },
    { ratePerHour: '' },
    { ratePerHour: 0 },
    { ratePerHour: Infinity },
    { ratePerHour: NaN },
    { ratePerHour: '0.001' },
    { hourlyRate: '999999999' },
    { hourlyRate: '1.234' },
    { hourlyRate: null },
    { hourlyRate: '1,000' },
    { prepMultiplier: '-1' },
    { coats: 0 },
    { coats: 4 },
    { coats: 1.5 },
    { applicationMethod: 'spray' },
    { rateBasis: 'per_pass' },
    { sellingRateSource: 'default' },
    { burdenedRate: '-0.01' },
    { burdenedRate: '' },
    { burdenedRate: '1.001' },
  ];
  for (const patch of patches) {
    assert.equal(
      productionRateSchema.safeParse({ ...legacy, ...patch }).success,
      false,
      JSON.stringify(patch),
    );
  }
  assert.equal(normalizeProductionRate({ ...complete, burdenedRate: '0' }).burdenedRate, '0');
  assert.equal(normalizeProductionRate({ ...complete, burdenedRate: null }).burdenedRate, null);
});

test('partial edits preserve existing basis, cost, calibration and provenance; review is explicit', () => {
  const existing = { ...complete, provenance: 'sample', reviewedAt: null, version: 4 };
  const edited = normalizeProductionRate({ description: 'Updated', expectedVersion: 4 }, existing);
  assert.equal(edited.description, 'Updated');
  assert.equal(edited.rateBasis, 'complete_system');
  assert.equal(edited.applicationMethod, 'spray_only');
  assert.equal(edited.sellingRateSource, 'inherit');
  assert.equal(edited.burdenedRate, '32.5');
  assert.equal(edited.provenance, 'sample');
  assert.equal(edited.reviewedAt, null);
  const reviewed = normalizeProductionRate({ reviewed: true }, existing, new Date('2026-10-04T12:00:00Z'));
  assert.equal(reviewed.provenance, 'manual');
  assert.equal(reviewed.reviewedAt, '2026-10-04T12:00:00.000Z');
  const cleared = normalizeProductionRate(
    { applicationMethod: null, burdenedRate: null, reviewed: false },
    reviewed,
  );
  assert.equal(cleared.applicationMethod, null);
  assert.equal(cleared.burdenedRate, null);
  assert.equal(cleared.reviewedAt, null);
  const legacyEdit = normalizeProductionRate(
    { description: 'New description' },
    { ...legacy, provenance: 'legacy' },
  );
  assert.equal(legacyEdit.provenance, 'legacy');
  assert.equal(legacyEdit.rateBasis, 'legacy_per_coat');
});

test('new samples explicitly inherit sell, have complete starter tables and remain unreviewed', () => {
  assert.equal(SAMPLE_PRODUCTION_RATES.length, 10);
  for (const rate of SAMPLE_PRODUCTION_RATES) {
    assert.equal(rate.provenance, 'sample');
    assert.equal(rate.reviewedAt, null);
    assert.equal(rate.rateBasis, 'complete_system');
    assert.equal(rate.sellingRateSource, 'inherit');
    assert.equal(rate.burdenedRate, null);
    assert.ok(rate.applicationMethod);
    assert.deepEqual(Object.keys(rate.coatRates), ['1', '2', '3']);
    assert.ok(productionRateSchema.safeParse(rate).success);
  }
  assert.equal(
    SAMPLE_PRODUCTION_RATES.find((rate) => rate.category === 'exterior_siding')?.applicationMethod,
    'spray_backroll',
  );
});

test('operation keys are required and bounded', () => {
  assert.equal(productionPricebookOperationKey(' retry-1 '), 'retry-1');
  for (const invalid of [undefined, '', ' ', 'x'.repeat(201)])
    assert.throws(() => productionPricebookOperationKey(invalid));
});

test('GET is read-only and tenant filtered; mutation endpoints use settings permission and idempotency', () => {
  const route = readFileSync(
    new URL('../../apps/api/src/routes/production-rates.ts', import.meta.url),
    'utf8',
  );
  const get = route.slice(
    route.indexOf("ratesApp.get('/'"),
    route.indexOf("ratesApp.post('/initialize-samples'"),
  );
  assert.match(get, /eq\(productionRates.orgId, orgId\)/);
  assert.match(get, /eq\(productionRates.isActive, true\)/);
  assert.doesNotMatch(get, /\.insert\(|\.update\(|initialize|seed/i);
  assert.match(get, /c.json\(\{ data: rates \}\)/);
  for (const declaration of ["post('/initialize-samples'", "post('/'", "put('/:id'", "delete('/:id'"]) {
    assert.ok(route.includes(`ratesApp.${declaration}, pricebookAccess`));
  }
  assert.match(route, /requireOrgPermission\(\s*\['manage_settings'\]/);
  assert.match(route, /ratesApp.post\(\s*'\/calculate',\s*requireOrgPermission\(\['manage_estimates'\]/);
  assert.match(route, /mutate_production_pricebook\(/);
  assert.match(route, /Idempotency-Key/);
});

test('migration is additive, retains material values and serializes tenant-scoped durable outcomes', () => {
  const migration = readFileSync(
    new URL('../../packages/db/migrations/0033_estimation_pricebook_v2.sql', import.meta.url),
    'utf8',
  );
  assert.match(migration, /rate_basis VARCHAR\(30\) NOT NULL DEFAULT 'legacy_per_coat'/);
  assert.match(migration, /selling_rate_source VARCHAR\(20\) NOT NULL DEFAULT 'override'/);
  assert.match(migration, /coverage_basis VARCHAR\(20\) NOT NULL DEFAULT 'per_pack'/);
  assert.doesNotMatch(
    migration,
    /UPDATE materials|UPDATE estimates|UPDATE production_rates SET.*rate_basis/i,
  );
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /WHERE org_id=p_org AND category=v_payload->>'category'/);
  assert.match(migration, /WHERE id=p_id AND org_id=p_org AND is_active FOR UPDATE/);
  assert.match(migration, /v_operation.request <> p_request/);
  assert.match(migration, /p_expected <> v_existing.version/);
  assert.match(migration, /INSERT INTO operation_results/);
});
