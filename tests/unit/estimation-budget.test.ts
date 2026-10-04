import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateProductionEstimate, type EstimationSurface } from '../../packages/core/src/estimation';
import { acceptedOptionPricing, buildAcceptedEstimationBudget, matchAcceptedOptions } from '../../packages/core/src/estimation-budget';
import { publicEstimatePackages } from '../../packages/core/src/estimation-public';

function surface(id: string, optional = false, knownCost = true): EstimationSurface {
  return { id, optional, quantity: '400', unit: 'sqft', coats: 1,
    labor: { productionRatePerHour: '100', rateBasis: 'complete_system', sellingRate: '65', burdenedRate: '30' },
    material: { productId: id, colorCode: 'W1', coverageUnit: 'sqft', coveragePerGallon: '400', packSizeGallons: '1', costPerPack: knownCost ? '50' : undefined, markupPercent: '30' },
  };
}

test('accepted options freeze complete v2 costs and gallons without changing the sent snapshot', () => {
  const calculation = calculateProductionEstimate({ calculationVersion: 'repaint-v2', surfaces: [surface('base'), surface('extra', true)], taxRate: { kind: 'fraction', value: '0.092' } });
  const before = JSON.stringify(calculation);
  const pkg = { name: 'Proposal', total: '354.90', subtotal: '325', tax: '29.90', taxRate: '0.092', calculationVersion: 'repaint-v2', calculationSnapshot: calculation,
    items: [{ desc: 'Extra room', qty: '1', rate: '325', optional: true, calculationItemId: 'extra' }] };
  const result = buildAcceptedEstimationBudget('estimate', pkg, [{ desc: 'Extra room', qty: '1', rate: '325' }], '2026-10-04T00:00:00Z');
  assert.equal(result.contractTotalMinor, 70980);
  assert.equal(result.calculation!.totals.directCostMinor, 34000);
  assert.equal(result.calculation!.totals.grossMarginMinor, 31000);
  assert.equal(result.calculation!.totals.purchasedGallons, '2');
  assert.equal(result.calculation!.totals.optionalSubtotalMinor, 0);
  assert.equal(result.costComplete, true);
  assert.equal(JSON.stringify(calculation), before);
});

test('an accepted option with unknown cost keeps the entire budget margin unavailable', () => {
  const calculation = calculateProductionEstimate({ calculationVersion: 'repaint-v2', surfaces: [surface('base'), surface('extra', true, false)] });
  const result = buildAcceptedEstimationBudget('estimate', { name: 'Proposal', total: '325', calculationSnapshot: calculation,
    items: [{ desc: 'Extra', qty: 1, rate: 260, optional: true, calculationItemId: 'extra' }] }, [{ desc: 'Extra', qty: 1, rate: 260 }], 'now');
  assert.equal(result.costComplete, false);
  assert.equal(result.calculation!.totals.grossMarginMinor, null);
  assert.equal(result.calculation!.totals.acquisitionCostMinor, null);
  assert.ok(result.calculation!.totals.missingCostComponents!.length);
});

test('public tax fraction and server input compute identical fractional option tax cents', () => {
  const pkg = { name: 'Proposal', subtotal: '10', total: '10.05', tax: '0.05' };
  const options = [{ qty: '0.25', rate: '3.99' }];
  assert.deepEqual(acceptedOptionPricing({ ...pkg, taxRate: '0.005' }, options), acceptedOptionPricing({ ...pkg, calculationInput: { taxRate: { value: '0.5', kind: 'percent' } } }, options));
});

test('identical option descriptions require identity and cannot activate two budgets for one selection', () => {
  const items = ['a', 'b'].map((id) => ({ desc: 'Extra room', qty: 1, rate: 325, optional: true, calculationItemId: id }));
  const option = { desc: 'Extra room', qty: 1, rate: 325 };
  assert.throws(() => matchAcceptedOptions(items, [option]), /option changed/);
  assert.equal(matchAcceptedOptions(items, [{ ...option, optionIndex: 1 }])[0].calculationItemId, 'b');
  assert.throws(() => matchAcceptedOptions(items, [{ ...option, calculationItemId: 'b' }, { ...option, optionIndex: 1 }]), /selected twice/);
  assert.throws(() => matchAcceptedOptions(items, [{ ...option, calculationItemId: 'b', rate: 1 }]), /option changed/);
});

