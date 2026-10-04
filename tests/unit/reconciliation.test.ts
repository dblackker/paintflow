import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconciliationTarget } from '../../scripts/reconcile-repaint.mjs';

const org = '12345678-1234-4234-8234-123456789012';
test('reconciliation cannot use an implicit connection or unscoped workspace', () => {
  assert.throws(() => reconciliationTarget(undefined, org));
  assert.throws(() => reconciliationTarget('postgresql://localhost/test', 'all'));
  assert.throws(() => reconciliationTarget('postgresql://remote.example/test', org));
  assert.equal(reconciliationTarget('postgresql:///crewmodo_test?host=/var/run/postgresql', org).orgId, org);
  assert.equal(reconciliationTarget('postgresql://remote.example/test', org, true).orgId, org);
});
