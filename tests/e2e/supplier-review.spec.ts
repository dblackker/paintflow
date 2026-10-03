import { expect, test, type Page, type Route } from '@playwright/test';

// Network interception must stay in control of the synthetic API, including WebKit.
test.use({ serviceWorkers: 'block' });

const job = { id: 'job-one', jobNumber: 'JOB-1042', name: 'Exterior repaint', streetAddress: '142 Cedar Street', city: 'Seattle', state: 'WA' };
const original = {
  id: 'import-one', status: 'needs_review', supplier: 'Sherwin-Williams', invoiceNumber: 'INV-1042',
  invoiceDate: '2026-09-30T00:00:00.000Z', totalAmount: '130.80', extractionConfidence: '0.92',
  matchCandidates: [{ ...job, confidence: 0.9 }],
  extractedData: { storedInR2: true, fileKey: 'synthetic.pdf', fileName: 'receipt.pdf' },
  extractedItems: [{ description: 'Duration Interior Acrylic', sku: 'A19W553', size: 'GALLON', quantity: 2, gallons: 2, pricePerGallon: 63.95, total: 127.90 }, { description: 'Paint fee', isFee: true, quantity: 2, total: 2.90 }],
  createdAt: '2026-10-01T12:00:00Z',
};
const second = { ...original, id: 'import-two', invoiceNumber: 'INV-1043', extractedData: { ...original.extractedData, fileName: 'second.pdf' } };
const purchase = { id: 'purchase-one', supplier: original.supplier, invoiceNumber: original.invoiceNumber, invoiceDate: original.invoiceDate, totalAmount: original.totalAmount, parsedData: original.extractedItems, fileUrl: '/v1/invoices/imports/import-one/file' };
const pdf = { name: 'receipt.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nSynthetic supplier fixture. Not a real invoice.') };

async function reply(route: Route, data: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', headers: {
    'access-control-allow-origin': route.request().headers().origin || 'http://localhost:5173',
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'Authorization, Content-Type, Idempotency-Key',
  }, body: JSON.stringify(data) });
}

async function fixtures(page: Page, imports: unknown[] = [original, second]) {
  await page.addInitScript(() => {
    localStorage.setItem('crewmodo.sessionToken', 'synthetic-session');
  });
  // Every API call is intercepted: these tests never touch a database, OCR provider or mail service.
  await page.route('**/v1/**', async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'OPTIONS') return reply(route, {});
    if (url.pathname === '/v1/invoices/imports') return reply(route, { data: imports });
    if (url.pathname === '/v1/jobs') return reply(route, { data: [job] });
    if (url.pathname === '/v1/settings/org') return reply(route, { data: {} });
    if (url.pathname === '/v1/settings/payment-schedule') return reply(route, { data: { milestones: [] } });
    if (url.pathname === '/v1/invoices/imports/ai-usage' || url.pathname === '/v1/invoices/inbound-email-config') return reply(route, { data: null });
    if (url.pathname.endsWith('/file')) return route.fulfill({ contentType: 'application/pdf', headers: {
      'access-control-allow-origin': route.request().headers().origin || 'http://localhost:5173',
      'access-control-allow-credentials': 'true',
    }, body: pdf.buffer });
    return reply(route, { data: [] });
  });
  await page.goto('/invoices', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Supplier purchases', exact: true })).toBeVisible({ timeout: 25_000 });
  await page.getByRole('button', { name: 'Supplier purchases', exact: true }).click();
}

async function review(page: Page, id = original.id) {
  await page.getByTestId(`supplier-review-${id}`).getByRole('button', { name: 'Review', exact: true }).click();
  return page.getByRole('dialog', { name: 'Review supplier invoice', exact: true });
}

