import { expect, test, type Page, type Route } from '@playwright/test';
import {
  dashboardInsights,
  dashboardRange,
} from '../../packages/core/src/dashboard-insights';

test.use({ serviceWorkers: 'block' });
const overview = {
  date: '2026-10-06',
  timeZone: 'America/Los_Angeles',
  totalCustomers: 20,
  newLeads: 2,
  awaitingApproval: 5,
  overdueTasks: 1,
  dueToday: 1,
  todayJobCount: 5,
  todayJobs: [
    {
      id: 'job-1',
      name: 'Interior repaint',
      status: 'in_progress',
      customerName: 'Alex Rivera',
      streetAddress: '123 Jobsite Avenue',
      city: 'Tacoma',
      state: 'WA',
    },
  ],
  tasks: [
    {
      id: 'task-1',
      title: 'Call Alex about the start date',
      customerName: 'Alex Rivera',
      dueAt: '2026-10-05T20:00:00Z',
      overdue: true,
      href: '/leads/alex#customer-activity',
    },
  ],
};
async function reply(route: Route, data: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(data),
    headers: {
      'access-control-allow-origin':
        route.request().headers().origin || 'http://localhost:5173',
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers':
        'Authorization, Content-Type, Idempotency-Key',
      'access-control-allow-methods': 'GET, OPTIONS, PUT, POST, PATCH',
    },
  });
}
async function fixture(page: Page) {
  const state = {
    fail: false,
    denied: false,
    saving: null as null | (() => Promise<void>),
    saves: [] as Array<{ id: string; visible: boolean }[]>,
    recommendations: [] as Array<{
      id: string;
      type: string;
      title: string;
      body: string;
      href: string;
    }>,
  };
  await page.addInitScript(() =>
    localStorage.setItem('crewmodo.sessionToken', 'synthetic-owner'),
  );
  await page.route('**/v1/**', async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'OPTIONS') return reply(route, {});
    if (url.pathname === '/v1/auth/session')
      return reply(route, {
        data: {
          orgId: 'synthetic-org',
          userId: 'synthetic-owner',
          role: 'owner',
        },
      });
    if (url.pathname === '/v1/dashboard/overview')
      return reply(
        route,
        state.fail ? { error: 'Synthetic outage' } : { data: overview },
        state.fail ? 503 : 200,
      );
    if (url.pathname === '/v1/dashboard/collections')
      return reply(
        route,
        state.denied
          ? { error: 'Permission required' }
          : {
              data: {
                invoiceCount: 3,
                outstanding: '2500.00',
                overdueCount: 1,
                overdue: '500.00',
                reviewCount: 1,
              },
            },
        state.denied ? 403 : 200,
      );
    if (url.pathname === '/v1/dashboard/insights') {
      const range = dashboardRange(
        Number(url.searchParams.get('weeks')) as 4 | 8 | 12,
        'America/Los_Angeles',
        new Date('2026-10-06T19:00:00Z'),
      );
      return reply(route, {
        data: dashboardInsights(range, {
          leads: 0,
          estimated: 0,
          sent: 0,
          won: 0,
          weeklyLeads: Array.from({ length: range.weeks }, (_, index) => ({
            weekStart: new Date(
              new Date(`${range.startDate}T12:00:00Z`).getTime() +
                index * 7 * 86400000,
            )
              .toISOString()
              .slice(0, 10),
            count: 0,
          })),
        }),
      });
    }
    if (url.pathname === '/v1/settings/dashboard-actions') {
      if (route.request().method() === 'PUT') {
        state.saves.push(route.request().postDataJSON().actions);
        await state.saving?.();
        return reply(route, { data: {} });
      }
      return reply(route, { data: { actions: state.saves.at(-1) || [] } });
    }
    if (url.pathname === '/v1/settings/org')
      return reply(route, { data: { onboardingCompletedAt: '2026-10-01' } });
    if (url.pathname === '/v1/dashboard/recommendations')
      return reply(route, { data: state.recommendations });
    if (url.pathname === '/v1/leads/alex')
      return reply(route, {
        data: {
          customer: { id: 'alex', name: 'Alex Rivera', status: 'contacted' },
          estimates: [],
          jobs: [],
          messages: [],
          payments: [],
          activities: [],
        },
      });
    return reply(route, { data: [] });
  });
  return state;
}

