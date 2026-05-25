import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { StatusBadge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { Input } from '@/components/Input';
import { apiJson, formatAddress, formatMoney, formatPhone, labelize } from '@/lib/api';

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
  estimatedValue?: number | string | null;
}

interface LeadsResponse {
  data: Lead[];
}

function formatDate(value?: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
}

export function Leads() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;
    setIsLoading(true);
    apiJson<LeadsResponse>('/v1/leads?limit=100')
      .then((response) => {
        if (!mounted) return;
        setLeads(response.data || []);
        setError('');
      })
      .catch((err: Error) => {
        if (!mounted) return;
        setError(err.message || 'Failed to load leads');
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const filteredLeads = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return leads.filter((lead) => {
      const haystack = [lead.name, lead.phone, lead.email, formatAddress(lead), lead.source, lead.status]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return !query || haystack.includes(query);
    });
  }, [leads, searchQuery]);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-8 lg:px-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-40 rounded bg-gray-200" />
          <div className="h-11 rounded bg-gray-200" />
          <div className="h-24 rounded-xl bg-gray-200" />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-8 lg:px-8">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-gray-950">Leads</h2>
          <p className="mt-1 text-sm text-gray-600">Capture inquiries, qualify them, and keep follow-up moving.</p>
        </div>
        <Button onClick={() => window.dispatchEvent(new CustomEvent('paintflow:add-lead'))}>Add lead</Button>
      </div>

      <Card padding="md" className="mb-4">
        <Input
          type="search"
          placeholder="Search name, phone, email, address, or source"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
        />
      </Card>

      {error && (
        <Card padding="md" className="mb-4 border-red-200 bg-red-50 text-sm text-red-800">
          {error}
        </Card>
      )}

      {filteredLeads.length === 0 ? (
        <EmptyState
          title="No leads found"
          description="Create a lead when a homeowner calls, submits a web form, or asks for an estimate."
          action={<Button onClick={() => window.dispatchEvent(new CustomEvent('paintflow:add-lead'))}>Add lead</Button>}
        />
      ) : (
        <div className="grid gap-3">
          {filteredLeads.map((lead) => {
            const address = formatAddress(lead);
            return (
              <Card key={lead.id} hoverable padding="md">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <Link to={`/leads/${lead.id}`} className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-base font-semibold text-gray-950">{lead.name || 'Unnamed lead'}</h3>
                      <StatusBadge status={String(lead.status || 'new')} />
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-gray-600">
                      {lead.phone && <span>{formatPhone(lead.phone)}</span>}
                      {lead.email && <span className="truncate">{lead.email}</span>}
                    </div>
                    {address && <p className="mt-1 truncate text-sm text-gray-600">{address}</p>}
                    <p className="mt-2 text-xs text-gray-500">
                      {[lead.source && `Source: ${labelize(lead.source)}`, formatDate(lead.createdAt) && `Created ${formatDate(lead.createdAt)}`].filter(Boolean).join(' · ')}
                    </p>
                  </Link>
                  <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
                    {lead.estimatedValue && (
                      <div className="mr-1 text-sm font-semibold text-gray-950 sm:text-right">
                        {formatMoney(lead.estimatedValue)}
                      </div>
                    )}
                    <Link to={`/estimates/production?leadId=${lead.id}`}>
                      <Button variant="secondary" size="sm">Estimate</Button>
                    </Link>
                    <Link to={`/sms?leadId=${lead.id}`}>
                      <Button variant="ghost" size="sm">Message</Button>
                    </Link>
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
