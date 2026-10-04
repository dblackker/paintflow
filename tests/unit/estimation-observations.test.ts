import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateProductionEstimate } from '../../packages/core/src/estimation.ts';
import { buildAcceptedEstimationBudget } from '../../packages/core/src/estimation-budget.ts';
import {
  acceptedBudget, compareJobEstimationBudget, reviewEstimationCloseout, suggestEstimationRate,
  type AcceptedEstimationBudget, type JobEstimationEvidence, type ComparableRate,
} from '../../packages/core/src/estimation-observations.ts';

const asOf = '2026-10-04T12:00:00Z';
function budget(): AcceptedEstimationBudget {
  const calculation = calculateProductionEstimate({ calculationVersion: 'repaint-v2', surfaces: [{
    id: 'wall-1', quantity: '768', unit: 'sqft', coats: 2,
    labor: { productionRatePerHour: '80', sellingRate: '50', burdenedRate: '30', rateBasis: 'complete_system',
      coatRates: { '2': '80' }, applicationMethod: 'brush_roll', rateVersion: '1', productionRateId: 'synthetic-rate' },
    material: { productId: 'synthetic', colorCode: 'WHITE', coverageBasis: 'per_gallon', coveragePerGallon: '400',
      coverageUnit: 'sqft', packSizeGallons: '1', costPerPack: '40', lossAllowancePercent: '0' },
  }] });
  return buildAcceptedEstimationBudget('estimate-a', { name: 'proposal', total: '640', calculationVersion: 'repaint-v2', calculationSnapshot: calculation }, [], '2026-10-01T12:00:00Z') as AcceptedEstimationBudget;
}
function evidence(overrides: Partial<JobEstimationEvidence> = {}): JobEstimationEvidence {
  return { jobId: 'job-a', status: 'completed', budget: budget(), changes: [], revision: 'a'.repeat(32), pendingSupplierCount: 0,
    time: [{ id: 'time-a', hours: '12', totalCost: '360', date: '2026-10-02T12:00:00Z', reviewStatus: 'approved', operationId: 'wall-1:application' }],
    costs: [{ id: 'cost-labor', category: 'labor', totalCost: '360', costDate: '2026-10-02', materialPurchaseId: null },
      { id: 'cost-paint', category: 'materials', totalCost: '200', costDate: '2026-10-02', materialPurchaseId: 'purchase-a' }],
    purchases: [{ id: 'purchase-a', invoiceDate: '2026-10-02', totalAmount: '200', lines: [{ gallons: '5' }] }], ...overrides };
}
const target: ComparableRate = { unit: 'sqft', coats: 2, rateBasis: 'complete_system', method: 'brush_roll', kind: 'application', conditions: 'Drywall; normal access' };
const review = { costsComplete: true, conditions: target.conditions };

test('accepted helper item IDs resolve stable nested operating tasks without changing the snapshot', () => {
  const source = evidence();
  const before = JSON.stringify(source);
  const result = compareJobEstimationBudget(source, asOf);
  assert.equal(JSON.stringify(source), before);
  assert.equal(result.operations[0].id, 'wall-1:application');
  assert.equal(result.operations[0].approvedHours, '12');
  assert.equal(result.eligibleForCloseout, true);
});

test('accepted scope descriptions label operating tasks without changing attribution identity or evidence', () => {
  const source = evidence();
  source.budget!.scope = [{ calculationItemId: 'wall-1', desc: ' Bedroom walls ', roomName: 'Bedroom', surfaceName: 'Walls' }];
  const before = JSON.stringify(source);
  const result = compareJobEstimationBudget(source, asOf);
  assert.equal(result.operations[0].itemLabel, 'Bedroom walls');
  assert.equal(result.operations[0].itemId, 'wall-1');
  assert.equal(result.operations[0].id, 'wall-1:application');
  assert.equal(result.operations[0].approvedHours, '12');
  assert.deepEqual(result.operations[0].timeEntryIds, ['time-a']);
  assert.equal(JSON.stringify(source), before);
});

