import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { buildReportingDashboardQuery } from "../../apps/api/src/routes/reports.ts";

// Resolve the API's existing SQL dialect without adding a second root dependency.
const requireApi = createRequire(
  new URL("../../apps/api/package.json", import.meta.url),
);
const { PgDialect } = requireApi("drizzle-orm/pg-core");

test("SQL builder separates entity aggregates instead of multiplying scope by cost rows", () => {
  const query = new PgDialect().sqlToQuery(
    buildReportingDashboardQuery("11111111-1111-4111-8111-111111111111"),
  );
  const scope = query.sql.slice(
    query.sql.indexOf("accepted_scopes as"),
    query.sql.indexOf("proposal_counts as"),
  );
  assert.ok(!scope.includes("job_costs"));
  assert.match(query.sql, /scope_totals as[\s\S]+sum\(subtotal\)/);
  assert.match(query.sql, /cost_totals as[\s\S]+sum\(cost.total_cost\)/);
  assert.match(
    query.sql,
    /cross join scope_totals cross join change_totals cross join lead_totals cross join cost_totals/,
  );
  assert.ok(!query.sql.includes("sum(entry.total_cost)"));
});

test("every tenant-owned entity and joined foreign side is explicitly scoped", () => {
  const orgA = "11111111-1111-4111-8111-111111111111";
  const orgB = "22222222-2222-4222-8222-222222222222";
  const dialect = new PgDialect();
  const a = dialect.sqlToQuery(buildReportingDashboardQuery(orgA));
  const b = dialect.sqlToQuery(buildReportingDashboardQuery(orgB));
  assert.equal(a.sql, b.sql);
  assert.ok(a.params.filter((value: unknown) => value === orgA).length >= 14);
  assert.ok(!a.params.includes(orgB));
  assert.ok(!b.params.includes(orgA));
  for (const alias of [
    "e",
    "l",
    "a",
    "co",
    "j",
    "cost",
    "entry",
    "member",
    "p",
  ]) {
    assert.match(a.sql, new RegExp(`${alias}\\.org_id = \\$\\d+`));
  }
  assert.match(a.sql, /e.status = 'accepted'/);
  assert.match(
    a.sql,
    /exists \(select 1 from accepted_scopes scope where scope.lead_id = l.id\)/,
  );
});
