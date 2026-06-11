import { FormEvent, MouseEvent, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { StatusBadge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { Input, Select } from '@/components/Input';
import { AddressFields } from '@/components/AddressFields';
import { ServiceErrorState } from '@/components/ServiceErrorState';
import { apiJson, formatAddress, formatMoney, formatPhone, labelize } from '@/lib/api';
import { cleanZip } from '@/lib/locations';

const leadStatuses = [
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'estimate_sent', label: 'Estimate sent' },
  { value: 'won', label: 'Won' },
  { value: 'lost', label: 'Lost' },
];

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
  qboCustomerId?: string | null;
}

interface LeadSource {
  id: string;
  name: string;
  isActive?: boolean | null;
}

interface LeadForm {
  name: string;
  phone: string;
  email: string;
  streetAddress: string;
  city: string;
  state: string;
  postalCode: string;
  source: string;
}

const emptyForm: LeadForm = {
  name: '',
  phone: '',
  email: '',
  streetAddress: '',
  city: '',
  state: '',
  postalCode: '',
  source: '',
};

function formatDate(value?: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
}

function phoneDigits(value: string) {
  const digits = value.replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits.slice(0, 10);
}

function maskPhone(value: string) {
  const digits = phoneDigits(value);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export function Leads() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [sources, setSources] = useState<LeadSource[]>([]);
  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') || '');
  const [debouncedSearch, setDebouncedSearch] = useState(searchParams.get('q') || '');
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') || 'all');
  const [sourceFilter, setSourceFilter] = useState(searchParams.get('source') || 'all');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(searchParams.get('new') === '1');
  const [form, setForm] = useState<LeadForm>(emptyForm);

  function openLeadModal() {
    setForm(emptyForm);
    setIsModalOpen(true);
  }

  function closeLeadModal() {
    setForm(emptyForm);
    setIsModalOpen(false);
    if (searchParams.get('new') === '1') {
      const next = new URLSearchParams(searchParams);
      next.delete('new');
      setSearchParams(next, { replace: true });
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(searchQuery.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    document.body.classList.toggle('pf-modal-open', isModalOpen);
    return () => document.body.classList.remove('pf-modal-open');
  }, [isModalOpen]);

  useEffect(() => {
    if (searchParams.get('new') === '1') setIsModalOpen(true);
  }, [searchParams]);

  useEffect(() => {
    const next = new URLSearchParams();
    if (statusFilter !== 'all') next.set('status', statusFilter);
    if (sourceFilter !== 'all') next.set('source', sourceFilter);
    if (debouncedSearch) next.set('q', debouncedSearch);
    setSearchParams(next, { replace: true });
  }, [debouncedSearch, setSearchParams, sourceFilter, statusFilter]);

  useEffect(() => {
    loadSources();
  }, []);

  useEffect(() => {
    loadLeads();
  }, [debouncedSearch, sourceFilter, statusFilter]);

  async function loadSources() {
    try {
      const response = await apiJson<{ data: LeadSource[] }>('/v1/lead-sources');
      setSources((response.data || []).filter((source) => source.isActive !== false));
    } catch {
      setSources([]);
    }
  }

  async function loadLeads() {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('limit', '200');
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (sourceFilter !== 'all') params.set('source', sourceFilter);
      if (debouncedSearch) params.set('q', debouncedSearch);
      const response = await apiJson<{ data: Lead[] }>(`/v1/leads?${params.toString()}`);
      setLeads(response.data || []);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load leads');
    } finally {
      setIsLoading(false);
    }
  }

  async function updateLeadStatus(id: string, status: string) {
    const previous = leads;
    setLeads((current) => current.map((lead) => lead.id === id ? { ...lead, status } : lead));
    try {
      await apiJson(`/v1/leads/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      window.showToast?.('Lead updated', 'success');
      loadLeads();
    } catch (err) {
      setLeads(previous);
      window.showToast?.(err instanceof Error ? err.message : 'Failed to update lead', 'error');
    }
  }

  async function submitLead(event: FormEvent) {
    event.preventDefault();
    if (isSaving) return;

    const payload = {
      ...form,
      name: form.name.trim(),
      phone: form.phone.trim() || undefined,
      email: form.email.trim() || undefined,
      streetAddress: form.streetAddress.trim() || undefined,
      city: form.city.trim() || undefined,
      state: form.state.trim().toUpperCase() || undefined,
      postalCode: cleanZip(form.postalCode) || undefined,
      source: form.source || undefined,
    };

    if (!payload.phone && !payload.email) {
      window.showToast?.('Add a phone number or email', 'error');
      return;
    }
    if (payload.phone && phoneDigits(payload.phone).length !== 10) {
      window.showToast?.('Enter a 10-digit phone number', 'error');
      return;
    }

    setIsSaving(true);
    try {
      await apiJson<{ data: Lead }>('/v1/leads', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify(payload),
      });
      window.showToast?.('Lead created', 'success');
      closeLeadModal();
      setSearchParams(new URLSearchParams(), { replace: true });
      loadLeads();
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to create lead', 'error');
    } finally {
      setIsSaving(false);
    }
  }

  const isFiltered = statusFilter !== 'all' || sourceFilter !== 'all' || Boolean(debouncedSearch);
  const canSaveLead = Boolean(form.name.trim() && (form.phone.trim() || form.email.trim()));

  return (
    <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-8 lg:px-8">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="pf-page-copy">Capture inquiries, qualify them, and keep follow-up moving.</p>
        </div>
        <Button fullWidth className="sm:w-auto" onClick={openLeadModal}>
          <Icon name="plus" className="pf-icon" />
          Add lead
        </Button>
      </div>

      <Card padding="md" className="mb-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_160px_180px]">
          <Input
            aria-label="Search leads"
            type="search"
            autoComplete="off"
            enterKeyHint="search"
            placeholder="Search name, phone, email, or address"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
          <Select
            aria-label="Filter leads by status"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            options={[{ value: 'all', label: 'All statuses' }, ...leadStatuses]}
          />
          <Select
            aria-label="Filter leads by source"
            value={sourceFilter}
            onChange={(event) => setSourceFilter(event.target.value)}
            options={[
              { value: 'all', label: 'All sources' },
              ...sources.map((source) => ({ value: source.name, label: source.name })),
            ]}
          />
        </div>
      </Card>

      {error && (
        <div className="mb-4">
          <ServiceErrorState error={error} pageName="Leads" title="Leads are unavailable" onRetry={loadLeads} compact />
        </div>
      )}

      {isLoading ? (
        <div className="grid gap-3">
          {[0, 1, 2].map((item) => <div key={item} className="h-28 animate-pulse rounded-lg bg-gray-200" />)}
        </div>
      ) : leads.length === 0 ? (
        isFiltered ? (
          <Card padding="lg" className="text-center">
            <p className="pf-row-title">No leads match this view</p>
            <p className="pf-copy mt-1">Clear the search or change filters to see more customers.</p>
            <Button variant="secondary" className="mt-4" onClick={() => {
              setSearchQuery('');
              setStatusFilter('all');
              setSourceFilter('all');
            }}>
              Clear filters
            </Button>
          </Card>
        ) : (
          <FirstLeadEmptyState onAddLead={openLeadModal} />
        )
      ) : (
        <div className="grid gap-2 sm:gap-3">
          {leads.map((lead) => (
            <LeadCard key={lead.id} lead={lead} onStatusChange={updateLeadStatus} />
          ))}
        </div>
      )}

      {isModalOpen && (
        <div
          className="mobile-sheet fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="lead-modal-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeLeadModal();
          }}
        >
          <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-lg bg-white p-5 shadow-xl sm:rounded-lg sm:p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 id="lead-modal-title" className="pf-section-title">Add lead</h3>
              <Button variant="ghost" size="sm" onClick={closeLeadModal}>Close</Button>
            </div>
            <form className="space-y-4" onSubmit={submitLead}>
              <Input
                label="Name *"
                autoComplete="name"
                enterKeyHint="next"
                required
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  label="Phone"
                  type="tel"
                  autoComplete="tel"
                  inputMode="numeric"
                  placeholder="(555) 123-4567"
                  enterKeyHint="next"
                  value={form.phone}
                  onChange={(event) => setForm({ ...form, phone: maskPhone(event.target.value) })}
                />
                <Input
                  label="Email"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  placeholder="customer@example.com"
                  enterKeyHint="next"
                  value={form.email}
                  onChange={(event) => setForm({ ...form, email: event.target.value })}
                />
              </div>
              <AddressFields
                streetLabel="Jobsite street address"
                value={form}
                onChange={(address) => setForm({ ...form, ...address })}
              />
              <Select
                label="Source"
                value={form.source}
                onChange={(event) => setForm({ ...form, source: event.target.value })}
                options={[
                  { value: '', label: 'Select source...' },
                  ...sources.map((source) => ({ value: source.name, label: source.name })),
                ]}
              />
              <div className="mobile-sticky-actions flex gap-3 pt-4 sm:static sm:m-0 sm:border-0 sm:bg-transparent sm:p-0">
                <Button type="button" variant="secondary" fullWidth onClick={closeLeadModal}>Cancel</Button>
                <Button type="submit" fullWidth isLoading={isSaving} disabled={!canSaveLead}>Save lead</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function LeadCard({ lead, onStatusChange }: { lead: Lead; onStatusChange: (id: string, status: string) => void }) {
  const address = formatAddress(lead);
  const contactLine = [lead.phone && formatPhone(lead.phone), lead.email].filter(Boolean).join('   ');

  function stop(event: MouseEvent) {
    event.stopPropagation();
  }

  return (
    <Card hoverable padding="md" className="mobile-card-row">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <Link to={`/leads/${lead.id}`} className="min-w-0 flex-1">
          <div className="mb-1 flex min-w-0 flex-wrap items-center gap-2">
            <h3 className="pf-row-title truncate">{lead.name || 'Unnamed lead'}</h3>
            <StatusBadge status={String(lead.status || 'new')} />
            {lead.qboCustomerId && <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">QB</span>}
          </div>
          {contactLine && <p className="pf-copy truncate">{contactLine}</p>}
          {address && <p className="pf-copy mt-1 truncate">{address}</p>}
          <p className="pf-meta mt-2">
            {[lead.source || 'No source', formatDate(lead.createdAt)].filter(Boolean).map((item, index) => index === 0 ? labelize(item) : `Created ${item}`).join(' - ')}
          </p>
        </Link>

        <div className="flex shrink-0 flex-col gap-2 sm:w-52">
          <Select
            aria-label={`Status for ${lead.name}`}
            value={lead.status || 'new'}
            onClick={stop}
            onChange={(event) => onStatusChange(lead.id, event.target.value)}
            options={leadStatuses}
          />
          <div className="flex flex-nowrap gap-1 sm:justify-end" onClick={stop}>
            {lead.phone && (
              <a href={`tel:${lead.phone}`} className="btn-icon btn-icon-outlined" aria-label={`Call ${lead.name}`} title="Call">
                <Icon name="phone" className="pf-icon" />
              </a>
            )}
            {lead.email && (
              <a href={`mailto:${lead.email}`} className="btn-icon btn-icon-outlined" aria-label={`Email ${lead.name}`} title="Email">
                <Icon name="mail" className="pf-icon" />
              </a>
            )}
            <Link to={`/sms?leadId=${lead.id}`} className="btn-icon btn-icon-outlined" aria-label={`Text ${lead.name}`} title="Text">
              <Icon name="message" className="pf-icon" />
            </Link>
            <Link to={`/estimates/production?leadId=${lead.id}`} className="btn-icon btn-icon-tonal" aria-label={`Create estimate for ${lead.name}`} title="Create estimate">
              <Icon name="file-text" className="pf-icon" />
            </Link>
          </div>
          {lead.estimatedValue && <p className="pf-row-title text-right">{formatMoney(lead.estimatedValue)}</p>}
        </div>
      </div>
    </Card>
  );
}

function FirstLeadEmptyState({ onAddLead }: { onAddLead: () => void }) {
  return (
    <Card padding="lg">
      <div className="mx-auto max-w-2xl text-center">
        <p className="pf-section-title">Start with your first lead</p>
        <p className="pf-copy mt-2">
          Add a homeowner, jobsite address, and source. From there you can text or call them, create an estimate, schedule follow-ups, and move the customer through the pipeline.
        </p>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <InfoTile title="1. Add inquiry" text="Name, phone, email, jobsite, and how they found you." />
        <InfoTile title="2. Qualify" text="Capture notes, book a visit, or start an estimate." />
        <InfoTile title="3. Follow up" text="Keep reminders and pipeline movement attached to the customer." />
      </div>
      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
        <Button onClick={onAddLead}>Add first lead</Button>
        <Link to="/settings#lead-sources" className="btn-secondary justify-center">Set lead sources</Link>
        <Link to="/pipeline" className="btn-text justify-center">View pipeline</Link>
      </div>
    </Card>
  );
}

function InfoTile({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-lg border bg-gray-50 p-3">
      <p className="pf-row-title">{title}</p>
      <p className="pf-copy mt-1">{text}</p>
    </div>
  );
}
