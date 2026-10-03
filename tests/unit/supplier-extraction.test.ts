import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSupplierItems, reconcileSupplierTotals } from '../../packages/core/src/supplier-extraction';

test('Sherwin gallons, five-gallon buckets, colors and fees remain distinct', () => {
  const [gallons, bucket, fee] = normalizeSupplierItems([
    { description: 'WD SCPS RR SC DB', salesNumber: '6512-87153', productCode: 'A19W553', size: 'GALLON', quantity: 2, unitCost: 63.95, total: 127.90, colorName: 'SWISS COFFEE', colorCode: '7002-16' },
    { description: 'SuperPaint', size: '5 GAL', quantity: 1, unitCost: 250, total: 250 },
    { description: 'GOVT IMPOSED PAINT FEE', quantity: 2, unitCost: 1.45, total: 2.90 },
  ]);
  assert.equal(gallons.gallons, 2);
  assert.equal(gallons.pricePerGallon, 63.95);
  assert.equal(gallons.colorName, 'SWISS COFFEE');
  assert.equal(bucket.gallons, 5);
  assert.equal(bucket.pricePerGallon, 50);
  assert.equal(bucket.unitCost, 250);
  assert.equal(fee.isFee, true);
  assert.equal(fee.gallons, null);
  assert.equal(fee.pricePerGallon, null);
});

test('returns are preserved rather than silently discarded or treated as positive purchases', () => {
  const [returned, credit] = normalizeSupplierItems([
    { description: 'Returned paint', size: 'GALLON', quantity: -2, unitCost: 50, total: -100 },
    { description: 'Supplier credit', quantity: 1, unitCost: 25, total: -25, category: 'fees' },
  ]);
  assert.equal(returned.total, -100);
  assert.equal(returned.gallons, -2);
  assert.equal(returned.pricePerGallon, 50);
  assert.equal(credit.total, -25);
});

test('malformed OCR numbers fail for review; zero and exact-cent amounts do not invent a quantity', () => {
  assert.throws(() => normalizeSupplierItems([{ description: 'Paint', quantity: 'two', total: 100 }]));
  assert.throws(() => normalizeSupplierItems([{ description: 'Paint', quantity: 0, total: 100 }]));
  assert.throws(() => normalizeSupplierItems([{ description: 'Paint', total: 1.001 }]));
  assert.throws(() => normalizeSupplierItems([{ description: 'Return', quantity: -1, total: 100 }]));
  assert.equal(normalizeSupplierItems([{ description: 'No charge', quantity: 0, total: 0 }])[0].quantity, 0);
  assert.equal(normalizeSupplierItems([{ description: 'Fractional sundry', quantity: 0.1, unitCost: 0.2 }])[0].total, 0.02);
});

test('contradictory bucket pricing and gallon counts cannot rewrite a contractor pricebook', () => {
  assert.throws(() => normalizeSupplierItems([{ description: 'Paint bucket', quantity: 1, size: '5 GAL', gallons: 5, unitCost: 300, total: 300, pricePerGallon: 300 }]), /Price per gallon/);
  assert.throws(() => normalizeSupplierItems([{ description: 'Paint bucket', quantity: 1, size: '5 GAL', gallons: 1, unitCost: 300, total: 300 }]), /pack size/);
  const [line] = normalizeSupplierItems([{ description: 'Paint bucket', quantity: 1, size: '5 GAL', gallons: 5, unitCost: 300, total: 299.99, pricePerGallon: 60 }]);
  assert.equal(line.pricePerGallon, 59.998);
});

test('document reconciliation catches omitted fees and distinguishes statement balances from charges', () => {
  const paint = [{ total: 127.90 }];
  assert.equal(reconcileSupplierTotals(paint, { totalAmount: 130.80 }, true).status, 'mismatch');
  assert.equal(reconcileSupplierTotals([...paint, { total: 2.90 }], { totalAmount: 130.80 }, true).status, 'matched');
  assert.equal(reconcileSupplierTotals(paint, {}, true).status, 'unavailable');
  assert.equal(reconcileSupplierTotals(paint, { documentType: 'statement', totalAmount: 130.80 }, true).status, 'unavailable');
  const statement = { documentType: 'statement', totalAmount: 9000, chargeTotals: [{ invoiceNumber: 'INV-1', totalAmount: 130.80 }, { invoiceNumber: 'INV-2', totalAmount: -25 }] };
  const lines = [{ total: 127.90, sourceInvoiceNumber: 'INV-1' }, { total: 2.90, sourceInvoiceNumber: 'INV-1' }, { total: -25, sourceInvoiceNumber: 'INV-2' }];
  assert.equal(reconcileSupplierTotals(lines, statement, true).documentTotal, '105.80');
  assert.equal(reconcileSupplierTotals(lines, statement, true).status, 'matched');
  assert.equal(reconcileSupplierTotals(lines.slice(1), statement, true).status, 'mismatch');
  assert.equal(reconcileSupplierTotals(lines, { ...statement, chargeTotals: [statement.chargeTotals[0], statement.chargeTotals[0]] }, true).status, 'unavailable');
});
