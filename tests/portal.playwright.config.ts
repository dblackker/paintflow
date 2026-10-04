import { defineConfig, devices } from '@playwright/test';

// Isolated dev port, real router and public portal. Transport is mocked by the suite.
export default defineConfig({
  testDir: './e2e', testMatch: 'lead-to-pay.spec.ts', workers: 1, retries: 0, reporter: 'list',
  outputDir: '../.codex-artifacts/portal-browser',
  use: { baseURL: 'http://127.0.0.1:5191', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'], viewport: { width: 360, height: 800 } } },
    { name: 'webkit', use: { ...devices['iPhone 13'], viewport: { width: 360, height: 800 } } },
  ],
  webServer: {
    command: 'corepack pnpm --filter @crewmodo/web exec vite --host 127.0.0.1 --port 5191 --strictPort',
    cwd: process.cwd(), port: 5191, reuseExistingServer: false,
  },
});
