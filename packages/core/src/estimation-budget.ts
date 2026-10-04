import { add, allocateMinor, boundedMinor, compare, decimal, decimalText, divide, exact, minor, multiply, ONE, round, ZERO } from './estimation-decimal';
import { EstimationInputError, type EstimationResult } from './estimation';

export interface AcceptedBudgetOption { desc?: string; qty?: string | number; rate?: string | number; category?: string; calculationItemId?: string; optionIndex?: number }
export interface AcceptedBudgetScopeItem { calculationItemId: string; desc: string; roomName?: string; surfaceName?: string }
export interface AcceptedBudgetPackage {
  name: string; total?: string | number; subtotal?: string | number; discount?: string | number; tax?: string | number;
  taxRate?: string | number | { value: string | number; kind: 'fraction' | 'percent' };
  calculationVersion?: string; calculationInput?: { taxRate?: { value: string | number; kind: 'fraction' | 'percent' } };
  calculationSnapshot?: EstimationResult;
  items?: Array<{ desc: string; qty: string | number; rate: string | number; optional?: boolean; customerVisible?: boolean; category?: string; calculationItemId?: string; roomName?: string; surfaceName?: string }>;
}

/** Select by stable item identity; legacy identical descriptions require the visible option index. */
export function matchAcceptedOptions(items: NonNullable<AcceptedBudgetPackage['items']>, selected: AcceptedBudgetOption[]) {
  const allowed = items.filter((line) => line.optional && line.customerVisible !== false);
  const seen = new Set<number>();
  return selected.map((option) => {
    const matches = allowed.map((line, index) => ({ line, index })).filter(({ line, index }) =>
      (option.calculationItemId ? line.calculationItemId === option.calculationItemId : option.optionIndex != null ? index === option.optionIndex : line.desc === option.desc)
      && line.desc === option.desc && Number(line.qty) === Number(option.qty ?? 1) && Number(line.rate) === Number(option.rate ?? 0));
    if (matches.length !== 1 || seen.has(matches[0].index)) throw new EstimationInputError('selectedOptions', 'An option changed or was selected twice. Reload the proposal and select it again.');
    const { line, index } = matches[0];
    seen.add(index);
    return { desc: line.desc, qty: line.qty, rate: line.rate, category: line.category, calculationItemId: line.calculationItemId, optionIndex: index };
  });
}

function optionTaxRate(pkg: AcceptedBudgetPackage) {
  const stored = pkg.calculationInput?.taxRate ?? (typeof pkg.taxRate === 'object' ? pkg.taxRate : pkg.taxRate != null ? { value: pkg.taxRate, kind: 'fraction' as const } : undefined);
  const base = add(decimal(pkg.subtotal ?? pkg.total ?? 0, 'subtotal'), multiply(decimal(pkg.discount ?? 0, 'discount'), exact(-1n)));
  const taxRate = stored ? stored.kind === 'percent' ? divide(decimal(stored.value, 'tax', { scale: 8 }), exact(100n)) : decimal(stored.value, 'tax', { scale: 8 })
    : base.numerator > 0n ? divide(decimal(pkg.tax ?? 0, 'tax'), base) : ZERO;
  if (compare(taxRate, ONE) > 0) throw new EstimationInputError('tax', 'Sales tax must be between zero and 100%.');
  return taxRate;
}

export function acceptedOptionPricing(pkg: AcceptedBudgetPackage, selected: AcceptedBudgetOption[]) {
  const matched = pkg.items ? matchAcceptedOptions(pkg.items, selected) : selected;
  const alreadyIncluded = new Set(pkg.calculationSnapshot?.items.filter((item) => item.included).map((item) => item.id));
  const subtotalMinor = matched.filter((row) => !row.calculationItemId || !alreadyIncluded.has(row.calculationItemId))
    .reduce((sum, row) => boundedMinor(BigInt(sum) + BigInt(minor(multiply(decimal(row.qty ?? '1', 'quantity'), decimal(row.rate ?? '0', 'price')), 'option')), 'options'), 0);
  const taxRate = optionTaxRate(pkg);
  const taxMinor = boundedMinor(round(multiply(exact(BigInt(subtotalMinor)), taxRate)), 'optionTax');
  return { subtotalMinor, taxMinor, totalMinor: boundedMinor(BigInt(minor(decimal(pkg.total ?? 0, 'total'), 'total')) + BigInt(subtotalMinor) + BigInt(taxMinor), 'contractTotal'), taxRate: decimalText(taxRate) };
}

