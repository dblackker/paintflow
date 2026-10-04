import { boundedMinor, compare, decimal, decimalText, divide, exact, multiply, round, EstimationInputError, type EstimationDecimal } from './estimation-decimal';

export interface EstimationTaxRule { postalCode: string; ratePercent: EstimationDecimal; label: string }
export interface EstimationTaxPolicy { rules: EstimationTaxRule[] }
export interface ResolvedEstimationTax {
  kind: 'fraction'; value: string; source: 'organization' | 'jobsite_rule' | 'override';
  postalCode: string | null; label: string; overrideReason: string | null; actorId: string | null;
}

/** Rules are contractor-reviewed jurisdiction assumptions, not a tax authority lookup. */
export function resolveEstimationTax(input: {
  defaultRate?: EstimationDecimal | null; policy?: EstimationTaxPolicy | null; postalCode?: string | null;
  override?: { ratePercent: EstimationDecimal; reason: string } | null; actorId?: string | null;
}): ResolvedEstimationTax {
  const postalCode = input.postalCode?.trim().match(/^\d{5}(?:-\d{4})?$/)?.[0].slice(0, 5) || null;
  const rule = postalCode ? input.policy?.rules.find((entry) => entry.postalCode === postalCode) : null;
  if (input.override && input.override.reason.trim().length < 3) throw new EstimationInputError('taxOverride.reason', 'Explain why this tax rate is overridden.');
  const value = input.override || rule
    ? divide(decimal(input.override?.ratePercent ?? rule!.ratePercent, 'taxRate', { scale: 4 }), exact(100n))
    : decimal(input.defaultRate ?? '0', 'taxRate', { scale: 8 });
  if (compare(value, exact(1n)) > 0) throw new EstimationInputError('taxRate', 'Sales tax must be between zero and 100%.');
  return {
    kind: 'fraction', value: decimalText(value), source: input.override ? 'override' : rule ? 'jobsite_rule' : 'organization',
    postalCode, label: input.override ? 'Reviewed override' : rule?.label || 'Organization default',
    overrideReason: input.override?.reason.trim() || null, actorId: input.actorId || null,
  };
}

export function taxMinorForSubtotal(subtotalMinor: number, tax: Pick<ResolvedEstimationTax, 'value'>): number {
  if (!Number.isSafeInteger(subtotalMinor) || subtotalMinor < 0) throw new EstimationInputError('subtotal', 'Enter a valid nonnegative subtotal.');
  return boundedMinor(round(multiply(exact(BigInt(subtotalMinor)), decimal(tax.value, 'taxRate', { scale: 8 }))), 'tax');
}

export function readEstimationTaxPolicy(preferences: unknown): EstimationTaxPolicy {
  const raw = preferences && typeof preferences === 'object' ? (preferences as Record<string, unknown>).estimationTax : null;
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as EstimationTaxPolicy).rules)) return { rules: [] };
  return { rules: (raw as EstimationTaxPolicy).rules.filter((rule) => rule && /^\d{5}$/.test(rule.postalCode) && typeof rule.label === 'string').slice(0, 100) };
}
