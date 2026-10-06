import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import dashboard from '../../apps/api/src/routes/dashboard';
import {
  buildDashboardCollectionsQuery,
  buildDashboardOverviewQuery,
} from '../../apps/api/src/lib/dashboard-overview';
import { dashboardRange } from '../../packages/core/src/dashboard-insights';
import {
  bridgeNeonToPostgres,
  disposableDatabase,
  migrateDisposableDatabase,
} from './local-db';

const pool = disposableDatabase();
const restore = bridgeNeonToPostgres(pool);
const { PgDialect } = createRequire(
  new URL('../../apps/api/package.json', import.meta.url),
)('drizzle-orm/pg-core');
const sessions = new Map<string, string>();
const env = {
  DATABASE_URL:
    'postgresql://synthetic:synthetic@localhost/crewmodo_dashboard_test',
  ENVIRONMENT: 'test',
  KV: { get: async (key: string) => sessions.get(key) || null },
};
before(async () => {
  await migrateDisposableDatabase(pool);
});
after(async () => {
  restore();
  await pool.end();
});

async function organization(role = 'owner') {
  const orgId = randomUUID(),
    userId = randomUUID();
  await pool.query('insert into organizations(id,name,slug) values($1,$2,$2)', [
    orgId,
    `overview-${orgId}`,
  ]);
  await pool.query('insert into users(id,email) values($1,$2)', [
    userId,
    `${userId}@example.invalid`,
  ]);
  await pool.query(
    'insert into memberships(org_id,user_id,role) values($1,$2,$3)',
    [orgId, userId, role],
  );
  sessions.set(
    `session:${userId}`,
    JSON.stringify({
      orgId,
      userId,
      email: 'synthetic@example.invalid',
      expiresAt: Date.now() + 3600000,
    }),
  );
  const result = await pool.query(
    "insert into leads(org_id,name,street_address,city) values($1,'Synthetic customer','Customer mailing address','Seattle') returning id",
    [orgId],
  );
  return { orgId, userId, leadId: result.rows[0].id };
}
async function run(query: any) {
  const bound = new PgDialect().sqlToQuery(query);
  return (await pool.query(bound.sql, bound.params)).rows[0];
}
const overview = (orgId: string, now = '2026-10-06T19:00:00Z') =>
  run(
    buildDashboardOverviewQuery(
      orgId,
      dashboardRange(4, 'America/Los_Angeles', new Date(now)),
    ),
  );
async function invoice(
  orgId: string,
  leadId: string,
  status = 'sent',
  due = '2026-10-05',
) {
  const result = await pool.query(
    "insert into customer_invoices(org_id,lead_id,invoice_number,description,line_items,subtotal,total,status,due_date) values($1,$2,$3,'Synthetic invoice','[]',100,100,$4,$5) returning id",
    [orgId, leadId, randomUUID(), status, due],
  );
  return result.rows[0].id;
}
const call = (userId: string, path: string) =>
  dashboard.fetch(
    new Request(`http://localhost${path}`, {
      headers: { Authorization: `Bearer ${userId}` },
    }),
    env as never,
  );

test('workday counts entire queues but bounds visible lists and uses the jobsite, not mailing address', async () => {
  const a = await organization(),
    b = await organization();
  for (let index = 0; index < 6; index++) {
    await pool.query(
      "insert into jobs(org_id,lead_id,name,status,street_address,city,scheduled_start_at,scheduled_end_at) values($1,$2,'Synthetic job','in_progress','123 Jobsite Ave','Tacoma','2026-10-05 07:00','2026-10-09 06:59:59')",
      [a.orgId, a.leadId],
    );
    await pool.query(
      "insert into activities(org_id,lead_id,title,type,due_at) values($1,$2,'Follow up','call','2026-10-05 20:00')",
      [a.orgId, a.leadId],
    );
  }
  await pool.query(
    "insert into jobs(org_id,lead_id,name,scheduled_start_at) values($1,$2,'Corrupt link','2026-10-06 07:00')",
    [a.orgId, b.leadId],
  );
  await pool.query(
    "insert into activities(org_id,lead_id,title,type,due_at) values($1,$2,'Corrupt task','call','2026-10-05')",
    [a.orgId, b.leadId],
  );
  await pool.query(
    "insert into estimates(org_id,lead_id,status,total,packages) values($1,$2,'sent',100,'[]'),($1,$2,'draft',100,'[]'),($1,$3,'sent',100,'[]')",
    [a.orgId, a.leadId, b.leadId],
  );
  const result = await overview(a.orgId);
  assert.equal(Number(result.todayJobCount), 6);
  assert.equal(Number(result.overdueTasks), 6);
  assert.equal(Number(result.awaitingApproval), 1);
  assert.equal(result.todayJobs.length, 4);
  assert.equal(result.tasks.length, 4);
  assert.ok(
    result.todayJobs.every(
      (job: any) =>
        job.streetAddress === '123 Jobsite Ave' && job.city === 'Tacoma',
    ),
  );
  assert.ok(
    result.tasks.every(
      (task: any) =>
        task.overdue && task.href === `/leads/${a.leadId}#customer-activity`,
    ),
  );
  assert.equal(Number((await overview(b.orgId)).todayJobCount), 0);
});

