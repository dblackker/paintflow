import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateProductionEstimate, resolveEstimationMeasurement, EstimationInputError,
  formatEstimationMinor, type EstimationSurface, type EstimationMaterial,
} from '../../packages/core/src/estimation';
import { calculateProductionPreview } from '../../packages/core/src/estimation-production';

function paint(patch: Partial<EstimationMaterial> = {}): EstimationMaterial {
  return {
    productId: 'paint-satin', variantId: 'satin-base', sheen: 'satin',
    colorName: 'Swiss Coffee', colorCode: '7002-16', colorSupplier: 'Supplier',
    coverageUnit: 'sqft', coveragePerPack: '400', packSizeGallons: '1',
    costPerPack: '10.01', markupPercent: '0', ...patch,
  };
}

function surface(id: string, patch: Partial<EstimationSurface> = {}): EstimationSurface {
  return {
    id, quantity: '80', unit: 'sqft', coats: 2,
    labor: { productionRatePerHour: '400', sellingRate: '50', prepMultiplier: '1' },
    material: paint(), ...patch,
  };
}

test('compatible 0.4 + 0.4 + 0.4 gallons use two packs, with exact deterministic cents allocation', () => {
  const result = calculateProductionEstimate({ surfaces: [surface('c'), surface('a'), surface('b')] });
  assert.equal(result.purchaseGroups.length, 1);
  assert.equal(result.purchaseGroups[0].theoreticalGallons, '1.2');
  assert.equal(result.purchaseGroups[0].packCount, 2);
  assert.equal(result.purchaseGroups[0].purchasedGallons, '2');
  assert.equal(result.totals.materialCostMinor, 2002);
  assert.deepEqual(Object.fromEntries(result.items.map((item) => [item.id, item.materialCostMinor])), { c: 667, a: 668, b: 667 });
  assert.equal(result.items.reduce((sum, item) => sum + item.materialMinor, 0), result.totals.materialMinor);
  const reordered = calculateProductionEstimate({ surfaces: [surface('a'), surface('b'), surface('c')] });
  assert.deepEqual(reordered.items.map((item) => item.materialMinor), [668, 667, 667]);
});

test('different colors, variants, sheens, phases, and restrictions cannot share purchase rounding', () => {
  for (const patch of [
    { colorCode: '7002-17' }, { variantId: 'flat-base' }, { sheen: 'flat' },
    { phase: 'primer' as const }, { substrateRestriction: 'metal only' },
  ]) {
    const result = calculateProductionEstimate({ surfaces: [surface('a'), surface('b', { material: paint(patch) })] });
    assert.equal(result.purchaseGroups.length, 2);
    assert.equal(result.totals.materialCostMinor, 2002);
  }
});

test('unknown colors are isolated instead of silently assuming they match', () => {
  const unknown = paint({ colorName: '', colorCode: '' });
  const result = calculateProductionEstimate({ surfaces: [surface('a', { material: unknown }), surface('b', { material: unknown })] });
  assert.equal(result.purchaseGroups.length, 2);
  assert.equal(result.warnings.filter((warning) => warning.code === 'UNKNOWN_COLOR').length, 2);
  const tbd = paint({ colorName: 'TBD', colorCode: '' });
  assert.equal(calculateProductionEstimate({ surfaces: [surface('a', { material: tbd }), surface('b', { material: tbd })] }).purchaseGroups.length, 2);
});

test('pack size and allowance are explicit and applied before purchase rounding', () => {
  const result = calculateProductionEstimate({ surfaces: [surface('a', {
    quantity: '180', material: paint({ coveragePerPack: '100', packSizeGallons: '0.25', allowancePercent: '10' }),
  })] });
  assert.equal(result.purchaseGroups[0].theoreticalPacks, '3.96');
  assert.equal(result.purchaseGroups[0].packCount, 4);
  assert.equal(result.purchaseGroups[0].purchasedGallons, '1');
  assert.equal(result.purchaseGroups[0].allowancePercent, '10');
});

test('zero quantity has zero labor, paint, and cost even with positive adjustment hours', () => {
  const result = calculateProductionEstimate({ surfaces: [surface('zero', {
    quantity: '0', unit: 'linear_ft', labor: { productionRatePerHour: '50', sellingRate: '65', adjustmentHours: '5' },
  })] });
  assert.equal(result.totals.totalMinor, 0);
  assert.equal(result.totals.hours, '0');
  assert.equal(result.purchaseGroups[0].packCount, 0);
});

test('linear feet and counts convert to coating area only with explicit dimensions', () => {
  const result = calculateProductionEstimate({ surfaces: [
    surface('trim', { quantity: '100', unit: 'linear_ft', coatingWidthInches: '6' }),
    surface('doors', { quantity: '2', unit: 'each', coatingSqFtPerItem: '42' }),
  ] });
  assert.equal(result.items[0].theoreticalGallons, '0.25');
  assert.equal(result.items[1].theoreticalGallons, '0.42');
  assert.equal(result.purchaseGroups[0].theoreticalGallons, '0.67');
  assert.equal(result.purchaseGroups[0].packCount, 1);
  assert.throws(() => calculateProductionEstimate({ surfaces: [surface('trim', { unit: 'linear_ft' })] }), /painted width/);
  assert.throws(() => calculateProductionEstimate({ surfaces: [surface('doors', { unit: 'each' })] }), /square feet per item/);
});

