import { acceptedOptionPricing, matchAcceptedOptions, type AcceptedBudgetOption, type AcceptedBudgetPackage } from './estimation-budget';
import { boundedMinor, decimal, EstimationInputError, minor, moneyText } from './estimation-decimal';

type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue { return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {}; }
function pick(value: unknown, keys: string[]): RecordValue {
  const source = record(value);
  return Object.fromEntries(keys.filter((key) => source[key] === null || ['string', 'number', 'boolean'].includes(typeof source[key])).map((key) => [key, source[key]]));
}

/** Public scope must not expose the contractor's acquisition cost, burden, or private notes. */
export function publicEstimatePackages(value: unknown, acceptanceSnapshot?: unknown): RecordValue[] {
  if (!Array.isArray(value)) return [];
  const acceptance = acceptanceSnapshot == null ? null : record(acceptanceSnapshot);
  const packages = acceptance ? value.filter((entry) => record(entry).name === acceptance.packageName) : value;
  if (acceptance && packages.length !== 1) return [];
  return packages.map((entry) => {
    const pkg = record(entry);
    const rows = Array.isArray(pkg.items) ? pkg.items : Array.isArray(pkg.lineItems) ? pkg.lineItems : [];
    const snapshotItems = record(pkg.calculationSnapshot).items;
    const budgetPackage = { ...pkg, items: rows.map(record),
      calculationSnapshot: Array.isArray(snapshotItems) ? pkg.calculationSnapshot : undefined } as unknown as AcceptedBudgetPackage;
    if (acceptance?.selectedOptions != null && !Array.isArray(acceptance.selectedOptions)) {
      throw new EstimationInputError('selectedOptions', 'The accepted option selection is invalid.');
    }
    const selected = acceptance ? (acceptance.selectedOptions ?? []) as AcceptedBudgetOption[] : [];
    if (selected.some((option) => !option || typeof option !== 'object' || Array.isArray(option))) {
      throw new EstimationInputError('selectedOptions', 'The accepted option selection is invalid.');
    }
    const matched = acceptance ? matchAcceptedOptions(budgetPackage.items!, selected) : [];
    const selectedIndexes = new Set(matched.map((option) => option.optionIndex));
    const alreadyIncluded = new Set(Array.isArray(snapshotItems) ? snapshotItems.filter((item) => record(item).included).map((item) => record(item).id) : []);
    let optionIndex = -1;
    const items = rows.filter((row) => record(row).customerVisible !== false).flatMap((row) => {
      const source = record(row);
      if (source.optional) optionIndex++;
      if (acceptance && source.optional && !selectedIndexes.has(optionIndex) && !alreadyIncluded.has(source.calculationItemId as string)) return [];
      return [{
        ...pick(source, ['desc', 'qty', 'rate', 'category', 'notes', 'kind', 'optional', 'roomName', 'surfaceName', 'group', 'calculationItemId']),
        ...(acceptance || alreadyIncluded.has(source.calculationItemId as string) ? { optional: false, included: true } : {}),
        labor: pick(source.labor, ['coats', 'prepLevel', 'applicationMethod', 'ceilingColorSeparation']),
        material: pick(source.material, ['name', 'brand', 'sheen', 'colorName', 'colorCode', 'status']),
        coatingLayers: Array.isArray(source.coatingLayers) ? source.coatingLayers.map((layer) => pick(layer, ['phase', 'name', 'brand', 'sheen', 'coats', 'colorName', 'colorCode'])) : undefined,
        scopeCommitments: Array.isArray(source.scopeCommitments) ? source.scopeCommitments.filter((commitment) => typeof commitment === 'string').slice(0, 20) : undefined,
      }];
    });
    const projected: RecordValue = { ...pick(pkg, ['name', 'subtotal', 'discount', 'tax', 'total', 'optionalTotal', 'estimateType', 'calculationVersion', 'taxRate']), items, lineItems: items };
    if (typeof pkg.taxRate === 'object' && pkg.taxRate !== null) projected.taxRate = pick(pkg.taxRate, ['value', 'kind']);
    if (acceptance) {
      const pricing = acceptedOptionPricing(budgetPackage, matched);
      const frozenTotal = acceptance.contractTotalMinor;
      if (frozenTotal != null && (!Number.isSafeInteger(frozenTotal) || Number(frozenTotal) < 0)) {
        throw new EstimationInputError('contractTotal', 'The accepted contract must contain nonnegative integer cents.');
      }
      const totalMinor = boundedMinor(BigInt((frozenTotal ?? pricing.totalMinor) as number), 'contractTotal');
      const taxMinor = boundedMinor(BigInt(minor(decimal((pkg.tax ?? 0) as string | number, 'tax'), 'tax')) + BigInt(pricing.taxMinor), 'contractTax');
      const discountMinor = minor(decimal((pkg.discount ?? 0) as string | number, 'discount'), 'discount');
      const subtotalMinor = boundedMinor(BigInt(totalMinor) - BigInt(taxMinor) + BigInt(discountMinor), 'contractSubtotal');
      if (subtotalMinor < discountMinor) throw new EstimationInputError('contractTotal', 'The accepted tax exceeds the contract total.');
      Object.assign(projected, { subtotal: Number(moneyText(subtotalMinor)), discount: Number(moneyText(discountMinor)),
        tax: Number(moneyText(taxMinor)), total: Number(moneyText(totalMinor)), optionalTotal: 0, taxRate: pricing.taxRate });
    }
    return projected;
  });
}
