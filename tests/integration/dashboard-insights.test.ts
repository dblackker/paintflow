import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import dashboard from '../../apps/api/src/routes/dashboard';
import jobsApp from '../../apps/api/src/routes/jobs';
import { buildDashboardInsightsQuery } from '../../apps/api/src/lib/dashboard-insights';
import { dashboardInsights, dashboardRange } from '../../packages/core/src/dashboard-insights';
import { bridgeNeonToPostgres, disposableDatabase, migrateDisposableDatabase } from './local-db';

const pool = disposableDatabase();
const restore = bridgeNeonToPostgres(pool);
const { PgDialect } = createRequire(new URL('../../apps/api/package.json', import.meta.url))('drizzle-orm/pg-core');
const sessions = new Map<string, string>();
const env = { DATABASE_URL: 'postgresql://synthetic:synthetic@localhost/crewmodo_dashboard_test', ENVIRONMENT: 'test', KV: { get: async (key: string) => sessions.get(key) || null } };
before(async () => { await migrateDisposableDatabase(pool); });
after(async () => { restore(); await pool.end(); });

async function organization(role = 'owner') {
  const orgId = randomUUID(), userId = randomUUID();
  await pool.query('insert into organizations(id,name,slug) values($1,$2,$2)', [orgId, `dashboard-${orgId}`]);
  await pool.query('insert into users(id,email) values($1,$2)', [userId, `${userId}@example.invalid`]);
  await pool.query('insert into memberships(org_id,user_id,role) values($1,$2,$3)', [orgId, userId, role]);
  sessions.set(`session:${userId}`, JSON.stringify({ orgId, userId, email: 'synthetic@example.invalid', expiresAt: Date.now() + 3600000 }));
  return { orgId, userId };
}
async function lead(orgId: string, createdAt: string, status = 'new') {
  const result = await pool.query('insert into leads(org_id,name,created_at,status) values($1,$2,$3,$4) returning id', [orgId, 'Synthetic customer', createdAt, status]);
  return result.rows[0].id;
}
async function estimate(orgId: string, leadId: string, status: string, sentAt: string | null = null) {
  await pool.query("insert into estimates(org_id,lead_id,status,total,packages,created_at,sent_at) values($1,$2,$3,100,'[]','2026-10-01 12:00:00',$4)", [orgId, leadId, status, sentAt]);
}
async function insight(orgId: string, weeks: 4 | 8 | 12 = 4, timeZone = 'America/Los_Angeles', asOf = '2026-10-04T19:00:00Z') {
  const range = dashboardRange(weeks, timeZone, new Date(asOf));
  const query = new PgDialect().sqlToQuery(buildDashboardInsightsQuery(orgId, range));
  const rows = await pool.query(query.sql, query.params);
  return dashboardInsights(range, rows.rows[0]);
}
const call = (userId: string, path = '/insights') => dashboard.fetch(new Request(`http://localhost${path}`, { headers: { Authorization: `Bearer ${userId}` } }), env as never);

test('real PostgreSQL: unique lead cohort, empty weeks, revisions, terminal outcomes, and tenant isolation', async () => {
  const a = await organization(), b = await organization();
  const won = await lead(a.orgId, '2026-09-07 07:00:00');
  const draft = await lead(a.orgId, '2026-09-21 12:00:00', 'contacted');
  const lost = await lead(a.orgId, '2026-09-28 12:00:00', 'lost');
  await lead(a.orgId, '2026-10-04 12:00:00', 'won');
  const old = await lead(a.orgId, '2026-09-07 06:59:59');
  await lead(a.orgId, '2026-10-05 12:00:00');
  const other = await lead(b.orgId, '2026-09-28 12:00:00');
  await estimate(a.orgId, won, 'superseded', '2026-10-01');
  await estimate(a.orgId, won, 'sent', '2026-10-01');
  await estimate(a.orgId, won, 'accepted');
  await estimate(a.orgId, draft, 'draft');
  await estimate(a.orgId, lost, 'declined', '2026-10-01');
  await estimate(a.orgId, old, 'accepted');
  await estimate(b.orgId, other, 'accepted');
  await estimate(b.orgId, draft, 'accepted'); // Corrupt foreign link must not count for tenant A.
  await estimate(a.orgId, other, 'accepted'); // Nor may A's estimate inflate B's cohort.
  const report = await insight(a.orgId);
  assert.deepEqual(report.weeklyLeads.map((week) => week.count), [1, 0, 1, 2]);
  assert.deepEqual(report.funnel, { leads: 4, estimated: 3, sent: 2, won: 1, lost: 1, open: 1, manualWins: 1, winRate: 25, estimateRate: 75, sendRate: 66.7, approvalRate: 50 });
  assert.equal((await insight(b.orgId)).funnel.leads, 1);
  assert.equal((await insight(b.orgId)).funnel.won, 1);
});