test('scope labels fall back to room and surface, then friendly text for old or unmatched snapshots', () => {
  for (const [scope, expected] of [
    [[{ calculationItemId: 'wall-1', desc: ' ', roomName: ' Bedroom ', surfaceName: ' Walls ' }], 'Bedroom / Walls'],
    [[{ calculationItemId: 'wall-1', desc: '', surfaceName: 'Ceiling' }], 'Ceiling'],
    [[{ calculationItemId: 'other-item', desc: 'Unrelated scope' }], 'Scope item'],
    [[{ calculationItemId: 'wall-1', desc: ' ' }], 'Scope item'],
    [undefined, 'Scope item'],
  ] as const) {
    const source = evidence();
    source.budget!.scope = scope && scope.map((entry) => ({ ...entry }));
    const result = compareJobEstimationBudget(source, asOf);
    assert.equal(result.operations[0].itemLabel, expected);
    assert.equal(result.operations[0].id, 'wall-1:application');
  }
});

test('operating task descriptions are preserved alongside scope labels and stable attribution IDs', () => {
  for (const description of [' Protect adjacent colors ', ' ']) {
    const source = evidence();
    source.budget!.scope = [{ calculationItemId: 'wall-1', desc: 'Bedroom walls' }];
    source.budget!.calculation.items[0].operations![0].description = description;
    const before = JSON.stringify(source);
    const result = compareJobEstimationBudget(source, asOf);
    assert.equal(result.operations[0].description, description);
    assert.equal(result.operations[0].itemLabel, 'Bedroom walls');
    assert.equal(result.operations[0].id, 'wall-1:application');
    assert.equal(result.operations[0].approvedHours, '12');
    assert.deepEqual(result.operations[0].timeEntryIds, ['time-a']);
    assert.equal(JSON.stringify(source), before);
  }
});

test('approved change tasks use their own scope labels and never borrow draft scope labels', () => {
  const source = evidence();
  source.budget!.scope = [{ calculationItemId: 'wall-1', desc: 'Bedroom walls' }];
  const change = budget();
  change.calculation.items[0].id = 'added-wall';
  change.operationIds = ['added-wall'];
  change.scope = [{ calculationItemId: 'added-wall', desc: 'Garage walls' }];
  source.changes = [
    { id: 'approved', status: 'approved', budget: change },
    { id: 'draft', status: 'draft', budget: { ...change, scope: [{ calculationItemId: 'added-wall', desc: 'Draft walls' }] } },
  ];
  const result = compareJobEstimationBudget(source, asOf);
  assert.deepEqual(result.operations.map(({ id, itemLabel }) => ({ id, itemLabel })), [
    { id: 'wall-1:application', itemLabel: 'Bedroom walls' },
    { id: 'added-wall:application', itemLabel: 'Garage walls' },
  ]);
});

test('independent 768/80 complete-two-coat budget and approved actuals use ledger dollars only', () => {
  const result = compareJobEstimationBudget(evidence(), asOf);
  assert.equal(result.budgetHours, '9.6');
  assert.equal(result.approvedHours, '12');
  assert.equal(result.hoursVariance, '2.4');
  assert.equal(result.budgetLaborMinor, 28800);
  assert.equal(result.budgetDirectCostMinor, 44800);
  assert.equal(result.recordedActualCostMinor, 56000); // Not ledger + $360 time + $200 invoice.
  assert.equal(result.materialCostVarianceMinor, 4000);
  assert.equal(result.theoreticalGallons, '3.84');
  assert.equal(result.orderBudgetGallons, '4');
  assert.equal(result.purchasedGallons, '5');
  assert.equal(result.purchasedVarianceGallons, '1.16');
  assert.equal(result.wasteGallons, null);
  assert.equal(result.usedGallons, null);
});

test('approved change budgets add once; draft/rejected changes never contribute', () => {
  const result = compareJobEstimationBudget(evidence({ changes: [
    { id: 'approved', status: 'approved', budget: budget() },
    { id: 'draft', status: 'draft', budget: budget() },
  ] }), asOf);
  assert.equal(result.budgetHours, '19.2');
  assert.equal(result.budgetMaterialMinor, 32000);
  assert.equal(result.recordedActualCostMinor, 56000);
  assert.equal(result.eligibleForCloseout, false); // Repeated task IDs require an explicit scope identity.
});

