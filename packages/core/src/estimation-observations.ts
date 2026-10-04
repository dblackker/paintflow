import type { EstimationResult, EstimationOperationResult, EstimationRateBasis, EstimationUnit } from './estimation';
import type { AcceptedBudgetScopeItem } from './estimation-budget';
import {
  ZERO, add, subtract, multiply, divide, compare, exact, decimal, decimalText,
  minor, boundedMinor, type ExactDecimal,
} from './estimation-decimal';

export interface AcceptedEstimationBudget {
  version: 'accepted-budget-v1';
  estimateId: string;
  packageName: string;
  calculationVersion: string;
  acceptedAt: string;
  selectedOptions: unknown[];
  calculation: EstimationResult;
  scope?: AcceptedBudgetScopeItem[];
  operationIds: string[];
  contractTotalMinor?: number;
  costComplete?: boolean;
}

export interface JobEstimationEvidence {
  jobId: string;
  status: string;
  budget: AcceptedEstimationBudget | null;
  changes: Array<{ id: string; status: string; description?: string; signedAmount?: string; budget: AcceptedEstimationBudget | ReviewedChangeBudget | null }>;
  time: Array<{ id: string; hours: string; totalCost: string; date: string; reviewStatus: string; operationId?: string | null }>;
  costs: Array<{ id: string; category: string; totalCost: string; costDate: string | null; materialPurchaseId: string | null }>;
  purchases: Array<{ id: string; invoiceDate: string | null; totalAmount: string | null; lines: unknown }>;
  pendingSupplierCount: number;
  revision: string;
}

export interface ReviewedChangeBudget {
  version: 'reviewed-change-budget-v1';
  changeOrderId: string;
  laborHours: string | null;
  laborCostMinor: number | null;
  materialCostMinor: number | null;
  otherCostMinor: number | null;
  theoreticalGallons: string | null;
  orderGallons: string | null;
  provenance: string;
  reviewedBy: string;
  reviewedAt: string;
}

export function reviewedChangeBudget(input: unknown): ReviewedChangeBudget | null {
  if (!input || typeof input !== 'object') return null;
  const budget = input as ReviewedChangeBudget;
  if (budget.version !== 'reviewed-change-budget-v1' || !budget.changeOrderId || !budget.provenance?.trim()
    || !budget.reviewedBy || !Number.isFinite(Date.parse(budget.reviewedAt))) return null;
  try {
    for (const field of ['laborHours', 'theoreticalGallons', 'orderGallons'] as const) {
      if (budget[field] !== null) decimal(budget[field]!, field, { scale: 6 });
    }
    for (const field of ['laborCostMinor', 'materialCostMinor', 'otherCostMinor'] as const) {
      if (budget[field] !== null && (!Number.isSafeInteger(budget[field]) || budget[field]! < 0)) return null;
    }
    return budget;
  } catch { return null; }
}

const value = (n: string | number, signed = false) => decimal(n, 'evidence', { signed, scale: 12 });
const total = (values: Array<string | number>, signed = false) => values.reduce((n, entry) => add(n, value(entry, signed)), ZERO);
const cents = (n: number) => {
  if (!Number.isSafeInteger(n)) throw new TypeError('Budget money must be integer cents.');
  return BigInt(n);
};
const sumCents = (values: number[]) => boundedMinor(values.reduce((n, entry) => n + cents(entry), 0n), 'budget');
const timestamp = (date: string | null) => date ? Date.parse(date) : NaN;
const dated = (date: string | null, asOf: string) => Number.isFinite(timestamp(date)) && timestamp(date) <= timestamp(asOf);

