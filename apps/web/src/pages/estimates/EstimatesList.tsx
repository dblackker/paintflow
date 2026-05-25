import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, StatusBadge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icon';
import { Input, Select } from '@/components/Input';
import { apiJson, formatAddress, formatMoney, formatPhone, labelize } from '@/lib/api';

interface EstimatePackage {
  name?: string;
  total?: number | string;
  subtotal?: number | string;
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
  const proposal = estimate.packages?.find((item) => item.name === 'proposal') || estimate.packages?.[0];
  return Number(proposal?.total ?? proposal?.subtotal ?? estimate.total ?? 0);
}

function formatDate(value?: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
}

export function EstimatesList() {
  const [estimates, setEstimates] = useState<Estimate[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;
    setIsLoading(true);
    apiJson<EstimatesResponse>('/v1/estimates')
      .then((response) => {
        if (!mounted) return;
        setEstimates(response.data || []);
        setError('');
      })
      .catch((err: Error) => {
        if (!mounted) return;
        setError(err.message || 'Failed to load estimates');
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const filteredEstimates = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return estimates.filter((estimate) => {
      const haystack = [
        estimate.leadName,
        estimate.leadPhone,
        estimate.leadEmail,
        formatAddress(estimate),
        estimate.status,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      const matchesSearch = !query || haystack.includes(query);
      const matchesStatus = statusFilter === 'all' || estimate.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [estimates, searchQuery, statusFilter]);

  const statusOptions = useMemo(() => {
    const statuses = Array.from(new Set(estimates.map((estimate) => estimate.status).filter(Boolean))) as string[];
    return [
      { value: 'all', label: 'All statuses' },
      ...statuses.sort().map((status) => ({ value: status, label: labelize(status) })),
    ];
  }, [estimates]);

  const stats = useMemo(() => ({
    total: estimates.length,
    sent: estimates.filter((estimate) => estimate.status === 'sent').length,
    approved: estimates.filter((estimate) => ['approved', 'accepted', 'signed'].includes(String(estimate.status))).length,
    draft: estimates.filter((estimate) => estimate.status === 'draft').length,
  }), [estimates]);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-8 lg:px-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 rounded bg-gray-200" />
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
    <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-8 lg:px-8">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-gray-950">Estimates</h2>
          <p className="mt-1 text-sm text-gray-600">Track sent, accepted, and declined painting proposals.</p>
        </div>
        <Link to="/estimates/production">
          <Button>Start estimate</Button>
        </Link>
      </div>

      <div className="mb-4 grid gap-3 md:grid-cols-2">
        <Link to="/estimates/production" className="block">
          <Card hoverable padding="md" className="h-full">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-gray-950">Production estimate</h3>
                <p className="mt-1 text-sm text-gray-600">Measured scope, prep, labor, paint products, payment terms, and client preview.</p>
              </div>
              <Badge variant="info">Default</Badge>
            </div>
          </Card>
        </Link>
        <Link to="/estimates/new" className="block">
          <Card hoverable padding="md" className="h-full">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-gray-950">Quick estimate</h3>
                <p className="mt-1 text-sm text-gray-600">Simple line items for small jobs or early ballpark pricing.</p>
              </div>
              <Badge>Simple</Badge>
            </div>
          </Card>
        </Link>
      </div>

      <Card padding="md" className="mb-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
          <Input
            type="search"
            placeholder="Search customer, phone, email, or address"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
          <Select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} options={statusOptions} />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ['Total', stats.total],
            ['Sent', stats.sent],
            ['Approved', stats.approved],
            ['Draft', stats.draft],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg bg-gray-50 px-3 py-2">
              <div className="text-xl font-semibold text-gray-950">{value}</div>
              <div className="text-xs font-medium text-gray-500">{label}</div>
            </div>
          ))}
        </div>
      </Card>

      {error && (
        <Card padding="md" className="mb-4 border-red-200 bg-red-50 text-sm text-red-800">
          {error}
        </Card>
      )}

      {filteredEstimates.length === 0 ? (
        <EmptyState
          icon={<Icon name="file-text" className="h-8 w-8" />}
          title="No estimates found"
          description="Start with a production estimate when you need a client-ready proposal with scope, terms, and payment schedule."
          action={{
            label: 'Start estimate',
            onClick: () => {
              window.location.href = '/estimates/production';
            },
          }}
        />
      ) : (
        <div className="grid gap-3">
          {filteredEstimates.map((estimate) => {
            const address = formatAddress(estimate);
            const previewUrl = estimate.customerPreviewUrl || estimate.publicUrl;
            return (
              <Card key={estimate.id} hoverable padding="md">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <Link to={estimate.leadId ? `/leads/${estimate.leadId}` : `/estimates/${estimate.id}`} className="truncate text-base font-semibold text-gray-950 hover:text-blue-700">
                        {estimate.leadName || 'Unnamed customer'}
                      </Link>
                      <StatusBadge status={String(estimate.status || 'draft')} />
                    </div>
                    {address && <p className="truncate text-sm text-gray-600">{address}</p>}
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-gray-500">
                      {estimate.leadPhone && <span>{formatPhone(estimate.leadPhone)}</span>}
                      {estimate.leadEmail && <span className="truncate">{estimate.leadEmail}</span>}
                    </div>
                    <div className="mt-2 space-y-0.5 text-xs text-gray-500">
                      <div>Created {formatDate(estimate.createdAt) || 'not recorded'}</div>
                      {estimate.sentAt && <div>Sent {formatDate(estimate.sentAt)}</div>}
                      {estimate.signedAt && <div>Signed {formatDate(estimate.signedAt)}</div>}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col gap-3 sm:items-end">
                    <div className="text-left sm:text-right">
                      <div className="text-lg font-semibold text-gray-950">{formatMoney(estimateTotal(estimate))}</div>
                      <div className="text-xs font-medium text-gray-500">Proposal total</div>
                    </div>
                    <div className="flex flex-wrap gap-2 sm:justify-end">
                      <Link to={`/estimates/${estimate.id}`}>
                        <Button variant="secondary" size="sm">Details</Button>
                      </Link>
                      <Link to={`/estimates/production?estimateId=${estimate.id}`}>
                        <Button variant="ghost" size="sm">Edit</Button>
                      </Link>
                      {previewUrl && (
                        <a href={previewUrl} target="_blank" rel="noreferrer">
                          <Button as="span" variant="ghost" size="sm">Preview link</Button>
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
