import test from 'node:test';
import assert from 'node:assert/strict';
import { estimatePaymentSchedule, nextPayableMilestone, paymentScheduleSettingsFromPreferences } from '../../apps/api/src/lib/payment-schedule';
import { EstimationInputError } from '../../packages/core/src/estimation-decimal';

function settingsFor(percentages: number[], payable = percentages.map(() => true), keys?: string[]) {
  return { businessHours: { paymentSchedule: { enabled: true, milestones: percentages.map((percent, index) => ({
    key: keys?.[index] ?? `payment_${index + 1}`, label: `Payment ${index + 1}`, due: 'Per agreement', percent, payable: payable[index],
  })) } } };
}

function cents(value: number) {
  const [whole, fraction] = value.toFixed(2).split('.');
  return Number(whole) * 100 + Number(fraction);
}

test('default halves reconcile odd cents with the first milestone receiving the tie', () => {
  assert.deepEqual(estimatePaymentSchedule({}, 1.01).map((item) => item.amount), [0.51, 0.5]);
  assert.deepEqual(estimatePaymentSchedule({}, 2.01).map((item) => item.amount), [1.01, 1]);
});

test('one cent across three equal milestones is assigned once in schedule order', () => {
  const settings = settingsFor([100 / 3, 100 / 3, 100 / 3]);
  const schedule = estimatePaymentSchedule(settings, 0.01);
  assert.deepEqual(schedule.map((item) => item.amount), [0.01, 0, 0]);
  assert.deepEqual(schedule.map((item) => item.status), ['due', 'paid', 'paid']);
  assert.equal(nextPayableMilestone(schedule)?.key, 'payment_1');
});

test('33.33/33.33/33.34 uses exact largest remainders rather than rounding each amount', () => {
  const settings = settingsFor([33.33, 33.33, 33.34]);
  assert.deepEqual(estimatePaymentSchedule(settings, 0.01).map((item) => item.amount), [0, 0, 0.01]);
  assert.deepEqual(estimatePaymentSchedule(settings, 100).map((item) => item.amount), [33.33, 33.33, 33.34]);
  assert.deepEqual(estimatePaymentSchedule(settings, 100.01).map((item) => item.amount), [33.33, 33.33, 33.35]);
});

test('ordinary 10/40/50 amounts and fractional-cent remainders reconcile', () => {
  const settings = settingsFor([10, 40, 50]);
  assert.deepEqual(estimatePaymentSchedule(settings, 1000).map((item) => item.amount), [100, 400, 500]);
  assert.deepEqual(estimatePaymentSchedule(settings, 10.01).map((item) => item.amount), [1, 4, 5.01]);
});

test('duplicate cleaned milestone keys do not overwrite cent allocations', () => {
  const schedule = estimatePaymentSchedule(settingsFor([50, 50], [true, true], ['Same key', 'same-key']), 1.01);
  assert.deepEqual(schedule.map((item) => item.key), ['same_key', 'same_key']);
  assert.deepEqual(schedule.map((item) => item.amount), [0.51, 0.5]);
});

test('accepted percentage tolerance is normalized so all contract cents are allocated', () => {
  for (const percentages of [[33.33, 33.33, 33.33], [50, 50.01]]) {
    const settings = settingsFor(percentages);
    assert.equal(paymentScheduleSettingsFromPreferences(settings).enabled, true);
    const schedule = estimatePaymentSchedule(settings, 99999.99);
    assert.equal(schedule.reduce((sum, item) => sum + cents(item.amount), 0), 9999999);
  }
});

test('payments apply oldest first in cents without changing payable flags', () => {
  const settings = settingsFor([10, 40, 50], [true, false, false]);
  const schedule = estimatePaymentSchedule(settings, 1000, 250);
  assert.deepEqual(schedule.map((item) => item.paidAmount), [100, 150, 0]);
  assert.deepEqual(schedule.map((item) => item.status), ['paid', 'upcoming', 'upcoming']);
  assert.deepEqual(schedule.map((item) => item.payable), [true, false, false]);
  assert.equal(nextPayableMilestone(schedule), null);
});

test('next payable respects requested keys and falls back to the first unpaid payable milestone', () => {
  const schedule = estimatePaymentSchedule(settingsFor([10, 40, 50]), 1000, 250);
  assert.equal(nextPayableMilestone(schedule)?.key, 'payment_2');
  assert.equal(nextPayableMilestone(schedule, 'payment_3')?.key, 'payment_3');
  assert.equal(nextPayableMilestone(schedule, 'payment_1')?.key, 'payment_2');
  assert.equal(nextPayableMilestone(schedule, 'missing')?.key, 'payment_2');
});

