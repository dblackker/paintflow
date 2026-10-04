import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateProductionEstimate, EstimationInputError,
  type EstimationMaterial, type EstimationSurface, type EstimationRequest,
} from '../../packages/core/src/estimation';
import {
  calculateProductionPreview, type ProductionPreviewCatalog, type ProductionPreviewRequest,
} from '../../packages/core/src/estimation-production';
import { calculateQuickEstimate } from '../../packages/core/src/estimation-quick';

function paint(patch: Partial<EstimationMaterial> = {}): EstimationMaterial {
  return {
    productId: 'paint', variantId: 'satin-base', sheen: 'satin', colorSupplier: 'Supplier', colorCode: 'W1', colorName: 'White',
    coveragePerGallon: '400', coverageUnit: 'sqft', packSizeGallons: '1', costPerPack: '50', markupPercent: '30', ...patch,
  };
}

function wall(id = 'wall', patch: Partial<EstimationSurface> = {}): EstimationSurface {
  return {
    id, quantity: '80', unit: 'sqft', coats: 2,
    labor: { productionRatePerHour: '400', rateBasis: 'complete_system', sellingRate: '65', burdenedRate: '30' },
    material: paint(), ...patch,
  };
}

function calculate(surfaces: EstimationSurface[], patch: Partial<EstimationRequest> = {}) {
  return calculateProductionEstimate({ calculationVersion: 'repaint-v2', surfaces, ...patch });
}

function catalog(patch: Partial<ProductionPreviewCatalog> = {}): ProductionPreviewCatalog {
  return {
    rates: [{ id: 'wall', unit: 'sqft', ratePerHour: '80', rateBasis: 'complete_system', coatRates: { 1: '100', 2: '80', 3: '60' },
      hourlyRate: '65', sellingRateSource: 'inherit', burdenedRate: '30', applicationMethod: 'spray_only', rateVersion: 'r2',
      provenance: { source: 'contractor_calibration', version: 'r2' } }],
    materials: [{ id: 'paint', brand: 'Supplier', sku: 'satin-base', sheen: 'satin', unit: 'gallon',
      coverageBasis: 'per_gallon', coveragePerGallon: '350', costPerUnit: '50', markupPercent: '30',
      provenance: { source: 'contractor_invoice', priceDate: '2026-10-01', coverageSource: 'contractor_calibration' } }],
    settings: { defaultLaborRate: '90', defaultBurdenedLaborRate: '40' }, ...patch,
  };
}

test('v1 default and explicit v1 keep exact historical labor, material, and cents results', () => {
  const request: EstimationRequest = {
    surfaces: [wall('wall', {
      quantity: '768', labor: { productionRatePerHour: '80', sellingRate: '65', prepMultiplier: '1.2', productivity: '1.6' },
      material: paint({ coveragePerGallon: undefined, coveragePerPack: '350' }),
    })], discount: '2.01', taxRate: { kind: 'fraction', value: '0.092' },
  };
  const result = calculateProductionEstimate(request);
  assert.deepEqual(calculateProductionEstimate({ ...request, calculationVersion: 'repaint-v1' }), result);
  // 768 / (80 * 1.6) * 2 * 1.2 = 14.4 hours, legacy per-pack coverage.
  assert.equal(result.calculationVersion, 'repaint-v1');
  assert.equal(result.totals.hours, '14.4');
  assert.equal(result.totals.laborMinor, 93600);
  assert.equal(result.totals.materialMinor, 32500);
  assert.equal(result.totals.taxMinor, 11583);
  assert.equal(result.totals.totalMinor, 137482);
  assert.equal('costComplete' in result.totals, false);
});

test('complete 768 sqft two-coat rate is 9.6 hours; one-coat coverage keeps demand independent', () => {
  const result = calculate([wall('wall', {
    quantity: '768', labor: { productionRatePerHour: '80', rateBasis: 'complete_system', sellingRate: '65', burdenedRate: '30' },
    material: paint({ coveragePerGallon: '350' }),
  })]);
  assert.equal(result.calculationVersion, 'repaint-v2');
  assert.equal(result.totals.hours, '9.6');
  assert.equal(result.totals.laborMinor, 62400);
  assert.equal(result.totals.laborBudgetMinor, 28800);
  assert.equal(result.totals.theoreticalGallons, '4.38857143');
  assert.equal(result.totals.purchasedGallons, '5');
  assert.equal(result.totals.materialCostMinor, 25000);
  assert.equal(result.totals.materialMinor, 32500);
  assert.equal(result.totals.directCostMinor, 53800);
  assert.equal(result.totals.grossMarginMinor, 41100);
  assert.equal(result.totals.grossMarginPercent, '43.30874605');
});

