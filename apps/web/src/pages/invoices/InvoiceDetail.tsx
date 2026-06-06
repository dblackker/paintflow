import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { ActivityTimeline, type ActivityTimelineItem } from '@/components/ActivityTimeline';
import { StatusBadge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card, CardContent, CardHeader } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { Input, Select, Textarea } from '@/components/Input';
import { apiJson, formatAddress, formatMoney, formatPhone, labelize } from '@/lib/api';

interface Payment {
  id: string;
  amount?: string | number | null;
  refundedAmount?: string | number | null;
  source?: string | null;
  status?: string | null;
  description?: string | null;
  receivedAt?: string | null;
  refundedAt?: string | null;
  stripeCheckoutSessionId?: string | null;
  stripePaymentIntentId?: string | null;
  stripeChargeId?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

interface InvoiceLineItem {
  description?: string;
  quantity?: string | number | null;
  unitPrice?: string | number | null;
  total?: string | number | null;
  category?: string | null;
}

interface CustomerInvoiceDetail {
  id: string;
  leadId: string;
  jobId?: string | null;
  invoiceNumber?: string | null;
  description?: string | null;
  lineItems?: InvoiceLineItem[] | null;
  subtotal?: string | number | null;
  tax?: string | number | null;
  total?: string | number | null;
  status?: string | null;
  dueDate?: string | null;
  dueLabel?: string | null;
  reminderCadence?: string | null;
  note?: string | null;
  sentAt?: string | null;
  paidAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  leadName?: string | null;
  leadEmail?: string | null;
  leadPhone?: string | null;
  leadStreetAddress?: string | null;
  leadCity?: string | null;
  leadState?: string | null;
  leadPostalCode?: string | null;
  jobName?: string | null;
  jobNumber?: string | null;
  jobStreetAddress?: string | null;
  jobCity?: string | null;
  jobState?: string | null;
  jobPostalCode?: string | null;
  orgName?: string | null;
  payments?: Payment[];
}

interface ManualPaymentForm {
  amount: string;
  source: 'cash' | 'check' | 'ach' | 'other';
  reference: string;
  description: string;
  sendReceipt: boolean;
}

const emptyManualPaymentForm: ManualPaymentForm = {
  amount: '',
  source: 'check',
  reference: '',
  description: '',
  sendReceipt: true,
};

function numberValue(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function netPayment(payment: Payment) {
  if (!isCompletedPayment(payment)) return 0;
  return Math.max(numberValue(payment.amount) - numberValue(payment.refundedAmount), 0);
}

function formatDate(value?: string | null, withTime = false) {
  if (!value) return 'Not set';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not set';
  return date.toLocaleString('en-US', withTime
    ? { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }
    : { month: 'short', day: 'numeric', year: 'numeric' });
}

function reminderCopy(value?: string | null) {
  if (value === 'none') return 'No automatic reminder';
  if (value === 'three_days_before') return 'Reminder 3 days before due date';
  if (value === 'weekly') return 'Weekly reminder until paid';
  return 'Reminder on due date';
}

function paymentSourceLabel(source?: string | null) {
  if (source === 'ach') return 'ACH';
  if (source === 'stripe') return 'Card';
  return labelize(source || 'payment');
}

function metadataString(payment: Payment, key: string) {
  const value = payment.metadata?.[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function paymentReference(payment: Payment) {
  return metadataString(payment, 'reference')
    || payment.stripeChargeId
    || payment.stripePaymentIntentId
    || payment.stripeCheckoutSessionId
    || null;
}

function isCompletedPayment(payment: Payment) {
  return ['succeeded', 'paid', 'partially_refunded', 'refunded'].includes(String(payment.status || ''));
}

function latestRefundAt(payment: Payment) {
  const history = Array.isArray(payment.metadata?.refundHistory) ? payment.metadata.refundHistory : [];
  const latest = history
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    .map((item) => typeof item.recordedAt === 'string' ? item.recordedAt : null)
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0];
  return payment.refundedAt || latest || payment.updatedAt || payment.receivedAt;
}

export function InvoiceDetail() {
  const { id } = useParams<{ id: string }>();
  const [invoice, setInvoice] = useState<CustomerInvoiceDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSendingReminder, setIsSendingReminder] = useState(false);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentForm, setPaymentForm] = useState<ManualPaymentForm>(emptyManualPaymentForm);
  const [isRecordingPayment, setIsRecordingPayment] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null);
  const [isSendingReceipt, setIsSendingReceipt] = useState(false);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [isCanceling, setIsCanceling] = useState(false);
  const [error, setError] = useState('');