test('workday respects local day boundaries, due-today versus overdue, completed jobs, and missing schedules', async () => {
  const a = await organization();
  for (const [status, start, end] of [
    ['scheduled', '2026-10-06 07:00', null],
    ['in_progress', '2026-10-05 07:00', '2026-10-07 06:59:59'],
    ['completed', '2026-10-06 07:00', null],
    ['deposit_pending', '2026-10-06 07:00', null],
    ['scheduled', null, null],
    ['scheduled', '2026-10-07 07:00', null],
    ['scheduled', '2026-10-05 07:00', '2026-10-06 06:59:59'],
  ])
    await pool.query(
      'insert into jobs(org_id,lead_id,name,status,scheduled_start_at,scheduled_end_at) values($1,$2,$3,$4,$5,$6)',
      [a.orgId, a.leadId, 'Synthetic job', status, start, end],
    );
  for (const [due, status] of [
    ['2026-10-06 06:59:59', 'open'],
    ['2026-10-06 07:00', 'open'],
    ['2026-10-07 06:59:59', 'open'],
    ['2026-10-07 07:00', 'open'],
    ['2026-10-05', 'done'],
  ]) {
    await pool.query(
      "insert into activities(org_id,lead_id,title,type,due_at,status) values($1,$2,'Follow up','call',$3,$4)",
      [a.orgId, a.leadId, due, status],
    );
  }
  const result = await overview(a.orgId);
  assert.equal(Number(result.todayJobCount), 2);
  assert.equal(Number(result.overdueTasks), 1);
  assert.equal(Number(result.dueToday), 2);
  assert.equal(result.todayJobs[0].streetAddress, 'Customer mailing address');
  assert.ok(result.tasks.every((task: any) => task.dueAt.endsWith('Z')));
});

test('weekends match the calendar: multi-day production skips weekends, explicit weekend-only jobs remain visible', async () => {
  const a = await organization();
  await pool.query(
    "insert into jobs(org_id,lead_id,name,scheduled_start_at,scheduled_end_at) values($1,$2,'Weekday project','2026-10-02 07:00','2026-10-06 06:59:59'),($1,$2,'Saturday project','2026-10-03 07:00','2026-10-04 06:59:59')",
    [a.orgId, a.leadId],
  );
  const result = await overview(a.orgId, '2026-10-03T19:00:00Z');
  assert.equal(Number(result.todayJobCount), 1);
  assert.equal(result.todayJobs[0].name, 'Saturday project');
});

test('DST fall-back uses a 25-hour local day for task deadlines', async () => {
  const a = await organization();
  for (const due of [
    '2026-11-01 06:59:59',
    '2026-11-01 07:00',
    '2026-11-02 07:59:59',
    '2026-11-02 08:00',
  ]) {
    await pool.query(
      "insert into activities(org_id,title,type,due_at) values($1,'DST task','task',$2)",
      [a.orgId, due],
    );
  }
  const result = await overview(a.orgId, '2026-11-01T20:00:00Z');
  assert.equal(Number(result.overdueTasks), 1);
  assert.equal(Number(result.dueToday), 2);
});