test('a one-cent unpaid remainder remains due', () => {
  const schedule = estimatePaymentSchedule({ depositPercent: 0 }, 1, 0.99);
  assert.equal(schedule[0].paidAmount, 0.99);
  assert.equal(schedule[0].status, 'due');
  assert.equal(nextPayableMilestone(schedule)?.key, 'completion');
});

test('paid input is rounded once and then allocated in integer cents', () => {
  const schedule = estimatePaymentSchedule(settingsFor([10, 40, 50]), 10, 5.006);
  assert.deepEqual(schedule.map((item) => item.paidAmount), [1, 4, 0.01]);
  assert.deepEqual(schedule.map((item) => item.status), ['paid', 'paid', 'due']);
  const accumulated = estimatePaymentSchedule({}, 0.3, 0.1 + 0.2);
  assert.deepEqual(accumulated.map((item) => item.paidAmount), [0.15, 0.15]);
  assert.ok(accumulated.every((item) => item.status === 'paid'));
});

test('zero totals, overpayments, and negative paid amounts remain bounded', () => {
  const settings = settingsFor([10, 40, 50]);
  assert.ok(estimatePaymentSchedule(settings, 0, 10).every((item) => item.amount === 0 && item.paidAmount === 0 && item.status === 'paid'));
  const overpaid = estimatePaymentSchedule(settings, 10, 100);
  assert.deepEqual(overpaid.map((item) => item.paidAmount), [1, 4, 5]);
  assert.equal(nextPayableMilestone(overpaid), null);
  assert.ok(estimatePaymentSchedule(settings, 10, -1).every((item) => item.paidAmount === 0));
});

test('contract money rounds once using decimal half-up', () => {
  assert.deepEqual(estimatePaymentSchedule({ depositPercent: 0 }, 1.005).map((item) => item.amount), [1.01]);
});

test('maximum supported contract and payment reconcile without overflow', () => {
  const schedule = estimatePaymentSchedule(settingsFor([33.33, 33.33, 33.34]), 99999999.99, 99999999.99);
  assert.equal(schedule.reduce((sum, item) => sum + cents(item.amount), 0), 9999999999);
  assert.equal(schedule.reduce((sum, item) => sum + cents(item.paidAmount), 0), 9999999999);
  assert.ok(schedule.every((item) => item.status === 'paid'));
});

test('invalid, negative, and oversized contracts cannot produce unbounded milestones', () => {
  for (const total of [NaN, Infinity, -Infinity, -0.01, 100000000, Number.MAX_VALUE]) {
    assert.throws(() => estimatePaymentSchedule({}, total), (error) => error instanceof EstimationInputError && error.field === 'total');
  }
  for (const paid of [NaN, Infinity, -Infinity, 100000000, -100000000]) {
    assert.throws(() => estimatePaymentSchedule({}, 100, paid), (error) => error instanceof EstimationInputError && error.field === 'paidAmount');
  }
});

test('default progress and completion-only schedules retain ordering and payable behavior', () => {
  const progress = estimatePaymentSchedule({ depositPercent: 10, paymentTerms: 'Progress payments' }, 1000);
  assert.deepEqual(progress.map((item) => [item.key, item.percent, item.amount, item.payable]), [
    ['deposit', 10, 100, true], ['progress', 45, 450, false], ['completion', 45, 450, false],
  ]);
  const completion = estimatePaymentSchedule({ depositPercent: 0 }, 1000);
  assert.deepEqual(completion.map((item) => [item.key, item.amount, item.payable]), [['completion', 1000, true]]);
});

test('every contract and paid cent reconciles across small totals and payment boundaries', () => {
  const settings = settingsFor([33.33, 33.33, 33.34]);
  for (let totalMinor = 0; totalMinor <= 101; totalMinor++) {
    for (const paidMinor of [0, 1, Math.floor(totalMinor / 2), totalMinor, totalMinor + 1]) {
      const schedule = estimatePaymentSchedule(settings, totalMinor / 100, paidMinor / 100);
      assert.equal(schedule.reduce((sum, item) => sum + cents(item.amount), 0), totalMinor);
      assert.equal(schedule.reduce((sum, item) => sum + cents(item.paidAmount), 0), Math.min(totalMinor, paidMinor));
      assert.ok(schedule.every((item) => cents(item.paidAmount) >= 0 && cents(item.paidAmount) <= cents(item.amount)));
    }
  }
});
