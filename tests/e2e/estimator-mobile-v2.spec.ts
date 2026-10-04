import { expect, test, type Page, type Route } from '@playwright/test';
import { calculateProductionPreview } from '../../packages/core/src/estimation-production';

test.use({ serviceWorkers: 'block', baseURL: process.env.ESTIMATOR_TEST_BASE_URL || 'http://localhost:5173' });

const lead = { id: '30000000-0000-4000-8000-000000000001', name: 'Synthetic Customer', streetAddress: '10 Fixture Lane', postalCode: '98101' };
const settings = { defaultLaborRate: '65', defaultBurdenedLaborRate: '32', materialMarkupPercent: '30', salesTaxRate: '0' };
const finishId = '20000000-0000-4000-8000-000000000001';
const primerId = '20000000-0000-4000-8000-000000000002';
const rates = [
  { id: '10000000-0000-4000-8000-000000000001', category: 'interior', surfaceType: 'walls', description: 'Walls', unit: 'sqft', ratePerHour: '100', coats: 2, rateBasis: 'legacy_per_coat' as const },
  { id: '10000000-0000-4000-8000-000000000002', category: 'interior', surfaceType: 'ceilings', description: 'Ceiling', unit: 'sqft', ratePerHour: '100', coats: 2 },
  { id: '10000000-0000-4000-8000-000000000003', category: 'interior', surfaceType: 'trim', description: 'Trim', unit: 'linear_ft', ratePerHour: '60', coats: 2 },
  { id: '10000000-0000-4000-8000-000000000004', category: 'interior', surfaceType: 'doors', description: 'Doors', unit: 'each', ratePerHour: '2', coats: 2 },
].map((rate) => ({ ...rate, coatRates: {} }));
const materials = [
  { id: finishId, name: 'Professional Interior Washable Acrylic Finish With A Very Long Product Name And Detailed Contractor Specification', brand: 'Synthetic Brand', category: 'paint', unit: 'gallon', coverageSqFt: '350', costPerUnit: '52.50', markupPercent: '30' },
  { id: primerId, name: 'Bonding Primer', category: 'primer', unit: 'gallon', coverageSqFt: '300', costPerUnit: '30' },
];

async function reply(route: Route, data: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data), headers: {
    'access-control-allow-origin': route.request().headers().origin || 'http://localhost:5173',
    'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'Authorization, Content-Type, Idempotency-Key',
    'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS',
  } });
}

async function fixture(page: Page) {
  const state = { calculations: [] as any[], previews: [] as any[], templates: [] as any[], saves: [] as any[], saveKeys: [] as string[], failNextSave: false, beforeCalculation: null as null | (() => Promise<void>), photoUploads: [] as string[], emailCalls: 0, account: { orgId: 'synthetic-org', userId: 'synthetic-user' }, changedTax: false, version: '2026-10-04T12:00:00Z', estimate: null as any };
  await page.addInitScript(() => localStorage.setItem('crewmodo.sessionToken', 'synthetic-session'));
  await page.route('**/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (method === 'OPTIONS') return reply(route, {});
    if (path === '/v1/auth/session') return reply(route, { data: state.account });
    if (path === '/v1/production-rates') return reply(route, { data: rates });
    if (path === '/v1/leads') return reply(route, { data: [lead] });
    if (path === '/v1/settings/org') return reply(route, { data: settings });
    if (path === '/v1/materials') return reply(route, { data: materials });
    if (path === '/v1/estimate-templates') return reply(route, { data: state.templates });
    if (path.startsWith('/v1/estimate-templates/') && path.endsWith('/use')) {
      expect(route.request().headers()['idempotency-key']).toBeTruthy();
      return reply(route, { data: state.templates.find((template) => template.id === path.split('/')[3]) });
    }
    if (path === '/v1/estimate-photos/synthetic-estimate' && method === 'POST') {
      expect(route.request().headers()['idempotency-key']).toBeTruthy();
      state.photoUploads.push(route.request().postDataBuffer()?.toString() || '');
      return reply(route, { data: { id: 'synthetic-photo', url: 'https://example.invalid/fixture.png' } }, 201);
    }
    if (path === '/v1/production-rates/calculate') {
      const input = route.request().postDataJSON();
      expect(route.request().headers()['idempotency-key']).toBeTruthy();
      state.calculations.push(input);
      await state.beforeCalculation?.();
      const tax = state.changedTax ? '0.092' : input.taxOverride ? String(Number(input.taxOverride.ratePercent) / 100) : '0';
      const preview = calculateProductionPreview(input, { rates, materials, settings: { ...settings, salesTaxRate: tax } });
      state.previews.push(preview);
      return reply(route, { data: { ...preview, taxSnapshot: { source: input.taxOverride ? 'override' : 'organization', ratePercent: String(Number(tax) * 100), postalCode: input.jobsitePostalCode } } });
    }
    if (path.endsWith('/send-email')) { state.emailCalls++; return reply(route, { data: { previewUrl: '/estimates/synthetic-estimate/details' } }); }
    if (path === '/v1/estimates' && method === 'POST' || path === '/v1/estimates/synthetic-estimate' && method === 'PATCH') {
      const body = route.request().postDataJSON();
      expect(route.request().headers()['idempotency-key']).toBeTruthy();
      state.saves.push(body);
      state.saveKeys.push(route.request().headers()['idempotency-key']);
      if (state.failNextSave) {
        state.failNextSave = false;
        return reply(route, { error: 'Synthetic save interruption' }, 503);
      }
      for (const pkg of body.packages || []) {
        const calculated = calculateProductionPreview(pkg.productionInput, { rates, materials, settings }).calculation;
        const generated = calculated.items.filter((line) => ['estimator:minimum', 'estimator:mobilization'].includes(line.id)).map((line) => ({ calculationItemId: line.id, desc: line.id === 'estimator:minimum' ? 'Project minimum' : 'Mobilization', kind: 'line_item', qty: 1, rate: line.subtotalMinor / 100 }));
        pkg.items = [...pkg.items, ...generated]; pkg.lineItems = pkg.items;
      }
      state.estimate = { ...body, id: 'synthetic-estimate', updatedAt: state.version };
      return reply(route, { data: state.estimate }, 201);
    }
    if (path === '/v1/estimates/synthetic-estimate') return reply(route, { data: state.estimate });
    return reply(route, { data: [] });
  });
  return state;
}

