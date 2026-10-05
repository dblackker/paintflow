import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dashboardInsights, dashboardPercent, dashboardRange } from '../../packages/core/src/dashboard-insights';
import { buildDashboardInsightsQuery } from '../../apps/api/src/lib/dashboard-insights';
import { buildJobFinancialQuery } from '../../apps/api/src/routes/jobs';

const { PgDialect } = createRequire(new URL('../../apps/api/package.json', import.meta.url))('drizzle-orm/pg-core');

test('weekly ranges start Monday, include the current partial week, and follow the local calendar', () => {
  const now = new Date('2026-10-05T02:00:00Z');
  assert.deepEqual(dashboardRange(4, 'America/Los_Angeles', now), {
    weeks: 4, timeZone: 'America/Los_Angeles', startDate: '2026-09-07', endDate: '2026-10-04', asOf: now.toISOString(),
  });
  assert.equal(dashboardRange(4, 'UTC', now).startDate, '2026-09-14');
  assert.equal(dashboardRange(8, 'America/Los_Angeles', new Date('2026-11-02T03:00:00Z')).startDate, '2026-09-07');
  assert.equal(dashboardRange(12, 'Asia/Tokyo', now).startDate, '2026-07-20');
  assert.throws(() => dashboardRange(52 as never, 'UTC'), /4, 8, or 12/);
  assert.throws(() => dashboardRange(8, 'invalid/timezone'));
});

test('percentages have explicit empty denominators, rather than false zero-percent performance', () => {
  assert.equal(dashboardPercent(0, 0), null);
  assert.equal(dashboardPercent(0, 4), 0);
  assert.equal(dashboardPercent(1, 3), 33.3);
  const range = dashboardRange(4, 'UTC', new Date('2026-10-04'));
  const report = dashboardInsights(range, { leads: '4', estimated: '3', sent: '2', won: '1', lost: '1', manualWins: '1', weeklyLeads: [
    { weekStart: '2026-09-07', count: '1' }, { weekStart: '2026-09-14', count: '0' },
    { weekStart: '2026-09-21', count: '1' }, { weekStart: '2026-09-28', count: '2' },
  ] });
  assert.equal(report.funnel.winRate, 25);
  assert.equal(report.funnel.approvalRate, 50);
  assert.equal(report.funnel.open, 1);
  assert.equal(report.funnel.manualWins, 1);
  assert.equal(report.weeklyLeads[1].count, 0);
  assert.equal(report.weeklyLeads[3].current, true);
  assert.equal(dashboardInsights(range, {}).funnel.winRate, null);
});

test('insights SQL scopes both sides of joins, uses existence instead of document fanout, and parameterizes ranges', () => {
  const org = '11111111-1111-4111-8111-111111111111';
  const range = dashboardRange(8, 'America/Los_Angeles', new Date('2026-10-04'));
  const query = new PgDialect().sqlToQuery(buildDashboardInsightsQuery(org, range));
  assert.ok(query.params.filter((value: unknown) => value === org).length >= 6);
  assert.ok(query.params.includes(range.timeZone));
  assert.ok(!query.sql.includes(org));
  assert.match(query.sql, /generate_series/);
  assert.match(query.sql, /exists \(select 1 from "estimates" e/);
  assert.match(query.sql, /e.status = 'accepted'/);
  assert.match(query.sql, /l.org_id = \$\d+/);
  assert.match(query.sql, /j.org_id = \$\d+/);
  assert.ok(!query.sql.includes('customer_payments'));
});

test('job status drilldown is a bound server filter applied before cursor pagination', () => {
  const query = new PgDialect().sqlToQuery(buildJobFinancialQuery('11111111-1111-4111-8111-111111111111', {
    status: 'in_progress', limit: 20, cursor: { timestamp: '2026-10-04T12:00:00.000000', id: '22222222-2222-4222-8222-222222222222' },
  }));
  assert.ok(query.params.includes('in_progress'));
  assert.match(query.sql, /j.status = \$\d+[\s\S]+order by j.created_at desc, j.id desc limit/);
});
