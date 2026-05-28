import { FormEvent, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AddressInline } from '@/components/AddressInline';
import { StatusBadge } from '@/components/Badge';
import { Card, CardHeader } from '@/components/Card';
import { CrewTimecardModal, CrewTimecardPayload } from '@/components/CrewTimecardModal';
import { Icon } from '@/components/Icon';
import { Modal, ModalFooter } from '@/components/Modal';
import { API_URL, apiJson, formatAddress, formatMoney, labelize } from '@/lib/api';

interface JobCost {
  id: string;
  category?: string | null;
  description?: string | null;
  quantity?: string | number | null;
  unitCost?: string | number | null;
  totalCost?: string | number | null;
  costDate?: string | null;
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
  approvalLink?: string | null;
  customerSignedAt?: string | null;
  customerSignatureName?: string | null;
  canceledAt?: string | null;
}

interface ChangeOrderEmailPreview {
  to?: string | null;
  link?: string | null;
  expiresAt?: string | null;
  subject?: string | null;
  preheader?: string | null;
  html?: string | null;
  text?: string | null;
  templateName?: string | null;
  paymentSchedule?: string | null;
  changeOrder?: ChangeOrder | null;
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
      jobNumber?: string | null;
      name?: string | null;
      status?: string | null;
      budget?: number | string | null;
      estimateId?: string | null;
      leadId?: string | null;
      leadName?: string | null;
      leadEmail?: string | null;
      leadPhone?: string | null;
      streetAddress?: string | null;
      city?: string | null;
      state?: string | null;
      postalCode?: string | null;
      scheduledStartAt?: string | null;
      scheduledEndAt?: string | null;
      leadStreetAddress?: string | null;
      leadCity?: string | null;
      leadState?: string | null;
      leadPostalCode?: string | null;
      completedAt?: string | null;
      colorReadiness?: ColorReadiness | null;
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

interface ColorReadiness {
  required: number;
  selected: number;
  missing: number;
  complete: boolean;
  missingItems?: Array<{ label?: string; product?: string }>;
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
  return String(job.streetAddress || job.leadStreetAddress || '').trim();
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

function marginTone(margin: number) {
  if (margin > 30) return 'text-green-700 bg-green-50 border-green-100';
  if (margin > 15) return 'text-amber-700 bg-amber-50 border-amber-100';
  return 'text-red-700 bg-red-50 border-red-100';
}

function scheduleLabel(job: JobCostingResponse['data']['job']) {
  const start = formatDate(job.scheduledStartAt);
  const end = formatDate(job.scheduledEndAt);
  if (start !== 'Not recorded' && end !== 'Not recorded' && start !== end) return `${start} - ${end}`;
  if (start !== 'Not recorded') return start;
  return 'Needs date';
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
  const [costFilter, setCostFilter] = useState('all');
  const [completingJob, setCompletingJob] = useState(false);
  const [requestingReview, setRequestingReview] = useState(false);
  const [sendingChangeOrderId, setSendingChangeOrderId] = useState<string | null>(null);
  const [updatingChangeOrderId, setUpdatingChangeOrderId] = useState<string | null>(null);
  const [changeOrderPreview, setChangeOrderPreview] = useState<ChangeOrderEmailPreview | null>(null);
  const [previewingChangeOrderId, setPreviewingChangeOrderId] = useState<string | null>(null);

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
    setCompletingJob(true);
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
    } finally {
      setCompletingJob(false);
    }
  }

  async function requestReview() {
    if (!id || !confirm('Send review request to customer?')) return;
    setRequestingReview(true);
    try {
      await apiJson('/v1/reviews/request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({ jobId: id }),
      });
      window.showToast?.('Review request sent', 'success');
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to send review request', 'error');
    } finally {
      setRequestingReview(false);
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
      const response = await apiJson<{ data?: ChangeOrder & { approvalLink?: string | null } }>('/v1/change-orders', {
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
      window.showToast?.('Change order added. Review the email before sending.', 'success');
      if (response.data) await previewChangeOrderEmail(response.data);
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to add change order', 'error');
    } finally {
      setSavingChangeOrder(false);
    }
  }

  async function previewChangeOrderEmail(order: ChangeOrder) {
    setPreviewingChangeOrderId(order.id);
    try {
      const response = await apiJson<{ data?: ChangeOrderEmailPreview }>(`/v1/change-orders/${order.id}/email-preview`, {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      });
      setChangeOrderPreview(response.data || null);
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to preview change order email', 'error');
    } finally {
      setPreviewingChangeOrderId(null);
    }
  }

  async function sendChangeOrder(order: ChangeOrder) {
    setSendingChangeOrderId(order.id);
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
      setChangeOrderPreview(null);
      window.showToast?.(response.data?.to ? `Change order emailed to ${response.data.to}` : 'Change order email sent', 'success');
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to send change order', 'error');
    } finally {
      setSendingChangeOrderId(null);
    }
  }

