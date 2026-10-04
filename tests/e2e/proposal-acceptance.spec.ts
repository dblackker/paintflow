import { expect, test, type Route } from '@playwright/test';

test.use({ serviceWorkers: 'block' });
async function reply(route: Route, data: unknown) {
  await route.fulfill({ contentType: 'application/json', body: JSON.stringify(data), headers: {
    'access-control-allow-origin': route.request().headers().origin || 'http://localhost:5173',
    'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'Content-Type, Idempotency-Key',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
  } });
}

test('lost acceptance response retries the same operation and retains selected signed scope', async ({ page }) => {
  const id = '324e947d-2433-4d17-86ea-a841d7080d15';
  const keys: string[] = [];
  const bodies: string[] = [];
  const pkg = { name: 'proposal', subtotal: 100, discount: 0, tax: 9.2, total: 109.2, taxRate: '0.092', calculationVersion: 'repaint-v2', items: [
    { desc: 'Bedroom: Walls', qty: 1, rate: 100, calculationItemId: 'walls', labor: { coats: 2 }, material: { name: 'Finish' } },
    { desc: 'Bedroom: Trim', qty: 1, rate: 20, calculationItemId: 'trim', optional: true, labor: { coats: 2 }, material: { name: 'Trim enamel' } },
  ] };
  await page.route('**/v1/**', async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return reply(route, {});
    if (new URL(request.url()).pathname.endsWith('/sign')) {
      keys.push(request.headers()['idempotency-key']); bodies.push(request.postData()!);
      if (keys.length === 1) return route.abort('failed');
      return reply(route, { data: { id, status: 'accepted', signedAt: '2026-10-04T15:00:00Z', replayed: true, portalUrl: 'https://example.invalid/portal/synthetic' } });
    }
    return reply(route, { data: { id, status: 'sent', updatedAt: '2026-10-04T12:00:00Z', termsVersion: 'a'.repeat(64), packages: [pkg], total: '109.20',
      contractorSignature: { name: 'Synthetic owner', companyName: 'Synthetic company', signedAt: '2026-10-04T12:00:00Z' },
      legal: { contractTerms: 'Synthetic agreed scope and payment terms.' }, paymentSchedule: [] } });
  });
  await page.goto(`/estimates/${id}`);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: /Approve and sign/ }).click();
  await page.getByRole('button', { name: 'I agree', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Sign Proposal', exact: true });
  await dialog.getByLabel('Full name', { exact: true }).fill('Synthetic client');
  const canvas = dialog.locator('canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Signature canvas missing');
  await page.mouse.move(box.x + 15, box.y + 25);
  await page.mouse.down();
  await page.mouse.move(box.x + 90, box.y + 65, { steps: 6 });
  await page.mouse.up();
  const sign = dialog.getByRole('button', { name: 'Sign proposal', exact: true });
  await sign.click();
  await expect.poll(() => keys.length).toBe(1);
  await expect(sign).toBeEnabled();
  await sign.click();
  await expect(dialog).not.toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
  expect(bodies[1]).toBe(bodies[0]);
  const submitted = JSON.parse(bodies[0]);
  expect(submitted.expectedTermsVersion).toBe('a'.repeat(64));
  expect(submitted.selectedOptions[0]).toMatchObject({ calculationItemId: 'trim', optionIndex: 0 });
  await expect(page.getByText('Trim enamel', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('Optional Add-ons', { exact: true })).not.toBeVisible();
  await expect(page.getByText('$131.04', { exact: true }).first()).toBeVisible();
});
