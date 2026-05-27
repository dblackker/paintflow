import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AddressInline } from '@/components/AddressInline';
import { Badge, StatusBadge } from '@/components/Badge';
import { CrewTimecardModal, CrewTimecardPayload } from '@/components/CrewTimecardModal';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icon';
import { Input } from '@/components/Input';
import { ServiceErrorState } from '@/components/ServiceErrorState';
import { apiJson, formatMoney, labelize } from '@/lib/api';

interface TeamMember {
  id: string;
  name: string;
  role?: string | null;
  hourlyRate?: number | string | null;
  isActive?: boolean | null;
}

interface Job {
  id: string;
  jobNumber?: string | null;
  name?: string | null;
  status?: string | null;
  budget?: number | string | null;
  scheduledStartAt?: string | null;
  scheduledEndAt?: string | null;
  leadId?: string | null;
  leadName?: string | null;
  leadPhone?: string | null;
  leadEmail?: string | null;
  streetAddress?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  leadStreetAddress?: string | null;
  leadCity?: string | null;
  leadState?: string | null;
  leadPostalCode?: string | null;
  estimatedLaborHours?: number | string | null;
  costing?: JobCosting | null;
}

interface JobCosting {
  revenue?: { total?: number | string | null };
  costs?: { total?: number | string | null };
  profitability?: { grossProfit?: number | string | null; grossMargin?: number | string | null };
  production?: { laborHours?: number | string | null };
}

interface JobsResponse {
  data: Job[];
}

function formatDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function jobAddress(job: Job) {
  const city = job.city || job.leadCity;
  const state = job.state || job.leadState;
  const locality = [city, state].filter(Boolean).join(', ');
  return [job.streetAddress || job.leadStreetAddress, locality].filter(Boolean).join(' ');
}

function streetAddress(job: Job) {
  return String(job.streetAddress || job.leadStreetAddress || '').trim();
}

function jobScope(job: Job) {
  const haystack = String(job.name || '').toLowerCase();
  if (/(exterior|siding|fascia|soffit|roofline|repaint)/.test(haystack)) return 'Exterior';
  if (/(cabinet|vanity|built-in)/.test(haystack)) return 'Cabinets';
  if (/(commercial|office|workspace|tenant)/.test(haystack)) return 'Commercial';
  if (/(interior|bedroom|bathroom|kitchen|living|walls|ceilings|trim|doors)/.test(haystack)) return 'Interior';
  return '';
}

function displayJobName(job: Job) {
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
  if (leadName && genericNames.includes(name.toLowerCase())) return [leadName, scope, street].filter(Boolean).join(' - ');
  if (leadName && scope && street && !name.includes(' - ')) return [leadName, scope, street].join(' - ');
  return name || [leadName || 'Customer', street].filter(Boolean).join(' - ') || 'Untitled job';
}

function numberValue(value: unknown) {
  return Number(value || 0);
}

function marginTone(margin: number) {
  if (margin > 30) return 'text-green-700 bg-green-50 border-green-100';
  if (margin > 15) return 'text-amber-700 bg-amber-50 border-amber-100';
  return 'text-red-700 bg-red-50 border-red-100';
}

function scheduleLabel(job: Job) {
  const start = formatDate(job.scheduledStartAt);
  const end = formatDate(job.scheduledEndAt);
  if (start && end && start !== end) return `${start} - ${end}`;
  if (start) return start;
  return 'Needs date';
}

function laborHoursLabel(value: unknown) {
  const hours = numberValue(value);
  return `${hours.toLocaleString(undefined, { maximumFractionDigits: 1 })} labor hr${hours === 1 ? '' : 's'}`;
}