for (const width of [360, 390, 768, 1440])
  test(`workday priorities, addresses, and one set of shortcuts fit at ${width}px`, async ({
    page,
  }, info) => {
    await fixture(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/dashboard');
    await expect(
      page.getByRole('heading', { name: "Today's jobs" }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Needs attention' }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: /123 Jobsite Avenue/ }),
    ).toHaveAttribute('href', '/jobs/job-1');
    await expect(
      page.getByRole('link', { name: /Call Alex about/ }),
    ).toHaveAttribute('href', '/leads/alex#customer-activity');
    await expect(page.getByText('$2,500.00', { exact: true })).toBeVisible();
    await expect(page.getByText('$500.00 past due')).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Add lead', exact: true }),
    ).toHaveCount(1);
    await expect(page.getByText('Owner tools', { exact: true })).toHaveCount(0);
    const jobsBox = (await page
      .getByRole('heading', { name: "Today's jobs" })
      .boundingBox())!;
    const performanceBox = (await page
      .getByRole('heading', { name: 'Business performance' })
      .boundingBox())!;
    expect(jobsBox.y).toBeLessThan(performanceBox.y);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    for (const button of await page
      .getByRole('navigation', { name: 'Quick actions' })
      .getByRole('link')
      .all()) {
      if (await button.isVisible()) {
        const label = await button.textContent();
        expect(
          (await button.boundingBox())!.height,
          label || '',
        ).toBeGreaterThanOrEqual(48);
        expect(
          (await button.boundingBox())!.height,
          label || '',
        ).toBeLessThanOrEqual(49);
      }
    }
    await page.getByRole('button', { name: 'Customize', exact: true }).click();
    const dialog = page.getByRole('dialog', {
      name: 'Customize quick actions',
    });
    await expect(dialog).toBeVisible();
    expect(
      await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: `/tmp/crewmodo-owner-dashboard-${info.project.name}-${width}.png`,
      fullPage: true,
    });
    await page.screenshot({
      path: `/tmp/crewmodo-owner-dashboard-${info.project.name}-${width}-viewport.png`,
    });
  });

test('quick-action edits are drafts: cancel restores the saved view; save is single-flight and preserves ordering', async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Customize', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Customize quick actions' });
  await dialog.getByLabel('Add lead', { exact: true }).uncheck();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(
    page.getByRole('link', { name: 'Add lead', exact: true }),
  ).toBeVisible();
  expect(state.saves.length).toBe(0);
  await page.getByRole('button', { name: 'Customize', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Customize quick actions' });
  await expect(dialog.getByLabel('Add lead', { exact: true })).toBeChecked();
  await dialog.getByRole('button', { name: 'Move Create estimate up' }).click();
  await dialog.getByLabel('Add lead', { exact: true }).uncheck();
  let release!: () => void;
  state.saving = () =>
    new Promise<void>((resolve) => {
      release = resolve;
    });
  await dialog.getByRole('button', { name: /Save actions/ }).click();
  await expect(
    dialog.getByRole('button', { name: /Save actions/ }),
  ).toBeDisabled();
  await expect.poll(() => state.saves.length).toBe(1);
  state.saving = null;
  release();
  await expect(dialog).not.toBeVisible();
  expect(state.saves[0][0].id).toBe('create_estimate');
  await expect(
    page.getByRole('link', { name: 'Add lead', exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole('link', { name: 'Create estimate', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Add lead', exact: true }),
  ).toHaveCount(0);
});

test('additional suggestions retain their contextual review action', async ({
  page,
}) => {
  const state = await fixture(page);
  state.recommendations = Array.from({ length: 4 }, (_, index) => ({
    id: `suggestion-${index}`,
    type: 'stale_lead',
    title: `Follow up with customer ${index}`,
    body: 'Review the customer before following up.',
    href: `/leads/customer-${index}`,
  }));
  await page.goto('/dashboard');
  await page.getByText('1 more suggestion', { exact: true }).click();
  const suggestion = page
    .locator('.dashboard-recommendation')
    .filter({ hasText: 'Follow up with customer 3' });
  await expect(
    suggestion.getByRole('link', { name: 'Review', exact: true }),
  ).toBeVisible();
  await expect(
    suggestion.getByRole('link', { name: 'Review', exact: true }),
  ).toHaveAttribute('href', '/leads/customer-3');
});

test('financial access denial hides money; workday service outages retain loaded jobs and leave actions usable', async ({
  page,
}) => {
  const state = await fixture(page);
  state.denied = true;
  await page.goto('/dashboard');
  await expect(
    page.getByRole('link', { name: /123 Jobsite Avenue/ }),
  ).toBeVisible();
  await expect(page.getByText('Open invoices', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Invoice balances could not/)).toHaveCount(0);
  state.fail = true;
  await expect(
    page.getByRole('button', { name: 'Refresh dashboard' }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Refresh dashboard' }).click();
  await expect(
    page.getByText(/Workday could not be refreshed. Showing previous results/),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: /123 Jobsite Avenue/ }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Add lead', exact: true }),
  ).toBeEnabled();
  await page.getByRole('link', { name: /Call Alex about/ }).click();
  await expect(page).toHaveURL(/\/leads\/alex#customer-activity$/);
  await expect(page.locator('#customer-activity')).toBeInViewport();
});
