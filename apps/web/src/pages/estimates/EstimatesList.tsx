import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Badge, StatusBadge } from '@/components/Badge';
import { AddressInline } from '@/components/AddressInline';
import { Card } from '@/components/Card';
import { Input, Select, Textarea } from '@/components/Input';
import { Modal, ModalFooter } from '@/components/Modal';
import { ServiceErrorState } from '@/components/ServiceErrorState';
import { EstimateActionMenu, EstimateActionMenuEstimate, EstimateActionType } from '@/components/estimates/EstimateActionMenu';
import { apiJson, formatMoney, formatPhone } from '@/lib/api';

interface EstimatePackage {
  name?: string;
  total?: number | string;
  subtotal?: number | string;
}

interface Payment {
  id?: string;
  amount?: number | string | null;
  refundedAmount?: number | string | null;
  status?: string | null;
}

interface Estimate {
  id: string;
  leadId?: string | null;
  leadName?: string | null;
  leadPhone?: string | null;
  leadEmail?: string | null;
  leadStreetAddress?: string | null;
  leadCity?: string | null;
  leadState?: string | null;
  leadPostalCode?: string | null;
  status?: string | null;
  total?: number | string | null;
  packages?: EstimatePackage[] | null;
  payments?: Payment[] | null;
  createdAt?: string | null;
  sentAt?: string | null;
  signedAt?: string | null;
  customerPreviewUrl?: string | null;
  publicUrl?: string | null;
}

interface EstimatesResponse {
  data: Estimate[];
}

function estimateTotal(estimate: Estimate) {
  const proposal = estimate.packages?.find((item) => item.name === 'proposal')
    || estimate.packages?.find((item) => /better|recommended/i.test(String(item.name || '')))
    || estimate.packages?.[0];
  return Number(proposal?.total ?? proposal?.subtotal ?? estimate.total ?? 0);
}

function netPaid(payments: Payment[] = []) {
  return payments.reduce((sum, payment) => {
    const status = String(payment.status || '');
    if (!['succeeded', 'paid', 'partially_refunded', 'refunded'].includes(status)) return sum;
    return sum + Number(payment.amount || 0) - Number(payment.refundedAmount || 0);
  }, 0);
}

function estimateBalance(estimate: Estimate) {
  return Math.max(estimateTotal(estimate) - netPaid(estimate.payments || []), 0);
}

function formatDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function estimateAddress(estimate: Estimate) {
  const street = estimate.leadStreetAddress || '';
  const locality = [estimate.leadCity, estimate.leadState].filter(Boolean).join(', ');
  return [street, locality].filter(Boolean).join(' ');
}

function paymentSummary(payments: Payment[] = []) {
  const paid = payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const refunded = payments.reduce((sum, payment) => sum + Number(payment.refundedAmount || 0), 0);
  const net = Math.max(paid - refunded, 0);
  if (!payments.length) return 'No payments recorded';
  return `${formatMoney(net)} paid${refunded > 0 ? ` - ${formatMoney(refunded)} refunded` : ''}`;
}

