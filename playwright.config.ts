import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: process.env.LOGBOOK_TEST_URL || 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    { name: 'webkit-mobile', testMatch: '**/redesign.spec.ts', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
    { name: 'firefox', testMatch: '**/redesign.spec.ts', use: { ...devices['Desktop Firefox'] } },
  ],
});
