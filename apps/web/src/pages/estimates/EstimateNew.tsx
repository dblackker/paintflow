import { useState, useEffect, useMemo, useRef, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Input, Select, Textarea } from '@/components/Input';
import { apiJson, formatMoney, formatPhone } from '@/lib/api';
import { EstimationInputError, formatEstimationMinor, type EstimationResult, type EstimationRequest } from '../../../../../packages/core/src/estimation';
import { calculateQuickEstimate } from '../../../../../packages/core/src/estimation-quick';
import { estimationSaveAttempt, type EstimationSaveAttempt } from '../../../../../packages/core/src/estimation-save';
import { decimal, minor } from '../../../../../packages/core/src/estimation-decimal';
import { assertEstimationTemplateCompatible, type EstimationTemplateScope } from '../../../../../packages/core/src/estimation-template';

interface Lead {
  id: string;
  name: string;
  phone?: string;
}

interface ScopeItem {
  id: string;
  desc: string;
  qty: string;
  unit: string;
  laborHours: string;
  materialCost: string;
}

interface OrgSettings {
  defaultLaborRate?: number | string | null;
  materialMarkupPercent?: number | string | null;
  salesTaxRate?: number | string | null;
  depositPercent?: number | string | null;
}

type Preview = { calculation: EstimationResult; resolvedInput: EstimationRequest };

function message(error: unknown) {
  return error instanceof Error ? error.message : 'Could not save the estimate. Try again.';
}

function money(minor: number) {
  return formatMoney(formatEstimationMinor(minor));
}

function initialItems(): ScopeItem[] {
  return [
    { id: crypto.randomUUID(), desc: 'Prep, patching, masking, and setup', qty: '1', unit: 'project', laborHours: '4', materialCost: '1' },
    { id: crypto.randomUUID(), desc: 'Paint walls and ceilings', qty: '1', unit: 'area', laborHours: '8', materialCost: '1' },
  ];
}