export function EstimatesList() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [estimates, setEstimates] = useState<Estimate[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState(() => {
    const status = searchParams.get('status');
    return status && ['all', 'sent', 'accepted', 'declined', 'canceled', 'superseded', 'voided', 'draft'].includes(status) ? status : 'all';
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [paymentEstimate, setPaymentEstimate] = useState<Estimate | null>(null);
  const [agreementAction, setAgreementAction] = useState<{ type: 'revise' | 'void'; estimate: Estimate } | null>(null);
  const [savingPayment, setSavingPayment] = useState(false);
  const [savingAgreement, setSavingAgreement] = useState(false);

  async function loadEstimates() {
    setIsLoading(true);
    try {
      const response = await apiJson<EstimatesResponse>('/v1/estimates?limit=100');
      setEstimates(response.data || []);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load estimates');
      window.showToast?.('Failed to load estimates', 'error');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadEstimates();
  }, []);

  const filteredEstimates = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return estimates.filter((estimate) => {
      const haystack = [
        estimate.leadName,
        estimate.leadPhone,
        estimate.leadEmail,
        estimateAddress(estimate),
        estimate.status,
      ].filter(Boolean).join(' ').toLowerCase();
      return (!query || haystack.includes(query)) && (statusFilter === 'all' || estimate.status === statusFilter);
    });
  }, [estimates, searchQuery, statusFilter]);

  const statusOptions = [
    { value: 'all', label: 'All statuses' },
    { value: 'sent', label: 'Sent' },
    { value: 'accepted', label: 'Accepted' },
    { value: 'declined', label: 'Declined' },
    { value: 'canceled', label: 'Canceled' },
    { value: 'superseded', label: 'Superseded' },
    { value: 'voided', label: 'Voided' },
    { value: 'draft', label: 'Draft' },
  ];

  const summary = useMemo(() => {
    const counts = filteredEstimates.reduce<Record<string, number>>((acc, estimate) => {
      const status = String(estimate.status || 'draft');
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {});
    const totalValue = filteredEstimates.reduce((sum, estimate) => sum + estimateTotal(estimate), 0);
    return {
      sent: counts.sent || 0,
      accepted: counts.accepted || 0,
      totalValue,
      winRate: filteredEstimates.length ? Math.round(((counts.accepted || 0) / filteredEstimates.length) * 100) : 0,
    };
  }, [filteredEstimates]);

  async function cancelEstimate(estimate: Estimate) {
    if (estimate.status === 'accepted' || estimate.signedAt) return;
    if (!confirm('Cancel this estimate? The customer preview will no longer be approvable.')) return;
    try {
      await apiJson(`/v1/estimates/${estimate.id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ reason: 'Canceled from estimates list' }),
      });
      window.showToast?.('Estimate canceled', 'success');
      await loadEstimates();
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to cancel estimate', 'error');
    }
  }

  async function submitPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!paymentEstimate) return;
    const formData = new FormData(event.currentTarget);
    const amount = Number(formData.get('amount') || 0);
    const remaining = estimateBalance(paymentEstimate);
    const hasRecordedPayment = netPaid(paymentEstimate.payments || []) > 0.005;
    if (!Number.isFinite(amount) || amount <= 0) {
      window.showToast?.('Enter a positive payment amount.', 'error');
      return;
    }
    if (amount > remaining + 0.005) {
      window.showToast?.(`Payment cannot exceed the remaining balance of ${formatMoney(remaining)}.`, 'error');
      return;
    }
    if (hasRecordedPayment && formData.get('confirmAdditionalPayment') !== 'true') {
      window.showToast?.('Confirm this is not a duplicate payment before saving.', 'error');
      return;
    }
    setSavingPayment(true);
    try {
      const receivedAt = formData.get('receivedAt')
        ? new Date(`${formData.get('receivedAt')}T12:00:00`).toISOString()
        : null;
      await apiJson('/v1/payments/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({
          estimateId: paymentEstimate.id,
          amount,
          source: formData.get('source'),
          reference: formData.get('reference') || null,
          description: formData.get('description') || null,
          receivedAt,
          confirmAdditionalPayment: hasRecordedPayment,
        }),
      });
      setPaymentEstimate(null);
      window.showToast?.('Payment recorded', 'success');
      await loadEstimates();
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to record payment', 'error');
    } finally {
      setSavingPayment(false);
    }
  }

  async function submitAgreementAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!agreementAction) return;
    const reason = String(new FormData(event.currentTarget).get('reason') || '').trim();
    if (!reason) {
      window.showToast?.('Enter a reason before continuing.', 'error');
      return;
    }
    setSavingAgreement(true);
    try {
      const response = await apiJson<{ data?: { id?: string; editUrl?: string } }>(`/v1/estimates/${agreementAction.estimate.id}/${agreementAction.type}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ reason }),
      });
      if (agreementAction.type === 'revise') {
        window.showToast?.('Revision draft created', 'success');
        navigate(response.data?.editUrl || `/estimates/production?estimateId=${response.data?.id}`);
        return;
      }
      setAgreementAction(null);
      window.showToast?.('Agreement voided', 'success');
      await loadEstimates();
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Agreement action failed', 'error');
    } finally {
      setSavingAgreement(false);
    }
  }

  function handleAction(estimate: EstimateActionMenuEstimate, action: EstimateActionType) {
    setOpenMenuId(null);
    const listEstimate = estimate as Estimate;
    if (action === 'payment') setPaymentEstimate(listEstimate);
    if (action === 'cancel') cancelEstimate(listEstimate);
    if (action === 'revise') setAgreementAction({ type: 'revise', estimate: listEstimate });
    if (action === 'void') setAgreementAction({ type: 'void', estimate: listEstimate });
  }

  if (isLoading) {
    return (
      <div className="mx-auto max-w-6xl py-5 sm:py-8">
        <div className="animate-pulse space-y-4">
          <div className="h-11 rounded bg-gray-200" />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="h-28 rounded-xl bg-gray-200" />
            <div className="h-28 rounded-xl bg-gray-200" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl py-5 sm:py-8">
      <div className="mb-5 flex flex-col gap-3 rounded-lg border bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="pf-kicker">Sales proposals</p>
          <p className="pf-page-copy mt-1 max-w-2xl">Track sent, accepted, and declined painting proposals.</p>
        </div>
        <Link to="/estimates/production" className="btn-primary justify-center sm:w-auto">Start estimate</Link>
      </div>

      <section className="mb-4 grid gap-3 md:grid-cols-2">
        <Link to="/estimates/production" className="block rounded-lg border bg-white p-4 shadow-sm transition hover:border-blue-300 hover:shadow-md">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="pf-section-title">Production estimate</h3>
              <p className="pf-copy mt-1">Use measured surfaces, prep levels, production rates, labor, paint products, and templates.</p>
            </div>
            <Badge variant="info">Default</Badge>
          </div>
        </Link>
        <Link to="/estimates/new" className="block rounded-lg border bg-white p-4 shadow-sm transition hover:border-blue-300 hover:shadow-md">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="pf-section-title">Quick line-item estimate</h3>
              <p className="pf-copy mt-1">Build a simple estimate from manually entered scope items when takeoff detail is not needed.</p>
            </div>
            <Badge>Simple</Badge>
          </div>
        </Link>
      </section>

      <Card padding="md" className="mb-4 border-gray-200 bg-white/95">
        <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
          <Input
            type="search"
            autoComplete="off"
            enterKeyHint="search"
            placeholder="Search customer, phone, or email"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
          <Select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} options={statusOptions} />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Summary label="Sent" value={summary.sent} />
          <Summary label="Accepted" value={summary.accepted} />
          <Summary label="Total Value" value={formatMoney(summary.totalValue)} />
          <Summary label="Win Rate" value={`${summary.winRate}%`} />
        </div>
      </Card>

      {error && (
        <div className="mb-4">
          <ServiceErrorState error={error} pageName="Estimates" title="Estimates are unavailable" onRetry={loadEstimates} compact />
        </div>
      )}

      {filteredEstimates.length === 0 ? (
        <EmptyEstimates filtered={Boolean(searchQuery.trim() || statusFilter !== 'all')} />
      ) : (
        <div className="grid gap-3">
          {filteredEstimates.map((estimate) => (
            <EstimateRow
              key={estimate.id}
              estimate={estimate}
              openMenuId={openMenuId}
              onMenuChange={setOpenMenuId}
              onAction={handleAction}
            />
          ))}
        </div>
      )}

      <ManualPaymentModal
        estimate={paymentEstimate}
        onClose={() => setPaymentEstimate(null)}
        onSubmit={submitPayment}
        isSaving={savingPayment}
      />

      <AgreementActionModal
        action={agreementAction}
        onClose={() => setAgreementAction(null)}
        onSubmit={submitAgreementAction}
        isSaving={savingAgreement}
      />
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border bg-gray-50 px-3 py-2">
      <p className="pf-meta">{label}</p>
      <p className="pf-section-title">{value}</p>
    </div>
  );
}

