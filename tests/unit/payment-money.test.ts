import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exactUsd } from '../../apps/api/src/lib/payment-operations';

test('finance uses exact USD cents without silent fractional-cent rounding', () => {
  assert.equal(exactUsd('0.29'), '0.29');
  assert.equal(exactUsd(10.2), '10.20');
  assert.equal(exactUsd('001.000'), '1.00');
  assert.equal(exactUsd('99999999.99'), '99999999.99');
  for (const value of ['1.005', '1e2', '1,000', '', 'NaN', '100000000.00', 0, -1, Infinity, NaN]) {
    assert.throws(() => exactUsd(value));
  }
});
