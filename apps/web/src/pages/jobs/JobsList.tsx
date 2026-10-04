import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AddressInline } from '@/components/AddressInline';
import { Badge, StatusBadge } from '@/components/Badge';
import { CrewTimecardModal, CrewTimecardPayload } from '@/components/CrewTimecardModal';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icon';
import { Button } from "@/components/Button";
import { Input, Select } from '@/components/Input';
import { ServiceErrorState } from '@/components/ServiceErrorState';
import { apiJson } from '@/lib/api';
import {
  JobActionMenu,
  JobFinancialSummary,
  type JobFinancialPosition,
} from "./JobFinancialSummary";

interface TeamMember {
  id: string;
  name: string;
  role?: string | null;
  hourlyRate?: number | string | null;
  isActive?: boolean | null;
}

interface Job {
  id: string;
  estimateId?: string | null;
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
  financialSummary?: JobFinancialPosition | null;
}

interface JobCosting {
  job?: Job;
  financialSummary?: JobFinancialPosition;
  revenue?: { total?: number | string | null };
  costs?: { total?: number | string | null };
  profitability?: { grossProfit?: number | string | null; grossMargin?: number | string | null };
  production?: { laborHours?: number | string | null };
}

interface JobsResponse {
  data: Job[];
  nextCursor?: string | null;
}

function formatDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function jobAddress(job: Job) {
  const city = job.city;
  const state = job.state;
  const locality = [city, state].filter(Boolean).join(', ');
  return [job.streetAddress, locality].filter(Boolean).join(' ');
}

function streetAddress(job: Job) {
  return String(job.streetAddress || '').trim();
}

function jobScope(job: Job) {
  const haystack = String(job.name || '').toLowerCase();
  if (/(exterior|siding|fascia|soffit|roofline)/.test(haystack))
    return 'Exterior';
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
  return (
    name || [leadName || 'Customer', street].filter(Boolean).join(' - ') || 'Untitled job'
  );
}