function EmptyEstimates({ filtered }: { filtered: boolean }) {
  if (filtered) {
    return <div className="pf-copy rounded-lg border bg-white p-8 text-center">No estimates match this view.</div>;
  }
  return (
    <div className="rounded-lg border bg-white p-5 sm:p-8">
      <div className="mx-auto max-w-2xl text-center">
        <p className="pf-section-title">Create your first painting proposal</p>
        <p className="pf-copy mt-2">Track sent, accepted, and declined painting proposals once you have a customer ready for pricing.</p>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <Step title="1. Select a customer" copy="Start from an existing lead or create one first." />
        <Step title="2. Build scope" copy="Use production rates and paint products for accurate pricing." />
        <Step title="3. Send and follow up" copy="The customer preview stays linked to the estimate activity." />
      </div>
      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
        <Link className="btn-primary justify-center" to="/estimates/production">Start estimate</Link>
        <Link className="btn-secondary justify-center" to="/leads?new=1">Add customer</Link>
      </div>
    </div>
  );
}

function Step({ title, copy }: { title: string; copy: string }) {
  return (
    <div className="rounded-lg border bg-gray-50 p-3">
      <p className="pf-row-title">{title}</p>
      <p className="pf-copy mt-1">{copy}</p>
    </div>
  );
}