export function JobsList() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [savingBulk, setSavingBulk] = useState(false);
  const [updatingJobId, setUpdatingJobId] = useState<string | null>(null);
  const [requestingReviewId, setRequestingReviewId] = useState<string | null>(null);

  async function loadJobs() {
    setIsLoading(true);
    try {
      const [jobsResponse, membersResponse] = await Promise.all([
        apiJson<JobsResponse>('/v1/jobs'),
        apiJson<{ data: TeamMember[] }>('/v1/team/members').catch(() => ({ data: [] })),
      ]);
      const jobsData = jobsResponse.data || [];
      const jobsWithCosts = await Promise.all(jobsData.map(async (job) => {
        try {
          const response = await apiJson<{ data: JobCosting }>(`/v1/jobs/${job.id}/costing`);
          return { ...job, costing: response.data };
        } catch {
          return { ...job, costing: null };
        }
      }));
      setJobs(jobsWithCosts);
      setTeamMembers(membersResponse.data || []);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load jobs');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadJobs();
  }, []);

  const filteredJobs = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return jobs.filter((job) => {
      const haystack = [displayJobName(job), job.leadName, jobAddress(job), job.status, job.jobNumber]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return !query || haystack.includes(query);
    });
  }, [jobs, searchQuery]);

  async function markComplete(job: Job) {
    if (!confirm('Mark this job as completed?')) return;
    setUpdatingJobId(job.id);
    try {
      await apiJson(`/v1/jobs/${job.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({ status: 'completed', completedAt: new Date().toISOString() }),
      });
      await loadJobs();
      window.showToast?.('Job marked complete', 'success');
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to update job', 'error');
    } finally {
      setUpdatingJobId(null);
    }
  }

  async function requestReview(job: Job) {
    if (!confirm('Send review request to customer?')) return;
    setRequestingReviewId(job.id);
    try {
      await apiJson('/v1/reviews/request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({ jobId: job.id }),
      });
      window.showToast?.('Review request sent', 'success');
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to send request', 'error');
    } finally {
      setRequestingReviewId(null);
    }
  }

  async function submitCrewTimecard(payload: CrewTimecardPayload) {
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
      setSelectedJobId(null);
      await loadJobs();
      window.showToast?.('Crew timecard submitted', 'success');
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to submit timecard', 'error');
    } finally {
      setSavingBulk(false);
    }
  }

  if (isLoading) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-8 lg:px-8">
        <div className="animate-pulse space-y-4">
          <div className="h-11 rounded bg-gray-200" />
          <div className="h-36 rounded-xl bg-gray-200" />
          <div className="h-36 rounded-xl bg-gray-200" />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-8 lg:px-8">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="pf-page-copy max-w-2xl">Manage active projects, crews, photos, time, and job costs.</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Link to="/calendar" className="btn-secondary justify-center">
            <Icon name="calendar" className="h-4 w-4" />
            Open calendar
          </Link>
          <Link to="/estimates/production" className="btn-primary justify-center">
            <Icon name="plus" className="h-4 w-4" />
            Start estimate
          </Link>
        </div>
      </div>

      <div className="mb-4 rounded-lg border bg-white p-4 shadow-sm">
        <Input
          type="search"
          placeholder="Search customer, jobsite, status, or job number"
          aria-label="Search jobs"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
        />
      </div>

      {error && (
        <div className="mb-4">
          <ServiceErrorState error={error} pageName="Jobs" title="Jobs are unavailable" onRetry={loadJobs} compact />
        </div>
      )}

      {filteredJobs.length === 0 ? (
        jobs.length === 0 ? (
          <EmptyState
            title="No jobs yet"
            description="A signed estimate becomes production work here. From there you can schedule, log crew time, add photos, and track margin."
            action={(
              <div className="flex flex-col gap-2 sm:flex-row">
                <Link to="/estimates/production" className="btn-primary justify-center">Start estimate</Link>
                <Link to="/pipeline" className="btn-secondary justify-center">View pipeline</Link>
              </div>
            )}
          />
        ) : (
          <EmptyState title="No jobs found" description="Try a different customer, jobsite, status, or job number." />
        )
      ) : (
        <div className="grid gap-3 sm:gap-4">
          {filteredJobs.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              onLogTime={() => setSelectedJobId(job.id)}
              onMarkComplete={() => markComplete(job)}
              onRequestReview={() => requestReview(job)}
              isUpdating={updatingJobId === job.id}
              isRequestingReview={requestingReviewId === job.id}
            />
          ))}
        </div>
      )}

      <CrewTimecardModal
        isOpen={Boolean(selectedJobId)}
        onClose={() => setSelectedJobId(null)}
        members={teamMembers}
        jobs={jobs}
        jobId={selectedJobId || undefined}
        description="Fast end-of-day crew entry. The selected job is prefilled from the job card."
        isSaving={savingBulk}
        onSubmit={submitCrewTimecard}
      />
    </div>
  );
}

function JobCard({
  job,
  onLogTime,
  onMarkComplete,
  onRequestReview,
  isUpdating,
  isRequestingReview,
}: {
  job: Job;
  onLogTime: () => void;
  onMarkComplete: () => void;
  onRequestReview: () => void;
  isUpdating: boolean;
  isRequestingReview: boolean;
}) {
  const address = jobAddress(job);
  const margin = numberValue(job.costing?.profitability?.grossMargin);
  const revenue = job.costing?.revenue?.total ?? job.budget ?? 0;
  const actualCost = job.costing?.costs?.total ?? 0;
  const profit = job.costing?.profitability?.grossProfit ?? numberValue(revenue) - numberValue(actualCost);
  const laborHours = job.costing?.production?.laborHours ?? job.estimatedLaborHours ?? 0;
  const completed = String(job.status || '').toLowerCase() === 'completed';

  return (
    <article className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm transition hover:border-blue-200 hover:shadow-md">
      <div className="p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Link to={`/jobs/${job.id}`} className="pf-row-title min-w-0 truncate hover:text-blue-700">
                {displayJobName(job)}
              </Link>
              {job.jobNumber && <Badge size="sm" variant="default">{job.jobNumber}</Badge>}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
              {job.leadName && (
                <Link to={job.leadId ? `/leads/${job.leadId}` : `/jobs/${job.id}`} className="pf-copy truncate hover:text-blue-700">
                  {job.leadName}
                </Link>
              )}
              <span className="pf-meta">{laborHoursLabel(laborHours)}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <StatusBadge status={String(job.status || 'scheduled')} />
            <div className={`inline-flex w-fit items-baseline gap-1 rounded-lg border px-2.5 py-1.5 ${marginTone(margin)}`}>
              <span className="pf-row-title">{margin.toFixed(1)}%</span>
              <span className="pf-meta">margin</span>
            </div>
          </div>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
          <AddressInline address={address} className="pf-copy" />
          <Link to="/calendar" className="btn-text btn-sm justify-start sm:justify-end" title="Open schedule">
            <Icon name="calendar" className="h-4 w-4" />
            {scheduleLabel(job)}
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 border-y bg-gray-50/60 p-3 sm:gap-3 sm:px-5">
        <MiniMetric label="Revenue" value={formatMoney(revenue)} />
        <MiniMetric label="Actual Cost" value={formatMoney(actualCost)} />
        <MiniMetric label="Profit" value={formatMoney(profit)} />
      </div>

      <div className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="pf-meta">
          {completed ? 'Completed work' : 'Active production work'}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Link to={`/jobs/${job.id}`} className="btn-primary btn-sm">
            View job
            <Icon name="arrow-right" className="h-4 w-4" />
          </Link>
          <button type="button" className="btn-text btn-sm" onClick={onLogTime}>
            <Icon name="clock" className="h-4 w-4" />
            Add time
          </button>
          {completed ? (
            <button type="button" className="btn-text btn-sm" onClick={onRequestReview} disabled={isRequestingReview}>
              {isRequestingReview ? 'Sending...' : 'Request review'}
            </button>
          ) : (
            <button type="button" className="btn-text btn-sm text-green-700" onClick={onMarkComplete} disabled={isUpdating}>
              {isUpdating ? 'Updating...' : 'Mark complete'}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-gray-200 bg-white p-2 sm:p-3">
      <p className="pf-metric-label truncate">{labelize(label)}</p>
      <p className="pf-row-title mt-1 truncate">{value}</p>
    </div>
  );
}
