import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { StatusBadge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Modal, ModalFooter } from '@/components/Modal';
import { ActivityTimeline } from '@/components/ActivityTimeline';
import { DashboardDaily } from '@/components/dashboard/DashboardDaily';
import { DashboardInsights } from '@/components/dashboard/DashboardInsights';
import { apiJson, formatMoney, labelize } from '@/lib/api';
import '@/styles/dashboard.css';

interface Activity {
  id: string;
  href?: string;
  title?: string;
  status?: string;
  source?: string;
  activityLabel?: string;
  clientName?: string;
  leadStreetAddress?: string;
  total?: number | string;
  occurredAt?: string;
  activityAt?: string;
  sentAt?: string;
  createdAt?: string;
}
interface Recommendation {
  id: string;
  type?: string;
  title: string;
  body: string;
  href?: string;
  primaryAction?: {
    label: string;
    method?: string;
    path: string;
    successMessage?: string;
    body?: Record<string, unknown>;
  };
  secondaryAction?: { label?: string; href?: string };
}
interface QuickAction {
  id: string;
  label: string;
  href: string;
  icon: string;
  defaultVisible: boolean;
}
interface QuickActionPreference {
  id: string;
  visible: boolean;
}

const quickActionCatalog: QuickAction[] = [
  {
    id: 'add_lead',
    label: 'Add lead',
    href: '/leads?new=1',
    icon: 'plus',
    defaultVisible: true,
  },
  {
    id: 'create_estimate',
    label: 'Create estimate',
    href: '/estimates/production',
    icon: 'file-text',
    defaultVisible: true,
  },
  {
    id: 'quick_estimate',
    label: 'Quick estimate',
    href: '/estimates/new',
    icon: 'file-text',
    defaultVisible: false,
  },
  {
    id: 'log_time',
    label: 'Add time',
    href: '/time',
    icon: 'clock',
    defaultVisible: true,
  },
  {
    id: 'open_jobs',
    label: 'View jobs',
    href: '/jobs',
    icon: 'briefcase',
    defaultVisible: true,
  },
  {
    id: 'pipeline',
    label: 'View pipeline',
    href: '/pipeline',
    icon: 'bar-chart',
    defaultVisible: true,
  },
  {
    id: 'messages',
    label: 'View messages',
    href: '/sms',
    icon: 'message',
    defaultVisible: true,
  },
  {
    id: 'schedule',
    label: 'View schedule',
    href: '/calendar',
    icon: 'calendar',
    defaultVisible: false,
  },
  {
    id: 'paint_products',
    label: 'View paint products',
    href: '/materials',
    icon: 'paint-bucket',
    defaultVisible: true,
  },
  {
    id: 'production_rates',
    label: 'View production rates',
    href: '/production-rates',
    icon: 'settings',
    defaultVisible: false,
  },
  {
    id: 'team',
    label: 'View team',
    href: '/team',
    icon: 'users',
    defaultVisible: false,
  },
  {
    id: 'payments',
    label: 'Set up payments',
    href: '/payments/stripe',
    icon: 'credit-card',
    defaultVisible: false,
  },
  {
    id: 'reports',
    label: 'View reports',
    href: '/reports',
    icon: 'bar-chart',
    defaultVisible: false,
  },
  {
    id: 'billing',
    label: 'Manage subscription',
    href: '/billing',
    icon: 'credit-card',
    defaultVisible: false,
  },
  {
    id: 'invoices',
    label: 'View invoices',
    href: '/invoices',
    icon: 'file-text',
    defaultVisible: false,
  },
  {
    id: 'payroll',
    label: 'Export payroll',
    href: '/payroll',
    icon: 'credit-card',
    defaultVisible: false,
  },
  {
    id: 'roles',
    label: 'Manage permissions',
    href: '/roles',
    icon: 'users',
    defaultVisible: false,
  },
  {
    id: 'reviews',
    label: 'View review requests',
    href: '/reviews',
    icon: 'message',
    defaultVisible: false,
  },
  {
    id: 'templates',
    label: 'View templates',
    href: '/templates',
    icon: 'templates',
    defaultVisible: false,
  },
  {
    id: 'settings',
    label: 'Open settings',
    href: '/settings',
    icon: 'settings',
    defaultVisible: false,
  },
];
const catalogById = new Map(
  quickActionCatalog.map((action) => [action.id, action]),
);
const defaultQuickActions = () =>
  quickActionCatalog.map((action) => ({
    id: action.id,
    visible: action.defaultVisible,
  }));
