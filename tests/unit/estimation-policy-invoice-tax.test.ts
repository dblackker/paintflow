import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { estimationPolicySchema } from '../../apps/api/src/routes/settings';
import { customerInvoiceCreateSchema } from '../../apps/api/src/routes/invoices';
import { decimal, decimalText, exact, multiply } from '../../packages/core/src/estimation-decimal';

const policy = {
  rules: [{ postalCode: '98101', label: 'Reviewed district', ratePercent: '10.352500' }],
  defaultBurdenedRate: '32.500',
  priceStaleDays: 90,
  expectedUpdatedAt: null,
};
const invoice = { leadId: randomUUID(), description: 'Synthetic work', amount: 100 };

test('policy decimals remain exact, normalized and bounded', () => {
  const normalized = estimationPolicySchema.parse(policy);
  assert.equal(normalized.rules[0].ratePercent, '10.3525');
  assert.equal(normalized.defaultBurdenedRate, '32.50');
  for (const ratePercent of ['9.12345', '-1', '100.0001', '', null, Infinity]) {
    assert.equal(
      estimationPolicySchema.safeParse({ ...policy, rules: [{ ...policy.rules[0], ratePercent }] }).success,
      false,
    );
  }
  for (const defaultBurdenedRate of ['1.005', '-1', '1000.01', '', Infinity]) {
    assert.equal(estimationPolicySchema.safeParse({ ...policy, defaultBurdenedRate }).success, false);
  }
  assert.equal(
    estimationPolicySchema.parse({ ...policy, defaultBurdenedRate: '0' }).defaultBurdenedRate,
    '0.00',
  );
  assert.equal(
    estimationPolicySchema.parse({ ...policy, defaultBurdenedRate: null }).defaultBurdenedRate,
    null,
  );
});

test('policy requires an explicit nullable revision and rejects duplicate ZIP rules', () => {
  const { expectedUpdatedAt, ...missing } = policy;
  assert.equal(estimationPolicySchema.safeParse(missing).success, false);
  assert.equal(estimationPolicySchema.safeParse({ ...policy, expectedUpdatedAt: 'invalid' }).success, false);
  assert.equal(
    estimationPolicySchema.safeParse({ ...policy, rules: [...policy.rules, ...policy.rules] }).success,
    false,
  );
  assert.equal(
    estimationPolicySchema.parse({ ...policy, expectedUpdatedAt: '2026-10-04T12:00:00.000Z' })
      .expectedUpdatedAt,
    '2026-10-04T12:00:00.000Z',
  );
});

test('automatic invoice tax has no override fields; explicit overrides require a separate reason', () => {
  const automatic = customerInvoiceCreateSchema.parse(invoice);
  assert.equal(automatic.taxRate, undefined);
  assert.equal(automatic.taxOverride, false);
  const reviewed = customerInvoiceCreateSchema.parse({
    ...invoice,
    taxRate: '7.2500',
    taxOverrideReason: ' Reviewed exemption ',
  });
  assert.equal(reviewed.taxRate, '7.25');
  assert.equal(reviewed.taxOverrideReason, 'Reviewed exemption');
  for (const patch of [
    { taxRate: 7.25 },
    { taxRate: 7.25, note: 'Unrelated invoice note' },
    { taxOverride: true, tax: 0 },
    { taxRate: '9.12345', taxOverrideReason: 'Reviewed' },
    { taxRate: 101, taxOverrideReason: 'Reviewed' },
    { taxRate: 7.25, taxOverrideReason: 'ok' },
    { taxRate: 7.25, taxOverride: true, tax: 1, taxOverrideReason: 'Reviewed' },
  ]) {
    assert.equal(customerInvoiceCreateSchema.safeParse({ ...invoice, ...patch }).success, false);
  }
  assert.equal(
    customerInvoiceCreateSchema.safeParse({
      ...invoice,
      taxOverride: true,
      tax: '1.005',
      taxOverrideReason: 'Reviewed',
    }).success,
    false,
  );
  assert.equal(
    customerInvoiceCreateSchema.parse({
      ...invoice,
      taxOverride: true,
      tax: 0,
      taxOverrideReason: 'Reviewed exemption',
    }).tax,
    0,
  );
});

test('fraction-to-percentage display has no float artifacts at supported precision', () => {
  for (const [fraction, percent] of [
    ['0.0725', '7.25'],
    ['0.103525', '10.3525'],
    ['0.000001', '0.0001'],
  ]) {
    assert.equal(decimalText(multiply(decimal(fraction, 'taxRate', { scale: 8 }), exact(100n))), percent);
  }
});

test('UI sends revision/raw decimals, separates auto tax and clears job binding on new-customer mode', () => {
  const settings = readFileSync(
    new URL('../../apps/web/src/components/EstimationPolicySettings.tsx', import.meta.url),
    'utf8',
  );
  const invoices = readFileSync(new URL('../../apps/web/src/pages/Invoices.tsx', import.meta.url), 'utf8');
  assert.match(settings, /expectedUpdatedAt: updatedAt/);
  assert.doesNotMatch(settings, /Number\(ratePercent\)|Number\(burden\)/);
  assert.match(invoices, /taxMode === 'rate' \? \{ taxRate: quickInvoiceForm.taxRate \}/);
  assert.match(invoices, /customerMode: 'new', leadId: '', jobId: ''/);
  assert.doesNotMatch(invoices, /String\(Number\(tax.value\) \* 100\)/);
});
