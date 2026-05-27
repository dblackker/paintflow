import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, StatusBadge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icon';
import { Input, Select } from '@/components/Input';
import { apiJson, formatAddress, formatPhone, labelize } from '@/lib/api';

interface ActivityEvent {
  id: string;
  source?: string | null;
  type?: string | null;
  title?: string | null;
  body?: string | null;
  href?: string | null;
  status?: string | null;
  occurredAt?: string | null;
  activityAt?: string | null;
  sentAt?: string | null;
  createdAt?: string | null;
  leadId?: string | null;
  clientName?: string | null;
  leadPhone?: string | null;
  leadEmail?: string | null;
  leadStreetAddress?: string | null;
  leadCity?: string | null;
  leadState?: string | null;
  leadPostalCode?: string | null;
}

interface ActivityFeedResponse {
  data?: ActivityEvent[];
  nextCursor?: string | null;
}

const typeOptions = [
  { value: 'all', label: 'All activity' },
  { value: 'activity', label: 'Tasks & notes' },
  { value: 'lead', label: 'Leads' },
  { value: 'estimate', label: 'Estimates' },
  { value: 'job', label: 'Jobs' },
  { value: 'message', label: 'Messages' },
];

const statusOptions = [
  { value: 'all', label: 'All statuses' },
  { value: 'open', label: 'Open' },
  { value: 'done', label: 'Done' },
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'unread', label: 'Unread' },
];