async function start(page: Page) {
  await page.goto(`/estimates/production?leadId=${lead.id}`);
  await expect(page.getByRole('button', { name: 'Build starter scope' })).toBeVisible();
  await page.getByLabel('Wall/finish paint').selectOption(finishId);
}

async function bedroomStarter(page: Page, count = 1, trim = 'none', ceilings = false) {
  for (const name of ['Bathrooms', 'Living rooms', 'Dining rooms', 'Kitchens', 'Hallways', 'Closets']) await page.getByLabel(name, { exact: true }).fill('0');
  await page.getByLabel('Bedrooms', { exact: true }).fill(String(count));
  await page.getByRole('combobox', { name: 'Trim scope', exact: true }).selectOption(trim);
  await page.getByLabel('Ceilings', { exact: true }).setChecked(ceilings);
  await page.getByLabel('Doors', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Build starter scope' }).click();
}

async function editWall(page: Page) {
  const disclosure = page.getByTestId('estimator-room').first().getByRole('button', { name: /^Expand / });
  if (await disclosure.getAttribute('aria-expanded') === 'false') await disclosure.click();
  await page.getByTestId('estimator-room').first().getByRole('button', { name: /^Edit Walls in/ }).click();
  return page.getByRole('dialog').last();
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const dialog = page.getByRole('dialog').last();
  if (await dialog.count()) {
    const bounds = await dialog.boundingBox();
    const viewport = page.viewportSize()!;
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  }
}

for (const width of [360, 390, 768, 1440]) {
  test(`room capture, long products and 20 rooms at ${width}px`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 900 });
    const state = await fixture(page);
    await start(page);
    await bedroomStarter(page, 20, 'base-casing', true);
    await expect(page.getByTestId('estimator-room')).toHaveCount(20);
    expect(await page.getByRole('alert').allTextContents()).toEqual([]);
    await expect(page.getByLabel('Proposal pricing').getByText('Labor hours', { exact: true }).locator('..')).not.toHaveText('Labor hours0.0');
    await noOverflow(page);
    const dialog = await editWall(page);
    await expect(page.getByTestId('estimator-room').first()).toContainText('lin ft');
    await expect(page.getByTestId('estimator-room').first()).not.toContainText('linear_ft');
    for (const label of ['Color name', 'Color code', 'Color status']) {
      await expect(dialog.getByText(label, { exact: true })).toBeVisible();
      await expect(dialog.getByLabel(label, { exact: true })).toHaveAccessibleName(label);
    }
    await expect(dialog.getByLabel('Sq ft override')).toHaveValue('396');
    await dialog.getByLabel('Sq ft override').fill('500');
    await dialog.getByRole('button', { name: 'Use room metrics' }).click();
    await page.getByRole('dialog', { name: 'Replace field measurement' }).getByRole('button', { name: 'Keep measurement' }).click();
    await expect(dialog.getByLabel('Sq ft override')).toHaveValue('500');
    await dialog.getByRole('button', { name: 'Use room metrics' }).click();
    await page.getByRole('dialog', { name: 'Replace field measurement' }).getByRole('button', { name: 'Use room metrics' }).click();
    await expect(dialog.getByLabel('Sq ft override')).toHaveValue('396');
    await dialog.getByText('Preparation', { exact: true }).click();
    await dialog.getByLabel('Prep commitment').selectOption('heavy');
    await dialog.getByLabel('One-time prep hours').fill('2');
    const prepCommitment = await dialog.getByLabel('Prep commitment').boundingBox();
    const prepHoursLabel = await dialog.getByLabel('One-time prep hours').locator('..').boundingBox();
    const prepHours = await dialog.getByLabel('One-time prep hours').boundingBox();
    const paintHoursLabel = await dialog.getByLabel('Paint hours +/-').locator('..').boundingBox();
    expect(prepHoursLabel!.y - (prepCommitment!.y + prepCommitment!.height)).toBeGreaterThanOrEqual(11);
    expect(paintHoursLabel!.y - (prepHours!.y + prepHours!.height)).toBeGreaterThanOrEqual(11);
    await expect(dialog.getByText('Prep labor is entered once, separate from finish coats. No severity or method multiplier is applied.', { exact: true })).toHaveCount(0);
    await dialog.getByText('Advanced', { exact: true }).click();
    for (const field of await dialog.locator('input,select,textarea').all()) {
      if (await field.isVisible()) await expect(field).toHaveAccessibleName(/\S/);
    }
    await dialog.getByText('Advanced', { exact: true }).click();
    await expect(dialog.getByLabel('Finish product')).toHaveValue('');
    await noOverflow(page);
    await expect(dialog.getByRole('button', { name: 'Done editing' })).toBeInViewport();
    for (const control of await dialog.locator('input:not([type=checkbox]),select,button').all()) {
      if (await control.isVisible()) expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(48);
    }
    await page.screenshot({ path: testInfo.outputPath(`estimator-${width}-sheet.png`) });
    if (width < 640) {
      await page.setViewportSize({ width, height: 480 });
      await dialog.getByLabel('Sq ft override').focus();
      await noOverflow(page);
      await expect(dialog.getByRole('button', { name: 'Done editing' })).toBeInViewport();
      await expect(dialog.getByLabel('Sq ft override')).toBeInViewport();
      await page.setViewportSize({ width, height: 900 });
      await expect(dialog.getByRole('button', { name: 'Done editing' })).toBeInViewport();
    }
    await dialog.getByRole('button', { name: 'Done editing' }).click();
    await page.getByTestId('estimator-room').first().getByRole('button', { name: /^Duplicate/ }).click();
    await expect(page.getByTestId('estimator-room')).toHaveCount(21);
    await page.getByRole('button', { name: 'Apply products to rooms' }).click();
    await page.getByRole('dialog', { name: 'Apply room products' }).getByLabel('Shared finish product').selectOption(finishId);
    await page.getByRole('dialog', { name: 'Apply room products' }).getByRole('button', { name: 'Apply products', exact: true }).click();
    await page.getByTestId('estimator-room').first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`estimator-${width}-20-rooms.png`) });
    await noOverflow(page);
    expect(state.emailCalls).toBe(0);
  });
}

