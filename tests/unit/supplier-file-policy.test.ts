import test from 'node:test';
import assert from 'node:assert/strict';
import { invoiceFileType } from '../../apps/api/src/lib/supplier-file-policy';

test('invoice files use content signatures, not attacker-controlled extensions or MIME', () => {
  assert.equal(invoiceFileType(new TextEncoder().encode('%PDF-1.7\n')), 'application/pdf');
  assert.equal(invoiceFileType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'image/png');
  assert.equal(invoiceFileType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  assert.equal(invoiceFileType(new TextEncoder().encode('RIFFxxxxWEBP')), 'image/webp');
  for (const content of ['', '<svg/>', '<html>invoice</html>', 'GIF89a', 'not a PDF']) {
    assert.equal(invoiceFileType(new TextEncoder().encode(content)), null);
  }
});
