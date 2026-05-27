import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { StatusBadge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card, CardContent, CardHeader } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icon';
import { apiJson, formatAddress } from '@/lib/api';

interface ReviewRequest {
  id: string;
  leadId?: string | null;
  leadName?: string | null;
  leadStreetAddress?: string | null;
  leadCity?: string | null;
  leadState?: string | null;
  leadPostalCode?: string | null;
  jobName?: string | null;
  status?: string | null;
  rating?: number | string | null;
  sentAt?: string | null;
  createdAt?: string | null;
  respondedAt?: string | null;
}

interface ReviewStats {
  total?: number;
  responseRate?: number;
  avgRating?: number;
  fiveStar?: number;
  requests?: ReviewRequest[];
}

function formatDate(value?: string | null) {
  if (!value) return 'Not sent';
  return new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function ratingStars(value?: number | string | null) {
  const rating = Number(value || 0);
  if (!rating) return null;
  return '★'.repeat(Math.max(1, Math.min(5, rating)));
}

function StatCard({ label, value, help }: { label: string; value: string | number; help: string }) {
  return (
    <Card padding="sm" className="shadow-none">
      <p className="pf-meta">{label}</p>
      <p className="pf-metric mt-1">{value}</p>
      <p className="pf-helper mt-1">{help}</p>
    </Card>
  );
}

function RequestRow({ request }: { request: ReviewRequest }) {
  const address = formatAddress({
    leadStreetAddress: request.leadStreetAddress,
    leadCity: request.leadCity,
    leadState: request.leadState,
    leadPostalCode: request.leadPostalCode,
  });
  const stars = ratingStars(request.rating);

  return (
    <div className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        {request.leadId ? (
          <Link to={`/leads/${request.leadId}`} className="block truncate text-sm font-medium text-gray-950 hover:text-blue-700">
            {request.leadName || 'Customer'}
          </Link>
        ) : (
          <p className="font-medium text-sm">{request.leadName || 'Customer'}</p>
        )}
        <p className="truncate text-sm text-gray-700">{address || 'No jobsite address'}</p>
        <p className="mt-1 text-sm text-gray-600">{request.jobName || 'Job'}</p>
        <p className="pf-meta">
          Requested {formatDate(request.sentAt || request.createdAt)}
          {request.respondedAt ? ` · Responded ${formatDate(request.respondedAt)}` : ''}
        </p>
      </div>
      <div className="flex items-center justify-between gap-3 sm:justify-end">
        {stars ? (
          <div className="text-sm font-semibold text-yellow-700" aria-label={`${request.rating} star rating`}>
            {stars}
          </div>
        ) : (
          <span className="text-sm text-gray-500">No rating</span>
        )}
        <StatusBadge status={String(request.status || 'pending')} />
      </div>
    </div>
  );
}

export function Reviews() {
  const [stats, setStats] = useState<ReviewStats>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadAnalytics();
  }, []);

  async function loadAnalytics() {
    setIsLoading(true);
    setError('');
    try {
      const payload = await apiJson<{ data?: ReviewStats }>('/v1/reviews/stats');
      setStats(payload.data || {});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load review analytics');
    } finally {
      setIsLoading(false);
    }
  }

  const requests = stats.requests || [];

  return (
    <main className="mx-auto max-w-7xl space-y-5 px-1 pb-24 sm:px-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <p className="pf-page-copy max-w-2xl">
          Track review requests, customer feedback, and the closeout flow that can later feed testimonials, before/after posts, and referral campaigns.
        </p>
        <Button as="a" href="/reports" variant="secondary" size="sm" className="justify-center">Back to reports</Button>
      </div>

      <section className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">
        <p className="pf-section-title text-blue-950">Why this lives under Reports</p>
        <p className="mt-1 text-blue-900">
          Reviews are a reputation and marketing metric tied to completed jobs, so this stays a focused reporting drill-in until the marketing suite grows.
        </p>
      </section>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 sm:gap-4">
        <StatCard label="Total requests" value={isLoading ? '-' : stats.total || 0} help="Review requests sent" />
        <StatCard label="Response rate" value={isLoading ? '-' : `${stats.responseRate || 0}%`} help="Customers who responded" />
        <StatCard label="Avg rating" value={isLoading ? '-' : Number(stats.avgRating || 0).toFixed(1)} help="Submitted rating average" />
        <StatCard label="5-star reviews" value={isLoading ? '-' : stats.fiveStar || 0} help="Best-fit testimonial candidates" />
      </div>

      <Card padding="none" className="overflow-hidden">
        <CardHeader
          className="mb-0 border-b border-gray-200 px-4 py-3"
          title="Recent review requests"
          description="Customer feedback and Google/Yelp handoff status."
        >
          <div className="mt-3">
            <Link to="/settings#business-settings" className="btn-text btn-sm">Review links</Link>
          </div>
        </CardHeader>
        <CardContent className="divide-y divide-gray-200">
          {isLoading && (
            <div className="space-y-4 p-4">
              {[0, 1, 2].map((item) => (
                <div key={item} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_8rem]">
                  <div className="space-y-2">
                    <div className="h-4 w-1/2 animate-pulse rounded bg-gray-200" />
                    <div className="h-3 w-2/3 animate-pulse rounded bg-gray-100" />
                  </div>
                  <div className="h-8 animate-pulse rounded bg-gray-100" />
                </div>
              ))}
            </div>
          )}

          {!isLoading && error && (
            <div className="p-8 text-center">
              <Icon name="warning" className="mx-auto h-6 w-6 text-red-600" />
              <p className="pf-copy mt-2 text-red-700">{error}</p>
              <Button type="button" variant="secondary" size="sm" className="mt-4" onClick={loadAnalytics}>
                Retry
              </Button>
            </div>
          )}

          {!isLoading && !error && !requests.length && (
            <EmptyState
              icon={<Icon name="message" className="h-5 w-5" />}
              title="No review requests yet."
              description="Completed jobs can send review requests from the Jobs workflow."
            />
          )}

          {!isLoading && !error && requests.map((request) => (
            <RequestRow key={request.id} request={request} />
          ))}
        </CardContent>
      </Card>
    </main>
  );
}
