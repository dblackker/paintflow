import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { StatusBadge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card, CardContent, CardHeader } from '@/components/Card';
import { Icon } from '@/components/Icon';
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
            <Button type="button" size="sm" leftIcon={<Icon name="mail" className="h-4 w-4" />} isLoading={isSendingReminder} onClick={sendReminder}>
              Send reminder
            </Button>
          )}
          <Button as="a" href={`/leads/${invoice.leadId}`} variant="secondary" size="sm">Open customer</Button>
          {invoice.jobId && <Button as="a" href={`/jobs/${invoice.jobId}`} variant="secondary" size="sm">Open job</Button>}
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
    </main>
  );
}
