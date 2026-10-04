import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173';
const serverPort = Number(new URL(baseURL).port || 5173);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
    { name: 'webkit', use: { ...devices['iPhone 13'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] }, testMatch: /signup\.spec\.ts/ },
  ],
  webServer: [
    {
      command: `pnpm --filter @crewmodo/web dev --host 127.0.0.1 --port ${serverPort} --strictPort`,
      port: serverPort,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
