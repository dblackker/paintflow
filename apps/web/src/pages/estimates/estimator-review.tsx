import type { EstimationRequest, EstimationResult } from '../../../../../packages/core/src/estimation';
import { formatMoney } from '@/lib/api';

export function EstimatorInternalReview({ calculation, input, warnings, provenance }: {
  calculation: EstimationResult | null; input: EstimationRequest | null; warnings: string[];
  provenance: Array<{ id: string; name: string; details: string }>;
}) {
  const included = calculation?.items.filter((item) => item.included) || [];
  const knownLabor = included.filter((item) => item.laborBudgetMinor != null);
  const laborComplete = Boolean(calculation) && knownLabor.length === included.length;
  const budgetComplete = calculation?.totals.costComplete === true;
  const laborCost = knownLabor.reduce((sum, item) => sum + (item.laborBudgetMinor || 0), 0);
  const materialCost = included.reduce((sum, item) => sum + item.materialCostMinor, 0);
  const selling = (calculation?.totals.subtotalMinor || 0) - (calculation?.totals.discountMinor || 0);
  const margin = budgetComplete && selling > 0 && calculation?.totals.grossMarginPercent != null ? calculation.totals.grossMarginPercent + '%' : 'Unknown: incomplete cost budget';
  return <section className="border-t pt-3" aria-label="Internal cost review">
    <h3 className="pf-row-title">Internal cost review</h3>
    {warnings.length > 0 && <ul className="mt-2 space-y-2 text-amber-800" aria-label="Estimate warnings">{warnings.slice(0, 4).map((warning, index) => <li className="pf-supporting" key={index}>{warning}</li>)}</ul>}
    {warnings.length > 4 && <details className="border-t mt-2"><summary className="pf-supporting flex min-h-12 cursor-pointer items-center">Review {warnings.length - 4} more warnings</summary><ul className="space-y-2">{warnings.slice(4).map((warning, index) => <li className="pf-supporting" key={index}>{warning}</li>)}</ul></details>}
    <dl className="mt-3 space-y-2">
      <div><dt className="pf-meta">Burdened labor cost</dt><dd className="pf-value">{laborComplete ? formatMoney(laborCost, true) : 'Not fully configured'}</dd></div>
      <div><dt className="pf-meta">Known labor cost</dt><dd className="pf-value">{formatMoney(laborCost, true)}</dd></div>
      <div><dt className="pf-meta">Known direct cost</dt><dd className="pf-value">{formatMoney(calculation?.totals.knownDirectCostMinor ?? laborCost + materialCost, true)}</dd></div>
      <div><dt className="pf-meta">Theoretical paint</dt><dd className="pf-value">{calculation?.purchaseGroups.filter((group) => group.included).reduce((sum, group) => sum + Number(group.theoreticalGallons), 0).toFixed(2) || '0.00'} gal</dd></div>
      <div><dt className="pf-meta">Purchased packs</dt><dd className="pf-value">{calculation?.purchaseGroups.filter((group) => group.included).reduce((sum, group) => sum + group.packCount, 0) || 0}</dd></div>
      <div><dt className="pf-meta">Estimated direct-cost margin</dt><dd className="pf-value">{margin}</dd></div>
    </dl>
    <details className="mt-3 border-t">
      <summary className="pf-row-title flex min-h-12 cursor-pointer items-center">View pricebook basis</summary>
      <p className="pf-helper">Calculation: {calculation?.calculationVersion || 'Unavailable'}. Tax: resolved rate ({input?.taxRate?.value || '0'} {input?.taxRate?.kind || 'fraction'}); verify the jobsite policy. Material markup is added to the configured cost basis, not a margin percentage. Profit after overhead is not calculated.</p>
      <div className="divide-y">{provenance.map((row) => <div className="py-3" key={row.id}><p className="pf-value">{row.name}</p><p className="pf-helper mt-1">{row.details}</p></div>)}</div>
    </details>
  </section>;
}