test('invoice snapshot uses the full ledger, excludes terminal/draft/refund-review items, and preserves exact decimal totals', async () => {
  const a = await organization(),
    b = await organization();
  const partial = await invoice(a.orgId, a.leadId);
  for (const amount of ['10.01', '20.02'])
    await pool.query(
      "insert into customer_payments(org_id,lead_id,invoice_id,amount,source) values($1,$2,$3,$4,'check')",
      [a.orgId, a.leadId, partial, amount],
    );
  await invoice(a.orgId, a.leadId, 'sent', '2026-10-06');
  await invoice(a.orgId, a.leadId, 'draft');
  await invoice(a.orgId, a.leadId, 'voided');
  await invoice(a.orgId, a.leadId, 'paid'); // Legacy paid flag without a complete ledger must be reviewed, not collected.
  await invoice(a.orgId, b.leadId);
  const paid = await invoice(a.orgId, a.leadId, 'paid');
  await pool.query(
    'insert into customer_payments(org_id,lead_id,invoice_id,amount) values($1,$2,$3,100)',
    [a.orgId, a.leadId, paid],
  );
  const refunded = await invoice(a.orgId, a.leadId, 'refunded');
  await pool.query(
    "insert into customer_payments(org_id,lead_id,invoice_id,amount,refunded_amount,status) values($1,$2,$3,100,100,'refunded')",
    [a.orgId, a.leadId, refunded],
  );
  const review = await invoice(a.orgId, a.leadId, 'partially_refunded');
  await pool.query(
    "insert into customer_payments(org_id,lead_id,invoice_id,amount,refunded_amount,status) values($1,$2,$3,40,10,'partially_refunded')",
    [a.orgId, a.leadId, review],
  );
  for (const [state, refundedAmount] of [
    ['succeeded', 10],
    ['pending', 0],
  ] as const) {
    const invoiceId = await invoice(
      a.orgId,
      a.leadId,
      refundedAmount ? 'partially_refunded' : 'partially_paid',
    );
    const payment = await pool.query(
      "insert into customer_payments(org_id,lead_id,invoice_id,amount,refunded_amount,status,source) values($1,$2,$3,40,$4,$5,'check') returning id",
      [
        a.orgId,
        a.leadId,
        invoiceId,
        refundedAmount,
        refundedAmount ? 'partially_refunded' : 'succeeded',
      ],
    );
    await pool.query(
      "insert into payment_refund_operations(org_id,payment_id,actor_id,operation_key,request,amount,source,reason,method,effective_at,state,provider_key) values($1,$2,$3,$4,'{}',10,'check','Synthetic credit','check',now(),$5,$6)",
      [
        a.orgId,
        payment.rows[0].id,
        a.userId,
        randomUUID(),
        state,
        randomUUID(),
      ],
    );
  }
  const result = await run(
    buildDashboardCollectionsQuery(a.orgId, '2026-10-06'),
  );
  assert.equal(Number(result.invoiceCount), 3);
  assert.equal(Number(result.outstanding), 229.97);
  assert.equal(Number(result.overdueCount), 2);
  assert.equal(Number(result.overdue), 129.97);
  assert.equal(Number(result.reviewCount), 3);
  assert.equal(
    Number(
      (await run(buildDashboardCollectionsQuery(b.orgId, '2026-10-06')))
        .invoiceCount,
    ),
    0,
  );
});

test('HTTP: money requires financial permissions; a sales operator can read workday only; invalid zones are rejected', async () => {
  const a = await organization(),
    member = await organization('member');
  const role = randomUUID();
  await pool.query(
    "insert into roles(id,org_id,name,permissions) values($1,$2,'Sales','[\"manage_leads\"]')",
    [role, member.orgId],
  );
  await pool.query(
    'insert into user_roles(org_id,user_id,role_id) values($1,$2,$3)',
    [member.orgId, member.userId, role],
  );
  assert.equal((await call(member.userId, '/overview')).status, 200);
  assert.equal((await call(member.userId, '/collections')).status, 403);
  for (const path of ['/overview', '/collections']) {
    const response = await call(a.userId, path);
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(
      (await call(a.userId, `${path}?timeZone=wrong%2Fzone`)).status,
      400,
    );
    assert.equal(
      (
        await dashboard.fetch(
          new Request(`http://localhost${path}`),
          env as never,
        )
      ).status,
      401,
    );
  }
});
