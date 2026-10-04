import test from "node:test";
import assert from "node:assert/strict";
import {
  reportingAddMinor,
  reportingContractSubtotalMinor,
  reportingCostPosition,
  reportingDashboard,
  reportingMoneyMinor,
  type ReportingAggregate,
} from "../../packages/core/src/reporting.ts";

const asOf = "2026-10-03T12:00:00.000Z";
function totals(
  overrides: Partial<ReportingAggregate> = {},
): ReportingAggregate {
  return {
    totalEstimates: "3",
    approvedEstimates: "1",
    totalLeads: "2",
    wonLeads: "1",
    contractedSubtotalMinor: "100000",
    unresolvedContracts: "0",
    recordedCostMinor: "20000",
    positiveCostCount: "2",
    unreviewedTimeCount: "0",
    collectedGrossMinor: "50000",
    refundedGrossMinor: "10000",
    unresolvedRefunds: "0",
    unsupportedCurrencyPayments: "0",
    unmatchedCostJobs: "0",
    ...overrides,
  };
}
const proposal = {
  status: "accepted",
  packages: [
    {
      name: "proposal",
      total: "1092.00",
      tax: "92.00",
      subtotal: "1000.00",
      discount: "0.00",
    },
  ],
};

test("exact cents: decimal strings, negative reversals, safe bounds and invalid input", () => {
  assert.equal(reportingMoneyMinor("0.29"), 29);
  assert.equal(reportingMoneyMinor("-100.05"), -10005);
  assert.equal(
    reportingMoneyMinor("90071992547409.91"),
    Number.MAX_SAFE_INTEGER,
  );
  assert.equal(reportingAddMinor(29, 71, -10), 90);
  for (const value of ["1.001", "1,000", "1e3", "", "NaN", "Infinity"])
    assert.throws(() => reportingMoneyMinor(value), TypeError);
  assert.throws(() => reportingMoneyMinor("90071992547409.92"), RangeError);
  assert.throws(
    () => reportingAddMinor(Number.MAX_SAFE_INTEGER, 1),
    RangeError,
  );
});

test("accepted contract excludes customer tax and applies discount once", () => {
  assert.equal(reportingContractSubtotalMinor(proposal), 100000);
  assert.equal(
    reportingContractSubtotalMinor({
      status: "accepted",
      packages: [{ name: "proposal", subtotal: "1100", discount: "100" }],
    }),
    100000,
  );
  assert.equal(
    reportingContractSubtotalMinor({
      status: "accepted",
      packages: [
        {
          name: "proposal",
          total: "1092",
          tax: "92",
          subtotal: "1100",
          discount: "100",
        },
      ],
    }),
    100000,
  );
});

test("draft, sent, canceled, superseded and voided proposals contribute no contracted value", () => {
  for (const status of [
    "draft",
    "sent",
    "declined",
    "canceled",
    "superseded",
    "voided",
  ]) {
    assert.equal(reportingContractSubtotalMinor({ ...proposal, status }), 0);
  }
});

test("multi-package selection is historical; no selection is unresolved rather than today's default", () => {
  const estimate = {
    status: "accepted",
    packages: [
      proposal.packages[0],
      {
        name: "Better",
        total: "2184",
        tax: "184",
        subtotal: "2000",
        discount: "0",
      },
    ],
  };
  assert.equal(reportingContractSubtotalMinor(estimate), null);
  assert.equal(
    reportingContractSubtotalMinor(estimate, { packageName: "proposal" }),
    100000,
  );
  assert.equal(
    reportingContractSubtotalMinor(estimate, { packageName: "Better" }),
    200000,
  );
  assert.equal(
    reportingContractSubtotalMinor(estimate, { packageName: "missing" }),
    null,
  );
});

test("selected options use exact decimal quantity and are before tax", () => {
  assert.equal(
    reportingContractSubtotalMinor(proposal, {
      selectedOptions: [
        { qty: "0.25", rate: "0.10" },
        { qty: "0.25", rate: "0.10" },
      ],
    }),
    100005,
  );
  assert.equal(
    reportingContractSubtotalMinor(proposal, {
      selectedOptions: [{ qty: "0.25", rate: "0.10" }],
    }),
    100003,
  );
  assert.equal(
    reportingContractSubtotalMinor(proposal, {
      selectedOptions: [{ qty: "0", rate: "100" }],
    }),
    100000,
  );
  assert.equal(
    reportingContractSubtotalMinor(proposal, {
      selectedOptions: [{ qty: "-1", rate: "100" }],
    }),
    null,
  );
});

