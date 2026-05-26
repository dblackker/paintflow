import { FormEvent, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AddressInline } from '@/components/AddressInline';
import { StatusBadge } from '@/components/Badge';
import { Card, CardHeader } from '@/components/Card';
import { CrewTimecardModal, CrewTimecardPayload } from '@/components/CrewTimecardModal';
import { Icon } from '@/components/Icon';
import { Modal, ModalFooter } from '@/components/Modal';
import { API_URL, apiJson, formatAddress, formatMoney, formatPhone, labelize } from '@/lib/api';

interface JobCost {
  id: string;
  category?: string | null;
  description?: string | null;
  quantity?: string | number | null;
  unitCost?: string | number | null;
  totalCost?: string | number | null;
  createdAt?: string | null;
}

interface ChangeOrder {
  id: string;
  description?: string | null;
  title?: string | null;
  status?: string | null;
  amount?: string | number | null;
  createdBy?: string | null;
  createdAt?: string | null;
  sentAt?: string | null;
  paymentRequired?: boolean | null;
  paymentStatus?: string | null;
  paymentDueAmount?: string | number | null;
}

interface MaterialPurchase {
  id: string;
  supplier?: string | null;
  vendor?: string | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  totalAmount?: string | number | null;
  totalCost?: string | number | null;
  purchasedAt?: string | null;
  createdAt?: string | null;
}

interface TeamMember {
  id: string;
  name: string;
  role?: string | null;
  hourlyRate?: string | number | null;
  burdenRate?: string | number | null;
  isActive?: boolean | null;
}

interface TimeEntry {
  id: string;
  teamMemberId?: string | null;
  teamMemberName?: string | null;
  jobId?: string | null;
  hours?: string | number | null;
  hourlyRate?: string | number | null;
  totalCost?: string | number | null;
  date?: string | null;
  description?: string | null;
}

interface JobPhoto {
  id: string;
  url?: string | null;
  caption?: string | null;
  type?: string | null;
  createdAt?: string | null;
}

interface JobCostingResponse {
  data: {
    job: {
      id: string;
      name?: string | null;
      status?: string | null;
      budget?: number | string | null;
      estimateId?: string | null;
      leadId?: string | null;
      leadName?: string | null;
      leadEmail?: string | null;
      leadPhone?: string | null;
      leadStreetAddress?: string | null;
      leadCity?: string | null;
      leadState?: string | null;
      leadPostalCode?: string | null;
      completedAt?: string | null;
    };
    revenue: { contract: number; approvedChangeOrders: number; total: number };
    costs: { labor: number; materials: number; supplies: number; expenses: number; total: number };
    production: { laborHours: number; averageLaborRate: number };
    budget: { estimatedMaterials?: number | null; materialVariance?: number | null; remainingGrossProfit: number };
    profitability: { grossProfit: number; grossMargin: number; costToRevenue: number };
    lists: {
      costs: JobCost[];
      changeOrders: ChangeOrder[];
      materialPurchases: MaterialPurchase[];
    };
  };
}

const costCategories = ['materials', 'supplies', 'labor', 'subcontractor', 'equipment', 'other'];

function formatDate(value?: string | null) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not recorded';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function formatPercent(value: number) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function numberValue(value: unknown) {
  return Number(value || 0);
}

function photoSrc(photo: JobPhoto) {
  return photo.id ? `${API_URL}/v1/uploads/photos/file/${encodeURIComponent(photo.id)}` : photo.url || '';
}

function streetAddress(job: JobCostingResponse['data']['job']) {
  return String(job.leadStreetAddress || '').trim();
}

function jobScope(job: JobCostingResponse['data']['job']) {
  const haystack = String(job.name || '').toLowerCase();
  if (/(exterior|siding|fascia|soffit|roofline|repaint)/.test(haystack)) return 'Exterior';
  if (/(cabinet|vanity|built-in)/.test(haystack)) return 'Cabinets';
  if (/(commercial|office|workspace|tenant)/.test(haystack)) return 'Commercial';
  if (/(interior|bedroom|bathroom|kitchen|living|walls|ceilings|trim|doors)/.test(haystack)) return 'Interior';
  return '';
}

