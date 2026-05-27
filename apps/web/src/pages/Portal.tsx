import { FormEvent, PointerEvent, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';

import { Button } from '@/components/Button';
import { Card, CardContent, CardHeader } from '@/components/Card';
import { StatusBadge } from '@/components/Badge';
import { API_URL, formatMoney, labelize } from '@/lib/api';
import { paymentErrorMessage } from '@/lib/paymentMessages';

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

interface PortalData {
  customer?: Customer;
  estimate?: Estimate | null;
  job?: Job | null;
  changeOrders?: ChangeOrder[];
}

async function portalJson<T>(path: string, options: RequestInit = {}) {
  const response = await fetch(`${API_URL}${path}`, { credentials: 'include', ...options });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Request failed');
  return payload as T;
}

export function Portal() {
  const { token } = useParams<{ token: string }>();
  const [searchParams] = useSearchParams();
  const [data, setData] = useState<PortalData | null>(null);
  const [approvalNameByOrder, setApprovalNameByOrder] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function loadPortal() {
    if (!token) {
      setError('Invalid link');
      setIsLoading(false);
      return;
    }
    setError('');
    try {
      const query = searchParams.toString();
      const payload = await portalJson<{ data?: PortalData }>(`/v1/portal/${token}${query ? `?${query}` : ''}`);
      const next = payload.data || {};
      setData(next);
      setApprovalNameByOrder(Object.fromEntries((next.changeOrders || []).map((order) => [order.id, next.customer?.name || ''])));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid or expired link');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadPortal();
  }, [token, searchParams]);

  async function approveEstimate() {
    if (!token) return;
    setBusyAction('approve-estimate');
    try {
      await portalJson(`/v1/portal/${token}/approve`, {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      });
      window.showToast?.('Approved. The contractor will contact you to schedule.', 'success');
      await loadPortal();
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Unable to approve estimate', 'error');
    } finally {
      setBusyAction(null);
    }
  }

  async function approveChangeOrder(event: FormEvent<HTMLFormElement>, order: ChangeOrder) {
    event.preventDefault();
    if (!token) return;
    const formData = new FormData(event.currentTarget);
    const signatureData = String(formData.get('signatureData') || '');
    setBusyAction(`approve-${order.id}`);
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
      window.showToast?.(err instanceof Error ? err.message : 'Unable to approve change order', 'error');
    } finally {
      setBusyAction(null);
    }
  }

  async function payChangeOrder(order: ChangeOrder) {
    if (!token) return;
    setBusyAction(`pay-${order.id}`);
    try {
      const payload = await portalJson<{ data?: { checkoutUrl?: string } }>(`/v1/portal/${token}/change-orders/${order.id}/checkout`, {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      });
      if (!payload.data?.checkoutUrl) throw new Error('Unable to start payment');
      window.location.href = payload.data.checkoutUrl;
    } catch (err) {
      window.showToast?.(paymentErrorMessage(err, 'Unable to start payment'), 'error');
      setBusyAction(null);
    }
  }

  if (isLoading) {
    return <div className="py-12 text-center text-gray-500">Loading customer portal...</div>;
  }

  if (error || !data) {
    return <div className="py-12 text-center text-red-600">{error || 'Invalid or expired link'}</div>;
  }

  const { customer, estimate, job, changeOrders = [] } = data;
  const activeChangeOrders = changeOrders.filter((order) => ['pending', 'approved'].includes(order.status) || order.paymentStatus === 'pending');
  const balance = Number(job?.balance || 0);

  return (
    <div className="mx-auto max-w-4xl px-1 pb-24 sm:px-0">
      <div className="mb-5">
        <p className="pf-kicker">Customer portal</p>
        <h1 className="pf-section-title mt-1">{customer?.name || 'Customer'}</h1>
        {customer?.email && <p className="pf-copy mt-1">{customer.email}</p>}
      </div>

      {!estimate && !job && !activeChangeOrders.length && (
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
            <Button className="mt-6 w-full" onClick={() => void approveEstimate()} isLoading={busyAction === 'approve-estimate'}>
              Approve Estimate
            </Button>
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
                {balance > 0 && <p className="pf-copy mt-2">Outstanding balance: <span className="font-semibold text-gray-950">{formatMoney(balance)}</span></p>}
              </div>
              <StatusBadge status={job.status || 'active'} />
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
                  isPaying={busyAction === `pay-${order.id}`}
                  onApprovalNameChange={(value) => setApprovalNameByOrder((current) => ({ ...current, [order.id]: value }))}
                  onApprove={(event) => void approveChangeOrder(event, order)}
                  onPay={() => void payChangeOrder(order)}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {job && balance > 0 && (
        <Card>
          <CardHeader title="Outstanding Balance" description="Online balance payment will be available here once the contractor enables portal card payments." />
          <CardContent>
            <p className="text-3xl font-bold text-gray-950">{formatMoney(balance)}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ChangeOrderCard({
  order,
  job,
  approvalName,
  isApproving,
  isPaying,
  onApprovalNameChange,
  onApprove,
  onPay,
}: {
  order: ChangeOrder;
  job?: Job | null;
  approvalName: string;
  isApproving: boolean;
  isPaying: boolean;
  onApprovalNameChange: (value: string) => void;
  onApprove: (event: FormEvent<HTMLFormElement>) => void;
  onPay: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(Boolean(order.customerSignedAt));
  const [signatureData, setSignatureData] = useState('');
  const paymentRequired = Boolean(order.paymentRequired);
  const paymentDue = Number(order.paymentDueAmount || 0) || Number(order.amount || 0);
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
          <p className="text-sm text-gray-600">
            {paymentRequired ? `Payment due now: ${formatMoney(paymentDue)}` : 'No online payment is required for this change order.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusBadge status={order.status} />
          {paymentRequired && <StatusBadge status={order.paymentStatus || 'pending'} />}
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
          <Button type="submit" isLoading={isApproving} disabled={!contractorSignature}>Sign and approve change order</Button>
        </form>
      ) : (
        <div className="mt-4 grid gap-3">
          {order.customerSignedAt && (
            <div className="rounded-lg border bg-gray-50 p-3 text-sm text-gray-700">
              Signed by {order.customerSignatureName || 'Customer'} on {new Date(order.customerSignedAt).toLocaleString()}.
            </div>
          )}
          {needsPayment && <Button onClick={onPay} isLoading={isPaying}>Pay {formatMoney(paymentDue)}</Button>}
          {isPaid && <p className="text-sm font-medium text-green-700">Payment received. Thank you.</p>}
          {!needsPayment && !isPaid && <p className="text-sm text-gray-600">{labelize(order.paymentStatus || 'Approved')}</p>}
        </div>
      )}
    </article>
  );
}