test('successive-pass rates add prep, masking, and cut-in once instead of multiplying them by coats', () => {
  const build = (coats: number) => wall('room', {
    quantity: '1000', coats, coatingLayers: [],
    operations: [
      { id: 'paint', kind: 'application', coats, labor: { productionRatePerHour: '100', rateBasis: 'legacy_per_coat',
        coatRates: { 1: '100', 2: '150', 3: '200' }, sellingRate: '65', burdenedRate: '30' } },
      { id: 'prep', kind: 'prep', hours: '4' },
      { id: 'mask', kind: 'masking', hours: '2', description: 'Mask the separate ceiling color' },
      { id: 'ceiling-edge', kind: 'cut_in', hours: '1', description: 'Cut in the wall and ceiling boundary' },
    ], colorRelationship: 'different',
  });
  const two = calculate([build(2)]);
  // 1000/100 + 1000/150 + 4 + 2 + 1 = 23 2/3 labor-hours.
  assert.equal(two.totals.hours, '23.66666667');
  assert.equal(two.totals.laborMinor, 153833);
  assert.equal(two.totals.laborBudgetMinor, 71000);
  assert.deepEqual(two.items[0].operations!.map((operation) => operation.id), ['paint', 'prep', 'mask', 'ceiling-edge']);
  assert.equal(two.items[0].operations![2].description, 'Mask the separate ceiling color');
  assert.equal(two.items[0].operations![3].description, 'Cut in the wall and ceiling boundary');
  const three = calculate([build(3)]);
  assert.equal(three.totals.hours, '28.66666667');
  assert.equal(three.totals.laborMinor - two.totals.laborMinor, 32500);
  assert.deepEqual(three.items[0].operations!.slice(1).map((operation) => operation.hours), ['4', '2', '1']);
});

test('method-calibrated catalog rate has no universal spray boost or heavy prep multiplier', () => {
  const request: ProductionPreviewRequest = { calculationVersion: 'repaint-v2', items: [{
    id: 'room', productionRateId: 'wall', quantity: '768', coats: 2, prepLevel: 'heavy', applicationMethod: 'spray_only',
    materialId: 'paint', colorCode: 'W1', prepAdjustmentHours: '4',
  }] };
  const preview = calculateProductionPreview(request, catalog());
  assert.equal(preview.calculation.totals.hours, '13.6');
  assert.equal(preview.calculation.totals.laborMinor, 122400);
  const operation = preview.calculation.items[0].operations![0];
  assert.equal(operation.selectedRate, '80');
  assert.equal(operation.applicationMethod, 'spray_only');
  assert.equal(operation.rateVersion, 'r2');
  assert.equal(operation.sellingRateSource, 'inherit');
  assert.equal(operation.burdenedRate, '30');
  assert.equal(preview.resolvedInput.surfaces[0].labor.prepMultiplier, undefined);
  assert.throws(() => calculateProductionPreview({ ...request, items: [{ ...request.items[0], applicationMethod: 'brush_roll' }] }, catalog()), /calibrated/);
});

test('sell inheritance and burdened cost resolve independently with intentional overrides', () => {
  const book = catalog();
  book.rates[0].burdenedRateSource = 'inherit';
  const request: ProductionPreviewRequest = { calculationVersion: 'repaint-v2', items: [{ id: 'room', productionRateId: 'wall', quantity: '80', coats: 2, coatingLayers: [] }] };
  let result = calculateProductionPreview(request, book).calculation;
  assert.equal(result.totals.laborMinor, 9000);
  assert.equal(result.totals.laborBudgetMinor, 4000);
  book.rates[0].sellingRateSource = 'override';
  result = calculateProductionPreview(request, book).calculation;
  assert.equal(result.totals.laborMinor, 6500);
  assert.equal(result.totals.laborBudgetMinor, 4000);
  result = calculateProductionPreview({ ...request, items: [{ ...request.items[0], sellingRate: '100', burdenedRate: '25' }] }, book).calculation;
  assert.equal(result.totals.laborMinor, 10000);
  assert.equal(result.totals.laborBudgetMinor, 2500);
  assert.equal(result.items[0].operations![0].sellingRateSource, 'override');
});

