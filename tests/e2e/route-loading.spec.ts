import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

test('each lazy route resolves its component without pulling all screens into signup', async ({ page }) => {
  test.setTimeout(120_000);
  await page.route('**/v1/**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: [] }),
    headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } }));
  const loaded: string[] = [];
  page.on('request', (request) => loaded.push(request.url()));
  await page.goto('/signup');
  await expect(page.getByRole('button', { name: /continue to secure checkout/i })).toBeVisible({ timeout: 40_000 });
  expect(loaded.some((url) => /\/pages\/(Invoices|Portal|Time|Calendar|estimates\/EstimateProduction)\.tsx/.test(url))).toBe(false);

  // Verify every registered lazy import/export, not business-data fixtures.
  // Full workflow specs exercise the important routes through their actual UI.
  const source = await readFile(resolve(process.cwd(), 'apps/web/src/router.tsx'), 'utf8');
  const routes = [...source.matchAll(/import\(["']@\/([^"']+)["']\)\)\s*\.([A-Za-z0-9_]+)/g)]
    .map((match) => ({ path: `/src/${match[1]}.tsx`, name: match[2] }));
  expect(routes.length).toBeGreaterThan(40);
  const results = await page.evaluate(async (entries) => {
    const results = [];
    for (const entry of entries) {
      try {
        const module = await import(/* @vite-ignore */ entry.path);
        results.push({ ...entry, valid: typeof module[entry.name] === 'function', error: '' });
      } catch (error) { results.push({ ...entry, valid: false, error: String(error) }); }
    }
    return results;
  }, routes);
  expect(results.filter((entry) => !entry.valid)).toEqual([]);
});