function displayJobName(job: JobCostingResponse['data']['job']) {
  const name = String(job.name || '').trim();
  const leadName = String(job.leadName || '').trim();
  const street = streetAddress(job);
  const scope = jobScope(job);
  const genericNames = [
    `${leadName} - proposal`,
    `${leadName} painting project`,
    `${leadName} painting`,
    `${leadName} - job`,
  ].map((item) => item.toLowerCase());
  if (leadName && genericNames.includes(name.toLowerCase())) {
    return [leadName, scope, street].filter(Boolean).join(' - ');
  }
  if (leadName && scope && street && !name.includes(' - ')) return [leadName, scope, street].join(' - ');
  return name || [leadName || 'Customer', street].filter(Boolean).join(' - ') || 'Job detail';
}

function iconButtonLabel(action: string, subject?: string | null) {
  return `${action}${subject ? ` ${subject}` : ''}`;
}

export function JobDetail() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<JobCostingResponse['data'] | null>(null);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [photos, setPhotos] = useState<JobPhoto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [costModalOpen, setCostModalOpen] = useState(false);
  const [editingCost, setEditingCost] = useState<JobCost | null>(null);
  const [savingCost, setSavingCost] = useState(false);
  const [changeOrderOpen, setChangeOrderOpen] = useState(false);
  const [savingChangeOrder, setSavingChangeOrder] = useState(false);
  const [approvalLink, setApprovalLink] = useState('');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [savingBulk, setSavingBulk] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);

  async function loadJob() {
    if (!id) return;
    setIsLoading(true);
    try {
      const [costingResponse, membersResponse, timeResponse, photoResponse] = await Promise.all([
        apiJson<JobCostingResponse>(`/v1/jobs/${id}/costing`),
        apiJson<{ data: TeamMember[] }>('/v1/team/members').catch(() => ({ data: [] })),
        apiJson<{ data: TimeEntry[] }>(`/v1/team/time?jobId=${id}`).catch(() => ({ data: [] })),
        apiJson<{ data: JobPhoto[] }>(`/v1/uploads/photos/${id}`).catch(() => ({ data: [] })),
      ]);
      setDetail(costingResponse.data);
      setTeamMembers(membersResponse.data || []);
      setTimeEntries(timeResponse.data || []);
      setPhotos(photoResponse.data || []);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load job');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadJob();
  }, [id]);

  const job = detail?.job;
  const address = job ? formatAddress(job) : '';
  const totalTimeHours = timeEntries.reduce((sum, entry) => sum + numberValue(entry.hours), 0);
  const totalTimeCost = timeEntries.reduce((sum, entry) => sum + numberValue(entry.totalCost), 0);

  function openCostModal(cost?: JobCost) {
    setEditingCost(cost || null);
    setCostModalOpen(true);
  }

  async function saveCost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!id) return;
    const formData = new FormData(event.currentTarget);
    const body = {
      category: String(formData.get('category') || 'materials'),
      description: String(formData.get('description') || '').trim(),
      quantity: Number(formData.get('quantity') || 0),
      unitCost: Number(formData.get('unitCost') || 0),
    };
    if (!body.description || body.quantity <= 0 || body.unitCost <= 0) {
      window.showToast?.('Enter a description, quantity, and unit cost.', 'error');
      return;
    }
    setSavingCost(true);
    try {
      await apiJson(editingCost ? `/v1/jobs/${id}/costs/${editingCost.id}` : `/v1/jobs/${id}/costs`, {
        method: editingCost ? 'PATCH' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify(body),
      });
      setCostModalOpen(false);
      setEditingCost(null);
      await loadJob();
      window.showToast?.(editingCost ? 'Cost updated' : 'Cost added', 'success');
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to save cost', 'error');
    } finally {
      setSavingCost(false);
    }
  }

  async function deleteCost(cost: JobCost) {
    if (!id || !confirm(`Remove ${cost.description || 'this cost'}? This updates job costing totals.`)) return;
    try {
      await apiJson(`/v1/jobs/${id}/costs/${cost.id}`, { method: 'DELETE' });
      await loadJob();
      window.showToast?.('Cost removed', 'success');
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to remove cost', 'error');
    }
  }

  async function markComplete() {
    if (!id || !confirm('Mark this job completed?')) return;
    try {
      await apiJson(`/v1/jobs/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({ status: 'completed', completedAt: new Date().toISOString() }),
      });
      await loadJob();
      window.showToast?.('Job marked complete', 'success');
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to complete job', 'error');
    }
  }

  async function saveBulkTimecard(payload: CrewTimecardPayload) {
    if (!id) return;
    setSavingBulk(true);
    try {
      await apiJson('/v1/team/timecards', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify(payload),
      });
      setBulkOpen(false);
      await loadJob();
      window.showToast?.('Crew timecard submitted', 'success');
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to submit timecard', 'error');
    } finally {
      setSavingBulk(false);
    }
  }

  async function uploadPhoto(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!id) return;
    const form = event.currentTarget;
    const formData = new FormData(form);
    formData.set('jobId', id);
    if (!formData.get('file')) {
      window.showToast?.('Choose a photo to upload.', 'error');
      return;
    }
    setPhotoUploading(true);
    try {
      const response = await fetch(`${API_URL}/v1/uploads/photo`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Upload failed');
      form.reset();
      const photoResponse = await apiJson<{ data: JobPhoto[] }>(`/v1/uploads/photos/${id}`);
      setPhotos(photoResponse.data || []);
      window.showToast?.('Photo added', 'success');
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Upload failed', 'error');
    } finally {
      setPhotoUploading(false);
    }
  }

  async function saveChangeOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!id || !job?.estimateId) {
      window.showToast?.('Change orders require a job created from an estimate.', 'error');
      return;
    }
    const formData = new FormData(event.currentTarget);
    const amount = Number(formData.get('amount') || 0);
    const description = String(formData.get('description') || '').trim();
    const paymentRequired = formData.get('paymentRequired') === 'true';
    if (!description || amount <= 0) {
      window.showToast?.('Enter a description and positive amount.', 'error');
      return;
    }
    setSavingChangeOrder(true);
    try {
      await apiJson('/v1/change-orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          jobId: id,
          estimateId: job.estimateId,
          description,
          amount,
          status: String(formData.get('status') || 'pending'),
          createdBy: String(formData.get('createdBy') || 'contractor'),
          paymentRequired,
          depositPercent: paymentRequired ? Number(formData.get('depositPercent') || 100) : 0,
        }),
      });
      setChangeOrderOpen(false);
      await loadJob();
      window.showToast?.('Change order added', 'success');
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to add change order', 'error');
    } finally {
      setSavingChangeOrder(false);
    }
  }

  async function sendChangeOrder(order: ChangeOrder) {
    try {
      const response = await apiJson<{ data?: { link?: string; to?: string } }>(`/v1/change-orders/${order.id}/send-email`, {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      });
      const link = response.data?.link || '';
      if (link) {
        const copied = await navigator.clipboard?.writeText(link).then(() => true).catch(() => false);
        if (!copied) setApprovalLink(link);
      }
      await loadJob();
      window.showToast?.(response.data?.to ? `Change order emailed to ${response.data.to}` : 'Change order email sent', 'success');
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to send change order', 'error');
    }
  }

  async function updateChangeOrderStatus(order: ChangeOrder, status: 'approved' | 'completed') {
    if (status === 'approved' && !confirm('Mark this change order approved? This adds it to job revenue.')) return;
    try {
      await apiJson(`/v1/change-orders/${order.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({ status }),
      });
      await loadJob();
      window.showToast?.(status === 'approved' ? 'Change order approved' : 'Change order marked complete', 'success');
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to update change order', 'error');
    }
  }

  if (isLoading) {
    return (
      <div className="mx-auto max-w-7xl py-5 sm:py-8">
        <div className="animate-pulse space-y-4">
          <div className="h-28 rounded-xl bg-gray-200" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {[1, 2, 3, 4, 5].map((item) => <div key={item} className="h-24 rounded-xl bg-gray-200" />)}
          </div>
        </div>
      </div>
    );
  }

  if (error || !detail || !job) {
    return (
      <div className="mx-auto max-w-7xl py-5 sm:py-8">
        <Card className="border-red-200 bg-red-50 text-red-800">{error || 'Job not found'}</Card>
      </div>
    );
  }

  const kpis = [
    ['Revenue', formatMoney(detail.revenue.total), 'Contract plus approved change orders'],
    ['Actual Cost', formatMoney(detail.costs.total), 'All tracked costs'],
    ['Gross Profit', formatMoney(detail.profitability.grossProfit), 'Revenue less actual costs'],
    ['Gross Margin', formatPercent(detail.profitability.grossMargin), 'Gross profit divided by revenue'],
    ['Labor Hours', Number(detail.production.laborHours || 0).toFixed(2), `${formatMoney(detail.production.averageLaborRate)}/hr avg`],
  ];
  const breakdownRows = [
    ['Labor', detail.costs.labor],
    ['Materials', detail.costs.materials],
    ['Supplies', detail.costs.supplies],
    ['Other', detail.costs.expenses],
  ] as const;
  const lastEntry = timeEntries
    .slice()
    .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime())[0];

  return (
    <div className="mx-auto max-w-7xl py-5 sm:py-8">
      <section className="mb-6 rounded-lg border bg-white p-4 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h2 className="pf-page-title truncate">{displayJobName(job)}</h2>
              <StatusBadge status={String(job.status || 'scheduled')} />
            </div>
            <div className="space-y-1 text-sm text-gray-600">
              {job.leadName && (
                <Link to={`/leads/${job.leadId}`} className="font-medium text-gray-900 hover:text-blue-700">
                  {job.leadName}
                </Link>
              )}
              <AddressInline address={address} className="text-sm text-gray-700" />
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {job.leadPhone && <a href={`tel:${job.leadPhone}`} className="hover:text-blue-700">{formatPhone(job.leadPhone)}</a>}
                {job.leadEmail && <a href={`mailto:${job.leadEmail}`} className="hover:text-blue-700">{job.leadEmail}</a>}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
            {job.estimateId && <Link to={`/estimates/${job.estimateId}`} className="btn-secondary btn-sm">Estimate</Link>}
            {job.status !== 'completed' && (
              <button type="button" className="btn-tonal btn-sm" onClick={markComplete}>
                Mark complete
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {kpis.map(([label, value, help]) => (
          <Card key={label} padding="sm">
            <p className="pf-label text-xs uppercase text-gray-500">{label}</p>
            <p className="mt-1 text-xl font-semibold text-gray-950 sm:text-2xl">{value}</p>
            <p className="mt-1 text-xs text-gray-500">{help}</p>
          </Card>
        ))}
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card padding="none">
            <div className="flex items-center justify-between gap-3 border-b p-4">
              <CardHeader className="mb-0" title="Actual Costs" description="Labor, materials, supplies, subcontractors, equipment, and other job costs" />
              <button type="button" className="btn-primary btn-sm shrink-0" onClick={() => openCostModal()}>
                <Icon name="plus" className="h-4 w-4" />
                Add cost
              </button>
            </div>
            <div className="divide-y">
              {detail.lists.costs.length === 0 ? (
                <div className="p-6 text-sm text-gray-500">No actual job costs have been logged.</div>
              ) : detail.lists.costs.map((cost) => (
                <div key={cost.id} className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-gray-950">{cost.description || labelize(cost.category)}</p>
                      <StatusBadge status={String(cost.category || 'other')} />
                    </div>
                    <p className="mt-1 text-sm text-gray-600">
                      {numberValue(cost.quantity).toFixed(2)} x {formatMoney(cost.unitCost || 0)} - {formatDate(cost.createdAt)}
                    </p>
                  </div>
                  <div className="flex items-center justify-between gap-3 sm:justify-end sm:text-right">
                    <p className="font-semibold text-gray-950">{formatMoney(cost.totalCost || 0)}</p>
                    <div className="flex items-center gap-1.5">
                      <button type="button" className="btn-icon btn-icon-tonal" aria-label={iconButtonLabel('Edit', cost.description)} onClick={() => openCostModal(cost)}>
                        <Icon name="edit" className="h-4 w-4" />
                      </button>
                      <button type="button" className="btn-icon btn-icon-outlined btn-icon-danger" aria-label={iconButtonLabel('Remove', cost.description)} onClick={() => deleteCost(cost)}>
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v5M14 11v5" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card padding="none">
            <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
              <CardHeader className="mb-0" title="Crew Timecard" description="Fast end-of-day crew hours for this job. Pay and burdened rates are managed in Team." />
              <button type="button" className="btn-tonal btn-sm shrink-0" onClick={() => setBulkOpen(true)}>
                <Icon name="plus" className="h-4 w-4" />
                Crew timecard
              </button>
            </div>
            <div className="p-4">
              {teamMembers.length === 0 ? (
                <p className="text-sm text-gray-600">
                  Add active crew members on the <Link to="/team" className="font-medium text-blue-700">Team page</Link> before logging job timecards.
                </p>
              ) : (
                <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
                  <MiniMetric label="Active crew" value={teamMembers.length.toLocaleString()} />
                  <MiniMetric label="Logged hours" value={totalTimeHours.toFixed(2)} />
                  <MiniMetric label="Last entry" value={lastEntry ? formatDate(lastEntry.date) : 'None yet'} />
                </div>
              )}
            </div>
          </Card>

          <Card padding="none">
            <div className="border-b p-4">
              <CardHeader className="mb-0" title="Labor Timecards" description="Crew hours tied to this job and rolled into actual labor costs." />
            </div>
            <div className="divide-y">
              {timeEntries.length === 0 ? (
                <div className="p-6 text-sm text-gray-500">No crew timecards have been submitted for this job.</div>
              ) : (
                <>
                  <div className="flex flex-col gap-2 bg-gray-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm text-gray-600">{totalTimeHours.toFixed(2)} logged hours</p>
                    <p className="font-semibold text-gray-950">{formatMoney(totalTimeCost)} labor cost</p>
                  </div>
                  {timeEntries.map((entry) => (
                    <div key={entry.id} className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-[1fr_auto]">
                      <div>
                        <p className="font-medium text-gray-950">{entry.teamMemberName || 'Crew member'}</p>
                        <p className="text-sm text-gray-600">
                          {numberValue(entry.hours).toFixed(2)} hrs on {formatDate(entry.date)}
                          {entry.description ? ` - ${entry.description}` : ''}
                        </p>
                      </div>
                      <div className="sm:text-right">
                        <p className="font-semibold text-gray-950">{formatMoney(entry.totalCost || 0)}</p>
                        <p className="text-xs text-gray-500">{formatMoney(entry.hourlyRate || 0)}/hr burdened</p>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          </Card>

          <Card padding="none">
            <div className="flex items-center justify-between gap-3 border-b p-4">
              <CardHeader className="mb-0" title="Change Orders" />
              <button type="button" className="btn-secondary btn-sm" onClick={() => setChangeOrderOpen(true)}>Add change order</button>
            </div>
            <div className="divide-y">
              {detail.lists.changeOrders.length === 0 ? (
                <div className="p-6 text-sm text-gray-500">No change orders yet.</div>
              ) : detail.lists.changeOrders.map((order) => (
                <div key={order.id} className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-950">{order.description || order.title || 'Change order'}</p>
                    <p className="text-sm text-gray-600">{labelize(order.createdBy || 'contractor')} - {formatDate(order.createdAt)}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <StatusBadge status={String(order.status || 'pending')} />
                      {order.paymentRequired && <StatusBadge status={String(order.paymentStatus || 'pending')} />}
                      {order.sentAt && <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700">Sent</span>}
                    </div>
                  </div>
                  <div className="sm:text-right">
                    <p className="font-semibold text-gray-950">{formatMoney(order.amount || 0)}</p>
                    <p className="text-xs text-gray-500">
                      {order.paymentRequired ? `${formatMoney(order.paymentDueAmount || order.amount || 0)} due on approval` : 'No payment required'}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2 sm:justify-end">
                      {order.status === 'pending' && (
                        <button type="button" className="btn-secondary btn-sm" onClick={() => sendChangeOrder(order)}>
                          {order.sentAt ? 'Resend email' : 'Send for approval'}
                        </button>
                      )}
                      {order.status === 'pending' && (
                        <button type="button" className="btn-secondary btn-sm" onClick={() => updateChangeOrderStatus(order, 'approved')}>
                          Mark approved
                        </button>
                      )}
                      {order.status === 'approved' && (
                        <button type="button" className="btn-secondary btn-sm" onClick={() => updateChangeOrderStatus(order, 'completed')}>
                          Mark complete
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card padding="none">
            <div className="border-b p-4">
              <CardHeader className="mb-0" title="Material Purchases" description="Imported invoices linked to this job" />
            </div>
            <div className="divide-y">
              {detail.lists.materialPurchases.length === 0 ? (
                <div className="p-6 text-sm text-gray-500">No material invoices imported for this job.</div>
              ) : detail.lists.materialPurchases.map((purchase) => (
                <div key={purchase.id} className="flex justify-between gap-4 p-4">
                  <div>
                    <p className="font-medium text-gray-950">{purchase.supplier || purchase.vendor || 'Material purchase'}</p>
                    <p className="text-sm text-gray-600">Invoice {purchase.invoiceNumber || 'not set'} - {formatDate(purchase.invoiceDate || purchase.purchasedAt || purchase.createdAt)}</p>
                  </div>
                  <p className="font-semibold text-gray-950">{formatMoney(purchase.totalAmount || purchase.totalCost || 0)}</p>
                </div>
              ))}
            </div>
          </Card>

          <Card padding="none">
            <div className="border-b p-4">
              <CardHeader className="mb-0" title="Job Photos" description="Before, progress, and after photos for production proof and future marketing." />
            </div>
            <form className="grid gap-3 p-4 sm:grid-cols-[10rem_minmax(0,1fr)_minmax(0,1.2fr)_auto] sm:items-end" onSubmit={uploadPhoto}>
              <label>
                <span className="form-label">Type</span>
                <select name="type" className="input" defaultValue="progress">
                  <option value="before">Before</option>
                  <option value="progress">Progress</option>
                  <option value="after">After</option>
                </select>
              </label>
              <label>
                <span className="form-label">Caption</span>
                <input name="caption" type="text" autoComplete="off" className="input" placeholder="Kitchen after, south wall prep" />
              </label>
              <label>
                <span className="form-label">Photo</span>
                <input name="file" type="file" accept="image/*" className="input" required />
              </label>
              <button className="btn-primary" disabled={photoUploading}>{photoUploading ? 'Adding...' : 'Add photo'}</button>
            </form>
            <div className="border-t">
              {photos.length === 0 ? (
                <div className="p-5 text-sm text-gray-500">No job photos uploaded yet.</div>
              ) : (
                <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 xl:grid-cols-4">
                  {photos.map((photo) => (
                    <a key={photo.id} href={photoSrc(photo)} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border bg-gray-50">
                      <div className="aspect-[4/3] bg-gray-100">
                        <img src={photoSrc(photo)} alt={photo.caption || `${labelize(photo.type || 'progress')} job photo`} className="h-full w-full object-cover" loading="lazy" />
                      </div>
                      <div className="p-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold uppercase text-gray-600">{photo.type || 'progress'}</span>
                          <span className="text-xs text-gray-500">{formatDate(photo.createdAt)}</span>
                        </div>
                        {photo.caption && <p className="mt-1 truncate text-xs text-gray-700">{photo.caption}</p>}
                      </div>
                    </a>
                  ))}
                </div>
              )}
            </div>
          </Card>
        </div>

        <aside className="space-y-6">
          <Card>
            <CardHeader title="Cost Breakdown" />
            <div className="space-y-3">
              {breakdownRows.map(([label, value]) => (
                <div key={label}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="text-gray-600">{label}</span>
                    <span className="font-medium text-gray-950">{formatMoney(value)}</span>
                  </div>
                  <div className="h-2 rounded bg-gray-100">
                    <div className="h-2 rounded bg-blue-600" style={{ width: `${detail.costs.total > 0 ? Math.min(100, (value / detail.costs.total) * 100) : 0}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader title="Budget Signals" />
            <div className="space-y-3 text-sm">
              <Signal label="Estimated materials" value={detail.budget.estimatedMaterials == null ? 'Not estimated' : formatMoney(detail.budget.estimatedMaterials)} />
              <Signal
                label="Material variance"
                value={detail.budget.materialVariance == null ? 'Not available' : formatMoney(detail.budget.materialVariance)}
                valueClassName={detail.budget.materialVariance == null || detail.budget.materialVariance <= 0 ? 'text-green-600' : 'text-red-600'}
              />
              <Signal label="Cost to revenue" value={formatPercent(detail.profitability.costToRevenue)} />
            </div>
          </Card>
        </aside>
      </div>

      <Modal isOpen={costModalOpen} onClose={() => setCostModalOpen(false)} title={editingCost ? 'Edit Job Cost' : 'Add Job Cost'}>
        <form onSubmit={saveCost} className="space-y-3">
          <label>
            <span className="form-label">Category</span>
            <select name="category" required className="input" defaultValue={editingCost?.category || 'materials'}>
              {costCategories.map((category) => <option key={category} value={category}>{labelize(category)}</option>)}
            </select>
          </label>
          <label>
            <span className="form-label">Description</span>
            <input name="description" required autoComplete="off" defaultValue={editingCost?.description || ''} className="input" placeholder="Paint, tape, subcontractor invoice" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label>
              <span className="form-label">Quantity</span>
              <input name="quantity" type="number" min="0" step="0.01" inputMode="decimal" autoComplete="off" required defaultValue={editingCost ? numberValue(editingCost.quantity) : ''} className="input" />
            </label>
            <label>
              <span className="form-label">Unit cost</span>
              <input name="unitCost" type="number" min="0" step="0.01" inputMode="decimal" autoComplete="off" required defaultValue={editingCost ? numberValue(editingCost.unitCost) : ''} className="input" />
            </label>
          </div>
          <ModalFooter className="-mx-6 -mb-4 mt-4">
            <button type="button" className="btn-secondary" onClick={() => setCostModalOpen(false)}>Cancel</button>
            <button className="btn-primary" disabled={savingCost}>{savingCost ? 'Saving...' : editingCost ? 'Save' : 'Add'}</button>
          </ModalFooter>
        </form>
      </Modal>

      <CrewTimecardModal
        isOpen={bulkOpen}
        onClose={() => setBulkOpen(false)}
        members={teamMembers}
        jobs={job ? [job] : []}
        jobId={id}
        description="Fast end-of-day crew hours for this job. Pay and burdened rates are managed in Team."
        isSaving={savingBulk}
        onSubmit={saveBulkTimecard}
      />

      <Modal isOpen={changeOrderOpen} onClose={() => setChangeOrderOpen(false)} title="Add Change Order">
        <form onSubmit={saveChangeOrder} className="space-y-4">
          <p className="text-sm text-gray-600">Track approved or pending scope changes separately from the original contract.</p>
          <label>
            <span className="form-label">Description</span>
            <textarea name="description" required rows={3} autoComplete="off" className="input resize-none" placeholder="Add garage door trim, extra prep, color change" />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label>
              <span className="form-label">Amount</span>
              <input name="amount" type="number" min="0.01" step="0.01" inputMode="decimal" autoComplete="off" required className="input" placeholder="0.00" />
            </label>
            <label>
              <span className="form-label">Status</span>
              <select name="status" className="input" defaultValue="pending">
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="completed">Completed</option>
              </select>
            </label>
          </div>
          <label>
            <span className="form-label">Requested by</span>
            <select name="createdBy" className="input" defaultValue="contractor">
              <option value="contractor">Contractor</option>
              <option value="customer">Customer</option>
            </select>
          </label>
          <div className="rounded-lg border p-3">
            <label className="flex items-start gap-3">
              <input name="paymentRequired" type="checkbox" value="true" className="mt-1" />
              <span>
                <span className="block text-sm font-medium text-gray-900">Require online payment after approval</span>
                <span className="block text-xs text-gray-600">Use this for added work that should be paid before or during production.</span>
              </span>
            </label>
            <label className="mt-3 block">
              <span className="form-label">Amount due at approval</span>
              <select name="depositPercent" className="input" defaultValue="100">
                <option value="100">100% of change order</option>
                <option value="50">50% deposit</option>
                <option value="25">25% deposit</option>
              </select>
            </label>
          </div>
          <ModalFooter className="-mx-6 -mb-4 mt-4">
            <button type="button" className="btn-secondary" onClick={() => setChangeOrderOpen(false)}>Cancel</button>
            <button className="btn-primary" disabled={savingChangeOrder}>{savingChangeOrder ? 'Adding...' : 'Add'}</button>
          </ModalFooter>
        </form>
      </Modal>

      <Modal isOpen={Boolean(approvalLink)} onClose={() => setApprovalLink('')} title="Customer Approval Link">
        <p className="text-sm text-gray-600">This secure portal link lets the customer review, approve, and pay for the change order. It expires in 14 days.</p>
        <label className="mt-4 block">
          <span className="form-label">Approval link</span>
          <input readOnly className="input" value={approvalLink} onFocus={(event) => event.currentTarget.select()} />
        </label>
        <ModalFooter className="-mx-6 -mb-4 mt-4">
          <button
            type="button"
            className="btn-primary"
            onClick={async () => {
              const copied = await navigator.clipboard?.writeText(approvalLink).then(() => true).catch(() => false);
              window.showToast?.(copied ? 'Approval link copied' : 'Select the link and copy it manually', copied ? 'success' : 'error');
            }}
          >
            Copy link
          </button>
          <button type="button" className="btn-secondary" onClick={() => setApprovalLink('')}>Close</button>
        </ModalFooter>
      </Modal>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--pf-border)] bg-gray-50 p-3">
      <p className="text-xs font-semibold uppercase text-gray-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-gray-950">{value}</p>
    </div>
  );
}

function Signal({ label, value, valueClassName = '' }: { label: string; value: string; valueClassName?: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-gray-600">{label}</span>
      <span className={`font-medium text-gray-950 ${valueClassName}`}>{value}</span>
    </div>
  );
}