test('hours per item table represents the selected whole system, including explicit door faces', () => {
  const result = calculate([wall('door-faces', {
    quantity: '4', unit: 'each', coats: 2, coatingSqFtPerItem: '21',
    labor: { productionRatePerHour: '1', rateBasis: 'hours_per_item', coatRates: { 1: '0.5', 2: '0.75' }, sellingRate: '65', burdenedRate: '30' },
  })]);
  // Four faces * .75 hour/face = 3 hours; 4*21*2/400 = .42 gallons.
  assert.equal(result.totals.hours, '3');
  assert.equal(result.totals.theoreticalGallons, '0.42');
  assert.equal(result.totals.laborMinor, 19500);
  assert.equal(result.totals.laborBudgetMinor, 9000);
  assert.throws(() => calculate([wall('wall', { labor: { ...wall().labor, rateBasis: 'hours_per_item' } })]), /item-count/);
});

test('primer plus finish retain separate products, layer coats, and labor operations', () => {
  const result = calculate([wall('room', {
    quantity: '1000',
    operations: [
      { id: 'prime', kind: 'primer', coats: 1, labor: { productionRatePerHour: '200', rateBasis: 'complete_system', sellingRate: '65', burdenedRate: '30' } },
      { id: 'finish', kind: 'application', coats: 2, labor: { productionRatePerHour: '100', rateBasis: 'complete_system', sellingRate: '65', burdenedRate: '30' } },
    ],
    coatingLayers: [
      { id: 'primer', phase: 'primer', coats: 1, material: paint({ productId: 'primer', coveragePerGallon: '250', costPerPack: '20' }) },
      { id: 'finish', phase: 'finish', coats: 2, material: paint() },
    ],
  })]);
  assert.equal(result.totals.hours, '15');
  assert.deepEqual(result.items[0].layers!.map((layer) => [layer.productId, layer.theoreticalGallons]), [['primer', '4'], ['paint', '5']]);
  assert.equal(result.purchaseGroups.length, 2);
  assert.equal(result.totals.materialCostMinor, 33000);
  assert.equal(result.totals.materialMinor, 42900);
  assert.equal(result.totals.directCostMinor, 78000);
  assert.equal(result.totals.grossMarginMinor, 62400);
});

test('labor takeoff and net coating takeoff are independent, including spot primer', () => {
  const result = calculate([wall('room', {
    quantity: '1000', coatingLayers: [
      { id: 'spot', phase: 'primer', coats: 1, quantity: '100', material: paint({ productId: 'primer', coveragePerGallon: '200' }) },
      { id: 'net-finish', phase: 'finish', coats: 2, quantity: '900', material: paint() },
    ],
  })]);
  assert.equal(result.totals.hours, '2.5');
  assert.deepEqual(result.items[0].layers!.map((layer) => layer.theoreticalGallons), ['0.5', '4.5']);
});

test('canonical supplier and code override name spelling; pooled .4+.4+.4 purchase allocation reconciles', () => {
  const surfaces = ['c', 'a', 'b'].map((id, index) => wall(id, { material: paint({ costPerPack: '10.01', markupPercent: '0', colorName: ['White', 'WHITE', 'Different spelling'][index] }) }));
  const result = calculate(surfaces);
  assert.equal(result.purchaseGroups.length, 1);
  assert.equal(result.purchaseGroups[0].theoreticalGallons, '1.2');
  assert.equal(result.purchaseGroups[0].packCount, 2);
  assert.equal(result.totals.materialCostMinor, 2002);
  assert.deepEqual(Object.fromEntries(result.items.map((item) => [item.id, item.materialCostMinor])), { c: 667, a: 668, b: 667 });
  assert.deepEqual(calculate([...surfaces].reverse()).items.map((item) => item.materialCostMinor), [667, 668, 667]);
});

test('unknown colors stay isolated unless an explicit provisional group is compatible', () => {
  const unknown = paint({ colorCode: '', colorName: 'TBD' });
  const result = calculate(['a', 'b', 'c'].map((id) => wall(id, { material: unknown })));
  assert.equal(result.purchaseGroups.length, 3);
  assert.equal(result.totals.materialCostMinor, 15000);
  const shared = { ...unknown, provisionalColorGroup: 'main walls' };
  const pooled = calculate(['a', 'b', 'c'].map((id) => wall(id, { material: shared })));
  assert.equal(pooled.purchaseGroups.length, 1);
  assert.equal(pooled.totals.materialCostMinor, 10000);
  assert.equal(pooled.warnings.filter((warning) => warning.code === 'PROVISIONAL_COLOR_GROUP').length, 3);
  for (const patch of [
    { colorCode: 'W2' }, { colorSupplier: 'Other Supplier' }, { variantId: 'deep-base' }, { sheen: 'flat' },
    { phase: 'primer' as const }, { substrateRestriction: 'metal' }, { provisionalColorGroup: 'ceilings' },
  ]) {
    const base = 'provisionalColorGroup' in patch ? shared : paint();
    assert.equal(calculate([wall('a', { material: base }), wall('b', { material: { ...base, ...patch } })]).purchaseGroups.length, 2);
  }
});

