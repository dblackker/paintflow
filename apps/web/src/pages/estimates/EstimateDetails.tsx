import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { Badge, StatusBadge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card, CardContent, CardHeader } from '@/components/Card';
import { apiJson, formatAddress, formatMoney, formatPhone, labelize } from '@/lib/api';

interface EstimateLineItem {
  desc?: string;
  qty?: number;
  rate?: number;
  category?: string;
  notes?: string;
  roomName?: string;
  surfaceName?: string;
  optional?: boolean;
  customerVisible?: boolean;
  labor?: {
    coats?: number;
    prepLevel?: string;
    applicationMethod?: string;
    ceilingColorSeparation?: string;
  };
  material?: {
    name?: string;
    brand?: string;
    colorName?: string;
    colorCode?: string;
  };
}

interface EstimatePackage {
  name?: string;
  total?: number;
  subtotal?: number;
  tax?: number;
  items?: EstimateLineItem[];
  lineItems?: EstimateLineItem[];
}

interface Payment {
  id: string;
  amount?: number | string;
  refundedAmount?: number | string;
  source?: string;
  status?: string;
  description?: string;
  receivedAt?: string;
}

interface Estimate {
  id: string;
  leadId?: string;
  status: string;
  total?: number | string;
  packages?: EstimatePackage[];
  payments?: Payment[];
  createdAt?: string;
  sentAt?: string;
  signedAt?: string;
  signedName?: string;
  updatedAt?: string;
  publicUrl?: string;
  customerPreviewUrl?: string;
}

interface Customer {
  id: string;
  name?: string;
  phone?: string;
  email?: string;
  streetAddress?: string;
  city?: string;
  state?: string;
  postalCode?: string;
}

interface Activity {
  id: string;
  action?: string;
  createdAt?: string;
  metadata?: {
    reason?: string;
  };
}

function packageItems(pkg?: EstimatePackage | null) {
  return pkg?.items || pkg?.lineItems || [];
}

function proposalPackage(estimate?: Estimate | null) {
  const packages = estimate?.packages || [];
  return packages.find((pkg) => pkg.name === 'proposal')
    || packages.find((pkg) => /better|recommended/i.test(pkg.name || ''))
    || packages[0]
    || null;
}

function dateTime(value?: string) {
  return value ? new Date(value).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Not recorded';
}

function dateOnly(value?: string) {
  return value ? new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : 'Not recorded';
}

function applicationLabel(value?: string) {
  const labels: Record<string, string> = {
    brush_roll: 'Brush & roll',
    spray_backroll: 'Spray & back-roll',
    spray_only: 'Spray only',
  };
  return value ? labels[value] || labelize(value) : '';
}

function scopeParts(item: EstimateLineItem) {
  const raw = String(item.desc || 'Scope item');
  const [room, detail] = raw.split(/:\s(.+)/);
  const surface = item.surfaceName || detail || room || 'Scope item';
  return {
    room: item.roomName || (detail ? room : 'Project'),
    surface: surface.replace(/^(Interior|Exterior)\s+/i, '').trim(),
  };
}

function itemDetails(item: EstimateLineItem) {
  const labor = item.labor || {};
  const material = item.material || {};
  const paint = material.name ? [material.brand, material.name].filter(Boolean).join(' ') : '';
  const color = [material.colorName, material.colorCode].filter(Boolean).join(' ');
  return [
    labor.coats ? `${Number(labor.coats)} coat${Number(labor.coats) === 1 ? '' : 's'}` : '',
    labor.prepLevel ? `${labelize(labor.prepLevel)} prep` : '',
    labor.applicationMethod ? applicationLabel(labor.applicationMethod) : '',
    labor.ceilingColorSeparation ? `Ceiling color: ${labelize(labor.ceilingColorSeparation)}` : '',
    paint ? `Paint: ${paint}` : '',
    color ? `Color: ${color}` : '',
  ].filter(Boolean).join(' | ');
}

function groupItems(items: EstimateLineItem[]) {
  const groups = new Map<string, Array<{ item: EstimateLineItem; parts: ReturnType<typeof scopeParts> }>>();
  items.forEach((item) => {
    const parts = scopeParts(item);
    const rows = groups.get(parts.room) || [];
    rows.push({ item, parts });
    groups.set(parts.room, rows);
  });
  return Array.from(groups.entries());
}

