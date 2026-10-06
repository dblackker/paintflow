import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DashboardInsights as Insights, DashboardWeeks } from '@crewmodo/core';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Select } from '@/components/Input';
import { apiJson } from '@/lib/api';
import '@/styles/dashboard.css';

const number = (value: number) => value.toLocaleString();
const percent = (value: number | null) => value === null ? 'Not yet' : `${value}%`;
const date = (value: string) => new Date(`${value}T12:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
const shortDate = (value: string) => new Date(`${value}T12:00:00Z`).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric', timeZone: 'UTC' });
const compact = (value: number) => new Intl.NumberFormat(undefined, { notation: value >= 1000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value);

const operations = [
  { id: 'depositPending', label: 'Awaiting deposit', icon: 'credit-card', href: '/jobs?status=deposit_pending', tone: 'warning' },
  { id: 'needsScheduling', label: 'Needs scheduling', icon: 'calendar', href: '/calendar#needs-scheduling', tone: 'warning' },
  { id: 'scheduled', label: 'Scheduled', icon: 'calendar', href: '/calendar', tone: 'info' },
  { id: 'inProduction', label: 'In production', icon: 'paint-bucket', href: '/jobs?status=in_progress', tone: 'info' },
  { id: 'punchList', label: 'Punch list', icon: 'check', href: '/jobs?status=punch_list', tone: 'warning' },
  { id: 'completed', label: 'Completed', icon: 'check', href: null, tone: 'success' },
] as const;

export function DashboardInsights({ refreshKey = 0 }: { refreshKey?: number }) {
  const [weeks, setWeeks] = useState<DashboardWeeks>(8);
  const [data, setData] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const request = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    const generation = ++request.current;
    setLoading(true);
    setError(false);
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    apiJson<{ data: Insights }>(`/v1/dashboard/insights?weeks=${weeks}&timeZone=${encodeURIComponent(timeZone)}`, { signal: controller.signal })
      .then((response) => { if (!controller.signal.aborted && generation === request.current) setData(response.data); })
      .catch(() => { if (!controller.signal.aborted && generation === request.current) setError(true); })
      .finally(() => { if (generation === request.current && !controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [weeks, refreshKey, retry]);

  const max = Math.max(1, ...(data?.weeklyLeads.map((week) => week.count) || []));
  const funnel = data?.funnel;
  const stages = funnel ? [
    { label: 'Leads', count: funnel.leads, rate: null, detail: 'New in this period', tone: 'leads' },
    { label: 'Estimate created', count: funnel.estimated, rate: funnel.estimateRate, detail: 'of leads', tone: 'estimated' },
    { label: 'Estimate sent', count: funnel.sent, rate: funnel.sendRate, detail: 'of estimated leads', tone: 'sent' },
    { label: 'Won', count: funnel.won, rate: funnel.approvalRate, detail: 'of sent leads', tone: 'won' },
  ] : [];

  return (
    <section className="dashboard-insights" aria-label="Sales and operations insights">
      <header className="dashboard-insights-heading">
        <div>
          <h2 className="pf-section-title">Business performance</h2>
          <p className="pf-meta">{data ? `${date(data.range.startDate)} - ${date(data.range.endDate)}` : 'Lead trends and production queues'}</p>
        </div>
        <div className="dashboard-range">
          <Select label="Period" aria-label="Insights period" value={weeks} onChange={(event) => setWeeks(Number(event.target.value) as DashboardWeeks)}>
            <option value="4">4 weeks</option><option value="8">8 weeks</option><option value="12">12 weeks</option>
          </Select>
        </div>
      </header>

      {error && <div className="dashboard-insights-error" role="status">
        <Icon name="warning" className="pf-icon" />
        <p className="pf-copy">Insights could not be refreshed.{data ? ' Showing the last loaded results.' : ' Your other dashboard tools are still available.'}</p>
        <Button variant="ghost" size="sm" onClick={() => setRetry((value) => value + 1)}>Retry insights</Button>
      </div>}

      {!data && loading ? <div className="dashboard-insights-skeleton" aria-label="Loading sales insights" role="status">
        <div className="animate-pulse" /><div className="animate-pulse" />
      </div> : data && <div className={`dashboard-insights-body ${loading ? 'dashboard-insights-body--loading' : ''}`} aria-busy={loading}>
        {loading && <p className="dashboard-insights-updating pf-meta" role="status">Updating insights...</p>}
        <div className="dashboard-sales-grid">
          <section className="dashboard-insight-section" aria-labelledby="weekly-leads-title">
            <header className="dashboard-section-heading">
              <div><h3 id="weekly-leads-title" className="pf-row-title">Leads per week</h3><p className="pf-meta">Monday - Sunday</p></div>
              <div className="dashboard-insight-total"><span className="pf-section-title">{number(data.funnel.leads)}</span><span className="pf-meta">new leads</span></div>
            </header>
            <ol className="dashboard-week-chart" style={{ gridTemplateColumns: `repeat(${data.range.weeks}, minmax(0, 1fr))` }} aria-label="Weekly new leads">
              {data.weeklyLeads.map((week) => <li key={week.weekStart} title={`Week of ${date(week.weekStart)}: ${number(week.count)} leads${week.current ? ' (week to date)' : ''}`}>
                <span className="sr-only">Week of {date(week.weekStart)}: {number(week.count)} leads{week.current ? ', week to date' : ''}</span>
                <span className="dashboard-week-count pf-meta" aria-hidden="true">{compact(week.count)}</span>
                <div className="dashboard-week-track" aria-hidden="true"><span className={week.current ? 'dashboard-week-bar dashboard-week-bar--current' : 'dashboard-week-bar'} style={{ height: `${week.count / max * 100}%` }} /></div>
              </li>)}
            </ol>
            <div className="dashboard-week-axis pf-meta" aria-hidden="true">{[0, Math.floor(data.range.weeks / 2), data.range.weeks - 1].map((index) => <span key={index}>{shortDate(data.weeklyLeads[index].weekStart)}</span>)}</div>
            {data.funnel.leads === 0 && <p className="pf-helper">No new leads in this period.</p>}
            <div className="dashboard-chart-footer"><span className="pf-meta">{number(data.weeklyLeads[data.weeklyLeads.length - 1]?.count || 0)} this week <span className="dashboard-current-dot" aria-hidden="true" /></span><Link to="/leads" className="btn-text btn-sm">View leads</Link></div>
          </section>

          <section className="dashboard-insight-section" aria-labelledby="sales-funnel-title">
            <header className="dashboard-section-heading">
              <div><h3 id="sales-funnel-title" className="pf-row-title">Sales funnel</h3><p className="pf-meta">Same leads, tracked through today</p></div>
              <div className="dashboard-insight-total"><span className="pf-section-title">{percent(funnel?.winRate ?? null)}</span><span className="pf-meta">lead-to-win</span></div>
            </header>
            <ol className="dashboard-funnel">
              {stages.map((stage) => <li key={stage.label}>
                <div className="dashboard-funnel-label"><span className="pf-copy">{stage.label}</span><span className="pf-value">{number(stage.count)}</span></div>
                <div className="dashboard-funnel-track" aria-hidden="true"><span className={`dashboard-funnel-bar dashboard-funnel-bar--${stage.tone}`} style={{ width: `${funnel?.leads ? stage.count / funnel.leads * 100 : 0}%` }} /></div>
                <p className="pf-meta">{stage.tone === 'leads' ? stage.detail : `${percent(stage.rate)} ${stage.detail}`}</p>
              </li>)}
            </ol>
            <div className="dashboard-funnel-outcomes pf-meta"><span>{number(data.funnel.open)} open</span><span>{number(data.funnel.lost)} lost</span>{data.funnel.manualWins > 0 && <span>{number(data.funnel.manualWins)} manual wins</span>}</div>
            <div className="dashboard-chart-footer">
              <details className="dashboard-insights-definition"><summary className="btn-text btn-sm"><Icon name="info" className="pf-icon" />How it's counted</summary><p className="pf-helper">Each customer created in this period counts once per stage, even with multiple estimates or revisions. Created includes drafts. Sent includes earlier sent revisions. Won means an accepted, non-voided estimate, not a payment. Manual wins without an accepted estimate appear separately. Recent leads may still be deciding.</p></details>
              <Link to="/pipeline" className="btn-text btn-sm">View pipeline</Link>
            </div>
          </section>
        </div>

        <section className="dashboard-operations" aria-labelledby="operations-title">
          <header className="dashboard-section-heading"><div><h3 id="operations-title" className="pf-row-title">Operations now</h3><p className="pf-meta">Open jobs across all periods</p></div><Link to="/calendar" className="btn-text btn-sm">View schedule</Link></header>
          <div className="dashboard-operation-list">
            {operations.map((item) => {
              const content = <><Icon name={item.icon} className="pf-icon" /><span className="dashboard-operation-label"><span className="pf-copy">{item.label}</span>{item.id === 'completed' && <span className="pf-meta">In this period</span>}</span><span className="pf-value">{number(data.operations[item.id])}</span>{item.href && <Icon name="chevron-right" className="pf-icon" />}</>;
              const className = `dashboard-operation dashboard-operation--${item.tone}`;
              return item.href ? <Link key={item.id} to={item.href} className={className}>{content}</Link> : <div key={item.id} className={className}>{content}</div>;
            })}
          </div>
        </section>
      </div>}
    </section>
  );
}