test('operations separate deposit, missing dates, scheduled, production, punch list, and recently completed', async () => {
  const a = await organization(), b = await organization();
  const ownLead = await lead(a.orgId, '2026-01-01'), foreignLead = await lead(b.orgId, '2026-01-01');
  for (const [status, start, completed, linkedLead, orgId, created] of [
    ['deposit_pending', null, null, ownLead, a.orgId, '2026-01-01'],
    ['scheduled', null, null, ownLead, a.orgId, '2026-01-01'],
    ['scheduled', '2026-10-05', null, ownLead, a.orgId, '2026-01-01'],
    ['in_progress', '2026-10-01', null, ownLead, a.orgId, '2026-01-01'],
    ['punch_list', null, null, ownLead, a.orgId, '2026-01-01'],
    ['completed', null, '2026-10-01', ownLead, a.orgId, '2026-01-01'],
    ['completed', null, '2026-01-10', ownLead, a.orgId, '2026-01-01'],
    ['cancelled', null, null, ownLead, a.orgId, '2026-01-01'],
    ['scheduled', null, null, foreignLead, a.orgId, '2026-01-01'],
    ['scheduled', null, null, ownLead, b.orgId, '2026-01-01'],
    ['scheduled', null, null, ownLead, a.orgId, '2026-10-05'],
  ]) await pool.query('insert into jobs(org_id,lead_id,name,status,scheduled_start_at,completed_at,created_at) values($1,$2,$3,$4,$5,$6,$7)', [orgId, linkedLead, 'Synthetic job', status, start, completed, created]);
  assert.deepEqual((await insight(a.orgId)).operations, { depositPending: 1, needsScheduling: 1, scheduled: 1, inProduction: 1, punchList: 1, completed: 1 });
});

test('empty tenants, sent cancellations, and voided contracts do not manufacture wins or divide by zero', async () => {
  const a = await organization();
  const empty = await insight(a.orgId, 12);
  assert.equal(empty.weeklyLeads.length, 12);
  assert.ok(empty.weeklyLeads.every((week) => week.count === 0));
  assert.equal(empty.funnel.winRate, null);
  const id = await lead(a.orgId, '2026-09-30');
  await estimate(a.orgId, id, 'voided', '2026-10-01');
  await estimate(a.orgId, id, 'canceled', '2026-10-01');
  const result = await insight(a.orgId);
  assert.equal(result.funnel.sent, 1);
  assert.equal(result.funnel.won, 0);
  assert.equal(result.funnel.open, 1);
});

test('DST changes and UTC boundary dates remain in the correct local week', async () => {
  const a = await organization();
  await lead(a.orgId, '2026-11-02 07:59:59'); // Still Sunday after fall-back.
  await lead(a.orgId, '2026-11-02 08:00:00'); // Monday in Los Angeles.
  const result = await insight(a.orgId, 4, 'America/Los_Angeles', '2026-11-02T12:00:00Z');
  assert.deepEqual(result.weeklyLeads.map((week) => week.count), [0, 0, 1, 1]);
});

test('HTTP insights validate range, require workspace permissions, and never cache tenant results publicly', async () => {
  const owner = await organization();
  const response = await call(owner.userId, '/insights?weeks=4&timeZone=America%2FLos_Angeles');
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal((await response.json() as any).data.weeklyLeads.length, 4);
  for (const query of ['weeks=500', 'weeks=4.5', 'timeZone=invalid%2Fzone', 'timeZone=%2B05%3A30']) assert.equal((await call(owner.userId, `/insights?${query}`)).status, 400);
  assert.equal((await dashboard.fetch(new Request('http://localhost/insights'), env as never)).status, 401);
  const crew = await organization('member');
  assert.equal((await call(crew.userId)).status, 403);
});

test('active-lead stat includes contacted and sent leads, not won or lost customers', async () => {
  const a = await organization();
  for (const status of ['new', 'contacted', 'estimate_sent', 'won', 'lost']) await lead(a.orgId, '2026-09-30', status);
  const response = await call(a.userId, '/stats');
  assert.equal(response.status, 200);
  assert.equal((await response.json() as any).data.activeLeads, 3);
});

test('job drilldown filters before pagination and excludes both foreign rows and nonmatching states', async () => {
  const a = await organization(), b = await organization();
  const own = await lead(a.orgId, '2026-09-30'), foreign = await lead(b.orgId, '2026-09-30');
  for (let index = 0; index < 5; index++) await pool.query("insert into jobs(org_id,lead_id,name,status) values($1,$2,'Production job','in_progress')", [a.orgId, own]);
  await pool.query("insert into jobs(org_id,lead_id,name,status) values($1,$2,'Different stage','scheduled')", [a.orgId, own]);
  await pool.query("insert into jobs(org_id,lead_id,name,status) values($1,$2,'Foreign link','in_progress')", [a.orgId, foreign]);
  const get = (path: string) => jobsApp.fetch(new Request(`http://localhost${path}`, { headers: { Authorization: `Bearer ${a.userId}` } }), env as never);
  let cursor: string | null = null;
  const seen = new Set<string>();
  do {
    const response = await get(`/?limit=2&status=in_progress${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    assert.equal(response.status, 200, await response.clone().text());
    const body = await response.json() as any;
    assert.ok(body.data.length <= 2);
    for (const job of body.data) { assert.equal(job.status, 'in_progress'); assert.ok(!seen.has(job.id)); seen.add(job.id); }
    cursor = body.nextCursor;
  } while (cursor);
  assert.equal(seen.size, 5);
  assert.equal((await get('/?status=not_a_state')).status, 400);
});
