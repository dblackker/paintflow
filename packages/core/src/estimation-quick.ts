import { calculateProductionEstimate, type EstimationCalculationVersion, type EstimationDecimal, type EstimationRequest } from './estimation';
import { EstimationInputError, add, allocateMinor, compare, decimal, decimalText, divide, exact, minor, moneyText, multiply, ONE, ZERO } from './estimation-decimal';
import type { ProductionPreviewRequest } from './estimation-production';

export interface QuickEstimateRow {
  id: string;
  quantity: EstimationDecimal;
  laborHoursPerUnit: EstimationDecimal;
  materialCostPerUnit: EstimationDecimal;
  burdenedRate?: EstimationDecimal;
  costUnknown?: boolean;
}

export interface QuickEstimatePolicy {
  calculationVersion?: EstimationCalculationVersion;
  burdenedLaborRate?: EstimationDecimal;
  laborRate: EstimationDecimal;
  materialMarkupPercent: EstimationDecimal;
  salesTaxRate: EstimationDecimal;
  depositPercent?: EstimationDecimal;
}

/** Quick quotes intentionally sell a cents-rounded unit price, then multiply quantity. */
export function calculateQuickEstimate(rows: QuickEstimateRow[], policy: QuickEstimatePolicy) {
  const v2 = policy.calculationVersion === 'repaint-v2';
  if (policy.calculationVersion != null && !['repaint-v1', 'repaint-v2'].includes(policy.calculationVersion)) {
    throw new EstimationInputError('calculationVersion', 'Select a supported calculation version.');
  }
  if (rows.length > 200) throw new EstimationInputError('items', 'Use no more than 200 scope items.');
  const ids = new Set<string>();
  for (const row of rows) {
    if (!row.id || row.id.length > 150 || ids.has(row.id)) throw new EstimationInputError('items', 'Each scope item needs a unique identifier.');
    ids.add(row.id);
  }
  const laborRate = decimal(policy.laborRate, 'laborRate', { scale: 2 });
  const markup = decimal(policy.materialMarkupPercent, 'materialMarkupPercent');
  if (compare(markup, exact(200n)) > 0) throw new EstimationInputError('materialMarkupPercent', 'Enter a percentage no greater than 200.');
  const depositRate = decimal(policy.depositPercent ?? '0', 'depositPercent');
  if (compare(depositRate, exact(100n)) > 0) throw new EstimationInputError('depositPercent', 'Enter a percentage no greater than 100.');
  const priced = rows.map((row) => {
    const quantity = decimal(row.quantity, `${row.id}.quantity`);
    const hours = decimal(row.laborHoursPerUnit, `${row.id}.laborHoursPerUnit`);
    const materialCost = decimal(row.materialCostPerUnit, `${row.id}.materialCostPerUnit`, { scale: 2 });
    const labor = multiply(hours, laborRate);
    const materials = multiply(materialCost, add(ONE, divide(markup, exact(100n))));
    const unitPriceMinor = minor(add(labor, materials), `${row.id}.unitPrice`);
    return { id: row.id, quantity, hours, materialCost, labor, materials, unitPriceMinor, burdenedRate: row.burdenedRate, costUnknown: row.costUnknown };
  });
  const adjustments = priced.filter((row) => row.quantity.numerator > 0n && (row.unitPriceMinor > 0 || v2))
    .map((row) => ({
      id: row.id, quantity: decimalText(row.quantity), unitPrice: moneyText(row.unitPriceMinor),
      ...(v2 ? {
        costPerUnit: decimalText(row.materialCost), hoursPerUnit: decimalText(row.hours),
        burdenedRate: row.burdenedRate ?? policy.burdenedLaborRate, costUnknown: row.costUnknown,
      } : {}),
    }));
  const productionInput: ProductionPreviewRequest = { items: [], adjustments, discount: '0' };
  const resolvedInput: EstimationRequest = {
    currency: 'USD', surfaces: [], adjustments, discount: '0',
    taxRate: { value: policy.salesTaxRate, kind: 'fraction' },
  };
  if (v2) {
    productionInput.calculationVersion = 'repaint-v2';
    resolvedInput.calculationVersion = 'repaint-v2';
    // Keep adapter and persisted snapshots identical even for all-adjustment quick quotes.
    resolvedInput.materialSellingPolicy = 'purchase';
    resolvedInput.minimumPrice = '0';
  }
  const calculation = calculateProductionEstimate(resolvedInput);
  const lines = new Map(calculation.items.map((line) => [line.id, line]));
  const items = priced.map((row) => {
    const subtotalMinor = lines.get(row.id)?.subtotalMinor ?? 0;
    const allocated = allocateMinor(subtotalMinor, [{ id: 'labor', weight: row.labor }, { id: 'materials', weight: row.materials }]);
    return {
      id: row.id, quantity: decimalText(row.quantity), unitPrice: moneyText(row.unitPriceMinor),
      subtotalMinor, laborMinor: allocated.get('labor')!, materialMinor: allocated.get('materials')!,
      materialCostMinor: v2 && row.costUnknown ? 0 : subtotalMinor || v2 ? minor(multiply(row.quantity, row.materialCost), `${row.id}.materialCost`) : 0,
      hours: subtotalMinor || v2 ? decimalText(multiply(row.quantity, row.hours)) : '0',
    };
  });
  return {
    productionInput, resolvedInput, calculation, items,
    taxPercent: decimalText(multiply(decimal(policy.salesTaxRate, 'taxRate', { scale: 8 }), exact(100n))),
    totals: {
      ...calculation.totals,
      laborMinor: items.reduce((sum, item) => sum + item.laborMinor, 0),
      materialMinor: items.reduce((sum, item) => sum + item.materialMinor, 0),
      materialCostMinor: items.reduce((sum, item) => sum + item.materialCostMinor, 0),
      hours: decimalText(items.reduce((sum, item) => add(sum, decimal(item.hours, 'hours', { scale: 8 })), ZERO)),
      depositMinor: minor(multiply(exact(BigInt(calculation.totals.totalMinor), 100n), divide(depositRate, exact(100n))), 'deposit'),
    },
  };
}