function EstimateRow({
  estimate,
  openMenuId,
  onMenuChange,
  onAction,
}: {
  estimate: Estimate;
  openMenuId: string | null;
  onMenuChange: (id: string | null) => void;
  onAction: (estimate: Estimate, action: EstimateActionType) => void;
}) {
  const address = estimateAddress(estimate);
  const contact = estimate.leadPhone ? formatPhone(estimate.leadPhone) : estimate.leadEmail || 'No contact';
  const menuOpen = openMenuId === estimate.id;

  return (
    <article className="mobile-card-row rounded-lg border bg-white p-4 shadow-sm transition hover:border-blue-200 hover:shadow-md">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div className="min-w-0 pr-1">
          <div className="min-w-0 rounded-lg pr-2">
            <Link to={estimate.leadId ? `/leads/${estimate.leadId}` : `/estimates/${estimate.id}`} className="pf-row-title block truncate hover:text-blue-700">
              {estimate.leadName || 'Customer'}
            </Link>
            <AddressInline address={address} className="pf-copy" />
            <span className="pf-meta block truncate">{contact}</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="pf-meta">{formatDate(estimate.createdAt) || 'Not recorded'}</span>
            <StatusBadge status={String(estimate.status || 'draft')} />
          </div>
          <div className="mt-2 space-y-0.5 text-xs text-gray-500">
            <div>Created {formatDate(estimate.createdAt) || 'not recorded'}</div>
            {estimate.sentAt && <div>Sent {formatDate(estimate.sentAt)}</div>}
            {estimate.signedAt && <div>Signed {formatDate(estimate.signedAt)}</div>}
          </div>
        </div>
        <div className="flex items-start justify-between gap-3 rounded-lg bg-gray-50 p-3 sm:block sm:min-w-48 sm:bg-transparent sm:p-0 sm:text-right">
          <div>
            <p className="pf-section-title text-blue-700">{formatMoney(estimateTotal(estimate))}</p>
            <p className="pf-meta">{paymentSummary(estimate.payments || [])}</p>
          </div>
          <EstimateActionMenu
            estimate={estimate}
            isOpen={menuOpen}
            onOpenChange={(open) => onMenuChange(open ? estimate.id : null)}
            onAction={(menuEstimate, action) => onAction(menuEstimate as Estimate, action)}
          />
        </div>
      </div>
    </article>
  );
}