export function EstimateNew() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const initialLeadId = params.get('leadId') || '';
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedLeadId, setSelectedLeadId] = useState(initialLeadId);
  const [items, setItems] = useState<ScopeItem[]>(initialItems);
  const [settings, setSettings] = useState<OrgSettings>({});
  const [laborRate, setLaborRate] = useState('65');
  const [markup, setMarkup] = useState('0');
  const [notes, setNotes] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [reload, setReload] = useState(0);
  const [serverPreview, setServerPreview] = useState<{ identity: string; preview: Preview } | null>(null);
  const [savedEstimate, setSavedEstimate] = useState<{ id: string; updatedAt: string } | null>(null);
  const attemptRef = useRef<EstimationSaveAttempt | null>(null);
  const submittingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setLoadError('');
    Promise.all([
      apiJson<{ data?: Lead[] }>('/v1/leads?status=all&limit=200'),
      apiJson<{ data?: OrgSettings }>('/v1/settings/org'),
    ]).then(([customers, defaults]) => {
      if (cancelled) return;
      setLeads(customers.data || []);
      setSettings(defaults.data || {});
      setLaborRate(String(defaults.data?.defaultLaborRate ?? '65'));
      setMarkup(String(defaults.data?.materialMarkupPercent ?? '0'));
    }).catch((error) => {
      if (!cancelled) setLoadError(message(error));
    }).finally(() => {
      if (!cancelled) setIsLoading(false);
    });
    return () => { cancelled = true; };
  }, [reload]);

  const pricing = useMemo(() => {
    try {
      return { value: calculateQuickEstimate(items.map((item) => ({
        id: item.id, quantity: item.qty, laborHoursPerUnit: item.laborHours, materialCostPerUnit: item.materialCost,
      })), {
        laborRate, materialMarkupPercent: markup, salesTaxRate: settings.salesTaxRate ?? '0',
        depositPercent: settings.depositPercent ?? '50',
      }), error: null as EstimationInputError | null };
    } catch (error) {
      return { value: null, error: error instanceof EstimationInputError ? error : new EstimationInputError('items', message(error)) };
    }
  }, [items, laborRate, markup, settings]);

  const identity = JSON.stringify({ leadId: selectedLeadId, items, laborRate, markup, notes });
  const verified = serverPreview?.identity === identity ? serverPreview.preview : null;
  const calculation = verified?.calculation || pricing.value?.calculation;
  const activeIdentity = useRef(identity);
  activeIdentity.current = identity;
  const missingDescriptions = new Set(pricing.value?.items.filter((item) => item.subtotalMinor > 0 && !items.find((row) => row.id === item.id)?.desc.trim()).map((item) => item.id));
  const fieldError = (field: string) => pricing.error?.field === field ? pricing.error.message : undefined;
  const taxPercent = pricing.value?.taxPercent || '0';
  const interchangeError = useMemo(() => {
    const state = location.state as { estimateTemplate?: EstimationTemplateScope; productionInput?: unknown } | null;
    try {
      if (state?.estimateTemplate) assertEstimationTemplateCompatible(state.estimateTemplate, 'quick');
      if (state?.productionInput || params.get('estimateId')) throw new Error('This estimate cannot be flattened into quick scope without losing production details and cost budgets. Keep it in the production estimator.');
      return '';
    } catch (error) { return message(error); }
  }, [location.state, params]);

  function updateItem(id: string, patch: Partial<ScopeItem>) {
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
    setSubmitError('');
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current || !pricing.value || pricing.error || interchangeError) return;
    if (!selectedLeadId) { setSubmitError('Select a customer.'); return; }
    if (missingDescriptions.size) { setSubmitError('Describe each priced scope item.'); return; }
    if (!pricing.value.productionInput.adjustments?.length) { setSubmitError('Add at least one priced scope item.'); return; }
    submittingRef.current = true;
    setIsSubmitting(true);
    setSubmitError('');
    try {
      const checked = await apiJson<{ data: Preview }>('/v1/production-rates/calculate', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify(pricing.value.productionInput),
      });
      if (activeIdentity.current !== identity) throw new Error('The scope changed. Review it before saving.');
      setServerPreview({ identity, preview: checked.data });
      if (checked.data.resolvedInput.taxRate?.kind === 'fraction') setSettings((current) => ({ ...current, salesTaxRate: checked.data.resolvedInput.taxRate!.value }));
      if (checked.data.calculation.totals.totalMinor !== calculation?.totals.totalMinor) {
        setSubmitError('Pricing changed. Review the updated total, then save again.');
        return;
      }
      const pricedRows = new Map(pricing.value.items.map((item) => [item.id, item]));
      const lines = checked.data.calculation.items.map((line) => {
        const row = items.find((item) => item.id === line.id)!;
        const priced = pricedRows.get(line.id)!;
        return {
          calculationItemId: row.id, calculatedSubtotalMinor: line.subtotalMinor,
          desc: row.desc.trim(), kind: 'line_item', qty: Number(row.qty), rate: Number(priced.unitPrice), category: row.unit || 'item',
          notes: [row.qty + ' ' + (row.unit || 'item'), row.laborHours + ' labor hours per item', formatMoney(row.materialCost) + ' materials per item before markup', notes.trim()].filter(Boolean).join('; '),
        };
      });
      const totals = checked.data.calculation.totals;
      const body = JSON.stringify({
        leadId: selectedLeadId, status: 'draft', ...(savedEstimate ? { expectedUpdatedAt: savedEstimate.updatedAt } : {}),
        packages: [{
          name: 'proposal', calculationVersion: checked.data.calculation.calculationVersion,
          productionInput: pricing.value.productionInput, calculationInput: checked.data.resolvedInput,
          subtotal: Number(formatEstimationMinor(totals.subtotalMinor)), discount: 0,
          tax: Number(formatEstimationMinor(totals.taxMinor)), total: Number(formatEstimationMinor(totals.totalMinor)),
          items: lines, lineItems: lines,
        }],
      });
      const path = savedEstimate ? '/v1/estimates/' + savedEstimate.id : '/v1/estimates';
      if (savedEstimate && !savedEstimate.updatedAt) throw new Error('Reload the saved draft before editing so its version can be checked.');
      attemptRef.current = estimationSaveAttempt(attemptRef.current, path + ':' + body, () => crypto.randomUUID());
      const response = await apiJson<{ data: { id: string; updatedAt: string; packages?: Array<{ calculationSnapshot?: EstimationResult; calculationInput?: EstimationRequest; total?: number }> } }>(path, {
        method: savedEstimate ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': attemptRef.current.key }, body,
      });
      attemptRef.current = null;
      setSavedEstimate({ id: response.data.id, updatedAt: response.data.updatedAt });
      const persisted = response.data.packages?.[0];
      if (persisted?.calculationSnapshot && persisted.calculationInput) setServerPreview({ identity, preview: { calculation: persisted.calculationSnapshot, resolvedInput: persisted.calculationInput } });
      if (persisted?.calculationInput?.taxRate?.kind === 'fraction') setSettings((current) => ({ ...current, salesTaxRate: persisted.calculationInput!.taxRate!.value }));
      if (persisted?.total != null && minor(decimal(persisted.total, 'total', { scale: 2 }), 'total') !== totals.totalMinor) {
        setSubmitError('Draft saved with updated pricing. Review the new total before continuing.');
        return;
      }
      window.showToast?.('Draft saved', 'success');
      navigate('/estimates/' + response.data.id + '/details');
    } catch (error) {
      setSubmitError(message(error));
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  if (isLoading) return <div className="mx-auto max-w-6xl space-y-4" aria-label="Loading estimate setup" aria-busy="true"><div className="h-16 animate-pulse rounded bg-gray-100" /><div className="h-64 animate-pulse rounded bg-gray-100" /></div>;
  if (loadError) return <section className="mx-auto max-w-3xl space-y-3"><p className="pf-section-title">Estimate setup could not be loaded</p><p className="pf-copy" role="alert">{loadError}</p><Button type="button" onClick={() => setReload((current) => current + 1)}>Try again</Button></section>;
  if (interchangeError) return <section className="mx-auto max-w-3xl space-y-3"><p className="pf-section-title">Keep the production scope</p><p className="pf-copy" role="alert">{interchangeError}</p><Link to={'/estimates/production' + (params.get('estimateId') ? '?estimateId=' + encodeURIComponent(params.get('estimateId')!) : '')} state={location.state} className="btn btn-text">Open production estimate</Link></section>;

  return (
    <main className="mx-auto max-w-6xl space-y-5 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="pf-page-copy">Build a proposal from a few priced scope items.</p>
        <Link to={'/estimates/production' + (selectedLeadId ? '?leadId=' + encodeURIComponent(selectedLeadId) : '')} className="btn btn-text" onClick={(event) => {
          if (items.length || notes.trim() || savedEstimate) {
            event.preventDefault();
            setSubmitError('Quick scope cannot be converted to production substrates without losing its entered hours, material allowances and prices. Save this draft before starting a separate production estimate.');
          }
        }}>Open production estimator</Link>
      </div>
      <form onSubmit={handleSubmit} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section className="min-w-0 space-y-5">
          <Select label="Customer" value={selectedLeadId} onChange={(event) => { setSelectedLeadId(event.target.value); setSubmitError(''); }} required disabled={isSubmitting}>
            <option value="">Select customer</option>
            {leads.map((lead) => <option key={lead.id} value={lead.id}>{lead.name}{lead.phone ? ' (' + formatPhone(lead.phone) + ')' : ''}</option>)}
          </Select>
          <div className="flex items-center justify-between gap-3"><h2 className="pf-section-title">Scope items</h2><Button type="button" variant="secondary" leftIcon={<Icon name="plus" />} disabled={isSubmitting} onClick={() => setItems((current) => [...current, { id: crypto.randomUUID(), desc: '', qty: '1', unit: 'item', laborHours: '0', materialCost: '0' }])}>Add item</Button></div>
          <div className="space-y-4">
            {items.map((item, index) => {
              const priced = pricing.value?.items.find((row) => row.id === item.id);
              return <section key={item.id} className="rounded-lg border border-gray-200 bg-white p-4" aria-label={'Scope item ' + (index + 1)}>
                <div className="flex items-start gap-2">
                  <Input label="Description" value={item.desc} maxLength={500} disabled={isSubmitting} onChange={(event) => updateItem(item.id, { desc: event.target.value })} error={missingDescriptions.has(item.id) ? 'Describe this scope item.' : undefined} />
                  <button type="button" className="btn-icon btn-icon-standard btn-icon-danger shrink-0 self-end" aria-label={'Remove scope item ' + (index + 1)} disabled={isSubmitting} onClick={() => setItems((current) => current.filter((row) => row.id !== item.id))}><Icon name="trash" /></button>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Input label="Quantity" type="number" min="0" step="0.25" inputMode="decimal" value={item.qty} disabled={isSubmitting} onFocus={(event) => event.target.select()} onChange={(event) => updateItem(item.id, { qty: event.target.value })} error={fieldError(item.id + '.quantity')} />
                  <Input label="Scope type" value={item.unit} maxLength={120} disabled={isSubmitting} onChange={(event) => updateItem(item.id, { unit: event.target.value })} placeholder="Room, wall, door" />
                  <Input label="Hours per item" type="number" min="0" step="any" inputMode="decimal" value={item.laborHours} disabled={isSubmitting} onFocus={(event) => event.target.select()} onChange={(event) => updateItem(item.id, { laborHours: event.target.value })} error={fieldError(item.id + '.laborHoursPerUnit')} />
                  <Input label="Materials per item ($)" type="number" min="0" step="0.01" inputMode="decimal" value={item.materialCost} disabled={isSubmitting} onFocus={(event) => event.target.select()} onChange={(event) => updateItem(item.id, { materialCost: event.target.value })} error={fieldError(item.id + '.materialCostPerUnit')} />
                </div>
                {priced && <div className="mt-3 flex flex-wrap items-center justify-between gap-2"><span className="pf-meta">{formatMoney(priced.unitPrice)} per item</span><span className="pf-row-value" aria-label={'Scope item ' + (index + 1) + ' total'}>{money(priced.subtotalMinor)}</span></div>}
              </section>;
            })}
          </div>
          <Textarea label="Notes" value={notes} maxLength={1500} disabled={isSubmitting} onChange={(event) => setNotes(event.target.value)} rows={3} />
        </section>
        <aside className="min-w-0 space-y-5 self-start lg:sticky lg:top-20">
          <details className="border-b border-gray-200 pb-4">
            <summary className="pf-row-title min-h-12 cursor-pointer py-3">Pricing</summary>
            <div className="space-y-3 pt-3">
              <Input label="Labor rate ($/hr)" type="number" min="0" step="0.01" inputMode="decimal" value={laborRate} disabled={isSubmitting} onChange={(event) => setLaborRate(event.target.value)} error={fieldError('laborRate')} />
              <Input label="Material markup (%)" type="number" min="0" max="200" step="any" inputMode="decimal" value={markup} disabled={isSubmitting} onChange={(event) => setMarkup(event.target.value)} error={fieldError('materialMarkupPercent')} />
              <p className="pf-helper">Changes apply to this estimate only.</p>
            </div>
          </details>
          <section aria-label="Estimate summary" className="space-y-3">
            <h2 className="pf-section-title">Estimate summary</h2>
            {pricing.value && calculation ? <>
              <div className="flex justify-between gap-3"><span className="pf-copy">Labor ({Number(pricing.value.totals.hours).toFixed(1)} hrs)</span><span className="pf-row-value">{money(pricing.value.totals.laborMinor)}</span></div>
              <div className="flex justify-between gap-3"><span className="pf-copy">Materials</span><span className="pf-row-value">{money(pricing.value.totals.materialMinor)}</span></div>
              <div className="flex justify-between gap-3 border-t border-gray-200 pt-3"><span className="pf-copy">Subtotal</span><span className="pf-row-value">{money(calculation.totals.subtotalMinor)}</span></div>
              <div className="flex justify-between gap-3"><span className="pf-copy">Tax ({taxPercent}%)</span><span className="pf-row-value">{money(calculation.totals.taxMinor)}</span></div>
              <div className="flex justify-between gap-3 border-t border-gray-200 pt-3"><span className="pf-row-title">Total</span><strong className="pf-value">{money(calculation.totals.totalMinor)}</strong></div>
              <div className="flex justify-between gap-3"><span className="pf-meta">Deposit ({settings.depositPercent ?? '50'}%)</span><span className="pf-row-value">{money(pricing.value.totals.depositMinor)}</span></div>
              <Link to="/settings#payment-schedule-settings" className="btn btn-text">Payment settings</Link>
            </> : <p className="pf-field-error" role="alert">{pricing.error?.message || 'Complete the scope to calculate pricing.'}</p>}
            {submitError && <p className="pf-field-error" role="alert">{submitError}</p>}
            <Button type="submit" fullWidth isLoading={isSubmitting} disabled={Boolean(pricing.error) || !pricing.value?.productionInput.adjustments?.length || missingDescriptions.size > 0}>{isSubmitting ? 'Saving draft...' : 'Save draft'}</Button>
          </section>
        </aside>
      </form>
    </main>
  );
}