test('Trim None, retained finish, explicit primer operation, optional scope and tax payload', async ({ page }) => {
  const state = await fixture(page);
  await start(page);
  await bedroomStarter(page);
  const dialog = await editWall(page);
  await expect(dialog.getByRole('combobox', { name: 'Substrate', exact: true })).toHaveValue(rates[0].id);
  await dialog.getByLabel('Primer scope').selectOption('spot');
  await dialog.getByLabel('Primer product').selectOption(primerId);
  await dialog.getByLabel('Primer quantity (sq ft)').fill('50');
  await dialog.getByLabel('Primer labor hours').fill('1.5');
  await dialog.getByText('Preparation', { exact: true }).click();
  await dialog.getByLabel('Prep commitment').selectOption('heavy');
  await dialog.getByLabel('One-time prep hours').fill('2');
  await dialog.getByLabel('Color name').fill('Synthetic white');
  await dialog.getByLabel('Color code').fill('SW-TEST');
  await dialog.getByText('Advanced', { exact: true }).click();
  await dialog.getByLabel('Option', { exact: true }).check();
  await dialog.getByRole('button', { name: 'Done editing' }).click();
  await page.getByText('Advanced tax', { exact: true }).click();
  await page.getByLabel('Override estimate tax').check();
  await expect(page.getByRole('button', { name: 'Review proposal', exact: true }).last()).toBeDisabled();
  await page.getByLabel('Tax rate (%)').fill('9.2');
  await page.getByLabel('Tax override reason').fill('Synthetic jobsite policy review');
  await page.getByRole('button', { name: 'Review proposal', exact: true }).last().click();
  const request = state.calculations.at(-1);
  expect(request.calculationVersion).toBe('repaint-v2');
  expect(request.jobsitePostalCode).toBe('98101');
  expect(request.taxOverride).toEqual({ ratePercent: '9.2', reason: 'Synthetic jobsite policy review' });
  expect(request.items).toHaveLength(1);
  expect(request.items[0].optional).toBe(true);
  expect(request.items[0].materialId).toBe(finishId);
  expect(request.items[0].coatingLayers.map((layer: any) => layer.materialId)).toEqual([finishId, primerId]);
  expect(request.items[0].operations.find((operation: any) => operation.kind === 'primer').hours).toBe('1.5');
  await expect(page.getByRole('dialog', { name: 'Review Before Sending' })).toContainText('Customer Options');
  await expect(page.getByRole('dialog', { name: 'Review Before Sending' })).toContainText('Primer: Bonding Primer');
  expect(state.saves).toHaveLength(0);
  expect(state.emailCalls).toBe(0);
});

test('recovery, append, confirmed replace, deletion of last substrate and account cleanup', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await fixture(page);
  await start(page);
  await bedroomStarter(page);
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('dialog', { name: 'Recover local draft' })).toBeVisible();
  await page.getByRole('button', { name: 'Restore draft' }).click();
  await expect(page.getByTestId('estimator-room')).toHaveCount(1);
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await page.getByRole('button', { name: 'Build starter scope' }).click();
  await page.getByRole('button', { name: 'Append rooms' }).click();
  await expect(page.getByTestId('estimator-room')).toHaveCount(2);
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await page.getByRole('button', { name: 'Build starter scope' }).click();
  await page.getByRole('button', { name: 'Replace all rooms' }).click();
  await expect(page.getByTestId('estimator-room')).toHaveCount(2);
  await page.getByRole('button', { name: 'Confirm replace' }).click();
  await expect(page.getByTestId('estimator-room')).toHaveCount(1);
  const dialog = await editWall(page);
  await dialog.getByText('Advanced', { exact: true }).click();
  await dialog.getByRole('button', { name: 'Delete substrate' }).click();
  await page.getByRole('dialog', { name: 'Delete substrate', exact: true }).getByRole('button', { name: 'Delete substrate' }).click();
  await expect(page.getByTestId('estimator-room')).toHaveCount(0);
  await page.getByRole('button', { name: 'Add room or space' }).click();
  await expect(page.getByTestId('estimator-room')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('crewmodo.estimator-draft.v2:')).length)).toBe(1);
  await page.reload();
  await page.getByRole('button', { name: 'Discard draft' }).click();
  await expect(page.getByTestId('estimator-room')).toHaveCount(0);
  await page.getByRole('button', { name: 'Skip starter' }).click();
  await page.getByRole('button', { name: 'Add room or space' }).click();
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('crewmodo.estimator-draft.v2:')).length)).toBe(1);
  await page.evaluate(async () => {
    const url = '/src/pages/estimates/estimator-draft.ts';
    const helper = await import(url);
    helper.clearEstimatorDrafts();
    helper.setEstimatorDraftAccount(null);
  });
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('crewmodo.estimator-draft.v2:')).length)).toBe(0);
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('crewmodo.estimator-draft.v2:')).length)).toBe(0);
  expect(state.emailCalls).toBe(0);
});

test('stale server draft is reviewed; expired local draft is pruned; no signout mount dependency', async ({ page }) => {
  const state = await fixture(page);
  await start(page);
  await bedroomStarter(page);
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
  const draft = await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((key) => key.startsWith('crewmodo.estimator-draft.v2:'))!)!));
  state.estimate = { id: 'synthetic-estimate', updatedAt: state.version, leadId: lead.id, status: 'draft', packages: [] };
  await page.evaluate((value) => {
    const prefix = 'crewmodo.estimator-draft.v2:' + encodeURIComponent(JSON.stringify(['synthetic-org', 'synthetic-user'])) + ':';
    localStorage.setItem(prefix + 'synthetic-estimate', JSON.stringify({ ...value, baseVersion: 'old-version' }));
    localStorage.setItem(prefix + 'expired', JSON.stringify({ ...value, savedAt: Date.now() - 8 * 86400000 }));
  }, draft);
  await page.goto('/estimates/production?estimateId=synthetic-estimate');
  await expect(page.getByRole('dialog', { name: 'Recover local draft' })).toContainText('server estimate changed');
  await page.getByRole('button', { name: 'Restore draft' }).click();
  expect(await page.evaluate(() => Object.keys(localStorage).some((key) => key.endsWith(':expired')))).toBe(false);
  await page.goto('/login');
  await page.evaluate(async () => {
    const url = '/src/pages/estimates/estimator-draft.ts';
    const helper = await import(url);
    helper.setEstimatorDraftAccount({ orgId: 'different-org', userId: 'different-user' });
  });
  expect(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('crewmodo.estimator-draft.v2:')).length)).toBe(0);
});