function ManualPaymentModal({
  estimate,
  onClose,
  onSubmit,
  isSaving,
}: {
  estimate: Estimate | null;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  isSaving: boolean;
}) {
  const paid = estimate ? netPaid(estimate.payments || []) : 0;
  const balance = estimate ? estimateBalance(estimate) : 0;
  const hasRecordedPayment = paid > 0.005;
  return (
    <Modal isOpen={Boolean(estimate)} onClose={onClose} title="Record manual payment">
      {estimate && (
        <form className="space-y-4" onSubmit={onSubmit}>
          <p className="pf-copy">{formatMoney(paid)} recorded - {formatMoney(balance)} remaining</p>
          <div className="pf-copy rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-950">
            This records money received outside Stripe. It will reduce the remaining balance, but it does not charge the customer.
          </div>
          {hasRecordedPayment && (
            <label className="pf-copy block rounded-lg border border-red-200 bg-red-50 p-3 text-red-950">
              <span className="flex items-start gap-3">
                <input name="confirmAdditionalPayment" type="checkbox" value="true" className="mt-1 rounded border-red-300" />
                <span>This estimate already has a payment recorded. I confirm this is an additional payment and not a duplicate entry.</span>
              </span>
            </label>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Select name="source" label="Payment type" defaultValue="check">
              <option value="check">Check</option>
              <option value="cash">Cash</option>
              <option value="ach">ACH / bank transfer</option>
              <option value="other">Other</option>
            </Select>
            <Input name="amount" label="Amount" type="number" min="0.01" max={balance.toFixed(2)} step="0.01" inputMode="decimal" required defaultValue={balance > 0 ? balance.toFixed(2) : ''} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input name="receivedAt" label="Received date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
            <Input name="reference" label="Check / reference #" maxLength={120} autoComplete="off" placeholder="Optional" />
          </div>
          <Input name="description" label="Description" maxLength={255} autoComplete="off" placeholder="Deposit, progress payment, final payment" />
          <ModalFooter className="-mx-6 -mb-4 mt-4">
            <button type="button" className="btn-secondary btn-sm" onClick={onClose}>Cancel</button>
            <button className="btn-primary btn-sm" disabled={isSaving}>{isSaving ? 'Recording...' : 'Record payment'}</button>
          </ModalFooter>
        </form>
      )}
    </Modal>
  );
}

function AgreementActionModal({
  action,
  onClose,
  onSubmit,
  isSaving,
}: {
  action: { type: 'revise' | 'void'; estimate: Estimate } | null;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  isSaving: boolean;
}) {
  const isRevision = action?.type === 'revise';
  return (
    <Modal isOpen={Boolean(action)} onClose={onClose} title={isRevision ? 'Create revised agreement' : 'Void signed agreement'}>
      {action && (
        <form className="space-y-4" onSubmit={onSubmit}>
          <p className="pf-copy">
            {isRevision
              ? 'This creates a new draft estimate from the signed agreement and marks the signed agreement as superseded.'
              : 'This marks the signed agreement as voided while preserving the signed copy and payment history.'}
          </p>
          <Textarea name="reason" label="Reason" rows={3} maxLength={500} required placeholder="Customer requested a different scope, job postponed, agreement rescinded..." />
          <div className="pf-copy rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-950">
            Signed agreements remain in the customer record for audit history. Use revisions for changed scope; use void only when the agreement should not proceed.
          </div>
          <ModalFooter className="-mx-6 -mb-4 mt-4">
            <button type="button" className="btn-secondary btn-sm" onClick={onClose}>Cancel</button>
            <button className="btn-primary btn-sm" disabled={isSaving}>{isSaving ? 'Saving...' : isRevision ? 'Create revision' : 'Void agreement'}</button>
          </ModalFooter>
        </form>
      )}
    </Modal>
  );
}