export function acceptedBudget(value: unknown): AcceptedEstimationBudget | null {
  if (!value || typeof value !== 'object') return null;
  const budget = value as AcceptedEstimationBudget;
  if (budget.version !== 'accepted-budget-v1' || !budget.estimateId || !budget.packageName
    || !Number.isFinite(timestamp(budget.acceptedAt)) || !Array.isArray(budget.selectedOptions)
    || !Array.isArray(budget.operationIds) || new Set(budget.operationIds).size !== budget.operationIds.length
    || !budget.operationIds.every((id) => typeof id === 'string' && id.length > 0)
    || !budget.calculation || budget.calculationVersion !== budget.calculation.calculationVersion
    || !['repaint-v1', 'repaint-v2'].includes(budget.calculationVersion)
    || !Array.isArray(budget.calculation.items) || !Array.isArray(budget.calculation.purchaseGroups)) return null;
  try {
    valueHours(budget.calculation.totals.hours);
    cents(budget.calculation.totals.materialCostMinor);
    if (budget.calculation.totals.laborBudgetMinor != null) cents(budget.calculation.totals.laborBudgetMinor);
    for (const item of budget.calculation.items.filter((entry) => entry.included)) {
      valueHours(item.hours);
      for (const operation of item.operations || []) {
        valueHours(operation.hours);
        valueHours(operation.quantity);
      }
    }
    for (const group of budget.calculation.purchaseGroups.filter((entry) => entry.included)) {
      valueHours(group.theoreticalGallons);
      valueHours(group.purchasedGallons);
    }
    return budget;
  } catch { return null; }
}

function valueHours(n: string) { return value(n); }

export function budgetOperations(evidence: JobEstimationEvidence) {
  const snapshots = [acceptedBudget(evidence.budget), ...evidence.changes
    .filter((change) => ['approved', 'completed'].includes(change.status)).map((change) => acceptedBudget(change.budget))];
  return snapshots.flatMap((snapshot) => {
    if (!snapshot) return [];
    const scope = Array.isArray(snapshot.scope) ? snapshot.scope : [];
    return snapshot.calculation.items.filter((item) => item.included).flatMap((item) => {
      const label = scope.find((entry) => entry?.calculationItemId === item.id);
      const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
      const itemLabel = text(label?.desc) || [text(label?.roomName), text(label?.surfaceName)].filter(Boolean).join(' / ') || 'Scope item';
      return (item.operations || [])
        .filter((operation) => snapshot.operationIds.includes(item.id) || snapshot.operationIds.includes(operation.id))
        .map((operation) => ({ ...operation, id: `${item.id}:${operation.id}`, itemId: item.id, itemLabel, estimateId: snapshot.estimateId }));
    });
  });
}

