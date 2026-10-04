import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveEstimationTax, taxMinorForSubtotal } from '../../packages/core/src/estimation-tax';
import { publicEstimatePackages } from '../../packages/core/src/estimation-public';

test('ZIP rule and explicit percentage override are auditable and exact', () => {
  const rule = resolveEstimationTax({ defaultRate: '.092', postalCode: '98101-1234', policy: { rules: [{ postalCode: '98101', label: 'Reviewed Seattle', ratePercent: '10.35' }] } });
  assert.equal(rule.value, '0.1035');
  assert.equal(rule.source, 'jobsite_rule');
  assert.equal(taxMinorForSubtotal(12345, rule), 1278);
  const override = resolveEstimationTax({ defaultRate: '0.092', override: { ratePercent: '0.5', reason: 'Reviewed local exemption' }, actorId: 'owner' });
  assert.equal(override.value, '0.005');
  assert.equal(override.actorId, 'owner');
  assert.throws(() => resolveEstimationTax({ override: { ratePercent: 9.2, reason: '' } }));
});

test('public proposal includes specifications but never pricing internals', () => {
  const result = publicEstimatePackages([{ name: 'Proposal', total: 200, calculationInput: { private: true }, calculationSnapshot: { private: true }, items: [
    { desc: 'Room: Walls', qty: 1, rate: 200, dimensions: { quantity: 500 }, labor: { hours: 5, burdenedRate: 30, coats: 2 }, material: { name: 'Finish', costPerUnit: 40, crewNote: 'private', colorName: 'White' },
      scopeCommitments: ['Masking for separate ceiling color', { private: 'budget' }], operations: [{ hours: 2, burdenedRate: 30 }] },
    { desc: 'Private line', customerVisible: false },
  ] }]);
  assert.equal((result[0].items as unknown[]).length, 1);
  assert.equal(JSON.stringify(result).includes('private'), false);
  assert.equal(JSON.stringify(result).includes('costPerUnit'), false);
  assert.deepEqual((result[0].items as any[])[0].labor, { coats: 2 });
  assert.deepEqual((result[0].items as any[])[0].scopeCommitments, ['Masking for separate ceiling color']);
  assert.equal(JSON.stringify(result).includes('operations'), false);
});

function signedPackages() {
  return [{ name: 'Other', total: 999, items: [{ desc: 'Other package', qty: 1, rate: 999 }] }, {
    name: 'Chosen', subtotal: '100', tax: '9.20', total: '109.20', taxRate: '0.092', optionalTotal: '109.20',
    calculationInput: { private: 'input' }, calculationSnapshot: { private: 'snapshot' },
    items: [
      { desc: 'Base room', qty: 1, rate: 100, calculationItemId: 'base', dimensions: { private: true }, labor: { coats: 2, hours: 4, burdenedRate: 30 } },
      { desc: 'Hidden option', qty: 1, rate: 50, optional: true, customerVisible: false, calculationItemId: 'hidden' },
      ...['a', 'b'].map((id) => ({ desc: 'Same extra room', qty: 1, rate: 50, optional: true, calculationItemId: id,
        material: { name: 'Finish', colorCode: 'W1', costPerUnit: 40, crewNote: 'private' },
        coatingLayers: [{ phase: 'primer', name: 'Primer', coats: 1, colorCode: 'W1', costPerPack: 30, private: true }],
      })),
    ],
  }];
}

test('signed public projection selects one package and exactly one identical option by index or ID', () => {
  const packages = signedPackages();
  const before = JSON.stringify(packages);
  for (const identity of [{ optionIndex: 1 }, { calculationItemId: 'b' }]) {
    const result = publicEstimatePackages(packages, { packageName: 'Chosen', contractTotalMinor: 16380,
      selectedOptions: [{ ...identity, desc: 'Same extra room', qty: 1, rate: 50 }], private: 'acceptance' });
    assert.equal(result.length, 1);
    assert.equal(result[0].name, 'Chosen');
    assert.equal(result[0].subtotal, 150);
    assert.equal(result[0].tax, 13.8);
    assert.equal(result[0].total, 163.8);
    assert.equal(result[0].optionalTotal, 0);
    const items = result[0].items as Array<Record<string, unknown>>;
    assert.deepEqual(items.map((item) => item.calculationItemId), ['base', 'b']);
    assert.ok(items.every((item) => item.optional === false && item.included === true));
    assert.deepEqual(items[1].material, { name: 'Finish', colorCode: 'W1' });
    assert.deepEqual(items[1].coatingLayers, [{ phase: 'primer', name: 'Primer', coats: 1, colorCode: 'W1' }]);
    for (const field of ['private', 'calculationInput', 'calculationSnapshot', 'dimensions', 'burdenedRate', 'costPerUnit', 'costPerPack', 'crewNote']) assert.equal(JSON.stringify(result).includes(field), false);
  }
  assert.equal(JSON.stringify(packages), before);
});

