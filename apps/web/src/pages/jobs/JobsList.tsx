import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { StatusBadge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { Input } from '@/components/Input';
import { apiJson, formatAddress, formatMoney, formatPhone } from '@/lib/api';

interface Job {
  id: string;
  name?: string | null;
  status?: string | null;
  budget?: number | string | null;
  scheduledStartAt?: string | null;
  scheduledEndAt?: string | null;
  leadName?: string | null;
  leadPhone?: string | null;
  leadEmail?: string | null;
  leadStreetAddress?: string | null;
  leadCity?: string | null;
  leadState?: string | null;
  leadPostalCode?: string | null;
  estimatedLaborHours?: number | string | null;
}

interface JobsResponse {
  data: Job[];
}

function formatDate(value?: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
}

export function JobsList() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;
    setIsLoading(true);
    apiJson<JobsResponse>('/v1/jobs')
      .then((response) => {
        if (!mounted) return;
        setJobs(response.data || []);
        setError('');
      })
      .catch((err: Error) => {
        if (!mounted) return;
        setError(err.message || 'Failed to load jobs');
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const filteredJobs = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return jobs.filter((job) => {
      const haystack = [job.name, job.leadName, job.leadPhone, job.leadEmail, formatAddress(job), job.status]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return !query || haystack.includes(query);
    });
  }, [jobs, searchQuery]);

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
          <h2 className="text-2xl font-semibold tracking-tight text-gray-950">Jobs</h2>
          <p className="mt-1 text-sm text-gray-600">Schedule production, track job progress, and keep field work organized.</p>
        </div>
        <Link to="/calendar">
          <Button>Open calendar</Button>
        </Link>
      </div>

      <Card padding="md" className="mb-4">
        <Input
          type="search"
          placeholder="Search customer, job, phone, email, or address"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
        />
      </Card>

      {error && (
        <Card padding="md" className="mb-4 border-red-200 bg-red-50 text-sm text-red-800">
          {error}
        </Card>
      )}

      {filteredJobs.length === 0 ? (
        <EmptyState
          title="No jobs found"
          description="Accepted estimates become jobs once the work is ready to schedule."
          action={<Link to="/calendar"><Button>Open calendar</Button></Link>}
        />
      ) : (
        <div className="grid gap-3">
          {filteredJobs.map((job) => {
            const address = formatAddress(job);
            return (
              <Card key={job.id} hoverable padding="md">
                <Link to={`/jobs/${job.id}`} className="block">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-base font-semibold text-gray-950">
                          {job.name || job.leadName || 'Untitled job'}
                        </h3>
                        <StatusBadge status={String(job.status || 'scheduled')} />
                      </div>
                      {job.leadName && job.name !== job.leadName && (
                        <p className="truncate text-sm font-medium text-gray-700">{job.leadName}</p>
                      )}
                      {address && <p className="truncate text-sm text-gray-600">{address}</p>}
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-gray-500">
                        {job.leadPhone && <span>{formatPhone(job.leadPhone)}</span>}
                        {job.leadEmail && <span className="truncate">{job.leadEmail}</span>}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
                        {job.scheduledStartAt && <span>Starts {formatDate(job.scheduledStartAt)}</span>}
                        {job.scheduledEndAt && <span>Ends {formatDate(job.scheduledEndAt)}</span>}
                        {job.estimatedLaborHours && <span>{Number(job.estimatedLaborHours).toLocaleString()} est. hours</span>}
                      </div>
                    </div>
                    <div className="text-left sm:text-right">
                      <p className="text-lg font-semibold text-gray-950">{formatMoney(job.budget || 0)}</p>
                      <p className="text-xs font-medium text-gray-500">Budget</p>
                    </div>
                  </div>
                </Link>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