function relativeDate(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 0) return 'Just now';
  const diffMinutes = Math.floor(diffMs / 60000);
  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}hr ago`;
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function eventTime(event: ActivityEvent) {
  return event.occurredAt || event.activityAt || event.sentAt || event.createdAt;
}

function eventTypeLabel(event: ActivityEvent) {
  const sourceLabels: Record<string, string> = {
    activity: 'Activity',
    lead: 'Lead',
    estimate: 'Estimate',
    job: 'Job',
    message: 'Message',
  };
  return sourceLabels[String(event.source || '')] || labelize(event.type || 'Activity');
}

function sourceVariant(source?: string | null): 'default' | 'success' | 'warning' | 'danger' | 'info' | 'purple' {
  if (source === 'message') return 'purple';
  if (source === 'estimate') return 'info';
  if (source === 'job') return 'success';
  if (source === 'lead') return 'warning';
  return 'default';
}

function ActivitySkeleton() {
  return (
    <div className="space-y-3">
      {[0, 1, 2, 3].map((item) => (
        <Card key={item} padding="sm" className="shadow-none">
          <div className="flex gap-3">
            <div className="mt-1 h-9 w-9 shrink-0 animate-pulse rounded-full bg-gray-100" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-4 w-2/3 animate-pulse rounded bg-gray-200" />
              <div className="h-3 w-28 animate-pulse rounded bg-gray-100" />
              <div className="h-3 w-4/5 animate-pulse rounded bg-gray-100" />
              <div className="h-11 w-full animate-pulse rounded-lg bg-gray-50" />
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

function ContactSummary({ event }: { event: ActivityEvent }) {
  const address = formatAddress({
    leadStreetAddress: event.leadStreetAddress,
    leadCity: event.leadCity,
    leadState: event.leadState,
    leadPostalCode: event.leadPostalCode,
  });
  const customerHref = event.leadId ? `/leads/${event.leadId}` : event.href || '#';

  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
      <Link to={customerHref} className="pf-row-title hover:text-blue-700">
        {event.clientName || 'Customer'}
      </Link>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-gray-600">
        {address && <span>{address}</span>}
        {event.leadPhone && <span>{formatPhone(event.leadPhone)}</span>}
        {event.leadEmail && <span className="break-all">{event.leadEmail}</span>}
      </div>
    </div>
  );
}

function ActivityCard({ event }: { event: ActivityEvent }) {
  const iconName = event.source === 'message'
    ? 'message'
    : event.source === 'job'
      ? 'briefcase'
      : event.source === 'estimate'
        ? 'file-text'
        : 'clock';

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition hover:border-blue-200 hover:bg-blue-50/30 hover:shadow-md">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-700">
          <Icon name={iconName} className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Link to={event.href || '#'} className="pf-row-title hover:text-blue-700">
                  {event.title || 'Activity recorded'}
                </Link>
                <Badge variant={sourceVariant(event.source)} size="sm">{eventTypeLabel(event)}</Badge>
                {event.status && <StatusBadge status={event.status} />}
              </div>
              <p className="pf-meta mt-1">{relativeDate(eventTime(event))}</p>
            </div>
          </div>
          {event.body && <p className="pf-copy mt-2 line-clamp-2">{event.body}</p>}
          <div className="mt-3">
            <ContactSummary event={event} />
          </div>
        </div>
      </div>
    </div>
  );
}

export function Activity() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [type, setType] = useState('all');
  const [status, setStatus] = useState('all');
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState('');

  const activeFilterCount = useMemo(
    () => [query.trim(), type !== 'all' ? type : '', status !== 'all' ? status : ''].filter(Boolean).length,
    [query, type, status],
  );

  async function loadActivity({ append = false } = {}) {
    if (append && !nextCursor) return;
    if (append) setIsLoadingMore(true);
    else {
      setIsLoading(true);
      setError('');
    }

    const params = new URLSearchParams({ limit: '25' });
    const trimmedQuery = query.trim();
    if (trimmedQuery) params.set('q', trimmedQuery);
    if (type !== 'all') params.set('type', type);
    if (status !== 'all') params.set('status', status);
    if (append && nextCursor) params.set('cursor', nextCursor);

    try {
      const payload = await apiJson<ActivityFeedResponse>(`/v1/activities/feed?${params.toString()}`);
      setEvents((current) => append ? [...current, ...(payload.data || [])] : (payload.data || []));
      setNextCursor(payload.nextCursor || null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load activity';
      if (!append) setError(message);
      window.showToast?.(message, 'error');
    } finally {
      if (append) setIsLoadingMore(false);
      else setIsLoading(false);
    }
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      loadActivity();
    }, query.trim() ? 250 : 0);
    return () => window.clearTimeout(timeout);
  }, [query, type, status]);

  function clearFilters() {
    setQuery('');
    setType('all');
    setStatus('all');
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-1 sm:px-0">
      <p className="pf-page-copy max-w-2xl">
        A chronological record of customer, estimate, job, and message activity.
      </p>

      <Card padding="sm" className="shadow-none">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_170px_170px_auto] md:items-end">
          <Input
            label="Search"
            type="search"
            autoComplete="off"
            enterKeyHint="search"
            placeholder="Customer, address, phone, or activity"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Select
            label="Type"
            value={type}
            onChange={(event) => setType(event.target.value)}
            options={typeOptions}
          />
          <Select
            label="Status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            options={statusOptions}
          />
          <Button
            type="button"
            variant="secondary"
            size="md"
            className="md:mb-0"
            disabled={!activeFilterCount}
            onClick={clearFilters}
          >
            Clear
          </Button>
        </div>
      </Card>

      {isLoading && <ActivitySkeleton />}

      {!isLoading && error && (
        <Card className="text-center">
          <Icon name="warning" className="mx-auto h-6 w-6 text-red-600" />
          <p className="pf-copy mt-2 text-red-700">{error}</p>
          <Button type="button" variant="secondary" size="sm" className="mt-4" onClick={() => loadActivity()}>
            Retry
          </Button>
        </Card>
      )}

      {!isLoading && !error && !events.length && (
        <Card>
          <EmptyState
            icon={<Icon name="clock" className="h-5 w-5" />}
            title="No activity matches this view."
            description={activeFilterCount ? 'Try clearing filters or searching another customer.' : 'Customer events and operational changes will appear here.'}
            action={activeFilterCount ? { label: 'Clear filters', onClick: clearFilters } : undefined}
          />
        </Card>
      )}

      {!isLoading && !error && events.length > 0 && (
        <div className="grid gap-3">
          {events.map((event) => (
            <ActivityCard key={`${event.source || 'activity'}-${event.id}-${event.occurredAt || event.createdAt || ''}`} event={event} />
          ))}
        </div>
      )}

      {!isLoading && !error && nextCursor && (
        <div className="flex justify-center pt-1">
          <Button type="button" variant="secondary" size="sm" isLoading={isLoadingMore} onClick={() => loadActivity({ append: true })}>
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