export function EstimateDetails() {
  const { id } = useParams<{ id: string }>();
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!id) return;
      setIsLoading(true);
      setError('');
      try {
        const estimatePayload = await apiJson<{ data: Estimate }>(`/v1/estimates/${id}`);
        const loadedEstimate = estimatePayload.data;
        const [leadPayload, activityPayload] = await Promise.all([
          loadedEstimate.leadId ? apiJson<{ data?: { customer?: Customer } }>(`/v1/leads/${loadedEstimate.leadId}`).catch(() => null) : Promise.resolve(null),
          apiJson<{ data?: Activity[] }>(`/v1/estimates/${loadedEstimate.id}/activity`).catch(() => ({ data: [] })),
        ]);
        if (cancelled) return;
        setEstimate(loadedEstimate);
        setCustomer(leadPayload?.data?.customer || null);
        setActivity(activityPayload?.data || []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Estimate details could not be loaded');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const pkg = useMemo(() => proposalPackage(estimate), [estimate]);
  const includedItems = useMemo(() => packageItems(pkg).filter((item) => item.customerVisible !== false && !item.optional), [pkg]);
  const optionalItems = useMemo(() => packageItems(pkg).filter((item) => item.customerVisible !== false && item.optional), [pkg]);
  const previewPath = estimate?.customerPreviewUrl || estimate?.publicUrl || (estimate ? `/estimates/${estimate.id}` : '/estimates');
  const previewHref = previewPath.startsWith('http') ? new URL(previewPath).pathname : previewPath;
  const netPaid = (estimate?.payments || []).reduce((sum, payment) => sum + Number(payment.amount || 0) - Number(payment.refundedAmount || 0), 0);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-6xl px-1 pb-24 sm:px-0">
        <Card><CardContent className="p-8 text-center text-gray-500">Loading estimate details...</CardContent></Card>
      </div>
    );
  }

  if (error || !estimate) {
    return (
      <div className="mx-auto max-w-4xl px-1 pb-24 sm:px-0">
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-6 text-red-900">
            <p className="font-semibold">Estimate details could not be loaded</p>
            <p className="mt-1 text-sm">{error || 'Check the API server and try again.'}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-1 pb-24 sm:px-0">
      <div className="grid gap-5">
        {estimate.status === 'voided' && (
          <Card className="border-red-200 bg-red-50" padding="sm">
            <p className="font-semibold text-red-950">This signed agreement has been voided.</p>
            <p className="mt-1 text-sm text-red-900">The customer preview stays inactive, but the contractor record remains available here for scope, payment, and audit history.</p>
          </Card>
        )}

        {estimate.status === 'superseded' && (
          <Card className="border-amber-200 bg-amber-50" padding="sm">
            <p className="font-semibold text-amber-950">This signed agreement was superseded by a revision.</p>
            <p className="mt-1 text-sm text-amber-900">Use this page for the historical record. Customers should use the latest proposal link for approval or payment.</p>
          </Card>
        )}

        <Card>
          <CardContent>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="pf-section-title">Estimate {estimate.id.slice(0, 8)}</h1>
                  <StatusBadge status={estimate.status} />
                </div>
                <p className="pf-copy mt-2">Internal contractor record. Customer preview links for voided or superseded agreements remain inactive.</p>
              </div>
              <div className="flex flex-wrap gap-2 lg:justify-end">
                <Button as="a" href={previewHref} variant="secondary" size="sm">Preview link</Button>
                {(['draft', 'sent'].includes(estimate.status) && !estimate.signedAt) && (
                  <Button as="a" href={`/estimates/production?estimateId=${estimate.id}`} size="sm">Edit estimate</Button>
                )}
                <Button as="a" href={`/estimates/${estimate.id}/photos`} variant="ghost" size="sm">Photos</Button>
              </div>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
              <div className="rounded-lg border bg-blue-50 px-3 py-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-blue-800">Total</p>
                <p className="mt-1 text-xl font-semibold text-blue-950">{formatMoney(estimate.total)}</p>
              </div>
              <TimelineTile label="Created" value={dateOnly(estimate.createdAt)} />
              <TimelineTile label="Sent" value={dateOnly(estimate.sentAt)} />
              <TimelineTile label="Signed" value={estimate.signedAt ? `${dateOnly(estimate.signedAt)}${estimate.signedName ? ` by ${estimate.signedName}` : ''}` : 'Not signed'} />
              <TimelineTile label="Updated" value={dateOnly(estimate.updatedAt)} />
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(320px,1fr)]">
          <div className="grid gap-5">
            <CustomerCard customer={customer} />
            <ScopeCard includedItems={includedItems} optionalItems={optionalItems} />
          </div>
          <aside className="grid gap-5 self-start">
            <Card>
              <CardHeader title="Payments" description={`${formatMoney(netPaid)} net recorded`} />
              <CardContent>
                {(estimate.payments || []).length ? (
                  <div className="divide-y">
                    {(estimate.payments || []).map((payment) => (
                      <div key={payment.id} className="py-3 text-sm first:pt-0 last:pb-0">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-medium text-gray-950">
                              {formatMoney(payment.amount)}
                              {Number(payment.refundedAmount || 0) > 0 && <span className="text-red-700"> ({formatMoney(payment.refundedAmount)} refunded)</span>}
                            </p>
                            <p className="mt-1 text-gray-600">{payment.description || labelize(payment.source || 'payment')}</p>
                          </div>
                          <div className="text-right">
                            <StatusBadge status={payment.status || 'succeeded'} />
                            <p className="mt-1 text-xs text-gray-500">{dateOnly(payment.receivedAt)}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">No payment history is attached to this estimate.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader title="Activity Log" />
              <CardContent>
                {activity.length ? (
                  <div className="divide-y">
                    {activity.map((item) => (
                      <div key={item.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-600" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-950">{labelize(String(item.action || '').replace(/\./g, ' '))}</p>
                          <p className="mt-1 text-xs text-gray-500">{dateTime(item.createdAt)}</p>
                          {item.metadata?.reason && <p className="mt-1 text-sm text-gray-600">{item.metadata.reason}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">No estimate activity has been recorded yet.</p>
                )}
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>
    </div>
  );
}

function TimelineTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-gray-50 px-3 py-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-sm font-medium text-gray-950">{value}</p>
    </div>
  );
}

function CustomerCard({ customer }: { customer: Customer | null }) {
  if (!customer) {
    return <Card><CardContent className="text-sm text-gray-500">Customer details unavailable.</CardContent></Card>;
  }
  const address = formatAddress(customer);
  return (
    <Card>
      <CardContent>
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Customer</p>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <Link to={`/leads/${customer.id}`} className="text-xl font-semibold text-gray-950 hover:text-blue-700">{customer.name || 'Customer'}</Link>
            <div className="mt-2 text-sm text-gray-700">{address || 'No jobsite address'}</div>
          </div>
          <div className="text-sm text-gray-600 sm:text-right">
            <p>{customer.phone ? formatPhone(customer.phone) : 'No phone'}</p>
            <p>{customer.email || 'No email'}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ScopeCard({ includedItems, optionalItems }: { includedItems: EstimateLineItem[]; optionalItems: EstimateLineItem[] }) {
  if (!includedItems.length && !optionalItems.length) {
    return <Card><CardContent className="text-sm text-gray-500">No scope lines are stored on this estimate.</CardContent></Card>;
  }
  return (
    <Card padding="none">
      <div className="border-b p-4">
        <h2 className="font-semibold text-gray-950">Scope Details</h2>
        <p className="mt-1 text-sm text-gray-600">Internal detail is preserved even when the public preview is inactive.</p>
      </div>
      <div className="divide-y">
        {groupItems(includedItems).map(([room, rows]) => (
          <div key={room} className="p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-medium text-gray-950">{room}</h3>
              <span className="text-xs text-gray-500">{rows.length} substrate{rows.length === 1 ? '' : 's'}</span>
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="py-2 pr-3 font-semibold">Substrate</th>
                    <th className="py-2 pr-3 font-semibold">Details</th>
                    <th className="py-2 pr-3 text-right font-semibold">Qty</th>
                    <th className="py-2 pr-3 text-right font-semibold">Rate</th>
                    <th className="py-2 text-right font-semibold">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map(({ item, parts }, index) => (
                    <tr key={`${parts.surface}-${index}`}>
                      <td className="py-2 pr-3 font-medium text-gray-900">{labelize(parts.surface)}</td>
                      <td className="py-2 pr-3 text-gray-600">{itemDetails(item) || item.notes || 'Included'}</td>
                      <td className="py-2 pr-3 text-right text-gray-700">{Number(item.qty || 1).toLocaleString('en-US', { maximumFractionDigits: 2 })} {labelize(item.category || '')}</td>
                      <td className="py-2 pr-3 text-right text-gray-700">{formatMoney(item.rate || 0)}</td>
                      <td className="py-2 text-right font-medium text-gray-950">{formatMoney(Number(item.qty || 1) * Number(item.rate || 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
        {optionalItems.length > 0 && (
          <div className="p-4">
            <h3 className="font-medium text-gray-950">Optional Items</h3>
            <div className="mt-3 grid gap-2">
              {optionalItems.map((item, index) => (
                <div key={`${item.desc}-${index}`} className="rounded-md border bg-gray-50 p-3 text-sm">
                  <span className="font-medium">{scopeParts(item).surface}</span>
                  <span className="text-gray-600"> - {itemDetails(item) || item.notes || 'Optional scope'}</span>
                  <span className="float-right font-semibold">{formatMoney(Number(item.qty || 1) * Number(item.rate || 0))}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
