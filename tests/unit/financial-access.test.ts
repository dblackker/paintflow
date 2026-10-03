import test from 'node:test';
import assert from 'node:assert/strict';
import { hasFinancialAccess } from '../../apps/api/src/middleware/financial-access';

test('financial operations require owner or an explicit financial grant', () => {
  assert.equal(hasFinancialAccess(true, null), true);
  for (const permission of ['all', '*', 'manage_invoices', 'manage_settings']) {
    assert.equal(hasFinancialAccess(false, [permission]), true);
  }
  for (const permissions of [null, 'all', {}, ['view_jobs', 'log_own_time'], ['manage_estimates'], ['manage_job_costs']]) {
    assert.equal(hasFinancialAccess(false, permissions), false);
  }
});