test('loaded legacy draft keeps v1 until an explicit reviewed upgrade; changed send price blocks email', async ({ page }) => {
  const state = await fixture(page);
  state.estimate = { id: 'synthetic-estimate', updatedAt: state.version, status: 'draft', leadId: lead.id, packages: [{ calculationVersion: 'repaint-v1', name: 'proposal', estimateType: 'interior', items: [{ calculationItemId: 'legacy-wall', kind: 'surface', roomName: 'Legacy room', surfaceName: 'Walls', productionRateId: rates[0].id, desc: 'Legacy room: Walls', dimensions: { quantity: 100 }, labor: { coats: 2, prepLevel: 'none' }, material: { id: finishId, colorName: 'Synthetic white', colorCode: 'SW-TEST', status: 'Selected' } }] }] };
  await page.goto('/estimates/production?estimateId=synthetic-estimate');
  await expect(page.getByRole('button', { name: 'Update to v2 pricing' })).toBeVisible();
  await page.getByRole('button', { name: 'Review proposal', exact: true }).last().click();
  await expect(page.getByRole('dialog', { name: 'Review Before Sending' })).toBeVisible();
  expect(state.calculations.at(-1).calculationVersion).toBe('repaint-v1');
  await page.getByRole('button', { name: 'Keep editing' }).click();
  await page.getByRole('button', { name: 'Update to v2 pricing' }).click();
  await page.getByRole('button', { name: 'Use v2 pricing' }).click();
  await page.getByRole('button', { name: 'Review proposal', exact: true }).last().click();
  await expect(page.getByRole('dialog', { name: 'Review Before Sending' })).toBeVisible();
  expect(state.calculations.at(-1).calculationVersion).toBe('repaint-v2');
  state.changedTax = true;
  await page.getByRole('button', { name: 'Send email', exact: true }).click();
  await expect(page.getByText('Pricing changed. Review the updated proposal before sending.', { exact: true })).toBeVisible();
  expect(state.emailCalls).toBe(0);
  expect(state.saves).toHaveLength(0);
});

test('cleanup setter works before any estimator mount', async ({ page }) => {
  await fixture(page);
  await page.goto('/login');
  await page.evaluate(async () => {
    localStorage.setItem('crewmodo.estimator-draft.v2:old-account:estimate', '{}');
    const url = '/src/pages/estimates/estimator-draft.ts';
    const helper = await import(url);
    helper.setEstimatorDraftAccount({ orgId: 'new-org', userId: 'new-user' });
    if ((window as any).CrewmodoEstimatorAccount?.orgId !== 'new-org') throw new Error('Account not updated directly');
    if (Object.keys(localStorage).some((key) => key.startsWith('crewmodo.estimator-draft.v2:'))) throw new Error('Previous account draft not cleared');
    localStorage.setItem('crewmodo.estimator-draft.v2:new-account:estimate', '{}');
    helper.setEstimatorDraftAccount(null);
    if ((window as any).CrewmodoEstimatorAccount !== null) throw new Error('Signout account not cleared');
    if (Object.keys(localStorage).some((key) => key.startsWith('crewmodo.estimator-draft.v2:'))) throw new Error('Signout draft not cleared');
    helper.setEstimatorDraftAccount({ orgId: 'new-org', userId: 'new-user' });
    localStorage.setItem('crewmodo.estimator-draft.v2:cleanup-event:estimate', '{}');
    window.dispatchEvent(new Event(helper.ESTIMATOR_DRAFT_CLEANUP_EVENT));
    if ((window as any).CrewmodoEstimatorAccount !== null || Object.keys(localStorage).some((key) => key.startsWith('crewmodo.estimator-draft.v2:'))) throw new Error('Cleanup event required an editor mount');
  });
});

test('save draft, edit the saved estimate, reload and recover the later edit', async ({ page }) => {
  const state = await fixture(page);
  await start(page);
  await bedroomStarter(page);
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page).toHaveURL(/\/estimates\?status=draft$/);
  expect(state.saves).toHaveLength(1);
  expect(state.saves[0].packages[0].items.find((item: any) => item.kind === 'surface').notes).not.toMatch(/sqft|labor hours/);
  expect(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('crewmodo.estimator-draft.v2:')).length)).toBe(0);
  await page.goto('/estimates/production?estimateId=synthetic-estimate');
  const dialog = await editWall(page);
  await dialog.getByLabel('Sq ft override').fill('725');
  await dialog.getByRole('button', { name: 'Done editing' }).click();
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Restore draft' }).click();
  await expect((await editWall(page)).getByLabel('Sq ft override')).toHaveValue('725');
  expect(state.emailCalls).toBe(0);
});

