import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

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
  if (!['succeeded', 'paid', 'partially_refunded', 'refunded'].includes(String(payment.status || ''))) return 0;
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

export function InvoiceDetail() {
  const { id } = useParams<{ id: string }>();
  const [invoice, setInvoice] = useState<CustomerInvoiceDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSendingReminder, setIsSendingReminder] = useState(false);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentForm, setPaymentForm] = useState<ManualPaymentForm>(emptyManualPaymentForm);
  const [isRecordingPayment, setIsRecordingPayment] = useState(false);
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
    document.body.classList.toggle('pf-modal-open', cancelModalOpen || paymentModalOpen);
    return () => document.body.classList.remove('pf-modal-open');
  }, [cancelModalOpen, paymentModalOpen]);

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
  const isOpen = invoice && balance > 0.005 && !['paid', 'voided', 'canceled'].includes(String(invoice.status || ''));
  const lineItems = Array.isArray(invoice?.lineItems) ? invoice.lineItems : [];
  const invoiceAddress = invoice ? formatAddress({
    streetAddress: invoice.jobStreetAddress || invoice.leadStreetAddress,
    city: invoice.jobCity || invoice.leadCity,
    state: invoice.jobState || invoice.leadState,
    postalCode: invoice.jobPostalCode || invoice.leadPostalCode,
  }) : '';

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
            <div className="rounded-lg bg-amber-50 p-3">
              <p className="pf-metric-label text-amber-800">Balance</p>
              <p className="pf-row-title text-amber-950">{formatMoney(balance)}</p>
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
                          {item.category ? ` · ${labelize(item.category)}` : ''}
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
            <CardHeader className="mb-0 border-b border-gray-200 px-4 py-3 sm:px-5" title="Payment history" />
            <CardContent className="p-4">
              {payments.length ? (
                <div className="space-y-2">
                  {payments.map((payment) => (
                    <div key={payment.id} className="grid gap-2 rounded-lg border border-gray-200 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                      <div>
                        <p className="pf-row-title">{payment.description || `${labelize(payment.source)} payment`}</p>
                        <p className="pf-helper">{formatDate(payment.receivedAt, true)} · {labelize(payment.status)}</p>
                      </div>
                      <div className="sm:text-right">
                        <p className="pf-row-title">{formatMoney(payment.amount)}</p>
                        {numberValue(payment.refundedAmount) > 0 && <p className="pf-helper text-red-700">{formatMoney(payment.refundedAmount)} refunded</p>}
                      </div>
                    </div>
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
                  <p className="pf-meta">Paid</p>
                  <p className="pf-copy">{formatDate(invoice.paidAt, true)}</p>
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
