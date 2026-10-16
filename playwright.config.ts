import { defineConfig, devices } from '@playwright/test';
import { assertLoopbackE2eUrl } from './scripts/e2e-environment.mjs';

const testBaseURL = process.env.LOGBOOK_TEST_URL || 'http://127.0.0.1:4173';
assertLoopbackE2eUrl(testBaseURL);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: testBaseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-safari',
      testMatch: /(accessibility|data-history-mobile|health-consent-suspended|secure-archive-device-key)\.spec\.ts/,
      use: { ...devices['iPhone 13'] },
    },
  ],
});
