export type ReportingDecimal = string | number;

const MAX_MINOR = BigInt(Number.MAX_SAFE_INTEGER);

function boundedMinor(value: bigint): number {
  if (value > MAX_MINOR || value < -MAX_MINOR)
    throw new RangeError("Reporting amount exceeds the supported range");
  return Number(value);
}

function decimal(value: unknown, scale: number): bigint | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value);
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match || (match[3]?.length ?? 0) > scale || text.length > 32)
    return null;
  const magnitude =
    BigInt(match[2]) * 10n ** BigInt(scale) +
    BigInt((match[3] ?? "").padEnd(scale, "0") || "0");
  return match[1] ? -magnitude : magnitude;
}

function roundDivide(value: bigint, denominator: bigint): bigint {
  const absolute = value < 0n ? -value : value;
  const rounded = (absolute + denominator / 2n) / denominator;
  return value < 0n ? -rounded : rounded;
}

export function reportingMoneyMinor(value: ReportingDecimal): number {
  const parsed = decimal(value, 2);
  if (parsed === null) throw new TypeError("Invalid reporting money");
  return boundedMinor(parsed);
}

export function reportingAddMinor(...values: number[]): number {
  if (values.some((value) => !Number.isSafeInteger(value)))
    throw new TypeError("Invalid reporting minor amount");
  return boundedMinor(values.reduce((sum, value) => sum + BigInt(value), 0n));
}

function minorInteger(value: ReportingDecimal): number {
  const parsed = decimal(value, 0);
  if (parsed === null) throw new TypeError("Invalid reporting minor amount");
  return boundedMinor(parsed);
}

function moneyObject(value: number | null) {
  return value === null ? null : { currency: "USD" as const, minor: value };
}

function dollars(value: number | null) {
  return value === null ? null : value / 100;
}

function count(value: ReportingDecimal): number {
  const parsed = minorInteger(value);
  if (parsed < 0) throw new TypeError("Invalid reporting count");
  return parsed;
}

export interface ReportingAcceptance {
  packageName?: string | null;
  selectedOptions?: Array<{ qty?: ReportingDecimal; rate?: ReportingDecimal }>;
}

/** Historical multi-package proposals need their recorded selection, not today's default. */
export function reportingContractSubtotalMinor(
  estimate: { status: string; packages: unknown },
  acceptance?: ReportingAcceptance | null,
): number | null {
  if (estimate.status !== "accepted") return 0;
  if (!Array.isArray(estimate.packages)) return null;
  if (
    acceptance != null &&
    (typeof acceptance !== "object" || Array.isArray(acceptance))
  )
    return null;
  const packages = estimate.packages.filter(
    (pkg) => pkg && typeof pkg === "object",
  );
  const pkg = acceptance?.packageName
    ? packages.find((candidate) => candidate.name === acceptance.packageName)
    : packages.length === 1
      ? packages[0]
      : null;
  if (!pkg) return null;

  const total = decimal(pkg.total, 2);
  const tax = decimal(pkg.tax, 2);
  const subtotal = decimal(pkg.subtotal, 2);
  const discount = decimal(pkg.discount ?? 0, 2);
  const beforeTax =
    total !== null && tax !== null && total >= tax && tax >= 0n
      ? total - tax
      : subtotal !== null &&
          subtotal >= 0n &&
          discount !== null &&
          discount >= 0n
        ? subtotal > discount
          ? subtotal - discount
          : 0n
        : null;
  if (beforeTax === null) return null;
  if (
    subtotal !== null &&
    discount !== null &&
    total !== null &&
    tax !== null
  ) {
    const net = subtotal > discount ? subtotal - discount : 0n;
    if (net !== total - tax) return null;
  }

  const items: unknown[] = Array.isArray(pkg.items)
    ? pkg.items
    : Array.isArray(pkg.lineItems)
      ? pkg.lineItems
      : [];
  if (
    items.some(
      (item) =>
        item !== null &&
        typeof item === "object" &&
        "optional" in item &&
        Boolean(item.optional),
    ) &&
    !Array.isArray(acceptance?.selectedOptions)
  )
    return null;
  if (
    acceptance != null &&
    "selectedOptions" in acceptance &&
    !Array.isArray(acceptance.selectedOptions)
  )
    return null;
  let optionMicroMinor = 0n;
  for (const option of acceptance?.selectedOptions ?? []) {
    if (!option || typeof option !== "object") return null;
    const quantity = decimal(option.qty ?? 1, 6);
    const rate = decimal(option.rate, 2);
    if (quantity === null || rate === null || quantity < 0n || rate < 0n)
      return null;
    optionMicroMinor += quantity * rate;
  }
  return boundedMinor(beforeTax + roundDivide(optionMicroMinor, 1_000_000n));
}

export interface ReportingCostPositionInput {
  contractedSubtotalMinor: number | null;
  recordedCostMinor: number;
  positiveCostCount: number;
  unreviewedTimeCount: number;
}

export function reportingCostPosition(input: ReportingCostPositionInput) {
  for (const amount of [
    input.contractedSubtotalMinor,
    input.recordedCostMinor,
  ]) {
    if (amount !== null && !Number.isSafeInteger(amount))
      throw new TypeError("Invalid reporting minor amount");
  }
  const hasCosts = input.positiveCostCount > 0 && input.recordedCostMinor > 0;
  const approvedActualCostMinor =
    input.unreviewedTimeCount > 0 ? null : input.recordedCostMinor;
  const usable =
    hasCosts &&
    input.unreviewedTimeCount === 0 &&
    input.contractedSubtotalMinor !== null &&
    input.contractedSubtotalMinor > 0;
  const positionMinor = usable
    ? reportingAddMinor(
        input.contractedSubtotalMinor!,
        -input.recordedCostMinor,
      )
    : null;
  const margin =
    positionMinor === null
      ? null
      : Number(
          roundDivide(
            BigInt(positionMinor) * 1_000n,
            BigInt(input.contractedSubtotalMinor!),
          ),
        ) / 10;
  return {
    approvedActualCostMinor,
    positionMinor,
    margin,
    costCompleteness: hasCosts ? ("incomplete" as const) : ("unknown" as const),
    finalMargin: null,
  };
}

