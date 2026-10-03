import { test } from 'node:test';
import assert from 'node:assert/strict';
import { manualPaymentFeedback } from '../../apps/web/src/lib/paymentReceipt';

test('receipt feedback never presents an accepted payment as a failed payment or a queued email', () => {
  assert.deepEqual(manualPaymentFeedback({ receiptStatus: 'sent' }), { message: 'Payment recorded and receipt sent', type: 'success' });
  assert.equal(manualPaymentFeedback({ receiptStatus: 'not_requested' }).message, 'Payment recorded');
  assert.match(manualPaymentFeedback({ receiptStatus: 'failed' }).message, /^Payment recorded\. Receipt not sent/);
  assert.match(manualPaymentFeedback({ receiptStatus: 'not_retried' }).message, /^Payment already recorded\./);
  for (const receiptStatus of ['failed', 'not_retried'] as const) assert.equal(manualPaymentFeedback({ receiptStatus }).type, 'info');
});