function numberValue(value: unknown) {
  return Number(value || 0);
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
  const [searchParams, setSearchParams] = useSearchParams();
  const status = searchParams.get('status') || '';
  const statusQuery = status ? `status=${encodeURIComponent(status)}` : '';
  const [jobs, setJobs] = useState<Job[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [savingBulk, setSavingBulk] = useState(false);
  const [updatingJobId, setUpdatingJobId] = useState<string | null>(null);
  const [requestingReviewId, setRequestingReviewId] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState('');
  const loadMoreBusy = useRef(false);
  const loadGeneration = useRef(0);

  async function loadJobs() {
    const generation = ++loadGeneration.current;
    setIsLoading(true);
    try {
      const [jobsResponse, membersResponse] = await Promise.all([
        apiJson<JobsResponse>(`/v1/jobs${statusQuery ? `?${statusQuery}` : ''}`),
        apiJson<{ data: TeamMember[] }>('/v1/team/members').catch(() => ({ data: [] })),
      ]);
      if (generation !== loadGeneration.current) return;
      setJobs(jobsResponse.data || []);
      setNextCursor(jobsResponse.nextCursor ?? null);
      setMoreError('');
      setTeamMembers(membersResponse.data || []);
      setError('');
    } catch (err) {
      if (generation !== loadGeneration.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load jobs');
    } finally {
      if (generation === loadGeneration.current) setIsLoading(false);
    }
  }

  useEffect(() => {
    loadJobs();
  }, [status]);

  async function loadMore() {
    if (!nextCursor || loadMoreBusy.current || isLoading) return;
    loadMoreBusy.current = true;
    setLoadingMore(true);
    setMoreError('');
    const generation = loadGeneration.current;
    try {
      const response = await apiJson<JobsResponse>(
        `/v1/jobs?${statusQuery ? `${statusQuery}&` : ''}cursor=${encodeURIComponent(nextCursor)}`,
      );
      if (generation !== loadGeneration.current) return;
      setJobs((previous) => [
        ...previous,
        ...response.data.filter(
          (job) => !previous.some((existing) => existing.id === job.id),
        ),
      ]);
      setNextCursor(response.nextCursor ?? null);
    } catch (err) {
      if (generation !== loadGeneration.current) return;
      setMoreError(
        err instanceof Error
          ? err.message
          : "More jobs could not be loaded. Retry.",
      );
    } finally {
      loadMoreBusy.current = false;
      setLoadingMore(false);
    }
  }

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

  async function refreshJob(jobId: string) {
    const response = await apiJson<{ data: JobCosting }>(`/v1/jobs/${jobId}/costing`);
    setJobs(previous => previous.map(job => job.id === jobId ? { ...job, ...response.data.job, financialSummary: response.data.financialSummary, costing: response.data } : job));
  }

  async function markComplete(job: Job) {
    if (!confirm('Mark this job as completed?')) return;
    setUpdatingJobId(job.id);
    try {
      const response = await apiJson<{ data: Job }>(`/v1/jobs/${job.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({ status: 'completed', completedAt: new Date().toISOString() }),
      });
      setJobs(previous => previous.map(current => current.id === job.id ? { ...current, ...response.data } : current));
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
      window.showToast?.('Crew timecard submitted', 'success');
      try {
        await refreshJob(payload.jobId);
      } catch {
        setJobs(previous => previous.map(job => job.id === payload.jobId ? { ...job, financialSummary: null, costing: null } : job));
        window.showToast?.('Time saved. Reopen the job to refresh totals.', 'error');
      }
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to submit timecard', 'error');
    } finally {
      setSavingBulk(false);
    }
  }

  if (isLoading && !jobs.length) {
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
    <div
      className="mx-auto max-w-6xl min-w-0 px-4 py-5 sm:px-6 sm:py-8 lg:px-8"
      aria-busy={isLoading}
    >
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
        <div className="mb-3">
          <Select label="Job status" value={status} onChange={(event) => {
            const next = new URLSearchParams(searchParams);
            if (event.target.value) next.set('status', event.target.value); else next.delete('status');
            setSearchParams(next);
          }}>
            <option value="">All jobs</option><option value="deposit_pending">Awaiting deposit</option>
            <option value="scheduled">Scheduled</option><option value="in_progress">In production</option>
            <option value="punch_list">Punch list</option><option value="completed">Completed</option><option value="cancelled">Canceled</option>
          </Select>
        </div>
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
      {error && !jobs.length ? null : filteredJobs.length === 0 ? (
        jobs.length === 0 && !status ? (
          <EmptyState
            title="No jobs yet"
            description="A signed estimate becomes production work here. From there you can schedule, log crew time, add photos, and track margin."
            action={
              <div className="flex flex-col gap-2 sm:flex-row">
                <Link to="/estimates/production" className="btn-primary justify-center">Start estimate</Link>
                <Link to="/pipeline" className="btn-secondary justify-center">View pipeline</Link>
              </div>
            }
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

      {moreError && <p role="alert" className="pf-copy mt-4 text-[var(--pf-danger)]">{moreError}</p>}
      {nextCursor && <div className="mt-4 grid gap-2 justify-items-start">
        <p className="pf-helper">Search covers {jobs.length} loaded jobs.</p>
        <Button variant="secondary" onClick={loadMore} isLoading={loadingMore} disabled={isLoading}>{moreError ? 'Retry more jobs' : 'Load more jobs'}</Button>
      </div>}

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
  const laborHours = job.costing?.production?.laborHours;
  const completed = String(job.status || '').toLowerCase() === 'completed';

  return (
    <article className="min-w-0 rounded-lg border border-[var(--pf-border)] bg-[var(--pf-surface)] shadow-sm">
      <div className="p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Link to={`/jobs/${job.id}`} className="pf-row-title min-w-0 truncate hover:text-blue-700">
                {displayJobName(job)}
              </Link>
              {job.jobNumber && (
                <Badge size="sm" variant="default">{job.jobNumber}</Badge>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
              {job.leadName && (
                <Link to={job.leadId ? `/leads/${job.leadId}` : `/jobs/${job.id}`} className="pf-copy truncate hover:text-blue-700">
                  {job.leadName}
                </Link>
              )}
              {numberValue(laborHours) > 0 && (
                <span className="pf-meta">
                  {laborHoursLabel(laborHours)} recorded
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <StatusBadge status={String(job.status || 'scheduled')} />
          </div>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
          {address ? (
            <AddressInline address={address} className="pf-copy" />
          ) : (
            <p className="pf-helper">Jobsite not recorded</p>
          )}
          <Link to="/calendar" className="btn-text btn-sm justify-start sm:justify-end" title="Open schedule">
            <Icon name="calendar" className="h-4 w-4" />
            {scheduleLabel(job)}
          </Link>
        </div>
      </div>

      <div className="border-y border-[var(--pf-border)] p-4 sm:px-5">
        <JobFinancialSummary
          compact
          summary={job.financialSummary}
          jobId={job.id}
          estimateId={job.estimateId}
        />
      </div>

      <div className="flex items-center justify-end gap-3 p-3 sm:px-5">
        <div className="flex shrink-0 items-center gap-1.5">
          <Link to={`/jobs/${job.id}`} className="btn-text whitespace-nowrap">
            View job
            <Icon name="arrow-right" className="h-4 w-4" />
          </Link>
          <JobActionMenu label={`More actions for ${displayJobName(job)}`}>
            {(close) => (
              <>
                <Button
                  variant="ghost"
                  onClick={() => {
                    close();
                    onLogTime();
                  }}
                  className="justify-start"
                  leftIcon={<Icon name="clock" />}
                >
                  Add time
              </Button>
                <Button
                  as="a"
                  href={`/jobs/${job.id}#job-costs`}
                  variant="ghost"
                  className="justify-start"
                  onClick={close}
                >
                  Add cost
                </Button>
                <Button
                  as="a"
                  href="/calendar"
                  variant="ghost"
                  className="justify-start"
                  onClick={close}
                >
                  Open calendar
          </Button>
                {job.estimateId && (
                  <Button
                    as="a"
                    href={`/estimates/${job.estimateId}/details`}
                    variant="ghost"
                    className="justify-start"
                    onClick={close}
                  >
                    View estimate
                  </Button>
                )}
                <Button
                  variant="ghost"
                  className="justify-start"
                  disabled={completed ? isRequestingReview : isUpdating}
                  onClick={() => {
                    close();
                    completed ? onRequestReview() : onMarkComplete();
                  }}
                >
                  {completed ? 'Request review' : 'Mark complete'}
                </Button>
              </>
            )}
          </JobActionMenu>
        </div>
      </div>
    </article>
  );
}
