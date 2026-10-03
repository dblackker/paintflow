import { expect, Page, test } from '@playwright/test';

test.setTimeout(60_000);

async function mountFixture(page: Page) {
  await page.route('**/__design-system-fixture', (route) => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>
      <div id="root"></div><script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => (type) => type;
      window.__vite_plugin_react_preamble_installed__ = true;
      const fixture = await import('/src/components/DesignSystemTestFixture.tsx');
      fixture.mountDesignSystemTestFixture();
      </script></body></html>`,
  }));
  await page.goto('/__design-system-fixture');
  await expect(page.getByRole('button', { name: 'Open form', exact: true })).toBeVisible({ timeout: 40000 });
}

test.beforeEach(async ({ page }) => mountFixture(page));

test('portal is above the header, traps focus, restores focus and closes only the top dialog', async ({ page }) => {
  const launcher = page.getByRole('button', { name: 'Open form', exact: true });
  await launcher.click();
  const parent = page.getByRole('dialog', { name: 'Review crew time' });
  await expect(parent).toBeVisible();
  await expect(parent).toHaveAttribute('aria-modal', 'true');
  await expect(page.getByLabel('Work email', { exact: true })).toBeFocused();
  expect(await parent.evaluate((element) => element.closest('#root'))).toBeNull();
  await expect(page.locator('#root')).toHaveAttribute('inert', '');
  const close = parent.getByRole('button', { name: 'Close dialog' });
  expect(await close.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
  })).toBe(true);
  await parent.getByRole('button', { name: 'Submit form' }).focus();
  await page.keyboard.press('Tab');
  await expect(parent.getByRole('button', { name: 'Close dialog' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(parent.getByRole('button', { name: 'Submit form' })).toBeFocused();

  const nestedLauncher = parent.getByRole('button', { name: 'Open nested dialog' });
  await nestedLauncher.click();
  await expect(page.getByRole('dialog', { name: 'Nested confirmation' })).toBeVisible();
  await expect(parent).toHaveCount(0); // Parent remains mounted but is hidden from the accessibility tree.
  await expect(page.locator('body')).toHaveClass(/pf-modal-open/);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Nested confirmation' })).toHaveCount(0);
  await expect(parent).toBeVisible();
  await expect(nestedLauncher).toBeFocused();
  await expect(page.locator('body')).toHaveClass(/pf-modal-open/);
  await page.keyboard.press('Escape');
  await expect(parent).toHaveCount(0);
  await expect(launcher).toBeFocused();
  await expect(page.locator('#root')).not.toHaveAttribute('inert');
  await expect(page.locator('body')).not.toHaveClass(/pf-modal-open/);
  await expect(page.locator('.pf-dialog-root')).toHaveCount(0);
});

test('disabled anchors block pointer, keyboard and new-tab navigation; loading does not resize buttons', async ({ page }) => {
  const internal = page.getByRole('link', { name: 'Disabled internal link' });
  const external = page.getByRole('link', { name: 'Disabled external link' });
  for (const link of [internal, external]) {
    await expect(link).toHaveAttribute('aria-disabled', 'true');
    await expect(link).not.toHaveAttribute('href');
    await link.dispatchEvent('click');
    await link.focus();
    await page.keyboard.press('Enter');
  }
  await expect(page.getByTestId('action-count')).toHaveText('0');
  await expect(page).toHaveURL(/__design-system-fixture$/);
  const save = page.getByRole('button', { name: 'Save changes' });
  const add = page.getByRole('button', { name: 'Add item' });
  const before = [await save.boundingBox(), await add.boundingBox()];
  await page.getByRole('button', { name: 'Toggle loading' }).click();
  await expect(save).toBeDisabled();
  await expect(save).toHaveAttribute('aria-busy', 'true');
  await expect(add).toBeDisabled();
  for (const [index, button] of [save, add].entries()) {
    const box = await button.boundingBox();
    expect(box?.width).toBe(before[index]?.width);
    expect(box?.height).toBe(before[index]?.height);
  }
});

test('field errors have one stable association and keep external descriptions', async ({ page }, testInfo) => {
  const company = page.getByLabel('Company', { exact: true });
  await expect(company).toHaveAttribute('aria-describedby', 'external-description fixture-company-helper');
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.getByRole('button', { name: 'Toggle errors' }).click();
    await expect(company).toHaveAttribute('aria-invalid', 'true');
    await expect(company).toHaveAttribute('aria-describedby', 'external-description fixture-company-field-error');
    await expect(page.locator('#fixture-company-field-error')).toHaveCount(1);
    await expect(page.getByLabel('Notes', { exact: true })).toHaveAttribute('aria-describedby', 'fixture-notes-field-error');
    await expect(page.getByLabel('Role', { exact: true })).toHaveAttribute('aria-describedby', 'fixture-role-field-error');
    await company.fill('A native-valid value does not clear a server-side error');
    await expect(company).toHaveAttribute('aria-invalid', 'true');
    await expect(company).toHaveAttribute('aria-describedby', 'external-description fixture-company-field-error');
    await expect(page.locator('#fixture-company-field-error')).toHaveText('Enter a company name.');
    await page.getByRole('button', { name: 'Toggle errors' }).click();
    await expect(company).not.toHaveAttribute('aria-invalid');
    await expect(company).toHaveAttribute('aria-describedby', 'external-description fixture-company-helper');
  }
  await page.getByRole('button', { name: 'Toggle errors' }).click();
  await page.screenshot({ path: testInfo.outputPath('field-errors.png') });
});

test('tap help opens above the sheet and Escape dismisses help before the dialog', async ({ page }, testInfo) => {
  await page.getByRole('button', { name: 'Open form', exact: true }).click();
  const help = page.getByRole('button', { name: 'Explain Work email' });
  await help.click();
  const popover = page.getByRole('tooltip');
  await expect(popover).toBeVisible();
  await expect(popover).toContainText('work updates');
  await expect(help).toHaveAttribute('aria-expanded', 'true');
  await page.screenshot({ path: testInfo.outputPath('help-popover.png') });
  await page.keyboard.press('Escape');
  await expect(popover).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Review crew time' })).toBeVisible();
  await expect(help).toBeFocused();
  await help.click();
  await page.getByLabel('Field 3', { exact: true }).click();
  await expect(popover).toHaveCount(0);
});

test('repeated native validation produces one error and submit still belongs to the form', async ({ page }) => {
  await page.getByRole('button', { name: 'Open form', exact: true }).click();
  const email = page.getByLabel('Work email', { exact: true });
  await email.fill('invalid-email');
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.getByRole('button', { name: 'Submit form' }).click();
    await expect(page.locator('#fixture-email-error')).toHaveCount(1);
    await expect(email).toHaveAttribute('aria-describedby', 'fixture-email-error');
  }
  await email.fill('synthetic@example.test');
  await expect(page.locator('#fixture-email-error')).toHaveCount(0);
  await page.getByRole('button', { name: 'Submit form' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('submission-count')).toHaveText('1');
});

test('scroll lock restores the page and protects newly mounted background content', async ({ page }) => {
  await page.evaluate(() => {
    document.body.style.paddingRight = '7px';
    const preserved = document.createElement('aside');
    preserved.id = 'already-inert';
    preserved.inert = true;
    preserved.setAttribute('aria-hidden', 'true');
    document.body.append(preserved);
    window.scrollTo(0, 200);
    (document.querySelector('main button') as HTMLButtonElement).click();
  });
  await expect(page.getByRole('dialog', { name: 'Review crew time' })).toBeVisible();
  await page.evaluate(() => {
    const background = document.createElement('aside');
    background.id = 'late-background';
    document.body.append(background);
  });
  await expect(page.locator('#late-background')).toHaveAttribute('inert', '');
  await page.keyboard.press('Escape');
  await expect(page.locator('#late-background')).not.toHaveAttribute('inert');
  await expect(page.locator('#already-inert')).toHaveAttribute('inert', '');
  await expect(page.locator('#already-inert')).toHaveAttribute('aria-hidden', 'true');
  expect(await page.evaluate(() => window.scrollY)).toBe(200);
  expect(await page.evaluate(() => document.body.style.paddingRight)).toBe('7px');
});

for (const width of [320, 360, 390, 430, 768, 1280, 1440]) {
  test(`controls and sheet reflow without overflow at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: width < 640 ? 740 : 900 });
    await page.getByRole('button', { name: 'Open form', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Review crew time' });
    const box = await dialog.boundingBox();
    expect(box?.x).toBeGreaterThanOrEqual(0);
    expect((box?.x || 0) + (box?.width || 0)).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const content = page.locator('.pf-dialog-content').first();
    expect(await content.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    if (width <= 768) {
      for (const control of [page.getByLabel('Work email', { exact: true }), dialog.getByRole('button', { name: 'Close dialog' }), dialog.getByRole('button', { name: 'Submit form' })]) {
        const target = await control.boundingBox();
        expect(target?.height).toBeGreaterThanOrEqual(48);
        expect(target?.width).toBeGreaterThanOrEqual(48);
      }
      const glyph = await dialog.getByRole('button', { name: 'Close dialog' }).locator('svg').boundingBox();
      expect(glyph?.height).toBeLessThanOrEqual(24);
      expect(glyph?.width).toBeLessThanOrEqual(24);
    }
    await page.getByLabel('Final field', { exact: true }).focus();
    await page.getByLabel('Final field', { exact: true }).scrollIntoViewIfNeeded();
    const field = await page.getByLabel('Final field', { exact: true }).boundingBox();
    const footer = await page.locator('.pf-dialog-footer').first().boundingBox();
    expect((field?.y || 0) + (field?.height || 0)).toBeLessThanOrEqual(footer?.y || 0);
    await page.screenshot({ path: testInfo.outputPath(`dialog-${width}.png`), fullPage: false });
  });
}

test('short viewport retains scrollable fields and reachable actions', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 320 });
  await page.getByRole('button', { name: 'Open form', exact: true }).click();
  const field = page.getByLabel('Final field', { exact: true });
  await field.focus();
  await field.scrollIntoViewIfNeeded();
  await expect(field).toBeInViewport();
  await page.getByRole('button', { name: 'Submit form' }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'Submit form' })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('dialog-short-viewport.png') });
});

test('200 percent root text scale reflows fields and dialog actions', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await page.getByRole('button', { name: 'Open form', exact: true }).click();
  const email = page.getByLabel('Work email', { exact: true });
  expect(await email.evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(32);
  const content = page.locator('.pf-dialog-content').first();
  expect(await content.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.getByRole('button', { name: 'Submit form' }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'Submit form' })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('dialog-large-text.png') });
});