  async function loadInvoice() {
    if (!id) return;
    setIsLoading(true);
    setError('');
    try {
      const payload = await apiJson<{ data?: CustomerInvoiceDetail }>(`/v1/invoices/customer/${id}`);
      setInvoice(payload.data || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load invoice');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadInvoice();
  }, [id]);

  useEffect(() => {
    document.body.classList.toggle('pf-modal-open', cancelModalOpen || paymentModalOpen || Boolean(selectedPayment));
    return () => document.body.classList.remove('pf-modal-open');
  }, [cancelModalOpen, paymentModalOpen, selectedPayment]);

  async function sendReminder() {
    if (!invoice?.id) return;
    setIsSendingReminder(true);
    try {
      await apiJson(`/v1/invoices/customer/${invoice.id}/send-reminder`, {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      });
      window.showToast?.('Payment reminder sent', 'success');
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to send reminder', 'error');
    } finally {
      setIsSendingReminder(false);
    }
  }

  function openPaymentModal() {
    if (!invoice) return;
    setPaymentForm({
      ...emptyManualPaymentForm,
      amount: balance.toFixed(2),
      description: `${invoice.invoiceNumber || 'Invoice'} payment`,
      sendReceipt: true,
    });
    setPaymentModalOpen(true);
  }

  function closePaymentModal() {
    if (isRecordingPayment) return;
    setPaymentModalOpen(false);
    setPaymentForm(emptyManualPaymentForm);
  }

  async function recordManualPayment(event: FormEvent) {
    event.preventDefault();
    if (!invoice?.id || isRecordingPayment) return;

    const amount = numberValue(paymentForm.amount);
    if (amount <= 0) {
      window.showToast?.('Enter a payment amount greater than $0.00.', 'error');
      return;
    }
    if (amount > balance + 0.005) {
      window.showToast?.(`Payment cannot exceed the open balance of ${formatMoney(balance)}.`, 'error');
      return;
    }

    const confirmAdditionalPayment = paid > 0.005;
    if (confirmAdditionalPayment) {
      const confirmed = window.confirm(`This invoice already has ${formatMoney(paid)} recorded. Confirm this is an additional payment and not a duplicate.`);
      if (!confirmed) return;
    }

    setIsRecordingPayment(true);
    try {
      await apiJson('/v1/payments/manual', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          invoiceId: invoice.id,
          amount,
          source: paymentForm.source,
          reference: paymentForm.reference || null,
          description: paymentForm.description || null,
          confirmAdditionalPayment,
          sendReceipt: paymentForm.sendReceipt,
        }),
      });
      window.showToast?.(paymentForm.sendReceipt ? 'Payment recorded and receipt queued' : 'Payment recorded', 'success');
      setPaymentModalOpen(false);
      setPaymentForm(emptyManualPaymentForm);
      await loadInvoice();
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to record payment', 'error');
    } finally {
      setIsRecordingPayment(false);
    }
  }

  async function sendPaymentReceipt(payment: Payment) {
    if (!invoice?.id || isSendingReceipt) return;
    setIsSendingReceipt(true);
    try {
      await apiJson(`/v1/invoices/customer/${invoice.id}/payments/${payment.id}/send-receipt`, {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      });
      window.showToast?.('Receipt sent', 'success');
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to send receipt', 'error');
    } finally {
      setIsSendingReceipt(false);
    }
  }

  function closeCancelModal() {
    if (isCanceling) return;
    setCancelModalOpen(false);
    setCancelReason('');
  }

  async function cancelInvoice(event: FormEvent) {
    event.preventDefault();
    if (!invoice?.id) return;
    setIsCanceling(true);
    try {
      const response = await apiJson<{ data?: CustomerInvoiceDetail & { emailSent?: boolean } }>(`/v1/invoices/customer/${invoice.id}/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({ reason: cancelReason.trim() || null }),
      });
      window.showToast?.(response.data?.emailSent ? 'Invoice canceled and customer emailed' : 'Invoice canceled', 'success');
      setCancelModalOpen(false);
      setCancelReason('');
      await loadInvoice();
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to cancel invoice', 'error');
    } finally {
      setIsCanceling(false);
    }
  }

  const payments = invoice?.payments || [];
  const paid = useMemo(() => payments.reduce((sum, payment) => sum + netPayment(payment), 0), [payments]);
  const total = numberValue(invoice?.total);
  const balance = Math.max(total - paid, 0);
  const isRefundedInvoice = String(invoice?.status || '') === 'refunded';
  const collectibleBalance = isRefundedInvoice ? 0 : balance;
  const isOpen = invoice && collectibleBalance > 0.005 && !['paid', 'refunded', 'voided', 'canceled'].includes(String(invoice.status || ''));
  const lineItems = Array.isArray(invoice?.lineItems) ? invoice.lineItems : [];
  const invoiceAddress = invoice ? formatAddress({
    streetAddress: invoice.jobStreetAddress || invoice.leadStreetAddress,
    city: invoice.jobCity || invoice.leadCity,
    state: invoice.jobState || invoice.leadState,
    postalCode: invoice.jobPostalCode || invoice.leadPostalCode,
  }) : '';
  const activity = useMemo<ActivityTimelineItem[]>(() => {
    if (!invoice) return [];
    const items: Array<ActivityTimelineItem & { sortAt?: string | null }> = [];
    const completedPayments = payments.filter(isCompletedPayment);
    if (completedPayments.length) {
      completedPayments.forEach((payment) => {
        const gross = numberValue(payment.amount);
        const refunded = numberValue(payment.refundedAmount);
        items.push({
          id: `payment-${payment.id}`,
          title: gross >= total - 0.005 ? `Payment received in full | ${formatMoney(gross)}` : `Payment received | ${formatMoney(gross)}`,
          meta: formatDate(payment.receivedAt, true),
          description: `${formatMoney(gross)} recorded from ${invoice.leadName || 'customer'} via ${paymentSourceLabel(payment.source)}${refunded > 0.005 ? `, with ${formatMoney(refunded)} later refunded` : ''}`,
          tone: 'success',
          sortAt: payment.receivedAt,
        });
        if (refunded > 0.005) {
          const fullyRefunded = refunded >= gross - 0.005;
          items.push({
            id: `refund-${payment.id}`,
            title: fullyRefunded ? `Payment refunded | ${formatMoney(refunded)}` : `Partial refund | ${formatMoney(refunded)}`,
            meta: formatDate(latestRefundAt(payment), true),
            description: `${formatMoney(refunded)} returned or credited against the ${paymentSourceLabel(payment.source)} payment`,
            tone: fullyRefunded ? 'danger' : 'warning',
            sortAt: latestRefundAt(payment),
          });
        }
      });
    }
    if (invoice.dueDate) {
      const isRefunded = String(invoice.status || '') === 'refunded';
      items.push({
        id: 'invoice-due',
        title: isRefunded ? 'Invoice closed after refund' : balance > 0.005 && new Date(invoice.dueDate).getTime() < Date.now() ? 'Invoice overdue' : 'Invoice due',
        meta: formatDate(invoice.dueDate),
        description: isRefunded ? 'No payment is collectible on this refunded invoice' : balance > 0.005 ? `${formatMoney(balance)} open balance` : 'No balance remaining',
        tone: isRefunded ? 'danger' : balance > 0.005 && new Date(invoice.dueDate).getTime() < Date.now() ? 'danger' : balance > 0.005 ? 'warning' : 'success',
        sortAt: invoice.dueDate,
      });
    }
    if (invoice.sentAt) {
      items.push({
        id: 'invoice-sent',
        title: `Invoice sent${invoice.leadName ? ` to ${invoice.leadName}` : ''}`,
        meta: formatDate(invoice.sentAt, true),
        tone: 'info',
        sortAt: invoice.sentAt,
      });
    }
    if (invoice.createdAt) {
      items.push({
        id: 'invoice-created',
        title: 'Invoice created',
        meta: formatDate(invoice.createdAt, true),
        tone: 'default',
        sortAt: invoice.createdAt,
      });
    }
    return items.sort((a, b) => {
      const dateA = Date.parse(a.sortAt || a.meta || '') || 0;
      const dateB = Date.parse(b.sortAt || b.meta || '') || 0;
      return dateB - dateA;
    }).map(({ sortAt: _sortAt, ...item }) => item);
  }, [balance, invoice, payments, total]);

  if (isLoading) {
    return (
      <main className="mx-auto max-w-5xl space-y-5 pb-24">
        <Card>
          <CardContent className="p-8 text-center text-gray-500">Loading invoice...</CardContent>
        </Card>
      </main>
    );
  }

  if (error || !invoice) {
    return (
      <main className="mx-auto max-w-5xl space-y-5 pb-24">
        <Card>
          <CardContent className="p-8 text-center">
            <Icon name="warning" className="mx-auto h-6 w-6 text-red-600" />
            <p className="pf-copy mt-2 text-red-700">{error || 'Invoice not found'}</p>
            <Button as="a" href="/invoices" variant="secondary" size="sm" className="mt-4">Back to invoices</Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl space-y-5 pb-24">
      <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="pf-kicker">Invoice</p>
              <StatusBadge status={invoice.status || 'sent'} />
            </div>
            <h1 className="pf-page-title mt-1 truncate">{invoice.invoiceNumber || 'Invoice'}</h1>
            <p className="pf-page-copy mt-1">{invoice.description || 'Customer invoice'}</p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:min-w-64">
            <div className="rounded-lg bg-gray-50 p-3">
              <p className="pf-metric-label">Total</p>
              <p className="pf-row-title">{formatMoney(total)}</p>
            </div>
            <div className={isRefundedInvoice ? 'rounded-lg bg-red-50 p-3' : 'rounded-lg bg-amber-50 p-3'}>
              <p className={isRefundedInvoice ? 'pf-metric-label text-red-800' : 'pf-metric-label text-amber-800'}>{isRefundedInvoice ? 'Collectible balance' : 'Balance'}</p>
              <p className={isRefundedInvoice ? 'pf-row-title text-red-950' : 'pf-row-title text-amber-950'}>{formatMoney(collectibleBalance)}</p>
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {isOpen && (
            <Button type="button" size="sm" onClick={openPaymentModal}>
              Mark paid manually
            </Button>
          )}
          {isOpen && (
            <Button type="button" size="sm" leftIcon={<Icon name="mail" className="h-4 w-4" />} isLoading={isSendingReminder} onClick={sendReminder}>
              Send reminder
            </Button>
          )}
          <Button as="a" href={`/leads/${invoice.leadId}`} variant="secondary" size="sm">Open customer</Button>
          {invoice.jobId && <Button as="a" href={`/jobs/${invoice.jobId}`} variant="secondary" size="sm">Open job</Button>}
          {isOpen && (
            <Button type="button" variant="dangerSubtle" size="sm" onClick={() => setCancelModalOpen(true)}>
              Cancel invoice
            </Button>
          )}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          <Card padding="none">
            <CardHeader className="mb-0 border-b border-gray-200 px-4 py-3 sm:px-5" title="Line items" />
            <CardContent className="p-4">
              {lineItems.length ? (
                <div className="space-y-2">
                  {lineItems.map((item, index) => (
                    <div key={`${item.description}-${index}`} className="grid gap-2 rounded-lg border border-gray-200 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                      <div className="min-w-0">
                        <p className="pf-row-title truncate">{item.description || 'Invoice item'}</p>
                        <p className="pf-helper">
                          {numberValue(item.quantity || 1).toLocaleString('en-US')} x {formatMoney(item.unitPrice)}
                          {item.category ? ` | ${labelize(item.category)}` : ''}
                        </p>
                      </div>
                      <p className="pf-row-title sm:text-right">{formatMoney(item.total)}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="pf-copy text-gray-500">No line items were saved for this invoice.</p>
              )}
              <div className="mt-4 space-y-2 rounded-lg bg-gray-50 p-3">
                <div className="flex justify-between gap-3"><span className="pf-copy">Subtotal</span><span className="pf-row-title">{formatMoney(invoice.subtotal)}</span></div>
                <div className="flex justify-between gap-3"><span className="pf-copy">Tax</span><span className="pf-row-title">{formatMoney(invoice.tax)}</span></div>
                <div className="flex justify-between gap-3 border-t border-gray-200 pt-2"><span className="pf-copy font-semibold text-gray-950">Total</span><span className="pf-section-title">{formatMoney(total)}</span></div>
              </div>
            </CardContent>
          </Card>

          <Card padding="none">
            <CardHeader className="mb-0 border-b border-gray-200 px-4 py-3 sm:px-5" title="Recent activity" />
            <CardContent className="p-4">
              <ActivityTimeline
                items={activity}
                empty={<p className="pf-copy text-gray-500">No invoice activity has been recorded yet.</p>}
              />
            </CardContent>
          </Card>

          <Card padding="none">
            <CardHeader className="mb-0 border-b border-gray-200 px-4 py-3 sm:px-5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="pf-section-title">Payments</h3>
                {payments.length > 0 && (
                  <button type="button" className="btn-text btn-sm" onClick={() => setSelectedPayment(payments[0])}>
                    View payment details
                  </button>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-4">
              {payments.length ? (
                <div className="space-y-2">
                  {payments.map((payment) => (
                    <button
                      key={payment.id}
                      type="button"
                      className="grid w-full gap-3 rounded-lg border border-gray-200 p-3 text-left transition hover:border-blue-200 hover:bg-blue-50 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center"
                      onClick={() => setSelectedPayment(payment)}
                    >
                      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100 text-gray-700" aria-hidden="true">
                        <Icon name={payment.source === 'check' ? 'receipt' : 'credit-card'} className="h-5 w-5" />
                      </span>
                      <div className="min-w-0">
                        <p className="pf-row-title truncate">{paymentSourceLabel(payment.source)}</p>
                        <p className="pf-helper truncate">{formatDate(payment.receivedAt, true)} | {labelize(payment.status)}</p>
                      </div>
                      <div className="sm:text-right">
                        <p className="pf-row-title">{formatMoney(payment.amount)}</p>
                        {numberValue(payment.refundedAmount) > 0 && <p className="pf-helper text-red-700">{formatMoney(payment.refundedAmount)} refunded</p>}
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="pf-copy text-gray-500">No payment has been recorded yet.</p>
              )}
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-5">
          <Card padding="sm">
            <CardHeader title="Customer" />
            <CardContent className="space-y-2 p-0">
              <Link to={`/leads/${invoice.leadId}`} className="pf-row-title block hover:text-blue-700">{invoice.leadName || 'Customer'}</Link>
              {invoice.leadEmail && <p className="pf-copy break-all">{invoice.leadEmail}</p>}
              {invoice.leadPhone && <p className="pf-copy">{formatPhone(invoice.leadPhone)}</p>}
              {invoiceAddress && <p className="pf-helper">{invoiceAddress}</p>}
            </CardContent>
          </Card>

          <Card padding="sm">
            <CardHeader title="Invoice settings" />
            <CardContent className="space-y-3 p-0">
              <div>
                <p className="pf-meta">Due</p>
                <p className="pf-copy">{invoice.dueLabel || (invoice.dueDate ? `Due ${formatDate(invoice.dueDate)}` : 'Due on receipt')}</p>
              </div>
              <div>
                <p className="pf-meta">Reminder</p>
                <p className="pf-copy">{reminderCopy(invoice.reminderCadence)}</p>
              </div>
              <div>
                <p className="pf-meta">Sent</p>
                <p className="pf-copy">{formatDate(invoice.sentAt || invoice.createdAt, true)}</p>
              </div>
              {invoice.paidAt && (
                <div>
                  <p className="pf-meta">{['refunded', 'partially_refunded'].includes(String(invoice.status || '')) ? 'Original payment' : 'Paid'}</p>
                  <p className="pf-copy">{formatDate(invoice.paidAt, true)}</p>
                </div>
              )}
              {payments.some((payment) => numberValue(payment.refundedAmount) > 0.005) && (
                <div>
                  <p className="pf-meta">Refunded</p>
                  <p className="pf-copy text-red-700">
                    {formatMoney(payments.reduce((sum, payment) => sum + numberValue(payment.refundedAmount), 0))}
                  </p>
                </div>
              )}
              {invoice.note && (
                <div>
                  <p className="pf-meta">Internal note</p>
                  <p className="pf-copy">{invoice.note}</p>
                </div>
              )}
            </CardContent>
          </Card>
          </aside>
        </div>
      {selectedPayment && (
        <div className="mobile-sheet fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="payment-detail-title" onMouseDown={(event) => { if (event.target === event.currentTarget && !isSendingReceipt) setSelectedPayment(null); }}>
          <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-t-xl bg-white shadow-xl sm:rounded-xl">
            <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-gray-200 bg-white p-4">
              <Button type="button" variant="secondary" size="sm" fullWidth isLoading={isSendingReceipt} onClick={() => sendPaymentReceipt(selectedPayment)}>
                Send receipt
              </Button>
              <button type="button" className="btn-icon h-10 w-10 shrink-0" aria-label="Close payment details" onClick={() => setSelectedPayment(null)} disabled={isSendingReceipt}>
                <Icon name="close" className="h-5 w-5" />
              </button>
            </div>
            <div className="p-5 sm:p-7">
              <div className="rounded-xl border border-gray-200 bg-white p-5 sm:p-7">
                <h2 id="payment-detail-title" className="text-2xl font-semibold text-gray-950">
                  {formatMoney(selectedPayment.amount)} Payment
                </h2>
                <p className="pf-copy mt-2 text-gray-600">{formatDate(selectedPayment.receivedAt, true)}</p>

                <dl className="mt-6 space-y-1 text-sm text-gray-600">
                  <div>Invoice: <span className="font-medium text-gray-950">{invoice.invoiceNumber || 'Invoice'}</span></div>
                  <div>Collected at: <span className="font-medium text-gray-950">{invoice.orgName || 'Contractor workspace'}</span></div>
                  <div>Order source: <span className="font-medium text-gray-950">Invoices</span></div>
                  <div>Paid by: <Link to={`/leads/${invoice.leadId}`} className="font-medium text-blue-700 hover:underline">{invoice.leadName || 'Customer'}</Link></div>
                  <div>Method: <span className="font-medium text-gray-950">{paymentSourceLabel(selectedPayment.source)}</span></div>
                  {paymentReference(selectedPayment) && (
                    <div>Reference: <span className="font-medium text-gray-950">{paymentReference(selectedPayment)}</span></div>
                  )}
                </dl>

                <div className="my-7 border-t border-gray-200" />

                <div className="space-y-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="pf-row-title">{selectedPayment.description || 'Invoice payment'}</p>
                      <p className="pf-helper">{labelize(selectedPayment.status || 'succeeded')}</p>
                    </div>
                    <p className="pf-row-title">{formatMoney(selectedPayment.amount)}</p>
                  </div>
                  {numberValue(selectedPayment.refundedAmount) > 0 && (
                    <div className="flex items-start justify-between gap-4 text-red-700">
                      <p className="pf-copy font-medium">Refunded</p>
                      <p className="pf-row-title text-red-700">-{formatMoney(selectedPayment.refundedAmount)}</p>
                    </div>
                  )}
                </div>

                <div className="my-7 border-t border-gray-200" />

                <div className="space-y-3">
                  <div className="flex justify-between gap-4">
                    <span className="pf-copy">Subtotal</span>
                    <span className="pf-row-title">{formatMoney(invoice.subtotal)}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="pf-copy">Tax</span>
                    <span className="pf-row-title">{formatMoney(invoice.tax)}</span>
                  </div>
                  <div className="flex justify-between gap-4 border-t border-gray-200 pt-3">
                    <span className="pf-copy font-semibold text-gray-950">Total</span>
                    <span className="pf-section-title">{formatMoney(total)}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="pf-copy uppercase tracking-wide">{paymentSourceLabel(selectedPayment.source)}</span>
                    <span className="pf-row-title">{formatMoney(selectedPayment.amount)}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="pf-copy">Remaining balance</span>
                    <span className="pf-row-title">{formatMoney(collectibleBalance)}</span>
                  </div>
                </div>
              </div>
              <div className="mobile-sticky-actions mt-4 flex justify-end sm:static sm:m-0 sm:border-0 sm:bg-transparent sm:p-0">
                <Button type="button" onClick={() => setSelectedPayment(null)} disabled={isSendingReceipt}>Done</Button>
              </div>
            </div>
          </div>
        </div>
      )}
      {paymentModalOpen && (
        <div className="mobile-sheet fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="manual-payment-title" onMouseDown={(event) => { if (event.target === event.currentTarget) closePaymentModal(); }}>
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-xl bg-white p-5 shadow-xl sm:rounded-xl sm:p-6">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 id="manual-payment-title" className="pf-section-title">Mark paid manually</h2>
                <p className="pf-copy mt-1">{invoice.invoiceNumber || 'This invoice'} has {formatMoney(balance)} open.</p>
              </div>
              <button type="button" className="btn-icon" aria-label="Close manual payment" onClick={closePaymentModal}>
                <Icon name="close" className="h-5 w-5" />
              </button>
            </div>
            <form className="space-y-4" onSubmit={recordManualPayment}>
              <Input
                label="Amount"
                type="number"
                min="0.01"
                max={balance.toFixed(2)}
                step="0.01"
                inputMode="decimal"
                value={paymentForm.amount}
                onChange={(event) => setPaymentForm((current) => ({ ...current, amount: event.target.value }))}
                required
              />
              <Select
                label="Payment method"
                value={paymentForm.source}
                onChange={(event) => setPaymentForm((current) => ({ ...current, source: event.target.value as ManualPaymentForm['source'] }))}
              >
                <option value="check">Check</option>
                <option value="cash">Cash</option>
                <option value="ach">ACH</option>
                <option value="other">Other</option>
              </Select>
              <Input
                label="Reference"
                value={paymentForm.reference}
                onChange={(event) => setPaymentForm((current) => ({ ...current, reference: event.target.value }))}
                placeholder="Check number, memo, or bank reference"
              />
              <Input
                label="Description"
                value={paymentForm.description}
                onChange={(event) => setPaymentForm((current) => ({ ...current, description: event.target.value }))}
                placeholder="Invoice payment"
              />
              <label className="flex gap-3 rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-blue-950">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={paymentForm.sendReceipt}
                  onChange={(event) => setPaymentForm((current) => ({ ...current, sendReceipt: event.target.checked }))}
                />
                <span>
                  <span className="block font-medium">Send receipt to customer</span>
                  <span className="block text-blue-800">Uses the invoice payment receipt email template after the manual payment is recorded.</span>
                </span>
              </label>
              {paid > 0.005 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  This invoice already has {formatMoney(paid)} recorded. You will be asked to confirm this is an additional payment.
                </div>
              )}
              <div className="mobile-sticky-actions flex flex-col gap-3 pt-2 sm:static sm:m-0 sm:flex-row sm:border-0 sm:bg-transparent sm:p-0">
                <Button type="button" variant="secondary" fullWidth onClick={closePaymentModal}>Cancel</Button>
                <Button type="submit" fullWidth isLoading={isRecordingPayment}>
                  {numberValue(paymentForm.amount) >= balance - 0.005 ? 'Mark paid' : 'Record payment'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
      {cancelModalOpen && (
        <div className="mobile-sheet fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="cancel-invoice-title" onMouseDown={(event) => { if (event.target === event.currentTarget) closeCancelModal(); }}>
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-xl bg-white p-5 shadow-xl sm:rounded-xl sm:p-6">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 id="cancel-invoice-title" className="pf-section-title">Cancel invoice</h2>
                <p className="pf-copy mt-1">{invoice.invoiceNumber || 'This invoice'} will be closed and the customer will be emailed.</p>
              </div>
              <button type="button" className="btn-icon" aria-label="Close cancel invoice" onClick={closeCancelModal}>
                <Icon name="close" className="h-5 w-5" />
              </button>
            </div>
            <form className="space-y-4" onSubmit={cancelInvoice}>
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
                Canceling an invoice does not refund money. If payment has already been recorded, use the refund or credit workflow instead.
              </div>
              <Textarea
                label="Internal reason"
                rows={3}
                maxLength={500}
                value={cancelReason}
                onChange={(event) => setCancelReason(event.target.value)}
                placeholder="Created in error, customer requested updated invoice, duplicate invoice"
              />
              <div className="mobile-sticky-actions flex flex-col gap-3 pt-2 sm:static sm:m-0 sm:flex-row sm:border-0 sm:bg-transparent sm:p-0">
                <Button type="button" variant="secondary" fullWidth onClick={closeCancelModal}>Keep invoice</Button>
                <Button type="submit" variant="dangerSubtle" fullWidth isLoading={isCanceling}>Cancel invoice</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