function mergePreferences(entries?: QuickActionPreference[]) {
  const seen = new Set<string>();
  const result: QuickActionPreference[] = [];
  for (const entry of entries || []) {
    if (!catalogById.has(entry.id) || seen.has(entry.id)) continue;
    seen.add(entry.id);
    result.push({ id: entry.id, visible: Boolean(entry.visible) });
  }
  return [
    ...result,
    ...defaultQuickActions().filter((action) => !seen.has(action.id)),
  ];
}
function relativeDate(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - date.getTime()) / 60000),
  );
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}hr ago`;
  if (minutes < 2880) return 'Yesterday';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function activityText(event: Activity) {
  if (event.title) return event.title;
  const action =
    event.activityLabel || `Estimate ${labelize(event.status).toLowerCase()}`;
  return `${action} for ${event.clientName || 'customer'}${Number(event.total || 0) > 0 ? ` - ${formatMoney(event.total)}` : ''}`;
}

export function Dashboard() {
  const [recentActivity, setRecentActivity] = useState<Activity[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [quickActions, setQuickActions] =
    useState<QuickActionPreference[]>(defaultQuickActions);
  const [draftActions, setDraftActions] = useState<
    QuickActionPreference[] | null
  >(null);
  const [loading, setLoading] = useState(true);
  const [activityError, setActivityError] = useState(false);
  const [recommendationError, setRecommendationError] = useState(false);
  const [preferencesError, setPreferencesError] = useState(false);
  const [setupPrompt, setSetupPrompt] = useState(false);
  const [applyingRecommendation, setApplyingRecommendation] = useState('');
  const [savingActions, setSavingActions] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const request = useRef(0);
  const actionLock = useRef(false);
  const saveLock = useRef(false);

  const visibleQuickActions = useMemo(
    () =>
      quickActions
        .filter((entry) => entry.visible && catalogById.has(entry.id))
        .map((entry) => catalogById.get(entry.id)!),
    [quickActions],
  );
  useEffect(() => {
    const controller = new AbortController();
    const generation = ++request.current;
    setLoading(true);
    const options = { signal: controller.signal };
    Promise.allSettled([
      apiJson<{ data: Activity[] }>('/v1/activities/feed?limit=5', options),
      apiJson<{ data: Recommendation[] }>(
        '/v1/dashboard/recommendations',
        options,
      ),
      apiJson<{ data: { actions: QuickActionPreference[] } }>(
        '/v1/settings/dashboard-actions',
        options,
      ),
      apiJson<{ data: { onboardingCompletedAt?: string | null } }>(
        '/v1/settings/org',
        options,
      ),
    ]).then(([activity, suggestions, preferences, org]) => {
      if (controller.signal.aborted || generation !== request.current) return;
      setActivityError(activity.status === 'rejected');
      setRecommendationError(suggestions.status === 'rejected');
      setPreferencesError(preferences.status === 'rejected');
      if (activity.status === 'fulfilled')
        setRecentActivity(activity.value.data || []);
      if (suggestions.status === 'fulfilled')
        setRecommendations(suggestions.value.data || []);
      if (preferences.status === 'fulfilled')
        setQuickActions(mergePreferences(preferences.value.data.actions));
      if (org.status === 'fulfilled')
        setSetupPrompt(!org.value.data.onboardingCompletedAt);
      setLoading(false);
    });
    return () => controller.abort();
  }, [refresh]);
  const refreshDashboard = () => setRefresh((value) => value + 1);

  async function saveQuickActionPreferences() {
    if (!draftActions || saveLock.current) return;
    saveLock.current = true;
    setSavingActions(true);
    try {
      await apiJson('/v1/settings/dashboard-actions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actions: draftActions }),
      });
      setQuickActions(draftActions);
      setDraftActions(null);
      window.showToast?.('Quick actions updated', 'success');
    } catch (error) {
      window.showToast?.(
        error instanceof Error
          ? error.message
          : 'Quick actions could not be saved',
        'error',
      );
    } finally {
      saveLock.current = false;
      setSavingActions(false);
    }
  }
  async function applyRecommendation(item: Recommendation) {
    if (!item.primaryAction || actionLock.current) return;
    actionLock.current = true;
    setApplyingRecommendation(item.id);
    try {
      await apiJson(item.primaryAction.path, {
        method: item.primaryAction.method || 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify(item.primaryAction.body || {}),
      });
      setRecommendations((current) =>
        current.filter((recommendation) => recommendation.id !== item.id),
      );
      window.showToast?.(
        item.primaryAction.successMessage || 'Action completed',
        'success',
      );
      refreshDashboard();
    } catch (error) {
      window.showToast?.(
        error instanceof Error
          ? error.message
          : 'Action could not be completed',
        'error',
      );
    } finally {
      actionLock.current = false;
      setApplyingRecommendation('');
    }
  }
  function moveQuickAction(id: string, direction: -1 | 1) {
    setDraftActions((current) => {
      if (!current) return current;
      const index = current.findIndex((entry) => entry.id === id),
        nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length)
        return current;
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  }

  const recommendationActions = (item: Recommendation) => (
    <div className="dashboard-row-actions">
      {item.primaryAction && (
        <Button
          variant="secondary"
          size="sm"
          disabled={Boolean(applyingRecommendation)}
          isLoading={applyingRecommendation === item.id}
          onClick={() => applyRecommendation(item)}
        >
          {item.primaryAction.label}
        </Button>
      )}
      {(item.secondaryAction?.href || item.href) && (
        <Link
          to={item.secondaryAction?.href || item.href!}
          className="btn-text btn-sm"
        >
          {item.secondaryAction?.label || 'Review'}
        </Link>
      )}
    </div>
  );
  const recommendationRows = (
    <>
      {recommendationError && (
        <p className="pf-helper dashboard-quiet" role="status">
          Suggestions could not be refreshed.{' '}
          <button
            type="button"
            className="btn-text btn-sm"
            onClick={refreshDashboard}
          >
            Retry suggestions
          </button>
        </p>
      )}
      {recommendations.length > 0 && (
        <div className="dashboard-recommendations">
          <h3 className="pf-row-title">Suggested next steps</h3>
          {recommendations.slice(0, 3).map((item) => (
            <article className="dashboard-recommendation" key={item.id}>
              <Icon
                name={
                  item.type === 'job_in_production' ? 'briefcase' : 'message'
                }
                className="pf-icon"
              />
              <div className="dashboard-row-content">
                <p className="pf-row-title">{item.title}</p>
                <p className="pf-helper">{item.body}</p>
                {recommendationActions(item)}
              </div>
            </article>
          ))}
          {recommendations.length > 3 && (
            <details className="dashboard-more">
              <summary className="btn-text btn-sm">
                {recommendations.length - 3} more{' '}
                {recommendations.length === 4 ? 'suggestion' : 'suggestions'}
              </summary>
              {recommendations.slice(3).map((item) => (
                <article className="dashboard-recommendation" key={item.id}>
                  <div className="dashboard-row-content">
                    <p className="pf-row-title">{item.title}</p>
                    <p className="pf-helper">{item.body}</p>
                    {recommendationActions(item)}
                  </div>
                </article>
              ))}
            </details>
          )}
        </div>
      )}
    </>
  );

  return (
    <div className="dashboard-home">
      <header className="dashboard-home-heading">
        <div>
          <p className="pf-meta">
            {new Date().toLocaleDateString(undefined, {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
            })}
          </p>
          <h1 className="pf-section-title">Your workday</h1>
        </div>
        <button
          type="button"
          className="btn-icon"
          aria-label="Refresh dashboard"
          title="Refresh dashboard"
          disabled={loading}
          onClick={refreshDashboard}
        >
          <Icon name="refresh" className="pf-icon" />
        </button>
      </header>
      <nav className="dashboard-shortcuts" aria-label="Quick actions">
        <div className="dashboard-shortcut-grid">
          {visibleQuickActions.slice(0, 4).map((action, index) => (
            <Link
              key={action.id}
              to={action.href}
              className={`${index === 0 ? 'btn-primary' : 'btn-secondary'} btn-sm`}
            >
              <Icon name={action.icon} className="pf-icon" />
              {action.label}
            </Link>
          ))}
        </div>
        <div className="dashboard-shortcut-footer">
          {visibleQuickActions.length > 4 && (
            <details className="dashboard-more">
              <summary className="btn-text btn-sm">
                More actions
                <Icon name="chevron-down" className="pf-icon" />
              </summary>
              <div className="dashboard-extra-actions">
                {visibleQuickActions.slice(4).map((action) => (
                  <Link
                    key={action.id}
                    to={action.href}
                    className="btn-text btn-sm"
                  >
                    <Icon name={action.icon} className="pf-icon" />
                    {action.label}
                  </Link>
                ))}
              </div>
            </details>
          )}
          {visibleQuickActions.length === 0 && (
            <span className="pf-helper">Choose your daily shortcuts.</span>
          )}
          <button
            type="button"
            className="btn-text btn-sm"
            disabled={loading || preferencesError}
            onClick={() =>
              setDraftActions(quickActions.map((entry) => ({ ...entry })))
            }
          >
            <Icon name="edit" className="pf-icon" />
            Customize
          </button>
        </div>
        {preferencesError && (
          <p className="pf-helper" role="status">
            Saved shortcuts could not be loaded.{' '}
            <button
              type="button"
              className="btn-text btn-sm"
              onClick={refreshDashboard}
            >
              Retry
            </button>
          </p>
        )}
      </nav>
      {setupPrompt && (
        <section className="dashboard-setup">
          <Icon name="settings" className="pf-icon" />
          <div className="dashboard-row-content">
            <p className="pf-row-title">Finish business setup</p>
            <p className="pf-helper">
              Rates, branding, service areas, and payments.
            </p>
          </div>
          <Link to="/onboarding" className="btn-text btn-sm">
            Continue setup
          </Link>
        </section>
      )}
      <DashboardDaily
        refreshKey={refresh}
        recommendations={recommendationRows}
      />
      <DashboardInsights refreshKey={refresh} />
      <section
        className="dashboard-section dashboard-recent"
        aria-labelledby="recent-activity-title"
      >
        <header className="dashboard-section-heading">
          <h2 id="recent-activity-title" className="pf-section-title">
            Recent activity
          </h2>
          <Link to="/activity" className="btn-text btn-sm">
            View all
          </Link>
        </header>
        {activityError && (
          <p className="pf-helper" role="status">
            Activity could not be refreshed.
            {recentActivity.length ? ' Showing previous results.' : ''}{' '}
            <button
              type="button"
              className="btn-text btn-sm"
              onClick={refreshDashboard}
            >
              Retry activity
            </button>
          </p>
        )}
        {loading && !recentActivity.length ? (
          <div
            className="dashboard-daily-skeleton animate-pulse"
            aria-label="Loading activity"
            role="status"
          />
        ) : !activityError && !recentActivity.length ? (
          <p className="dashboard-quiet pf-helper">
            Your team's updates will appear here.
          </p>
        ) : (
          <ActivityTimeline
            items={recentActivity.map((activity, index) => ({
              id: `${activity.id}-${activity.occurredAt || activity.createdAt || index}`,
              title: activityText(activity),
              meta: relativeDate(
                activity.occurredAt ||
                  activity.activityAt ||
                  activity.sentAt ||
                  activity.createdAt,
              ),
              description: [activity.clientName, activity.leadStreetAddress]
                .filter(Boolean)
                .join(' · '),
              href: activity.href || `/estimates/${activity.id}`,
              tone:
                activity.status === 'accepted'
                  ? 'success'
                  : activity.status === 'declined'
                    ? 'danger'
                    : 'default',
              accessory: (
                <StatusBadge
                  status={String(
                    activity.status || activity.source || 'activity',
                  )}
                />
              ),
            }))}
          />
        )}
      </section>
      <footer className="dashboard-home-footer">
        <Link to="/reports" className="btn-text btn-sm">
          <Icon name="bar-chart" className="pf-icon" />
          View reports
        </Link>
        <Link to="/settings" className="btn-text btn-sm">
          <Icon name="settings" className="pf-icon" />
          Open settings
        </Link>
        {import.meta.env.DEV && (
          <Link to="/dev/design-system" className="btn-text btn-sm">
            Design system
          </Link>
        )}
      </footer>
      <Modal
        isOpen={draftActions !== null}
        onClose={() => {
          if (!savingActions) setDraftActions(null);
        }}
        title="Customize quick actions"
        description="Choose shortcuts and order the actions your team uses most."
        size="lg"
      >
        <div className="dashboard-action-editor">
          {draftActions?.map((entry, index) => {
            const action = catalogById.get(entry.id)!;
            return (
              <div className="dashboard-edit-row" key={entry.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={entry.visible}
                    disabled={savingActions}
                    onChange={(event) =>
                      setDraftActions(
                        (current) =>
                          current?.map((item) =>
                            item.id === entry.id
                              ? { ...item, visible: event.target.checked }
                              : item,
                          ) || null,
                      )
                    }
                  />
                  <Icon name={action.icon} className="pf-icon" />
                  <span className="pf-copy">{action.label}</span>
                </label>
                <button
                  type="button"
                  className="btn-icon"
                  aria-label={`Move ${action.label} up`}
                  title="Move up"
                  disabled={savingActions || index === 0}
                  onClick={() => moveQuickAction(entry.id, -1)}
                >
                  <Icon name="arrow-up" className="pf-icon" />
                </button>
                <button
                  type="button"
                  className="btn-icon"
                  aria-label={`Move ${action.label} down`}
                  title="Move down"
                  disabled={
                    savingActions || index === (draftActions?.length || 0) - 1
                  }
                  onClick={() => moveQuickAction(entry.id, 1)}
                >
                  <Icon name="arrow-down" className="pf-icon" />
                </button>
              </div>
            );
          })}
        </div>
        <ModalFooter>
          <Button
            variant="ghost"
            disabled={savingActions}
            onClick={() => setDraftActions(defaultQuickActions())}
          >
            Reset defaults
          </Button>
          <Button
            variant="ghost"
            disabled={savingActions}
            onClick={() => setDraftActions(null)}
          >
            Cancel
          </Button>
          <Button
            isLoading={savingActions}
            onClick={saveQuickActionPreferences}
          >
            Save actions
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
