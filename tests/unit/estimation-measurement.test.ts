import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveEstimatorMeasurement, estimatorCoatingProducts, estimatorMeasurementPatch, ESTIMATOR_INTERIOR_OPENINGS, ESTIMATOR_EXTERIOR_OPENINGS } from '../../packages/core/src/estimation-measurement';

const bedroom = { length: 12, width: 12, height: 9, windows: 1, doors: 1, openingPolicy: ESTIMATOR_INTERIOR_OPENINGS };
test('None excludes base, crown and casing; base does not leak casing', () => {
  assert.equal(deriveEstimatorMeasurement({ ...bedroom, trimScope: 'none' }, 'trim').quantity, 0);
  assert.equal(deriveEstimatorMeasurement({ ...bedroom, trimScope: 'base' }, 'trim').quantity, 48);
  assert.equal(deriveEstimatorMeasurement({ ...bedroom, trimScope: 'base-casing' }, 'trim').quantity, 78);
  assert.equal(deriveEstimatorMeasurement({ ...bedroom, trimScope: 'base-crown-casing' }, 'trim').quantity, 126);
  assert.equal(deriveEstimatorMeasurement({ ...bedroom, trimScope: 'casing' }, 'trim').quantity, 30);
});
test('starter and metrics reuse preserve opening and casing policy exactly', () => {
  for (const kind of ['walls', 'ceilings', 'trim', 'doors'] as const) {
    const metrics = { ...bedroom, trimScope: 'base-casing' as const };
    const starter = deriveEstimatorMeasurement(metrics, kind, 'starter_allowance');
    const reused = deriveEstimatorMeasurement(starter.metrics, kind);
    assert.equal(starter.quantity, reused.quantity);
    assert.deepEqual(starter.components, reused.components);
    assert.deepEqual(starter.policy, reused.policy);
  }
  const walls = deriveEstimatorMeasurement(bedroom, 'walls');
  assert.equal(walls.gross, 432);
  assert.equal(walls.deduction, 36);
  assert.equal(walls.quantity, 396);
  assert.equal(deriveEstimatorMeasurement(bedroom, 'ceilings').quantity, 144);
});
test('legacy metrics explicitly use gross policy; contractor can opt out of deductions', () => {
  assert.equal(deriveEstimatorMeasurement({ ...bedroom, openingPolicy: undefined }, 'walls').quantity, 432);
  assert.equal(deriveEstimatorMeasurement({ ...bedroom, openingPolicy: { ...ESTIMATOR_INTERIOR_OPENINGS, deductOpenings: false } }, 'walls').quantity, 432);
});
test('exterior geometry retains story height, roofline and separate casing allowances', () => {
  const metrics = { perimeter: 160, height: 20, windows: 14, doors: 3, corners: 4, rooflineFactor: 1.1, soffitDepth: 2, trimScope: 'casing' as const, openingPolicy: ESTIMATOR_EXTERIOR_OPENINGS };
  assert.equal(deriveEstimatorMeasurement(metrics, 'exterior_body').quantity, 2918);
  assert.equal(deriveEstimatorMeasurement(metrics, 'trim').quantity, 278);
  assert.equal(deriveEstimatorMeasurement(metrics, 'fascia').quantity, 176);
  assert.equal(deriveEstimatorMeasurement(metrics, 'soffit').quantity, 352);
  assert.equal(deriveEstimatorMeasurement(metrics, 'corner_boards').quantity, 80);
});
test('manual overrides require confirmation, including a deliberate zero', () => {
  const measurement = deriveEstimatorMeasurement(bedroom, 'walls');
  assert.equal(estimatorMeasurementPatch(measurement, '0'), null);
  assert.equal(estimatorMeasurementPatch(measurement, '500'), null);
  assert.equal(estimatorMeasurementPatch(measurement, '500', true)?.quantity, '396');
  assert.equal(estimatorMeasurementPatch(measurement, '')?.quantity, '396');
});
test('primer never replaces finish, regardless of preparation', () => {
  for (const prepLevel of ['none', 'light', 'standard', 'heavy']) {
    const surface = { prepLevel, materialId: '', primerMaterialId: '', primerMode: 'full' };
    assert.deepEqual(estimatorCoatingProducts(surface, { finish: 'paint', primer: 'primer' }), { finish: 'paint', primer: 'primer' });
  }
  assert.deepEqual(estimatorCoatingProducts({ materialId: 'special', primerMode: 'none' }, { finish: 'paint', primer: 'primer' }), { finish: 'special', primer: '' });
});
test('geometry rejects invalid inputs and surfaces impossible deductions', () => {
  for (const value of [-1, Infinity, NaN, 1_000_001]) assert.throws(() => deriveEstimatorMeasurement({ ...bedroom, height: value }, 'walls'));
  const measurement = deriveEstimatorMeasurement({ ...bedroom, doors: 100 }, 'walls');
  assert.equal(measurement.quantity, 0);
  assert.equal(measurement.warnings.length, 1);
  const before = structuredClone(bedroom);
  deriveEstimatorMeasurement(bedroom, 'walls');
  assert.deepEqual(bedroom, before);
});