test('per-layer loss changes order but not theoretical consumption; compatible losses still pool', () => {
  const result = calculate([
    wall('a', { quantity: '100', coats: 1, material: paint({ lossAllowancePercent: '10' }) }),
    wall('b', { quantity: '100', coats: 1, material: paint({ lossAllowancePercent: '20' }) }),
  ]);
  assert.equal(result.purchaseGroups.length, 1);
  assert.equal(result.totals.theoreticalGallons, '0.5');
  assert.equal(result.totals.orderGallons, '0.575');
  assert.equal(result.totals.purchasedGallons, '1');
  assert.equal(result.purchaseGroups[0].allowancePercent, '15');
  assert.equal(result.purchaseGroups[0].leftoverGallons, '0.425');
});

test('purchase is default; consumption selling does not change whole-pack acquisition or margin cost', () => {
  const surfaces = ['a', 'b', 'c'].map((id) => wall(id));
  const purchase = calculate(surfaces);
  const consumption = calculate(surfaces, { materialSellingPolicy: 'consumption' });
  assert.equal(purchase.materialSellingPolicy, 'purchase');
  assert.equal(purchase.totals.consumptionCostMinor, 6000);
  assert.equal(purchase.totals.materialMinor, 13000);
  assert.equal(consumption.totals.materialMinor, 7800);
  assert.equal(consumption.totals.acquisitionCostMinor, 10000);
  assert.equal(consumption.totals.materialCostMinor, 10000);
  assert.equal(consumption.totals.directCostMinor, 11800);
  assert.equal(consumption.totals.grossMarginMinor, -100);
  assert.equal(consumption.totals.grossMarginPercent, '-0.85470085');
});

test('quart and five-gallon coverage normalize per gallon versus per pack without double conversion', () => {
  for (const [pack, perPack, expectedCount, gallons, cost] of [
    ['0.25', '100', 5, '1.25', 4495], ['5', '2000', 1, '5', 899],
  ] as const) {
    for (const coverage of [{ coveragePerGallon: '400' }, { coveragePerGallon: undefined, coveragePerPack: perPack }]) {
      const result = calculate(['a', 'b', 'c'].map((id) => wall(id, { material: paint({ ...coverage, packSizeGallons: pack, costPerPack: '8.99' }) })));
      assert.equal(result.purchaseGroups[0].coveragePerGallon, '400');
      assert.equal(result.purchaseGroups[0].packCount, expectedCount);
      assert.equal(result.totals.theoreticalGallons, '1.2');
      assert.equal(result.totals.purchasedGallons, gallons);
      assert.equal(result.totals.materialCostMinor, cost);
    }
  }
});

test('catalog per-gallon versus historical per-pack basis is explicit and snapshots price provenance', () => {
  for (const [unit, coverageSqFt, coverageBasis] of [
    ['quart', '100', 'per_pack'], ['quart', '400', 'per_gallon'], ['5 gallon', '2000', 'per_pack'],
  ] as const) {
    const book = catalog({ materials: [{ id: 'paint', unit, coverageSqFt, coverageBasis, costPerUnit: '50',
      provenance: { source: 'contractor_invoice', priceDate: '2026-10-01' } }] });
    const result = calculateProductionPreview({ calculationVersion: 'repaint-v2', items: [{ id: 'room', productionRateId: 'wall', quantity: '80', materialId: 'paint' }] }, book);
    assert.equal(result.calculation.items[0].layers![0].coveragePerGallon, '400');
    assert.equal(result.calculation.items[0].layers![0].provenance!.priceDate, '2026-10-01');
    assert.equal(result.resolvedInput.surfaces[0].coatingLayers![0].material.coverageBasis, coverageBasis);
  }
});

