import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invoiceCollectionPosition, type InvoiceBalance } from '../../packages/core/src/invoice-position';

const balance: InvoiceBalance = { remaining: '50.00', closed: false, needsReview: false, pendingRefunds: 0,
  allocated: '50.00', credits: '25.00', netCollected: '25.00', total: '100.00' };

test('a partial refund credited against an invoice never reopens the refunded amount', () => {
  assert.equal(invoiceCollectionPosition({ total: '100.00', balance }).remaining, 50);
});
test('pending refunds and unknown historical dispositions pause collection', () => {
  assert.equal(invoiceCollectionPosition({ balance: { ...balance, pendingRefunds: 1 } }).remaining, 0);
  assert.equal(invoiceCollectionPosition({ total: '100.00' }, [{ amount: '50.00', refundedAmount: '25.00', status: 'partially_refunded' }]).needsReview, true);
});
test('pending payments are not cash and canceled or fully refunded invoices are closed', () => {
  assert.equal(invoiceCollectionPosition({ total: '100.00' }, [{ amount: '100.00', status: 'processing' }]).remaining, 100);
  assert.equal(invoiceCollectionPosition({ total: '100.00', status: 'refunded' }).remaining, 0);
  assert.equal(invoiceCollectionPosition({ total: '100.00', status: 'canceled' }).remaining, 0);
});
