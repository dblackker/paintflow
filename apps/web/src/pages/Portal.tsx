import { FormEvent, PointerEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';

import { Button } from '@/components/Button';
import { Card, CardContent, CardHeader } from '@/components/Card';
import { StatusBadge } from '@/components/Badge';
import { API_URL, formatMoney, labelize } from '@/lib/api';
import { paymentErrorMessage } from '@/lib/paymentMessages';
import type { InvoiceBalance } from '@crewmodo/core';

interface Customer {
  name?: string;
  email?: string;
}

interface Estimate {
  id: string;
  total?: number | string;
  signedAt?: string | null;
  status?: string;
  title?: string;
}

interface Job {
  id: string;
  jobNumber?: string | null;
  name?: string;
  title?: string;
  status?: string;
  balance?: number | string;
  streetAddress?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
}

interface ChangeOrder {
  id: string;
  description?: string;
  amount?: number | string;
  status: string;
  paymentRequired?: boolean;
  paymentStatus?: string;
  paymentDueAmount?: number | string;
  contractorSignature?: {
    name?: string;
    companyName?: string;
    title?: string;
    signedAt?: string;
  } | null;
  customerSignatureName?: string | null;
  customerSignedAt?: string | null;
}

interface ClientInvoice {
  id: string;
  invoiceNumber?: string | null;
  description?: string | null;
  total?: number | string | null;
  status?: string | null;
  dueLabel?: string | null;
  dueDate?: string | null;
  estimateId?: string | null;
  jobId?: string | null;
  changeOrderId?: string | null;
  paidAmount?: number | string | null;
  balanceDue?: number | string | null;
  creditedAmount?: number | string | null;
  payable?: boolean;
  needsReview?: boolean;
  closed?: boolean;
  processing?: boolean;
  refundPending?: boolean;
  paymentUnavailableReason?: string | null;
  balance?: InvoiceBalance | null;
}

interface PortalData {
  customer?: Customer;
  estimate?: Estimate | null;
  job?: Job | null;
  changeOrders?: ChangeOrder[];
  invoices?: ClientInvoice[];
}

async function portalJson<T>(path: string, options: RequestInit = {}) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`${API_URL}${path}`, { credentials: 'include', ...options, signal: options.signal || controller.signal });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Request failed');
    return payload as T;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('The request timed out. Please try again.');
    throw error;
  } finally { window.clearTimeout(timer); }
}

