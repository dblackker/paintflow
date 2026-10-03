import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateQuickEstimate } from '../../packages/core/src/estimation-quick';
import { calculateProductionPreview } from '../../packages/core/src/estimation-production';
import { EstimationInputError } from '../../packages/core/src/estimation';
import { estimationSaveAttempt } from '../../packages/core/src/estimation-save';
import { estimationSurfaceKind, estimationTemplateUnit, resolveEstimationTemplateRate } from '../../packages/core/src/estimation-template';
import { templateSchema } from '../../apps/api/src/routes/estimate-templates';

const policy = { laborRate: '10', materialMarkupPercent: '33.33', salesTaxRate: '0.092', depositPercent: '50' };
const row = { id: 'a', quantity: '3', laborHoursPerUnit: '0.001', materialCostPerUnit: '1.00' };

test('quick display and authoritative production adjustment contract use the same rounded unit prices and tax', () => {
  const quick = calculateQuickEstimate([row], policy);
  assert.equal(quick.items[0].unitPrice, '1.34');
  assert.equal(quick.calculation.totals.subtotalMinor, 402);
  assert.equal(quick.calculation.totals.taxMinor, 37);
  assert.equal(quick.calculation.totals.totalMinor, 439);
  assert.equal(quick.totals.depositMinor, 220);
  assert.equal(quick.taxPercent, '9.2');
  assert.equal(quick.totals.laborMinor + quick.totals.materialMinor, 402);
  const persisted = calculateProductionPreview(quick.productionInput, { rates: [], materials: [], settings: { salesTaxRate: policy.salesTaxRate } });
  assert.deepEqual(persisted.calculation, quick.calculation);
  assert.deepEqual(persisted.resolvedInput, quick.resolvedInput);
});

test('fractional quick quantities preserve cents and zero rows cannot create priced adjustments', () => {
  const quick = calculateQuickEstimate([{ ...row, quantity: '0.25', laborHoursPerUnit: '0', materialCostPerUnit: '0.10' }], { ...policy, materialMarkupPercent: '0' });
  assert.equal(quick.calculation.totals.subtotalMinor, 3);
  assert.equal(quick.totals.materialMinor, 3);
  const zero = calculateQuickEstimate([{ ...row, quantity: '0' }, { ...row, id: 'free', laborHoursPerUnit: '0', materialCostPerUnit: '0' }], policy);
  assert.equal(zero.calculation.totals.totalMinor, 0);
  assert.equal(zero.totals.depositMinor, 0);
  assert.deepEqual(zero.productionInput.adjustments, []);
});

test('quick scope invalid decimal, negative, precision, duplicate, markup, and deposit inputs fail clearly', () => {
  for (const patch of [{ quantity: '-1' }, { laborHoursPerUnit: 'NaN' }, { materialCostPerUnit: '0.001' }]) {
    assert.throws(() => calculateQuickEstimate([{ ...row, ...patch }], policy), EstimationInputError);
  }
  assert.throws(() => calculateQuickEstimate([row, row], policy), /unique identifier/);
  assert.throws(() => calculateQuickEstimate([row], { ...policy, materialMarkupPercent: '201' }), /percentage/);
  assert.throws(() => calculateQuickEstimate([row], { ...policy, depositPercent: '101' }), /percentage/);
  assert.throws(() => calculateQuickEstimate([row], { ...policy, salesTaxRate: '9.2' }), /Sales tax/);
});

test('save attempt key survives retries but changes after body/version changes or acknowledged success', () => {
  let keys = 0;
  const next = () => 'key-' + (++keys);
  const first = estimationSaveAttempt(null, 'POST:unchanged-body', next);
  assert.strictEqual(estimationSaveAttempt(first, 'POST:unchanged-body', next), first);
  assert.equal(keys, 1);
  const edited = estimationSaveAttempt(first, 'POST:changed-body', next);
  assert.equal(edited.key, 'key-2');
  const version = estimationSaveAttempt(edited, 'PATCH:changed-body:version-2', next);
  assert.equal(version.key, 'key-3');
  assert.equal(estimationSaveAttempt(null, version.identity, next).key, 'key-4');
});

test('template category aliases carry explicit units and do not confuse cabinet counts with doors', () => {
  assert.equal(estimationTemplateUnit('ceiling'), 'sqft');
  assert.equal(estimationTemplateUnit('siding'), 'sqft');
  assert.equal(estimationTemplateUnit('corner_boards'), 'linear_ft');
  assert.equal(estimationTemplateUnit('trim'), 'linear_ft');
  assert.equal(estimationTemplateUnit('cabinets'), 'each');
  assert.equal(estimationSurfaceKind({ category: 'cabinets', description: 'Cabinet door/drawer front', unit: 'each' }), 'cabinets');
  assert.equal(estimationTemplateUnit('unknown substrate'), undefined);
});

test('template references preserve exact identity and unit; missing or inactive rates never fall back', () => {
  const rates = [
    { id: 'wall', category: 'walls', unit: 'sqft' },
    { id: 'int-trim', category: 'interior', surfaceType: 'trim', unit: 'linear_ft' },
    { id: 'ext-trim', category: 'exterior_trim', unit: 'linear_ft' },
    { id: 'cabinets', category: 'cabinets', unit: 'each' },
    { id: 'inactive', category: 'ceilings', unit: 'sqft', isActive: false },
  ];
  assert.equal(resolveEstimationTemplateRate({ category: 'trim' }, rates, 'exterior')?.id, 'ext-trim');
  assert.equal(resolveEstimationTemplateRate({ category: 'trim' }, rates, 'interior')?.id, 'int-trim');
  assert.equal(resolveEstimationTemplateRate({ category: 'cabinets' }, rates)?.id, 'cabinets');
  assert.equal(resolveEstimationTemplateRate({ category: 'ceiling' }, rates), undefined);
  assert.equal(resolveEstimationTemplateRate({ category: 'unmapped' }, rates), undefined);
  assert.equal(resolveEstimationTemplateRate({ category: 'walls', productionRateId: 'foreign' }, rates), undefined);
  assert.equal(resolveEstimationTemplateRate({ category: 'walls', unit: 'each' }, rates), undefined);
});

test('template API schema retains rate/product/unit/coating data and validates estimator enums', () => {
  const substrate = {
    category: 'trim', label: 'Trim', quantity: 0, unit: 'linear_ft', coatingWidthInches: 4,
    productionRateId: '33333333-3333-4333-8333-333333333333', materialId: '44444444-4444-4444-8444-444444444444',
    coats: 2, prepLevel: 'light', applicationMethod: 'brush_roll', colorName: 'Swiss Coffee', colorCode: '7002-16',
  };
  const body = { name: 'Room', rooms: [{ name: 'Bedroom', surfaces: [substrate], items: [substrate] }] };
  const parsed = templateSchema.parse(body);
  assert.deepEqual(parsed.rooms[0].surfaces?.[0], substrate);
  assert.deepEqual(parsed.rooms[0].items?.[0], substrate);
  for (const patch of [{ coats: 1.5 }, { prepLevel: 'arbitrary' }, { unit: 'ft' }, { productionRateId: 'not-a-uuid' }]) {
    assert.equal(templateSchema.safeParse({ ...body, rooms: [{ name: 'Bedroom', surfaces: [{ ...substrate, ...patch }] }] }).success, false);
  }
});
