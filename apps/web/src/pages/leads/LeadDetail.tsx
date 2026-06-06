import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { StatusBadge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { Input, Select, Textarea } from '@/components/Input';
import { ActivityTimeline } from '@/components/ActivityTimeline';
import { API_URL, apiJson, formatAddress, formatMoney, formatPhone, labelize } from '@/lib/api';

interface Lead {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  streetAddress?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  status?: string | null;
  source?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  notes?: string | null;
}

interface Estimate {
  id: string;
  status?: string | null;
  total?: number | string | null;
  createdAt?: string | null;
  sentAt?: string | null;
  signedAt?: string | null;
  clientViewedAt?: string | null;
  clientViewCount?: number | null;
  customerPreviewUrl?: string | null;
  publicUrl?: string | null;
  packages?: Array<{ selected?: boolean; total?: number | string | null }>;
}

interface Job {
  id: string;
  jobNumber?: string | null;
  name?: string | null;
  status?: string | null;
  budget?: number | string | null;
  streetAddress?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  createdAt?: string | null;
  completedAt?: string | null;
  scheduledStartAt?: string | null;
  scheduledEndAt?: string | null;
  estimateId?: string | null;
}

interface Activity {
  id: string;
  action?: string | null;
  type?: string | null;
  title?: string | null;
  notes?: string | null;
  description?: string | null;
  status?: string | null;
  dueAt?: string | null;
  createdAt?: string | null;
}

interface Message {
  id: string;
  direction?: string | null;
  body?: string | null;
  createdAt?: string | null;
}

interface EmailSend {
  id: string;
  subject?: string | null;
  status?: string | null;
  templateName?: string | null;
  toEmail?: string | null;
  previewText?: string | null;
  renderedHtml?: string | null;
  sentAt?: string | null;
}

interface Payment {
  id: string;
  estimateId?: string | null;
  invoiceId?: string | null;
  amount?: number | string | null;
  refundedAmount?: number | string | null;
  status?: string | null;
  method?: string | null;
  source?: string | null;
  description?: string | null;
  reference?: string | null;
  stripePaymentIntentId?: string | null;
  stripeChargeId?: string | null;
  receivedAt?: string | null;
}

interface CustomerInvoice {
  id: string;
  leadId: string;
  estimateId?: string | null;
  jobId?: string | null;
  changeOrderId?: string | null;
  invoiceNumber?: string | null;
  description?: string | null;
  total?: number | string | null;
  status?: string | null;
  dueDate?: string | null;
  dueLabel?: string | null;
  sentAt?: string | null;
  paidAt?: string | null;
  createdAt?: string | null;
  payments?: Payment[];
}

interface Photo {
  id?: string;
  url?: string | null;
  createdAt?: string | null;
}

interface LeadDetailResponse {
  data: {
    customer: Lead;
    estimates: Estimate[];
    jobs: Job[];
    messages: Message[];
    emailSends?: EmailSend[];
    invoices?: CustomerInvoice[];
    payments: Payment[];
    activities?: Activity[];
    activity?: Activity[];
    photos?: {
      estimates?: Photo[];
      jobs?: Photo[];
    };
  };
}

interface PaymentForm {
  estimate?: Estimate;
  invoice?: CustomerInvoice;
  amount: string;
  source: 'cash' | 'check' | 'ach' | 'other';
  reference: string;
  description: string;
  receivedAt: string;
  confirmAdditionalPayment: boolean;
}

interface RefundForm {
  payment: Payment;
  amount: string;
  reason: string;
  method: 'cash' | 'check' | 'ach' | 'credit' | 'other';
  reference: string;
  confirmManualRefund: boolean;
}

const activityTypeOptions = [
  { value: 'follow_up', label: 'Follow-up' },
  { value: 'call', label: 'Call' },
  { value: 'text', label: 'Text' },
  { value: 'email', label: 'Email' },
  { value: 'site_visit', label: 'Site visit' },
  { value: 'task', label: 'Task' },
  { value: 'note', label: 'Note' },
];

function formatDate(value?: string | null, withTime = false) {
  if (!value) return 'Not set';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}),
  }).format(new Date(value));
}

function dateTimeLocalValue(value = new Date()) {
  const offset = value.getTimezoneOffset() * 60000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 16);
}

function estimateContractTotal(estimate: Estimate) {
  const selectedPackage = estimate.packages?.find((pkg) => pkg.selected);
  return Number(selectedPackage?.total ?? estimate.total ?? 0);
}

function paymentNet(payment: Payment) {
  return Math.max(Number(payment.amount || 0) - Number(payment.refundedAmount || 0), 0);
}

function isStripePayment(payment: Payment) {
  return Boolean(payment.stripePaymentIntentId || payment.stripeChargeId || payment.source === 'stripe');
}

function invoicePaid(invoice: CustomerInvoice) {
  return (invoice.payments || []).reduce((sum, payment) => sum + paymentNet(payment), 0);
}

function invoiceBalance(invoice: CustomerInvoice) {
  return Math.max(Number(invoice.total || 0) - invoicePaid(invoice), 0);
}