/** Dollars come only from the ledger: time and purchase headers are evidence, not extra costs. */
export function compareJobEstimationBudget(evidence: JobEstimationEvidence, asOf: string) {
  if (!Number.isFinite(timestamp(asOf))) throw new TypeError('A valid comparison date is required.');
  const base = acceptedBudget(evidence.budget);
  const approvedChanges = evidence.changes.filter((change) => ['approved', 'completed'].includes(change.status));
  const manualChanges = approvedChanges.map((change) => reviewedChangeBudget(change.budget)).filter((budget): budget is ReviewedChangeBudget => !!budget);
  const missingChanges = approvedChanges.filter((change) => !acceptedBudget(change.budget) && !reviewedChangeBudget(change.budget));
  const missingChangeBudgetIds = missingChanges.map((change) => change.id);
  const budgets = [base, ...approvedChanges.map((change) => acceptedBudget(change.budget))].filter((budget): budget is AcceptedEstimationBudget => !!budget);
  const budgetComplete = !!base && missingChangeBudgetIds.length === 0;
  const approved = evidence.time.filter((entry) => entry.reviewStatus === 'approved' && dated(entry.date, asOf));
  const pending = evidence.time.filter((entry) => !['approved', 'rejected'].includes(entry.reviewStatus));
  const invalidTime = evidence.time.filter((entry) => !dated(entry.date, asOf));
  const purchases = evidence.purchases.filter((purchase) => dated(purchase.invoiceDate, asOf));
  const purchaseMap = new Map(purchases.map((purchase) => [purchase.id, purchase]));
  // Do not substitute creation time for an unknown invoice/effective date.
  const costs = evidence.costs.filter((cost) => dated(cost.costDate, asOf)
    && (!cost.materialPurchaseId || purchaseMap.has(cost.materialPurchaseId)));
  const excludedCostIds = evidence.costs.filter((cost) => !costs.includes(cost)).map((cost) => cost.id);
  const linkedPurchases = new Set(costs.map((cost) => cost.materialPurchaseId).filter(Boolean));
  const unledgeredPurchaseIds = purchases.filter((purchase) => !linkedPurchases.has(purchase.id)).map((purchase) => purchase.id);
  const costMissing = budgets.some((budget) => budget.costComplete === false || budget.calculation.totals.laborBudgetMinor == null
    || budget.calculation.items.some((item) => item.included && (item.costComplete !== true || item.directCostMinor == null)))
    || manualChanges.some((budget) => budget.laborCostMinor === null || budget.materialCostMinor === null || budget.otherCostMinor === null);
  const warnings: string[] = [];
  if (!base) warnings.push('Accepted operating budget is unavailable.');
  if (missingChangeBudgetIds.length) warnings.push('Approved change orders are missing operating budgets.');
  if (costMissing) warnings.push('The estimate is missing direct-cost budgets.');
  if (pending.length) warnings.push('Crew time is awaiting review.');
  if (invalidTime.length) warnings.push('Some crew time is undated or beyond the comparison date.');
  if (excludedCostIds.length) warnings.push('Some ledger costs lack effective dates or dated supplier evidence.');
  if (purchases.length !== evidence.purchases.length) warnings.push('Some supplier purchases lack invoice dates or are beyond the comparison date.');
  if (unledgeredPurchaseIds.length) warnings.push('Some supplier purchases have no dated ledger cost.');
  const unreconciledPurchaseIds = purchases.filter((purchase) => purchase.totalAmount == null
    || compare(total(costs.filter((cost) => cost.materialPurchaseId === purchase.id).map((cost) => cost.totalCost), true), value(purchase.totalAmount, true)) !== 0).map((purchase) => purchase.id);
  if (unreconciledPurchaseIds.length) warnings.push('Supplier totals do not reconcile to dated linked ledger costs.');
  if (evidence.pendingSupplierCount) warnings.push('Supplier invoices are awaiting review.');
  if (!costs.length) warnings.push('No dated costs are recorded.');
  if (compare(total(approved.map((entry) => entry.totalCost)), total(costs.filter((cost) => cost.category === 'labor').map((cost) => cost.totalCost), true)) > 0) {
    warnings.push('Approved labor cost exceeds dated labor ledger costs.');
  }
  const hours = total(approved.map((entry) => entry.hours));
  const budgetHours = budgetComplete && manualChanges.every((budget) => budget.laborHours !== null)
    ? total([...budgets.map((budget) => budget.calculation.totals.hours), ...manualChanges.map((budget) => budget.laborHours!)]) : null;
  const groups = budgets.flatMap((budget) => budget.calculation.purchaseGroups.filter((group) => group.included));
  // v1 theoretical demand includes its historical allowance, so do not relabel it as pure usage.
  const theoreticalKnown = budgetComplete && budgets.every((budget) => budget.calculationVersion === 'repaint-v2') && manualChanges.every((budget) => budget.theoreticalGallons !== null);
  const theoretical = theoreticalKnown ? total([...groups.map((group) => group.theoreticalGallons), ...manualChanges.map((budget) => budget.theoreticalGallons!)]) : null;
  const ordered = budgetComplete && manualChanges.every((budget) => budget.orderGallons !== null)
    ? total([...groups.map((group) => group.purchasedGallons), ...manualChanges.map((budget) => budget.orderGallons!)]) : null;
  let purchased = ZERO;
  let returned = ZERO;
  let gallonsKnown = purchases.length > 0;
  for (const purchase of purchases) {
    if (!Array.isArray(purchase.lines) || !purchase.lines.length) { gallonsKnown = false; continue; }
    for (const line of purchase.lines) {
      if (!line || typeof line !== 'object') { gallonsKnown = false; continue; }
      const entry = line as { isFee?: boolean; gallons?: string | number | null };
      if (entry.isFee) continue;
      if (entry.gallons == null) { gallonsKnown = false; continue; }
      try {
        const gallons = value(entry.gallons, true);
        if (compare(gallons, ZERO) < 0) returned = subtract(returned, gallons);
        else purchased = add(purchased, gallons);
      } catch { gallonsKnown = false; }
    }
  }
  const money = (category?: string) => minor(total(costs.filter((cost) => !category || cost.category === category).map((cost) => cost.totalCost), true), 'actual');
  const materialBudget = budgetComplete && !costMissing ? sumCents([...budgets.map((budget) => budget.calculation.totals.materialCostMinor), ...manualChanges.map((budget) => budget.materialCostMinor!)]) : null;
  const directBudget = budgetComplete && !costMissing ? sumCents([...budgets.flatMap((budget) => budget.calculation.items.filter((item) => item.included).map((item) => item.directCostMinor!)),
    ...manualChanges.flatMap((budget) => [budget.laborCostMinor!, budget.materialCostMinor!, budget.otherCostMinor!])]) : null;
  const operations = budgetOperations(evidence);
  const duplicateOperationIds = operations.filter((operation, index) => operations.findIndex((entry) => entry.id === operation.id) !== index).map((operation) => operation.id);
  if (duplicateOperationIds.length) warnings.push('Operating task IDs are ambiguous.');
  if (approved.some((entry) => entry.operationId && !operations.some((operation) => operation.id === entry.operationId))) warnings.push('Some approved time is attributed to an unavailable operating task.');
  return {
    version: 'budget-actual-v1' as const, asOf, revision: evidence.revision, budgetComplete,
    eligibleForCloseout: warnings.length === 0 && evidence.status === 'completed', warnings,
    missingChangeBudgetIds, excludedCostIds, unledgeredPurchaseIds,
    missingChangeBudgets: missingChanges.map((change) => ({ id: change.id, description: change.description || 'Approved change order', signedAmount: change.signedAmount || null })),
    reviewedChangeBudgets: manualChanges,
    approvedTimeIds: approved.map((entry) => entry.id), pendingTimeCount: pending.length,
    approvedHours: decimalText(hours), budgetHours: budgetHours && decimalText(budgetHours),
    hoursVariance: budgetHours && decimalText(subtract(hours, budgetHours)),
    budgetLaborMinor: budgetComplete && !costMissing ? sumCents([...budgets.map((budget) => budget.calculation.totals.laborBudgetMinor!), ...manualChanges.map((budget) => budget.laborCostMinor!)]) : null,
    budgetMaterialMinor: materialBudget, budgetDirectCostMinor: directBudget,
    recordedActualCostMinor: money(), recordedLaborMinor: money('labor'), recordedMaterialMinor: money('materials'),
    materialCostVarianceMinor: materialBudget === null ? null : sumCents([money('materials'), -materialBudget]),
    theoreticalGallons: theoretical && decimalText(theoretical), orderBudgetGallons: ordered && decimalText(ordered),
    purchasedGallons: gallonsKnown ? decimalText(purchased) : null,
    recordedReturnedGallons: gallonsKnown ? decimalText(returned) : null,
    purchasedVarianceGallons: gallonsKnown && theoretical ? decimalText(subtract(purchased, theoretical)) : null,
    transferredGallons: null, leftoverGallons: null, usedGallons: null, wasteGallons: null,
    operations: operations.map((operation) => {
      const attributed = approved.filter((entry) => entry.operationId === operation.id);
      return { ...operation, approvedHours: decimalText(total(attributed.map((entry) => entry.hours))), timeEntryIds: attributed.map((entry) => entry.id) };
    }),
    unattributedApprovedTime: approved.filter((entry) => !entry.operationId).map((entry) => ({ id: entry.id, hours: entry.hours, date: entry.date })),
    approvedTime: approved.map((entry) => ({ id: entry.id, hours: entry.hours, date: entry.date, operationId: entry.operationId || null })),
    purchases: evidence.purchases.map((purchase) => ({ id: purchase.id, invoiceDate: purchase.invoiceDate, totalAmount: purchase.totalAmount, included: purchaseMap.has(purchase.id) })),
  };
}