test('a product can carry an explicit linear/count coverage rate, never square feet by accident', () => {
  const result = calculateProductionEstimate({ surfaces: [surface('trim', {
    quantity: '100', unit: 'linear_ft', material: paint({ coverageUnit: 'linear_ft', coveragePerPack: '500' }),
  })] });
  assert.equal(result.items[0].theoreticalGallons, '0.4');
  assert.throws(() => calculateProductionEstimate({ surfaces: [surface('walls', {
    material: paint({ coverageUnit: 'each' }),
  })] }), /coverage unit must match/);
});

test('money and quantities retain decimal accuracy, tax representation is explicit', () => {
  for (const taxRate of [{ kind: 'fraction' as const, value: '0.092' }, { kind: 'percent' as const, value: '9.2' }]) {
    const result = calculateProductionEstimate({
      surfaces: [], adjustments: [{ id: 'a', quantity: '1', unitPrice: '100' }], taxRate,
    });
    assert.equal(result.totals.subtotalMinor, 10000);
    assert.equal(result.totals.taxMinor, 920);
    assert.equal(result.totals.totalMinor, 10920);
    assert.equal(formatEstimationMinor(result.totals.totalMinor), '109.20');
  }
  const fraction = calculateProductionEstimate({ surfaces: [], adjustments: [{ id: 'a', quantity: '0.25', unitPrice: '0.10' }] });
  assert.equal(fraction.totals.subtotalMinor, 3);
  assert.equal(formatEstimationMinor(29), '0.29');
});

test('discount and fractional tax allocate exact cents and reconcile every line to the total', () => {
  const result = calculateProductionEstimate({
    surfaces: [], adjustments: ['c', 'a', 'b'].map((id) => ({ id, quantity: '1', unitPrice: '10.01' })),
    discount: '2.01', taxRate: { value: '0.092', kind: 'fraction' },
  });
  assert.equal(result.totals.subtotalMinor, 3003);
  assert.equal(result.totals.discountMinor, 201);
  assert.equal(result.totals.taxMinor, 258);
  assert.equal(result.totals.totalMinor, 3060);
  assert.equal(result.items.reduce((sum, item) => sum + item.discountMinor, 0), 201);
  assert.equal(result.items.reduce((sum, item) => sum + item.taxMinor, 0), 258);
  assert.equal(result.items.reduce((sum, item) => sum + item.totalMinor, 0), 3060);
});

test('unselected optional substrates do not inflate the base purchase, labor, or tax', () => {
  const result = calculateProductionEstimate({
    surfaces: [surface('base'), surface('option', { optional: true })], taxRate: { value: '0.092', kind: 'fraction' },
  });
  const base = calculateProductionEstimate({ surfaces: [surface('base')], taxRate: { value: '0.092', kind: 'fraction' } });
  assert.deepEqual(result.totals.totalMinor, base.totals.totalMinor);
  assert.equal(result.totals.materialCostMinor, base.totals.materialCostMinor);
  assert.equal(result.totals.hours, base.totals.hours);
  assert.equal(result.purchaseGroups.length, 2);
  assert.equal(result.totals.optionalSubtotalMinor, 3001);
  assert.equal(result.totals.optionalTaxMinor, 276);
  const selected = calculateProductionEstimate({ surfaces: [surface('base'), surface('option', { optional: true, selected: true })] });
  assert.equal(selected.purchaseGroups.length, 1);
  assert.equal(selected.purchaseGroups[0].packCount, 1);
});

test('acquisition and selling price stay separate; unknown burdened labor is not invented', () => {
  const result = calculateProductionEstimate({ surfaces: [surface('a', { material: paint({ markupPercent: '30' }) })] });
  assert.equal(result.totals.materialCostMinor, 1001);
  assert.equal(result.totals.materialMinor, 1301);
  assert.equal(result.totals.laborBudgetMinor, null);
  const known = calculateProductionEstimate({ surfaces: [surface('a', {
    labor: { productionRatePerHour: '400', sellingRate: '50', burdenedRate: '25' },
  })] });
  assert.equal(known.totals.laborMinor, 2000);
  assert.equal(known.totals.laborBudgetMinor, 1000);
});