export interface ReportingAggregate {
  totalEstimates: ReportingDecimal;
  approvedEstimates: ReportingDecimal;
  totalLeads: ReportingDecimal;
  wonLeads: ReportingDecimal;
  contractedSubtotalMinor: ReportingDecimal;
  unresolvedContracts: ReportingDecimal;
  recordedCostMinor: ReportingDecimal;
  positiveCostCount: ReportingDecimal;
  unreviewedTimeCount: ReportingDecimal;
  collectedGrossMinor: ReportingDecimal;
  refundedGrossMinor: ReportingDecimal;
  unresolvedRefunds: ReportingDecimal;
  unsupportedCurrencyPayments: ReportingDecimal;
  unmatchedCostJobs?: ReportingDecimal;
}

export function reportingDashboard(
  aggregate: ReportingAggregate,
  asOf: string,
) {
  const knownContractedMinor = minorInteger(aggregate.contractedSubtotalMinor);
  const unresolvedContracts = count(aggregate.unresolvedContracts);
  const contractedMinor = unresolvedContracts ? null : knownContractedMinor;
  const recordedCostMinor = minorInteger(aggregate.recordedCostMinor);
  const unreviewedTimeCount = count(aggregate.unreviewedTimeCount);
  const collectedGrossMinor = minorInteger(aggregate.collectedGrossMinor);
  const unresolvedRefunds = count(aggregate.unresolvedRefunds);
  const refundedGrossMinor = unresolvedRefunds
    ? null
    : minorInteger(aggregate.refundedGrossMinor);
  const netCollectedMinor =
    refundedGrossMinor === null
      ? null
      : reportingAddMinor(collectedGrossMinor, -refundedGrossMinor);
  const totalLeads = count(aggregate.totalLeads);
  const wonLeads = count(aggregate.wonLeads);
  const unmatchedCostJobs = count(aggregate.unmatchedCostJobs ?? 0);
  const position = reportingCostPosition({
    contractedSubtotalMinor: unmatchedCostJobs ? null : contractedMinor,
    recordedCostMinor,
    positiveCostCount: count(aggregate.positiveCostCount),
    unreviewedTimeCount,
  });
  const warnings: Array<{ code: string; message: string; action: string }> = [];
  if (unresolvedContracts)
    warnings.push({
      code: "CONTRACT_SNAPSHOT_MISSING",
      message: `${unresolvedContracts} accepted proposal(s) need historical scope or tax review.`,
      action: "/estimates?status=accepted",
    });
  if (unreviewedTimeCount)
    warnings.push({
      code: "LABOR_REVIEW_PENDING",
      message: `${unreviewedTimeCount} time entry(s) need review before approved costs can be reported.`,
      action: "/time",
    });
  if (unresolvedRefunds)
    warnings.push({
      code: "REFUND_CONFIRMATION_REQUIRED",
      message:
        "A refund is pending or needs reconciliation; net cash is unavailable.",
      action: "/invoices",
    });
  if (count(aggregate.unsupportedCurrencyPayments))
    warnings.push({
      code: "UNSUPPORTED_CURRENCY",
      message: "Non-USD payments are excluded from this USD report.",
      action: "/invoices",
    });
  if (unmatchedCostJobs)
    warnings.push({
      code: "COST_SCOPE_UNRESOLVED",
      message: `${unmatchedCostJobs} job(s) have costs without a current accepted proposal. Overall margin is unavailable.`,
      action: "/jobs",
    });
  return {
    schemaVersion: 1,
    asOf,
    totalEstimates: count(aggregate.totalEstimates),
    approvedEstimates: count(aggregate.approvedEstimates),
    totalLeads,
    wonLeads,
    winRate: totalLeads ? Math.round((wonLeads / totalLeads) * 100) : 0,
    // Compatibility fields represent contracted subtotal and current cost position, not accounting revenue/profit.
    totalRevenue: dollars(contractedMinor),
    totalCosts: dollars(recordedCostMinor),
    profit: dollars(position.positionMinor),
    margin: position.margin,
    contractedSubtotal: dollars(contractedMinor),
    knownContractedSubtotal: dollars(knownContractedMinor),
    approvedActualCost: dollars(position.approvedActualCostMinor),
    recordedActualCost: dollars(recordedCostMinor),
    collectedGross: dollars(collectedGrossMinor),
    refundedGross: dollars(refundedGrossMinor),
    netCollectedGross: dollars(netCollectedMinor),
    outstandingGross: null,
    outstandingReason:
      "Verified invoice allocations and credits are required to report a collectible balance.",
    currentCostPosition: dollars(position.positionMinor),
    costCompleteness: position.costCompleteness,
    finalMargin: null,
    money: {
      contractedSubtotal: moneyObject(contractedMinor),
      approvedActualCost: moneyObject(position.approvedActualCostMinor),
      recordedActualCost: moneyObject(recordedCostMinor),
      collectedGross: moneyObject(collectedGrossMinor),
      refundedGross: moneyObject(refundedGrossMinor),
      netCollectedGross: moneyObject(netCollectedMinor),
      currentCostPosition: moneyObject(position.positionMinor),
      outstandingGross: null,
    },
    warnings,
  };
}
