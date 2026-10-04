import { test, expect, type Page, type Route } from '@playwright/test';

// Browser-only regression evidence. API/Stripe transport is mocked; these tests do
// not prove provider settlement, database atomicity or durable checkout reservations.
const publicToken = 'synthetic-public-token';
const invoice = {
  id: 'invoice-one', invoiceNumber: 'INV-1042', description: 'Exterior deposit', total: '100.00',
  status: 'due', balanceDue: '40.00', paidAmount: '60.00', creditedAmount: '0.00', payable: true,
  balance: { total: '100.00', remaining: '40.00', allocated: '60.00', credits: '0.00', netCollected: '60.00',
    closed: false, needsReview: false, pendingRefunds: 0 },
};
const initial = {
  customer: { name: 'Synthetic Customer', email: 'customer@example.test' },
  estimate: { id: 'estimate-one', title: 'Exterior repaint', status: 'accepted', total: '1000.00', signedAt: '2026-09-30T12:00:00Z' },
  job: { id: 'job-one', jobNumber: 'JOB-1042', name: 'Exterior repaint', streetAddress: '142 Cedar Street', status: 'scheduled' },
  changeOrders: [], invoices: [invoice],
};

async function reply(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function fixtures(page: Page, data: unknown = initial) {
  await page.addInitScript(() => {
    // Avoid relying on a nonexistent API/CORS preflight in this presentation suite.
    // All /v1/ requests are intercepted below; no session or tenant-header bypass is used.
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const target = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.origin);
      if (target.pathname.startsWith('/v1/')) return originalFetch(`${target.pathname}${target.search}`, init);
      return originalFetch(input, init);
    };
  });
  await page.route('**/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === `/v1/portal/${publicToken}`) return reply(route, { data });
    return reply(route, { error: 'Unconfigured synthetic transport' }, 404);
  });
  // Mock the external checkout document too. No network request reaches Stripe.
  await page.route('https://checkout.stripe.com/**', (route) => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><html><body><h1>Synthetic secure checkout</h1><p>No payment is submitted.</p></body></html>',
  }));
  await page.goto(`/portal/${publicToken}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('INV-1042', { exact: true })).toBeVisible();
}

test.describe('customer portal checkout (browser-only, mocked transport)', () => {
  test.setTimeout(60_000);
  test('abandon checkout using browser Back: pay is enabled again and invoice remains due', async ({ page }) => {
    await fixtures(page);
    let attempts = 0;
    await page.route(`**/v1/portal/${publicToken}/invoices/${invoice.id}/checkout`, async (route) => {
      attempts++;
      expect(route.request().headers()['idempotency-key']).toBeTruthy();
      await reply(route, { data: { checkoutUrl: 'https://checkout.stripe.com/c/pay/synthetic', amountDue: '40.00' } });
    });
    const pay = page.getByRole('button', { name: 'Pay $40.00', exact: true });
    await pay.click();
    await expect(page.getByRole('heading', { name: 'Synthetic secure checkout' })).toBeVisible();
    await page.goBack();
    await expect(pay).toBeEnabled();
    await expect(page.getByText('Due', { exact: true })).toBeVisible();
    await expect(page.getByText('Payment received. Thank you.', { exact: true })).toHaveCount(0);
    expect(attempts).toBe(1);
    await pay.click();
    await expect(page.getByRole('heading', { name: 'Synthetic secure checkout' })).toBeVisible();
    expect(attempts).toBe(2);
  });

  test('focus/pageshow while checkout request is in flight cannot unlock duplicate clicks; failure resets busy state', async ({ page }) => {
    await fixtures(page);
    let attempts = 0;
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    await page.route(`**/v1/portal/${publicToken}/invoices/${invoice.id}/checkout`, async (route) => {
      attempts++;
      await held;
      await reply(route, { error: 'Payment balance could not be verified. Try again later.' }, 503);
    });
    const pay = page.getByRole('button', { name: 'Pay $40.00', exact: true });
    await pay.click();
    await expect(pay).toBeDisabled();
    await expect(pay).toHaveAttribute('aria-busy', 'true');
    await page.evaluate(() => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('pageshow'));
    });
    await expect(pay).toBeDisabled();
    await pay.dispatchEvent('click');
    release();
    await expect(pay).toBeEnabled();
    await expect(page.getByRole('alert')).toContainText('Payment balance could not be verified');
    expect(attempts).toBe(1);
    await expect(page.getByText('Due', { exact: true })).toBeVisible();
  });

  test('return/cancel query flags never manufacture a paid or processing status', async ({ page }) => {
    await fixtures(page);
    await page.goto(`/portal/${publicToken}?invoiceId=${invoice.id}&invoicePaid=${invoice.id}`);
    await expect(page.getByRole('button', { name: 'Pay $40.00', exact: true })).toBeEnabled();
    await expect(page.getByText('Due', { exact: true })).toBeVisible();
    await page.goto(`/portal/${publicToken}?invoiceId=${invoice.id}&invoicePaymentCanceled=${invoice.id}`);
    await expect(page.getByRole('button', { name: 'Pay $40.00', exact: true })).toBeEnabled();
    await expect(page.getByRole('status').filter({ hasText: 'Checkout closed' })).toBeVisible();
    await expect(page.getByText('Payment received. Thank you.', { exact: true })).toHaveCount(0);
  });

  test('provider processing disables payment without hiding signed documents', async ({ page }) => {
    await fixtures(page, { ...initial, invoices: [{ ...invoice, payable: false, processing: true, status: 'processing',
      paymentUnavailableReason: 'Your submitted payment is processing. Please do not pay again.' }] });
    await expect(page.getByRole('button', { name: /^Pay \$/ })).toHaveCount(0);
    await expect(page.getByText('Your submitted payment is processing. Please do not pay again.', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'View signed copy' })).toBeVisible();
  });

  test('unknown legacy refund requires review, while a credit refund never reopens payment', async ({ page }) => {
    await fixtures(page, { ...initial, invoices: [{ ...invoice, payable: false, needsReview: true, balanceDue: null, status: 'needs_review',
      paymentUnavailableReason: 'Your contractor needs to review this payment balance.' }] });
    await expect(page.getByText('Under review', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Pay \$/ })).toHaveCount(0);
    await page.route(`**/v1/portal/${publicToken}`, (route) => reply(route, { data: { ...initial, invoices: [{ ...invoice,
      payable: false, balanceDue: '0.00', creditedAmount: '25.00', paidAmount: '75.00', status: 'partially_refunded' }] } }));
    await page.reload();
    await expect(page.getByText('$25.00 credited', { exact: true })).toBeVisible();
    await expect(page.getByText('This invoice was adjusted. No further payment is due.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Pay \$/ })).toHaveCount(0);
  });

  test('change orders link to their invoice; unsupported legacy changes do not expose an independent pay action', async ({ page }) => {
    const change = { id: 'change-one', description: 'Added porch', amount: '100.00', status: 'approved', paymentRequired: true,
      paymentStatus: 'pending', customerSignedAt: '2026-09-30T12:00:00Z', customerSignatureName: 'Synthetic Customer' };
    await fixtures(page, { ...initial, invoices: [{ ...invoice, changeOrderId: change.id }], changeOrders: [change,
      { ...change, id: 'legacy-change', description: 'Legacy extra work' }] });
    const view = page.getByRole('link', { name: 'View payment invoice' });
    await expect(view).toHaveAttribute('href', `#invoice-${invoice.id}`);
    await view.click();
    await expect(page).toHaveURL(new RegExp(`#invoice-${invoice.id}$`));
    await expect(page.getByText('Ask your contractor to issue the payment invoice for this change order.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Pay \$/ })).toHaveCount(1);
  });

  test('phone layout fits 360px, has reachable payment action and no contractor navigation', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await fixtures(page);
    const pay = page.getByRole('button', { name: 'Pay $40.00', exact: true });
    await pay.scrollIntoViewIfNeeded();
    const bounds = await pay.boundingBox();
    expect(bounds?.height).toBeGreaterThanOrEqual(48);
    expect(bounds?.width).toBeGreaterThanOrEqual(48);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    await expect(page.getByRole('navigation')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('portal-mobile.png'), fullPage: true });
  });
});