test('measurement overrides include zero and dimension products are exact', () => {
  assert.equal(resolveEstimationMeasurement({ unit: 'sqft', width: '10', height: '12', quantity: '0' }).quantity, '0');
  assert.equal(resolveEstimationMeasurement({ unit: 'sqft', width: '0.3', height: '0.3' }).quantity, '0.09');
  assert.equal(resolveEstimationMeasurement({ unit: 'sqft', width: '0.123456', height: '0.123456' }).quantity, '0.015241383936');
  assert.equal(resolveEstimationMeasurement({ unit: 'linear_ft', width: '80' }).quantity, '80');
  assert.equal(resolveEstimationMeasurement({ unit: 'each', quantity: '2' }).quantity, '2');
});

test('production preview resolves pricebook snapshots, configured prep, and sub-one productivity rates', () => {
  const preview = calculateProductionPreview({ items: [{
    id: 'cabinet', productionRateId: 'cabinet-rate', quantity: '2', coats: 1, prepLevel: 'light',
  }] }, {
    rates: [{ id: 'cabinet-rate', unit: 'each', ratePerHour: '0.5', hourlyRate: '50', prepMultiplier: '1' }],
    materials: [], settings: { materialMarkupPercent: '30', salesTaxRate: '0.0920' },
  });
  assert.equal(preview.calculation.totals.hours, '4');
  assert.equal(preview.calculation.totals.laborMinor, 20000);
  assert.equal(preview.resolvedInput.surfaces[0].materialAllowance?.costPerMeasuredUnit, '8');
  const withPrep = calculateProductionPreview({ items: [{ id: 'wall', productionRateId: 'wall', quantity: '80', coats: 1 }] }, {
    rates: [{ id: 'wall', unit: 'sqft', ratePerHour: '400', hourlyRate: '65', prepMultiplier: '1.1' }],
    materials: [], settings: {},
  });
  assert.equal(withPrep.calculation.totals.hours, '0.264');
  assert.equal(withPrep.calculation.totals.laborMinor, 1716);
});

test('catalog adapter honors coverage per purchased pack and tenant/active catalog lookup', () => {
  const catalog = {
    rates: [{ id: 'walls', unit: 'sqft', ratePerHour: '400', hourlyRate: '50', coats: 2 }],
    materials: [{ id: 'quart', unit: 'quart', coverageSqFt: '100', costPerUnit: '8.99', markupPercent: '0' }], settings: {},
  };
  const result = calculateProductionPreview({ items: ['a', 'b', 'c'].map((id) => ({
    id, productionRateId: 'walls', quantity: '80', materialId: 'quart', colorName: 'White',
  })) }, catalog).calculation;
  assert.equal(result.purchaseGroups[0].packCount, 5);
  assert.equal(result.purchaseGroups[0].purchasedGallons, '1.25');
  assert.equal(result.totals.materialCostMinor, 4495);
  assert.throws(() => calculateProductionPreview({ items: [{ id: 'a', productionRateId: 'other-tenant' }] }, catalog), /unavailable/);
  assert.throws(() => calculateProductionPreview({ items: [{ id: 'a', productionRateId: 'walls', materialId: 'other-tenant' }] }, catalog), /unavailable/);
  assert.throws(() => calculateProductionPreview({ items: [{ id: 'a', productionRateId: 'walls', unit: 'each' }] }, catalog), /does not match/);
  assert.throws(() => calculateProductionPreview({ items: [{ id: 'a', productionRateId: 'walls' }] }, {
    ...catalog, rates: [{ ...catalog.rates[0], isActive: false }],
  }), /unavailable/);
});

test('invalid quantities, monetary precision, units, rates, coats, currency, and discounts fail clearly', () => {
  for (const quantity of ['-1', 'abc', '1,000', 'Infinity', '1e2', NaN, Infinity]) {
    assert.throws(() => calculateProductionEstimate({ surfaces: [surface('a', { quantity })] }), EstimationInputError);
  }
  for (const coats of [0, 4, 1.5]) assert.throws(() => calculateProductionEstimate({ surfaces: [surface('a', { coats })] }), /coats/);
  assert.throws(() => calculateProductionEstimate({ surfaces: [surface('a', { labor: { productionRatePerHour: '0', sellingRate: '65' } })] }), /greater than zero/);
  assert.throws(() => calculateProductionEstimate({ surfaces: [surface('a', { material: paint({ costPerPack: '10.001' }) })] }), /decimal places/);
  assert.throws(() => calculateProductionEstimate({ surfaces: [surface('a', { unit: 'feet' as never })] }), /square feet/);
  assert.throws(() => calculateProductionEstimate({ surfaces: [], currency: 'EUR' as never }), /Only USD/);
  assert.throws(() => calculateProductionEstimate({ surfaces: [], discount: '1' }), /cannot exceed/);
  assert.throws(() => calculateProductionEstimate({ surfaces: [surface('a'), surface('a')] }), /unique ID/);
  assert.throws(() => calculateProductionEstimate({ surfaces: [], taxRate: { value: '9.2', kind: 'fraction' } }), /100%/);
  assert.throws(() => calculateProductionEstimate({ surfaces: [], adjustments: [{ id: 'huge', quantity: '2', unitPrice: '99999999.99' }] }), /supported estimate limit/);
});
