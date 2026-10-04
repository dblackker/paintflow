import { useEffect, useRef, useState } from 'react';
import { Check, Eye, RefreshCw, Save } from 'lucide-react';
import { Button } from '@/components/Button';
import { Modal, ModalFooter } from '@/components/Modal';
import { apiJson, formatMoney, labelize } from '@/lib/api';
import type { JobBudgetComparison, EstimationObservation, EstimationRateSuggestion } from '../../../../../packages/core/src/estimation-observations';

interface Rate { id: string; category: string; surfaceType: string; version: number; unit: string; coats: number; rateBasis: string; applicationMethod: string | null }
interface BudgetData { comparison: JobBudgetComparison; observations: EstimationObservation[]; canReview: boolean; rates: Rate[] }
interface Proposal { id: string; sourceVersion: number; status: string; suggestion: EstimationRateSuggestion; appliedRateId?: string }
const endpoint = '/v1/estimation-observations';
const number = (value: string | null, suffix = '') => value === null ? 'Unknown' : `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}${suffix}`;
const money = (value: number | null) => value === null ? 'Unknown' : formatMoney(value / 100);
const evidenceDate = (value: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC' }).format(new Date(`${value.slice(0, 10)}T00:00:00Z`));
const changeBudgetFields = [
  ['laborHours', 'Labor hours', '0.01'], ['laborCost', 'Burdened labor cost', '0.01'],
  ['materialCost', 'Material acquisition cost', '0.01'], ['otherCost', 'Other direct cost', '0.01'],
  ['theoreticalGallons', 'Theoretical paint (gal)', '0.001'], ['orderGallons', 'Order budget (gal)', '0.001'],
] as const;

export function JobBudgetActual({ jobId, refreshKey }: { jobId: string; refreshKey: unknown }) {
  const [data, setData] = useState<BudgetData | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [conditions, setConditions] = useState('');
  const [certified, setCertified] = useState(false);
  const [rateId, setRateId] = useState('');
  const [kind, setKind] = useState('application');
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [approved, setApproved] = useState(false);
  const [attributions, setAttributions] = useState<Record<string, string>>({});
  const [changeBudgetId, setChangeBudgetId] = useState('');
  const [changeFields, setChangeFields] = useState<Record<string, string>>({});
  const [changeProvenance, setChangeProvenance] = useState('');
  const pending = useRef<{ signature: string; key: string } | null>(null);
  const generation = useRef(0);

  async function load() {
    const requestGeneration = ++generation.current;
    setLoading(true);
    try {
      const response = await apiJson<{ data: BudgetData }>(`${endpoint}/jobs/${jobId}`);
      if (requestGeneration !== generation.current) return;
      setData(response.data);
      setError('');
      setRateId((current) => response.data.rates.some((rate) => rate.id === current) ? current : response.data.rates[0]?.id || '');
    } catch (err) {
      if (requestGeneration === generation.current) {
        setData(null);
        setError(err instanceof Error ? err.message : 'Budget comparison could not be loaded.');
      }
    } finally { if (requestGeneration === generation.current) setLoading(false); }
  }
  useEffect(() => { void load(); return () => { generation.current++; }; }, [jobId, refreshKey]);

  async function mutate<T>(path: string, body: unknown) {
    const signature = JSON.stringify({ path, body });
    if (pending.current?.signature !== signature) pending.current = { signature, key: crypto.randomUUID() };
    setBusy(true);
    setError('');
    try {
      const result = await apiJson<{ data: T }>(`${endpoint}${path}`, { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': pending.current.key }, body: JSON.stringify(body) });
      pending.current = null;
      return result.data;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The request was not confirmed.');
      return null;
    } finally { setBusy(false); }
  }
  const comparison = data?.comparison;
  const selectedRate = data?.rates.find((rate) => rate.id === rateId);
  const changeInputs = () => { setProposal(null); setApproved(false); };

  return <section className="min-w-0 border-y border-[var(--pf-border)] py-5" aria-labelledby="job-budget-title" aria-busy={loading || busy}>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h2 id="job-budget-title" className="pf-section-title">Budget To Actual</h2>
      <div className="flex flex-wrap gap-2">
        {data?.canReview && <Button variant="secondary" disabled={busy || !comparison?.operations.length} leftIcon={<Check className="h-4 w-4" />}
          onClick={() => { setReviewOpen(true); setCertified(false); }}>Review closeout</Button>}
        <Button variant="ghost" aria-label="Reload budget comparison" title="Reload budget comparison" disabled={busy || loading}
          onClick={() => { changeInputs(); void load(); }} leftIcon={<RefreshCw className="h-4 w-4" />} />
      </div>
    </div>
    {error && <p role="alert" className="mb-3 break-words pf-copy text-[var(--pf-danger)]">{error}</p>}
    {!data && <p className="pf-meta">{loading ? 'Loading budget comparison...' : 'Budget comparison unavailable.'}</p>}
    {comparison && <>
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        <Metric label="Budget labor" value={number(comparison.budgetHours, ' hrs')} />
        <Metric label="Approved labor" value={number(comparison.approvedHours, ' hrs')} />
        <Metric label="Approved hour variance" value={number(comparison.hoursVariance, ' hrs')} />
        <Metric label="Budget direct cost" value={money(comparison.budgetDirectCostMinor)} />
        <Metric label="Dated ledger costs" value={money(comparison.recordedActualCostMinor)} />
        <Metric label="Material cost variance" value={money(comparison.materialCostVarianceMinor)} />
        <Metric label="Theoretical paint" value={number(comparison.theoreticalGallons, ' gal')} />
        <Metric label="Order budget" value={number(comparison.orderBudgetGallons, ' gal')} />
        <Metric label="Purchased paint (gross)" value={number(comparison.purchasedGallons, ' gal')} />
        <Metric label="Purchased vs theoretical" value={number(comparison.purchasedVarianceGallons, ' gal')} />
        <Metric label="Supplier returns (recorded)" value={number(comparison.recordedReturnedGallons, ' gal')} />
        <Metric label="Transfers / leftover / used / waste" value="Unknown" />
      </dl>
      {!!comparison.warnings.length && <ul className="mt-4 list-inside list-disc space-y-1 pf-copy text-[var(--pf-text-muted)]">
        {comparison.warnings.map((warning) => <li key={warning}>{warning}</li>)}
      </ul>}
      {data?.canReview && !!comparison.missingChangeBudgets.length && <div className="mt-4 border-t pt-3">
        <h3 className="pf-section-title">Approved Changes Without Budgets</h3>
        <ul className="divide-y">{comparison.missingChangeBudgets.map((change) => <li key={change.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
          <div className="min-w-0"><p className="break-words pf-copy">{change.description}</p>
            <p className="pf-meta">Signed price: {change.signedAmount === null ? 'Unknown' : formatMoney(Number(change.signedAmount))}</p></div>
          <Button variant="secondary" disabled={busy} leftIcon={<Check className="h-4 w-4" />} onClick={() => {
            setChangeBudgetId(change.id); setChangeFields({}); setChangeProvenance('');
          }}>Review change budget</Button>
        </li>)}</ul>
      </div>}
      {!!comparison.reviewedChangeBudgets.length && <details className="mt-4 border-t pt-3">
        <summary className="cursor-pointer pf-row-title">Reviewed change budgets ({comparison.reviewedChangeBudgets.length})</summary>
        <ul className="divide-y pf-copy">{comparison.reviewedChangeBudgets.map((budget) => <li key={budget.changeOrderId} className="space-y-1 py-3">
          <p>{number(budget.laborHours, ' labor hrs')} · {money(budget.laborCostMinor)} labor · {money(budget.materialCostMinor)} materials · {money(budget.otherCostMinor)} other</p>
          <p className="break-words pf-meta">{budget.provenance}</p>
        </li>)}</ul>
      </details>}
      {!!comparison.purchases.length && <details className="mt-4 border-t pt-3">
        <summary className="cursor-pointer pf-row-title">Supplier purchase evidence</summary>
        <ul className="divide-y pf-copy">{comparison.purchases.map((purchase) => <li key={purchase.id} className="flex flex-wrap justify-between gap-2 py-2">
          <span>{purchase.invoiceDate ? evidenceDate(purchase.invoiceDate) : 'Invoice date unknown'}</span>
          <span>{purchase.totalAmount === null ? 'Amount unknown' : formatMoney(Number(purchase.totalAmount))} · {purchase.included ? 'Dated' : 'Excluded'}</span>
        </li>)}</ul>
      </details>}
      {!!comparison.operations.length && <details className="mt-5 border-t pt-4">
        <summary className="mb-2 min-h-[48px] cursor-pointer py-2 pf-section-title">Operating Tasks</summary>
        <ul className="divide-y">{comparison.operations.map((operation) => <li key={`${operation.estimateId}:${operation.id}`} className="grid min-w-0 gap-1 py-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0"><p className="break-words pf-row-title">{operation.description?.trim() || `${operation.itemLabel || 'Scope item'} · ${labelize(operation.kind)}`}</p>
            <p className="pf-meta break-words">{number(operation.quantity)} {labelize(operation.unit)} · {operation.coats} coats · {labelize(operation.applicationMethod || 'unknown method')}</p></div>
          <p className="pf-copy">{number(operation.hours, ' budget hrs')} / {number(operation.approvedHours, ' approved hrs')}</p>
        </li>)}</ul>
      </details>}
      {data?.canReview && !!comparison.approvedTime.length && <details className="mt-4 border-t pt-4">
        <summary className="min-h-[48px] cursor-pointer py-2 pf-section-title">Approved Time Attribution</summary>
        <ul className="divide-y">{comparison.approvedTime.map((entry) => <li key={entry.id} className="grid min-w-0 gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(160px,2fr)_auto] sm:items-center">
          <span className="pf-copy">{evidenceDate(entry.date)} · {number(entry.hours, ' hrs')}</span>
          <select aria-label={`Task for ${entry.hours} approved hours on ${evidenceDate(entry.date)}`} className="input min-w-0"
            value={attributions[entry.id] ?? entry.operationId ?? ''} disabled={busy} onChange={(event) => setAttributions((current) => ({ ...current, [entry.id]: event.target.value }))}>
            <option value="">Unassigned</option>{comparison.operations.map((operation) => <option key={operation.id} value={operation.id}>{operation.description?.trim() || `${operation.itemLabel || 'Scope item'}: ${labelize(operation.kind)}`}</option>)}
          </select>
          <Button variant="secondary" leftIcon={<Save className="h-4 w-4" />} disabled={busy || !attributions[entry.id] || attributions[entry.id] === entry.operationId} onClick={async () => {
            const result = await mutate(`/jobs/${jobId}/attributions`, { expectedRevision: comparison.revision, timeEntryId: entry.id, operationId: attributions[entry.id] });
            if (result) { setAttributions({}); changeInputs(); await load(); }
          }}>{entry.operationId ? 'Save attribution' : 'Assign task'}</Button>
        </li>)}</ul>
      </details>}
      {data?.canReview && <details className="mt-5 border-t pt-4">
        <summary className="mb-3 min-h-[48px] cursor-pointer py-2 pf-section-title">Reviewed Rate Version</summary>
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <label className="min-w-0"><span className="pf-label">Production rate</span><select className="input min-w-0" value={rateId} disabled={busy} onChange={(event) => { setRateId(event.target.value); changeInputs(); }}>
            <option value="">Select rate</option>{data.rates.map((rate) => <option key={rate.id} value={rate.id}>{rate.category} · {rate.surfaceType} · v{rate.version}</option>)}
          </select></label>
          <label><span className="pf-label">Operation</span><select className="input" value={kind} disabled={busy} onChange={(event) => { setKind(event.target.value); changeInputs(); }}>
            {['application', 'primer', 'prep', 'setup', 'masking', 'cut_in', 'cleanup', 'mobilization', 'other'].map((item) => <option key={item} value={item}>{labelize(item)}</option>)}
          </select></label>
          <label className="sm:col-span-2"><span className="pf-label">Comparable substrate, access and conditions</span><input className="input" value={conditions} disabled={busy} maxLength={500}
            onChange={(event) => { setConditions(event.target.value); changeInputs(); }} /></label>
        </div>
        {selectedRate && <p className="pf-meta mt-2 break-words">{labelize(selectedRate.unit)} · {selectedRate.coats} coats · {labelize(selectedRate.rateBasis)} · {labelize(selectedRate.applicationMethod || 'unknown method')}</p>}
        <Button variant="secondary" className="mt-3" leftIcon={<Eye className="h-4 w-4" />} disabled={busy || !selectedRate || !conditions.trim()} onClick={async () => {
          const result = await mutate<Proposal>('/rates/preview', { rateId, expectedVersion: selectedRate!.version, kind, conditions: conditions.trim() });
          if (result) { setProposal(result); setApproved(false); }
        }}>Preview rate</Button>
        {!!data.observations.length && <details className="mt-3"><summary className="cursor-pointer pf-copy">Closeout observations</summary>
          <ul className="divide-y pf-copy">{data.observations.map((observation) => <li key={observation.id} className="break-words py-2">
            {observation.operationId} · {observation.qualified ? 'Qualified' : 'Excluded'}
            {!observation.qualified && <p className="pf-meta">{observation.exclusions.join(' ')}</p>}
          </li>)}</ul>
        </details>}
      </details>}
    </>}
    <Modal isOpen={!!changeBudgetId} onClose={() => !busy && setChangeBudgetId('')} title="Review Approved Change Budget" size="lg">
      <form className="space-y-4" onSubmit={async (event) => {
        event.preventDefault();
        if (!comparison) return;
        const fields = Object.fromEntries(changeBudgetFields.map(([name]) => [name, changeFields[name]?.trim() || null]));
        const result = await mutate(`/jobs/${jobId}/change-orders/${changeBudgetId}/budget`, {
          expectedRevision: comparison.revision, ...fields, provenance: changeProvenance.trim(),
        });
        if (result) { setChangeBudgetId(''); changeInputs(); await load(); }
      }}>
        {error && <p role="alert" className="break-words pf-copy text-[var(--pf-danger)]">{error}</p>}
        <p className="pf-copy">Signed change-order price remains unchanged. Unrecorded budgets are unknown, not zero.</p>
        <div className="grid gap-3 sm:grid-cols-2">{changeBudgetFields.map(([name, label, step]) => <label key={name}>
          <span className="pf-label">{label}</span><input className="input" type="number" min="0" step={step} inputMode="decimal"
            placeholder="Unknown" value={changeFields[name] || ''} disabled={busy}
            onChange={(event) => setChangeFields((current) => ({ ...current, [name]: event.target.value }))} />
        </label>)}</div>
        <label className="block"><span className="pf-label">Reviewed budget evidence</span>
          <textarea className="input" rows={3} required minLength={5} maxLength={1000} value={changeProvenance} disabled={busy}
            onChange={(event) => setChangeProvenance(event.target.value)} /></label>
        <ModalFooter><Button type="button" variant="secondary" disabled={busy} onClick={() => setChangeBudgetId('')}>Cancel</Button>
          <Button type="submit" disabled={busy || changeProvenance.trim().length < 5} leftIcon={<Check className="h-4 w-4" />}>Approve budget</Button></ModalFooter>
      </form>
    </Modal>
    <Modal isOpen={reviewOpen} onClose={() => !busy && setReviewOpen(false)} title="Review Cost Closeout">
      <form onSubmit={async (event) => {
        event.preventDefault();
        if (!comparison) return;
        const result = await mutate(`/jobs/${jobId}/closeout`, { expectedRevision: comparison.revision, costsComplete: certified, conditions: conditions.trim() });
        if (result) { setReviewOpen(false); changeInputs(); await load(); }
      }} className="space-y-4">
        {error && <p role="alert" className="break-words pf-copy text-[var(--pf-danger)]">{error}</p>}
        <label className="block"><span className="pf-label">Comparable substrate, access and conditions</span>
          <textarea className="input" rows={3} required maxLength={500} value={conditions} disabled={busy} onChange={(event) => { setConditions(event.target.value); changeInputs(); }} /></label>
        <label className="flex gap-3 pf-copy"><input type="checkbox" required checked={certified} disabled={busy} onChange={(event) => setCertified(event.target.checked)} />
          <span>All labor, supplier purchases, credits and other job costs have been recorded and reviewed.</span></label>
        {!!comparison?.warnings.length && <ul className="list-inside list-disc pf-copy text-[var(--pf-danger)]">{comparison.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
        <ModalFooter><Button type="button" variant="secondary" disabled={busy} onClick={() => setReviewOpen(false)}>Cancel</Button>
          <Button type="submit" disabled={busy || !certified || !conditions.trim()} leftIcon={<Check className="h-4 w-4" />}>Save closeout</Button></ModalFooter>
      </form>
    </Modal>
    <Modal isOpen={!!proposal} onClose={() => !busy && setProposal(null)} title="Preview Production Rate Version">
      {proposal && <div className="space-y-4">
        {error && <p role="alert" className="break-words pf-copy text-[var(--pf-danger)]">{error}</p>}
        <dl className="grid gap-3 sm:grid-cols-2">
          <Metric label={`Proposed version ${proposal.sourceVersion + 1}`} value={`${proposal.suggestion.suggestedRate} ${labelize(proposal.suggestion.rateUnit)}`} />
          <Metric label="Comparable jobs / tasks" value={`${proposal.suggestion.sampleCount} / ${proposal.suggestion.operationSampleCount}`} />
          <Metric label="Measured quantity" value={`${number(proposal.suggestion.quantity)} ${labelize(proposal.suggestion.unit)}`} />
          <Metric label="Approved attributed hours" value={number(proposal.suggestion.approvedHours, ' hrs')} />
          <Metric label="Basis / coats" value={`${labelize(proposal.suggestion.rateBasis)} / ${proposal.suggestion.coats}`} />
          <Metric label="Method / confidence" value={`${labelize(proposal.suggestion.method)} / ${labelize(proposal.suggestion.confidence)}`} />
        </dl>
        <p className="break-words pf-copy">{proposal.suggestion.conditions}</p>
        <ul className="space-y-2 pf-copy">{proposal.suggestion.evidence.map((entry) => <li key={entry.observationId} className="break-words">
          <a className="text-[var(--pf-primary)] underline" href={`/jobs/${entry.jobId}`}>View source job</a> · {entry.operationId} · {entry.timeEntryIds.length} approved time entries
        </li>)}</ul>
        {!!proposal.suggestion.excluded.length && <details><summary className="cursor-pointer pf-copy">Excluded observations ({proposal.suggestion.excluded.length})</summary>
          <ul className="space-y-2 pf-copy">{proposal.suggestion.excluded.map((entry) => <li key={entry.observationId}>{entry.reasons.join(' ')}</li>)}</ul>
        </details>}
        <p className="pf-copy">Selling prices and signed agreements remain unchanged.</p>
        <label className="flex gap-3 pf-copy"><input type="checkbox" checked={approved} disabled={busy} onChange={(event) => setApproved(event.target.checked)} />
          <span>Approve and activate this new production rate version.</span></label>
        <ModalFooter><Button variant="secondary" disabled={busy} onClick={() => setProposal(null)}>Cancel</Button>
          <Button disabled={busy || !approved} leftIcon={<Check className="h-4 w-4" />} onClick={async () => {
            const result = await mutate<Proposal>(`/rates/${proposal.id}/apply`, { approve: true });
            if (result) { setProposal(null); await load(); window.showToast?.('Rate version approved', 'success'); }
          }}>Approve rate</Button></ModalFooter>
      </div>}
    </Modal>
  </section>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><dt className="pf-meta break-words">{label}</dt><dd className="break-words pf-row-title">{value}</dd></div>;
}