test('same-description options activate exactly one budget by index or stable ID and store only matched fields', () => {
  const calculation = calculateProductionEstimate({ calculationVersion: 'repaint-v2', surfaces: [surface('base'), surface('a', true), surface('b', true)], taxRate: { kind: 'fraction', value: '0.092' } });
  const pkg = { name: 'Proposal', subtotal: '325', tax: '29.90', total: '354.90', taxRate: '0.092', calculationSnapshot: calculation,
    items: ['a', 'b'].map((id) => ({ desc: 'Extra room', qty: 1, rate: 325, category: 'painting', optional: true, calculationItemId: id })) };
  for (const identity of [{ optionIndex: 1 }, { calculationItemId: 'b' }]) {
    const raw = { ...identity, desc: 'Extra room', qty: '1.000', rate: '325.00', category: 'caller category', private: 'do not store' };
    const result = buildAcceptedEstimationBudget('estimate', pkg, [raw], 'now');
    assert.deepEqual(result.operationIds, ['base', 'b']);
    assert.deepEqual(result.selectedOptions, [{ desc: 'Extra room', qty: 1, rate: 325, category: 'painting', calculationItemId: 'b', optionIndex: 1 }]);
    assert.equal(result.contractTotalMinor, 70980);
    assert.equal(result.calculation!.totals.optionalSubtotalMinor, 32500);
    assert.equal(result.calculation!.totals.optionalTaxMinor, 2990);
    assert.equal(result.calculation!.totals.optionalTotalMinor, 35490);
    assert.equal(result.calculation!.totals.theoreticalGallons, '2');
    assert.equal(result.calculation!.totals.orderGallons, '2');
    assert.equal(result.calculation!.totals.purchasedGallons, '2');
  }
  assert.equal(calculation.items.find((item) => item.id === 'b')!.included, false);
});

test('selecting the last options clears optional totals and signed public scope matches the contract', () => {
  const calculation = calculateProductionEstimate({ calculationVersion: 'repaint-v2', surfaces: [surface('base'), surface('a', true), surface('b', true)], taxRate: { kind: 'fraction', value: '0.092' } });
  const pkg = { name: 'Proposal', subtotal: '325', tax: '29.90', total: '354.90', optionalTotal: '709.80', taxRate: '0.092', calculationSnapshot: calculation,
    items: ['base', 'a', 'b'].map((id) => ({ desc: 'Same room', qty: 1, rate: 325, optional: id !== 'base', calculationItemId: id })) };
  const selected = ['a', 'b'].map((calculationItemId) => ({ desc: 'Same room', qty: 1, rate: 325, calculationItemId }));
  const result = buildAcceptedEstimationBudget('estimate', pkg, selected, 'now');
  assert.equal(result.contractTotalMinor, 106470);
  assert.equal(result.calculation!.totals.optionalSubtotalMinor, 0);
  assert.equal(result.calculation!.totals.optionalTaxMinor, 0);
  assert.equal(result.calculation!.totals.optionalTotalMinor, 0);
  assert.equal(result.calculation!.totals.purchasedGallons, '3');
  const [signed] = publicEstimatePackages([pkg], result);
  assert.equal(signed.subtotal, 975);
  assert.equal(signed.tax, 89.7);
  assert.equal(signed.total, 1064.7);
  assert.equal(signed.optionalTotal, 0);
  assert.equal((signed.items as Array<{ optional: boolean }>).every((item) => item.optional === false), true);
});