function jobAddress(job: Job) {
  const locality = [job.city, job.state].filter(Boolean).join(', ');
  return [job.streetAddress, locality, String(job.postalCode || '').slice(0, 5)].filter(Boolean).join(' ');
}

function photoSrc(photo: Photo, source: 'Estimate' | 'Job') {
  if (source === 'Job' && photo.id) return `${API_URL}/v1/uploads/photos/file/${encodeURIComponent(photo.id)}`;
  return photo.url || '';
}

function nextAction(data: LeadDetailResponse['data']) {
  const activeJob = data.jobs.find((job) => !['completed', 'cancelled', 'canceled'].includes(String(job.status || '')));
  if (activeJob) return { label: 'Open active job', href: `/jobs/${activeJob.id}` };
  const sent = data.estimates.find((estimate) => estimate.status === 'sent');
  if (sent) return { label: 'Follow up on estimate', href: `/estimates/${sent.id}` };
  const draft = data.estimates.find((estimate) => estimate.status === 'draft');
  if (draft) return { label: 'Edit draft estimate', href: `/estimates/production?estimateId=${draft.id}` };
  return { label: 'Create estimate', href: `/estimates/production?leadId=${data.customer.id}` };
}

function followUps(data: LeadDetailResponse['data']) {
  const items: string[] = [];
  const sent = data.estimates.find((estimate) => estimate.status === 'sent');
  const accepted = data.estimates.find((estimate) => estimate.status === 'accepted');
  const completed = data.jobs.find((job) => job.status === 'completed');
  if (sent) items.push(`Follow up on estimate sent ${formatDate(sent.sentAt || sent.createdAt)}.`);
  if (accepted && !data.jobs.some((job) => job.estimateId === accepted.id)) items.push('Accepted estimate needs a scheduled job.');
  if (completed) items.push('Completed job is ready for a review request and before/after photo selection.');
  return items.length ? items : ['No urgent follow-up detected. Keep contact details current and create the next estimate when ready.'];
}