test('clearing a saved baseline while mounted still recovers subsequent edits', async ({ page }) => {
  await fixture(page);
  await page.goto('/login');
  const mountHarness = async () => page.evaluate(async () => {
    const source = await (await fetch('/src/pages/estimates/estimator-draft.ts')).text();
    const reactPath = source.match(/from\s*["']([^"']*react\.js[^"']*)["']/)?.[1];
    if (!reactPath) throw new Error('React module path unavailable');
    const reactModule = await import(reactPath);
    const React = reactModule.default || reactModule;
    const rootModule = await import('/node_modules/.vite/deps/react-dom_client.js');
    const { createRoot } = rootModule.default || rootModule;
    const helper = await import('/src/pages/estimates/estimator-draft.ts');
    const host = document.createElement('div');
    host.id = 'draft-hook-harness';
    document.body.append(host);
    function Harness() {
      const [value, setValue] = React.useState('server baseline');
      const draft = helper.useEstimatorDraft({ estimateKey: 'mounted-save-regression', baseVersion: 'server-version', value, enabled: true, validate: (candidate: unknown) => typeof candidate === 'string' });
      return React.createElement('div', null,
        React.createElement('input', { 'aria-label': 'Harness value', value, onChange: (event: any) => setValue(event.target.value) }),
        React.createElement('button', { onClick: () => draft.clearAfterSave() }, 'Mark server saved'),
        draft.candidate && React.createElement('button', { onClick: () => setValue(draft.restore()) }, 'Recover harness'),
        React.createElement('span', null, draft.status));
    }
    createRoot(host).render(React.createElement(Harness));
  });
  await mountHarness();
  await page.getByLabel('Harness value').fill('first edit');
  await expect(page.locator('#draft-hook-harness')).toContainText('Saved locally');
  await page.getByRole('button', { name: 'Mark server saved' }).click();
  await page.waitForTimeout(750);
  expect(await page.evaluate(() => Object.keys(localStorage).some((key) => key.endsWith(':mounted-save-regression')))).toBe(false);
  await page.getByLabel('Harness value').fill('later edit');
  await expect(page.locator('#draft-hook-harness')).toContainText('Saved locally');
  await page.reload();
  await mountHarness();
  await page.getByRole('button', { name: 'Recover harness' }).click();
  await expect(page.getByLabel('Harness value')).toHaveValue('later edit');
});

test('commercial minimum, mobilization, explicit unknown add-on cost and contextual room photos', async ({ page }) => {
  test.setTimeout(90_000);
  const state = await fixture(page);
  await start(page);
  await bedroomStarter(page);
  await page.getByText('Commercial details', { exact: true }).click();
  await page.getByLabel('Project minimum ($)').fill('5000');
  await page.getByLabel('One-time mobilization hours').fill('2');
  await page.getByRole('button', { name: 'Add line', exact: true }).click();
  await page.getByLabel('Description', { exact: true }).fill('Synthetic access equipment');
  await page.getByLabel('Price', { exact: true }).fill('125');
  await page.getByText('Internal cost and hours', { exact: true }).click();
  await expect(page.getByLabel('Unknown direct cost')).toBeChecked();
  await page.getByLabel('Direct cost per unit ($)').fill('0');
  await page.getByLabel('Labor hours per unit').fill('1.25');
  await page.getByLabel('Burdened rate override ($/hr)').fill('35');
  await page.getByLabel('Unknown direct cost').check();
  await expect(page.getByLabel('Internal cost review').getByText('Known labor cost', { exact: true }).locator('..')).toHaveText('Known labor cost$361.19');
  await expect(page.getByLabel('Internal cost review').getByText('Burdened labor cost', { exact: true }).locator('..')).toHaveText('Burdened labor cost$361.19');
  await expect(page.getByLabel('Internal cost review')).toContainText('Unknown: incomplete cost budget');
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Restore draft' }).click();
  await page.getByText('Commercial details', { exact: true }).click();
  await expect(page.getByLabel('Project minimum ($)')).toHaveValue('5000');
  await expect(page.getByLabel('One-time mobilization hours')).toHaveValue('2');
  await page.getByText('Internal cost and hours', { exact: true }).click();
  await expect(page.getByLabel('Unknown direct cost')).toBeChecked();
  await expect(page.getByLabel('Labor hours per unit')).toHaveValue('1.25');
  await page.getByRole('button', { name: 'Review proposal', exact: true }).last().click();
  const request = state.calculations.at(-1);
  expect(request.minimumPrice).toBe('5000');
  expect(request.mobilizationHours).toBe('2');
  expect(request.adjustments).toHaveLength(1);
  expect(request.adjustments[0]).toMatchObject({ costPerUnit: '0', hoursPerUnit: '1.25', burdenedRate: '35', costUnknown: true });
  await expect(page.getByRole('dialog', { name: 'Review Before Sending' })).toContainText('Project minimum');
  await expect(page.getByRole('dialog', { name: 'Review Before Sending' })).toContainText('Mobilization');
  await page.getByRole('button', { name: 'Keep editing' }).click();
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page).toHaveURL(/\/estimates\?status=draft$/);
  await page.goto('/estimates/production?estimateId=synthetic-estimate');
  await expect(page.getByLabel('Description', { exact: true })).toHaveCount(1);
  await page.getByText('Commercial details', { exact: true }).click();
  await expect(page.getByLabel('Project minimum ($)')).toHaveValue('5000');
  await page.getByTestId('estimator-room').first().getByRole('button', { name: 'Edit Bedroom', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Edit room: Bedroom' });
  await sheet.getByText('Room photos', { exact: true }).click();
  await expect(sheet.getByRole('button', { name: 'Take photo' })).toBeEnabled();
  await expect(sheet.getByRole('link', { name: 'Estimate photos' })).toHaveAttribute('href', '/estimates/synthetic-estimate/photos');
  await sheet.getByLabel('Upload photos for Bedroom').setInputFiles({ name: 'room-test.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2lYAAAAAASUVORK5CYII=', 'base64') });
  await expect(sheet.getByRole('status')).toHaveText('1 room photo uploaded');
  expect(state.photoUploads).toHaveLength(1);
  expect(state.photoUploads[0]).toContain('Bedroom: room-test.png');
  expect(state.emailCalls).toBe(0);
});

test('minimum and mobilization direct save uses current totals and restores without another field edit', async ({ page }) => {
  const state = await fixture(page);
  await start(page);
  await bedroomStarter(page);
  await page.getByText('Commercial details', { exact: true }).click();
  await page.getByLabel('Project minimum ($)').fill('5000');
  await page.getByLabel('One-time mobilization hours').fill('2');
  await expect(page.getByLabel('Proposal pricing')).toContainText('Base proposal total$5,000.00');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page).toHaveURL(/\/estimates\?status=draft$/);
  expect(state.calculations.at(-1)).toMatchObject({ minimumPrice: '5000', mobilizationHours: '2' });
  const pkg = state.saves[0].packages[0];
  expect(pkg.total).toBe(5000);
  expect(pkg.calculationInput.minimumPrice).toBe('5000');
  expect(pkg.calculationInput.surfaces.find((surface: any) => surface.id === 'estimator:mobilization').operations).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'mobilization', hours: '2' })]));
  expect(pkg.productionInput).toMatchObject({ minimumPrice: '5000', mobilizationHours: '2', editorState: { minimumPrice: '5000', mobilizationHours: '2' } });
  expect(pkg.items.filter((item: any) => item.calculationItemId === 'estimator:minimum')).toHaveLength(1);
  expect(pkg.items.filter((item: any) => item.calculationItemId === 'estimator:mobilization')).toHaveLength(1);
  await page.goto('/estimates/production?estimateId=synthetic-estimate');
  await page.reload();
  await page.getByText('Commercial details', { exact: true }).click();
  await expect(page.getByLabel('Project minimum ($)')).toHaveValue('5000');
  await expect(page.getByLabel('One-time mobilization hours')).toHaveValue('2');
  await expect(page.getByLabel('Proposal pricing')).toContainText('Base proposal total$5,000.00');
  expect(state.emailCalls).toBe(0);
});