export interface EstimationObservation {
  id: string;
  jobId: string;
  operationId: string;
  revision: string;
  reviewed: boolean;
  qualified: boolean;
  exclusions: string[];
  quantity: string;
  approvedHours: string;
  unit: EstimationUnit;
  coats: number;
  rateBasis: EstimationOperationResult['rateBasis'];
  method: string | null;
  kind: string;
  conditions: string;
  sourceRateVersion: string | null;
  sourceRateId?: string | null;
  timeEntryIds: string[];
}

export function reviewEstimationCloseout(evidence: JobEstimationEvidence, review: { costsComplete: boolean; conditions: string }, asOf: string): EstimationObservation[] {
  const summary = compareJobEstimationBudget(evidence, asOf);
  const shared = [...summary.warnings];
  if (evidence.status !== 'completed') shared.push('The job is not completed.');
  if (!review.costsComplete) shared.push('Cost capture has not been certified complete.');
  if (!review.conditions.trim()) shared.push('Comparable working conditions are missing.');
  if (summary.unattributedApprovedTime.length) shared.push('Approved time has not been fully attributed to operating tasks.');
  if (summary.reviewedChangeBudgets.length) shared.push('Manually reviewed change budgets lack comparable measured task quantities and methods.');
  return summary.operations.map((operation) => {
    const exclusions = [...shared];
    if (!operation.applicationMethod) exclusions.push('Application method is missing.');
    if (!operation.productionRateId || !operation.rateVersion) exclusions.push('Production rate identity/version is missing.');
    if (operation.rateBasis === 'direct_hours') exclusions.push('Fixed-hour tasks cannot calibrate a measured production rate.');
    if (compare(value(operation.quantity), ZERO) <= 0) exclusions.push('Measured quantity is missing.');
    if (compare(value(operation.approvedHours), ZERO) <= 0) exclusions.push('Comparable approved task hours are missing.');
    return {
      id: `${evidence.jobId}:${operation.id}:${evidence.revision}`, jobId: evidence.jobId, operationId: operation.id,
      revision: evidence.revision, reviewed: true, qualified: !exclusions.length, exclusions,
      quantity: operation.quantity, approvedHours: operation.approvedHours, unit: operation.unit, coats: operation.coats,
      rateBasis: operation.rateBasis, method: operation.applicationMethod || null, kind: operation.kind,
      conditions: review.conditions.trim(), sourceRateVersion: operation.rateVersion || null, timeEntryIds: operation.timeEntryIds,
      sourceRateId: operation.productionRateId || null,
    };
  });
}