  async function viewChangeOrder(order: ChangeOrder) {
    setUpdatingChangeOrderId(order.id);
    try {
      const response = await apiJson<{ data?: { link?: string } }>(`/v1/change-orders/${order.id}/portal-link`, {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      });
      if (!response.data?.link) throw new Error('Approval link could not be created');
      window.open(response.data.link, '_blank', 'noopener,noreferrer');
      await loadJob();
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to open change order', 'error');
    } finally {
      setUpdatingChangeOrderId(null);
    }
  }

  async function copyChangeOrderLink(order: ChangeOrder) {
    setUpdatingChangeOrderId(order.id);
    try {
      const response = await apiJson<{ data?: { link?: string } }>(`/v1/change-orders/${order.id}/portal-link`, {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      });
      const link = response.data?.link || '';
      if (!link) throw new Error('Approval link could not be created');
      const copied = await navigator.clipboard?.writeText(link).then(() => true).catch(() => false);
      if (!copied) setApprovalLink(link);
      await loadJob();
      window.showToast?.(copied ? 'Change order link copied' : 'Approval link ready', 'success');
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to copy change order link', 'error');
    } finally {
      setUpdatingChangeOrderId(null);
    }
  }

  async function updateChangeOrderStatus(order: ChangeOrder, status: 'completed' | 'canceled') {
    if (status === 'canceled' && !confirm('Cancel this change order? The customer approval link will no longer be actionable.')) return;
    setUpdatingChangeOrderId(order.id);
    try {
      await apiJson(`/v1/change-orders/${order.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({ status, reason: status === 'canceled' ? 'Canceled from job detail' : undefined }),
      });
      await loadJob();
      window.showToast?.(status === 'canceled' ? 'Change order canceled' : 'Change order marked complete', 'success');
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to update change order', 'error');
    } finally {
      setUpdatingChangeOrderId(null);
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
  const activeCrewCount = teamMembers.filter((member) => member.isActive !== false).length;
  const isCompleted = String(job.status || '').toLowerCase() === 'completed';
  const costCategoryCounts = detail.lists.costs.reduce<Record<string, number>>((counts, cost) => {
    const category = String(cost.category || 'other').toLowerCase();
    counts[category] = (counts[category] || 0) + 1;
    return counts;
  }, {});
  const costCategoryFilters = [
    ...costCategories.filter((category) => costCategoryCounts[category]),
    ...Object.keys(costCategoryCounts).filter((category) => !costCategories.includes(category)),
  ];
  const activeCostFilter = costCategoryFilters.includes(costFilter) ? costFilter : 'all';
  const visibleCosts = activeCostFilter === 'all'
    ? detail.lists.costs
    : detail.lists.costs.filter((cost) => String(cost.category || 'other').toLowerCase() === activeCostFilter);
  const colorReadiness = job.colorReadiness;
  const needsColors = Boolean(colorReadiness && colorReadiness.required > 0 && !colorReadiness.complete);

  return (
    <div className="mx-auto max-w-7xl py-5 sm:py-8">
      <section className="mb-6 rounded-lg border bg-white shadow-sm">
        <div className="grid lg:grid-cols-[minmax(0,1fr)_260px]">
          <div className="min-w-0 p-4 sm:p-5">
            <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h2 className="pf-row-title truncate">{displayJobName(job)}</h2>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  {job.leadName && (
                    <Link to={`/leads/${job.leadId}`} className="pf-copy truncate hover:text-blue-700">
                      {job.leadName}
                    </Link>
                  )}
                  {job.jobNumber && <span className="pf-status pf-status-neutral pf-status-sm">{job.jobNumber}</span>}
                </div>
              </div>
              <div className={`inline-flex w-fit items-baseline gap-1 rounded-lg border px-3 py-2 ${marginTone(detail.profitability.grossMargin)}`}>
                <span className="pf-section-title">{formatPercent(detail.profitability.grossMargin)}</span>
                <span className="pf-meta">margin</span>
              </div>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
              <AddressInline address={address} className="pf-copy" />
              <Link to="/calendar" className="btn-text btn-sm justify-start sm:justify-end" title="Open calendar">
                <Icon name="calendar" className="h-4 w-4" />
                {scheduleLabel(job)}
              </Link>
            </div>
            {needsColors && (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                <div className="flex items-start gap-2">
                  <Icon name="warning" className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                  <div>
                    <p className="font-medium">Color selections needed before production</p>
                    <p className="mt-0.5 text-amber-800">
                      {colorReadiness?.missing} of {colorReadiness?.required} paint color selection{colorReadiness?.required === 1 ? '' : 's'} still need customer confirmation.
                    </p>
                    {colorReadiness?.missingItems?.length ? (
                      <p className="mt-1 text-amber-800">Missing: {colorReadiness.missingItems.map((item) => item.label).join(', ')}</p>
                    ) : null}
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="flex flex-col justify-between gap-3 border-t p-3 sm:flex-row sm:items-center lg:border-l lg:border-t-0 lg:p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Link to="/calendar" className="inline-flex" title="Open calendar">
                <StatusBadge status={String(job.status || 'scheduled')} />
              </Link>
              <span className="pf-meta">{Number(detail.production.laborHours || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} labor hrs</span>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-1">
              <button type="button" className="btn-tonal btn-sm" onClick={() => setBulkOpen(true)}>
                <Icon name="clock" className="h-4 w-4" />
                Add time
              </button>
              <details className="relative">
                <summary className="btn-icon btn-icon-tonal list-none" aria-label="More job actions" title="More actions">
                  <Icon name="more-horizontal" className="h-4 w-4" />
                </summary>
                <div className="absolute right-0 z-30 mt-2 w-52 rounded-lg border bg-white p-1 shadow-lg">
                  {job.estimateId && <Link to={`/estimates/${job.estimateId}`} className="btn-text btn-sm w-full justify-start">View estimate</Link>}
                  <button type="button" className="btn-text btn-sm w-full justify-start" onClick={() => openCostModal()}>Add cost</button>
                  <button type="button" className="btn-text btn-sm w-full justify-start" onClick={() => setChangeOrderOpen(true)}>Add change order</button>
                  {isCompleted ? (
                    <button type="button" className="btn-text btn-sm w-full justify-start" onClick={requestReview} disabled={requestingReview}>
                      {requestingReview ? 'Sending request...' : 'Request review'}
                    </button>
                  ) : (
                    <button type="button" className="btn-text btn-sm w-full justify-start text-green-700" onClick={markComplete} disabled={completingJob}>
                      {completingJob ? 'Marking complete...' : 'Mark job complete'}
                    </button>
                  )}
                </div>
              </details>
            </div>
          </div>
        </div>
      </section>

      <nav className="mb-4 -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0" aria-label="Job sections">
        {[
          ['Costs', '#job-costs'],
          ['Time', '#job-time'],
          ['Change orders', '#job-change-orders'],
          ['Purchases', '#job-purchases'],
          ['Photos', '#job-photos'],
        ].map(([label, href]) => (
          <a key={href} href={href} className="btn-text btn-sm shrink-0 whitespace-nowrap rounded-full bg-white px-3 shadow-sm">
            {label}
          </a>
        ))}
      </nav>

      <section className="mb-6 -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-5">
        {kpis.map(([label, value, help]) => (
          <Card key={label} padding="sm" className="min-w-[10.5rem] snap-start sm:min-w-0">
            <p className="pf-metric-label">{label}</p>
            <p className="pf-row-title mt-1">{value}</p>
            <p className="pf-meta mt-1">{help}</p>
          </Card>
        ))}
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card padding="none" id="job-costs" className="scroll-mt-24">
            <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
              <CardHeader className="mb-0" title="Actual Costs" description="Labor, materials, supplies, subcontractors, equipment, and other job costs" />
              <button type="button" className="btn-primary btn-sm shrink-0" onClick={() => openCostModal()}>
                <Icon name="plus" className="h-4 w-4" />
                Add cost
              </button>
            </div>
            {costCategoryFilters.length > 1 && (
              <div className="border-b bg-gray-50 px-4 py-3">
                <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" aria-label="Filter actual costs">
                  <button
                    type="button"
                    className={`btn-sm shrink-0 rounded-full ${activeCostFilter === 'all' ? 'btn-tonal' : 'btn-text bg-white'}`}
                    onClick={() => setCostFilter('all')}
                  >
                    All
                    <span className="ml-1 text-xs text-gray-500">{detail.lists.costs.length}</span>
                  </button>
                  {costCategoryFilters.map((category) => (
                    <button
                      key={category}
                      type="button"
                      className={`btn-sm shrink-0 rounded-full ${activeCostFilter === category ? 'btn-tonal' : 'btn-text bg-white'}`}
                      onClick={() => setCostFilter(category)}
                    >
                      {labelize(category)}
                      <span className="ml-1 text-xs text-gray-500">{costCategoryCounts[category]}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="divide-y">
              {detail.lists.costs.length === 0 ? (
                <div className="p-6 text-sm text-gray-500">No actual job costs have been logged.</div>
              ) : visibleCosts.length === 0 ? (
                <div className="p-6 text-sm text-gray-500">No costs match this filter.</div>
              ) : visibleCosts.map((cost) => (
                <div key={cost.id} className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-gray-950">{cost.description || labelize(cost.category)}</p>
                      <StatusBadge status={String(cost.category || 'other')} />
                    </div>
                    <p className="mt-1 text-sm text-gray-600">
                      {numberValue(cost.quantity).toFixed(2)} x {formatMoney(cost.unitCost || 0)} - {formatDate(cost.costDate || cost.createdAt)}
                    </p>
                  </div>
                  <div className="flex items-center justify-between gap-3 sm:justify-end sm:text-right">
                    <p className="font-semibold text-gray-950">{formatMoney(cost.totalCost || 0)}</p>
                    <div className="flex items-center gap-1.5">
                      <button type="button" className="btn-icon btn-icon-tonal" aria-label={iconButtonLabel('Edit', cost.description)} onClick={() => openCostModal(cost)}>
                        <Icon name="edit" className="h-4 w-4" />
                      </button>
                      <button type="button" className="btn-icon btn-icon-outlined btn-icon-danger" aria-label={iconButtonLabel('Remove', cost.description)} onClick={() => deleteCost(cost)}>
                        <Icon name="trash" className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card padding="none" id="job-time" className="scroll-mt-24">
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
                  <MiniMetric label="Active crew" value={activeCrewCount.toLocaleString()} />
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

          <Card padding="none" id="job-change-orders" className="scroll-mt-24">
            <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
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
                    <p className="text-sm text-gray-600">
                      {[job.jobNumber, labelize(order.createdBy || 'contractor'), formatDate(order.createdAt)].filter(Boolean).join(' - ')}
                    </p>
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
                        <button type="button" className="btn-secondary btn-sm" onClick={() => previewChangeOrderEmail(order)} disabled={previewingChangeOrderId === order.id}>
                          {previewingChangeOrderId === order.id ? 'Preparing...' : order.sentAt ? 'Preview resend' : 'Preview email'}
                        </button>
                      )}
                      {order.status === 'pending' && (
                        <button type="button" className="btn-secondary btn-sm" onClick={() => viewChangeOrder(order)} disabled={updatingChangeOrderId === order.id}>
                          View
                        </button>
                      )}
                      {order.status === 'pending' && (
                        <button type="button" className="btn-secondary btn-sm" onClick={() => copyChangeOrderLink(order)} disabled={updatingChangeOrderId === order.id}>
                          Copy link
                        </button>
                      )}
                      {order.status === 'approved' && (
                        <button type="button" className="btn-secondary btn-sm" onClick={() => updateChangeOrderStatus(order, 'completed')} disabled={updatingChangeOrderId === order.id}>
                          {updatingChangeOrderId === order.id ? 'Completing...' : 'Mark complete'}
                        </button>
                      )}
                      {['pending', 'rejected'].includes(String(order.status || 'pending')) && (
                        <button type="button" className="btn-text btn-sm text-red-700" onClick={() => updateChangeOrderStatus(order, 'canceled')} disabled={updatingChangeOrderId === order.id}>
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card padding="none" id="job-purchases" className="scroll-mt-24">
            <div className="border-b p-4">
              <CardHeader className="mb-0" title="Material Purchases" description="Imported invoices linked to this job" />
            </div>
            <div className="divide-y">
              {detail.lists.materialPurchases.length === 0 ? (
                <div className="p-6 text-sm text-gray-500">No material invoices imported for this job.</div>
              ) : detail.lists.materialPurchases.map((purchase) => (
                <div key={purchase.id} className="grid grid-cols-1 gap-2 p-4 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-950">{purchase.supplier || purchase.vendor || 'Material purchase'}</p>
                    <p className="text-sm text-gray-600">Invoice {purchase.invoiceNumber || 'not set'} - {formatDate(purchase.invoiceDate || purchase.purchasedAt || purchase.createdAt)}</p>
                  </div>
                  <p className="font-semibold text-gray-950 sm:text-right">{formatMoney(purchase.totalAmount || purchase.totalCost || 0)}</p>
                </div>
              ))}
            </div>
          </Card>

          <Card padding="none" id="job-photos" className="scroll-mt-24">
            <div className="border-b p-4">
              <CardHeader className="mb-0" title="Job Photos" description="Track before, progress, and after photos." />
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
                        <img
                          src={photoSrc(photo)}
                          alt={photo.caption || `${labelize(photo.type || 'progress')} job photo`}
                          className="h-full w-full object-cover"
                          loading="lazy"
                          onError={(event) => {
                            event.currentTarget.replaceWith(Object.assign(document.createElement('div'), {
                              className: 'flex h-full w-full items-center justify-center p-3 text-center text-xs text-gray-500',
                              textContent: 'Photo preview unavailable',
                            }));
                          }}
                        />
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

      <Modal isOpen={changeOrderOpen} onClose={() => setChangeOrderOpen(false)} title="Add Change Order" size="lg">
        <form onSubmit={saveChangeOrder} className="space-y-5">
          <p className="pf-copy">Track approved or pending scope changes separately from the original contract.</p>
          <label className="block space-y-1.5">
            <span className="form-label">Description</span>
            <textarea name="description" required rows={3} autoComplete="off" className="input resize-none" placeholder="Add garage door trim, extra prep, color change" />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1.5">
              <span className="form-label">Amount</span>
              <input name="amount" type="number" min="0.01" step="0.01" inputMode="decimal" autoComplete="off" required className="input" placeholder="0.00" />
            </label>
            <label className="block space-y-1.5">
              <span className="form-label">Status</span>
              <select name="status" className="input" defaultValue="pending">
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="completed">Completed</option>
              </select>
            </label>
          </div>
          <label className="block space-y-1.5">
            <span className="form-label">Requested by</span>
            <select name="createdBy" className="input" defaultValue="contractor">
              <option value="contractor">Contractor</option>
              <option value="customer">Customer</option>
            </select>
          </label>
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <label className="flex items-start gap-3">
              <input name="paymentRequired" type="checkbox" value="true" className="mt-1" />
              <span>
                <span className="block text-sm font-medium text-gray-900">Require online payment after approval</span>
                <span className="block text-xs text-gray-600">Use this for added work that should be paid before or during production.</span>
              </span>
            </label>
            <label className="mt-4 block space-y-1.5">
              <span className="form-label">Amount due at approval</span>
              <select name="depositPercent" className="input" defaultValue="100">
                <option value="100">100% of change order</option>
                <option value="50">50% deposit</option>
                <option value="25">25% deposit</option>
              </select>
            </label>
          </div>
          <ModalFooter className="-mx-6 -mb-4 mt-6">
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

      <Modal isOpen={Boolean(changeOrderPreview)} onClose={() => setChangeOrderPreview(null)} title="Preview Change Order Email" size="lg">
        {changeOrderPreview && (
          <div className="space-y-4">
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <p className="pf-meta">To</p>
              <p className="pf-copy break-all">{changeOrderPreview.to || job.leadEmail || 'Customer email missing'}</p>
              <p className="pf-meta mt-3">Subject</p>
              <p className="pf-row-title">{changeOrderPreview.subject || 'Change order approval request'}</p>
              {changeOrderPreview.preheader && (
                <>
                  <p className="pf-meta mt-3">Preview text</p>
                  <p className="pf-copy">{changeOrderPreview.preheader}</p>
                </>
              )}
              {changeOrderPreview.paymentSchedule && (
                <>
                  <p className="pf-meta mt-3">Payment schedule</p>
                  <p className="pf-copy">{changeOrderPreview.paymentSchedule}</p>
                </>
              )}
            </div>
            <iframe
              title="Change order email preview"
              className="h-[28rem] w-full rounded-lg border border-gray-200 bg-white"
              sandbox=""
              srcDoc={changeOrderPreview.html || '<p>Email preview unavailable.</p>'}
            />
            {changeOrderPreview.link && (
              <label className="block">
                <span className="form-label">Approval and payment link</span>
                <input readOnly className="input" value={changeOrderPreview.link} onFocus={(event) => event.currentTarget.select()} />
              </label>
            )}
            <ModalFooter className="-mx-6 -mb-4 mt-4">
              <button type="button" className="btn-secondary" onClick={() => setChangeOrderPreview(null)}>Cancel</button>
              <button
                type="button"
                className="btn-primary"
                disabled={!changeOrderPreview.to || sendingChangeOrderId === changeOrderPreview.changeOrder?.id}
                onClick={() => {
                  if (changeOrderPreview.changeOrder) void sendChangeOrder(changeOrderPreview.changeOrder);
                }}
              >
                {sendingChangeOrderId === changeOrderPreview.changeOrder?.id ? 'Sending...' : 'Send email'}
              </button>
            </ModalFooter>
          </div>
        )}
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