test('historically optional lines already in the base snapshot add no charge or tax', () => {
  const calculation = calculateProductionEstimate({ calculationVersion: 'repaint-v2', surfaces: [surface('base'), { ...surface('extra', true), selected: true }], taxRate: { kind: 'fraction', value: '0.092' } });
  const pkg = { name: 'Proposal', subtotal: '650', tax: '59.80', total: '709.80', taxRate: '0.092', calculationSnapshot: calculation,
    items: [{ desc: 'Base room', qty: 1, rate: 325, calculationItemId: 'base' }, { desc: 'Extra room', qty: 1, rate: 325, optional: true, calculationItemId: 'extra' }] };
  const selected = [{ desc: 'Extra room', qty: 1, rate: 325, calculationItemId: 'extra' }];
  assert.deepEqual(acceptedOptionPricing(pkg, selected), { subtotalMinor: 0, taxMinor: 0, totalMinor: 70980, taxRate: '0.092' });
  const result = buildAcceptedEstimationBudget('estimate', pkg, selected, 'now');
  assert.equal(result.contractTotalMinor, 70980);
  assert.equal(result.calculation!.totals.taxMinor, 5980);
  assert.equal(result.calculation!.totals.purchasedGallons, '2');
  for (const selectedOptions of [result.selectedOptions, []]) {
    const [signed] = publicEstimatePackages([pkg], { packageName: 'Proposal', selectedOptions, contractTotalMinor: 70980 });
    assert.equal((signed.items as unknown[]).length, 2);
    assert.equal(signed.total, 709.8);
    assert.equal(signed.tax, 59.8);
  }
});

test('option quantity times rate rounds each line before summing and taxing cents', () => {
  const result = acceptedOptionPricing({ name: 'Proposal', total: '0', taxRate: { kind: 'percent', value: '50' } }, [
    { qty: '0.25', rate: '0.10' }, { qty: '0.25', rate: '0.10' },
  ]);
  assert.deepEqual(result, { subtotalMinor: 6, taxMinor: 3, totalMinor: 9, taxRate: '0.5' });
});

test('an explicit zero rate overrides inferred option tax, including calculation input', () => {
  const pkg = { name: 'Proposal', subtotal: '10', tax: '1', total: '11' };
  for (const source of [{ taxRate: 0 }, { taxRate: '0' }, { taxRate: '0.1', calculationInput: { taxRate: { kind: 'fraction' as const, value: '0' } } }]) {
    assert.deepEqual(acceptedOptionPricing({ ...pkg, ...source }, [{ qty: 1, rate: 5 }]), { subtotalMinor: 500, taxMinor: 0, totalMinor: 1600, taxRate: '0' });
  }
});

test('remaining optional tax is reallocated from its own cents rather than stale original tax shares', () => {
  const calculation = calculateProductionEstimate({ surfaces: [], adjustments: [
    { id: 'base', quantity: 1, unitPrice: 1 }, { id: 'a', quantity: 1, unitPrice: '0.01', optional: true }, { id: 'b', quantity: 1, unitPrice: '0.01', optional: true },
  ], taxRate: { kind: 'fraction', value: '0.5' } });
  assert.equal(calculation.items.find((item) => item.id === 'b')!.taxMinor, 0);
  const pkg = { name: 'Proposal', subtotal: '1', tax: '0.50', total: '1.50', taxRate: '0.5', calculationSnapshot: calculation,
    items: ['a', 'b'].map((id) => ({ desc: 'Tiny option', qty: 1, rate: '0.01', optional: true, calculationItemId: id })) };
  const result = buildAcceptedEstimationBudget('estimate', pkg, [{ desc: 'Tiny option', qty: 1, rate: '0.01', calculationItemId: 'a' }], 'now');
  assert.equal(result.contractTotalMinor, 152);
  assert.equal(result.calculation!.totals.optionalSubtotalMinor, 1);
  assert.equal(result.calculation!.totals.optionalTaxMinor, 1);
  assert.equal(result.calculation!.totals.optionalTotalMinor, 2);
  assert.equal(result.calculation!.items.find((item) => item.id === 'b')!.taxMinor, 1);
});

test('pricing rejects duplicate identities, changed prices, nonfinite inputs and all money overflows', () => {
  const item = { desc: 'Extra', qty: 1, rate: 5, optional: true, calculationItemId: 'extra' };
  const option = { ...item };
  assert.throws(() => acceptedOptionPricing({ name: 'Proposal', total: 0, items: [item] }, [option, option]), /selected twice/);
  assert.throws(() => acceptedOptionPricing({ name: 'Proposal', total: 0, items: [item] }, [{ ...option, rate: 1 }]), /option changed/);
  for (const rate of [Infinity, NaN, -1, '100000000']) assert.throws(() => acceptedOptionPricing({ name: 'Proposal', total: 0 }, [{ qty: 1, rate }]));
  assert.throws(() => acceptedOptionPricing({ name: 'Proposal', total: 0 }, [{ rate: '99999999.99' }, { rate: '99999999.99' }]));
  assert.throws(() => acceptedOptionPricing({ name: 'Proposal', total: '99999999.99' }, [{ rate: '0.01' }]));
  assert.throws(() => acceptedOptionPricing({ name: 'Proposal', total: 0, taxRate: { kind: 'percent', value: 101 } }, []));
});