test.describe('supplier invoice review', () => {
  test.setTimeout(60_000);
  test('requires explicit job selection and remains compact without horizontal overflow', async ({ page }, testInfo) => {
    await page.setViewportSize(testInfo.project.name === 'chromium' ? { width: 1280, height: 900 } : { width: 360, height: 800 });
    await fixtures(page);
    const dialog = await review(page);
    await expect(dialog.getByLabel('Job', { exact: true })).toHaveValue('');
    await expect(dialog.getByRole('button', { name: 'Approve invoice' })).toBeDisabled();
    await expect(dialog.getByText('Sep 30, 2026', { exact: false })).toBeVisible();
    await expect(dialog.getByRole('link', { name: 'View file' })).toBeVisible();
    await dialog.getByLabel('Job', { exact: true }).selectOption(job.id);
    await expect(dialog.getByRole('button', { name: 'Approve invoice' })).toBeEnabled();
    await expect(dialog.locator('option:checked')).toContainText('142 Cedar Street');
    await dialog.getByRole('button', { name: 'View 2 lines' }).click();
    await expect(dialog.getByText('$63.95/gal', { exact: false })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Approve invoice' })).toBeInViewport({ ratio: 1 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow).toBe(false);
    const panelOverflow = await dialog.evaluate((element) => element.scrollWidth > element.clientWidth);
    expect(panelOverflow).toBe(false);
    await page.screenshot({ path: testInfo.outputPath('supplier-review.png'), fullPage: true });
    const controls = dialog.locator('button, select, a');
    const measurements: { control: string; height: number; width: number }[] = [];
    for (const control of await controls.all()) {
      if (!await control.isVisible()) continue;
      const box = await control.boundingBox();
      if (box) measurements.push({ control: await control.evaluate((element) => element.outerHTML), height: box.height, width: box.width });
    }
    await testInfo.attach('touch-targets', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' });
    for (const measurement of measurements) {
      expect.soft(measurement.height, measurement.control).toBeGreaterThanOrEqual(48);
      expect.soft(measurement.width, measurement.control).toBeGreaterThanOrEqual(48);
    }
  });

  test('disables duplicate clicks, reuses a retry key and updates only the approved record', async ({ page }) => {
    await fixtures(page);
    let attempts = 0;
    const keys: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    await page.route('**/v1/invoices/imports/import-one/approve', async (route) => {
      attempts += 1;
      keys.push(route.request().headers()['idempotency-key']);
      expect(route.request().headers().authorization).toBe('Bearer synthetic-session');
      expect(route.request().postDataJSON().jobId).toBe(job.id);
      if (attempts === 1) { await held; return reply(route, { error: 'Temporarily unavailable. Try again.' }, 503); }
      await reply(route, { data: { import: { ...original, status: 'approved' }, purchase: { ...purchase, fileUrl: null } } });
    });
    const dialog = await review(page);
    await dialog.getByLabel('Job', { exact: true }).selectOption(job.id);
    const approve = dialog.getByRole('button', { name: 'Approve invoice' });
    await approve.click();
    await expect(approve).toBeDisabled();
    await expect(approve).toHaveAttribute('aria-busy', 'true');
    await approve.dispatchEvent('click');
    release();
    await expect(dialog.getByRole('alert')).toContainText('Temporarily unavailable');
    await expect(dialog.getByLabel('Job', { exact: true })).toHaveValue(job.id);
    await approve.click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByTestId('supplier-review-import-one')).toHaveCount(0);
    await expect(page.getByTestId('supplier-review-import-two')).toBeVisible();
    await expect(page.locator('#supplier-purchase-purchase-one').getByRole('link', { name: 'View source file' })).toBeVisible();
    expect(attempts).toBe(2);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
  });

  test('requires separate-purchase confirmation for a possible duplicate', async ({ page }) => {
    await fixtures(page, [{ ...original, extractedData: { ...original.extractedData, possibleDuplicatePurchaseId: purchase.id } }]);
    let input: Record<string, unknown> | undefined;
    await page.route('**/v1/invoices/imports/import-one/approve', async (route) => {
      input = route.request().postDataJSON();
      await reply(route, { data: { purchase, import: { ...original, status: 'approved' } } });
    });
    const dialog = await review(page);
    await expect(dialog.getByText('Possible duplicate purchase', { exact: true })).toBeVisible();
    await dialog.getByLabel('Job', { exact: true }).selectOption(job.id);
    await expect(dialog.getByRole('button', { name: 'Approve invoice' })).toBeDisabled();
    await dialog.getByRole('checkbox', { name: 'This is a separate purchase.' }).check();
    await dialog.getByRole('button', { name: 'Approve invoice' }).click();
    await expect(dialog).not.toBeVisible();
    expect(input?.confirmSimilarPurchase).toBe(true);
  });

  test('blocks unreconciled original charges before approval without hiding file access', async ({ page }) => {
    await fixtures(page, [{ ...original, extractedData: { ...original.extractedData, documentReconciliation: {
      required: true, status: 'mismatch', lineTotal: '130.80', documentTotal: '140.80',
    } } }]);
    let approvals = 0;
    await page.route('**/v1/invoices/imports/import-one/approve', async (route) => {
      approvals += 1;
      await reply(route, { error: 'Approval must not be attempted.' }, 400);
    });
    const dialog = await review(page);
    await dialog.getByLabel('Job', { exact: true }).selectOption(job.id);
    await expect(dialog.getByRole('alert')).toContainText('Charge totals need review');
    await expect(dialog.getByRole('alert')).toContainText('Document: $140.80');
    await expect(dialog.getByRole('button', { name: 'Approve invoice' })).toBeDisabled();
    await expect(dialog.getByRole('link', { name: 'View file' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Reject', exact: true })).toBeEnabled();
    expect(approvals).toBe(0);
  });

  test('refreshes a newly discovered duplicate without losing the job or dismissing review', async ({ page }) => {
    await fixtures(page);
    let approvals = 0;
    await page.route('**/v1/invoices/imports/import-one/approve', async (route) => {
      approvals += 1;
      await reply(route, { error: 'Compare the existing purchase and confirm this is a separate purchase.' }, 409);
    });
    await page.route('**/v1/invoices/imports', (route) => reply(route, { data: [{ ...original,
      extractedData: { ...original.extractedData, possibleDuplicatePurchaseId: purchase.id },
    }, second] }));
    const dialog = await review(page);
    await dialog.getByLabel('Job', { exact: true }).selectOption(job.id);
    await dialog.getByRole('button', { name: 'Approve invoice' }).click();
    await expect(dialog.getByRole('alert')).toContainText('Compare the existing purchase');
    await expect(dialog.getByText('Possible duplicate purchase', { exact: true })).toBeVisible();
    await expect(dialog.getByLabel('Job', { exact: true })).toHaveValue(job.id);
    await expect(dialog.getByRole('button', { name: 'Approve invoice' })).toBeDisabled();
    await dialog.getByRole('checkbox', { name: 'This is a separate purchase.' }).check();
    await expect(dialog.getByRole('button', { name: 'Approve invoice' })).toBeEnabled();
    await expect(page.getByTestId('supplier-review-import-one')).toHaveCount(1);
    expect(approvals).toBe(1);
  });

  test('uses an accessible mobile sheet for quick invoices with reachable actions', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await fixtures(page, []);
    const opener = page.getByRole('button', { name: 'Create invoice', exact: true }).first();
    await opener.click();
    const dialog = page.getByRole('dialog', { name: 'Create quick invoice', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'New', exact: true })).toBeInViewport();
    await dialog.getByRole('button', { name: 'New', exact: true }).click();
    await dialog.getByLabel('Name', { exact: true }).fill('Synthetic customer');
    await dialog.getByLabel('Email', { exact: true }).fill('customer@example.test');
    await expect(dialog.getByLabel('Name', { exact: true })).toHaveAttribute('autocomplete', 'name');
    const sheet = await dialog.boundingBox();
    expect(sheet?.x).toBeGreaterThanOrEqual(0);
    expect((sheet?.y || 0) + (sheet?.height || 0)).toBeLessThanOrEqual(801);
    expect(await dialog.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    await dialog.getByRole('button', { name: 'Create invoice', exact: true }).scrollIntoViewIfNeeded();
    await expect(dialog.getByRole('button', { name: 'Create invoice', exact: true })).toBeInViewport({ ratio: 1 });
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: testInfo.outputPath('quick-invoice-sheet.png'), fullPage: true });
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(opener).toBeFocused();
    await opener.click();
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await expect(page.getByLabel('Name', { exact: true })).toHaveValue('');
    await page.keyboard.press('Escape');
  });

  test('uploads a document only and preserves file and operation key after a failed staging request', async ({ page }) => {
    await fixtures(page, []);
    const keys: string[] = [];
    await page.route('**/v1/invoices/imports', async (route) => {
      if (route.request().method() !== 'POST') return reply(route, { data: [] });
      keys.push(route.request().headers()['idempotency-key']);
      expect(route.request().headers()['content-type']).toContain('multipart/form-data');
      if (keys.length === 1) return reply(route, { error: 'OCR service timed out. Retry this file.' }, 503);
      await reply(route, { data: original }, 201);
    });
    await page.getByRole('button', { name: 'Supplier invoice', exact: true }).click();
    const upload = page.getByRole('dialog', { name: 'Upload supplier invoice' });
    await expect(upload.getByRole('button', { name: 'Stage for review' })).toBeDisabled();
    await upload.getByLabel('Invoice file').setInputFiles(pdf);
    await upload.getByRole('button', { name: 'Stage for review' }).click();
    await expect(upload.getByRole('alert')).toContainText('OCR service timed out');
    await expect(upload.getByText('receipt.pdf', { exact: true })).toBeVisible();
    await expect(upload.locator('textarea')).toHaveCount(0);
    await upload.getByRole('button', { name: 'Stage for review' }).click();
    await expect(page.getByRole('dialog', { name: 'Review supplier invoice', exact: true })).toBeVisible();
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
  });

  for (const status of ['approved', 'rejected'] as const) test(`links ${status} exact duplicates to the existing record and removes the stale review row`, async ({ page }) => {
    await fixtures(page);
    await page.route('**/v1/invoices/imports', async (route) => {
      if (route.request().method() !== 'POST') return reply(route, { data: [original, second] });
      return reply(route, { error: 'This document already exists.', duplicate: true, duplicateType: 'import', data: { ...original, status, materialPurchaseId: status === 'approved' ? purchase.id : null } }, 409);
    });
    await page.getByRole('button', { name: 'Supplier invoice', exact: true }).click();
    const upload = page.getByRole('dialog', { name: 'Upload supplier invoice' });
    await upload.getByLabel('Invoice file').setInputFiles(pdf);
    await upload.getByRole('button', { name: 'Stage for review' }).click();
    await expect(upload.getByText(status === 'approved' ? 'This file was already imported.' : 'This file was previously rejected.')).toBeVisible();
    await expect(upload.getByRole('button', { name: 'Stage for review' })).toBeDisabled();
    await expect(upload.getByRole('link', { name: 'View file' })).toBeVisible();
    await upload.getByRole('button', { name: 'View record' }).click();
    const record = page.getByRole('dialog', { name: 'Supplier invoice record' });
    await expect(record).toBeVisible();
    await expect(record.getByRole('button', { name: 'Approve invoice' })).toHaveCount(0);
    await expect(record.getByRole('link', { name: 'View file' })).toBeVisible();
    await record.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.getByTestId('supplier-review-import-one')).toHaveCount(0);
    await expect(page.getByTestId('supplier-review-import-two')).toBeVisible();
  });

  for (const status of ['approved', 'rejected'] as const) test(`explains concurrent ${status} review while retaining detail and file access`, async ({ page }) => {
    await fixtures(page);
    await page.route('**/v1/invoices/imports/import-one/approve', (route) => reply(route, { error: 'Invoice import has already been reviewed', code: 'IMPORT_ALREADY_REVIEWED' }, status === 'approved' ? 409 : 404));
    await page.route('**/v1/invoices/imports', (route) => reply(route, { data: new URL(route.request().url()).search ? [original, second] : [{ ...original, status, materialPurchaseId: status === 'approved' ? purchase.id : null }, second] }));
    await page.route('**/v1/invoices/purchases', (route) => reply(route, { data: [purchase] }));
    const dialog = await review(page);
    await dialog.getByLabel('Job', { exact: true }).selectOption(job.id);
    await dialog.getByRole('button', { name: 'Approve invoice' }).click();
    const record = page.getByRole('dialog', { name: 'Supplier invoice record' });
    await expect(record.getByRole('alert')).toContainText(`${status} in another session`);
    await expect(record.getByText('Invoice INV-1042', { exact: false })).toBeVisible();
    await expect(record.getByRole('link', { name: 'View file' })).toBeVisible();
    await record.getByRole('button', { name: 'View 2 lines' }).click();
    await expect(record.getByText('$63.95/gal', { exact: false })).toBeVisible();
    await record.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.getByTestId('supplier-review-import-one')).toHaveCount(0);
    await expect(page.getByTestId('supplier-review-import-two')).toBeVisible();
  });

  test('shows supplier service errors rather than an empty state', async ({ page }) => {
    await fixtures(page, []);
    await page.route('**/v1/invoices/imports*', (route) => reply(route, { error: 'Supplier review service unavailable' }, 503));
    await page.reload();
    await page.getByRole('button', { name: 'Supplier purchases', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Supplier review service unavailable');
    await expect(page.getByText('All caught up. Upload an invoice to add a purchase.')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Retry supplier data' })).toBeVisible();
  });

  test('confirms rejection and preserves the reason for an idempotent retry', async ({ page }) => {
    await fixtures(page);
    const keys: string[] = [];
    let rejectedReason = '';
    await page.route('**/v1/invoices/imports/import-one/reject', async (route) => {
      keys.push(route.request().headers()['idempotency-key']);
      rejectedReason = route.request().postDataJSON().reviewNotes;
      if (keys.length === 1) return reply(route, { error: 'Could not save the review. Retry.' }, 503);
      return reply(route, { data: { ...original, status: 'rejected' } });
    });
    const dialog = await review(page);
    await dialog.getByRole('button', { name: 'Reject', exact: true }).click();
    expect(keys).toHaveLength(0);
    await dialog.getByLabel('Reason (optional)').fill('Credit receipt; replaced by corrected invoice.');
    await dialog.getByRole('button', { name: 'Reject invoice', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('Could not save the review');
    await expect(dialog.getByLabel('Reason (optional)')).toHaveValue('Credit receipt; replaced by corrected invoice.');
    await dialog.getByRole('button', { name: 'Reject invoice', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    expect(rejectedReason).toBe('Credit receipt; replaced by corrected invoice.');
    expect(keys[1]).toBe(keys[0]);
    await expect(page.getByTestId('supplier-review-import-two')).toBeVisible();
  });

  test('validates upload type and opens retained files through authenticated fetch', async ({ page }) => {
    await fixtures(page);
    // Native PDF viewers vary by browser. A valid image verifies the authenticated
    // blob navigation and rendering without depending on a PDF viewer extension.
    await page.route('**/v1/invoices/imports/import-one/file', (route) => route.fulfill({ contentType: 'image/png', headers: {
      'access-control-allow-origin': route.request().headers().origin || 'http://localhost:5173',
      'access-control-allow-credentials': 'true',
    }, body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jcI4AAAAASUVORK5CYII=', 'base64') }));
    await page.getByRole('button', { name: 'Supplier invoice', exact: true }).click();
    const upload = page.getByRole('dialog', { name: 'Upload supplier invoice' });
    await upload.getByLabel('Invoice file').setInputFiles({ name: 'unsafe.html', mimeType: 'text/html', buffer: Buffer.from('<script>bad()</script>') });
    await expect(upload.getByRole('alert')).toContainText('Choose a PDF, JPG, PNG or WebP');
    await expect(upload.getByRole('button', { name: 'Stage for review' })).toBeDisabled();
    await upload.getByRole('button', { name: 'Cancel', exact: true }).click();
    const dialog = await review(page);
    const requestedFile = page.waitForRequest((request) => request.url().endsWith('/v1/invoices/imports/import-one/file'));
    const popupOpened = page.waitForEvent('popup');
    await dialog.getByRole('link', { name: 'View file' }).click();
    const request = await requestedFile;
    expect(request.headers().authorization).toBe('Bearer synthetic-session');
    const popup = await popupOpened;
    await expect.poll(() => popup.url()).toMatch(/^blob:/);
    await expect.poll(() => popup.locator('img').evaluateAll((images) => images.some((image) => (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
    await popup.close();
  });
});