test('an accepted proposal with no selected extras omits every unselected option', () => {
  const [signed] = publicEstimatePackages(signedPackages(), { packageName: 'Chosen', contractTotalMinor: 10920, selectedOptions: [] });
  assert.deepEqual((signed.items as Array<Record<string, unknown>>).map((item) => item.calculationItemId), ['base']);
  assert.equal(signed.subtotal, 100);
  assert.equal(signed.tax, 9.2);
  assert.equal(signed.total, 109.2);
});

test('signed subtotal minus discount plus tax reconciles exact contract cents', () => {
  const packages = [{ name: 'Proposal', subtotal: '100', discount: '10', tax: '8.28', total: '98.28', taxRate: '0.092',
    items: [{ desc: 'Base', qty: 1, rate: 100 }, { desc: 'Extra', qty: 1, rate: 50, optional: true, calculationItemId: 'extra' }] }];
  const [signed] = publicEstimatePackages(packages, { packageName: 'Proposal', contractTotalMinor: 15288,
    selectedOptions: [{ desc: 'Extra', qty: 1, rate: 50, calculationItemId: 'extra' }] });
  assert.equal(signed.subtotal, 150);
  assert.equal(signed.discount, 10);
  assert.equal(signed.tax, 12.88);
  assert.equal(signed.total, 152.88);
});

test('a frozen historical contract total is never replaced by recomputing old rounding', () => {
  const pkg = { name: 'Proposal', subtotal: 0, tax: 0, total: 0, taxRate: 0,
    items: ['a', 'b'].map((id) => ({ desc: 'Fractional extra', qty: '0.25', rate: '0.10', optional: true, calculationItemId: id })) };
  const [signed] = publicEstimatePackages([pkg], { packageName: 'Proposal', contractTotalMinor: 5,
    selectedOptions: pkg.items.map((item) => ({ ...item })) });
  assert.equal(signed.subtotal, 0.05);
  assert.equal(signed.tax, 0);
  assert.equal(signed.total, 0.05);
});

test('signed projection supports legacy lineItems and rejects ambiguous, duplicate or invalid selections', () => {
  const pkg = signedPackages()[1];
  const legacy = { ...pkg, items: undefined, lineItems: pkg.items };
  const option = { desc: 'Same extra room', qty: 1, rate: 50, optionIndex: 1 };
  assert.equal((publicEstimatePackages([legacy], { packageName: 'Chosen', selectedOptions: [option], contractTotalMinor: 16380 })[0].items as unknown[]).length, 2);
  assert.throws(() => publicEstimatePackages([pkg], { packageName: 'Chosen', selectedOptions: [{ ...option, optionIndex: undefined }] }), /option changed/);
  assert.throws(() => publicEstimatePackages([pkg], { packageName: 'Chosen', selectedOptions: [option, option] }), /selected twice/);
  for (const selectedOptions of ['invalid', [null], [[]]]) assert.throws(() => publicEstimatePackages([pkg], { packageName: 'Chosen', selectedOptions }));
  for (const contractTotalMinor of [-1, 0.5, Infinity, 10000000000, '16380']) assert.throws(() => publicEstimatePackages([pkg], { packageName: 'Chosen', selectedOptions: [option], contractTotalMinor }));
  assert.deepEqual(publicEstimatePackages([pkg], { packageName: 'Missing', selectedOptions: [] }), []);
});

test('unsigned public projection preserves options while nested values cannot smuggle private objects', () => {
  const pkg = { name: 'Proposal', taxRate: { value: '0.092', kind: 'fraction', private: { cost: 1 } },
    items: [{ desc: 'Base', qty: 1, rate: 100, notes: { private: 'budget' }, labor: { coats: { private: true }, applicationMethod: 'brush_roll' } },
      { desc: 'Extra', qty: 1, rate: 50, optional: true }] };
  const [unsigned] = publicEstimatePackages([pkg]);
  assert.equal((unsigned.items as unknown[]).length, 2);
  assert.equal((unsigned.items as Array<{ optional?: boolean }>)[1].optional, true);
  assert.deepEqual(unsigned.taxRate, { value: '0.092', kind: 'fraction' });
  assert.deepEqual((unsigned.items as Array<{ labor: unknown }>)[0].labor, { applicationMethod: 'brush_roll' });
  assert.equal(JSON.stringify(unsigned).includes('private'), false);
});
