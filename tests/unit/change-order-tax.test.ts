import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { changeOrderSchema, updateChangeOrderSchema } from '../../apps/api/src/routes/change-orders';
import {
  changeOrderCommercialBreakdown,
  changeOrderInvoiceCommercial,
  readChangeOrderCommercial,
  type ChangeOrderTaxSnapshot,
} from '../../apps/api/src/lib/customer-invoices';
import { resolveEstimationTax } from '../../packages/core/src/estimation-tax';

const orgId = randomUUID(),
  jobId = randomUUID(),
  actorId = randomUUID();
const snapshot: ChangeOrderTaxSnapshot = {
  ...resolveEstimationTax({
    policy: { rules: [{ postalCode: '98101', ratePercent: '10.3525', label: 'Reviewed jobsite' }] },
    postalCode: '98101-1234',
    actorId,
  }),
  version: 'change-order-tax-v1',
  capturedAt: '2026-10-04T12:00:00.000Z',
  orgId,
  jobsite: {
    jobId,
    streetAddress: '123 Synthetic St',
    city: 'Synthetic',
    state: 'WA',
    postalCode: '98101-1234',
  },
};
function order(amount = '110.35') {
  return {
    orgId,
    jobId,
    amount,
    scopeDetails: {
      items: [],
      taxSnapshot: snapshot,
      commercialBreakdown: changeOrderCommercialBreakdown(amount, snapshot),
    },
  };
}

test('inclusive commercial totals use exact fractions and never add tax to gross', () => {
  const breakdown = changeOrderCommercialBreakdown('110.35', snapshot);
  assert.equal(snapshot.value, '0.103525');
  assert.deepEqual(breakdown, {
    version: 'change-order-commercial-v1',
    amountBasis: 'gross_inclusive',
    currency: 'USD',
    subtotalMinor: 10000,
    taxMinor: 1035,
    totalMinor: 11035,
  });
  assert.throws(() => changeOrderCommercialBreakdown('1.005', snapshot));
});

test('cent boundaries and all supported rates reconcile subtotal plus tax to entered gross', () => {
  for (const value of ['0', '0.0725', '0.103525', '1']) {
    for (const cents of [0, 1, 2, 3, 99, 100, 101, 11035, 9999999999]) {
      const amount = `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
      const commercial = changeOrderCommercialBreakdown(amount, { value });
      assert.equal(commercial.totalMinor, cents);
      assert.equal(commercial.subtotalMinor + commercial.taxMinor, cents);
      assert.ok(commercial.taxMinor >= 0);
    }
  }
  for (const amount of ['1.005', '-1', '100000000', '', 'Infinity'])
    assert.throws(() => changeOrderCommercialBreakdown(amount, snapshot));
  for (const value of ['-0.1', '1.01', '0.123456789'])
    assert.throws(() => changeOrderCommercialBreakdown('100', { value }));
});

test('payment allocation uses frozen agreement cents, including full and partial payments', () => {
  const full = changeOrderInvoiceCommercial(order(), '110.35')!;
  assert.deepEqual(full.commercial, order().scopeDetails.commercialBreakdown);
  const part = changeOrderInvoiceCommercial(order(), '55.18')!;
  assert.equal(part.commercial.totalMinor, 5518);
  assert.equal(part.commercial.taxMinor, 518);
  assert.equal(part.commercial.subtotalMinor, 5000);
  assert.equal(part.snapshot.actorId, actorId);
  assert.equal(changeOrderInvoiceCommercial(order(), '0')!.commercial.totalMinor, 0);
  assert.throws(() => changeOrderInvoiceCommercial(order(), '110.36'), /exceeds/);
});

test('unknown legacy tax stays unknown; known corrupt or cross-job snapshots fail closed', () => {
  assert.equal(readChangeOrderCommercial({ ...order(), scopeDetails: null }), null);
  assert.equal(changeOrderInvoiceCommercial({ ...order(), scopeDetails: { items: [] } }, '110.35'), null);
  assert.throws(() => readChangeOrderCommercial({ ...order(), orgId: randomUUID() }), /match/);
  assert.throws(() => readChangeOrderCommercial({ ...order(), jobId: randomUUID() }), /match/);
  assert.throws(() => readChangeOrderCommercial({ ...order(), amount: '110.36' }), /match/);
  const corrupted = order();
  corrupted.scopeDetails.commercialBreakdown.taxMinor++;
  assert.throws(() => readChangeOrderCommercial(corrupted), /match/);
  assert.throws(() => readChangeOrderCommercial({ ...order(), scopeDetails: { taxSnapshot: null } }));
});

test('DTO normalizes exact gross cents and validates explicitly reasoned percent overrides', () => {
  const input = {
    jobId,
    estimateId: randomUUID(),
    description: 'Synthetic repaint',
    amount: '110.3500',
    taxOverride: { ratePercent: '7.2500', reason: 'Reviewed jurisdiction exception' },
  };
  assert.equal(changeOrderSchema.parse(input).amount, '110.35');
  for (const amount of ['1.005', '-1', '100000000', '', null])
    assert.equal(changeOrderSchema.safeParse({ ...input, amount }).success, false);
  for (const taxOverride of [
    { ratePercent: '9.12345', reason: 'Reviewed' },
    { ratePercent: 101, reason: 'Reviewed' },
    { ratePercent: 7.25, reason: ' ' },
    { ratePercent: 7.25, reason: 'ok' },
  ]) {
    assert.equal(updateChangeOrderSchema.safeParse({ taxOverride }).success, false);
  }
  assert.equal(updateChangeOrderSchema.safeParse({ taxOverride: null }).success, true);
  const injected = changeOrderSchema.parse({
    ...input,
    scopeDetails: { items: [], taxSnapshot: { value: '0' }, commercialBreakdown: { totalMinor: 1 } },
  });
  assert.deepEqual(injected.scopeDetails, { items: [] });
});