test('commercial edits invalidate cached and in-flight previews and changed failed-save keys', async ({ page }) => {
  test.setTimeout(90_000);
  const state = await fixture(page);
  await start(page);
  await bedroomStarter(page);
  await page.getByText('Commercial details', { exact: true }).click();
  await page.getByLabel('Project minimum ($)').fill('4000');
  await page.getByLabel('One-time mobilization hours').fill('1');
  await page.getByRole('button', { name: 'Review proposal', exact: true }).last().click();
  await page.getByRole('button', { name: 'Keep editing' }).click();
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  state.beforeCalculation = () => held;
  const previousCalculations = state.calculations.length;
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect.poll(() => state.calculations.length).toBe(previousCalculations + 1);
  await page.getByLabel('Project minimum ($)').fill('5000');
  await page.getByLabel('One-time mobilization hours').fill('2');
  await expect(page.getByLabel('Proposal pricing')).toContainText('Base proposal total$5,000.00');
  state.beforeCalculation = null;
  release();
  await expect(page.getByRole('complementary').getByText('Scope changed while pricing was checked. Review the current scope again.', { exact: true })).toBeVisible();
  expect(state.saves).toHaveLength(0);
  state.failNextSave = true;
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByRole('complementary').getByText('Synthetic save interruption', { exact: true })).toBeVisible();
  expect(state.saves[0].packages[0].productionInput).toMatchObject({ minimumPrice: '5000', mobilizationHours: '2' });
  await page.getByLabel('Project minimum ($)').fill('6000');
  await page.getByLabel('One-time mobilization hours').fill('3');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page).toHaveURL(/\/estimates\?status=draft$/);
  expect(state.saves).toHaveLength(2);
  expect(state.saveKeys[1]).not.toBe(state.saveKeys[0]);
  expect(state.saves[1].packages[0].productionInput).toMatchObject({ minimumPrice: '6000', mobilizationHours: '3' });
  expect(state.saves[1].packages[0].total).toBe(6000);
  expect(state.emailCalls).toBe(0);
});

test('color separation hours and scope apply once across coats, recover, save, zero and remove', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await fixture(page);
  await start(page);
  await bedroomStarter(page);
  let sheet = await editWall(page);
  await sheet.getByLabel('Coats', { exact: true }).selectOption('1');
  await sheet.getByText('Preparation', { exact: true }).click();
  await sheet.getByLabel('One-time prep hours').fill('2');
  await sheet.getByLabel('Paint hours +/-').fill('0.5');
  await sheet.getByText('Advanced', { exact: true }).click();
  await sheet.getByLabel('Wall/ceiling color relationship').selectOption('same');
  await expect(sheet.getByText('Color separation', { exact: true })).toHaveCount(0);
  await sheet.getByLabel('Wall/ceiling color relationship').selectOption('unconfirmed');
  await sheet.getByText('Color separation', { exact: true }).click();
  await expect(sheet.getByLabel('One-time masking hours')).toHaveValue('');
  await expect(sheet.getByLabel('One-time cut-in hours')).toHaveValue('');
  await sheet.getByLabel('Wall/ceiling color relationship').selectOption('different');
  await sheet.getByLabel('One-time masking hours').fill('1.25');
  await sheet.getByLabel('Masking scope', { exact: true }).fill('Protect ceiling edges before contrasting wall finish');
  await sheet.getByLabel('One-time cut-in hours').fill('0.75');
  await sheet.getByLabel('Cut-in scope', { exact: true }).fill('Cut a clean wall and ceiling color boundary');
  for (const field of await sheet.locator('input,select').all()) if (await field.isVisible()) await expect(field).toHaveAccessibleName(/\S/);
  await expect(sheet.getByLabel('Masking scope')).toHaveAttribute('maxlength', '300');
  await expect(sheet.getByRole('button', { name: 'Done editing' })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('estimator-color-separation-390.png') });
  await sheet.getByRole('button', { name: 'Done editing' }).click();
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Restore draft' }).click();
  await page.getByRole('button', { name: 'Review proposal', exact: true }).last().click();
  const oneCoat = state.previews.at(-1).calculation.items[0];
  expect(oneCoat.hours).toBe('8.46'); // 396/100 + .5 correction + 2 prep + 1.25 masking + .75 cut-in.
  const separation = oneCoat.operations.filter((operation: any) => ['masking', 'cut_in'].includes(operation.kind));
  expect(separation.map((operation: any) => operation.hours)).toEqual(['1.25', '0.75']);
  expect(separation.reduce((sum: number, operation: any) => sum + operation.laborMinor, 0)).toBe(13000);
  expect(separation.reduce((sum: number, operation: any) => sum + operation.laborBudgetMinor, 0)).toBe(6400);
  expect(oneCoat.operations.filter((operation: any) => operation.kind === 'application')).toHaveLength(1);
  expect(oneCoat.operations.filter((operation: any) => operation.kind === 'prep')).toHaveLength(1);
  await expect(page.getByRole('dialog', { name: 'Review Before Sending' })).toContainText('Protect ceiling edges before contrasting wall finish');
  await expect(page.getByRole('dialog', { name: 'Review Before Sending' })).toContainText('Cut a clean wall and ceiling color boundary');
  const ids = separation.map((operation: any) => operation.id);
  await page.getByRole('button', { name: 'Keep editing' }).click();
  sheet = await editWall(page);
  await sheet.getByLabel('Coats', { exact: true }).selectOption('3');
  await sheet.getByRole('button', { name: 'Done editing' }).click();
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page).toHaveURL(/\/estimates\?status=draft$/);
  const threeCoats = state.previews.at(-1).calculation.items[0];
  expect(threeCoats.hours).toBe('16.38');
  expect(threeCoats.operations.filter((operation: any) => ['masking', 'cut_in'].includes(operation.kind))).toEqual(separation);
  const stored = state.saves[0].packages[0];
  expect(stored.productionInput.items[0].operations.filter((operation: any) => ['masking', 'cut_in'].includes(operation.kind)).map((operation: any) => operation.id)).toEqual(ids);
  expect(stored.items[0].scopeCommitments).toEqual(['Protect ceiling edges before contrasting wall finish', 'Cut a clean wall and ceiling color boundary']);
  await page.goto('/estimates/production?estimateId=synthetic-estimate');
  await page.reload();
  sheet = await editWall(page);
  await sheet.getByText('Advanced', { exact: true }).click();
  await sheet.getByText('Color separation', { exact: true }).click();
  await expect(sheet.getByLabel('One-time masking hours')).toHaveValue('1.25');
  await expect(sheet.getByLabel('Masking scope')).toHaveValue('Protect ceiling edges before contrasting wall finish');
  await sheet.getByLabel('One-time masking hours').fill('0');
  await sheet.getByRole('button', { name: 'Remove cut-in operation', exact: true }).click();
  await sheet.getByLabel('Wall/ceiling color relationship').selectOption('same');
  await expect(sheet.getByLabel('One-time masking hours')).toHaveValue('0');
  await sheet.getByRole('button', { name: 'Done editing' }).click();
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page).toHaveURL(/\/estimates\?status=draft$/);
  const cleared = state.saves[1].packages[0];
  expect(cleared.productionInput.items[0].operations.find((operation: any) => operation.id === ids[0]).hours).toBe('0');
  expect(cleared.productionInput.items[0].operations.some((operation: any) => operation.id === ids[1])).toBe(false);
  expect(cleared.items[0].scopeCommitments || []).toEqual([]);
  const finalOps = state.previews.at(-1).calculation.items[0].operations;
  expect(finalOps.filter((operation: any) => operation.kind === 'application')).toHaveLength(1);
  expect(finalOps.filter((operation: any) => operation.kind === 'prep')).toHaveLength(1);
  expect(state.previews.at(-1).calculation.items[0].hours).toBe('14.38');
  expect(state.emailCalls).toBe(0);
});