export function Portal() {
  const { token } = useParams<{ token: string }>();
  const [searchParams] = useSearchParams();
  const [data, setData] = useState<PortalData | null>(null);
  const [approvalNameByOrder, setApprovalNameByOrder] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  const actionInFlight = useRef<string | null>(null);
  const checkoutNavigation = useRef(false);
  const loadSequence = useRef(0);
  const query = searchParams.toString();

  const loadPortal = useCallback(async () => {
    const sequence = ++loadSequence.current;
    if (!token) {
      setError('Invalid link');
      setIsLoading(false);
      return;
    }
    setError('');
    try {
      const payload = await portalJson<{ data?: PortalData }>(`/v1/portal/${encodeURIComponent(token)}${query ? `?${query}` : ''}`);
      if (sequence !== loadSequence.current) return;
      const next = payload.data || {};
      setData(next);
      setApprovalNameByOrder(Object.fromEntries((next.changeOrders || []).map((order) => [order.id, next.customer?.name || ''])));
    } catch (err) {
      if (sequence !== loadSequence.current) return;
      setError(err instanceof Error ? err.message : 'Invalid or expired link');
    } finally {
      if (sequence === loadSequence.current) setIsLoading(false);
    }
  }, [token, query]);

  useEffect(() => {
    void loadPortal();
    return () => { loadSequence.current++; };
  }, [loadPortal]);

  useEffect(() => {
    const resetPaymentNavigationState = () => {
      if (!checkoutNavigation.current || document.visibilityState === 'hidden') return;
      checkoutNavigation.current = false;
      actionInFlight.current = null;
      setBusyAction(null);
      void loadPortal();
    };
    window.addEventListener('pageshow', resetPaymentNavigationState);
    window.addEventListener('focus', resetPaymentNavigationState);
    document.addEventListener('visibilitychange', resetPaymentNavigationState);
    return () => {
      window.removeEventListener('pageshow', resetPaymentNavigationState);
      window.removeEventListener('focus', resetPaymentNavigationState);
      document.removeEventListener('visibilitychange', resetPaymentNavigationState);
    };
  }, [loadPortal]);

  async function approveChangeOrder(event: FormEvent<HTMLFormElement>, order: ChangeOrder) {
    event.preventDefault();
    if (!token || actionInFlight.current) return;
    const formData = new FormData(event.currentTarget);
    const signatureData = String(formData.get('signatureData') || '');
    actionInFlight.current = `approve-${order.id}`;
    setBusyAction(actionInFlight.current);
    setActionErrors((current) => ({ ...current, [`approve-${order.id}`]: '' }));
    try {
      await portalJson(`/v1/portal/${token}/change-orders/${order.id}/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          approvedBy: approvalNameByOrder[order.id] || data?.customer?.name || 'customer',
          signatureData,
        }),
      });
      window.showToast?.('Change order approved', 'success');
      await loadPortal();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to approve change order';
      setActionErrors((current) => ({ ...current, [`approve-${order.id}`]: message }));
      window.showToast?.(message, 'error');
    } finally {
      actionInFlight.current = null;
      setBusyAction(null);
    }
  }

  async function payInvoice(invoice: ClientInvoice) {
    if (!token || actionInFlight.current || invoice.payable !== true) return;
    actionInFlight.current = `pay-invoice-${invoice.id}`;
    setBusyAction(actionInFlight.current);
    setActionErrors((current) => ({ ...current, [`pay-invoice-${invoice.id}`]: '' }));
    try {
      const payload = await portalJson<{ data?: { checkoutUrl?: string } }>(`/v1/portal/${token}/invoices/${invoice.id}/checkout`, {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      });
      const url = payload.data?.checkoutUrl ? new URL(payload.data.checkoutUrl) : null;
      if (!url || url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com' || url.username || url.password) throw new Error('Unable to start payment');
      checkoutNavigation.current = true;
      window.location.assign(url.toString());
    } catch (err) {
      checkoutNavigation.current = false;
      const message = paymentErrorMessage(err, 'Unable to start payment');
      setActionErrors((current) => ({ ...current, [`pay-invoice-${invoice.id}`]: message }));
      window.showToast?.(message, 'error');
    } finally {
      if (!checkoutNavigation.current) {
        actionInFlight.current = null;
        setBusyAction(null);
      }
    }
  }

  if (isLoading) {
    return <div className="py-12 text-center text-gray-500">Loading customer portal...</div>;
  }

  if (error || !data) {
    return <div className="mx-auto max-w-lg px-4 py-12 text-center">
      <p role="alert" className="pf-copy text-red-700">{error || 'Invalid or expired link'}</p>
      <Button variant="secondary" className="mt-4" onClick={() => void loadPortal()}>Try again</Button>
    </div>;
  }

  const { customer, estimate, job, changeOrders = [], invoices = [] } = data;
  const activeChangeOrders = changeOrders.filter((order) => ['pending', 'approved'].includes(order.status) || order.paymentStatus === 'pending');
  const invoicesByChangeOrder = new Map(invoices.filter((invoice) => invoice.changeOrderId).map((invoice) => [invoice.changeOrderId as string, invoice]));
  const focusedInvoiceId = searchParams.get('invoiceId') || '';
  const activeInvoices = invoices
    .filter((invoice) => !['voided', 'canceled'].includes(String(invoice.status || '')))
    .sort((a, b) => (a.id === focusedInvoiceId ? -1 : b.id === focusedInvoiceId ? 1 : 0));

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white/95 px-4 py-3">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="pf-kicker">Secure customer portal</p>
            <h1 className="pf-section-title truncate">{customer?.name || 'Customer'}</h1>
          </div>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-700 text-sm font-semibold text-white" aria-label="Crewmodo">
            C
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-4 py-5 pb-24 sm:px-6">
        <div className="mb-5">
          <p className="pf-page-copy">
            Review proposals, invoices, approved changes, and project details shared by your contractor.
          </p>
          {customer?.email && <p className="pf-copy mt-1">{customer.email}</p>}
          {(searchParams.has('invoicePaymentCanceled') || searchParams.has('changeOrderPaymentCanceled')) && (
            <p role="status" className="pf-helper mt-3">Checkout closed. Your latest payment status is shown below.</p>
          )}
        </div>

        {!estimate && !job && !activeChangeOrders.length && !activeInvoices.length && (
          <Card>
            <CardContent className="p-8 text-center text-gray-500">No active items are available from this link.</CardContent>
          </Card>
        )}

        {estimate && !estimate.signedAt && (
          <Card className="mb-6">
            <CardContent>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-2xl font-bold text-gray-950">{estimate.title || 'Painting proposal'}</h2>
                  <p className="mt-2 text-3xl font-bold text-blue-700">{formatMoney(estimate.total)}</p>
                </div>
                {estimate.status && <StatusBadge status={estimate.status} />}
              </div>
              <Button as="a" href={`/estimates/${estimate.id}`} className="mt-6 w-full">
                Review and sign proposal
              </Button>
            </CardContent>
          </Card>
        )}

        {estimate?.signedAt && (
          <Card className="mb-6">
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="pf-section-title">{estimate.title || 'Signed proposal'}</h2>
                    <StatusBadge status="signed" />
                  </div>
                  <p className="pf-copy mt-1">Signed on {new Date(estimate.signedAt).toLocaleDateString()}. The proposal is the agreement; invoices below handle deposits and payments.</p>
                </div>
                <Button as="a" href={`/estimates/${estimate.id}`} variant="secondary" size="sm">View signed copy</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {job && (
          <Card className="mb-6">
            <CardContent>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-2xl font-bold text-gray-950">{job.name || job.title || 'Painting project'}</h2>
                  <div className="pf-copy mt-2 flex flex-wrap gap-2">
                    {job.jobNumber && <span className="pf-row-title">{job.jobNumber}</span>}
                    {[job.streetAddress, [job.city, job.state].filter(Boolean).join(', '), String(job.postalCode || '').slice(0, 5)].filter(Boolean).join(' ') && (
                      <span>{[job.streetAddress, [job.city, job.state].filter(Boolean).join(', '), String(job.postalCode || '').slice(0, 5)].filter(Boolean).join(' ')}</span>
                    )}
                  </div>
                </div>
                <StatusBadge status={job.status || 'active'} />
              </div>
            </CardContent>
          </Card>
        )}

        {activeInvoices.length > 0 && (
          <Card className="mb-6">
            <CardHeader title="Invoices & Payments" description="Pay deposits, progress payments, final balances, and approved change orders here." />
            <CardContent>
              <div className="grid gap-3">
                {activeInvoices.map((invoice) => (
                  <InvoiceCard
                    key={invoice.id}
                    invoice={invoice}
                    isFocused={invoice.id === focusedInvoiceId}
                    isPaying={busyAction === `pay-invoice-${invoice.id}`}
                    isActionBlocked={Boolean(busyAction)}
                    actionError={actionErrors[`pay-invoice-${invoice.id}`]}
                    onPay={() => void payInvoice(invoice)}
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {activeChangeOrders.length > 0 && (
          <Card className="mb-6">
            <CardHeader title="Change Orders" description="Review requested changes, approve them, and pay any required deposit." />
            <CardContent>
              <div className="grid gap-4">
                {activeChangeOrders.map((order) => (
                  <ChangeOrderCard
                    key={order.id}
                    order={order}
                    job={job}
                    approvalName={approvalNameByOrder[order.id] || ''}
                    isApproving={busyAction === `approve-${order.id}`}
                    isActionBlocked={Boolean(busyAction)}
                    paymentInvoiceId={invoicesByChangeOrder.get(order.id)?.id}
                    actionError={actionErrors[`approve-${order.id}`]}
                    onApprovalNameChange={(value) => setApprovalNameByOrder((current) => ({ ...current, [order.id]: value }))}
                    onApprove={(event) => void approveChangeOrder(event, order)}
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        )}

      </div>
    </div>
  );
}

function InvoiceCard({ invoice, isFocused, isPaying, isActionBlocked, actionError, onPay }: { invoice: ClientInvoice; isFocused: boolean; isPaying: boolean; isActionBlocked: boolean; actionError?: string; onPay: () => void }) {
  const paid = Number(invoice.paidAmount || 0);
  const credit = Number(invoice.creditedAmount || 0);
  const balance = invoice.balanceDue === null || invoice.balanceDue === undefined ? null : Number(invoice.balanceDue);
  const isRefunded = invoice.status === 'refunded';
  const payable = invoice.payable === true && balance !== null && Number.isFinite(balance) && balance > 0;
  const isPaid = invoice.status === 'paid' && !invoice.needsReview;
  const message = invoice.paymentUnavailableReason || 'Your contractor needs to confirm this payment balance.';
  return (
    <article id={`invoice-${invoice.id}`} aria-label={invoice.invoiceNumber || 'Invoice'} className={`scroll-mt-4 rounded-lg border bg-white p-4 ${isFocused ? 'border-blue-700 shadow-md' : 'border-gray-200'}`}>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="pf-row-title">{invoice.invoiceNumber || 'Invoice'}</p>
            <StatusBadge status={invoice.status || 'sent'} />
          </div>
          <p className="pf-copy mt-1">{invoice.description || 'Payment request'}</p>
          <p className="pf-helper mt-1">{invoice.dueLabel || (invoice.dueDate ? `Due ${new Date(invoice.dueDate).toLocaleDateString()}` : 'Due on receipt')}</p>
        </div>
        <div className="text-left sm:text-right">
          <p className="pf-meta">Balance due</p>
          <p className="pf-section-title">{balance === null ? 'Under review' : formatMoney(balance)}</p>
          {paid > 0.005 && <p className="pf-helper">{formatMoney(paid)} paid</p>}
          {credit > 0 && <p className="pf-helper">{formatMoney(credit)} credited</p>}
        </div>
      </div>
      <div className="mt-4">
        {actionError && <p role="alert" className="pf-copy mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-red-800">{actionError}</p>}
        {invoice.needsReview || invoice.processing || invoice.refundPending ? (
          <p role="status" className="pf-copy rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">{message}</p>
        ) : isRefunded ? (
          <p role="status" className="pf-copy rounded-lg border border-red-200 bg-red-50 p-3 text-red-800">Refund issued. This invoice is closed to further payments.</p>
        ) : isPaid ? (
          <p role="status" className="pf-copy rounded-lg border border-green-200 bg-green-50 p-3 text-green-800">Payment received. Thank you.</p>
        ) : payable ? (
          <Button onClick={onPay} isLoading={isPaying} disabled={isActionBlocked} className="w-full sm:w-auto">Pay {formatMoney(balance)}</Button>
        ) : invoice.status === 'partially_refunded' && balance === 0 ? (
          <p role="status" className="pf-copy">This invoice was adjusted. No further payment is due.</p>
        ) : (
          <p role="status" className="pf-copy">{message}</p>
        )}
      </div>
    </article>
  );
}

function ChangeOrderCard({
  order,
  job,
  approvalName,
  isApproving,
  isActionBlocked,
  paymentInvoiceId,
  actionError,
  onApprovalNameChange,
  onApprove,
}: {
  order: ChangeOrder;
  job?: Job | null;
  approvalName: string;
  isApproving: boolean;
  isActionBlocked: boolean;
  paymentInvoiceId?: string;
  actionError?: string;
  onApprovalNameChange: (value: string) => void;
  onApprove: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(Boolean(order.customerSignedAt));
  const [signatureData, setSignatureData] = useState('');
  const paymentRequired = Boolean(order.paymentRequired);
  const isApproved = order.status === 'approved' || order.status === 'completed';
  const isPaid = order.paymentStatus === 'paid';
  const needsPayment = paymentRequired && !isPaid;
  const contractorSignature = order.contractorSignature;
  const jobMeta = [job?.jobNumber, job?.streetAddress].filter(Boolean).join(' - ');

  function point(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (canvas.width / rect.width),
      y: (event.clientY - rect.top) * (canvas.height / rect.height),
    };
  }

  function startDrawing(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const next = point(event);
    if (!canvas || !next) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const context = canvas.getContext('2d');
    if (!context) return;
    context.lineWidth = 2;
    context.lineCap = 'round';
    context.strokeStyle = '#111827';
    context.beginPath();
    context.moveTo(next.x, next.y);
    setIsDrawing(true);
  }

  function draw(event: PointerEvent<HTMLCanvasElement>) {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    const next = point(event);
    if (!canvas || !next) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.lineTo(next.x, next.y);
    context.stroke();
    setHasSignature(true);
    setSignatureData(canvas.toDataURL());
  }

  function stopDrawing() {
    if (!isDrawing) return;
    setIsDrawing(false);
    const canvas = canvasRef.current;
    if (canvas) setSignatureData(canvas.toDataURL());
  }

  function clearSignature() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
    setSignatureData('');
  }

  return (
    <article className="rounded-lg border p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-medium text-gray-950">{order.description || 'Change order'}</p>
          {jobMeta && <p className="mt-1 text-sm text-gray-600">{jobMeta}</p>}
          <p className="mt-1 text-sm text-gray-600">Change order amount: {formatMoney(order.amount)}</p>
          {!paymentRequired && <p className="pf-helper">No payment is required for this change order.</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusBadge status={order.status} />
          {paymentRequired && isApproved && <StatusBadge status={['pending', 'not_requested'].includes(order.paymentStatus || '') ? 'due' : order.paymentStatus || 'due'} />}
        </div>
      </div>

      {!isApproved ? (
        <form className="mt-4 grid gap-4" onSubmit={(event) => {
          if (!hasSignature || !signatureData) {
            event.preventDefault();
            window.showToast?.('Please add your signature.', 'error');
            return;
          }
          onApprove(event);
        }}>
          {contractorSignature ? (
            <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-900">
              Countersigned by {contractorSignature.name || contractorSignature.companyName || 'Contractor'}
              {contractorSignature.companyName ? ` for ${contractorSignature.companyName}` : ''}
              {contractorSignature.signedAt ? ` on ${new Date(contractorSignature.signedAt).toLocaleDateString()}` : ''}.
            </div>
          ) : (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              Contractor signature is pending. Ask the contractor to resend the approval link before signing.
            </div>
          )}
          <label className="block">
            <span className="form-label">Signature name</span>
            <input className="input mt-1" value={approvalName} onChange={(event) => onApprovalNameChange(event.target.value)} autoComplete="name" required />
          </label>
          <div>
            <span className="form-label">Customer signature</span>
            <canvas
              ref={canvasRef}
              width={720}
              height={180}
              className="mt-1 h-36 w-full touch-none rounded-lg border bg-gray-50"
              onPointerDown={startDrawing}
              onPointerMove={draw}
              onPointerUp={stopDrawing}
              onPointerCancel={stopDrawing}
            />
            <input type="hidden" name="signatureData" value={signatureData} />
            <button type="button" className="btn-text btn-sm mt-2" onClick={clearSignature}>Clear signature</button>
          </div>
          <Button type="submit" isLoading={isApproving} disabled={!contractorSignature || isActionBlocked}>Sign and approve change order</Button>
          {actionError && <p role="alert" className="pf-copy text-red-800">{actionError}</p>}
        </form>
      ) : (
        <div className="mt-4 grid gap-3">
          {order.customerSignedAt && (
            <div className="rounded-lg border bg-gray-50 p-3 text-sm text-gray-700">
              Signed by {order.customerSignatureName || 'Customer'} on {new Date(order.customerSignedAt).toLocaleString()}.
            </div>
          )}
          {needsPayment && paymentInvoiceId && (
            <Button as="a" href={`#invoice-${paymentInvoiceId}`} variant="secondary">View payment invoice</Button>
          )}
          {needsPayment && !paymentInvoiceId && <p role="status" className="pf-copy text-amber-900">Ask your contractor to issue the payment invoice for this change order.</p>}
          {isPaid && <p className="text-sm font-medium text-green-700">Payment received. Thank you.</p>}
          {!needsPayment && !isPaid && <p className="text-sm text-gray-600">{labelize(order.paymentStatus || 'Approved')}</p>}
        </div>
      )}
    </article>
  );
}
