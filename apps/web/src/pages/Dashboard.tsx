import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { StatusBadge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { apiJson, formatAddress, formatMoney, formatPhone, labelize } from '@/lib/api';

interface DashboardStats {
  activeLeads: number;
  estimatesSent: number;
  jobsThisMonth: number;
  recentActivity?: Activity[];
}

interface Activity {
  id: string;
  href?: string;
  title?: string;
  status?: string;
  source?: string;
  activityLabel?: string;
  clientName?: string;
  leadId?: string;
  leadPhone?: string;
  leadEmail?: string;
  leadStreetAddress?: string;
  leadCity?: string;
  leadState?: string;
  leadPostalCode?: string;
  total?: number | string;
  occurredAt?: string;
  activityAt?: string;
  sentAt?: string;
  createdAt?: string;
}

interface RecommendationAction {
  label: string;
  method?: string;
  path: string;
  successMessage?: string;
  body?: Record<string, unknown>;
}

interface Recommendation {
  id: string;
  type?: string;
  title: string;
  body: string;
  impact?: string;
  evidence?: string;
  href?: string;
  primaryAction?: RecommendationAction;
  secondaryAction?: { label?: string; href?: string };
}

interface QuickAction {
  id: string;
  label: string;
  href: string;
  icon: string;
  priority?: boolean;
  defaultVisible: boolean;
}

interface QuickActionPreference {
  id: string;
  visible: boolean;
}

const quickActionCatalog: QuickAction[] = [
  { id: 'add_lead', label: 'Add lead', href: '/leads?new=1', icon: 'plus', priority: true, defaultVisible: true },
  { id: 'create_estimate', label: 'Production estimate', href: '/estimates/production', icon: 'file-text', priority: true, defaultVisible: true },
  { id: 'quick_estimate', label: 'Quick estimate', href: '/estimates/new', icon: 'file-text', defaultVisible: false },
  { id: 'log_time', label: 'Log time', href: '/time', icon: 'clock', defaultVisible: true },
  { id: 'open_jobs', label: 'Open jobs', href: '/jobs', icon: 'briefcase', defaultVisible: true },
  { id: 'pipeline', label: 'Pipeline', href: '/pipeline', icon: 'bar-chart', defaultVisible: true },
  { id: 'messages', label: 'Messages', href: '/sms', icon: 'message', defaultVisible: true },
  { id: 'schedule', label: 'Schedule', href: '/calendar', icon: 'calendar', defaultVisible: false },
  { id: 'paint_products', label: 'Paint products', href: '/materials', icon: 'paint-bucket', defaultVisible: true },
  { id: 'production_rates', label: 'Production rates', href: '/production-rates', icon: 'settings', defaultVisible: false },
  { id: 'team', label: 'Team', href: '/team', icon: 'users', defaultVisible: false },
  { id: 'payments', label: 'Payments', href: '/payments/stripe', icon: 'credit-card', defaultVisible: false },
  { id: 'reports', label: 'Reports', href: '/reports', icon: 'bar-chart', defaultVisible: false },
  { id: 'billing', label: 'Billing', href: '/billing', icon: 'credit-card', defaultVisible: false },
  { id: 'invoices', label: 'Material invoices', href: '/invoices', icon: 'file-text', defaultVisible: false },
  { id: 'payroll', label: 'Payroll export', href: '/payroll', icon: 'credit-card', defaultVisible: false },
  { id: 'roles', label: 'Roles and permissions', href: '/roles', icon: 'users', defaultVisible: false },
  { id: 'reviews', label: 'Review requests', href: '/reviews', icon: 'message', defaultVisible: false },
  { id: 'templates', label: 'Templates', href: '/templates', icon: 'templates', defaultVisible: false },
  { id: 'settings', label: 'Business settings', href: '/settings', icon: 'settings', defaultVisible: false },
];

const ownerTools = [
  ['Production rates', '/production-rates'],
  ['Paint products and costs', '/materials'],
  ['Reports suite', '/reports'],
  ['Schedule calendar', '/calendar'],
  ['Material invoices', '/invoices'],
  ['Payroll export', '/payroll'],
  ['Roles and permissions', '/roles'],
  ['Crew management', '/team'],
  ['Review requests', '/reviews'],
  ['Billing and subscription', '/billing'],
  ['Stripe setup', '/payments/stripe'],
];

const catalogById = new Map(quickActionCatalog.map((action) => [action.id, action]));

function defaultQuickActionState() {
  return quickActionCatalog.map((action) => ({ id: action.id, visible: action.defaultVisible }));
}

function mergeQuickActionPreferences(actions?: QuickActionPreference[]) {
  const seen = new Set<string>();
  const merged: QuickActionPreference[] = [];

  for (const entry of actions || []) {
    const action = catalogById.get(entry?.id);
    if (!action || seen.has(action.id)) continue;
    seen.add(action.id);
    merged.push({ id: action.id, visible: Boolean(entry.visible) });
  }

  for (const action of quickActionCatalog) {
    if (!seen.has(action.id)) merged.push({ id: action.id, visible: action.defaultVisible });
  }

  return merged;
}

function relativeDate(value?: string) {
  if (!value) return '';
  const date = new Date(value);
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
  return date.toLocaleDateString();
}

function activityText(event: Activity) {
  if (event.title) return event.title;
  const action = event.activityLabel || (event.status === 'sent' ? 'Estimate sent' : `Estimate ${labelize(event.status).toLowerCase()}`);
  const amount = Number(event.total || 0) > 0 ? ` - ${formatMoney(event.total, false)}` : '';
  return `${action} for ${event.clientName || 'customer'}${amount}`;
}

function recommendationTone(type?: string) {
  if (type === 'job_in_production') return 'Operational';
  if (type === 'estimate_follow_up') return 'Sales follow-up';
  return 'Lead nurture';
}

function recommendationIcon(type?: string) {
  if (type === 'job_in_production') return 'briefcase';
  if (type === 'estimate_follow_up') return 'file-text';
  return 'message';
}

export function Dashboard() {
  const [stats, setStats] = useState<DashboardStats>({ activeLeads: 0, estimatesSent: 0, jobsThisMonth: 0 });
  const [recentActivity, setRecentActivity] = useState<Activity[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [quickActions, setQuickActions] = useState<QuickActionPreference[]>(defaultQuickActionState);
  const [isEditingActions, setIsEditingActions] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [setupPrompt, setSetupPrompt] = useState(false);
  const [applyingRecommendation, setApplyingRecommendation] = useState('');

  const visibleQuickActions = useMemo(() => quickActions
    .map((entry) => ({ ...entry, action: catalogById.get(entry.id) }))
    .filter((entry): entry is QuickActionPreference & { action: QuickAction } => Boolean(entry.visible && entry.action)), [quickActions]);

  const primaryActions = (visibleQuickActions.length ? visibleQuickActions : quickActionCatalog.slice(0, 4).map((action) => ({ id: action.id, visible: true, action }))).slice(0, 4);

  async function loadDashboard() {
    setLoading(true);
    try {
      const [statsResponse, activityResponse, recommendationsResponse, quickActionsResponse, orgResponse] = await Promise.all([
        apiJson<{ data: DashboardStats }>('/v1/dashboard/stats'),
        apiJson<{ data: Activity[] }>('/v1/activities/feed?limit=5'),
        apiJson<{ data: Recommendation[] }>('/v1/dashboard/recommendations'),
        apiJson<{ data: { actions: QuickActionPreference[] } }>('/v1/settings/dashboard-actions'),
        apiJson<{ data: { companyName?: string | null; onboardingCompletedAt?: string | null } }>('/v1/settings/org').catch(() => null),
      ]);

      setStats(statsResponse.data);
      setRecentActivity(activityResponse.data || statsResponse.data.recentActivity || []);
      setRecommendations(recommendationsResponse.data || []);
      setQuickActions(mergeQuickActionPreferences(quickActionsResponse.data.actions));
      setSetupPrompt(Boolean(orgResponse && orgResponse.data.companyName && !orgResponse.data.onboardingCompletedAt));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard();
  }, []);

  async function saveQuickActionPreferences() {
    try {
      await apiJson<{ data: { actions: QuickActionPreference[] } }>('/v1/settings/dashboard-actions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actions: quickActions.map(({ id, visible }) => ({ id, visible })) }),
      });
      setIsEditingActions(false);
      window.showToast?.('Quick actions updated', 'success');
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to save quick actions', 'error');
    }
  }

  async function applyRecommendation(recommendation: Recommendation) {
    if (!recommendation.primaryAction) return;
    const action = recommendation.primaryAction;
    setApplyingRecommendation(recommendation.id);
    try {
      await apiJson(action.path, {
        method: action.method || 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify(action.body || {}),
      });
      setRecommendations((current) => current.filter((item) => item.id !== recommendation.id));
      window.showToast?.(action.successMessage || 'Recommendation applied', 'success');
      loadDashboard();
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Action failed', 'error');
    } finally {
      setApplyingRecommendation('');
    }
  }

  function moveQuickAction(id: string, direction: -1 | 1) {
    setQuickActions((current) => {
      const index = current.findIndex((entry) => entry.id === id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-8 lg:px-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 rounded bg-gray-200" />
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="h-24 rounded-xl bg-gray-200" />
            <div className="h-24 rounded-xl bg-gray-200" />
            <div className="h-24 rounded-xl bg-gray-200" />
          </div>
          <div className="h-64 rounded-xl bg-gray-200" />
        </div>
      </div>
    );
  }

  const hasNoData = !stats.activeLeads && !stats.estimatesSent && !stats.jobsThisMonth;

  return (
    <div className="dashboard-shell mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-8 lg:px-8">
      <div className="dashboard-hero mb-6 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="pf-page-title">Dashboard</h2>
          <p className="pf-page-copy mt-1">Run today's lead, estimate, and job workflow from one place.</p>
        </div>
        <div className="dashboard-primary-actions grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          {primaryActions.map(({ action }, index) => (
            <Link key={action.id} to={action.href} className={`${index === 0 ? 'btn-primary' : 'btn-secondary'} btn-sm justify-center`}>
              <Icon name={action.icon} className="pf-icon" />
              {action.label}
            </Link>
          ))}
        </div>
      </div>

      {error && <Card className="mb-4 border-red-200 bg-red-50 text-sm text-red-800">{error}</Card>}

      {setupPrompt && (
        <section className="mb-6 rounded-lg border border-yellow-200 bg-yellow-50 p-5 sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="pf-row-title text-yellow-900">Complete your setup</p>
              <p className="pf-copy mt-1 text-yellow-800">Finish settings, paint products, service areas, and payments before your first live estimate.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link to="/onboarding" className="btn-primary btn-sm justify-center">Continue setup</Link>
              <Link to="/materials" className="btn-tonal btn-sm justify-center">Paint products</Link>
              <Link to="/payments/stripe" className="btn-tonal btn-sm justify-center">Payments</Link>
            </div>
          </div>
        </section>
      )}

      <section className="dashboard-metrics mb-6 grid grid-cols-3 gap-2 sm:gap-4 md:gap-6">
        <MetricCard to="/leads" label="Active leads" value={stats.activeLeads} action="Open leads" />
        <MetricCard to="/estimates" label="Estimates sent" value={stats.estimatesSent} action="Review estimates" />
        <MetricCard to="/jobs" label="Jobs this month" value={stats.jobsThisMonth} action="Open schedule" />
      </section>

      {hasNoData && (
        <section className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-5 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="pf-section-title text-blue-950">Start with your first lead</p>
              <p className="pf-copy mt-1 text-blue-900">Capture the customer, then build an estimate from production rates when you are ready.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link to="/leads?new=1" className="btn-primary btn-sm justify-center"><Icon name="plus" className="pf-icon" />Add first lead</Link>
              <Link to="/production-rates" className="btn-tonal btn-sm justify-center"><Icon name="settings" className="pf-icon" />Tune rates</Link>
              <Link to="/materials" className="btn-tonal btn-sm justify-center"><Icon name="paint-bucket" className="pf-icon" />Paint products</Link>
            </div>
          </div>
        </section>
      )}

      {recommendations.length > 0 && (
        <section className="dashboard-panel mb-6 rounded-lg bg-white p-5 sm:p-6">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h3 className="pf-section-title">Recommended actions</h3>
              <p className="pf-meta mt-0.5">Auto-detected ways to keep leads, estimates, and jobs moving.</p>
            </div>
            <button type="button" className="btn-icon-tonal btn-icon" aria-label="Refresh recommendations" onClick={loadDashboard}>
              <Icon name="refresh" className="pf-icon" />
            </button>
          </div>
          <div className="grid gap-3">
            {recommendations.map((item) => (
              <article key={item.id} className="grid gap-3 rounded-lg border border-blue-100 bg-blue-50/70 p-4 sm:grid-cols-[auto_1fr_auto] sm:items-start">
                <div className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-blue-100 text-blue-800">
                  <Icon name={recommendationIcon(item.type)} className="pf-icon" />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="pf-row-title">{item.title}</p>
                    <span className="pf-status pf-status-info">{recommendationTone(item.type)}</span>
                  </div>
                  <p className="pf-copy mt-1">{item.body}</p>
                  {item.impact && <p className="pf-meta mt-1">{item.impact}</p>}
                  {item.evidence && <p className="pf-meta mt-1">{item.evidence}</p>}
                </div>
                <div className="flex flex-col gap-2 sm:min-w-48">
                  {item.primaryAction && (
                    <Button
                      size="sm"
                      isLoading={applyingRecommendation === item.id}
                      onClick={() => applyRecommendation(item)}
                    >
                      {item.primaryAction.label}
                    </Button>
                  )}
                  {(item.secondaryAction?.href || item.href) && (
                    <Link to={item.secondaryAction?.href || item.href || '#'} className="btn-text btn-sm justify-center">
                      {item.secondaryAction?.label || 'Review'}
                    </Link>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="dashboard-panel rounded-lg bg-white p-5 sm:p-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="pf-section-title">Recent Activity</h3>
            <Link to="/activity" className="btn-text btn-sm">View all</Link>
          </div>
          {recentActivity.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center">
              <p className="pf-row-title">No activity yet</p>
              <p className="pf-copy mt-1">Add a lead to start tracking calls, estimates, and jobs.</p>
              <Link to="/leads?new=1" className="btn-primary btn-sm mt-4">Add lead</Link>
            </div>
          ) : (
            <div className="grid gap-3">
              {recentActivity.map((activity) => {
                const address = formatAddress(activity);
                return (
                  <Link key={activity.id} to={activity.href || `/estimates/${activity.id}`} className="dashboard-activity-card block rounded-lg border border-gray-200 bg-white p-4 hover:border-blue-300 hover:bg-blue-50/40">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="pf-row-title leading-5">{activityText(activity)}</p>
                        <p className="pf-meta mt-0.5">{relativeDate(activity.occurredAt || activity.activityAt || activity.sentAt || activity.createdAt)}</p>
                        <div className="mt-2 text-sm text-gray-600">
                          <p className="font-medium text-gray-900">{activity.clientName || 'Customer'}</p>
                          {address && <p className="truncate">{address}</p>}
                          <div className="flex flex-wrap gap-x-3">
                            {activity.leadPhone && <span>{formatPhone(activity.leadPhone)}</span>}
                            {activity.leadEmail && <span>{activity.leadEmail}</span>}
                          </div>
                        </div>
                      </div>
                      <StatusBadge status={String(activity.status || activity.source || 'activity')} />
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        <aside className="space-y-4">
          <div className="dashboard-panel rounded-lg bg-white p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="pf-section-title">Quick actions</p>
                <p className="pf-meta mt-0.5">Configure the shortcuts your team uses daily.</p>
              </div>
              <button type="button" className="btn-icon-tonal btn-icon" aria-label="Customize quick actions" onClick={() => setIsEditingActions(true)}>
                <Icon name="edit" className="pf-icon" />
              </button>
            </div>
            <div className="mt-4 grid gap-2">
              {visibleQuickActions.length === 0 ? (
                <div className="pf-copy rounded-lg border border-dashed p-4 text-center">
                  No quick actions are visible.
                  <Button variant="secondary" size="sm" className="mt-3" onClick={() => setIsEditingActions(true)}>Choose actions</Button>
                </div>
              ) : visibleQuickActions.map(({ action }, index) => (
                <Link key={action.id} to={action.href} className={`${index === 0 && action.priority ? 'btn-primary' : 'btn-outlined'} btn-sm w-full justify-start`}>
                  <Icon name={action.icon} className="pf-icon" />
                  {action.label}
                </Link>
              ))}
            </div>
          </div>

          <div className="dashboard-panel rounded-lg bg-white p-5">
            <p className="pf-section-title">Owner tools</p>
            <div className="mt-3 grid gap-1">
              {ownerTools.map(([label, href]) => (
                <Link key={href} to={href} className="dashboard-owner-link flex items-center justify-between rounded-lg px-3 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50 hover:text-blue-700">
                  {label}
                  <span aria-hidden="true">&gt;</span>
                </Link>
              ))}
            </div>
          </div>

          {import.meta.env.DEV && (
            <div className="dashboard-panel rounded-lg bg-white p-5">
              <Link to="/dev/design-system" className="pf-meta hover:text-blue-700 hover:underline">Design system preview</Link>
            </div>
          )}
        </aside>
      </section>

      {isEditingActions && (
        <div className="fixed inset-0 z-50 flex items-end bg-gray-950/40 p-0 sm:items-center sm:justify-center sm:p-4" role="dialog" aria-modal="true">
          <div className="max-h-[92vh] w-full overflow-hidden rounded-t-2xl bg-white shadow-xl sm:max-w-2xl sm:rounded-2xl">
            <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
              <div>
                <h3 className="pf-section-title">Customize quick actions</h3>
                <p className="pf-copy mt-1">Choose dashboard shortcuts, then move the most-used actions to the top.</p>
              </div>
              <button type="button" className="btn-icon" aria-label="Close quick actions editor" onClick={() => setIsEditingActions(false)}>
                <Icon name="close" className="pf-icon" />
              </button>
            </div>
            <div className="max-h-[62vh] overflow-y-auto px-5 py-4">
              <div className="grid gap-2">
                {quickActions.map((entry, index) => {
                  const action = catalogById.get(entry.id);
                  if (!action) return null;
                  return (
                    <div key={entry.id} className="flex items-center gap-3 rounded-xl border bg-white p-3">
                      <label className="flex min-w-0 flex-1 items-center gap-3">
                        <input
                          type="checkbox"
                          className="h-5 w-5 rounded border-gray-300"
                          checked={entry.visible}
                          onChange={(event) => setQuickActions((current) => current.map((item) => item.id === entry.id ? { ...item, visible: event.target.checked } : item))}
                        />
                        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-700">
                          <Icon name={action.icon} className="pf-icon" />
                        </span>
                        <span className="min-w-0">
                          <span className="pf-row-title block truncate">{action.label}</span>
                          <span className="pf-meta block truncate">{action.href}</span>
                        </span>
                      </label>
                      <div className="flex shrink-0 gap-1">
                        <Button variant="ghost" size="sm" disabled={index === 0} onClick={() => moveQuickAction(entry.id, -1)}>Up</Button>
                        <Button variant="ghost" size="sm" disabled={index === quickActions.length - 1} onClick={() => moveQuickAction(entry.id, 1)}>Down</Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="flex flex-col gap-2 border-t bg-gray-50 px-5 py-4 sm:flex-row sm:justify-end">
              <Button variant="ghost" onClick={() => setQuickActions(defaultQuickActionState())}>Reset defaults</Button>
              <Button onClick={saveQuickActionPreferences}>Save actions</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCard({ to, label, value, action }: { to: string; label: string; value: number; action: string }) {
  return (
    <Link to={to} className="dashboard-metric-card rounded-lg border border-gray-200 bg-white p-3 shadow-sm transition-all hover:border-blue-300 hover:shadow-md sm:p-6">
      <p className="pf-metric-label">{label}</p>
      <p className="pf-metric-value mt-2">{Number(value || 0).toLocaleString()}</p>
      <p className="pf-meta mt-3 text-blue-700 max-sm:hidden">{action}</p>
    </Link>
  );
}
