import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STARTER_PRODUCTION_RATES, starterCoatRates } from '../../packages/core/src/estimation-rate-defaults';
import { calculateProductionPreview } from '../../packages/core/src/estimation-production';
import { SAMPLE_PRODUCTION_RATES, productionRateSchema } from '../../apps/api/src/routes/production-rates';
import { goldenSeed } from '../../packages/db/src/seeds/golden-data';

test('signup and manual sample setup use the same validated, unreviewed company defaults', () => {
  assert.equal(SAMPLE_PRODUCTION_RATES, STARTER_PRODUCTION_RATES);
  const source = readFileSync(new URL('../../apps/api/src/routes/auth.ts', import.meta.url), 'utf8');
  assert.match(source, /STARTER_PRODUCTION_RATES\.map\(\(rate\) => \(\{ orgId, \.\.\.rate \}\)\)/);
  for (const rate of STARTER_PRODUCTION_RATES) {
    assert.equal(productionRateSchema.safeParse(rate).success, true);
    assert.equal(rate.provenance, 'sample');
    assert.equal(rate.reviewedAt, null);
    assert.equal(rate.sellingRateSource, 'inherit');
    assert.equal(rate.burdenedRate, null);
    assert.deepEqual(Object.keys(rate.coatRates), ['1', '2', '3']);
    assert.equal(rate.prepMultiplier, '1.00');
  }
});

test('starter walls have explicit complete-system throughput and inherit the company selling rate', () => {
  const rate = STARTER_PRODUCTION_RATES.find((row) => row.category === 'walls')!;
  assert.deepEqual(starterCoatRates('400'), { '1': '400', '2': '200', '3': '133.333333' });
  const result = calculateProductionPreview({ calculationVersion: 'repaint-v2', items: [
    { id: 'wall', productionRateId: 'wall-rate', quantity: '400', coats: 2 },
  ] }, { rates: [{ ...rate, id: 'wall-rate' }], materials: [], settings: { defaultLaborRate: '91' } }).calculation;
  assert.equal(result.totals.hours, '2');
  assert.equal(result.totals.laborMinor, 18200);
  assert.equal(result.totals.laborBudgetMinor, null);
});

test('every contractor and demo starter substrate calculates one, two and three coats', () => {
  for (const book of [STARTER_PRODUCTION_RATES, goldenSeed.productionRates]) {
    const rates = book.map((rate, index) => ({ ...rate, id: `rate-${index}` }));
    for (const coats of [1, 2, 3]) {
      const result = calculateProductionPreview({ calculationVersion: 'repaint-v2', items: rates.map((rate) => ({
        id: rate.id, productionRateId: rate.id, quantity: rate.unit === 'each' ? '1' : '100', coats,
      })) }, { rates, materials: [], settings: { defaultLaborRate: '65' } }).calculation;
      assert.equal(result.items.length, rates.length);
      assert.ok(result.items.every((item) => Number(item.hours) > 0 && item.laborMinor > 0));
      assert.ok(result.items.every((item) => item.operations?.[0].coats === coats));
    }
  }
});

test('demo rate metadata keeps configured prices and output without claiming field calibration', () => {
  for (const rate of goldenSeed.productionRates) {
    assert.equal(rate.rateBasis, 'complete_system');
    assert.equal(rate.sellingRateSource, 'override');
    assert.equal(rate.provenance, 'sample');
    assert.equal(rate.reviewedAt, null);
    assert.equal(Number(rate.coatRates['1']), Number(rate.ratePerHour));
    assert.equal(Number(rate.coatRates['2']), Number(rate.ratePerHour) / 2);
    assert.equal(productionRateSchema.safeParse(rate).success, true);
  }
});
