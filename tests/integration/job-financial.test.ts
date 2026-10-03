import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import pg from "pg";
import {
  buildJobFinancialQuery,
  jobCostingFromRow,
} from "../../apps/api/src/routes/jobs.ts";

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString)
  throw new Error("TEST_DATABASE_URL is required for job SQL tests.");
const url = new URL(connectionString);
if (
  !["localhost", "127.0.0.1", "/var/run/postgresql"].includes(
    url.searchParams.get("host") || url.hostname,
  ) ||
  !url.pathname.endsWith("_test")
)
  throw new Error("Job SQL tests refuse remote or non-test databases.");
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
const jobA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa11";
const jobA2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa12";
const jobB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb11";
const leadA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa111";
const leadB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb111";
const estimateA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa1111";
const estimateB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb1111";
const memberA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaa11111";
const memberB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbb11111";
const uuid = (value: string) => `'${value}'::uuid`;
const json = (value: unknown) =>
  `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;

function fixtures(
  options: {
    noCosts?: boolean;
    flagged?: boolean;
    approvedChange?: boolean;
    unknownContract?: boolean;
    reversal?: boolean;
  } = {},
) {
  const packageA = options.unknownContract
    ? { total: "1092" }
    : {
        name: "proposal",
        total: "1092",
        tax: "92",
        subtotal: "1000",
        discount: "0",
      };
  return `with
    leads(id, org_id, name, phone, email, street_address, city, state, postal_code) as (values
      (${uuid(leadA)}, ${uuid(orgA)}, 'Customer A', null::text, null::text, 'Billing address', 'Billing city', 'WA', '98312'),
      (${uuid(leadB)}, ${uuid(orgB)}, 'Customer B', null, null, 'Other address', 'Other city', 'WA', '98312')),
    jobs(id, org_id, lead_id, estimate_id, name, status, budget, street_address, city, state, created_at) as (values
      (${uuid(jobA)}, ${uuid(orgA)}, ${uuid(leadA)}, ${uuid(estimateA)}, 'Interior repaint', 'completed', 1092::numeric, '123 Jobsite', 'Bremerton', 'WA', '2026-10-03T12:00:00.000001'::timestamp),
      (${uuid(jobA2)}, ${uuid(orgA)}, ${uuid(leadA)}, null::uuid, 'Legacy job', 'scheduled', 5000::numeric, '456 Jobsite', 'Poulsbo', 'WA', '2026-10-03T12:00:00.000000'::timestamp),
      (${uuid(jobB)}, ${uuid(orgB)}, ${uuid(leadB)}, ${uuid(estimateB)}, 'Exterior repaint', 'scheduled', 9828::numeric, '789 Other Jobsite', 'Seattle', 'WA', '2026-10-04'::timestamp)),
    estimates(id, org_id, lead_id, status, packages) as (values
      (${uuid(estimateA)}, ${uuid(orgA)}, ${uuid(leadA)}, 'accepted', ${json([packageA])}),
      (${uuid(estimateB)}, ${uuid(orgB)}, ${uuid(leadB)}, 'accepted', ${json([{ name: "proposal", total: "9828", tax: "828", subtotal: "9000" }])})),
    audit_logs(id, org_id, entity_type, entity_id, action, metadata, created_at) as (values
      (${uuid(memberA)}, ${uuid(orgA)}, 'estimate', ${uuid(estimateA)}, 'estimate.signed', ${json({ packageName: "proposal", selectedOptions: [] })}, '2026-10-03'::timestamp),
      (${uuid(memberB)}, ${uuid(orgB)}, 'estimate', ${uuid(estimateA)}, 'estimate.signed', ${json({ packageName: "wrong" })}, '2026-10-04'::timestamp)),
    job_costs(job_id, org_id, category, total_cost, quantity) as (values
      (${uuid(jobA)}, ${uuid(orgA)}, 'labor', ${options.noCosts ? 0 : 100}::numeric, 2::numeric),
      (${uuid(jobA)}, ${uuid(orgA)}, 'materials', ${options.noCosts ? 0 : 100}::numeric, 1::numeric),
      (${uuid(jobA)}, ${uuid(orgA)}, 'materials', ${options.reversal ? -100 : 0}::numeric, -1::numeric),
      (${uuid(jobB)}, ${uuid(orgB)}, 'labor', 700::numeric, 7::numeric),
      (${uuid(jobA)}, ${uuid(orgB)}, 'materials', 900::numeric, 1::numeric)),
    team_members(id, org_id) as (values (${uuid(memberA)}, ${uuid(orgA)}), (${uuid(memberB)}, ${uuid(orgB)})),
    time_entries(job_id, org_id, team_member_id, review_status, total_cost) as (values
      (${uuid(jobA)}, ${uuid(orgA)}, ${uuid(memberA)}, '${options.flagged ? "flagged" : "approved"}', 100::numeric),
      (${uuid(jobA)}, ${uuid(orgA)}, ${uuid(memberB)}, 'flagged', 900::numeric),
      (${uuid(jobA)}, ${uuid(orgB)}, ${uuid(memberB)}, 'flagged', 900::numeric)),
    change_orders(job_id, org_id, estimate_id, status, amount) as (values
      (${uuid(jobA)}, ${uuid(orgA)}, ${uuid(estimateA)}, '${options.approvedChange ? "approved" : "pending"}', 150::numeric),
      (${uuid(jobA)}, ${uuid(orgB)}, ${uuid(estimateA)}, 'approved', 900::numeric)),
    estimate_materials(estimate_id, total_cost) as (values (${uuid(estimateA)}, 120::numeric), (${uuid(estimateB)}, 500::numeric)) `;
}

async function query(
  orgId: string,
  options: Parameters<typeof fixtures>[0] = {},
  queryOptions: Parameters<typeof buildJobFinancialQuery>[1] = {},
) {
  const compiled = new PgDialect().sqlToQuery(
    buildJobFinancialQuery(orgId, queryOptions),
  );
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const result = await client.query(
      fixtures(options) + compiled.sql,
      compiled.params,
    );
    return result.rows.map((row) => ({
      cursor: row.createdAtCursor,
      costing: jobCostingFromRow(row, "2026-10-03T12:00:00Z"),
    }));
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

test("real PostgreSQL jobs: $1000 contract / two $100 costs, not $2000 and not $300 including time twice", async () => {
  const rows = await query(orgA);
  const { costing } = rows[0];
  assert.equal(costing.revenue.total, 1000);
  assert.equal(costing.costs.total, 200);
  assert.equal(costing.profitability.grossMargin, 80);
  assert.equal(costing.financialSummary.costCompleteness, "incomplete");
  assert.equal(costing.financialSummary.finalProfit, null);
  assert.equal(costing.job.status, "completed");
  assert.equal(costing.job.streetAddress, "123 Jobsite");
  assert.equal(costing.financialSummary.unreviewedTimeCount, 0);
  assert.equal(costing.budget.estimatedMaterials, 120);
  assert.equal(costing.budget.materialVariance, -20);
});

test("real PostgreSQL jobs: list and detail summaries match; other tenant detail is absent", async () => {
  const list = await query(orgA);
  const detail = await query(orgA, {}, { jobId: jobA });
  assert.deepEqual(
    list[0].costing.financialSummary,
    detail[0].costing.financialSummary,
  );
  assert.equal((await query(orgA, {}, { jobId: jobB })).length, 0);
  const [other] = await query(orgB);
  assert.equal(other.costing.revenue.total, 9000);
  assert.equal(other.costing.costs.total, 700);
});

test("real PostgreSQL jobs: approved CO adds once and material budget remains unknown without its delta", async () => {
  const [row] = await query(orgA, { approvedChange: true });
  assert.equal(row.costing.revenue.total, 1150);
  assert.equal(row.costing.costs.total, 200);
  assert.equal(row.costing.budget.estimatedMaterials, null);
  assert.equal(row.costing.budget.materialVariance, null);
});

test("real PostgreSQL jobs: missing scope/costs and flagged labor do not fabricate final margin", async () => {
  const [missing, legacy] = await query(orgA, { noCosts: true });
  assert.equal(missing.costing.profitability.grossMargin, null);
  assert.equal(missing.costing.profitability.grossProfit, null);
  assert.equal(missing.costing.budget.materialVariance, null);
  assert.equal(legacy.costing.revenue.total, null);
  assert.equal(legacy.costing.financialSummary.estimatedMaterialCost, null);
  const [flagged] = await query(orgA, { flagged: true });
  assert.equal(flagged.costing.costs.total, 200);
  assert.equal(flagged.costing.financialSummary.approvedActualCost, null);
  assert.equal(flagged.costing.profitability.grossMargin, null);
});

test("real PostgreSQL jobs: exact cursor retains microseconds and ledger reversals reduce costs once", async () => {
  const [first] = await query(orgA, { reversal: true }, { limit: 1 });
  assert.equal(first.costing.costs.total, 100);
  const [second] = await query(
    orgA,
    {},
    { cursor: { timestamp: first.cursor, id: jobA }, limit: 1 },
  );
  assert.equal(second.costing.job.id, jobA2);
  const [unknown] = await query(orgA, { unknownContract: true });
  assert.equal(unknown.costing.revenue.total, null);
  assert.equal(unknown.costing.financialSummary.recordedMarginPercent, null);
});