test('typed extras budget known nonlabor cost plus hours; omitted or flagged cost makes margin unknown', () => {
  const request: Partial<EstimationRequest> = { adjustments: [{ id: 'mobilization', quantity: '2', unitPrice: '200', costPerUnit: '40', hoursPerUnit: '1.5', burdenedRate: '30' }] };
  const result = calculate([], request);
  assert.equal(result.totals.hours, '3');
  assert.equal(result.totals.extraCostMinor, 8000);
  assert.equal(result.totals.laborBudgetMinor, 9000);
  assert.equal(result.totals.directCostMinor, 17000);
  assert.equal(result.totals.grossMarginMinor, 23000);
  for (const patch of [{ costPerUnit: undefined }, { costUnknown: true }]) {
    const unknown = calculate([], { adjustments: [{ ...request.adjustments![0], ...patch }] });
    assert.equal(unknown.totals.costComplete, false);
    assert.equal(unknown.totals.directCostMinor, null);
    assert.equal(unknown.totals.knownDirectCostMinor, 9000);
    assert.equal(unknown.totals.grossMarginMinor, null);
    assert.equal(unknown.totals.grossMarginPercent, null);
    assert.deepEqual(unknown.totals.missingCostComponents, ['mobilization.costPerUnit']);
  }
});

test('missing labor, material price, or product cannot fabricate complete cost or margin', () => {
  for (const surface of [
    wall('room', { labor: { ...wall().labor, burdenedRate: undefined } }),
    wall('room', { material: paint({ costPerPack: undefined }) }),
    wall('room', { material: undefined }),
  ]) {
    const result = calculate([surface]);
    assert.equal(result.totals.costComplete, false);
    assert.equal(result.totals.directCostMinor, null);
    assert.equal(result.totals.grossMarginMinor, null);
    assert.equal(result.totals.missingCostComponents!.length, 1);
    assert.ok(result.warnings.some((warning) => warning.code === 'UNKNOWN_COST'));
  }
  const noCost = calculate([wall('room', { material: paint({ costPerPack: undefined }) })]);
  assert.equal(noCost.purchaseGroups[0].acquisitionBudgetMinor, null);
  assert.equal(noCost.items[0].layers![0].acquisitionCostMinor, null);
  assert.equal(noCost.totals.acquisitionCostMinor, null);
});

test('optional costs and purchase plans stay isolated until selected, including unknown-cost options', () => {
  const base = wall('base');
  const option = wall('option', { optional: true, material: paint({ costPerPack: undefined }) });
  const result = calculate([base, option]);
  const { optionalSubtotalMinor, optionalTaxMinor, ...includedTotals } = result.totals;
  const { optionalSubtotalMinor: baseOptional, optionalTaxMinor: baseOptionalTax, ...baseTotals } = calculate([base]).totals;
  assert.deepEqual(includedTotals, baseTotals);
  assert.equal(optionalSubtotalMinor, 1300);
  assert.equal(optionalTaxMinor + baseOptional + baseOptionalTax, 0);
  assert.equal(result.items[1].costComplete, false);
  assert.equal(result.purchaseGroups.length, 2);
  assert.equal(calculate([base, { ...option, selected: true }]).totals.grossMarginMinor, null);
  const pooled = calculate([base, wall('option', { optional: true, selected: true })]);
  assert.equal(pooled.purchaseGroups.length, 1);
  assert.equal(pooled.purchaseGroups[0].packCount, 1);
});

test('discount reduces margin revenue, tax does not; cents still reconcile all included items', () => {
  const result = calculate([], {
    adjustments: ['c', 'a', 'b'].map((id) => ({ id, quantity: '1', unitPrice: '10.01', costPerUnit: '5' })),
    discount: '2.01', taxRate: { kind: 'fraction', value: '0.092' },
  });
  assert.equal(result.totals.subtotalMinor, 3003);
  assert.equal(result.totals.discountMinor, 201);
  assert.equal(result.totals.taxMinor, 258);
  assert.equal(result.totals.totalMinor, 3060);
  assert.equal(result.totals.directCostMinor, 1500);
  assert.equal(result.totals.grossMarginMinor, 1302);
  assert.equal(result.totals.grossMarginPercent, '46.46680942');
  for (const field of ['discountMinor', 'taxMinor', 'totalMinor'] as const) {
    assert.equal(result.items.reduce((sum, item) => sum + item[field], 0), result.totals[field]);
  }
});

test('zero measured quantity has no implicit demand; explicitly scoped setup still happens once', () => {
  const zero = calculate([wall('room', { quantity: '0', material: paint({ costPerPack: undefined }), labor: { ...wall().labor, burdenedRate: undefined } })]);
  assert.equal(zero.totals.totalMinor, 0);
  assert.equal(zero.totals.hours, '0');
  assert.equal(zero.totals.costComplete, true);
  const setup = calculate([wall('room', { quantity: '0', operations: [{ id: 'setup', kind: 'setup', hours: '2' }] })]);
  assert.equal(setup.totals.hours, '2');
  assert.equal(setup.totals.laborMinor, 13000);
  assert.equal(setup.totals.directCostMinor, 6000);
});

