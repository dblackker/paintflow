import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/Badge';
import { Card, CardContent, CardHeader } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { apiJson, formatMoney, labelize } from '@/lib/api';

interface DashboardReport {
  totalEstimates?: number;
  approvedEstimates?: number;
  totalRevenue?: number;
  totalCosts?: number;
  winRate?: number;
  profit?: number;
  margin?: number;
}

interface WinRateRow {
  source?: string | null;
  total: number;
  won: number;
  winRate: number;
}

interface CrewRow {
  memberId?: string;
  name?: string | null;
  totalHours?: number | string | null;
  jobsWorked?: number | string | null;
  totalCost?: number | string | null;
}

interface MarginRow {
  jobId: string;
  title?: string | null;
  revenue: number;
  costs: number;
  profit: number;
  margin: number;
}

interface JobRow {
  id: string;
  name?: string | null;
  status?: string | null;
  budget?: string | number | null;
  leadCity?: string | null;
  leadState?: string | null;
  scheduledStartAt?: string | null;
  completedAt?: string | null;
}

interface ReportsState {
  dashboard: DashboardReport;
  winRate: WinRateRow[];
  crew: CrewRow[];
  margins: MarginRow[];
  jobs: JobRow[];
}

function numberValue(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatNumber(value: unknown) {
  return numberValue(value).toLocaleString('en-US');
}

function formatPercent(value: unknown) {
  return `${Math.round(numberValue(value))}%`;
}

function marginTone(margin: number) {
  if (margin >= 30) return 'text-green-700';
  if (margin >= 15) return 'text-amber-700';
  return 'text-red-700';
}

function reportBarWidth(value: number, max: number) {
  if (max <= 0) return '0%';
  return `${Math.max(4, Math.min(100, Math.round((value / max) * 100)))}%`;
}

function SummaryCard({
  label,
  value,
  help,
  icon,
}: {
  label: string;
  value: string | number;
  help: string;
  icon: string;
}) {
  return (
    <Card padding="sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="pf-meta">{label}</p>
          <p className="mt-1 text-2xl font-semibold text-gray-950">{value}</p>
          <p className="pf-helper mt-1">{help}</p>
        </div>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
          <Icon name={icon} className="h-5 w-5" />
        </span>
      </div>
    </Card>
  );
}

function EmptyReport({ title, body }: { title: string; body: string }) {
  return (
    <div className="py-8 text-center">
      <p className="pf-emphasis">{title}</p>
      <p className="pf-copy mt-1">{body}</p>
    </div>
  );
}

export function Reports() {
  const [state, setState] = useState<ReportsState>({
    dashboard: {},
    winRate: [],
    crew: [],
    margins: [],
    jobs: [],
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadReports();
  }, []);

  async function loadReports() {
    setIsLoading(true);
    setError('');
    try {
      const [dashboard, winRate, crew, margins, jobs] = await Promise.all([
        apiJson<{ data?: DashboardReport }>('/v1/reports/dashboard'),
        apiJson<{ data?: WinRateRow[] }>('/v1/reports/win-rate-by-source'),
        apiJson<{ data?: CrewRow[] }>('/v1/reports/crew-performance'),
        apiJson<{ data?: MarginRow[] }>('/v1/reports/profit-margins'),
        apiJson<{ data?: JobRow[] }>('/v1/jobs').catch(() => ({ data: [] })),
      ]);

      setState({
        dashboard: dashboard.data || {},
        winRate: winRate.data || [],
        crew: crew.data || [],
        margins: margins.data || [],
        jobs: jobs.data || [],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load reports');
    } finally {
      setIsLoading(false);
    }
  }

  const revenueByCity = useMemo(() => {
    const rows = new Map<string, { label: string; revenue: number; jobs: number }>();
    state.jobs.forEach((job) => {
      const city = [job.leadCity, job.leadState].filter(Boolean).join(', ') || 'Unassigned city';
      const current = rows.get(city) || { label: city, revenue: 0, jobs: 0 };
      current.revenue += numberValue(job.budget);
      current.jobs += 1;
      rows.set(city, current);
    });
    return Array.from(rows.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 6);
  }, [state.jobs]);

  const jobsByStatus = useMemo(() => {
    const rows = new Map<string, number>();
    state.jobs.forEach((job) => {
      const status = String(job.status || 'unknown');
      rows.set(status, (rows.get(status) || 0) + 1);
    });
    return Array.from(rows.entries()).map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count);
  }, [state.jobs]);

  const topSource = state.winRate.slice().sort((a, b) => numberValue(b.won) - numberValue(a.won))[0];
  const bestMargin = state.margins.slice().sort((a, b) => numberValue(b.margin) - numberValue(a.margin))[0];
  const totalCrewHours = state.crew.reduce((sum, row) => sum + numberValue(row.totalHours), 0);
  const maxCityRevenue = Math.max(0, ...revenueByCity.map((row) => row.revenue));
  const maxCrewHours = Math.max(0, ...state.crew.map((row) => numberValue(row.totalHours)));

  if (isLoading) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="text-center">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-b-2 border-blue-600" />
          <p className="pf-copy mt-4">Loading reports...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-8 lg:px-8">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <p className="pf-copy max-w-2xl">
          One reporting surface for sales, crew performance, job profitability, and market mix. Use this to spot where leads are coming from and whether jobs are producing the margin you expect.
        </p>
        <Link to="/dashboard" className="btn-secondary btn-sm w-full justify-center sm:w-auto">Dashboard</Link>
      </div>

      {error && (
        <Card className="mb-5 border-red-100 bg-red-50" padding="sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="pf-copy text-red-700">{error}</p>
            <button type="button" className="btn-secondary btn-sm" onClick={loadReports}>Retry</button>
          </div>
        </Card>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard label="Win Rate" value={formatPercent(state.dashboard.winRate)} help={`${formatNumber(state.dashboard.approvedEstimates)} of ${formatNumber(state.dashboard.totalEstimates)} estimates accepted`} icon="bar-chart" />
        <SummaryCard label="Revenue" value={formatMoney(state.dashboard.totalRevenue)} help="Accepted estimate value" icon="credit-card" />
        <SummaryCard label="Profit" value={formatMoney(state.dashboard.profit)} help="Revenue less tracked job costs" icon="briefcase" />
        <SummaryCard label="Margin" value={formatPercent(state.dashboard.margin)} help="Gross margin on tracked jobs" icon="paint-bucket" />
      </div>

      <div className="mb-5 grid gap-3 lg:grid-cols-3">
        <Card padding="sm">
          <p className="pf-meta">Best current source</p>
          <p className="pf-section-title mt-1">{topSource?.source || 'No source data'}</p>
          <p className="pf-copy mt-1">{topSource ? `${formatPercent(topSource.winRate)} win rate from ${formatNumber(topSource.total)} leads` : 'Create and source leads to compare channels.'}</p>
        </Card>
        <Card padding="sm">
          <p className="pf-meta">Crew labor logged</p>
          <p className="pf-section-title mt-1">{formatNumber(Math.round(totalCrewHours))} hrs</p>
          <p className="pf-copy mt-1">Use crew hours against job budgets to catch production overruns early.</p>
        </Card>
        <Card padding="sm">
          <p className="pf-meta">Best margin job</p>
          <p className="pf-section-title mt-1">{bestMargin?.title || 'No margin data'}</p>
          <p className="pf-copy mt-1">{bestMargin ? `${formatPercent(bestMargin.margin)} margin on ${formatMoney(bestMargin.revenue)} revenue` : 'Track jobs and costs to see winners.'}</p>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Link to="/reviews" className="rounded-lg border border-blue-100 bg-blue-50/70 p-4 shadow-sm transition hover:border-blue-300 hover:shadow-md">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="pf-meta text-blue-700">Reputation</p>
              <h2 className="pf-section-title mt-1">Review analytics</h2>
              <p className="pf-copy mt-1">Track review requests, response rate, ratings, and closeout feedback that can feed future marketing campaigns.</p>
            </div>
            <span className="btn-text btn-sm pointer-events-none">Open</span>
          </div>
        </Link>

        <Card padding="none">
          <CardHeader className="mb-0 border-b border-gray-200 px-4 py-3" title="Win Rate by Source" description="Marketing channels ranked by accepted estimates." />
          <CardContent className="p-4">
            {state.winRate.length ? (
              <div className="grid gap-3">
                {state.winRate.map((row) => (
                  <div key={row.source || 'Unknown'} className="grid gap-1">
                    <div className="flex items-center justify-between gap-3">
                      <p className="pf-emphasis truncate">{row.source || 'Unknown'}</p>
                      <p className="text-sm font-semibold text-gray-950">{formatPercent(row.winRate)} <span className="font-normal text-gray-500">({formatNumber(row.won)}/{formatNumber(row.total)})</span></p>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                      <div className="h-full rounded-full bg-blue-600" style={{ width: `${Math.min(100, Math.max(0, row.winRate))}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyReport title="No source data yet" body="Create estimates from sourced leads to see win rates." />
            )}
          </CardContent>
        </Card>

        <Card padding="none">
          <CardHeader className="mb-0 border-b border-gray-200 px-4 py-3" title="Crew Performance" description="Hours and cost by crew member." />
          <CardContent className="p-4">
            {state.crew.length ? (
              <div className="grid gap-3">
                {state.crew.slice(0, 8).map((row) => (
                  <div key={row.memberId || row.name || 'unknown'} className="grid gap-1">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="pf-emphasis truncate">{row.name || 'Unknown'}</p>
                        <p className="pf-helper">{formatNumber(row.jobsWorked)} jobs worked</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-gray-950">{formatNumber(Math.round(numberValue(row.totalHours)))} hrs</p>
                        <p className="pf-helper">{formatMoney(row.totalCost)}</p>
                      </div>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                      <div className="h-full rounded-full bg-emerald-600" style={{ width: reportBarWidth(numberValue(row.totalHours), maxCrewHours) }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyReport title="No crew data" body="Log time to see crew performance." />
            )}
          </CardContent>
        </Card>

        <Card padding="none">
          <CardHeader className="mb-0 border-b border-gray-200 px-4 py-3" title="Revenue by City" description="Where booked work is concentrated." />
          <CardContent className="p-4">
            {revenueByCity.length ? (
              <div className="grid gap-3">
                {revenueByCity.map((row) => (
                  <div key={row.label} className="grid gap-1">
                    <div className="flex items-center justify-between gap-3">
                      <p className="pf-emphasis truncate">{row.label}</p>
                      <p className="text-sm font-semibold text-gray-950">{formatMoney(row.revenue)} <span className="font-normal text-gray-500">({row.jobs} jobs)</span></p>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                      <div className="h-full rounded-full bg-purple-600" style={{ width: reportBarWidth(row.revenue, maxCityRevenue) }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyReport title="No city data yet" body="Add jobs with jobsite addresses to see market mix." />
            )}
          </CardContent>
        </Card>

        <Card padding="none">
          <CardHeader className="mb-0 border-b border-gray-200 px-4 py-3" title="Job Status Mix" description="Production pipeline health." />
          <CardContent className="p-4">
            {jobsByStatus.length ? (
              <div className="flex flex-wrap gap-2">
                {jobsByStatus.map((row) => (
                  <Badge key={row.status} variant={row.status === 'completed' ? 'success' : row.status === 'in_progress' ? 'warning' : 'info'}>
                    {labelize(row.status)}: {row.count}
                  </Badge>
                ))}
              </div>
            ) : (
              <EmptyReport title="No jobs yet" body="Accepted estimates become jobs here." />
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2" padding="none">
          <CardHeader className="mb-0 border-b border-gray-200 px-4 py-3" title="Profit Margins" description="Recent jobs, tracked costs, and gross margin." />
          <CardContent className="p-4">
            {state.margins.length ? (
              <div className="grid gap-2">
                {state.margins.slice(0, 10).map((row) => (
                  <Link key={row.jobId} to={`/jobs/${row.jobId}`} className="grid gap-2 rounded-lg border border-gray-200 p-3 transition hover:border-blue-200 hover:bg-blue-50/40 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                    <div className="min-w-0">
                      <p className="pf-emphasis truncate">{row.title || 'Untitled job'}</p>
                      <p className="pf-helper">{formatMoney(row.revenue)} revenue · {formatMoney(row.costs)} tracked cost</p>
                    </div>
                    <div className="text-left sm:text-right">
                      <p className={`text-sm font-semibold ${marginTone(numberValue(row.margin))}`}>{formatPercent(row.margin)}</p>
                      <p className="pf-helper">{formatMoney(row.profit)} profit</p>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyReport title="No margin data yet" body="Complete jobs and track labor/material costs to see margins." />
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