test('a selected calculation reference must exist and reconcile the authoritative option cents', () => {
  const calculation = calculateProductionEstimate({ calculationVersion: 'repaint-v2', surfaces: [surface('base'), surface('extra', true)] });
  const pkg = { name: 'Proposal', total: 325, calculationSnapshot: calculation,
    items: [{ desc: 'Extra', qty: 1, rate: 324, optional: true, calculationItemId: 'extra' }] };
  assert.throws(() => buildAcceptedEstimationBudget('estimate', pkg, [{ desc: 'Extra', qty: 1, rate: 324, calculationItemId: 'extra' }], 'now'), /does not match/);
  const missing = { ...pkg, items: [{ ...pkg.items[0], calculationItemId: 'missing' }] };
  assert.throws(() => buildAcceptedEstimationBudget('estimate', missing, [{ desc: 'Extra', qty: 1, rate: 324, calculationItemId: 'missing' }], 'now'), /no matching calculation/);
});

test('accepted scope preserves only visible included and selected item IDs and labels', () => {
  const calculation = calculateProductionEstimate({ calculationVersion: 'repaint-v2', surfaces: [surface('base'), surface('hidden'), surface('a', true), surface('b', true)] });
  const pkg = { name: 'Proposal', subtotal: 650, total: 650, calculationSnapshot: calculation, items: [
    { calculationItemId: 'base', desc: 'Living room: Walls', roomName: 'Living room', surfaceName: 'Walls', qty: 1, rate: 325, notes: 'private', costPerUnit: 50 },
    { calculationItemId: 'hidden', desc: 'Internal scope', qty: 1, rate: 325, customerVisible: false },
    { calculationItemId: 'a', desc: 'Unselected room', qty: 1, rate: 325, optional: true },
    { calculationItemId: 'b', desc: 'Bedroom: Ceiling', roomName: 'Bedroom', surfaceName: 'Ceiling', qty: 1, rate: 325, optional: true },
  ] };
  const before = JSON.stringify(pkg);
  const result = buildAcceptedEstimationBudget('estimate', pkg, [{ calculationItemId: 'b', desc: 'Bedroom: Ceiling', qty: 1, rate: 325 }], 'now');
  assert.deepEqual(result.scope, [
    { calculationItemId: 'base', desc: 'Living room: Walls', roomName: 'Living room', surfaceName: 'Walls' },
    { calculationItemId: 'b', desc: 'Bedroom: Ceiling', roomName: 'Bedroom', surfaceName: 'Ceiling' },
  ]);
  assert.equal(JSON.stringify(pkg), before);
  assert.equal(result.scope.some((item) => 'rate' in item || 'notes' in item || 'costPerUnit' in item), false);
});

test('scope labels without optional metadata survive legacy budgets without calculation snapshots', () => {
  const pkg = { name: 'Proposal', total: 100, items: [
    { calculationItemId: 'base', desc: 'Base room', qty: 1, rate: 100 },
    { calculationItemId: 'extra', desc: 'Extra room', qty: 1, rate: 50, optional: true },
    { desc: 'Legacy row without an operating ID', qty: 1, rate: 0 },
  ] };
  assert.deepEqual(buildAcceptedEstimationBudget('estimate', pkg, [], 'now').scope, [{ calculationItemId: 'base', desc: 'Base room' }]);
  const selected = [{ calculationItemId: 'extra', desc: 'Extra room', qty: 1, rate: 50 }];
  assert.deepEqual(buildAcceptedEstimationBudget('estimate', pkg, selected, 'now').scope, [
    { calculationItemId: 'base', desc: 'Base room' }, { calculationItemId: 'extra', desc: 'Extra room' },
  ]);
});