test('v2 quick conversion preserves known budgets and exact authoritative calculation parity', () => {
  const policy = { calculationVersion: 'repaint-v2' as const, laborRate: '65', burdenedLaborRate: '30', materialMarkupPercent: '30', salesTaxRate: '0.092', depositPercent: '50' };
  const quick = calculateQuickEstimate([{ id: 'room', quantity: '2', laborHoursPerUnit: '1.5', materialCostPerUnit: '40' }], policy);
  // Unit sell = 1.5*65 + 40*1.3 = 149.50; two units = 299, direct cost = 170.
  assert.equal(quick.calculation.totals.totalMinor, 32651);
  assert.equal(quick.calculation.totals.hours, '3');
  assert.equal(quick.calculation.totals.directCostMinor, 17000);
  assert.equal(quick.calculation.totals.grossMarginMinor, 12900);
  assert.equal(quick.totals.depositMinor, 16326);
  const persisted = calculateProductionPreview(quick.productionInput, { rates: [], materials: [], settings: { salesTaxRate: policy.salesTaxRate } });
  assert.deepEqual(persisted.calculation, quick.calculation);
  assert.deepEqual(persisted.resolvedInput, quick.resolvedInput);
});

test('v2 quick zero selling price does not discard explicit hours or unknown budget', () => {
  const quick = calculateQuickEstimate([{ id: 'free', quantity: '1', laborHoursPerUnit: '2', materialCostPerUnit: '0' }], {
    calculationVersion: 'repaint-v2', laborRate: '0', materialMarkupPercent: '0', salesTaxRate: '0',
  });
  assert.equal(quick.calculation.totals.hours, '2');
  assert.equal(quick.calculation.totals.laborBudgetMinor, null);
  assert.equal(quick.calculation.totals.costComplete, false);
  assert.equal(quick.calculation.totals.grossMarginMinor, null);
});

test('v2 invalid basis, missing coat entries, negative corrections, and duplicate component IDs fail', () => {
  assert.throws(() => calculate([wall('room', { labor: { ...wall().labor, rateBasis: 'bad' as never } })]), EstimationInputError);
  assert.throws(() => calculate([wall('room', { labor: { ...wall().labor, coatRates: { 1: '100' } } })]), /selected coat count/);
  assert.throws(() => calculate([wall('room', { labor: { ...wall().labor, adjustmentHours: '-1' } })]), /negative/);
  assert.throws(() => calculate([wall('room', { operations: [{ id: 'prep', kind: 'prep', hours: '1' }, { id: 'prep', kind: 'prep', hours: '1' }] })]), /unique ID/);
  assert.throws(() => calculate([wall('room', { coatingLayers: [{ id: 'paint', phase: 'finish', coats: 2, material: paint() }, { id: 'paint', phase: 'finish', coats: 2, material: paint() }] })]), /unique ID/);
  assert.throws(() => calculate([wall('room', { material: paint({ lossAllowancePercent: '101' }) })]), /percentage/);
  assert.throws(() => calculate([], { materialSellingPolicy: 'bad' as never }), /purchase or consumption/);
});

test('full supported v2 substrate count reuses commercial cents allocation without adjustment limits', () => {
  const result = calculate(Array.from({ length: 500 }, (_, index) => wall(`wall-${index}`)));
  assert.equal(result.items.length, 500);
  assert.equal(result.purchaseGroups.length, 1);
  assert.equal(result.totals.hours, '100');
  assert.equal(result.totals.purchasedGallons, '200');
  assert.equal(result.totals.materialCostMinor, 1000000);
});

test('organization burdened alias honors an explicit null instead of inventing cost from older defaults', () => {
  const book = catalog();
  book.rates[0].burdenedRateSource = 'inherit';
  book.settings.defaultBurdenedRate = '25';
  const request: ProductionPreviewRequest = { calculationVersion: 'repaint-v2', items: [{ id: 'room', productionRateId: 'wall', quantity: '80', coats: 2, coatingLayers: [] }] };
  assert.equal(calculateProductionPreview(request, book).calculation.totals.laborBudgetMinor, 2500);
  book.settings.defaultBurdenedRate = null;
  const unknown = calculateProductionPreview(request, book).calculation;
  assert.equal(unknown.totals.laborBudgetMinor, null);
  assert.equal(unknown.totals.grossMarginMinor, null);
});