test('identified approved change tasks reconcile the combined hour, cost and paint budgets', () => {
  const change = budget();
  change.calculation.items[0].id = 'added-wall';
  change.operationIds = ['added-wall'];
  const result = compareJobEstimationBudget(evidence({ changes: [{ id: 'co', status: 'approved', budget: change }] }), asOf);
  assert.equal(result.budgetHours, '19.2');
  assert.equal(result.budgetDirectCostMinor, 89600);
  assert.equal(result.theoreticalGallons, '7.68');
  assert.equal(result.orderBudgetGallons, '8');
  assert.equal(result.recordedActualCostMinor, 56000);
  assert.deepEqual(result.operations.map((operation) => operation.id), ['wall-1:application', 'added-wall:application']);
});

test('legacy or missing accepted/change budgets do not fabricate a zero baseline or comparable sample', () => {
  for (const source of [evidence({ budget: null }), evidence({ changes: [{ id: 'co', status: 'approved', budget: null }] })]) {
    const summary = compareJobEstimationBudget(source, asOf);
    assert.equal(summary.budgetHours, null);
    assert.equal(summary.budgetMaterialMinor, null);
    assert.equal(summary.eligibleForCloseout, false);
    assert.ok(reviewEstimationCloseout(source, review, asOf).every((observation) => !observation.qualified));
  }
  assert.equal(acceptedBudget({ ...budget(), calculationVersion: 'unknown' }), null);
});

test('flagged/rejected time stays out of approved hours, but its ledger dollars are not silently erased', () => {
  for (const reviewStatus of ['flagged', 'rejected']) {
    const source = evidence();
    source.time[0].reviewStatus = reviewStatus;
    const result = compareJobEstimationBudget(source, asOf);
    assert.equal(result.approvedHours, '0');
    assert.equal(result.recordedActualCostMinor, 56000);
    assert.equal(reviewEstimationCloseout(source, review, asOf)[0].qualified, false);
  }
});

test('undated purchases/costs and future evidence are excluded, not substituted with creation dates', () => {
  const source = evidence();
  source.purchases[0].invoiceDate = null;
  source.costs[0].costDate = null;
  const result = compareJobEstimationBudget(source, asOf);
  assert.equal(result.recordedActualCostMinor, 0);
  assert.equal(result.purchasedGallons, null);
  assert.deepEqual(result.excludedCostIds, ['cost-labor', 'cost-paint']);
  assert.equal(result.eligibleForCloseout, false);
  const future = evidence();
  future.time[0].date = '2026-10-05';
  assert.equal(compareJobEstimationBudget(future, asOf).approvedHours, '0');
});

test('recorded returns reduce ledger cost, not purchased demand or invented paint waste', () => {
  const source = evidence();
  source.purchases[0].lines = [{ gallons: '5' }, { gallons: '-1' }];
  source.purchases[0].totalAmount = '160';
  source.costs.push({ id: 'credit', category: 'materials', totalCost: '-40', costDate: '2026-10-03', materialPurchaseId: 'purchase-a' });
  const result = compareJobEstimationBudget(source, asOf);
  assert.equal(result.recordedMaterialMinor, 16000);
  assert.equal(result.purchasedGallons, '5');
  assert.equal(result.recordedReturnedGallons, '1');
  assert.equal(result.purchasedVarianceGallons, '1.16');
  assert.equal(result.transferredGallons, null);
  assert.equal(result.leftoverGallons, null);
  assert.equal(result.wasteGallons, null);
});

test('unknown gallon lines remain unknown; purchase headers never become a second cost', () => {
  const source = evidence();
  source.purchases[0].lines = [{ quantity: 5, size: '1 gallon' }];
  const result = compareJobEstimationBudget(source, asOf);
  assert.equal(result.purchasedGallons, null);
  assert.equal(result.purchasedVarianceGallons, null);
  assert.equal(result.recordedActualCostMinor, 56000);
});

