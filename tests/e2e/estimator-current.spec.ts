import { expect, test, type Route } from '@playwright/test';
import { calculateProductionPreview } from '../../packages/core/src/estimation-production';

test.use({ serviceWorkers: 'block' });

async function reply(route: Route, data: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data), headers: {
    'access-control-allow-origin': route.request().headers().origin || 'http://localhost:5173',
    'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'Authorization, Content-Type, Idempotency-Key',
    'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS',
  } });
}

test('quick draft preserves a failed save key and blocks email until changed tax is reviewed', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const lead = { id: 'synthetic-customer', name: 'Devon Client', streetAddress: '142 Cedar Street' };
  const settings = { defaultLaborRate: '65', materialMarkupPercent: '30', salesTaxRate: '0', depositPercent: '10' };
  const keys: string[] = [];
  let emailCalls = 0;
  await page.addInitScript(() => localStorage.setItem('crewmodo.sessionToken', 'synthetic-session'));
  await page.route('**/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (method === 'OPTIONS') return reply(route, {});
    if (path === '/v1/leads') return reply(route, { data: [lead] });
    if (path === '/v1/settings/org') return reply(route, { data: settings });
    if (path.endsWith('/send-email')) { emailCalls++; return reply(route, { data: {} }); }
    if (path === '/v1/production-rates/calculate') {
      const result = calculateProductionPreview(route.request().postDataJSON(), { rates: [], materials: [], settings: { ...settings, salesTaxRate: '0.092' } });
      return reply(route, { data: result });
    }
    if (path === '/v1/estimates' && method === 'POST') {
      keys.push(route.request().headers()['idempotency-key']);
      const body = route.request().postDataJSON();
      expect(body.leadId).toBe(lead.id);
      expect(body.status).toBe('draft');
      expect(body.packages[0].calculationVersion).toBe('repaint-v1');
      if (keys.length === 1) return reply(route, { error: 'Save unavailable. Retry your draft.' }, 503);
      return reply(route, { data: { id: 'synthetic-estimate', updatedAt: '2026-10-03T12:00:00Z', status: 'draft', packages: body.packages } }, 201);
    }
    if (path === '/v1/estimates/synthetic-estimate') return reply(route, { data: { id: 'synthetic-estimate', status: 'draft', leadId: lead.id, packages: [] } });
    return reply(route, { data: [] });
  });
  await page.goto(`/estimates/new?leadId=${lead.id}`);
  await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeVisible({ timeout: 40_000 });
  await expect(page.getByLabel('Customer', { exact: true })).toHaveValue(lead.id);
  const quantity = page.getByLabel('Quantity', { exact: true }).first();
  await expect(quantity).toHaveAttribute('inputmode', 'decimal');
  await expect(quantity).toHaveAttribute('step', '0.25');
  await quantity.fill('0.25');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Pricing changed');
  expect(keys).toHaveLength(0);
  await expect(page.getByText('Tax (9.2%)', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Save unavailable');
  await expect(quantity).toHaveValue('0.25');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(overflow).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('quick-estimate-retry.png'), fullPage: true });
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page).toHaveURL(/\/estimates\/synthetic-estimate\/details$/);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBeTruthy();
  expect(keys[1]).toBe(keys[0]);
  expect(emailCalls).toBe(0);
});