test('v2 configured mobilization is labor once and minimum is an explicit commercial floor', () => {
  const book = catalog({ rates: [], materials: [], settings: {
    defaultLaborRate: '65', defaultBurdenedRate: '30', minimumPrice: '500', mobilizationHours: '2', priceStaleDays: 90,
  } });
  const result = calculateProductionPreview({ calculationVersion: 'repaint-v2', items: [], discount: '25' }, book).calculation;
  assert.deepEqual(result.items.map((item) => item.id), ['estimator:mobilization', 'estimator:minimum']);
  assert.equal(result.items[0].subtotalMinor, 13000);
  assert.equal(result.items[1].adjustmentMinor, 37000);
  assert.equal(result.totals.hours, '2');
  assert.equal(result.totals.subtotalMinor, 50000);
  assert.equal(result.totals.totalMinor, 47500);
  assert.equal(result.totals.directCostMinor, 6000);
  assert.equal(result.totals.grossMarginMinor, 41500);
  assert.equal(result.items[1].provenance!.source, 'minimum_price');
  const overridden = calculateProductionPreview({ calculationVersion: 'repaint-v2', items: [], minimumPrice: '0', mobilizationHours: '0' }, book).calculation;
  assert.equal(overridden.totals.totalMinor, 0);
  assert.equal(overridden.totals.hours, '0');
  const v1 = calculateProductionPreview({ items: [] }, book).calculation;
  assert.equal(v1.totals.totalMinor, 0);
  assert.equal(v1.totals.hours, '0');
});

test('minimum selling cannot conceal unknown mobilization cost or collide with existing scope IDs', () => {
  const book = catalog({ rates: [], materials: [], settings: { defaultLaborRate: '65', defaultBurdenedRate: null, minimumPrice: '500', mobilizationHours: '2' } });
  const result = calculateProductionPreview({ calculationVersion: 'repaint-v2', items: [] }, book).calculation;
  assert.equal(result.totals.subtotalMinor, 50000);
  assert.equal(result.totals.directCostMinor, null);
  assert.equal(result.totals.grossMarginMinor, null);
  assert.deepEqual(result.totals.missingCostComponents, ['estimator:mobilization.operations.mobilization.burdenedRate']);
  assert.throws(() => calculate([], { minimumPrice: '500', adjustments: [{ id: 'estimator:minimum', quantity: '1', unitPrice: '5' }] }), /unique ID/);
});

test('dated contractor price provenance produces deterministic stale-price warnings only with explicit pricing clock', () => {
  const book = catalog();
  book.settings.priceStaleDays = 2;
  const request: ProductionPreviewRequest = { calculationVersion: 'repaint-v2', items: [{ id: 'room', productionRateId: 'wall', quantity: '80', materialId: 'paint' }] };
  const undated = calculateProductionPreview(request, book).calculation;
  assert.equal(undated.warnings.some((warning) => warning.code === 'STALE_PRICE'), false);
  const dated = calculateProductionPreview({ ...request, pricingAsOf: '2026-10-04' }, book).calculation;
  assert.deepEqual(dated.warnings.filter((warning) => warning.code === 'STALE_PRICE'), [{ code: 'STALE_PRICE', itemId: 'room', componentId: 'finish' }]);
  assert.equal(dated.totals.directCostMinor, undated.totals.directCostMinor);
  assert.throws(() => calculateProductionPreview({ ...request, pricingAsOf: 'invalid' }, book), /valid pricing date/);
});

test('all fractional layer demands are summed as rationals before serializing item totals', () => {
  const result = calculate([wall('room', { quantity: '1', coats: 1, coatingLayers: ['a', 'b', 'c'].map((id) => ({
    id, phase: 'finish' as const, coats: 1, material: paint({ coveragePerGallon: '3' }),
  })) })]);
  assert.deepEqual(result.items[0].layers!.map((layer) => layer.theoreticalGallons), ['0.33333333', '0.33333333', '0.33333333']);
  assert.equal(result.items[0].theoreticalGallons, '1');
  assert.equal(result.items[0].purchasedGallons, '1');
  assert.equal(result.totals.theoreticalGallons, '1');
  assert.equal(result.purchaseGroups[0].packCount, 1);
});