test('missing direct costs, pending imports and unreconciled purchases are excluded from learning', () => {
  const missing = evidence();
  missing.budget!.calculation.items[0].directCostMinor = null;
  for (const source of [missing, evidence({ pendingSupplierCount: 1 }), evidence({ costs: [] })]) {
    assert.equal(reviewEstimationCloseout(source, review, asOf)[0].qualified, false);
  }
  assert.equal(compareJobEstimationBudget(missing, asOf).budgetDirectCostMinor, null);
  assert.equal(reviewEstimationCloseout(evidence(), { ...review, costsComplete: false }, asOf)[0].qualified, false);
});

test('review needs completed work, task-attributed hours, quantity, method and conditions', () => {
  for (const field of ['hours', 'quantity', 'method', 'attribution', 'conditions', 'completion']) {
    const source = evidence();
    const reviewed = { ...review };
    if (field === 'hours') source.time[0].hours = '0';
    if (field === 'quantity') source.budget!.calculation.items[0].operations![0].quantity = '0';
    if (field === 'method') delete source.budget!.calculation.items[0].operations![0].applicationMethod;
    if (field === 'attribution') source.time[0].operationId = null;
    if (field === 'conditions') reviewed.conditions = '';
    if (field === 'completion') source.status = 'in_progress';
    assert.equal(reviewEstimationCloseout(source, reviewed, asOf)[0].qualified, false, field);
  }
});

test('partial attribution and missing source rate identity cannot qualify a sample', () => {
  const source = evidence();
  source.time.push({ ...source.time[0], id: 'unassigned', hours: '1', totalCost: '0', operationId: null });
  assert.equal(reviewEstimationCloseout(source, review, asOf)[0].qualified, false);
  const missingIdentity = evidence();
  delete missingIdentity.budget!.calculation.items[0].operations![0].productionRateId;
  assert.equal(reviewEstimationCloseout(missingIdentity, review, asOf)[0].qualified, false);
});

test('pooled complete-coat rate is quantity/approved hours with no extra coat multiplier', () => {
  const a = reviewEstimationCloseout(evidence(), review, asOf)[0];
  const b = { ...a, id: 'b', jobId: 'job-b', quantity: '384', approvedHours: '4' };
  const suggestion = suggestEstimationRate([a, b], target);
  assert.equal(suggestion.suggestedRate, '72'); // (768+384)/(12+4), not mean(64,96), not *2.
  assert.equal(suggestion.sampleCount, 2);
  assert.equal(suggestion.operationSampleCount, 2);
  assert.equal(suggestion.confidence, 'limited');
  assert.equal(suggestion.evidence[0].timeEntryIds[0], 'time-a');
  assert.equal(suggestEstimationRate([a, a], target).sampleCount, 1);
});

test('unit, method, coats, basis, phase and conditions must all match', () => {
  const a = reviewEstimationCloseout(evidence(), review, asOf)[0];
  const mismatches = [ { unit: 'each' }, { method: 'spray_only' }, { coats: 1 }, { rateBasis: 'legacy_per_coat' },
    { kind: 'primer' }, { conditions: 'Exterior; ladder access' }, { reviewed: false }, { approvedHours: '0' } ];
  for (const mismatch of mismatches) {
    const result = suggestEstimationRate([{ ...a, ...mismatch } as typeof a], target);
    assert.equal(result.suggestedRate, null);
    assert.equal(result.excluded.length, 1);
  }
});

test('hours/item and legacy per-coat suggestions explicitly retain their rate semantics', () => {
  const a = reviewEstimationCloseout(evidence(), review, asOf)[0];
  assert.equal(suggestEstimationRate([{ ...a, unit: 'each', rateBasis: 'hours_per_item', quantity: '6', approvedHours: '3' }],
    { ...target, unit: 'each', rateBasis: 'hours_per_item' }).suggestedRate, '0.5');
  assert.equal(suggestEstimationRate([{ ...a, rateBasis: 'legacy_per_coat' }], { ...target, rateBasis: 'legacy_per_coat' }).suggestedRate, '128');
});
