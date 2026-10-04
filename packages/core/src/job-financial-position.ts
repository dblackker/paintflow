import {
  reportingAddMinor,
  reportingContractSubtotalMinor,
  reportingCostPosition,
  reportingMoneyMinor,
  type ReportingAcceptance,
  type ReportingDecimal,
} from "./reporting";

export interface JobFinancialPositionInput {
  estimate: { status: string; packages: unknown } | null;
  acceptance: ReportingAcceptance | null;
  approvedChanges: ReportingDecimal;
  recordedCost: ReportingDecimal;
  costRecordCount: number;
  positiveCostCount: number;
  unreviewedTimeCount: number;
  estimatedMaterials: ReportingDecimal | null;
  asOf: string;
}

const money = (minor: number | null) =>
  minor === null ? null : { currency: "USD" as const, minor };

/** Job adapters share reporting arithmetic; completion alone never closes cost capture. */
export function jobFinancialPosition(input: JobFinancialPositionInput) {
  for (const count of [
    input.costRecordCount,
    input.positiveCostCount,
    input.unreviewedTimeCount,
  ]) {
    if (!Number.isSafeInteger(count) || count < 0)
      throw new TypeError("Invalid job financial count");
  }
  let baseMinor: number | null = null;
  if (input.estimate?.status === "accepted") {
    try {
      baseMinor = reportingContractSubtotalMinor(
        input.estimate,
        input.acceptance,
      );
    } catch {
      // Historical ambiguous/unsupported scope must not become a fabricated zero budget.
    }
  }
  const changesMinor = reportingMoneyMinor(input.approvedChanges);
  const contractedMinor =
    baseMinor === null ? null : reportingAddMinor(baseMinor, changesMinor);
  const actualMinor = reportingMoneyMinor(input.recordedCost);
  const position = reportingCostPosition({
    contractedSubtotalMinor: contractedMinor,
    recordedCostMinor: actualMinor,
    positiveCostCount: input.positiveCostCount,
    unreviewedTimeCount: input.unreviewedTimeCount,
  });
  // No reliable material-budget delta exists for legacy change orders.
  const estimatedMinor =
    input.estimatedMaterials === null ||
    baseMinor === null ||
    changesMinor !== 0
      ? null
      : reportingMoneyMinor(input.estimatedMaterials);
  const warnings: Array<{
    code: string;
    message: string;
    action: "review_scope" | "add_cost" | "review_time";
  }> = [];
  if (baseMinor === null)
    warnings.push({
      code: "CONTRACT_SCOPE_UNRESOLVED",
      message:
        "Accepted scope needs review. Contract value and margin are unavailable.",
      action: "review_scope",
    });
  if (input.unreviewedTimeCount > 0)
    warnings.push({
      code: "LABOR_REVIEW_PENDING",
      message: `${input.unreviewedTimeCount} time ${input.unreviewedTimeCount === 1 ? "entry needs" : "entries need"} review. Approved costs and margin are unavailable.`,
      action: "review_time",
    });
  if (position.costCompleteness === "unknown")
    warnings.push({
      code: "COST_CAPTURE_UNKNOWN",
      message: input.costRecordCount
        ? "No net costs recorded. Margin is unavailable."
        : "No costs recorded. Add costs or crew time to track margin.",
      action: "add_cost",
    });
  return {
    schemaVersion: 1 as const,
    asOf: input.asOf,
    contractBaseSubtotal: money(baseMinor),
    approvedChangeOrdersSubtotal: money(changesMinor),
    contractedSubtotal: money(contractedMinor),
    recordedActualCost: money(actualMinor)!,
    approvedActualCost: money(position.approvedActualCostMinor),
    currentCostPosition: money(position.positionMinor),
    estimatedMaterialCost: money(estimatedMinor),
    recordedMarginPercent: position.margin,
    finalMarginPercent: null,
    finalProfit: null,
    costCompleteness: position.costCompleteness,
    costRecordCount: input.costRecordCount,
    unreviewedTimeCount: input.unreviewedTimeCount,
    scopeNeedsReview: baseMinor === null,
    warnings,
  };
}

export type JobFinancialPosition = ReturnType<typeof jobFinancialPosition>;