test('loaded separation operations remain editable on same color without replacing IDs or other work', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const state = await fixture(page);
  const operations = [
    { id: 'loaded-application', kind: 'application', coats: 2, adjustmentHours: '0.25' },
    { id: 'loaded-prep', kind: 'prep', hours: '1' },
    { id: 'loaded-setup', kind: 'setup', hours: '0.5', description: 'Private operating setup' },
    { id: 'loaded-mask-a', kind: 'masking', hours: '0.5', description: 'Protect ceiling edge', sellingRate: '70', burdenedRate: '30' },
    { id: 'loaded-mask-b', kind: 'masking', hours: '1.5', description: 'Protect decorative cornice' },
    { id: 'loaded-cut', kind: 'cut_in', hours: '0.75', description: 'Cut wall boundary' },
  ];
  state.estimate = { id: 'synthetic-estimate', updatedAt: state.version, status: 'draft', leadId: lead.id, packages: [{ name: 'proposal', calculationVersion: 'repaint-v2', estimateType: 'interior',
    productionInput: { calculationVersion: 'repaint-v2', items: [{ id: 'loaded-wall', productionRateId: rates[0].id, quantity: '100', coats: 2, colorRelationship: 'same', operations, coatingLayers: [{ id: 'loaded-finish', phase: 'finish', materialId: finishId, coats: 2 }] }] },
    items: [{ calculationItemId: 'loaded-wall', kind: 'surface', roomName: 'Loaded room', surfaceName: 'Walls', desc: 'Loaded room: Walls', productionRateId: rates[0].id, dimensions: { quantity: 100 }, labor: { coats: 2, prepLevel: 'none' }, material: { id: finishId, colorName: 'Synthetic white', colorCode: 'SW-TEST', status: 'Selected' } }],
  }] };
  await page.goto('/estimates/production?estimateId=synthetic-estimate');
  let sheet = await editWall(page);
  await sheet.getByText('Advanced', { exact: true }).click();
  await sheet.getByText('Color separation', { exact: true }).click();
  await expect(sheet.getByLabel('One-time masking hours', { exact: true })).toHaveValue('0.5');
  await expect(sheet.getByLabel('One-time masking hours (2)', { exact: true })).toHaveValue('1.5');
  await sheet.getByLabel('One-time masking hours', { exact: true }).fill('0');
  await sheet.getByLabel('Masking scope (2)', { exact: true }).fill('Protect ornate cornice before finishing');
  await sheet.getByLabel('One-time cut-in hours').fill('1.25');
  await sheet.getByRole('button', { name: 'Done editing' }).click();
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page).toHaveURL(/\/estimates\?status=draft$/);
  const stored = state.saves[0].packages[0];
  const edited = stored.productionInput.items[0].operations;
  expect(edited.map((operation: any) => operation.id)).toEqual(operations.map((operation) => operation.id));
  expect(edited.slice(0, 3)).toEqual(operations.slice(0, 3));
  expect(edited[3]).toEqual({ ...operations[3], hours: '0' });
  expect(edited[4]).toEqual({ ...operations[4], description: 'Protect ornate cornice before finishing' });
  expect(edited[5]).toEqual({ ...operations[5], hours: '1.25' });
  expect(stored.scopeCommitments).toBeUndefined();
  expect(stored.items[0].scopeCommitments).toEqual(['Protect ornate cornice before finishing', 'Cut wall boundary']);
  expect(state.previews.at(-1).calculation.items[0].operations.filter((operation: any) => operation.kind === 'application')).toHaveLength(1);
  expect(state.previews.at(-1).calculation.items[0].operations.filter((operation: any) => operation.kind === 'prep')).toHaveLength(1);
  await page.goto('/estimates/production?estimateId=synthetic-estimate');
  await page.reload();
  sheet = await editWall(page);
  await sheet.getByText('Advanced', { exact: true }).click();
  await sheet.getByText('Color separation', { exact: true }).click();
  await expect(sheet.getByLabel('One-time masking hours', { exact: true })).toHaveValue('0');
  await expect(sheet.getByLabel('Masking scope (2)', { exact: true })).toHaveValue('Protect ornate cornice before finishing');
  await expect(sheet.getByLabel('One-time cut-in hours')).toHaveValue('1.25');
  expect(state.emailCalls).toBe(0);
});

