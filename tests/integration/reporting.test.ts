import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import pg from "pg";
import { buildReportingDashboardQuery } from "../../apps/api/src/routes/reports.ts";
import {
  reportingDashboard,
  type ReportingAggregate,
} from "../../packages/core/src/reporting.ts";

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString)
  throw new Error("TEST_DATABASE_URL is required for reporting SQL tests.");
const url = new URL(connectionString);
const host = url.searchParams.get("host") || url.hostname;
if (
  !["localhost", "127.0.0.1", "/var/run/postgresql"].includes(host) ||
  !url.pathname.endsWith("_test")
) {
  throw new Error(
    "Reporting integration tests refuse remote or non-test databases.",
  );
}
const pool = new pg.Pool({ connectionString, max: 2 });
const requireApi = createRequire(
  new URL("../../apps/api/package.json", import.meta.url),
);
const { PgDialect } = requireApi("drizzle-orm/pg-core");
after(async () => {
  await pool.end();
});

const orgA = "11111111-1111-4111-8111-111111111111";
const orgB = "22222222-2222-4222-8222-222222222222";
const leadA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const leadA2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const leadB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const estimateA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa11";
const estimateB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb11";
const jobA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa111";
const jobB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb111";
const memberA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa1111";
const memberB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb1111";
const uuid = (value: string) => `'${value}'::uuid`;
const json = (value: unknown) =>
  `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;

// CTE fixtures shadow table names used by the real query. No INSERT, schema reset, or database writes.
function fixtures(
  options: {
    noCosts?: boolean;
    flagged?: boolean;
    approvedChange?: boolean;
    unknownContract?: boolean;
    pendingRefund?: boolean;
  } = {},
) {
  const packageA = options.unknownContract
    ? [{ name: "proposal", total: "1092.00" }]
    : [
        {
          name: "proposal",
          total: "1092.00",
          tax: "92.00",
          subtotal: "1000.00",
          discount: "0.00",
        },
      ];
  return `
    leads(id, org_id) as (values (${uuid(leadA)}, ${uuid(orgA)}), (${uuid(leadA2)}, ${uuid(orgA)}), (${uuid(leadB)}, ${uuid(orgB)})),
    estimates(id, org_id, lead_id, packages, status) as (values
      (${uuid(estimateA)}, ${uuid(orgA)}, ${uuid(leadA)}, ${json(packageA)}, 'accepted'),
      (${uuid("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa12")}, ${uuid(orgA)}, ${uuid(leadA)}, ${json([{ total: "9999", tax: "0" }])}, 'draft'),
      (${uuid("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa13")}, ${uuid(orgA)}, ${uuid(leadA)}, ${json([{ total: "8888", tax: "0" }])}, 'sent'),
      (${uuid("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa14")}, ${uuid(orgA)}, ${uuid(leadA)}, ${json([{ total: "7777", tax: "0" }])}, 'superseded'),
      (${uuid(estimateB)}, ${uuid(orgB)}, ${uuid(leadB)}, ${json([{ name: "proposal", total: "9828", tax: "828", subtotal: "9000", discount: "0" }])}, 'accepted')
    ),
    jobs(id, org_id, lead_id, estimate_id) as (values
      (${uuid(jobA)}, ${uuid(orgA)}, ${uuid(leadA)}, ${uuid(estimateA)}),
      (${uuid(jobB)}, ${uuid(orgB)}, ${uuid(leadB)}, ${uuid(estimateB)})
    ),
    job_costs(job_id, org_id, total_cost) as (values
      (${uuid(jobA)}, ${uuid(orgA)}, ${options.noCosts ? "0" : "100"}::numeric),
      (${uuid(jobA)}, ${uuid(orgA)}, ${options.noCosts ? "0" : "100"}::numeric),
      (${uuid(jobB)}, ${uuid(orgB)}, 700::numeric),
      (${uuid(jobA)}, ${uuid(orgB)}, 900::numeric)
    ),
    change_orders(job_id, estimate_id, org_id, amount, status) as (values
      (${uuid(jobA)}, ${uuid(estimateA)}, ${uuid(orgA)}, 150::numeric, '${options.approvedChange ? "approved" : "pending"}'),
      (${uuid(jobA)}, ${uuid(estimateA)}, ${uuid(orgB)}, 10000::numeric, 'approved')
    ),
    team_members(id, org_id) as (values (${uuid(memberA)}, ${uuid(orgA)}), (${uuid(memberB)}, ${uuid(orgB)})),
    time_entries(org_id, team_member_id, job_id, review_status) as (values
      (${uuid(orgA)}, ${uuid(memberA)}, ${uuid(jobA)}, '${options.flagged ? "flagged" : "approved"}'),
      (${uuid(orgB)}, ${uuid(memberB)}, ${uuid(jobB)}, 'flagged'),
      (${uuid(orgA)}, ${uuid(memberB)}, ${uuid(jobA)}, 'flagged')
    ),
    customer_payments(org_id, lead_id, amount, refunded_amount, currency, status, metadata) as (values
      (${uuid(orgA)}, ${uuid(leadA)}, 500::numeric, 100::numeric, 'usd', 'partially_refunded', ${json({ lastRefundStatus: options.pendingRefund ? "pending" : "succeeded" })}),
      (${uuid(orgA)}, ${uuid(leadA)}, 10000::numeric, 0::numeric, 'usd', 'pending', '{}'::jsonb),
      (${uuid(orgB)}, ${uuid(leadB)}, 9999::numeric, 0::numeric, 'usd', 'succeeded', '{}'::jsonb),
      (${uuid(orgA)}, ${uuid(leadB)}, 9999::numeric, 0::numeric, 'usd', 'succeeded', '{}'::jsonb)
    ),
    audit_logs(id, org_id, entity_type, entity_id, action, metadata, created_at) as (values
      (${uuid("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaa11111")}, ${uuid(orgA)}, 'estimate', ${uuid(estimateA)}, 'estimate.signed', ${json({ packageName: "proposal", selectedOptions: [] })}, '2026-10-03'::timestamp),
      (${uuid("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbb11111")}, ${uuid(orgB)}, 'estimate', ${uuid(estimateA)}, 'estimate.signed', ${json({ packageName: "wrong" })}, '2026-10-04'::timestamp)
    )`;
}

async function queryReport(
  orgId: string,
  options: Parameters<typeof fixtures>[0] = {},
) {
  const compiled = new PgDialect().sqlToQuery(
    buildReportingDashboardQuery(orgId),
  );
  const query = compiled.sql.replace(
    /^with\s+/i,
    `with ${fixtures(options)}, `,
  );
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const result = await client.query(query, compiled.params);
    return reportingDashboard(
      result.rows[0] as ReportingAggregate,
      "2026-10-03T12:00:00.000Z",
    );
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

test("real PostgreSQL: $1000 + two $100 costs has no fanout; drafts/revisions and other-tenant rows do not inflate totals", async () => {
  const report = await queryReport(orgA);
  assert.equal(report.totalRevenue, 1000);
  assert.equal(report.totalCosts, 200);
  assert.equal(report.margin, 80);
  assert.equal(report.profit, 800);
  assert.equal(report.totalLeads, 2);
  assert.equal(report.wonLeads, 1);
  assert.equal(report.winRate, 50);
  assert.equal(report.collectedGross, 500);
  assert.equal(report.refundedGross, 100);
  assert.equal(report.netCollectedGross, 400);
  assert.deepEqual(report.warnings, []);
});

test("real PostgreSQL: second tenant sees only its own entities, not corrupt cross-tenant links", async () => {
  const report = await queryReport(orgB);
  assert.equal(report.totalRevenue, 9000);
  assert.equal(report.totalCosts, 700);
  assert.equal(report.collectedGross, 9999);
  assert.equal(report.totalLeads, 1);
  assert.equal(report.approvedActualCost, null);
});

test("real PostgreSQL: approved change increases contracted subtotal once, pending change does not", async () => {
  const report = await queryReport(orgA, { approvedChange: true });
  assert.equal(report.totalRevenue, 1150);
  assert.equal(report.totalCosts, 200);
});

test("real PostgreSQL: missing costs and unreviewed labor produce unknown margin", async () => {
  const missing = await queryReport(orgA, { noCosts: true });
  assert.equal(missing.margin, null);
  assert.equal(missing.profit, null);
  const pending = await queryReport(orgA, { flagged: true });
  assert.equal(pending.recordedActualCost, 200);
  assert.equal(pending.approvedActualCost, null);
  assert.equal(pending.margin, null);
});

test("real PostgreSQL: missing historical tax and unconfirmed refunds remain explicit", async () => {
  const report = await queryReport(orgA, {
    unknownContract: true,
    pendingRefund: true,
  });
  assert.equal(report.totalRevenue, null);
  assert.equal(report.netCollectedGross, null);
  assert.deepEqual(
    report.warnings.map((warning) => warning.code),
    ["CONTRACT_SNAPSHOT_MISSING", "REFUND_CONFIRMATION_REQUIRED"],
  );
});