test('explicit primer/application operations replace implicit labor and layers never duplicate hours', () => {
  const book = catalog();
  book.rates.push({ id: 'prime', unit: 'sqft', rateBasis: 'complete_system', ratePerHour: '200', sellingRateSource: 'inherit', burdenedRate: '30' });
  book.materials.push({ id: 'primer', unit: 'gallon', coveragePerGallon: '250', costPerUnit: '20' });
  const result = calculateProductionPreview({ calculationVersion: 'repaint-v2', items: [{
    id: 'room', productionRateId: 'wall', quantity: '1000', coats: 2,
    operations: [{ id: 'prime', kind: 'primer', productionRateId: 'prime' }, { id: 'finish', kind: 'application', productionRateId: 'wall', coats: 2 }],
    coatingLayers: [{ id: 'primer', phase: 'primer', materialId: 'primer', coats: 1 }, { id: 'finish', phase: 'finish', materialId: 'paint', coats: 2 }],
  }] }, book).calculation;
  assert.equal(result.items[0].operations!.length, 2);
  assert.deepEqual(result.items[0].operations!.map((operation) => operation.productionRateId), ['prime', 'wall']);
  // 1000/200 + 1000/80 = 17.5 hours; no third implicit painting operation.
  assert.equal(result.totals.hours, '17.5');
  assert.equal(result.totals.laborMinor, 157500);
});

test('painting without product layers remains incomplete, while independent prep needs no paint', () => {
  const unresolved = calculate([wall('room', { coatingLayers: [] })]);
  assert.ok(unresolved.warnings.some((warning) => warning.code === 'MISSING_PRODUCT'));
  assert.equal(unresolved.totals.acquisitionCostMinor, null);
  assert.equal(unresolved.totals.grossMarginMinor, null);
  const prep = calculate([wall('prep-only', { coatingLayers: [], operations: [{ id: 'prep', kind: 'prep', hours: '4' }] })]);
  assert.equal(prep.warnings.some((warning) => warning.code === 'MISSING_PRODUCT'), false);
  assert.equal(prep.totals.directCostMinor, 12000);
});

test('jobsite and override are metadata; only the server-resolved catalog tax drives cents', () => {
  const book = catalog({ rates: [], materials: [], settings: { salesTaxRate: '0.092' } });
  const result = calculateProductionPreview({ calculationVersion: 'repaint-v2', items: [], jobsitePostalCode: '98101',
    taxOverride: { ratePercent: '50', reason: 'Metadata already resolved by the server' },
    adjustments: [{ id: 'scope', quantity: '1', unitPrice: '100', costPerUnit: '50' }],
  }, book).calculation;
  assert.equal(result.totals.taxMinor, 920);
  assert.equal(result.totals.grossMarginMinor, 5000);
});

test('a project minimum cannot create base price from empty, zero, or optional-only scope', () => {
  for (const surfaces of [[], [wall('zero', { quantity: '0' })], [wall('option', { optional: true })]]) {
    const result = calculate(surfaces, { minimumPrice: '500' });
    assert.equal(result.totals.totalMinor, 0);
    assert.equal(result.items.some((item) => item.id === 'estimator:minimum'), false);
  }
});

test('maximum scope plus configured mobilization remains valid and ordinary item IDs stay unchanged', () => {
  const book = catalog();
  book.settings.mobilizationHours = '1';
  const result = calculateProductionPreview({ calculationVersion: 'repaint-v2', items: Array.from({ length: 500 }, (_, index) => ({
    id: `room-${index}`, productionRateId: 'wall', quantity: '80', coats: 2, materialId: 'paint', colorCode: 'W1',
  })) }, book).calculation;
  assert.equal(result.items.length, 501);
  assert.deepEqual(result.items.slice(0, 500).map((item) => item.id), Array.from({ length: 500 }, (_, index) => `room-${index}`));
  assert.equal(result.items[500].id, 'estimator:mobilization');
  assert.equal(result.totals.hours, '501');
});

test('unknown quick material budget cannot masquerade as known cost in summary', () => {
  const quick = calculateQuickEstimate([{ id: 'room', quantity: '2', laborHoursPerUnit: '1.5', materialCostPerUnit: '40', costUnknown: true }], {
    calculationVersion: 'repaint-v2', laborRate: '65', burdenedLaborRate: '30', materialMarkupPercent: '30', salesTaxRate: '0',
  });
  assert.equal(quick.totals.materialCostMinor, 0);
  assert.equal(quick.totals.knownDirectCostMinor, 9000);
  assert.equal(quick.totals.directCostMinor, null);
  assert.equal(quick.totals.grossMarginMinor, null);
});