export function buildAcceptedEstimationBudget(estimateId: string, pkg: AcceptedBudgetPackage, selected: AcceptedBudgetOption[], acceptedAt: string) {
  const matched = matchAcceptedOptions(pkg.items || [], selected);
  const selectedIds = new Set(matched.map((line) => line.calculationItemId).filter(Boolean));
  const snapshot = pkg.calculationSnapshot ? structuredClone(pkg.calculationSnapshot) : null;
  const calculation = snapshot ? { ...snapshot, totals: { ...snapshot.totals, optionalTotalMinor: 0 } } : null;
  const pricing = acceptedOptionPricing(pkg, matched);
  if (calculation) {
    if (matched.some((line) => !line.calculationItemId || !calculation.items.some((item) => item.id === line.calculationItemId))) {
      throw new EstimationInputError('selectedOptions', 'The selected option has no matching calculation budget.');
    }
    const options = calculation.items.filter((item) => !item.included && selectedIds.has(item.id));
    if (options.reduce((sum, item) => sum + BigInt(item.subtotalMinor), 0n) !== BigInt(pricing.subtotalMinor)) {
      throw new EstimationInputError('selectedOptions', 'The option budget does not match the proposal price.');
    }
    const taxShares = allocateMinor(pricing.taxMinor, options.map((item) => ({ id: item.id, weight: exact(BigInt(item.subtotalMinor)) })));
    for (const item of options) { item.included = true; item.taxMinor = taxShares.get(item.id) || 0; item.totalMinor = boundedMinor(BigInt(item.subtotalMinor - item.discountMinor) + BigInt(item.taxMinor), 'optionTotal'); }
    const included = calculation.items.filter((item) => item.included);
    const sum = (key: 'laborMinor' | 'materialMinor' | 'materialCostMinor' | 'adjustmentMinor' | 'subtotalMinor' | 'taxMinor') => boundedMinor(included.reduce((total, item) => total + BigInt(item[key]), 0n), key);
    calculation.totals = { ...calculation.totals,
      hours: decimalText(included.reduce((hours, item) => add(hours, decimal(item.hours, 'hours', { scale: 12 })), ZERO)),
      laborMinor: sum('laborMinor'), laborBudgetMinor: included.some((item) => item.laborBudgetMinor == null) ? null : boundedMinor(included.reduce((sum, item) => sum + BigInt(item.laborBudgetMinor || 0), 0n), 'laborBudget'),
      materialMinor: sum('materialMinor'), materialCostMinor: sum('materialCostMinor'), adjustmentMinor: sum('adjustmentMinor'), subtotalMinor: sum('subtotalMinor'),
      taxMinor: sum('taxMinor'), totalMinor: pricing.totalMinor,
    };
    const remainingOptions = calculation.items.filter((item) => !item.included);
    calculation.totals.optionalSubtotalMinor = boundedMinor(remainingOptions.reduce((sum, item) => sum + BigInt(item.subtotalMinor), 0n), 'optionalSubtotal');
    calculation.totals.optionalTaxMinor = boundedMinor(round(multiply(exact(BigInt(calculation.totals.optionalSubtotalMinor)), optionTaxRate(pkg))), 'optionalTax');
    calculation.totals.optionalTotalMinor = boundedMinor(BigInt(calculation.totals.optionalSubtotalMinor) + BigInt(calculation.totals.optionalTaxMinor), 'optionalTotal');
    const remainingTaxes = allocateMinor(calculation.totals.optionalTaxMinor, remainingOptions.map((item) => ({ id: item.id, weight: exact(BigInt(item.subtotalMinor)) })));
    for (const item of remainingOptions) { item.taxMinor = remainingTaxes.get(item.id) || 0; item.totalMinor = boundedMinor(BigInt(item.subtotalMinor - item.discountMinor) + BigInt(item.taxMinor), 'optionalTotal'); }
    if (calculation.calculationVersion === 'repaint-v2') {
      const sumDecimal = (key: 'theoreticalGallons' | 'orderGallons' | 'purchasedGallons') => decimalText(included.reduce((sum, item) => add(sum, decimal(item[key] ?? 0, key, { scale: 12 })), ZERO));
      const sumNullable = (key: 'consumptionCostMinor' | 'acquisitionCostMinor') => included.some((item) => item[key] === null) ? null
        : boundedMinor(included.reduce((sum, item) => sum + BigInt(item[key] ?? 0), 0n), key);
      const known = boundedMinor(included.reduce((sum, item) => sum + BigInt(item.knownDirectCostMinor ?? 0), 0n), 'knownDirectCost');
      const missing = included.flatMap((item) => (item.missingCostComponents ?? []).map((component) => `${item.id}.${component}`));
      const complete = included.every((item) => item.costComplete === true);
      const revenue = pricing.totalMinor - calculation.totals.taxMinor;
      const margin = complete ? boundedMinor(BigInt(revenue) - BigInt(known), 'grossMargin') : null;
      Object.assign(calculation.totals, {
        theoreticalGallons: sumDecimal('theoreticalGallons'), orderGallons: sumDecimal('orderGallons'), purchasedGallons: sumDecimal('purchasedGallons'),
        consumptionCostMinor: sumNullable('consumptionCostMinor'), acquisitionCostMinor: sumNullable('acquisitionCostMinor'),
        extraCostMinor: included.some((item) => (item.missingCostComponents ?? []).includes('costPerUnit')) ? null
          : boundedMinor(included.filter((item) => item.unit === 'adjustment').reduce((sum, item) => sum + BigInt((item.knownDirectCostMinor ?? 0) - (item.laborBudgetMinor ?? 0)), 0n), 'extraCost'),
        costComplete: complete, knownDirectCostMinor: known, directCostMinor: complete ? known : null, missingCostComponents: missing,
        grossMarginMinor: margin, grossMarginPercent: margin == null || revenue <= 0 ? null : decimalText(multiply(divide(exact(BigInt(margin)), exact(BigInt(revenue))), exact(100n))),
      });
    }
    for (const group of calculation.purchaseGroups) group.included = group.itemIds.some((id) => included.some((item) => item.id === id));
  }
  const includedIds = new Set(calculation?.items.filter((item) => item.included).map((item) => item.id));
  const scope: AcceptedBudgetScopeItem[] = (pkg.items || []).filter((line) => line.customerVisible !== false && line.calculationItemId
    && (calculation ? includedIds.has(line.calculationItemId) : !line.optional || selectedIds.has(line.calculationItemId))).map((line) => ({
    calculationItemId: line.calculationItemId!, desc: line.desc,
    ...(line.roomName !== undefined ? { roomName: line.roomName } : {}),
    ...(line.surfaceName !== undefined ? { surfaceName: line.surfaceName } : {}),
  }));
  return { version: 'accepted-budget-v1' as const, estimateId, packageName: pkg.name, calculationVersion: pkg.calculationVersion || null,
    acceptedAt, selectedOptions: matched, calculation, scope, operationIds: calculation?.items.filter((item) => item.included).map((item) => item.id) || [],
    contractTotalMinor: pricing.totalMinor, costComplete: Boolean(calculation && (calculation.calculationVersion === 'repaint-v2' ? calculation.totals.costComplete : calculation.totals.laborBudgetMinor != null)),
  };
}