test("missing selection, tax, malformed amounts and inconsistent snapshots stay unresolved", () => {
  const optional = {
    status: "accepted",
    packages: [{ ...proposal.packages[0], items: [{ optional: true }] }],
  };
  assert.equal(reportingContractSubtotalMinor(optional), null);
  assert.equal(
    reportingContractSubtotalMinor(optional, { selectedOptions: [] }),
    100000,
  );
  assert.equal(
    reportingContractSubtotalMinor({
      status: "accepted",
      packages: [{ total: "1092" }],
    }),
    null,
  );
  assert.equal(
    reportingContractSubtotalMinor({
      status: "accepted",
      packages: [{ total: "1092", tax: "92", subtotal: "2000" }],
    }),
    null,
  );
  assert.equal(
    reportingContractSubtotalMinor({
      status: "accepted",
      packages: [{ total: "bad", tax: "92" }],
    }),
    null,
  );
  assert.equal(
    reportingContractSubtotalMinor({ status: "accepted", packages: null }),
    null,
  );
});

test("$1,000 proposal with two $100 costs stays $1,000 contracted / $200 cost", () => {
  const report = reportingDashboard(totals(), asOf);
  assert.equal(report.totalRevenue, 1000);
  assert.equal(report.totalCosts, 200);
  assert.equal(report.profit, 800);
  assert.equal(report.margin, 80);
  assert.equal(report.finalMargin, null);
  assert.equal(report.costCompleteness, "incomplete");
  assert.deepEqual(report.money.contractedSubtotal, {
    currency: "USD",
    minor: 100000,
  });
});

test("receipts and refunds are not estimate revenue and unverified outstanding remains null", () => {
  const report = reportingDashboard(totals(), asOf);
  assert.equal(report.collectedGross, 500);
  assert.equal(report.refundedGross, 100);
  assert.equal(report.netCollectedGross, 400);
  assert.equal(report.outstandingGross, null);
  assert.equal(report.winRate, 50);
  assert.equal(report.wonLeads, 1);
  assert.equal(report.totalLeads, 2);
});

test("multiple draft/revision counts cannot inflate distinct-lead win rate or money", () => {
  const one = reportingDashboard(totals(), asOf);
  const many = reportingDashboard(totals({ totalEstimates: "300" }), asOf);
  assert.equal(many.winRate, one.winRate);
  assert.equal(many.totalRevenue, one.totalRevenue);
});

test("no cost data or fully reversed costs never produce final 100% margin", () => {
  for (const positiveCostCount of [0, 4]) {
    const report = reportingDashboard(
      totals({ recordedCostMinor: "0", positiveCostCount }),
      asOf,
    );
    assert.equal(report.margin, null);
    assert.equal(report.profit, null);
    assert.equal(report.finalMargin, null);
    assert.equal(report.costCompleteness, "unknown");
  }
});

test("unreviewed labor keeps ledger visible but suppresses approved actual cost and margin", () => {
  const report = reportingDashboard(totals({ unreviewedTimeCount: "1" }), asOf);
  assert.equal(report.recordedActualCost, 200);
  assert.equal(report.approvedActualCost, null);
  assert.equal(report.margin, null);
  assert.equal(report.warnings[0].code, "LABOR_REVIEW_PENDING");
});

test("unresolved scope or unmatched cost jobs do not imply zero contract or profit", () => {
  const missing = reportingDashboard(
    totals({ unresolvedContracts: "1" }),
    asOf,
  );
  assert.equal(missing.contractedSubtotal, null);
  assert.equal(missing.knownContractedSubtotal, 1000);
  assert.equal(missing.margin, null);
  assert.equal(missing.warnings[0].code, "CONTRACT_SNAPSHOT_MISSING");
  const unmatched = reportingDashboard(
    totals({ unmatchedCostJobs: "1" }),
    asOf,
  );
  assert.equal(unmatched.margin, null);
  assert.equal(unmatched.warnings[0].code, "COST_SCOPE_UNRESOLVED");
});

test("pending refunds and unsupported currencies are explicit", () => {
  const report = reportingDashboard(
    totals({ unresolvedRefunds: 1, unsupportedCurrencyPayments: 1 }),
    asOf,
  );
  assert.equal(report.collectedGross, 500);
  assert.equal(report.refundedGross, null);
  assert.equal(report.netCollectedGross, null);
  assert.deepEqual(
    report.warnings.map((warning) => warning.code),
    ["REFUND_CONFIRMATION_REQUIRED", "UNSUPPORTED_CURRENCY"],
  );
});

test("overruns produce a negative recorded margin, not clamped profit", () => {
  const position = reportingCostPosition({
    contractedSubtotalMinor: 10000,
    recordedCostMinor: 12500,
    positiveCostCount: 1,
    unreviewedTimeCount: 0,
  });
  assert.equal(position.positionMinor, -2500);
  assert.equal(position.margin, -25);
});