export function LeadDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<LeadDetailResponse['data'] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingActivity, setIsSavingActivity] = useState(false);
  const [isSavingPayment, setIsSavingPayment] = useState(false);
  const [isSavingRefund, setIsSavingRefund] = useState(false);
  const [error, setError] = useState('');
  const [activityForm, setActivityForm] = useState({
    type: 'follow_up',
    title: '',
    dueAt: '',
    notes: '',
  });
  const [paymentForm, setPaymentForm] = useState<PaymentForm | null>(null);
  const [refundForm, setRefundForm] = useState<RefundForm | null>(null);

  async function loadDetail() {
    if (!id) return;
    setIsLoading(true);
    try {
      const response = await apiJson<LeadDetailResponse>(`/v1/leads/${id}`);
      setDetail(response.data);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load customer');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadDetail();
  }, [id]);

  useEffect(() => {
    if (!detail || !window.location.hash) return;
    window.requestAnimationFrame(() => document.querySelector(window.location.hash)?.scrollIntoView({ block: 'start' }));
  }, [detail]);

  useEffect(() => {
    document.body.classList.toggle('pf-modal-open', Boolean(paymentForm || refundForm));
    return () => document.body.classList.remove('pf-modal-open');
  }, [paymentForm, refundForm]);

  const auditActivity = useMemo(() => [...(detail?.activity || [])]
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
    .slice(0, 20), [detail]);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-8 lg:px-8">
        <div className="animate-pulse space-y-4">
          <div className="h-36 rounded-lg bg-gray-200" />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((item) => <div key={item} className="h-24 rounded-lg bg-gray-200" />)}
          </div>
        </div>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-8 lg:px-8">
        <Card className="border-red-200 bg-red-50 text-red-800">{error || 'Customer not found'}</Card>
      </div>
    );
  }

  const lead = detail.customer;
  const address = formatAddress(lead);
  const action = nextAction(detail);
  const recentEstimate = [...detail.estimates].sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())[0];
  const estimatePhotos = detail.photos?.estimates || [];
  const jobPhotos = detail.photos?.jobs || [];
  const allPhotos = [
    ...estimatePhotos.map((photo) => ({ ...photo, source: 'Estimate' as const })),
    ...jobPhotos.map((photo) => ({ ...photo, source: 'Job' as const })),
  ];
  const invoices = detail.invoices || [];
  const invoiceBalanceDue = invoices.reduce((sum, invoice) => sum + invoiceBalance(invoice), 0);
  const netPaid = detail.payments.reduce((sum, payment) => sum + paymentNet(payment), 0);
  const messagesCount = detail.messages.length + (detail.emailSends?.length || 0);

  async function submitActivity(event: FormEvent) {
    event.preventDefault();
    if (!id || isSavingActivity || !activityForm.title.trim()) return;
    setIsSavingActivity(true);
    try {
      await apiJson('/v1/activities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({
          leadId: id,
          type: activityForm.type,
          title: activityForm.title.trim(),
          notes: activityForm.notes.trim() || null,
          dueAt: activityForm.dueAt ? new Date(activityForm.dueAt).toISOString() : null,
        }),
      });
      window.showToast?.('Activity saved', 'success');
      setActivityForm({ type: 'follow_up', title: '', dueAt: '', notes: '' });
      await loadDetail();
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to save activity', 'error');
    } finally {
      setIsSavingActivity(false);
    }
  }

  async function completeActivity(activityId: string) {
    try {
      await apiJson(`/v1/activities/${activityId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'done' }),
      });
      window.showToast?.('Activity completed', 'success');
      await loadDetail();
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to update activity', 'error');
    }
  }

  async function cancelEstimate(estimate: Estimate) {
    if (!window.confirm('Cancel this estimate? The customer preview will no longer be approvable.')) return;
    try {
      await apiJson(`/v1/estimates/${estimate.id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ reason: 'Canceled from customer detail' }),
      });
      window.showToast?.('Estimate canceled', 'success');
      await loadDetail();
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to cancel estimate', 'error');
    }
  }

  async function agreementAction(estimate: Estimate, actionName: 'revise' | 'void') {
    const copy = actionName === 'revise'
      ? 'Create a draft revision from this signed agreement?'
      : 'Void this signed agreement? This should be used only when both parties agree the contract is no longer valid.';
    if (!window.confirm(copy)) return;
    try {
      const response = await apiJson<{ data?: { id?: string; editUrl?: string } }>(`/v1/estimates/${estimate.id}/${actionName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ reason: `${labelize(actionName)} from customer detail` }),
      });
      window.showToast?.(actionName === 'revise' ? 'Revision created' : 'Agreement voided', 'success');
      if (actionName === 'revise') {
        navigate(response.data?.editUrl || `/estimates/production?estimateId=${response.data?.id || estimate.id}`);
        return;
      }
      await loadDetail();
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : `Failed to ${actionName} estimate`, 'error');
    }
  }

  function openPaymentModal(estimate: Estimate) {
    const paid = (detail?.payments || [])
      .filter((payment) => payment.estimateId === estimate.id)
      .reduce((sum, payment) => sum + paymentNet(payment), 0);
    const remaining = Math.max(estimateContractTotal(estimate) - paid, 0);
    setPaymentForm({
      estimate,
      amount: remaining.toFixed(2),
      source: 'check',
      reference: '',
      description: '',
      receivedAt: dateTimeLocalValue(),
      confirmAdditionalPayment: paid <= 0.005,
    });
  }

  function openInvoicePaymentModal(invoice: CustomerInvoice) {
    const paid = invoicePaid(invoice);
    const remaining = invoiceBalance(invoice);
    setPaymentForm({
      invoice,
      amount: remaining.toFixed(2),
      source: 'check',
      reference: '',
      description: invoice.description || '',
      receivedAt: dateTimeLocalValue(),
      confirmAdditionalPayment: paid <= 0.005,
    });
  }

  async function submitPayment(event: FormEvent) {
    event.preventDefault();
    if (!paymentForm || isSavingPayment) return;
    if (!paymentForm.estimate?.id && !paymentForm.invoice?.id) {
      window.showToast?.('Select an estimate or invoice before recording payment.', 'error');
      return;
    }
    setIsSavingPayment(true);
    try {
      await apiJson('/v1/payments/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({
          estimateId: paymentForm.estimate?.id,
          invoiceId: paymentForm.invoice?.id,
          amount: Number(paymentForm.amount),
          source: paymentForm.source,
          reference: paymentForm.reference || null,
          description: paymentForm.description || null,
          receivedAt: paymentForm.receivedAt ? new Date(paymentForm.receivedAt).toISOString() : null,
          confirmAdditionalPayment: paymentForm.confirmAdditionalPayment,
        }),
      });
      window.showToast?.('Payment recorded', 'success');
      setPaymentForm(null);
      await loadDetail();
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to record payment', 'error');
    } finally {
      setIsSavingPayment(false);
    }
  }

  async function submitRefund(event: FormEvent) {
    event.preventDefault();
    if (!refundForm || isSavingRefund) return;
    setIsSavingRefund(true);
    try {
      await apiJson(`/v1/payments/${refundForm.payment.id}/refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({
          amount: Number(refundForm.amount),
          reason: refundForm.reason || undefined,
          method: isStripePayment(refundForm.payment) ? undefined : refundForm.method,
          reference: isStripePayment(refundForm.payment) ? undefined : refundForm.reference || undefined,
          confirmManualRefund: isStripePayment(refundForm.payment) ? undefined : refundForm.confirmManualRefund,
        }),
      });
      window.showToast?.(isStripePayment(refundForm.payment) ? 'Stripe refund submitted' : 'Manual refund recorded', 'success');
      setRefundForm(null);
      await loadDetail();
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to issue refund', 'error');
    } finally {
      setIsSavingRefund(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-8 lg:px-8">
      <section className="rounded-lg border bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h2 className="pf-page-title truncate">{lead.name}</h2>
              <StatusBadge status={String(lead.status || 'new')} />
            </div>
            <p className="pf-page-copy mt-2">{[lead.source && labelize(lead.source), `Created ${formatDate(lead.createdAt)}`].filter(Boolean).join(' - ')}</p>
            {address && <p className="pf-row-title mt-3">{address}</p>}
            <div className="mt-4 flex flex-wrap gap-2">
              {lead.phone && <a href={`tel:${lead.phone}`} className="btn-icon btn-icon-outlined" aria-label={`Call ${lead.name}`} title="Call"><Icon name="phone" className="pf-icon" /></a>}
              {lead.email && <a href={`mailto:${lead.email}`} className="btn-icon btn-icon-outlined" aria-label={`Email ${lead.name}`} title="Email"><Icon name="mail" className="pf-icon" /></a>}
              <Link to={`/sms?leadId=${lead.id}`} className="btn-icon btn-icon-outlined" aria-label={`Text ${lead.name}`} title="Text"><Icon name="message" className="pf-icon" /></Link>
              <Link to={action.href} className="btn-primary btn-sm">{action.label}</Link>
            </div>
          </div>
          <div className="space-y-1 lg:text-right">
            <p className="pf-copy">{lead.phone ? formatPhone(lead.phone) : 'No phone'}</p>
            <p className="pf-copy">{lead.email || 'No email'}</p>
            <p className="pf-meta pt-1">Updated {formatDate(lead.updatedAt)}</p>
          </div>
        </div>
      </section>

      <section className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-6">
        <StatTile href="#customer-estimates" label="Estimates" value={detail.estimates.length} help={recentEstimate ? `${formatMoney(estimateContractTotal(recentEstimate))} latest` : 'No estimate yet'} />
        <StatTile href="#customer-invoices" label="Invoices" value={invoices.length} help={invoiceBalanceDue > 0 ? `${formatMoney(invoiceBalanceDue)} open` : 'No open balance'} />
        <StatTile href="#customer-jobs" label="Jobs" value={detail.jobs.length} help={detail.jobs.some((job) => job.status !== 'completed') ? 'Active production' : 'No active job'} />
        <StatTile href="#customer-payments" label="Payments" value={formatMoney(netPaid)} help={`${detail.payments.length} recorded`} />
        <StatTile href={lead.phone ? `/sms?leadId=${lead.id}` : '#customer-messages'} label="Messages" value={messagesCount} help="Text and email history" />
        <StatTile href="#customer-photos" label="Photos" value={allPhotos.length} help="Estimate and job media" />
      </section>

      <section className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,1fr)]">
        <div className="space-y-5">
          <SectionCard id="customer-estimates" title="Estimates">
            <EstimatesList
              estimates={detail.estimates}
              payments={detail.payments}
              onCancel={cancelEstimate}
              onAgreementAction={agreementAction}
              onRecordPayment={openPaymentModal}
            />
          </SectionCard>

          <SectionCard id="customer-invoices" title="Invoices" eyebrow={invoiceBalanceDue > 0 ? `${formatMoney(invoiceBalanceDue)} open` : `${invoices.length} total`}>
            <InvoicesList invoices={invoices} onRecordPayment={openInvoicePaymentModal} />
          </SectionCard>

          <SectionCard id="customer-jobs" title="Jobs">
            {detail.jobs.length === 0 ? (
              <EmptySection>No jobs yet. Accepted estimates will become production work here.</EmptySection>
            ) : detail.jobs.map((job) => (
              <Link key={job.id} to={`/jobs/${job.id}`} className="block border-b p-4 last:border-b-0 hover:bg-gray-50">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      {job.jobNumber && <span className="pf-status pf-status-neutral pf-status-sm">{job.jobNumber}</span>}
                      <p className="pf-row-title truncate">{job.name || 'Job'}</p>
                    </div>
                    {jobAddress(job) && <p className="pf-copy mt-1 truncate">{jobAddress(job)}</p>}
                    <p className="pf-meta mt-1">Created {formatDate(job.createdAt)}{job.completedAt ? ` - Completed ${formatDate(job.completedAt)}` : ''}</p>
                  </div>
                  <div className="sm:text-right">
                    <StatusBadge status={String(job.status || 'scheduled')} />
                    <p className="pf-row-title mt-1">{job.budget == null ? 'No budget' : formatMoney(job.budget)}</p>
                  </div>
                </div>
              </Link>
            ))}
          </SectionCard>

          <SectionCard id="customer-photos" title="Photos">
            {allPhotos.length === 0 ? (
              <EmptySection>No site or job photos yet.</EmptySection>
            ) : (
              <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-4">
                {allPhotos.slice(0, 12).map((photo, index) => {
                  const src = photoSrc(photo, photo.source);
                  return (
                    <a key={`${photo.source}-${photo.id || index}`} href={src} target="_blank" rel="noreferrer" className="overflow-hidden rounded-lg border bg-gray-50">
                      <div className="aspect-[4/3] bg-gray-100">
                        {src ? <img src={src} alt={`${photo.source} photo`} className="h-full w-full object-cover" loading="lazy" /> : <div className="pf-meta flex h-full items-center justify-center p-3 text-center">Photo preview unavailable</div>}
                      </div>
                      <div className="p-2">
                        <p className="pf-meta">{photo.source} photo</p>
                        <p className="pf-meta">{formatDate(photo.createdAt)}</p>
                      </div>
                    </a>
                  );
                })}
              </div>
            )}
          </SectionCard>
        </div>

        <aside className="space-y-5">
          <SectionCard title="Follow-Up">
            <ul className="space-y-2 p-4">
              {followUps(detail).map((item) => <li key={item} className="pf-copy">{item}</li>)}
            </ul>
          </SectionCard>

          <SectionCard title="Activities">
            <form className="space-y-3 border-b p-4" onSubmit={submitActivity}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Select
                  aria-label="Activity type"
                  value={activityForm.type}
                  onChange={(event) => setActivityForm({ ...activityForm, type: event.target.value })}
                  options={activityTypeOptions}
                />
                <Input
                  aria-label="Due date"
                  type="datetime-local"
                  value={activityForm.dueAt}
                  onChange={(event) => setActivityForm({ ...activityForm, dueAt: event.target.value })}
                />
              </div>
              <Input
                aria-label="Next action"
                placeholder="Next action"
                required
                maxLength={255}
                value={activityForm.title}
                onChange={(event) => setActivityForm({ ...activityForm, title: event.target.value })}
              />
              <Textarea
                aria-label="Activity notes"
                placeholder="Notes"
                rows={2}
                value={activityForm.notes}
                onChange={(event) => setActivityForm({ ...activityForm, notes: event.target.value })}
              />
              <div className="flex justify-end">
                <Button size="sm" type="submit" isLoading={isSavingActivity} disabled={!activityForm.title.trim()}>Save activity</Button>
              </div>
            </form>
            <ActivityList activities={detail.activities || []} onComplete={completeActivity} />
          </SectionCard>

          <SectionCard id="customer-emails" title="Emails" eyebrow={`${detail.emailSends?.length || 0} sent`}>
            <EmailList emails={detail.emailSends || []} />
          </SectionCard>

          <SectionCard id="customer-payments" title="Payments" eyebrow={`${detail.payments.length} recorded`}>
            <PaymentList payments={detail.payments} onRefund={(payment) => setRefundForm({ payment, amount: paymentNet(payment).toFixed(2), reason: '', method: 'check', reference: '', confirmManualRefund: false })} />
          </SectionCard>

          <SectionCard id="customer-messages" title="Messages" action={lead.phone ? <Link to={`/sms?leadId=${lead.id}`} className="btn-secondary btn-sm">Open thread</Link> : undefined}>
            <MessageList messages={detail.messages} />
          </SectionCard>

          <SectionCard title="Activity Log">
            <AuditActivityList activity={auditActivity} lead={lead} />
          </SectionCard>
        </aside>
      </section>

      {paymentForm && (
        <Modal title="Record payment" onClose={() => setPaymentForm(null)}>
          <form className="space-y-4" onSubmit={submitPayment}>
            <p className="pf-copy">Record cash, check, ACH, or other offline payment. This will not create a Stripe charge.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Amount" type="number" min="0.01" step="0.01" inputMode="decimal" value={paymentForm.amount} onChange={(event) => setPaymentForm({ ...paymentForm, amount: event.target.value })} />
              <Select label="Source" value={paymentForm.source} onChange={(event) => setPaymentForm({ ...paymentForm, source: event.target.value as PaymentForm['source'] })} options={[
                { value: 'check', label: 'Check' },
                { value: 'cash', label: 'Cash' },
                { value: 'ach', label: 'ACH' },
                { value: 'other', label: 'Other' },
              ]} />
            </div>
            <Input label="Reference" value={paymentForm.reference} onChange={(event) => setPaymentForm({ ...paymentForm, reference: event.target.value })} placeholder="Check number or note" />
            <Input label="Received" type="datetime-local" value={paymentForm.receivedAt} onChange={(event) => setPaymentForm({ ...paymentForm, receivedAt: event.target.value })} />
            <Textarea label="Description" rows={2} value={paymentForm.description} onChange={(event) => setPaymentForm({ ...paymentForm, description: event.target.value })} />
            {!paymentForm.confirmAdditionalPayment && (
              <label className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <input type="checkbox" className="mt-1" checked={paymentForm.confirmAdditionalPayment} onChange={(event) => setPaymentForm({ ...paymentForm, confirmAdditionalPayment: event.target.checked })} />
                <span>This item already has payment history. I confirm this is an additional payment and not a duplicate entry.</span>
              </label>
            )}
            <div className="mobile-sticky-actions flex gap-3 pt-4 sm:static sm:m-0 sm:border-0 sm:bg-transparent sm:p-0">
              <Button type="button" variant="secondary" fullWidth onClick={() => setPaymentForm(null)}>Cancel</Button>
              <Button type="submit" fullWidth isLoading={isSavingPayment} disabled={!paymentForm.amount || !paymentForm.confirmAdditionalPayment}>Record payment</Button>
            </div>
          </form>
        </Modal>
      )}

      {refundForm && (
        <Modal title="Issue refund" onClose={() => setRefundForm(null)}>
          <form className="space-y-4" onSubmit={submitRefund}>
            {isStripePayment(refundForm.payment) ? (
              <p className="pf-copy">This payment has a Stripe reference. Crewmodo will request the refund through Stripe and record the result in payment history.</p>
            ) : (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="pf-row-title text-amber-950">Manual refund or credit</p>
                <p className="pf-copy mt-1 text-amber-900">Crewmodo records the ledger adjustment only. Issue the cash, check, ACH, or credit outside Crewmodo, then record how it was handled here.</p>
              </div>
            )}
            <Input label="Amount" type="number" min="0.01" max={paymentNet(refundForm.payment).toFixed(2)} step="0.01" inputMode="decimal" value={refundForm.amount} onChange={(event) => setRefundForm({ ...refundForm, amount: event.target.value })} />
            {!isStripePayment(refundForm.payment) && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Select label="How was it handled?" value={refundForm.method} onChange={(event) => setRefundForm({ ...refundForm, method: event.target.value as RefundForm['method'] })}>
                  <option value="check">Check</option>
                  <option value="cash">Cash</option>
                  <option value="ach">ACH</option>
                  <option value="credit">Account credit</option>
                  <option value="other">Other</option>
                </Select>
                <Input label="Reference" value={refundForm.reference} onChange={(event) => setRefundForm({ ...refundForm, reference: event.target.value })} placeholder="Check #, ACH memo, or credit note" />
              </div>
            )}
            <Textarea label="Reason" rows={3} value={refundForm.reason} onChange={(event) => setRefundForm({ ...refundForm, reason: event.target.value })} placeholder="Reason, credit, or damage note" required={!isStripePayment(refundForm.payment)} />
            {!isStripePayment(refundForm.payment) && (
              <label className="flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
                <input type="checkbox" className="mt-1" checked={refundForm.confirmManualRefund} onChange={(event) => setRefundForm({ ...refundForm, confirmManualRefund: event.target.checked })} />
                <span>I confirm this money or credit was handled outside Stripe and should reduce this customer&apos;s recorded balance.</span>
              </label>
            )}
            <div className="mobile-sticky-actions flex gap-3 pt-4 sm:static sm:m-0 sm:border-0 sm:bg-transparent sm:p-0">
              <Button type="button" variant="secondary" fullWidth onClick={() => setRefundForm(null)}>Cancel</Button>
              <Button type="submit" variant="danger" fullWidth isLoading={isSavingRefund} disabled={!refundForm.amount || (!isStripePayment(refundForm.payment) && (!refundForm.reason.trim() || !refundForm.confirmManualRefund))}>{isStripePayment(refundForm.payment) ? 'Issue refund' : 'Record refund'}</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function StatTile({ href, label, value, help }: { href: string; label: string; value: string | number; help: string }) {
  return (
    <Link to={href} className="block rounded-lg border bg-white p-4 shadow-sm hover:border-blue-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500">
      <p className="pf-metric-label">{label}</p>
      <p className="pf-metric-value mt-1">{value}</p>
      <p className="pf-meta mt-1">{help}</p>
    </Link>
  );
}

function SectionCard({ id, title, eyebrow, action, children }: { id?: string; title: string; eyebrow?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 rounded-lg border bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b p-4">
        <h3 className="pf-section-title">{title}</h3>
        {action || (eyebrow ? <span className="pf-meta">{eyebrow}</span> : null)}
      </div>
      {children}
    </section>
  );
}

function EmptySection({ children }: { children: React.ReactNode }) {
  return <div className="p-5"><p className="pf-copy">{children}</p></div>;
}

function EstimatesList({ estimates, payments, onCancel, onAgreementAction, onRecordPayment }: {
  estimates: Estimate[];
  payments: Payment[];
  onCancel: (estimate: Estimate) => void;
  onAgreementAction: (estimate: Estimate, actionName: 'revise' | 'void') => void;
  onRecordPayment: (estimate: Estimate) => void;
}) {
  const [openEstimateMenuId, setOpenEstimateMenuId] = useState<string | null>(null);

  async function copyPreviewLink(estimate: Estimate) {
    const href = estimate.customerPreviewUrl || estimate.publicUrl || `/estimates/${estimate.id}`;
    const link = new URL(href, window.location.origin).href;
    const copied = await navigator.clipboard?.writeText(link).then(() => true).catch(() => false);
    window.showToast?.(copied ? 'Estimate preview link copied' : 'Select the link and copy it manually', copied ? 'success' : 'error');
    setOpenEstimateMenuId(null);
  }

  if (!estimates.length) return <EmptySection>No estimates yet.</EmptySection>;
  return (
    <div className="divide-y">
      {estimates.map((estimate) => {
        const status = String(estimate.status || 'draft');
        const signed = Boolean(estimate.signedAt) || status === 'accepted';
        const canEdit = ['draft', 'sent'].includes(status) && !signed;
        const canCancel = ['draft', 'sent', 'declined'].includes(status) && !signed;
        const inactive = ['draft', 'canceled', 'voided', 'superseded'].includes(status);
        const canPreview = !['draft', 'canceled'].includes(status);
        const paid = payments.filter((payment) => payment.estimateId === estimate.id).reduce((sum, payment) => sum + paymentNet(payment), 0);
        const balance = Math.max(estimateContractTotal(estimate) - paid, 0);
        return (
          <div key={estimate.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 p-3 sm:p-4">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <p className="pf-row-title shrink-0">{formatMoney(estimateContractTotal(estimate))}</p>
                <StatusBadge status={status} />
              </div>
              <div className="pf-meta mt-1 space-y-0.5 leading-5">
                {estimate.createdAt && <p>Created {formatDate(estimate.createdAt, true)}</p>}
                {estimate.sentAt && <p>Sent {formatDate(estimate.sentAt, true)}</p>}
                {estimate.signedAt && <p>Accepted {formatDate(estimate.signedAt, true)}</p>}
                {estimate.clientViewedAt && <p>Client viewed {formatDate(estimate.clientViewedAt, true)}{estimate.clientViewCount ? ` (${estimate.clientViewCount} views)` : ''}</p>}
              </div>
            </div>
            <div className="flex shrink-0 items-center justify-end gap-1">
              <Link to={`/estimates/${estimate.id}/details`} className="btn-text btn-sm">View details</Link>
              <div className="relative">
                <button
                  type="button"
                  className="btn-icon btn-icon-tonal"
                  aria-label="More estimate actions"
                  aria-expanded={openEstimateMenuId === estimate.id}
                  title="More actions"
                  onClick={() => setOpenEstimateMenuId(openEstimateMenuId === estimate.id ? null : estimate.id)}
                >
                  <Icon name="more-horizontal" className="pf-icon" />
                </button>
                {openEstimateMenuId === estimate.id && (
                  <div className="absolute right-0 z-30 mt-2 w-48 rounded-lg border bg-white p-1 shadow-lg" role="menu">
                    {canPreview && <button type="button" className="btn-text btn-sm w-full justify-start" onClick={() => copyPreviewLink(estimate)}>Copy preview link</button>}
                    {canEdit && <Link to={`/estimates/production?estimateId=${estimate.id}`} className="btn-text btn-sm w-full justify-start" onClick={() => setOpenEstimateMenuId(null)}>{status === 'sent' ? 'Edit sent' : 'Edit draft'}</Link>}
                    {!inactive && balance > 0.005 && <button type="button" className="btn-text btn-sm w-full justify-start" onClick={() => { setOpenEstimateMenuId(null); onRecordPayment(estimate); }}>Record payment</button>}
                    {signed && status !== 'voided' && status !== 'superseded' && <button type="button" className="btn-text btn-sm w-full justify-start" onClick={() => { setOpenEstimateMenuId(null); onAgreementAction(estimate, 'revise'); }}>Create revision</button>}
                    {signed && status !== 'voided' && status !== 'superseded' && <button type="button" className="btn-text btn-sm w-full justify-start text-red-700" onClick={() => { setOpenEstimateMenuId(null); onAgreementAction(estimate, 'void'); }}>Void agreement</button>}
                    {canCancel && <button type="button" className="btn-text btn-sm w-full justify-start text-red-700" onClick={() => { setOpenEstimateMenuId(null); onCancel(estimate); }}>Cancel</button>}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ActivityList({ activities, onComplete }: { activities: Activity[]; onComplete: (id: string) => void }) {
  if (!activities.length) return <EmptySection>No planned activities yet.</EmptySection>;
  return (
    <div className="divide-y">
      {activities.map((activity) => (
        <div key={activity.id} className="flex items-start justify-between gap-3 p-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="pf-row-title">{activity.title || labelize(activity.type)}</p>
              <StatusBadge status={String(activity.status || 'open')} />
            </div>
            <p className="pf-meta mt-1">{labelize(activity.type)} - {activity.dueAt ? `Due ${formatDate(activity.dueAt, true)}` : 'No due date'}</p>
            {activity.notes && <p className="pf-copy mt-2">{activity.notes}</p>}
          </div>
          {activity.status === 'open' && <Button type="button" variant="secondary" size="sm" onClick={() => onComplete(activity.id)}>Done</Button>}
        </div>
      ))}
    </div>
  );
}

function EmailList({ emails }: { emails: EmailSend[] }) {
  if (!emails.length) return <EmptySection>No email history yet.</EmptySection>;
  return (
    <div className="max-h-[520px] divide-y overflow-auto">
      {emails.map((email) => (
        <details key={email.id} className="p-4">
          <summary className="cursor-pointer list-none">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="pf-row-title">{email.subject || 'Email'}</p>
                  <StatusBadge status={String(email.status || 'sent')} />
                </div>
                <p className="pf-meta mt-1">{email.templateName || 'Email'} - Sent {formatDate(email.sentAt)} to {email.toEmail}</p>
                {email.previewText && <p className="pf-copy mt-1">{email.previewText}</p>}
              </div>
              <span className="btn-text btn-sm pointer-events-none">View email</span>
            </div>
          </summary>
          <div className="mt-3 rounded-lg border bg-gray-50 p-2">
            <iframe title="Sent email preview" className="h-80 w-full rounded-md bg-white" sandbox="" srcDoc={email.renderedHtml || '<p>Email preview unavailable.</p>'} />
          </div>
        </details>
      ))}
    </div>
  );
}

function InvoicesList({ invoices, onRecordPayment }: { invoices: CustomerInvoice[]; onRecordPayment: (invoice: CustomerInvoice) => void }) {
  if (!invoices.length) return <EmptySection>No invoices yet.</EmptySection>;
  return (
    <div className="divide-y">
      {invoices.map((invoice) => {
        const total = Number(invoice.total || 0);
        const paid = invoicePaid(invoice);
        const balance = invoiceBalance(invoice);
        const isOpen = balance > 0.005 && !['paid', 'voided', 'canceled'].includes(String(invoice.status || ''));
        return (
          <div key={invoice.id} className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <p className="pf-row-title truncate">{invoice.invoiceNumber || 'Invoice'}</p>
                <StatusBadge status={String(invoice.status || 'sent')} />
              </div>
              <p className="pf-copy mt-1 truncate">{invoice.description || 'Customer invoice'}</p>
              <div className="pf-meta mt-1 space-y-0.5 leading-5">
                <p>{invoice.dueLabel || (invoice.dueDate ? `Due ${formatDate(invoice.dueDate)}` : 'Due on receipt')}</p>
                <p>Sent {formatDate(invoice.sentAt || invoice.createdAt, true)}</p>
                {invoice.paidAt && <p>Paid {formatDate(invoice.paidAt, true)}</p>}
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-end sm:justify-center">
              <div className="text-right">
                <p className="pf-row-title">{formatMoney(balance)}</p>
                <p className="pf-meta">{formatMoney(paid)} paid of {formatMoney(total)}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Link to={`/invoices/${invoice.id}`} className="btn-secondary btn-sm">View invoice</Link>
                {isOpen && <Button type="button" size="sm" onClick={() => onRecordPayment(invoice)}>Record payment</Button>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PaymentList({ payments, onRefund }: { payments: Payment[]; onRefund: (payment: Payment) => void }) {
  if (!payments.length) return <EmptySection>No payment history yet.</EmptySection>;
  return (
    <div className="max-h-[520px] divide-y overflow-auto">
      {payments.map((payment) => {
        const amount = Number(payment.amount || 0);
        const refunded = Number(payment.refundedAmount || 0);
        const refundable = paymentNet(payment);
        return (
          <details key={payment.id} className="p-4">
            <summary className="cursor-pointer list-none">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="pf-row-title">{formatMoney(amount)}</p>
                    <StatusBadge status={String(payment.status || 'succeeded')} />
                  </div>
                  <p className="pf-meta mt-1">{payment.description || 'Customer payment'} - {formatDate(payment.receivedAt)}</p>
                  {refunded > 0 && <p className="pf-copy mt-1 text-red-700">{formatMoney(refunded)} refunded</p>}
                </div>
                <span className="btn-text btn-sm pointer-events-none">{refundable > 0 ? 'Refund' : 'View'}</span>
              </div>
            </summary>
            <div className="mt-3 rounded-lg border bg-gray-50 p-3">
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div><dt className="pf-meta">Paid</dt><dd className="pf-row-title">{formatMoney(amount)}</dd></div>
                <div><dt className="pf-meta">Refundable</dt><dd className="pf-row-title">{formatMoney(refundable)}</dd></div>
                <div><dt className="pf-meta">Source</dt><dd className="pf-row-title">{labelize(payment.source || payment.method || 'stripe')}</dd></div>
                <div><dt className="pf-meta">Payment ID</dt><dd className="font-mono text-xs">{payment.id.slice(0, 8)}</dd></div>
              </dl>
              {refundable > 0 && <Button variant="secondary" size="sm" className="mt-4 text-red-700" onClick={() => onRefund(payment)}>Issue refund</Button>}
            </div>
          </details>
        );
      })}
    </div>
  );
}

function MessageList({ messages }: { messages: Message[] }) {
  if (!messages.length) return <EmptySection>No message history yet.</EmptySection>;
  return (
    <div className="max-h-[420px] divide-y overflow-auto">
      {messages.map((message) => (
        <div key={message.id} className="p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="pf-row-title">{message.direction === 'inbound' ? 'Customer' : 'Team'} message</p>
            <p className="pf-meta">{formatDate(message.createdAt)}</p>
          </div>
          <p className="pf-copy mt-1">{message.body || 'No body'}</p>
        </div>
      ))}
    </div>
  );
}

function AuditActivityList({ activity, lead }: { activity: Activity[]; lead: Lead }) {
  const items = activity.length ? activity : [
    { id: 'created', action: 'lead.created', createdAt: lead.createdAt },
    ...(lead.updatedAt && lead.updatedAt !== lead.createdAt ? [{ id: 'updated', action: 'lead.updated', createdAt: lead.updatedAt }] : []),
  ];
  return (
    <div className="p-4">
      <ActivityTimeline
        items={items.map((item, index) => ({
          id: item.id,
          title: labelize(String(item.action || item.type || 'Activity').replace(/\./g, ' ')),
          meta: formatDate(item.createdAt),
          tone: index === 0 ? 'info' : 'default',
        }))}
      />
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="mobile-sheet fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="customer-modal-title" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-lg bg-white p-5 shadow-xl sm:rounded-lg sm:p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 id="customer-modal-title" className="pf-section-title">{title}</h3>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>Close</Button>
        </div>
        {children}
      </div>
    </div>
  );
}