export interface ComparableRate {
  unit: EstimationUnit;
  coats: number;
  rateBasis: EstimationRateBasis;
  method: string;
  kind: string;
  conditions: string;
}

/** Pool output/hours, not per-job averages. Never mix methods, coat systems or tasks. */
export function suggestEstimationRate(observations: EstimationObservation[], target: ComparableRate) {
  const matched: EstimationObservation[] = [];
  const excluded: Array<{ observationId: string; reasons: string[] }> = [];
  const seen = new Set<string>();
  for (const observation of observations) {
    const reasons = [...observation.exclusions];
    if (!observation.reviewed || !observation.qualified) reasons.push('Closeout is not qualified.');
    for (const key of ['unit', 'coats', 'rateBasis', 'method', 'kind', 'conditions'] as const) {
      if (observation[key] !== target[key]) reasons.push(`Different ${key}.`);
    }
    const identity = `${observation.jobId}:${observation.operationId}`;
    if (seen.has(identity)) reasons.push('Duplicate task sample.');
    try {
      if (compare(value(observation.quantity), ZERO) <= 0 || compare(value(observation.approvedHours), ZERO) <= 0) reasons.push('Quantity and approved hours must be positive.');
    } catch { reasons.push('Invalid measurement evidence.'); }
    if (reasons.length) excluded.push({ observationId: observation.id, reasons: [...new Set(reasons)] });
    else { seen.add(identity); matched.push(observation); }
  }
  const quantities = total(matched.map((observation) => observation.quantity));
  const hours = total(matched.map((observation) => observation.approvedHours));
  let rate: ExactDecimal | null = null;
  if (matched.length) rate = target.rateBasis === 'hours_per_item' ? divide(hours, quantities)
    : divide(target.rateBasis === 'legacy_per_coat' ? multiply(quantities, exact(BigInt(target.coats))) : quantities, hours);
  return {
    version: 'observed-rate-v1' as const, ...target, suggestedRate: rate ? decimalText(rate, 2) : null,
    rateUnit: target.rateBasis === 'hours_per_item' ? 'hours_per_item' : 'units_per_hour',
    sampleCount: new Set(matched.map((observation) => observation.jobId)).size, operationSampleCount: matched.length,
    confidence: new Set(matched.map((observation) => observation.jobId)).size < 3 ? 'limited' : 'review_required',
    quantity: decimalText(quantities), approvedHours: decimalText(hours),
    evidence: matched.map((observation) => ({ observationId: observation.id, jobId: observation.jobId, operationId: observation.operationId,
      revision: observation.revision, timeEntryIds: observation.timeEntryIds, sourceRateVersion: observation.sourceRateVersion,
      sourceRateId: observation.sourceRateId || null })), excluded,
  };
}

export type JobBudgetComparison = ReturnType<typeof compareJobEstimationBudget>;
export type EstimationRateSuggestion = ReturnType<typeof suggestEstimationRate>;
