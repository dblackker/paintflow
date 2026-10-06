import { ReactNode, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DashboardCollections, DashboardOverview } from '@crewmodo/core';
import { StatusBadge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { apiJson, CrewmodoApiError, formatMoney } from '@/lib/api';

function useDashboardResource<T>(path: string, refreshKey: number) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    apiJson<{ data: T }>(`${path}?timeZone=${encodeURIComponent(timeZone)}`, {
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.data || Array.isArray(response.data))
          throw new Error('Invalid dashboard response');
        if (!controller.signal.aborted) setData(response.data);
      })
      .catch((failure) => {
        if (!controller.signal.aborted) {
          setError(failure);
          if (failure instanceof CrewmodoApiError && failure.status === 403)
            setData(null);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [path, refreshKey, retry]);
  return { data, loading, error, retry: () => setRetry((value) => value + 1) };
}

function InlineFailure({
  text,
  onRetry,
}: {
  text: string;
  onRetry: () => void;
}) {
  return (
    <div className="dashboard-inline-error" role="status">
      <Icon name="warning" className="pf-icon" />
      <span className="pf-helper">{text}</span>
      <Button variant="ghost" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

export function DashboardDaily({
  refreshKey,
  recommendations,
}: {
  refreshKey: number;
  recommendations: ReactNode;
}) {
  const overview = useDashboardResource<DashboardOverview>(
    '/v1/dashboard/overview',
    refreshKey,
  );
  const collections = useDashboardResource<DashboardCollections>(
    '/v1/dashboard/collections',
    refreshKey,
  );
  const denied =
    collections.error instanceof CrewmodoApiError &&
    collections.error.status === 403;
  const data = overview.data;
  const money = collections.data;
  const date = (value: string) =>
    new Date(value).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      timeZone: data?.timeZone,
    });
  const number = (value: number | undefined) =>
    value === undefined ? '—' : value.toLocaleString();

  return (
    <section className="dashboard-workday" aria-label="Workday overview">
      <div
        className={`dashboard-snapshot ${denied ? 'dashboard-snapshot--restricted' : ''}`}
        aria-label="Business snapshot"
      >
        <Link to="/calendar" className="dashboard-snapshot-item">
          <span className="pf-meta">Jobs today</span>
          <span className="pf-section-title">
            {number(data?.todayJobCount)}
          </span>
        </Link>
        <Link to="/estimates?status=sent" className="dashboard-snapshot-item">
          <span className="pf-meta">Awaiting approval</span>
          <span className="pf-section-title">
            {number(data?.awaitingApproval)}
          </span>
        </Link>
        {!denied && (
          <Link to="/invoices" className="dashboard-snapshot-item">
            <span className="pf-meta">Open invoices</span>
            <span className="pf-section-title">
              {money ? formatMoney(money.outstanding) : '—'}
            </span>
            <span className="pf-meta">
              {money
                ? `${number(money.invoiceCount)} to collect`
                : collections.loading
                  ? 'Loading...'
                  : 'Unavailable'}
            </span>
          </Link>
        )}
      </div>
      {Boolean(overview.error) && (
        <InlineFailure
          text={
            data
              ? 'Workday could not be refreshed. Showing previous results.'
              : 'Workday could not be loaded. Other tools are available.'
          }
          onRetry={overview.retry}
        />
      )}
      {!denied && Boolean(collections.error) && (
        <InlineFailure
          text={
            money
              ? 'Invoice balances could not be refreshed. Showing previous results.'
              : 'Invoice balances could not be loaded.'
          }
          onRetry={collections.retry}
        />
      )}
      {data?.totalCustomers === 0 && (
        <div className="dashboard-get-started">
          <Icon name="users" className="pf-icon" />
          <div>
            <p className="pf-row-title">Start with a customer</p>
            <p className="pf-helper">
              Add your first inquiry or create an invoice.
            </p>
          </div>
          <Link to="/leads?new=1" className="btn-text btn-sm">
            Add lead
          </Link>
        </div>
      )}
      <div className="dashboard-workday-grid">
        <section
          className="dashboard-section"
          aria-labelledby="today-jobs-title"
          aria-busy={overview.loading}
        >
          <header className="dashboard-section-heading">
            <div>
              <h2 id="today-jobs-title" className="pf-section-title">
                Today's jobs
              </h2>
              <p className="pf-meta">
                {data
                  ? `${number(data.todayJobCount)} on the schedule`
                  : 'Production schedule'}
              </p>
            </div>
            <Link to="/calendar" className="btn-text btn-sm">
              View schedule
            </Link>
          </header>
          {!data && overview.loading ? (
            <div
              className="dashboard-daily-skeleton animate-pulse"
              role="status"
              aria-label="Loading today's jobs"
            />
          ) : (
            data && (
              <>
                {data.todayJobs.length ? (
                  <ul className="dashboard-daily-list">
                    {data.todayJobs.map((job) => (
                      <li key={job.id}>
                        <Link
                          to={`/jobs/${job.id}`}
                          className="dashboard-job-row"
                        >
                          <div className="dashboard-job-icon">
                            <Icon name="briefcase" className="pf-icon" />
                          </div>
                          <div className="dashboard-row-content">
                            <span className="pf-row-title">
                              {job.streetAddress || job.name}
                            </span>
                            <span className="pf-meta">
                              {[job.customerName, job.city]
                                .filter(Boolean)
                                .join(' · ')}
                            </span>
                            <StatusBadge status={job.status} />
                          </div>
                          <Icon name="chevron-right" className="pf-icon" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="dashboard-empty">
                    <Icon name="calendar" className="pf-icon" />
                    <p className="pf-copy">No jobs scheduled today.</p>
                    <Link
                      to="/calendar#needs-scheduling"
                      className="btn-text btn-sm"
                    >
                      Schedule a job
                    </Link>
                  </div>
                )}
                {data.todayJobCount > data.todayJobs.length && (
                  <Link to="/calendar" className="btn-text btn-sm">
                    View all {number(data.todayJobCount)} jobs
                  </Link>
                )}
              </>
            )
          )}
        </section>
        <section
          className="dashboard-section"
          aria-labelledby="attention-title"
        >
          <header className="dashboard-section-heading">
            <div>
              <h2 id="attention-title" className="pf-section-title">
                Needs attention
              </h2>
              <p className="pf-meta">Follow-ups and next steps</p>
            </div>
            <Link to="/activity" className="btn-text btn-sm">
              View activity
            </Link>
          </header>
          {data && (
            <>
              <div className="dashboard-attention-summary">
                {data.overdueTasks > 0 && (
                  <span className="pf-status pf-status-danger">
                    {number(data.overdueTasks)} overdue
                  </span>
                )}
                {data.dueToday > 0 && (
                  <span className="pf-status pf-status-info">
                    {number(data.dueToday)} due today
                  </span>
                )}
                {data.newLeads > 0 && (
                  <Link to="/leads?status=new" className="btn-text btn-sm">
                    <Icon name="users" className="pf-icon" />
                    {number(data.newLeads)} new{' '}
                    {data.newLeads === 1 ? 'inquiry' : 'inquiries'}
                  </Link>
                )}
              </div>
              {data.tasks.length > 0 && (
                <ul className="dashboard-daily-list">
                  {data.tasks.map((task) => (
                    <li key={task.id}>
                      <Link to={task.href} className="dashboard-task-row">
                        <Icon
                          name={task.overdue ? 'warning' : 'clock'}
                          className={`pf-icon ${task.overdue ? 'dashboard-danger' : ''}`}
                        />
                        <div className="dashboard-row-content">
                          <span className="pf-copy">{task.title}</span>
                          <span className="pf-meta">
                            {[
                              task.customerName,
                              task.overdue
                                ? `Overdue · ${date(task.dueAt)}`
                                : 'Due today',
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        </div>
                        <Icon name="chevron-right" className="pf-icon" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {money && money.overdueCount > 0 && (
                <Link to="/invoices" className="dashboard-task-row">
                  <Icon
                    name="credit-card"
                    className="pf-icon dashboard-danger"
                  />
                  <div className="dashboard-row-content">
                    <span className="pf-copy">
                      {formatMoney(money.overdue)} past due
                    </span>
                    <span className="pf-meta">
                      {number(money.overdueCount)} invoice
                      {money.overdueCount === 1 ? '' : 's'} to follow up
                    </span>
                  </div>
                  <Icon name="chevron-right" className="pf-icon" />
                </Link>
              )}
              {money && money.reviewCount > 0 && (
                <Link to="/invoices" className="dashboard-task-row">
                  <Icon name="warning" className="pf-icon" />
                  <span className="pf-helper">
                    {number(money.reviewCount)} invoice balance
                    {money.reviewCount === 1 ? ' needs' : 's need'} review
                    before collection.
                  </span>
                  <Icon name="chevron-right" className="pf-icon" />
                </Link>
              )}
              {data.tasks.length === 0 &&
                data.newLeads === 0 &&
                (!money || money.overdueCount === 0) && (
                  <p className="dashboard-quiet pf-helper">
                    No follow-ups due today.
                  </p>
                )}
            </>
          )}
          {recommendations}
        </section>
      </div>
    </section>
  );
}
