import test from "node:test";
import assert from "node:assert/strict";
import {
  jobFinancialPosition,
  type JobFinancialPositionInput,
} from "../../packages/core/src/job-financial-position.ts";

function input(
  overrides: Partial<JobFinancialPositionInput> = {},
): JobFinancialPositionInput {
  return {
    estimate: {
      status: "accepted",
      packages: [
        {
          name: "proposal",
          total: "1092.00",
          tax: "92.00",
          subtotal: "1000.00",
          discount: "0",
        },
      ],
    },
    acceptance: { packageName: "proposal", selectedOptions: [] },
    approvedChanges: "150.00",
    recordedCost: "200.00",
    costRecordCount: 2,
    positiveCostCount: 2,
    unreviewedTimeCount: 0,
    estimatedMaterials: null,
    asOf: "2026-10-03T12:00:00Z",
    ...overrides,
  };
}

test("job uses accepted subtotal before tax plus approved changes and exact recorded ledger costs", () => {
  const summary = jobFinancialPosition(input());
  assert.deepEqual(summary.contractedSubtotal, {
    currency: "USD",
    minor: 115000,
  });
  assert.deepEqual(summary.recordedActualCost, {
    currency: "USD",
    minor: 20000,
  });
  assert.equal(summary.currentCostPosition?.minor, 95000);
  assert.equal(summary.recordedMarginPercent, 82.6);
  assert.equal(summary.costCompleteness, "incomplete");
  assert.equal(summary.finalProfit, null);
  assert.equal(summary.finalMarginPercent, null);
});

test("no costs, including completed work, never imply 100% or final profit", () => {
  const summary = jobFinancialPosition(
    input({ recordedCost: "0", costRecordCount: 0, positiveCostCount: 0 }),
  );
  assert.equal(summary.currentCostPosition, null);
  assert.equal(summary.recordedMarginPercent, null);
  assert.equal(summary.finalProfit, null);
  assert.equal(summary.costCompleteness, "unknown");
  assert.equal(summary.warnings[0].code, "COST_CAPTURE_UNKNOWN");
});

test("missing, unsigned, voided and ambiguous scope are unknown rather than a zero/budget fallback", () => {
  for (const estimate of [
    null,
    { status: "sent", packages: [{ subtotal: "1000" }] },
    { status: "voided", packages: [{ subtotal: "1000" }] },
    { status: "accepted", packages: [{ total: "1092" }] },
  ]) {
    const summary = jobFinancialPosition(input({ estimate }));
    assert.equal(summary.contractedSubtotal, null);
    assert.equal(summary.recordedMarginPercent, null);
    assert.equal(summary.estimatedMaterialCost, null);
    assert.equal(summary.warnings[0].code, "CONTRACT_SCOPE_UNRESOLVED");
  }
});

test("unreviewed labor stays visible as recorded ledger cost without adding it twice", () => {
  const summary = jobFinancialPosition(input({ unreviewedTimeCount: 1 }));
  assert.equal(summary.recordedActualCost.minor, 20000);
  assert.equal(summary.approvedActualCost, null);
  assert.equal(summary.currentCostPosition, null);
  assert.equal(summary.recordedMarginPercent, null);
  assert.equal(summary.warnings[0].action, "review_time");
});

test("exact decimal reversals and overruns retain the true recorded position", () => {
  const summary = jobFinancialPosition(
    input({ approvedChanges: "0.10", recordedCost: "1250.29" }),
  );
  assert.equal(summary.contractedSubtotal?.minor, 100010);
  assert.equal(summary.currentCostPosition?.minor, -25019);
  assert.equal(summary.recordedMarginPercent, -25);
  const reversed = jobFinancialPosition(
    input({ recordedCost: "0.00", costRecordCount: 2, positiveCostCount: 1 }),
  );
  assert.equal(reversed.recordedMarginPercent, null);
  assert.equal(reversed.costCompleteness, "unknown");
});

test("historical selected package and fractional options use the reporting primitives", () => {
  const summary = jobFinancialPosition(
    input({
      estimate: {
        status: "accepted",
        packages: [
          { name: "A", subtotal: "1000" },
          { name: "B", total: "2184", tax: "184", subtotal: "2000" },
        ],
      },
      acceptance: {
        packageName: "B",
        selectedOptions: [{ qty: ".25", rate: "100" }],
      },
    }),
  );
  assert.equal(summary.contractedSubtotal, null); // Malformed legacy decimals are not guessed.
  const valid = jobFinancialPosition(
    input({
      acceptance: {
        packageName: "proposal",
        selectedOptions: [
          { qty: "0.25", rate: "0.10" },
          { qty: "0.25", rate: "0.10" },
        ],
      },
    }),
  );
  assert.equal(valid.contractedSubtotal?.minor, 115005);
  const selected = jobFinancialPosition(
    input({
      estimate: {
        status: "accepted",
        packages: [
          { name: "A", subtotal: "1000" },
          { name: "B", total: "2184", tax: "184", subtotal: "2000" },
        ],
      },
      acceptance: { packageName: "B", selectedOptions: [] },
    }),
  );
  assert.equal(selected.contractedSubtotal?.minor, 215000);
});

test("material budget is unknown for missing scope or legacy changes, and zero only when explicitly recorded", () => {
  assert.equal(
    jobFinancialPosition(input({ estimatedMaterials: "100" }))
      .estimatedMaterialCost,
    null,
  );
  assert.equal(
    jobFinancialPosition(
      input({
        estimate: null,
        approvedChanges: "0",
        estimatedMaterials: "100",
      }),
    ).estimatedMaterialCost,
    null,
  );
  assert.deepEqual(
    jobFinancialPosition(
      input({ approvedChanges: "0", estimatedMaterials: "0" }),
    ).estimatedMaterialCost,
    { currency: "USD", minor: 0 },
  );
  assert.throws(
    () => jobFinancialPosition(input({ costRecordCount: -1 })),
    /Invalid job financial count/,
  );
});