test('native template entry preserves mixed operations, layers, budgets and commercial defaults', async ({ page }) => {
  test.setTimeout(90_000);
  const state = await fixture(page);
  const operations = [
    { id: 'native-primary', kind: 'application', coats: 2, adjustmentHours: '0.25' },
    { id: 'native-extra-pass', kind: 'application', quantity: '50', coats: 1, adjustmentHours: '0.75', description: 'Additional accent application' },
    { id: 'native-primer', kind: 'primer', hours: '1', quantity: '25' },
    { id: 'native-extra-primer', kind: 'primer', hours: '0.5', quantity: '10', description: 'Additional spot primer application' },
    { id: 'native-prep', kind: 'prep', hours: '2' },
    { id: 'native-mask', kind: 'masking', hours: '1', description: 'Protect wall and ceiling boundaries' },
    { id: 'native-cut', kind: 'cut_in', hours: '0.5', description: 'Cut the contrasting ceiling boundary' },
  ];
  const coatingLayers = [
    { id: 'native-finish', phase: 'finish', materialId: finishId, coats: 2, colorName: 'Synthetic white', colorCode: 'SW-TEST', colorSupplier: 'Synthetic Brand', lossAllowancePercent: '4' },
    { id: 'native-primer-layer', phase: 'primer', materialId: primerId, coats: 1, quantity: '25', lossAllowancePercent: '3' },
    { id: 'native-accent-layer', phase: 'finish', materialId: finishId, coats: 1, quantity: '15', colorName: 'Synthetic accent', colorCode: 'SW-ACCENT' },
  ];
  const assembly = { format: 'crewmodo-assembly-v2', calculationVersion: 'repaint-v2', materialSellingPolicy: 'consumption', minimumPrice: '5000', mobilizationHours: '2', discount: '10', adjustments: [{ id: 'native-access', description: 'Access equipment', quantity: '1', unitPrice: '125', hoursPerUnit: '1.25', burdenedRate: '35', costUnknown: true }] };
  state.templates = [{ id: 'native-template', name: 'Native mixed assembly', rooms: [{ id: 'native-room', name: 'Template room', kind: 'interior', metrics: { length: 12, width: 10, height: 9 }, surfaces: [{ id: 'native-wall', productionRateId: rates[0].id, category: 'walls', label: 'Walls', unit: 'sqft', quantity: '100', coats: 2, prepLevel: 'none', paintAdjustmentHours: '0.25', colorRelationship: 'different', sellingRate: '80', burdenedRate: '28', operations, coatingLayers }] }], packages: [assembly] }];
  await page.goto('/templates');
  await page.getByRole('button', { name: 'Use template', exact: true }).click();
  await expect(page).toHaveURL(/\/estimates\/production$/);
  await expect(page.getByTestId('estimator-room')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Update to v2 pricing' })).toHaveCount(0);
  await page.getByLabel('Customer').selectOption(lead.id);
  await page.getByText('Commercial details', { exact: true }).click();
  await expect(page.getByLabel('Project minimum ($)')).toHaveValue('5000');
  await expect(page.getByLabel('One-time mobilization hours')).toHaveValue('2');
  await expect(page.getByLabel('Material selling basis')).toHaveValue('consumption');
  await expect(page.getByLabel('Discount', { exact: true })).toHaveValue('10');
  await expect(page.getByLabel('Description', { exact: true })).toHaveValue('Access equipment');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page).toHaveURL(/\/estimates\?status=draft$/);
  const stored = state.saves[0].packages[0];
  const input = stored.productionInput;
  expect(input.calculationVersion).toBe('repaint-v2');
  expect(input).toMatchObject({ materialSellingPolicy: 'consumption', minimumPrice: '5000', mobilizationHours: '2', discount: '10' });
  expect(input.adjustments[0]).toMatchObject({ id: 'native-access', hoursPerUnit: '1.25', burdenedRate: '35', costUnknown: true });
  expect(input.editorState.rooms[0]).toMatchObject({ id: 'native-room', metrics: { length: 12, width: 10, height: 9 } });
  expect(input.items[0]).toMatchObject({ id: 'native-wall', quantity: '100', sellingRate: '80', burdenedRate: '28', colorRelationship: 'different' });
  expect(input.items[0].operations).toEqual(operations);
  expect(input.items[0].coatingLayers).toEqual(coatingLayers);
  expect(stored.items[0].scopeCommitments).toEqual(['Protect wall and ceiling boundaries', 'Cut the contrasting ceiling boundary']);
  await page.goto('/estimates/production?estimateId=synthetic-estimate');
  await page.reload();
  const sheet = await editWall(page);
  await sheet.getByLabel('Coats', { exact: true }).selectOption('3');
  await sheet.getByRole('button', { name: 'Done editing' }).click();
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page).toHaveURL(/\/estimates\?status=draft$/);
  const edited = state.saves[1].packages[0].productionInput.items[0];
  expect(edited.operations[0]).toEqual({ ...operations[0], coats: 3 });
  expect(edited.operations.slice(1)).toEqual(operations.slice(1));
  expect(edited.coatingLayers[0]).toEqual({ ...coatingLayers[0], coats: 3 });
  expect(edited.coatingLayers.slice(1)).toEqual(coatingLayers.slice(1));
  expect(edited.sellingRate).toBe('80');
  expect(edited.burdenedRate).toBe('28');
  expect(state.emailCalls).toBe(0);
});

test('unsafe template use response is blocked without silently opening flattened scope', async ({ page }) => {
  const state = await fixture(page);
  const template = { id: 'unsafe-template', name: 'Unsafe assembly fixture', rooms: [{ name: 'Review room', items: [{ category: 'walls', quantity: '100', prepLevel: 'none', materialId: finishId }] }] };
  state.templates = [template];
  await page.route('**/v1/estimate-templates/unsafe-template/use', (route) => reply(route, { data: { ...template, packages: [{ format: 'unsupported-signed-package', total: 10000 }] } }));
  await page.goto('/templates');
  await page.getByRole('button', { name: 'Use template', exact: true }).click();
  await expect(page.getByText('This template contains package pricing that cannot be converted safely. Keep the original estimate or review it in its source editor.', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/templates$/);
  expect(state.saves).toHaveLength(0);
  expect(state.calculations).toHaveLength(0);
  expect(state.emailCalls).toBe(0);
});
