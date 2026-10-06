import { expect, test, type Page, type Route } from '@playwright/test';
import { dashboardInsights, dashboardRange, type DashboardWeeks } from '../../packages/core/src/dashboard-insights';

test.use({ serviceWorkers: 'block' });
const asOf = new Date('2026-10-04T19:00:00Z');
const insight = (weeks: DashboardWeeks = 8, empty = false) => {
  const range = dashboardRange(weeks, 'America/Los_Angeles', asOf);
  const counts = Array.from({ length: weeks }, (_, index) => empty ? 0 : index === weeks - 1 ? 4 : index % 4);
  if (!empty) counts[0] += 20 - counts.reduce((sum, value) => sum + value, 0);
  return dashboardInsights(range, {
    leads: empty ? 0 : 20, estimated: empty ? 0 : 12, sent: empty ? 0 : 10, won: empty ? 0 : 6, lost: empty ? 0 : 4,
    depositPending: 2, needsScheduling: 3, scheduled: 8, inProduction: 4, punchList: 1, completed: 5,
    weeklyLeads: Array.from({ length: weeks }, (_, index) => ({ weekStart: new Date(new Date(`${range.startDate}T12:00:00Z`).getTime() + index * 7 * 86400000).toISOString().slice(0, 10), count: counts[index] })),
  });
};
async function reply(route: Route, data: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data), headers: {
    'access-control-allow-origin': route.request().headers().origin || 'http://localhost:5173',
    'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'Authorization, Content-Type, Idempotency-Key',
    'access-control-allow-methods': 'GET, OPTIONS',
  } });
}
async function fixture(page: Page) {
  const state = { empty: false, failInsights: false, failOptional: false, beforeInsights: null as null | (() => Promise<void>), queries: [] as string[], jobQueries: [] as string[] };
  await page.addInitScript(() => localStorage.setItem('crewmodo.sessionToken', 'synthetic-dashboard'));
  await page.route('**/v1/**', async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'OPTIONS') return reply(route, {});
    if (url.pathname === '/v1/auth/session') return reply(route, { data: { orgId: 'synthetic-org', userId: 'synthetic-owner', role: 'owner' } });
    if (url.pathname === '/v1/dashboard/insights') {
      state.queries.push(url.search);
      await state.beforeInsights?.();
      if (state.failInsights) return reply(route, { error: 'Synthetic service outage' }, 503);
      return reply(route, { data: insight(Number(url.searchParams.get('weeks')) as DashboardWeeks, state.empty) });
    }
    if (url.pathname === '/v1/dashboard/stats') return reply(route, { data: { activeLeads: state.empty ? 0 : 14, estimatesSent: 10, jobsThisMonth: 6 } });
    if (url.pathname === '/v1/dashboard/overview') return reply(route, { data: { date: '2026-10-04', timeZone: 'America/Los_Angeles', totalCustomers: state.empty ? 0 : 20, newLeads: 2, awaitingApproval: 10, overdueTasks: 0, dueToday: 0, todayJobCount: 0, todayJobs: [], tasks: [] } });
    if (url.pathname === '/v1/dashboard/collections') return reply(route, { data: { invoiceCount: 2, outstanding: '800.00', overdueCount: 0, overdue: '0.00', reviewCount: 0 } });
    if (url.pathname === '/v1/dashboard/recommendations' || url.pathname === '/v1/activities/feed' || url.pathname === '/v1/settings/dashboard-actions') {
      if (state.failOptional) return reply(route, { error: 'Synthetic optional service outage' }, 503);
      return reply(route, { data: url.pathname.endsWith('dashboard-actions') ? { actions: [] } : [] });
    }
    if (url.pathname === '/v1/settings/org') return reply(route, { data: { onboardingCompletedAt: asOf.toISOString(), companyName: 'Synthetic contractor' } });
    if (url.pathname === '/v1/jobs') { state.jobQueries.push(url.search); return reply(route, { data: [], nextCursor: null }); }
    return reply(route, { data: [] });
  });
  return state;
}

for (const width of [360, 390, 768, 1440]) test(`weekly leads and funnel are readable without overflow at ${width}px`, async ({ page }, info) => {
  await fixture(page);
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Leads per week' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sales funnel' })).toBeVisible();
  await expect(page.getByText('30%', { exact: true })).toBeVisible();
  const chart = page.getByRole('list', { name: 'Weekly new leads' });
  await expect(chart.getByRole('listitem')).toHaveCount(8);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const selector = page.getByRole('combobox', { name: 'Insights period' });
  expect((await selector.boundingBox())!.height).toBeGreaterThanOrEqual(48);
  await selector.selectOption('12');
  await expect(chart.getByRole('listitem')).toHaveCount(12);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByText("How it's counted", { exact: true }).click();
  await expect(page.getByText(/Won means an accepted, non-voided estimate/)).toBeVisible();
  await page.getByText("How it's counted", { exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `/tmp/crewmodo-dashboard-${info.project.name}-${width}.png`, fullPage: true });
});

test('insights outage and optional dashboard services do not block normal actions; retry recovers', async ({ page }) => {
  const state = await fixture(page);
  state.failInsights = true;
  state.failOptional = true;
  await page.goto('/dashboard');
  await expect(page.getByRole('button', { name: 'Retry insights' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Add lead', exact: true }).first()).toBeVisible();
  await expect(page.getByText('Dashboard data is unavailable')).toHaveCount(0);
  state.failInsights = false;
  await page.getByRole('button', { name: 'Retry insights' }).click();
  await expect(page.getByRole('heading', { name: 'Sales funnel' })).toBeVisible();
});

test('period changes keep the chart in place, suppress stale results, and disclose failed refreshes', async ({ page }) => {
  const state = await fixture(page);
  await page.goto('/dashboard');
  const chart = page.getByRole('list', { name: 'Weekly new leads' });
  await expect(chart.getByRole('listitem')).toHaveCount(8);
  let release!: () => void;
  state.beforeInsights = () => new Promise<void>((resolve) => { release = resolve; });
  await page.getByLabel('Insights period').selectOption('4');
  await expect(page.getByText('Updating insights...')).toBeVisible();
  await expect(chart.getByRole('listitem')).toHaveCount(8);
  state.beforeInsights = null;
  release();
  await expect(chart.getByRole('listitem')).toHaveCount(4);
  state.failInsights = true;
  await page.getByLabel('Insights period').selectOption('12');
  await expect(page.getByText(/Showing the last loaded results/)).toBeVisible();
  await expect(chart.getByRole('listitem')).toHaveCount(4);
});

test('empty lead cohorts do not present misleading conversion percentages', async ({ page }) => {
  const state = await fixture(page); state.empty = true;
  await page.goto('/dashboard');
  await expect(page.getByText('No new leads in this period.')).toBeVisible();
  await expect(page.getByText('Not yet', { exact: true })).toBeVisible();
  await expect(page.getByText('NaN%')).toHaveCount(0);
});

test('operations links drill into actual server-filtered jobs and allow clearing the filter', async ({ page }) => {
  const state = await fixture(page);
  await page.goto('/dashboard');
  await page.getByRole('link', { name: /In production/ }).click();
  await expect(page).toHaveURL(/\/jobs\?status=in_progress/);
  await expect(page.getByLabel('Job status')).toHaveValue('in_progress');
  await expect.poll(() => state.jobQueries.some((query) => query.includes('status=in_progress'))).toBe(true);
  await page.getByLabel('Job status').selectOption('');
  await expect.poll(() => state.jobQueries.includes('')).toBe(true);
  await expect(page).toHaveURL(/\/jobs$/);
});
